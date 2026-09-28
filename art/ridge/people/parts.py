"""Body parts every person shares: heads (at any scale - the child), hands in
the poses our people hold things in, boots, belts - as bake jobs.

A job is charlib's: dict(ob, field, paint, origin, M, weight, ao_field,
ao_group, skin, smart_uv...). Extra keys used here: `socket` (which socket a
prop hangs from), `extras` (glTF extras written on the node).
"""
import numpy as np
from charlib import sdf as S, bl, head as HD, hands as HN, paint as PT, polygonize as PG, texture as T, character as C
from charlib.texture import srgb, smoothstep

# a closed fist for things held all round - a forend, a steering wheel, a
# handlebar, a crook, the barrel of a pair of binoculars. charlib's "grip"
# keeps the index finger along a trigger guard; this one closes it.
HN.POSES.setdefault("hold", dict(index=(62, 74, 30), middle=(70, 82, 36), ring=(74, 84, 38), pinky=(78, 86, 40),
                                 thumb=(48, 28, 20), open=0.0))


class Scaled(S.Node):
    """A field scaled by s about the origin (still a distance field)."""

    def __init__(self, child, s):
        self.child, self.s = child, float(s)
        self.lo, self.hi = child.lo * s, child.hi * s
        self.label = child.label

    def _kids(self):
        return [self.child]

    def eval(self, P):
        return self.child.eval(P / self.s) * self.s


def filled_head(p, fill=1.0):
    """charlib's head with the lower face filled out: its jaw is two thin
    capsules, so between the cheekbone and the jawline the face caves in and
    catches a hard shadow groove; masseters, jowls and a chin pad (soft
    volumes set back behind the lips) make it a face again."""
    f = HD.head_sdf(p)
    if fill <= 0:
        return f
    j = p["jaw"]
    # `fill` sinks the volumes in rather than thinning them (a thin
    # ellipsoid would stand out of the cheek as a ridge)
    sink = 0.014 * (1.0 - min(fill, 1.0))
    grow = max(fill - 1.0, 0.0)
    fills = []
    for sx in (1, -1):
        fills.append(S.Ellipsoid((sx * (0.049 * j - sink), -0.010, -0.058), (0.020 * (1 + grow), 0.034, 0.036), S.rot_x(-12)))
        fills.append(S.Ellipsoid((sx * (0.034 * j - sink * 0.8), -0.040 + sink * 0.6, -0.078), (0.020 * (1 + grow), 0.028, 0.026)))
    fills.append(S.Ellipsoid((0, -0.050 + sink, -0.094), (0.030 * j, 0.024, 0.018)))
    return S.Union([f, S.Union(fills, k=0.02)], k=0.015)


def head_jobs(name, p, look, tris=1900, scale=1.0, origin=None, weight=3.4, fill=1.0):
    """charlib.head.make with a scale and a seat: the child's head is the
    adult sculpt scaled up (a child's head is a larger part of him) and seated
    lower on a shorter neck. The UVs are made at the adult size and place
    (head_uv classifies faces against HEAD_ORIGIN) and the mesh moved after."""
    origin = HD.HEAD_ORIGIN if origin is None else np.asarray(origin, float)
    field = filled_head(p, fill)
    if look.get("scar"):
        base = field
        field = S.Displace(base, lambda Pt: -T.scar_displacement(Pt, look).astype(np.float32), 0.001)
    detailed = HD.skin_detail(field, p)
    Vd, Qd = PG.mesh_sdf(field, (-0.11, -0.15, -0.205), (0.11, 0.13, 0.14), 0.0016, blur=1.2)
    lo = bl.mesh_from_arrays(name, Vd + HD.HEAD_ORIGIN, Qd)
    bl.decimate(lo, tris, symmetry=True)
    HD.head_uv(lo)
    V = bl.verts_np(lo)
    bl.set_verts(lo, (V - HD.HEAD_ORIGIN) * scale + origin)

    def paint(Pt, s=scale):
        c, r = T.head_paint(Pt / s, p, look)
        return c, r, np.zeros(len(Pt))

    def paint_ear(Pt, s=scale):
        c, r = T.head_paint(Pt / s, p, look, is_ear=True)
        return c, r, np.zeros(len(Pt))
    fs = Scaled(field, scale) if scale != 1.0 else field
    ds = Scaled(detailed, scale) if scale != 1.0 else detailed
    jobs = [dict(ob=lo, field=ds, paint=paint, origin=origin, weight=weight, ao_field=fs, part="head")]
    for side, tag in ((1, "L"), (-1, "R")):
        e = HD.ear_sdf(p, side)
        Ve, Qe = PG.mesh_sdf(e, e.lo, e.hi, 0.0008, blur=1.0)
        elo = bl.mesh_from_arrays(f"{name}.ear.{tag}", Ve * scale + origin, Qe)
        bl.decimate(elo, 130, symmetry=False)
        es = Scaled(e, scale) if scale != 1.0 else e
        jobs.append(dict(ob=elo, field=es, paint=paint_ear, origin=origin, weight=1.4, ao_field=es, smart_uv=True, uv_angle=80, part="head"))
    return jobs


