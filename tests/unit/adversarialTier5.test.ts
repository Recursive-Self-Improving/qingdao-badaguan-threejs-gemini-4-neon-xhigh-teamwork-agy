import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_EYE_CLEARANCE,
  NavigationController,
  PLAYER_RADIUS,
  SHORE_MARGIN,
  TRANSITION_DURATION,
} from '../../src/controls/NavigationController';
import { buildArchitecture } from '../../src/scene/Architecture';
import {
  WORLD_BOUNDS,
  getGroundHeight,
  getZoneAt,
  type ColliderBox,
} from '../../src/scene/DistrictLayout';
import { CAMERA_PRESETS, EYE_HEIGHT, INITIAL_VISTA } from '../../src/scene/Presets';
import {
  createProceduralMaterials,
  createRoadSignTexture,
  type ProceduralMaterialSet,
} from '../../src/scene/ProceduralMaterials';
import { buildTerrainAndRoads, seawallZ, shanhaiguanCenterZ } from '../../src/scene/TerrainAndRoads';
import { buildVegetationAndProps } from '../../src/scene/VegetationAndProps';
import { HudOverlay } from '../../src/ui/HudOverlay';
import { clamp, lerp, resolveCircleAABB } from '../../src/utils/math';

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
    dispose: () => shared.dispose(),
  };
}

class MockClassList {
  private readonly set = new Set<string>();
  toggle(token: string, force?: boolean): boolean {
    if (force === undefined) {
      if (this.set.has(token)) {
        this.set.delete(token);
        return false;
      }
      this.set.add(token);
      return true;
    }
    if (force) {
      this.set.add(token);
      return true;
    }
    this.set.delete(token);
    return false;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
}

class MockElement {
  public tagName: string;
  public className = '';
  public hidden = false;
  public style: Record<string, string> = {};
  public isContentEditable = false;
  public type = '';
  public title = '';
  public width = 0;
  public height = 0;
  public children: MockElement[] = [];
  public readonly classList = new MockClassList();
  public readonly attributes = new Map<string, string>();
  public readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  public blur = vi.fn();
  public requestPointerLock?: () => unknown;
  private _textContent = '';

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this._textContent = val;
    if (val === '') {
      this.children = [];
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes: MockElement[]): void {
    this.children.push(...nodes);
  }

