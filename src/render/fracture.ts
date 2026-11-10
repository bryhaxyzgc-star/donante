// Fracturas (§10.1). Cada pieza de hueso humano se parte en 6–12 fragmentos: celdas Voronoi
// anisótropas (alargadas en los huesos largos, oblicuas como una fractura real) sobre sus
// triángulos. Las grietas del shader (materials/bone.ts) corren por los bordes de esas mismas
// celdas, así el hueso se rompe exactamente por donde se agrietó.
// Los fragmentos son cáscaras de la superficie original: la cara de adelante es hueso y la de
// atrás, médula húmeda (regla §1.2: el rojo solo en carne expuesta). Vuelan con Rapier, chocan
// con el piso y se disuelven. Además: astillas instanciadas y polvo óseo (sin `new` en el loop).
import RAPIER from '@dimforge/rapier3d-compat';
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh,
  Matrix3, Matrix4, Mesh, MeshStandardMaterial, OctahedronGeometry, Points, Quaternion, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { config } from '../config.ts';
import { rng } from '../random.ts';
import { MAX_SEEDS, createBoneMaterial, setCrack, setSeeds, styleAsMarrow, syncBoneMaterial, type BoneMaterial } from './materials/bone.ts';

export interface FragmentPiece {
  /** Comparte position/normal con la pieza intacta; solo cambia el índice. */
  geometry: BufferGeometry;
  /** Centro de masa aproximado (espacio de la pieza). */
  center: Vector3;
  /** Semiejes de la caja (espacio de la pieza). */
  half: Vector3;
  /** Matriz que lleva el centro al origen (para componer con el cuerpo rígido). */
  centerInv: Matrix4;
}

export interface FractureData {
  /** Centros de las celdas en el espacio transformado por `xf`. */
  seeds: Vector3[];
  xf: Matrix3;
  fragments: FragmentPiece[];
  center: Vector3;
  radius: number;
  /** Vértices que miran al frente (+Z del modelo): candidatos a punto de impacto. */
  front: Uint32Array;
}

const cache = new WeakMap<BufferGeometry, FractureData | null>();

export function fractureOf(g: BufferGeometry): FractureData | null {
  return cache.get(g) ?? null;
}

