"""Moss the frog: eyes on bumps inside big goggles, a wide grin, a throat that puffs, a green skin."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

SKIN = H.lin("#74c64a")
SKIN_DEEP = H.lin("#58ab3a")
BELLY = H.lin("#e6f6b4")
SPOT = H.lin("#4b9a38")
PINKS = H.lin("#f59aa0")
MOUTH = H.lin("#2f3a22")


def build():
    parts = []
    base = S.ellipsoid((0, -0.04, 0), (0.335, 0.2, 0.28))
    bumps = S.mirror(S.ellipsoid((0.15, 0.15, 0.075), (0.118, 0.108, 0.118)))
    brow = S.ellipsoid((0, 0.05, 0.05), (0.27, 0.12, 0.2))
    head = S.union(base, bumps, k=0.05)
    spots = S.union(S.mirror(S.ellipsoid((0.2, 0.0, 0.0), (0.05, 0.04, 0.06))), S.ellipsoid((0, 0.15, -0.12), (0.05, 0.04, 0.05)), k=0.02)

    def albedo(P, N):
        out = np.tile(SKIN, (len(P), 1))
        out = S.mix(out, SKIN_DEEP, S.smoothstep(0.05, 0.22, P[:, 1] + 0.0 * N[:, 1]) * 0.35)
        out = S.mix(out, BELLY, S.smoothstep(-0.1, -0.2, P[:, 1]) * S.smoothstep(0.0, 0.2, P[:, 2]) * 0.6)
        out = S.mix(out, SPOT, S.inside(spots, 0.025)(P) * 0.7)
        return out * H.furvar(P, 0.04)

    h = Part("frog", "head", H.HEAD_AT)
    h.solid(head, (-0.46, -0.3, -0.36), (0.46, 0.34, 0.42), h=0.0085, tris=980, albedo=albedo, mat="fur", ao=0.45, reach=0.09)
    # The eyes sit on their bumps, in front.
    ez = float(S.surface_point(head, [0.15], [0.168])[0, 2]) - 0.004
    H.eyes(h, 0.15, 0.168, ez, r=0.056, iris="#e0a020", turn=0.2, squash=(1.0, 1.15, 0.8))
    # The wide grin and a blush each side.
    H.smile(h, base, half=0.16, y=-0.095, depth=0.04, r=0.0062, colour=MOUTH, n=13, curl=0.02)
    H.blush(h, base, 0.215, -0.06, 0.05, 0.034, colour=PINKS)
    for sx in (-1, 1):
        nos = S.ellipsoid((sx * 0.04, -0.012, 0.268), (0.016, 0.011, 0.012))
        h.solid(nos, (sx * 0.04 - 0.05, -0.06, 0.2), (sx * 0.04 + 0.05, 0.04, 0.34), h=0.003, tris=28, albedo=SPOT * 0.5, mat="gloss", ao=0.1, reach=0.02, symmetric=False)
    parts.append(h)

    # Goggles round the eyes, a strap right round the head and one over the crown: the kart's colour.
    gg = Part("frog", "helmet", H.HEAD_AT)
    for sx in (-1, 1):
        ring = S.torus((sx * 0.15, 0.168, 0.158), 0.128, 0.034, rot=(0, 90, 0))
        gg.solid(ring, (sx * 0.15 - 0.22, 0.168 - 0.2, 0.158 - 0.2), (sx * 0.15 + 0.22, 0.168 + 0.2, 0.158 + 0.2), h=0.0055, tris=230, mat="paint", ao=0.3, reach=0.05, symmetric=False)
    around = lambda P: np.abs(P[:, 1] - 0.075) - 0.034
    gg.solid(H.patch(head, around, 0.012, 0.014), (-0.46, -0.1, -0.36), (0.46, 0.25, 0.42), h=0.008, tris=240, mat="paintcloth", ao=0.25)
    over = lambda P: np.maximum(np.abs(P[:, 0]) - 0.036, 0.14 - P[:, 1])
    gg.solid(H.patch(head, over, 0.012, 0.012), (-0.2, 0.0, -0.36), (0.2, 0.34, 0.2), h=0.007, tris=110, mat="paintcloth", ao=0.25)
    parts.append(gg)

    def legs_extra(part):
        for sx in (-1, 1):
            spot = S.ellipsoid((sx * 0.15, 0.55, -0.12), (0.05, 0.03, 0.05))
            part.solid(spot, (sx * 0.15 - 0.1, 0.45, -0.25), (sx * 0.15 + 0.1, 0.65, 0.0), h=0.005, tris=36, albedo=SPOT, mat="fur", ao=0.1, reach=0.03, symmetric=False)

    parts.append(H.torso("frog", w=0.27, d=0.2, shoulder=0.3, thigh=0.1, spread=0.17, pants=SKIN, shoe="#74c64a", shoe_mat="fur", extra=legs_extra))
    for side in (1, -1):
        parts.append(H.arm("frog", side, 0.3, r=0.075, fur=SKIN, glove=SKIN, glove_mat="fur", handR=0.105, glove_ring=False))

    sac = Part("frog", "sac", (0.0, -0.2, 0.13))
    sac.solid(S.ellipsoid((0, 0, 0), (0.12, 0.075, 0.1)), (-0.2, -0.15, -0.15), (0.2, 0.15, 0.15), h=0.0065, tris=130, albedo=BELLY, mat="fur", ao=0.4, reach=0.05)
    parts.append(sac)
    return parts
