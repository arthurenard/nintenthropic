"""How the dead move: shambling weight, dragging feet, the lurch and the
lunge, the claw at the barricade, the hits that knock them about, the ways
they go down, and how they come at you out of the bus and over the fence.

In place, 30 fps, on the shared humanoid (charlib.anim: poses in armature
axes - x his left, y backward, z up, facing -y; IK for planted feet and
reaching hands). A walk moves its planted feet back at its speed, so the game
slides the root forward at that speed and nothing skates: the speeds are in
META (and in walker.glb's scene extras).

What sells a corpse walking is that nothing is driven by intent: the body
falls onto each step and the leg catches it late; the hips drop hard on the
planted foot; the arms are dead weight, swung by the shoulders, lagging;
the head lolls behind the torso and bobs a beat late; nothing is
symmetrical - one shoulder hangs, one foot turns in.
"""

import math

from .common import A
from charlib.anim import Clip, hand_rot
from charlib.clips_bandit import P, breathe

FOOT_Z = 0.102


def world_hands(t, pose):
    """Layer: hands given in armature space (`wik.hand.*`, `wrot.hand.*`) -
    planted on the ground like feet - re-expressed in the chest's frame each
    frame, which is how the solver reaches for them."""
    from mathutils import Vector
    rig = A.RIG
    for side in ("L", "R"):
        k = f"wik.hand.{side}"
        if k not in pose:
            continue
        R_ = {b: A.E(*pose[b]) for b in rig.order if b in pose}
        G_, pos = rig.fk(R_, Vector(pose.get("root", (0, 0, 0))))
        Gc, pc = G_["chest"], pos["chest"]
        Gi = Gc.inverted()
        pose[f"ikc.hand.{side}"] = tuple(rig.head["chest"] + Gi @ (Vector(pose[k]) - pc))
        rk = f"wrot.hand.{side}"
        if rk in pose:
            m = Gi @ A.E(*pose[rk])
            pose[f"rotc.hand.{side}"] = tuple(math.degrees(a) for a in m.to_euler("XYZ"))
        pose[f"ikw.hand.{side}"] = (1.0, 0.0, 0.0)


def lagged(c, **lags):
    for k, v in lags.items():
        c.lag[k.replace("__", ".")] = v
    return c


# ---------------------------------------------------------------------------
# The dead stance: hunched, head hanging forward and a little to one side,
# the right shoulder dropped, arms dead weight, the left foot turned in

STAND = P({"ik.foot.L": (0.095, -0.03, FOOT_Z), "rot.foot.L": (0, 0, -6), "pole.foot.L": (0.05, -1, 0),
           "ik.foot.R": (-0.13, 0.05, FOOT_Z), "rot.foot.R": (0, 0, -14), "pole.foot.R": (-0.2, -1, 0)},
          root=(0.012, 0.02, -0.04), hips=(8, -4, 3), spine=(10, 2, -2), chest=(8, 4, -3),
          # the neck thrust forward, the head tipped back on it: the face comes
          # up toward the player (the eyes must catch the beam), chin first
          neck=(14, 0, 4), head=(-6, 9, 6),
          shoulder__L=(0, 0, 3), shoulder__R=(0, -6, -2),
          upper_arm__L=(8, 40, 4), forearm__L=(-16, 0, 0), hand__L=(6, 8, 0),
          upper_arm__R=(4, -44, -2), forearm__R=(-10, 0, 0), hand__R=(8, -6, 0))


def with_(pose, **kw):
    out = dict(pose)
    for k, v in kw.items():
        out[k.replace("__", ".")] = v
    return out


# ---------------------------------------------------------------------------
# Gait machinery: foot trajectories over a cycle, seamless at the loop

def foot_track(c, side, T, keys, x, pole=(0, -1, 0), ease="smooth"):
    """keys: (phase 0..1, y, z, pitch deg, yaw deg). Keys at t=0 and t=T are
    interpolated across the wrap so the loop has no seam."""
    pts = sorted(((ph % 1.0) * T, y, z, pitch, yaw) for ph, y, z, pitch, yaw in keys)
    for t, y, z, pitch, yaw in pts:
        c.key(t, ease, **{f"ik__foot__{side}": (x, y, z), f"rot__foot__{side}": (pitch, 0, yaw), f"pole__foot__{side}": pole})
    first, last = pts[0], pts[-1]
    if first[0] > 1e-6 or last[0] < T - 1e-6:
        span = (T - last[0]) + first[0]
        u = (T - last[0]) / span if span > 0 else 0
        vals = [a + (b - a) * u for a, b in zip(last[1:], first[1:])]
        for t in (0.0, T):
            c.key(t, ease, **{f"ik__foot__{side}": (x, vals[0], vals[1]), f"rot__foot__{side}": (vals[2], 0, vals[3]),
                              f"pole__foot__{side}": pole})


def stance_swing(L, duty, lift, scuff=0.0, toe_in=0.0, heel=-6.0):
    """A foot that lands in front (y=-L/2), is carried back to y=+L/2 over the
    duty fraction, then swings forward. scuff drags the toe (low lift, pitch
    down); toe_in turns it."""
    back, front = L / 2, -L / 2
    sw = 1.0 - duty
    return [(0.0, front, FOOT_Z, heel, toe_in),
            (duty * 0.5, 0.0, FOOT_Z, 0, toe_in),
            (duty, back, FOOT_Z + 0.005, 10 + 25 * scuff, toe_in),
            (duty + sw * 0.35, back * 0.45, FOOT_Z + lift * (0.7 - 0.5 * scuff), 30 * (1 - scuff) + 20 * scuff, toe_in),
            (duty + sw * 0.7, front * 0.5, FOOT_Z + lift * (1.0 - 0.6 * scuff), 5 + 15 * scuff, toe_in),
            (0.999, front, FOOT_Z + 0.01, heel, toe_in)]


def body_cycle(c, T, phases, **channels):
    """Key body channels at phases (list) with values per phase (lists)."""
    for i, ph in enumerate(phases):
        kw = {k: v[i] for k, v in channels.items()}
        c.key(ph * T, "inout", **kw)


def arms_hang(c, T, swing=10.0, phase=0.0, drop_r=6.0, bend=(-16, -10), lag=0.08):
    """Dead-weight arms: swung by the shoulders opposite the legs, lagging."""
    for i, ph in enumerate((0.0, 0.25, 0.5, 0.75, 1.0)):
        s = math.cos(2 * math.pi * (ph + phase))
        c.key(ph * T, "inout",
              upper_arm__L=(8 + swing * s, 40, 4), forearm__L=(bend[0] - 4 * max(s, 0), 0, 0), hand__L=(6, 8, 0),
              upper_arm__R=(4 - swing * s, -44 - drop_r * 0.3, -2), forearm__R=(bend[1] - 4 * max(-s, 0), 0, 0), hand__R=(8, -6, 0),
              shoulder__L=(0, 0, 3 + 3 * s), shoulder__R=(0, -drop_r, -2 - 3 * s))
    c.lag.update({"upper_arm.L": lag, "upper_arm.R": lag, "forearm.L": lag * 1.6, "forearm.R": lag * 1.6})


# ---------------------------------------------------------------------------
# Standing and walking

def idle():
    """Standing, swaying: the weight rolls from foot to foot, the head lolls
    and hangs, a twitch runs through the shoulders now and then."""
    T = 4.0
    c = Clip("idle", T, loop=True)
    c.pose(0.0, STAND)
    a = with_(STAND, root=(-0.02, 0.025, -0.045), hips=(8, 3, -2), spine=(11, -2, 1), chest=(9, -1, 2), neck=(16, -3, -4), head=(-2, 4, -6))
    b = with_(STAND, root=(0.025, 0.015, -0.035), hips=(7, -6, 4), spine=(9, 3, -3), chest=(7, 5, -4), neck=(12, 2, 6), head=(-10, 12, 10))
    twitch = with_(b, head=(-20, 16, 14), shoulder__R=(-16, -12, -4), chest=(-12, 7, -6))
    c.pose(1.3, a, "inout")
    c.pose(2.55, b, "inout")
    c.pose(2.75, twitch, "snap")
    c.pose(3.1, b, "out")
    c.pose(T, STAND, "inout")
    c.layers.append(breathe(0.4, 4.0))
    lagged(c, head=0.12, neck=0.08, upper_arm__L=0.1, upper_arm__R=0.14)
    return c


