"""Blender plumbing for the valley: scene, collections, the player's camera,
the dawn sun and sky, and meshes from numpy arrays.

The High Noon helpers (art/western/dustcreek) are reused read-only where
they are generic: the node DSL and the orientation helpers.
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import layout as L

HERE = os.path.dirname(os.path.abspath(__file__))
WESTERN = os.path.abspath(os.path.join(HERE, "..", "..", "western"))
if WESTERN not in sys.path:
    sys.path.insert(0, WESTERN)
from dustcreek.nodes import new_material, new_group, group_node, G  # noqa: E402,F401
from dustcreek.core import facing_matrix, axis_matrix  # noqa: E402,F401

# dawn light: the sun just up behind the player's left shoulder
# The low sun must dominate the sky ~4:1 on the faces it reaches, or the
# peaks never glow and the valley's shade never reads blue (measured on the
# review renders: at 1:1 the valley looks overcast).
SUN_COLOR = (1.0, 0.50, 0.26)
SUN_STRENGTH = 28.0
SKY_STRENGTH = 0.45
EXPOSURE = -0.45
SKY_TYPE = 'MULTIPLE_SCATTERING'
VIEW_TRANSFORM = 'AgX'
LOOK = 'AgX - Medium High Contrast'


def reset_scene(name="ValleSerra"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = name
    sc.unit_settings.system = 'METRIC'
    return sc


def setup_gpu(scene=None):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for t in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = t
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                break
        except TypeError:
            continue
    for d in prefs.devices:
        d.use = d.type != 'CPU'
    for sc in ([scene] if scene else bpy.data.scenes):
        sc.cycles.device = 'GPU'


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def tag(ob, **props):
    for k, v in props.items():
        ob[k] = v
    return ob


def empty(name, loc, col, rot=None, size=1.0, display='PLAIN_AXES', parent=None, **props):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    ob.location = Vector(loc)
    if rot is not None:
        ob.rotation_euler = rot.to_euler() if isinstance(rot, Matrix) else rot
    col.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    tag(ob, **props)
    return ob


def mesh_object(name, V, F, col, normals=None, uvs=None, smooth=True, **props):
    """V (n,3), F (m,3|4) int, normals (n,3) per vertex (custom split normals),
    uvs {layer: (n,2) per vertex}."""
    V = np.asarray(V, np.float32)
    F = np.asarray(F, np.int64)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.ravel())
    k = F.shape[1]
    me.loops.add(len(F) * k)
    me.loops.foreach_set("vertex_index", F.ravel().astype(np.int32))
    me.polygons.add(len(F))
    me.polygons.foreach_set("loop_start", (np.arange(len(F)) * k).astype(np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    li = F.ravel()
    for lname, uv in (uvs or {}).items():
        layer = me.uv_layers.new(name=lname)
        layer.data.foreach_set("uv", np.asarray(uv, np.float32)[li].ravel())
    if smooth:
        me.shade_smooth()
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in np.asarray(normals, np.float32)])
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    tag(ob, **props)
    return ob


# ---------------------------------------------------------------------------
# Camera, sun, sky

def player_camera(col):
    cd = bpy.data.cameras.new("camera.player")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(L.VFOV_DEG)
    cd.clip_start = 0.05
    cd.clip_end = 20000.0
    cam = bpy.data.objects.new("camera.player", cd)
    cam.location = (0.0, 0.0, 0.0)
    cam.rotation_euler = (math.radians(90.0 + L.PITCH_DEG), 0.0, 0.0)
    col.objects.link(cam)
    tag(cam, fov_deg=L.VFOV_DEG, pitch_deg=L.PITCH_DEG, eye_height_above_floor=-L.FLOOR_Z,
        scope_zoom=6.0, note="the player's eye (prone on the spur, 60 m above the valley floor), looking along -Z")
    return cam


def sun_dir(elev=None):
    return Vector(L.sun_vector(L.SUN_ELEV if elev is None else elev))


def sky_rotation():
    """Blender's Sky Texture measures sun_rotation from +Y toward +X (the
    bearing): same convention as the layout's SUN_BEARING."""
    return math.radians(L.SUN_BEARING)


def build_world(scene, elev=None, strength=SKY_STRENGTH, disc=False, name="DawnSky"):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = SKY_TYPE
    sky.sun_elevation = math.radians(L.SUN_ELEV if elev is None else elev)
    sky.sun_rotation = sky_rotation()
    sky.sun_disc = disc
    try:
        sky.altitude = 1400.0
        sky.air_density = 1.0
        sky.aerosol_density = 0.8
        sky.ozone_density = 1.0
    except AttributeError:
        pass
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    scene.world = w
    return w


def build_sun(col, elev=None):
    d = bpy.data.lights.new("SunLamp", 'SUN')
    d.energy = SUN_STRENGTH
    d.color = SUN_COLOR
    d.angle = math.radians(0.6)
    ob = bpy.data.objects.new("SunLamp", d)
    ob.rotation_euler = sun_dir(elev).to_track_quat('Z', 'Y').to_euler()
    col.objects.link(ob)
    return ob


def sun_node(col):
    """`sun`: an empty whose -Z (glTF) points along the sunlight."""
    m = axis_matrix(-sun_dir())          # local +Y (Blender) -> glTF -Z: along the light
    ob = empty("sun", (0, 0, 0), col, rot=m, size=20.0, display='SINGLE_ARROW',
               elevation_deg=L.SUN_ELEV, bearing_deg=L.SUN_BEARING,
               elevation_range_deg=list(L.SUN_ELEV_RANGE), color=list(SUN_COLOR),
               note="-Z along the sunlight at the start of a run; the game may raise the sun "
                    "through elevation_range_deg over a run (the terrain's light map holds the "
                    "horizon angles to move the shadow line)")
    return ob


def render_settings(scene, w, h, samples, denoise=True):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = denoise
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 4
    scene.cycles.transparent_max_bounces = 16
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = VIEW_TRANSFORM
    scene.view_settings.look = LOOK
    scene.view_settings.exposure = EXPOSURE
    scene.render.film_transparent = False


def apply_lighting(scene, elev=None):
    """Bring the saved scene's sun and sky to the current constants (stages
    after `terrain` reopen a blend made with whatever they were then)."""
    import bpy
    lamp = bpy.data.objects.get("SunLamp")
    if lamp is not None:
        lamp.data.energy = SUN_STRENGTH
        lamp.data.color = SUN_COLOR
        lamp.rotation_euler = sun_dir(elev).to_track_quat('Z', 'Y').to_euler()
    if scene.world is not None:
        for n in scene.world.node_tree.nodes:
            if n.type == 'BACKGROUND':
                n.inputs['Strength'].default_value = SKY_STRENGTH
            if n.type == 'TEX_SKY':
                n.sun_elevation = math.radians(L.SUN_ELEV if elev is None else elev)
                n.sun_rotation = sky_rotation()
