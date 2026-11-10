// Cliente del worker de pose: manda frames de la webcam reducidos a ~640 px y
// recibe landmarks + máscara. Si el worker está ocupado, el frame se descarta.
import { config } from '../config.ts';
import type { FromWorker, PoseFrame, ToWorker } from './poseTypes.ts';

export type ModelName = 'full' | 'heavy';

const MODEL_URL: Record<ModelName, string> = {
  full: '/mediapipe/models/pose_landmarker_full.task',
  heavy: '/mediapipe/models/pose_landmarker_heavy.task',
};

/** Descarga (local) un archivo informando el progreso para la pantalla CARGANDO. */
export async function fetchWithProgress(url: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`No se pudo cargar ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  onProgress(1);
  return out.buffer;
}

export class PoseEngine {
  private worker: Worker | null = null;
  private busy = false;
  private frameCounter = 0;
  ready = false;
  delegate: 'GPU' | 'CPU' | '—' = '—';
  model: ModelName | null = null;
  /** Último tiempo de inferencia (ms) y frecuencia de resultados (Hz). */
  inferMs = 0;
  rate = 0;
  private lastResultAt = 0;
  onResult: (f: PoseFrame) => void = () => {};

  /** Crea un worker nuevo con el modelo pedido y lo intercambia recién cuando está listo:
   *  cambiar de preset (Q) no corta el tracking. MediaPipe no admite reinicializarse
   *  dentro del mismo worker, por eso cada modelo vive en un worker propio. */
  async init(model: ModelName, onProgress: (f: number) => void = () => {}): Promise<void> {
    const w = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
    try {
      const buf = await fetchWithProgress(MODEL_URL[model], onProgress);
      const ready = await new Promise<Extract<FromWorker, { type: 'ready' }>>((resolve, reject) => {
        w.onmessage = (ev: MessageEvent<FromWorker>) => {
          if (ev.data.type === 'ready') resolve(ev.data);
          else if (ev.data.type === 'error') reject(new Error(ev.data.message));
        };
        w.onerror = (e) => reject(new Error(e.message || 'error al cargar el worker de pose'));
        const msg: ToWorker = {
          type: 'init',
          wasmBase: new URL('/mediapipe/wasm', location.origin).href,
          model: buf,
          modelName: model,
          numPoses: config.tracking.maxPeople,
          minDetection: config.pose.minDetection,
          minPresence: config.pose.minPresence,
          minTracking: config.pose.minTracking,
          warmWidth: config.pose.inputWidth,
          warmHeight: Math.round((config.pose.inputWidth * 9) / 16),
          delegate: config.pose.delegate,
        };
        w.postMessage(msg, [buf]);
      });
      this.worker?.terminate();
      this.worker = w;
      w.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
      this.ready = true;
      this.busy = false;
      this.delegate = ready.delegate;
      this.model = model;
      console.info(`[pose] listo: modelo ${model}, delegate ${ready.delegate}`);
    } catch (err) {
      w.terminate();
      throw err;
    }
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        break;
      case 'error':
        this.busy = false;
        console.error('[pose] error en worker:', msg.message);
        break;
      case 'skip':
        this.busy = false;
        break;
      case 'result': {
        this.busy = false;
        this.inferMs = msg.inferMs;
        const now = performance.now();
        if (this.lastResultAt) {
          const inst = 1000 / Math.max(1, now - this.lastResultAt);
          this.rate += (inst - this.rate) * 0.1;
        }
        this.lastResultAt = now;
        this.onResult(msg);
        break;
      }
    }
  }

  /** Curva para levantar sombras (1 = sin cambios; < 1 aclara lo oscuro) e imagen corregida que ve MediaPipe. */
  gamma = 1;
  private lut = new Uint8Array(256);
  private lutGamma = -1;
  private prep: OffscreenCanvas | null = null;
  private prepCtx: OffscreenCanvasRenderingContext2D | null = null;
  private probe: OffscreenCanvas | null = null;
  private probeCtx: OffscreenCanvasRenderingContext2D | null = null;
  private lastProbe = 0;
  private lums = new Float32Array(64 * 36);

  /** Levantar sombras (§7). En la sala el fondo es BLANCO: la webcam se cierra para no quemarlo y las
   *  personas quedan oscuras, a contraluz; MediaPipe busca primero la cara y con la cara oscura no encuentra
   *  a nadie. Cada ~0,4 s se mira solo lo que NO es fondo (lo más oscuro que `backgroundLuma`) y se elige una
   *  curva gamma que lleva su brillo medio a `shadowTarget`: el blanco queda blanco y los cuerpos se aclaran.
   *  Con la sala entera oscura hace lo mismo con toda la imagen. Solo la ve el detector, no el público. */
  private updateGamma(video: HTMLVideoElement, ts: number): void {
    const P = config.pose;
    if (!P.autoGain) {
      this.gamma = 1;
      return;
    }
    if (ts - this.lastProbe < 400) return;
    this.lastProbe = ts;
    if (!this.probe) {
      this.probe = new OffscreenCanvas(64, 36);
      this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
    }
    const c = this.probeCtx;
    if (!c) return;
    c.drawImage(video, 0, 0, 64, 36);
    const d = c.getImageData(0, 0, 64, 36).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      if (l < P.backgroundLuma) this.lums[n++] = l;
    }
    let want = 1;
    // Al menos un 3 % de la imagen que no es fondo: hay alguien (o la sala está oscura).
    if (n > 0.03 * (d.length / 4)) {
      const part = this.lums.subarray(0, n).sort();
      const median = Math.max(0.02, part[n >> 1]);
      if (median < P.shadowTarget) want = Math.min(1, Math.max(P.gammaMin, Math.log(P.shadowTarget) / Math.log(median)));
    }
    this.gamma += (want - this.gamma) * 0.35;
  }

  /** Envía un frame si el worker está libre. `ts` en ms de performance.now(). */
  async submit(video: HTMLVideoElement, ts: number): Promise<void> {
    if (!this.ready || this.busy || !this.worker || !video.videoWidth) return;
    this.busy = true;
    try {
      const w = Math.min(config.pose.inputWidth, video.videoWidth);
      const h = Math.round((w * video.videoHeight) / video.videoWidth);
      this.updateGamma(video, ts);
      let source: HTMLVideoElement | OffscreenCanvas = video;
      if (this.gamma < 0.97) {
        if (!this.prep || this.prep.width !== w || this.prep.height !== h) {
          this.prep = new OffscreenCanvas(w, h);
          this.prepCtx = this.prep.getContext('2d', { willReadFrequently: true });
        }
        const ctx = this.prepCtx;
        if (ctx) {
          if (Math.abs(this.gamma - this.lutGamma) > 0.01) {
            this.lutGamma = this.gamma;
            for (let i = 0; i < 256; i++) this.lut[i] = Math.round(255 * Math.pow(i / 255, this.gamma));
          }
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const px = img.data;
          const lut = this.lut;
          for (let i = 0; i < px.length; i += 4) {
            px[i] = lut[px[i]];
            px[i + 1] = lut[px[i + 1]];
            px[i + 2] = lut[px[i + 2]];
          }
          ctx.putImageData(img, 0, 0);
          source = this.prep;
        }
      }
      const bitmap = source === video
        ? await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
        : await createImageBitmap(source);
      const wantMask = this.frameCounter++ % Math.max(1, config.pose.maskEvery) === 0;
      const msg: ToWorker = { type: 'frame', bitmap, ts, wantMask };
      this.worker.postMessage(msg, [bitmap]);
    } catch (err) {
      this.busy = false;
      console.warn('[pose] no se pudo enviar el frame', err);
    }
  }
}
