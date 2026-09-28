"""Build Overwatch Ridge's people: public/assets/ridge/soldier.glb and civilian.glb.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \\
        -P art/ridge/people/build.py -- [--only soldier,civilian] [--blend DIR] [--quick] [--out DIR]

or from the top-level build (art/ridge/build.py, stage `characters`), which
calls build(ASSETS, quick=...). Everything - meshes, textures, rig, clips -
is generated here and by High Noon's character library (art/western/
characters/charlib, imported read-only); nothing is downloaded. With --blend
the finished scene of each file is saved too (a build product, git-ignored)
for review.py. --quick bakes 512 atlases on a coarser weight proxy (for
iteration only: never commit a quick build). --clips-only [--clips a,b]
reopens the scenes saved with --blend (default art/ridge/build/people) and
re-bakes just the clips, then exports again - seconds instead of minutes.
"""
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_RIDGE = os.path.dirname(_HERE)
if _RIDGE not in sys.path:
    sys.path.insert(0, _RIDGE)

from people import env  # noqa: E402  (puts charlib on sys.path)

ALL = ["soldier", "civilian"]


def build(out_dir, quick=False, blend_dir=None, only=None):
    import bpy
    import importlib
    only = only or ALL
    size = 512 if quick else 1024
    t0 = time.time()
    for who in only:
        ts = time.time()
        path = os.path.join(out_dir, f"{who}.glb")
        env.log(f"=== {who} ===")
        if who not in ALL:
            raise SystemExit(f"unknown person file {who!r}; choose from {ALL}")
        importlib.import_module(f"people.{who}").build(path, size, quick)
        if blend_dir:
            os.makedirs(blend_dir, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{who}.blend"))
        env.log(f"=== {who} done in {time.time() - ts:.0f}s ===")
    env.log(f"people built in {time.time() - t0:.0f}s")


def reclip(out_dir, blend_dir, only=None, clips=None):
    """Iterate on clips without rebuilding the people: reopen each saved
    scene, re-bake its clips (all, or just `clips`), export and save again."""
    import bpy
    import importlib
    from charlib import pipeline as PL
    for who in only or ALL:
        t = time.time()
        bpy.ops.wm.open_mainfile(filepath=os.path.join(blend_dir, f"{who}.blend"))
        mod = importlib.import_module(f"people.{who}")
        mod.animate(bpy.data.objects["rig"], only=clips)
        PL.export(os.path.join(out_dir, f"{who}.glb"))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{who}.blend"))
        env.log(f"{who}: clips re-baked in {time.time() - t:.0f}s")


def _main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default
    only = arg("--only", ",".join(ALL)).split(",")
    if "--clips-only" in argv:
        clips = arg("--clips")
        reclip(arg("--out", env.ASSETS), arg("--blend", env.BLEND), only, clips.split(",") if clips else None)
        return
    build(arg("--out", env.ASSETS), quick="--quick" in argv, blend_dir=arg("--blend"), only=only)


if __name__ == "__main__":
    _main()
