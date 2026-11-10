// EXTRACCIÓN con las manos del receptor (sin cinemática; reemplaza a extraccion.ts si
// config.extraction.mode = 'manos'). Todo pasa en la placa, en el plano general:
//   0,0  el pecho del cerdo se agrieta → 0,6 s las costillas se quiebran hacia afuera, la sangre (plana)
//        se derrama y el corazón queda latiendo, rojo, en la cavidad.
//   1,2  RECEPTOR · retire el corazón del donante.
//        El receptor acerca la mano al corazón y la deja ahí un instante: lo agarra. El corazón sigue su
//        mano; al alejarse, los vasos se estiran y se rompen uno por uno (cada muñón late y escupe sangre).
//        Gotea solo cerca del cerdo: llega limpio (§1.3). Al llevárselo a su propio pecho, entra.
//   Si nadie lo toma (o en modo solo), el sistema lo extrae solo: la obra no se detiene (§9.7).
// Mientras tanto se oyen dos corazones: el del cerdo y el del receptor. Al entrar, el del receptor calla y
// el del cerdo pasa a latir de su lado.
import { CubicBezierCurve3, Quaternion, Vector2, Vector3 } from 'three';
import { boneVoice } from '../audio/cues.ts';
import { config } from '../config.ts';
import { LM, LM_STRIDE } from '../input/poseTypes.ts';
import { format } from '../counter.ts';
import { HintRing } from '../render/hintRing.ts';
import type { BodyRig } from '../render/body.ts';
import type { VesselName } from '../render/vessels.ts';
import { deliverHeart, type Show, type State } from './machine.ts';
import { chestFlow, heartDrip, openChestBlood, setupBleeding, stumpFlow } from './sangrado.ts';

const RIB_VOICE = boneVoice('ribs');
const VESSELS: VesselName[] = ['pulmonary', 'svc', 'ivc', 'aorta'];
/** Al llegar, la carne se vuelve placa mientras aparece el corazón del receptor (s). */
const BECOME = 0.9;
const OPEN_AT = 0.6;
const ASK_AT = 1.2;

type Phase = 'abrir' | 'esperar' | 'tomado' | 'auto' | 'llego' | 'entregado';
let phase: Phase = 'abrir';
let tOpen = 0;
let tIdle = 0;
let dwell = 0;
let putDwell = 0;
/** Anillos de gesto: sobre el corazón (tomarlo) y sobre el pecho del receptor (metérselo). */
let ringGrab: HintRing | null = null;
let ringPut: HintRing | null = null;
const heartPos = new Vector3();
let lost = 0;
let grabAt = 0;
let autoAt = 0;
let arriveAt = 0;
let snapped = 0;
let lastSnap = -1;
/** Mano que tiene el corazón (y la más cercana mientras se busca). */
let hand: 'Left' | 'Right' | null = null;
let closest: 'Left' | 'Right' = 'Right';
const said = new Set<string>();
const once = (k: string) => (said.has(k) ? false : (said.add(k), true));

const home = new Vector3();
const cavity = new Vector3();
const goal = new Vector3();
const recHeart = new Vector3();
const targetQ = new Quaternion();
const targetS = new Vector3();
const autoFrom = new Vector3();
const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3());
const ARC = new Vector3(0, 0.3, 0.1);
const tmp = new Vector3();
const tmp2 = new Vector3();
const depthV = new Vector3();
const fwdV = new Vector3();
const span = new Vector2();
const rel = new Vector2();
const nHeart = new Vector2();
const nHome = new Vector2();
const nRec = new Vector2();
const nHand = new Vector2();

/** Mouse como mano del receptor (G → Extracción → debugMouse): para probar sin dos personas. */
const mouse = new Vector2(9, 9);
let mouseOn = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    // El canvas se espeja por CSS: el mouse se lleva al espacio de render.
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.set(config.mirror ? -x : x, 1 - (e.clientY / window.innerHeight) * 2);
    mouseOn = true;
  });
}

function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
function ramp(t: number, t0: number, len: number): number {
  return Math.min(1, Math.max(0, (t - t0) / len));
}

/** Punto de mundo → NDC (x corregido por aspecto para medir distancias). */
function ndc(s: Show, p: Vector3, out: Vector2): Vector2 {
  tmp2.copy(p).project(s.stage.camera);
  return out.set(tmp2.x * (window.innerWidth / Math.max(1, window.innerHeight)), tmp2.y);
}

