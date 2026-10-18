"""Painted lettering for Route 9's signs (MILLER'S, STARLITE MOTEL, STOP,
the route shield, the barn's hex sign...).

High Noon's MaskScene renders text from the system faces into small RGB
masks (R = paint, G = shadow/outline, B = accent); here the masks become
paint on sheet metal (chipped, rust-run, rained on) or on boards.
"""

import os

import bpy

from .common import DN
from dustcreek import signs as DS

_OUT = None


def out_dir(build_dir):
    global _OUT
    _OUT = os.path.join(build_dir, "signs")
    os.makedirs(_OUT, exist_ok=True)
    DS.OUT_DIR = _OUT
    return _OUT


def mask(key, w, h, draw, px_per_m=400):
    ms = DS.MaskScene(key, w, h, px_per_m=px_per_m)
    draw(ms)
    return ms.render()


def metal_sign(key, img, bg, fill, shadow=None, accent=None, wear=0.45, rust=0.5, surface='metal'):
    """Enamel/paint on sheet steel: the lettering chips with the paint."""
    m, g = DN.new_material(f"sign_{key}")
    uv = g.uv('local')
    c = g.image(img, uv, out='Color', extension='CLIP')
    R, Gc, B = g.sep_rgb(c)
    paint = g.rgb(bg)
    if shadow is not None:
        paint = g.mix(Gc, paint, g.rgb(shadow))
    if accent is not None:
        paint = g.mix(B, paint, g.rgb(accent))
    paint = g.mix(R, paint, g.rgb(fill))
    n = DN.group_node(g, bpy.data.node_groups["R9_PaintMetal"], {
        "Paint": paint, "Wear": wear, "Rust": rust, "Grime": 0.7, "Gloss": 0.35, "Scale": 1.2, "Wet": 1.0})
    g.output(g.out(n, "BSDF"))
    m["surface"] = surface
    return m
