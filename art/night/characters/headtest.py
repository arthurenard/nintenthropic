"""Iterate on a head alone: sculpt, game mesh, bake, eyes, three close renders.

    Blender -b --factory-startup -t 4 -P art/night/characters/headtest.py -- [walker|runner|bloater|crawler|mechanic] [--tris N]

Writes art/night/build/review/characters/headtest_<who>_{front,q34,profile,wire}.png.
A tool for the sculptor: the real builds are build.py's.
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
who = argv[0] if argv and not argv[0].startswith("--") else "walker"
tris = int(argv[argv.index("--tris") + 1]) if "--tris" in argv else 6000
OUT = os.path.join(os.path.dirname(HERE), "build", "review", "characters")
os.makedirs(OUT, exist_ok=True)

from deadlib import heads as H, eyes as EY, bodies, assemble, variants  # noqa: E402
from deadlib.common import bl, AB, MT  # noqa: E402

t0 = time.time()
bl.clear_scene()
if who == "walker":
    p = H.P(**{k: v for k, v in bodies.WALKER_HEAD.items() if k != "dead"}, dead=bodies.WALKER_HEAD["dead"])
    look = bodies.WALKER_LOOK
else:
    spec = variants.HEADS[who]
    p = H.P(**spec[0], dead=spec[1])
    look = spec[2]
jobs, field = H.make("test.head", p, look, None, tris=tris)
print("head tris", bl.tri_count(jobs[0]["ob"]), f"{time.time() - t0:.0f}s")
imgs = AB.bake_character(jobs, 1024, "headtest", log=print)
imgs.pop("_atlas", None)
mat = MT.final_material("headtest", imgs["albedo"], imgs["normal"], imgs["orm"])
for j in jobs:
    j["ob"].data.materials.clear()
    j["ob"].data.materials.append(mat)
ey = EY.build("eyes")
eye_bs = next(n for n in ey.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
eye_bs.inputs["Emission Strength"].default_value = 0.0     # the dark: no beam on them
print(f"baked in {time.time() - t0:.0f}s")
sc = bpy.context.scene
w = bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.035, 0.05, 1)
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.lens = 85
key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
key.data.size = 0.6
key.data.energy = 30
sc.collection.objects.link(key)
rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "SUN"))
rim.data.energy = 2.0
rim.data.color = (0.62, 0.75, 1.0)
rim.data.angle = math.radians(2)
rim.rotation_euler = (math.radians(-70), 0, math.radians(200))
sc.collection.objects.link(rim)
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.samples = 48
sc.render.resolution_x = sc.render.resolution_y = 640
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
t = Vector((0, -0.03, 1.66))
for vn, az in (("front", 0), ("q34", 35), ("profile", 90)):
    a = math.radians(az)
    cam.location = t + Vector((math.sin(a) * 0.72, -math.cos(a) * 0.72, 0.03))
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    key.location = t + Vector((math.sin(a - 0.6) * 0.8, -math.cos(a - 0.6) * 0.8, 0.45))
    key.rotation_euler = (t - key.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f"headtest_{who}_{vn}.png")
    bpy.ops.render.render(write_still=True)
# the eyeshine as the game drives it in the beam's centre
eye_bs.inputs["Emission Strength"].default_value = 3.0
sc.render.filepath = os.path.join(OUT, f"headtest_{who}_shine.png")
bpy.ops.render.render(write_still=True)
eye_bs.inputs["Emission Strength"].default_value = 0.0
# wireframe look at the topology
a = math.radians(35)
cam.location = t + Vector((math.sin(a) * 0.72, -math.cos(a) * 0.72, 0.03))
cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
wm = jobs[0]["ob"].modifiers.new("wf", "WIREFRAME")
wm.thickness = 0.0004
wm.use_replace = False
sc.render.filepath = os.path.join(OUT, f"headtest_{who}_wire.png")
bpy.ops.render.render(write_still=True)
print(f"done in {time.time() - t0:.0f}s")
