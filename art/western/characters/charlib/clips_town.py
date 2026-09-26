"""The townsfolk: nobody here is a gunman. They look, they flinch, they
cower, they disapprove, they wave. In place, on the shared skeleton (the game
lends them the gang's hit reactions and falls too).

Armature axes: x = his/her left, y = backward, z = up; facing -y.
"""
import math
from .anim import Clip, hand_rot
from .clips_bandit import P, breathe, sway

FEET = {"ik.foot.L": (0.10, -0.015, 0.102), "rot.foot.L": (0, 0, 10), "pole.foot.L": (0.1, -1, 0),
        "ik.foot.R": (-0.10, 0.02, 0.102), "rot.foot.R": (0, 0, -10), "pole.foot.R": (-0.1, -1, 0)}

STAND = P(FEET, root=(0.015, 0.0, -0.01), hips=(0, -2, 3), spine=(1, 1, -2), chest=(0, 1, -2), neck=(3, 0, 2), head=(4, -1, 2),
          upper_arm__L=(-6, 38, 2), forearm__L=(-14, 0, 0), hand__L=(0, 6, 0),
          upper_arm__R=(-6, -38, -2), forearm__R=(-14, 0, 0), hand__R=(0, -6, 0))

PALM_FWD_R = hand_rot("R", (0.0, 0.0, 1.0), (1.0, 0.0, 0.0))
PALM_FWD_L = hand_rot("L", (0.0, 0.0, 1.0), (-1.0, 0.0, 0.0))

HANDS_UP = P(FEET, root=(0.0, 0.035, -0.025), hips=(-3, 0, 0), spine=(-5, 0, 0), chest=(-4, 0, 0), neck=(6, 0, 0), head=(8, 0, 0),
             shoulder__L=(0, -10, 0), shoulder__R=(0, 10, 0),
             ik__hand__L=(0.30, -0.05, 1.66), rot__hand__L=PALM_FWD_L, pole__hand__L=(0.6, 0.3, -0.5),
             ik__hand__R=(-0.30, -0.05, 1.66), rot__hand__R=PALM_FWD_R, pole__hand__R=(-0.6, 0.3, -0.5))


def idle():
    c = Clip("idle", 3.0, loop=True)
    c.pose(0.0, STAND)
    mid = dict(STAND)
    mid.update({"root": (0.005, 0.0, -0.014), "head": (2, 0, -8), "neck": (3, 0, -3), "hips": (0, 0, 1)})
    c.pose(1.5, mid, "inout")
    c.pose(3.0, STAND, "inout")
    c.layers += [breathe(1.0, 3.0), sway(0.7, 3.0, seed=1.0)]
    return c


def peek():
    """Craning to see what the noise is: leaning in, a hand shading the eyes
    against the low sun, the head searching one way then the other."""
    c = Clip("peek", 2.4, loop=True)
    shade = hand_rot("R", (1.0, -0.25, 0.05), (0.0, 1.0, 0.0))
    base = P(FEET, root=(0.0, -0.035, -0.02), hips=(4, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-6, 0, 0), head=(-4, 0, 0),
             shoulder__R=(0, 0, 6), ik__hand__R=(-0.04, -0.20, 1.73), rot__hand__R=shade, pole__hand__R=(-0.7, 0.2, -0.3),
             upper_arm__L=(-4, 36, 2), forearm__L=(-20, 0, 0), hand__L=(0, 6, 0))
    left = dict(base)
    left.update({"head": (-4, 0, 22), "neck": (-6, 0, 10), "chest": (6, 0, 4)})
    right = dict(base)
    right.update({"head": (-4, 0, -22), "neck": (-6, 0, -10), "chest": (6, 0, -4)})
    c.pose(0.0, left)
    c.pose(0.5, left, "inout")
    c.pose(1.2, right, "inout")
    c.pose(1.7, right, "inout")
    c.pose(2.4, left, "inout")
    c.layers += [breathe(0.8, 1.2)]
    return c


def hands_up():
    """A flinch, then both hands up, palms out - hold it."""
    c = Clip("hands_up", 0.6)
    c.pose(0.0, STAND)
    flinch = dict(STAND)
    flinch.update({"root": (0.0, 0.02, -0.05), "spine": (6, 0, 0), "chest": (6, 0, 0), "neck": (-10, 0, 0), "head": (-8, 0, 0),
                   "upper_arm.L": (-30, 30, 20), "forearm.L": (-70, 0, 0), "upper_arm.R": (-30, -30, -20), "forearm.R": (-70, 0, 0)})
    c.pose(0.08, flinch, "snap")
    over = dict(HANDS_UP)
    over.update({"ik.hand.L": (0.31, -0.05, 1.70), "ik.hand.R": (-0.31, -0.05, 1.70)})
    c.pose(0.36, over, "out")
    c.pose(0.6, HANDS_UP, "inout")
    c.lag.update({"head": 0.03})
    return c


