# 05 · Corazón + aorta, arteria pulmonar y venas cavas como tubos con huesos en cadena (§5.3, §10.5).
#   blender -b --factory-startup -P blender/scripts/05_heart_vessels.py
# Entrada: work/04_fracture.blend (+ paredes del corazón de work/01_anatomy.blend)
# Salida:  work/05_heart.blend (colección heart_export + armadura HeartRig)
# La línea central de cada vaso de BodyParts3D se obtiene por distancia geodésica desde su unión
# con el corazón; sobre ella se arma un tubo limpio y una cadena de NODES bones (verlet en vessels.ts).
import heapq
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    WORK, activate, apply_transforms, collection, decimate_to, join, log, material, move_to_collection, open_work, save_work,
    set_material, to_gltf,
)
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402

NODES = 13          # nodos por vaso (12 bones)
RING = 14           # lados del tubo
SUB = 3             # anillos por tramo
MAX_LEN = {"aorta": 0.2, "pulmonary": 0.06, "svc": 0.08, "ivc": 0.045}
HEART_TRIS = 12000


def centroid_of(objs):
    acc, n = Vector(), 0
    for o in objs:
        for v in o.data.vertices:
            acc += o.matrix_world @ v.co
            n += 1
    return acc / max(1, n)


def load_from_01(prefixes):
    path = os.path.join(WORK, "01_anatomy.blend")
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [n for n in src.objects if n.split(":")[0] in prefixes]
    out = []
    for o in dst.objects:
        o.name = "src01_" + o.name
        bpy.context.scene.collection.objects.link(o)
        out.append(o)
    # En 01 la escala mm→m quedó en el objeto: aplicarla para trabajar en metros de mundo.
    bpy.context.view_layer.update()
    for o in out:
        o.data = o.data.copy()
        apply_transforms(o)
    return out


