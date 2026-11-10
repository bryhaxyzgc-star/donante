// Paso Node del pipeline de Blender: genera el esqueleto de cerdo procedural y los pulmones
// ajustados a las articulaciones reales del humano (work/human_joints.json, escrito por 02)
// y los guarda como OBJ en coordenadas de Blender (Z arriba, frente -Y) para 03_rig_pig.py.
//   node scripts/build-pig.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPigSkeleton, type HumanJoints } from '../src/anatomy/pigSkeleton.ts';
import { lungsSDF } from '../src/anatomy/humanSoft.ts';
import { polySDF } from '../src/anatomy/humanSkeleton.ts';
import { mergeMeshes, transformMesh, type MeshData } from '../src/anatomy/polygonize.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'blender/source/work');
const out = join(work, 'procedural');
mkdirSync(out, { recursive: true });

const J = JSON.parse(readFileSync(join(work, 'human_joints.json'), 'utf8')) as HumanJoints & {
  chestTop: number;
  chestBottom: number;
};

/** OBJ en coordenadas de Blender: glTF (x, y, z) → Blender (x, -z, y). */
function writeOBJ(file: string, m: MeshData): void {
  const L: string[] = [];
  const p = m.positions;
  const n = m.normals;
  for (let i = 0; i < p.length; i += 3) L.push(`v ${p[i].toFixed(5)} ${(-p[i + 2]).toFixed(5)} ${p[i + 1].toFixed(5)}`);
  for (let i = 0; i < n.length; i += 3) L.push(`vn ${n[i].toFixed(4)} ${(-n[i + 2]).toFixed(4)} ${n[i + 1].toFixed(4)}`);
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] + 1, b = m.indices[t + 1] + 1, c = m.indices[t + 2] + 1;
    L.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  writeFileSync(join(out, file), L.join('\n'));
}

const t0 = performance.now();
const { pieces, ribs } = await buildPigSkeleton(J, (f, l) => {
  process.stdout.write(`\r[cerdo] ${(f * 100).toFixed(0).padStart(3)}% ${l.padEnd(24)}`);
});
const groups = new Map<string, MeshData[]>();
for (const p of pieces) {
  const key = `${p.slot}|${p.bone}|${p.material}`;
  groups.set(key, [...(groups.get(key) ?? []), p.mesh]);
}
const manifest: { file: string; slot: string; bone: string; material: string; kind: string; rib?: number; side?: string }[] = [];
let tris = 0;
for (const [key, list] of groups) {
  const [slot, bone, material] = key.split('|');
  const m = mergeMeshes(list);
  const file = `pig_${slot}_${bone}_${material}.obj`;
  writeOBJ(file, m);
  tris += m.indices.length / 3;
  manifest.push({ file, slot, bone, material, kind: 'bone' });
}
for (const r of ribs) {
  const file = `pig_rib_${r.side}_${String(r.index).padStart(2, '0')}.obj`;
  writeOBJ(file, r.mesh);
  manifest.push({ file, slot: 'ribs', bone: 'Spine2', material: 'bone', kind: 'rib', rib: r.index, side: r.side });
}

// Pulmones: el SDF del placeholder se ajusta por afinidad a la caja del tórax real.
const lungs = polySDF(lungsSDF(), 0.0035, 7000);
const ph = { half: 0.134, top: 0.44, bottom: 0.15, zc: 0.0 };
const spineMid = J.spine[13];
const sternumZ = (J.sternumTop[2] + J.sternumBottom[2]) / 2;
const zc = (spineMid[2] + sternumZ) / 2;
const sx = J.chestHalfWidth / ph.half;
const sy = (J.chestTop - J.chestBottom) / (ph.top - ph.bottom);
const sz = J.chestDepth / 0.19;
const mat = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, J.chestBottom - ph.bottom * sy, zc - ph.zc * sz, 1];
writeOBJ('lungs.obj', transformMesh(lungs, mat));
manifest.push({ file: 'lungs.obj', slot: 'lungs', bone: 'Spine2', material: 'organ', kind: 'organ' });

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\n[cerdo] ${groups.size} piezas (${Math.round(tris / 1000)}k tris) + ${ribs.length} costillas sueltas + pulmones, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