/** Calcula (una sola vez por geometría) la partición en fragmentos. */
export function prepareFracture(geo: BufferGeometry, seed: number): FractureData | null {
  if (cache.has(geo)) return cache.get(geo)!;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const index = geo.index;
  if (!index || !nor || pos.count < 40) {
    cache.set(geo, null);
    return null;
  }
  const rnd = rng(seed);
  const tris = index.count / 3;
  const cen = new Float32Array(tris * 3);
  const area = new Float32Array(tris);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, index.getX(t * 3));
    b.fromBufferAttribute(pos, index.getX(t * 3 + 1));
    c.fromBufferAttribute(pos, index.getX(t * 3 + 2));
    cen[t * 3] = (a.x + b.x + c.x) / 3;
    cen[t * 3 + 1] = (a.y + b.y + c.y) / 3;
    cen[t * 3 + 2] = (a.z + b.z + c.z) / 3;
    b.sub(a);
    c.sub(a);
    area[t] = b.cross(c).length() * 0.5 + 1e-12;
  }
  geo.computeBoundingSphere();
  const radius = geo.boundingSphere!.radius;
  const center = geo.boundingSphere!.center.clone();

  // Eje principal (PCA por iteración de potencia) y alargamiento.
  const mean = new Vector3();
  let wsum = 0;
  for (let t = 0; t < tris; t++) {
    mean.x += cen[t * 3] * area[t];
    mean.y += cen[t * 3 + 1] * area[t];
    mean.z += cen[t * 3 + 2] * area[t];
    wsum += area[t];
  }
  mean.divideScalar(wsum);
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < tris; t++) {
    const d = [cen[t * 3] - mean.x, cen[t * 3 + 1] - mean.y, cen[t * 3 + 2] - mean.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j] * area[t];
  }
  const e = new Vector3(1, 0.7, 0.3).normalize();
  for (let it = 0; it < 24; it++) {
    e.set(
      cov[0] * e.x + cov[1] * e.y + cov[2] * e.z,
      cov[3] * e.x + cov[4] * e.y + cov[5] * e.z,
      cov[6] * e.x + cov[7] * e.y + cov[8] * e.z,
    ).normalize();
  }
  const l1 = e.x * (cov[0] * e.x + cov[1] * e.y + cov[2] * e.z) + e.y * (cov[3] * e.x + cov[4] * e.y + cov[5] * e.z) + e.z * (cov[6] * e.x + cov[7] * e.y + cov[8] * e.z);
  const trace = cov[0] + cov[4] + cov[8];
  const elongated = l1 / Math.max(1e-12, trace - l1) > 1.4;
  // Inclinación aleatoria del eje: las celdas quedan oblicuas, como una fractura en espiral.
  const perp = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(e).normalize();
  e.applyAxisAngle(perp, (rnd() - 0.5) * 0.9).normalize();
  const k1 = elongated ? 0.5 : 0.82;
  const xf = new Matrix3().set(
    1 + (k1 - 1) * e.x * e.x, (k1 - 1) * e.x * e.y, (k1 - 1) * e.x * e.z,
    (k1 - 1) * e.y * e.x, 1 + (k1 - 1) * e.y * e.y, (k1 - 1) * e.y * e.z,
    (k1 - 1) * e.z * e.x, (k1 - 1) * e.z * e.y, 1 + (k1 - 1) * e.z * e.z,
  );
  const tc = new Float32Array(tris * 3);
  const v = new Vector3();
  for (let t = 0; t < tris; t++) {
    v.set(cen[t * 3], cen[t * 3 + 1], cen[t * 3 + 2]).applyMatrix3(xf);
    tc[t * 3] = v.x;
    tc[t * 3 + 1] = v.y;
    tc[t * 3 + 2] = v.z;
  }

  // k-means++ ponderado por área, luego Lloyd.
  const k = Math.max(6, Math.min(MAX_SEEDS, Math.round(5 + radius * 45)));
  const seeds: Vector3[] = [];
  const d2 = new Float32Array(tris).fill(Infinity);
  const pick = (weights: (t: number) => number): number => {
    let total = 0;
    for (let t = 0; t < tris; t++) total += weights(t);
    let r = rnd() * total;
    for (let t = 0; t < tris; t++) {
      r -= weights(t);
      if (r <= 0) return t;
    }
    return tris - 1;
  };
  let first = pick((t) => area[t]);
  seeds.push(new Vector3(tc[first * 3], tc[first * 3 + 1], tc[first * 3 + 2]));
  while (seeds.length < k) {
    const s = seeds[seeds.length - 1];
    for (let t = 0; t < tris; t++) {
      const dx = tc[t * 3] - s.x, dy = tc[t * 3 + 1] - s.y, dz = tc[t * 3 + 2] - s.z;
      d2[t] = Math.min(d2[t], dx * dx + dy * dy + dz * dz);
    }
    first = pick((t) => area[t] * d2[t]);
    seeds.push(new Vector3(tc[first * 3], tc[first * 3 + 1], tc[first * 3 + 2]));
  }
  const owner = new Uint8Array(tris);
  const assign = () => {
    for (let t = 0; t < tris; t++) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const dx = tc[t * 3] - s.x, dy = tc[t * 3 + 1] - s.y, dz = tc[t * 3 + 2] - s.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      owner[t] = best;
    }
  };
  const acc = new Float64Array(seeds.length * 4);
  for (let it = 0; it < 6; it++) {
    assign();
    acc.fill(0);
    for (let t = 0; t < tris; t++) {
      const o = owner[t] * 4;
      acc[o] += tc[t * 3] * area[t];
      acc[o + 1] += tc[t * 3 + 1] * area[t];
      acc[o + 2] += tc[t * 3 + 2] * area[t];
      acc[o + 3] += area[t];
    }
    seeds.forEach((s, i) => {
      if (acc[i * 4 + 3] > 0) s.set(acc[i * 4] / acc[i * 4 + 3], acc[i * 4 + 1] / acc[i * 4 + 3], acc[i * 4 + 2] / acc[i * 4 + 3]);
    });
  }
  assign();

  // Fragmentos: un índice por celda (sin celdas vacías).
  const lists: number[][] = seeds.map(() => []);
  for (let t = 0; t < tris; t++) lists[owner[t]].push(t);
  const used = lists.map((l, i) => (l.length ? i : -1)).filter((i) => i >= 0);
  const fragments: FragmentPiece[] = [];
  for (const i of used) {
    const list = lists[i];
    const idx = new (pos.count > 65535 ? Uint32Array : Uint16Array)(list.length * 3);
    const fc = new Vector3();
    let fa = 0;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    list.forEach((t, j) => {
      for (let q = 0; q < 3; q++) {
        const vi = index.getX(t * 3 + q);
        idx[j * 3 + q] = vi;
        v.fromBufferAttribute(pos, vi);
        min.min(v);
        max.max(v);
      }
      fc.x += cen[t * 3] * area[t];
      fc.y += cen[t * 3 + 1] * area[t];
      fc.z += cen[t * 3 + 2] * area[t];
      fa += area[t];
    });
    fc.divideScalar(fa);
    const g = new BufferGeometry();
    g.setAttribute('position', pos);
    g.setAttribute('normal', nor);
    g.setIndex(new BufferAttribute(idx, 1));
    const half = new Vector3().subVectors(max, min).multiplyScalar(0.5).max(new Vector3(0.002, 0.002, 0.002));
    const mid = new Vector3().addVectors(min, max).multiplyScalar(0.5);
    g.boundingSphere = new Sphere(mid, half.length());
    fragments.push({ geometry: g, center: fc, half, centerInv: new Matrix4().makeTranslation(-fc.x, -fc.y, -fc.z) });
  }
  const finalSeeds = used.map((i) => seeds[i]);

  const front: number[] = [];
  for (let i = 0; i < nor.count; i++) if (nor.getZ(i) > 0.3) front.push(i);
  const data: FractureData = {
    seeds: finalSeeds, xf, fragments, center, radius,
    front: Uint32Array.from(front.length ? front : [0]),
  };
  cache.set(geo, data);
  return data;
}

