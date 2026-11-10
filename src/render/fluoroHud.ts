// Datos del equipo de fluoroscopia en pantalla (§6), como en el monitor de una sala de rayos X. Es un
// overlay DOM sin espejar (se lee derecho), en las esquinas, fuera del campo redondo:
//  · abajo a la izquierda, sobre el contador (arriba va la guía, que es ancha): haz encendido (● RX) o
//    última imagen, modo pulsado, kV y mA con control automático de exposición (oscilan solos), ventana y nivel;
//  · arriba a la derecha: el marcador de lado;
//  · abajo a la derecha: n.º de estudio, tiempo de fluoroscopia y dosis acumulada, fecha y hora;
//  · a la derecha: una regla en centímetros calibrada a la distancia de los cuerpos.
// Los números del estudio son del ciclo: tiempo y dosis vuelven a cero con cada donante nuevo.
import { config } from '../config.ts';

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const RULER_CM = 50;

export interface FluoroHudInput {
  /** N.º de estudio (el del próximo donante). */
  study: number;
  /** ¿Hay haz? (alguien frente al equipo o un ciclo en curso). */
  beam: boolean;
  /** Cuerpos frente al equipo (sube kV, mA y la tasa de dosis). */
  subjects: number;
  /** Píxeles CSS por centímetro a la distancia de los cuerpos (0 = sin dato). */
  pxPerCm: number;
}

export class FluoroHud {
  private root = document.createElement('div');
  private tl = document.createElement('div');
  private br = document.createElement('div');
  private marker = document.createElement('div');
  private ruler = document.createElement('div');
  private rulerTicks: HTMLDivElement[] = [];
  private lastTl = '';
  private lastBr = '';
  private lastPx = 0;
  private study = -1;
  private fluoroTime = 0;
  private dose = 0;
  private t = 0;
  private textClock = 0;

  constructor() {
    this.root.className = 'fluoro';
    this.tl.className = 'fluoro-info fluoro-bl';
    this.br.className = 'fluoro-info fluoro-br';
    this.marker.className = 'film-marker fluoro-marker';
    this.ruler.className = 'fluoro-ruler';
    const spine = document.createElement('div');
    spine.className = 'fluoro-ruler-spine';
    this.ruler.appendChild(spine);
    // Marca larga cada 10 cm con su número; media cada 5; corta cada 1.
    for (let cm = 0; cm <= RULER_CM; cm++) {
      const tick = document.createElement('div');
      tick.className = cm % 10 === 0 ? 'fluoro-tick fluoro-tick-major' : cm % 5 === 0 ? 'fluoro-tick fluoro-tick-mid' : 'fluoro-tick';
      if (cm % 10 === 0) {
        const num = document.createElement('span');
        num.textContent = cm === RULER_CM ? `${cm} cm` : String(cm);
        tick.appendChild(num);
      }
      this.ruler.appendChild(tick);
      this.rulerTicks.push(tick);
    }
    this.root.append(this.tl, this.br, this.marker, this.ruler);
    document.body.appendChild(this.root);
  }

  update(dt: number, inp: FluoroHudInput): void {
    const F = config.fluoro;
    const show = F.enabled && F.hud;
    this.root.style.display = show ? '' : 'none';
    this.t += dt;
    if (inp.study !== this.study) {
      this.study = inp.study;
      this.fluoroTime = 0;
      this.dose = 0;
    }
    // Control automático de exposición: kV y mA se acomodan solos a lo que hay frente al equipo.
    const n = Math.max(0, inp.subjects);
    const wob = Math.sin(this.t * 0.7) * 0.6 + Math.sin(this.t * 1.9 + 1.3) * 0.4;
    const kv = inp.beam ? 66 + 5 * Math.min(n, 2) + 1.5 * wob : 0;
    const ma = inp.beam ? 0.8 + 0.9 * Math.min(n, 2) + 0.12 * wob : 0;
    if (inp.beam) {
      this.fluoroTime += dt;
      this.dose += dt * F.doseRate * Math.max(1, n) * (ma / 2.6) * (kv / 76) * (kv / 76);
    }
    if (!show) return;

    // Los textos se renuevan 10 veces por segundo (el décimo del tiempo de fluoroscopia).
    this.textClock += dt;
    if (this.textClock >= 0.1) {
      this.textClock = 0;
      const blink = inp.beam ? (Math.floor(this.t * 2) % 2 === 0 ? '●' : '○') : '○';
      const pulse = F.pulseFps > 0 ? `PULSADA ${F.pulseFps.toFixed(F.pulseFps % 1 ? 1 : 0)} p/s` : 'CONTINUA';
      const tl =
        `${blink} RX  ${inp.beam ? `FLUOROSCOPIA ${pulse}` : 'ÚLTIMA IMAGEN'}\n` +
        (inp.beam ? `${kv.toFixed(0)} kV · ${ma.toFixed(1)} mA · EXP. AUTO\n` : '— kV · — mA\n') +
        `W 1800 · L 420 · PERSIST ${Math.round(F.lag * 1000)} ms`;
      const m = Math.floor(this.fluoroTime / 60);
      const s = this.fluoroTime - m * 60;
      const d = new Date();
      const br =
        `ESTUDIO ${pad(inp.study, 4)} · CUERPO ENTERO · AP\n` +
        `T. FLUORO ${pad(m)}:${s.toFixed(1).padStart(4, '0')} · ${this.dose.toFixed(2)} mGy\n` +
        `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      if (tl !== this.lastTl) this.tl.textContent = this.lastTl = tl;
      if (br !== this.lastBr) this.br.textContent = this.lastBr = br;
    }
    const marker = config.film.marker;
    if (this.marker.textContent !== marker) this.marker.textContent = marker;
    this.marker.style.display = marker ? '' : 'none';

    // Regla: solo se reacomoda si cambió la escala (más de un 1 %).
    const px = inp.pxPerCm;
    this.ruler.style.display = F.ruler && px > 0 ? '' : 'none';
    if (F.ruler && px > 0 && Math.abs(px - this.lastPx) > this.lastPx * 0.01) {
      this.lastPx = px;
      this.ruler.style.height = `${(px * RULER_CM).toFixed(1)}px`;
      this.rulerTicks.forEach((tick, cm) => (tick.style.bottom = `${(px * cm).toFixed(1)}px`));
    }
  }
}
