"""The stages of the valley build, called from art/ridge/build.py.

Each stage opens what the stage before saved (art/ridge/build/valley.blend
and the numpy caches beside it), adds its part and saves, so any stage can
be rerun alone.
"""

import math
import os
import time

import bpy
import numpy as np

from . import layout as L
from . import scene as S


class Context:
    def __init__(self, build, assets, quick=False, review_dir=None, preview=None):
        self.build, self.assets = build, assets
        self.quick = quick
        self.review_dir = review_dir or os.path.join(build, "review")
        self.preview = preview
        self.blend = os.path.join(build, "valley.blend")
        self.terrain_npz = os.path.join(build, "terrain.npz")
        self.maps = os.path.join(build, "maps")
        os.makedirs(self.review_dir, exist_ok=True)
        os.makedirs(self.maps, exist_ok=True)


def log(*a):
    print("[valley]", *a, flush=True)


def open_blend(ctx):
    bpy.ops.wm.open_mainfile(filepath=ctx.blend)
    S.setup_gpu()
    return bpy.context.scene


def save_blend(ctx):
    bpy.ops.wm.save_as_mainfile(filepath=ctx.blend, compress=True)


def load_terrain(ctx):
    from . import terrain as T
    return T.Terrain.load(ctx.terrain_npz)


# ---------------------------------------------------------------------------

def stage_terrain(ctx):
    """Heightfield (numpy) -> maps (numpy) -> terrain meshes (Blender)."""
    from . import terrain as T, landcover as LC, maps as MP, ground as GR
    t = time.time()
    if os.path.exists(ctx.terrain_npz) and os.environ.get("RIDGE_REUSE_TERRAIN"):
        ter = T.Terrain.load(ctx.terrain_npz)
        log("reusing", ctx.terrain_npz)
    else:
        ter = T.build(quick=ctx.quick)
        ter.save(ctx.terrain_npz)
    log(f"heightfield {time.time() - t:.0f}s")
    F = LC.Fields(ter)
    np.save(os.path.join(ctx.build, "flow.npy"), np.expm1(F.flow.v).astype(np.float32))
    MP.build(ter, F, ctx.maps, quick=ctx.quick)
    log(f"maps {time.time() - t:.0f}s")
    sc = S.reset_scene()
    S.setup_gpu(sc)
    root = S.collection("Valley")
    c_contract = S.collection("contract", root)
    c_ground = S.collection("ground", root)
    c_light = S.collection("lighting", root)
    c_hidden = S.collection("render_only", root)
    cam = S.player_camera(c_contract)
    sc.camera = cam
    S.build_world(sc)
    S.build_sun(c_light)
    S.sun_node(c_contract)
    troot, objs = GR.build_objects(ter, c_ground, cull=True)
    GR.shadow_caster(ter, c_hidden)
    mat = GR.review_material(ctx.maps)
    GR.assign(objs, mat)
    save_blend(ctx)
    log(f"terrain stage {time.time() - t:.0f}s")


def stage_look(ctx):
    """A quick Cycles look from the player's eye (development)."""
    sc = open_blend(ctx)
    S.render_settings(sc, 1280 if ctx.quick else 1920, 720 if ctx.quick else 1080, 32 if ctx.quick else 128)
    sc.camera = bpy.data.objects["camera.player"]
    sc.render.filepath = os.path.join(ctx.review_dir, "look_wide.png")
    s = sc.render.image_settings
    s.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    log("wrote", sc.render.filepath)
