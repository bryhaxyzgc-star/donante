# DONANTE N.º ____

Instalación interactiva sobre el xenotrasplante. La especificación completa (fuente de verdad) está en
[CLAUDE.md](CLAUDE.md). Este archivo es solo la guía de operación.

## Instalar (una vez, con internet)

```bash
npm install
```

`postinstall` copia los wasm de MediaPipe y Rapier y los decodificadores de three a `public/`, baja los modelos de pose
(`pose_landmarker_heavy.task` 29 MB y `pose_landmarker_full.task` 9 MB) y la tipografía IBM Plex Mono, y precalcula la
anatomía placeholder (~30 s). Después la obra corre **sin red**: un guardia bloquea cualquier petición fuera de la laptop
(incluida la telemetría que trae MediaPipe 1.x).

## Anatomía (Fase 2)

Los GLB de `public/models/` (`human.glb`, `pig.glb`, `heart.glb`) salen del pipeline de Blender a partir de
BodyParts3D 4.0 (CC BY 4.0). Para regenerarlos (Blender 4.5 portable en `D:\tools\blender`, ver
[blender/README.md](blender/README.md)):

```bash
npm run blender
```

Si los GLB faltan, la app usa sola los placeholders procedurales de la Fase 1.

En el panel `G` → Debug: `pigSkeleton` muestra el esqueleto de cerdo sobre el cuerpo en vivo y `assetViewer`
muestra el corazón con sus vasos o las costillas fracturadas.

## Correr

```bash
npm run dev
```

Abrir `http://localhost:5173` en Chrome (aceleración por hardware activada) y permitir la cámara. En Windows con gráfica
híbrida, asignar Chrome a la GPU de alto rendimiento (Configuración → Pantalla → Gráficos). Para la sala:
`npm run build` y `npm run preview` (puerto 4173).

Si no hay webcam, la obra pasa sola al **simulador** (cuerpos sintéticos); también se elige en el panel G → Webcam → source.

## En la exposición (sin operador)

El público no toca nada: la obra corre sola y la guía grande de arriba le dice qué hacer.

**Piso:** dos círculos, **PROVEEDOR** a la izquierda y **DESTINATARIO** a la derecha (mirando la pantalla). Quien se para
en el del proveedor es el donante. Si en la sala conviene al revés: G → *Roles* → `donorSide` → `derecha`, y
después **Guardar ajustes**.

1. **Una vez por laptop:** probar la cámara y calibrar (tecla `C`) con el lanzador abierto. Después, en `G`, pulsar **Guardar ajustes**.
2. **Cada día:** doble clic en **`INICIAR-DONANTE.bat`**. El lanzador:
   - arma la obra si hace falta y levanta el servidor local, sin internet;
   - abre Chrome a pantalla completa (modo kiosco) con la cámara permitida y el sonido andando, sin que nadie toque una tecla.

   Para que arranque solo al prender la laptop, poner un acceso directo al `.bat` en la carpeta de Inicio (`Win+R` → `shell:startup`).
3. **Ciclo:**
   - Con nadie o con una sola persona, la obra espera (`SE REQUIEREN DOS CUERPOS`, `FALTA 1`).
   - Con dos personas quietas 1,5 s, arranca sola y sigue por todos los estados.
   - Si el receptor no toma el corazón en 30 s, el sistema lo saca solo.
   - Al final vuelve a esperar. Si alguien se va a mitad del ciclo, la obra sigue igual.
4. **Salir:** `Alt+F4`.
5. **Después de cambiar el código:** `INICIAR-DONANTE.bat armar` (vuelve a armar la carpeta `dist`).

El lanzador usa un perfil de Chrome propio (`%LocalAppData%\donante-kiosco`). Ahí quedan el contador y los ajustes
guardados de la exposición, aparte de los del Chrome de desarrollo.

Para que la laptop no se apague ni se bloquee durante la muestra, configurar a mano en Windows → Energía:
pantalla y suspensión en **Nunca**.

