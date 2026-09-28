"""The valley's people's clips: they stand, walk, cycle, wave, and when the
shooting starts they cower, duck, or run.

Everything in place (the game moves the root: WALK_SPEED, RUN_SPEED, and
bicycle.SPEED for `cycle`); 30 fps. The left hand holds a staff's grip
(fist closed round a vertical rod, palm to the thigh) in the standing clips:
that is where the shepherd's crook lives, and on everyone else it reads as a
relaxed hand.

The child plays the same clips scaled by his node's extras.scale (0.64):
multiply the speeds by it too.

Armature axes: x = his left, y = back, z = up; he faces -y.
"""
import math
import numpy as np
from charlib.anim import Clip, hand_rot
from charlib.clips_bandit import P, breathe, sway
from . import kin as K, gait as GT, bicycle as BK

WALK_SPEED = 1.25
RUN_SPEED = 3.2

FEET = {"ik.foot.L": (0.10, -0.015, 0.102), "rot.foot.L": (0, 0, 10), "pole.foot.L": (0.1, -1, 0),
        "ik.foot.R": (-0.10, 0.02, 0.102), "rot.foot.R": (0, 0, -10), "pole.foot.R": (-0.1, -1, 0)}
TORSO = P(FEET, root=(0.015, 0.0, -0.01), hips=(0, -2, 3), spine=(1, 1, -2), chest=(0, 1, -2), neck=(3, 0, 2), head=(4, -1, 2))
ARM_R = {"upper_arm.R": (-6, -38, -2), "forearm.R": (-16, 0, 0), "hand.R": (0, -6, 0), "ikw.hand.R": (0, 0, 0)}


POLE_L = (0.9, 0.7, -0.15)      # the staff arm's elbow out and back: less twist in the shoulder


def staff_hand(p=(0.244, -0.100, 0.930), tilt=0.0):
    """The left fist round a vertical staff at p (the rod through the fist,
    knuckles forward, palm to the thigh); `tilt` leans the rod forward (deg)."""
    a = math.radians(tilt)
    Z = np.array([0.0, -math.sin(a), math.cos(a)])
    Y = np.array([0.0, -math.cos(a), -math.sin(a)])
    return K.hand_for("L", K.T_of(np.stack([np.cross(Y, Z), Y, Z], 1), p))


STAND = P(TORSO, ARM_R, staff_hand(), {"pole.hand.L": POLE_L})
STAND_CARRY_L = K.chest_carry(STAND)


def idle():
    """Standing about: weight on the left leg, a slow breath, a look round.
    4 s loop."""
    c = Clip("idle", 4.0, loop=True)
    c.pose(0.0, STAND)
    look = dict(STAND)
    look.update({"head": (2, 0, -22), "neck": (3, 0, -9), "hips": (0, -1, 1), "root": (0.006, 0.0, -0.014)})
    c.pose(1.5, look, "inout")
    c.pose(2.6, look, "inout")
    c.pose(4.0, STAND, "inout")
    c.layers += [breathe(1.0, 4.0), sway(0.7, 4.0, seed=1.0)]
    return c


WALK_GAIT = GT.Gait(WALK_SPEED, 1.16, 0.61, -0.32, strike=-15, push=36, lift=0.08, x=0.095, toe_out=8)


def walk():
    """A country walk. In place: the root moves at WALK_SPEED (1.25 m/s);
    1.16 s a cycle of two steps. The right arm swings; the left hand keeps
    its staff (it swings less)."""
    from .clips_soldier import walk_body
    g = WALK_GAIT
    c = Clip("walk", g.T, loop=True)
    g.keys(c)
    walk_body(c, g, lean=3.0, bob=0.024, hip_yaw=6.0, chest_yaw=7.0)
    n = 12
    for i in range(n + 1):
        t = g.T * i / n
        a = 2 * math.pi * t / g.T
        sw = math.cos(a)                     # right arm forward when the left leg leads
        c.key(t, "linear", upper_arm__R=(-6 - 20 * sw, -36, -2), forearm__R=(-18 - 14 * max(sw, 0), 0, 0), hand__R=(0, -6, 0),
              ikw__hand__R=(0, 0, 0))
        ch = K.chest_carry(P(TORSO, staff_hand((0.244, -0.100 + 0.07 * sw, 0.935), tilt=-8 * sw), {"pole.hand.L": POLE_L}))
        c.key(t, "linear", **{k.replace(".", "__"): v for k, v in ch.items() if k.endswith(".L")})
    return c


