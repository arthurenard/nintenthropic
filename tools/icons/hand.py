"""Handy's mark, the hand: a right hand making a finger pistol, built from
real bone lengths (centimetres, one Blender unit each): tapered capsules,
fused by a voxel remesh and smoothed so every joint gets a clay-like fillet,
rendered in Cycles on a transparent film.

    Blender -b --factory-startup -P tools/icons/hand.py -- OUT.png [SIZE]

Axes: +X is where the finger points, +Z is up, the camera looks from -Y at
the back of the hand; the palm faces +Y and the curled fingers fold into +Y.
Writes OUT.json beside the image: where the fingertip and the aim point fall
in it, for tools/icons/mark.mjs to place the crosshair on the finger's line.
"""

import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/hand.png"
SIZE = int(argv[1]) if len(argv) > 1 else 1024

# --- the bones -----------------------------------------------------------------------------

V = Vector
INDEX = [V((8.6, 0.0, 2.35)), V((12.85, 0.0, 2.55)), V((15.35, 0.0, 2.6)), V((17.3, 0.0, 2.58))]
INDEX_R = [1.02, 0.95, 0.87]
THUMB = [V((2.6, 1.05, 1.9)), V((4.85, 1.0, 4.35)), V((4.7, 0.9, 6.95)), V((4.4, 0.8, 8.95))]
THUMB_R = [1.6, 1.32, 1.2]
# Middle, ring and little finger: knuckle, then curled into the palm (+Y).
CURLED = [
    ([V((8.95, 0.05, 0.3)), V((10.05, 4.15, 0.12)), V((7.45, 4.85, 0.02)), V((6.35, 3.3, 0.0))], [1.0, 0.92, 0.84]),
    ([V((8.5, 0.15, -1.75)), V((9.45, 3.95, -1.95)), V((7.0, 4.6, -2.05)), V((6.0, 3.15, -2.05))], [0.95, 0.88, 0.8]),
    ([V((7.7, 0.3, -3.5)), V((8.45, 3.45, -3.8)), V((6.4, 4.0, -3.9)), V((5.5, 2.75, -3.9))], [0.85, 0.79, 0.72]),
]
BACK = (V((5.15, 0.5, -0.55)), V((3.95, 1.4, 3.4)))  # the back of the hand: centre, semi-axes at the knuckles
FOREARM = (V((-6.5, 0.55, -7.2)), V((1.7, 0.45, -0.6)), 2.9, 2.5)
AIM = V((23.2, 0.0, 2.58))  # where the crosshair floats, on the finger's line


BM = bmesh.new()


def sphere(c: Vector, r: float) -> None:
    bmesh.ops.create_uvsphere(BM, u_segments=40, v_segments=20, radius=r, matrix=Matrix.Translation(c))


def capsule(a: Vector, b: Vector, ra: float, rb: float, squash_y: float = 1.0) -> None:
    """A tube from radius ra at a to rb at b, with round ends; squash_y < 1
    flattens it front to back (a wrist is wider than it is deep)."""
    d = b - a
    turn = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    made = bmesh.ops.create_cone(BM, cap_ends=True, segments=40, radius1=ra, radius2=rb, depth=d.length, matrix=Matrix.Translation((a + b) / 2) @ turn)["verts"]
    made += bmesh.ops.create_uvsphere(BM, u_segments=40, v_segments=20, radius=ra, matrix=Matrix.Translation(a))["verts"]
    made += bmesh.ops.create_uvsphere(BM, u_segments=40, v_segments=20, radius=rb, matrix=Matrix.Translation(b))["verts"]
    if squash_y != 1.0:
        axis_y = (a.y + b.y) / 2
        for v in made:
            v.co.y = axis_y + (v.co.y - axis_y) * squash_y


