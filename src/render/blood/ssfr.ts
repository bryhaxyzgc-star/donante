// Sangre líquida · Screen-Space Fluid Rendering (§10.2). Es lo que hace que se vea líquida y no puntos:
//  1. profundidad de las partículas como esferas (point sprites con profundidad por píxel);
//  2. filtro bilateral separable sobre esa profundidad: las gotas se funden en una superficie;
//  3. normales reconstruidas desde la profundidad suavizada;
//  4. grosor (aditivo, a media resolución);
//  5. sombreado (shade.ts): Beer-Lambert, GGX, reflejos, Fresnel y refracción del fondo.
// Es un Pass de postprocessing justo después del render y la oclusión ambiental, antes del bloom
// (los brillos húmedos florecen). La profundidad de la escena tapa la sangre que está detrás del hueso.
import { Pass } from 'postprocessing';
import {
  AdditiveBlending, Color, FloatType, HalfFloatType, LinearFilter, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry,
  Points, RGBAFormat, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Texture,
  type WebGLRenderer,
} from 'three';
import { config } from '../../config.ts';
import { ERASE_GLSL, type EraseUniforms } from '../erase.ts';
import type { Lighting } from '../lighting.ts';
import { BLOOD_SHADE_GLSL, bloodShadeUniforms, syncBloodShade } from './shade.ts';
import { PARTICLE_VERT_PARS, type BloodSim } from './sim.ts';

// Cada gota se estira en la dirección en que se mueve (como con obturación): un chorro se lee como
// un hilo continuo y una salpicadura como estelas, no como bolitas sueltas. Quieta, es redonda.
const SPRITE_VERT = /* glsl */ `
${PARTICLE_VERT_PARS}
uniform sampler2D tVel;
uniform float uRadius;
uniform float uPx;
uniform float uSizeK;
uniform float uStretchK;
uniform float uStretchMax;
varying vec3 vViewPos;
varying float vR;
varying vec2 vDir;
varying float vS;
void main() {
  vec4 p = texture2D(tPos, ref);
  if (p.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // Al final de su vida la gota se achica (se escurre, se seca).
  float r = uRadius * clamp(p.w / 0.5, 0.35, 1.0);
  vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
  vViewPos = mv.xyz;
  vR = r;
  // Velocidad en el plano de la imagen (espacio de vista).
  vec2 sv = (modelViewMatrix * vec4(texture2D(tVel, ref).xyz, 0.0)).xy;
  float sl = length(sv);
  vDir = sl > 1e-4 ? sv / sl : vec2(1.0, 0.0);
  vS = 1.0 + min(sl * uStretchK, uStretchMax);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSizeK * 2.0 * r * vS * uPx / -mv.z, 1.0, 256.0);
}
`;

const DEPTH_FRAG = /* glsl */ `
uniform mat4 uProj;
varying vec3 vViewPos;
varying float vR;
varying vec2 vDir;
varying float vS;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  // Elipse a lo largo de la velocidad: largo vS, ancho 1 (en radios de la gota).
  vec2 perp = vec2(-vDir.y, vDir.x);
  float along = dot(c, vDir);
  float across = dot(c, perp) * vS;
  float r2 = along * along + across * across;
  if (r2 > 1.0) discard;
  vec2 off = (vDir * along + perp * across / vS) * vR * vS;
  vec3 P = vViewPos + vec3(off, sqrt(1.0 - r2) * vR);
  vec4 clip = uProj * vec4(P, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  gl_FragColor = vec4(-P.z, 0.0, 0.0, 1.0);
}
`;

