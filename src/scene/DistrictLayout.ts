import { AABB2D, Point2D, clamp, distToPolyline2D, smootherstep } from '../utils/math';

export interface ColliderBox {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  kind: 'building' | 'wall' | 'prop' | 'water';
}

export type TreeSpecies =
  | 'snow_cedar'
  | 'crabapple'
  | 'flowering_peach'
  | 'black_pine'
  | 'crape_myrtle'
  | 'five_point_maple'
  | 'dragon_juniper'
  | 'ginkgo'
  | 'french_sycamore';

export interface RoadSegment {
  id: string;
  roadNameZh: string;
  roadNameEn: string;
  waypoints: readonly Point2D[];
  width: number;
  sidewalkWidth: number;
  treeSpecies: TreeSpecies;
}

export interface VillaParcel {
  id: string;
  roadNameZh: string;
  roadNameEn: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  facingYaw: number;
  style: 'huashi' | 'princess' | 'butterfly' | 'marshal' | 'german' | 'spanish' | 'british';
  isHero: boolean;
}

export interface ZoneInfo {
  id: string;
  nameZh: string;
  nameEn: string;
  landmarkZh?: string;
}

export const WORLD_BOUNDS = {
  minX: -200,
  maxX: 200,
  minZ: -185,
  maxZ: 215,
  waterLineZ(x: number): number {
    const cx = clamp(Number.isFinite(x) ? x : 0, -260, 260);
    return (
      172 +
      26 * Math.exp(-Math.pow((cx + 112) / 40, 2)) -
      12 * Math.exp(-Math.pow((cx - 35) / 68, 2)) +
      8 * Math.exp(-Math.pow((cx - 165) / 45, 2))
    );
  },
} as const;