def chain(joints, radii) -> None:
    """A finger: each bone tapers into the next; the last ends in the tip."""
    rs = list(radii) + [radii[-1] * 0.94]
    for i, (a, b) in enumerate(zip(joints, joints[1:])):
        capsule(a, b, rs[i], rs[i + 1])


def rounded_box(c: Vector, half: Vector, p: float = 3.2, taper: float = 1.0) -> None:
    """A superellipsoid: a box with soft, round corners (the back of the hand).
    taper < 1 narrows its height (Z) toward -X: a hand is narrower at the wrist."""
    made = bmesh.ops.create_uvsphere(BM, u_segments=48, v_segments=24, radius=1.0)
    for v in made["verts"]:
        x, y, z = (math.copysign(abs(u) ** (2 / p), u) for u in v.co)
        z *= taper + (1 - taper) * (x + 1) / 2
        v.co = Vector((x * half.x, y * half.y, z * half.z)) + c


# --- the scene ------------------------------------------------------------------------------

scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

chain(INDEX, INDEX_R)
chain(THUMB, THUMB_R)
for joints, radii in CURLED:
    chain(joints, radii)
rounded_box(*BACK, p=3.0, taper=0.8)
capsule(FOREARM[0], FOREARM[1], FOREARM[2], FOREARM[3], squash_y=0.72)
mesh = bpy.data.meshes.new("hand")
BM.to_mesh(mesh)
hand = bpy.data.objects.new("hand", mesh)
scene.collection.objects.link(hand)
fuse = hand.modifiers.new("fuse", "REMESH")
fuse.mode = "VOXEL"
fuse.voxel_size = 0.085
fuse.use_smooth_shade = True
soften = hand.modifiers.new("soften", "SMOOTH")
soften.factor = 0.6
soften.iterations = 14

clay = bpy.data.materials.new("clay")
clay.use_nodes = True
bsdf = clay.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.86, 0.86, 0.88, 1)
bsdf.inputs["Roughness"].default_value = 0.42
bsdf.inputs["Subsurface Weight"].default_value = 0.18
bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.75, 0.6)
bsdf.inputs["Subsurface Scale"].default_value = 0.25
bsdf.inputs["Coat Weight"].default_value = 0.15
mesh.materials.append(clay)

world = bpy.data.worlds.new("dark")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.036, 0.04, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world


def sun(name, rot_deg, strength, color=(1, 1, 1), angle=12):
    light = bpy.data.lights.new(name, "SUN")
    light.energy = strength
    light.color = color
    light.angle = math.radians(angle)
    obj = bpy.data.objects.new(name, light)
    obj.rotation_euler = [math.radians(a) for a in rot_deg]
    scene.collection.objects.link(obj)


sun("key", (52, 0, -38), 4.2, (1.0, 0.98, 0.95), 18)  # high, front-left
sun("fill", (80, 0, 40), 0.7, (0.92, 0.95, 1.0), 30)  # low, front-right
sun("rim", (-60, 0, 160), 3.0, (0.85, 0.9, 1.0), 8)  # behind, to part the edge from the dark
green = bpy.data.lights.new("aim", "POINT")
green.energy = 1500
green.color = (0.19, 0.82, 0.35)
green.shadow_soft_size = 1.2
g = bpy.data.objects.new("aim", green)
g.location = AIM + V((-1.6, -1.2, 0.2))
scene.collection.objects.link(g)

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 72
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (31.0, -57.5, 11.5)
target = V((10.2, 0.0, 2.4))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"  # headless Metal aborts here; the CPU takes a minute
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Base Contrast"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)

where = {}
for name, p in (("tip", INDEX[-1] + V((INDEX_R[-1], 0, 0))), ("aim", AIM)):
    c = world_to_camera_view(scene, cam, p)
    where[name] = [round(c.x, 4), round(1 - c.y, 4)]
print("HAND_LAYOUT " + json.dumps(where))
with open(OUT.rsplit(".", 1)[0] + ".json", "w") as f:
    json.dump(where, f)
