// Tipos compartidos entre el hilo principal y el worker de MediaPipe.

/** Índices de los 33 landmarks de MediaPipe Pose. */
export const LM = {
  NOSE: 0, L_EYE_IN: 1, L_EYE: 2, L_EYE_OUT: 3, R_EYE_IN: 4, R_EYE: 5, R_EYE_OUT: 6,
  L_EAR: 7, R_EAR: 8, MOUTH_L: 9, MOUTH_R: 10,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18, L_INDEX: 19, R_INDEX: 20, L_THUMB: 21, R_THUMB: 22,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
} as const;

export const NUM_LM = 33;
/** x, y, z, visibilidad. */
export const LM_STRIDE = 4;

/** Conexiones para dibujar el esqueleto de landmarks en modo debug. */
export const LM_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [0, 2], [0, 5], [2, 7], [5, 8], [9, 10],
];

/** Un frame de resultados de pose (de MediaPipe o del simulador). */
export interface PoseFrame {
  /** Timestamp en ms (reloj de performance.now). */
  ts: number;
  count: number;
  /** count × 33 × 4: coordenadas normalizadas de imagen (0..1, y hacia abajo) + visibilidad. */
  lm2d: Float32Array;
  /** count × 33 × 4: metros, origen en el centro de caderas, ejes de la imagen + visibilidad. */
  lm3d: Float32Array;
  /** Máscara combinada (máximo de todas las personas), 0..255, filas de arriba a abajo. */
  mask: Uint8Array | null;
  maskW: number;
  maskH: number;
  /** Área de máscara por persona (fracción de la imagen). */
  maskAreas: Float32Array;
  /** Tamaño del frame analizado. */
  imageW: number;
  imageH: number;
  inferMs: number;
}

export type ToWorker =
  | {
      type: 'init';
      wasmBase: string;
      model: ArrayBuffer;
      modelName: string;
      numPoses: number;
      minDetection: number;
      minPresence: number;
      minTracking: number;
      warmWidth: number;
      warmHeight: number;
      /** Preferencia: 'GPU' (con respaldo en CPU) o 'CPU' (no compite con el render por la GPU). */
      delegate: 'GPU' | 'CPU';
    }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number; wantMask: boolean };

export type FromWorker =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; modelName: string }
  | { type: 'error'; message: string }
  | { type: 'skip' }
  | ({ type: 'result' } & PoseFrame);
