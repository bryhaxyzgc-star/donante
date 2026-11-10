// Simulador de visitantes: genera landmarks y máscara con las mismas convenciones
// que MediaPipe para probar render y retargeting sin webcam (fuente "simulador").
import { Vector3 } from 'three';
import { config } from '../config.ts';
import { LM, LM_STRIDE, NUM_LM, type PoseFrame } from './poseTypes.ts';

const MASK_W = 256;
const MASK_H = 144;
const MASK_EVERY = 4;

const tmp = new Vector3();
const axis = new Vector3();

/** Rota `v` hacia `toward` un ángulo `ang` (Rodrigues). */
function rotateToward(v: Vector3, toward: Vector3, ang: number): Vector3 {
  axis.crossVectors(v, toward);
  if (axis.lengthSq() < 1e-8) return v;
  axis.normalize();
  return v.applyAxisAngle(axis, ang);
}

interface SimPerson {
  phase: number;
  baseX: number;
}

export class PoseSimulator {
  private people: SimPerson[] = [];
  private t0 = performance.now();
  private last = 0;
  private pts: Vector3[] = Array.from({ length: NUM_LM }, () => new Vector3());
  /** La máscara sintética es cara (se rasteriza píxel a píxel): se renueva cada MASK_EVERY frames y si no
   *  se reusa. Antes costaba ~50 ms por frame y frenaba toda la obra en modo simulador. */
  private mask = new Uint8Array(MASK_W * MASK_H);
  private frameNo = 0;

  constructor() {
    this.setCount(config.simulator.people);
  }

  setCount(n: number): void {
    this.people = Array.from({ length: Math.max(1, Math.min(2, n)) }, (_, i) => ({
      phase: i * 2.7,
      baseX: n > 1 ? (i === 0 ? -0.75 : 0.75) : 0,
    }));
  }

  /** Devuelve un frame nuevo a ~30 Hz, o null si todavía no toca. */
  poll(now: number, videoAspect: number): PoseFrame | null {
    if (now - this.last < 1000 / 30) return null;
    this.last = now;
    if (this.people.length !== config.simulator.people) this.setCount(config.simulator.people);
    const t = (now - this.t0) / 1000;
    const count = this.people.length;
    const lm2d = new Float32Array(count * NUM_LM * LM_STRIDE);
    const lm3d = new Float32Array(count * NUM_LM * LM_STRIDE);
    const newMask = this.frameNo++ % MASK_EVERY === 0;
    const mask = newMask ? new Uint8Array(MASK_W * MASK_H) : this.mask;
    const tanV = Math.tan((config.camera.vfovDeg * Math.PI) / 360);
    const tanH = tanV * videoAspect;

    this.people.forEach((sp, pi) => {
      this.pose(t + sp.phase);
      const D = config.simulator.distance + 0.35 * Math.sin(t * 0.13 + sp.phase);
      const root = new Vector3(sp.baseX + 0.35 * Math.sin(t * 0.17 + sp.phase), -0.12, -D);
      const uv: [number, number][] = [];
      // Temblor tipo MediaPipe (metros) para probar los filtros: más fuerte en manos y pies.
      const jit = config.simulator.noise;
      const nz = () => (Math.random() + Math.random() + Math.random() - 1.5) * jit;
      for (let i = 0; i < NUM_LM; i++) {
        const p = this.pts[i];
        const extremity = i >= LM.L_WRIST && i <= LM.R_THUMB ? 2 : i >= LM.L_ANKLE ? 1.5 : 1;
        if (jit > 0) p.add(tmp.set(nz(), nz(), nz() * 2).multiplyScalar(extremity));
        const o = (pi * NUM_LM + i) * LM_STRIDE;
        // Mundo MediaPipe: x a la derecha de la imagen, y hacia abajo, z alejándose.
        lm3d[o] = p.x;
        lm3d[o + 1] = -p.y;
        lm3d[o + 2] = -p.z;
        tmp.copy(p).add(root);
        const u = 0.5 + tmp.x / -tmp.z / (2 * tanH);
        const v = 0.5 - tmp.y / -tmp.z / (2 * tanV);
        const inside = u > 0 && u < 1 && v > 0 && v < 1;
        lm2d[o] = u;
        lm2d[o + 1] = v;
        lm2d[o + 2] = p.z * -0.3;
        lm2d[o + 3] = lm3d[o + 3] = inside ? 0.97 : 0.15;
        uv.push([u * MASK_W, v * MASK_H]);
      }
      if (newMask) this.rasterMask(mask, uv, 0.05 / (D * 2 * tanV) * MASK_H);
    });
    this.mask = mask;
    return {
      ts: now, count, lm2d, lm3d, mask, maskW: MASK_W, maskH: MASK_H,
      maskAreas: new Float32Array(count).fill(0.1), imageW: 640, imageH: Math.round(640 / videoAspect), inferMs: 0,
    };
  }

