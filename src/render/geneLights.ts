// Edición genética visible dentro del corazón del donante (§9.4 A, §1.4):
//  - 4 puntos de luz fríos (genes porcinos GGTA1, CMAH, B4GALNT2, GHR) que se apagan.
//  - 6 partículas blanco cálido (CD46, CD55, THBD, EPCR, CD47, HO-1) que entran al corazón y se quedan.
// Van dentro del grupo que late, así que laten con él, se congelan con él y viajan con él.
import {
  AdditiveBlending, CanvasTexture, Color, Group, QuadraticBezierCurve3, Sprite, SpriteMaterial, Vector3, type Object3D,
} from 'three';
import { config } from '../config.ts';
import { rng } from '../random.ts';

const PORCINE = 4;
const HUMAN = 6;

interface Light {
  sprite: Sprite;
  mat: SpriteMaterial;
  /** Posición final dentro del corazón (espacio local). */
  home: Vector3;
  /** 0 apagado … 1 encendido. */
  level: number;
  target: number;
  /** Destello al apagarse o al llegar (decae). */
  flare: number;
  /** Viaje de entrada (solo humanos): 0..1, o -1 si no viaja. */
  travel: number;
  curve: QuadraticBezierCurve3 | null;
  twinkle: number;
}

let glowTexture: CanvasTexture | null = null;
/** Punto de luz como lo ve una cámara: núcleo chico y cuatro rayos finos. Sobre el hueso blanco
 *  el núcleo se pierde, pero los rayos cruzan a los espacios oscuros entre costillas y se leen. */
function glow(): CanvasTexture {
  if (glowTexture) return glowTexture;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.16);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, S, S);
  for (const vertical of [false, true]) {
    const ray = vertical ? g.createLinearGradient(0, 0, 0, S) : g.createLinearGradient(0, 0, S, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    if (vertical) g.fillRect(S / 2 - 1, 0, 2, S);
    else g.fillRect(0, S / 2 - 1, S, 2);
  }
  glowTexture = new CanvasTexture(c);
  return glowTexture;
}

const tmp = new Vector3();

export class GeneLights {
  readonly group = new Group();
  private porcine: Light[] = [];
  private human: Light[] = [];
  private visible = 0;
  private targetVisible = 0;
  /** Corazón de carne en pantalla (opaco): las luces quedan adentro, no se ven. */
  suppressed = false;
  /** Escala del tamaño (más chicas en los primeros planos de la cinemática). */
  sizeScale = 1;

  constructor() {
    this.group.name = 'ediciones_geneticas';
    const rnd = rng(348);
    const make = (warm: boolean): Light => {
      const mat = new SpriteMaterial({
        map: glow(), color: new Color(warm ? config.transform.geneWarm : config.transform.geneCool),
        blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, opacity: 0,
      });
      const sprite = new Sprite(mat);
      sprite.renderOrder = 12;
      sprite.visible = false;
      this.group.add(sprite);
      // Dentro del miocardio, en la mitad izquierda (+X del modelo): detrás del esternón el
      // hueso satura en blanco y la luz no se vería; entre las costillas, sí.
      const home = new Vector3(0.06 + (rnd() - 0.5) * 0.035, (rnd() - 0.5) * 0.06 - 0.01, 0.01 + (rnd() - 0.5) * 0.03);
      return { sprite, mat, home, level: 0, target: 0, flare: 0, travel: -1, curve: null, twinkle: rnd() * 10 };
    };
    for (let i = 0; i < PORCINE; i++) this.porcine.push(make(false));
    for (let i = 0; i < HUMAN; i++) this.human.push(make(true));
  }

  /** Cuelga las luces del corazón (o las saca de escena con null). */
  attach(parent: Object3D | null): void {
    if (parent) parent.add(this.group);
    else this.group.removeFromParent();
  }

  /** Estado inicial: los 4 genes porcinos encendidos, ninguno humano. */
  reset(): void {
    for (const l of this.porcine) Object.assign(l, { level: 0, target: 1, flare: 0, travel: -1 });
    for (const l of this.human) Object.assign(l, { level: 0, target: 0, flare: 0, travel: -1 });
    this.targetVisible = 1;
  }

  /** Estado final (saltos con teclas): porcinos apagados, humanos adentro. */
  final(): void {
    for (const l of this.porcine) Object.assign(l, { level: 0, target: 0, flare: 0, travel: -1 });
    for (const l of this.human) Object.assign(l, { level: 1, target: 1, flare: 0, travel: -1 });
    this.visible = this.targetVisible = 1;
  }

  hide(): void {
    this.targetVisible = 0;
  }

  /** "─ eliminado": un punto de luz se apaga (con un último destello). */
  kill(i: number): void {
    const l = this.porcine[i];
    if (!l) return;
    l.flare = 1;
    l.target = 0;
  }

  /** "+ insertado · humano": entra desde `fromWorld` y se queda. */
  insert(i: number, fromWorld: Vector3): void {
    const l = this.human[i];
    if (!l || !this.group.parent) return;
    this.group.updateWorldMatrix(true, false);
    const start = this.group.worldToLocal(tmp.copy(fromWorld)).clone();
    const ctrl = start.clone().lerp(l.home, 0.5);
    ctrl.y += start.distanceTo(l.home) * 0.35;
    l.curve = new QuadraticBezierCurve3(start, ctrl, l.home.clone());
    l.travel = 0;
    l.target = 1;
    l.level = 1;
  }

  update(dt: number): void {
    const T = config.transform;
    const want = this.suppressed ? 0 : this.targetVisible;
    this.visible += (want - this.visible) * (1 - Math.exp(-(this.suppressed ? 20 : 5) * dt));
    this.group.visible = this.visible > 0.01;
    if (!this.group.visible) return;
    for (let k = 0; k < PORCINE + HUMAN; k++) {
      const warm = k >= PORCINE;
      const l = warm ? this.human[k - PORCINE] : this.porcine[k];
      // HDR: por encima de 1 el bloom los hace destellar sobre el corazón.
      l.mat.color.set(warm ? T.geneWarm : T.geneCool).multiplyScalar(T.geneIntensity);
      l.flare = Math.max(0, l.flare - dt * 3.2);
      if (l.travel >= 0 && l.curve) {
        l.travel = Math.min(1, l.travel + dt / T.geneTravel);
        const e = l.travel * l.travel * (3 - 2 * l.travel);
        l.curve.getPoint(e, l.sprite.position);
        if (l.travel >= 1) {
          l.travel = -1;
          l.flare = 1;
          l.sprite.position.copy(l.home);
        }
      } else {
        l.sprite.position.copy(l.home);
        l.level += (l.target - l.level) * (1 - Math.exp(-(l.target > l.level ? 4 : 9) * dt));
      }
      l.twinkle += dt * (warm ? 2.1 : 3.3);
      const tw = 0.85 + 0.15 * Math.sin(l.twinkle);
      // Al apagarse, el destello se ve aunque el nivel ya bajó.
      const a = Math.min(1, (l.level * tw + l.flare * 0.9) * this.visible);
      l.sprite.visible = a > 0.005;
      l.mat.opacity = a;
      const size = T.geneSize * this.sizeScale * (1 + l.flare * 1.4) * (warm ? 0.9 : 1);
      l.sprite.scale.setScalar(size);
      l.mat.rotation = 0.35 * Math.sin(l.twinkle * 0.4);
    }
  }
}
