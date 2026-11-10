# 02 · Armadura humanoide (nombres Mixamo) desde las articulaciones REALES de BodyParts3D,
#      parentado rígido hueso→bone (por metadatos), piel y músculo con pesos automáticos.
#   blender -b --factory-startup -P blender/scripts/02_rig_human.py
# Entrada: work/01_anatomy.blend · Salida: work/02_human.blend + work/human_joints.json
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    BONE_NAMES, PARENT, activate, apply_transforms, collection, decimate_to, deselect_all, join, log, material,
    move_to_collection, open_work, save_work, set_material, to_gltf, tri_count, write_json,
)
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

# Presupuesto de triángulos por slot (cuerpo vivo ≈ 150 k en HIGH, §5.1).
BUDGET = {
    "skull": 16000, "teeth": 3000, "cervical": 3000, "thoracic": 5000, "lumbar": 2500, "ribs": 12000,
    "cartilage": 2500, "clavicle": 1000, "scapula": 2500, "pelvis": 7000, "humerus": 2500, "forearm": 2000,
    "hand": 4000, "femur": 2500, "patella": 400, "leg": 2500, "foot": 4500,
}
SKIN_TRIS = 26000
MUSCLE_TRIS = 36000
HEART_TRIS = 9000
LIVER_TRIS = 3000

# ── utilidades numpy ─────────────────────────────────────────────


def verts(objs):
    out = []
    for o in objs:
        me = o.data
        a = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", a)
        a = a.reshape(-1, 3)
        mw = np.array(o.matrix_world)
        out.append(a @ mw[:3, :3].T + mw[:3, 3])
    return np.concatenate(out) if out else np.zeros((0, 3))


def sphere_fit(p):
    a = np.c_[2 * p, np.ones(len(p))]
    b = (p ** 2).sum(1)
    sol = np.linalg.lstsq(a, b, rcond=None)[0]
    return sol[:3]


def objs_of(group, side=None, name=None):
    col = bpy.data.collections.get(group)
    if not col:
        return []
    out = []
    for o in col.objects:
        if side and o.get("side") != side:
            continue
        if name and name not in o.get("names", "").split(";"):
            continue
        out.append(o)
    return out


def region(p, axis, lo=None, hi=None):
    v = p[:, axis]
    m = np.ones(len(p), bool)
    if lo is not None:
        m &= v >= lo
    if hi is not None:
        m &= v <= hi
    return p[m]


# ── articulaciones ───────────────────────────────────────────────


