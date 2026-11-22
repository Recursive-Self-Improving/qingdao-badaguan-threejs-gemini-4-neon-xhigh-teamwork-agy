import * as THREE from 'three';
import { mulberry32 } from '../../utils/math';
import { ColliderBox, VillaParcel } from '../DistrictLayout';
import { ProceduralMaterialSet } from '../ProceduralMaterials';
import {
  MaterialBatcher,
  ParcelContext,
  StuccoGetter,
  UV_SCALE,
  addCourtyardEnclosure,
  addHippedRoof,
  addPitchedSlopeSlab,
  addWindowUnit,
  addXPitchedSlopeSlab,
  applyExtrudeMetricUVs,
  createParcelContext,
  groundLocalY,
  localBoxToCollider,
} from '../Architecture';

function addTriGableWall(
  batcher: MaterialBatcher,
  wallMat: THREE.Material,
  trimMat: THREE.Material,
  cx: number,
  baseY: number,
  cz: number,
  span: number,
  peakH: number,
  depth: number,
  rotY: number,
  withTimberTruss: boolean,
): void {
  const half = span * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(0, peakH);
  shape.lineTo(half, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth * 0.5);
  applyExtrudeMetricUVs(geo, UV_SCALE.stucco, UV_SCALE.stucco);

  const baseMat = new THREE.Matrix4().compose(
    new THREE.Vector3(cx, baseY, cz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add(wallMat, geo, baseMat, true);

  // Bargeboards tucked cleanly beneath terracotta roof tiles
  const slopeLen = Math.hypot(half + 0.06, peakH - 0.06);
  const angle = Math.atan2(peakH, half);
  for (const side of [-1, 1] as const) {
    const bGeo = new THREE.BoxGeometry(slopeLen, 0.11, 0.075);
    const bm = new THREE.Matrix4().compose(
      new THREE.Vector3(side * (half * 0.5 + 0.02), peakH * 0.5 - 0.16, depth * 0.5 + 0.035),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -side * angle)),
      new THREE.Vector3(1, 1, 1),
    );
    bm.premultiply(baseMat);
    batcher.add(trimMat, bGeo, bm, true);
  }

  if (withTimberTruss) {
    // Horizontal collar tie & vertical king/queen posts (slight Z offset 8mm from each other -> zero Z-fighting)
    const tieW = span * 0.52;
    const tieGeo = new THREE.BoxGeometry(tieW, 0.11, 0.09);
    const tieM = new THREE.Matrix4().makeTranslation(0, peakH * 0.48, depth * 0.5 + 0.046);
    tieM.premultiply(baseMat);
    batcher.add(trimMat, tieGeo, tieM, true);

    const kingGeo = new THREE.BoxGeometry(0.11, peakH * 0.92, 0.085);
    const kingM = new THREE.Matrix4().makeTranslation(0, peakH * 0.46, depth * 0.5 + 0.036);
    kingM.premultiply(baseMat);
    batcher.add(trimMat, kingGeo, kingM, true);

    for (const sx of [-1, 1] as const) {
      const qGeo = new THREE.BoxGeometry(0.09, peakH * 0.45, 0.085);
      const qM = new THREE.Matrix4().makeTranslation(sx * half * 0.45, peakH * 0.22, depth * 0.5 + 0.036);
      qM.premultiply(baseMat);
      batcher.add(trimMat, qGeo, qM, true);
    }
  }
}

function addEntrySteps(
  ctx: ParcelContext,
  batcher: MaterialBatcher,
  stepMat: THREE.Material,
  cx: number,
  startZ: number,
  width: number,
  topY: number,
): void {
  const endZ = startZ + 1.15;
  const targetGY = Math.min(
    groundLocalY(ctx, cx - width * 0.4, endZ),
    groundLocalY(ctx, cx + width * 0.4, endZ),
  );
  const steps = 3;
  const drop = Math.max(0.45, topY - targetGY);
  for (let s = 0; s < steps; s++) {
    const syTop = topY - ((s + 1) / steps) * (drop - 0.12);
    const sz = startZ + 0.16 + s * 0.32;
    const localStepGY = Math.min(
      targetGY,
      groundLocalY(ctx, cx - width * 0.4, sz),
      groundLocalY(ctx, cx, sz),
      groundLocalY(ctx, cx + width * 0.4, sz),
    );
    const syBot = Math.min(syTop - 0.24, localStepGY - 0.45);
    batcher.addWorldSlopeBox(stepMat, width, syTop, syBot, 0.34, cx, sz, UV_SCALE.graniteAshlar);
  }
}

