"""Animation core: pose math, IK and keyframed clips with weight and timing.

Poses are authored the way an animator thinks, not in bone-local quaternions:

- Rotations are Euler degrees about the *armature's* axes (x = the character's
  left, y = backward, z = up), applied at the bone and inherited by its
  children. So `spine=(20, 0, 0)` bends the spine forward 20 degrees whatever
  the bone's roll, and `chest` then bends further from there.
- Arms and legs can instead be given IK targets: a wrist or ankle position
  (armature space) with a pole for the elbow/knee and, optionally, a hand/foot
  orientation. Planted feet stay planted while the hips move - no skating.
- A clip is a set of keys; each channel is interpolated with the easing of
  the segment it is in (ease in/out, anticipation, overshoot), and channels
  can lag behind the torso (overlapping action: the head, the gun hand).
- Procedural layers (breathing, weight shift, micro sway) are added on top.

Sampled at 30 fps into ordinary Blender actions (bone quaternions + hips
location), so the export is plain glTF.
"""
import math
import numpy as np
from mathutils import Matrix, Vector, Euler
from .skeleton import BONES, JOINTS, bone_frame

FPS = 30


# ------------------------------------------------------------------ easing

def ease(kind, u):
    u = min(max(u, 0.0), 1.0)
    if kind == "linear":
        return u
    if kind == "in":
        return u * u * u
    if kind == "out":
        return 1 - (1 - u) ** 3
    if kind == "in2":
        return u * u
    if kind == "out2":
        return 1 - (1 - u) ** 2
    if kind == "inout":
        return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2
    if kind == "smooth":
        return u * u * (3 - 2 * u)
    if kind == "back":      # overshoot and settle
        c1, c3 = 1.70158, 2.70158
        return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2
    if kind == "backin":    # anticipation: dip before going
        c1, c3 = 1.70158, 2.70158
        return c3 * u ** 3 - c1 * u ** 2
    if kind == "snap":      # very fast start, long settle (recoil, hits)
        return 1 - (1 - u) ** 5
    if kind == "bounce":
        n1, d1 = 7.5625, 2.75
        if u < 1 / d1:
            return n1 * u * u
        if u < 2 / d1:
            u -= 1.5 / d1
            return n1 * u * u + 0.75
        if u < 2.5 / d1:
            u -= 2.25 / d1
            return n1 * u * u + 0.9375
        u -= 2.625 / d1
        return n1 * u * u + 0.984375
    raise ValueError(kind)


# ------------------------------------------------------------------ rig

class Rig:
    """Rest data of a skeleton (the shared humanoid by default, or any bone
    table - the chicken's), FK and IK in armature space."""

    def __init__(self, bones=None, joints=None, frames=None):
        bones = bones or BONES
        self.parent = {b: p for b, p in bones}
        if joints is None:
            self.head = {b: Vector(JOINTS[b][0]) for b, _ in bones}
            self.tail = {b: Vector(JOINTS[b][1]) for b, _ in bones}
            self.B = {b: Matrix(bone_frame(b).tolist()) for b, _ in bones}   # rest orientation (3x3)
        else:
            self.head = {b: Vector(joints[b][0]) for b, _ in bones}
            self.tail = {b: Vector(joints[b][1]) for b, _ in bones}
            self.B = {b: Matrix(frames[b].tolist()) for b, _ in bones}
        self.order = [b for b, _ in bones]

    def fk(self, R, hips_offset=Vector()):
        """R: bone -> 3x3 armature-axes rotation (relative to parent). Returns
        cumulative rotation G and world head positions."""
        G, pos = {}, {}
        for b in self.order:
            p = self.parent[b]
            r = R.get(b, Matrix.Identity(3))
            if p is None:
                G[b] = r
                pos[b] = self.head[b] + hips_offset
            else:
                G[b] = G[p] @ r
                pos[b] = pos[p] + G[p] @ (self.head[b] - self.head[p])
        return G, pos

    def local_quat(self, b, R):
        """Blender pose quaternion (bone-local) for an armature-axes rotation."""
        Bm = self.B[b]
        return (Bm.inverted() @ R @ Bm).to_quaternion()


def rot_between(a, b):
    a = a.normalized()
    b = b.normalized()
    return a.rotation_difference(b).to_matrix()


