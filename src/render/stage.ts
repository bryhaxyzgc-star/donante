// Escenario: renderer WebGL2, escena, cámara calibrada, luces, postproceso,
// capa de máscara y captura en alta resolución (tecla P).
import { NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { config } from '../config.ts';
import { downloadBlob, timestampName } from '../persist.ts';
import type { QualityPreset } from '../quality.ts';
import { Blood } from './blood/blood.ts';
import { CameraShake, CinematicRig } from './cinematic.ts';
import { Lighting } from './lighting.ts';
import { Post } from './post.ts';
import { RedCheck } from './redCheck.ts';
import { Projection } from './projection.ts';
import { SoftTissue } from './softTissue.ts';

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(43, 16 / 9, 0.05, 40);
  readonly projection = new Projection();
  readonly post: Post;
  readonly lighting: Lighting;
  readonly softTissue: SoftTissue;
  readonly shake = new CameraShake();
  /** Rig de la cinemática (§12). `cinematic` lo enciende la extracción. */
  readonly rig = new CinematicRig();
  cinematic = false;
  private onShot = false;
  readonly blood: Blood;
  /** Prueba automática de píxeles rojos (§18). */
  readonly redCheck = new RedCheck();
  quality: QualityPreset;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, quality: QualityPreset) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.info.autoReset = false;
    this.scene.background = null;
    this.lighting = new Lighting(this.renderer, this.scene);
    this.softTissue = new SoftTissue(null);
    this.scene.add(this.softTissue.mesh);
    this.scene.add(this.camera);
    this.blood = new Blood(this.renderer, this.scene, this.camera, this.lighting, quality);
    this.blood.puddle.excluded.push(this.softTissue.mesh);
    this.post = new Post(this.renderer, this.scene, this.camera, this.blood);
    this.applyQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyQuality(q: QualityPreset): void {
    this.quality = q;
    this.blood?.applyQuality(q);
    this.post.applyQuality(q);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(2, window.devicePixelRatio || 1) * this.quality.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // El composer recibe el tamaño lógico y aplica el pixel ratio del renderer.
    this.post.setSize(w, h, Math.round(w * pr), Math.round(h * pr));
    this.updateProjection();
  }

  /** Recalcula cámara y mapeos tras cambiar video, FOV o calibración. */
  updateProjection(): void {
    // En medio de un plano de cinemática el rig vuelve a poner su cámara en el próximo render.
    this.projection.update(this.camera, window.innerWidth, window.innerHeight);
  }

  /** Espejo por CSS: no cuesta nada y no afecta el texto de los overlays. */
  applyMirror(): void {
    this.canvas.style.transform = config.mirror ? 'scaleX(-1)' : 'none';
  }

  render(dt: number): void {
    this.renderer.info.reset();
    this.post.sync(this.renderer, dt);
    this.lighting.sync(this.scene);
    this.shake.update(dt, window.innerHeight);
    this.blood.update(dt, window.innerWidth / Math.max(1, window.innerHeight));
    // Cinemática: la cámara del plano reemplaza a la de la webcam; al volver, la calibración exacta.
    const shot = this.cinematic && this.rig.shot !== null;
    if (shot) {
      this.rig.apply(this.camera, window.innerWidth, window.innerHeight);
    } else if (this.onShot) {
      CinematicRig.restore(this.camera);
      this.updateProjection();
    }
    this.onShot = shot;
    // La máscara de la webcam solo tiene sentido con la cámara de la webcam.
    this.softTissue.mesh.visible = !shot;
    this.post.setDof(shot && this.quality.dof, this.rig.focus, this.rig.focusRange);
    this.post.cinematic = shot;
    const shaking = this.shake.active;
    if (shaking) this.shake.apply(this.camera, 1);
    this.post.render(dt);
    if (shaking) this.shake.apply(this.camera, -1);
    this.redCheck.run(this.renderer);
  }

  /** Captura PNG a `config.capture.scale`× la resolución actual, tal como se ve en la pared. */
  async capture(dt: number): Promise<void> {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.max(1, config.capture.scale);
    const prevPR = this.renderer.getPixelRatio();
    const W = Math.round(w * s);
    const H = Math.round(h * s);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.post.setSize(W, H, W, H);
    this.post.render(dt);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;
    if (config.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.canvas, 0, 0);
    this.renderer.setPixelRatio(prevPR);
    this.resize();
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    if (blob) downloadBlob(blob, timestampName('donante', 'png'));
    console.info(`[captura] ${W}×${H}`);
  }
}
