// Webcam: abre el dispositivo preferido y entrega cada frame nuevo con
// requestVideoFrameCallback (§7). La imagen nunca se guarda (§1.10).
import { config } from '../config.ts';

export class Webcam {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private frameCb: ((nowMs: number) => void) | null = null;
  deviceLabel = '';
  devices: MediaDeviceInfo[] = [];

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  get width(): number {
    return this.video.videoWidth || config.webcam.width;
  }
  get height(): number {
    return this.video.videoHeight || config.webcam.height;
  }
  get active(): boolean {
    return !!this.stream;
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    try {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      this.devices = [];
    }
    return this.devices;
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia no disponible');
    let id = deviceId;
    if (!id && config.webcam.preferLabel) {
      // Las etiquetas solo aparecen tras un primer permiso; si no, se usa la primera.
      const devs = await this.listDevices();
      id = devs.find((d) => d.label.toLowerCase().includes(config.webcam.preferLabel.toLowerCase()))?.deviceId;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: id ? { exact: id } : undefined,
        width: { ideal: config.webcam.width },
        height: { ideal: config.webcam.height },
        frameRate: { ideal: config.webcam.fps },
      },
    });
    this.deviceLabel = this.stream.getVideoTracks()[0]?.label ?? '';
    await this.boostExposure();
    this.video.srcObject = this.stream;
    await this.video.play();
    await this.listDevices();
    this.loop();
  }

  /** Fondo blanco: pide más exposición a la webcam para que las personas no queden a contraluz. Usa la
   *  compensación de exposición si el driver la ofrece (si no, no hace nada). */
  private async boostExposure(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    const k = config.webcam.exposureBoost;
    if (!track || k <= 0 || typeof track.getCapabilities !== 'function') return;
    try {
      const caps = track.getCapabilities() as Record<string, { min?: number; max?: number } | undefined>;
      const ec = caps.exposureCompensation;
      if (ec && ec.max !== undefined && ec.max > 0) {
        await track.applyConstraints({ advanced: [{ exposureCompensation: ec.max * k } as MediaTrackConstraintSet] });
        console.info(`[webcam] compensación de exposición +${(ec.max * k).toFixed(2)} (máx. ${ec.max})`);
      } else console.info('[webcam] la cámara no ofrece compensación de exposición');
    } catch (err) {
      console.warn('[webcam] no se pudo ajustar la exposición', err);
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Registra el callback por frame nuevo de video. */
  onFrame(cb: (nowMs: number) => void): void {
    this.frameCb = cb;
  }

  private loop = (): void => {
    if (!this.stream) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback(() => {
        this.frameCb?.(performance.now());
        this.loop();
      });
    } else {
      // Respaldo para navegadores sin rVFC: muestrear a la tasa de la cámara.
      setTimeout(() => {
        this.frameCb?.(performance.now());
        this.loop();
      }, 1000 / config.webcam.fps);
    }
  };
}
