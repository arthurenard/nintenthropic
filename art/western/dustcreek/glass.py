"""Window glass: each window becomes a `glass.<id>` mesh (one quad per pane
group) so the game can shatter it and give it reflections.

For Cycles (review renders, and the look the bake is judged against) the
material is thin dusty glass: see-through, a Fresnel sky reflection, and a
film of dust thickest in the bottom corners. For the glTF export the panes
get a plain standard material instead (see export.py).
"""

import bpy
from mathutils import Matrix, Vector

from .core import MeshBuilder, tag
from .nodes import new_material
from .materials import lin


def glass_material(lib):
    m, g = new_material("glass")
    uv = g.uv('local')
    u, v, _ = g.separate(uv)
    pos = g.geo('Position')
    # dust: heavier toward the bottom and the corners, streaked by rain
    edge = g.math('MINIMUM', g.math('MINIMUM', u, g.sub(1.0, u)), g.math('MINIMUM', v, g.sub(1.0, v)))
    corner = g.sub(1.0, g.smooth(edge, 0.0, 0.25))
    bottom = g.sub(1.0, g.smooth(v, 0.0, 0.55))
    n = g.noise(pos, scale=9.0, detail=8.0, rough=0.65)
    streak = g.noise(g.vmul(pos, (30.0, 30.0, 1.5)), scale=2.0, detail=3.0)
    dust = g.mul(g.add(g.add(g.mul(corner, 0.35), g.mul(bottom, 0.3)), g.mul(g.smooth(n, 0.45, 0.8), 0.35)),
                 g.madd(streak, 0.5, 0.6), clamp=True)
    dust = g.mul(dust, 0.75)
    fres = g.node('ShaderNodeFresnel', inputs={'IOR': 1.52}, out=0)
    transp = g.node('ShaderNodeBsdfTransparent', inputs={'Color': lin(214, 220, 206)}, out=0)
    gloss = g.node('ShaderNodeBsdfGlossy', inputs={'Color': (1, 1, 1), 'Roughness': 0.04}, out=0)
    clear = g.node('ShaderNodeMixShader', inputs={0: fres, 1: transp, 2: gloss}, out=0)
    dcol = g.mix(n, g.rgb(lin(150, 128, 104)), g.rgb(lin(186, 164, 136)))
    dshader = g.principled(dcol, rough=0.9, spec=0.2)
    sh = g.node('ShaderNodeMixShader', inputs={0: dust, 1: clear, 2: dshader}, out=0)
    g.output(sh)
    m["surface"] = 'glass'
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    lib["glass"] = m
    return m


def build_panes(lib, col, entries, group_of):
    """entries: list of (gid, frame, rects) with rects (s0, z0, s1, z1, y) in
    the frame. Returns the created objects."""
    glass_material(lib)
    objs = []
    seen = set()
    for gid, f, rects in entries:
        name = f"glass.{gid}"
        k = 2
        while name in seen:
            name = f"glass.{gid}_{k}"
            k += 1
        seen.add(name)
        mb = MeshBuilder(name)
        for (s0, z0, s1, z1, y) in rects:
            mb.add_face([f.p(s0, y, z0), f.p(s1, y, z0), f.p(s1, y, z1), f.p(s0, y, z1)], 'glass', 0.5,
                        grain=[(s0, z0), (s1, z0), (s1, z1), (s0, z1)],
                        local=[(0, 0), (1, 0), (1, 1), (0, 1)])
        ob = mb.build(col, lib, surface='glass', group=group_of(gid))
        # pivot at the pane's centre so a shatter effect can start there
        me = ob.data
        c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
        me.transform(Matrix.Translation(-c))
        ob.location = c
        objs.append(ob)
    return objs
