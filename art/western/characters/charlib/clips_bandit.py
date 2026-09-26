"""The Carver gang's clips: how a gunman hides, shows himself, shoots and dies.

Everything is in place (the feet never leave the character's origin area
unless the clip is a run or a fall) and every emerge clip ends exactly on the
AIM pose, every hide clip starts on it, so the game can chain
  hidden -> rise / lean_*_out / step_out -> aim -> fire -> sink / lean_*_in / step_in
with short crossfades and nothing pops.

Armature axes: x = his left, y = backward, z = up; he faces -y.
"""
import math
from .anim import Clip, hand_rot

# ------------------------------------------------------------------ key poses

AIM_ROT = hand_rot("R", (0.0, -1.0, 0.0), (0.0, 0.0, 1.0))           # gun level, straight ahead
UP_ROT = hand_rot("R", (0.05, -0.25, 1.0), (0.0, 1.0, 0.0))          # muzzle up by the shoulder
LOW_ROT = hand_rot("R", (0.0, -0.55, -0.85), (0.0, -0.8, 0.5))        # muzzle down, ahead of the boot

STANCE = {
    "ik.foot.L": (0.125, -0.075, 0.102), "rot.foot.L": (0, 0, 16), "pole.foot.L": (0.25, -1, 0),
    "ik.foot.R": (-0.130, 0.085, 0.102), "rot.foot.R": (0, 0, 30), "pole.foot.R": (-0.05, -1, 0),
}


def P(*dicts, **kw):
    out = {}
    for d in dicts:
        out.update(d)
    for k, v in kw.items():
        out[k.replace("__", ".")] = v
    return out


# the fighting stance: bladed a third of a turn, arm out, eye down the barrel
AIM = P(STANCE, root=(0.0, 0.012, -0.032), hips=(0, 0, 18), spine=(2, 0, 5), chest=(-3, -2, 10),
        neck=(0, 0, -13), head=(7, 3, -15),
        shoulder__R=(0, 0, -4), ik__hand__R=(-0.055, -0.60, 1.425), rot__hand__R=AIM_ROT, pole__hand__R=(-0.6, 0.4, -0.7),
        shoulder__L=(0, 0, 0), upper_arm__L=(6, 36, 6), forearm__L=(-22, 0, 0), hand__L=(0, 8, 0))

# relaxed: weight on the left leg, revolver hanging in the right hand
IDLE = P({"ik.foot.L": (0.105, -0.02, 0.102), "rot.foot.L": (0, 0, 9), "pole.foot.L": (0.1, -1, 0),
          "ik.foot.R": (-0.115, 0.035, 0.102), "rot.foot.R": (0, 0, -9), "pole.foot.R": (-0.1, -1, 0)},
         root=(0.022, 0.004, -0.012), hips=(0, -3, 4), spine=(1, 2, -3), chest=(-1, 1, -3), neck=(2, 0, 3), head=(4, -1, 3),
         shoulder__R=(0, 0, 0), upper_arm__R=(-8, -37, 0), forearm__R=(-24, 0, 0), hand__R=(-10, 0, 0),
         shoulder__L=(0, 0, 0), upper_arm__L=(-4, 35, 2), forearm__L=(-18, 0, 0), hand__L=(0, 6, 0))

# crouched behind cover, gun up by the shoulder, looking up at the lip of it
CROUCH = P({"ik.foot.L": (0.165, -0.03, 0.102), "rot.foot.L": (0, 0, 14), "pole.foot.L": (0.45, -1, 0),
            "ik.foot.R": (-0.140, 0.07, 0.102), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.45, -1, 0)},
           root=(0.0, 0.09, -0.43), hips=(22, 0, 0), spine=(18, 0, 0), chest=(12, 0, 2), neck=(-22, 0, 0), head=(-10, 0, 0),
           shoulder__R=(0, 0, 8), ikc__hand__R=(-0.13, -0.17, 1.30), rotc__hand__R=UP_ROT, pole__hand__R=(-0.4, 0.5, -0.8),
           ik__hand__L=(0.17, -0.24, 0.56), rot__hand__L=(-40, 0, 10), pole__hand__L=(0.5, 0.3, -0.5))

