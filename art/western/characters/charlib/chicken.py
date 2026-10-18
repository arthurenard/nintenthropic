"""The chicken: a white hen pecking along the boardwalk (white reads against
the warm, sunlit wood from the middle of the street).

Her own small rig - body, neck, head, tail, wings, and a bird's legs whose
visible "knee" is really the ankle bending backward - on the same animation
core as the people (keys, easing, planted feet by IK).
Facing -Y in Blender (+Z in glTF), feet on z = 0, her centre about 0.22 m up.
"""
import math
import time
import numpy as np
import bpy
from mathutils import Vector
from . import sdf as S, bl, abake as AB, materials as MT, skin as SKN, anim as A, pipeline as PL, character as C
from .texture import srgb, smoothstep, value_noise, fbm

BONES = [("body", None), ("neck", "body"), ("head", "neck"), ("tail", "body"),
         ("wing.L", "body"), ("wing.R", "body"),
         ("thigh.L", "body"), ("shin.L", "thigh.L"), ("foot.L", "shin.L"),
         ("thigh.R", "body"), ("shin.R", "thigh.R"), ("foot.R", "shin.R")]


def joints():
    J = {
        "body": ((0, 0.05, 0.20), (0, -0.07, 0.225)),
        "neck": ((0, -0.08, 0.255), (0, -0.108, 0.355)),
        "head": ((0, -0.108, 0.355), (0, -0.128, 0.418)),
        "tail": ((0, 0.10, 0.265), (0, 0.17, 0.345)),
        "wing.L": ((0.058, -0.035, 0.262), (0.075, 0.105, 0.240)),
        "thigh.L": ((0.042, 0.015, 0.170), (0.046, 0.034, 0.098)),
        "shin.L": ((0.046, 0.034, 0.098), (0.050, 0.004, 0.016)),
        "foot.L": ((0.050, 0.004, 0.016), (0.052, -0.050, 0.006)),
    }
    out = {}
    for k, (h, t) in J.items():
        out[k] = (np.array(h, float), np.array(t, float))
        if k.endswith(".L"):
            m = np.array([-1, 1, 1.0])
            out[k[:-2] + ".R"] = (out[k][0] * m, out[k][1] * m)
    return out


JOINTS = joints()


def frames():
    F = {}
    for b, _ in BONES:
        h, t = JOINTS[b]
        y = (t - h) / np.linalg.norm(t - h)
        z = np.array([0, 0, 1.0]) if abs(y[2]) < 0.8 else np.array([0, -1.0, 0])
        z = z - (z @ y) * y
        z /= np.linalg.norm(z)
        F[b] = np.stack([np.cross(y, z), y, z], 1)
    return F


FRAMES = frames()
RIG = A.Rig(BONES, JOINTS, FRAMES)


def create_armature(name="rig"):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for b, p in BONES:
        h, t = JOINTS[b]
        e = arm.edit_bones.new(b)
        e.head, e.tail = Vector(h), Vector(t)
        z = FRAMES[b][:, 2]
        e.align_roll(Vector(z))
        if p:
            e.parent = eb[p]
        eb[b] = e
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


# ------------------------------------------------------------------ sculpt

