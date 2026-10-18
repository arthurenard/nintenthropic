"""Build Dust Creek, the town of High Noon, from nothing.

    Blender -b --factory-startup -P art/western/build_town.py -- [stages] [options]

Stages (default: all):
    scene     build the town (geometry, materials, signs, contract nodes)
              and save art/western/build/town.blend
    sky       render public/assets/western/sky.webp (+ a linear EXR copy)
    bake      bake Cycles light into per-group atlases
    export    write public/assets/western/town.glb
    review    render the review set into --review-dir
    poster    render public/assets/western/poster.webp

Options:
    --quick           low samples everywhere (iteration)
    --review-dir DIR  where review renders go (default: art/western/build/review)
    --preview NAME    only render one named review view

Stages after `scene` reopen the saved .blend, so they can be rerun alone.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(HERE, "build")
ASSETS = os.path.join(REPO, "public", "assets", "western")
BLEND = os.path.join(BUILD, "town.blend")
BAKED_BLEND = os.path.join(BUILD, "town_baked.blend")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    stages, opts = [], {"quick": False, "review_dir": os.path.join(BUILD, "review"), "preview": None}
    it = iter(argv)
    for a in it:
        if a == "--quick":
            opts["quick"] = True
        elif a == "--review-dir":
            opts["review_dir"] = next(it)
        elif a == "--preview":
            opts["preview"] = next(it)
        else:
            stages.append(a)
    if not stages:
        stages = ["scene", "sky", "bake", "export", "review", "poster"]
    return stages, opts


def main():
    stages, opts = parse_args()
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    from dustcreek import pipeline
    t0 = time.time()
    ctx = pipeline.Context(build=BUILD, assets=ASSETS, blend=BLEND, baked_blend=BAKED_BLEND, **opts)
    for st in stages:
        ts = time.time()
        print(f"\n=== stage {st} ===", flush=True)
        getattr(pipeline, f"stage_{st}")(ctx)
        print(f"=== stage {st} done in {time.time() - ts:.1f}s ===", flush=True)
    print(f"\nAll stages done in {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
