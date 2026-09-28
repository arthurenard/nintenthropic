"""Hair for the dead head (`var.hair.<n>`), rigid on the head bone. The head
underneath is bald, so any of them fits any dead head.

    var.hair.short    dark, short, matted
    var.hair.long     long and stringy, lank to the shoulders
    var.hair.balding  a grey horseshoe round a bald crown
    var.hair.greasy   black, slicked back, a forelock plastered to the brow

A hair cap is grown out of the head's own game mesh: the scalp's triangles,
pushed out along the sculpt's normal by the thickness field (High Noon's
hairline and growth maps, charlib.head), so it follows the head exactly,
never floats and never cuts through it. Hanks of the long styles are extra
volumes joined to the cap. Painted with strands along the flow.
"""

import bmesh
import bpy
import numpy as np

from .common import S, HD, bl, srgb, smoothstep, value_noise, fbm
from . import meshfix as MF
from . import heads as H

MIN_T = 0.0014      # the thinnest hair still clears the scalp


def clumps_long(r):
    """Lank hanks from behind the ears and the back of the head to the shoulders."""
    out = []
    for k in range(14):
        a = np.radians(-110 + k * 220 / 13 + r.uniform(-6, 6))
        sx, sy = np.sin(a), -np.cos(a)
        start = np.array([0.074 * sx, 0.015 - 0.06 * sy, 0.02])
        mid = np.array([0.084 * sx, 0.02 - 0.07 * sy, -0.09])
        end = np.array([0.075 * sx + r.uniform(-0.01, 0.01), 0.03 - 0.06 * sy, -0.20 - r.uniform(0, 0.05)])
        rad = r.uniform(0.008, 0.012)
        out += [S.RoundCone(start, mid, rad, rad * 0.9), S.RoundCone(mid, end, rad * 0.9, rad * 0.35)]
    return out


def forelock(r):
    return [S.RoundCone((0.01, -0.07, 0.085), (-0.02, -0.098, 0.045), 0.007, 0.003),
            S.RoundCone((0.025, -0.075, 0.08), (0.012, -0.10, 0.035), 0.006, 0.0025),
            S.RoundCone((-0.03, -0.07, 0.08), (-0.045, -0.092, 0.05), 0.006, 0.0025)]


def paint_for(color, grey=0.0, seed=0, greasy=0.0):
    col0 = srgb(*color)

    def paint(Pt):
        n = len(Pt)
        x, y, z = Pt[:, 0], Pt[:, 1], Pt[:, 2]
        az = np.degrees(np.arctan2(x, -(y - 0.005)))
        strand = value_noise(np.stack([az * 0.9, z * 30, y * 8], 1), 1.0, seed=seed + 1)
        fine = value_noise(np.stack([az * 3.5, z * 120, y * 30], 1), 1.0, seed=seed + 2)
        c = col0[None, :] * (0.6 + 0.45 * strand[:, None] + 0.25 * (fine[:, None] - 0.5))
        if grey:
            g = smoothstep(0.55 - 0.5 * grey, 0.9 - 0.5 * grey, fbm(Pt, 400, 2, seed=seed + 3))
            c = c * (1 - g[:, None]) + srgb(0.58, 0.56, 0.54) * g[:, None] * (0.8 + 0.2 * fine[:, None])
        dirt = smoothstep(0.55, 0.85, fbm(Pt, 50, 3, seed=seed + 4))
        c *= (1 - 0.35 * dirt)[:, None]
        r = np.full(n, 0.55 - 0.25 * greasy) + 0.1 * fine
        return np.clip(c, 0, 1), np.clip(r, 0.2, 1), np.zeros(n)
    return paint


def cap_field(head_field, p_hair, extra=None):
    """The hair's outer surface as a field (what the bake snaps to): the skin
    pushed out by the thickness, and the hanks."""
    def f(Pt):
        return (head_field(Pt) - np.maximum(HD.hair_thickness(Pt, p_hair), MIN_T)).astype(np.float32)
    base = S.Fn(f, head_field.lo - 0.01, head_field.hi + 0.01)
    if extra:
        return S.Union([base] + extra, k=0.006)
    return base


