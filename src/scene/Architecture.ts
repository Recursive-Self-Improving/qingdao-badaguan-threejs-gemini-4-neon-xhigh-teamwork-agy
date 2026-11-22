import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ColliderBox,
  VILLA_PARCELS,
  VillaParcel,
  getGroundHeight,
} from './DistrictLayout';
import { ProceduralMaterialSet } from './ProceduralMaterials';
import { buildHuashiBuilding } from './architecture/HuashiBuilding';
import { buildPrincessHouse } from './architecture/PrincessHouse';
import { buildButterflyHouse } from './architecture/ButterflyHouse';
import { buildMarshalsHouse } from './architecture/MarshalsHouse';
import { buildInfillVilla } from './architecture/InfillVillas';

export interface LandmarkAnchor {
  x: number;
  y: number;
  z: number;
  nameZh: string;
  nameEn: string;
}

export interface ArchitectureBuildResult {
  group: THREE.Group;
  colliders: ColliderBox[];
  landmarkAnchors: Record<string, LandmarkAnchor>;
  dispose(): void;
}

export interface ParcelContext {
  parcel: VillaParcel;
  datumY: number;
  minParcelY: number;
  maxParcelY: number;
  minBldY: number;
  maxBldY: number;
  skirtBottomLocalY: number;
}

export type StuccoGetter = (hex: string) => THREE.MeshStandardMaterial;

export const UV_SCALE = {
  graniteAshlar: 0.45,
  mushroomStone: 0.4,
  terracottaRoof: 0.5,
  stucco: 0.38,
  brick: 0.85,
  cobblestone: 0.5,
  curbStone: 0.5,
  darkTimber: 0.5,
} as const;

export function localToWorldXZ(
  parcel: VillaParcel,
  lx: number,
  lz: number,
): { x: number; z: number } {
  const cos = Math.cos(parcel.facingYaw);
  const sin = Math.sin(parcel.facingYaw);
  return {
    x: parcel.x + lx * cos + lz * sin,
    z: parcel.z - lx * sin + lz * cos,
  };
}

export function groundLocalY(ctx: ParcelContext, lx: number, lz: number): number {
  const { x, z } = localToWorldXZ(ctx.parcel, lx, lz);
  return getGroundHeight(x, z) - ctx.datumY;
}

export function createParcelContext(
  parcel: VillaParcel,
  plinthAboveMaxBld = 0.4,
  bldHalfW = parcel.width * 0.38,
  bldHalfD = parcel.depth * 0.38,
): ParcelContext {
  let minParcelY = Infinity;
  let maxParcelY = -Infinity;
  let minBldY = Infinity;
  let maxBldY = -Infinity;

  const halfW = parcel.width * 0.5;
  const halfD = parcel.depth * 0.5;

  for (let ix = 0; ix < 5; ix++) {
    const tx = ix / 4;
    const lx = -halfW + tx * parcel.width;
    const blx = -bldHalfW + tx * bldHalfW * 2;
    for (let iz = 0; iz < 5; iz++) {
      const tz = iz / 4;
      const lz = -halfD + tz * parcel.depth;
      const blz = -bldHalfD + tz * bldHalfD * 2;

      const pw = localToWorldXZ(parcel, lx, lz);
      const py = getGroundHeight(pw.x, pw.z);
      if (py < minParcelY) minParcelY = py;
      if (py > maxParcelY) maxParcelY = py;

      const bw = localToWorldXZ(parcel, blx, blz);
      const by = getGroundHeight(bw.x, bw.z);
      if (by < minBldY) minBldY = by;
      if (by > maxBldY) maxBldY = by;
    }
  }

  const datumY = maxBldY + plinthAboveMaxBld;
  const skirtBottomLocalY = minParcelY - 0.68 - datumY;

  return {
    parcel,
    datumY,
    minParcelY,
    maxParcelY,
    minBldY,
    maxBldY,
    skirtBottomLocalY,
  };
}

export function localBoxToCollider(
  parcel: VillaParcel,
  id: string,
  kind: ColliderBox['kind'],
  minLX: number,
  maxLX: number,
  minLZ: number,
  maxLZ: number,
): ColliderBox {
  const halfW = parcel.width * 0.5 - 0.04;
  const halfD = parcel.depth * 0.5 - 0.04;

  const x0 = Math.max(-halfW, Math.min(halfW, Math.min(minLX, maxLX)));
  const x1 = Math.max(-halfW, Math.min(halfW, Math.max(minLX, maxLX)));
  const z0 = Math.max(-halfD, Math.min(halfD, Math.min(minLZ, maxLZ)));
  const z1 = Math.max(-halfD, Math.min(halfD, Math.max(minLZ, maxLZ)));

  const corners = [
    localToWorldXZ(parcel, x0, z0),
    localToWorldXZ(parcel, x1, z0),
    localToWorldXZ(parcel, x0, z1),
    localToWorldXZ(parcel, x1, z1),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.z < minZ) minZ = c.z;
    if (c.z > maxZ) maxZ = c.z;
  }

  return { id, minX, maxX, minZ, maxZ, kind };
}

