// Worker de MediaPipe PoseLandmarker. Corre la inferencia fuera del hilo principal
// para que el render no pierda FPS (§15). Todo se carga desde public/ (offline).
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { LM_STRIDE, NUM_LM, type FromWorker, type ToWorker } from './poseTypes.ts';
import { installOfflineGuard } from '../offline.ts';

installOfflineGuard();

let landmarker: PoseLandmarker | null = null;
let lastTs = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

async function create(msg: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  landmarker?.close();
  landmarker = null;
  // useModule=true: en un worker de módulo se carga vision_wasm_module_internal.js con import().
  const fileset = await FilesetResolver.forVisionTasks(msg.wasmBase, true);
  const base = {
    runningMode: 'VIDEO' as const,
    numPoses: msg.numPoses,
    minPoseDetectionConfidence: msg.minDetection,
    minPosePresenceConfidence: msg.minPresence,
    minTrackingConfidence: msg.minTracking,
    outputSegmentationMasks: true,
  };
  const order: ('GPU' | 'CPU')[] = msg.delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU'];
  for (const delegate of order) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        ...base,
        // Copia del buffer: si falla el GPU, el CPU necesita los bytes intactos.
        baseOptions: { modelAssetBuffer: new Uint8Array(msg.model.slice(0)), delegate },
      });
      // Calentamiento: la primera inferencia compila shaders (~2 s). Mejor durante CARGANDO.
      const warm = new OffscreenCanvas(msg.warmWidth, msg.warmHeight);
      warm.getContext('2d')?.fillRect(0, 0, msg.warmWidth, msg.warmHeight);
      lastTs = Math.max(lastTs + 1, Math.round(performance.now()));
      landmarker.detectForVideo(warm, lastTs, () => {});
      post({ type: 'ready', delegate, modelName: msg.modelName });
      return;
    } catch (err) {
      console.warn(`[pose.worker] delegate ${delegate} falló`, err);
    }
  }
  throw new Error('No se pudo crear PoseLandmarker ni en GPU ni en CPU');
}

function pack(result: PoseLandmarkerResult, ts: number, w: number, h: number, wantMask: boolean, t0: number) {
  const count = result.landmarks.length;
  const lm2d = new Float32Array(count * NUM_LM * LM_STRIDE);
  const lm3d = new Float32Array(count * NUM_LM * LM_STRIDE);
  for (let p = 0; p < count; p++) {
    const l2 = result.landmarks[p];
    const l3 = result.worldLandmarks[p];
    for (let i = 0; i < NUM_LM; i++) {
      const o = (p * NUM_LM + i) * LM_STRIDE;
      lm2d[o] = l2[i].x; lm2d[o + 1] = l2[i].y; lm2d[o + 2] = l2[i].z; lm2d[o + 3] = l2[i].visibility ?? 0;
      lm3d[o] = l3[i].x; lm3d[o + 1] = l3[i].y; lm3d[o + 2] = l3[i].z; lm3d[o + 3] = l3[i].visibility ?? 0;
    }
  }
  let mask: Uint8Array | null = null;
  let maskW = 0;
  let maskH = 0;
  const maskAreas = new Float32Array(count);
  const masks = result.segmentationMasks;
  if (masks && masks.length) {
    maskW = masks[0].width;
    maskH = masks[0].height;
    const n = maskW * maskH;
    if (wantMask) mask = new Uint8Array(n);
    for (let p = 0; p < masks.length && p < count; p++) {
      const f = masks[p].getAsFloat32Array();
      let area = 0;
      for (let i = 0; i < n; i++) {
        const v = f[i];
        if (v > 0.5) area++;
        if (mask) {
          const b = v * 255;
          if (b > mask[i]) mask[i] = b;
        }
      }
      maskAreas[p] = area / n;
    }
  }
  return {
    type: 'result' as const, ts, count, lm2d, lm3d, mask, maskW, maskH, maskAreas,
    imageW: w, imageH: h, inferMs: performance.now() - t0,
  };
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      await create(msg);
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'frame') {
    const { bitmap, wantMask } = msg;
    if (!landmarker) {
      bitmap.close();
      post({ type: 'skip' });
      return;
    }
    // VIDEO exige timestamps estrictamente crecientes.
    const ts = Math.max(Math.round(msg.ts), lastTs + 1);
    lastTs = ts;
    const t0 = performance.now();
    let out: ReturnType<typeof pack> | null = null;
    try {
      // Versión con callback: las máscaras solo viven dentro del callback (sin copias extra).
      landmarker.detectForVideo(bitmap, ts, (result) => {
        out = pack(result, ts, bitmap.width, bitmap.height, wantMask, t0);
      });
    } catch (err) {
      console.warn('[pose.worker] detectForVideo', err);
    }
    bitmap.close();
    const res = out as ReturnType<typeof pack> | null;
    if (!res) {
      post({ type: 'skip' });
      return;
    }
    const transfer: Transferable[] = [res.lm2d.buffer, res.lm3d.buffer, res.maskAreas.buffer];
    if (res.mask) transfer.push(res.mask.buffer);
    post(res, transfer);
  }
};
