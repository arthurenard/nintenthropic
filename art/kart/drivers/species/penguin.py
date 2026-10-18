"""Pepper the penguin: a dark back, a white heart of a face, an orange beak, flippers, a scarf and a pom-pom cap."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

DARK = H.lin("#2b3044")
DARK2 = H.lin("#3a4160")
WHITE = H.lin("#f8f9ff")
ORANGE = H.lin("#f7a22c")
ORANGE_DEEP = H.lin("#e8801a")
BLUSH = H.lin("#f59aa6")


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.3, 0.27, 0.285))

    def albedo(P, N):
        out = np.tile(DARK, (len(P), 1))
        out = S.mix(out, DARK2, S.smoothstep(0.0, 0.25, P[:, 1]) * 0.5)
        return out * H.furvar(P, 0.05)

    h = Part("penguin", "head", H.HEAD_AT)
    h.solid(skull, (-0.4, -0.35, -0.38), (0.4, 0.38, 0.42), h=0.009, tris=520, albedo=albedo, mat="fur", ao=0.45, reach=0.09)
    # The white face, cut in a heart: two lobes round the eyes and a chin; a rim of dark all round.
    mask = S.union(
        S.mirror(S.ellipsoid((0.085, 0.02, 0.1), (0.155, 0.15, 0.2))),
        S.ellipsoid((0, -0.08, 0.1), (0.19, 0.15, 0.2)),
        k=0.05,
    )
    h.solid(mask, (-0.3, -0.3, -0.05), (0.3, 0.25, 0.4), h=0.0065, tris=330, albedo=WHITE, mat="fur", ao=0.4, reach=0.07)
    # The beak: a short wedge, orange and glossy, and a darker lower half.
    beak = S.scaled(S.roundcone((0, -0.06, 0.27), (0, -0.095, 0.46), 0.078, 0.03), (1, 0.62, 1), about=(0, -0.08, 0.3))
    h.solid(beak, (-0.15, -0.25, 0.15), (0.15, 0.1, 0.6), h=0.005, tris=130, albedo=ORANGE, mat="plastic", ao=0.3, reach=0.04)
    low = S.scaled(S.roundcone((0, -0.115, 0.28), (0, -0.125, 0.4), 0.05, 0.025), (1, 0.5, 1), about=(0, -0.12, 0.3))
    h.solid(low, (-0.15, -0.25, 0.15), (0.15, 0.1, 0.6), h=0.005, tris=70, albedo=ORANGE_DEEP, mat="plastic", ao=0.3, reach=0.04)
    face_for_eyes = S.union(mask, skull, k=0.0)
    ez = float(S.surface_point(face_for_eyes, [0.1], [0.035])[0, 2]) - 0.005
    H.eyes(h, 0.1, 0.035, ez, r=0.043, iris="#5a4630", turn=0.22)
    H.blush(h, face_for_eyes, 0.175, -0.07, 0.04, 0.028, colour=BLUSH)
    for sx in (-1, 1):
        H.brow(h, face_for_eyes, sx * 0.1, 0.105, length=0.07, slant=0.2, arch=0.01, r=0.0075, colour=DARK * 0.8)
    parts.append(h)

    # The knitted cap, and its pom-pom.
    cap = H.helmet("penguin", (0, 0.05, -0.01), (0.315, 0.3, 0.31), peak=False, stripe=False, cut=0.06, tilt=0.3)
    cap.solid(S.ellipsoid((0, 0.345, -0.01), (0.078, 0.072, 0.078)), (-0.15, 0.25, -0.15), (0.15, 0.45, 0.15), h=0.005, tris=110, albedo=WHITE, mat="fur", ao=0.35, reach=0.04)
    parts.append(cap)

    # The body: a dark coat, a white belly, a scarf; a little tail of feathers.
    def chest_albedo(P, N):
        return np.tile(DARK, (len(P), 1)) * H.furvar(P, 0.05)

    def tail_feathers(part):
        tail = S.scaled(S.roundcone((0, 0.12, -0.24), (0, 0.06, -0.43), 0.08, 0.018), (1, 0.55, 1), about=(0, 0.1, -0.3))
        part.solid(tail, (-0.2, -0.05, -0.55), (0.2, 0.3, -0.1), h=0.007, tris=90, albedo=DARK, mat="fur", ao=0.3, reach=0.05)

    parts.append(
        H.torso("penguin", w=0.3, d=0.24, shoulder=0.33, thigh=0.09, shoe="#f7a22c", shoe_mat="plastic", chest="fur", chest_albedo=chest_albedo, belly=WHITE,
                belly_size=(0.78, 0.26, 0.7), collar_h=0.095, extra=tail_feathers)
    )
    for side in (1, -1):
        parts.append(H.arm("penguin", side, 0.33, r=0.07, fur=DARK, glove=DARK, glove_mat="fur", sleeve=False, handR=0.088, thumb=False, glove_ring=False, flipper=True))

    # The scarf's tail, hanging behind the shoulder and fluttering.
    parts.append(H.scarf_tail("penguin", (0.1, 0.58, -0.14)))
    return parts
