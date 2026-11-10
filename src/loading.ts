// Pantalla negra de precarga (§15): "CARGANDO… NN %". Nada de UI de videojuego.

export class LoadingScreen {
  private el: HTMLDivElement;
  private label: HTMLDivElement;
  private detail: HTMLDivElement;
  private parts = new Map<string, { w: number; f: number }>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.label = document.createElement('div');
    this.label.className = 'loading-label';
    this.detail = document.createElement('div');
    this.detail.className = 'loading-detail';
    this.el.append(this.label, this.detail);
    document.body.appendChild(this.el);
    this.render();
  }

  /** Registra una tarea con su peso relativo. */
  task(name: string, weight: number): (f: number, detail?: string) => void {
    this.parts.set(name, { w: weight, f: 0 });
    return (f: number, detail?: string) => {
      const p = this.parts.get(name);
      if (p) p.f = Math.min(1, Math.max(p.f, f));
      if (detail) this.detail.textContent = detail;
      this.render();
    };
  }

  private render(): void {
    let w = 0;
    let done = 0;
    for (const p of this.parts.values()) {
      w += p.w;
      done += p.w * p.f;
    }
    const pct = w ? Math.floor((done / w) * 100) : 0;
    this.label.textContent = `CARGANDO… ${String(pct).padStart(2, '0')} %`;
  }

  error(msg: string): void {
    this.label.textContent = 'ERROR';
    this.detail.textContent = msg;
  }

  hide(): void {
    this.el.classList.add('done');
    setTimeout(() => this.el.remove(), 1200);
  }
}
