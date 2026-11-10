// Fragmentos GLSL compartidos por los materiales.

/** Ruido de valor 3D + fbm (hash "sin seno" estilo Dave Hoskins). */
export const NOISE_GLSL = /* glsl */ `
float dn_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float dn_vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = dn_hash13(i);
  float b = dn_hash13(i + vec3(1.0, 0.0, 0.0));
  float c = dn_hash13(i + vec3(0.0, 1.0, 0.0));
  float d = dn_hash13(i + vec3(1.0, 1.0, 0.0));
  float e = dn_hash13(i + vec3(0.0, 0.0, 1.0));
  float f1 = dn_hash13(i + vec3(1.0, 0.0, 1.0));
  float g = dn_hash13(i + vec3(0.0, 1.0, 1.0));
  float h = dn_hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
float dn_fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * dn_vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`;

/** Bump sin UVs a partir de una altura escalar (derivadas de pantalla). */
export const PERTURB_GLSL = /* glsl */ `
vec3 dn_perturbNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

/** Barrido de escáner (§9.2): lo que está por encima de `uRevealY` (espacio de modelo, Y arriba)
 *  ya fue revelado; una banda de luz blanca marca la línea del barrido. */
export const REVEAL_GLSL = /* glsl */ `
uniform float uRevealY;
uniform float uRevealGlow;
float dn_revealMask(float y) { return step(uRevealY, y); }
float dn_revealBand(float y) { float d = (y - uRevealY) / 0.016; return exp(-d * d) * uRevealGlow; }
`;

export const REVEAL_COLOR = 'vec3(0.82, 0.9, 1.0)';

/** Uniforms del barrido con valores neutros (todo visible, sin banda). */
export function revealUniforms(): { uRevealY: { value: number }; uRevealGlow: { value: number } } {
  return { uRevealY: { value: -10 }, uRevealGlow: { value: 0 } };
}

/** Estiramiento a lo largo de un eje desde un pivote (el hocico del cerdo que se alarga, §9.4).
 *  `uStretch` = 1 no cambia nada; < 1 comprime lo que está por delante del pivote. */
export const STRETCH_PARS_GLSL = /* glsl */ `
uniform float uStretch;
uniform vec3 uStretchPivot;
uniform vec3 uStretchAxis;
vec3 dn_stretch(vec3 p) {
  return p + uStretchAxis * max(dot(p - uStretchPivot, uStretchAxis), 0.0) * (uStretch - 1.0);
}
`;

/** Disolución por ruido o "crecimiento" radial desde un centro (`uRadial` = 1), §9.4. */
export const DISSOLVE_GLSL = /* glsl */ `
uniform float uDissolve;
uniform float uRadial;
uniform vec3 uGrowCenter;
uniform float uGrowRadius;
float dn_dissolveValue(vec3 p) {
  float n = dn_vnoise(p * 90.0) * 0.7 + dn_vnoise(p * 260.0) * 0.3;
  float r = 1.0 - clamp(distance(p, uGrowCenter) / uGrowRadius, 0.0, 1.0);
  return mix(n, r * 0.82 + n * 0.18, uRadial);
}
`;

/** Vertex shader común de las capas translúcidas (skinning, morph targets y estiramiento opcionales). */
/** Placa real (0..1), compartido por todos los materiales de rayos X: un solo valor por frame. */
export const PLATE = { value: 0 };
export const PLATE_FILL = { skin: { value: 0 }, skinEdge: { value: 0 }, muscle: { value: 0 }, organ: { value: 0 } };

export const XRAY_VERTEX = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#ifdef USE_STRETCH
${STRETCH_PARS_GLSL}
#endif
#ifdef USE_FIBER
attribute vec3 fiber;
varying vec3 vFiber;
#endif
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObjPos;
void main() {
  #include <morphinstance_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #ifdef USE_STRETCH
  transformed = dn_stretch(transformed);
  #endif
  // Espacio de modelo ya deformado (morph), antes del skinning: el ruido y el barrido lo siguen.
  vObjPos = transformed;
  #include <skinning_vertex>
  #include <project_vertex>
  vNormalV = normalize(transformedNormal);
  vViewPos = -mvPosition.xyz;
  #ifdef USE_FIBER
  vFiber = fiber;
  #endif
}
`;
