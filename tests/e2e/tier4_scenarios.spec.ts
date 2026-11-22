import { expect, test, type Page } from '@playwright/test';
import {
  assertCleanRuntime,
  dragLook,
  getBadaguanState,
  holdKey,
  holdKeys,
  horizontalDist,
  openBadaguanScene,
  selectPreset,
  toggleControlsPanel,
  waitForFrames,
  waitForTransitionEnd,
  type BadaguanPublicState,
} from './helpers/browserHarness';

interface DiscoveredPreset {
  index: number;
  label: string;
  state: BadaguanPublicState;
}

async function discoverPresets(page: Page): Promise<DiscoveredPreset[]> {
  const results: DiscoveredPreset[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const label = (await page.getByTestId(`preset-btn-${i}`).innerText()).trim();
    const state = await selectPreset(page, i, 'key', true);
    results.push({ index: i, label, state });
  }
  return results;
}

function findPresetIndex(
  presets: readonly DiscoveredPreset[],
  pattern: RegExp,
  fallbackIndex: number,
): number {
  const match = presets.find((p) => {
    const hay = `${p.label} ${p.state.currentZone.id} ${p.state.currentZone.nameZh} ${p.state.currentZone.nameEn} ${p.state.currentZone.landmarkZh ?? ''}`;
    return pattern.test(hay);
  });
  return match?.index ?? fallbackIndex;
}

async function recordZoneStep(
  page: Page,
  visitedZones: Set<string>,
  badgeHistory: Set<string>,
): Promise<BadaguanPublicState> {
  const state = await getBadaguanState(page);
  visitedZones.add(state.currentZone.id);
  const badgeText = (await page.getByTestId('location-badge').innerText()).trim();
  expect(badgeText.length).toBeGreaterThan(0);
  badgeHistory.add(badgeText);
  expect(Number.isFinite(state.position.x)).toBe(true);
  expect(Number.isFinite(state.position.y)).toBe(true);
  expect(Number.isFinite(state.position.z)).toBe(true);
  expect(state.position.y).toBeGreaterThan(0.5);
  return state;
}

