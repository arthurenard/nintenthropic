"""Export public/assets/ridge/valley.glb and the terrain's textures.

What goes where:
- valley.glb: the terrain chunks (a plain material whose base colour points
  at terrain/color.webp through UV1 - the game swaps in its terrain shader,
  the inputs of which terrain.splat's extras list), the buildings, bridge,
  dam and props (PBR materials from the tiles, baked AO on UV1 when the bake
  has run), the roads, the water, the forest's impostor cards with every tree
  as EXT_mesh_gpu_instancing (patched in after Blender's export), and every
  contract node. Draco meshes, WebP textures.
- terrain/*.webp beside it: the log-polar maps (color, normal, splat0,
  splat1, light) and the ground tiles (<material>_albedo/_normal/_hra).
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np

from . import layout as L
from . import mesh as M
from . import scene as S
from . import landcover as LC
from .imgio import read as read_img, write as write_img

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from glbtool import GLB  # noqa: E402

SCALE_MAX = 1.2          # impostor cards are authored this big; instances scale down (normalized uint8)


def log(*a):
    print("[export]", *a, flush=True)


def write_textures(ctx, out_dir):
    """The terrain's maps and tiles as WebP beside the glb."""
    t = time.time()
    os.makedirs(out_dir, exist_ok=True)
    files = {}
    for name, q in (("color", 88), ("normal", 90), ("splat0", 90), ("splat1", 90), ("light", 90)):
        src = os.path.join(ctx.maps, f"{name}.png")
        if not os.path.exists(src):
            continue
        a = read_img(src)
        write_img(os.path.join(out_dir, f"{name}.webp"), a, quality=q)
        files[name] = f"terrain/{name}.webp"
    tdir = os.path.join(ctx.build, "tiles")
    tinfo = json.load(open(os.path.join(tdir, "tiles.json")))
    tiles = {}
    for mat in LC.MATERIALS:
        for kind, q in (("albedo", 86), ("normal", 90), ("hra", 88)):
            a = read_img(os.path.join(tdir, f"{mat}_{kind}.png"))
            write_img(os.path.join(out_dir, f"tile_{mat}_{kind}.webp"), a, quality=q)
            files[f"tile_{mat}_{kind}"] = f"terrain/tile_{mat}_{kind}.webp"
        tiles[mat] = dict(size_m=tinfo[mat]['size_m'], mean_linear=[round(v, 4) for v in tinfo[mat]['mean_linear']],
                          albedo=f"terrain/tile_{mat}_albedo.webp", normal=f"terrain/tile_{mat}_normal.webp",
                          hra=f"terrain/tile_{mat}_hra.webp",
                          projection="triplanar" if mat in ("rock", "scree") else "world_xz")
    log(f"terrain textures written ({time.time() - t:.0f}s)")
    return files, tiles


def terrain_material(files):
    """A plain glTF material for the terrain chunks: base colour from a tiny
    stand-in image on UV1 (the post-pass points it at terrain/color.webp)."""
    m = bpy.data.materials.new("terrain")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    img = bpy.data.images.new("terrain_color_ref", 4, 4)
    img.pixels.foreach_set(np.tile([0.2, 0.25, 0.12, 1.0], 16).astype(np.float32))
    img.pack()
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = img
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = "logpolar"
    nt.links.new(uv.outputs[0], tx.inputs['Vector'])
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    b.inputs['Specular IOR Level'].default_value = 0.3
    return m


def impostor_export_material(species, imp_dir):
    """glTF material for a species' cards: albedo+alpha (AO folded in),
    card-space normal map; alpha-tested at 0.4, double-sided."""
    a = read_img(os.path.join(imp_dir, f"{species}_albedo.png"))
    n = read_img(os.path.join(imp_dir, f"{species}_normal.png"))
    ao = np.clip(n[..., 3:4], 0, 1) ** 0.6
    lin = np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4) * ao
    enc = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    path_a = os.path.join(imp_dir, f"_export_{species}_albedo.png")
    path_n = os.path.join(imp_dir, f"_export_{species}_normal.png")
    write_img(path_a, np.concatenate([enc, a[..., 3:4]], -1))
    write_img(path_n, n[..., :3])
    m = bpy.data.materials.new(f"impostor.{species}")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    ia = bpy.data.images.load(path_a)
    ia.colorspace_settings.name = 'sRGB'
    ia.alpha_mode = 'STRAIGHT'
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = ia
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    # alpha through a threshold: the exporter writes alphaMode MASK, cutoff 0.4
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.4
    nt.links.new(ta.outputs['Alpha'], gt.inputs[0])
    nt.links.new(gt.outputs[0], b.inputs['Alpha'])
    inn = bpy.data.images.load(path_n)
    inn.colorspace_settings.name = 'Non-Color'
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = inn
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.8
    b.inputs['Specular IOR Level'].default_value = 0.25
    m.use_backface_culling = False
    return m


