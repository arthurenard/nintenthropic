"""The soldiers' clips: how a sentry idles and smokes, a patrol walks the
road, a rifleman aims and fires standing and prone, takes a wound, dies, jumps
out of a truck and drives one.

Everything is in place: the origin never moves; walks and runs move the feet
back at their speed (the game moves the root at WALK_SPEED, PATROL_SPEED,
RUN_SPEED m/s). 30 fps. The rifle is gun.rifle in socket.gun (right fist)
unless the clip's notes say otherwise, and the left hand is placed on the
rifle's forend by kin.py, so it never floats off the gun.

Armature axes: x = his left, y = back, z = up; he faces -y.
"""
import math
import numpy as np
from charlib.anim import Clip, hand_rot
from charlib.clips_bandit import P, breathe, sway
from . import kin as K, gait as GT

WALK_SPEED = 1.30
PATROL_SPEED = 1.05
RUN_SPEED = 3.60

# ------------------------------------------------------------------ stances

FEET_IDLE = {"ik.foot.L": (0.110, -0.030, 0.102), "rot.foot.L": (0, 0, 10), "pole.foot.L": (0.1, -1, 0),
             "ik.foot.R": (-0.118, 0.040, 0.102), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.1, -1, 0)}
FEET_AIM = {"ik.foot.L": (0.10, -0.13, 0.102), "rot.foot.L": (0, 0, -15), "pole.foot.L": (0.1, -1, 0),
            "ik.foot.R": (-0.13, 0.15, 0.102), "rot.foot.R": (0, 0, -65), "pole.foot.R": (-0.5, -1, 0)}

# standing easy, weight on the left leg, the rifle at a low ready across the
# body: right fist on the wrist of the stock at the hip, left hand under the
# forend, muzzle down and to the left
IDLE_TORSO = P(FEET_IDLE, root=(0.018, 0.004, -0.014), hips=(0, -2, 5), spine=(3, 1, -2), chest=(1, 1, -4), neck=(2, 0, 2), head=(3, -1, 2))
LOW_T = K.rifle_T((-0.150, -0.150, 1.045), (0.70, -0.58, -0.30), (-0.30, 0.0, 1.0))
LOW_FOREND = (0.0, 0.235, 0.036)
POLES_LOW = {"pole.hand.R": (-0.5, 0.7, -0.2), "pole.hand.L": (0.5, 0.3, -0.6)}
IDLE = P(IDLE_TORSO, K.rifle_held(LOW_T, LOW_FOREND, palm=0.9), POLES_LOW)
CARRY_LOW = K.chest_carry(IDLE)

# the aim: bladed, head down on the stock, the sights on the right eye
AIM_TORSO = P(FEET_AIM, root=(0.0, 0.02, -0.03), hips=(0, 0, -37), spine=(13, 0, -4), chest=(4, 0, -12), neck=(34, -4, 28),
              head=(-4, -16, 22), shoulder__R=(0, 0, -6), shoulder__L=(0, 0, 4))
AIM_CH, AIM_T = K.rifle_at(AIM_TORSO, palm=0.35)
POLES_AIM = {"pole.hand.R": (-0.9, 0.2, 0.05), "pole.hand.L": (0.25, 0.1, -0.9)}
AIM = P(AIM_TORSO, AIM_CH, POLES_AIM)


def rifle_kick(T, lift=5.0, back=0.028):
    """The rifle recoiled: muzzle up `lift` degrees about the butt, driven
    back into the shoulder."""
    Tn = T.copy()
    R = T[:3, :3]
    butt = T[:3, 3] + R @ np.array(K.BUTT)
    a = math.radians(lift)
    X = R[:, 0]
    # rotate the frame about its own x (the rifle's right) through the butt
    c, s = math.cos(a), math.sin(a)
    Kx = np.array([[0, -X[2], X[1]], [X[2], 0, -X[0]], [-X[1], X[0], 0]])
    Rot = np.eye(3) + s * Kx + (1 - c) * Kx @ Kx
    Tn[:3, :3] = Rot @ R
    Tn[:3, 3] = butt + Rot @ (T[:3, 3] - butt) - R[:, 1] * back
    return Tn


# ------------------------------------------------------------------ layers

def breath_hands(amp=1.0, period=1.0):
    """The rifle's hunt: the aimed muzzle drifting with the breath."""
    def layer(t, pose):
        a = 2 * math.pi * t / period
        for k, w in (("ikc.hand.R", 1.0), ("ikc.hand.L", 1.3)):
            if k in pose:
                x, y, z = pose[k]
                pose[k] = (x + 0.0012 * amp * w * math.sin(a + 0.4), y, z + 0.0020 * amp * w * math.sin(a))
    return layer


# ------------------------------------------------------------------ idle

def idle():
    """A sentry at ease: weight on the left leg, the rifle low across the
    body; a slow breath, a look up the road and back."""
    c = Clip("idle", 4.0, loop=True)
    c.pose(0.0, IDLE)
    look = dict(IDLE)
    look.update({"head": (2, 0, -24), "neck": (2, 0, -10), "chest": (1, 1, -7), "root": (0.012, 0.004, -0.016)})
    c.pose(1.3, look, "inout")
    c.pose(2.4, look, "inout")
    c.pose(4.0, IDLE, "inout")
    c.layers += [breathe(1.0, 4.0 / 1), sway(0.6, 4.0, seed=0.5)]
    return c


# ------------------------------------------------------------------ smoking

SLING_HAND = K.hand_for("R", K.T_of(K.frame((0.35, -0.2, -0.9), (0.95, 0.0, 0.3)), (-0.150, -0.125, 1.300)))
SMOKE_TORSO = P({"ik.foot.L": (0.105, -0.02, 0.102), "rot.foot.L": (0, 0, 12), "pole.foot.L": (0.1, -1, 0),
                 "ik.foot.R": (-0.125, 0.05, 0.102), "rot.foot.R": (0, 0, -16), "pole.foot.R": (-0.2, -1, 0.1)},
                root=(0.028, 0.006, -0.02), hips=(0, -4, 8), spine=(2, 2, -3), chest=(-1, 2, -5), neck=(4, 0, 0), head=(4, -2, 0))


def cig_hand(pose, where, lift=0.0):
    """Left hand holding the cigarette: `where` = 'low' (resting at the
    belt, elbow bent) or 'lips' (the cigarette's end on the lips)."""
    from . import arms as AR
    if where == "low":
        R = K.frame((-0.35, -0.55, 0.75), (0.30, -0.80, 0.50))
        return K.hand_for("L", K.T_of(R, (0.135, -0.155, 1.075 + lift)))
    G, pos = K.torso_fk(pose)
    mouth = K.at(G, pos, "head", K.MOUTH)
    hr = K.rot(G, "head")
    # palm toward the face, fingers up and across, the cigarette pointing back to the lips
    R = K.frame(hr @ np.array([-0.55, 0.15, 0.80]), hr @ np.array([0.25, 0.95, 0.15]))
    tip = np.asarray(AR.CIG_B, float)
    p = mouth + hr @ np.array([0.0, -0.004, 0.0]) - R @ tip
    return K.hand_for("L", K.T_of(R, p))


