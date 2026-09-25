"""The asset contract with the game: named nodes and their extras.

See docs/WEB_ARCHITECTURE.md, "Asset contract: High Noon". Everything here is
an empty or a small mesh whose *name and custom properties* are the
interface: camera.player, sun, cover.<id>(.hidden), calib.<n>, secret.*,
glass.<id>, path.chicken.<n>, path.tumbleweed.<n>, ground.shadow.
"""

import math

import bpy
from mathutils import Vector, Matrix

from .core import empty, tag, facing_matrix, axis_matrix, MeshBuilder, Frame
from . import glass as GL
from . import lighting


def build(lib, col, blds, lm):
    # glass panes from every building and the church
    entries = []
    groups = {}
    for b in blds.values():
        for gid, f, rects in b.glass:
            entries.append((gid, f, rects))
            groups[gid] = b.group
    for gid, f, rects in lm['church'][2]:
        entries.append((gid, f, rects))
        groups[gid] = 'far'
    GL.build_panes(lib, col, entries, lambda gid: groups.get(gid, 'far'))
