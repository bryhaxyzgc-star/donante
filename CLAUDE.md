# DONANTE N.º ____ — Superprompt de implementación (Claude Code)

> **Cómo usar este archivo**
> 1. Crea una carpeta `donante/`, guarda este archivo dentro como **`CLAUDE.md`** y abre Claude Code ahí. Claude Code lo lee solo en cada sesión.
> 2. Pide **una fase a la vez** (§17): *"Lee CLAUDE.md y ejecuta la Fase 1 completa"*. Al final de cada fase, Claude Code debe mostrarte cómo probarla.
> 3. No pases a la siguiente fase sin cumplir sus **criterios de aceptación** y la **barra de calidad** (§18).
> 4. Este archivo es la fuente de verdad: si cambian algo, cámbienlo aquí primero.

---

## 0. La obra en una línea

Instalación interactiva a escala humana sobre el **xenotrasplante**. Dos visitantes se paran frente a una proyección y se ven como **cuerpos anatómicos 3D realistas en rayos X**. Uno, el que se para en el círculo del piso marcado **PROVEEDOR**, es convertido en **cerdo donante**; el otro, en el círculo **DESTINATARIO**, es el receptor. Su pecho se abre y **el otro visitante le saca el corazón con sus propias manos** (la cámara sigue su mano): los vasos se rompen, la sangre (plana) se derrama del lado del cerdo, y el corazón entra **limpio** en el pecho de quien lo tomó. Al final, el cerdo queda solo, la sangre se borra y un contador suma un donante más.

**Referencia de imagen:** las placas reales de rayos X y *Primary Intimacy of Being* (Ikse Maître, 2013), un espejo que muestra al visitante con imágenes médicas reales. La obra tiene que verse como una radiografía de verdad, no como un videojuego (modo **placa real**, §6).
La antigua cinemática X-Ray (lenguaje visual de los X-Ray de videojuegos de pelea) queda solo como modo alternativo (`extraction.mode = 'cinematica'`, §9.5). Prohibido usar assets, logos, tipografías, audios, personajes o textos de cualquier juego (§5.4).

---

## 1. Reglas de la obra (no negociables)

El realismo y el gore están al servicio de estas reglas. Si una escena es espectacular pero rompe una regla, está mal.

1. **Realismo de imagen médica.** Anatomía correcta, y los cuerpos se dibujan como una placa de rayos X real: densidad, no luz (sin brillo especular ni bloom), dentro del campo redondo de una fluoroscopia (por defecto) o de un marco de placa. Nada de cartoon, low-poly plano, UI de videojuego, barras de vida, rounds, "FIGHT", "FATALITY" ni textos celebratorios.
2. **Paleta:** todo es rayos X frío (azul-gris, blanco hueso). **El rojo es el único color** y aparece solo en sangre, carne expuesta y corazón.
3. **Asimetría:** toda la sangre y la violencia están del lado del **donante (cerdo)**. El corazón entra **limpio** en el **receptor**, que nunca se ensucia.
4. **Xenotrasplante siempre visible.** El donante es un cerdo **editado con genes humanos** (§9.4): 4 genes porcinos eliminados (`GGTA1`, `CMAH`, `B4GALNT2`, `GHR`) y 6 humanos insertados (`CD46`, `CD55`, `THBD`, `EPCR`, `CD47`, `HO-1`). El esqueleto de cerdo se monta en **postura humana** (inquietante, como Piccinini).
5. **Inmovilidad del cerdo.** Tras la transformación, el esqueleto del cerdo **deja de seguir al visitante**: queda congelado, como un animal criado en confinamiento y anestesiado.
6. **El borrado.** Al final, la sangre se desatura y se limpia hasta no dejar ningún píxel rojo. El sistema borra la huella.
7. **Registro desigual.** Antes del borrado: `RECEPTOR ... sobrevida: registrada` / `DONANTE N.º 0348 ... vida: no registrada`.
8. **Sin música.** Solo diseño sonoro (§13).
9. **Offline.** Nada se descarga en tiempo de ejecución.
10. **Privacidad.** No se guardan imágenes ni video de los visitantes, solo capturas manuales del operador (tecla `P`).

---

## 2. Hardware objetivo

- **Laptop con GPU dedicada** (NVIDIA RTX 3050 o superior, o equivalente). Con GPU integrada solo corre el preset `LOW`.
- Webcam 1080p (mejor externa, centrada bajo la proyección).
- Proyector ≥ 3000 lúmenes, imagen de ~2,5 m de ancho, sala oscura.
- Parlantes estéreo con buen grave (o un subwoofer pequeño): el sonido es la mitad del realismo.
- Chrome actualizado, con aceleración por hardware activada.

---

## 3. Stack

| Capa | Tecnología |
|---|---|
| Lenguaje y bundler | **TypeScript + Vite** |
| Motor 3D | **Three.js** (versión estable actual, `WebGLRenderer`, WebGL2) |
| Postproceso | **`postprocessing`** (pmndrs) + **`n8ao`** (oclusión ambiental) |
| Visión e IA | **`@mediapipe/tasks-vision`** → `PoseLandmarker` (`pose_landmarker_heavy.task` en `ULTRA`/`HIGH`, `full` en `MED`/`LOW`), `runningMode:'VIDEO'`, `numPoses:2`, `outputSegmentationMasks:true`, `delegate:'GPU'`. Usar **`poseWorldLandmarks`** (3D métrico) para rotaciones y `poseLandmarks` (2D) para ubicar en pantalla. |
| Física | **`@dimforge/rapier3d-compat`** para fragmentos de costilla, astillas y el corazón al ser arrancado |
| Simulación de sangre | Partículas en GPU con `GPUComputationRenderer` (ejemplos de Three.js) + **renderizado de fluido en espacio de pantalla** (§10.2) |
| Cinemática premium | **Blender 4.x** (Cycles + Mantaflow + Cell Fracture), controlado con scripts `bpy` en modo headless (§11) |
| Animación | `@tweenjs/tween.js` + curvas de tiempo propias |
| Audio | Web Audio API (`ConvolverNode` para reverberación de sala clínica) |
| Debug | `lil-gui` (panel de ajustes en vivo) + `stats.js` |

