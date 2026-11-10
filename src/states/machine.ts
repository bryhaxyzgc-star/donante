// Máquina de estados (§8): ESPERA → PLACA → ASIGNACIÓN → TRANSFORMACIÓN → EXTRACCIÓN → AUSENCIA → ESPERA.
// `Show` es el contexto compartido: cuerpos, personas, roles, textos, sonido y escena.
// Regla §9.7: la obra nunca se detiene por nadie; los cuerpos con rol conservan su última pose.
import { Quaternion, Vector3 } from 'three';
import { config } from '../config.ts';
import type { Clocks } from '../clock.ts';
import type { Counter } from '../counter.ts';
import type { Cues } from '../audio/cues.ts';
import type { Person, PeopleTracker } from '../input/people.ts';
import type { BodyRig } from '../render/body.ts';
import type { Debris } from '../render/fracture.ts';
import { GeneLights } from '../render/geneLights.ts';
import type { Labels } from '../render/labels.ts';
import { ScanRing } from '../render/scanRing.ts';
import type { Stage } from '../render/stage.ts';

export type StateName = 'ESPERA' | 'PLACA' | 'ASIGNACION' | 'TRANSFORMACION' | 'EXTRACCION' | 'AUSENCIA';

export interface State {
  name: StateName;
  enter(s: Show): void;
  /** `t` = segundos reales desde que se entró; devuelve el próximo estado o null. */
  update(s: Show, t: number, dt: number): StateName | null;
  exit?(s: Show): void;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const wallTmp = { x: 0, y: 0 };
/** Fase del ciclo en que empieza la contracción ventricular (el "lub", ver body.ts → cardiac). */
const SYSTOLE = 0.12;

export class Show {
  readonly stage: Stage;
  readonly people: PeopleTracker;
  readonly bodies: BodyRig[];
  readonly labels: Labels;
  readonly counter: Counter;
  readonly cues: Cues;
  readonly clocks: Clocks;
  readonly rings: ScanRing[];
  /** Fragmentos, astillas y polvo (espacio de mundo). */
  readonly debris: Debris;
  /** Luces de la edición genética: viajan dentro del corazón del donante (§9.4 A). */
  readonly genes = new GeneLights();
  donor: BodyRig | null = null;
  receptor: BodyRig | null = null;
  solo = false;
  donorNumber = 0;
  /** (Sin uso: la obra necesita dos personas; ya no hay modo solo.) */
  forceSolo = false;
  /** El corazón del donante ya está en el receptor. */
  heartDelivered = false;
  /** Posición del corazón congelado antes de la extracción (para repetir con X). */
  readonly heartHome = new Vector3();
  readonly heartHomeQuat = new Quaternion();
  readonly heartHomeScale = new Vector3(1, 1, 1);
  heartHomeSet = false;
  /** Los cuerpos se asignan a personas (PLACA) o no (ESPERA). */
  assigning = false;
  /** Latido audible (§13): de qué corazón viene y a qué volumen; lo fijan los estados. */
  heartLevel = 0;
  heartFrom: 'donante' | 'receptor' = 'donante';
  /** Monitor del donante: un beep por latido (0 = apagado). */
  monitor = 0;
  /** Latido humano propio del receptor, antes de recibir el corazón del cerdo (lo fijan los estados). */
  ownLevel = 0;
  /** Saturación del donante (%): el tono del monitor baja con ella. Los estados fijan a dónde va y a
   *  qué velocidad (%/s); la oscilación chica la da `updateBodies`. */
  spo2 = 99;
  spo2Target = 99;
  spo2Rate = 0.5;
  /** Respirador del cerdo anestesiado (0 = apagado, 1 = a nivel de config). */
  vent = 0;
  private ventPhase = 0;
  private lastPhase = 0;
  private lastSource: BodyRig | null = null;
  private lastOwnPhase = -1;
  /** Lado de la pantalla hacia el que van los textos del donante (el del receptor es el opuesto).
   *  Se fija al decidir los roles para que los textos no salten si alguien cruza el centro. */
  private donorSide = 1;

