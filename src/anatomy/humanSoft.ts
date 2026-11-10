// Tejidos blandos PLACEHOLDER: piel, musculatura superficial y órganos (corazón,
// pulmones, hígado), modelados con SDF. Piel y músculo llevan pesos de skinning
// calculados desde las primitivas etiquetadas con cada bone (envolventes suaves).
// Cuerpo neutro, sin rasgos de ninguna persona real.
import { armToA, BONE_NAMES, type BoneName } from './armature.ts';
import { polySDF } from './humanSkeleton.ts';
import type { MeshData } from './polygonize.ts';
import { SDF, sub, type PrimOpts, type V3 } from './sdf.ts';

export interface SkinnedMeshData extends MeshData {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Dirección de fibra por vértice (solo músculo). */
  fiber?: Float32Array;
}

export interface OrganPiece {
  name: 'heart' | 'lungs' | 'liver';
  bone: BoneName;
  mesh: MeshData;
  /** Centro aproximado (para el latido). */
  center: V3;
}

type Side = 1 | -1;
const sideName = (s: Side) => (s > 0 ? 'Left' : 'Right');
const mx = (p: V3, s: Side): V3 => [p[0] * s, p[1], p[2]];

/** Ayudante para miembros superiores: puntos en T (izq. canónica) → pose A del lado. */
function armHelpers(sdf: SDF, side: Side) {
  const A = (p: V3) => armToA(p, side);
  const Av = (v: V3) => {
    const o = armToA([0, 0, 0], 1);
    const r = sub(armToA(v, 1), o);
    return [r[0] * side, r[1], r[2]] as V3;
  };
  const b = (n: string) => `${sideName(side)}${n}` as BoneName;
  return {
    cone: (a: V3, c: V3, r1: number, r2: number, bone: string, k = 0.03) => sdf.cone(A(a), A(c), r1, r2, { k, bone: b(bone) }),
    ell: (c: V3, radii: V3, bone: string, k = 0.03, axis: V3 = [1, 0, 0], up: V3 = [0, 1, 0]) =>
      sdf.ellipsoidAlong(A(c), radii, Av(axis), Av(up), { k, bone: b(bone) }),
  };
}

// ═══════════════════════════════ PIEL ═══════════════════════════════