def shamble():
    """The walk of most of them, ~0.85 m/s: short, scuffing steps, the body
    falling onto each one; the left foot turned in; arms hanging; the head
    bobbing a beat late."""
    T, L, duty = 1.3, 0.72, 0.64
    c = Clip("walk.shamble", T, loop=True)
    foot_track(c, "L", T, stance_swing(L, duty, 0.07, scuff=0.6, toe_in=-10), 0.10, (0.1, -1, 0))
    foot_track(c, "R", T, [(ph + 0.5, y, z, p, yaw) for ph, y, z, p, yaw in stance_swing(L, duty, 0.08, scuff=0.35, toe_in=6)], -0.11,
               (-0.15, -1, 0))
    # the hips drop onto each landing, then are pushed up; they sway over the stance foot
    body_cycle(c, T, [0.0, 0.12, 0.3, 0.5, 0.62, 0.8, 1.0],
               root=[(0.03, 0.02, -0.07), (0.035, 0.03, -0.09), (0.02, 0.02, -0.05), (-0.03, 0.02, -0.07), (-0.035, 0.03, -0.09),
                     (-0.02, 0.02, -0.05), (0.03, 0.02, -0.07)],
               hips=[(10, -5, 6), (11, -7, 7), (10, -2, 3), (10, 5, -6), (11, 7, -7), (10, 2, -3), (10, -5, 6)],
               spine=[(12, 3, -3), (13, 4, -3), (12, 1, -1), (12, -3, 3), (13, -4, 3), (12, -1, 1), (12, 3, -3)],
               chest=[(8, 3, -5), (9, 4, -5), (8, 2, -2), (8, -2, 5), (9, -3, 5), (8, -1, 2), (8, 3, -5)],
               neck=[(14, -2, 3), (18, -3, 3), (15, 0, 1), (14, 2, -2), (18, 3, -3), (15, 0, -1), (14, -2, 3)],
               head=[(-8, 10, 8), (-2, 12, 8), (-6, 8, 5), (-10, 8, 2), (-4, 10, 0), (-7, 9, 5), (-8, 10, 8)])
    arms_hang(c, T, swing=12, phase=0.0, drop_r=8)
    lagged(c, head=0.1, neck=0.06)
    return c


def limp():
    """~0.7 m/s: the right leg will not bend - it swings out stiff from the hip,
    the hip hiking to clear it, and the body hurries off it onto the left."""
    T, L = 1.5, 0.62
    c = Clip("walk.limp", T, loop=True)
    # left (good) leg: long stance
    foot_track(c, "L", T, stance_swing(L, 0.70, 0.1, scuff=0.2, toe_in=-6), 0.10, (0.1, -1, 0))
    # right (stiff) leg: short stance, swings forward stiff-kneed in an arc, barely lifted
    back, front = L / 2, -L / 2
    foot_track(c, "R", T, [(0.5, front, FOOT_Z, -2, 10), (0.62, 0.0, FOOT_Z, 0, 10), (0.80, back, FOOT_Z, 6, 10),
                           (0.88, back * 0.3, FOOT_Z + 0.03, 4, 16), (0.96, front * 0.4, FOOT_Z + 0.035, 0, 14), (1.0, front * 0.85, FOOT_Z + 0.01, -2, 10)],
               -0.14, (-0.9, -0.3, 0))
    body_cycle(c, T, [0.0, 0.15, 0.4, 0.5, 0.62, 0.8, 0.9, 1.0],
               root=[(0.04, 0.02, -0.06), (0.05, 0.03, -0.09), (0.04, 0.02, -0.055), (0.0, 0.02, -0.05), (-0.03, 0.02, -0.035),
                     (-0.025, 0.02, -0.025), (0.0, 0.02, -0.04), (0.04, 0.02, -0.06)],
               hips=[(8, -8, 8), (9, -10, 9), (8, -6, 5), (8, 2, 0), (7, 10, -8), (7, 12, -10), (8, 2, 0), (8, -8, 8)],
               spine=[(10, 4, -4), (12, 6, -4), (10, 3, -2), (10, 0, 0), (9, -6, 5), (9, -7, 6), (10, 0, 0), (10, 4, -4)],
               chest=[(6, 3, -5), (8, 4, -6), (6, 2, -3), (6, 0, 0), (5, -4, 5), (5, -5, 6), (6, 0, 0), (6, 3, -5)],
               neck=[(12, -3, 4), (16, -4, 4), (12, -2, 2), (12, 0, 0), (10, 4, -4), (11, 5, -4), (12, 0, 0), (12, -3, 4)],
               head=[(-10, 6, 6), (-4, 8, 7), (-8, 6, 4), (-10, 5, 2), (-12, 10, -4), (-10, 12, -5), (-10, 7, 2), (-10, 6, 6)])
    c.key(0.0, "linear", thigh__R=(0, 0, 0))
    arms_hang(c, T, swing=8, phase=0.1, drop_r=10, lag=0.1)
    lagged(c, head=0.12, neck=0.07)
    return c


def drag():
    """~0.6 m/s: the right foot is dead - turned over on its toes, dragged
    behind as the left leg does all the walking; the body leans off it."""
    T = 1.6
    c = Clip("walk.drag", T, loop=True)
    L = 0.56
    foot_track(c, "L", T, stance_swing(L, 0.66, 0.11, scuff=0.1, toe_in=-4), 0.09, (0.1, -1, 0))
    # the right foot: always behind, on its toes, sliding forward in a lump when the body lurches
    foot_track(c, "R", T, [(0.0, 0.30, FOOT_Z - 0.02, 55, 20), (0.3, 0.44, FOOT_Z - 0.02, 60, 22), (0.55, 0.52, FOOT_Z - 0.015, 62, 24),
                           (0.72, 0.36, FOOT_Z - 0.01, 50, 18), (0.85, 0.24, FOOT_Z - 0.02, 48, 18), (1.0, 0.30, FOOT_Z - 0.02, 55, 20)],
               -0.15, (-0.6, -0.6, 0.2))
    body_cycle(c, T, [0.0, 0.2, 0.45, 0.6, 0.75, 0.9, 1.0],
               root=[(0.05, 0.05, -0.08), (0.06, 0.05, -0.1), (0.045, 0.06, -0.075), (0.02, 0.08, -0.07), (0.0, 0.09, -0.09),
                     (0.03, 0.06, -0.085), (0.05, 0.05, -0.08)],
               hips=[(12, -9, 10), (13, -11, 11), (12, -8, 8), (14, -5, 4), (16, -3, 0), (13, -7, 6), (12, -9, 10)],
               spine=[(12, 5, -3), (14, 6, -3), (12, 5, -2), (13, 3, 0), (15, 2, 2), (13, 4, -1), (12, 5, -3)],
               chest=[(8, 6, -6), (10, 7, -6), (8, 5, -4), (9, 3, -1), (11, 2, 2), (9, 4, -3), (8, 6, -6)],
               neck=[(16, -4, 3), (20, -5, 3), (16, -3, 2), (18, -1, 0), (22, 0, -2), (18, -2, 1), (16, -4, 3)],
               head=[(-6, 8, 10), (0, 10, 10), (-4, 8, 8), (-4, 6, 4), (2, 5, 0), (-3, 7, 6), (-6, 8, 10)])
    arms_hang(c, T, swing=6, phase=0.2, drop_r=12, bend=(-20, -8), lag=0.12)
    lagged(c, head=0.14, neck=0.08)
    return c


