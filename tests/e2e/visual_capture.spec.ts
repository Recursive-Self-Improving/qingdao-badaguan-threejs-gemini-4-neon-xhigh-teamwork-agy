import { expect, test, type Page } from '@playwright/test';
import {
  assertCleanRuntime,
  captureAndVerifyPng,
  comparePngDiff,
  dragLook,
  getBadaguanState,
  getHudCoverageRatio,
  holdKey,
  holdKeys,
  openBadaguanScene,
  selectPreset,
  setControlsPanelVisible,
  waitForFrames,
  waitForTransitionEnd,
  wrappedAngleDelta,
  type BadaguanPublicState,
  type DecodedPng,
} from './helpers/browserHarness';

interface DiscoveredPreset {
  index: number;
  label: string;
  state: BadaguanPublicState;
}

const VISUAL_DIR = 'test-results/visual-review';

function findPresetForPattern(
  presets: readonly DiscoveredPreset[],
  pattern: RegExp,
  fallbackIndex: number,
): number {
  const found = presets.find((p) => {
    const text = `${p.label} ${p.state.currentZone.id} ${p.state.currentZone.nameZh} ${p.state.currentZone.nameEn} ${p.state.currentZone.landmarkZh ?? ''}`;
    return pattern.test(text);
  });
  return found?.index ?? fallbackIndex;
}

async function ensureGroundedView(page: Page): Promise<void> {
  const s = await waitForFrames(page, 2);
  if (s.position.y > 12) {
    await holdKey(page, 'KeyW', 600, 4);
  }
}

async function steerYawTowards(page: Page, targetYaw: number): Promise<BadaguanPublicState> {
  let state = await getBadaguanState(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const err = wrappedAngleDelta(state.yaw, targetYaw);
    if (Math.abs(err) < 0.06) {
      break;
    }
    const dx = Math.max(-420, Math.min(420, -err / 0.0028));
    const res = await dragLook(page, dx, 0, 8);
    state = res.endState;
  }
  return state;
}