def hen_field():
    body = S.Ellipsoid((0, 0.015, 0.222), (0.082, 0.138, 0.092), S.rot_x(14))
    breast = S.Ellipsoid((0, -0.062, 0.205), (0.074, 0.068, 0.082))
    back = S.Ellipsoid((0, 0.06, 0.262), (0.066, 0.09, 0.05), S.rot_x(20))
    neck = S.RoundCone((0, -0.078, 0.262), (0, -0.108, 0.352), 0.046, 0.026)
    head = S.Ellipsoid((0, -0.117, 0.386), (0.025, 0.032, 0.029))
    beak = S.RoundCone((0, -0.144, 0.384), (0, -0.166, 0.375), 0.0085, 0.0018)
    comb = S.Box((0, -0.118, 0.417), (0.0035, 0.026, 0.011), S.rot_x(8), rad=0.002)
    points = [S.Sphere((0, -0.140 + 0.011 * i, 0.428 + 0.004 * math.sin(i * 1.3)), 0.0055) for i in range(5)]
    wattles = [S.Ellipsoid((s * 0.006, -0.139, 0.356), (0.006, 0.008, 0.012)) for s in (1, -1)]
    earlobes = [S.Ellipsoid((s * 0.024, -0.108, 0.378), (0.003, 0.006, 0.006)) for s in (1, -1)]
    wings = [S.Ellipsoid((s * 0.074, 0.025, 0.232), (0.022, 0.108, 0.058), S.rot_x(12)) for s in (1, -1)]
    tail = S.Ellipsoid((0, 0.135, 0.315), (0.042, 0.048, 0.078), S.rot_x(-32))
    thighs = [S.Ellipsoid((s * 0.046, 0.02, 0.135), (0.034, 0.042, 0.048)) for s in (1, -1)]
    fluff = S.Ellipsoid((0, 0.06, 0.15), (0.05, 0.06, 0.045))
    main = S.Union([body, breast, back, neck, head, tail, fluff] + wings + thighs, k=0.03)
    main = S.Union([main, beak, comb] + points + wattles + earlobes, k=0.004)
    legs = []
    for s in (1, -1):
        hock = (s * 0.046, 0.034, 0.098)
        foot = (s * 0.050, 0.004, 0.012)
        legs.append(S.RoundCone(hock, foot, 0.0075, 0.0062))
        for dx, dy in ((0.0, -0.058), (0.026, -0.044), (-0.026, -0.044), (0.0, 0.03)):
            legs.append(S.RoundCone(foot, (foot[0] + s * dx, foot[1] + dy, 0.004), 0.0045, 0.0028))
    return S.Union([main] + legs, k=0.006)


def feathers(P):
    """Rows of overlapping feathers: a scalloped relief, finer on the head."""
    y, z = P[:, 1], P[:, 2]
    th = np.arctan2(P[:, 0], z - 0.2)
    rows = np.sin((y * 90 + np.abs(th) * 6) + 2.0 * value_noise(P, 40, seed=161)) ** 2
    scal = np.abs(np.sin(th * 14 + y * 40))
    d = 0.0012 * rows * scal * smoothstep(0.09, 0.14, z) * (1 - smoothstep(0.34, 0.37, z))
    return (-d).astype(np.float32)


