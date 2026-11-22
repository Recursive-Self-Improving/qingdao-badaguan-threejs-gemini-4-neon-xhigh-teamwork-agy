import * as THREE from 'three';
import { ColliderBox, VillaParcel } from '../DistrictLayout';
import { ProceduralMaterialSet } from '../ProceduralMaterials';
import {
  MaterialBatcher,
  StuccoGetter,
  UV_SCALE,
  addCourtyardEnclosure,
  addPitchedSlopeSlab,
  addWindowUnit,
  addXPitchedSlopeSlab,
  applyExtrudeMetricUVs,
  createParcelContext,
  groundLocalY,
  localBoxToCollider,
  scaleGeometryUVs,
} from '../Architecture';

function addGableWall(
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
  uvScale: number,
): void {
  const half = span * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(0, peakH);
  shape.lineTo(half, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -depth * 0.5);
  applyExtrudeMetricUVs(geo, uvScale, uvScale);

  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(cx, baseY, cz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add(wallMat, geo, m, true);

  // Scalloped/stepped bargeboards offset slightly proud of gable face & tucked cleanly under roof tiles
  const slopeLen = Math.hypot(half + 0.06, peakH - 0.06);
  const angle = Math.atan2(peakH, half);
  const rotMat = new THREE.Matrix4().makeRotationY(rotY);
  const posMat = new THREE.Matrix4().makeTranslation(cx, baseY, cz);
  const baseMat = new THREE.Matrix4().multiplyMatrices(posMat, rotMat);

  for (const side of [-1, 1] as const) {
    const bGeo = new THREE.BoxGeometry(slopeLen, 0.12, 0.075);
    const bm = new THREE.Matrix4().compose(
      new THREE.Vector3(side * (half * 0.5 + 0.02), peakH * 0.5 - 0.16, depth * 0.5 + 0.035),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -side * angle)),
      new THREE.Vector3(1, 1, 1),
    );
    bm.premultiply(baseMat);
    batcher.add(trimMat, bGeo, bm, true);
  }
}

