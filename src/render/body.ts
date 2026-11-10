// Cuerpo anatómico de una persona (§6): 4 capas sobre la misma armadura.
// Huesos con parentado rígido (sin skinning); piel y músculo con skinning; órganos
// rígidos al tórax; el corazón late con el reloj real.
// Fase 3: barrido de escáner al aparecer, retención de la última pose si la persona se va
// (la obra nunca se detiene, §9.7), congelamiento del esqueleto (§1.5), costillas rotas,
// corazón extraíble y receptor virtual del modo solo.
// Fase 4: metamorfosis hueso a hueso (§9.4): grieta → estallido en fragmentos físicos → el hueso
// de cerdo crece desde el centro; el hocico se alarga y la piel se deforma hacia el cerdo.
import {
  AdditiveBlending, BatchedMesh, Color, Group, Matrix4, Mesh, MeshStandardMaterial, NormalBlending, Quaternion, Skeleton, SkeletonHelper, SkinnedMesh, Vector3,
  type Object3D, type ShaderMaterial,
} from 'three';
import { config } from '../config.ts';
import { Armature, BONE_NAMES, type BoneName } from '../anatomy/armature.ts';
import type { BodyAssets, BoneGeo } from '../anatomy/assets.ts';
import { Retargeter } from '../input/retarget.ts';
import type { Person } from '../input/people.ts';
import type { Projection } from './projection.ts';
import { hashString } from '../random.ts';
import { prepareFracture, type Debris, type FractureData, type FragSet } from './fracture.ts';
import {
  createBoneGlowMaterial, createBoneMaterial, setCrack, setGrowth, setSeeds, setStretch, syncBoneGlow, syncBoneMaterial,
  type BoneMaterial,
} from './materials/bone.ts';
import { MORPH_BODY, MORPH_HEAD, ensurePigMorph } from './morph.ts';
import { setOpen } from './materials/bone.ts';
import { PLATE } from './materials/glsl.ts';
import { HeartRig } from './vessels.ts';
import { createXrayMuscleMaterial, syncXrayMuscle } from './materials/xrayMuscle.ts';
import { createXrayOrganMaterial, syncXrayOrgan } from './materials/xrayOrgan.ts';
import { createXrayFaceMaterial, syncXrayFace } from './materials/xrayFace.ts';
import { createXraySkinMaterial, syncXraySkin } from './materials/xraySkin.ts';

/** Ciclo cardiaco simplificado: contracción auricular breve y ventricular fuerte (0..1). */
export function cardiac(phase: number): number {
  const atrial = Math.exp(-(((phase - 0.05) / 0.035) ** 2)) * 0.35;
  const v = phase > 0.12 && phase < 0.45 ? Math.sin(((phase - 0.12) / 0.33) * Math.PI) : 0;
  return Math.max(atrial, v * v * (3 - 2 * v));
}

export type Species = 'human' | 'pig';

interface SlotMesh {
  slot: string;
  species: Species;
  bone: BoneName;
  mesh: Mesh;
  glow: Mesh | null;
  mat: BoneMaterial | ShaderMaterial;
  glowMat: ShaderMaterial | null;
  /** Tejido que no es hueso (cartílago o la cara de cerdo): sin grietas, brillo de hueso ni manchas. */
  cartilage: boolean;
  /** La cara del cerdo en tejido blando (material propio por espesor, se estira con el hocico). */
  soft: boolean;
  /** 0 = visible, 1.02 = disuelto. */
  dissolve: number;
  rest: Matrix4;
  /** Partición en fragmentos (solo huesos humanos) y sus cuerpos físicos para este cuerpo. */
  fracture: FractureData | null;
  frag: FragSet | null;
  /** Punto de impacto de la grieta (espacio de la pieza), elegido al empezar a agrietarse. */
  crackOrigin: Vector3;
  crackPicked: boolean;
  burst: boolean;
}

interface Organ {
  name: string;
  bone: BoneName;
  /** Ubicación en el bone (o en el mundo, congelado). */
  pivot: Group;
  /** Hijo que escala con el latido/respiración. */
  beat: Group;
  meshes: { mesh: Mesh; mat: ShaderMaterial; ghost: boolean }[];
  restPos: Vector3;
  restQuat: Quaternion;
  /** 0..1 visibilidad de la capa (estados). */
  fade: number;
}

interface Fragment {
  mesh: Mesh;
  rest: Matrix4;
  /** Centro y semiejes de la caja (espacio de modelo) para la física. */
  center: Vector3;
  half: Vector3;
  /** Dirección hacia afuera desde el centro del pecho (espacio de modelo). */
  dir: Vector3;
  frozenBase: Matrix4;
}

const SCAN_TOP = 0.86;
const SCAN_BOTTOM = -1.0;
const SCAN_TIME = 0.8;

const tmpM = new Matrix4();
const tmpV = new Vector3();
const GREY = new Color('#3c3c3c');
const MARROW = new Color('#5a0710');
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);

type FrozenPart = 'trunk' | 'head' | 'armL' | 'armR' | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR';

/** A qué parte del cuerpo pertenece una pieza (para la pose del cerdo congelado). */
function partOf(s: SlotMesh): FrozenPart {
  if (s.slot === 'skull') return 'head';
  const b = s.bone;
  const side = b.startsWith('Left') ? 'L' : b.startsWith('Right') ? 'R' : '';
  if (!side || b.includes('Shoulder')) return 'trunk';
  if (b.includes('UpLeg')) return `thigh${side}`;
  if (b.endsWith('Leg')) return `shin${side}`;
  if (b.includes('Foot') || b.includes('Toe')) return `foot${side}`;
  if (b.includes('Arm') || b.includes('Hand')) return `arm${side}`;
  return 'trunk';
}

/** Rotación `q` alrededor del punto `p`: M·x = q·(x − p) + p. */
function aboutPivot(out: Matrix4, q: Quaternion, p: Vector3): Matrix4 {
  out.makeRotationFromQuaternion(q);
  const e = out.elements;
  const rx = e[0] * p.x + e[4] * p.y + e[8] * p.z;
  const ry = e[1] * p.x + e[5] * p.y + e[9] * p.z;
  const rz = e[2] * p.x + e[6] * p.y + e[10] * p.z;
  return out.setPosition(p.x - rx, p.y - ry, p.z - rz);
}