def idle_smoke():
    """A sentry's cigarette: rifle slung (gun.rifle.slung), right thumb in
    the sling, prop.cigarette in the left hand. It comes up to the lips
    (1.2 s), a long drag - the chest fills -, down again, the smoke let out
    with the head tipped back; a look round; again. 7 s loop."""
    c = Clip("idle_smoke", 7.0, loop=True)
    poles = {"pole.hand.R": (-0.6, 0.4, -0.5), "pole.hand.L": (0.8, 0.2, -0.5)}
    base = P(SMOKE_TORSO, SLING_HAND, poles)
    low = P(base, cig_hand(base, "low"))
    drag = dict(base)
    drag.update({"head": (0, -2, 6), "neck": (0, 0, 2), "chest": (-3, 2, -5)})
    lips = P(drag, cig_hand(drag, "lips"))
    lips2 = dict(lips)
    lips2.update({"chest": (-5, 2, -5)})                       # the chest fills
    lips2.update(cig_hand(lips2, "lips"))
    exhale = dict(base)
    exhale.update({"head": (-12, -2, 4), "neck": (-6, 0, 0), "chest": (1, 2, -5)})
    exhale.update(cig_hand(exhale, "low", lift=0.03))
    look = dict(base)
    look.update({"head": (4, -2, 26), "neck": (4, 0, 12), "chest": (-1, 2, 0)})
    look.update(cig_hand(look, "low"))
    c.pose(0.0, low)
    c.pose(0.6, low, "inout")
    c.pose(1.25, lips, "inout")
    c.pose(2.2, lips2, "inout")
    c.pose(2.9, exhale, "inout")
    c.pose(4.0, low, "inout")
    c.pose(4.8, look, "inout")
    c.pose(6.0, look, "inout")
    c.pose(7.0, low, "inout")
    c.lag.update({"head": 0.08})
    c.layers += [breathe(1.0, 3.5), sway(0.5, 7.0, seed=1.3)]
    return c


# ------------------------------------------------------------------ binoculars

def bino_hands(pose):
    """Both hands on the binoculars, the eyepieces on the eyes."""
    from . import arms as AR
    G, pos = K.torso_fk(pose)
    hr = K.rot(G, "head")
    mid = 0.5 * (K.at(G, pos, "head", K.EYE["L"]) + K.at(G, pos, "head", K.EYE["R"]))
    Bp = mid + hr @ np.array([0.0, -0.022, 0.004])
    c, Rm = AR._bino_frame()
    # socket.gun in the world: p_socket = B(c), R = hr @ Rm
    TR = K.T_of(hr @ Rm, Bp + hr @ c)
    S = np.diag([-1.0, 1.0, 1.0])
    TL = K.T_of(hr @ (S @ Rm @ S), Bp + hr @ (S @ c))
    ch = K.hand_for("R", TR)
    ch.update(K.hand_for("L", TL))
    return ch


def look_binoculars():
    """Binoculars up to the eyes (prop.binoculars in the right fist, the left
    hand on the other barrel; the rifle slung - gun.rifle.slung), scanning the
    ridge slowly: right, a pause, across to the left, a pause, back. 8 s loop."""
    c = Clip("look_binoculars", 8.0, loop=True)
    feet = {"ik.foot.L": (0.12, -0.08, 0.102), "rot.foot.L": (0, 0, 8), "pole.foot.L": (0.1, -1, 0),
            "ik.foot.R": (-0.13, 0.08, 0.102), "rot.foot.R": (0, 0, -18), "pole.foot.R": (-0.2, -1, 0)}
    poles = {"pole.hand.R": (-0.9, 0.3, -0.3), "pole.hand.L": (0.9, 0.3, -0.3)}
    seq = [(0.0, 0.0), (1.6, -20.0), (3.0, -20.0), (5.0, 18.0), (6.4, 18.0), (8.0, 0.0)]
    for t, yaw in seq:
        pose = P(feet, poles, root=(0.0, 0.01, -0.02), hips=(0, 0, yaw * 0.25), spine=(4, 0, yaw * 0.15), chest=(-2, 0, yaw * 0.25),
                 neck=(-4, 0, yaw * 0.2), head=(-3, 0, yaw * 0.15), shoulder__L=(0, 0, 6), shoulder__R=(0, 0, -6))
        pose.update(bino_hands(pose))
        c.pose(t, pose, "inout")
    # intermediate keys so the hands keep the binoculars on the eyes as he turns
    for (t0, y0), (t1, y1) in zip(seq[:-1], seq[1:]):
        if y0 == y1:
            continue
        for u in (0.25, 0.5, 0.75):
            from charlib.anim import ease
            yaw = y0 + (y1 - y0) * ease("inout", u)
            pose = P(feet, poles, root=(0.0, 0.01, -0.02), hips=(0, 0, yaw * 0.25), spine=(4, 0, yaw * 0.15), chest=(-2, 0, yaw * 0.25),
                     neck=(-4, 0, yaw * 0.2), head=(-3, 0, yaw * 0.15), shoulder__L=(0, 0, 6), shoulder__R=(0, 0, -6))
            pose.update(bino_hands(pose))
            c.pose(t0 + (t1 - t0) * u, pose, "linear")
    c.layers += [breathe(0.6, 4.0)]
    return c


# ------------------------------------------------------------------ walking

def walk_body(c, g, lean=4.0, bob=0.022, sway_x=0.018, hip_yaw=5.0, chest_yaw=6.0, drop=-0.045, head_look=None, n=24):
    """Pelvis and torso over a gait: the pelvis lowest at each heel strike
    and highest over the stance foot, swaying over it, turning with the
    swinging leg; the chest counters; the head stays on the horizon."""
    T = g.T
    for i in range(n + 1):
        t = T * i / n
        ph = t / T
        # two bobs a cycle: highest at each mid-stance
        z = drop + bob * 0.5 * (1 + math.cos(4 * math.pi * (ph - g.duty * 0.5)))
        x = sway_x * math.sin(2 * math.pi * (ph - 0.02 + 0.25))
        yaw = -hip_yaw * math.cos(2 * math.pi * ph)
        roll = 2.5 * math.sin(2 * math.pi * (ph + 0.25))
        cyaw = chest_yaw * math.cos(2 * math.pi * ph)
        look = head_look(t) if head_look else 0.0
        c.key(t, "linear", root=(x, 0.0, z), hips=(lean * 0.3, roll, yaw), spine=(lean * 0.5, -roll * 0.5, cyaw * 0.4),
              chest=(lean * 0.2, -roll * 0.3, cyaw * 0.6), neck=(-lean * 0.4, 0, -(yaw + cyaw) * 0.5 + look * 0.4),
              head=(-lean * 0.3, 0, -(yaw + cyaw) * 0.5 + look * 0.6))


