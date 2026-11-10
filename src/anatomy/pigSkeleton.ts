// Esqueleto de cerdo (Sus scrofa domesticus) PROCEDURAL montado en postura humana (§5.2, §1.4).
// No hay un esqueleto de cerdo CC descargable sin cuenta: se modela con SDF y se AJUSTA a las
// articulaciones reales del humano (las exporta blender/scripts/02_rig_human.py).
// Rasgos que lo delatan: cráneo en cuña (la cresta nucal es lo más alto y el dorso baja recto hasta el
// hocico), hocico ancho y aplanado con hueso rostral, colmillos encastrados; huesos largos macizos con
// los extremos anchos; 7 cervicales
// cortas, 14 torácicas con apófisis espinosas altas (la cruz), 6 lumbares; 14 pares de costillas en
// un tórax estrecho y profundo; escápula larga sin acromion; SIN clavículas; pelvis larga y estrecha;
// húmero y fémur gruesos; manos y pies con 4 dedos y pezuñas (III-IV) y espolones (II-V).
// Coordenadas: modelo glTF (Y arriba, +Z al frente, izquierda +X), metros.
import { CatmullRomCurve3, Vector3 } from 'three';
import type { BoneName } from './armature.ts';
import { flatTube, frameMatrix, lumbarSDF, cervicalSDF, phalanges, polySDF, type BonePiece } from './humanSkeleton.ts';
import { mergeMeshes, mirrorMesh, transformMesh, type MeshData } from './polygonize.ts';
import { SDF, add, cross, len, lerp3, norm, scale, sub, type V3 } from './sdf.ts';

export interface HumanJoints {
  joints: Record<BoneName, V3>;
  /** Centros de cuerpos vertebrales de C1 a L5 medidos en el humano (de arriba a abajo). */
  spine: V3[];
  /** Medidas del tórax humano (m). */
  chestHalfWidth: number;
  chestDepth: number;
  sternumTop: V3;
  sternumBottom: V3;
}

type Progress = (f: number, label: string) => Promise<void> | void;

/** Marco de un segmento a→b: el hueso canónico se modela a lo largo de -Y desde el origen
 *  con longitud `canonLen`; X lateral (+ para el lado izquierdo), Z hacia adelante. */
function segmentMatrix(a: V3, b: V3, canonLen: number, fwdRef: V3 = [0, 0, 1], thick = 1): number[] {
  const y = norm(sub(a, b));
  let z = sub(fwdRef, scale(y, fwdRef[0] * y[0] + fwdRef[1] * y[1] + fwdRef[2] * y[2]));
  if (len(z) < 1e-4) z = [0, 0, 1];
  z = norm(z);
  const x = cross(y, z);
  const s = len(sub(b, a)) / canonLen;
  // Escala longitudinal = s; grosor = s·thick (huesos de cerdo más robustos).
  return [
    x[0] * s * thick, x[1] * s * thick, x[2] * s * thick, 0,
    y[0] * s, y[1] * s, y[2] * s, 0,
    z[0] * s * thick, z[1] * s * thick, z[2] * s * thick, 0,
    a[0], a[1], a[2], 1,
  ];
}

const mirrorX = (m: MeshData) => mirrorMesh(m);

// ═══════════════════════════════ CRÁNEO ═══════════════════════════════
// Canónico: origen en los cóndilos occipitales (joint Head), cabeza humana de 0,22 m de alto.

// De perfil, el cráneo de cerdo es una CUÑA: la parte más alta es la cresta nucal, atrás, y desde ahí el
// dorso baja casi recto (apenas cóncavo) hasta el hocico. El neurocráneo es chico; la cara, larga.
// El hocico es ancho y aplanado (dos conos lado a lado, no un cilindro), termina en el hueso rostral
// (un disco plano con las narinas) y lleva el abultamiento del colmillo a los costados.

function pigSkullSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  // Neurocráneo: caja chica detrás de las órbitas.
  s.ellipsoid([0, 0.07, 0.015], [0.048, 0.052, 0.058]);
  // Occipital: pared alta que sube inclinada hacia atrás hasta la cresta nucal.
  s.box([0, 0.085, -0.028], [0.044, 0.068, 0.013], 0.01, [-24, 0, 0], { k: 0.02 });
  // Cresta nucal: reborde ancho y transversal (no una perilla), el punto más alto del cráneo.
  s.ellipsoidAlong([0, 0.158, -0.05], [0.058, 0.011, 0.017], [1, 0, 0], [0, 1, 0], { k: 0.016 });
  // Dorso frontonasal: de la cresta a la punta del hocico, casi recto.
  s.cone([0.016, 0.128, -0.035], [0.016, 0.088, 0.12], 0.03, 0.026, { k: 0.026 });
  s.cone([0.016, 0.088, 0.12], [0.014, 0.04, 0.305], 0.026, 0.016, { k: 0.02 });
  // Maxilar: la parte baja de la cara, profunda atrás y que se angosta hacia adelante.
  s.cone([0.025, 0.036, 0.045], [0.018, 0.012, 0.29], 0.04, 0.019, { k: 0.022 });
  // Abultamiento del colmillo (yugo canino) y hueso rostral.
  s.ellipsoid([0.034, 0.012, 0.2], [0.014, 0.019, 0.026], undefined, { k: 0.012 });
  s.ellipsoid([0, 0.024, 0.322], [0.021, 0.022, 0.011], undefined, { k: 0.01 });
  s.ellipsoid([0.008, 0.026, 0.334], [0.006, 0.008, 0.009], undefined, { op: 'sub', k: 0.003 }); // narinas
  // Órbita (detrás del pivote del hocico) con su reborde, y el arco cigomático profundo y abierto.
  s.cone([0.036, 0.11, 0.045], [0.045, 0.104, 0.088], 0.006, 0.005, { k: 0.014 }); // reborde supraorbitario
  s.sphere([0.047, 0.084, 0.068], 0.021, { op: 'sub', k: 0.006 });
  // Arco cigomático: profundo pero al ras de la cara adelante; se abre hacia atrás, hacia la oreja.
  s.ellipsoidAlong([0.054, 0.044, 0.04], [0.055, 0.018, 0.006], [0.2, 0.02, -1], [0, 1, 0], { k: 0.02 });
  s.ellipsoid([0.062, 0.09, 0.008], [0.016, 0.026, 0.04], undefined, { op: 'sub', k: 0.008 }); // fosa temporal
  // Base: cóndilos, apófisis paracondilares largas (hacia abajo) y el foramen magno.
  s.ellipsoid([0.015, -0.002, -0.006], [0.01, 0.012, 0.016], undefined, { k: 0.008 });
  s.cone([0.035, 0.006, -0.034], [0.04, -0.07, -0.022], 0.011, 0.005, { k: 0.008 });
  s.ellipsoid([0, 0.01, -0.02], [0.012, 0.012, 0.03], undefined, { op: 'sub', k: 0.004 });
  return s;
}

function pigMandibleSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  // Cuerpo alto y delgado de cada lado, que converge hacia una sínfisis larga en forma de pala.
  s.ellipsoidAlong([0.04, -0.04, 0.085], [0.1, 0.024, 0.009], [-0.11, 0.025, 1], [0, 1, 0], { k: 0.01 });
  s.ellipsoidAlong([0.024, -0.035, 0.205], [0.075, 0.021, 0.009], [-0.15, 0.04, 1], [0, 1, 0], { k: 0.02 });
  s.ellipsoidAlong([0, -0.03, 0.27], [0.045, 0.016, 0.02], [0, 0.18, 1], [0, 1, 0], { k: 0.016 }); // sínfisis
  // Ángulo grande y redondeado, rama vertical alta, cóndilo y coronoides.
  s.ellipsoid([0.048, -0.045, 0.006], [0.009, 0.035, 0.035], undefined, { k: 0.012 });
  s.ellipsoidAlong([0.052, -0.002, 0.002], [0.045, 0.022, 0.007], [0, 1, 0.1], [0, 0, 1], { k: 0.01 });
  s.ellipsoid([0.053, 0.042, -0.008], [0.014, 0.007, 0.009], undefined, { k: 0.005 });
  s.cone([0.052, 0.0, 0.03], [0.05, 0.045, 0.04], 0.008, 0.004, { k: 0.006 });
  return s;
}

function pigTeethSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  // Molares y premolares (7 por hemiarcada), encastrados: las raíces dentro del maxilar y la mandíbula,
  // más grandes atrás. La fila sigue a la mandíbula, que se angosta hacia adelante.
  for (let i = 0; i < 7; i++) {
    const z = 0.03 + i * 0.022;
    const x = 0.044 - (i / 6) * 0.017;
    const r = 0.009 - i * 0.0006;
    s.cone([x, 0.004, z], [x, -0.012, z], r, r * 0.82);
    s.cone([x - 0.002, -0.026, z + 0.004], [x - 0.002, -0.011, z + 0.004], r * 0.95, r * 0.8);
  }
  // Incisivos: los de abajo proclives (casi horizontales), como pala.
  for (let i = 0; i < 3; i++) {
    const x = 0.004 + i * 0.008;
    s.cone([x, 0.006, 0.3 - i * 0.012], [x, -0.012, 0.318 - i * 0.012], 0.0032, 0.0024);
    s.cone([x, -0.03, 0.27 - i * 0.012], [x, -0.02, 0.326 - i * 0.012], 0.0032, 0.0022);
  }
  // Colmillos: nacen dentro del hueso. El superior sale del yugo y curva hacia arriba y afuera; el
  // inferior, más largo, sale de la mandíbula por fuera del labio y sube hacia atrás.
  s.chain([[0.03, 0.006, 0.2], [0.05, 0.0, 0.215], [0.064, 0.022, 0.21]], [0.0085, 0.0062, 0.0022], { k: 0.003 });
  s.chain([[0.02, -0.032, 0.235], [0.042, -0.008, 0.246], [0.06, 0.022, 0.236]], [0.0085, 0.0062, 0.002], { k: 0.003 });
  return s;
}

/** Cara de cerdo en TEJIDO BLANDO (§9.4): lo que hace que cualquiera, sin saber anatomía, vea un cerdo.
 *  Los visitantes miran a la cámara, así que de frente el cráneo se ve angosto y su perfil no se lee.
 *  En una radiografía la carne también se ve (sombra gris), y de frente lo que se reconoce es:
 *    · el disco del hocico con sus DOS FOSAS NASALES mirando al público;
 *    · las OREJAS grandes, que suben hacia afuera y adelante;
 *    · los cachetes anchos que se funden con un cuello grueso, casi sin cuello.
 *  Mismo marco que el cráneo (origen en los cóndilos, Y arriba, Z al frente) y cubre al hueso. */
function pigFaceSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  // Masa de la cabeza y cachetes (más ancha que el cráneo: de frente, una cara redonda y ancha).
  s.ellipsoid([0, 0.04, 0.06], [0.088, 0.09, 0.115]);
  s.ellipsoid([0.052, -0.035, 0.06], [0.045, 0.052, 0.075], undefined, { k: 0.03 }); // papada / cachete
  // Cuello grueso que baja hacia los hombros.
  s.cone([0, -0.01, -0.03], [0, -0.11, -0.05], 0.085, 0.078, { k: 0.04 });
  // Dorso (cubre la línea recta del cráneo) y hocico: un cilindro grueso que se angosta poco.
  s.cone([0, 0.135, -0.005], [0, 0.065, 0.3], 0.045, 0.03, { k: 0.03 });
  s.cone([0, 0.045, 0.1], [0, 0.032, 0.33], 0.07, 0.043, { k: 0.03 });
  s.cone([0, -0.03, 0.05], [0, -0.026, 0.28], 0.05, 0.03, { k: 0.03 }); // labio y mandíbula
  // Disco del hocico: un poco más ancho que la punta (el reborde), plano al frente.
  s.ellipsoid([0, 0.032, 0.347], [0.05, 0.046, 0.016], undefined, { k: 0.008 });
  // Fosas nasales: túneles de aire a lo largo del hocico. En la radiografía el aire es oscuro: de frente,
  // dos óvalos oscuros sobre el disco claro (el haz atraviesa mucha menos carne por ahí).
  s.ellipsoid([0.018, 0.032, 0.265], [0.0095, 0.0135, 0.105], undefined, { op: 'sub', k: 0.003 });
  // Orejas: hojas grandes y anchas (no puntas de gato), finas, con el borde engrosado (cartílago), que
  // suben hacia afuera y se vuelcan un poco hacia adelante.
  const ea: V3 = [0.042, 0.14, -0.022]; // base, atrás y arriba
  const eb: V3 = [0.084, 0.075, 0.05]; // base, adelante y abajo
  const tip: V3 = [0.168, 0.205, 0.105];
  const wing: V3 = [0.15, 0.115, 0.1]; // borde de afuera: ensancha la hoja
  // Más gruesas que una oreja real (≈5 mm): con su espesor verdadero casi no suman densidad y no se leen.
  s.triangle(ea, tip, wing, 0.007, { k: 0.012 });
  s.triangle(ea, wing, eb, 0.007, { k: 0.012 });
  s.cone(lerp3(ea, eb, 0.5), lerp3(lerp3(ea, eb, 0.5), wing, 0.3), 0.02, 0.009, { k: 0.012 }); // base gruesa
  s.chain([ea, lerp3(ea, tip, 0.55), tip, wing, eb], [0.009, 0.008, 0.006, 0.008, 0.009], { k: 0.005 });
  return s;
}

// ═══════════════════════════════ COLUMNA ═══════════════════════════════

/** Torácica de cerdo: cuerpo corto, apófisis espinosa alta y casi vertical (la "cruz"). */
function pigThoracicSDF(spineLen: number): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.ellipsoid([0, 0, 0], [0.016, 0.0105, 0.016]);
  s.box([0, 0, 0], [0.04, 0.0085, 0.04], 0.001, undefined, { op: 'int', k: 0.002 });
  s.cone([0.008, 0.002, -0.011], [0.009, 0.002, -0.018], 0.0038, 0.0038, { k: 0.0025 });
  s.cone([0.009, 0.0, -0.018], [0, -0.002, -0.026], 0.0038, 0.0036, { k: 0.0025 });
  // Espinosa alta, inclinada hacia la cabeza en las primeras torácicas.
  s.ellipsoidAlong([0, 0.004, -0.026 - spineLen / 2], [spineLen / 2, 0.0045, 0.0022], [0, 0.18, -1], [0, 1, 0], { k: 0.003 });
  s.cone([0.009, 0.004, -0.016], [0.022, 0.007, -0.024], 0.0042, 0.0034, { k: 0.0025 });
  s.cone([0, -0.03, -0.016], [0, 0.03, -0.016], 0.0066, 0.0066, { op: 'sub', k: 0.0015 });
  return s;
}

function pigVertebraPieces(J: HumanJoints, voxel: number): BonePiece[] {
  const curve = new CatmullRomCurve3(J.spine.map((p) => new Vector3(...p)), false, 'centripetal');
  // Fracciones de la curva humana: C1..C7, T1..T12, L1..L5 (24 cuerpos, 23 tramos).
  const n = J.spine.length - 1;
  const at = (u: number): { p: V3; up: V3; fwd: V3 } => {
    const p = curve.getPoint(Math.min(1, Math.max(0, u)));
    const t = curve.getTangent(Math.min(1, Math.max(0, u)));
    const up: V3 = norm([0, -t.y, -t.z]); // la curva va de arriba a abajo
    const fwd = norm(cross([1, 0, 0], up));
    return { p: [p.x, p.y, p.z], up, fwd };
  };
  const u = (idx: number) => idx / n;
  const cerv = polySDF(cervicalSDF('C'), voxel * 0.8, 1000);
  const cervLong = polySDF(cervicalSDF('C7'), voxel * 0.8, 1100);
  const lumb = polySDF(lumbarSDF(), voxel, 1500);
  const out: BonePiece[] = [];
  const place = (m: MeshData, u0: number, sc: number, bone: BoneName, slot: string, squashY = 1) => {
    const { p, up, fwd } = at(u0);
    const mm = frameMatrix(p, [sc, 0, 0], scale(up, sc * squashY), scale(fwd, sc));
    out.push({ slot, bone, material: 'bone', mesh: transformMesh(m, mm) });
  };
  // 7 cervicales cortas y anchas en el tramo C1-C7 humano.
  for (let i = 0; i < 7; i++) place(i === 6 ? cervLong : cerv, u(0.3 + i * (5.7 / 6)), 1.12, i < 6 ? 'Neck' : 'Spine2', 'cervical', 0.85);
  // 14 torácicas en el tramo T1-T12 humano (más vértebras, más juntas).
  const t0 = 7, t1 = 18;
  for (let i = 0; i < 14; i++) {
    const uu = u(t0 + (i / 13) * (t1 - t0));
    const spineLen = 0.07 - i * 0.0035; // la cruz: espinosas altas que bajan hacia caudal
    const m = polySDF(pigThoracicSDF(Math.max(0.025, spineLen)), voxel, 1400);
    place(m, uu, 0.95, i < 10 ? 'Spine2' : 'Spine1', 'thoracic', 0.82);
  }
  // 6 lumbares en el tramo L1-L5 humano.
  for (let i = 0; i < 6; i++) place(lumb, u(19 + (i / 5) * 4), 0.96, i < 2 ? 'Spine1' : i < 5 ? 'Spine' : 'Hips', 'lumbar', 0.78);
  return out;
}