const THICK_FRAG = /* glsl */ `
varying float vR;
varying vec2 vDir;
varying float vS;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float along = dot(c, vDir);
  float across = dot(c, vec2(-vDir.y, vDir.x)) * vS;
  float r2 = along * along + across * across;
  if (r2 > 1.0) discard;
  // Sprite el doble de grande con caída suave: el grosor no tiene bordes duros.
  gl_FragColor = vec4(2.0 * vR * exp(-r2 * 3.2), 0.0, 0.0, 1.0);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform vec2 uTexel;
uniform float uFilterWorld;
uniform float uPx;
uniform float uRangeSigma;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float rpx = clamp(uFilterWorld * uPx / d, 1.0, 32.0);
  // Muestras desplazadas al azar por píxel: con radios grandes el salto entre muestras dejaría un
  // patrón cuadriculado; así queda ruido fino que la segunda pasada borra.
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float x = (float(i) + jit) / 10.0;
    float s = texture2D(tDepth, vUv + uDir * uTexel * x * rpx).r;
    if (s <= 0.0) continue;
    float dz = (s - d) / uRangeSigma;
    float w = exp(-x * x * 2.2) * exp(-dz * dz);
    sum += s * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / max(wsum, 1e-6), 0.0, 0.0, 1.0);
}
`;

// Grosor desenfocado (gaussiana separable, radio ~1,5 partículas en mundo): define la silueta como un
// campo continuo, así el borde no es la unión de esferas y las cuentas vecinas se unen.
const THICK_BLUR_FRAG = /* glsl */ `
uniform sampler2D tThick;
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform vec2 uTexel;
uniform float uWorld;
uniform float uPx;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  float rpx = clamp(uWorld * uPx / max(d, 0.3), 1.0, 40.0);
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float x = float(i) / 8.0;
    float w = exp(-x * x * 2.5);
    sum += texture2D(tThick, vUv + uDir * uTexel * x * rpx).r * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tSceneDepth;
uniform sampler2D tFluid;
uniform sampler2D tThick;
uniform mat4 uProjInv;
uniform float uNear;
uniform float uFar;
uniform vec2 uTexel;
uniform float uHasDepth;
uniform float uThickScale;
uniform float uRefract;
uniform float uEdge;
uniform float uDebug;
uniform vec2 uThickTexel;
uniform float uEdgeBend;
varying vec2 vUv;
${BLOOD_SHADE_GLSL}
${ERASE_GLSL}
vec3 viewPos(vec2 uv, float d) {
  vec4 q = uProjInv * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  q.xyz /= q.w;
  return q.xyz / -q.z * d;
}
void main() {
  vec4 base = texture2D(tColor, vUv);
  float d = texture2D(tFluid, vUv).r;
  if (d <= 0.0) { gl_FragColor = base; return; }
  if (uHasDepth > 0.5) {
    float zb = texture2D(tSceneDepth, vUv).r;
    float sceneDist = uNear * uFar / (uFar - zb * (uFar - uNear));
    if (zb < 1.0 && d > sceneDist + 0.012) { gl_FragColor = base; return; }
  }
  vec3 P = viewPos(vUv, d);
  vec2 ox = vec2(uTexel.x, 0.0);
  vec2 oy = vec2(0.0, uTexel.y);
  float dr = texture2D(tFluid, vUv + ox).r;
  float dl = texture2D(tFluid, vUv - ox).r;
  float du = texture2D(tFluid, vUv + oy).r;
  float dd = texture2D(tFluid, vUv - oy).r;
  vec3 ddx = dr > 0.0 ? viewPos(vUv + ox, dr) - P : vec3(0.0);
  vec3 ddx2 = dl > 0.0 ? P - viewPos(vUv - ox, dl) : vec3(0.0);
  if (dr <= 0.0 || (dl > 0.0 && abs(ddx2.z) < abs(ddx.z))) ddx = ddx2;
  vec3 ddy = du > 0.0 ? viewPos(vUv + oy, du) - P : vec3(0.0);
  vec3 ddy2 = dd > 0.0 ? P - viewPos(vUv - oy, dd) : vec3(0.0);
  if (du <= 0.0 || (dd > 0.0 && abs(ddy2.z) < abs(ddy.z))) ddy = ddy2;
  vec3 n = normalize(cross(ddx, ddy) + vec3(0.0, 0.0, 1e-7));
  if (n.z < 0.0) n = -n;
  vec3 v = normalize(-P);
  float th = texture2D(tThick, vUv).r * uThickScale;
  // Bordes redondos: donde el grosor cae, la superficie se curva hacia afuera (un chorro se lee
  // como un tubo y una gota como una gota, no como discos planos).
  float tR = texture2D(tThick, vUv + vec2(uThickTexel.x, 0.0)).r;
  float tL = texture2D(tThick, vUv - vec2(uThickTexel.x, 0.0)).r;
  float tU = texture2D(tThick, vUv + vec2(0.0, uThickTexel.y)).r;
  float tD = texture2D(tThick, vUv - vec2(0.0, uThickTexel.y)).r;
  vec2 g = vec2(tR - tL, tU - tD) * uThickScale / max(th, 1e-4);
  n = normalize(n + vec3(-g * uEdgeBend, 0.0));
  vec2 off = n.xy * uRefract * min(th, 0.03) * 1.6;
  vec3 bg = texture2D(tColor, vUv + off).rgb;
  vec3 col = bl_shade(n, v, th, bg, 0.0);
  float a = smoothstep(uEdge * 0.6, uEdge * 1.6, th);
  // Vistas de depuración (debug.bloodView): 1 profundidad, 2 normales, 3 grosor.
  if (uDebug > 0.5) {
    if (uDebug < 1.5) col = vec3(fract(d * 20.0));
    else if (uDebug < 2.5) col = n * 0.5 + 0.5;
    else col = vec3(th * 40.0);
    a = 1.0;
  }
  // Borrado (§9.6): se desatura y el trapeador la limpia (erase.ts).
  col = er_desat(col) + vec3(0.55) * er_front(vUv) * uEraseDesat;
  a *= 1.0 - er_clear(vUv);
  gl_FragColor = vec4(mix(base.rgb, col, a), base.a);
}
`;

