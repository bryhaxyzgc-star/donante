# 01 · Importa la anatomía humana de BodyParts3D 4.0 (DBCLS, CC BY 4.0), la limpia y la nombra.
#   blender -b --factory-startup -P blender/scripts/01_import_anatomy.py
# Entrada: blender/source/bodyparts3d/isa_BP3D_4.0_obj_99.zip + isa_element_parts.txt
# Salida:  blender/source/work/01_anatomy.blend (un objeto por elemento, con grupo, lado y nombres FMA)
#
# Los OBJ de BodyParts3D están en mm con la misma convención que Blender (Z arriba, el cuerpo
# mira a -Y, izquierda anatómica en +X): solo se escala a metros. Ojo: en el importador de OBJ,
# forward_axis="Y" es la identidad; "NEGATIVE_Y" gira el modelo 180° sobre Z.
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    BP3D, centroid, clean_mesh, collection, log, move_to_collection, reset_scene, save_work, tri_count, work,
)
import bpy  # noqa: E402

ZIP = os.path.join(BP3D, "isa_BP3D_4.0_obj_99.zip")
TABLE = os.path.join(BP3D, "isa_element_parts.txt")
OBJ_DIR = work("bp3d_obj")

# Grupo → conceptos FMA (IS-A). Un elemento va al PRIMER grupo que lo contiene.
GROUPS = [
    ("teeth", ["tooth"]),
    ("skull", ["frontal bone", "parietal bone", "occipital bone", "temporal bone", "sphenoid bone", "ethmoid",
               "maxilla", "zygomatic bone", "nasal bone", "lacrimal bone", "palatine bone", "vomer",
               "inferior nasal concha", "mandible"]),
    ("vertebra", ["cervical vertebra", "thoracic vertebra", "lumbar vertebra"]),
    ("pelvis", ["hip bone", "sacrum"]),
    ("cartilage", ["costal cartilage"]),
    ("ribs", ["rib", "manubrium", "body of sternum", "xiphoid process"]),
    ("clavicle", ["clavicle"]),
    ("scapula", ["scapula"]),
    ("humerus", ["humerus"]),
    ("forearm", ["radius", "ulna"]),
    ("hand", ["carpal bone", "metacarpal bone", "phalanx of finger"]),
    ("femur", ["femur"]),
    ("patella", ["patella"]),
    ("leg", ["tibia", "fibula"]),
    ("foot", ["tarsal bone", "metatarsal bone", "phalanx of toe"]),
    ("heart", ["wall of right atrium", "wall of left atrium", "wall of ventricle", "region of wall of heart"]),
    ("liver", ["segment of liver", "caudate lobe of liver"]),
    ("aorta", ["ascending aorta", "arch of aorta", "descending thoracic aorta"]),
    ("pulmonary", ["pulmonary trunk"]),
    ("svc", ["superior vena cava"]),
    ("ivc", ["inferior vena cava"]),
    ("skin", ["skin"]),
    ("muscle", ["muscle organ"]),
]
PAIRED = {"clavicle", "scapula", "humerus", "forearm", "hand", "femur", "patella", "leg", "foot"}
# Músculos que no son esqueléticos superficiales (se excluyen de la capa muscular).
MUSCLE_EXCLUDE = ("papillary", "ventricle", "atrium", "heart", "tongue", "intrinsic", "ocular", "rectus muscle of eyeball",
                  "oblique muscle of eyeball", "levator palpebrae", "ciliary", "stapedius", "tensor tympani")


def read_table():
    names_of = {}
    by_concept = {}
    with open(TABLE, encoding="utf-8") as f:
        next(f)
        for line in f:
            cid, name, fj = line.rstrip("\n").split("\t")
            names_of.setdefault(fj, set()).add(name)
            by_concept.setdefault(name, set()).add(fj)
    return names_of, by_concept


def main():
    if not os.path.exists(ZIP):
        raise SystemExit(f"Falta {ZIP}. Ver blender/README.md para bajar BodyParts3D.")
    reset_scene()
    names_of, by_concept = read_table()
    assign = {}
    for group, concepts in GROUPS:
        for c in concepts:
            for fj in sorted(by_concept.get(c, ())):
                if fj in assign:
                    continue
                if group == "muscle" and any(k in n for n in names_of[fj] for k in MUSCLE_EXCLUDE):
                    continue
                assign[fj] = group
    log(f"{len(assign)} elementos seleccionados de {len(names_of)}")

    os.makedirs(OBJ_DIR, exist_ok=True)
    z = zipfile.ZipFile(ZIP)
    members = {os.path.splitext(os.path.basename(n))[0]: n for n in z.namelist() if n.endswith(".obj")}
    cols = {}
    stats = {}
    for i, (fj, group) in enumerate(sorted(assign.items(), key=lambda kv: kv[1])):
        if fj not in members:
            log("falta en el zip:", fj)
            continue
        path = os.path.join(OBJ_DIR, fj + ".obj")
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(z.read(members[fj]))
        before = set(bpy.data.objects)
        bpy.ops.wm.obj_import(filepath=path, global_scale=0.001, forward_axis="Y", up_axis="Z",
                              use_split_objects=False, use_split_groups=False)
        new = [o for o in bpy.data.objects if o not in before]
        for obj in new:
            obj.name = f"{group}:{fj}"
            obj.data.name = obj.name
            obj["fj"] = fj
            obj["group"] = group
            obj["names"] = ";".join(sorted(names_of.get(fj, ())))
            c = centroid(obj)
            obj["side"] = ("L" if c.x > 0 else "R") if group in PAIRED else "C"
            clean_mesh(obj)
            if group not in cols:
                cols[group] = collection(group)
            move_to_collection(obj, cols[group])
            stats[group] = stats.get(group, 0) + tri_count(obj)
        if i % 50 == 0:
            log(f"  {i}/{len(assign)} …")
    for g, t in sorted(stats.items(), key=lambda kv: -kv[1]):
        log(f"  {g:10s} {len(cols[g].objects):4d} objetos  {t:8d} tris")
    save_work("01_anatomy.blend")


main()
