// Cues del diseño sonoro (§13). Sin música (§1.8). Todo se sintetiza en vivo; si hay foley grabado
// en public/audio/ (engine.ts), los cues de huesos, carne y sangre lo usan en su lugar.
//  - Ambiente: zumbido de rayos X (50 Hz + ruido rosa), rampas de cámara lenta.
//  - Interfaz: barrido de escáner, monitor cardiaco, línea plana, tecleo, ediciones genéticas.
//  - Equipo médico: oxímetro cuyo tono baja con la saturación, alarma de prioridad alta, disparo del
//    equipo de rayos X (ánodo y pitido de exposición) y el respirador del cerdo.
//  - Efectos: crujidos de hueso por granos (una voz por hueso, `boneVoice`), fragmentos contra el
//    piso, desgarro de carne, ruptura de vasos, chorros, goteo, salpicaduras, trapeador.
//  - Latido: lub-dub con el reloj real, panoramizado según dónde está el corazón.
// Los efectos siguen la cámara lenta (engine.rate y el pasa-bajos del bus); el latido no.
import { config } from '../config.ts';
import { hashString, rng } from '../random.ts';
import type { AudioEngine, Bus } from './engine.ts';

/** Timbre de un hueso: siempre el mismo para el mismo hueso, distinto entre huesos. */
export interface BoneVoice {
  seed: number;
  /** 0..1: masa del hueso (cuerpo del golpe, grave, duración de la cola). */
  size: number;
  /** Multiplicador de afinación de los resonadores. */
  pitch: number;
  /** Granos de la cola (fibras que se cortan, como un tallo de apio). */
  grains: number;
  /** Resonancia hueca (cráneo, pelvis). */
  hollow: number;
}

const SIZES: Record<string, [number, number, number]> = {
  // slot: [masa, granos, hueco]
  skull: [1, 26, 1], cervical: [0.42, 10, 0], thoracic: [0.5, 12, 0], lumbar: [0.55, 12, 0],
  ribs: [0.7, 30, 0.1], cartilage: [0.3, 6, 0], scapula: [0.55, 14, 0.3], clavicle: [0.45, 9, 0],
  pelvis: [0.9, 18, 0.6], humerus: [0.75, 16, 0], forearm: [0.6, 14, 0], hand: [0.32, 20, 0],
  femur: [1, 18, 0], patella: [0.25, 5, 0], leg: [0.85, 16, 0], foot: [0.38, 18, 0],
};

export function boneVoice(slot: string): BoneVoice {
  const base = slot.replace(/_(L|R)$/, '');
  const [size, grains, hollow] = SIZES[base] ?? [0.5, 12, 0];
  const seed = hashString(slot);
  const r = rng(seed);
  return { seed, size, grains, hollow, pitch: 0.8 + 0.45 * r() + (slot.endsWith('_R') ? 0.06 : 0) };
}

export class Cues {
  private engine: AudioEngine;
  private noise: AudioBuffer | null = null;
  private humGain: GainNode | null = null;
  private flat: { osc: OscillatorNode; gain: GainNode } | null = null;
  private lastClack = 0;
  humLevel = 0.6;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  private get ctx(): AudioContext | null {
    return this.engine.unlocked ? this.engine.ctx : null;
  }

  /** Panoramizador hacia un bus (paneo según la posición en pantalla, §13). */
  private out(pan = 0, bus: Bus = 'fx'): AudioNode | null {
    const ctx = this.ctx;
    const dest = this.engine.bus(bus);
    if (!ctx || !dest) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  /** Tono de los efectos (cámara lenta). */
  private get rate(): number {
    return this.engine.rate;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      // Ruido rosa aproximado (filtro de Paul Kellet).
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return this.noise;
  }

  /** Foley grabado si existe (true), para no sintetizar. */
  private sample(name: string, pan: number, gain: number, bus: Bus = 'fx', rate = 1): boolean {
    const ctx = this.ctx;
    const buf = this.engine.sample(name);
    const out = this.out(pan, bus);
    if (!ctx || !buf || !out) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (bus === 'heart' ? 1 : this.rate) * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start();
    return true;
  }

  /** Ruido por un filtro con envolvente: la unidad de casi todo lo líquido y lo que se rompe. */
  private noiseHit(
    ctx: AudioContext, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, gain: number, dur: number,
    attack = 0.002,
  ): BiquadFilterNode {
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 1.6);
    n.stop(t + attack + dur + 0.02);
    return f;
  }

