// TRANSFORMACIÓN (§9.4, ≈ 10 s).
//   A (0–4 s): las 10 ediciones genéticas se imprimen junto al tórax del donante, una cada 0,4 s.
//              Cada "eliminado" apaga un punto de luz dentro del corazón; cada "insertado · humano"
//              hace entrar una partícula blanco cálido que se queda.
//   B (4–10 s): hueso por hueso (cráneo → columna → tórax → escápulas → pelvis → extremidades),
//              cada 0,35 s: hit-stop de 60 ms, sacudida y crujido propio de ese hueso → la grieta se
//              propaga → el hueso humano estalla en fragmentos (Rapier), astillas y polvo → en su
//              lugar crece el de cerdo desde el centro. En el cráneo el hocico se alarga y la cara de
//              la piel se vuelve porcina; con las costillas el tórax se ensancha en barril.
//   Al final el esqueleto de cerdo se congela (§1.5); la piel sigue al visitante.
import { Vector3 } from 'three';
import { boneVoice, type BoneVoice } from '../audio/cues.ts';
import { config } from '../config.ts';
import type { State } from './machine.ts';
import { chestLabel } from './asignacion.ts';

/** Ediciones del cerdo donante (§1.4): 4 genes porcinos eliminados, 6 humanos insertados. */
export const GENES: [string, string][] = [
  ['GGTA1', '─ eliminado'], ['CMAH', '─ eliminado'], ['B4GALNT2', '─ eliminado'], ['GHR', '─ eliminado'],
  ['CD46', '+ insertado · humano'], ['CD55', '+ insertado · humano'], ['THBD', '+ insertado · humano'],
  ['EPCR', '+ insertado · humano'], ['CD47', '+ insertado · humano'], ['HO-1', '+ insertado · humano'],
];

/** Orden de la metamorfosis ósea (§9.4). Los pares izquierda/derecha cambian juntos. */
export const ORDER: string[][] = [
  ['skull'], ['cervical'], ['thoracic'], ['lumbar'], ['ribs', 'cartilage'],
  ['scapula_L', 'scapula_R', 'clavicle_L', 'clavicle_R'], ['pelvis'],
  ['humerus_L', 'humerus_R'], ['forearm_L', 'forearm_R'], ['hand_L', 'hand_R'],
  ['femur_L', 'femur_R'], ['patella_L', 'patella_R'], ['leg_L', 'leg_R'], ['foot_L', 'foot_R'],
];

/** Violencia del estallido por grupo (velocidad de fragmentos, cantidad de astillas). */
const STRENGTH = [1.25, 0.8, 0.85, 0.85, 1.1, 0.9, 1.1, 1, 0.9, 0.7, 1.05, 0.5, 1, 0.7];
const VOICES: BoneVoice[] = ORDER.map((g) => boneVoice(g[0]));

const GENE_STEP = 0.4;
/** La luz del gen cambia cuando su línea terminó de imprimirse. */
const GENE_LIGHT_DELAY = 0.3;
const BONE_START = 4.0;
const BONE_STEP = 0.35;
const SKULL = 0;
const RIBS = 4;
/** Separación entre la columna de eliminados y la de insertados, y ancho del bloque (px). */
/** Avance por carácter y alto de renglón de las etiquetas chicas (px): escalan con los textos. */
const chPx = () => window.innerHeight * 0.0115 * config.labels.scale * 0.68;
const rowPx = () => window.innerHeight * 0.0115 * config.labels.scale * 1.3;

let shownGenes = 0;
let litGenes = 0;
let started: boolean[] = [];
let burst: boolean[] = [];
const from = new Vector3();

function ramp(t: number, t0: number, len: number): number {
  return Math.min(1, Math.max(0, (t - t0) / len));
}

function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Sube de `start` a `peak` (60 % del tiempo) y se asienta en 1: el hocico "brota". */
function overshoot(x: number, start: number, peak: number): number {
  if (x <= 0) return start;
  if (x >= 1) return 1;
  if (x < 0.6) {
    const u = x / 0.6;
    return start + (peak - start) * (1 - (1 - u) * (1 - u) * (1 - u));
  }
  return peak + (1 - peak) * ease((x - 0.6) / 0.4);
}

