// Cámara cinematográfica (§12).
//  - Sacudida (Fase 4): ruido suave, 3–6 px por impacto, sobre la vista (los textos no tiemblan).
//  - Rig de planos (Fase 6): los 10 planos de §9.5. Entre planos, cortes secos (sin interpolar);
//    dentro de cada plano, un movimiento lento (acercamiento, retroceso u órbita). Cada plano se
//    define en un marco local (tórax del donante, corazón, corazón en viaje, receptor) cuyo eje X
//    apunta "hacia afuera" (lejos del receptor), Y arriba y Z hacia la cámara.
//    Usa la misma cámara del escenario: al terminar vuelve exacta a la calibración de la webcam.
//  - Curva de tiempo (timeScale) Hermite monótona, editable como texto en config.cinematic.
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { config } from '../config.ts';

/** Ruido 1D suave tipo Perlin: suma de senos de frecuencias inconmensurables (sin patrón visible). */
function noise1(t: number, seed: number): number {
  return (
    0.5 * Math.sin(t * 1.0 + seed) +
    0.3 * Math.sin(t * 2.17 + seed * 1.7) +
    0.2 * Math.sin(t * 4.71 + seed * 2.9)
  );
}

export class CameraShake {
  /** Amplitud actual en px a 1080p (decae exponencialmente). */
  private amp = 0;
  private t = 0;
  private seedX = Math.random() * 100;
  private seedY = Math.random() * 100;
  x = 0;
  y = 0;

  /** Golpe: la amplitud salta a `px` si es mayor que la actual. */
  kick(px: number): void {
    this.amp = Math.max(this.amp, px);
  }

  /** `dt` real: la sacudida se siente aunque el reloj de juego esté en hit-stop. */
  update(dt: number, canvasH: number): void {
    const T = config.transform;
    this.t += dt * T.shakeFreq;
    this.amp *= Math.exp(-dt * T.shakeDecay);
    if (this.amp < 0.02) this.amp = 0;
    const k = (this.amp * canvasH) / 1080;
    this.x = noise1(this.t, this.seedX) * k;
    this.y = noise1(this.t * 1.13, this.seedY) * k;
  }

  get active(): boolean {
    return this.amp > 0;
  }

  /** Desplaza la vista (en px del canvas) solo mientras se renderiza: los textos no tiemblan. */
  apply(camera: PerspectiveCamera, sign: 1 | -1): void {
    if (!this.amp || !camera.view) return;
    camera.view.offsetX += this.x * sign;
    camera.view.offsetY += this.y * sign;
    camera.updateProjectionMatrix();
  }
}

// ═══════════════════════════════ curva de tiempo ═══════════════════════════════

/** "t:valor, t:valor, …" → claves ordenadas. */
function parseCurve(s: string): [number, number][] {
  const keys = s
    .split(',')
    .map((p) => p.split(':').map((x) => Number(x.trim())))
    .filter((p): p is [number, number] => p.length === 2 && p.every(Number.isFinite))
    .sort((a, b) => a[0] - b[0]);
  return keys.length ? keys : [[0, 1]];
}

/** Curva Hermite monótona (Fritsch–Carlson): sin sobrepasos, la cámara lenta nunca "rebota". */
export class TimeCurve {
  private src = '';
  private keys: [number, number][] = [[0, 1]];
  private m: number[] = [0];

  private build(s: string): void {
    this.src = s;
    const k = (this.keys = parseCurve(s));
    const n = k.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / Math.max(1e-6, k[i + 1][0] - k[i][0]));
    const m = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    if (n > 1) {
      m[0] = d[0];
      m[n - 1] = d[n - 2];
    }
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    this.m = m;
  }

  value(t: number, src: string): number {
    if (src !== this.src) this.build(src);
    const k = this.keys;
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0;
    while (t > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0];
    const s = (t - k[i][0]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * k[i][1] + (s3 - 2 * s2 + s) * h * this.m[i] +
      (-2 * s3 + 3 * s2) * k[i + 1][1] + (s3 - s2) * h * this.m[i + 1]
    );
  }
}