def forest_cards(ctx, col):
    """One card mesh per species x variant (x mirrored), under forest.<species>."""
    from .forest import card_geometry
    imp = os.path.join(ctx.build, "impostors")
    meta = json.load(open(os.path.join(imp, "impostors.json")))
    root = S.empty("forest", (0, 0, 0), col, size=10.0,
                   note="every tree is an instance (EXT_mesh_gpu_instancing) of a camera-facing impostor card; "
                        "see art/ridge/README.md")
    holders = {}
    for sp, info in meta.items():
        sr = S.empty(f"forest.{sp}", (0, 0, 0), col, size=5.0, parent=root, surface="wood")
        mat = impostor_export_material(sp, imp)
        for cell, d in enumerate(info['variants']):
            for mirror in (False, True):
                V, F, UV = card_geometry(d, cell, info['cells'], mirror)
                V = V * SCALE_MAX
                nm = f"forest.{sp}.{d['variant']}" + (".m" if mirror else "")
                ob = S.mesh_object(nm, V, F, col, uvs={"UVMap": UV}, smooth=False, surface="wood",
                                   species=sp, variant=d['variant'], mirrored=mirror,
                                   card_width_m=round(d['width_m'] * SCALE_MAX, 3),
                                   card_height_m=round(d['height_m'] * SCALE_MAX, 3),
                                   tree_height_m=round(d['tree_height_m'] * SCALE_MAX, 3))
                # a flat card: its normal faces the eye (glTF +Z of the instance)
                ob.data.normals_split_custom_set_from_vertices([(0.0, -1.0, 0.0)] * 4)
                ob.data.materials.append(mat)
                ob.parent = sr
                holders[nm] = (sp, d['variant'], mirror)
    return holders


def water_export_material():
    m = bpy.data.materials.new("water")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs['Base Color'].default_value = (0.02, 0.035, 0.035, 1.0)
    b.inputs['Roughness'].default_value = 0.06
    return m


def scene_extras(sc, files, tiles):
    from . import post
    sc["valley"] = "Valle Serra - see art/ridge/README.md for the shaders' inputs"
    sc["fog"] = json.dumps(dict(
        haze_sigma_per_m=post.SIGMA_HAZE, haze_color_linear=[round(v, 4) for v in post.HAZE_COLOR],
        mist_sigma0_per_m=post.MIST_SIGMA0, mist_z0_m_gltf_y=post.MIST_Z0, mist_scale_height_m=post.MIST_H,
        mist_color_linear=[round(v, 4) for v in post.MIST_COLOR], air_shade=post.AIR_SHADE,
        note="haze: T = exp(-d * haze_sigma); mist: optical depth of sigma0 * exp(-(y - z0) / H) integrated along "
             "the eye ray (closed form, see valley/post.py), scaled by light.a at the ground point; both in-scatter colours "
             "times mix(air_shade, 1, sunlit at the ground point); colours at the review renders' exposure"))
    sc["lighting"] = json.dumps(dict(sun_elevation_deg=L.SUN_ELEV, sun_elevation_range_deg=list(L.SUN_ELEV_RANGE),
                                     sun_bearing_deg=L.SUN_BEARING, sun_color=list(S.SUN_COLOR),
                                     sun_to_sky_ratio=4.0,
                                     note="the sun is behind the player's left shoulder; the valley floor is in the "
                                          "shadow of the ridge behind him until ~9 degrees"))


def post_process(path, ctx, files):
    """Forest instances, and the terrain's base colour image pointed at the
    real map beside the glb."""
    from .forest import load
    t = time.time()
    g = GLB.load(path)
    inst = load(os.path.join(ctx.build, "forest.npz"))
    n_total = 0
    for i, node in enumerate(g.nodes):
        nm = node.get("name", "")
        if not nm.startswith("forest.") or "mesh" not in node:
            continue
        parts = nm.split(".")
        sp, var = parts[1], parts[2]
        mirror = nm.endswith(".m")
        sel = (inst['species'] == sp) & (inst['variant'] == var) & (inst['mirror'] == mirror)
        if not sel.any():
            continue
        x, y, z = inst['x'][sel], inst['y'][sel], inst['z'][sel]
        T = list(zip(x.tolist(), z.tolist(), (-y).tolist()))            # Blender -> glTF (x, z, -y)
        yaws = inst['yaw'][sel].tolist()                                  # about Blender +Z == glTF +Y
        scales = inst['scale'][sel].tolist()
        g.add_instancing_packed(i, T, yaws, scales, SCALE_MAX)
        n_total += len(T)
    # the terrain's colour map: an external image beside the glb
    for im in g.json.get("images", []):
        if im.get("name") == "terrain_color_ref":
            im.pop("bufferView", None)
            im.pop("mimeType", None)
            im["uri"] = files.get("color", "terrain/color.webp")
    g.save(path)
    log(f"post-processed: {n_total:,} tree instances ({time.time() - t:.0f}s)")


