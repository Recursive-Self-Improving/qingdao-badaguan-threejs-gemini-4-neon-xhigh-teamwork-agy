import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ColliderBox,
  ROAD_SEGMENTS,
  RoadSegment,
  TreeSpecies,
  VILLA_PARCELS,
  WORLD_BOUNDS,
  getGroundHeight,
  getParcelWorldAABB,
} from './DistrictLayout';
import { ProceduralMaterialSet } from './ProceduralMaterials';
import { shanhaiguanCenterZ, seawallZ } from './TerrainAndRoads';
import { clamp, distToPolyline2D, lerp, mulberry32, pointInExpandedAABB } from '../utils/math';

export interface VegetationBuildResult {
  group: THREE.Group;
  colliders: ColliderBox[];
  update(elapsedTime: number, dt: number): void;
  dispose(): void;
}

interface TreePlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scaleXZ: number;
  scaleY: number;
  species: TreeSpecies;
  inPlayableDistrict: boolean;
}

interface SpeciesVisualSpec {
  heightRange: [number, number];
  spreadRange: [number, number];
  barkTint: number;
  crownPalette: readonly number[];
}

const SPECIES_SPECS: Record<TreeSpecies, SpeciesVisualSpec> = {
  snow_cedar: {
    heightRange: [11.0, 14.0],
    spreadRange: [0.9, 1.15],
    barkTint: 0x52443b,
    crownPalette: [0x2b5a42, 0x33684c, 0x244d38, 0x397253],
  },
  crabapple: {
    heightRange: [6.4, 8.4],
    spreadRange: [0.9, 1.18],
    barkTint: 0x5c4b40,
    crownPalette: [0xd88432, 0xc76b2a, 0xe2a23b, 0xcf7a2c],
  },
  flowering_peach: {
    heightRange: [5.5, 7.5],
    spreadRange: [0.88, 1.15],
    barkTint: 0x563f35,
    crownPalette: [0x9aa642, 0xc89d3c, 0xd9843b, 0xb2a648],
  },
  black_pine: {
    heightRange: [7.0, 10.0],
    spreadRange: [0.92, 1.18],
    barkTint: 0x4b3d35,
    crownPalette: [0x275b3e, 0x2f6948, 0x224f35, 0x357450],
  },
  crape_myrtle: {
    heightRange: [5.4, 7.2],
    spreadRange: [0.88, 1.14],
    barkTint: 0x8a7564,
    crownPalette: [0xc9653b, 0xd88a38, 0xb24b36, 0xd07639],
  },
  five_point_maple: {
    heightRange: [8.0, 10.6],
    spreadRange: [0.92, 1.16],
    barkTint: 0x5a4e45,
    crownPalette: [0xc63524, 0xdc5426, 0xe57a28, 0xa8241c],
  },
  dragon_juniper: {
    heightRange: [6.5, 8.6],
    spreadRange: [0.85, 1.12],
    barkTint: 0x5c493c,
    crownPalette: [0x2e663b, 0x387746, 0x265632, 0x3f844e],
  },
  ginkgo: {
    heightRange: [9.0, 12.2],
    spreadRange: [0.9, 1.15],
    barkTint: 0x6e655a,
    crownPalette: [0xebb82e, 0xf4ca44, 0xdaa022, 0xf0c238],
  },
  french_sycamore: {
    heightRange: [10.0, 13.4],
    spreadRange: [0.92, 1.18],
    barkTint: 0x9e9381,
    crownPalette: [0xc9923c, 0xd9a74a, 0xb57a32, 0xd29c42],
  },
};

const ALL_SPECIES: readonly TreeSpecies[] = [
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

const NS_INTERSECT_X = [-115, 0, 115] as const;
const EW_INTERSECT_Z = [-145, -85, -28, 24, 72, 118] as const;

const PARCEL_AABBS = VILLA_PARCELS.map((p) => getParcelWorldAABB(p));

// Reusable scratch objects for zero-GC per-frame leaf animation
const _leafDummyPos = new THREE.Vector3();
const _leafDummyEuler = new THREE.Euler();
const _leafDummyQuat = new THREE.Quaternion();
const _leafDummyScale = new THREE.Vector3();
const _leafDummyMat = new THREE.Matrix4();

function mergeSafe(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }
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
  return merged ?? new THREE.BufferGeometry();
}

function makeWoodPart(
  rBottom: number,
  rTop: number,
  length: number,
  radialSegments: number,
  tx: number,
  ty: number,
  tz: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, length, radialSegments, 1, false);
  // Shift cylinder base to y = 0 then rotate/translate into place
  geo.translate(0, length * 0.5, 0);
  if (rx !== 0) geo.rotateX(rx);
  if (ry !== 0) geo.rotateY(ry);
  if (rz !== 0) geo.rotateZ(rz);
  geo.translate(tx, ty, tz);
  const nonIdx = geo.index !== null ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  return nonIdx;
}

function makeSculptedLobe(
  rx: number,
  ry: number,
  rz: number,
  detail: number,
  tx: number,
  ty: number,
  tz: number,
  seed: number,
  bottomShade = 0.78,
  topShade = 1.08,
): THREE.BufferGeometry {
  const segW = detail > 1 ? 14 : 11;
  const segH = detail > 1 ? 10 : 8;
  const sphere = new THREE.SphereGeometry(1, segW, segH);
  const sPos = sphere.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < sPos.count; i++) {
    const vx = sPos.getX(i);
    const vy = sPos.getY(i);
    const vz = sPos.getZ(i);
    const disp =
      1.0 +
      0.13 * Math.sin(vx * 3.7 + seed * 1.1) * Math.cos(vy * 3.1 - seed * 0.7) +
      0.08 * Math.sin(vz * 4.3 + vy * 2.9 + seed * 1.9);
    sPos.setXYZ(i, vx * rx * disp, vy * ry * disp, vz * rz * disp);
  }
  // Compute smooth normals while indexed so foliage shades organically without flat facets
  sphere.computeVertexNormals();
  const geo = sphere.toNonIndexed();
  sphere.dispose();

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i);

    pos.setXYZ(i, lx + tx, ly + ty, lz + tz);

    const verticalT = clamp((ly / Math.max(1e-4, ry) + 1) * 0.5, 0, 1);
    const radialDapple = 0.96 + 0.06 * Math.sin(lx * 1.5 + lz * 1.5 + seed);
    const shade = clamp(lerp(bottomShade, topShade, verticalT) * radialDapple, 0.65, 1.14);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade * 0.98;
  }

  geo.deleteAttribute('uv');
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function makeSculptedConeTier(
  radius: number,
  height: number,
  radialSegments: number,
  tx: number,
  ty: number,
  tz: number,
  seed: number,
  droop = 0.08,
  bottomShade = 0.72,
  topShade = 1.04,
): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(radius, height, radialSegments, 2, false);
  const geo = cone.toNonIndexed();
  cone.dispose();

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const halfH = height * 0.5;

  for (let i = 0; i < count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const rNorm = Math.hypot(vx, vz) / Math.max(1e-4, radius);
    const angle = Math.atan2(vz, vx);
    const ruffle = 1.0 + 0.14 * Math.sin(angle * 5.0 + seed) * rNorm;
    const sx = vx * ruffle;
    const sz = vz * ruffle;
    const sy = vy - droop * rNorm * rNorm * height;

    pos.setXYZ(i, sx + tx, sy + ty + halfH, sz + tz);

    const t = clamp((vy + halfH) / Math.max(1e-4, height), 0, 1);
    const shade = clamp(lerp(bottomShade, topShade, t), 0.64, 1.1);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }

  geo.deleteAttribute('uv');
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds canonical unit-height (`10.0m` reference) procedural trunk and crown templates
 * for each of the 9 Badaguan tree species. Flared roots sink to `localY = -0.60m`.
 */