function buildGermanVilla(
  ctx: ParcelContext,
  batcher: MaterialBatcher,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  rng: () => number,
): void {
  const stuccoHex = rng() > 0.5 ? '#EAE0CC' : '#E4D4B4';
  const stucco = getStucco(stuccoHex);
  const bot = ctx.skirtBottomLocalY;

  const w = 12.2 + rng() * 1.4;
  const d = 8.4 + rng() * 0.8;
  const cz = -1.8;
  const plinthTop = 0.28;
  const eaveY = 5.65 + rng() * 0.35;
  const ridgeY = eaveY + 3.45;
  const wingSign = rng() > 0.5 ? 1 : -1;
  const wingX = wingSign * (w * 0.22);

  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.mushroomStone,
    wallUvScale: UV_SCALE.mushroomStone,
    capMaterial: materials.mushroomStone,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.75,
    wallHeightAboveGround: 0.65,
    railHeight: 0.45,
    pierHeightAboveGround: 1.22,
    walkEndLZ: cz + d * 0.5 + 1.6,
  });

  // Plinth & main body
  batcher.addWorldSlopeBox(materials.mushroomStone, w + 0.22, plinthTop, bot, d + 0.22, 0, cz, UV_SCALE.mushroomStone);
  batcher.addWorldSlopeBox(stucco, w, eaveY, plinthTop, d, 0, cz, UV_SCALE.stucco);

  // Projecting front cross-gable wing
  const cw = 4.6;
  const cd = 1.6;
  const wingCZ = cz + d * 0.5 + cd * 0.5 - 0.1;
  const crossRidgeY = ridgeY - 0.32;
  batcher.addWorldSlopeBox(materials.mushroomStone, cw + 0.18, plinthTop, bot, cd + 0.18, wingX, wingCZ, UV_SCALE.mushroomStone);
  batcher.addWorldSlopeBox(stucco, cw, eaveY, plinthTop, cd, wingX, wingCZ, UV_SCALE.stucco);

  // Half-timbered framing on 2F (y = 3.15..eaveY) with 8mm Z-step between horizontals & verticals
  const beltY = 3.15;
  batcher.addBox(materials.darkTimber, w + 0.1, 0.14, d + 0.1, 0, beltY, cz, UV_SCALE.darkTimber);
  batcher.addBox(materials.darkTimber, w + 0.1, 0.14, d + 0.1, 0, eaveY - 0.08, cz, UV_SCALE.darkTimber);
  batcher.addBox(materials.darkTimber, cw + 0.1, 0.14, cd + 0.1, wingX, beltY, wingCZ, UV_SCALE.darkTimber);

  // Vertical half-timber studs along front & rear 2F
  const studCount = 5;
  for (let i = 0; i <= studCount; i++) {
    const sx = -w * 0.5 + 0.14 + ((w - 0.28) * i) / studCount;
    for (const sz of [cz + d * 0.5, cz - d * 0.5] as const) {
      batcher.addBox(materials.darkTimber, 0.11, eaveY - beltY, 0.085, sx, (eaveY + beltY) * 0.5, sz, UV_SCALE.darkTimber);
    }
  }
  for (const sz of [cz - d * 0.3, cz, cz + d * 0.3] as const) {
    for (const sx of [-w * 0.5, w * 0.5] as const) {
      batcher.addBox(materials.darkTimber, 0.085, eaveY - beltY, 0.11, sx, (eaveY + beltY) * 0.5, sz, UV_SCALE.darkTimber);
    }
  }

  // Steep main E-W terracotta gable roof
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, -w * 0.5 - 0.42, w * 0.5 + 0.42, cz + d * 0.5 + 0.42, eaveY - 0.08, cz, ridgeY, 0.14, UV_SCALE.terracottaRoof);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, -w * 0.5 - 0.42, w * 0.5 + 0.42, cz - d * 0.5 - 0.42, eaveY - 0.08, cz, ridgeY, 0.14, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.terracottaRoof, w + 0.86, 0.18, 0.22, 0, ridgeY + 0.04, cz, UV_SCALE.terracottaRoof);
  addTriGableWall(batcher, stucco, materials.darkTimber, -w * 0.5 + 0.18, eaveY - 0.04, cz, d - 0.1, ridgeY - eaveY, 0.32, -Math.PI * 0.5, true);
  addTriGableWall(batcher, stucco, materials.darkTimber, w * 0.5 - 0.18, eaveY - 0.04, cz, d - 0.1, ridgeY - eaveY, 0.32, Math.PI * 0.5, true);

  // Cross-gable roof (0.32m lower ridge -> zero Z-fighting)
  const wingFrontZ = wingCZ + cd * 0.5 + 0.32;
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cz, wingFrontZ, wingX - cw * 0.5 - 0.36, eaveY - 0.1, wingX, crossRidgeY, 0.14, UV_SCALE.terracottaRoof);
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cz, wingFrontZ, wingX + cw * 0.5 + 0.36, eaveY - 0.1, wingX, crossRidgeY, 0.14, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.terracottaRoof, 0.2, 0.18, wingFrontZ - cz, wingX, crossRidgeY + 0.04, (cz + wingFrontZ) * 0.5, UV_SCALE.terracottaRoof);
  addTriGableWall(batcher, stucco, materials.darkTimber, wingX, eaveY - 0.04, wingCZ + cd * 0.5 - 0.16, cw - 0.1, crossRidgeY - eaveY, 0.32, 0, true);

  // Chimney
  batcher.addWorldSlopeBox(materials.mushroomStone, 0.8, ridgeY + 0.9, eaveY, 0.8, -wingSign * (w * 0.24), cz - 1.6, UV_SCALE.mushroomStone);

  // Entry porch & timber hood on non-wing front bay
  const entryX = -wingSign * (w * 0.22);
  const porchZ = cz + d * 0.5;
  batcher.addBox(materials.darkTimber, 1.35, 2.25, 0.14, entryX, 1.4, porchZ + 0.04, UV_SCALE.darkTimber);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, entryX - 1.2, entryX + 1.2, porchZ + 1.2, 2.65, porchZ, 3.25, 0.1, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.darkTimber, 0.12, 2.5, 0.12, entryX - 0.95, 1.4, porchZ + 1.0, UV_SCALE.darkTimber);
  batcher.addBox(materials.darkTimber, 0.12, 2.5, 0.12, entryX + 0.95, 1.4, porchZ + 1.0, UV_SCALE.darkTimber);
  addEntrySteps(ctx, batcher, materials.mushroomStone, entryX, porchZ + 0.9, 2.0, plinthTop);

  // Windows
  addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, wingX, 1.75, wingCZ + cd * 0.5, 1.25, 1.5, 0, 2, 2, false, undefined, true);
  addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, wingX, 4.35, wingCZ + cd * 0.5, 1.25, 1.45, 0, 2, 2, false, undefined, true);
  addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, entryX, 4.35, porchZ, 1.2, 1.45, 0, 2, 2, false, undefined, true);
  for (const rx of [-w * 0.28, w * 0.28] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, rx, 1.75, cz - d * 0.5, 1.1, 1.4, Math.PI, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, rx, 4.35, cz - d * 0.5, 1.1, 1.4, Math.PI, 2, 2, false, undefined, true);
  }
  for (const sx of [-1, 1] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, sx * w * 0.5, 1.75, cz, 1.05, 1.4, sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, sx * w * 0.5, 4.35, cz, 1.05, 1.4, sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 2, 2, false, undefined, true);
  }

  colliders.push(localBoxToCollider(ctx.parcel, `${ctx.parcel.id}_bld`, 'building', -w * 0.5 - 0.2, w * 0.5 + 0.2, cz - d * 0.5 - 0.2, Math.max(wingCZ + cd * 0.5, porchZ + 2.0)));
}