RUN_GAIT = GT.Gait(RUN_SPEED, 0.70, 0.36, -0.25, strike=-6, push=40, lift=0.24, x=0.09, toe_out=6, roll=(0.08, 0.45), swing_peak=0.45)


def run():
    """Running away: arms pumping, head down. In place: the root moves at
    RUN_SPEED (3.2 m/s); 0.70 s a cycle."""
    g = RUN_GAIT
    c = Clip("run", g.T, loop=True)
    g.keys(c)
    T = g.T
    for i in range(25):
        t = T * i / 24
        ph = t / T
        z = -0.07 + 0.028 * math.cos(4 * math.pi * (ph - g.duty * 0.5))
        yaw = -9 * math.cos(2 * math.pi * ph)
        c.key(t, "linear", root=(0.01 * math.sin(2 * math.pi * ph + 1.6), -0.02, z), hips=(12, 0, yaw), spine=(10, 0, -yaw * 0.5),
              chest=(6, 0, -yaw * 0.6), neck=(-10, 0, yaw * 0.4), head=(-6, 0, yaw * 0.3))
        sw = math.cos(2 * math.pi * ph)
        c.key(t, "linear", upper_arm__R=(-8 - 40 * sw, -40, 0), forearm__R=(-75 + 10 * sw, 0, 0), hand__R=(0, 0, 0),
              upper_arm__L=(-8 + 40 * sw, 40, 0), forearm__L=(-75 - 10 * sw, 0, 0), hand__L=(0, 0, 0),
              ikw__hand__R=(0, 0, 0), ikw__hand__L=(0, 0, 0))
    return c


PALM_R = hand_rot("R", (0.0, 0.0, 1.0), (1.0, 0.0, 0.0))


def wave():
    """A big friendly wave, the right arm up, the hand swinging from the
    elbow; weight on one leg. 1.2 s loop."""
    c = Clip("wave", 1.2, loop=True)
    base = P(TORSO, staff_hand(), {"pole.hand.L": POLE_L}, root=(0.012, 0.0, -0.012), hips=(0, -2, 0), spine=(0, -3, 0),
             chest=(0, -3, 0), neck=(2, 0, 0), head=(4, 4, 0), shoulder__R=(0, 12, 0), pole__hand__R=(-0.8, 0.3, -0.4))
    a = dict(base)
    a.update({"ik.hand.R": (-0.44, -0.12, 1.76), "rot.hand.R": hand_rot("R", (-0.4, 0.0, 0.9), (0.9, 0.0, 0.4))})
    b = dict(base)
    b.update({"ik.hand.R": (-0.25, -0.12, 1.79), "rot.hand.R": hand_rot("R", (0.35, 0.0, 0.93), (0.93, 0.0, -0.35))})
    c.pose(0.0, a)
    c.pose(0.3, b, "inout")
    c.pose(0.6, a, "inout")
    c.pose(0.9, b, "inout")
    c.pose(1.2, a, "inout")
    c.layers += [breathe(0.9, 1.2)]
    return c


def hands_on_head(pose):
    """Both hands clamped over the back of the head, elbows forward round
    the face - wherever the torso has put the head."""
    from charlib import head as HD
    G, pos = K.torso_fk(pose)
    hr = K.rot(G, "head")
    ch = {}
    for side, sx in (("L", 1.0), ("R", -1.0)):
        p = K.at(G, pos, "head", HD.HEAD_ORIGIN + np.array([sx * 0.050, 0.055, 0.070]))
        knuckles = hr @ np.array([-sx * 0.55, 0.35, 0.45])
        back = hr @ np.array([sx * 0.35, 0.45, 0.8])
        ch.update(K.hand_at(side, p, knuckles, back))
        ch[f"pole.hand.{side}"] = (sx * 0.6, -0.8, -0.2)
    return ch


def cower(root, hips, spine, chest, neck, head, feet):
    pose = P(feet, root=root, hips=hips, spine=spine, chest=chest, neck=neck, head=head)
    pose.update(hands_on_head(pose))
    return pose


PANIC_FEET = {"ik.foot.L": (0.13, -0.02, 0.102), "rot.foot.L": (0, 0, 14), "pole.foot.L": (0.4, -1, 0),
              "ik.foot.R": (-0.12, 0.04, 0.102), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.4, -1, 0)}


