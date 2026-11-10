// Esqueleto humano PLACEHOLDER procedural (hasta que la Fase 2 traiga Z-Anatomy/BodyParts3D).
// Cada hueso se modela con primitivas SDF a partir de medidas anatómicas aproximadas de un
// adulto de 1,74 m y se poligoniza con Surface Nets. Las costillas son tubos de sección plana.
// Coordenadas: modelo en reposo (pose A), metros, origen en el bone Hips, mirando a +Z.
import { CatmullRomCurve3, Vector3 } from 'three';
import { armToA, REST, type BoneName } from './armature.ts';
import { gradientNormals, mergeMeshes, mirrorMesh, polygonize, transformMesh, type MeshData } from './polygonize.ts';
import { simplifyMesh } from './simplify.ts';
import { SDF, add, cross, len, lerp3, norm, scale, sub, type V3 } from './sdf.ts';

/** `soft`: tejido blando (la cara del cerdo, §9.4): se dibuja como sombra gris, no como hueso. */
export type BoneMaterial = 'bone' | 'teeth' | 'cartilage' | 'soft';

export interface BonePiece {
  /** Slot para el morph humano→cerdo (Fase 4), p. ej. "skull", "femur_L". */
  slot: string;
  bone: BoneName;
  material: BoneMaterial;
  mesh: MeshData;
}

type Progress = (f: number, label: string) => Promise<void>;

/** Poligoniza un SDF con caja automática a partir de sus primitivas y, si se pide,
 *  lo decima a `target` triángulos recalculando normales exactas desde el campo. */
export function polySDF(sdf: SDF, voxel: number, target = 0, pad = 0.006): MeshData {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of sdf.prims) {
    if (p.op !== 0) continue;
    for (let a = 0; a < 3; a++) {
      const c = [p.sx, p.sy, p.sz][a];
      min[a] = Math.min(min[a], c - p.sr);
      max[a] = Math.max(max[a], c + p.sr);
    }
  }
  if (sdf.symmetric) {
    const m = Math.max(Math.abs(min[0]), Math.abs(max[0]));
    min[0] = -m;
    max[0] = m;
  }
  for (let a = 0; a < 3; a++) {
    min[a] -= pad;
    max[a] += pad;
  }
  const f = (x: number, y: number, z: number) => sdf.eval(x, y, z);
  const mesh = polygonize(f, min, max, voxel);
  if (!target || mesh.indices.length / 3 <= target) return mesh;
  const s = simplifyMesh(mesh, target);
  s.normals = gradientNormals(s.positions, f, voxel * 0.5);
  return s;
}

/** Matriz column-major: rotación por base ortonormal + escala uniforme + traslación. */
export function frameMatrix(origin: V3, xAxis: V3, yAxis: V3, zAxis: V3, s = 1): number[] {
  return [
    xAxis[0] * s, xAxis[1] * s, xAxis[2] * s, 0,
    yAxis[0] * s, yAxis[1] * s, yAxis[2] * s, 0,
    zAxis[0] * s, zAxis[1] * s, zAxis[2] * s, 0,
    origin[0], origin[1], origin[2], 1,
  ];
}

const translate = (m: MeshData, t: V3) => transformMesh(m, frameMatrix(t, [1, 0, 0], [0, 1, 0], [0, 0, 1]));

/** Transforma una malla del brazo izquierdo canónico (en T) a la pose A del lado pedido. */
function armMesh(m: MeshData, side: 1 | -1): MeshData {
  const o = armToA([0, 0, 0], 1);
  const ex = sub(armToA([1, 0, 0], 1), o);
  const ey = sub(armToA([0, 1, 0], 1), o);
  const ez = sub(armToA([0, 0, 1], 1), o);
  const left = transformMesh(m, frameMatrix(o, ex, ey, ez));
  return side > 0 ? left : mirrorMesh(left);
}

// ═══════════════════════════════ COLUMNA ═══════════════════════════════

/** Cuerpos vertebrales (centro) de L5 a C1: [nombre, y, z, escala, tipo]. */
const SPINE: [string, number, number, number, 'L' | 'T' | 'C' | 'C1' | 'C2' | 'C7'][] = [
  ['L5', 0.055, -0.03, 1.05, 'L'], ['L4', 0.087, -0.022, 1.03, 'L'], ['L3', 0.119, -0.02, 1.0, 'L'],
  ['L2', 0.15, -0.024, 0.97, 'L'], ['L1', 0.18, -0.032, 0.94, 'L'],
  ['T12', 0.207, -0.04, 1.08, 'T'], ['T11', 0.229, -0.046, 1.05, 'T'], ['T10', 0.25, -0.052, 1.02, 'T'],
  ['T9', 0.271, -0.057, 0.99, 'T'], ['T8', 0.292, -0.061, 0.96, 'T'], ['T7', 0.313, -0.064, 0.93, 'T'],
  ['T6', 0.334, -0.065, 0.9, 'T'], ['T5', 0.354, -0.064, 0.88, 'T'], ['T4', 0.374, -0.062, 0.86, 'T'],
  ['T3', 0.394, -0.058, 0.85, 'T'], ['T2', 0.414, -0.054, 0.86, 'T'], ['T1', 0.434, -0.05, 0.88, 'T'],
  ['C7', 0.452, -0.045, 1.05, 'C7'], ['C6', 0.467, -0.038, 1.0, 'C'], ['C5', 0.481, -0.032, 0.97, 'C'],
  ['C4', 0.495, -0.028, 0.95, 'C'], ['C3', 0.509, -0.026, 0.95, 'C'], ['C2', 0.523, -0.026, 1.0, 'C2'],
  ['C1', 0.54, -0.024, 1.0, 'C1'],
];

function vertebraBone(name: string): BoneName {
  if (name.startsWith('C') && name !== 'C7') return 'Neck';
  if (name === 'L5') return 'Hips';
  if (['L4', 'L3', 'L2'].includes(name)) return 'Spine';
  if (['L1', 'T12', 'T11', 'T10'].includes(name)) return 'Spine1';
  return 'Spine2';
}

