// Armadura humanoide con nombres tipo Mixamo (§5.1). La pose de reposo es una
// "A" (brazos 40° bajo la horizontal): deforma mejor la piel hacia brazos abajo
// y hacia brazos arriba que una T. Unidades: metros. Modelo mirando a +Z,
// izquierda anatómica en +X, origen en el centro de la pelvis (bone Hips).
import { Bone, Matrix4, Quaternion, Vector3 } from 'three';

export const BONE_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHand_End',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHand_End',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export const PARENT: Record<BoneName, BoneName | null> = {
  Hips: null, Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop_End: 'Head',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm', LeftHand_End: 'LeftHand',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm', RightHand_End: 'RightHand',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot', LeftToe_End: 'LeftToeBase',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot', RightToe_End: 'RightToeBase',
};

/** Ángulo de los brazos bajo la horizontal en la pose de reposo. */
export const A_POSE_DEG = 40;
/** Altura del suelo respecto del bone Hips. */
export const FLOOR_Y = -0.95;

export type V3 = [number, number, number];

/** Brazo izquierdo en T (canónico), antes de rotarlo a la pose A. */
const T_LEFT_ARM: Record<'LeftArm' | 'LeftForeArm' | 'LeftHand' | 'LeftHand_End', V3> = {
  LeftArm: [0.17, 0.44, 0],
  LeftForeArm: [0.47, 0.44, 0],
  LeftHand: [0.72, 0.44, 0],
  LeftHand_End: [0.9, 0.44, 0],
};

export const SHOULDER_JOINT: V3 = T_LEFT_ARM.LeftArm;

/** Convierte un punto del brazo izquierdo en T (canónico) a la pose A.
 *  side = +1 izquierda, -1 derecha (espejo en X). */
export function armToA(p: V3, side: 1 | -1): V3 {
  const a = (-A_POSE_DEG * Math.PI) / 180;
  const [sx, sy] = SHOULDER_JOINT;
  const x = p[0] - sx;
  const y = p[1] - sy;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rx = sx + x * c - y * s;
  const ry = sy + x * s + y * c;
  return [rx * side, ry, p[2]];
}

/** Rotación de la pose A para el brazo (canónico T → A). */
export function armQuat(side: 1 | -1): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), ((-A_POSE_DEG * Math.PI) / 180) * side);
}

function buildRest(): Record<BoneName, V3> {
  const L: Partial<Record<BoneName, V3>> = {
    Hips: [0, 0, 0],
    Spine: [0, 0.09, 0],
    Spine1: [0, 0.2, 0],
    Spine2: [0, 0.31, 0],
    Neck: [0, 0.47, 0],
    Head: [0, 0.57, 0],
    HeadTop_End: [0, 0.79, 0],
    LeftShoulder: [0.03, 0.43, 0],
    LeftUpLeg: [0.09, -0.04, 0],
    LeftLeg: [0.09, -0.47, 0],
    LeftFoot: [0.09, -0.87, 0],
    LeftToeBase: [0.09, -0.93, 0.13],
    LeftToe_End: [0.09, -0.94, 0.2],
  };
  for (const [k, v] of Object.entries(T_LEFT_ARM)) L[k as BoneName] = armToA(v, 1);
  const out = { ...L } as Record<BoneName, V3>;
  for (const name of BONE_NAMES) {
    if (name.startsWith('Right')) {
      const left = out[name.replace('Right', 'Left') as BoneName];
      out[name] = [-left[0], left[1], left[2]];
    }
  }
  return out;
}

/** Posiciones de reposo (mundo del modelo) de cada articulación. */
export const REST: Record<BoneName, V3> = buildRest();

/** Datos de reposo que el retargeting necesita, válidos para cualquier rig con estos nombres
 *  (también los GLB de la Fase 2, cuyos bones pueden tener rotaciones de reposo ≠ identidad). */
export interface RestInfo {
  local: Quaternion;
  worldQuat: Quaternion;
  worldPos: Vector3;
}

/** Datos de la pose de reposo que no se deducen de las articulaciones. */
export interface RigMeta {
  /** Dirección del dorso de cada mano en reposo (modelo). */
  dorsal: Record<'LeftHand' | 'RightHand', V3>;
  /** Descripción de la pose de reposo (informativa). */
  restPose: string;
}

/** Pose A procedural: en T con la palma abajo el dorso apunta a +Y; rotado 40°. */
export const PROCEDURAL_META: RigMeta = {
  dorsal: {
    LeftHand: new Vector3(0, 1, 0).applyQuaternion(armQuat(1)).toArray() as V3,
    RightHand: new Vector3(0, 1, 0).applyQuaternion(armQuat(-1)).toArray() as V3,
  },
  restPose: 'A (procedural)',
};

export class Armature {
  readonly bones: Record<BoneName, Bone>;
  readonly list: Bone[];
  readonly root: Bone;
  readonly rest: Record<BoneName, RestInfo>;
  readonly meta: RigMeta;

  /** `restPos`: posiciones de reposo de las articulaciones (placeholder o GLB). Las rotaciones de
   *  reposo quedan en identidad: así el retargeting y el skinning no dependen del rig de origen. */
  constructor(restPos: Record<BoneName, V3> = REST, meta: RigMeta = PROCEDURAL_META) {
    this.meta = meta;
    const REST = restPos;
    const bones = {} as Record<BoneName, Bone>;
    for (const name of BONE_NAMES) {
      const b = new Bone();
      b.name = name;
      bones[name] = b;
    }
    for (const name of BONE_NAMES) {
      const parent = PARENT[name];
      const p = REST[name];
      if (parent) {
        const q = REST[parent];
        bones[name].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        bones[parent].add(bones[name]);
      } else {
        bones[name].position.set(p[0], p[1], p[2]);
      }
    }
    this.bones = bones;
    this.list = BONE_NAMES.map((n) => bones[n]);
    this.root = bones.Hips;
    this.root.updateMatrixWorld(true);
    const rest = {} as Record<BoneName, RestInfo>;
    const m = new Matrix4();
    for (const name of BONE_NAMES) {
      const b = bones[name];
      const worldQuat = new Quaternion();
      const worldPos = new Vector3();
      m.copy(b.matrixWorld).decompose(worldPos, worldQuat, new Vector3());
      rest[name] = { local: b.quaternion.clone(), worldQuat, worldPos };
    }
    this.rest = rest;
  }

  /** Vuelve a la pose de reposo. */
  resetPose(): void {
    for (const name of BONE_NAMES) this.bones[name].quaternion.copy(this.rest[name].local);
  }
}
