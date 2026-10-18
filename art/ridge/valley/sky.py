"""sky.webp: the dawn sky and the world beyond the terrain mesh, rendered
from the player's eye as an equirectangular panorama (Three.js layout:
u = 0.25 looks along -Z, down the valley's axis of view; u = 0.5 is +X;
top row is straight up).

In it: the multiple-scattering sky at the dawn sun; a veil of high cirrus
catching the sun gold and pink; the whole heightfield (the mountains behind
the player, the down-valley ranges beyond the 6 km of terrain mesh) and a
ring of distant ranges out to 45 km, all lit by the same sun and hazed by
the same air as the review renders. The game draws it as background and
as environment light (PMREM); where its terrain mesh stands in front, the
same mountains continue seamlessly behind.
"""

import math
import os

import bpy
import numpy as np

from . import scene as S
from . import noise as N
from .scene import new_material


def log(*a):
    print("[sky]", *a, flush=True)


def far_material():
    """The far world's ground: rock, snow above the snowline, dark forest and
    pale meadow below the treeline - by altitude and slope."""
    m, g = new_material("far_world")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    nz = g.separate(g.geo('Normal'))[2]
    n1 = g.noise(pos, scale=0.0008, detail=4.0)
    n2 = g.noise(pos, scale=0.004, detail=6.0)
    rock = g.mix(n2, g.rgb((0.10, 0.095, 0.09)), g.rgb((0.16, 0.15, 0.14)))
    forest = g.rgb((0.035, 0.045, 0.03))
    meadow = g.rgb((0.10, 0.10, 0.05))
    alt = g.add(z, g.mul(g.sub(n1, 0.5), 180.0))
    low = g.mix(g.smooth(n2, 0.45, 0.6), forest, meadow)
    col = g.mix(g.smooth(alt, 300.0, 450.0), low, rock)
    col = g.mix(g.smooth(nz, 0.55, 0.8), rock, col)
    snow = g.mul(g.smooth(alt, 650.0, 900.0), g.smooth(nz, 0.35, 0.7))
    col = g.mix(snow, col, g.rgb((0.72, 0.74, 0.78)))
    g.output(g.principled(col, rough=0.95, spec=0.2))
    return m


def cloud_material():
    """Thin high cirrus: streaks in patches, lit from below and the side by
    the dawn sun - gold where thick, pink at the edges, the sky's blue where
    thin. Emission (cirrus barely shades itself)."""
    m, g = new_material("far_clouds")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    km = 1.0 / 1000.0
    u = g.mul(g.add(x, g.mul(y, 0.4)), km)
    v = g.mul(g.sub(y, g.mul(x, 0.25)), km)
    streak = g.noise(g.combine(g.mul(u, 0.30), g.mul(v, 2.2), 0.0), scale=1.0, detail=10.0, rough=0.62, dist=0.35)
    fine = g.noise(g.combine(g.mul(u, 1.8), g.mul(v, 8.0), 3.0), scale=1.0, detail=6.0, rough=0.6)
    patch = g.noise(g.combine(g.mul(u, 0.10), g.mul(v, 0.10), 7.0), scale=1.0, detail=2.0)
    dens = g.mul(g.smooth(g.add(g.mul(streak, 0.75), g.mul(fine, 0.25)), 0.52, 0.74), g.smooth(patch, 0.45, 0.62))
    thick = g.smooth(fine, 0.35, 0.75)
    warm = g.mix(thick, g.rgb((1.0, 0.62, 0.66)), g.rgb((1.0, 0.78, 0.52)))
    em = g.node('ShaderNodeEmission', inputs={'Color': warm, 'Strength': 1.6}, out=0)
    tr = g.node('ShaderNodeBsdfTransparent', inputs={'Color': (1, 1, 1)}, out=0)
    g.output(g.node('ShaderNodeMixShader', inputs={0: g.mul(dens, 0.8), 1: tr, 2: em}, out=0))
    return m