/** Punto de mundo sobre el rayo de cámara que pasa por `n` (NDC con aspecto), a la profundidad de `depth`. */
function worldAt(s: Show, n: Vector2, depth: Vector3, out: Vector3): Vector3 {
  const cam = s.stage.camera;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  depthV.copy(depth);
  out.set(n.x / aspect, n.y, 0.5).unproject(cam);
  const o = cam.getWorldPosition(tmp2);
  out.sub(o).normalize();
  const fwd = cam.getWorldDirection(fwdV).normalize();
  const dz = depthV.sub(o).dot(fwd);
  return out.multiplyScalar(dz / Math.max(1e-3, out.dot(fwd))).add(o);
}

/** Landmarks de la mano por lado (MediaPipe: muñeca; índice y meñique marcan hacia dónde van los dedos). */
const HAND_LM = {
  Left: { wrist: LM.L_WRIST, a: LM.L_INDEX, b: LM.L_PINKY },
  Right: { wrist: LM.R_WRIST, a: LM.R_INDEX, b: LM.R_PINKY },
} as const;
const segA = new Vector2();
const segB = new Vector2();
const onSeg = new Vector2();
const v2 = new Vector2();
const cand = new Vector2();

/** Landmark 2D (u,v de video) → NDC con aspecto, en el espacio de render (sin espejo). */
function lmNdc(s: Show, lm: Float32Array, i: number, out: Vector2): number {
  const o = i * LM_STRIDE;
  const P = s.stage.projection;
  let [x, y] = P.videoToScreen(lm[o], lm[o + 1]);
  // A píxel de la pared (con espejo) → espacio de render (el CSS espeja el canvas).
  if (config.mirror) x = P.canvasW - x;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  out.set(((x / P.canvasW) * 2 - 1) * aspect, 1 - (y / P.canvasH) * 2);
  return lm[o + 3];
}

/** Punto del segmento a→b más cercano a `p`. */
function closestOnSegment(a: Vector2, b: Vector2, p: Vector2, out: Vector2): Vector2 {
  v2.subVectors(b, a);
  const l2 = v2.lengthSq();
  const t = l2 > 1e-9 ? Math.min(1, Math.max(0, v2.dot(onSeg.subVectors(p, a)) / l2)) : 0;
  return out.copy(a).addScaledVector(v2, t);
}

/** Mano vista por la cámara como SEGMENTO: de la muñeca hasta la punta de los dedos (los landmarks de
 *  índice y meñique están a media mano; la punta se extrapola). Falso si la mano no se ve. */
function handSegmentLm(s: Show, lm: Float32Array, side: 'Left' | 'Right', a: Vector2, b: Vector2): boolean {
  const H = HAND_LM[side];
  const vw = lmNdc(s, lm, H.wrist, a);
  const vi = lmNdc(s, lm, H.a, b);
  const vp = lmNdc(s, lm, H.b, onSeg);
  if (vi < 0.2 && vp < 0.2) return false;
  // Mitad de los dedos (índice y meñique, ponderados por visibilidad).
  const wsum = Math.max(1e-3, (vi >= 0.2 ? vi : 0) + (vp >= 0.2 ? vp : 0));
  b.multiplyScalar((vi >= 0.2 ? vi : 0) / wsum).addScaledVector(onSeg, (vp >= 0.2 ? vp : 0) / wsum);
  if (vw < 0.2) {
    a.copy(b);
    return true;
  }
  // Punta de los dedos: un poco más allá de los nudillos.
  b.sub(a).multiplyScalar(1.7).add(a);
  return true;
}

/** Mano del esqueleto dibujado como segmento (muñeca → punta): lo que el visitante ve en la pared. */
function handSegmentBone(s: Show, r: BodyRig, side: 'Left' | 'Right', a: Vector2, b: Vector2): void {
  const w = r.armature.bones[`${side}Hand`];
  const e = r.armature.bones[`${side}Hand_End`];
  w.updateWorldMatrix(true, false);
  ndc(s, tmp.setFromMatrixPosition(w.matrixWorld), a);
  if (e) {
    e.updateWorldMatrix(true, false);
    ndc(s, tmp.setFromMatrixPosition(e.matrixWorld), b);
  } else b.copy(a);
}

/** Mano del receptor en NDC: el punto de la mano (de la cámara o del esqueleto dibujado, toda la mano de
 *  la muñeca a los dedos) más cercano al corazón. Así "tocar" es superponer la mano, no acertar un punto. */