  appendChild(node: MockElement): MockElement {
    this.children.push(node);
    return node;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(evt: { type: string; stopPropagation?: () => void; [k: string]: unknown }): void {
    const set = this.listeners.get(evt.type);
    if (!set) return;
    for (const fn of set) {
      fn(evt);
    }
  }

  queryByTestId(testId: string): MockElement | null {
    if (this.getAttribute('data-testid') === testId) return this;
    for (const child of this.children) {
      const hit = child.queryByTestId(testId);
      if (hit) return hit;
    }
    return null;
  }
}

const origDocument = globalThis.document;
const origWindow = globalThis.window;
const origHTMLElement = globalThis.HTMLElement;

afterEach(() => {
  if (origDocument === undefined) {
    delete (globalThis as Record<string, unknown>).document;
  } else {
    globalThis.document = origDocument;
  }
  if (origWindow === undefined) {
    delete (globalThis as Record<string, unknown>).window;
  } else {
    globalThis.window = origWindow;
  }
  if (origHTMLElement === undefined) {
    delete (globalThis as Record<string, unknown>).HTMLElement;
  } else {
    globalThis.HTMLElement = origHTMLElement;
  }
  vi.restoreAllMocks();
});

describe('Tier-5 Adversarial Unit Tests: ProceduralMaterials', () => {
  it('generates PBR textures, road signs with font auto-fit, caches materials, and disposes all owned resources', () => {
    const drawnTexts: string[] = [];
    const drawnFonts = new Map<string, string>();
    const createdCanvases: Array<{ width: number; height: number }> = [];

    globalThis.document = {
      createElement: (tag: string) => {
        if (tag !== 'canvas') return new MockElement(tag);
        const canvas = {
          width: 0,
          height: 0,
          getContext: (kind: string) => {
            if (kind !== '2d') return null;
            const ctx = {
              fillStyle: '',
              strokeStyle: '',
              lineWidth: 1,
              font: '24px sans-serif',
              textAlign: 'left',
              textBaseline: 'alphabetic',
              createImageData: (w: number, h: number) => ({
                width: w,
                height: h,
                data: new Uint8ClampedArray(w * h * 4),
              }),
              putImageData: vi.fn(),
              fillRect: vi.fn(),
              createLinearGradient: () => ({ addColorStop: vi.fn() }),
              beginPath: vi.fn(),
              moveTo: vi.fn(),
              lineTo: vi.fn(),
              quadraticCurveTo: vi.fn(),
              closePath: vi.fn(),
              stroke: vi.fn(),
              arc: vi.fn(),
              fill: vi.fn(),
              measureText: (txt: string) => {
                const match = /(\d+)px/.exec(String(ctx.font));
                const px = match ? Number(match[1]) : 24;
                return { width: txt.length * px * 0.72 };
              },
              fillText: (txt: string) => {
                drawnTexts.push(txt);
                drawnFonts.set(txt, ctx.font);
              },
            };
            return ctx;
          },
        };
        createdCanvases.push(canvas);
        return canvas;
      },
    } as unknown as Document;

    // 1. Road sign texture directly (blue & green + long text shrink)
    const signBlue = createRoadSignTexture('山海關路', 'Shanhaiguan Rd', 'blue');
    expect(signBlue.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(signBlue.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(signBlue.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(signBlue.anisotropy).toBe(4);
    expect(drawnTexts).toContain('山海關路');
    expect(drawnTexts).toContain('SHANHAIGUAN RD');
    expect(drawnFonts.get('山海關路')).toContain('54px');
    expect(drawnFonts.get('SHANHAIGUAN RD')).toContain('24px');
    signBlue.dispose();

    const longZh = '八大關非常長歷史文化景區專用測試道路名稱';
    const longEn = 'Extremely Long Historic Badaguan Boulevard Test Sign';
    const signGreenLong = createRoadSignTexture(longZh, longEn, 'green');
    expect(signGreenLong.colorSpace).toBe(THREE.SRGBColorSpace);
    const longZhPx = Number(/(\d+)px/.exec(drawnFonts.get(longZh) ?? '')?.[1] ?? 999);
    const longEnPx = Number(/(\d+)px/.exec(drawnFonts.get(longEn.toUpperCase()) ?? '')?.[1] ?? 999);
    expect(longZhPx).toBeLessThan(54);
    expect(longZhPx).toBeGreaterThanOrEqual(26);
    expect(longEnPx).toBeLessThan(24);
    expect(longEnPx).toBeGreaterThanOrEqual(14);
    signGreenLong.dispose();

    // 2. Full ProceduralMaterialSet with anisotropy clamping (8 -> 4)
    const mats = createProceduralMaterials(8);
    expect(mats.graniteAshlar.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mats.graniteAshlar.bumpMap?.colorSpace).toBe(THREE.NoColorSpace);
    expect(mats.graniteAshlar.roughnessMap?.colorSpace).toBe(THREE.NoColorSpace);
    expect(mats.graniteAshlar.map?.anisotropy).toBe(4);
    expect(mats.terracottaRoof.map).toBeTruthy();
    expect(mats.mushroomStone.bumpMap).toBeTruthy();
    expect(mats.beachSand.map).toBeTruthy();
    expect(mats.bark.map).toBeTruthy();
    expect(mats.stainedGlass.map).toBeTruthy();

    // 3. Tinted stucco shares stuccoBase maps
    const tinted = mats.createTintedStuccoMaterial('#D9A58C');
    expect(tinted.map).toBe(mats.stuccoBase.map);
    expect(tinted.bumpMap).toBe(mats.stuccoBase.bumpMap);
    expect(tinted.roughnessMap).toBe(mats.stuccoBase.roughnessMap);
    expect(tinted.color.getHexString()).toBe('d9a58c');

    // 4. Road sign caching
    const s1 = mats.createRoadSignMaterial('寧武關路', 'Ningwuguan Rd', 'green');
    const s2 = mats.createRoadSignMaterial('寧武關路', 'Ningwuguan Rd', 'green');
    const s3 = mats.createRoadSignMaterial('寧武關路', 'Ningwuguan Rd', 'blue');
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);

    // 5. Dispose disposes all owned materials and textures cleanly
    const matDisposeSpy = vi.spyOn(mats.graniteAshlar, 'dispose');
    const tintedDisposeSpy = vi.spyOn(tinted, 'dispose');
    const signDisposeSpy = vi.spyOn(s1, 'dispose');
    const texDisposeSpy = vi.spyOn(mats.graniteAshlar.map!, 'dispose');

    mats.dispose();
    expect(matDisposeSpy).toHaveBeenCalledTimes(1);
    expect(tintedDisposeSpy).toHaveBeenCalledTimes(1);
    expect(signDisposeSpy).toHaveBeenCalledTimes(1);
    expect(texDisposeSpy).toHaveBeenCalledTimes(1);
    expect(createdCanvases.length).toBeGreaterThanOrEqual(30);
  });
});

describe('Tier-5 Adversarial Unit Tests: HudOverlay DOM Lifecycle', () => {
  it('manages loading, WebGL fallback, controls toggle, badge/preset updates, pointer isolation, and dispose()', () => {
    globalThis.document = {
      createElement: (tag: string) => new MockElement(tag),
    } as unknown as Document;

    const root = new MockElement('div');
    const onSelectPreset = vi.fn();
    const onControlsVisibilityChange = vi.fn();

    const hud = new HudOverlay(root as unknown as HTMLElement, {
      presets: CAMERA_PRESETS,
      onSelectPreset,
      onControlsVisibilityChange,
    });

    const loading = root.queryByTestId('loading-overlay')!;
    const fallback = root.queryByTestId('webgl-fallback')!;
    const badge = root.queryByTestId('location-badge')!;
    const toggleBtn = root.queryByTestId('controls-toggle')!;
    const panel = root.queryByTestId('controls-panel')!;
    const presetBar = root.queryByTestId('preset-bar')!;
    const preset3 = root.queryByTestId('preset-btn-3')!;

    expect(loading).toBeTruthy();
    expect(fallback.hidden).toBe(true);
    expect(fallback.style.display).toBe('none');
    expect(panel.hidden).toBe(true);
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(presetBar.children).toHaveLength(6);

    // hideLoading / showWebglFallback / hideWebglFallback
    hud.hideLoading();
    expect(loading.hidden).toBe(true);
    expect(loading.style.display).toBe('none');

    hud.showWebglFallback('WebGL context lost');
    expect(fallback.hidden).toBe(false);
    expect(fallback.style.display).toBe('flex');
    expect(fallback.textContent).toContain('WebGL context lost');

    hud.hideWebglFallback();
    expect(fallback.hidden).toBe(true);
    expect(fallback.style.display).toBe('none');

    // Controls panel visibility & button click blur
    expect(hud.toggleControlsPanel()).toBe(true);
    expect(hud.isControlsVisible()).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.style.display).toBe('block');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(onControlsVisibilityChange).toHaveBeenLastCalledWith(true);

    const clickStop = vi.fn();
    toggleBtn.dispatchEvent({ type: 'click', stopPropagation: clickStop });
    expect(clickStop).toHaveBeenCalled();
    expect(toggleBtn.blur).toHaveBeenCalledTimes(1);
    expect(hud.isControlsVisible()).toBe(false);
    expect(panel.hidden).toBe(true);

    // Pointer isolation on HUD cards
    for (const el of [badge, toggleBtn, panel, presetBar]) {
      for (const evtName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick']) {
        const stopSpy = vi.fn();
        el.dispatchEvent({ type: evtName, stopPropagation: stopSpy });
        expect(stopSpy).toHaveBeenCalledTimes(1);
      }
    }

    // Preset pill click invokes callback and blurs button
    const presetClickStop = vi.fn();
    preset3.dispatchEvent({ type: 'click', stopPropagation: presetClickStop });
    expect(presetClickStop).toHaveBeenCalledTimes(1);
    expect(preset3.blur).toHaveBeenCalledTimes(1);
    expect(onSelectPreset).toHaveBeenCalledWith(3);

    // update() updates zone badge & active preset pill state
    hud.update(
      { id: 'princess', nameZh: '居庸關路 · 公主樓', nameEn: 'Juyongguan Rd · Princess House' },
      'princess',
    );
    expect(badge.textContent).toContain('居庸關路 · 公主樓');
    expect(badge.textContent).toContain('Juyongguan Rd · Princess House');
    expect(preset3.classList.contains('is-active')).toBe(true);
    expect(preset3.getAttribute('aria-pressed')).toBe('true');

    // Calling update with null clears active preset
    hud.update({ id: 'jiayuguan', nameZh: '嘉峪關路', nameEn: 'Jiayuguan Rd' }, null);
    expect(preset3.classList.contains('is-active')).toBe(false);
    expect(preset3.getAttribute('aria-pressed')).toBe('false');

    // dispose() cleans up DOM and listeners and ignores subsequent updates
    hud.dispose();
    expect(root.children).toHaveLength(0);
    expect(badge.listeners.get('pointerdown')?.size ?? 0).toBe(0);
    hud.setControlsVisible(true);
    expect(hud.isControlsVisible()).toBe(false);
    hud.dispose(); // idempotent
  });
});

describe('Tier-5 Adversarial Unit Tests: NavigationController & Collision Edge Cases', () => {
  it('resolveCircleAABB is strictly idempotent (zero ULP boundary residue) across interior and exterior cases', () => {
    const princessBox: ColliderBox = {
      id: 'princess_main',
      minX: -43.5,
      maxX: -28.5,
      minZ: 39.9,
      maxZ: 56.1,
      kind: 'building',
    };

    // Challenger R1 exact repro case: (-36, 45) inside princess_main
    const first = resolveCircleAABB(-36, 45, PLAYER_RADIUS, princessBox);
    expect(first.collided).toBe(true);
    const second = resolveCircleAABB(first.x, first.z, PLAYER_RADIUS, princessBox);
    expect(second.collided).toBe(false);

    // Sweep dense grid of interior & boundary positions around boxes
    const boxes = [
      princessBox,
      { id: 'unit', minX: 0, maxX: 10, minZ: 0, maxZ: 10, kind: 'wall' as const },
      { id: 'inverted', minX: 15, maxX: 5, minZ: 25, maxZ: 15, kind: 'wall' as const },
    ];
    for (const box of boxes) {
      const minX = Math.min(box.minX, box.maxX);
      const maxX = Math.max(box.minX, box.maxX);
      const minZ = Math.min(box.minZ, box.maxZ);
      const maxZ = Math.max(box.minZ, box.maxZ);
      for (let ix = 0; ix <= 6; ix++) {
        for (let iz = 0; iz <= 6; iz++) {
          const px = lerp(minX - 0.5, maxX + 0.5, ix / 6);
          const pz = lerp(minZ - 0.5, maxZ + 0.5, iz / 6);
          const r1 = resolveCircleAABB(px, pz, PLAYER_RADIUS, box);
          const r2 = resolveCircleAABB(r1.x, r1.z, PLAYER_RADIUS, box);
          expect(r2.collided).toBe(false);
        }
      }
    }

    // Degenerate / NaN inputs
    expect(resolveCircleAABB(Number.NaN, 0, 0.55, princessBox).collided).toBe(false);
    expect(resolveCircleAABB(0, 0, 0, princessBox).collided).toBe(false);
  });

  it('pushes out when spawned inside a collider and handles editable targets, Pointer Lock failures, KeyR cancel, and ocean descent', async () => {
    globalThis.HTMLElement = MockElement as unknown as typeof HTMLElement;
    const winListeners = new Map<string, Set<(e: unknown) => void>>();
    const docListeners = new Map<string, Set<(e: unknown) => void>>();

    const domEl = new MockElement('canvas');
    let pointerLockErrMode: 'reject' | 'throw' | 'none' = 'reject';
    domEl.requestPointerLock = () => {
      if (pointerLockErrMode === 'throw') {
        throw new Error('PointerLock denied synchronously');
      }
      return Promise.reject(new Error('PointerLock rejected'));
    };

    const docMock = {
      hidden: false,
      pointerLockElement: null as unknown,
      exitPointerLock: vi.fn(() => {
        throw new Error('exitPointerLock failed');
      }),
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        const s = docListeners.get(t) ?? new Set();
        s.add(fn);
        docListeners.set(t, s);
      },
      removeEventListener: (t: string, fn: (e: unknown) => void) => {
        docListeners.get(t)?.delete(fn);
      },
    };
    const winMock = {
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        const s = winListeners.get(t) ?? new Set();
        s.add(fn);
        winListeners.set(t, s);
      },
      removeEventListener: (t: string, fn: (e: unknown) => void) => {
        winListeners.get(t)?.delete(fn);
      },
    };

    globalThis.document = docMock as unknown as Document;
    globalThis.window = winMock as unknown as Window & typeof globalThis;

    const dispatchWin = (type: string, payload: Record<string, unknown> = {}) => {
      for (const fn of winListeners.get(type) ?? []) {
        fn({ type, preventDefault: vi.fn(), ...payload });
      }
    };
    const dispatchDoc = (type: string, payload: Record<string, unknown> = {}) => {
      for (const fn of docListeners.get(type) ?? []) {
        fn({ type, ...payload });
      }
    };

    const princessBox: ColliderBox = {
      id: 'princess_main',
      minX: -43.5,
      maxX: -28.5,
      minZ: 39.9,
      maxZ: 56.1,
      kind: 'building',
    };

    const cam = new THREE.PerspectiveCamera(55, 1280 / 720, 0.2, 2200);
    const onControlsToggle = vi.fn();
    const onPointerLockChange = vi.fn();
    const nav = new NavigationController(cam, {
      colliders: [princessBox],
      initialView: {
        ...INITIAL_VISTA,
        position: { x: -36, y: getGroundHeight(-36, 45) + EYE_HEIGHT, z: 45 },
      },
      presets: CAMERA_PRESETS,
      domElement: domEl as unknown as HTMLElement,
      onControlsToggle,
      onPointerLockChange,
    });

    // 1. Spawn inside collider -> update(0.016) resolves cleanly with zero subsequent overlap
    nav.update(0.016);
    const resolvedPos = nav.getState().position;
    expect(resolveCircleAABB(resolvedPos.x, resolvedPos.z, PLAYER_RADIUS, princessBox).collided).toBe(
      false,
    );

    // 2. Editable target guard (<input>, <textarea>, <select>, contentEditable) ignores all shortcuts
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const target = new MockElement(tag);
      dispatchWin('keydown', { code: 'KeyH', key: 'h', target });
      dispatchWin('keydown', { code: 'Digit2', key: '2', target });
      dispatchWin('keydown', { code: 'KeyW', key: 'w', target });
    }
    const editableDiv = new MockElement('div');
    editableDiv.isContentEditable = true;
    dispatchWin('keydown', { code: 'KeyH', key: 'h', target: editableDiv });
    expect(onControlsToggle).not.toHaveBeenCalled();
    expect(nav.getState().isTransitioning).toBe(false);

    // Non-editable keydown works normally
    dispatchWin('keydown', { code: 'KeyH', key: 'h', target: new MockElement('body') });
    expect(onControlsToggle).toHaveBeenCalledTimes(1);

    // 3. Pointer Lock rejection, synchronous throw, pointerlockerror, and exitPointerLock throw
    nav.togglePointerLock(); // rejected promise
    await Promise.resolve();
    expect(nav.getState().isPointerLocked).toBe(false);

    pointerLockErrMode = 'throw';
    nav.togglePointerLock(); // synchronous throw
    expect(nav.getState().isPointerLocked).toBe(false);

    docMock.pointerLockElement = domEl;
    dispatchDoc('pointerlockchange');
    expect(nav.getState().isPointerLocked).toBe(true);
    expect(onPointerLockChange).toHaveBeenLastCalledWith(true);

    // exitPointerLock throws -> cleanly clears lock state
    nav.togglePointerLock();
    expect(nav.getState().isPointerLocked).toBe(false);

    docMock.pointerLockElement = domEl;
    dispatchDoc('pointerlockchange');
    expect(nav.getState().isPointerLocked).toBe(true);
    dispatchDoc('pointerlockerror');
    expect(nav.getState().isPointerLocked).toBe(false);

    // 4. KeyR mid-flight cancels preset 4 and returns to initialView
    nav.selectPresetByIndex(4);
    nav.update(0.2);
    expect(nav.getState().isTransitioning).toBe(true);
    dispatchWin('keydown', { code: 'KeyR', key: 'r', target: new MockElement('body') });
    expect(nav.getState().activePreset).toBeNull();
    const settleSteps = Math.ceil(TRANSITION_DURATION / 0.05) + 2;
    for (let i = 0; i < settleSteps; i++) nav.update(0.05);
    expect(nav.getState().position.x).toBeCloseTo(-36, 2);

    // 5. Ocean-descent boundary clamp from airborne Preset 1 (panorama)
    nav.selectPresetByIndex(1);
    for (let i = 0; i < settleSteps; i++) nav.update(0.05);
    expect(nav.getState().currentZone.id).toBe('badaguan_panorama');
    expect(nav.getState().currentZone.id).not.toBe('taiping_bay');

    // Walking KeyW for 3.0s descends onto land (does not hover over the Yellow Sea)
    nav.setKeyState('KeyW', true);
    for (let i = 0; i < 60; i++) nav.update(0.05);
    nav.clearInputs();
    const afterWalkW = nav.getState().position;
    expect(afterWalkW.z).toBeLessThanOrEqual(WORLD_BOUNDS.waterLineZ(afterWalkW.x) - SHORE_MARGIN + 1e-4);
    expect(afterWalkW.y).toBeGreaterThanOrEqual(
      getGroundHeight(afterWalkW.x, afterWalkW.z) + MIN_EYE_CLEARANCE - 1e-4,
    );

    // Trying KeyS (walking south toward ocean) from Preset 1 neither moves out to sea nor hovers
    nav.selectPresetByIndex(1);
    for (let i = 0; i < settleSteps; i++) nav.update(0.05);
    const preset1Z = nav.getState().position.z;
    nav.setKeyState('KeyS', true);
    for (let i = 0; i < 60; i++) {
      nav.update(0.05);
      expect(nav.getState().position.z).toBeLessThanOrEqual(preset1Z + 1e-6);
    }
    nav.clearInputs();
    const afterWalkS = nav.getState().position;
    expect(afterWalkS.z).toBeLessThanOrEqual(WORLD_BOUNDS.waterLineZ(afterWalkS.x) - SHORE_MARGIN + 1e-4);

    // 6. visibilitychange (document.hidden = true) clears inputs and NaN look/dt are ignored
    nav.setKeyState('KeyW', true);
    docMock.hidden = true;
    dispatchDoc('visibilitychange');
    const beforeHiddenUpdate = nav.getState().position;
    nav.update(Number.NaN);
    nav.applyLookDelta(Number.NaN, Infinity);
    expect(nav.getState().position.x).toBe(beforeHiddenUpdate.x);
    expect(Number.isFinite(nav.getState().yaw)).toBe(true);

    nav.dispose();
  });