// ═══════════════════════════════ TÓRAX ═══════════════════════════════

/** Costilla individual (fuente para la fractura de la Fase 2 · script 04). */
export interface PigRib {
  index: number;
  side: 'L' | 'R';
  mesh: MeshData;
}

function pigRibCage(J: HumanJoints, ribsOut: PigRib[]): BonePiece[] {
  // 14 pares sobre las 14 torácicas: tórax estrecho (×0,72) y profundo (×1,25).
  const curve = new CatmullRomCurve3(J.spine.map((p) => new Vector3(...p)), false, 'centripetal');
  const n = J.spine.length - 1;
  const W0 = J.chestHalfWidth * 0.72;
  const D0 = J.chestDepth * 1.25;
  const st0 = J.sternumTop;
  const st1 = add(J.sternumBottom, [0, -0.05, 0.015]); // esternón más largo
  const left: MeshData[] = [];
  const carts: MeshData[] = [];
  const outward = (p: V3): V3 => [p[0], 0, p[2] - (st0[2] + J.spine[10][2]) / 2];
  for (let i = 0; i < 14; i++) {
    const uu = (7 + (i / 13) * 11) / n;
    const v = curve.getPoint(uu);
    const T: V3 = [v.x, v.y, v.z];
    const k = i / 13;
    // Anchura: crece hasta la mitad y se mantiene; las costillas caudales más cortas.
    const W = W0 * (0.42 + 0.58 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5));
    const sternal = i < 7;
    const stY = sternal ? st0[1] + (st1[1] - st0[1]) * (i / 6) : 0;
    const stZ = sternal ? st0[2] + (st1[2] - st0[2]) * (i / 6) : 0;
    const drop = 0.03 + 0.13 * k;
    const endY = sternal ? stY - 0.01 - 0.03 * k : T[1] - drop;
    const endZ = sternal ? stZ - 0.012 : T[2] + D0 * (0.75 - 0.5 * k);
    const endX = sternal ? 0.035 + 0.02 * k : W * (0.65 + 0.2 * k);
    const head: V3 = [0.013, T[1], T[2] - 0.004];
    const neck: V3 = [0.028, T[1] + 0.002, T[2] - 0.024];
    const angle: V3 = [0.045 + 0.15 * (W - 0.05), T[1] - 0.012, T[2] - 0.036];
    const back: V3 = [0.9 * W, T[1] - 0.3 * (T[1] - endY), T[2] + D0 * 0.12];
    const lat: V3 = [W, T[1] - 0.55 * (T[1] - endY), T[2] + D0 * 0.45];
    const ant: V3 = [0.75 * W + 0.25 * endX, T[1] - 0.82 * (T[1] - endY), endZ - 0.02];
    const end: V3 = [endX, endY, endZ];
    const rib = flatTube([head, neck, angle, back, lat, ant, end], (t) => {
      const flat = Math.min(1, t * 5);
      return [0.0045 - 0.0012 * flat, 0.0048 + 0.0035 * flat];
    }, outward, 40, 9);
    left.push(rib);
    ribsOut.push({ index: i + 1, side: 'L', mesh: rib }, { index: i + 1, side: 'R', mesh: mirrorX(rib) });
    // Cartílagos: esternales al esternón, asternales al anterior (arco costal).
    const target: V3 = sternal ? [0.012, stY, stZ + 0.004] : [endX * 0.85, endY + 0.03, endZ + 0.005];
    carts.push(flatTube([end, lerp3(end, target, 0.5), target], () => [0.0042, 0.0055], outward, 14, 8));
  }
  const ribs = mergeMeshes(left);
  const cart = mergeMeshes(carts);
  // Esternón: una barra larga y angosta de 6 esternebras alargadas, casi pegadas y unidas por cartílago
  // (manubrio más angosto arriba, xifoides ancho abajo). Discos sueltos se leían como huevos.
  const s = new SDF();
  s.symmetric = true;
  const axis = norm(sub(st1, st0));
  const segLen = len(sub(st1, st0)) / 6;
  s.cone(add(st0, [0, 0.004, 0.002]), add(st1, [0, 0, 0.002]), 0.0055, 0.0065, { k: 0.004 }); // cartílago continuo
  for (let i = 0; i < 6; i++) {
    const c = lerp3(st0, st1, (i + 0.5) / 6);
    const wide = i === 0 ? 0.0075 : 0.0105 + 0.0025 * Math.sin(((i - 1) / 4) * Math.PI);
    s.ellipsoidAlong([0, c[1], c[2] + 0.004], [segLen * 0.47, 0.0068, wide], axis, [0, 0, 1], { k: 0.0025 });
  }
  s.ellipsoidAlong(add(st0, [0, 0.022, 0.0]), [0.02, 0.006, 0.006], axis, [0, 0, 1], { k: 0.004 }); // manubrio
  s.cone(add(st1, [0, -0.01, 0.002]), add(st1, [0, -0.05, -0.006]), 0.008, 0.012, { k: 0.006 }); // xifoides ancho
  const sternum = polySDF(s, 0.0016, 2500);
  return [
    { slot: 'ribs', bone: 'Spine2', material: 'bone', mesh: ribs },
    { slot: 'ribs', bone: 'Spine2', material: 'bone', mesh: mirrorX(ribs) },
    { slot: 'ribs', bone: 'Spine2', material: 'bone', mesh: sternum },
    { slot: 'cartilage', bone: 'Spine2', material: 'cartilage', mesh: cart },
    { slot: 'cartilage', bone: 'Spine2', material: 'cartilage', mesh: mirrorX(cart) },
  ];
}