**Si el destinatario se congela o la mano se detecta mal:** pulsar `D` y mirar `pose … Hz` arriba a la izquierda.
Si en la extracción baja de ~10 Hz, la GPU no da abasto:
- G → *MediaPipe* → `delegate` → `CPU` (deja de competir con el render), y después **Guardar ajustes**;
- o bajar el tope de cuadros, que en LOW es 30.

En pantalla solo quedan la guía y el contador. Los datos técnicos del equipo (kV, mA, dosis, regla) están apagados.
Se prenden en G → *Fluoroscopia* → `hud` y `ruler`.

## Teclas del operador

| Tecla | Acción |
|---|---|
| cualquiera | habilita el audio (exigencia del navegador) |
| `F` | pantalla completa |
| `D` | debug: landmarks, armaduras, IDs, roles, FPS, estado del ciclo, GPU, triángulos |
| `G` | panel de ajustes en vivo (Guardar / Restablecer / Exportar JSON) |
| `C` | calibración: flechas desplazan (Mayús = rápido), `+`/`-` zoom, Mayús+↑/↓ escala del cuerpo, `0` restablece. Muestra la webcam al 40 % para alinear |
| `Q` | rota el preset LOW → MED → HIGH → ULTRA (cambia también el modelo de pose sin cortar el tracking) |
| `M` | silencio |
| `P` | captura PNG a 2× (tal como se ve en la pared) |
| `1`–`6` | saltar a PLACA / ASIGNACIÓN / TRANSFORMACIÓN / EXTRACCIÓN / AUSENCIA / ESPERA (prepara roles, cerdo y corazón) |
| `X` | repetir solo la cinemática con los mismos roles |
| `S` | el próximo ciclo es en modo solo (si está en ESPERA, arranca ya) |
| `Shift+R` | reiniciar el contador a 0347: pide confirmación por consola, hay que repetir antes de 3 s |

El contador se exporta a JSON desde el panel G → *Exportar contador*.

## Ciclo (Fase 3)

`ESPERA → PLACA → ASIGNACIÓN → TRANSFORMACIÓN → EXTRACCIÓN → AUSENCIA → ESPERA`, con los tiempos de §9 en
G → *Ciclo*. Lo que ya funciona:

- **ESPERA**: negro, zumbido de 50 Hz y `DONANTES: 0347`. Pasa a PLACA con alguien estable 1,5 s.
- **PLACA**: cada visitante recibe un cuerpo con barrido de escáner de arriba abajo (0,8 s). Dos personas estables 6 s →
  ASIGNACIÓN; una sola durante 15 s → modo solo.
- **ASIGNACIÓN**: el rol lo decide el círculo del piso (G → *Roles*): quien está del lado del PROVEEDOR (por defecto la
  izquierda de la sala, mirando la pantalla) es el donante. Un anillo de escaneo salta de un tórax a otro cada vez más
  lento y se detiene en él.
  Beep y etiquetas impresas letra a letra.
- **TRANSFORMACIÓN** (Fase 4, ver abajo): edición genética con luces en el corazón y metamorfosis hueso por hueso.
  Al final el esqueleto de cerdo queda congelado; la piel sigue al visitante.
- **EXTRACCIÓN** (Fase 6, ver abajo): la cinemática X-Ray en tiempo real con los 10 planos de §9.5.
- **AUSENCIA** (Fase 7, ver abajo): línea plana, registro desigual, borrado validado, el cerdo se disuelve y el
  contador suma y se guarda.
- **Casos borde**: los cuerpos con rol conservan la última pose si la persona sale, y la obra sigue. Las identidades se
  asocian por la posición cruda predicha, así que no se intercambian cuando dos personas se cruzan. Con alguien a
  mitad de ciclo que vuelve a entrar, se le asigna un cuerpo nuevo en el ciclo siguiente.

Pendiente por fase: video de Blender para ULTRA (8) y montaje en la sala (9). El foley grabado se suma cuando
exista (ver *Sonido*).

