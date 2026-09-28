"""Plumbing shared by every animal of the Valle Serra.

Built on High Noon's character library (art/western/characters/charlib, read
only): the same SDF sculpting, surface nets, analytic atlas bake, bone-heat
weights and keyed-clip core that made the hen. What is added here is what a
four-legged animal (or an eagle) needs and a person does not:

- skeletons from any bone table, with legs solved by IK as three-bone chains
  (the hoof is planted, the cannon keeps the angle the clip gives it, and the
  two bones above are solved to reach its top);
- clips that mix keys with procedural layers (a walk is a gait generator, not
  a hundred hand keys) and post passes that simulate a pendulum (the cow's
  bell swings because the neck moves, not because someone keyed it);
- one atlas per animal where the head gets more texels than the belly
  (UV islands are scaled by where they are before packing);
- several armatures in one file: each animal's clips are stashed on its own
  armature as NLA strips, which the glTF exporter turns into animations named
  after the actions (`cow.walk`) that drive only that animal's bones.

Blender space throughout: Z up, metres, the animal faces -Y (glTF +Z), its
left is +X, hooves/feet on z = 0 around the origin.
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CHARS = os.path.join(REPO, "art", "western", "characters")
for _p in (CHARS, os.path.join(REPO, "art", "ridge")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from charlib import sdf as S, polygonize as PG, bl, abake as AB, bake as BK, materials as MT, skin as SKN, anim as A  # noqa: E402
from charlib.texture import srgb, smoothstep, value_noise, fbm  # noqa: E402,F401

FPS = A.FPS
T0 = time.time()
# atlas PNGs for review (the .glb carries WebP); a build product, not committed
ATLAS_DIR = os.path.join(REPO, "art", "ridge", "build", "review", "fauna", "atlas")


def log(*a):
    print(f"[fauna {time.time() - T0:6.1f}s]", *a, flush=True)


class stage:
    """`with stage("cow: bake"):` prints how long a step took."""

    def __init__(self, name):
        self.name = name

    def __enter__(self):
        self.t = time.time()
        return self

    def __exit__(self, *exc):
        log(f"{self.name}: {time.time() - self.t:.1f}s")


# ------------------------------------------------------------------ small maths

def nrm(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def frame_from(y, up=(0, 0, 1)):
    """3x3 with columns x, y, z: y along `y`, z as close to `up` as possible."""
    y = nrm(y)
    z = np.asarray(up, float)
    z = z - (z @ y) * y
    if np.linalg.norm(z) < 1e-6:
        z = np.array([0, -1.0, 0]) - y[1] * y
    z = nrm(z)
    return np.stack([np.cross(y, z), y, z], 1).astype(np.float32)


def curve(points, n):
    """n points along a Catmull-Rom curve through `points`."""
    pts = np.asarray(points, float)
    t = np.linspace(0, len(pts) - 1, n)
    return S.catmull(pts, t)


def chain(points, radii, n=None, k=0.0, label=0):
    """A bent tapered limb (a horn, a tail, a toe): capsules along a smooth
    curve through `points`, radius interpolated from `radii` (one per point)."""
    n = n or max(3, 3 * len(points))
    P = curve(points, n)
    r = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(radii)), radii)
    parts = [S.RoundCone(P[i], P[i + 1], float(r[i]), float(r[i + 1]), label=label) for i in range(n - 1)]
    return S.Union(parts, k=k)


class SmoothTube(S.Node):
    """A generalised cylinder (elliptic sections along a curve) whose field is
    smooth everywhere.

    charlib's Tube projects a point onto its nearest centreline segment; on
    the inside of a bend the nearest segment switches abruptly and the field
    steps by a fraction of a millimetre. The mesh never shows it (it is
    blurred), but the baked normals are finite differences of the field, and
    every texel straddling a step gets a spiked normal: a dotted ring round
    the body at every station. Here the section frame, centre and radii are a
    Gaussian-weighted blend of nearby stations (weights by distance to the
    station points, relative to the nearest), so everything varies smoothly.
    Flat caps at the ends, like Tube (they are buried in other shapes)."""

    def __init__(self, pts, rx, ry, n=32, side=(1, 0, 0), label=0):
        k = len(pts)
        t = np.linspace(0, k - 1, n)
        self.C = S.catmull(np.asarray(pts, float), t)
        self.rx = S.catmull(np.asarray(rx, float), t)
        self.ry = S.catmull(np.asarray(ry, float), t)
        T = np.gradient(self.C, axis=0)
        self.T = T / np.linalg.norm(T, axis=1)[:, None]
        sd = np.asarray(side, float)
        X = sd[None, :] - (self.T @ sd)[:, None] * self.T
        self.X = X / np.linalg.norm(X, axis=1)[:, None]
        sp = np.linalg.norm(np.diff(self.C, axis=0), axis=1).mean()
        self.sig2 = (1.2 * sp) ** 2
        r = max(self.rx.max(), self.ry.max()) * 1.3
        self.lo = (self.C.min(0) - r).astype(S.F)
        self.hi = (self.C.max(0) + r).astype(S.F)
        self.label = label

    def eval(self, P):
        P = np.asarray(P, np.float64)
        out = np.empty(len(P), np.float64)
        for a in range(0, len(P), 32768):
            Pc = P[a:a + 32768]
            D2 = ((Pc[:, None, :] - self.C[None, :, :]) ** 2).sum(2)
            D2 -= D2.min(1, keepdims=True)
            W = np.exp(-D2 / self.sig2)
            W /= W.sum(1, keepdims=True)
            c = W @ self.C
            tg = W @ self.T
            tg /= np.linalg.norm(tg, axis=1)[:, None]
            x = W @ self.X
            x -= (x * tg).sum(1)[:, None] * tg
            x /= np.linalg.norm(x, axis=1)[:, None]
            y = np.cross(tg, x)
            rx, ry = W @ self.rx, W @ self.ry
            q = Pc - c
            qp = q - (q * tg).sum(1)[:, None] * tg
            qx, qy = (qp * x).sum(1), (qp * y).sum(1)
            rho = np.sqrt(qx * qx + qy * qy)
            th = np.arctan2(qy, qx)
            R = 1.0 / np.sqrt((np.cos(th) / rx) ** 2 + (np.sin(th) / ry) ** 2)
            d = rho - R
            e = np.maximum(-((Pc - self.C[0]) @ self.T[0]), (Pc - self.C[-1]) @ self.T[-1])
            out[a:a + 32768] = np.where(e > 0, np.where(d > 0, np.sqrt(d * d + e * e), e), np.maximum(d, e))
        return out.astype(S.F)


def tube(pts, rx, ry, n=32, side=(1, 0, 0)):
    return SmoothTube(pts, rx, ry, n, side)


def scaled(node, origin, k):
    """A field scaled by k about origin (exact: distances scale too)."""
    o = np.asarray(origin, np.float32)
    lo = o + (np.asarray(node.lo) - o) * k
    hi = o + (np.asarray(node.hi) - o) * k
    return S.Fn(lambda P: node(o + (np.asarray(P, np.float32) - o) / k) * k, np.minimum(lo, hi), np.maximum(lo, hi))


def mirror_x(node):
    """The same field reflected across x = 0 (a right ear from a left one)."""
    lo, hi = np.asarray(node.lo), np.asarray(node.hi)
    return S.Fn(lambda P: node((P * np.array([-1, 1, 1], np.float32)).astype(np.float32)),
                np.array([-hi[0], lo[1], lo[2]]), np.array([-lo[0], hi[1], hi[2]]))


def both(make):
    """[left, right] fields from a builder make(s) with s = +1 (left) / -1 (right)."""
    return [make(1.0), make(-1.0)]


class Frame:
    """A local frame to sculpt a part in (a head carried nose-down): points
    are given as (x = the animal's left, s = along the part, h = its up)."""

    def __init__(self, origin, fwd, up=(0, 0, 1)):
        self.o = np.asarray(origin, float)
        self.S = nrm(fwd)
        h = np.asarray(up, float)
        self.H = nrm(h - (h @ self.S) * self.S)
        self.X = nrm(np.cross(self.H, self.S))
        self.R = np.stack([self.X, self.S, self.H], 1).astype(np.float32)

    def p(self, x, s, h):
        return self.o + x * self.X + s * self.S + h * self.H

    def local(self, P):
        """World points (n, 3) -> (x, s, h) columns."""
        Q = np.asarray(P, float) - self.o
        return Q @ self.X, Q @ self.S, Q @ self.H


def flow_noise(P, flow, along, across, seed):
    """Value noise stretched along a per-point direction: hair lies in a
    direction, so its colour varies slowly along the strands and quickly
    across them. `flow` is (n, 3) unit vectors."""
    P = np.asarray(P, float)
    s = (P * flow).sum(1)[:, None]
    Q = P * across - flow * s * (across - along)
    return value_noise(Q, 1.0, seed=seed)


# ------------------------------------------------------------------ skeletons

class Skeleton:
    """A bone table with rest joints. `joints` gives (head, tail) per bone;
    bones ending in .L are mirrored to .R."""

    def __init__(self, bones, joints):
        self.bones = list(bones)
        self.names = [b for b, _ in bones]
        J = {}
        for k, (h, t) in joints.items():
            J[k] = (np.asarray(h, float), np.asarray(t, float))
            if k.endswith(".L"):
                m = np.array([-1, 1, 1.0])
                J[k[:-2] + ".R"] = (J[k][0] * m, J[k][1] * m)
        missing = [b for b in self.names if b not in J]
        assert not missing, f"no joints for {missing}"
        self.joints = J
        # rest frames as the hen's: local Y along the bone, local Z up (or
        # forward for a bone that hangs down), so local X is the natural hinge
        self.frames = {}
        for b in self.names:
            h, t = J[b]
            y = nrm(t - h)
            z = np.array([0, 0, 1.0]) if abs(y[2]) < 0.8 else np.array([0, -1.0, 0])
            z = nrm(z - (z @ y) * y)
            self.frames[b] = np.stack([np.cross(y, z), y, z], 1)
        self.rig = A.Rig(self.bones, self.joints, self.frames)

    def create(self, name, coll=None):
        """The armature object (named after the animal: it is the glTF root node)."""
        arm = bpy.data.armatures.new(name + "_rig")
        arm.display_type = "STICK"
        ob = bpy.data.objects.new(name, arm)
        (coll or bpy.context.scene.collection).objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        eb = {}
        for b, p in self.bones:
            h, t = self.joints[b]
            e = arm.edit_bones.new(b)
            e.head, e.tail = Vector(h), Vector(t)
            e.align_roll(Vector(self.frames[b][:, 2]))
            if p:
                e.parent = eb[p]
            e.use_deform = True
            eb[b] = e
        bpy.ops.object.mode_set(mode="OBJECT")
        for pb in ob.pose.bones:
            pb.rotation_mode = "QUATERNION"
        return ob


class Body:
    """How a skeleton is posed: FK rotations plus IK legs.

    legs: {leg: (upper, lower, foot)}. A leg is solved from its foot target
    (`ik.<leg>`, the foot bone's TAIL: the hoof's sole or the paw's pad) and the
    foot bone's world orientation (`rot.<leg>`, Euler degrees relative to rest):
    the foot's top (hock, carpus, ankle) is placed at target - rot @ foot, and
    the two bones above are bent toward the rest pose's knee direction, carried
    by the parent (so a knee keeps pointing forward when the body pitches)."""

    def __init__(self, skel, legs):
        self.skel = skel
        self.rig = skel.rig
        self.legs = dict(legs)
        J = skel.joints
        self.pole, self.foot0 = {}, {}
        for leg, (u, l, f) in self.legs.items():
            mid = (J[u][0] + J[f][0]) * 0.5
            self.pole[leg] = Vector(nrm(J[l][0] - mid))
            self.foot0[leg] = tuple(J[f][1])

    def rest(self, **kw):
        p = {"root": (0.0, 0.0, 0.0)}
        for leg in self.legs:
            p[f"ik.{leg}"] = self.foot0[leg]
            p[f"rot.{leg}"] = (0.0, 0.0, 0.0)
        for k, v in kw.items():
            p[k.replace("__", ".")] = v
        return p

    def fk(self, R, off, moves):
        """anim.Rig.fk plus bone translations (`move.<bone>`, in the parent's
        axes): a shoulder joint gliding with the shoulder blade."""
        rig = self.rig
        G, pos = {}, {}
        I = Matrix.Identity(3)
        for b in rig.order:
            p = rig.parent[b]
            r = R.get(b, I)
            if p is None:
                G[b] = r
                pos[b] = rig.head[b] + off
            else:
                G[b] = G[p] @ r
                d = rig.head[b] - rig.head[p]
                if b in moves:
                    d = d + moves[b]
                pos[b] = pos[p] + G[p] @ d
        return G, pos

    def solve(self, pose):
        rig = self.rig
        R = {}
        for b in rig.order:
            if b in pose:
                R[b] = A.E(*pose[b])
        off = Vector(tuple(pose.get("root", (0, 0, 0))))
        moves = {k[5:]: Vector(tuple(v)) for k, v in pose.items() if k.startswith("move.")}
        G, pos = self.fk(R, off, moves)
        for leg, (u, l, f) in self.legs.items():
            k = f"ik.{leg}"
            if k not in pose:
                continue
            w = float(np.asarray(pose.get(f"ikw.{leg}", (1.0,))).ravel()[0])
            if w <= 1e-4:
                continue
            rot = A.E(*pose.get(f"rot.{leg}", (0, 0, 0)))
            foot = rot @ (rig.tail[f] - rig.head[f])
            tgt = Vector(tuple(pose[k])) - foot
            p = rig.parent[u]
            pd = self.pole[leg]
            if f"pole.{leg}" in pose:
                pd = Vector(tuple(pose[f"pole.{leg}"])).normalized()
            pd = (G[p] @ pd) if p else pd
            pole = pos[u] + (tgt - pos[u]) * 0.5 + pd * 0.5
            Rik = dict(R)
            A.two_bone_ik(rig, Rik, G, pos, u, l, f, tgt, pole, rot)
            for b in (u, l, f):
                qa = R.get(b, Matrix.Identity(3)).to_quaternion()
                R[b] = qa.slerp(Rik[b].to_quaternion(), min(w, 1.0)).to_matrix()
            G, pos = self.fk(R, off, moves)
        q = {b: rig.local_quat(b, R.get(b, Matrix.Identity(3))) for b in rig.order}
        loc = rig.B[rig.order[0]].inverted() @ off
        locs = {b: rig.B[b].inverted() @ m for b, m in moves.items()}
        scale = {k[6:]: float(np.asarray(v).ravel()[0]) for k, v in pose.items() if k.startswith("scale.")}
        return dict(q=q, loc=loc, locs=locs, G=G, pos=pos, R=R, scale=scale)


# ------------------------------------------------------------------ clips

class Clip(A.Clip):
    """Keys (anim.Clip's easing and lag) plus procedural layers and post passes.

    Channels: a bone -> Euler degrees about armature axes, relative to its
    parent; 'root' -> the root bone's offset; 'ik.<leg>' / 'rot.<leg>' /
    'pole.<leg>' / 'ikw.<leg>' -> the leg solve (see Body); 'scale.<bone>'.
    Layers are f(t, pose) run after the keys; posts are f(body, sols, clip)
    run over every solved frame (for simulation)."""

    def __init__(self, name, duration, loop=False):
        super().__init__(name, duration, loop, rig=None)
        self.post = []

    def kd(self, t, chans, ease="inout"):
        for k, v in chans.items():
            self.ch.setdefault(k, []).append((t, np.asarray(v, float), ease))
        return self

    def sample(self, t):
        pose = {k: self.value(k, t) for k in self.ch}
        for layer in self.layers:
            layer(t, pose)
        return pose


def add(pose, k, v):
    """Add to a channel (rotations add as Euler angles: fine for small layers)."""
    pose[k] = np.asarray(pose.get(k, (0.0, 0.0, 0.0)), float) + np.asarray(v, float)


def loop_noise(t, T, seed, n=3, lo=1, hi=4):
    """Smooth pseudo-random wobble in [-1, 1] that repeats every T seconds
    exactly (integer numbers of cycles per loop), for life in a loop."""
    rng = np.random.default_rng(seed)
    v = 0.0
    amp = 0.0
    for i in range(n):
        c = int(rng.integers(lo, hi + 1))
        ph = rng.uniform(0, 2 * math.pi)
        a = 1.0 / (1 + i)
        v += a * math.sin(2 * math.pi * c * t / T + ph)
        amp += a
    return v / amp


def pulse(t, t0, rise, hold, fall):
    """0 -> 1 -> 0 envelope: rises over `rise` from t0, holds, falls."""
    if t < t0 or t > t0 + rise + hold + fall:
        return 0.0
    if t < t0 + rise:
        return A.ease("inout", (t - t0) / rise)
    if t < t0 + rise + hold:
        return 1.0
    return 1.0 - A.ease("inout", (t - t0 - rise - hold) / fall)


def pendulum(bone, damping=1.5, loops=4, max_deg=None, substeps=8, gravity=9.81, gain=1.0):
    """Post pass: `bone` hangs from its head like a pendulum of its own length,
    driven by how its parent moves (a bell on a collar, a floppy ear).
    For a loop the simulation runs several times round so the last pass is
    the periodic steady state, then it is keyed. `max_deg` keeps it within a
    cone around its rest direction carried by the parent (a bell never swings
    into the neck). `gain` exaggerates the swing (a pendulum of 15 cm is
    stiff; a little more reads better at 250 m)."""
    def run(body, sols, clip):
        rig = body.rig
        par = rig.parent[bone]
        rest = (rig.tail[bone] - rig.head[bone])
        L = rest.length
        rest_dir = rest.normalized()
        n = len(sols)
        dt = 1.0 / FPS / substeps
        fade = math.exp(-damping * dt)
        g = Vector((0, 0, -gravity)) * dt * dt
        piv = [s["pos"][bone].copy() for s in sols]
        frames = list(range(n - 1)) if clip.loop else list(range(n - 1))
        cone = math.radians(max_deg) if max_deg else None

        def clamp(d, Gp):
            if cone is None:
                return d
            cur = (Gp @ rest_dir).normalized()
            a = cur.angle(d, 0.0)
            return cur.slerp(d, cone / a).normalized() if a > cone else d
        d0 = clamp(Vector((0, 0, -1)), sols[0]["G"][par])
        bob = piv[0] + d0 * L
        prev = bob.copy()
        dirs = [None] * n
        dirs[0] = d0
        for _ in range(loops if clip.loop else 1):
            for f in frames:
                f1 = (f + 1) % (n - 1) if clip.loop else f + 1
                for s in range(substeps):
                    pv = piv[f].lerp(piv[f1], (s + 1) / substeps)
                    v = (bob - prev) * fade
                    prev = bob
                    bob = bob + v + g
                    bob = pv + clamp((bob - pv).normalized(), sols[f1]["G"][par]) * L
                dirs[f1] = (bob - pv).normalized()
        if clip.loop:
            dirs[n - 1] = dirs[0]
        for s, d in zip(sols, dirs):
            Gp = s["G"][par]
            cur = Gp @ rest_dir
            if gain != 1.0:
                ax = cur.cross(d)
                if ax.length > 1e-6:
                    d = Quaternion(ax.normalized(), cur.angle(d, 0.0) * gain) @ cur
            Rw = A.rot_between(cur, d) @ Gp
            s["q"][bone] = rig.local_quat(bone, Gp.inverted() @ Rw)
    return run


def bake_clip(body, clip, arm_ob):
    """Sample a clip at 30 fps, run its post passes, key it into an action."""
    rig = body.rig
    n = int(round(clip.duration * FPS))
    # a loop whose length is not whole frames would not close (its last
    # frame would not be its first): refuse it rather than hitch every cycle
    assert not clip.loop or abs(clip.duration * FPS - n) < 1e-6, f"{clip.name}: {clip.duration} s is not whole frames"
    sols = [body.solve(clip.sample(f / FPS)) for f in range(n + 1)]
    for p in clip.post:
        p(body, sols, clip)
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    pbs = arm_ob.pose.bones
    root = rig.order[0]
    scaled = sorted(set().union(*[set(s["scale"]) for s in sols]))
    moved = sorted(set().union(*[set(s["locs"]) for s in sols]))
    for f, s in enumerate(sols):
        for b, qq in s["q"].items():
            pb = pbs[b]
            pb.rotation_quaternion = qq
            pb.keyframe_insert("rotation_quaternion", frame=f + 1, group=b)
        pbs[root].location = s["loc"]
        pbs[root].keyframe_insert("location", frame=f + 1, group=root)
        for b in moved:
            pbs[b].location = s["locs"].get(b, Vector())
            pbs[b].keyframe_insert("location", frame=f + 1, group=b)
        for b in scaled:
            v = s["scale"].get(b, 1.0)
            pbs[b].scale = (v, v, v)
            pbs[b].keyframe_insert("scale", frame=f + 1, group=b)
    A.fix_quat_continuity(act)
    for fc in A._fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    act.frame_range = (1, n + 1)
    return act


def stash(arm_ob, acts):
    """Park every action on its armature as an NLA strip: the exporter's
    ACTIONS mode then writes one glTF animation per action, bound to the
    armature that owns it (several animals share one file)."""
    ad = arm_ob.animation_data_create()
    ad.action = None
    for act in acts:
        tr = ad.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, int(act.frame_range[0]), act)
    for pb in arm_ob.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