WALK_GAIT = GT.Gait(WALK_SPEED, 1.10, 0.61, -0.33, strike=-16, push=38, lift=0.085, x=0.095, toe_out=7)
PATROL_GAIT = GT.Gait(PATROL_SPEED, 1.24, 0.63, -0.30, strike=-12, push=32, lift=0.07, x=0.10, toe_out=9)
RUN_GAIT = GT.Gait(RUN_SPEED, 0.66, 0.34, -0.26, strike=-4, push=40, lift=0.26, x=0.085, toe_out=5, roll=(0.08, 0.45),
                   swing_peak=0.45)


def walk():
    """An alert walk, rifle at the low ready. In place: move the root at
    WALK_SPEED (1.30 m/s); 1.10 s a cycle of two steps."""
    g = WALK_GAIT
    c = Clip("walk", g.T, loop=True)
    g.keys(c)
    walk_body(c, g, lean=5.0)
    for t in (0.0, g.T):
        c.key(t, "linear", **{k.replace(".", "__"): v for k, v in P(CARRY_LOW, POLES_LOW).items()})
    return c


def patrol_walk():
    """A bored man on a road: rifle slung (gun.rifle.slung), right thumb
    hooked in the sling, left arm swinging loose, shoulders down, head
    wandering. In place: move the root at PATROL_SPEED (1.05 m/s); 1.24 s a
    cycle."""
    g = PATROL_GAIT
    c = Clip("patrol_walk", g.T * 2, loop=True)     # two cycles: the head looks round once
    for k in range(2):
        g2 = GT.Gait(g.speed, g.T, g.duty, g.y0, g.strike, g.push, g.lift, g.x, g.toe_out)
        _keys_offset(c, g2, k * g.T)
    look = lambda t: 14.0 * math.sin(2 * math.pi * t / (2 * g.T) + 0.6)
    _body_offset(c, g, 2, lean=7.0, bob=0.018, hip_yaw=4.0, chest_yaw=4.0, drop=-0.04, head_look=look)
    n = 12
    for i in range(2 * n + 1):
        t = g.T * i / n
        a = 2 * math.pi * t / g.T
        # the free left arm swings opposite the left leg (forward when the right leg leads)
        sw = -math.cos(a)
        ch = {"shoulder.L": (0, 0, 3), "upper_arm.L": (-6 - 16 * sw, 30, 4), "forearm.L": (-16 - 8 * max(sw, 0), 0, 0), "hand.L": (0, 6, 0),
              "ikw.hand.L": (0, 0, 0)}
        c.key(t, "linear", **{k.replace(".", "__"): v for k, v in ch.items()})
    sling = K.chest_carry(P(SMOKE_TORSO, SLING_HAND, {"pole.hand.R": (-0.6, 0.4, -0.5)}))
    for t in (0.0, 2 * g.T):
        c.key(t, "linear", **{k.replace(".", "__"): v for k, v in sling.items() if k.endswith(".R")})
    return c


def _keys_offset(c, g, t0, n=24):
    T = g.T
    for i in range(n + 1):
        t = T * i / n
        for side, ph0, sx in (("L", 0.0, 1.0), ("R", 0.5, -1.0)):
            y, z, pitch = g.foot(t / T + ph0)
            c.key(t0 + t, "linear", **{f"ik__foot__{side}": (sx * g.x, y, z), f"rot__foot__{side}": (pitch, 0.0, sx * g.toe_out),
                                       f"pole__foot__{side}": (sx * 0.12, -1.0, 0.15)})


def _body_offset(c, g, cycles, **kw):
    class _Shift:
        def __init__(self, clip, t0):
            self.clip, self.t0 = clip, t0

        def key(self, t, e="inout", **ch):
            self.clip.key(t + self.t0, e, **ch)
    look = kw.pop("head_look", None)
    for k in range(cycles):
        kk = dict(kw)
        if look:
            kk["head_look"] = (lambda t, k=k: look(t + k * g.T))
        walk_body(_Shift(c, k * g.T), g, **kk)


PORT_T = K.rifle_T((-0.105, -0.215, 1.135), (0.55, -0.30, 0.78), (-0.25, -0.95, 0.15))
POLES_PORT = {"pole.hand.R": (-0.6, 0.5, -0.4), "pole.hand.L": (0.7, 0.3, -0.4)}
CARRY_PORT = K.chest_carry(P(IDLE_TORSO, K.rifle_held(PORT_T, (0.0, 0.30, 0.036), palm=1.2), POLES_PORT))


def run():
    """A run with the rifle at port arms across the chest. In place: move
    the root at RUN_SPEED (3.6 m/s); 0.66 s a cycle of two strides."""
    g = RUN_GAIT
    c = Clip("run", g.T, loop=True)
    g.keys(c)
    T = g.T
    n = 24
    for i in range(n + 1):
        t = T * i / n
        ph = t / T
        # lowest at mid-stance, highest in flight
        z = -0.075 + 0.030 * math.cos(4 * math.pi * (ph - g.duty * 0.5))
        yaw = -8 * math.cos(2 * math.pi * ph)
        c.key(t, "linear", root=(0.012 * math.sin(2 * math.pi * ph + 1.6), -0.02, z), hips=(10, 0, yaw),
              spine=(10, 0, -yaw * 0.4), chest=(6, 0, -yaw * 0.5), neck=(-12, 0, yaw * 0.4), head=(-8, 0, yaw * 0.3))
    for t in (0.0, T):
        c.key(t, "linear", **{k.replace(".", "__"): v for k, v in P(CARRY_PORT, POLES_PORT).items()})
    return c


# ------------------------------------------------------------------ crouch

CROUCH_TORSO = P({"ik.foot.L": (0.13, -0.24, 0.102), "rot.foot.L": (0, 0, 4), "pole.foot.L": (0.25, -1, 0.3),
                  "ik.foot.R": (-0.14, 0.26, 0.17), "rot.foot.R": (38, 0, -14), "pole.foot.R": (-0.2, -1, -0.8)},
                 root=(0.0, 0.07, -0.43), hips=(22, 0, -8), spine=(14, 0, -3), chest=(6, 0, -3), neck=(-14, 0, 6), head=(-14, 0, 5))
READY_T = K.rifle_T((-0.145, -0.225, 1.105), (0.36, -0.86, -0.36), (-0.2, -0.2, 1.0))
POLES_READY = {"pole.hand.R": (-0.7, 0.6, -0.2), "pole.hand.L": (0.6, 0.1, -0.7)}


def crouch():
    """Down on his heels behind cover, the left foot forward, rifle at the
    ready, head up and turning; breathing hard. 3 s loop."""
    c = Clip("crouch", 3.0, loop=True)
    carry = K.chest_carry(P(IDLE_TORSO, K.rifle_held(READY_T, (0.0, 0.29, 0.036), palm=0.7), POLES_READY))
    base = P(CROUCH_TORSO, carry, POLES_READY)
    a = dict(base)
    a.update({"head": (-14, 0, 18), "neck": (-14, 0, 8)})
    b = dict(base)
    b.update({"head": (-12, 0, -14), "neck": (-13, 0, -6), "root": (0.006, 0.07, -0.425)})
    c.pose(0.0, a)
    c.pose(0.5, a, "inout")
    c.pose(1.5, b, "inout")
    c.pose(2.2, b, "inout")
    c.pose(3.0, a, "inout")
    c.layers += [breathe(1.8, 1.0)]
    return c


