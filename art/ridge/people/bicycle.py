"""The cyclist's bicycle: a black step-through roadster with 28-inch wheels,
mudguards, a chain guard, a sprung leather saddle and swept-back bars.

It lives on the civilian rig as bones added after the people are weighted
(so bone heat never sees them), each carrying its rigid mesh:

    bicycle                 the frame, fork, bars, saddle, mudguards, rack (root bone at the origin)
      bicycle.wheel.front   front hub; the wheel turns about its x (the axle)
      bicycle.wheel.rear    rear hub
      bicycle.crank         bottom bracket; cranks and chainring
        bicycle.pedal.L/R   pedal spindles; they stay level with the rider's soles

The `cycle` clip animates these with the legs (crank one turn every
CRANK_T s, the wheels GEAR times as fast); the game moves the root at
SPEED m/s. The bicycle stands on the ground at the origin, pointing +Z
(glTF), its footprint centred on the origin.
"""
import math
import numpy as np
import bpy
from mathutils import Vector, Matrix
from charlib import sdf as S, paint as PT, bl, character as C
from charlib.texture import srgb, smoothstep, value_noise, fbm

R_WHEEL = 0.350           # 28-inch wheel, tyre on
R_RIM = 0.316
HUB_F = np.array([0.0, -0.555, R_WHEEL])
HUB_R = np.array([0.0, 0.555, R_WHEEL])
BB = np.array([0.0, 0.110, 0.280])
CRANK = 0.170
PEDAL_X = 0.115
GEAR = 2.5                # chainring 45 / sprocket 18
CRANK_T = 1.2             # seconds per crank turn (50 rpm)
SPEED = GEAR * 2 * math.pi * R_WHEEL / CRANK_T      # 4.58 m/s
SADDLE = np.array([0.0, 0.330, 0.935])             # saddle top, its middle
GRIPS = {"L": np.array([0.265, -0.215, 1.035]), "R": np.array([-0.265, -0.215, 1.035])}
HEAD_TOP = np.array([0.0, -0.395, 0.905])
HEAD_BOT = np.array([0.0, -0.435, 0.765])
SEAT_TOP = np.array([0.0, 0.300, 0.800])

BONES = [("bicycle", None, (0, 0, 0), (0, 0, 0.12)),
         ("bicycle.wheel.front", "bicycle", tuple(HUB_F), tuple(HUB_F + (0.06, 0, 0))),
         ("bicycle.wheel.rear", "bicycle", tuple(HUB_R), tuple(HUB_R + (0.06, 0, 0))),
         ("bicycle.crank", "bicycle", tuple(BB), tuple(BB + (0.06, 0, 0)))]


def pedal_spindle(side, phi):
    """World position of a pedal's spindle at crank angle phi (degrees from
    top, forward positive) of the RIGHT crank; the left is half a turn on."""
    a = math.radians(phi + (180.0 if side == "L" else 0.0))
    x = PEDAL_X if side == "L" else -PEDAL_X
    return np.array([x, BB[1] - CRANK * math.sin(a), BB[2] + CRANK * math.cos(a)])


def _tube(a, b, r, rb=None):
    return S.RoundCone(a, b, r, r if rb is None else rb)


