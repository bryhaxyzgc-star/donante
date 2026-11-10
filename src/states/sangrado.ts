// Coreografía de la sangre (§9.5, §9.6, §10.2) sobre los tiempos de la lista de planos.
//   2,4 s  las costillas se quiebran: primer chorro desde la cavidad + salpicaduras radiales;
//          gotas en la lente (plano 4); empieza el charco; la cavidad sigue manando y decae.
//   5,7 s  el corazón es arrancado: tres muñones (aorta, pulmonar, cava) se abren uno por uno con
//          chorros pulsátiles sincronizados con el latido (reloj real); gotas en la lente (6 y 7).
//   8,5 s  el corazón gotea mientras viaja; a mitad de camino deja de gotear (§1.3: llega limpio).
//   AUSENCIA: goteo de la cavidad cada vez más lento, charco que crece y coagula.
// Las direcciones siempre se alejan del receptor: la sangre es solo del lado del donante.
import { Vector2, Vector3, type Object3D } from 'three';
import { config } from '../config.ts';
import { Blood, type EmitShape } from '../render/blood/blood.ts';
import { PLATE } from '../render/materials/glsl.ts';
import type { Show } from './machine.ts';

const cavity = new Vector3();
const heart = new Vector3();
const tmpD = new Vector3();
/** +1 / -1: hacia dónde queda "afuera" (lejos del receptor) en X de mundo. */
let out = 1;
let scale = 1;
const done = new Set<string>();
const UP_FWD = new Vector3(0, 0.55, 0.45);
/** Latido anterior por muñón: cada sístole es un chorro que se oye. */
const lastBeat = new Map<string, number>();

/** Respaldo sin heart.glb (placeholders): muñones fijos en el corazón. */
const STUMPS: { at: number; dir: [number, number, number]; key: string }[] = [
  { at: 5.7, dir: [0.15, 1.0, 0.55], key: 'aorta' },
  { at: 6.3, dir: [-0.25, 0.75, 0.75], key: 'pulmonar' },
  { at: 6.9, dir: [0.5, 0.25, 0.95], key: 'cava' },
];

function once(key: string): boolean {
  if (done.has(key)) return false;
  done.add(key);
  return true;
}

/** Forma compartida: `stream` y `burst` la copian enseguida, así no se crea nada por frame. */
const SHAPE: EmitShape = { origin: new Vector3(), dir: new Vector3(), speed: 0, spread: 0, jitter: 0, life: 1, radius: 0 };
function shape(origin: Vector3, dir: Vector3, speed: number, spread: number, life: number, radius: number, jitter = 0.35): EmitShape {
  SHAPE.origin.copy(origin);
  SHAPE.dir.copy(dir);
  return Object.assign(SHAPE, { speed, spread, life, radius, jitter });
}

/** Prepara el mundo de la sangre sobre el cerdo congelado (al entrar a la extracción). */
export function setupBleeding(s: Show): void {
  done.clear();
  lastBeat.clear();
  const d = s.donor;
  const r = s.receptor;
  const blood = s.stage.blood;
  if (!d) return;
  scale = d.root.scale.x;
  const j = d.frozenJoints;
  blood.setFloor(d.frozenFloorY());
  blood.setColliders(Blood.capsulesFrom(j, scale));
  // La cavidad: frente del tórax congelado, un poco por debajo del esternón alto.
  cavity.copy(j.Spine2 ?? d.chestWorld(cavity));
  cavity.y -= 0.03 * scale;
  cavity.z += 0.08 * scale;
  out = r ? Math.sign(cavity.x - r.chestWorld(tmpD).x) || 1 : 1;
  blood.setRegion(tmpD.copy(cavity).setY((cavity.y + blood.sim.floorY) / 2 + 0.2));
}