function buildSpanishVilla(
  ctx: ParcelContext,
  batcher: MaterialBatcher,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  rng: () => number,
): void {
  const stuccoHex = rng() > 0.5 ? '#F0E4CE' : '#EAD0B6';
  const stucco = getStucco(stuccoHex);
  const bot = ctx.skirtBottomLocalY;

  const w = 12.6 + rng() * 1.4;
  const d = 8.4 + rng() * 0.8;
  const cz = -1.8;
  const plinthTop = 0.26;
  const eaveY = 5.85 + rng() * 0.35;
  const hasTower = rng() > 0.45;

  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.graniteAshlar,
    wallUvScale: UV_SCALE.graniteAshlar,
    capMaterial: materials.graniteAshlar,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.75,
    wallHeightAboveGround: 0.65,
    railHeight: 0.44,
    pierHeightAboveGround: 1.24,
    walkEndLZ: cz + d * 0.5 + 2.2,
  });

  // Granite ashlar plinth & sunlit stucco body
  batcher.addWorldSlopeBox(materials.graniteAshlar, w + 0.22, plinthTop, bot, d + 0.22, 0, cz, UV_SCALE.graniteAshlar);
  batcher.addWorldSlopeBox(stucco, w, eaveY, plinthTop, d, 0, cz, UV_SCALE.stucco);
  batcher.addBox(materials.whiteTrim, w + 0.18, 0.16, d + 0.18, 0, eaveY - 0.04, cz, 0);
  batcher.addBox(materials.whiteTrim, w + 0.12, 0.1, d + 0.12, 0, 3.25, cz, 0);

  // Low-pitched hipped terracotta roof with deep eaves
  addHippedRoof(batcher, materials.terracottaRoof, materials.whiteTrim, 0, eaveY, cz, w + 1.15, d + 1.15, 2.15, w * 0.45, UV_SCALE.terracottaRoof);

  // 3-Arch Ground-Floor Loggia (+Z front)
  const logW = 7.4;
  const logD = 2.1;
  const logCZ = cz + d * 0.5 + logD * 0.5;
  const logFrontZ = cz + d * 0.5 + logD;
  batcher.addWorldSlopeBox(materials.graniteAshlar, logW + 0.2, plinthTop, bot, logD + 0.15, 0, logCZ, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.graniteAshlar, logW + 0.24, 0.08, logD + 0.2, 0, plinthTop + 0.02, logCZ, UV_SCALE.graniteAshlar);
  // Loggia roof / 2F terrace deck
  batcher.addBox(materials.whiteTrim, logW + 0.22, 0.2, logD + 0.18, 0, 3.25, logCZ, 0);

  // 4 Columns + 3 round arch spandrels
  const bayW = logW / 3;
  for (let i = 0; i <= 3; i++) {
    const cx = -logW * 0.5 + i * bayW;
    const colGeo = new THREE.CylinderGeometry(0.15, 0.18, 2.3, 12);
    batcher.add(materials.whiteTrim, colGeo, new THREE.Matrix4().makeTranslation(cx, plinthTop + 1.15, logFrontZ - 0.16), true);
  }
  for (let b = 0; b < 3; b++) {
    const bx = -bayW + b * bayW;
    const archR = 0.88;
    const shape = new THREE.Shape();
    shape.moveTo(-bayW * 0.5, 1.9);
    shape.lineTo(-bayW * 0.5, 3.15);
    shape.lineTo(bayW * 0.5, 3.15);
    shape.lineTo(bayW * 0.5, 1.9);
    shape.lineTo(archR, 1.9);
    shape.absarc(0, 1.9, archR, 0, Math.PI, false);
    shape.lineTo(-archR, 1.9);
    shape.closePath();
    const aGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: false, curveSegments: 12 });
    aGeo.translate(0, 0, -0.13);
    applyExtrudeMetricUVs(aGeo, UV_SCALE.stucco, UV_SCALE.stucco);
    batcher.add(stucco, aGeo, new THREE.Matrix4().makeTranslation(bx, 0, logFrontZ - 0.16), true);
  }
  addEntrySteps(ctx, batcher, materials.graniteAshlar, 0, logFrontZ, 2.4, plinthTop);

  // Dark iron 2F Juliet balcony railing on loggia terrace
  batcher.addBox(materials.darkIron, logW, 0.045, 0.045, 0, 4.22, logFrontZ - 0.08, 0);
  batcher.addBox(materials.darkIron, logW, 0.04, 0.04, 0, 3.45, logFrontZ - 0.08, 0);
  for (let p = -8; p <= 8; p++) {
    batcher.addBox(materials.darkIron, 0.032, 0.88, 0.032, p * (logW / 17), 3.78, logFrontZ - 0.08, 0);
  }

  // Optional corner belvedere tower (raised eave & window so sill clears main hipped roof slope)
  if (hasTower) {
    const tx = -w * 0.5 + 1.3;
    const tz = cz - d * 0.5 + 1.3;
    const towerEaveY = eaveY + 2.85;
    batcher.addWorldSlopeBox(stucco, 2.8, towerEaveY, plinthTop, 2.8, tx, tz, UV_SCALE.stucco);
    batcher.addBox(materials.whiteTrim, 2.94, 0.14, 2.94, tx, towerEaveY - 0.05, tz, 0);
    addHippedRoof(batcher, materials.terracottaRoof, materials.whiteTrim, tx, towerEaveY, tz, 3.3, 3.3, 1.45, 0, UV_SCALE.terracottaRoof);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, tx, eaveY + 2.08, tz + 1.4, 0.9, 0.95, 0, 2, 2, false, undefined, true);
  }

  // Upper & rear windows + loggia doors
  for (const wx of [-2.4, 0, 2.4] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 1.65, cz + d * 0.5, 1.15, 1.85, 0, 2, 3, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 4.5, cz + d * 0.5, 1.15, 1.65, 0, 2, 2, false, undefined, true);
  }
  const rearXs = hasTower ? ([-0.6, w * 0.28] as const) : ([-w * 0.28, w * 0.28] as const);
  for (const wx of rearXs) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 1.75, cz - d * 0.5, 1.1, 1.45, Math.PI, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 4.5, cz - d * 0.5, 1.1, 1.45, Math.PI, 2, 2, false, undefined, true);
  }
  for (const sx of [-1, 1] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, sx * w * 0.5, 1.75, cz, 1.05, 1.45, sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, sx * w * 0.5, 4.5, cz, 1.05, 1.45, sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 2, 2, false, undefined, true);
  }

  colliders.push(localBoxToCollider(ctx.parcel, `${ctx.parcel.id}_bld`, 'building', -w * 0.5 - 0.2, w * 0.5 + 0.2, cz - d * 0.5 - 0.2, logFrontZ + 1.1));
}

