import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  EYE_HEIGHT,
  INITIAL_VISTA,
  CAMERA_PRESETS,
  computeYawPitch,
} from '../../src/scene/Presets';
import {
  NavigationController,
  PITCH_MAX,
  PITCH_MIN,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  TRANSITION_DURATION,
  WALK_SPEED,
  forwardXZFromYaw,
  normalizeAngle,
  rightXZFromYaw,
  shortestAngleDelta,
  yawPitchFromLookAt,
} from '../../src/controls/NavigationController';
import {
  type ColliderBox,
  WORLD_BOUNDS,
  getGroundHeight,
  getZoneAt,
  isPlayablePosition,
} from '../../src/scene/DistrictLayout';
import type { ProceduralMaterialSet } from '../../src/scene/ProceduralMaterials';
import { buildTerrainAndRoads } from '../../src/scene/TerrainAndRoads';
import { buildArchitecture } from '../../src/scene/Architecture';
import { buildVegetationAndProps } from '../../src/scene/VegetationAndProps';
import { BadaguanScene } from '../../src/scene/BadaguanScene';
import { CONTROLS_HINT_ITEMS, formatZoneBadge } from '../../src/ui/HudOverlay';
import { resolveCircleAABB } from '../../src/utils/math';

function createHeadlessMaterialStub(): ProceduralMaterialSet {
  const shared = new THREE.MeshStandardMaterial();
  return {
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
    createRoadSignMaterial: () => shared,
    dispose: () => {
      shared.dispose();
    },
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(55, 1280 / 720, 0.2, 2200);
}

describe('Presets & Scene Occlusion Verification (M4)', () => {
  it('defines 6 valid, distinct presets and grounded INITIAL_VISTA with clean clearances and 0 raycast blockers', () => {
    expect(CAMERA_PRESETS).toHaveLength(6);
    const ids = new Set(CAMERA_PRESETS.map((p) => p.id));
    const keys = new Set(CAMERA_PRESETS.map((p) => p.key));
    expect(ids.size).toBe(6);
    expect(keys.size).toBe(6);

    const materials = createHeadlessMaterialStub();
    const terrain = buildTerrainAndRoads(materials);
    const architecture = buildArchitecture(materials);
    const vegetation = buildVegetationAndProps(materials);

    try {
      const colliders: ColliderBox[] = [
        ...terrain.colliders,
        ...architecture.colliders,
        ...vegetation.colliders,
      ];
      expect(colliders.length).toBeGreaterThanOrEqual(1000);

      // Build mesh list for 3D raycast LOS verification (excluding drifting particles)
      const root = new THREE.Group();
      root.add(terrain.group, architecture.group, vegetation.group);
      root.updateMatrixWorld(true);
      const meshes: THREE.Object3D[] = [];
      root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.name !== 'DriftingAutumnLeaves') {
          meshes.push(obj);
        }
      });

      const allVistas = [INITIAL_VISTA, ...CAMERA_PRESETS];
      for (const pose of allVistas) {
        expect(Number.isFinite(pose.position.x)).toBe(true);
        expect(Number.isFinite(pose.position.y)).toBe(true);
        expect(Number.isFinite(pose.position.z)).toBe(true);
        expect(Math.abs(pose.yaw)).toBeLessThanOrEqual(Math.PI + 1e-6);
        expect(pose.pitch).toBeGreaterThanOrEqual(PITCH_MIN);
        expect(pose.pitch).toBeLessThanOrEqual(PITCH_MAX);

        if (!pose.elevated) {
          expect(isPlayablePosition(pose.position.x, pose.position.z)).toBe(true);
          expect(pose.position.y).toBeCloseTo(
            getGroundHeight(pose.position.x, pose.position.z) + EYE_HEIGHT,
            6,
          );
          for (const box of colliders) {
            const hit = resolveCircleAABB(pose.position.x, pose.position.z, PLAYER_RADIUS, box);
            expect(hit.collided, `Pose ${pose.id} collided with ${box.id}`).toBe(false);
          }
        }
      }

      // INITIAL_VISTA must have >= 6m clearance in all 4 cardinal directions for T1-04
      const cardinalDirs: ReadonlyArray<[number, number]> = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      for (const [dx, dz] of cardinalDirs) {
        for (let d = 0.5; d <= 6.0; d += 0.5) {
          const px = INITIAL_VISTA.position.x + dx * d;
          const pz = INITIAL_VISTA.position.z + dz * d;
          expect(isPlayablePosition(px, pz)).toBe(true);
          for (const box of colliders) {
            expect(resolveCircleAABB(px, pz, PLAYER_RADIUS, box).collided).toBe(false);
          }
        }
      }

      // Pairwise 3D distance > 2m, Y spread > 1m, >= 4 distinct zones
      const zones = new Set<string>();
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < CAMERA_PRESETS.length; i += 1) {
        const a = CAMERA_PRESETS[i]!;
        minY = Math.min(minY, a.position.y);
        maxY = Math.max(maxY, a.position.y);
        zones.add(getZoneAt(a.position.x, a.position.z).id);
        for (let j = i + 1; j < CAMERA_PRESETS.length; j += 1) {
          const b = CAMERA_PRESETS[j]!;
          const dist3d = Math.hypot(
            a.position.x - b.position.x,
            a.position.y - b.position.y,
            a.position.z - b.position.z,
          );
          expect(dist3d).toBeGreaterThan(2.0);
        }
      }
      expect(maxY - minY).toBeGreaterThan(1.0);
      expect(zones.size).toBeGreaterThanOrEqual(4);

      // 3D 5x5 raycast line-of-sight check for INITIAL_VISTA and all 6 presets
      const raycaster = new THREE.Raycaster();
      const targetPrefixes: Record<string, string> = {
        huashi: 'huashi',
        princess: 'princess',
        butterfly: 'butterfly',
      };
      for (const pose of allVistas) {
        const cam = makeCamera();
        cam.position.set(pose.position.x, pose.position.y, pose.position.z);
        cam.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
        cam.updateMatrixWorld(true);

        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const prefix = targetPrefixes[pose.id];

        let blocked = 0;
        for (let ix = -2; ix <= 2; ix += 1) {
          for (let iy = -2; iy <= 2; iy += 1) {
            const tgt = new THREE.Vector3(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z)
              .addScaledVector(right, ix * 1.1)
              .addScaledVector(up, iy * 0.8);
            const dir = tgt.sub(cam.position);
            const dist = dir.length();
            dir.normalize();
            raycaster.set(cam.position, dir);
            raycaster.far = Math.max(1, dist - 2.0);
            const hits = raycaster.intersectObjects(meshes, false);
            const premature = hits.filter(
              (h) => (!prefix || !h.object.name.startsWith(prefix)) && h.distance < dist - 4.0,
            );
            if (premature.length > 0) {
              blocked += 1;
            }
          }
        }
        expect(blocked, `Pose ${pose.id} had premature raycast occlusion`).toBe(0);
      }
    } finally {
      vegetation.dispose();
      architecture.dispose();
      terrain.dispose();
      materials.dispose();
    }
  });

  it('computeYawPitch matches YXZ camera forward direction', () => {
    const pos = { x: 10, y: 4, z: 20 };
    const lookAt = { x: -15, y: 12, z: -30 };
    const { yaw, pitch } = computeYawPitch(pos, lookAt);
    const fwd = forwardXZFromYaw(yaw);
    const expectedDx = lookAt.x - pos.x;
    const expectedDz = lookAt.z - pos.z;
    const len = Math.hypot(expectedDx, expectedDz);
    expect(fwd.x).toBeCloseTo(expectedDx / len, 6);
    expect(fwd.z).toBeCloseTo(expectedDz / len, 6);
    expect(pitch).toBeGreaterThan(0);
  });
});