def frame_align(a0, n0, a1, n1):
    """Rotation mapping direction a0 -> a1 and (as close as possible) n0 -> n1."""
    def basis(a, n):
        x = a.normalized()
        z = (n - x * n.dot(x)).normalized()
        y = z.cross(x)
        return Matrix((x, y, z)).transposed()
    return basis(a1, n1) @ basis(a0, n0).inverted()


def two_bone_ik(rig, R, G, pos, upper, lower, end, target, pole, end_rot=None):
    """Set R[upper], R[lower] (and R[end] if end_rot, a world 3x3 orientation
    for the end bone) so that the end bone's head reaches target, bending
    toward pole."""
    p = rig.parent[upper]
    Gp = G[p] if p else Matrix.Identity(3)
    S = pos[upper]
    a = (rig.head[lower] - rig.head[upper]).length
    b = (rig.head[end] - rig.head[lower]).length
    T = Vector(target)
    d_vec = T - S
    d = min(max(d_vec.length, abs(a - b) + 1e-4), a + b - 1e-4)
    u = d_vec.normalized()
    pv = Vector(pole) - S
    v = (pv - u * pv.dot(u))
    if v.length < 1e-6:
        v = Vector((0, -1, 0)) - u * u.y
    v.normalize()
    cos_a = (a * a + d * d - b * b) / (2 * a * d)
    alpha = math.acos(max(-1.0, min(1.0, cos_a)))
    E = S + (u * math.cos(alpha) + v * math.sin(alpha)) * a
    Tn = S + u * d
    D1 = (E - S).normalized()
    D2 = (Tn - E).normalized()
    # rest directions (armature axes) and the rest bend plane
    r0 = (rig.head[lower] - rig.head[upper]).normalized()
    f0 = (rig.head[end] - rig.head[lower]).normalized()
    n0 = r0.cross(f0)
    if n0.length < 1e-6:
        n0 = r0.cross(Vector((0, -1, 0)))
    n0.normalize()
    Gi = Gp.inverted()
    d1 = Gi @ D1
    d2 = Gi @ D2
    n1 = d1.cross(d2)
    if n1.length < 1e-5:
        n1 = d1.cross(Gi @ v)
    n1.normalize()
    if n1.dot(n0) < 0 and d1.cross(d2).length < 1e-3:
        n1 = -n1
    Ru = frame_align(r0, n0, d1, n1)
    R[upper] = Ru
    # the lower bone only hinges within the aligned plane
    fl = (Ru.inverted() @ d2)
    R[lower] = rot_between(f0, fl)
    G2, pos2 = rig.fk(R, pos[rig.order[0]] - rig.head[rig.order[0]])
    if end_rot is not None:
        # end_rot is the end bone's world orientation relative to its rest one
        R[end] = G2[lower].inverted() @ Matrix(end_rot)
    return R


# ------------------------------------------------------------------ clips

def E(x=0.0, y=0.0, z=0.0):
    """Euler degrees about armature axes -> 3x3 (applied X, then Y, then Z)."""
    return Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_matrix()


class Clip:
    """Keyed channels. A channel is a bone name (Euler triple), 'root' (the
    hips' translation), or an IK channel: 'ik.hand.L', 'ik.foot.R' (position triple),
    'pole.hand.L', ... and 'rot.hand.R' / 'rot.foot.L' (Euler triple of the end
    bone's world orientation relative to rest). Keys: (time, value, ease)."""

    def __init__(self, name, duration, loop=False, rig=None):
        self.name, self.duration, self.loop = name, duration, loop
        self.rig = rig
        self.ch = {}
        self.lag = {}          # channel -> seconds of delay (overlapping action)
        self.layers = []       # callables (t, pose) -> None, added after sampling

    def key(self, t, ease_="inout", **channels):
        for k, v in channels.items():
            k = k.replace("__", ".")
            self.ch.setdefault(k, []).append((t, np.asarray(v, float), ease_))
        return self

    def pose(self, t, pose, ease_="inout", only=None):
        """Key a whole pose dict at time t (arms re-expressed in the chest frame)."""
        pose = chestify(self.rig or RIG, pose)
        for k, v in pose.items():
            if only and k not in only:
                continue
            self.ch.setdefault(k, []).append((t, np.asarray(v, float), ease_))
        return self

    def value(self, k, t):
        keys = sorted(self.ch[k], key=lambda x: x[0])
        lag = self.lag.get(k, 0.0)
        t = t - lag
        if self.loop:
            t = t % self.duration
        if t <= keys[0][0]:
            return keys[0][1]
        for (t0, v0, _), (t1, v1, e) in zip(keys[:-1], keys[1:]):
            if t <= t1:
                u = (t - t0) / max(t1 - t0, 1e-9)
                return v0 + (v1 - v0) * ease(e, u)
        return keys[-1][1]

    def sample(self, t):
        return {k: self.value(k, t) for k in self.ch}