// ═══════════════════════════════ física ═══════════════════════════════

/** Grupos de colisión de Rapier (16 bits de pertenencia | 16 de filtro): los fragmentos solo
 *  chocan con el piso, no entre sí (nacen pegados y se repelerían). */
const FRAG_GROUPS = (0x0001 << 16) | 0x0002;
const FLOOR_GROUPS = (0x0002 << 16) | 0x0001;

interface FragSet {
  body: number;
  data: FractureData;
  front: BoneMaterial;
  back: BoneMaterial;
  nodes: Group[];
  rbs: RAPIER.RigidBody[];
  cols: RAPIER.Collider[];
  landed: boolean[];
  scale: number;
  age: number;
  life: number;
  active: boolean;
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpM = new Matrix4();
const tmpHalf = { x: 0, y: 0, z: 0 };

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Pieza existente que pasa a ser cuerpo físico (fragmentos de costilla de la cinemática). */
export interface LaunchItem {
  mesh: Mesh;
  /** Matriz de mundo actual de la pieza (su geometría está en espacio de modelo). */
  base: Matrix4;
  /** Centro y semiejes de la caja (espacio de modelo). */
  center: Vector3;
  half: Vector3;
}

interface Launched {
  body: number;
  rb: RAPIER.RigidBody;
  mesh: Mesh;
  centerInv: Matrix4;
  scale: number;
  landed: boolean;
  size: number;
}

export class Debris {
  /** Todo lo que vuela vive en espacio de mundo (no sigue al visitante). */
  readonly group = new Group();
  readonly splinters = new Splinters();
  readonly dust = new Dust();
  /** Un fragmento tocó el piso (sonido). */
  onImpact: (pos: Vector3, size: number) => void = () => {};
  /** px por metro a 1 m (lo fija Show cada frame para el tamaño del polvo). */
  pxScale = 600;
  private world: RAPIER.World;
  private floorBody: RAPIER.RigidBody;
  private floorY = -1.6;
  private sets: FragSet[] = [];
  private active: FragSet[] = [];
  private launched: Launched[] = [];
  private rnd = rng(7);
  private gravity = { x: 0, y: -9.81, z: 0 };

  static async create(): Promise<Debris> {
    await RAPIER.init();
    return new Debris();
  }

  private constructor() {
    this.group.name = 'escombros';
    this.world = new RAPIER.World({ x: 0, y: -config.transform.gravity, z: 0 });
    this.floorBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, this.floorY - 0.5, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setFriction(0.7).setRestitution(0.2).setCollisionGroups(FLOOR_GROUPS),
      this.floorBody,
    );
    this.group.add(this.splinters.mesh, this.dust.points);
  }

  /** Piso a la altura de los pies del donante (los fragmentos caen ahí). */
  setFloor(y: number): void {
    this.floorY = y;
    this.floorBody.setTranslation({ x: 0, y: y - 0.5, z: 0 }, true);
  }

