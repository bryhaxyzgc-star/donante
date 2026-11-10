import { defineConfig } from 'vite';

export default defineConfig({
  // "/" en la laptop; "/donante/" al publicar en GitHub Pages (lo fija el flujo de .github/workflows/pages.yml).
  base: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VITE_BASE ?? '/',
  server: { port: 5173 },
  preview: { port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
});
