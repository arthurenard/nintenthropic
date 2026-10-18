"""The eyes: two eyeballs set into the open sockets of every dead head, their
own mesh (`eyes`) and material (`eyes`), so the game can make them shine.

Eyeshine is the Dead of Night's glint: in the flashlight's beam the eyes of
something in the fog light up before its body resolves. The material's
emissive texture is the shine (the pupil and iris glow, a sickly pale
green-gold; the sclera does not), and emissiveFactor is 1: the game drives
`emissiveIntensity` - 0 in the dark, up to ~3 at the beam's centre, falling
off with the angle between the beam and the line to the eyes.

The eyeball: a sphere with a corneal bulge, parametrised around its gaze
(azimuthal-equidistant UVs, the pupil at the texture's centre) so the
painting is radial: a clouded, milky iris, a dirty yellowed sclera netted
with veins. 2 x 196 triangles.
"""

import math

import bpy
import numpy as np
from mathutils import Vector

from .common import bl, srgb, smoothstep, value_noise, fbm
from .heads import HEAD_ORIGIN, BALL_R, eyes_local

THETA = [0, 5, 10, 15, 20, 26, 34, 46, 62, 82, 110, 145, 180]
SEG = 16
CORNEA_OFF = 0.0052
CORNEA_R = 0.0079
SHINE = (0.80, 1.0, 0.55)


def eyeball(e, gaze):
    """Vertices, faces, UVs of one eyeball centred at e (world) looking along gaze."""
    f = Vector(gaze).normalized()
    up = Vector((0, 0, 1))
    a = (up - f * up.dot(f)).normalized()
    b = f.cross(a)
    c = Vector(e) + f * CORNEA_OFF
    V, UV = [], []
    rings = []
    for th in THETA:
        t = math.radians(th)
        ring = []
        n = 1 if th in (0, 180) else SEG
        for k in range(n):
            ph = 2 * math.pi * k / SEG
            u = f * math.cos(t) + (a * math.cos(ph) + b * math.sin(ph)) * math.sin(t)
            # distance to the cornea sphere along u (from the ball's centre)
            oc = Vector(e) - c
            bq = u.dot(oc)
            disc = bq * bq - (oc.dot(oc) - CORNEA_R ** 2)
            r = BALL_R
            if disc > 0:
                tt = -bq + math.sqrt(disc)
                r = max(r, tt)
            ring.append(len(V))
            V.append(tuple(Vector(e) + u * r))
            rr = 0.5 * t / math.pi
            UV.append((0.5 + rr * math.cos(ph), 0.5 + rr * math.sin(ph)))
        rings.append(ring)
    F = []
    for i in range(len(rings) - 1):
        ra, rb = rings[i], rings[i + 1]
        if len(ra) == 1:
            for k in range(SEG):
                F.append((ra[0], rb[(k + 1) % SEG], rb[k]))
        elif len(rb) == 1:
            for k in range(SEG):
                F.append((ra[k], ra[(k + 1) % SEG], rb[0]))
        else:
            for k in range(SEG):
                k2 = (k + 1) % SEG
                F.append((ra[k], ra[k2], rb[k2], rb[k]))
    return V, F, UV


def build(name="eyes", coll=None, tex=128):
    eL, eR = eyes_local()
    V, F, UV = [], [], []
    for e, sgn in ((eL, 1), (eR, -1)):
        gaze = (0.06 * sgn, -1.0, -0.02)
        v, f, uv = eyeball(np.asarray(e) + HEAD_ORIGIN, gaze)
        base = len(V)
        V += v
        UV += uv
        F += [tuple(base + i for i in face) for face in f]
    ob = bl.mesh_from_arrays(name, np.array(V, np.float32), F, coll)
    # per-loop UVs from the per-vertex parametrisation (poles fan out: fine)
    me = ob.data
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    bl.set_uv(ob, np.array(UV, np.float32)[lv])
    # the gaze-facing polygons were built winding inward on one side: point them out
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    for fc in bm.faces:
        cen = fc.calc_center_median()
        eye = Vector(np.asarray(eL) + HEAD_ORIGIN) if cen.x > 0 else Vector(np.asarray(eR) + HEAD_ORIGIN)
        if fc.normal.dot(cen - eye) < 0:
            fc.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob.data.materials.append(material(tex))
    return ob