def estimate_joints():
    J = {}
    X, Y, Z = 0, 1, 2
    for side, sx in (("L", 1), ("R", -1)):
        P = "Left" if side == "L" else "Right"
        fem = verts(objs_of("femur", side))
        top = region(fem, Z, lo=fem[:, Z].max() - 0.055)
        med = top[(top[:, X] * sx) < (top[:, X] * sx).min() + 0.05]
        J[f"{P}UpLeg"] = sphere_fit(med)
        tib = verts([o for o in objs_of("leg", side) if "tibia" in o["names"].split(";")])
        knee = (region(fem, Z, hi=fem[:, Z].min() + 0.025).mean(0) + region(tib, Z, lo=tib[:, Z].max() - 0.02).mean(0)) / 2
        J[f"{P}Leg"] = knee
        talus = verts(objs_of("foot", side, "talus"))
        J[f"{P}Foot"] = (talus.mean(0) + region(tib, Z, hi=tib[:, Z].min() + 0.02).mean(0)) / 2
        heads = []
        for o in objs_of("foot", side, "metatarsal bone"):
            v = verts([o])
            heads.append(v[v[:, Y] <= np.quantile(v[:, Y], 0.15)].mean(0))
        J[f"{P}ToeBase"] = np.mean(heads, 0)
        foot = verts(objs_of("foot", side))
        J[f"{P}Toe_End"] = foot[foot[:, Y] <= foot[:, Y].min() + 0.01].mean(0)

        hum = verts(objs_of("humerus", side))
        top = region(hum, Z, lo=hum[:, Z].max() - 0.05)
        med = top[(top[:, X] * sx) < (top[:, X] * sx).min() + 0.045]
        J[f"{P}Arm"] = sphere_fit(med)
        clav = verts(objs_of("clavicle", side))
        J[f"{P}Shoulder"] = clav[(clav[:, X] * sx) < (clav[:, X] * sx).min() + 0.015].mean(0)
        rad = verts([o for o in objs_of("forearm", side) if "radius" in o["names"].split(";")])
        J[f"{P}ForeArm"] = (region(hum, Z, hi=hum[:, Z].min() + 0.02).mean(0) + region(rad, Z, lo=rad[:, Z].max() - 0.015).mean(0)) / 2
        carp = verts(objs_of("hand", side, "carpal bone"))
        J[f"{P}Hand"] = (region(rad, Z, hi=rad[:, Z].min() + 0.015).mean(0) + carp.mean(0)) / 2
        hand = verts(objs_of("hand", side))
        J[f"{P}Hand_End"] = hand[hand[:, Z] <= hand[:, Z].min() + 0.01].mean(0)

    # Columna: cuerpos vertebrales (40 % anterior de cada vértebra), de C1 a L5.
    vert = sorted(objs_of("vertebra"), key=lambda o: -verts([o])[:, Z].mean())
    bodies = []
    for o in vert:
        v = verts([o])
        front = v[v[:, Y] <= v[:, Y].min() + 0.4 * (v[:, Y].max() - v[:, Y].min())]
        bodies.append(front.mean(0))
    bodies = np.array(bodies)
    hipmid = (J["LeftUpLeg"] + J["RightUpLeg"]) / 2
    J["Hips"] = np.array([0.0, hipmid[Y], hipmid[Z] + 0.05])

    def axial(z, y):
        return np.array([0.0, y, z])

    L = bodies[19:24]  # L1..L5
    T = bodies[7:19]   # T1..T12
    C = bodies[0:7]    # C1..C7
    J["Spine"] = axial(L[3][Z], L[3][Y] - 0.03)
    J["Spine1"] = axial((T[11][Z] + L[0][Z]) / 2, (T[11][Y] + L[0][Y]) / 2 - 0.035)
    J["Spine2"] = axial(T[6][Z], T[6][Y] - 0.05)
    J["Neck"] = axial((C[6][Z] + T[0][Z]) / 2, (C[6][Y] + T[0][Y]) / 2 - 0.01)
    atlas = verts([vert[0]])
    J["Head"] = axial(atlas[:, Z].mean() + 0.008, atlas[:, Y].mean())
    skull = verts(objs_of("skull"))
    J["HeadTop_End"] = axial(skull[:, Z].max(), skull[:, Y].mean())
    return {k: Vector(v.tolist()) for k, v in J.items()}, vert, bodies


# ── armadura ─────────────────────────────────────────────────────

MAIN_CHILD = {"Hips": "Spine", "Spine2": "Neck"}


def build_armature(J):
    data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", data)
    bpy.context.scene.collection.objects.link(arm)
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name in BONE_NAMES:
        b = data.edit_bones.new(name)
        b.head = J[name]
        eb[name] = b
    children = {n: [c for c in BONE_NAMES if PARENT[c] == n] for n in BONE_NAMES}
    for name in BONE_NAMES:
        b = eb[name]
        kids = children[name]
        child = MAIN_CHILD.get(name) or (kids[0] if len(kids) == 1 else None)
        if child:
            b.tail = J[child]
        else:
            par = PARENT[name]
            d = (J[name] - J[par]).normalized() if par else Vector((0, 0, 1))
            b.tail = J[name] + d * 0.04
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.02))
        if PARENT[name]:
            b.parent = eb[PARENT[name]]
        b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for name in BONE_NAMES:
        # Los extremos no deforman (no roban pesos de dedos ni coronilla).
        data.bones[name].use_deform = not name.endswith("_End")
    return arm