test.describe('Visual Capture Pack (AC4 Independent Review)', () => {
  test('VC-01: Capture presets 1-6, street corridors, landmarks, coastal promenade, and HUD states', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    const { diagnostics } = await openBadaguanScene(page);
    await setControlsPanelVisible(page, false);

    // 1. Capture all 6 curated presets (1..6) without assuming landmark-to-index ordering.
    const discovered: DiscoveredPreset[] = [];
    const presetPngs: DecodedPng[] = [];

    for (let i = 1; i <= 6; i += 1) {
      const label = (await page.getByTestId(`preset-btn-${i}`).innerText()).trim();
      const settled = await selectPreset(page, i, 'click', true);
      expect(settled.isTransitioning).toBe(false);
      await expect(page.getByTestId('loading-overlay')).toBeHidden();

      discovered.push({ index: i, label, state: settled });
      test.info().annotations.push({
        type: `preset-${i}`,
        description: `${label} | ${settled.currentZone.nameZh} (${settled.currentZone.nameEn})`,
      });

      const { png } = await captureAndVerifyPng(page, `${VISUAL_DIR}/preset-${i}.png`);
      presetPngs.push(png);
    }

    // Assert every pair of presets renders a visibly distinct 3D scene.
    for (let i = 0; i < presetPngs.length; i += 1) {
      for (let j = i + 1; j < presetPngs.length; j += 1) {
        const a = presetPngs[i];
        const b = presetPngs[j];
        if (a && b) {
          const diff = comparePngDiff(a, b);
          expect(diff, `preset-${i + 1}.png and preset-${j + 1}.png lack visual distinction`).toBeGreaterThanOrEqual(0.05);
        }
      }
    }

    // 2. Street-level central Ningwuguan Rd walk (reset to initial vista & walk forward).
    await page.keyboard.press('KeyR');
    await waitForTransitionEnd(page);
    await ensureGroundedView(page);
    await holdKey(page, 'KeyW', 650, 4);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/street-ningwuguan.png`);

    // 3. Intersection & bilingual vintage signpost view.
    await holdKeys(page, ['Shift', 'KeyW'], 700, 4);
    await dragLook(page, 45, 5, 8);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/intersection-signposts.png`);

    // 4. Juyongguan Rd Ginkgo corridor & Princess House landmark.
    const princessIdx = findPresetForPattern(discovered, /princess|juyong|公主|居庸/i, 3);
    await selectPreset(page, princessIdx, 'click', true);
    await ensureGroundedView(page);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/landmark-princess.png`);

    await holdKey(page, 'KeyW', 650, 4);
    await dragLook(page, -35, 8, 8);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/street-juyongguan-ginkgo.png`);

    // 5. Jiayuguan Rd Maple corridor.
    const mapleIdx = findPresetForPattern(discovered, /jiayuguan|maple|嘉峪|楓/i, 5);
    await selectPreset(page, mapleIdx, 'click', true);
    await ensureGroundedView(page);
    await holdKey(page, 'KeyW', 600, 4);
    await dragLook(page, 30, 5, 8);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/street-jiayuguan-maple.png`);

    // 6. Huashi Building landmark view.
    const huashiIdx = findPresetForPattern(discovered, /huashi|花石|huanghai|黃海/i, 2);
    await selectPreset(page, huashiIdx, 'click', true);
    await ensureGroundedView(page);
    await dragLook(page, -25, -8, 8);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/landmark-huashi.png`);

    // 7. Butterfly House & Marshal's House along Shanhaiguan Rd.
    const butterflyIdx = findPresetForPattern(discovered, /butterfly|蝴蝶|shanhai|山海/i, 4);
    await selectPreset(page, butterflyIdx, 'click', true);
    await ensureGroundedView(page);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/landmark-butterfly.png`);

    const marshalIdx = findPresetForPattern(discovered, /marshal|元帥/i, butterflyIdx);
    await selectPreset(page, marshalIdx, 'click', true);
    await ensureGroundedView(page);
    if (marshalIdx === butterflyIdx) {
      // Turn West along Shanhaiguan Rd to x ~ 42 (gap between sycamores facing Marshal's House)
      let st = await getBadaguanState(page);
      const roadYaw = Math.atan2(-(42 - st.position.x), -(118 - st.position.z));
      st = await steerYawTowards(page, roadYaw);
      for (let step = 0; step < 6 && st.position.x > 44; step += 1) {
        const move = await holdKeys(page, ['Shift', 'KeyW'], 450, 4);
        st = move.endState;
      }
      // Face Marshal's House at (36, 95) from ~20m away and step just inside marshal zone (radius 21m)
      const faceYaw = Math.atan2(-(36 - st.position.x), -(95 - st.position.z));
      st = await steerYawTowards(page, faceYaw);
      for (let step = 0; step < 6 && st.currentZone.id !== 'marshal'; step += 1) {
        const approach = await holdKey(page, 'KeyW', 350, 4);
        st = approach.endState;
      }
      await dragLook(page, 0, -20, 6);
    }
    const marshalState = await getBadaguanState(page);
    expect(marshalState.currentZone.id).toBe('marshal');
    await captureAndVerifyPng(page, `${VISUAL_DIR}/landmark-marshal.png`);

    // 8. Second Bathing Beach & seawall promenade view.
    const beachCandidates = discovered.filter(
      (p) => p.state.currentZone.id !== 'taiping_bay' && p.state.currentZone.id !== 'badaguan_panorama',
    );
    const beachIdx = findPresetForPattern(beachCandidates, /second_beach|第二海水浴場|bathing/i, 6);
    const settledBeach = await selectPreset(page, beachIdx, 'click', true);
    expect(settledBeach.currentZone.id).toBe('second_beach');
    await ensureGroundedView(page);
    await holdKey(page, 'KeyW', 500, 4);
    await dragLook(page, 25, 6, 8);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/beach-promenade.png`);

    // 9. HUD collapsed (1280x720), HUD expanded (1280x720), and responsive 1024x768 check.
    await selectPreset(page, 1, 'click', true);
    await setControlsPanelVisible(page, false);
    const hud1280 = await getHudCoverageRatio(page);
    expect(hud1280.ratio).toBeLessThanOrEqual(0.15);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/hud-collapsed.png`);

    await setControlsPanelVisible(page, true);
    await expect(page.getByTestId('controls-panel')).toBeVisible();
    await captureAndVerifyPng(page, `${VISUAL_DIR}/hud-expanded.png`);

    await setControlsPanelVisible(page, false);
    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForFrames(page, 3);
    const hud1024 = await getHudCoverageRatio(page);
    expect(hud1024.allInsideViewport).toBe(true);
    expect(hud1024.ratio).toBeLessThanOrEqual(0.15);
    await captureAndVerifyPng(page, `${VISUAL_DIR}/hud-1024x768.png`);

    assertCleanRuntime(diagnostics);
  });
});
