// Panel de ajustes en vivo (tecla G, §16). Se arma desde `config`: cada valor tiene
// su control; "Guardar" persiste en localStorage y "Exportar" baja un JSON.
import GUI from 'lil-gui';
import { config, resetConfig, saveCalibration, saveConfig } from './config.ts';
import { downloadBlob, timestampName } from './persist.ts';
import { PRESET_ORDER, type PresetName } from './quality.ts';

type Range = [number, number, number?];

/** Rangos de los sliders; lo que no figura queda como campo numérico. */
const RANGES: Record<string, Range> = {
  'webcam.fps': [15, 60, 1],
  'camera.vfovDeg': [20, 90, 0.1],
  'pose.inputWidth': [256, 1280, 32],
  'pose.maskEvery': [1, 6, 1],
  'filter.minCutoff2d': [0.05, 5], 'filter.beta2d': [0, 10], 'filter.minCutoff3d': [0.05, 5], 'filter.beta3d': [0, 10],
  'filter.dCutoff': [0.1, 5], 'filter.visibilityRate': [0.5, 20],
  'tracking.lostGrace': [0, 3], 'tracking.matchDist': [0.05, 0.6], 'tracking.fadeIn': [0.05, 3], 'tracking.fadeOut': [0.05, 3],
  'retarget.smoothing': [1, 60], 'retarget.rootSmoothing': [1, 60], 'retarget.depthSmoothing': [0.5, 30],
  'retarget.minVisibility': [0, 1], 'retarget.headPitchOffsetDeg': [-30, 40], 'retarget.neckShare': [0, 1],
  'retarget.headMaxDeg': [10, 110], 'retarget.torsoTwistMaxDeg': [0, 90], 'retarget.shoulderConeDeg': [60, 180],
  'retarget.hipConeDeg': [40, 180], 'retarget.elbowMaxDeg': [60, 170], 'retarget.kneeMaxDeg': [60, 170],
  'retarget.hingeSideFactor': [0, 1], 'retarget.armTwistMaxDeg': [0, 150], 'retarget.legTwistMaxDeg': [0, 90],
  'retarget.wristConeDeg': [10, 120], 'retarget.wristTwistMaxDeg': [0, 150], 'retarget.ankleConeDeg': [5, 90],
  'retarget.scaleMin': [0.5, 1], 'retarget.scaleMax': [1, 2],
  'calib.offsetX': [-0.5, 0.5, 0.001], 'calib.offsetY': [-0.5, 0.5, 0.001], 'calib.zoom': [0.4, 3, 0.001], 'calib.bodyScale': [0.6, 1.6, 0.001],
  'skin.fresnelPower': [0.3, 8], 'skin.intensity': [0, 4], 'skin.base': [0, 0.3], 'skin.fill': [0, 0.3], 'skin.opacity': [0, 2],
  'muscle.fresnelPower': [0.3, 8], 'muscle.intensity': [0, 4], 'muscle.base': [0, 0.5], 'muscle.opacity': [0, 1],
  'muscle.fiberScale': [10, 500], 'muscle.fiberStrength': [0, 1],
  'organs.fresnelPower': [0.3, 8], 'organs.intensity': [0, 4], 'organs.base': [0, 0.5], 'organs.opacity': [0, 1],
  'organs.lungOpacity': [0, 1], 'organs.liverOpacity': [0, 1], 'organs.heartOpacity': [0, 1], 'organs.heartThrough': [0, 1],
  'heart.bpm': [30, 180, 1], 'heart.contraction': [0, 0.25], 'heart.tintAmount': [0, 1],
  'bone.roughness': [0, 1], 'bone.clearcoat': [0, 1], 'bone.envIntensity': [0, 3], 'bone.emissiveIntensity': [0, 1],
  'bone.rimPower': [0.3, 8], 'bone.rimIntensity': [0, 5], 'bone.microScale': [10, 800], 'bone.microStrength': [0, 0.06],
  'boneGlow.fresnelPower': [0.3, 8], 'boneGlow.intensity': [0, 2], 'boneGlow.base': [0, 0.3],
  'cartilage.opacity': [0, 1],
  'pigFace.density': [0, 4, 0.01], 'pigFace.edge': [0, 0.4, 0.001],
  'softTissue.opacity': [0, 1], 'softTissue.edge': [0, 2], 'softTissue.blur': [0, 8],
  'absence.lookAt': [0, 20], 'absence.lookTime': [0.2, 10], 'absence.lookToPublic': [0, 1],
  'absence.shadowAt': [0, 20], 'absence.shadowTime': [0.2, 10], 'absence.shadowScale': [0.5, 3], 'absence.shadowOpacity': [0, 1], 'absence.shadowBlur': [0, 8, 0.5],
  'absence.telosAt': [0, 24], 'absence.telosTime': [0.3, 8], 'absence.telosPitchDeg': [0, 120],
  'audio.heartOwn': [0, 1], 'audio.spo2Base': [400, 1600, 1], 'audio.spo2Semitones': [0, 2], 'audio.monitor': [0, 2],
  'audio.ventilator': [0, 2], 'audio.ventRate': [6, 30, 1], 'audio.alarm': [0, 2], 'audio.xray': [0, 2],
  'fluoro.irisRadius': [0.8, 2.2, 0.01], 'fluoro.irisSoft': [0.001, 0.1, 0.001], 'fluoro.falloff': [0, 0.8],
  'fluoro.distortion': [0, 0.15, 0.001], 'fluoro.lag': [0, 0.4, 0.005], 'fluoro.pulseFps': [0, 30, 0.5],
  'fluoro.noise': [0, 0.5, 0.005], 'fluoro.noiseSize': [0.5, 4, 0.1], 'fluoro.veil': [0, 0.15, 0.001],
  'fluoro.sharpen': [0, 2], 'fluoro.sharpenRadius': [0.5, 8, 0.1], 'fluoro.grid': [0, 0.15, 0.001], 'fluoro.gridPeriod': [2, 8, 0.1],
  'fluoro.bloom': [0, 1], 'fluoro.doseRate': [0, 0.1, 0.001],
  'plate.shell': [0, 0.3], 'plate.fill': [0, 0.5], 'plate.edgeClamp': [0.05, 1], 'plate.skinFill': [0, 0.3], 'plate.skinEdge': [0, 0.5],
  'plate.muscleFill': [0, 0.3], 'plate.organFill': [0, 0.3], 'plate.bloom': [0, 1], 'plate.grain': [0.5, 3],
  'extraction.grabRadius': [0.02, 0.4], 'extraction.grabDwell': [0, 3], 'extraction.deliverDwell': [0, 3], 'extraction.deliverRadius': [0.02, 0.4], 'extraction.follow': [1, 40],
  'extraction.autoAfter': [2, 60], 'extraction.autoTime': [0.5, 10], 'extraction.deliverAfter': [3, 60], 'extraction.afterDelivery': [0, 8],
  'film.border': [0, 8], 'film.radius': [0, 8], 'film.soft': [0, 8], 'film.opacity': [0, 1], 'labels.scale': [0.6, 5], 'guide.waitDim': [0, 1], 'guide.recognizedHold': [0, 5],
  'cameraBlur.opacity': [0, 1], 'cameraBlur.width': [48, 480, 16], 'cameraBlur.blur': [0, 16, 0.5], 'cameraBlur.contrast': [0.5, 3], 'cameraBlur.gain': [0.5, 4],
  'lighting.envIntensity': [0, 3], 'lighting.keyIntensity': [0, 10], 'lighting.rimIntensity': [0, 12], 'lighting.fillIntensity': [0, 4],
  'post.exposure': [0.2, 3], 'post.bloomIntensity': [0, 5], 'post.bloomThreshold': [0, 2], 'post.bloomSmoothing': [0, 1],
  'post.bloomRadius': [0, 1], 'post.aoRadius': [0.005, 0.5, 0.001], 'post.aoDistanceFalloff': [0.05, 3], 'post.aoIntensity': [0, 10],
  'post.chromaticAberration': [0, 0.01, 0.0001], 'post.vignetteOffset': [0, 1], 'post.vignetteDarkness': [0, 1],
  'post.grainIntensity': [0, 0.5, 0.001], 'post.grainSize': [0.5, 4], 'post.desaturation': [0, 1], 'post.tintAmount': [0, 1],
  'show.esperaStable': [0.2, 5], 'show.placaMin': [1, 20], 'show.placaPair': [1, 20], 'show.placaSolo': [3, 60],
  'show.asignacion': [3, 10], 'show.transformacion': [10, 20], 'show.extraccion': [14, 30], 'show.ausencia': [24, 40],
  'show.soloOffset': [0.4, 1.6],
  'transform.crackDelay': [0, 0.2], 'transform.crackTime': [0.05, 0.6], 'transform.growDelay': [0, 0.4],
  'transform.growTime': [0.1, 1], 'transform.skullGrowTime': [0.1, 1.5], 'transform.snoutStart': [0.1, 1],
  'transform.snoutOvershoot': [1, 1.4], 'transform.snoutTime': [0.2, 2], 'transform.morphHead': [0, 1.5],
  'transform.morphBody': [0, 1.5], 'transform.morphTime': [0.2, 2], 'transform.fragmentSpeed': [0, 4],
  'transform.fragmentLift': [0, 3], 'transform.fragmentSpin': [0, 30], 'transform.fragmentLife': [0.5, 5],
  'transform.gravity': [0, 20], 'transform.splinters': [0, 3], 'transform.dust': [0, 3], 'transform.splinterSpeed': [0, 6],
  'transform.shakePx': [0, 15], 'transform.skullShakePx': [0, 20], 'transform.shakeDecay': [1, 20], 'transform.shakeFreq': [4, 40],
  'transform.geneSize': [0.005, 0.08, 0.001], 'transform.geneIntensity': [0.5, 12], 'transform.geneTravel': [0.2, 2],
  'blood.particleRadius': [0.003, 0.02, 0.0005], 'blood.gravity': [0, 20], 'blood.drag': [0, 3], 'blood.cohesion': [0, 60],
  'blood.viscosity': [0, 15], 'blood.stick': [0, 30], 'blood.floorFriction': [0, 20], 'blood.smoothing': [0.5, 8],
  'blood.smoothingRange': [0.5, 8], 'blood.thickness': [0.2, 4], 'blood.edgeBend': [0, 6], 'blood.stretch': [0, 2], 'blood.riverSpeed': [0.05, 2], 'blood.riverWidth': [0.005, 0.1, 0.001], 'blood.riverFeed': [0, 2], 'blood.stretchMax': [0, 6], 'blood.edgeSmooth': [0, 5], 'blood.refraction': [0, 3], 'blood.absorbR': [0, 2000],
  'blood.absorbG': [0, 8000], 'blood.absorbB': [0, 8000], 'blood.roughness': [0.02, 0.6], 'blood.specular': [0, 4],
  'blood.envReflection': [0, 4], 'blood.clotTime': [2, 60], 'blood.puddleGrowth': [0.1, 6], 'blood.puddleMax': [0.5, 6], 'blood.puddleReflect': [0, 8],
  'blood.lensTintR': [0, 1], 'blood.lensTintG': [0, 0.3], 'blood.lensTintB': [0, 0.3], 'blood.lensSoft': [0, 0.5], 'blood.lensSpec': [0, 1.5], 'blood.ribBurst': [0, 8000],
  'blood.gush': [0, 5000], 'blood.arterial': [0, 5000], 'blood.heartDrip': [0, 600], 'blood.cavityDrip': [0, 800],
  'blood.benchRate': [0, 4000],
  'cinematic.bokeh': [0, 8], 'cinematic.focusRangeScale': [0.2, 5], 'cinematic.pullStart': [0, 0.2],
  'cinematic.pullPerBreak': [0, 0.1], 'cinematic.vesselStiffness': [0.05, 1], 'cinematic.vesselDamping': [0.9, 1, 0.001],
  'cinematic.vesselGravity': [0, 10], 'cinematic.vesselMaxStretch': [1, 4], 'cinematic.ribSpeed': [0, 4], 'cinematic.ribSpin': [0, 20],
  'cinematic.receptorOpen': [0, 0.06, 0.001], 'cinematic.receptorGlow': [0, 5], 'cinematic.exposure': [0.2, 1.5],
  'cinematic.bloom': [0, 2], 'cinematic.geneScale': [0, 1],
  'audio.ambience': [0, 2], 'audio.interface': [0, 2], 'audio.effects': [0, 2], 'audio.heart': [0, 2], 'audio.reverb': [0, 2],
  'audio.reverbFx': [0, 1], 'audio.reverbUi': [0, 1], 'audio.reverbHeart': [0, 1],
  'erase.desatTime': [0.2, 3], 'erase.sweep1': [0, 3], 'erase.sweep2': [0.5, 5], 'erase.sweep3': [1, 6], 'erase.sweepTime': [0.5, 4],
  'capture.scale': [1, 4, 0.5], 'simulator.people': [1, 2, 1], 'simulator.distance': [1.2, 6], 'simulator.noise': [0, 0.04, 0.001],
};

