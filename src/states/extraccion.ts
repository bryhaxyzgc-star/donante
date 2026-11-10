// EXTRACCIÓN — cinemática X-Ray en tiempo real (§9.5, ≈ 14 s). Los planos y la cámara están en
// render/cinematic.ts; la sangre, en sangrado.ts. Lista de planos:
//   1  0,0  general → corte a medio del donante; letterbox 2,39:1; el mundo se desatura; 1 → 0,25
//   2  0,6  primer plano del tórax en órbita: piel y músculo se vuelven transparentes
//   3  1,8  macro de costillas: impacto invisible (hit-stop 120 ms, flash, aberración); grietas en 3
//   4  2,4  macro que retrocede: las costillas se quiebran hacia afuera (Rapier), astillas, médula, sangre
//   5  4,0  el corazón late en la cavidad abierta: carne húmeda, brillo especular
//   6  5,5  detalle lateral: el corazón es arrancado; los vasos se estiran y se rompen uno por uno
//   7  7,5  plano a la lente: gotas que golpean y escurren
//   8  8,5  seguimiento del corazón por la Bézier; gotea solo la primera mitad (llega limpio, §1.3)
//   9 11,0  tórax del receptor: el corazón entra limpio; las costillas se abren como un diafragma de luz
//  10 12,5  vuelta al general: letterbox sale
// El tiempo sigue la curva Hermite de config.cinematic.timeCurve; el latido, el reloj real.
import { CubicBezierCurve3, Quaternion, Vector3 } from 'three';
import { boneVoice } from '../audio/cues.ts';
import { config } from '../config.ts';
import { TimeCurve, type ShotAnchors } from '../render/cinematic.ts';
import type { VesselName } from '../render/vessels.ts';
import { deliverHeart, type Show, type State } from './machine.ts';
import { bleedExtraction, setupBleeding } from './sangrado.ts';

/** Orden y momento en que se rompe cada vaso (plano 6): el más corto primero, la aorta al final. */
const SNAPS: [number, VesselName][] = [[5.75, 'pulmonary'], [6.2, 'svc'], [6.65, 'ivc'], [7.1, 'aorta']];
const RIB_VOICE = boneVoice('ribs');

const curveT = new TimeCurve();
let hit = false;
let broke = false;
let delivered = false;
let activated = false;
let snapped = 0;
/** Sonidos de una sola vez (cámara lenta, desgarro, salpicaduras). */
const said = new Set<string>();
function once(k: string): boolean {
  if (said.has(k)) return false;
  said.add(k);
  return true;
}
const start = new Vector3();
const pulled = new Vector3();
const target = new Vector3();
const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3());
const ARC = new Vector3(0, 0.28, 0.12);
/** El corazón entra en el receptor ya dentro del plano 9 (que empieza a los 11 s). */
const ARRIVE = 11.4;
/** Al llegar, la carne se vuelve rayos X mientras aparece el corazón del receptor (s). */
const BECOME = 0.9;
const targetQ = new Quaternion();
const targetS = new Vector3();
let arrived = false;
const anchors: ShotAnchors = {
  donor: new Vector3(), cavity: new Vector3(), heart: new Vector3(), heartLive: new Vector3(), receptor: new Vector3(), out: 1,
};

function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function ramp(t: number, t0: number, len: number): number {
  return Math.min(1, Math.max(0, (t - t0) / len));
}

const tmpT = new Vector3();

/** El receptor recibe el corazón: sus órganos se encienden (en modo solo, solo el corazón). */
function receive(s: Show): void {
  const r = s.receptor;
  if (!r) return;
  r.layers.organs = 1;
  for (const o of r.organs) {
    if (o.name === 'heart') o.fade = 0;
    else if (s.solo) o.fade = 0;
  }
}

function heartPivot(s: Show) {
  return s.donor?.organ('heart')?.pivot ?? null;
}

/** Cuánto salió el corazón (m, escala 1): un tirón y un salto con cada vaso que cede. */
function pullAt(t: number): number {
  const C = config.cinematic;
  let p = C.pullStart * ease((t - 5.5) / 0.25);
  for (const [tb] of SNAPS) p += C.pullPerBreak * ease((t - tb) / 0.12);
  return p;
}