export function addColliderSpan(
  colliders: ColliderBox[],
  parcel: VillaParcel,
  idPrefix: string,
  kind: ColliderBox['kind'],
  minLX: number,
  maxLX: number,
  minLZ: number,
  maxLZ: number,
  maxSegLen = 2.0,
): void {
  const x0 = Math.min(minLX, maxLX);
  const x1 = Math.max(minLX, maxLX);
  const z0 = Math.min(minLZ, maxLZ);
  const z1 = Math.max(minLZ, maxLZ);

  const sin = Math.abs(Math.sin(parcel.facingYaw));
  const cos = Math.abs(Math.cos(parcel.facingYaw));
  const isCardinal = sin < 1e-4 || cos < 1e-4;

  if (isCardinal) {
    colliders.push(localBoxToCollider(parcel, idPrefix, kind, x0, x1, z0, z1));
    return;
  }

  const dx = x1 - x0;
  const dz = z1 - z0;
  const majorLen = Math.max(dx, dz);
  const segments = Math.max(1, Math.ceil(majorLen / maxSegLen));

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    if (dx >= dz) {
      colliders.push(
        localBoxToCollider(
          parcel,
          `${idPrefix}_${i}`,
          kind,
          x0 + dx * t0,
          x0 + dx * t1,
          z0,
          z1,
        ),
      );
    } else {
      colliders.push(
        localBoxToCollider(
          parcel,
          `${idPrefix}_${i}`,
          kind,
          x0,
          x1,
          z0 + dz * t0,
          z0 + dz * t1,
        ),
      );
    }
  }
}

export function addWallColliderSpan(
  colliders: ColliderBox[],
  parcel: VillaParcel,
  idPrefix: string,
  minLX: number,
  maxLX: number,
  minLZ: number,
  maxLZ: number,
): void {
  addColliderSpan(colliders, parcel, idPrefix, 'wall', minLX, maxLX, minLZ, maxLZ, 2.0);
}

export function applyBoxMetricUVs(
  geo: THREE.BufferGeometry,
  w: number,
  h: number,
  d: number,
  scaleU: number,
  scaleV = scaleU,
): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  if (!pos || !norm || !uv) return geo;

  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);

    if (nx > 0.5) {
      uv.setXY(i, (pz + d * 0.5) * scaleU, (py + h * 0.5) * scaleV);
    } else if (ny > 0.5) {
      uv.setXY(i, (px + w * 0.5) * scaleU, (pz + d * 0.5) * scaleU);
    } else {
      uv.setXY(i, (px + w * 0.5) * scaleU, (py + h * 0.5) * scaleV);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function scaleGeometryUVs(
  geo: THREE.BufferGeometry,
  scaleU: number,
  scaleV = scaleU,
): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
  }
  uv.needsUpdate = true;
  return geo;
}

export function applyExtrudeMetricUVs(
  geo: THREE.BufferGeometry,
  scaleU: number,
  scaleV = scaleU,
): THREE.BufferGeometry {
  return scaleGeometryUVs(geo, scaleU, scaleV);
}

const ALLOWED_MERGE_ATTRS = new Set(['position', 'normal', 'uv']);

function normalizeForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const nonIndexed = geo.index !== null ? geo.toNonIndexed() : geo;
  if (nonIndexed !== geo) {
    geo.dispose();
  }
  for (const key of Object.keys(nonIndexed.attributes)) {
    if (!ALLOWED_MERGE_ATTRS.has(key)) {
      nonIndexed.deleteAttribute(key);
    }
  }
  if (!nonIndexed.getAttribute('normal')) {
    nonIndexed.computeVertexNormals();
  }
  if (!nonIndexed.getAttribute('uv')) {
    const count = nonIndexed.getAttribute('position').count;
    nonIndexed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  return nonIndexed;
}

interface BucketEntry {
  material: THREE.Material;
  castShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

export class MaterialBatcher {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly matIds = new WeakMap<THREE.Material, number>();
  private nextMatId = 1;

  private getKey(material: THREE.Material, castShadow: boolean): string {
    let id = this.matIds.get(material);
    if (id === undefined) {
      id = this.nextMatId++;
      this.matIds.set(material, id);
    }
    return `${id}:${castShadow ? 1 : 0}`;
  }