def frame_field():
    """Frame, fork, bars, stem, seat post and saddle, mudguards, chain guard, rack."""
    parts = []
    # the step-through: two tubes swooping from the head tube to the bottom bracket
    for off in (0.0, 0.07):
        pts = [HEAD_BOT + np.array([0, 0.0, 0.10 - off]), np.array([0, -0.30, 0.52 - off * 0.6]), np.array([0, -0.12, 0.34 - off * 0.2]), BB]
        parts.append(S.Tube(pts, [0.0145] * 4, [0.0145] * 4, side=(1, 0, 0)))
    parts.append(_tube(HEAD_BOT, HEAD_TOP, 0.019))                    # head tube
    parts.append(_tube(BB, SEAT_TOP, 0.0155))                         # seat tube
    for s in (1, -1):
        parts.append(_tube(BB + (s * 0.035, 0.02, 0), HUB_R + (s * 0.058, 0, 0), 0.010, 0.008))       # chain stays
        parts.append(_tube(SEAT_TOP + (s * 0.018, 0.01, -0.02), HUB_R + (s * 0.058, 0, 0.005), 0.0085, 0.0075))  # seat stays
        # fork blades: curving forward to the hub
        parts.append(S.Tube([HEAD_BOT + (s * 0.028, 0, -0.01), HEAD_BOT + (s * 0.050, -0.03, -0.20), HUB_F + (s * 0.052, 0.01, 0.08),
                             HUB_F + (s * 0.052, 0.0, 0.0)], [0.010] * 4, [0.012] * 4, side=(1, 0, 0)))
    parts.append(S.Cylinder(HEAD_BOT + (0, 0, -0.01), 0.026, 0.012, None, rad=0.004))   # fork crown
    # stem up out of the head tube and the swept-back bars
    stem_top = HEAD_TOP + np.array([0.0, 0.015, 0.105])
    parts.append(_tube(HEAD_TOP, stem_top, 0.012))
    for s, g in (("L", GRIPS["L"]), ("R", GRIPS["R"])):
        sx = 1.0 if s == "L" else -1.0
        bar = [stem_top, stem_top + np.array([sx * 0.10, -0.03, 0.0]), stem_top + np.array([sx * 0.22, 0.03, -0.005]), g + np.array([sx * 0.01, 0.06, 0.0])]
        parts.append(S.Tube(bar, [0.0115] * 4, [0.0115] * 4, side=(0, 0, 1)))
        parts.append(_tube(g + np.array([-sx * 0.028, -0.055, 0.0]), g + np.array([sx * 0.012, 0.065, 0.0]), 0.0165))   # rubber grip
    # seat post and a sprung saddle
    post_top = SADDLE + np.array([0.0, 0.01, -0.05])
    parts.append(_tube(SEAT_TOP, post_top, 0.0125))
    saddle = S.Union([S.Ellipsoid(SADDLE + (0, 0.045, 0.0), (0.090, 0.075, 0.020)),
                      S.RoundCone(SADDLE + (0, 0.05, 0.004), SADDLE + (0, -0.13, 0.006), 0.035, 0.014)], k=0.03)
    saddle = S.Intersect(saddle, S.Plane(SADDLE + (0, 0, -0.012), (0, 0, -1), (-0.3, -0.4, 0.5), (0.3, 0.4, 1.2)), k=0.004)
    parts.append(saddle)
    for s in (1, -1):
        parts.append(S.Torus(SADDLE + (s * 0.05, 0.075, -0.035), 0.016, 0.003, S.rot_y(90)))    # springs
    parts.append(_tube(post_top, SADDLE + (0, 0.07, -0.03), 0.008))
    # mudguards: arcs of a shallow channel over each wheel
    # (angles from the top of the wheel, forward positive: the front guard
    # runs from behind the fork crown to low in front, the rear one from the
    # seat tube round the back to low behind)
    for hub, a0, a1 in ((HUB_F, -60.0, 110.0), (HUB_R, -120.0, 25.0)):
        def mg(P, hub=hub, a0=a0, a1=a1):
            q = P - hub
            r = np.hypot(q[:, 1], q[:, 2])
            ang = np.degrees(np.arctan2(-q[:, 1], q[:, 2]))
            shell = np.maximum(np.abs(r - (R_WHEEL + 0.028)) - 0.0018, np.abs(q[:, 0]) - 0.030)
            # end the arc: distance past either end, measured along the rim
            past = np.maximum(a0 - ang, ang - a1) * math.pi / 180 * (R_WHEEL + 0.028)
            return np.maximum(shell, past).astype(np.float32)
        m = R_WHEEL + 0.06
        parts.append(S.Fn(mg, hub - np.array([0.05, m, m]), hub + np.array([0.05, m, m])))
    # the rack over the rear wheel
    rack_t = HUB_R + np.array([0.0, -0.02, 0.40])
    for s in (1, -1):
        parts.append(_tube(HUB_R + (s * 0.055, 0.0, 0.0), rack_t + (s * 0.05, 0.06, 0.0), 0.005))
        parts.append(_tube(rack_t + (s * 0.05, -0.20, 0.0), rack_t + (s * 0.05, 0.14, 0.0), 0.005))
    parts.append(S.Box(rack_t + (0, -0.03, 0.002), (0.05, 0.17, 0.004), None, rad=0.003))
    parts.append(_tube(rack_t + (0, -0.20, 0.0), SEAT_TOP + (0, 0.02, -0.03), 0.005))
    # chain guard on the right, over the ring and the top run of the chain
    cg = S.Union([S.Cylinder(BB + (-0.058, 0, 0), 0.118, 0.004, S.rot_y(90), rad=0.002),
                  S.Box(0.5 * (BB + HUB_R) + np.array([-0.058, 0, 0.055]), (0.004, 0.24, 0.028), S.rot_x(-8), rad=0.003)], k=0.02)
    cg = S.Intersect(cg, S.Plane(BB + (0, 0, -0.02), (0, 0, -1), (-0.2, -0.3, -0.2), (0.1, 0.8, 0.6)), k=0.01)
    parts.append(cg)
    # the lamp and the bell
    parts.append(S.Cylinder(HEAD_TOP + (0, -0.06, -0.09), 0.030, 0.022, S.rot_x(90), rad=0.008))
    parts.append(S.Sphere(GRIPS["L"] + np.array([-0.10, 0.02, 0.02]), 0.017))
    return S.Union(parts, k=0.006)


