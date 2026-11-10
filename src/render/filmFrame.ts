// Marco de placa radiográfica (línea estética, §6): borde claro de colimación con penumbra, esquinas
// redondeadas, las muescas de la película, el marcador de plomo y los datos impresos del estudio. Es un
// overlay DOM sin espejar: la imagen se proyecta en espejo, pero la R y los textos se leen derechos.
import { config } from '../config.ts';

const pad = (n: number) => String(n).padStart(2, '0');

export class FilmFrame {
  private root = document.createElement('div');
  private marker = document.createElement('div');
  private info = document.createElement('div');
  private lastText = '';

  constructor() {
    this.root.className = 'film';
    const edge = document.createElement('div');
    edge.className = 'film-edge';
    this.root.appendChild(edge);
    // Muescas de la película (código de tipo de placa), arriba a la izquierda.
    for (const left of [7, 9.5]) {
      const n = document.createElement('div');
      n.className = 'film-notch';
      n.style.left = `calc(var(--film-border, 2.6vh) + ${left}vh)`;
      this.root.appendChild(n);
    }
    this.marker.className = 'film-marker';
    this.info.className = 'film-info';
    this.root.append(this.marker, this.info);
    document.body.appendChild(this.root);
    document.documentElement.style.setProperty('--label-scale', String(config.labels.scale));
  }

  /** Una vez por frame (barato): estilo desde config y el texto del estudio (cambia cada segundo). */
  update(plateNumber: number): void {
    const F = config.film;
    const st = document.documentElement.style;
    st.setProperty('--label-scale', String(config.labels.scale));
    // Con la fluoroscopia, el marco de placa sobra: el campo redondo y los datos del equipo lo reemplazan.
    const on = F.enabled && !config.fluoro.enabled;
    this.root.style.display = on ? '' : 'none';
    if (!on) return;
    const r = this.root.style;
    r.setProperty('--film-border', `${F.border}vh`);
    r.setProperty('--film-radius', `${F.radius}vh`);
    r.setProperty('--film-soft', `${F.soft}vh`);
    r.setProperty('--film-color', F.color);
    r.setProperty('--film-opacity', String(F.opacity));
    this.marker.textContent = F.marker;
    this.marker.style.display = F.marker ? '' : 'none';
    this.info.style.display = F.info ? '' : 'none';
    const d = new Date();
    const text =
      `PLACA ${String(plateNumber).padStart(4, '0')} · PA · CUERPO ENTERO\n` +
      `120 kV · 4 mAs · DFP 250 cm\n` +
      `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (text !== this.lastText) {
      this.lastText = text;
      this.info.textContent = text;
    }
  }
}