def geodesic_centerline(obj, root_pt, max_len):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    roots = sorted(bm.verts, key=lambda v: (v.co - root_pt).length)[:6]
    # Grafo = aristas de la malla + "puentes" entre vértices cercanos: los segmentos de un vaso
    # (aorta ascendente, cayado, descendente) vienen como mallas separadas que se tocan.
    kd = KDTree(len(bm.verts))
    for v in bm.verts:
        kd.insert(v.co, v.index)
    kd.balance()
    nbrs = [[] for _ in bm.verts]
    for v in bm.verts:
        for e in v.link_edges:
            o = e.other_vert(v)
            nbrs[v.index].append((o.index, e.calc_length()))
        for co, j, d in kd.find_range(v.co, 0.004):
            if j != v.index:
                nbrs[v.index].append((j, d))
    dist = {v.index: 0.0 for v in roots}
    pq = [(0.0, v.index) for v in roots]
    while pq:
        d, i = heapq.heappop(pq)
        if d > dist.get(i, 1e9):
            continue
        for j, w in nbrs[i]:
            nd = d + w
            if nd < dist.get(j, 1e9):
                dist[j] = nd
                heapq.heappush(pq, (nd, j))
    total = min(max_len, max(dist.values()))
    bins = [[] for _ in range(NODES)]
    for i, d in dist.items():
        if d > total:
            continue
        k = min(NODES - 1, int(d / total * NODES))
        bins[k].append(bm.verts[i].co.copy())
    bm.free()
    pts, radii = [], []
    for b in bins:
        if not b:
            continue
        c = sum(b, Vector()) / len(b)
        pts.append(c)
        radii.append(sum((p - c).length for p in b) / len(b))
    # Suavizado (sin mover los extremos) y radios plausibles.
    for _ in range(3):
        pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
    r = sorted(radii)[len(radii) // 2]
    radii = [min(max(x, r * 0.75), r * 1.25) for x in radii]
    return pts, radii


def tube(name, pts, radii):
    bm = bmesh.new()
    samples = []
    for i in range(len(pts) - 1):
        for s in range(SUB):
            t = s / SUB
            samples.append((pts[i].lerp(pts[i + 1], t), radii[i] * (1 - t) + radii[i + 1] * t, i + t))
    samples.append((pts[-1], radii[-1], len(pts) - 1))
    prev_n = None
    rings = []
    for k, (c, r, u) in enumerate(samples):
        a = samples[max(0, k - 1)][0]
        b = samples[min(len(samples) - 1, k + 1)][0]
        tng = (b - a).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(tng.z) < 0.9 else Vector((1, 0, 0))
            prev_n = tng.cross(ref).normalized()
        n = (prev_n - tng * prev_n.dot(tng)).normalized()  # transporte paralelo
        prev_n = n
        bnm = tng.cross(n)
        ring = []
        for j in range(RING):
            ang = 2 * math.pi * j / RING
            ring.append(bm.verts.new(c + (n * math.cos(ang) + bnm * math.sin(ang)) * r))
        rings.append((ring, u))
    for k in range(len(rings) - 1):
        r0, r1 = rings[k][0], rings[k + 1][0]
        for j in range(RING):
            bm.faces.new((r0[j], r0[(j + 1) % RING], r1[(j + 1) % RING], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = True
    params = [u for ring, u in rings for _ in range(RING)]
    return obj, params


def main():
    open_work("04_fracture.blend")
    out = collection("heart_export")
    # Desplazamiento del origen aplicado en 02 (Hips en el origen): comparar la aorta de 01 y de 04.
    cur_aorta = [o for o in bpy.data.collections["aorta"].objects]
    src = load_from_01({"heart", "aorta"})
    src_aorta = [o for o in src if o.name.startswith("src01_aorta")]
    walls = [o for o in src if o.name.startswith("src01_heart")]
    offset = centroid_of(cur_aorta) - centroid_of(src_aorta)
    for o in src_aorta:
        bpy.data.objects.remove(o)
    for o in walls:
        o.data.transform(Matrix.Translation(offset))
    heart = join(walls, "heart")
    decimate_to(heart, HEART_TRIS)
    center = centroid_of([heart])
    flesh = material("flesh", color=(0.5, 0.05, 0.06, 1.0), roughness=0.25)
    vessel_mat = material("vessel", color=(0.55, 0.08, 0.1, 1.0), roughness=0.3)
    set_material(heart, flesh)
    move_to_collection(heart, out)
    log(f"  corazón: centro {tuple(round(c, 3) for c in center)}, desplazamiento {tuple(round(c, 3) for c in offset)}")

    data = bpy.data.armatures.new("HeartRig")
    rig = bpy.data.objects.new("HeartRig", data)
    bpy.context.scene.collection.objects.link(rig)
    move_to_collection(rig, out)
    info = {}
    chains = {}
    for name in ("aorta", "pulmonary", "svc", "ivc"):
        objs = [o.copy() for o in bpy.data.collections[name].objects]
        for o in objs:
            o.data = o.data.copy()
            bpy.context.scene.collection.objects.link(o)
        src_obj = join(objs, f"src_{name}")
        pts, radii = geodesic_centerline(src_obj, center, MAX_LEN[name])
        bpy.data.objects.remove(src_obj)
        chains[name] = (pts, radii)
        length = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
        info[name] = {"nodes": len(pts), "radius": round(sum(radii) / len(radii), 4), "length": round(length, 4)}
        log(f"  {name:9s} {len(pts)} nodos, largo {length:.3f} m, radio {info[name]['radius']}")

    activate(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    root = data.edit_bones.new("Heart")
    root.head = center
    root.tail = center + Vector((0, 0, 0.05))
    for name, (pts, _) in chains.items():
        parent = root
        for i in range(len(pts) - 1):
            b = data.edit_bones.new(f"{name}_{i:02d}")
            b.head = pts[i]
            b.tail = pts[i + 1]
            b.parent = parent
            b.use_connect = i > 0
            parent = b
    bpy.ops.object.mode_set(mode="OBJECT")

    def bind(obj, weights):
        obj.parent = rig
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        for vi, ws in enumerate(weights):
            for g, w in ws:
                vg = obj.vertex_groups.get(g) or obj.vertex_groups.new(name=g)
                vg.add([vi], w, "REPLACE")

    bind(heart, [[("Heart", 1.0)]] * len(heart.data.vertices))
    heart["donante_role"] = "heart"
    heart["donante_center"] = to_gltf(center)
    for name, (pts, radii) in chains.items():
        obj, params = tube(f"vessel_{name}", pts, radii)
        set_material(obj, vessel_mat)
        move_to_collection(obj, out)
        nb = len(pts) - 1
        weights = []
        for u in params:
            ws = []
            for j in range(nb):
                w = max(0.0, 1.0 - abs(u - (j + 0.5)))
                if w > 0:
                    ws.append((f"{name}_{j:02d}", w))
            if not ws:
                ws = [(f"{name}_{min(nb - 1, int(u)):02d}", 1.0)]
            s = sum(w for _, w in ws)
            weights.append([(g, w / s) for g, w in ws])
        bind(obj, weights)
        obj["donante_role"] = "vessel"
        obj["donante_vessel"] = name
    rig["donante_vessels"] = json.dumps(info)
    save_work("05_heart.blend")


main()
