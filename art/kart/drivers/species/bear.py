"""Bramble the bear: broad and round, round ears standing clear of the helmet, a tan muzzle, a stub of a tail."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

FUR = H.lin("#7b4a2d")
FUR_PALE = H.lin("#97613c")
TAN = H.lin("#dbb58c")
NOSE = H.lin("#1d1816")


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.33, 0.295, 0.30))
    ears = S.mirror(S.ellipsoid((0.215, 0.285, -0.07), (0.105, 0.105, 0.07)))
    head = S.union(skull, ears, k=0.03)
    muzzle = S.ellipsoid((0, -0.09, 0.225), (0.15, 0.115, 0.125))

    def albedo(P, N):
        out = np.tile(FUR, (len(P), 1))
        out = S.mix(out, FUR_PALE, S.smoothstep(0.0, 0.3, P[:, 1]) * 0.4)
        return out * H.furvar(P, 0.05)

    h = Part("bear", "head", H.HEAD_AT)
    h.solid(head, (-0.46, -0.35, -0.4), (0.46, 0.48, 0.46), h=0.0095, tris=720, albedo=albedo, mat="fur", ao=0.45, reach=0.1)
    h.solid(muzzle, (-0.25, -0.3, 0.0), (0.25, 0.1, 0.42), h=0.0065, tris=210, albedo=TAN, mat="fur", ao=0.4, reach=0.06)
    for sx in (-1, 1):
        ear_in = S.ellipsoid((sx * 0.215, 0.285, -0.035), (0.065, 0.065, 0.034))
        h.solid(ear_in, (sx * 0.215 - 0.1, 0.18, -0.12), (sx * 0.215 + 0.1, 0.39, 0.06), h=0.0045, tris=50, albedo=TAN * 0.95, mat="fur", ao=0.2, reach=0.03, symmetric=False)
    nose = S.ellipsoid((0, -0.045, 0.335), (0.056, 0.04, 0.034))
    h.solid(nose, (-0.1, -0.12, 0.22), (0.1, 0.05, 0.46), h=0.0045, tris=64, albedo=NOSE, mat="gloss", ao=0.2, reach=0.03)
    face = S.union(skull, muzzle, k=0.0)
    ez = float(S.surface_point(face, [0.13], [0.065])[0, 2]) - 0.005
    H.eyes(h, 0.13, 0.065, ez, r=0.042, iris="#3a2418", turn=0.25, ring=False)
    for sx in (-1, 1):
        H.brow(h, face, sx * 0.13, 0.13, length=0.08, slant=-0.15, arch=0.012, r=0.0095, colour=FUR * 0.4)
    H.smile(h, face, half=0.055, y=-0.135, depth=0.03, r=0.0055, colour=NOSE, n=9)
    # The nose's stem down to the lip.
    pts = S.surface_point(face, np.array([0.0, 0.0]), np.array([-0.07, -0.125]))
    pts = pts + S.normals(face, pts) * -0.003
    v, nn, fc = S.tube(pts, [0.006, 0.0055], 5)
    h.mesh(v, nn, fc, "cloth", NOSE)
    parts.append(h)

    parts.append(H.helmet("bear", (0, 0.03, -0.01), (0.335, 0.31, 0.32), cut=0.07, ear_holes=S.offset(ears, 0.012)))

    def stub(part):
        part.solid(S.ellipsoid((0, 0.13, -0.31), (0.09, 0.085, 0.085)), (-0.2, 0.0, -0.5), (0.2, 0.3, -0.15), h=0.0065, tris=100, albedo=FUR, mat="fur", ao=0.3, reach=0.05)

    parts.append(H.torso("bear", w=0.34, d=0.26, shoulder=0.37, thigh=0.115, spread=0.19, shoe="#7b4a2d", shoe_mat="fur", extra=stub, belly=None))
    for side in (1, -1):
        parts.append(H.arm("bear", side, 0.37, r=0.095, fur=FUR, glove=H.WHITE, glove_mat="trim", handR=0.118))
    return parts
