import { expect, test, type Locator, type Page } from '@playwright/test';

export interface BadaguanPosition {
  x: number;
  y: number;
  z: number;
}

export interface BadaguanZoneInfo {
  id: string;
  nameZh: string;
  nameEn: string;
  landmarkZh?: string;
}

export interface BadaguanPublicState {
  ready: boolean;
  error: string | null;
  position: BadaguanPosition;
  yaw: number;
  pitch: number;
  activePreset: string | null;
  isTransitioning: boolean;
  isPointerLocked: boolean;
  controlsVisible: boolean;
  currentZone: BadaguanZoneInfo;
  frameCount: number;
  drawCalls: number;
}

type WindowWithBadaguan = Window & {
  __BADAGUAN_STATE__?: BadaguanPublicState;
};

export interface SceneDiagnostics {
  pageErrors: string[];
  consoleErrors: string[];
  webglWarnings: string[];
  requestFailures: string[];
  httpErrors: string[];
  crashes: string[];
}

export interface OpenSceneOptions {
  url?: string;
  timeoutMs?: number;
  attachDiagnostics?: boolean;
  minDrawCalls?: number;
}

export interface OpenSceneResult {
  diagnostics: SceneDiagnostics;
  initialState: BadaguanPublicState;
}

export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  bpp: number;
  pixels: Uint8Array;
}

export interface PngEntropyMetrics {
  width: number;
  height: number;
  sampledPixels: number;
  nonBlackRatio: number;
  uniqueColorBuckets: number;
  lumaMean: number;
  lumaStdDev: number;
  lumaMin: number;
  lumaMax: number;
  lumaRange: number;
}

export interface PngVerifyOptions {
  minNonBlackRatio?: number;
  minUniqueColorBuckets?: number;
  minLumaStdDev?: number;
  minLumaMean?: number;
  maxLumaMean?: number;
}

export interface HudBoxMetric {
  testId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudCoverageReport {
  viewportWidth: number;
  viewportHeight: number;
  viewportArea: number;
  totalHudArea: number;
  ratio: number;
  overlapsCenter: boolean;
  allInsideViewport: boolean;
  boxes: HudBoxMetric[];
}

export const SWIFTSHADER_CHROME_ARGS: readonly string[] = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=swiftshader-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const PNG_SIGNATURE: readonly number[] = [137, 80, 78, 71, 13, 10, 26, 10];
const WEBGL_WARNING_PATTERN = /webgl|shader|gl_invalid|context lost/i;
const BENIGN_SWIFTSHADER_WARNING_PATTERN =
  /GL Driver Message\s*\([^)]*Performance[^)]*\):\s*GPU stall due to ReadPixels/i;

export function resolveSceneUrl(explicitUrl?: string): string {
  if (explicitUrl && explicitUrl.length > 0) {
    return explicitUrl;
  }
  try {
    const projectBaseUrl = test.info().project.use.baseURL;
    if (typeof projectBaseUrl === 'string' && projectBaseUrl.length > 0) {
      return '/';
    }
  } catch {
    // Outside active test info context; fall back to default preview URL.
  }
  return 'http://localhost:4173/';
}

function resolveExpectedOrigin(page: Page, explicitUrl?: string): string | null {
  try {
    const projectBaseUrl = test.info().project.use.baseURL;
    if (typeof projectBaseUrl === 'string' && projectBaseUrl.length > 0) {
      return new URL(projectBaseUrl).origin;
    }
  } catch {
    // Ignore when test.info() is unavailable.
  }
  if (explicitUrl && explicitUrl.startsWith('http')) {
    try {
      return new URL(explicitUrl).origin;
    } catch {
      return null;
    }
  }
  const currentUrl = page.url();
  if (currentUrl.startsWith('http')) {
    try {
      return new URL(currentUrl).origin;
    } catch {
      return null;
    }
  }
  return 'http://localhost:4173';
}

function isSameOriginUrl(targetUrl: string, expectedOrigin: string | null): boolean {
  if (!expectedOrigin) {
    return true;
  }
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return true;
  }
  try {
    return new URL(targetUrl).origin === expectedOrigin;
  } catch {
    return true;
  }
}