test.describe('Tier 4 — Real-World Visitor Scenarios', () => {
  test('T4-01: First-Time Visitor Onboarding & Inland Pass-Road Tour', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    const startFrame = initialState.frameCount;

    // 1. Visitor opens controls hint to read instructions, then closes it.
    if (!initialState.controlsVisible) {
      const opened = await toggleControlsPanel(page, 'key');
      expect(opened.controlsVisible).toBe(true);
      await expect(page.getByTestId('controls-panel')).toBeVisible();
    }
    const closed = await toggleControlsPanel(page, 'key');
    expect(closed.controlsVisible).toBe(false);

    const presets = await discoverPresets(page);
    const inlandIdx = findPresetIndex(presets, /juyong|princess|公主|居庸|jiayuguan|maple|嘉峪|zhengyang|正陽/i, 3);
    const secondInlandIdx = findPresetIndex(presets, /jiayuguan|maple|嘉峪|zhengyang|正陽|ningwu|寧武/i, inlandIdx === 3 ? 4 : 3);

    const visitedZones = new Set<string>();
    const badgeHistory = new Set<string>();

    // 2. Visit inland pass-road preset and stroll across intersections.
    await selectPreset(page, inlandIdx, 'click', true);
    await recordZoneStep(page, visitedZones, badgeHistory);

    await holdKeys(page, ['Shift', 'KeyW'], 900, 5);
    await recordZoneStep(page, visitedZones, badgeHistory);
    await dragLook(page, 85, -5, 8);
    await holdKey(page, 'KeyW', 800, 5);
    await recordZoneStep(page, visitedZones, badgeHistory);

    // 3. Hop to second inland maple/sycamore corridor and walk further.
    await selectPreset(page, secondInlandIdx, 'key', true);
    await recordZoneStep(page, visitedZones, badgeHistory);
    await dragLook(page, -70, 0, 8);
    await holdKeys(page, ['Shift', 'KeyW'], 900, 5);
    const endWalk = await recordZoneStep(page, visitedZones, badgeHistory);

    expect(visitedZones.size).toBeGreaterThanOrEqual(2);
    expect(endWalk.frameCount).toBeGreaterThan(startFrame + 20);

    // 4. Reset via R to initial vista.
    await page.keyboard.press('KeyR');
    const resetState = await waitForTransitionEnd(page);
    expect(horizontalDist(resetState.position, initialState.position)).toBeLessThan(1.0);

    assertCleanRuntime(diagnostics);
  });

  test('T4-02: Coastal Shanhaiguan & Second Bathing Beach Promenade Tour', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    const startFrame = initialState.frameCount;

    const presets = await discoverPresets(page);
    const shanhaiIdx = findPresetIndex(presets, /shanhai|butterfly|marshal|山海|蝴蝶|元帥/i, 4);
    const beachIdx = findPresetIndex(presets, /beach|bathing|seawall|promenade|浴場|海濱|黃海/i, 6);

    const visitedZones = new Set<string>();
    const badgeHistory = new Set<string>();

    // Walk Shanhaiguan Rd past landmarks toward the coastal beach.
    await selectPreset(page, shanhaiIdx, 'click', true);
    await recordZoneStep(page, visitedZones, badgeHistory);

    await holdKeys(page, ['Shift', 'KeyW'], 1000, 5);
    await dragLook(page, 60, -8, 8);
    await holdKey(page, 'KeyW', 700, 4);
    await recordZoneStep(page, visitedZones, badgeHistory);

    // Visit Second Bathing Beach promenade & pan across the Yellow Sea.
    await selectPreset(page, beachIdx, 'click', true);
    await recordZoneStep(page, visitedZones, badgeHistory);

    await holdKey(page, 'KeyW', 700, 4);
    await dragLook(page, -120, -6, 10);
    await holdKey(page, 'KeyD', 550, 4);
    const endState = await recordZoneStep(page, visitedZones, badgeHistory);

    expect(visitedZones.size).toBeGreaterThanOrEqual(2);
    expect(endState.frameCount).toBeGreaterThan(startFrame + 20);
    expect(endState.drawCalls).toBeGreaterThan(0);

    assertCleanRuntime(diagnostics);
  });

  test('T4-03: Huashi Cape & Western Cedar Headland Exploration', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    const startFrame = initialState.frameCount;

    const presets = await discoverPresets(page);
    const huashiIdx = findPresetIndex(presets, /huashi|花石|huanghai|黃海|zijing|紫荊/i, 2);

    const visitedZones = new Set<string>();
    const badgeHistory = new Set<string>();

    await selectPreset(page, huashiIdx, 'click', true);
    const capeStart = await recordZoneStep(page, visitedZones, badgeHistory);

    // Explore headland promenade and pan across Huashi Building & Yellow Sea horizon.
    await holdKey(page, 'KeyW', 800, 5);
    await recordZoneStep(page, visitedZones, badgeHistory);

    await dragLook(page, 130, -10, 10);
    await holdKeys(page, ['Shift', 'KeyW'], 900, 5);
    await recordZoneStep(page, visitedZones, badgeHistory);

    await dragLook(page, -180, 5, 12);
    const endState = await waitForFrames(page, 3);

    expect(horizontalDist(capeStart.position, endState.position)).toBeGreaterThan(0.5);
    expect(endState.position.y).toBeGreaterThan(0.5);
    expect(endState.frameCount).toBeGreaterThan(startFrame + 15);

    assertCleanRuntime(diagnostics);
  });

  test('T4-04: Interactive Preset Hopping & Mid-Flight Free-Roam Detour', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    const startFrame = initialState.frameCount;

    // Jump to preset 1, then hop to preset 5 and interrupt mid-flight for a street detour.
    await selectPreset(page, 1, 'key', true);
    await selectPreset(page, 5, 'key', false);
    await page.waitForTimeout(120);

    const detourWalk = await holdKeys(page, ['Shift', 'KeyW'], 800, 5);
    expect(detourWalk.endState.isTransitioning).toBe(false);
    expect(horizontalDist(detourWalk.startState.position, detourWalk.endState.position)).toBeGreaterThan(0.5);

    await dragLook(page, -110, 0, 8);
    await holdKey(page, 'KeyA', 500, 4);

    // Resume preset hopping via pill click to preset 2, then interrupt again with mouse drag.
    await selectPreset(page, 2, 'click', false);
    await page.waitForTimeout(120);
    const dragInterrupt = await dragLook(page, 135, -15, 8);
    expect(dragInterrupt.endState.isTransitioning).toBe(false);

    const endState = await holdKey(page, 'KeyW', 600, 4);
    expect(endState.endState.position.y).toBeGreaterThan(0.5);
    expect(endState.endState.frameCount).toBeGreaterThan(startFrame + 15);

    assertCleanRuntime(diagnostics);
  });

  test('T4-05: Grand Cross-District Multi-Zone Sightseeing Marathon', async ({ page }) => {
    const { diagnostics, initialState } = await openBadaguanScene(page);
    const startFrame = initialState.frameCount;

    const presets = await discoverPresets(page);
    const visitedZones = new Set<string>();
    const badgeHistory = new Set<string>();

    // Start from highest/northernmost vantage or preset 1, then tour multiple distinct regions.
    const sortedByZ = [...presets].sort((a, b) => a.state.position.z - b.state.position.z);
    const northPreset = sortedByZ[0]?.index ?? 1;
    const midPreset = sortedByZ[Math.floor(sortedByZ.length / 2)]?.index ?? 3;
    const southPreset = sortedByZ[sortedByZ.length - 1]?.index ?? 6;

    const tourStops = Array.from(new Set([northPreset, midPreset, southPreset]));
    for (const stop of tourStops) {
      await selectPreset(page, stop, 'click', true);
      await recordZoneStep(page, visitedZones, badgeHistory);

      await holdKeys(page, ['Shift', 'KeyW'], 850, 5);
      await recordZoneStep(page, visitedZones, badgeHistory);

      await dragLook(page, 75, -5, 8);
      await holdKey(page, 'KeyW', 650, 4);
      await recordZoneStep(page, visitedZones, badgeHistory);
    }

    const finalState = await waitForFrames(page, 3);
    expect(visitedZones.size).toBeGreaterThanOrEqual(3);
    expect(badgeHistory.size).toBeGreaterThanOrEqual(3);
    expect(finalState.frameCount).toBeGreaterThan(startFrame + 30);
    expect(finalState.drawCalls).toBeGreaterThan(0);

    assertCleanRuntime(diagnostics);
  });
});
