// Todo valor ajustable de la obra (§16). lil-gui (tecla G) edita este objeto en vivo
// y "Guardar" lo persiste en localStorage. Los colores van en hex para lil-gui.
import { loadJSON, saveJSON } from './persist.ts';

export const config = {
  /** La proyección se ve como un espejo (el visitante levanta la mano izquierda y
   *  la ve a su izquierda). Se aplica con CSS sobre el canvas final. */
  mirror: true,
  background: '#05070a',

  webcam: {
    width: 1280,
    height: 720,
    fps: 30,
    /** Fragmento del nombre del dispositivo preferido (p. ej. "C920"). Vacío = el primero. */
    preferLabel: '',
    /** Exposición extra pedida a la webcam (0 = la suya, 1 = el máximo que permita). Con fondo blanco la
     *  cámara se cierra para no quemar el blanco y las personas quedan oscuras, a contraluz. Solo si la
     *  webcam lo permite (Chrome + driver); si no, se ignora. */
    exposureBoost: 0.5,
    /** 'camara' o 'simulador' (cuerpos sintéticos para probar sin webcam). */
    source: 'camara' as 'camara' | 'simulador',
  },

  camera: {
    /** FOV vertical de la webcam en grados (Logitech C920 ≈ 43°). */
    vfovDeg: 43,
    near: 0.05,
    far: 40,
  },

  pose: {
    /** Ancho del frame que se manda a MediaPipe (§7). */
    inputWidth: 640,
    /** Umbrales de MediaPipe, MUY sensibles: en la sala el fondo es blanco y liso y solo hay dos personas,
     *  así que no hay nada con qué confundirse; lo que cuesta es encontrarlas (caras a contraluz). */
    minDetection: 0.2,
    /** Presencia y rastreo más bajos que la detección: una vez encontrada, MediaPipe no suelta a la persona
     *  aunque los dos cuerpos se junten (con la mano sobre el pecho del otro). */
    minPresence: 0.2,
    minTracking: 0.2,
    /** Máscara de segmentación cada N frames de pose (1 = todos). */
    maskEvery: 2,
    /** Dónde corre MediaPipe. 'GPU' es lo normal; con GPU integrada, si el receptor se congela (pose a
     *  pocos Hz en el HUD de la tecla D), probar 'CPU': deja de competir con el render. */
    delegate: 'GPU' as 'GPU' | 'CPU',
    /** Levantar sombras en la imagen que ve MediaPipe (no el público). Con fondo blanco las personas quedan
     *  a contraluz: se aclara solo lo que no es fondo (más oscuro que `backgroundLuma`) hasta `shadowTarget`
     *  de brillo medio, con una curva gamma que nunca baja de `gammaMin` (más bajo = aclara más). */
    autoGain: true,
    shadowTarget: 0.45,
    gammaMin: 0.35,
    backgroundLuma: 0.72,
  },

  filter: {
    minCutoff2d: 1.2,
    beta2d: 1.5,
    minCutoff3d: 1.0,
    beta3d: 1.2,
    dCutoff: 1.0,
    /** Suavizado (1/s) de la visibilidad por landmark. */
    visibilityRate: 6,
  },

  tracking: {
    maxPeople: 2,
    /** Segundos que se mantiene la última pose sin detección (§7). */
    lostGrace: 1.5,
    /** Distancia máxima (en fracción de imagen) para asociar personas entre frames. */
    matchDist: 0.3,
    /** Ciclo en curso: hasta qué distancia (fracción de imagen) una detección suelta se reconoce como una de
     *  las dos personas amarradas aunque haya saltado. Más lejos se ignora (público que pasa por detrás). */
    recoverDist: 0.5,
    fadeIn: 0.6,
    fadeOut: 0.8,
  },

  retarget: {
    /** Suavizado extra (1/s) del slerp de rotaciones locales. */
    smoothing: 16,
    rootSmoothing: 14,
    depthSmoothing: 5,
    /** Bajo: con la sensibilidad alta, un brazo poco visible igual se mueve. */
    minVisibility: 0.4,
    /** Ajuste de inclinación de la cabeza (ojos-orejas) en grados. */
    headPitchOffsetDeg: 10,
    neckShare: 0.4,
    headMaxDeg: 70,
    torsoTwistMaxDeg: 55,
    shoulderConeDeg: 165,
    hipConeDeg: 115,
    elbowMaxDeg: 150,
    kneeMaxDeg: 150,
    hingeSideFactor: 0.2,
    armTwistMaxDeg: 85,
    legTwistMaxDeg: 35,
    wristConeDeg: 65,
    wristTwistMaxDeg: 70,
    ankleConeDeg: 40,
    scaleMin: 0.8,
    scaleMax: 1.25,
  },

  /** Calibración de la proyección (tecla C). Se guarda aparte. */
  calib: {
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
    bodyScale: 1,
  },

  skin: {
    color: '#8fa6b8',
    fresnelPower: 2.6,
    intensity: 0.42,
    base: 0.004,
    /** Densidad en el centro (grosor atravesado), muy tenue: la placa no queda vacía. */
    fill: 0.035,
    opacity: 1,
  },
  muscle: {
    color: '#7f97ab',
    fresnelPower: 1.7,
    intensity: 0.9,
    base: 0.05,
    opacity: 0.15,
    fiberScale: 140,
    fiberStrength: 0.75,
  },
  organs: {
    color: '#9db2c3',
    fresnelPower: 1.6,
    intensity: 1.3,
    base: 0.06,
    opacity: 0.2,
    lungOpacity: 0.14,
    liverOpacity: 0.3,
    heartOpacity: 0.9,
    /** Fracción del corazón que se ve a través del hueso (densidades sumadas). */
    heartThrough: 0.3,
  },
  heart: {
    bpm: 72,
    /** Contracción ventricular (fracción de escala). */
    contraction: 0.07,
    /** El corazón es el único órgano con rojo (§1.2), muy tenue en vivo. */
    tint: '#b3001b',
    tintAmount: 0.35,
  },
  bone: {
    color: '#dfe7ee',
    roughness: 0.38,
    clearcoat: 0.35,
    envIntensity: 0.4,
    emissive: '#b9c9d6',
    emissiveIntensity: 0.02,
    rimColor: '#dce8f4',
    rimPower: 2.6,
    rimIntensity: 0.5,
    microScale: 220,
    microStrength: 0.008,
  },
  boneGlow: {
    color: '#c6d6e6',
    fresnelPower: 1.4,
    intensity: 0.1,
    base: 0.012,
  },
  cartilage: {
    color: '#9fb4c6',
    opacity: 0.45,
  },

  /** Extracción (§9.5). 'manos': el receptor saca el corazón con la mano (sin cinemática); 'cinematica':
   *  la cinemática X-Ray de planos. Radios en NDC (alto de pantalla = 2), tiempos en s. */
  extraction: {
    mode: 'manos',
    /** Qué tan cerca del corazón tiene que estar la mano (cualquier parte, de la muñeca a los dedos) y
     *  cuánto mantenerla para tomarlo: casi nada, se toma apenas la mano lo toca. El anillo marca la zona. */
    grabRadius: 0.2,
    grabDwell: 0.1,
    /** Para metérselo: qué tan cerca del propio pecho y cuánto mantenerlo ahí (otro anillo). */
    deliverRadius: 0.2,
    deliverDwell: 0.3,
    /** Suavizado del corazón detrás de la mano (1/s). */
    follow: 10,
    /** Distancia (m, escala del cuerpo) a la que se rompe cada vaso: pulmonar, cava superior, cava inferior, aorta. */
    snapAt: [0.05, 0.09, 0.13, 0.18],
    /** Si nadie lo toma en este tiempo (o en modo solo), lo saca el sistema; recorrido automático. */
    autoAfter: 30,
    autoTime: 3.2,
    /** Si lo tiene pero no lo entrega, el sistema lo termina de llevar. */
    deliverAfter: 45,
    /** Después de entrar, cuánto queda antes de la ausencia. */
    afterDelivery: 2.2,
    /** El mouse hace de mano del receptor (para probar sin dos personas). */
    debugMouse: false,
  },

  /** Marco de placa radiográfica: borde de colimación (vh), esquinas, marcador de plomo y datos. */
  film: {
    enabled: true,
    border: 2.6,
    radius: 2.2,
    soft: 2.4,
    color: '#93a2ad',
    opacity: 0.85,
    marker: 'R',
    info: true,
  },

  /** Fluoroscopia (§6): la radiografía que se mueve en tiempo real. Reemplaza al marco de placa: campo
   *  redondo del intensificador, moteado cuántico, persistencia, rejilla y datos del equipo en pantalla.
   *  Apagada, la obra vuelve al marco de placa (`film`). */
  fluoro: {
    enabled: true,
    /** Campo del intensificador: radio en medias alturas de la imagen (1 = toca arriba y abajo) y borde. */
    irisRadius: 1.7,
    irisSoft: 0.012,
    /** Caída de brillo hacia el borde del campo. */
    falloff: 0.3,
    /** Distorsión en cojín del intensificador. */
    distortion: 0.035,
    /** Persistencia (s): lo que se mueve deja estela y el ruido se promedia (filtro recursivo). */
    lag: 0.07,
    /** Imágenes por segundo de la fluoroscopia pulsada (0 = continua; 7,5 o 15 se ven a saltos, como en un equipo real). */
    pulseFps: 0,
    /** Moteado cuántico: intensidad y tamaño del grano (px). */
    noise: 0.14,
    noiseSize: 1.5,
    /** Velo del intensificador: los negros del campo quedan gris oscuro. */
    veil: 0.03,
    /** Realce de bordes del procesado digital: cantidad y radio (px). */
    sharpen: 0.6,
    sharpenRadius: 2.5,
    /** Rejilla antidispersión: líneas verticales finas (intensidad y período en px). */
    grid: 0.03,
    gridPeriod: 3,
    /** Bloom dentro de la fluoroscopia (fracción del normal): el hueso pesa, no brilla. */
    bloom: 0,
    /** Datos del equipo en las esquinas (kV, mA, tiempo de fluoroscopia, dosis) y regla en cm. Apagados en
     *  la exposición: al público le sobran; la guía y el contador son lo único escrito que importa. */
    hud: false,
    ruler: false,
    /** Dosis acumulada por segundo de haz y por cuerpo frente al equipo (mGy/s). */
    doseRate: 0.021,
  },

  /** Textos: escala de todas las etiquetas (se leen desde el fondo de la sala). */
  labels: {
    scale: 2.4,
  },

  /** Roles (§9.3). 'posicion': el círculo del piso decide. Quien se para del lado `donorSide` (izquierda o
   *  derecha de la sala, mirando la pantalla) es el PROVEEDOR (donante, el cerdo); el otro, el DESTINATARIO
   *  (receptor). 'azar': el algoritmo sortea. */
  roles: {
    mode: 'posicion' as 'posicion' | 'azar',
    donorSide: 'izquierda' as 'izquierda' | 'derecha',
  },

  /** Guía para el público que no conoce la obra: una o dos líneas muy grandes arriba al centro.
   *  Se editan aquí o en G → Guía (\n = salto de línea). */
  guide: {
    enabled: true,
    /** Brillo de la escena mientras se espera a las dos personas (0..1). */
    waitDim: 0.45,
    /** Cuánto se muestra "personas reconocidas" antes de empezar (s). */
    recognizedHold: 1.6,
    // Registro de etiqueta comercial: el órgano como producto (pedido, lote, entrega), no una explicación.
    esperaCero: 'SE REQUIEREN DOS CUERPOS\nPÁRENSE EN LOS CÍRCULOS DEL PISO',
    esperaUna: '1 CUERPO REGISTRADO\nFALTA 1',
    /** Con roles por posición: con una sola persona, la guía nombra el círculo que falta ocupar. */
    faltaDestinatario: 'PROVEEDOR REGISTRADO\nFALTA EL DESTINATARIO',
    faltaProveedor: 'DESTINATARIO REGISTRADO\nFALTA EL PROVEEDOR',
    reconocidas: '2 CUERPOS REGISTRADOS',
    placa: 'CONTROL DE CALIDAD\nMUÉVANSE PARA EL ESCANEO',
    asignacion: 'ASIGNANDO PROVEEDOR\nY DESTINATARIO',
    genes: 'PRODUCTO EDITADO\n4 GENES RETIRADOS · 6 GENES HUMANOS',
    huesos: 'ORIGEN: SUS SCROFA DOMESTICUS\nAPTO PARA USO HUMANO',
    tomar: 'DESTINATARIO: RETIRE SU PEDIDO\nMANTENGA LA MANO SOBRE EL CORAZÓN',
    llevar: 'ENTREGA EN MANO\nLLÉVELO A SU PECHO Y MANTÉNGALO AHÍ',
    auto: 'ENVÍO AUTOMÁTICO EN CURSO',
    trasplante: 'PEDIDO ENTREGADO\nSIN DEVOLUCIONES',
    ausencia: 'PROVEEDOR: DESCARTE\nDESTINATARIO: CONFORME',
    borrado: 'LIMPIEZA DEL ÁREA',
    fin: 'STOCK: +7000 EN ESPERA\nGRACIAS POR SU COMPRA',
    /** Etiqueta que acompaña al corazón mientras viaja ({n} = número de lote). */
    tag: 'CORAZÓN · LOTE {n}\nORIGEN: SUS SCROFA DOMESTICUS',
  },

  /** Placa real: los cuerpos se dibujan como una radiografía de verdad (densidad, no luz). El hueso suma
   *  densidad: la cortical pesa más de canto y las superposiciones se suman; el tejido blando es gris por
   *  espesor (más claro en el centro del cuerpo). Sin brillo especular, sin bloom, con grano de película.
   *  En los primeros planos de la cinemática (con letterbox) vuelve el aspecto 3D. */
  plate: {
    enabled: true,
    color: '#dce5ec',
    /** Densidad de la cortical (camino por la cáscara: crece de canto) y del interior del hueso. */
    shell: 0.07,
    fill: 0.16,
    /** Tope del camino de canto (evita bordes que saturan). */
    edgeClamp: 0.2,
    skinFill: 0.12,
    skinEdge: 0.09,
    muscleFill: 0.08,
    organFill: 0.08,
    bloom: 0.25,
    grain: 1.35,
  },

  /** Cara del cerdo en tejido blando (§9.4): hocico con disco y fosas nasales, orejas, cachetes. Es lo que
   *  hace que el público vea un cerdo a simple vista. Densidad por metro de carne atravesada y contorno. */
  pigFace: {
    enabled: true,
    color: '#a9bccb',
    density: 1.5,
    edge: 0.28,
  },

  softTissue: {
    enabled: true,
    color: '#5f7486',
    opacity: 0.18,
    edge: 0.4,
    blur: 2.5,
  },

  /** Cámara difuminada (§6): la imagen real de la webcam, desenfocada y en gris frío, detrás del
   *  cuerpo 3D. Aparece con los visitantes y se apaga en los primeros planos de la cinemática.
   *  En gris para que el rojo siga siendo solo de la sangre (§1.2). Nunca se guarda (§1.10). */
  cameraBlur: {
    enabled: true,
    opacity: 0.3,
    /** Ancho de la imagen reducida (px): más chico, más difuso. */
    width: 192,
    /** Desenfoque sobre la imagen reducida (px). */
    blur: 4,
    tint: '#8fa6b8',
    contrast: 1.3,
    /** Levanta las sombras: con la sala oscura la webcam ve poco. */
    gain: 1.5,
  },

  lighting: {
    envIntensity: 0.18,
    keyColor: '#e9f1ff',
    keyIntensity: 2.4,
    rimColor: '#9cc4ff',
    rimIntensity: 3.0,
    fillColor: '#6f87a3',
    fillIntensity: 0.12,
  },

  post: {
    exposure: 1.0,
    bloomIntensity: 0.6,
    bloomThreshold: 0.8,
    bloomSmoothing: 0.25,
    bloomRadius: 0.6,
    aoRadius: 0.06,
    aoDistanceFalloff: 0.6,
    aoIntensity: 4.5,
    chromaticAberration: 0.0009,
    vignetteOffset: 0.28,
    vignetteDarkness: 0.62,
    grainIntensity: 0.085,
    grainSize: 1.4,
    /** Desaturación global (el rojo se protege con máscara, §14). */
    desaturation: 0.55,
    tint: '#9fb3c6',
    tintAmount: 0.6,
  },

  /** Tiempos de la máquina de estados (§8, §9), en segundos reales. */
  show: {
    esperaStable: 1.5,
    placaMin: 6,
    placaPair: 6,
    placaSolo: 15,
    asignacion: 3,
    transformacion: 10,
    extraccion: 14,
    ausencia: 24.9,
    /** Separación del receptor virtual del modo solo (m). */
    soloOffset: 1.15,
    /** Texto de la lista de espera (modo solo). */
    soloWaitlist: 'PERÚ: +7000 EN ESPERA',
  },

  /** Metamorfosis humano → cerdo (§9.4, §10.1). Tiempos en s reales relativos al hit-stop de cada hueso. */
  transform: {
    crackDelay: 0.06,
    crackTime: 0.2,
    growDelay: 0.18,
    growTime: 0.34,
    skullGrowTime: 0.6,
    /** Hocico: largo inicial (fracción), sobrepaso y duración del estiramiento. */
    snoutStart: 0.3,
    snoutOvershoot: 1.12,
    snoutTime: 0.95,
    /** Morph de la piel hacia proporciones porcinas: cara (con el cráneo) y tórax (con las costillas). */
    morphHead: 1,
    morphBody: 1,
    morphTime: 0.8,
    /** Fragmentos físicos (Rapier). Velocidades en m/s, giro en rad/s, vida en s de juego. */
    fragmentSpeed: 1.1,
    fragmentLift: 0.7,
    fragmentSpin: 9,
    fragmentLife: 1.8,
    gravity: 9.81,
    /** Multiplicadores de astillas y polvo óseo por hueso. */
    splinters: 1,
    dust: 1,
    splinterSpeed: 2.2,
    /** Sacudida de cámara (px a 1080p) por hueso y en el cráneo; caída (1/s) y frecuencia (Hz). */
    shakePx: 4,
    skullShakePx: 6.5,
    shakeDecay: 7,
    shakeFreq: 21,
    marrowColor: '#4a070c',
    marrowGlow: '#8a0d16',
    /** Puntos de luz de la edición genética dentro del corazón (§9.4 A). */
    geneCool: '#8fcaff',
    geneWarm: '#ffd9a0',
    geneSize: 0.075,
    geneIntensity: 4.5,
    geneTravel: 0.75,
  },

  /** Sangre (§10.2–10.4). Distancias en m, tiempos en s de juego, caudales en partículas/s (HIGH). */
  blood: {
    particleRadius: 0.0055,
    gravity: 9.81,
    drag: 0.35,
    /** Cohesión hacia el centro de masa de la celda y mezcla de velocidades (viscosidad). */
    cohesion: 2,
    viscosity: 5,
    /** Frenado tangencial sobre los huesos (se pega y resbala) y en el piso. */
    stick: 7,
    floorFriction: 6,
    /** SSFR: radio del filtro y rango (× radio de partícula), escala del grosor, refracción. */
    smoothing: 3.4,
    smoothingRange: 3,
    thickness: 1,
    /** Curvatura de los bordes según el gradiente del grosor. */
    edgeBend: 1.6,
    /** Río plano (placa real): velocidad del frente (m/s), ancho (m, escala del cuerpo) y cuánto alimenta el charco. */
    riverSpeed: 0.45,
    riverWidth: 0.032,
    riverFeed: 0.35,
    /** Estiramiento de cada gota según su velocidad (por m/s) y máximo (× radio). */
    stretch: 0.55,
    stretchMax: 3,
    /** Desenfoque del grosor que define la silueta (× radio de partícula). */
    edgeSmooth: 2,
    refraction: 1,
    thinColor: '#b3001b',
    thickColor: '#4a0000',
    /** Absorción Beer-Lambert por canal (1/m): el rojo atraviesa, el verde y el azul no. */
    absorbR: 380,
    absorbG: 2600,
    absorbB: 2400,
    roughness: 0.08,
    specular: 2,
    envReflection: 3,
    decalColor: '#5a0008',
    clotColor: '#1c0204',
    /** Segundos hasta coagular del todo (manchas y charco). */
    clotTime: 18,
    puddleGrowth: 1.6,
    puddleMax: 3.4,
    /** Intensidad del reflejo de la escena en el charco. */
    puddleReflect: 2.5,
    lensTintR: 0.62,
    lensTintG: 0.02,
    lensTintB: 0.03,
    /** Desenfoque del borde de las gotas en la lente (× radio): la lente está fuera de foco. */
    lensSoft: 0.14,
    /** Brillo de las gotas en la lente: una media luna suave, nunca un punto blanco. */
    lensSpec: 0.3,
    /** Caudales de la extracción y la ausencia. */
    ribBurst: 2600,
    gush: 1300,
    arterial: 2600,
    heartDrip: 90,
    cavityDrip: 160,
    benchRate: 2200,
  },

  /** Cinemática X-Ray en tiempo real (§9.5, §12). */
  cinematic: {
    /** Curva de timeScale: "t:valor, …" (Hermite monótona, t en s reales del estado). */
    timeCurve: '0:1, 0.6:0.25, 1.8:0.25, 1.95:0.15, 2.4:0.15, 4:0.3, 5.5:0.2, 7.5:0.2, 8.5:0.35, 11:0.6, 12.5:1',
    bokeh: 2.2,
    focusRangeScale: 1,
    /** Corazón: tirón inicial y salto con cada vaso que se rompe (m, escala del cuerpo). */
    pullStart: 0.05,
    pullPerBreak: 0.035,
    /** Vasos (verlet): rigidez, amortiguación, gravedad y retroceso al romperse. */
    vesselStiffness: 0.55,
    vesselDamping: 0.985,
    vesselGravity: 2.5,
    /** Ya cortado, cada tramo no se estira más que esto (× reposo): no quedan tubos colgando. */
    vesselMaxStretch: 1.6,
    /** Costillas: velocidad y giro de los fragmentos del frente del tórax. */
    ribSpeed: 1.3,
    ribSpin: 7,
    /** Diafragma de luz del receptor: apertura (m) y brillo. */
    receptorOpen: 0.032,
    receptorGlow: 3.2,
    /** Exposición, bloom y tamaño de los destellos genéticos en los planos de la cinemática. */
    exposure: 0.72,
    bloom: 0.55,
    geneScale: 0.3,
    fleshColor: '#5a0710',
    fleshClean: '#a24a55',
    vesselColor: '#6e0e18',
  },

  /** Mezcla (§13): niveles de los buses y envíos a la reverberación de sala. */
  audio: {
    ambience: 0.8,
    interface: 0.7,
    effects: 1,
    heart: 0.9,
    reverb: 0.9,
    reverbFx: 0.35,
    reverbUi: 0.12,
    reverbHeart: 0.1,
    /** Latido humano del receptor antes del trasplante (asignación y transformación). Después, de su
     *  lado suena el corazón del cerdo, con otro timbre: se oye que el corazón es de otro. */
    heartOwn: 0.3,
    /** Monitor de pulso del donante: tono a SpO2 99 % (Hz) y cuántos semitonos baja por cada punto que
     *  cae la saturación (como un oxímetro real: se oye que se está yendo). */
    spo2Base: 940,
    spo2Semitones: 0.7,
    monitor: 1,
    /** Respirador del cerdo anestesiado (§1.5): nivel y respiraciones por minuto. */
    ventilator: 0.8,
    ventRate: 14,
    /** Alarma médica de prioridad alta cuando el corazón sale (patrón de 10 pulsos). */
    alarm: 0.7,
    /** Equipo de rayos X: el ánodo que gira y el pitido de exposición en cada barrido. */
    xray: 0.8,
  },

  /** Ausencia (§9.6): la mirada del cerdo y la sombra con hocico (s desde que empieza la ausencia). */
  absence: {
    /** El cráneo congelado gira de perfil: un ojo al público, el hocico hacia el receptor (Berger). */
    lookAt: 2,
    lookTime: 3.2,
    /** 0 = hocico hacia el receptor; 1 = hacia el público. */
    lookToPublic: 0.2,
    /** La sombra real del donante (cámara difuminada) gana cabeza de cerdo. */
    shadowAt: 3,
    shadowTime: 4,
    /** Tamaño de la cabeza de cerdo respecto de la cabeza del visitante. */
    shadowScale: 1.5,
    /** Intensidad y desenfoque (px) de la cabeza de cerdo en la sombra. */
    shadowOpacity: 0.28,
    shadowBlur: 3,
    /** El telos (Rollin): mientras se disuelve, el cerdo deja la postura humana y queda en cuatro patas,
     *  de perfil hacia donde mira. Inclinación del tronco (°). */
    telosAt: 19.8,
    telosTime: 3.2,
    telosPitchDeg: 88,
  },

  /** Borrado (§9.6): desaturación y 3 barridos de trapeador (s desde que empieza). */
  erase: {
    desatTime: 1.2,
    sweep1: 0.9,
    sweep2: 2.5,
    sweep3: 4.1,
    sweepTime: 1.75,
  },

  capture: {
    /** Multiplicador de resolución para la captura P. */
    scale: 2,
  },

  simulator: {
    people: 2,
    distance: 3.0,
    /** Ruido de landmarks (m) para imitar el temblor de MediaPipe. */
    noise: 0.006,
  },

  debug: {
    landmarks: true,
    armature: true,
    /** Fase 2: ver el esqueleto de cerdo sobre el cuerpo en vivo (misma armadura). */
    pigSkeleton: false,
    /** Visor de assets del pipeline: 'ninguno' | 'corazon' | 'costillas'. */
    assetViewer: 'ninguno' as 'ninguno' | 'corazon' | 'costillas',
    /** Fase 5: chorro de sangre continuo frente a la cámara sobre un "hueso" de prueba. */
    bloodTest: false,
    /** Vista intermedia del SSFR: 'ninguna' | 'profundidad' | 'normales' | 'grosor'. */
    bloodView: 'ninguna' as 'ninguna' | 'profundidad' | 'normales' | 'grosor',
  },
};

