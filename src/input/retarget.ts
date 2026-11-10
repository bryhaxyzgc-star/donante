// Retargeting propio (§7): landmarks 3D de MediaPipe → rotaciones locales de la armadura.
// - Torso y cabeza: bases ortonormales (hombros/caderas, ojos/orejas).
// - Extremidades: swing padre→hijo con setFromUnitVectors en el espacio del padre,
//   giro del húmero/fémur desde el plano de flexión, bisagra limitada en codo y rodilla.
// - Límites anatómicos por articulación y mezcla hacia una pose neutra si el tramo no se ve.
// Sin `new` por frame: todo usa temporales preasignados.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { config } from '../config.ts';
import type { Armature, BoneName } from '../anatomy/armature.ts';
import { LM, LM_STRIDE } from './poseTypes.ts';
import type { Person } from './people.ts';
import type { Projection } from '../render/projection.ts';

const DEG = Math.PI / 180;
const IDENT = new Quaternion();
const _qc = new Quaternion();

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Limita el ángulo total de un cuaternión. */
function clampQuat(q: Quaternion, maxRad: number): Quaternion {
  q.normalize();
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const ang = 2 * Math.acos(Math.min(1, q.w));
  if (ang > maxRad && ang > 1e-6) {
    _qc.copy(q);
    q.copy(IDENT).slerp(_qc, maxRad / ang);
  }
  return q;
}

const _pa = new Vector3();
const _pb = new Vector3();
const _pc = new Vector3();
/** Ángulo con signo de a→b alrededor de `axis` (unitario), proyectando en su plano normal. */
function signedAngle(a: Vector3, b: Vector3, axis: Vector3): number {
  _pa.copy(a).addScaledVector(axis, -a.dot(axis));
  _pb.copy(b).addScaledVector(axis, -b.dot(axis));
  if (_pa.lengthSq() < 1e-10 || _pb.lengthSq() < 1e-10) return 0;
  _pa.normalize();
  _pb.normalize();
  return Math.atan2(axis.dot(_pc.crossVectors(_pa, _pb)), _pa.dot(_pb));
}

interface BoneRest {
  parent: BoneName | null;
  L0: Quaternion;
  R: Quaternion;
  Rinv: Quaternion;
  /** Dirección al hijo en el espacio local del bone. */
  dirLocal: Vector3;
}

interface Hinge {
  /** Dirección de reposo del hijo en el espacio del padre (r), flexión (f) y lado (s). */
  r: Vector3;
  f: Vector3;
  s: Vector3;
}

const TORSO_SEGS = [[LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP], [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP]];

const LIMB_BONES = [
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
] as const satisfies readonly BoneName[];

export class Retargeter {
  private rest = {} as Record<BoneName, BoneRest>;
  /** Rotación de mundo resuelta en este frame (espacio del rig). */
  private W = {} as Record<BoneName, Quaternion>;
  /** Rotaciones locales objetivo (lo que BodyRig interpola). */
  readonly target = {} as Record<BoneName, Quaternion>;
  private neutral = {} as Record<BoneName, Quaternion>;
  private conf = {} as Record<BoneName, number>;
  private hinge = {} as Record<'LeftForeArm' | 'RightForeArm' | 'LeftLeg' | 'RightLeg', Hinge>;
  /** Normal de flexión de reposo (local) del húmero/fémur. */
  private bendLocal = {} as Record<'LeftArm' | 'RightArm' | 'LeftUpLeg' | 'RightUpLeg', Vector3>;
  private dorsalLocal = {} as Record<'LeftHand' | 'RightHand', Vector3>;
  private footRestLocal = {} as Record<'LeftFoot' | 'RightFoot', Vector3>;
  private hipJointOffset = new Vector3();
  /** Posición de reposo del bone Hips dentro del rig (≠ 0 en rigs importados). */
  private hipsRest = new Vector3();
  private modelTorso = 0.48;

  readonly rootTarget = new Vector3();
  scaleTarget = 1;
  depth = 3;
  hasPose = false;
  /** Medidas para el HUD de debug. */
  debugDepth = 0;
  debugScale = 1;

