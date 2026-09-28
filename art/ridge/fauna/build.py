"""Build public/assets/ridge/animals.glb: the cow, sheep, goat, eagle and dog of
the Valle Serra, sculpted, textured, rigged and animated from nothing.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \\
        -P art/ridge/fauna/build.py -- [--quick] [--blend DIR] [--only cow,goat] [--out DIR]

From art/ridge/build.py (stage `animals`): fauna.build.build(ASSETS, quick=...).

--quick   coarser sculpts, 512 atlases, fewer triangles (iteration only)
--blend   also save the finished scene (fauna.blend) for review.py
--only    build some animals; the file then goes to art/ridge/build/fauna/
          (a partial animals.glb must never overwrite the real one)
"""
import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RIDGE = os.path.dirname(HERE)
if RIDGE not in sys.path:
    sys.path.insert(0, RIDGE)

import bpy  # noqa: E402
from fauna import lib as L  # noqa: E402

SPECIES = ["cow", "sheep", "goat", "eagle", "dog"]
SCRATCH = os.path.join(RIDGE, "build", "fauna")


def build(out_dir, quick=False, blend_dir=None, only=None):
    t0 = time.time()
    from charlib import pipeline as PL
    L.bl.clear_scene()
    sc = bpy.context.scene
    sc.render.fps = L.FPS
    sc.render.fps_base = 1.0
    names = [n for n in SPECIES if not only or n in only]
    made = {}
    for n in names:
        with L.stage(f"== {n}"):
            made[n] = importlib.import_module(f"fauna.{n}").build(quick=quick)
    partial = len(names) < len(SPECIES)
    path = os.path.join(SCRATCH if partial else out_dir, "animals.glb")
    with L.stage("export"):
        size = PL.export(path)
    L.log(f"wrote {path}: {size / 1024:.0f} KB")
    for n, m in made.items():
        L.log(f"  {n}: {m['tris']} triangles, clips {', '.join(m['clips'])}")
    if blend_dir:
        os.makedirs(blend_dir, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, "fauna.blend"))
        L.log(f"saved {os.path.join(blend_dir, 'fauna.blend')}")
    L.log(f"animals built in {time.time() - t0:.0f}s")
    return path


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default
    repo = os.path.abspath(os.path.join(RIDGE, "..", ".."))
    build(arg("--out", os.path.join(repo, "public", "assets", "ridge")), quick="--quick" in argv,
          blend_dir=arg("--blend"), only=arg("--only").split(",") if arg("--only") else None)