// ═══════════════════════════════ CINTURAS ═══════════════════════════════

/** Escápula larga y estrecha con espina y tuberosidad, sin acromion. Canónico: glenoide en el origen.
 *  En el cuadrúpedo la hoja sube hacia dorsal; montado en postura humana el dorso es la espalda,
 *  así que la hoja BAJA por detrás de las costillas (-Y) y se apoya hacia atrás y adentro. */
function pigScapulaSDF(): SDF {
  const s = new SDF();
  const g: V3 = [0, 0, 0];
  const bot: V3 = [-0.055, -0.2, -0.06];
  const botF: V3 = [-0.06, -0.19, -0.015];
  s.ellipsoid(g, [0.012, 0.016, 0.018]);
  s.cone([0, -0.004, -0.004], [-0.012, -0.035, -0.02], 0.012, 0.009, { k: 0.008 }); // cuello
  s.triangle([-0.01, -0.03, -0.032], bot, botF, 0.0024, { k: 0.008 });
  s.triangle([-0.01, -0.03, -0.032], [-0.012, -0.03, -0.004], botF, 0.0024, { k: 0.008 });
  s.chain([[-0.008, -0.03, -0.026], [-0.036, -0.13, -0.05], [-0.05, -0.19, -0.064]], [0.004, 0.006, 0.0035], { k: 0.006 }); // espina
  s.ellipsoid([-0.032, -0.115, -0.05], [0.008, 0.02, 0.012], undefined, { k: 0.006 }); // tuberosidad de la espina
  s.chain([bot, botF], [0.004, 0.004], { k: 0.005 }); // cartílago escapular (borde dorsal)
  s.sphere([0.004, 0.012, 0.012], 0.007, { k: 0.005 }); // tubérculo supraglenoideo
  return s;
}

/** Pelvis larga: íleon alargado hacia arriba, isquion largo y plano, sínfisis larga. Simétrica,
 *  canónica en un humano con caderas a ±0,09 y 0,0 de alto. */
function pigPelvisSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  const w = { k: 0.008 };
  const ac: V3 = [0.09, 0, 0];
  s.sphere(ac, 0.03, { k: 0.012 });
  s.sphere([0.098, -0.004, 0.006], 0.025, { op: 'sub', k: 0.003 });
  // Íleon: placa estrecha que sube y se abre poco (ala de cerdo).
  s.triangle([0.085, 0.03, -0.01], [0.075, 0.2, -0.045], [0.1, 0.19, 0.03], 0.003, w);
  s.triangle([0.085, 0.03, -0.01], [0.082, 0.02, 0.02], [0.1, 0.19, 0.03], 0.003, w);
  s.chain([[0.075, 0.2, -0.045], [0.092, 0.215, -0.008], [0.1, 0.19, 0.03]], [0.006, 0.007, 0.006], w); // cresta
  s.ellipsoid([0.085, 0.05, -0.008], [0.016, 0.04, 0.018], undefined, w);
  s.chain([[0.07, 0.18, -0.05], [0.045, 0.14, -0.06]], [0.008, 0.009], w); // articulación sacroilíaca
  // Isquion y pubis largos.
  s.cone([0.085, -0.025, -0.01], [0.07, -0.15, -0.04], 0.014, 0.012, w);
  s.ellipsoid([0.065, -0.16, -0.05], [0.016, 0.014, 0.02], undefined, w); // tuberosidad isquiática
  s.cone([0.075, -0.03, 0.025], [0.012, -0.06, 0.05], 0.01, 0.009, w);
  s.ellipsoid([0.01, -0.1, 0.035], [0.012, 0.05, 0.01], undefined, w); // sínfisis larga
  s.chain([[0.012, -0.14, 0.025], [0.04, -0.16, -0.01], [0.065, -0.162, -0.045]], [0.007, 0.007, 0.008], w);
  s.ellipsoid([0.045, -0.09, 0.005], [0.018, 0.035, 0.03], [0, -30, 0], { op: 'sub', k: 0.003 }); // foramen obturador
  // Sacro (4 vértebras fusionadas) y coxígeas.
  for (let i = 0; i < 4; i++) s.ellipsoid([0, 0.14 - i * 0.032, -0.06 - i * 0.004], [0.03 - i * 0.004, 0.016, 0.014], undefined, { k: 0.008 });
  s.ellipsoid([0.03, 0.14, -0.06], [0.018, 0.02, 0.016], undefined, { k: 0.01 }); // alas sacras
  s.chain([[0, 0.02, -0.075], [0, -0.03, -0.09], [0, -0.08, -0.1]], [0.006, 0.0045, 0.003], { k: 0.004 });
  return s;
}

