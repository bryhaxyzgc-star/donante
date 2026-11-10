// Corazón de carne de la cinemática (§10.6): la carne húmeda de flesh.ts con el uniform
// `bloodAmount` (1 = ensangrentado y brillante, 0 = limpio y pálido) y vasitos coronarios más finos.
import { createFleshMaterial, setFleshBlood, type FleshMaterial } from './flesh.ts';

export function createHeartMaterial(): FleshMaterial {
  const m = createFleshMaterial();
  m.name = 'corazon';
  m.userData.uniforms.uScale.value = 190;
  m.sheen = 0.5;
  return m;
}

export function setHeartBlood(m: FleshMaterial, bloodAmount: number): void {
  setFleshBlood(m, bloodAmount);
}
