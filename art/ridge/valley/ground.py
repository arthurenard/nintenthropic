"""The terrain in Blender: chunked meshes from mesh.py, a material that does
in Cycles what the game's terrain shader does in the browser (the colour
map times the tiles' detail by the splat weights, the world-space normal
map, triplanar tiles on steep rock), and the shadow caster: the mountains
behind the player that put the valley floor in shadow at dawn but are never
seen (render and bake only, not exported).
"""

import math
import os
import time

import bpy
import numpy as np

from . import layout as L
from . import mesh as M
from . import scene as S
from .scene import new_material, G


def log(*a):
    print("[ground]", *a, flush=True)


def build_objects(ter, col, cull=True):
    t = time.time()
    P, F, Nn, UV = M.build_arrays(ter, cull=cull)
    band, sec = M.chunk_ids(P, F)
    root = S.empty("terrain", (0, 0, 0), col, size=50.0, surface="grass",
                   note="the valley's ground: chunks terrain.<band>.<sector>; see terrain.splat for the shader's inputs")
    objs = []
    for b in range(len(M.BANDS) - 1):
        for s in range(M.SECTORS):
            sel = (band == b) & (sec == s)
            if not sel.any():
                continue
            f = F[sel]
            used = np.unique(f)
            remap = np.full(len(P), -1, np.int64)
            remap[used] = np.arange(len(used))
            ob = S.mesh_object(f"terrain.{b}.{s}", P[used], remap[f], col, normals=Nn[used],
                               uvs={"tiles": P[used][:, :2] / 4.0, "logpolar": UV[used]},
                               surface="grass", terrain_band=b, terrain_sector=s,
                               range_m=[float(M.BANDS[b]), float(min(M.BANDS[b + 1], M.R_MAX))])
            ob.parent = root
            objs.append(ob)
    log(f"{len(objs)} chunks, {sum(len(o.data.polygons) for o in objs):,} triangles ({time.time() - t:.1f}s)")
    return root, objs


def shadow_caster(ter, col, spacing=24.0):
    """The whole coarse heightfield as one light mesh 2.5 m under the true
    ground: invisible to the camera, it only casts shadows and bounce (the
    mountains behind the player, the far side's back slopes)."""
    c = ter.coarse
    step = int(round(spacing / c.dx))
    v = c.v[::step, ::step] - 2.5
    ny, nx = v.shape
    xs = c.x0 + np.arange(nx) * c.dx * step
    ys = c.y0 + np.arange(ny) * c.dx * step
    X, Y = np.meshgrid(xs, ys)
    V = np.stack([X.ravel(), Y.ravel(), v.ravel()], 1)
    idx = np.arange(nx * ny).reshape(ny, nx)
    F = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
    # Only where the eye cannot see: in the view the real (finely eroded)
    # meshes cast their own shadows, and a coarse caster there would poke
    # above the ground in every gully and black it out.
    C = V[F].mean(1)
    th = np.arctan2(C[:, 0], C[:, 1])
    r = np.hypot(C[:, 0], C[:, 1])
    insector = (th > M.THETA0 - 0.03) & (th < M.THETA1 + 0.03) & (r < M.R_MAX + 100)
    keep = ~insector
    far = insector & (r > M.CULL_FROM)
    if far.any():
        P3 = C[far].copy()
        P3[:, 2] = ter.height(P3[:, 0], P3[:, 1])
        vis = M.visible_mask(ter, P3, margin=8.0)
        keep[np.nonzero(far)[0][~vis]] = True
    F = F[keep]
    ob = S.mesh_object("shadow_caster", V, F, col, smooth=True, export=0)
    ob.visible_camera = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    return ob


def _img(path, colorspace='sRGB', name=None):
    img = bpy.data.images.load(path, check_existing=True)
    if name:
        img.name = name
    img.colorspace_settings.name = colorspace
    return img


def review_material(maps_dir, tiles=None, name="terrain_review"):
    """Cycles version of the game's terrain shader (see README):
        albedo = color_map * mix(1, sum_i splat_i * tile_i / mean_i, detail)
        normal = world normal map, bent by the tiles' normals
    `tiles`: {material: (albedo image, normal image, mean rgb)} or None."""
    m, g = new_material(name)
    uv = g.uv('logpolar')
    col = g.image(_img(os.path.join(maps_dir, "color.png"), 'sRGB', "terrain_color"), uv, extension='EXTEND')
    nimg = g.image(_img(os.path.join(maps_dir, "normal.png"), 'Non-Color', "terrain_normal"), uv, extension='EXTEND')
    # decode the glTF-axes world normal into Blender's axes: (x, y, z)_b = (x, -z, y)_gltf
    nv = g.vmath('MULTIPLY_ADD', nimg, (2.0, 2.0, 2.0))
    nv.node.inputs[2].default_value = (-1.0, -1.0, -1.0)
    gx, gy, gz = g.separate(nv)
    nb = g.vmath('NORMALIZE', g.combine(gx, g.mul(gz, -1.0), gy))
    albedo = col
    if tiles:
        pass   # the tiles' detail is added once the materials stage has made them
    bsdf = g.principled(albedo, rough=0.92, spec=0.25, normal=nb)
    g.output(bsdf)
    return m


def assign(objs, mat):
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