def hand_jobs(poses, tone="tanned", grime=0.3, sleeve="full", female=0.0, tris=520, glove=None, thin=1.0):
    """Both hands (and the forearm under the sleeve), sculpted in their pose.
    `glove`: a colour for knitted or leather gloves instead of skin."""
    jobs = []
    for side in ("R", "L"):
        hf, nails = HN.hand_sdf(poses[side], female=female, sleeve=sleeve)
        if thin != 1.0:
            # a child's hand: slimmer, a hair shorter (the rig fixes the wrist)
            hf = S.Offset(hf, -0.0025 * (1 - thin) / 0.3)
        M, o = HN.world_xform(side)
        ob = C.decimated(f"hand.{side}", hf, (-0.07, -0.21, -0.07), (0.06, 0.20, 0.08), 0.0009, tris, None, M=M, o=o)

        def hpaint(P, nails=nails, M=M, o=o):
            Pw = P @ M.T + o
            if glove is not None:
                col, r, m = PT.fabric(Pw, glove, "wool", dust_amt=0.2, fade=0.1, seed=7)
                return col, r, m
            col, r, m = PT.skin(Pw, tone, seed=3, dirt=grime + 0.1)
            nm = HN.nail_mask(P, nails)
            col = col * (1 - 0.6 * nm[:, None]) + srgb(0.72, 0.55, 0.50) * 0.6 * nm[:, None]
            r = r - 0.2 * nm
            back = smoothstep(0.004, 0.012, P[:, 0])
            col *= (1 - 0.08 * back)[:, None]
            return col, r, m
        jobs.append(dict(ob=ob, field=hf, paint=hpaint, origin=o, M=M, weight=1.3, ao_field=hf, smart_uv=True, uv_angle=75, part="hand"))
    return jobs


def boot_jobs(sdf_fn, paint, tris=420, name="boot"):
    jobs = []
    for side in ("L", "R"):
        bf, top = sdf_fn(side)
        x0 = 0.105 if side == "L" else -0.105
        ob = C.decimated(f"{name}.{side}", bf, (x0 - 0.08, -0.23, -0.01), (x0 + 0.08, 0.14, top[2] + 0.06), 0.0016, tris, None)
        jobs.append(dict(ob=ob, field=bf, paint=paint, origin=np.zeros(3), weight=0.6, ao_field=bf, smart_uv=True, uv_angle=80, part="boot"))
    return jobs


def sculpt_job(name, field, paint, lo, hi, res, tris, weight=0.6, skin=("transfer",), ao_group="body", uv_angle=80,
               origin=None, M=None, symmetry=False, **kw):
    """A rigid or skinned part polygonised from its field and decimated."""
    o = np.zeros(3) if origin is None else origin
    ob = C.decimated(name, field, lo, hi, res, tris, None, M=M, o=o if M is not None else None, symmetry=symmetry)
    if M is None and origin is not None:
        V = bl.verts_np(ob)
        bl.set_verts(ob, V + np.asarray(origin, np.float32))
    j = dict(ob=ob, field=field, paint=paint, origin=o, M=M, weight=weight, ao_field=field, smart_uv=True, uv_angle=uv_angle,
             skin=skin, ao_group=ao_group)
    j.update(kw)
    return j


def ring_job(rm, name, field, paint, weight=1.0, skin=("transfer",), ao_group="body", origin=None, smart_uv=False, **kw):
    """A ring-built part (a garment, a hat); `origin` places a part built in
    head-local coordinates."""
    from charlib import rings as R
    ob = R.to_blender(rm, name)
    o = np.zeros(3) if origin is None else np.asarray(origin, float)
    if origin is not None:
        V = bl.verts_np(ob)
        bl.set_verts(ob, V + o.astype(np.float32))
    j = dict(ob=ob, field=field, paint=paint, origin=o, weight=weight, ao_field=field, skin=skin, ao_group=ao_group)
    if smart_uv:
        j.update(smart_uv=True, uv_angle=kw.pop("uv_angle", 70))
    j.update(kw)
    return j
