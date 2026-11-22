import * as THREE from 'three';
import { ColliderBox, VillaParcel } from '../DistrictLayout';
import { ProceduralMaterialSet } from '../ProceduralMaterials';
import {
  MaterialBatcher,
  UV_SCALE,
  addColliderSpan,
  addCourtyardEnclosure,
  addWindowUnit,
  applyExtrudeMetricUVs,
  createParcelContext,
  groundLocalY,
  localBoxToCollider,
  scaleGeometryUVs,
} from '../Architecture';

function addArchBay(
  batcher: MaterialBatcher,
  mat: THREE.Material,
  cx: number,
  baseY: number,
  cz: number,
  bayWidth: number,
  springHeight: number,
  archRadius: number,
  thickness: number,
  uvScale: number,
): void {
  const halfW = bayWidth * 0.5;
  const totalH = springHeight + archRadius + 0.38;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(-halfW, totalH);
  shape.lineTo(halfW, totalH);
  shape.lineTo(halfW, 0);
  shape.lineTo(archRadius, 0);
  shape.lineTo(archRadius, springHeight);
  shape.absarc(0, springHeight, archRadius, 0, Math.PI, false);
  shape.lineTo(-archRadius, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 14,
  });
  geo.translate(0, 0, -thickness * 0.5);
  applyExtrudeMetricUVs(geo, uvScale, uvScale);
  const m = new THREE.Matrix4().makeTranslation(cx, baseY, cz);
  batcher.add(mat, geo, m, true);
}

function addColumn(
  batcher: MaterialBatcher,
  stoneMat: THREE.Material,
  capMat: THREE.Material,
  cx: number,
  baseY: number,
  cz: number,
  height: number,
  radius: number,
): void {
  // Square plinth base
  batcher.addBox(capMat, radius * 2.7, 0.2, radius * 2.7, cx, baseY + 0.1, cz, UV_SCALE.curbStone);
  // Shaft
  const shaftH = Math.max(0.4, height - 0.42);
  const shaft = new THREE.CylinderGeometry(radius * 0.9, radius, shaftH, 12);
  scaleGeometryUVs(shaft, 2 * Math.PI * radius * UV_SCALE.graniteAshlar, shaftH * UV_SCALE.graniteAshlar);
  batcher.add(
    stoneMat,
    shaft,
    new THREE.Matrix4().makeTranslation(cx, baseY + 0.2 + shaftH * 0.5, cz),
    true,
  );
  // Capital
  batcher.addBox(capMat, radius * 2.8, 0.22, radius * 2.8, cx, baseY + height - 0.11, cz, UV_SCALE.curbStone);
}

function addArchedWindow(
  batcher: MaterialBatcher,
  glassMat: THREE.Material,
  frameMat: THREE.Material,
  cx: number,
  baseY: number,
  cz: number,
  w: number,
  h: number,
  rotY: number,
): void {
  const rotMat = new THREE.Matrix4().makeRotationY(rotY);
  const posMat = new THREE.Matrix4().makeTranslation(cx, baseY, cz);
  const baseMat = new THREE.Matrix4().multiplyMatrices(posMat, rotMat);

  const archR = w * 0.5;
  const rectH = Math.max(0.4, h - archR);

  // Stained or window glass pane (extruded arch)
  const gShape = new THREE.Shape();
  gShape.moveTo(-archR * 0.86, 0);
  gShape.lineTo(-archR * 0.86, rectH);
  gShape.absarc(0, rectH, archR * 0.86, Math.PI, 0, true);
  gShape.lineTo(archR * 0.86, 0);
  gShape.closePath();

  const glassGeo = new THREE.ExtrudeGeometry(gShape, {
    depth: 0.036,
    bevelEnabled: false,
    curveSegments: 12,
  });
  // Normalize glass UV into [0,1] so leaded stained glass diamond grid fits cleanly
  const uv = glassGeo.getAttribute('uv');
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) + archR) / Math.max(0.1, w), uv.getY(i) / Math.max(0.1, h));
    }
    uv.needsUpdate = true;
  }
  const glassM = new THREE.Matrix4().makeTranslation(0, 0, -0.008);
  glassM.premultiply(baseMat);
  batcher.add(glassMat, glassGeo, glassM, false);

  // Stone/trim arched outer casing proud at +0.065
  const fShape = new THREE.Shape();
  const outerR = archR + 0.09;
  fShape.moveTo(-outerR, -0.06);
  fShape.lineTo(-outerR, rectH);
  fShape.absarc(0, rectH, outerR, Math.PI, 0, true);
  fShape.lineTo(outerR, -0.06);
  fShape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-archR * 0.86, 0.02);
  hole.lineTo(archR * 0.86, 0.02);
  hole.lineTo(archR * 0.86, rectH);
  hole.absarc(0, rectH, archR * 0.86, 0, Math.PI, false);
  hole.closePath();
  fShape.holes.push(hole);

  const frameGeo = new THREE.ExtrudeGeometry(fShape, {
    depth: 0.085,
    bevelEnabled: false,
    curveSegments: 12,
  });
  applyExtrudeMetricUVs(frameGeo, UV_SCALE.curbStone, UV_SCALE.curbStone);
  const frameM = new THREE.Matrix4().makeTranslation(0, 0, -0.015);
  frameM.premultiply(baseMat);
  batcher.add(frameMat, frameGeo, frameM, true);

  // Sill & center mullion
  const sillGeo = new THREE.BoxGeometry(w + 0.24, 0.1, 0.13);
  const sillM = new THREE.Matrix4().makeTranslation(0, -0.03, 0.04);
  sillM.premultiply(baseMat);
  batcher.add(frameMat, sillGeo, sillM, true);

  const mullGeo = new THREE.BoxGeometry(0.04, h - 0.15, 0.032);
  const mullM = new THREE.Matrix4().makeTranslation(0, (h - 0.12) * 0.5, 0.032);
  mullM.premultiply(baseMat);
  batcher.add(frameMat, mullGeo, mullM, false);
}

