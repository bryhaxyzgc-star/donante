// Calibración de la proyección (tecla C, §16): flechas desplazan, +/- hacen zoom,
// Mayús+↑/↓ ajusta la escala del cuerpo, 0 restablece. Se guarda al instante.
// Mientras está activa se ve la webcam al 40 % para alinear al visitante con su cuerpo.
import { config, defaults, saveCalibration } from './config.ts';

export class Calibration {
  active = false;
  private el: HTMLDivElement;
  private info: HTMLDivElement;
  onChange: () => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'calib';
    this.el.innerHTML = '<div class="calib-h"></div><div class="calib-v"></div>';
    this.info = document.createElement('div');
    this.info.className = 'calib-info';
    this.el.appendChild(this.info);
    document.body.appendChild(this.el);
    this.render();
  }

  toggle(): void {
    this.active = !this.active;
    this.render();
  }

  /** Devuelve true si la tecla fue consumida. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const c = config.calib;
    const step = e.shiftKey ? 0.02 : 0.004;
    switch (e.key) {
      case 'ArrowLeft': c.offsetX -= step; break;
      case 'ArrowRight': c.offsetX += step; break;
      case 'ArrowUp':
        if (e.shiftKey) c.bodyScale = Math.min(1.6, c.bodyScale * 1.01);
        else c.offsetY += step;
        break;
      case 'ArrowDown':
        if (e.shiftKey) c.bodyScale = Math.max(0.6, c.bodyScale / 1.01);
        else c.offsetY -= step;
        break;
      case '+': case '=': c.zoom = Math.min(3, c.zoom * 1.01); break;
      case '-': case '_': c.zoom = Math.max(0.4, c.zoom / 1.01); break;
      case '0': Object.assign(c, defaults.calib); break;
      default: return false;
    }
    saveCalibration();
    this.onChange();
    this.render();
    return true;
  }

  render(): void {
    this.el.style.display = this.active ? 'block' : 'none';
    const c = config.calib;
    this.info.textContent =
      `CALIBRACIÓN  desplaz ${c.offsetX.toFixed(3)}, ${c.offsetY.toFixed(3)}  zoom ${c.zoom.toFixed(3)}  cuerpo ${c.bodyScale.toFixed(3)}\n` +
      '← → ↑ ↓ desplazar (Mayús = rápido) · + − zoom · Mayús ↑↓ escala cuerpo · 0 restablecer · C salir';
  }
}
