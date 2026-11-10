// Descarga UNA sola vez (en la instalación) los archivos que no vienen en npm:
// modelos de pose de MediaPipe y la tipografía IBM Plex Mono (OFL).
// Después de esto la obra corre sin red (regla §1.9).
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

const MP = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const FONT = 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.2.5/files';

const files = [
  [`${MP}/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`, 'mediapipe/models/pose_landmarker_heavy.task'],
  [`${MP}/pose_landmarker_full/float16/latest/pose_landmarker_full.task`, 'mediapipe/models/pose_landmarker_full.task'],
  [`${FONT}/ibm-plex-mono-latin-400-normal.woff2`, 'fonts/ibm-plex-mono-400.woff2'],
  [`${FONT}/ibm-plex-mono-latin-500-normal.woff2`, 'fonts/ibm-plex-mono-500.woff2'],
];

let failed = 0;
for (const [url, rel] of files) {
  const dest = join(pub, rel);
  if (existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`[assets] ya existe public/${rel}`);
    continue;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    console.log(`[assets] ${rel} (${(buf.length / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    failed++;
    console.warn(`[assets] no se pudo bajar ${url}: ${err.message}`);
  }
}
if (failed) {
  console.warn(`[assets] ${failed} archivo(s) faltan. Reintentar con: npm run assets`);
}