export function lumbarSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.ellipsoid([0, 0, 0], [0.025, 0.016, 0.018]);
  s.box([0, 0, 0], [0.05, 0.0125, 0.05], 0.0015, undefined, { op: 'int', k: 0.003 });
  s.ellipsoid([0, 0, 0.004], [0.022, 0.011, 0.012], undefined, { op: 'sub', k: 0.004 }); // cintura cóncava
  s.ellipsoid([0, 0, 0], [0.0235, 0.0122, 0.0165], undefined, { k: 0.002 });
  s.cone([0.011, 0.002, -0.012], [0.012, 0.002, -0.024], 0.005, 0.0048, { k: 0.003 });
  s.cone([0.012, 0.0, -0.024], [0, -0.002, -0.032], 0.0045, 0.0042, { k: 0.003 });
  s.ellipsoid([0, -0.004, -0.046], [0.004, 0.011, 0.013], undefined, { k: 0.004 });
  s.cone([0.013, 0.002, -0.021], [0.038, 0.004, -0.025], 0.0045, 0.003, { k: 0.003 });
  s.sphere([0.014, 0.012, -0.027], 0.005, { k: 0.003 });
  s.sphere([0.011, -0.012, -0.03], 0.0045, { k: 0.003 });
  s.cone([0, -0.03, -0.021], [0, 0.03, -0.021], 0.0085, 0.0085, { op: 'sub', k: 0.002 });
  return s;
}

function thoracicSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.ellipsoid([0, 0, 0], [0.017, 0.012, 0.015]);
  s.box([0, 0, 0], [0.04, 0.0095, 0.04], 0.0012, undefined, { op: 'int', k: 0.0025 });
  s.cone([0.008, 0.003, -0.011], [0.009, 0.003, -0.018], 0.0038, 0.0038, { k: 0.0025 });
  s.cone([0.009, 0.0, -0.018], [0, -0.004, -0.026], 0.0038, 0.0036, { k: 0.0025 });
  s.cone([0, -0.004, -0.026], [0, -0.026, -0.048], 0.004, 0.0028, { k: 0.003 });
  s.cone([0.009, 0.004, -0.017], [0.027, 0.006, -0.026], 0.0042, 0.0036, { k: 0.0025 });
  s.sphere([0.009, 0.011, -0.019], 0.0035, { k: 0.002 });
  s.sphere([0.015, 0.004, 0.004], 0.003, { k: 0.002 }); // carilla costal
  s.cone([0, -0.03, -0.016], [0, 0.03, -0.016], 0.0068, 0.0068, { op: 'sub', k: 0.0015 });
  return s;
}

export function cervicalSDF(kind: 'C' | 'C7'): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.ellipsoid([0, 0, 0], [0.012, 0.0075, 0.0095]);
  s.box([0, 0, 0], [0.03, 0.006, 0.03], 0.001, undefined, { op: 'int', k: 0.002 });
  s.sphere([0.01, 0.006, 0.0], 0.003, { k: 0.002 });
  s.cone([0.008, 0.001, -0.007], [0.011, 0.001, -0.013], 0.003, 0.003, { k: 0.002 });
  s.ellipsoid([0.016, 0, -0.014], [0.005, 0.008, 0.006], undefined, { k: 0.002 });
  s.cone([0.014, -0.001, -0.017], [0, -0.002, -0.024], 0.0028, 0.0028, { k: 0.002 });
  if (kind === 'C7') s.cone([0, -0.002, -0.024], [0, -0.012, -0.046], 0.0035, 0.0032, { k: 0.002 });
  else s.cone([0, -0.002, -0.024], [0.004, -0.008, -0.034], 0.003, 0.0022, { k: 0.002 });
  s.cone([0.01, 0.002, -0.004], [0.024, 0.0, -0.008], 0.0035, 0.003, { k: 0.002 });
  s.sphere([0.018, 0.001, -0.006], 0.0024, { op: 'sub', k: 0.001 });
  s.cone([0, -0.02, -0.014], [0, 0.02, -0.014], 0.0075, 0.0075, { op: 'sub', k: 0.0015 });
  return s;
}

function atlasSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.cone([0, 0, 0.004], [0.014, 0, -0.004], 0.0035, 0.004);
  s.ellipsoid([0.017, 0, -0.01], [0.006, 0.006, 0.009], undefined, { k: 0.003 });
  s.cone([0.017, 0, -0.018], [0, -0.001, -0.03], 0.0032, 0.003, { k: 0.003 });
  s.cone([0.022, 0, -0.01], [0.035, 0, -0.012], 0.0042, 0.0035, { k: 0.003 });
  s.sphere([0.03, 0, -0.011], 0.0022, { op: 'sub', k: 0.001 });
  return s;
}

function axisSDF(): SDF {
  const s = cervicalSDF('C');
  s.cone([0, 0.006, 0.0], [0, 0.021, -0.002], 0.0045, 0.0035, { k: 0.003 }); // apófisis odontoides
  return s;
}

function spinePieces(voxel: number): BonePiece[] {
  const types = {
    L: polySDF(lumbarSDF(), voxel, 1800),
    T: polySDF(thoracicSDF(), voxel, 1500),
    C: polySDF(cervicalSDF('C'), voxel * 0.8, 1100),
    C7: polySDF(cervicalSDF('C7'), voxel * 0.8, 1200),
    C1: polySDF(atlasSDF(), voxel * 0.8, 900),
    C2: polySDF(axisSDF(), voxel * 0.8, 1200),
  };
  const curve = new CatmullRomCurve3(SPINE.map(([, y, z]) => new Vector3(0, y, z)), false, 'centripetal');
  const n = SPINE.length;
  const out: BonePiece[] = [];
  SPINE.forEach(([name, y, z, s, type], i) => {
    const t = curve.getTangent(i / (n - 1));
    const up: V3 = norm([0, t.y, t.z]);
    const fwd = norm(cross([1, 0, 0], up));
    const m = transformMesh(types[type], frameMatrix([0, y, z], [1, 0, 0], up, fwd, s));
    const slot = type === 'L' ? 'lumbar' : type === 'T' ? 'thoracic' : 'cervical';
    out.push({ slot, bone: vertebraBone(name), material: 'bone', mesh: m });
  });
  return out;
}

// ═══════════════════════════════ CAJA TORÁCICA ═══════════════════════════════

