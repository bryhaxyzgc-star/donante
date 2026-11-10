# 03 · Esqueleto de cerdo en la MISMA armadura humana (§5.2).
#   node scripts/build-pig.ts   (genera work/procedural/*.obj ajustado a work/human_joints.json)
#   blender -b --factory-startup -P blender/scripts/03_rig_pig.py
# Entrada: work/02_human.blend + work/procedural/ · Salida: work/03_pig.blend
# Cada pieza del cerdo usa el mismo nombre de slot que la humana (skull_human ↔ skull_pig).
# El cerdo NO tiene clavículas: ese slot desaparece en la metamorfosis.
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    WORK, clean_mesh, collection, decimate_to, log, material, move_to_collection, open_work, save_work, set_material,
    to_gltf, tri_count,
)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

PROC = os.path.join(WORK, "procedural")
# Presupuesto del cerdo: parecido al humano (el cerdo reemplaza al humano en el mismo cuerpo).
BUDGET = {
    "skull": 16000, "cervical": 2500, "thoracic": 5000, "lumbar": 1800, "ribs": 12000, "cartilage": 2500,
    "scapula": 2500, "pelvis": 6000, "humerus": 2500, "forearm": 2500, "hand": 3500, "femur": 2500,
    "patella": 400, "leg": 2500, "foot": 3500,
}


def import_obj(path, name):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis="Y", up_axis="Z", use_split_objects=False)
    obj = next(o for o in bpy.data.objects if o not in before)
    obj.name = name
    obj.data.name = name
    clean_mesh(obj, merge=0.00005)
    return obj


def main():
    open_work("02_human.blend")
    with open(os.path.join(PROC, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    pig = collection("pig_export")
    src = collection("pig_rib_sources")
    human = bpy.data.collections["human_export"]
    # "soft": la cara de cerdo en tejido blando (hocico con disco y fosas, orejas): la app la dibuja como
    # sombra gris, no como hueso. Es una pieza más del slot del cráneo.
    mats = {k: bpy.data.materials.get(k) or material(k) for k in ("bone", "teeth", "cartilage", "organ", "soft")}
    total = 0
    for e in manifest:
        path = os.path.join(PROC, e["file"])
        if e["kind"] == "organ":
            obj = import_obj(path, f"{e['slot']}_organ")
            set_material(obj, mats["organ"])
            move_to_collection(obj, human)
            c = sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
            obj["donante_role"] = "organ"
            obj["donante_organ"] = e["slot"]
            obj["donante_bone"] = e["bone"]
            obj["donante_center"] = to_gltf(c)
            continue
        if e["kind"] == "rib":
            obj = import_obj(path, f"pig_rib_{e['side']}_{e['rib']:02d}")
            obj["donante_rib"] = e["rib"]
            obj["donante_side"] = e["side"]
            set_material(obj, mats["bone"])
            move_to_collection(obj, src)
            continue
        slot = e["slot"]
        name = "face_pig" if e["material"] == "soft" else f"{slot}_pig" if e["material"] != "teeth" else "teeth_pig"
        if bpy.data.objects.get(name):
            name = f"{name}_{e['bone']}"
        obj = import_obj(path, name)
        base = slot.split("_")[0]
        budget = (3000 if e["material"] == "teeth" else 6000 if e["material"] == "soft"
                  else BUDGET.get(base, 3000) // (2 if base in ("cervical", "thoracic", "lumbar") else 1))
        tris = decimate_to(obj, budget)
        set_material(obj, mats[e["material"]])
        move_to_collection(obj, pig)
        obj["donante_role"] = "bone"
        obj["donante_slot"] = slot if e["material"] != "teeth" else "skull"
        obj["donante_bone"] = e["bone"]
        obj["donante_material"] = e["material"]
        obj["donante_species"] = "pig"
        total += tris
        log(f"  {obj.name:28s} → {e['bone']:13s} {tris:6d} tris")
    log(f"  cerdo: {total} tris; costillas fuente: {len(src.objects)}")
    for o in src.objects:
        log(f"    {o.name} {tri_count(o)} tris")
        break
    save_work("03_pig.blend")


main()
