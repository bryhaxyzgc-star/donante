// Copia a public/ los binarios que el navegador necesita en tiempo de ejecución
// (wasm de MediaPipe y Rapier, decodificadores Draco/KTX2 de three).
// Se ejecuta en `postinstall`: la obra nunca pide nada a un CDN (regla §1.9).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const pub = join(root, 'public');

/** Copia un directorio o archivo; avisa si falta en vez de romper la instalación. */
function copy(from, to, label) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.warn(`[vendor] falta ${label}: ${src}`);
    return;
  }
  mkdirSync(dirname(join(pub, to)), { recursive: true });
  cpSync(src, join(pub, to), { recursive: true });
  console.log(`[vendor] ${label} → public/${to}`);
}

copy('@mediapipe/tasks-vision/wasm', 'mediapipe/wasm', 'MediaPipe wasm');

// Rapier compat trae el wasm embebido en el JS; copiamos igual el .wasm suelto
// para que quede disponible offline si se cambia al paquete no-compat.
const rapierDist = join(nm, '@dimforge/rapier3d-compat/dist');
if (existsSync(rapierDist)) {
  for (const f of readdirSync(rapierDist).filter((f) => f.endsWith('.wasm'))) {
    copy(`@dimforge/rapier3d-compat/dist/${f}`, `rapier/${f}`, `Rapier ${f}`);
  }
}

copy('three/examples/jsm/libs/draco/gltf', 'decoders/draco', 'Draco (glTF)');
copy('three/examples/jsm/libs/basis', 'decoders/basis', 'Basis/KTX2');