Los `.wasm` de MediaPipe y Rapier se copian a `public/` en `postinstall`. Ninguna llamada a CDN.

---

## 4. Arquitectura

```
donante/
├── CLAUDE.md
├── CREDITS.md                 # cada asset: autor, URL, licencia
├── TODO-ASSETS.md             # assets faltantes (placeholders activos)
├── package.json  vite.config.ts  tsconfig.json  index.html
├── blender/
│   ├── source/                # .blend fuente (no se sirven)
│   └── scripts/
│       ├── 01_import_anatomy.py     # importa Z-Anatomy/BodyParts3D, limpia, nombra
│       ├── 02_rig_human.py          # armadura humanoide + parentado rígido hueso→bone
│       ├── 03_rig_pig.py            # esqueleto de cerdo en la MISMA armadura humana
│       ├── 04_fracture_ribs.py      # Cell Fracture de costillas (cerdo) → piezas
│       ├── 05_heart_vessels.py      # corazón + aorta/venas como cadenas
│       ├── 06_export_glb.py         # exporta GLB con Draco + KTX2
│       └── 07_cinematic_render.py   # escena de la cinemática (Cycles + Mantaflow)
├── public/
│   ├── mediapipe/  rapier/  models/  textures/  hdri/  audio/  video/  fonts/
├── src/
│   ├── main.ts                 # arranque, loop, máquina de estados
│   ├── config.ts               # TODO valor ajustable (§16)
│   ├── quality.ts              # presets LOW / MED / HIGH / ULTRA
│   ├── input/
│   │   ├── webcam.ts
│   │   ├── pose.ts             # MediaPipe
│   │   ├── people.ts           # identidad estable entre frames
│   │   ├── oneEuro.ts
│   │   └── retarget.ts         # landmarks 3D → rotaciones de la armadura
│   ├── render/
│   │   ├── stage.ts            # renderer, cámaras, escenas, composer
│   │   ├── lighting.ts         # HDRI + luces de quirófano
│   │   ├── materials/
│   │   │   ├── xraySkin.ts     # piel translúcida con fresnel
│   │   │   ├── xrayMuscle.ts
│   │   │   ├── bone.ts         # hueso PBR + grietas progresivas
│   │   │   ├── flesh.ts        # carne húmeda (cinemática)
│   │   │   └── heart.ts        # corazón con bloodAmount
│   │   ├── body.ts             # cuerpo anatómico por persona (capas)
│   │   ├── morph.ts            # humano → cerdo
│   │   ├── fracture.ts         # grietas + fragmentos físicos
│   │   ├── vessels.ts          # vasos como cuerdas verlet que se estiran y rompen
│   │   ├── blood/
│   │   │   ├── sim.ts          # partículas GPU
│   │   │   ├── ssfr.ts         # screen-space fluid rendering
│   │   │   ├── decals.ts       # manchas sobre huesos y suelo
│   │   │   └── lens.ts         # sangre en la "lente"
│   │   ├── cinematic.ts        # rig de cámara, cortes, hit-stop, slow-mo
│   │   ├── erase.ts            # borrado final
│   │   ├── labels.ts           # textos clínicos
│   │   └── post.ts             # cadena de postproceso
│   ├── states/  espera.ts  placa.ts  asignacion.ts  transformacion.ts
│   │            extraccion.ts  ausencia.ts
│   ├── audio/   engine.ts  cues.ts
│   ├── counter.ts
│   └── debug.ts
```

---

## 5. Pipeline de assets 3D (Blender, automatizado con `bpy`)

Claude Code escribe los scripts de `blender/scripts/` y los ejecuta con:
`blender -b blender/source/base.blend -P blender/scripts/0X_*.py`