def from_head(name, head_ob, head_field, p_hair, extra=None, coll=None, extra_tris=600):
    """Grow a hair cap out of the head's game mesh."""
    me = head_ob.data
    n = len(me.vertices)
    V = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", V)
    t = HD.hair_thickness(V.reshape(-1, 3) - H.HEAD_ORIGIN, p_hair)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    keep = {f.index for f in bm.faces if sum(t[v.index] > 0.0006 for v in f.verts) >= 2}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # the head gave its scalp few triangles (they went to the face): split
    # each in four so the cap can round the skull and its hairline can curve
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.verts.ensure_lookup_table()
    Vk = np.array([v.co[:] for v in bm.verts], np.float32) - H.HEAD_ORIGIN
    Vk = S.project_to_surface(head_field, Vk, iters=3, clamp=0.004)
    # the hairline: the cap's border follows the triangles it was cut from,
    # a sawtooth; walk the border loop smooth along the scalp (a few passes
    # of averaging with its border neighbours, put back on the skin), and
    # let the cap thin to nothing there so it grows out of the scalp
    border = np.array([v.is_boundary for v in bm.verts], bool)
    nb = [[e.other_vert(v).index for e in v.link_edges if e.is_boundary] for v in bm.verts]
    for _ in range(6):
        V2 = Vk.copy()
        for i in np.nonzero(border)[0]:
            if len(nb[i]) == 2:
                V2[i] = 0.5 * Vk[i] + 0.25 * (Vk[nb[i][0]] + Vk[nb[i][1]])
        Vk = V2
        Vk[border] = S.project_to_surface(head_field, Vk[border], iters=3, clamp=0.004)
    # one ring in from the border, relax too (the sawtooth's inner teeth)
    ring = np.zeros(len(Vk), bool)
    for i in np.nonzero(border)[0]:
        for e in bm.verts[i].link_edges:
            j = e.other_vert(bm.verts[i]).index
            if not border[j]:
                ring[j] = True
    tk = np.maximum(HD.hair_thickness(Vk, p_hair), MIN_T)
    tk[border] = 0.0006          # (not less: depth precision at 40 m in the game)
    tk[ring] = np.minimum(tk[ring], 0.5 * (tk[ring] + 0.0006) + 0.0004)
    gk = S.gradient(head_field, Vk)
    nk = gk / np.maximum(np.linalg.norm(gk, axis=1), 1e-9)[:, None]
    for v, p_ in zip(bm.verts, Vk + nk * tk[:, None] + H.HEAD_ORIGIN):
        v.co = p_
    hm = bpy.data.meshes.new(name)
    bm.to_mesh(hm)
    bm.free()
    for uv in list(hm.uv_layers):
        hm.uv_layers.remove(uv)
    ob = bpy.data.objects.new(name, hm)
    (coll or bpy.context.scene.collection).objects.link(ob)
    MF.rebuild(ob)
    if extra:
        ef = S.Union(extra, k=0.006)
        ex = MF.decimated(name + ".hanks", ef, ef.lo - 0.005, ef.hi + 0.005, 0.0012, extra_tris, coll, M=np.eye(3), o=H.HEAD_ORIGIN,
                          symmetry=True)
        ob = bl.join([ob, ex], name)
        MF.rebuild(ob)
    return ob


STYLES = {
    # name: (thickness params, extra, colour, grey, greasy)
    "short": (dict(hair="short", hair_len=1.1, hairline=0.25), None, (0.14, 0.11, 0.09), 0.0, 0.0),
    "long": (dict(hair="long_back", hair_len=1.2, hairline=0.05), "long", (0.30, 0.24, 0.16), 0.0, 0.4),
    "balding": (dict(hair="short", hair_len=0.8, hairline=0.85), None, (0.40, 0.38, 0.36), 0.7, 0.0),
    "greasy": (dict(hair="slick", hair_len=1.3, hairline=0.15), "forelock", (0.06, 0.055, 0.05), 0.0, 1.0),
}


def job(name, head_ob, head_p, style, coll=None, seed=0):
    import random
    r = random.Random(f"hair:{name}")
    kw, extra_kind, color, grey, greasy = STYLES[style] if isinstance(style, str) else style
    p = dict(head_p)
    p.update(kw)
    extra = clumps_long(r) if extra_kind == "long" else (forelock(r) if extra_kind == "forelock" else None)
    base = H.head_sdf(head_p)
    ob = from_head(name, head_ob, base, p, extra, coll)
    f = cap_field(base, p, extra)
    return dict(ob=ob, field=f, paint=paint_for(color, grey, seed=seed, greasy=greasy), origin=H.HEAD_ORIGIN, weight=0.5,
                ao_field=f, smart_uv=True, uv_angle=66, skin=("rigid", "head"))


def jobs(head_ob, head_p, coll=None):
    out = []
    for i, style in enumerate(STYLES):
        j = job(f"var.hair.{style}", head_ob, head_p, style, coll, seed=i * 7)
        j["ao_group"] = f"var.hair.{style}"
        j["name"] = f"var.hair.{style}"
        out.append(j)
    return out