function buildSpeciesGeometries(species: TreeSpecies): {
  trunkGeo: THREE.BufferGeometry;
  crownGeo: THREE.BufferGeometry;
} {
  const trunkParts: THREE.BufferGeometry[] = [];
  const crownParts: THREE.BufferGeometry[] = [];

  // Shared root flare extending down to localY = -0.60m so sloped ground never exposes roots
  trunkParts.push(makeWoodPart(0.34, 0.21, 0.95, 7, 0, -0.6, 0));

  switch (species) {
    case 'snow_cedar': {
      // Straight stately central spire + 6 drooping conical evergreen tiers
      trunkParts.push(makeWoodPart(0.21, 0.05, 9.1, 7, 0, 0.3, 0));
      const tiers = [
        { y: 2.0, r: 3.1, h: 2.3, segs: 10 },
        { y: 3.5, r: 2.65, h: 2.1, segs: 10 },
        { y: 4.9, r: 2.2, h: 1.9, segs: 9 },
        { y: 6.2, r: 1.7, h: 1.75, segs: 9 },
        { y: 7.4, r: 1.25, h: 1.6, segs: 8 },
        { y: 8.5, r: 0.78, h: 1.55, segs: 7 },
      ];
      tiers.forEach((t, idx) => {
        crownParts.push(makeSculptedConeTier(t.r, t.h, t.segs, 0, t.y, 0, 11 + idx * 3, 0.14));
      });
      break;
    }

    case 'crabapple': {
      // Vase-shaped trunk with 3 primary scaffold limbs + spreading rounded crown
      trunkParts.push(makeWoodPart(0.19, 0.13, 3.0, 7, 0, 0.3, 0));
      trunkParts.push(makeWoodPart(0.11, 0.05, 3.1, 6, 0, 2.8, 0, 0.48, 0.2, 0.35));
      trunkParts.push(makeWoodPart(0.11, 0.05, 3.0, 6, 0, 2.8, 0, -0.42, 0, -0.45));
      trunkParts.push(makeWoodPart(0.1, 0.05, 2.9, 6, 0, 2.9, 0, 0.12, 0, 0.52));
      crownParts.push(makeSculptedLobe(2.5, 1.85, 2.4, 1, 0, 6.2, 0, 21));
      crownParts.push(makeSculptedLobe(2.0, 1.65, 1.95, 1, -1.65, 5.4, 1.15, 22));
      crownParts.push(makeSculptedLobe(1.95, 1.6, 2.0, 1, 1.65, 5.5, -0.95, 23));
      crownParts.push(makeSculptedLobe(1.8, 1.55, 1.85, 1, 0.55, 6.9, 1.35, 24));
      crownParts.push(makeSculptedLobe(1.75, 1.5, 1.75, 1, -0.85, 7.1, -1.25, 25));
      break;
    }

    case 'flowering_peach': {
      // Low fork, slender spreading limbs, airy layered canopy pads
      trunkParts.push(makeWoodPart(0.18, 0.12, 2.5, 7, 0, 0.3, 0));
      trunkParts.push(makeWoodPart(0.1, 0.04, 3.3, 6, 0, 2.3, 0, 0.45, 0, 0.58));
      trunkParts.push(makeWoodPart(0.1, 0.04, 3.2, 6, 0, 2.3, 0, -0.48, 0, -0.48));
      trunkParts.push(makeWoodPart(0.09, 0.04, 3.1, 6, 0, 2.4, 0, 0.2, 0, -0.62));
      crownParts.push(makeSculptedLobe(2.25, 1.4, 2.15, 1, -1.5, 5.6, 1.1, 31));
      crownParts.push(makeSculptedLobe(2.1, 1.35, 2.2, 1, 1.4, 5.8, -1.15, 32));
      crownParts.push(makeSculptedLobe(2.0, 1.45, 1.95, 1, 1.1, 6.6, 1.25, 33));
      crownParts.push(makeSculptedLobe(2.15, 1.5, 2.05, 1, -0.3, 7.3, -0.35, 34));
      break;
    }

    case 'black_pine': {
      // Windswept coastal pine with exact joint-connected trunk & horizontal cloud pads
      const len1 = 3.6;
      const rx1 = 0.08;
      const rz1 = -0.14;
      trunkParts.push(makeWoodPart(0.22, 0.15, len1, 7, 0, 0.3, 0, rx1, 0, rz1));

      // Compute exact tip of lower trunk segment (overlap 0.12m back along axis for watertight seam)
      const tip1 = new THREE.Vector3(0, len1 - 0.12, 0).applyEuler(new THREE.Euler(rx1, 0, rz1));
      const base2x = tip1.x;
      const base2y = 0.3 + tip1.y;
      const base2z = tip1.z;
      const len2 = 3.9;
      const rx2 = -0.06;
      const rz2 = 0.22;
      trunkParts.push(makeWoodPart(0.155, 0.075, len2, 6, base2x, base2y, base2z, rx2, 0, rz2));

      // Attach horizontal scaffold limbs directly onto the upper trunk axis
      const mid2 = new THREE.Vector3(0, len2 * 0.35, 0).applyEuler(new THREE.Euler(rx2, 0, rz2));
      trunkParts.push(
        makeWoodPart(
          0.1,
          0.045,
          2.6,
          6,
          base2x + mid2.x,
          base2y + mid2.y,
          base2z + mid2.z,
          0.36,
          0,
          0.86,
        ),
      );
      const mid3 = new THREE.Vector3(0, len2 * 0.65, 0).applyEuler(new THREE.Euler(rx2, 0, rz2));
      trunkParts.push(
        makeWoodPart(
          0.095,
          0.045,
          2.5,
          6,
          base2x + mid3.x,
          base2y + mid3.y,
          base2z + mid3.z,
          -0.42,
          0,
          -0.8,
        ),
      );

      crownParts.push(makeSculptedLobe(2.45, 0.85, 2.25, 1, -1.55, 5.8, 0.95, 41, 0.76, 1.08));
      crownParts.push(makeSculptedLobe(2.35, 0.82, 2.2, 1, 1.85, 6.9, -0.65, 42, 0.76, 1.08));
      crownParts.push(makeSculptedLobe(2.75, 0.94, 2.65, 1, 0.05, 7.9, 0.15, 43, 0.78, 1.1));
      crownParts.push(makeSculptedLobe(2.05, 0.8, 1.95, 1, -0.55, 8.7, -0.75, 44, 0.8, 1.1));
      break;
    }

    case 'crape_myrtle': {
      // Multi-stemmed smooth sculptural trunks + billowy rounded clusters
      trunkParts.push(makeWoodPart(0.13, 0.07, 4.2, 6, 0, 0.3, 0, 0.22, 0, 0.26));
      trunkParts.push(makeWoodPart(0.12, 0.06, 4.4, 6, 0, 0.3, 0, -0.24, 0, -0.22));
      trunkParts.push(makeWoodPart(0.12, 0.06, 4.1, 6, 0, 0.3, 0, 0.14, 0, -0.28));
      crownParts.push(makeSculptedLobe(2.05, 1.55, 2.0, 1, -1.1, 5.4, 0.9, 51));
      crownParts.push(makeSculptedLobe(2.15, 1.6, 2.05, 1, 1.0, 5.7, -0.85, 52));
      crownParts.push(makeSculptedLobe(1.9, 1.45, 1.95, 1, 0.75, 6.3, 0.85, 53));
      crownParts.push(makeSculptedLobe(2.2, 1.65, 2.1, 1, -0.2, 7.2, -0.1, 54));
      break;
    }

    case 'five_point_maple': {
      // Strong central trunk + ascending fork + rich multi-lobed fiery canopy
      trunkParts.push(makeWoodPart(0.21, 0.14, 3.6, 7, 0, 0.3, 0));
      trunkParts.push(makeWoodPart(0.12, 0.05, 3.6, 6, 0, 3.4, 0, 0.42, 0, 0.38));
      trunkParts.push(makeWoodPart(0.12, 0.05, 3.5, 6, 0, 3.4, 0, -0.4, 0, -0.42));
      trunkParts.push(makeWoodPart(0.11, 0.05, 3.4, 6, 0, 3.5, 0, -0.35, 0, 0.44));
      crownParts.push(makeSculptedLobe(2.65, 2.05, 2.6, 1, 0, 7.0, 0, 61));
      crownParts.push(makeSculptedLobe(2.15, 1.8, 2.15, 1, -1.7, 5.9, 1.25, 62));
      crownParts.push(makeSculptedLobe(2.1, 1.75, 2.15, 1, 1.75, 6.1, -1.15, 63));
      crownParts.push(makeSculptedLobe(2.05, 1.7, 2.0, 1, -1.3, 6.4, -1.55, 64));
      crownParts.push(makeSculptedLobe(1.95, 1.75, 1.95, 1, 1.2, 7.6, 1.3, 65));
      crownParts.push(makeSculptedLobe(1.85, 1.55, 1.85, 1, 0.1, 8.4, -0.2, 66));
      break;
    }

    case 'dragon_juniper': {
      // Narrow columnar flame silhouette with spiraling evergreen tufts
      trunkParts.push(makeWoodPart(0.17, 0.06, 7.2, 7, 0, 0.3, 0));
      const tufts = [
        { x: 0.25, y: 2.1, z: 0.15, rx: 1.3, ry: 1.5, rz: 1.25 },
        { x: -0.28, y: 3.3, z: 0.22, rx: 1.35, ry: 1.65, rz: 1.3 },
        { x: -0.15, y: 4.7, z: -0.28, rx: 1.25, ry: 1.65, rz: 1.25 },
        { x: 0.26, y: 6.1, z: -0.18, rx: 1.12, ry: 1.6, rz: 1.12 },
        { x: 0.0, y: 7.5, z: 0.12, rx: 0.92, ry: 1.5, rz: 0.92 },
      ];
      tufts.forEach((t, idx) => {
        crownParts.push(makeSculptedLobe(t.rx, t.ry, t.rz, 1, t.x, t.y, t.z, 71 + idx, 0.72, 1.05));
      });
      crownParts.push(makeSculptedConeTier(0.76, 1.9, 8, 0, 8.2, 0, 79, 0.03));
      break;
    }

    case 'ginkgo': {
      // Upright architectural trunk + steeply ascending branches + luminous tiered fan clusters
      trunkParts.push(makeWoodPart(0.21, 0.12, 5.2, 7, 0, 0.3, 0));
      trunkParts.push(makeWoodPart(0.1, 0.04, 3.8, 6, 0, 4.2, 0, 0.3, 0, 0.48));
      trunkParts.push(makeWoodPart(0.1, 0.04, 3.7, 6, 0, 4.4, 0, -0.32, 0, -0.45));
      trunkParts.push(makeWoodPart(0.09, 0.04, 3.4, 6, 0, 5.0, 0, 0.42, 0, -0.35));
      crownParts.push(makeSculptedLobe(2.1, 1.65, 2.05, 1, -1.35, 6.3, 0.95, 81, 0.8, 1.08));
      crownParts.push(makeSculptedLobe(2.15, 1.7, 2.1, 1, 1.45, 6.6, -0.9, 82, 0.8, 1.08));
      crownParts.push(makeSculptedLobe(2.35, 1.95, 2.3, 1, 0, 7.6, 0.15, 83, 0.82, 1.1));
      crownParts.push(makeSculptedLobe(1.85, 1.65, 1.85, 1, 0.85, 8.3, 1.1, 84, 0.82, 1.1));
      crownParts.push(makeSculptedLobe(1.7, 1.65, 1.7, 1, -0.25, 9.0, -0.35, 85, 0.84, 1.12));
      break;
    }

    case 'french_sycamore': {
      // Tall boulevard plane tree with wide-arching cathedral scaffold limbs
      trunkParts.push(makeWoodPart(0.24, 0.16, 4.4, 7, 0, 0.3, 0));
      trunkParts.push(makeWoodPart(0.13, 0.06, 4.2, 6, 0, 4.0, 0, 0.46, 0, 0.56));
      trunkParts.push(makeWoodPart(0.13, 0.06, 4.1, 6, 0, 4.1, 0, -0.48, 0, -0.52));
      trunkParts.push(makeWoodPart(0.12, 0.05, 3.9, 6, 0, 4.2, 0, 0.38, 0, -0.58));
      trunkParts.push(makeWoodPart(0.11, 0.05, 3.8, 6, 0, 4.3, 0, -0.36, 0, 0.55));
      crownParts.push(makeSculptedLobe(2.95, 1.85, 2.85, 1, 0, 7.7, 0, 91));
      crownParts.push(makeSculptedLobe(2.35, 1.65, 2.3, 1, -2.15, 6.8, 1.35, 92));
      crownParts.push(makeSculptedLobe(2.35, 1.65, 2.3, 1, 2.15, 6.9, -1.3, 93));
      crownParts.push(makeSculptedLobe(2.2, 1.6, 2.2, 1, -1.55, 7.0, -1.75, 94));
      crownParts.push(makeSculptedLobe(2.2, 1.6, 2.2, 1, 1.65, 7.2, 1.65, 95));
      crownParts.push(makeSculptedLobe(2.15, 1.5, 2.1, 1, 0.15, 8.8, -0.1, 96));
      break;
    }
  }

  return {
    trunkGeo: mergeSafe(trunkParts),
    crownGeo: mergeSafe(crownParts),
  };
}

