export interface Point2D {
  x: number;
  z: number;
}

export interface AABB2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NearestSegmentHit2D {
  x: number;
  z: number;
  t: number;
  dist: number;
}

/**
 * Deterministic 32-bit Mulberry32 PRNG returning values in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  const lo = min <= max ? min : max;
  const hi = min <= max ? max : min;
  if (Number.isNaN(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    if (Number.isNaN(x)) return 0;
    return x >= edge1 ? 1 : 0;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1) + 0;
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    if (Number.isNaN(x)) return 0;
    return x >= edge1 ? 1 : 0;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1) + 0;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function nearestPointOnSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): NearestSegmentHit2D {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 1e-12) {
    const dist = Math.hypot(px - ax, pz - az);
    return { x: ax, z: az, t: 0, dist };
  }
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  const x = ax + dx * t;
  const z = az + dz * t;
  return { x, z, t, dist: Math.hypot(px - x, pz - z) };
}

export function distToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  return nearestPointOnSegment2D(px, pz, ax, az, bx, bz).dist;
}

export function distToPolyline2D(
  px: number,
  pz: number,
  points: ReadonlyArray<Point2D>,
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) {
    return Math.hypot(px - points[0].x, pz - points[0].z);
  }
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = distToSegment2D(px, pz, a.x, a.z, b.x, b.z);
    if (d < best) best = d;
  }
  return best;
}

export function aabbOverlap(a: AABB2D, b: AABB2D): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export function pointInExpandedAABB(
  px: number,
  pz: number,
  box: AABB2D,
  margin = 0,
): boolean {
  return (
    px >= box.minX - margin &&
    px <= box.maxX + margin &&
    pz >= box.minZ - margin &&
    pz <= box.maxZ + margin
  );
}

export function resolveCircleAABB(
  cx: number,
  cz: number,
  radius: number,
  box: AABB2D,
): { x: number; z: number; collided: boolean } {
  if (!Number.isFinite(cx) || !Number.isFinite(cz) || !Number.isFinite(radius) || radius <= 0) {
    return { x: cx, z: cz, collided: false };
  }

  const minX = box.minX <= box.maxX ? box.minX : box.maxX;
  const maxX = box.minX <= box.maxX ? box.maxX : box.minX;
  const minZ = box.minZ <= box.maxZ ? box.minZ : box.maxZ;
  const maxZ = box.minZ <= box.maxZ ? box.maxZ : box.minZ;

  const closestX = clamp(cx, minX, maxX);
  const closestZ = clamp(cz, minZ, maxZ);
  const dx = cx - closestX;
  const dz = cz - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq >= radius * radius) {
    return { x: cx, z: cz, collided: false };
  }

  const pushedRadius = radius + 1e-7;

  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;
    return {
      x: closestX + nx * pushedRadius,
      z: closestZ + nz * pushedRadius,
      collided: true,
    };
  }

  // Circle center is inside or on the boundary of the AABB: push out along shallowest axis
  const penLeft = cx - minX;
  const penRight = maxX - cx;
  const penTop = cz - minZ;
  const penBottom = maxZ - cz;

  let minPen = penLeft;
  let outX = minX - pushedRadius;
  let outZ = cz;

  if (penRight < minPen) {
    minPen = penRight;
    outX = maxX + pushedRadius;
    outZ = cz;
  }
  if (penTop < minPen) {
    minPen = penTop;
    outX = cx;
    outZ = minZ - pushedRadius;
  }
  if (penBottom < minPen) {
    outX = cx;
    outZ = maxZ + pushedRadius;
  }

  return { x: outX, z: outZ, collided: true };
}
