// Sangre en la lente (§10.4): gotas que golpean "la cámara" en los planos 4, 6 y 7. Cada gota es una
// salpicadura, no un disco: cuerpo con lóbulos, puntas finas y gotitas satélite, con el borde fuera de
// foco (está pegada a la lente). Refracta la imagen de atrás, la filtra como sangre (más oscura donde es
// gruesa y en el menisco), tiene un brillo ancho en media luna y escurre hacia abajo dejando estela.
// Opacidad 0,9 en el centro. Es un efecto de postprocessing con muestreo desplazado (CONVOLUTION): va
// en su propio pase.
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector3, Vector4 } from 'three';
import { config } from '../../config.ts';
import { rng } from '../../random.ts';
import { ERASE_GLSL, type EraseUniforms } from '../erase.ts';

export const MAX_DROPS = 8;
/** Gotitas satélite por impacto. */
const SATELLITES = 4;

const FRAG = /* glsl */ `
uniform vec4 uDrops[${MAX_DROPS}];   // x, y (uv), radio (alto de pantalla), opacidad
uniform vec4 uTrail[${MAX_DROPS}];   // y donde empezó la estela, semilla, ancho relativo, -
uniform float uAspect;
uniform vec3 uTint;
uniform float uSoft;
uniform float uSpec;
${ERASE_GLSL}

float lb_h(float n) { return fract(sin(n * 91.345) * 47453.21); }

// Silueta de la salpicadura: lóbulos irregulares y unas pocas puntas finas hacia afuera.
float lb_radius(float ang, float r, float s) {
  float lob = 0.16 * sin(ang * 3.0 + s) + 0.09 * sin(ang * 5.0 + s * 2.3) + 0.05 * sin(ang * 9.0 + s * 4.1);
  float sp = 0.0;
  for (int k = 0; k < 3; k++) {
    float a0 = lb_h(s + float(k) * 1.7) * 6.2831;
    sp += pow(max(cos(ang - a0), 0.0), 24.0) * (0.08 + 0.2 * lb_h(s + float(k) * 3.1));
  }
  return r * (1.0 + lob + sp);
}

// Una mancha (cuerpo o satélite): suma refracción, cobertura, grosor, menisco y brillo.
void lb_blob(vec2 q, float rr, float soft, float w, float sw,
             inout vec2 off, inout float a, inout float thick, inout float rim, inout float spec) {
  float dist = length(q);
  float m = (1.0 - smoothstep(rr - soft, rr + soft * 0.5, dist)) * w;
  if (m <= 0.0) return;
  float x = clamp(dist / max(rr, 1e-4), 0.0, 1.0);
  float h = sqrt(max(0.0, 1.0 - x * x));
  vec2 g = q / max(rr, 1e-4);
  off -= g * h * 0.05 * m;
  a = max(a, m);
  thick = max(thick, (0.35 + 0.65 * h) * m);
  rim = max(rim, smoothstep(0.55, 0.95, x) * m);
  // El domo refleja una luz cenital difusa: media luna en el borde que mira a la luz.
  vec3 n = normalize(vec3(g * 1.6, 1.0));
  spec = max(spec, pow(max(dot(n, vec3(-0.36, 0.56, 0.75)), 0.0), 14.0) * smoothstep(0.45, 0.92, x) * m * sw);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 off = vec2(0.0);
  float a = 0.0;
  float thick = 0.0;
  float rim = 0.0;
  float spec = 0.0;
  float trail = 0.0;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec4 d = uDrops[i];
    if (d.w <= 0.0) continue;
    float s = uTrail[i].y * 6.2831;
    vec2 p = (uv - d.xy) * vec2(uAspect, 1.0);
    // Cuelga: más larga hacia abajo, donde se junta para escurrir.
    vec2 q = vec2(p.x, p.y * (p.y < 0.0 ? 0.78 : 1.08));
    float rr = lb_radius(atan(q.y, q.x), d.z, s);
    float soft = d.z * uSoft;
    lb_blob(q, rr, soft, d.w, 1.0, off, a, thick, rim, spec);
    // Gotitas satélite alrededor del impacto (también fuera de foco).
    for (int k = 0; k < ${SATELLITES}; k++) {
      float fk = float(k);
      float ang = lb_h(s * 3.0 + fk * 2.13) * 6.2831;
      vec2 c = vec2(cos(ang), sin(ang)) * d.z * (1.5 + 1.4 * lb_h(s + fk * 5.7));
      float sr = d.z * (0.08 + 0.17 * lb_h(s + fk * 8.3));
      lb_blob(p - c, sr, soft * 0.5, d.w, 0.25, off, a, thick, rim, spec);
    }
    // Estela: desde donde pegó hasta la gota, cada vez más fina hacia arriba.
    float top = uTrail[i].x - d.y;
    float ty = (uv.y - d.y) / max(top, 1e-4);
    if (top > 0.0 && ty > 0.0 && ty < 1.0) {
      float w = d.z * uTrail[i].z * (1.0 - ty * 0.7) / uAspect;
      float tx = abs(uv.x - d.x + sin(ty * 9.0 + s) * 0.002);
      trail = max(trail, (1.0 - smoothstep(w * 0.5, w, tx)) * (1.0 - ty) * d.w * 0.6);
    }
  }
  // Borrado: el trapeador también pasa por la lente.
  float clr = 1.0 - er_clear(uv);
  a *= clr;
  trail *= clr;
  if (a <= 0.0 && trail <= 0.0) { outputColor = inputColor; return; }
  vec3 bg = texture2D(inputBuffer, uv + off).rgb;
  // Absorción (Beer-Lambert): uTint es la transmisión de una capa fina; gruesa o en el menisco, casi negra.
  vec3 sigma = -log(max(uTint, vec3(1e-3)));
  vec3 drop = bg * exp(-sigma * (0.6 + 1.6 * thick + 1.2 * rim)) + uTint * 0.035 * (1.0 - 0.6 * rim);
  drop += mix(vec3(0.5, 0.08, 0.08), vec3(1.0, 0.85, 0.82), spec) * spec * uSpec * clr;
  vec3 smear = inputColor.rgb * exp(-sigma * 0.5);
  vec3 c = mix(inputColor.rgb, er_desat(smear), trail);
  outputColor = vec4(mix(c, er_desat(drop), a * 0.9), inputColor.a);
}
`;

