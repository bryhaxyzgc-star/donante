// Cadena de postproceso (§14). Fase 1: RenderPass → N8AO → Bloom → desaturación con
// protección del rojo → viñeta → grano → ACES → (aberración cromática) → SMAA.
// Fase 3: letterbox 2,39:1 animada y flash blanco de impacto.
// Fase 5: SSFR de la sangre (después de la AO) y sangre en la lente (después de la gradación).
// Las manchas y el charco son mallas de la escena.
// Fase 6: profundidad de campo en los planos de la cinemática.
// Fluoroscopia (fluoro.ts): después de la gradación y antes de la lente.
import {
  BlendFunction, BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, RenderPass,
  SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Color, HalfFloatType, Uniform, Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { config } from '../config.ts';
import type { QualityPreset } from '../quality.ts';
import type { Blood } from './blood/blood.ts';
import { FluoroPass } from './fluoro.ts';

/** Desaturación global + tinte frío. Los píxeles rojos saturados se protegen (§14). */
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
uniform float uDesat;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uRedProtect;
uniform float uFlash;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb + vec3(uFlash * 3.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-5);
  float red = smoothstep(0.25, 0.55, sat) * smoothstep(0.0, 0.08, c.r - max(c.g, c.b) * 1.15) * uRedProtect;
  vec3 tintN = uTint / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 grey = mix(vec3(l), vec3(l) * tintN, uTintAmount);
  outputColor = vec4(mix(c, grey, uDesat * (1.0 - red)), inputColor.a);
}`,
      {
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, Uniform>([
          ['uDesat', new Uniform(0.85)],
          ['uTint', new Uniform(new Color(config.post.tint))],
          ['uTintAmount', new Uniform(0.12)],
          ['uRedProtect', new Uniform(1)],
          ['uFlash', new Uniform(0)],
        ]),
      },
    );
  }
}

/** Bandas negras de cinemascope 2,39:1 (§9.5). `uAmount` 0..1 anima la entrada. */
class LetterboxEffect extends Effect {
  constructor() {
    super(
      'LetterboxEffect',
      /* glsl */ `
uniform float uAmount;
uniform float uAspect;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float bar = max(0.0, (1.0 - uAspect / 2.39) * 0.5) * uAmount;
  float m = step(bar, uv.y) * step(uv.y, 1.0 - bar);
  outputColor = vec4(inputColor.rgb * m, inputColor.a);
}`,
      {
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, Uniform>([
          ['uAmount', new Uniform(0)],
          ['uAspect', new Uniform(16 / 9)],
        ]),
      },
    );
  }
}

/** Grano de película animado, más visible en sombras y medios tonos. */
class GrainEffect extends Effect {
  constructor() {
    super(
      'GrainEffect',
      /* glsl */ `
