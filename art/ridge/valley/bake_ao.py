"""Baked ambient occlusion for the buildings, the bridge and the dam: the
dark under the eaves, in the window reveals, where a wall meets the ground
and between the houses of a street - what makes a village read as solid
at 500 m.

Each object (one per site and material) gets a second UV map, `ao`
(Blender's smart projection, islands packed in 0..1), and its own AO image
baked by Cycles with the terrain, the other buildings and the rocks
occluding (the forest's flat review cards hidden). The image goes into the
object's own copy of its material as glTF's occlusion texture on
TEXCOORD_1: three.js' GLTFLoader wires it to the material's aoMap (which
darkens the ambient light only, as it should).
"""

import math
import os
import time

import bpy
import numpy as np

from . import scene as S

SKIP = ("glass", "dark", "metal", "light", "bell", "cheese", "yeti")


def log(*a):
    print("[ao]", *a, flush=True)


def _gltf_output_group():
    """The node group the glTF exporter reads the occlusion from."""
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", 'ShaderNodeTree')
        ng.interface.new_socket("Occlusion", in_out='INPUT', socket_type='NodeSocketFloat')
        ng.interface.new_socket("Thickness", in_out='INPUT', socket_type='NodeSocketFloat')
    return ng


def _area(ob):
    me = ob.data
    a = np.empty(len(me.polygons))
    me.polygons.foreach_get("area", a)
    return float(a.sum())


def _size(area):
    # about 6 cm a texel for a small object, coarser for a village's worth
    px = math.sqrt(area) / 0.06
    return int(min(1024, max(128, 2 ** round(math.log2(max(px, 1.0))))))


def bake(objs, samples=64, distance=4.0):
    t0 = time.time()
    sc = bpy.context.scene
    objs = [o for o in objs if o.type == 'MESH' and len(o.data.polygons) and
            not any(str(o.get("material_key", "")).startswith(k) for k in SKIP) and
            not str(o.get("material_key", "")).endswith("_vc")]
    if not objs:
        return []
    S.setup_gpu(sc)
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.world.light_settings.distance = distance
    sc.render.bake.margin = 4
    sc.render.bake.target = 'IMAGE_TEXTURES'
    group = _gltf_output_group()
    # the ao UVs: smart projection per object
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        me = ob.data
        uv = me.uv_layers.get("ao") or me.uv_layers.new(name="ao")
        me.uv_layers.active = uv
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objs:
        me = ob.data
        me.uv_layers.active = me.uv_layers[0]           # the tile UVs stay the first (TEXCOORD_0)
        me.uv_layers[0].active_render = True
    # an image and a material of its own for each object
    images = []
    for ob in objs:
        n = _size(_area(ob))
        img = bpy.data.images.new(f"ao.{ob.name}", n, n, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'Non-Color'
        img.generated_color = (1, 1, 1, 1)
        m = ob.data.materials[0].copy()
        m.name = f"{ob.data.materials[0].name}.{ob.name}"
        ob.data.materials[0] = m
        nt = m.node_tree
        tx = nt.nodes.new('ShaderNodeTexImage')
        tx.image = img
        tx.name = "ao_bake"
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = "ao"
        nt.links.new(uvn.outputs[0], tx.inputs['Vector'])
        nt.nodes.active = tx
        images.append((ob, img, m, tx))
    hidden = []
    for o in sc.objects:
        if o.name.startswith("review_forest") and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    try:
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type='AO', use_clear=True)
    finally:
        for o in hidden:
            o.hide_render = False
    # wire each image as the occlusion: image -> R -> glTF Material Output
    for ob, img, m, tx in images:
        img.pack()
        nt = m.node_tree
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(tx.outputs['Color'], sep.inputs[0])
        gn = nt.nodes.new('ShaderNodeGroup')
        gn.node_tree = group
        nt.links.new(sep.outputs[0], gn.inputs['Occlusion'])
    log(f"{len(objs)} objects baked ({time.time() - t0:.0f}s): " +
        ", ".join(f"{ob.name} {img.size[0]}" for ob, img, _, _ in images[:6]) + " ...")
    return [ob for ob, _, _, _ in images]
