import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  ROAD_SEGMENTS,
  TreeSpecies,
  VILLA_PARCELS,
  WORLD_BOUNDS,
  getGroundHeight,
  getParcelWorldAABB,
} from '../../src/scene/DistrictLayout';
import { ProceduralMaterialSet, RoadSignVariant } from '../../src/scene/ProceduralMaterials';
import { seawallZ, shanhaiguanCenterZ } from '../../src/scene/TerrainAndRoads';
import { buildVegetationAndProps } from '../../src/scene/VegetationAndProps';
import { createAtmosphere } from '../../src/scene/Atmosphere';
import { distToPolyline2D, pointInExpandedAABB } from '../../src/utils/math';

function createHeadlessMaterialStub(): {
  materials: ProceduralMaterialSet;
  signCalls: Array<{ nameZh: string; nameEn: string; variant: RoadSignVariant }>;
  sharedMaterials: THREE.MeshStandardMaterial[];
} {
  const shared = new THREE.MeshStandardMaterial();
  const signMatGreen = new THREE.MeshStandardMaterial();
  const signMatBlue = new THREE.MeshStandardMaterial();
  const signCalls: Array<{ nameZh: string; nameEn: string; variant: RoadSignVariant }> = [];

  const materials: ProceduralMaterialSet = {
    graniteAshlar: shared,
    mushroomStone: shared,
    terracottaRoof: shared,
    stuccoBase: shared,
    brick: shared,
    darkTimber: shared,
    whiteTrim: shared,
    darkIron: shared,
    windowGlass: shared,
    stainedGlass: shared,
    asphalt: shared,
    cobblestone: shared,
    curbStone: shared,
    crosswalkPaint: shared,
    beachSand: shared,
    bark: shared,
    createTintedStuccoMaterial: () => shared,
    createRoadSignMaterial: (nameZh, nameEn, variant = 'blue') => {
      signCalls.push({ nameZh, nameEn, variant });
      return variant === 'green' ? signMatGreen : signMatBlue;
    },
    dispose: () => {
      shared.dispose();
      signMatGreen.dispose();
      signMatBlue.dispose();
    },
  };

  return {
    materials,
    signCalls,
    sharedMaterials: [shared, signMatGreen, signMatBlue],
  };
}

function getInstancePositions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, mat);
    pos.setFromMatrixPosition(mat);
    out.push(pos.clone());
  }
  return out;
}

