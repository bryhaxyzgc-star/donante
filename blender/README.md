# Pipeline de assets 3D (Fase 2)

Blender 4.5 LTS en modo headless + un paso en Node. Todo se corre con:

```bash
npm run blender
```

o desde un paso concreto (después de tocar un script):

```bash
npm run blender -- --from 02
```

Pasos válidos para `--from`: `01`, `02`, `pig`, `03`, `04`, `05`, `06`.

Blender se busca en la variable `BLENDER`, luego en `D:\tools\blender\blender-4.5.14-windows-x64\blender.exe`
(portable, sin instalar) y por último en el `PATH`.

## Datos de entrada

`blender/source/bodyparts3d/` (no se versiona; ~140 MB):

| Archivo | Fuente | Licencia |
|---|---|---|
| `isa_BP3D_4.0_obj_99.zip` (136 MB, 2234 OBJ) | https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/ | CC BY 4.0 |
| `isa_element_parts.txt` (1,1 MB) | ídem | CC BY 4.0 |

Atribución obligatoria: *BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International*.

Los OBJ están en milímetros con la convención de Blender (Z arriba, el cuerpo mira a −Y, izquierda anatómica en +X).
En el importador de OBJ, `forward_axis="Y", up_axis="Z"` es la identidad (`NEGATIVE_Y` gira 180°).

## Pasos

| Paso | Script | Qué hace | Tiempo (laptop de desarrollo) |
|---|---|---|---|
| 01 | `01_import_anatomy.py` | Importa 496 elementos FMA (huesos, dientes, piel, 242 músculos, corazón, hígado, aorta, pulmonar, cavas), los limpia y los etiqueta con grupo, lado y nombres FMA | ~1 min 45 s |
| 02 | `02_rig_human.py` | Calcula las articulaciones desde los huesos reales (esferas en cabezas de fémur y húmero, cóndilos, astrágalo, cuerpos vertebrales…), centra el modelo en `Hips`, crea la armadura Mixamo, une las piezas por slot y las decima (≈93 k tris de hueso), neutraliza la cara, pesa piel y músculo, y escribe `work/human_joints.json` | ~3 min |
| pig | `scripts/build-pig.ts` | Esqueleto de cerdo y pulmones procedurales (SDF) ajustados a las articulaciones reales → `work/procedural/*.obj` | ~25 s |
| 03 | `03_rig_pig.py` | Monta el cerdo en la misma armadura (slots `*_pig`, ≈89 k tris) y suma los pulmones al humano | ~15 s |
| 04 | `04_fracture_ribs.py` | Fractura de Voronoi de las 28 costillas del cerdo (261 piezas, caras de corte en material `marrow`) | ~6 s |
| 05 | `05_heart_vessels.py` | Corazón limpio + aorta, pulmonar y cavas como tubos con cadenas de 12 bones (`HeartRig`) | ~8 s |
| 06 | `06_export_glb.py` | Valida mallas y exporta `public/models/{human,pig,heart}.glb` con Draco + `manifest.json` | ~10 s |

Los `.blend` intermedios quedan en `blender/source/work/` (se pueden abrir en Blender para inspeccionar cada paso).

### Pesos de la piel (paso 02)

El pesado por calor de Blender falla con la pose anatómica: los brazos cuelgan **pegados** al torso y la piel de
BodyParts3D está fusionada (y se interpenetra) en el costado y entre mano y muslo. El script usa en cambio:

1. **Etiqueta brazo/tronco** por vértice. Semillas por distancia a las mallas reales de hueso y por dirección de la
   normal (la piel mira en sentido contrario a su hueso). Los vértices dudosos toman la etiqueta por crecimiento de
   regiones sobre la superficie.
2. **Corte** de las aristas que cruzan etiquetas bajo la axila (abre la piel en la línea de contacto).
3. **Desinflado** del costado del torso que invadía el volumen del brazo.
4. **Pesos por distancia** a los segmentos de bone, restringidos por región: nunca el lado contrario, piernas solo
   bajo la cadera. Para cada músculo, solo los bones de su región FMA (miembro superior libre, hombro, tronco,
   miembro inferior libre, cintura pélvica, cuello, cabeza).
5. Suavizado, máximo 4 influencias, normalización.

## Contrato de los GLB (extras de glTF → `userData` en three)

| Objeto | Extras |
|---|---|
| `Armature` | `donante_meta` (JSON: `restPose`, `dorsal` de cada mano en reposo) |
| Huesos `<slot>_human` / `<slot>_pig` | `donante_role="bone"`, `donante_slot`, `donante_bone`, `donante_material` (`bone`, `teeth`, `cartilage`), `donante_species` |
| `skin`, `muscle` | `donante_role="skin"`/`"muscle"`. El músculo trae la dirección de fibra como color de vértice `fiber` (0..1) |
| Órganos `heart_organ`, `liver_organ`, `lungs_organ` | `donante_role="organ"`, `donante_organ`, `donante_bone`, `donante_center` (coords glTF) |
| Fragmentos `rib_frag_<L/R>_<n>_<k>` | `donante_role="fragment"`, `donante_rib`, `donante_side`, `donante_piece`, `donante_bone` |
| `heart.glb`: `heart`, `vessel_*`, `HeartRig` | `donante_role="heart"`/`"vessel"`, `donante_vessel`; `HeartRig.donante_vessels` (JSON con nodos, radio y largo) |

Los huesos y órganos se exportan **sin parentar** en espacio de modelo; la app los hace hijos rígidos de su bone
(`src/render/body.ts`). La armadura de la app se reconstruye con las posiciones de reposo del GLB, con rotaciones
de reposo identidad. Por eso el retargeting no depende de los ejes de los bones de Blender.

## Pendiente

- **KTX2**: los GLB no llevan texturas (los materiales son de la app); cuando haya texturas de ambientCG/Poly Haven,
  convertirlas a KTX2 y activar `KTX2Loader` en `src/anatomy/assets.ts`.
- **Morph de piel humano→cerdo** (cara y tórax): se agrega como shape key en la Fase 4.
- **Esqueleto de cerdo real**: si se consigue un modelo CC (Sketchfab requiere cuenta), reemplazar el paso `pig`
  importándolo en `03_rig_pig.py` con los mismos slots.
- **Pulmones**: BodyParts3D no trae la superficie pulmonar (solo el árbol bronquial); se usan pulmones procedurales
  ajustados a la caja torácica real.
