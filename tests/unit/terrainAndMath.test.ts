import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ROAD_SEGMENTS,
  VILLA_PARCELS,
  WORLD_BOUNDS,
  getGroundHeight,
  getParcelWorldAABB,
  getZoneAt,
  isOnRoadOrSidewalk,
  isPlayablePosition,
} from '../../src/scene/DistrictLayout';
import { ProceduralMaterialSet } from '../../src/scene/ProceduralMaterials';
import { buildTerrainAndRoads } from '../../src/scene/TerrainAndRoads';
import {
  aabbOverlap,
  clamp,
  distToPolyline2D,
  distToSegment2D,
  lerp,
  mulberry32,
  nearestPointOnSegment2D,
  pointInExpandedAABB,
  resolveCircleAABB,
  smootherstep,
  smoothstep,
} from '../../src/utils/math';

describe('math utilities (src/utils/math.ts)', () => {
  it('mulberry32 produces deterministic sequences in [0, 1)', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const rngC = mulberry32(43);

    const seqA = Array.from({ length: 20 }, () => rngA());
    const seqB = Array.from({ length: 20 }, () => rngB());
    const seqC = Array.from({ length: 20 }, () => rngC());

    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('clamp handles bounds, swapped bounds, and NaN safely', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 10, 0)).toBe(5);
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
  });

  it('lerp, smoothstep, and smootherstep behave monotonically and handle degenerate edges', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 1)).toBe(20);

    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 5)).toBe(0.5);
    expect(smoothstep(0, 10, 11)).toBe(1);
    expect(smoothstep(5, 5, 4)).toBe(0);
    expect(smoothstep(5, 5, 5)).toBe(1);

    expect(smootherstep(0, 10, 0)).toBe(0);
    expect(smootherstep(0, 10, 5)).toBe(0.5);
    expect(smootherstep(0, 10, 10)).toBe(1);
    expect(smootherstep(4, 4, 3)).toBe(0);
    expect(smootherstep(4, 4, 4)).toBe(1);
    expect(smootherstep(10, 0, 0)).toBe(1);
    expect(smootherstep(10, 0, 10)).toBe(0);
  });

  it('nearestPointOnSegment2D, distToSegment2D, and distToPolyline2D handle general and degenerate segments', () => {
    const hit = nearestPointOnSegment2D(3, 4, 0, 0, 10, 0);
    expect(hit.x).toBe(3);
    expect(hit.z).toBe(0);
    expect(hit.t).toBeCloseTo(0.3, 6);
    expect(hit.dist).toBe(4);

    const deg = nearestPointOnSegment2D(3, 4, 0, 0, 0, 0);
    expect(deg.x).toBe(0);
    expect(deg.z).toBe(0);
    expect(deg.t).toBe(0);
    expect(deg.dist).toBe(5);

    expect(distToSegment2D(12, 0, 0, 0, 10, 0)).toBe(2);
    expect(distToPolyline2D(0, 0, [])).toBe(Infinity);
    expect(distToPolyline2D(3, 4, [{ x: 0, z: 0 }])).toBe(5);
    expect(
      distToPolyline2D(5, 5, [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
      ]),
    ).toBe(5);
  });

  it('aabbOverlap, pointInExpandedAABB, and resolveCircleAABB resolve exterior and interior collisions', () => {
    const a = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const b = { minX: 8, maxX: 15, minZ: 5, maxZ: 12 };
    const c = { minX: 10, maxX: 20, minZ: 0, maxZ: 10 };

    expect(aabbOverlap(a, b)).toBe(true);
    expect(aabbOverlap(a, c)).toBe(false);
    expect(pointInExpandedAABB(11, 5, a, 1.5)).toBe(true);
    expect(pointInExpandedAABB(12, 5, a, 1.5)).toBe(false);

    // Non-colliding circle
    const miss = resolveCircleAABB(13, 5, 2, a);
    expect(miss.collided).toBe(false);
    expect(miss.x).toBe(13);

    // Exterior collision
    const ext = resolveCircleAABB(11, 5, 2, a);
    expect(ext.collided).toBe(true);
    expect(ext.x).toBeCloseTo(12, 6);
    expect(ext.z).toBeCloseTo(5, 6);

    // Interior collision (circle center strictly inside AABB)
    const interior = resolveCircleAABB(1.5, 5, 1.0, a);
    expect(interior.collided).toBe(true);
    expect(interior.x).toBeCloseTo(-1.0, 6);
    expect(interior.z).toBeCloseTo(5, 6);

    // Inverted box bounds (min > max) for both exterior and interior cases
    const inverted = { minX: 10, maxX: 0, minZ: 10, maxZ: 0 };
    const invMiss = resolveCircleAABB(13, 5, 2, inverted);
    expect(invMiss.collided).toBe(false);

    const invExt = resolveCircleAABB(11, 5, 2, inverted);
    expect(invExt.collided).toBe(true);
    expect(invExt.x).toBeCloseTo(12, 6);
    expect(invExt.z).toBeCloseTo(5, 6);

    const invInt = resolveCircleAABB(1.5, 5, 1.0, inverted);
    expect(invInt.collided).toBe(true);
    expect(invInt.x).toBeCloseTo(-1.0, 6);
    expect(invInt.z).toBeCloseTo(5, 6);
  });
});

