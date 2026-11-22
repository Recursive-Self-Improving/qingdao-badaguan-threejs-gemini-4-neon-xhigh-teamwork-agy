import * as THREE from 'three';

export type RoadSignVariant = 'blue' | 'green';

export interface ProceduralMaterialSet {
  // Architecture & Masonry (M1, M2)
  graniteAshlar: THREE.MeshStandardMaterial;
  mushroomStone: THREE.MeshStandardMaterial;
  terracottaRoof: THREE.MeshStandardMaterial;
  stuccoBase: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  darkTimber: THREE.MeshStandardMaterial;
  whiteTrim: THREE.MeshStandardMaterial;
  darkIron: THREE.MeshStandardMaterial;
  windowGlass: THREE.MeshStandardMaterial;
  stainedGlass: THREE.MeshStandardMaterial;

  // Terrain, Roads & Flora (M1, M3)
  asphalt: THREE.MeshStandardMaterial;
  cobblestone: THREE.MeshStandardMaterial;
  curbStone: THREE.MeshStandardMaterial;
  crosswalkPaint: THREE.MeshStandardMaterial;
  beachSand: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;

  // Helpers (share cached base maps; tracked for dispose())
  createTintedStuccoMaterial(hex: string | number): THREE.MeshStandardMaterial;
  createRoadSignMaterial(
    nameZh: string,
    nameEn: string,
    variant?: RoadSignVariant,
  ): THREE.MeshStandardMaterial;

  // Cleanup
  dispose(): void;
}

