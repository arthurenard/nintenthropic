"""The night's light: the moon, the sky, and the grade every picture shares.

A full moon low in front and to the left, behind a veil of thin cloud: a
cold blue key that rakes the wet road toward the player (so every puddle
between here and the bus carries a streak of it) and rims whatever walks out
of the fog. The sky is a dim blue dome, brightest in the moon's corona.

Ray visibility does the physics bookkeeping:
- the moon lamp lights diffuse surfaces (it is the key) but is invisible to
  glossy rays;
- the world's moon disc and corona are what glossy rays see (the moon in the
  puddles) and what the camera sees, but diffuse rays only get the dome's
  soft glow - so the moon is never counted twice.

Exposure is day-for-night: the light ratios are photographic (a sodium pool
is several times the moonlight, not a hundred), and one scene-linear grade
(`grade`) then AgX makes every render, bake and the sky agree.
"""

import math

import bpy
import numpy as np
from mathutils import Vector

from .common import DN
from . import layout as L

MOON_COLOR = (0.62, 0.75, 1.0)
MOON_STRENGTH = 1.3          # W/m^2 at normal incidence (Blender sun units)
MOON_ANGLE_DEG = 2.2         # thin cloud spreads the disc's light: soft-edged shadows
SKY_STRENGTH = 1.0           # the dome shader carries its own radiance scale
FILL = 2.2                   # extra dome light for diffuse rays (the haze's scattered moonlight)
EXPOSURE = 1.0               # scene-linear multiplier before the grade

VIEW_TRANSFORM = 'AgX'
LOOK = 'AgX - Medium High Contrast'

# the practical lights (Blender units: W for point/spot/area)
SODIUM = (1.0, 0.50, 0.14)
STREET_W = 1700.0
NEON_RED = (1.0, 0.07, 0.06)
CANDLE = (1.0, 0.52, 0.2)
BOOTH_TINT = (0.78, 0.94, 1.0)


def moon_vector():
    """Unit vector from the scene toward the moon (Blender coords)."""
    az, el = math.radians(L.MOON_AZ_DEG), math.radians(L.MOON_EL_DEG)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def light_direction():
    return -moon_vector()


# ---------------------------------------------------------------------------
# The sky dome (world shader)