const TITLES: Record<string, string> = {
  webcam: 'Webcam', camera: 'Cámara', pose: 'MediaPipe', filter: 'Filtro One Euro', tracking: 'Tracking',
  retarget: 'Retargeting', calib: 'Calibración', skin: 'Piel', muscle: 'Músculo', organs: 'Órganos', heart: 'Corazón',
  bone: 'Hueso', boneGlow: 'Hueso · densidad', cartilage: 'Cartílago', roles: 'Roles (círculos del piso)', guide: 'Guía', extraction: 'Extracción', fluoro: 'Fluoroscopia', film: 'Placa (marco)', labels: 'Textos', plate: 'Placa real', pigFace: 'Cara del cerdo', softTissue: 'Tejido blando (máscara)', cameraBlur: 'Cámara difuminada',
  lighting: 'Luces', post: 'Postproceso', show: 'Ciclo (tiempos en s)', transform: 'Transformación', blood: 'Sangre', cinematic: 'Cinemática', erase: 'Borrado', absence: 'Ausencia (mirada y sombra)', audio: 'Sonido', capture: 'Captura', simulator: 'Simulador', debug: 'Debug',
};

export interface GuiHooks {
  onProjection: () => void;
  onPreset: (p: PresetName) => void;
  onSource: () => void;
  preset: () => PresetName;
  /** Descarga el contador de donantes y su historial (§16). */
  onExportCounter: () => void;
  /** Cuenta los píxeles rojos del próximo frame (§18). */
  onRedCheck: () => void;
  /** MediaPipe en GPU o CPU: reinicia el detector. */
  onPoseDelegate: () => void;
}

