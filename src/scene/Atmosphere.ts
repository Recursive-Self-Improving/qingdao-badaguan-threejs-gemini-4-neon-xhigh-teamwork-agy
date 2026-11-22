import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { getGroundHeight } from './DistrictLayout';
import { clamp, lerp, smoothstep } from '../utils/math';

export interface AtmosphereRig {
  group: THREE.Group;
  sunLight: THREE.DirectionalLight;
  update(elapsedTime: number, cameraPos: THREE.Vector3): void;
  dispose(): void;
}

const FOG_COLOR = 0xcfdce6;
const FOG_DENSITY = 0.0018;

const OCEAN_VERTEX_SHADER = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

uniform float uTime;

varying vec3 vWorldPos;

float waterLineZ(float x) {
  float cx = clamp(x, -260.0, 260.0);
  float a = (cx + 112.0) / 40.0;
  float b = (cx - 35.0) / 68.0;
  float c = (cx - 165.0) / 45.0;
  return 172.0 + 26.0 * exp(-(a * a)) - 12.0 * exp(-(b * b)) + 8.0 * exp(-(c * c));
}

void main() {
  vec3 transformed = vec3(position);
  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);

  float distOffshore = worldPos.z - waterLineZ(worldPos.x);
  float swellMask = smoothstep(1.5, 16.0, distOffshore);

  float waveA = sin(worldPos.x * 0.085 + worldPos.z * 0.135 - uTime * 1.15);
  float waveB = cos(worldPos.x * 0.165 - worldPos.z * 0.105 + uTime * 0.88);
  worldPos.y += swellMask * (0.065 * waveA + 0.032 * waveB);

  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uFoamColor;

varying vec3 vWorldPos;

float waterLineZ(float x) {
  float cx = clamp(x, -260.0, 260.0);
  float a = (cx + 112.0) / 40.0;
  float b = (cx - 35.0) / 68.0;
  float c = (cx - 165.0) / 45.0;
  return 172.0 + 26.0 * exp(-(a * a)) - 12.0 * exp(-(b * b)) + 8.0 * exp(-(c * c));
}

void main() {
  float distOffshore = vWorldPos.z - waterLineZ(vWorldPos.x);
  if (distOffshore < -0.5) {
    discard;
  }

  vec3 viewVec = cameraPosition - vWorldPos;
  float viewDist = length(viewVec);
  vec3 V = viewVec / max(viewDist, 0.0001);

  float nearShoreRamp = smoothstep(0.0, 6.0, distOffshore);
  float distAtten = smoothstep(560.0, 130.0, viewDist);
  float slopeScale = (0.35 + 0.65 * nearShoreRamp) * (0.22 + 0.78 * distAtten);

  // 4-octave analytical directional wave gradients
  float p1 = vWorldPos.x * 0.24 + vWorldPos.z * 0.34 - uTime * 1.45;
  float p2 = -vWorldPos.x * 0.38 + vWorldPos.z * 0.42 - uTime * 1.12;
  float p3 = vWorldPos.x * 0.71 + vWorldPos.z * 0.64 + uTime * 1.85;
  float p4 = -vWorldPos.x * 1.15 + vWorldPos.z * 0.92 - uTime * 2.25;

  float dHdx = slopeScale * (
    0.042 * cos(p1) * 0.24 +
    0.028 * cos(p2) * -0.38 +
    0.015 * cos(p3) * 0.71 +
    0.009 * cos(p4) * -1.15
  );
  float dHdz = slopeScale * (
    0.042 * cos(p1) * 0.34 +
    0.028 * cos(p2) * 0.42 +
    0.015 * cos(p3) * 0.64 +
    0.009 * cos(p4) * 0.92
  );

  vec3 N = normalize(vec3(-dHdx, 1.0, -dHdz));

  // Schlick Fresnel sky reflection
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.035 + 0.965 * pow(max(1.0 - cosV, 0.0001), 4.5);

  vec3 R = reflect(-V, N);
  float skyElev = clamp(R.y, 0.0001, 1.0);
  vec3 reflSky = mix(uSkyHorizonColor, uSkyZenithColor, pow(skyElev, 0.65));
  float sunHalo = pow(max(dot(R, uSunDir), 0.0001), 8.0);
  reflSky += uSunColor * (sunHalo * 0.26);

  // Turquoise shallow-to-deep Yellow Sea water body
  float depthMix = smoothstep(2.0, 48.0, distOffshore);
  vec3 waterBody = mix(uShallowColor, uDeepColor, depthMix);
  float crestGlow = smoothstep(0.01, 0.065, abs(dHdx) + abs(dHdz)) * (1.0 - depthMix * 0.55);
  waterBody += vec3(0.05, 0.14, 0.15) * crestGlow;

  vec3 color = mix(waterBody, reflSky, clamp(fresnel * 0.62, 0.0, 0.72));

  // Distance-attenuated two-lobe Blinn-Phong sun sparkle
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0001);
  float sparkleTight = pow(ndh, 320.0) * 2.2 * distAtten;
  float sparkleBroad = pow(ndh, 36.0) * 0.24 * (0.35 + 0.65 * distAtten);
  color += uSunColor * (sparkleTight + sparkleBroad);

  // Animated shoreline lap foam
  float lapWave = sin(distOffshore * 2.2 - uTime * 1.7 + sin(vWorldPos.x * 0.08) * 1.6);
  float foamMask =
    (1.0 - smoothstep(0.0, 4.4, distOffshore)) *
    smoothstep(-0.2, 0.5, distOffshore) *
    smoothstep(-0.2, 0.75, lapWave);
  float edgeFoam = (1.0 - smoothstep(0.0, 1.25, distOffshore)) * smoothstep(-0.25, 0.2, distOffshore);
  float totalFoam = clamp(foamMask * 0.65 + edgeFoam * 0.75, 0.0, 0.88);
  color = mix(color, uFoamColor, totalFoam);

  float alpha = smoothstep(-0.25, 1.35, distOffshore);
  gl_FragColor = vec4(color, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function linspace(min: number, max: number, segments: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= segments; i++) {
    out.push(lerp(min, max, i / segments));
  }
  return out;
}

