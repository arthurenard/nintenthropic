"""The fog the game draws, reproduced for the review renders and the poster.

The baked `lit` textures carry no fog: the game draws it (it thickens between
waves and thins in the breather). To judge the art the way the player will
see it, the reviews add the same fog in numpy from a per-pixel view depth -
three.js's FogExp2 formula,

    f = 1 - exp(-(density * depth)^2),   colour = mix(colour, fog, f)

with depth the camera-space distance along the view axis - plus the extra
ground-hugging layer the design asks for ("fog lies on the road and the
fields"): a height term that adds optical depth below ~2.5 m. The numbers
are written into road.glb's scene extras as the recommended starting point.
"""

import json
import math
import os

import numpy as np

from .common import EYE, cam_basis, NIGHT
from . import world

# ~80 m of road readable before the fog closes (transmittance ~12% at 80 m)
FOG_DENSITY = 0.0182          # FogExp2 density (1/m)
GROUND_FOG = 0.012            # extra extinction per metre at the ground ...
GROUND_FOG_H = 2.2            # ... falling off with this scale height (m)
FOG_COLOR = np.array([0.040, 0.050, 0.068])   # replaced by the sky stage's horizon measurement


def fog_color():
    path = os.path.join(NIGHT, "build", "sky_horizon.json")
    if os.path.exists(path):
        try:
            h = np.array(json.load(open(path))["horizon"], np.float32)
            return h
        except Exception:
            pass
    return FOG_COLOR


def view_depth(P, eye=None, fwd=None):
    eye = np.asarray(EYE if eye is None else eye, np.float32)
    if fwd is None:
        fwd = np.asarray(cam_basis()[0], np.float32)
    return np.maximum((P - eye) @ np.asarray(fwd, np.float32), 0.0)


def transmittance(P, eye=None, fwd=None, density=FOG_DENSITY, ground=GROUND_FOG):
    """FogExp2 on view depth, times the ground layer's Beer-Lambert term
    integrated along the ray (the ray's heights from the eye to P)."""
    eye = np.asarray(EYE if eye is None else eye, np.float32)
    d = view_depth(P, eye, fwd)
    T = np.exp(-(density * d) ** 2)
    if ground > 0:
        dist = np.linalg.norm(P - eye, axis=-1)
        z0, z1 = float(eye[2]), P[..., 2]
        dz = z1 - z0
        H = GROUND_FOG_H
        a = math.exp(-z0 / H)
        b = np.exp(-np.clip(z1, -5, 400) / H)
        with np.errstate(divide='ignore', invalid='ignore'):
            hf = np.where(np.abs(dz) > 1e-3, dist * H * (a - b) / np.where(np.abs(dz) > 1e-3, dz, 1.0), dist * a)
        T = T * np.exp(-ground * hf)
    return T


def apply_fog(rgb, P, valid=None, eye=None, fwd=None, color=None, density=FOG_DENSITY, ground=GROUND_FOG):
    T = transmittance(P, eye, fwd, density, ground)[..., None]
    c = fog_color() if color is None else color
    out = rgb * T + c * (1.0 - T)
    if valid is not None:
        out = np.where(valid[..., None], out, rgb)
    return out


def read_exr_layers(path):
    """Blender 5's multilayer EXR (one part per pass) -> {'rgb', 'alpha',
    'pos', 'normal'...}, top row first. Each part is read by its own index
    (read_image's first argument is the subimage: reading part 0 each time
    would hand back the Combined pass as every other pass)."""
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    chans = {}
    sub = 0
    while inp.seek_subimage(sub, 0):
        spec = inp.spec()
        data = np.asarray(inp.read_image(sub, 0, 0, spec.nchannels, oiio.FLOAT))
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
    for key, pn, comps in (('rgb', 'Combined', 'RGB'), ('pos', 'Position', 'XYZ'), ('normal', 'Normal', 'XYZ'),
                           ('volume', 'VolumeDir', 'RGB'), ('emit', 'Emit', 'RGB')):
        v = pick(pn, comps)
        if v is not None:
            out[key] = v
    a = next((n for n in chans if n.endswith(".Combined.A")), None)
    if a:
        out['alpha'] = chans[a]
    out['_chans'] = chans
    return out


def save_display(rgb, path, scene, fmt='PNG', quality=90, flip=True):
    from dustcreek.post import save_display as s
    return s(rgb, path, scene, fmt=fmt, quality=quality, flip=flip)


def display_hex(rgb, scene):
    from dustcreek.post import display_hex as d
    return d(rgb, scene)


def render(scene, path_png, fog=True, fmt='PNG', quality=92, keep_exr=False, extra=None, eye=None, fwd=None):
    """Render the scene's camera with a Position pass, add the game's fog,
    grade, save. `extra(rgb, layers)` may add things in scene-linear first
    (a volumetric beam composited from its own pass, for instance)."""
    import bpy
    vl = scene.view_layers[0]
    vl.use_pass_position = True
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'MULTI_LAYER_IMAGE'
    s.file_format = 'OPEN_EXR_MULTILAYER'
    s.color_depth = '32'
    s.exr_codec = 'ZIP'
    exr = os.path.splitext(path_png)[0] + ".exr"
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    Lr = read_exr_layers(exr)
    rgb = Lr['rgb']
    if fog:
        cam = scene.camera
        e = np.array(cam.matrix_world.translation, np.float32) if eye is None else eye
        f = -np.array(cam.matrix_world.to_3x3().col[2], np.float32) if fwd is None else fwd
        pos = Lr['pos']
        valid = np.linalg.norm(pos, axis=-1) > 1e-3
        rgb = apply_fog(rgb, pos, valid, eye=e, fwd=f)
    if extra is not None:
        rgb = extra(rgb, Lr)
    rgb = world.grade(rgb)
    save_display(rgb, path_png, scene, fmt=fmt, quality=quality)
    if not keep_exr:
        os.remove(exr)
    return Lr