def panic():
    """Shots in the valley: knees bent, hunched, hands clamped over the head,
    looking wildly this way and that, jittering on the spot. 1.0 s loop."""
    c = Clip("panic", 1.0, loop=True)
    a = cower((0.015, 0.04, -0.17), (10, 0, 4), (12, 0, 4), (10, 0, 6), (6, 0, 8), (4, 0, 14), PANIC_FEET)
    b = cower((-0.015, 0.04, -0.15), (10, 0, -4), (12, 0, -4), (10, 0, -6), (6, 0, -8), (4, 0, -14), PANIC_FEET)
    c.pose(0.0, a)
    c.pose(0.18, a, "inout")
    c.pose(0.5, b, "inout")
    c.pose(0.68, b, "inout")
    c.pose(1.0, a, "inout")
    c.layers += [breathe(2.2, 0.5)]
    return c


DUCK_FEET = {"ik.foot.L": (0.14, -0.10, 0.102), "rot.foot.L": (0, 0, 12), "pole.foot.L": (0.5, -1, 0.2),
             "ik.foot.R": (-0.14, 0.12, 0.15), "rot.foot.R": (45, 0, -12), "pole.foot.R": (-0.5, -1, -0.3)}
DUCKED = cower((0.0, 0.10, -0.53), (26, 0, 0), (18, 0, 0), (12, 0, 0), (12, 0, 0), (10, 0, 0), DUCK_FEET)


def duck():
    """A shot close by: a flinch, then down into a crouch with the arms
    over the head (held from 0.55 s). 0.8 s, holds its last frame."""
    c = Clip("duck", 0.8)
    c.pose(0.0, STAND)
    flinch = dict(STAND)
    flinch.update({"root": (0.0, 0.02, -0.06), "spine": (6, 0, 0), "chest": (8, 0, 0), "neck": (-10, 0, 0), "head": (-8, 0, 0),
                   "upper_arm.R": (-30, -30, -20), "forearm.R": (-70, 0, 0)})
    c.pose(0.08, flinch, "snap")
    over = cower((0.0, 0.10, -0.57), (28, 0, 0), (18, 0, 0), (12, 0, 0), (12, 0, 0), (10, 0, 0), DUCK_FEET)
    c.pose(0.45, over, "in2")
    c.pose(0.8, DUCKED, "out")
    c.lag.update({"head": 0.03})
    return c


def death():
    """If he is shot (he never should be): the knees go, he folds and falls
    on his face (the ground at 0.85 s). From `idle`; 1.3 s."""
    c = Clip("death", 1.3)
    c.pose(0.0, STAND)
    fold = P(FEET, ARM_R, {"ikw.hand.L": (0, 0, 0)}, root=(0.0, 0.05, -0.12), hips=(12, 0, 8), spine=(28, 0, 4), chest=(20, 0, 4),
             neck=(10, 0, 0), head=(12, 0, 0), upper_arm__L=(-30, 40, 0), forearm__L=(-60, 0, 0))
    c.pose(0.10, fold, "snap")
    kneel = P({"ik.foot.L": (0.13, 0.30, 0.09), "rot.foot.L": (75, 0, 10), "ik.foot.R": (-0.13, 0.34, 0.09), "rot.foot.R": (75, 0, -10),
               "pole.foot.L": (0.1, -1, -0.3), "pole.foot.R": (-0.1, -1, -0.3)}, {"ikw.hand.L": (0, 0, 0), "ikw.hand.R": (0, 0, 0)},
              root=(0.0, 0.04, -0.47), hips=(8, 0, 4), spine=(26, 0, 0), chest=(20, 0, 0), neck=(14, 0, 0), head=(16, 0, 0),
              upper_arm__L=(-20, 55, 0), forearm__L=(-30, 0, 0), upper_arm__R=(-20, -55, 0), forearm__R=(-30, 0, 0))
    c.pose(0.45, kneel, "in2")
    down = P({"ik.foot.L": (0.15, 0.46, 0.07), "rot.foot.L": (90, 0, 10), "ik.foot.R": (-0.15, 0.48, 0.07), "rot.foot.R": (90, 0, -10),
              "pole.foot.L": (0.1, 0.2, -1), "pole.foot.R": (-0.1, 0.2, -1)},
             root=(0.0, -0.36, -0.84), hips=(87, 0, 4), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-10, 0, 22), head=(-8, 0, 40))
    down.update(K.hand_at("L", (0.40, -0.55, 0.05), (0.5, -0.8, 0.0), (0.0, 0.0, 1.0)))
    down.update(K.hand_at("R", (-0.38, -0.60, 0.05), (-0.4, -0.9, 0.0), (0.0, 0.0, 1.0)))
    down.update({"pole.hand.L": (0.8, 0.0, 0.5), "pole.hand.R": (-0.8, 0.0, 0.5)})
    c.pose(0.85, down, "in")
    b = dict(down)
    b.update({"root": (0.0, -0.37, -0.80), "chest": (-6, 0, 0)})
    c.pose(0.93, b, "out")
    c.pose(1.3, down, "bounce")
    c.lag.update({"head": 0.04})
    return c