export class Gui {
  readonly gui: GUI;
  private shown = false;

  constructor(hooks: GuiHooks) {
    this.gui = new GUI({ title: 'DONANTE · ajustes (G)', width: 340 });
    this.gui.domElement.classList.add('donante-gui');
    const state = { preset: hooks.preset() };
    this.gui.add(state, 'preset', PRESET_ORDER).name('preset de calidad').onChange((v: PresetName) => hooks.onPreset(v));
    this.gui.add(config, 'mirror').name('espejo').onChange(hooks.onProjection);
    this.gui.addColor(config, 'background').name('fondo');

    const obj = config as unknown as Record<string, Record<string, unknown>>;
    for (const section of Object.keys(TITLES)) {
      const folder = this.gui.addFolder(TITLES[section]);
      folder.close();
      const target = obj[section];
      for (const key of Object.keys(target)) {
        const v = target[key];
        const path = `${section}.${key}`;
        let ctrl;
        if (typeof v === 'string' && v.startsWith('#')) ctrl = folder.addColor(target, key);
        else if (section === 'webcam' && key === 'source') ctrl = folder.add(target, key, ['camara', 'simulador']);
        else if (path === 'extraction.mode') ctrl = folder.add(target, key, ['manos', 'cinematica']);
        else if (path === 'pose.delegate') ctrl = folder.add(target, key, ['GPU', 'CPU']).onChange(() => hooks.onPoseDelegate());
        else if (path === 'roles.mode') ctrl = folder.add(target, key, ['posicion', 'azar']);
        else if (path === 'roles.donorSide') ctrl = folder.add(target, key, ['izquierda', 'derecha']);
        else if (path === 'debug.assetViewer') ctrl = folder.add(target, key, ['ninguno', 'corazon', 'costillas']);
        else if (path === 'debug.bloodView') ctrl = folder.add(target, key, ['ninguna', 'profundidad', 'normales', 'grosor']);
        else if (typeof v === 'number' && RANGES[path]) {
          const [a, b, s] = RANGES[path];
          ctrl = folder.add(target, key, a, b, s ?? (b - a) / 200);
        } else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') ctrl = folder.add(target, key);
        else continue;
        if (section === 'camera' || section === 'calib') {
          ctrl.onChange(() => {
            if (section === 'calib') saveCalibration();
            hooks.onProjection();
          });
        }
        if (path === 'webcam.source') ctrl.onChange(hooks.onSource);
      }
    }

    const actions = {
      guardar: () => {
        saveConfig();
        console.info('[gui] ajustes guardados');
      },
      restablecer: () => {
        resetConfig();
        this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
        hooks.onProjection();
        console.info('[gui] valores de fábrica (sin guardar; la calibración se conserva)');
      },
      exportar: () => {
        downloadBlob(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }), timestampName('donante_config', 'json'));
      },
    };
    this.gui.add(actions, 'guardar').name('Guardar ajustes');
    this.gui.add(actions, 'restablecer').name('Restablecer');
    this.gui.add(actions, 'exportar').name('Exportar JSON');
    this.gui.add({ contador: hooks.onExportCounter }, 'contador').name('Exportar contador');
    this.gui.add({ rojo: hooks.onRedCheck }, 'rojo').name('Probar píxeles rojos');
    this.gui.hide();
  }

  toggle(): void {
    this.shown = !this.shown;
    this.gui.show(this.shown);
  }

  refresh(): void {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
}