## Transformación (Fase 4)

- **Edición genética (0–4 s)**: cada línea `─ eliminado` apaga uno de los 4 destellos fríos dentro del corazón del
  donante (con un último destello y un tono que cae); cada `+ insertado · humano` hace entrar desde los textos una
  partícula blanco cálido que se queda (tono que sube). El corazón se atenúa a medias mientras se edita para que los
  destellos se lean. Las luces laten con el corazón, se congelan con él y viajan con él hasta el receptor.
- **Metamorfosis (4–10 s)**: 14 grupos, uno cada 0,35 s. Para cada uno:
  - hit-stop de 60 ms, sacudida de 3–5 px (6,5 en el cráneo) y crujido propio de ese hueso;
  - la grieta se propaga desde un punto del frente del hueso. Corre por los bordes de las mismas celdas Voronoi
    que definen los fragmentos: borde oscuro con un hilo de médula roja y grietas finas cerca del impacto;
  - el hueso humano estalla en 6–12 fragmentos (cáscaras: hueso afuera, médula húmeda adentro) que vuelan con
    Rapier, caen al piso, suenan al tocarlo y se disuelven, más astillas instanciadas y polvo óseo;
  - en su lugar el hueso de cerdo crece desde el centro con un frente brillante.
- **Cráneo**: el hocico brota (30 % → 112 % → 100 % de su largo) y la piel de la cara se vuelve porcina: hocico romo
  con disco, mandíbula larga, frente recta, orejas arriba y cuello grueso. Con las costillas, el tórax de la piel se
  ensancha en barril. Los dos morph targets se generan al cargar a partir de la armadura (`src/render/morph.ts`).
- **Cara de cerdo** (G → *Cara del cerdo*): el cráneo de cerdo trae su carne, que es lo que el público reconoce de
  frente: el disco del hocico con dos fosas nasales oscuras (aire), orejas grandes, cachetes y cuello grueso. Se
  dibuja por espesor de carne atravesada (`src/render/materials/xrayFace.ts`) y va pegada al cráneo: crece, se
  estira con el hocico, se congela, gira con la mirada y se disuelve con él.
- Todo se ajusta en G → *Transformación* (tiempos, hocico, morph, fragmentos, astillas, polvo, sacudida, médula,
  destellos).

## Cinemática en tiempo real (Fase 6)

- **Cámara** (`src/render/cinematic.ts`): los 10 planos de §9.5 con cortes secos entre planos y movimiento lento
  adentro. El plano 2 orbita 30° y el 8 sigue al corazón con inercia. Cada plano se define en un marco local (tórax,
  cavidad, corazón, corazón en viaje, receptor) con el eje X hacia afuera, lejos del receptor. Usa la misma cámara de
  la webcam: al volver al plano general queda exacta en la calibración. La capa de máscara se oculta mientras dura.
- **Tiempo**: curva Hermite monótona editable en G → *Cinemática* → `timeCurve` (texto `t:valor, …`). El latido
  sigue el reloj real. Hit-stop de 120 ms en el impacto.
- **Costillas** (plano 3 y 4):
  - las grietas corren por ~3 costillas del cerdo (celdas Voronoi de su malla);
  - al quebrarse, los fragmentos del frente del tórax (Fase 2) pasan a Rapier y salen volando hacia la cámara,
    mientras el resto de la caja queda en su lugar y el pecho queda abierto;
  - el cartílago costal, los pulmones y el hígado de rayos X se van.
- **Corazón y vasos** (`src/render/vessels.ts`, `materials/flesh.ts`, `materials/heart.ts`):
  - desde el plano 5, el corazón es carne húmeda (`heart.glb`) con `bloodAmount`;
  - aorta, pulmonar, cava superior e inferior son cuerdas verlet de 13 nodos que se estiran mientras el corazón sale
    a tirones y se rompen una por una;
  - el corte quita los triángulos que cruzan, así el tubo queda abierto y hueco;
  - de cada muñón sale el chorro pulsátil, y el corazón llega limpio: `bloodAmount` llega a 0 a mitad de camino;
  - ya cortado, cada pedazo de vaso tiene un tope de estiramiento (`vesselMaxStretch`): el corazón no arrastra un
    tubo largo en el viaje.
