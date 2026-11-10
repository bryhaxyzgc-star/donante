// AUSENCIA (§9.6, ≤ 25 s). El cerdo queda de pie, congelado, con el pecho abierto, sobre su charco.
//    0–6 s  el monitor del donante espacia su pitido → 6–10 s línea plana sostenida 4 s → silencio.
//           Mientras tanto, el latido del receptor sigue (vivo, de su lado): el contraste es la obra.
//  10,5 s   registro desigual (5 s): RECEPTOR … sobrevida: registrada / DONANTE … vida: no registrada.
//  15,5 s   borrado (6 s): toda la sangre se desatura y el trapeador la limpia en 3 pasadas; al
//           terminar se cuentan los píxeles rojos (§18: tienen que ser 0).
//  20,5 s   el esqueleto del cerdo se disuelve muy lento (4 s).
//  24,5 s   el contador suma un donante y se guarda. Vuelve a ESPERA.
import { Vector3 } from 'three';
import { config } from '../config.ts';
import { format } from '../counter.ts';
import type { State } from './machine.ts';
import { bleedAbsence } from './sangrado.ts';

const REGISTER_AT = 10.5;
const REGISTER_FOR = 5;
const ERASE_AT = 15.5;
const DISSOLVE_AT = 20.5;
const DISSOLVE_FOR = 4;
const COUNT_AT = 24.5;

let nextBeep = 0;
let interval = 0.8;
let flat = false;
let registered = false;
let counted = false;
let checked = false;
let mopped = 0;

function ramp(t: number, t0: number, len: number): number {
  return Math.min(1, Math.max(0, (t - t0) / len));
}

function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

const toward = new Vector3();
const viewer = new Vector3();

