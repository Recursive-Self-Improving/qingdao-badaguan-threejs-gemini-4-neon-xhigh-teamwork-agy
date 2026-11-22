import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ColliderBox,
  ROAD_SEGMENTS,
  VILLA_PARCELS,
  WORLD_BOUNDS,
  getGroundHeight,
  getParcelWorldAABB,
} from './DistrictLayout';
import { ProceduralMaterialSet } from './ProceduralMaterials';
import { clamp, distToPolyline2D, lerp, mulberry32, smoothstep } from '../utils/math';

export interface TerrainAndRoadsResult {
  group: THREE.Group;
  colliders: ColliderBox[];
  dispose(): void;
}

const CURB_WIDTH = 0.22;
const CURB_HEIGHT = 0.16;
const CURB_SKIRT = -0.12;
const SIDEWALK_HEIGHT = 0.14;
const SIDEWALK_SKIRT = -0.14;
const ROAD_SURFACE_OFFSET = 0.032;
const CROSSWALK_OFFSET = 0.038;

const NS_ROADS_X = [-115, 0, 115] as const;
const EW_ROADS_Z = [-145, -85, -28, 24, 72, 118] as const;

function terrainNoise2D(x: number, z: number): number {
  return (
    0.5 +
    0.25 * Math.sin(x * 0.061 + z * 0.043) +
    0.15 * Math.cos(x * 0.117 - z * 0.095) +
    0.1 * Math.sin(x * 0.23 + z * 0.19)
  );
}

export function shanhaiguanCenterZ(x: number): number {
  const seg = ROAD_SEGMENTS.find((r) => r.id === 'shanhaiguan');
  if (!seg) return 118;
  const pts = seg.waypoints;
  if (x <= pts[0].x) return pts[0].z;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x <= b.x) {
      const t = (x - a.x) / Math.max(1e-6, b.x - a.x);
      return lerp(a.z, b.z, t);
    }
  }
  return pts[pts.length - 1].z;
}

export function seawallZ(x: number): number {
  return shanhaiguanCenterZ(x) + 9.2;
}

function mergeSafe(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;

  const hasMixedIndex = geometries.some(
    (g) => (g.index !== null) !== (geometries[0].index !== null),
  );
  const prepared = hasMixedIndex
    ? geometries.map((g) => (g.index !== null ? g.toNonIndexed() : g))
    : geometries;

  const merged = mergeGeometries(prepared, false);

  for (const g of geometries) {
    g.dispose();
  }
  if (hasMixedIndex) {
    for (const g of prepared) {
      g.dispose();
    }
  }

  return merged;
}

function computeTerrainNormal(x: number, z: number): THREE.Vector3 {
  const eps = 0.5;
  const hL = getGroundHeight(x - eps, z);
  const hR = getGroundHeight(x + eps, z);
  const hD = getGroundHeight(x, z - eps);
  const hU = getGroundHeight(x, z + eps);
  return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
}

function beachWestEdgeX(z: number): number {
  return -49.0 + 2.6 * Math.sin(z * 0.13) + 1.3 * Math.cos(z * 0.27);
}

function beachEastEdgeX(z: number): number {
  return 163.0 + 2.4 * Math.sin(z * 0.12) - 1.2 * Math.cos(z * 0.25);
}

function buildTerrainMesh(materials: ProceduralMaterialSet): {
  mesh: THREE.Mesh;
  localMaterial: THREE.MeshStandardMaterial;
} {
  const minX = -280;
  const maxX = 280;
  const minZ = -260;
  const maxZ = 230;
  const segX = 224;
  const segZ = 196;

  const cols = segX + 1;
  const rows = segZ + 1;
  const vertexCount = cols * rows;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);

  const cShallowSand = new THREE.Color(0xb29d74);
  const cDeepSeabed = new THREE.Color(0x546869);
  const cDrySand = new THREE.Color(0xd2bb90);
  const cWetSand = new THREE.Color(0xb89f74);
  const cGranite = new THREE.Color(0x8d8579);
  const cDarkCliff = new THREE.Color(0x6c665e);
  const cAutumnOlive = new THREE.Color(0x697a44);
  const cSunlitMeadow = new THREE.Color(0x7d884b);
  const cLeafMulch = new THREE.Color(0x8a7447);
  const tmpColor = new THREE.Color();
  const sandColor = new THREE.Color();

  const huanghaiCenterline = sampleHuanghaiFromParam(0, 1.0);

  for (let rz = 0; rz < rows; rz++) {
    const vz = rz / segZ;
    const z = lerp(minZ, maxZ, vz);
    for (let cx = 0; cx < cols; cx++) {
      const ux = cx / segX;
      const x = lerp(minX, maxX, ux);
      const vIdx = rz * cols + cx;

      let y = getGroundHeight(x, z);
      const n = computeTerrainNormal(x, z);

      // Depress terrain inside road carriageways (-0.095m, feathered beneath the raised curb/sidewalk footprint)
      // and under SecondBeachSandShelf (-0.035m, feathered at boundaries) so coarse terrain triangles
      // never poke through asphalt or sand, even across convex Huashi Cape bends.
      let minRoadDist = Infinity;
      let roadDepress = 0;
      for (const road of ROAD_SEGMENTS) {
        const pts =
          road.id === 'huanghai' && huanghaiCenterline.length >= 2
            ? huanghaiCenterline
            : road.waypoints;
        const d = distToPolyline2D(x, z, pts);
        if (d < minRoadDist) minRoadDist = d;
        const halfW = road.width * 0.5;
        if (d < halfW + 2.05) {
          const w = 1 - smoothstep(halfW + 0.75, halfW + 2.05, d);
          if (w > roadDepress) roadDepress = w;
        }
      }

      const westEdge = beachWestEdgeX(z);
      const eastEdge = beachEastEdgeX(z);
      let beachDepress = 0;
      if (x >= westEdge - 0.5 && x <= eastEdge + 0.5) {
        const zBeachStart = seawallZ(x) + 0.35;
        const zBeachEnd = WORLD_BOUNDS.waterLineZ(x) + 3.5;
        if (z >= zBeachStart - 2.0 && z <= zBeachEnd + 2.0) {
          const wx =
            smoothstep(westEdge - 0.5, westEdge + 3.2, x) *
            (1 - smoothstep(eastEdge - 3.2, eastEdge + 0.5, x));
          const wz =
            smoothstep(zBeachStart - 1.5, zBeachStart + 0.5, z) *
            (1 - smoothstep(zBeachEnd - 1.5, zBeachEnd + 1.5, z));
          beachDepress = wx * wz;
        }
      }

      let stairDepress = 0;
      if (x >= -4.0 && x <= 4.0 && z >= 125.2 && z <= 136.0) {
        const sx = smoothstep(-4.0, -3.0, x) * (1 - smoothstep(3.0, 4.0, x));
        const sz = smoothstep(125.2, 125.8, z) * (1 - smoothstep(134.8, 136.0, z));
        stairDepress = sx * sz;
      }

      y -= Math.max(0.095 * roadDepress, 0.035 * beachDepress, 0.05 * stairDepress);

      positions[vIdx * 3] = x;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = z;

      normals[vIdx * 3] = n.x;
      normals[vIdx * 3 + 1] = n.y;
      normals[vIdx * 3 + 2] = n.z;

      uvs[vIdx * 2] = ux * 16;
      uvs[vIdx * 2 + 1] = vz * 16;

      // Biome vertex color blending
      if (y < 0) {
        const depthT = clamp(-y / 1.4, 0, 1);
        tmpColor.copy(cShallowSand).lerp(cDeepSeabed, depthT);
      } else {
        const zSeawall = seawallZ(x);
        const beachWeight =
          smoothstep(westEdge - 7.5, westEdge + 0.5, x) *
          (1 - smoothstep(eastEdge - 0.5, eastEdge + 7.5, x)) *
          smoothstep(zSeawall - 2.2, zSeawall + 0.6, z);

        const fbm = terrainNoise2D(x, z);
        tmpColor.copy(cAutumnOlive).lerp(cSunlitMeadow, smoothstep(0.25, 0.85, fbm));

        // Warm autumn leaf-mulch earth near road corridors
        const edgeMulch = 1 - smoothstep(6.5, 13.5, minRoadDist);
        if (edgeMulch > 0) {
          tmpColor.lerp(cLeafMulch, edgeMulch * 0.45);
        }

        // Huashi granite headland & steep cliff slopes
        const isCapeRock = x < -48 && z > 115;
        const cliffSlope = smoothstep(0.95, 0.85, n.y);
        const capeWeight = isCapeRock
          ? smoothstep(115, 136, z) * smoothstep(-48, -74, x)
          : 0;
        const rockWeight = Math.max(cliffSlope, capeWeight * (0.65 + 0.35 * (1 - fbm)));
        if (rockWeight > 0) {
          const cliffTone = cGranite.clone().lerp(cDarkCliff, cliffSlope * 0.8);
          tmpColor.lerp(cliffTone, clamp(rockWeight, 0, 1));
        }

        if (beachWeight > 0) {
          const wetT = smoothstep(0.0, 0.28, y);
          sandColor.copy(cWetSand).lerp(cDrySand, wetT);
          tmpColor.lerp(sandColor, clamp(beachWeight, 0, 1));
        }
      }

      colors[vIdx * 3] = tmpColor.r;
      colors[vIdx * 3 + 1] = tmpColor.g;
      colors[vIdx * 3 + 2] = tmpColor.b;
    }
  }

  const indices: number[] = [];
  for (let rz = 0; rz < segZ; rz++) {
    for (let cx = 0; cx < segX; cx++) {
      const a = rz * cols + cx;
      const b = a + 1;
      const c = (rz + 1) * cols + cx;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const localMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.0,
    bumpMap: materials.stuccoBase.bumpMap,
    bumpScale: 0.02,
  });

  const mesh = new THREE.Mesh(geo, localMaterial);
  mesh.name = 'BadaguanTerrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return { mesh, localMaterial };
}

