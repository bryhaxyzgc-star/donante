# TODO-ASSETS — assets faltantes (placeholders activos)

Mientras un asset falte, la obra usa un **placeholder reconocible** y sigue funcionando.

## Estado tras la Fase 7

| Asset | Estado | Notas |
|---|---|---|
| Esqueleto humano completo | ✅ BodyParts3D 4.0 (`human.glb`) | 30 piezas por slot, ≈93 k tris |
| Piel neutra riggeada | ✅ BodyParts3D, cara neutralizada (`human.glb`) | Se eligió en lugar de MakeHuman para que calce con los huesos. La piel queda abierta en la línea de contacto brazo/torso y mano/muslo (ver `blender/README.md`) |
| Musculatura superficial | ✅ 242 músculos de BodyParts3D unidos (`human.glb`) | Fibra por músculo (PCA) como color de vértice |
| Corazón, hígado | ✅ BodyParts3D | Corazón con arranque de grandes vasos en la capa de rayos X |
| Pulmones | ⚠️ Procedural ajustado al tórax real | BodyParts3D no trae superficie pulmonar |
| Corazón + vasos en cadena | ✅ `heart.glb` (aorta 19,5 cm, pulmonar, cava superior e inferior, 12 bones cada uno) | En uso en la cinemática (`vessels.ts`). Las texturas de carne son procedurales (ruido de tejido en `materials/flesh.ts`); con texturas CC0 de tejido mejoraría el macro |
| Esqueleto de cerdo en postura humana | ⚠️ **Procedural** (`pig.glb`), rehecho el 10-11-2026: cráneo en cuña con cresta nucal alta, dorso recto, hocico ancho con hueso rostral y narinas, arco cigomático, mandíbula alta y dientes encastrados; huesos largos macizos (metáfisis anchas, radio pegado al cúbito, peroné pegado a la tibia); manos y patas más grandes | No hay un esqueleto completo CC descargable sin cuenta: en Sketchfab hay huesos sueltos escaneados (colección *osteoarchaeology*, Harvard; *Arqueodata*) y un cráneo de jabalí CC BY (Mammal Research Institute PAS, datos en openforestdata.pl), todos con cuenta. Si se baja el cráneo, puede reemplazar solo el slot `skull` en `03_rig_pig.py` (mismo origen en los cóndilos, hocico hacia +Z) |
| Costillas del cerdo fracturadas | ✅ 261 fragmentos Voronoi con caras de médula (`pig.glb`) | Cell Fracture ya no viene con Blender 4.2+: fractura propia con bmesh |
| HDRI de interior clínico | ❌ `RoomEnvironment` de three | Poly Haven (CC0) en `public/hdri/`. Los reflejos de la sangre usan un quirófano analítico (`blood/shade.ts`); con el HDRI se pueden muestrear del PMREM |
| Texturas de salpicadura (6–10) | ⚠️ **Procedurales**: 8 generadas en canvas al cargar (alfa + normal map) | Si se fotografían salpicaduras reales (CC0/propias), van en `public/textures/blood/` con alfa y normal map |
| Texturas de hueso / carne / tejido | ❌ ruido procedural en los shaders | ambientCG / Poly Haven (CC0) → KTX2 |
| Morph de piel humano→cerdo | ⚠️ **Procedural** (`src/render/morph.ts`): 2 morph targets generados al cargar desde la armadura | La piel es la de BodyParts3D, no MakeHuman: no hay shape keys. Si se modela uno a mano en Blender, exportarlo como morph target de `skin` con los mismos dos nombres (cabeza, tórax) |
| Fragmentos de los huesos humanos | ⚠️ **Procedural** al cargar: 6–12 celdas Voronoi por pieza, cáscaras sin caras de corte | Las caras internas son el reverso de la superficie (médula). Cell Fracture en Blender daría caras de corte reales; con esta resolución de malla no hizo falta |
| Audio sintetizado (zumbido, barrido, monitor, línea plana, clic, impacto, cámara lenta, trapeador) | ✅ Sintetizado en vivo (`audio/cues.ts`) con buses, reverberación de sala azulejada y pasa-bajos en cámara lenta (`audio/engine.ts`) | — |
| Foley (`bone_crack_01..08`, `rib_break_heavy`, `flesh_tear_01..03`, `vessel_snap_01..04`, `spurt`, `drip`, `splat`, `heartbeat`) | ⚠️ **Sintetizado** (granos, osciladores y ruido filtrado); el motor ya carga foley si existe | Grabar (apio, zanahoria, nueces, ramas en toalla húmeda, toalla mojada retorcida, gelatina, liga de goma, agua con jabón, jarabe contra vidrio, estetoscopio en el pecho) o conseguir CC0, poner los archivos en `public/audio/` y listarlos en `public/audio/manifest.json` (por ejemplo `"bone_crack": ["bone_crack_01.wav", …]`). La síntesis no tiene la humedad ni el cuerpo de un foley real |

## Respaldo

Si `public/models/human.glb` falta o falla al cargar, la app usa los placeholders procedurales de la Fase 1
(`public/models/placeholder/`, `npm run placeholders`). El manifiesto que decide es `public/models/manifest.json`.

## Regenerar

```bash
npm run blender
```

```bash
npm run placeholders -- --force
```