  constructor(o: {
    stage: Stage; people: PeopleTracker; bodies: BodyRig[]; labels: Labels; counter: Counter; cues: Cues; clocks: Clocks; debris: Debris;
  }) {
    this.stage = o.stage;
    this.people = o.people;
    this.bodies = o.bodies;
    this.labels = o.labels;
    this.counter = o.counter;
    this.cues = o.cues;
    this.clocks = o.clocks;
    this.rings = this.bodies.map(() => new ScanRing());
    for (const r of this.rings) this.stage.scene.add(r.mesh);
    this.debris = o.debris;
    this.stage.scene.add(this.debris.group);
    this.debris.onImpact = (p, size) => this.cues.clack(this.panOf(p), size);
  }

  get post() {
    return this.stage.post;
  }

  /** Guía para el público: una o dos líneas grandes arriba al centro (null = se oculta). */
  guide(text: string | null): void {
    if (!text || !config.guide.enabled) this.labels.hide('guia');
    else this.labels.show('guia', text, { x: 0.5, y: 0.1, align: 'center', size: 'guide', speed: 40 });
  }

  person(id: number | null): Person | null {
    if (id === null) return null;
    return this.people.people.find((p) => p.id === id) ?? null;
  }

  activePeople(): Person[] {
    return this.people.people.filter((p) => p.state !== 'leaving');
  }

  bodyOf(p: Person): BodyRig | undefined {
    return this.bodies.find((b) => b.personId === p.id);
  }

  roleOf(personId: number): string {
    if (this.donor?.personId === personId) return 'donante';
    if (this.receptor?.personId === personId) return 'receptor';
    return '—';
  }

  /** PLACA: cada persona visible recibe un cuerpo del pool (máx. 2, §7). */
  syncAssignments(): void {
    if (!this.assigning) return;
    for (const p of this.activePeople()) {
      if (this.bodyOf(p)) continue;
      const free = this.bodies.find((b) => b.free);
      if (!free) break;
      free.assign(p.id);
      // El equipo dispara: ánodo, pitido de exposición mientras dura el barrido (0,8 s) y el barrido.
      this.cues.xrayShot(this.pan(free), 0.8);
      this.cues.sweep(this.pan(free));
    }
  }

  /** ¿Este cuerpo está del lado del proveedor (donante) en la sala? Con roles por posición (§9.3). */
  onDonorSide(b: BodyRig): boolean {
    const left = this.pan(b) < 0;
    return config.roles.donorSide === 'izquierda' ? left : !left;
  }

  /** Decide los roles entre dos personas (§9.3): por el círculo del piso donde está cada una
   *  (`config.roles.mode` = 'posicion') o al azar. */
  decideRoles(): boolean {
    const assigned = this.activePeople().map((p) => this.bodyOf(p)).filter((b): b is BodyRig => !!b);
    if (!assigned.length) return false;
    // La obra necesita dos personas: sin modo solo.
    if (assigned.length < 2) return false;
    const solo = false;
    this.forceSolo = false;
    if (solo) {
      const donor = assigned[0];
      const other = this.bodies.find((b) => b !== donor)!;
      if (other.personId !== null) other.release();
      other.resetCycle();
      // Receptor vacío quieto al otro lado, hacia el centro de la imagen.
      const side = donor.root.position.x > 0 ? -1 : 1;
      tmp.copy(donor.root.position);
      tmp.x += side * config.show.soloOffset * donor.root.scale.x;
      other.makeVirtual(tmp, donor.root.scale.x);
      this.donor = donor;
      this.receptor = other;
    } else if (config.roles.mode === 'posicion') {
      // El proveedor es quien está más hacia su lado de la sala (aunque los dos estén del mismo lado).
      const [a, b] = assigned;
      const aIsDonor = config.roles.donorSide === 'izquierda' ? this.pan(a) <= this.pan(b) : this.pan(a) >= this.pan(b);
      this.donor = aIsDonor ? a : b;
      this.receptor = aIsDonor ? b : a;
    } else {
      const k = Math.random() < 0.5 ? 0 : 1;
      this.donor = assigned[k];
      this.receptor = assigned[1 - k];
    }
    this.solo = solo;
    this.donor.hold = true;
    this.receptor.hold = true;
    this.donorNumber = this.counter.next;
    this.heartDelivered = false;
    // Desde acá las dos personas quedan amarradas hasta el fin del ciclo.
    this.people.lock([this.donor.personId, this.receptor.personId]);
    // Textos hacia afuera: cada uno del lado contrario al otro cuerpo.
    this.receptor.chestWorld(tmp2);
    this.donorSide = this.pan(this.donor) >= this.panOf(tmp2) ? 1 : -1;
    console.info(`[roles] donante = cuerpo ${this.donor.index} (persona ${this.donor.personId ?? '—'}), receptor = cuerpo ${this.receptor.index}${solo ? ' (modo solo, virtual)' : ` (persona ${this.receptor.personId})`}`);
    return true;
  }

