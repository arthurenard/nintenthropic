"""The stages of the Orbital Decay build, called from build_orbit.py.

Each stage reads what earlier stages left in art/orbit/build/ (or in
public/assets/orbit/) and can be rerun alone.
"""

import json
import math
import os
import time

import numpy as np

from . import imgio

F32 = np.float32


class Context:
    def __init__(self, build, assets, quick=False, review_dir=None, preview=None, only=None):
        self.build, self.assets = build, assets
        self.quick = quick
        self.review_dir = review_dir or os.path.join(build, "review")
        self.preview = preview
        self.only = only
        os.makedirs(self.review_dir, exist_ok=True)
        os.makedirs(os.path.join(assets, "planet"), exist_ok=True)

    def path(self, *p):
        return os.path.join(self.build, *p)

    def asset(self, *p):
        return os.path.join(self.assets, *p)


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# planet and stars (numpy, no Blender scene needed)

PLANET_Q = dict(albedo=88, clouds=88, night=86, height=82, detail=88)


def stage_planet(ctx):
    from . import planet as PL
    W = 1024 if ctx.quick else 4096
    p = PL.Planet(W, W // 2, log=log).generate()
    d = ctx.asset("planet")
    sizes = {}
    sizes['albedo'] = imgio.write(os.path.join(d, "albedo.webp"), imgio.srgb_encode(p.albedo), PLANET_Q['albedo'])
    sizes['clouds'] = imgio.write(os.path.join(d, "clouds.webp"), p.clouds, PLANET_Q['clouds'])
    sizes['night'] = imgio.write(os.path.join(d, "night.webp"), imgio.srgb_encode(p.night), PLANET_Q['night'])
    sizes['water'] = imgio.write(os.path.join(d, "water.webp"), p.water, lossless=True)
    sizes['height'] = imgio.write(os.path.join(d, "height.webp"), p.height, PLANET_Q['height'])
    sizes['detail'] = imgio.write(os.path.join(d, "detail.webp"), p.detail_rgb, PLANET_Q['detail'])
    meta = dict(p.meta)
    meta['cities'] = None
    meta['size'] = [W, W // 2]
    meta['files_kb'] = {k: round(v / 1024) for k, v in sizes.items()}
    with open(ctx.path("planet_meta.json"), "w") as f:
        json.dump(meta, f, indent=1, default=float)
    for k, v in sizes.items():
        log(f"  planet/{k}.webp {v / 1024:.0f} KB")
    log(f"  meta {json.dumps({k: meta[k] for k in ('hi', 'storm', 'hurricanes') if k in meta})}")


def stage_stars(ctx):
    from . import stars as ST
    W = 2048 if ctx.quick else 4096
    img, meta = ST.generate(W, W // 2, log=log)
    size = imgio.write(ctx.asset("stars.webp"), imgio.srgb_encode(img), 88)
    np.save(ctx.path("stars_meta.npy"), meta, allow_pickle=True)
    log(f"  stars.webp {size / 1024:.0f} KB")


def load_maps(ctx, stars=True, detail=True):
    """The delivered maps, decoded the way the game decodes them."""
    from . import planetrender as PR
    d = ctx.asset("planet")
    alb = imgio.srgb_decode(imgio.read(os.path.join(d, "albedo.webp"), 3))
    clo = imgio.read(os.path.join(d, "clouds.webp"), 1)[..., 0]
    nig = imgio.srgb_decode(imgio.read(os.path.join(d, "night.webp"), 3))
    wat = imgio.read(os.path.join(d, "water.webp"), 1)[..., 0]
    hei = imgio.read(os.path.join(d, "height.webp"), 1)[..., 0]
    det = imgio.read(os.path.join(d, "detail.webp"), 3) if detail else None
    st = imgio.srgb_decode(imgio.read(ctx.asset("stars.webp"), 3)) if stars else None
    return PR.Maps(alb, clo, nig, wat, hei, det, None if st is None else _stars_to_planet_frame(st))


def _stars_to_planet_frame(st):
    """stars.webp is laid out in the game's world frame (three.js equirect
    around the eye). The renderer samples the sky with planet-frame rays,
    so resample it into the planet frame once."""
    from . import world, noise as N
    H, W = st.shape[:2]
    Wp, Hp = min(W, 4096), min(H, 2048)
    lon, lat = N.lonlat_grid(Wp, Hp)
    Dp = N.sphere_points(lon, lat).reshape(-1, 3).astype(np.float64)
    Dw = Dp @ world.planet_rotation().T          # planet -> world (Blender)
    # Blender world -> three.js world (x, z, -y), then three's equirect uv
    x, y, z = Dw[:, 0], Dw[:, 2], -Dw[:, 1]
    u = np.arctan2(z, x) / (2 * math.pi) + 0.5
    v = 0.5 - np.arcsin(np.clip(y, -1, 1)) / math.pi
    out = N.sample(st, u.astype(F32), v.astype(F32)).reshape(Hp, Wp, 3)
    return out.astype(F32)


class Sky:
    """A lighting setup for the planet renderer: where the sun is, how
    bright the stars are, the exposure."""

    def __init__(self, sun_world=None, star_gain=0.0, night_gain=0.6):
        from . import world
        self.sun_world = np.asarray(sun_world if sun_world is not None else world.sun_dir(), np.float64)
        self.star_gain = star_gain
        self.night_gain = night_gain


def render_planet_view(maps, rays_world, sky, samples=48, sun_disc=True, exposure=1.0):
    """Radiance of the planet, its atmosphere and the stars along world rays
    from the eye. Returns (N, 3) linear radiance (sun irradiance 20)."""
    from . import planetrender as PR, world
    Mt = world.planet_rotation().T
    D = (rays_world.astype(np.float64) @ Mt.T).astype(F32)
    O = world.eye_in_planet_km().astype(F32)
    sun_p = (Mt @ sky.sun_world).astype(F32)
    st = PR.Settings()
    st.samples = samples
    st.star_gain = sky.star_gain
    st.night_gain = sky.night_gain
    st.sun_disc = sun_disc
    st.exposure = exposure
    L, cov = PR.render_rays(O, D, sun_p, maps, st)
    return L, cov


def render_env(ctx, name, sky, W=2048, maps=None, samples=40):
    """The planet as the station sees it, as a world environment (equirect,
    this build's convention: see planetrender.equirect_rays) for lighting:
    earthshine from below, black space above. No sun disc: in Blender the
    sun is a lamp."""
    from . import planetrender as PR
    maps = maps or load_maps(ctx)
    t = time.time()
    D = PR.equirect_rays(W, W // 2)
    L, _ = render_planet_view(maps, D, sky, samples=samples, sun_disc=False)
    env = np.minimum(L.reshape(W // 2, W, 3), 60.0)
    path = ctx.path(name)
    imgio.write_exr(path, env)
    log(f"  {name} {W}x{W // 2} in {time.time() - t:.1f}s, mean {env.mean():.3f}")
    return path


def stage_env(ctx):
    render_env(ctx, "env_day.exr", Sky(star_gain=0.0), W=1024 if ctx.quick else 2048, samples=24 if ctx.quick else 40)


# ---------------------------------------------------------------------------
# The station scene: cupola + station exterior, shared by the cupola bake,
# the station bake, the review and the poster

def scene_blend(ctx):
    return ctx.path("orbit_scene.blend")


def build_scene(ctx):
    import bpy
    from . import bl, materials, cupola, render
    t = time.time()
    sc = bl.reset_scene("Orbit")
    bl.setup_gpu(sc)
    materials.interior_materials()
    materials.exterior_materials()
    lib = materials.LIB
    root = bl.collection("Orbit")
    c_cup = bl.collection("cupola", root)
    c_st = bl.collection("station", root)
    c_con = bl.collection("contract", root)
    c_light = bl.collection("lighting", root)
    cam = render.player_camera(c_con)
    sc.camera = cam
    render.sun_lamp(c_light)
    env = ctx.path("env_day.exr")
    if os.path.exists(env):
        render.world_env(sc, env)
    cup = cupola.build(lib, c_cup)
    cupola.node_room(lib, bl.collection("room", root))
    try:
        from . import station
    except ImportError:
        station = None
    if station is not None:
        station.build(lib, c_st, c_con)
    log(f"  scene built in {time.time() - t:.1f}s: {len(bpy.data.objects)} objects, "
        f"{bl.tri_count(bpy.data.objects):,} triangles")
    bpy.ops.wm.save_as_mainfile(filepath=scene_blend(ctx), compress=True)
    return cup


def open_blend(path):
    import bpy
    from . import bl
    bpy.ops.wm.open_mainfile(filepath=path)
    bl.setup_gpu()


def stage_cupola(ctx):
    only = ctx.only or ["build", "bake", "export"]
    if "build" in only:
        build_scene(ctx)
    if "bake" in only:
        from . import bake
        bake.stage(ctx)
    if "export" in only:
        from . import export
        export.cupola(ctx)


def stage_station(ctx):
    from . import export
    export.station(ctx)


def stage_debris(ctx):
    from . import assets
    assets.stage_debris(ctx)


def stage_drone(ctx):
    from . import assets
    assets.stage_drone(ctx)


def stage_derelict(ctx):
    from . import assets
    assets.stage_derelict(ctx)


def stage_extras(ctx):
    from . import assets
    assets.stage_extras(ctx)


def stage_poster(ctx):
    from . import poster
    poster.stage(ctx)


def stage_review(ctx):
    from . import review
    review.render_all(ctx)