describe('DistrictLayout roads and connectivity', () => {
  it('defines all 10 required pass roads (3 N-S, 6 E-W, curved Huanghai Rd)', () => {
    expect(ROAD_SEGMENTS).toHaveLength(10);
    const ids = new Set(ROAD_SEGMENTS.map((r) => r.id));
    expect(ids).toEqual(
      new Set([
        'zijingguan',
        'ningwuguan',
        'shaoguan',
        'wushengguan',
        'zhengyangguan',
        'jiayuguan',
        'linhuaiguan',
        'juyongguan',
        'shanhaiguan',
        'huanghai',
      ]),
    );
  });

  it('connects all 3 N-S roads with all 6 E-W roads and connects Huanghai Rd cleanly at (-115, 118)', () => {
    const nsXs = [-115, 0, 115];
    const ewZs = [-145, -85, -28, 24, 72, 118];
    const nsRoads = ROAD_SEGMENTS.filter((r) =>
      ['zijingguan', 'ningwuguan', 'shaoguan'].includes(r.id),
    );
    const ewRoads = ROAD_SEGMENTS.filter((r) =>
      [
        'wushengguan',
        'zhengyangguan',
        'jiayuguan',
        'linhuaiguan',
        'juyongguan',
        'shanhaiguan',
      ].includes(r.id),
    );

    for (let i = 0; i < nsRoads.length; i++) {
      for (let j = 0; j < ewRoads.length; j++) {
        const ix = nsXs[i];
        const iz = ewZs[j];
        expect(distToPolyline2D(ix, iz, nsRoads[i].waypoints)).toBeCloseTo(0, 5);
        expect(distToPolyline2D(ix, iz, ewRoads[j].waypoints)).toBeCloseTo(0, 5);
        expect(isOnRoadOrSidewalk(ix, iz)).toBe(true);
      }
    }

    const huanghai = ROAD_SEGMENTS.find((r) => r.id === 'huanghai')!;
    expect(distToPolyline2D(-115, 118, huanghai.waypoints)).toBeCloseTo(0, 5);
  });

  it('isOnRoadOrSidewalk accepts roads/sidewalks and rejects villa centers', () => {
    expect(isOnRoadOrSidewalk(55, 0)).toBe(false);
    expect(isOnRoadOrSidewalk(55, 72)).toBe(true);
    expect(isOnRoadOrSidewalk(55, 72 + 6.5)).toBe(true);
    expect(isOnRoadOrSidewalk(55, 72 + 9.0)).toBe(false);

    for (const parcel of VILLA_PARCELS) {
      expect(isOnRoadOrSidewalk(parcel.x, parcel.z)).toBe(false);
    }
  });
});

