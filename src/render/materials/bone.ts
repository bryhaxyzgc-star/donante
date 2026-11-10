// Hueso (§6, capa protagonista): PBR blanco hueso con micro-relieve procedural
// (porosidad sin UVs), rim light fuerte y emisión leve. Además, una pasada aditiva
// sin test de profundidad hace que las superposiciones se vean más brillantes,
// como en una placa real.
// Fase 4 (§9.4, §10.1):
//  - `uCrack` 0→1: grietas que se propagan desde `uCrackOrigin`. Corren por los bordes de las
//    celdas Voronoi de `uSeeds`, las mismas que definen los fragmentos (fracture.ts): el hueso se
//    parte exactamente por donde se agrietó. El borde se oscurece y deja ver médula rojiza.
//  - `uRadial` = 1: la disolución "crece" desde `uGrowCenter` (el hueso de cerdo que nace).
//  - `uStretch`: el hocico se alarga a lo largo de `uStretchAxis` desde `uStretchPivot`.
import {
  AdditiveBlending, Color, FrontSide, Matrix3, MeshPhysicalMaterial, NormalBlending, ShaderMaterial, Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { config } from '../../config.ts';
import {
  DISSOLVE_GLSL, NOISE_GLSL, PERTURB_GLSL, PLATE, REVEAL_COLOR, REVEAL_GLSL, STRETCH_PARS_GLSL, XRAY_VERTEX, revealUniforms,
} from './glsl.ts';

/** Máximo de celdas de fractura por pieza (fracture.ts usa 6–12). */
export const MAX_SEEDS = 12;
/** Semilla "apagada": tan lejos que nunca es la más cercana. */
const FAR = 1e4;

function seedArray(): Vector3[] {
  return Array.from({ length: MAX_SEEDS }, () => new Vector3(FAR, FAR, FAR));
}

export function growthUniforms() {
  return {
    uDissolve: { value: 0 },
    uRadial: { value: 0 },
    uGrowCenter: { value: new Vector3() },
    uGrowRadius: { value: 0.1 },
    uStretch: { value: 1 },
    uStretchPivot: { value: new Vector3() },
    uStretchAxis: { value: new Vector3(0, 0, 1) },
  };
}

export interface BoneUniforms extends ReturnType<typeof growthUniforms> {
  uRimColor: { value: Color };
  uRimPower: { value: number };
  uRimIntensity: { value: number };
  uMicroScale: { value: number };
  uMicroStrength: { value: number };
  uEdgeColor: { value: Color };
  uRevealY: { value: number };
  uRevealGlow: { value: number };
  uCrack: { value: number };
  uCrackOrigin: { value: Vector3 };
  uCrackRadius: { value: number };
  uSeeds: { value: Vector3[] };
  uSeedXf: { value: Matrix3 };
  uMarrow: { value: Color };
  uOpen: { value: number };
  uOpenGlow: { value: number };
  uOpenCenter: { value: Vector3 };
  uOpenRadius: { value: number };
  uPlate: { value: number };
  uPlateColor: { value: Color };
  uPlateShell: { value: number };
  uPlateFill: { value: number };
  uPlateEdge: { value: number };
}

export type BoneMaterial = MeshPhysicalMaterial & { userData: { uniforms: BoneUniforms; variant: 'bone' | 'teeth' } };

/** El receptor "se abre" un instante: los vértices cerca de `uOpenCenter` se apartan radialmente. */
const OPEN_PARS_GLSL = /* glsl */ `
uniform float uOpen;
uniform vec3 uOpenCenter;
uniform float uOpenRadius;
vec3 dn_open(vec3 p) {
  if (uOpen <= 0.0) return p;
  vec3 d = p - uOpenCenter;
  float l = length(d);
  float f = 1.0 - smoothstep(0.0, uOpenRadius, l);
  return p + d / max(l, 1e-4) * uOpen * f;
}
`;

const CRACK_GLSL = /* glsl */ `
uniform float uCrack;
uniform vec3 uCrackOrigin;
uniform float uCrackRadius;
uniform vec3 uSeeds[${MAX_SEEDS}];
uniform mat3 uSeedXf;
uniform vec3 uMarrow;
// x = grieta (oscura), y = núcleo con médula, z = halo de tensión alrededor.
vec3 dn_crack(vec3 p) {
  if (uCrack <= 0.0) return vec3(0.0);
  // Borde quebrado: la línea no es recta, tiembla a escala de milímetros.
  vec3 j = vec3(dn_vnoise(p * 310.0), dn_vnoise(p * 310.0 + 7.3), dn_vnoise(p * 310.0 + 13.1)) - 0.5;
  vec3 q = uSeedXf * (p + j * 0.0035);
  float d1 = 1e9;
  float d2 = 1e9;
  vec3 s1 = vec3(0.0);
  vec3 s2 = vec3(0.0);
  for (int i = 0; i < ${MAX_SEEDS}; i++) {
    vec3 s = uSeeds[i];
    vec3 dq = q - s;
    float d = dot(dq, dq);
    if (d < d1) { d2 = d1; s2 = s1; d1 = d; s1 = s; }
    else if (d < d2) { d2 = d; s2 = s; }
  }
  // Distancia al plano bisector entre las dos celdas más cercanas = distancia al borde.
  float edge = abs(dot(q - (s1 + s2) * 0.5, normalize(s2 - s1 + vec3(1e-6))));
  float r = distance(p, uCrackOrigin) / uCrackRadius;
  float front = uCrack * 1.3 - r;
  float reach = smoothstep(0.0, 0.06, front);
  float w = 0.0012 + 0.0019 * smoothstep(0.0, 0.5, front);
  float main = 1.0 - smoothstep(w * 0.5, w, edge);
  // Grietas finas que se ramifican cerca del impacto.
  float ridge = 1.0 - abs(dn_vnoise(q * 160.0) * 2.0 - 1.0);
  float hair = smoothstep(0.95, 0.995, ridge) * smoothstep(0.0, 0.12, uCrack * 0.45 - r);
  float crack = max(main, hair * 0.8) * reach;
  // La médula asoma solo en el centro de la grieta: borde oscuro, hilo rojo adentro.
  float core = (1.0 - smoothstep(0.0, w * 0.4, edge)) * reach * smoothstep(0.15, 0.6, front);
  float halo = (1.0 - smoothstep(w, w * 7.0, edge)) * reach * (1.0 - crack);
  return vec3(crack, core, halo);
}
`;

export function createBoneMaterial(variant: 'bone' | 'teeth' = 'bone'): BoneMaterial {
  const c = config.bone;
  const m = new MeshPhysicalMaterial({
    name: `bone_${variant}`,
    color: new Color(c.color),
    roughness: c.roughness,
    metalness: 0,
    clearcoat: c.clearcoat,
    clearcoatRoughness: 0.35,
    emissive: new Color(c.emissive),
    emissiveIntensity: c.emissiveIntensity,
    envMapIntensity: c.envIntensity,
    side: FrontSide,
  }) as BoneMaterial;
  const uniforms: BoneUniforms = {
    uRimColor: { value: new Color(c.rimColor) },
    uRimPower: { value: c.rimPower },
    uRimIntensity: { value: c.rimIntensity },
    uMicroScale: { value: c.microScale },
    uMicroStrength: { value: c.microStrength },
    uEdgeColor: { value: new Color('#dfeeff') },
    ...revealUniforms(),
    ...growthUniforms(),
    uCrack: { value: 0 },
    uCrackOrigin: { value: new Vector3() },
    uCrackRadius: { value: 0.1 },
    uSeeds: { value: seedArray() },
    uSeedXf: { value: new Matrix3() },
    uMarrow: { value: new Color(config.transform.marrowGlow) },
    uOpen: { value: 0 },
    uOpenGlow: { value: 0 },
    uOpenCenter: { value: new Vector3() },
    uOpenRadius: { value: 0.1 },
    uPlate: PLATE,
    uPlateColor: { value: new Color(config.plate.color) },
    uPlateShell: { value: config.plate.shell },
    uPlateFill: { value: config.plate.fill },
    uPlateEdge: { value: config.plate.edgeClamp },
  };
  m.userData = { uniforms, variant };
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObjPos;\n${STRETCH_PARS_GLSL}\n${OPEN_PARS_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed = dn_stretch(transformed);\nvObjPos = transformed;\ntransformed = dn_open(transformed);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObjPos;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimIntensity;
uniform float uMicroScale;
uniform float uMicroStrength;
uniform vec3 uEdgeColor;
uniform float uOpenGlow;
uniform vec3 uOpenCenter;
uniform float uOpenRadius;
uniform float uPlate;
uniform vec3 uPlateColor;
uniform float uPlateShell;
uniform float uPlateFill;
uniform float uPlateEdge;
${NOISE_GLSL}
${PERTURB_GLSL}
${REVEAL_GLSL}
${DISSOLVE_GLSL}
${CRACK_GLSL}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float dnDis = dn_dissolveValue(vObjPos);
if (dnDis < uDissolve) discard;
if (vObjPos.y < uRevealY) discard;
float dnPore = dn_fbm(vObjPos * uMicroScale);
vec3 dnCk = dn_crack(vObjPos);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= mix(0.78, 1.04, smoothstep(0.25, 0.75, dnPore));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.03, 0.03), dnCk.x);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (dnPore - 0.5) * 0.35, 0.05, 1.0);
roughnessFactor = mix(roughnessFactor, 0.9, dnCk.x);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = dn_perturbNormal(-vViewPosition, normal, vec2(dFdx(dnPore), dFdy(dnPore)) * uMicroStrength * 60.0, faceDirection);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rimNdv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
totalEmissiveRadiance += uRimColor * pow(1.0 - rimNdv, uRimPower) * uRimIntensity * (1.0 - dnCk.x);
float dnEdge = 1.0 - smoothstep(0.0, 0.035, dnDis - uDissolve);
totalEmissiveRadiance += uEdgeColor * dnEdge * step(0.001, uDissolve) * 2.5;
totalEmissiveRadiance += ${REVEAL_COLOR} * dn_revealBand(vObjPos.y) * 3.0;
totalEmissiveRadiance *= 1.0 - dnCk.x * 0.9;
totalEmissiveRadiance += uMarrow * dnCk.y * 1.6 + vec3(0.85, 0.92, 1.0) * dnCk.z * 0.22 * uCrack;
// Diafragma de luz del receptor: el hueso se enciende de blanco alrededor de por donde entra el corazón.
float dnOpenF = 1.0 - smoothstep(0.0, uOpenRadius, distance(vObjPos, uOpenCenter));
totalEmissiveRadiance += vec3(0.92, 0.97, 1.0) * uOpenGlow * dnOpenF * dnOpenF;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
// Placa real: el hueso no refleja luz, frena rayos X. La cortical pesa más donde se la mira de canto (el
// rayo la recorre más largo) y el interior queda más gris; las grietas son líneas oscuras de fractura.
if (uPlate > 0.0) {
  float pNdv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float pDens = (uPlateFill + uPlateShell / max(pNdv, uPlateEdge)) * mix(0.82, 1.12, dnPore);
  pDens *= 1.0 - dnCk.x * 0.9;
  vec3 pCol = uPlateColor * pDens;
  pCol += uMarrow * dnCk.y * 0.7;
  pCol += uEdgeColor * dnEdge * step(0.001, uDissolve) * 0.9;
  pCol += ${REVEAL_COLOR} * dn_revealBand(vObjPos.y) * 1.5;
  pCol += vec3(0.92, 0.97, 1.0) * uOpenGlow * dnOpenF * dnOpenF * 0.5;
  gl_FragColor = vec4(mix(gl_FragColor.rgb, pCol, uPlate), 1.0);
}`,
      );
  };
  m.customProgramCacheKey = () => 'donante-bone-v4';
  return m;
}

export function syncBoneMaterial(m: BoneMaterial, dissolve: number): void {
  const c = config.bone;
  const u = m.userData.uniforms;
  const teeth = m.userData.variant === 'teeth';
  m.color.set(c.color);
  if (teeth) m.color.multiplyScalar(1.05);
  m.roughness = teeth ? c.roughness * 0.5 : c.roughness;
  m.clearcoat = c.clearcoat;
  m.emissive.set(c.emissive);
  m.emissiveIntensity = c.emissiveIntensity * (teeth ? 3 : 1);
  m.envMapIntensity = c.envIntensity;
  u.uRimColor.value.set(c.rimColor);
  u.uRimPower.value = c.rimPower;
  u.uRimIntensity.value = c.rimIntensity * (teeth ? 1.3 : 1);
  u.uMicroScale.value = teeth ? c.microScale * 0.3 : c.microScale;
  u.uMicroStrength.value = teeth ? c.microStrength * 0.2 : c.microStrength;
  u.uMarrow.value.set(config.transform.marrowGlow);
  u.uDissolve.value = dissolve;
  const P = config.plate;
  u.uPlateColor.value.set(P.color);
  if (teeth) u.uPlateColor.value.multiplyScalar(1.15);
  u.uPlateShell.value = P.shell;
  u.uPlateFill.value = P.fill;
  u.uPlateEdge.value = P.edgeClamp;
  // En la placa el hueso suma densidad (aditivo, sin escribir profundidad): las superposiciones se suman.
  const plate = PLATE.value > 0.5;
  if (m.transparent !== plate) {
    m.transparent = plate;
    m.blending = plate ? AdditiveBlending : NormalBlending;
    m.depthWrite = !plate;
  }
}

/** Médula expuesta: la cara interna de los fragmentos (lado de atrás de la cáscara de hueso). */
export function styleAsMarrow(m: BoneMaterial): void {
  const u = m.userData.uniforms;
  m.color.set(config.transform.marrowColor);
  m.roughness = 0.5;
  m.clearcoat = 0.7;
  m.clearcoatRoughness = 0.12;
  m.emissive.set(config.transform.marrowColor);
  m.emissiveIntensity = 0.18;
  m.envMapIntensity = config.bone.envIntensity;
  u.uRimIntensity.value = 0;
  u.uMicroScale.value = config.bone.microScale * 1.6;
  u.uMicroStrength.value = config.bone.microStrength * 2.5;
}

// ── controles por pieza (los usa body.ts) ─────────────────────────────────

type GrowthTarget = { uniforms: ReturnType<typeof growthUniforms> };

function growthOf(m: BoneMaterial | ShaderMaterial): ReturnType<typeof growthUniforms> | null {
  const u = ((m as BoneMaterial).userData?.uniforms ?? (m as ShaderMaterial).uniforms) as GrowthTarget['uniforms'] | undefined;
  return u?.uRadial ? u : null;
}

/** Crecimiento radial (1) o disolución por ruido (0). */
export function setGrowth(m: BoneMaterial | ShaderMaterial, radial: number, center?: Vector3, radius?: number): void {
  const u = growthOf(m);
  if (!u) return;
  u.uRadial.value = radial;
  if (center) u.uGrowCenter.value.copy(center);
  if (radius) u.uGrowRadius.value = radius;
}

export function setStretch(m: BoneMaterial | ShaderMaterial, stretch: number, pivot?: Vector3, axis?: Vector3): void {
  const u = growthOf(m);
  if (!u) return;
  u.uStretch.value = stretch;
  if (pivot) u.uStretchPivot.value.copy(pivot);
  if (axis) u.uStretchAxis.value.copy(axis);
}

/** Diafragma de luz: apertura (m), brillo, centro (espacio de la pieza) y radio. */
export function setOpen(m: BoneMaterial, open: number, glow: number, center?: Vector3, radius?: number): void {
  const u = m.userData.uniforms;
  u.uOpen.value = open;
  u.uOpenGlow.value = glow;
  if (center) u.uOpenCenter.value.copy(center);
  if (radius) u.uOpenRadius.value = radius;
}

export function setCrack(m: BoneMaterial, progress: number, origin?: Vector3, radius?: number): void {
  const u = m.userData.uniforms;
  u.uCrack.value = progress;
  if (origin) u.uCrackOrigin.value.copy(origin);
  if (radius) u.uCrackRadius.value = radius;
}

/** Semillas de fractura (ya transformadas por `xf`) y la transformación anisótropa. */
export function setSeeds(m: BoneMaterial, seeds: Vector3[], xf: Matrix3): void {
  const u = m.userData.uniforms;
  for (let i = 0; i < MAX_SEEDS; i++) {
    if (i < seeds.length) u.uSeeds.value[i].copy(seeds[i]);
    else u.uSeeds.value[i].set(FAR, FAR, FAR);
  }
  u.uSeedXf.value.copy(xf);
}

// ── Pasada aditiva de "densidad radiográfica" ────────────────────────────────

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uIntensity;
uniform float uBase;
${REVEAL_GLSL}
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObjPos;
${NOISE_GLSL}
${DISSOLVE_GLSL}
void main() {
  float dnDis = dn_dissolveValue(vObjPos);
  if (dnDis < uDissolve) discard;
  if (vObjPos.y < uRevealY) discard;
  vec3 n = normalize(vNormalV);
  float ndv = clamp(abs(dot(n, normalize(vViewPos))), 0.0, 1.0);
  float a = uBase + pow(1.0 - ndv, uPower) * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

export function createBoneGlowMaterial(): ShaderMaterial {
  const g = config.boneGlow;
  return new ShaderMaterial({
    name: 'boneGlow',
    defines: { USE_STRETCH: '' },
    uniforms: {
      uColor: { value: new Color(g.color) },
      uPower: { value: g.fresnelPower },
      uIntensity: { value: g.intensity },
      uBase: { value: g.base },
      ...growthUniforms(),
      ...revealUniforms(),
    },
    vertexShader: XRAY_VERTEX,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    side: FrontSide,
  });
}

export function syncBoneGlow(m: ShaderMaterial, dissolve: number): void {
  const g = config.boneGlow;
  m.uniforms.uColor.value.set(g.color);
  m.uniforms.uPower.value = g.fresnelPower;
  // En la placa la densidad ya la da el propio hueso: esta pasada se apaga.
  m.uniforms.uIntensity.value = g.intensity * (1 - PLATE.value);
  m.uniforms.uBase.value = g.base * (1 - PLATE.value);
  m.uniforms.uDissolve.value = dissolve;
}