### 5.1 Humano anatómico (por capas)
- **Esqueleto, músculos y órganos:** **Z-Anatomy** (CC BY-SA 4.0) o **BodyParts3D** (CC BY-SA 2.1 JP). Importar esqueleto completo, musculatura superficial, corazón, pulmones e hígado.
- **Piel:** cuerpo humano neutro generado en **MakeHuman** (las exportaciones son CC0), sin rasgos de persona real, ya riggeado.
- **Rig:** una sola armadura humanoide con nombres tipo Mixamo (`Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, … y el lado derecho).
  - **Huesos anatómicos:** *parentado rígido* (cada malla de hueso hija de un solo bone; sin pesos de skinning → cero deformaciones raras).
  - **Piel y músculo:** skinning con pesos automáticos y limpieza en codos y hombros.
- **Optimización:** decimar a ~150k triángulos en total para el cuerpo vivo (`HIGH`), Draco + texturas KTX2.

### 5.2 Cerdo en postura humana
- Esqueleto de cerdo (*Sus scrofa domesticus*) desde Sketchfab, filtrando por licencia CC y descargable.
- Script `03_rig_pig.py`: separar cráneo, columna, caja torácica (**14–15 pares de costillas**), escápulas, pelvis y huesos de las extremidades, y **parentarlos a la MISMA armadura humana**, escalados para que calcen. Resultado: un cerdo de pie con la postura del visitante.
- Para cada hueso humano, un **par cerdo** con el mismo nombre de slot (`skull_human` ↔ `skull_pig`, etc.) para el morph (§9.4).

### 5.3 Gore preparado
- **Costillas del cerdo:** `Cell Fracture` (8–15 piezas por costilla, con astillas finas) → GLB con piezas separadas y caras internas con material de médula.
- **Corazón:** malla de alta calidad con normal maps, más **aorta, arteria pulmonar y venas cavas** como tubos con huesos en cadena (para estirarse y romperse en `vessels.ts`).
- **Texturas:** ambientCG / Poly Haven (CC0) para hueso, carne húmeda y normal maps de tejido. HDRI de interior clínico de **Poly Haven** (CC0).

### 5.4 Licencias
Todo en `CREDITS.md`. Solo CC0, CC BY, CC BY-SA, OFL o material propio. **Prohibido** cualquier asset de juegos comerciales.

---

## 6. Render del cuerpo vivo (modo "radiografía 3D")

Cada persona detectada tiene un `BodyRig` con 4 capas sobre la misma armadura:

| Capa | Material | Aspecto |
|---|---|---|
| Piel | `xraySkin`: fresnel (borde brillante, centro casi invisible), azul-gris `#8fa6b8`, `depthWrite:false`, blending aditivo | Silueta translúcida como placa radiográfica |
| Músculo | `xrayMuscle`: fresnel más débil, fibras sugeridas por normal map, opacidad 0,15 | Volumen fantasma |
| Órganos | Translúcidos, opacidad 0,2; **el corazón late** (72 lpm, deformación por shape key o escala no uniforme) | Se intuye el latido |
| Huesos | `bone`: blanco `#e8eef2`, emisivo leve, rim light fuerte; superposiciones más brillantes | La capa protagonista |

- **Placa real (por defecto, `config.plate`):** el hueso suma densidad en vez de reflejar luz (la cortical pesa más de canto, las superposiciones se suman, las grietas son líneas oscuras de fractura); piel, músculo y órganos son grises por espesor; sin bloom ni oclusión ambiental, con grano de película. El corazón y la sangre son planos y rojos.
- **Fluoroscopia (por defecto, `config.fluoro`, `src/render/fluoro.ts`):** una radiografía que se mueve en tiempo real es una fluoroscopia, y así se ve. Tiene:
  - el campo redondo del intensificador de imagen, con caída de brillo hacia el borde y distorsión en cojín;
  - moteado cuántico (ruido gris que hierve, proporcional a √señal) y velo gris en los negros del campo;
  - persistencia: lo que se mueve deja estela, como en el filtro recursivo de un equipo real;
  - realce de bordes, líneas finas de la rejilla antidispersión y modo pulsado opcional (`pulseFps`).

  En las esquinas de abajo, fuera del campo (arriba va la guía), van los datos del equipo (`src/render/fluoroHud.ts`): haz encendido (● RX), kV y mA con exposición automática, ventana y nivel, n.º de estudio, tiempo de fluoroscopia y dosis acumulada (vuelven a cero con cada donante), fecha y hora. A la derecha, una regla en cm calibrada a la distancia de los cuerpos. Todo en gris: no agrega color (§1.2). Se aparta en los primeros planos de la cinemática y, apagada, vuelve el marco de placa.
- **Marco de placa (`config.film`, si `fluoro.enabled` es falso):** borde claro de colimación con penumbra, esquinas redondeadas, muescas de la película, marcador de plomo "R" y datos impresos (placa, kV, mAs, fecha y hora). Es un overlay DOM sin espejar.
- **Textos grandes (`config.labels.scale`):** todas las etiquetas escalan con el alto de la imagen, para leerlas desde el fondo de la sala.
- **Alineación con el visitante:** cámara de perspectiva calibrada (FOV ≈ el de la webcam). Ubicar `Hips` en la proyección 2D del centro de caderas; escala por distancia entre hombros en píxeles; profundidad estimada con esa escala.
- **Máscara de segmentación** como capa extra de "tejido blando" difuso detrás del 3D, para que el contorno real del visitante también se vea.
- **Cámara difuminada** detrás de todo: la imagen de la webcam reducida y desenfocada, solo en luminancia y teñida de azul-gris (nunca a color: el rojo es solo de la sangre, §1.2). Aparece con los visitantes y se apaga en los primeros planos de la cinemática. No se guarda (§1.10).
- **Fondo:** negro `#05070a` con grano de película fino.

---

## 7. Tracking y retargeting (IA)

- Webcam a 1280×720 o 1920×1080, en **espejo**. MediaPipe a ~640 px de ancho.
- `detectForVideo` una vez por frame nuevo (`requestVideoFrameCallback`).
- **One Euro** por landmark (2D y 3D).
- **Retargeting propio** (`retarget.ts`): para cada bone, dirección padre→hijo a partir de `poseWorldLandmarks` → `Quaternion.setFromUnitVectors(restDir, currentDir)` en el espacio local del padre.
  - Torso: base ortonormal desde hombros (11/12) y caderas (23/24).
  - Cabeza: desde nariz (0) y orejas (7/8).
  - **Límites anatómicos** por articulación (clamp de ángulos) para que codos y rodillas no se doblen al revés.
  - Slerp de suavizado adicional (factor en config).
- **Identidad:** asociar personas entre frames por el centro de caderas (greedy por distancia). El rol queda pegado a la identidad, no al lado de la pantalla.
- **Fondo blanco (la sala):** solo hay dos personas sobre un fondo blanco liso, así que la detección es muy sensible (`pose.minDetection`/`minPresence`/`minTracking` = 0,2). Con fondo blanco la webcam se cierra y las personas quedan a contraluz, y el detector de MediaPipe se ancla en la cara. Por eso hay dos correcciones: se pide más exposición a la webcam (`webcam.exposureBoost`, si el driver lo permite) y se **levantan las sombras** de la imagen que ve MediaPipe con una curva gamma calculada solo con lo que no es fondo (`pose.autoGain`, `shadowTarget`, `gammaMin`, `backgroundLuma`). El público nunca ve esa imagen.
- **Amarre durante el ciclo:** desde la asignación de roles hasta la vuelta a la espera, las dos personas quedan amarradas (`PeopleTracker.lock`). No se borran ni se crean personas nuevas: si MediaPipe pierde a una (pasa cuando el receptor pone la mano sobre el pecho del cerdo y los cuerpos se juntan), su cuerpo espera con la última pose, y la próxima detección a menos de `tracking.recoverDist` vuelve a ser ella. Un desconocido lejos no se lleva la identidad.
- **Pérdida de tracking:** mantener la última pose `tracking.lostGrace` (1,5 s). Un corte más breve no borra el tiempo estable acumulado: la obra arranca sola aunque la detección parpadee.
- **Más de 2 personas:** quedarse con las 2 de mayor área de máscara.

---

## 8. Máquina de estados

```
ESPERA → PLACA → ASIGNACIÓN → TRANSFORMACIÓN → EXTRACCIÓN (cinemática) → AUSENCIA → ESPERA
```
Cada estado tiene `enter() / update(dt) / exit()`. El `dt` pasa por un **reloj de juego** con `timeScale` (hit-stop y cámara lenta) y un **reloj real** aparte (latido y UI).

---

## 9. Secuencia detallada

### 9.1 ESPERA
La placa medio oscura (`guide.waitDim`), grano, zumbido grave de rayos X muy bajo. Esquina inferior izquierda: `DONANTES: 0347`. **La obra necesita dos personas:** quien se acerca ya se ve, tenue, en rayos X, y la guía dice cuántas faltan. Con dos personas estables 1,5 s: `2 PERSONAS RECONOCIDAS` (`guide.recognizedHold`) y pasa a PLACA.

### 9.2 PLACA (≥ 6 s)
- Cada visitante se ve como cuerpo anatómico 3D en rayos X que lo sigue en tiempo real (§6).
- Al aparecer: **barrido de escáner** vertical de luz blanca que "revela" el cuerpo de arriba abajo (0,8 s).
- Con 2 personas estables 6 s → ASIGNACIÓN. Si queda una sola (o ninguna) unos segundos, vuelve a la ESPERA.

### 9.3 ASIGNACIÓN (3 s)
- **El rol lo decide el círculo del piso** (`config.roles`): en el suelo hay dos círculos, **PROVEEDOR** (donante, el cerdo) y **DESTINATARIO** (receptor). Quien se para del lado `donorSide` de la sala (mirando la pantalla; por defecto la izquierda) es el proveedor. Si los dos están del mismo lado, lo es quien está más hacia ese lado. El modo `azar` queda como alternativa.
- Un **anillo de escaneo** gira alrededor del tórax de ambos y se detiene en el proveedor: el sistema "verifica" lo que ya estaba decidido.
- Etiquetas que se imprimen letra a letra en IBM Plex Mono: `DONANTE N.º 0348 · Sus scrofa domesticus` y `RECEPTOR`.
- Un beep de monitor.

### 9.4 TRANSFORMACIÓN (≈ 10 s)
**A. Edición genética (4 s).** Junto al tórax del donante se imprimen las 10 ediciones, una cada 0,4 s:
```
GGTA1    ─ eliminado            CD46  + insertado · humano
CMAH     ─ eliminado            CD55  + insertado · humano
B4GALNT2 ─ eliminado            THBD  + insertado · humano
GHR      ─ eliminado            EPCR  + insertado · humano
                                CD47  + insertado · humano
                                HO-1  + insertado · humano
```
- Cada "eliminado": un punto de luz se apaga dentro del corazón. Cada "insertado · humano": una partícula blanco cálido entra al corazón y se queda.

**B. Metamorfosis ósea (6 s).** Hueso por hueso (cráneo → columna → tórax → escápulas → pelvis → extremidades), cada 0,35 s:
1. *Hit-stop* de 60 ms.
2. El hueso humano **se agrieta** (`crackProgress` 0→1 en el shader de hueso: grietas que se propagan desde un punto con textura de ruido).
3. **Estalla en astillas** (Rapier, 6–12 fragmentos pequeños que caen y se desvanecen).
4. En su lugar **crece el hueso de cerdo** con un shader de disolución desde el centro.
5. Sacudida de cámara (Perlin, 3–6 px), crujido de hueso distinto cada vez.
- El cráneo es el momento más fuerte: el hocico se alarga visiblemente.
- La piel translúcida también se transforma (morph de MakeHuman hacia proporciones porcinas en la cara y el tórax).
- **Cara de cerdo en tejido blando** (`config.pigFace`, `src/render/materials/xrayFace.ts`). Los visitantes miran a la cámara, así que de frente el cráneo se ve angosto y su perfil no se lee. Por eso el cráneo de cerdo lleva su carne:
  - el disco del hocico con **dos fosas nasales**, que son túneles de aire y por eso se ven oscuros;
  - **orejas** grandes como hojas;
  - cachetes anchos y cuello grueso.

  Se dibuja por espesor de carne atravesada, como una placa real, y es lo que hace que el público vea un cerdo a simple vista. Crece con el cráneo, se estira con el hocico, queda congelada con el esqueleto, gira con la mirada y se disuelve con él.
- Al terminar, el **esqueleto de cerdo se congela** en la última pose. La piel-máscara del visitante sigue moviéndose "fuera" de él.

### 9.5 EXTRACCIÓN

**Modo por defecto: con las manos del receptor** (`extraction.mode = 'manos'`, `src/states/extraccionManos.ts`). Sin cinemática: todo pasa en la placa, en el plano general.
- El pecho del cerdo se agrieta y se abre (0,6 s); la sangre, **plana**, se derrama; el corazón queda latiendo, rojo, en la cavidad. Se oyen dos corazones: el del cerdo y el del receptor.
- El receptor pone la mano sobre el corazón y **la mantiene ahí**: un anillo blanco se llena (`grabDwell`, 1 s) y recién entonces lo toma; el monitor del donante calla.
- El corazón **queda en su mano** y la sigue a donde la mueva. Al alejarse del pecho, los vasos se rompen uno por uno (`snapAt`) y cada muñón late y escupe sangre. El corazón gotea solo cerca del cerdo: a mitad de camino ya está limpio (§1.3).
- Para metérselo, lo lleva a su propio pecho y **lo mantiene ahí** hasta que se llena el segundo anillo (`deliverRadius`, `deliverDwell`). Entonces entra: la carne se vuelve placa, sus costillas se abren apenas como un diafragma de luz, su latido humano calla y el del cerdo pasa a latir de su lado.
- Si nadie lo toma en `autoAfter` s (30), el sistema lo extrae solo (la obra no se detiene, §9.7). Si lo tiene y no se lo mete en `deliverAfter` s (45), el sistema lo termina de llevar.
- Una etiqueta de producto acompaña al corazón mientras viaja: `CORAZÓN · LOTE 0348 / ORIGEN: SUS SCROFA DOMESTICUS`.
- Para probar sin dos personas: G → Extracción → `debugMouse` (el mouse hace de mano).

**Modo alternativo: cinemática X-Ray** (`extraction.mode = 'cinematica'`, ≈ 14 s):

Dos implementaciones con la **misma lista de planos**:
- **Tiempo real (Three.js):** por defecto, funciona en todos los presets.
- **Pre-renderizada (Blender Cycles):** para `ULTRA`, máximo realismo (§11).

Como la cámara corta a primer plano del tórax, la versión pre-renderizada no necesita la pose del visitante. Se aplican las letterbox y se vuelve al plano general al final.

**Lista de planos (shot list):**

| # | t (s) | Plano | Acción | Tiempo |
|---|---|---|---|---|
| 1 | 0,0 | General → **corte** a medio del donante | Letterbox 2,39:1 entra. El mundo se desatura aún más. | `timeScale` 1 → 0,25 |
| 2 | 0,6 | **Primer plano del tórax**, cámara orbita 30° | Capa de piel se vuelve transparente, luego el músculo: queda la caja torácica. Plano X-Ray clásico. | 0,25 |
| 3 | 1,8 | Macro de costillas | **Impacto invisible**: *hit-stop* 120 ms, flash blanco 1 frame, aberración cromática fuerte. Grietas se propagan en 3 costillas. | 0 → 0,15 |
| 4 | 2,4 | Macro, cámara retrocede | **Las costillas se quiebran hacia afuera** (fragmentos de Cell Fracture con Rapier), astillas, médula expuesta, primer chorro de sangre (SSFR). Crujido sub-grave. | 0,15 |
| 5 | 4,0 | Primer plano frontal del corazón | El corazón **late** dentro de la cavidad abierta, húmedo, con brillo especular. Silencio salvo el latido. | 0,3 |
| 6 | 5,5 | Detalle lateral | **El corazón es arrancado**: aorta y venas se estiran (cuerdas verlet) y **se rompen** una por una. Cada ruptura = **chorro arterial pulsátil sincronizado con el latido**. Sangre sobre los huesos (decals). | 0,2 |
| 7 | 7,5 | Plano a la lente | **Gotas golpean la lente de la cámara** y escurren (§10.4). | 0,2 |
| 8 | 8,5 | Seguimiento del corazón | El corazón viaja por una curva Bézier 3D hacia el receptor. Gotea del lado del donante; a mitad del trayecto deja de gotear y su `bloodAmount` baja a 0. | 0,35 → 0,6 |
| 9 | 11,0 | Primer plano del tórax del **receptor** | El corazón entra **limpio**: las costillas del receptor se abren apenas, como un diafragma de luz blanca, y se cierran. Ni una gota. El latido ahora viene de su lado (paneo estéreo). | 0,6 → 1 |
| 10 | 12,5 | Vuelta al general | Letterbox sale. Se ve todo: el cerdo con el pecho abierto, sangrando; el receptor limpio. | 1 |

**Curva de tiempo:** usar una curva Hermite editable en config para `timeScale`; el latido siempre va con el **reloj real**.

### 9.6 AUSENCIA (≤ 25 s)
- El cerdo queda de pie, congelado, con el pecho abierto y las costillas rotas, mirando al frente.
- **La mirada** (Berger): a los 2 s el cráneo gira de perfil, con el hocico hacia el receptor y un ojo al público, como mira un cerdo.
- **La sombra con hocico:** desde los 3 s, la sombra del donante en la cámara difuminada gana cabeza de cerdo de perfil, y se va con él.
- **Charco** que crece bajo él (decal del suelo + pequeñas partículas que siguen goteando de la cavidad, cada vez menos).
- Monitor del donante: el pitido se espacia → **línea plana** sostenida 4 s → silencio.
- Registro desigual (5 s): `RECEPTOR ........... sobrevida: registrada` / `DONANTE N.º 0348 ... vida: no registrada`.
- **Borrado (6 s):** toda la sangre (SSFR, decals, lente, charco) se desatura a gris y se limpia con 2–3 barridos horizontales irregulares, como un trapeador. Validación automática: 0 píxeles con tono rojo al terminar (§18).
- El esqueleto del cerdo se disuelve muy lento (4 s). **El telos** (Rollin): mientras se disuelve, gira de perfil hacia donde mira y baja a cuatro patas; solo cuando ya no sirve vuelve a ser cerdo.
- **Contador +1**, se guarda. Vuelve a ESPERA.

### 9.7 Casos borde
- **La obra nunca se detiene por nadie.** Si el donante se va, su cerdo congelado sigue. Si el receptor se va, el corazón llega a su última posición.
- Si las dos personas intercambian lados, los roles se mantienen.

### 9.8 Sin modo solo
La obra necesita dos personas: con una sola, espera (§9.1). El código del receptor virtual queda, sin uso.

### 9.9 Guía para el público
El auditorio recibe gente que no conoce la obra ni el tema: una guía de una o dos líneas, lo más grande de la placa, arriba al centro, dice qué hacer. **No explica el xenotrasplante:** habla como una etiqueta comercial, con el órgano como producto (pedido, lote, entrega, stock). Se edita en `config.guide` o en G → Guía:
- ESPERA: `SE REQUIEREN DOS CUERPOS / PÁRENSE EN LOS CÍRCULOS DEL PISO` → con una persona, el círculo que falta (`PROVEEDOR REGISTRADO / FALTA EL DESTINATARIO` o `DESTINATARIO REGISTRADO / FALTA EL PROVEEDOR`) → `2 CUERPOS REGISTRADOS`.
- PLACA: `CONTROL DE CALIDAD / MUÉVANSE PARA EL ESCANEO`. ASIGNACIÓN: `ASIGNANDO PROVEEDOR / Y DESTINATARIO`.
- TRANSFORMACIÓN: `PRODUCTO EDITADO / 4 GENES RETIRADOS · 6 GENES HUMANOS` → `ORIGEN: SUS SCROFA DOMESTICUS / APTO PARA USO HUMANO`.
- EXTRACCIÓN: `DESTINATARIO: RETIRE SU PEDIDO / MANTENGA LA MANO SOBRE EL CORAZÓN` → `ENTREGA EN MANO / LLÉVELO A SU PECHO Y MANTÉNGALO AHÍ` → `PEDIDO ENTREGADO / SIN DEVOLUCIONES`.
- AUSENCIA: `PROVEEDOR: DESCARTE / DESTINATARIO: CONFORME`; calla durante el registro desigual; `LIMPIEZA DEL ÁREA`; `STOCK: +7000 EN ESPERA / GRACIAS POR SU COMPRA`.
- Todos los textos escalan con `labels.scale` (por defecto 2,4) para leerse desde el fondo de la sala.

---

## 10. Sistemas de gore

### 10.1 Fracturas (`fracture.ts`)
- **Grietas progresivas en shader:** uniform `crackProgress`, `crackOrigin` (en espacio del objeto) y textura de grietas; el borde de la grieta se oscurece y deja ver un material de médula rojizo.
- **Fragmentos:** al pasar el umbral, la malla intacta se oculta y se activan las piezas pre-fracturadas como cuerpos Rapier con impulso radial desde `crackOrigin` + torque aleatorio.
- **Astillas:** 20–60 partículas instanciadas, pequeñas y alargadas, color hueso.
- **Polvo óseo:** partículas finas grises con fade.

### 10.2 Sangre líquida (`blood/sim.ts`, `blood/ssfr.ts`)
- **Simulación:** 8k (`MED`) a 32k (`ULTRA`) partículas en GPU (`GPUComputationRenderer`): gravedad, arrastre, cohesión simple por vecindad (grid hash), colisión con **cápsulas** que aproximan los huesos del cerdo y con el plano del suelo. Al tocar el suelo con poca velocidad → se vuelven decal del charco.
- **Emisores:** chorro desde la cavidad, **chorros arteriales pulsátiles** (caudal modulado por el latido), goteo del corazón, salpicaduras radiales en cada fractura.
- **Screen-Space Fluid Rendering** (lo que hace que se vea líquido y no puntos):
  1. Pasada de **profundidad** de las partículas como esferas (point sprites con profundidad por píxel).
  2. **Filtro bilateral** (o narrow-range filter) sobre esa profundidad para unir las gotas en una superficie continua.
  3. **Normales** reconstruidas desde la profundidad suavizada.
  4. Pasada de **grosor** (aditiva).
  5. **Sombreado:** absorción Beer-Lambert con color de sangre (`#4a0000` grueso → `#b3001b` fino), especular GGX fuerte (`roughness` 0,08), reflejos del HDRI, **refracción** del fondo y fresnel.
- **Coagulación:** la sangre en el suelo y en los huesos se oscurece y pierde brillo con el tiempo.
- **En la placa real (por defecto) la sangre es plana:** solo su color, más oscuro donde es más gruesa, sin brillo, reflejos ni refracción (SSFR, manchas y charco).
- **Y corre como un río, no sale disparada** (`src/render/blood/river.ts`): al abrirse el pecho, una banda roja plana nace en la cavidad y baja por el abdomen y la pierna de afuera (lejos del receptor) hasta el piso; un brazo más delgado baja por la otra pierna. El frente avanza hacia abajo, el borde es irregular y tiene vetas que corren; cada latido lo hincha mientras sangran los muñones, y al llegar al piso alimenta el charco. No hay chorros arteriales: solo gotas del corazón mientras viaja. El trapeador también lo borra.

### 10.3 Decals (`blood/decals.ts`)
`DecalGeometry` proyectado sobre huesos y cráneo en los puntos de impacto (6–10 texturas de salpicadura con normal map húmedo). Máximo 40 activos; reutilizar.

### 10.4 Sangre en la lente (`blood/lens.ts`)
Pase de pantalla completa:
- 3–8 gotas impactan "la cámara" en los planos 4, 6 y 7.
- Cada gota refracta la imagen de atrás (distorsión por normal map) y **escurre** hacia abajo dejando estela (shader con desplazamiento vertical + ruido).
- Opacidad 0,9 en el centro y bordes más oscuros.

### 10.5 Vasos sanguíneos (`vessels.ts`)
Aorta, arteria pulmonar y venas cavas como cadenas verlet (10–16 nodos) renderizadas como tubos con material de carne húmeda. Se estiran mientras el corazón sale; al superar la tensión máxima **se rompen**, retroceden como elásticos y disparan un chorro.

### 10.6 Materiales de carne (`flesh.ts`, `heart.ts`)
`MeshPhysicalMaterial`: color base rojo profundo, `clearcoat` 1, `clearcoatRoughness` 0,1, `sheen` rosado leve, normal y roughness maps de tejido, aproximación de subsurface (`transmission` + `thickness` o *wrap lighting* en shader propio). El corazón tiene el uniform `bloodAmount` (1 = ensangrentado y brillante; 0 = limpio y pálido).

---

## 11. Cinemática pre-renderizada (preset `ULTRA`)

Script `07_cinematic_render.py`:
- Escena con el esqueleto de cerdo en postura neutra, cámara animada según la **lista de planos de §9.5** (planos 2 a 9).
- **Costillas:** Cell Fracture + Rigid Body.
- **Sangre:** **Mantaflow** líquido (resolución ≥ 192 para el detalle), viscosidad de sangre, emisores pulsantes sincronizados a 72 lpm, malla de líquido con material de sangre (Principled BSDF, transmisión + absorción por volumen).
- **Vasos:** soft body o shape keys.
- **Render:** Cycles, 1920×1080, 24 fps, motion blur activado, profundidad de campo, denoiser OIDN.
- **Salida:** secuencia PNG → `ffmpeg` → `public/video/xray_cinematic.webm` (VP9).
- En el navegador, el estado EXTRACCIÓN reproduce el video en los planos 2–9 y vuelve al render en tiempo real en el plano 10. La transición se tapa con el corte, el flash y la letterbox.
- Agregar `blender/README.md` con tiempos estimados de bake y render, y comandos para renderizar por tramos.

---

## 12. Cámara cinematográfica (`cinematic.ts`)

- Rig con keyframes por plano: posición, objetivo, FOV y distancia focal.
- **Hit-stop:** congelar `timeScale` en 0 durante N ms.
- **Shake:** ruido Perlin en traslación y rotación con decaimiento (trauma²).
- **Cortes secos** entre planos (sin interpolar) y **orbitado lento** dentro de cada plano.
- **Letterbox** animada.

---

## 13. Diseño sonoro (`audio/`)

| Cue | Uso | Origen sugerido |
|---|---|---|
| `xray_hum` (loop) | Fondo | Sintetizado: 50 Hz + ruido rosa filtrado |
| `scan_sweep` | Barrido de escáner | Sintetizado |
| `beep`, `monitor_loop`, `flatline` | Monitor cardiaco | Sintetizado |
| `pulse_beep` | Oxímetro del donante: un pitido por latido cuyo tono **baja con la saturación** (`spo2Semitones` por punto). Cae un poco en la metamorfosis, mucho mientras sangra con el pecho abierto y se desploma en la ausencia | Sintetizado |
| `alarm` | Alarma médica de prioridad alta (10 pulsos, 3 + 2) cuando el corazón sale | Sintetizado |
| `xray_shot` | Disparo del equipo en cada barrido de escáner: ánodo que arranca, pitido de exposición y frenado largo | Sintetizado |
| `ventilator` | Respirador del cerdo anestesiado (§1.5), desde que se congela hasta que se apaga el monitor | Sintetizado |
| `seq_click` | Líneas de edición genética | Sintetizado |
| `bone_crack_01..08` | Metamorfosis y costillas | **Foley:** apio, zanahorias, nueces, ramas secas cerca del micrófono |
| `rib_break_heavy` | Plano 4 | Foley: ramas en toalla húmeda + capa sub-grave |
| `flesh_tear_01..03` | Arrancar el corazón | Foley: toalla mojada retorcida, gelatina, fruta |
| `vessel_snap_01..04` | Ruptura de vasos | Foley: liga de goma + chapoteo |
| `spurt`, `drip`, `splat` | Sangre | Foley: agua con jabón, jarabe, contra vidrio |
| `heartbeat` | Latido (reloj real) | Grabación propia con estetoscopio o micrófono en el pecho |
| `impact_sub` | Hit-stops | Sintetizado: seno 40 Hz con caída rápida |
| `slowmo_in` / `slowmo_out` | Rampas de tiempo | Sintetizado: barrido de filtro |

- Con `timeScale < 1`: bajar el `playbackRate` y aplicar un pasa-bajos en los efectos (no al latido).
- **Dos latidos:** en la asignación y la transformación suena suave el corazón humano del receptor (seco y corto). El del cerdo es más grave, largo y húmedo. Después del trasplante, del lado del receptor suena el del cerdo: se oye que el corazón es de otro.
- **Paneo estéreo** según la posición en pantalla. Reverberación corta de sala con azulejos (`ConvolverNode`).
- Solo grabaciones propias o CC0. Nada de audio de juegos.

---

## 14. Postproceso (`post.ts`)

Orden: `RenderPass` → **N8AO** → SSFR (composite) → decals → **Bloom** (selectivo para huesos y fresnel) → **Profundidad de campo** (solo en cinemática) → **Aberración cromática** (pulsos en impactos) → **Lens blood** → **Viñeta** → **Grano de película** → tonemapping ACES → letterbox.

Desaturación global controlada por estado. El rojo se protege con una máscara: no se desatura hasta el borrado.

---

## 15. Rendimiento y presets (`quality.ts`)

| Preset | Pose | Partículas | SSFR | AO | DOF | Cinemática |
|---|---|---|---|---|---|---|
| `LOW` | full | 4k | ½ resolución, sin refracción | no | no | Tiempo real simplificada |
| `MED` | full | 8k | ½ resolución | sí | no | Tiempo real |
| `HIGH` | heavy | 16k | completa | sí | sí | Tiempo real |
| `ULTRA` | heavy | 32k | completa | sí | sí | Video pre-renderizado |

- **GPU integrada (`LOW`): MediaPipe y el render comparten la GPU.** Si el render la ocupa toda, la pose se actualiza pocas veces por segundo y los cuerpos se congelan. Por eso `LOW` dibuja como máximo a 30 FPS (`maxFps`), con resolución interna de 0,6. Los fragmentos de costilla van en lote (`BatchedMesh`, 2 llamadas de dibujo en vez de ~520) y la máscara de segmentación se calcula cada 2 frames de pose. Si igual se congela, `config.pose.delegate = 'CPU'` saca a MediaPipe de la GPU.
- Meta: **≥ 45 FPS en `HIGH`** con RTX 3050 a 1080p.
- Precargar todo antes de ESPERA (pantalla negra con `CARGANDO…` y porcentaje).
- Pool de objetos para partículas, fragmentos y decals. Nada de `new` en el loop.
- Prueba de 2 horas sin fugas de memoria (`renderer.info` estable).

---

## 16. `config.ts`, debug y operación

Todo valor ajustable va en `config.ts` y se expone en `lil-gui` (tecla `G`): tiempos de cada estado y plano, curva de `timeScale`, colores, fuerzas de fractura, parámetros de sangre (viscosidad, cohesión, caudal), bloom, grano, calibración de cámara, factores del retargeting.

| Tecla | Acción |
|---|---|
| `F` | Pantalla completa |
| `D` | Debug: landmarks, armaduras, IDs, roles, FPS, estado |
| `G` | Panel de ajustes en vivo |
| `1`–`6` | Saltar a PLACA / ASIGNACIÓN / TRANSFORMACIÓN / EXTRACCIÓN / AUSENCIA / ESPERA |
| `X` | Repetir solo la cinemática |
| `Q` | Cambiar preset de calidad |
| `C` | Calibración (flechas, `+`/`-`); se guarda |
| `M` | Silenciar |
| `P` | Captura PNG en alta resolución |
| `Shift+R` | Reiniciar contador (confirmación por consola, nunca `alert()`) |

- El contador empieza en `347`, persiste en `localStorage` y se puede exportar a JSON.
- **Sin operador:** `INICIAR-DONANTE.bat` arma la obra si hace falta, levanta el servidor local y abre Chrome en modo kiosco, con la cámara permitida y el audio sin gesto (`--autoplay-policy=no-user-gesture-required`). Usa un perfil propio, donde viven el contador y los ajustes. Sin el lanzador, el audio espera una tecla o un clic (exigencia del navegador).
- **En pantalla, para el público, solo van la guía y el contador.** Los datos técnicos del equipo (`fluoro.hud`, `fluoro.ruler`) quedan apagados por defecto.

---

## 17. Fases de implementación

> Cada fase termina con: resumen de archivos, cómo probar, capturas con `P` y checklist de aceptación.

**Fase 1 — Base y radiografía 3D de una persona**
Proyecto, MediaPipe offline, retargeting, cuerpo anatómico de 4 capas con **placeholders** si faltan assets, materiales de rayos X, postproceso base, debug, calibración.
✅ Una persona se ve como un cuerpo anatómico 3D translúcido que la sigue sin temblar ni torcer articulaciones, a ≥ 45 FPS en `HIGH`, con el wifi apagado.

**Fase 2 — Pipeline Blender**
Scripts 01–06 y export de GLB del humano por capas, cerdo en armadura humana, costillas fracturadas, corazón con vasos.
✅ Los GLB cargan en la Fase 1 y reemplazan los placeholders.

**Fase 3 — Dos personas y máquina de estados**
Identidad, roles, todos los estados con transiciones, etiquetas, contador, modo solo, casos borde.
✅ Ciclo completo con dos personas reales; los roles no se cruzan; la obra no se detiene si alguien sale.

**Fase 4 — Transformación**
Edición genética, grietas, astillas, disolución humano→cerdo, morph de piel, congelamiento.
✅ El cráneo que se vuelve hocico da escalofríos; cada hueso suena distinto.

**Fase 5 — Sangre**
Simulación GPU, SSFR, decals, lente, charco, coagulación.
✅ En un plano quieto, la sangre se ve **líquida, espesa y brillante**: no parecen puntos ni pintura.

**Fase 6 — Cinemática en tiempo real**
Rig de cámara, los 10 planos, hit-stop, slow-mo, fracturas de costillas, vasos, chorros pulsátiles, corazón limpio en el receptor.
✅ Pasa la **barra de calidad** (§18).

**Fase 7 — Ausencia, borrado y sonido**
Línea plana, registro desigual, borrado validado, mezcla completa con paneo y reverberación.
✅ Ningún píxel rojo después del borrado; contador persistente.

**Fase 8 — Cinemática Blender (`ULTRA`)**
Script 07, render y la integración del video con los cortes.
✅ El cambio entre video y tiempo real no se nota.

**Fase 9 — Montaje**
Prueba en la sala con proyector, sesión de 2 h, ajuste de calibración, volumen y luz.
✅ Tres ciclos seguidos con personas que no conocen la obra, sin que nadie del grupo toque la laptop.

---

## 18. Barra de calidad (revisar en cada fase visual)

- [ ] ¿Una captura cualquiera parece **una cinemática de videojuego AAA** o una imagen médica real, y no un prototipo?
- [ ] ¿Los huesos tienen volumen, oclusión y brillo, o se ven planos?
- [ ] ¿La sangre se ve **líquida** (refracción, reflejos, grosor variable)?
- [ ] ¿Cada impacto tiene: hit-stop + sonido + shake + partículas?
- [ ] ¿El rojo es el **único** color?
- [ ] ¿El receptor está **completamente limpio**?
- [ ] ¿Se entiende, sin explicación, que el cerdo fue editado y que es un cerdo en lugar de una persona?
- [ ] ¿Después del borrado hay **0** píxeles rojos? (test automático en debug: muestrear el framebuffer y contar píxeles con tono entre 340° y 20° y saturación > 0,4).
- [ ] ¿≥ 45 FPS en `HIGH`?

---

## 19. Instrucciones para Claude Code

1. Lee este archivo completo antes de cada fase. Si un pedido contradice §1, **avisa antes de implementarlo**.
2. Trabaja **solo en la fase pedida** y no rompas las anteriores.
3. Nunca bajes la calidad para "terminar rápido". Si algo no se puede hacer con la calidad de §18, dilo y propone alternativas (por ejemplo, el pre-render de Blender).
4. Si falta un asset, crea un **placeholder** reconocible, anótalo en `TODO-ASSETS.md` y sigue.
5. Todo valor ajustable va en `config.ts` y en `lil-gui`.
6. Sin `alert()`, `confirm()` ni `prompt()`. Sin dependencias fuera de §3 sin preguntar.
7. Código en TypeScript estricto, comentado en español, un módulo por sistema.
8. Al terminar cada fase: lista de archivos, comando para correr (`npm run dev`), cómo probar con la webcam, qué falta y capturas sugeridas.