function buildBeachSandShelf(materials: ProceduralMaterialSet): THREE.Mesh {
  const minX = -56;
  const maxX = 172;
  const segX = 114;
  const segZ = 28;
  const cols = segX + 1;
  const rows = segZ + 1;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let rz = 0; rz < rows; rz++) {
    const tz = rz / segZ;
    for (let cx = 0; cx < cols; cx++) {
      const tx = cx / segX;
      const x = lerp(minX, maxX, tx);
      const zStart = seawallZ(x) + 0.35;
      const zEnd = WORLD_BOUNDS.waterLineZ(x) + 3.5;
      const z = lerp(zStart, zEnd, tz);
      const westEdge = beachWestEdgeX(z);
      const eastEdge = beachEastEdgeX(z);
      const feather =
        smoothstep(westEdge - 3.5, westEdge + 2.5, x) *
        (1 - smoothstep(eastEdge - 2.5, eastEdge + 3.5, x));
      const y = getGroundHeight(x, z) + lerp(-0.075, 0.015, feather);
      const n = computeTerrainNormal(x, z);

      positions.push(x, y, z);
      normals.push(n.x, n.y, n.z);
      uvs.push(x / 3.0, z / 3.0);
    }
  }

  for (let rz = 0; rz < segZ; rz++) {
    for (let cx = 0; cx < segX; cx++) {
      const a = rz * cols + cx;
      const b = a + 1;
      const c = (rz + 1) * cols + cx;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mesh = new THREE.Mesh(geo, materials.beachSand);
  mesh.name = 'SecondBeachSandShelf';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function buildWorldUVGridPatch(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  subX: number,
  subZ: number,
  yOffset: number,
  uvScale: number,
): THREE.BufferGeometry {
  const cols = subX + 1;
  const rows = subZ + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let rz = 0; rz < rows; rz++) {
    const z = lerp(minZ, maxZ, rz / subZ);
    for (let cx = 0; cx < cols; cx++) {
      const x = lerp(minX, maxX, cx / subX);
      const y = getGroundHeight(x, z) + yOffset;
      const n = computeTerrainNormal(x, z);
      positions.push(x, y, z);
      normals.push(n.x, n.y, n.z);
      uvs.push(x * uvScale, z * uvScale);
    }
  }

  for (let rz = 0; rz < subZ; rz++) {
    for (let cx = 0; cx < subX; cx++) {
      const a = rz * cols + cx;
      const b = a + 1;
      const c = (rz + 1) * cols + cx;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function samplePolylineSpan(
  waypoints: readonly { x: number; z: number }[],
  stepSize = 3.0,
): { x: number; z: number; tx: number; tz: number }[] {
  const out: { x: number; z: number; tx: number; tz: number }[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const tx = dx / len;
    const tz = dz / len;
    const steps = Math.max(1, Math.ceil(len / stepSize));
    const startIdx = i === 0 ? 0 : 1;
    for (let s = startIdx; s <= steps; s++) {
      const t = s / steps;
      out.push({
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
        tx,
        tz,
      });
    }
  }
  return out;
}

function buildFlatRibbonFromSamples(
  samples: { x: number; z: number; tx: number; tz: number }[],
  offsetLeft: number,
  offsetRight: number,
  yOffset: number,
  uvScale: number,
  transverseSegs = 6,
): THREE.BufferGeometry | null {
  if (samples.length < 2) return null;
  const cols = transverseSegs + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    // Right perpendicular of (tx, tz) in XZ plane
    const nx = -p.tz;
    const nz = p.tx;

    for (let c = 0; c < cols; c++) {
      const off = lerp(offsetLeft, offsetRight, c / transverseSegs);
      const px = p.x + nx * off;
      const pz = p.z + nz * off;
      const py = getGroundHeight(px, pz) + yOffset;
      const pn = computeTerrainNormal(px, pz);

      positions.push(px, py, pz);
      normals.push(pn.x, pn.y, pn.z);
      uvs.push(px * uvScale, pz * uvScale);
    }
  }

  // Ensure upward (+Y) winding regardless of offset ordering
  const reverseWinding = offsetLeft < offsetRight;
  for (let i = 0; i < samples.length - 1; i++) {
    for (let c = 0; c < transverseSegs; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const cIdx = (i + 1) * cols + c;
      const d = cIdx + 1;
      if (reverseWinding) {
        indices.push(a, b, cIdx, b, d, cIdx);
      } else {
        indices.push(a, cIdx, b, b, cIdx, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildTerrainConformingQuadPatch(
  topLeft: { x: number; z: number },
  topRight: { x: number; z: number },
  botLeft: { x: number; z: number },
  botRight: { x: number; z: number },
  subCols: number,
  subRows: number,
  yOffset: number,
  uvScale: number,
): THREE.BufferGeometry {
  const cols = subCols + 1;
  const rows = subRows + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < rows; r++) {
    const v = r / subRows;
    const lx = lerp(topLeft.x, botLeft.x, v);
    const lz = lerp(topLeft.z, botLeft.z, v);
    const rx = lerp(topRight.x, botRight.x, v);
    const rz = lerp(topRight.z, botRight.z, v);
    for (let c = 0; c < cols; c++) {
      const u = c / subCols;
      const x = lerp(lx, rx, u);
      const z = lerp(lz, rz, u);
      const y = getGroundHeight(x, z) + yOffset;
      const n = computeTerrainNormal(x, z);
      positions.push(x, y, z);
      normals.push(n.x, n.y, n.z);
      uvs.push(x * uvScale, z * uvScale);
    }
  }

  const pushOrientedTri = (i0: number, i1: number, i2: number): void => {
    const ax = positions[i0 * 3];
    const az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3];
    const bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3];
    const cz = positions[i2 * 3 + 2];
    const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (crossY >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  };

  for (let r = 0; r < subRows; r++) {
    for (let c = 0; c < subCols; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const cIdx = (r + 1) * cols + c;
      const d = cIdx + 1;
      pushOrientedTri(a, cIdx, b);
      pushOrientedTri(b, cIdx, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function clipOffsetPointToX(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  clipX?: { minX?: number; maxX?: number },
): { x: number; z: number } {
  if (!clipX || Math.abs(tx) < 1e-6) return { x: px, z: pz };
  if (clipX.maxX !== undefined && px > clipX.maxX) {
    return { x: clipX.maxX, z: pz + (clipX.maxX - px) * (tz / tx) };
  }
  if (clipX.minX !== undefined && px < clipX.minX) {
    return { x: clipX.minX, z: pz + (clipX.minX - px) * (tz / tx) };
  }
  return { x: px, z: pz };
}

function buildCurbRibbonFromSamples(
  samples: { x: number; z: number; tx: number; tz: number }[],
  innerOffset: number,
  outerOffset: number,
  clipX?: { minX?: number; maxX?: number },
): THREE.BufferGeometry | null {
  if (samples.length < 2) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Cross-section along each station:
  // 0: inner bottom (y + 0.00), 1: inner top (y + CURB_HEIGHT),
  // 2: outer top (y + CURB_HEIGHT), 3: outer skirt (y + CURB_SKIRT)
  const sign = outerOffset >= innerOffset ? 1 : -1;
  let accumLen = 0;

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (i > 0) {
      accumLen += Math.hypot(p.x - samples[i - 1].x, p.z - samples[i - 1].z);
    }
    const nx = -p.tz;
    const nz = p.tx;

    const innerPt = clipOffsetPointToX(
      p.x + nx * innerOffset,
      p.z + nz * innerOffset,
      p.tx,
      p.tz,
      clipX,
    );
    const ix = innerPt.x;
    const iz = innerPt.z;
    const iy = getGroundHeight(ix, iz);

    const outerPt = clipOffsetPointToX(
      p.x + nx * outerOffset,
      p.z + nz * outerOffset,
      p.tx,
      p.tz,
      clipX,
    );
    const ox = outerPt.x;
    const oz = outerPt.z;
    const oy = getGroundHeight(ox, oz);

    positions.push(
      ix,
      iy + 0.01,
      iz,
      ix,
      iy + CURB_HEIGHT,
      iz,
      ox,
      oy + CURB_HEIGHT,
      oz,
      ox,
      oy + CURB_SKIRT,
      oz,
    );

    const u = accumLen * 0.5;
    uvs.push(u, 0.0, u, 0.35, u, 0.65, u, 1.0);
  }

  for (let i = 0; i < samples.length - 1; i++) {
    const base = i * 4;
    const next = base + 4;
    for (let f = 0; f < 3; f++) {
      const a = base + f;
      const b = base + f + 1;
      const c = next + f;
      const d = next + f + 1;
      if (sign > 0) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  const nonIndexed = geo.toNonIndexed();
  geo.dispose();
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function buildSidewalkRibbonFromSamples(
  samples: { x: number; z: number; tx: number; tz: number }[],
  innerOffset: number,
  outerOffset: number,
  uvScale = 0.5,
  clipX?: { minX?: number; maxX?: number },
): THREE.BufferGeometry | null {
  if (samples.length < 2) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const sign = outerOffset >= innerOffset ? 1 : -1;

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const nx = -p.tz;
    const nz = p.tx;

    const innerPt = clipOffsetPointToX(
      p.x + nx * innerOffset,
      p.z + nz * innerOffset,
      p.tx,
      p.tz,
      clipX,
    );
    const ix = innerPt.x;
    const iz = innerPt.z;
    const iy = getGroundHeight(ix, iz);

    const outerPt = clipOffsetPointToX(
      p.x + nx * outerOffset,
      p.z + nz * outerOffset,
      p.tx,
      p.tz,
      clipX,
    );
    const ox = outerPt.x;
    const oz = outerPt.z;
    const oy = getGroundHeight(ox, oz);

    // 0: inner top, 1: outer top, 2: outer buried skirt
    positions.push(
      ix,
      iy + SIDEWALK_HEIGHT,
      iz,
      ox,
      oy + SIDEWALK_HEIGHT,
      oz,
      ox,
      oy + SIDEWALK_SKIRT,
      oz,
    );

    uvs.push(
      ix * uvScale,
      iz * uvScale,
      ox * uvScale,
      oz * uvScale,
      ox * uvScale,
      oz * uvScale + 0.25,
    );
  }

  for (let i = 0; i < samples.length - 1; i++) {
    const base = i * 3;
    const next = base + 3;
    for (let f = 0; f < 2; f++) {
      const a = base + f;
      const b = base + f + 1;
      const c = next + f;
      const d = next + f + 1;
      if (sign > 0) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  const nonIndexed = geo.toNonIndexed();
  geo.dispose();
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function buildEndCapCurb(
  cx: number,
  cz: number,
  tx: number,
  tz: number,
  halfSpan: number,
): THREE.BufferGeometry | null {
  const nx = -tz;
  const nz = tx;
  const samples = [
    { x: cx - nx * halfSpan, z: cz - nz * halfSpan, tx: nx, tz: nz },
    { x: cx + nx * halfSpan, z: cz + nz * halfSpan, tx: nx, tz: nz },
  ];
  return buildCurbRibbonFromSamples(samples, 0, -CURB_WIDTH);
}

function sampleSubPolylineBetween(
  waypoints: readonly { x: number; z: number }[],
  xStart: number,
  xEnd: number,
  stepSize = 3.0,
): { x: number; z: number; tx: number; tz: number }[] {
  const pts: { x: number; z: number }[] = [];
  const startZ = shanhaiguanCenterZ(xStart);
  pts.push({ x: xStart, z: startZ });
  for (const wp of waypoints) {
    if (wp.x > xStart + 1e-4 && wp.x < xEnd - 1e-4) {
      pts.push({ x: wp.x, z: wp.z });
    }
  }
  const endZ = shanhaiguanCenterZ(xEnd);
  pts.push({ x: xEnd, z: endZ });
  return samplePolylineSpan(pts, stepSize);
}

function sampleStraightAxis(
  fixedCoord: number,
  isVertical: boolean,
  start: number,
  end: number,
  stepSize = 3.0,
): { x: number; z: number; tx: number; tz: number }[] {
  const len = Math.abs(end - start);
  const steps = Math.max(1, Math.ceil(len / stepSize));
  const out: { x: number; z: number; tx: number; tz: number }[] = [];
  const dir = end >= start ? 1 : -1;
  for (let i = 0; i <= steps; i++) {
    const c = lerp(start, end, i / steps);
    out.push(
      isVertical
        ? { x: fixedCoord, z: c, tx: 0, tz: dir }
        : { x: c, z: fixedCoord, tx: dir, tz: 0 },
    );
  }
  return out;
}

function sampleHuanghaiFromParam(
  startDist: number,
  stepSize = 1.5,
): { x: number; z: number; tx: number; tz: number }[] {
  const seg = ROAD_SEGMENTS.find((r) => r.id === 'huanghai');
  if (!seg || seg.waypoints.length < 2) return [];
  const pts = seg.waypoints;

  // Build C^1 corner-filleted curve (straight segments + quadratic Bezier corners)
  // so inner curve offsets never self-intersect or fold backward at polyline bends.
  const dense: { x: number; z: number; tx: number; tz: number; s: number }[] = [];
  let accumS = 0;

  const pushPoint = (x: number, z: number, tx: number, tz: number): void => {
    if (dense.length > 0) {
      const prev = dense[dense.length - 1];
      const d = Math.hypot(x - prev.x, z - prev.z);
      if (d < 1e-5) return;
      accumS += d;
    }
    dense.push({ x, z, tx, tz, s: accumS });
  };

  const pushStraight = (ax: number, az: number, bx: number, bz: number): void => {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    const tx = dx / len;
    const tz = dz / len;
    const steps = Math.max(1, Math.ceil(len / 1.0));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      pushPoint(lerp(ax, bx, t), lerp(az, bz, t), tx, tz);
    }
  };

  let prevEnd = { x: pts[0].x, z: pts[0].z };
  for (let i = 1; i < pts.length - 1; i++) {
    const pPrev = pts[i - 1];
    const pCurr = pts[i];
    const pNext = pts[i + 1];
    const dPrev = Math.hypot(pCurr.x - pPrev.x, pCurr.z - pPrev.z);
    const dNext = Math.hypot(pNext.x - pCurr.x, pNext.z - pCurr.z);
    const fillet = Math.min(6.0, 0.35 * dPrev, 0.35 * dNext);

    const uPrevX = (pCurr.x - pPrev.x) / Math.max(1e-6, dPrev);
    const uPrevZ = (pCurr.z - pPrev.z) / Math.max(1e-6, dPrev);
    const uNextX = (pNext.x - pCurr.x) / Math.max(1e-6, dNext);
    const uNextZ = (pNext.z - pCurr.z) / Math.max(1e-6, dNext);

    const qIn = { x: pCurr.x - uPrevX * fillet, z: pCurr.z - uPrevZ * fillet };
    const qOut = { x: pCurr.x + uNextX * fillet, z: pCurr.z + uNextZ * fillet };

    pushStraight(prevEnd.x, prevEnd.z, qIn.x, qIn.z);

    const bezSteps = 16;
    for (let k = 1; k <= bezSteps; k++) {
      const t = k / bezSteps;
      const mt = 1 - t;
      const x = mt * mt * qIn.x + 2 * mt * t * pCurr.x + t * t * qOut.x;
      const z = mt * mt * qIn.z + 2 * mt * t * pCurr.z + t * t * qOut.z;
      const dxdt = 2 * mt * (pCurr.x - qIn.x) + 2 * t * (qOut.x - pCurr.x);
      const dzdt = 2 * mt * (pCurr.z - qIn.z) + 2 * t * (qOut.z - pCurr.z);
      const dLen = Math.max(1e-6, Math.hypot(dxdt, dzdt));
      pushPoint(x, z, dxdt / dLen, dzdt / dLen);
    }

    prevEnd = qOut;
  }
  pushStraight(prevEnd.x, prevEnd.z, pts[pts.length - 1].x, pts[pts.length - 1].z);

  if (dense.length < 2) return [];
  const totalLen = dense[dense.length - 1].s;
  const clampedStart = clamp(startDist, 0, Math.max(0, totalLen - 0.5));
  const samples: { x: number; z: number; tx: number; tz: number }[] = [];
  const count = Math.max(2, Math.ceil((totalLen - clampedStart) / stepSize));

  let idx = 0;
  for (let k = 0; k <= count; k++) {
    const targetS = lerp(clampedStart, totalLen, k / count);
    while (idx < dense.length - 2 && dense[idx + 1].s < targetS) {
      idx++;
    }
    const a = dense[idx];
    const b = dense[idx + 1];
    const span = Math.max(1e-6, b.s - a.s);
    const t = clamp((targetS - a.s) / span, 0, 1);
    const tx = lerp(a.tx, b.tx, t);
    const tz = lerp(a.tz, b.tz, t);
    const tLen = Math.max(1e-6, Math.hypot(tx, tz));
    samples.push({
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      tx: tx / tLen,
      tz: tz / tLen,
    });
  }
  return samples;
}

function buildCrosswalks(): THREE.BufferGeometry | null {
  const stripes: THREE.BufferGeometry[] = [];
  const stripeWidth = 0.45;
  const stripeLen = 2.4;
  const stripeOffsets = [-3.25, -1.95, -0.65, 0.65, 1.95, 3.25];

  for (const ix of NS_ROADS_X) {
    for (const iz of EW_ROADS_Z) {
      const hasNorth = iz > -145;
      const hasSouth = iz < 118;
      const hasWest = ix > -175;
      const hasEast = ix < 175;

      if (hasNorth) {
        for (const ox of stripeOffsets) {
          stripes.push(
            buildWorldUVGridPatch(
              ix + ox - stripeWidth * 0.5,
              ix + ox + stripeWidth * 0.5,
              iz - 5.0 - 1.4 - stripeLen,
              iz - 5.0 - 1.4,
              1,
              2,
              CROSSWALK_OFFSET,
              0.5,
            ),
          );
        }
      }
      if (hasSouth) {
        for (const ox of stripeOffsets) {
          stripes.push(
            buildWorldUVGridPatch(
              ix + ox - stripeWidth * 0.5,
              ix + ox + stripeWidth * 0.5,
              iz + 5.0 + 1.4,
              iz + 5.0 + 1.4 + stripeLen,
              1,
              2,
              CROSSWALK_OFFSET,
              0.5,
            ),
          );
        }
      }
      if (hasWest) {
        for (const oz of stripeOffsets) {
          stripes.push(
            buildWorldUVGridPatch(
              ix - 5.0 - 1.4 - stripeLen,
              ix - 5.0 - 1.4,
              iz + oz - stripeWidth * 0.5,
              iz + oz + stripeWidth * 0.5,
              2,
              1,
              CROSSWALK_OFFSET,
              0.5,
            ),
          );
        }
      }
      if (hasEast) {
        for (const oz of stripeOffsets) {
          stripes.push(
            buildWorldUVGridPatch(
              ix + 5.0 + 1.4,
              ix + 5.0 + 1.4 + stripeLen,
              iz + oz - stripeWidth * 0.5,
              iz + oz + stripeWidth * 0.5,
              2,
              1,
              CROSSWALK_OFFSET,
              0.5,
            ),
          );
        }
      }
    }
  }

  return mergeSafe(stripes);
}

function buildRoadNetwork(materials: ProceduralMaterialSet): {
  meshes: THREE.Mesh[];
} {
  const asphaltParts: THREE.BufferGeometry[] = [];
  const curbParts: THREE.BufferGeometry[] = [];
  const sidewalkParts: THREE.BufferGeometry[] = [];

  const halfW = 5.0;
  const curbOuter = halfW + CURB_WIDTH;
  const walkOuter = curbOuter + 2.5; // 7.72m

  // 1. Intersection plazas (18 orthogonal crossings)
  for (const ix of NS_ROADS_X) {
    for (const iz of EW_ROADS_Z) {
      asphaltParts.push(
        buildWorldUVGridPatch(
          ix - halfW,
          ix + halfW,
          iz - halfW,
          iz + halfW,
          6,
          6,
          ROAD_SURFACE_OFFSET,
          0.25,
        ),
      );
    }
  }

  // 2. N-S Road Arms (carriageways + curbs + sidewalks + corner curb caps)
  const nsIntervals: [number, number][] = [
    [-140, -90],
    [-80, -33],
    [-23, 19],
    [29, 67],
    [77, 113],
  ];

  for (const ix of NS_ROADS_X) {
    for (const [z0, z1] of nsIntervals) {
      const samples = sampleStraightAxis(ix, true, z0, z1, 3.0);
      const roadGeo = buildFlatRibbonFromSamples(
        samples,
        -halfW,
        halfW,
        ROAD_SURFACE_OFFSET,
        0.25,
      );
      if (roadGeo) asphaltParts.push(roadGeo);

      for (const side of [-1, 1] as const) {
        const curbGeo = buildCurbRibbonFromSamples(samples, side * halfW, side * curbOuter);
        if (curbGeo) curbParts.push(curbGeo);

        const walkGeo = buildSidewalkRibbonFromSamples(
          samples,
          side * curbOuter,
          side * walkOuter,
        );
        if (walkGeo) sidewalkParts.push(walkGeo);
      }

      // Corner transverse curb caps at z0 and z1 so raised curbs return cleanly around corners
      for (const zCap of [z0, z1]) {
        const dir = zCap === z0 ? 1 : -1;
        for (const side of [-1, 1] as const) {
          const capSamples = [
            { x: ix + side * halfW, z: zCap, tx: side, tz: 0 },
            { x: ix + side * walkOuter, z: zCap, tx: side, tz: 0 },
          ];
          const capGeo = buildCurbRibbonFromSamples(
            capSamples,
            0,
            dir * side * CURB_WIDTH,
          );
          if (capGeo) curbParts.push(capGeo);
        }
      }
    }
  }

  // 3. E-W Straight Roads (Wushengguan..Juyongguan)
  const ewCarriagewayIntervals: [number, number][] = [
    [-175, -120],
    [-110, -5],
    [5, 110],
    [120, 175],
  ];
  const ewSidewalkIntervals: [number, number][] = [
    [-175, -122.72],
    [-107.28, -7.72],
    [7.72, 107.28],
    [122.72, 175],
  ];

  for (const iz of EW_ROADS_Z) {
    if (iz === 118) continue; // Shanhaiguan handled below due to gentle coastal curvature
    for (const [x0, x1] of ewCarriagewayIntervals) {
      const samples = sampleStraightAxis(iz, false, x0, x1, 3.0);
      const roadGeo = buildFlatRibbonFromSamples(
        samples,
        -halfW,
        halfW,
        ROAD_SURFACE_OFFSET,
        0.25,
      );
      if (roadGeo) asphaltParts.push(roadGeo);
    }

    // North side (-Z, left when heading +X) vs South side (+Z, right when heading +X)
    const northIntervals: [number, number][] =
      iz === -145 ? [[-175, 175]] : ewSidewalkIntervals;
    const southIntervals = ewSidewalkIntervals;

    for (const [x0, x1] of northIntervals) {
      const samples = sampleStraightAxis(iz, false, x0, x1, 3.0);
      const curbGeo = buildCurbRibbonFromSamples(samples, -halfW, -curbOuter);
      if (curbGeo) curbParts.push(curbGeo);
      const walkGeo = buildSidewalkRibbonFromSamples(samples, -curbOuter, -walkOuter);
      if (walkGeo) sidewalkParts.push(walkGeo);
    }
    for (const [x0, x1] of southIntervals) {
      const samples = sampleStraightAxis(iz, false, x0, x1, 3.0);
      const curbGeo = buildCurbRibbonFromSamples(samples, halfW, curbOuter);
      if (curbGeo) curbParts.push(curbGeo);
      const walkGeo = buildSidewalkRibbonFromSamples(samples, curbOuter, walkOuter);
      if (walkGeo) sidewalkParts.push(walkGeo);
    }

    // West/East dead-end road caps at x = +-175
    const wCap = buildEndCapCurb(-175, iz, -1, 0, halfW);
    if (wCap) curbParts.push(wCap);
    const eCap = buildEndCapCurb(175, iz, 1, 0, halfW);
    if (eCap) curbParts.push(eCap);
  }

  // 4. Shanhaiguan Rd (curved coastal boulevard)
  const shanhaiguan = ROAD_SEGMENTS.find((r) => r.id === 'shanhaiguan')!;

  // West angled arm [-175, -123.5] + non-overlapping bridge to (-115, 118) plaza at x = -120
  const shWestSamples = sampleSubPolylineBetween(shanhaiguan.waypoints, -175, -123.5, 3.0);
  const shWestGeo = buildFlatRibbonFromSamples(
    shWestSamples,
    -halfW,
    halfW,
    ROAD_SURFACE_OFFSET,
    0.25,
  );
  if (shWestGeo) asphaltParts.push(shWestGeo);

  const shWestEnd = shWestSamples[shWestSamples.length - 1];
  const shWestEndNx = -shWestEnd.tz;
  const shWestEndNz = shWestEnd.tx;
  const shWestTopL = { x: shWestEnd.x - halfW * shWestEndNx, z: shWestEnd.z - halfW * shWestEndNz };
  const shWestBotL = { x: shWestEnd.x + halfW * shWestEndNx, z: shWestEnd.z + halfW * shWestEndNz };
  asphaltParts.push(
    buildTerrainConformingQuadPatch(
      shWestTopL,
      { x: -120.0, z: 113.0 },
      shWestBotL,
      { x: -120.0, z: 123.0 },
      4,
      6,
      ROAD_SURFACE_OFFSET,
      0.25,
    ),
  );

  // Straight central arms [-110, -5] and [5, 110]
  for (const [x0, x1] of [
    [-110, -5],
    [5, 110],
  ] as [number, number][]) {
    const samples = sampleSubPolylineBetween(shanhaiguan.waypoints, x0, x1, 3.0);
    const roadGeo = buildFlatRibbonFromSamples(
      samples,
      -halfW,
      halfW,
      ROAD_SURFACE_OFFSET,
      0.25,
    );
    if (roadGeo) asphaltParts.push(roadGeo);
  }

  // East angled arm [120.75, 175] + non-overlapping bridge from (115, 118) plaza at x = 120
  const shEastSamples = sampleSubPolylineBetween(shanhaiguan.waypoints, 120.75, 175, 3.0);
  const shEastStart = shEastSamples[0];
  const shEastStartNx = -shEastStart.tz;
  const shEastStartNz = shEastStart.tx;
  const shEastTopR = {
    x: shEastStart.x - halfW * shEastStartNx,
    z: shEastStart.z - halfW * shEastStartNz,
  };
  const shEastBotR = {
    x: shEastStart.x + halfW * shEastStartNx,
    z: shEastStart.z + halfW * shEastStartNz,
  };
  asphaltParts.push(
    buildTerrainConformingQuadPatch(
      { x: 120.0, z: 113.0 },
      shEastTopR,
      { x: 120.0, z: 123.0 },
      shEastBotR,
      4,
      6,
      ROAD_SURFACE_OFFSET,
      0.25,
    ),
  );

  const shEastGeo = buildFlatRibbonFromSamples(
    shEastSamples,
    -halfW,
    halfW,
    ROAD_SURFACE_OFFSET,
    0.25,
  );
  if (shEastGeo) asphaltParts.push(shEastGeo);

  // Shanhaiguan North sidewalks (interrupted by N-S roads; miter-clipped cleanly at x = +-122.72)
  for (const [x0, x1] of ewSidewalkIntervals) {
    const samples = sampleSubPolylineBetween(shanhaiguan.waypoints, x0, x1, 3.0);
    const clipX =
      x1 <= -122.72
        ? { maxX: -122.72 }
        : x0 >= 122.72
          ? { minX: 122.72 }
          : undefined;
    const curbGeo = buildCurbRibbonFromSamples(samples, -halfW, -curbOuter, clipX);
    if (curbGeo) curbParts.push(curbGeo);
    const walkGeo = buildSidewalkRibbonFromSamples(samples, -curbOuter, -walkOuter, 0.5, clipX);
    if (walkGeo) sidewalkParts.push(walkGeo);
  }

  // Shanhaiguan South sidewalks (interrupted only by Huanghai departure around x in [-124.5, -108.5])
  const shSouthSpans: [number, number][] = [
    [-175, -124.5],
    [-108.5, 175],
  ];
  const shSouthOuterPts: { x: number; z: number }[] = [];
  for (const [x0, x1] of shSouthSpans) {
    const samples = sampleSubPolylineBetween(shanhaiguan.waypoints, x0, x1, 3.0);
    const curbGeo = buildCurbRibbonFromSamples(samples, halfW, curbOuter);
    if (curbGeo) curbParts.push(curbGeo);
    const walkGeo = buildSidewalkRibbonFromSamples(samples, curbOuter, walkOuter);
    if (walkGeo) sidewalkParts.push(walkGeo);
    if (x0 > -110) {
      for (const p of samples) {
        shSouthOuterPts.push({
          x: p.x - p.tz * walkOuter,
          z: p.z + p.tx * walkOuter,
        });
      }
    }
  }

  // Shanhaiguan West/East end caps
  const shW = sampleSubPolylineBetween(shanhaiguan.waypoints, -175, -170, 5.0);
  if (shW.length >= 1) {
    const cap = buildEndCapCurb(-175, shW[0].z, -shW[0].tx, -shW[0].tz, halfW);
    if (cap) curbParts.push(cap);
  }
  const shE = sampleSubPolylineBetween(shanhaiguan.waypoints, 170, 175, 5.0);
  if (shE.length >= 1) {
    const last = shE[shE.length - 1];
    const cap = buildEndCapCurb(175, last.z, last.tx, last.tz, halfW);
    if (cap) curbParts.push(cap);
  }

  // 5. Huanghai Rd (curved headland road, width=8, sidewalk=2.0)
  const hhRoadSamples = sampleHuanghaiFromParam(8.6, 1.5);
  const hhRoadGeo = buildFlatRibbonFromSamples(
    hhRoadSamples,
    -4.0,
    4.0,
    ROAD_SURFACE_OFFSET,
    0.25,
  );
  if (hhRoadGeo) asphaltParts.push(hhRoadGeo);

  // Clean non-overlapping transition apron connecting Shanhaiguan west bridge & (-115, 118) plaza to Huanghai start
  if (hhRoadSamples.length >= 1) {
    const hh0 = hhRoadSamples[0];
    const hhNx = -hh0.tz;
    const hhNz = hh0.tx;
    const hhWest = { x: hh0.x + 4.0 * hhNx, z: hh0.z + 4.0 * hhNz };
    const hhEast = { x: hh0.x - 4.0 * hhNx, z: hh0.z - 4.0 * hhNz };
    const tBridge = clamp((hhWest.x - shWestBotL.x) / Math.max(1e-6, -120.0 - shWestBotL.x), 0, 1);
    const northAtWest = { x: hhWest.x, z: lerp(shWestBotL.z, 123.0, tBridge) };
    const northEastX = clamp(
      hhEast.x - (hhEast.z - 123.0) * (hh0.tx / Math.max(1e-6, hh0.tz)),
      -120.0,
      -110.0,
    );
    const uSplit = clamp((-120.0 - hhWest.x) / Math.max(1e-6, hhEast.x - hhWest.x), 0, 1);
    const hhSplit = {
      x: lerp(hhWest.x, hhEast.x, uSplit),
      z: lerp(hhWest.z, hhEast.z, uSplit),
    };
    asphaltParts.push(
      buildTerrainConformingQuadPatch(
        northAtWest,
        { x: -120.0, z: 123.0 },
        hhWest,
        hhSplit,
        3,
        4,
        ROAD_SURFACE_OFFSET,
        0.25,
      ),
    );
    asphaltParts.push(
      buildTerrainConformingQuadPatch(
        { x: -120.0, z: 123.0 },
        { x: northEastX, z: 123.0 },
        hhSplit,
        hhEast,
        3,
        4,
        ROAD_SURFACE_OFFSET,
        0.25,
      ),
    );
  }

  const hhWalkSamples = sampleHuanghaiFromParam(13.5, 1.5);
  for (const side of [-1, 1] as const) {
    const curbGeo = buildCurbRibbonFromSamples(hhWalkSamples, side * 4.0, side * 4.22);
    if (curbGeo) curbParts.push(curbGeo);
    const walkGeo = buildSidewalkRibbonFromSamples(hhWalkSamples, side * 4.22, side * 6.22);
    if (walkGeo) sidewalkParts.push(walkGeo);
  }
  if (hhRoadSamples.length >= 1) {
    const last = hhRoadSamples[hhRoadSamples.length - 1];
    const cap = buildEndCapCurb(last.x, last.z, last.tx, last.tz, 4.0);
    if (cap) curbParts.push(cap);
  }

  // 6. Seawall Promenade Cobblestone Apron (split around x in [-3, +3] Ningwuguan staircase portal)
  const sampleShSouthOuterBetweenX = (
    x0: number,
    x1: number,
  ): { x: number; z: number }[] => {
    const evalAtX = (targetX: number): number => {
      if (shSouthOuterPts.length === 0) return shanhaiguanCenterZ(targetX) + walkOuter;
      if (targetX <= shSouthOuterPts[0].x) return shSouthOuterPts[0].z;
      for (let i = 0; i < shSouthOuterPts.length - 1; i++) {
        const a = shSouthOuterPts[i];
        const b = shSouthOuterPts[i + 1];
        if (targetX <= b.x) {
          const t = (targetX - a.x) / Math.max(1e-6, b.x - a.x);
          return lerp(a.z, b.z, t);
        }
      }
      return shSouthOuterPts[shSouthOuterPts.length - 1].z;
    };
    const out: { x: number; z: number }[] = [{ x: x0, z: evalAtX(x0) }];
    for (const pt of shSouthOuterPts) {
      if (pt.x > x0 + 1e-4 && pt.x < x1 - 1e-4) {
        out.push({ x: pt.x, z: pt.z });
      }
    }
    out.push({ x: x1, z: evalAtX(x1) });
    return out;
  };

  const promSpans: [number, number][] = [
    [-55, -3.0],
    [3.0, 170],
  ];
  for (const [promX0, promX1] of promSpans) {
    const innerPts = sampleShSouthOuterBetweenX(promX0, promX1);
    const promPos: number[] = [];
    const promUvs: number[] = [];
    const promIdx: number[] = [];
    for (let i = 0; i < innerPts.length; i++) {
      const x = innerPts[i].x;
      const zInner = innerPts[i].z;
      const zOuter = seawallZ(x) + 0.1;
      const yInner = getGroundHeight(x, zInner) + SIDEWALK_HEIGHT;
      const yOuter = getGroundHeight(x, zOuter) + SIDEWALK_HEIGHT;
      promPos.push(x, yInner, zInner, x, yOuter, zOuter);
      promUvs.push(x * 0.5, zInner * 0.5, x * 0.5, zOuter * 0.5);
    }
    for (let i = 0; i < innerPts.length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      promIdx.push(a, b, c, b, d, c);
    }
    const promGeo = new THREE.BufferGeometry();
    promGeo.setAttribute('position', new THREE.Float32BufferAttribute(promPos, 3));
    promGeo.setAttribute('uv', new THREE.Float32BufferAttribute(promUvs, 2));
    promGeo.setIndex(promIdx);
    const promNonIdx = promGeo.toNonIndexed();
    promGeo.dispose();
    promNonIdx.computeVertexNormals();
    sidewalkParts.push(promNonIdx);
  }

  const meshes: THREE.Mesh[] = [];

  const mergedAsphalt = mergeSafe(asphaltParts);
  if (mergedAsphalt) {
    const asphaltMesh = new THREE.Mesh(mergedAsphalt, materials.asphalt);
    asphaltMesh.name = 'BadaguanRoadsAsphalt';
    asphaltMesh.receiveShadow = true;
    meshes.push(asphaltMesh);
  }

  const mergedCrosswalks = buildCrosswalks();
  if (mergedCrosswalks) {
    const cwMesh = new THREE.Mesh(mergedCrosswalks, materials.crosswalkPaint);
    cwMesh.name = 'BadaguanCrosswalks';
    cwMesh.receiveShadow = true;
    meshes.push(cwMesh);
  }

  const mergedCurbs = mergeSafe(curbParts);
  if (mergedCurbs) {
    const curbMesh = new THREE.Mesh(mergedCurbs, materials.curbStone);
    curbMesh.name = 'BadaguanCurbs';
    curbMesh.castShadow = true;
    curbMesh.receiveShadow = true;
    meshes.push(curbMesh);
  }

  const mergedSidewalks = mergeSafe(sidewalkParts);
  if (mergedSidewalks) {
    const walkMesh = new THREE.Mesh(mergedSidewalks, materials.cobblestone);
    walkMesh.name = 'BadaguanSidewalks';
    walkMesh.receiveShadow = true;
    meshes.push(walkMesh);
  }

  return { meshes };
}

function buildSeawallSpanGeometry(
  xStart: number,
  xEnd: number,
  thickness: number,
  isCoping: boolean,
): THREE.BufferGeometry {
  const steps = Math.max(4, Math.ceil((xEnd - xStart) / 4.0));
  const halfT = thickness * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Build top, front (+Z), back (-Z) faces as a continuous extruded prism
  const crossRings: { x: number; zBack: number; zFront: number; yBot: number; yTop: number }[] =
    [];

  for (let i = 0; i <= steps; i++) {
    const x = lerp(xStart, xEnd, i / steps);
    const sz = seawallZ(x);
    const wallTop = Math.max(getGroundHeight(x, sz) + 0.45, 2.05);
    const yBot = isCoping ? wallTop : -1.2;
    const yTop = isCoping ? wallTop + 0.14 : wallTop;
    crossRings.push({
      x,
      zBack: sz - halfT,
      zFront: sz + halfT,
      yBot,
      yTop,
    });
  }

  // Emit quads between adjacent stations for front, back, top, and bottom
  function pushQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    uv3: [number, number],
  ): void {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  for (let i = 0; i < crossRings.length - 1; i++) {
    const a = crossRings[i];
    const b = crossRings[i + 1];
    const u0 = a.x * 0.4;
    const u1 = b.x * 0.4;

    // Front (+Z facing beach)
    pushQuad(
      [a.x, a.yBot, a.zFront],
      [b.x, b.yBot, b.zFront],
      [b.x, b.yTop, b.zFront],
      [a.x, a.yTop, a.zFront],
      [u0, a.yBot * 0.4],
      [u1, b.yBot * 0.4],
      [u1, b.yTop * 0.4],
      [u0, a.yTop * 0.4],
    );

    // Back (-Z facing Shanhaiguan Rd)
    pushQuad(
      [b.x, b.yBot, b.zBack],
      [a.x, a.yBot, a.zBack],
      [a.x, a.yTop, a.zBack],
      [b.x, b.yTop, b.zBack],
      [u1, b.yBot * 0.4],
      [u0, a.yBot * 0.4],
      [u0, a.yTop * 0.4],
      [u1, b.yTop * 0.4],
    );

    // Top face (+Y)
    pushQuad(
      [a.x, a.yTop, a.zFront],
      [b.x, b.yTop, b.zFront],
      [b.x, b.yTop, b.zBack],
      [a.x, a.yTop, a.zBack],
      [u0, a.zFront * 0.4],
      [u1, b.zFront * 0.4],
      [u1, b.zBack * 0.4],
      [u0, a.zBack * 0.4],
    );
  }

  // End caps at start and end
  const first = crossRings[0];
  pushQuad(
    [first.x, first.yBot, first.zBack],
    [first.x, first.yBot, first.zFront],
    [first.x, first.yTop, first.zFront],
    [first.x, first.yTop, first.zBack],
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  );
  const last = crossRings[crossRings.length - 1];
  pushQuad(
    [last.x, last.yBot, last.zFront],
    [last.x, last.yBot, last.zBack],
    [last.x, last.yTop, last.zBack],
    [last.x, last.yTop, last.zFront],
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  const nonIndexed = geo.toNonIndexed();
  geo.dispose();
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function buildSeawallAndStairs(materials: ProceduralMaterialSet): {
  meshes: THREE.Mesh[];
  colliders: ColliderBox[];
} {
  const meshes: THREE.Mesh[] = [];
  const colliders: ColliderBox[] = [];

  const spans: [number, number][] = [
    [-55, -3.0],
    [3.0, 170],
  ];

  // 1. Seawall masonry body
  const wallGeos = spans.map(([a, b]) => buildSeawallSpanGeometry(a, b, 0.75, false));
  const mergedWall = mergeSafe(wallGeos);
  if (mergedWall) {
    const wallMesh = new THREE.Mesh(mergedWall, materials.mushroomStone);
    wallMesh.name = 'CoastalSeawall';
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    meshes.push(wallMesh);
  }

  // 2. Seawall coping + Ningwuguan staircase
  const copingParts: THREE.BufferGeometry[] = spans.map(([a, b]) =>
    buildSeawallSpanGeometry(a, b, 0.9, true),
  );

  // 10-step granite staircase at x in [-3, +3] descending from Shanhaiguan sidewalk (z=125.72) to beach sand (z=135.22)
  const stepCount = 10;
  const zStart = 125.72;
  const zEnd = 135.22;
  const yStart = getGroundHeight(0, zStart) + SIDEWALK_HEIGHT;
  const yEnd = getGroundHeight(0, zEnd) + 0.045;
  const treadDepth = (zEnd - zStart) / stepCount;

  for (let i = 0; i < stepCount; i++) {
    const tNext = (i + 1) / stepCount;
    const zStepBack = zStart + i * treadDepth;
    const zCenter = zStart + (i + 0.5) * treadDepth;
    const stepTop = Math.max(lerp(yStart, yEnd, tNext), getGroundHeight(0, zStepBack) + 0.045);
    const stepBase = -0.3;
    const h = Math.max(0.2, stepTop - stepBase);
    const box = new THREE.BoxGeometry(6.0, h, treadDepth + 0.04);
    box.translate(0, stepBase + h * 0.5, zCenter);
    copingParts.push(box);
  }

  // Stepped granite cheek walls flanking staircase
  for (const sideX of [-3.225, 3.225]) {
    for (let i = 0; i < 5; i++) {
      const z0 = lerp(zStart, zEnd, i / 5);
      const z1 = lerp(zStart, zEnd, (i + 1) / 5);
      const topY = lerp(yStart + 0.42, yEnd + 0.35, i / 5);
      const baseY = -0.4;
      const h = topY - baseY;
      const cheek = new THREE.BoxGeometry(0.45, h, z1 - z0 + 0.04);
      cheek.translate(sideX, baseY + h * 0.5, (z0 + z1) * 0.5);
      copingParts.push(cheek);
    }
  }

  const mergedCoping = mergeSafe(copingParts);
  if (mergedCoping) {
    const copingMesh = new THREE.Mesh(mergedCoping, materials.curbStone);
    copingMesh.name = 'SeawallCopingAndStairs';
    copingMesh.castShadow = true;
    copingMesh.receiveShadow = true;
    meshes.push(copingMesh);
  }

  // 3. Promenade Iron Railing
  const railParts: THREE.BufferGeometry[] = [];
  for (const [spanStart, spanEnd] of spans) {
    const postSpacing = 3.5;
    const count = Math.max(2, Math.round((spanEnd - spanStart) / postSpacing));
    const postPts: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i <= count; i++) {
      const x = lerp(spanStart + 0.25, spanEnd - 0.25, i / count);
      const z = seawallZ(x);
      const baseY = Math.max(getGroundHeight(x, z) + 0.45, 2.05) + 0.14;
      postPts.push({ x, y: baseY, z });

      const post = new THREE.CylinderGeometry(0.035, 0.045, 0.95, 8);
      post.translate(x, baseY + 0.475, z);
      railParts.push(post);
    }

    for (let i = 0; i < postPts.length - 1; i++) {
      const a = postPts[i];
      const b = postPts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      for (const railOffset of [0.46, 0.91]) {
        const rail = new THREE.CylinderGeometry(0.025, 0.025, len, 6);
        rail.applyQuaternion(quat);
        rail.translate(
          (a.x + b.x) * 0.5,
          (a.y + b.y) * 0.5 + railOffset,
          (a.z + b.z) * 0.5,
        );
        railParts.push(rail);
      }
    }
  }

  const mergedRails = mergeSafe(railParts);
  if (mergedRails) {
    const railMesh = new THREE.Mesh(mergedRails, materials.darkIron);
    railMesh.name = 'PromenadeRailing';
    railMesh.castShadow = true;
    meshes.push(railMesh);
  }

  // 4. Piecewise seawall colliders (leaving [-3.0, +3.0] staircase portal open)
  const colliderSegments: { id: string; x0: number; x1: number }[] = [
    { id: 'seawall-west-1', x0: -55.5, x1: -28 },
    { id: 'seawall-west-2', x0: -28, x1: -3.2 },
    { id: 'seawall-east-1', x0: 3.2, x1: 60 },
    { id: 'seawall-east-2', x0: 60, x1: 115 },
    { id: 'seawall-east-3', x0: 115, x1: 142 },
    { id: 'seawall-east-4', x0: 142, x1: 170.5 },
  ];

  for (const seg of colliderSegments) {
    const z0 = seawallZ(seg.x0);
    const zMid = seawallZ((seg.x0 + seg.x1) * 0.5);
    const z1 = seawallZ(seg.x1);
    colliders.push({
      id: seg.id,
      minX: seg.x0,
      maxX: seg.x1,
      minZ: Math.min(z0, zMid, z1) - 0.55,
      maxZ: Math.max(z0, zMid, z1) + 0.55,
      kind: 'wall',
    });
  }

  // 5. Piecewise southern Yellow Sea water-line colliders (2.0m slices -> <0.25m shoreline error)
  const waterSlices = 210;
  for (let i = 0; i < waterSlices; i++) {
    const x0 = lerp(-210, 210, i / waterSlices);
    const x1 = lerp(-210, 210, (i + 1) / waterSlices);
    const minShore = Math.min(
      WORLD_BOUNDS.waterLineZ(x0),
      WORLD_BOUNDS.waterLineZ((x0 + x1) * 0.5),
      WORLD_BOUNDS.waterLineZ(x1),
    );
    colliders.push({
      id: `water-line-${i}`,
      minX: x0,
      maxX: x1,
      minZ: minShore + 0.9,
      maxZ: 240,
      kind: 'water',
    });
  }

  return { meshes, colliders };
}

function buildCoastalGraniteRocks(materials: ProceduralMaterialSet): THREE.Mesh | null {
  const rng = mulberry32(20261121);
  const rockParts: THREE.BufferGeometry[] = [];
  const huashiParcel = VILLA_PARCELS.find((p) => p.id === 'huashi');
  const huashiBox = huashiParcel ? getParcelWorldAABB(huashiParcel) : null;
  const huanghaiRoad = ROAD_SEGMENTS.find((r) => r.id === 'huanghai');

  function placeBoulder(cx: number, cz: number, radius: number): void {
    const geo = new THREE.DodecahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    const seedPhase = rng() * Math.PI * 2;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const disp =
        0.82 +
        0.24 * Math.sin(vx * 3.1 + seedPhase) * Math.cos(vz * 2.7 - seedPhase) +
        0.12 * Math.sin(vy * 4.3 + vx * 2.1);
      pos.setXYZ(i, vx * disp, vy * disp * 0.72, vz * disp);
    }
    geo.computeVertexNormals();
    geo.scale(
      radius * (0.85 + rng() * 0.5),
      radius * (0.65 + rng() * 0.4),
      radius * (0.85 + rng() * 0.5),
    );
    geo.rotateY(rng() * Math.PI * 2);
    const groundY = getGroundHeight(cx, cz);
    geo.translate(cx, groundY - radius * 0.35, cz);
    rockParts.push(geo);
  }

  // Huashi Cape rocky shoreline clusters
  let placedCape = 0;
  let attempts = 0;
  while (placedCape < 42 && attempts < 220) {
    attempts++;
    const x = lerp(-158, -62, rng());
    const z = lerp(132, 198, rng());
    if (huanghaiRoad && distToPolyline2D(x, z, huanghaiRoad.waypoints) < 8.5) continue;
    if (
      huashiBox &&
      x > huashiBox.minX - 4 &&
      x < huashiBox.maxX + 4 &&
      z > huashiBox.minZ - 4 &&
      z < huashiBox.maxZ + 4
    ) {
      continue;
    }
    // Prefer rocky cape flank & shoreline edge
    const shoreDiff = WORLD_BOUNDS.waterLineZ(x) - z;
    if (shoreDiff > 24 && rng() > 0.35) continue;
    placeBoulder(x, z, 0.9 + rng() * 1.9);
    placedCape++;
  }

  // West & East reef flanks of Second Bathing Beach
  for (let i = 0; i < 14; i++) {
    const x = lerp(-58, -36, rng());
    const z = lerp(134, 174, rng());
    placeBoulder(x, z, 0.75 + rng() * 1.35);
  }
  for (let i = 0; i < 18; i++) {
    const x = lerp(138, 176, rng());
    const z = lerp(124, 172, rng());
    placeBoulder(x, z, 0.8 + rng() * 1.5);
  }

  const merged = mergeSafe(rockParts);
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, materials.graniteAshlar);
  mesh.name = 'CoastalGraniteRocks';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildTerrainAndRoads(
  materials: ProceduralMaterialSet,
): TerrainAndRoadsResult {
  const group = new THREE.Group();
  group.name = 'TerrainAndRoadsGroup';

  const terrain = buildTerrainMesh(materials);
  group.add(terrain.mesh);

  const beachShelf = buildBeachSandShelf(materials);
  group.add(beachShelf);

  const roadNet = buildRoadNetwork(materials);
  for (const m of roadNet.meshes) {
    group.add(m);
  }

  const seawall = buildSeawallAndStairs(materials);
  for (const m of seawall.meshes) {
    group.add(m);
  }

  const rocks = buildCoastalGraniteRocks(materials);
  if (rocks) {
    group.add(rocks);
  }

  function dispose(): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    terrain.localMaterial.dispose();
  }

  return {
    group,
    colliders: seawall.colliders,
    dispose,
  };
}
