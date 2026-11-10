// Anillo de gesto (extracción con las manos): marca dónde poner la mano y se llena mientras se la
// mantiene ahí. Overlay DOM sin espejar, anclado a un punto 3D (como las etiquetas). Blanco hueso,
// nunca rojo (§1.2).
import { Vector3, type Camera } from 'three';
import { config } from '../config.ts';

const tmp = new Vector3();

export class HintRing {
  private el = document.createElement('div');
  private fill = document.createElement('div');
  private shown = 0;
  private target = 0;
  private progress = 0;
  private readonly at = new Vector3();

  constructor() {
    this.el.className = 'hint-ring';
    this.fill.className = 'hint-ring-fill';
    this.el.appendChild(this.fill);
    document.body.appendChild(this.el);
  }

  /** Muestra el anillo en `world` con el progreso 0..1 del gesto. */
  show(world: Vector3, progress: number): void {
    this.at.copy(world);
    this.progress = Math.max(0, Math.min(1, progress));
    this.target = 1;
  }

  hide(): void {
    this.target = 0;
  }

  update(dt: number, camera: Camera): void {
    this.shown += (this.target - this.shown) * (1 - Math.exp(-8 * dt));
    this.el.style.opacity = String(this.shown);
    if (this.shown < 0.01) return;
    tmp.copy(this.at).project(camera);
    let x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (1 - (tmp.y * 0.5 + 0.5)) * window.innerHeight;
    if (config.mirror) x = window.innerWidth - x;
    // Late suave mientras espera: se ve que es ahí.
    const pulse = 1 + 0.06 * Math.sin(performance.now() * 0.006) * (1 - this.progress);
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${pulse.toFixed(3)})`;
    this.fill.style.setProperty('--p', this.progress.toFixed(3));
  }
}
