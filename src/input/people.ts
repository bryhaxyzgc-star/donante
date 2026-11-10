// Identidad estable de las personas entre frames (§7): asociación greedy por el
// centro de caderas, filtros One Euro por persona y gracia ante pérdida de tracking.
import { config } from '../config.ts';
import { OneEuroArray } from './oneEuro.ts';
import { LM, LM_STRIDE, NUM_LM, type PoseFrame } from './poseTypes.ts';

export type PersonState = 'active' | 'lost' | 'leaving';

export interface Person {
  id: number;
  /** Landmarks filtrados (33 × 4). La 4.ª componente es la visibilidad suavizada. */
  lm2d: Float32Array;
  lm3d: Float32Array;
  firstSeen: number;
  lastSeen: number;
  /** Segundos con detección continua (para "persona estable" de la Fase 3). */
  stableTime: number;
  /** 0..1, fundido de aparición/desaparición. */
  presence: number;
  state: PersonState;
  maskArea: number;
  /** Centro de caderas filtrado (fracción de imagen). */
  hipX: number;
  hipY: number;
  /** Centro de caderas CRUDO de la última detección y su velocidad (fracción de imagen por segundo):
   *  la asociación entre frames usa estos, porque el filtrado va atrasado y en un cruce elige mal. */
  trackX: number;
  trackY: number;
  vx: number;
  vy: number;
  /** Hay datos nuevos desde el último retarget. */
  fresh: boolean;
  /** Frames de pose recibidos. */
  frames: number;
  f2d: OneEuroArray;
  f3d: OneEuroArray;
}

const SIZE = NUM_LM * LM_STRIDE;

function hipCenter(lm: Float32Array, off: number): [number, number] {
  const a = off + LM.L_HIP * LM_STRIDE;
  const b = off + LM.R_HIP * LM_STRIDE;
  return [(lm[a] + lm[b]) * 0.5, (lm[a + 1] + lm[b + 1]) * 0.5];
}

export class PeopleTracker {
  people: Person[] = [];
  private nextId = 1;
  private scratch2d = new Float32Array(SIZE);
  private scratch3d = new Float32Array(SIZE);

  /** Incorpora un frame de pose. `now` en segundos del reloj real. */
  ingest(frame: PoseFrame, now: number): void {
    const t = frame.ts / 1000;
    // Más detecciones que personas permitidas: quedarse con las de mayor máscara (§7).
    let dets = Array.from({ length: frame.count }, (_, i) => i);
    if (dets.length > config.tracking.maxPeople) {
      dets.sort((a, b) => (frame.maskAreas[b] ?? 0) - (frame.maskAreas[a] ?? 0));
      dets = dets.slice(0, config.tracking.maxPeople);
    }
    const centers = dets.map((d) => hipCenter(frame.lm2d, d * SIZE));

    // Pares (persona, detección) ordenados por distancia a la posición PREDICHA → greedy.
    // La predicción por velocidad evita que dos personas que se cruzan intercambien identidad
    // (y con ella el rol, §7).
    const pairs: { p: number; d: number; dist: number }[] = [];
    this.people.forEach((person, pi) => {
      if (person.state === 'leaving') return;
      const dt = Math.min(0.5, Math.max(0, now - person.lastSeen));
      const px = person.trackX + person.vx * dt;
      const py = person.trackY + person.vy * dt;
      centers.forEach(([x, y], di) => {
        pairs.push({ p: pi, d: di, dist: Math.hypot(px - x, py - y) });
      });
    });
    pairs.sort((a, b) => a.dist - b.dist);
    const usedP = new Set<number>();
    const usedD = new Set<number>();
    for (const pr of pairs) {
      if (pr.dist > config.tracking.matchDist) break;
      if (usedP.has(pr.p) || usedD.has(pr.d)) continue;
      usedP.add(pr.p);
      usedD.add(pr.d);
      this.update(this.people[pr.p], frame, dets[pr.d], t, now);
    }
    centers.forEach((_, di) => {
      if (usedD.has(di)) return;
      const active = this.people.filter((p) => p.state !== 'leaving').length;
      if (active >= config.tracking.maxPeople) return;
      const person = this.create(now);
      this.people.push(person);
      this.update(person, frame, dets[di], t, now);
    });
  }