# ------------------------------------------------------------------ aim and fire

def aim():
    """Standing, rifle shouldered, sights on the right eye (gun.rifle or
    gun.mg - the machine gun is built on the rifle's key points). The
    breath moves the muzzle. 2 s loop."""
    c = Clip("aim", 2.0, loop=True)
    c.pose(0.0, AIM)
    c.pose(2.0, AIM)
    c.layers += [breathe(0.5, 2.0), breath_hands(1.0, 2.0)]
    return c


def fire():
    """One shot from `aim`: the kick drives the rifle back into the shoulder
    and the muzzle up, the shoulders rock, the head comes off the stock a
    touch and settles back on target. 0.6 s, ends on the aim pose."""
    c = Clip("fire", 0.6)
    kick = dict(AIM_TORSO)
    kick.update({"root": (0.0, 0.035, -0.032), "chest": (-1, 0, -13), "spine": (10, 0, -4), "neck": (30, -4, 28), "head": (-9, -14, 22)})
    kick.update(K.hand_for("R", rifle_kick(AIM_T, 6.0, 0.03)))
    kT = rifle_kick(AIM_T, 6.0, 0.03)
    kick.update(K.hand_for("L", K.left_grip(kT[:3, :3], kT[:3, 3] + kT[:3, :3] @ np.array(K.FOREND), 0.35)))
    kick.update(POLES_AIM)
    over = dict(AIM_TORSO)
    over.update({"root": (0.0, 0.016, -0.031)})
    T2 = rifle_kick(AIM_T, -0.8, -0.004)
    over.update(K.hand_for("R", T2))
    over.update(K.hand_for("L", K.left_grip(T2[:3, :3], T2[:3, 3] + T2[:3, :3] @ np.array(K.FOREND), 0.35)))
    over.update(POLES_AIM)
    c.pose(0.0, AIM)
    c.pose(0.045, kick, "snap")
    c.pose(0.26, over, "inout")
    c.pose(0.6, AIM, "inout")
    c.lag.update({"head": 0.03, "neck": 0.02})
    return c


def hit_body():
    """Hit in the body while aiming, and not down: the torso snaps back and
    twists, the knees give, the head whips; he fights back onto the aim.
    0.6 s from and to `aim`."""
    c = Clip("hit_body", 0.6)
    c.pose(0.0, AIM)
    imp = dict(AIM)
    imp.update({"root": (0.02, 0.07, -0.07), "hips": (-4, 3, -30), "spine": (-6, 4, -2), "chest": (-10, 6, -4), "neck": (30, -4, 20), "head": (4, -6, 18)})
    T = rifle_kick(AIM_T, 16.0, 0.05)
    T[:3, 3] += np.array([-0.06, 0.05, -0.10])
    imp.update(K.rifle_held(T, K.FOREND, palm=0.35))
    c.pose(0.05, imp, "snap")
    sag = dict(imp)
    sag.update({"root": (0.015, 0.06, -0.095)})
    c.pose(0.22, sag, "inout")
    c.pose(0.6, AIM, "inout")
    c.lag.update({"head": 0.03, "neck": 0.02, "ikc.hand.L": 0.03, "rotc.hand.L": 0.03})
    return c


# ------------------------------------------------------------------ prone
#
# Lying on his belly along the aim, head toward it (+Z in glTF): the pelvis
# lies PRONE_Y behind the origin, the elbows planted near the origin, the
# boots ~1.5 m behind it, the muzzle ~0.95 m ahead of it at 0.30 m - the
# machine gun's bipod feet rest on the ground.

PRONE_Y = 0.62
PRONE_LEGS = {"ik.foot.L": (0.17, PRONE_Y + 0.84, 0.085), "rot.foot.L": (90, 35, 0), "pole.foot.L": (0.3, 0, -1),
              "ik.foot.R": (-0.27, PRONE_Y + 0.68, 0.085), "rot.foot.R": (90, -45, 0), "pole.foot.R": (-1, 0, -0.3)}
POLES_PRONE = {"pole.hand.R": (-0.5, -1.0, 0.1), "pole.hand.L": (0.2, -1.0, -0.2)}
PRONE_FOREND = (0.0, 0.075, 0.036)     # the left hand just ahead of the magazine: its elbow can plant


def prone_torso(lift=0.0, yaw=6.0, look=0.0, breath=0.0):
    return P(PRONE_LEGS, root=(0.0, PRONE_Y, -0.845 + lift), hips=(88, 0, yaw), spine=(-2 - breath, 0, -2), chest=(-3 - breath, 0, -4),
             neck=(-44, -26, 0), head=(-30, 10 + look, 14), shoulder__L=(0, 0, 12), shoulder__R=(0, 0, -10))


PRONE_AIM_TORSO = prone_torso()
PRONE_CH, PRONE_T = K.rifle_at(PRONE_AIM_TORSO, eye_local=K.SCOPE_EYE, forend=PRONE_FOREND, palm=0.3)
PRONE_AIM = P(PRONE_AIM_TORSO, PRONE_CH, POLES_PRONE)


def prone_aim():
    """Prone behind the rifle (gun.rifle.scoped for the counter-sniper - the
    scope is on his eye -, gun.rifle, or gun.mg on its bipod): elbows
    planted, cheek on the stock; the breath lifts the back and the muzzle a
    hair. 3 s loop."""
    c = Clip("prone_aim", 3.0, loop=True)
    c.pose(0.0, PRONE_AIM)
    c.pose(3.0, PRONE_AIM)
    c.layers += [breathe(0.6, 3.0), breath_hands(0.6, 3.0)]
    return c


def prone_fire():
    """One shot from prone_aim: the kick rocks the shoulders back, the muzzle
    jumps and settles. 0.6 s, ends on prone_aim."""
    c = Clip("prone_fire", 0.6)
    kick = dict(PRONE_AIM_TORSO)
    kick.update({"root": (0.0, PRONE_Y + 0.025, -0.842), "chest": (-5, 0, -4), "head": (-33, 10, 14)})
    kT = rifle_kick(PRONE_T, 5.0, 0.03)
    kick.update(K.rifle_held(kT, PRONE_FOREND, palm=0.3))
    kick.update(POLES_PRONE)
    c.pose(0.0, PRONE_AIM)
    c.pose(0.045, kick, "snap")
    c.pose(0.6, PRONE_AIM, "inout")
    c.lag.update({"head": 0.03})
    return c