def frame_paint(P):
    n = len(P)
    col, r, m = PT.metal(P, (0.025, 0.026, 0.028), 0.30, seed=501)
    m[:] = 0.0                      # enamel
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    # chrome: bars, stem, seat post, rack, bell, lamp rim
    bars = (z > 0.93) & (y < -0.10) & (np.abs(x) < 0.30)
    post = (np.abs(x) < 0.02) & (y > 0.28) & (z > 0.80) & (z < 0.90)
    rack = (y > 0.35) & (z > 0.70) & (z < 0.80)
    chrome = bars | post | rack
    cc, cr, cm = PT.metal(P, (0.62, 0.62, 0.62), 0.18, seed=502)
    col[chrome], r[chrome], m[chrome] = cc[chrome], cr[chrome], cm[chrome]
    # rubber grips
    for g in GRIPS.values():
        on = np.linalg.norm((P - g) * np.array([1.0, 0.45, 1.0]), axis=1) < 0.034
        col[on] = srgb(0.05, 0.045, 0.04)
        r[on] = 0.8
        m[on] = 0.0
    # brown leather saddle
    sad = (z > 0.905) & (np.abs(y - 0.30) < 0.17) & (np.abs(x) < 0.10)
    lc, lr, lm = PT.leather(P, (0.22, 0.12, 0.06), 0.1, 0.4, seed=503, shine=0.4)
    col[sad], r[sad], m[sad] = lc[sad], lr[sad], lm[sad]
    # a gold pinstripe on the tubes, a white patch at the mudguard's tail (a reflector)
    tail = (y > HUB_R[1] + 0.2) & (z < 0.45) & (z > 0.25)
    col[tail] = srgb(0.85, 0.85, 0.82)
    lamp = np.linalg.norm(P - (HEAD_TOP + (0, -0.083, -0.09)), axis=1) < 0.024
    col[lamp] = srgb(0.80, 0.78, 0.60)
    r[lamp] = 0.1
    return np.clip(col, 0, 1), np.clip(r, 0.05, 1), m


def wheel_field(hub):
    """Tyre, rim and hub of one wheel (spokes are their own mesh), centred on
    the hub in world space."""
    Rz = S.rot_y(90)
    tyre = S.Torus(hub, R_WHEEL - 0.019, 0.019, Rz)
    rim = S.Torus(hub, R_RIM + 0.004, 0.0085, Rz)
    rim = S.Union([rim, S.Cylinder(hub, R_RIM + 0.004, 0.009, Rz, rad=0.004)], k=0.0)
    rim = S.Subtract(rim, S.Cylinder(hub, R_RIM - 0.006, 0.02, Rz))
    hubc = S.Union([S.Cylinder(hub, 0.020, 0.036, Rz, rad=0.006), S.Cylinder(hub, 0.028, 0.004, Rz @ np.eye(3), rad=0.002)], k=0.004)
    return S.Union([tyre, rim, hubc], k=0.003)


