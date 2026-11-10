# 06 · Exporta los GLB que carga la obra (Draco; KTX2 cuando haya texturas) y el manifiesto.
#   blender -b --factory-startup -P blender/scripts/06_export_glb.py
# Entrada: work/05_heart.blend · Salida: public/models/{human,pig,heart}.glb + manifest.json
#   human.glb  armadura Mixamo + piel y músculo skinneados + huesos *_human + órganos
#   pig.glb    misma armadura + huesos *_pig + fragmentos de costilla (rib_frag_*)
#   heart.glb  corazón + aorta, pulmonar y cavas con cadenas de bones (HeartRig)
# Las relaciones hueso→bone van como extras (donante_bone): la app los parenta rígidos.
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import PUBLIC_MODELS, deselect_all, log, open_work  # noqa: E402
import bpy  # noqa: E402

DRACO = dict(
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_color_quantization=10,
    export_draco_generic_quantization=12,
)


def export(name, objs):
    deselect_all()
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    path = os.path.join(PUBLIC_MODELS, name)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_def_bones=False,
        export_leaf_bone=False,
        export_animations=False,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_vertex_color="NAME",
        export_vertex_color_name="fiber",
        export_all_vertex_colors=False,
        **DRACO,
    )
    log(f"  {name}: {len(objs)} objetos, {os.path.getsize(path) / 1048576:.2f} MB")


def main():
    open_work("05_heart.blend")
    os.makedirs(PUBLIC_MODELS, exist_ok=True)
    # Unir y decimar deja caras degeneradas o aristas sueltas: validar antes de exportar.
    fixed = [o.name for o in bpy.data.objects if o.type == "MESH" and o.data.validate(clean_customdata=False)]
    if fixed:
        log(f"  mallas reparadas: {', '.join(fixed)}")
    arm = bpy.data.objects["Armature"]
    col = bpy.data.collections
    export("human.glb", [arm] + list(col["human_export"].objects))
    export("pig.glb", [arm] + list(col["pig_export"].objects) + list(col["pig_fragments"].objects))
    export("heart.glb", list(col["heart_export"].objects))
    manifest = {
        "human": {"type": "glb", "path": "models/human.glb"},
        "pig": {"type": "glb", "path": "models/pig.glb"},
        "heart": {"type": "glb", "path": "models/heart.glb"},
        "placeholder": {"type": "placeholder", "path": "models/placeholder/human"},
        "source": "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International",
    }
    with open(os.path.join(PUBLIC_MODELS, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    log("  manifest.json actualizado")


main()
