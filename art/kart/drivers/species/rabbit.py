"""Bun the rabbit: long ears through the helmet, round cheeks, a little buck tooth, a pom-pom tail."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

FUR = H.lin("#f3ede6")
CHEEK = H.lin("#fffaf4")
PINK = H.lin("#f2a2b6")
SHADE = H.lin("#d8cfc6")


def ear_shape():
    base, tip = (0.125, 0.18, -0.09), (0.215, 0.72, -0.2)
    cone = S.roundcone(base, tip, 0.078, 0.052)
    return S.scaled(cone, (1, 1, 0.6), about=(0.17, 0.45, -0.145))


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.29, 0.265, 0.28))
    cheeks = S.mirror(S.ellipsoid((0.125, -0.085, 0.175), (0.115, 0.1, 0.105)))
    muzzle = S.ellipsoid((0, -0.07, 0.22), (0.09, 0.07, 0.085))
    face = S.union(skull, cheeks, muzzle, k=0.04)
    ears = S.mirror(ear_shape())
    head = S.union(face, ears, k=0.03)

    def albedo(P, N):
        out = np.tile(FUR, (len(P), 1))
        out = S.mix(out, SHADE, S.smoothstep(0.2, 0.0, -P[:, 1] + 0.15) * 0.0)
        out = S.mix(out, CHEEK, S.inside(S.union(cheeks, muzzle, k=0.03), 0.05)(P) * 0.9)
        return out * H.furvar(P, 0.035)

    h = Part("rabbit", "head", H.HEAD_AT)
    h.solid(head, (-0.46, -0.28, -0.42), (0.46, 0.84, 0.5), h=0.0085, tris=860, albedo=albedo, mat="fur", ao=0.45, reach=0.09)
    inner = S.mirror(S.scaled(S.roundcone((0.14, 0.26, -0.065), (0.2, 0.66, -0.17), 0.05, 0.034), (1, 1, 0.5), about=(0.17, 0.45, -0.12)))
    h.solid(inner, (-0.4, 0.1, -0.3), (0.4, 0.8, 0.1), h=0.005, tris=90, albedo=PINK, mat="fur", ao=0.3, reach=0.04)
    nose = S.ellipsoid((0, -0.045, 0.298), (0.036, 0.028, 0.026))
    h.solid(nose, (-0.1, -0.12, 0.2), (0.1, 0.05, 0.4), h=0.004, tris=50, albedo=PINK * 0.9, mat="gloss", ao=0.2, reach=0.03)
    tooth = S.box((0, -0.122, 0.268), (0.021, 0.034, 0.009), 0.008, rot=(0, 0, 0))
    h.solid(tooth, (-0.1, -0.2, 0.2), (0.1, -0.04, 0.35), h=0.004, tris=44, albedo=H.WHITE, mat="trim", ao=0.2, reach=0.03)
    ez = float(S.surface_point(face, [0.115], [0.05])[0, 2]) - 0.005
    H.eyes(h, 0.115, 0.05, ez, r=0.045, iris="#7a3f35", turn=0.26)
    H.blush(h, face, 0.19, -0.06, 0.05, 0.034, colour=PINK * 1.05)
    for sx in (-1, 1):
        H.brow(h, head, sx * 0.115, 0.118, length=0.07, slant=0.25, arch=0.01, r=0.0075, colour=H.lin("#8c7468"))
    H.smile(h, face, half=0.045, y=-0.098, depth=0.016, r=0.0052, colour=H.lin("#8a5a55"), n=7)
    parts.append(h)

    parts.append(H.helmet("rabbit", (0, 0.045, -0.01), (0.315, 0.29, 0.31), ear_holes=S.offset(ears, 0.014)))
    parts.append(H.torso("rabbit", w=0.24, d=0.19, shoulder=0.27, belly=None, shoe="#fffaf4", shoe_mat="fur"))
    for side in (1, -1):
        parts.append(H.arm("rabbit", side, 0.27, r=0.068, fur=FUR, glove=H.WHITE, glove_mat="trim"))

    t = Part("rabbit", "tail", (0.0, 0.14, -0.3))
    pom = S.union(S.ellipsoid((0, 0, 0), (0.13, 0.12, 0.12)), S.ellipsoid((0.05, 0.04, -0.05), (0.07, 0.07, 0.07)), S.ellipsoid((-0.05, 0.03, -0.05), (0.07, 0.07, 0.07)), k=0.04)
    t.solid(pom, (-0.25, -0.2, -0.25), (0.25, 0.22, 0.2), h=0.0065, tris=170, albedo=CHEEK, mat="fur", ao=0.4, reach=0.07)
    parts.append(t)
    return parts
