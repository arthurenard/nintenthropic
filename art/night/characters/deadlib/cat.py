"""cat.glb: the black cat on the pickup's cab. It survives everything.

A lean short-haired black cat (about 45 cm nose to rump, the tail as long
again), sculpted like everything else here from soft volumes and baked from
the sculpt: a black coat with a rusty sheen where the light rakes it, pale
whisker pads, the ears' thin undersides. Its eyes are their own mesh, `eyes`,
with a cat's shine - a green-gold that flares in the flashlight.

Its own rig (like High Noon's chicken): hips (root), spine, chest, neck,
head; tail.1-4; front legs shoulder/upper_arm/forearm/hand; hind legs
thigh/shin/foot/toe. Facing +Z in glTF, paws on the origin.
Clips: sit, hiss, leap, walk.
"""

import math
import time

import bpy
import numpy as np
from mathutils import Vector, Matrix

from .common import S, A, AB, MT, SKN, bl, srgb, smoothstep, value_noise, fbm, log
from . import eyes as EY, assemble
from . import meshfix as MF

BONES = [("hips", None), ("spine", "hips"), ("chest", "spine"), ("neck", "chest"), ("head", "neck"),
         ("tail.1", "hips"), ("tail.2", "tail.1"), ("tail.3", "tail.2"), ("tail.4", "tail.3"),
         ("shoulder.L", "chest"), ("upper_arm.L", "shoulder.L"), ("forearm.L", "upper_arm.L"), ("hand.L", "forearm.L"),
         ("shoulder.R", "chest"), ("upper_arm.R", "shoulder.R"), ("forearm.R", "upper_arm.R"), ("hand.R", "forearm.R"),
         ("thigh.L", "hips"), ("shin.L", "thigh.L"), ("foot.L", "shin.L"), ("toe.L", "foot.L"),
         ("thigh.R", "hips"), ("shin.R", "thigh.R"), ("foot.R", "shin.R"), ("toe.R", "foot.R")]
BN = [b for b, _ in BONES]


