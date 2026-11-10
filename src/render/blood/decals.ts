// Sangre sobre huesos y piso (§10.3, §9.6).
//  - Manchas: DecalGeometry proyectado sobre las piezas del cerdo en los puntos donde cae la
//    sangre. 8 texturas de salpicadura generadas al cargar (mancha, gotas satélite y chorreaduras
//    hacia abajo) con normal map húmedo. Máximo 40 activas; se reutilizan.
//  - Charco: un plano en el piso bajo el cerdo que crece con la sangre que cae. Forma por campo de
//    "metaballs" con borde irregular y menisco; mismo sombreado que el SSFR.
// Ambos coagulan con el tiempo: se oscurecen y pierden brillo (§10.2).
import {
  CanvasTexture, Color, Euler, Matrix4, Mesh, MeshPhysicalMaterial, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4,
  type Object3D, type Texture,
} from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { config } from '../../config.ts';
import { rng } from '../../random.ts';
import { ERASE_GLSL, type EraseUniforms } from '../erase.ts';
import type { Lighting } from '../lighting.ts';
import { BLOOD_SHADE_GLSL, bloodShadeUniforms, syncBloodShade } from './shade.ts';
import { PLATE } from '../materials/glsl.ts';

const MAX_DECALS = 40;
const VARIANTS = 8;
const TEX = 256;

interface SplatTex {
  alpha: Texture;
  normal: Texture;
}

