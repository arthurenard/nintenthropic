"""Shared plumbing for Route 9: the player's eye, the seed, and the bridge to
High Noon's library.

High Noon's town library (art/western/dustcreek) is imported read-only: its
MeshBuilder (hundreds of boards and boxes into one object, with per-board
random values and grain UVs), its node-tree DSL and its weathered wood and
metal node groups are exactly what a roadside at night needs too. Nothing
under art/western is ever written; what Route 9 needs differently (wet
materials, the night bake with its albedo and flicker layers) lives here.

Coordinates are Blender's (Z up). The player stands at the origin looking
down +Y (north, up Route 9); +X is east, the player's right. The glTF
exporter turns this into the contract's frame (Y up, looking along -Z).
"""

import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NIGHT = os.path.dirname(HERE)
ART = os.path.dirname(NIGHT)
REPO = os.path.dirname(ART)
WESTERN = os.path.join(ART, "western")
if WESTERN not in sys.path:
    sys.path.append(WESTERN)

import bpy  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402

from dustcreek import core as DC  # noqa: E402,F401  (MeshBuilder, Frame, facing_matrix, tag, empty)
from dustcreek import nodes as DN  # noqa: E402,F401  (G, new_material, new_group, group_node)

# The eye: the same lens as High Noon (the check framing is the art's own
# composition; the game closes in from here for play, never moves).
EYE_Z = 1.7
EYE = Vector((0.0, 0.0, EYE_Z))
PITCH_DEG = -1.0
VFOV_DEG = 45.0

SEED = 1957


def rng(tag):
    """A tagged random stream: stable when unrelated parts gain or lose calls."""
    return random.Random(f"{SEED}:{tag}")


def lin(r, g, b):
    """sRGB 0-255 -> linear (palettes picked from reference swatches)."""
    def c(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (c(r), c(g), c(b))


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def tag(ob, **props):
    for k, v in props.items():
        ob[k] = v
    return ob


def empty(name, loc, col, rot=None, size=0.25, display='PLAIN_AXES', **props):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot.to_euler() if isinstance(rot, Matrix) else rot
    col.objects.link(ob)
    tag(ob, **props)
    return ob


def facing(forward, up=(0, 0, 1)):
    """3x3 whose local -Y points along `forward` (glTF +Z: what a character
    placed on this node faces)."""
    return DC.facing_matrix(forward, up)


def toward_player(p):
    """Rotation that makes a node at p face the player (its glTF +Z at him)."""
    d = Vector((-p[0], -p[1], 0.0))
    if d.length < 1e-6:
        d = Vector((0, -1, 0))
    return facing(d)


def to_gltf(v):
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def cam_basis():
    p = math.radians(PITCH_DEG)
    fwd = Vector((0.0, math.cos(p), math.sin(p)))
    right = Vector((1.0, 0.0, 0.0))
    up = right.cross(fwd).normalized()
    if up.z < 0:
        up = -up
    return fwd, right, up


def viewport(p, aspect=4 / 3):
    """World point -> (x, y) viewport fractions (0,0 top-left) for the
    player camera at `aspect` (vertical fov fixed)."""
    fwd, right, up = cam_basis()
    d = Vector(p) - EYE
    z = d.dot(fwd)
    ty = math.tan(math.radians(VFOV_DEG / 2))
    tx = ty * aspect
    return 0.5 + 0.5 * d.dot(right) / z / tx, 0.5 - 0.5 * d.dot(up) / z / ty


def setup_gpu(scene=None):
    """Cycles on the Metal GPU (CPU only if there is none)."""
    DC.setup_gpu(scene)


def smooth(ob, angle=35):
    return DC.smooth(ob, angle)