REACH_R = hand_rot("R", (0.1, -0.95, -0.3), (0.0, -0.3, -0.95))
REACH_L = hand_rot("L", (-0.1, -0.95, -0.3), (0.0, -0.3, -0.95))


def lurch():
    """~1.1 m/s in bursts: the arms up, reaching; two stumbling steps thrown
    forward, then a sway as it catches itself, and again."""
    T = 1.6
    c = Clip("walk.lurch", T, loop=True)
    # step L at 0, step R at 0.3, then a long stance (the pause), the loop spans two steps and a hold
    foot_track(c, "L", T, [(0.0, -0.40, FOOT_Z, -8, -8), (0.22, 0.0, FOOT_Z, 0, -8), (0.62, 0.44, FOOT_Z, 6, -8),
                           (0.72, 0.30, FOOT_Z + 0.09, 30, -8), (0.85, -0.1, FOOT_Z + 0.12, 10, -8), (0.96, -0.36, FOOT_Z + 0.03, -6, -8)],
               0.10, (0.1, -1, 0))
    foot_track(c, "R", T, [(0.2, -0.42, FOOT_Z, -8, 8), (0.45, 0.0, FOOT_Z, 0, 8), (0.82, 0.48, FOOT_Z, 8, 8),
                           (0.92, 0.3, FOOT_Z + 0.1, 30, 8), (1.05, -0.12, FOOT_Z + 0.12, 10, 8), (1.16, -0.4, FOOT_Z + 0.03, -6, 8)],
               -0.11, (-0.1, -1, 0))
    reach = dict(ikc__hand__L=(0.22, -0.42, 1.36), rotc__hand__L=REACH_L, pole__hand__L=(0.6, 0.3, -0.6),
                 ikc__hand__R=(-0.20, -0.46, 1.33), rotc__hand__R=REACH_R, pole__hand__R=(-0.6, 0.3, -0.6))
    base = with_(STAND, **reach)
    body = [(0.0, (0.02, -0.02, -0.08), (18, -4, 6), (14, 2, -3), (8, 3, -4), (-8, 0, 2), (-6, 4, 4)),
            (0.12, (0.03, -0.06, -0.11), (24, -6, 8), (18, 3, -3), (10, 4, -4), (-12, 0, 2), (-10, 6, 6)),
            (0.3, (-0.02, -0.07, -0.1), (24, 5, -6), (18, -2, 3), (10, -3, 4), (-12, 0, -2), (-8, 6, -2)),
            (0.45, (-0.03, -0.04, -0.07), (20, 6, -7), (15, -3, 3), (9, -3, 4), (-8, 2, -2), (-4, 8, -4)),
            (0.7, (0.0, 0.02, -0.05), (12, 2, -2), (10, 0, 1), (6, 0, 1), (0, 2, 0), (4, 10, 2)),
            (0.85, (0.01, 0.03, -0.055), (10, -2, 2), (9, 1, -1), (5, 1, -1), (2, 0, 2), (6, 8, 4)),
            (1.0, (0.02, -0.02, -0.08), (18, -4, 6), (14, 2, -3), (8, 3, -4), (-8, 0, 2), (-6, 4, 4))]
    for ph, root, hips, spine, chest, neck, head in body:
        pz = with_(base, root=root, hips=hips, spine=spine, chest=chest, neck=neck, head=head)
        c.pose(ph * T, {k: v for k, v in pz.items() if not k.startswith(("ik.foot", "rot.foot", "pole.foot"))}, "inout")
    # the reaching hands paw at the air
    for ph, dl, dr in ((0.0, 0.0, 0.0), (0.25, 0.05, -0.03), (0.5, -0.02, 0.06), (0.75, 0.04, 0.0), (1.0, 0.0, 0.0)):
        c.key(ph * T, "inout", ikc__hand__L=(0.22, -0.42 - dl, 1.36 + dl * 0.6), ikc__hand__R=(-0.20, -0.46 - dr, 1.33 + dr * 0.6))
    lagged(c, head=0.08, neck=0.05, ikc__hand__L=0.1, ikc__hand__R=0.14)
    return c


def run():
    """The recently dead, 3.5 m/s: a lurching sprint - long, uneven strides,
    pitched forward, arms flung out ahead, the head jerking."""
    T = 0.62
    c = Clip("run", T, loop=True)
    table = [(0.00, -0.46, 0.11, -10), (0.10, -0.20, 0.104, 0), (0.22, 0.10, 0.104, 5), (0.34, 0.36, 0.14, 40),
             (0.48, 0.46, 0.40, 72), (0.64, 0.10, 0.50, 30), (0.80, -0.30, 0.34, -5), (0.92, -0.50, 0.17, -14), (1.0, -0.46, 0.11, -10)]
    foot_track(c, "L", T, [(ph, y, z, p, -6) for ph, y, z, p in table], 0.10, (0.15, -1, 0.2))
    foot_track(c, "R", T, [(ph + 0.5, y * 1.06, z, p, 8) for ph, y, z, p in table], -0.11, (-0.15, -1, 0.2))
    for ph, s in ((0.0, 1), (0.25, 0), (0.5, -1), (0.75, 0), (1.0, 1)):
        up = 1 if ph in (0.25, 0.75) else 0
        c.key(ph * T, "inout", root=(0.02 * s, -0.03, -0.1 + 0.05 * up), hips=(16, 3 * s, -8 * s), spine=(14, -2 * s, 5 * s),
              chest=(10, -3 * s, 9 * s), neck=(-10 + 6 * up, 3 * s, -3 * s), head=(-6 + 8 * up, 6 * s, -4 * s))
        r = (-0.20, -0.50, 1.38) if s > 0 else (-0.26, -0.20, 1.16)
        l = (0.25, -0.22, 1.14) if s > 0 else (0.20, -0.52, 1.40)
        if s == 0:
            r, l = (-0.23, -0.36, 1.28), (0.23, -0.36, 1.28)
        c.key(ph * T, "inout", ikc__hand__R=r, ikc__hand__L=l, rotc__hand__R=REACH_R, rotc__hand__L=REACH_L,
              ikw__hand__R=(1, 0, 0), ikw__hand__L=(1, 0, 0), pole__hand__R=(-0.6, 0.6, -0.3), pole__hand__L=(0.6, 0.6, -0.3),
              upper_arm__L=(0, 0, 0), forearm__L=(0, 0, 0), hand__L=(0, 0, 0), upper_arm__R=(0, 0, 0), forearm__R=(0, 0, 0), hand__R=(0, 0, 0))
    lagged(c, head=0.05, neck=0.03, ikc__hand__L=0.05, ikc__hand__R=0.05)
    return c


# ---------------------------------------------------------------------------
# At the barricade

LEAN = P({"ik.foot.L": (0.13, -0.04, FOOT_Z), "rot.foot.L": (0, 0, 8), "pole.foot.L": (0.2, -1, 0),
          "ik.foot.R": (-0.14, 0.16, FOOT_Z), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.2, -1, 0)},
         root=(0.0, -0.05, -0.06), hips=(28, 0, 4), spine=(18, 0, -2), chest=(10, 0, -2), neck=(-6, 0, 0), head=(-4, 4, 2))


