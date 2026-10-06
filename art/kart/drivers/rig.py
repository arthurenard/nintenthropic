"""Parts of a driver, and what turns them into Blender objects.

A `Part` is one node of drivers.glb ("driver.<species>.<part>"): its origin is
the joint the game rig turns it about, and everything in it is modelled in the
part's own space (game axes: y up, +z forward, +x the driver's left). Solids
come from signed-distance shapes (sdflib.py); hand-made meshes (eyes, brows,
a smile) are added as they are. Each piece carries one glTF material.

Colour is vertex colour, linear. The material names are what the game reads
(src/kart/render/drivers/fromArt.ts):

    fur  cloth  trim  plastic  steel  gloss  glass   albedo = the vertex colour
    lamp glow                                          albedo, made to shine
    paint paintcloth vest                              vertex grey = how lit; the game
                                                       paints them in the kart's colour
"""
import os

import bmesh
import bpy
import numpy as np

import sdflib as S

PAINT_KINDS = ("paint", "paintcloth", "vest")
# Every big piece is decimated to this fraction of the target it asks for (the whole driver stays under 5k triangles).
TRI_SCALE = float(os.environ.get("DRV_TRI_SCALE", "0.86"))

# name -> (preview colour, metallic, roughness, emission strength)
MATS = {
    "fur": ((0.8, 0.8, 0.8), 0.0, 0.82, 0.0),
    "cloth": ((0.8, 0.8, 0.8), 0.0, 0.7, 0.0),
    "trim": ((0.95, 0.95, 0.97), 0.05, 0.34, 0.0),
    "plastic": ((0.9, 0.5, 0.1), 0.02, 0.5, 0.0),
    "steel": ((0.64, 0.7, 0.8), 0.9, 0.34, 0.0),
    "gloss": ((0.02, 0.02, 0.04), 0.0, 0.08, 0.0),
    "glass": ((0.25, 0.8, 1.0), 0.55, 0.05, 0.0),
    "lamp": ((1.0, 1.0, 1.0), 0.0, 0.3, 2.0),
    "glow": ((0.3, 1.0, 1.0), 0.0, 0.4, 6.0),
    "paint": ((0.9, 0.2, 0.2), 0.32, 0.3, 0.0),
    "paintcloth": ((0.9, 0.2, 0.2), 0.0, 0.7, 0.0),
    "vest": ((0.95, 0.95, 0.95), 0.0, 0.7, 0.0),
}


def to_blender(a):
    """Game axes (x, y, z) -> Blender's (x, -z, y), which the glTF exporter turns back into the game's."""
    a = np.asarray(a, float)
    return np.stack([a[..., 0], -a[..., 2], a[..., 1]], axis=-1)


def decimate(verts, tris, target, symmetric=True):
    """Collapse a triangle mesh toward `target` triangles with Blender's own decimator."""
    me = bpy.data.meshes.new("tmp")
    me.from_pydata(to_blender(verts).tolist(), [], tris.tolist())
    me.update()
    ob = bpy.data.objects.new("tmp", me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new("d", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = max(0.002, min(1.0, target / len(tris)))
    md.use_collapse_triangulate = True
    if symmetric:
        md.use_symmetry = True
        md.symmetry_axis = "X"
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    out = ev.to_mesh()
    out.calc_loop_triangles()
    v = np.empty(len(out.vertices) * 3)
    out.vertices.foreach_get("co", v)
    t = np.empty(len(out.loop_triangles) * 3, np.int64)
    out.loop_triangles.foreach_get("vertices", t)
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    v = v.reshape(-1, 3)
    # back to game axes
    v = np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)
    return v, t.reshape(-1, 3)


def quads_to_tris(verts, quads):
    a, b, c, d = (verts[quads[:, i]] for i in range(4))
    short02 = np.linalg.norm(a - c, axis=1) <= np.linalg.norm(b - d, axis=1)
    t1 = np.where(short02[:, None], quads[:, [0, 1, 2]], quads[:, [0, 1, 3]])
    t2 = np.where(short02[:, None], quads[:, [0, 2, 3]], quads[:, [1, 2, 3]])
    return np.concatenate([t1, t2], axis=0)


def clean(tris):
    """Drop collapsed and duplicate triangles (the decimator leaves a few)."""
    ok = (tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])
    tris = tris[ok]
    key = np.sort(tris, axis=1)
    _, first = np.unique(key, axis=0, return_index=True)
    return tris[np.sort(first)]


def labels_of(points, regions):
    """Which region (1-based, the first listed wins; 0 for none) each point is in."""
    lab = np.zeros(len(points), np.int64)
    for k in range(len(regions), 0, -1):
        lab[regions[k - 1][1](points) < 0] = k
    return lab


