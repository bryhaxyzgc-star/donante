// Validación del borrado (§18): muestrea el framebuffer y cuenta los píxeles con tono rojo
// (entre 340° y 20°) y saturación > 0,4. Se corre sola al terminar cada borrado y desde el panel
// (G → Debug → "Probar píxeles rojos"). Lee el buffer justo después de dibujar a pantalla, en el
// mismo frame (el canvas no conserva el buffer entre frames).
import type { WebGLRenderer } from 'three';

export interface RedResult {
  red: number;
  total: number;
  /** Momento (hora local) de la medición. */
  at: string;
}

/** ¿Es "rojo" según §18? Componentes 0..1. */
export function isRed(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  // Negro: sin tono que medir (el grano y el fondo no cuentan).
  if (mx < 8 / 255) return false;
  const d = mx - mn;
  if (d / mx <= 0.4) return false;
  let h: number;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h >= 340 || h <= 20;
}

export class RedCheck {
  last: RedResult | null = null;
  private waiting: ((r: RedResult) => void)[] = [];
  private buf: Uint8Array | null = null;

  /** Pide una medición en el próximo frame. */
  request(): Promise<RedResult> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  get pending(): boolean {
    return this.waiting.length > 0;
  }

  /** Llamar justo después de dibujar a pantalla. */
  run(renderer: WebGLRenderer): void {
    if (!this.waiting.length) return;
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (!this.buf || this.buf.length !== w * h * 4) this.buf = new Uint8Array(w * h * 4);
    const px = this.buf;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let red = 0;
    for (let i = 0; i < w * h; i++) {
      if (isRed(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255)) red++;
    }
    const r: RedResult = { red, total: w * h, at: new Date().toLocaleTimeString() };
    this.last = r;
    if (red === 0) console.info(`[borrado] 0 píxeles rojos de ${r.total} ✓`);
    else console.warn(`[borrado] quedan ${red} píxeles rojos de ${r.total}`);
    for (const resolve of this.waiting.splice(0)) resolve(r);
  }
}