def claw():
    """Loops at the barricade: leaning over the sandbags, one arm then the
    other raking at the player, the head snapping forward to bite. One rake
    per 1.4 s loop lands on the half beat (the game's claw damage)."""
    T = 1.4
    c = Clip("claw", T, loop=True)
    hi_R = (-0.18, -0.52, 1.52)
    lo_R = (-0.10, -0.66, 1.02)
    hi_L = (0.20, -0.50, 1.50)
    lo_L = (0.12, -0.64, 1.00)
    rake_R = hand_rot("R", (0.05, -0.6, -0.8), (0.0, -0.8, 0.6))
    rake_L = hand_rot("L", (-0.05, -0.6, -0.8), (0.0, -0.8, 0.6))
    up_R = hand_rot("R", (0.1, -0.7, 0.7), (0.0, 0.7, 0.7))
    up_L = hand_rot("L", (-0.1, -0.7, 0.7), (0.0, 0.7, 0.7))
    keys = [
        # t,   hand R (pos, rot),   hand L,            chest,       neck/head
        (0.00, (hi_R, up_R), ((0.16, -0.60, 1.10), rake_L), (10, 4, -8), (-6, 0, 4), (-2, 4, 8)),
        (0.30, (lo_R, rake_R), ((0.18, -0.52, 1.24), rake_L), (16, -4, 10), (-2, 0, -2), (8, -4, -4)),
        (0.45, ((-0.14, -0.58, 1.12), rake_R), (hi_L, up_L), (12, -3, 8), (-8, 0, -2), (-4, -2, -6)),
        (0.70, ((-0.16, -0.60, 1.10), rake_R), (lo_L, rake_L), (16, 4, -10), (-2, 0, 2), (8, 4, 4)),
        (0.85, ((-0.18, -0.52, 1.24), rake_R), ((0.14, -0.58, 1.12), rake_L), (12, 3, -8), (-10, 0, 2), (-8, 2, 4)),
        (1.05, (hi_R, up_R), ((0.16, -0.60, 1.10), rake_L), (10, 4, -8), (-6, 0, 4), (-2, 4, 8)),
        (1.40, (hi_R, up_R), ((0.16, -0.60, 1.10), rake_L), (10, 4, -8), (-6, 0, 4), (-2, 4, 8)),
    ]
    for t, (pr, rr), (pl, rl), chest, neck, head in keys:
        pose = with_(LEAN, chest=chest, neck=neck, head=head,
                     ik__hand__R=pr, rot__hand__R=rr, pole__hand__R=(-0.7, 0.4, -0.3),
                     ik__hand__L=pl, rot__hand__L=rl, pole__hand__L=(0.7, 0.4, -0.3))
        c.pose(t, pose, "snap" if t in (0.30, 0.70) else "inout")
    # the head's bite, a jerk forward on each rake
    for t, hx in ((0.0, -2), (0.26, -2), (0.34, 14), (0.5, -4), (0.66, -2), (0.74, 14), (0.92, -6), (1.4, -2)):
        c.key(t, "snap" if hx > 10 else "inout", head=(hx, 2, 0))
    c.layers.append(breathe(1.6, 0.7))
    lagged(c, head=0.03, neck=0.02)
    return c


