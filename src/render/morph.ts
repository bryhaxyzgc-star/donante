// Morph humano → cerdo de la piel translúcida (§9.4). Dos morph targets generados al cargar,
// a partir de las articulaciones de reposo (no hay shape keys de MakeHuman: la piel es la de
// BodyParts3D o el placeholder):
//   0 · cabeza: el hocico avanza desde la nariz y la boca, la mandíbula acompaña, la frente sigue
//       la línea recta del perfil porcino, las orejas suben y el cuello engrosa hasta casi no estar.
//   1 · tórax: caja en barril (más ancha y profunda) y vientre más bajo.
// También se deforman las normales: el fresnel de la placa dibuja el contorno del hocico nuevo.
import { BufferAttribute, Float32BufferAttribute, Vector3, type BufferGeometry } from 'three';
import { BONE_NAMES, type BoneName } from '../anatomy/armature.ts';

export const MORPH_HEAD = 0;
export const MORPH_BODY = 1;

const done = new WeakSet<BufferGeometry>();

function bell(x: number, c: number, w: number): number {
  const d = (x - c) / w;
  return Math.exp(-d * d);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Meseta: 1 entre `a` y `b`, con bordes suaves de ancho `soft`. Desplaza zonas enteras por
 *  igual: el hocico sale como un tubo romo con disco al frente y no como un pico. */
function plateau(x: number, a: number, b: number, soft: number): number {
  return smoothstep(a - soft, a, x) * (1 - smoothstep(b, b + soft, x));
}

/** Agrega (una vez por geometría) los dos morph targets. `joints`: posiciones de reposo (modelo).
 *  `snoutFront`: hasta dónde llega (Z de modelo) el hocico óseo del cerdo; la piel lo cubre. */
export function ensurePigMorph(geo: BufferGeometry, joints: Record<BoneName, Vector3>, snoutFront: number | null): boolean {
  if (done.has(geo)) return true;
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!pos || !si || !sw || !geo.index) return false;
  done.add(geo);

  const idx = (n: BoneName) => BONE_NAMES.indexOf(n);
  const HEAD = [idx('Head'), idx('HeadTop_End')];
  const ARMS = (['LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHand_End', 'RightArm', 'RightForeArm', 'RightHand', 'RightHand_End'] as BoneName[]).map(idx);
  const LEGS = (['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End'] as BoneName[]).map(idx);
  const weightOf = (i: number, set: number[]): number => {
    let w = 0;
    for (let c = 0; c < 4; c++) if (set.includes(si.getComponent(i, c))) w += sw.getComponent(i, c);
    return w;
  };

  // Marco de la cabeza: origen en los cóndilos (Head), U hacia la coronilla, F al frente.
  const H = joints.Head;
  const top = joints.HeadTop_End;
  const h = Math.max(0.12, top.distanceTo(H));
  const U = new Vector3().subVectors(top, H).normalize();
  const F = new Vector3(0, 0, 1).addScaledVector(U, -U.z).normalize();
  const X = new Vector3().crossVectors(U, F).normalize();
  // Eje del tronco para el barril.
  const hips = joints.Hips;
  const neck = joints.Neck;
  const s2 = joints.Spine2;
  const s1 = joints.Spine1;
  const torsoH = Math.max(0.2, neck.y - hips.y);
  const shoulderW = Math.max(0.12, joints.LeftArm.distanceTo(joints.RightArm) * 0.5);
  const neckAxis = new Vector3().subVectors(H, neck).normalize();

  const n = pos.count;
  const p = new Vector3();
  const d = new Vector3();
  const r = new Vector3();
  // Frente de la cara en la línea media (la nariz): de ahí sale el hocico.
  let faceFront = -Infinity;
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    if (Math.abs(p.x - H.x) < 0.015 && p.y > H.y - 0.3 * h && p.y < top.y) faceFront = Math.max(faceFront, p.z);
  }
  // Largo del hocico de piel: cubre el óseo con ~1,5 cm de tejido (o 0,8 de la cabeza sin cerdo).
  const snoutLen = snoutFront !== null && Number.isFinite(faceFront) ? Math.max(0.05, snoutFront + 0.015 - faceFront) : 0.8 * h;

  const head = new Float32Array(n * 3);
  const body = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    const wHead = weightOf(i, HEAD);
    const wLimb = weightOf(i, ARMS) + weightOf(i, LEGS);

    // ── cabeza ── Máscaras espaciales (no pesos de skinning: la cara de la piel reparte sus
    // pesos entre cabeza y cuello). Unidades de `h`; la nariz cae en u≈0,3 y f≈0,75, el mentón
    // en u≈-0,27 y la frente en u≈0,75.
    const notLimb = Math.max(0, 1 - wLimb);
    d.subVectors(p, H);
    const u = d.dot(U) / h;
    const f = d.dot(F) / h;
    const x = d.dot(X) / h;
    const ax = Math.abs(x);
    const mid = 1 - smoothstep(0.22, 0.44, ax);
    const front = smoothstep(0.38, 0.62, f);
    // Hocico: nariz y labio superior avanzan juntos (tubo romo con disco al frente).
    const snout = front * plateau(u, 0.02, 0.4, 0.14) * mid;
    // Mandíbula inferior larga, apenas más corta que el hocico.
    const jaw = front * plateau(u, -0.34, 0.02, 0.1) * mid * (1 - snout);
    // Frente: rampa lineal que une la coronilla con el lomo del hocico (perfil recto del cerdo).
    const browRamp = Math.min(1, Math.max(0, (0.8 - u) / 0.4)) * smoothstep(0.38, 0.5, u);
    const brow = smoothstep(0.2, 0.5, f) * browRamp * (1 - smoothstep(0.26, 0.48, ax));
    const ear = bell(ax, 0.46, 0.08) * bell(f, 0.05, 0.2) * bell(u, 0.35, 0.16);
    r.set(0, 0, 0);
    r.addScaledVector(F, snoutLen * (snout + 0.82 * jaw + 0.9 * brow));
    r.addScaledVector(U, h * (0.32 * ear) - 0.1 * snoutLen * jaw);
    // Se angosta un poco hacia la punta.
    r.addScaledVector(X, h * (-x * 0.16 * (snout + jaw) + Math.sign(x) * 0.14 * ear));
    r.multiplyScalar(notLimb);
    // Cuello: se ensancha radialmente hasta fundir la cabeza con los hombros (debajo del mentón).
    const neckW = smoothstep(-1.15, -0.75, u) * (1 - smoothstep(-0.4, -0.2, u)) * notLimb * (1 - wHead * 0.5);
    if (neckW > 0.01) {
      d.subVectors(p, neck);
      d.addScaledVector(neckAxis, -d.dot(neckAxis));
      r.addScaledVector(d, 0.34 * neckW);
    }
    head[i * 3] = r.x;
    head[i * 3 + 1] = r.y;
    head[i * 3 + 2] = r.z;

    // ── tórax en barril y vientre ──
    const torso = Math.max(0, 1 - wLimb - wHead);
    if (torso > 0.01) {
      const yh = (p.y - hips.y) / torsoH;
      const chest = bell(p.y, s2.y, torsoH * 0.28);
      const belly = bell(p.y, s1.y - torsoH * 0.12, torsoH * 0.22);
      const dx = p.x - hips.x;
      const dz = p.z - (hips.z + (s2.z - hips.z) * Math.min(1, Math.max(0, yh)));
      const lat = 1 - smoothstep(0.8, 1.25, Math.abs(dx) / shoulderW);
      body[i * 3] = dx * (0.13 * chest + 0.05 * belly) * lat * torso;
      body[i * 3 + 1] = -0.025 * belly * torsoH * Math.max(0, Math.sign(dz)) * torso;
      body[i * 3 + 2] = (dz > 0 ? dz * (0.2 * chest + 0.24 * belly) : dz * 0.06 * chest) * lat * torso;
    }
  }

  // Normales deformadas = normales recalculadas sobre la malla deformada.
  const deltaNormals = (delta: Float32Array): Float32Array => {
    const base = normalsFor(geo, null);
    const moved = normalsFor(geo, delta);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) out[i] = moved[i] - base[i];
    return out;
  };
  geo.morphAttributes.position = [new Float32BufferAttribute(head, 3), new Float32BufferAttribute(body, 3)];
  geo.morphAttributes.normal = [new Float32BufferAttribute(deltaNormals(head), 3), new Float32BufferAttribute(deltaNormals(body), 3)];
  geo.morphTargetsRelative = true;
  return true;
}

/** Normales por vértice (área-ponderadas) de la malla con un desplazamiento opcional. */
function normalsFor(geo: BufferGeometry, delta: Float32Array | null): Float32Array {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const index = geo.index!;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i) + (delta ? delta[i * 3] : 0);
    P[i * 3 + 1] = pos.getY(i) + (delta ? delta[i * 3 + 1] : 0);
    P[i * 3 + 2] = pos.getZ(i) + (delta ? delta[i * 3 + 2] : 0);
  }
  const N = new Float32Array(n * 3);
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      N[v * 3] += nx;
      N[v * 3 + 1] += ny;
      N[v * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l;
    N[i * 3 + 1] /= l;
    N[i * 3 + 2] /= l;
  }
  return N;
}
