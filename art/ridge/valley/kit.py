"""A small modelling kit for the valley's buildings: faces accumulate per
material with UVs in tile units (world metres over the material's tile
size), then become one object per (site, material) - few draw calls, and a
site's objects share a bounding box the game's frustum culling can use when
the scope looks elsewhere.

UV conventions (the tiles are authored this way, see tiles.py/btiles.py):
walls: U along the wall, V up (bedding and board grain run right); roofs:
U along the ridge, V down-to-up the slope; floors/decks: U, V = world X, Y.
"""

import math

import numpy as np

from . import scene as S
from . import btiles
from . import tiles as TL


def tile_size(mat):
    base = mat.split(":")[0]
    if base in btiles.BUILD_SPEC:
        return btiles.BUILD_SPEC[base][0]
    if base in TL.SPEC:
        return TL.SPEC[base][0]
    return 1.0


class Kit:
    def __init__(self, name):
        self.name = name
        self.parts = {}          # mat -> [V list, F list, UV list, n]

    def _get(self, mat):
        if mat not in self.parts:
            self.parts[mat] = [[], [], [], 0]
        return self.parts[mat]

    def face(self, pts, mat, uv=None, flip=False):
        """A planar polygon (3+ points). UVs default to the face's own plane:
        U horizontal, V up (or along the steepest ascent for sloped faces)."""
        P = np.asarray(pts, float)
        if flip:
            P = P[::-1]
        if uv is None:
            uv = planar_uv(P, tile_size(mat))
        rec = self._get(mat)
        base = rec[3]
        rec[0].append(P)
        rec[2].append(np.asarray(uv, float))
        n = len(P)
        rec[1].append(np.array([[base, base + i, base + i + 1] for i in range(1, n - 1)]))
        rec[3] += n

    def mesh(self, V, F, UV, mat):
        rec = self._get(mat)
        base = rec[3]
        rec[0].append(np.asarray(V, float))
        rec[1].append(np.asarray(F, np.int64) + base)
        rec[2].append(np.asarray(UV, float))
        rec[3] += len(V)

    # -- primitives -----------------------------------------------------------
    def box(self, M, lo, hi, mat, skip=(), mats=None):
        """An oriented box: M a 4x4 (numpy) placing local coordinates; faces
        named -x +x -y +y -z +z can be skipped or given their own material."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        C = {
            '-x': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
            '+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            '+y': [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            '-z': [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
            '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        }
        for k, pts in C.items():
            if k in skip:
                continue
            self.face(xf(M, pts), (mats or {}).get(k, mat))

    def cylinder(self, M, c, r, z0, z1, mat, n=16, cap=True, r1=None):
        r1 = r if r1 is None else r1
        a = np.linspace(0, 2 * np.pi, n + 1)
        circ = 2 * np.pi * r
        ts = tile_size(mat)
        for i in range(n):
            p = [(c[0] + r * math.cos(a[i]), c[1] + r * math.sin(a[i]), z0), (c[0] + r * math.cos(a[i + 1]), c[1] + r * math.sin(a[i + 1]), z0),
                 (c[0] + r1 * math.cos(a[i + 1]), c[1] + r1 * math.sin(a[i + 1]), z1), (c[0] + r1 * math.cos(a[i]), c[1] + r1 * math.sin(a[i]), z1)]
            u0, u1 = i / n * circ / ts, (i + 1) / n * circ / ts
            self.face(xf(M, p), mat, uv=[(u0, z0 / ts), (u1, z0 / ts), (u1, z1 / ts), (u0, z1 / ts)])
        if cap:
            self.face(xf(M, [(c[0] + r1 * math.cos(t), c[1] + r1 * math.sin(t), z1) for t in a[:-1]]), mat)

    def build(self, col, surfaces, extra=None):
        """One object per material: `<kit name>.<material>`."""
        objs = []
        for mat, (Vs, Fs, UVs, n) in self.parts.items():
            if not Vs:
                continue
            V = np.vstack(Vs)
            F = np.vstack(Fs)
            UV = np.vstack(UVs)
            # tile UVs relative to their own origin (precision after Draco)
            UV = UV - np.floor(UV.min(0))
            nm = f"{self.name}.{mat.replace(':', '_')}"
            ob = S.mesh_object(nm, V, F, col, uvs={"UVMap": UV}, smooth=False,
                               surface=surfaces.get(mat.split(":")[0], "stone"), material_key=mat, **(extra or {}))
            objs.append(ob)
        return objs


def xf(M, pts):
    P = np.asarray(pts, float)
    return P @ M[:3, :3].T + M[:3, 3]


def frame(c, rot, z=0.0):
    """4x4: rotate about Z by `rot` then translate to (c, z)."""
    M = np.eye(4)
    ca, sa = math.cos(rot), math.sin(rot)
    M[:3, :3] = [[ca, -sa, 0], [sa, ca, 0], [0, 0, 1]]
    M[:3, 3] = [c[0], c[1], z]
    return M


def planar_uv(P, ts):
    """U along the face's horizontal direction, V along its steepest ascent
    (world up for walls); metres over the tile size."""
    e1 = P[1] - P[0]
    nrm = np.cross(P[1] - P[0], P[-1] - P[0])
    if np.linalg.norm(nrm) < 1e-9 and len(P) > 3:
        nrm = np.cross(P[2] - P[0], P[3] - P[0])
    nrm /= np.linalg.norm(nrm) + 1e-12
    up = np.array([0.0, 0.0, 1.0])
    if abs(nrm[2]) > 0.95:                      # floor-ish: world XY
        return P[:, :2] / ts
    h = np.cross(up, nrm)
    h /= np.linalg.norm(h) + 1e-12
    v = np.cross(nrm, h)
    return np.stack([P @ h, P @ v], 1) / ts


# ---------------------------------------------------------------------------
# walls with openings

def wall(kit, M, x0, x1, z0, z1, mat, openings=(), depth=0.45, reveal_mat=None, y=0.0):
    """A wall face in local XZ at local y (outward = -Y), from x0..x1 and
    z0..z1, with rectangular openings [(xa, xb, za, zb)]. Cells around the
    openings are emitted; each opening gets reveals `depth` deep."""
    xs = sorted({x0, x1} | {o[0] for o in openings} | {o[1] for o in openings})
    zs = sorted({z0, z1} | {o[2] for o in openings} | {o[3] for o in openings})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(o[0] < cx < o[1] and o[2] < cz < o[3] for o in openings):
                continue
            pts = [(xs[i], y, zs[j]), (xs[i + 1], y, zs[j]), (xs[i + 1], y, zs[j + 1]), (xs[i], y, zs[j + 1])]
            kit.face(xf(M, pts), mat)
    rm = reveal_mat or mat
    for (xa, xb, za, zb) in openings:
        d = depth
        kit.face(xf(M, [(xa, y, za), (xa, y + d, za), (xa, y + d, zb), (xa, y, zb)]), rm)       # left jamb
        kit.face(xf(M, [(xb, y + d, za), (xb, y, za), (xb, y, zb), (xb, y + d, zb)]), rm)       # right jamb
        kit.face(xf(M, [(xa, y, zb), (xa, y + d, zb), (xb, y + d, zb), (xb, y, zb)]), rm)       # head
        kit.face(xf(M, [(xa, y + d, za), (xa, y, za), (xb, y, za), (xb, y + d, za)]), rm)       # sill


def window(kit, M, xa, xb, za, zb, depth, shutters=None, rng=None, frame_mat="timber", glass=True):
    """Inside an opening: a frame, glass set back `depth - 0.08`, and shutters
    (open against the wall, or closed)."""
    y = depth - 0.08
    t = 0.07
    kit.box(M, (xa, y - 0.02, za), (xb, y + 0.04, za + t), frame_mat)
    kit.box(M, (xa, y - 0.02, zb - t), (xb, y + 0.04, zb), frame_mat)
    kit.box(M, (xa, y - 0.02, za), (xa + t, y + 0.04, zb), frame_mat)
    kit.box(M, (xb - t, y - 0.02, za), (xb, y + 0.04, zb), frame_mat)
    xm = (xa + xb) / 2
    kit.box(M, (xm - 0.025, y - 0.01, za), (xm + 0.025, y + 0.03, zb), frame_mat)
    if glass:
        kit.face(xf(M, [(xa + t, y + 0.01, za + t), (xb - t, y + 0.01, za + t), (xb - t, y + 0.01, zb - t), (xa + t, y + 0.01, zb - t)]),
                 "glass")
    if shutters:
        w = (xb - xa) / 2
        if shutters == "open":
            for sx in (xa - w - 0.02, xb + 0.02):
                kit.box(M, (sx, -0.06, za - 0.02), (sx + w, -0.02, zb + 0.02), shutter_mat(rng))
        else:
            kit.box(M, (xa, 0.02, za), (xb, 0.07, zb), shutter_mat(rng))


_SHUTTER = ["boards", "boards", "paint:green", "paint:brown"]


def shutter_mat(rng):
    return _SHUTTER[int(rng.integers(len(_SHUTTER)))] if rng is not None else "boards"


def gable_roof(kit, M, w, d, z_eave, pitch_deg, mat, over_side=0.55, over_gable=0.45, thick=0.22, ridge_axis='y',
               fascia_mat="timber"):
    """A gable roof over a w (x) by d (y) footprint (local, centred), ridge
    along local Y by default, eaves at z_eave. Two slopes with thickness,
    verge boards and a ridge cap. Returns the ridge height."""
    if ridge_axis == 'x':
        R = np.eye(4)
        R[:3, :3] = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
        M = M @ R
        w, d = d, w
    hw = w / 2 + over_side
    hd = d / 2 + over_gable
    rise = (w / 2) * math.tan(math.radians(pitch_deg))
    zr = z_eave + rise
    ze = z_eave - over_side * math.tan(math.radians(pitch_deg))
    ts = tile_size(mat)
    L = math.hypot(hw, zr - ze)
    for sd in (-1, 1):
        # top surface (U along the ridge, V up the slope)
        pts = [(sd * hw, -hd, ze), (sd * hw, hd, ze), (0, hd, zr), (0, -hd, zr)]
        uv = [(-hd / ts, 0), (hd / ts, 0), (hd / ts, L / ts), (-hd / ts, L / ts)]
        if sd < 0:
            pts = pts[::-1]
            uv = uv[::-1]
        kit.face(xf(M, pts), mat, uv=uv)
        # underside (soffit), in timber
        pts2 = [(sd * hw, -hd, ze - thick), (0, -hd, zr - thick), (0, hd, zr - thick), (sd * hw, hd, ze - thick)]
        if sd < 0:
            pts2 = pts2[::-1]
        kit.face(xf(M, pts2), fascia_mat)
        # eave edge
        e = [(sd * hw, -hd, ze - thick), (sd * hw, hd, ze - thick), (sd * hw, hd, ze), (sd * hw, -hd, ze)]
        if sd < 0:
            e = [(p[0], -p[1], p[2]) for p in e]
        kit.face(xf(M, e), mat)
        # verge (gable edge) boards
        for gy in (-hd, hd):
            v = [(sd * hw, gy, ze - thick), (0, gy, zr - thick), (0, gy, zr), (sd * hw, gy, ze)]
            if (sd > 0) == (gy > 0):
                v = v[::-1]
            kit.face(xf(M, v), fascia_mat)
    # ridge cap
    kit.box(M, (-0.14, -hd, zr - 0.05), (0.14, hd, zr + 0.08), mat)
    return zr


def gable_wall(kit, M, w, z_eave, zr, y, mat, openings=(), depth=0.45):
    """The triangular gable above the eaves, in local XZ at y (outward -Y if
    y < 0)."""
    pts = [(-w / 2, y, z_eave), (w / 2, y, z_eave), (0, y, zr)]
    if y > 0:
        pts = pts[::-1]
    kit.face(xf(M, pts), mat)