/**
 * Sample dense points along the corner-filleted Huanghai Rd curve (matching TerrainAndRoads.ts)
 * so vegetation clearance checks respect the smooth curved sidewalk edges.
 */
function buildHuanghaiDensePolyline(): { x: number; z: number }[] {
  const seg = ROAD_SEGMENTS.find((r) => r.id === 'huanghai');
  if (!seg || seg.waypoints.length < 2) return [];
  const pts = seg.waypoints;
  const out: { x: number; z: number }[] = [];
  const cornerTrim = 6.0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) continue;
    const ux = dx / len;
    const uz = dz / len;
    const startOff = i === 0 ? 0 : Math.min(cornerTrim, len * 0.35);
    const endOff = i === pts.length - 2 ? 0 : Math.min(cornerTrim, len * 0.35);
    const sx = a.x + ux * startOff;
    const sz = a.z + uz * startOff;
    const ex = b.x - ux * endOff;
    const ez = b.z - uz * endOff;
    const segLen = Math.hypot(ex - sx, ez - sz);
    const steps = Math.max(1, Math.ceil(segLen / 1.5));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push({ x: lerp(sx, ex, t), z: lerp(sz, ez, t) });
    }
    if (i < pts.length - 2) {
      const c = pts[i + 2];
      const dx2 = c.x - b.x;
      const dz2 = c.z - b.z;
      const len2 = Math.hypot(dx2, dz2);
      if (len2 > 1e-5) {
        const u2x = dx2 / len2;
        const u2z = dz2 / len2;
        const nextOff = Math.min(cornerTrim, len2 * 0.35);
        const p2x = b.x + u2x * nextOff;
        const p2z = b.z + u2z * nextOff;
        for (let k = 1; k <= 8; k++) {
          const t = k / 8;
          const omt = 1 - t;
          out.push({
            x: omt * omt * ex + 2 * omt * t * b.x + t * t * p2x,
            z: omt * omt * ez + 2 * omt * t * b.z + t * t * p2z,
          });
        }
      }
    }
  }
  return out;
}

const HUANGHAI_FILLET_POLYLINE = buildHuanghaiDensePolyline();

function isNearAnyIntersection(x: number, z: number, minRadius: number): boolean {
  for (const ix of NS_INTERSECT_X) {
    for (const iz of EW_INTERSECT_Z) {
      if (Math.hypot(x - ix, z - iz) < minRadius) {
        return true;
      }
    }
  }
  return false;
}

function isNearNingwuguanStaircase(x: number, z: number, padX = 0): boolean {
  return Math.abs(x) <= 3.5 + padX && z >= 120 && z <= 140;
}

function isValidTreeSpot(
  x: number,
  z: number,
  placed: readonly TreePlacement[],
  minSpacing: number,
): boolean {
  if (x < -245 || x > 245 || z < -225 || z > 195) return false;
  if (z > WORLD_BOUNDS.waterLineZ(x) - 4.0) return false;
  if (getGroundHeight(x, z) < 0.45) return false;

  // Exclude Second Bathing Beach, coastal seawall promenade & Ningwuguan staircase
  if (x >= -58 && x <= 176 && z >= seawallZ(x) - 1.2) {
    return false;
  }

  // Strictly outside physical sidewalk outer edge (width*0.5 + 0.22 curb + sidewalkWidth) + 0.85m
  for (const seg of ROAD_SEGMENTS) {
    const minClear = seg.width * 0.5 + 0.22 + seg.sidewalkWidth + 0.85;
    if (distToPolyline2D(x, z, seg.waypoints) < minClear) {
      return false;
    }
  }
  if (HUANGHAI_FILLET_POLYLINE.length > 1 && distToPolyline2D(x, z, HUANGHAI_FILLET_POLYLINE) < 7.07) {
    return false;
  }

  // Strictly outside all 19 villa parcels + 2.4m courtyard/gate margin
  for (const box of PARCEL_AABBS) {
    if (pointInExpandedAABB(x, z, box, 2.4)) {
      return false;
    }
  }

  // Minimum spacing from already-placed trees
  const minSq = minSpacing * minSpacing;
  for (let i = placed.length - 1; i >= 0; i--) {
    const dx = x - placed[i].x;
    const dz = z - placed[i].z;
    if (dx * dx + dz * dz < minSq) {
      return false;
    }
  }

  return true;
}

