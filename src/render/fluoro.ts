// Fluoroscopia (§6): una radiografía que se mueve en tiempo real no es una placa, es fluoroscopia. Se
// reconoce por cosas que cualquiera vio en un hospital, y este pase las imita:
//  · adquisición (lo que "ve" el detector, guardado como historia):
//    - distorsión en cojín del intensificador de imagen (los bordes se ven ampliados);
//    - realce de bordes del procesado digital (un halo fino en los contornos);
//    - velo: la luz dispersa dentro del intensificador, los negros del campo quedan gris oscuro;
//    - moteado cuántico: ruido monocromo que hierve, proporcional a √señal (poca dosis);
//    - persistencia (filtro recursivo): lo que se mueve deja estela, y el ruido se promedia;
//    - fluoroscopia pulsada opcional: la imagen se renueva a N p/s y se sostiene entre pulsos.
//  · presentación: campo redondo del intensificador (iris), caída de brillo hacia el borde y las
//    líneas de la rejilla antidispersión.
// Todo es gris: no agrega color, así que el rojo sigue siendo solo de la sangre (§1.2). En los primeros
// planos de la cinemática (`amount` → 0) el pase deja pasar la imagen sin tocarla.
import { Pass } from 'postprocessing';
import {
  HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, Vector2,
  WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { config } from '../config.ts';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const ACQUIRE_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tHistory;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uAmount;
uniform float uDistort;
uniform float uSharpen;
uniform float uRadius;
uniform float uVeil;
uniform float uNoise;
uniform float uNoiseSize;
uniform float uSeed;
uniform float uKeep;
varying vec2 vUv;
float fh(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  // Cojín: se muestrea más cerca del centro a medida que se aleja de él (el borde se ve ampliado).
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(p, p);
  vec2 uv = 0.5 + p * (1.0 - uDistort * uAmount * r2) / vec2(uAspect, 1.0);
  vec3 c = texture2D(tInput, uv).rgb;
  // Realce de bordes (máscara de desenfoque de 4 muestras).
  vec2 o = uTexel * uRadius;
  vec3 b = 0.25 * (texture2D(tInput, uv + vec2(o.x, 0.0)).rgb + texture2D(tInput, uv - vec2(o.x, 0.0)).rgb
                 + texture2D(tInput, uv + vec2(0.0, o.y)).rgb + texture2D(tInput, uv - vec2(0.0, o.y)).rgb);
  vec3 s = max(c + (c - b) * uSharpen * uAmount, 0.0);
  // Velo del intensificador.
  s += vec3(uVeil * uAmount);
  // Moteado cuántico: tres hashes sumados dan una campana; amplitud ∝ √señal.
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  vec2 px = floor(gl_FragCoord.xy / max(uNoiseSize, 0.5));
  float n = fh(px + uSeed * 113.1) + fh(px * 1.31 + uSeed * 57.7) + fh(px * 0.77 + uSeed * 21.3) - 1.5;
  s = max(s + vec3(n * uNoise * uAmount * sqrt(l + 0.015)), 0.0);
  // Persistencia: mezcla con la imagen anterior (en el mismo píxel).
  vec3 h = texture2D(tHistory, vUv).rgb;
  gl_FragColor = vec4(mix(s, h, uKeep), 1.0);
}`;

const DISPLAY_FRAG = /* glsl */ `
uniform sampler2D tFrame;
uniform float uAspect;
uniform float uAmount;
uniform float uIris;
uniform float uIrisSoft;
uniform float uFalloff;
uniform float uGrid;
uniform float uGridPeriod;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tFrame, vUv).rgb;
  // Coordenadas en medias alturas: y en [-1, 1], x en [-aspecto, aspecto].
  vec2 p = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0);
  float d = length(p);
  float iris = 1.0 - smoothstep(uIris - uIrisSoft, uIris + uIrisSoft, d);
  float fall = 1.0 - uFalloff * pow(clamp(d / uIris, 0.0, 1.0), 2.5);
  float grid = 1.0 - uGrid * (0.5 + 0.5 * cos(gl_FragCoord.x * 6.2831853 / max(uGridPeriod, 1.0)));
  gl_FragColor = vec4(c * mix(1.0, iris * fall * grid, uAmount), 1.0);
}`;

export class FluoroPass extends Pass {
  /** 0..1: cuánto de fluoroscopia (0 en los primeros planos de la cinemática). */
  amount = 1;
  private targets: [WebGLRenderTarget, WebGLRenderTarget];
  private current = 0;
  private hasHistory = false;
  private sincePulse = 0;
  private w = 1;
  private h = 1;
  private quadScene = new Scene();
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private acquire: ShaderMaterial;
  private display: ShaderMaterial;

  constructor() {
    super('FluoroPass');
    const opts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.targets = [new WebGLRenderTarget(1, 1, opts), new WebGLRenderTarget(1, 1, opts)];
    this.acquire = new ShaderMaterial({
      uniforms: {
        tInput: { value: null }, tHistory: { value: null }, uTexel: { value: new Vector2() }, uAspect: { value: 16 / 9 },
        uAmount: { value: 1 }, uDistort: { value: 0 }, uSharpen: { value: 0 }, uRadius: { value: 2 }, uVeil: { value: 0 },
        uNoise: { value: 0 }, uNoiseSize: { value: 1.5 }, uSeed: { value: 0 }, uKeep: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: ACQUIRE_FRAG, depthTest: false, depthWrite: false,
    });
    this.display = new ShaderMaterial({
      uniforms: {
        tFrame: { value: null }, uAspect: { value: 16 / 9 }, uAmount: { value: 1 }, uIris: { value: 1.7 },
        uIrisSoft: { value: 0.012 }, uFalloff: { value: 0.28 }, uGrid: { value: 0.03 }, uGridPeriod: { value: 3 },
      },
      vertexShader: VERT, fragmentShader: DISPLAY_FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.acquire);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Olvida la imagen anterior (al volver a activarse o al cambiar de tamaño: sin estelas viejas). */
  reset(): void {
    this.hasHistory = false;
  }

  override setSize(width: number, height: number): void {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    for (const t of this.targets) t.setSize(this.w, this.h);
    this.hasHistory = false;
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget, deltaTime?: number): void {
    const F = config.fluoro;
    const amt = Math.max(0, Math.min(1, this.amount));
    const dt = Math.max(1e-4, deltaTime ?? 1 / 60);
    const aspect = this.w / this.h;
    this.sincePulse += dt;

    // Pulsada: entre pulsos se sostiene la última imagen (solo con la fluoroscopia completa).
    const pulsed = F.pulseFps > 0 && amt > 0.999 && this.hasHistory;
    const acquireNow = !pulsed || this.sincePulse >= 1 / F.pulseFps;
    if (acquireNow) {
      const a = this.acquire.uniforms;
      const read = this.targets[this.current];
      const write = this.targets[1 - this.current];
      a.tInput.value = inputBuffer.texture;
      a.tHistory.value = read.texture;
      (a.uTexel.value as Vector2).set(1 / this.w, 1 / this.h);
      a.uAspect.value = aspect;
      a.uAmount.value = amt;
      a.uDistort.value = F.distortion;
      a.uSharpen.value = F.sharpen;
      a.uRadius.value = F.sharpenRadius;
      a.uVeil.value = F.veil;
      a.uNoise.value = F.noise;
      a.uNoiseSize.value = F.noiseSize;
      a.uSeed.value = Math.random();
      // Persistencia independiente de los FPS: lo que queda de la imagen anterior tras `sincePulse` s.
      a.uKeep.value = this.hasHistory && F.lag > 0 ? Math.exp(-this.sincePulse / F.lag) * amt : 0;
      this.quad.material = this.acquire;
      renderer.setRenderTarget(write);
      renderer.render(this.quadScene, this.quadCam);
      this.current = 1 - this.current;
      this.hasHistory = true;
      this.sincePulse = 0;
    }

    const d = this.display.uniforms;
    d.tFrame.value = this.targets[this.current].texture;
    d.uAspect.value = aspect;
    d.uAmount.value = amt;
    d.uIris.value = F.irisRadius;
    d.uIrisSoft.value = F.irisSoft;
    d.uFalloff.value = F.falloff;
    d.uGrid.value = F.grid;
    d.uGridPeriod.value = F.gridPeriod;
    this.quad.material = this.display;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.quadScene, this.quadCam);
  }

  override dispose(): void {
    for (const t of this.targets) t.dispose();
    this.acquire.dispose();
    this.display.dispose();
    super.dispose();
  }
}
