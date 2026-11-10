// Fondo + "tejido blando" difuso a partir de la máscara de segmentación (§6): el
// contorno real del visitante también se intuye detrás del cuerpo 3D.
// Detrás de todo, la cámara difuminada: la webcam reducida y desenfocada en un canvas, en gris frío.
// En calibración (tecla C) mezcla la imagen de la webcam para alinear la proyección.
import {
  CanvasTexture, Color, DataTexture, LinearFilter, Mesh, PlaneGeometry, RedFormat, ShaderMaterial, SRGBColorSpace,
  Texture, UnsignedByteType, Vector2, Vector4, VideoTexture,
} from 'three';
import { config } from '../config.ts';
import type { PoseFrame } from '../input/poseTypes.ts';
import type { Projection } from './projection.ts';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform sampler2D uVideo;
uniform vec4 uT;
uniform vec2 uTexel;
uniform vec3 uBg;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uEdge;
uniform float uBlur;
uniform float uStrength;
uniform float uVideoMix;
uniform sampler2D uCam;
uniform float uCamMix;
uniform vec3 uCamTint;
uniform float uCamContrast;
uniform float uCamGain;
uniform sampler2D uPig;
uniform float uPigMix;
varying vec2 vUv;
float m(vec2 p) { return texture2D(uMask, p).r; }
void main() {
  vec2 vuv = vec2(uT.x + vUv.x * uT.y, uT.z + (1.0 - vUv.y) * uT.w);
  float inside = step(0.0, vuv.x) * step(vuv.x, 1.0) * step(0.0, vuv.y) * step(vuv.y, 1.0);
  vec2 o = uTexel * uBlur;
  // Desenfoque en dos anillos + gradiente para el borde.
  float c = m(vuv) * 0.2;
  c += (m(vuv + vec2(o.x, 0.0)) + m(vuv - vec2(o.x, 0.0)) + m(vuv + vec2(0.0, o.y)) + m(vuv - vec2(0.0, o.y))) * 0.1;
  c += (m(vuv + o) + m(vuv - o) + m(vuv + vec2(o.x, -o.y)) + m(vuv + vec2(-o.x, o.y))) * 0.075;
  vec2 o2 = o * 2.5;
  c += (m(vuv + vec2(o2.x, 0.0)) + m(vuv - vec2(o2.x, 0.0)) + m(vuv + vec2(0.0, o2.y)) + m(vuv - vec2(0.0, o2.y))) * 0.025;
  float gx = m(vuv + vec2(o.x * 1.5, 0.0)) - m(vuv - vec2(o.x * 1.5, 0.0));
  float gy = m(vuv + vec2(0.0, o.y * 1.5)) - m(vuv - vec2(0.0, o.y * 1.5));
  float edge = clamp(length(vec2(gx, gy)), 0.0, 1.0);
  vec3 col = uBg + uColor * (c * uOpacity + edge * uEdge * uOpacity) * uStrength * inside;
  // Cámara difuminada: solo la luminancia, teñida de placa (sin color propio).
  if (uCamMix > 0.0) {
    // Luminancia en espacio de pantalla (la textura llega lineal): los medios tonos de la persona se leen
    // y el negro de la sala se queda negro.
    float l = pow(dot(texture2D(uCam, vec2(vuv.x, 1.0 - vuv.y)).rgb, vec3(0.2126, 0.7152, 0.0722)), 0.4545);
    l = clamp((l * uCamGain - 0.5) * uCamContrast + 0.5, 0.0, 1.0);
    l *= l;
    col += uCamTint * l * uCamMix * inside;
  }
  // Sombra con hocico: la cabeza de cerdo sobre la sombra del donante (en su propia capa, más nítida).
  if (uPigMix > 0.0) col += uCamTint * texture2D(uPig, vec2(vuv.x, 1.0 - vuv.y)).r * uPigMix * inside;
  vec3 vid = texture2D(uVideo, vec2(vuv.x, 1.0 - vuv.y)).rgb;
  col = mix(col, vid * 0.85, uVideoMix * inside);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class SoftTissue {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private tex: DataTexture;
  private videoTex: Texture | null = null;
  /** Imagen reducida y desenfocada de la webcam (se redibuja en cada frame, nunca se guarda). */
  private camCanvas = document.createElement('canvas');
  private camCtx = this.camCanvas.getContext('2d');
  private camTex: CanvasTexture | null = null;
  private camLevel = 0;
  /** Sombra con hocico (§9.6): cabeza de cerdo de perfil sobre la sombra real del donante.
   *  x, y en fracción del video (y hacia abajo), size = alto de cabeza en fracción del alto, dir ±1. */
  private readonly pig = { amount: 0, x: 0, y: 0, size: 0, dir: 1 };
  private pigCanvas = document.createElement('canvas');
  private pigCtx = this.pigCanvas.getContext('2d');
  private pigTex: CanvasTexture | null = null;
  private strength = 0;
  private target = 0;
  private readonly t4 = new Vector4();
  calibrating = false;
  private video: HTMLVideoElement | null;

  constructor(video: HTMLVideoElement | null) {
    this.video = video;
    this.tex = new DataTexture(new Uint8Array(4), 2, 2, RedFormat, UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = LinearFilter;
    this.tex.needsUpdate = true;
    this.mat = new ShaderMaterial({
      uniforms: {
        uMask: { value: this.tex },
        uVideo: { value: this.tex },
        uT: { value: this.t4 },
        uTexel: { value: new Vector2(1 / 256, 1 / 144) },
        uBg: { value: new Color(config.background) },
        uColor: { value: new Color(config.softTissue.color) },
        uOpacity: { value: config.softTissue.opacity },
        uEdge: { value: config.softTissue.edge },
        uBlur: { value: config.softTissue.blur },
        uStrength: { value: 0 },
        uVideoMix: { value: 0 },
        uCam: { value: this.tex },
        uCamMix: { value: 0 },
        uCamTint: { value: new Color(config.cameraBlur.tint) },
        uCamContrast: { value: config.cameraBlur.contrast },
        uCamGain: { value: config.cameraBlur.gain },
        uPig: { value: this.tex },
        uPigMix: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.video = video;
    this.videoTex?.dispose();
    this.videoTex = null;
  }

  setPigShadow(amount: number, x = 0, y = 0, size = 0, dir = 1): void {
    Object.assign(this.pig, { amount, x, y, size, dir });
  }

  /** Cabeza de cerdo de perfil (hocico largo de punta plana, frente cóncava, oreja hacia adelante) en su
   *  propio canvas, con un desenfoque suave: así la silueta se lee aunque la cámara esté muy difusa. */
  private drawPigShadow(aspect: number): Texture | null {
    const ctx = this.pigCtx;
    const p = this.pig;
    if (!ctx || p.amount <= 0.01) return null;
    // Resolución alta y desenfoque proporcional: la sombra no se ve pixelada al proyectarla grande.
    const w = 768;
    const h = Math.max(9, Math.round(w / aspect));
    if (this.pigCanvas.width !== w || this.pigCanvas.height !== h || !this.pigTex) {
      this.pigCanvas.width = w;
      this.pigCanvas.height = h;
      this.pigTex?.dispose();
      this.pigTex = new CanvasTexture(this.pigCanvas);
      this.pigTex.minFilter = this.pigTex.magFilter = LinearFilter;
      this.pigTex.generateMipmaps = false;
    }
    ctx.clearRect(0, 0, w, h);
    const cx = p.x * w, cy = p.y * h, S = p.size * h * config.absence.shadowScale;
    this.pigTex.needsUpdate = true;
    if (S < 2) return this.pigTex;
    ctx.save();
    ctx.filter = `blur(${Math.max(0, config.absence.shadowBlur) * (w / 384)}px)`;
    ctx.globalAlpha = Math.min(1, p.amount);
    ctx.translate(cx, cy);
    ctx.scale(p.dir * S, S);
    ctx.fillStyle = '#ffffff';
    // Perfil: nuca redonda, frente que se hunde, hocico largo y angosto de punta plana, papada.
    ctx.beginPath();
    ctx.moveTo(-0.42, 0.1);
    ctx.quadraticCurveTo(-0.5, -0.38, 0.08, -0.46);
    ctx.quadraticCurveTo(0.45, -0.42, 0.72, -0.22);
    ctx.quadraticCurveTo(1.1, -0.13, 1.56, -0.13);
    ctx.quadraticCurveTo(1.64, -0.12, 1.63, 0.0);
    ctx.quadraticCurveTo(1.63, 0.13, 1.54, 0.14);
    ctx.quadraticCurveTo(1.15, 0.16, 0.8, 0.22);
    ctx.quadraticCurveTo(0.62, 0.52, 0.2, 0.55);
    ctx.quadraticCurveTo(-0.28, 0.52, -0.42, 0.1);
    ctx.closePath();
    ctx.fill();
    // Oreja grande, en punta, hacia arriba y adelante.
    ctx.beginPath();
    ctx.moveTo(-0.16, -0.36);
    ctx.quadraticCurveTo(0.02, -0.9, 0.42, -1.08);
    ctx.quadraticCurveTo(0.36, -0.66, 0.26, -0.4);
    ctx.closePath();
    ctx.fill();
    // Ojo y narina: huecos en la sombra.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.ellipse(0.36, -0.2, 0.075, 0.06, 0, 0, Math.PI * 2);
    ctx.ellipse(1.55, -0.01, 0.035, 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return this.pigTex;
  }

  /** Redibuja la webcam reducida con desenfoque (más ancha que el canvas: sin bordes oscuros). */
  private drawCamera(): Texture | null {
    const v = this.video;
    const ctx = this.camCtx;
    if (!v || !v.videoWidth || !ctx) return null;
    const c = config.cameraBlur;
    const w = Math.max(16, Math.round(c.width));
    const h = Math.max(9, Math.round((w * v.videoHeight) / v.videoWidth));
    if (this.camCanvas.width !== w || this.camCanvas.height !== h || !this.camTex) {
      this.camCanvas.width = w;
      this.camCanvas.height = h;
      this.camTex?.dispose();
      this.camTex = new CanvasTexture(this.camCanvas);
      this.camTex.colorSpace = SRGBColorSpace;
      this.camTex.minFilter = this.camTex.magFilter = LinearFilter;
      this.camTex.generateMipmaps = false;
    }
    const b = Math.max(0, c.blur);
    ctx.filter = b > 0 ? `blur(${b}px)` : 'none';
    ctx.drawImage(v, -2 * b, -2 * b, w + 4 * b, h + 4 * b);
    this.camTex.needsUpdate = true;
    return this.camTex;
  }

  /** Nuevo frame de pose: actualiza la máscara (o la apaga si no hay nadie). */
  ingest(frame: PoseFrame): void {
    if (frame.count === 0) {
      this.target = 0;
      return;
    }
    if (!frame.mask) return;
    this.target = 1;
    const { maskW: w, maskH: h } = frame;
    const img = this.tex.image as { data: Uint8Array; width: number; height: number };
    if (img.width !== w || img.height !== h) {
      this.tex.dispose();
      this.tex = new DataTexture(new Uint8Array(w * h), w, h, RedFormat, UnsignedByteType);
      this.tex.magFilter = this.tex.minFilter = LinearFilter;
      this.tex.unpackAlignment = 1; // anchos que no son múltiplo de 4
      this.mat.uniforms.uMask.value = this.tex;
      this.mat.uniforms.uTexel.value.set(1 / w, 1 / h);
    }
    (this.tex.image as { data: Uint8Array }).data.set(frame.mask);
    this.tex.needsUpdate = true;
  }

  /** `cine` 0..1: la letterbox de la cinemática; en los primeros planos la sala no calza y se apaga. */
  update(dt: number, proj: Projection, cine = 0): void {
    const c = config.softTissue;
    const u = this.mat.uniforms;
    this.strength += (this.target - this.strength) * (1 - Math.exp(-3 * dt));
    // Cámara difuminada: aparece con los visitantes (misma rampa que la máscara).
    const cb = config.cameraBlur;
    this.camLevel = cb.enabled && !this.calibrating ? this.strength * (1 - cine) : 0;
    const camTex = this.camLevel > 0.002 ? this.drawCamera() : null;
    u.uCam.value = camTex ?? this.tex;
    u.uCamMix.value = camTex ? cb.opacity * this.camLevel : 0;
    u.uCamTint.value.set(cb.tint);
    u.uCamContrast.value = cb.contrast;
    u.uCamGain.value = cb.gain;
    // La sombra con hocico aparece con la persona, aunque la cámara esté apagada o muy oscura.
    const aspect = this.video?.videoWidth ? this.video.videoWidth / this.video.videoHeight : proj.videoW / proj.videoH;
    const pigTex = this.calibrating ? null : this.drawPigShadow(aspect);
    u.uPig.value = pigTex ?? this.tex;
    u.uPigMix.value = pigTex ? config.absence.shadowOpacity * this.strength * (1 - cine) : 0;
    proj.maskTransform(this.t4);
    u.uBg.value.set(config.background);
    u.uColor.value.set(c.color);
    u.uOpacity.value = c.opacity;
    u.uEdge.value = c.edge;
    u.uBlur.value = c.blur;
    u.uStrength.value = c.enabled ? this.strength : 0;
    if (this.calibrating && this.video && this.video.videoWidth) {
      if (!this.videoTex) {
        this.videoTex = new VideoTexture(this.video);
        this.videoTex.colorSpace = SRGBColorSpace;
      }
      u.uVideo.value = this.videoTex;
      u.uVideoMix.value = 0.4;
    } else {
      u.uVideoMix.value = 0;
    }
  }
}