def hen_paint(P):
    n = len(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    c = np.tile(srgb(0.90, 0.87, 0.80), (n, 1)) * (0.9 + 0.15 * fbm(P, 60, 3, seed=171)[:, None])
    # warmer, dustier underneath; a buff wash on the back and hackles
    c = c * (1 - 0.18 * smoothstep(0.18, 0.08, z)[:, None]) + srgb(0.66, 0.58, 0.46) * 0.18 * smoothstep(0.18, 0.08, z)[:, None]
    hack = smoothstep(0.25, 0.30, z) * smoothstep(-0.05, -0.09, y) * (1 - smoothstep(0.35, 0.37, z))
    c = c * (1 - 0.2 * hack[:, None]) + srgb(0.88, 0.76, 0.52) * 0.2 * hack[:, None]
    r = np.full(n, 0.8)
    red = srgb(0.62, 0.07, 0.05)
    comb = (z > 0.405) | ((z < 0.37) & (z > 0.34) & (y < -0.128))
    c[comb] = red * (0.85 + 0.3 * value_noise(P[comb], 900, seed=172)[:, None])
    r[comb] = 0.5
    face = (z > 0.36) & (z < 0.41) & (np.abs(x) > 0.018) & (y < -0.098) & (y > -0.14)
    c[face] = srgb(0.72, 0.18, 0.12)
    ear = (np.abs(np.abs(x) - 0.024) < 0.004) & (np.abs(y + 0.108) < 0.007) & (np.abs(z - 0.378) < 0.007)
    c[ear] = srgb(0.88, 0.86, 0.80)
    eye = (np.abs(np.abs(x) - 0.021) < 0.0045) & (np.abs(y + 0.126) < 0.0045) & (np.abs(z - 0.392) < 0.0045)
    c[eye] = srgb(0.55, 0.30, 0.06)
    r[eye] = 0.15
    yellow = srgb(0.86, 0.66, 0.24)
    beak = (y < -0.143) & (z > 0.365) & (z < 0.395)
    c[beak] = yellow * 0.95
    r[beak] = 0.45
    legs = z < 0.10
    c[legs] = yellow * (0.8 + 0.25 * np.abs(np.sin(z[legs] * 900)))[:, None]
    r[legs] = 0.55
    return c, r, np.zeros(n)


# ------------------------------------------------------------------ clips

STAND = {"root": (0, 0, 0), "body": (0, 0, 0), "neck": (0, 0, 0), "head": (0, 0, 0), "tail": (0, 0, 0), "wing.L": (0, 0, 0), "wing.R": (0, 0, 0),
         "ik.foot.L": (0.050, 0.004, 0.016), "ik.foot.R": (-0.050, 0.004, 0.016), "pole.foot.L": (0, 1, 0), "pole.foot.R": (0, 1, 0),
         "thigh.L": (0, 0, 0), "shin.L": (0, 0, 0), "foot.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.R": (0, 0, 0), "foot.R": (0, 0, 0)}


def pose(**kw):
    p = dict(STAND)
    for k, v in kw.items():
        p[k.replace("__", ".")] = v
    return p


def peck():
    """Scratch, peck-peck at the boards, straighten, a jerky look about."""
    c = Clip("peck", 1.6, True)
    up = pose(neck=(-4, 0, 0), head=(-6, 0, 0), tail=(-4, 0, 0))
    down = pose(root=(0, -0.01, -0.02), body=(26, 0, 0), neck=(62, 0, 0), head=(18, 0, 0), tail=(-14, 0, 0))
    hit = pose(root=(0, -0.012, -0.024), body=(28, 0, 0), neck=(76, 0, 0), head=(24, 0, 0), tail=(-16, 0, 0))
    look_l = pose(neck=(-6, 0, 18), head=(-8, 14, 30))
    look_r = pose(neck=(-6, 0, -16), head=(-6, -12, -26))
    c.pose(0.0, up)
    c.pose(0.18, down, "inout")
    c.pose(0.24, hit, "snap")
    c.pose(0.32, down, "out")
    c.pose(0.38, hit, "snap")
    c.pose(0.48, down, "out")
    c.pose(0.70, up, "back")
    c.pose(0.86, look_l, "snap")
    c.pose(1.12, look_l, "linear")
    c.pose(1.20, look_r, "snap")
    c.pose(1.44, look_r, "linear")
    c.pose(1.6, up, "snap")
    return c


def Clip(name, dur, loop=False):
    return A.Clip(name, dur, loop, rig=RIG)


def _legs(c, T, stride, lift, speed_hold=True):
    """Stepping in place: each foot plants in front, is carried back under her
    at walking speed, lifts and swings forward again."""
    for side, off, x in (("L", 0.0, 0.05), ("R", 0.5, -0.05)):
        keys = [(0.00, -stride / 2, 0.016, 0), (0.50, stride / 2, 0.016, 0), (0.62, stride / 2 + 0.01, 0.016 + lift * 0.6, 30),
                (0.80, 0.0, 0.016 + lift, 10), (0.94, -stride / 2 - 0.01, 0.016 + lift * 0.3, -15), (1.00, -stride / 2, 0.016, 0)]
        pts = sorted((((ph + off) % 1.0) * T, y, z, p) for ph, y, z, p in keys)
        for t, y, z, p in pts:
            c.key(t, "smooth", **{f"ik__foot__{side}": (x, 0.004 + y, z), f"rot__foot__{side}": (p, 0, 0)})
        # seam the loop
        if pts[0][0] > 0:
            ta, ya, za, pa = pts[-1]
            tb, yb, zb, pb = pts[0]
            u = (T - ta) / ((T - ta) + tb)
            for t in (0.0, T):
                c.key(t, "smooth", **{f"ik__foot__{side}": (x, 0.004 + ya + (yb - ya) * u, za + (zb - za) * u), f"rot__foot__{side}": (pa + (pb - pa) * u, 0, 0)})


def walk():
    """0.4 m/s: short quick steps, the body rolling, and the head doing the
    thing chickens do - held still in the world while the body walks under
    it, then thrust forward."""
    T = 0.5
    c = Clip("walk", T, True)
    _legs(c, T, 0.10, 0.035)
    for ph, s in ((0.0, 1), (0.5, -1), (1.0, 1)):
        c.key(ph * T, "inout", body=(4, 4 * s, 3 * s), tail=(-6, 0, 6 * s), root=(0.004 * s, 0, 0.0))
    # head: hold (drifts back relative to the body), then snap forward
    for ph, y in ((0.0, 0.0), (0.38, 0.022), (0.5, 0.0), (0.88, 0.022), (1.0, 0.0)):
        e = "linear" if y > 0 else "snap"
        # 2 cm of drift on a 10 cm neck is about 12 degrees; the head stays level
        c.key(ph * T, e, neck=(-4 - 550 * y, 0, 0), head=(4 + 550 * y, 0, 0))
    c.key(0.0, "linear", wing__L=(0, 0, 0), wing__R=(0, 0, 0))
    return c


def run():
    """2.6 m/s: long strides, body low and stretched, neck out, wings lifted."""
    T = 0.3
    c = Clip("run", T, True)
    _legs(c, T, 0.26, 0.07)
    for ph, s in ((0.0, 1), (0.5, -1), (1.0, 1)):
        c.key(ph * T, "inout", root=(0, -0.01, -0.02 + 0.012 * (1 if s > 0 else 0)), body=(-14, 3 * s, 2 * s), neck=(-34, 0, 0), head=(26, 0, 0),
              tail=(10, 0, 4 * s), wing__L=(0, -25 - 8 * s, 0), wing__R=(0, 25 + 8 * s, 0))
    return c


def flutter():
    """Startled: a jump, wings beating fast, feet off the boards."""
    T = 0.45
    c = Clip("flutter", T, True)
    for i in range(4):
        t0 = i * T / 3
        c.key(min(t0, T), "inout", wing__L=(0, -70, -10), wing__R=(0, 70, 10))
        c.key(min(t0 + T / 6, T), "inout", wing__L=(0, 20, 20), wing__R=(0, -20, -20))
    c.key(0.0, "out", root=(0, 0, 0.02), body=(-18, 0, 0), neck=(-20, 0, 0), head=(10, 0, 0), tail=(20, 0, 0),
          ik__foot__L=(0.05, 0.03, 0.05), ik__foot__R=(-0.05, 0.03, 0.05), rot__foot__L=(40, 0, 0), rot__foot__R=(40, 0, 0))
    c.key(T * 0.5, "inout", root=(0, 0, 0.07), body=(-24, 0, 0), neck=(-26, 0, 0), head=(14, 0, 0), tail=(26, 0, 0),
          ik__foot__L=(0.05, 0.05, 0.10), ik__foot__R=(-0.05, 0.05, 0.10))
    c.key(T, "inout", root=(0, 0, 0.02), body=(-18, 0, 0), neck=(-20, 0, 0), head=(10, 0, 0), tail=(20, 0, 0),
          ik__foot__L=(0.05, 0.03, 0.05), ik__foot__R=(-0.05, 0.03, 0.05), rot__foot__L=(40, 0, 0), rot__foot__R=(40, 0, 0))
    for side in ("L", "R"):
        c.key(0.0, "linear", **{f"pole__foot__{side}": (0, 1, 0)})
    return c


CLIPS = {"peck": peck, "walk": walk, "run": run, "flutter": flutter}


# ------------------------------------------------------------------ build

def build(path, size=512, tris=2600):
    t0 = time.time()
    bl.clear_scene()
    f = hen_field()
    ob = C.decimated("char.chicken", f, (-0.14, -0.22, -0.01), (0.14, 0.25, 0.46), 0.0012, tris, None, symmetry=True)
    job = dict(ob=ob, field=S.Displace(f, feathers, 0.0015), paint=hen_paint, origin=np.zeros(3), weight=1.0, ao_field=f, smart_uv=True)
    imgs = AB.bake_character([job], size, "chicken", log=PL.log)
    imgs.pop("_atlas", None)
    mat = MT.final_material("chicken", imgs["albedo"], imgs["normal"], imgs["orm"])
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    rig = create_armature("rig")
    proxy = SKN.make_proxy(f, (-0.14, -0.22, -0.01), (0.14, 0.25, 0.46), 0.004)
    SKN.heat_weights(proxy, rig)
    SKN.transfer(proxy, [ob], rig, names=[b for b, _ in BONES])
    bpy.data.objects.remove(proxy)
    bpy.context.scene.render.fps = A.FPS
    for name, maker in CLIPS.items():
        A.bake_clip(RIG, maker(), rig)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    size_b = PL.export(path)
    PL.log(f"chicken: {bl.tri_count(ob)} tris, wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path
