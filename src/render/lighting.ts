// Luz de quirófano: entorno suave + luz principal cenital fría + dos contraluces
// azulados que recortan los huesos. HDRI de Poly Haven pendiente (TODO-ASSETS.md):
// mientras tanto, RoomEnvironment de three (procedural, sin descargas).
import { DirectionalLight, Group, PMREMGenerator, Vector3, type Scene, type Texture, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { config } from '../config.ts';

export class Lighting {
  readonly group = new Group();
  private key: DirectionalLight;
  private rimL: DirectionalLight;
  private rimR: DirectionalLight;
  private fill: DirectionalLight;
  readonly env: Texture;

  constructor(renderer: WebGLRenderer, scene: Scene) {
    const pmrem = new PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.env;

    const mk = (pos: [number, number, number], target: [number, number, number]) => {
      const l = new DirectionalLight();
      l.position.set(...pos);
      l.target.position.set(...target);
      this.group.add(l, l.target);
      return l;
    };
    // La cámara está en el origen mirando a -Z; los cuerpos a 2-4 m.
    this.key = mk([-2.2, 3.0, 0.2], [0, 0.2, -3]); // rasante desde arriba a un lado: volumen
    this.rimL = mk([-3.5, 1.5, -7], [0, 0.2, -3]);
    this.rimR = mk([3.5, 1.2, -7], [0, 0.2, -3]);
    this.fill = mk([0, -1.5, 1.5], [0, 0.2, -3]);
    scene.add(this.group);
    this.sync(scene);
  }

  private dirs = { key: new Vector3(), rimL: new Vector3(), rimR: new Vector3() };

  /** Direcciones (mundo, hacia la luz) de la principal y los contraluces: las usa la sangre. */
  directions(): { key: Vector3; rimL: Vector3; rimR: Vector3 } {
    this.dirs.key.subVectors(this.key.position, this.key.target.position).normalize();
    this.dirs.rimL.subVectors(this.rimL.position, this.rimL.target.position).normalize();
    this.dirs.rimR.subVectors(this.rimR.position, this.rimR.target.position).normalize();
    return this.dirs;
  }

  sync(scene: Scene): void {
    const c = config.lighting;
    scene.environmentIntensity = c.envIntensity;
    this.key.color.set(c.keyColor);
    this.key.intensity = c.keyIntensity;
    for (const r of [this.rimL, this.rimR]) {
      r.color.set(c.rimColor);
      r.intensity = c.rimIntensity;
    }
    this.fill.color.set(c.fillColor);
    this.fill.intensity = c.fillIntensity;
  }
}
