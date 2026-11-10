// Piel translúcida de placa radiográfica (§6): fresnel, borde brillante, centro casi
// invisible, aditiva y sin escribir profundidad.
import { AdditiveBlending, Color, FrontSide, ShaderMaterial } from 'three';
import { config } from '../../config.ts';
import { NOISE_GLSL, PLATE, PLATE_FILL, REVEAL_COLOR, REVEAL_GLSL, XRAY_VERTEX, revealUniforms } from './glsl.ts';

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uIntensity;
uniform float uBase;
uniform float uFill;
uniform float uOpacity;
uniform float uPlate;
uniform float uPlateFill;
uniform float uPlateEdge;
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
  // Leve variación de "densidad" para que no parezca un sólido liso.
  float tex = 0.85 + 0.3 * dn_fbm(vObjPos * 38.0);
  float fill = uFill * pow(ndv, 1.5);
  // Placa real: gris por espesor (más claro donde el cuerpo es más grueso) y apenas un filo en el contorno.
  fill = mix(fill, uPlateFill * pow(ndv, 0.8), uPlate);
  fres = mix(fres * uIntensity, pow(1.0 - ndv, 6.0) * uPlateEdge, uPlate);
  float a = (uBase + fill + fres) * tex * uOpacity;
  gl_FragColor = vec4(uColor * a * dn_revealMask(vObjPos.y) + ${REVEAL_COLOR} * dn_revealBand(vObjPos.y) * 0.5, 1.0);
}
`;

export function createXraySkinMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'xraySkin',
    uniforms: {
      uColor: { value: new Color(config.skin.color) },
      uPower: { value: config.skin.fresnelPower },
      uIntensity: { value: config.skin.intensity },
      uBase: { value: config.skin.base },
      uFill: { value: config.skin.fill },
      uOpacity: { value: 1 },
      uPlate: PLATE,
      uPlateFill: PLATE_FILL.skin,
      uPlateEdge: PLATE_FILL.skinEdge,
      ...revealUniforms(),
    },
    vertexShader: XRAY_VERTEX,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    side: FrontSide,
  });
}

export function syncXraySkin(m: ShaderMaterial, fade: number): void {
  const c = config.skin;
  m.uniforms.uColor.value.set(c.color);
  m.uniforms.uPower.value = c.fresnelPower;
  m.uniforms.uIntensity.value = c.intensity;
  m.uniforms.uBase.value = c.base;
  m.uniforms.uFill.value = c.fill;
  m.uniforms.uOpacity.value = c.opacity * fade;
}