/** Temporales de la pose congelada (sin `new` en el loop). */
const P = {
  target: new Vector3(), v: new Vector3(), dir: new Vector3(), down: new Vector3(), hip: new Vector3(), lat: new Vector3(),
  fwd: new Vector3(), fwdU: new Vector3(), k: new Vector3(), kt: new Vector3(),
  q: new Quaternion(), q2: new Quaternion(), yaw: new Quaternion(),
  look: new Matrix4(), trunk: new Matrix4(), head: new Matrix4(), m: new Matrix4(), m2: new Matrix4(),
  arm: { L: new Matrix4(), R: new Matrix4() }, thigh: { L: new Matrix4(), R: new Matrix4() },
  shin: { L: new Matrix4(), R: new Matrix4() }, foot: { L: new Matrix4(), R: new Matrix4() },
};

export class BodyRig {
  readonly root = new Group();
  readonly armature: Armature;
  readonly retarget: Retargeter;
  readonly skin: SkinnedMesh;
  readonly muscle: SkinnedMesh;
  readonly helper: SkeletonHelper;
  readonly slots: SlotMesh[] = [];
  readonly organs: Organ[] = [];
  readonly fragments: Fragment[] = [];
  private skinMat: ShaderMaterial;
  private muscleMat: ShaderMaterial;
  private fragMats: MeshStandardMaterial[] = [];
  /** Los ~520 fragmentos de costilla se dibujan en lote: 2 llamadas de dibujo en vez de una por pieza (en la
   *  GPU integrada eran lo que más pesaba y le quitaban tiempo a MediaPipe: el receptor se congelaba).
   *  Las mallas sueltas quedan como "apoderados" que la cámara no dibuja (capa PROXY_LAYER): la física, la
   *  pose congelada y las manchas de sangre las siguen usando igual. `batchRoot` va a la escena. */
  readonly batchRoot = new Group();
  private fragBatches: { batch: BatchedMesh; ids: number[]; frags: Fragment[] }[] = [];
  /** Donde quedan huesos, órganos y fragmentos al congelarse (hijo de la escena). */
  private frozenGroup = new Group();
  readonly index: number;

  personId: number | null = null;
  /** 0..1: presencia del cuerpo (aparición rápida, fundido de salida). */
  presence = 0;
  /** Mantener visible con la última pose aunque la persona se vaya (cuerpos con rol). */
  hold = false;
  /** Receptor virtual del modo solo: pose de reposo, sin persona. */
  virtual = false;
  /** El esqueleto dejó de seguir al visitante (§1.5). */
  frozen = false;
  /** Visibilidad por capa (la controlan los estados): 0..1. */
  layers = { skin: 1, muscle: 1, organs: 1, bones: 1 };
  /** Disolución global de lo congelado (AUSENCIA). */
  frozenDissolve = 0;
  /** Articulaciones (mundo) en el momento de congelarse: cápsulas de la sangre y piso. */
  readonly frozenJoints = {} as Record<BoneName, Vector3>;
  /** Piezas del esqueleto congelado y su matriz de mundo al congelarse (mirada y telos). */
  private frozenParts: { mesh: Mesh; base: Matrix4; part: FrozenPart }[] = [];
  /** Fragmentos de costilla que salieron volando (los mueve la física, no la pose). */
  private looseFrags = new Set<Mesh>();
  private readonly snoutDir = new Vector3();
  private revealT = -1;
  /** Las costillas se reemplazan por sus fragmentos (EXTRACCIÓN). */
  private ribsBroken = false;
  private beatPhase = Math.random();
  private lastSolve = 0;
  private wasVisible = false;
  private debugPig = false;
  private debris: Debris | null;
  /** Corazón de carne de la cinemática (null con placeholders). */
  cineHeart: HeartRig | null = null;
  private fleshOn = false;
  /** Las costillas rotas las maneja Rapier (cinemática), no la animación de la Fase 3. */
  private ribsPhysics = false;
  /** 0..1: el borrado alcanza también la médula expuesta y el tinte del corazón (0 píxeles rojos). */
  bloodErase = 0;

