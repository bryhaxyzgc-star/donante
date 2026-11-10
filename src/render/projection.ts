// Modelo de cámara compartido por el render 3D, la máscara y el debug.
// La cámara 3D replica la webcam (pinhole, mismo FOV) y la imagen se ajusta al
// canvas en modo "cover". La calibración (tecla C) desplaza y escala la vista
// completa con setViewOffset, así 3D, máscara y overlay siguen alineados.
import type { PerspectiveCamera, Vector3 } from 'three';
import { config } from '../config.ts';

export class Projection {
  videoW = 1280;
  videoH = 720;
  canvasW = 1920;
  canvasH = 1080;
  /** tan(FOV/2) de la webcam. */
  tanV = 0.4;
  tanH = 0.7;
  /** tan(FOV/2) de lo visible en el canvas sin calibrar (recorte cover). */
  visTanV = 0.4;
  visTanH = 0.7;
  /** Ventana de vista (fracciones del canvas) tras la calibración. */
  viewX = 0;
  viewY = 0;
  viewW = 1;
  viewH = 1;

  setVideo(w: number, h: number): void {
    if (w > 0 && h > 0) {
      this.videoW = w;
      this.videoH = h;
    }
  }

  /** Recalcula todo y configura la cámara 3D. Llamar en resize y al calibrar. */
  update(camera: PerspectiveCamera, canvasW: number, canvasH: number): void {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    const av = this.videoW / this.videoH;
    const ac = canvasW / canvasH;
    this.tanV = Math.tan((config.camera.vfovDeg * Math.PI) / 360);
    this.tanH = this.tanV * av;
    if (ac >= av) {
      this.visTanH = this.tanH;
      this.visTanV = this.tanH / ac;
    } else {
      this.visTanV = this.tanV;
      this.visTanH = this.tanV * ac;
    }
    const c = config.calib;
    const zoom = Math.max(0.2, c.zoom);
    this.viewW = 1 / zoom;
    this.viewH = 1 / zoom;
    // offsetX positivo = la imagen se mueve a la derecha en la PARED (con espejo se invierte).
    const ox = config.mirror ? -c.offsetX : c.offsetX;
    this.viewX = (1 - this.viewW) / 2 - ox * this.viewW;
    this.viewY = (1 - this.viewH) / 2 + c.offsetY * this.viewH;

    camera.fov = (2 * Math.atan(this.visTanV) * 180) / Math.PI;
    camera.aspect = ac;
    camera.near = config.camera.near;
    camera.far = config.camera.far;
    camera.setViewOffset(
      canvasW, canvasH,
      this.viewX * canvasW, this.viewY * canvasH,
      this.viewW * canvasW, this.viewH * canvasH,
    );
    camera.updateProjectionMatrix();
  }

  /** Punto de imagen (u,v normalizados, v hacia abajo) a profundidad `depth` → espacio de cámara. */
  unproject(u: number, v: number, depth: number, out: Vector3): Vector3 {
    return out.set((2 * u - 1) * this.tanH * depth, -(2 * v - 1) * this.tanV * depth, -depth);
  }

  /** Distancia focal en píxeles del video. */
  get focalPx(): number {
    return this.videoH / 2 / this.tanV;
  }

  /** u,v de video → píxel del canvas tal como se ve en la pared (con espejo). */
  videoToScreen(u: number, v: number): [number, number] {
    const fx = 0.5 + (u - 0.5) * (this.tanH / this.visTanH);
    const fy = 0.5 + (v - 0.5) * (this.tanV / this.visTanV);
    let x = ((fx - this.viewX) / this.viewW) * this.canvasW;
    const y = ((fy - this.viewY) / this.viewH) * this.canvasH;
    if (config.mirror) x = this.canvasW - x;
    return [x, y];
  }

  /** Uniform para shaders de pantalla: uv del canvas → uv de video (sin espejo; el CSS lo aplica). */
  maskTransform(out: { x: number; y: number; z: number; w: number }): void {
    // video.u = a + uv.x * b ;  video.v(top-down) = c + (1-uv.y) * d
    const kx = this.visTanH / this.tanH;
    const ky = this.visTanV / this.tanV;
    out.x = 0.5 + (this.viewX - 0.5) * kx;
    out.y = this.viewW * kx;
    out.z = 0.5 + (this.viewY - 0.5) * ky;
    out.w = this.viewH * ky;
  }
}