  /** Fin de ciclo: todo vuelve al estado inicial y los cuerpos se liberan (se desvanecen).
   *  `keepPeople` (saltos del operador): los cuerpos de quienes siguen frente a la cámara se
   *  conservan y los demás quedan libres al instante, para empezar otro ciclo sin esperar. */
  clearRoles(keepPeople = false): void {
    for (const b of this.bodies) {
      b.resetCycle();
      const p = this.person(b.personId);
      if (keepPeople && p && p.state !== 'leaving') continue;
      b.release();
      if (keepPeople) b.presence = 0;
    }
    this.donor = null;
    this.receptor = null;
    this.people.unlock();
    this.solo = false;
    this.heartDelivered = false;
    this.heartHomeSet = false;
    this.genes.attach(null);
    this.stage.blood.clear();
    this.heartLevel = 0;
    this.ownLevel = 0;
    this.monitor = 0;
    this.heartFrom = 'donante';
    this.spo2 = this.spo2Target = 99;
    this.spo2Rate = 0.5;
    this.vent = 0;
  }

  /** Monitor y respirador: la saturación va hacia donde la llevan los estados; el respirador del
   *  cerdo respira a su ritmo (reloj real), del lado del donante. */
  private medical(dt: number): void {
    const d = this.spo2Target - this.spo2;
    this.spo2 += Math.sign(d) * Math.min(Math.abs(d), this.spo2Rate * dt);
    if (this.vent <= 0.001 || !this.donor) {
      this.ventPhase = 0;
      return;
    }
    const period = 60 / Math.max(4, config.audio.ventRate);
    this.ventPhase += dt / period;
    if (this.ventPhase >= 1) {
      this.ventPhase -= 1;
      this.cues.ventilator(this.pan(this.donor), this.vent * config.audio.ventilator, period);
    }
  }

  /** Alarma de prioridad alta del monitor del donante (cuando el corazón sale). */
  alarm(): void {
    if (this.donor) this.cues.alarm(this.pan(this.donor));
  }

  /** El corazón humano del receptor, mientras todavía es suyo. */
  private soundOwn(): void {
    const r = this.receptor;
    if (!r || this.ownLevel <= 0.001 || this.heartDelivered) {
      this.lastOwnPhase = -1;
      return;
    }
    const ph = r.phase;
    const last = this.lastOwnPhase;
    this.lastOwnPhase = ph;
    if (last < 0) return;
    const crossed = last < SYSTOLE ? ph >= SYSTOLE || ph < last : ph < last && ph >= SYSTOLE;
    if (crossed) this.cues.heartbeat(this.panOf(r.heartWorld(tmp)), this.ownLevel, 'humano');
  }

  /** Latido y monitor: suenan al empezar cada contracción ventricular del corazón que corresponde. */
  private sound(): void {
    this.soundOwn();
    const src = this.heartFrom === 'receptor' ? this.receptor : this.donor;
    if (!src) {
      this.lastSource = null;
      return;
    }
    const ph = src.phase;
    if (src !== this.lastSource) {
      this.lastSource = src;
      this.lastPhase = ph;
      return;
    }
    const crossed = this.lastPhase < SYSTOLE ? ph >= SYSTOLE || ph < this.lastPhase : ph < this.lastPhase && ph >= SYSTOLE;
    this.lastPhase = ph;
    if (!crossed) return;
    this.cues.heartbeat(this.panOf(src.heartWorld(tmp)), this.heartLevel, 'cerdo');
    // El oxímetro: un pitido por latido, con el tono de la saturación de ese momento (±0,4 de ruido de lectura).
    if (this.monitor > 0 && this.donor) {
      const reading = this.spo2 + (Math.random() - 0.5) * 0.8;
      this.cues.pulseBeep(reading, 0.08 * this.monitor * config.audio.monitor, this.pan(this.donor));
    }
  }