  add(
    material: THREE.Material,
    geo: THREE.BufferGeometry,
    matrix?: THREE.Matrix4,
    castShadow = true,
  ): void {
    const prepared = normalizeForMerge(geo);
    if (matrix) {
      prepared.applyMatrix4(matrix);
    }
    const key = this.getKey(material, castShadow);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material, castShadow, geometries: [] };
      this.buckets.set(key, bucket);
    }
    bucket.geometries.push(prepared);
  }

  addBox(
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    cx: number,
    cy: number,
    cz: number,
    uvScale = 0.45,
    rotX = 0,
    rotY = 0,
    rotZ = 0,
    castShadow = true,
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (uvScale > 0) {
      applyBoxMetricUVs(geo, w, h, d, uvScale, uvScale);
    }
    const m = new THREE.Matrix4();
    const euler = new THREE.Euler(rotX, rotY, rotZ, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);
    m.compose(new THREE.Vector3(cx, cy, cz), quat, new THREE.Vector3(1, 1, 1));
    this.add(material, geo, m, castShadow);
  }

  addWorldSlopeBox(
    material: THREE.Material,
    w: number,
    topY: number,
    botY: number,
    d: number,
    cx: number,
    cz: number,
    uvScale = 0.45,
    rotY = 0,
    castShadow = true,
  ): void {
    const h = Math.max(0.08, topY - botY);
    const cy = (topY + botY) * 0.5;
    this.addBox(material, w, h, d, cx, cy, cz, uvScale, 0, rotY, 0, castShadow);
  }

  flush(
    targetGroup: THREE.Group,
    prefix: string,
    materials: ProceduralMaterialSet,
    disposableGeometries: THREE.BufferGeometry[],
  ): void {
    let idx = 0;
    for (const bucket of this.buckets.values()) {
      if (bucket.geometries.length === 0) continue;
      const merged = mergeGeometries(bucket.geometries, false);
      for (const g of bucket.geometries) {
        g.dispose();
      }
      bucket.geometries.length = 0;
      if (!merged) continue;

      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      disposableGeometries.push(merged);

      const isGlass =
        bucket.material === materials.windowGlass ||
        bucket.material === materials.stainedGlass;
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.name = `${prefix}_mesh_${idx++}`;
      mesh.receiveShadow = true;
      mesh.castShadow = bucket.castShadow && !isGlass;
      targetGroup.add(mesh);
    }
    this.buckets.clear();
  }
}

