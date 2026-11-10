// Dos relojes (§8): el de juego, con timeScale para hit-stop y cámara lenta, y el
// real, que gobierna el latido y la interfaz.

export class Clocks {
  /** Escala de tiempo del juego (0 = hit-stop, 0,25 = cámara lenta). */
  timeScale = 1;
  realTime = 0;
  gameTime = 0;
  dtReal = 0;
  dtGame = 0;
  private hitStopUntil = 0;
  private last = performance.now();

  tick(now: number): void {
    this.dtReal = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realTime += this.dtReal;
    const stopped = this.realTime < this.hitStopUntil;
    this.dtGame = stopped ? 0 : this.dtReal * this.timeScale;
    this.gameTime += this.dtGame;
  }

  /** Congela el reloj de juego durante `ms` milisegundos reales. */
  hitStop(ms: number): void {
    this.hitStopUntil = Math.max(this.hitStopUntil, this.realTime + ms / 1000);
  }
}
