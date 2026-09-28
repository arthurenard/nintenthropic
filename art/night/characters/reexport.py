"""Re-export a character file from its saved scene, without sculpting again.

    Blender -b --factory-startup -t 4 art/night/build/characters/walker.blend \\
        -P art/night/characters/reexport.py [-- --out DIR]

build.py saves each finished scene (art/night/build/characters/<who>.blend).
This reopens one, brings it up to the current contract - names the game
reads (`char.runner`, `char.bloater`, `lantern.flame`), clips added to the
clip library since it was built (the crawler's `.low` ones) baked onto its
rig, the clip meta and dressing extras refreshed - and writes the .glb
again. Minutes instead of the half hour a walker build takes; the sculpts,
atlases and existing clips are exactly the build's.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "public", "assets", "night")

from deadlib import assemble  # noqa: E402
from deadlib.common import log  # noqa: E402

RENAMES = {"var.runner": "char.runner", "var.bloater": "char.bloater", "prop.lantern.flame": "lantern.flame"}

t0 = time.time()
who = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
for old, new in RENAMES.items():
    ob = bpy.data.objects.get(old)
    if ob is not None:
        ob.name = new
        if ob.data is not None:
            ob.data.name = new
        log(f"renamed {old} -> {new}")
rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
have = {a.name for a in bpy.data.actions}
extras = {}
if who in ("walker", "mechanic"):
    from deadlib import clips_dead
    clips = dict(clips_dead.CLIPS)
    meta = dict(clips_dead.META)
    if who == "mechanic":
        from deadlib import clips_mech
        clips.update(clips_mech.CLIPS)
        meta.update(clips_mech.META)
        # the Mechanic walks on legs: the crawler's clips are the walker file's only
        for k in clips_dead.LOW_CLIPS:
            clips.pop(k, None)
            meta.pop(k, None)
    missing = {k: v for k, v in clips.items() if k not in have}
    if missing:
        log(f"{who}: baking {', '.join(missing)}")
        assemble.bake_clips(rig, missing)
    extras["clips"] = meta
    if who == "walker":
        extras["dressing"] = {"walker": "char.walker + one var.outfit.* + one var.hair.* (or none) + eyes",
                              "runner": "char.runner + eyes (no var.hair, no var.outfit: it wears its own)",
                              "bloater": "char.bloater + eyes (no var.hair, no var.outfit)",
                              "crawler": "char.crawler + eyes (no var.hair, no var.outfit); plays the .low clips"}
elif who == "survivor":
    extras["dressing"] = {"daughter": "var.person.daughter + prop.lantern (+ lantern.flame lit)",
                          "owner": "var.person.owner + prop.lantern (+ lantern.flame lit)"}
path = os.path.join(out, f"{who}.glb")
size = assemble.export(path, extras=extras)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
log(f"{who}: re-exported {path} ({size / 1024:.0f} KB) in {time.time() - t0:.0f}s")
