// Contador de donantes (§16): empieza en 347, persiste en localStorage, se exporta a JSON.
// El reinicio (Shift+R) pide confirmación por consola: hay que repetir la tecla en 3 s.
import { downloadBlob, loadJSON, saveJSON, timestampName } from './persist.ts';

const KEY = 'donante.counter.v1';
const START = 347;

interface CounterData {
  value: number;
  history: { n: number; at: string; solo: boolean }[];
}

export class Counter {
  private data: CounterData;
  private resetArmedUntil = 0;

  constructor() {
    const saved = loadJSON(KEY) as CounterData | null;
    this.data = saved && typeof saved.value === 'number' ? { value: saved.value, history: saved.history ?? [] } : { value: START, history: [] };
  }

  get value(): number {
    return this.data.value;
  }

  /** Número del próximo donante (el que se asigna en ASIGNACIÓN). */
  get next(): number {
    return this.data.value + 1;
  }

  increment(solo: boolean): number {
    this.data.value++;
    this.data.history.push({ n: this.data.value, at: new Date().toISOString(), solo });
    saveJSON(KEY, this.data);
    console.info(`[contador] DONANTES: ${format(this.data.value)}`);
    return this.data.value;
  }

  /** Primera llamada: arma el reinicio; segunda dentro de 3 s: reinicia. Sin alert()/confirm(). */
  requestReset(nowMs: number): void {
    if (nowMs < this.resetArmedUntil) {
      this.data = { value: START, history: [] };
      saveJSON(KEY, this.data);
      this.resetArmedUntil = 0;
      console.warn(`[contador] REINICIADO a ${format(START)}`);
      return;
    }
    this.resetArmedUntil = nowMs + 3000;
    console.warn(`[contador] ¿Reiniciar a ${format(START)}? Pulsar Shift+R otra vez en 3 s para confirmar.`);
  }

  export(): void {
    downloadBlob(new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' }), timestampName('donante_contador', 'json'));
  }
}

export function format(n: number): string {
  return String(n).padStart(4, '0');
}
