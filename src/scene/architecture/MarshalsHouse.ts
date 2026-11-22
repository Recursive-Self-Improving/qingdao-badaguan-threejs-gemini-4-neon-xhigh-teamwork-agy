import * as THREE from 'three';
import { ColliderBox, VillaParcel } from '../DistrictLayout';
import { ProceduralMaterialSet } from '../ProceduralMaterials';
import {
  MaterialBatcher,
  StuccoGetter,
  UV_SCALE,
  addCourtyardEnclosure,
  addHippedRoof,
  addWindowUnit,
  createParcelContext,
  groundLocalY,
  localBoxToCollider,
  scaleGeometryUVs,
} from '../Architecture';

function addStoneLantern(
  batcher: MaterialBatcher,
  materials: ProceduralMaterialSet,
  cx: number,
  groundY: number,
  cz: number,
): void {
  // Base (kiso) sunk into terrain
  batcher.addWorldSlopeBox(materials.graniteAshlar, 0.72, groundY + 0.22, groundY - 0.35, 0.72, cx, cz, UV_SCALE.graniteAshlar);
  // Cylindrical shaft (sao)
  const shaft = new THREE.CylinderGeometry(0.14, 0.17, 0.85, 12);
  scaleGeometryUVs(shaft, 2 * Math.PI * 0.15 * UV_SCALE.graniteAshlar, 0.85 * UV_SCALE.graniteAshlar);
  batcher.add(materials.graniteAshlar, shaft, new THREE.Matrix4().makeTranslation(cx, groundY + 0.64, cz), true);
  // Hexagonal platform (chudai)
  const chudai = new THREE.CylinderGeometry(0.36, 0.2, 0.18, 6);
  batcher.add(materials.graniteAshlar, chudai, new THREE.Matrix4().makeTranslation(cx, groundY + 1.15, cz), true);
  // Firebox (hibukuro): warm core + stone frame
  batcher.addBox(materials.curbStone, 0.32, 0.34, 0.32, cx, groundY + 1.4, cz, UV_SCALE.curbStone);
  for (const sx of [-0.17, 0.17] as const) {
    for (const sz of [-0.17, 0.17] as const) {
      batcher.addBox(materials.graniteAshlar, 0.06, 0.36, 0.06, cx + sx, groundY + 1.4, cz + sz, UV_SCALE.graniteAshlar);
    }
  }
  // Flared hexagonal pagoda roof (kasa) + lotus finial (hoju)
  const kasa = new THREE.ConeGeometry(0.58, 0.34, 6);
  scaleGeometryUVs(kasa, 2 * Math.PI * 0.35 * UV_SCALE.graniteAshlar, 0.34 * UV_SCALE.graniteAshlar);
  batcher.add(materials.graniteAshlar, kasa, new THREE.Matrix4().makeTranslation(cx, groundY + 1.74, cz), true);
  const hoju = new THREE.SphereGeometry(0.08, 10, 8);
  batcher.add(materials.curbStone, hoju, new THREE.Matrix4().makeTranslation(cx, groundY + 1.94, cz), true);
}