def chestify(rig, pose):
    """Express a pose's arms in the chest's frame so they ride with the torso,
    and give every pose a wrist target and hand orientation even when its arm
    is posed by rotation (FK) - so any two poses can be interpolated, the arm
    blending from rotations to IK by the `ikw.hand.*` weight."""
    pose = dict(pose)
    if "chest" not in rig.parent:
        return pose
    R = {b: E(*pose[b]) for b in rig.order if b in pose}
    G, pos = rig.fk(R, Vector(pose.get("root", (0, 0, 0))))
    Gc, pc = G["chest"], pos["chest"]
    Gci = Gc.inverted()
    hc = rig.head["chest"]
    for side in ("L", "R"):
        wk, rk = f"ik.hand.{side}", f"rot.hand.{side}"
        if wk in pose:
            v = hc + Gci @ (Vector(pose.pop(wk)) - pc)
            pose[f"ikc.hand.{side}"] = tuple(v)
            if rk in pose:
                m = Gci @ E(*pose.pop(rk))
                pose[f"rotc.hand.{side}"] = tuple(math.degrees(a) for a in m.to_euler("XYZ"))
            pose[f"ikw.hand.{side}"] = (1.0, 0.0, 0.0)
        elif f"ikc.hand.{side}" in pose:
            pose[f"ikw.hand.{side}"] = (1.0, 0.0, 0.0)
        else:
            v = hc + Gci @ (pos[f"hand.{side}"] - pc)
            pose[f"ikc.hand.{side}"] = tuple(v)
            m = Gci @ G[f"hand.{side}"]
            pose[f"rotc.hand.{side}"] = tuple(math.degrees(a) for a in m.to_euler("XYZ"))
            pose[f"ikw.hand.{side}"] = (0.0, 0.0, 0.0)
        for b in (f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"):
            pose.setdefault(b, (0.0, 0.0, 0.0))
        pose.setdefault(f"pole.hand.{side}", (0.3 if side == "L" else -0.3, 0.3, -0.5))
    return pose


def solve(rig, pose):
    """Pose dict -> (bone -> local quaternion, hips location in bone space)."""
    R = {}
    for b in rig.order:
        if b in pose:
            x, y, z = pose[b]
            R[b] = E(x, y, z)
    off = Vector(pose.get("root", (0, 0, 0)))     # root bone translation (the body's centre of mass)
    G, pos = rig.fk(R, off)
    for side in ("L", "R"):
        if f"ik.foot.{side}" in pose:
            tgt = Vector(pose[f"ik.foot.{side}"])
            # the pole channel is a direction: where the knee points
            pole = pos[f"thigh.{side}"] + (tgt - pos[f"thigh.{side}"]) * 0.5 + Vector(pose.get(f"pole.foot.{side}", (0, -1, 0))) * 0.5
            if f"rot.foot.{side}" in pose:
                end_rot = E(*pose[f"rot.foot.{side}"])
            else:
                end_rot = Matrix.Identity(3)      # foot keeps its rest (flat) orientation
            w = float(pose.get(f"ikw.foot.{side}", (1.0,))[0])
            if w <= 1e-4:
                continue
            Rik = dict(R)
            two_bone_ik(rig, Rik, G, pos, f"thigh.{side}", f"shin.{side}", f"foot.{side}", tgt, pole, end_rot)
            for b in (f"thigh.{side}", f"shin.{side}", f"foot.{side}"):
                qa = R.get(b, Matrix.Identity(3)).to_quaternion()
                R[b] = qa.slerp(Rik[b].to_quaternion(), min(w, 1.0)).to_matrix()
            G, pos = rig.fk(R, off)
    for side in ("L", "R"):
        w = float(pose.get(f"ikw.hand.{side}", (0,))[0])
        if w <= 1e-4 or f"ikc.hand.{side}" not in pose:
            continue
        Gc, pc = G["chest"], pos["chest"]
        tgt = pc + Gc @ (Vector(pose[f"ikc.hand.{side}"]) - rig.head["chest"])
        pd = Gc @ Vector(pose.get(f"pole.hand.{side}", (0.3 if side == "L" else -0.3, 0.3, -0.5)))
        pole = pos[f"upper_arm.{side}"] + (tgt - pos[f"upper_arm.{side}"]) * 0.5 + pd * 0.5
        end_rot = Gc @ E(*pose[f"rotc.hand.{side}"]) if f"rotc.hand.{side}" in pose else None
        Rik = dict(R)
        two_bone_ik(rig, Rik, G, pos, f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}", tgt, pole, end_rot)
        for b in (f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"):
            qa = R.get(b, Matrix.Identity(3)).to_quaternion()
            qb = Rik[b].to_quaternion()
            R[b] = qa.slerp(qb, min(w, 1.0)).to_matrix()
        G, pos = rig.fk(R, off)
    q = {b: rig.local_quat(b, R.get(b, Matrix.Identity(3))) for b in rig.order}
    # the root's translation lives in its own rest frame
    loc = rig.B[rig.order[0]].inverted() @ off
    return q, loc, G, pos


def bake_clip(rig, clip, arm_ob, fps=FPS):
    """Sample a clip into a Blender action on the armature object."""
    import bpy
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    n = int(round(clip.duration * fps))
    frames = range(0, n + 1)
    arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    pbs = arm_ob.pose.bones
    for f in frames:
        t = f / fps
        pose = clip.sample(t)
        for layer in clip.layers:
            layer(t, pose)
        q, loc, G, pos = solve(rig, pose)
        for b, qq in q.items():
            pb = pbs[b]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = qq
            pb.keyframe_insert("rotation_quaternion", frame=f + 1, group=b)
        root = rig.order[0]
        pbs[root].location = loc
        pbs[root].keyframe_insert("location", frame=f + 1, group=root)
    fix_quat_continuity(act)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    act.frame_range = (1, n + 1)
    return act


def _fcurves(act):
    """F-curves of an action (Blender 5 keeps them in layered channelbags)."""
    if hasattr(act, "fcurves") and len(getattr(act, "fcurves", [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out


def fix_quat_continuity(act):
    """q and -q are the same rotation; pick the sign nearest the previous key."""
    curves = {}
    for fc in _fcurves(act):
        if fc.data_path.endswith("rotation_quaternion"):
            curves.setdefault(fc.data_path, {})[fc.array_index] = fc
    for path, cs in curves.items():
        if len(cs) != 4:
            continue
        n = len(cs[0].keyframe_points)
        Q = np.array([[cs[i].keyframe_points[k].co[1] for i in range(4)] for k in range(n)])
        for k in range(1, n):
            if np.dot(Q[k], Q[k - 1]) < 0:
                Q[k] = -Q[k]
        for i in range(4):
            for k in range(n):
                cs[i].keyframe_points[k].co[1] = Q[k, i]


def hand_rot(side, barrel=(0, -1, 0), up=(0, 0, 1)):
    """Euler (armature axes, degrees) that turns a hand so the gun it grips
    points along `barrel` with its top toward `up` (the hand's canonical frame:
    +Y along the fingers' knuckle direction = barrel, +Z = thumb = top)."""
    from .skeleton import hand_frame
    o, H = hand_frame("R")
    H = Matrix(H.tolist())
    if side == "L":
        S = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
        H = S @ H @ S      # the left hand frame, still a rotation
    y = Vector(barrel).normalized()
    z = Vector(up)
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    Hd = Matrix((x, y, z)).transposed()
    Rm = Hd @ H.inverted()
    e = Rm.to_euler("XYZ")
    return tuple(math.degrees(a) for a in e)


RIG = Rig()   # the shared skeleton, for chestify at authoring time
