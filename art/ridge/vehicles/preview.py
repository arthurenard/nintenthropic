"""Quick Workbench previews of the untextured model (the `--stop model`
build): back faces culled so a face pointing the wrong way shows as a hole,
cavity on so the panel shapes read. For shape work only; the real review
renders the exported GLB (review.py)."""

import os

import bpy
from mathutils import Vector

COLORS = {
    "paint": (0.30, 0.34, 0.20), "paint_in": (0.26, 0.28, 0.20), "chassis": (0.18, 0.20, 0.14),
    "under": (0.22, 0.18, 0.12), "rim": (0.30, 0.34, 0.20), "rim_back": (0.2, 0.22, 0.14), "tyre": (0.05, 0.05, 0.05),
    "canvas": (0.46, 0.44, 0.30), "canvas_in": (0.30, 0.28, 0.20), "rope": (0.55, 0.50, 0.38),
    "wood": (0.42, 0.33, 0.22), "steel": (0.25, 0.24, 0.23), "black": (0.04, 0.04, 0.04),
    "seat": (0.20, 0.14, 0.09), "lens": (0.7, 0.75, 0.8), "lamp_red": (0.6, 0.05, 0.03),
    "radiator": (0.06, 0.06, 0.06), "mirror": (0.6, 0.65, 0.7), "glass": (0.5, 0.6, 0.7),
}


def colour_materials():
    for m in bpy.data.materials:
        key = m.name.split(".", 1)[-1]
        c = COLORS.get(key, (0.8, 0.0, 0.8))
        m.diffuse_color = (*c, 1.0)


def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_views(roots, out_dir, tag, res=(1400, 900)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_backface_culling = True
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = True
    sh.show_object_outline = False
    sc.display.shadow_shift = 0.1
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("w")
    colour_materials()
    cam_data = bpy.data.cameras.new("pcam")
    cam = bpy.data.objects.new("pcam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    for root in roots:
        # show only this vehicle
        for ob in sc.objects:
            if ob.type in ('MESH',):
                ob.hide_render = ob not in root.children_recursive
        size = 7.0 if root.name == "truck" else 3.6
        h = 1.4 if root.name == "truck" else 0.8
        views = {
            "34front": (Vector((-1.0, -1.1, 0.45)), 1.0),
            "34rear": (Vector((1.1, 1.0, 0.5)), 1.0),
            "side": (Vector((1.0, 0.0, 0.08)), 1.0),
            "front": (Vector((0.0, -1.0, 0.12)), 1.0),
            "back": (Vector((0.0, 1.0, 0.18)), 1.0),
            "top": (Vector((0.001, 0.0, 1.0)), 1.0),
            "low": (Vector((-1.0, -0.6, -0.02)), 1.0),
        }
        for name, (d, _) in views.items():
            cam_data.lens = 50
            dist = size * 1.55
            cam.location = Vector((0, 0, h)) + d.normalized() * dist
            look_at(cam, (0, 0, h))
            sc.render.filepath = os.path.join(out_dir, f"{tag}_{root.name}_{name}.png")
            bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