# ------------------------------------------------------------------ the bicycle

SEAT = (0.0, BK.SADDLE[1] - 0.02 - 0.004, BK.SADDLE[2] + 0.108 - 0.975)     # root: the pelvis on the saddle


def pedal_pitch(phi):
    """Ankling: the heel drops over the top, the toes point down behind."""
    return 12.0 - 11.0 * math.cos(math.radians(phi - 25.0))


def foot_on_pedal(side, phi):
    sp = BK.pedal_spindle(side, phi)
    ph = phi + (180.0 if side == "L" else 0.0)
    pitch = pedal_pitch(ph)
    sole = sp + np.array([0.0, 0.0, 0.016])
    ankle = sole + GT.rx(pitch, -GT.BALL)
    x = 0.118 if side == "L" else -0.118
    return (x, ankle[1], ankle[2]), pitch


def grip_hands():
    ch = {}
    for side, sx in (("L", 1.0), ("R", -1.0)):
        g = BK.GRIPS[side]
        knuckles = np.array([sx * 0.55, -0.15, -0.82])
        thumb = np.array([-sx * 0.30, -0.95, 0.05])
        ch.update(K.hand_for(side, K.T_of(K.frame(knuckles, thumb), g)))
    return ch


def cycle():
    """Riding the bicycle (show `bicycle`; the root is the bicycle's footprint
    centre): pedalling at 50 rpm, soles on the pedals through the whole
    turn, the heels dropping over the top, hands on the grips, the hips
    rocking with each stroke and the shoulders countering. The crank turns
    twice, the wheels five times. In place: the root moves at bicycle.SPEED
    (4.58 m/s). 2.4 s loop."""
    T = 2 * BK.CRANK_T
    c = Clip("cycle", T, loop=True)
    n = 48
    hands = grip_hands()
    for i in range(n + 1):
        t = T * i / n
        phi = 360.0 * t / BK.CRANK_T
        rock = math.sin(math.radians(phi))
        pose = P(root=(SEAT[0] + 0.006 * rock, SEAT[1], SEAT[2] + 0.004 * abs(math.cos(math.radians(phi)))),
                 hips=(20, 2.5 * rock, 0), spine=(8, -1.5 * rock, 0), chest=(4, -1.0 * rock, 1.5 * rock), neck=(-14, 0, -1.0 * rock),
                 head=(-10, 0, 0), pole__hand__L=(0.7, 0.3, -0.5), pole__hand__R=(-0.7, 0.3, -0.5))
        for side in ("L", "R"):
            a, pitch = foot_on_pedal(side, phi)
            pose[f"ik.foot.{side}"] = a
            pose[f"rot.foot.{side}"] = (pitch, 0.0, 0.0)
            pose[f"pole.foot.{side}"] = (0.12 if side == "L" else -0.12, -1.0, 0.35)
        pose.update(hands)
        c.pose(t, pose, "linear")
    c.layers += [breathe(0.8, 1.2)]
    c.bicycle = True
    return c


def bicycle_rotations(t):
    """World rotations (relative to rest) of the bicycle's bones at time t
    of `cycle`: the crank turning forward, the wheels GEAR times as fast,
    the pedals level with the soles."""
    phi = 360.0 * t / BK.CRANK_T

    def Rx(deg):
        a = math.radians(deg)
        c, s = math.cos(a), math.sin(a)
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    out = {"bicycle": np.eye(3), "bicycle.crank": Rx(phi), "bicycle.wheel.front": Rx(BK.GEAR * phi), "bicycle.wheel.rear": Rx(BK.GEAR * phi)}
    for side in ("L", "R"):
        ph = phi + (180.0 if side == "L" else 0.0)
        out[f"bicycle.pedal.{side}"] = Rx(pedal_pitch(ph))
    return out


CLIPS = {"idle": idle, "walk": walk, "run": run, "cycle": cycle, "wave": wave, "panic": panic, "duck": duck, "death": death}
