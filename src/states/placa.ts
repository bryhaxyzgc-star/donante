// PLACA (§9.2, ≥ 6 s): cada visitante se ve como cuerpo anatómico en rayos X que aparece con un
// barrido de escáner. Dos personas estables 6 s → ASIGNACIÓN. Si queda una sola (o ninguna) por más de
// unos segundos, vuelve a la ESPERA: la obra necesita dos personas.
import { config } from '../config.ts';
import type { State } from './machine.ts';

let pair = 0;
let short = 0;

export const placa: State = {
  name: 'PLACA',
  enter(s) {
    pair = 0;
    short = 0;
    s.assigning = true;
    s.post.dimTarget = 1;
    s.cues.setHum(0.45);
  },
  update(s, t, dt) {
    s.syncAssignments();
    s.guide(config.guide.placa);
    const stable = s.activePeople().filter((p) => p.stableTime > 0.4 && s.bodyOf(p));
    if (stable.length >= 2) {
      pair += dt;
      short = 0;
    } else {
      // Un hueco de detección descuenta, no reinicia: la cuenta de los 6 s sigue casi donde estaba.
      pair = Math.max(0, pair - dt * 0.5);
      short += dt;
      if (short > config.tracking.lostGrace + 2.5) return 'ESPERA';
    }
    const c = config.show;
    return pair >= c.placaPair && t >= c.placaMin ? 'ASIGNACION' : null;
  },
};