  /** Pose sintética animada en coordenadas del modelo (Y arriba, mirando a +Z, izquierda en +X). */
  private pose(t: number): void {
    const P = this.pts;
    const fwd = new Vector3(0, 0, 1);
    const back = new Vector3(0, 0, -1);
    const s01 = (f: number, ph = 0) => 0.5 + 0.5 * Math.sin(t * f + ph);

    P[LM.L_HIP].set(0.095, 0, 0);
    P[LM.R_HIP].set(-0.095, 0, 0);
    const lean = 0.06 * Math.sin(t * 0.5);
    const shC = new Vector3(Math.sin(lean) * 0.5, Math.cos(lean) * 0.5, 0.02);
    P[LM.L_SHOULDER].copy(shC).add(new Vector3(0.18, 0, 0));
    P[LM.R_SHOULDER].copy(shC).add(new Vector3(-0.18, 0, 0));

    for (const side of [1, -1] as const) {
      const ph = side > 0 ? 0 : 1.9;
      const abd = 0.25 + 1.6 * s01(0.9, ph);
      const flex = 0.5 * Math.sin(t * 0.6 + ph);
      const elbow = 0.15 + 1.3 * s01(1.4, ph + 0.7);
      const up = new Vector3(Math.sin(abd) * side, -Math.cos(abd), 0).applyAxisAngle(new Vector3(-1, 0, 0), flex).normalize();
      const fore = rotateToward(up.clone(), fwd, elbow).normalize();
      const sh = P[side > 0 ? LM.L_SHOULDER : LM.R_SHOULDER];
      const el = P[side > 0 ? LM.L_ELBOW : LM.R_ELBOW].copy(sh).addScaledVector(up, 0.29);
      const wr = P[side > 0 ? LM.L_WRIST : LM.R_WRIST].copy(el).addScaledVector(fore, 0.25);
      const thumbSide = fwd.clone().addScaledVector(fore, -fore.dot(fwd)).normalize();
      P[side > 0 ? LM.L_INDEX : LM.R_INDEX].copy(wr).addScaledVector(fore, 0.085).addScaledVector(thumbSide, 0.02);
      P[side > 0 ? LM.L_PINKY : LM.R_PINKY].copy(wr).addScaledVector(fore, 0.075).addScaledVector(thumbSide, -0.025);
      P[side > 0 ? LM.L_THUMB : LM.R_THUMB].copy(wr).addScaledVector(fore, 0.04).addScaledVector(thumbSide, 0.04);

      const hipFlex = 0.15 * s01(0.8, ph);
      const knee = 0.05 + 0.35 * s01(0.8, ph);
      const thigh = new Vector3(0.03 * side, -Math.cos(hipFlex), Math.sin(hipFlex)).normalize();
      const shin = rotateToward(thigh.clone(), back, knee).normalize();
      const hip = P[side > 0 ? LM.L_HIP : LM.R_HIP];
      const kn = P[side > 0 ? LM.L_KNEE : LM.R_KNEE].copy(hip).addScaledVector(thigh, 0.43);
      const an = P[side > 0 ? LM.L_ANKLE : LM.R_ANKLE].copy(kn).addScaledVector(shin, 0.41);
      P[side > 0 ? LM.L_HEEL : LM.R_HEEL].copy(an).add(new Vector3(0, -0.05, -0.05));
      P[side > 0 ? LM.L_FOOT : LM.R_FOOT].copy(an).add(new Vector3(0.01 * side, -0.07, 0.15));
    }

    // Cabeza: gira un poco más que el torso.
    const head = new Vector3().copy(shC).add(new Vector3(0, 0.14, 0.02));
    const hy = 0.5 * Math.sin(t * 0.45);
    const local: [number, number, number, number][] = [
      [LM.NOSE, 0, 0.0, 0.1], [LM.L_EYE_IN, 0.015, 0.025, 0.088], [LM.L_EYE, 0.033, 0.026, 0.083],
      [LM.L_EYE_OUT, 0.048, 0.025, 0.075], [LM.R_EYE_IN, -0.015, 0.025, 0.088], [LM.R_EYE, -0.033, 0.026, 0.083],
      [LM.R_EYE_OUT, -0.048, 0.025, 0.075], [LM.L_EAR, 0.075, 0.005, 0.0], [LM.R_EAR, -0.075, 0.005, 0.0],
      [LM.MOUTH_L, 0.025, -0.04, 0.085], [LM.MOUTH_R, -0.025, -0.04, 0.085],
    ];
    for (const [i, x, y, z] of local) P[i].set(x, y, z).applyAxisAngle(new Vector3(0, 1, 0), hy).add(head);

    // Giro y balanceo de todo el cuerpo alrededor de las caderas.
    const yaw = 0.5 * Math.sin(t * 0.3);
    for (const p of P) p.applyAxisAngle(new Vector3(0, 1, 0), yaw);
  }