export function addPitchedSlopeSlab(
  batcher: MaterialBatcher,
  material: THREE.Material,
  x0: number,
  x1: number,
  zLow: number,
  yLow: number,
  zHigh: number,
  yHigh: number,
  thickness: number,
  uvScale: number,
  rotY = 0,
): void {
  const lenX = Math.abs(x1 - x0);
  const cx = (x0 + x1) * 0.5;
  const dz = zHigh - zLow;
  const dy = yHigh - yLow;
  const slopeLen = Math.hypot(dz, dy);
  if (slopeLen < 1e-4) return;

  const towardsNegZ = dz < 0;
  const absDz = Math.abs(dz);
  const angleX = towardsNegZ ? Math.atan2(dy, absDz) : -Math.atan2(dy, absDz);

  const geo = new THREE.BoxGeometry(lenX, thickness, slopeLen);
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  if (pos && norm && uv) {
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(norm.getX(i));
      const ny = Math.abs(norm.getY(i));
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (ny > 0.5) {
        const upSlope = towardsNegZ ? slopeLen * 0.5 - pz : pz + slopeLen * 0.5;
        uv.setXY(i, (px + lenX * 0.5) * uvScale, upSlope * uvScale);
      } else if (nx > 0.5) {
        uv.setXY(i, (pz + slopeLen * 0.5) * uvScale, (py + thickness * 0.5) * uvScale);
      } else {
        uv.setXY(i, (px + lenX * 0.5) * uvScale, (py + thickness * 0.5) * uvScale);
      }
    }
    uv.needsUpdate = true;
  }

  // Outward unit normal of top face after rotation.x = angleX: (0, cos(angleX), sin(angleX))
  const nY = Math.cos(angleX);
  const nZ = Math.sin(angleX);

  const midZ = (zLow + zHigh) * 0.5 - nZ * (thickness * 0.5);
  const midY = (yLow + yHigh) * 0.5 - nY * (thickness * 0.5);

  const localMat = new THREE.Matrix4().compose(
    new THREE.Vector3(cx, midY, midZ),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(angleX, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  if (rotY !== 0) {
    localMat.premultiply(new THREE.Matrix4().makeRotationY(rotY));
  }
  batcher.add(material, geo, localMat, true);
}

export function addXPitchedSlopeSlab(
  batcher: MaterialBatcher,
  material: THREE.Material,
  z0: number,
  z1: number,
  xLow: number,
  yLow: number,
  xHigh: number,
  yHigh: number,
  thickness: number,
  uvScale: number,
): void {
  const lenZ = Math.abs(z1 - z0);
  const cz = (z0 + z1) * 0.5;
  const dx = xHigh - xLow;
  const dy = yHigh - yLow;
  const slopeLen = Math.hypot(dx, dy);
  if (slopeLen < 1e-4) return;

  const towardsNegX = dx < 0;
  const absDx = Math.abs(dx);
  const angleZ = towardsNegX ? -Math.atan2(dy, absDx) : Math.atan2(dy, absDx);

  const geo = new THREE.BoxGeometry(slopeLen, thickness, lenZ);
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  if (pos && norm && uv) {
    for (let i = 0; i < pos.count; i++) {
      const ny = Math.abs(norm.getY(i));
      const nz = Math.abs(norm.getZ(i));
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (ny > 0.5) {
        const upSlope = towardsNegX ? slopeLen * 0.5 - px : px + slopeLen * 0.5;
        uv.setXY(i, (pz + lenZ * 0.5) * uvScale, upSlope * uvScale);
      } else if (nz > 0.5) {
        uv.setXY(i, (px + slopeLen * 0.5) * uvScale, (py + thickness * 0.5) * uvScale);
      } else {
        uv.setXY(i, (pz + lenZ * 0.5) * uvScale, (py + thickness * 0.5) * uvScale);
      }
    }
    uv.needsUpdate = true;
  }

  // Outward unit normal of top face after rotation.z = angleZ: (-sin(angleZ), cos(angleZ), 0)
  const nX = -Math.sin(angleZ);
  const nY = Math.cos(angleZ);

  const midX = (xLow + xHigh) * 0.5 - nX * (thickness * 0.5);
  const midY = (yLow + yHigh) * 0.5 - nY * (thickness * 0.5);

  const localMat = new THREE.Matrix4().compose(
    new THREE.Vector3(midX, midY, cz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angleZ)),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add(material, geo, localMat, true);
}

export function addHippedRoof(
  batcher: MaterialBatcher,
  roofMat: THREE.Material,
  soffitMat: THREE.Material,
  cx: number,
  eaveY: number,
  cz: number,
  spanX: number,
  spanZ: number,
  ridgeH: number,
  ridgeLenX: number,
  uvScale: number,
): void {
  const hx = spanX * 0.5;
  const hz = spanZ * 0.5;
  const halfR = Math.max(0, Math.min(ridgeLenX * 0.5, hx - 0.35));
  const ridgeY = eaveY + ridgeH;
  const slopeEaveY = eaveY - 0.06;

  const positions: number[] = [];
  const uvs: number[] = [];

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    au: number,
    av: number,
    bx: number,
    by: number,
    bz: number,
    bu: number,
    bv: number,
    cpx: number,
    cpy: number,
    cpz: number,
    cu: number,
    cv: number,
  ): void => {
    positions.push(ax, ay, az, bx, by, bz, cpx, cpy, cpz);
    uvs.push(au, av, bu, bv, cu, cv);
  };

  const effRidgeH = ridgeY - slopeEaveY;
  const slopeZ = Math.hypot(hz, effRidgeH);
  const slopeX = Math.hypot(hx - halfR, effRidgeH);

  // South slope
  pushTri(
    cx - hx, slopeEaveY, cz + hz, 0, 0,
    cx + hx, slopeEaveY, cz + hz, spanX * uvScale, 0,
    cx + halfR, ridgeY, cz, (hx + halfR) * uvScale, slopeZ * uvScale,
  );
  if (halfR > 1e-4) {
    pushTri(
      cx - hx, slopeEaveY, cz + hz, 0, 0,
      cx + halfR, ridgeY, cz, (hx + halfR) * uvScale, slopeZ * uvScale,
      cx - halfR, ridgeY, cz, (hx - halfR) * uvScale, slopeZ * uvScale,
    );
  }

  // North slope
  pushTri(
    cx + hx, slopeEaveY, cz - hz, 0, 0,
    cx - hx, slopeEaveY, cz - hz, spanX * uvScale, 0,
    cx - halfR, ridgeY, cz, (hx + halfR) * uvScale, slopeZ * uvScale,
  );
  if (halfR > 1e-4) {
    pushTri(
      cx + hx, slopeEaveY, cz - hz, 0, 0,
      cx - halfR, ridgeY, cz, (hx + halfR) * uvScale, slopeZ * uvScale,
      cx + halfR, ridgeY, cz, (hx - halfR) * uvScale, slopeZ * uvScale,
    );
  }

  // East hip triangle
  pushTri(
    cx + hx, slopeEaveY, cz + hz, 0, 0,
    cx + hx, slopeEaveY, cz - hz, spanZ * uvScale, 0,
    cx + halfR, ridgeY, cz, hz * uvScale, slopeX * uvScale,
  );

  // West hip triangle
  pushTri(
    cx - hx, slopeEaveY, cz - hz, 0, 0,
    cx - hx, slopeEaveY, cz + hz, spanZ * uvScale, 0,
    cx - halfR, ridgeY, cz, hz * uvScale, slopeX * uvScale,
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  batcher.add(roofMat, geo, undefined, true);

  // Enclosed soffit plate under overhanging eaves, strictly sunk below both wall-top plane (eaveY)
  // and minimum roof slope elevation at soffitInset so soffit edges never poke through roof tiles.
  const soffitInset = Math.min(0.08, Math.min(hx, hz) * 0.15);
  const slopeAtInset =
    slopeEaveY +
    soffitInset *
      Math.min(effRidgeH / Math.max(0.1, hz), effRidgeH / Math.max(0.1, hx - halfR));
  const soffitTop = Math.min(eaveY - 0.025, slopeAtInset - 0.008);
  const soffitH = 0.13;
  batcher.addBox(
    soffitMat,
    spanX - soffitInset * 2,
    soffitH,
    spanZ - soffitInset * 2,
    cx,
    soffitTop - soffitH * 0.5,
    cz,
    UV_SCALE.darkTimber,
  );

  // Crisp terracotta eave fascia skirt around all 4 outer roof perimeter edges:
  // top sits at slopeEaveY (<= roof slope everywhere, zero tile poke-through),
  // depth overlaps soffit plate horizontally & vertically for zero sky slit from any angle.
  const fasciaDepth = Math.min(soffitInset + 0.02, Math.min(hx, hz) * 0.25);
  const fasciaH = 0.066;
  const fasciaCY = slopeEaveY - fasciaH * 0.5;
  batcher.addBox(roofMat, spanX, fasciaH, fasciaDepth, cx, fasciaCY, cz + hz - fasciaDepth * 0.5, uvScale);
  batcher.addBox(roofMat, spanX, fasciaH, fasciaDepth, cx, fasciaCY, cz - hz + fasciaDepth * 0.5, uvScale);
  const ewFasciaLenZ = Math.max(0.05, spanZ - fasciaDepth * 2);
  batcher.addBox(roofMat, fasciaDepth, fasciaH, ewFasciaLenZ, cx + hx - fasciaDepth * 0.5, fasciaCY, cz, uvScale);
  batcher.addBox(roofMat, fasciaDepth, fasciaH, ewFasciaLenZ, cx - hx + fasciaDepth * 0.5, fasciaCY, cz, uvScale);

  // Solid ridge cap along top ridge
  if (halfR > 0.05) {
    batcher.addBox(roofMat, halfR * 2 + 0.18, 0.18, 0.22, cx, ridgeY + 0.02, cz, uvScale);
  }
}

export function addWindowUnit(
  batcher: MaterialBatcher,
  glassMat: THREE.Material,
  frameMat: THREE.Material,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  rotY: number,
  mullionCols = 2,
  mullionRows = 2,
  withShutters = false,
  shutterMat?: THREE.Material,
  mullionsCastShadow = false,
): void {
  const rotMat = new THREE.Matrix4().makeRotationY(rotY);
  const posMat = new THREE.Matrix4().makeTranslation(cx, cy, cz);
  const baseMat = new THREE.Matrix4().multiplyMatrices(posMat, rotMat);

  const pushLocal = (
    mat: THREE.Material,
    bw: number,
    bh: number,
    bd: number,
    lx: number,
    ly: number,
    lz: number,
    castShadow: boolean,
  ): void => {
    const g = new THREE.BoxGeometry(bw, bh, bd);
    if (mat === glassMat) {
      // keep [0,1] UV on stained glass or simple UV on glass
    } else {
      applyBoxMetricUVs(g, bw, bh, bd, 0.5, 0.5);
    }
    const m = new THREE.Matrix4().makeTranslation(lx, ly, lz);
    m.premultiply(baseMat);
    batcher.add(mat, g, m, castShadow);
  };

  // Glass pane: back buried inside wall (-0.01), front proud at +0.025
  pushLocal(glassMat, Math.max(0.18, w - 0.1), Math.max(0.24, h - 0.1), 0.036, 0, 0, 0.008, false);

  // Frame bars (sill, lintel, left & right jambs) proud at +0.068
  const frameT = 0.085;
  const frameD = 0.082;
  // Left & Right jambs
  pushLocal(frameMat, frameT, h, frameD, -w * 0.5 + frameT * 0.5, 0, 0.028, true);
  pushLocal(frameMat, frameT, h, frameD, w * 0.5 - frameT * 0.5, 0, 0.028, true);
  // Lintel & projecting Sill
  pushLocal(frameMat, w + 0.1, frameT * 1.1, frameD + 0.018, 0, h * 0.5 - frameT * 0.45, 0.035, true);
  pushLocal(frameMat, w + 0.14, frameT * 1.2, frameD + 0.045, 0, -h * 0.5 + frameT * 0.4, 0.046, true);

  // Thin mullions sitting cleanly in front of glass (+0.045)
  for (let c = 1; c < mullionCols; c++) {
    const mx = -w * 0.5 + (w * c) / mullionCols;
    pushLocal(frameMat, 0.032, h - frameT * 1.5, 0.03, mx, 0, 0.032, mullionsCastShadow);
  }
  for (let r = 1; r < mullionRows; r++) {
    const my = -h * 0.5 + (h * r) / mullionRows;
    pushLocal(frameMat, w - frameT * 1.5, 0.032, 0.032, 0, my, 0.034, mullionsCastShadow);
  }

  if (withShutters && shutterMat) {
    const sw = Math.min(0.42, w * 0.42);
    pushLocal(shutterMat, sw, h - 0.04, 0.048, -w * 0.5 - sw * 0.5 - 0.03, 0, 0.024, true);
    pushLocal(shutterMat, sw, h - 0.04, 0.048, w * 0.5 + sw * 0.5 + 0.03, 0, 0.024, true);
  }
}

export interface CourtyardOptions {
  wallMaterial: THREE.Material;
  wallUvScale: number;
  capMaterial: THREE.Material;
  ironMaterial: THREE.Material;
  walkMaterial: THREE.Material;
  gateHalfWidth?: number;
  wallHeightAboveGround?: number;
  railHeight?: number;
  pierHeightAboveGround?: number;
  walkEndLZ?: number;
  inset?: number;
  hasIronRailing?: boolean;
}

export function addCourtyardEnclosure(
  ctx: ParcelContext,
  batcher: MaterialBatcher,
  colliders: ColliderBox[],
  options: CourtyardOptions,
): void {
  const { parcel } = ctx;
  const inset = options.inset ?? 0.45;
  const xMin = -parcel.width * 0.5 + inset;
  const xMax = parcel.width * 0.5 - inset;
  const zMin = -parcel.depth * 0.5 + inset;
  const zMax = parcel.depth * 0.5 - inset;

  const gateHalfW = options.gateHalfWidth ?? 1.8;
  const wallH = options.wallHeightAboveGround ?? 0.68;
  const railH = options.railHeight ?? 0.48;
  const pierH = options.pierHeightAboveGround ?? 1.28;
  const hasIron = options.hasIronRailing ?? true;

  const addPier = (lx: number, lz: number, size: number, height: number): void => {
    const gy = groundLocalY(ctx, lx, lz);
    const bot = gy - 0.45;
    const top = gy + height;
    batcher.addWorldSlopeBox(
      options.wallMaterial,
      size,
      top,
      bot,
      size,
      lx,
      lz,
      options.wallUvScale,
      0,
      true,
    );
    batcher.addBox(
      options.capMaterial,
      size + 0.09,
      0.1,
      size + 0.09,
      lx,
      top + 0.05,
      lz,
      UV_SCALE.curbStone,
      0,
      0,
      0,
      true,
    );
  };

  const addWallRun = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    bayLenTarget = 3.0,
    withIntermediatePiers = true,
  ): void => {
    const totalLen = Math.hypot(bx - ax, bz - az);
    if (totalLen < 0.4) return;
    const bays = Math.max(1, Math.round(totalLen / bayLenTarget));
    const angle = Math.atan2(bx - ax, bz - az); // 0 along +Z, PI/2 along +X

    for (let i = 0; i < bays; i++) {
      const t0 = i / bays;
      const t1 = (i + 1) / bays;
      const x0 = ax + (bx - ax) * t0;
      const z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1;
      const z1 = az + (bz - az) * t1;

      const y0 = groundLocalY(ctx, x0, z0);
      const yMid = groundLocalY(ctx, (x0 + x1) * 0.5, (z0 + z1) * 0.5);
      const y1 = groundLocalY(ctx, x1, z1);

      const minY = Math.min(y0, yMid, y1);
      const maxY = Math.max(y0, yMid, y1);
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;

      const wallBot = minY - 0.45;
      const wallTop = maxY + wallH;

      const wallBayLen = withIntermediatePiers ? Math.max(0.2, segLen - 0.04) : segLen + 0.02;
      const capBayLen = withIntermediatePiers ? Math.max(0.2, segLen - 0.02) : segLen + 0.02;
      const railBayLen = withIntermediatePiers ? Math.max(0.15, segLen - 0.16) : segLen + 0.02;

      // Stone wall bay aligned along segment
      batcher.addWorldSlopeBox(
        options.wallMaterial,
        0.34,
        wallTop,
        wallBot,
        wallBayLen,
        mx,
        mz,
        options.wallUvScale,
        angle,
        true,
      );
      // Coping slab
      batcher.addBox(
        options.capMaterial,
        0.4,
        0.07,
        capBayLen,
        mx,
        wallTop + 0.035,
        mz,
        UV_SCALE.curbStone,
        0,
        angle,
        0,
        true,
      );

      if (hasIron) {
        const railBot = wallTop + 0.07;
        const railTop = railBot + railH;
        // Top & bottom iron rails
        batcher.addBox(
          options.ironMaterial,
          0.04,
          0.04,
          railBayLen,
          mx,
          railBot + 0.06,
          mz,
          0,
          0,
          angle,
          0,
          true,
        );
        batcher.addBox(
          options.ironMaterial,
          0.04,
          0.04,
          railBayLen,
          mx,
          railTop - 0.04,
          mz,
          0,
          0,
          angle,
          0,
          true,
        );
        // Vertical pickets every ~0.35m
        const picketSpan = withIntermediatePiers ? segLen - 0.25 : segLen;
        const picketCount = Math.max(2, Math.floor(picketSpan / 0.36));
        for (let p = 0; p < picketCount; p++) {
          const pt = (p + 0.5) / picketCount;
          const px = x0 + (x1 - x0) * pt;
          const pz = z0 + (z1 - z0) * pt;
          batcher.addBox(
            options.ironMaterial,
            0.032,
            railH,
            0.032,
            px,
            railBot + railH * 0.5,
            pz,
            0,
            0,
            angle,
            0,
            true,
          );
        }
      }

      if (withIntermediatePiers && i > 0) {
        addPier(x0, z0, 0.44, pierH);
      }
    }
  };

  // 4 corners
  addPier(xMin, zMin, 0.48, pierH);
  addPier(xMax, zMin, 0.48, pierH);
  addPier(xMin, zMax, 0.48, pierH);
  addPier(xMax, zMax, 0.48, pierH);

  // Twin gate piers at +Z front
  const gatePierOffset = gateHalfW + 0.28;
  addPier(-gatePierOffset, zMax, 0.56, pierH + 0.28);
  addPier(gatePierOffset, zMax, 0.56, pierH + 0.28);

  // Back wall (-Z), West wall (-X), East wall (+X)
  addWallRun(xMin + 0.2, zMin, xMax - 0.2, zMin, 3.2, true);
  addWallRun(xMin, zMin + 0.2, xMin, zMax - 0.2, 3.2, true);
  addWallRun(xMax, zMin + 0.2, xMax, zMax - 0.2, 3.2, true);

  // Split front wall (+Z) leaving [ -gateHalfW, +gateHalfW ] completely open
  addWallRun(xMin + 0.2, zMax, -gatePierOffset - 0.24, zMax, 2.8, false);
  addWallRun(gatePierOffset + 0.24, zMax, xMax - 0.2, zMax, 2.8, false);

  // Open double wrought-iron gate leaves swung inward (~76 degrees) so center path is wide open
  const leafWidth = Math.max(1.1, gateHalfW - 0.22);
  const gateH = 1.24;
  const openAngle = 1.32; // ~75.6 deg inward
  for (const side of [-1, 1] as const) {
    const hingeX = side * gateHalfW;
    const hingeZ = zMax - 0.08;
    const hingeGY = groundLocalY(ctx, hingeX, hingeZ);
    const rotY = side * openAngle; // swings inward (-Z)
    // Center of leaf in local X is (-side * leafWidth * 0.5) rotated around Y
    const dirX = -side * Math.cos(rotY);
    const dirZ = -Math.sin(Math.abs(rotY)); // inward -Z
    const leafCX = hingeX + dirX * (leafWidth * 0.5);
    const leafCZ = hingeZ + dirZ * (leafWidth * 0.5);
    const midY = hingeGY + gateH * 0.5 + 0.08;

    // Frame rails (top, mid, bottom, stiles)
    batcher.addBox(options.ironMaterial, leafWidth, 0.045, 0.045, leafCX, hingeGY + 0.16, leafCZ, 0, 0, side * -openAngle, 0, true);
    batcher.addBox(options.ironMaterial, leafWidth, 0.045, 0.045, leafCX, hingeGY + gateH * 0.56, leafCZ, 0, 0, side * -openAngle, 0, true);
    batcher.addBox(options.ironMaterial, leafWidth, 0.05, 0.045, leafCX, hingeGY + gateH, leafCZ, 0, 0, side * -openAngle, 0, true);

    const bars = 5;
    for (let b = 0; b <= bars; b++) {
      const f = b / bars;
      const bx = hingeX + dirX * (leafWidth * f);
      const bz = hingeZ + dirZ * (leafWidth * f);
      batcher.addBox(
        options.ironMaterial,
        b === 0 || b === bars ? 0.05 : 0.028,
        gateH,
        b === 0 || b === bars ? 0.05 : 0.028,
        bx,
        midY,
        bz,
        0,
        0,
        side * -openAngle,
        0,
        true,
      );
    }
  }

  // Terrain-following flush courtyard entry walk from front gate inward
  const walkEndLZ = options.walkEndLZ ?? zMax - 3.6;
  const walkSegs = 4;
  const walkWidth = Math.min(2.6, gateHalfW * 1.45);
  for (let s = 0; s < walkSegs; s++) {
    const zA = zMax + 0.15 - ((zMax + 0.15 - walkEndLZ) * s) / walkSegs;
    const zB = zMax + 0.15 - ((zMax + 0.15 - walkEndLZ) * (s + 1)) / walkSegs;
    const mz = (zA + zB) * 0.5;
    const yL = groundLocalY(ctx, -walkWidth * 0.45, mz);
    const yC = groundLocalY(ctx, 0, mz);
    const yR = groundLocalY(ctx, walkWidth * 0.45, mz);
    const topY = Math.max(yL, yC, yR) + 0.035;
    const botY = Math.min(yL, yC, yR) - 0.25;
    batcher.addWorldSlopeBox(
      options.walkMaterial,
      walkWidth,
      topY,
      botY,
      Math.abs(zA - zB) + 0.06,
      0,
      mz,
      UV_SCALE.cobblestone,
      0,
      false, // flat ground slab: castShadow = false
    );
  }

  // Wall colliders (excluding open gate)
  const id = parcel.id;
  addWallColliderSpan(colliders, parcel, `${id}_wall_n`, xMin - 0.2, xMax + 0.2, zMin - 0.2, zMin + 0.2);
  addWallColliderSpan(colliders, parcel, `${id}_wall_w`, xMin - 0.2, xMin + 0.2, zMin - 0.2, zMax + 0.2);
  addWallColliderSpan(colliders, parcel, `${id}_wall_e`, xMax - 0.2, xMax + 0.2, zMin - 0.2, zMax + 0.2);
  addWallColliderSpan(colliders, parcel, `${id}_wall_sw`, xMin - 0.2, -gateHalfW, zMax - 0.22, zMax + 0.22);
  addWallColliderSpan(colliders, parcel, `${id}_wall_se`, gateHalfW, xMax + 0.2, zMax - 0.22, zMax + 0.22);
}