# ------------------------------------------------------------------ meshes and the atlas

def sculpt_mesh(name, field, lo, hi, res, tris, symmetry=True, blur=1.0):
    """The sculpt polygonised (surface nets) and collapse-decimated to a game mesh."""
    V, Q = PG.mesh_sdf(field, lo, hi, res, blur=blur)
    ob = bl.mesh_from_arrays(name, V, Q)
    n0 = bl.tri_count(ob)
    bl.decimate(ob, tris, symmetry=symmetry)
    log(f"  {name}: {n0} -> {bl.tri_count(ob)} tris")
    return ob


def uv_islands(ob):
    """Face index -> island id (faces sharing a vertex with the same UV)."""
    me = ob.data
    uv = bl.get_uv(ob)
    lv = bl.loop_vertex_indices(me)
    nf = len(me.polygons)
    face_of_loop = np.empty(len(lv), np.int64)
    ls = np.empty(nf, np.int32)
    lt = np.empty(nf, np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    for i in range(nf):
        face_of_loop[ls[i]:ls[i] + lt[i]] = i
    key = np.stack([lv, np.round(uv[:, 0] * 2e5).astype(np.int64), np.round(uv[:, 1] * 2e5).astype(np.int64)], 1)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    parent = np.arange(nf)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    first = {}
    for li, g in enumerate(inv.ravel()):
        f = face_of_loop[li]
        if g in first:
            ra, rb = find(first[g]), find(f)
            if ra != rb:
                parent[ra] = rb
        else:
            first[g] = f
    return np.array([find(i) for i in range(nf)]), face_of_loop


def scale_islands(ob, density):
    """Give UV islands texel density by where they are: density(points) -> a
    linear scale per island (the eye, the beak, the bell get more texels)."""
    isl, fol = uv_islands(ob)
    me = ob.data
    uv = bl.get_uv(ob)
    C = np.array([p.center[:] for p in me.polygons], np.float64)
    A_ = np.array([p.area for p in me.polygons], np.float64)
    for g in np.unique(isl):
        fs = np.nonzero(isl == g)[0]
        c = (C[fs] * A_[fs, None]).sum(0) / max(A_[fs].sum(), 1e-12)
        s = float(np.asarray(density(c[None, :])).ravel()[0])
        loops = np.nonzero(np.isin(fol, fs))[0]
        m = uv[loops].mean(0)
        uv[loops] = (uv[loops] - m) * s + m
    bl.set_uv(ob, uv, me.uv_layers.active.name)


def _nearest_bary(u, P):
    """Barycentrics of the nearest point of 2D triangle u (3, 2) to each of P
    (n, 2), and the distance: inside, or on the nearest edge."""
    a, b, c = u
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    n = len(P)
    bestW = np.full((n, 3), 1 / 3.0)
    best = np.full(n, np.inf)
    if abs(d) > 1e-12:
        w0 = ((b[1] - c[1]) * (P[:, 0] - c[0]) + (c[0] - b[0]) * (P[:, 1] - c[1])) / d
        w1 = ((c[1] - a[1]) * (P[:, 0] - c[0]) + (a[0] - c[0]) * (P[:, 1] - c[1])) / d
        W = np.stack([w0, w1, 1 - w0 - w1], 1)
        inside = (W >= 0).all(1)
        bestW[inside] = W[inside]
        best[inside] = 0.0
    for i, j in ((0, 1), (1, 2), (2, 0)):
        p, q = u[i], u[j]
        e = q - p
        t = np.clip(((P - p) @ e) / max(e @ e, 1e-12), 0, 1)
        dd = np.linalg.norm(P - (p + t[:, None] * e), axis=1)
        m = dd < best
        best[m] = dd[m]
        Wm = np.zeros((m.sum(), 3))
        Wm[:, i] = 1 - t[m]
        Wm[:, j] = t[m]
        bestW[m] = Wm
    return bestW, best


def raster_border(ob, size, known, reach=1.5):
    """Texels charlib's raster leaves unbaked: it bakes a texel only if its
    centre falls inside a UV triangle, so a sliver island (smart UV project
    leaves plenty along seams on a decimated mesh) may own no texel at all
    and gets whatever dilation drags in from its neighbours in the atlas - a
    dotted seam on the model. Here every unknown texel within `reach` texels
    of a triangle is claimed by that triangle, at the triangle's nearest point
    (barycentrics clamped), with the same interpolated frame."""
    me = ob.data
    uvl = me.uv_layers.active
    me.calc_tangents(uvmap=uvl.name)
    me.calc_loop_triangles()
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get("vertex_index", lv)
    ln = np.empty(nl * 3, np.float32)
    me.loops.foreach_get("normal", ln)
    lt = np.empty(nl * 3, np.float32)
    me.loops.foreach_get("tangent", lt)
    ls = np.empty(nl, np.float32)
    me.loops.foreach_get("bitangent_sign", ls)
    uv = np.empty(nl * 2, np.float32)
    uvl.data.foreach_get("uv", uv)
    me.free_tangents()
    ln, lt, uv = ln.reshape(-1, 3), lt.reshape(-1, 3), uv.reshape(-1, 2)
    M = np.array(ob.matrix_world, np.float64)
    V = bl.verts_np(ob) @ M[:3, :3].T + M[:3, 3]
    ln, lt = ln @ M[:3, :3].T, lt @ M[:3, :3].T
    nt = len(me.loop_triangles)
    tl = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    tl = tl.reshape(-1, 3)
    claimed = known.copy()
    out = [], [], [], [], []
    for tri in tl:
        u = uv[tri].astype(np.float64) * size - 0.5
        x0, y0 = np.floor(u.min(0) - reach).astype(int)
        x1, y1 = np.ceil(u.max(0) + reach).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        sub = claimed[y0:y1 + 1, x0:x1 + 1]
        if sub.all():
            continue
        ys, xs = np.nonzero(~sub)
        Pp = np.stack([xs + x0, ys + y0], 1).astype(np.float64)
        W, dist = _nearest_bary(u, Pp)
        near = dist <= reach
        if not near.any():
            continue
        W, Pp = W[near], Pp[near].astype(np.int32)
        claimed[Pp[:, 1], Pp[:, 0]] = True
        out[0].append(Pp)
        out[1].append(W @ V[lv[tri]])
        out[2].append(W @ ln[tri])
        out[3].append(W @ lt[tri])
        out[4].append(W @ ls[tri])
    if not out[0]:
        return None
    pix, P, N, T, Sg = (np.concatenate(o) for o in out)
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
    T = T - (T * N).sum(1)[:, None] * N
    T /= np.maximum(np.linalg.norm(T, axis=1), 1e-9)[:, None]
    B = np.cross(N, T) * np.where(np.sign(Sg) == 0, 1, np.sign(Sg))[:, None]
    return pix, P.astype(np.float32), N.astype(np.float32), T.astype(np.float32), B.astype(np.float32)


def bake_job(at, ob, field, paint, relief=None, grad_eps=5e-4):
    """Atlas.bake, faster and sliver-proof: every texel of the mesh (charlib's
    raster plus raster_border's) is snapped onto the plain sculpt `field`; its
    normal is the gradient of the sculpt plus that of the fine relief.

    relief: (ctx(Q) -> per-texel data, h(P, data) -> displacement). The
    expensive part of a relief (which part a point is on: wool or hair) is
    computed once per texel by ctx; h is cheap and is what the finite
    differences sample. Charlib bakes displaced fields as one field, which
    costs every mask again in each of the ~40 samples a texel takes."""
    r0 = AB.raster(ob, at.size)
    pre = at.known.copy()
    y0, x0 = r0[0][:, 1], r0[0][:, 0]
    pre[y0, x0] = True
    r1 = raster_border(ob, at.size, pre)
    pix, P, N, T, B = r0 if r1 is None else [np.concatenate([a, b]) for a, b in zip(r0, r1)]
    Q = S.project_to_surface(field, P, iters=5, clamp=0.012)
    g = S.gradient(field, Q, grad_eps)
    g /= np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
    if relief is not None:
        ctx, h = relief
        data = ctx(Q)
        gr = np.empty_like(Q)
        for i in range(3):
            e = np.zeros(3, np.float32)
            e[i] = grad_eps
            gr[:, i] = (h(Q + e, data) - h(Q - e, data)) / (2 * grad_eps)
        g = g + gr
    n_hi = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
    bad = ~np.isfinite(n_hi).all(1) | ((n_hi * N).sum(1) < -0.2)
    n_hi[bad] = N[bad]
    ts = np.stack([(n_hi * T).sum(1), (n_hi * B).sum(1), (n_hi * N).sum(1)], 1)
    ts /= np.maximum(np.linalg.norm(ts, axis=1), 1e-9)[:, None]
    alb, rough, metal = paint(Q)
    y, x = pix[:, 1], pix[:, 0]
    at.albedo[y, x] = alb
    at.normal[y, x] = ts * 0.5 + 0.5
    at.orm[y, x, 0] = 1.0
    at.orm[y, x, 1] = rough
    at.orm[y, x, 2] = metal
    at.known[y, x] = True
    at.dbgQ[y, x] = Q
    at.dbgN[y, x] = n_hi
    return len(r0[0]), 0 if r1 is None else len(r1[0])


def bake_border(at, ob, field, paint, grad_eps=5e-4):
    """Bake the texels raster_border finds, exactly as Atlas.bake does its own."""
    r = raster_border(ob, at.size, at.known)
    if r is None:
        return 0
    pix, P, N, T, B = r
    Q = S.project_to_surface(field, P, iters=5, clamp=0.012)
    g = S.gradient(field, Q, grad_eps)
    n_hi = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
    bad = ~np.isfinite(n_hi).all(1) | ((n_hi * N).sum(1) < -0.2)
    n_hi[bad] = N[bad]
    ts = np.stack([(n_hi * T).sum(1), (n_hi * B).sum(1), (n_hi * N).sum(1)], 1)
    ts /= np.maximum(np.linalg.norm(ts, axis=1), 1e-9)[:, None]
    alb, rough, metal = paint(Q)
    y, x = pix[:, 1], pix[:, 0]
    at.albedo[y, x] = alb
    at.normal[y, x] = ts * 0.5 + 0.5
    at.orm[y, x, 0] = 1.0
    at.orm[y, x, 1] = rough
    at.orm[y, x, 2] = metal
    at.known[y, x] = True
    at.dbgQ[y, x] = Q
    at.dbgN[y, x] = n_hi
    return len(pix)


def uv_by_parts(ob, parts, angle=70):
    """Smart-project a mesh one anatomical part at a time.

    Smart UV project groups connected faces that face the same way into one
    island and projects it flat - so a cow's tail switch and the udder behind
    it, both facing backward and connected through the rump, land on the same
    texels (the switch came out spotted pink). Here every face is assigned to
    the part whose field is nearest (trunk, head, each ear, the tail, each
    leg...), each part is unwrapped on its own, scaled to its texel weight,
    and the parts are joined and welded back (only UV seams remain at the
    cuts). parts: [(name, field, weight)]."""
    import bmesh
    me = ob.data
    # a collapse-decimated mesh can carry bad corner/edge indices (Blender 5.1):
    # anything that builds a BMesh from it dies of SIGBUS unless it is rebuilt
    me.validate()
    C = np.array([p.center[:] for p in me.polygons], np.float32)
    D = np.stack([f(C) for _, f, _ in parts], 1)
    lab = np.argmin(D, 1)
    pieces = []
    for i, (pname, _, w) in enumerate(parts):
        keep = lab == i
        if not keep.any():
            continue
        # the piece is built from arrays, not by copying and deleting: a
        # clean mesh with only this part's faces
        V = bl.verts_np(ob)
        faces = [tuple(p.vertices) for p, k in zip(me.polygons, keep) if k]
        used = np.unique(np.concatenate([np.asarray(f) for f in faces]))
        remap = np.full(len(V), -1, np.int64)
        remap[used] = np.arange(len(used))
        o = bl.mesh_from_arrays(f"{ob.name}.{pname}", V[used], [tuple(remap[list(f)]) for f in faces])
        o.matrix_world = ob.matrix_world
        BK.smart_uv(o, angle)
        pieces.append((o, w))
    BK.normalise_density([o for o, _ in pieces], [w for _, w in pieces])
    name = ob.name
    bpy.data.objects.remove(ob)
    out = bl.join([o for o, _ in pieces], name)
    bm = bmesh.new()
    bm.from_mesh(out.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bm.to_mesh(out.data)
    bm.free()
    out.data.update()
    return out


def uv_overlaps(ob, size):
    """Texels covered by two triangles at once (a self-overlapping island):
    they get one sculpt point's paint for two places on the model."""
    me = ob.data
    uv = bl.get_uv(ob)
    me.calc_loop_triangles()
    hit = np.zeros((size, size), np.int16)
    tl = np.array([t.loops[:] for t in me.loop_triangles])
    for tri in tl:
        u = uv[tri].astype(np.float64) * size - 0.5
        x0, y0 = np.floor(u.min(0)).astype(int)
        x1, y1 = np.ceil(u.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        P = np.stack([xs.ravel(), ys.ravel()], 1).astype(float)
        a, b, c = u
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (P[:, 0] - c[0]) + (c[0] - b[0]) * (P[:, 1] - c[1])) / d
        w1 = ((c[1] - a[1]) * (P[:, 0] - c[0]) + (a[0] - c[0]) * (P[:, 1] - c[1])) / d
        m = (w0 > 0.01) & (w1 > 0.01) & (1 - w0 - w1 > 0.01)
        P = P[m].astype(int)
        hit[P[:, 1], P[:, 0]] += 1
    return int((hit > 1).sum())


def bake_atlas(jobs, size, name, ao_field, ao_scale=1.0, ao_strength=1.0, ground=True):
    """UV-unwrap and pack every job's mesh into one atlas and bake it
    analytically from the sculpts (albedo, tangent normals, ORM), then the
    occlusion at the animal's scale from `ao_field` (the whole animal).
    A job: dict(ob, field, paint, weight[, density, uv_angle, snap])."""
    t = time.time()
    for j in jobs:
        if j.get("parts"):
            j["ob"] = uv_by_parts(j["ob"], j["parts"], j.get("uv_angle", 70))
        else:
            BK.smart_uv(j["ob"], j.get("uv_angle", 70))
        if j.get("density"):
            scale_islands(j["ob"], j["density"])
    obs = [j["ob"] for j in jobs]
    BK.normalise_density(obs, [j.get("weight", 1.0) for j in jobs])
    BK.pack(obs, 0.003)
    over = sum(uv_overlaps(o, size) for o in obs)
    log(f"  {name}: uv packed in {time.time() - t:.1f}s" + (f"  WARNING {over} texels shared by two triangles" if over else ""))
    at = AB.Atlas(size)
    for j in jobs:
        t = time.time()
        n, m = bake_job(at, j["ob"], j["field"], j["paint"], j.get("relief"), j.get("grad_eps", 5e-4))
        log(f"  {name}: baked {j['ob'].name}: {n} texels + {m} on borders and slivers in {time.time() - t:.1f}s")
    t = time.time()
    big_ao(at, ao_field, ao_scale, ao_strength, ground)
    log(f"  {name}: occlusion in {time.time() - t:.1f}s")
    at.dilate()
    imgs = at.images(name)
    return imgs, at


def big_ao(at, field, scale=1.0, strength=1.0, ground=True):
    """Re-bake the atlas' occlusion at the animal's own scale. charlib's AO
    samples up to 6 cm along the normal - right for a hen or a face, blind to
    a cow's belly over its legs. Every baked texel kept its sculpt point and
    normal (Atlas.dbgQ/dbgN), so occlusion can be recomputed here with longer
    reach, the ground plane included (it darkens the belly and the hooves)."""
    dists = np.array([0.006, 0.015, 0.03, 0.055, 0.09, 0.14, 0.2]) * scale
    ys, xs = np.nonzero(at.known)
    P = at.dbgQ[ys, xs].astype(np.float32)
    N = at.dbgN[ys, xs].astype(np.float32)

    def f(X):
        d = field(X)
        if ground:
            d = np.minimum(d, X[:, 2] + 0.002)
        return d
    occ = np.zeros(len(P))
    w, tot = 1.0, 0.0
    for h in dists:
        d = f((P + N * h).astype(np.float32))
        occ += w * np.clip((h - d) / h, 0, 1)
        tot += w
        w *= 0.75
    at.orm[ys, xs, 0] = np.clip(1 - strength * occ / tot, 0, 1)
    return at


def skin_jobs(jobs, rig, names, proxy_field, lo, hi, res=0.008, override=None):
    """Bone heat on a closed proxy of the animal, transferred to every mesh
    that deforms; rigid parts (a bell, horns) are weighted to one bone."""
    proxy = SKN.make_proxy(proxy_field, lo, hi, res)
    missing = SKN.heat_weights(proxy, rig)
    if missing:
        log("  bone heat left out", missing)
    for j in jobs:
        sk = j.get("skin", "transfer")
        if sk == "transfer":
            SKN.transfer(proxy, [j["ob"]], rig, names=names, override=override)
        else:
            W = np.zeros((len(j["ob"].data.vertices), len(names)), np.float32)
            W[:, names.index(sk)] = 1.0
            SKN.apply_weights(j["ob"], W, rig, 1, names)
    bpy.data.objects.remove(proxy)


def finish_mesh(name, jobs, material):
    """One skinned mesh per animal: every part joined, one material."""
    obs = [j["ob"] for j in jobs]
    for o in obs:
        o.data.materials.clear()
        o.data.materials.append(material)
    base = bl.join(obs, name) if len(obs) > 1 else obs[0]
    base.name = name
    base.data.name = name
    return base


def material(name, imgs):
    return MT.final_material(name, imgs["albedo"], imgs["normal"], imgs["orm"], double_sided=False)


def save_atlas_previews(imgs, out_dir, name):
    """PNG copies of the atlas for review (the .glb carries WebP)."""
    os.makedirs(out_dir, exist_ok=True)
    for k, img in imgs.items():
        if k.startswith("_"):
            continue
        c = img.copy()
        c.filepath_raw = os.path.join(out_dir, f"{name}_{k}.png")
        c.file_format = "PNG"
        c.save()
        bpy.data.images.remove(c)
