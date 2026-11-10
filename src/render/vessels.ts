// Corazón de carne y vasos sanguíneos de la cinemática (§10.5, §9.5 planos 5–9).
// Es un clon de heart.glb (corazón + aorta, pulmonar, cava superior e inferior, 12 huesos en cadena
// cada uno). Cada vaso es una cuerda verlet de 13 nodos: el nodo 0 va pegado al corazón y el
// último queda anclado en el pecho. Cuando el corazón sale, los vasos se estiran; al romperse,
// cada mitad retrocede como un elástico y el muñón anclado queda abierto (de ahí sale el chorro
// arterial, sangrado.ts). Los huesos de la cadena se aplanan bajo la raíz del rig para poder
// ponerlos donde diga la simulación; el skinning no cambia (mismas matrices de bind).
import { Group, Matrix4, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { config } from '../config.ts';
import { createFleshMaterial, setFleshBlood, setFleshXray, type FleshMaterial } from './materials/flesh.ts';
import { createHeartMaterial, setHeartBlood } from './materials/heart.ts';

export const VESSELS = ['pulmonary', 'svc', 'ivc', 'aorta'] as const;
export type VesselName = (typeof VESSELS)[number];

interface Chain {
  name: VesselName;
  bones: Bone[];
  /** Malla del vaso (geometría propia: sus pesos se cortan al romperse) y pesos originales. */
  mesh: SkinnedMesh | null;
  weights0: Float32Array | null;
  /** Índice original de triángulos (al romperse se quitan los que cruzan el corte). */
  index0: Uint32Array | Uint16Array | null;
  /** Posiciones de reposo de los nodos (espacio del rig). */
  rest: Vector3[];
  restQuat: Quaternion[];
  restDir: Vector3[];
  restLen: number[];
  /** Estado verlet (mundo). */
  pos: Vector3[];
  prev: Vector3[];
  /** Segmento roto (-1 = entero). */
  broken: number;
  anchor: Vector3;
}

export interface Stump {
  name: VesselName;
  pos: Vector3;
  dir: Vector3;
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const tmpM = new Matrix4();
const inv = new Matrix4();

export class HeartRig {
  /** Va dentro del grupo que late del corazón del donante, desplazado para quedar en espacio de modelo. */
  readonly group = new Group();
  private root: Object3D;
  private heartMat = createHeartMaterial();
  private vesselMat: FleshMaterial = createFleshMaterial({ vessel: true });
  private chains: Chain[] = [];
  private active = false;
  /** Padre de los huesos (el nodo HeartRig del GLB): su espacio es el de reposo de los nodos. */
  private rig: Object3D;
  /** Muñones abiertos (lado anclado) de los vasos rotos. */
  readonly stumps: Stump[] = [];

  constructor(source: Object3D, center: Vector3) {
    this.group.name = 'corazon_cinematica';
    this.root = cloneSkinned(source);
    this.root.position.copy(center).multiplyScalar(-1);
    this.group.add(this.root);
    this.root.updateMatrixWorld(true);
    let skeletonRoot: Object3D | null = null;
    const vesselMeshes = new Map<string, SkinnedMesh>();
    this.root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      const vessel = m.userData.donante_role === 'vessel';
      m.material = vessel ? this.vesselMat : this.heartMat;
      if (vessel) {
        // Geometría propia: al romperse se le cortan los pesos (no se comparte con el otro cuerpo).
        m.geometry = m.geometry.clone();
        vesselMeshes.set(String(m.userData.donante_vessel), m);
      } else {
        skeletonRoot = m.skeleton.bones[0].parent;
      }
    });
    const rig = (skeletonRoot ?? this.root) as Object3D;
    // Rest en espacio del rig (la raíz del clon está en identidad respecto de `rig`).
    rig.updateMatrixWorld(true);
    inv.copy(rig.matrixWorld).invert();
    for (const name of VESSELS) {
      const bones: Bone[] = [];
      for (let i = 0; i < 12; i++) {
        const b = this.root.getObjectByName(`${name}_${String(i).padStart(2, '0')}`) as Bone | undefined;
        if (b) bones.push(b);
      }
      if (bones.length < 3) continue;
      const rest: Vector3[] = [];
      const restQuat: Quaternion[] = [];
      for (const b of bones) {
        tmpM.multiplyMatrices(inv, b.matrixWorld);
        const p = new Vector3();
        const q = new Quaternion();
        tmpM.decompose(p, q, tmpV2);
        rest.push(p);
        restQuat.push(q);
      }
      // Punta: se extrapola del último segmento.
      rest.push(rest[rest.length - 1].clone().multiplyScalar(2).sub(rest[rest.length - 2]));
      const restDir: Vector3[] = [];
      const restLen: number[] = [];
      for (let i = 0; i < rest.length - 1; i++) {
        const d = rest[i + 1].clone().sub(rest[i]);
        restLen.push(d.length());
        restDir.push(d.normalize());
      }
      // Cadena plana: cada hueso cuelga directo de `rig` con su transformación de reposo.
      for (const b of bones) rig.attach(b);
      const mesh = vesselMeshes.get(name) ?? null;
      const sw = mesh?.geometry.getAttribute('skinWeight');
      const si = mesh?.geometry.getAttribute('skinIndex');
      this.chains.push({
        name, bones, mesh,
        weights0: sw && si ? Float32Array.from(sw.array as ArrayLike<number>) : null,
        index0: mesh?.geometry.index ? (mesh.geometry.index.array as Uint32Array | Uint16Array).slice() : null,
        rest, restQuat, restDir, restLen,
        pos: rest.map(() => new Vector3()), prev: rest.map(() => new Vector3()), broken: -1, anchor: new Vector3(),
      });
    }
    this.rig = rig;
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  show(on: boolean): void {
    this.group.visible = on;
  }

  setBlood(amount: number): void {
    setHeartBlood(this.heartMat, amount);
    setFleshBlood(this.vesselMat, Math.max(amount, 0.6), true);
  }

  /** La carne se vuelve rayos X al entrar en el receptor (0..1). Va después de setBlood. */
  setXray(x: number): void {
    setFleshXray(this.heartMat, x);
    setFleshXray(this.vesselMat, x);
  }

  /** Captura el reposo en mundo y ancla las puntas en el pecho (al empezar a arrancarlo). */
  activate(): void {
    this.group.updateWorldMatrix(true, true);
    this.stumps.length = 0;
    for (const c of this.chains) {
      for (let i = 0; i < c.rest.length; i++) {
        c.pos[i].copy(c.rest[i]).applyMatrix4(this.rig.matrixWorld);
        c.prev[i].copy(c.pos[i]);
      }
      c.anchor.copy(c.pos[c.pos.length - 1]);
      c.broken = -1;
      for (const b of c.bones) b.scale.setScalar(1);
    }
    this.active = true;
  }

  /** Reposo (fin de ciclo o al repetir la cinemática). */
  reset(): void {
    this.active = false;
    this.stumps.length = 0;
    for (const c of this.chains) {
      c.broken = -1;
      // Pesos originales (el vaso vuelve a estar entero).
      const sw = c.mesh?.geometry.getAttribute('skinWeight');
      if (sw && c.weights0) {
        (sw.array as Float32Array).set(c.weights0);
        sw.needsUpdate = true;
      }
      const ix = c.mesh?.geometry.index;
      if (ix && c.index0) {
        (ix.array as Uint32Array | Uint16Array).set(c.index0);
        ix.needsUpdate = true;
      }
      c.bones.forEach((b, i) => {
        b.position.copy(c.rest[i]);
        b.quaternion.copy(c.restQuat[i]);
        b.scale.setScalar(1);
      });
    }
  }

  /** El vaso se rompe en su segmento más estirado. */
  snap(name: VesselName): Stump | null {
    const c = this.chains.find((x) => x.name === name);
    if (!c || c.broken >= 0 || !this.active) return null;
    let k = Math.floor(c.pos.length / 2);
    let worst = 0;
    for (let i = 1; i < c.pos.length - 2; i++) {
      const s = c.pos[i].distanceTo(c.pos[i + 1]) / c.restLen[i];
      if (s > worst) {
        worst = s;
        k = i;
      }
    }
    c.broken = k;
    this.cutWeights(c, k);
    // Los extremos rotos se afinan (la pared del vaso se desgarra).
    c.bones[k]?.scale.setScalar(0.55);
    if (c.bones[k + 1]) c.bones[k + 1].scale.setScalar(0.7);
    const stump: Stump = { name, pos: new Vector3(), dir: new Vector3() };
    this.stumps.push(stump);
    this.updateStump(c, stump);
    return stump;
  }

  /** Corte limpio en el tramo k: cada vértice que pesaba en los dos lados pasa entero al lado que más
   *  pesaba. Sin esto, el skinning deja una piel estirada entre el corazón y el pecho. */
  private cutWeights(c: Chain, k: number): void {
    const m = c.mesh;
    if (!m) return;
    const bones = m.skeleton.bones;
    const heartSide = new Set(c.bones.slice(0, k + 1).map((b) => bones.indexOf(b)));
    const si = m.geometry.getAttribute('skinIndex');
    const sw = m.geometry.getAttribute('skinWeight');
    const side = new Uint8Array(si.count);
    for (let v = 0; v < si.count; v++) {
      let wh = 0;
      let wa = 0;
      for (let j = 0; j < 4; j++) {
        const w = sw.getComponent(v, j);
        if (heartSide.has(si.getComponent(v, j))) wh += w;
        else wa += w;
      }
      side[v] = wh >= wa ? 1 : 0;
      if (wh === 0 || wa === 0) continue;
      const keepHeart = wh >= wa;
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const side = heartSide.has(si.getComponent(v, j));
        if (side !== keepHeart) sw.setComponent(v, j, 0);
        sum += sw.getComponent(v, j);
      }
      for (let j = 0; j < 4; j++) sw.setComponent(v, j, sw.getComponent(v, j) / Math.max(sum, 1e-6));
    }
    sw.needsUpdate = true;
    // Los triángulos que unen un lado con el otro se vuelven degenerados: el tubo queda abierto.
    const ix = m.geometry.index;
    if (!ix) return;
    const a = ix.array as Uint32Array | Uint16Array;
    for (let t = 0; t < a.length; t += 3) {
      const s0 = side[a[t]];
      if (s0 !== side[a[t + 1]] || s0 !== side[a[t + 2]]) a[t + 1] = a[t + 2] = a[t];
    }
    ix.needsUpdate = true;
  }

  /** Acerca el nodo `node` a `lead` si el tramo `seg` pasa de `max` × su reposo (y le quita esa velocidad). */
  private leash(c: Chain, node: number, lead: number, seg: number, max: number): void {
    const p = c.pos[node];
    tmpV.subVectors(p, c.pos[lead]);
    const len = tmpV.length();
    const lim = c.restLen[seg] * max;
    if (len <= lim) return;
    tmpV2.copy(c.pos[lead]).addScaledVector(tmpV, lim / len).sub(p);
    p.add(tmpV2);
    c.prev[node].add(tmpV2);
  }

  private updateStump(c: Chain, s: Stump): void {
    const k = c.broken + 1;
    s.pos.copy(c.pos[k]);
    s.dir.subVectors(c.pos[k], c.pos[Math.min(c.pos.length - 1, k + 1)]).normalize();
  }

  /** Verlet con el reloj de juego (cámara lenta incluida). */
  update(dt: number): void {
    if (!this.active || !this.group.visible || dt <= 0) return;
    const C = config.cinematic;
    this.group.updateWorldMatrix(true, true);
    const sub = 3;
    const h = Math.min(dt, 1 / 30) / sub;
    for (const c of this.chains) {
      const n = c.pos.length;
      for (let s = 0; s < sub; s++) {
        // Integración (los nodos libres caen y se amortiguan).
        for (let i = 1; i < n - 1; i++) {
          const p = c.pos[i];
          tmpV.subVectors(p, c.prev[i]).multiplyScalar(C.vesselDamping);
          c.prev[i].copy(p);
          p.add(tmpV);
          p.y -= C.vesselGravity * h * h;
        }
        // Extremos: el 0 sigue al corazón; el último queda en el pecho (salvo que esa mitad esté suelta).
        c.pos[0].copy(c.rest[0]).applyMatrix4(this.rig.matrixWorld);
        c.pos[n - 1].copy(c.anchor);
        c.prev[0].copy(c.pos[0]);
        // Restricciones de distancia, elásticas (rigidez < 1: estira, rebota al soltarse).
        for (let it = 0; it < 6; it++) {
          for (let i = 0; i < n - 1; i++) {
            if (i === c.broken) continue;
            const a = c.pos[i];
            const b = c.pos[i + 1];
            tmpV.subVectors(b, a);
            const len = tmpV.length() || 1e-6;
            const diff = ((len - c.restLen[i]) / len) * C.vesselStiffness;
            const wa = i === 0 ? 0 : 0.5;
            const wb = i + 1 === n - 1 ? 0 : 0.5;
            const tot = wa + wb || 1;
            a.addScaledVector(tmpV, (diff * wa) / tot);
            b.addScaledVector(tmpV, (-diff * wb) / tot);
          }
        }
      }
      if (c.broken >= 0) {
        // Los dos pedazos de un vaso cortado siguen a su extremo fijo con un tope de estiramiento: si el
        // corazón viaja rápido, el tramo que se lleva no queda como un tubo largo colgando.
        for (let i = 0; i < c.broken; i++) this.leash(c, i + 1, i, i, C.vesselMaxStretch);
        for (let i = n - 2; i > c.broken; i--) this.leash(c, i, i + 1, i, C.vesselMaxStretch);
        const s = this.stumps.find((x) => x.name === c.name);
        if (s) this.updateStump(c, s);
      }
      // Huesos: posición del nodo y rotación de reposo girada hacia el nodo siguiente.
      inv.copy(this.rig.matrixWorld).invert();
      for (let i = 0; i < c.bones.length; i++) {
        const b = c.bones[i];
        tmpV.copy(c.pos[i]).applyMatrix4(inv);
        b.position.copy(tmpV);
        tmpV2.copy(c.pos[i + 1]).applyMatrix4(inv).sub(tmpV);
        if (i === c.broken) tmpV2.copy(c.restDir[i]);
        tmpQ.setFromUnitVectors(c.restDir[i], tmpV2.normalize());
        b.quaternion.copy(tmpQ).multiply(c.restQuat[i]);
      }
    }
  }
}