def stage(ctx):
    from .pipeline import open_blend
    t = time.time()
    sc = open_blend(ctx)
    tex_dir = os.path.join(ctx.assets, "terrain")
    files, tiles = write_textures(ctx, tex_dir)
    # drop what the game does not get
    for ob in list(sc.objects):
        if ob.type == 'LIGHT' or ob.get('export', 1) == 0 or (ob.type == 'CAMERA' and ob.name != "camera.player"):
            bpy.data.objects.remove(ob)
    for ob in sc.objects:
        ob.hide_render = False
        ob.hide_viewport = False
        ob.hide_set(False)
    col = bpy.data.collections["Valley"]
    fcol = S.collection("forest_export", col)
    forest_cards(ctx, fcol)
    # terrain chunks: the plain material; the splat node with the shader's inputs
    tm = terrain_material(files)
    troot = bpy.data.objects["terrain"]
    for ob in sc.objects:
        if ob.name.startswith("terrain.") and ob.type == 'MESH':
            ob.data.materials.clear()
            ob.data.materials.append(tm)
            # UV0 (tiles) is not needed: the shader tiles world positions
            for uvl in list(ob.data.uv_layers):
                if uvl.name == "tiles":
                    ob.data.uv_layers.remove(uvl)
    mapping = dict(type="logpolar", attribute="TEXCOORD_0",
                   theta0_deg=round(math.degrees(M.THETA0), 6), theta1_deg=round(math.degrees(M.THETA1), 6),
                   r0_m=M.MAP_R0, r1_m=M.MAP_R1,
                   formula="u = (atan2(x, -z) - theta0) / (theta1 - theta0); v = 1 - ln(clamp(hypot(x, z), r0, r1) / r0) / "
                           "ln(r1 / r0)  (glTF x, z; image rows top-down)")
    S.empty("terrain.splat", (0, 0, 0), bpy.data.collections["contract"], parent=troot, size=1.0,
            files=files, mapping=json.dumps(mapping),
            splat0="r grass, g rock, b scree, a snow", splat1="r dirt, g forest floor, b gravel, a alpine turf",
            normal="world-space normal in glTF axes, rgb = n * 0.5 + 0.5",
            light="r sky visibility (AO), g sun horizon angle: deg = g * 40 - 10 (lit when the sun is above it), "
                  "b canopy/building shadow at the design sun (1 lit), a valley-mist density factor (1 on the river, ~0.3 far)",
            tiles=json.dumps(tiles), materials=json.dumps(LC.MATERIALS),
            shader="albedo = color * mix(1, sum_i w_i * tile_i / mean_i, detail(distance)); w_i = splat_i * (hra_i.r + 0.25)^k; "
                   "tiles at world XZ / size_m (triplanar for rock, scree)")
    wm = water_export_material()
    for nm in ("water.river", "water.reservoir"):
        ob = bpy.data.objects.get(nm)
        if ob:
            ob.data.materials.clear()
            ob.data.materials.append(wm)
    for ob in sc.objects:
        if ob.name.startswith("mist.") and ob.type == 'MESH':
            ob.data.materials.clear()
            ob.data.materials.append(wm)
    # every mesh says what it is made of (the checker insists)
    for ob in sc.objects:
        if ob.type == 'MESH' and 'surface' not in ob.keys():
            ob['surface'] = 'stone'
    scene_extras(sc, files, tiles)
    out = os.path.join(ctx.assets, "valley.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=False, use_visible=False, use_renderable=False,
        export_extras=True, export_cameras=True, export_lights=False, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=False,
        export_image_format='WEBP', export_image_quality=85, export_image_add_webp=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=16, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=14, export_draco_color_quantization=10, export_draco_generic_quantization=12,
        export_animations=False, export_skins=False, export_morph=False, export_unused_images=False,
        export_copyright="Handy - Overwatch Ridge, the Valle Serra, generated by art/ridge/build.py")
    post_process(out, ctx, files)
    log("exported", out, f"{os.path.getsize(out) / 1e6:.2f} MB in {time.time() - t:.0f}s")