describe('DistrictLayout villa parcels (4 heroes + 15 infill)', () => {
  it('contains 4 hero landmarks and 15 infill villas with zero AABB overlaps', () => {
    expect(VILLA_PARCELS).toHaveLength(19);
    const heroes = VILLA_PARCELS.filter((p) => p.isHero);
    const infill = VILLA_PARCELS.filter((p) => !p.isHero);
    expect(heroes.map((h) => h.id).sort()).toEqual([
      'butterfly',
      'huashi',
      'marshal',
      'princess',
    ]);
    expect(infill.length).toBeGreaterThanOrEqual(12);
    expect(infill.length).toBeLessThanOrEqual(16);

    for (let i = 0; i < VILLA_PARCELS.length; i++) {
      const boxA = getParcelWorldAABB(VILLA_PARCELS[i]);
      for (let j = i + 1; j < VILLA_PARCELS.length; j++) {
        const boxB = getParcelWorldAABB(VILLA_PARCELS[j]);
        expect(aabbOverlap(boxA, boxB)).toBe(false);
      }
    }
  });

  it('maintains >= 2.0m clearance from every road+sidewalk corridor and stays safely inland', () => {
    for (const parcel of VILLA_PARCELS) {
      const box = getParcelWorldAABB(parcel);
      for (let ix = 0; ix <= 10; ix++) {
        const px = lerp(box.minX, box.maxX, ix / 10);
        for (let iz = 0; iz <= 10; iz++) {
          const pz = lerp(box.minZ, box.maxZ, iz / 10);
          for (const road of ROAD_SEGMENTS) {
            const halfCorridor = road.width * 0.5 + road.sidewalkWidth;
            const clearance = distToPolyline2D(px, pz, road.waypoints) - halfCorridor;
            expect(clearance).toBeGreaterThanOrEqual(2.0);
          }
          expect(WORLD_BOUNDS.waterLineZ(px) - pz).toBeGreaterThan(10);
        }
      }
      expect(isPlayablePosition(parcel.x, parcel.z)).toBe(true);
    }
  });
});

describe('DistrictLayout terrain profile, C^1 continuity, playable bounds, and zones', () => {
  it('returns finite numbers for NaN, Infinity, and extreme coordinates', () => {
    expect(Number.isFinite(getGroundHeight(Number.NaN, 0))).toBe(true);
    expect(Number.isFinite(getGroundHeight(0, Infinity))).toBe(true);
    expect(Number.isFinite(getGroundHeight(-9999, 9999))).toBe(true);
  });

  it('satisfies exact zero sea-level shoreline, offshore depth, beach berm, Huashi cape, and inland slope', () => {
    for (const x of [-150, -110, -40, 0, 35, 95, 160]) {
      const shoreZ = WORLD_BOUNDS.waterLineZ(x);
      expect(getGroundHeight(x, shoreZ)).toBeCloseTo(0, 6);
      expect(getGroundHeight(x, shoreZ + 25)).toBeLessThan(0);
    }

    // Second Bathing Beach sand
    const beachH = getGroundHeight(35, 148);
    expect(beachH).toBeGreaterThan(0.05);
    expect(beachH).toBeLessThan(0.6);

    // Shanhaiguan Rd shelf
    expect(getGroundHeight(0, 118)).toBeGreaterThan(1.4);
    expect(getGroundHeight(0, 118)).toBeLessThan(2.2);

    // Huashi Cape plateau
    expect(getGroundHeight(-98, 154)).toBeGreaterThan(3.5);

    // Northern inland elevation
    expect(getGroundHeight(0, -180)).toBeGreaterThan(6.0);
  });

  it('is C^1 continuous across the curved shoreline and district terrain', () => {
    const eps = 1e-3;
    for (const x of [-110, -35, 0, 35, 140]) {
      const shoreZ = WORLD_BOUNDS.waterLineZ(x);
      const h0 = getGroundHeight(x, shoreZ);
      const slopeNorth = (getGroundHeight(x, shoreZ - eps) - h0) / eps;
      const slopeSouth = (h0 - getGroundHeight(x, shoreZ + eps)) / eps;
      expect(Math.abs(slopeNorth - slopeSouth)).toBeLessThan(0.02);
    }

    for (const z of [-145, -85, -28, 24, 72, 118, 132]) {
      const hC = getGroundHeight(15, z);
      const slopeN = (getGroundHeight(15, z - eps) - hC) / eps;
      const slopeS = (hC - getGroundHeight(15, z + eps)) / eps;
      expect(Math.abs(slopeN - slopeS)).toBeLessThan(0.02);
    }
  });

  it('isPlayablePosition and getZoneAt classify roads, hero landmarks, beach, and sea accurately', () => {
    expect(isPlayablePosition(Number.NaN, 0)).toBe(false);
    expect(isPlayablePosition(250, 0)).toBe(false);
    expect(isPlayablePosition(0, 210)).toBe(false);
    expect(isPlayablePosition(0, 118)).toBe(true);
    expect(isPlayablePosition(35, 145)).toBe(true);
    expect(isPlayablePosition(-98, 154)).toBe(true);

    expect(getZoneAt(-98, 154).landmarkZh).toBe('花石樓');
    expect(getZoneAt(-36, 48).landmarkZh).toBe('公主樓');
    expect(getZoneAt(36, 95).landmarkZh).toBe('元帥樓');
    expect(getZoneAt(80, 95).landmarkZh).toBe('蝴蝶樓');

    expect(getZoneAt(35, 148).id).toBe('second_beach');
    expect(getZoneAt(35, 195).id).toBe('taiping_bay');

    // Every road returns its own zone name when sampled at a midpoint away from heroes
    expect(getZoneAt(-115, -55).id).toBe('zijingguan');
    expect(getZoneAt(0, -55).id).toBe('ningwuguan');
    expect(getZoneAt(115, -55).id).toBe('shaoguan');
    expect(getZoneAt(55, -145).id).toBe('wushengguan');
    expect(getZoneAt(55, -85).id).toBe('zhengyangguan');
    expect(getZoneAt(55, -28).id).toBe('jiayuguan');
    expect(getZoneAt(55, 24).id).toBe('linhuaiguan');
    expect(getZoneAt(55, 72).id).toBe('juyongguan');
    expect(getZoneAt(-55, 118).id).toBe('shanhaiguan');
    expect(getZoneAt(-132, 152).id).toBe('huanghai');

    // Hero landmark radii must not bleed onto adjacent pass roads
    expect(getZoneAt(-36, 24).id).toBe('linhuaiguan');
    expect(getZoneAt(36, 118).id).toBe('shanhaiguan');
    expect(getZoneAt(80, 118).id).toBe('shanhaiguan');
  });
});