// ═══════════════════════════════ MIEMBROS (canónicos a lo largo de -Y, L = 1) ═══════════════════════════════

// Los huesos largos del cerdo son cortos y MACIZOS: la diáfisis se angosta en el medio y los extremos se
// abren mucho (metáfisis anchas, cóndilos grandes). Nada de tubos parejos con bolitas en las puntas.

function pigHumerusSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.035 };
  s.sphere([0.0, -0.03, -0.07], 0.13); // cabeza, atrás
  s.ellipsoid([0.05, 0.04, 0.07], [0.11, 0.15, 0.11], undefined, k); // tubérculo mayor: sobrepasa la cabeza
  s.ellipsoid([-0.07, -0.05, 0.02], [0.07, 0.1, 0.09], undefined, k); // tubérculo menor
  // Diáfisis en S con metáfisis anchas.
  s.chain([[0.02, -0.14, 0.03], [0.01, -0.35, 0.05], [0.0, -0.55, 0.04], [-0.01, -0.74, 0.0], [0.0, -0.85, -0.01]], [0.12, 0.08, 0.068, 0.085, 0.12], k);
  s.ellipsoid([0.06, -0.3, 0.07], [0.04, 0.11, 0.05], undefined, k); // tuberosidad deltoidea
  // Cóndilo distal ancho con epicóndilos; fosa del olécranon detrás y surco de la tróclea delante.
  s.ellipsoidAlong([0.0, -0.93, 0.01], [0.15, 0.07, 0.09], [1, 0, 0], [0, 1, 0], k);
  s.ellipsoid([0.12, -0.88, -0.02], [0.04, 0.06, 0.05], undefined, k);
  s.ellipsoid([-0.12, -0.88, -0.02], [0.05, 0.065, 0.05], undefined, k);
  s.ellipsoid([0.0, -0.87, -0.085], [0.055, 0.07, 0.04], undefined, { op: 'sub', k: 0.012 });
  s.ellipsoid([0.0, -0.97, 0.07], [0.02, 0.05, 0.035], undefined, { op: 'sub', k: 0.01 });
  return s;
}

function pigForearmSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.025 };
  // Cúbito detrás, con el olécranon largo que sube por encima del codo.
  s.chain([[0.0, 0.22, -0.09], [0.0, 0.05, -0.07], [0.01, -0.5, -0.045], [0.02, -0.95, -0.03]], [0.06, 0.065, 0.042, 0.036], k);
  s.ellipsoid([0.0, 0.25, -0.1], [0.055, 0.05, 0.06], undefined, k); // tuberosidad del olécranon
  s.sphere([0.0, 0.02, 0.025], 0.06, { op: 'sub', k: 0.01 }); // escotadura donde entra el húmero
  // Radio delante, pegado al cúbito: cabeza ancha transversal, diáfisis que se ensancha abajo.
  s.ellipsoidAlong([0.0, -0.045, 0.035], [0.1, 0.035, 0.06], [1, 0, 0], [0, 1, 0], k);
  s.chain([[0.0, -0.07, 0.04], [0.0, -0.3, 0.055], [0.0, -0.6, 0.05], [0.0, -0.88, 0.035]], [0.07, 0.06, 0.065, 0.1], k);
  s.ellipsoidAlong([0.0, -0.95, 0.02], [0.12, 0.05, 0.08], [1, 0, 0], [0, 1, 0], k);
  s.ellipsoid([0.0, -0.97, -0.045], [0.05, 0.045, 0.04], undefined, k); // estiloides del cúbito
  return s;
}

/** Mano de cerdo: carpo, metacarpos III-IV largos, espolones II-V cortos y atrás, pezuñas. */
function pigManusSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.008 };
  for (const [x, y, z, r] of [[-0.065, -0.04, 0.0, 0.07], [0.065, -0.04, 0.0, 0.07], [0.0, -0.05, 0.02, 0.07], [-0.055, -0.13, 0.01, 0.065], [0.055, -0.13, 0.01, 0.065]] as const) {
    s.ellipsoid([x, y, z], [r, r * 0.8, r * 0.9], undefined, k);
  }
  for (const side of [-1, 1]) {
    const x = side * 0.055;
    s.cone([x, -0.18, 0.01], [x * 1.1, -0.55, 0.02], 0.058, 0.064, k); // metacarpo III/IV
    phalanges(s, [x * 1.1, -0.58, 0.02], [side * 0.05, -1, 0.15], [0.14, 0.09], [0.058, 0.052, 0.045], [0, 0, 1], 0.12, 0.008);
    // Pezuña (falange distal en cuña).
    s.ellipsoidAlong([x * 1.15, -0.88, 0.09], [0.12, 0.05, 0.06], [side * 0.05, -0.55, 1], [0, 1, 0], { k: 0.015 });
    // Espolón (II/V) corto, atrás y arriba.
    const xd = side * 0.13;
    s.cone([xd, -0.2, -0.04], [xd, -0.45, -0.07], 0.032, 0.028, k);
    s.ellipsoidAlong([xd, -0.55, -0.06], [0.07, 0.03, 0.035], [0, -1, 0.5], [0, 0, 1], k);
  }
  return s;
}

function pigFemurSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.03 };
  s.sphere([-0.075, 0.01, 0.0], 0.078); // cabeza (medial)
  s.cone([-0.06, 0.0, 0.0], [0.0, -0.07, 0.0], 0.05, 0.07, k); // cuello
  s.ellipsoid([0.06, 0.0, -0.02], [0.058, 0.095, 0.068], undefined, k); // trocánter mayor, a la altura de la cabeza
  s.ellipsoid([-0.035, -0.14, -0.045], [0.035, 0.04, 0.035], undefined, k); // trocánter menor
  s.chain([[0.02, -0.1, 0.0], [0.01, -0.3, 0.02], [0.0, -0.55, 0.025], [0.0, -0.78, 0.0], [0.0, -0.88, -0.01]], [0.1, 0.075, 0.066, 0.08, 0.12], k);
  // Cóndilos grandes atrás, fosa intercondílea y tróclea delante con su surco.
  s.ellipsoid([-0.052, -0.96, -0.03], [0.055, 0.07, 0.08], undefined, k);
  s.ellipsoid([0.052, -0.96, -0.03], [0.055, 0.07, 0.08], undefined, k);
  s.ellipsoid([0.0, -0.92, 0.06], [0.072, 0.08, 0.032], undefined, k);
  s.ellipsoid([0.0, -1.0, -0.06], [0.02, 0.05, 0.05], undefined, { op: 'sub', k: 0.008 });
  s.ellipsoid([0.0, -0.92, 0.092], [0.016, 0.07, 0.02], undefined, { op: 'sub', k: 0.008 });
  return s;
}

function pigLegSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.025 };
  // Tibia: meseta ancha, cresta tibial marcada delante, diáfisis triangular y extremo distal ancho.
  s.ellipsoidAlong([0.0, -0.04, -0.01], [0.13, 0.045, 0.09], [1, 0, 0], [0, 1, 0]);
  s.chain([[0.0, -0.07, 0.07], [0.0, -0.25, 0.05], [0.0, -0.45, 0.03]], [0.042, 0.03, 0.014], k);
  s.chain([[0.0, -0.08, 0.0], [-0.005, -0.4, 0.01], [-0.01, -0.75, 0.0], [-0.01, -0.9, 0.0]], [0.09, 0.06, 0.06, 0.09], k);
  s.ellipsoidAlong([-0.01, -0.96, 0.0], [0.1, 0.045, 0.075], [1, 0, 0], [0, 1, 0], k);
  s.ellipsoid([-0.09, -0.99, 0.0], [0.025, 0.05, 0.035], undefined, k); // maléolo medial
  // Peroné fino y PEGADO a la tibia por detrás y afuera (en el cerdo casi se funden abajo).
  s.chain([[0.092, -0.06, -0.04], [0.076, -0.4, -0.04], [0.07, -0.8, -0.03], [0.085, -0.97, -0.02]], [0.036, 0.018, 0.02, 0.036], { k: 0.015 });
  s.ellipsoid([0.097, -0.99, -0.02], [0.025, 0.05, 0.03], undefined, k); // maléolo lateral
  return s;
}

/** Pie de cerdo en postura humana: calcáneo largo atrás, metatarsos III-IV adelante, pezuñas al frente.
 *  Canónico: tobillo en el origen, el dedo final en +Z a distancia 1. */
function pigPesSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.02 };
  s.ellipsoid([0, -0.05, 0.02], [0.09, 0.07, 0.11]); // astrágalo
  s.chain([[0.01, -0.12, 0.0], [0.015, -0.2, -0.2], [0.01, -0.16, -0.34]], [0.07, 0.07, 0.085], k); // calcáneo largo
  s.ellipsoid([0, -0.17, 0.17], [0.12, 0.07, 0.09], undefined, k); // tarso
  for (const side of [-1, 1]) {
    const x = side * 0.055;
    s.cone([x, -0.2, 0.24], [x * 1.1, -0.3, 0.6], 0.055, 0.06, k);
    phalanges(s, [x * 1.1, -0.31, 0.62], [side * 0.05, -0.15, 1], [0.12, 0.08], [0.052, 0.047, 0.041], [0, -1, 0], 0.08, 0.008);
    s.ellipsoidAlong([x * 1.15, -0.37, 0.92], [0.12, 0.045, 0.058], [side * 0.03, -0.35, 1], [0, 1, 0], { k: 0.015 });
    s.cone([side * 0.13, -0.2, 0.3], [side * 0.14, -0.26, 0.5], 0.03, 0.026, k); // espolón
  }
  return s;
}

// ═══════════════════════════════ ENSAMBLE ═══════════════════════════════