def panic():
    """Cowering: knees bent, arms over the head, looking this way and that,
    jittering on the spot."""
    c = Clip("panic", 1.0, loop=True)
    feet = {"ik.foot.L": (0.13, -0.02, 0.102), "rot.foot.L": (0, 0, 14), "pole.foot.L": (0.4, -1, 0),
            "ik.foot.R": (-0.12, 0.04, 0.102), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.4, -1, 0)}
    cover = hand_rot("R", (0.7, 0.3, 0.3), (0.0, -0.3, 1.0))
    cover_l = hand_rot("L", (-0.7, 0.3, 0.3), (0.0, -0.3, 1.0))
    base = P(feet, root=(0.0, 0.05, -0.20), hips=(18, 0, 0), spine=(18, 0, 0), chest=(14, 0, 0), neck=(6, 0, 0), head=(6, 0, 0),
             ik__hand__L=(0.10, -0.05, 1.62), rot__hand__L=cover_l, pole__hand__L=(0.8, -0.3, 0.2),
             ik__hand__R=(-0.10, -0.05, 1.62), rot__hand__R=cover, pole__hand__R=(-0.8, -0.3, 0.2))
    a = dict(base)
    a.update({"head": (2, 0, 24), "neck": (4, 0, 10), "root": (0.015, 0.05, -0.21)})
    b = dict(base)
    b.update({"head": (2, 0, -24), "neck": (4, 0, -10), "root": (-0.015, 0.05, -0.19)})
    c.pose(0.0, a)
    c.pose(0.18, a, "inout")
    c.pose(0.5, b, "inout")
    c.pose(0.68, b, "inout")
    c.pose(1.0, a, "inout")
    c.layers += [breathe(2.2, 0.5)]
    return c


def head_shake():
    """The preacher's verdict: hands folded at his waist, a slow, heavy shake
    of the head, a pause, again."""
    c = Clip("head_shake", 2.0, loop=True)
    fold_r = hand_rot("R", (0.8, -0.4, -0.3), (0.0, -0.5, 0.8))
    fold_l = hand_rot("L", (-0.8, -0.4, -0.3), (0.0, -0.5, 0.8))
    base = P(FEET, root=(0.0, 0.01, -0.012), hips=(0, 0, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), neck=(8, 0, 0), head=(10, 0, 0),
             ik__hand__L=(0.03, -0.16, 1.04), rot__hand__L=fold_l, pole__hand__L=(0.5, 0.5, -0.4),
             ik__hand__R=(-0.03, -0.17, 1.05), rot__hand__R=fold_r, pole__hand__R=(-0.5, 0.5, -0.4))
    c.pose(0.0, base)
    for t, z in ((0.25, 16), (0.55, -16), (0.85, 12), (1.1, -8), (1.3, 0)):
        p = dict(base)
        p.update({"head": (12, 2 * math.copysign(1, z) if z else 0, z), "neck": (9, 0, z * 0.4)})
        c.pose(t, p, "inout")
    c.pose(2.0, base, "inout")
    c.layers += [breathe(0.8, 2.0)]
    return c


def wave():
    """A friendly wave, the arm up and the hand swinging from the elbow."""
    c = Clip("wave", 1.2, loop=True)
    base = P(FEET, root=(0.012, 0.0, -0.012), hips=(0, -2, 0), spine=(0, -3, 0), chest=(0, -3, 0), neck=(2, 0, 0), head=(4, 4, 0),
             shoulder__R=(0, 12, 0), ik__hand__R=(-0.36, -0.12, 1.78), rot__hand__R=PALM_FWD_R, pole__hand__R=(-0.8, 0.3, -0.4),
             upper_arm__L=(-4, 36, 2), forearm__L=(-16, 0, 0), hand__L=(0, 6, 0))
    a = dict(base)
    a.update({"ik.hand.R": (-0.44, -0.12, 1.74), "rot.hand.R": hand_rot("R", (-0.4, 0.0, 0.9), (0.9, 0.0, 0.4))})
    b = dict(base)
    b.update({"ik.hand.R": (-0.26, -0.12, 1.77), "rot.hand.R": hand_rot("R", (0.35, 0.0, 0.93), (0.93, 0.0, -0.35))})
    c.pose(0.0, a)
    c.pose(0.3, b, "inout")
    c.pose(0.6, a, "inout")
    c.pose(0.9, b, "inout")
    c.pose(1.2, a, "inout")
    return c


CLIPS = {"idle": idle, "peek": peek, "hands_up": hands_up, "panic": panic, "head_shake": head_shake, "wave": wave}