/** Tubo por una curva con sección elíptica orientada (rN hacia afuera, rB a lo largo de la caja). */
export function flatTube(pts: V3[], radius: (t: number) => [number, number], outward: (p: V3) => V3, segs = 48, radial = 10): MeshData {
  const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), false, 'centripetal');
  const rings: { c: V3; n: V3; b: V3; t: V3; rn: number; rb: number }[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const c = curve.getPointAt(u);
    const tg = curve.getTangentAt(u);
    const T: V3 = [tg.x, tg.y, tg.z];
    let N = outward([c.x, c.y, c.z]);
    N = norm(sub(N, scale(T, N[0] * T[0] + N[1] * T[1] + N[2] * T[2])));
    const B = norm(cross(T, N));
    const [rn, rb] = radius(u);
    rings.push({ c: [c.x, c.y, c.z], n: N, b: B, t: T, rn, rb });
  }
  // Tapas redondeadas: anillos que se achican avanzando por la tangente.
  const capRings = (r: (typeof rings)[number], dir: number) =>
    [0.55, 0.85, 1].map((k) => {
      const f = Math.sqrt(Math.max(0, 1 - k * k));
      return { ...r, c: add(r.c, scale(r.t, dir * k * Math.min(r.rn, r.rb) * 0.9)), rn: r.rn * f, rb: r.rb * f };
    });
  const all = [...capRings(rings[0], -1).reverse(), ...rings, ...capRings(rings[rings.length - 1], 1)];
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  all.forEach((r) => {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos.push(...add(r.c, add(scale(r.n, ca * r.rn), scale(r.b, sa * r.rb))));
      // Normal de la elipse.
      const nn = norm(add(scale(r.n, ca / Math.max(r.rn, 1e-5)), scale(r.b, sa / Math.max(r.rb, 1e-5))));
      nor.push(...nn);
    }
  });
  const R = all.length;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Cierra los polos.
  const first = pos.length / 3;
  pos.push(...all[0].c);
  nor.push(...scale(all[0].t, -1));
  const last = first + 1;
  pos.push(...all[R - 1].c);
  nor.push(...all[R - 1].t);
  for (let j = 0; j < radial; j++) {
    idx.push(first, j, (j + 1) % radial);
    idx.push(last, (R - 1) * radial + ((j + 1) % radial), (R - 1) * radial + j);
  }
  const mesh: MeshData = { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
  fixWinding(mesh);
  return mesh;
}

/** Orienta el winding según las normales (los tubos se generan con orientación arbitraria). */
function fixWinding(m: MeshData): void {
  const p = m.positions, n = m.normals, idx = m.indices;
  let score = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1: V3 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
    const e2: V3 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
    const f = cross(e1, e2);
    score += Math.sign(f[0] * n[a * 3] + f[1] * n[a * 3 + 1] + f[2] * n[a * 3 + 2]);
  }
  if (score < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
}

/** Profundidad del esternón (z de su cara posterior) a una altura y. */
const sternumZ = (y: number) => 0.054 + ((0.405 - y) / 0.16) * 0.046;

const RIB_W = [0.058, 0.086, 0.104, 0.117, 0.126, 0.131, 0.134, 0.134, 0.131, 0.125, 0.113, 0.094];
const STERNAL_Y = [0.398, 0.374, 0.35, 0.326, 0.303, 0.282, 0.262];
const STERNAL_X = [0.024, 0.021, 0.019, 0.018, 0.017, 0.015, 0.012];
const CART_RISE = [0.0, 0.004, 0.01, 0.016, 0.024, 0.036, 0.05];
const RIB_A = [0.045, 0.058, 0.066, 0.072, 0.078, 0.084, 0.09, 0.098, 0.104, 0.108, 0.112, 0.088];
const LOWER_END_Y = [0.178, 0.162, 0.152, 0.17, 0.168];
const LOWER_END_Z = [0.075, 0.064, 0.05, -0.008, -0.045];

function ribCagePieces(): BonePiece[] {
  const out: BonePiece[] = [];
  const left: MeshData[] = [];
  const cartL: MeshData[] = [];
  const cartMid: V3[] = [];
  const outward = (p: V3): V3 => [p[0], 0, p[2] + 0.005];
  for (let i = 1; i <= 12; i++) {
    const [, Ty, Tz] = SPINE.find(([n]) => n === `T${i}`)!;
    const W = RIB_W[i - 1];
    const A = RIB_A[i - 1];
    let end: V3;
    if (i <= 7) {
      const yEnd = STERNAL_Y[i - 1] - CART_RISE[i - 1];
      const zEnd = sternumZ(yEnd) - 0.006 - 0.02 * ((A - 0.03) / 0.08);
      end = [A, yEnd, zEnd];
    } else {
      end = [i >= 11 ? W * 0.96 : A, LOWER_END_Y[i - 8], LOWER_END_Z[i - 8]];
    }
    const drop = Ty - end[1];
    const head: V3 = [0.014, Ty, Tz - 0.004];
    const neck: V3 = [0.03, Ty + 0.001, Tz - 0.022];
    const angle: V3 = [0.052 + 0.2 * (W - 0.06), Ty - 0.1 * drop, Tz - 0.033];
    const zLat = i >= 11 ? -0.03 : -0.008;
    const back: V3 = [0.86 * W, Ty - 0.3 * drop, 0.55 * angle[2] + 0.45 * zLat];
    const lat: V3 = [W, Ty - 0.55 * drop, zLat];
    let pts: V3[];
    if (i === 1) {
      pts = [head, [0.028, Ty, Tz - 0.012], [0.045, Ty - 0.008, Tz + 0.002], [0.056, Ty - 0.02, 0.0], [0.054, Ty - 0.03, 0.03], end];
    } else if (i >= 11) {
      pts = [head, neck, angle, back, [W * 0.99, Ty - 0.7 * drop, (zLat + end[2]) / 2], end];
    } else {
      const ant: V3 = [0.8 * W + 0.2 * A, Ty - 0.82 * drop, 0.5 * (zLat + end[2]) + 0.022];
      pts = [head, neck, angle, back, lat, ant, end];
    }
    const big = i >= 2 && i <= 10 ? 1 : 0.85;
    left.push(
      flatTube(pts, (t) => {
        // Redonda en la cabeza, plana en el cuerpo, algo más gruesa en el extremo anterior.
        const flat = Math.min(1, t * 5);
        const rn = (0.0042 - 0.0012 * flat + 0.0006 * Math.max(0, t - 0.85) * 6) * big;
        const rb = (0.0042 + 0.0028 * flat) * big;
        return [rn, rb];
      }, outward, 44, 9),
    );
    // Cartílagos costales.
    if (i <= 10) {
      let target: V3;
      if (i <= 7) target = [STERNAL_X[i - 1], STERNAL_Y[i - 1], sternumZ(STERNAL_Y[i - 1]) + 0.002];
      else target = cartMid[i - 2];
      const mid = lerp3(end, target, 0.5);
      const bulge: V3 = [mid[0], mid[1] + (i >= 6 ? 0.012 : 0.002), mid[2] + 0.008];
      const cpts: V3[] = [end, bulge, target];
      const curve = new CatmullRomCurve3(cpts.map((p) => new Vector3(...p)));
      const m = curve.getPointAt(0.45);
      cartMid.push([m.x, m.y, m.z]);
      cartL.push(flatTube(cpts, () => [0.0042, 0.0058], outward, 20, 8));
    }
  }
  const ribs = mergeMeshes(left);
  const carts = mergeMeshes(cartL);
  out.push({ slot: 'ribs', bone: 'Spine2', material: 'bone', mesh: ribs });
  out.push({ slot: 'ribs', bone: 'Spine2', material: 'bone', mesh: mirrorMesh(ribs) });
  out.push({ slot: 'cartilage', bone: 'Spine2', material: 'cartilage', mesh: carts });
  out.push({ slot: 'cartilage', bone: 'Spine2', material: 'cartilage', mesh: mirrorMesh(carts) });
  return out;
}

function sternumSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  const tilt: V3 = [-16, 0, 0];
  s.ellipsoid([0, 0.385, sternumZ(0.385) + 0.005], [0.026, 0.021, 0.0065], tilt);
  s.sphere([0, 0.412, sternumZ(0.405) + 0.004], 0.01, { op: 'sub', k: 0.004 });
  for (const [y, w] of [[0.352, 0.0155], [0.322, 0.0165], [0.292, 0.0175], [0.264, 0.016]] as const) {
    s.ellipsoid([0, y, sternumZ(y) + 0.005], [w, 0.021, 0.0055], tilt, { k: 0.008 });
  }
  s.cone([0, 0.247, sternumZ(0.247) + 0.005], [0, 0.223, sternumZ(0.223) + 0.002], 0.0055, 0.003, { k: 0.005 });
  for (const y of STERNAL_Y) s.sphere([0.014, y, sternumZ(y) + 0.004], 0.0045, { k: 0.004 }); // escotaduras costales
  return s;
}

// ═══════════════════════════════ CINTURA ESCAPULAR ═══════════════════════════════

function claviclePiece(voxel: number): MeshData {
  const s = new SDF();
  s.chain(
    [[0.024, 0.408, 0.056], [0.055, 0.418, 0.062], [0.09, 0.428, 0.05], [0.125, 0.438, 0.026], [0.15, 0.446, 0.002], [0.164, 0.451, -0.013]],
    [0.008, 0.0066, 0.006, 0.0058, 0.0064, 0.0068],
    { k: 0.004 },
  );
  s.ellipsoid([0.16, 0.45, -0.009], [0.009, 0.0045, 0.009], undefined, { k: 0.004 });
  return polySDF(s, voxel, 2200);
}

function scapulaPiece(voxel: number): MeshData {
  const s = new SDF();
  const S: V3 = [0.062, 0.437, -0.093];
  const M: V3 = [0.064, 0.398, -0.106];
  const I: V3 = [0.09, 0.272, -0.103];
  const Lg: V3 = [0.138, 0.412, -0.05];
  const Lb: V3 = [0.124, 0.35, -0.078];
  const o = { k: 0.006 };
  s.triangle(S, M, Lg, 0.0022, o);
  s.triangle(M, I, Lb, 0.0022, o);
  s.triangle(M, Lb, Lg, 0.0022, o);
  s.chain([Lg, Lb, I], [0.0062, 0.0052, 0.0046], o);
  s.chain([S, M, I], [0.003, 0.0035, 0.0046], o);
  s.chain([S, [0.1, 0.43, -0.075], [0.126, 0.425, -0.056]], [0.003, 0.0026, 0.003], o);
  s.chain([M, [0.095, 0.41, -0.114], [0.128, 0.428, -0.1], [0.155, 0.448, -0.07], [0.168, 0.457, -0.038]], [0.003, 0.0055, 0.006, 0.0055, 0.005], o);
  s.ellipsoid([0.171, 0.459, -0.02], [0.017, 0.0055, 0.021], [0, 20, -10], o);
  s.cone([0.138, 0.412, -0.05], [0.145, 0.423, -0.033], 0.008, 0.009, o);
  s.ellipsoid([0.148, 0.424, -0.029], [0.006, 0.018, 0.012], undefined, o);
  s.ellipsoid([0.149, 0.414, -0.028], [0.0055, 0.009, 0.0125], undefined, { k: 0.004 });
  s.chain([[0.13, 0.432, -0.042], [0.133, 0.442, -0.022], [0.143, 0.436, 0.006]], [0.006, 0.0055, 0.0045], o);
  return polySDF(s, voxel, 7000);
}

// ═══════════════════════════════ PELVIS ═══════════════════════════════

function pelvisSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  const ASIS: V3 = [0.112, 0.042, 0.062];
  const C1: V3 = [0.138, 0.075, 0.03];
  const C2: V3 = [0.142, 0.092, -0.01];
  const C3: V3 = [0.125, 0.095, -0.045];
  const C4: V3 = [0.09, 0.08, -0.07];
  const PSIS: V3 = [0.05, 0.058, -0.078];
  const AIIS: V3 = [0.1, 0.01, 0.05];
  const B1: V3 = [0.085, -0.004, -0.01];
  const B2: V3 = [0.07, 0.002, -0.05];
  const SI: V3 = [0.055, 0.035, -0.068];
  const w = { k: 0.008 };
  // Ala ilíaca: abanico de placas finas entre la base y la cresta.
  for (const [a, b, c] of [
    [AIIS, ASIS, C1], [AIIS, C1, B1], [B1, C1, C2], [B1, C2, C3], [B1, C3, B2], [B2, C3, C4], [B2, C4, SI], [SI, C4, PSIS],
  ] as [V3, V3, V3][]) {
    s.triangle(a, b, c, 0.0026, w);
  }
  s.chain([ASIS, C1, C2, C3, C4, PSIS], [0.006, 0.0065, 0.007, 0.0065, 0.006, 0.0065], w);
  s.chain([ASIS, AIIS, [0.09, -0.012, 0.036]], [0.0055, 0.006, 0.008], w);
  s.chain([PSIS, SI, B2, [0.075, -0.036, -0.038]], [0.006, 0.008, 0.007, 0.006], w);
  s.ellipsoid([0.086, -0.012, -0.004], [0.022, 0.03, 0.03], undefined, w);
  // Acetábulo.
  s.sphere([0.09, -0.04, 0.0], 0.031, { k: 0.012 });
  s.cone([0.075, -0.045, 0.028], [0.022, -0.06, 0.064], 0.0105, 0.0085, w);
  s.ellipsoid([0.012, -0.072, 0.064], [0.013, 0.02, 0.011], undefined, w);
  s.chain([[0.012, -0.088, 0.058], [0.035, -0.105, 0.035], [0.058, -0.118, 0.0]], [0.007, 0.0065, 0.008], w);
  s.cone([0.085, -0.06, -0.01], [0.065, -0.112, -0.018], 0.015, 0.012, w);
  s.ellipsoid([0.062, -0.12, -0.012], [0.012, 0.012, 0.018], undefined, w);
  s.ellipsoid([0.052, -0.083, 0.028], [0.019, 0.019, 0.03], [0, -35, 0], { op: 'sub', k: 0.003 });
  s.sphere([0.098, -0.044, 0.004], 0.026, { op: 'sub', k: 0.003 });
  // Sacro y cóccix.
  const sk = { k: 0.008 };
  s.ellipsoid([0, 0.022, -0.052], [0.05, 0.02, 0.022], undefined, sk);
  s.ellipsoid([0.04, 0.032, -0.062], [0.022, 0.022, 0.018], undefined, { k: 0.012 });
  s.ellipsoid([0, 0.0, -0.068], [0.04, 0.018, 0.015], undefined, sk);
  s.ellipsoid([0, -0.022, -0.078], [0.031, 0.016, 0.011], undefined, sk);
  s.ellipsoid([0, -0.041, -0.084], [0.021, 0.013, 0.009], undefined, sk);
  s.ellipsoid([0, -0.055, -0.085], [0.013, 0.01, 0.007], undefined, sk);
  s.chain([[0, -0.062, -0.084], [0, -0.075, -0.08], [0, -0.085, -0.072]], [0.006, 0.0045, 0.003], { k: 0.004 });
  for (const p of [[0.017, 0.008, -0.04], [0.015, -0.014, -0.056], [0.012, -0.034, -0.07]] as V3[]) {
    s.sphere(p, 0.0042, { op: 'sub', k: 0.002 });
  }
  return s;
}

// ═══════════════════════════════ MIEMBRO INFERIOR (izq.) ═══════════════════════════════

function femurSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.008 };
  s.sphere([0, 0, 0], 0.0235);
  s.cone([0.004, -0.004, 0], [0.036, -0.03, -0.004], 0.0145, 0.016, k);
  s.ellipsoid([0.048, -0.024, -0.008], [0.014, 0.022, 0.017], undefined, k);
  s.cone([0.045, -0.03, -0.006], [0.025, -0.062, -0.01], 0.012, 0.012, k);
  s.sphere([0.022, -0.064, -0.014], 0.0085, k);
  s.chain([[0.038, -0.055, -0.002], [0.024, -0.2, 0.006], [0.008, -0.36, 0.002]], [0.0155, 0.0135, 0.0145], k);
  s.cone([0.03, -0.12, -0.012], [0.016, -0.3, -0.01], 0.004, 0.004, { k: 0.006 });
  s.ellipsoid([0.004, -0.39, -0.002], [0.03, 0.028, 0.024], undefined, k);
  s.ellipsoid([-0.016, -0.413, -0.008], [0.016, 0.02, 0.026], undefined, k);
  s.ellipsoid([0.022, -0.413, -0.008], [0.015, 0.019, 0.025], undefined, k);
  s.ellipsoid([0.003, -0.428, -0.022], [0.008, 0.012, 0.016], undefined, { op: 'sub', k: 0.003 });
  s.ellipsoid([0.003, -0.405, 0.027], [0.009, 0.02, 0.006], undefined, { op: 'sub', k: 0.003 });
  return s;
}

function tibiaSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.008 };
  s.ellipsoid([0.003, -0.018, -0.004], [0.037, 0.014, 0.026]);
  s.ellipsoid([-0.017, -0.002, -0.004], [0.013, 0.005, 0.016], undefined, { op: 'sub', k: 0.002 });
  s.ellipsoid([0.021, -0.002, -0.006], [0.013, 0.005, 0.016], undefined, { op: 'sub', k: 0.002 });
  s.sphere([0.002, -0.007, -0.004], 0.005, { k: 0.003 });
  s.cone([0.002, -0.025, -0.002], [0.0, -0.08, 0.004], 0.028, 0.018, k);
  s.ellipsoid([0.004, -0.055, 0.022], [0.009, 0.014, 0.006], undefined, k);
  s.chain([[0.0, -0.08, 0.004], [-0.003, -0.22, 0.004], [-0.005, -0.35, 0.0]], [0.0165, 0.0135, 0.0135], k);
  s.cone([0.001, -0.07, 0.016], [-0.003, -0.3, 0.011], 0.0045, 0.0035, { k: 0.006 });
  s.ellipsoid([-0.004, -0.383, 0.0], [0.022, 0.017, 0.021], undefined, k);
  s.cone([-0.017, -0.385, 0.002], [-0.02, -0.408, 0.002], 0.0085, 0.006, k);
  return s;
}

function fibulaSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.006 };
  s.ellipsoid([0.031, -0.036, -0.014], [0.01, 0.011, 0.01]);
  s.chain([[0.03, -0.045, -0.013], [0.028, -0.2, -0.012], [0.025, -0.37, -0.008]], [0.0065, 0.0055, 0.006], k);
  s.ellipsoid([0.025, -0.398, -0.006], [0.0085, 0.018, 0.011], undefined, k);
  return s;
}

function patellaSDF(): SDF {
  const s = new SDF();
  s.ellipsoid([0.002, 0.015, 0.042], [0.021, 0.024, 0.0095], [10, 0, 0]);
  return s;
}

function footSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.003 };
  s.ellipsoid([0, -0.014, 0.006], [0.016, 0.012, 0.024]);
  s.sphere([-0.006, -0.022, 0.03], 0.011, k);
  s.ellipsoid([0.004, -0.045, -0.03], [0.017, 0.02, 0.034], undefined, k);
  s.sphere([0.003, -0.05, -0.058], 0.016, k);
  s.ellipsoid([-0.014, -0.03, -0.006], [0.008, 0.005, 0.01], undefined, k);
  s.ellipsoid([-0.012, -0.026, 0.044], [0.015, 0.011, 0.008], undefined, k);
  s.ellipsoid([0.017, -0.043, 0.034], [0.011, 0.011, 0.015], undefined, k);
  s.ellipsoid([-0.017, -0.033, 0.058], [0.008, 0.012, 0.01], undefined, k);
  s.ellipsoid([-0.004, -0.031, 0.06], [0.006, 0.01, 0.009], undefined, k);
  s.ellipsoid([0.007, -0.035, 0.057], [0.006, 0.01, 0.009], undefined, k);
  const meta: [V3, V3, number, number][] = [
    [[-0.019, -0.04, 0.07], [-0.024, -0.058, 0.126], 0.0085, 0.0095],
    [[-0.005, -0.036, 0.07], [-0.008, -0.057, 0.132], 0.0052, 0.0058],
    [[0.006, -0.038, 0.066], [0.007, -0.058, 0.126], 0.005, 0.0056],
    [[0.016, -0.041, 0.06], [0.02, -0.059, 0.117], 0.0048, 0.0054],
    [[0.025, -0.046, 0.048], [0.033, -0.06, 0.106], 0.0055, 0.005],
  ];
  for (const [a, b, r1, r2] of meta) s.cone(a, b, r1, r2, { k: 0.002 });
  const toes: [V3, V3, number[], number[]][] = [
    [[-0.025, -0.06, 0.14], [0.08, -0.13, 1], [0.026, 0.02], [0.0075, 0.0066, 0.006]],
    [[-0.009, -0.059, 0.144], [0.0, -0.12, 1], [0.022, 0.013, 0.01], [0.0045, 0.004, 0.0037, 0.0032]],
    [[0.008, -0.06, 0.137], [0.03, -0.12, 1], [0.02, 0.012, 0.009], [0.0043, 0.0038, 0.0035, 0.003]],
    [[0.021, -0.061, 0.127], [0.08, -0.12, 1], [0.018, 0.011, 0.008], [0.004, 0.0036, 0.0033, 0.0029]],
    [[0.035, -0.062, 0.115], [0.15, -0.12, 1], [0.015, 0.009, 0.007], [0.0038, 0.0034, 0.003, 0.0027]],
  ];
  for (const [start, dir, lens, radii] of toes) phalanges(s, start, dir, lens, radii, [0, -1, 0], 0.12, 0.0012);
  return s;
}

/** Falanges con pequeños espacios articulares (se ven en una radiografía). */
export function phalanges(s: SDF, start: V3, dir: V3, lens: number[], radii: number[], curlAxisRef: V3, curl: number, gap: number): void {
  let p = start;
  let d = norm(dir);
  for (let i = 0; i < lens.length; i++) {
    const a = add(p, scale(d, gap));
    const b = add(p, scale(d, lens[i] - gap));
    s.cone(a, b, radii[i], radii[i + 1] ?? radii[i] * 0.85, { k: 0.0015 });
    p = add(p, scale(d, lens[i]));
    // Flexión suave hacia la palma/planta.
    d = norm(add(scale(d, Math.cos(curl)), scale(curlAxisRef, Math.sin(curl))));
  }
}

// ═══════════════════════════════ MIEMBRO SUPERIOR (izq., en T) ═══════════════════════════════

function humerusSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.007 };
  s.sphere([-0.002, 0.004, -0.004], 0.0235);
  s.ellipsoid([0.012, 0.012, 0.01], [0.014, 0.012, 0.013], undefined, k);
  s.sphere([0.014, -0.002, 0.016], 0.008, k);
  s.cone([0.012, 0.002, 0.0], [0.05, 0.0, 0.0], 0.017, 0.0125, k);
  s.chain([[0.05, 0, 0], [0.15, 0.002, 0.002], [0.25, 0, 0]], [0.0125, 0.0115, 0.012], k);
  s.ellipsoid([0.12, 0.009, 0.004], [0.025, 0.004, 0.005], undefined, k);
  s.ellipsoid([0.272, 0.0, -0.003], [0.018, 0.028, 0.011], undefined, k);
  s.sphere([0.284, -0.031, -0.004], 0.0075, k);
  s.sphere([0.282, 0.026, -0.003], 0.006, k);
  s.ellipsoid([0.293, -0.002, 0.004], [0.011, 0.022, 0.012], undefined, k);
  s.ellipsoid([0.282, -0.003, -0.012], [0.009, 0.01, 0.005], undefined, { op: 'sub', k: 0.002 });
  return s;
}

function radiusSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.005 };
  s.ellipsoid([0.008, 0.012, 0.003], [0.006, 0.0105, 0.0105]);
  s.cone([0.012, 0.012, 0.003], [0.03, 0.011, 0.004], 0.006, 0.0065, k);
  s.sphere([0.035, 0.008, 0.008], 0.0055, k);
  s.chain([[0.03, 0.011, 0.004], [0.13, 0.006, 0.009], [0.215, 0.0, 0.011]], [0.0065, 0.0072, 0.0095], k);
  s.ellipsoid([0.234, 0.0, 0.01], [0.011, 0.009, 0.016], undefined, k);
  s.cone([0.236, 0.0, 0.022], [0.246, -0.001, 0.026], 0.005, 0.0035, k);
  return s;
}

function ulnaSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.005 };
  s.ellipsoid([-0.008, -0.008, -0.01], [0.014, 0.011, 0.011]);
  s.sphere([0.012, -0.008, 0.008], 0.0065, k);
  s.chain([[0.012, -0.009, -0.003], [0.12, -0.006, -0.008], [0.225, -0.002, -0.011]], [0.009, 0.0068, 0.0055], k);
  s.ellipsoid([0.004, -0.004, 0.004], [0.011, 0.016, 0.009], undefined, { op: 'sub', k: 0.002 });
  s.sphere([0.236, -0.001, -0.011], 0.0075, k);
  s.cone([0.24, -0.001, -0.017], [0.249, -0.002, -0.019], 0.003, 0.0022, k);
  return s;
}

