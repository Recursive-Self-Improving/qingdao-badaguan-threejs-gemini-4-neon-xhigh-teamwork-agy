import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ROAD_SEGMENTS,
  VILLA_PARCELS,
  VillaParcel,
  WORLD_BOUNDS,
  getGroundHeight,
  getParcelWorldAABB,
  isOnRoadOrSidewalk,
} from '../../src/scene/DistrictLayout';
import { ProceduralMaterialSet } from '../../src/scene/ProceduralMaterials';
import {
  MaterialBatcher,
  UV_SCALE,
  addHippedRoof,
  buildArchitecture,
  localToWorldXZ,
} from '../../src/scene/Architecture';
import { distToPolyline2D, lerp, resolveCircleAABB } from '../../src/utils/math';

function createHeadlessMaterialStub(): {
  materials: ProceduralMaterialSet;
  tintedCalls: string[];
} {
  const created: THREE.MeshStandardMaterial[] = [];
  const makeMat = (color: number): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color });
    created.push(m);
    return m;
  };
  const tintedCalls: string[] = [];

  const materials: ProceduralMaterialSet = {
    graniteAshlar: makeMat(0xb8b2a6),
    mushroomStone: makeMat(0x9a9080),
    terracottaRoof: makeMat(0xb04834),
    stuccoBase: makeMat(0xebe6dc),
    brick: makeMat(0x9c4a3a),
    darkTimber: makeMat(0x4a3425),
    whiteTrim: makeMat(0xf2eee6),
    darkIron: makeMat(0x262b30),
    windowGlass: makeMat(0x2d4554),
    stainedGlass: makeMat(0x3a6eb8),
    asphalt: makeMat(0x45474b),
    cobblestone: makeMat(0x9a958c),
    curbStone: makeMat(0xb9b2a5),
    crosswalkPaint: makeMat(0xece8df),
    beachSand: makeMat(0xdfc89e),
    bark: makeMat(0x6e5a47),
    createTintedStuccoMaterial: (hex: string | number) => {
      tintedCalls.push(String(hex));
      return makeMat(new THREE.Color(hex).getHex());
    },
    createRoadSignMaterial: () => makeMat(0x15477a),
    dispose: () => {
      for (const m of created) {
        m.dispose();
      }
      created.length = 0;
    },
  };

  return { materials, tintedCalls };
}

function getParcelMinGroundHeight(parcel: VillaParcel): number {
  let minY = Infinity;
  for (let ix = 0; ix < 5; ix++) {
    const lx = (-0.5 + ix / 4) * parcel.width;
    for (let iz = 0; iz < 5; iz++) {
      const lz = (-0.5 + iz / 4) * parcel.depth;
      const w = localToWorldXZ(parcel, lx, lz);
      const y = getGroundHeight(w.x, w.z);
      if (y < minY) minY = y;
    }
  }
  return minY;
}