uniform float uIntensity;
uniform float uSize;
uniform float uSeed;
uniform vec2 uRes;
float gh(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 px = floor(uv * uRes / max(uSize, 0.5));
  float n = gh(px + uSeed * 91.7) + gh(px * 1.37 + uSeed * 37.1) - 1.0;
  float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float amt = uIntensity * (0.12 + 0.6 * smoothstep(0.0, 0.25, l) * (1.0 - smoothstep(0.6, 2.0, l)));
  outputColor = vec4(max(inputColor.rgb + n * amt * (0.02 + l * 0.6), 0.0), inputColor.a);
}`,
      {
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, Uniform>([
          ['uIntensity', new Uniform(0.08)],
          ['uSize', new Uniform(1.4)],
          ['uSeed', new Uniform(0)],
          ['uRes', new Uniform(new Vector2(1920, 1080))],
        ]),
      },
    );
  }

  update(): void {
    this.uniforms.get('uSeed')!.value = Math.random();
  }
}

export class Post {
  readonly composer: EffectComposer;
  private ao: N8AOPostPass;
  private bloom: BloomEffect;
  private grade = new GradeEffect();
  private grain = new GrainEffect();
  private vignette: VignetteEffect;
  private ca: ChromaticAberrationEffect;
  private smaaPass: EffectPass;
  private dof: DepthOfFieldEffect;
  private dofPass: EffectPass;
  /** Pulso de aberración cromática (impactos). */
  caPulse = 0;
  /** Aberración de base (0..1): solo durante la violencia. Fuera de ella sus franjas serían el único
   *  rojo que no es sangre (§1.2) y no dejarían que el borrado llegue a 0 píxeles rojos. */
  caBase = 0;
  /** Flash blanco de 1 frame en los impactos (§9.5 plano 3). */
  flash = 0;
  /** 0..1 entrada de las bandas de cinemascope. */
  letterbox = 0;
  private lbox = new LetterboxEffect();
  /** Desaturación que impone el estado (se multiplica con config). */
  stateDesat = 1;
  /** Primeros planos de la cinemática: el hueso de cerca satura, se baja exposición y bloom. */
  cinematic = false;
  /** Placa real (0..1): sin bloom ni oclusión, más grano de película. */
  plate = 0;
  /** Brillo de la escena (lo fija el estado: la espera queda medio oscura); se acerca suave. */
  dimTarget = 1;
  private dim = 1;
  /** Fluoroscopia (0..1): campo redondo, moteado y persistencia; reemplaza al grano de película. */
  fluoro = 0;
  private fluoroPass = new FluoroPass();

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, blood: Blood) {
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new N8AOPostPass(scene, camera, 1920, 1080);
    this.ao.configuration.gammaCorrection = false;
    this.composer.addPass(this.ao);
    // Sangre líquida (SSFR) antes del bloom: los brillos húmedos florecen (§14).
    this.composer.addPass(blood.pass);
    // Profundidad de campo: solo en los planos de la cinemática (§14), presets HIGH y ULTRA.
    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 1, focusRange: 0.3, bokehScale: 2.2, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.55, luminanceSmoothing: 0.25, intensity: 1.1, radius: 0.72 });
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(camera, this.bloom, this.grade, this.vignette, this.grain, tone));
    // Fluoroscopia: sobre la imagen ya gradada (todo gris salvo la sangre), antes de la lente.
    this.composer.addPass(this.fluoroPass);
    // Gotas en la lente: después de la gradación, así el rojo de la gota no se desatura.
    this.composer.addPass(blood.lensPass);
    this.ca = new ChromaticAberrationEffect({ offset: new Vector2(0.0009, 0.0009), radialModulation: true, modulationOffset: 0.25 });
    this.composer.addPass(new EffectPass(camera, this.ca, this.lbox));
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.composer.addPass(this.smaaPass);
  }

  applyQuality(q: QualityPreset): void {
    this.ao.enabled = q.ao;
    this.ao.configuration.halfRes = q.aoHalfRes;
    this.ao.configuration.aoSamples = q.aoSamples;
    this.ao.configuration.denoiseSamples = q.denoiseSamples;
    this.smaaPass.enabled = q.smaa;
    this.bloom.mipmapBlurPass.levels = q.bloomLevels;
    // postprocessing marca renderToScreen en el último pase AÑADIDO; si ese pase se
    // desactiva (SMAA en LOW) nada llega a la pantalla. Se reasigna al último activo.
    const passes = this.composer.passes;
    const last = passes.reduce((acc, p, i) => (p.enabled ? i : acc), 0);
    passes.forEach((p, i) => (p.renderToScreen = i === last));
  }

  /** Foco de la profundidad de campo (m, desde la cámara). */
  setDof(on: boolean, focus: number, range: number): void {
    this.dofPass.enabled = on;
    if (!on) return;
    const c = this.dof.cocMaterial;
    c.focusDistance = focus;
    c.focusRange = range * config.cinematic.focusRangeScale;
    this.dof.bokehScale = config.cinematic.bokeh;
  }

  /** Tamaño lógico (CSS) y tamaño real del buffer (para el grano por píxel). */
  setSize(w: number, h: number, bufW: number, bufH: number): void {
    this.composer.setSize(w, h, false);
    this.lbox.uniforms.get('uAspect')!.value = w / Math.max(1, h);
    this.grain.uniforms.get('uRes')!.value.set(bufW, bufH);
  }

  /** Copia config → uniforms (barato, una vez por frame). */
  sync(renderer: WebGLRenderer, dt: number): void {
    const p = config.post;
    const C = config.cinematic;
    this.dim += (this.dimTarget - this.dim) * (1 - Math.exp(-2.5 * dt));
    renderer.toneMappingExposure = p.exposure * (this.cinematic ? C.exposure : 1) * this.dim;
    const pl = this.plate;
    const fl = this.fluoro;
    const fp = this.fluoroPass;
    if (fl > 0 && !fp.enabled) fp.reset();
    fp.enabled = fl > 0;
    fp.amount = fl;
    this.bloom.intensity =
      p.bloomIntensity * (this.cinematic ? C.bloom : 1) * (1 - pl + pl * config.plate.bloom) * (1 - fl + fl * config.fluoro.bloom);
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    this.bloom.luminanceMaterial.smoothing = p.bloomSmoothing;
    this.bloom.mipmapBlurPass.radius = p.bloomRadius;
    const ao = this.ao.configuration;
    ao.aoRadius = p.aoRadius;
    ao.distanceFalloff = p.aoDistanceFalloff;
    ao.intensity = p.aoIntensity * (1 - pl);
    const g = this.grade.uniforms;
    g.get('uDesat')!.value = Math.min(1, p.desaturation * this.stateDesat);
    (g.get('uTint')!.value as Color).set(p.tint);
    g.get('uTintAmount')!.value = p.tintAmount;
    g.get('uFlash')!.value = this.flash;
    this.flash = Math.max(0, this.flash - dt * 30);
    this.lbox.uniforms.get('uAmount')!.value = this.letterbox;
    // En fluoroscopia el grano de película se va: lo reemplaza el moteado cuántico del intensificador.
    this.grain.uniforms.get('uIntensity')!.value = p.grainIntensity * (1 - pl + pl * config.plate.grain) * (1 - fl);
    this.grain.uniforms.get('uSize')!.value = p.grainSize;
    this.vignette.offset = p.vignetteOffset;
    this.vignette.darkness = p.vignetteDarkness;
    this.caPulse = Math.max(0, this.caPulse - dt * 4);
    const off = p.chromaticAberration * (this.caBase + this.caPulse * 8);
    this.ca.offset.set(off, off);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
