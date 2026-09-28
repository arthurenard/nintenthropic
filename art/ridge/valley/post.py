"""Aerial perspective and valley mist for the review renders and the poster,
applied per pixel from Cycles' position pass - the same model the game's
shader is asked to use (the parameters are exported in valley.glb's scene
extras, see README):

    haze:  uniform extinction SIGMA_HAZE (clear dawn air) toward HAZE_COLOR,
           the sky's horizon colour looking away from the sun
    mist:  extinction MIST_SIGMA0 * exp(-(z - MIST_Z0) / MIST_H) lying in
           the valley (strongest over the river at dawn), in-scattering
           MIST_COLOR - cool, in shadow like the floor it lies on

Both integrate analytically along the eye ray (the exponential height term
has a closed form), so a pixel costs a few operations.
"""

import math
import os

import numpy as np

SIGMA_HAZE = 1.0 / 14000.0
HAZE_COLOR = np.array([0.36, 0.46, 0.62])        # scene-linear, at the review renders' exposure
MIST_SIGMA0 = 1.0 / 650.0          # on the river; the light map's alpha thins it away from it
MIST_Z0 = -60.0
MIST_H = 22.0
MIST_COLOR = np.array([0.30, 0.37, 0.46])
AIR_SHADE = 0.35                   # air in the ridge's shadow scatters this much of the sunlit air's light
MAPS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build", "maps")
_LIGHT = {}


def optical_depth(P, eye=(0.0, 0.0, 0.0)):
    E = np.asarray(eye, float)
    D = P - E
    d = np.linalg.norm(D, axis=-1)
    z0 = E[2]
    z1 = P[..., 2]
    dz = z1 - z0
    k = 1.0 / MIST_H
    a = np.exp(-(z0 - MIST_Z0) * k)
    b = np.exp(-(np.clip(z1, -200, 4000) - MIST_Z0) * k)
    with np.errstate(divide='ignore', invalid='ignore'):
        mist = np.where(np.abs(dz) > 1e-3, d * MIST_H * (a - b) / np.where(np.abs(dz) > 1e-3, dz, 1.0), d * a)
    return d * SIGMA_HAZE, mist * MIST_SIGMA0


def river_mist(x, y):
    """How much of the valley's mist lies over a ground point: all of it on
    the river, a third of it 300 m away (the light map's alpha stores this
    for the game)."""
    from . import layout as L
    riv = L.river(step=4.0)
    d, _, _ = riv.nearest(np.asarray(x, float), np.asarray(y, float), max_dist=500.0)
    d = np.where(np.isfinite(d), d, 1e9)
    return 0.3 + 0.7 * np.exp(-(d / 150.0) ** 2)


def sunlit_at(x, y):
    """Is the ground at (x, y) in the sun at the design elevation? From the
    light map (g: the sun's horizon there, b: tree/building shadow); 1
    outside it. None if the map has not been baked."""
    from . import mesh as M
    from . import layout as L
    from .noise import smoothstep
    path = os.path.join(MAPS_DIR, "light.png")
    if not os.path.exists(path):
        return None
    if path not in _LIGHT:
        from .imgio import read
        _LIGHT[path] = read(path)
    img = _LIGHT[path]
    H, W = img.shape[:2]
    uv = M.logpolar_uv(np.asarray(x, float), np.asarray(y, float))
    inside = (uv[..., 0] >= 0) & (uv[..., 0] <= 1) & (np.hypot(x, y) <= M.MAP_R1)
    fj = np.clip(uv[..., 0] * W - 0.5, 0, W - 1.001)
    fi = np.clip((1 - uv[..., 1]) * H - 0.5, 0, H - 1.001)
    j, i = fj.astype(int), fi.astype(int)
    tj, ti = (fj - j)[..., None], (fi - i)[..., None]
    smp = ((img[i, j] * (1 - tj) + img[i, j + 1] * tj) * (1 - ti) + (img[i + 1, j] * (1 - tj) + img[i + 1, j + 1] * tj) * ti)
    gdeg = smp[..., 1] * 40.0 - 10.0
    s = smoothstep(gdeg - 0.5, gdeg + 0.5, L.SUN_ELEV) * smp[..., 2]
    return np.where(inside, s, 1.0)


