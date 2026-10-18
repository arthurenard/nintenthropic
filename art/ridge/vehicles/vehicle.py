"""What a vehicle model hands to the bake and export stages.

A model fills builders keyed by (export node, texel density): the exterior of
the cab and its interior end up in the same `body` node but are unwrapped at
different texel densities (the interior is only ever glimpsed through the
windshield). Wheels are described once (a prototype) plus where each wheel
node goes. Empties (seats, dismount points, fx) are recorded in the authoring
frame and created at export.
"""

import math

from .geo import Builder
from . import wheels as W

# faces whose material is one of these are unwrapped at a lower texel density
LOW_DENSITY = {"paint_in": 0.45, "under": 0.3, "canvas_in": 0.3, "chassis": 0.35, "seat": 0.5, "black": 0.4}


class Vehicle:
    def __init__(self, name, wheel_spec, atlas):
        self.name = name
        self.wheel_spec = wheel_spec
        self.atlas = atlas                  # atlas size in texels
        self.builders = {}                  # export name -> Builder (density 1 unless listed)
        self.glass = Builder(f"{name}.cab.glass", name)
        self.wheels = []                    # dicts: n, pos (A), side, steer, dual
        self.empties = []                   # (name, pos A, facing A (dx, dy), props)
        self.spares = []                    # (pos A, axle direction A) extra wheels joined into body
        self.info = {}                      # root extras
        self.density = {}                   # export name -> texel density weight
        self.mud = []                       # (y_A, z, r) wheel arches the mud sprays from
        # numbers the paint reads (see paint.py)
        self.shift = 0.0                    # recentring offset along authoring Y
        self.mud_top = 0.9                  # how high the mud reaches
        self.floor = 1.0                    # cab floor (interior wear)
        self.bed_floor = 1.15
        self.hem, self.shoulder, self.bows = 1.5, 9.0, []
        self.images = None

    def b(self, export, density=None):
        if export not in self.builders:
            self.builders[export] = Builder(f"{self.name}.{export}", self.name)
            self.density[export] = 1.0 if density is None else density
        return self.builders[export]

    def wheel(self, n, pos, side, steer=False, dual=0.0):
        self.wheels.append(dict(n=n, pos=pos, side=side, steer=steer, dual=dual))

    def socket(self, name, pos, facing=(0.0, 1.0), **props):
        self.empties.append((name, pos, facing, props))

    def build_objects(self, col):
        """Blender objects to bake: [(object, export name, density)]."""
        out = []
        for export, b in self.builders.items():
            groups = {}
            for m, d in LOW_DENSITY.items():
                groups.setdefault(d, set()).add(m)
            for d, mats in sorted(groups.items()):
                sub = b.extract(mats, f"{self.name}.{export}~{d}")
                if sub.F:
                    out.append((sub.build(col), export, d * self.density[export]))
            if b.F:
                ob = b.build(col)
                out.append((ob, export, self.density[export]))
        return out

    def proto(self, col):
        b = W.wheel_proto(f"{self.name}.wheelproto", self.name, self.wheel_spec)
        return b.build(col, smooth_angle=50)

    def tris(self):
        t = sum(b.tris() for b in self.builders.values()) + self.glass.tris()
        return t

    def recentre(self):
        """Shift everything along Y so the root sits under the centre of the
        vehicle's length (the contract: root at ground level under its centre)."""
        ys = [p.y for b in list(self.builders.values()) + [self.glass] for p in b.V]
        R = self.wheel_spec["R"]
        ys += [w["pos"][1] + s * R for w in self.wheels for s in (-1, 1)]
        dy = -(min(ys) + max(ys)) / 2
        for b in list(self.builders.values()) + [self.glass]:
            for p in b.V:
                p.y += dy
        sh = lambda p: (p[0], p[1] + dy, p[2])
        for w in self.wheels:
            w["pos"] = sh(w["pos"])
        self.empties = [(n, sh(p), f, pr) for n, p, f, pr in self.empties]
        self.spares = [(sh(p), a) for p, a in self.spares]
        self.mud = [(y + dy, z, r) for y, z, r in self.mud]
        self.length = max(ys) - min(ys)
        self.shift = dy
        return dy


def facing_rot(d):
    """Blender rot_z for an empty facing authoring direction d = (dx, dy):
    its local -Y (glTF +Z) points along d once the vehicle is turned to Blender."""
    dx, dy = d
    return math.atan2(-dx, dy)