def joints():
    """A lean domestic cat: 25 cm at the shoulder, 45 cm nose to rump."""
    J = {
        "hips": ((0, 0.125, 0.195), (0, 0.035, 0.205)),
        "spine": ((0, 0.035, 0.205), (0, -0.06, 0.212)),
        "chest": ((0, -0.06, 0.212), (0, -0.115, 0.218)),
        "neck": ((0, -0.115, 0.218), (0, -0.168, 0.278)),
        "head": ((0, -0.168, 0.278), (0, -0.225, 0.296)),
        "tail.1": ((0, 0.14, 0.198), (0, 0.20, 0.185)),
        "tail.2": ((0, 0.20, 0.185), (0, 0.265, 0.17)),
        "tail.3": ((0, 0.265, 0.17), (0, 0.325, 0.16)),
        "tail.4": ((0, 0.325, 0.16), (0, 0.385, 0.155)),
        "shoulder.L": ((0.018, -0.085, 0.22), (0.034, -0.105, 0.17)),
        "upper_arm.L": ((0.034, -0.105, 0.17), (0.037, -0.095, 0.105)),
        "forearm.L": ((0.037, -0.095, 0.105), (0.038, -0.11, 0.028)),
        "hand.L": ((0.038, -0.11, 0.028), (0.038, -0.135, 0.008)),
        "thigh.L": ((0.038, 0.095, 0.175), (0.044, 0.055, 0.11)),
        "shin.L": ((0.044, 0.055, 0.11), (0.044, 0.118, 0.058)),
        "foot.L": ((0.044, 0.118, 0.058), (0.043, 0.103, 0.011)),
        "toe.L": ((0.043, 0.103, 0.011), (0.043, 0.078, 0.007)),
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
        z = np.array([0, -1.0, 0]) if abs(y[1]) < 0.8 else np.array([0, 0, 1.0])
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
        e.align_roll(Vector(FRAMES[b][:, 2]))
        if p:
            e.parent = eb[p]
        eb[b] = e
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


# ------------------------------------------------------------------ sculpt

EYE_L = np.array([0.0185, -0.228, 0.301])
EYE_R = EYE_L * np.array([-1, 1, 1])
EYE_RAD = 0.0086


def cat_field():
    J = JOINTS
    # a cat is deep-chested and its coat fills out the neck: no greyhound
    ribs = S.Ellipsoid((0, -0.068, 0.188), (0.050, 0.080, 0.062), S.rot_x(-4))
    waist = S.Ellipsoid((0, 0.02, 0.186), (0.043, 0.072, 0.050))
    haunch = S.Ellipsoid((0, 0.092, 0.184), (0.051, 0.066, 0.058), S.rot_x(10))
    body = S.Union([ribs, waist, haunch], k=0.035)
    neck = S.RoundCone((0, -0.11, 0.212), (0, -0.165, 0.272), 0.041, 0.035)
    skull = S.Ellipsoid((0, -0.196, 0.297), (0.042, 0.043, 0.037))
    cheeks = S.Union([S.Ellipsoid((s * 0.024, -0.216, 0.286), (0.021, 0.022, 0.019)) for s in (1, -1)], k=0.01)
    muzzle = S.Ellipsoid((0, -0.232, 0.280), (0.016, 0.013, 0.012))
    pads = S.Union([S.Sphere((s * 0.0075, -0.241, 0.279), 0.0078) for s in (1, -1)], k=0.005)
    chin = S.Ellipsoid((0, -0.232, 0.268), (0.0085, 0.010, 0.0065))
    nose = S.Ellipsoid((0, -0.247, 0.287), (0.0055, 0.0035, 0.0035))
    brow = S.Union([S.Ellipsoid((s * 0.018, -0.222, 0.312), (0.013, 0.012, 0.007)) for s in (1, -1)], k=0.006)
    head = S.Union([skull, cheeks, muzzle, pads, chin, nose, brow], k=0.01)
    ears = []
    for s in (1, -1):
        base = np.array([s * 0.024, -0.192, 0.322])
        tip = np.array([s * 0.036, -0.186, 0.368])
        e = S.RoundCone(base, tip, 0.017, 0.0015)
        e = S.Intersect(e, S.Plane(base + np.array([0, 0.003, 0]), (0, 1, 0.15), base - 0.05, base + 0.08), k=0.003)
        hole = S.RoundCone(base + np.array([0, -0.0055, 0.004]), tip + np.array([0, -0.004, -0.004]), 0.0125, 0.0008)
        ears.append(S.Subtract(e, hole, k=0.0015))
    head = S.Union([head] + ears, k=0.005)
    head = S.Subtract(head, S.Union([S.Sphere(e, EYE_RAD + 0.0004) for e in (EYE_L, EYE_R)]), k=0.0015)
    head = S.Subtract(head, S.Ellipsoid((0, -0.241, 0.271), (0.010, 0.008, 0.001)), k=0.0008)
    legs = []
    for s in (1, -1):
        t = "L" if s > 0 else "R"
        sh, el = J[f"upper_arm.{t}"]
        wr = J[f"forearm.{t}"][1]
        legs += [S.RoundCone(J[f"shoulder.{t}"][0] + np.array([0, 0.0, -0.01]), sh, 0.027, 0.022),
                 S.RoundCone(sh, el, 0.021, 0.014), S.RoundCone(el, wr, 0.0128, 0.0095),
                 S.Ellipsoid(wr + np.array([0, -0.013, -0.015]), (0.0125, 0.017, 0.0085))]
        hp, kn = J[f"thigh.{t}"]
        hk = J[f"shin.{t}"][1]
        ft = J[f"foot.{t}"][1]
        legs += [S.RoundCone(hp + np.array([0, 0.005, 0.01]), kn, 0.035, 0.018), S.RoundCone(kn, hk, 0.014, 0.009),
                 S.RoundCone(hk, ft, 0.0078, 0.0085), S.Ellipsoid(ft + np.array([0, -0.015, 0.0]), (0.0125, 0.019, 0.0085))]
    tail = []
    pts = [J[f"tail.{i}"][0] for i in range(1, 5)] + [J["tail.4"][1]]
    for i in range(4):
        tail.append(S.RoundCone(pts[i], pts[i + 1], 0.0135 - 0.0013 * i, 0.0122 - 0.0013 * i))
    tail.append(S.Sphere(pts[-1], 0.0068))
    f = S.Union([body, neck, head] + legs + tail, k=0.014)

    def fur(P):
        # short coat lying back along the body: streaks stretched along y
        n1 = value_noise(P * np.array([1400.0, 260.0, 1400.0]), 1.0, seed=3)
        n2 = value_noise(P * np.array([600.0, 120.0, 600.0]), 1.0, seed=4)
        return (-0.00016 * n1 - 0.00018 * n2).astype(np.float32)
    return f, S.Displace(f, fur, 0.0008)


def cat_paint(P):
    n = len(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    c = np.tile(srgb(0.045, 0.040, 0.038), (n, 1))
    sheen = fbm(P, 50, 3, seed=5)
    c = c * (0.75 + 0.5 * sheen[:, None]) + srgb(0.12, 0.07, 0.04) * 0.25 * smoothstep(0.55, 0.8, sheen)[:, None]
    r = np.full(n, 0.55) - 0.1 * sheen
    # whisker pads and the chin a touch paler; the nose leather; inner ears
    pads = (y < -0.236) & (z < 0.288) & (z > 0.268)
    c[pads] = c[pads] * 1.6 + 0.01
    nose = (y < -0.244) & (np.abs(x) < 0.006) & (np.abs(z - 0.287) < 0.004)
    c[nose] = srgb(0.08, 0.06, 0.06)
    r[nose] = 0.3
    ear_in = (z > 0.33) & (y < -0.19) & (np.abs(np.abs(x) - 0.03) < 0.011)
    c[ear_in] = srgb(0.16, 0.10, 0.10)
    # whiskers: fine pale lines on the pads
    wh = pads & (np.abs(np.sin(z * 1400 + x * 300)) > 0.97)
    c[wh] = srgb(0.6, 0.58, 0.55)
    return np.clip(c, 0, 1), np.clip(r, 0.2, 1), np.zeros(n)


def cat_eyes():
    V, F, UV = [], [], []
    for e, sgn in ((EYE_L, 1), (EYE_R, -1)):
        gaze = (0.22 * sgn, -1.0, 0.04)
        v, f, uv = eyeball_cat(e, gaze)
        base = len(V)
        V += v
        UV += uv
        F += [tuple(base + i for i in fc) for fc in f]
    ob = bl.mesh_from_arrays("eyes", np.array(V, np.float32), F, None)
    me = ob.data
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    bl.set_uv(ob, np.array(UV, np.float32)[lv])
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    for fc in bm.faces:
        cen = fc.calc_center_median()
        eye = Vector(EYE_L) if cen.x > 0 else Vector(EYE_R)
        if fc.normal.dot(cen - eye) < 0:
            fc.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(cat_eye_material())
    return ob


def eyeball_cat(e, gaze):
    """The eyeball() of eyes.py at a cat's size: a bigger cornea dome."""
    f = Vector(gaze).normalized()
    up = Vector((0, 0, 1))
    a = (up - f * up.dot(f)).normalized()
    b = f.cross(a)
    V, UV, rings = [], [], []
    for th in EY.THETA:
        t = math.radians(th)
        ring = []
        n = 1 if th in (0, 180) else EY.SEG
        for k in range(n):
            ph = 2 * math.pi * k / EY.SEG
            u = f * math.cos(t) + (a * math.cos(ph) + b * math.sin(ph)) * math.sin(t)
            r = EYE_RAD * (1.0 + 0.12 * max(0.0, math.cos(t)) ** 2)
            ring.append(len(V))
            V.append(tuple(Vector(e) + u * r))
            rr = 0.5 * t / math.pi
            UV.append((0.5 + rr * math.cos(ph), 0.5 + rr * math.sin(ph)))
        rings.append(ring)
    F = []
    for i in range(len(rings) - 1):
        ra, rb = rings[i], rings[i + 1]
        if len(ra) == 1:
            F += [(ra[0], rb[(k + 1) % EY.SEG], rb[k]) for k in range(EY.SEG)]
        elif len(rb) == 1:
            F += [(ra[k], ra[(k + 1) % EY.SEG], rb[0]) for k in range(EY.SEG)]
        else:
            F += [(ra[k], ra[(k + 1) % EY.SEG], rb[(k + 1) % EY.SEG], rb[k]) for k in range(EY.SEG)]
    return V, F, UV


def cat_eye_material(tex=128):
    ys, xs = np.mgrid[0:tex, 0:tex]
    u = (xs + 0.5) / tex - 0.5
    v = (ys + 0.5) / tex - 0.5
    th = np.degrees(np.hypot(u, v) * 2 * math.pi)
    streak = value_noise(np.stack([np.arctan2(v, u).ravel() * 7, th.ravel() * 0.3, np.zeros(tex * tex)], 1), 1.0, seed=9).reshape(tex, tex)
    iris = srgb(0.62, 0.62, 0.18) * (0.75 + 0.4 * streak[..., None])
    iris = iris * (1 - 0.35 * smoothstep(20, 34, th)[..., None]) + srgb(0.35, 0.45, 0.15) * 0.35 * smoothstep(20, 34, th)[..., None]
    slit = (np.abs(u) < 0.012 + 0.01 * smoothstep(12, 0, th)) & (th < 30)
    col = np.where(slit[..., None], srgb(0.02, 0.02, 0.02), iris)
    col = np.where((th > 40)[..., None], srgb(0.05, 0.05, 0.04), col)
    em = np.array([0.55, 1.0, 0.35])[None, None, :] * smoothstep(38, 20, th)[..., None]
    m = bpy.data.materials.new("eyes")
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    ia = nt.nodes.new("ShaderNodeTexImage")
    ia.image = EY._img("cat_eyes_albedo", col)
    nt.links.new(ia.outputs["Color"], bs.inputs["Base Color"])
    ie = nt.nodes.new("ShaderNodeTexImage")
    ie.image = EY._img("cat_eyes_shine", em)
    nt.links.new(ie.outputs["Color"], bs.inputs["Emission Color"])
    bs.inputs["Emission Strength"].default_value = 1.0
    bs.inputs["Roughness"].default_value = 0.08
    m["eyeshine"] = {"drive": "emissiveIntensity", "dark": 0.0, "lit": 3.0}
    return m


# ------------------------------------------------------------------ clips

def limb_ik(upper, lower, end, key, pole_key):
    """Layer: two-bone IK for a leg the solver does not know (the front legs),
    from an armature-space target, written back as FK rotations."""
    def layer(t, pose):
        if key not in pose:
            return
        R_ = {b: A.E(*pose[b]) for b in RIG.order if b in pose}
        G_, pos = RIG.fk(R_, Vector(pose.get("root", (0, 0, 0))))
        tgt = Vector(pose[key])
        pd = Vector(pose.get(pole_key, (0, -1, 0)))
        pole = pos[upper] + (tgt - pos[upper]) * 0.5 + pd * 0.5
        A.two_bone_ik(RIG, R_, G_, pos, upper, lower, end, tgt, pole, None)
        for b in (upper, lower):
            pose[b] = tuple(math.degrees(a) for a in R_[b].to_euler("XYZ"))
    return layer


def pose(**kw):
    base = {"root": (0, 0, 0), "hips": (0, 0, 0), "spine": (0, 0, 0), "chest": (0, 0, 0), "neck": (0, 0, 0), "head": (0, 0, 0),
            "tail.1": (0, 0, 0), "tail.2": (0, 0, 0), "tail.3": (0, 0, 0), "tail.4": (0, 0, 0),
            "shoulder.L": (0, 0, 0), "shoulder.R": (0, 0, 0), "hand.L": (0, 0, 0), "hand.R": (0, 0, 0),
            "fik.L": tuple(JOINTS["hand.L"][0]), "fik.R": tuple(JOINTS["hand.R"][0]),
            "fpole.L": (0, 1, 0), "fpole.R": (0, 1, 0),
            "ik.foot.L": tuple(JOINTS["foot.L"][0]), "ik.foot.R": tuple(JOINTS["foot.R"][0]),
            "rot.foot.L": (0, 0, 0), "rot.foot.R": (0, 0, 0), "pole.foot.L": (0, -1, 0), "pole.foot.R": (0, -1, 0),
            "toe.L": (0, 0, 0), "toe.R": (0, 0, 0)}
    for k, v in kw.items():
        base[k.replace("__", ".")] = v
    return base


def Clip(name, dur, loop=False):
    c = A.Clip(name, dur, loop, rig=RIG)
    c.layers += [limb_ik("upper_arm.L", "forearm.L", "hand.L", "fik.L", "fpole.L"),
                 limb_ik("upper_arm.R", "forearm.R", "hand.R", "fik.R", "fpole.R")]
    return c


def sit():
    """Sitting on its haunches, tail wrapped round its feet; it looks about,
    the tail tip flicks."""
    T = 4.0
    c = Clip("sit", T, loop=True)
    # the pelvis tips back onto the haunches, the spine rises to ~45 degrees,
    # the hind legs fold flat: hock on the ground under the haunch, the long
    # foot lying forward, the knee tucked beside the ribs
    s = pose(root=(0, 0.02, -0.10), hips=(-46, 0, 0), spine=(-6, 0, 0), chest=(-8, 0, 0), neck=(18, 0, 0), head=(30, 0, 0),
             ik__foot__L=(0.056, 0.10, 0.014), ik__foot__R=(-0.056, 0.10, 0.014), rot__foot__L=(-80, 0, 0), rot__foot__R=(-80, 0, 0),
             pole__foot__L=(0.3, -1, 0.3), pole__foot__R=(-0.3, -1, 0.3),
             fik__L=(0.040, -0.08, 0.025), fik__R=(-0.040, -0.08, 0.025),
             tail__1=(-35, 0, 35), tail__2=(-10, 0, 45), tail__3=(0, 0, 45), tail__4=(0, 0, 35))
    look_l = dict(s)
    look_l.update({"head": (36, 0, 28), "neck": (10, 0, 10)})
    look_r = dict(s)
    look_r.update({"head": (32, 4, -24), "neck": (8, 0, -8)})
    c.pose(0.0, s)
    c.pose(1.1, look_l, "inout")
    c.pose(2.2, look_l, "linear")
    c.pose(2.6, look_r, "inout")
    c.pose(3.4, look_r, "linear")
    c.pose(T, s, "inout")
    for t, k in ((0.0, 30), (0.5, 50), (1.0, 20), (1.8, 45), (2.4, 25), (3.2, 50), (4.0, 30)):
        c.key(t, "inout", tail__4=(0, 0, k))
    return c


def hiss():
    """Arched, side-on, fur up: the back bowed high, the tail up and bristling,
    ears back, the head low and jabbing, hissing."""
    T = 1.2
    c = Clip("hiss", T, loop=True)
    a = pose(root=(0, 0.0, 0.04), hips=(20, 0, 20), spine=(-25, 0, 0), chest=(-18, 0, 0), neck=(30, 0, -20), head=(0, 0, -30),
             ik__foot__L=(0.06, 0.06, 0.06), ik__foot__R=(-0.06, 0.08, 0.06), fik__L=(0.05, -0.09, 0.025), fik__R=(-0.05, -0.07, 0.025),
             tail__1=(75, 0, 0), tail__2=(15, 0, 0), tail__3=(-12, 0, 0), tail__4=(-25, 0, 0))
    jab = dict(a)
    jab.update({"neck": (36, 0, -24), "head": (6, 0, -34), "chest": (-14, 0, 0)})
    c.pose(0.0, a)
    c.pose(0.35, jab, "snap")
    c.pose(0.6, a, "inout")
    c.pose(0.8, jab, "snap")
    c.pose(T, a, "inout")
    return c


def leap():
    """A jump up to a ledge (the cab, the booth, the sign): crouch, spring,
    stretch, tuck, land crouched (the landing at 0.62 s; the game moves the
    cat between spots over 0.25-0.62 s)."""
    T = 1.0
    c = Clip("leap", T)
    stand = pose()
    crouch = pose(root=(0, 0.03, -0.07), hips=(-10, 0, 0), spine=(4, 0, 0), chest=(6, 0, 0), neck=(-10, 0, 0), head=(-6, 0, 0),
                  ik__foot__L=(0.052, 0.10, 0.06), ik__foot__R=(-0.052, 0.10, 0.06), fik__L=(0.046, -0.17, 0.025), fik__R=(-0.046, -0.17, 0.025),
                  tail__1=(10, 0, 0))
    stretch = pose(root=(0, -0.12, 0.34), hips=(20, 0, 0), spine=(-4, 0, 0), chest=(-10, 0, 0), neck=(-20, 0, 0), head=(-10, 0, 0),
                   ik__foot__L=(0.052, 0.34, 0.3), ik__foot__R=(-0.052, 0.36, 0.3), rot__foot__L=(60, 0, 0), rot__foot__R=(60, 0, 0),
                   fik__L=(0.038, -0.34, 0.34), fik__R=(-0.038, -0.32, 0.34), tail__1=(20, 0, 0), tail__2=(-10, 0, 0))
    tuck = pose(root=(0, -0.06, 0.26), hips=(-6, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-6, 0, 0), head=(-6, 0, 0),
                ik__foot__L=(0.052, 0.14, 0.22), ik__foot__R=(-0.052, 0.15, 0.22), fik__L=(0.046, -0.22, 0.24), fik__R=(-0.046, -0.22, 0.24))
    c.pose(0.0, stand)
    c.pose(0.2, crouch, "inout")
    c.pose(0.36, stretch, "out")
    c.pose(0.52, tuck, "inout")
    c.pose(0.64, crouch, "in2")
    c.pose(T, stand, "inout")
    return c


def walk():
    """A lateral-sequence walk, ~0.6 m/s: hind left, fore left, hind right,
    fore right; the shoulders roll, the head steady, the tail up and curving."""
    T = 0.9
    c = Clip("walk", T, loop=True)
    L = 0.24
    for key, side, off, x, zf in (("ik.foot.L", "L", 0.0, 0.052, 0.062), ("ik.foot.R", "R", 0.5, -0.052, 0.062),
                                  ("fik.L", "L", 0.25, 0.046, 0.025), ("fik.R", "R", 0.75, -0.046, 0.025)):
        hind = key.startswith("ik.foot")
        y0 = JOINTS["foot.L"][0][1] if hind else JOINTS["hand.L"][0][1]
        keys = [(0.0, y0 - L / 2, zf), (0.6, y0 + L / 2, zf), (0.75, y0 + L / 4, zf + 0.035), (0.9, y0 - L / 3, zf + 0.025), (1.0, y0 - L / 2, zf)]
        pts = sorted((((ph + off) % 1.0) * T, y, z) for ph, y, z in keys)
        k_ = key.replace(".", "__")
        for t, y, z in pts:
            c.key(t, "smooth", **{k_: (x, y, z)})
        if pts[0][0] > 0:
            ta, ya, za = pts[-1]
            tb, yb, zb = pts[0]
            u = (T - ta) / ((T - ta) + tb)
            for t in (0.0, T):
                c.key(t, "smooth", **{k_: (x, ya + (yb - ya) * u, za + (zb - za) * u)})
    for ph, s in ((0.0, 1), (0.25, 0), (0.5, -1), (0.75, 0), (1.0, 1)):
        c.key(ph * T, "inout", root=(0.004 * s, 0, -0.004 * abs(s)), hips=(0, 3 * s, 4 * s), spine=(0, -2 * s, -2 * s),
              chest=(0, -3 * s, -4 * s), neck=(0, 0, 3 * s), head=(0, 0, 2 * s), tail__1=(48, 0, 8 * s), tail__2=(14, 0, 10 * s),
              tail__3=(-14, 0, 8 * s), tail__4=(-26, 0, 6 * s), rot__foot__L=(0, 0, 0), rot__foot__R=(0, 0, 0),
              pole__foot__L=(0, -1, 0), pole__foot__R=(0, -1, 0), fpole__L=(0, 1, 0), fpole__R=(0, 1, 0))
    return c


CLIPS = {"sit": sit, "hiss": hiss, "leap": leap, "walk": walk}
META = {"sit": {"loop": True}, "hiss": {"loop": True}, "leap": {"land_s": 0.64, "rise_m": 0.34}, "walk": {"loop": True, "speed_mps": 0.6}}


def build(path, size=512, quick=False):
    t0 = time.time()
    bl.clear_scene()
    f, detailed = cat_field()
    ob = MF.decimated("char.cat", f, (-0.1, -0.28, -0.01), (0.1, 0.42, 0.39), 0.0009, 4200 if not quick else 2400, None, symmetry=True)
    job = dict(ob=ob, field=detailed, paint=cat_paint, origin=np.zeros(3), weight=1.0, ao_field=f, smart_uv=True, uv_angle=66)
    imgs = AB.bake_character([job], size, "cat", log=log)
    imgs.pop("_atlas", None)
    mat = MT.final_material("cat", imgs["albedo"], imgs["normal"], imgs["orm"])
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    rig = create_armature("rig")
    proxy = SKN.make_proxy(f, (-0.1, -0.28, -0.01), (0.1, 0.42, 0.39), 0.0025)
    SKN.heat_weights(proxy, rig)
    SKN.transfer(proxy, [ob], rig, names=BN)
    bpy.data.objects.remove(proxy)
    ey = cat_eyes()
    W = np.zeros((len(ey.data.vertices), len(BN)), np.float32)
    W[:, BN.index("head")] = 1.0
    SKN.apply_weights(ey, W, rig, 1, BN)
    assemble.bake_clips(rig, CLIPS, RIG)
    size_b = assemble.export(path, extras=dict(clips=META))
    log(f"cat: {bl.tri_count(ob)} tris, wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path