  /** Oscilador con caída de tono (golpes graves, gomas, gotas). */
  private tone(
    ctx: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, glide: number, gain: number,
    dur: number, attack = 0.003,
  ): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + glide);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.02);
  }

  // ═══════════════════════════════ ambiente ═══════════════════════════════

  /** Zumbido grave de rayos X (loop): 50 Hz + armónicos + ruido rosa filtrado. */
  startHum(): void {
    const ctx = this.ctx;
    if (!ctx || this.humGain) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.engine.bus('amb')!);
    for (const [f, a] of [[50, 0.05], [100, 0.018], [150, 0.006]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start();
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(ctx);
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    n.connect(lp).connect(ng).connect(g);
    n.start();
    this.humGain = g;
    this.setHum(this.humLevel);
  }

  setHum(level: number): void {
    this.humLevel = level;
    const ctx = this.ctx;
    if (!ctx || !this.humGain) return;
    this.humGain.gain.setTargetAtTime(level, ctx.currentTime, 0.6);
  }

  /** Rampas de cámara lenta (§13): entrar = el mundo se hunde; salir = vuelve a respirar. */
  slowmo(entering: boolean): void {
    const ctx = this.ctx;
    const out = this.out(0, 'amb');
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const dur = entering ? 0.95 : 0.7;
    const f = this.noiseHit(ctx, out, t, 'lowpass', entering ? 6000 : 260, 1.2, 0.5, dur, 0.06);
    f.frequency.setValueAtTime(entering ? 6000 : 260, t);
    f.frequency.exponentialRampToValueAtTime(entering ? 240 : 6500, t + dur);
    this.tone(ctx, out, t, 'sine', entering ? 120 : 36, entering ? 34 : 95, dur, 0.4, dur, 0.05);
  }

  // ═══════════════════════════════ interfaz ═══════════════════════════════

  /** Barrido de escáner: ruido por un pasabanda que sube. */
  sweep(pan = 0): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'ui');
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const f = this.noiseHit(ctx, out, t, 'bandpass', 300, 6, 0.35, 0.85, 0.1);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + 0.8);
  }

  /** Beep de monitor. */
  beep(freq = 1000, dur = 0.12, gain = 0.18, pan = 0): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'ui');
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setValueAtTime(gain, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Pitido del oxímetro de pulso: el tono baja con la saturación (`spo2`, %), como en un monitor real.
   *  Onda cuadrada filtrada más un seno: el timbre "de monitor", no un pitido de computadora. */
  pulseBeep(spo2: number, gain: number, pan = 0): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'ui');
    if (!ctx || !out || gain <= 0.001) return;
    const A = config.audio;
    const f = A.spo2Base * Math.pow(2, (-(99 - spo2) * A.spo2Semitones) / 12);
    const t = ctx.currentTime;
    const dur = 0.11;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setValueAtTime(gain, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = f * 2.6;
    lp.Q.value = 0.5;
    lp.connect(g).connect(out);
    for (const [type, k] of [['square', 0.22], ['sine', 0.8]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = k;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  /** Alarma médica de prioridad alta (patrón de 10 pulsos: 3 + 2, pausa, 3 + 2). Tono rico en
   *  armónicos, como piden las alarmas de equipos médicos: se oye que algo falla, sin música. */
  alarm(pan = 0, gain = 1): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'ui');
    const level = gain * config.audio.alarm;
    if (!ctx || !out || level <= 0.001) return;
    const t0 = ctx.currentTime + 0.05;
    const starts = [0, 0.19, 0.38, 0.75, 0.94, 1.95, 2.14, 2.33, 2.7, 2.89];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    lp.connect(out);
    for (const s of starts) {
      const t = t0 + s;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 880;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.075 * level, t + 0.015);
      g.gain.setValueAtTime(0.075 * level, t + 0.12);
      g.gain.linearRampToValueAtTime(0, t + 0.145);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + 0.16);
    }
  }

  /** Disparo del equipo de rayos X (§13): el ánodo giratorio arranca (zumbido que sube y silbido),
   *  pitido de exposición mientras dura el barrido y el ánodo que se frena despacio. */
  xrayShot(pan = 0, exposure = 0.8): void {
    const ctx = this.ctx;
    const out = this.out(pan * 0.4, 'ui');
    const level = config.audio.xray;
    if (!ctx || !out || level <= 0.001) return;
    const t = ctx.currentTime;
    // Rotor: arranque (0,35 s) y frenado largo (3,5 s), grave con armónicos.
    for (const [mul, a] of [[1, 0.09], [2, 0.035], [3, 0.015]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(30 * mul, t);
      o.frequency.exponentialRampToValueAtTime(170 * mul, t + 0.35);
      o.frequency.setValueAtTime(170 * mul, t + 0.35 + exposure);
      o.frequency.exponentialRampToValueAtTime(35 * mul, t + 0.35 + exposure + 3.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a * level, t + 0.3);
      g.gain.setValueAtTime(a * level, t + 0.35 + exposure);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + exposure + 3.5);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.4 + exposure + 3.5);
    }
    // Silbido del rodamiento: agudo que sube y después cae con el frenado.
    const w = ctx.createOscillator();
    w.type = 'sine';
    w.frequency.setValueAtTime(2200, t);
    w.frequency.exponentialRampToValueAtTime(5200, t + 0.35);
    w.frequency.exponentialRampToValueAtTime(1400, t + 0.35 + exposure + 2.5);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.012 * level, t + 0.3);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + exposure + 2.5);
    w.connect(wg).connect(out);
    w.start(t);
    w.stop(t + 0.4 + exposure + 2.5);
    // Pitido de exposición (el de la consola, mientras hay radiación).
    const b = ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = 1550;
    const bl = ctx.createBiquadFilter();
    bl.type = 'lowpass';
    bl.frequency.value = 3000;
    const bg = ctx.createGain();
    const tb = t + 0.35;
    bg.gain.setValueAtTime(0, tb);
    bg.gain.linearRampToValueAtTime(0.035 * level, tb + 0.01);
    bg.gain.setValueAtTime(0.035 * level, tb + exposure - 0.02);
    bg.gain.linearRampToValueAtTime(0, tb + exposure);
    b.connect(bl).connect(bg).connect(out);
    b.start(tb);
    b.stop(tb + exposure + 0.05);
  }

  /** Una respiración del respirador (§1.5: el cerdo anestesiado). Clic de válvula, el fuelle que empuja
   *  aire (inspiración), otro clic y el aire que sale solo (espiración). `period` = s por respiración. */
  ventilator(pan: number, gain: number, period: number): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'amb');
    if (!ctx || !out || gain <= 0.001) return;
    const t = ctx.currentTime;
    const insp = Math.min(1.5, period * 0.33);
    // Clic de la válvula inspiratoria.
    this.noiseHit(ctx, out, t, 'bandpass', 2600, 7, 0.07 * gain, 0.018, 0.001);
    this.tone(ctx, out, t, 'sine', 210, 120, 0.04, 0.05 * gain, 0.05, 0.001);
    // Inspiración: aire por el circuito (soplido que sube) y el fuelle (grave).
    const f = this.noiseHit(ctx, out, t + 0.03, 'bandpass', 520, 0.9, 0.16 * gain, insp, insp * 0.55);
    f.frequency.setValueAtTime(420, t + 0.03);
    f.frequency.linearRampToValueAtTime(900, t + 0.03 + insp);
    this.noiseHit(ctx, out, t + 0.03, 'lowpass', 260, 0.7, 0.1 * gain, insp, insp * 0.5);
    this.tone(ctx, out, t + 0.03, 'triangle', 62, 74, insp, 0.05 * gain, insp, insp * 0.4);
    // Válvula espiratoria y el aire que sale (más largo, cae solo).
    const te = t + 0.06 + insp;
    this.noiseHit(ctx, out, te, 'bandpass', 2200, 6, 0.05 * gain, 0.015, 0.001);
    const fe = this.noiseHit(ctx, out, te + 0.02, 'bandpass', 700, 0.8, 0.11 * gain, insp * 1.5, 0.05);
    fe.frequency.setValueAtTime(700, te);
    fe.frequency.exponentialRampToValueAtTime(260, te + insp * 1.5);
  }

  /** Línea plana del monitor: tono sostenido hasta apagarla. */
  flatline(on: boolean, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.flat) {
      const out = this.out(pan, 'ui')!;
      const o = ctx.createOscillator();
      o.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 0.02);
      o.connect(g).connect(out);
      o.start();
      this.flat = { osc: o, gain: g };
    } else if (!on && this.flat) {
      const { osc, gain } = this.flat;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      osc.stop(ctx.currentTime + 0.3);
      this.flat = null;
    }
  }

  /** Tecleo de las etiquetas (muy bajo). */
  click(pan = 0): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'ui');
    if (!ctx || !out) return;
    this.noiseHit(ctx, out, ctx.currentTime, 'highpass', 3500, 0.7, 0.06, 0.025, 0.001);
  }

  /** Edición genética: un gen porcino se apaga (tono que cae) o entra uno humano (tono que sube). */
  gene(pan: number, inserted: boolean): void {
    const ctx = this.ctx;
    const out = this.out(pan, 'ui');
    if (!ctx || !out) return;
    const [a, b] = inserted ? [540, 860] : [700, 330];
    this.tone(ctx, out, ctx.currentTime, 'sine', a, b, 0.16, 0.045, 0.21, 0.01);
  }

  // ═══════════════════════════════ latido ═══════════════════════════════

  /** Latido lub-dub (§13; con el reloj real, sin cámara lenta). Dos voces: el corazón humano del
   *  receptor (seco y corto) y el del cerdo (más grave, largo y húmedo). Después del trasplante el
   *  receptor late con la voz del cerdo: se oye que el corazón es de otro. */
  heartbeat(pan: number, gain: number, voice: 'humano' | 'cerdo' = 'cerdo'): void {
    if (gain <= 0.001 || this.sample(voice === 'cerdo' ? 'heartbeat_pig' : 'heartbeat', pan, gain, 'heart')) return;
    const ctx = this.ctx;
    const out = this.out(pan, 'heart');
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    if (voice === 'humano') {
      this.tone(ctx, out, t, 'sine', 74, 46, 0.1, 0.62 * gain, 0.16, 0.005);
      this.noiseHit(ctx, out, t, 'lowpass', 240, 0.8, 0.32 * gain, 0.06, 0.003);
      this.tone(ctx, out, t + 0.24, 'sine', 96, 62, 0.08, 0.42 * gain, 0.11, 0.004);
      this.noiseHit(ctx, out, t + 0.24, 'lowpass', 320, 0.8, 0.22 * gain, 0.045, 0.003);
      return;
    }
    // Lub: cierre de las válvulas mitral y tricúspide (grave, largo).
    this.tone(ctx, out, t, 'sine', 56, 32, 0.16, 0.75 * gain, 0.28, 0.008);
    this.noiseHit(ctx, out, t, 'lowpass', 170, 0.8, 0.55 * gain, 0.11, 0.005);
    // Humedad: un chapoteo grave y breve dentro del golpe.
    this.noiseHit(ctx, out, t + 0.02, 'bandpass', 140, 1.6, 0.3 * gain, 0.12, 0.01);
    // Dub: aórtica y pulmonar (más agudo y corto).
    this.tone(ctx, out, t + 0.3, 'sine', 70, 44, 0.12, 0.52 * gain, 0.18, 0.006);
    this.noiseHit(ctx, out, t + 0.3, 'lowpass', 230, 0.8, 0.38 * gain, 0.07, 0.004);
  }

  // ═══════════════════════════════ huesos ═══════════════════════════════

  /** Un grano: ruido cortísimo por un pasabanda resonante (la unidad del crujido). */
  private grain(ctx: AudioContext, out: AudioNode, t: number, freq: number, q: number, gain: number, dur: number): void {
    this.noiseHit(ctx, out, t, 'bandpass', freq * this.rate, q, gain, dur / this.rate, 0.001);
  }

  /** La grieta se propaga: chasquidos finos cada vez más densos durante `dur` segundos. */
  crackle(pan: number, v: BoneVoice, dur: number): void {
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const r = rng(v.seed ^ 0x51ed);
    const t0 = ctx.currentTime;
    const n = Math.round(4 + v.grains * 0.5);
    for (let k = 0; k < n; k++) {
      // Densidad creciente: la grieta acelera antes de romper.
      const x = Math.sqrt((k + r()) / n);
      const t = t0 + (x * dur) / this.rate;
      this.grain(ctx, out, t, (2400 + 4200 * r()) * v.pitch, 7 + 6 * r(), (0.05 + 0.12 * x) * (0.6 + 0.4 * r()), 0.004 + 0.006 * r());
    }
  }

  /** El hueso estalla: transitorio seco, cuerpo resonante, golpe grave y cola de fibras. */
  snap(pan: number, v: BoneVoice, gain = 1): void {
    const foley = v.size >= 0.7 && v.grains >= 30 ? 'rib_break_heavy' : 'bone_crack';
    if (this.sample(foley, pan, gain, 'fx', v.pitch)) return;
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const r = rng(v.seed);
    const t = ctx.currentTime;
    const rate = this.rate;
    // Transitorio: 3 ms de ruido brillante.
    this.noiseHit(ctx, out, t, 'highpass', 1800 * rate, 0.7, 0.9 * gain, 0.012, 0.001);
    // Cuerpo: dos resonadores (la "madera" del hueso) que decaen según su masa.
    const body = (380 + 650 * (1 - v.size)) * v.pitch;
    this.grain(ctx, out, t, body, 3.5, 0.55 * gain, 0.04 + 0.07 * v.size);
    this.grain(ctx, out, t + 0.002, body * (1.6 + 0.5 * r()), 5, 0.3 * gain, 0.03 + 0.04 * v.size);
    // Golpe grave con caída de tono.
    const f0 = (150 - 70 * v.size) * v.pitch * rate;
    this.tone(ctx, out, t, 'sine', f0, f0 * 0.45, 0.12 / rate, 0.5 * v.size * gain, (0.08 + 0.12 * v.size) / rate, 0.001);
    // Hueco (cráneo, pelvis): resonancia larga y oscura.
    if (v.hollow > 0) {
      this.grain(ctx, out, t + 0.004, 520 * v.pitch, 9, 0.35 * v.hollow * gain, 0.18);
      this.grain(ctx, out, t + 0.006, 830 * v.pitch, 11, 0.2 * v.hollow * gain, 0.12);
    }
    // Cola: fibras que se cortan, cada vez más espaciadas y suaves.
    const tail = (0.12 + 0.2 * v.size) / rate;
    for (let k = 0; k < v.grains; k++) {
      const x = (k + r()) / v.grains;
      this.grain(
        ctx, out, t + 0.008 + x * x * tail, (1300 + 4200 * r()) * v.pitch, 4 + 8 * r(),
        (0.22 * (1 - x) + 0.03) * gain * (0.5 + 0.5 * r()), 0.005 + 0.012 * r(),
      );
    }
  }

  /** Un fragmento contra el piso (limitado para no saturar). */
  clack(pan: number, size: number): void {
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    if (t - this.lastClack < 0.035) return;
    this.lastClack = t;
    const k = Math.min(1, size / 0.05);
    this.grain(ctx, out, t, 2600 + 2400 * Math.random(), 6, 0.08 + 0.12 * k, 0.012);
    this.grain(ctx, out, t, 700 + 500 * Math.random(), 4, 0.05 + 0.1 * k, 0.03);
  }

  /** Crujido de hueso genérico (compatibilidad): una voz media. */
  crack(pan = 0, pitch = 1): void {
    this.snap(pan, { seed: Math.floor(pitch * 1000), size: 0.6, pitch, grains: 14, hollow: 0 }, 0.8);
  }

  /** Golpe sub-grave de los hit-stops: seno de 40 Hz con caída rápida. */
  sub(gain = 0.7): void {
    const ctx = this.ctx;
    const out = this.out(0, 'fx');
    if (!ctx || !out) return;
    this.tone(ctx, out, ctx.currentTime, 'sine', 70, 38, 0.25, gain, 0.6, 0.002);
  }

  // ═══════════════════════════════ carne y sangre ═══════════════════════════════

  /** El corazón es arrancado: toalla mojada que se retuerce (desgarro húmedo, §13). */
  fleshTear(pan: number, dur = 0.8, gain = 1): void {
    if (this.sample('flesh_tear', pan, gain)) return;
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const d = dur / this.rate;
    // Lecho de fibras: pasabanda que baja mientras el tejido cede.
    const f = this.noiseHit(ctx, out, t, 'bandpass', 1500 * this.rate, 1.4, 0.32 * gain, d, 0.05);
    f.frequency.exponentialRampToValueAtTime(380 * this.rate, t + d);
    // Desgarros: granos húmedos irregulares, más densos al principio.
    const n = Math.round(26 * dur);
    for (let k = 0; k < n; k++) {
      const x = Math.pow(Math.random(), 1.6);
      this.grain(ctx, out, t + x * d, 380 + 1100 * Math.random(), 2.5 + 3 * Math.random(), 0.12 * gain * (1 - x * 0.6), 0.02 + 0.04 * Math.random());
    }
    // Chapoteo grave: la cavidad llena de sangre.
    this.tone(ctx, out, t + 0.05, 'sine', 110 * this.rate, 55 * this.rate, d, 0.22 * gain, d * 0.8, 0.03);
  }

  /** Un vaso se rompe: goma que salta + chapoteo (§13). */
  vesselSnap(pan: number, gain = 1): void {
    if (this.sample('vessel_snap', pan, gain)) return;
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const r = this.rate;
    this.noiseHit(ctx, out, t, 'highpass', 2200 * r, 0.7, 0.5 * gain, 0.008, 0.001);
    this.tone(ctx, out, t, 'triangle', 1150 * r, 130 * r, 0.07 / r, 0.4 * gain, 0.09 / r, 0.001);
    this.noiseHit(ctx, out, t + 0.02 / r, 'bandpass', 800 * r, 1.2, 0.35 * gain, 0.24 / r, 0.004);
  }

  /** Chorro arterial (un pulso por latido): agua jabonosa a presión con gorgoteo. */
  spurt(pan: number, gain = 1): void {
    if (this.sample('spurt', pan, gain)) return;
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const r = this.rate;
    this.noiseHit(ctx, out, t, 'lowpass', 1700 * r, 0.9, 0.35 * gain, 0.28 / r, 0.012);
    for (let k = 0; k < 4; k++) {
      this.grain(ctx, out, t + (0.03 + 0.05 * k) / r, 280 + 420 * Math.random(), 9, 0.16 * gain, 0.05 + 0.04 * Math.random());
    }
  }

  /** Una gota cae al charco: el "plip" de una burbuja (resonancia que sube). */
  drip(pan: number, gain = 1): void {
    if (this.sample('drip', pan, gain * 0.6)) return;
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const f = (650 + 500 * Math.random()) * this.rate;
    this.tone(ctx, out, t, 'sine', f, f * 2.1, 0.035, 0.09 * gain, 0.09, 0.001);
    this.grain(ctx, out, t, 3200, 2, 0.03 * gain, 0.006);
  }

  /** Sangre que golpea el piso o el hueso: golpe sordo + salpicadura. */
  splat(pan: number, gain = 1): void {
    if (this.sample('splat', pan, gain)) return;
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const r = this.rate;
    this.tone(ctx, out, t, 'sine', 95 * r, 48 * r, 0.1 / r, 0.35 * gain, 0.12 / r, 0.002);
    this.noiseHit(ctx, out, t, 'bandpass', 900 * r, 0.9, 0.3 * gain, 0.18 / r, 0.003);
    for (let k = 0; k < 6; k++) this.grain(ctx, out, t + (0.02 + 0.03 * k * Math.random()) / r, 1200 + 2000 * Math.random(), 4, 0.06 * gain, 0.015);
  }

  /** Una gota golpea la lente: toque húmedo y corto. */
  lensTap(pan: number): void {
    const ctx = this.ctx;
    const out = this.out(pan);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    this.grain(ctx, out, t, 2400, 3, 0.07, 0.01);
    this.grain(ctx, out, t, 420, 2, 0.08, 0.05);
  }

  /** Una pasada del trapeador (§9.6): roce húmedo que cruza la sala de `from` a `to` (paneo). */
  mop(from: number, to: number, dur: number): void {
    const ctx = this.ctx;
    const out = this.out(from);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    (out as StereoPannerNode).pan.setValueAtTime(Math.max(-1, Math.min(1, from)), t);
    (out as StereoPannerNode).pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, to)), t + dur);
    const f = this.noiseHit(ctx, out, t, 'bandpass', 1100, 1.1, 0.16, dur, dur * 0.25);
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    this.noiseHit(ctx, out, t, 'lowpass', 320, 0.7, 0.12, dur, dur * 0.3);
  }
}