def paint(tex):
    """Base colour, emissive (the shine) and roughness images, radial."""
    ys, xs = np.mgrid[0:tex, 0:tex]
    u = (xs + 0.5) / tex - 0.5
    v = (ys + 0.5) / tex - 0.5
    rr = np.hypot(u, v)
    th = np.degrees(rr * 2 * math.pi)
    ph = np.arctan2(v, u)
    P = np.stack([np.cos(ph) * th * 0.02, np.sin(ph) * th * 0.02, th * 0.01], -1).reshape(-1, 3)
    streak = value_noise(np.stack([ph.ravel() * 6, th.ravel() * 0.2, np.zeros(tex * tex)], 1), 1.0, seed=5).reshape(tex, tex)
    film = fbm(P, 3.0, 3, seed=7).reshape(tex, tex)
    sclera = srgb(0.60, 0.56, 0.44) * (0.9 + 0.2 * film[..., None])
    ridge = 1 - np.abs(2 * fbm(P * 4, 1.0, 3, seed=9).reshape(tex, tex) - 1)
    vein = smoothstep(0.9, 0.98, ridge) * smoothstep(25, 70, th)
    sclera = sclera * (1 - 0.5 * vein[..., None]) + srgb(0.45, 0.16, 0.12) * 0.5 * vein[..., None]
    iris = srgb(0.46, 0.50, 0.52) * (0.8 + 0.35 * streak[..., None])
    iris = iris * 0.72 + srgb(0.66, 0.68, 0.66) * 0.28        # clouded, milky
    pupil = srgb(0.20, 0.22, 0.23)                             # filmed over, never quite black
    # an iris 12 mm across (31 degrees round the ball), the pupil wide in the dark
    col = np.where((th < 11)[..., None], pupil, np.where((th < 30)[..., None], iris, sclera))
    limb = np.exp(-((th - 30.5) / 2.2) ** 2)
    col = col * (1 - 0.45 * limb[..., None])
    col = col * (1 - 0.85 * smoothstep(80, 110, th)[..., None])     # behind the lids: dark
    # the iris and pupil shine full, the sclera about half: the whole of the
    # visible eye lights, so the glint covers every pixel the eye does
    shine = np.maximum(smoothstep(29, 18, th) * (0.75 + 0.25 * smoothstep(11, 0, th)), 0.45 * smoothstep(80, 60, th))
    em = np.asarray(SHINE)[None, None, :] * shine[..., None]
    rough = np.full((tex, tex), 0.12)
    return col, em, rough


def _img(name, arr, srgb_=True):
    from .common import AB
    h, w = arr.shape[:2]
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb_ else "Non-Color"
    rgb = AB._srgb_encode(arr) if srgb_ else np.clip(arr, 0, 1)
    rgba = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], 2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.pack()
    return img


def material(tex=128, name="eyes"):
    col, em, rough = paint(tex)
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    ia = nt.nodes.new("ShaderNodeTexImage")
    ia.image = _img(f"{name}_albedo", col)
    nt.links.new(ia.outputs["Color"], bs.inputs["Base Color"])
    ie = nt.nodes.new("ShaderNodeTexImage")
    ie.image = _img(f"{name}_shine", em)
    nt.links.new(ie.outputs["Color"], bs.inputs["Emission Color"])
    bs.inputs["Emission Strength"].default_value = 1.0
    bs.inputs["Roughness"].default_value = 0.12
    bs.inputs["Specular IOR Level"].default_value = 0.7
    m["eyeshine"] = {"drive": "emissiveIntensity", "dark": 0.0, "lit": 3.0,
                     "note": "0 until the flashlight's beam falls on the eyes; scale with the beam's intensity there"}
    return m


