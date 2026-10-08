"""Builds Grip Prix's man-made worlds' landmarks (public/assets/kart/world-<theme>.glb).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P art/kart/world/made.py -- [theme ...] [only=teapot,mug] [out=DIR] [nodraco]

Without arguments, all four themes. `only=` builds just those landmarks (the game falls back to its
code-built ones for the rest: for trying one out; do a full build before committing).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import importlib

import wlib

THEMES = ["kitchen", "funfair", "harbour", "space"]
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    themes = [a for a in args if a in THEMES] or THEMES
    only = None
    out = os.path.join(ROOT, "public", "assets", "kart")
    for a in args:
        if a.startswith("only="):
            only = set(a[5:].split(","))
        if a.startswith("out="):
            out = a[4:]
    draco = "nodraco" not in args
    for theme in themes:
        mod = importlib.import_module(theme)
        wlib.build_theme(theme, mod.BUILDERS, os.path.join(out, f"world-{theme}.glb"), only, draco)


main()