function handSDF(): SDF {
  const s = new SDF();
  const k = { k: 0.0015 };
  const carpals: [V3, V3][] = [
    [[0.01, 0.0, 0.012], [0.008, 0.0055, 0.007]], [[0.011, 0.001, 0.001], [0.007, 0.006, 0.0065]],
    [[0.011, 0.0, -0.01], [0.006, 0.0055, 0.0055]], [[0.026, -0.002, 0.018], [0.0065, 0.006, 0.0065]],
    [[0.027, 0.0, 0.008], [0.006, 0.0055, 0.005]], [[0.028, 0.001, -0.002], [0.009, 0.0065, 0.0065]],
    [[0.026, 0.0, -0.013], [0.008, 0.006, 0.0065]],
  ];
  for (const [c, r] of carpals) s.ellipsoid(c, r, undefined, k);
  s.sphere([0.013, -0.006, -0.013], 0.004, k);
  s.sphere([0.028, -0.006, -0.014], 0.003, k);
  const fingers: [V3, V3, number, number, V3, number[], number[]][] = [
    // base metacarpo, cabeza, radios, dirección de falanges, longitudes, radios
    [[0.037, 0.0, 0.011], [0.1, 0.0, 0.017], 0.0052, 0.0058, [1, 0, 0.06], [0.04, 0.023, 0.017], [0.0048, 0.0041, 0.0035, 0.003]],
    [[0.038, 0.001, 0.0], [0.101, 0.001, 0.004], 0.0052, 0.0058, [1, 0, 0.0], [0.044, 0.027, 0.018], [0.0049, 0.0042, 0.0035, 0.003]],
    [[0.036, 0.0, -0.009], [0.093, 0.0, -0.01], 0.0045, 0.0052, [1, 0, -0.05], [0.041, 0.026, 0.018], [0.0046, 0.004, 0.0034, 0.0029]],
    [[0.034, 0.0, -0.016], [0.085, -0.001, -0.022], 0.0042, 0.005, [1, 0, -0.12], [0.032, 0.018, 0.016], [0.0042, 0.0036, 0.0031, 0.0027]],
  ];
  for (const [base, head, r1, r2, dir, lens, radii] of fingers) {
    s.cone(base, sub(head, scale(norm(sub(head, base)), 0.001)), r1, r2, k);
    phalanges(s, add(head, scale(norm(dir), 0.004)), dir, lens, radii, [0, -1, 0], 0.2, 0.0012);
  }
  s.cone([0.031, -0.004, 0.021], [0.058, -0.012, 0.042], 0.0055, 0.006, k);
  phalanges(s, [0.061, -0.013, 0.045], [0.65, -0.25, 0.7], [0.031, 0.025], [0.0055, 0.0045, 0.0035], [0, -1, 0], 0.12, 0.0012);
  return s;
}

// ═══════════════════════════════ CRÁNEO ═══════════════════════════════

function skullSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.ellipsoid([0, 0.676, -0.012], [0.071, 0.077, 0.094]);
  s.ellipsoid([0, 0.69, 0.03], [0.062, 0.064, 0.062], undefined, { k: 0.025 });
  s.ellipsoid([0.035, 0.705, -0.02], [0.04, 0.045, 0.06], undefined, { k: 0.02 });
  s.ellipsoid([0, 0.66, -0.072], [0.056, 0.052, 0.04], undefined, { k: 0.02 });
  s.box([0, 0.66, 0], [0.069, 0.2, 0.2], 0, undefined, { op: 'int', k: 0.02 });
  s.cone([0.004, 0.646, 0.083], [0.042, 0.648, 0.073], 0.0075, 0.006, { k: 0.01 });
  s.sphere([0, 0.645, 0.083], 0.009, { k: 0.01 });
  s.ellipsoid([0, 0.608, 0.052], [0.044, 0.036, 0.038], undefined, { k: 0.015 });
  s.ellipsoid([0.049, 0.617, 0.051], [0.015, 0.014, 0.019], undefined, { k: 0.01 });
  s.cone([0.054, 0.614, 0.038], [0.064, 0.61, -0.002], 0.0055, 0.0045, { k: 0.006 });
  s.ellipsoid([0.062, 0.62, -0.015], [0.012, 0.022, 0.022], undefined, { k: 0.01 });
  s.ellipsoid([0.054, 0.596, -0.028], [0.0085, 0.016, 0.01], undefined, { k: 0.008 });
  s.ellipsoid([0, 0.584, 0.06], [0.03, 0.013, 0.026], undefined, { k: 0.01 });
  s.ellipsoid([0.012, 0.585, -0.02], [0.008, 0.006, 0.012], undefined, { k: 0.008 });
  // Cavidades: órbitas, abertura nasal, fosa temporal, foramen magno.
  s.ellipsoid([0.034, 0.629, 0.08], [0.0175, 0.017, 0.026], [0, 12, 0], { op: 'sub', k: 0.006 });
  s.ellipsoid([0, 0.6, 0.092], [0.0105, 0.017, 0.02], undefined, { op: 'sub', k: 0.004 });
  s.ellipsoid([0, 0.593, 0.09], [0.012, 0.009, 0.02], undefined, { op: 'sub', k: 0.004 });
  s.ellipsoid([0.072, 0.64, 0.02], [0.012, 0.03, 0.03], undefined, { op: 'sub', k: 0.01 });
  s.ellipsoid([0, 0.582, -0.03], [0.014, 0.012, 0.018], undefined, { op: 'sub', k: 0.004 });
  s.cone([0.0, 0.637, 0.088], [0.0, 0.62, 0.096], 0.005, 0.0035, { k: 0.004 });
  return s;
}

function mandibleSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  s.ellipsoid([0, 0.533, 0.074], [0.017, 0.012, 0.0085]);
  const arc: V3[] = [[0.0, 0.545, 0.075], [0.02, 0.545, 0.066], [0.034, 0.546, 0.045], [0.044, 0.547, 0.02], [0.048, 0.548, -0.002]];
  for (let i = 0; i < arc.length - 1; i++) {
    const a = arc[i], b = arc[i + 1];
    s.ellipsoidAlong(lerp3(a, b, 0.5), [len(sub(b, a)) / 2 + 0.004, 0.012, 0.005], sub(b, a), [0, 1, 0], { k: 0.008 });
  }
  s.ellipsoidAlong([0.049, 0.576, -0.008], [0.028, 0.013, 0.0045], [0, 1, -0.2], [0, 0, 1], { k: 0.008 });
  s.sphere([0.049, 0.548, -0.008], 0.006, { k: 0.006 });
  s.ellipsoid([0.05, 0.603, -0.017], [0.009, 0.0045, 0.0055], undefined, { k: 0.004 });
  s.cone([0.047, 0.585, 0.004], [0.046, 0.597, 0.012], 0.005, 0.0025, { k: 0.004 });
  s.sphere([0.049, 0.602, -0.002], 0.006, { op: 'sub', k: 0.003 });
  return s;
}