function skinSDF(): SDF {
  const s = new SDF();
  const T: PrimOpts = { k: 0.05 };
  s.ellipsoid([0, -0.005, -0.012], [0.16, 0.1, 0.108], undefined, { ...T, bone: 'Hips' });
  for (const sd of [1, -1] as const) s.ellipsoid([0.068 * sd, -0.06, -0.058], [0.075, 0.085, 0.066], undefined, { k: 0.04, bone: 'Hips' });
  s.ellipsoid([0, 0.09, 0.008], [0.138, 0.09, 0.104], undefined, { ...T, bone: 'Spine' });
  s.ellipsoid([0, 0.19, -0.008], [0.13, 0.09, 0.104], undefined, { ...T, bone: 'Spine1' });
  s.ellipsoid([0, 0.33, -0.014], [0.156, 0.13, 0.126], undefined, { ...T, bone: 'Spine2' });
  s.ellipsoid([0, 0.415, -0.02], [0.165, 0.055, 0.1], undefined, { ...T, bone: 'Spine2' });
  for (const sd of [1, -1] as const) {
    s.cone(mx([0.045, 0.475, -0.032], sd), mx([0.16, 0.452, -0.02], sd), 0.04, 0.038, { k: 0.035, bone: `${sideName(sd)}Shoulder` });
  }
  s.cone([0, 0.45, -0.014], [0, 0.6, -0.01], 0.058, 0.052, { k: 0.035, bone: 'Neck' });
  // Cabeza neutra.
  const H: PrimOpts = { k: 0.02, bone: 'Head' };
  s.ellipsoid([0, 0.69, -0.012], [0.08, 0.1, 0.1], undefined, H);
  s.ellipsoid([0, 0.6, 0.03], [0.061, 0.056, 0.065], undefined, H);
  s.ellipsoid([0, 0.552, 0.067], [0.024, 0.018, 0.022], undefined, H);
  s.ellipsoid([0, 0.655, 0.085], [0.05, 0.015, 0.02], undefined, H);
  s.cone([0, 0.648, 0.098], [0, 0.615, 0.113], 0.007, 0.013, { k: 0.012, bone: 'Head' });
  s.ellipsoid([0, 0.585, 0.092], [0.022, 0.009, 0.012], undefined, { k: 0.01, bone: 'Head' });
  for (const sd of [1, -1] as const) {
    s.ellipsoid(mx([0.08, 0.645, -0.008], sd), [0.01, 0.03, 0.019], undefined, { k: 0.01, bone: 'Head' });
    s.sphere(mx([0.033, 0.648, 0.104], sd), 0.013, { op: 'sub', k: 0.012 });
  }
  for (const sd of [1, -1] as const) {
    const a = armHelpers(s, sd);
    a.ell([0.18, 0.445, 0], [0.06, 0.052, 0.055], 'Arm', 0.035);
    a.cone([0.19, 0.44, 0], [0.46, 0.44, 0], 0.046, 0.036, 'Arm', 0.03);
    a.cone([0.475, 0.44, 0], [0.71, 0.44, 0], 0.038, 0.025, 'ForeArm', 0.025);
    a.ell([0.54, 0.443, 0], [0.07, 0.034, 0.04], 'ForeArm', 0.03);
    a.ell([0.775, 0.438, 0.0], [0.052, 0.015, 0.042], 'Hand', 0.02);
    for (const [z, l] of [[0.024, 0.075], [0.006, 0.083], [-0.012, 0.078], [-0.028, 0.064]] as const) {
      a.cone([0.815, 0.437, z], [0.815 + l, 0.434, z * 1.15], 0.0095, 0.0075, 'Hand', 0.01);
    }
    a.cone([0.745, 0.432, 0.03], [0.8, 0.425, 0.064], 0.013, 0.0095, 'Hand', 0.015);
    const L = sideName(sd);
    s.cone(mx([0.095, -0.07, -0.005], sd), mx([0.09, -0.45, 0.005], sd), 0.088, 0.055, { k: 0.06, bone: `${L}UpLeg` });
    s.ellipsoid(mx([0.12, -0.22, 0.01], sd), [0.045, 0.14, 0.055], undefined, { k: 0.04, bone: `${L}UpLeg` });
    s.ellipsoid(mx([0.09, -0.47, 0.01], sd), [0.048, 0.05, 0.05], undefined, { k: 0.03, bone: `${L}Leg` });
    s.cone(mx([0.09, -0.48, -0.005], sd), mx([0.09, -0.85, -0.005], sd), 0.05, 0.032, { k: 0.03, bone: `${L}Leg` });
    s.ellipsoid(mx([0.092, -0.6, -0.028], sd), [0.047, 0.1, 0.045], undefined, { k: 0.04, bone: `${L}Leg` });
    s.sphere(mx([0.09, -0.875, -0.005], sd), 0.033, { k: 0.02, bone: `${L}Foot` });
    s.ellipsoid(mx([0.092, -0.925, 0.05], sd), [0.042, 0.028, 0.115], undefined, { k: 0.025, bone: `${L}Foot` });
    s.sphere(mx([0.09, -0.915, -0.035], sd), 0.034, { k: 0.02, bone: `${L}Foot` });
    s.ellipsoid(mx([0.086, -0.935, 0.165], sd), [0.045, 0.019, 0.04], undefined, { k: 0.02, bone: `${L}Foot` });
  }
  return s;
}

// ═══════════════════════════════ MÚSCULO ═══════════════════════════════