describe('VegetationAndProps (M3)', () => {
  it('instantiates all 9 TreeSpecies cleanly grounded outside roads, villa parcels, beach, and staircase', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildVegetationAndProps(materials);

    try {
      const allSpecies: TreeSpecies[] = [
        'snow_cedar',
        'crabapple',
        'flowering_peach',
        'black_pine',
        'crape_myrtle',
        'five_point_maple',
        'dragon_juniper',
        'ginkgo',
        'french_sycamore',
      ];

      const parcelAABBs = VILLA_PARCELS.map((p) => getParcelWorldAABB(p));
      let totalTrees = 0;

      for (const sp of allSpecies) {
        const trunk = res.group.getObjectByName(`TreesTrunk_${sp}`) as THREE.InstancedMesh;
        const crown = res.group.getObjectByName(`TreesCrown_${sp}`) as THREE.InstancedMesh;

        expect(trunk).toBeInstanceOf(THREE.InstancedMesh);
        expect(crown).toBeInstanceOf(THREE.InstancedMesh);
        expect(trunk.count).toBeGreaterThan(0);
        expect(crown.count).toBe(trunk.count);
        expect(trunk.frustumCulled).toBe(false);
        expect(crown.frustumCulled).toBe(false);

        totalTrees += trunk.count;
        const positions = getInstancePositions(trunk);

        for (const p of positions) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);

          // Grounded cleanly to terrain height - 0.05m
          expect(p.y).toBeCloseTo(getGroundHeight(p.x, p.z) - 0.05, 4);

          // Outside every road + curb + sidewalk corridor
          for (const seg of ROAD_SEGMENTS) {
            const minClear = seg.width * 0.5 + 0.22 + seg.sidewalkWidth;
            expect(distToPolyline2D(p.x, p.z, seg.waypoints)).toBeGreaterThanOrEqual(minClear);
          }

          // Outside every villa parcel + 2.0m courtyard clearance
          for (const box of parcelAABBs) {
            expect(pointInExpandedAABB(p.x, p.z, box, 2.0)).toBe(false);
          }

          // Outside beach, seawall, Ningwuguan staircase, and Yellow Sea
          expect(p.z).toBeLessThanOrEqual(WORLD_BOUNDS.waterLineZ(p.x) - 3.5);
          if (p.x >= -58 && p.x <= 176) {
            expect(p.z).toBeLessThan(seawallZ(p.x) - 1.0);
          }
        }
      }

      expect(totalTrees).toBeGreaterThan(250);
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('builds fallen leaf carpets, 350-500 drifting autumn leaves, bilingual signs, streetlamps, and coastal benches', () => {
    const { materials, signCalls, sharedMaterials } = createHeadlessMaterialStub();
    const res = buildVegetationAndProps(materials);

    try {
      // 1. Fallen leaf carpets
      const carpets = res.group.getObjectByName('FallenLeafCarpets') as THREE.InstancedMesh;
      expect(carpets).toBeInstanceOf(THREE.InstancedMesh);
      expect(carpets.count).toBeGreaterThan(200);
      const carpetMat = carpets.material as THREE.MeshStandardMaterial;
      expect(carpetMat.polygonOffset).toBe(true);
      for (const p of getInstancePositions(carpets)) {
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.y).toBeGreaterThan(getGroundHeight(p.x, p.z) + 0.04);
        expect(Math.abs(p.x) < 3.5 && p.z > 120).toBe(false);
      }

      // 2. Drifting autumn leaves (350-500) + finite update(t, dt)
      const drifting = res.group.getObjectByName('DriftingAutumnLeaves') as THREE.InstancedMesh;
      expect(drifting).toBeInstanceOf(THREE.InstancedMesh);
      expect(drifting.count).toBeGreaterThanOrEqual(350);
      expect(drifting.count).toBeLessThanOrEqual(500);
      expect(drifting.frustumCulled).toBe(false);
      expect((drifting.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);

      const beforePos = getInstancePositions(drifting)[0];
      res.update(1.5, 0.05);
      const afterPos = getInstancePositions(drifting)[0];
      expect(afterPos.equals(beforePos)).toBe(false);
      expect(Number.isFinite(afterPos.x) && Number.isFinite(afterPos.y) && Number.isFinite(afterPos.z)).toBe(true);

      // Edge case: NaN / huge dt clamped safely
      res.update(Number.NaN, 100);
      const safePos = getInstancePositions(drifting)[0];
      expect(Number.isFinite(safePos.x) && Number.isFinite(safePos.y) && Number.isFinite(safePos.z)).toBe(true);

      // 3. Bilingual street signposts across all 10 roads
      expect(res.group.getObjectByName('StreetSignPosts')).toBeInstanceOf(THREE.Mesh);
      for (const seg of ROAD_SEGMENTS) {
        expect(res.group.getObjectByName(`StreetSignBlades_${seg.id}`)).toBeInstanceOf(THREE.Mesh);
      }
      expect(signCalls).toHaveLength(10);
      for (const call of signCalls) {
        const isNs =
          call.nameEn === 'Zijingguan Rd' ||
          call.nameEn === 'Ningwuguan Rd' ||
          call.nameEn === 'Shaoguan Rd';
        expect(call.variant).toBe(isNs ? 'green' : 'blue');
      }

      // 4. Cast-iron streetlamps outside carriageways and Ningwuguan staircase
      const lamps = res.group.getObjectByName('StreetLampPosts') as THREE.InstancedMesh;
      const lanterns = res.group.getObjectByName('StreetLampLanterns') as THREE.InstancedMesh;
      expect(lamps).toBeInstanceOf(THREE.InstancedMesh);
      expect(lanterns).toBeInstanceOf(THREE.InstancedMesh);
      expect(lamps.count).toBe(lanterns.count);
      expect(lamps.count).toBeGreaterThanOrEqual(25);
      for (const p of getInstancePositions(lamps)) {
        for (const seg of ROAD_SEGMENTS) {
          expect(distToPolyline2D(p.x, p.z, seg.waypoints)).toBeGreaterThanOrEqual(
            seg.width * 0.5 + 0.25,
          );
        }
        expect(Math.abs(p.x) < 6.0 && p.z > 110).toBe(false);
      }

      // 5. Coastal promenade benches avoiding Ningwuguan staircase and steep bluff dip
      const benchFrames = res.group.getObjectByName('PromenadeBenchFrames') as THREE.InstancedMesh;
      const benchSlats = res.group.getObjectByName('PromenadeBenchSlats') as THREE.InstancedMesh;
      expect(benchFrames).toBeInstanceOf(THREE.InstancedMesh);
      expect(benchSlats).toBeInstanceOf(THREE.InstancedMesh);
      expect(benchFrames.count).toBe(benchSlats.count);
      expect(benchFrames.count).toBeGreaterThanOrEqual(8);
      for (const p of getInstancePositions(benchFrames)) {
        expect(Math.abs(p.x)).toBeGreaterThanOrEqual(10);
        expect(p.x > 15 && p.x < 65).toBe(false);
        expect(p.z).toBeCloseTo(shanhaiguanCenterZ(p.x) + 8.15, 2);
      }

      // 6. Prop colliders valid & non-inverted
      expect(res.colliders.length).toBeGreaterThan(200);
      for (const box of res.colliders) {
        expect(box.kind).toBe('prop');
        expect(Number.isFinite(box.minX) && Number.isFinite(box.maxX)).toBe(true);
        expect(Number.isFinite(box.minZ) && Number.isFinite(box.maxZ)).toBe(true);
        expect(box.minX).toBeLessThan(box.maxX);
        expect(box.minZ).toBeLessThan(box.maxZ);
      }

      // 7. Dispose cleans local resources without disposing shared ProceduralMaterialSet
      const spies = sharedMaterials.map((m) => vi.spyOn(m, 'dispose'));
      const parent = new THREE.Scene();
      parent.add(res.group);
      res.dispose();
      expect(res.group.parent).toBeNull();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      materials.dispose();
    }
  });
});

