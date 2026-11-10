// El borrado (§9.6, §1.6: "el sistema borra la huella"). Toda la sangre (SSFR, manchas, charco y
// lente) primero se desatura a gris y después se limpia con 3 barridos horizontales irregulares, como
// un trapeador: cada pasada va en sentido contrario, tiene el frente quebrado y deja vetas que la
// siguiente termina de limpiar. Es una máscara en espacio de pantalla con uniforms COMPARTIDOS por
// todos los materiales de sangre: un solo `set(t)` mueve todo junto.
import { Vector2, Vector3, Vector4 } from 'three';
import { config } from '../config.ts';

export const ERASE_GLSL = /* glsl */ `
uniform float uEraseDesat;
uniform vec4 uSweep;     // progreso de los 3 barridos (0..1) y semilla
uniform vec3 uSweepDir;  // sentido de cada barrido en x de pantalla (+1 / -1)
uniform vec2 uEraseRes;  // tamaño del buffer (para gl_FragCoord)
float er_hash(float n) { return fract(sin(n) * 43758.5453); }
float er_noise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(er_hash(i), er_hash(i + 1.0), f * f * (3.0 - 2.0 * f));
}
// Cuánto limpió el trapeador en este punto de la pantalla (0 nada … 1 limpio).
float er_clear(vec2 uv) {
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float p = uSweep[i];
    if (p <= 0.0) continue;
    float level = i == 0 ? 0.6 : (i == 1 ? 0.88 : 1.0);
    float s = uSweep.w + float(i) * 17.3;
    // Frente irregular: el trapo no es recto ni parejo.
    float edge = (er_noise(uv.y * 6.0 + s) - 0.5) * 0.14 + (er_noise(uv.y * 23.0 + s * 2.1) - 0.5) * 0.05;
    float front = mix(-0.2, 1.2, p) + edge;
    float x = uSweepDir[i] > 0.0 ? uv.x : 1.0 - uv.x;
    float behind = smoothstep(front + 0.035, front - 0.035, x);
    // Vetas horizontales: la primera pasada deja rastros; la última, ninguno.
    float streak = er_noise(uv.y * 85.0 + s * 3.7);
    float lv = clamp(level + (streak - 0.5) * (1.0 - level) * 1.8, 0.0, 1.0);
    c = max(c, behind * lv);
  }
  return c;
}
// Gris visible (no negro): la mancha queda como un fantasma húmedo hasta que pasa el trapo.
vec3 er_desat(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, vec3(l * 2.4 + 0.035), uEraseDesat);
}
// Brillo mojado en el frente de las pasadas activas (solo se ve donde todavía hay sangre).
float er_front(vec2 uv) {
  float g = 0.0;
  for (int i = 0; i < 3; i++) {
    float p = uSweep[i];
    if (p <= 0.0 || p >= 1.0) continue;
    float s = uSweep.w + float(i) * 17.3;
    float edge = (er_noise(uv.y * 6.0 + s) - 0.5) * 0.14 + (er_noise(uv.y * 23.0 + s * 2.1) - 0.5) * 0.05;
    float front = mix(-0.2, 1.2, p) + edge;
    float x = uSweepDir[i] > 0.0 ? uv.x : 1.0 - uv.x;
    float d = (x - front) / 0.018;
    g = max(g, exp(-d * d));
  }
  return g;
}
`;

export type EraseUniforms = Eraser['uniforms'];

export class Eraser {
  readonly uniforms = {
    uEraseDesat: { value: 0 },
    uSweep: { value: new Vector4(0, 0, 0, Math.random() * 100) },
    uSweepDir: { value: new Vector3(1, -1, 1) },
    uEraseRes: { value: new Vector2(1920, 1080) },
  };
  /** 0..1: avance global (1 = no queda nada). */
  progress = 0;

  /** `t`: segundos desde que empezó el borrado (< 0 = sin borrar). */
  set(t: number): void {
    const E = config.erase;
    const u = this.uniforms;
    if (t < 0) {
      this.reset();
      return;
    }
    u.uEraseDesat.value = smooth(t / E.desatTime);
    const starts = [E.sweep1, E.sweep2, E.sweep3];
    const p = starts.map((s) => smoothSweep((t - s) / E.sweepTime));
    u.uSweep.value.set(p[0], p[1], p[2], u.uSweep.value.w);
    this.progress = Math.min(1, Math.max(0, (t - E.sweep1) / (E.sweep3 + E.sweepTime - E.sweep1)));
  }

  /** Posición del frente del barrido i (0..1 de izquierda a derecha en el buffer), o null. */
  front(i: number): number | null {
    const p = [this.uniforms.uSweep.value.x, this.uniforms.uSweep.value.y, this.uniforms.uSweep.value.z][i];
    if (p <= 0 || p >= 1) return null;
    const f = -0.2 + 1.4 * p;
    return this.uniforms.uSweepDir.value.getComponent(i) > 0 ? f : 1 - f;
  }

  /** Terminó: la última pasada cruzó toda la pantalla. */
  get done(): boolean {
    return this.uniforms.uSweep.value.z >= 1;
  }

  reset(): void {
    const u = this.uniforms;
    u.uEraseDesat.value = 0;
    u.uSweep.value.set(0, 0, 0, Math.random() * 100);
    // Sentidos alternados, el primero al azar (cada ciclo se trapea distinto).
    const d = Math.random() < 0.5 ? 1 : -1;
    u.uSweepDir.value.set(d, -d, d);
    this.progress = 0;
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** El trapo arranca y frena (no va a velocidad constante). */
function smoothSweep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return smooth(x) * 0.85 + x * 0.15;
}