  /** Paneo estéreo según la posición del cuerpo en la pared (§13). */
  pan(b: BodyRig | null): number {
    if (!b) return 0;
    return this.panOf(b.chestWorld(tmp));
  }

  panOf(world: Vector3): number {
    tmp.copy(world).project(this.stage.camera);
    return Math.max(-1, Math.min(1, config.mirror ? -tmp.x : tmp.x));
  }

  /** Lado de la pantalla donde está un cuerpo: -1 izquierda, +1 derecha (como lo ve el público). */
  screenSide(b: BodyRig): number {
    return this.pan(b) >= 0 ? 1 : -1;
  }

  /** Lado hacia el que van los textos de un cuerpo: fijo mientras hay roles, si no, su lado actual. */
  sideOf(b: BodyRig): number {
    if (b === this.donor) return this.donorSide;
    if (b === this.receptor) return -this.donorSide;
    return this.screenSide(b);
  }

  /** Posición en la pared (x, y en -1..1, como la ve el público) de la cadera de una persona. */
  private wallOf(p: Person, out: { x: number; y: number }): { x: number; y: number } {
    const P = this.stage.projection;
    const [x, y] = P.videoToScreen(p.hipX, p.hipY);
    out.x = (x / P.canvasW) * 2 - 1;
    out.y = 1 - (y / P.canvasH) * 2;
    return out;
  }

  /** Durante el ciclo, el receptor no puede quedarse congelado. Cuando se acerca al cerdo para tomar el
   *  corazón, los dos cuerpos quedan juntos y MediaPipe suele perderlo o cambiarle la identidad: al volver
   *  aparece como una persona nueva, sin cuerpo, y el del receptor quedaba atado a la identidad vieja con la
   *  última pose. Si su persona ya no está activa, su cuerpo pasa a la persona sin cuerpo más cercana. */
  private rebindReceptor(): void {
    const r = this.receptor;
    if (!r || r.virtual) return;
    const cur = this.person(r.personId);
    if (cur && cur.state === 'active') return;
    const candidates = this.activePeople().filter((p) => p.state === 'active' && !this.bodyOf(p));
    if (!candidates.length) return;
    // La más cercana a donde quedó el receptor (cadera en la pared).
    r.chestWorld(tmp);
    tmp.project(this.stage.camera);
    const rx = config.mirror ? -tmp.x : tmp.x;
    let best = candidates[0];
    let bestD = Infinity;
    for (const p of candidates) {
      const w = this.wallOf(p, wallTmp);
      const d = Math.abs(w.x - rx);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    console.info(`[roles] receptor: persona ${r.personId ?? '—'} perdida, pasa a la persona ${best.id}`);
    r.personId = best.id;
    this.people.lock([this.donor?.personId, r.personId]);
  }

  updateBodies(now: number): void {
    const dt = this.clocks.dtGame;
    const dtr = this.clocks.dtReal;
    if (this.donor && this.receptor) this.rebindReceptor();
    for (const b of this.bodies) {
      const p = this.person(b.personId);
      if (b.personId !== null && !p && !b.hold) b.release();
      b.update(dt, dtr, p, this.stage.projection, now);
    }
    // Tamaño del polvo en px: alto del buffer × escala vertical de la proyección.
    this.debris.pxScale = this.stage.renderer.domElement.height * 0.5 * this.stage.camera.projectionMatrix.elements[5];
    this.debris.update(dt);
    this.genes.suppressed = !!this.donor?.fleshHeart;
    this.genes.sizeScale = this.stage.rig.shot && this.stage.cinematic ? config.cinematic.geneScale : 1;
    this.genes.update(dtr);
    this.medical(dtr);
    this.sound();
    // Sangre con el reloj de juego: la cámara lenta y el hit-stop la frenan (§8).
    const blood = this.stage.blood;
    if (config.debug.bloodTest) blood.bench(dt);
    blood.step(dt);
    this.bodies.forEach((b, i) => {
      const ring = this.rings[i];
      if (b.visible) ring.place(b.chestWorld(tmp), b.root.scale.x, b.armature.bones.Spine2);
      ring.update(dtr);
    });
  }
}

export class Machine {
  readonly show: Show;
  private states: Record<StateName, State>;
  current: State;
  /** Segundos reales en el estado actual. */
  t = 0;

