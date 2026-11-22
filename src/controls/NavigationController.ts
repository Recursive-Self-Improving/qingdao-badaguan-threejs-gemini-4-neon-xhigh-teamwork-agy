import * as THREE from 'three';
import {
  type ColliderBox,
  WORLD_BOUNDS,
  type ZoneInfo,
  getGroundHeight,
  getZoneAt,
} from '../scene/DistrictLayout';
import { type CameraPose, type CameraPreset, EYE_HEIGHT } from '../scene/Presets';
import { clamp, pointInExpandedAABB, resolveCircleAABB, smootherstep } from '../utils/math';

export const MIN_EYE_CLEARANCE = 1.4;
export const PLAYER_RADIUS = 0.55;
export const WALK_SPEED = 9.0;
export const SPRINT_SPEED = 18.0;
export const LOOK_SENSITIVITY = 0.0028;
export const PITCH_MIN = (-75 * Math.PI) / 180;
export const PITCH_MAX = (80 * Math.PI) / 180;
export const TRANSITION_DURATION = 1.5;
export const BOUND_MARGIN = 6.0;
export const SHORE_MARGIN = 1.5;
export const AIRBORNE_THRESHOLD = 2.5;
export const MAX_COLLISION_SUBSTEP = 0.35;
const AIRBORNE_MIN_SEA_HEIGHT = 4.5;
const AIRBORNE_MAX_FALL_SPEED = 25.0;
const SHORE_PULL_HEIGHT = 6.35;
const SHORE_PULL_SPEED = 29.8;

export function normalizeAngle(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  let wrapped = (rad + Math.PI) % (Math.PI * 2);
  if (wrapped < 0) {
    wrapped += Math.PI * 2;
  }
  return wrapped - Math.PI;
}

export function shortestAngleDelta(fromRad: number, toRad: number): number {
  return normalizeAngle(toRad - fromRad);
}

export function yawPitchFromLookAt(
  pos: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
): { yaw: number; pitch: number } {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const horiz = Math.hypot(dx, dz);
  return {
    yaw: normalizeAngle(Math.atan2(-dx, -dz)),
    pitch: clamp(Math.atan2(dy, Math.max(1e-6, horiz)), PITCH_MIN, PITCH_MAX),
  };
}

export function forwardXZFromYaw(yaw: number): { x: number; z: number } {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}

export function rightXZFromYaw(yaw: number): { x: number; z: number } {
  return {
    x: Math.cos(yaw),
    z: -Math.sin(yaw),
  };
}

export interface NavigationControllerOptions {
  colliders: readonly ColliderBox[];
  initialView: CameraPose;
  presets: readonly CameraPreset[];
  domElement?: HTMLElement | null;
  onPresetChange?: (presetId: string | null) => void;
  onControlsToggle?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
}

export interface NavigationSnapshot {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  activePreset: string | null;
  isTransitioning: boolean;
  isPointerLocked: boolean;
  currentZone: ZoneInfo;
}

interface ActiveTransition {
  fromX: number;
  fromY: number;
  fromZ: number;
  fromYaw: number;
  fromPitch: number;
  toX: number;
  toY: number;
  toZ: number;
  toYaw: number;
  toPitch: number;
  elapsed: number;
  duration: number;
  targetElevated: boolean;
}

