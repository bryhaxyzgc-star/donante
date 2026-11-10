// Carne húmeda (§10.6): MeshPhysicalMaterial rojo profundo con clearcoat 1, sheen rosado leve,
// micro-relieve de tejido procedural (sin UVs) y una aproximación de subsurface (luz envolvente que
// tiñe de rojo los bordes iluminados). `uBlood` 1 = cubierto de sangre (oscuro y brillante),
// 0 = limpio y pálido: lo usa el corazón (heart.ts) y los vasos. `uXray` 0→1: la carne se vuelve
// placa (se enfría, se le enciende el borde de fresnel y se desvanece) al entrar en el receptor.
// Siempre transparente (con opacidad 1): cambiar `transparent` recompilaría el shader en plena escena.
import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { config } from '../../config.ts';
import { NOISE_GLSL, PERTURB_GLSL, PLATE } from './glsl.ts';

export type FleshMaterial = MeshPhysicalMaterial & {
  userData: { uniforms: { uBlood: { value: number }; uScale: { value: number }; uXray: { value: number } } };
};

export function createFleshMaterial(opts: { vessel?: boolean } = {}): FleshMaterial {
  const C = config.cinematic;
  const m = new MeshPhysicalMaterial({
    name: opts.vessel ? 'vaso' : 'carne',
    color: new Color(opts.vessel ? C.vesselColor : C.fleshColor),
    roughness: 0.22,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.45,
    sheenRoughness: 0.5,
    sheenColor: new Color('#ff8a9a'),
    emissive: new Color('#3a0006'),
    emissiveIntensity: 0.35,
    envMapIntensity: 1.1,
    side: opts.vessel ? DoubleSide : FrontSide,
    transparent: true,
  }) as FleshMaterial;
  const uniforms = { uBlood: { value: 1 }, uScale: { value: 140 }, uXray: { value: 0 }, uPlate: PLATE };
  m.userData = { uniforms };
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObjPos;
uniform float uBlood;
uniform float uScale;
uniform float uXray;
uniform float uPlate;
${NOISE_GLSL}
${PERTURB_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Tejido: fibras y vasitos (ruido estirado) y manchas de sangre más oscura donde se junta.
float dnT = dn_fbm(vObjPos * vec3(uScale, uScale * 0.45, uScale));
float dnPool = smoothstep(0.45, 0.75, dn_fbm(vObjPos * 38.0 + 3.1));
diffuseColor.rgb *= mix(0.78, 1.12, dnT);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.32, 0.35), dnPool * uBlood);
// Hacia la placa: el color se enfría al gris azulado de los rayos X.
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.35, 0.4), uXray);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// Con sangre: casi espejo; limpio: tejido satinado.
roughnessFactor = mix(0.48, 0.14, uBlood) + (dnT - 0.5) * 0.12;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = dn_perturbNormal(-vViewPosition, normal, vec2(dFdx(dnT), dFdy(dnT)) * 0.5, faceDirection);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Subsurface aproximado: los bordes contra la luz se encienden de rojo.
float dnWrap = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
totalEmissiveRadiance += vec3(0.42, 0.02, 0.04) * dnWrap * 0.6 * (1.0 - uXray);
// El borde se enciende como en la placa (fresnel frío) mientras la carne se vuelve rayos X.
float dnFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 1.8);
totalEmissiveRadiance += vec3(0.62, 0.74, 0.86) * dnFres * uXray * 1.8;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
// Placa real: el corazón es una mancha roja plana (con un poco de volumen), sin brillo.
if (uPlate > 0.0) {
  float pN = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  vec3 pc = diffuseColor.rgb * (0.5 + 0.5 * pN) * mix(1.0, 0.7, dnPool * uBlood) + vec3(0.62, 0.74, 0.86) * dnFres * uXray * 0.6;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, pc, uPlate);
}`,
      );
  };
  m.customProgramCacheKey = () => `donante-flesh-v3-${opts.vessel ? 'v' : 'h'}`;
  return m;
}

/** Sangre sobre la carne (1) → limpia (0): color, brillo y clearcoat (§10.6). */
export function setFleshBlood(m: FleshMaterial, blood: number, vessel = false): void {
  const C = config.cinematic;
  const b = Math.max(0, Math.min(1, blood));
  m.userData.uniforms.uBlood.value = b;
  m.color.set(C.fleshClean).lerp(tmpColor.set(vessel ? C.vesselColor : C.fleshColor), b);
  m.clearcoat = 0.35 + 0.65 * b;
  m.clearcoatRoughness = 0.3 - 0.24 * b;
  m.sheen = 0.25 + 0.3 * (1 - b);
}

/** Carne → rayos X (0..1): al final ya no se ve; queda el corazón de placa del receptor. */
export function setFleshXray(m: FleshMaterial, x: number): void {
  const k = Math.max(0, Math.min(1, x));
  m.userData.uniforms.uXray.value = k;
  const t = Math.min(1, Math.max(0, (k - 0.35) / 0.65));
  m.opacity = 1 - t * t * (3 - 2 * t);
  m.depthWrite = k < 0.5;
  m.clearcoat *= 1 - k;
}

const tmpColor = new Color();