export async function buildPigSkeleton(J: HumanJoints, progress: Progress = () => {}): Promise<{ pieces: BonePiece[]; ribs: PigRib[] }> {
  const j = J.joints;
  const ribs: PigRib[] = [];
  const v = 0.0018;
  const out: BonePiece[] = [];
  const steps: [string, () => void][] = [
    ['cráneo de cerdo', () => {
      const s = len(sub(j.HeadTop_End, j.Head)) / 0.22;
      const head = j.Head;
      const up = norm(sub(j.HeadTop_End, j.Head));
      const fwd = norm(cross([1, 0, 0], up));
      const m = frameMatrix(head, [s, 0, 0], scale(up, s), scale(fwd, s));
      out.push({ slot: 'skull', bone: 'Head', material: 'bone', mesh: transformMesh(polySDF(pigSkullSDF(), 0.0019, 26000), m) });
      out.push({ slot: 'skull', bone: 'Head', material: 'bone', mesh: transformMesh(polySDF(pigMandibleSDF(), 0.0016, 6000), m) });
      out.push({ slot: 'skull', bone: 'Head', material: 'teeth', mesh: transformMesh(polySDF(pigTeethSDF(), 0.0009, 7000, 0.003), m) });
      out.push({ slot: 'skull', bone: 'Head', material: 'soft', mesh: transformMesh(polySDF(pigFaceSDF(), 0.0026, 9000), m) });
    }],
    ['columna de cerdo', () => out.push(...pigVertebraPieces(J, v * 0.75))],
    ['tórax de cerdo', () => out.push(...pigRibCage(J, ribs))],
    ['escápulas y pelvis', () => {
      const scap = polySDF(pigScapulaSDF(), 0.0016, 6000);
      for (const side of [1, -1] as const) {
        const L = side > 0 ? 'Left' : 'Right';
        const glen = add(j[`${L}Arm` as BoneName], [-0.012 * side, 0.0, -0.03]);
        const m = transformMesh(side > 0 ? scap : mirrorMesh(scap), translateM(glen));
        out.push({ slot: `scapula_${side > 0 ? 'L' : 'R'}`, bone: `${L}Shoulder` as BoneName, material: 'bone', mesh: m });
      }
      // Pelvis: canónica con caderas a ±0,09; se escala al ancho real entre caderas.
      const hl = j.LeftUpLeg, hr = j.RightUpLeg;
      const mid = lerp3(hl, hr, 0.5);
      const sc = len(sub(hl, hr)) / 0.18;
      const pm = frameMatrix(mid, [sc, 0, 0], [0, sc, 0], [0, 0, sc]);
      out.push({ slot: 'pelvis', bone: 'Hips', material: 'bone', mesh: transformMesh(polySDF(pigPelvisSDF(), 0.0022, 18000), pm) });
    }],
    ['extremidades de cerdo', () => {
      const hum = polySDF(pigHumerusSDF(), 0.012, 4500);
      const fore = polySDF(pigForearmSDF(), 0.012, 5000);
      const man = polySDF(pigManusSDF(), 0.008, 8000);
      const fem = polySDF(pigFemurSDF(), 0.012, 5500);
      const leg = polySDF(pigLegSDF(), 0.012, 6000);
      const pes = polySDF(pigPesSDF(), 0.008, 8000);
      for (const side of [1, -1] as const) {
        const L = side > 0 ? 'Left' : 'Right';
        const tag = side > 0 ? 'L' : 'R';
        const lat = (m: MeshData) => (side > 0 ? m : mirrorMesh(m));
        const seg = (m: MeshData, a: BoneName, b: BoneName, thick: number) =>
          transformMesh(lat(m), segmentMatrix(j[a], j[b], 1, [0, 0, 1], thick));
        out.push({ slot: `humerus_${tag}`, bone: `${L}Arm` as BoneName, material: 'bone', mesh: seg(hum, `${L}Arm` as BoneName, `${L}ForeArm` as BoneName, 0.8) });
        out.push({ slot: `forearm_${tag}`, bone: `${L}ForeArm` as BoneName, material: 'bone', mesh: seg(fore, `${L}ForeArm` as BoneName, `${L}Hand` as BoneName, 0.8) });
        out.push({ slot: `hand_${tag}`, bone: `${L}Hand` as BoneName, material: 'bone', mesh: seg(man, `${L}Hand` as BoneName, `${L}Hand_End` as BoneName, 1.0) });
        out.push({ slot: `femur_${tag}`, bone: `${L}UpLeg` as BoneName, material: 'bone', mesh: seg(fem, `${L}UpLeg` as BoneName, `${L}Leg` as BoneName, 0.8) });
        out.push({ slot: `leg_${tag}`, bone: `${L}Leg` as BoneName, material: 'bone', mesh: seg(leg, `${L}Leg` as BoneName, `${L}Foot` as BoneName, 0.78) });
        // Pie: marco tobillo → punta, "arriba" = +Y del modelo.
        const a = j[`${L}Foot` as BoneName];
        const b = j[`${L}Toe_End` as BoneName];
        const fwd = norm(sub(b, a));
        const s = len(sub(b, a));
        const up: V3 = norm(sub([0, 1, 0], scale(fwd, fwd[1])));
        const x = cross(up, fwd);
        const pm = frameMatrix(a, scale(x, s * 0.95), scale(up, s * 0.95), scale(fwd, s * 1.05));
        out.push({ slot: `foot_${tag}`, bone: `${L}Foot` as BoneName, material: 'bone', mesh: transformMesh(lat(pes), pm) });
        // Rótula alargada.
        const ps = new SDF();
        ps.ellipsoid([0, 0, 0], [0.016, 0.03, 0.011]);
        const kn = j[`${L}Leg` as BoneName];
        out.push({ slot: `patella_${tag}`, bone: `${L}Leg` as BoneName, material: 'bone', mesh: transformMesh(polySDF(ps, 0.0015, 900), translateM(add(kn, [0, 0.02, 0.05]))) });
      }
    }],
  ];
  for (let i = 0; i < steps.length; i++) {
    await progress(i / steps.length, steps[i][0]);
    steps[i][1]();
  }
  await progress(1, 'cerdo');
  return { pieces: out, ribs };
}

function translateM(t: V3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}
