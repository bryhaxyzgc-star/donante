// Cara de cerdo en tejido blando (§9.4): hocico con disco y fosas nasales, orejas, cachetes y cuello.
// Es lo que hace que cualquiera vea un cerdo sin saber anatomía. Se dibuja como una radiografía de
// verdad: la densidad es el ESPESOR de carne que atraviesa el haz, no luz.
//  · Espesor real: con las dos caras y mezcla aditiva, cada cara de atrás suma su profundidad y cada
//    cara de adelante la resta. Lo que queda es el largo del camino por dentro de la malla: más denso en
//    el centro de la cabeza, los bordes se esfuman solos y las fosas nasales (túneles de aire) se ven
//    OSCURAS, como el aire en una placa. Por eso no hay prueba de profundidad (las densidades se suman,
//    como en los rayos X) y la aparición es por opacidad, nunca con `discard` (descompensaría el par).
//  · Un poco de contorno (fresnel) para que las orejas, que son finas, se lean.
// El hocico se estira con el del cráneo (uStretch) y la pieza crece y se disuelve con el slot `skull`.
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { config } from '../../config.ts';
import { growthUniforms } from './bone.ts';
import { NOISE_GLSL, PLATE, XRAY_VERTEX, revealUniforms } from './glsl.ts';

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uDensity;
uniform float uEdge;
uniform float uOpacity;
uniform float uPlate;
uniform float uRef;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vObjPos;
${NOISE_GLSL}
void main() {
  // Profundidad relativa al centro de la cara (uRef): términos chicos y casi siempre positivos. Con la
  // distancia absoluta (~3 m) el búfer satura antes de restar y el espesor se pierde.
  float depth = length(vViewPos) - uRef;
  // Cara de adelante: resta; de atrás: suma. La suma de todas es el espesor atravesado (m).
  float signedDepth = gl_FrontFacing ? -depth : depth;
  vec3 n = normalize(vNormalV);
  float ndv = clamp(abs(dot(n, normalize(vViewPos))), 0.0, 1.0);
  float edge = pow(1.0 - ndv, 4.0) * uEdge;
  float tex = 0.9 + 0.2 * dn_fbm(vObjPos * 45.0);
  // Fuera de la placa (primeros planos 3D de la cinemática) pesa más el contorno.
  float dens = signedDepth * uDensity * mix(0.5, 1.0, uPlate);
  float a = (dens + edge * tex * mix(1.6, 1.0, uPlate)) * uOpacity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

const center = new Vector3();
const eye = new Vector3();

export function createXrayFaceMaterial(): ShaderMaterial {
  const c = config.pigFace;
  const m = new ShaderMaterial({
    name: 'xrayFace',
    defines: { USE_STRETCH: '' },
    uniforms: {
      uColor: { value: new Color(c.color) },
      uDensity: { value: c.density },
      uEdge: { value: c.edge },
      uOpacity: { value: 0 },
      uPlate: PLATE,
      uRef: { value: 3 },
      ...growthUniforms(),
      ...revealUniforms(),
    },
    vertexShader: XRAY_VERTEX,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  // Antes de cada dibujo: distancia de la cámara al centro de la pieza (referencia de profundidad).
  m.onBeforeRender = (_r, _s, camera, geometry, object) => {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    center.copy(geometry.boundingSphere!.center).applyMatrix4(object.matrixWorld);
    m.uniforms.uRef.value = center.distanceTo(camera.getWorldPosition(eye));
  };
  return m;
}

/** `fade` 0..1 (presencia del cuerpo); `dissolve` como el de los huesos (0 visible … 1,02 disuelto). */
export function syncXrayFace(m: ShaderMaterial, fade: number, dissolve: number): void {
  const c = config.pigFace;
  m.uniforms.uColor.value.set(c.color);
  m.uniforms.uDensity.value = c.density;
  m.uniforms.uEdge.value = c.edge;
  const shown = Math.max(0, 1 - dissolve / 1.02);
  m.uniforms.uOpacity.value = c.enabled ? fade * shown * shown : 0;
}
