# CREDITS — autores, fuentes y licencias

Solo CC0, CC BY, CC BY-SA, OFL, licencias de software libre o material propio (§5.4).
Ningún asset, logo, tipografía, audio, personaje o texto de juegos comerciales.

## Software (dependencias npm)

| Paquete | Uso | Licencia |
|---|---|---|
| three | Motor 3D | MIT |
| postprocessing (pmndrs) | Cadena de postproceso | Zlib |
| n8ao (N8python) | Oclusión ambiental | ISC |
| @mediapipe/tasks-vision (Google) | PoseLandmarker | Apache-2.0 |
| @dimforge/rapier3d-compat | Física (fases 4-6) | Apache-2.0 |
| @tweenjs/tween.js | Animación | MIT |
| lil-gui | Panel de ajustes | MIT |
| stats.js | Medidor de FPS | MIT |
| vite, typescript | Herramientas | MIT, Apache-2.0 |
| Blender 4.5 LTS (herramienta, no se distribuye) | Pipeline de assets | GPL-3.0 |

## Modelos y datos

| Archivo | Autor / fuente | Licencia |
|---|---|---|
| `public/mediapipe/models/pose_landmarker_heavy.task`, `pose_landmarker_full.task` | Google MediaPipe — https://storage.googleapis.com/mediapipe-models/ | Apache-2.0 |
| `public/mediapipe/wasm/*` | Google MediaPipe (paquete npm) | Apache-2.0 |
| `public/decoders/draco/*`, `public/decoders/basis/*` | Google Draco / Binomial Basis Universal (vía three) | Apache-2.0 |
| `public/models/human.glb` (huesos, dientes, piel, músculos, corazón, hígado) | **BodyParts3D 4.0**, Database Center for Life Science (DBCLS) — https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ — procesado con `blender/scripts/01`–`06` (decimado, rig, cara neutralizada) | **CC BY 4.0**. Atribución: *BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International* |
| `public/models/heart.glb` (corazón, aorta, pulmonar, cavas) | BodyParts3D 4.0 (DBCLS), vasos reconstruidos como tubos por `05_heart_vessels.py` | CC BY 4.0 (misma atribución) |
| `public/models/pig.glb` (esqueleto de *Sus scrofa domesticus*, fragmentos de costilla) | Material propio: SDF procedural ajustado a las articulaciones de BodyParts3D (`src/anatomy/pigSkeleton.ts`, `04_fracture_ribs.py`) | Propio |
| Pulmones de `human.glb` | Material propio (SDF), BodyParts3D no trae superficie pulmonar | Propio |
| `public/models/placeholder/human.*` | Material propio: generado por `scripts/build-placeholders.ts` (SDF procedurales); respaldo si falta el GLB | Propio |

## Tipografía

| Archivo | Autor / fuente | Licencia |
|---|---|---|
| `public/fonts/ibm-plex-mono-400.woff2`, `-500.woff2` | IBM Plex Mono — IBM, vía @fontsource (jsDelivr) | SIL Open Font License 1.1 |

## Algoritmos y referencias (código propio inspirado en publicaciones)

- Funciones de distancia (elipsoide, cono redondeado, triángulo): Inigo Quilez, iquilezles.org (fórmulas).
- Surface Nets: S. Gibson (1998); variante de Mikola Lysenko.
- Simplificación por cuádricas: Garland & Heckbert (1997); variante iterativa de Sven Forstmann, "Fast Quadric Mesh Simplification" (MIT).
- Filtro One Euro: Casiez, Roussel & Vogel (CHI 2012).
- Hash sin seno para ruido GLSL: estilo Dave Hoskins (MIT).

Nota: §5.1 de CLAUDE.md cita BodyParts3D como CC BY-SA 2.1 JP; desde 2025 la versión 4.0 se publica bajo
**CC BY 4.0** (página de licencia de DBCLS, consultada el 27/10/2026).

## Pendientes

Ver `TODO-ASSETS.md`: esqueleto de cerdo escaneado (si aparece uno CC descargable), HDRI y texturas de
Poly Haven / ambientCG, foley propio.
