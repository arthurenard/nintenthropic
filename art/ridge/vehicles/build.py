"""Build public/assets/ridge/vehicles.glb from nothing: the canvas-backed
truck and the jeep, modelled, painted, baked and exported by script.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \\
        -P art/ridge/vehicles/build.py -- [--blend DIR] [--quick] [--stop model] [--only truck]

or as the `vehicles` stage of art/ridge/build.py. Stages, each timed:
    model    both vehicles as builder geometry (truck.py, jeep.py)
    paint    the procedural source materials (paint.py)
    bake     UV atlas + Cycles bakes: albedo, roughness, metalness, normal, AO (bake.py)
    export   assembled node trees, one material per vehicle + glass, Draco,
             WebP, then the GLB's names patched (export.py)
--stop model  stops after modelling and renders Workbench previews
--blend DIR   saves the model and the baked scene as .blend files there
Then check it:  python3 art/ridge/check.py vehicles
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RIDGE = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(RIDGE, "..", ".."))
for p in (RIDGE, os.path.join(REPO, "art", "western"), os.path.join(REPO, "art", "western", "characters")):
    if p not in sys.path:
        sys.path.insert(0, p)

import bpy  # noqa: E402

REVIEW = os.path.join(RIDGE, "build", "review", "vehicles")
WORK = os.path.join(RIDGE, "build", "vehicles")


def log(msg):
    print(f"[vehicles] {msg}", flush=True)


def build(out_dir, quick=False, blend_dir=None, stop=None, only=None):
    import importlib
    from vehicles import geo, assemble
    t_all = time.time()
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    geo.reset_scene()
    t = time.time()
    names = [only] if only else ["truck", "jeep"]
    col = geo.collection("vehicles")
    made = []
    for n in names:
        v = importlib.import_module(f"vehicles.{n}").model()
        parts = v.build_objects(col)
        proto = v.proto(col)
        log(f"{n}: modelled, {v.tris()} triangles before wheels, {len(parts)} bake parts")
        made.append((v, parts, proto))
    log(f"stage model done in {time.time() - t:.1f}s")
    if stop == "model":
        from vehicles import preview
        roots = []
        for v, parts, proto in made:
            root = assemble.assemble(v, parts, proto, col)
            log(f"{v.name}: {assemble.triangles(root)} triangles assembled")
            roots.append(root)
        if blend_dir:
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, "vehicles_model.blend"), compress=True)
        preview.render_views(roots, REVIEW, "geo")
        log(f"previews in {REVIEW}")
        return
    from vehicles import paint, bake, export
    t = time.time()
    for v, parts, proto in made:
        paint.assign(v, parts, proto)
    log(f"stage paint done in {time.time() - t:.1f}s")
    t = time.time()
    for v, parts, proto in made:
        tv = time.time()
        bake.bake_vehicle(v, parts, proto, WORK, quick=quick, log=log)
        log(f"{v.name}: baked in {time.time() - tv:.1f}s")
    log(f"stage bake done in {time.time() - t:.1f}s")
    if blend_dir:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, "vehicles_baked.blend"), compress=True)
    t = time.time()
    path = export.export_all(made, out_dir, WORK, col, log=log)
    log(f"stage export done in {time.time() - t:.1f}s")
    if blend_dir:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, "vehicles_export.blend"), compress=True)
    log(f"all done in {time.time() - t_all:.1f}s -> {path}")
    return path


def _args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"quick": False, "blend_dir": None, "stop": None, "only": None}
    it = iter(argv)
    for a in it:
        if a == "--quick":
            opts["quick"] = True
        elif a == "--blend":
            opts["blend_dir"] = next(it)
        elif a == "--stop":
            opts["stop"] = next(it)
        elif a == "--only":
            opts["only"] = next(it)
    return opts


if __name__ == "__main__":
    o = _args()
    if o["blend_dir"]:
        os.makedirs(o["blend_dir"], exist_ok=True)
    build(os.path.join(REPO, "public", "assets", "ridge"), **o)
