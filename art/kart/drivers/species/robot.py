"""Rivet the robot: a rounded steel body with a glowing chest lamp, headphone ears and a blinking antenna in the kart's colour."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

STEEL = H.lin("#a4b4ca")
SHADE = H.lin("#5c687c")
PALE = H.lin("#dbe3ee")
DARKFACE = H.lin("#0a1020")
GLOW = np.array([0.058, 0.383, 0.417])  # the game lights it up (x6)
RED = np.array([0.4, 0.058, 0.05])
HEAD_AT = (0.0, 0.88, 0.05)


def steel_ramp(P, N, lo=-0.1, hi=0.65):
    t = np.clip((P[:, 1] - lo) / (hi - lo), 0, 1)[:, None]
    return STEEL * 0.62 * (1 - t) + PALE * t


def build():
    parts = []
    # ---- the head: a rounded box, a dark face with glowing eyes, headphones and a flat cap
    shell = S.box((0, 0.02, 0), (0.25, 0.2, 0.23), 0.09)
    stem = S.roundcone((0, 0.3, -0.04), (0, 0.45, -0.06), 0.016, 0.012)
    h = Part("robot", "head", HEAD_AT)
    h.solid(S.union(shell, stem, k=0.01), (-0.4, -0.3, -0.36), (0.4, 0.55, 0.36), h=0.0085, tris=520, albedo=lambda P, N: steel_ramp(P, N, -0.2, 0.3), mat="steel", ao=0.45, reach=0.08)
    plate = S.box((0, 0.0, 0.225), (0.2, 0.13, 0.02), 0.02)
    h.solid(plate, (-0.3, -0.2, 0.1), (0.3, 0.2, 0.34), h=0.005, tris=90, albedo=DARKFACE, mat="gloss", ao=0.1, reach=0.04)
    for sx in (-1, 1):
        eye = S.box((sx * 0.1, 0.03, 0.245), (0.05, 0.042, 0.012), 0.012)
        h.solid(eye, (sx * 0.1 - 0.1, -0.05, 0.2), (sx * 0.1 + 0.1, 0.12, 0.3), h=0.004, tris=60, albedo=GLOW, mat="glow", ao=0.0, reach=0.02, symmetric=False)
    # The mouth (a row of lit dots) is drawn live by the game (src/kart/render/drivers/expression.ts).
    # The cap, a brim and the headphones: the kart's colour.
    cap = Part("robot", "helmet", HEAD_AT)
    flat = S.intersect(S.ellipsoid((0, 0.17, -0.01), (0.285, 0.15, 0.27)), lambda P: 0.15 - P[:, 1], 0.012)
    cap.solid(flat, (-0.4, 0.05, -0.34), (0.4, 0.4, 0.34), h=0.0075, tris=300, mat="paint", ao=0.3, reach=0.06)
    brim = S.box((0, 0.165, 0.235), (0.2, 0.024, 0.07), 0.02, rot=(0, 8, 0))
    cap.solid(brim, (-0.3, 0.05, 0.1), (0.3, 0.3, 0.4), h=0.0055, tris=110, mat="paint", ao=0.2, reach=0.04)
    for sx in (-1, 1):
        ph = S.cylinder((sx * 0.285, 0.0, 0.0), 0.11, 0.04, 0.02, rot=(0, 0, 90))
        cap.solid(ph, (sx * 0.285 - 0.12, -0.15, -0.15), (sx * 0.285 + 0.12, 0.15, 0.15), h=0.005, tris=150, mat="paint", ao=0.3, reach=0.05, symmetric=False)
        cup = S.cylinder((sx * 0.335, 0.0, 0.0), 0.062, 0.022, 0.012, rot=(0, 0, 90))
        cap.solid(cup, (sx * 0.335 - 0.1, -0.1, -0.1), (sx * 0.335 + 0.1, 0.1, 0.1), h=0.004, tris=70, albedo=SHADE, mat="steel", ao=0.2, reach=0.03, symmetric=False)
    parts += [h, cap]

    # ---- the body
    t = Part("robot", "torso")
    hips = S.box((0, 0.1, -0.02), (0.25, 0.1, 0.2), 0.05)
    chest = S.union(S.box((0, 0.35, 0), (0.3, 0.25, 0.2), 0.08), S.cylinder((0, 0.62, 0.0), 0.1, 0.09, 0.03), k=0.03)
    thighs = S.mirror(S.roundcone((0.15, 0.045, 0.0), (0.19, 0.0, 0.4), 0.085, 0.085))
    t.solid(S.union(hips, thighs, k=0.03), (-0.45, -0.12, -0.35), (0.45, 0.3, 0.6), h=0.0095, tris=300, albedo=lambda P, N: SHADE * 0.9 + (STEEL - SHADE) * np.clip(P[:, 2] * 0.6, 0, 1)[:, None], mat="steel", ao=0.5)
    t.solid(chest, (-0.45, 0.0, -0.35), (0.45, 0.75, 0.35), h=0.0095, tris=420, albedo=lambda P, N: steel_ramp(P, N, 0.1, 0.65), mat="steel", ao=0.45)
    plate = H.patch(chest, lambda P: np.maximum(np.abs(P[:, 0]) - 0.22, np.maximum(np.abs(P[:, 1] - 0.37) - 0.15, -(P[:, 2] + 0.1))), 0.016, 0.014)
    t.solid(plate, (-0.4, 0.15, -0.35), (0.4, 0.6, 0.0), h=0.0075, tris=120, mat="paint", ao=0.25)
    lamp = S.cylinder((0, 0.4, 0.2), 0.085, 0.03, 0.01, rot=(90, 0, 0))
    t.solid(lamp, (-0.2, 0.25, 0.1), (0.2, 0.55, 0.35), h=0.0045, tris=70, albedo=GLOW, mat="glow", ao=0.0, reach=0.02)
    for sy in (0.25, 0.3):
        slot = S.box((0, sy, 0.2), (0.13, 0.01, 0.01), 0.005)
        t.solid(slot, (-0.2, sy - 0.05, 0.1), (0.2, sy + 0.05, 0.3), h=0.003, tris=30, albedo=DARKFACE, mat="gloss", ao=0.0, reach=0.02)
    tank = S.mirror(S.cylinder((0.13, 0.4, -0.3), 0.075, 0.17, 0.03))
    t.solid(tank, (-0.3, 0.1, -0.5), (0.3, 0.75, -0.1), h=0.0065, tris=170, albedo=STEEL, mat="steel", ao=0.4, reach=0.05)
    cap_t = S.mirror(S.cylinder((0.13, 0.58, -0.3), 0.083, 0.04, 0.02))
    t.solid(cap_t, (-0.3, 0.45, -0.5), (0.3, 0.75, -0.1), h=0.0055, tris=100, mat="paint", ao=0.3, reach=0.04)
    balls = S.mirror(S.sphere((0.335, 0.47, 0.02), 0.105))
    t.solid(balls, (-0.5, 0.3, -0.15), (0.5, 0.65, 0.2), h=0.0065, tris=130, albedo=SHADE, mat="steel", ao=0.4, reach=0.05)
    shoes = S.mirror(S.box((0.19, -0.005, 0.47), (0.075, 0.065, 0.1), 0.03))
    t.solid(shoes, (-0.35, -0.12, 0.3), (0.35, 0.12, 0.65), h=0.0065, tris=110, albedo=SHADE, mat="steel", ao=0.4, reach=0.05)
    parts.append(t)

    for side in (1, -1):
        parts.append(H.arm("robot", side, 0.35, r=0.065, fur=PALE * 0.85, glove=SHADE * 1.3, glove_mat="plastic", sleeve=False, handR=0.1, arm_mat="plastic"))

    bulb = Part("robot", "bulb", (0.0, 0.47, -0.06))
    bulb.solid(S.sphere((0, 0, 0), 0.05), (-0.1, -0.1, -0.1), (0.1, 0.1, 0.1), h=0.0045, tris=90, albedo=RED, mat="glow", ao=0.0, reach=0.02)
    parts.append(bulb)
    return parts
