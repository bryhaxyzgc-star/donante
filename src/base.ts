// Rutas de los archivos de public/ según dónde se sirve la obra: en la laptop la base es "/" y en GitHub Pages
// es "/donante/" (vite.config.ts la toma de VITE_BASE). Nunca escribir "/carpeta/..." a mano.

/** `asset('models/pig.glb')` → "/models/pig.glb" o "/donante/models/pig.glb". */
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '');
}