describe('Architecture (M2): 4 Hero Landmarks + 15 Infill Villas', () => {
  it('builds all 19 VILLA_PARCELS, caches tinted stucco materials, and exposes valid landmarkAnchors', () => {
    const { materials, tintedCalls } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      expect(res.group.children).toHaveLength(19);
      const groupIds = new Set(res.group.children.map((c) => c.name));
      for (const parcel of VILLA_PARCELS) {
        expect(groupIds.has(parcel.id)).toBe(true);
      }

      // Stucco tint calls should be cached across identical hex colors (no duplicate allocations)
      expect(tintedCalls.length).toBeGreaterThanOrEqual(4);
      expect(tintedCalls.length).toBeLessThanOrEqual(12);
      expect(new Set(tintedCalls).size).toBe(tintedCalls.length);

      // 4 required hero landmark anchors
      for (const id of ['huashi', 'princess', 'butterfly', 'marshal']) {
        const anchor = res.landmarkAnchors[id];
        expect(anchor).toBeDefined();
        expect(Number.isFinite(anchor.x)).toBe(true);
        expect(Number.isFinite(anchor.y)).toBe(true);
        expect(Number.isFinite(anchor.z)).toBe(true);
        expect(anchor.y).toBeCloseTo(getGroundHeight(anchor.x, anchor.z), 5);
        expect(anchor.nameZh.length).toBeGreaterThan(0);
        expect(anchor.nameEn.length).toBeGreaterThan(0);
      }
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('emits finite ColliderBoxes strictly inside parcel AABBs with zero road, sidewalk, or sea encroachment', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      expect(res.colliders.length).toBeGreaterThan(50);

      const parcelBoxes = VILLA_PARCELS.map((p) => ({
        parcel: p,
        aabb: getParcelWorldAABB(p),
      }));

      for (const col of res.colliders) {
        expect(Number.isFinite(col.minX)).toBe(true);
        expect(Number.isFinite(col.maxX)).toBe(true);
        expect(Number.isFinite(col.minZ)).toBe(true);
        expect(Number.isFinite(col.maxZ)).toBe(true);
        expect(col.minX).toBeLessThan(col.maxX);
        expect(col.minZ).toBeLessThan(col.maxZ);
        expect(['building', 'wall', 'prop']).toContain(col.kind);

        // Must lie strictly inside at least one parcel AABB
        const insideAny = parcelBoxes.some(
          ({ aabb }) =>
            col.minX >= aabb.minX - 1e-5 &&
            col.maxX <= aabb.maxX + 1e-5 &&
            col.minZ >= aabb.minZ - 1e-5 &&
            col.maxZ <= aabb.maxZ + 1e-5,
        );
        expect(insideAny).toBe(true);

        // Zero road, sidewalk, or water encroachment across 5x5 grid
        for (let ix = 0; ix < 5; ix++) {
          const px = lerp(col.minX, col.maxX, ix / 4);
          for (let iz = 0; iz < 5; iz++) {
            const pz = lerp(col.minZ, col.maxZ, iz / 4);
            expect(isOnRoadOrSidewalk(px, pz)).toBe(false);
            for (const road of ROAD_SEGMENTS) {
              const halfCorridor = road.width * 0.5 + road.sidewalkWidth;
              expect(distToPolyline2D(px, pz, road.waypoints)).toBeGreaterThan(halfCorridor + 1.5);
            }
          }
        }
        expect(WORLD_BOUNDS.waterLineZ((col.minX + col.maxX) * 0.5) - col.maxZ).toBeGreaterThan(8);
      }

      // Every parcel must have at least one 'building' and at least one 'wall' collider
      for (const parcel of VILLA_PARCELS) {
        const prefix = `${parcel.id}_`;
        const pCols = res.colliders.filter((c) => c.id.startsWith(prefix));
        expect(pCols.some((c) => c.kind === 'building')).toBe(true);
        expect(pCols.some((c) => c.kind === 'wall')).toBe(true);
      }
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('keeps open courtyard gates walkable via resolveCircleAABB across all 19 parcels', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      const playerRadius = 0.45;
      for (const parcel of VILLA_PARCELS) {
        // Test at gate threshold and 1.0m inside courtyard along local +Z entry path
        for (const lz of [parcel.depth * 0.5 - 0.15, parcel.depth * 0.5 - 1.0]) {
          const worldPt = localToWorldXZ(parcel, 0, lz);
          for (const col of res.colliders) {
            const resolved = resolveCircleAABB(worldPt.x, worldPt.z, playerRadius, col);
            expect(resolved.collided).toBe(false);
          }
        }
      }
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('produces finite mesh geometry contained within parcels, grounded below min terrain, and within draw-call budget', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      res.group.updateMatrixWorld(true);
      let totalMeshes = 0;

      for (const parcel of VILLA_PARCELS) {
        const parcelGroup = res.group.getObjectByName(parcel.id);
        expect(parcelGroup).toBeDefined();

        const parcelAABB = getParcelWorldAABB(parcel);
        const minGroundY = getParcelMinGroundHeight(parcel);
        let lowestMeshY = Infinity;
        let parcelMeshCount = 0;

        parcelGroup!.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          totalMeshes++;
          parcelMeshCount++;

          const pos = obj.geometry.getAttribute('position');
          const norm = obj.geometry.getAttribute('normal');
          expect(pos).toBeDefined();
          expect(norm).toBeDefined();
          expect(pos.count).toBeGreaterThan(0);

          let nonFiniteVerts = 0;
          for (let i = 0; i < pos.count; i++) {
            if (
              !Number.isFinite(pos.getX(i)) ||
              !Number.isFinite(pos.getY(i)) ||
              !Number.isFinite(pos.getZ(i)) ||
              !Number.isFinite(norm.getX(i)) ||
              !Number.isFinite(norm.getY(i)) ||
              !Number.isFinite(norm.getZ(i))
            ) {
              nonFiniteVerts++;
            }
          }
          expect(nonFiniteVerts).toBe(0);

          const box = new THREE.Box3().setFromObject(obj);
          expect(box.isEmpty()).toBe(false);
          expect(box.min.x).toBeGreaterThanOrEqual(parcelAABB.minX - 0.15);
          expect(box.max.x).toBeLessThanOrEqual(parcelAABB.maxX + 0.15);
          expect(box.min.z).toBeGreaterThanOrEqual(parcelAABB.minZ - 0.15);
          expect(box.max.z).toBeLessThanOrEqual(parcelAABB.maxZ + 0.15);

          if (box.min.y < lowestMeshY) {
            lowestMeshY = box.min.y;
          }

          expect(obj.receiveShadow).toBe(true);
          if (obj.material === materials.windowGlass || obj.material === materials.stainedGlass) {
            expect(obj.castShadow).toBe(false);
          }
        });

        expect(parcelMeshCount).toBeGreaterThanOrEqual(3);
        expect(lowestMeshY).toBeLessThanOrEqual(minGroundY - 0.15);
      }

      expect(totalMeshes).toBeLessThanOrEqual(150);
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('emits zero degenerate (zero-area) triangles across all 19 parcels', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      res.group.updateMatrixWorld(true);
      let degenerateCount = 0;
      const v0 = new THREE.Vector3();
      const v1 = new THREE.Vector3();
      const v2 = new THREE.Vector3();
      const e1 = new THREE.Vector3();
      const e2 = new THREE.Vector3();
      const cross = new THREE.Vector3();

      res.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const pos = obj.geometry.getAttribute('position');
        if (!pos) return;
        const idx = obj.geometry.getIndex();
        const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

        for (let t = 0; t < triCount; t++) {
          const i0 = idx ? idx.getX(t * 3) : t * 3;
          const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
          const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          v0.fromBufferAttribute(pos, i0);
          v1.fromBufferAttribute(pos, i1);
          v2.fromBufferAttribute(pos, i2);
          e1.subVectors(v1, v0);
          e2.subVectors(v2, v0);
          cross.crossVectors(e1, e2);
          if (0.5 * cross.length() <= 1e-8) {
            degenerateCount++;
          }
        }
      });

      expect(degenerateCount).toBe(0);
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('keeps all front window glass faces unoccluded along their outward normal (no buried dormers or bay windows)', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      res.group.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      const v0 = new THREE.Vector3();
      const v1 = new THREE.Vector3();
      const v2 = new THREE.Vector3();
      const e1 = new THREE.Vector3();
      const e2 = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const centroid = new THREE.Vector3();
      const invNormal = new THREE.Vector3();
      const origin = new THREE.Vector3();
      const samplePts = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ];

      const structuralMatSet = new Set<THREE.Material>([
        materials.terracottaRoof,
        materials.graniteAshlar,
        materials.mushroomStone,
        materials.brick,
        materials.curbStone,
      ]);

      // Temporarily set DoubleSide on structural/stucco meshes so rays exiting an enclosing slab also register hits
      const touchedMats: Array<{ mat: THREE.Material; side: THREE.Side }> = [];
      const seenMats = new Set<THREE.Material>();
      res.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const m = obj.material as THREE.Material;
        if (!seenMats.has(m)) {
          seenMats.add(m);
          touchedMats.push({ mat: m, side: m.side });
          m.side = THREE.DoubleSide;
        }
      });

      try {
        const occluded: string[] = [];

        for (const parcel of VILLA_PARCELS) {
          const parcelGroup = res.group.getObjectByName(parcel.id)!;
          const glassMeshes: THREE.Mesh[] = [];
          const blockerMeshes: THREE.Mesh[] = [];

          parcelGroup.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            if (obj.material === materials.windowGlass || obj.material === materials.stainedGlass) {
              glassMeshes.push(obj);
            } else if (
              obj.material !== materials.darkIron &&
              obj.material !== materials.darkTimber &&
              obj.material !== materials.whiteTrim
            ) {
              // Covers structural masonry, roofs, and all cached tinted stucco meshes
              blockerMeshes.push(obj);
            } else if (!structuralMatSet.has(obj.material as THREE.Material)) {
              blockerMeshes.push(obj);
            }
          });

          for (const gm of glassMeshes) {
            const pos = gm.geometry.getAttribute('position');
            const idx = gm.geometry.getIndex();
            const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

            for (let t = 0; t < triCount; t++) {
              const i0 = idx ? idx.getX(t * 3) : t * 3;
              const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
              const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

              v0.fromBufferAttribute(pos, i0).applyMatrix4(gm.matrixWorld);
              v1.fromBufferAttribute(pos, i1).applyMatrix4(gm.matrixWorld);
              v2.fromBufferAttribute(pos, i2).applyMatrix4(gm.matrixWorld);
              e1.subVectors(v1, v0);
              e2.subVectors(v2, v0);
              normal.crossVectors(e1, e2);
              const area = 0.5 * normal.length();
              if (area < 0.015) continue;
              normal.normalize();
              // Skip horizontal fountain/stream water surfaces
              if (Math.abs(normal.y) > 0.7) continue;

              centroid.copy(v0).add(v1).add(v2).multiplyScalar(1 / 3);

              // Identify the exposed front face of a 0.036m glass pane:
              // 1) Its back face lies ~0.036m along -normal;
              // 2) The host wall surface sits ~0.025..0.045m behind the front face along -normal.
              invNormal.copy(normal).negate();
              origin.copy(centroid).addScaledVector(invNormal, 0.004);
              raycaster.set(origin, invNormal);
              raycaster.near = 0.01;
              raycaster.far = 0.06;
              const backHits = raycaster.intersectObject(gm, false);
              if (backHits.length === 0) continue;

              origin.copy(centroid).addScaledVector(invNormal, 0.004);
              raycaster.set(origin, invNormal);
              raycaster.near = 0.01;
              raycaster.far = 0.055;
              const wallBehindHits = raycaster.intersectObjects(blockerMeshes, false);

              samplePts[0].copy(centroid);
              samplePts[1].copy(centroid).lerp(v0, 0.7);
              samplePts[2].copy(centroid).lerp(v1, 0.7);
              samplePts[3].copy(centroid).lerp(v2, 0.7);

              const hasSolidHit = (
                samplePt: THREE.Vector3,
                rayOrigin: THREE.Vector3,
                dir: THREE.Vector3,
                farDist = 0.95,
              ): string | null => {
                raycaster.set(rayOrigin, dir);
                raycaster.near = 0.0;
                raycaster.far = farDist;
                const hits = raycaster.intersectObjects(blockerMeshes, false);
                for (const h of hits) {
                  const hitMat = (h.object as THREE.Mesh).material;
                  const isThinMullionMat =
                    hitMat === materials.whiteTrim || hitMat === materials.darkTimber;
                  if (isThinMullionMat && h.distance < 0.055) continue;
                  return `${parcel.id}@(${samplePt.x.toFixed(2)},${samplePt.y.toFixed(2)},${samplePt.z.toFixed(2)}) dist=${h.distance.toFixed(3)}`;
                }
                return null;
              };

              for (const pt of samplePts) {
                // Raycast outward along +normal against masonry, roofs, stucco, and trims
                origin.copy(pt).addScaledVector(normal, 0.02);
                const fwdBlock = hasSolidHit(pt, origin, normal, 0.95);
                if (!fwdBlock) continue;

                if (wallBehindHits.length > 0) {
                  occluded.push(fwdBlock);
                  break;
                } else {
                  // Also flag if BOTH sides of the glass pane are blocked within wall thickness (buried inside a solid bay/wall)
                  const buriedFwd = hasSolidHit(pt, origin, normal, 0.55);
                  if (buriedFwd) {
                    origin.copy(pt).addScaledVector(invNormal, 0.056);
                    if (hasSolidHit(pt, origin, invNormal, 0.55)) {
                      occluded.push(buriedFwd);
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        expect(occluded).toEqual([]);
      } finally {
        for (const { mat, side } of touchedMats) {
          mat.side = side;
        }
      }
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('grounds all ground-floor masonry slabs and entry steps into terrain across all 19 parcels', () => {
    const { materials } = createHeadlessMaterialStub();
    const res = buildArchitecture(materials);

    try {
      res.group.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const origin = new THREE.Vector3();
      const floatingSpots: string[] = [];

      const touchedMats: Array<{ mat: THREE.Material; side: THREE.Side }> = [];
      const seenMats = new Set<THREE.Material>();
      res.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const m = obj.material as THREE.Material;
        if (!seenMats.has(m)) {
          seenMats.add(m);
          touchedMats.push({ mat: m, side: m.side });
          m.side = THREE.DoubleSide;
        }
      });

      try {
        for (const parcel of VILLA_PARCELS) {
          const parcelGroup = res.group.getObjectByName(parcel.id)!;
          const masonryMeshes: THREE.Mesh[] = [];
          parcelGroup.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            if (
              obj.material !== materials.darkIron &&
              obj.material !== materials.windowGlass &&
              obj.material !== materials.stainedGlass &&
              obj.material !== materials.whiteTrim &&
              obj.material !== materials.darkTimber
            ) {
              masonryMeshes.push(obj);
            }
          });

          const halfW = parcel.width * 0.5 - 0.35;
          const halfD = parcel.depth * 0.5 - 0.35;
          for (let lx = -halfW; lx <= halfW + 1e-4; lx += 0.5) {
            for (let lz = -halfD; lz <= halfD + 1e-4; lz += 0.5) {
              // Exclude Princess House open arched bridge span over stream (brX=-6.4, brZ=7.2)
              if (parcel.id === 'princess' && Math.abs(lx - -6.4) < 1.55 && Math.abs(lz - 7.2) < 0.85) {
                continue;
              }
              const w = localToWorldXZ(parcel, lx, lz);
              const gy = getGroundHeight(w.x, w.z);
              origin.set(w.x, gy + 0.8, w.z);
              raycaster.set(origin, down);
              raycaster.near = 0;
              raycaster.far = 2.5;

              const hits = raycaster.intersectObjects(masonryMeshes, false);
              if (hits.length === 0) continue;

              const minHitY = hits.reduce((acc, h) => Math.min(acc, h.point.y), Infinity);
              if (minHitY > gy - 0.02) {
                floatingSpots.push(`${parcel.id}(lx=${lx.toFixed(1)},lz=${lz.toFixed(1)}) gap=${(minHitY - gy).toFixed(3)}`);
              }
            }
          }
        }

        expect(floatingSpots).toEqual([]);
      } finally {
        for (const { mat, side } of touchedMats) {
          mat.side = side;
        }
      }
    } finally {
      res.dispose();
      materials.dispose();
    }
  });

  it('keeps addHippedRoof soffits strictly below terracotta slopes with zero sky slits across all 7 roof configurations', () => {
    const { materials } = createHeadlessMaterialStub();

    const configs = [
      { name: 'spanish_main_min', eaveY: 5.85, spanX: 13.75, spanZ: 9.55, ridgeH: 2.15, ridgeLenX: 5.67 },
      { name: 'spanish_main_max', eaveY: 6.2, spanX: 15.15, spanZ: 10.35, ridgeH: 2.15, ridgeLenX: 6.3 },
      { name: 'spanish_tower', eaveY: 8.7, spanX: 3.3, spanZ: 3.3, ridgeH: 1.45, ridgeLenX: 0 },
      { name: 'british_bay', eaveY: 5.85, spanX: 3.3, spanZ: 1.6, ridgeH: 0.8, ridgeLenX: 1.6 },
      { name: 'british_porch', eaveY: 3.01, spanX: 2.9, spanZ: 1.9, ridgeH: 0.56, ridgeLenX: 1.2 },
      { name: 'marshal_main', eaveY: 5.95, spanX: 16.15, spanZ: 10.15, ridgeH: 2.55, ridgeLenX: 6.2 },
      { name: 'marshal_sungallery', eaveY: 2.96, spanX: 6.8, spanZ: 2.0, ridgeH: 0.62, ridgeLenX: 4.8 },
      { name: 'marshal_portico', eaveY: 3.08, spanX: 4.4, spanZ: 2.7, ridgeH: 0.95, ridgeLenX: 2.4 },
    ];

    try {
      const raycaster = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const up = new THREE.Vector3(0, 1, 0);
      const origin = new THREE.Vector3();

      for (const cfg of configs) {
        const batcher = new MaterialBatcher();
        const grp = new THREE.Group();
        const disposables: THREE.BufferGeometry[] = [];
        addHippedRoof(
          batcher,
          materials.terracottaRoof,
          materials.whiteTrim,
          0,
          cfg.eaveY,
          0,
          cfg.spanX,
          cfg.spanZ,
          cfg.ridgeH,
          cfg.ridgeLenX,
          UV_SCALE.terracottaRoof,
        );
        batcher.flush(grp, cfg.name, materials, disposables);
        grp.updateMatrixWorld(true);

        const roofMeshes: THREE.Mesh[] = [];
        const soffitMeshes: THREE.Mesh[] = [];
        grp.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          if (obj.material === materials.terracottaRoof) roofMeshes.push(obj);
          if (obj.material === materials.whiteTrim) soffitMeshes.push(obj);
        });
        expect(roofMeshes.length).toBeGreaterThan(0);
        expect(soffitMeshes.length).toBeGreaterThan(0);

        const hx = cfg.spanX * 0.5;
        const hz = cfg.spanZ * 0.5;

        // Temporarily DoubleSide for containment probing
        const prevRoofSide = materials.terracottaRoof.side;
        const prevTrimSide = materials.whiteTrim.side;
        materials.terracottaRoof.side = THREE.DoubleSide;
        materials.whiteTrim.side = THREE.DoubleSide;

        try {
          // 1) Dense downward scan: soffit must NEVER poke above terracottaRoof slope
          const pokeViolations: string[] = [];
          const stepX = Math.max(0.03, cfg.spanX / 48);
          const stepZ = Math.max(0.03, cfg.spanZ / 48);
          for (let x = -hx + 0.01; x <= hx - 0.01; x += stepX) {
            for (let z = -hz + 0.01; z <= hz - 0.01; z += stepZ) {
              origin.set(x, cfg.eaveY + cfg.ridgeH + 1.0, z);
              raycaster.set(origin, down);
              raycaster.near = 0;
              raycaster.far = cfg.ridgeH + 2.0;
              const rHits = raycaster.intersectObjects(roofMeshes, false);
              const sHits = raycaster.intersectObjects(soffitMeshes, false);
              expect(rHits.length).toBeGreaterThan(0);
              if (sHits.length > 0) {
                const maxRoofY = rHits.reduce((m, h) => Math.max(m, h.point.y), -Infinity);
                const maxSoffitY = sHits.reduce((m, h) => Math.max(m, h.point.y), -Infinity);
                if (maxSoffitY >= maxRoofY - 0.002) {
                  pokeViolations.push(
                    `${cfg.name}@(${x.toFixed(2)},${z.toFixed(2)}) soffit=${maxSoffitY.toFixed(4)} >= roof=${maxRoofY.toFixed(4)}`,
                  );
                }
              }
            }
          }
          expect(pokeViolations).toEqual([]);

          // 2) Upward scan from under eaves (front-face culling preserved on roof/soffit? Check both DoubleSide & FrontSide)
          materials.terracottaRoof.side = prevRoofSide;
          materials.whiteTrim.side = prevTrimSide;
          const bothMeshes = [...roofMeshes, ...soffitMeshes];
          const upwardLeaks: string[] = [];
          for (let x = -hx + 0.01; x <= hx - 0.01; x += stepX) {
            for (let z = -hz + 0.01; z <= hz - 0.01; z += stepZ) {
              origin.set(x, cfg.eaveY - 0.5, z);
              raycaster.set(origin, up);
              raycaster.near = 0;
              raycaster.far = 2.0;
              const hits = raycaster.intersectObjects(bothMeshes, false);
              if (hits.length === 0) {
                upwardLeaks.push(`${cfg.name}@(${x.toFixed(2)},${z.toFixed(2)})`);
              }
            }
          }
          expect(upwardLeaks).toEqual([]);

          // 3) Horizontal eave scan along all 4 sides around slopeEaveY..eaveY
          const eaveSlits: string[] = [];
          const halfR = Math.max(0, Math.min(cfg.ridgeLenX * 0.5, hx - 0.35));
          const slopeEaveY = cfg.eaveY - 0.06;
          const effRidgeH = cfg.eaveY + cfg.ridgeH - slopeEaveY;
          const dirs: Array<{
            dir: THREE.Vector3;
            pos: (t: number, y: number) => THREE.Vector3;
            span: number;
            maxYAt: (t: number) => number;
          }> = [
            {
              dir: new THREE.Vector3(0, 0, -1),
              pos: (t, y) => new THREE.Vector3(t, y, hz + 0.5),
              span: hx - 0.05,
              maxYAt: (t) =>
                Math.min(
                  cfg.eaveY + cfg.ridgeH,
                  slopeEaveY + (effRidgeH * (hx - Math.abs(t))) / Math.max(0.1, hx - halfR),
                ),
            },
            {
              dir: new THREE.Vector3(0, 0, 1),
              pos: (t, y) => new THREE.Vector3(t, y, -hz - 0.5),
              span: hx - 0.05,
              maxYAt: (t) =>
                Math.min(
                  cfg.eaveY + cfg.ridgeH,
                  slopeEaveY + (effRidgeH * (hx - Math.abs(t))) / Math.max(0.1, hx - halfR),
                ),
            },
            {
              dir: new THREE.Vector3(-1, 0, 0),
              pos: (t, y) => new THREE.Vector3(hx + 0.5, y, t),
              span: hz - 0.05,
              maxYAt: (t) =>
                Math.min(
                  cfg.eaveY + cfg.ridgeH,
                  slopeEaveY + (effRidgeH * (hz - Math.abs(t))) / Math.max(0.1, hz),
                ),
            },
            {
              dir: new THREE.Vector3(1, 0, 0),
              pos: (t, y) => new THREE.Vector3(-hx - 0.5, y, t),
              span: hz - 0.05,
              maxYAt: (t) =>
                Math.min(
                  cfg.eaveY + cfg.ridgeH,
                  slopeEaveY + (effRidgeH * (hz - Math.abs(t))) / Math.max(0.1, hz),
                ),
            },
          ];
          for (const d of dirs) {
            for (let t = -d.span; t <= d.span; t += Math.max(0.08, d.span / 8)) {
              const maxY = Math.min(cfg.eaveY + 0.02, d.maxYAt(t) - 0.005);
              for (let y = cfg.eaveY - 0.11; y <= maxY; y += 0.01) {
                raycaster.set(d.pos(t, y), d.dir);
                raycaster.near = 0;
                raycaster.far = 1.2;
                const hits = raycaster.intersectObjects(bothMeshes, false);
                if (hits.length === 0) {
                  eaveSlits.push(`${cfg.name} dy=${(y - cfg.eaveY).toFixed(3)} t=${t.toFixed(2)}`);
                }
              }
            }
          }
          expect(eaveSlits).toEqual([]);
        } finally {
          materials.terracottaRoof.side = prevRoofSide;
          materials.whiteTrim.side = prevTrimSide;
          for (const g of disposables) g.dispose();
        }
      }
    } finally {
      materials.dispose();
    }
  });
});