# ---------------------------------------------------------------------------
# The living's eyes: the same eyeballs in the same sockets, baked into the
# person's own atlas (no shine: the living's eyes do not light up in the beam)

IRIS = {"green": (0.34, 0.46, 0.30), "blue": (0.32, 0.46, 0.62), "brown": (0.34, 0.22, 0.12), "grey": (0.46, 0.50, 0.52)}


def living_job(name, iris="brown", coll=None):
    """A bake job (charlib.abake) for two living eyeballs: the mesh, a sphere
    field to bake onto, and a paint of sclera, iris and pupil by the angle
    from each eye's gaze. Rigid on the head."""
    from .common import S
    eL, eR = eyes_local()
    V, F = [], []
    gazes = []
    for e, sgn in ((eL, 1), (eR, -1)):
        gaze = np.array((0.06 * sgn, -1.0, -0.02))
        gaze /= np.linalg.norm(gaze)
        gazes.append((np.asarray(e), gaze))
        v, f, _uv = eyeball(np.asarray(e) + HEAD_ORIGIN, gaze)
        base = len(V)
        V += v
        F += [tuple(base + i for i in face) for face in f]
    ob = bl.mesh_from_arrays(name, np.array(V, np.float32), F, coll)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for fc in bm.faces:
        cen = fc.calc_center_median()
        eye = Vector(np.asarray(eL) + HEAD_ORIGIN) if cen.x > 0 else Vector(np.asarray(eR) + HEAD_ORIGIN)
        if fc.normal.dot(cen - eye) < 0:
            fc.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    parts = []
    for e, gaze in gazes:
        c = e + gaze * CORNEA_OFF
        parts += [S.Sphere(tuple(e), BALL_R), S.Sphere(tuple(c), CORNEA_R)]
    field = S.Union(parts, k=0.0015)
    ic = srgb(*IRIS.get(iris, IRIS["brown"]))

    def paint(P):
        n = len(P)
        col = np.zeros((n, 3), np.float32)
        th = np.full(n, 180.0)
        for e, gaze in gazes:
            side = (P[:, 0] > 0) == (e[0] > 0)
            q = P[side] - e
            cosang = (q @ gaze) / np.maximum(np.linalg.norm(q, axis=1), 1e-9)
            th[side] = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
        ph = np.arctan2(P[:, 2], P[:, 0])
        streak = value_noise(np.stack([ph * 8, th * 0.3, np.zeros(n)], 1), 1.0, seed=17)
        sclera = srgb(0.86, 0.83, 0.78) * (0.92 + 0.08 * streak[:, None])
        vein = smoothstep(0.93, 0.99, value_noise(P * 900, 1.0, seed=19)) * smoothstep(40, 80, th)
        sclera = sclera * (1 - 0.3 * vein[:, None]) + srgb(0.7, 0.3, 0.28) * 0.3 * vein[:, None]
        iris_c = ic[None, :] * (0.7 + 0.5 * streak[:, None])
        col[:] = sclera
        irm = th < 30
        col[irm] = iris_c[irm]
        col[th < 11] = srgb(0.02, 0.02, 0.025)
        limb = np.exp(-((th - 30.5) / 2.2) ** 2)
        col *= (1 - 0.5 * limb)[:, None]
        col *= (1 - 0.85 * smoothstep(80, 110, th))[:, None]
        return np.clip(col, 0, 1), np.full(n, 0.08, np.float32), np.zeros(n, np.float32)
    return dict(ob=ob, field=field, paint=paint, origin=HEAD_ORIGIN, weight=0.25, ao_field=field, smart_uv=True, uv_angle=80,
                skin=("rigid", "head"))
