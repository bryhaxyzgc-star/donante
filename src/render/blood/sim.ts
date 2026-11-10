// Sangre líquida · simulación (§10.2). Partículas en GPU con GPUComputationRenderer:
//  - gravedad, arrastre y viscosidad;
//  - cohesión por vecindad: las partículas se acumulan (puntos aditivos) en una grilla 3D de 32³
//    alrededor del donante; cada una tira hacia el centro de masa de su celda y se mezcla con la
//    velocidad media. Así los chorros quedan como cuerdas y las gotas se juntan en vez de dispersarse;
//  - colisión con cápsulas que aproximan los huesos del cerdo (la sangre resbala por ellos) y con el
//    piso (se frena y queda como lámina hasta que el anillo la recicla).
// Los emisores escriben en un búfer circular: el CPU reserva [inicio, inicio+cantidad) y la GPU
// reinicia esas partículas en el mismo frame. Nada se lee de vuelta al CPU.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Camera, Color, FloatType, LinearFilter, NearestFilter, Points, Scene,
  ShaderMaterial, Vector3, Vector4, WebGLRenderTarget, type Texture, type WebGLRenderer,
} from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { config } from '../../config.ts';

export const MAX_EMITTERS = 8;
export const MAX_CAPSULES = 16;
/** Celdas por eje de la grilla de cohesión y mosaicos del atlas 2D (8 × 4 rebanadas de 32×32). */
const GRID = 32;
const TILES_X = 8;
const ATLAS_W = GRID * TILES_X;
const ATLAS_H = GRID * (GRID / TILES_X);

export interface Emission {
  /** Caudal continuo: las partículas nacen repartidas en este intervalo (s), no todas juntas. */
  span?: number;
  origin: Vector3;
  /** Dirección media (se normaliza). */
  dir: Vector3;
  speed: number;
  /** Semiángulo del cono (rad). */
  spread: number;
  /** Variación relativa de la velocidad (0..1). */
  jitter: number;
  count: number;
  /** Vida en s de juego. */
  life: number;
  /** Radio de la zona de nacimiento (m). */
  radius: number;
}

/** Tamaño de la textura de simulación según la cantidad de partículas del preset. */
function simSize(n: number): [number, number] {
  if (n <= 4096) return [64, 64];
  if (n <= 8192) return [128, 64];
  if (n <= 16384) return [128, 128];
  return [256, 128];
}

const HASH_GLSL = /* glsl */ `
vec3 bl_hash3(float i, float s) {
  vec3 p = fract(vec3(i * 0.1031, i * 0.1030, i * 0.0973) + s * vec3(0.7317, 0.5193, 0.1341));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xxy + p.yzz) * p.zyx);
}
`;

const EMIT_GLSL = /* glsl */ `
uniform vec4 uEmitA[${MAX_EMITTERS}];  // inicio, cantidad, vida, radio de nacimiento
uniform vec4 uEmitO[${MAX_EMITTERS}];  // origen, velocidad
uniform vec4 uEmitD[${MAX_EMITTERS}];  // dirección, semiángulo
uniform vec4 uEmitJ[${MAX_EMITTERS}];  // variación de velocidad, semilla, duración del frame
uniform float uCount;
${HASH_GLSL}
int bl_emitter(float idx) {
  for (int i = 0; i < ${MAX_EMITTERS}; i++) {
    float c = uEmitA[i].y;
    if (c <= 0.0) continue;
    float rel = mod(idx - uEmitA[i].x + uCount, uCount);
    if (rel < c) return i;
  }
  return -1;
}
vec3 bl_emitVel(int e, float idx) {
  vec3 r = bl_hash3(idx, uEmitJ[e].y);
  vec3 d = normalize(uEmitD[e].xyz);
  vec3 t = normalize(abs(d.y) < 0.95 ? cross(d, vec3(0.0, 1.0, 0.0)) : cross(d, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(d, t);
  float th = uEmitD[e].w * sqrt(r.x);
  float ph = 6.2831853 * r.y;
  vec3 dir = d * cos(th) + (t * cos(ph) + b * sin(ph)) * sin(th);
  return dir * uEmitO[e].w * (1.0 + uEmitJ[e].x * (r.z * 2.0 - 1.0));
}
vec4 bl_emitPos(int e, float idx) {
  vec3 r = bl_hash3(idx + 17.0, uEmitJ[e].y) * 2.0 - 1.0;
  // Nacimiento repartido dentro del frame: un caudal continuo no sale en cuentas separadas.
  float tau = bl_hash3(idx + 63.0, uEmitJ[e].y).y * uEmitJ[e].z;
  vec3 p = uEmitO[e].xyz + r * uEmitA[e].w * 0.58 + bl_emitVel(e, idx) * tau;
  float life = uEmitA[e].z * (0.75 + 0.5 * bl_hash3(idx + 41.0, uEmitJ[e].y).x);
  return vec4(p, life);
}
`;