export const ROAD_SEGMENTS: readonly RoadSegment[] = [
  {
    id: 'zijingguan',
    roadNameZh: '紫荊關路',
    roadNameEn: 'Zijingguan Rd',
    waypoints: [
      { x: -115, z: -145 },
      { x: -115, z: 118 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'snow_cedar',
  },
  {
    id: 'ningwuguan',
    roadNameZh: '寧武關路',
    roadNameEn: 'Ningwuguan Rd',
    waypoints: [
      { x: 0, z: -145 },
      { x: 0, z: 118 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'crabapple',
  },
  {
    id: 'shaoguan',
    roadNameZh: '韶關路',
    roadNameEn: 'Shaoguan Rd',
    waypoints: [
      { x: 115, z: -145 },
      { x: 115, z: 118 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'flowering_peach',
  },
  {
    id: 'wushengguan',
    roadNameZh: '武勝關路',
    roadNameEn: 'Wushengguan Rd',
    waypoints: [
      { x: -175, z: -145 },
      { x: 175, z: -145 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'black_pine',
  },
  {
    id: 'zhengyangguan',
    roadNameZh: '正陽關路',
    roadNameEn: 'Zhengyangguan Rd',
    waypoints: [
      { x: -175, z: -85 },
      { x: 175, z: -85 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'crape_myrtle',
  },
  {
    id: 'jiayuguan',
    roadNameZh: '嘉峪關路',
    roadNameEn: 'Jiayuguan Rd',
    waypoints: [
      { x: -175, z: -28 },
      { x: 175, z: -28 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'five_point_maple',
  },
  {
    id: 'linhuaiguan',
    roadNameZh: '臨淮關路',
    roadNameEn: 'Linhuaiguan Rd',
    waypoints: [
      { x: -175, z: 24 },
      { x: 175, z: 24 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'dragon_juniper',
  },
  {
    id: 'juyongguan',
    roadNameZh: '居庸關路',
    roadNameEn: 'Juyongguan Rd',
    waypoints: [
      { x: -175, z: 72 },
      { x: 175, z: 72 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'ginkgo',
  },
  {
    id: 'shanhaiguan',
    roadNameZh: '山海關路',
    roadNameEn: 'Shanhaiguan Rd',
    waypoints: [
      { x: -175, z: 112 },
      { x: -145, z: 116 },
      { x: -115, z: 118 },
      { x: 0, z: 118 },
      { x: 115, z: 118 },
      { x: 145, z: 114 },
      { x: 175, z: 106 },
    ],
    width: 10,
    sidewalkWidth: 2.5,
    treeSpecies: 'french_sycamore',
  },
  {
    id: 'huanghai',
    roadNameZh: '黃海路',
    roadNameEn: 'Huanghai Rd',
    waypoints: [
      { x: -115, z: 118 },
      { x: -125, z: 134 },
      { x: -132, z: 152 },
      { x: -128, z: 170 },
      { x: -114, z: 182 },
      { x: -94, z: 184 },
    ],
    width: 8,
    sidewalkWidth: 2.0,
    treeSpecies: 'black_pine',
  },
];

export const VILLA_PARCELS: readonly VillaParcel[] = [
  {
    id: 'huashi',
    roadNameZh: '黃海路',
    roadNameEn: 'Huanghai Rd',
    x: -98,
    z: 154,
    width: 24,
    depth: 22,
    facingYaw: 0.25,
    style: 'huashi',
    isHero: true,
  },
  {
    id: 'princess',
    roadNameZh: '居庸關路',
    roadNameEn: 'Juyongguan Rd',
    x: -36,
    z: 48,
    width: 28,
    depth: 22,
    facingYaw: 0,
    style: 'princess',
    isHero: true,
  },
  {
    id: 'marshal',
    roadNameZh: '山海關路',
    roadNameEn: 'Shanhaiguan Rd',
    x: 36,
    z: 95,
    width: 26,
    depth: 20,
    facingYaw: 0,
    style: 'marshal',
    isHero: true,
  },
  {
    id: 'butterfly',
    roadNameZh: '山海關路',
    roadNameEn: 'Shanhaiguan Rd',
    x: 80,
    z: 95,
    width: 26,
    depth: 20,
    facingYaw: 0,
    style: 'butterfly',
    isHero: true,
  },
  {
    id: 'villa_01',
    roadNameZh: '正陽關路',
    roadNameEn: 'Zhengyangguan Rd',
    x: -78,
    z: -115,
    width: 24,
    depth: 22,
    facingYaw: 0,
    style: 'german',
    isHero: false,
  },
  {
    id: 'villa_02',
    roadNameZh: '武勝關路',
    roadNameEn: 'Wushengguan Rd',
    x: 34,
    z: -115,
    width: 24,
    depth: 22,
    facingYaw: Math.PI,
    style: 'british',
    isHero: false,
  },
  {
    id: 'villa_03',
    roadNameZh: '韶關路',
    roadNameEn: 'Shaoguan Rd',
    x: 82,
    z: -115,
    width: 22,
    depth: 22,
    facingYaw: Math.PI / 2,
    style: 'spanish',
    isHero: false,
  },
  {
    id: 'villa_04',
    roadNameZh: '紫荊關路',
    roadNameEn: 'Zijingguan Rd',
    x: -146,
    z: -56,
    width: 22,
    depth: 22,
    facingYaw: Math.PI / 2,
    style: 'german',
    isHero: false,
  },
  {
    id: 'villa_05',
    roadNameZh: '嘉峪關路',
    roadNameEn: 'Jiayuguan Rd',
    x: -80,
    z: -56,
    width: 24,
    depth: 22,
    facingYaw: 0,
    style: 'spanish',
    isHero: false,
  },
  {
    id: 'villa_06',
    roadNameZh: '正陽關路',
    roadNameEn: 'Zhengyangguan Rd',
    x: -32,
    z: -56,
    width: 22,
    depth: 22,
    facingYaw: Math.PI,
    style: 'british',
    isHero: false,
  },
  {
    id: 'villa_07',
    roadNameZh: '嘉峪關路',
    roadNameEn: 'Jiayuguan Rd',
    x: 34,
    z: -56,
    width: 24,
    depth: 22,
    facingYaw: 0,
    style: 'german',
    isHero: false,
  },
  {
    id: 'villa_08',
    roadNameZh: '正陽關路',
    roadNameEn: 'Zhengyangguan Rd',
    x: 82,
    z: -56,
    width: 22,
    depth: 22,
    facingYaw: Math.PI,
    style: 'spanish',
    isHero: false,
  },
  {
    id: 'villa_09',
    roadNameZh: '紫荊關路',
    roadNameEn: 'Zijingguan Rd',
    x: -80,
    z: -2,
    width: 22,
    depth: 20,
    facingYaw: -Math.PI / 2,
    style: 'british',
    isHero: false,
  },
  {
    id: 'villa_10',
    roadNameZh: '嘉峪關路',
    roadNameEn: 'Jiayuguan Rd',
    x: -32,
    z: -2,
    width: 24,
    depth: 20,
    facingYaw: Math.PI,
    style: 'spanish',
    isHero: false,
  },
  {
    id: 'villa_11',
    roadNameZh: '臨淮關路',
    roadNameEn: 'Linhuaiguan Rd',
    x: 78,
    z: -2,
    width: 24,
    depth: 20,
    facingYaw: 0,
    style: 'german',
    isHero: false,
  },
  {
    id: 'villa_12',
    roadNameZh: '紫荊關路',
    roadNameEn: 'Zijingguan Rd',
    x: -82,
    z: 48,
    width: 22,
    depth: 20,
    facingYaw: -Math.PI / 2,
    style: 'german',
    isHero: false,
  },
  {
    id: 'villa_13',
    roadNameZh: '居庸關路',
    roadNameEn: 'Juyongguan Rd',
    x: 34,
    z: 48,
    width: 24,
    depth: 20,
    facingYaw: 0,
    style: 'british',
    isHero: false,
  },
  {
    id: 'villa_14',
    roadNameZh: '韶關路',
    roadNameEn: 'Shaoguan Rd',
    x: 146,
    z: 48,
    width: 22,
    depth: 20,
    facingYaw: -Math.PI / 2,
    style: 'spanish',
    isHero: false,
  },
  {
    id: 'villa_15',
    roadNameZh: '山海關路',
    roadNameEn: 'Shanhaiguan Rd',
    x: -78,
    z: 95,
    width: 24,
    depth: 20,
    facingYaw: 0,
    style: 'british',
    isHero: false,
  },
];

export function getParcelWorldAABB(parcel: VillaParcel): AABB2D {
  const cos = Math.abs(Math.cos(parcel.facingYaw));
  const sin = Math.abs(Math.sin(parcel.facingYaw));
  const halfW = (parcel.width * cos + parcel.depth * sin) * 0.5;
  const halfD = (parcel.width * sin + parcel.depth * cos) * 0.5;
  return {
    minX: parcel.x - halfW,
    maxX: parcel.x + halfW,
    minZ: parcel.z - halfD,
    maxZ: parcel.z + halfD,
  };
}

export function getGroundHeight(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const cx = clamp(x, -300, 300);
  const cz = clamp(z, -300, 300);
  const shoreZ = WORLD_BOUNDS.waterLineZ(cx);
  const dShore = shoreZ - cz;

  // C^infinity shoreline ramp (value = 0, slope = 0.03125 at dShore = 0)
  const shoreBase = 0.5 * Math.tanh(dShore / 16);

  if (dShore <= 0) {
    // Smooth offshore seabed descending to -3.2m (C^2 smooth across dShore = 0)
    return shoreBase - 2.7 * smootherstep(0, -65, dShore);
  }

  // Coastal seawall/bluff rise from sandy beach (~0.4m) to Shanhaiguan shelf (~1.8m)
  const bluffStart = 28 - 14 * Math.exp(-Math.pow((cx + 106) / 46, 2));
  const bluffEnd = bluffStart + 14;
  const districtLift = 1.32 * smootherstep(bluffStart, bluffEnd, dShore);

  // Gentle inland rise from Shanhaiguan Rd (z=118, +1.8m) to northern boundary (z=-195, +6.5m)
  const inlandSlope = 4.7 * smootherstep(118, -195, cz);

  // Huashi rocky cape plateau centered around (-102, 156) -> ~+4.0m
  const capeDistSq = Math.pow((cx + 102) / 44, 2) + Math.pow((cz - 156) / 36, 2);
  const capeMound = 2.25 * Math.exp(-capeDistSq) * smootherstep(0, 14, dShore);

  // Subtle organic ground undulation inland (zero value & slope at shoreline)
  const undulation =
    0.12 * Math.sin(cx * 0.022) * Math.cos(cz * 0.018) * smootherstep(0, 20, dShore);

  return shoreBase + districtLift + inlandSlope + capeMound + undulation;
}

export function isOnRoadOrSidewalk(x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  for (const seg of ROAD_SEGMENTS) {
    const halfCorridor = seg.width * 0.5 + seg.sidewalkWidth;
    if (distToPolyline2D(x, z, seg.waypoints) <= halfCorridor) {
      return true;
    }
  }
  return false;
}

export function isPlayablePosition(x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (
    x < WORLD_BOUNDS.minX + 6 ||
    x > WORLD_BOUNDS.maxX - 6 ||
    z < WORLD_BOUNDS.minZ + 6 ||
    z > WORLD_BOUNDS.maxZ - 6
  ) {
    return false;
  }
  if (z > WORLD_BOUNDS.waterLineZ(x) - 1.5) {
    return false;
  }
  return getGroundHeight(x, z) >= 0.04;
}

const HERO_LANDMARK_META: Record<
  string,
  { radius: number; landmarkZh: string; landmarkEn: string }
> = {
  huashi: { radius: 28, landmarkZh: '花石樓', landmarkEn: 'Huashi Building' },
  princess: { radius: 21, landmarkZh: '公主樓', landmarkEn: 'Princess House' },
  marshal: { radius: 21, landmarkZh: '元帥樓', landmarkEn: "Marshal's House" },
  butterfly: { radius: 21, landmarkZh: '蝴蝶樓', landmarkEn: 'Butterfly House' },
};

export function getZoneAt(x: number, z: number, y?: number): ZoneInfo {
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return {
      id: 'badaguan_district',
      nameZh: '八大關歷史街區',
      nameEn: 'Badaguan Historic District',
    };
  }

  if (y !== undefined && Number.isFinite(y)) {
    const groundY = getGroundHeight(x, z);
    if (y > Math.max(0, groundY) + 10) {
      return {
        id: 'badaguan_panorama',
        nameZh: '八大關歷史街區全景',
        nameEn: 'Badaguan Historic District Panorama',
      };
    }
  }

  let bestHero: { parcel: VillaParcel; dist: number; meta: { landmarkZh: string; landmarkEn: string } } | null =
    null;

  for (const parcel of VILLA_PARCELS) {
    if (!parcel.isHero) continue;
    const meta = HERO_LANDMARK_META[parcel.id];
    if (!meta) continue;
    const dist = Math.hypot(x - parcel.x, z - parcel.z);
    if (dist <= meta.radius && (!bestHero || dist < bestHero.dist)) {
      bestHero = { parcel, dist, meta };
    }
  }

  if (bestHero) {
    return {
      id: bestHero.parcel.id,
      nameZh: `${bestHero.parcel.roadNameZh} · ${bestHero.meta.landmarkZh}`,
      nameEn: `${bestHero.parcel.roadNameEn} · ${bestHero.meta.landmarkEn}`,
      landmarkZh: bestHero.meta.landmarkZh,
    };
  }

  const shoreZ = WORLD_BOUNDS.waterLineZ(x);

  if (x > -60 && z > 125 && z <= shoreZ + 4) {
    return {
      id: 'second_beach',
      nameZh: '第二海水浴場',
      nameEn: 'Second Bathing Beach',
    };
  }

  let nearestRoad: RoadSegment | null = null;
  let nearestRoadDist = 18;
  for (const seg of ROAD_SEGMENTS) {
    const d = distToPolyline2D(x, z, seg.waypoints);
    if (d <= nearestRoadDist) {
      nearestRoadDist = d;
      nearestRoad = seg;
    }
  }

  if (nearestRoad) {
    return {
      id: nearestRoad.id,
      nameZh: nearestRoad.roadNameZh,
      nameEn: nearestRoad.roadNameEn,
    };
  }

  if (z > shoreZ + 4) {
    return {
      id: 'taiping_bay',
      nameZh: '太平灣海濱',
      nameEn: 'Taiping Bay Coast',
    };
  }

  return {
    id: 'badaguan_district',
    nameZh: '八大關歷史街區',
    nameEn: 'Badaguan Historic District',
  };
}
