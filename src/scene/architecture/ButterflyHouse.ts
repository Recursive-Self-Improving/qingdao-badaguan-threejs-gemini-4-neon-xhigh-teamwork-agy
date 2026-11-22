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
} from '../Architecture';

function addGambrelEndWall(
  batcher: MaterialBatcher,
  wallMat: THREE.Material,
  trimMat: THREE.Material,
  cx: number,
  eaveY: number,
  cz: number,
  halfSpan: number,
  kneeSpan: number,
  kneeY: number,
  ridgeY: number,
  depth: number,
  rotY: number,
): void {
  const hKnee = kneeY - eaveY;
  const hRidge = ridgeY - eaveY;
  const shape = new THREE.Shape();
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(-kneeSpan, hKnee);
  shape.lineTo(0, hRidge);
  shape.lineTo(kneeSpan, hKnee);
  shape.lineTo(halfSpan, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth * 0.5);
  applyExtrudeMetricUVs(geo, UV_SCALE.stucco, UV_SCALE.stucco);

  const baseMat = new THREE.Matrix4().compose(
    new THREE.Vector3(cx, eaveY, cz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  batcher.add(wallMat, geo, baseMat, true);

  // Gambrel bargeboard trim tucked cleanly beneath the terracotta roof slab
  const pushSegTrim = (ax: number, ay: number, bx: number, by: number): void => {
    const len = Math.hypot(bx - ax, by - ay);
    const ang = Math.atan2(by - ay, bx - ax);
    const g = new THREE.BoxGeometry(len, 0.1, 0.07);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((ax + bx) * 0.5, (ay + by) * 0.5 - 0.16, depth * 0.5 + 0.035),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)),
      new THREE.Vector3(1, 1, 1),
    );
    m.premultiply(baseMat);
    batcher.add(trimMat, g, m, true);
  };
  pushSegTrim(-halfSpan + 0.05, 0.0, -kneeSpan, hKnee);
  pushSegTrim(-kneeSpan, hKnee, 0, hRidge);
  pushSegTrim(0, hRidge, kneeSpan, hKnee);
  pushSegTrim(kneeSpan, hKnee, halfSpan - 0.05, 0.0);
}

function addArchPortal(
  batcher: MaterialBatcher,
  trimMat: THREE.Material,
  glassMat: THREE.Material,
  cx: number,
  baseY: number,
  cz: number,
  w: number,
  h: number,
): void {
  const archR = w * 0.5;
  const springH = Math.max(0.4, h - archR);

  // Recessed glazed door leaf
  const gShape = new THREE.Shape();
  gShape.moveTo(-archR * 0.84, 0);
  gShape.lineTo(-archR * 0.84, springH);
  gShape.absarc(0, springH, archR * 0.84, Math.PI, 0, true);
  gShape.lineTo(archR * 0.84, 0);
  gShape.closePath();

  const gGeo = new THREE.ExtrudeGeometry(gShape, { depth: 0.036, bevelEnabled: false, curveSegments: 12 });
  batcher.add(glassMat, gGeo, new THREE.Matrix4().makeTranslation(cx, baseY, cz - 0.008), false);

  // White arch surround proud at +0.07m
  const outerR = archR + 0.11;
  const fShape = new THREE.Shape();
  fShape.moveTo(-outerR, 0);
  fShape.lineTo(-outerR, springH);
  fShape.absarc(0, springH, outerR, Math.PI, 0, true);
  fShape.lineTo(outerR, 0);
  fShape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-archR * 0.84, 0.02);
  hole.lineTo(archR * 0.84, 0.02);
  hole.lineTo(archR * 0.84, springH);
  hole.absarc(0, springH, archR * 0.84, 0, Math.PI, false);
  hole.closePath();
  fShape.holes.push(hole);

  const fGeo = new THREE.ExtrudeGeometry(fShape, { depth: 0.09, bevelEnabled: false, curveSegments: 12 });
  batcher.add(trimMat, fGeo, new THREE.Matrix4().makeTranslation(cx, baseY, cz - 0.015), true);
  // Center vertical door stile
  batcher.addBox(trimMat, 0.045, h - 0.18, 0.034, cx, baseY + (h - 0.14) * 0.5, cz + 0.034, 0, 0, 0, 0, false);
}

