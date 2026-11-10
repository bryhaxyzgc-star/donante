// Presets de calidad (§15). La tecla Q los rota; la elección se guarda.
import { loadString, saveString } from './persist.ts';

export type PresetName = 'LOW' | 'MED' | 'HIGH' | 'ULTRA';
export const PRESET_ORDER: PresetName[] = ['LOW', 'MED', 'HIGH', 'ULTRA'];

export interface QualityPreset {
  name: PresetName;
  poseModel: 'full' | 'heavy';
  /** Multiplicador sobre devicePixelRatio. */
  renderScale: number;
  /** Tope de cuadros por segundo del render (0 = sin tope). Con GPU integrada, MediaPipe comparte la GPU:
   *  dibujar a 30 le deja tiempo para seguir a las personas (si no, el receptor se congela). */
  maxFps: number;
  ao: boolean;
  aoHalfRes: boolean;
  aoSamples: number;
  denoiseSamples: number;
  smaa: boolean;
  bloomLevels: number;
  // Fases siguientes (sangre, cinemática): se dejan declarados para no cambiar la forma.
  particles: number;
  ssfr: 'half' | 'full';
  ssfrRefraction: boolean;
  dof: boolean;
  cinematic: 'realtime-simple' | 'realtime' | 'video';
}

export const PRESETS: Record<PresetName, QualityPreset> = {
  LOW: {
    name: 'LOW', poseModel: 'full', renderScale: 0.6, maxFps: 30, ao: false, aoHalfRes: true, aoSamples: 8,
    denoiseSamples: 4, smaa: false, bloomLevels: 5, particles: 4096, ssfr: 'half', ssfrRefraction: false,
    dof: false, cinematic: 'realtime-simple',
  },
  MED: {
    name: 'MED', poseModel: 'full', renderScale: 0.85, maxFps: 0, ao: true, aoHalfRes: true, aoSamples: 12,
    denoiseSamples: 6, smaa: true, bloomLevels: 6, particles: 8192, ssfr: 'half', ssfrRefraction: true,
    dof: false, cinematic: 'realtime',
  },
  HIGH: {
    name: 'HIGH', poseModel: 'heavy', renderScale: 1, maxFps: 0, ao: true, aoHalfRes: false, aoSamples: 16,
    denoiseSamples: 8, smaa: true, bloomLevels: 8, particles: 16384, ssfr: 'full', ssfrRefraction: true,
    dof: true, cinematic: 'realtime',
  },
  ULTRA: {
    name: 'ULTRA', poseModel: 'heavy', renderScale: 1, maxFps: 0, ao: true, aoHalfRes: false, aoSamples: 24,
    denoiseSamples: 12, smaa: true, bloomLevels: 9, particles: 32768, ssfr: 'full', ssfrRefraction: true,
    dof: true, cinematic: 'video',
  },
};

const KEY = 'donante.preset';

/** Nombre del renderer WebGL (para el HUD y para detectar GPU integrada). */
export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'sin WebGL2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return 'desconocida';
  }
}

/** Heurística: Intel / Radeon integrada / SwiftShader / GPU de tablet → solo LOW (§2). */
export function isIntegratedGPU(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx')) return false;
  if (/radeon\s*(rx|pro)/.test(n)) return false;
  // También las GPU de tablets y celulares (Adreno, Mali, PowerVR, Apple): siempre LOW.
  return /intel|uhd|iris|swiftshader|llvmpipe|radeon\(tm\) graphics|radeon graphics|apple m|apple gpu|adreno|mali|powervr|xclipse|immortalis/.test(n);
}

export function initialPreset(gpu: string): PresetName {
  const saved = loadString(KEY) as PresetName | null;
  if (saved && saved in PRESETS) return saved;
  return isIntegratedGPU(gpu) ? 'LOW' : 'HIGH';
}

export function savePreset(name: PresetName): void {
  saveString(KEY, name);
}

export function nextPreset(name: PresetName): PresetName {
  return PRESET_ORDER[(PRESET_ORDER.indexOf(name) + 1) % PRESET_ORDER.length];
}
