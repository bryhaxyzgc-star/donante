# 04 · Fractura de las costillas del cerdo en piezas (§5.3, §10.1).
#   blender -b --factory-startup -P blender/scripts/04_fracture_ribs.py
# Entrada: work/03_pig.blend · Salida: work/04_fracture.blend
# Cell Fracture dejó de venir con Blender desde la 4.2 (ahora es una extensión aparte); esta es una
# fractura de Voronoi equivalente con bmesh: cada celda = la costilla recortada por los planos
# bisectores hacia las demás semillas, con las caras de corte rellenas y en material "marrow".
# Semillas más densas en el tercio anterior (donde se abre el pecho) → astillas finas.
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import collection, log, material, move_to_collection, open_work, save_work  # noqa: E402
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

PIECES = {"default": 10, "short": 7}


def seeds_for(obj, n, rng):
    vs = [v.co.copy() for v in obj.data.vertices]
    # Orden a lo largo de la costilla por distancia a la cabeza (vértice más medial y posterior).
    head = min(vs, key=lambda c: abs(c.x) * 2 + c.y * -0.5)
    vs.sort(key=lambda c: (c - head).length)
    out = []
    for i in range(n):
        # Más semillas hacia el extremo anterior: u^0.6 concentra al final.
        u = (i + rng.uniform(0.15, 0.85)) / n
        u = u ** 0.6
        c = vs[min(len(vs) - 1, int(u * (len(vs) - 1)))]
        out.append(c + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.004)
    return out


def cell(src_mesh, pts, i):
    bm = bmesh.new()
    bm.from_mesh(src_mesh)
    p = pts[i]
    for j, q in enumerate(pts):
        if j == i:
            continue
        nrm = (q - p).normalized()
        mid = (p + q) * 0.5
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=mid, plane_no=nrm, clear_outer=True, dist=1e-6)
        boundary = [e for e in bm.edges if e.is_boundary]
        if boundary:
            res = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
            for f in res["faces"]:
                f.material_index = 1
        if not bm.faces:
            break
    if not bm.faces:
        bm.free()
        return None
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("frag")
    bm.to_mesh(me)
    bm.free()
    return me


def main():
    open_work("03_pig.blend")
    src = bpy.data.collections["pig_rib_sources"]
    frags = collection("pig_fragments")
    bone_mat = bpy.data.materials.get("bone") or material("bone")
    marrow = material("marrow", color=(0.45, 0.05, 0.06, 1.0), roughness=0.7)
    rng = random.Random(348)  # DONANTE N.º 0348
    count = 0
    for rib in sorted(src.objects, key=lambda o: o.name):
        idx = int(rib["donante_rib"])
        n = PIECES["short"] if idx in (1, 13, 14) else PIECES["default"]
        pts = seeds_for(rib, n, rng)
        for k in range(n):
            me = cell(rib.data, pts, k)
            if me is None or len(me.polygons) < 4:
                continue
            obj = bpy.data.objects.new(f"rib_frag_{rib['donante_side']}_{idx:02d}_{k:02d}", me)
            me.name = obj.name
            me.materials.append(bone_mat)
            me.materials.append(marrow)
            for poly in me.polygons:
                poly.use_smooth = poly.material_index == 0
            bpy.context.scene.collection.objects.link(obj)
            move_to_collection(obj, frags)
            obj["donante_role"] = "fragment"
            obj["donante_rib"] = idx
            obj["donante_side"] = rib["donante_side"]
            obj["donante_piece"] = k
            obj["donante_bone"] = "Spine2"
            count += 1
    log(f"  {count} fragmentos de {len(src.objects)} costillas")
    save_work("04_fracture.blend")


main()