function generateTreePlacements(rng: () => number): TreePlacement[] {
  const placed: TreePlacement[] = [];

  const tryAddTree = (
    x: number,
    z: number,
    species: TreeSpecies,
    minSpacing: number,
    scaleMul = 1.0,
  ): boolean => {
    if (!isValidTreeSpot(x, z, placed, minSpacing)) return false;
    const spec = SPECIES_SPECS[species];
    const h = lerp(spec.heightRange[0], spec.heightRange[1], rng()) * scaleMul;
    const spread = lerp(spec.spreadRange[0], spec.spreadRange[1], rng()) * scaleMul;
    const y = getGroundHeight(x, z) - 0.05;
    const inPlayableDistrict =
      x >= WORLD_BOUNDS.minX + 4 &&
      x <= WORLD_BOUNDS.maxX - 4 &&
      z >= WORLD_BOUNDS.minZ + 4 &&
      z <= WORLD_BOUNDS.maxZ - 4;

    placed.push({
      x,
      y,
      z,
      yaw: rng() * Math.PI * 2,
      scaleXZ: spread,
      scaleY: h / 10.0,
      species,
      inPlayableDistrict,
    });
    return true;
  };

  // 1. Avenue trees along all 10 ROAD_SEGMENTS ("One Pass, One Tree")
  for (const seg of ROAD_SEGMENTS) {
    const offsetBase = seg.id === 'huanghai' ? 7.45 : 9.05;
    const spacing = seg.id === 'huanghai' ? 11.0 : 11.5;

    for (let i = 0; i < seg.waypoints.length - 1; i++) {
      const a = seg.waypoints[i];
      const b = seg.waypoints[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const tx = dx / len;
      const tz = dz / len;
      const nx = -tz;
      const nz = tx;

      const count = Math.max(1, Math.floor(len / spacing));
      for (let k = 0; k <= count; k++) {
        const s = (k + 0.35) * (len / (count + 0.7));
        const cx = a.x + tx * s;
        const cz = a.z + tz * s;

        for (const side of [-1, 1] as const) {
          const jitterAlong = (rng() - 0.5) * 1.4;
          const jitterSide = (rng() - 0.5) * 0.32;
          const px = cx + tx * jitterAlong + nx * side * (offsetBase + jitterSide);
          const pz = cz + tz * jitterAlong + nz * side * (offsetBase + jitterSide);

          // Skip Shanhaiguan south promenade where seawall & Yellow Sea vista belong
          if (seg.id === 'shanhaiguan' && px >= -56 && px <= 172 && pz > shanhaiguanCenterZ(px)) {
            continue;
          }
          // Keep intersections airy and sightlines open
          if (isNearAnyIntersection(px, pz, 11.2)) {
            continue;
          }
          tryAddTree(px, pz, seg.treeSpecies, 5.2, 1.0);
        }
      }
    }
  }

  // 2. Empty outer district blocks (parkland groves so no block feels barren)
  const emptyBlockCenters: { minX: number; maxX: number; minZ: number; maxZ: number; species: TreeSpecies[] }[] = [
    { minX: -175, maxX: -115, minZ: -145, maxZ: -85, species: ['snow_cedar', 'black_pine', 'crape_myrtle'] },
    { minX: -175, maxX: -115, minZ: -28, maxZ: 24, species: ['five_point_maple', 'dragon_juniper', 'snow_cedar'] },
    { minX: -175, maxX: -115, minZ: 24, maxZ: 72, species: ['ginkgo', 'dragon_juniper', 'snow_cedar'] },
    { minX: -175, maxX: -115, minZ: 72, maxZ: 112, species: ['ginkgo', 'french_sycamore', 'snow_cedar'] },
    { minX: 115, maxX: 175, minZ: -145, maxZ: -85, species: ['black_pine', 'flowering_peach', 'crape_myrtle'] },
    { minX: 115, maxX: 175, minZ: -85, maxZ: -28, species: ['five_point_maple', 'flowering_peach', 'crape_myrtle'] },
    { minX: 115, maxX: 175, minZ: -28, maxZ: 24, species: ['five_point_maple', 'dragon_juniper', 'flowering_peach'] },
    { minX: 115, maxX: 175, minZ: 72, maxZ: 108, species: ['ginkgo', 'french_sycamore', 'flowering_peach'] },
  ];

  for (const blk of emptyBlockCenters) {
    for (let attempt = 0; attempt < 22; attempt++) {
      const px = lerp(blk.minX + 12, blk.maxX - 12, rng());
      const pz = lerp(blk.minZ + 12, blk.maxZ - 12, rng());
      const sp = blk.species[Math.floor(rng() * blk.species.length)];
      tryAddTree(px, pz, sp, 7.5, 0.96);
    }
  }

  // 3. Northern Zhongshan Park / hillside perimeter grove (Z in [-220, -158])
  const northPalette: TreeSpecies[] = [
    'snow_cedar',
    'black_pine',
    'five_point_maple',
    'ginkgo',
    'french_sycamore',
  ];
  for (let gx = -232; gx <= 232; gx += 16) {
    for (let gz = -218; gz <= -160; gz += 15) {
      const px = gx + (rng() - 0.5) * 9.0;
      const pz = gz + (rng() - 0.5) * 8.0;
      const sp = northPalette[Math.floor(rng() * northPalette.length)];
      tryAddTree(px, pz, sp, 6.4, lerp(0.95, 1.15, rng()));
    }
  }

  // 4. West & East flanking perimeter groves (closing side horizon edges)
  const sidePalette: TreeSpecies[] = ['snow_cedar', 'black_pine', 'five_point_maple', 'ginkgo', 'crabapple'];
  for (const sideSign of [-1, 1] as const) {
    for (let gx = 186; gx <= 238; gx += 15) {
      for (let gz = -152; gz <= 104; gz += 16) {
        const px = sideSign * (gx + (rng() - 0.5) * 7.5);
        const pz = gz + (rng() - 0.5) * 8.0;
        const sp = sidePalette[Math.floor(rng() * sidePalette.length)];
        tryAddTree(px, pz, sp, 6.4, lerp(0.92, 1.12, rng()));
      }
    }
  }

  // 5. Coastal headland & Huanghai scenic pine accents (around west cape slope outside parcel+roads)
  for (let attempt = 0; attempt < 40; attempt++) {
    const px = lerp(-180, -126, rng());
    const pz = lerp(124, 182, rng());
    const sp: TreeSpecies = rng() < 0.72 ? 'black_pine' : 'snow_cedar';
    tryAddTree(px, pz, sp, 7.0, 0.94);
  }

  return placed;
}

/**
 * Pure BufferGeometry fallen-leaf cluster patch (14 crisp flat leaves in ~1.35m x 1.05m footprint)
 * with zero DOM calls.
 */
function buildFallenLeafClusterGeometry(): THREE.BufferGeometry {
  const rng = mulberry32(8031);
  const parts: THREE.BufferGeometry[] = [];
  const leafCount = 20;

  for (let i = 0; i < leafCount; i++) {
    const angle = (i / leafCount) * Math.PI * 2 + rng() * 0.5;
    const rad = Math.sqrt(rng()) * 0.68;
    const lx = Math.cos(angle) * rad * 1.22;
    const lz = Math.sin(angle) * rad * 0.96;
    const ly = 0.002 + rng() * 0.008;
    const yaw = rng() * Math.PI * 2;
    const len = 0.14 + rng() * 0.09;
    const wid = 0.09 + rng() * 0.05;

    // 2-triangle diamond leaf resting nearly flat
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const localPts = [
      [0, 0, -len * 0.5],
      [wid * 0.5, 0.002, 0],
      [0, 0, len * 0.5],
      [-wid * 0.5, 0.002, 0],
    ];
    const worldPts = localPts.map(([px, py, pz]) => [
      lx + px * c - pz * s,
      ly + py,
      lz + px * s + pz * c,
    ]);

    const positions = new Float32Array([
      ...worldPts[0], ...worldPts[3], ...worldPts[2],
      ...worldPts[0], ...worldPts[2], ...worldPts[1],
    ]);
    const normals = new Float32Array([
      0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const shade = 0.84 + rng() * 0.22;
    const colors = new Float32Array([
      shade, shade, shade,
      shade, shade, shade,
      shade, shade, shade,
      shade, shade, shade,
      shade, shade, shade,
      shade, shade, shade,
    ]);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }

  return mergeSafe(parts);
}

function buildDriftingLeafGeometry(): THREE.BufferGeometry {
  // Curved 4-triangle autumn leaf (~0.16m x 0.11m)
  const positions = new Float32Array([
    0.0, 0.012, -0.08,
    -0.055, 0.0, 0.0,
    0.0, -0.008, 0.08,

    0.0, 0.012, -0.08,
    0.0, -0.008, 0.08,
    0.055, 0.0, 0.0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

interface LeafCarpetSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  color: number;
}

function generateLeafCarpetSpots(rng: () => number): LeafCarpetSpot[] {
  const spots: LeafCarpetSpot[] = [];

  const pushSidewalkAndGutterClusters = (
    xStart: number,
    xEnd: number,
    step: number,
    getCenterZ: (x: number) => number,
    palette: readonly number[],
    densityProb: number,
    allowSouthSidewalk = true,
  ): void => {
    for (let x = xStart; x <= xEnd; x += step) {
      if (isNearAnyIntersection(x, getCenterZ(x), 10.2)) continue;
      if (isNearNingwuguanStaircase(x, getCenterZ(x) + 6.5, 2.5)) continue;

      for (const side of [-1, 1] as const) {
        if (!allowSouthSidewalk && side > 0) continue;
        if (rng() > densityProb) continue;

        const cz = getCenterZ(x);
        // Place either on sidewalk strip [5.55, 7.25] or gutter edge along curb [4.25, 4.78]
        const onSidewalk = rng() < 0.58;
        const offset = onSidewalk ? lerp(5.55, 7.25, rng()) : lerp(4.25, 4.78, rng());
        const px = x + (rng() - 0.5) * 1.4;
        const pz = cz + side * offset;

        if (isNearAnyIntersection(px, pz, 9.6)) continue;
        if (isNearNingwuguanStaircase(px, pz, 2.5)) continue;

        const surfaceOffset = onSidewalk ? 0.14 + 0.018 : 0.032 + 0.015;
        spots.push({
          x: px,
          y: getGroundHeight(px, pz) + surfaceOffset,
          z: pz,
          yaw: rng() * Math.PI * 2,
          scale: lerp(0.85, 1.32, rng()),
          color: palette[Math.floor(rng() * palette.length)],
        });
      }
    }
  };

  // Juyongguan Rd (z = 72) — signature golden ginkgo carpet ("緩掃落葉")
  pushSidewalkAndGutterClusters(
    -166,
    166,
    2.4,
    () => 72,
    [0xebc035, 0xf4ca44, 0xdba325, 0xe8b42c],
    0.85,
  );

  // Jiayuguan Rd (z = -28) — crimson & burnt-orange five-point maple carpet
  pushSidewalkAndGutterClusters(
    -166,
    166,
    2.6,
    () => -28,
    [0xc63524, 0xe26d2a, 0xdf8b30, 0xb62e20],
    0.82,
  );

  // Shanhaiguan Rd (curved) — French sycamore ochre-gold leaves
  pushSidewalkAndGutterClusters(
    -166,
    166,
    3.0,
    shanhaiguanCenterZ,
    [0xc9923c, 0xd9a74a, 0xb57a32, 0xc78d39],
    0.72,
  );

  // Zhengyangguan Rd (z = -85) — lighter crape-myrtle bronze accents
  pushSidewalkAndGutterClusters(
    -164,
    164,
    4.5,
    () => -85,
    [0xc9653b, 0xd88a38, 0xb85934],
    0.48,
  );

  // Ningwuguan Rd (x = 0) — russet crabapple accents along N-S corridor
  for (let z = -132; z <= 104; z += 4.2) {
    if (isNearAnyIntersection(0, z, 10.2)) continue;
    for (const side of [-1, 1] as const) {
      if (rng() > 0.52) continue;
      const onSidewalk = rng() < 0.55;
      const offset = onSidewalk ? lerp(5.55, 7.25, rng()) : lerp(4.25, 4.78, rng());
      const px = side * offset;
      const pz = z + (rng() - 0.5) * 1.3;
      const surfaceOffset = onSidewalk ? 0.14 + 0.018 : 0.032 + 0.015;
      spots.push({
        x: px,
        y: getGroundHeight(px, pz) + surfaceOffset,
        z: pz,
        yaw: rng() * Math.PI * 2,
        scale: lerp(0.8, 1.2, rng()),
        color: rng() < 0.5 ? 0xd88432 : 0xc76b2a,
      });
    }
  }

  return spots;
}

interface SignpostDef {
  x: number;
  y: number;
  z: number;
  id: string;
  plates: { roadId: string; yaw: number; heightOffset: number }[];
}

function buildSignposts(
  materials: ProceduralMaterialSet,
  localDisposables: Set<THREE.BufferGeometry | THREE.Material>,
  colliders: ColliderBox[],
): THREE.Group {
  const signGroup = new THREE.Group();
  signGroup.name = 'BadaguanStreetSigns';

  const nsRoadIds = ['zijingguan', 'ningwuguan', 'shaoguan'] as const;
  const ewRoadIds = [
    'wushengguan',
    'zhengyangguan',
    'jiayuguan',
    'linhuaiguan',
    'juyongguan',
    'shanhaiguan',
  ] as const;

  const signposts: SignpostDef[] = [];

  // 18 orthogonal intersection signposts on verified NE sidewalk corners (ix + 6.8, iz - 6.8)
  for (let xi = 0; xi < NS_INTERSECT_X.length; xi++) {
    for (let zi = 0; zi < EW_INTERSECT_Z.length; zi++) {
      const sx = NS_INTERSECT_X[xi] + 6.8;
      const sz = EW_INTERSECT_Z[zi] - 6.8;
      const sy = getGroundHeight(sx, sz) + 0.14;
      signposts.push({
        id: `sign_${nsRoadIds[xi]}_${ewRoadIds[zi]}`,
        x: sx,
        y: sy,
        z: sz,
        plates: [
          // E-W road plate at upper collar facing N/S
          { roadId: ewRoadIds[zi], yaw: 0, heightOffset: 2.66 },
          // N-S road plate at lower collar facing E/W
          { roadId: nsRoadIds[xi], yaw: Math.PI / 2, heightOffset: 2.2 },
        ],
      });
    }
  }

  // 19th signpost: Huanghai Rd inner sidewalk near Huashi Building (dist to polyline = 5.20m)
  const hhSeg = ROAD_SEGMENTS.find((r) => r.id === 'huanghai');
  if (hhSeg) {
    // Segment between (-132, 152) and (-128, 170) -> midpoint (-130, 161), east normal (0.976, -0.217)
    const hx = -130 + 0.976 * 5.2;
    const hz = 161 - 0.217 * 5.2;
    const hy = getGroundHeight(hx, hz) + 0.14;
    signposts.push({
      id: 'sign_huanghai_huashi',
      x: hx,
      y: hy,
      z: hz,
      plates: [{ roadId: 'huanghai', yaw: 0.22, heightOffset: 2.58 }],
    });
  }

  // Merge all cast-iron posts, bases, finials, and blade backing frames into 1 draw call
  const ironParts: THREE.BufferGeometry[] = [];
  const platesByRoad = new Map<string, { x: number; y: number; z: number; yaw: number }[]>();

  for (const post of signposts) {
    const basePlinth = new THREE.CylinderGeometry(0.11, 0.14, 0.36, 10);
    basePlinth.translate(post.x, post.y + 0.04, post.z);
    ironParts.push(basePlinth);

    const pole = new THREE.CylinderGeometry(0.04, 0.048, 3.12, 10);
    pole.translate(post.x, post.y + 1.42, post.z);
    ironParts.push(pole);

    const finial = new THREE.SphereGeometry(0.085, 10, 8);
    finial.translate(post.x, post.y + 3.02, post.z);
    ironParts.push(finial);

    for (const plate of post.plates) {
      const collar = new THREE.CylinderGeometry(0.068, 0.068, 0.1, 10);
      collar.translate(post.x, post.y + plate.heightOffset, post.z);
      ironParts.push(collar);

      const frame = new THREE.BoxGeometry(0.92, 0.44, 0.028);
      frame.rotateY(plate.yaw);
      frame.translate(post.x, post.y + plate.heightOffset, post.z);
      ironParts.push(frame);

      const list = platesByRoad.get(plate.roadId) ?? [];
      list.push({
        x: post.x,
        y: post.y + plate.heightOffset,
        z: post.z,
        yaw: plate.yaw,
      });
      platesByRoad.set(plate.roadId, list);
    }

    colliders.push({
      id: post.id,
      minX: post.x - 0.2,
      maxX: post.x + 0.2,
      minZ: post.z - 0.2,
      maxZ: post.z + 0.2,
      kind: 'prop',
    });
  }

  const mergedIron = mergeSafe(ironParts);
  localDisposables.add(mergedIron);
  const ironMesh = new THREE.Mesh(mergedIron, materials.darkIron);
  ironMesh.name = 'StreetSignPosts';
  ironMesh.castShadow = true;
  ironMesh.receiveShadow = true;
  signGroup.add(ironMesh);

  // Build double-sided non-mirrored enamel face pairs (1 merged Mesh per road = 10 draw calls)
  const segById = new Map<string, RoadSegment>(ROAD_SEGMENTS.map((s) => [s.id, s]));
  for (const [roadId, placements] of platesByRoad.entries()) {
    const seg = segById.get(roadId);
    if (!seg) continue;
    const isNs = roadId === 'zijingguan' || roadId === 'ningwuguan' || roadId === 'shaoguan';
    const mat = materials.createRoadSignMaterial(
      seg.roadNameZh,
      seg.roadNameEn,
      isNs ? 'green' : 'blue',
    );

    const bladeGeos: THREE.BufferGeometry[] = [];
    for (const p of placements) {
      // Front face (+0.017m normal)
      const front = new THREE.PlaneGeometry(0.88, 0.4);
      front.translate(0, 0, 0.017);
      front.rotateY(p.yaw);
      front.translate(p.x, p.y, p.z);
      bladeGeos.push(front);

      // Back face (-0.017m normal, rotated 180 deg so text reads left-to-right on both sides)
      const back = new THREE.PlaneGeometry(0.88, 0.4);
      back.rotateY(Math.PI);
      back.translate(0, 0, -0.017);
      back.rotateY(p.yaw);
      back.translate(p.x, p.y, p.z);
      bladeGeos.push(back);
    }

    const mergedBlade = mergeSafe(bladeGeos);
    localDisposables.add(mergedBlade);
    const bladeMesh = new THREE.Mesh(mergedBlade, mat);
    bladeMesh.name = `StreetSignBlades_${roadId}`;
    bladeMesh.castShadow = false;
    bladeMesh.receiveShadow = true;
    signGroup.add(bladeMesh);
  }

  return signGroup;
}

interface TreeCanopyBound {
  x: number;
  y: number;
  z: number;
  radiusXZ: number;
  minY: number;
  maxY: number;
}

function buildStreetlamps(
  materials: ProceduralMaterialSet,
  localDisposables: Set<THREE.BufferGeometry | THREE.Material>,
  colliders: ColliderBox[],
  treeCanopies: readonly TreeCanopyBound[] = [],
): { group: THREE.Group; positions: { x: number; z: number }[] } {
  const lampGroup = new THREE.Group();
  lampGroup.name = 'BadaguanStreetlamps';

  const placements: { x: number; y: number; z: number; yaw: number }[] = [];

  const isValidLampPos = (x: number, z: number): { ok: boolean; y: number } => {
    if (isNearAnyIntersection(x, z, 10.5)) return { ok: false, y: 0 };
    if (isNearNingwuguanStaircase(x, z, 3.0)) return { ok: false, y: 0 };
    if (Math.abs(x) < 6.5 && z > 110) return { ok: false, y: 0 };
    if (z > WORLD_BOUNDS.waterLineZ(x) - 3.0) return { ok: false, y: 0 };

    // Must sit strictly outside every road carriageway + curb
    for (const seg of ROAD_SEGMENTS) {
      if (distToPolyline2D(x, z, seg.waypoints) < seg.width * 0.5 + 0.3) {
        return { ok: false, y: 0 };
      }
    }
    if (HUANGHAI_FILLET_POLYLINE.length > 1 && distToPolyline2D(x, z, HUANGHAI_FILLET_POLYLINE) < 4.25) {
      return { ok: false, y: 0 };
    }

    // Avoid colliding with existing lamps
    for (const prev of placements) {
      if (Math.hypot(x - prev.x, z - prev.z) < 8.0) return { ok: false, y: 0 };
    }

    const y = getGroundHeight(x, z) + 0.14;
    const lanternMinY = y + 3.55;
    const lanternMaxY = y + 4.4;

    // Enforce horizontal clearance from tree canopies so lanterns never sit inside foliage
    for (const tree of treeCanopies) {
      const clearRadius = Math.max(4.5, tree.radiusXZ + 0.55);
      const d = Math.hypot(x - tree.x, z - tree.z);
      if (d < clearRadius && lanternMaxY >= tree.minY - 0.35 && lanternMinY <= tree.maxY + 0.35) {
        return { ok: false, y: 0 };
      }
    }

    return { ok: true, y };
  };

  const tryAddLamp = (x: number, z: number, yaw: number, tx = 0, tz = 0): void => {
    const offsets = tx !== 0 || tz !== 0 ? [0, 3.8, -3.8, 5.2, -5.2] : [0];
    for (const off of offsets) {
      const cx = x + tx * off;
      const cz = z + tz * off;
      const check = isValidLampPos(cx, cz);
      if (check.ok) {
        placements.push({ x: cx, y: check.y, z: cz, yaw });
        return;
      }
    }
  };

  // Straight N-S and E-W avenue sidewalk lamps (curb-side offset = 5.55m)
  for (const seg of ROAD_SEGMENTS) {
    if (seg.id === 'huanghai' || seg.id === 'shanhaiguan') continue;
    const a = seg.waypoints[0];
    const b = seg.waypoints[1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const tx = dx / len;
    const tz = dz / len;
    const nx = -tz;
    const nz = tx;

    let idx = 0;
    for (let s = 18; s <= len - 18; s += 30) {
      const side = idx % 2 === 0 ? 1 : -1;
      const lx = a.x + tx * s + nx * side * 5.55;
      const lz = a.z + tz * s + nz * side * 5.55;
      tryAddLamp(lx, lz, Math.atan2(nx * -side, nz * -side), tx, tz);
      idx++;
    }
  }

  // Shanhaiguan Rd north sidewalk + south coastal promenade sidewalk lamps
  for (let x = -158; x <= 158; x += 26) {
    const cz = shanhaiguanCenterZ(x);
    const slopeZ = (shanhaiguanCenterZ(x + 1.0) - shanhaiguanCenterZ(x - 1.0)) * 0.5;
    const invLen = 1 / Math.hypot(1.0, slopeZ);
    const nx = slopeZ * invLen;
    const nz = -1.0 * invLen;
    const tx = 1.0 * invLen;
    const tz = slopeZ * invLen;
    tryAddLamp(x + nx * 5.55, cz + nz * 5.55, Math.atan2(-nx, -nz), tx, tz);
  }
  for (const sx of [-46, -22, 18, 46, 74, 100, 134, 158]) {
    tryAddLamp(sx, shanhaiguanCenterZ(sx) + 7.2, Math.PI, 1, 0);
  }

  // Huanghai Rd scenic lamps placed cleanly on sidewalk (offset = +/-4.75m from segment)
  const hhSeg = ROAD_SEGMENTS.find((r) => r.id === 'huanghai');
  if (hhSeg) {
    for (let i = 1; i < hhSeg.waypoints.length - 1; i++) {
      const a = hhSeg.waypoints[i];
      const b = hhSeg.waypoints[i + 1];
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const tx = dx / len;
      const tz = dz / len;
      const nx = -tz;
      const nz = tx;
      const side = i % 2 === 0 ? 1 : -1;
      tryAddLamp(mx + nx * side * 4.75, mz + nz * side * 4.75, Math.atan2(-nx * side, -nz * side), tx, tz);
    }
  }

  // Lamp post geometry (base sunk -0.16m)
  const postParts: THREE.BufferGeometry[] = [];
  const baseGeo = new THREE.CylinderGeometry(0.14, 0.19, 0.46, 8);
  baseGeo.translate(0, 0.07, 0);
  postParts.push(baseGeo);

  const collarGeo = new THREE.CylinderGeometry(0.08, 0.13, 0.25, 8);
  collarGeo.translate(0, 0.42, 0);
  postParts.push(collarGeo);

  const shaftGeo = new THREE.CylinderGeometry(0.048, 0.075, 3.05, 8);
  shaftGeo.translate(0, 2.02, 0);
  postParts.push(shaftGeo);

  const neckGeo = new THREE.CylinderGeometry(0.16, 0.06, 0.18, 6);
  neckGeo.translate(0, 3.62, 0);
  postParts.push(neckGeo);

  const capGeo = new THREE.ConeGeometry(0.24, 0.22, 6);
  capGeo.translate(0, 4.18, 0);
  postParts.push(capGeo);

  const finialGeo = new THREE.SphereGeometry(0.055, 8, 6);
  finialGeo.translate(0, 4.32, 0);
  postParts.push(finialGeo);

  const postGeo = mergeSafe(postParts);
  localDisposables.add(postGeo);

  const globeGeo = new THREE.CylinderGeometry(0.15, 0.11, 0.36, 6);
  globeGeo.translate(0, 3.89, 0);
  localDisposables.add(globeGeo);

  const globeMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c8,
    emissive: 0xffd584,
    emissiveIntensity: 0.48,
    roughness: 0.28,
    metalness: 0.05,
  });
  localDisposables.add(globeMat);

  const postMesh = new THREE.InstancedMesh(postGeo, materials.darkIron, placements.length);
  postMesh.name = 'StreetLampPosts';
  postMesh.frustumCulled = false;
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;

  const globeMesh = new THREE.InstancedMesh(globeGeo, globeMat, placements.length);
  globeMesh.name = 'StreetLampLanterns';
  globeMesh.frustumCulled = false;
  globeMesh.castShadow = false;
  globeMesh.receiveShadow = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
    globeMesh.setMatrixAt(i, dummy.matrix);

    colliders.push({
      id: `streetlamp_${i}`,
      minX: p.x - 0.2,
      maxX: p.x + 0.2,
      minZ: p.z - 0.2,
      maxZ: p.z + 0.2,
      kind: 'prop',
    });
  }
  postMesh.instanceMatrix.needsUpdate = true;
  globeMesh.instanceMatrix.needsUpdate = true;

  lampGroup.add(postMesh, globeMesh);
  return {
    group: lampGroup,
    positions: placements.map((p) => ({ x: p.x, z: p.z })),
  };
}

function buildPromenadeBenches(
  materials: ProceduralMaterialSet,
  localDisposables: Set<THREE.BufferGeometry | THREE.Material>,
  colliders: ColliderBox[],
): THREE.Group {
  const benchGroup = new THREE.Group();
  benchGroup.name = 'CoastalPromenadeBenches';

  // Flat scenic spans of the Shanhaiguan cobblestone promenade apron,
  // avoiding Ningwuguan staircase (x in [-3.5, 3.5]) and the steep beach bluff dip (x in [15, 65]).
  const benchXs = [-48, -36, -24, -12, 12, 78, 92, 104, 128, 142, 156];

  const benchIronParts: THREE.BufferGeometry[] = [];
  for (const lx of [-0.76, 0.76]) {
    // Front & back legs sunk -0.26m so all feet seat firmly even when benchY clears max(yFront, yBack)
    const frontLeg = new THREE.BoxGeometry(0.06, 0.7, 0.06);
    frontLeg.translate(lx, 0.09, 0.22);
    benchIronParts.push(frontLeg);

    const backLeg = new THREE.BoxGeometry(0.06, 1.04, 0.06);
    backLeg.translate(lx, 0.26, -0.22);
    benchIronParts.push(backLeg);

    const seatSupport = new THREE.BoxGeometry(0.06, 0.05, 0.52);
    seatSupport.translate(lx, 0.42, 0);
    benchIronParts.push(seatSupport);

    const armrest = new THREE.BoxGeometry(0.06, 0.045, 0.46);
    armrest.translate(lx, 0.63, -0.02);
    benchIronParts.push(armrest);

    const armPost = new THREE.BoxGeometry(0.05, 0.21, 0.05);
    armPost.translate(lx, 0.53, 0.18);
    benchIronParts.push(armPost);
  }
  const ironGeo = mergeSafe(benchIronParts);
  localDisposables.add(ironGeo);

  const slatParts: THREE.BufferGeometry[] = [];
  // 3 seat slats
  for (const sz of [0.16, 0.02, -0.12]) {
    const slat = new THREE.BoxGeometry(1.76, 0.036, 0.11);
    slat.translate(0, 0.455, sz);
    slatParts.push(slat);
  }
  // 2 backrest slats
  for (const [by, bz] of [
    [0.64, -0.21],
    [0.78, -0.23],
  ] as const) {
    const slat = new THREE.BoxGeometry(1.76, 0.1, 0.036);
    slat.rotateX(-0.14);
    slat.translate(0, by, bz);
    slatParts.push(slat);
  }
  const slatGeo = mergeSafe(slatParts);
  localDisposables.add(slatGeo);

  const teakMat = new THREE.MeshStandardMaterial({
    color: 0x8b5a36,
    roughness: 0.78,
    metalness: 0.02,
  });
  localDisposables.add(teakMat);

  const ironMesh = new THREE.InstancedMesh(ironGeo, materials.darkIron, benchXs.length);
  ironMesh.name = 'PromenadeBenchFrames';
  ironMesh.frustumCulled = false;
  ironMesh.castShadow = true;
  ironMesh.receiveShadow = true;

  const slatMesh = new THREE.InstancedMesh(slatGeo, teakMat, benchXs.length);
  slatMesh.name = 'PromenadeBenchSlats';
  slatMesh.frustumCulled = false;
  slatMesh.castShadow = true;
  slatMesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < benchXs.length; i++) {
    const bx = benchXs[i];
    const shZ = shanhaiguanCenterZ(bx);
    const bz = shZ + 8.15;

    // Interpolate promenade apron plane elevation across [zInner = shZ + 7.72, zOuter = seawallZ + 0.1]
    const zInner = shZ + 7.72;
    const zOuter = seawallZ(bx) + 0.1;
    const yInner = getGroundHeight(bx, zInner) + 0.14;
    const yOuter = getGroundHeight(bx, zOuter) + 0.14;
    const tFront = clamp((bz + 0.24 - zInner) / Math.max(1e-4, zOuter - zInner), 0, 1);
    const tBack = clamp((bz - 0.24 - zInner) / Math.max(1e-4, zOuter - zInner), 0, 1);
    const yFront = lerp(yInner, yOuter, tFront);
    const yBack = lerp(yInner, yOuter, tBack);
    const benchY = Math.max(yFront, yBack);

    // Align facing direction perpendicular to local coastal curve (+Z toward Yellow Sea)
    const slopeZ = (shanhaiguanCenterZ(bx + 1.0) - shanhaiguanCenterZ(bx - 1.0)) * 0.5;
    const yaw = -Math.atan2(slopeZ, 1.0);

    dummy.position.set(bx, benchY, bz);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    ironMesh.setMatrixAt(i, dummy.matrix);
    slatMesh.setMatrixAt(i, dummy.matrix);

    colliders.push({
      id: `promenade_bench_${i}`,
      minX: bx - 0.95,
      maxX: bx + 0.95,
      minZ: bz - 0.35,
      maxZ: bz + 0.35,
      kind: 'prop',
    });
  }
  ironMesh.instanceMatrix.needsUpdate = true;
  slatMesh.instanceMatrix.needsUpdate = true;

  benchGroup.add(ironMesh, slatMesh);
  return benchGroup;
}

export function buildVegetationAndProps(
  materials: ProceduralMaterialSet,
): VegetationBuildResult {
  const group = new THREE.Group();
  group.name = 'BadaguanVegetationAndProps';
  const colliders: ColliderBox[] = [];
  const localDisposables = new Set<THREE.BufferGeometry | THREE.Material>();

  const rng = mulberry32(20261121);

  // 1. "One Pass, One Tree" Signature Foliage + Perimeter Groves
  const foliageMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.0,
  });
  localDisposables.add(foliageMat);

  const treePlacements = generateTreePlacements(rng);
  const bySpecies = new Map<TreeSpecies, TreePlacement[]>();
  for (const sp of ALL_SPECIES) {
    bySpecies.set(sp, []);
  }
  for (const t of treePlacements) {
    bySpecies.get(t.species)?.push(t);
  }

  const treesGroup = new THREE.Group();
  treesGroup.name = 'BadaguanSignatureTrees';
  const dummy = new THREE.Object3D();
  const colorScratch = new THREE.Color();
  const treeCanopyBounds: TreeCanopyBound[] = [];

  for (const sp of ALL_SPECIES) {
    const list = bySpecies.get(sp) ?? [];
    if (list.length === 0) continue;

    const { trunkGeo, crownGeo } = buildSpeciesGeometries(sp);
    localDisposables.add(trunkGeo);
    localDisposables.add(crownGeo);

    crownGeo.computeBoundingBox();
    const crownBox = crownGeo.boundingBox;
    const baseRadiusXZ = crownBox
      ? Math.max(
          Math.abs(crownBox.min.x),
          Math.abs(crownBox.max.x),
          Math.abs(crownBox.min.z),
          Math.abs(crownBox.max.z),
        )
      : 3.0;
    const baseMinY = crownBox ? crownBox.min.y : 2.0;
    const baseMaxY = crownBox ? crownBox.max.y : 10.0;

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, materials.bark, list.length);
    trunkMesh.name = `TreesTrunk_${sp}`;
    trunkMesh.frustumCulled = false;
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;

    const crownMesh = new THREE.InstancedMesh(crownGeo, foliageMat, list.length);
    crownMesh.name = `TreesCrown_${sp}`;
    crownMesh.frustumCulled = false;
    crownMesh.castShadow = true;
    crownMesh.receiveShadow = true;

    const spec = SPECIES_SPECS[sp];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.yaw, 0);
      dummy.scale.set(item.scaleXZ, item.scaleY, item.scaleXZ);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      crownMesh.setMatrixAt(i, dummy.matrix);

      // Subtle bark & crown per-instance tone variation
      colorScratch.setHex(spec.barkTint);
      colorScratch.offsetHSL(0, 0, (rng() - 0.5) * 0.06);
      trunkMesh.setColorAt(i, colorScratch);

      const crownHex = spec.crownPalette[Math.floor(rng() * spec.crownPalette.length)];
      colorScratch.setHex(crownHex);
      colorScratch.offsetHSL((rng() - 0.5) * 0.025, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.05);
      crownMesh.setColorAt(i, colorScratch);

      if (item.inPlayableDistrict) {
        colliders.push({
          id: `tree_${sp}_${i}`,
          minX: item.x - 0.28,
          maxX: item.x + 0.28,
          minZ: item.z - 0.28,
          maxZ: item.z + 0.28,
          kind: 'prop',
        });
      }
      treeCanopyBounds.push({
        x: item.x,
        y: item.y,
        z: item.z,
        radiusXZ: baseRadiusXZ * item.scaleXZ,
        minY: item.y + baseMinY * item.scaleY,
        maxY: item.y + baseMaxY * item.scaleY,
      });
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;

    treesGroup.add(trunkMesh, crownMesh);
  }
  group.add(treesGroup);

  // 2. "緩掃落葉" Fallen Leaf Carpets (pure geometry InstancedMesh, zero Z-fighting)
  const carpetSpots = generateLeafCarpetSpots(rng);
  const carpetGeo = buildFallenLeafClusterGeometry();
  localDisposables.add(carpetGeo);

  const carpetMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  localDisposables.add(carpetMat);

  const carpetMesh = new THREE.InstancedMesh(carpetGeo, carpetMat, carpetSpots.length);
  carpetMesh.name = 'FallenLeafCarpets';
  carpetMesh.frustumCulled = false;
  carpetMesh.castShadow = false;
  carpetMesh.receiveShadow = true;

  for (let i = 0; i < carpetSpots.length; i++) {
    const spot = carpetSpots[i];
    dummy.position.set(spot.x, spot.y, spot.z);
    dummy.rotation.set(0, spot.yaw, 0);
    dummy.scale.set(spot.scale, 1, spot.scale);
    dummy.updateMatrix();
    carpetMesh.setMatrixAt(i, dummy.matrix);

    colorScratch.setHex(spot.color);
    colorScratch.offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.06);
    carpetMesh.setColorAt(i, colorScratch);
  }
  carpetMesh.instanceMatrix.needsUpdate = true;
  if (carpetMesh.instanceColor) carpetMesh.instanceColor.needsUpdate = true;
  group.add(carpetMesh);

  // 3. Drifting Autumn Leaves (420 instanced DoubleSide leaves animated in update)
  const DRIFT_COUNT = 420;
  const driftGeo = buildDriftingLeafGeometry();
  localDisposables.add(driftGeo);

  const driftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  localDisposables.add(driftMat);

  const driftMesh = new THREE.InstancedMesh(driftGeo, driftMat, DRIFT_COUNT);
  driftMesh.name = 'DriftingAutumnLeaves';
  driftMesh.frustumCulled = false;
  driftMesh.castShadow = false;
  driftMesh.receiveShadow = false;

  const driftPalette = [0xf0c238, 0xe8b028, 0xc63524, 0xe26d2a, 0xc9923c, 0xd9a74a];
  const driftX = new Float32Array(DRIFT_COUNT);
  const driftY = new Float32Array(DRIFT_COUNT);
  const driftZ = new Float32Array(DRIFT_COUNT);
  const driftFallSpeed = new Float32Array(DRIFT_COUNT);
  const driftPhase = new Float32Array(DRIFT_COUNT);
  const driftSpinSpeed = new Float32Array(DRIFT_COUNT);
  const driftScale = new Float32Array(DRIFT_COUNT);

  const writeDriftMatrix = (i: number, t: number): void => {
    const phase = driftPhase[i];
    const spin = t * driftSpinSpeed[i] + phase;
    _leafDummyPos.set(
      driftX[i] + Math.sin(t * 1.1 + phase) * 0.35,
      driftY[i],
      driftZ[i] + Math.cos(t * 0.9 + phase) * 0.3,
    );
    _leafDummyEuler.set(
      Math.sin(spin * 0.9) * 0.95,
      spin,
      Math.cos(spin * 0.7) * 0.85,
    );
    _leafDummyQuat.setFromEuler(_leafDummyEuler);
    const s = driftScale[i];
    _leafDummyScale.set(s, s, s);
    _leafDummyMat.compose(_leafDummyPos, _leafDummyQuat, _leafDummyScale);
    driftMesh.setMatrixAt(i, _leafDummyMat);
  };

  for (let i = 0; i < DRIFT_COUNT; i++) {
    const px = lerp(-165, 165, rng());
    const pz = lerp(-138, 128, rng());
    driftX[i] = px;
    driftZ[i] = pz;
    driftY[i] = getGroundHeight(px, pz) + lerp(0.5, 10.5, rng());
    driftFallSpeed[i] = lerp(0.42, 0.78, rng());
    driftPhase[i] = rng() * Math.PI * 2;
    driftSpinSpeed[i] = lerp(1.1, 2.4, rng()) * (rng() < 0.5 ? 1 : -1);
    driftScale[i] = lerp(0.85, 1.35, rng());

    colorScratch.setHex(driftPalette[Math.floor(rng() * driftPalette.length)]);
    driftMesh.setColorAt(i, colorScratch);
    writeDriftMatrix(i, 0);
  }
  driftMesh.instanceMatrix.needsUpdate = true;
  if (driftMesh.instanceColor) driftMesh.instanceColor.needsUpdate = true;
  group.add(driftMesh);

  // 4. Bilingual Vintage Street Signposts (19 total across all 10 roads)
  const signGroup = buildSignposts(materials, localDisposables, colliders);
  group.add(signGroup);

  // 5. Cast-Iron Pedestrian Streetlamps
  const lampRes = buildStreetlamps(materials, localDisposables, colliders, treeCanopyBounds);
  group.add(lampRes.group);

  // 6. Coastal Promenade Benches along Shanhaiguan / Seawall Apron
  const benchGroup = buildPromenadeBenches(materials, localDisposables, colliders);
  group.add(benchGroup);

  const update = (elapsedTime: number, dt: number): void => {
    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const safeT = Number.isFinite(elapsedTime) ? elapsedTime : 0;

    if (safeDt > 0) {
      const windX = 0.58 + 0.22 * Math.sin(safeT * 0.35);
      const windZ = -0.34 + 0.18 * Math.cos(safeT * 0.28);

      for (let i = 0; i < DRIFT_COUNT; i++) {
        let nx = driftX[i] + windX * safeDt;
        let nz = driftZ[i] + windZ * safeDt;
        let ny = driftY[i] - driftFallSpeed[i] * safeDt;

        if (nx > 165) nx -= 330;
        else if (nx < -165) nx += 330;
        if (nz > 128) nz -= 266;
        else if (nz < -138) nz += 266;

        const floorY = getGroundHeight(nx, nz) + 0.16;
        if (ny <= floorY) {
          ny = floorY + 8.5 + (i % 7) * 0.45;
        }

        driftX[i] = nx;
        driftY[i] = ny;
        driftZ[i] = nz;
        writeDriftMatrix(i, safeT);
      }
      driftMesh.instanceMatrix.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    for (const item of localDisposables) {
      item.dispose();
    }
    localDisposables.clear();
    group.removeFromParent();
  };

  return {
    group,
    colliders,
    update,
    dispose,
  };
}