- **Receptor** (plano 9): el corazón entra a los 11,4 s, dentro del plano. Las costillas del receptor se abren apenas y
  se encienden de blanco (diafragma de luz) con un destello suave. En modo solo el receptor no tiene costillas.
  - En el viaje el corazón gira y cambia de tamaño hasta calzar con el corazón del receptor.
  - Al entrar, la carne se vuelve placa en 0,9 s (`uXray` en `materials/flesh.ts`): se enfría al gris de los rayos X,
    se le enciende el borde de fresnel y se desvanece mientras aparece el corazón de rayos X del receptor, que se
    había retirado antes de la llegada para que no haya dos. Después vuelven los destellos genéticos, ahora del
    lado del receptor.
  - En el corte al plano 9 la lente queda limpia: ni una gota del donante sobre el receptor.
- **Profundidad de campo** (HIGH/ULTRA) y menos exposición y bloom en los primeros planos. Los destellos genéticos se
  achican en cámara y se ocultan mientras el corazón es de carne.
- Los shaders de la cinemática se compilan en la pantalla de carga (sin tirón en el primer ciclo).

## Sangre (Fase 5)

- **Simulación** (`src/render/blood/sim.ts`): 4 k (LOW) a 32 k (ULTRA) partículas en GPU con
  `GPUComputationRenderer`. Tiene:
  - gravedad, arrastre y viscosidad (mezcla de velocidades por una grilla 3D de 32³ alrededor del donante);
  - cápsulas sobre los huesos del cerdo congelado, donde la sangre se pega y resbala;
  - piso, donde la gota se frena y se funde con el charco.

  Los caudales nacen repartidos dentro del frame para que no salgan en cuentas. Los estallidos salen en coágulos:
  masas con velocidades correlacionadas que vuelan espesas y se estiran en hilos.
