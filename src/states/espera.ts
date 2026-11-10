// ESPERA (§9.1): la placa medio oscura, zumbido grave muy bajo y el contador abajo a la izquierda.
// La obra necesita dos personas. Quien se acerca ya se ve, tenue, en rayos X, y la guía le dice
// cuántas faltan. Con dos personas estables: "2 PERSONAS RECONOCIDAS" un momento y pasa a PLACA.
import { config } from '../config.ts';
import { format } from '../counter.ts';
import type { Person } from '../input/people.ts';
import type { Show, State } from './machine.ts';

let readyAt = -1;

/** Con una sola persona: con roles por posición, la guía nombra el círculo que falta ocupar. */
function oneMissing(s: Show, p: Person): string {
  const G = config.guide;
  const b = s.bodyOf(p);
  if (config.roles.mode !== 'posicion' || !b) return G.esperaUna;
  return s.onDonorSide(b) ? G.faltaDestinatario : G.faltaProveedor;
}

export const espera: State = {
  name: 'ESPERA',
  enter(s) {
    // Quienes siguen ahí al terminar un ciclo conservan su cuerpo (no vuelven a aparecer de cero).
    s.clearRoles(true);
    s.assigning = true;
    readyAt = -1;
    s.labels.hideAll();
    s.labels.show('counter', `DONANTES: ${format(s.counter.value)}`, { x: 0.035, y: 0.93, speed: 0, size: 'small' });
    s.cues.setHum(0.6);
    s.cues.flatline(false);
    s.post.stateDesat = 1;
    s.post.letterbox = 0;
    s.post.caBase = 0;
    s.post.dimTarget = config.guide.waitDim;
    s.clocks.timeScale = 1;
    for (const r of s.rings) r.target = 0;
  },
  update(s, t) {
    s.syncAssignments();
    const G = config.guide;
    const act = s.activePeople();
    const stable = act.filter((p) => p.stableTime >= config.show.esperaStable && s.bodyOf(p));
    if (readyAt < 0 && t >= config.show.esperaStable && stable.length >= 2) {
      readyAt = t;
      s.cues.beep(880, 0.08, 0.1, 0);
    }
    if (readyAt >= 0 && act.length < 2) readyAt = -1;
    s.guide(readyAt >= 0 ? G.reconocidas : act.length === 0 ? G.esperaCero : act.length === 1 ? oneMissing(s, act[0]) : G.reconocidas);
    return readyAt >= 0 && t - readyAt >= G.recognizedHold ? 'PLACA' : null;
  },
  exit(s) {
    s.labels.hide('counter');
    s.post.dimTarget = 1;
  },
};