  constructor(assets: BodyAssets, index: number, debris: Debris | null = null) {
    this.index = index;
    this.debris = debris;
    this.root.name = `body_${index}`;
    this.frozenGroup.name = `body_${index}_congelado`;
    this.armature = new Armature(assets.rest, assets.meta);
    this.retarget = new Retargeter(this.armature);
    this.root.add(this.armature.root);
    this.root.updateMatrixWorld(true);
    const skeleton = new Skeleton(this.armature.list);

    this.skinMat = createXraySkinMaterial();
    this.muscleMat = createXrayMuscleMaterial();
    this.skin = new SkinnedMesh(assets.skin, this.skinMat);
    this.muscle = new SkinnedMesh(assets.muscle, this.muscleMat);
    for (const m of [this.skin, this.muscle]) {
      m.bind(skeleton, new Matrix4());
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.muscle.renderOrder = 2;
    this.skin.renderOrder = 3;

    // Articulaciones de reposo (espacio de modelo) para el morph y el hocico.
    const joints = {} as Record<BoneName, Vector3>;
    for (const name of BONE_NAMES) joints[name] = this.armature.bones[name].getWorldPosition(new Vector3());
    // Hasta dónde llega el hocico óseo del cerdo (la piel lo cubre).
    let snoutFront: number | null = null;
    for (const piece of assets.pigBones) {
      if (piece.slot !== 'skull') continue;
      piece.geometry.computeBoundingBox();
      snoutFront = Math.max(snoutFront ?? -Infinity, piece.geometry.boundingBox!.max.z);
    }
    if (ensurePigMorph(assets.skin, joints, snoutFront)) this.skin.updateMorphTargets();
    // Hocico: se estira hacia adelante desde el frente del neurocráneo (§9.4).
    const headH = joints.HeadTop_End.distanceTo(joints.Head);
    const headUp = new Vector3().subVectors(joints.HeadTop_End, joints.Head).normalize();
    const snoutAxis = new Vector3(0, 0, 1).addScaledVector(headUp, -headUp.z).normalize();
    const snoutPivot = joints.Head.clone().addScaledVector(snoutAxis, (0.09 * headH) / 0.22);

    const restInv = (b: BoneName) => new Matrix4().copy(this.armature.bones[b].matrixWorld).invert();
    // Un material por pieza: cada hueso se disuelve por separado en la metamorfosis (§9.4).
    const attach = (list: BoneGeo[], species: Species) => {
      for (const [k, piece] of list.entries()) {
        const bone = this.armature.bones[piece.bone];
        if (!bone) continue;
        const soft = piece.material === 'soft';
        const cartilage = piece.material === 'cartilage' || soft;
        const mat = soft
          ? createXrayFaceMaterial()
          : cartilage ? createXrayOrganMaterial('cartilage') : createBoneMaterial(piece.material === 'teeth' ? 'teeth' : 'bone');
        const mesh = new Mesh(piece.geometry, mat);
        mesh.name = `${piece.slot}_${species}`;
        mesh.matrixAutoUpdate = false;
        const rest = restInv(piece.bone);
        mesh.matrix.copy(rest);
        if (cartilage) mesh.renderOrder = 1;
        bone.add(mesh);
        let glow: Mesh | null = null;
        let glowMat: ShaderMaterial | null = null;
        if (!cartilage) {
          glowMat = createBoneGlowMaterial();
          glow = new Mesh(piece.geometry, glowMat);
          glow.renderOrder = 4;
          mesh.add(glow);
        }
        let fracture: FractureData | null = null;
        let frag: FragSet | null = null;
        if (!cartilage && species === 'human') {
          fracture = prepareFracture(piece.geometry, hashString(`${piece.slot}#${k}`));
          if (fracture) {
            setSeeds(mat as BoneMaterial, fracture.seeds, fracture.xf);
            frag = debris?.register(index, fracture) ?? null;
          }
        }
        if (!cartilage && species === 'pig' && piece.slot === 'ribs') {
          // Grietas de la cinemática (plano 3): las costillas del cerdo también tienen celdas de fractura.
          const fr = prepareFracture(piece.geometry, hashString(`ribs_pig#${k}`));
          if (fr) setSeeds(mat as BoneMaterial, fr.seeds, fr.xf);
        }
        if (!cartilage && species === 'pig') {
          // El cerdo crece desde el centro de cada pieza.
          piece.geometry.computeBoundingSphere();
          const bs = piece.geometry.boundingSphere!;
          for (const m of [mat, glowMat!]) {
            setGrowth(m, 0, bs.center, bs.radius);
            if (piece.slot === 'skull') setStretch(m, 1, snoutPivot, snoutAxis);
          }
        }
        // La cara del cerdo se estira junto con el hocico del cráneo (§9.4).
        if (soft && piece.slot === 'skull') setStretch(mat, 1, snoutPivot, snoutAxis);
        this.slots.push({
          slot: piece.slot, species, bone: piece.bone, mesh, glow, mat, glowMat, cartilage, soft,
          dissolve: species === 'human' ? 0 : 1.02, rest,
          fracture, frag, crackOrigin: new Vector3(), crackPicked: false, burst: false,
        });
      }
    };
    attach(assets.bones, 'human');
    attach(assets.pigBones, 'pig');

    // Órganos: pivote en su centro + hijo de latido.
    for (const o of assets.organs) {
      const bone = this.armature.bones[o.bone];
      const pivot = new Group();
      const local = new Matrix4().copy(restInv(o.bone)).multiply(new Matrix4().makeTranslation(o.center.x, o.center.y, o.center.z));
      local.decompose(pivot.position, pivot.quaternion, tmpS);
      const beat = new Group();
      pivot.add(beat);
      const meshes: Organ['meshes'] = [];
      const mat = createXrayOrganMaterial(o.name);
      const mesh = new Mesh(o.geometry, mat);
      mesh.position.set(-o.center.x, -o.center.y, -o.center.z);
      mesh.renderOrder = 1;
      beat.add(mesh);
      meshes.push({ mesh, mat, ghost: false });
      if (o.name === 'heart') {
        // Como en una placa, las densidades se suman: el latido se intuye a través del esternón.
        const ghostMat = createXrayOrganMaterial('heart');
        ghostMat.depthTest = false;
        const ghost = new Mesh(o.geometry, ghostMat);
        ghost.position.copy(mesh.position);
        ghost.renderOrder = 5;
        beat.add(ghost);
        meshes.push({ mesh: ghost, mat: ghostMat, ghost: true });
      }
      bone.add(pivot);
      this.organs.push({ name: o.name, bone: o.bone, pivot, beat, meshes, restPos: pivot.position.clone(), restQuat: pivot.quaternion.clone(), fade: 1 });
    }

    // Fragmentos de costilla del cerdo (ocultos hasta la extracción).
    if (assets.ribFragments.length) {
      const boneM = new MeshStandardMaterial({ color: '#dfe7ee', roughness: 0.4, emissive: '#9fb2c4', emissiveIntensity: 0.06, transparent: true });
      const marrow = new MeshStandardMaterial({ color: '#5a0710', roughness: 0.55, transparent: true });
      this.fragMats = [boneM, marrow];
      const chest = new Vector3(0, 0, 0);
      for (const f of assets.ribFragments) {
        f.geometry.computeBoundingSphere();
        chest.add(f.geometry.boundingSphere!.center);
      }
      chest.divideScalar(assets.ribFragments.length);
      chest.z -= 0.04; // centro del tórax algo por detrás de las costillas
      for (const f of assets.ribFragments) {
        const mesh = new Mesh(f.geometry, f.material === 'marrow' ? marrow : boneM);
        mesh.matrixAutoUpdate = false;
        const rest = restInv(f.bone);
        mesh.matrix.copy(rest);
        mesh.visible = false;
        this.armature.bones[f.bone].add(mesh);
        const dir = f.geometry.boundingSphere!.center.clone().sub(chest);
        f.geometry.computeBoundingBox();
        const bb = f.geometry.boundingBox!;
        this.fragments.push({
          mesh, rest, dir, frozenBase: new Matrix4(), center: bb.getCenter(new Vector3()), half: bb.getSize(new Vector3()).multiplyScalar(0.5),
        });
      }
    }

    this.buildFragmentBatches();

    // Corazón de carne con vasos (heart.glb) para la cinemática: late con el corazón del donante.
    const heartOrgan = this.organ('heart');
    const heartGeo = assets.organs.find((o) => o.name === 'heart');
    if (assets.heartRig && heartOrgan && heartGeo) {
      this.cineHeart = new HeartRig(assets.heartRig, heartGeo.center);
      heartOrgan.beat.add(this.cineHeart.group);
    }

    this.helper = new SkeletonHelper(this.armature.root);
    this.helper.visible = false;
    this.root.visible = false;
  }

  /** Un lote por material (hueso, médula) con todos los fragmentos. Si el navegador no puede, quedan las
   *  mallas sueltas como antes. */
  private buildFragmentBatches(): void {
    if (!this.fragments.length) return;
    this.batchRoot.name = `body_${this.index}_fragmentos`;
    try {
      for (const mat of this.fragMats) {
        const frags = this.fragments.filter((f) => f.mesh.material === mat);
        if (!frags.length) continue;
        let verts = 0;
        let idx = 0;
        for (const f of frags) {
          const g = f.mesh.geometry;
          verts += g.attributes.position.count;
          idx += g.index ? g.index.count : g.attributes.position.count;
        }
        const batch = new BatchedMesh(frags.length, verts, idx, mat);
        batch.name = `${this.batchRoot.name}_${mat === this.fragMats[0] ? 'hueso' : 'medula'}`;
        batch.frustumCulled = false;
        batch.perObjectFrustumCulled = false;
        batch.sortObjects = false;
        const ids = frags.map((f) => {
          const id = batch.addInstance(batch.addGeometry(f.mesh.geometry));
          batch.setVisibleAt(id, false);
          return id;
        });
        this.fragBatches.push({ batch, ids, frags });
        this.batchRoot.add(batch);
      }
      for (const f of this.fragments) f.mesh.layers.set(PROXY_LAYER);
    } catch (err) {
      console.warn('[fragmentos] sin lote, se dibujan sueltos:', err);
      for (const b of this.fragBatches) b.batch.dispose();
      this.fragBatches = [];
      this.batchRoot.clear();
    }
  }

  /** Antes de dibujar: posición y visibilidad de cada fragmento (de su apoderado) al lote. */
  syncFragmentBatches(): void {
    for (const { batch, ids, frags } of this.fragBatches) {
      for (let i = 0; i < frags.length; i++) {
        const m = frags[i].mesh;
        let vis = true;
        for (let o: Object3D | null = m; o; o = o.parent) {
          if (!o.visible) {
            vis = false;
            break;
          }
        }
        // Sin padre en la escena (no debería pasar) tampoco se dibuja.
        vis = vis && !!m.parent;
        batch.setVisibleAt(ids[i], vis);
        if (!vis) continue;
        m.updateWorldMatrix(true, false);
        batch.setMatrixAt(ids[i], m.matrixWorld);
      }
    }
  }

  // ── asignación ────────────────────────────────────────────────

  assign(personId: number): void {
    this.personId = personId;
    this.retarget.reset();
    this.armature.resetPose();
    this.presence = 1;
    this.startReveal();
  }

  release(): void {
    this.personId = null;
    this.hold = false;
  }

  get free(): boolean {
    return this.personId === null && !this.virtual && !this.hold && this.presence <= 0;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Barrido de escáner de arriba abajo (§9.2). */
  startReveal(): void {
    this.revealT = 0;
  }

  /** Receptor virtual del modo solo: cuerpo vacío quieto a un lado (§9.8). */
  makeVirtual(position: Vector3, scale: number): void {
    this.virtual = true;
    this.personId = null;
    this.hold = true;
    this.armature.resetPose();
    this.root.position.copy(position);
    this.root.scale.setScalar(scale);
    this.retarget.hasPose = true;
    this.presence = 1;
    this.layers = { skin: 1, muscle: 0, organs: 0, bones: 0 };
    this.startReveal();
  }

  // ── metamorfosis (§9.4) ───────────────────────────────────────

  /** Disolución de las piezas de un slot y especie (0 visible … 1.02 disuelto). */
  setSlotDissolve(slot: string, species: Species, value: number): void {
    for (const s of this.slots) if (s.slot === slot && s.species === species) s.dissolve = value;
  }

  get hasPig(): boolean {
    return this.slots.some((s) => s.species === 'pig');
  }

  /** Grieta de las piezas humanas de un slot (0..1), desde un punto del frente del hueso. */
  crackSlot(slot: string, progress: number): void {
    for (const s of this.slots) {
      if (s.slot !== slot || s.species !== 'human' || s.cartilage || !s.fracture || s.burst) continue;
      if (!s.crackPicked && progress > 0) {
        const f = s.fracture.front;
        s.crackOrigin.fromBufferAttribute(s.mesh.geometry.getAttribute('position'), f[Math.floor(Math.random() * f.length)]);
        s.crackPicked = true;
      }
      setCrack(s.mat as BoneMaterial, progress, s.crackOrigin, s.fracture.radius * 2);
    }
  }

  /** Estallido: cada pieza humana del slot se reemplaza en el mismo frame por sus fragmentos
   *  físicos, más astillas y polvo. El cartílago (sin fragmentos) desaparece. */
  burstSlot(slot: string, strength: number): void {
    const scale = this.root.scale.x;
    for (const s of this.slots) {
      if (s.slot !== slot || s.species !== 'human' || s.burst) continue;
      s.burst = true;
      s.dissolve = 1.02;
      if (!s.fracture || !s.frag || !this.debris) continue;
      s.mesh.updateWorldMatrix(true, false);
      const w = s.mesh.matrixWorld;
      tmpV.copy(s.crackOrigin).applyMatrix4(w);
      this.debris.burst(s.frag, w, tmpV, s.crackOrigin, s.fracture.radius * 2, strength);
      // Astillas y polvo desde el punto de impacto, a medio camino del centro de la pieza.
      tmpV2.copy(s.fracture.center).applyMatrix4(w).lerp(tmpV, 0.5);
      this.debris.spray(tmpV2, s.fracture.radius, scale, strength);
    }
  }

  /** El hueso de cerdo de un slot crece desde el centro (0 → 1). */
  growSlot(slot: string, grow: number): void {
    const g = Math.max(0, Math.min(1, grow));
    for (const s of this.slots) {
      if (s.slot !== slot || s.species !== 'pig') continue;
      s.dissolve = 1.02 * (1 - g);
      if (s.cartilage) continue;
      const radial = g > 0 && g < 1 ? 1 : 0;
      setGrowth(s.mat, radial);
      if (s.glowMat) setGrowth(s.glowMat, radial);
    }
  }

  /** Largo del hocico del cerdo (1 = el modelo; < 1 recogido, > 1 sobrepaso). */
  setSnout(stretch: number): void {
    for (const s of this.slots) {
      if (s.slot !== 'skull' || s.species !== 'pig') continue;
      setStretch(s.mat, stretch);
      if (s.glowMat) setStretch(s.glowMat, stretch);
    }
  }

  /** Morph de la piel hacia el cerdo: cara y tórax (0..1). */
  setMorph(head: number, body: number): void {
    const inf = this.skin.morphTargetInfluences;
    if (!inf) return;
    inf[MORPH_HEAD] = head * config.transform.morphHead;
    inf[MORPH_BODY] = body * config.transform.morphBody;
  }

  /** Altura del piso bajo los pies (mundo): ahí caen fragmentos y astillas. */
  floorY(): number {
    let y = Infinity;
    for (const n of ['LeftFoot', 'RightFoot', 'LeftToe_End', 'RightToe_End'] as BoneName[]) {
      this.armature.bones[n].updateWorldMatrix(true, false);
      y = Math.min(y, tmpV.setFromMatrixPosition(this.armature.bones[n].matrixWorld).y);
    }
    return y - 0.035 * this.root.scale.x;
  }

  /** Cambio inmediato a cerdo (saltos de estado con teclas y final de la transformación). */
  instantPig(): void {
    for (const s of this.slots) {
      s.dissolve = s.species === 'pig' ? 0 : 1.02;
      if (s.species === 'pig' && !s.cartilage) {
        setGrowth(s.mat, 0);
        if (s.glowMat) setGrowth(s.glowMat, 0);
      }
    }
    this.setSnout(1);
    this.setMorph(1, 1);
  }

  /** Debug de la Fase 2: ver el cerdo sobre el cuerpo en vivo (solo fuera del ciclo). */
  setDebugPig(on: boolean): void {
    if (on === this.debugPig || this.frozen) return;
    this.debugPig = on;
    if (on) this.instantPig();
    else this.restoreHuman();
  }

  restoreHuman(): void {
    for (const s of this.slots) {
      s.dissolve = s.species === 'human' ? 0 : 1.02;
      s.burst = false;
      s.crackPicked = false;
      if (!s.cartilage) setCrack(s.mat as BoneMaterial, 0);
      if (s.species === 'human' && !s.cartilage) setOpen(s.mat as BoneMaterial, 0, 0);
      if (s.species === 'pig' && !s.cartilage) {
        setGrowth(s.mat, 0);
        if (s.glowMat) setGrowth(s.glowMat, 0);
      }
    }
    this.setSnout(1);
    this.setMorph(0, 0);
  }

  // ── congelamiento ─────────────────────────────────────────────

  /** El esqueleto (y lo que lleva dentro) queda quieto en el mundo; la piel sigue al visitante. */
  freezeSkeleton(scene: Object3D): void {
    if (this.frozen) return;
    this.frozen = true;
    scene.add(this.frozenGroup);
    this.root.updateMatrixWorld(true);
    for (const name of BONE_NAMES) {
      (this.frozenJoints[name] ??= new Vector3()).setFromMatrixPosition(this.armature.bones[name].matrixWorld);
    }
    for (const s of this.slots) {
      const world = s.mesh.matrixWorld.clone();
      this.frozenGroup.add(s.mesh);
      s.mesh.matrix.copy(world);
    }
    for (const o of this.organs) {
      o.pivot.updateMatrixWorld(true);
      o.pivot.matrixWorld.decompose(tmpV, tmpQ, tmpS);
      this.frozenGroup.add(o.pivot);
      o.pivot.position.copy(tmpV);
      o.pivot.quaternion.copy(tmpQ);
      o.pivot.scale.copy(tmpS);
    }
    for (const f of this.fragments) {
      const world = f.mesh.matrixWorld.clone();
      this.frozenGroup.add(f.mesh);
      f.mesh.matrix.copy(world);
      f.frozenBase.copy(world);
    }
    // Para la mirada y el telos: cada pieza con su parte del cuerpo, y hacia dónde apunta el hocico.
    this.frozenParts = this.slots.map((s) => ({ mesh: s.mesh, base: s.mesh.matrix.clone(), part: partOf(s) }));
    this.looseFrags.clear();
    const pig = this.slots.find((s) => s.slot === 'skull' && s.species === 'pig');
    this.snoutDir.set(0, 0, 1);
    if (pig) {
      pig.mesh.geometry.computeBoundingBox();
      pig.mesh.geometry.boundingBox!.getCenter(tmpV).applyMatrix4(pig.mesh.matrix).sub(this.frozenJoints.Head);
      tmpV.y = 0;
      if (tmpV.lengthSq() > 1e-8) this.snoutDir.copy(tmpV).normalize();
    }
  }

  /** Pose del esqueleto congelado en la ausencia (§9.6), sobre su pose al congelarse.
   *  - `look` 0..1, la mirada (Berger): el cráneo gira de perfil, hocico hacia `toward`, un ojo al público.
   *  - `telos` 0..1 (Rollin): el cuerpo gira hacia donde mira, el tronco se inclina, las patas delanteras
   *    bajan al piso y las traseras se doblan: queda en cuatro patas mientras se disuelve. */
  poseFrozen(look: number, telos: number, toward: Vector3, viewer: Vector3, toPublic: number): void {
    if (!this.frozen || !this.frozenParts.length) return;
    const J = this.frozenJoints;
    const u = Math.max(0, Math.min(1, telos));
    // Hacia dónde: el receptor, con un poco de público.
    P.target.subVectors(toward, J.Head).setY(0).normalize();
    P.v.subVectors(viewer, J.Head).setY(0).normalize();
    P.target.lerp(P.v, toPublic);
    if (P.target.lengthSq() < 1e-8) return;
    P.target.normalize();
    // Mirada (lo que queda de ella cuando el cuerpo ya gira).
    P.q.setFromUnitVectors(this.snoutDir, P.target);
    P.q2.identity().slerp(P.q, Math.max(0, Math.min(1, look)) * (1 - u));
    aboutPivot(P.look, P.q2, J.Head);
    // Marco del cuerpo: caderas, lateral y frente horizontales.
    P.hip.addVectors(J.LeftUpLeg, J.RightUpLeg).multiplyScalar(0.5);
    P.lat.subVectors(J.LeftUpLeg, J.RightUpLeg).setY(0).normalize();
    P.fwd.crossVectors(P.lat, UP).normalize();
    // Giro del cuerpo hacia el destino y eje de la inclinación (frente hacia abajo).
    P.q.setFromUnitVectors(P.fwd, P.target);
    P.yaw.identity().slerp(P.q, u);
    P.fwdU.copy(P.fwd).applyQuaternion(P.yaw);
    P.k.crossVectors(UP, P.fwdU).normalize();
    const alpha = (config.absence.telosPitchDeg * Math.PI) / 180;
    // Cuánto bajan las caderas para que las patas delanteras toquen el piso (con la inclinación completa).
    const armLen = J.LeftArm.distanceTo(J.LeftForeArm) + J.LeftForeArm.distanceTo(J.LeftHand) + 0.1 * this.root.scale.x;
    P.q.setFromAxisAngle(P.k, alpha);
    P.v.addVectors(J.LeftArm, J.RightArm).multiplyScalar(0.5).sub(P.hip).applyQuaternion(P.q);
    const legH = P.hip.y - (J.LeftFoot.y + J.RightFoot.y) / 2;
    const drop = Math.min(Math.max(0, P.hip.y + P.v.y - armLen - this.frozenFloorY()), 0.45 * legH) * u;
    // Tronco: gira e inclina alrededor de las caderas y baja.
    P.q.setFromAxisAngle(P.k, alpha * u).multiply(P.yaw);
    aboutPivot(P.trunk, P.q, P.hip);
    P.trunk.elements[13] -= drop;
    // Cabeza: con el tronco, pero se endereza (el hocico vuelve a quedar horizontal).
    P.v.copy(J.Head).applyMatrix4(P.trunk);
    P.q.setFromAxisAngle(P.k, -alpha * u * 0.85);
    aboutPivot(P.m, P.q, P.v);
    P.head.multiplyMatrices(P.m, P.trunk).multiply(P.look);
    // Patas delanteras: desde el hombro, hacia el piso.
    P.down.set(0, -1, 0).addScaledVector(P.fwdU, 0.12).normalize();
    for (const side of ['L', 'R'] as const) {
      const n = side === 'L' ? 'Left' : 'Right';
      const sh = P.v.copy(J[`${n}Arm` as BoneName]).applyMatrix4(P.trunk);
      P.dir.copy(J[`${n}Hand` as BoneName]).applyMatrix4(P.trunk).sub(sh).normalize();
      P.q.setFromUnitVectors(P.dir, P.down);
      P.q2.identity().slerp(P.q, u);
      aboutPivot(P.m, P.q2, sh);
      P.arm[side].multiplyMatrices(P.m, P.trunk);
      // Patas traseras: solo giran y se doblan en Z (rodilla adelante, corvejón atrás) para bajar `drop`.
      const beta = Math.acos(Math.max(-1, Math.min(1, (legH - drop) / Math.max(1e-4, legH))));
      aboutPivot(P.m, P.yaw, P.hip);
      P.m.elements[13] -= drop;
      P.kt.crossVectors(P.fwdU, UP).normalize();
      P.v.copy(J[`${n}UpLeg` as BoneName]).applyMatrix4(P.m);
      aboutPivot(P.m2, P.q.setFromAxisAngle(P.kt, beta), P.v);
      P.thigh[side].multiplyMatrices(P.m2, P.m);
      P.v.copy(J[`${n}Leg` as BoneName]).applyMatrix4(P.thigh[side]);
      aboutPivot(P.m2, P.q.setFromAxisAngle(P.kt, -2 * beta), P.v);
      P.shin[side].multiplyMatrices(P.m2, P.thigh[side]);
      P.v.copy(J[`${n}Foot` as BoneName]).applyMatrix4(P.shin[side]);
      aboutPivot(P.m2, P.q.setFromAxisAngle(P.kt, beta), P.v);
      P.foot[side].multiplyMatrices(P.m2, P.shin[side]);
    }
    for (const fp of this.frozenParts) {
      const M = fp.part === 'trunk' ? P.trunk : fp.part === 'head' ? P.head : fp.part === 'armL' ? P.arm.L : fp.part === 'armR' ? P.arm.R
        : fp.part === 'thighL' ? P.thigh.L : fp.part === 'thighR' ? P.thigh.R : fp.part === 'shinL' ? P.shin.L : fp.part === 'shinR' ? P.shin.R
        : fp.part === 'footL' ? P.foot.L : P.foot.R;
      fp.mesh.matrix.multiplyMatrices(M, fp.base);
    }
    // Las costillas que quedaron en su lugar van con el tronco; las que volaron, no.
    if (this.ribsBroken) for (const f of this.fragments) if (!this.looseFrags.has(f.mesh)) f.mesh.matrix.multiplyMatrices(P.trunk, f.frozenBase);
  }

  /** Grietas en las costillas del cerdo (plano 3): se propagan desde `originWorld` por ~3 costillas. */
  crackPigRibs(progress: number, originWorld: Vector3, radius: number): void {
    for (const s of this.slots) {
      if (s.slot !== 'ribs' || s.species !== 'pig' || s.cartilage) continue;
      s.mesh.updateWorldMatrix(true, false);
      tmpV.copy(originWorld).applyMatrix4(tmpM.copy(s.mesh.matrixWorld).invert());
      setCrack(s.mat as BoneMaterial, progress, tmpV, radius / Math.max(1e-3, this.root.scale.x));
    }
  }

  /** Plano 4: las costillas se quiebran hacia afuera. Los fragmentos del frente del tórax pasan a
   *  Rapier y salen volando; el resto de la caja queda en su lugar (el pecho queda abierto). */
  breakRibsPhysics(originWorld: Vector3, speed: number, spin: number): void {
    if (!this.fragments.length || !this.debris) {
      this.breakRibs(1);
      return;
    }
    this.ribsBroken = true;
    this.ribsPhysics = true;
    const items = [];
    for (const f of this.fragments) {
      f.mesh.visible = true;
      f.mesh.matrix.copy(f.frozenBase);
      f.mesh.matrixWorldNeedsUpdate = true;
      // Frente del tórax, alrededor del esternón y a la altura del corazón.
      if (f.dir.z > 0.012 && Math.abs(f.dir.x) < 0.12 && f.dir.y > -0.13 && f.dir.y < 0.11) {
        items.push({ mesh: f.mesh, base: f.frozenBase, center: f.center, half: f.half });
      }
    }
    for (const it of items) this.looseFrags.add(it.mesh);
    this.debris.launch(this.index, items, originWorld, speed * this.root.scale.x, spin);
  }

  /** Corazón de carne (cinemática) en lugar del corazón de rayos X. */
  setFleshHeart(on: boolean): void {
    this.fleshOn = on && !!this.cineHeart;
    this.cineHeart?.show(this.fleshOn);
  }

  get fleshHeart(): boolean {
    return this.fleshOn;
  }

  /** Plano 9: las costillas del receptor se abren apenas, como un diafragma de luz blanca. */
  setDiaphragm(centerWorld: Vector3, open: number, glow: number, radius: number): void {
    for (const s of this.slots) {
      if (s.slot !== 'ribs' || s.species !== 'human' || s.cartilage) continue;
      s.mesh.updateWorldMatrix(true, false);
      tmpV.copy(centerWorld).applyMatrix4(tmpM.copy(s.mesh.matrixWorld).invert());
      const k = 1 / Math.max(1e-3, this.root.scale.x);
      setOpen(s.mat as BoneMaterial, open * k, glow, tmpV, radius * k);
    }
  }

  /** Costillas rotas hacia afuera (0..1), animadas sin física (saltos con teclas). */
  breakRibs(progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    if (this.ribsPhysics) {
      if (p > 0) return;
      // Volver a cerrar el pecho (repetir la cinemática): la física suelta los fragmentos.
      this.ribsPhysics = false;
      this.debris?.clearBody(this.index);
    }
    this.ribsBroken = p > 0 && this.fragments.length > 0;
    if (!this.fragments.length) return;
    const e = 1 - (1 - p) * (1 - p);
    const scale = this.root.scale.x;
    for (const f of this.fragments) {
      f.mesh.visible = p > 0;
      // Las piezas del frente salen más (el pecho se abre hacia la cámara).
      const front = Math.max(0, f.dir.z + 0.02) * 6;
      tmpV.copy(f.dir).normalize().multiplyScalar(e * (0.02 + front * 0.06) * scale);
      tmpV.y -= e * e * 0.03 * scale; // caen un poco
      tmpM.makeTranslation(tmpV.x, tmpV.y, tmpV.z);
      f.mesh.matrix.multiplyMatrices(tmpM, f.frozenBase);
    }
  }

  /** Fase del ciclo cardiaco (0..1, reloj real): el sonido del latido se dispara con ella. */
  get phase(): number {
    return this.beatPhase;
  }

  /** Latido actual (0..1, reloj real): los chorros arteriales pulsan con él (§9.5 plano 6). */
  get beat(): number {
    return cardiac(this.beatPhase);
  }

  /** Piso bajo el esqueleto congelado (o bajo los pies si no está congelado). */
  frozenFloorY(): number {
    if (!this.frozen) return this.floorY();
    const j = this.frozenJoints;
    return Math.min(j.LeftFoot.y, j.RightFoot.y, j.LeftToe_End.y, j.RightToe_End.y) - 0.035 * this.root.scale.x;
  }

  /** Piezas visibles del cerdo en esos slots (más los fragmentos de costilla si están rotas). */
  pigMeshes(slots: string[]): Mesh[] {
    const out = this.slots.filter((s) => s.species === 'pig' && !s.cartilage && slots.includes(s.slot)).map((s) => s.mesh);
    if (slots.includes('ribs') && this.ribsBroken) for (const f of this.fragments) out.push(f.mesh);
    return out;
  }

  organ(name: string): Organ | undefined {
    return this.organs.find((o) => o.name === name);
  }

  /** Posición de mundo del corazón (siga o no congelado). */
  heartWorld(out: Vector3): Vector3 {
    const h = this.organ('heart');
    if (!h) return this.chestWorld(out);
    h.pivot.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(h.pivot.matrixWorld);
  }

  /** Centro del tórax (para anillos y etiquetas). */
  chestWorld(out: Vector3): Vector3 {
    const b = this.armature.bones.Spine2;
    // Actualiza también los ancestros: el cuerpo puede haberse movido en este mismo frame.
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  /** Vuelve todo al estado inicial de un ciclo. */
  resetCycle(): void {
    for (const s of this.slots) {
      const bone = this.armature.bones[s.bone];
      bone.add(s.mesh);
      s.mesh.matrix.copy(s.rest);
      s.mesh.visible = true;
    }
    for (const o of this.organs) {
      this.armature.bones[o.bone].add(o.pivot);
      o.pivot.position.copy(o.restPos);
      o.pivot.quaternion.copy(o.restQuat);
      o.pivot.scale.setScalar(1);
      o.pivot.visible = true;
      o.fade = 1;
    }
    for (const f of this.fragments) {
      this.armature.bones.Spine2.add(f.mesh);
      f.mesh.matrix.copy(f.rest);
      f.mesh.visible = false;
    }
    this.frozenGroup.removeFromParent();
    this.frozenParts = [];
    this.looseFrags.clear();
    this.debris?.clearBody(this.index);
    this.ribsPhysics = false;
    this.bloodErase = 0;
    this.cineHeart?.reset();
    this.setFleshHeart(false);
    this.frozen = false;
    this.ribsBroken = false;
    this.frozenDissolve = 0;
    this.virtual = false;
    this.hold = false;
    this.debugPig = false;
    this.layers = { skin: 1, muscle: 1, organs: 1, bones: 1 };
    this.restoreHuman();
  }

  // ── por frame ─────────────────────────────────────────────────

  /** `dt` del reloj de juego (pose), `dtReal` del reloj real (latido y fundidos), `now` en s reales. */
  update(dt: number, dtReal: number, person: Person | null, proj: Projection, now: number): void {
    if (!this.virtual && person && person.fresh) {
      const since = this.lastSolve ? Math.min(0.2, now - this.lastSolve) : 1 / 30;
      this.retarget.solve(person, proj, since);
      this.lastSolve = now;
      person.fresh = false;
    }
    const keep = this.virtual || this.hold || (person !== null && person.state !== 'leaving');
    if (!keep) this.presence = Math.max(0, this.presence - dtReal / config.tracking.fadeOut);
    this.root.visible = this.presence > 0.001 && this.retarget.hasPose;
    this.frozenGroup.visible = this.root.visible || (this.frozen && this.hold);
    if (!this.root.visible && !this.frozenGroup.visible) {
      this.wasVisible = false;
      return;
    }
    if (this.revealT >= 0) {
      this.revealT += dtReal;
      if (this.revealT > SCAN_TIME + 0.2) this.revealT = -1;
    }

    // Interpolación hacia la pose objetivo (suavizado adicional, §7). Sin persona: última pose.
    if (!this.virtual && person) {
      const r = config.retarget;
      const snap = !this.wasVisible;
      const ka = snap ? 1 : 1 - Math.exp(-r.smoothing * dt);
      const kr = snap ? 1 : 1 - Math.exp(-r.rootSmoothing * dt);
      for (const name of BONE_NAMES) this.armature.bones[name].quaternion.slerp(this.retarget.target[name], ka);
      this.root.position.lerp(this.retarget.rootTarget, kr);
      const s = this.root.scale.x + (this.retarget.scaleTarget - this.root.scale.x) * kr;
      this.root.scale.setScalar(snap ? this.retarget.scaleTarget : s);
    }
    this.wasVisible = true;

    // Latido con el reloj real (§8).
    this.beatPhase = (this.beatPhase + dtReal * (config.heart.bpm / 60)) % 1;
    this.syncMaterials(cardiac(this.beatPhase));
    // Vasos de la cinemática con el reloj de juego (la cámara lenta los frena).
    if (this.fleshOn) this.cineHeart?.update(dt);
  }

  hide(): void {
    this.root.visible = false;
    this.wasVisible = false;
  }

  private syncMaterials(beat: number): void {
    const fade = smooth(this.presence);
    const out = this.presence < 1 ? 1.02 * (1 - smooth(Math.min(1, this.presence * 1.15))) : 0;
    let rY = -10;
    let rG = 0;
    if (this.revealT >= 0) {
      const t = Math.min(1, this.revealT / SCAN_TIME);
      rY = SCAN_TOP + (SCAN_BOTTOM - SCAN_TOP) * t;
      rG = Math.sin(Math.min(1, this.revealT / (SCAN_TIME + 0.2)) * Math.PI) * 1.6;
    }
    const L = this.layers;
    for (const s of this.slots) {
      const d = Math.max(s.dissolve, out, this.frozen ? this.frozenDissolve : 0, 1.02 * (1 - L.bones));
      const hidden = d >= 1.01;
      // Con el pecho abierto, la caja (costillas y cartílago del cerdo) la reemplazan los fragmentos.
      s.mesh.visible = !hidden && !(this.ribsBroken && s.species === 'pig' && (s.slot === 'ribs' || s.slot === 'cartilage'));
      if (hidden) continue;
      if (s.soft) syncXrayFace(s.mat as ShaderMaterial, fade, d);
      else if (s.cartilage) syncXrayOrgan(s.mat as ShaderMaterial, fade * (1 - d / 1.02));
      else {
        syncBoneMaterial(s.mat as BoneMaterial, d);
        if (this.bloodErase > 0) (s.mat as BoneMaterial).userData.uniforms.uMarrow.value.lerp(GREY, this.bloodErase);
      }
      if (s.glowMat) syncBoneGlow(s.glowMat, d);
      setReveal(s.mat, rY, rG);
      if (s.glowMat) setReveal(s.glowMat, rY, rG);
    }
    syncXraySkin(this.skinMat, fade * L.skin);
    syncXrayMuscle(this.muscleMat, fade * L.muscle);
    setReveal(this.skinMat, rY, rG);
    setReveal(this.muscleMat, rY, rG);
    this.skin.visible = L.skin > 0.001;
    this.muscle.visible = L.muscle > 0.001;
    for (const o of this.organs) {
      const of = fade * L.organs * o.fade * (this.frozen ? 1 - this.frozenDissolve / 1.02 : 1);
      o.pivot.visible = of > 0.001;
      for (const m of o.meshes) {
        // Con el corazón de carne de la cinemática, el de rayos X no se dibuja.
        m.mesh.visible = !(o.name === 'heart' && this.fleshOn);
        syncXrayOrgan(m.mat, m.ghost ? of * config.organs.heartThrough : of, o.name === 'heart' ? beat : 0, 1 - this.bloodErase);
        setReveal(m.mat, rY, rG);
      }
      if (o.name === 'heart') o.beat.scale.setScalar(1 - config.heart.contraction * beat);
      if (o.name === 'lungs') {
        // Respiración lenta (~14 rpm) para que el tórax no esté muerto.
        const br = 0.5 + 0.5 * Math.sin(performance.now() * 0.00147);
        o.beat.scale.set(1 + 0.012 * br, 1 + 0.02 * br, 1 + 0.015 * br);
      }
    }
    const fo = 1 - Math.min(1, this.frozen ? this.frozenDissolve / 1.02 : 0);
    for (const m of this.fragMats) m.opacity = fade * fo;
    // Placa real: los fragmentos de costilla dejan de reflejar luz y suman densidad, como el hueso.
    const plate = PLATE.value > 0.5;
    if (this.fragMats[0] && this.fragMats[0].blending !== (plate ? AdditiveBlending : NormalBlending)) {
      const [b] = this.fragMats;
      b.blending = plate ? AdditiveBlending : NormalBlending;
      b.depthWrite = !plate;
      b.color.set(plate ? '#000000' : '#dfe7ee');
      b.emissive.set(plate ? config.plate.color : '#9fb2c4');
      b.emissiveIntensity = plate ? 0.32 : 0.06;
    }
    // La médula de las costillas rotas también se desatura con el borrado.
    if (this.fragMats[1]) this.fragMats[1].color.set(MARROW).lerp(GREY, this.bloodErase);
  }

  /** Objetos a compilar por adelantado. */
  get compileTargets(): Object3D[] {
    return [this.root];
  }
}

/** Capa que la cámara no dibuja: ahí quedan los fragmentos sueltos cuando se dibujan en lote. */
const PROXY_LAYER = 7;

function setReveal(m: BoneMaterial | ShaderMaterial, y: number, glow: number): void {
  const u = ((m as BoneMaterial).userData?.uniforms ?? (m as ShaderMaterial).uniforms) as unknown as
    Record<string, { value: number }> | undefined;
  if (!u?.uRevealY) return;
  u.uRevealY.value = y;
  u.uRevealGlow.value = glow;
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