/** Una salpicadura: alfa en el canal verde (alphaMap) y altura para el normal map. */
function makeSplat(seed: number): SplatTex {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, TEX, TEX);
  g.fillStyle = '#fff';
  const blob = (x: number, y: number, rad: number) => {
    g.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = rad * (0.82 + 0.3 * r());
      const px = x + Math.cos(a) * k;
      const py = y + Math.sin(a) * k;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.fill();
  };
  const cx = TEX / 2 + (r() - 0.5) * 20;
  const cy = TEX * 0.42 + (r() - 0.5) * 20;
  // Mancha principal: varios lóbulos superpuestos.
  for (let i = 0; i < 6; i++) blob(cx + (r() - 0.5) * 50, cy + (r() - 0.5) * 40, 22 + r() * 30);
  // Gotas satélite en rayos (impacto).
  const rays = 7 + Math.floor(r() * 6);
  for (let i = 0; i < rays; i++) {
    const a = r() * Math.PI * 2;
    let d = 55 + r() * 20;
    let s = 6 + r() * 6;
    for (let k = 0; k < 4 && s > 1.2; k++) {
      blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s);
      d += s * 2.2 + r() * 10;
      s *= 0.62;
    }
  }
  // Chorreaduras hacia abajo (+Y de la textura = abajo en el mundo) con gota al final.
  const drips = 1 + Math.floor(r() * 3);
  for (let i = 0; i < drips; i++) {
    const x = cx + (r() - 0.5) * 60;
    const len = 40 + r() * 70;
    const w = 4 + r() * 5;
    g.fillRect(x - w / 2, cy, w, len);
    blob(x, cy + len, w * 0.95);
  }
  // Altura = alfa desenfocado: el centro de la mancha abulta (menisco).
  const h = document.createElement('canvas');
  h.width = h.height = TEX;
  const hg = h.getContext('2d')!;
  hg.filter = 'blur(5px)';
  hg.drawImage(c, 0, 0);
  const H = hg.getImageData(0, 0, TEX, TEX).data;
  const n = document.createElement('canvas');
  n.width = n.height = TEX;
  const ng = n.getContext('2d')!;
  const img = ng.createImageData(TEX, TEX);
  const at = (x: number, y: number) => H[(Math.min(TEX - 1, Math.max(0, y)) * TEX + Math.min(TEX - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * TEX + x) * 4;
      img.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ng.putImageData(img, 0, 0);
  return { alpha: new CanvasTexture(c), normal: new CanvasTexture(n) };
}

interface Decal {
  mesh: Mesh;
  mat: MeshPhysicalMaterial;
  age: number;
}

const tmpV = new Vector3();
const tmpN = new Vector3();
const tmpM = new Matrix4();
const UP = new Vector3(0, 1, 0);

export class BloodDecals {
  private textures: SplatTex[] = [];
  private pool: Decal[] = [];
  private next = 0;
  private parent: Object3D;
  private rnd = rng(901);
  private erase: EraseUniforms;

  constructor(parent: Object3D, erase: EraseUniforms) {
    this.parent = parent;
    this.erase = erase;
    for (let i = 0; i < VARIANTS; i++) this.textures.push(makeSplat(1000 + i * 37));
  }

  /** Mancha sobre `mesh` en `point` (mundo) con normal `normal` (mundo); `size` en m. */
  place(mesh: Mesh, point: Vector3, normal: Vector3, size: number): void {
    let d = this.pool.length < MAX_DECALS ? null : this.pool[this.next];
    if (!d) {
      const mat = new MeshPhysicalMaterial({
        color: config.blood.decalColor, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        envMapIntensity: 1.2,
      });
      // Borrado (erase.ts): desatura y el trapeador se la lleva, con la misma máscara que el resto.
      const erase = this.erase;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, erase, { uBlFlat: PLATE });
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform float uBlFlat;\n${ERASE_GLSL}`)
          .replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
// Placa real: mancha plana, sin barniz ni reflejos.
gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb * 0.85, uBlFlat);
vec2 erUv = gl_FragCoord.xy / uEraseRes;
gl_FragColor.rgb = er_desat(gl_FragColor.rgb) + vec3(0.5) * er_front(erUv) * uEraseDesat;
gl_FragColor.a *= 1.0 - er_clear(erUv);`,
          );
      };
      mat.customProgramCacheKey = () => 'donante-mancha-v2';
      d = { mesh: new Mesh(undefined, mat), mat, age: 0 };
      d.mesh.renderOrder = 7;
      this.pool.push(d);
    } else {
      this.next = (this.next + 1) % MAX_DECALS;
      d.mesh.geometry.dispose();
    }
    const t = this.textures[Math.floor(this.rnd() * VARIANTS)];
    d.mat.alphaMap = t.alpha;
    d.mat.normalMap = t.normal;
    d.mat.needsUpdate = true;
    // Orientación: mira a lo largo de la normal y la "abajo" de la textura apunta al piso.
    tmpN.copy(normal).normalize();
    tmpM.lookAt(tmpV.copy(point).add(tmpN), point, UP);
    const e = new Euler().setFromRotationMatrix(tmpM);
    e.z += (this.rnd() - 0.5) * 0.5;
    const s = size * (0.7 + 0.6 * this.rnd());
    mesh.updateWorldMatrix(true, false);
    d.mesh.geometry = new DecalGeometry(mesh, point, e, new Vector3(s, s, s * 1.4));
    d.age = 0;
    if (!d.mesh.parent) this.parent.add(d.mesh);
  }

  update(dt: number): void {
    const B = config.blood;
    const fresh = tmpFresh.set(B.decalColor);
    const dry = tmpDry.set(B.clotColor);
    for (const d of this.pool) {
      if (!d.mesh.parent) continue;
      d.age += dt;
      const c = Math.min(1, d.age / B.clotTime);
      d.mat.color.copy(fresh).lerp(dry, c);
      d.mat.roughness = 0.12 + 0.5 * c;
      d.mat.clearcoatRoughness = 0.06 + 0.45 * c;
      d.mat.normalScale.setScalar(1.6 - 1.1 * c);
    }
  }

  clear(): void {
    for (const d of this.pool) d.mesh.removeFromParent();
  }
}