export const extraccion: State = {
  name: 'EXTRACCION',
  enter(s) {
    // Plano 5: solo el corazón del cerdo; el del receptor ya no se oye (lo va a reemplazar).
    s.ownLevel = 0;
    hit = false;
    broke = false;
    delivered = false;
    arrived = false;
    activated = false;
    snapped = 0;
    said.clear();
    s.labels.hideAll();
    s.heartFrom = 'donante';
    s.heartLevel = 0;
    s.monitor = 1;
    const d = s.donor;
    const hp = heartPivot(s);
    if (hp) {
      // Posición del corazón congelado: se guarda para poder repetir la cinemática con X.
      if (!s.heartHomeSet) {
        s.heartHome.copy(hp.position);
        s.heartHomeQuat.copy(hp.quaternion);
        s.heartHomeScale.copy(hp.scale);
        s.heartHomeSet = true;
      }
      hp.position.copy(s.heartHome);
      hp.quaternion.copy(s.heartHomeQuat);
      hp.scale.copy(s.heartHomeScale);
      start.copy(hp.position);
    }
    if (d) {
      d.setFleshHeart(false);
      d.cineHeart?.reset();
      d.cineHeart?.setBlood(1);
      const j = d.frozenJoints;
      const scale = d.root.scale.x;
      anchors.donor.copy(j.Spine2 ?? d.chestWorld(anchors.donor));
      anchors.cavity.copy(anchors.donor);
      anchors.cavity.y -= 0.03 * scale;
      anchors.cavity.z += 0.08 * scale;
      anchors.heart.copy(s.heartHome);
      const r = s.receptor;
      anchors.out = r ? Math.sign(anchors.donor.x - r.chestWorld(anchors.receptor).x) || 1 : 1;
    }
    s.cues.setHum(0.15);
    s.post.caBase = 1;
    s.stage.cinematic = true;
    setupBleeding(s);
  },
  update(s, t) {
    const d = s.donor;
    const r = s.receptor;
    if (!d || !r) return 'ESPERA';
    const C = config.cinematic;
    const end = config.show.extraccion;
    const scale = d.root.scale.x;
    const pan = s.pan(d);

    // Letterbox, desaturación y curva de tiempo.
    s.post.letterbox = t < 12.5 ? ease(t / 0.5) : 1 - ease((t - 12.5) / 1.0);
    s.post.stateDesat = 1.15;
    s.clocks.timeScale = Math.max(0, curveT.value(t, C.timeCurve));

    // Sonido (§13): rampas de cámara lenta, latido y monitor por plano.
    if (t >= 0.05 && once('slowmo-in')) s.cues.slowmo(true);
    if (t >= 11.5 && once('slowmo-out')) s.cues.slowmo(false);
    // Plano 5: silencio salvo el latido. Desde el plano 6 el monitor del donante ya no cuenta nada.
    s.monitor = t < 4 ? 1 : 0;
    // Con el pecho roto la saturación cae (el tono del monitor baja); al arrancar el corazón, la alarma.
    if (t >= 1.8 && once('desatura')) {
      s.spo2Target = 74;
      s.spo2Rate = 5;
    }
    if (t >= 5.5 && once('alarma')) s.alarm();
    if (t >= 4 && once('silencio')) s.cues.setHum(0);
    if (t >= 5.5 && once('vuelve-zumbido')) s.cues.setHum(0.12);
    s.heartLevel = arrived ? 0.85 : t < 0.6 ? 0 : t < 4 ? 0.35 : t < 5.5 ? 1 : 0.75;
    s.heartFrom = arrived ? 'receptor' : 'donante';

    // Plano 2: piel y músculo se vuelven transparentes; queda la caja torácica.
    d.layers.skin = t < 0.6 ? 1 : t < 12.5 ? 1 - 0.85 * ease((t - 0.6) / 1.2) : 0.15 + 0.45 * ease((t - 12.5) / 1.5);
    d.layers.muscle = 0;

    // Plano 3: impacto invisible y grietas que corren por tres costillas.
    if (t >= 1.8 && !hit) {
      hit = true;
      s.clocks.hitStop(120);
      s.post.flash = 1;
      s.post.caPulse = 1.5;
      s.stage.shake.kick(7);
      s.cues.sub(0.9);
      s.cues.crackle(pan, RIB_VOICE, 0.5);
    }
    if (!broke) d.crackPigRibs(Math.pow(ramp(t, 1.85, 0.5), 1.4), anchors.cavity, 0.065 * scale);

    // Plano 4: las costillas se quiebran hacia afuera (fragmentos con Rapier) con astillas y polvo.
    if (t >= 2.4 && !broke) {
      broke = true;
      d.breakRibsPhysics(anchors.cavity, C.ribSpeed, C.ribSpin);
      s.debris.spray(anchors.cavity, 0.08, scale, 1.3);
      s.cues.snap(pan, RIB_VOICE, 1.2);
      s.cues.sub(0.7);
      s.cues.splat(pan, 0.8);
      s.stage.shake.kick(9);
      s.post.caPulse = 1.2;
    }

    // Con el pecho abierto, los pulmones y el hígado de rayos X (vidrio) no tienen sentido en cámara.
    for (const o of d.organs) if (o.name !== 'heart') o.fade = 1 - ramp(t, 2.4, 0.4);

    // La sangre del borbotón llega al piso (en cámara lenta, un rato después).
    if (t >= 2.95 && once('splat-1')) s.cues.splat(pan, 0.7);
    if (t >= 3.5 && once('splat-2')) s.cues.splat(pan, 0.5);
    // Plano 9: otra cámara, lente limpia: ni una gota del donante sobre el receptor (§1.3).
    if (t >= 11.0 && once('lente-limpia')) s.stage.blood.lens.clear();

    // Plano 5: la cámara corta al corazón: desde acá es carne húmeda, no rayos X.
    if (t >= 4.0 && !d.fleshHeart && !delivered) d.setFleshHeart(true);

    // Planos 5–9: el corazón sale, viaja y entra limpio en el receptor.
    const hp = heartPivot(s);
    const rh = r.organ('heart');
    if (hp && !delivered) {
      r.heartWorld(target);
      // Orientación y tamaño del corazón del receptor: el que viaja termina calzando con él.
      if (rh) rh.pivot.matrixWorld.decompose(tmpT, targetQ, targetS);
      if (t >= 5.5 && !activated) {
        activated = true;
        d.cineHeart?.activate();
        // El corazón empieza a salir: la carne se desgarra (toalla mojada retorcida).
        s.cues.fleshTear(pan, 0.9, 1);
      }
      while (snapped < SNAPS.length && t >= SNAPS[snapped][0]) {
        const [, name] = SNAPS[snapped++];
        if (d.cineHeart?.snap(name)) {
          s.stage.shake.kick(name === 'aorta' ? 6 : 4);
          s.cues.vesselSnap(pan, name === 'aorta' ? 1 : 0.75);
          s.cues.fleshTear(pan, 0.35, 0.6);
          s.post.caPulse = Math.max(s.post.caPulse, 0.5);
        }
      }
      pulled.copy(start);
      pulled.z += pullAt(Math.min(t, 8.5)) * scale;
      pulled.y += 0.01 * scale * ease((t - 5.5) / 3);
      if (t < 5.5) hp.position.copy(start);
      else if (t < 8.5) hp.position.copy(pulled);
      else if (t < ARRIVE) {
        curve.v0.copy(pulled);
        curve.v1.copy(pulled).add(ARC);
        curve.v2.copy(target).add(ARC);
        curve.v3.copy(target);
        const e = ease((t - 8.5) / (ARRIVE - 8.5));
        curve.getPoint(e, hp.position);
        hp.quaternion.slerpQuaternions(s.heartHomeQuat, targetQ, e);
        hp.scale.lerpVectors(s.heartHomeScale, targetS, e);
      } else {
        // Ya adentro: sigue al receptor (que puede moverse) mientras se vuelve placa.
        hp.position.copy(target);
        hp.quaternion.copy(targetQ);
        hp.scale.copy(targetS);
        if (!arrived) {
          arrived = true;
          receive(s);
          s.cues.beep(880, 0.1, 0.12, s.pan(r));
          // El diafragma de luz: un destello blanco suave cuando el corazón queda adentro.
          s.post.flash = Math.max(s.post.flash, 0.35);
        }
        if (t >= ARRIVE + BECOME) {
          delivered = true;
          d.setFleshHeart(false);
          deliverHeart(s);
        }
      }
      // La sangre se queda del lado del donante: a mitad de camino ya no le queda nada (§1.3).
      d.cineHeart?.setBlood(t < 9.1 ? 1 : 1 - ease((t - 9.1) / 0.85));
      d.cineHeart?.setXray(ramp(t, ARRIVE, BECOME));
    }
    // El corazón del receptor: se retira antes de que llegue el nuevo (no hay dos a la vez) y aparece
    // mientras la carne se vuelve placa.
    if (rh && !s.solo) rh.fade = t < ARRIVE ? 1 - ramp(t, ARRIVE - 0.8, 0.5) : ramp(t, ARRIVE + 0.15, BECOME - 0.1);
    if (rh && s.solo && arrived) rh.fade = ramp(t, ARRIVE + 0.15, BECOME - 0.1);

    // Plano 9: las costillas del receptor se abren apenas, como un diafragma de luz, y se cierran.
    const open = t < ARRIVE ? ease((t - (ARRIVE - 0.45)) / 0.45) : 1 - ease((t - ARRIVE) / 0.7);
    r.heartWorld(target);
    r.setDiaphragm(target, C.receptorOpen * scale * open, C.receptorGlow * open, 0.11 * scale);

    // Cámara: anclas de los planos y plano actual.
    if (hp) hp.getWorldPosition(anchors.heartLive);
    r.chestWorld(anchors.receptor);
    s.stage.rig.update(t, anchors, s.clocks.dtReal);

    // Sangre (Fase 5): con el reloj de juego, así la cámara lenta también la frena.
    bleedExtraction(s, t, s.clocks.dtGame);
    return t >= end ? 'AUSENCIA' : null;
  },
  exit(s) {
    s.clocks.timeScale = 1;
    s.post.letterbox = 0;
    s.post.stateDesat = 1;
    s.stage.cinematic = false;
    const r = s.receptor;
    if (r) r.setDiaphragm(target, 0, 0, 0.1);
  },
};