def spokes_mesh(name, hub, n=32):
    """Thin prisms from the hub flanges to the rim, crossed three-over."""
    V, F = [], []
    rad = 0.0013
    for i in range(n):
        side = 1 if i % 2 == 0 else -1
        a0 = 2 * math.pi * i / n
        a1 = a0 + side * 3 * 2 * math.pi / n * 0.5
        p0 = hub + np.array([side * 0.030, 0.022 * math.sin(a0), 0.022 * math.cos(a0)])
        p1 = hub + np.array([side * 0.004, (R_RIM - 0.004) * math.sin(a1), (R_RIM - 0.004) * math.cos(a1)])
        d = (p1 - p0) / np.linalg.norm(p1 - p0)
        e1 = np.cross(d, [1.0, 0, 0])
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(d, e1)
        base = len(V)
        for p in (p0, p1):
            for k in range(3):
                t = 2 * math.pi * k / 3
                V.append(p + rad * (math.cos(t) * e1 + math.sin(t) * e2))
        for k in range(3):
            k2 = (k + 1) % 3
            F.append((base + k, base + k2, base + 3 + k2, base + 3 + k))
    ob = bl.mesh_from_arrays(name, np.array(V, np.float32), F)
    return ob


def spokes_field(hub, n=32):
    parts = []
    for i in range(n):
        side = 1 if i % 2 == 0 else -1
        a0 = 2 * math.pi * i / n
        a1 = a0 + side * 3 * 2 * math.pi / n * 0.5
        p0 = hub + np.array([side * 0.030, 0.022 * math.sin(a0), 0.022 * math.cos(a0)])
        p1 = hub + np.array([side * 0.004, (R_RIM - 0.004) * math.sin(a1), (R_RIM - 0.004) * math.cos(a1)])
        parts.append(S.RoundCone(p0, p1, 0.0013))
    return S.Union(parts)


def wheel_paint(hub):
    def paint(P):
        n = len(P)
        q = P - hub
        r_ = np.hypot(q[:, 1], q[:, 2])
        col, r, m = PT.metal(P, (0.60, 0.60, 0.60), 0.22, seed=511)
        tyre = r_ > R_RIM + 0.009
        col[tyre] = srgb(0.045, 0.043, 0.04) * (0.9 + 0.2 * value_noise(P, 300, seed=512))[tyre][:, None]
        r[tyre] = 0.85
        m[tyre] = 0.0
        # dusty tread
        tread = r_ > R_WHEEL - 0.006
        col[tread] = col[tread] * 0.6 + PT.DUST * 0.4
        return np.clip(col, 0, 1), r, m
    return paint


def chainset_field():
    """Chainring and both cranks with the right crank pointing straight up
    (the crank bone's rest), the left straight down."""
    Rz = S.rot_y(90)
    ring = S.Subtract(S.Cylinder(BB + (-0.050, 0, 0), 0.102, 0.003, Rz, rad=0.001), S.Cylinder(BB + (-0.050, 0, 0), 0.07, 0.01, Rz))
    teeth = S.Torus(BB + (-0.050, 0, 0), 0.104, 0.003, Rz)
    spider = S.Union([_tube(BB + (-0.05, 0, 0), BB + (-0.05, 0.072 * math.sin(a), 0.072 * math.cos(a)), 0.006) for a in np.linspace(0, 2 * math.pi, 6)[:-1]])
    arms = [_tube(BB + (-0.068, 0, 0), BB + (-0.075, 0, CRANK), 0.010, 0.008),
            _tube(BB + (0.068, 0, 0), BB + (0.075, 0, -CRANK), 0.010, 0.008),
            S.Cylinder(BB, 0.018, 0.075, Rz, rad=0.004)]
    return S.Union([ring, teeth, spider] + arms, k=0.004)


def pedal_field(side):
    """A rubber-block pedal at the crank's rest (right up, left down)."""
    sx = 1.0 if side == "L" else -1.0
    c = BB + np.array([sx * PEDAL_X, 0.0, CRANK if side == "R" else -CRANK])
    body = S.Box(c + (sx * 0.025, 0, 0), (0.042, 0.036, 0.010), None, rad=0.004)
    blocks = S.Union([S.Box(c + (sx * 0.025, s * 0.026, 0), (0.044, 0.008, 0.013), None, rad=0.003) for s in (1, -1)])
    return S.Union([body, blocks, _tube(c - (sx * 0.02, 0, 0), c + (sx * 0.06, 0, 0), 0.006)], k=0.003), c


def dark_metal_paint(P):
    c, r, m = PT.metal(P, (0.30, 0.30, 0.30), 0.35, seed=521)
    return c, r, m


def pedal_paint(P):
    n = len(P)
    c = np.tile(srgb(0.05, 0.05, 0.05), (n, 1))
    return c, np.full(n, 0.85), np.zeros(n)