function buildHeightFieldRibbon(
  name: string,
  xs: readonly number[],
  zs: readonly number[],
  sampleHeightAndColor: (x: number, z: number, outColor: THREE.Color) => number,
  material: THREE.Material,
): THREE.Mesh {
  const cols = xs.length;
  const rows = zs.length;
  const segX = cols - 1;
  const segZ = rows - 1;
  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices: number[] = [];
  const c = new THREE.Color();

  let ptr = 0;
  for (let rz = 0; rz < rows; rz++) {
    const z = zs[rz];
    for (let rx = 0; rx < cols; rx++) {
      const x = xs[rx];
      const y = sampleHeightAndColor(x, z, c);
      positions[ptr * 3] = x;
      positions[ptr * 3 + 1] = y;
      positions[ptr * 3 + 2] = z;
      colors[ptr * 3] = c.r;
      colors[ptr * 3 + 1] = c.g;
      colors[ptr * 3 + 2] = c.b;
      ptr++;
    }
  }

  for (let rz = 0; rz < segZ; rz++) {
    for (let rx = 0; rx < segX; rx++) {
      const a = rz * cols + rx;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function buildCoastalHorizonGroup(disposables: Set<THREE.BufferGeometry | THREE.Material>): THREE.Group {
  const horizonGroup = new THREE.Group();
  horizonGroup.name = 'BadaguanHorizonHeadlands';

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
  });
  disposables.add(terrainMat);

  const cForest = new THREE.Color(0x52653b);
  const cAutumnHill = new THREE.Color(0x886a3a);
  const cGranite = new THREE.Color(0x837c71);
  const cMistyRidge = new THREE.Color(0x5e7162);

  const sampleWingElevation = (x: number, z: number, applyWingSink = true): number => {
    const clampedX = clamp(x, -280, 280);
    const seamH = getGroundHeight(clampedX, clamp(z, -260, 230));
    const distOut = Math.max(0, Math.abs(x) - 280);
    const blendOut = smoothstep(0, 140, distOut);
    const overlapSink = applyWingSink && Math.abs(x) < 280 ? -0.12 : 0;
    const seaFade = 1.0 - smoothstep(145, 192, z);
    const ridge =
      (14.0 +
        8.5 * Math.sin(x * 0.008 + z * 0.006) +
        5.0 * Math.cos(x * 0.015 - z * 0.012)) *
      smoothstep(130, -240, z);
    return lerp(seamH, ridge * seaFade - 1.5 * (1 - seaFade), blendOut) + overlapSink;
  };

  // 1. West & East Flanking Coastal Wings matching BadaguanTerrain seam at |X| = 280
  const wingZs = [
    ...linspace(-260, 120, 76),
    ...linspace(120, 165, 18).slice(1),
    ...linspace(165, 205, 8).slice(1),
  ];
  for (const side of [-1, 1] as const) {
    const wingXs =
      side < 0 ? [...linspace(-1080, -280, 24), -276] : [276, ...linspace(280, 1080, 24)];

    const wing = buildHeightFieldRibbon(
      side < 0 ? 'WestCoastalWing' : 'EastCoastalWing',
      wingXs,
      wingZs,
      (x, z, outColor) => {
        const y = sampleWingElevation(x, z);
        const autumnMix = 0.5 + 0.5 * Math.sin(x * 0.021 + z * 0.017);
        outColor.copy(cForest).lerp(cAutumnHill, autumnMix * 0.55);
        if (y < 1.2) {
          outColor.lerp(cGranite, 0.65);
        }
        return y;
      },
      terrainMat,
    );
    disposables.add(wing.geometry);
    horizonGroup.add(wing);
  }

  // 2. Northern Zhongshan Park / Zhanshan Backdrop Hills matching Z = -260 seam seamlessly across full width
  const northXs = [
    ...linspace(-1080, -280, 24),
    ...linspace(-280, 280, 28).slice(1),
    ...linspace(280, 1080, 24).slice(1),
  ];
  const northZs = [...linspace(-580, -260, 18), -254];
  const northHills = buildHeightFieldRibbon(
    'NorthernBackdropHills',
    northXs,
    northZs,
    (x, z, outColor) => {
      const seamH = sampleWingElevation(x, Math.max(-260, z), false);
      const distNorth = Math.max(0, -260 - z);
      const riseT = smoothstep(0, 260, distNorth);
      const overlapSink = z > -260 ? -0.12 : 0;

      const hillWave =
        28.0 +
        14.0 * Math.sin(x * 0.0055 + 0.4) +
        8.5 * Math.cos(x * 0.012 - z * 0.009) +
        4.5 * Math.sin(x * 0.024 + z * 0.018);
      const y = lerp(seamH, Math.max(seamH + 4, hillWave), riseT) + overlapSink;

      const autumnMix = 0.5 + 0.5 * Math.cos(x * 0.016 - z * 0.014);
      outColor.copy(cForest).lerp(cAutumnHill, autumnMix * 0.62);
      return y;
    },
    terrainMat,
  );
  disposables.add(northHills.geometry);
  horizonGroup.add(northHills);

  // 3. Distant Yellow Sea Bay Headlands (West Huiquan/Xiaoyushan & East Taipingjiao/Laoshan)
  const westHeadland = buildHeightFieldRibbon(
    'DistantWestBayHeadland',
    linspace(-1040, -330, 24),
    linspace(540, 840, 14),
    (x, z, outColor) => {
      const cx = (x + 760) / 360;
      const cz = (z - 690) / 145;
      const env = Math.max(0, 1 - (cx * cx + cz * cz));
      const crest =
        env *
        env *
        (30.0 + 10.0 * Math.sin(x * 0.014) + 6.0 * Math.cos(z * 0.022));
      outColor.copy(cMistyRidge).lerp(cGranite, 0.25);
      return -2.2 + crest;
    },
    terrainMat,
  );
  disposables.add(westHeadland.geometry);
  horizonGroup.add(westHeadland);

  const eastHeadland = buildHeightFieldRibbon(
    'DistantEastBayHeadland',
    linspace(380, 1080, 24),
    linspace(560, 880, 14),
    (x, z, outColor) => {
      const cx = (x - 790) / 380;
      const cz = (z - 720) / 155;
      const env = Math.max(0, 1 - (cx * cx + cz * cz));
      const crest =
        env *
        env *
        (36.0 + 12.0 * Math.cos(x * 0.012) + 7.0 * Math.sin(z * 0.019));
      outColor.copy(cMistyRidge).lerp(cGranite, 0.28);
      return -2.2 + crest;
    },
    terrainMat,
  );
  disposables.add(eastHeadland.geometry);
  horizonGroup.add(eastHeadland);

  return horizonGroup;
}

export function createAtmosphere(scene: THREE.Scene): AtmosphereRig {
  const group = new THREE.Group();
  group.name = 'BadaguanAtmosphere';
  const disposables = new Set<THREE.BufferGeometry | THREE.Material>();

  // 1. Golden Autumn Afternoon (~15:45 SW sun) Directional + Hemisphere + Coastal Fill
  const sunTargetPos = new THREE.Vector3(0, 2, 15);
  const sunOffset = new THREE.Vector3(-195, 150.8, 188.5);
  const sunDir = sunOffset.clone().normalize();

  const sunLight = new THREE.DirectionalLight(0xffe2b0, 2.55);
  sunLight.name = 'GoldenAutumnSun';
  sunLight.position.copy(sunTargetPos).add(sunOffset);
  sunLight.target.position.copy(sunTargetPos);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.radius = 2;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.03;
  sunLight.shadow.camera.near = 5;
  sunLight.shadow.camera.far = 660;
  sunLight.shadow.camera.left = -300;
  sunLight.shadow.camera.right = 300;
  sunLight.shadow.camera.top = 215;
  sunLight.shadow.camera.bottom = -215;
  sunLight.shadow.camera.updateProjectionMatrix();
  group.add(sunLight);
  group.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight(0x88bbe8, 0x7d6a52, 0.72);
  hemiLight.name = 'AutumnSkyGroundBounce';
  group.add(hemiLight);

  const coastalFillLight = new THREE.DirectionalLight(0xa6cde8, 0.42);
  coastalFillLight.name = 'YellowSeaCoastalFill';
  coastalFillLight.position.set(140, 65, 110);
  coastalFillLight.castShadow = false;
  group.add(coastalFillLight);

  // 2. Harmonized Background & Coastal Exp2 Fog
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  // 3. Procedural Atmospheric Sky Dome (three/addons/objects/Sky.js)
  const sky = new Sky();
  sky.name = 'BadaguanSkyDome';
  sky.scale.setScalar(900);
  sky.frustumCulled = false;

  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 4.5;
  skyUniforms.rayleigh.value = 1.55;
  skyUniforms.mieCoefficient.value = 0.005;
  skyUniforms.mieDirectionalG.value = 0.82;
  (skyUniforms.sunPosition.value as THREE.Vector3).copy(sunDir);
  if (skyUniforms.cloudCoverage) skyUniforms.cloudCoverage.value = 0.28;
  if (skyUniforms.cloudDensity) skyUniforms.cloudDensity.value = 0.34;
  if (skyUniforms.cloudElevation) skyUniforms.cloudElevation.value = 0.55;
  if (skyUniforms.cloudScale) skyUniforms.cloudScale.value = 0.00024;
  if (skyUniforms.cloudSpeed) skyUniforms.cloudSpeed.value = 0.000018;
  if (skyUniforms.showSunDisc) skyUniforms.showSunDisc.value = 1;
  if (skyUniforms.time) skyUniforms.time.value = 0;

  disposables.add(sky.geometry);
  disposables.add(sky.material);
  group.add(sky);

  // 4. Animated Yellow Sea Water Shader (Y = 0.0m, south of coastline)
  const oceanGeo = new THREE.PlaneGeometry(2200, 1060, 140, 80);
  oceanGeo.rotateX(-Math.PI / 2);
  disposables.add(oceanGeo);

  const oceanUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(0xffe6ba) },
      uDeepColor: { value: new THREE.Color(0x134e6f) },
      uShallowColor: { value: new THREE.Color(0x267f99) },
      uSkyZenithColor: { value: new THREE.Color(0x3778b8) },
      uSkyHorizonColor: { value: new THREE.Color(0x9ec4e0) },
      uFoamColor: { value: new THREE.Color(0xf2f4f0) },
    },
  ]);

  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms,
    vertexShader: OCEAN_VERTEX_SHADER,
    fragmentShader: OCEAN_FRAGMENT_SHADER,
    fog: true,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  disposables.add(oceanMat);

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.name = 'YellowSeaWater';
  oceanMesh.position.set(0, 0, 650);
  oceanMesh.renderOrder = 1;
  oceanMesh.frustumCulled = false;
  group.add(oceanMesh);

  // 5. Distant Coastal Headlands, Flanking Wings & Northern Backdrop Hills
  const horizonGroup = buildCoastalHorizonGroup(disposables);
  group.add(horizonGroup);

  scene.add(group);

  const update = (elapsedTime: number, cameraPos: THREE.Vector3): void => {
    const safeT = Number.isFinite(elapsedTime) ? elapsedTime : 0;
    oceanUniforms.uTime.value = safeT;
    if (skyUniforms.time) {
      skyUniforms.time.value = safeT;
    }
    if (
      cameraPos &&
      Number.isFinite(cameraPos.x) &&
      Number.isFinite(cameraPos.y) &&
      Number.isFinite(cameraPos.z)
    ) {
      sky.position.copy(cameraPos);
    }
  };

  const dispose = (): void => {
    for (const item of disposables) {
      item.dispose();
    }
    disposables.clear();
    group.removeFromParent();
    if (scene.fog instanceof THREE.FogExp2 && scene.fog.density === FOG_DENSITY) {
      scene.fog = null;
    }
  };

  return {
    group,
    sunLight,
    update,
    dispose,
  };
}
