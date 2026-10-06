"""Juniper the otter: sleek and brown, a cream muzzle with whiskers, swim goggles pushed up, a scarf, a flat tail."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

FUR = H.lin("#8a5c3b")
FUR_PALE = H.lin("#a8774f")
CREAM = H.lin("#ecd6b4")
NOSE = H.lin("#25201f")
GLASS = H.lin("#7fd8ff")


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.29, 0.26, 0.28))
    ears = S.mirror(S.ellipsoid((0.225, 0.14, -0.06), (0.07, 0.07, 0.055)))
    head = S.union(skull, ears, k=0.025)
    muzzle = S.ellipsoid((0, -0.092, 0.2), (0.15, 0.108, 0.125))

    def albedo(P, N):
        out = np.tile(FUR, (len(P), 1))
        out = S.mix(out, FUR_PALE, S.smoothstep(0.0, 0.25, P[:, 1]) * 0.45)
        return out * H.furvar(P, 0.05)

    h = Part("otter", "head", H.HEAD_AT)
    h.solid(head, (-0.4, -0.3, -0.36), (0.4, 0.38, 0.42), h=0.0085, tris=670, albedo=albedo, mat="fur", ao=0.45, reach=0.09)
    h.solid(muzzle, (-0.25, -0.3, 0.0), (0.25, 0.1, 0.4), h=0.0065, tris=210, albedo=CREAM, mat="fur", ao=0.4, reach=0.06)
    for sx in (-1, 1):
        ear_in = S.ellipsoid((sx * 0.232, 0.14, -0.04), (0.04, 0.04, 0.026))
        h.solid(ear_in, (sx * 0.232 - 0.08, 0.06, -0.12), (sx * 0.232 + 0.08, 0.22, 0.05), h=0.004, tris=40, albedo=CREAM * 0.95, mat="fur", ao=0.2, reach=0.03, symmetric=False)
    nose = S.ellipsoid((0, -0.045, 0.305), (0.05, 0.036, 0.032))
    h.solid(nose, (-0.1, -0.12, 0.2), (0.1, 0.05, 0.42), h=0.0045, tris=60, albedo=NOSE, mat="gloss", ao=0.2, reach=0.03)
    face = S.union(skull, muzzle, k=0.0)
    ez = float(S.surface_point(face, [0.115], [0.055])[0, 2]) - 0.005
    H.eyes(h, 0.115, 0.055, ez, r=0.043, iris="#6a3d22", turn=0.25)
    for sx in (-1, 1):
        H.brow(h, face, sx * 0.115, 0.122, length=0.075, slant=0.28, arch=0.01, r=0.008, colour=FUR * 0.45)
    H.smile(h, face, half=0.07, y=-0.145, depth=0.025, r=0.0055, colour=H.lin("#4a2e20"), n=9)
    H.whiskers(h, face, 0.14, -0.088, length=0.19, count=3, spread=0.032)
    parts.append(h)

    # Swim goggles pushed up on the forehead, and their strap right round.
    gg = Part("otter", "helmet", H.HEAD_AT)
    around = lambda P: np.abs(P[:, 1] - 0.155) - 0.036
    gg.solid(H.patch(skull, around, 0.012, 0.014), (-0.4, 0.0, -0.36), (0.4, 0.3, 0.4), h=0.0075, tris=230, mat="paintcloth", ao=0.25)
    for sx in (-1, 1):
        c = np.array([sx * 0.108, 0.2, 0.2])
        ring = S.cylinder(c, 0.098, 0.034, 0.018, rot=(0, 52, 0))
        gg.solid(ring, tuple(c - 0.18), tuple(c + 0.18), h=0.0055, tris=170, mat="paint", ao=0.3, reach=0.05, symmetric=False)
        lens = S.cylinder(c + np.array([0, 0.02, 0.026]), 0.075, 0.012, 0.008, rot=(0, 52, 0))
        gg.solid(lens, tuple(c - 0.18), tuple(c + 0.18), h=0.0045, tris=70, albedo=GLASS, mat="glass", ao=0.0, reach=0.03, symmetric=False)
    parts.append(gg)

    parts.append(H.torso("otter", w=0.26, d=0.2, shoulder=0.29, shoe="#8a5c3b", shoe_mat="fur"))
    for side in (1, -1):
        parts.append(H.arm("otter", side, 0.29, r=0.07, fur=FUR, glove=CREAM, glove_mat="fur"))
    parts.append(H.scarf_tail("otter"))

    tail = Part("otter", "tail", (0.0, 0.21, -0.25))
    flat = S.union(
        S.ellipsoid((0, 0, -0.1), (0.115, 0.08, 0.17)),
        S.ellipsoid((0, 0.02, -0.28), (0.1, 0.065, 0.17)),
        S.ellipsoid((0, 0.06, -0.44), (0.075, 0.05, 0.13)),
        k=0.05,
    )
    tail.solid(flat, (-0.25, -0.2, -0.65), (0.25, 0.25, 0.1), h=0.0075, tris=230, albedo=lambda P, N: np.tile(FUR, (len(P), 1)) * H.furvar(P, 0.05), mat="fur", ao=0.4, reach=0.08)
    parts.append(tail)
    return parts