function receptorHand(s: Show, r: BodyRig, out: Vector2): boolean {
  if (config.extraction.debugMouse && mouseOn) {
    out.copy(mouse);
    out.x *= window.innerWidth / Math.max(1, window.innerHeight);
    return true;
  }
  const person = s.person(r.personId);
  if (r.virtual || !person) return false;
  let best = Infinity;
  // `cand` es un borrador propio: `out` suele ser nHand y no se puede pisar con candidatos peores.
  const consider = (side: 'Left' | 'Right') => {
    closestOnSegment(segA, segB, nHeart, cand);
    const dd = cand.distanceTo(nHeart);
    if (dd < best) {
      best = dd;
      out.copy(cand);
      closest = side;
    }
  };
  for (const side of ['Left', 'Right'] as const) {
    if (hand && side !== hand) continue;
    if (handSegmentLm(s, person.lm2d, side, segA, segB)) consider(side);
    handSegmentBone(s, r, side, segA, segB);
    consider(side);
  }
  return best < Infinity;
}

function heartPivot(s: Show) {
  return s.donor?.organ('heart')?.pivot ?? null;
}

/** El receptor recibe el corazón: sus órganos se encienden (en modo solo, solo el corazón). */
function receive(s: Show): void {
  const r = s.receptor;
  if (!r) return;
  r.layers.organs = 1;
  for (const o of r.organs) if (o.name === 'heart' || s.solo) o.fade = 0;
}