/** Por frame en EXTRACCIÓN. `t` real del estado; `dt` de juego (cámara lenta). */
export function bleedExtraction(s: Show, t: number, dt: number): void {
  const d = s.donor;
  if (!d) return;
  const B = config.blood;
  const blood = s.stage.blood;
  const side = s.screenSide(d);

  // Plano 4: las costillas se abren hacia afuera.
  if (t >= 2.4 && once('costillas')) {
    // Borbotón: coágulos espesos hacia afuera y adelante, más un núcleo que cae del pecho.
    tmpD.set(out * 0.3, 0.2, 1);
    blood.gobs(cavity, tmpD, 14, B.ribBurst / 18, 1.7, 0.75);
    blood.burst(shape(cavity, tmpD.set(out * 0.1, -0.3, 1), 0.9, 0.25, 3.5, 0.03 * scale, 0.3), B.ribBurst * 0.25);
    blood.splash(cavity, 0.07 * scale, 6, 110, tmpD.set(out, 0, 0));
    blood.lens.hit(3, side);
    s.cues.lensTap(side * 0.6);
    blood.startPuddle(tmpD.set(cavity.x + out * 0.04, 0, cavity.z + 0.06), new Vector2(out * 0.3, 1));
    // El charco no crece hacia el receptor: queda al menos a 35 cm de sus pies (§1.3).
    const r = s.receptor;
    if (r) {
      r.chestWorld(heart);
      const dist = Math.hypot(heart.x - tmpD.x, heart.z - tmpD.z);
      blood.puddle.maxRadius = Math.max(0.08, (dist - 0.35) / 1.25);
    }
  }
  if (t >= 2.4 && t < 9.5) {
    // La cavidad mana: fuerte al abrirse y cada vez menos.
    const rate = B.gush * Math.exp(-(t - 2.4) / 1.6) + 140;
    blood.stream('cavidad', shape(cavity, tmpD.set(out * 0.15, -0.35, 1), 0.75, 0.38, 3, 0.03 * scale), rate, dt);
  }
  // Manchas sobre los huesos cuando la sangre ya llegó (las costillas ya se quedaron quietas).
  if (t >= 3.3 && once('manchas1')) {
    blood.splatter(d.pigMeshes(['pelvis', 'lumbar', 'femur_L', 'femur_R']), 5, 0.1 * scale);
    blood.splatter(d.pigMeshes(['ribs']), 3, 0.08 * scale);
  }

  // Plano 6: el corazón sale; los vasos se rompen uno por uno y cada muñón late con el corazón.
  const fade = 1 - Math.min(1, Math.max(0, (t - 9) / 2));
  const beat = d.beat;
  const pulse = (key: string, origin: Vector3, dir: Vector3) => {
    if (once(`vaso:${key}`)) {
      blood.lens.hit(key === 'aorta' ? 2 : 1, side);
      s.cues.lensTap(side * 0.6);
    }
    // Un chorro audible por sístole, sincronizado con el latido.
    const prev = lastBeat.get(key) ?? 0;
    if (beat > 0.5 && prev <= 0.5 && fade > 0.05) s.cues.spurt(s.panOf(origin), 0.75 * fade);
    lastBeat.set(key, beat);
    blood.stream(
      key,
      shape(origin, dir, (1.5 + 1.8 * beat) * fade + 0.3, 0.045, 3, 0.004 * scale, 0.12),
      B.arterial * (0.25 + 0.75 * beat) * fade,
      dt,
    );
  };
  const stumps = d.cineHeart?.stumps;
  if (stumps && d.cineHeart && t <= 11) {
    // Muñones reales de los vasos (vessels.ts): el chorro sale por donde se cortó, hacia arriba y
    // adelante, nunca hacia el receptor.
    for (const st of stumps) {
      tmpD.copy(st.dir).multiplyScalar(0.55).add(UP_FWD);
      if (tmpD.x * out < 0) tmpD.x *= -0.3;
      pulse(st.name, st.pos, tmpD.normalize());
    }
  } else {
    heart.copy(s.heartHome);
    if (!s.heartHomeSet) d.heartWorld(heart);
    for (const st of STUMPS) {
      if (t < st.at || t > 11) continue;
      pulse(st.key, heart, tmpD.set(st.dir[0] * out, st.dir[1], st.dir[2]));
    }
  }
  // Plano 7: más gotas en la lente.
  if (t >= 7.5 && once('lente7')) {
    blood.lens.hit(4, side);
    s.cues.lensTap(side * 0.6);
  }
  if (t >= 7.0 && once('manchas2')) {
    blood.splatter(d.pigMeshes(['skull', 'cervical', 'scapula_L', 'scapula_R', 'humerus_L', 'humerus_R']), 6, 0.08 * scale);
  }
  if (t >= 9.0 && once('manchas3')) {
    blood.splatter(d.pigMeshes(['pelvis', 'femur_L', 'femur_R', 'leg_L', 'leg_R']), 4, 0.09 * scale);
  }

  // Plano 8: el corazón gotea solo la primera mitad del trayecto (llega limpio, §1.3).
  if (t >= 8.5 && t < 9.95) {
    const hp = d.organ('heart')?.pivot;
    if (hp) {
      hp.updateWorldMatrix(true, false);
      heart.setFromMatrixPosition(hp.matrixWorld);
      blood.stream('corazon', shape(heart, tmpD.set(0, -1, 0.1), 0.25, 0.4, 2.5, 0.02 * scale), B.heartDrip * (1 - (t - 8.5) / 1.45), dt);
      if (Math.random() < dt * 8) s.cues.drip(s.panOf(heart), 0.6);
    }
  }
}

