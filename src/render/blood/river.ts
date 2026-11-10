// Río de sangre plano (placa real, §10.2): una banda roja que nace en el pecho abierto del cerdo, baja
// por el cuerpo y una pierna hasta el piso y alimenta el charco. Es 2D a propósito: color plano (más
// oscuro al centro, donde es más gruesa), borde irregular, un frente redondo que avanza hacia abajo y
// vetas que corren. El ancho late con el corazón mientras sangran los muñones. El trapeador la borra.
import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Mesh, ShaderMaterial, Vector3, type Camera,
} from 'three';
import { config } from '../../config.ts';
import { ERASE_GLSL, type EraseUniforms } from '../erase.ts';

const SAMPLES = 96;

const VERT = /* glsl */ `
attribute vec2 aRiver;
varying vec2 vR;
void main() {
  vR = aRiver;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uFront;
uniform float uLen;
uniform float uHalfW;
uniform float uWidthK;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uThin;
uniform vec3 uThick;
varying vec2 vR;
${ERASE_GLSL}
float rh(float n) { return fract(sin(n) * 43758.5453); }
float rn(float x) { float i = floor(x); float f = fract(x); return mix(rh(i), rh(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float s = vR.x;
  // El frente: redondo, avanza hacia abajo (en anchos de banda desde la punta).
  float head = (uFront - s) * uLen / max(uHalfW, 1e-4);
  if (head < 0.0) discard;
  float across = abs(vR.y);
  // Borde irregular que se mueve lento; se angosta un poco al bajar.
  float wob = 0.72 + 0.28 * rn(s * uLen * 16.0 + uTime * 0.5);
  float hw = wob * uWidthK * mix(1.0, 0.7, s) * min(1.0, sqrt(head) * 1.1);
  if (across > hw) discard;
  float edge = smoothstep(hw, hw - 0.16, across);
  // Vetas que bajan: el líquido corre.
  float flow = 0.9 + 0.1 * sin(s * uLen * 26.0 - uTime * 2.4 + rn(across * 4.0 + s * 7.0) * 3.0);
  vec3 col = mix(uThin, uThick, smoothstep(hw, 0.0, across)) * flow;
  vec2 erUv = gl_FragCoord.xy / uEraseRes;
  col = er_desat(col) + vec3(0.55) * er_front(erUv) * uEraseDesat;
  gl_FragColor = vec4(col, edge * uOpacity * (1.0 - er_clear(erUv)));
}
`;

export class BloodRiver {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private len = 0;
  private front = 0;
  private delay = 0;
  /** Velocidad del frente (m/s). */
  speed = 0.5;
  /** Ancho relativo (0..1): lo late el corazón y baja cuando deja de sangrar. */
  widthK = 0;
  private widthTarget = 0;

  constructor(erase: EraseUniforms) {
    this.mat = new ShaderMaterial({
      name: 'rioSangre',
      uniforms: {
        uFront: { value: 0 }, uLen: { value: 1 }, uHalfW: { value: 0.03 }, uWidthK: { value: 0 }, uTime: { value: 0 },
        uOpacity: { value: 1 }, uThin: { value: new Color() }, uThick: { value: new Color() },
        ...erase,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  /** Arma la banda sobre `points` (mundo), de frente a la cámara. Empieza a correr tras `delay` s. */
  start(points: Vector3[], halfWidth: number, camera: Camera, delay = 0): void {
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    this.len = curve.getLength();
    const pos = new Float32Array(SAMPLES * 2 * 3);
    const uv = new Float32Array(SAMPLES * 2 * 2);
    const idx: number[] = [];
    const eye = camera.getWorldPosition(new Vector3());
    const p = new Vector3();
    const t = new Vector3();
    const side = new Vector3();
    const view = new Vector3();
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / (SAMPLES - 1);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      view.subVectors(eye, p).normalize();
      side.crossVectors(t, view).normalize().multiplyScalar(halfWidth);
      for (const [k, sgn] of [[0, -1], [1, 1]] as const) {
        const o = (i * 2 + k) * 3;
        pos[o] = p.x + side.x * sgn;
        pos[o + 1] = p.y + side.y * sgn;
        pos[o + 2] = p.z + side.z * sgn;
        uv[(i * 2 + k) * 2] = u;
        uv[(i * 2 + k) * 2 + 1] = sgn;
      }
      if (i < SAMPLES - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = this.mesh.geometry;
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aRiver', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mat.uniforms.uLen.value = this.len;
    this.mat.uniforms.uHalfW.value = halfWidth;
    this.front = 0;
    this.delay = delay;
    this.widthK = 0;
    this.widthTarget = 1;
    this.mesh.visible = true;
  }

  /** Cuánto ancho tiene (0..1): con el corazón latiendo, sangra más. */
  setFlow(k: number): void {
    this.widthTarget = Math.max(0, Math.min(1.3, k));
  }

  /** ¿Ya llegó al piso? */
  get arrived(): boolean {
    return this.mesh.visible && this.front >= 1;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    const u = this.mat.uniforms;
    const B = config.blood;
    u.uTime.value += dt;
    if (this.delay > 0) this.delay -= dt;
    else this.front = Math.min(1, this.front + (this.speed * dt) / Math.max(0.05, this.len));
    this.widthK += (this.widthTarget - this.widthK) * (1 - Math.exp(-4 * dt));
    u.uFront.value = this.front;
    u.uWidthK.value = this.widthK;
    u.uThin.value.set(B.thinColor);
    u.uThick.value.set(B.thickColor);
  }

  clear(): void {
    this.mesh.visible = false;
    this.front = 0;
    this.widthK = this.widthTarget = 0;
  }
}
