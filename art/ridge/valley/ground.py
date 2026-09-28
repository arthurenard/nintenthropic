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


def review_material(maps_dir, tiles_dir=None, name="terrain_review"):
    """Cycles version of the game's terrain shader (see README):
        w_i     = splat_i * (0.25 + height_i)          height-weighted blend, normalised
        albedo  = color_map * sum_i w_i * tile_i / mean_i
        normal  = the world normal map, bent by sum_i w_i * tile normal_i
        rough   = sum_i w_i * rough_i
    Tiles are projected on world XY at their own size; rock is box-projected
    (triplanar) so cliffs are not smeared."""
    import json
    from . import landcover as LC
    m, g = new_material(name)
    uv = g.uv('logpolar')
    col = g.image(_img(os.path.join(maps_dir, "color.png"), 'sRGB', "terrain_color"), uv, extension='EXTEND')
    nimg = g.image(_img(os.path.join(maps_dir, "normal.png"), 'Non-Color', "terrain_normal"), uv, extension='EXTEND')
    nv = g.vmath('MULTIPLY_ADD', nimg, (2.0, 2.0, 2.0))
    nv.node.inputs[2].default_value = (-1.0, -1.0, -1.0)
    gx, gy, gz = g.separate(nv)
    nmacro = g.vmath('NORMALIZE', g.combine(gx, g.mul(gz, -1.0), gy))
    if not tiles_dir or not os.path.exists(os.path.join(tiles_dir, "tiles.json")):
        g.output(g.principled(col, rough=0.92, spec=0.25, normal=nmacro))
        return m
    info = json.load(open(os.path.join(tiles_dir, "tiles.json")))
    splat = []
    for k in (0, 1):
        n = g.new('ShaderNodeTexImage', interpolation='Linear', extension='EXTEND')
        img = _img(os.path.join(maps_dir, f"splat{k}.png"), 'Non-Color', f"terrain_splat{k}")
        img.alpha_mode = 'CHANNEL_PACKED'
        n.image = img
        g.links.new(uv, n.inputs['Vector'])
        r_, g_, b_ = g.sep_rgb(n.outputs['Color'])
        splat += [r_, g_, b_, n.outputs['Alpha']]
    pos = g.texco('Object')
    geo_n = g.geo('Normal')
    wsum = None
    acc_c = None
    acc_n = None
    acc_r = None
    for i, mat in enumerate(LC.MATERIALS):
        t = info[mat]
        size = t['size_m']
        vec = g.vmath('SCALE', pos, None)
        vec.node.inputs['Scale'].default_value = 1.0 / size
        box = mat in ('rock', 'scree')
        def tex(kind, cs):
            n = g.new('ShaderNodeTexImage', interpolation='Linear', extension='REPEAT')
            n.image = _img(os.path.join(tiles_dir, f"{mat}_{kind}.png"), cs, f"tile_{mat}_{kind}")
            if box:
                n.projection = 'BOX'
                n.projection_blend = 0.25
            g.links.new(vec, n.inputs['Vector'])
            return n.outputs['Color']
        alb = tex('albedo', 'sRGB')
        hra = tex('hra', 'Non-Color')
        tn = tex('normal', 'Non-Color')
        h_, r_, a_ = g.sep_rgb(hra)
        w = g.mul(splat[i], g.add(h_, 0.25))
        mean = t['mean_linear']
        detail = g.node('ShaderNodeMix', inputs={'Factor_Float': 1.0}, out=None, data_type='RGBA', blend_type='DIVIDE')
        g.set_in(detail, 'A_Color', alb)
        g.set_in(detail, 'B_Color', tuple(max(c, 1e-3) for c in mean))
        dcol = g.out(detail, 'Result_Color')
        if not box:
            # anti-tiling: the tile again at 2.618x its size, turned 37 degrees,
            # modulating the first - the two periods never line up, so the
            # 3 m grid a meadow shows through the scope goes away
            rot = g.new('ShaderNodeVectorRotate', rotation_type='Z_AXIS')
            rot.inputs['Angle'].default_value = math.radians(37.0)
            g.links.new(pos, rot.inputs['Vector'])
            v2 = g.vmath('MULTIPLY_ADD', rot.outputs['Vector'], (1.0 / (size * 2.618),) * 3)
            v2.node.inputs[2].default_value = (0.37, 0.61, 0.0)
            n2 = g.new('ShaderNodeTexImage', interpolation='Linear', extension='REPEAT')
            n2.image = _img(os.path.join(tiles_dir, f"{mat}_albedo.png"), 'sRGB', f"tile_{mat}_albedo")
            g.links.new(v2, n2.inputs['Vector'])
            d2 = g.node('ShaderNodeMix', inputs={'Factor_Float': 1.0}, out=None, data_type='RGBA', blend_type='DIVIDE')
            g.set_in(d2, 'A_Color', n2.outputs['Color'])
            g.set_in(d2, 'B_Color', tuple(max(c, 1e-3) for c in mean))
            half = g.vmath('MULTIPLY_ADD', g.out(d2, 'Result_Color'), (0.5, 0.5, 0.5))
            half.node.inputs[2].default_value = (0.5, 0.5, 0.5)
            dcol = g.vmath('MULTIPLY', dcol, half)
        wc = g.vmath('SCALE', dcol, None)
        g.links.new(w, wc.node.inputs['Scale'])
        # tile normal: tangent space with world X/Y as tangent/bitangent (a
        # top-down projection), bent onto the geometric normal; its offset from
        # the geometric normal is what we add to the macro normal
        nm = g.node('ShaderNodeNormalMap', inputs={'Color': tn, 'Strength': 1.0}, space='TANGENT', uv_map='tiles')
        delta = g.vmath('SUBTRACT', nm, geo_n)
        wn = g.vmath('SCALE', delta, None)
        g.links.new(w, wn.node.inputs['Scale'])
        wr = g.mul(w, r_)
        wsum = w if wsum is None else g.add(wsum, w)
        acc_c = wc if acc_c is None else g.vadd(acc_c, wc)
        acc_n = wn if acc_n is None else g.vadd(acc_n, wn)
        acc_r = wr if acc_r is None else g.add(acc_r, wr)
    inv = g.math('DIVIDE', 1.0, g.math('MAXIMUM', wsum, 1e-4))
    detail = g.vmath('SCALE', acc_c, None)
    g.links.new(inv, detail.node.inputs['Scale'])
    albedo = g.mix(1.0, col, detail, blend='MULTIPLY')
    dn = g.vmath('SCALE', acc_n, None)
    g.links.new(inv, dn.node.inputs['Scale'])
    normal = g.vmath('NORMALIZE', g.vadd(nmacro, dn))
    rough = g.mul(acc_r, inv)
    g.output(g.principled(albedo, rough=rough, spec=0.3, normal=normal))
    return m


def assign(objs, mat):
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