function createHeadlessMaterialStub(): ProceduralMaterialSet {
  const mat = new THREE.MeshStandardMaterial();
  return {
    graniteAshlar: mat,
    mushroomStone: mat,
    terracottaRoof: mat,
    stuccoBase: mat,
    brick: mat,
    darkTimber: mat,
    whiteTrim: mat,
    darkIron: mat,
    windowGlass: mat,
    stainedGlass: mat,
    asphalt: mat,
    cobblestone: mat,
    curbStone: mat,
    crosswalkPaint: mat,
    beachSand: mat,
    bark: mat,
    createTintedStuccoMaterial: () => mat,
    createRoadSignMaterial: () => mat,
    dispose: () => mat.dispose(),
  };
}

describe('TerrainAndRoads geometry integrity', () => {
  it('eliminates seawall/coping back-face Z-skew east of x=115, Huanghai Rd poke-throughs, and sidewalk overlaps', () => {
    const matStub = createHeadlessMaterialStub();
    const res = buildTerrainAndRoads(matStub);

    try {
      const meshes: Record<string, THREE.Mesh> = {};
      res.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          meshes[obj.name] = obj;
        }
      });

      // 1. CoastalSeawall & SeawallCopingAndStairs have zero back-face Z-skew (> 0.05m) east of x=115
      for (const name of ['CoastalSeawall', 'SeawallCopingAndStairs']) {
        const pos = meshes[name].geometry.getAttribute('position');
        let skewedEdges = 0;
        for (let i = 0; i < pos.count; i += 3) {
          const verts = [0, 1, 2].map((k) => ({
            x: pos.getX(i + k),
            y: pos.getY(i + k),
            z: pos.getZ(i + k),
          }));
          if (verts.every((v) => v.x > 115 && v.x < 169.99)) {
            for (let a = 0; a < 3; a++) {
              for (let b = a + 1; b < 3; b++) {
                const dx = Math.abs(verts[a].x - verts[b].x);
                const dy = Math.abs(verts[a].y - verts[b].y);
                const dz = Math.abs(verts[a].z - verts[b].z);
                if (dx < 0.01 && dy > 0.05 && dz > 0.05) {
                  skewedEdges++;
                }
              }
            }
          }
        }
        expect(skewedEdges).toBe(0);
      }

      // 2. Zero downward top normals across terrain, sand, asphalt, curbs, sidewalks
      for (const name of [
        'BadaguanTerrain',
        'SecondBeachSandShelf',
        'BadaguanRoadsAsphalt',
        'BadaguanCurbs',
        'BadaguanSidewalks',
      ]) {
        const norm = meshes[name].geometry.getAttribute('normal');
        for (let i = 0; i < norm.count; i++) {
          expect(norm.getY(i)).toBeGreaterThanOrEqual(-1e-4);
        }
      }

      // 3. Huanghai Rd bend terrain remains strictly below asphalt (exact mesh triangle barycentric query)
      interface MeshTri2D {
        ax: number;
        ay: number;
        az: number;
        bx: number;
        by: number;
        bz: number;
        cx: number;
        cy: number;
        cz: number;
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        denom: number;
      }

      const extractRegionTris = (
        mesh: THREE.Mesh,
        regMinX: number,
        regMaxX: number,
        regMinZ: number,
        regMaxZ: number,
      ): MeshTri2D[] => {
        const pos = mesh.geometry.getAttribute('position');
        const idx = mesh.geometry.getIndex();
        const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
        const tris: MeshTri2D[] = [];
        for (let t = 0; t < triCount; t++) {
          const i0 = idx ? idx.getX(t * 3) : t * 3;
          const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
          const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          const ax = pos.getX(i0);
          const ay = pos.getY(i0);
          const az = pos.getZ(i0);
          const bx = pos.getX(i1);
          const by = pos.getY(i1);
          const bz = pos.getZ(i1);
          const cx = pos.getX(i2);
          const cy = pos.getY(i2);
          const cz = pos.getZ(i2);

          const tMinX = Math.min(ax, bx, cx);
          const tMaxX = Math.max(ax, bx, cx);
          const tMinZ = Math.min(az, bz, cz);
          const tMaxZ = Math.max(az, bz, cz);
          if (tMaxX < regMinX || tMinX > regMaxX || tMaxZ < regMinZ || tMinZ > regMaxZ) {
            continue;
          }
          const denom = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          if (Math.abs(denom) < 1e-10) continue;
          tris.push({
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            cx,
            cy,
            cz,
            minX: tMinX,
            maxX: tMaxX,
            minZ: tMinZ,
            maxZ: tMaxZ,
            denom,
          });
        }
        return tris;
      };

      const maxMeshYAt = (tris: readonly MeshTri2D[], x: number, z: number): number | null => {
        let bestY: number | null = null;
        for (let i = 0; i < tris.length; i++) {
          const t = tris[i];
          if (x < t.minX - 1e-6 || x > t.maxX + 1e-6 || z < t.minZ - 1e-6 || z > t.maxZ + 1e-6) {
            continue;
          }
          const w0 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / t.denom;
          const w1 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / t.denom;
          const w2 = 1 - w0 - w1;
          if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
            const y = w0 * t.ay + w1 * t.by + w2 * t.cy;
            if (bestY === null || y > bestY) {
              bestY = y;
            }
          }
        }
        return bestY;
      };

      const terrainTris = extractRegionTris(meshes.BadaguanTerrain, -135, -109, 164, 187);
      const asphaltTris = extractRegionTris(meshes.BadaguanRoadsAsphalt, -135, -109, 164, 187);
      let verifiedAsphaltSamples = 0;
      for (let x = -134; x <= -110; x += 0.5) {
        for (let z = 165; z <= 186; z += 0.5) {
          const aY = maxMeshYAt(asphaltTris, x, z);
          if (aY === null) continue;
          const tY = maxMeshYAt(terrainTris, x, z);
          expect(tY).not.toBeNull();
          expect(tY!).toBeLessThan(aY);
          verifiedAsphaltSamples++;
        }
      }
      expect(verifiedAsphaltSamples).toBeGreaterThan(100);

      // 4. Zero strict coplanar upward sidewalk overlaps at prior overlap clusters
      const rc = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const orig = new THREE.Vector3();
      const sidewalks = meshes.BadaguanSidewalks;
      const checkPoints: [number, number][] = [
        [-122.37, 110.5],
        [-122.37, 111.5],
        [122.13, 110.5],
        [122.37, 111.5],
        [114.63, 125.67],
        [119.5, 125.3],
        [120.5, 125.0],
        [140.13, 122.5],
        [150.13, 120.5],
        [160.13, 118.0],
      ];
      for (const [x, z] of checkPoints) {
        orig.set(x, 50, z);
        rc.set(orig, down);
        const hits = rc
          .intersectObject(sidewalks, false)
          .filter((h) => h.face && h.face.normal.y > 0.5);
        expect(hits.length).toBeLessThanOrEqual(1);
      }
    } finally {
      res.dispose();
      matStub.dispose();
    }
  });
});
