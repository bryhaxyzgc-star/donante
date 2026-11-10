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

  /** Envía un frame si el worker está libre. `ts` en ms de performance.now(). */
  async submit(video: HTMLVideoElement, ts: number): Promise<void> {
    if (!this.ready || this.busy || !this.worker || !video.videoWidth) return;
    this.busy = true;
    try {
      const w = Math.min(config.pose.inputWidth, video.videoWidth);
      const h = Math.round((w * video.videoHeight) / video.videoWidth);
      const bitmap = await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
      const wantMask = this.frameCounter++ % Math.max(1, config.pose.maskEvery) === 0;
      const msg: ToWorker = { type: 'frame', bitmap, ts, wantMask };
      this.worker.postMessage(msg, [bitmap]);
    } catch (err) {
      this.busy = false;
      console.warn('[pose] no se pudo enviar el frame', err);
    }
  }
}