  /** Prepara (una vez, al cargar) los fragmentos de una pieza para un cuerpo. */
  register(body: number, data: FractureData): FragSet {
    const front = createBoneMaterial('bone');
    syncBoneMaterial(front, 0);
    setSeeds(front, data.seeds, data.xf);
    const back = createBoneMaterial('bone');
    back.side = BackSide;
    styleAsMarrow(back);
    const set: FragSet = {
      body, data, front, back, nodes: [], rbs: [], cols: [], landed: [], scale: 1, age: 0, life: 1, active: false,
    };
    for (const f of data.fragments) {
      const node = new Group();
      node.matrixAutoUpdate = false;
      node.add(new Mesh(f.geometry, front), new Mesh(f.geometry, back));
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setEnabled(false).setLinearDamping(0.2).setAngularDamping(0.5),
      );
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(f.half.x, f.half.y, f.half.z).setDensity(1900).setFriction(0.6)
          .setRestitution(0.22).setCollisionGroups(FRAG_GROUPS),
        rb,
      );
      set.nodes.push(node);
      set.rbs.push(rb);
      set.cols.push(col);
      set.landed.push(false);
    }
    this.sets.push(set);
    return set;
  }

  /** La pieza estalla: sus fragmentos salen desde el punto de impacto (mundo). */
  burst(set: FragSet, pieceWorld: Matrix4, originWorld: Vector3, originObj: Vector3, crackRadius: number, strength: number): void {
    const T = config.transform;
    if (set.active) this.deactivate(set);
    syncBoneMaterial(set.front, 0);
    styleAsMarrow(set.back);
    setCrack(set.front, 1, originObj, crackRadius);
    pieceWorld.decompose(tmpP, tmpQ, tmpS);
    const s = tmpS.x;
    set.scale = s;
    set.age = 0;
    set.life = T.fragmentLife * (0.85 + 0.3 * this.rnd());
    set.data.fragments.forEach((f, i) => {
      const rb = set.rbs[i];
      tmpV.copy(f.center).applyMatrix4(pieceWorld);
      rb.setTranslation(tmpV, true);
      rb.setRotation(tmpQ, true);
      tmpHalf.x = f.half.x * s * 0.85;
      tmpHalf.y = f.half.y * s * 0.85;
      tmpHalf.z = f.half.z * s * 0.85;
      set.cols[i].setHalfExtents(tmpHalf);
      tmpV2.subVectors(tmpV, originWorld);
      if (tmpV2.lengthSq() < 1e-8) tmpV2.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5);
      tmpV2.normalize().multiplyScalar(T.fragmentSpeed * strength * (0.6 + 0.8 * this.rnd()));
      // Un poco hacia arriba y hacia la cámara: los fragmentos saltan al espectador.
      tmpV2.y += T.fragmentLift * strength * (0.4 + 0.6 * this.rnd());
      tmpV2.z += 0.35 * strength * this.rnd();
      rb.setLinvel(tmpV2, true);
      tmpV2.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).normalize().multiplyScalar(T.fragmentSpin * (0.5 + this.rnd()));
      rb.setAngvel(tmpV2, true);
      rb.setEnabled(true);
      rb.wakeUp();
      set.landed[i] = false;
      this.placeNode(set, i);
      this.group.add(set.nodes[i]);
    });
    set.active = true;
    this.active.push(set);
  }

  private placeNode(set: FragSet, i: number): void {
    const rb = set.rbs[i];
    const t = rb.translation();
    const r = rb.rotation();
    tmpP.set(t.x, t.y, t.z);
    tmpQ.set(r.x, r.y, r.z, r.w);
    tmpS.setScalar(set.scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    const node = set.nodes[i];
    node.matrix.multiplyMatrices(tmpM, set.data.fragments[i].centerInv);
    node.matrixWorldNeedsUpdate = true;
  }

  private deactivate(set: FragSet): void {
    for (let i = 0; i < set.rbs.length; i++) {
      set.rbs[i].setEnabled(false);
      set.nodes[i].removeFromParent();
    }
    set.active = false;
    const k = this.active.indexOf(set);
    if (k >= 0) this.active.splice(k, 1);
  }

  /** Vacía todo lo de un cuerpo (fin de ciclo). */
  clearBody(body: number): void {
    for (const set of [...this.active]) if (set.body === body) this.deactivate(set);
    this.clearLaunched(body);
    this.splinters.clear();
    this.dust.clear();
  }

  /** Lanza piezas que ya están en la escena (§9.5 plano 4: las costillas se quiebran hacia afuera).
   *  Salen desde `origin` hacia afuera y hacia la cámara, giran, caen y se quedan en el piso. */
  launch(body: number, items: LaunchItem[], origin: Vector3, speed: number, spin: number): void {
    for (const it of items) {
      it.base.decompose(tmpP, tmpQ, tmpS);
      const s = tmpS.x;
      tmpV.copy(it.center).applyMatrix4(it.base);
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(tmpV.x, tmpV.y, tmpV.z).setRotation(tmpQ)
          .setLinearDamping(0.25).setAngularDamping(0.5),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(Math.max(0.002, it.half.x * s * 0.85), Math.max(0.002, it.half.y * s * 0.85), Math.max(0.002, it.half.z * s * 0.85))
          .setDensity(1900).setFriction(0.6).setRestitution(0.2).setCollisionGroups(FRAG_GROUPS),
        rb,
      );
      tmpV2.subVectors(tmpV, origin);
      if (tmpV2.lengthSq() < 1e-8) tmpV2.set(0, 0, 1);
      tmpV2.normalize().multiplyScalar(speed * (0.6 + 0.7 * this.rnd()));
      tmpV2.z += speed * 0.5 * (0.5 + this.rnd());
      tmpV2.y += speed * 0.25 * this.rnd();
      rb.setLinvel(tmpV2, true);
      tmpV2.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).normalize().multiplyScalar(spin * (0.5 + this.rnd()));
      rb.setAngvel(tmpV2, true);
      this.launched.push({
        body, rb, mesh: it.mesh, centerInv: new Matrix4().makeTranslation(-it.center.x, -it.center.y, -it.center.z),
        scale: s, landed: false, size: it.half.length() * s,
      });
    }
  }

  private clearLaunched(body: number): void {
    for (let i = this.launched.length - 1; i >= 0; i--) {
      if (this.launched[i].body !== body) continue;
      this.world.removeRigidBody(this.launched[i].rb);
      this.launched.splice(i, 1);
    }
  }

  /** `dt` del reloj de juego: el hit-stop congela los escombros en el aire. */
  update(dt: number): void {
    if (!this.active.length && !this.launched.length && !this.splinters.count && !this.dust.count) return;
    if ((this.active.length || this.launched.length) && dt > 0) {
      this.gravity.y = -config.transform.gravity;
      this.world.gravity = this.gravity;
      this.world.timestep = Math.min(dt, 1 / 30);
      this.world.step();
    }
    for (let k = this.active.length - 1; k >= 0; k--) {
      const set = this.active[k];
      set.age += dt;
      const fade = 1.02 * smoothstep(set.life - 0.45, set.life, set.age);
      set.front.userData.uniforms.uDissolve.value = fade;
      set.back.userData.uniforms.uDissolve.value = fade;
      for (let i = 0; i < set.rbs.length; i++) {
        this.placeNode(set, i);
        if (!set.landed[i] && tmpP.y < this.floorY + 0.04 * set.scale) {
          set.landed[i] = true;
          this.onImpact(tmpP, set.data.fragments[i].half.length() * set.scale);
        }
      }
      if (set.age >= set.life) this.deactivate(set);
    }
    for (const l of this.launched) {
      const t = l.rb.translation();
      const r = l.rb.rotation();
      tmpP.set(t.x, t.y, t.z);
      tmpQ.set(r.x, r.y, r.z, r.w);
      tmpS.setScalar(l.scale);
      tmpM.compose(tmpP, tmpQ, tmpS);
      l.mesh.matrix.multiplyMatrices(tmpM, l.centerInv);
      l.mesh.matrixWorldNeedsUpdate = true;
      if (!l.landed && tmpP.y < this.floorY + 0.03 * l.scale) {
        l.landed = true;
        this.onImpact(tmpP, l.size);
      }
    }
    this.splinters.update(dt, this.floorY);
    this.dust.update(dt, this.floorY, this.pxScale);
  }

  /** Astillas y polvo de un estallido (además de los fragmentos). */
  spray(origin: Vector3, radius: number, scale: number, strength: number): void {
    const T = config.transform;
    this.splinters.spawn(origin, radius * scale * 0.6, Math.round((10 + 140 * radius) * T.splinters * strength), scale, this.rnd);
    this.dust.spawn(origin, radius * scale * 0.7, Math.round((30 + 420 * radius) * T.dust * strength), scale, this.rnd);
  }
}