  it('prevents wall and seawall collision tunneling under low-FPS dt, smooths Preset 1 ocean descent, and settles mid-flight drag cancel', () => {
    const materials = createHeadlessMaterialStub();
    const terrain = buildTerrainAndRoads(materials);
    const architecture = buildArchitecture(materials);

    try {
      const colliders: ColliderBox[] = [...terrain.colliders, ...architecture.colliders];
      const princessWallN = colliders.find((c) => c.id === 'princess_wall_n');
      const seawallEast1 = colliders.find((c) => c.id === 'seawall-east-1');
      expect(princessWallN).toBeDefined();
      expect(seawallEast1).toBeDefined();

      // 1. Courtyard wall (0.40m thick) & seawall (1.10m thick) anti-tunneling across dt = 0.042..0.1s
      const cam = new THREE.PerspectiveCamera(55, 1280 / 720, 0.2, 2200);
      for (const { box, startX, startZ, sprint, dt } of [
        { box: princessWallN!, startX: -36, startZ: 36.65, sprint: true, dt: 0.042 },
        { box: princessWallN!, startX: -36, startZ: 36.65, sprint: true, dt: 0.1 },
        { box: princessWallN!, startX: -36, startZ: 36.65, sprint: false, dt: 0.085 },
        { box: princessWallN!, startX: -36, startZ: 36.65, sprint: false, dt: 0.1 },
        { box: seawallEast1!, startX: 20, startZ: 126.05, sprint: true, dt: 0.065 },
        { box: seawallEast1!, startX: 20, startZ: 126.05, sprint: true, dt: 0.1 },
      ]) {
        const navWall = new NavigationController(cam, {
          colliders,
          initialView: {
            ...INITIAL_VISTA,
            position: { x: startX, y: getGroundHeight(startX, startZ) + EYE_HEIGHT, z: startZ },
            yaw: Math.PI, // facing +Z directly into wall
            pitch: 0,
          },
          presets: CAMERA_PRESETS,
        });
        navWall.setKeyState('KeyW', true, sprint);
        if (sprint) navWall.setKeyState('ShiftLeft', true, true);
        for (let i = 0; i < 6; i += 1) {
          navWall.update(dt);
          const p = navWall.getState().position;
          expect(
            p.z,
            `Tunneled through ${box.id} (sprint=${sprint}, dt=${dt}) at z=${p.z}`,
          ).toBeLessThan(box.minZ);
          expect(resolveCircleAABB(p.x, p.z, PLAYER_RADIUS, box).collided).toBe(false);
        }
        navWall.dispose();
      }

      // Oblique sprint (W+D) along princess_wall_n slides cleanly in X without crossing wall
      const navSlide = new NavigationController(cam, {
        colliders,
        initialView: {
          ...INITIAL_VISTA,
          position: { x: -36, y: getGroundHeight(-36, 36.65) + EYE_HEIGHT, z: 36.65 },
          yaw: Math.PI,
          pitch: 0,
        },
        presets: CAMERA_PRESETS,
      });
      navSlide.setKeyState('ShiftLeft', true, true);
      navSlide.setKeyState('KeyW', true, true);
      navSlide.setKeyState('KeyD', true, true);
      for (let i = 0; i < 10; i += 1) {
        navSlide.update(0.1);
        const p = navSlide.getState().position;
        expect(p.z).toBeLessThan(princessWallN!.minZ);
      }
      expect(Math.abs(navSlide.getState().position.x - -36)).toBeGreaterThan(5.0);
      navSlide.dispose();

      // 2. Smooth bounded per-frame |dz| during Preset 1 ocean descent (no > 2m teleport)
      const navDescent = new NavigationController(cam, {
        colliders,
        initialView: INITIAL_VISTA,
        presets: CAMERA_PRESETS,
      });
      const settleSteps = Math.ceil(TRANSITION_DURATION / 0.05) + 2;

      // Case 2A: Brief 0.2s KeyW tap then idle at dt = 0.03s
      navDescent.selectPresetByIndex(1);
      for (let i = 0; i < settleSteps; i += 1) navDescent.update(0.05);
      navDescent.setKeyState('KeyW', true);
      for (let i = 0; i < 7; i += 1) navDescent.update(0.03);
      navDescent.clearInputs();
      let prevZ = navDescent.getState().position.z;
      let maxDzBrief = 0;
      for (let i = 0; i < 110; i += 1) {
        navDescent.update(0.03);
        const p = navDescent.getState().position;
        maxDzBrief = Math.max(maxDzBrief, Math.abs(p.z - prevZ));
        prevZ = p.z;
      }
      const endBrief = navDescent.getState().position;
      expect(maxDzBrief).toBeLessThanOrEqual(1.5);
      expect(endBrief.z).toBeLessThanOrEqual(WORLD_BOUNDS.waterLineZ(endBrief.x) - SHORE_MARGIN + 1e-4);

      // Case 2B: Lateral walk (KeyD) and Shift+KeyS at dt = 0.05s
      for (const keys of [['KeyD'], ['KeyS'], ['ShiftLeft', 'KeyS']] as const) {
        navDescent.clearInputs();
        navDescent.selectPresetByIndex(1);
        for (let i = 0; i < settleSteps; i += 1) navDescent.update(0.05);
        const startZ = navDescent.getState().position.z;
        for (const k of keys) navDescent.setKeyState(k, true, k === 'ShiftLeft');
        let zPrev = startZ;
        let maxDz = 0;
        for (let i = 0; i < 60; i += 1) {
          navDescent.update(0.05);
          const p = navDescent.getState().position;
          maxDz = Math.max(maxDz, Math.abs(p.z - zPrev));
          expect(p.z).toBeLessThanOrEqual(startZ + 1e-6);
          zPrev = p.z;
        }
        const finalPos = navDescent.getState().position;
        expect(maxDz).toBeLessThanOrEqual(1.5);
        expect(finalPos.z).toBeLessThanOrEqual(
          WORLD_BOUNDS.waterLineZ(finalPos.x) - SHORE_MARGIN + 1e-4,
        );
      }

      // 3. Mid-flight mouse-drag cancel from Preset 1 -> Preset 2 settles smoothly to ground/shore
      navDescent.clearInputs();
      navDescent.selectPresetByIndex(1);
      for (let i = 0; i < settleSteps; i += 1) navDescent.update(0.05);
      expect(navDescent.getState().position.y).toBeCloseTo(42.0, 2);

      navDescent.selectPresetByIndex(2);
      for (let i = 0; i < 12; i += 1) navDescent.update(0.05);
      expect(navDescent.getState().isTransitioning).toBe(true);
      navDescent.applyLookDelta(40, -10);
      expect(navDescent.getState().isTransitioning).toBe(false);

      const canceledY = navDescent.getState().position.y;
      let cancelPrevZ = navDescent.getState().position.z;
      let cancelMaxDz = 0;
      for (let i = 0; i < 60; i += 1) {
        navDescent.update(0.05);
        const p = navDescent.getState().position;
        cancelMaxDz = Math.max(cancelMaxDz, Math.abs(p.z - cancelPrevZ));
        cancelPrevZ = p.z;
      }
      const settledAfterCancel = navDescent.getState().position;
      expect(cancelMaxDz).toBeLessThanOrEqual(1.5);
      expect(settledAfterCancel.y).toBeLessThan(canceledY - 15.0);
      expect(settledAfterCancel.z).toBeLessThanOrEqual(
        WORLD_BOUNDS.waterLineZ(settledAfterCancel.x) - SHORE_MARGIN + 1e-4,
      );
      expect(
        Math.abs(
          settledAfterCancel.y -
            (getGroundHeight(settledAfterCancel.x, settledAfterCancel.z) + EYE_HEIGHT),
        ),
      ).toBeLessThan(0.25);

      navDescent.dispose();
    } finally {
      architecture.dispose();
      terrain.dispose();
      materials.dispose();
    }
  });
});