function muscleSDF(): SDF {
  const s = new SDF();
  const k = 0.012;
  const core: PrimOpts = { k: 0.04 };
  // Núcleo del tronco (más fino que la piel) con vientres musculares encima.
  s.ellipsoid([0, -0.005, -0.012], [0.148, 0.09, 0.096], undefined, { ...core, bone: 'Hips' });
  s.ellipsoid([0, 0.09, 0.004], [0.126, 0.082, 0.09], undefined, { ...core, bone: 'Spine' });
  s.ellipsoid([0, 0.19, -0.01], [0.12, 0.085, 0.092], undefined, { ...core, bone: 'Spine1' });
  s.ellipsoid([0, 0.33, -0.016], [0.142, 0.12, 0.112], undefined, { ...core, bone: 'Spine2' });
  for (const sd of [1, -1] as const) {
    const L = sideName(sd);
    s.ellipsoidAlong(mx([0.068, 0.376, 0.082], sd), [0.072, 0.048, 0.026], [sd, 0.25, -0.25 * sd], [0, 1, 0], { k, bone: 'Spine2' });
    for (const [y, bone] of [[0.27, 'Spine1'], [0.21, 'Spine1'], [0.15, 'Spine'], [0.075, 'Spine']] as const) {
      s.ellipsoid(mx([0.037, y, 0.088], sd), [0.033, y < 0.1 ? 0.045 : 0.031, 0.016], undefined, { k: 0.008, bone });
    }
    s.ellipsoid(mx([0.112, 0.14, 0.03], sd), [0.034, 0.085, 0.072], undefined, { k, bone: 'Spine' });
    for (const [y, z] of [[0.3, 0.03], [0.27, 0.022], [0.24, 0.012]] as const) {
      s.ellipsoidAlong(mx([0.128, y, z], sd), [0.03, 0.011, 0.014], [0.3 * sd, -0.4, 1], [0, 1, 0], { k: 0.008, bone: 'Spine2' });
    }
    s.ellipsoidAlong(mx([0.102, 0.29, -0.08], sd), [0.12, 0.055, 0.026], [0.3 * sd, 1, 0.1], [0, 0, -1], { k, bone: 'Spine2' });
    s.ellipsoid(mx([0.028, 0.17, -0.095], sd), [0.024, 0.15, 0.024], undefined, { k, bone: 'Spine1' });
    s.ellipsoid(mx([0.074, -0.045, -0.074], sd), [0.068, 0.078, 0.05], undefined, { k, bone: 'Hips' });
    s.cone(mx([0.04, 0.48, -0.042], sd), mx([0.15, 0.452, -0.026], sd), 0.024, 0.02, { k, bone: `${L}Shoulder` });
    s.cone(mx([0.05, 0.6, -0.012], sd), mx([0.018, 0.41, 0.05], sd), 0.011, 0.0095, { k: 0.008, bone: 'Neck' });
    s.ellipsoid(mx([0.062, 0.66, 0.0], sd), [0.012, 0.035, 0.04], undefined, { k, bone: 'Head' });
    s.ellipsoid(mx([0.052, 0.585, 0.02], sd), [0.01, 0.025, 0.02], undefined, { k, bone: 'Head' });

    const a = armHelpers(s, sd);
    a.ell([0.19, 0.443, 0.0], [0.055, 0.045, 0.05], 'Arm', k);
    a.ell([0.32, 0.44, 0.021], [0.085, 0.024, 0.023], 'Arm', k);
    a.ell([0.31, 0.44, -0.021], [0.09, 0.026, 0.023], 'Arm', k);
    a.cone([0.2, 0.44, 0], [0.45, 0.44, 0], 0.028, 0.024, 'Arm', k);
    a.ell([0.55, 0.436, 0.012], [0.08, 0.025, 0.025], 'ForeArm', k);
    a.ell([0.55, 0.446, -0.008], [0.08, 0.023, 0.023], 'ForeArm', k);
    a.ell([0.5, 0.452, 0.012], [0.06, 0.017, 0.019], 'ForeArm', k);
    a.cone([0.48, 0.44, 0], [0.7, 0.44, 0], 0.02, 0.016, 'ForeArm', k);
    a.ell([0.75, 0.432, 0.022], [0.025, 0.01, 0.017], 'Hand', 0.008);
    a.ell([0.775, 0.437, 0], [0.045, 0.011, 0.035], 'Hand', 0.008);

    s.ellipsoid(mx([0.095, -0.24, 0.028], sd), [0.06, 0.17, 0.048], undefined, { k, bone: `${L}UpLeg` });
    s.ellipsoid(mx([0.07, -0.38, 0.03], sd), [0.034, 0.06, 0.034], undefined, { k, bone: `${L}UpLeg` });
    s.ellipsoid(mx([0.09, -0.25, -0.038], sd), [0.048, 0.16, 0.04], undefined, { k, bone: `${L}UpLeg` });
    s.ellipsoid(mx([0.056, -0.15, 0.0], sd), [0.034, 0.12, 0.048], undefined, { k, bone: `${L}UpLeg` });
    s.cone(mx([0.09, -0.07, 0], sd), mx([0.09, -0.44, 0], sd), 0.06, 0.04, { k: 0.02, bone: `${L}UpLeg` });
    s.ellipsoid(mx([0.076, -0.58, -0.03], sd), [0.029, 0.09, 0.034], undefined, { k, bone: `${L}Leg` });
    s.ellipsoid(mx([0.104, -0.57, -0.028], sd), [0.026, 0.08, 0.031], undefined, { k, bone: `${L}Leg` });
    s.ellipsoid(mx([0.09, -0.66, -0.022], sd), [0.038, 0.1, 0.029], undefined, { k, bone: `${L}Leg` });
    s.ellipsoid(mx([0.1, -0.6, 0.018], sd), [0.017, 0.14, 0.017], undefined, { k, bone: `${L}Leg` });
    s.cone(mx([0.09, -0.48, 0], sd), mx([0.09, -0.85, 0], sd), 0.037, 0.022, { k: 0.02, bone: `${L}Leg` });
    s.ellipsoid(mx([0.092, -0.925, 0.05], sd), [0.034, 0.021, 0.1], undefined, { k: 0.015, bone: `${L}Foot` });
  }
  s.ellipsoid([0, 0.43, -0.092], [0.13, 0.058, 0.028], undefined, { k, bone: 'Spine2' });
  s.cone([0, 0.45, -0.016], [0, 0.6, -0.012], 0.045, 0.04, { k: 0.02, bone: 'Neck' });
  s.ellipsoid([0, 0.6, 0.04], [0.05, 0.05, 0.054], undefined, { k: 0.015, bone: 'Head' });
  return s;
}