// ═══════════════════════════════ astillas ═══════════════════════════════

const MAX_SPLINTERS = 480;
const BONE_TINTS = ['#e8eef2', '#d9e1e8', '#c8d2da', '#f1f4f6'];

class Splinters {
  readonly mesh: InstancedMesh;
  count = 0;
  private pos = new Float32Array(MAX_SPLINTERS * 3);
  private vel = new Float32Array(MAX_SPLINTERS * 3);
  private axis = new Float32Array(MAX_SPLINTERS * 3);
  private ang = new Float32Array(MAX_SPLINTERS);
  private spin = new Float32Array(MAX_SPLINTERS);
  private len = new Float32Array(MAX_SPLINTERS);
  private age = new Float32Array(MAX_SPLINTERS);
  private life = new Float32Array(MAX_SPLINTERS);
  private colors: Color[];

  constructor() {
    // Astilla: rombo largo y fino, facetado (los bordes brillan).
    const geo = new OctahedronGeometry(1, 0);
    geo.scale(0.13, 0.5, 0.08);
    const mat = new MeshStandardMaterial({
      color: '#ffffff', roughness: 0.42, metalness: 0, emissive: '#a9bccc', emissiveIntensity: 0.1, flatShading: true,
    });
    this.mesh = new InstancedMesh(geo, mat, MAX_SPLINTERS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'astillas';
    this.colors = [...BONE_TINTS.map((c) => new Color(c)), new Color(config.transform.marrowColor)];
    for (let i = 0; i < MAX_SPLINTERS; i++) this.mesh.setColorAt(i, this.colors[0]);
  }

  spawn(origin: Vector3, radius: number, n: number, scale: number, rnd: () => number): void {
    const T = config.transform;
    for (let k = 0; k < n && this.count < MAX_SPLINTERS; k++) {
      const i = this.count++;
      // Dirección aleatoria con sesgo hacia arriba y hacia la cámara (+Z).
      let dx = rnd() * 2 - 1, dy = rnd() * 2 - 1, dz = rnd() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      dz = Math.abs(dz) * 0.8 + 0.2;
      dy += 0.5;
      const sp = T.splinterSpeed * (0.35 + 0.85 * rnd()) * scale;
      this.pos[i * 3] = origin.x + dx * radius * rnd();
      this.pos[i * 3 + 1] = origin.y + (rnd() - 0.5) * radius;
      this.pos[i * 3 + 2] = origin.z + dz * radius * 0.5 * rnd();
      this.vel[i * 3] = dx * sp;
      this.vel[i * 3 + 1] = dy * sp;
      this.vel[i * 3 + 2] = dz * sp;
      tmpV.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      this.axis[i * 3] = tmpV.x;
      this.axis[i * 3 + 1] = tmpV.y;
      this.axis[i * 3 + 2] = tmpV.z;
      this.ang[i] = rnd() * Math.PI * 2;
      this.spin[i] = (8 + 22 * rnd()) * (rnd() < 0.5 ? -1 : 1);
      this.len[i] = (0.006 + 0.026 * rnd() * rnd()) * scale;
      this.age[i] = 0;
      this.life[i] = 0.9 + 0.9 * rnd();
      // ~1 de cada 8 lleva médula.
      this.mesh.setColorAt(i, rnd() < 0.12 ? this.colors[BONE_TINTS.length] : this.colors[Math.floor(rnd() * BONE_TINTS.length)]);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private swap(i: number, j: number): void {
    for (const arr of [this.pos, this.vel, this.axis]) for (let c = 0; c < 3; c++) arr[i * 3 + c] = arr[j * 3 + c];
    this.ang[i] = this.ang[j];
    this.spin[i] = this.spin[j];
    this.len[i] = this.len[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    if (this.mesh.instanceColor) {
      const col = this.mesh.instanceColor.array as Float32Array;
      col[i * 3] = col[j * 3];
      col[i * 3 + 1] = col[j * 3 + 1];
      col[i * 3 + 2] = col[j * 3 + 2];
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  update(dt: number, floorY: number): void {
    if (!this.count) return;
    const g = config.transform.gravity;
    const drag = Math.exp(-1.1 * dt);
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.swap(i, --this.count);
        continue;
      }
      const o = i * 3;
      this.vel[o + 1] -= g * dt;
      this.vel[o] *= drag;
      this.vel[o + 1] *= drag;
      this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < floorY) {
        this.pos[o + 1] = floorY;
        this.vel[o + 1] = -this.vel[o + 1] * 0.25;
        this.vel[o] *= 0.55;
        this.vel[o + 2] *= 0.55;
        this.spin[i] *= 0.5;
      }
      this.ang[i] += this.spin[i] * dt;
    }
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      tmpP.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
      tmpQ.setFromAxisAngle(tmpV.set(this.axis[o], this.axis[o + 1], this.axis[o + 2]), this.ang[i]);
      tmpS.setScalar(this.len[i] * (1 - smoothstep(this.life[i] - 0.35, this.life[i], this.age[i])));
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }
}

// ═══════════════════════════════ polvo óseo ═══════════════════════════════

const MAX_DUST = 1800;

const DUST_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
uniform float uPx;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uPx / max(0.1, -mv.z));
  vA = aAlpha;
}
`;
const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(uColor * exp(-d * 3.0) * vA, 1.0);
}
`;

class Dust {
  readonly points: Points;
  count = 0;
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  private vel = new Float32Array(MAX_DUST * 3);
  private age = new Float32Array(MAX_DUST);
  private life = new Float32Array(MAX_DUST);
  private peak = new Float32Array(MAX_DUST);
  private mat: ShaderMaterial;

