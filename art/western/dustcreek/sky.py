"""The far world and the equirectangular sky.

Beyond the exported terrain (1.2 km) the town sits in an open desert with
mesas on the horizon and a few high clouds. None of that needs to be
geometry in the game: it is rendered once, from the player's eye, into
`sky.webp` (the game's background and environment light).

The same objects stay in the review scene, so Cycles review renders and the
game's picture (town.glb over sky.webp) agree.

Aerial perspective out here is done in-shader: each far surface is mixed
toward the Sky Texture's own radiance in the view direction, by
1 - exp(-distance / L) — so mesas fade into exactly the sky behind them.
"""

import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector, noise as mnoise

from .core import rng, tag, collection, MeshBuilder, Frame
from .nodes import new_material, G
from .materials import lin
from . import lighting

HAZE_L = 20000.0     # metres: far haze length for mesas and desert floor
CLOUD_Z = 5200.0


def _haze_mix(g, surface, L=HAZE_L, extra=None):
    """Mix a surface shader toward the sky's radiance along the view ray."""
    sky = g.new('ShaderNodeTexSky')
    sky.sky_type = lighting.SKY_TYPE
    sky.sun_elevation = math.radians(lighting.SUN_EL_DEG)
    sky.sun_rotation = math.radians(180.0 - lighting.SUN_AZ_DEG)
    sky.sun_disc = False
    try:
        sky.aerosol_density = lighting.AEROSOL
        sky.air_density = lighting.AIR
        sky.ozone_density = lighting.OZONE
        sky.altitude = 900.0
    except AttributeError:
        pass
    inc = g.geo('Incoming')
    view = g.vmath('SCALE', inc, None)
    view.node.inputs['Scale'].default_value = -1.0
    # keep the haze colour from the horizon band (the sky texture is dark
    # below the horizon): clamp the view direction's z to >= 0.02
    vx, vy, vz = g.separate(view)
    vdir = g.vmath('NORMALIZE', g.combine(vx, vy, g.math('MAXIMUM', vz, 0.02)))
    g.links.new(vdir, sky.inputs['Vector'])
    em = g.node('ShaderNodeEmission', inputs={'Color': sky.outputs[0], 'Strength': lighting.SKY_STRENGTH}, out=0)
    dist = g.node('ShaderNodeCameraData', out='View Distance')
    fac = g.sub(1.0, g.math('EXPONENT', g.mul(dist, -1.0 / L)))
    if extra is not None:
        fac = g.math('MAXIMUM', fac, extra)
    return g.node('ShaderNodeMixShader', inputs={0: fac, 1: surface, 2: em}, out=0)


def mesa_material():
    m, g = new_material("far_mesa")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    strata = g.noise(g.combine(g.mul(x, 0.002), g.mul(y, 0.002), g.mul(z, 0.08)), scale=1.0, detail=4.0)
    bands = g.wave(g.combine(g.mul(x, 0.0004), g.mul(y, 0.0004), z), scale=0.02, dist=6.0, direction='Z', detail=4.0)
    col = g.ramp(g.add(g.mul(strata, 0.75), g.mul(bands, 0.25)), [
        (0.25, lin(118, 62, 38)), (0.5, lin(158, 86, 50)), (0.7, lin(184, 112, 70)), (0.85, lin(148, 88, 56))])
    # erosion gullies: dark vertical streaks down the cliffs
    gul = g.noise(g.combine(g.mul(x, 0.03), g.mul(y, 0.03), g.mul(z, 0.002)), scale=1.0, detail=6.0, rough=0.6)
    col = g.mix(g.mul(g.smooth(gul, 0.5, 0.75), 0.6), col, g.hsv(col, v=0.55))
    # caprock: a paler, harder layer at the top edge
    top = g.smooth(g.separate(g.geo('Normal'))[2], 0.6, 0.9)
    col = g.mix(g.mul(top, 0.7), col, g.rgb(lin(176, 136, 100)))
    # talus and scrub near the base
    base = g.sub(1.0, g.smooth(z, 20.0, 160.0))
    col = g.mix(g.mul(base, 0.6), col, g.rgb(lin(150, 110, 82)))
    hgt = g.add(g.mul(g.noise(pos, scale=0.02, detail=8.0, rough=0.6), 0.6), g.mul(gul, 0.8))
    nrm = g.bump(hgt, strength=0.8, distance=12.0)
    surf = g.principled(col, rough=0.95, normal=nrm, spec=0.2)
    g.output(_haze_mix(g, surf))
    return m


