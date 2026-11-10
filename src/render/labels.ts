// Textos clínicos (§9): IBM Plex Mono, impresos letra a letra, anclados a un punto 3D
// (tórax de cada cuerpo) o fijos en pantalla (contador, registro). Nada de UI de videojuego.
// Van en un overlay DOM sin espejar: el anclaje proyecta y espeja la posición a mano.
import { Vector3, type Camera } from 'three';
import { config } from '../config.ts';
import type { Projection } from './projection.ts';

export interface LabelOpts {
  /** Punto de mundo al que se ancla (null = fijo en pantalla). */
  anchor?: () => Vector3 | null;
  /** Desplazamiento en px desde el ancla, en la PARED (x positivo = derecha del espectador). */
  dx?: number;
  dy?: number;
  /** Posición fija (fracción de pantalla) si no hay ancla. */
  x?: number;
  y?: number;
  align?: 'left' | 'center' | 'right';
  /** Caracteres por segundo (0 = aparece entero). */
  speed?: number;
  size?: 'small' | 'normal' | 'large' | 'guide';
  className?: string;
  /** Pertenece a un bloque (p. ej. las dos columnas de genes) que se acota al borde como una unidad:
   *  `offset` = px desde el borde izquierdo del bloque, `width` = ancho total del bloque. */
  block?: { offset: number; width: number };
}

interface Label {
  el: HTMLDivElement;
  /** Avance por carácter en px (la fuente es monoespaciada): ancho final sin medir cada frame. */
  charW: number;
  /** Escala de textos y alto de pantalla con que se midió (si cambian, se vuelve a medir). */
  measured: string;
  text: string;
  shown: number;
  opts: LabelOpts;
  fade: number;
  target: number;
}

const tmp = new Vector3();
/** Margen mínimo con el borde de la imagen (px): por dentro del marco de la placa. */
let MARGIN = 16;

export class Labels {
  private root: HTMLDivElement;
  private items = new Map<string, Label>();
  /** Se llama con cada letra impresa (sonido de tecleo). */
  onType: (id: string) => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    document.body.appendChild(this.root);
  }

  show(id: string, text: string, opts: LabelOpts = {}): void {
    let l = this.items.get(id);
    if (!l) {
      const el = document.createElement('div');
      el.className = `label label-${opts.size ?? 'normal'} ${opts.className ?? ''}`;
      this.root.appendChild(el);
      l = { el, charW: 0, measured: '', text: '', shown: 0, opts, fade: 0, target: 1 };
      this.items.set(id, l);
    }
    if (l.text !== text) {
      l.text = text;
      l.shown = opts.speed === 0 ? text.length : 0;
    }
    l.opts = opts;
    l.target = 1;
  }

  hide(id: string): void {
    const l = this.items.get(id);
    if (l) l.target = 0;
  }

  /** Oculta todas (con fundido) salvo las indicadas. */
  hideAll(except: string[] = []): void {
    for (const [id, l] of this.items) if (!except.includes(id)) l.target = 0;
  }

  /** ¿Terminó de imprimirse? */
  done(id: string): boolean {
    const l = this.items.get(id);
    return !!l && l.shown >= l.text.length;
  }

  update(dt: number, camera: Camera, proj: Projection): void {
    MARGIN = 16 + (config.film.enabled ? (window.innerHeight * config.film.border) / 100 : 0);
    const W = proj.canvasW;
    const H = proj.canvasH;
    const key = `${config.labels.scale}@${window.innerHeight}`;
    for (const [id, l] of this.items) {
      if (l.measured !== key) {
        // Medir el avance por carácter con el tamaño real (la escala es una variable CSS).
        l.el.textContent = 'M'.repeat(20);
        l.charW = l.el.offsetWidth / 20;
        l.measured = key;
      }
      l.fade += (l.target - l.fade) * (1 - Math.exp(-6 * dt));
      if (l.target === 0 && l.fade < 0.01) {
        l.el.remove();
        this.items.delete(id);
        continue;
      }
      const speed = l.opts.speed ?? 28;
      if (l.shown < l.text.length) {
        const before = Math.floor(l.shown);
        l.shown = speed > 0 ? Math.min(l.text.length, l.shown + dt * speed) : l.text.length;
        if (Math.floor(l.shown) > before && l.text[Math.floor(l.shown) - 1] !== ' ') this.onType(id);
      }
      const typing = l.shown < l.text.length;
      l.el.textContent = l.text.slice(0, Math.floor(l.shown)) + (typing ? '▌' : '');
      l.el.style.opacity = String(Math.min(1, l.fade));
      let x: number;
      let y: number;
      const a = l.opts.anchor?.();
      if (l.opts.anchor) {
        if (!a) {
          l.el.style.opacity = '0';
          continue;
        }
        tmp.copy(a).project(camera);
        x = (tmp.x * 0.5 + 0.5) * W;
        y = (1 - (tmp.y * 0.5 + 0.5)) * H;
        if (config.mirror) x = W - x;
        x += l.opts.dx ?? 0;
        y += l.opts.dy ?? 0;
      } else {
        x = (l.opts.x ?? 0.5) * W;
        y = (l.opts.y ?? 0.5) * H;
      }
      // Se alinea con el ancho del texto COMPLETO (no salta mientras se imprime) y nunca se sale
      // de la pared: con el visitante cerca del borde, el texto se corre hacia adentro.
      const align = l.opts.align ?? 'left';
      const w = l.text.split('\n').reduce((m, line) => Math.max(m, line.length), 0) * l.charW;
      let left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      const bo = l.opts.block?.offset ?? 0;
      const bw = l.opts.block?.width ?? w;
      left = Math.min(Math.max(left - bo, MARGIN), Math.max(MARGIN, W - MARGIN - bw)) + bo;
      l.el.style.transform = `translate(${left.toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
    }
  }

  clear(): void {
    for (const l of this.items.values()) l.el.remove();
    this.items.clear();
  }
}
