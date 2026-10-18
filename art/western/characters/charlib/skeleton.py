"""The one humanoid skeleton every person in Dust Creek is built on.

Blender space: Z up, metres, the character faces -Y (glTF +Z after export) and
his left side is +X. Feet (boot soles) sit on z = 0. The rest pose is an
A-pose (arms 45 degrees down, elbows a little bent): it deforms better than a
T-pose for a figure that spends its life with arms down or aiming forward.

Proportions: a 1.765 m man in boots with 3.5 cm heels (1.80 m to the crown),
from standard anthropometric ratios (acromion 0.818 H, eyes 0.936 H, wrist
~0.49 H...). Bandits, the boss and the townsfolk all share it, so one clip
library drives everyone; builds differ in the meshes, not the joints.
"""
import numpy as np

# bone name, parent, and whether it deforms (socket.gun is an empty, not a bone)
BONES = [
    ("hips", None),
    ("spine", "hips"),
    ("chest", "spine"),
    ("neck", "chest"),
    ("head", "neck"),
    ("shoulder.L", "chest"), ("upper_arm.L", "shoulder.L"), ("forearm.L", "upper_arm.L"), ("hand.L", "forearm.L"),
    ("shoulder.R", "chest"), ("upper_arm.R", "shoulder.R"), ("forearm.R", "upper_arm.R"), ("hand.R", "forearm.R"),
    ("thigh.L", "hips"), ("shin.L", "thigh.L"), ("foot.L", "shin.L"),
    ("thigh.R", "hips"), ("shin.R", "thigh.R"), ("foot.R", "shin.R"),
]
BONE_NAMES = [b for b, _ in BONES]


def _n(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def joints():
    """Head/tail points of every bone (left side; the right is mirrored)."""
    J = {}
    J["hips"] = ((0, 0.004, 0.975), (0, 0.006, 1.085))
    J["spine"] = ((0, 0.006, 1.085), (0, 0.016, 1.255))
    J["chest"] = ((0, 0.016, 1.255), (0, 0.028, 1.505))
    J["neck"] = ((0, 0.028, 1.505), (0, 0.012, 1.635))
    J["head"] = ((0, 0.012, 1.635), (0, 0.012, 1.800))
    sh = np.array([0.178, 0.020, 1.445])            # glenohumeral joint
    J["shoulder.L"] = ((0.022, -0.012, 1.452), (0.160, 0.018, 1.458))
    d1 = _n([0.70, -0.10, -0.70])                    # A-pose: 45 degrees down, a little forward
    el = sh + 0.305 * d1
    d2 = _n([0.62, -0.30, -0.72])                    # relaxed elbow: forearm drifts forward
    wr = el + 0.265 * d2
    d3 = _n([0.60, -0.26, -0.75])
    J["upper_arm.L"] = (tuple(sh), tuple(el))
    J["forearm.L"] = (tuple(el), tuple(wr))
    J["hand.L"] = (tuple(wr), tuple(wr + 0.095 * d3))
    J["thigh.L"] = ((0.093, 0.004, 0.940), (0.099, -0.012, 0.515))
    J["shin.L"] = ((0.099, -0.012, 0.515), (0.103, 0.024, 0.102))
    J["foot.L"] = ((0.103, 0.024, 0.102), (0.108, -0.103, 0.022))
    out = {}
    for k, (h, t) in J.items():
        out[k] = (np.array(h, float), np.array(t, float))
        if k.endswith(".L"):
            m = np.array([-1, 1, 1], float)
            out[k[:-2] + ".R"] = (out[k][0] * m, out[k][1] * m)
    return out


JOINTS = joints()

# The axis each bone's local Z is aligned to at rest. "Forward" (-Y) everywhere
# makes local X the natural hinge for spine pitch, knees and elbows.
ROLL_ALIGN = {name: (0, -1, 0) for name in BONE_NAMES}
for s in ("L", "R"):
    ROLL_ALIGN[f"foot.{s}"] = (0, 0, 1)


def bone_frame(name):
    """Rest orientation (3x3, columns = local X, Y, Z in armature space)."""
    h, t = JOINTS[name]
    y = _n(t - h)
    z = np.asarray(ROLL_ALIGN[name], float)
    z = _n(z - (z @ y) * y)
    x = np.cross(y, z)
    return np.stack([x, y, z], 1)


def hand_frame(side="R"):
    """Canonical frame for modelling a hand: origin at the wrist, +Y toward the
    knuckles, +Z toward the thumb (radial side), +X = Y x Z (dorsal for the right hand)."""
    h, t = JOINTS[f"hand.{side}"]
    y = _n(t - h)
    z = np.array([0, -1.0, 0.0])                     # thumbs point forward in the A-pose
    z = _n(z - (z @ y) * y)
    # roll the hand so the palm faces the thigh a little more than straight in
    x = np.cross(y, z)
    return h, np.stack([x, y, z], 1)


def create_armature(name="rig", coll=None):
    import bpy
    from mathutils import Vector
    arm = bpy.data.armatures.new(name)
    arm.display_type = "STICK"
    ob = bpy.data.objects.new(name, arm)
    (coll or bpy.context.scene.collection).objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for bname, parent in BONES:
        h, t = JOINTS[bname]
        b = arm.edit_bones.new(bname)
        b.head = Vector(h)
        b.tail = Vector(t)
        b.align_roll(Vector(ROLL_ALIGN[bname]))
        if parent:
            b.parent = eb[parent]
            b.use_connect = bool(np.allclose(JOINTS[parent][1], h))
        b.use_deform = True
        eb[bname] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


def add_socket(rig, coll=None):
    """socket.gun: an empty on hand.R at the centre of the grip; +Y (Blender) is
    the barrel, +Z the top of the gun (glTF: barrel along -Z... see README)."""
    import bpy
    from mathutils import Matrix
    from . import hands
    M = hands.grip_socket_matrix()
    e = bpy.data.objects.new("socket.gun", None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.08
    (coll or bpy.context.scene.collection).objects.link(e)
    e.parent = rig
    e.parent_type = "BONE"
    e.parent_bone = "hand.R"
    e.matrix_world = Matrix(M.tolist())
    return e
