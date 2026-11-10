// Arranque, loop y máquina de estados (§8): ESPERA → PLACA → ASIGNACIÓN → TRANSFORMACIÓN →
// EXTRACCIÓN → AUSENCIA → ESPERA. Teclas del operador según §16.
import './style.css';
import { config, loadConfig } from './config.ts';
import { initialPreset, gpuName, nextPreset, PRESETS, savePreset, type PresetName } from './quality.ts';
import { Clocks } from './clock.ts';
import { LoadingScreen } from './loading.ts';
import { Stage } from './render/stage.ts';
import { BodyRig } from './render/body.ts';
import { loadBodyAssets } from './anatomy/assets.ts';
import { Webcam } from './input/webcam.ts';
import { PLATE, PLATE_FILL } from './render/materials/glsl.ts';
import { PoseEngine } from './input/pose.ts';
import { PoseSimulator } from './input/simulator.ts';
import { PeopleTracker } from './input/people.ts';
import type { PoseFrame } from './input/poseTypes.ts';
import { AudioEngine } from './audio/engine.ts';
import { Debug } from './debug.ts';
import { Gui } from './gui.ts';
import { Calibration } from './calibration.ts';
import { installOfflineGuard } from './offline.ts';
import { AssetViewer } from './render/assetViewer.ts';
import { Debris } from './render/fracture.ts';
import { Labels } from './render/labels.ts';
import { Counter } from './counter.ts';
import { Cues } from './audio/cues.ts';
import { Machine, Show, type State, type StateName } from './states/machine.ts';
import { espera } from './states/espera.ts';
import { placa } from './states/placa.ts';
import { asignacion } from './states/asignacion.ts';
import { transformacion } from './states/transformacion.ts';
import { extraccion } from './states/extraccion.ts';
import { extraccionManos } from './states/extraccionManos.ts';
import { FilmFrame } from './render/filmFrame.ts';
import { FluoroHud } from './render/fluoroHud.ts';
import { Vector3 } from 'three';
import { ausencia } from './states/ausencia.ts';

installOfflineGuard();
loadConfig();
const gpu = gpuName();
let presetName: PresetName = initialPreset(gpu);
const loading = new LoadingScreen();
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = new Stage(canvas, PRESETS[presetName]);
stage.applyMirror();
const clocks = new Clocks();
const audio = new AudioEngine();
const people = new PeopleTracker();
const pose = new PoseEngine();
const sim = new PoseSimulator();
const webcam = new Webcam();
const film = new FilmFrame();
const fluoroHud = new FluoroHud();
const rulerA = new Vector3();
const rulerB = new Vector3();
const debug = new Debug();
const calib = new Calibration();
let bodies: BodyRig[] = [];
let viewer: AssetViewer | null = null;
const labels = new Labels();
const counter = new Counter();
const cues = new Cues(audio);
let machine: Machine | null = null;
labels.onType = () => cues.click();
let assetsSource = '—';
let cameraError = '';
let running = false;

const audioHint = document.createElement('div');
audioHint.className = 'audio-hint';
audioHint.textContent = 'audio · pulse una tecla';
document.body.appendChild(audioHint);
audio.onUnlock = () => {
  audioHint.remove();
  cues.startHum();
};
// Exposición sin operador: si el navegador deja sonar sin un gesto (Chrome abierto por INICIAR-DONANTE.bat con
// --autoplay-policy=no-user-gesture-required), el audio arranca solo. Si no, sigue esperando una tecla o un clic.
void audio.unlock().catch(() => {});

const usingCamera = () => config.webcam.source === 'camara' && webcam.active;

function onPose(f: PoseFrame): void {
  if (!usingCamera()) return;
  people.ingest(f, clocks.realTime);
  stage.softTissue.ingest(f);
}
pose.onResult = onPose;
webcam.onFrame((now) => {
  if (config.webcam.source === 'camara') void pose.submit(webcam.video, now);
});

async function startCamera(): Promise<void> {
  try {
    await webcam.start();
    cameraError = '';
    stage.projection.setVideo(webcam.width, webcam.height);
    stage.softTissue.setVideo(webcam.video);
    console.info(`[webcam] ${webcam.deviceLabel} ${webcam.width}×${webcam.height}`);
  } catch (err) {
    cameraError = err instanceof Error ? err.message : String(err);
    console.warn('[webcam] no disponible, se usa el simulador:', cameraError);
    config.webcam.source = 'simulador';
    stage.projection.setVideo(1280, 720);
  }
  stage.updateProjection();
}

function onSourceChange(): void {
  people.clear();
  if (config.webcam.source === 'camara' && !webcam.active) void startCamera();
  else if (config.webcam.source === 'simulador') stage.projection.setVideo(1280, 720);
  else stage.projection.setVideo(webcam.width, webcam.height);
  stage.updateProjection();
}

