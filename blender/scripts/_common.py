# Utilidades compartidas por los scripts del pipeline (Blender 4.5, bpy, modo headless).
# Convenciones:
#   - Blender: Z arriba, el cuerpo mira a -Y, izquierda anatómica en +X, metros.
#   - glTF/three: Y arriba, mira a +Z. El exportador glTF hace la conversión.
#   - Archivos intermedios en blender/source/work/ (no se sirven).
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "blender", "source")
WORK = os.path.join(SRC, "work")
BP3D = os.path.join(SRC, "bodyparts3d")
PUBLIC_MODELS = os.path.join(ROOT, "public", "models")

os.makedirs(WORK, exist_ok=True)

BONE_NAMES = [
    "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "LeftHand_End",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "RightHand_End",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "LeftToe_End",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "RightToe_End",
]

PARENT = {
    "Hips": None, "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Neck": "Spine2", "Head": "Neck",
    "HeadTop_End": "Head",
    "LeftShoulder": "Spine2", "LeftArm": "LeftShoulder", "LeftForeArm": "LeftArm", "LeftHand": "LeftForeArm",
    "LeftHand_End": "LeftHand",
    "RightShoulder": "Spine2", "RightArm": "RightShoulder", "RightForeArm": "RightArm", "RightHand": "RightForeArm",
    "RightHand_End": "RightHand",
    "LeftUpLeg": "Hips", "LeftLeg": "LeftUpLeg", "LeftFoot": "LeftLeg", "LeftToeBase": "LeftFoot",
    "LeftToe_End": "LeftToeBase",
    "RightUpLeg": "Hips", "RightLeg": "RightUpLeg", "RightFoot": "RightLeg", "RightToeBase": "RightFoot",
    "RightToe_End": "RightToeBase",
}


def log(*a):
    print("[donante]", *a, flush=True)


def script_args():
    """Argumentos después de `--` en la línea de comandos de Blender."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def work(name):
    return os.path.join(WORK, name)


def open_work(name):
    path = work(name)
    if not os.path.exists(path):
        raise SystemExit(f"Falta {path}: correr antes el paso anterior del pipeline")
    bpy.ops.wm.open_mainfile(filepath=path)
    log("abierto", name)


def save_work(name):
    bpy.ops.wm.save_as_mainfile(filepath=work(name), compress=True)
    log("guardado", name)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def move_to_collection(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def deselect_all():
    for o in bpy.context.view_layer.objects:
        o.select_set(False)


def activate(obj):
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(objs, name):
    """Une objetos malla en uno solo (conserva materiales y atributos)."""
    objs = [o for o in objs if o and o.type == "MESH"]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    deselect_all()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def apply_transforms(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate_to(obj, target_tris, name="Decimate"):
    """Decima con un modificador Collapse hasta ~target_tris triángulos y lo aplica."""
    tris = tri_count(obj)
    if tris <= target_tris:
        return tris
    mod = obj.modifiers.new(name, "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.01, target_tris / tris)
    mod.use_collapse_triangulate = True
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return tri_count(obj)


def clean_mesh(obj, merge=0.0002):
    """Fusiona vértices duplicados, recalcula normales hacia afuera y suaviza el sombreado."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.update()


def centroid(obj):
    vs = obj.data.vertices
    if not vs:
        return Vector()
    acc = Vector()
    for v in vs:
        acc += obj.matrix_world @ v.co
    return acc / len(vs)


def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def bbox(points):
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    zs = [p.z for p in points]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def to_gltf(v):
    """Blender (Z arriba, -Y frente) → glTF (Y arriba, +Z frente)."""
    return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]


def from_gltf(p):
    return Vector((p[0], -p[2], p[1]))


def write_json(name, data):
    with open(work(name), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    log("escrito", name)


def read_json(name):
    with open(work(name), encoding="utf-8") as f:
        return json.load(f)


def material(name, color=(0.9, 0.92, 0.95, 1.0), roughness=0.5):
    """Material simple: la app los reemplaza por los suyos según el nombre."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    return m


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
