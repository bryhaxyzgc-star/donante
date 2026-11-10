// Regla §1.9-10: la obra no habla con nadie fuera de la laptop. MediaPipe 1.x trae
// telemetría propia (POST a odml.pa.googleapis.com cada 60 s); este guardia hace que
// cualquier fetch a otro origen falle localmente, en el hilo principal y en los workers.

export function installOfflineGuard(scope: typeof globalThis = globalThis): void {
  const original = scope.fetch.bind(scope);
  const origin = scope.location.origin;
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, scope.location.href);
    if (url.origin !== origin) {
      console.warn(`[offline] bloqueado: ${url.host}`);
      return Promise.reject(new TypeError(`offline: ${url.host} bloqueado`));
    }
    return original(input, init);
  }) as typeof fetch;
}