const WORLD_GLSL = /* glsl */ `
uniform float uDt;
uniform float uFloorY;
uniform float uRadius;
uniform vec4 uCapA[${MAX_CAPSULES}];
uniform vec4 uCapB[${MAX_CAPSULES}];
uniform int uCapN;
`;

const VEL_SHADER = /* glsl */ `
${EMIT_GLSL}
${WORLD_GLSL}
uniform float uGravity;
uniform float uDrag;
uniform float uStick;
uniform float uFloorFriction;
uniform sampler2D tGridP;
uniform sampler2D tGridV;
uniform vec3 uGridMin;
uniform float uGridCell;
uniform float uCohesion;
uniform float uViscosity;
uniform float uUseGrid;

vec2 bl_atlas(vec2 xy, float z) {
  float tx = mod(z, ${TILES_X.toFixed(1)});
  float ty = floor(z / ${TILES_X.toFixed(1)});
  return (vec2(tx, ty) * ${GRID.toFixed(1)} + clamp(xy, vec2(0.5), vec2(${(GRID - 0.5).toFixed(1)}))) / vec2(${ATLAS_W.toFixed(1)}, ${ATLAS_H.toFixed(1)});
}
vec4 bl_grid(sampler2D t, vec3 p) {
  vec3 c = (p - uGridMin) / uGridCell;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThanEqual(c, vec3(${GRID.toFixed(1)})))) return vec4(0.0);
  float z = clamp(c.z - 0.5, 0.0, ${(GRID - 1).toFixed(1)});
  float z0 = floor(z);
  float z1 = min(z0 + 1.0, ${(GRID - 1).toFixed(1)});
  return mix(texture2D(t, bl_atlas(c.xy, z0)), texture2D(t, bl_atlas(c.xy, z1)), z - z0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float idx = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  int e = bl_emitter(idx);
  if (e >= 0) { gl_FragColor = vec4(bl_emitVel(e, idx), 0.0); return; }
  if (p.w <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = v.xyz;
  vel.y -= uGravity * uDt;
  vel *= exp(-uDrag * uDt);
  if (uUseGrid > 0.5) {
    vec4 gp = bl_grid(tGridP, p.xyz);
    if (gp.w > 1.2) {
      vec4 gv = bl_grid(tGridV, p.xyz);
      vec3 com = uGridMin + gp.xyz / gp.w;
      vel += (com - p.xyz) * uCohesion * uDt;
      vel = mix(vel, gv.xyz / gv.w, 1.0 - exp(-uViscosity * uDt));
    }
  }
  // Huesos: sin velocidad hacia adentro, y la tangencial se frena (la sangre se pega y resbala).
  vec3 np = p.xyz + vel * uDt;
  float surf = v.w;
  for (int i = 0; i < ${MAX_CAPSULES}; i++) {
    if (i >= uCapN) break;
    vec3 a = uCapA[i].xyz;
    vec3 ab = uCapB[i].xyz - a;
    float r = uCapB[i].w + uRadius * 0.5;
    float t = clamp(dot(np - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec3 d = np - (a + ab * t);
    float dl = length(d);
    if (dl < r) {
      vec3 n = d / max(dl, 1e-5);
      float vn = dot(vel, n);
      if (vn < 0.0) vel -= n * vn;
      vec3 vt = vel - n * dot(vel, n);
      vel -= vt * (1.0 - exp(-uStick * uDt));
      surf = 1.0;
    }
  }
  // Piso: casi sin rebote; se esparce un poco y se detiene.
  if (np.y < uFloorY + uRadius * 0.4) {
    if (vel.y < 0.0) vel.y *= -0.06;
    vel.xz *= exp(-uFloorFriction * uDt);
    surf = 2.0;
  }
  gl_FragColor = vec4(vel, surf);
}
`;