def lunge():
    """The runner's strike: gathers low, launches its whole body at the
    player - arms thrown out, mouth first - and lands leaning into the claw."""
    T = 1.0
    c = Clip("lunge", T)
    run_pose = with_(STAND, root=(0.0, -0.03, -0.1), hips=(16, 0, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(-10, 0, 0), head=(-6, 0, 0))
    gather = P({"ik.foot.L": (0.13, -0.18, FOOT_Z), "rot.foot.L": (0, 0, 6), "pole.foot.L": (0.2, -1, 0),
                "ik.foot.R": (-0.13, 0.26, FOOT_Z), "rot.foot.R": (-20, 0, -8), "pole.foot.R": (-0.2, -1, 0)},
               root=(0.0, 0.08, -0.26), hips=(30, 0, -4), spine=(22, 0, 0), chest=(14, 0, 0), neck=(-18, 0, 0), head=(-14, 0, 0),
               ik__hand__R=(-0.26, -0.18, 0.95), rot__hand__R=REACH_R, pole__hand__R=(-0.6, 0.5, -0.3),
               ik__hand__L=(0.26, -0.16, 0.95), rot__hand__L=REACH_L, pole__hand__L=(0.6, 0.5, -0.3))
    launch = P({"ik.foot.L": (0.13, -0.30, FOOT_Z + 0.05), "rot.foot.L": (-10, 0, 6), "pole.foot.L": (0.2, -1, 0),
                "ik.foot.R": (-0.13, 0.38, FOOT_Z + 0.12), "rot.foot.R": (40, 0, -8), "pole.foot.R": (-0.2, -1, 0)},
               root=(0.0, -0.42, -0.08), hips=(34, 0, 0), spine=(18, 0, 0), chest=(10, 0, 0), neck=(-24, 0, 0), head=(-18, 0, 0),
               ik__hand__R=(-0.22, -0.95, 1.42), rot__hand__R=REACH_R, pole__hand__R=(-0.6, 0.2, -0.5),
               ik__hand__L=(0.22, -0.92, 1.45), rot__hand__L=REACH_L, pole__hand__L=(0.6, 0.2, -0.5))
    land = with_(LEAN, root=(0.0, -0.22, -0.1), hips=(32, 0, 2), ik__hand__R=(-0.14, -0.70, 1.05), rot__hand__R=REACH_R,
                 pole__hand__R=(-0.7, 0.4, -0.3), ik__hand__L=(0.16, -0.66, 1.10), rot__hand__L=REACH_L, pole__hand__L=(0.7, 0.4, -0.3))
    land["ik.foot.L"] = (0.13, -0.32, FOOT_Z)
    land["ik.foot.R"] = (-0.14, -0.02, FOOT_Z)
    c.pose(0.0, run_pose)
    c.pose(0.25, gather, "inout")
    c.pose(0.46, launch, "snap")
    c.pose(0.70, land, "in2")
    end = with_(LEAN, ik__hand__R=(-0.16, -0.60, 1.10), rot__hand__R=REACH_R, pole__hand__R=(-0.7, 0.4, -0.3),
                ik__hand__L=(0.16, -0.60, 1.10), rot__hand__L=REACH_L, pole__hand__L=(0.7, 0.4, -0.3))
    c.pose(1.0, end, "inout")
    lagged(c, head=0.03, neck=0.02)
    return c


# ---------------------------------------------------------------------------
# Hits and falls

def stagger():
    """A body shot: the torso knocked back and twisted, the arms thrown, the
    right foot stepping back to catch it; then it comes on again. (The game
    slides the root back half a step, 0.35 m, over the first 0.3 s.)"""
    T = 0.8
    c = Clip("stagger", T)
    c.pose(0.0, STAND)
    hit = with_(STAND, root=(0.02, 0.10, -0.04), hips=(-6, 6, 10), spine=(-10, 4, 8), chest=(-14, 6, 14), neck=(-8, 0, -6), head=(-14, -8, -8),
                upper_arm__L=(-30, 50, 20), forearm__L=(-30, 0, 0), upper_arm__R=(-20, -60, -10), forearm__R=(-20, 0, 0))
    step = with_(hit, root=(0.02, 0.16, -0.08), hips=(2, 4, 8), spine=(4, 2, 4), chest=(2, 3, 6), neck=(10, 0, -2), head=(8, -4, -4))
    step["ik.foot.R"] = (-0.14, 0.38, FOOT_Z)
    step["rot.foot.R"] = (0, 0, -18)
    c.pose(0.07, hit, "snap")
    c.key(0.07, "inout", ik__foot__R=(-0.13, 0.05, FOOT_Z))
    c.key(0.2, "inout", ik__foot__R=(-0.14, 0.25, FOOT_Z + 0.08))
    c.pose(0.36, step, "out")
    c.pose(T, with_(STAND, root=(0.012, 0.06, -0.05)), "inout")
    lagged(c, head=0.04, neck=0.03, upper_arm__L=0.05, upper_arm__R=0.05, forearm__L=0.08, forearm__R=0.08)
    return c


def hit_head():
    """A round to the head that does not end it (the Mechanic's mask, a
    graze): the head snaps back, the body rocks after it, then hangs forward
    again."""
    T = 0.7
    c = Clip("hit_head", T)
    c.pose(0.0, STAND)
    snap = with_(STAND, root=(0.0, 0.06, -0.03), hips=(0, 0, 4), spine=(-4, 2, 4), chest=(-10, 3, 6), neck=(-24, 6, -8), head=(-38, 14, -12),
                 upper_arm__L=(-20, 50, 10), upper_arm__R=(-16, -54, -8))
    rock = with_(STAND, root=(0.0, 0.05, -0.06), hips=(4, 0, 2), spine=(2, 1, 2), chest=(0, 2, 3), neck=(8, 2, -4), head=(12, 6, -6))
    c.pose(0.05, snap, "snap")
    c.pose(0.32, rock, "inout")
    c.pose(T, STAND, "inout")
    lagged(c, upper_arm__L=0.06, upper_arm__R=0.06)
    return c


LIMP_ARMS = {"ikw.hand.L": (0, 0, 0), "ikw.hand.R": (0, 0, 0)}


def death_back():
    """Knocked over backward: the legs go stiff, it topples like a plank,
    lands on its back (0.8 s, the thud), an arm flops."""
    T = 1.3
    c = Clip("death_back", T)
    c.pose(0.0, STAND)
    imp = with_(STAND, root=(0.0, 0.08, -0.04), hips=(-8, 0, 6), spine=(-12, 0, 2), chest=(-16, 0, 4), neck=(-10, 0, 0), head=(-20, 0, 6),
                upper_arm__L=(-40, 60, 10), upper_arm__R=(-40, -60, -10))
    tip = P({"ik.foot.L": (0.10, -0.08, FOOT_Z), "rot.foot.L": (-20, 0, 0), "ik.foot.R": (-0.12, -0.02, FOOT_Z), "rot.foot.R": (-15, 0, 0),
             "pole.foot.L": (0.1, -1, 0.3), "pole.foot.R": (-0.1, -1, 0.3)}, LIMP_ARMS,
            root=(0.0, 0.38, -0.30), hips=(-38, 0, 4), spine=(-6, 0, 0), chest=(-4, 0, 0), neck=(-10, 0, 0), head=(-14, 0, 4),
            upper_arm__R=(-60, -80, 0), forearm__R=(-20, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-60, 80, 0), forearm__L=(-20, 0, 0), hand__L=(0, 0, 0))
    down = P({"ik.foot.L": (0.18, -0.34, 0.10), "rot.foot.L": (-65, 0, 25), "ik.foot.R": (-0.12, -0.26, 0.10), "rot.foot.R": (-60, 0, -20),
              "pole.foot.L": (0.4, -0.3, 1.0), "pole.foot.R": (-0.4, -0.3, 1.0)}, LIMP_ARMS,
             root=(0.0, 0.54, -0.81), hips=(-88, 0, 4), spine=(-3, 0, 0), chest=(-3, 0, 2), neck=(6, 0, 12), head=(10, 0, 22),
             upper_arm__R=(-10, 60, 0), forearm__R=(-30, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-2, -30, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.06, imp, "snap")
    c.pose(0.45, tip, "in2")
    c.pose(0.80, down, "in")
    b = with_(down, root=(0.0, 0.55, -0.77), chest=(-10, 0, 2), head=(-4, 0, 22))
    c.pose(0.9, b, "out")
    c.pose(T, with_(down, head=(14, 0, 28)), "bounce")
    lagged(c, head=0.04, neck=0.03, upper_arm__L=0.05, upper_arm__R=0.07)
    return c


def death_forward():
    """Folds at the middle and pitches onto its face (0.85 s, the thud)."""
    T = 1.3
    c = Clip("death_forward", T)
    c.pose(0.0, STAND)
    fold = with_(STAND, root=(0.0, 0.04, -0.12), hips=(20, 0, 6), spine=(24, 0, 2), chest=(18, 0, 2), neck=(14, 0, 0), head=(16, 0, 4))
    fold.update(LIMP_ARMS)
    fold.update({"upper_arm.R": (-40, -40, 10), "forearm.R": (-60, 0, 0), "upper_arm.L": (-40, 40, -10), "forearm.L": (-60, 0, 0)})
    kneel = P({"ik.foot.L": (0.13, 0.30, 0.09), "rot.foot.L": (70, 0, 10), "ik.foot.R": (-0.13, 0.34, 0.09), "rot.foot.R": (70, 0, -10),
               "pole.foot.L": (0.1, -1, -0.3), "pole.foot.R": (-0.1, -1, -0.3)}, LIMP_ARMS,
              root=(0.0, 0.04, -0.46), hips=(10, 0, 4), spine=(28, 0, 0), chest=(20, 0, 0), neck=(16, 0, 0), head=(18, 0, 0),
              upper_arm__R=(-10, -60, 0), forearm__R=(-30, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-10, 60, 0), forearm__L=(-30, 0, 0), hand__L=(0, 0, 0))
    down = P({"ik.foot.L": (0.14, 0.44, 0.07), "rot.foot.L": (90, 0, 10), "ik.foot.R": (-0.14, 0.46, 0.07), "rot.foot.R": (90, 0, -10),
              "pole.foot.L": (0.1, 0.2, -1), "pole.foot.R": (-0.1, 0.2, -1)}, LIMP_ARMS,
             root=(0.0, -0.36, -0.82), hips=(86, 0, 4), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-10, 0, 20), head=(-8, 0, 40),
             upper_arm__R=(-150, -20, 0), forearm__R=(-20, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-60, 70, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.1, fold, "snap")
    c.pose(0.42, kneel, "in2")
    c.pose(0.85, down, "in")
    c.pose(0.93, with_(down, root=(0.0, -0.37, -0.785), chest=(-6, 0, 0)), "out")
    c.pose(T, down, "bounce")
    lagged(c, head=0.04, neck=0.03, upper_arm__L=0.03, upper_arm__R=0.03)
    return c


def death_crumple():
    """A headshot: everything lets go at once - it drops straight down where
    it stood, knees first, and slumps over sideways (0.55 s, the knees hit)."""
    T = 1.2
    c = Clip("death_crumple", T)
    c.pose(0.0, STAND)
    jolt = with_(STAND, root=(0.0, 0.02, -0.02), neck=(-16, 0, 0), head=(-26, 6, -6))
    kneel = P({"ik.foot.L": (0.16, 0.36, 0.09), "rot.foot.L": (72, 0, 16), "ik.foot.R": (-0.14, 0.40, 0.09), "rot.foot.R": (72, 0, -12),
               "pole.foot.L": (0.3, -1, -0.3), "pole.foot.R": (-0.3, -1, -0.3)}, LIMP_ARMS,
              root=(0.02, 0.10, -0.52), hips=(-4, 6, 6), spine=(14, 4, 0), chest=(10, 4, 0), neck=(30, 0, 8), head=(30, 10, 12),
              upper_arm__R=(-10, -30, 0), forearm__R=(-10, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-6, 30, 0), forearm__L=(-10, 0, 0), hand__L=(0, 0, 0))
    heap = P({"ik.foot.L": (0.18, 0.40, 0.08), "rot.foot.L": (80, 0, 30), "ik.foot.R": (-0.10, 0.50, 0.08), "rot.foot.R": (80, 0, -20),
              "pole.foot.L": (0.8, -0.6, -0.3), "pole.foot.R": (0.2, -1, -0.3)}, LIMP_ARMS,
             root=(0.18, 0.12, -0.78), hips=(20, 60, 10), spine=(10, 10, 0), chest=(6, 8, 0), neck=(10, 10, 20), head=(6, 20, 30),
             upper_arm__R=(-60, -50, 0), forearm__R=(-40, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-20, 80, 0), forearm__L=(-30, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.05, jolt, "snap")
    c.pose(0.55, kneel, "in")
    c.pose(0.62, with_(kneel, root=(0.02, 0.10, -0.54)), "out")
    c.pose(1.0, heap, "in2")
    c.pose(T, with_(heap, root=(0.18, 0.12, -0.79)), "out")
    lagged(c, head=0.05, neck=0.04)
    return c


# ---------------------------------------------------------------------------
# Crawling (char.crawler)

CRAWL_ROOT = (0.0, -0.20, -0.80)


def crawl():
    """Dragging itself on its claws, ~0.5 m/s: one arm reaches out and digs
    in, pulls the body forward as the other reaches, head up and fixed on the
    player; the stumps drag. The hands plant and slide back like feet."""
    T = 1.6
    c = Clip("crawl", T, loop=True)
    legs = {"ik.foot.L": (0.13, 0.52, 0.12), "rot.foot.L": (80, 0, 10), "pole.foot.L": (0.2, 0.2, -1),
            "ik.foot.R": (-0.13, 0.55, 0.10), "rot.foot.R": (80, 0, -10), "pole.foot.R": (-0.2, 0.2, -1),
            "ikw.foot.L": (0.0, 0, 0), "ikw.foot.R": (0.0, 0, 0)}
    palm_R = hand_rot("R", (0.0, -0.9, -0.4), (0.0, -0.4, 0.9))
    palm_L = hand_rot("L", (0.0, -0.9, -0.4), (0.0, -0.4, 0.9))
    # hand trajectories (armature space, like feet): planted at z ~0.05, reach far in front
    reach, pull = -0.78, -0.30
    for side, off, x, rr in (("R", 0.0, -0.24, palm_R), ("L", 0.5, 0.24, palm_L)):
        keys = [(0.0, reach, 0.06), (0.5, pull, 0.06), (0.62, pull + 0.02, 0.16), (0.85, reach + 0.12, 0.2), (1.0, reach, 0.06)]
        pts = sorted((((ph + off) % 1.0) * T, y, z) for ph, y, z in keys)
        for t, y, z in pts:
            c.key(t, "smooth", **{f"wik__hand__{side}": (x, y, z), f"wrot__hand__{side}": rr,
                                  f"pole__hand__{side}": (0.4 * (1 if side == 'L' else -1), 0.2, 1.0)})
        if pts[0][0] > 0:
            ta, ya, za = pts[-1]
            tb, yb, zb = pts[0]
            u = (T - ta) / ((T - ta) + tb)
            for t in (0.0, T):
                c.key(t, "smooth", **{f"wik__hand__{side}": (x, ya + (yb - ya) * u, za + (zb - za) * u), f"wrot__hand__{side}": rr,
                                      f"pole__hand__{side}": (0.4 * (1 if side == 'L' else -1), 0.2, 1.0)})
    for ph, s in ((0.0, 1), (0.25, 0), (0.5, -1), (0.75, 0), (1.0, 1)):
        c.key(ph * T, "inout", root=(0.03 * s, CRAWL_ROOT[1] - 0.04 * abs(s), CRAWL_ROOT[2] + 0.02 * (1 - abs(s))),
              hips=(82, 6 * s, 4 * s), spine=(2, -6 * s, 4 * s), chest=(-6, -6 * s, 6 * s), neck=(-46, 4 * s, -3 * s), head=(-38, 6 * s, -6 * s),
              thigh__L=(0, 0, 0), thigh__R=(0, 0, 0),
              **{k.replace(".", "__"): v for k, v in legs.items()})
    c.layers.append(world_hands)
    lagged(c, head=0.08, neck=0.05)
    return c


# ---------------------------------------------------------------------------
# Out of the bus, over the fence

def climb_out():
    """From the bus's door: it starts crouched in the doorway, a step up and
    half a metre back, a hand on the frame; steps down, stumbles, and ends
    standing on its origin (spawn.bus) facing out."""
    T = 1.7
    c = Clip("climb_out", T)
    up, back = 0.42, 0.55
    door = P({"ik.foot.L": (0.10, back - 0.05, FOOT_Z + up), "rot.foot.L": (0, 0, -6), "pole.foot.L": (0.1, -1, 0),
              "ik.foot.R": (-0.12, back + 0.12, FOOT_Z + up), "rot.foot.R": (0, 0, -10), "pole.foot.R": (-0.2, -1, 0)},
             root=(0.0, back + 0.02, up - 0.28), hips=(30, 0, 0), spine=(22, 0, 0), chest=(12, 0, 0), neck=(-4, 0, 0), head=(0, 6, 4),
             ik__hand__R=(-0.36, back - 0.10, 1.35 + up * 0.5), rot__hand__R=hand_rot("R", (-0.7, -0.2, 0.6), (0, 1, 0)), pole__hand__R=(-0.8, 0.3, -0.3),
             ik__hand__L=(0.30, back - 0.30, 0.95 + up * 0.5), rot__hand__L=REACH_L, pole__hand__L=(0.6, 0.3, -0.5))
    step = P({"ik.foot.L": (0.10, 0.15, FOOT_Z), "rot.foot.L": (-5, 0, -6), "pole.foot.L": (0.1, -1, 0),
              "ik.foot.R": (-0.12, back + 0.10, FOOT_Z + up), "rot.foot.R": (20, 0, -10), "pole.foot.R": (-0.2, -1, 0)},
             root=(0.0, 0.32, -0.12), hips=(24, 4, 6), spine=(16, 2, 0), chest=(8, 2, 0), neck=(4, 0, 0), head=(6, 6, 4),
             ik__hand__R=(-0.36, back - 0.12, 1.45), rot__hand__R=hand_rot("R", (-0.7, -0.2, 0.6), (0, 1, 0)), pole__hand__R=(-0.8, 0.3, -0.3),
             ik__hand__L=(0.28, -0.30, 1.05), rot__hand__L=REACH_L, pole__hand__L=(0.6, 0.3, -0.5))
    stumble = with_(STAND, root=(0.0, 0.02, -0.12), hips=(22, -6, 4), spine=(16, 3, 0), chest=(10, 3, 0), neck=(12, 0, 0), head=(10, 10, 6))
    stumble["ik.foot.R"] = (-0.12, -0.10, FOOT_Z)
    c.pose(0.0, door)
    c.pose(0.25, with_(door, root=(0.0, back - 0.02, up - 0.33), head=(-6, 4, 2)), "inout")
    c.key(0.25, "inout", ik__foot__L=(0.10, back - 0.05, FOOT_Z + up))
    c.key(0.5, "inout", ik__foot__L=(0.10, 0.30, FOOT_Z + up * 0.6))
    c.pose(0.75, step, "in2")
    c.key(0.9, "inout", ik__foot__R=(-0.12, back * 0.5, FOOT_Z + up * 0.7))
    c.pose(1.15, stumble, "in2")
    c.pose(T, STAND, "inout")
    lagged(c, head=0.06, neck=0.04)
    return c


def vault():
    """Over the split-rail fence: it starts 1.1 m back on the field side,
    grabs the top rail, drags a leg over, rolls its weight across and drops,
    ending on its origin (spawn.fence) on the road side."""
    T = 1.8
    c = Clip("vault", T)
    back = 1.10
    rail_y = 0.55
    grab = P({"ik.foot.L": (0.10, back - 0.05, FOOT_Z), "rot.foot.L": (0, 0, -6), "pole.foot.L": (0.1, -1, 0),
              "ik.foot.R": (-0.12, back + 0.12, FOOT_Z), "rot.foot.R": (0, 0, -10), "pole.foot.R": (-0.2, -1, 0)},
             root=(0.0, back - 0.02, -0.08), hips=(24, 0, 0), spine=(18, 0, 0), chest=(10, 0, 0), neck=(-8, 0, 0), head=(-4, 0, 0),
             ik__hand__R=(-0.24, rail_y + 0.05, 1.12), rot__hand__R=hand_rot("R", (0, -0.2, -1), (0, -1, 0.2)), pole__hand__R=(-0.8, 0.2, -0.4),
             ik__hand__L=(0.24, rail_y + 0.05, 1.12), rot__hand__L=hand_rot("L", (0, -0.2, -1), (0, -1, 0.2)), pole__hand__L=(0.8, 0.2, -0.4))
    leg_over = P({"ik.foot.L": (0.16, rail_y - 0.05, 1.18), "rot.foot.L": (10, 0, 20), "pole.foot.L": (0.8, -0.5, 0.2),
                  "ik.foot.R": (-0.12, back - 0.1, FOOT_Z), "rot.foot.R": (10, 0, -10), "pole.foot.R": (-0.2, -1, 0)},
                 root=(0.04, rail_y + 0.35, 0.12), hips=(20, -18, 10), spine=(24, 8, 0), chest=(14, 6, 0), neck=(-6, 0, 0), head=(-4, 4, 4),
                 ik__hand__R=(-0.24, rail_y + 0.05, 1.12), rot__hand__R=hand_rot("R", (0, -0.2, -1), (0, -1, 0.2)), pole__hand__R=(-0.8, 0.2, -0.4),
                 ik__hand__L=(0.24, rail_y + 0.05, 1.12), rot__hand__L=hand_rot("L", (0, -0.2, -1), (0, -1, 0.2)), pole__hand__L=(0.8, 0.2, -0.4))
    astride = P({"ik.foot.L": (0.18, rail_y - 0.4, 0.45), "rot.foot.L": (0, 0, 10), "pole.foot.L": (0.3, -1, 0),
                 "ik.foot.R": (-0.14, rail_y + 0.3, 0.9), "rot.foot.R": (30, 0, -20), "pole.foot.R": (-0.8, 0.3, 0.2)},
                root=(0.0, rail_y + 0.02, 0.18), hips=(10, 14, -6), spine=(18, -6, 0), chest=(10, -4, 0), neck=(0, 0, 0), head=(4, 6, 4),
                ik__hand__R=(-0.24, rail_y, 1.12), rot__hand__R=hand_rot("R", (0, -0.2, -1), (0, -1, 0.2)), pole__hand__R=(-0.8, 0.2, -0.4),
                ik__hand__L=(0.30, rail_y - 0.4, 1.0), rot__hand__L=REACH_L, pole__hand__L=(0.6, 0.3, -0.5))
    drop = with_(STAND, root=(0.0, 0.12, -0.2), hips=(26, 0, 0), spine=(18, 0, 0), chest=(10, 0, 0), neck=(10, 0, 0), head=(12, 6, 4))
    drop["ik.foot.L"] = (0.13, 0.05, FOOT_Z)
    drop["ik.foot.R"] = (-0.13, 0.22, FOOT_Z + 0.05)
    c.pose(0.0, grab)
    c.pose(0.35, with_(grab, root=(0.0, back - 0.1, -0.02), hips=(30, 0, 0)), "inout")
    c.pose(0.75, leg_over, "inout")
    c.pose(1.05, astride, "inout")
    c.pose(1.35, drop, "in2")
    c.pose(T, STAND, "inout")
    lagged(c, head=0.05, neck=0.03)
    return c


def bloat_burst():
    """The bloater at the barricade or shot in the belly: it heaves, the
    belly straining; it clutches at itself, rears back as it bursts (1.3 s,
    the game's burst), and collapses in on itself."""
    T = 2.2
    c = Clip("bloat_burst", T)
    base = with_(STAND, root=(0.0, 0.03, -0.05), hips=(2, 0, 0), spine=(4, 0, 0), chest=(2, 0, 0))
    heave1 = with_(base, spine=(-6, 0, 0), chest=(-8, 0, 0), neck=(-10, 0, 0), head=(-16, 4, 0),
                   ik__hand__R=(-0.18, -0.30, 1.10), rot__hand__R=hand_rot("R", (0.5, -0.3, -0.8), (0, -1, 0)), pole__hand__R=(-0.7, 0.3, -0.5),
                   ik__hand__L=(0.18, -0.30, 1.12), rot__hand__L=hand_rot("L", (-0.5, -0.3, -0.8), (0, -1, 0)), pole__hand__L=(0.7, 0.3, -0.5))
    heave2 = with_(heave1, root=(0.02, 0.05, -0.08), spine=(10, 3, 4), chest=(10, 3, 4), neck=(16, 0, 0), head=(14, 6, 6))
    burst = with_(base, root=(0.0, 0.14, -0.02), hips=(-14, 0, 0), spine=(-18, 0, 0), chest=(-20, 0, 0), neck=(-20, 0, 0), head=(-30, 0, 0),
                  upper_arm__L=(-50, 70, 20), forearm__L=(-10, 0, 0), upper_arm__R=(-50, -70, -20), forearm__R=(-10, 0, 0))
    burst.update(LIMP_ARMS)
    heap = P({"ik.foot.L": (0.18, 0.30, 0.09), "rot.foot.L": (70, 0, 20), "ik.foot.R": (-0.14, 0.36, 0.09), "rot.foot.R": (72, 0, -12),
              "pole.foot.L": (0.3, -1, -0.3), "pole.foot.R": (-0.3, -1, -0.3)}, LIMP_ARMS,
             root=(0.02, 0.2, -0.58), hips=(-10, 0, 4), spine=(30, 0, 0), chest=(20, 0, 0), neck=(30, 0, 0), head=(30, 6, 10),
             upper_arm__R=(-10, -30, 0), forearm__R=(-10, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-6, 30, 0), forearm__L=(-10, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.0, base)
    c.pose(0.35, heave1, "inout")
    c.pose(0.7, heave2, "inout")
    c.pose(1.0, heave1, "inout")
    c.pose(1.22, heave2, "in2")
    c.pose(1.32, burst, "snap")
    c.pose(1.8, heap, "in2")
    c.pose(T, with_(heap, root=(0.02, 0.2, -0.6)), "out")
    lagged(c, head=0.04, neck=0.03)
    return c


# ---------------------------------------------------------------------------
# The crawler's own versions (`.low`): the game plays these for a body with
# no legs to stand on - waiting, clawing at the bags, hit, dying - all from
# the crawl's pose on the ground, hands in armature space like the crawl's

def _low_pose(**kw):
    legs = {"ik.foot.L": (0.13, 0.52, 0.12), "rot.foot.L": (80, 0, 10), "pole.foot.L": (0.2, 0.2, -1),
            "ik.foot.R": (-0.13, 0.55, 0.10), "rot.foot.R": (80, 0, -10), "pole.foot.R": (-0.2, 0.2, -1),
            "ikw.foot.L": (0.0, 0, 0), "ikw.foot.R": (0.0, 0, 0)}
    base = dict(root=CRAWL_ROOT, hips=(82, 0, 0), spine=(2, 0, 0), chest=(-6, 0, 0), neck=(-46, 0, 0), head=(-38, 0, 0),
                thigh__L=(0, 0, 0), thigh__R=(0, 0, 0))
    base.update({k.replace(".", "__"): v for k, v in legs.items()})
    base.update(kw)
    return base


_PALM_R = None
_PALM_L = None


def _palms():
    global _PALM_R, _PALM_L
    if _PALM_R is None:
        _PALM_R = hand_rot("R", (0.0, -0.9, -0.4), (0.0, -0.4, 0.9))
        _PALM_L = hand_rot("L", (0.0, -0.9, -0.4), (0.0, -0.4, 0.9))
    return _PALM_R, _PALM_L


def _hands(c, t, R=(-0.24, -0.55, 0.06), L=(0.24, -0.52, 0.06), rotR=None, rotL=None, ease="inout"):
    pr, pl = _palms()
    c.key(t, ease, wik__hand__R=R, wrot__hand__R=rotR or pr, pole__hand__R=(-0.4, 0.2, 1.0),
          wik__hand__L=L, wrot__hand__L=rotL or pl, pole__hand__L=(0.4, 0.2, 1.0))


def idle_low():
    """Waiting at the barricade on its belly: both hands dug in, the head up
    and swaying toward the player, a slow heave; now and then a hand claws
    the ground."""
    T = 3.0
    c = Clip("idle.low", T, loop=True)
    for t, s in ((0.0, 1), (0.75, 0), (1.5, -1), (2.25, 0), (T, 1)):
        c.key(t, "inout", **_low_pose(root=(0.02 * s, CRAWL_ROOT[1], CRAWL_ROOT[2] + 0.015 * (1 - abs(s))),
                                      spine=(2, -3 * s, 2 * s), chest=(-8, -3 * s, 3 * s), neck=(-48, 3 * s, -2 * s),
                                      head=(-36, 8 * s, -8 * s)))
    _hands(c, 0.0)
    _hands(c, 1.1)
    _hands(c, 1.35, R=(-0.26, -0.62, 0.14))          # the right hand lifts, claws
    _hands(c, 1.6, R=(-0.25, -0.50, 0.05), ease="snap")
    _hands(c, T)
    c.layers.append(world_hands)
    lagged(c, head=0.12, neck=0.06)
    return c


def claw_low():
    """At the barricade from the ground: it rears up on its left arm and
    rakes at the bags with the right, twice; the strikes at 0.45 s and 1.0 s."""
    T = 1.4
    c = Clip("claw.low", T, loop=True)
    pr, pl = _palms()
    up = _low_pose(root=(0.0, CRAWL_ROOT[1] - 0.06, CRAWL_ROOT[2] + 0.16), hips=(70, 0, -4), spine=(-6, 0, -4), chest=(-14, 0, -6),
                   neck=(-30, 0, 4), head=(-24, 4, 6))
    c.key(0.0, "inout", **up)
    c.key(T, "inout", **up)
    reach_rot = hand_rot("R", (0.1, -0.95, 0.3), (0.0, 0.3, 0.95))
    keys = ((0.0, -0.55, 0.22), (0.25, -0.72, 0.62), (0.45, -0.62, 0.18), (0.7, -0.70, 0.55),
            (1.0, -0.60, 0.16), (1.2, -0.58, 0.30), (T, -0.55, 0.22))
    eases = ("inout", "in2", "out", "in2", "out", "inout", "inout")
    for (t, y, z), e in zip(keys, eases):
        c.key(t, e, wik__hand__R=(-0.22, y, z), wrot__hand__R=reach_rot, pole__hand__R=(-0.6, 0.2, 0.6),
              wik__hand__L=(0.20, -0.42, 0.06), wrot__hand__L=pl, pole__hand__L=(0.4, 0.2, 1.0))
    c.layers.append(world_hands)
    lagged(c, head=0.05, neck=0.03)
    return c


def hit_head_low():
    """A round in the head as it lies there: the head snaps back and aside,
    the chest jerks up, and it slumps back into the crawl."""
    T = 0.7
    c = Clip("hit_head.low", T)
    base = _low_pose()
    c.key(0.0, "inout", **base)
    c.key(0.08, "snap", **_low_pose(root=(0.0, CRAWL_ROOT[1] + 0.03, CRAWL_ROOT[2] + 0.05), chest=(-16, 4, -6), neck=(-58, 6, 10),
                                    head=(-62, 16, 20)))
    c.key(0.3, "out", **_low_pose(root=(0.0, CRAWL_ROOT[1] + 0.02, CRAWL_ROOT[2] + 0.01), chest=(-4, 2, -2), neck=(-36, 2, 6),
                                  head=(-24, 8, 10)))
    c.key(T, "inout", **base)
    _hands(c, 0.0)
    _hands(c, 0.12, R=(-0.26, -0.50, 0.10), L=(0.26, -0.48, 0.10))
    _hands(c, T)
    c.layers.append(world_hands)
    lagged(c, head=0.03, neck=0.02)
    return c


def death_low():
    """Shot dead where it lies: a jolt, the arms give, and it goes flat on
    its face, the head turned aside on the road (the thud at 0.5 s)."""
    T = 1.2
    c = Clip("death.low", T)
    c.key(0.0, "inout", **_low_pose())
    c.key(0.1, "snap", **_low_pose(root=(0.0, CRAWL_ROOT[1] + 0.04, CRAWL_ROOT[2] + 0.04), chest=(-14, 0, 0), neck=(-54, 0, 0),
                                   head=(-44, 6, 4)))
    flat = _low_pose(root=(0.0, CRAWL_ROOT[1] + 0.06, CRAWL_ROOT[2] - 0.13), hips=(88, 0, 6), spine=(6, 0, 4), chest=(4, 0, 6),
                     neck=(-10, 10, 20), head=(-6, 20, 60))
    c.key(0.5, "in2", **flat)
    c.key(T, "out", **flat)
    _hands(c, 0.0)
    _hands(c, 0.3, R=(-0.30, -0.45, 0.10), L=(0.30, -0.42, 0.10))
    _hands(c, 0.55, R=(-0.40, -0.30, 0.03), L=(0.36, -0.20, 0.03), ease="in2")
    _hands(c, T, R=(-0.42, -0.28, 0.03), L=(0.37, -0.18, 0.03))
    c.layers.append(world_hands)
    lagged(c, head=0.05, neck=0.03)
    return c


CLIPS = {
    "idle": idle, "walk.shamble": shamble, "walk.limp": limp, "walk.drag": drag, "walk.lurch": lurch,
    "run": run, "lunge": lunge, "crawl": crawl, "claw": claw, "stagger": stagger, "hit_head": hit_head,
    "death_back": death_back, "death_forward": death_forward, "death_crumple": death_crumple,
    "climb_out": climb_out, "vault": vault, "bloat_burst": bloat_burst,
    "idle.low": idle_low, "claw.low": claw_low, "hit_head.low": hit_head_low, "death.low": death_low,
}
LOW_CLIPS = ("idle.low", "claw.low", "hit_head.low", "death.low")

# what the game needs to play them: speeds for the walks (the root moves at
# this while the clip loops), and the moments things happen
META = {
    "walk.shamble": {"loop": True, "speed_mps": 0.85},
    "walk.limp": {"loop": True, "speed_mps": 0.7},
    "walk.drag": {"loop": True, "speed_mps": 0.6},
    "walk.lurch": {"loop": True, "speed_mps": 1.1},
    "run": {"loop": True, "speed_mps": 3.5},
    "crawl": {"loop": True, "speed_mps": 0.5},
    "idle": {"loop": True}, "claw": {"loop": True, "strike_s": [0.3, 1.0]},
    "lunge": {"strike_s": 0.46, "reach_m": 0.9},
    "stagger": {"root_back_m": 0.35, "over_s": 0.3},
    "hit_head": {},
    "death_back": {"thud_s": 0.8}, "death_forward": {"thud_s": 0.85}, "death_crumple": {"thud_s": 0.55},
    "climb_out": {"ends_at_origin": True, "starts": "0.55 m back and 0.42 m up, in the bus door"},
    "vault": {"ends_at_origin": True, "starts": "1.1 m back on the field side of the fence"},
    "bloat_burst": {"burst_s": 1.32},
    "idle.low": {"loop": True, "for": "char.crawler"}, "claw.low": {"loop": True, "strike_s": [0.45, 1.0], "for": "char.crawler"},
    "hit_head.low": {"for": "char.crawler"}, "death.low": {"thud_s": 0.5, "for": "char.crawler"},
}