const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function isMovementCode(code: string): boolean {
  return MOVEMENT_CODES.has(code);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class NavigationController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly colliders: readonly ColliderBox[];
  private readonly initialView: CameraPose;
  private readonly presets: readonly CameraPreset[];
  private readonly domElement: HTMLElement | null;
  private readonly onPresetChange?: (presetId: string | null) => void;
  private readonly onControlsToggle?: () => void;
  private readonly onPointerLockChange?: (locked: boolean) => void;

  private readonly position = { x: 0, y: EYE_HEIGHT, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private activePreset: string | null = null;
  private isPointerLocked = false;
  private preserveElevation = false;

  private readonly pressedCodes = new Set<string>();
  private shiftDown = false;
  private isDragging = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private transition: ActiveTransition | null = null;
  private disposed = false;

  private readonly handlePointerDownBound: (e: PointerEvent) => void;
  private readonly handlePointerMoveBound: (e: PointerEvent) => void;
  private readonly handlePointerUpBound: (e: PointerEvent) => void;
  private readonly handleDoubleClickBound: (e: MouseEvent) => void;
  private readonly handleKeyDownBound: (e: KeyboardEvent) => void;
  private readonly handleKeyUpBound: (e: KeyboardEvent) => void;
  private readonly handleWindowBlurBound: () => void;
  private readonly handleVisibilityChangeBound: () => void;
  private readonly handlePointerLockChangeBound: () => void;
  private readonly handlePointerLockErrorBound: () => void;

  constructor(camera: THREE.PerspectiveCamera, options: NavigationControllerOptions) {
    this.camera = camera;
    this.colliders = options.colliders;
    this.initialView = options.initialView;
    this.presets = options.presets;
    this.domElement = options.domElement ?? null;
    this.onPresetChange = options.onPresetChange;
    this.onControlsToggle = options.onControlsToggle;
    this.onPointerLockChange = options.onPointerLockChange;

    this.camera.rotation.order = 'YXZ';
    this.applyPoseImmediate(this.initialView, null);

    this.handlePointerDownBound = (e: PointerEvent) => this.onPointerDown(e);
    this.handlePointerMoveBound = (e: PointerEvent) => this.onPointerMove(e);
    this.handlePointerUpBound = (e: PointerEvent) => this.onPointerUp(e);
    this.handleDoubleClickBound = () => this.togglePointerLock();
    this.handleKeyDownBound = (e: KeyboardEvent) => this.onKeyDown(e);
    this.handleKeyUpBound = (e: KeyboardEvent) => this.onKeyUp(e);
    this.handleWindowBlurBound = () => this.clearInputs();
    this.handleVisibilityChangeBound = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        this.clearInputs();
      }
    };
    this.handlePointerLockChangeBound = () => this.syncPointerLockState();
    this.handlePointerLockErrorBound = () => {
      this.setPointerLocked(false);
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && this.domElement) {
      this.domElement.addEventListener('pointerdown', this.handlePointerDownBound);
      this.domElement.addEventListener('dblclick', this.handleDoubleClickBound);
      window.addEventListener('pointermove', this.handlePointerMoveBound);
      window.addEventListener('pointerup', this.handlePointerUpBound);
      window.addEventListener('pointercancel', this.handlePointerUpBound);
      window.addEventListener('keydown', this.handleKeyDownBound);
      window.addEventListener('keyup', this.handleKeyUpBound);
      window.addEventListener('blur', this.handleWindowBlurBound);
      document.addEventListener('visibilitychange', this.handleVisibilityChangeBound);
      document.addEventListener('pointerlockchange', this.handlePointerLockChangeBound);
      document.addEventListener('pointerlockerror', this.handlePointerLockErrorBound);
    }
  }

  private applyPoseImmediate(pose: CameraPose, presetId: string | null): void {
    this.position.x = pose.position.x;
    this.position.y = pose.position.y;
    this.position.z = pose.position.z;
    this.yaw = normalizeAngle(pose.yaw);
    this.pitch = clamp(pose.pitch, PITCH_MIN, PITCH_MAX);
    this.preserveElevation = Boolean(
      pose.elevated ||
        pose.position.y > getGroundHeight(pose.position.x, pose.position.z) + EYE_HEIGHT + 1.0,
    );
    this.transition = null;
    this.setActivePreset(presetId);
    this.syncCamera();
  }

  private setActivePreset(presetId: string | null): void {
    if (this.activePreset !== presetId) {
      this.activePreset = presetId;
      this.onPresetChange?.(presetId);
    }
  }

  private setPointerLocked(locked: boolean): void {
    if (this.isPointerLocked !== locked) {
      this.isPointerLocked = locked;
      this.onPointerLockChange?.(locked);
    }
  }

  private syncPointerLockState(): void {
    if (typeof document === 'undefined' || !this.domElement) {
      this.setPointerLocked(false);
      return;
    }
    this.setPointerLocked(document.pointerLockElement === this.domElement);
  }

  private syncCamera(): void {
    this.yaw = normalizeAngle(this.yaw);
    this.pitch = clamp(this.pitch, PITCH_MIN, PITCH_MAX);
    this.camera.position.set(this.position.x, this.position.y, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  public togglePointerLock(): void {
    if (this.disposed || typeof document === 'undefined' || !this.domElement) {
      return;
    }
    if (document.pointerLockElement === this.domElement) {
      try {
        document.exitPointerLock();
      } catch {
        this.setPointerLocked(false);
      }
      return;
    }

    if (typeof this.domElement.requestPointerLock !== 'function') {
      return;
    }

    try {
      const maybePromise: unknown = this.domElement.requestPointerLock();
      if (
        maybePromise &&
        typeof maybePromise === 'object' &&
        'catch' in maybePromise &&
        typeof (maybePromise as Promise<void>).catch === 'function'
      ) {
        (maybePromise as Promise<void>).catch(() => {
          this.setPointerLocked(false);
        });
      }
    } catch {
      this.setPointerLocked(false);
    }
  }

  public applyLookDelta(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx === 0 && dy === 0) return;

    this.cancelTransition();
    this.yaw = normalizeAngle(this.yaw - dx * LOOK_SENSITIVITY);
    this.pitch = clamp(this.pitch - dy * LOOK_SENSITIVITY, PITCH_MIN, PITCH_MAX);
    this.syncCamera();
  }

  public setKeyState(code: string, pressed: boolean, shiftKey?: boolean): void {
    if (shiftKey !== undefined) {
      this.shiftDown = shiftKey;
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      this.shiftDown = pressed;
    }

    if (pressed) {
      if (isMovementCode(code)) {
        this.cancelTransition();
        this.preserveElevation = false;
      }
      this.pressedCodes.add(code);
    } else {
      this.pressedCodes.delete(code);
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.shiftDown =
          this.pressedCodes.has('ShiftLeft') || this.pressedCodes.has('ShiftRight');
      }
    }
  }

  public clearInputs(): void {
    this.pressedCodes.clear();
    this.shiftDown = false;
    this.isDragging = false;
    this.activePointerId = null;
  }

  public cancelTransition(): void {
    if (this.transition !== null) {
      if (!this.transition.targetElevated) {
        this.preserveElevation = false;
      }
      this.transition = null;
      const groundAtPos = getGroundHeight(this.position.x, this.position.z);
      const isAirborne =
        this.position.y > groundAtPos + EYE_HEIGHT + AIRBORNE_THRESHOLD;
      const resolved = this.resolveHorizontalCollisions(
        this.position.x,
        this.position.z,
        false,
        isAirborne,
        true,
      );
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      this.setActivePreset(null);
      this.syncCamera();
    }
  }

  private resolveHorizontalCollisions(
    x: number,
    z: number,
    moved: boolean,
    isAirborne: boolean,
    forceNonWater = false,
  ): { x: number; z: number } {
    const minX = WORLD_BOUNDS.minX + BOUND_MARGIN;
    const maxX = WORLD_BOUNDS.maxX - BOUND_MARGIN;
    const minZ = WORLD_BOUNDS.minZ + BOUND_MARGIN;
    const maxZ = WORLD_BOUNDS.maxZ - BOUND_MARGIN;

    let nextX = clamp(x, minX, maxX);
    let nextZ = clamp(z, minZ, maxZ);

    const wasOnLand =
      this.position.z <= WORLD_BOUNDS.waterLineZ(this.position.x) - SHORE_MARGIN;
    const enforceWater = moved && wasOnLand && !isAirborne;

    if (enforceWater) {
      const shoreMaxZ = WORLD_BOUNDS.waterLineZ(nextX) - SHORE_MARGIN;
      if (nextZ > shoreMaxZ) {
        nextZ = shoreMaxZ;
      }
    }

    if (moved || !isAirborne || forceNonWater) {
      for (let pass = 0; pass < 3; pass += 1) {
        for (let i = 0; i < this.colliders.length; i += 1) {
          const box = this.colliders[i];
          if (!box) continue;
          if (box.kind === 'water' && !enforceWater) continue;
          if (!pointInExpandedAABB(nextX, nextZ, box, PLAYER_RADIUS + 0.25)) {
            continue;
          }
          const resolved = resolveCircleAABB(nextX, nextZ, PLAYER_RADIUS, box);
          if (resolved.collided) {
            nextX = resolved.x;
            nextZ = resolved.z;
          }
        }
      }

      nextX = clamp(nextX, minX, maxX);
      nextZ = clamp(nextZ, minZ, maxZ);
      if (enforceWater) {
        const finalShoreMaxZ = WORLD_BOUNDS.waterLineZ(nextX) - SHORE_MARGIN;
        if (nextZ > finalShoreMaxZ) {
          nextZ = finalShoreMaxZ;
        }
      }
    }

    return { x: nextX, z: nextZ };
  }

  public selectPresetByIndex(oneBasedIndex: number): boolean {
    const preset = this.presets[oneBasedIndex - 1];
    if (!preset) {
      return false;
    }
    this.startTransition(preset, preset.id, TRANSITION_DURATION);
    return true;
  }

  public selectPresetById(id: string): boolean {
    const idx = this.presets.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    return this.selectPresetByIndex(idx + 1);
  }

  public resetToInitial(): void {
    this.preserveElevation = false;
    this.startTransition(this.initialView, null, TRANSITION_DURATION);
  }

  private startTransition(
    target: CameraPose,
    presetId: string | null,
    duration: number,
  ): void {
    const dist = Math.hypot(
      target.position.x - this.position.x,
      target.position.y - this.position.y,
      target.position.z - this.position.z,
    );
    const angleDiff =
      Math.abs(shortestAngleDelta(this.yaw, target.yaw)) +
      Math.abs(target.pitch - this.pitch);

    if (dist < 0.02 && angleDiff < 0.002) {
      this.applyPoseImmediate(target, presetId);
      return;
    }

    const targetElevated = Boolean(
      target.elevated ||
        target.position.y > getGroundHeight(target.position.x, target.position.z) + EYE_HEIGHT + 1.0,
    );
    if (!targetElevated) {
      this.preserveElevation = false;
    }

    this.transition = {
      fromX: this.position.x,
      fromY: this.position.y,
      fromZ: this.position.z,
      fromYaw: this.yaw,
      fromPitch: this.pitch,
      toX: target.position.x,
      toY: target.position.y,
      toZ: target.position.z,
      toYaw: normalizeAngle(target.yaw),
      toPitch: clamp(target.pitch, PITCH_MIN, PITCH_MAX),
      elapsed: 0,
      duration: Math.max(0.1, duration),
      targetElevated,
    };
    this.setActivePreset(presetId);
  }

  public update(rawDt: number): void {
    if (this.disposed) return;
    if (Number.isFinite(rawDt) && rawDt <= 0) return;

    const safeRawDt = Number.isFinite(rawDt) ? rawDt : 0.016;
    const transitionDt = clamp(safeRawDt, 0.001, 0.25);
    const moveDt = clamp(safeRawDt, 0.001, 0.1);

    if (this.transition) {
      const tr = this.transition;
      tr.elapsed = Math.min(tr.duration, tr.elapsed + transitionDt);
      const t = smootherstep(0, 1, tr.elapsed / tr.duration);

      this.position.x = tr.fromX + (tr.toX - tr.fromX) * t;
      this.position.y = tr.fromY + (tr.toY - tr.fromY) * t;
      this.position.z = tr.fromZ + (tr.toZ - tr.fromZ) * t;
      this.yaw = normalizeAngle(
        tr.fromYaw + shortestAngleDelta(tr.fromYaw, tr.toYaw) * t,
      );
      this.pitch = clamp(tr.fromPitch + (tr.toPitch - tr.fromPitch) * t, PITCH_MIN, PITCH_MAX);

      if (tr.elapsed >= tr.duration) {
        this.preserveElevation = tr.targetElevated;
        this.transition = null;
      }

      this.syncCamera();
      return;
    }

    const forwardInput =
      (this.pressedCodes.has('KeyW') || this.pressedCodes.has('ArrowUp') ? 1 : 0) -
      (this.pressedCodes.has('KeyS') || this.pressedCodes.has('ArrowDown') ? 1 : 0);
    const strafeInput =
      (this.pressedCodes.has('KeyD') || this.pressedCodes.has('ArrowRight') ? 1 : 0) -
      (this.pressedCodes.has('KeyA') || this.pressedCodes.has('ArrowLeft') ? 1 : 0);

    const moved = forwardInput !== 0 || strafeInput !== 0;
    let nextX = this.position.x;
    let nextZ = this.position.z;

    if (moved) {
      this.preserveElevation = false;
      const fwd = forwardXZFromYaw(this.yaw);
      const right = rightXZFromYaw(this.yaw);

      let moveX = fwd.x * forwardInput + right.x * strafeInput;
      let moveZ = fwd.z * forwardInput + right.z * strafeInput;
      const len = Math.hypot(moveX, moveZ);
      if (len > 1e-6) {
        moveX /= len;
        moveZ /= len;
      }

      const speed =
        this.shiftDown ||
        this.pressedCodes.has('ShiftLeft') ||
        this.pressedCodes.has('ShiftRight')
          ? SPRINT_SPEED
          : WALK_SPEED;

      nextX += moveX * speed * moveDt;
      nextZ += moveZ * speed * moveDt;
    }

    let pulledFromWater = false;
    if (!this.preserveElevation) {
      const shoreMaxAtNext = WORLD_BOUNDS.waterLineZ(nextX) - SHORE_MARGIN;
      if (nextZ > shoreMaxAtNext) {
        if (nextZ > this.position.z) {
          nextZ = Math.max(shoreMaxAtNext, this.position.z);
        }
        if (this.position.y <= SHORE_PULL_HEIGHT) {
          nextZ = Math.max(
            shoreMaxAtNext,
            Math.min(nextZ, this.position.z - SHORE_PULL_SPEED * moveDt),
          );
          pulledFromWater = true;
        }
      }
    }

    const startX = this.position.x;
    const startZ = this.position.z;
    const deltaX = nextX - startX;
    const deltaZ = nextZ - startZ;
    const stepDist = Math.hypot(deltaX, deltaZ);
    const substeps =
      stepDist > MAX_COLLISION_SUBSTEP
        ? Math.ceil(stepDist / MAX_COLLISION_SUBSTEP)
        : 1;
    const subDx = deltaX / substeps;
    const subDz = deltaZ / substeps;

    let curX = startX;
    let curZ = startZ;
    let isAirborne =
      this.position.y > getGroundHeight(curX, curZ) + EYE_HEIGHT + AIRBORNE_THRESHOLD;

    for (let s = 0; s < substeps; s += 1) {
      const candX = curX + subDx;
      const candZ = curZ + subDz;
      const groundAtCand = getGroundHeight(candX, candZ);
      isAirborne =
        this.position.y > groundAtCand + EYE_HEIGHT + AIRBORNE_THRESHOLD;
      const resolved = this.resolveHorizontalCollisions(
        candX,
        candZ,
        moved,
        isAirborne,
        pulledFromWater,
      );
      curX = resolved.x;
      curZ = resolved.z;
    }

    nextX = curX;
    nextZ = curZ;

    const finalGroundY = getGroundHeight(nextX, nextZ);
    const overWater = nextZ > WORLD_BOUNDS.waterLineZ(nextX) - SHORE_MARGIN;
    const targetGroundY = overWater
      ? Math.max(AIRBORNE_MIN_SEA_HEIGHT, finalGroundY + EYE_HEIGHT)
      : finalGroundY + EYE_HEIGHT;

    if (!this.preserveElevation) {
      if (this.position.y > targetGroundY + 0.05) {
        const dampRate = isAirborne ? 2.5 : 12.0;
        const alpha = 1 - Math.exp(-dampRate * moveDt);
        let dy = (targetGroundY - this.position.y) * alpha;
        if (isAirborne) {
          dy = Math.max(dy, -AIRBORNE_MAX_FALL_SPEED * moveDt);
        }
        this.position.y += dy;
      } else {
        const alpha = 1 - Math.exp(-16.0 * moveDt);
        this.position.y += (targetGroundY - this.position.y) * alpha;
      }
    }

    const minFloorY = overWater
      ? AIRBORNE_MIN_SEA_HEIGHT - 0.5
      : finalGroundY + MIN_EYE_CLEARANCE;
    if (this.position.y < minFloorY) {
      this.position.y = minFloorY;
    }

    this.position.x = nextX;
    this.position.z = nextZ;

    this.syncCamera();
  }

  public getState(): NavigationSnapshot {
    return {
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
      yaw: this.yaw,
      pitch: this.pitch,
      activePreset: this.activePreset,
      isTransitioning: this.transition !== null,
      isPointerLocked: this.isPointerLocked,
      currentZone: getZoneAt(this.position.x, this.position.z, this.position.y),
    };
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.disposed || e.button !== 0) return;
    this.cancelTransition();
    this.isDragging = true;
    this.activePointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.disposed) return;

    if (this.isPointerLocked) {
      this.applyLookDelta(e.movementX || 0, e.movementY || 0);
      return;
    }

    if (!this.isDragging) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) {
      return;
    }

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.applyLookDelta(dx, dy);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) {
      return;
    }
    this.isDragging = false;
    this.activePointerId = null;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.disposed) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;

    const code = e.code;

    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (isMovementCode(code) || code === 'ShiftLeft' || code === 'ShiftRight') {
      this.setKeyState(code, true, e.shiftKey);
      return;
    }

    if (e.repeat) return;

    const digitMatch = /^(?:Digit)?([1-6])$/.exec(e.key) ?? /^Digit([1-6])$/.exec(code);
    if (digitMatch && digitMatch[1]) {
      const idx = Number.parseInt(digitMatch[1], 10);
      this.selectPresetByIndex(idx);
      return;
    }

    if (code === 'KeyR') {
      this.resetToInitial();
      return;
    }

    if (code === 'KeyF') {
      this.togglePointerLock();
      return;
    }

    if (code === 'KeyH') {
      this.onControlsToggle?.();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.setKeyState(e.code, false, e.shiftKey);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearInputs();

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (this.domElement) {
        this.domElement.removeEventListener('pointerdown', this.handlePointerDownBound);
        this.domElement.removeEventListener('dblclick', this.handleDoubleClickBound);
        if (document.pointerLockElement === this.domElement) {
          try {
            document.exitPointerLock();
          } catch {
            // Ignore pointer lock exit errors during teardown.
          }
        }
      }
      window.removeEventListener('pointermove', this.handlePointerMoveBound);
      window.removeEventListener('pointerup', this.handlePointerUpBound);
      window.removeEventListener('pointercancel', this.handlePointerUpBound);
      window.removeEventListener('keydown', this.handleKeyDownBound);
      window.removeEventListener('keyup', this.handleKeyUpBound);
      window.removeEventListener('blur', this.handleWindowBlurBound);
      document.removeEventListener('visibilitychange', this.handleVisibilityChangeBound);
      document.removeEventListener('pointerlockchange', this.handlePointerLockChangeBound);
      document.removeEventListener('pointerlockerror', this.handlePointerLockErrorBound);
    }

    this.setPointerLocked(false);
  }
}