const POS_SHADER = /* glsl */ `
${EMIT_GLSL}
${WORLD_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float idx = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  int e = bl_emitter(idx);
  if (e >= 0) { gl_FragColor = bl_emitPos(e, idx); return; }
  if (p.w <= 0.0) { gl_FragColor = vec4(0.0, -100.0, 0.0, 0.0); return; }
  vec3 np = p.xyz + v.xyz * uDt;
  for (int i = 0; i < ${MAX_CAPSULES}; i++) {
    if (i >= uCapN) break;
    vec3 a = uCapA[i].xyz;
    vec3 ab = uCapB[i].xyz - a;
    float r = uCapB[i].w + uRadius * 0.5;
    float t = clamp(dot(np - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec3 c = a + ab * t;
    vec3 d = np - c;
    float dl = length(d);
    if (dl < r) np = c + d / max(dl, 1e-5) * r;
  }
  np.y = max(np.y, uFloorY + uRadius * 0.4);
  // En el piso la gota se funde rápido con el charco (que la "absorbe"): no quedan puntos sueltos.
  float rate = np.y <= uFloorY + uRadius * 0.45 ? 4.0 : 1.0;
  gl_FragColor = vec4(np, p.w - uDt * rate);
}
`;

/** Vértice común: cada punto lee su partícula de la textura de posiciones. */
export const PARTICLE_VERT_PARS = /* glsl */ `
uniform sampler2D tPos;
attribute vec2 ref;
`;

const GRID_VERT = /* glsl */ `
${PARTICLE_VERT_PARS}
uniform sampler2D tVel;
uniform vec3 uGridMin;
uniform float uGridCell;
uniform float uMode;
varying vec4 vVal;
void main() {
  vec4 p = texture2D(tPos, ref);
  vec3 c = (p.xyz - uGridMin) / uGridCell;
  if (p.w <= 0.0 || any(lessThan(c, vec3(0.0))) || any(greaterThanEqual(c, vec3(${GRID.toFixed(1)})))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 cell = floor(c);
  float tx = mod(cell.z, ${TILES_X.toFixed(1)});
  float ty = floor(cell.z / ${TILES_X.toFixed(1)});
  vec2 px = vec2(tx, ty) * ${GRID.toFixed(1)} + cell.xy + 0.5;
  gl_Position = vec4(px / vec2(${ATLAS_W.toFixed(1)}, ${ATLAS_H.toFixed(1)}) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vVal = uMode < 0.5 ? vec4(p.xyz - uGridMin, 1.0) : vec4(texture2D(tVel, ref).xyz, 1.0);
}
`;
const GRID_FRAG = /* glsl */ `
varying vec4 vVal;
void main() { gl_FragColor = vVal; }
`;