def jobs(quick=False):
    """Bake jobs for every part, each rigid on its bone (skin ('bone', name))."""
    out = []
    ff = frame_field()
    lo, hi = np.array([-0.32, -0.95, -0.02]), np.array([0.32, 0.98, 1.15])
    out.append(dict(ob=C.decimated("bicycle.frame", ff, lo, hi, 0.004 if quick else 0.003, 4200, None), field=ff, paint=frame_paint,
                    origin=np.zeros(3), weight=0.30, ao_field=ff, ao_group="bicycle", ao_self_only=True, smart_uv=True, uv_angle=66, skin=("bone", "bicycle")))
    for hub, tag in ((HUB_F, "front"), (HUB_R, "rear")):
        wf = wheel_field(hub)
        m = R_WHEEL + 0.01
        out.append(dict(ob=C.decimated(f"bicycle.{tag}_wheel", wf, hub - (0.05, m, m), hub + (0.05, m, m), 0.0035 if quick else 0.0025, 1300, None),
                        field=wf, paint=wheel_paint(hub), origin=np.zeros(3), weight=0.22, ao_field=wf, ao_group="bicycle", ao_self_only=True, smart_uv=True,
                        uv_angle=66, skin=("bone", f"bicycle.wheel.{tag}")))
        out.append(dict(ob=spokes_mesh(f"bicycle.{tag}_spokes", hub), field=spokes_field(hub), paint=dark_metal_paint, origin=np.zeros(3),
                        weight=0.15, ao_field=None, ao_group="bicycle", ao_self_only=True, smart_uv=True, uv_angle=80, skin=("bone", f"bicycle.wheel.{tag}"),
                        join_into=f"bicycle.{tag}_wheel"))
    cf = chainset_field()
    out.append(dict(ob=C.decimated("bicycle.chainset", cf, BB - (0.12, 0.13, 0.20), BB + (0.12, 0.13, 0.20), 0.0018, 700, None), field=cf,
                    paint=dark_metal_paint, origin=np.zeros(3), weight=0.3, ao_field=cf, ao_group="bicycle", ao_self_only=True, smart_uv=True, uv_angle=66,
                    skin=("bone", "bicycle.crank")))
    for side in ("L", "R"):
        pf, c = pedal_field(side)
        out.append(dict(ob=C.decimated(f"bicycle.pedal_{side}", pf, c - (0.08, 0.06, 0.04), c + (0.08, 0.06, 0.04), 0.0015, 120, None),
                        field=pf, paint=pedal_paint, origin=np.zeros(3), weight=0.3, ao_field=pf, ao_group="bicycle", ao_self_only=True, smart_uv=True,
                        uv_angle=66, skin=("bone", f"bicycle.pedal.{side}")))
    return out


def add_bones(rig):
    """The bicycle's bones on the civilian armature (after weighting)."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    for name, parent, h, t in BONES:
        b = eb.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        b.align_roll(Vector((0, 0, 1)))
        b.use_deform = False
        if parent:
            b.parent = eb[parent]
    for side in ("L", "R"):
        p = pedal_spindle(side, 0.0)
        b = eb.new(f"bicycle.pedal.{side}")
        b.head, b.tail = Vector(tuple(p)), Vector(tuple(p + (0.05 if side == "L" else -0.05, 0, 0)))
        b.align_roll(Vector((0, 0, 1)))
        b.use_deform = False
        b.parent = eb["bicycle.crank"]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"


def key_rotations(rig, act, rot_of_t, fps, n):
    """Key the bicycle's bones in `act` (frames 1..n+1): rot_of_t(t) ->
    {bone: 3x3 world (armature) rotation relative to rest}."""
    rig.animation_data.action = act
    for f in range(n + 1):
        t = f / fps
        R = rot_of_t(t)
        for name, Rw in R.items():
            pb = rig.pose.bones[name]
            bone = rig.data.bones[name]
            B = bone.matrix_local.to_3x3()
            Rp = Matrix.Identity(3)
            if bone.parent is not None and bone.parent.name in R:
                Rp = Matrix(R[bone.parent.name].tolist())
            rel = Rp.inverted() @ Matrix(Rw.tolist())
            q = (B.inverted() @ rel @ B).to_quaternion()
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f + 1, group=name)
    from charlib.anim import fix_quat_continuity, _fcurves
    fix_quat_continuity(act)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