def prone():
    """Lying behind cover not aiming: chest down on the forearms, the rifle
    on the ground in front of him, head low, looking along it; breathing.
    3 s loop."""
    c = Clip("prone", 3.0, loop=True)
    torso = P(PRONE_LEGS, root=(0.0, PRONE_Y + 0.05, -0.855), hips=(89, 0, 4), spine=(1, 0, -2), chest=(0, 0, -3),
              neck=(-40, -12, 0), head=(-26, 4, 8), shoulder__L=(0, 0, 6), shoulder__R=(0, 0, -6))
    T = K.rifle_T((-0.07, -0.20, 0.11), (0.08, -1.0, 0.0), (0.35, 0.0, 1.0))
    base = P(torso, K.rifle_held(T, (0.0, 0.26, 0.036), palm=0.2), POLES_PRONE)
    look = dict(base)
    look.update({"head": (-30, 4, 16), "neck": (-44, -12, 4)})
    c.pose(0.0, base)
    c.pose(1.4, look, "inout")
    c.pose(3.0, base, "inout")
    c.layers += [breathe(1.2, 3.0)]
    return c


def prone_death():
    """Shot where he lies: a jolt, the head drops onto the stock, the arms
    let go, the body goes flat. Still at 0.55 s; 1.0 s."""
    c = Clip("prone_death", 1.0)
    c.pose(0.0, PRONE_AIM)
    jolt = dict(PRONE_AIM)
    jolt.update({"root": (0.02, PRONE_Y + 0.04, -0.835), "chest": (-8, 4, -2), "head": (-38, 10, 20)})
    c.pose(0.05, jolt, "snap")
    flat = P(PRONE_LEGS, root=(0.01, PRONE_Y + 0.04, -0.86), hips=(90, 3, 6), spine=(3, 0, -2), chest=(3, 0, -4),
             neck=(-10, -20, 6), head=(-6, 20, 30), shoulder__L=(0, 0, 0), shoulder__R=(0, 0, 0))
    T = rifle_kick(PRONE_T, -9.0, -0.02)
    T[:3, 3] += np.array([0.0, 0.03, -0.11])
    flat.update(K.rifle_held(T, PRONE_FOREND, palm=0.3, left=False))
    flat.update({"ikw.hand.L": (0, 0, 0), "upper_arm.L": (-20, 40, 0), "forearm.L": (-30, 0, 0), "hand.L": (0, 0, 0)})
    flat.update(POLES_PRONE)
    c.pose(0.55, flat, "in2")
    settle = dict(flat)
    settle.update({"root": (0.01, PRONE_Y + 0.04, -0.855)})
    c.pose(0.68, settle, "out")
    c.pose(1.0, flat, "inout")
    c.lag.update({"head": 0.06, "neck": 0.04})
    return c


# ------------------------------------------------------------------ wounds

KNEEL_FEET = {"ik.foot.L": (0.14, -0.30, 0.102), "rot.foot.L": (0, 0, 6), "pole.foot.L": (0.3, -1, 0.2),
              "ik.foot.R": (-0.13, 0.30, 0.13), "rot.foot.R": (70, 0, -8), "pole.foot.R": (-0.1, -1, -0.8)}
CLUTCH_L = hand_rot("L", (-0.55, 0.15, -0.8), (-0.75, -0.5, 0.3))


def wounded_pose(breath=0.0, rock=0.0):
    """Down on his right knee, bent over the wound, left hand clamped to
    his right side, the rifle's butt grounded by the knee, muzzle up."""
    torso = P(KNEEL_FEET, root=(0.0, 0.02, -0.47 + breath * 0.01), hips=(14, 4, -6), spine=(20 + rock, 4, -6), chest=(16 + breath * 2, 2, -4),
              neck=(8, 0, 4), head=(10 - rock, 0, 6))
    G, pos = K.torso_fk(torso)
    side = K.at(G, pos, "spine", (-0.10, -0.11, 1.12))
    ch = {"ik.hand.L": tuple(side + np.array([0.02, -0.03, 0.02])), "rot.hand.L": CLUTCH_L}
    T = K.rifle_T((-0.26, -0.10, 0.36), (0.05, -0.12, 1.0), (-0.3, -1.0, 0.0))
    ch.update(K.rifle_held(T, left=False))
    return P(torso, ch, {"pole.hand.R": (-0.8, 0.4, -0.2), "pole.hand.L": (0.6, 0.2, -0.8)})


def wound_kneel():
    """One body hit (not killed): the round snaps him back and round, the
    right knee goes and hits the ground (0.50 s), he folds over, the left
    hand clamped to the wound, the rifle grounded by the knee. From `idle`
    (or any standing clip); 1.4 s, holds its last frame - `wounded` loops it."""
    c = Clip("wound_kneel", 1.4)
    c.pose(0.0, IDLE)
    imp = dict(IDLE)
    imp.update({"root": (0.03, 0.07, -0.05), "hips": (-5, 4, 14), "spine": (-8, 4, 6), "chest": (-12, 6, 10), "neck": (8, 0, -8), "head": (14, 4, -10)})
    T = rifle_kick(LOW_T, 25.0, 0.0)
    imp.update(K.rifle_held(T, LOW_FOREND, palm=0.9))
    c.pose(0.05, imp, "snap")
    buckle = P(wounded_pose(), root=(0.02, 0.04, -0.26), hips=(8, 6, 4), spine=(10, 4, 0), chest=(6, 2, 0), neck=(4, 0, 0), head=(4, 0, 0))
    buckle.update({"ik.foot.R": (-0.13, 0.22, 0.25), "rot.foot.R": (40, 0, -8)})
    c.pose(0.30, buckle, "in2")
    knee = dict(wounded_pose())
    knee.update({"root": (0.0, 0.02, -0.49)})
    c.pose(0.50, knee, "in")
    c.pose(0.62, P(wounded_pose(), root=(0.0, 0.02, -0.465)), "out")
    c.pose(1.4, wounded_pose(), "inout")
    c.lag.update({"head": 0.05, "neck": 0.03, "ikc.hand.L": 0.08, "rotc.hand.L": 0.08})
    return c


def wounded():
    """Kneeling on the wound (wound_kneel's last frame): breathing hard and
    shallow, rocking over it. 2 s loop."""
    c = Clip("wounded", 2.0, loop=True)
    c.pose(0.0, wounded_pose())
    c.pose(1.0, wounded_pose(0.5, 4.0), "inout")
    c.pose(2.0, wounded_pose(), "inout")
    c.layers += [breathe(2.2, 0.5)]
    return c


# ------------------------------------------------------------------ deaths

LIMP = {"ikw.hand.L": (0, 0, 0)}


