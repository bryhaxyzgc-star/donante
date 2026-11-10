// Sombreado común de la sangre (§10.2 paso 5): absorción Beer-Lambert (#b3001b fino → #4a0000
// espeso), especular GGX fuerte (rugosidad 0,08), reflejos de un "quirófano" analítico (luz cenital
// fría y dos tiras laterales, como el entorno de la escena) y Fresnel. Lo usan el SSFR, el charco
// y las manchas. `coag` 0..1 oscurece y quita brillo (coagulación).
import { Color, Vector3, type Camera } from 'three';
import { config } from '../../config.ts';
import type { Lighting } from '../lighting.ts';

import { PLATE } from '../materials/glsl.ts';

export const BLOOD_SHADE_GLSL = /* glsl */ `
uniform vec3 uBlThin;
uniform vec3 uBlThick;
uniform vec3 uBlAbsorb;
uniform vec3 uBlKeyDir;
uniform vec3 uBlKeyCol;
uniform vec3 uBlRimLDir;
uniform vec3 uBlRimRDir;
uniform vec3 uBlRimCol;
uniform float uBlRough;
uniform float uBlSpec;
uniform float uBlEnv;
uniform float uBlFlat;

float bl_ggx(vec3 n, vec3 v, vec3 l, float rough) {
  vec3 h = normalize(v + l);
  float nh = max(dot(n, h), 0.0);
  float nl = max(dot(n, l), 0.0);
  float nv = max(dot(n, v), 1e-3);
  float a = rough * rough;
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * d * d);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  float vh = max(dot(v, h), 0.0);
  float F = 0.025 + 0.975 * pow(1.0 - vh, 5.0);
  return min(D * G * F / (4.0 * nv), 80.0);
}

// Entorno de quirófano: cenital frío, tiras laterales y un piso muy oscuro.
vec3 bl_env(vec3 r) {
  float top = pow(max(r.y, 0.0), 14.0) * 2.4 + pow(max(r.y, 0.0), 3.0) * 0.14;
  // Tiras laterales anchas: un chorro vertical (normales horizontales) también se ve mojado.
  float side = (pow(max(-r.x, 0.0), 10.0) * 1.2 + pow(max(r.x, 0.0), 10.0) * 1.0) * smoothstep(-0.5, 0.4, r.y + 0.2);
  float front = pow(max(r.z, 0.0), 14.0) * 0.5;
  return vec3(0.82, 0.9, 1.0) * (top + side + front) + vec3(0.012);
}

// n, v y las direcciones de luz en el mismo espacio; bg: lo que hay detrás (refractado).
vec3 bl_shade(vec3 n, vec3 v, float thick, vec3 bg, float coag) {
  float rough = mix(uBlRough, 0.6, coag);
  float dens = 1.0 - exp(-thick * 90.0);
  vec3 albedo = mix(uBlThin, uBlThick, dens) * (1.0 - 0.6 * coag);
  vec3 T = exp(-uBlAbsorb * thick);
  float wrap = max(dot(n, uBlKeyDir) * 0.5 + 0.5, 0.0);
  // La sangre dispersa luz por dentro: nunca queda negra (carmesí profundo, no marrón).
  vec3 body = albedo * (0.42 + 0.95 * wrap * wrap) + bg * T * (1.0 - coag);
  float nv = clamp(dot(n, v), 0.0, 1.0);
  float F = 0.025 + 0.975 * pow(1.0 - nv, 5.0);
  float shine = uBlSpec * (1.0 - 0.85 * coag);
  vec3 spec = (uBlKeyCol * bl_ggx(n, v, uBlKeyDir, rough)
    + uBlRimCol * (bl_ggx(n, v, uBlRimLDir, rough) + bl_ggx(n, v, uBlRimRDir, rough))) * shine;
  vec3 env = bl_env(reflect(-v, n)) * F * uBlEnv * (1.0 - 0.8 * coag);
  // Placa real: sangre plana, sin brillo ni reflejos: solo su color, más oscuro donde es más gruesa.
  vec3 flatCol = mix(uBlThin, uBlThick, dens) * (1.0 - 0.45 * coag);
  return mix(body * (1.0 - F) + spec + env, flatCol, uBlFlat);
}
`;

export function bloodShadeUniforms() {
  return {
    uBlThin: { value: new Color() },
    uBlThick: { value: new Color() },
    uBlAbsorb: { value: new Vector3() },
    uBlKeyDir: { value: new Vector3(0, 1, 0) },
    uBlKeyCol: { value: new Color() },
    uBlRimLDir: { value: new Vector3(-1, 0, 0) },
    uBlRimRDir: { value: new Vector3(1, 0, 0) },
    uBlRimCol: { value: new Color() },
    uBlRough: { value: 0.08 },
    uBlSpec: { value: 1 },
    uBlEnv: { value: 1 },
    uBlFlat: PLATE,
  };
}

type ShadeUniforms = ReturnType<typeof bloodShadeUniforms>;
const tmp = new Vector3();

/** Copia config + luces de la escena a los uniforms. Con `camera`, las direcciones van en espacio
 *  de vista (SSFR); sin ella, en mundo (charco, manchas). */
export function syncBloodShade(u: ShadeUniforms, lighting: Lighting, camera?: Camera): void {
  const B = config.blood;
  const L = config.lighting;
  u.uBlThin.value.set(B.thinColor);
  u.uBlThick.value.set(B.thickColor);
  u.uBlAbsorb.value.set(B.absorbR, B.absorbG, B.absorbB);
  u.uBlRough.value = B.roughness;
  u.uBlSpec.value = B.specular;
  u.uBlEnv.value = B.envReflection;
  u.uBlKeyCol.value.set(L.keyColor).multiplyScalar(L.keyIntensity * 0.4);
  u.uBlRimCol.value.set(L.rimColor).multiplyScalar(L.rimIntensity * 0.25);
  const dirs = lighting.directions();
  for (const [dst, src] of [[u.uBlKeyDir, dirs.key], [u.uBlRimLDir, dirs.rimL], [u.uBlRimRDir, dirs.rimR]] as const) {
    tmp.copy(src);
    if (camera) tmp.transformDirection(camera.matrixWorldInverse);
    dst.value.copy(tmp).normalize();
  }
}