export class BloodSim {
  readonly count: number;
  readonly width: number;
  readonly height: number;
  /** Radio de render de cada partícula (m): más grande con menos partículas (mismo volumen). */
  readonly radius: number;
  /** Geometría de puntos (una por partícula) que usan el SSFR y la grilla. */
  readonly points: BufferGeometry;
  private gpu: GPUComputationRenderer;
  private posVar: Variable;
  private velVar: Variable;
  private cursor = 0;
  private queue: Emission[] = [];
  private seed = 1;
  private capA = Array.from({ length: MAX_CAPSULES }, () => new Vector4());
  private capB = Array.from({ length: MAX_CAPSULES }, () => new Vector4());
  private capN = 0;
  floorY = -1.5;
  /** Hay partículas vivas (s de juego que faltan para que muera la última). */
  private aliveFor = 0;
  private gridP: WebGLRenderTarget | null = null;
  private gridV: WebGLRenderTarget | null = null;
  private gridMat: ShaderMaterial | null = null;
  private gridScene = new Scene();
  private gridCam = new Camera();
  readonly gridMin = new Vector3();
  private gridCell = 0.05;
  private renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer, particles: number) {
    this.renderer = renderer;
    const [w, h] = simSize(particles);
    this.width = w;
    this.height = h;
    this.count = w * h;
    this.radius = config.blood.particleRadius * Math.cbrt(16384 / this.count);
    this.gpu = new GPUComputationRenderer(w, h, renderer);
    this.gpu.setDataType(FloatType);
    const p0 = this.gpu.createTexture();
    const pa = p0.image.data as Float32Array;
    for (let i = 0; i < this.count; i++) pa[i * 4 + 1] = -100;
    const v0 = this.gpu.createTexture();
    this.velVar = this.gpu.addVariable('textureVelocity', VEL_SHADER, v0);
    this.posVar = this.gpu.addVariable('texturePosition', POS_SHADER, p0);
    this.gpu.setVariableDependencies(this.velVar, [this.velVar, this.posVar]);
    this.gpu.setVariableDependencies(this.posVar, [this.velVar, this.posVar]);
    for (const v of [this.velVar, this.posVar]) {
      Object.assign(v.material.uniforms, {
        uEmitA: { value: Array.from({ length: MAX_EMITTERS }, () => new Vector4()) },
        uEmitO: { value: Array.from({ length: MAX_EMITTERS }, () => new Vector4()) },
        uEmitD: { value: Array.from({ length: MAX_EMITTERS }, () => new Vector4()) },
        uEmitJ: { value: Array.from({ length: MAX_EMITTERS }, () => new Vector4()) },
        uCount: { value: this.count },
        uDt: { value: 0 },
        uFloorY: { value: this.floorY },
        uRadius: { value: this.radius },
        uCapA: { value: this.capA },
        uCapB: { value: this.capB },
        uCapN: { value: 0 },
      });
    }
    Object.assign(this.velVar.material.uniforms, {
      uGravity: { value: 9.81 },
      uDrag: { value: 0.3 },
      uStick: { value: 6 },
      uFloorFriction: { value: 5 },
      tGridP: { value: null },
      tGridV: { value: null },
      uGridMin: { value: this.gridMin },
      uGridCell: { value: this.gridCell },
      uCohesion: { value: 0 },
      uViscosity: { value: 0 },
      uUseGrid: { value: 0 },
    });
    const err = this.gpu.init();
    if (err) throw new Error(`[sangre] GPUComputationRenderer: ${err}`);

    const ref = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      ref[i * 2] = ((i % w) + 0.5) / w;
      ref[i * 2 + 1] = (Math.floor(i / w) + 0.5) / h;
    }
    this.points = new BufferGeometry();
    // `position` es obligatorio para three aunque el vértice lea la textura.
    this.points.setAttribute('position', new BufferAttribute(new Float32Array(this.count * 3), 3));
    this.points.setAttribute('ref', new BufferAttribute(ref, 2));
    this.points.boundingSphere = null;

    // Grilla de cohesión: necesita mezcla aditiva en float (EXT_float_blend). Sin eso, sin cohesión.
    if (renderer.extensions.has('EXT_float_blend')) {
      const opts = { type: FloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
      this.gridP = new WebGLRenderTarget(ATLAS_W, ATLAS_H, opts);
      this.gridV = new WebGLRenderTarget(ATLAS_W, ATLAS_H, opts);
      this.gridMat = new ShaderMaterial({
        uniforms: {
          tPos: { value: null }, tVel: { value: null }, uGridMin: { value: this.gridMin }, uGridCell: { value: this.gridCell },
          uMode: { value: 0 },
        },
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      const pts = new Points(this.points, this.gridMat);
      pts.frustumCulled = false;
      this.gridScene.add(pts);
    } else {
      console.warn('[sangre] sin EXT_float_blend: la cohesión por grilla queda desactivada');
    }
    for (const t of [this.posTexture, this.velTexture]) {
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
    }
  }

  get posTexture(): Texture {
    return this.gpu.getCurrentRenderTarget(this.posVar).texture;
  }

  get velTexture(): Texture {
    return this.gpu.getCurrentRenderTarget(this.velVar).texture;
  }

  /** ¿Queda alguna partícula viva? (el SSFR se apaga si no). */
  get active(): boolean {
    return this.aliveFor > 0;
  }

  /** Pide nacer `count` partículas (se agrupan hasta 8 emisiones por frame). */
  emit(e: Emission): void {
    if (e.count < 1) return;
    this.queue.push(e);
  }

  /** Cápsulas de colisión (mundo): a, b, radio. */
  setCapsules(list: [Vector3, Vector3, number][]): void {
    this.capN = Math.min(MAX_CAPSULES, list.length);
    for (let i = 0; i < this.capN; i++) {
      const [a, b, r] = list[i];
      this.capA[i].set(a.x, a.y, a.z, 0);
      this.capB[i].set(b.x, b.y, b.z, r);
    }
  }

  /** Centra la grilla de cohesión (2,2 m de lado) donde está la sangre. */
  setRegion(center: Vector3, size = 2.2): void {
    this.gridCell = size / GRID;
    this.gridMin.copy(center).subScalar(size / 2);
  }

  /** Mata todas las partículas (fin de ciclo). */
  clear(): void {
    this.queue.length = 0;
    // Una emisión que cubre todo el anillo con vida 0 = todas muertas en el próximo paso.
    this.queue.push({ origin: new Vector3(0, -100, 0), dir: new Vector3(0, 1, 0), speed: 0, spread: 0, jitter: 0, count: this.count, life: 0, radius: 0 });
    this.aliveFor = 0.001;
  }

  step(dt: number): void {
    if (!this.queue.length && this.aliveFor <= 0) return;
    if (dt <= 0 && !this.queue.length) return;
    const B = config.blood;
    const step = Math.min(dt, 1 / 30);
    // Emisores de este frame.
    const n = Math.min(MAX_EMITTERS, this.queue.length);
    for (const v of [this.velVar, this.posVar]) {
      const u = v.material.uniforms;
      for (let i = 0; i < MAX_EMITTERS; i++) u.uEmitA.value[i].set(0, 0, 0, 0);
    }
    for (let i = 0; i < n; i++) {
      const e = this.queue.shift()!;
      const count = Math.min(this.count, Math.round(e.count));
      const start = this.cursor;
      this.cursor = (this.cursor + count) % this.count;
      this.seed = (this.seed * 1.618 + 0.137) % 97;
      tmpD.copy(e.dir).normalize();
      for (const v of [this.velVar, this.posVar]) {
        const u = v.material.uniforms;
        u.uEmitA.value[i].set(start, count, e.life, e.radius);
        u.uEmitO.value[i].set(e.origin.x, e.origin.y, e.origin.z, e.speed);
        u.uEmitD.value[i].set(tmpD.x, tmpD.y, tmpD.z, e.spread);
        u.uEmitJ.value[i].set(e.jitter, this.seed, e.span ?? 0, 0);
      }
      this.aliveFor = Math.max(this.aliveFor, e.life * 1.25);
    }
    for (const v of [this.velVar, this.posVar]) {
      const u = v.material.uniforms;
      u.uDt.value = step;
      u.uFloorY.value = this.floorY;
      u.uCapN.value = this.capN;
    }
    const vu = this.velVar.material.uniforms;
    vu.uGravity.value = B.gravity;
    vu.uDrag.value = B.drag;
    vu.uStick.value = B.stick;
    vu.uFloorFriction.value = B.floorFriction;
    vu.uCohesion.value = B.cohesion;
    vu.uViscosity.value = B.viscosity;
    vu.uGridCell.value = this.gridCell;
    vu.uUseGrid.value = this.gridP && B.cohesion + B.viscosity > 0 ? 1 : 0;
    if (vu.uUseGrid.value) this.splatGrid();
    this.gpu.compute();
    this.aliveFor = Math.max(0, this.aliveFor - step);
  }

  /** Acumula posiciones y velocidades por celda (dos pasadas de puntos aditivos). */
  private splatGrid(): void {
    const r = this.renderer;
    const m = this.gridMat!;
    const prev = r.getRenderTarget();
    const clear = r.getClearAlpha();
    r.getClearColor(tmpC);
    r.setClearColor(0x000000, 0);
    m.uniforms.tPos.value = this.posTexture;
    m.uniforms.tVel.value = this.velTexture;
    m.uniforms.uGridCell.value = this.gridCell;
    for (const [rt, mode] of [[this.gridP!, 0], [this.gridV!, 1]] as const) {
      m.uniforms.uMode.value = mode;
      r.setRenderTarget(rt);
      r.clear(true, false, false);
      r.render(this.gridScene, this.gridCam);
    }
    r.setRenderTarget(prev);
    r.setClearColor(tmpC, clear);
    const vu = this.velVar.material.uniforms;
    vu.tGridP.value = this.gridP!.texture;
    vu.tGridV.value = this.gridV!.texture;
  }

  dispose(): void {
    this.gpu.dispose();
    this.points.dispose();
    this.gridP?.dispose();
    this.gridV?.dispose();
    this.gridMat?.dispose();
  }
}

const tmpD = new Vector3();
const tmpC = new Color();