  // temporales
  private P = Array.from({ length: 33 }, () => new Vector3());
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private v4 = new Vector3();
  private q1 = new Quaternion();
  private q2 = new Quaternion();
  private q3 = new Quaternion();
  private qd = new Quaternion();
  private m = new Matrix4();
  private dHips = new Quaternion();
  private dChest = new Quaternion();

  constructor(arm: Armature) {
    const names = Object.keys(arm.bones) as BoneName[];
    for (const name of names) {
      const r = arm.rest[name];
      const bone = arm.bones[name];
      const child = bone.children.find((c) => (c as { isBone?: boolean }).isBone);
      const dirLocal = child ? child.position.clone().normalize() : new Vector3(0, 1, 0);
      const parentName = (bone.parent && (bone.parent as { isBone?: boolean }).isBone ? bone.parent.name : null) as BoneName | null;
      this.rest[name] = { parent: parentName, L0: r.local.clone(), R: r.worldQuat.clone(), Rinv: r.worldQuat.clone().invert(), dirLocal };
      this.W[name] = r.worldQuat.clone();
      this.target[name] = r.local.clone();
      this.neutral[name] = r.local.clone();
      this.conf[name] = 1;
    }

    const flexArm = new Vector3(0, 0, 1);
    const flexLeg = new Vector3(0, 0, -1);
    const mkHinge = (bone: BoneName, flexModel: Vector3): Hinge => {
      const rs = this.rest[bone];
      const parent = this.rest[rs.parent!];
      const r = rs.dirLocal.clone().applyQuaternion(rs.L0);
      const f = flexModel.clone().applyQuaternion(parent.Rinv);
      f.addScaledVector(r, -f.dot(r)).normalize();
      return { r, f, s: new Vector3().crossVectors(r, f).normalize() };
    };
    this.hinge.LeftForeArm = mkHinge('LeftForeArm', flexArm);
    this.hinge.RightForeArm = mkHinge('RightForeArm', flexArm);
    this.hinge.LeftLeg = mkHinge('LeftLeg', flexLeg);
    this.hinge.RightLeg = mkHinge('RightLeg', flexLeg);
    const mkBend = (bone: BoneName, flexModel: Vector3): Vector3 => {
      const rs = this.rest[bone];
      const f = flexModel.clone().applyQuaternion(rs.Rinv);
      return new Vector3().crossVectors(rs.dirLocal, f).normalize();
    };
    this.bendLocal.LeftArm = mkBend('LeftArm', flexArm);
    this.bendLocal.RightArm = mkBend('RightArm', flexArm);
    this.bendLocal.LeftUpLeg = mkBend('LeftUpLeg', flexLeg);
    this.bendLocal.RightUpLeg = mkBend('RightUpLeg', flexLeg);
    // Dorso de la mano en reposo (depende del rig: pose A procedural o anatómica de BodyParts3D).
    this.dorsalLocal.LeftHand = new Vector3(...arm.meta.dorsal.LeftHand).normalize().applyQuaternion(this.rest.LeftHand.Rinv);
    this.dorsalLocal.RightHand = new Vector3(...arm.meta.dorsal.RightHand).normalize().applyQuaternion(this.rest.RightHand.Rinv);
    this.footRestLocal.LeftFoot = new Vector3(0, 0, 1).applyQuaternion(this.rest.LeftFoot.Rinv);
    this.footRestLocal.RightFoot = new Vector3(0, 0, 1).applyQuaternion(this.rest.RightFoot.Rinv);

    // Pose neutra cuando un tramo no se ve: brazos colgando, piernas rectas.
    for (const side of [1, -1] as const) {
      const name: BoneName = side > 0 ? 'LeftArm' : 'RightArm';
      const rs = this.rest[name];
      const restDir = rs.dirLocal.clone().applyQuaternion(rs.R);
      const hang = new Vector3(0.14 * side, -1, 0.04).normalize();
      const Wn = new Quaternion().setFromUnitVectors(restDir, hang).multiply(rs.R);
      this.neutral[name] = this.rest[rs.parent!].Rinv.clone().multiply(Wn);
    }

    const hj = new Vector3().addVectors(arm.rest.LeftUpLeg.worldPos, arm.rest.RightUpLeg.worldPos).multiplyScalar(0.5);
    this.hipJointOffset.copy(hj).sub(arm.rest.Hips.worldPos);
    this.hipsRest.copy(arm.rest.Hips.worldPos);
    const sj = new Vector3().addVectors(arm.rest.LeftArm.worldPos, arm.rest.RightArm.worldPos).multiplyScalar(0.5);
    this.modelTorso = sj.distanceTo(hj);
  }