describe('Tier-5 Adversarial Spatial & Framing Invariants', () => {
  it('places zero streetlamp lanterns inside tree canopies, zero sunken benches, and frames presets in good light', () => {
    const materials = createHeadlessMaterialStub();
    const terrain = buildTerrainAndRoads(materials);
    const architecture = buildArchitecture(materials);
    const vegetation = buildVegetationAndProps(materials);

    try {
      // 1. Collect all placed tree crown world bounds from InstancedMeshes
      const treeCrowns: Array<{
        x: number;
        z: number;
        radiusXZ: number;
        minY: number;
        maxY: number;
      }> = [];
      const mat4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();

      vegetation.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh && obj.name.startsWith('TreesCrown_')) {
          obj.geometry.computeBoundingBox();
          const bb = obj.geometry.boundingBox!;
          const baseRadiusXZ = Math.max(
            Math.abs(bb.min.x),
            Math.abs(bb.max.x),
            Math.abs(bb.min.z),
            Math.abs(bb.max.z),
          );
          for (let i = 0; i < obj.count; i++) {
            obj.getMatrixAt(i, mat4);
            mat4.decompose(pos, quat, scl);
            treeCrowns.push({
              x: pos.x,
              z: pos.z,
              radiusXZ: baseRadiusXZ * Math.max(scl.x, scl.z),
              minY: pos.y + bb.min.y * scl.y,
              maxY: pos.y + bb.max.y * scl.y,
            });
          }
        }
      });
      expect(treeCrowns.length).toBeGreaterThan(500);

      // Verify ZERO streetlamp lanterns sit inside any tree canopy
      const lanternMesh = vegetation.group.getObjectByName('StreetLampLanterns') as THREE.InstancedMesh;
      expect(lanternMesh).toBeDefined();
      expect(lanternMesh.count).toBeGreaterThan(70);

      let lanternOverlaps = 0;
      for (let i = 0; i < lanternMesh.count; i++) {
        lanternMesh.getMatrixAt(i, mat4);
        mat4.decompose(pos, quat, scl);
        const lanternMinY = pos.y + 3.71;
        const lanternMaxY = pos.y + 4.07;
        for (const tree of treeCrowns) {
          const d = Math.hypot(pos.x - tree.x, pos.z - tree.z);
          if (d < tree.radiusXZ && lanternMaxY >= tree.minY && lanternMinY <= tree.maxY) {
            lanternOverlaps += 1;
          }
        }
      }
      expect(lanternOverlaps).toBe(0);

      // 2. Verify ZERO sunken promenade benches and ZERO floating bench legs
      const benchMesh = vegetation.group.getObjectByName('PromenadeBenchFrames') as THREE.InstancedMesh;
      expect(benchMesh).toBeDefined();
      expect(benchMesh.count).toBe(11);
      benchMesh.geometry.computeBoundingBox();
      const legMinLocalY = benchMesh.geometry.boundingBox!.min.y;

      for (let i = 0; i < benchMesh.count; i++) {
        benchMesh.getMatrixAt(i, mat4);
        mat4.decompose(pos, quat, scl);
        const shZ = shanhaiguanCenterZ(pos.x);
        const zInner = shZ + 7.72;
        const zOuter = seawallZ(pos.x) + 0.1;
        const yInner = getGroundHeight(pos.x, zInner) + 0.14;
        const yOuter = getGroundHeight(pos.x, zOuter) + 0.14;
        const tFront = clamp((pos.z + 0.24 - zInner) / Math.max(1e-4, zOuter - zInner), 0, 1);
        const tBack = clamp((pos.z - 0.24 - zInner) / Math.max(1e-4, zOuter - zInner), 0, 1);
        const yFront = lerp(yInner, yOuter, tFront);
        const yBack = lerp(yInner, yOuter, tBack);

        // Seat base clears highest apron elevation (zero sunken bench)
        expect(pos.y).toBeGreaterThanOrEqual(Math.max(yFront, yBack) - 1e-6);
        // Leg bottoms penetrate below lowest apron elevation (zero floating legs)
        expect(pos.y + legMinLocalY).toBeLessThan(Math.min(yFront, yBack) - 0.05);
      }

      // 3. Preset sun-angle & zone classification invariants
      const sunDir = new THREE.Vector3(-195, 150.8, 188.5).normalize();
      for (const preset of CAMERA_PRESETS) {
        const fwd = new THREE.Vector3(
          preset.lookAt.x - preset.position.x,
          preset.lookAt.y - preset.position.y,
          preset.lookAt.z - preset.position.z,
        ).normalize();
        const dotSun = fwd.dot(sunDir);
        if (['huashi', 'princess', 'butterfly', 'second_beach'].includes(preset.id)) {
          expect(dotSun, `Preset ${preset.id} stares too directly into SW sun (dot=${dotSun})`).toBeLessThanOrEqual(
            0.4,
          );
        }
      }

      const p1 = CAMERA_PRESETS[0]!;
      expect(getZoneAt(p1.position.x, p1.position.z, p1.position.y).id).toBe('badaguan_panorama');
      const p6 = CAMERA_PRESETS[5]!;
      expect(getZoneAt(p6.position.x, p6.position.z, p6.position.y).id).toBe('second_beach');
    } finally {
      vegetation.dispose();
      architecture.dispose();
      terrain.dispose();
      materials.dispose();
    }
  });
});