// ═══════════════════════════════ planos ═══════════════════════════════

export type ShotFrame = 'calibrada' | 'donante' | 'cavidad' | 'corazon' | 'corazonViaje' | 'receptor';

interface Key {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface Shot {
  n: number;
  name: string;
  t0: number;
  frame: ShotFrame;
  from: Key;
  to: Key;
  /** Órbita alrededor del objetivo (grados, de inicio a fin) sobre el eje vertical. */
  orbit?: [number, number];
  /** Rango de foco (m) para la profundidad de campo: chico en los macros. */
  focusRange: number;
}

const k = (pos: Key['pos'], target: Key['target'], fov: number): Key => ({ pos, target, fov });

/** La lista de planos de §9.5 (los tiempos de inicio van en segundos reales del estado). */
export const SHOTS: Shot[] = [
  { n: 1, name: 'general', t0: 0, frame: 'calibrada', from: k([0, 0, 0], [0, 0, -1], 0), to: k([0, 0, 0], [0, 0, -1], 0), focusRange: 3 },
  { n: 1, name: 'medio del donante', t0: 0.22, frame: 'donante', from: k([0.34, 0.02, 1.6], [0, -0.14, 0], 34), to: k([0.3, 0.01, 1.32], [0, -0.12, 0], 34), focusRange: 0.9 },
  { n: 2, name: 'tórax en órbita', t0: 0.6, frame: 'donante', from: k([0, 0.06, 0.78], [0, 0, 0.03], 30), to: k([0, 0.04, 0.72], [0, 0, 0.03], 30), orbit: [-16, 16], focusRange: 0.35 },
  { n: 3, name: 'macro de costillas', t0: 1.8, frame: 'cavidad', from: k([0.13, 0.05, 0.33], [0, 0, 0], 26), to: k([0.12, 0.04, 0.3], [0, 0, 0], 26), focusRange: 0.08 },
  { n: 4, name: 'macro que retrocede', t0: 2.4, frame: 'cavidad', from: k([0.11, 0.05, 0.3], [0, 0, 0], 27), to: k([0.2, 0.12, 0.88], [0, -0.03, -0.05], 33), focusRange: 0.2 },
  { n: 5, name: 'corazón de frente', t0: 4.0, frame: 'corazon', from: k([0, 0.03, 0.44], [0, 0, 0], 24), to: k([0, 0.02, 0.35], [0, 0, 0], 24), focusRange: 0.1 },
  { n: 6, name: 'detalle lateral', t0: 5.5, frame: 'corazon', from: k([0.56, 0.07, 0.2], [0, 0, 0.07], 30), to: k([0.5, 0.05, 0.34], [0, 0, 0.1], 30), focusRange: 0.18 },
  { n: 7, name: 'a la lente', t0: 7.5, frame: 'corazon', from: k([-0.04, 0.08, 0.56], [0, 0.04, 0.1], 40), to: k([-0.04, 0.07, 0.5], [0, 0.04, 0.1], 40), focusRange: 0.3 },
  { n: 8, name: 'seguimiento del corazón', t0: 8.5, frame: 'corazonViaje', from: k([0.05, 0.14, 0.6], [0, 0, 0], 34), to: k([-0.1, 0.1, 0.5], [0, 0, 0], 32), focusRange: 0.25 },
  { n: 9, name: 'tórax del receptor', t0: 11.0, frame: 'receptor', from: k([0.12, 0.04, 0.82], [0, -0.02, 0], 30), to: k([0.1, 0.03, 0.62], [0, -0.02, 0], 30), focusRange: 0.2 },
  { n: 10, name: 'vuelta al general', t0: 12.5, frame: 'calibrada', from: k([0, 0, 0], [0, 0, -1], 0), to: k([0, 0, 0], [0, 0, -1], 0), focusRange: 3 },
];

/** Marcos de los planos, en mundo. Los fija la extracción. */
export interface ShotAnchors {
  donor: Vector3;
  cavity: Vector3;
  heart: Vector3;
  /** Posición actual del corazón que viaja (plano 8). */
  heartLive: Vector3;
  receptor: Vector3;
  /** +1/-1: el "afuera" (lejos del receptor) en X de mundo. */
  out: number;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpO = new Vector3();

function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class CinematicRig {
  /** Plano actual (null = cámara calibrada, la de la webcam). */
  shot: Shot | null = null;
  readonly position = new Vector3();
  readonly target = new Vector3();
  fov = 30;
  /** Distancia y rango de foco para la profundidad de campo. */
  focus = 1;
  focusRange = 1;
  private smoothPos = new Vector3();
  private smoothTarget = new Vector3();
  private lastShot: Shot | null = null;

  /** Elige el plano y calcula la cámara para `t` (segundos reales del estado). */
  update(t: number, a: ShotAnchors, dt: number): void {
    let shot = SHOTS[0];
    for (const s of SHOTS) if (t >= s.t0) shot = s;
    const idx = SHOTS.indexOf(shot);
    const t1 = SHOTS[idx + 1]?.t0 ?? shot.t0 + 1.5;
    this.shot = shot.frame === 'calibrada' ? null : shot;
    if (!this.shot) {
      this.lastShot = null;
      return;
    }
    const u = ease((t - shot.t0) / Math.max(0.01, t1 - shot.t0));
    const origin = this.frameOrigin(shot.frame, a, tmpO);
    const local = (v: [number, number, number], out: Vector3) =>
      out.set(v[0] * a.out, v[1], v[2]).add(origin);
    local(shot.from.pos, tmpA);
    local(shot.to.pos, tmpB);
    this.position.lerpVectors(tmpA, tmpB, u);
    local(shot.from.target, tmpA);
    local(shot.to.target, tmpB);
    this.target.lerpVectors(tmpA, tmpB, u);
    if (shot.orbit) {
      const ang = MathUtils.degToRad(MathUtils.lerp(shot.orbit[0], shot.orbit[1], u)) * a.out;
      tmpA.subVectors(this.position, this.target).applyAxisAngle(UP, ang);
      this.position.copy(this.target).add(tmpA);
    }
    this.fov = MathUtils.lerp(shot.from.fov, shot.to.fov, u);
    // Plano de seguimiento: la cámara acompaña con inercia (sin temblor del objeto seguido).
    if (shot.frame === 'corazonViaje' && this.lastShot === shot) {
      const kk = 1 - Math.exp(-6 * dt);
      this.smoothPos.lerp(this.position, kk);
      this.smoothTarget.lerp(this.target, Math.min(1, kk * 1.6));
      this.position.copy(this.smoothPos);
      this.target.copy(this.smoothTarget);
    } else {
      this.smoothPos.copy(this.position);
      this.smoothTarget.copy(this.target);
    }
    this.lastShot = shot;
    this.focus = this.position.distanceTo(this.target);
    this.focusRange = shot.focusRange;
  }

  private frameOrigin(f: ShotFrame, a: ShotAnchors, out: Vector3): Vector3 {
    switch (f) {
      case 'donante':
        return out.copy(a.donor);
      case 'cavidad':
        return out.copy(a.cavity);
      case 'corazon':
        return out.copy(a.heart);
      case 'corazonViaje':
        return out.copy(a.heartLive);
      case 'receptor':
        return out.copy(a.receptor);
      default:
        return out.set(0, 0, 0);
    }
  }

  /** Coloca la cámara del plano (sin la calibración; la sacudida sigue funcionando). */
  apply(camera: PerspectiveCamera, canvasW: number, canvasH: number): void {
    camera.position.copy(this.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    camera.fov = this.fov;
    camera.aspect = canvasW / Math.max(1, canvasH);
    camera.setViewOffset(canvasW, canvasH, 0, 0, canvasW, canvasH);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /** Vuelve a la cámara de la webcam (en el origen, mirando a -Z; la calibración la pone Projection). */
  static restore(camera: PerspectiveCamera): void {
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.updateMatrixWorld(true);
  }
}

const UP = new Vector3(0, 1, 0);