async function applyPreset(name: PresetName): Promise<void> {
  presetName = name;
  savePreset(name);
  const q = PRESETS[name];
  stage.applyQuality(q);
  gui.refresh();
  console.info(`[calidad] ${name}`);
  if (pose.model !== q.poseModel) {
    try {
      await pose.init(q.poseModel);
    } catch (err) {
      console.error('[pose] no se pudo cambiar de modelo', err);
    }
  }
}

const gui = new Gui({
  onProjection: () => {
    stage.applyMirror();
    stage.updateProjection();
  },
  onPreset: (p) => void applyPreset(p),
  onSource: onSourceChange,
  preset: () => presetName,
  onExportCounter: () => counter.export(),
  onRedCheck: () => void stage.redCheck.request(),
  onPoseDelegate: () => {
    void pose.init(PRESETS[presetName].poseModel).catch((err) => console.error('[pose] no se pudo reiniciar', err));
  },
});
calib.onChange = () => stage.updateProjection();

// ── Teclado del operador (§16) ─────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (!audio.unlocked) void audio.unlock();
  if ((e.target as HTMLElement)?.closest?.('.lil-gui')) return;
  if (calib.handleKey(e)) {
    e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  switch (k) {
    case 'f':
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
      break;
    case 'd':
      debug.toggle(bodies);
      break;
    case 'g':
      gui.toggle();
      break;
    case 'q':
      void applyPreset(nextPreset(presetName));
      break;
    case 'c':
      calib.toggle();
      break;
    case 'm':
      console.info(audio.toggleMute() ? '[audio] silenciado' : '[audio] activo');
      break;
    case 'p':
      void stage.capture(clocks.dtReal);
      break;
    case '1': case '2': case '3': case '4': case '5': case '6': {
      const order: StateName[] = ['PLACA', 'ASIGNACION', 'TRANSFORMACION', 'EXTRACCION', 'AUSENCIA', 'ESPERA'];
      machine?.jump(order[Number(k) - 1]);
      break;
    }
    case 'x':
      machine?.replayCinematic();
      break;
    case 'r':
      if (e.shiftKey) counter.requestReset(performance.now());
      else return;
      break;
    default:
      return;
  }
  e.preventDefault();
});
window.addEventListener('pointerdown', () => {
  if (!audio.unlocked) void audio.unlock();
});

// ── Arranque ───────────────────────────────────────────────────
async function boot(): Promise<void> {
  const tAssets = loading.task('anatomía', 2);
  const tModel = loading.task('modelo', 4);
  const tCam = loading.task('cámara', 1);
  const tShaders = loading.task('shaders', 1);

  const assetsP = loadBodyAssets((f, label) => tAssets(f, `anatomía · ${label}`));
  const camP = (config.webcam.source === 'camara' ? startCamera() : Promise.resolve(stage.projection.setVideo(1280, 720))).then(() => tCam(1));
  const poseP = pose.init(PRESETS[presetName].poseModel, (f) => tModel(f * 0.9, 'modelo de pose')).then(
    () => tModel(1),
    (err) => {
      console.error('[pose] MediaPipe no inició:', err);
      tModel(1, 'MediaPipe no disponible: simulador');
      config.webcam.source = 'simulador';
    },
  );

  const [assets, debris] = await Promise.all([assetsP, Debris.create()]);
  assetsSource = assets.source;
  tShaders(0.05, 'fracturas');
  bodies = [0, 1].map((i) => new BodyRig(assets, i, debris));
  for (const b of bodies) stage.scene.add(b.root, b.helper, b.batchRoot);
  viewer = new AssetViewer(assets);
  stage.scene.add(viewer.group, ...viewer.helpers);
  const show = new Show({ stage, people, bodies, labels, counter, cues, clocks, debris });
  // La extracción: con las manos del receptor (por defecto) o la cinemática de planos (config.extraction.mode).
  let extr: State = extraccionManos;
  const extraccionSegunModo: State = {
    name: 'EXTRACCION',
    enter(s) {
      extr = config.extraction.mode === 'cinematica' ? extraccion : extraccionManos;
      extr.enter(s);
    },
    update: (s, t, dt) => extr.update(s, t, dt),
    exit: (s) => extr.exit?.(s),
  };
  machine = new Machine(show, { ESPERA: espera, PLACA: placa, ASIGNACION: asignacion, TRANSFORMACION: transformacion, EXTRACCION: extraccionSegunModo, AUSENCIA: ausencia });
  await Promise.all([camP, poseP]);

  // Compilar shaders antes de mostrar nada (sin tirones al aparecer el primer visitante).
  tShaders(0.2, 'compilando shaders');
  for (const b of bodies) {
    b.root.visible = true;
    b.cineHeart?.show(true);
  }
  try {
    await stage.renderer.compileAsync(stage.scene, stage.camera);
    stage.render(0.016);
    // Precalentamiento de la cinemática: DOF, sangre y lente compilan acá y no en el primer ciclo.
    stage.post.setDof(true, 1, 0.3);
    stage.blood.pass.enabled = true;
    stage.blood.lensPass.enabled = true;
    stage.post.render(0.016);
    stage.post.setDof(false, 1, 0.3);
  } catch (err) {
    console.warn('[shaders] compileAsync', err);
  }
  for (const b of bodies) {
    b.cineHeart?.show(false);
    b.hide();
  }
  tShaders(1);
  loading.hide();
  running = true;
  if (import.meta.env.DEV) Object.assign(window, { __donante: { stage, bodies, people, pose, config, machine, counter, labels, frame, sim, clocks, audio, cues } });
  requestAnimationFrame(frame);
}