export type Config = typeof config;

const CONFIG_KEY = 'donante.config.v1';
const CALIB_KEY = 'donante.calib.v1';

/** Mezcla un objeto guardado sobre el config respetando solo claves y tipos conocidos.
 *  Modifica en el lugar (los controles de lil-gui conservan sus referencias). */
export function mergeInto(target: Record<string, unknown>, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (!(k in target)) continue;
    const cur = target[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) mergeInto(cur as Record<string, unknown>, v);
    else if (typeof cur === typeof v) target[k] = v;
  }
}

export function loadConfig(): void {
  mergeInto(config as unknown as Record<string, unknown>, loadJSON(CONFIG_KEY));
  mergeInto(config.calib as unknown as Record<string, unknown>, loadJSON(CALIB_KEY));
}

export function saveConfig(): void {
  saveJSON(CONFIG_KEY, config);
}

export function saveCalibration(): void {
  saveJSON(CALIB_KEY, config.calib);
}

/** Valores de fábrica (copia profunda tomada al importar el módulo, antes de cargar lo guardado). */
export const defaults: Config = JSON.parse(JSON.stringify(config));

/** Vuelve a los valores de fábrica conservando la calibración de la sala. */
export function resetConfig(): void {
  const calib = { ...config.calib };
  mergeInto(config as unknown as Record<string, unknown>, JSON.parse(JSON.stringify(defaults)));
  Object.assign(config.calib, calib);
}