# ── pesos ────────────────────────────────────────────────────────
# El pesado por calor de Blender falla con la pose anatómica de BodyParts3D: los brazos cuelgan
# pegados al torso y la piel del costado se va con el brazo ("alas" al levantarlo). Este pesado
# usa distancia a los segmentos de bone con REGIONES anatómicas permitidas por vértice:
#   - nunca el miembro del lado contrario; piernas solo por debajo de la cadera;
#   - en la franja brazo/torso decide la normal: la cara interna del brazo mira al centro,
#     el costado del tórax mira hacia afuera;
#   - cada músculo, solo los bones de su región FMA (miembro superior libre, hombro, tronco…).

REGION = {"other": 0, "free_upper": 1, "shoulder": 2, "trunk": 3, "free_lower": 4, "pelvic": 5, "neck": 6, "head": 7}


def muscle_region(names):
    n = set(names.split(";"))
    if "muscle of free upper limb" in n:
        return REGION["free_upper"]
    if "muscle of shoulder" in n:
        return REGION["shoulder"]
    if "muscle of free lower limb" in n:
        return REGION["free_lower"]
    if "muscle of pelvic girdle" in n:
        return REGION["pelvic"]
    if n & {"muscle of head", "muscle of face"}:
        return REGION["head"]
    if "muscle of neck" in n:
        return REGION["neck"]
    if n & {"muscle of pectoral girdle", "muscle of thorax", "muscle of trunk", "muscle of vertebral column",
            "muscle of abdomen", "muscle of back"}:
        return REGION["trunk"]
    return REGION["other"]


def mesh_normals(obj):
    me = obj.data
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", a)
    return a.reshape(-1, 3)


def arm_axis_x(J, side, z):
    """|x| del eje del brazo colgando a la altura z (interpolado por las articulaciones)."""
    P = "Left" if side > 0 else "Right"
    chain = [J[f"{P}Arm"], J[f"{P}ForeArm"], J[f"{P}Hand"], J[f"{P}Hand_End"]]
    zs = np.array([c.z for c in chain])[::-1]
    xs = np.array([abs(c.x) for c in chain])[::-1]
    return np.interp(z, zs, xs)