describe('NavigationController Math, Movement, Collision & Transitions (M4)', () => {
  it('wraps angles into [-PI, PI] and computes shortest angle deltas accurately', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 6);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
    expect(normalizeAngle(-Math.PI * 5 + 0.5)).toBeCloseTo(-Math.PI + 0.5, 6);
    expect(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
    expect(shortestAngleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);

    const yp = yawPitchFromLookAt({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: -10 });
    expect(yp.yaw).toBeCloseTo(0, 6);
    expect(yp.pitch).toBeCloseTo(0, 6);

    const r = rightXZFromYaw(0);
    expect(r.x).toBeCloseTo(1, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it('clamps pitch to [-75°, +80°] and wraps yaw within [-PI, PI] under extreme mouse look', () => {
    const cam = makeCamera();
    const nav = new NavigationController(cam, {
      colliders: [],
      initialView: INITIAL_VISTA,
      presets: CAMERA_PRESETS,
    });

    for (let i = 0; i < 20; i += 1) {
      nav.applyLookDelta(1200, -1200);
      const state = nav.getState();
      expect(Math.abs(state.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(Math.abs(state.yaw)).toBeLessThan(6.5);
      expect(state.pitch).toBeLessThanOrEqual(PITCH_MAX + 1e-9);
    }
    expect(nav.getState().pitch).toBeCloseTo(PITCH_MAX, 5);

    for (let i = 0; i < 20; i += 1) {
      nav.applyLookDelta(-1200, 1200);
      const state = nav.getState();
      expect(Math.abs(state.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(state.pitch).toBeGreaterThanOrEqual(PITCH_MIN - 1e-9);
    }
    expect(nav.getState().pitch).toBeCloseTo(PITCH_MIN, 5);

    nav.dispose();
  });

  it('moves camera-relatively with WASD/Arrows, normalizes diagonal speed, doubles speed on Shift, and clears on blur', () => {
    const cam = makeCamera();
    const nav = new NavigationController(cam, {
      colliders: [],
      initialView: INITIAL_VISTA,
      presets: CAMERA_PRESETS,
    });

    const start = nav.getState().position;
    nav.setKeyState('KeyW', true);
    for (let i = 0; i < 10; i += 1) nav.update(0.05);
    nav.setKeyState('KeyW', false);
    const afterW = nav.getState().position;
    const distW = Math.hypot(afterW.x - start.x, afterW.z - start.z);
    expect(distW).toBeCloseTo(WALK_SPEED * 0.5, 2);

    // Sprint doubles speed
    nav.setKeyState('ShiftLeft', true, true);
    nav.setKeyState('KeyW', true, true);
    for (let i = 0; i < 10; i += 1) nav.update(0.05);
    nav.clearInputs();
    const afterSprint = nav.getState().position;
    const distSprint = Math.hypot(afterSprint.x - afterW.x, afterSprint.z - afterW.z);
    expect(distSprint).toBeCloseTo(SPRINT_SPEED * 0.5, 2);

    // Diagonal W+D has same speed as straight W
    nav.setKeyState('KeyW', true);
    nav.setKeyState('KeyD', true);
    for (let i = 0; i < 10; i += 1) nav.update(0.05);
    const afterDiag = nav.getState().position;
    const distDiag = Math.hypot(afterDiag.x - afterSprint.x, afterDiag.z - afterSprint.z);
    expect(distDiag).toBeCloseTo(WALK_SPEED * 0.5, 2);

    // clearInputs stops movement immediately
    nav.clearInputs();
    for (let i = 0; i < 5; i += 1) nav.update(0.05);
    const afterClear = nav.getState().position;
    expect(Math.hypot(afterClear.x - afterDiag.x, afterClear.z - afterDiag.z)).toBeLessThan(1e-6);

    nav.dispose();
  });

  it('slides cleanly along AABB colliders and clamps against world/shoreline bounds', () => {
    const wallBox: ColliderBox = {
      id: 'test_wall',
      minX: -5,
      maxX: 5,
      minZ: 88,
      maxZ: 91,
      kind: 'wall',
    };
    const cam = makeCamera();
    const northPose = {
      ...INITIAL_VISTA,
      yaw: 0,
      pitch: 0,
    };
    const nav = new NavigationController(cam, {
      colliders: [wallBox],
      initialView: northPose,
      presets: CAMERA_PRESETS,
    });

    // Walk diagonally (W + D) into the wall at z <= 91: should slide East (+X) without penetrating wallBox
    nav.setKeyState('KeyW', true);
    nav.setKeyState('KeyD', true);
    for (let i = 0; i < 40; i += 1) nav.update(0.05);
    const pos = nav.getState().position;
    expect(pos.x).toBeGreaterThan(2.0);
    expect(resolveCircleAABB(pos.x, pos.z, PLAYER_RADIUS, wallBox).collided).toBe(false);

    // Walk far south toward shoreline and verify waterLineZ clamp
    nav.clearInputs();
    nav.selectPresetByIndex(2); // Huashi near coast
    const settleSteps = Math.ceil(TRANSITION_DURATION / 0.05) + 2;
    for (let i = 0; i < settleSteps; i += 1) nav.update(0.05);
    nav.applyLookDelta(Math.PI / 0.0028, 0); // turn around toward sea? Use direct KeyS/KeyW after rotating
    // Aim due south (yaw = PI)
    const curYaw = nav.getState().yaw;
    nav.applyLookDelta(-(Math.PI - curYaw) / 0.0028, 0);
    nav.setKeyState('KeyW', true);
    nav.setKeyState('ShiftLeft', true, true);
    for (let i = 0; i < 80; i += 1) nav.update(0.05);
    const shorePos = nav.getState().position;
    expect(shorePos.z).toBeLessThanOrEqual(WORLD_BOUNDS.waterLineZ(shorePos.x) - 1.49);
    expect(shorePos.y).toBeGreaterThan(1.0);

    nav.dispose();
  });

  it('executes smooth 1.5s preset transitions, handles rapid switching, and cancels immediately without snap-back', () => {
    const cam = makeCamera();
    const onPresetChange = vi.fn();
    const nav = new NavigationController(cam, {
      colliders: [],
      initialView: INITIAL_VISTA,
      presets: CAMERA_PRESETS,
      onPresetChange,
    });

    // Rapid switching 1 -> 3 -> 5 -> 6 settles on 6
    expect(nav.selectPresetByIndex(1)).toBe(true);
    nav.update(0.05);
    expect(nav.selectPresetByIndex(3)).toBe(true);
    nav.update(0.05);
    expect(nav.selectPresetByIndex(5)).toBe(true);
    nav.update(0.05);
    expect(nav.selectPresetByIndex(6)).toBe(true);
    expect(nav.getState().isTransitioning).toBe(true);

    const steps = Math.ceil(TRANSITION_DURATION / 0.05) + 2;
    for (let i = 0; i < steps; i += 1) nav.update(0.05);
    const settled6 = nav.getState();
    const target6 = CAMERA_PRESETS[5]!;
    expect(settled6.isTransitioning).toBe(false);
    expect(settled6.activePreset).toBe(target6.id);
    expect(settled6.position.x).toBeCloseTo(target6.position.x, 4);
    expect(settled6.position.z).toBeCloseTo(target6.position.z, 4);

    // Mid-flight cancel via mouse look preserves pose with zero snap-back
    nav.selectPresetByIndex(2);
    nav.update(0.1);
    nav.update(0.1);
    expect(nav.getState().isTransitioning).toBe(true);
    nav.applyLookDelta(100, -20);
    const afterCancel = nav.getState();
    expect(afterCancel.isTransitioning).toBe(false);
    expect(afterCancel.activePreset).toBeNull();
    for (let i = 0; i < 20; i += 1) nav.update(0.05);
    expect(nav.getState().position.x).toBeCloseTo(afterCancel.position.x, 4);
    expect(nav.getState().position.z).toBeCloseTo(afterCancel.position.z, 4);

    // Elevated preset (1) walk descends smoothly without sudden Z-snap or sinking below 0.5m
    nav.selectPresetByIndex(1);
    for (let i = 0; i < steps; i += 1) nav.update(0.05);
    const elevPos = nav.getState().position;
    expect(elevPos.y).toBeCloseTo(42.0, 2);

    nav.setKeyState('KeyW', true);
    for (let i = 0; i < 24; i += 1) nav.update(0.05); // 1.2s walk
    const afterElevWalk = nav.getState().position;
    expect(afterElevWalk.y).toBeGreaterThan(0.5);
    expect(Math.hypot(afterElevWalk.x - elevPos.x, afterElevWalk.z - elevPos.z)).toBeGreaterThan(5.0);
    expect(Math.hypot(afterElevWalk.x - elevPos.x, afterElevWalk.z - elevPos.z)).toBeLessThan(15.0);

    // Reset via R returns to INITIAL_VISTA
    nav.clearInputs();
    nav.resetToInitial();
    for (let i = 0; i < steps; i += 1) nav.update(0.05);
    const resetPos = nav.getState().position;
    expect(resetPos.x).toBeCloseTo(INITIAL_VISTA.position.x, 3);
    expect(resetPos.z).toBeCloseTo(INITIAL_VISTA.position.z, 3);

    expect(nav.selectPresetByIndex(99)).toBe(false);
    expect(onPresetChange).toHaveBeenCalled();

    nav.dispose();
  });

  it('completes preset transitions in 6 slow frames (rawDt = 0.5 and 1.2, transitionDt clamped to 0.25) while keeping walking moveDt clamped to 0.1', () => {
    const cam = makeCamera();
    const nav = new NavigationController(cam, {
      colliders: [],
      initialView: INITIAL_VISTA,
      presets: CAMERA_PRESETS,
    });

    // Slow frame transition (rawDt = 0.5): transitionDt clamps to 0.25 -> 1.5s / 0.25 = 6 updates
    expect(nav.selectPresetByIndex(2)).toBe(true);
    expect(nav.getState().isTransitioning).toBe(true);

    for (let frame = 1; frame <= 5; frame += 1) {
      nav.update(0.5);
      expect(nav.getState().isTransitioning, `expected mid-flight at frame ${frame}`).toBe(true);
    }

    nav.update(0.5); // frame 6: elapsed = 1.5 >= 1.5
    const settled = nav.getState();
    const target2 = CAMERA_PRESETS[1]!;
    expect(settled.isTransitioning).toBe(false);
    expect(settled.activePreset).toBe(target2.id);
    expect(settled.position.x).toBeCloseTo(target2.position.x, 4);
    expect(settled.position.z).toBeCloseTo(target2.position.z, 4);

    // Even larger rawDt = 1.2 still clamps transitionDt to 0.25 (mid-flight through frame 5, done in 6)
    expect(nav.selectPresetByIndex(5)).toBe(true);
    for (let frame = 1; frame <= 5; frame += 1) {
      nav.update(1.2);
      expect(nav.getState().isTransitioning, `expected mid-flight at frame ${frame}`).toBe(true);
    }
    nav.update(1.2);
    const settled5 = nav.getState();
    const target5 = CAMERA_PRESETS[4]!;
    expect(settled5.isTransitioning).toBe(false);
    expect(settled5.activePreset).toBe(target5.id);
    expect(settled5.position.x).toBeCloseTo(target5.position.x, 4);
    expect(settled5.position.z).toBeCloseTo(target5.position.z, 4);

    // Walking movement with slow frame rawDt = 0.5 clamps moveDt to 0.1 (0.9m, not 4.5m)
    const walkStart = nav.getState().position;
    nav.setKeyState('KeyW', true);
    nav.update(0.5);
    nav.clearInputs();
    const walkEnd = nav.getState().position;
    const stepDist = Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z);
    expect(stepDist).toBeCloseTo(WALK_SPEED * 0.1, 3);

    nav.dispose();
  });

  it('ignores non-positive rawDt (0 and -1) without movement or transition progress', () => {
    const cam = makeCamera();
    const nav = new NavigationController(cam, {
      colliders: [],
      initialView: INITIAL_VISTA,
      presets: CAMERA_PRESETS,
    });

    nav.setKeyState('KeyW', true);
    const beforeMove = nav.getState();
    nav.update(0);
    nav.update(-1);
    const afterZeroMove = nav.getState();
    expect(afterZeroMove.position.x).toBe(beforeMove.position.x);
    expect(afterZeroMove.position.y).toBe(beforeMove.position.y);
    expect(afterZeroMove.position.z).toBe(beforeMove.position.z);

    nav.clearInputs();
    expect(nav.selectPresetByIndex(3)).toBe(true);
    const beforeTrans = nav.getState();
    nav.update(0);
    nav.update(-0.5);
    const afterZeroTrans = nav.getState();
    expect(afterZeroTrans.isTransitioning).toBe(true);
    expect(afterZeroTrans.position.x).toBe(beforeTrans.position.x);
    expect(afterZeroTrans.position.y).toBe(beforeTrans.position.y);
    expect(afterZeroTrans.position.z).toBe(beforeTrans.position.z);
    expect(afterZeroTrans.yaw).toBe(beforeTrans.yaw);

    nav.dispose();
  });

  it('resolves non-water colliders on mid-flight cancel (4->3 look, 1->5 KeyW tap & hold) without entrapment or snap', () => {
    const materials = createHeadlessMaterialStub();
    const terrain = buildTerrainAndRoads(materials);
    const architecture = buildArchitecture(materials);
    const vegetation = buildVegetationAndProps(materials);

    try {
      const colliders: ColliderBox[] = [
        ...terrain.colliders,
        ...architecture.colliders,
        ...vegetation.colliders,
      ];
      const nonWater = colliders.filter((c) => c.kind !== 'water');

      const cam = makeCamera();
      const nav = new NavigationController(cam, {
        colliders,
        initialView: INITIAL_VISTA,
        presets: CAMERA_PRESETS,
      });

      const expectNoNonWaterOverlap = (x: number, z: number, label: string) => {
        for (const box of nonWater) {
          const res = resolveCircleAABB(x, z, PLAYER_RADIUS, box);
          if (res.collided) {
            const disp = Math.hypot(res.x - x, res.z - z);
            expect(disp, `${label} overlapped ${box.id} by ${disp}`).toBeLessThan(1e-6);
          }
        }
      };

      const settleSteps = Math.ceil(TRANSITION_DURATION / 0.05) + 2;

      // Case A: 4 -> 3 mid-flight cancelled via applyLookDelta at t = 0.74s (near marshal_main)
      nav.selectPresetByIndex(4);
      for (let i = 0; i < settleSteps; i += 1) nav.update(0.05);
      nav.selectPresetByIndex(3);
      for (let i = 0; i < 37; i += 1) nav.update(0.02);
      nav.applyLookDelta(10, -5);
      const afterLookCancel = nav.getState().position;
      expectNoNonWaterOverlap(afterLookCancel.x, afterLookCancel.z, '4->3 look cancel');
      for (let i = 0; i < 40; i += 1) nav.update(0.05);
      const afterLookSettle = nav.getState().position;
      expect(Math.hypot(afterLookSettle.x - afterLookCancel.x, afterLookSettle.z - afterLookCancel.z)).toBeLessThan(1e-6);
      nav.setKeyState('KeyW', true);
      nav.update(0.016);
      nav.clearInputs();
      const afterLookStep = nav.getState().position;
      expect(Math.hypot(afterLookStep.x - afterLookSettle.x, afterLookStep.z - afterLookSettle.z)).toBeLessThanOrEqual(WALK_SPEED * 0.016 + 1e-6);

      // Case B: 1 -> 5 mid-flight cancelled via KeyW tap-and-release
      nav.selectPresetByIndex(1);
      for (let i = 0; i < settleSteps; i += 1) nav.update(0.05);
      nav.selectPresetByIndex(5);
      for (let i = 0; i < 45; i += 1) nav.update(0.02); // ~0.90s over princess_main
      nav.setKeyState('KeyW', true);
      nav.setKeyState('KeyW', false);
      const afterTapCancel = nav.getState().position;
      expectNoNonWaterOverlap(afterTapCancel.x, afterTapCancel.z, '1->5 tap cancel');
      for (let i = 0; i < 30; i += 1) nav.update(0.05);
      const afterTapSettle = nav.getState().position;
      expect(Math.hypot(afterTapSettle.x - afterTapCancel.x, afterTapSettle.z - afterTapCancel.z)).toBeLessThan(1e-6);

      // Case C: 1 -> 5 mid-flight cancelled via KeyW hold (480ms) + 1500ms settle (T3-01 repro)
      nav.selectPresetByIndex(1);
      for (let i = 0; i < settleSteps; i += 1) nav.update(0.05);
      nav.selectPresetByIndex(5);
      for (let i = 0; i < 45; i += 1) nav.update(0.02); // ~0.90s
      nav.setKeyState('KeyW', true);
      for (let i = 0; i < 6; i += 1) nav.update(0.08); // 480ms walk
      nav.setKeyState('KeyW', false);
      const afterHoldCancel = nav.getState().position;
      expectNoNonWaterOverlap(afterHoldCancel.x, afterHoldCancel.z, '1->5 hold cancel');
      for (let i = 0; i < 30; i += 1) nav.update(0.05); // 1500ms settle
      const afterHoldSettle = nav.getState().position;
      expect(Math.hypot(afterHoldSettle.x - afterHoldCancel.x, afterHoldSettle.z - afterHoldCancel.z)).toBeLessThan(1e-6);

      nav.dispose();
    } finally {
      vegetation.dispose();
      architecture.dispose();
      terrain.dispose();
      materials.dispose();
    }
  });
});

describe('HUD Helpers & BadaguanScene Lifecycle (M4)', () => {
  it('formats bilingual zone badges cleanly without undefined/null/NaN and covers all controls in hint items', () => {
    const clean = formatZoneBadge({
      id: 'juyongguan',
      nameZh: '居庸關路',
      nameEn: 'Juyongguan Rd',
    });
    expect(clean.title).toBe('居庸關路');
    expect(clean.subtitle).toBe('Juyongguan Rd');

    const fallback = formatZoneBadge({
      id: 'bad',
      nameZh: 'undefined',
      nameEn: 'null',
    });
    expect(fallback.title).toBe('八大關歷史街區');
    expect(fallback.subtitle).toBe('Badaguan Historic District');

    const joined = CONTROLS_HINT_ITEMS.map((i) => `${i.keys} ${i.zh} ${i.en}`).join(' ');
    expect(joined).toMatch(/WASD/);
    expect(joined).toMatch(/Shift/);
    expect(joined).toMatch(/1 – 6/);
    expect(joined).toMatch(/\bR\b/);
    expect(joined).toMatch(/\bH\b/);
  });

  it('BadaguanScene disposes cleanly with PCFShadowMap, ACESFilmicToneMapping, and ordered teardown', () => {
    const callOrder: string[] = [];
    const baseMaterials = createHeadlessMaterialStub();
    const origMatDispose = baseMaterials.dispose;
    baseMaterials.dispose = () => {
      callOrder.push('materials');
      origMatDispose();
    };

    const rendererDispose = vi.fn(() => {
      callOrder.push('renderer');
    });
    const renderMock = vi.fn();
    const stubRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      outputColorSpace: '',
      toneMapping: 0,
      toneMappingExposure: 1,
      shadowMap: { enabled: false, type: 0 },
      capabilities: { getMaxAnisotropy: () => 4 },
      info: { render: { calls: 42 } },
      render: renderMock,
      dispose: rendererDispose,
    } as unknown as THREE.WebGLRenderer;

    const stubCanvas = {} as HTMLCanvasElement;
    const sceneWrapper = new BadaguanScene({
      canvas: stubCanvas,
      width: 1280,
      height: 720,
      devicePixelRatio: 2,
      createRenderer: () => stubRenderer,
      createMaterials: () => baseMaterials,
    });

    expect(stubRenderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(stubRenderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(stubRenderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(sceneWrapper.colliders.length).toBeGreaterThanOrEqual(1000);

    const frame = sceneWrapper.step(1 / 60);
    expect(frame.drawCalls).toBe(42);
    expect(renderMock).toHaveBeenCalledTimes(1);

    sceneWrapper.resize(1024, 768, 1);
    expect(sceneWrapper.camera.aspect).toBeCloseTo(1024 / 768, 5);

    // Slow frame step (rawDt = 1.2) completes preset transition in 6 steps via navDt pass-through (transitionDt <= 0.25)
    expect(sceneWrapper.selectPreset(3)).toBe(true);
    for (let step = 1; step <= 5; step += 1) {
      sceneWrapper.step(1.2);
      expect(sceneWrapper.getSnapshot().isTransitioning, `expected mid-flight at step ${step}`).toBe(true);
    }
    sceneWrapper.step(1.2);
    expect(sceneWrapper.getSnapshot().isTransitioning).toBe(false);

    const subsystemKeys = ['navigation', 'vegetation', 'architecture', 'terrain', 'atmosphere'] as const;
    for (const key of subsystemKeys) {
      const subsystem = (sceneWrapper as unknown as Record<string, { dispose: () => void }>)[key];
      expect(subsystem).toBeDefined();
      const origDispose = subsystem!.dispose.bind(subsystem);
      vi.spyOn(subsystem!, 'dispose').mockImplementation(() => {
        callOrder.push(key);
        origDispose();
      });
    }

    sceneWrapper.dispose();
    sceneWrapper.dispose(); // idempotent
    expect(rendererDispose).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      'navigation',
      'vegetation',
      'architecture',
      'terrain',
      'atmosphere',
      'materials',
      'renderer',
    ]);
  });

  it('BadaguanScene sanitizes NaN/zero/negative dimensions and devicePixelRatio in constructor and resize', () => {
    const baseMaterials = createHeadlessMaterialStub();
    const setPixelRatio = vi.fn();
    const setSize = vi.fn();
    const stubRenderer = {
      setPixelRatio,
      setSize,
      outputColorSpace: '',
      toneMapping: 0,
      toneMappingExposure: 1,
      shadowMap: { enabled: false, type: 0 },
      capabilities: { getMaxAnisotropy: () => 4 },
      info: { render: { calls: 0 } },
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    const sceneWrapper = new BadaguanScene({
      canvas: {} as HTMLCanvasElement,
      width: Number.NaN,
      height: 0,
      devicePixelRatio: -2,
      createRenderer: () => stubRenderer,
      createMaterials: () => baseMaterials,
    });

    try {
      expect(sceneWrapper.camera.aspect).toBe(1);
      expect(setSize).toHaveBeenLastCalledWith(1, 1, false);
      expect(setPixelRatio).toHaveBeenLastCalledWith(1);

      sceneWrapper.resize(Number.NaN, 0, -2);
      expect(sceneWrapper.camera.aspect).toBe(1);
      expect(setSize).toHaveBeenLastCalledWith(1, 1, false);
      expect(setPixelRatio).toHaveBeenLastCalledWith(1);

      sceneWrapper.resize(1280, 720, Number.NaN);
      expect(sceneWrapper.camera.aspect).toBeCloseTo(1280 / 720, 5);
      expect(setSize).toHaveBeenLastCalledWith(1280, 720, false);
      expect(setPixelRatio).toHaveBeenLastCalledWith(1);

      sceneWrapper.resize(1920, 1080, 3);
      expect(setPixelRatio).toHaveBeenLastCalledWith(2);
    } finally {
      sceneWrapper.dispose();
    }
  });
});
