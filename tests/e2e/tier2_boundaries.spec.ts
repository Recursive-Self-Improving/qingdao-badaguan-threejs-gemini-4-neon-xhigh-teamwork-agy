import { expect, test } from '@playwright/test';
import {
  assertCleanRuntime,
  attachSceneDiagnostics,
  dragLook,
  dragOnElement,
  getBadaguanState,
  getHudCoverageRatio,
  holdKey,
  holdKeys,
  horizontalDist,
  openBadaguanScene,
  resolveSceneUrl,
  selectPreset,
  setControlsPanelVisible,
  simulateWebGLUnavailable,
  tryGetBadaguanState,
  waitForFrames,
  waitForTransitionEnd,
  wrappedAngleDelta,
} from './helpers/browserHarness';

test.describe('Tier 2 — Boundary Value Analysis & Fault Guards', () => {
  test('T2-01: Extreme vertical mouse drags clamp pitch without NaN or gimbal flip', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    for (let i = 0; i < 4; i += 1) {
      await dragLook(page, 0, -300, 8);
    }
    const upSat1 = await getBadaguanState(page);
    await dragLook(page, 0, -300, 8);
    const upSat2 = await getBadaguanState(page);

    expect(Number.isFinite(upSat1.pitch)).toBe(true);
    expect(Number.isFinite(upSat2.pitch)).toBe(true);
    expect(Math.abs(upSat2.pitch - upSat1.pitch)).toBeLessThan(0.01);

    for (let i = 0; i < 6; i += 1) {
      await dragLook(page, 0, 300, 8);
    }
    const downSat1 = await getBadaguanState(page);
    await dragLook(page, 0, 300, 8);
    const downSat2 = await getBadaguanState(page);

    expect(Number.isFinite(downSat1.pitch)).toBe(true);
    expect(Number.isFinite(downSat2.pitch)).toBe(true);
    expect(Math.abs(downSat2.pitch - downSat1.pitch)).toBeLessThan(0.01);
    expect(upSat1.pitch * downSat1.pitch).toBeLessThan(0);

    // Unit-agnostic check: radians (|pitch| <= 2.0) vs degrees.
    const maxAbsPitch = Math.max(Math.abs(upSat1.pitch), Math.abs(downSat1.pitch));
    if (maxAbsPitch <= 2.0) {
      expect(maxAbsPitch).toBeLessThanOrEqual(Math.PI / 2 + 0.01);
      expect(maxAbsPitch).toBeGreaterThan(0.8);
    } else {
      expect(maxAbsPitch).toBeLessThanOrEqual(85);
      expect(maxAbsPitch).toBeGreaterThan(45);
    }

    assertCleanRuntime(diagnostics);
  });

  test('T2-02: Ocean sea-level and world/building boundaries clamp cleanly without sinking or NaN', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    // Locate the southernmost ground-level preset (largest Z with y < 15).
    let coastalPreset = 1;
    let bestZ = Number.NEGATIVE_INFINITY;
    for (let i = 1; i <= 6; i += 1) {
      const s = await selectPreset(page, i, 'key', true);
      if (s.position.y < 15 && s.position.z > bestZ) {
        bestZ = s.position.z;
        coastalPreset = i;
      }
    }

    const coastalStart = await selectPreset(page, coastalPreset, 'key', true);
    await setControlsPanelVisible(page, false);

    // Sample headings across full 360° so KeyW advances toward +Z (Yellow Sea coast).
    let bestTurn = 0;
    let bestDz = Number.NEGATIVE_INFINITY;
    for (let turn = 0; turn < 14; turn += 1) {
      const probe = await holdKey(page, 'KeyW', 250, 3);
      const dz = probe.endState.position.z - probe.startState.position.z;
      if (dz > bestDz) {
        bestDz = dz;
        bestTurn = turn;
      }
      if (dz > 0.6) {
        break;
      }
      await dragLook(page, 280, 0, 8);
    }

    if (bestTurn > 0) {
      await selectPreset(page, coastalPreset, 'key', true);
      for (let t = 0; t < bestTurn; t += 1) {
        await dragLook(page, 280, 0, 8);
      }
    }

    // Sprint south toward the shoreline in bursts and confirm sea-level clamping.
    let lastDeltaZ = Number.POSITIVE_INFINITY;
    let finalZ = coastalStart.position.z;
    let maxZ = coastalStart.position.z;
    for (let burst = 0; burst < 4; burst += 1) {
      const res = await holdKeys(page, ['Shift', 'KeyW'], 1200, 6);
      expect(Number.isFinite(res.endState.position.x)).toBe(true);
      expect(Number.isFinite(res.endState.position.y)).toBe(true);
      expect(Number.isFinite(res.endState.position.z)).toBe(true);
      expect(res.endState.position.y).toBeGreaterThan(0.5);
      lastDeltaZ = res.endState.position.z - res.startState.position.z;
      finalZ = res.endState.position.z;
      maxZ = Math.max(maxZ, finalZ);
    }
    expect(finalZ).toBeGreaterThanOrEqual(coastalStart.position.z - 1.0);
    if (bestDz > 0.2) {
      expect(maxZ).toBeGreaterThan(coastalStart.position.z - 0.5);
    }
    expect(Math.abs(lastDeltaZ)).toBeLessThan(2.5);

    // Move to another street preset and sprint toward inland buildings/perimeter.
    const inlandPreset = coastalPreset === 1 ? 3 : 1;
    await selectPreset(page, inlandPreset, 'key', true);
    for (let burst = 0; burst < 3; burst += 1) {
      const res = await holdKeys(page, ['Shift', 'KeyW'], 1000, 5);
      expect(Number.isFinite(res.endState.position.x)).toBe(true);
      expect(Number.isFinite(res.endState.position.y)).toBe(true);
      expect(Number.isFinite(res.endState.position.z)).toBe(true);
      expect(res.endState.position.y).toBeGreaterThan(0.5);
    }

    assertCleanRuntime(diagnostics);
  });

  test('T2-03: window.blur clears held movement keys immediately', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    await page.keyboard.down('KeyW');
    try {
      const startState = await getBadaguanState(page);
      await page.waitForTimeout(300);
      await waitForFrames(page, 3);
      const movingState = await getBadaguanState(page);
      expect(horizontalDist(startState.position, movingState.position)).toBeGreaterThan(0.2);

      // Dispatch window blur while KeyW is still synthetically depressed.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
      });

      await page.waitForTimeout(150);
      const afterBlur = await getBadaguanState(page);
      await page.waitForTimeout(450);
      await waitForFrames(page, 2);
      const settled = await getBadaguanState(page);

      expect(horizontalDist(afterBlur.position, settled.position)).toBeLessThan(0.15);
    } finally {
      await page.keyboard.up('KeyW').catch(() => undefined);
    }

    assertCleanRuntime(diagnostics);
  });

  test('T2-04: Dragging on HUD elements does not propagate to canvas camera rotation', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    const targets = ['preset-btn-2', 'controls-toggle', 'location-badge'];
    for (const testId of targets) {
      const locator = page.getByTestId(testId);
      await expect(locator).toBeVisible();
      const before = await getBadaguanState(page);
      await dragOnElement(page, locator, 40, 20, 8);
      const after = await getBadaguanState(page);

      expect(Math.abs(wrappedAngleDelta(before.yaw, after.yaw)), `Drag on ${testId} leaked to yaw`).toBeLessThan(0.0001);
      expect(Math.abs(after.pitch - before.pitch), `Drag on ${testId} leaked to pitch`).toBeLessThan(0.0001);
    }

    assertCleanRuntime(diagnostics);
  });

  test('T2-05: Responsive viewport resize preserves full-bleed canvas, HUD bounds, and render loop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    const viewports = [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 1024, height: 768 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      const s1 = await waitForFrames(page, 3);
      const s2 = await waitForFrames(page, 2);
      expect(s2.frameCount).toBeGreaterThan(s1.frameCount);

      const canvasBox = await page.getByTestId('scene-canvas').boundingBox();
      expect(canvasBox).not.toBeNull();
      if (canvasBox) {
        expect(canvasBox.width).toBeGreaterThanOrEqual(vp.width - 2);
        expect(canvasBox.height).toBeGreaterThanOrEqual(vp.height - 2);
      }

      const hud = await getHudCoverageRatio(page);
      expect(hud.allInsideViewport, `HUD clipped at ${vp.width}x${vp.height}`).toBe(true);
      expect(hud.overlapsCenter, `HUD overlapped center at ${vp.width}x${vp.height}`).toBe(false);
      expect(hud.ratio, `HUD exceeded 15% at ${vp.width}x${vp.height}`).toBeLessThanOrEqual(0.15);
    }

    assertCleanRuntime(diagnostics);
  });

  test('T2-06: Rapid preset switching settles cleanly, invalid keys are ignored, and H rapid toggle avoids focus trap', async ({
    page,
  }) => {
    const { diagnostics } = await openBadaguanScene(page);

    const expectedPreset6 = await selectPreset(page, 6, 'key', true);
    await selectPreset(page, 1, 'key', true);

    const rapidSequence = ['1', '3', '5', '2', '6'];
    for (const key of rapidSequence) {
      await page.keyboard.press(key);
      await page.waitForTimeout(40);
    }
    const settledAfterMash = await waitForTransitionEnd(page);
    expect(settledAfterMash.isTransitioning).toBe(false);
    expect(settledAfterMash.activePreset).toBe(expectedPreset6.activePreset);
    expect(horizontalDist(settledAfterMash.position, expectedPreset6.position)).toBeLessThan(1.0);

    const invalidKeys = ['0', '7', '8', '9', 'KeyZ', 'Backspace'];
    for (const badKey of invalidKeys) {
      await page.keyboard.press(badKey);
    }
    const afterInvalid = await waitForFrames(page, 2);
    expect(afterInvalid.activePreset).toBe(expectedPreset6.activePreset);

    const beforeToggle = afterInvalid.controlsVisible;
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('KeyH');
      await page.waitForTimeout(30);
    }
    const afterToggle = await waitForFrames(page, 2);
    expect(afterToggle.controlsVisible).toBe(!beforeToggle);

    // Ensure movement still works immediately without re-clicking canvas.
    const walkRes = await holdKey(page, 'KeyW', 350, 3);
    expect(horizontalDist(walkRes.startState.position, walkRes.endState.position)).toBeGreaterThan(0.2);

    assertCleanRuntime(diagnostics);
  });

  test('T2-07: Isolated WebGL-unavailable environment renders readable fallback without uncaught exceptions', async ({
    page,
  }) => {
    await simulateWebGLUnavailable(page);
    const diagnostics = attachSceneDiagnostics(page);

    await page.goto(resolveSceneUrl(), { waitUntil: 'domcontentloaded' });

    const fallback = page.getByTestId('webgl-fallback');
    await expect(fallback).toBeVisible({ timeout: 15_000 });
    const fallbackText = (await fallback.innerText()).trim();
    expect(fallbackText.length).toBeGreaterThan(5);

    await expect(page.getByTestId('loading-overlay')).toBeHidden({ timeout: 10_000 });

    const state = await tryGetBadaguanState(page);
    if (state) {
      expect(state.ready).toBe(false);
    }

    assertCleanRuntime(diagnostics, { allowConsoleErrors: true, allowWebglWarnings: true });
  });

  test('T2-08: WEBGL_lose_context pauses loop with fallback and restores rendering cleanly on context restore', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patchedCaptureContext(
        this: HTMLCanvasElement,
        contextId: string,
        options?: unknown,
      ): RenderingContext | null {
        const ctx = origGetContext.call(
          this,
          contextId as 'webgl2',
          options as WebGLContextAttributes,
        );
        if (
          ctx &&
          (contextId.toLowerCase() === 'webgl2' || contextId.toLowerCase() === 'webgl')
        ) {
          (window as unknown as { __CAPTURED_GL__?: WebGLRenderingContext }).__CAPTURED_GL__ =
            ctx as WebGLRenderingContext;
        }
        return ctx;
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    const { diagnostics } = await openBadaguanScene(page);

    const loseExtAvailable = await page.evaluate(() => {
      const gl = (window as unknown as { __CAPTURED_GL__?: WebGLRenderingContext })
        .__CAPTURED_GL__;
      const ext = gl?.getExtension('WEBGL_lose_context') ?? null;
      (window as unknown as { __LOSE_CTX_EXT__?: WEBGL_lose_context | null }).__LOSE_CTX_EXT__ =
        ext;
      if (ext) {
        ext.loseContext();
        return true;
      }
      return false;
    });

    expect(loseExtAvailable).toBe(true);

    const fallback = page.getByTestId('webgl-fallback');
    await expect(fallback).toBeVisible({ timeout: 10_000 });
    expect((await fallback.innerText()).trim()).toContain('WebGL context lost');

    const lostState = await getBadaguanState(page);
    expect(lostState.error).toBe('WebGL context lost');

    // Confirm render loop is paused while context is lost
    await page.waitForTimeout(250);
    const pausedState = await getBadaguanState(page);
    expect(pausedState.frameCount).toBe(lostState.frameCount);

    // Restore WebGL context and verify recovery
    await page.evaluate(() => {
      const ext = (window as unknown as { __LOSE_CTX_EXT__?: WEBGL_lose_context | null })
        .__LOSE_CTX_EXT__;
      ext?.restoreContext();
    });

    await expect(fallback).toBeHidden({ timeout: 10_000 });
    const recoveredState = await waitForFrames(page, 4, 15_000);
    expect(recoveredState.error).toBeNull();
    expect(recoveredState.frameCount).toBeGreaterThan(lostState.frameCount + 2);
    expect(recoveredState.drawCalls).toBeGreaterThan(0);

    // Verify scene remains interactive after context restoration
    const presetRes = await selectPreset(page, 3, 'key', true);
    expect(presetRes.activePreset).toBe('princess');

    assertCleanRuntime(diagnostics, { allowWebglWarnings: true });
  });
});