  reset(): void {
    this.hasPose = false;
    for (const n of Object.keys(this.target) as BoneName[]) {
      this.target[n].copy(this.rest[n].L0);
      this.conf[n] = 1;
    }
  }

  /** Resuelve la pose objetivo a partir de una persona. */
  solve(person: Person, proj: Projection, dt: number): void {
    const cfg = config.retarget;
    const lm3 = person.lm3d;
    const lm2 = person.lm2d;
    // Mundo MediaPipe (x der, y abajo, z lejos) → modelo (x der de la imagen = izquierda del
    // visitante, y arriba, z hacia la cámara): rotación de 180° sobre X.
    for (let i = 0; i < 33; i++) {
      const o = i * LM_STRIDE;
      this.P[i].set(lm3[o], -lm3[o + 1], -lm3[o + 2]);
    }
    const P = this.P;
    const vis = (i: number) => lm2[i * LM_STRIDE + 3];

    // ── Torso ─────────────────────────────────────────────
    const hipC = this.v1.addVectors(P[LM.L_HIP], P[LM.R_HIP]).multiplyScalar(0.5);
    const shC = this.v2.addVectors(P[LM.L_SHOULDER], P[LM.R_SHOULDER]).multiplyScalar(0.5);
    const up = this.v3.subVectors(shC, hipC);
    const torsoLen = up.length();
    up.normalize();
    this.basis(this.dHips, this.v4.subVectors(P[LM.L_HIP], P[LM.R_HIP]), up);
    this.basis(this.dChest, this.v4.subVectors(P[LM.L_SHOULDER], P[LM.R_SHOULDER]), up);
    const rel = this.q1.copy(this.dHips).invert().multiply(this.dChest);
    clampQuat(rel, cfg.torsoTwistMaxDeg * DEG);
    this.dChest.copy(this.dHips).multiply(rel);
    this.W.Hips.copy(this.dHips).multiply(this.rest.Hips.R);
    this.setLocal('Hips');
    const spine: [BoneName, number][] = [['Spine', 1 / 3], ['Spine1', 2 / 3], ['Spine2', 1]];
    for (const [name, k] of spine) {
      this.q2.copy(IDENT).slerp(rel, k);
      this.W[name].copy(this.dHips).multiply(this.q2).multiply(this.rest[name].R);
      this.setLocal(name);
    }

    // ── Cabeza ────────────────────────────────────────────
    const X = this.v1.subVectors(P[LM.L_EAR], P[LM.R_EAR]).normalize();
    const eyeMid = this.v2.addVectors(P[LM.L_EYE], P[LM.R_EYE]).multiplyScalar(0.5);
    const earMid = this.v3.addVectors(P[LM.L_EAR], P[LM.R_EAR]).multiplyScalar(0.5);
    const Z0 = eyeMid.sub(earMid).normalize().applyAxisAngle(X, cfg.headPitchOffsetDeg * DEG);
    const Y = this.v4.crossVectors(Z0, X).normalize();
    const Z = this.v3.crossVectors(X, Y);
    this.m.makeBasis(X, Y, Z);
    const dHead = this.q1.setFromRotationMatrix(this.m);
    const relH = this.q2.copy(this.dChest).invert().multiply(dHead);
    clampQuat(relH, cfg.headMaxDeg * DEG);
    this.q3.copy(IDENT).slerp(relH, cfg.neckShare);
    this.W.Neck.copy(this.dChest).multiply(this.q3).multiply(this.rest.Neck.R);
    this.setLocal('Neck');
    this.W.Head.copy(this.dChest).multiply(relH).multiply(this.rest.Head.R);
    this.setLocal('Head');

    // ── Brazos ────────────────────────────────────────────
    for (const side of [1, -1] as const) {
      const L = side > 0;
      const sh = P[L ? LM.L_SHOULDER : LM.R_SHOULDER];
      const el = P[L ? LM.L_ELBOW : LM.R_ELBOW];
      const wr = P[L ? LM.L_WRIST : LM.R_WRIST];
      const clav: BoneName = L ? 'LeftShoulder' : 'RightShoulder';
      const upper: BoneName = L ? 'LeftArm' : 'RightArm';
      const lower: BoneName = L ? 'LeftForeArm' : 'RightForeArm';
      const hand: BoneName = L ? 'LeftHand' : 'RightHand';

      const dU = this.v1.subVectors(el, sh).normalize();
      const dL = this.v2.subVectors(wr, el).normalize();
      // Clavícula: se eleva un poco cuando el brazo sube por encima del hombro.
      const chestUp = this.v3.set(0, 1, 0).applyQuaternion(this.dChest);
      const elev = smoothstep(-0.1, 0.9, dU.dot(chestUp));
      this.qd.setFromAxisAngle(this.v4.set(0, 0, 1), side * elev * 14 * DEG);
      this.W[clav].copy(this.W.Spine2).multiply(this.rest[clav].L0).multiply(this.qd);
      this.setLocal(clav);

      this.swing(upper, dU, cfg.shoulderConeDeg);
      this.bendTwist(upper, dU, dL, this.bendLocal[upper as 'LeftArm'], cfg.armTwistMaxDeg);
      this.hingeSolve(lower, dL, this.hinge[lower as 'LeftForeArm'], cfg.elbowMaxDeg);

      const idx = P[L ? LM.L_INDEX : LM.R_INDEX];
      const pky = P[L ? LM.L_PINKY : LM.R_PINKY];
      const dH = this.v3.addVectors(idx, pky).multiplyScalar(0.5).sub(wr).normalize();
      this.swing(hand, dH, cfg.wristConeDeg);
      // Giro de la muñeca desde la normal del dorso.
      const a = this.v1.subVectors(idx, wr);
      const b = this.v2.subVectors(pky, wr);
      const dorsal = L ? this.v4.crossVectors(a, b) : this.v4.crossVectors(b, a);
      if (dorsal.lengthSq() > 1e-8) {
        dorsal.normalize();
        const model = this.v1.copy(this.dorsalLocal[hand as 'LeftHand']).applyQuaternion(this.W[hand]);
        let phi = signedAngle(model, dorsal, dH);
        phi = Math.max(-cfg.wristTwistMaxDeg * DEG, Math.min(cfg.wristTwistMaxDeg * DEG, phi));
        this.qd.setFromAxisAngle(dH, phi);
        this.W[hand].premultiply(this.qd);
        this.setLocal(hand);
      }

      this.updateConf(upper, Math.min(vis(L ? LM.L_SHOULDER : LM.R_SHOULDER), vis(L ? LM.L_ELBOW : LM.R_ELBOW)), dt);
      this.updateConf(lower, Math.min(vis(L ? LM.L_ELBOW : LM.R_ELBOW), vis(L ? LM.L_WRIST : LM.R_WRIST)), dt);
      this.updateConf(hand, Math.min(vis(L ? LM.L_WRIST : LM.R_WRIST), vis(L ? LM.L_INDEX : LM.R_INDEX)), dt);
    }

    // ── Piernas ───────────────────────────────────────────
    for (const side of [1, -1] as const) {
      const L = side > 0;
      const hip = P[L ? LM.L_HIP : LM.R_HIP];
      const kn = P[L ? LM.L_KNEE : LM.R_KNEE];
      const an = P[L ? LM.L_ANKLE : LM.R_ANKLE];
      const upper: BoneName = L ? 'LeftUpLeg' : 'RightUpLeg';
      const lower: BoneName = L ? 'LeftLeg' : 'RightLeg';
      const foot: BoneName = L ? 'LeftFoot' : 'RightFoot';
      const dU = this.v1.subVectors(kn, hip).normalize();
      const dL = this.v2.subVectors(an, kn).normalize();
      this.swing(upper, dU, cfg.hipConeDeg);
      this.bendTwist(upper, dU, dL, this.bendLocal[upper as 'LeftUpLeg'], cfg.legTwistMaxDeg);
      this.hingeSolve(lower, dL, this.hinge[lower as 'LeftLeg'], cfg.kneeMaxDeg);
      const dF = this.v3.subVectors(P[L ? LM.L_FOOT : LM.R_FOOT], P[L ? LM.L_HEEL : LM.R_HEEL]).normalize();
      this.swing(foot, dF, cfg.ankleConeDeg, this.footRestLocal[foot as 'LeftFoot']);
      this.updateConf(upper, Math.min(vis(L ? LM.L_HIP : LM.R_HIP), vis(L ? LM.L_KNEE : LM.R_KNEE)), dt);
      this.updateConf(lower, Math.min(vis(L ? LM.L_KNEE : LM.R_KNEE), vis(L ? LM.L_ANKLE : LM.R_ANKLE)), dt);
      this.updateConf(foot, Math.min(vis(L ? LM.L_ANKLE : LM.R_ANKLE), vis(L ? LM.L_FOOT : LM.R_FOOT)), dt);
    }

    // Mezcla hacia la pose neutra según la confianza de cada tramo.
    for (const name of LIMB_BONES) {
      const w = smoothstep(cfg.minVisibility - 0.15, cfg.minVisibility + 0.15, this.conf[name]);
      if (w < 0.999) this.target[name].slerpQuaternions(this.neutral[name], this.target[name], w);
    }

    // ── Raíz: posición en pantalla + profundidad por escala aparente ──
    this.solveRoot(person, proj, torsoLen, dt);
    this.hasPose = true;
  }