def region_weights(obj, arm, J, regions=None, sigma=0.03, arm_label=None):
    deform = [b for b in arm.data.bones if b.use_deform]
    names = [b.name for b in deform]
    idx = {n: i for i, n in enumerate(names)}

    def ids(*ns):
        return [idx[n] for n in ns if n in idx]

    TORSO = ids("Hips", "Spine", "Spine1", "Spine2", "Neck", "Head")
    SH = {1: ids("LeftShoulder"), -1: ids("RightShoulder")}
    ARM = {1: ids("LeftArm", "LeftForeArm", "LeftHand"), -1: ids("RightArm", "RightForeArm", "RightHand")}
    LEG = {1: ids("LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"),
           -1: ids("RightUpLeg", "RightLeg", "RightFoot", "RightToeBase")}

    V = verts([obj])
    Nn = mesh_normals(obj)
    N, B = len(V), len(deform)
    heads = np.array([b.head_local for b in deform])
    tails = np.array([b.tail_local for b in deform])
    ab = tails - heads
    t = np.clip(((V[:, None, :] - heads[None]) * ab[None]).sum(-1) / np.maximum((ab ** 2).sum(-1)[None], 1e-9), 0, 1)
    D = np.linalg.norm(V[:, None, :] - (heads[None] + t[..., None] * ab[None]), axis=-1)

    allow = np.zeros((N, B), bool)
    arm_vertex = np.zeros(N, bool)
    side = np.where(V[:, 0] >= 0, 1, -1)
    hip_z = J["LeftUpLeg"].z
    sh_z = J["LeftArm"].z
    for s in (1, -1):
        m = side == s
        if regions is None:
            allow[np.ix_(m, TORSO + SH[s] + ARM[s] + LEG[s])] = True
            # Piernas solo por debajo de la cadera.
            allow[np.ix_(m & (V[:, 2] > hip_z + 0.06), LEG[s])] = False
            # Franja brazo/torso: desde la axila hasta la punta de los dedos.
            band = m & (V[:, 2] < sh_z - 0.03) & (V[:, 2] > J["LeftHand_End"].z - 0.02)
            rel = np.abs(V[:, 0]) - arm_axis_x(J, s, V[:, 2])
            n_med = -Nn[:, 0] * s  # > 0: la normal mira hacia el centro del cuerpo
            if arm_label is not None:
                is_arm = band & arm_label
            else:
                is_arm = band & (((rel > -0.02) & ~((n_med < -0.3) & (rel < -0.005))) | ((n_med > 0.35) & (rel > -0.06)))
            not_arm = band & ~is_arm
            allow[np.ix_(is_arm, TORSO + LEG[s])] = False
            allow[np.ix_(is_arm & (V[:, 2] > sh_z - 0.1), SH[s] + ids("Spine2"))] = True
            allow[np.ix_(not_arm, ARM[s])] = False
            # Fuera de la franja (muslo bajo la mano, cadera): sin peso de brazo salvo en el hombro.
            # Un 3 % de peso de mano en el muslo lo arrastra varios cm al levantar el brazo.
            allow[np.ix_(m & ~is_arm & (V[:, 2] < sh_z - 0.1), ARM[s])] = False
            arm_vertex |= is_arm
            continue
        for r in np.unique(regions[m]):
            mr = m & (regions == r)
            if r == REGION["free_upper"]:
                cols = ARM[s]
            elif r == REGION["shoulder"]:
                cols = SH[s] + ARM[s][:1] + ids("Spine2")
            elif r == REGION["free_lower"]:
                cols = LEG[s]
            elif r == REGION["pelvic"]:
                cols = ids("Hips", "Spine") + LEG[s][:1]
            elif r == REGION["neck"]:
                cols = ids("Neck", "Spine2", "Head")
            elif r == REGION["head"]:
                cols = ids("Head")
            else:
                cols = TORSO + SH[1] + SH[-1]
            allow[np.ix_(mr, cols)] = True
    empty = ~allow.any(1)
    allow[empty] = True
    Dm = np.where(allow, D, np.inf)
    W = np.exp(-(Dm - Dm.min(1, keepdims=True)) / sigma)
    top = np.argsort(-W, 1)[:, :4]
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    for vi in range(N):
        ws = W[vi, top[vi]]
        ws = ws / ws.sum()
        for k in range(4):
            if ws[k] > 0.01:
                groups[names[top[vi, k]]].add([vi], float(ws[k]), "REPLACE")
    return int(empty.sum()), arm_vertex