// ═══════════════════════════════ ÓRGANOS ═══════════════════════════════

function heartSDF(): SDF {
  const s = new SDF();
  s.cone([0.008, 0.305, 0.03], [0.062, 0.228, 0.068], 0.04, 0.013);
  s.ellipsoid([-0.008, 0.268, 0.062], [0.034, 0.03, 0.026], [0, 0, -30], { k: 0.02 });
  s.ellipsoid([0.016, 0.318, 0.0], [0.028, 0.019, 0.022], undefined, { k: 0.015 });
  s.ellipsoid([-0.03, 0.298, 0.03], [0.022, 0.03, 0.024], undefined, { k: 0.015 });
  s.ellipsoid([0.04, 0.315, 0.04], [0.012, 0.008, 0.015], undefined, { k: 0.008 });
  const v = { k: 0.006 };
  s.chain([[0.002, 0.312, 0.035], [0.004, 0.355, 0.038], [0.012, 0.382, 0.022], [0.022, 0.385, -0.005], [0.026, 0.365, -0.03], [0.026, 0.3, -0.04], [0.024, 0.2, -0.042]],
    [0.0115, 0.0115, 0.011, 0.0105, 0.0105, 0.01, 0.0095], v);
  s.chain([[0.008, 0.384, 0.022], [-0.006, 0.42, 0.03]], [0.006, 0.0055], v);
  s.chain([[0.015, 0.388, 0.015], [0.02, 0.43, 0.02]], [0.005, 0.0045], v);
  s.chain([[0.022, 0.385, 0.002], [0.04, 0.425, 0.0]], [0.005, 0.0045], v);
  s.chain([[0.012, 0.31, 0.058], [0.02, 0.338, 0.05], [0.024, 0.352, 0.03]], [0.012, 0.0115, 0.011], v);
  s.chain([[0.024, 0.352, 0.03], [0.055, 0.35, 0.0]], [0.008, 0.007], v);
  s.chain([[0.022, 0.352, 0.028], [-0.04, 0.345, 0.005]], [0.008, 0.007], v);
  s.chain([[-0.03, 0.315, 0.028], [-0.028, 0.36, 0.022], [-0.026, 0.405, 0.02]], [0.0095, 0.009, 0.0085], v);
  s.chain([[-0.025, 0.28, 0.02], [-0.022, 0.2, 0.0]], [0.011, 0.01], v);
  return s;
}