  private basis(out: Quaternion, side: Vector3, up: Vector3): void {
    const x = side.addScaledVector(up, -side.dot(up)).normalize();
    const z = this.v2.crossVectors(x, up);
    this.m.makeBasis(x, up, z);
    out.setFromRotationMatrix(this.m);
  }

  private setLocal(name: BoneName): void {
    const parent = this.rest[name].parent;
    const t = this.target[name];
    if (parent) t.copy(this.W[parent]).invert().multiply(this.W[name]);
    else t.copy(this.W[name]);
    t.normalize();
  }

  private updateConf(name: BoneName, v: number, dt: number): void {
    const k = this.hasPose ? 1 - Math.exp(-4 * dt) : 1;
    this.conf[name] += (v - this.conf[name]) * k;
  }

  /** Swing desde la dirección de reposo hacia `d` (mundo), limitado por un cono. */
  private swing(name: BoneName, d: Vector3, coneDeg: number, restLocal?: Vector3): void {
    const rs = this.rest[name];
    const Wp = this.W[rs.parent!];
    // Dónde apuntaría el bone con su rotación local de reposo.
    const q = this.q3.copy(Wp).multiply(rs.L0);
    const cur = this.v4.copy(restLocal ?? rs.dirLocal).applyQuaternion(q);
    const ang = cur.angleTo(d);
    const max = coneDeg * DEG;
    this.qd.setFromUnitVectors(cur, d);
    if (ang > max) {
      _qc.copy(this.qd);
      this.qd.copy(IDENT).slerp(_qc, max / ang);
    }
    this.W[name].copy(this.qd).multiply(q);
    this.setLocal(name);
  }

