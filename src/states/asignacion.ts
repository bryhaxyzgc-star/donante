// ASIGNACIÓN (§9.3, 3 s): el rol lo decide el círculo del piso (o el azar, según config.roles). Un anillo
// de escaneo gira alrededor del tórax de ambos, el brillo salta de uno a otro cada vez más lento y se
// detiene en el donante: el sistema "verifica" lo que ya estaba decidido.
// Se imprimen las etiquetas y suena un beep de monitor.
import { Vector3 } from 'three';
import { config } from '../config.ts';
import { format } from '../counter.ts';
import type { BodyRig } from '../render/body.ts';
import type { LabelOpts } from '../render/labels.ts';
import type { Show, State } from './machine.ts';

/** Instantes en que el brillo cambia de cuerpo (cada vez más espaciados). */
let flips: number[] = [];
let startOnDonor = true;
let beeped = false;

/** Etiqueta junto al tórax, hacia el lado de afuera de la pantalla. */
export function chestLabel(s: Show, b: BodyRig, dy = 0): LabelOpts {
  const side = s.sideOf(b);
  const v = new Vector3();
  return { anchor: () => b.chestWorld(v), dx: side * 150, dy, align: side > 0 ? 'left' : 'right' };
}

export const asignacion: State = {
  name: 'ASIGNACION',
  enter(s) {
    if (!s.donor) s.decideRoles();
    s.assigning = false;
    beeped = false;
    flips = [];
    let t = 0.15;
    let gap = 0.07;
    while (t < 2.0) {
      flips.push(t);
      t += gap;
      gap *= 1.28;
    }
    // Con un número par de cambios, empezar en el donante hace que termine en él.
    startOnDonor = flips.length % 2 === 0;
    for (const r of s.rings) r.target = 0;
    s.cues.setHum(0.35);
  },
  update(s, t) {
    const donor = s.donor;
    const rec = s.receptor;
    if (!donor || !rec) return 'PLACA';
    s.guide(config.guide.asignacion);
    // El corazón humano del receptor empieza a oírse: después del trasplante late otro.
    s.ownLevel = config.audio.heartOwn * Math.min(1, t / 0.8);
    const n = flips.filter((f) => f <= t).length;
    const onDonor = (n % 2 === 0) === startOnDonor;
    const rd = s.rings[donor.index];
    const rr = s.rings[rec.index];
    if (t < 2.2) {
      rd.target = onDonor ? 1.4 : 0.35;
      rr.target = onDonor ? 0.35 : 1.4;
    } else {
      rd.target = 1.6;
      rr.target = 0.15;
    }
    if (t >= 2.2 && !beeped) {
      beeped = true;
      s.cues.beep(1000, 0.16, 0.2, s.pan(donor));
      // 50 letras/s: el texto del donante termina de imprimirse justo al cerrar los 3 s.
      s.labels.show('donor', `DONANTE N.º ${format(s.donorNumber)}
Sus scrofa domesticus`, { ...chestLabel(s, donor, -10), speed: 50 });
      if (s.solo) {
        s.labels.show('receptor', 'RECEPTOR · en lista de espera', { ...chestLabel(s, rec, -10), speed: 50 });
        s.labels.show('waitlist', config.show.soloWaitlist, { ...chestLabel(s, rec, 14), size: 'small', speed: 50 });
      } else {
        s.labels.show('receptor', 'RECEPTOR', { ...chestLabel(s, rec, -10), speed: 50 });
      }
    }
    return t >= config.show.asignacion ? 'TRANSFORMACION' : null;
  },
  exit(s) {
    for (const r of s.rings) r.target = 0;
  },
};
