// Tipos mínimos para n8ao (el paquete no trae .d.ts).
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    halfRes: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
  }
}