function buildBritishVilla(
  ctx: ParcelContext,
  batcher: MaterialBatcher,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  rng: () => number,
): void {
  const stuccoHex = rng() > 0.5 ? '#DED6C8' : '#D4CCC0';
  const stucco = getStucco(stuccoHex);
  const bot = ctx.skirtBottomLocalY;

  const w = 12.4 + rng() * 1.2;
  const d = 8.4 + rng() * 0.8;
  const cz = -1.8;
  const plinthTop = 0.55; // Tall British stone plinth
  const eaveY = 5.95 + rng() * 0.3;
  const ridgeY = eaveY + 3.15;

  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.graniteAshlar,
    wallUvScale: UV_SCALE.graniteAshlar,
    capMaterial: materials.graniteAshlar,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.75,
    wallHeightAboveGround: 0.66,
    railHeight: 0.46,
    pierHeightAboveGround: 1.26,
    walkEndLZ: cz + d * 0.5 + 2.0,
  });

  // Tall granite plinth + stucco body
  batcher.addWorldSlopeBox(materials.graniteAshlar, w + 0.24, plinthTop, bot, d + 0.24, 0, cz, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.whiteTrim, w + 0.3, 0.1, d + 0.3, 0, plinthTop + 0.04, cz, 0);
  batcher.addWorldSlopeBox(stucco, w, eaveY, plinthTop + 0.08, d, 0, cz, UV_SCALE.stucco);
  batcher.addBox(materials.whiteTrim, w + 0.16, 0.14, d + 0.16, 0, eaveY - 0.04, cz, 0);

  // Staggered corner quoins
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      for (let q = 0; q < 12; q++) {
        const wideX = q % 2 === 0;
        batcher.addBox(
          materials.whiteTrim,
          wideX ? 0.52 : 0.32,
          0.34,
          wideX ? 0.32 : 0.52,
          sx * (w * 0.5 - (wideX ? 0.2 : 0.1)),
          plinthTop + 0.32 + q * 0.43,
          cz + sz * (d * 0.5 - (wideX ? 0.1 : 0.2)),
          0,
        );
      }
    }
  }

  // Pitched E-W gable roof + 2 attic dormers
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, -w * 0.5 - 0.4, w * 0.5 + 0.4, cz + d * 0.5 + 0.4, eaveY - 0.08, cz, ridgeY, 0.14, UV_SCALE.terracottaRoof);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, -w * 0.5 - 0.4, w * 0.5 + 0.4, cz - d * 0.5 - 0.4, eaveY - 0.08, cz, ridgeY, 0.14, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.terracottaRoof, w + 0.84, 0.18, 0.22, 0, ridgeY + 0.04, cz, UV_SCALE.terracottaRoof);
  addTriGableWall(batcher, stucco, materials.whiteTrim, -w * 0.5 + 0.18, eaveY - 0.04, cz, d - 0.1, ridgeY - eaveY, 0.32, -Math.PI * 0.5, false);
  addTriGableWall(batcher, stucco, materials.whiteTrim, w * 0.5 - 0.18, eaveY - 0.04, cz, d - 0.1, ridgeY - eaveY, 0.32, Math.PI * 0.5, false);

  // 2 Pitched attic dormers on front slope (raised & embedded cleanly above main roof slab)
  const dormerBackZ = cz + d * 0.1;
  const dormerFrontZ = cz + d * 0.33;
  const dormerCZ = (dormerBackZ + dormerFrontZ) * 0.5;
  const dormerD = dormerFrontZ - dormerBackZ;
  for (const dx of [-w * 0.25, w * 0.25] as const) {
    batcher.addBox(stucco, 1.35, 1.52, dormerD, dx, eaveY + 1.66, dormerCZ, UV_SCALE.stucco);
    const dGable = new THREE.Shape();
    dGable.moveTo(-0.675, 0);
    dGable.lineTo(0, 0.62);
    dGable.lineTo(0.675, 0);
    dGable.closePath();
    const dGableGeo = new THREE.ExtrudeGeometry(dGable, { depth: dormerD - 0.04, bevelEnabled: false });
    dGableGeo.translate(0, 0, -(dormerD - 0.04) * 0.5);
    applyExtrudeMetricUVs(dGableGeo, UV_SCALE.stucco, UV_SCALE.stucco);
    batcher.add(stucco, dGableGeo, new THREE.Matrix4().makeTranslation(dx, eaveY + 2.4, dormerCZ), true);

    addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cz + d * 0.08, dormerFrontZ + 0.16, dx - 0.85, eaveY + 2.38, dx, eaveY + 3.02, 0.11, UV_SCALE.terracottaRoof);
    addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cz + d * 0.08, dormerFrontZ + 0.16, dx + 0.85, eaveY + 2.38, dx, eaveY + 3.02, 0.11, UV_SCALE.terracottaRoof);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, dx, eaveY + 1.88, dormerFrontZ, 0.8, 0.85, 0, 2, 2, false, undefined, true);
  }

  // 2 Tall brick chimneys
  for (const cx of [-w * 0.36, w * 0.36] as const) {
    batcher.addWorldSlopeBox(materials.brick, 0.85, ridgeY + 1.45, eaveY, 0.85, cx, cz - 1.2, UV_SCALE.brick);
    batcher.addBox(materials.graniteAshlar, 1.0, 0.14, 1.0, cx, ridgeY + 1.52, cz - 1.2, UV_SCALE.graniteAshlar);
  }

  // Projecting 2-story granite & white-trim bay window (+Z front left)
  const baySign = rng() > 0.5 ? -1 : 1;
  const bayX = baySign * (w * 0.24);
  const bayCZ = cz + d * 0.5 + 0.65;
  batcher.addWorldSlopeBox(materials.graniteAshlar, 3.1, 3.15, bot, 1.35, bayX, bayCZ, UV_SCALE.graniteAshlar);
  batcher.addWorldSlopeBox(stucco, 3.0, eaveY - 0.1, 3.15, 1.25, bayX, bayCZ, UV_SCALE.stucco);
  addHippedRoof(batcher, materials.terracottaRoof, materials.whiteTrim, bayX, eaveY - 0.1, bayCZ, 3.3, 1.6, 0.8, 1.6, UV_SCALE.terracottaRoof);
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, bayX, 1.9, bayCZ + 0.68, 2.0, 1.55, 0, 3, 2, false, undefined, true);
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, bayX, 4.55, bayCZ + 0.625, 1.9, 1.45, 0, 3, 2, false, undefined, true);

  // Stone entry porch (+Z opposite side)
  const portX = -baySign * (w * 0.2);
  const portCZ = cz + d * 0.5 + 0.8;
  const porchEaveY = plinthTop + 2.46;
  batcher.addWorldSlopeBox(materials.graniteAshlar, 2.6, plinthTop, bot, 1.6, portX, portCZ, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.graniteAshlar, 0.34, 2.4, 0.34, portX - 1.0, plinthTop + 1.2, portCZ + 0.55, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.graniteAshlar, 0.34, 2.4, 0.34, portX + 1.0, plinthTop + 1.2, portCZ + 0.55, UV_SCALE.graniteAshlar);
  addHippedRoof(batcher, materials.terracottaRoof, materials.whiteTrim, portX, porchEaveY, portCZ, 2.9, 1.9, 0.56, 1.2, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.whiteTrim, 1.3, 2.18, 0.14, portX, plinthTop + 1.09, cz + d * 0.5 + 0.04, 0);
  addEntrySteps(ctx, batcher, materials.graniteAshlar, portX, portCZ + 0.78, 2.0, plinthTop);
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, portX, 4.62, cz + d * 0.5, 1.2, 1.38, 0, 2, 2, false, undefined, true);

  // Rear & side windows
  for (const rx of [-w * 0.28, w * 0.28] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, rx, 1.9, cz - d * 0.5, 1.15, 1.45, Math.PI, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, rx, 4.55, cz - d * 0.5, 1.15, 1.45, Math.PI, 2, 2, false, undefined, true);
  }
  for (const sx of [-1, 1] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, sx * w * 0.5, 1.9, cz, 1.1, 1.45, sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, sx * w * 0.5, 4.55, cz, 1.1, 1.45, sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 2, 2, false, undefined, true);
  }

  colliders.push(localBoxToCollider(ctx.parcel, `${ctx.parcel.id}_bld`, 'building', -w * 0.5 - 0.2, w * 0.5 + 0.2, cz - d * 0.5 - 0.2, portCZ + 1.9));
}

export function buildInfillVilla(
  parcel: VillaParcel,
  infillIndex: number,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  disposableGeometries: THREE.BufferGeometry[],
): THREE.Group {
  const ctx = createParcelContext(parcel, 0.38, parcel.width * 0.36, parcel.depth * 0.36);
  const group = new THREE.Group();
  group.name = parcel.id;
  group.position.set(parcel.x, ctx.datumY, parcel.z);
  group.rotation.y = parcel.facingYaw;

  const batcher = new MaterialBatcher();
  const rng = mulberry32(0x8ada0101 + infillIndex * 7919);

  if (parcel.style === 'german') {
    buildGermanVilla(ctx, batcher, materials, getStucco, colliders, rng);
  } else if (parcel.style === 'spanish') {
    buildSpanishVilla(ctx, batcher, materials, getStucco, colliders, rng);
  } else {
    buildBritishVilla(ctx, batcher, materials, getStucco, colliders, rng);
  }

  batcher.flush(group, parcel.id, materials, disposableGeometries);
  return group;
}