function teethSDF(): SDF {
  const s = new SDF();
  s.symmetric = true;
  // Arcada parabólica z = z0 - c·x²; dientes repartidos por longitud de arco
  // (incisivo central → tercer molar).
  const widths = [0.0085, 0.0066, 0.0076, 0.007, 0.007, 0.0102, 0.0096, 0.009];
  const radii = [0.0031, 0.0028, 0.0034, 0.0034, 0.0034, 0.0046, 0.0044, 0.0041];
  for (const jaw of ['up', 'low'] as const) {
    const z0 = jaw === 'up' ? 0.083 : 0.08;
    const c = jaw === 'up' ? 55 : 60;
    const xs: number[] = [];
    const ls: number[] = [];
    let l = 0;
    for (let x = 0; x <= 0.08; x += 0.0002) {
      xs.push(x);
      ls.push(l);
      l += Math.hypot(0.0002, 2 * c * x * 0.0002);
    }
    let arc = 0;
    widths.forEach((w, i) => {
      const target = arc + w / 2;
      arc += w;
      const j = Math.max(0, ls.findIndex((v) => v >= target));
      const x = xs[j];
      const z = z0 - c * x * x;
      const r = radii[i];
      if (jaw === 'up') s.cone([x, 0.567, z], [x, 0.584, z - 0.002], r, r * 0.55);
      else s.cone([x, 0.565, z], [x, 0.549, z - 0.001], r * 0.95, r * 0.5);
    });
  }
  return s;
}

// ═══════════════════════════════ ENSAMBLE ═══════════════════════════════

/** Voxel base en metros. A la escala de la proyección 1 px ≈ 1,7 mm: más fino no se ve. */
export async function buildHumanSkeleton(progress: Progress, quality = 1): Promise<BonePiece[]> {
  const v = 0.002 / quality;
  const pieces: BonePiece[] = [];
  const both = (slot: string, boneL: BoneName, mesh: MeshData, material: BoneMaterial = 'bone') => {
    pieces.push({ slot: `${slot}_L`, bone: boneL, material, mesh });
    pieces.push({ slot: `${slot}_R`, bone: boneL.replace('Left', 'Right') as BoneName, material, mesh: mirrorMesh(mesh) });
  };
  const steps: [string, () => void][] = [
    ['cráneo', () => {
      pieces.push({ slot: 'skull', bone: 'Head', material: 'bone', mesh: polySDF(skullSDF(), v * 0.8, 24000) });
      pieces.push({ slot: 'skull', bone: 'Head', material: 'bone', mesh: polySDF(mandibleSDF(), v * 0.7, 5500) });
      pieces.push({ slot: 'skull', bone: 'Head', material: 'teeth', mesh: polySDF(teethSDF(), v * 0.45, 6000, 0.003) });
    }],
    ['columna', () => pieces.push(...spinePieces(v * 0.7))],
    ['costillas', () => {
      pieces.push(...ribCagePieces());
      pieces.push({ slot: 'ribs', bone: 'Spine2', material: 'bone', mesh: polySDF(sternumSDF(), v * 0.8, 3000) });
    }],
    ['cintura escapular', () => {
      both('clavicle', 'LeftShoulder', claviclePiece(v));
      both('scapula', 'LeftShoulder', scapulaPiece(v));
    }],
    ['pelvis', () => pieces.push({ slot: 'pelvis', bone: 'Hips', material: 'bone', mesh: polySDF(pelvisSDF(), v * 0.9, 20000) })],
    ['brazos', () => {
      const T = (m: MeshData, t: V3) => translate(m, t);
      const hum = T(polySDF(humerusSDF(), v, 4500), [0.17, 0.44, 0]);
      const rad = T(polySDF(radiusSDF(), v * 0.8, 3000), [0.47, 0.44, 0]);
      const uln = T(polySDF(ulnaSDF(), v * 0.8, 3000), [0.47, 0.44, 0]);
      const hand = T(polySDF(handSDF(), v * 0.6, 8000), [0.72, 0.44, 0]);
      for (const side of [1, -1] as const) {
        const tag = side > 0 ? 'L' : 'R';
        const pre = side > 0 ? 'Left' : 'Right';
        pieces.push({ slot: `humerus_${tag}`, bone: `${pre}Arm` as BoneName, material: 'bone', mesh: armMesh(hum, side) });
        pieces.push({ slot: `forearm_${tag}`, bone: `${pre}ForeArm` as BoneName, material: 'bone', mesh: armMesh(rad, side) });
        pieces.push({ slot: `forearm_${tag}`, bone: `${pre}ForeArm` as BoneName, material: 'bone', mesh: armMesh(uln, side) });
        pieces.push({ slot: `hand_${tag}`, bone: `${pre}Hand` as BoneName, material: 'bone', mesh: armMesh(hand, side) });
      }
    }],
    ['piernas', () => {
      const hip = REST.LeftUpLeg, knee = REST.LeftLeg, ankle = REST.LeftFoot;
      both('femur', 'LeftUpLeg', translate(polySDF(femurSDF(), v, 5500), hip));
      both('patella', 'LeftLeg', translate(polySDF(patellaSDF(), v, 900), knee));
      both('leg', 'LeftLeg', translate(polySDF(tibiaSDF(), v, 5000), knee));
      both('leg', 'LeftLeg', translate(polySDF(fibulaSDF(), v * 0.8, 2500), knee));
      both('foot', 'LeftFoot', translate(polySDF(footSDF(), v * 0.6, 10000), ankle));
    }],
  ];
  for (let i = 0; i < steps.length; i++) {
    await progress(i / steps.length, steps[i][0]);
    steps[i][1]();
  }
  await progress(1, 'esqueleto');
  return pieces;
}