export const transformacion: State = {
  name: 'TRANSFORMACION',
  enter(s) {
    shownGenes = 0;
    litGenes = 0;
    started = ORDER.map(() => false);
    burst = ORDER.map(() => false);
    s.cues.setHum(0.3);
    s.post.caBase = 1;
    // El monitor del donante empieza a contar sus latidos (saturación normal).
    s.monitor = 1;
    s.spo2 = s.spo2Target = 99;
    s.spo2Rate = 0.5;
    s.heartLevel = 0;
    const d = s.donor;
    if (d) {
      s.debris.setFloor(d.floorY());
      s.genes.reset();
      s.genes.attach(d.organ('heart')?.beat ?? null);
    }
  },
  update(s, t) {
    const d = s.donor;
    if (!d) return 'ESPERA';
    s.ownLevel = config.audio.heartOwn;
    s.guide(t < BONE_START ? config.guide.genes : config.guide.huesos);
    const T = config.transform;
    const pan = s.pan(d);
    const scale = d.root.scale.x;

    // A · edición genética: una columna (primero los eliminados, después los insertados), del lado de
    // afuera del tórax. Medida en caracteres: con letras grandes no se pisa.
    while (shownGenes < GENES.length && t >= shownGenes * GENE_STEP) {
      const i = shownGenes;
      const [gene, what] = GENES[i];
      const row = i + (i >= 4 ? 0.5 : 0);
      const base = chestLabel(s, d, 0);
      const ch = chPx();
      const width = 30 * ch;
      const start = s.sideOf(d) > 0 ? 6 * ch : -6 * ch - width;
      s.labels.show(`gene${i}`, `${gene.padEnd(9)}${what}`, {
        ...base, dx: start, dy: rowPx() * (1.4 + row), align: 'left', size: 'small', speed: 60,
        block: { offset: 0, width },
      });
      s.cues.click(pan);
      shownGenes++;
    }
    while (litGenes < GENES.length && t >= litGenes * GENE_STEP + GENE_LIGHT_DELAY) {
      const i = litGenes++;
      if (i < 4) {
        s.genes.kill(i);
        s.cues.gene(pan, false);
      } else {
        // La partícula entra desde el lado de los textos (en el mundo, con el espejo invertido).
        const side = s.sideOf(d) * (config.mirror ? -1 : 1);
        d.chestWorld(from);
        from.x += side * 0.42 * scale;
        from.y += (0.1 - (i - 4) * 0.03) * scale;
        from.z += 0.06 * scale;
        s.genes.insert(i - 4, from);
        s.cues.gene(pan, true);
      }
    }

    // El corazón se apaga a medias mientras se edita: sobre un blanco saturado los puntos de luz
    // no se verían. Vuelve a su brillo con la metamorfosis.
    const heart = d.organ('heart');
    if (heart) heart.fade = 1 - 0.55 * ramp(t, 0, 0.5) * (1 - ramp(t, BONE_START, 1));

    // Con la metamorfosis, la saturación baja un poco (estrés): el monitor se oye apenas más grave.
    if (t >= BONE_START) s.spo2Target = 94;

    // B · metamorfosis ósea, grupo por grupo.
    ORDER.forEach((group, g) => {
      const lt = t - (BONE_START + g * BONE_STEP);
      if (lt < 0) return;
      const skull = g === SKULL;
      if (!started[g]) {
        started[g] = true;
        s.clocks.hitStop(60);
        s.stage.shake.kick(skull ? T.skullShakePx : T.shakePx * (0.75 + 0.5 * Math.random()));
        // Aberración fuerte solo en el cráneo: repetida en cada hueso ensucia la paleta (§1.2).
        s.post.caPulse = skull ? 1.3 : 0.25;
        s.cues.crackle(pan, VOICES[g], T.crackDelay + T.crackTime);
        if (skull) s.cues.sub(0.55);
      }
      // La grieta se propaga cada vez más rápido.
      const ck = ramp(lt, T.crackDelay, T.crackTime);
      for (const slot of group) d.crackSlot(slot, ck * ck);
      if (!burst[g] && lt >= T.crackDelay + T.crackTime) {
        burst[g] = true;
        for (const slot of group) d.burstSlot(slot, STRENGTH[g]);
        s.cues.snap(pan, VOICES[g], skull ? 1.15 : 0.9);
        s.post.caPulse = Math.max(s.post.caPulse, skull ? 1.6 : 0.35);
        s.stage.shake.kick((skull ? T.skullShakePx : T.shakePx) * 0.8);
        if (skull) s.cues.sub(0.8);
      }
      const grow = ramp(lt, T.growDelay, skull ? T.skullGrowTime : T.growTime);
      for (const slot of group) d.growSlot(slot, grow);
      if (skull) {
        // El cráneo es el momento más fuerte: el hocico brota hacia adelante.
        d.setSnout(overshoot((lt - T.growDelay) / T.snoutTime, T.snoutStart, T.snoutOvershoot));
      }
    });
    // Morph de la piel: la cara con el cráneo, el tórax con las costillas.
    const head = overshoot((t - BONE_START - SKULL * BONE_STEP - T.growDelay) / T.morphTime, 0, 1.06);
    const body = overshoot((t - BONE_START - RIBS * BONE_STEP - T.growDelay) / T.morphTime, 0, 1.04);
    d.setMorph(head, body);
    // El músculo humano se va con la metamorfosis: queda el cerdo y la piel-máscara.
    d.layers.muscle = 1 - ramp(t, BONE_START, 4);
    if (t >= config.show.transformacion) {
      d.instantPig();
      d.freezeSkeleton(s.stage.scene);
      // Congelado = anestesiado (§1.5): desde acá lo mantiene un respirador.
      s.vent = 1;
      return 'EXTRACCION';
    }
    return null;
  },
  exit(s) {
    for (let i = 0; i < GENES.length; i++) s.labels.hide(`gene${i}`);
  },
};