export function lungsSDF(): SDF {
  const s = new SDF();
  s.ellipsoid([-0.072, 0.315, -0.005], [0.064, 0.13, 0.085]);
  s.ellipsoid([-0.055, 0.41, -0.01], [0.035, 0.045, 0.04], undefined, { k: 0.03 });
  s.ellipsoid([0.07, 0.31, -0.01], [0.06, 0.125, 0.08], undefined, { k: 0.005 });
  s.ellipsoid([0.055, 0.405, -0.012], [0.032, 0.042, 0.037], undefined, { k: 0.03 });
  s.ellipsoid([0, 0.125, 0.0], [0.17, 0.075, 0.12], undefined, { op: 'sub', k: 0.02 });
  s.ellipsoid([0, 0.3, 0.03], [0.026, 0.15, 0.06], undefined, { op: 'sub', k: 0.02 });
  s.ellipsoid([0.03, 0.27, 0.05], [0.045, 0.06, 0.045], undefined, { op: 'sub', k: 0.015 });
  const t = { k: 0.006 };
  s.chain([[0, 0.47, 0.02], [0, 0.4, 0.008], [0, 0.355, 0.0]], [0.009, 0.009, 0.0085], t);
  s.chain([[0, 0.355, 0], [0.04, 0.33, -0.008]], [0.0065, 0.0055], t);
  s.chain([[0, 0.355, 0], [-0.035, 0.335, -0.006]], [0.007, 0.006], t);
  return s;
}

function liverSDF(): SDF {
  const s = new SDF();
  s.ellipsoid([-0.05, 0.185, 0.02], [0.1, 0.06, 0.075], [0, 0, 12]);
  s.ellipsoidAlong([0.035, 0.2, 0.045], [0.055, 0.025, 0.045], [1, -0.25, 0], [0, 1, 0], { k: 0.025 });
  s.ellipsoid([0.0, 0.11, 0.03], [0.12, 0.05, 0.1], undefined, { op: 'sub', k: 0.02 });
  return s;
}

// ═══════════════════════════════ PESOS ═══════════════════════════════

/** Pesos por envolvente: cada bone pesa según su distancia a la superficie de sus primitivas. */
function computeWeights(mesh: MeshData, sdf: SDF, sigma: number, withFiber: boolean): SkinnedMeshData {
  const vc = mesh.positions.length / 3;
  const skinIndex = new Uint16Array(vc * 4);
  const skinWeight = new Float32Array(vc * 4);
  const fiber = withFiber ? new Float32Array(vc * 3) : undefined;
  const boneIdx = new Map<string, number>(BONE_NAMES.map((n, i) => [n, i]));
  const dist = new Map<string, number>();
  for (let v = 0; v < vc; v++) {
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
    sdf.boneDistances(x, y, z, dist);
    let dmin = Infinity;
    for (const d of dist.values()) dmin = Math.min(dmin, d);
    const cand: [number, number][] = [];
    for (const [bone, d] of dist) {
      const w = Math.exp(-(d - dmin) / sigma);
      if (w > 0.02) cand.push([boneIdx.get(bone) ?? 0, w]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    const top = cand.slice(0, 4);
    const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
    top.forEach(([bi, w], j) => {
      skinIndex[v * 4 + j] = bi;
      skinWeight[v * 4 + j] = w / sum;
    });
    if (fiber) fiber.set(sdf.nearestFiber(x, y, z), v * 3);
  }
  return { ...mesh, skinIndex, skinWeight, fiber };
}

type Progress = (f: number, label: string) => Promise<void>;

export async function buildHumanSoft(progress: Progress, quality = 1): Promise<{
  skin: SkinnedMeshData;
  muscle: SkinnedMeshData;
  organs: OrganPiece[];
}> {
  await progress(0, 'piel');
  const skinS = skinSDF();
  const skin = computeWeights(polySDF(skinS, 0.005 / quality, 42000, 0.01), skinS, 0.018, false);
  await progress(0.4, 'músculos');
  const musS = muscleSDF();
  const muscle = computeWeights(polySDF(musS, 0.005 / quality, 36000, 0.01), musS, 0.016, true);
  await progress(0.8, 'órganos');
  const ov = 0.0035 / quality;
  const organs: OrganPiece[] = [
    { name: 'heart', bone: 'Spine2', mesh: polySDF(heartSDF(), ov * 0.6, 9000), center: [0.022, 0.285, 0.04] },
    { name: 'lungs', bone: 'Spine2', mesh: polySDF(lungsSDF(), ov, 7000), center: [0, 0.31, 0] },
    { name: 'liver', bone: 'Spine1', mesh: polySDF(liverSDF(), ov, 3500), center: [-0.02, 0.18, 0.03] },
  ];
  await progress(1, 'tejidos');
  return { skin, muscle, organs };
}
