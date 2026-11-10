// Órganos translúcidos (§6) y cartílago: misma óptica de rayos X con más "volumen".
// El corazón suma un pulso de brillo con el latido y un rastro rojo muy tenue (§1.2).
import { AdditiveBlending, Color, FrontSide, ShaderMaterial } from 'three';
import { config } from '../../config.ts';
import { NOISE_GLSL, REVEAL_COLOR, REVEAL_GLSL, XRAY_VERTEX, revealUniforms, PLATE, PLATE_FILL } from './glsl.ts';

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uPower;
uniform float uIntensity;
uniform float uBase;
uniform float uOpacity;
uniform float uBeat;
uniform float uPlate;
uniform float uPlateFill;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObjPos;
${NOISE_GLSL}
${REVEAL_GLSL}
void main() {
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(vViewPos);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, uPower);
  float body = pow(ndv, 3.0) * 0.35; // densidad en el centro: el órgano tiene masa
  float tex = 0.8 + 0.4 * dn_fbm(vObjPos * 60.0);
  float a = (uBase + body + fres * uIntensity) * tex * uOpacity * (1.0 + uBeat * 0.8);
  // Placa real: el órgano es una sombra de densidad, sin contorno brillante.
  a = mix(a, uPlateFill * pow(ndv, 1.0) * tex * (1.0 + uBeat * 0.3) * uOpacity * 4.0, uPlate);
  vec3 col = mix(uColor, uTint, uTintAmount * (0.4 + 0.6 * uBeat) * body * 2.5);
  gl_FragColor = vec4(col * a * dn_revealMask(vObjPos.y) + ${REVEAL_COLOR} * dn_revealBand(vObjPos.y) * 0.3, 1.0);
}
`;

export function createXrayOrganMaterial(kind: 'heart' | 'lungs' | 'liver' | 'cartilage'): ShaderMaterial {
  const m = new ShaderMaterial({
    name: `xrayOrgan_${kind}`,
    uniforms: {
      uColor: { value: new Color(config.organs.color) },
      uTint: { value: new Color(config.heart.tint) },
      uTintAmount: { value: 0 },
      uPower: { value: config.organs.fresnelPower },
      uIntensity: { value: config.organs.intensity },
      uBase: { value: config.organs.base },
      uOpacity: { value: config.organs.opacity },
      uBeat: { value: 0 },
      uPlate: PLATE,
      uPlateFill: PLATE_FILL.organ,
      ...revealUniforms(),
    },
    vertexShader: XRAY_VERTEX,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
  });
  m.userData.kind = kind;
  return m;
}

/** `tint` 0..1 escala el rastro rojo del corazón (el borrado lo apaga, §9.6). */
export function syncXrayOrgan(m: ShaderMaterial, fade: number, beat = 0, tint = 1): void {
  const c = config.organs;
  const u = m.uniforms;
  const kind = m.userData.kind as string;
  u.uPower.value = c.fresnelPower;
  u.uIntensity.value = c.intensity;
  u.uBase.value = c.base;
  if (kind === 'cartilage') {
    u.uColor.value.set(config.cartilage.color);
    u.uOpacity.value = config.cartilage.opacity * fade;
  } else {
    u.uColor.value.set(c.color);
    const op = kind === 'heart' ? c.heartOpacity : kind === 'lungs' ? c.lungOpacity : c.liverOpacity;
    u.uOpacity.value = op * fade;
  }
  if (kind === 'heart') {
    u.uTint.value.set(config.heart.tint);
    u.uTintAmount.value = config.heart.tintAmount * tint;
    u.uBeat.value = beat;
  }
}
