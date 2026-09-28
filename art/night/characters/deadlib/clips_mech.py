"""The Mechanic's own clips (he plays every walker clip too).

    roar      he stops, fills his chest, spreads his arms and bellows at the player
    mask_off  the second hit tears the mask away (the game lets it fly at 0.06 s):
              his head wrenches round, a hand comes up to his face, he shakes
              it off and glares
    swing     the tyre iron: up over his right shoulder, a step in, brought
              down across the barricade (impact at 0.62 s), the follow-through

Same conventions as clips_dead (armature axes: x his left, y back, z up).
"""

from charlib.anim import Clip, hand_rot
from charlib.clips_bandit import P
from .clips_dead import STAND, with_, lagged, FOOT_Z, LEAN

IRON_UP = hand_rot("R", (0.2, 0.4, 0.9), (0.0, 0.9, -0.4))       # shaft up behind the shoulder
IRON_DOWN = hand_rot("R", (0.5, -0.7, -0.5), (0.0, -0.6, 0.8))   # shaft across and down
IRON_HOLD = hand_rot("R", (0.0, -0.3, 0.95), (0.0, 0.95, 0.3))   # held upright by his side


def roar():
    T = 2.2
    c = Clip("roar", T)
    wide = with_(STAND, root=(0.0, 0.05, -0.06), hips=(-2, 0, 0), spine=(-8, 0, 0), chest=(-14, 0, 0), neck=(-14, 0, 0), head=(-24, 0, 0),
                 upper_arm__L=(-30, 70, 20), forearm__L=(-40, 0, 0), hand__L=(0, 20, 0),
                 upper_arm__R=(-30, -70, -20), forearm__R=(-40, 0, 0), hand__R=(0, -20, 0))
    at = with_(wide, root=(0.0, -0.06, -0.12), hips=(14, 0, 0), spine=(12, 0, 0), chest=(8, 0, 0), neck=(-16, 0, 0), head=(-18, 0, 0),
               upper_arm__L=(-40, 60, 30), forearm__L=(-55, 0, 0), upper_arm__R=(-40, -60, -30), forearm__R=(-55, 0, 0))
    c.pose(0.0, STAND)
    c.pose(0.45, wide, "inout")
    c.pose(0.8, at, "back")
    shake = with_(at, head=(-18, 0, 6), chest=(8, 0, 3))
    c.pose(1.1, shake, "inout")
    c.pose(1.35, with_(at, head=(-18, 0, -6), chest=(8, 0, -3)), "inout")
    c.pose(1.6, at, "inout")
    c.pose(T, STAND, "inout")
    lagged(c, head=0.05, neck=0.03, upper_arm__L=0.06, upper_arm__R=0.06)
    return c


def mask_off():
    T = 1.1
    c = Clip("mask_off", T)
    c.pose(0.0, STAND)
    wrench = with_(STAND, root=(0.0, 0.05, -0.04), chest=(-8, 4, -14), neck=(-18, 10, -24), head=(-26, 14, -34),
                   upper_arm__L=(-20, 50, 10), upper_arm__R=(-10, -50, -10))
    hand = with_(wrench, chest=(4, 2, -6), neck=(8, 4, -10), head=(14, 8, -12),
                 ik__hand__L=(0.08, -0.22, 1.62), rot__hand__L=hand_rot("L", (-0.3, -0.2, 0.9), (0.0, -1.0, 0.0)),
                 pole__hand__L=(0.7, 0.3, -0.5))
    glare = with_(STAND, root=(0.0, 0.0, -0.08), hips=(12, 0, 0), spine=(8, 0, 0), chest=(4, 0, 0), neck=(-10, 0, 0), head=(-8, 0, 0))
    c.pose(0.06, wrench, "snap")
    c.pose(0.38, hand, "inout")
    c.pose(0.62, with_(hand, head=(10, 8, 12), neck=(6, 4, 8)), "inout")
    c.pose(T, glare, "inout")
    lagged(c, upper_arm__L=0.05)
    return c


def swing():
    T = 1.3
    c = Clip("swing", T)
    ready = with_(LEAN, root=(0.0, 0.0, -0.06), hips=(16, 0, 6), spine=(10, 0, 8), chest=(4, 0, 10),
                  ik__hand__R=(-0.30, -0.20, 1.10), rot__hand__R=IRON_HOLD, pole__hand__R=(-0.8, 0.2, -0.4))
    wind = with_(ready, root=(0.02, 0.08, -0.06), hips=(4, -4, 22), spine=(-4, -4, 18), chest=(-10, -6, 24), neck=(-4, 0, -20), head=(-6, 0, -18),
                 ik__hand__R=(-0.30, 0.10, 1.92), rot__hand__R=IRON_UP, pole__hand__R=(-0.9, 0.3, 0.2),
                 ik__hand__L=(0.28, -0.30, 1.30), rot__hand__L=hand_rot("L", (-0.1, -0.9, 0.3), (0, 0.3, 0.9)), pole__hand__L=(0.6, 0.3, -0.5))
    wind["ik.foot.R"] = (-0.15, 0.22, FOOT_Z)
    strike = with_(ready, root=(0.0, -0.18, -0.16), hips=(30, 2, -16), spine=(22, 2, -14), chest=(16, 4, -20), neck=(-10, 0, 14), head=(-12, 0, 12),
                   ik__hand__R=(0.05, -0.72, 0.95), rot__hand__R=IRON_DOWN, pole__hand__R=(-0.6, 0.6, -0.2),
                   ik__hand__L=(0.30, -0.10, 1.05), rot__hand__L=hand_rot("L", (-0.1, -0.9, 0.3), (0, 0.3, 0.9)), pole__hand__L=(0.6, 0.3, -0.5))
    strike["ik.foot.L"] = (0.14, -0.30, FOOT_Z)
    through = with_(strike, root=(0.0, -0.14, -0.18), chest=(20, 4, -30), ik__hand__R=(0.34, -0.42, 0.70), pole__hand__R=(-0.3, 0.8, -0.2))
    c.pose(0.0, ready)
    c.pose(0.38, wind, "inout")
    c.pose(0.62, strike, "in")
    c.pose(0.8, through, "out")
    c.pose(T, ready, "inout")
    lagged(c, head=0.03, neck=0.02)
    return c


CLIPS = {"roar": roar, "mask_off": mask_off, "swing": swing}
META = {"roar": {}, "mask_off": {"mask_free_s": 0.06}, "swing": {"impact_s": 0.62}}