# half-hidden behind a corner on his right: torso and head displaced to his
# right, gun up and ready - the start of lean_left_out
LEAN_HIDE_L = P(STANCE, root=(-0.15, 0.02, -0.05), hips=(0, -6, 12), spine=(4, -14, 4), chest=(2, -12, 6),
                neck=(0, 10, -6), head=(4, 10, -8),
                shoulder__R=(0, 0, 4), ikc__hand__R=(-0.12, -0.16, 1.33), rotc__hand__R=UP_ROT, pole__hand__R=(-0.5, 0.5, -0.7),
                upper_arm__L=(10, 30, 0), forearm__L=(-40, 0, 0), hand__L=(0, 6, 0))


ARM_KEYS = ("shoulder", "upper_arm", "forearm", "hand.", "ik.hand", "ikc.hand", "rot.hand", "rotc.hand", "pole.hand")


def mirror_pose(p, arms=False):
    """Mirror a pose left <-> right (for lean_right_* from lean_left_*). The gun
    stays in his right hand, so by default the arms are left as they are - the
    right hand's target is chest-relative and follows the mirrored torso."""
    out = {}
    for k, v in p.items():
        is_arm = any(k.startswith(a) for a in ARM_KEYS)
        if is_arm and not arms:
            out[k] = v
            continue
        k2 = k.replace(".L", ".TMP").replace(".R", ".L").replace(".TMP", ".R")
        v = list(v)
        if k.startswith("ik") or k == "root" or k.startswith("pole"):
            v[0] = -v[0]
        else:
            # rotations: mirror across the x = 0 plane -> negate y and z angles
            v = [v[0], -v[1], -v[2]]
        out[k2] = tuple(v)
    return out


# ------------------------------------------------------------------ layers

def breathe(amp=1.0, period=None):
    def layer(t, pose, amp=amp, period=period):
        per = period or 3.0
        s = math.sin(2 * math.pi * t / per)
        for b, a in (("chest", 1.3), ("spine", 0.4), ("neck", -0.8)):
            if b in pose:
                x, y, z = pose[b]
                pose[b] = (x - a * amp * s, y, z)
        if "root" in pose:
            x, y, z = pose["root"]
            pose["root"] = (x, y, z + 0.0025 * amp * s)
    return layer


def sway(amp=1.0, period=3.0, seed=0.0):
    """Slow weight drift and a searching head (loops: period divides the clip)."""
    def layer(t, pose):
        a = 2 * math.pi * t / period
        if "root" in pose:
            x, y, z = pose["root"]
            pose["root"] = (x + 0.006 * amp * math.sin(a + seed), y + 0.004 * amp * math.sin(2 * a + 1 + seed), z)
        if "head" in pose:
            x, y, z = pose["head"]
            pose["head"] = (x + 1.5 * amp * math.sin(2 * a + 2 + seed), y, z + 4.0 * amp * math.sin(a + 0.7 + seed))
    return layer


def aim_wobble(amp=1.0, period=1.0):
    """The tiny hunt of a gun held at arm's length."""
    def layer(t, pose):
        a = 2 * math.pi * t / period
        if "ikc.hand.R" in pose:
            x, y, z = pose["ikc.hand.R"]
            pose["ikc.hand.R"] = (x + 0.004 * amp * math.sin(a + 0.3), y, z + 0.005 * amp * math.sin(2 * a))
    return layer


# ------------------------------------------------------------------ clips

def idle():
    c = Clip("idle", 3.0, loop=True)
    c.pose(0.0, IDLE)
    # a small weight transfer and a glance down the street, back to the start
    mid = dict(IDLE)
    mid.update({"root": (0.012, 0.0, -0.016), "hips": (0, -1, 2), "head": (2, 0, -6), "neck": (2, 0, -3)})
    c.pose(1.5, mid, "inout")
    c.pose(3.0, IDLE, "inout")
    c.layers += [breathe(1.0, 3.0), sway(0.8, 3.0)]
    return c


def aim():
    c = Clip("aim", 1.0, loop=True)
    c.pose(0.0, AIM)
    c.pose(1.0, AIM)
    c.layers += [breathe(0.6, 1.0), aim_wobble(1.0, 1.0)]
    return c