// ── Extracción con las manos (extraccionManos.ts): los mismos chorros, sin planos ni lente ──

const plate = () => PLATE.value > 0.5;

/** Camino del río plano: de la cavidad por el abdomen y la cadera, y baja por una pierna hasta el piso. */
function riverPath(s: Show, leg: 'Left' | 'Right', fromChest: boolean): Vector3[] {
  const d = s.donor!;
  const j = d.frozenJoints;
  const cam = s.stage.camera.getWorldPosition(new Vector3());
  const fwd = cam.sub(cavity).setY(0).normalize();
  const k = (v: Vector3, f: number) => v.clone().addScaledVector(fwd, f * scale);
  const up = j[`${leg}UpLeg`], knee = j[`${leg}Leg`], foot = j[`${leg}Foot`];
  const side = up.clone().sub(j.Hips).setY(0).normalize();
  const pts: Vector3[] = [];
  if (fromChest) pts.push(k(cavity, 0.02), k(j.Spine, 0.085));
  pts.push(
    k(j.Hips, 0.07).addScaledVector(side, 0.05 * scale),
    k(up, 0.055),
    k(up.clone().lerp(knee, 0.5), 0.05),
    k(knee, 0.05),
    k(knee.clone().lerp(foot, 0.5), 0.045),
    k(foot, 0.05),
  );
  const end = k(foot, 0.14);
  end.y = s.stage.blood.sim.floorY + 0.004;
  pts.push(end);
  return pts;
}

/** El pecho se abre (una vez): borbotón hacia afuera, salpicaduras y el charco que empieza. */
export function openChestBlood(s: Show): void {
  const B = config.blood;
  const blood = s.stage.blood;
  if (plate() && s.donor) {
    // Placa real: dos ríos planos que bajan por el cuerpo; el de la pierna de afuera (lejos del receptor) primero.
    const j = s.donor.frozenJoints;
    const outLeg = (j.LeftUpLeg.x - j.RightUpLeg.x) * out > 0 ? 'Left' : 'Right';
    const inLeg = outLeg === 'Left' ? 'Right' : 'Left';
    const main = riverPath(s, outLeg, true);
    blood.startRivers([
      { points: main, halfWidth: B.riverWidth * scale, delay: 0 },
      { points: riverPath(s, inLeg, false), halfWidth: B.riverWidth * 0.6 * scale, delay: 1.4 },
    ]);
    for (const r of blood.rivers) r.speed = B.riverSpeed;
    blood.splash(cavity, 0.05 * scale, 4, 60, tmpD.set(out, 0, 0));
    blood.startPuddle(main[main.length - 1], new Vector2(out * 0.3, 1));
    return;
  }
  tmpD.set(out * 0.3, 0.2, 1);
  blood.gobs(cavity, tmpD, 14, B.ribBurst / 18, 1.7, 0.75);
  blood.burst(shape(cavity, tmpD.set(out * 0.1, -0.3, 1), 0.9, 0.25, 3.5, 0.03 * scale, 0.3), B.ribBurst * 0.25);
  blood.splash(cavity, 0.07 * scale, 6, 110, tmpD.set(out, 0, 0));
  blood.startPuddle(tmpD.set(cavity.x + out * 0.04, 0, cavity.z + 0.06), new Vector2(out * 0.3, 1));
  const r = s.receptor;
  if (r) {
    r.chestWorld(heart);
    const dist = Math.hypot(heart.x - tmpD.x, heart.z - tmpD.z);
    blood.puddle.maxRadius = Math.max(0.08, (dist - 0.35) / 1.25);
  }
}

