// Modo debug (tecla D, §16): landmarks, armaduras, IDs, roles, FPS, estado y
// datos del render. Solo para el operador; el público nunca lo ve.
import Stats from 'stats.js';
import type { WebGLRenderer } from 'three';
import { config } from './config.ts';
import { LM_CONNECTIONS, LM_STRIDE, NUM_LM } from './input/poseTypes.ts';
import type { Person } from './input/people.ts';
import type { PoseEngine } from './input/pose.ts';
import type { BodyRig } from './render/body.ts';
import type { Projection } from './render/projection.ts';

export interface DebugInfo {
  state: string;
  preset: string;
  gpu: string;
  source: string;
  camera: string;
  assets: string;
  pose: PoseEngine;
  renderer: WebGLRenderer;
  audio: string;
  roleOf?: (personId: number) => string;
  /** Último resultado de la prueba de píxeles rojos (texto). */
  erase?: string;
}

const COLORS = ['#7fd4ff', '#ffd27f', '#b6ff7f'];

export class Debug {
  visible = false;
  private hud: HTMLPreElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stats = new Stats();
  private fps = 60;
  private frameMs = 16;

  constructor() {
    this.hud = document.createElement('pre');
    this.hud.className = 'debug-hud';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'debug-overlay';
    this.ctx = this.overlay.getContext('2d')!;
    this.stats.dom.classList.add('debug-stats');
    this.stats.dom.style.cssText = '';
    document.body.append(this.overlay, this.hud, this.stats.dom);
    this.setVisible(false);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    const pr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(window.innerWidth * pr);
    this.overlay.height = Math.round(window.innerHeight * pr);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.hud.style.display = v ? 'block' : 'none';
    this.overlay.style.display = v ? 'block' : 'none';
    this.stats.dom.style.display = v ? 'block' : 'none';
  }

  toggle(bodies: BodyRig[]): void {
    this.setVisible(!this.visible);
    for (const b of bodies) b.helper.visible = this.visible && config.debug.armature;
  }

  begin(): void {
    this.stats.begin();
  }

  end(dtReal: number, bodies: BodyRig[]): void {
    this.stats.end();
    if (dtReal > 0) {
      this.fps += (1 / dtReal - this.fps) * 0.05;
      this.frameMs += (dtReal * 1000 - this.frameMs) * 0.05;
    }
    for (const b of bodies) b.helper.visible = this.visible && config.debug.armature && b.root.visible;
  }

  update(info: DebugInfo, people: Person[], bodies: BodyRig[], proj: Projection): void {
    if (!this.visible) return;
    const r = info.renderer.info;
    const lines = [
      `DONANTE · debug (D)    estado: ${info.state}`,
      `FPS ${this.fps.toFixed(1)}  (${this.frameMs.toFixed(1)} ms)   preset ${info.preset}`,
      `GPU ${info.gpu}`,
      `fuente ${info.source} · ${info.camera}`,
      `pose ${info.pose.model ?? '—'}/${info.pose.delegate}  ${info.pose.rate.toFixed(1)} Hz  infer ${info.pose.inferMs.toFixed(1)} ms`,
      `render ${r.render.calls} draws · ${(r.render.triangles / 1000).toFixed(0)}k tris · geo ${r.memory.geometries} · tex ${r.memory.textures}`,
      `anatomía ${info.assets} · audio ${info.audio}`,
      `borrado ${info.erase ?? '—'}`,
      `personas ${people.length}`,
    ];
    for (const p of people) {
      const body = bodies.find((b) => b.personId === p.id);
      lines.push(
        `  #${p.id} ${p.state.padEnd(7)} pres ${p.presence.toFixed(2)} estable ${p.stableTime.toFixed(1)}s` +
          ` máscara ${(p.maskArea * 100).toFixed(1)}%` +
          (body ? ` prof ${body.retarget.debugDepth.toFixed(2)} m esc ${body.retarget.debugScale.toFixed(2)}` : '') +
          `  rol ${info.roleOf?.(p.id) ?? '—'}`,
      );
    }
    lines.push('', 'F pantalla · G ajustes · C calibrar · Q calidad · M silencio · P captura',
      '1–6 estados · X cinemática · S modo solo · Mayús+R reiniciar contador');
    this.hud.textContent = lines.join('\n');

    const ctx = this.ctx;
    const pr = window.devicePixelRatio || 1;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!config.debug.landmarks) return;
    people.forEach((p, idx) => {
      const col = COLORS[idx % COLORS.length];
      const pts: [number, number][] = [];
      for (let i = 0; i < NUM_LM; i++) pts.push(proj.videoToScreen(p.lm2d[i * LM_STRIDE], p.lm2d[i * LM_STRIDE + 1]));
      ctx.globalAlpha = 0.85 * p.presence;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      for (const [a, b] of LM_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(pts[a][0], pts[a][1]);
        ctx.lineTo(pts[b][0], pts[b][1]);
        ctx.stroke();
      }
      for (let i = 0; i < NUM_LM; i++) {
        const vis = p.lm2d[i * LM_STRIDE + 3];
        ctx.fillStyle = vis > config.retarget.minVisibility ? col : '#ff5050';
        ctx.fillRect(pts[i][0] - 2, pts[i][1] - 2, 4, 4);
      }
      const [hx, hy] = proj.videoToScreen(p.hipX, p.hipY);
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillStyle = col;
      ctx.fillText(`#${p.id}`, hx + 8, hy);
    });
    ctx.globalAlpha = 1;
  }
}
