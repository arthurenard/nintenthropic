"""The living run: upright, purposeful, arms pumping in time - everything
the dead are not - with the lantern held out and steady so its light leads.

    run          a sprint, ~5 m/s (lantern hanging, swinging with the arm)
    run_lantern  running with the lantern held out in front at chest height
    duck         crouched, flinching, the free arm over the head (loops)
    wave         "Don't shoot!": the free arm waving high, the lantern raised (loops)
"""

from charlib.anim import Clip, hand_rot
from charlib.clips_bandit import P, breathe
from .clips_dead import foot_track, FOOT_Z, with_, lagged

LANTERN_HANG = hand_rot("L", (0.0, -0.25, 0.97), (0.0, 0.97, 0.25))    # knuckles up, the bail hanging from the fist


def stride(c, T):
    table = [(0.00, -0.42, 0.11, -10), (0.10, -0.18, 0.104, 0), (0.22, 0.12, 0.104, 5), (0.34, 0.36, 0.15, 40),
             (0.48, 0.44, 0.42, 75), (0.64, 0.10, 0.52, 30), (0.80, -0.30, 0.34, -5), (0.92, -0.46, 0.17, -14), (1.0, -0.42, 0.11, -10)]
    foot_track(c, "L", T, [(ph, y, z, p, 4) for ph, y, z, p in table], 0.10, (0.1, -1, 0.2))
    foot_track(c, "R", T, [(ph + 0.5, y, z, p, -4) for ph, y, z, p in table], -0.10, (-0.1, -1, 0.2))
    for ph, s in ((0.0, 1), (0.25, 0), (0.5, -1), (0.75, 0), (1.0, 1)):
        up = 1 if s == 0 else 0
        c.key(ph * T, "inout", root=(0.0, -0.02, -0.07 + 0.04 * up), hips=(8, 0, -8 * s), spine=(8, 0, 4 * s), chest=(4, 0, 8 * s),
              neck=(-6, 0, -4 * s), head=(-4, 0, -3 * s))


def run():
    T = 0.62
    c = Clip("run", T, loop=True)
    stride(c, T)
    for ph, s in ((0.0, 1), (0.5, -1), (1.0, 1)):
        r = (-0.18, -0.30, 1.30) if s > 0 else (-0.22, 0.14, 1.02)
        l = (0.22, 0.14, 1.02) if s > 0 else (0.18, -0.30, 1.30)
        c.key(ph * T, "inout", ikc__hand__R=r, ikc__hand__L=l, rotc__hand__R=hand_rot("R", (0.0, -0.3, 0.95), (0.0, 0.95, 0.3)),
              rotc__hand__L=LANTERN_HANG, ikw__hand__R=(1, 0, 0), ikw__hand__L=(1, 0, 0),
              pole__hand__R=(-0.5, 0.8, -0.3), pole__hand__L=(0.5, 0.8, -0.3),
              upper_arm__L=(0, 0, 0), forearm__L=(0, 0, 0), hand__L=(0, 0, 0), upper_arm__R=(0, 0, 0), forearm__R=(0, 0, 0), hand__R=(0, 0, 0))
    return c


def run_lantern():
    T = 0.66
    c = Clip("run_lantern", T, loop=True)
    stride(c, T)
    for ph, s in ((0.0, 1), (0.5, -1), (1.0, 1)):
        r = (-0.18, -0.30, 1.30) if s > 0 else (-0.22, 0.14, 1.02)
        c.key(ph * T, "inout", ikc__hand__R=r, ikc__hand__L=(0.16, -0.40, 1.34 + 0.015 * s),
              rotc__hand__R=hand_rot("R", (0.0, -0.3, 0.95), (0.0, 0.95, 0.3)), rotc__hand__L=LANTERN_HANG,
              ikw__hand__R=(1, 0, 0), ikw__hand__L=(1, 0, 0), pole__hand__R=(-0.5, 0.8, -0.3), pole__hand__L=(0.6, 0.3, -0.6),
              upper_arm__L=(0, 0, 0), forearm__L=(0, 0, 0), hand__L=(0, 0, 0), upper_arm__R=(0, 0, 0), forearm__R=(0, 0, 0), hand__R=(0, 0, 0))
    return c


CROUCH = P({"ik.foot.L": (0.16, -0.10, FOOT_Z), "rot.foot.L": (0, 0, 14), "pole.foot.L": (0.45, -1, 0),
            "ik.foot.R": (-0.15, 0.12, FOOT_Z), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.45, -1, 0)},
           root=(0.0, 0.16, -0.52), hips=(34, 0, 0), spine=(26, 0, 0), chest=(16, 0, 0), neck=(10, 0, 0), head=(14, 0, 0),
           ik__hand__R=(-0.05, -0.12, 1.58), rot__hand__R=hand_rot("R", (0.9, 0.0, 0.3), (0.0, 0.3, -0.9)), pole__hand__R=(-0.7, 0.2, 0.3),
           ik__hand__L=(0.26, -0.28, 0.62), rot__hand__L=LANTERN_HANG, pole__hand__L=(0.6, 0.3, -0.5))


def duck():
    T = 1.2
    c = Clip("duck", T, loop=True)
    c.pose(0.0, CROUCH)
    flinch = with_(CROUCH, root=(0.0, 0.18, -0.56), spine=(30, 0, 4), chest=(20, 0, 4), head=(20, 0, 8))
    c.pose(0.2, flinch, "snap")
    c.pose(0.7, with_(CROUCH, head=(8, 0, -14), neck=(4, 0, -8)), "inout")
    c.pose(T, CROUCH, "inout")
    c.layers.append(breathe(2.2, 0.6))
    return c


def wave():
    T = 1.2
    c = Clip("wave", T, loop=True)
    stand = P({"ik.foot.L": (0.12, -0.05, FOOT_Z), "rot.foot.L": (0, 0, 10), "pole.foot.L": (0.1, -1, 0),
               "ik.foot.R": (-0.12, 0.08, FOOT_Z), "rot.foot.R": (0, 0, -14), "pole.foot.R": (-0.1, -1, 0)},
              root=(0.0, 0.0, -0.02), hips=(0, 0, -4), spine=(-2, 0, -2), chest=(-4, 0, -2), neck=(-4, 0, 0), head=(-6, 0, 0),
              ik__hand__L=(0.24, -0.22, 1.62), rot__hand__L=LANTERN_HANG, pole__hand__L=(0.7, 0.3, -0.5))
    palm = hand_rot("R", (0.0, 0.1, 1.0), (0.0, -1.0, 0.1))
    for t, x in ((0.0, -0.30), (0.3, -0.52), (0.6, -0.30), (0.9, -0.52), (1.2, -0.30)):
        pose = with_(stand, ik__hand__R=(x, -0.10, 1.98), rot__hand__R=palm, pole__hand__R=(-0.8, 0.2, -0.3),
                     chest=(-4, 0, -2 + (3 if x < -0.4 else -3)))
        c.pose(t, pose, "inout")
    c.layers.append(breathe(1.6, 0.6))
    lagged(c, head=0.04)
    return c


CLIPS = {"run": run, "run_lantern": run_lantern, "duck": duck, "wave": wave}
META = {"run": {"loop": True, "speed_mps": 5.0}, "run_lantern": {"loop": True, "speed_mps": 4.4},
        "duck": {"loop": True}, "wave": {"loop": True}}