export function buildPrincessHouse(
  parcel: VillaParcel,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  disposableGeometries: THREE.BufferGeometry[],
): THREE.Group {
  const ctx = createParcelContext(parcel, 0.36, 9.5, 7.2);
  const group = new THREE.Group();
  group.name = parcel.id;
  group.position.set(parcel.x, ctx.datumY, parcel.z);
  group.rotation.y = parcel.facingYaw;

  const batcher = new MaterialBatcher();
  const tealStucco = getStucco('#35746E');
  const bot = ctx.skirtBottomLocalY;

  // 1. Courtyard enclosure (mushroom stone + dark iron + 3.8m open gate)
  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.mushroomStone,
    wallUvScale: UV_SCALE.mushroomStone,
    capMaterial: materials.graniteAshlar,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.9,
    wallHeightAboveGround: 0.66,
    railHeight: 0.48,
    pierHeightAboveGround: 1.32,
    walkEndLZ: 4.4,
    inset: 0.45,
  });

  // 2. Main Nordic Villa Mass (lx [-8.6, +8.6], lz [-7.8, +1.8])
  const mainW = 17.2;
  const mainD = 9.6;
  const mainCX = 0;
  const mainCZ = -3.0;
  const plinthTop = 0.42;
  const eaveY = 6.5;
  const ridgeY = 11.2;

  // Mushroom stone plinth sunk deep below terrain
  batcher.addWorldSlopeBox(materials.mushroomStone, mainW + 0.24, plinthTop, bot, mainD + 0.24, mainCX, mainCZ, UV_SCALE.mushroomStone);
  batcher.addBox(materials.whiteTrim, mainW + 0.32, 0.12, mainD + 0.32, mainCX, plinthTop + 0.04, mainCZ, 0);

  // Teal stucco 2-story body
  batcher.addWorldSlopeBox(tealStucco, mainW, eaveY, plinthTop + 0.08, mainD, mainCX, mainCZ, UV_SCALE.stucco);

  // White corner pilasters & horizontal belt/cornice bands
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      batcher.addBox(
        materials.whiteTrim,
        0.38,
        eaveY - plinthTop,
        0.38,
        mainCX + sx * (mainW * 0.5 - 0.14),
        (eaveY + plinthTop) * 0.5,
        mainCZ + sz * (mainD * 0.5 - 0.14),
        0,
      );
    }
  }
  batcher.addBox(materials.whiteTrim, mainW + 0.14, 0.14, mainD + 0.14, mainCX, 3.55, mainCZ, 0);
  batcher.addBox(materials.whiteTrim, mainW + 0.22, 0.18, mainD + 0.22, mainCX, eaveY - 0.04, mainCZ, 0);

  // Steeply pitched E-W gable roof & gable walls (east/west ends)
  const gableHalfD = mainD * 0.5 + 0.45;
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, -mainW * 0.5 - 0.45, mainW * 0.5 + 0.45, mainCZ + gableHalfD, eaveY - 0.1, mainCZ, ridgeY, 0.16, UV_SCALE.terracottaRoof);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, -mainW * 0.5 - 0.45, mainW * 0.5 + 0.45, mainCZ - gableHalfD, eaveY - 0.1, mainCZ, ridgeY, 0.16, UV_SCALE.terracottaRoof);
  // Solid ridge cap
  batcher.addBox(materials.terracottaRoof, mainW + 0.92, 0.2, 0.24, mainCX, ridgeY + 0.04, mainCZ, UV_SCALE.terracottaRoof);

  // East & West teal gable walls (slightly inset from roof overhang)
  addGableWall(batcher, tealStucco, materials.whiteTrim, mainCX - mainW * 0.5 + 0.22, eaveY - 0.05, mainCZ, mainD - 0.1, ridgeY - eaveY, 0.44, -Math.PI * 0.5, UV_SCALE.stucco);
  addGableWall(batcher, tealStucco, materials.whiteTrim, mainCX + mainW * 0.5 - 0.22, eaveY - 0.05, mainCZ, mainD - 0.1, ridgeY - eaveY, 0.44, Math.PI * 0.5, UV_SCALE.stucco);

  // 3. Projecting South Cross-Gable Wing (lx [-2.8, +2.8], lz [+1.8, +3.6], ridge 0.45m lower -> zero Z-fighting!)
  const wingW = 5.6;
  const wingCZ = 2.65;
  const wingD = 2.2;
  const wingRidgeY = ridgeY - 0.45;
  batcher.addWorldSlopeBox(materials.mushroomStone, wingW + 0.2, plinthTop, bot, wingD + 0.2, 0, wingCZ, UV_SCALE.mushroomStone);
  batcher.addWorldSlopeBox(tealStucco, wingW, eaveY, plinthTop + 0.08, wingD, 0, wingCZ, UV_SCALE.stucco);
  batcher.addBox(materials.whiteTrim, wingW + 0.14, 0.14, wingD + 0.14, 0, 3.55, wingCZ, 0);

  // Cross-gable roof slopes (spanning z from mainCZ to +3.95, X slopes from ±3.22 to 0)
  const crossHalfW = wingW * 0.5 + 0.42;
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, mainCZ + 0.4, 3.95, -crossHalfW, eaveY - 0.12, 0, wingRidgeY, 0.15, UV_SCALE.terracottaRoof);
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, mainCZ + 0.4, 3.95, crossHalfW, eaveY - 0.12, 0, wingRidgeY, 0.15, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.terracottaRoof, 0.22, 0.2, 3.95 - mainCZ - 0.35, 0, wingRidgeY + 0.04, (mainCZ + 0.4 + 3.95) * 0.5, UV_SCALE.terracottaRoof);
  // Flush cross-gable wall (front face 3.57 + 0.18 = 3.75 matching wing below)
  addGableWall(batcher, tealStucco, materials.whiteTrim, 0, eaveY - 0.06, 3.57, wingW, wingRidgeY - eaveY, 0.36, 0, UV_SCALE.stucco);

  // 4. Four White-Trimmed Gabled Dormers (2 front, 2 rear), raised & embedded cleanly above main roof slope
  for (const faceZ of [1, -1] as const) {
    const frontZ = mainCZ + faceZ * 3.3;
    const boxCZ = mainCZ + faceZ * 2.275;
    const roofZ0 = faceZ > 0 ? mainCZ + 1.05 : mainCZ - 3.45;
    const roofZ1 = faceZ > 0 ? mainCZ + 3.45 : mainCZ - 1.05;

    for (const dx of [-4.8, 4.8] as const) {
      batcher.addBox(tealStucco, 1.45, 1.8, 2.05, dx, eaveY + 2.3, boxCZ, UV_SCALE.stucco);
      batcher.addBox(materials.whiteTrim, 1.54, 0.1, 2.12, dx, eaveY + 3.16, boxCZ, 0);
      // Gable triangle under dormer roof
      const dGable = new THREE.Shape();
      dGable.moveTo(-0.72, 0);
      dGable.lineTo(0, 0.68);
      dGable.lineTo(0.72, 0);
      dGable.closePath();
      const dGableGeo = new THREE.ExtrudeGeometry(dGable, { depth: 2.02, bevelEnabled: false });
      dGableGeo.translate(0, 0, -1.01);
      applyExtrudeMetricUVs(dGableGeo, UV_SCALE.stucco, UV_SCALE.stucco);
      batcher.add(tealStucco, dGableGeo, new THREE.Matrix4().makeTranslation(dx, eaveY + 3.15, boxCZ), true);

      addXPitchedSlopeSlab(batcher, materials.terracottaRoof, roofZ0, roofZ1, dx - 0.92, eaveY + 3.12, dx, eaveY + 3.85, 0.12, UV_SCALE.terracottaRoof);
      addXPitchedSlopeSlab(batcher, materials.terracottaRoof, roofZ0, roofZ1, dx + 0.92, eaveY + 3.12, dx, eaveY + 3.85, 0.12, UV_SCALE.terracottaRoof);
      addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, dx, eaveY + 2.42, frontZ, 0.85, 0.9, faceZ > 0 ? 0 : Math.PI, 2, 2);
    }
  }

  // 5. ~15m Pointed Nordic Spire Turret (SW corner lx = -7.6, lz = +1.8, r = 1.92m)
  const turX = -7.6;
  const turZ = 1.8;
  const turR = 1.92;
  const turPlinthH = plinthTop - bot;
  const turBaseGeo = new THREE.CylinderGeometry(turR + 0.12, turR + 0.18, turPlinthH, 16);
  scaleGeometryUVs(turBaseGeo, 2 * Math.PI * turR * UV_SCALE.mushroomStone, turPlinthH * UV_SCALE.mushroomStone);
  batcher.add(materials.mushroomStone, turBaseGeo, new THREE.Matrix4().makeTranslation(turX, bot + turPlinthH * 0.5, turZ), true);

  const turBodyH = 8.6 - plinthTop;
  const turBodyGeo = new THREE.CylinderGeometry(turR, turR, turBodyH, 16);
  scaleGeometryUVs(turBodyGeo, 2 * Math.PI * turR * UV_SCALE.stucco, turBodyH * UV_SCALE.stucco);
  batcher.add(tealStucco, turBodyGeo, new THREE.Matrix4().makeTranslation(turX, plinthTop + turBodyH * 0.5, turZ), true);

  // White watch-collar & corbelled eaves
  const collarGeo = new THREE.CylinderGeometry(turR + 0.22, turR + 0.04, 0.9, 8);
  batcher.add(materials.whiteTrim, collarGeo, new THREE.Matrix4().makeTranslation(turX, 9.05, turZ), true);
  // Tall pointed Nordic spire (9.5 -> 15.3m)
  const spireGeo = new THREE.ConeGeometry(turR + 0.34, 5.8, 8);
  scaleGeometryUVs(spireGeo, 2 * Math.PI * turR * UV_SCALE.terracottaRoof, 5.8 * UV_SCALE.terracottaRoof);
  batcher.add(materials.terracottaRoof, spireGeo, new THREE.Matrix4().makeTranslation(turX, 9.45 + 2.9, turZ), true);
  // Weathervane finial (15.25 -> 16.45m)
  batcher.add(materials.darkIron, new THREE.CylinderGeometry(0.035, 0.055, 1.25, 8), new THREE.Matrix4().makeTranslation(turX, 15.8, turZ), true);
  batcher.addBox(materials.darkIron, 0.65, 0.14, 0.03, turX + 0.12, 16.15, turZ, 0);

  // Turret windows
  for (const ang of [-Math.PI * 0.5, -Math.PI * 0.15, Math.PI * 0.2] as const) {
    const wx = turX + Math.sin(ang) * (turR + 0.01);
    const wz = turZ + Math.cos(ang) * (turR + 0.01);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 2.1, wz, 0.72, 1.25, ang, 2, 2);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 5.1, wz, 0.72, 1.25, ang, 2, 2);
  }

  // 6. South Square Terrace & Steps (lx [-4.2, +4.2], lz [+1.8, +4.4])
  batcher.addWorldSlopeBox(materials.mushroomStone, 8.4, 0.0, bot, 2.6, 0, 3.1, UV_SCALE.mushroomStone);
  batcher.addBox(materials.graniteAshlar, 8.5, 0.1, 2.7, 0, 0.02, 3.1, UV_SCALE.graniteAshlar);
  // White balustrade (open at center steps lx [-1.5, +1.5])
  for (const bx of [-4.05, -1.65, 1.65, 4.05] as const) {
    batcher.addBox(materials.whiteTrim, 0.24, 0.95, 0.24, bx, 0.52, 4.28, 0);
  }
  batcher.addBox(materials.whiteTrim, 2.3, 0.1, 0.14, -2.85, 0.92, 4.28, 0);
  batcher.addBox(materials.whiteTrim, 2.3, 0.1, 0.14, 2.85, 0.92, 4.28, 0);
  for (const side of [-1, 1] as const) {
    for (let p = 0; p < 5; p++) {
      batcher.addBox(materials.whiteTrim, 0.08, 0.78, 0.08, side * (2.0 + p * 0.42), 0.46, 4.28, 0);
    }
  }
  // Steps down to terrain (every step grounded down below local terrain)
  const stGY = groundLocalY(ctx, 0, 5.3);
  for (let s = 0; s < 3; s++) {
    const syTop = -0.15 - s * 0.2;
    const sz = 4.5 + s * 0.32;
    const localStepGY = Math.min(
      stGY,
      groundLocalY(ctx, -1.4, sz),
      groundLocalY(ctx, 0, sz),
      groundLocalY(ctx, 1.4, sz),
    );
    const syBot = Math.min(syTop - 0.24, localStepGY - 0.45);
    batcher.addWorldSlopeBox(materials.graniteAshlar, 3.1, syTop, syBot, 0.34, 0, sz, UV_SCALE.graniteAshlar);
  }

  // 7. Facade Windows & Shutters
  for (const wy of [2.05, 5.05] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, -4.4, wy, 1.8, 1.2, 1.55, 0, 2, 2, true, materials.whiteTrim, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 4.4, wy, 1.8, 1.2, 1.55, 0, 2, 2, true, materials.whiteTrim, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 6.8, wy, 1.8, 1.2, 1.55, 0, 2, 2, true, materials.whiteTrim, true);
    // Cross-gable front windows
    if (wy > 4.0) {
      addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, -1.1, wy, 3.75, 1.0, 1.45, 0, 2, 2, false, undefined, true);
      addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 1.1, wy, 3.75, 1.0, 1.45, 0, 2, 2, false, undefined, true);
    }
    // Rear windows
    for (const rx of [-5.5, -1.8, 1.8, 5.5] as const) {
      addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, rx, wy, -7.8, 1.15, 1.5, Math.PI, 2, 2, false, undefined, true);
    }
    // East windows
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 8.6, wy, -4.6, 1.15, 1.5, Math.PI * 0.5, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 8.6, wy, -1.4, 1.15, 1.5, Math.PI * 0.5, 2, 2, false, undefined, true);
  }
  // Front entry door
  batcher.addBox(materials.whiteTrim, 1.55, 2.45, 0.14, 0, 1.28, 3.76, 0);
  batcher.addBox(materials.darkIron, 1.25, 2.25, 0.16, 0, 1.22, 3.78, 0);

  // 8. Courtyard Garden: Stone Arch Bridge (lx = -6.4, lz = +7.2) & Tiered Stone Fountain (lx = +6.4, lz = +7.2)
  // Stone Arch Bridge + Pebble Garden Stream
  const brX = -6.4;
  const brZ = 7.2;
  const brGY = groundLocalY(ctx, brX, brZ);
  // Pebble stream bed beneath bridge (flat ground slab, castShadow = false)
  batcher.addWorldSlopeBox(materials.cobblestone, 2.0, brGY + 0.03, brGY - 0.35, 3.6, brX, brZ, UV_SCALE.cobblestone, 0, false);
  batcher.addWorldSlopeBox(materials.windowGlass, 1.35, brGY + 0.055, brGY + 0.02, 3.3, brX, brZ, 0, 0, false);

  // Curved stone arch bridge spanning E-W over the N-S stream (elevated cleanly above stream)
  const archShape = new THREE.Shape();
  archShape.moveTo(-1.9, 0.0);
  archShape.lineTo(-1.9, 0.62);
  archShape.quadraticCurveTo(0, 1.88, 1.9, 0.62);
  archShape.lineTo(1.9, 0.0);
  archShape.lineTo(1.05, 0.0);
  archShape.absarc(0, 0.02, 1.05, 0, Math.PI, false);
  archShape.lineTo(-1.05, 0.0);
  archShape.closePath();

  const archGeo = new THREE.ExtrudeGeometry(archShape, {
    depth: 1.45,
    bevelEnabled: false,
    curveSegments: 16,
  });
  archGeo.translate(0, 0, -0.725);
  applyExtrudeMetricUVs(archGeo, UV_SCALE.graniteAshlar, UV_SCALE.graniteAshlar);
  batcher.add(materials.graniteAshlar, archGeo, new THREE.Matrix4().makeTranslation(brX, brGY + 0.04, brZ), true);
  // Approach abutments sunk into ground
  for (const side of [-1.52, 1.52] as const) {
    batcher.addWorldSlopeBox(materials.graniteAshlar, 0.85, brGY + 0.12, brGY - 0.35, 1.45, brX + side, brZ, UV_SCALE.graniteAshlar);
  }

  // Curved stone bridge parapets seated cleanly on the arch deck + grounded end newel piers
  const parapetShape = new THREE.Shape();
  parapetShape.moveTo(-1.8, 0.56);
  parapetShape.lineTo(-1.8, 1.0);
  parapetShape.quadraticCurveTo(0, 2.24, 1.8, 1.0);
  parapetShape.lineTo(1.8, 0.56);
  parapetShape.quadraticCurveTo(0, 1.65, -1.8, 0.56);
  parapetShape.closePath();

  for (const side of [-0.65, 0.65] as const) {
    const pGeo = new THREE.ExtrudeGeometry(parapetShape, {
      depth: 0.14,
      bevelEnabled: false,
      curveSegments: 16,
    });
    pGeo.translate(0, 0, -0.07);
    applyExtrudeMetricUVs(pGeo, UV_SCALE.graniteAshlar, UV_SCALE.graniteAshlar);
    batcher.add(materials.graniteAshlar, pGeo, new THREE.Matrix4().makeTranslation(brX, brGY + 0.04, brZ + side), true);

    for (const endX of [-1.8, 1.8] as const) {
      batcher.addWorldSlopeBox(materials.graniteAshlar, 0.26, brGY + 1.14, brGY - 0.35, 0.24, brX + endX, brZ + side, UV_SCALE.graniteAshlar);
      batcher.addBox(materials.curbStone, 0.3, 0.08, 0.28, brX + endX, brGY + 1.18, brZ + side, UV_SCALE.curbStone);
    }
  }

  // Tiered Stone Fountain (lx = +6.4, lz = +7.2)
  const fnX = 6.4;
  const fnZ = 7.2;
  const fnGY = groundLocalY(ctx, fnX, fnZ);
  // Outer stone rim (base sunk into ground)
  const rimBot = fnGY - 0.35;
  const rimH = 0.72;
  const rimOuter = new THREE.CylinderGeometry(1.55, 1.62, rimH, 20);
  scaleGeometryUVs(rimOuter, 2 * Math.PI * 1.55 * UV_SCALE.graniteAshlar, rimH * UV_SCALE.graniteAshlar);
  batcher.add(materials.graniteAshlar, rimOuter, new THREE.Matrix4().makeTranslation(fnX, rimBot + rimH * 0.5, fnZ), true);
  // Reflective water surface
  const waterDisc = new THREE.CylinderGeometry(1.36, 1.36, 0.06, 20);
  batcher.add(materials.windowGlass, waterDisc, new THREE.Matrix4().makeTranslation(fnX, fnGY + 0.32, fnZ), false);
  // Central pedestal & upper bowl
  const pedGeo = new THREE.CylinderGeometry(0.24, 0.38, 1.15, 14);
  batcher.add(materials.graniteAshlar, pedGeo, new THREE.Matrix4().makeTranslation(fnX, fnGY + 0.72, fnZ), true);
  const bowlGeo = new THREE.CylinderGeometry(0.75, 0.32, 0.28, 16);
  batcher.add(materials.graniteAshlar, bowlGeo, new THREE.Matrix4().makeTranslation(fnX, fnGY + 1.32, fnZ), true);
  const topFinGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.42, 12);
  batcher.add(materials.graniteAshlar, topFinGeo, new THREE.Matrix4().makeTranslation(fnX, fnGY + 1.62, fnZ), true);

  batcher.flush(group, parcel.id, materials, disposableGeometries);

  // 9. Colliders
  colliders.push(localBoxToCollider(parcel, 'princess_main', 'building', -9.6, 8.8, -8.1, 4.55));
  colliders.push(localBoxToCollider(parcel, 'princess_bridge', 'prop', brX - 2.0, brX + 2.0, brZ - 1.1, brZ + 1.1));
  colliders.push(localBoxToCollider(parcel, 'princess_fountain', 'prop', fnX - 1.65, fnX + 1.65, fnZ - 1.65, fnZ + 1.65));

  return group;
}