export function attachSceneDiagnostics(page: Page, explicitUrl?: string): SceneDiagnostics {
  const diagnostics: SceneDiagnostics = {
    pageErrors: [],
    consoleErrors: [],
    webglWarnings: [],
    requestFailures: [],
    httpErrors: [],
    crashes: [],
  };

  page.on('pageerror', (err) => {
    diagnostics.pageErrors.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  });

  page.on('console', (msg) => {
    const msgType = msg.type();
    const text = msg.text();
    if (msgType === 'error') {
      diagnostics.consoleErrors.push(text);
    } else if (
      msgType === 'warning' &&
      WEBGL_WARNING_PATTERN.test(text) &&
      !BENIGN_SWIFTSHADER_WARNING_PATTERN.test(text)
    ) {
      diagnostics.webglWarnings.push(text);
    }
  });

  page.on('requestfailed', (req) => {
    const origin = resolveExpectedOrigin(page, explicitUrl);
    if (isSameOriginUrl(req.url(), origin)) {
      const reason = req.failure()?.errorText ?? 'unknown failure';
      diagnostics.requestFailures.push(`${req.method()} ${req.url()} (${reason})`);
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      const origin = resolveExpectedOrigin(page, explicitUrl);
      if (isSameOriginUrl(res.url(), origin)) {
        diagnostics.httpErrors.push(`${res.status()} ${res.url()}`);
      }
    }
  });

  page.on('crash', () => {
    diagnostics.crashes.push('Page crashed');
  });

  return diagnostics;
}

export function assertCleanRuntime(
  diagnostics: SceneDiagnostics,
  options?: { allowConsoleErrors?: boolean; allowWebglWarnings?: boolean },
): void {
  expect(diagnostics.crashes, `Unexpected page crashes: ${diagnostics.crashes.join('; ')}`).toEqual([]);
  expect(diagnostics.pageErrors, `Unexpected uncaught pageerror: ${diagnostics.pageErrors.join('; ')}`).toEqual([]);
  if (!options?.allowConsoleErrors) {
    expect(diagnostics.consoleErrors, `Unexpected console.error: ${diagnostics.consoleErrors.join('; ')}`).toEqual([]);
  }
  if (!options?.allowWebglWarnings) {
    expect(diagnostics.webglWarnings, `Unexpected WebGL warnings: ${diagnostics.webglWarnings.join('; ')}`).toEqual([]);
  }
  expect(diagnostics.requestFailures, `Failed requests: ${diagnostics.requestFailures.join('; ')}`).toEqual([]);
  expect(diagnostics.httpErrors, `HTTP >=400 errors: ${diagnostics.httpErrors.join('; ')}`).toEqual([]);
}

export async function tryGetBadaguanState(page: Page): Promise<BadaguanPublicState | null> {
  return page.evaluate(() => {
    const raw = (window as unknown as WindowWithBadaguan).__BADAGUAN_STATE__;
    if (!raw) {
      return null;
    }
    return {
      ready: raw.ready,
      error: raw.error,
      position: { ...raw.position },
      yaw: raw.yaw,
      pitch: raw.pitch,
      activePreset: raw.activePreset,
      isTransitioning: raw.isTransitioning,
      isPointerLocked: raw.isPointerLocked,
      controlsVisible: raw.controlsVisible,
      currentZone: { ...raw.currentZone },
      frameCount: raw.frameCount,
      drawCalls: raw.drawCalls,
    };
  });
}

export async function getBadaguanState(page: Page): Promise<BadaguanPublicState> {
  const state = await tryGetBadaguanState(page);
  if (!state) {
    throw new Error('window.__BADAGUAN_STATE__ is not defined');
  }
  return state;
}

export async function waitForFrames(page: Page, minFrames = 3, timeoutMs = 15_000): Promise<BadaguanPublicState> {
  const startState = await tryGetBadaguanState(page);
  const targetFrame = (startState?.frameCount ?? 0) + minFrames;
  await page.waitForFunction(
    (expectedFrame: number) => {
      const s = (window as unknown as WindowWithBadaguan).__BADAGUAN_STATE__;
      return Boolean(s && s.ready && s.frameCount >= expectedFrame);
    },
    targetFrame,
    { timeout: timeoutMs },
  );
  return getBadaguanState(page);
}

