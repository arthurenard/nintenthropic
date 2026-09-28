"""walker.glb: the dead who come up Route 9.

    char.walker          the dead body's skin: head (neck, ears), hands
    var.outfit.<name>    what they died in (outfits.py) - show exactly one
    var.hair.<n>         hair over the bald head (hair.py) - one or none
    char.runner           a whole person: leaner, fresher, in running clothes
    char.bloater          a whole person: swollen, pale green, straining a torn shirt
    char.crawler         a whole person: legs gone below the knee, dragging
    eyes                 the eyeballs (their own material, for the eyeshine)

Dressing (see art/night/README.md): a walker is char.walker + one
var.outfit.* + one var.hair.* (or none) + eyes; a runner is char.runner +
eyes; a bloater char.bloater + eyes; a crawler char.crawler + eyes. One
armature, one clip library, one 2048 atlas for everything but the eyes.
"""

import time

import bpy
import numpy as np

from .common import SK, bl, log
from . import bodies, hair, outfits, eyes, assemble, variants


def build(path, size=2048, quick=False, only_outfits=None, clips=None):
    t0 = time.time()
    bl.clear_scene()
    rig = SK.create_armature("rig")
    jobs = []
    base, head_p = bodies.walker_base(quick=quick)
    for j in base:
        j["ao_group"] = "body"
        j["person"] = "walker"
        j["name"] = "char.walker"
    jobs += base
    for j in hair.jobs(base[0]["ob"], head_p):
        j["person"] = "walker"
        jobs.append(j)
    fits = {}
    for name, fn in outfits.OUTFITS.items():
        if only_outfits and name not in only_outfits:
            continue
        parts, bp = fn()
        for p in parts:
            p["ao_group"] = f"var.outfit.{name}"
            p["name"] = f"var.outfit.{name}"
            p["person"] = "walker"
        fits[name] = bp
        jobs += parts
        log(f"walker: outfit {name}: {sum(bl.tri_count(p['ob']) for p in parts)} tris")
    whole = variants.build_all(quick=quick)
    for vname, vjobs in whole.items():
        for j in vjobs:
            j["ao_group"] = vname
            j["ao_self_only"] = True
            j["person"] = vname
            j["name"] = vname
        jobs += vjobs
    for j in jobs:
        log(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
    log(f"walker: baking ({time.time() - t0:.0f}s)")
    mat = assemble.bake_atlas(jobs, size, "walker")
    # skin each person on its own proxy
    walker_jobs = [j for j in jobs if j["person"] == "walker"]
    proxy_fields = [(j["ao_field"], j["origin"], j.get("M")) for j in base] + bodies.body_proxy_fields(next(iter(fits.values())) if fits else None)
    assemble.skin(walker_jobs, rig, proxy_fields)
    for vname in whole:
        vj = [j for j in jobs if j["person"] == vname]
        assemble.skin(vj, rig, [(j["ao_field"], j["origin"], j.get("M")) for j in vj if j.get("skin", ("transfer",))[0] != "rigid"])
    # name and join
    groups = {}
    for j in jobs:
        groups.setdefault(j["name"], []).append(j["ob"])
    for name, objs in groups.items():
        assemble.join(objs, name, mat)
    ey = eyes.build("eyes")
    assemble.rigid_object(ey, rig, "head")
    log(f"walker: animating ({time.time() - t0:.0f}s)")
    from . import clips_dead
    assemble.bake_clips(rig, clips or clips_dead.CLIPS)
    size_b = assemble.export(path, extras=dict(
        dressing={"walker": "char.walker + one var.outfit.* + one var.hair.* (or none) + eyes",
                  "runner": "char.runner + eyes", "bloater": "char.bloater + eyes", "crawler": "char.crawler + eyes"},
        clips=clips_dead.META))
    log(f"walker: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path