class LensBloodEffect extends Effect {
  constructor(erase: EraseUniforms) {
    super('LensBloodEffect', FRAG, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uDrops', new Uniform(Array.from({ length: MAX_DROPS }, () => new Vector4()))],
        ['uTrail', new Uniform(Array.from({ length: MAX_DROPS }, () => new Vector4()))],
        ['uAspect', new Uniform(16 / 9)],
        ['uTint', new Uniform(new Vector3(0.6, 0.02, 0.03))],
        ['uSoft', new Uniform(0.14)],
        ['uSpec', new Uniform(0.4)],
        ...Object.entries(erase).map(([k, u]) => [k, u as unknown as Uniform] as [string, Uniform]),
      ]),
    });
  }
}

interface Drop {
  x: number;
  y: number;
  y0: number;
  r: number;
  age: number;
  life: number;
  /** Tiempo pegada antes de empezar a escurrir. */
  hold: number;
  speed: number;
  seed: number;
  width: number;
}

export class LensBlood {
  readonly effect: LensBloodEffect;
  private drops: Drop[] = [];
  private rnd = rng(4242);

  constructor(erase: EraseUniforms) {
    this.effect = new LensBloodEffect(erase);
  }

  /** `n` gotas golpean la lente (planos 4, 6, 7), siempre en la mitad de la pared del donante
   *  (`side` -1 izquierda, +1 derecha, como lo ve el público): nunca sobre el receptor (§1.3). */
  hit(n: number, side = 0): void {
    for (let k = 0; k < n; k++) {
      if (this.drops.length >= MAX_DROPS) this.drops.shift();
      const r = this.rnd;
      const y = 0.35 + r() * 0.5;
      // x en la pared → x del shader (el canvas se espeja por CSS después del postproceso).
      const wall = side === 0 ? 0.2 + r() * 0.6 : side > 0 ? 0.55 + r() * 0.38 : 0.07 + r() * 0.38;
      this.drops.push({
        x: config.mirror ? 1 - wall : wall,
        y, y0: y, r: 0.018 + r() * r() * 0.05, age: 0, life: 2.2 + r() * 1.2,
        hold: 0.15 + r() * 0.5, speed: 0.03 + r() * 0.07, seed: r(), width: 0.3 + r() * 0.25,
      });
    }
  }

  update(dt: number, aspect: number): void {
    const u = this.effect.uniforms;
    u.get('uAspect')!.value = aspect;
    const B = config.blood;
    (u.get('uTint')!.value as Vector3).set(B.lensTintR, B.lensTintG, B.lensTintB);
    u.get('uSoft')!.value = B.lensSoft;
    u.get('uSpec')!.value = B.lensSpec;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age > d.hold) {
        // Escurre a tirones: acelera y frena con la tensión superficial.
        const jerk = 0.6 + 0.4 * Math.sin(d.age * 7 + d.seed * 20);
        d.y -= d.speed * jerk * dt;
        d.r *= Math.exp(-0.05 * dt);
      }
      if (d.age >= d.life || d.y < -0.1) this.drops.splice(i, 1);
    }
    const drops = u.get('uDrops')!.value as Vector4[];
    const trail = u.get('uTrail')!.value as Vector4[];
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.drops[i];
      if (!d) {
        drops[i].set(0, 0, 0, 0);
        continue;
      }
      const fade = Math.min(1, d.age / 0.04) * (1 - smooth((d.age - d.life + 0.6) / 0.6));
      drops[i].set(d.x, d.y, d.r, fade);
      trail[i].set(d.y0, d.seed, d.width, 0);
    }
  }

  /** ¿Hay alguna gota? (el pase se apaga si no). */
  get active(): boolean {
    return this.drops.length > 0;
  }

  clear(): void {
    this.drops.length = 0;
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
