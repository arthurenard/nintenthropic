"""Build drivers.glb: the nine drivers of Grip Prix, modelled from signed-distance shapes in Blender.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/kart/drivers/build.py \\
        [-- --only fox,cat] [--out PATH] [--blend PATH]

Writes public/assets/kart/drivers.glb (Draco): per species the nodes
`driver.<species>.<part>` -- head, torso, arm.L, arm.R, helmet, and a few that
move on their own (tail, scarf, bulb...) -- each with its origin at the joint
the game rig turns it about (see rig.py for the materials the game reads).
Nothing is downloaded; everything is generated.
"""
import importlib
import os
import sys
import time

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "species"))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import bpy  # noqa: E402

import rig  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ALL = ["rabbit", "penguin", "frog", "fox", "otter", "cat", "bear", "robot", "duck"]
only = arg("--only", ",".join(ALL)).split(",")
out = arg("--out", os.path.join(REPO, "public", "assets", "kart", "drivers.glb"))
blend = arg("--blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
collection = bpy.context.scene.collection
materials = rig.make_materials()

t0 = time.time()
for sp in only:
    t = time.time()
    module = importlib.import_module(sp)
    parts = module.build()
    total = 0
    for part in parts:
        part.to_object(collection, materials)
        total += part.tris()
        print(f"  {part.name:30s} {part.tris():5d} tris")
    print(f"[drivers] {sp}: {total} tris in {time.time() - t:.1f}s", flush=True)

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=False,
    export_normals=True,
    export_texcoords=False,
    export_vertex_color="ACTIVE",
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_extras=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_color_quantization=10,
)
print(f"[drivers] wrote {out} ({os.path.getsize(out) / 1024:.0f} KB) in {time.time() - t0:.0f}s")
if blend:
    bpy.ops.wm.save_as_mainfile(filepath=blend)