export async function openBadaguanScene(page: Page, options?: OpenSceneOptions): Promise<OpenSceneResult> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const minDrawCalls = options?.minDrawCalls ?? 1;
  const diagnostics =
    options?.attachDiagnostics === false
      ? {
          pageErrors: [],
          consoleErrors: [],
          webglWarnings: [],
          requestFailures: [],
          httpErrors: [],
          crashes: [],
        }
      : attachSceneDiagnostics(page, options?.url);

  const targetUrl = resolveSceneUrl(options?.url);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  const canvas = page.getByTestId('scene-canvas');
  await expect(canvas).toBeVisible({ timeout: timeoutMs });

  const viewport = page.viewportSize();
  if (viewport) {
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
      expect(box.height).toBeGreaterThanOrEqual(viewport.height - 2);
    }
  }

  await page.waitForFunction(
    () => {
      const s = (window as unknown as WindowWithBadaguan).__BADAGUAN_STATE__;
      return Boolean(s && s.ready === true);
    },
    undefined,
    { timeout: timeoutMs },
  );

  const stateAfterReady = await getBadaguanState(page);
  expect(stateAfterReady.error).toBeNull();
  expect(stateAfterReady.drawCalls).toBeGreaterThanOrEqual(minDrawCalls);

  await expect(page.getByTestId('webgl-fallback')).toBeHidden({ timeout: 5_000 });
  await expect(page.getByTestId('loading-overlay')).toBeHidden({ timeout: 10_000 });

  const settledState = await waitForFrames(page, 3, timeoutMs);
  expect(settledState.drawCalls).toBeGreaterThanOrEqual(minDrawCalls);

  return {
    diagnostics,
    initialState: settledState,
  };
}

export async function holdKeys(
  page: Page,
  keys: readonly string[],
  minMs = 450,
  minFrames = 4,
): Promise<{ startState: BadaguanPublicState; endState: BadaguanPublicState; elapsedMs: number }> {
  const startState = await getBadaguanState(page);
  const startTime = Date.now();
  const targetFrame = startState.frameCount + minFrames;

  try {
    for (const key of keys) {
      await page.keyboard.down(key);
    }
    await page.waitForTimeout(minMs);
    await page.waitForFunction(
      (expectedFrame: number) => {
        const s = (window as unknown as WindowWithBadaguan).__BADAGUAN_STATE__;
        return Boolean(s && s.frameCount >= expectedFrame);
      },
      targetFrame,
      { timeout: 15_000 },
    );
  } finally {
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      if (key) {
        await page.keyboard.up(key).catch(() => undefined);
      }
    }
  }

  const elapsedMs = Date.now() - startTime;
  const endState = await waitForFrames(page, 2);
  return { startState, endState, elapsedMs };
}

export async function holdKey(
  page: Page,
  key: string,
  minMs = 450,
  minFrames = 4,
): Promise<{ startState: BadaguanPublicState; endState: BadaguanPublicState; elapsedMs: number }> {
  return holdKeys(page, [key], minMs, minFrames);
}

export async function dragLook(
  page: Page,
  dx: number,
  dy: number,
  steps = 10,
): Promise<{ startState: BadaguanPublicState; endState: BadaguanPublicState }> {
  const canvas = page.getByTestId('scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Canvas boundingBox is null during dragLook');
  }

  const startState = await getBadaguanState(page);
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const targetX = Math.max(box.x + 8, Math.min(box.x + box.width - 8, cx + dx));
  const targetY = Math.max(box.y + 8, Math.min(box.y + box.height - 8, cy + dy));

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  try {
    await page.mouse.move(targetX, targetY, { steps });
  } finally {
    await page.mouse.up();
  }

  const endState = await waitForFrames(page, 2);
  return { startState, endState };
}

export async function dragOnElement(
  page: Page,
  locator: Locator,
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Target element boundingBox is null during dragOnElement');
  }
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    await page.mouse.move(startX + dx, startY + dy, { steps });
  } finally {
    await page.mouse.up();
  }
  await waitForFrames(page, 2);
}

export async function waitForTransitionEnd(page: Page, timeoutMs = 6_000): Promise<BadaguanPublicState> {
  await waitForFrames(page, 1, timeoutMs);
  await page.waitForFunction(
    () => {
      const s = (window as unknown as WindowWithBadaguan).__BADAGUAN_STATE__;
      return Boolean(s && s.ready && !s.isTransitioning);
    },
    undefined,
    { timeout: timeoutMs },
  );
  return waitForFrames(page, 2, timeoutMs);
}

export async function selectPreset(
  page: Page,
  index: number,
  method: 'click' | 'key' = 'key',
  waitSettle = true,
): Promise<BadaguanPublicState> {
  if (index < 1 || index > 6) {
    throw new Error(`Preset index must be between 1 and 6, got ${index}`);
  }
  if (method === 'click') {
    await page.getByTestId(`preset-btn-${index}`).click();
  } else {
    await page.keyboard.press(String(index));
  }
  if (waitSettle) {
    return waitForTransitionEnd(page);
  }
  return getBadaguanState(page);
}