export function buildHuashiBuilding(
  parcel: VillaParcel,
  materials: ProceduralMaterialSet,
  colliders: ColliderBox[],
  disposableGeometries: THREE.BufferGeometry[],
): THREE.Group {
  const ctx = createParcelContext(parcel, 0.55, 9.2, 7.6);
  const group = new THREE.Group();
  group.name = parcel.id;
  group.position.set(parcel.x, ctx.datumY, parcel.z);
  group.rotation.y = parcel.facingYaw;

  const batcher = new MaterialBatcher();
  const bot = ctx.skirtBottomLocalY;

  // 1. Courtyard enclosure (mushroom stone + wrought iron + open 3.6m gate facing Huanghai Rd)
  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.mushroomStone,
    wallUvScale: UV_SCALE.mushroomStone,
    capMaterial: materials.curbStone,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.85,
    wallHeightAboveGround: 0.72,
    railHeight: 0.45,
    pierHeightAboveGround: 1.38,
    walkEndLZ: 7.9,
    inset: 0.45,
  });

  // 2. Raised granite sea terrace (lx [-8.4, +8.2], lz [+3.8, +7.2]) sunk deep below lowest cape corner
  const terBot = bot;
  batcher.addWorldSlopeBox(
    materials.mushroomStone,
    16.6,
    -0.06,
    terBot,
    3.4,
    -0.1,
    5.5,
    UV_SCALE.mushroomStone,
  );
  batcher.addBox(
    materials.graniteAshlar,
    16.75,
    0.12,
    3.52,
    -0.1,
    -0.02,
    5.5,
    UV_SCALE.graniteAshlar,
  );

  // Terrace stone balustrade & corner piers (open at center entry lx [-2.0, +2.0])
  const paraH = 0.88;
  for (const [px, pz] of [
    [-8.2, 7.0],
    [-2.15, 7.0],
    [2.15, 7.0],
    [8.0, 7.0],
    [8.0, 3.9],
  ] as const) {
    batcher.addBox(materials.graniteAshlar, 0.44, paraH + 0.14, 0.44, px, (paraH + 0.14) * 0.5, pz, UV_SCALE.graniteAshlar);
    batcher.addBox(materials.curbStone, 0.52, 0.08, 0.52, px, paraH + 0.18, pz, UV_SCALE.curbStone);
  }
  // West & East balustrade walls
  batcher.addBox(materials.graniteAshlar, 5.8, paraH, 0.28, -5.2, paraH * 0.5, 7.0, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.curbStone, 5.9, 0.08, 0.36, -5.2, paraH + 0.04, 7.0, UV_SCALE.curbStone);
  batcher.addBox(materials.graniteAshlar, 5.5, paraH, 0.28, 5.05, paraH * 0.5, 7.0, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.curbStone, 5.6, 0.08, 0.36, 5.05, paraH + 0.04, 7.0, UV_SCALE.curbStone);
  batcher.addBox(materials.graniteAshlar, 0.28, paraH, 3.0, 8.0, paraH * 0.5, 5.45, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.curbStone, 0.36, 0.08, 3.1, 8.0, paraH + 0.04, 5.45, UV_SCALE.curbStone);

  // Granite entry steps descending from terrace (lz = 7.2 -> 8.35) cleanly into cape terrain
  const stepEndGroundY = Math.min(
    groundLocalY(ctx, -1.9, 8.4),
    groundLocalY(ctx, 0, 8.4),
    groundLocalY(ctx, 1.9, 8.4),
  );
  const stepCount = 5;
  const stepDepth = 0.26;
  const stepDrop = Math.max(0.75, -stepEndGroundY + 0.15);
  for (let s = 0; s < stepCount; s++) {
    const syTop = -((s + 1) / stepCount) * (stepDrop - 0.15);
    const sz = 7.2 + (s + 0.5) * stepDepth;
    const localStepGY = Math.min(
      stepEndGroundY,
      groundLocalY(ctx, -1.9, sz),
      groundLocalY(ctx, 0, sz),
      groundLocalY(ctx, 1.9, sz),
    );
    const syBot = Math.min(syTop - 0.26, localStepGY - 0.45);
    batcher.addWorldSlopeBox(materials.graniteAshlar, 4.0, syTop, syBot, stepDepth + 0.04, 0, sz, UV_SCALE.graniteAshlar);
  }
  // Step cheek walls
  for (const side of [-1, 1] as const) {
    batcher.addWorldSlopeBox(
      materials.mushroomStone,
      0.38,
      0.42,
      stepEndGroundY - 0.45,
      1.45,
      side * 2.15,
      7.85,
      UV_SCALE.mushroomStone,
    );
    batcher.addBox(materials.curbStone, 0.44, 0.08, 1.5, side * 2.15, 0.46, 7.85, UV_SCALE.curbStone);
  }

  // 3. 5-Story Russian-Eclectic Castle Main Block (lx [-6.8, +5.8], lz [-6.4, +3.8])
  const mainW = 12.6;
  const mainD = 10.2;
  const mainCX = -0.5;
  const mainCZ = -1.3;

  // Story 1 rusticated mushroom-stone podium (bot -> +3.4m)
  batcher.addWorldSlopeBox(materials.mushroomStone, mainW + 0.24, 3.4, bot, mainD + 0.24, mainCX, mainCZ, UV_SCALE.mushroomStone);
  // Belt course
  batcher.addBox(materials.curbStone, mainW + 0.42, 0.26, mainD + 0.42, mainCX, 3.53, mainCZ, UV_SCALE.curbStone);

  // Stories 2-5 granite ashlar block (3.66 -> 14.8m)
  batcher.addWorldSlopeBox(materials.graniteAshlar, mainW, 14.8, 3.66, mainD, mainCX, mainCZ, UV_SCALE.graniteAshlar);

  // Roof deck slab
  batcher.addBox(materials.curbStone, mainW + 0.1, 0.2, mainD + 0.1, mainCX, 14.75, mainCZ, UV_SCALE.curbStone);

  // Horizontal stringcourses at floors 3, 4, 5
  for (const fy of [6.6, 9.6, 12.5, 14.7]) {
    batcher.addBox(materials.curbStone, mainW + 0.22, 0.18, mainD + 0.22, mainCX, fy, mainCZ, UV_SCALE.curbStone);
  }

  // Mushroom-stone corner quoins on NE, SE, NW corners (SW has circular turret)
  for (const [qx, qz] of [
    [mainCX - mainW * 0.5, mainCZ - mainD * 0.5],
    [mainCX + mainW * 0.5, mainCZ - mainD * 0.5],
    [mainCX + mainW * 0.5, mainCZ + mainD * 0.5],
  ] as const) {
    for (let y = 4.0; y < 14.4; y += 0.72) {
      const longX = Math.floor(y / 0.72) % 2 === 0;
      batcher.addBox(
        materials.mushroomStone,
        longX ? 0.65 : 0.42,
        0.34,
        longX ? 0.42 : 0.65,
        qx,
        y,
        qz,
        UV_SCALE.mushroomStone,
      );
    }
  }

  // Crenellated battlements around main roof parapet (14.8 -> 15.95m)
  const addCrenellation = (x0: number, z0: number, x1: number, z1: number, baseY: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rotY = Math.atan2(x1 - x0, z1 - z0);
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    // Lower continuous parapet wall
    batcher.addBox(materials.graniteAshlar, 0.38, 0.52, len, mx, baseY + 0.26, mz, UV_SCALE.graniteAshlar, 0, rotY, 0);
    // Alternating merlons
    const count = Math.max(2, Math.floor(len / 1.15));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      batcher.addBox(materials.graniteAshlar, 0.4, 0.58, 0.62, px, baseY + 0.81, pz, UV_SCALE.graniteAshlar, 0, rotY, 0);
      batcher.addBox(materials.curbStone, 0.48, 0.09, 0.68, px, baseY + 1.14, pz, UV_SCALE.curbStone, 0, rotY, 0);
    }
  };

  const rx0 = mainCX - mainW * 0.5 + 0.22;
  const rx1 = mainCX + mainW * 0.5 - 0.22;
  const rz0 = mainCZ - mainD * 0.5 + 0.22;
  const rz1 = mainCZ + mainD * 0.5 - 0.22;
  addCrenellation(rx0, rz0, rx1, rz0, 14.8);
  addCrenellation(rx0, rz1, rx1, rz1, 14.8);
  addCrenellation(rx0, rz0, rx0, rz1, 14.8);
  addCrenellation(rx1, rz0, rx1, rz1, 14.8);

  // 4. 2-Tier Romanesque Arched Sea Veranda (lx [-4.2, +5.2], lz [+3.8, +5.95])
  const verZ = 5.65;
  const bayXs = [-2.4, 0.4, 3.2];
  // Tier 1 (y = 0 -> 3.4m) & Tier 2 (y = 3.55 -> 6.85m)
  for (const tierY of [0, 3.52] as const) {
    for (const bx of bayXs) {
      addArchBay(batcher, materials.graniteAshlar, bx, tierY, verZ - 0.06, 2.8, 2.05, 0.96, 0.34, UV_SCALE.graniteAshlar);
    }
    // Engaged granite columns standing proud in front of arch bay piers
    for (const cx of [-3.8, -1.0, 1.8, 4.6] as const) {
      addColumn(batcher, materials.graniteAshlar, materials.curbStone, cx, tierY, verZ + 0.14, 2.1, 0.21);
    }
    // Veranda ceiling/floor slab connecting back to main facade
    batcher.addBox(materials.curbStone, 9.2, 0.22, 2.38, 0.4, tierY + 3.42, 4.9, UV_SCALE.curbStone);
  }
  // Tier 2 upper viewing gallery parapet (y = 6.95 -> 7.85m)
  batcher.addBox(materials.graniteAshlar, 8.9, 0.78, 0.3, 0.4, 7.34, 5.72, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.curbStone, 9.05, 0.1, 0.4, 0.4, 7.78, 5.72, UV_SCALE.curbStone);
  batcher.addBox(materials.graniteAshlar, 0.3, 0.78, 2.1, -3.9, 7.34, 4.8, UV_SCALE.graniteAshlar);
  batcher.addBox(materials.graniteAshlar, 0.3, 0.78, 2.1, 4.7, 7.34, 4.8, UV_SCALE.graniteAshlar);

  // Arched doors & stained glass windows behind the veranda arcade (1F flush with Story-1 podium face at z=3.92, 2F on Story-2 granite face at z=3.81)
  addArchedWindow(batcher, materials.stainedGlass, materials.curbStone, 0.4, 0.1, mainCZ + mainD * 0.5 + 0.13, 1.45, 2.65, 0);
  addArchedWindow(batcher, materials.stainedGlass, materials.curbStone, -2.4, 0.3, mainCZ + mainD * 0.5 + 0.13, 1.25, 2.35, 0);
  addArchedWindow(batcher, materials.stainedGlass, materials.curbStone, 3.2, 0.3, mainCZ + mainD * 0.5 + 0.13, 1.25, 2.35, 0);
  addArchedWindow(batcher, materials.stainedGlass, materials.curbStone, 0.4, 3.8, mainCZ + mainD * 0.5 + 0.01, 1.4, 2.45, 0);

  // 5. Asymmetrical Circular Corner Turret (SW seaward corner lx = -6.5, lz = +3.5, r = 2.45m)
  const turX = -6.5;
  const turZ = 3.5;
  const turR = 2.45;
  // Rusticated mushroom-stone lower base (bot -> 3.66m)
  const turBaseH = 3.66 - bot;
  const turBaseGeo = new THREE.CylinderGeometry(turR + 0.12, turR + 0.2, turBaseH, 20);
  scaleGeometryUVs(turBaseGeo, 2 * Math.PI * turR * UV_SCALE.mushroomStone, turBaseH * UV_SCALE.mushroomStone);
  batcher.add(materials.mushroomStone, turBaseGeo, new THREE.Matrix4().makeTranslation(turX, bot + turBaseH * 0.5, turZ), true);

  // Upper granite ashlar cylinder (3.66 -> 17.5m)
  const turShaftH = 17.5 - 3.66;
  const turShaftGeo = new THREE.CylinderGeometry(turR, turR, turShaftH, 20);
  scaleGeometryUVs(turShaftGeo, 2 * Math.PI * turR * UV_SCALE.graniteAshlar, turShaftH * UV_SCALE.graniteAshlar);
  batcher.add(materials.graniteAshlar, turShaftGeo, new THREE.Matrix4().makeTranslation(turX, 3.66 + turShaftH * 0.5, turZ), true);

  // Stringcourse rings on turret
  for (const ry of [3.66, 7.2, 10.6, 14.0, 17.4]) {
    const ringGeo = new THREE.CylinderGeometry(turR + 0.14, turR + 0.14, 0.22, 20);
    scaleGeometryUVs(ringGeo, 2 * Math.PI * turR * UV_SCALE.curbStone, 0.22 * UV_SCALE.curbStone);
    batcher.add(materials.curbStone, ringGeo, new THREE.Matrix4().makeTranslation(turX, ry, turZ), true);
  }

  // Corbelled crenellated crown (17.5 -> 18.45m)
  const crownGeo = new THREE.CylinderGeometry(turR + 0.22, turR + 0.05, 0.55, 20);
  scaleGeometryUVs(crownGeo, 2 * Math.PI * turR * UV_SCALE.graniteAshlar, 0.55 * UV_SCALE.graniteAshlar);
  batcher.add(materials.graniteAshlar, crownGeo, new THREE.Matrix4().makeTranslation(turX, 17.75, turZ), true);
  for (let m = 0; m < 12; m++) {
    const a = (m / 12) * Math.PI * 2;
    const mx = turX + Math.cos(a) * (turR + 0.06);
    const mz = turZ + Math.sin(a) * (turR + 0.06);
    batcher.addBox(materials.graniteAshlar, 0.42, 0.52, 0.34, mx, 18.24, mz, UV_SCALE.graniteAshlar, 0, -a, 0);
  }

  // Conical terracotta spire (18.45 -> 23.8m) + iron finial (23.8 -> 25.2m)
  const spireGeo = new THREE.ConeGeometry(turR + 0.32, 5.4, 20);
  scaleGeometryUVs(spireGeo, 2 * Math.PI * turR * UV_SCALE.terracottaRoof, 5.4 * UV_SCALE.terracottaRoof);
  batcher.add(materials.terracottaRoof, spireGeo, new THREE.Matrix4().makeTranslation(turX, 18.4 + 2.7, turZ), true);
  const finPole = new THREE.CylinderGeometry(0.05, 0.08, 1.5, 8);
  batcher.add(materials.darkIron, finPole, new THREE.Matrix4().makeTranslation(turX, 24.45, turZ), true);
  const finBall = new THREE.SphereGeometry(0.16, 10, 8);
  batcher.add(materials.darkIron, finBall, new THREE.Matrix4().makeTranslation(turX, 24.2, turZ), true);

  // Turret lancet windows facing SW, S, W (strictly clear of stringcourse rings)
  for (const ang of [-Math.PI * 0.5, -Math.PI * 0.25, 0, Math.PI * 0.25] as const) {
    const wx = turX + Math.sin(ang) * (turR + 0.01);
    const wz = turZ + Math.cos(ang) * (turR + 0.01);
    addArchedWindow(batcher, materials.stainedGlass, materials.curbStone, wx, 4.7, wz, 0.72, 1.5, ang);
    addArchedWindow(batcher, materials.windowGlass, materials.curbStone, wx, 8.2, wz, 0.72, 1.5, ang);
    addArchedWindow(batcher, materials.windowGlass, materials.curbStone, wx, 11.6, wz, 0.72, 1.5, ang);
  }

  // 6. Polygonal 8-sided East Bay Wing (lx = +5.8, lz = -0.8, r = 2.55m), rotated PI/8 so flat faces align with +X
  const bayX = 5.8;
  const bayZ = -0.8;
  const bayR = 2.55;
  const bayFlatDist = bayR * Math.cos(Math.PI / 8);
  const bayRot = new THREE.Matrix4().makeRotationY(Math.PI / 8);

  const bayBaseH = 3.66 - bot;
  const bayBaseGeo = new THREE.CylinderGeometry(bayR + 0.1, bayR + 0.18, bayBaseH, 8);
  scaleGeometryUVs(bayBaseGeo, 2 * Math.PI * bayR * UV_SCALE.mushroomStone, bayBaseH * UV_SCALE.mushroomStone);
  batcher.add(
    materials.mushroomStone,
    bayBaseGeo,
    new THREE.Matrix4().makeTranslation(bayX, bot + bayBaseH * 0.5, bayZ).multiply(bayRot),
    true,
  );

  const bayShaftH = 15.2 - 3.66;
  const bayShaftGeo = new THREE.CylinderGeometry(bayR, bayR, bayShaftH, 8);
  scaleGeometryUVs(bayShaftGeo, 2 * Math.PI * bayR * UV_SCALE.graniteAshlar, bayShaftH * UV_SCALE.graniteAshlar);
  batcher.add(
    materials.graniteAshlar,
    bayShaftGeo,
    new THREE.Matrix4().makeTranslation(bayX, 3.66 + bayShaftH * 0.5, bayZ).multiply(bayRot),
    true,
  );

  const bayRoofGeo = new THREE.ConeGeometry(bayR + 0.28, 2.7, 8);
  scaleGeometryUVs(bayRoofGeo, 2 * Math.PI * bayR * UV_SCALE.terracottaRoof, 2.7 * UV_SCALE.terracottaRoof);
  batcher.add(
    materials.terracottaRoof,
    bayRoofGeo,
    new THREE.Matrix4().makeTranslation(bayX, 15.2 + 1.35, bayZ).multiply(bayRot),
    true,
  );
  batcher.add(materials.darkIron, new THREE.CylinderGeometry(0.04, 0.06, 0.9, 8), new THREE.Matrix4().makeTranslation(bayX, 18.2, bayZ), true);

  // East polygonal bay stained glass & standard windows mounted flush on the flat +X face
  for (const wy of [4.8, 8.2, 11.6] as const) {
    addArchedWindow(
      batcher,
      wy === 4.8 ? materials.stainedGlass : materials.windowGlass,
      materials.curbStone,
      bayX + bayFlatDist + 0.015,
      wy,
      bayZ,
      0.85,
      1.75,
      Math.PI * 0.5,
    );
  }

  // 7. Upper Main Facade Windows (South +Z, North -Z, West -X), clear of stringcourses & 14.7m cornice
  for (const wy of [7.45, 10.25, 12.85] as const) {
    for (const wx of [-2.4, 0.4, 3.2] as const) {
      addArchedWindow(
        batcher,
        wy === 7.45 && wx === 0.4 ? materials.stainedGlass : materials.windowGlass,
        materials.curbStone,
        wx,
        wy,
        mainCZ + mainD * 0.5,
        1.1,
        1.55,
        0,
      );
    }
    for (const wx of [-4.0, -0.5, 3.0] as const) {
      addWindowUnit(batcher, materials.windowGlass, materials.curbStone, wx, wy + 0.75, mainCZ - mainD * 0.5, 1.15, 1.5, Math.PI, 2, 2);
    }
  }
  for (const wy of [4.8, 8.2, 11.4] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.curbStone, mainCX - mainW * 0.5, wy, -3.5, 1.15, 1.75, -Math.PI * 0.5, 2, 2);
    addWindowUnit(batcher, materials.windowGlass, materials.curbStone, mainCX - mainW * 0.5, wy, -0.5, 1.15, 1.75, -Math.PI * 0.5, 2, 2);
  }

  //Flush merged geometry into parcel group
  batcher.flush(group, parcel.id, materials, disposableGeometries);

  // 8. Tight rotated-to-AABB 'building' colliders (sliced along X so rotated AABB bloat does not obstruct front gate)
  addColliderSpan(colliders, parcel, 'huashi_main', 'building', -7.2, 6.2, -6.6, 5.9, 2.5);
  colliders.push(localBoxToCollider(parcel, 'huashi_turret', 'building', -9.1, -4.0, 1.0, 6.2));
  colliders.push(localBoxToCollider(parcel, 'huashi_east_bay', 'building', 3.4, 8.5, -3.4, 2.0));
  addColliderSpan(colliders, parcel, 'huashi_terrace', 'building', -8.4, 8.2, 3.8, 7.2, 2.2);
  addColliderSpan(colliders, parcel, 'huashi_steps', 'building', -2.2, 2.2, 7.2, 8.2, 2.2);

  return group;
}