def apply(rgb, P, valid, scale=1.0):
    """Haze and mist over a render. The light they scatter toward the eye is
    the sunlit air's colour where the ground seen is in the sun, and
    AIR_SHADE of it where the ground (so the air over it) lies in the ridge's
    shadow - the game gets the same from the light map."""
    th, tm = optical_depth(P)
    shape = P.shape[:-1]
    f = np.ones(shape)
    air = np.ones(shape)
    if valid.any():
        f[valid] = river_mist(P[..., 0][valid], P[..., 1][valid])
        s = sunlit_at(P[..., 0][valid], P[..., 1][valid])
        if s is not None:
            air[valid] = AIR_SHADE + (1 - AIR_SHADE) * s
    tm = tm * f
    Th = np.exp(-th)[..., None]
    Tm = np.exp(-tm)[..., None]
    out = rgb * Tm + MIST_COLOR * scale * air[..., None] * (1 - Tm)
    out = out * Th + HAZE_COLOR * scale * air[..., None] * (1 - Th)
    return np.where(valid[..., None], out, rgb)


def adapted_exposure(rgb, base, lift=2.0, key=0.16):
    """The exposure an eye at the scope settles on: the view's median
    luminance brought toward mid-grey, never darker than the wide view and at
    most `lift` stops brighter (a scope on a shaded village opens up)."""
    lum = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    m = float(np.median(lum))
    ev = math.log2(key / max(m, 1e-5))
    return float(min(max(ev, base), base + lift))


def render_with_fog(scene, path, fmt='PNG', quality=92, fog=True, adapt=False):
    import bpy
    from .tiles import _read_layers
    vl = scene.view_layers[0]
    vl.use_pass_position = True
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'MULTI_LAYER_IMAGE'
    s.file_format = 'OPEN_EXR_MULTILAYER'
    s.color_depth = '32'
    s.exr_codec = 'ZIP'
    exr = os.path.splitext(path)[0] + ".exr"
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(exr)
    comb = None
    sub = 0
    while inp.seek_subimage(sub, 0):
        spec = inp.spec()
        if any(n.endswith("Combined.R") for n in spec.channelnames):
            data = np.asarray(inp.read_image(sub, 0, 0, spec.nchannels, oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
            names = list(spec.channelnames)
            comb = np.stack([data[..., names.index(f"ViewLayer.Combined.{c}")] for c in "RGB"], -1)
        sub += 1
    inp.close()
    L = _read_layers(exr)
    P = L['Position']
    valid = np.linalg.norm(P, axis=-1) > 1e-3
    if os.environ.get("RIDGE_KEEP_RAW"):          # dev: keep the unfogged render to tune the fog on
        np.savez_compressed(os.path.splitext(path)[0] + "_raw.npz", rgb=comb.astype(np.float32), P=P.astype(np.float32))
    rgb = apply(comb, P, valid) if fog else comb
    base = scene.view_settings.exposure
    if adapt:
        scene.view_settings.exposure = adapted_exposure(rgb, base)
    save_display(rgb, path, scene, fmt=fmt, quality=quality)
    scene.view_settings.exposure = base
    os.remove(exr)
    return rgb, P


def save_display(rgb, path, scene, fmt='PNG', quality=90):
    """Linear RGB through the scene's view transform, exactly as a render."""
    import bpy
    h, w = rgb.shape[:2]
    img = bpy.data.images.new("__post", w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb[::-1]
    img.pixels.foreach_set(px.ravel())
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = fmt
    s.color_mode = 'RGB'
    if fmt in ('JPEG', 'WEBP'):
        s.quality = quality
    if fmt == 'PNG':
        s.color_depth = '8'
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