function periodicHash(ix: number, iy: number, period: number, seed: number): number {
  const px = ((ix % period) + period) % period;
  const py = ((iy % period) + period) % period;
  let n = (px * 374761393 + py * 668265263 + seed * 1442695041) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function periodicValueNoise(
  u: number,
  v: number,
  period: number,
  seed: number,
): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = periodicHash(ix, iy, period, seed);
  const n10 = periodicHash(ix + 1, iy, period, seed);
  const n01 = periodicHash(ix, iy + 1, period, seed);
  const n11 = periodicHash(ix + 1, iy + 1, period, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function periodicFbm(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValueNoise(u, v, period, seed + o * 97);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return v | 0;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

type PixelDrawer = (
  size: number,
  albedo: Uint8ClampedArray,
  bump: Uint8ClampedArray,
  rough: Uint8ClampedArray,
) => void;

function setPixel(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  data[idx] = clampByte(r);
  data[idx + 1] = clampByte(g);
  data[idx + 2] = clampByte(b);
  data[idx + 3] = clampByte(a);
}

function setGray(data: Uint8ClampedArray, idx: number, v: number): void {
  const b = clampByte(v);
  data[idx] = b;
  data[idx + 1] = b;
  data[idx + 2] = b;
  data[idx + 3] = 255;
}

export function createRoadSignTexture(
  nameZh: string,
  nameEn: string,
  variant: RoadSignVariant = 'blue',
): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const bg = variant === 'green' ? '#1E5B45' : '#15477A';
    const border = variant === 'green' ? '#EFE6D0' : '#F7F4EC';
    const textMain = variant === 'green' ? '#F5EEDB' : '#FAF8F2';
    const textSub = variant === 'green' ? '#E5DAC0' : '#E8E4DA';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle enamel sheen gradient
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(255,255,255,0.08)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Enamel rounded border
    const inset = 12;
    const radius = 14;
    ctx.strokeStyle = border;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(inset + radius, inset);
    ctx.lineTo(width - inset - radius, inset);
    ctx.quadraticCurveTo(width - inset, inset, width - inset, inset + radius);
    ctx.lineTo(width - inset, height - inset - radius);
    ctx.quadraticCurveTo(
      width - inset,
      height - inset,
      width - inset - radius,
      height - inset,
    );
    ctx.lineTo(inset + radius, height - inset);
    ctx.quadraticCurveTo(inset, height - inset, inset, height - inset - radius);
    ctx.lineTo(inset, inset + radius);
    ctx.quadraticCurveTo(inset, inset, inset + radius, inset);
    ctx.closePath();
    ctx.stroke();

    // 4 corner rivet dots
    ctx.fillStyle = border;
    const rivetOffset = 28;
    for (const [rx, ry] of [
      [rivetOffset, rivetOffset],
      [width - rivetOffset, rivetOffset],
      [rivetOffset, height - rivetOffset],
      [width - rivetOffset, height - rivetOffset],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Chinese road title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textMain;
    let zhSize = 54;
    const zhFontStack =
      "'WenQuanYi Zen Hei', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.font = `700 ${zhSize}px ${zhFontStack}`;
    while (ctx.measureText(nameZh).width > 430 && zhSize > 26) {
      zhSize -= 2;
      ctx.font = `700 ${zhSize}px ${zhFontStack}`;
    }
    ctx.fillText(nameZh, width / 2, 102);

    // Horizontal rule divider
    ctx.strokeStyle = variant === 'green' ? 'rgba(239,230,208,0.5)' : 'rgba(247,244,236,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 120, 148);
    ctx.lineTo(width / 2 + 120, 148);
    ctx.stroke();

    // English road subtitle
    const enUpper = nameEn.toUpperCase();
    let enSize = 24;
    const enFontStack = "'Inter', 'Segoe UI', Arial, sans-serif";
    ctx.fillStyle = textSub;
    ctx.font = `600 ${enSize}px ${enFontStack}`;
    while (ctx.measureText(enUpper).width > 440 && enSize > 14) {
      enSize -= 1;
      ctx.font = `600 ${enSize}px ${enFontStack}`;
    }
    ctx.fillText(enUpper, width / 2, 192);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function createProceduralMaterials(maxAnisotropy = 4): ProceduralMaterialSet {
  const anisotropy = Math.min(Math.max(1, maxAnisotropy), 4);
  const ownedTextures = new Set<THREE.Texture>();
  const ownedMaterials = new Set<THREE.Material>();
  const roadSignCache = new Map<string, THREE.MeshStandardMaterial>();

  function trackTexture<T extends THREE.Texture>(tex: T): T {
    ownedTextures.add(tex);
    return tex;
  }

  function trackMaterial<T extends THREE.Material>(mat: T): T {
    ownedMaterials.add(mat);
    return mat;
  }

  function buildPbrTriple(
    size: number,
    drawFn: PixelDrawer,
    repeatX: number,
    repeatY: number,
    options: {
      bumpScale: number;
      roughness?: number;
      metalness?: number;
    },
  ): {
    material: THREE.MeshStandardMaterial;
    albedoTex: THREE.CanvasTexture;
    bumpTex: THREE.CanvasTexture;
    roughTex: THREE.CanvasTexture;
  } {
    const albedoCanvas = makeCanvas(size, size);
    const bumpCanvas = makeCanvas(size, size);
    const roughCanvas = makeCanvas(size, size);

    const aCtx = albedoCanvas.getContext('2d');
    const bCtx = bumpCanvas.getContext('2d');
    const rCtx = roughCanvas.getContext('2d');

    if (aCtx && bCtx && rCtx) {
      const aImg = aCtx.createImageData(size, size);
      const bImg = bCtx.createImageData(size, size);
      const rImg = rCtx.createImageData(size, size);
      drawFn(size, aImg.data, bImg.data, rImg.data);
      aCtx.putImageData(aImg, 0, 0);
      bCtx.putImageData(bImg, 0, 0);
      rCtx.putImageData(rImg, 0, 0);
    }

    const albedoTex = trackTexture(new THREE.CanvasTexture(albedoCanvas));
    albedoTex.colorSpace = THREE.SRGBColorSpace;
    albedoTex.wrapS = THREE.RepeatWrapping;
    albedoTex.wrapT = THREE.RepeatWrapping;
    albedoTex.repeat.set(repeatX, repeatY);
    albedoTex.anisotropy = anisotropy;

    const bumpTex = trackTexture(new THREE.CanvasTexture(bumpCanvas));
    bumpTex.colorSpace = THREE.NoColorSpace;
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.repeat.set(repeatX, repeatY);
    bumpTex.anisotropy = anisotropy;

    const roughTex = trackTexture(new THREE.CanvasTexture(roughCanvas));
    roughTex.colorSpace = THREE.NoColorSpace;
    roughTex.wrapS = THREE.RepeatWrapping;
    roughTex.wrapT = THREE.RepeatWrapping;
    roughTex.repeat.set(repeatX, repeatY);
    roughTex.anisotropy = anisotropy;

    const material = trackMaterial(
      new THREE.MeshStandardMaterial({
        map: albedoTex,
        bumpMap: bumpTex,
        bumpScale: options.bumpScale,
        roughnessMap: roughTex,
        roughness: options.roughness ?? 1.0,
        metalness: options.metalness ?? 0.0,
      }),
    );

    return { material, albedoTex, bumpTex, roughTex };
  }

  // 1. Granite Ashlar (512x512, 4 cols x 6 rows running bond)
  const granite = buildPbrTriple(
    512,
    (size, albedo, bump, rough) => {
      const cols = 4;
      const rows = 6;
      const palette = [hexToRgb(0xb8b2a6), hexToRgb(0xc4b9a8), hexToRgb(0xada79b)];
      for (let y = 0; y < size; y++) {
        const v = y / size;
        const rowF = v * rows;
        const row = Math.floor(rowF);
        const fy = rowF - row;
        const shift = (row % 2) * 0.5;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const colF = u * cols + shift;
          const col = Math.floor(colF);
          const fx = colF - col;

          const idx = (y * size + x) * 4;
          const mortarU = fx < 0.025 || fx > 0.975;
          const mortarV = fy < 0.035 || fy > 0.965;
          const grain = periodicFbm(u, v, 16, 3, 11);
          const crystal = periodicHash(x, y, size, 17);

          if (mortarU || mortarV) {
            const m = 128 + grain * 18;
            setPixel(albedo, idx, m, m - 5, m - 14);
            setGray(bump, idx, 68 + grain * 18);
            setGray(rough, idx, 240);
          } else {
            const blockSeed = periodicHash(col % cols, row % rows, 8, 29);
            const base = palette[Math.floor(blockSeed * palette.length) % palette.length];
            const bevel = Math.min(fx, 1 - fx) * 12;
            const bevelV = Math.min(fy, 1 - fy) * 10;
            const edgeFactor = Math.min(1, bevel, bevelV);
            const speckle = (crystal - 0.5) * 26 + (grain - 0.5) * 20;
            const shade = 0.92 + edgeFactor * 0.08;
            setPixel(
              albedo,
              idx,
              base[0] * shade + speckle,
              base[1] * shade + speckle,
              base[2] * shade + speckle,
            );
            setGray(bump, idx, 185 + edgeFactor * 45 + (grain - 0.5) * 28);
            setGray(rough, idx, 199 + grain * 26); // 0.78 - 0.88
          }
        }
      }
    },
    1,
    1,
    { bumpScale: 0.035 },
  );

  // 2. Mushroom Stone (512x512, Qingdao convex rusticated granite)
  const mushroom = buildPbrTriple(
    512,
    (size, albedo, bump, rough) => {
      const cols = 4;
      const rows = 4;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        const rowF = v * rows;
        const row = Math.floor(rowF);
        const fy = rowF - row;
        const shift = (row % 2) * 0.5;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const colF = u * cols + shift;
          const col = Math.floor(colF);
          const fx = colF - col;
          const idx = (y * size + x) * 4;

          const joint = fx < 0.03 || fx > 0.97 || fy < 0.03 || fy > 0.97;
          const margin = fx < 0.1 || fx > 0.9 || fy < 0.1 || fy > 0.9;
          const chip = periodicFbm(u, v, 16, 3, 41);
          const tone = periodicHash(col % cols, row % rows, 8, 53);

          if (joint) {
            setPixel(albedo, idx, 93, 87, 77);
            setGray(bump, idx, 35);
            setGray(rough, idx, 242);
          } else if (margin) {
            const c = 148 + (chip - 0.5) * 22 + tone * 14;
            setPixel(albedo, idx, c + 6, c, c - 10);
            setGray(bump, idx, 88 + chip * 18);
            setGray(rough, idx, 238);
          } else {
            const bx = (fx - 0.1) / 0.8;
            const by = (fy - 0.1) / 0.8;
            const dome = Math.sin(Math.PI * bx) * Math.sin(Math.PI * by);
            const rBase = 160 + tone * 26;
            const gBase = 150 + tone * 24;
            const bBase = 132 + tone * 22;
            const light = 0.82 + dome * 0.25 + (chip - 0.5) * 0.12;
            setPixel(albedo, idx, rBase * light, gBase * light, bBase * light);
            setGray(bump, idx, 105 + dome * 135 + (chip - 0.5) * 24);
            setGray(rough, idx, 204 + (1 - dome) * 22);
          }
        }
      }
    },
    1,
    1,
    { bumpScale: 0.065 },
  );

  // 3. Terracotta Roof (512x512, 8 vertical barrel columns x 6 overlapping courses)
  const terracotta = buildPbrTriple(
    512,
    (size, albedo, bump, rough) => {
      const cols = 8;
      const rows = 6;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        const rowF = v * rows;
        const row = Math.floor(rowF);
        const fy = rowF - row;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const colF = u * cols;
          const col = Math.floor(colF);
          const fx = colF - col;
          const idx = (y * size + x) * 4;

          const kilnVar = (periodicHash(col % cols, row % rows, 16, 71) - 0.5) * 26;
          const weather = (periodicFbm(u, v, 12, 3, 73) - 0.5) * 18;
          const barrel = Math.sin(Math.PI * fx);
          const overlapShadow = fy < 0.08 ? 0.68 + (fy / 0.08) * 0.32 : 1.0;

          const r = (176 + barrel * 24 + kilnVar + weather) * overlapShadow;
          const g = (70 + barrel * 14 + kilnVar * 0.45 + weather * 0.5) * overlapShadow;
          const b = (49 + barrel * 8 + kilnVar * 0.3 + weather * 0.4) * overlapShadow;

          setPixel(albedo, idx, r, g, b);
          const courseStep = (1 - fy) * 35;
          setGray(bump, idx, 120 + barrel * 115 + courseStep + (fy < 0.06 ? -55 : 0));
          setGray(rough, idx, fy < 0.08 ? 225 : 162 + (1 - barrel) * 36);
        }
      }
    },
    1,
    1,
    { bumpScale: 0.055 },
  );

  // 4. Stucco Base (256x256, warm off-white lime plaster stipple)
  const stucco = buildPbrTriple(
    256,
    (size, albedo, bump, rough) => {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const idx = (y * size + x) * 4;
          const f = periodicFbm(u, v, 16, 4, 89);
          const fine = periodicHash(x, y, size, 97);
          const lum = 236 + (f - 0.5) * 20 + (fine - 0.5) * 8;
          setPixel(albedo, idx, lum + 3, lum, lum - 5);
          setGray(bump, idx, 128 + (f - 0.5) * 70 + (fine - 0.5) * 28);
          setGray(rough, idx, 220 + f * 22); // 0.86 - 0.95
        }
      }
    },
    1,
    1,
    { bumpScale: 0.018 },
  );

  // 5. Historic Brick (512x512, 4 cols x 12 rows running bond)
  const brick = buildPbrTriple(
    512,
    (size, albedo, bump, rough) => {
      const cols = 4;
      const rows = 12;
      const palette = [hexToRgb(0x9c4a3a), hexToRgb(0x873e31), hexToRgb(0xad5945)];
      for (let y = 0; y < size; y++) {
        const v = y / size;
        const rowF = v * rows;
        const row = Math.floor(rowF);
        const fy = rowF - row;
        const shift = (row % 2) * 0.5;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const colF = u * cols + shift;
          const col = Math.floor(colF);
          const fx = colF - col;
          const idx = (y * size + x) * 4;

          const mortar = fx < 0.035 || fx > 0.965 || fy < 0.1 || fy > 0.9;
          const noise = periodicFbm(u, v, 16, 3, 113);
          if (mortar) {
            const m = 202 + (noise - 0.5) * 18;
            setPixel(albedo, idx, m, m - 7, m - 18);
            setGray(bump, idx, 58 + noise * 18);
            setGray(rough, idx, 242);
          } else {
            const bSeed = periodicHash(col % cols, row % rows, 16, 127);
            const c = palette[Math.floor(bSeed * palette.length) % palette.length];
            const delta = (noise - 0.5) * 26;
            setPixel(albedo, idx, c[0] + delta, c[1] + delta * 0.7, c[2] + delta * 0.6);
            setGray(bump, idx, 192 + (noise - 0.5) * 38);
            setGray(rough, idx, 210 + noise * 20);
          }
        }
      }
    },
    1,
    1,
    { bumpScale: 0.03 },
  );

  // 6. Asphalt (512x512, weathered warm charcoal with quartz aggregate)
  const asphalt = buildPbrTriple(
    512,
    (size, albedo, bump, rough) => {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const idx = (y * size + x) * 4;
          const wear = periodicFbm(u, v, 8, 3, 149);
          const grit = periodicHash(x, y, size, 151);
          const isQuartz = grit > 0.94;
          const base = 69 + (wear - 0.5) * 14 + (grit - 0.5) * 12;
          const speck = isQuartz ? 26 : 0;
          setPixel(albedo, idx, base + speck, base + 3 + speck, base + 7 + speck);
          setGray(bump, idx, 115 + grit * 90 + (wear - 0.5) * 24);
          setGray(rough, idx, 195 + wear * 34); // 0.76 - 0.90
        }
      }
    },
    1,
    1,
    { bumpScale: 0.014 },
  );

  // 7. Cobblestone (512x512, 6x8 staggered granite setts)
  const cobblestone = buildPbrTriple(
    512,
    (size, albedo, bump, rough) => {
      const cols = 6;
      const rows = 8;
      const palette = [hexToRgb(0x9a958c), hexToRgb(0xa89f92), hexToRgb(0x89857e)];
      for (let y = 0; y < size; y++) {
        const v = y / size;
        const rowF = v * rows;
        const row = Math.floor(rowF);
        const fy = rowF - row;
        const shift = (row % 2) * 0.5;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const colF = u * cols + shift;
          const col = Math.floor(colF);
          const fx = colF - col;
          const idx = (y * size + x) * 4;

          const joint = fx < 0.06 || fx > 0.94 || fy < 0.07 || fy > 0.93;
          const grain = periodicFbm(u, v, 16, 3, 173);
          if (joint) {
            setPixel(albedo, idx, 110 + grain * 14, 104 + grain * 12, 93 + grain * 10);
            setGray(bump, idx, 58 + grain * 16);
            setGray(rough, idx, 242);
          } else {
            const pSeed = periodicHash(col % cols, row % rows, 16, 179);
            const c = palette[Math.floor(pSeed * palette.length) % palette.length];
            const bx = (fx - 0.06) / 0.88;
            const by = (fy - 0.07) / 0.86;
            const crown = Math.pow(Math.sin(Math.PI * bx) * Math.sin(Math.PI * by), 0.35);
            const shade = 0.84 + crown * 0.2 + (grain - 0.5) * 0.1;
            setPixel(albedo, idx, c[0] * shade, c[1] * shade, c[2] * shade);
            setGray(bump, idx, 120 + crown * 105 + (grain - 0.5) * 18);
            setGray(rough, idx, 204 + (1 - crown) * 20);
          }
        }
      }
    },
    1,
    1,
    { bumpScale: 0.04 },
  );

  // 8. Curb Stone (256x256, dressed pale-buff granite with block joints every 128px)
  const curb = buildPbrTriple(
    256,
    (size, albedo, bump, rough) => {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const idx = (y * size + x) * 4;
          const joint = x % 128 < 3;
          const bevel = y < 14 || y > size - 14;
          const grain = periodicFbm(u, v, 12, 3, 193);
          const crystal = periodicHash(x, y, size, 197);
          if (joint) {
            setPixel(albedo, idx, 132, 127, 118);
            setGray(bump, idx, 65);
            setGray(rough, idx, 238);
          } else {
            const shade = (bevel ? 0.94 : 1.0) + (grain - 0.5) * 0.08 + (crystal - 0.5) * 0.06;
            setPixel(albedo, idx, 185 * shade, 178 * shade, 165 * shade);
            setGray(bump, idx, (bevel ? 155 : 205) + (grain - 0.5) * 24);
            setGray(rough, idx, 210 + grain * 24);
          }
        }
      }
    },
    1,
    1,
    { bumpScale: 0.025 },
  );

  // 9. Bark (256x256, vertical furrowed bark compatible with InstancedMesh color tinting)
  const bark = buildPbrTriple(
    256,
    (size, albedo, bump, rough) => {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const idx = (y * size + x) * 4;
          const ridge = Math.sin(u * Math.PI * 16 + periodicFbm(u, v, 4, 2, 211) * 3.5);
          const detail = periodicFbm(u, v, 16, 3, 223);
          const furrow = 0.5 + 0.5 * ridge;
          const base = 110 + furrow * 42 + (detail - 0.5) * 24;
          setPixel(albedo, idx, base + 14, base + 2, base - 10);
          setGray(bump, idx, 70 + furrow * 145 + (detail - 0.5) * 30);
          setGray(rough, idx, 224 + (1 - furrow) * 20);
        }
      }
    },
    1,
    2,
    { bumpScale: 0.045 },
  );

  // 10. Beach Sand (256x256, golden Second Bathing Beach ripples & shell flecks)
  const sand = buildPbrTriple(
    256,
    (size, albedo, bump, rough) => {
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const idx = (y * size + x) * 4;
          const ripple = Math.sin(v * Math.PI * 12 + periodicFbm(u, v, 4, 2, 241) * 2.2);
          const fine = periodicHash(x, y, size, 251);
          const shell = fine > 0.975 ? 24 : 0;
          const shade = 0.94 + ripple * 0.045 + (fine - 0.5) * 0.06;
          setPixel(albedo, idx, 222 * shade + shell, 198 * shade + shell, 154 * shade + shell);
          setGray(bump, idx, 128 + ripple * 45 + (fine - 0.5) * 28);
          setGray(rough, idx, 226 + (fine - 0.5) * 18);
        }
      }
    },
    1,
    1,
    { bumpScale: 0.015 },
  );

  // 11. Stained Glass (256x256, jewel-toned Huashi diamond leaded glass)
  const stained = buildPbrTriple(
    256,
    (size, albedo, bump, rough) => {
      const jewelPalette = [
        hexToRgb(0x2a6eb8),
        hexToRgb(0xc84336),
        hexToRgb(0xe2b23b),
        hexToRgb(0x3a8d5e),
      ];
      const cellCount = 4;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const idx = (y * size + x) * 4;
          const du = (u + v) * cellCount;
          const dv = (u - v + 1) * cellCount;
          const iu = Math.floor(du);
          const iv = Math.floor(dv);
          const fu = du - iu;
          const fv = dv - iv;
          const lead = fu < 0.07 || fu > 0.93 || fv < 0.07 || fv > 0.93;
          if (lead) {
            setPixel(albedo, idx, 34, 37, 42);
            setGray(bump, idx, 235);
            setGray(rough, idx, 165);
          } else {
            const cSeed = periodicHash(iu + iv, iu - iv, cellCount * 2, 269);
            const c = jewelPalette[Math.floor(cSeed * jewelPalette.length) % jewelPalette.length];
            const sheen = 0.85 + 0.22 * Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv);
            setPixel(albedo, idx, c[0] * sheen, c[1] * sheen, c[2] * sheen);
            setGray(bump, idx, 85);
            setGray(rough, idx, 42);
          }
        }
      }
    },
    1,
    1,
    { bumpScale: 0.02, roughness: 1.0, metalness: 0.1 },
  );

  // Utility materials
  const darkTimber = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x4a3425,
      bumpMap: bark.bumpTex,
      bumpScale: 0.015,
      roughness: 0.8,
      metalness: 0.0,
    }),
  );

  const whiteTrim = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xf2eee6,
      roughness: 0.72,
      metalness: 0.0,
    }),
  );

  const darkIron = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x262b30,
      roughness: 0.42,
      metalness: 0.65,
    }),
  );

  const windowGlass = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x2d4554,
      roughness: 0.14,
      metalness: 0.25,
    }),
  );

  const crosswalkPaint = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xece8df,
      roughness: 0.85,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );

  function createTintedStuccoMaterial(hex: string | number): THREE.MeshStandardMaterial {
    return trackMaterial(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex),
        map: stucco.albedoTex,
        bumpMap: stucco.bumpTex,
        bumpScale: 0.018,
        roughnessMap: stucco.roughTex,
        roughness: 1.0,
        metalness: 0.0,
      }),
    );
  }

  function createRoadSignMaterial(
    nameZh: string,
    nameEn: string,
    variant: RoadSignVariant = 'blue',
  ): THREE.MeshStandardMaterial {
    const key = `${variant}:${nameZh}:${nameEn}`;
    const existing = roadSignCache.get(key);
    if (existing) return existing;

    const tex = trackTexture(createRoadSignTexture(nameZh, nameEn, variant));
    const mat = trackMaterial(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.38,
        metalness: 0.12,
      }),
    );
    roadSignCache.set(key, mat);
    return mat;
  }

  function dispose(): void {
    for (const mat of ownedMaterials) {
      mat.dispose();
    }
    for (const tex of ownedTextures) {
      tex.dispose();
    }
    ownedMaterials.clear();
    ownedTextures.clear();
    roadSignCache.clear();
  }

  return {
    graniteAshlar: granite.material,
    mushroomStone: mushroom.material,
    terracottaRoof: terracotta.material,
    stuccoBase: stucco.material,
    brick: brick.material,
    darkTimber,
    whiteTrim,
    darkIron,
    windowGlass,
    stainedGlass: stained.material,
    asphalt: asphalt.material,
    cobblestone: cobblestone.material,
    curbStone: curb.material,
    crosswalkPaint,
    beachSand: sand.material,
    bark: bark.material,
    createTintedStuccoMaterial,
    createRoadSignMaterial,
    dispose,
  };
}