def desert_far_material():
    m, g = new_material("far_desert")
    pos = g.geo('Position')
    n = g.noise(g.vmul(pos, (1, 1, 0)), scale=0.002, detail=6.0, rough=0.6)
    col = g.ramp(n, [(0.3, lin(160, 118, 84)), (0.6, lin(184, 146, 108)), (0.8, lin(168, 136, 104))])
    scrub = g.noise(pos, scale=0.05, detail=2.0)
    col = g.mix(g.mul(g.smooth(scrub, 0.6, 0.7), 0.4), col, g.rgb(lin(110, 104, 78)))
    surf = g.principled(col, rough=0.95, spec=0.2)
    g.output(_haze_mix(g, surf, L=HAZE_L * 0.8))
    return m


def cloud_material():
    """Thin high clouds: streaky cirrus in a few patches, lit by the low sun
    from behind the viewer (translucent, warm), fading into the horizon."""
    m, g = new_material("far_clouds")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    km = 1.0 / 1000.0
    # wind shear: streaks run along a skewed axis
    u = g.mul(g.add(x, g.mul(y, 0.35)), km)
    v = g.mul(g.sub(y, g.mul(x, 0.2)), km)
    streak = g.noise(g.combine(g.mul(u, 0.35), g.mul(v, 2.4), 0.0), scale=1.0, detail=10.0, rough=0.62, dist=0.35)
    fine = g.noise(g.combine(g.mul(u, 2.0), g.mul(v, 9.0), 3.0), scale=1.0, detail=6.0, rough=0.6)
    patch = g.noise(g.combine(g.mul(u, 0.12), g.mul(v, 0.12), 7.0), scale=1.0, detail=2.0)
    dens = g.mul(g.smooth(g.add(g.mul(streak, 0.75), g.mul(fine, 0.25)), 0.5, 0.72), g.smooth(patch, 0.42, 0.6))
    dens = g.mul(dens, 0.9)
    # Thin cloud at golden hour: the low sun lights it from the side and
    # below, so it glows peach-gold where thick and takes the sky's blue
    # where thin. Modelled as emission (thin cirrus barely shadows itself).
    thick = g.smooth(fine, 0.35, 0.75)
    warm = g.mix(thick, g.rgb((0.62, 0.62, 0.78)), g.rgb((1.0, 0.72, 0.52)))
    cl = g.node('ShaderNodeEmission', inputs={'Color': warm, 'Strength': lighting.SUN_STRENGTH * 0.085}, out=0)
    hazed = _haze_mix(g, cl, L=90000.0)
    transp = g.node('ShaderNodeBsdfTransparent', inputs={'Color': (1, 1, 1)}, out=0)
    g.output(g.node('ShaderNodeMixShader', inputs={0: dens, 1: transp, 2: hazed}, out=0))
    return m


def _mesa_mesh(bm, cx, cy, R, H, r, sides=96):
    """A flat-topped butte: talus skirt, near-vertical banded cliffs, a
    slightly eroded cap. Outline radius varies by angle (1D noise)."""
    ph = r.uniform(0, 100)
    def rad(a, k=1.0):
        return R * k * (1 + 0.22 * mnoise.noise(Vector((math.cos(a) * 1.3 + ph, math.sin(a) * 1.3, 0.0))) +
                        0.08 * mnoise.noise(Vector((math.cos(a) * 4 + ph, math.sin(a) * 4, 1.0))))
    levels = [(0.0, 1.55), (0.12, 1.22), (0.26, 1.04), (0.32, 1.0), (0.55, 0.985), (0.8, 0.975), (0.93, 0.965),
              (1.0, 0.92)]
    rings = []
    # buttresses and gullies: fine angular noise that runs the whole cliff
    gph = r.uniform(0, 100)
    for (t, k) in levels:
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            gully = 0.05 * mnoise.noise(Vector((math.cos(a) * 9 + gph, math.sin(a) * 9, t * 2.0)))
            rr = rad(a, k) * (1 + gully + 0.015 * r.uniform(-1, 1))
            ring.append(bm.verts.new((cx + math.cos(a) * rr, cy + math.sin(a) * rr, t * H * (1 + 0.03 * r.uniform(-1, 1)))))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(rings[-1])


