"""Aerial perspective and dust, applied the same way to the review renders
and to the baked textures.

Because the player never moves, the haze between the eye and any surface
point is known in advance: it depends only on the point's distance from the
eye and its height. So we apply it in one place, in numpy, from a world
position per pixel (renders: Cycles' Position pass; bakes: a baked position
map). The web game then shows exactly what Cycles showed, haze included.

Model: uniform aerial extinction plus exponential height fog (dust hangs
low over the street), integrated analytically along the eye ray; the
in-scattered colour is a sunlit dust tan that matches the horizon.
"""

import math
import os

import bpy
import numpy as np

EYE = np.array([0.0, 0.0, 1.7])
SIGMA = 1.0 / 1600.0         # clear-air extinction per metre (distance haze)
SIGMA_H = 0.005              # dust extinction per metre at the ground
H_SCALE = 6.0                # dust scale height (m)
FOG_COLOR = np.array([0.30, 0.235, 0.165])   # replaced by the sky stage's measurement (fog_color())
_fog_cache = None


def fog_color():
    """In-scattered colour: the sky's own horizon colour straight ahead
    (measured by the sky stage), warmed a little by sunlit dust."""
    global _fog_cache
    if _fog_cache is not None:
        return _fog_cache
    import json
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(here, "build", "sky_horizon.json")
    col = FOG_COLOR
    if os.path.exists(path):
        h = np.array(json.load(open(path))["horizon"])
        lum = float(h @ [0.2126, 0.7152, 0.0722])
        dust = np.array([1.0, 0.8, 0.6])
        dust = dust * lum / float(dust @ [0.2126, 0.7152, 0.0722])
        col = 0.65 * h + 0.35 * dust
    _fog_cache = col
    return col


SHADOW_TINT = np.array([0.9, 0.99, 1.1])       # dusty teal in the shade
LIGHT_TINT = np.array([1.06, 1.0, 0.92])        # amber where the sun lands


def grade(rgb):
    """The look, in scene-linear before the view transform: shadows lean
    teal, sunlit values lean amber. Same function for renders, bakes, sky."""
    L = rgb @ np.array([0.2126, 0.7152, 0.0722])
    t = np.clip((np.log2(np.maximum(L, 1e-5)) + 5.0) / 3.5, 0.0, 1.0)[..., None]   # ~0.03 .. 0.35
    t = t * t * (3 - 2 * t)
    return rgb * (SHADOW_TINT * (1 - t) + LIGHT_TINT * t)


def optical_depth(P):
    d = np.linalg.norm(P - EYE, axis=-1)
    z0 = EYE[2]
    z1 = P[..., 2]
    dz = z1 - z0
    a = math.exp(-z0 / H_SCALE)
    b = np.exp(-np.clip(z1, -5, 200) / H_SCALE)
    with np.errstate(divide='ignore', invalid='ignore'):
        hf = np.where(np.abs(dz) > 1e-3, d * H_SCALE * (a - b) / np.where(np.abs(dz) > 1e-3, dz, 1.0), d * a)
    return SIGMA * d + SIGMA_H * hf


def apply_fog(rgb, P, valid=None):
    """rgb, P: (..., 3) arrays (linear radiance, world position)."""
    T = np.exp(-optical_depth(P))[..., None]
    out = rgb * T + fog_color() * (1.0 - T)
    if valid is not None:
        out = np.where(valid[..., None], out, rgb)
    return out


# ---------------------------------------------------------------------------
# EXR I/O (OpenImageIO ships with Blender)

def read_exr_layers(path):
    """Read a Blender multilayer EXR (Blender 5 writes one EXR *part* per
    pass) into {'rgb', 'alpha', 'pos'} numpy arrays, top row first."""
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    chans = {}
    sub = 0
    while inp.seek_subimage(sub, 0):
        spec = inp.spec()
        data = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, oiio.FLOAT))
        data = data.reshape(spec.height, spec.width, spec.nchannels)
        for k, n in enumerate(spec.channelnames):
            chans[n] = data[..., k]
        sub += 1
    inp.close()

    def pick(pass_name, comps):
        found = []
        for c in comps:
            key = next((n for n in chans if n.endswith(f".{pass_name}.{c}")), None)
            if key is None:
                return None
            found.append(chans[key])
        return np.stack(found, axis=-1)
    out = {}
    rgb = pick("Combined", "RGB")
    if rgb is not None:
        out['rgb'] = rgb
    pos = pick("Position", "XYZ")
    if pos is not None:
        out['pos'] = pos
    a = next((n for n in chans if n.endswith(".Combined.A")), None)
    if a:
        out['alpha'] = chans[a]
    return out


def display_hex(rgb, scene):
    """One scene-linear colour through the view transform, as '#rrggbb'."""
    import tempfile
    tmp = os.path.join(tempfile.gettempdir() if not bpy.app.tempdir else bpy.app.tempdir, "__hex.png")
    save_display(np.array(rgb, dtype=np.float32).reshape(1, 1, 3) * np.ones((4, 4, 1), np.float32), tmp, scene)
    img = bpy.data.images.load(tmp)
    px = list(img.pixels[:4])
    bpy.data.images.remove(img)
    return "#%02x%02x%02x" % tuple(int(round(max(0, min(1, c)) * 255)) for c in px[:3])


def save_display(rgb, path, scene, fmt='PNG', quality=90, flip=True):
    """Write linear RGB through the scene's view transform (AgX), exactly as
    a render would be saved."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new("__post", w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb[::-1] if flip else rgb
    img.pixels.foreach_set(px.ravel())
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    old = (s.file_format, s.color_mode, s.quality, s.color_depth)
    s.file_format = fmt
    s.color_mode = 'RGB'
    if fmt in ('JPEG', 'WEBP'):
        s.quality = quality
    if fmt == 'PNG':
        s.color_depth = '8'
    img.save_render(path, scene=scene)
    s.file_format, s.color_mode, s.quality = old[0], old[1], old[2]
    bpy.data.images.remove(img)


def render_with_fog(scene, path_png, exr_path=None, fog=True, fmt='PNG', quality=92):
    """Render the scene's camera with a Position pass, add haze, save."""
    vl = scene.view_layers[0]
    vl.use_pass_position = True
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'MULTI_LAYER_IMAGE'   # Blender 5: multilayer EXR lives here
    s.file_format = 'OPEN_EXR_MULTILAYER'
    s.color_depth = '32'
    s.exr_codec = 'ZIP'
    exr = exr_path or (os.path.splitext(path_png)[0] + ".exr")
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    L = read_exr_layers(exr)
    rgb = L['rgb']
    if fog:
        pos = L['pos']
        valid = np.linalg.norm(pos, axis=-1) > 1e-3
        rgb = apply_fog(rgb, pos, valid)
    rgb = grade(rgb)
    save_display(rgb, path_png, scene, fmt=fmt, quality=quality)
    if exr_path is None:
        os.remove(exr)
    return L
