import { getGroundHeight } from './DistrictLayout';

export const EYE_HEIGHT = 1.75;

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  id: string;
  nameZh: string;
  nameEn: string;
  position: Vec3Tuple;
  lookAt: Vec3Tuple;
  yaw: number;
  pitch: number;
  elevated?: boolean;
}

export interface CameraPreset extends CameraPose {
  key: '1' | '2' | '3' | '4' | '5' | '6';
  shortZh: string;
}

export function computeYawPitch(
  position: Vec3Tuple,
  lookAt: Vec3Tuple,
): { yaw: number; pitch: number } {
  const dx = lookAt.x - position.x;
  const dy = lookAt.y - position.y;
  const dz = lookAt.z - position.z;
  const horiz = Math.hypot(dx, dz);

  let yaw = Math.atan2(-dx, -dz);
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;

  const pitch = Math.atan2(dy, Math.max(1e-6, horiz));
  return { yaw, pitch };
}

function makePose(
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  z: number,
  lookAt: Vec3Tuple,
  elevated = false,
): CameraPose {
  const position: Vec3Tuple = { x, y, z };
  const { yaw, pitch } = computeYawPitch(position, lookAt);
  return {
    id,
    nameZh,
    nameEn,
    position,
    lookAt,
    yaw,
    pitch,
    elevated,
  };
}

function makePreset(
  key: '1' | '2' | '3' | '4' | '5' | '6',
  id: string,
  shortZh: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  z: number,
  lookAt: Vec3Tuple,
  elevated = false,
): CameraPreset {
  return {
    key,
    shortZh,
    ...makePose(id, nameZh, nameEn, x, y, z, lookAt, elevated),
  };
}

export const INITIAL_VISTA: CameraPose = makePose(
  'initial',
  '寧武關路街景',
  'Ningwuguan Rd Vista',
  0,
  getGroundHeight(0, 96) + EYE_HEIGHT,
  96,
  { x: -4, y: 5.0, z: 24 },
  false,
);

export const INITIAL_VIEW: CameraPose = INITIAL_VISTA;

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  makePreset(
    '1',
    'panorama',
    '八大關全景',
    '俯瞰八大關全景',
    'Panorama Overview',
    10,
    42.0,
    194,
    { x: -18, y: 7.0, z: 82 },
    true,
  ),
  makePreset(
    '2',
    'huashi',
    '花石樓海岬',
    '花石樓海岬',
    'Huashi Building & Sea Cape',
    -122,
    getGroundHeight(-122, 151) + EYE_HEIGHT,
    151,
    { x: -98, y: 14.5, z: 154 },
    false,
  ),
  makePreset(
    '3',
    'princess',
    '公主樓銀杏',
    '公主樓與居庸關銀杏',
    'Princess House & Juyongguan Ginkgo',
    -4,
    getGroundHeight(-4, 72) + EYE_HEIGHT,
    72,
    { x: -36, y: 10.5, z: 48 },
    false,
  ),
  makePreset(
    '4',
    'butterfly',
    '蝴蝶樓法桐',
    '蝴蝶樓與山海關法桐',
    'Butterfly House & Shanhaiguan Sycamores',
    66,
    getGroundHeight(66, 121.5) + EYE_HEIGHT,
    121.5,
    { x: 80, y: 7.2, z: 95 },
    false,
  ),
  makePreset(
    '5',
    'jiayuguan',
    '嘉峪關楓林',
    '嘉峪關五角楓長廊',
    'Jiayuguan Maple Corridor',
    -72,
    getGroundHeight(-72, -28) + EYE_HEIGHT,
    -28,
    { x: 35, y: 6.8, z: -28 },
    false,
  ),
  makePreset(
    '6',
    'second_beach',
    '第二海水浴場',
    '第二海水浴場海濱',
    'Second Bathing Beach Promenade',
    -18,
    getGroundHeight(-18, 156) + EYE_HEIGHT,
    156,
    { x: 22, y: 5.2, z: 128.5 },
    false,
  ),
];

export const PRESETS: readonly CameraPreset[] = CAMERA_PRESETS;
