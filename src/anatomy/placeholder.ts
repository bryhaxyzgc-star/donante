// Genera el conjunto completo de mallas placeholder (esqueleto, piel, músculo, órganos)
// y lo empaqueta. Lo usan el script de instalación (Node) y, como respaldo, un worker.
import { AssetWriter, type AssetFile } from './assetFormat.ts';
import { buildHumanSkeleton } from './humanSkeleton.ts';
import { buildHumanSoft } from './humanSoft.ts';
import { mergeMeshes } from './polygonize.ts';

type Progress = (f: number, label: string) => Promise<void> | void;

export async function buildPlaceholderAssets(progress: Progress): Promise<{ json: AssetFile; bin: Uint8Array }> {
  const w = new AssetWriter();
  const pieces = await buildHumanSkeleton(async (f, l) => {
    await progress(f * 0.5, l);
  });
  // Una pieza por (slot, bone, material): menos draw calls, mismo control por hueso.
  const groups = new Map<string, typeof pieces>();
  for (const p of pieces) {
    const key = `${p.slot}|${p.bone}|${p.material}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const [key, list] of groups) {
    const [slot, bone, material] = key.split('|');
    const m = mergeMeshes(list.map((p) => p.mesh));
    w.add({ kind: 'bone', name: `${slot}_human`, slot, bone, material }, { position: [m.positions, 3], normal: [m.normals, 3] }, m.indices);
  }
  const soft = await buildHumanSoft(async (f, l) => {
    await progress(0.5 + f * 0.5, l);
  });
  for (const [kind, m] of [['skin', soft.skin], ['muscle', soft.muscle]] as const) {
    const attrs: Record<string, [Float32Array | Uint16Array, number]> = {
      position: [m.positions, 3],
      normal: [m.normals, 3],
      skinIndex: [m.skinIndex, 4],
      skinWeight: [m.skinWeight, 4],
    };
    if (m.fiber) attrs.fiber = [m.fiber, 3];
    w.add({ kind, name: kind }, attrs, m.indices);
  }
  for (const o of soft.organs) {
    w.add({ kind: 'organ', name: o.name, bone: o.bone, center: o.center }, { position: [o.mesh.positions, 3], normal: [o.mesh.normals, 3] }, o.mesh.indices);
  }
  await progress(1, 'listo');
  return w.finish('placeholder-sdf');
}
