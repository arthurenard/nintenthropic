"""Dabble the rubber duck: round and yellow, an orange bill, a swim-cap helmet and a perky tail."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

YELLOW = H.lin("#ffd83a")
PALE = H.lin("#ffeb91")
BILL = H.lin("#ff9626")
BILL_LOW = H.lin("#f2791c")
BLUSH = H.lin("#ffa86b")
INK = H.lin("#3a2410")


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.315, 0.285, 0.30))

    def albedo(P, N):
        out = np.tile(YELLOW, (len(P), 1))
        out = S.mix(out, PALE, S.smoothstep(0.0, -0.2, P[:, 1]) * 0.55)
        return out * H.furvar(P, 0.035)

    h = Part("duck", "head", H.HEAD_AT)
    h.solid(skull, (-0.42, -0.36, -0.4), (0.42, 0.4, 0.44), h=0.009, tris=640, albedo=albedo, mat="fur", ao=0.45, reach=0.09)
    # The bill: a broad flat upper half, a smaller lower, two nostrils.
    upper = S.scaled(S.union(S.ellipsoid((0, -0.062, 0.318), (0.145, 0.058, 0.118)), S.ellipsoid((0, -0.058, 0.27), (0.13, 0.06, 0.1)), k=0.03), (1, 1, 1))
    h.solid(upper, (-0.25, -0.2, 0.1), (0.25, 0.1, 0.5), h=0.0055, tris=190, albedo=BILL, mat="plastic", ao=0.3, reach=0.05)
    lower = S.ellipsoid((0, -0.118, 0.3), (0.112, 0.034, 0.09))
    h.solid(lower, (-0.25, -0.25, 0.1), (0.25, 0.05, 0.5), h=0.005, tris=90, albedo=BILL_LOW, mat="plastic", ao=0.3, reach=0.04)
    for sx in (-1, 1):
        h.solid(S.ellipsoid((sx * 0.045, -0.04, 0.418), (0.016, 0.011, 0.012)), (sx * 0.045 - 0.05, -0.1, 0.34), (sx * 0.045 + 0.05, 0.02, 0.48), h=0.003, tris=26, albedo=INK, mat="gloss", ao=0.1, reach=0.02, symmetric=False)
    ez = float(S.surface_point(skull, [0.125], [0.075])[0, 2]) - 0.005
    H.eyes(h, 0.125, 0.075, ez, r=0.047, iris="#3a2410", turn=0.24, ring=False)
    H.blush(h, skull, 0.205, -0.07, 0.052, 0.036, colour=BLUSH)
    for sx in (-1, 1):
        H.brow(h, skull, sx * 0.125, 0.14, length=0.075, slant=0.3, arch=0.012, r=0.008, colour=YELLOW * 0.45)
    parts.append(h)

    # A swim cap with its ridge and a bobble.
    cap = H.helmet("duck", (0, 0.05, -0.01), (0.33, 0.30, 0.315), peak=False, cut=0.06, tilt=0.32)
    cap.solid(S.ellipsoid((0, 0.345, -0.01), (0.048, 0.043, 0.048)), (-0.15, 0.25, -0.15), (0.15, 0.45, 0.15), h=0.004, tris=80, albedo=H.WHITE, mat="trim", ao=0.2, reach=0.04)
    parts.append(cap)

    def chest_albedo(P, N):
        return np.tile(YELLOW, (len(P), 1)) * H.furvar(P, 0.035)

    parts.append(H.torso("duck", w=0.3, d=0.23, shoulder=0.33, thigh=0.09, shoe="#ff9626", shoe_mat="plastic", chest="fur", chest_albedo=chest_albedo, belly=PALE,
                         belly_size=(0.74, 0.25, 0.66)))
    for side in (1, -1):
        parts.append(H.arm("duck", side, 0.33, r=0.072, fur=YELLOW, glove=YELLOW, glove_mat="fur", sleeve=False, handR=0.09, thumb=False, glove_ring=False, flipper=True))

    tail = Part("duck", "tail", (0.0, 0.12, -0.24))
    perk = S.union(S.ellipsoid((0, 0.02, -0.1), (0.1, 0.07, 0.14), rot=(-23, 0, 0)), S.ellipsoid((0, 0.11, -0.19), (0.065, 0.065, 0.09), rot=(-40, 0, 0)), k=0.04)
    tail.solid(perk, (-0.2, -0.15, -0.4), (0.2, 0.3, 0.1), h=0.0065, tris=150, albedo=lambda P, N: np.where((P[:, 1] > 0.05)[:, None], PALE, YELLOW) * H.furvar(P, 0.03), mat="fur", ao=0.35, reach=0.06)
    parts.append(tail)
    return parts
