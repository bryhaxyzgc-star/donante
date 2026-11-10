// Musculatura fantasma (§6): fresnel más débil, opacidad 0,15 y fibras sugeridas
// con ruido anisótropo a lo largo de la dirección de cada músculo.
import { AdditiveBlending, Color, FrontSide, ShaderMaterial } from 'three';
import { config } from '../../config.ts';
import { NOISE_GLSL, PERTURB_GLSL, REVEAL_COLOR, REVEAL_GLSL, XRAY_VERTEX, revealUniforms, PLATE, PLATE_FILL } from './glsl.ts';

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uIntensity;
uniform float uBase;
uniform float uOpacity;
uniform float uFiberScale;
uniform float uFiberStrength;
uniform float uPlate;
uniform float uPlateFill;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying vec3 vFiber;
${NOISE_GLSL}
${PERTURB_GLSL}
${REVEAL_GLSL}
void main() {
  vec3 dir = normalize(vFiber);
  // Comprimir el ruido a lo largo de la fibra → estrías paralelas.
  vec3 q = vObjPos - dir * dot(vObjPos, dir) * 0.94;
  float fib = dn_vnoise(q * uFiberScale) * 0.65 + dn_vnoise(q * uFiberScale * 2.7) * 0.35;
  vec3 n = normalize(vNormalV);
  float face = gl_FrontFacing ? 1.0 : -1.0;
  n = dn_perturbNormal(-vViewPos, n, vec2(dFdx(fib), dFdy(fib)) * 0.6 * uFiberStrength, face);
  vec3 v = normalize(vViewPos);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, uPower);
  float stripes = mix(1.0, 0.35 + 1.3 * fib, uFiberStrength);
  // Placa real: el músculo es masa (centro más denso), no un contorno encendido.
  float a = mix((uBase + fres * uIntensity) * stripes * uOpacity, uPlateFill * pow(ndv, 1.2) * mix(1.0, stripes, 0.4), uPlate);
  gl_FragColor = vec4(uColor * a * dn_revealMask(vObjPos.y) + ${REVEAL_COLOR} * dn_revealBand(vObjPos.y) * 0.25, 1.0);
}
`;

export function createXrayMuscleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'xrayMuscle',
    defines: { USE_FIBER: '' },
    uniforms: {
      uColor: { value: new Color(config.muscle.color) },
      uPower: { value: config.muscle.fresnelPower },
      uIntensity: { value: config.muscle.intensity },
      uBase: { value: config.muscle.base },
      uOpacity: { value: config.muscle.opacity },
      uFiberScale: { value: config.muscle.fiberScale },
      uFiberStrength: { value: config.muscle.fiberStrength },
      uPlate: PLATE,
      uPlateFill: PLATE_FILL.muscle,
      ...revealUniforms(),
    },
    vertexShader: XRAY_VERTEX,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
  });
}

export function syncXrayMuscle(m: ShaderMaterial, fade: number): void {
  const c = config.muscle;
  const u = m.uniforms;
  u.uColor.value.set(c.color);
  u.uPower.value = c.fresnelPower;
  u.uIntensity.value = c.intensity;
  u.uBase.value = c.base;
  u.uOpacity.value = c.opacity * fade;
  u.uFiberScale.value = c.fiberScale;
  u.uFiberStrength.value = c.fiberStrength;
}
