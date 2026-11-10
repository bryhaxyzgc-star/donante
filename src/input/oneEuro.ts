// Filtro One Euro (Casiez, Roussel, Vogel 2012) vectorizado: N valores que comparten
// el mismo timestamp. Quita el temblor en reposo sin agregar latencia al moverse.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroArray {
  readonly n: number;
  private x: Float32Array;
  private dx: Float32Array;
  private lastT = -1;
  minCutoff: number;
  beta: number;
  dCutoff: number;

  constructor(n: number, minCutoff: number, beta: number, dCutoff = 1) {
    this.n = n;
    this.x = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.lastT = -1;
  }

  /** Filtra `src` en el instante `t` (segundos) y escribe en `out` (puede ser el mismo arreglo).
   *  `stride`/`count` permiten filtrar solo algunas componentes de un arreglo intercalado. */
  filter(src: Float32Array, t: number, out: Float32Array, stride = 1, count = 1): void {
    const per = count;
    const n = this.n;
    if (this.lastT < 0) {
      for (let i = 0; i < n; i++) {
        const j = Math.floor(i / per) * stride + (i % per);
        this.x[i] = src[j];
        this.dx[i] = 0;
        out[j] = src[j];
      }
      this.lastT = t;
      return;
    }
    const dt = Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const ad = alpha(this.dCutoff, dt);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(i / per) * stride + (i % per);
      const v = src[j];
      const d = (v - this.x[i]) / dt;
      const dHat = this.dx[i] + ad * (d - this.dx[i]);
      this.dx[i] = dHat;
      const cutoff = this.minCutoff + this.beta * Math.abs(dHat);
      const a = alpha(cutoff, dt);
      const xHat = this.x[i] + a * (v - this.x[i]);
      this.x[i] = xHat;
      out[j] = xHat;
    }
  }
}