export const extraccionManos: State = {
  name: 'EXTRACCION',
  enter(s) {
    phase = 'abrir';
    tOpen = tIdle = dwell = putDwell = lost = grabAt = autoAt = arriveAt = 0;
    ringGrab ??= new HintRing();
    ringPut ??= new HintRing();
    ringGrab.hide();
    ringPut.hide();
    snapped = 0;
    lastSnap = -1;
    hand = null;
    said.clear();
    s.labels.hideAll();
    s.heartFrom = 'donante';
    s.heartLevel = 0;
    s.monitor = 1;
    s.ownLevel = config.audio.heartOwn;
    s.post.letterbox = 0;
    s.stage.cinematic = false;
    const d = s.donor;
    const hp = heartPivot(s);
    if (hp) {
      if (!s.heartHomeSet) {
        s.heartHome.copy(hp.position);
        s.heartHomeQuat.copy(hp.quaternion);
        s.heartHomeScale.copy(hp.scale);
        s.heartHomeSet = true;
      }
      hp.position.copy(s.heartHome);
      hp.quaternion.copy(s.heartHomeQuat);
      hp.scale.copy(s.heartHomeScale);
      home.copy(hp.position);
    }
    if (d) {
      d.setFleshHeart(false);
      d.cineHeart?.reset();
      d.cineHeart?.setBlood(1);
      d.cineHeart?.setXray(0);
      const scale = d.root.scale.x;
      cavity.copy(d.frozenJoints.Spine2 ?? d.chestWorld(cavity));
      cavity.y -= 0.03 * scale;
      cavity.z += 0.08 * scale;
    }
    s.cues.setHum(0.15);
    setupBleeding(s);
  },
  update(s, t) {
    const d = s.donor;
    const r = s.receptor;
    if (!d || !r) return 'ESPERA';
    const X = config.extraction;
    const scale = d.root.scale.x;
    const pan = s.pan(d);
    const dt = s.clocks.dtReal;
    s.clocks.timeScale = 1;

    // El pecho se agrieta y se abre; el corazón queda rojo en la cavidad.
    if (t < OPEN_AT) d.crackPigRibs(Math.pow(t / OPEN_AT, 1.4), cavity, 0.065 * scale);
    if (once('grieta')) s.cues.crackle(pan, RIB_VOICE, 0.5);
    if (t >= OPEN_AT && phase === 'abrir') {
      phase = 'esperar';
      tOpen = tIdle = t;
      d.breakRibsPhysics(cavity, config.cinematic.ribSpeed * 0.6, config.cinematic.ribSpin);
      s.debris.spray(cavity, 0.08, scale, 1.1);
      s.cues.snap(pan, RIB_VOICE, 1.2);
      s.cues.sub(0.7);
      s.cues.splat(pan, 0.8);
      s.stage.shake.kick(6);
      d.setFleshHeart(true);
      openChestBlood(s);
      // Mientras sangra, la saturación cae: cada pitido del monitor suena un poco más grave.
      s.spo2Target = 68;
      s.spo2Rate = 1.1;
    }
    // Se ve el corazón: la piel del cerdo baja, pulmones e hígado se van.
    d.layers.skin = 1 - 0.7 * ramp(t, 0, OPEN_AT);
    d.layers.muscle = 0;
    for (const o of d.organs) if (o.name !== 'heart') o.fade = 1 - ramp(t, OPEN_AT, 0.4);

    // La guía dice qué hacer en cada momento.
    const G = config.guide;
    s.guide(
      phase === 'abrir' || t < ASK_AT ? config.guide.huesos
        : phase === 'esperar' ? G.tomar
        : phase === 'tomado' ? G.llevar
        : phase === 'auto' ? G.auto
        : G.trasplante,
    );

    const hp = heartPivot(s);
    const rh = r.organ('heart');
    r.heartWorld(recHeart);
    if (rh) rh.pivot.matrixWorld.decompose(tmp, targetQ, targetS);
    const tOpened = phase === 'abrir' ? 0 : t - tOpen;

    if (hp && phase !== 'abrir' && phase !== 'entregado') {
      hp.updateWorldMatrix(true, false);
      ndc(s, tmp.setFromMatrixPosition(hp.matrixWorld), nHeart);
      ndc(s, home, nHome);
      ndc(s, recHeart, nRec);
      span.subVectors(nRec, nHome);
      const prog = Math.min(1, Math.max(0, rel.subVectors(nHeart, nHome).dot(span) / Math.max(1e-4, span.lengthSq())));

      // ── Tomarlo: la mano se queda sobre el corazón hasta que se llena el anillo ──
      const hasHand = receptorHand(s, r, nHand);
      heartPos.setFromMatrixPosition(hp.matrixWorld);
      if (phase === 'esperar') {
        ringGrab?.show(heartPos, dwell / Math.max(1e-3, X.grabDwell), X.grabRadius);
        ringPut?.hide();
        if (hasHand && nHand.distanceTo(nHeart) < X.grabRadius) {
          dwell += dt;
          if (dwell >= X.grabDwell) {
            phase = 'tomado';
            grabAt = t;
            hand = closest;
            putDwell = 0;
            ringGrab?.hide();
            s.labels.hide('pedido');
            s.monitor = 0;
            s.alarm();
            d.cineHeart?.activate();
            s.cues.fleshTear(pan, 0.9, 1);
          }
        } else dwell = Math.max(0, dwell - dt * 0.5); // un temblor fuera de la zona no borra lo cargado
        // Nadie lo toma (o modo solo): lo saca el sistema.
        if (phase === 'esperar' && (s.solo || t - tIdle > X.autoAfter)) {
          phase = 'auto';
          autoAt = t;
          autoFrom.copy(hp.position);
          ringGrab?.hide();
          s.labels.hide('pedido');
          s.monitor = 0;
          s.alarm();
          d.cineHeart?.activate();
          s.cues.fleshTear(pan, 0.9, 1);
        }
      }

      // ── El corazón sigue a la mano (o al recorrido automático) ──
      if (phase === 'tomado') {
        if (hasHand) {
          lost = 0;
          worldAt(s, nHand, tmp.lerpVectors(home, recHeart, prog), goal);
        } else if ((lost += dt) > 3) {
          // Se fue la mano: el corazón queda donde está y se puede volver a tomar.
          phase = 'esperar';
          tIdle = t;
          dwell = 0;
          hand = null;
        }
        if (t - grabAt > X.deliverAfter) {
          phase = 'auto';
          autoAt = t;
          autoFrom.copy(hp.position);
        }
        hp.position.lerp(goal, 1 - Math.exp(-X.follow * dt));
      } else if (phase === 'auto') {
        curve.v0.copy(autoFrom);
        curve.v1.copy(autoFrom).add(ARC);
        curve.v2.copy(recHeart).add(ARC);
        curve.v3.copy(recHeart);
        curve.getPoint(ease((t - autoAt) / X.autoTime), hp.position);
      }
      if (phase === 'tomado' || phase === 'auto') {
        hp.quaternion.slerpQuaternions(s.heartHomeQuat, targetQ, prog);
        hp.scale.lerpVectors(s.heartHomeScale, targetS, prog);
        // Los vasos ceden a medida que el corazón se aleja del pecho.
        const pulled = hp.position.distanceTo(home) / scale;
        while (snapped < VESSELS.length && pulled >= X.snapAt[snapped]) {
          const name = VESSELS[snapped++];
          lastSnap = t;
          if (d.cineHeart?.snap(name)) {
            s.stage.shake.kick(name === 'aorta' ? 5 : 3);
            s.cues.vesselSnap(pan, name === 'aorta' ? 1 : 0.75);
            s.cues.fleshTear(pan, 0.35, 0.6);
          }
        }
        // Metérselo: el corazón sobre el propio pecho hasta que se llena el anillo (o el envío automático llega).
        let inside = false;
        if (phase === 'tomado') {
          ringPut?.show(recHeart, putDwell / Math.max(1e-3, X.deliverDwell), X.deliverRadius);
          if (nHeart.distanceTo(nRec) < X.deliverRadius && prog > 0.4) putDwell += dt;
          else putDwell = Math.max(0, putDwell - dt * 0.5);
          inside = putDwell >= X.deliverDwell;
        } else inside = t - autoAt >= X.autoTime;
        if (inside && snapped === VESSELS.length) {
          ringPut?.hide();
          phase = 'llego';
          arriveAt = t;
          receive(s);
          s.ownLevel = 0;
          s.cues.beep(880, 0.1, 0.12, s.pan(r));
          s.post.flash = Math.max(s.post.flash, 0.3);
        }
      }
      // La sangre se queda del lado del donante: a mitad de camino ya no le queda nada (§1.3).
      d.cineHeart?.setBlood(1 - ease((prog - 0.15) / 0.35));
      if (phase === 'tomado' || phase === 'auto') heartDrip(s, hp, 1 - ease(prog / 0.5), dt);
    }

    // ── Ya adentro: sigue al receptor mientras la carne se vuelve placa ──
    if (hp && phase === 'llego') {
      hp.position.copy(recHeart);
      hp.quaternion.copy(targetQ);
      hp.scale.copy(targetS);
      d.cineHeart?.setXray(ramp(t, arriveAt, BECOME));
      if (t >= arriveAt + BECOME) {
        phase = 'entregado';
        d.setFleshHeart(false);
        deliverHeart(s);
      }
    }
    // El corazón propio del receptor se retira antes de que llegue el nuevo y aparece mientras entra.
    if (rh && !s.solo && phase !== 'llego' && phase !== 'entregado') {
      hp?.updateWorldMatrix(true, false);
      const near = hp ? ndc(s, tmp.setFromMatrixPosition(hp.matrixWorld), nHeart).distanceTo(ndc(s, recHeart, nRec)) : 9;
      rh.fade = Math.min(1, Math.max(0, (near - X.deliverRadius) / (X.deliverRadius * 2)));
    }
    if (rh && (phase === 'llego' || phase === 'entregado')) rh.fade = ramp(t, arriveAt + 0.15, BECOME - 0.1);
    // Diafragma de luz: las costillas del receptor se abren apenas al entrar el corazón.
    const open = phase === 'llego' || phase === 'entregado' ? 1 - ease((t - arriveAt) / 0.7) : 0;
    r.setDiaphragm(recHeart, config.cinematic.receptorOpen * scale * open, config.cinematic.receptorGlow * open, 0.11 * scale);

    // Sonido: los dos corazones hasta que entra; después, el del cerdo del lado del receptor.
    const arrived = phase === 'llego' || phase === 'entregado';
    s.heartFrom = arrived ? 'receptor' : 'donante';
    s.heartLevel = phase === 'abrir' ? 0.3 : arrived ? 0.85 : 0.8;

    // Sangre: la cavidad mana y decae; cada muñón late y escupe hasta unos segundos después de romperse.
    if (phase !== 'abrir') chestFlow(s, tOpened, dt);
    if (lastSnap >= 0) stumpFlow(s, 1 - ramp(t, lastSnap + 3, 4), dt);

    // Etiqueta de producto que acompaña al corazón desde que se abre el pecho hasta que entra.
    if (hp && phase !== 'abrir' && !arrived) {
      hp.updateWorldMatrix(true, false);
      heartPos.setFromMatrixPosition(hp.matrixWorld);
      s.labels.show('etiqueta', config.guide.tag.replace('{n}', format(s.donorNumber)), {
        anchor: () => heartPos, dx: s.sideOf(d) * 90, dy: -60, align: s.sideOf(d) > 0 ? 'left' : 'right', size: 'small', speed: 45,
      });
    } else s.labels.hide('etiqueta');
    ringGrab?.update(dt, s.stage.camera);
    ringPut?.update(dt, s.stage.camera);

    if (phase === 'entregado' && t >= arriveAt + BECOME + X.afterDelivery) return 'AUSENCIA';
    return null;
  },
  exit(s) {
    ringGrab?.hide();
    ringPut?.hide();
    ringGrab?.update(1, s.stage.camera);
    ringPut?.update(1, s.stage.camera);
    s.labels.hide('etiqueta');
    s.labels.hide('pedido');
    s.ownLevel = 0;
    const r = s.receptor;
    if (r) r.setDiaphragm(recHeart, 0, 0, 0.1);
  },
};
