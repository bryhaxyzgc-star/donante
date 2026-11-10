// Sangre (§10.2–10.4): fachada que usan los estados. Junta la simulación GPU, el SSFR, las manchas,
// el charco y la lente, y ofrece los emisores de la obra: chorro de la cavidad, chorros arteriales
// pulsátiles (caudal = latido), goteo del corazón y salpicaduras radiales en cada fractura.
// Regla §1.3: toda la sangre está del lado del donante; nada apunta al receptor.
import { BloodRiver } from './river.ts';
import { EffectPass } from 'postprocessing';
import { Group, Vector2, Vector3, type Mesh, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { config } from '../../config.ts';
import type { QualityPreset } from '../../quality.ts';
import { rng } from '../../random.ts';
import { Eraser } from '../erase.ts';
import type { Lighting } from '../lighting.ts';
import { BloodDecals, Puddle } from './decals.ts';
import { LensBlood } from './lens.ts';
import { BloodSim, type Emission } from './sim.ts';
import { BloodPass } from './ssfr.ts';

export type Capsule = [Vector3, Vector3, number];

/** Plantilla de emisión sin cantidad (la pone el caudal). */
export type EmitShape = Omit<Emission, 'count'>;

const tmpV = new Vector3();
const tmpN = new Vector3();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

export class Blood {
  /** Manchas y charco (espacio de mundo). */
  readonly group = new Group();
  readonly pass: BloodPass;
  /** Borrado (§9.6): máscara compartida por todos los materiales de sangre. */
  readonly eraser = new Eraser();
  readonly lens: LensBlood;
  readonly lensPass: EffectPass;
  readonly decals: BloodDecals;
  readonly puddle: Puddle;
  /** Ríos planos de la placa real (river.ts): el principal y un brazo más delgado. */
  readonly rivers: BloodRiver[];
  private camera: PerspectiveCamera;
  sim: BloodSim;
  private renderer: WebGLRenderer;
  private acc = new Map<string, number>();
  private shapes = new Map<string, Emission>();
  /** Sangre que todavía está cayendo hacia el charco: [segundos que faltan, cantidad]. */
  private falling: [number, number][] = [];
  private rnd = rng(1313);

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, lighting: Lighting, quality: QualityPreset) {
    this.renderer = renderer;
    this.camera = camera;
    this.group.name = 'sangre';
    this.sim = new BloodSim(renderer, quality.particles);
    this.pass = new BloodPass(camera, lighting, renderer.extensions.has('EXT_color_buffer_float'), this.eraser.uniforms);
    this.pass.setSim(this.sim);
    this.lens = new LensBlood(this.eraser.uniforms);
    this.lensPass = new EffectPass(camera, this.lens.effect);
    this.decals = new BloodDecals(this.group, this.eraser.uniforms);
    this.puddle = new Puddle(lighting, this.eraser.uniforms);
    this.group.add(this.puddle.mesh);
    this.rivers = [new BloodRiver(this.eraser.uniforms), new BloodRiver(this.eraser.uniforms)];
    for (const r of this.rivers) this.group.add(r.mesh);
    scene.add(this.group);
    this.applyQuality(quality);
  }

  /** Relación de partículas con HIGH: en LOW nacen menos, pero más grandes (mismo volumen). */
  get density(): number {
    return this.sim.count / 16384;
  }

  applyQuality(q: QualityPreset): void {
    if (q.particles !== this.sim.count && Math.abs(q.particles - this.sim.count) > 1) {
      this.sim.dispose();
      this.sim = new BloodSim(this.renderer, q.particles);
      this.pass.setSim(this.sim);
    }
    this.pass.setScale(q.ssfr === 'half' ? 0.5 : 1);
    this.pass.refraction = q.ssfrRefraction;
  }

  // ── mundo ──────────────────────────────────────────────────────

  setFloor(y: number): void {
    this.sim.floorY = y;
  }

  setColliders(caps: Capsule[]): void {
    this.sim.setCapsules(caps);
  }

  /** Centro de la grilla de cohesión (la sangre vive alrededor del donante). */
  setRegion(center: Vector3): void {
    this.sim.setRegion(center);
  }

  /** Cápsulas que aproximan el esqueleto congelado (articulaciones en mundo). */
  static capsulesFrom(j: Record<string, Vector3>, scale: number): Capsule[] {
    const c: Capsule[] = [];
    const add = (a: string, b: string, r: number) => {
      if (j[a] && j[b]) c.push([j[a].clone(), j[b].clone(), r * scale]);
    };
    add('Hips', 'Spine1', 0.05);
    add('Spine1', 'Neck', 0.04);
    add('Neck', 'Head', 0.03);
    add('Head', 'HeadTop_End', 0.075);
    add('LeftUpLeg', 'RightUpLeg', 0.06);
    for (const s of ['Left', 'Right']) {
      add(`${s}UpLeg`, `${s}Leg`, 0.038);
      add(`${s}Leg`, `${s}Foot`, 0.032);
      add(`${s}Foot`, `${s}Toe_End`, 0.03);
      add(`${s}Arm`, `${s}ForeArm`, 0.032);
      add(`${s}ForeArm`, `${s}Hand`, 0.026);
    }
    return c;
  }

  // ── emisores ───────────────────────────────────────────────────

  /** Estallido de `count` partículas (en HIGH; se escala por preset). Es un evento: copia la forma. */
  burst(shape: EmitShape, count: number, toFloor = 0.8): void {
    const n = Math.round(count * this.density);
    this.sim.emit({ ...shape, origin: shape.origin.clone(), dir: shape.dir.clone(), count: n });
    this.fall(count * toFloor, 0.7);
  }

  /** Caudal continuo (partículas por segundo de juego, en HIGH). `key` separa acumuladores. */
  stream(key: string, shape: EmitShape, rate: number, dt: number, toFloor = 0.85): void {
    if (rate <= 0 || dt <= 0) return;
    const a = (this.acc.get(key) ?? 0) + rate * dt * this.density;
    const n = Math.floor(a);
    this.acc.set(key, a - n);
    if (n > 0) {
      // Una emisión reutilizable por caudal: nada se crea por frame (§15).
      let e = this.shapes.get(key);
      if (!e) {
        e = { ...shape, origin: new Vector3(), dir: new Vector3(), count: 0 };
        this.shapes.set(key, e);
      }
      Object.assign(e, shape, { origin: e.origin.copy(shape.origin), dir: e.dir.copy(shape.dir), count: n, span: dt });
      this.sim.emit(e);
      this.fall((n / this.density) * toFloor, 0.6);
    }
  }

  /** Coágulos: `n` masas de sangre que salen en direcciones al azar dentro del cono. Cada una son
   *  partículas con velocidades casi iguales: vuelan juntas como un borbotón espeso y se estiran en
   *  hilos (la cohesión real de la sangre, sin calcularla). */
  gobs(origin: Vector3, dir: Vector3, n: number, perGob: number, speed: number, spread: number, life = 3.2): void {
    tmpN.copy(dir).normalize();
    const t = new Vector3().crossVectors(tmpN, Math.abs(tmpN.y) < 0.95 ? UP : RIGHT).normalize();
    const b = new Vector3().crossVectors(tmpN, t);
    for (let i = 0; i < n; i++) {
      const th = spread * Math.sqrt(this.rnd());
      const ph = Math.PI * 2 * this.rnd();
      const d = tmpN.clone().multiplyScalar(Math.cos(th))
        .addScaledVector(t, Math.cos(ph) * Math.sin(th)).addScaledVector(b, Math.sin(ph) * Math.sin(th));
      const big = 0.5 + this.rnd();
      this.burst({
        origin: tmpV.copy(origin).addScaledVector(d, 0.01), dir: d, speed: speed * (0.55 + 0.7 * this.rnd()),
        spread: 0.07, jitter: 0.22, life, radius: 0.016,
      }, perGob * big);
    }
  }

  /** Salpicaduras radiales alrededor de un punto (fracturas de costillas, §10.2). */
  splash(center: Vector3, radius: number, n: number, count: number, outward: Vector3): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd();
      tmpV.set(Math.cos(a) * radius, Math.sin(a) * radius * 0.8, 0).add(center);
      tmpN.set(Math.cos(a), Math.sin(a) * 0.8 + 0.3, 0.7).addScaledVector(outward, 0.4).normalize();
      this.burst({ origin: tmpV, dir: tmpN, speed: 1.0, spread: 0.12, jitter: 0.3, life: 2.2, radius: 0.008 }, count);
    }
  }

  private fall(amount: number, delay: number): void {
    this.falling.push([delay, amount]);
  }

  // ── manchas ────────────────────────────────────────────────────

  /** `n` manchas en puntos al azar de `meshes` que miran hacia arriba o al frente. */
  splatter(meshes: Mesh[], n: number, size = 0.06): void {
    const list = meshes.filter((m) => m.visible !== false && m.geometry?.getAttribute('position'));
    if (!list.length) return;
    for (let k = 0; k < n; k++) {
      const mesh = list[Math.floor(this.rnd() * list.length)];
      const pos = mesh.geometry.getAttribute('position');
      const nor = mesh.geometry.getAttribute('normal');
      mesh.updateWorldMatrix(true, false);
      for (let tries = 0; tries < 24; tries++) {
        const i = Math.floor(this.rnd() * pos.count);
        tmpV.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (nor) tmpN.fromBufferAttribute(nor, i).transformDirection(mesh.matrixWorld);
        else tmpN.set(0, 0, 1);
        // La sangre cae y salpica: superficies que miran arriba o hacia la cámara.
        if (tmpN.y > -0.2 && tmpN.z > -0.25) {
          this.decals.place(mesh, tmpV, tmpN, size);
          break;
        }
      }
    }
  }

  /** Empieza el charco bajo el punto de goteo. */
  startPuddle(drip: Vector3, forward: Vector2): void {
    this.puddle.start(drip, this.sim.floorY, forward);
  }

  // ── por frame ──────────────────────────────────────────────────

  /** Simulación con el reloj de juego (la cámara lenta y el hit-stop la afectan). */
  step(dt: number): void {
    this.sim.step(dt);
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f[0] -= dt;
      if (f[0] <= 0) {
        this.puddle.add(f[1] / 1000);
        this.falling.splice(i, 1);
      }
    }
  }

  /** Ríos de la placa real: `paths[i]` en mundo, ancho (m), retraso (s). */
  startRivers(paths: { points: Vector3[]; halfWidth: number; delay: number }[]): void {
    paths.forEach((p, i) => this.rivers[i]?.start(p.points, p.halfWidth, this.camera, p.delay));
  }

  /** Cuánto sangran los ríos (0..1,3): late con el corazón y baja con el tiempo. */
  setRiverFlow(k: number): void {
    this.rivers[0].setFlow(k);
    this.rivers[1].setFlow(k * 0.8);
  }

  /** Coagulación, lente y encendido de los pases (reloj real). */
  update(dt: number, aspect: number): void {
    for (const r of this.rivers) {
      r.update(dt);
      // Cuando el río llega al piso, el charco crece con lo que trae.
      if (r.arrived) this.puddle.add(config.blood.riverFeed * r.widthK * dt);
    }
    this.decals.update(dt);
    this.puddle.update(dt);
    this.lens.update(dt, aspect);
    this.renderer.getDrawingBufferSize(this.eraser.uniforms.uEraseRes.value);
    this.pass.enabled = this.sim.active;
    this.lensPass.enabled = this.lens.active;
  }

  /** Borrado (§9.6): `t` segundos desde que empezó (< 0 = nada borrado). */
  erase(t: number): void {
    this.eraser.set(t);
  }

  /** Fin de ciclo: no queda nada. */
  clear(): void {
    this.sim.clear();
    this.decals.clear();
    this.puddle.clear();
    this.lens.clear();
    this.acc.clear();
    this.shapes.clear();
    this.falling.length = 0;
    for (const r of this.rivers) r.clear();
    this.eraser.reset();
  }

  /** Banco de prueba (debug.bloodTest): chorro continuo sobre un "hueso" frente a la cámara. */
  bench(dt: number): void {
    const B = config.blood;
    const floor = -0.95;
    if (this.sim.floorY !== floor || !this.puddle.mesh.visible) {
      this.setFloor(floor);
      this.setColliders([[new Vector3(-0.35, -0.35, -1.9), new Vector3(0.35, -0.42, -1.9), 0.045]]);
      this.setRegion(new Vector3(0, -0.4, -1.9));
      this.startPuddle(new Vector3(0, floor, -1.85), new Vector2(0, 1));
    }
    this.stream('banco', {
      origin: new Vector3(-0.05, 0.25, -1.95), dir: new Vector3(0.25, -0.2, 0.15), speed: 1.2, spread: 0.03,
      jitter: 0.1, life: 3.5, radius: 0.012,
    }, B.benchRate, dt);
  }
}