def death_back():
    """Taken in the chest: flung back, the legs go, he sits into the fall
    and lands flat on his back (the ground at 0.80 s), a bounce, still.
    From `idle`; 1.4 s."""
    c = Clip("death_back", 1.4)
    c.pose(0.0, IDLE)
    imp = dict(IDLE)
    imp.update({"root": (0.0, 0.08, -0.04), "hips": (-8, 0, 6), "spine": (-12, 0, 2), "chest": (-18, 0, 4), "neck": (8, 0, 0), "head": (16, 0, 0)})
    T = rifle_kick(LOW_T, 35.0, 0.0)
    imp.update(K.rifle_held(T, LOW_FOREND, palm=0.9))
    c.pose(0.06, imp, "snap")
    buckle = P(FEET_IDLE, LIMP, root=(0.0, 0.20, -0.40), hips=(-24, 0, 6), spine=(-14, 0, 0), chest=(-10, 0, 0), neck=(12, 0, 0), head=(22, 0, 6),
               upper_arm__L=(-40, 60, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    buckle.update({"ik.foot.L": (0.11, -0.06, 0.102), "ik.foot.R": (-0.12, -0.02, 0.102)})
    T2 = K.rifle_T((-0.30, 0.05, 0.62), (0.2, -0.5, 0.85), (-0.9, 0.2, 0.1))
    buckle.update(K.rifle_held(T2, left=False))
    buckle.update({"pole.hand.R": (-0.8, 0.3, -0.3)})
    c.pose(0.42, buckle, "inout")
    fall = P({"ik.foot.L": (0.20, -0.36, 0.10), "rot.foot.L": (-60, 0, 25), "ik.foot.R": (-0.16, -0.30, 0.10), "rot.foot.R": (-55, 0, -30),
              "pole.foot.L": (0.4, -0.3, 1.0), "pole.foot.R": (-0.4, -0.3, 1.0)}, LIMP,
             root=(0.0, 0.52, -0.84), hips=(-88, 0, 4), spine=(-3, 0, 0), chest=(-3, 0, 2), neck=(10, 0, 10), head=(12, 0, 18),
             upper_arm__L=(-4, -30, 0), forearm__L=(-35, 0, 0), hand__L=(0, 0, 0))
    T3 = K.rifle_T((-0.45, 0.62, 0.05), (-0.35, -0.9, 0.05), (0.0, 0.1, 1.0))
    fall.update(K.rifle_held(T3, left=False))
    fall.update(K.hand_at("L", (0.44, 0.78, 0.045), (0.7, 0.2, 0.0), (0.0, 0.0, -1.0)))
    fall.update({"pole.hand.R": (-0.5, 1.0, 0.0), "pole.hand.L": (0.8, 0.0, -0.4)})
    c.pose(0.80, fall, "in2")
    bounce = dict(fall)
    bounce.update({"root": (0.0, 0.54, -0.80), "chest": (-10, 0, 2), "head": (-6, 0, 18), "neck": (0, 0, 10)})
    c.pose(0.90, bounce, "out")
    rest = dict(fall)
    rest.update({"root": (0.0, 0.55, -0.845), "head": (16, 0, 26)})
    c.pose(1.4, rest, "bounce")
    c.lag.update({"head": 0.04, "neck": 0.03})
    return c


def death_forward():
    """Gut-shot: doubles over, drops to his knees (0.45 s), topples onto
    his face (the ground at 0.88 s), a bounce, still. From `idle`; 1.4 s."""
    c = Clip("death_forward", 1.4)
    c.pose(0.0, IDLE)
    fold = P(FEET_IDLE, root=(0.0, 0.05, -0.12), hips=(12, 0, 8), spine=(30, 0, 4), chest=(22, 0, 4), neck=(10, 0, 0), head=(12, 0, 0))
    T = rifle_kick(LOW_T, -20.0, 0.0)
    T[:3, 3] += np.array([0.0, 0.05, -0.15])
    fold.update(K.rifle_held(T, LOW_FOREND, palm=0.9))
    fold.update(POLES_LOW)
    c.pose(0.10, fold, "snap")
    kneel = P({"ik.foot.L": (0.13, 0.30, 0.09), "rot.foot.L": (75, 0, 10), "ik.foot.R": (-0.13, 0.34, 0.09), "rot.foot.R": (75, 0, -10),
               "pole.foot.L": (0.1, -1, -0.3), "pole.foot.R": (-0.1, -1, -0.3)}, LIMP,
              root=(0.0, 0.04, -0.47), hips=(8, 0, 4), spine=(26, 0, 0), chest=(20, 0, 0), neck=(14, 0, 0), head=(16, 0, 0),
              upper_arm__L=(-20, 55, 0), forearm__L=(-30, 0, 0), hand__L=(0, 0, 0))
    T2 = K.rifle_T((-0.26, -0.20, 0.45), (0.3, -0.7, -0.6), (-0.6, -0.4, 0.6))
    kneel.update(K.rifle_held(T2, left=False))
    kneel.update({"pole.hand.R": (-0.8, 0.3, -0.3)})
    c.pose(0.45, kneel, "in2")
    down = P({"ik.foot.L": (0.15, 0.46, 0.07), "rot.foot.L": (90, 0, 10), "ik.foot.R": (-0.15, 0.48, 0.07), "rot.foot.R": (90, 0, -10),
              "pole.foot.L": (0.1, 0.2, -1), "pole.foot.R": (-0.1, 0.2, -1)}, LIMP,
             root=(0.0, -0.36, -0.84), hips=(87, 0, 4), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-10, 0, 22), head=(-8, 0, 40),
             upper_arm__L=(-60, 70, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    T3 = K.rifle_T((-0.42, -0.62, 0.05), (0.25, -0.95, 0.0), (0.0, 0.0, 1.0))
    down.update(K.rifle_held(T3, left=False))
    down.update({"pole.hand.R": (-0.7, -0.4, 0.4)})
    c.pose(0.88, down, "in")
    bounce = dict(down)
    bounce.update({"root": (0.0, -0.37, -0.80), "chest": (-6, 0, 0)})
    c.pose(0.96, bounce, "out")
    c.pose(1.4, down, "bounce")
    c.lag.update({"head": 0.04, "neck": 0.03})
    return c


def crumple_pose():
    return P({"ik.foot.L": (0.24, -0.18, 0.08), "rot.foot.L": (0, 80, 40), "ik.foot.R": (0.02, -0.26, 0.09), "rot.foot.R": (10, 70, 20),
              "pole.foot.L": (0.2, -1, 0.3), "pole.foot.R": (0.2, -1, 0.5)}, LIMP,
             root=(-0.06, 0.18, -0.83), hips=(40, -82, 20), spine=(16, 0, 4), chest=(12, 0, 4), neck=(-6, 8, 10), head=(-10, 10, 14),
             upper_arm__L=(-40, 20, 0), forearm__L=(-60, 0, 0), hand__L=(0, 0, 0))


def death_crumple():
    """The legs just go: the knees buckle straight down (they hit the ground
    at 0.42 s), the body folds and topples onto its right side (0.70 s),
    curled. From `idle`; 1.2 s."""
    c = Clip("death_crumple", 1.2)
    c.pose(0.0, IDLE)
    imp = dict(IDLE)
    imp.update({"root": (0.0, 0.02, -0.08), "spine": (6, 0, 0), "chest": (4, 0, 0), "head": (8, 0, 0)})
    c.pose(0.06, imp, "snap")
    knees = P({"ik.foot.L": (0.12, 0.10, 0.10), "rot.foot.L": (60, 0, 12), "ik.foot.R": (-0.12, 0.14, 0.10), "rot.foot.R": (60, 0, -12),
               "pole.foot.L": (0.2, -1, -0.2), "pole.foot.R": (-0.2, -1, -0.2)}, LIMP,
              root=(0.0, 0.05, -0.50), hips=(10, -6, 4), spine=(14, -4, 0), chest=(12, -4, 0), neck=(14, 0, 0), head=(16, -4, 0),
              upper_arm__L=(-10, 50, 0), forearm__L=(-20, 0, 0), hand__L=(0, 0, 0))
    T = K.rifle_T((-0.28, -0.05, 0.50), (0.1, -0.4, -0.9), (-0.9, 0.2, 0.0))
    knees.update(K.rifle_held(T, left=False))
    knees.update({"pole.hand.R": (-0.8, 0.3, -0.2)})
    c.pose(0.42, knees, "in2")
    down = crumple_pose()
    T2 = K.rifle_T((-0.40, -0.25, 0.05), (0.4, -0.9, 0.0), (0.0, 0.0, 1.0))
    down.update(K.rifle_held(T2, left=False))
    G, pos = K.torso_fk(down)
    shL = K.at(G, pos, "chest", (0.178, 0.02, 1.445))
    down.update(K.hand_at("L", (shL[0] - 0.05, shL[1] - 0.32, 0.05), (0.2, -1.0, 0.0), (0.3, 0.0, 1.0)))
    down.update({"pole.hand.R": (-0.6, -0.4, 0.3), "pole.hand.L": (0.3, 0.3, 1.0)})
    c.pose(0.70, down, "in")
    b = dict(down)
    b.update({"root": (-0.06, 0.18, -0.80)})
    c.pose(0.78, b, "out")
    c.pose(1.2, down, "bounce")
    c.lag.update({"head": 0.05, "neck": 0.03})
    return c


def death_kneel():
    """Shot again while kneeling wounded: he sags and topples forward onto
    his face (the ground at 0.55 s). From `wounded`; 1.1 s."""
    c = Clip("death_kneel", 1.1)
    c.pose(0.0, wounded_pose())
    j = dict(wounded_pose())
    j.update({"chest": (6, 2, -4), "head": (0, 0, 6), "root": (0.0, 0.05, -0.47)})
    c.pose(0.06, j, "snap")
    down = P({"ik.foot.L": (0.15, 0.30, 0.07), "rot.foot.L": (90, 0, 10), "ik.foot.R": (-0.15, 0.44, 0.07), "rot.foot.R": (90, 0, -10),
              "pole.foot.L": (0.1, 0.2, -1), "pole.foot.R": (-0.1, 0.2, -1)}, LIMP,
             root=(0.0, -0.40, -0.84), hips=(87, 0, -4), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-10, 0, 22), head=(-8, 0, 40),
             upper_arm__L=(-60, 70, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    T3 = K.rifle_T((-0.42, -0.62, 0.05), (0.25, -0.95, 0.0), (0.0, 0.0, 1.0))
    down.update(K.rifle_held(T3, left=False))
    down.update({"pole.hand.R": (-0.7, -0.4, 0.4)})
    c.pose(0.55, down, "in")
    b = dict(down)
    b.update({"root": (0.0, -0.41, -0.80), "chest": (-6, 0, 0)})
    c.pose(0.63, b, "out")
    c.pose(1.1, down, "bounce")
    c.lag.update({"head": 0.04})
    return c


# ------------------------------------------------------------------ the truck

BED_Y, BED_Z = 0.55, 1.15      # the truck bed under his feet at the start of `dismount` (behind him, up)


def dismount():
    """Out of the back of the truck, facing away from it: crouched on the
    bed (feet 1.15 m up, 0.55 m behind the root), a step to the tailgate's
    edge, the jump (feet leave at 0.62 s), landing at the root on bent knees
    (1.02 s) with weight, rising to the idle stance, rifle at the ready.
    2.1 s; ends on `idle`'s first frame."""
    c = Clip("dismount", 2.1)
    carry = P(CARRY_LOW, POLES_LOW)
    up = BED_Z

    def on_bed(dy_l, dy_r, root, **kw):
        p = P({"ik.foot.L": (0.13, BED_Y + dy_l, up + 0.102), "rot.foot.L": (0, 0, 8), "pole.foot.L": (0.3, -1, 0.2),
               "ik.foot.R": (-0.13, BED_Y + dy_r, up + 0.102), "rot.foot.R": (0, 0, -8), "pole.foot.R": (-0.3, -1, 0.2)}, carry, root=root)
        p.update(kw)
        return p
    crouch0 = on_bed(-0.05, 0.10, (0.0, BED_Y + 0.02, up - 0.38), hips=(24, 0, 0), spine=(12, 0, 0), chest=(4, 0, 0), neck=(-4, 0, 0), head=(6, 0, 0))
    edge = on_bed(-0.24, 0.05, (0.0, BED_Y - 0.10, up - 0.30), hips=(18, 0, 0), spine=(10, 0, 0), chest=(4, 0, 0), neck=(0, 0, 0), head=(10, 0, 0))
    edge.update({"ik.foot.R": (-0.13, BED_Y - 0.16, up + 0.14), "rot.foot.R": (30, 0, -8)})
    load = on_bed(-0.26, -0.18, (0.0, BED_Y - 0.26, up - 0.40), hips=(28, 0, 0), spine=(14, 0, 0), chest=(6, 0, 0), neck=(-8, 0, 0), head=(-6, 0, 0))
    load.update({"rot.foot.R": (0, 0, -8), "rot.foot.L": (0, 0, 8)})
    c.pose(0.0, crouch0)
    c.pose(0.25, crouch0, "inout")
    c.pose(0.42, edge, "inout")
    c.pose(0.56, load, "inout")
    # airborne: the pelvis on a parabola from the push to the landing
    t_off, t_land = 0.62, 1.02
    y0, z0 = BED_Y - 0.30, up - 0.30
    y1, z1 = 0.0, -0.30
    vz0 = 1.2
    T = t_land - t_off
    g = (2 * (z0 + vz0 * T - z1)) / (T * T)
    for i in range(0, 6):
        u = i / 5
        t = t_off + u * T
        tt = u * T
        z = z0 + vz0 * tt - 0.5 * g * tt * tt
        y = y0 + (y1 - y0) * u
        tuck = math.sin(math.pi * u)
        fy = y - 0.02 - 0.10 * tuck
        fz = z + 0.975 - 0.86 + 0.20 * tuck
        pose = P({"ik.foot.L": (0.14, fy - 0.08, fz), "rot.foot.L": (20 * tuck - 10 * u, 0, 8), "pole.foot.L": (0.3, -1, 0.2),
                  "ik.foot.R": (-0.14, fy + 0.04, fz + 0.02), "rot.foot.R": (25 * tuck, 0, -8), "pole.foot.R": (-0.3, -1, 0.2)}, carry,
                 root=(0.0, y, z), hips=(14 - 8 * u, 0, 0), spine=(8, 0, 0), chest=(2 + 4 * tuck, 0, 0), neck=(-2, 0, 0), head=(4 + 6 * u, 0, 0))
        c.pose(t, pose, "linear")
    land = P({"ik.foot.L": (0.14, -0.10, 0.102), "rot.foot.L": (0, 0, 10), "pole.foot.L": (0.3, -1, 0.2),
              "ik.foot.R": (-0.14, 0.04, 0.102), "rot.foot.R": (0, 0, -10), "pole.foot.R": (-0.3, -1, 0.2)}, carry,
             root=(0.0, 0.06, -0.46), hips=(34, 0, 0), spine=(16, 0, 0), chest=(8, 0, 0), neck=(-12, 0, 0), head=(-8, 0, 0))
    c.pose(t_land, land, "in")
    deep = dict(land)
    deep.update({"root": (0.0, 0.07, -0.52), "hips": (38, 0, 0), "spine": (18, 0, 0)})
    c.pose(t_land + 0.12, deep, "out")
    rise = dict(IDLE)
    rise.update({"root": (0.01, 0.02, -0.10), "hips": (10, -1, 4), "spine": (6, 1, -2)})
    c.pose(1.62, rise, "inout")
    c.pose(2.1, IDLE, "inout")
    c.lag.update({"head": 0.04, "ikc.hand.R": 0.04, "rotc.hand.R": 0.04, "ikc.hand.L": 0.04, "rotc.hand.L": 0.04})
    return c


# seat geometry shared with the vehicles (see README): pelvis 0.42 up and
# 0.02 behind the root, feet 0.45 ahead on the floor, wheel centre 0.80 up
# 0.38 ahead, rim radius 0.19, tilted 30 degrees back from vertical
SEAT_PELVIS = (0.0, 0.02, 0.42)
WHEEL_C = np.array([0.0, -0.38, 0.80])
WHEEL_R = 0.19
WHEEL_TILT = 30.0


def wheel_axes():
    """The rim's plane: `up` toward 12 o'clock, `right` toward 3 o'clock
    (his right, -x)."""
    a = math.radians(WHEEL_TILT)
    up = np.array([0.0, -math.sin(a), math.cos(a)])
    right = np.array([-1.0, 0.0, 0.0])
    return up, right


def rim_hands(steer=0.0):
    """Both fists on the rim at ten to two, the wheel turned `steer` degrees
    (positive: turning right, clockwise as he sees it)."""
    up, right = wheel_axes()
    ch = {}
    for side, ang in (("L", -60.0), ("R", 60.0)):
        a = math.radians(ang + steer)
        radial = math.cos(a) * up + math.sin(a) * right
        p = WHEEL_C + WHEEL_R * radial
        tangent = -math.sin(a) * up + math.cos(a) * right          # clockwise
        toward12 = -tangent if side == "R" else tangent
        knuckles = K.unit(radial * 0.6 + np.array([0, -0.8, 0.2]))
        R = K.frame(knuckles, toward12)
        ch.update(K.hand_for(side, K.T_of(R, p)))
    return ch


def drive_pose(steer=0.0, bump=0.0, look=0.0):
    root = (SEAT_PELVIS[0], SEAT_PELVIS[1] - 0.004, SEAT_PELVIS[2] - 0.975 + bump)
    p = P({"ik.foot.L": (0.14, -0.40, 0.102), "rot.foot.L": (-12, 0, 6), "pole.foot.L": (0.25, -1, 0.6),
           "ik.foot.R": (-0.14, -0.42, 0.102), "rot.foot.R": (-18, 0, -6), "pole.foot.R": (-0.25, -1, 0.6)},
          root=root, hips=(-8, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), neck=(4, 0, look * 0.4), head=(2, 0, look * 0.6),
          pole__hand__R=(-0.8, 0.3, -0.6), pole__hand__L=(0.8, 0.3, -0.6))
    p.update(rim_hands(steer))
    return p


def steer_at(t, T=4.0):
    """The wheel's turn (degrees, clockwise) at time t of `drive`."""
    return 7.0 * math.sin(2 * math.pi * t / T) + 3.0 * math.sin(2 * math.pi * 3 * t / T + 1.0)


def drive():
    """Seated at the wheel (root at the vehicle's seat.driver): hands at ten
    to two, small corrections of the wheel (steer_at(t): about +-10
    degrees), the road's bumps coming up through the seat, a glance to the
    side. No rifle (hide gun.* and gun.rifle.slung). 4 s loop."""
    T = 4.0
    c = Clip("drive", T, loop=True)
    n = 16
    for i in range(n + 1):
        t = T * i / n
        look = 18.0 * max(0.0, math.sin(2 * math.pi * (t / T - 0.55))) ** 3
        c.pose(t, drive_pose(steer_at(t, T), 0.0, look), "smooth")
    base = SEAT_PELVIS[2] - 0.975
    for tb, dz in ((0.0, 0.0), (0.9, 0.0), (0.97, 0.013), (1.08, -0.006), (1.2, 0.0), (2.4, 0.0), (2.46, 0.017), (2.58, -0.008),
                   (2.72, 0.0), (3.3, 0.0), (3.36, 0.008), (3.5, 0.0), (T, 0.0)):
        c.key(tb, "inout", root=(SEAT_PELVIS[0], SEAT_PELVIS[1] - 0.004, base + dz))
    c.lag.update({"head": 0.06, "neck": 0.04})
    c.layers += [breathe(0.8, 4.0)]
    return c


def drive_death():
    """Shot at the wheel: the jolt back into the seat, then he slumps
    forward over the wheel and sags to his right, arms sliding off. Still at
    0.9 s; 1.3 s."""
    c = Clip("drive_death", 1.3)
    c.pose(0.0, drive_pose())
    j = drive_pose()
    j.update({"spine": (-6, 0, 0), "chest": (-8, 0, 0), "head": (-10, 0, 0)})
    j.update(rim_hands(0.0))
    c.pose(0.06, j, "snap")
    slump = P(drive_pose(), LIMP, {"ikw.hand.R": (0, 0, 0)}, spine=(24, -8, 0), chest=(22, -6, 0), neck=(20, 0, 10), head=(18, -10, 16),
              upper_arm__L=(-30, 40, 0), forearm__L=(-50, 0, 0), hand__L=(0, 0, 0),
              upper_arm__R=(-35, -50, 0), forearm__R=(-40, 0, 0), hand__R=(0, 0, 0))
    for k in ("ik.hand.L", "rot.hand.L", "ik.hand.R", "rot.hand.R"):
        slump.pop(k, None)
    c.pose(0.6, slump, "in2")
    s2 = dict(slump)
    s2.update({"spine": (28, -12, 0), "chest": (24, -10, 0), "head": (22, -16, 20)})
    c.pose(0.9, s2, "out")
    c.pose(1.3, s2, "inout")
    c.lag.update({"head": 0.05})
    return c


CLIPS = {
    "idle": idle, "idle_smoke": idle_smoke, "look_binoculars": look_binoculars,
    "walk": walk, "patrol_walk": patrol_walk, "run": run, "crouch": crouch,
    "prone": prone, "prone_aim": prone_aim, "prone_fire": prone_fire, "prone_death": prone_death,
    "aim": aim, "fire": fire, "hit_body": hit_body,
    "wound_kneel": wound_kneel, "wounded": wounded, "death_kneel": death_kneel,
    "death_back": death_back, "death_forward": death_forward, "death_crumple": death_crumple,
    "dismount": dismount, "drive": drive, "drive_death": drive_death,
}
