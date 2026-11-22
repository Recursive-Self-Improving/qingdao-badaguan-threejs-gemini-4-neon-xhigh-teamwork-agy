import { expect, test } from '@playwright/test';
import {
  assertCleanRuntime,
  captureAndVerifyPng,
  comparePngDiff,
  dragLook,
  getBadaguanState,
  getHudCoverageRatio,
  holdKey,
  holdKeys,
  horizontalDist,
  openBadaguanScene,
  selectPreset,
  setControlsPanelVisible,
  toggleControlsPanel,
  waitForFrames,
  waitForTransitionEnd,
  wrappedAngleDelta,
  type BadaguanPosition,
  type DecodedPng,
} from './helpers/browserHarness';

interface HorizontalVec {
  dx: number;
  dz: number;
  len: number;
}

function deltaHorizontal(a: BadaguanPosition, b: BadaguanPosition): HorizontalVec {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return { dx, dz, len: Math.hypot(dx, dz) };
}

function dotCos(u: HorizontalVec, v: HorizontalVec): number {
  if (u.len <= 1e-6 || v.len <= 1e-6) {
    return 0;
  }
  return (u.dx * v.dx + u.dz * v.dz) / (u.len * v.len);
}

test.describe('Tier 1 — Core Feature Coverage (Category-Partition)', () => {
  test('T1-01: Initial load, DOM layout, telemetry contract, and active render loop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const { diagnostics, initialState } = await openBadaguanScene(page);

    expect(initialState.ready).toBe(true);
    expect(initialState.error).toBeNull();
    expect(Number.isFinite(initialState.position.x)).toBe(true);
    expect(Number.isFinite(initialState.position.y)).toBe(true);
    expect(Number.isFinite(initialState.position.z)).toBe(true);
    expect(initialState.position.y).toBeGreaterThan(0);
    expect(Number.isFinite(initialState.yaw)).toBe(true);
    expect(Number.isFinite(initialState.pitch)).toBe(true);
    expect(typeof initialState.isTransitioning).toBe('boolean');
    expect(typeof initialState.isPointerLocked).toBe('boolean');
    expect(typeof initialState.controlsVisible).toBe('boolean');
    expect(initialState.activePreset === null || typeof initialState.activePreset === 'string').toBe(true);
    expect(initialState.currentZone.id.length).toBeGreaterThan(0);
    expect(initialState.currentZone.nameZh.length).toBeGreaterThan(0);
    expect(initialState.currentZone.nameEn.length).toBeGreaterThan(0);
    expect(initialState.drawCalls).toBeGreaterThan(0);
    expect(initialState.frameCount).toBeGreaterThan(0);

    const frameStart = initialState.frameCount;
    await page.waitForTimeout(500);
    const laterState = await getBadaguanState(page);
    expect(laterState.frameCount).toBeGreaterThan(frameStart);

    assertCleanRuntime(diagnostics);
  });

  test('T1-02: Canvas drag-look updates yaw and pitch symmetrically without Pointer Lock', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    const hRight = await dragLook(page, 110, 0, 10);
    const hLeft = await dragLook(page, -220, 0, 12);
    const yawScale = Math.max(
      Math.abs(hRight.startState.yaw),
      Math.abs(hRight.endState.yaw),
      Math.abs(hLeft.endState.yaw),
    );
    const dYawRight = wrappedAngleDelta(hRight.startState.yaw, hRight.endState.yaw, yawScale);
    const dYawLeft = wrappedAngleDelta(hLeft.startState.yaw, hLeft.endState.yaw, yawScale);
    expect(Math.abs(dYawRight)).toBeGreaterThan(0.01);
    expect(hRight.endState.isPointerLocked).toBe(false);
    expect(Math.abs(dYawLeft)).toBeGreaterThan(0.01);
    expect(dYawRight * dYawLeft).toBeLessThan(0);

    const vDown = await dragLook(page, 0, 70, 10);
    const dPitchDown = vDown.endState.pitch - vDown.startState.pitch;
    expect(Math.abs(dPitchDown)).toBeGreaterThan(0.005);

    const vUp = await dragLook(page, 0, -140, 12);
    const dPitchUp = vUp.endState.pitch - vUp.startState.pitch;
    expect(Math.abs(dPitchUp)).toBeGreaterThan(0.005);
    expect(dPitchDown * dPitchUp).toBeLessThan(0);

    expect(Number.isFinite(vUp.endState.yaw)).toBe(true);
    expect(Number.isFinite(vUp.endState.pitch)).toBe(true);
    assertCleanRuntime(diagnostics);
  });

  test('T1-03: Optional Pointer Lock invocation and Escape exit degrade gracefully', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);
    const canvas = page.getByTestId('scene-canvas');

    await canvas.dblclick();
    await waitForFrames(page, 2);
    await page.keyboard.press('KeyF');
    await waitForFrames(page, 2);
    await page.keyboard.press('Escape');
    await waitForFrames(page, 2);

    const afterEsc = await getBadaguanState(page);
    expect(afterEsc.isPointerLocked).toBe(false);

    // Drag-look must still work normally regardless of whether headless browser denied Pointer Lock.
    const dragRes = await dragLook(page, 120, -20, 10);
    expect(Math.abs(wrappedAngleDelta(dragRes.startState.yaw, dragRes.endState.yaw))).toBeGreaterThan(0.01);

    assertCleanRuntime(diagnostics);
  });

  test('T1-04: Camera-relative WASD and Arrow keys move along forward/back/strafe axes', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    const wRes = await holdKey(page, 'KeyW', 450, 4);
    const vW = deltaHorizontal(wRes.startState.position, wRes.endState.position);
    expect(vW.len).toBeGreaterThan(0.3);
    expect(wRes.endState.position.y).toBeGreaterThan(0);

    const sRes = await holdKey(page, 'KeyS', 450, 4);
    const vS = deltaHorizontal(sRes.startState.position, sRes.endState.position);
    expect(vS.len).toBeGreaterThan(0.3);
    expect(dotCos(vW, vS)).toBeLessThan(-0.7);

    const aRes = await holdKey(page, 'KeyA', 450, 4);
    const vA = deltaHorizontal(aRes.startState.position, aRes.endState.position);
    expect(vA.len).toBeGreaterThan(0.3);
    expect(Math.abs(dotCos(vW, vA))).toBeLessThan(0.35);

    const dRes = await holdKey(page, 'KeyD', 450, 4);
    const vD = deltaHorizontal(dRes.startState.position, dRes.endState.position);
    expect(vD.len).toBeGreaterThan(0.3);
    expect(Math.abs(dotCos(vW, vD))).toBeLessThan(0.35);
    expect(dotCos(vA, vD)).toBeLessThan(-0.7);

    // Reset before testing Arrow keys to keep equal clearance.
    await page.keyboard.press('KeyR');
    await waitForTransitionEnd(page);

    const upRes = await holdKey(page, 'ArrowUp', 450, 4);
    const vUp = deltaHorizontal(upRes.startState.position, upRes.endState.position);
    expect(vUp.len).toBeGreaterThan(0.3);
    expect(dotCos(vW, vUp)).toBeGreaterThan(0.7);

    const downRes = await holdKey(page, 'ArrowDown', 450, 4);
    const vDown = deltaHorizontal(downRes.startState.position, downRes.endState.position);
    expect(vDown.len).toBeGreaterThan(0.3);
    expect(dotCos(vUp, vDown)).toBeLessThan(-0.7);

    const leftRes = await holdKey(page, 'ArrowLeft', 450, 4);
    const vLeft = deltaHorizontal(leftRes.startState.position, leftRes.endState.position);
    expect(vLeft.len).toBeGreaterThan(0.3);
    expect(Math.abs(dotCos(vUp, vLeft))).toBeLessThan(0.35);

    const rightRes = await holdKey(page, 'ArrowRight', 450, 4);
    const vRight = deltaHorizontal(rightRes.startState.position, rightRes.endState.position);
    expect(vRight.len).toBeGreaterThan(0.3);
    expect(dotCos(vLeft, vRight)).toBeLessThan(-0.7);

    assertCleanRuntime(diagnostics);
  });

  test('T1-05: Shift sprint increases horizontal travel speed and R resets to initial vista', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    const walkRes = await holdKey(page, 'KeyW', 500, 4);
    const walkDist = horizontalDist(walkRes.startState.position, walkRes.endState.position);
    const walkSpeed = walkDist / Math.max(0.1, walkRes.elapsedMs / 1000);
    expect(walkDist).toBeGreaterThan(0.3);

    await page.keyboard.press('KeyR');
    const afterFirstReset = await waitForTransitionEnd(page);
    expect(horizontalDist(afterFirstReset.position, initialState.position)).toBeLessThan(1.0);

    const sprintRes = await holdKeys(page, ['Shift', 'KeyW'], 500, 4);
    const sprintDist = horizontalDist(sprintRes.startState.position, sprintRes.endState.position);
    const sprintSpeed = sprintDist / Math.max(0.1, sprintRes.elapsedMs / 1000);
    expect(sprintSpeed).toBeGreaterThan(walkSpeed * 1.25);

    await page.keyboard.press('KeyR');
    const afterSecondReset = await waitForTransitionEnd(page);
    expect(horizontalDist(afterSecondReset.position, initialState.position)).toBeLessThan(1.0);

    assertCleanRuntime(diagnostics);
  });

  test('T1-06: Preset hotkeys 1-6 transition smoothly to 6 distinct viewpoints across multiple zones', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    const presetIds = new Set<string>();
    const zoneIds = new Set<string>();
    const poses: { x: number; y: number; z: number }[] = [];

    for (let i = 1; i <= 6; i += 1) {
      const state = await selectPreset(page, i, 'key', true);
      expect(state.isTransitioning).toBe(false);
      expect(state.activePreset).not.toBeNull();
      if (state.activePreset) {
        presetIds.add(state.activePreset);
      }
      zoneIds.add(state.currentZone.id);
      poses.push(state.position);
    }

    expect(presetIds.size).toBe(6);
    expect(zoneIds.size).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < poses.length; i += 1) {
      for (let j = i + 1; j < poses.length; j += 1) {
        const a = poses[i];
        const b = poses[j];
        if (a && b) {
          const dist3d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          expect(dist3d, `Presets ${i + 1} and ${j + 1} share identical positions`).toBeGreaterThan(2.0);
        }
      }
    }

    assertCleanRuntime(diagnostics);
  });

  test('T1-07: Clickable preset pill buttons 1-6 match hotkey viewpoints without rotating canvas', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    const hotkeySnapshots: { activePreset: string | null; pos: BadaguanPosition }[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const state = await selectPreset(page, i, 'key', true);
      hotkeySnapshots.push({ activePreset: state.activePreset, pos: state.position });
    }

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 6; i >= 1; i -= 1) {
      const pill = page.getByTestId(`preset-btn-${i}`);
      await expect(pill).toBeVisible();
      const clickState = await selectPreset(page, i, 'click', true);
      const expected = hotkeySnapshots[i - 1];
      expect(expected).toBeDefined();
      if (expected) {
        expect(clickState.activePreset).toBe(expected.activePreset);
        const delta3d = Math.hypot(
          clickState.position.x - expected.pos.x,
          clickState.position.y - expected.pos.y,
          clickState.position.z - expected.pos.z,
        );
        expect(delta3d).toBeLessThan(0.5);
      }
      minY = Math.min(minY, clickState.position.y);
      maxY = Math.max(maxY, clickState.position.y);
    }

    expect(maxY - minY).toBeGreaterThan(1.0);
    assertCleanRuntime(diagnostics);
  });

  test('T1-08: Location badge displays bilingual Chinese/English zone info and updates dynamically', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    const badge = page.getByTestId('location-badge');
    await expect(badge).toBeVisible();

    const observedTexts = new Set<string>();

    for (let i = 1; i <= 6; i += 1) {
      const state = await selectPreset(page, i, 'key', true);
      const text = (await badge.innerText()).trim();
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\b(undefined|null|NaN)\b/i);

      const matchesZone =
        text.includes(state.currentZone.nameZh) ||
        text.includes(state.currentZone.nameEn) ||
        (state.currentZone.landmarkZh ? text.includes(state.currentZone.landmarkZh) : false);
      expect(matchesZone, `Badge "${text}" did not reflect zone ${JSON.stringify(state.currentZone)}`).toBe(true);
      observedTexts.add(text);
    }

    expect(observedTexts.size).toBeGreaterThanOrEqual(2);
    assertCleanRuntime(diagnostics);
  });

  test('T1-09: Multi-preset screenshots have non-blank pixel entropy and distinct compositions', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    const decodedShots: DecodedPng[] = [];
    const targetPresets = [1, 3, 6];

    for (const presetIdx of targetPresets) {
      await selectPreset(page, presetIdx, 'click', true);
      const { png } = await captureAndVerifyPng(page, `test-results/tier1-renders/preset-${presetIdx}.png`);
      decodedShots.push(png);
    }

    for (let i = 0; i < decodedShots.length; i += 1) {
      for (let j = i + 1; j < decodedShots.length; j += 1) {
        const a = decodedShots[i];
        const b = decodedShots[j];
        if (a && b) {
          const diff = comparePngDiff(a, b);
          expect(diff, `Preset captures ${targetPresets[i]} and ${targetPresets[j]} look nearly identical`).toBeGreaterThanOrEqual(0.05);
        }
      }
    }

    assertCleanRuntime(diagnostics);
  });

  test('T1-10: Minimal HUD leaves at least 85% of viewport unobstructed and clear of screen center', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    const report = await getHudCoverageRatio(page);
    expect(report.boxes.length).toBeGreaterThanOrEqual(3);
    expect(report.allInsideViewport).toBe(true);
    expect(report.overlapsCenter).toBe(false);
    expect(report.ratio).toBeLessThanOrEqual(0.15);

    assertCleanRuntime(diagnostics);
  });

  test('T1-11: Controls hint panel toggles cleanly via H hotkey and toggle button', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    const panel = page.getByTestId('controls-panel');
    const toggleBtn = page.getByTestId('controls-toggle');
    await expect(toggleBtn).toBeVisible();

    if (initialState.controlsVisible) {
      await expect(panel).toBeVisible();
    } else {
      await expect(panel).toBeHidden();
    }

    const afterKeyOpen = await toggleControlsPanel(page, 'key');
    expect(afterKeyOpen.controlsVisible).toBe(!initialState.controlsVisible);

    // Ensure panel is open so we can verify its instructional content.
    const openState = afterKeyOpen.controlsVisible ? afterKeyOpen : await toggleControlsPanel(page, 'key');
    expect(openState.controlsVisible).toBe(true);
    await expect(panel).toBeVisible();

    const panelText = await panel.innerText();
    expect(panelText).toMatch(/WASD|W\/A\/S\/D|方向鍵|Arrow/i);
    expect(panelText).toMatch(/Shift/i);
    expect(panelText).toMatch(/1.*6|預設|Preset/i);
    expect(panelText).toMatch(/\bR\b|重置|Reset/i);

    const afterClickClose = await toggleControlsPanel(page, 'click');
    expect(afterClickClose.controlsVisible).toBe(false);
    await expect(panel).toBeHidden();

    const afterClickOpen = await toggleControlsPanel(page, 'click');
    expect(afterClickOpen.controlsVisible).toBe(true);
    await expect(panel).toBeVisible();

    const afterKeyClose = await toggleControlsPanel(page, 'key');
    expect(afterKeyClose.controlsVisible).toBe(false);
    await expect(panel).toBeHidden();

    assertCleanRuntime(diagnostics);
  });
});