  private create(now: number): Person {
    const f = config.filter;
    return {
      id: this.nextId++,
      lm2d: new Float32Array(SIZE),
      lm3d: new Float32Array(SIZE),
      firstSeen: now,
      lastSeen: now,
      stableTime: 0,
      presence: 0,
      state: 'active',
      maskArea: 0,
      hipX: 0.5,
      hipY: 0.5,
      trackX: 0.5,
      trackY: 0.5,
      vx: 0,
      vy: 0,
      fresh: false,
      frames: 0,
      f2d: new OneEuroArray(NUM_LM * 2, f.minCutoff2d, f.beta2d, f.dCutoff),
      f3d: new OneEuroArray(NUM_LM * 3, f.minCutoff3d, f.beta3d, f.dCutoff),
    };
  }

  private update(person: Person, frame: PoseFrame, det: number, t: number, now: number): void {
    const f = config.filter;
    const off = det * SIZE;
    this.scratch2d.set(frame.lm2d.subarray(off, off + SIZE));
    this.scratch3d.set(frame.lm3d.subarray(off, off + SIZE));
    person.f2d.minCutoff = f.minCutoff2d;
    person.f2d.beta = f.beta2d;
    person.f3d.minCutoff = f.minCutoff3d;
    person.f3d.beta = f.beta3d;
    person.f2d.dCutoff = person.f3d.dCutoff = f.dCutoff;

    const firstFrame = person.frames === 0;
    const [rx, ry] = hipCenter(this.scratch2d, 0);
    const dtVis = Math.min(0.2, Math.max(0, now - person.lastSeen));
    const kVis = firstFrame ? 1 : 1 - Math.exp(-f.visibilityRate * dtVis);
    // Visibilidad: la del 2D (más estable), suavizada exponencialmente.
    for (let i = 0; i < NUM_LM; i++) {
      const j = i * LM_STRIDE + 3;
      const v = this.scratch2d[j];
      person.lm2d[j] += (v - person.lm2d[j]) * kVis;
      person.lm3d[j] = person.lm2d[j];
    }
    person.f2d.filter(this.scratch2d, t, person.lm2d, LM_STRIDE, 2);
    person.f3d.filter(this.scratch3d, t, person.lm3d, LM_STRIDE, 3);
    const [hx, hy] = hipCenter(person.lm2d, 0);
    const dtv = now - person.lastSeen;
    if (!firstFrame && dtv > 1e-3) {
      const k = 1 - Math.exp(-6 * dtv);
      person.vx += ((rx - person.trackX) / dtv - person.vx) * k;
      person.vy += ((ry - person.trackY) / dtv - person.vy) * k;
    }
    person.trackX = rx;
    person.trackY = ry;
    person.hipX = hx;
    person.hipY = hy;
    // Un corte breve de detección ('lost') no borra lo acumulado: con MediaPipe lento o cuando pierde un
    // instante a una de las dos personas, la obra igual tiene que arrancar sola.
    if (person.state === 'active' || person.state === 'lost') person.stableTime += Math.min(0.5, Math.max(0, now - person.lastSeen));
    person.state = 'active';
    person.lastSeen = now;
    person.maskArea = frame.maskAreas[det] ?? 0;
    person.fresh = true;
    person.frames++;
  }

  /** Avanza fundidos y estados. Se llama una vez por frame de render. */
  tick(dt: number, now: number): void {
    const tr = config.tracking;
    for (const p of this.people) {
      const since = now - p.lastSeen;
      if (p.state !== 'leaving' && since > tr.lostGrace) p.state = 'leaving';
      else if (p.state === 'active' && since > 0.25) p.state = 'lost';
      // Solo quien se fue de verdad (más de lostGrace sin detección) vuelve a empezar de cero.
      if (p.state === 'leaving') p.stableTime = 0;
      if (p.state === 'leaving') p.presence = Math.max(0, p.presence - dt / tr.fadeOut);
      else p.presence = Math.min(1, p.presence + dt / tr.fadeIn);
    }
    this.people = this.people.filter((p) => p.state !== 'leaving' || p.presence > 0);
  }

  clear(): void {
    this.people = [];
  }
}
