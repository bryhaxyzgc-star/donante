// Anillo de escaneo de ASIGNACIÓN (§9.3): gira alrededor del tórax de cada cuerpo, el brillo
// salta de uno a otro cada vez más lento y se detiene en el donante. Luz blanca, aditiva.
import { AdditiveBlending, DoubleSide, Mesh, ShaderMaterial, TorusGeometry, Vector3, type Object3D } from 'three';

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  // Segmentos que corren alrededor del anillo + un destello que barre.
  float a = vUv.x;
  float dash = smoothstep(0.35, 0.5, fract(a * 48.0 - uTime * 0.6)) * 0.45 + 0.25;
  float sweep = pow(0.5 + 0.5 * cos((a - uTime * 0.35) * 6.2831853), 24.0);
  float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float v = (dash + sweep * 1.8) * edge * uIntensity;
  gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * v, 1.0);
}
`;
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export class ScanRing {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  intensity = 0;
  target = 0;
  private time = Math.random() * 10;

  constructor() {
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(new TorusGeometry(0.2, 0.0035, 6, 160), this.mat);
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** Coloca el anillo horizontal alrededor de `center`, con el radio escalado al cuerpo. */
  place(center: Vector3, scale: number, orient?: Object3D): void {
    this.mesh.position.copy(center);
    if (orient) this.mesh.quaternion.copy(orient.getWorldQuaternion(this.mesh.quaternion));
    this.mesh.rotateX(Math.PI / 2);
    this.mesh.scale.setScalar(scale);
  }

  update(dt: number): void {
    this.time += dt;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-14 * dt));
    this.mat.uniforms.uTime.value = this.time;
    this.mat.uniforms.uIntensity.value = this.intensity;
    this.mesh.visible = this.intensity > 0.01;
  }
}