  /** Dibuja una silueta de cápsulas en la máscara (coordenadas en píxeles de máscara). */
  private rasterMask(mask: Uint8Array, uv: [number, number][], r: number): void {
    const segs: [number, number, number][] = [
      [LM.L_SHOULDER, LM.L_ELBOW, 0.9], [LM.L_ELBOW, LM.L_WRIST, 0.7], [LM.R_SHOULDER, LM.R_ELBOW, 0.9],
      [LM.R_ELBOW, LM.R_WRIST, 0.7], [LM.L_HIP, LM.L_KNEE, 1.5], [LM.L_KNEE, LM.L_ANKLE, 1.0],
      [LM.R_HIP, LM.R_KNEE, 1.5], [LM.R_KNEE, LM.R_ANKLE, 1.0], [LM.L_SHOULDER, LM.L_HIP, 1.6],
      [LM.R_SHOULDER, LM.R_HIP, 1.6], [LM.L_SHOULDER, LM.R_HIP, 1.6], [LM.R_SHOULDER, LM.L_HIP, 1.6],
      [LM.NOSE, LM.L_EAR, 1.6], [LM.NOSE, LM.R_EAR, 1.6], [LM.L_WRIST, LM.L_INDEX, 0.5], [LM.R_WRIST, LM.R_INDEX, 0.5],
      [LM.L_ANKLE, LM.L_FOOT, 0.6], [LM.R_ANKLE, LM.R_FOOT, 0.6], [LM.L_SHOULDER, LM.R_SHOULDER, 1.4],
    ];
    let minX = MASK_W, minY = MASK_H, maxX = 0, maxY = 0;
    for (const [x, y] of uv) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pad = r * 1.6;
    const x0 = Math.max(0, Math.floor(minX - pad)), x1 = Math.min(MASK_W - 1, Math.ceil(maxX + pad));
    const y0 = Math.max(0, Math.floor(minY - pad)), y1 = Math.min(MASK_H - 1, Math.ceil(maxY + pad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let best = 1e9;
        for (const [a, b, w] of segs) {
          const [ax, ay] = uv[a];
          const [bx, by] = uv[b];
          const dx = bx - ax, dy = by - ay;
          const h = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy + 1e-6)));
          const d = Math.hypot(x - ax - dx * h, y - ay - dy * h) - r * w;
          if (d < best) best = d;
        }
        const v = Math.max(0, Math.min(1, 0.5 - best / 1.5)) * 255;
        const i = y * MASK_W + x;
        if (v > mask[i]) mask[i] = v;
      }
    }
  }
}