export function buildArchitecture(materials: ProceduralMaterialSet): ArchitectureBuildResult {
  const group = new THREE.Group();
  group.name = 'BadaguanArchitecture';

  const colliders: ColliderBox[] = [];
  const disposableGeometries: THREE.BufferGeometry[] = [];
  const stuccoCache = new Map<string, THREE.MeshStandardMaterial>();

  const getStucco: StuccoGetter = (hex: string) => {
    const key = hex.trim().toLowerCase();
    let mat = stuccoCache.get(key);
    if (!mat) {
      mat = materials.createTintedStuccoMaterial(key);
      stuccoCache.set(key, mat);
    }
    return mat;
  };

  let infillIndex = 0;
  for (const parcel of VILLA_PARCELS) {
    let parcelGroup: THREE.Group;
    if (parcel.style === 'huashi') {
      parcelGroup = buildHuashiBuilding(parcel, materials, colliders, disposableGeometries);
    } else if (parcel.style === 'princess') {
      parcelGroup = buildPrincessHouse(parcel, materials, getStucco, colliders, disposableGeometries);
    } else if (parcel.style === 'butterfly') {
      parcelGroup = buildButterflyHouse(parcel, materials, getStucco, colliders, disposableGeometries);
    } else if (parcel.style === 'marshal') {
      parcelGroup = buildMarshalsHouse(parcel, materials, getStucco, colliders, disposableGeometries);
    } else {
      parcelGroup = buildInfillVilla(
        parcel,
        infillIndex++,
        materials,
        getStucco,
        colliders,
        disposableGeometries,
      );
    }
    group.add(parcelGroup);
  }

  const landmarkAnchors: Record<string, LandmarkAnchor> = {};
  const landmarkMeta: Record<string, { nameZh: string; nameEn: string }> = {
    huashi: { nameZh: '花石樓', nameEn: 'Huashi Building' },
    princess: { nameZh: '公主樓', nameEn: 'Princess House' },
    butterfly: { nameZh: '蝴蝶樓', nameEn: 'Butterfly House' },
    marshal: { nameZh: '元帥樓', nameEn: "Marshal's House" },
  };

  for (const parcel of VILLA_PARCELS) {
    const meta = landmarkMeta[parcel.id];
    if (meta) {
      landmarkAnchors[parcel.id] = {
        x: parcel.x,
        y: getGroundHeight(parcel.x, parcel.z),
        z: parcel.z,
        nameZh: meta.nameZh,
        nameEn: meta.nameEn,
      };
    }
  }

  return {
    group,
    colliders,
    landmarkAnchors,
    dispose: () => {
      for (const geo of disposableGeometries) {
        geo.dispose();
      }
      disposableGeometries.length = 0;
      stuccoCache.clear();
    },
  };
}