def build_far_world(ter, col):
    """The coarse heightfield as one mesh (24 m), and a ring of distant ranges."""
    c = ter.coarse
    step = 3
    v = c.v[::step, ::step]
    ny, nx = v.shape
    xs = c.x0 + np.arange(nx) * c.dx * step
    ys = c.y0 + np.arange(ny) * c.dx * step
    X, Y = np.meshgrid(xs, ys)
    V = np.stack([X.ravel(), Y.ravel(), v.ravel() - 1.0], 1)
    idx = np.arange(nx * ny).reshape(ny, nx)
    F = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
    fm = far_material()
    near = S.mesh_object("sky.far_near", V, F, col, smooth=True, export=0)
    near.data.materials.append(fm)
    # distant ranges: a ring of ridged mountains 11-45 km out
    nr, na = 60, 720
    rs = np.geomspace(9000.0, 45000.0, nr)
    ang = np.linspace(0, 2 * np.pi, na, endpoint=False)
    RR, AA = np.meshgrid(rs, ang, indexing='ij')
    PX, PY = RR * np.sin(AA), RR * np.cos(AA)
    h = (N.ridged(PX / 5000.0, PY / 5000.0, 77, octaves=6, gain=0.5) * 1700.0 +
         N.fbm(PX, PY, 78, octaves=3, scale=1 / 20000.0) * 500.0 - 150.0)
    h *= np.clip((RR - 8000.0) / 6000.0, 0, 1)
    # the valley runs out down-valley (bearing ~ -45): keep that direction lower
    b = np.degrees(AA)
    b = (b + 180) % 360 - 180
    h -= 900.0 * np.exp(-((b + 45) / 9.0) ** 2) * np.clip((RR - 8000) / 4000, 0, 1)
    V2 = np.stack([PX.ravel(), PY.ravel(), h.ravel() - 80.0], 1)
    idx = np.arange(nr * na).reshape(nr, na)
    q = []
    for i in range(nr - 1):
        for j in range(na):
            j2 = (j + 1) % na
            q.append((idx[i, j], idx[i, j2], idx[i + 1, j2], idx[i + 1, j]))
    far = S.mesh_object("sky.far_ranges", V2, np.array(q), col, smooth=True, export=0)
    far.data.materials.append(fm)
    # cirrus deck at 8 km
    k = 120000.0
    cl = S.mesh_object("sky.clouds", np.array([[-k, -k, 8000], [k, -k, 8000], [k, k, 8000], [-k, k, 8000]]),
                       np.array([[0, 1, 2, 3]]), col, smooth=False, export=0)
    cl.data.materials.append(cloud_material())
    cl.visible_shadow = False
    return [near, far, cl]


def render(ctx, ter, w=4096, h=2048, samples=96, name="sky"):
    from . import post
    sc = bpy.context.scene
    S.apply_lighting(sc)
    col = S.collection("sky_world", bpy.data.collections["Valley"])
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    far = build_far_world(ter, col)
    hidden = []
    for ob in sc.objects:
        if ob.type in ('MESH', 'CURVE') and ob not in far and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)
    cd = bpy.data.cameras.new("sky_cam")
    cd.type = 'PANO'
    try:
        cd.panorama_type = 'EQUIRECTANGULAR'
    except AttributeError:
        cd.cycles.panorama_type = 'EQUIRECTANGULAR'
    cd.clip_start = 1.0
    cd.clip_end = 2.0e6
    cam = bpy.data.objects.new("sky_cam", cd)
    cam.location = (0.0, 0.0, 0.0)
    # Blender's equirect looks along +Y at (90, 0, 0); turning -90 about Z puts
    # +X at the image centre - Three.js's layout (u = 0.25 is -Z glTF = +Y Blender)
    cam.rotation_euler = (math.radians(90), 0.0, math.radians(-90))
    sc.collection.objects.link(cam)
    sc.camera = cam
    S.render_settings(sc, w, h, samples)
    sc.cycles.adaptive_threshold = 0.01
    rgb, P = post.render_with_fog(sc, os.path.join(ctx.build, f"{name}_render.png"), fmt='PNG')
    # the far world gets the haze; the sky itself is already the sky
    rgb2 = far_haze(rgb, P)
    out = os.path.join(ctx.assets, f"{name}.webp")
    post.save_display(rgb2, out, sc, fmt='WEBP', quality=88)
    np.save(os.path.join(ctx.build, f"{name}_linear.npy"), rgb2.astype(np.float16))
    for ob in hidden:
        ob.hide_render = False
    bpy.data.objects.remove(cam)
    log("wrote", out, os.path.getsize(out) // 1024, "KB")


def far_haze(rgb, P):
    """Distant ranges fade into the horizon's colour much more than the
    near air's haze allows (tens of km of air): an extra extinction beyond
    6 km."""
    from . import post
    d = np.linalg.norm(P, axis=-1)
    valid = d > 1.0
    T = np.exp(-np.clip(d - 6000.0, 0, None) / 30000.0)[..., None]
    out = rgb * T + post.HAZE_COLOR * (1 - T)
    return np.where(valid[..., None], out, rgb)
