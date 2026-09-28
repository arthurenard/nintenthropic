"""Build Overwatch Ridge's art from nothing: the Valle Serra at dawn, its sky,
its people, vehicles and animals, and the poster.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \\
        -P art/ridge/build.py -- [stages] [options]

Valley stages (in order; each saves its work under art/ridge/build/ so a
stage can be rerun alone once the ones before it have run):
    terrain     heightfield, river, roads, splat, colour and light maps
    materials   the tileable PBR ground materials and the building trims
    forest      the tree models, their impostors, and where every tree stands
    buildings   farm, checkpoint and watchtower, bridge, village and chapel, dam
    water       river, reservoir and mist meshes
    sky         public/assets/ridge/sky.webp
    bake        light: terrain AO + sun horizon, building AO atlases
    export      public/assets/ridge/valley.glb (+ terrain textures)
    review      review renders into art/ridge/build/review/
    poster      public/assets/ridge/poster.webp
Separate files:
    characters  soldier.glb, civilian.glb   (art/ridge/people/)
    vehicles    vehicles.glb                (art/ridge/vehicles/)
    animals     animals.glb                 (art/ridge/fauna/)

Default: every valley stage, then characters, vehicles, animals.

Options:
    --quick           low resolution and samples everywhere (iteration)
    --review-dir DIR  where review renders go (default art/ridge/build/review)
    --preview NAME    only one named review view / bake group
Check the result with:  python3 art/ridge/check.py
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
for p in (HERE, os.path.join(REPO, "art", "western"), os.path.join(REPO, "art", "western", "characters")):
    if p not in sys.path:
        sys.path.insert(0, p)

import bpy  # noqa: E402

BUILD = os.path.join(HERE, "build")
ASSETS = os.path.join(REPO, "public", "assets", "ridge")

VALLEY_STAGES = ["terrain", "materials", "forest", "buildings", "water", "sky", "bake", "export", "review", "poster"]
OTHER_STAGES = ["characters", "vehicles", "animals"]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    stages = []
    opts = {"quick": False, "review_dir": os.path.join(BUILD, "review"), "preview": None}
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
        stages = VALLEY_STAGES + OTHER_STAGES
    return stages, opts


def main():
    stages, opts = parse_args()
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    t0 = time.time()
    for st in stages:
        ts = time.time()
        print(f"\n=== stage {st} ===", flush=True)
        if st in VALLEY_STAGES:
            from valley import pipeline
            ctx = pipeline.Context(build=BUILD, assets=ASSETS, **opts)
            getattr(pipeline, f"stage_{st}")(ctx)
        elif st == "characters":
            from people import build as people_build
            people_build.build(ASSETS, quick=opts["quick"])
        elif st == "vehicles":
            from vehicles import build as vehicles_build
            vehicles_build.build(ASSETS, quick=opts["quick"])
        elif st == "animals":
            from fauna import build as fauna_build
            fauna_build.build(ASSETS, quick=opts["quick"])
        else:
            raise SystemExit(f"unknown stage {st!r}; stages: {VALLEY_STAGES + OTHER_STAGES}")
        print(f"=== stage {st} done in {time.time() - ts:.1f}s ===", flush=True)
    print(f"\nAll stages done in {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