def sky_tree(nt, for_sky_image=False):
    """Night sky: gradient dome, the moon's corona, thin moonlit cloud,
    stars in the breaks, the moon disc. `for_sky_image` renders every layer
    to every ray (the picture); otherwise diffuse rays see only the soft
    dome (so the lamp is the moon's light)."""
    nt.nodes.clear()
    g = DN.G(nt)
    D = g.vmath('NORMALIZE', g.node('ShaderNodeTexCoord', out='Generated'))
    dx, dy, dz = g.separate(D)
    M = moon_vector()
    cosm = g.vmath('DOT_PRODUCT', D, tuple(M), out='Value')
    ang = g.math('ARCCOSINE', g.math('MINIMUM', cosm, 1.0))      # radians from the moon
    # dome: dark blue overhead, a paler band at the horizon (fog-lit air)
    zen = g.rgb((0.0055, 0.0085, 0.018))
    hor = g.rgb((0.042, 0.052, 0.072))
    band = g.math('EXPONENT', g.mul(g.math('MAXIMUM', dz, 0.0), -7.0))
    # what the eye sees: a taller glow of fog-lit air, so that a pine 100 m
    # out, fogged to the fog's own colour, stands against sky of about that
    # colour rather than as a pale ghost on the dark (the dome that lights
    # the scene keeps the lower band)
    band_v = g.math('EXPONENT', g.mul(g.math('MAXIMUM', dz, 0.0), -3.6))
    col = g.mix(band_v, zen, hor)
    # corona: a wide soft glow and a tight bright ring round the moon
    wide = g.math('EXPONENT', g.mul(ang, -3.2))
    tight = g.math('EXPONENT', g.mul(ang, -22.0))
    glow = g.madd(wide, 0.045, g.mul(tight, 0.3))
    col = g.vadd(col, g.vmul(g.combine(glow, glow, glow), MOON_COLOR))
    # below the horizon: dark land fading from the fog band
    ground = g.rgb((0.004, 0.0048, 0.006))
    col = g.mix(g.smooth(dz, 0.0, -0.06), col, ground)
    dome = col
    # thin cloud: streaky, patchy; lit by the moon (forward scatter) or grey
    ok = g.smooth(dz, 0.015, 0.08)
    inv = g.math('DIVIDE', 1.0, g.math('MAXIMUM', dz, 0.03))
    u = g.mul(dx, inv)
    v = g.mul(dy, inv)
    cu = g.add(u, g.mul(v, 0.45))
    cv = g.sub(v, g.mul(u, 0.25))
    streak = g.noise(g.combine(g.mul(cu, 1.0), g.mul(cv, 2.2), 0.0), scale=1.2, detail=9.0, rough=0.6, dist=0.35)
    puff = g.noise(g.combine(g.mul(cu, 2.2), g.mul(cv, 2.2), 5.0), scale=1.5, detail=6.0, rough=0.6)
    patch = g.noise(g.combine(g.mul(cu, 0.35), g.mul(cv, 0.35), 9.0), scale=1.0, detail=2.0)
    dens = g.mul(g.smooth(g.add(g.mul(streak, 0.7), g.mul(puff, 0.3)), 0.44, 0.68), g.smooth(patch, 0.26, 0.52))
    dens = g.mul(dens, ok)
    # the cloud's own light: silver where the moon is behind it, a dim grey
    # elsewhere that still stands off the dark sky (a night sky's cloud reads
    # as shapes, not as holes), darker bellies where the puffs are thick
    lit_c = g.madd(wide, 0.20, g.mul(tight, 0.6))
    belly = g.madd(g.smooth(puff, 0.45, 0.75), -0.45, 1.0)
    cloud = g.vadd(g.vmul(g.combine(lit_c, lit_c, lit_c), (0.72, 0.8, 0.95)), (0.017, 0.020, 0.027))
    cloud = g.vmul(cloud, g.combine(belly, belly, belly))
    col = g.mix(g.mul(dens, 0.92), dome, cloud)
    # stars through the breaks (fewer toward the hazy horizon and the moon)
    # (a star must cover about a texel of the 4096 sky image or it averages away)
    st = g.voronoi(g.vmul(D, (1, 1, 1)), scale=150.0, feature='F1', out='Distance')
    stc = g.voronoi(g.vmul(D, (1, 1, 1)), scale=150.0, feature='F1', out='Color')
    sr, sg, sb = g.sep_rgb(stc)
    star = g.mul(g.sub(1.0, g.smooth(st, 0.0, 0.17)), g.smooth(sr, 0.93, 0.935))
    bright = g.madd(g.math('POWER', sg, 6.0), 1.6, 0.12)
    star = g.mul(g.mul(star, bright), g.mul(g.smooth(dz, 0.08, 0.35), g.smooth(ang, 0.25, 0.6)))
    star = g.mul(star, g.sub(1.0, g.smooth(dens, 0.05, 0.35)))
    starc = g.vmul(g.combine(star, star, star), g.mix(sb, g.rgb((0.9, 0.95, 1.0)), g.rgb((1.0, 0.9, 0.78))))
    col = g.vadd(col, g.vmul(starc, (0.07, 0.07, 0.07)))
    # the disc (0.5 deg), its maria, dimmed a touch by the veil in front
    r_disc = math.radians(0.27)
    disc = g.sub(1.0, g.smooth(ang, r_disc * 0.93, r_disc * 1.05))
    mar = g.noise(g.vmul(D, (1, 1, 1)), scale=900.0, detail=3.0, rough=0.55)
    maria = g.madd(g.smooth(mar, 0.45, 0.62), -0.32, 1.0)
    veil = g.sub(1.0, g.mul(dens, 0.35))
    dr = g.mul(g.mul(disc, maria), g.mul(veil, 48.0))
    col_full = g.vadd(col, g.vmul(g.combine(dr, dr, dr), (0.93, 0.96, 1.0)))
    col_full = g.vmul(col_full, (SKY_STRENGTH, SKY_STRENGTH, SKY_STRENGTH))
    bg_full = g.node('ShaderNodeBackground', inputs={'Color': col_full, 'Strength': 1.0}, out=0)
    out = g.new('ShaderNodeOutputWorld')
    if for_sky_image:
        g.links.new(bg_full, out.inputs['Surface'])
        return out
    # what diffuse rays see: the dome and cloud, no disc, no tight corona
    # moonlight scattered by the haze and the cloud veil fills the shadows:
    # diffuse rays see a brighter, softer dome than the eye does
    soft = g.mix(g.mul(dens, 0.9), g.vadd(g.mix(band, zen, hor), g.vmul(g.combine(g.mul(wide, 0.045), g.mul(wide, 0.045), g.mul(wide, 0.045)), MOON_COLOR)),
                 g.vadd(g.vmul(g.combine(g.mul(wide, 0.11), g.mul(wide, 0.11), g.mul(wide, 0.11)), (0.72, 0.8, 0.95)), (0.010, 0.012, 0.017)))
    soft = g.mix(g.smooth(dz, 0.0, -0.06), soft, g.rgb((0.012, 0.014, 0.018)))
    bg_soft = g.node('ShaderNodeBackground', inputs={'Color': soft, 'Strength': SKY_STRENGTH * FILL}, out=0)
    lp = g.new('ShaderNodeLightPath')
    cam_or_gloss = g.math('MAXIMUM', g.out(lp, 'Is Camera Ray'), g.out(lp, 'Is Glossy Ray'))
    mix = g.node('ShaderNodeMixShader', inputs={0: cam_or_gloss, 1: bg_soft, 2: bg_full}, out=0)
    g.links.new(mix, out.inputs['Surface'])
    return out


def build_world(scene, name="Route9Night"):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    w.use_nodes = True
    sky_tree(w.node_tree)
    scene.world = w
    return w


def build_moon(col):
    d = bpy.data.lights.new("MoonLamp", 'SUN')
    d.energy = MOON_STRENGTH
    d.color = MOON_COLOR
    d.angle = math.radians(MOON_ANGLE_DEG)
    ob = bpy.data.objects.new("MoonLamp", d)
    ob.rotation_euler = moon_vector().to_track_quat('Z', 'Y').to_euler()
    ob.visible_glossy = False
    col.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------
# Grade: the look, applied in scene-linear before AgX (renders, bakes, sky)

SHADOW_TINT = np.array([0.86, 0.97, 1.14])     # moonlit shade leans blue
LIGHT_TINT = np.array([1.07, 1.0, 0.90])       # lamp-lit values lean amber


def grade(rgb):
    rgb = np.asarray(rgb, np.float32) * EXPOSURE
    Lm = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    t = np.clip((np.log2(np.maximum(Lm, 1e-6)) + 7.0) / 5.0, 0.0, 1.0)[..., None]
    t = t * t * (3 - 2 * t)
    return rgb * (SHADOW_TINT * (1 - t) + LIGHT_TINT * t)