def classify_arm_skin(skin, J, repair=False):
    """Vértice de piel = brazo si está más cerca de los huesos del brazo que de los del tronco
    (costillas, vértebras, pelvis, escápula, clavícula, fémur). La normal desempata en el contacto
    y un suavizado por vecindad elimina islas sueltas."""
    from mathutils.kdtree import KDTree

    def tree(names):
        pts = np.concatenate([verts([bpy.data.objects[n]]) for n in names if bpy.data.objects.get(n)])
        kd = KDTree(len(pts))
        for i, p in enumerate(pts):
            kd.insert(p, i)
        kd.balance()
        return kd

    V = verts([skin])
    Nn = mesh_normals(skin)
    label = np.zeros(len(V), bool)
    dist_arm = np.full(len(V), 1.0)
    # Semillas: 1 = brazo seguro, 0 = tronco seguro, -1 = dudoso. El centro del cuerpo es tronco.
    seed = np.where(np.abs(V[:, 0]) <= 0.02, 0, -1).astype(np.int8)
    trunk_names = ["ribs_human", "thoracic_human", "thoracic_human_Spine1", "lumbar_human", "lumbar_human_Spine",
                   "lumbar_human_Hips", "pelvis_human", "cartilage_human"]
    for s, tag in ((1, "L"), (-1, "R")):
        arm_names = [f"humerus_{tag}_human", f"forearm_{tag}_human", f"hand_{tag}_human"]
        arm_kd = tree(arm_names)
        trunk_kd = tree(trunk_names + [f"scapula_{tag}_human", f"clavicle_{tag}_human", f"femur_{tag}_human"])
        # Perfil del borde medial del brazo por altura (|x| mínimo de sus huesos en franjas de 5 mm).
        av = np.concatenate([verts([bpy.data.objects[n]]) for n in arm_names])
        zb = np.floor(av[:, 2] / 0.005).astype(int)
        medial = {}
        for zz, xx in zip(zb, np.abs(av[:, 0])):
            medial[zz] = min(medial.get(zz, 9.0), xx)
        m = np.where((V[:, 0] * s) > 0.02)[0]
        for i in m:
            ca, _, da = arm_kd.find(V[i])
            ct, _, dt = trunk_kd.find(V[i])
            dist_arm[i] = da
            # La normal de la piel apunta en sentido CONTRARIO a su propio hueso. Si un vértice mira
            # hacia el hueso del brazo, da la espalda al del tronco y está por dentro de TODO el brazo
            # a esa altura, es el costado/muslo que toca el brazo (no la palma frente a los dedos).
            n = Vector(Nn[i].tolist())
            p = Vector(V[i].tolist())
            f_arm = n.dot((ca - p).normalized()) if da > 1e-6 else -1.0
            f_trunk = n.dot((ct - p).normalized()) if dt > 1e-6 else -1.0
            zz = int(np.floor(V[i, 2] / 0.005))
            edge = min(medial.get(zz + k, 9.0) for k in (-2, -1, 0, 1, 2))
            inside_of_arm = abs(V[i, 0]) < edge - 0.005
            if f_arm > 0.25 and f_trunk < 0.0 and inside_of_arm:
                seed[i] = 0
            elif f_trunk > 0.25 and f_arm < 0.0:
                seed[i] = 1
            elif da < dt - 0.005 and da < 0.03:
                seed[i] = 1
            elif dt < da - 0.005:
                seed[i] = 0
    # Crecimiento de regiones: los vértices dudosos (pliegues entre dedos, contacto mano-muslo)
    # toman la etiqueta de la semilla más cercana a lo largo de la superficie.
    me = skin.data
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    lab = seed.copy()
    lab[lab < 0] = -1
    frontier = [i for i in range(len(lab)) if lab[i] >= 0]
    while frontier:
        nxt = []
        for i in frontier:
            for j in nb[i]:
                if lab[j] < 0:
                    lab[j] = lab[i]
                    nxt.append(j)
        frontier = nxt
    label = lab == 1
    for _ in range(3):
        new = label.copy()
        for i, ns in enumerate(nb):
            if ns and seed[i] < 0:  # solo los dudosos: las semillas no se voltean
                frac = label[ns].mean()
                if frac > 0.7:
                    new[i] = True
                elif frac < 0.3:
                    new[i] = False
        label = new
    if not repair:
        log(f"  piel: {int(label.sum())} vértices de brazo de {len(label)}")
        return label
    # Cirugía: en BodyParts3D el brazo está apretado contra el cuerpo y el costado del torso (y el
    # muslo bajo la mano) INVADE el volumen del brazo; al levantarlo quedaría una cortina. Se borran
    # esos vértices de tronco y el agujero se cierra con un parche subdividido y suavizado.
    band = (V[:, 2] < J["LeftArm"].z - 0.03) & (V[:, 2] > J["LeftHand_End"].z - 0.02)
    contact = np.where(band & ~label & (dist_arm < 0.045))[0]
    bm = bmesh.new()
    bm.from_mesh(skin.data)
    bm.verts.ensure_lookup_table()
    lay = bm.verts.layers.int.new("arm")
    for v in bm.verts:
        v[lay] = int(label[v.index])
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in contact], context="VERTS")
    # Cortar también la frontera brazo/tronco en la franja: así quedan dos agujeros separados
    # (cara interna del brazo y flanco) y cada parche pertenece a un solo lado.
    lim = J["LeftArm"].z - 0.05
    cross = [e for e in bm.edges if e.verts[0][lay] != e.verts[1][lay] and min(v.co.z for v in e.verts) < lim]
    bmesh.ops.delete(bm, geom=cross, context="EDGES")
    bm.verts.layers.int.remove(lay)
    boundary = [e for e in bm.edges if e.is_boundary]
    faces = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)["faces"]
    faces = bmesh.ops.triangulate(bm, faces=faces, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"]
    ring = {v for f in faces for v in f.verts}
    sub = bmesh.ops.subdivide_edges(bm, edges=list({e for f in faces for e in f.edges}), cuts=2, use_grid_fill=True)
    patch = ring | {g for g in sub["geom_inner"] + sub["geom_split"] if isinstance(g, bmesh.types.BMVert)}
    patch = [v for v in patch if v.is_valid]
    for _ in range(25):
        bmesh.ops.smooth_vert(bm, verts=list(patch), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(skin.data)
    bm.free()
    for p in skin.data.polygons:
        p.use_smooth = True
    log(f"  piel: {len(contact)} vértices de contacto quitados, {len(boundary)} aristas de borde parchadas")
    return None


def skin_to(obj, arm, J, regions=None, sigma=0.03, arm_label=None):
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    fallback, arm_vertex = region_weights(obj, arm, J, regions, sigma, arm_label)
    cut = 0
    if regions is None:
        # La piel de BodyParts3D está fusionada donde el brazo toca el costado y la mano el muslo:
        # esas caras puente mezclan vértices de brazo y de torso/pierna. Se cortan (bajo la axila)
        # para que al levantar el brazo no se estire una membrana.
        # Se borran las ARISTAS que cruzan etiquetas (con sus caras): si quedaran, el suavizado de
        # pesos se filtraría por ellas y volvería a mezclar mano con muslo.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        lim = J["LeftArm"].z - 0.05
        kill = [e for e in bm.edges
                if arm_vertex[e.verts[0].index] != arm_vertex[e.verts[1].index] and min(v.co.z for v in e.verts) < lim]
        cut = len(kill)
        bmesh.ops.delete(bm, geom=kill, context="EDGES")
        bm.to_mesh(obj.data)
        bm.free()
    activate(obj)
    # Limpieza (codos, hombros): suavizar, máximo 4 influencias, normalizar. Requiere modo pesos.
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.35, repeat=2)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"  pesos {obj.name}: {len(obj.vertex_groups)} grupos, {fallback} vértices sin región, {cut} caras puente cortadas")