def build_far(col):
    """Mesas, far desert floor and the cloud deck (not exported)."""
    r = rng("far")
    mm = mesa_material()
    dm = desert_far_material()
    cm = cloud_material()
    objs = []
    bm = bmesh.new()
    # (azimuth deg from +Y toward +X, distance m, radius m, height m)
    # (azimuth deg from +Y toward +X, distance m, radius m, height m). The
    # street frames only ~10 degrees either side of the church, so the
    # mesas that matter stand there; the rest ring the horizon for the
    # environment light and wide screens.
    for az, dist, R, H in ((-9.0, 6400, 380, 340), (-12.5, 7200, 160, 290), (-15.5, 9800, 1100, 470),
                           (6.8, 7600, 300, 410), (9.0, 8200, 120, 330), (12.5, 11800, 1300, 520),
                           (1.5, 17000, 2200, 420), (-5.5, 13500, 600, 300), (-24, 11500, 1500, 520),
                           (-38, 7200, 900, 420), (22, 8400, 380, 470), (33, 13000, 2100, 540),
                           (52, 6800, 600, 300), (-60, 9000, 1800, 350), (75, 12000, 2500, 450),
                           (-85, 14000, 2200, 400), (140, 15000, 3000, 380), (-150, 12000, 2400, 420)):
        a = math.radians(az)
        _mesa_mesh(bm, math.sin(a) * dist, math.cos(a) * dist, R, H, r)
    me = bpy.data.meshes.new("far.mesas")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("far.mesas", me)
    me.materials.append(mm)
    col.objects.link(ob)
    objs.append(ob)
    # far desert floor: a full disc just under the exported terrain (which
    # covers it near town); it gives the sky image a lit lower hemisphere,
    # which matters when the game uses the sky as environment light.
    bm = bmesh.new()
    rings = [0.0, 1100.0, 1800.0, 3000.0, 6000.0, 12000.0, 25000.0, 60000.0]
    n = 96
    vs = []
    for R in rings:
        vs.append([bm.verts.new((math.cos(2 * math.pi * i / n) * R, math.sin(2 * math.pi * i / n) * R,
                                 -0.6 - 0.00002 * R * R / 1000)) for i in range(n)])
    for k in range(1, len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((vs[k][i], vs[k + 1][i], vs[k + 1][j], vs[k][j]))   # normals up
    bm.faces.new(vs[1])
    me = bpy.data.meshes.new("far.desert")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("far.desert", me)
    me.materials.append(dm)
    col.objects.link(ob)
    objs.append(ob)
    # cloud deck
    bpy.ops.mesh.primitive_plane_add(size=300000, location=(0, 0, CLOUD_Z))
    ob = bpy.context.active_object
    ob.name = "far.clouds"
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    ob.data.materials.append(cm)
    ob.visible_shadow = False
    objs.append(ob)
    for o in objs:
        tag(o, export=0, group='sky')
    return objs


def set_sun(scene, elevation_deg, azimuth_deg):
    """Point every Sky Texture (world and far-world materials) and the sun
    lamp at a new sun."""
    import math as _m
    from mathutils import Vector as _V
    trees = [scene.world.node_tree] + [m.node_tree for m in bpy.data.materials if m.node_tree]
    for t in trees:
        for n in t.nodes:
            if n.type == 'TEX_SKY':
                n.sun_elevation = _m.radians(elevation_deg)
                n.sun_rotation = _m.radians(180.0 - azimuth_deg)
    lamp = bpy.data.objects.get("SunLamp")
    if lamp is not None:
        az, el = _m.radians(azimuth_deg), _m.radians(elevation_deg)
        v = _V((_m.sin(az) * _m.cos(el), -_m.cos(az) * _m.cos(el), _m.sin(el)))
        lamp.rotation_euler = v.to_track_quat('Z', 'Y').to_euler()
        if elevation_deg > 45:
            lamp.data.color = (1.0, 0.95, 0.88)


def render_sky(ctx, scene, w=4096, h=2048, samples=96, name="sky", noon=False):
    """Render the equirectangular sky from the player's eye with only the
    far world visible, in the Three.js equirect convention (u=0.25 looks
    down the street, u=0.5 is +X; top row is up)."""
    from . import post, pipeline
    town_cols = [c for c in bpy.data.collections if c.name not in ("farworld",)]
    hidden = []
    for ob in scene.objects:
        if ob.type in ('MESH', 'CURVE') and not any(c.name == 'farworld' for c in ob.users_collection):
            if not ob.hide_render:
                ob.hide_render = True
                hidden.append(ob)
    cd = bpy.data.cameras.new("sky_cam")
    cd.type = 'PANO'
    try:
        cd.panorama_type = 'EQUIRECTANGULAR'
    except AttributeError:
        cd.cycles.panorama_type = 'EQUIRECTANGULAR'
    cd.clip_start = 0.5
    cd.clip_end = 1.0e6      # mesas at 20 km, clouds farther
    cam = bpy.data.objects.new("sky_cam", cd)
    cam.location = (0.0, 0.0, 1.7)
    # measured: with (90,0,0) Blender's equirect centre looks +Y; turning
    # -90 about Z puts +X at the centre, which is the Three.js layout.
    cam.rotation_euler = (math.radians(90), 0.0, math.radians(-90))
    scene.collection.objects.link(cam)
    old_cam = scene.camera
    scene.camera = cam
    import json
    if noon:
        set_sun(scene, 78.0, lighting.SUN_AZ_DEG)
    far = [o for o in scene.objects if any(c.name == 'farworld' for c in o.users_collection)]
    for o in far:
        o.hide_render = True
    pipeline.render_settings(scene, 512, 256, 16)
    probe = os.path.join(ctx.build, "sky_probe.exr")
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = 'OPEN_EXR'
    s.color_depth = '32'
    scene.render.filepath = probe
    bpy.ops.render.render(write_still=True)
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(probe)
    sp = inp.spec()
    pa = np.asarray(inp.read_image(0, 0, 0, 3, oiio.FLOAT)).reshape(sp.height, sp.width, 3)
    inp.close()
    # rows for elevation 0.5..2 deg, columns for +-30 deg around straight ahead (u=0.25)
    r0 = int((0.5 - 2.0 / 180) * sp.height)
    r1 = int((0.5 - 0.5 / 180) * sp.height)
    c0 = int((0.25 - 30 / 360) * sp.width)
    c1 = int((0.25 + 30 / 360) * sp.width)
    horizon = pa[r0:r1 + 1, c0:c1].reshape(-1, 3).mean(0)
    if not noon:
        json.dump({"horizon": [float(v) for v in horizon]}, open(os.path.join(ctx.build, "sky_horizon.json"), "w"))
    print("horizon colour", horizon)
    for o in far:
        o.hide_render = False
    pipeline.render_settings(scene, w, h, samples)
    exr = os.path.join(ctx.build, f"{name}.exr")
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = 'OPEN_EXR'
    s.color_depth = '32'
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(exr)
    spec = inp.spec()
    arr = np.asarray(inp.read_image(0, 0, 0, 3, oiio.FLOAT)).reshape(spec.height, spec.width, 3)
    inp.close()
    webp = os.path.join(ctx.assets, f"{name}.webp")
    post.save_display(post.grade(arr), webp, scene, fmt='WEBP', quality=88)
    scene.camera = old_cam
    bpy.data.objects.remove(cam)
    for ob in hidden:
        ob.hide_render = False
    print("sky written", webp, os.path.getsize(webp) // 1024, "KB")
    return arr