let lastFrameAt = 0;

function frame(now: number): void {
  if (!running) return;
  requestAnimationFrame(frame);
  // Tope de FPS del preset (LOW: 30): le deja GPU a MediaPipe para seguir a las personas.
  const cap = PRESETS[presetName].maxFps;
  if (cap > 0 && now - lastFrameAt < 1000 / cap - 2) return;
  lastFrameAt = now;
  debug.begin();
  clocks.tick(now);
  const tNow = clocks.realTime;

  if (config.webcam.source === 'simulador') {
    const f = sim.poll(now, stage.projection.videoW / stage.projection.videoH);
    if (f) {
      people.ingest(f, tNow);
      stage.softTissue.ingest(f);
    }
  }
  people.tick(clocks.dtReal, tNow);

  const m = machine!;
  // Debug de la Fase 2 (cerdo sobre el cuerpo en vivo): solo fuera del ciclo.
  if (m.name === 'PLACA' || m.name === 'ESPERA') for (const b of bodies) b.setDebugPig(config.debug.pigSkeleton);
  m.show.updateBodies(tNow);
  m.update(clocks.dtReal);
  viewer?.update(clocks.dtReal);
  labels.update(clocks.dtReal, stage.camera, stage.projection);

  // Cámara lenta en el sonido (§13) y niveles de la mezcla.
  audio.setTimeScale(clocks.timeScale);
  audio.sync();
  stage.softTissue.calibrating = calib.active;
  stage.softTissue.update(clocks.dtReal, stage.projection, stage.post.letterbox);
  // Placa real: fuera de los primeros planos de la cinemática (allí sigue el 3D con carne y sangre).
  PLATE.value = config.plate.enabled ? 1 - stage.post.letterbox : 0;
  PLATE_FILL.skin.value = config.plate.skinFill;
  PLATE_FILL.skinEdge.value = config.plate.skinEdge;
  PLATE_FILL.muscle.value = config.plate.muscleFill;
  PLATE_FILL.organ.value = config.plate.organFill;
  stage.post.plate = PLATE.value;
  // Fluoroscopia: también se aparta en los primeros planos de la cinemática.
  stage.post.fluoro = config.fluoro.enabled ? 1 - stage.post.letterbox : 0;
  film.update(counter.next);
  // Fragmentos de costilla en lote: su posición final de este frame (física, pose congelada).
  for (const b of bodies) b.syncFragmentBatches();
  const visible = bodies.filter((b) => b.visible);
  fluoroHud.update(clocks.dtReal, {
    study: counter.next,
    beam: m.name !== 'ESPERA' || people.people.some((p) => p.state !== 'leaving'),
    subjects: visible.length,
    pxPerCm: rulerScale(visible[0]),
  });
  stage.render(clocks.dtReal);

  debug.update(
    {
      state: `${m.name} ${m.t.toFixed(1)} s${m.show.solo ? ' · solo' : ''} · donantes ${counter.value}`,
      roleOf: (id: number) => m.show.roleOf(id),
      erase: stage.redCheck.last
        ? `${stage.redCheck.last.red === 0 ? '0 píxeles rojos ✓' : `${stage.redCheck.last.red} píxeles rojos ✗`} (${stage.redCheck.last.at})`
        : 'sin medir',
      preset: presetName,
      gpu,
      source: config.webcam.source,
      camera: usingCamera() ? `${webcam.deviceLabel} ${webcam.width}×${webcam.height}` : cameraError || 'sin cámara',
      assets: assetsSource,
      pose,
      renderer: stage.renderer,
      audio: audio.unlocked ? (audio.muted ? 'silenciado' : 'activo') : 'bloqueado',
    },
    people.people,
    bodies,
    stage.projection,
  );
  debug.end(clocks.dtReal, bodies);
}

/** Píxeles CSS por centímetro a la distancia de un cuerpo (o a la del simulador si no hay nadie):
 *  la regla de la fluoroscopia mide de verdad lo que se ve. */
function rulerScale(b: BodyRig | undefined): number {
  const cam = stage.camera;
  if (b) b.chestWorld(rulerA);
  else cam.getWorldDirection(rulerA).multiplyScalar(config.simulator.distance).add(cam.getWorldPosition(rulerB));
  rulerB.copy(rulerA);
  rulerB.y += 0.1;
  rulerA.project(cam);
  rulerB.project(cam);
  return (Math.abs(rulerB.y - rulerA.y) * 0.5 * window.innerHeight) / 10;
}

boot().catch((err) => {
  console.error(err);
  loading.error(err instanceof Error ? err.message : String(err));
});