# ── principal ────────────────────────────────────────────────────


def smooth_face(skin, J):
    """Borra rasgos de la cara (el cuerpo de BodyParts3D proviene de una persona real)."""
    head, top = J["Head"], J["HeadTop_End"]
    bm = bmesh.new()
    bm.from_mesh(skin.data)
    face = [v for v in bm.verts if v.co.z > head.z - 0.03 and v.co.z < top.z - 0.03 and v.co.y < head.y - 0.02]
    for _ in range(25):
        bmesh.ops.smooth_vert(bm, verts=face, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(skin.data)
    bm.free()
    log(f"  cara neutralizada: {len(face)} vértices suavizados")


def fiber_attribute(obj):
    """Dirección principal (PCA) del músculo como color de vértice → atributo `fiber` en la app."""
    v = verts([obj])
    c = v - v.mean(0)
    _, _, vt = np.linalg.svd(c[:: max(1, len(c) // 2000)], full_matrices=False)
    d = Vector(vt[0].tolist()).normalized()
    g = to_gltf(d)
    col = (0.5 + 0.5 * g[0], 0.5 + 0.5 * g[1], 0.5 + 0.5 * g[2], 1.0)
    attr = obj.data.color_attributes.new("fiber", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", list(col) * len(obj.data.vertices))


def tag(obj, **kw):
    for k, v in kw.items():
        obj[f"donante_{k}"] = v


def main():
    open_work("01_anatomy.blend")
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            apply_transforms(o)
    J, vert_objs, bodies = estimate_joints()

    # Origen del modelo en Hips (la app lo asume para ubicar la raíz).
    off = -J["Hips"].copy()
    T = Matrix.Translation(off)
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.transform(T)
    J = {k: v + off for k, v in J.items()}
    bodies = bodies + np.array(off)
    for k in BONE_NAMES:
        log(f"  {k:14s} {tuple(round(c, 3) for c in J[k])}")

    # Medidas del tórax (antes de unir las piezas): para el cerdo y los pulmones procedurales.
    ribs = np.concatenate([verts([o]) for o in objs_of("ribs") if "rib" in o["names"].split(";")])
    manu = verts([o for o in objs_of("ribs") if "manubrium" in o["names"].split(";")])
    xiph = verts([o for o in objs_of("ribs") if "xiphoid process" in o["names"].split(";")])
    chest = {
        "chestHalfWidth": float(np.abs(ribs[:, 0]).max()),
        "chestDepth": float(ribs[:, 1].max() - ribs[:, 1].min()),
        "chestTop": float(ribs[:, 2].max()),
        "chestBottom": float(ribs[:, 2].min()),
        "sternumTop": to_gltf(Vector(manu[manu[:, 2].argmax()].tolist())),
        "sternumBottom": to_gltf(Vector(xiph[xiph[:, 2].argmin()].tolist())),
    }
    log(f"  tórax: {chest}")

    arm = build_armature(J)
    mats = {"bone": material("bone"), "teeth": material("teeth"), "cartilage": material("cartilage"),
            "skin": material("skin"), "muscle": material("muscle"), "organ": material("organ")}
    out = collection("human_export")

    # Vértebras por altura → (slot, bone).
    def vert_slot(i):
        if i < 6:
            return "cervical", "Neck"
        if i == 6:
            return "cervical", "Spine2"
        if i < 16:
            return "thoracic", "Spine2"
        if i < 19:
            return "thoracic", "Spine1"
        if i == 19:
            return "lumbar", "Spine1"
        if i < 23:
            return "lumbar", "Spine"
        return "lumbar", "Hips"

    groups = {}
    for i, o in enumerate(vert_objs):
        groups.setdefault(vert_slot(i), []).append(o)
    simple = {"skull": ("skull", "Head", "bone"), "teeth": ("teeth", "Head", "teeth"), "pelvis": ("pelvis", "Hips", "bone"),
              "ribs": ("ribs", "Spine2", "bone"), "cartilage": ("cartilage", "Spine2", "cartilage")}
    for g, (slot, bone, mat) in simple.items():
        groups.setdefault((slot, bone, mat), []).extend(objs_of(g))
    paired = {"clavicle": "Shoulder", "scapula": "Shoulder", "humerus": "Arm", "forearm": "ForeArm", "hand": "Hand",
              "femur": "UpLeg", "patella": "Leg", "leg": "Leg", "foot": "Foot"}
    for g, b in paired.items():
        for side in ("L", "R"):
            groups.setdefault((f"{g}_{side}", ("Left" if side == "L" else "Right") + b, "bone"), []).extend(objs_of(g, side))
    total = 0
    for key, objs in groups.items():
        slot, bone = key[0], key[1]
        mat = key[2] if len(key) > 2 else "bone"
        base = slot.split("_")[0]
        budget = BUDGET.get(base, 2000) // (2 if base == "teeth" else 1)
        name = f"{slot}_human" if mat != "teeth" else "teeth_human"
        obj = join(objs, name if bpy.data.objects.get(name) is None else f"{name}_{bone}")
        if obj is None:
            log("  sin piezas para", key)
            continue
        tris = decimate_to(obj, budget if base not in ("cervical", "thoracic", "lumbar") else budget // 2)
        set_material(obj, mats[mat])
        move_to_collection(obj, out)
        tag(obj, role="bone", slot=slot if mat != "teeth" else "skull", bone=bone, material=mat, species="human")
        total += tris
        log(f"  {obj.name:24s} → {bone:13s} {tris:6d} tris")
    log(f"  huesos: {total} tris")

    # Piel.
    skin = objs_of("skin")[0]
    decimate_to(skin, SKIN_TRIS)
    smooth_face(skin, J)
    skin.name = "skin"
    set_material(skin, mats["skin"])
    move_to_collection(skin, out)
    classify_arm_skin(skin, J, repair=True)  # quita el tejido aplastado entre brazo y tronco
    skin_to(skin, arm, J, arm_label=classify_arm_skin(skin, J))
    tag(skin, role="skin")

    # Músculos: decimar cada uno según su tamaño, fibra por PCA, región FMA, unir y pesar.
    muscles = objs_of("muscle")
    tot = sum(tri_count(o) for o in muscles)
    ratio = MUSCLE_TRIS / max(1, tot)
    for o in muscles:
        decimate_to(o, max(80, int(tri_count(o) * ratio)))
        fiber_attribute(o)
        reg = o.data.attributes.new("region", "INT", "POINT")
        reg.data.foreach_set("value", [muscle_region(o.get("names", ""))] * len(o.data.vertices))
    muscle = join(muscles, "muscle")
    muscle.data.color_attributes.active_color = muscle.data.color_attributes["fiber"]
    set_material(muscle, mats["muscle"])
    move_to_collection(muscle, out)
    regions = np.empty(len(muscle.data.vertices), dtype=np.int32)
    muscle.data.attributes["region"].data.foreach_get("value", regions)
    skin_to(muscle, arm, J, regions, sigma=0.025)
    muscle.data.attributes.remove(muscle.data.attributes["region"])
    tag(muscle, role="muscle")
    log(f"  músculo: {tri_count(muscle)} tris, piel: {tri_count(skin)} tris")

    # Órganos rígidos: corazón con el arranque de los grandes vasos, hígado.
    heart_parts = objs_of("heart") + [o.copy() for o in objs_of("aorta") + objs_of("pulmonary") + objs_of("svc")]
    for o in heart_parts:
        if o.name not in bpy.context.scene.collection.all_objects:
            bpy.context.scene.collection.objects.link(o)
            o.data = o.data.copy()
    heart = join(heart_parts, "heart_organ")
    decimate_to(heart, HEART_TRIS)
    liver = join(objs_of("liver"), "liver_organ")
    decimate_to(liver, LIVER_TRIS)
    for obj, organ, bone in ((heart, "heart", "Spine2"), (liver, "liver", "Spine1")):
        set_material(obj, mats["organ"])
        move_to_collection(obj, out)
        c = sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
        tag(obj, role="organ", organ=organ, bone=bone, center=to_gltf(c))

    meta = {
        "restPose": "anatomica (BodyParts3D, palmas al frente)",
        # Palmas al frente: el dorso de la mano mira hacia atrás (-Z en glTF).
        "dorsal": {"LeftHand": [0, 0, -1], "RightHand": [0, 0, -1]},
    }
    arm["donante_meta"] = json.dumps(meta)
    joints = {
        "joints": {k: to_gltf(v) for k, v in J.items()},
        "spine": [to_gltf(Vector(b.tolist())) for b in bodies],
        **chest,
        "meta": meta,
    }
    write_json("human_joints.json", joints)
    save_work("02_human.blend")


main()
