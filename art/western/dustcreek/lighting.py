"""Golden-hour light: one sun and one sky, shared by the bake, the review
renders and the equirectangular sky, so every picture agrees.

The sun sits low *behind* the player (who looks down +Y in Blender) and a
little to the right, so the left-hand facades take warm raking light, the
right-hand ones fall into cool sky-lit shade, and every shadow stretches away
down the street.
"""

import math

import bpy
from mathutils import Vector

from .core import axis_matrix

# Azimuth measured from -Y (straight behind the player) toward +X (right);
# this is exactly the Sky Texture's `sun_rotation` convention in Cycles.
SUN_AZ_DEG = 30.0
SUN_EL_DEG = 10.5
SUN_ANGLE_DEG = 0.9          # a little wider than the true 0.53: haze near the horizon
SUN_COLOR = (1.0, 0.64, 0.38)
SUN_STRENGTH = 4.2           # W/m^2 in Blender's units; paired with SKY_STRENGTH
SKY_STRENGTH = 0.045
SKY_TYPE = 'SINGLE_SCATTERING'   # Blender 5's name for the Nishita model
AIR = 1.0
AEROSOL = 2.2                # dusty desert air: a warmer, hazier horizon
OZONE = 1.0


def sun_vector():
    """Unit vector from the scene toward the sun (Blender coords)."""
    az, el = math.radians(SUN_AZ_DEG), math.radians(SUN_EL_DEG)
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def light_direction():
    """Direction the sunlight travels (toward the ground)."""
    return -sun_vector()


def sky_node_setup(nt, strength=SKY_STRENGTH, disc=False, sky_type=SKY_TYPE):
    """Build Sky Texture -> Background in a world node tree; returns the
    background node."""
    nt.nodes.clear()
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = sky_type
    sky.sun_elevation = math.radians(SUN_EL_DEG)
    sky.sun_rotation = math.radians(SUN_AZ_DEG)
    sky.sun_disc = disc
    try:
        sky.air_density = AIR
        sky.aerosol_density = AEROSOL
        sky.ozone_density = OZONE
        sky.altitude = 900.0
    except AttributeError:
        pass
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    return sky, bg, out


def build_world(scene, name="DustCreekSky"):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    sky_node_setup(w.node_tree)
    scene.world = w
    return w


def build_sun(col):
    d = bpy.data.lights.new("SunLamp", 'SUN')
    d.energy = SUN_STRENGTH
    d.color = SUN_COLOR
    d.angle = math.radians(SUN_ANGLE_DEG)
    ob = bpy.data.objects.new("SunLamp", d)
    # lamps shine along local -Z: make local +Z point at the sun
    m = axis_matrix(sun_vector())  # local +Y -> sun_vector
    # rotate so that +Z (not +Y) points at the sun
    from mathutils import Matrix
    q = sun_vector().to_track_quat('Z', 'Y')
    ob.rotation_euler = q.to_euler()
    col.objects.link(ob)
    return ob