  /** Gira el húmero/fémur alrededor de su eje para que el plano de flexión coincida. */
  private bendTwist(name: BoneName, dU: Vector3, dL: Vector3, bendLocal: Vector3, maxDeg: number): void {
    const bend = dU.angleTo(dL);
    if (bend < 6 * DEG) return;
    const nCur = this.v3.crossVectors(dU, dL).normalize();
    const nModel = this.v4.copy(bendLocal).applyQuaternion(this.W[name]);
    let phi = signedAngle(nModel, nCur, dU);
    // Plano invertido = hiperextensión: se interpreta al revés y la bisagra lo endereza.
    if (Math.abs(phi) > 110 * DEG) phi -= Math.sign(phi) * Math.PI;
    const max = maxDeg * DEG;
    phi = Math.max(-max, Math.min(max, phi)) * smoothstep(6 * DEG, 30 * DEG, bend);
    this.qd.setFromAxisAngle(dU, phi);
    this.W[name].premultiply(this.qd);
    this.setLocal(name);
  }

  /** Codo/rodilla: solo flexión en el plano de la bisagra, sin hiperextensión. */
  private hingeSolve(name: BoneName, d: Vector3, h: Hinge, maxDeg: number): void {
    const rs = this.rest[name];
    const Wp = this.W[rs.parent!];
    const dl = this.v3.copy(d).applyQuaternion(this.q3.copy(Wp).invert());
    const a = dl.dot(h.r);
    const b = Math.max(0, dl.dot(h.f));
    const c = dl.dot(h.s) * config.retarget.hingeSideFactor;
    const theta = Math.min(maxDeg * DEG, Math.atan2(b, a));
    const nd = this.v4.copy(h.r).multiplyScalar(Math.cos(theta)).addScaledVector(h.f, Math.sin(theta)).addScaledVector(h.s, c).normalize();
    this.target[name].setFromUnitVectors(h.r, nd).multiply(rs.L0);
    this.W[name].copy(Wp).multiply(this.target[name]);
  }