  constructor(show: Show, states: Record<StateName, State>) {
    this.show = show;
    this.states = states;
    this.current = states.ESPERA;
    this.current.enter(show);
  }

  get name(): StateName {
    return this.current.name;
  }

  go(name: StateName): void {
    this.current.exit?.(this.show);
    console.info(`[estado] ${this.current.name} → ${name}`);
    this.current = this.states[name];
    this.t = 0;
    this.current.enter(this.show);
  }

  /** Teclas 1–6 (§16): salta a un estado preparando lo que haga falta (roles, cerdo, corazón). */
  jump(name: StateName): void {
    const s = this.show;
    if (name === 'ESPERA' || name === 'PLACA') {
      s.clearRoles();
      this.go(name);
      return;
    }
    // ASIGNACIÓN y TRANSFORMACIÓN empiezan un ciclo nuevo: nada del anterior (cerdo, corazón) queda.
    if (s.donor && (name === 'ASIGNACION' || name === 'TRANSFORMACION')) s.clearRoles(true);
    if (!s.donor) {
      s.assigning = true;
      s.syncAssignments();
      if (!s.decideRoles()) {
        console.warn(`[estado] no hay nadie frente a la cámara: no se puede saltar a ${name}`);
        return;
      }
    }
    if (name === 'EXTRACCION') this.prepareCinematic();
    if (name === 'EXTRACCION' || name === 'AUSENCIA') {
      // El cerdo ya está congelado y anestesiado: el respirador va desde el principio.
      s.vent = 1;
      s.genes.final();
      s.genes.attach(s.donor!.organ('heart')?.beat ?? null);
    }
    if (name === 'AUSENCIA') {
      this.prepareCinematic();
      s.donor!.breakRibs(1);
      deliverHeart(s);
    }
    this.go(name);
  }

  /** Tecla X: repetir solo la cinemática con los mismos roles. */
  replayCinematic(): void {
    this.jump('EXTRACCION');
  }

  /** Deja al donante como al final de la transformación: cerdo congelado, pecho cerrado, corazón en su lugar. */
  private prepareCinematic(): void {
    const s = this.show;
    const d = s.donor!;
    if (!d.frozen) {
      d.instantPig();
      d.layers.muscle = 0;
      d.freezeSkeleton(s.stage.scene);
    }
    d.frozenDissolve = 0;
    d.breakRibs(0);
    resetHeart(s);
    s.stage.blood.clear();
  }

  update(dt: number): void {
    this.t += dt;
    const next = this.current.update(this.show, this.t, dt);
    if (next) this.go(next);
  }
}

/** El corazón del donante queda en el receptor (inmediato, para saltos con teclas). */
export function deliverHeart(s: Show): void {
  const dh = s.donor?.organ('heart');
  if (dh) dh.fade = 0;
  const r = s.receptor;
  if (r) {
    r.layers.organs = 1;
    for (const o of r.organs) if (s.solo && o.name !== 'heart') o.fade = 0;
    // Los genes humanos llegan con el corazón.
    s.genes.attach(r.organ('heart')?.beat ?? null);
  }
  s.heartDelivered = true;
}

export function resetHeart(s: Show): void {
  const dh = s.donor?.organ('heart');
  if (dh) {
    dh.fade = 1;
    if (s.heartHomeSet) {
      dh.pivot.position.copy(s.heartHome);
      dh.pivot.quaternion.copy(s.heartHomeQuat);
      dh.pivot.scale.copy(s.heartHomeScale);
    }
  }
  if (s.solo && s.receptor) s.receptor.layers.organs = 0;
  if (dh) s.genes.attach(dh.beat);
  s.heartDelivered = false;
}
