import { expect, test } from '@playwright/test';
import {
  assertCleanRuntime,
  dragLook,
  getBadaguanState,
  holdKey,
  holdKeys,
  horizontalDist,
  openBadaguanScene,
  selectPreset,
  setControlsPanelVisible,
  waitForFrames,
  wrappedAngleDelta,
  type BadaguanPosition,
} from './helpers/browserHarness';

test.describe('Tier 3 — Pairwise Cross-Feature Combinations', () => {
  test('T3-01: Manual WASD and mouse drag cancel preset flight immediately without snap-back', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    // Discover presets to pick a well-separated pair for flight interruption.
    const presetPos: { index: number; pos: BadaguanPosition }[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const s = await selectPreset(page, i, 'key', true);
      presetPos.push({ index: i, pos: s.position });
    }

    let startIdx = 2;
    let targetIdx = 6;
    let bestDist = -1;
    for (let i = 0; i < presetPos.length; i += 1) {
      for (let j = i + 1; j < presetPos.length; j += 1) {
        const a = presetPos[i];
        const b = presetPos[j];
        if (a && b) {
          const d = horizontalDist(a.pos, b.pos);
          if (d > bestDist) {
            bestDist = d;
            startIdx = a.index;
            targetIdx = b.index;
          }
        }
      }
    }

    const targetPos = presetPos.find((p) => p.index === targetIdx)?.pos ?? presetPos[5]?.pos;
    expect(targetPos).toBeDefined();

    // (a) Interrupt flight with manual KeyW movement.
    await selectPreset(page, startIdx, 'key', true);
    await selectPreset(page, targetIdx, 'key', false);
    await page.waitForTimeout(100);
    const midFlightA = await getBadaguanState(page);
    expect(midFlightA.isTransitioning).toBe(true);

    const walkCancel = await holdKey(page, 'KeyW', 450, 4);
    expect(walkCancel.endState.isTransitioning).toBe(false);

    const posRightAfterCancel = walkCancel.endState.position;
    await page.waitForTimeout(1500);
    const afterWaitA = await waitForFrames(page, 2);
    expect(afterWaitA.isTransitioning).toBe(false);
    expect(horizontalDist(afterWaitA.position, posRightAfterCancel)).toBeLessThan(0.35);
    if (targetPos) {
      expect(horizontalDist(afterWaitA.position, targetPos)).toBeGreaterThan(2.0);
    }

    // (b) Interrupt flight with manual mouse drag look.
    await selectPreset(page, startIdx, 'key', true);
    await selectPreset(page, targetIdx, 'key', false);
    await page.waitForTimeout(100);
    const midFlightB = await getBadaguanState(page);
    expect(midFlightB.isTransitioning).toBe(true);

    const dragCancel = await dragLook(page, 140, -25, 8);
    expect(dragCancel.endState.isTransitioning).toBe(false);
    expect(Math.abs(wrappedAngleDelta(dragCancel.startState.yaw, dragCancel.endState.yaw))).toBeGreaterThan(0.01);

    const posAfterDrag = dragCancel.endState.position;
    await page.waitForTimeout(1500);
    const afterWaitB = await waitForFrames(page, 2);
    expect(afterWaitB.isTransitioning).toBe(false);
    expect(horizontalDist(afterWaitB.position, posAfterDrag)).toBeLessThan(0.35);
    if (targetPos) {
      expect(horizontalDist(afterWaitB.position, targetPos)).toBeGreaterThan(2.0);
    }

    assertCleanRuntime(diagnostics);
  });

  test('T3-02: Walking after elevated panorama preset preserves ground clearance and finite height', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    let elevatedPreset = 1;
    let highestY = Number.NEGATIVE_INFINITY;
    for (let i = 1; i <= 6; i += 1) {
      const s = await selectPreset(page, i, 'key', true);
      if (s.position.y > highestY) {
        highestY = s.position.y;
        elevatedPreset = i;
      }
    }

    const startState = await selectPreset(page, elevatedPreset, 'key', true);
    const frameBefore = startState.frameCount;

    const wRes = await holdKey(page, 'KeyW', 1200, 6);
    expect(wRes.endState.isTransitioning).toBe(false);
    expect(horizontalDist(wRes.startState.position, wRes.endState.position)).toBeGreaterThan(0.5);
    expect(wRes.endState.position.y).toBeGreaterThan(0.5);
    expect(Number.isFinite(wRes.endState.position.y)).toBe(true);

    const aRes = await holdKey(page, 'KeyA', 500, 4);
    expect(aRes.endState.position.y).toBeGreaterThan(0.5);
    expect(Number.isFinite(aRes.endState.position.y)).toBe(true);
    expect(aRes.endState.frameCount).toBeGreaterThan(frameBefore + 8);

    assertCleanRuntime(diagnostics);
  });

  test('T3-03: Toggling controls hint via H mid-walk or via button never traps focus or stalls movement', async ({
    page,
  }) => {
    const { diagnostics } = await openBadaguanScene(page);
    const startState = await getBadaguanState(page);
    const initialControls = startState.controlsVisible;

    await page.keyboard.down('KeyW');
    try {
      await page.waitForTimeout(250);
      await waitForFrames(page, 2);
      const midPos1 = (await getBadaguanState(page)).position;
      expect(horizontalDist(startState.position, midPos1)).toBeGreaterThan(0.15);

      await page.keyboard.press('KeyH');
      await page.waitForTimeout(150);
      await waitForFrames(page, 4);
      const toggledState = await getBadaguanState(page);
      expect(toggledState.controlsVisible).toBe(!initialControls);
      expect(horizontalDist(midPos1, toggledState.position)).toBeGreaterThan(0.05);

      await page.waitForTimeout(300);
      await page.keyboard.press('KeyH');
      await waitForFrames(page, 2);
      const restoredState = await getBadaguanState(page);
      expect(restoredState.controlsVisible).toBe(initialControls);
      expect(horizontalDist(toggledState.position, restoredState.position)).toBeGreaterThan(0.15);
    } finally {
      await page.keyboard.up('KeyW').catch(() => undefined);
    }

    // Click controls-toggle button directly, then walk immediately without clicking canvas.
    await page.getByTestId('controls-toggle').click();
    await waitForFrames(page, 2);
    const walkAfterClick = await holdKey(page, 'KeyW', 450, 4);
    expect(horizontalDist(walkAfterClick.startState.position, walkAfterClick.endState.position)).toBeGreaterThan(0.25);

    assertCleanRuntime(diagnostics);
  });

  test('T3-04: Simultaneous WASD movement and canvas mouse drag look update pose smoothly', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);
    const startState = await getBadaguanState(page);

    await page.keyboard.down('KeyW');
    try {
      await dragLook(page, 180, -20, 16);
      await page.waitForTimeout(250);
      await waitForFrames(page, 3);
    } finally {
      await page.keyboard.up('KeyW').catch(() => undefined);
    }

    const endState = await waitForFrames(page, 2);
    expect(horizontalDist(startState.position, endState.position)).toBeGreaterThan(0.4);
    expect(Math.abs(wrappedAngleDelta(startState.yaw, endState.yaw))).toBeGreaterThan(0.02);
    expect(endState.frameCount).toBeGreaterThan(startState.frameCount + 5);
    expect(Number.isFinite(endState.position.y)).toBe(true);

    assertCleanRuntime(diagnostics);
  });

  test('T3-05: Sprint with oblique input slides cleanly along boundaries and walls without stalling', async ({ page }) => {
    const { diagnostics } = await openBadaguanScene(page);

    // Choose a ground-level preset near architecture/coastline.
    let groundPreset = 2;
    for (let i = 1; i <= 6; i += 1) {
      const s = await selectPreset(page, i, 'key', true);
      if (s.position.y > 0.5 && s.position.y < 12) {
        groundPreset = i;
        break;
      }
    }

    const baseState = await selectPreset(page, groundPreset, 'key', true);
    await dragLook(page, 55, 0, 6);

    const frameStart = baseState.frameCount;
    const sprintRes = await holdKeys(page, ['Shift', 'KeyW', 'KeyD'], 2000, 10);

    expect(sprintRes.endState.frameCount).toBeGreaterThan(frameStart + 10);
    expect(Number.isFinite(sprintRes.endState.position.x)).toBe(true);
    expect(Number.isFinite(sprintRes.endState.position.y)).toBe(true);
    expect(Number.isFinite(sprintRes.endState.position.z)).toBe(true);
    expect(sprintRes.endState.position.y).toBeGreaterThan(0.5);
    expect(sprintRes.endState.drawCalls).toBeGreaterThan(0);

    assertCleanRuntime(diagnostics);
  });
});