const tmpFresh = new Color();
const tmpDry = new Color();

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// ═══════════════════════════════ charco ═══════════════════════════════
// El charco refleja de verdad lo que tiene detrás (Reflector de three, a un tercio de resolución y
// solo mientras existe): así se lee como líquido y no como pintura.

const PUDDLE_BLOBS = 7;

const PUDDLE_VERT = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vRefl;
varying vec3 vWorld;
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  vRefl = textureMatrix * vec4(position, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const PUDDLE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 color;
uniform vec4 uBlobs[${PUDDLE_BLOBS}];
uniform float uGrow;
uniform float uCoag;
uniform float uSeed;
uniform float uReflect;
varying vec4 vRefl;
varying vec3 vWorld;
varying vec2 vLocal;
${BLOOD_SHADE_GLSL}
${ERASE_GLSL}
float ph(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float pn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph(i), ph(i + vec2(1, 0)), u.x), mix(ph(i + vec2(0, 1)), ph(i + vec2(1, 1)), u.x), u.y);
}
float field(vec2 p) {
  // Borde irregular: el plano se deforma con ruido antes de medir el campo.
  p += (vec2(pn(p * 9.0 + uSeed), pn(p * 9.0 + uSeed + 7.7)) - 0.5) * 0.05;
  float f = 0.0;
  for (int i = 0; i < ${PUDDLE_BLOBS}; i++) {
    vec4 b = uBlobs[i];
    float r = b.z * uGrow * b.w;
    if (r <= 0.0) continue;
    vec2 d = p - b.xy;
    f += r * r / (dot(d, d) + 1e-5);
  }
  return f;
}
void main() {
  float f = field(vLocal);
  float m = smoothstep(0.95, 1.12, f);
  if (m <= 0.001) discard;
  // Menisco: plano al centro, curvo en el borde (ahí el reflejo se dobla y brilla).
  float e = 0.004;
  float fx = field(vLocal + vec2(e, 0.0)) - field(vLocal - vec2(e, 0.0));
  float fy = field(vLocal + vec2(0.0, e)) - field(vLocal - vec2(0.0, e));
  float rim = 1.0 - smoothstep(1.0, 2.4, f);
  vec3 n = normalize(vec3(-fx, 0.0, fy) * rim * 0.06 + vec3(0.0, 1.0, 0.0));
  vec3 v = normalize(cameraPosition - vWorld);
  // Un charco es espeso: carmesí oscuro; el brillo viene del reflejo y del menisco, no del color.
  float thick = 0.012 + 0.03 * smoothstep(1.0, 4.0, f);
  vec3 col = bl_shade(n, v, thick, vec3(0.0), uCoag) * (0.55 + 0.45 * rim);
  // Reflejo real de la escena (los huesos y la piel se espejan en la sangre).
  float nv = clamp(dot(n, v), 0.0, 1.0);
  float F = 0.025 + 0.975 * pow(1.0 - nv, 5.0);
  vec4 ruv = vRefl + vec4(n.x, -n.z, 0.0, 0.0) * 0.6 * vRefl.w;
  vec3 refl = texture2DProj(tDiffuse, ruv).rgb;
  col += refl * (F * uReflect + 0.03) * (1.0 - 0.75 * uCoag) * (1.0 - uBlFlat);
  vec2 erUv = gl_FragCoord.xy / uEraseRes;
  gl_FragColor = vec4(er_desat(col) + vec3(0.6) * er_front(erUv) * uEraseDesat, m * (1.0 - er_clear(erUv)));
}
`;

export class Puddle {
  readonly mesh: Reflector;
  private mat: ShaderMaterial;
  private blobs: Vector4[];
  /** Volumen acumulado (sangre caída, normalizada por preset). */
  private volume = 0;
  private age = 0;
  private lighting: Lighting;
  /** Objetos que no deben aparecer en el reflejo (la capa de máscara es de pantalla completa). */
  readonly excluded: Object3D[] = [];
  /** Radio máximo (m): el charco nunca llega al receptor (§1.3). */
  maxRadius = Infinity;

  constructor(lighting: Lighting, erase: EraseUniforms) {
    this.lighting = lighting;
    this.mesh = new Reflector(new PlaneGeometry(2.4, 2.4), {
      textureWidth: Math.round(window.innerWidth / 3),
      textureHeight: Math.round(window.innerHeight / 3),
      clipBias: 0.003,
      multisample: 0,
      shader: {
        name: 'charco',
        uniforms: {
          color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
          uBlobs: { value: Array.from({ length: PUDDLE_BLOBS }, () => new Vector4()) }, uGrow: { value: 0 },
          uCoag: { value: 0 }, uSeed: { value: 0 }, uReflect: { value: 2.5 },
          ...bloodShadeUniforms(),
          ...erase,
        },
        vertexShader: PUDDLE_VERT,
        fragmentShader: PUDDLE_FRAG,
      },
    });
    this.mat = this.mesh.material as ShaderMaterial;
    // Reflector clona los uniforms: los del borrado tienen que ser los compartidos.
    Object.assign(this.mat.uniforms, erase);
    this.mat.transparent = true;
    this.mat.depthWrite = false;
    this.blobs = this.mat.uniforms.uBlobs.value as Vector4[];
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.mesh.name = 'charco';
    // El reflejo se renderiza sin lo que no tiene sentido espejar.
    const render = this.mesh.onBeforeRender;
    this.mesh.onBeforeRender = (...args) => {
      const prev = this.excluded.map((o) => o.visible);
      for (const o of this.excluded) o.visible = false;
      render.apply(this.mesh, args);
      this.excluded.forEach((o, i) => (o.visible = prev[i]));
    };
  }

  /** Coloca el charco bajo `drip` (punto de goteo, mundo) en el piso `floorY`. */
  start(drip: Vector3, floorY: number, forward: Vector2): void {
    const r = rng(Math.floor(drip.x * 1000) ^ 77);
    this.mesh.position.set(drip.x, floorY + 0.002, drip.z);
    this.mat.uniforms.uSeed.value = r() * 100;
    // Plano rotado: x local = x mundo, y local = -z mundo.
    this.blobs.forEach((b, i) => {
      const main = i === 0;
      const a = r() * Math.PI * 2;
      const d = main ? 0 : 0.05 + r() * 0.16;
      // Los satélites se corren hacia adelante (la sangre salió hacia la cámara) y hacia los pies.
      const x = Math.cos(a) * d + forward.x * d * 0.6;
      const y = Math.sin(a) * d * 0.7 - forward.y * d * 0.6;
      b.set(x, y, main ? 0.11 : 0.03 + r() * 0.05, main ? 1 : 0);
    });
    this.volume = 0;
    this.age = 0;
    this.maxRadius = Infinity;
    this.mesh.visible = true;
  }

  /** Suma sangre caída (crece con la raíz del volumen, como un fluido que se esparce). */
  add(amount: number): void {
    this.volume += amount;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    const B = config.blood;
    this.age += dt;
    const grow = Math.min(Math.sqrt(this.volume * B.puddleGrowth), this.maxRadius / 0.11);
    this.mat.uniforms.uGrow.value = Math.min(B.puddleMax, grow);
    // Los satélites aparecen a medida que el charco crece.
    this.blobs.forEach((b, i) => {
      if (i === 0) return;
      const target = smooth((grow - 0.25 - i * 0.12) / 0.4);
      b.w += (target - b.w) * Math.min(1, dt * 2);
    });
    this.mat.uniforms.uCoag.value = Math.min(1, this.age / B.clotTime) * 0.85;
    this.mat.uniforms.uReflect.value = B.puddleReflect;
    syncBloodShade(this.mat.uniforms as unknown as Parameters<typeof syncBloodShade>[0], this.lighting);
  }

  clear(): void {
    this.mesh.visible = false;
    this.volume = 0;
  }
}