export function buildMarshalsHouse(
  parcel: VillaParcel,
  materials: ProceduralMaterialSet,
  getStucco: StuccoGetter,
  colliders: ColliderBox[],
  disposableGeometries: THREE.BufferGeometry[],
): THREE.Group {
  const ctx = createParcelContext(parcel, 0.42, 9.0, 6.8);
  const group = new THREE.Group();
  group.name = parcel.id;
  group.position.set(parcel.x, ctx.datumY, parcel.z);
  group.rotation.y = parcel.facingYaw;

  const batcher = new MaterialBatcher();
  const ochreStucco = getStucco('#E2CFAF');
  const bot = ctx.skirtBottomLocalY;

  // 1. Courtyard enclosure (mushroom stone + dark iron + open 3.6m south gate on Shanhaiguan Rd)
  addCourtyardEnclosure(ctx, batcher, colliders, {
    wallMaterial: materials.mushroomStone,
    wallUvScale: UV_SCALE.mushroomStone,
    capMaterial: materials.curbStone,
    ironMaterial: materials.darkIron,
    walkMaterial: materials.cobblestone,
    gateHalfWidth: 1.8,
    wallHeightAboveGround: 0.68,
    railHeight: 0.44,
    pierHeightAboveGround: 1.28,
    walkEndLZ: 7.4,
    inset: 0.45,
  });

  // 2. Main 2-Story Japanese-European Villa Mass (lx [-7.4, +7.4], lz [-4.8, +4.0])
  const mainW = 14.8;
  const mainD = 8.8;
  const mainCZ = -0.4;
  const plinthTop = 0.24;
  const eaveY = 5.95;

  // Mushroom stone plinth sunk deep
  batcher.addWorldSlopeBox(materials.mushroomStone, mainW + 0.24, plinthTop, bot, mainD + 0.24, 0, mainCZ, UV_SCALE.mushroomStone);
  batcher.addBox(materials.curbStone, mainW + 0.32, 0.1, mainD + 0.32, 0, plinthTop + 0.04, mainCZ, UV_SCALE.curbStone);

  // Warm pale-ochre roughcast stucco body
  batcher.addWorldSlopeBox(ochreStucco, mainW, eaveY, plinthTop + 0.08, mainD, 0, mainCZ, UV_SCALE.stucco);

  // Restrained darkTimber corner posts & horizontal timber belt course
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      batcher.addBox(
        materials.darkTimber,
        0.24,
        eaveY - plinthTop,
        0.24,
        sx * (mainW * 0.5 - 0.06),
        (eaveY + plinthTop) * 0.5,
        mainCZ + sz * (mainD * 0.5 - 0.06),
        UV_SCALE.darkTimber,
      );
    }
  }
  batcher.addBox(materials.darkTimber, mainW + 0.1, 0.14, mainD + 0.1, 0, 3.22, mainCZ, UV_SCALE.darkTimber);
  batcher.addBox(materials.darkTimber, mainW + 0.14, 0.16, mainD + 0.14, 0, eaveY - 0.06, mainCZ, UV_SCALE.darkTimber);

  // 3. Low-Pitched Hipped Red-Tile Roof with Overhanging Eaves & Exposed Rafter Tails
  addHippedRoof(batcher, materials.terracottaRoof, materials.darkTimber, 0, eaveY, mainCZ, mainW + 1.35, mainD + 1.35, 2.55, 6.2, UV_SCALE.terracottaRoof);

  // Exposed darkTimber rafter tails along front & rear eaves
  for (let rx = -7.2; rx <= 7.2; rx += 0.9) {
    batcher.addBox(materials.darkTimber, 0.09, 0.12, 0.65, rx, eaveY - 0.14, mainCZ + mainD * 0.5 + 0.32, UV_SCALE.darkTimber);
    batcher.addBox(materials.darkTimber, 0.09, 0.12, 0.65, rx, eaveY - 0.14, mainCZ - mainD * 0.5 - 0.32, UV_SCALE.darkTimber);
  }
  // Stout mushroom-stone chimney
  batcher.addWorldSlopeBox(materials.mushroomStone, 0.95, 9.25, 6.2, 0.95, -3.8, mainCZ - 1.8, UV_SCALE.mushroomStone);
  batcher.addBox(materials.curbStone, 1.1, 0.14, 1.1, -3.8, 9.32, mainCZ - 1.8, UV_SCALE.curbStone);

  // 4. 1F SW Glazed Sun-Gallery Wing (lx [-7.4, -1.2], lz [+4.0, +5.4])
  batcher.addWorldSlopeBox(materials.mushroomStone, 6.2, plinthTop, bot, 1.5, -4.3, 4.7, UV_SCALE.mushroomStone);
  batcher.addWorldSlopeBox(ochreStucco, 6.1, 2.96, plinthTop + 0.04, 1.4, -4.3, 4.7, UV_SCALE.stucco);
  addHippedRoof(batcher, materials.terracottaRoof, materials.darkTimber, -4.3, 2.96, 4.7, 6.8, 2.0, 0.62, 4.8, UV_SCALE.terracottaRoof);
  for (const gx of [-6.0, -4.3, -2.6] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, gx, 1.72, 5.4, 1.35, 1.95, 0, 3, 3);
  }

  // 5. Mosaic/Cobblestone & Stone Entry Portico (+Z front, lx [-0.2, +3.6], lz [+4.0, +6.2])
  const portX = 1.7;
  const portZ = 5.1;
  batcher.addWorldSlopeBox(materials.mushroomStone, 3.8, 0.0, bot, 2.2, portX, portZ, UV_SCALE.mushroomStone);
  batcher.addBox(materials.cobblestone, 3.85, 0.08, 2.25, portX, 0.02, portZ, UV_SCALE.cobblestone);
  // 3 broad granite steps descending to terrain (all steps grounded solidly below local terrain)
  const portGY = groundLocalY(ctx, portX, 7.0);
  for (let s = 0; s < 3; s++) {
    const syTop = -0.14 - s * 0.18;
    const sz = 6.32 + s * 0.32;
    const localStepGY = Math.min(
      portGY,
      groundLocalY(ctx, portX - 1.4, sz),
      groundLocalY(ctx, portX, sz),
      groundLocalY(ctx, portX + 1.4, sz),
    );
    const syBot = Math.min(syTop - 0.22, localStepGY - 0.45);
    batcher.addWorldSlopeBox(materials.curbStone, 3.0, syTop, syBot, 0.34, portX, sz, UV_SCALE.curbStone);
  }
  // Paired battered mushroom-stone + granite piers
  for (const px of [portX - 1.55, portX + 1.55] as const) {
    batcher.addBox(materials.mushroomStone, 0.56, 1.15, 0.56, px, 0.58, 5.95, UV_SCALE.mushroomStone);
    batcher.addBox(materials.graniteAshlar, 0.44, 1.85, 0.44, px, 2.05, 5.95, UV_SCALE.graniteAshlar);
    batcher.addBox(materials.curbStone, 0.52, 0.12, 0.52, px, 3.02, 5.95, UV_SCALE.curbStone);
  }
  // Hipped portico roof canopy
  addHippedRoof(batcher, materials.terracottaRoof, materials.darkTimber, portX, 3.08, 5.15, 4.4, 2.7, 0.95, 2.4, UV_SCALE.terracottaRoof);
  // Entry door
  batcher.addBox(materials.darkTimber, 1.5, 2.35, 0.14, portX, 1.25, 4.02, UV_SCALE.darkTimber);
  batcher.addBox(materials.windowGlass, 1.0, 1.75, 0.16, portX, 1.35, 4.04, 0, 0, 0, 0, false);

  // 6. Dark Timber Lattice / Shoji Windows across 4 elevations
  for (const wx of [-5.2, -2.6, 0.2, 3.4, 5.5] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, wx, 4.7, mainCZ + mainD * 0.5, 1.35, 1.45, 0, 4, 3);
  }
  addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, 5.3, 1.75, mainCZ + mainD * 0.5, 1.45, 1.75, 0, 4, 3);
  for (const wx of [-5.2, -1.8, 1.8, 5.2] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, wx, 1.75, mainCZ - mainD * 0.5, 1.3, 1.65, Math.PI, 4, 3);
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, wx, 4.7, mainCZ - mainD * 0.5, 1.3, 1.45, Math.PI, 4, 3);
  }
  for (const wz of [-2.4, 1.2] as const) {
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, -mainW * 0.5, 1.75, wz, 1.25, 1.65, -Math.PI * 0.5, 3, 3);
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, -mainW * 0.5, 4.7, wz, 1.25, 1.45, -Math.PI * 0.5, 3, 3);
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, mainW * 0.5, 1.75, wz, 1.25, 1.65, Math.PI * 0.5, 3, 3);
    addWindowUnit(batcher, materials.windowGlass, materials.darkTimber, mainW * 0.5, 4.7, wz, 1.25, 1.45, Math.PI * 0.5, 3, 3);
  }

  // 7. Serene Garden Accents: Stepping-stone path, SW stone patio, and Japanese Granite Stone Lantern (toro)
  // Stepping stones leading from main entry walk toward portico & patio (castShadow = false)
  for (const [sx, sz] of [
    [0.5, 7.2],
    [1.1, 6.7],
    [-1.4, 7.6],
    [-2.8, 7.4],
    [-4.1, 7.2],
  ] as const) {
    const sy = groundLocalY(ctx, sx, sz);
    batcher.addWorldSlopeBox(materials.cobblestone, 0.85, sy + 0.045, sy - 0.22, 0.65, sx, sz, UV_SCALE.cobblestone, 0, false);
  }
  // Quiet SW stone terrace patio
  const patGY = groundLocalY(ctx, -6.6, 7.2);
  batcher.addWorldSlopeBox(materials.cobblestone, 3.8, patGY + 0.05, patGY - 0.28, 2.5, -6.6, 7.2, UV_SCALE.cobblestone, 0, false);

  // Granite stone lantern (toro) at lx = +5.8, lz = +7.0
  const lnX = 5.8;
  const lnZ = 7.0;
  addStoneLantern(batcher, materials, lnX, groundLocalY(ctx, lnX, lnZ), lnZ);

  batcher.flush(group, parcel.id, materials, disposableGeometries);

  // 8. Colliders
  colliders.push(localBoxToCollider(parcel, 'marshal_main', 'building', -7.6, 7.6, -5.0, 5.6));
  colliders.push(localBoxToCollider(parcel, 'marshal_portico', 'building', -0.4, 3.8, 4.0, 7.2));
  colliders.push(localBoxToCollider(parcel, 'marshal_lantern', 'prop', lnX - 0.55, lnX + 0.55, lnZ - 0.55, lnZ + 0.55));

  return group;
}
