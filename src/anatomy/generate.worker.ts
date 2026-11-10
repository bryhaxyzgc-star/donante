// Respaldo: genera los placeholders anatómicos dentro del navegador si faltan los
// archivos precalculados. Mismo código que `npm run placeholders`.
import { buildPlaceholderAssets } from './placeholder.ts';

(async () => {
  const { json, bin } = await buildPlaceholderAssets((f, label) => {
    self.postMessage({ type: 'progress', f, label });
  });
  self.postMessage({ type: 'done', json, bin: bin.buffer }, { transfer: [bin.buffer] });
})();
