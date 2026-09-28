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
    mat = GR.review_material(ctx.maps, os.path.join(ctx.build, "tiles"))
    GR.assign(objs, mat)
    save_blend(ctx)
    log(f"terrain stage {time.time() - t:.0f}s")


def scope_camera(name, target, zoom=6.0):
    """A camera at the eye aimed at `target` (x, y, z) with the scope's field
    of view (the wide view's divided by the zoom)."""
    from mathutils import Vector
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(L.VFOV_DEG / zoom)
    cd.clip_start = 0.5
    cd.clip_end = 20000.0
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = Vector(target).to_track_quat('-Z', 'Y').to_euler()
    return cam


def stage_look(ctx):
    """Quick Cycles looks from the player's eye (development)."""
    sc = open_blend(ctx)
    S.apply_lighting(sc)
    views = [("look_wide", bpy.data.objects["camera.player"], 1280 if ctx.quick else 1920)]
    for nm, p in (("look_scope_bridge", (*L.BRIDGE_C, -57.0)), ("look_scope_village", (*L.CHAPEL_C, -48.0)),
                  ("look_scope_farm", (*L.FARM_C, -52.0)), ("look_scope_checkpoint", (*L.CHECKPOINT_C, -56.0)),
                  ("look_scope_dam", (*L.DAM_CREST_C, -22.0))):
        views.append((nm, scope_camera(nm, p), 960 if ctx.quick else 1920))
    for nm, cam, w in views:
        if ctx.preview and ctx.preview not in nm:
            continue
        S.render_settings(sc, w, int(w * 9 / 16), 24 if ctx.quick else 96)
        sc.camera = cam
        from . import post
        post.render_with_fog(sc, os.path.join(ctx.review_dir, nm + ".png"))
        log("wrote", nm)


def stage_materials(ctx):
    """The tileable ground materials (valley/tiles.py), rendered in Cycles."""
    from . import tiles
    only = ctx.preview.split(",") if ctx.preview else None
    tiles.build_all(os.path.join(ctx.build, "tiles"), quick=ctx.quick, only=only)


def stage_impostors(ctx):
    """Render the trees' impostor atlases (part of the forest stage)."""
    from . import trees
    trees.render_impostors(os.path.join(ctx.build, "impostors"), quick=ctx.quick)


def stage_forest(ctx):
    """Impostor atlases (trees.py), then where every tree stands (forest.py);
    the review meshes go into the blend."""
    from . import trees, forest as FO, landcover as LC
    t = time.time()
    imp = os.path.join(ctx.build, "impostors")
    if not os.path.exists(os.path.join(imp, "impostors.json")) or not os.environ.get("RIDGE_REUSE_IMPOSTORS"):
        trees.render_impostors(imp, quick=ctx.quick)
    log(f"impostors {time.time() - t:.0f}s")
    ter = load_terrain(ctx)
    F = LC.Fields(ter)
    inst = FO.place(ter, F, quick=ctx.quick)
    FO.save(os.path.join(ctx.build, "forest.npz"), inst)
    sc = open_blend(ctx)
    col = S.collection("forest_review", bpy.data.collections["Valley"])
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    FO.build_review_objects(inst, imp, col)
    save_blend(ctx)
    log(f"forest stage {time.time() - t:.0f}s")


def stage_buildings(ctx):
    """The village and chapel, the farm, the checkpoint, the bridge, the dam."""
    from . import buildings as B, bmats
    t = time.time()
    ter = load_terrain(ctx)
    sc = open_blend(ctx)
    root = bpy.data.collections["Valley"]
    col = S.collection("buildings", root)
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    objs = []
    info = {}
    for name, fn in B._sites():
        o, i = fn(ter, col)
        objs += o
        info[name] = i
        log(f"  {name}: {len(o)} objects, {sum(len(x.data.polygons) for x in o if x.type == 'MESH'):,} faces")
    bmats.assign(objs, os.path.join(ctx.build, "tiles"))
    import json
    sc["buildings_info"] = json.dumps(B.jsonable(info))
    save_blend(ctx)
    log(f"buildings stage {time.time() - t:.0f}s")


def stage_water(ctx):
    """River, reservoir, mist ribbons, and the roads' surfaces."""
    from . import water as W, bmats
    ter = load_terrain(ctx)
    sc = open_blend(ctx)
    root = bpy.data.collections["Valley"]
    col = S.collection("water", root)
    rcol = S.collection("roads", root)
    for c in (col, rcol):
        for o in list(c.objects):
            bpy.data.objects.remove(o)
    wm = W.water_material()
    river = W.build_river(col)
    res = W.build_reservoir(ter, col)
    for o in (river, res):
        o.data.materials.append(wm)
    for o in W.build_mist(col):
        o.hide_render = True            # the renders' mist is the post pass (post.py)
    roads = W.build_roads(ter, rcol)
    bmats.assign(roads, os.path.join(ctx.build, "tiles"))
    save_blend(ctx)
    log("water and roads built")


def stage_contract(ctx):
    """The contract's named nodes (valley/contract.py)."""
    from . import contract as C, bmats
    import json
    ter = load_terrain(ctx)
    sc = open_blend(ctx)
    col = bpy.data.collections["contract"]
    keep = ("camera.player", "sun")
    for o in list(col.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    binfo = json.loads(sc.get("buildings_info", "{}"))
    C.build(ter, col, binfo)
    bmats.assign([o for o in col.objects if o.type == 'MESH'], os.path.join(ctx.build, "tiles"))
    save_blend(ctx)


def stage_export(ctx):
    from . import export
    export.stage(ctx)
