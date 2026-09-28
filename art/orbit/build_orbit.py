"""Build Orbital Decay's art from nothing: the cupola, the station outside
it, the planet, the stars, the debris, the drone, the derelict satellite,
the extras and the poster.

    Blender -b --factory-startup -t 4 -P art/orbit/build_orbit.py -- [stages] [options]

Stages (default: all, in this order):
    planet    generate the planet's maps -> public/assets/orbit/planet/*.webp
    stars     the star field and Milky Way -> public/assets/orbit/stars.webp
    env       render the planet as the station sees it (lighting for bakes
              and reviews) -> art/orbit/build/env_day.exr
    cupola    model the cupola and the station around it, bake the cupola's
              light into unlit atlases -> public/assets/orbit/cupola.glb
    station   bake the station's PBR textures -> public/assets/orbit/station.glb
    debris    fragments and their pre-fractured pieces -> debris.glb
    drone     the repair drone -> drone.glb
    derelict  the dead satellite -> derelict.glb
    extras    astronaut, tool bag, duck, sticker -> extras.glb
    review    render the review set into --review-dir
    poster    render public/assets/orbit/poster.webp

Options:
    --quick           low resolution and samples everywhere (iteration)
    --review-dir DIR  where review renders go (default: art/orbit/build/review)
    --preview NAME    only render one named review view
    --only NAMES      comma-separated sub-steps some stages understand

Stages after `cupola` reopen the saved .blend files in art/orbit/build/, so
each can be rerun alone. Check the result with
    python3 art/orbit/check_orbit.py
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
# the High Noon pipeline's node-tree helpers, imported read-only
WESTERN = os.path.join(os.path.dirname(HERE), "western")
if WESTERN not in sys.path:
    sys.path.append(WESTERN)

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(HERE, "build")
ASSETS = os.path.join(REPO, "public", "assets", "orbit")
ALL = ["planet", "stars", "env", "cupola", "station", "debris", "drone", "derelict", "extras", "review", "poster"]


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
            if a not in ALL:
                raise SystemExit(f"unknown stage {a!r}; stages: {' '.join(ALL)}")
            stages.append(a)
    return stages or ALL, opts


def main():
    stages, opts = parse_args()
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    from orbitlib import pipeline
    t0 = time.time()
    ctx = pipeline.Context(build=BUILD, assets=ASSETS, **opts)
    for st in stages:
        ts = time.time()
        print(f"\n=== stage {st} ===", flush=True)
        getattr(pipeline, f"stage_{st}")(ctx)
        print(f"=== stage {st} done in {time.time() - ts:.1f}s ===", flush=True)
    print(f"\nAll stages done in {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