def refine_boundary(f, verts, tris, regions, passes):
    """Split the edges that cross from one region into another, so a colour patch ends along a line of small
    triangles (a clean edge) without the whole mesh being dense."""
    for _ in range(passes):
        lab = labels_of(verts, regions)
        bm = bmesh.new()
        bv = [bm.verts.new(v) for v in verts]
        for t in tris:
            bm.faces.new([bv[t[0]], bv[t[1]], bv[t[2]]])
        bm.verts.index_update()
        bm.verts.ensure_lookup_table()
        cut = [e for e in bm.edges if lab[e.verts[0].index] != lab[e.verts[1].index]]
        if not cut:
            bm.free()
            break
        bmesh.ops.subdivide_edges(bm, edges=cut, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.verts.index_update()
        verts = np.array([tuple(v.co) for v in bm.verts], float)
        tris = np.array([[v.index for v in fc.verts] for fc in bm.faces], np.int64)
        bm.free()
        verts = S.snap(f, verts, 2)
    return verts, tris


def compact(verts, tris):
    used = np.unique(tris)
    remap = np.full(len(verts), -1, np.int64)
    remap[used] = np.arange(len(used))
    return verts[used], remap[tris]


class Part:
    def __init__(self, species, name, pivot=(0.0, 0.0, 0.0)):
        self.species = species
        self.name = f"driver.{species}.{name}"
        self.pivot = np.asarray(pivot, float)
        self.pieces = []

    # ------------------------------------------------------------ solids

    def solid(self, f, lo, hi, h=0.01, tris=1200, albedo=(0.8, 0.8, 0.8), mat="fur", regions=(), ao=0.55, reach=0.09, symmetric=True, refine=0):
        """Mesh a distance field into the part.

        `albedo` is a colour or a function (P, N) -> colours (linear). `regions` is a list of (material, region) or
        (material, region, albedo): region(P) < 0 marks the faces (by their centres) that are that material (and colour)
        instead of `mat`; the first listed wins. `refine` splits the triangles along a region's edge that many times
        so the edge is clean. `ao` is how dark the creases get.
        """
        if tris >= 150:
            tris = int(tris * TRI_SCALE)
        F = S.sample(f, lo, hi, h)
        verts, quads = S.surface_nets(F, lo, h)
        tri = quads_to_tris(verts, quads)
        # Faces outward: the face normal should follow the field's gradient.
        fn = np.cross(verts[tri[:, 1]] - verts[tri[:, 0]], verts[tri[:, 2]] - verts[tri[:, 0]])
        cent = verts[tri].mean(axis=1)
        if np.sum(np.einsum("ij,ij->i", fn, S.gradient(f, cent))) < 0:
            tri = tri[:, ::-1]
        raw = len(tri)
        if len(tri) > tris:
            verts, tri = decimate(verts, tri, tris, symmetric)
        verts, tri = compact(verts, clean(tri))
        verts = S.snap(f, verts)
        regions = list(regions)
        if refine and regions:
            verts, tri = refine_boundary(f, verts, clean(tri), regions, refine)
            verts, tri = compact(verts, clean(tri))
        if os.environ.get("DRV_DEBUG"):
            print(f"    solid {mat:10s} raw {raw:6d} target {tris:5d} got {len(tri):5d}")
        nor = S.normals(f, verts)
        occ = S.occlusion(f, verts, nor, reach)
        shade = 1.0 - ao * (1.0 - occ)
        cent = verts[tri].mean(axis=1)
        label = labels_of(cent, regions)
        for k in np.unique(label):
            m, tint = (mat, albedo) if k == 0 else (regions[k - 1][0], regions[k - 1][2] if len(regions[k - 1]) > 2 else albedo)
            sel = tri[label == k]
            v, t = compact(verts, sel)
            used = np.unique(sel)
            n, sh = nor[used], shade[used]
            if m in PAINT_KINDS:
                col = np.repeat(sh[:, None], 3, axis=1)
            else:
                base = tint(v, n) if callable(tint) else np.broadcast_to(np.asarray(tint, float), v.shape)
                col = base * sh[:, None]
            self.pieces.append(dict(mat=m, verts=v, nors=n, cols=col, faces=t))

    def mesh(self, verts, nors, faces, mat, colour):
        """A hand-made piece. `colour` is one colour or one per vertex."""
        verts = np.asarray(verts, float)
        col = np.broadcast_to(np.asarray(colour, float), verts.shape).copy()
        self.pieces.append(dict(mat=mat, verts=verts, nors=np.asarray(nors, float), cols=col, faces=np.asarray(faces)))

    def tris(self):
        return sum(len(p["faces"]) for p in self.pieces)

    # ----------------------------------------------------------- blender

    def to_object(self, collection, materials):
        names = [m for m in MATS if any(p["mat"] == m for p in self.pieces)]
        verts, nors, cols, faces, mats = [], [], [], [], []
        base = 0
        for p in self.pieces:
            verts.append(p["verts"])
            nors.append(p["nors"])
            cols.append(p["cols"])
            faces.append(p["faces"] + base)
            mats.append(np.full(len(p["faces"]), names.index(p["mat"])))
            base += len(p["verts"])
        verts, nors, cols = np.concatenate(verts), np.concatenate(nors), np.concatenate(cols)
        faces, mats = np.concatenate(faces), np.concatenate(mats)
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(to_blender(verts).tolist(), [], faces.tolist())
        me.update()
        for m in names:
            me.materials.append(materials[m])
        me.polygons.foreach_set("material_index", mats.astype(np.int32))
        rgba = np.concatenate([cols, np.ones((len(cols), 1))], axis=1).astype(np.float32)
        attr = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
        attr.data.foreach_set("color", rgba.ravel())
        me.color_attributes.active_color = attr
        me.polygons.foreach_set("use_smooth", np.ones(len(faces), bool))
        me.normals_split_custom_set_from_vertices(to_blender(nors).tolist())
        ob = bpy.data.objects.new(self.name, me)
        ob.location = to_blender(self.pivot).tolist()
        collection.objects.link(ob)
        return ob


def make_materials():
    out = {}
    for name, (col, metal, rough, emit) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*col, 1.0)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*col, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emit
        out[name] = m
    return out