export async function toggleControlsPanel(
  page: Page,
  method: 'click' | 'key' = 'key',
): Promise<BadaguanPublicState> {
  if (method === 'click') {
    await page.getByTestId('controls-toggle').click();
  } else {
    await page.keyboard.press('KeyH');
  }
  return waitForFrames(page, 2);
}

export async function setControlsPanelVisible(page: Page, visible: boolean): Promise<BadaguanPublicState> {
  const current = await getBadaguanState(page);
  if (current.controlsVisible !== visible) {
    return toggleControlsPanel(page, 'key');
  }
  return current;
}

export async function simulateWebGLUnavailable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ): RenderingContext | null {
      const lowered = contextId.toLowerCase();
      if (lowered === 'webgl' || lowered === 'webgl2' || lowered === 'experimental-webgl') {
        return null;
      }
      return originalGetContext.call(this, contextId as '2d', options as CanvasRenderingContext2DSettings);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;
  return (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const arrayBufferPromise = new Response(ds.readable).arrayBuffer();
  const writer = ds.writable.getWriter();
  try {
    await writer.write(new Uint8Array(compressed));
    await writer.close();
  } catch (err) {
    await arrayBufferPromise.catch(() => undefined);
    throw err;
  }
  return new Uint8Array(await arrayBufferPromise);
}

export async function decodePng(pngBytes: Uint8Array): Promise<DecodedPng> {
  if (pngBytes.length < 33) {
    throw new Error(`Invalid PNG byte length: ${pngBytes.length}`);
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if ((pngBytes[i] ?? -1) !== (PNG_SIGNATURE[i] ?? -2)) {
      throw new Error('Invalid PNG signature');
    }
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Uint8Array[] = [];
  let totalIdatLen = 0;

  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const length = readUint32BE(pngBytes, offset);
    const type = String.fromCharCode(
      pngBytes[offset + 4] ?? 0,
      pngBytes[offset + 5] ?? 0,
      pngBytes[offset + 6] ?? 0,
      pngBytes[offset + 7] ?? 0,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBytes.length) {
      break;
    }
    const chunkData = pngBytes.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = readUint32BE(chunkData, 0);
      height = readUint32BE(chunkData, 4);
      bitDepth = chunkData[8] ?? 0;
      colorType = chunkData[9] ?? 0;
      interlace = chunkData[12] ?? 0;
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
      totalIdatLen += chunkData.length;
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bitDepth: ${bitDepth}`);
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported PNG colorType: ${colorType} (expected 2 RGB or 6 RGBA)`);
  }
  if (interlace !== 0) {
    throw new Error(`Unsupported interlaced PNG: ${interlace}`);
  }

  const compressed = new Uint8Array(totalIdatLen);
  let writeOffset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  const raw = await inflateZlib(compressed);
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const expectedRawSize = height * (1 + stride);
  if (raw.length < expectedRawSize) {
    throw new Error(`Inflated PNG data too short: got ${raw.length}, expected ${expectedRawSize}`);
  }

  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + stride);
    const filterType = raw[rowStart] ?? 0;
    const outRowStart = y * stride;

    for (let i = 0; i < stride; i += 1) {
      const xVal = raw[rowStart + 1 + i] ?? 0;
      const a = i >= bpp ? (pixels[outRowStart + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (pixels[(y - 1) * stride + i - bpp] ?? 0) : 0;

      let recon = xVal;
      if (filterType === 1) {
        recon = (xVal + a) & 0xff;
      } else if (filterType === 2) {
        recon = (xVal + b) & 0xff;
      } else if (filterType === 3) {
        recon = (xVal + ((a + b) >> 1)) & 0xff;
      } else if (filterType === 4) {
        recon = (xVal + paethPredictor(a, b, c)) & 0xff;
      } else if (filterType !== 0) {
        throw new Error(`Unknown PNG scanline filter type: ${filterType}`);
      }
      pixels[outRowStart + i] = recon;
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    bpp,
    pixels,
  };
}

export function computePngEntropy(png: DecodedPng, step = 8): PngEntropyMetrics {
  const xStart = Math.floor(png.width * 0.15);
  const xEnd = Math.max(xStart + 1, Math.floor(png.width * 0.85));
  const yStart = Math.floor(png.height * 0.15);
  const yEnd = Math.max(yStart + 1, Math.floor(png.height * 0.85));

  let sampledPixels = 0;
  let nonBlackCount = 0;
  let lumaSum = 0;
  let lumaSqSum = 0;
  let lumaMin = 255;
  let lumaMax = 0;
  const buckets = new Set<number>();

  for (let y = yStart; y < yEnd; y += step) {
    for (let x = xStart; x < xEnd; x += step) {
      const idx = (y * png.width + x) * png.bpp;
      const r = png.pixels[idx] ?? 0;
      const g = png.pixels[idx + 1] ?? 0;
      const b = png.pixels[idx + 2] ?? 0;

      sampledPixels += 1;
      if (r + g + b > 15) {
        nonBlackCount += 1;
      }

      const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      buckets.add(bucket);

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaSum += luma;
      lumaSqSum += luma * luma;
      if (luma < lumaMin) lumaMin = luma;
      if (luma > lumaMax) lumaMax = luma;
    }
  }

  const denom = Math.max(1, sampledPixels);
  const lumaMean = lumaSum / denom;
  const variance = Math.max(0, lumaSqSum / denom - lumaMean * lumaMean);
  const lumaStdDev = Math.sqrt(variance);

  return {
    width: png.width,
    height: png.height,
    sampledPixels,
    nonBlackRatio: nonBlackCount / denom,
    uniqueColorBuckets: buckets.size,
    lumaMean,
    lumaStdDev,
    lumaMin,
    lumaMax,
    lumaRange: lumaMax - lumaMin,
  };
}

export async function captureAndVerifyPng(
  page: Page,
  outputPath: string,
  options?: PngVerifyOptions,
): Promise<{ png: DecodedPng; metrics: PngEntropyMetrics }> {
  const rawScreenshot = await page.screenshot({ path: outputPath });
  const pngBytes = Uint8Array.from(rawScreenshot);
  const png = await decodePng(pngBytes);
  const metrics = computePngEntropy(png);

  const minNonBlackRatio = options?.minNonBlackRatio ?? 0.80;
  const minUniqueColorBuckets = options?.minUniqueColorBuckets ?? 12;
  const minLumaStdDev = options?.minLumaStdDev ?? 8;
  const minLumaMean = options?.minLumaMean ?? 15;
  const maxLumaMean = options?.maxLumaMean ?? 245;

  expect(metrics.sampledPixels).toBeGreaterThan(0);
  expect(
    metrics.nonBlackRatio,
    `Screenshot ${outputPath} has too many black pixels: ${metrics.nonBlackRatio.toFixed(3)}`,
  ).toBeGreaterThanOrEqual(minNonBlackRatio);
  expect(
    metrics.uniqueColorBuckets,
    `Screenshot ${outputPath} lacks color diversity: ${metrics.uniqueColorBuckets} buckets`,
  ).toBeGreaterThanOrEqual(minUniqueColorBuckets);
  expect(
    metrics.lumaStdDev,
    `Screenshot ${outputPath} looks flat/blank: stddev=${metrics.lumaStdDev.toFixed(2)}`,
  ).toBeGreaterThanOrEqual(minLumaStdDev);
  expect(
    metrics.lumaMean,
    `Screenshot ${outputPath} is too dark: mean=${metrics.lumaMean.toFixed(2)}`,
  ).toBeGreaterThan(minLumaMean);
  expect(
    metrics.lumaMean,
    `Screenshot ${outputPath} is washed out/white: mean=${metrics.lumaMean.toFixed(2)}`,
  ).toBeLessThan(maxLumaMean);

  return { png, metrics };
}

export function comparePngDiff(pngA: DecodedPng, pngB: DecodedPng, step = 8, threshold = 24): number {
  const width = Math.min(pngA.width, pngB.width);
  const height = Math.min(pngA.height, pngB.height);
  const xStart = Math.floor(width * 0.15);
  const xEnd = Math.max(xStart + 1, Math.floor(width * 0.85));
  const yStart = Math.floor(height * 0.15);
  const yEnd = Math.max(yStart + 1, Math.floor(height * 0.85));

  let sampled = 0;
  let diffCount = 0;

  for (let y = yStart; y < yEnd; y += step) {
    for (let x = xStart; x < xEnd; x += step) {
      const idxA = (y * pngA.width + x) * pngA.bpp;
      const idxB = (y * pngB.width + x) * pngB.bpp;
      const dR = Math.abs((pngA.pixels[idxA] ?? 0) - (pngB.pixels[idxB] ?? 0));
      const dG = Math.abs((pngA.pixels[idxA + 1] ?? 0) - (pngB.pixels[idxB + 1] ?? 0));
      const dB = Math.abs((pngA.pixels[idxA + 2] ?? 0) - (pngB.pixels[idxB + 2] ?? 0));
      sampled += 1;
      if (dR + dG + dB > threshold) {
        diffCount += 1;
      }
    }
  }

  return diffCount / Math.max(1, sampled);
}

function computeUnionArea(rects: readonly { x1: number; y1: number; x2: number; y2: number }[]): number {
  if (rects.length === 0) {
    return 0;
  }
  const xsSet = new Set<number>();
  const ysSet = new Set<number>();
  for (const r of rects) {
    xsSet.add(r.x1);
    xsSet.add(r.x2);
    ysSet.add(r.y1);
    ysSet.add(r.y2);
  }
  const xs = Array.from(xsSet).sort((a, b) => a - b);
  const ys = Array.from(ysSet).sort((a, b) => a - b);
  let area = 0;

  for (let xi = 0; xi + 1 < xs.length; xi += 1) {
    const xLeft = xs[xi] ?? 0;
    const xRight = xs[xi + 1] ?? 0;
    const dx = xRight - xLeft;
    if (dx <= 0) continue;

    for (let yi = 0; yi + 1 < ys.length; yi += 1) {
      const yTop = ys[yi] ?? 0;
      const yBottom = ys[yi + 1] ?? 0;
      const dy = yBottom - yTop;
      if (dy <= 0) continue;

      const midX = (xLeft + xRight) * 0.5;
      const midY = (yTop + yBottom) * 0.5;
      const covered = rects.some((r) => midX >= r.x1 && midX <= r.x2 && midY >= r.y1 && midY <= r.y2);
      if (covered) {
        area += dx * dy;
      }
    }
  }

  return area;
}

export async function getHudCoverageRatio(page: Page): Promise<HudCoverageReport> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const hudTestIds = ['location-badge', 'preset-bar', 'controls-toggle'];
  const boxes: HudBoxMetric[] = [];
  const clampedRects: { x1: number; y1: number; x2: number; y2: number }[] = [];

  const centerX1 = viewport.width * 0.35;
  const centerX2 = viewport.width * 0.65;
  const centerY1 = viewport.height * 0.35;
  const centerY2 = viewport.height * 0.65;

  let overlapsCenter = false;
  let allInsideViewport = true;

  for (const testId of hudTestIds) {
    const loc = page.getByTestId(testId);
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;

    const box = await loc.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) continue;

    boxes.push({
      testId,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });

    if (
      box.x < -1 ||
      box.y < -1 ||
      box.x + box.width > viewport.width + 1 ||
      box.y + box.height > viewport.height + 1
    ) {
      allInsideViewport = false;
    }

    const x1 = Math.max(0, box.x);
    const y1 = Math.max(0, box.y);
    const x2 = Math.min(viewport.width, box.x + box.width);
    const y2 = Math.min(viewport.height, box.y + box.height);

    if (x2 > x1 && y2 > y1) {
      clampedRects.push({ x1, y1, x2, y2 });
      const hitsCenter = x1 < centerX2 && x2 > centerX1 && y1 < centerY2 && y2 > centerY1;
      if (hitsCenter) {
        overlapsCenter = true;
      }
    }
  }

  const viewportArea = viewport.width * viewport.height;
  const totalHudArea = computeUnionArea(clampedRects);

  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewportArea,
    totalHudArea,
    ratio: totalHudArea / Math.max(1, viewportArea),
    overlapsCenter,
    allInsideViewport,
    boxes,
  };
}

export function horizontalDist(a: BadaguanPosition, b: BadaguanPosition): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function wrappedAngleDelta(before: number, after: number, scaleSample?: number): number {
  const sampleMax = Math.max(Math.abs(before), Math.abs(after), Math.abs(scaleSample ?? 0));
  const period = sampleMax > 6.5 ? 360 : Math.PI * 2;
  const half = period * 0.5;
  let diff = (after - before) % period;
  if (diff > half) {
    diff -= period;
  } else if (diff <= -half) {
    diff += period;
  }
  return diff;
}