  private solveRoot(person: Person, proj: Projection, torsoLen3d: number, dt: number): void {
    const cfg = config.retarget;
    const lm2 = person.lm2d;
    const lm3 = person.lm3d;
    // Píxeles por metro: suma de segmentos del torso en 2D / sus proyecciones XY en 3D.
    // Robusto al giro: si el visitante gira, ambos se acortan igual.
    let s2 = 0;
    let s3 = 0;
    for (const [a, b] of TORSO_SEGS) {
      const oa = a * LM_STRIDE;
      const ob = b * LM_STRIDE;
      s2 += Math.hypot((lm2[oa] - lm2[ob]) * proj.videoW, (lm2[oa + 1] - lm2[ob + 1]) * proj.videoH);
      s3 += Math.hypot(lm3[oa] - lm3[ob], lm3[oa + 1] - lm3[ob + 1]);
    }
    if (s2 < 1 || s3 < 1e-3) return;
    const depth = proj.focalPx / (s2 / s3);
    const k = this.hasPose ? 1 - Math.exp(-cfg.depthSmoothing * dt) : 1;
    this.depth += (Math.min(12, Math.max(0.4, depth)) - this.depth) * k;
    const scale = Math.min(cfg.scaleMax, Math.max(cfg.scaleMin, torsoLen3d / this.modelTorso));
    this.scaleTarget += (scale * config.calib.bodyScale - this.scaleTarget) * (this.hasPose ? k : 1);

    const u = (lm2[LM.L_HIP * LM_STRIDE] + lm2[LM.R_HIP * LM_STRIDE]) * 0.5;
    const v = (lm2[LM.L_HIP * LM_STRIDE + 1] + lm2[LM.R_HIP * LM_STRIDE + 1]) * 0.5;
    proj.unproject(u, v, this.depth, this.rootTarget);
    // El landmark de cadera es la articulación, no el origen del bone Hips.
    const off = this.v1.copy(this.hipJointOffset).applyQuaternion(this.dHips).multiplyScalar(this.scaleTarget);
    this.rootTarget.sub(off).addScaledVector(this.hipsRest, -this.scaleTarget);
    this.debugDepth = this.depth;
    this.debugScale = this.scaleTarget;
  }
}
