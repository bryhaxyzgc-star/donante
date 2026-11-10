// Motor de audio (Web Audio, §13). Sin música (§1.8): solo diseño sonoro.
//  - Desbloqueo con una tecla del operador (exigencia del navegador) y silencio (M).
//  - Buses de mezcla: ambiente (zumbido), interfaz (monitor, tecleo), efectos (huesos, carne,
//    sangre) y latido. Todo pasa por un compresor suave antes de los parlantes.
//  - Reverberación corta de sala con azulejos (ConvolverNode con respuesta generada al vuelo).
//  - Cámara lenta: los efectos bajan de tono y pasan por un pasa-bajos; el latido no (va con el
//    reloj real, §8).
//  - Foley opcional: si existe public/audio/manifest.json ({ "bone_crack": ["bone_crack_01.wav", …] })
//    se cargan esos archivos (locales, offline §1.9) y los cues los prefieren a la síntesis.
import { config } from '../config.ts';
import { asset } from '../base.ts';

export type Bus = 'amb' | 'ui' | 'fx' | 'heart';
const BUSES: Bus[] = ['amb', 'ui', 'fx', 'heart'];

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  onUnlock: () => void = () => {};
  /** Multiplicador de tono y velocidad de los efectos (1 = normal, < 1 = cámara lenta). */
  rate = 1;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private sends: Partial<Record<Bus, GainNode>> = {};
  private fxFilter: BiquadFilterNode | null = null;
  private reverbReturn: GainNode | null = null;
  private samples = new Map<string, AudioBuffer[]>();
  private unlockNotified = false;

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  async unlock(): Promise<void> {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master.connect(comp).connect(ctx.destination);
      // Reverberación de sala clínica.
      const reverb = ctx.createConvolver();
      reverb.buffer = tiledRoom(ctx);
      this.reverbReturn = ctx.createGain();
      reverb.connect(this.reverbReturn).connect(this.master);
      this.fxFilter = ctx.createBiquadFilter();
      this.fxFilter.type = 'lowpass';
      this.fxFilter.frequency.value = 18000;
      this.fxFilter.Q.value = 0.5;
      this.fxFilter.connect(this.master);
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.connect(b === 'fx' ? this.fxFilter : this.master);
        const send = ctx.createGain();
        g.connect(send).connect(reverb);
        this.buses[b] = g;
        this.sends[b] = send;
      }
      this.sync();
      void this.loadSamples();
    }
    // Sin gesto del usuario (y sin la política de autoplay del lanzador) esto no llega a 'running' y se
    // reintenta con la primera tecla o clic.
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    if (this.unlocked && !this.unlockNotified) {
      this.unlockNotified = true;
      this.onUnlock();
    }
  }

  /** Entrada de un bus (los cues conectan ahí su panoramizador). */
  bus(name: Bus): AudioNode | null {
    return this.buses[name] ?? this.master;
  }

  /** Niveles de config → buses (barato; una vez por frame). */
  sync(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const A = config.audio;
    const lv: Record<Bus, number> = { amb: A.ambience, ui: A.interface, fx: A.effects, heart: A.heart };
    const sd: Record<Bus, number> = { amb: 0, ui: A.reverbUi, fx: A.reverbFx, heart: A.reverbHeart };
    for (const b of BUSES) {
      this.buses[b]?.gain.setTargetAtTime(lv[b], ctx.currentTime, 0.05);
      this.sends[b]?.gain.setTargetAtTime(sd[b], ctx.currentTime, 0.05);
    }
    this.reverbReturn?.gain.setTargetAtTime(A.reverb, ctx.currentTime, 0.05);
  }

  /** Cámara lenta (§13): con timeScale < 1 los efectos bajan de tono y se apagan los agudos. */
  setTimeScale(ts: number): void {
    const s = Math.max(0, Math.min(1, ts));
    this.rate = 0.5 + 0.5 * s;
    const ctx = this.ctx;
    if (!ctx || !this.fxFilter) return;
    this.fxFilter.frequency.setTargetAtTime(450 + 17500 * s * s, ctx.currentTime, 0.08);
  }

  /** Una variante al azar del foley `name`, o null si no hay archivo (se sintetiza). */
  sample(name: string): AudioBuffer | null {
    const list = this.samples.get(name);
    return list?.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    let manifest: Record<string, string[]> = {};
    try {
      const r = await fetch(asset('audio/manifest.json'));
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      manifest = await r.json();
    } catch {
      return;
    }
    for (const [name, files] of Object.entries(manifest)) {
      const list: AudioBuffer[] = [];
      for (const f of files ?? []) {
        try {
          const r = await fetch(asset(`audio/${f}`));
          if (r.ok) list.push(await ctx.decodeAudioData(await r.arrayBuffer()));
        } catch (err) {
          console.warn(`[audio] no se pudo cargar ${f}`, err);
        }
      }
      if (list.length) this.samples.set(name, list);
    }
    if (this.samples.size) console.info(`[audio] foley: ${[...this.samples.keys()].join(', ')}`);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}

/** Respuesta de una sala chica con azulejos: reflexiones tempranas duras y una cola brillante
 *  y corta (RT60 ≈ 0,9 s) que se oscurece al final. */
function tiledRoom(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * 1.3);
  const buf = ctx.createBuffer(2, len, sr);
  const rt60 = 0.9;
  const early = [0.007, 0.011, 0.017, 0.023, 0.031, 0.038, 0.049, 0.061];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp((-6.9 * t) / rt60);
      // Los agudos mueren antes (el aire y la lechada): un pasa-bajos que se cierra con el tiempo.
      const k = 0.08 + 0.8 * Math.exp(-t * 4);
      lp += ((Math.random() * 2 - 1) - lp) * k;
      d[i] = lp * env * 0.5 * Math.min(1, t / 0.004);
    }
    early.forEach((et, j) => {
      const i = Math.round((et + (ch ? 0.0013 * j : 0)) * sr);
      if (i < len) d[i] += (j % 2 === ch ? 0.55 : 0.32) * Math.pow(0.82, j);
    });
  }
  return buf;
}
