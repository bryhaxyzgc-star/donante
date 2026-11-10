// Corre el pipeline de assets completo (§5, Fase 2):
//   01 importar BodyParts3D → 02 armadura y pesos → (Node) cerdo y pulmones procedurales →
//   03 cerdo en la armadura → 04 fractura de costillas → 05 corazón y vasos → 06 export GLB.
// Uso: npm run blender               (todo)
//      npm run blender -- --from 02  (retoma desde un paso: 01, 02, pig, 03, 04, 05, 06)
// Blender: variable BLENDER, o D:\tools\blender\blender-4.5.14-windows-x64\blender.exe, o `blender` del PATH.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.BLENDER,
  'D:\\tools\\blender\\blender-4.5.14-windows-x64\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
].filter(Boolean);
const blender = candidates.find((p) => existsSync(p)) ?? 'blender';

const steps = [
  ['01', [blender, '-b', '--factory-startup', '-P', 'blender/scripts/01_import_anatomy.py']],
  ['02', [blender, '-b', '--factory-startup', '-P', 'blender/scripts/02_rig_human.py']],
  ['pig', [process.execPath, '--no-warnings', 'scripts/build-pig.ts']],
  ['03', [blender, '-b', '--factory-startup', '-P', 'blender/scripts/03_rig_pig.py']],
  ['04', [blender, '-b', '--factory-startup', '-P', 'blender/scripts/04_fracture_ribs.py']],
  ['05', [blender, '-b', '--factory-startup', '-P', 'blender/scripts/05_heart_vessels.py']],
  ['06', [blender, '-b', '--factory-startup', '-P', 'blender/scripts/06_export_glb.py']],
];

const fromIdx = process.argv.indexOf('--from');
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : '01';
let start = steps.findIndex(([id]) => id === from);
if (start < 0) start = 0;

console.log(`[pipeline] Blender: ${blender}`);
for (const [id, [cmd, ...args]] of steps.slice(start)) {
  const t0 = Date.now();
  console.log(`\n[pipeline] ── paso ${id} ──`);
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  for (const line of out.split(/\r?\n/)) {
    if (/\[donante\]|\[cerdo\]|Traceback|Error|^\s+File /.test(line)) console.log(line.trim());
  }
  const failed = r.status !== 0 || /Traceback/.test(out);
  console.log(`[pipeline] paso ${id}: ${failed ? 'FALLÓ' : 'ok'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (failed) process.exit(1);
}
console.log('\n[pipeline] listo: public/models/{human,pig,heart}.glb + manifest.json');