def fire():
    """Recoil: the muzzle kicks up and back through the wrist and elbow, the
    shoulders take it, the head blinks; then the arm settles back on target."""
    c = Clip("fire", 0.36)
    kick = dict(AIM)
    kick.update({"ik.hand.R": (-0.05, -0.545, 1.475), "rot.hand.R": hand_rot("R", (0, -0.78, 0.62), (0, 0.62, 0.78)),
                 "chest": (-6, -2, 12), "head": (2, 3, -15), "root": (0.0, 0.02, -0.03), "shoulder.R": (0, 0, -1)})
    c.pose(0.0, AIM)
    c.pose(0.04, kick, "snap")
    over = dict(AIM)
    over.update({"ik.hand.R": (-0.056, -0.605, 1.418), "chest": (-2, -2, 9.5)})
    c.pose(0.20, over, "inout")
    c.pose(0.36, AIM, "inout")
    return c


def hidden():
    c = Clip("hidden", 2.0, loop=True)
    c.pose(0.0, CROUCH)
    look = dict(CROUCH)
    look.update({"head": (-14, 4, 10), "neck": (-22, 0, 6)})
    c.pose(0.9, look, "inout")
    c.pose(2.0, CROUCH, "inout")
    c.layers += [breathe(1.8, 1.0)]    # breathing hard: two breaths a loop
    return c


def rise():
    """Up from behind a barrel: a push through the legs, the gun comes up
    last, overshoots a hair and settles on target."""
    c = Clip("rise", 0.40)
    c.pose(0.0, CROUCH)
    dip = dict(CROUCH)
    dip.update({"root": (0.0, 0.095, -0.45), "spine": (21, 0, 0)})
    c.pose(0.05, dip, "inout")
    mid = dict(AIM)
    mid.update({"root": (0.0, 0.03, -0.09), "spine": (8, 0, 4), "chest": (2, -2, 8), "head": (0, 3, -12)})
    c.pose(0.22, mid, "out")
    top = dict(AIM)
    top.update({"root": (0.0, 0.010, -0.022)})
    c.pose(0.31, top, "inout")
    c.pose(0.40, AIM, "inout")
    c.lag.update({"ikc.hand.R": 0.03, "rotc.hand.R": 0.03, "head": 0.02})
    return c


def sink():
    c = Clip("sink", 0.34)
    c.pose(0.0, AIM)
    drop = dict(CROUCH)
    drop.update({"root": (0.0, 0.085, -0.46)})
    c.pose(0.24, drop, "in2")
    c.pose(0.34, CROUCH, "out")
    c.lag.update({"head": -0.02})
    return c


def lean_out(side="L"):
    """From behind a corner, lean out toward his `side` into the aim."""
    hide = LEAN_HIDE_L if side == "L" else mirror_pose(LEAN_HIDE_L)
    name = f"lean_{'left' if side == 'L' else 'right'}_out"
    c = Clip(name, 0.34)
    c.pose(0.0, hide)
    ant = dict(hide)
    r = ant["root"]
    ant["root"] = (r[0] * 1.08, r[1], r[2] - 0.008)
    c.pose(0.05, ant, "inout")
    past = dict(AIM)
    sgn = 1 if side == "L" else -1
    past.update({"root": (0.012 * sgn, 0.012, -0.035), "spine": (2, 3 * sgn, 5), "chest": (-3, 1 * sgn, 10)})
    c.pose(0.22, past, "out")
    c.pose(0.34, AIM, "inout")
    c.lag.update({"ikc.hand.R": 0.035, "rotc.hand.R": 0.035, "head": 0.02})
    return c


def lean_in(side="L"):
    hide = LEAN_HIDE_L if side == "L" else mirror_pose(LEAN_HIDE_L)
    c = Clip(f"lean_{'left' if side == 'L' else 'right'}_in", 0.30)
    c.pose(0.0, AIM)
    c.pose(0.22, hide, "inout")
    settle = dict(hide)
    r = settle["root"]
    settle["root"] = (r[0] * 1.04, r[1], r[2])
    c.pose(0.30, hide, "out")
    c.lag.update({"head": -0.02})
    return c
