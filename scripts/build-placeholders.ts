// Precalcula las mallas anatómicas placeholder (SDF → Surface Nets → decimación)
// y las guarda en public/models/placeholder/. Se corre en postinstall o con
// `npm run placeholders`. Node ≥ 23.6 ejecuta TypeScript directamente.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlaceholderAssets } from '../src/anatomy/placeholder.ts';
import { ASSET_VERSION } from '../src/anatomy/assetFormat.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/models/placeholder');
const jsonPath = join(outDir, 'human.json');

const force = process.argv.includes('--force');
if (!force && existsSync(jsonPath)) {
  try {
    const cur = JSON.parse(readFileSync(jsonPath, 'utf8'));
    if (cur.version === ASSET_VERSION) {
      console.log('[placeholders] ya generados (usar --force para regenerar)');
      process.exit(0);
    }
  } catch {
    /* se regenera */
  }
}

const t0 = performance.now();
const { json, bin } = await buildPlaceholderAssets((f, label) => {
  process.stdout.write(`\r[placeholders] ${(f * 100).toFixed(0).padStart(3)}% ${label.padEnd(24)}`);
});
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'human.bin'), bin);
writeFileSync(jsonPath, JSON.stringify(json));
const tris = json.entries.reduce((a, e) => a + e.index.count / 3, 0);
console.log(`\n[placeholders] ${json.entries.length} piezas, ${Math.round(tris / 1000)}k triángulos, ${(bin.length / 1048576).toFixed(1)} MB, ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// Manifiesto de modelos: la Fase 2 reemplaza "placeholder" por los GLB de Blender.
const manifestPath = join(root, 'public/models/manifest.json');
if (!existsSync(manifestPath)) {
  writeFileSync(manifestPath, JSON.stringify({ human: { type: 'placeholder', path: 'models/placeholder/human' } }, null, 2));
}
