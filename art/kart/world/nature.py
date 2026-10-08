"""Builds the natural worlds' art: scenery kits and signature landmarks for the
meadow, canyon, snow, volcano and palm worlds, modelled in Blender from nothing.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/kart/world/nature.py -- [themes]

themes: any of meadow canyon snow volcano palm (default: all). Writes
public/assets/kart/world-<theme>.glb (Draco, vertex colours with the ambient
occlusion baked in, no textures). The contract is art/kart/README.md:

  scenery.<kind>.<n>   a mesh with its base on the ground, the size of the
                       code-built stand-in it replaces; several variants a kind
  landmark.<kind>      an empty at the origin with the model under it; parts
                       that turn are children named <x>.spin.<axis> with a
                       custom property `speed`

Never run this in a Blender window you are using; it resets the scene.
"""

import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "public", "assets", "kart")

import naturekit as K  # noqa: E402

THEMES = ["meadow", "canyon", "snow", "volcano", "palm"]


def lay_out(objs, y, spacing):
    """Scenery in a row for anyone opening the file (the game places every node itself)."""
    x = 0.0
    for o in objs:
        if o.parent is None:
            o.location = (x, y, 0)
            x += spacing


def build_theme(name):
    t0 = time.time()
    K.reset()
    mod = importlib.import_module(f"nature_{name}")
    scenery = mod.scenery()
    landmarks = mod.landmarks() if hasattr(mod, "landmarks") else []
    lay_out(scenery, 0.0, 6.0)
    x = 0.0
    for root in landmarks:
        root.location = (x, 120.0, 0)
        x += 110.0
    size = K.export(os.path.join(OUT, f"world-{name}.glb"))
    tris = K.tri_count(scenery)
    per = {}
    for o in scenery:
        root = o if o.parent is None else o.parent
        if o.type == "MESH":
            per[root.name] = per.get(root.name, 0) + len(o.data.polygons)
    print("[nature]   " + "  ".join(f"{k.split('.', 1)[1]}={v}" for k, v in per.items()))
    print(f"[nature] {name}: {len(scenery)} scenery meshes ({tris} tris), {len(landmarks)} landmarks, {size / 1024:.0f} KB, {time.time() - t0:.1f} s")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    which = [a for a in argv if a in THEMES] or THEMES
    for name in which:
        build_theme(name)


main()