  constructor() {
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(new Float32Array(MAX_DUST * 3), 3).setUsage(DynamicDrawUsage);
    this.alphaAttr = new BufferAttribute(new Float32Array(MAX_DUST), 1).setUsage(DynamicDrawUsage);
    this.sizeAttr = new BufferAttribute(new Float32Array(MAX_DUST), 1).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color('#aab8c4') }, uPx: { value: 600 } },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.name = 'polvo';
  }

  spawn(origin: Vector3, radius: number, n: number, scale: number, rnd: () => number): void {
    const p = this.posAttr.array as Float32Array;
    const sz = this.sizeAttr.array as Float32Array;
    for (let k = 0; k < n && this.count < MAX_DUST; k++) {
      const i = this.count++;
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const dx = r * Math.cos(th), dy = u, dz = r * Math.sin(th);
      const rr = radius * Math.cbrt(rnd());
      p[i * 3] = origin.x + dx * rr;
      p[i * 3 + 1] = origin.y + dy * rr;
      p[i * 3 + 2] = origin.z + dz * rr;
      const sp = (0.25 + 1.1 * rnd() * rnd()) * scale;
      this.vel[i * 3] = dx * sp;
      this.vel[i * 3 + 1] = dy * sp + 0.15;
      this.vel[i * 3 + 2] = dz * sp + 0.1;
      this.age[i] = 0;
      this.life[i] = 0.7 + 1.1 * rnd();
      this.peak[i] = 0.05 + 0.12 * rnd();
      sz[i] = (0.003 + 0.007 * rnd()) * scale;
    }
  }

  update(dt: number, floorY: number, px: number): void {
    this.mat.uniforms.uPx.value = px;
    if (!this.count) return;
    const p = this.posAttr.array as Float32Array;
    const al = this.alphaAttr.array as Float32Array;
    const sz = this.sizeAttr.array as Float32Array;
    const drag = Math.exp(-3.2 * dt);
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.count;
        for (let c = 0; c < 3; c++) {
          p[i * 3 + c] = p[j * 3 + c];
          this.vel[i * 3 + c] = this.vel[j * 3 + c];
        }
        this.age[i] = this.age[j];
        this.life[i] = this.life[j];
        this.peak[i] = this.peak[j];
        sz[i] = sz[j];
        continue;
      }
      const o = i * 3;
      this.vel[o] *= drag;
      this.vel[o + 1] = this.vel[o + 1] * drag - 0.35 * dt;
      this.vel[o + 2] *= drag;
      p[o] += this.vel[o] * dt;
      p[o + 1] = Math.max(floorY, p[o + 1] + this.vel[o + 1] * dt);
      p[o + 2] += this.vel[o + 2] * dt;
      const x = this.age[i] / this.life[i];
      al[i] = this.peak[i] * Math.min(1, this.age[i] / 0.05) * (1 - x) * (1 - x);
    }
    this.points.geometry.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

export type { FragSet };