export function buildButterflyHouse(
  parcel: VillaParcel,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  disposableGeometries: THREE.BufferGeometry[],
): THREE.Group {
  const ctx = createParcelContext(parcel, 0.42, 9.2, 6.8);
  const group = new THREE.Group();
  group.name = parcel.id;
  group.position.set(parcel.x, ctx.datumY, parcel.z);
  group.rotation.y = parcel.facingYaw;

  const batcher = new MaterialBatcher();
  const roseStucco = getStucco('#BA5D52');
  const bot = ctx.skirtBottomLocalY;

  // 1. Courtyard enclosure (granite ashlar + dark iron + open 3.6m south gate on Shanhaiguan Rd)
  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.graniteAshlar,
    wallUvScale: UV_SCALE.graniteAshlar,
    capMaterial: materials.graniteAshlar,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.8,
    wallHeightAboveGround: 0.68,
    railHeight: 0.48,
    pierHeightAboveGround: 1.32,
    walkEndLZ: 6.4,
    inset: 0.45,
  });

  // 2. Main 2-story Sino-Russian Villa Body (lx [-7.4, +7.4], lz [-4.6, +4.6])
  const mainW = 14.8;
  const mainD = 9.2;
  const plinthTop = 0.24;
  const eaveY = 6.38;

  // Granite ashlar plinth sunk deep
  batcher.addWorldSlopeBox(materials.graniteAshlar, mainW + 0.26, plinthTop, bot, mainD + 0.26, 0, 0, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.whiteTrim, mainW + 0.34, 0.12, mainD + 0.34, 0, plinthTop + 0.04, 0, 0);

  // Rose-terracotta stucco body
  batcher.addWorldSlopeBox(roseStucco, mainW, eaveY, plinthTop + 0.08, mainD, 0, 0, UV_SCALE.stucco);

  // Projecting south-central gable wing (lx [-3.9, +3.9], lz [+4.6, +5.65])
  const sWingW = 7.8;
  batcher.addWorldSlopeBox(materials.graniteAshlar, sWingW + 0.2, plinthTop, bot, 1.2, 0, 5.1, UV_SCALE.graniteAshlar);
  batcher.addWorldSlopeBox(roseStucco, sWingW, eaveY, plinthTop + 0.08, 1.15, 0, 5.1, UV_SCALE.stucco);

  // Staggered white corner quoins
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const qx = sx * (mainW * 0.5);
      const qz = sz * (mainD * 0.5);
      for (let i = 0; i < 16; i++) {
        const qy = plinthTop + 0.28 + i * 0.37;
        const wideX = i % 2 === 0;
        batcher.addBox(
          materials.whiteTrim,
          wideX ? 0.54 : 0.34,
          0.32,
          wideX ? 0.34 : 0.54,
          qx - sx * (wideX ? 0.21 : 0.11),
          qy,
          qz - sz * (wideX ? 0.11 : 0.21),
          0,
        );
      }
    }
  }

  // Belt courses & eaves fascia
  batcher.addBox(materials.whiteTrim, mainW + 0.16, 0.14, mainD + 0.16, 0, 3.38, 0, 0);
  batcher.addBox(materials.whiteTrim, sWingW + 0.16, 0.14, 1.3, 0, 3.38, 5.1, 0);
  batcher.addBox(materials.whiteTrim, mainW + 0.24, 0.18, mainD + 0.24, 0, eaveY - 0.06, 0, 0);

  // 3. Signature Intersecting Dual Gambrel Roofs (ZERO Z-fighting!)
  // Primary E-W gambrel: x [-7.85, +7.85], eave z=±5.05 (y=6.35), knee z=±3.15 (y=8.18), ridge z=0 (y=9.75)
  const pX0 = -7.85;
  const pX1 = 7.85;
  const pEaveZ = 5.05;
  const pKneeZ = 3.15;
  const pEaveY = 6.35;
  const pKneeY = 8.18;
  const pRidgeY = 9.75;

  addPitchedSlopeSlab(batcher, materials.terracottaRoof, pX0, pX1, pEaveZ, pEaveY, pKneeZ, pKneeY, 0.15, UV_SCALE.terracottaRoof);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, pX0, pX1, pKneeZ, pKneeY, 0, pRidgeY, 0.15, UV_SCALE.terracottaRoof);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, pX0, pX1, -pEaveZ, pEaveY, -pKneeZ, pKneeY, 0.15, UV_SCALE.terracottaRoof);
  addPitchedSlopeSlab(batcher, materials.terracottaRoof, pX0, pX1, -pKneeZ, pKneeY, 0, pRidgeY, 0.15, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.terracottaRoof, pX1 - pX0 + 0.04, 0.2, 0.24, 0, pRidgeY + 0.04, 0, UV_SCALE.terracottaRoof);

  // E & W gambrel end walls (inset inside overhangs)
  addGambrelEndWall(batcher, roseStucco, materials.whiteTrim, -7.22, pEaveY - 0.04, 0, mainD * 0.5, pKneeZ, pKneeY - 0.04, pRidgeY - 0.04, 0.36, -Math.PI * 0.5);
  addGambrelEndWall(batcher, roseStucco, materials.whiteTrim, 7.22, pEaveY - 0.04, 0, mainD * 0.5, pKneeZ, pKneeY - 0.04, pRidgeY - 0.04, 0.36, Math.PI * 0.5);

  // Secondary N-S cross-gambrel: z [-5.0, +6.05], ridge 0.17m LOWER (9.58m) -> zero coplanar intersections!
  const cZ0 = -5.05;
  const cZ1 = 6.05;
  const cEaveX = 4.2;
  const cKneeX = 2.55;
  const cEaveY = 6.26;
  const cKneeY = 8.02;
  const cRidgeY = 9.58;

  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cZ0, cZ1, -cEaveX, cEaveY, -cKneeX, cKneeY, 0.15, UV_SCALE.terracottaRoof);
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cZ0, cZ1, -cKneeX, cKneeY, 0, cRidgeY, 0.15, UV_SCALE.terracottaRoof);
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cZ0, cZ1, cEaveX, cEaveY, cKneeX, cKneeY, 0.15, UV_SCALE.terracottaRoof);
  addXPitchedSlopeSlab(batcher, materials.terracottaRoof, cZ0, cZ1, cKneeX, cKneeY, 0, cRidgeY, 0.15, UV_SCALE.terracottaRoof);
  batcher.addBox(materials.terracottaRoof, 0.22, 0.2, cZ1 - cZ0 + 0.04, 0, cRidgeY + 0.04, (cZ0 + cZ1) * 0.5, UV_SCALE.terracottaRoof);

  // N & S cross-gambrel end walls
  addGambrelEndWall(batcher, roseStucco, materials.whiteTrim, 0, cEaveY - 0.04, 5.5, sWingW * 0.5, cKneeX, cKneeY - 0.04, cRidgeY - 0.04, 0.36, 0);
  addGambrelEndWall(batcher, roseStucco, materials.whiteTrim, 0, cEaveY - 0.04, -4.42, sWingW * 0.5, cKneeX, cKneeY - 0.04, cRidgeY - 0.04, 0.36, Math.PI);

  // Brick chimney piercing rear roof slope
  batcher.addWorldSlopeBox(materials.brick, 0.85, 10.65, 7.2, 0.85, -4.6, -2.1, UV_SCALE.brick);
  batcher.addBox(materials.graniteAshlar, 1.0, 0.14, 1.0, -4.6, 10.72, -2.1, UV_SCALE.graniteAshlar);

  // 4. West (-X) Columned Portico + Upper Balustraded Terrace (lx [-10.3, -7.4], lz [-3.2, +3.2])
  batcher.addWorldSlopeBox(materials.graniteAshlar, 2.9, 0.0, bot, 6.4, -8.85, 0, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.graniteAshlar, 3.0, 0.1, 6.5, -8.85, 0.02, 0, UV_SCALE.graniteAshlar);
  // 3 West entry steps (all steps grounded solidly below local terrain)
  const westGY = groundLocalY(ctx, -10.8, 0);
  for (let s = 0; s < 3; s++) {
    const syTop = -0.14 - s * 0.18;
    const sx = -10.45 - s * 0.32;
    const localStepGY = Math.min(
      westGY,
      groundLocalY(ctx, sx, -1.2),
      groundLocalY(ctx, sx, 0),
      groundLocalY(ctx, sx, 1.2),
    );
    const syBot = Math.min(syTop - 0.22, localStepGY - 0.45);
    batcher.addWorldSlopeBox(materials.graniteAshlar, 0.34, syTop, syBot, 2.6, sx, 0, UV_SCALE.graniteAshlar);
  }
  // 4 Tuscan columns supporting 2F terrace deck
  for (const cz of [-2.85, -0.95, 0.95, 2.85] as const) {
    batcher.addBox(materials.whiteTrim, 0.48, 0.18, 0.48, -9.95, 0.14, cz, 0);
    const colGeo = new THREE.CylinderGeometry(0.16, 0.2, 2.9, 14);
    batcher.add(materials.whiteTrim, colGeo, new THREE.Matrix4().makeTranslation(-9.95, 1.68, cz), true);
    batcher.addBox(materials.whiteTrim, 0.48, 0.18, 0.48, -9.95, 3.22, cz, 0);
  }
  // 2F open terrace slab + balustrade
  batcher.addBox(materials.whiteTrim, 3.05, 0.22, 6.55, -8.9, 3.42, 0, 0);
  for (const bz of [-3.1, -1.05, 1.05, 3.1] as const) {
    batcher.addBox(materials.whiteTrim, 0.2, 0.92, 0.2, -10.22, 3.98, bz, 0);
  }
  batcher.addBox(materials.whiteTrim, 0.14, 0.1, 6.3, -10.22, 4.38, 0, 0);
  batcher.addBox(materials.whiteTrim, 2.9, 0.1, 0.14, -8.85, 4.38, -3.1, 0);
  batcher.addBox(materials.whiteTrim, 2.9, 0.1, 0.14, -8.85, 4.38, 3.1, 0);
  for (let p = -6; p <= 6; p++) {
    batcher.addBox(materials.whiteTrim, 0.07, 0.78, 0.07, -10.22, 3.92, p * 0.46, 0);
  }
  for (const sz of [-3.1, 3.1] as const) {
    for (let px = -9.8; px <= -7.8; px += 0.45) {
      batcher.addBox(materials.whiteTrim, 0.07, 0.78, 0.07, px, 3.92, sz, 0);
    }
  }
  // 2F French door to west terrace
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, -7.4, 4.55, 0, 1.45, 2.15, -Math.PI * 0.5, 2, 3, false, undefined, true);

  // 5. South (+Z) Facade with 3 Arched Openings + Entry Terrace & Steps
  batcher.addWorldSlopeBox(materials.graniteAshlar, 8.4, 0.0, bot, 1.8, 0, 6.2, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.graniteAshlar, 8.5, 0.1, 1.9, 0, 0.02, 6.2, UV_SCALE.graniteAshlar);
  const southGY = groundLocalY(ctx, 0, 7.6);
  for (let s = 0; s < 3; s++) {
    const syTop = -0.14 - s * 0.18;
    const sz = 7.15 + s * 0.32;
    const localStepGY = Math.min(
      southGY,
      groundLocalY(ctx, -1.6, sz),
      groundLocalY(ctx, 0, sz),
      groundLocalY(ctx, 1.6, sz),
    );
    const syBot = Math.min(syTop - 0.22, localStepGY - 0.45);
    batcher.addWorldSlopeBox(materials.graniteAshlar, 3.4, syTop, syBot, 0.34, 0, sz, UV_SCALE.graniteAshlar);
  }
  // 3 Arched openings on south center wing
  for (const ax of [-2.15, 0, 2.15] as const) {
    addArchPortal(batcher, materials.whiteTrim, materials.windowGlass, ax, 0.12, 5.68, 1.45, 2.55);
  }
  // South 1F flanking & 2F windows
  for (const wx of [-5.6, 5.6] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 1.85, 4.6, 1.25, 1.65, 0, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 4.85, 4.6, 1.25, 1.55, 0, 2, 2, false, undefined, true);
  }
  for (const wx of [-1.8, 0, 1.8] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 4.85, 5.68, 1.15, 1.55, 0, 2, 2, false, undefined, true);
  }
  // Attic gable window on south cross-gambrel
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 0, 7.45, 5.68, 1.05, 1.2, 0, 2, 2, false, undefined, true);

  // Rear (-Z) windows
  for (const wx of [-5.2, -1.8, 1.8, 5.2] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 1.85, -4.6, 1.15, 1.55, Math.PI, 2, 2, false, undefined, true);
    addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, wx, 4.85, -4.6, 1.15, 1.55, Math.PI, 2, 2, false, undefined, true);
  }

  // 6. Semicircular East-End (+X / SE) 2F Balcony (lx = +7.4, lz = +2.0, r = 2.15m)
  // Unified flush slab seamlessly connecting to the 2F east stair landing (z = -1.15..+0.48)
  const balX = 7.4;
  const balZ = 2.0;
  const balR = 2.15;
  const balY = 3.38;
  const balTopY = balY + 0.11; // 3.49m
  const joinAng = -Math.PI * 0.25;
  const joinOffX = Math.cos(joinAng) * balR; // +1.520
  const joinWorldZ = balZ + Math.sin(joinAng) * balR; // 0.480
  const landingStartZ = -1.15;
  const landingOffZ = landingStartZ - balZ; // -3.15

  const balShape = new THREE.Shape();
  balShape.moveTo(0, balR);
  balShape.absarc(0, 0, balR, Math.PI * 0.5, joinAng, true);
  balShape.lineTo(joinOffX, landingOffZ);
  balShape.lineTo(0, landingOffZ);
  balShape.closePath();

  const balGeo = new THREE.ExtrudeGeometry(balShape, { depth: 0.22, bevelEnabled: false, curveSegments: 16 });
  balGeo.rotateX(Math.PI * 0.5);
  batcher.add(materials.whiteTrim, balGeo, new THREE.Matrix4().makeTranslation(balX, balTopY, balZ), true);

  const soffitDisc = new THREE.CylinderGeometry(balR * 0.85, balR * 0.5, 0.25, 16, 1, false, 0, Math.PI * 0.75);
  batcher.add(materials.whiteTrim, soffitDisc, new THREE.Matrix4().makeTranslation(balX, balY - 0.22, balZ), true);

  // Curved iron balcony railing open on the north landing side (a from -PI/4 to +PI/2)
  const railR = balR - 0.12;
  const joinRailX = balX + Math.cos(joinAng) * railR; // 8.835
  const joinRailZ = balZ + Math.sin(joinAng) * railR; // 0.565
  const segs = 8;
  for (let i = 0; i <= segs; i++) {
    const a = joinAng + (i / segs) * (Math.PI * 0.5 - joinAng);
    const px = balX + Math.cos(a) * railR;
    const pz = balZ + Math.sin(a) * railR;
    batcher.addBox(materials.darkIron, 0.045, 0.92, 0.045, px, balY + 0.57, pz, 0);
    if (i < segs) {
      const aNext = joinAng + ((i + 1) / segs) * (Math.PI * 0.5 - joinAng);
      const nx = balX + Math.cos(aNext) * railR;
      const nz = balZ + Math.sin(aNext) * railR;
      const slen = Math.hypot(nx - px, nz - pz);
      const srot = Math.atan2(nx - px, nz - pz);
      batcher.addBox(materials.darkIron, 0.05, 0.05, slen + 0.03, (px + nx) * 0.5, balY + 1.03, (pz + nz) * 0.5, 0, 0, srot, 0);
      batcher.addBox(materials.darkIron, 0.035, 0.035, slen + 0.03, (px + nx) * 0.5, balY + 0.24, (pz + nz) * 0.5, 0, 0, srot, 0);
    }
  }
  // 2F Balcony door
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 7.4, 4.65, balZ, 1.35, 2.2, Math.PI * 0.5, 2, 3, false, undefined, true);

  // 7. Exterior East (+X) Staircase (lx [+7.4, +8.9], lz [-4.2, -1.15]) ascending flush to 2F balcony landing
  const stX = 8.15;
  const stBaseGY = groundLocalY(ctx, stX, -4.3);
  // Solid granite support masonry beneath landing neck (z [-1.15, +0.48]) sunk below terrain
  batcher.addWorldSlopeBox(
    materials.graniteAshlar,
    1.5,
    balTopY - 0.22,
    bot,
    joinWorldZ - landingStartZ,
    stX,
    (landingStartZ + joinWorldZ) * 0.5,
    UV_SCALE.graniteAshlar,
  );

  // Landing outer dark-iron balustrade seamlessly bridging top stair rail to curved balcony rail
  const landRailLen = joinRailZ - landingStartZ;
  const landRailMidZ = (landingStartZ + joinRailZ) * 0.5;
  batcher.addBox(materials.darkIron, 0.05, 0.05, landRailLen + 0.04, joinRailX, balY + 1.03, landRailMidZ, 0);
  batcher.addBox(materials.darkIron, 0.035, 0.035, landRailLen + 0.04, joinRailX, balY + 0.24, landRailMidZ, 0);
  for (const lz of [landingStartZ, landingStartZ + landRailLen * 0.5] as const) {
    batcher.addBox(materials.darkIron, 0.045, 0.92, 0.045, joinRailX, balY + 0.57, lz, 0);
  }

  // Stepped granite stringer wall sunk below ground
  const treads = 12;
  const zStart = -4.2;
  const zEnd = landingStartZ;
  const yStart = stBaseGY + 0.14;
  const yEnd = balTopY;
  for (let t = 0; t < treads; t++) {
    const f0 = t / treads;
    const f1 = (t + 1) / treads;
    const tz = zStart + (zEnd - zStart) * ((f0 + f1) * 0.5);
    const ty = yStart + (yEnd - yStart) * f1;
    const treadDepth = (zEnd - zStart) / treads + 0.06;
    batcher.addWorldSlopeBox(
      materials.graniteAshlar,
      1.5,
      ty,
      bot,
      treadDepth,
      stX,
      tz,
      UV_SCALE.graniteAshlar,
    );
  }
  // Sloped dark-iron handrail along outer stair edge meeting landing handrail at (joinRailX, balY + 1.03, landingStartZ)
  const railSpanZ = zEnd - zStart;
  const railSpanY = yEnd - yStart;
  const railLen = Math.hypot(railSpanZ, railSpanY);
  const railAngle = Math.atan2(railSpanY, railSpanZ);
  batcher.addBox(
    materials.darkIron,
    0.05,
    0.05,
    railLen + 0.16,
    joinRailX,
    (yStart + yEnd) * 0.5 + 0.92,
    (zStart + zEnd) * 0.5,
    0,
    -railAngle,
    0,
    0,
  );
  for (let p = 0; p < 6; p++) {
    const f = p / 6;
    const pz = zStart + railSpanZ * f;
    const py = yStart + railSpanY * f;
    batcher.addBox(materials.darkIron, 0.04, 0.92, 0.04, joinRailX, py + 0.46, pz, 0);
  }

  // East 1F window under/near stair
  addWindowUnit(batcher, materials.windowGlass, materials.whiteTrim, 7.4, 1.85, 2.2, 1.15, 1.45, Math.PI * 0.5, 2, 2, false, undefined, true);

  batcher.flush(group, parcel.id, materials, disposableGeometries);

  // 8. Colliders
  colliders.push(localBoxToCollider(parcel, 'butterfly_main', 'building', -11.0, 9.6, -5.0, 6.2));
  colliders.push(localBoxToCollider(parcel, 'butterfly_steps', 'building', -2.0, 2.0, 6.0, 7.8));

  return group;
}