export const ausencia: State = {
  name: 'AUSENCIA',
  enter(s) {
    nextBeep = 0.2;
    interval = 0.8;
    flat = false;
    registered = false;
    counted = false;
    checked = false;
    mopped = 0;
    s.labels.hideAll();
    s.cues.setHum(0.2);
    s.monitor = 0;
    // Sin corazón, la saturación se desploma: los últimos pitidos suenan cada vez más graves.
    s.spo2Target = 38;
    s.spo2Rate = 6;
    s.heartFrom = 'receptor';
    s.heartLevel = 0.4;
    s.post.caBase = 1;
  },
  update(s, t) {
    const d = s.donor;
    const r = s.receptor;
    if (!d) return 'ESPERA';
    const pan = s.pan(d);
    // Monitor del donante: el pitido se espacia → línea plana 4 s → silencio.
    if (t < 6) {
      if (t >= nextBeep) {
        s.cues.pulseBeep(s.spo2, 0.14 * config.audio.monitor, pan);
        interval *= 1.22;
        nextBeep = t + interval;
      }
    } else if (t < 10) {
      if (!flat) {
        flat = true;
        s.cues.flatline(true, pan);
      }
    } else if (flat) {
      flat = false;
      s.cues.flatline(false);
      // Se apaga el monitor y también el respirador: el cuerpo ya no se mantiene.
      s.vent = 0;
    }

    // Guía: qué pasó, y al final, el gracias. Durante el registro desigual la guía calla.
    const G = config.guide;
    s.guide(t < REGISTER_AT ? G.ausencia : t < ERASE_AT ? null : t < COUNT_AT ? G.borrado : G.fin);

    // Registro desigual (§1.7).
    if (t >= REGISTER_AT && !registered) {
      registered = true;
      const n = format(s.donorNumber);
      s.labels.show('reg1', 'RECEPTOR ........... sobrevida: registrada', { x: 0.5, y: 0.82, align: 'center', speed: 32 });
      s.labels.show('reg2', `DONANTE N.º ${n} ... vida: no registrada`, { x: 0.5, y: 0.86, align: 'center', speed: 32 });
    }
    if (t >= REGISTER_AT + REGISTER_FOR) {
      s.labels.hide('reg1');
      s.labels.hide('reg2');
    }

    // Borrado (§9.6, §1.6): el sistema borra la huella.
    const blood = s.stage.blood;
    const te = t - ERASE_AT;
    if (te >= 0) {
      blood.erase(te);
      const E = config.erase;
      const desat = ramp(te, 0, E.desatTime);
      // La médula expuesta y el tinte del corazón también pierden el rojo.
      d.bloodErase = desat;
      if (r) r.bloodErase = desat;
      s.post.caBase = 1 - desat;
      // Una pasada de trapeador por barrido, cruzando la sala en su sentido (con el espejo).
      const starts = [E.sweep1, E.sweep2, E.sweep3];
      while (mopped < 3 && te >= starts[mopped]) {
        const dir = blood.eraser.uniforms.uSweepDir.value.getComponent(mopped);
        const wall = (config.mirror ? -1 : 1) * dir;
        s.cues.mop(-wall, wall, E.sweepTime);
        mopped++;
      }
      s.heartLevel = 0.4 * (1 - blood.eraser.progress);
      if (blood.eraser.done && !checked) {
        checked = true;
        void s.stage.redCheck.request();
      }
    }

    // La mirada: el cráneo gira de perfil, hocico hacia quien tiene su corazón y un ojo al público.
    const A = config.absence;
    if (r) r.heartWorld(toward);
    else toward.set(0, 0, 0);
    // Y el telos: mientras se disuelve, deja la postura humana y queda en cuatro patas.
    d.poseFrozen(ease((t - A.lookAt) / A.lookTime), ease((t - A.telosAt) / A.telosTime), toward, s.stage.camera.getWorldPosition(viewer), A.lookToPublic);
    // La sombra con hocico: la imagen real del donante gana cabeza de cerdo (§9.6).
    pigShadow(s, t);

    // El esqueleto del cerdo (y su piel-máscara) se disuelven muy lento.
    const k = ramp(t, DISSOLVE_AT, DISSOLVE_FOR);
    d.frozenDissolve = 1.02 * k;
    d.layers.skin = 0.6 * (1 - k);
    if (t >= COUNT_AT && !counted) {
      counted = true;
      const v = s.counter.increment(s.solo);
      s.labels.show('counter', `DONANTES: ${format(v)}`, { x: 0.035, y: 0.93, speed: 0, size: 'small' });
      s.cues.click();
    }
    bleedAbsence(s, t, s.clocks.dtGame, ERASE_AT);
    return t >= config.show.ausencia ? 'ESPERA' : null;
  },
  exit(s) {
    s.cues.flatline(false);
    s.heartLevel = 0;
    s.stage.softTissue.setPigShadow(0);
  },
};

/** Cabeza de cerdo en la sombra real del donante, de perfil hacia el receptor; se va con el cerdo. */
function pigShadow(s: Parameters<State['update']>[0], t: number): void {
  const A = config.absence;
  const p = s.person(s.donor?.personId ?? null);
  const amount = ease((t - A.shadowAt) / A.shadowTime) * (1 - ramp(t, DISSOLVE_AT, DISSOLVE_FOR));
  if (!p || amount <= 0) {
    s.stage.softTissue.setPigShadow(0);
    return;
  }
  // Landmarks 2D (fracción del video): nariz 0, orejas 7/8, hombros 11/12.
  const L = p.lm2d, at = (i: number, c: number) => L[i * 4 + c], vis = (i: number) => L[i * 4 + 3];
  const ears = vis(7) > 0.3 && vis(8) > 0.3;
  const x = ears ? (at(7, 0) + at(8, 0)) / 2 : at(0, 0);
  const y = ears ? (at(7, 1) + at(8, 1)) / 2 : at(0, 1);
  const earW = ears ? Math.hypot(at(7, 0) - at(8, 0), at(7, 1) - at(8, 1)) : 0;
  const shW = Math.hypot(at(11, 0) - at(12, 0), at(11, 1) - at(12, 1));
  const size = Math.max(earW * 1.6, shW * 0.62);
  const rp = s.person(s.receptor?.personId ?? null);
  const dir = (rp ? rp.hipX - p.hipX : 0.5 - p.hipX) >= 0 ? 1 : -1;
  s.stage.softTissue.setPigShadow(amount, x, y, size, dir);
}