const tmpColor = new Color();

export class BloodPass extends Pass {
  /** Fracción de la resolución del composer (½ en LOW/MED, §15). */
  scale = 1;
  refraction = true;
  private sim: BloodSim | null = null;
  private sceneDepth: Texture | null = null;
  private viewCamera: PerspectiveCamera;
  private lighting: Lighting;
  private w = 1;
  private h = 1;
  private depthRT: WebGLRenderTarget;
  private blurA: WebGLRenderTarget;
  private blurB: WebGLRenderTarget;
  private thickRT: WebGLRenderTarget;
  private thickA: WebGLRenderTarget;
  private thickB: WebGLRenderTarget;
  private thickBlurMat: ShaderMaterial;
  private pointsScene = new Scene();
  private points: Points | null = null;
  private sphereMat: ShaderMaterial;
  private thickMat: ShaderMaterial;
  private quadScene = new Scene();
  private quad: Mesh;
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blurMat: ShaderMaterial;
  private compMat: ShaderMaterial;

  constructor(camera: PerspectiveCamera, lighting: Lighting, floatTargets: boolean, erase: EraseUniforms) {
    super('BloodPass');
    this.needsDepthTexture = true;
    this.viewCamera = camera;
    this.lighting = lighting;
    const depthOpts = {
      type: floatTargets ? FloatType : HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter,
    };
    this.depthRT = new WebGLRenderTarget(1, 1, { ...depthOpts, depthBuffer: true });
    this.blurA = new WebGLRenderTarget(1, 1, { ...depthOpts, depthBuffer: false });
    this.blurB = new WebGLRenderTarget(1, 1, { ...depthOpts, depthBuffer: false });
    this.thickRT = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
    });
    const thickOpts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.thickA = new WebGLRenderTarget(1, 1, thickOpts);
    this.thickB = new WebGLRenderTarget(1, 1, thickOpts);
    this.thickBlurMat = new ShaderMaterial({
      uniforms: {
        tThick: { value: null }, tDepth: { value: null }, uDir: { value: new Vector2(1, 0) }, uTexel: { value: new Vector2() },
        uWorld: { value: 0.012 }, uPx: { value: 300 },
      },
      vertexShader: QUAD_VERT, fragmentShader: THICK_BLUR_FRAG, depthTest: false, depthWrite: false,
    });
    const spriteUniforms = () => ({
      tPos: { value: null }, tVel: { value: null }, uRadius: { value: 0.01 }, uPx: { value: 500 }, uSizeK: { value: 1 },
      uStretchK: { value: 0.5 }, uStretchMax: { value: 3 },
    });
    this.sphereMat = new ShaderMaterial({
      uniforms: { ...spriteUniforms(), uProj: { value: camera.projectionMatrix } },
      vertexShader: SPRITE_VERT, fragmentShader: DEPTH_FRAG, depthTest: true, depthWrite: true,
    });
    this.thickMat = new ShaderMaterial({
      uniforms: spriteUniforms(), vertexShader: SPRITE_VERT, fragmentShader: THICK_FRAG,
      blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.blurMat = new ShaderMaterial({
      uniforms: {
        tDepth: { value: null }, uDir: { value: new Vector2(1, 0) }, uTexel: { value: new Vector2() },
        uFilterWorld: { value: 0.02 }, uPx: { value: 500 }, uRangeSigma: { value: 0.02 },
      },
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    });
    this.compMat = new ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tSceneDepth: { value: null }, tFluid: { value: null }, tThick: { value: null },
        uProjInv: { value: camera.projectionMatrixInverse }, uNear: { value: 0.05 }, uFar: { value: 40 },
        uTexel: { value: new Vector2() }, uHasDepth: { value: 0 }, uThickScale: { value: 1 }, uRefract: { value: 1 },
        uEdge: { value: 0.004 }, uDebug: { value: 0 }, uThickTexel: { value: new Vector2() },
        uEdgeBend: { value: 1 },
        ...bloodShadeUniforms(),
        ...erase,
      },
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.blurMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSim(sim: BloodSim): void {
    this.sim = sim;
    if (this.points) this.pointsScene.remove(this.points);
    this.points = new Points(sim.points, this.sphereMat);
    this.points.frustumCulled = false;
    this.pointsScene.add(this.points);
  }

  override setDepthTexture(depthTexture: Texture | null): void {
    this.sceneDepth = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.resizeTargets();
  }

  setScale(s: number): void {
    this.scale = s;
    this.resizeTargets();
  }

  private resizeTargets(): void {
    const fw = Math.max(1, Math.round(this.w * this.scale));
    const fh = Math.max(1, Math.round(this.h * this.scale));
    this.depthRT.setSize(fw, fh);
    this.blurA.setSize(fw, fh);
    this.blurB.setSize(fw, fh);
    const tw = Math.max(1, Math.round(this.w * 0.5));
    const th = Math.max(1, Math.round(this.h * 0.5));
    this.thickRT.setSize(tw, th);
    this.thickA.setSize(tw, th);
    this.thickB.setSize(tw, th);
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget): void {
    const sim = this.sim;
    const target = this.renderToScreen ? null : outputBuffer;
    const cam = this.viewCamera;
    const B = config.blood;
    renderer.getClearColor(tmpColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    const comp = this.compMat.uniforms;
    comp.tColor.value = inputBuffer.texture;
    if (!sim || !this.points) {
      comp.tFluid.value = null;
      this.blit(renderer, target);
      renderer.setClearColor(tmpColor, clearAlpha);
      return;
    }
    const fh = this.depthRT.height;
    const pxDepth = cam.projectionMatrix.elements[5] * fh * 0.5;
    const pxThick = cam.projectionMatrix.elements[5] * this.thickRT.height * 0.5;

    // 1 · profundidad de esferas
    const su = this.sphereMat.uniforms;
    su.tPos.value = sim.posTexture;
    su.tVel.value = sim.velTexture;
    su.uStretchK.value = B.stretch;
    su.uStretchMax.value = B.stretchMax;
    su.uRadius.value = sim.radius;
    su.uPx.value = pxDepth;
    su.uProj.value = cam.projectionMatrix;
    this.points.material = this.sphereMat;
    renderer.setRenderTarget(this.depthRT);
    renderer.clear(true, true, false);
    renderer.render(this.pointsScene, cam);

    // 2 · grosor
    const tu = this.thickMat.uniforms;
    tu.tPos.value = sim.posTexture;
    tu.tVel.value = sim.velTexture;
    tu.uStretchK.value = B.stretch;
    tu.uStretchMax.value = B.stretchMax;
    tu.uRadius.value = sim.radius;
    tu.uPx.value = pxThick;
    tu.uSizeK.value = 2;
    this.points.material = this.thickMat;
    renderer.setRenderTarget(this.thickRT);
    renderer.clear(true, false, false);
    renderer.render(this.pointsScene, cam);

    // 3 · suavizado bilateral separable, dos iteraciones (la segunda más fina): las esferas se
    // funden en una superficie sin perder los bordes contra lo que está detrás.
    const bu = this.blurMat.uniforms;
    bu.uTexel.value.set(1 / this.depthRT.width, 1 / fh);
    bu.uPx.value = pxDepth;
    bu.uRangeSigma.value = sim.radius * B.smoothingRange;
    this.quad.material = this.blurMat;
    let src: WebGLRenderTarget = this.depthRT;
    for (const k of [1, 0.55]) {
      bu.uFilterWorld.value = sim.radius * B.smoothing * k;
      bu.tDepth.value = src.texture;
      bu.uDir.value.set(1, 0);
      renderer.setRenderTarget(this.blurA);
      renderer.render(this.quadScene, this.quadCam);
      bu.tDepth.value = this.blurA.texture;
      bu.uDir.value.set(0, 1);
      renderer.setRenderTarget(this.blurB);
      renderer.render(this.quadScene, this.quadCam);
      // La segunda iteración lee B (horizontal → A) y después A (vertical → B).
      src = this.blurB;
    }

    // 3b · grosor desenfocado (silueta continua)
    const tb = this.thickBlurMat.uniforms;
    tb.tDepth.value = this.blurB.texture;
    tb.uTexel.value.set(1 / this.thickRT.width, 1 / this.thickRT.height);
    tb.uWorld.value = sim.radius * B.edgeSmooth;
    tb.uPx.value = pxThick;
    this.quad.material = this.thickBlurMat;
    tb.tThick.value = this.thickRT.texture;
    tb.uDir.value.set(1, 0);
    renderer.setRenderTarget(this.thickA);
    renderer.render(this.quadScene, this.quadCam);
    tb.tThick.value = this.thickA.texture;
    tb.uDir.value.set(0, 1);
    renderer.setRenderTarget(this.thickB);
    renderer.render(this.quadScene, this.quadCam);

    // 4-5 · sombreado y composición
    comp.tFluid.value = this.blurB.texture;
    comp.tThick.value = this.thickB.texture;
    comp.tSceneDepth.value = this.sceneDepth;
    comp.uHasDepth.value = this.sceneDepth ? 1 : 0;
    comp.uProjInv.value = cam.projectionMatrixInverse;
    comp.uNear.value = cam.near;
    comp.uFar.value = cam.far;
    comp.uTexel.value.set(1 / this.depthRT.width, 1 / fh);
    comp.uThickScale.value = B.thickness;
    comp.uRefract.value = this.refraction ? B.refraction : 0;
    comp.uEdge.value = sim.radius * 0.5;
    comp.uThickTexel.value.set(1 / this.thickRT.width, 1 / this.thickRT.height);
    comp.uEdgeBend.value = B.edgeBend;
    comp.uDebug.value = ['ninguna', 'profundidad', 'normales', 'grosor'].indexOf(config.debug.bloodView);
    syncBloodShade(comp as unknown as Parameters<typeof syncBloodShade>[0], this.lighting, cam);
    this.blit(renderer, target);
    renderer.setClearColor(tmpColor, clearAlpha);
  }

  private blit(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    this.quad.material = this.compMat;
    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCam);
  }
}