- **SSFR** (`ssfr.ts`): esferas con profundidad por píxel, filtro bilateral separable en dos pasadas, normales
  desde la profundidad y bordes curvados por el gradiente del grosor. La silueta la define el grosor desenfocado.
  Sombreado (`shade.ts`):
  - absorción Beer-Lambert (#b3001b fino → #4a0000 espeso) y GGX con rugosidad 0,08;
  - reflejos de un quirófano analítico, Fresnel y refracción del fondo;
  - la profundidad de la escena tapa la sangre que está detrás del hueso.
- **Manchas y charco** (`decals.ts`):
  - 8 salpicaduras generadas al cargar (mancha, gotas satélite, chorreaduras) con normal map húmedo, proyectadas
    con `DecalGeometry` sobre las piezas del cerdo (máximo 40, se reutilizan);
  - el charco crece con la sangre que cae y refleja de verdad la escena (`Reflector` a ⅓ de resolución);
  - las manchas y el charco coagulan (se oscurecen y pierden brillo en `blood.clotTime` s);
  - el charco nunca crece hacia el receptor.
- **Lente** (`lens.ts`): salpicaduras en los planos 4, 6 y 7, no discos: lóbulos, puntas cortas y gotitas satélite,
  con el borde fuera de foco (`lensSoft`).
  - Refractan y filtran la imagen como sangre: más oscuras donde son gruesas y en el menisco.
  - Tienen un brillo ancho en media luna (`lensSpec`), nunca un punto blanco, y escurren con estela.
  - Caen siempre del lado del donante en la pared.
- **Coreografía** (`src/states/sangrado.ts`):
  - 2,4 s: borbotón y salpicaduras al quebrarse las costillas;
  - 5,7 / 6,3 / 6,9 s: tres muñones con chorros pulsátiles al ritmo del latido (reloj real);
  - el corazón gotea solo la primera mitad del viaje y llega limpio;
  - en AUSENCIA, el goteo se apaga y el charco crece.

  Toda la sangre se aleja del receptor.
- **Prueba en plano quieto**: G → Debug → `bloodTest` (chorro continuo frente a la cámara) y `bloodView`
  (profundidad, normales, grosor). Con la webcam apagada (G → Webcam → source `camara` sin cámara) la obra se queda
  en ESPERA y solo se ve el chorro.
- Ajustes en G → *Sangre*.

## Ausencia y borrado (Fase 7)

- **Línea de tiempo** (≤ 25 s):
  - 0–6 s: el monitor del donante espacia sus pitidos;
  - 6–10 s: línea plana sostenida, después silencio. El latido del receptor sigue de fondo;
  - 10,5–15,5 s: registro desigual;
  - 15,5–21,4 s: borrado;
  - 20,5–24,5 s: el cerdo se disuelve;
  - 24,5 s: el contador suma 1 y se guarda.
- **Borrado** (`src/render/erase.ts`): una sola máscara en espacio de pantalla, con uniforms compartidos por el SSFR,
  las manchas, el charco y la lente.
  - Primero la sangre se desatura a un gris visible, como un fantasma húmedo.
  - Después pasan 3 barridos horizontales en sentidos alternados, con frente quebrado y brillo mojado. Las
    primeras pasadas dejan vetas y la última limpia del todo, con un roce húmedo que cruza la sala (paneo).
  - También pierden el rojo la médula de las costillas rotas, las grietas del cerdo y el tinte del corazón de
    rayos X.
  - La aberración cromática de base queda solo durante la violencia (transformación y extracción): fuera de ella
    sus franjas eran rojo que no era sangre.
- **Validación** (`src/render/redCheck.ts`, §18): al terminar cada borrado se lee el framebuffer y se cuentan los
  píxeles con tono entre 340° y 20° y saturación > 0,4. Resultado en la consola (`[borrado] 0 píxeles rojos ✓`) y en
  el HUD de debug (D). A mano: G → *Probar píxeles rojos*.

## Sonido (Fase 7)

- **Mezcla** (`src/audio/engine.ts`):
  - buses de ambiente, interfaz, efectos y latido, más un compresor final;
  - reverberación corta de sala con azulejos (`ConvolverNode` con respuesta generada al vuelo);
  - en cámara lenta los efectos bajan de tono y pasan por un pasa-bajos; el latido no;
  - niveles y envíos en G → *Sonido*.
- **Cues** (`src/audio/cues.ts`), todos sintetizados:
  - zumbido, barrido, monitor (un beep por latido del donante hasta que le sacan el corazón), línea plana,
    tecleo, ediciones genéticas;
  - crujidos de hueso con una voz por hueso y fragmentos contra el piso;
  - desgarro de carne al arrancar el corazón, goma con chapoteo en cada vaso que se rompe y un chorro por
    latido en cada muñón;
  - goteo, salpicaduras, gotas en la lente, trapeador y rampas de cámara lenta;
  - latido lub-dub con el reloj real, paneado según dónde está el corazón: del donante en la cinemática (en el
    plano 5, el único sonido) y del receptor después del trasplante.
- **Equipo médico** (G → *Sonido*):
  - el monitor del donante es un oxímetro: su tono baja con la saturación. Cae un poco en la metamorfosis, mucho
    con el pecho abierto mientras sangra y se desploma en la ausencia;
  - alarma de prioridad alta (10 pulsos) cuando el corazón sale;
  - en cada barrido de escáner, el equipo de rayos X dispara: el ánodo arranca, suena el pitido de exposición y
    el ánodo se frena despacio;
  - un respirador mantiene al cerdo anestesiado desde que se congela hasta que se apaga el monitor.

## Fluoroscopia

Por defecto la imagen es una **fluoroscopia** (`src/render/fluoro.ts`, G → *Fluoroscopia*), porque una radiografía
que se mueve en tiempo real es eso:

- campo redondo del intensificador, con caída de brillo hacia el borde y distorsión en cojín;
- moteado cuántico gris que hierve y velo en los negros;
- persistencia (estela de lo que se mueve), realce de bordes y líneas de la rejilla antidispersión;
- `pulseFps` en 7,5 o 15 da la fluoroscopia pulsada, que se ve a saltos como en un equipo real.

En las esquinas van los datos del equipo (`src/render/fluoroHud.ts`): kV y mA que se ajustan solos, n.º de estudio,
tiempo de fluoroscopia y dosis acumulada por ciclo. A la derecha hay una regla en cm calibrada a la distancia de
los cuerpos. Con `fluoro.enabled` apagado vuelve el marco de placa (G → *Placa (marco)*).

El tejido blando también pesa más: el cuerpo se ve como masa gris alrededor del hueso (G → *Placa real* →
`skinFill`, `muscleFill`; G → *Tejido blando* → `opacity`).

Si en esa laptop se usó **Guardar ajustes** antes de este cambio, los valores guardados mandan sobre los nuevos.
Para tomar los nuevos: G → *Restablecer* y después *Guardar ajustes*.
- **Foley grabado**: se cargan los archivos que liste `public/audio/manifest.json` (`bone_crack`, `rib_break_heavy`,
  `flesh_tear`, `vessel_snap`, `spurt`, `drip`, `splat`, `heartbeat`). Ponerlos en `public/audio/` y nombrarlos en el
  manifiesto: los cues los usan en vez de la síntesis, con variación de tono. Solo grabaciones propias o CC0
  (§13).

## Estructura

Ver §4 de CLAUDE.md. Además de esa lista, la Fase 1 agregó:

- `src/anatomy/` — armadura Mixamo, SDF + Surface Nets + decimación QEM, placeholders anatómicos y su cargador.
- `src/input/pose.worker.ts`, `simulator.ts`, `poseTypes.ts` — MediaPipe en un worker y simulador de visitantes.
- `src/render/projection.ts`, `softTissue.ts` — modelo de cámara compartido, capa de máscara y cámara difuminada (la
  webcam reducida y desenfocada en gris frío detrás del 3D; G → *Cámara difuminada*).
- `src/offline.ts`, `clock.ts`, `gui.ts`, `calibration.ts`, `loading.ts`, `persist.ts`.
- `scripts/` — `copy-vendor.mjs`, `fetch-assets.mjs`, `build-placeholders.ts`.

La Fase 3 agregó `src/states/machine.ts` (contexto `Show` + `Machine`), los seis estados, `src/render/labels.ts`,
`src/render/scanRing.ts`, `src/counter.ts` y `src/audio/cues.ts` (cues sintetizados de §13: zumbido, barrido, beeps,
línea plana, clic, crujido provisorio e impacto sub-grave).

La Fase 7 agregó `src/render/erase.ts`, `src/render/redCheck.ts`, el motor de mezcla en `src/audio/engine.ts`, los
cues nuevos en `src/audio/cues.ts` y `public/audio/manifest.json`.

La Fase 6 agregó el rig de planos y la curva de tiempo en `src/render/cinematic.ts`, `src/render/vessels.ts`,
`src/render/materials/flesh.ts` y `heart.ts`.

La Fase 5 agregó `src/render/blood/` (`sim.ts`, `ssfr.ts`, `shade.ts`, `decals.ts`, `lens.ts`, `blood.ts`) y
`src/states/sangrado.ts`.

La Fase 4 agregó `src/render/fracture.ts` (partición en fragmentos, Rapier, astillas y polvo), `src/render/morph.ts`,
`src/render/geneLights.ts`, `src/render/cinematic.ts` (por ahora solo la sacudida de cámara) y `src/random.ts`.
En `src/audio/cues.ts`, crujidos granulares con una voz distinta por hueso (`boneVoice`).