/** La cavidad mana: fuerte al abrirse y cada vez menos (`t` desde que se abrió). */
export function chestFlow(s: Show, t: number, dt: number): void {
  const d = s.donor;
  if (!d || t > 8) return;
  const B = config.blood;
  if (plate()) {
    // El río mana fuerte al abrirse y se va calmando (los muñones lo vuelven a hinchar con cada latido).
    if (!d.cineHeart?.stumps?.length) s.stage.blood.setRiverFlow(0.55 + 0.45 * Math.exp(-t / 4));
    return;
  }
  const rate = B.gush * Math.exp(-t / 1.6) + 140;
  s.stage.blood.stream('cavidad', shape(cavity, tmpD.set(out * 0.15, -0.35, 1), 0.75, 0.38, 3, 0.03 * scale), rate, dt);
  if (t >= 0.9 && once('manos:manchas1')) {
    s.stage.blood.splatter(d.pigMeshes(['pelvis', 'lumbar', 'femur_L', 'femur_R']), 5, 0.1 * scale);
    s.stage.blood.splatter(d.pigMeshes(['ribs']), 3, 0.08 * scale);
  }
  if (t >= 3 && once('manos:manchas2')) {
    s.stage.blood.splatter(d.pigMeshes(['pelvis', 'femur_L', 'femur_R', 'leg_L', 'leg_R']), 4, 0.09 * scale);
  }
}

/** Cada muñón late con el corazón (reloj real) y escupe hacia arriba y afuera, nunca hacia el receptor. */
export function stumpFlow(s: Show, fade: number, dt: number): void {
  const d = s.donor;
  const stumps = d?.cineHeart?.stumps;
  if (!d || !stumps || fade <= 0.01) return;
  const B = config.blood;
  const beat = d.beat;
  if (plate()) {
    // Placa real: nada sale disparado; cada latido hincha el río que baja.
    s.stage.blood.setRiverFlow(0.7 + 0.45 * beat * fade);
    if (beat > 0.5 && (lastBeat.get('rio') ?? 0) <= 0.5) s.cues.spurt(s.panOf(cavity), 0.35 * fade);
    lastBeat.set('rio', beat);
    return;
  }
  for (const st of stumps) {
    tmpD.copy(st.dir).multiplyScalar(0.55).add(UP_FWD);
    if (tmpD.x * out < 0) tmpD.x *= -0.3;
    tmpD.normalize();
    const prev = lastBeat.get(st.name) ?? 0;
    if (beat > 0.5 && prev <= 0.5) s.cues.spurt(s.panOf(st.pos), 0.75 * fade);
    lastBeat.set(st.name, beat);
    s.stage.blood.stream(st.name, shape(st.pos, tmpD, (1.5 + 1.8 * beat) * fade + 0.3, 0.045, 3, 0.004 * scale, 0.12), B.arterial * (0.25 + 0.75 * beat) * fade, dt);
  }
}

/** El corazón gotea mientras está cerca del cerdo (`amount` 0..1; a mitad de camino ya no). */
export function heartDrip(s: Show, hp: Object3D, amount: number, dt: number): void {
  if (amount <= 0.01) return;
  hp.updateWorldMatrix(true, false);
  heart.setFromMatrixPosition(hp.matrixWorld);
  s.stage.blood.stream('corazon', shape(heart, tmpD.set(0, -1, 0.1), 0.25, 0.4, 2.5, 0.02 * scale), config.blood.heartDrip * amount, dt);
  if (Math.random() < dt * 8 * amount) s.cues.drip(s.panOf(heart), 0.6);
}

/** Por frame en AUSENCIA: la cavidad gotea cada vez menos hasta que empieza el borrado. */
export function bleedAbsence(s: Show, t: number, dt: number, stopAt: number): void {
  if (!s.donor || t >= stopAt) return;
  const B = config.blood;
  if (plate()) {
    // El río se queda, cada vez más delgado (el borrado lo limpia).
    s.stage.blood.setRiverFlow(0.25 + 0.4 * Math.exp(-t / 6));
    return;
  }
  const rate = B.cavityDrip * Math.exp(-t / 6);
  s.stage.blood.stream('goteo', shape(cavity, tmpD.set(0, -1, 0.15), 0.12, 0.5, 3, 0.03 * scale, 0.5), rate, dt);
  // Cada gota que llega al charco suena (un plip, cada vez más espaciado).
  if (Math.random() < (rate / 60) * dt * 3) s.cues.drip(s.panOf(cavity), 0.5 + Math.random() * 0.5);
}
