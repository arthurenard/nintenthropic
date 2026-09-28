"""Build Route 9 and Miller's Gas & Eats, the world of Dead of Night, from nothing.

    Blender -b --factory-startup -t 4 -P art/night/build_road.py -- [stages] [options]

Stages (default: all):
    scene     build the road (geometry, materials, lamps, contract nodes)
              and save art/night/build/road.blend
    sky       render public/assets/night/sky.webp (+ a linear EXR copy)
    bake      bake the night into per-group atlases: `lit` (moon, sky and the
              steady practical lights, no fog), `albedo`, and an ORM-packed
              map (R: streetlight flicker mask, G: roughness, B: 0)
    export    write public/assets/night/road.glb
    review    render the review set into --review-dir
    poster    render public/assets/night/poster.webp

Options:
    --quick           low samples and a lighter ground (iteration)
    --review-dir DIR  where review renders go (default: art/night/build/review)
    --preview NAME    only one review view / only one bake group
    --only a,b        (scene) only these builders, for fast iteration

Stages after `scene` reopen the saved .blend, so they can be rerun alone.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(HERE, "build")
ASSETS = os.path.join(REPO, "public", "assets", "night")
BLEND = os.path.join(BUILD, "road.blend")
BAKED_BLEND = os.path.join(BUILD, "road_baked.blend")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    stages, opts = [], {"quick": False, "review_dir": os.path.join(BUILD, "review"), "preview": None, "only": None}
    it = iter(argv)
    for a in it:
        if a == "--quick":
            opts["quick"] = True
        elif a == "--review-dir":
            opts["review_dir"] = next(it)
        elif a == "--preview":
            opts["preview"] = next(it)
        elif a == "--only":
            opts["only"] = next(it).split(",")
        else:
            stages.append(a)
    if not stages:
        stages = ["scene", "sky", "bake", "export", "review", "poster"]
    return stages, opts


def main():
    stages, opts = parse_args()
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    from roadlib import pipeline
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