describe('Atmosphere & Yellow Sea (M3)', () => {
  it('configures SW Golden Autumn sun, HemisphereLight, FogExp2, Sky dome, Yellow Sea shader, and horizon wings', () => {
    const scene = new THREE.Scene();
    const rig = createAtmosphere(scene);

    try {
      expect(rig.group.parent).toBe(scene);

      // 1. SW sun light & shadow frustum covering [-200, 200] x [-185, 215]
      expect(rig.sunLight).toBeInstanceOf(THREE.DirectionalLight);
      expect(rig.sunLight.position.x).toBeLessThan(0);
      expect(rig.sunLight.position.y).toBeGreaterThan(0);
      expect(rig.sunLight.position.z).toBeGreaterThan(0);
      expect(rig.sunLight.castShadow).toBe(true);
      expect(rig.sunLight.shadow.mapSize.x).toBe(2048);
      expect(rig.sunLight.shadow.mapSize.y).toBe(2048);
      expect(rig.sunLight.shadow.radius).toBe(2);
      expect(rig.sunLight.shadow.camera.left).toBeLessThanOrEqual(-200);
      expect(rig.sunLight.shadow.camera.right).toBeGreaterThanOrEqual(200);
      expect(rig.sunLight.shadow.camera.top).toBeGreaterThanOrEqual(185);
      expect(rig.sunLight.shadow.camera.bottom).toBeLessThanOrEqual(-185);

      // 2. Hemisphere + fill lights
      let hemiCount = 0;
      let fillCount = 0;
      rig.group.traverse((obj) => {
        if (obj instanceof THREE.HemisphereLight) hemiCount++;
        if (obj instanceof THREE.DirectionalLight && obj !== rig.sunLight) {
          fillCount++;
          expect(obj.castShadow).toBe(false);
        }
      });
      expect(hemiCount).toBe(1);
      expect(fillCount).toBe(1);

      // 3. FogExp2 & Sky
      expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
      expect((scene.fog as THREE.FogExp2).density).toBeGreaterThan(0);
      expect(scene.background).toBeInstanceOf(THREE.Color);

      const sky = rig.group.getObjectByName('BadaguanSkyDome') as THREE.Mesh & {
        isSky?: boolean;
        material: THREE.ShaderMaterial;
      };
      expect(sky).toBeDefined();
      expect(sky.isSky).toBe(true);
      expect(sky.frustumCulled).toBe(false);
      expect(sky.material.uniforms.sunPosition.value.x).toBeLessThan(0);
      expect(sky.material.uniforms.sunPosition.value.z).toBeGreaterThan(0);

      // 4. Yellow Sea ShaderMaterial & Three.js output chunk ordering
      const ocean = rig.group.getObjectByName('YellowSeaWater') as THREE.Mesh;
      expect(ocean).toBeInstanceOf(THREE.Mesh);
      expect(ocean.position.y).toBe(0);
      const oceanBox = new THREE.Box3().setFromObject(ocean);
      expect(oceanBox.max.z).toBeGreaterThan(800);

      const oceanMat = ocean.material as THREE.ShaderMaterial;
      expect(oceanMat).toBeInstanceOf(THREE.ShaderMaterial);
      expect(oceanMat.fog).toBe(true);
      expect(oceanMat.transparent).toBe(true);
      expect(oceanMat.uniforms.uTime).toBeDefined();
      expect(oceanMat.uniforms.uSunDir).toBeDefined();

      const frag = oceanMat.fragmentShader;
      expect(frag).toContain('waterLineZ');
      const idxTone = frag.indexOf('#include <tonemapping_fragment>');
      const idxColor = frag.indexOf('#include <colorspace_fragment>');
      const idxFog = frag.indexOf('#include <fog_fragment>');
      expect(idxTone).toBeGreaterThan(-1);
      expect(idxColor).toBeGreaterThan(idxTone);
      expect(idxFog).toBeGreaterThan(idxColor);

      // 5. 360-degree coastal horizon headlands & land wings
      for (const name of [
        'WestCoastalWing',
        'EastCoastalWing',
        'NorthernBackdropHills',
        'DistantWestBayHeadland',
        'DistantEastBayHeadland',
      ]) {
        expect(rig.group.getObjectByName(name)).toBeInstanceOf(THREE.Mesh);
      }

      // 6. update() & dispose()
      rig.update(4.25, new THREE.Vector3(15, 6, 110));
      expect(sky.position.x).toBe(15);
      expect(sky.position.y).toBe(6);
      expect(sky.position.z).toBe(110);
      expect(sky.material.uniforms.time.value).toBe(4.25);
      expect(oceanMat.uniforms.uTime.value).toBe(4.25);

      rig.update(Number.NaN, new THREE.Vector3(Number.NaN, 0, 0));
      expect(oceanMat.uniforms.uTime.value).toBe(0);
      expect(sky.position.x).toBe(15);

      rig.dispose();
      expect(rig.group.parent).toBeNull();
      expect(scene.fog).toBeNull();
    } finally {
      rig.dispose();
    }
  });

  it('covers all WORLD_BOUNDS corners, VILLA_PARCELS, ROAD_SEGMENTS waypoints, and playable trees in rotated light-space NDC and aligns horizon seams', () => {
    const scene = new THREE.Scene();
    const rig = createAtmosphere(scene);
    const { materials } = createHeadlessMaterialStub();
    const veg = buildVegetationAndProps(materials);

    try {
      const { sunLight } = rig;
      sunLight.updateMatrixWorld(true);
      sunLight.target.updateMatrixWorld(true);
      sunLight.shadow.camera.updateProjectionMatrix();
      sunLight.shadow.updateMatrices(sunLight);

      const shadowProjView = new THREE.Matrix4().multiplyMatrices(
        sunLight.shadow.camera.projectionMatrix,
        sunLight.shadow.camera.matrixWorldInverse,
      );

      const assertInsideLightNDC = (x: number, y: number, z: number) => {
        const ndc = new THREE.Vector3(x, y, z).applyMatrix4(shadowProjView);
        expect(ndc.x).toBeGreaterThanOrEqual(-1);
        expect(ndc.x).toBeLessThanOrEqual(1);
        expect(ndc.y).toBeGreaterThanOrEqual(-1);
        expect(ndc.y).toBeLessThanOrEqual(1);
        expect(ndc.z).toBeGreaterThanOrEqual(-1);
        expect(ndc.z).toBeLessThanOrEqual(1);
      };

      // 1. All 8 corners of WORLD_BOUNDS (y in {0, 16})
      for (const x of [WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX]) {
        for (const y of [0, 16]) {
          for (const z of [WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ]) {
            assertInsideLightNDC(x, y, z);
          }
        }
      }

      // 2. All 19 VILLA_PARCELS corners (y in {gh, gh + 18})
      for (const parcel of VILLA_PARCELS) {
        const box = getParcelWorldAABB(parcel);
        for (const x of [box.minX, box.maxX]) {
          for (const z of [box.minZ, box.maxZ]) {
            const gh = getGroundHeight(x, z);
            assertInsideLightNDC(x, gh, z);
            assertInsideLightNDC(x, gh + 18, z);
          }
        }
      }

      // 3. All ROAD_SEGMENTS waypoints
      for (const seg of ROAD_SEGMENTS) {
        for (const wp of seg.waypoints) {
          const gh = getGroundHeight(wp.x, wp.z);
          assertInsideLightNDC(wp.x, gh, wp.z);
          assertInsideLightNDC(wp.x, gh + 10, wp.z);
        }
      }

      // 4. All playable-bounds trees (base and canopy top)
      let playableTreeCount = 0;
      veg.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh && obj.name.startsWith('TreesTrunk_')) {
          for (const p of getInstancePositions(obj)) {
            if (
              p.x >= WORLD_BOUNDS.minX &&
              p.x <= WORLD_BOUNDS.maxX &&
              p.z >= WORLD_BOUNDS.minZ &&
              p.z <= WORLD_BOUNDS.maxZ
            ) {
              playableTreeCount++;
              assertInsideLightNDC(p.x, p.y, p.z);
              assertInsideLightNDC(p.x, p.y + 12, p.z);
            }
          }
        }
      });
      expect(playableTreeCount).toBeGreaterThan(250);

      // 5. Horizon wing & northern backdrop hill seam vertices match getGroundHeight at |X| = 280 and Z = -260
      for (const [name, axis, targetVal] of [
        ['WestCoastalWing', 'x', -280],
        ['EastCoastalWing', 'x', 280],
        ['NorthernBackdropHills', 'z', -260],
      ] as const) {
        const mesh = rig.group.getObjectByName(name) as THREE.Mesh;
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        let seamVertexCount = 0;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i);
          const vy = pos.getY(i);
          const vz = pos.getZ(i);
          const coord = axis === 'x' ? vx : vz;
          if (Math.abs(coord - targetVal) < 1e-6) {
            seamVertexCount++;
            if (Math.abs(vx) <= 280 && vz >= -260) {
              expect(Math.abs(vy - getGroundHeight(vx, vz))).toBeLessThan(1e-5);
            }
          }
        }
        expect(seamVertexCount).toBeGreaterThan(10);
      }
    } finally {
      veg.dispose();
      materials.dispose();
      rig.dispose();
    }
  });
});
