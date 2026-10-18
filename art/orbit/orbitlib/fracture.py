"""Pre-fractured pieces: split a mesh into Voronoi cells of a few seed
points, each piece closed over its cut and roughened, so a chunk can come
apart into shrapnel that reassembles it exactly where it was.

Each piece is the whole clipped to the half-spaces nearer its own seed
(bisect_plane, clearing the far side), its cut filled with faces of the
fracture material and those faces jittered a little so the break is not a
saw cut. Pieces keep the whole's coordinates: the caller parents them
under the whole with their origin moved to their own centre of mass.
"""

import bmesh
import bpy
from mathutils import Vector, noise as mnoise


def _slot_index(me, mat):
    for i, m in enumerate(me.materials):
        if m == mat:
            return i
    me.materials.append(mat)
    return len(me.materials) - 1


def seeds_for(ob, n, rng, spread=0.6):
    """Seed points spread through the object's bounding box, biased along
    its longest axis so pieces come out comparable in size."""
    bb = [ob.matrix_world.inverted() @ (ob.matrix_world @ Vector(c)) for c in ob.bound_box]
    lo = Vector((min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb)))
    hi = Vector((max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)))
    size = hi - lo
    axis = max(range(3), key=lambda i: size[i])
    ctr = (lo + hi) / 2
    out = []
    for i in range(n):
        t = (i + 0.5) / n - 0.5
        p = ctr.copy()
        p[axis] += t * size[axis] * spread * 1.6
        for k in range(3):
            if k != axis:
                p[k] += rng.uniform(-0.25, 0.25) * size[k] * spread
        out.append(p)
    return out


def split(ob, seeds, cut_mat, rng, jag=0.012, name_fmt="{}.piece.{}"):
    """Split `ob` (mesh, local coords) into len(seeds) new objects. Returns
    the piece objects (same transform as `ob`, not parented)."""
    pieces = []
    me0 = ob.data
    cut_idx = _slot_index(me0, cut_mat)
    for i, si in enumerate(seeds):
        bm = bmesh.new()
        bm.from_mesh(me0)
        new_faces = []
        for j, sj in enumerate(seeds):
            if i == j:
                continue
            mid = (si + sj) / 2
            nrm = (sj - si).normalized()
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=mid, plane_no=nrm,
                                         clear_outer=True, clear_inner=False)
            cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
            if cut_edges:
                # close the cut: fill every loop the plane left open
                boundary = [e for e in cut_edges if e.is_valid and e.is_boundary]
                if boundary:
                    filled = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
                    for f in filled['faces']:
                        f.material_index = cut_idx
                    new_faces.extend(filled['faces'])
        if len(bm.faces) == 0:
            bm.free()
            continue
        # roughen the new faces: triangulate, subdivide, push along normals
        new_faces = [f for f in new_faces if f.is_valid]
        if new_faces:
            tri = bmesh.ops.triangulate(bm, faces=new_faces)
            nf = tri['faces']
            edges = list({e for f in nf for e in f.edges if e.is_valid})
            sub = bmesh.ops.subdivide_edges(bm, edges=edges, cuts=2, use_grid_fill=True)
            inner = [v for v in sub['geom_inner'] if isinstance(v, bmesh.types.BMVert)]
            bm.normal_update()
            off = rng.uniform(0, 100)
            for v in inner:
                if not v.is_valid or not v.link_faces:
                    continue
                n = v.normal
                h = mnoise.noise(v.co * 18.0 + Vector((off, off, off)))
                v.co += n * (h * jag)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name_fmt.format(ob.name, i + 1))
        for m in me0.materials:
            me.materials.append(m)
        bm.to_mesh(me)
        bm.free()
        pc = bpy.data.objects.new(me.name, me)
        for c in ob.users_collection:
            c.objects.link(pc)
        pc.matrix_world = ob.matrix_world.copy()
        pieces.append(pc)
    # the whole keeps its own faces: drop the cut slot it lent the pieces
    idx = [p.material_index for p in me0.polygons]
    if cut_idx not in idx and cut_idx == len(me0.materials) - 1:
        me0.materials.pop(index=cut_idx)
    return pieces


def centre_of_mass(ob):
    """Volume-weighted centre (signed tetrahedra from the origin); falls back
    to the mean of the vertices for open meshes."""
    me = ob.data
    me.calc_loop_triangles()
    vol = 0.0
    c = Vector()
    for t in me.loop_triangles:
        a, b, d = (me.vertices[i].co for i in t.vertices)
        v = a.dot(b.cross(d)) / 6.0
        vol += v
        c += v * (a + b + d) / 4.0
    if abs(vol) < 1e-9:
        c = sum((v.co for v in me.vertices), Vector()) / max(1, len(me.vertices))
        return c, 0.0
    return c / vol, abs(vol)


def recentre(ob):
    """Move the object's origin to its centre of mass without moving the
    geometry. Returns the volume (m^3)."""
    c, vol = centre_of_mass(ob)
    from mathutils import Matrix
    ob.data.transform(Matrix.Translation(-c))
    ob.matrix_world = ob.matrix_world @ Matrix.Translation(c)
    return vol
