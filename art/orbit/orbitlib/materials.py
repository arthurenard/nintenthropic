"""Procedural materials for the station, the cupola and everything that
flies at it, built as Cycles node trees.

The look is the NASA photograph: one harsh sun and no air. White beta-cloth
blankets with their quilting and a little yellowing; gold multilayer
insulation crinkled into a thousand facets that each catch the sun; bare
and anodised aluminium with machining marks; solar cells under cover glass
with their silver grid; black rubber seals; velcro; cables.

Every material is built by `pbr()` from a recipe that returns sockets for
colour, roughness, metalness, a height (for bump) and emission. Besides the
Principled BSDF it wires three Emission nodes (EM_color, EM_rough,
EM_metal, EM_emit) that `route()` can switch the output to, which is how
the PBR bakes read each channel exactly (see pbrbake.py). Colours are
scene-linear albedos inside real-world ranges.

Recipes read:
  - UV "tex" (metres, U along each part's long axis: bolts, tubes, plates),
  - face attribute "rand" (one value per part),
  - Object coordinates (3D noise, no seams), and Cycles' Pointiness (edges:
    wear, burns) where it helps.
"""

import bpy

from dustcreek.nodes import G, new_material, new_group, group_node   # read-only import of High Noon's DSL

LIB = {}


def lin(r, g, b):
    def c(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (c(r), c(g), c(b))


# ---------------------------------------------------------------------------
# The builder

def pbr(name, recipe, **flags):
    """recipe(g) -> dict(color, rough, metal, height=None, bump=0.3,
    bump_dist=0.001, emit=None, estr=0.0, alpha=None, spec=0.5, coat=None,
    transmission=None, ior=1.5, aniso=None)."""
    m, g = new_material(name)
    ch = recipe(g)
    color = ch['color']
    rough = ch.get('rough', 0.5)
    metal = ch.get('metal', 0.0)
    b = g.new('ShaderNodeBsdfPrincipled')
    b.name = 'BSDF'
    g.set_in(b, 'Base Color', color)
    g.set_in(b, 'Roughness', rough)
    g.set_in(b, 'Metallic', metal)
    g.set_in(b, 'Specular IOR Level', ch.get('spec', 0.5))
    if ch.get('coat') is not None:
        g.set_in(b, 'Coat Weight', ch['coat'])
        g.set_in(b, 'Coat Roughness', ch.get('coat_rough', 0.05))
    if ch.get('transmission') is not None:
        g.set_in(b, 'Transmission Weight', ch['transmission'])
        g.set_in(b, 'IOR', ch.get('ior', 1.5))
    if ch.get('alpha') is not None:
        g.set_in(b, 'Alpha', ch['alpha'])
    if ch.get('aniso') is not None:
        g.set_in(b, 'Anisotropic', ch['aniso'])
    h = ch.get('height')
    if h is not None:
        bn = g.bump(h, strength=ch.get('bump', 0.3), distance=ch.get('bump_dist', 0.001))
        g.links.new(bn, b.inputs['Normal'])
    emit = ch.get('emit')
    if emit is not None:
        g.set_in(b, 'Emission Color', emit)
        g.set_in(b, 'Emission Strength', ch.get('estr', 1.0))
    out = g.new('ShaderNodeOutputMaterial')
    out.name = 'OUT'
    g.links.new(b.outputs[0], out.inputs['Surface'])
    for key, sock in (('color', color), ('rough', rough), ('metal', metal), ('emit', emit)):
        e = g.new('ShaderNodeEmission')
        e.name = f'EM_{key}'
        if key == 'emit':
            g.set_in(e, 'Color', sock if sock is not None else (0, 0, 0))
            g.set_in(e, 'Strength', ch.get('estr', 1.0) if sock is not None else 0.0)
        else:
            g.set_in(e, 'Color', sock)
            g.set_in(e, 'Strength', 1.0)
    m['pbr'] = True
    for k, v in flags.items():
        m[k] = v
    if ch.get('alpha') is not None or ch.get('transmission') is not None:
        try:
            m.surface_render_method = 'BLENDED'
        except AttributeError:
            pass
    LIB[name] = m
    return m


def route(m, what):
    """Point a pbr() material's output at one channel ('color', 'rough',
    'metal', 'emit') or back at the full BSDF ('bsdf')."""
    nt = m.node_tree
    out = nt.nodes['OUT']
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    src = nt.nodes['BSDF'] if what == 'bsdf' else nt.nodes[f'EM_{what}']
    nt.links.new(src.outputs[0], out.inputs['Surface'])


def route_all(what):
    for m in bpy.data.materials:
        if m.get('pbr') and m.node_tree and 'OUT' in m.node_tree.nodes:
            route(m, what)


# ---------------------------------------------------------------------------
# Pattern helpers (return sockets)

def rand(g):
    return g.attr('rand')


def obj(g):
    return g.texco('Object')


def uvtex(g):
    return g.uv('tex')


def scuffs(g, scale=6.0, seed=0.0):
    """Handling marks: patches a little rougher or smoother."""
    p = g.vadd(obj(g), (seed * 7.1, seed * 3.3, seed * 1.7))
    n = g.noise(p, scale=scale, detail=6.0, rough=0.6)
    n2 = g.noise(p, scale=scale * 9, detail=3.0)
    return g.add(g.mul(g.sub(n, 0.5), 0.6), g.mul(g.sub(n2, 0.5), 0.25))


def machining(g, freq=900.0, along='U'):
    """Fine turning or milling marks: tight bands across a part, with a
    little wander. Returns a 0..1 pattern."""
    uv = uvtex(g)
    u, v, _ = g.separate(uv)
    coord = v if along == 'U' else u
    wob = g.noise(uv, scale=40.0, detail=2.0)
    return g.wave(g.combine(g.add(coord, g.mul(wob, 0.002)), 0.0, 0.0), scale=freq, direction='X', profile='SIN', detail=0.0)


def weave(g, pitch=0.0012):
    uv = uvtex(g)
    u, v, _ = g.separate(uv)
    k = 3.14159 / pitch
    a = g.math('SINE', g.mul(u, k))
    b = g.math('SINE', g.mul(v, k))
    return g.mul(g.add(g.mul(a, b), 1.0), 0.5)


def quilt(g, cell=0.30, puff=1.0):
    """Beta-cloth quilting: stitch lines on a grid (in the part's UV
    metres), the fabric pillowing up between them."""
    uv = uvtex(g)
    u, v, _ = g.separate(uv)
    fu = g.math('FRACT', g.mul(u, 1.0 / cell))
    fv = g.math('FRACT', g.mul(v, 1.0 / cell))
    du = g.math('ABSOLUTE', g.sub(fu, 0.5))
    dv = g.math('ABSOLUTE', g.sub(fv, 0.5))
    pill = g.mul(g.sub(0.5, du), g.sub(0.5, dv))                  # 0 at stitches, 0.25 mid-cell
    seam = g.math('MINIMUM', g.sub(0.5, du), g.sub(0.5, dv))     # 0 on stitch lines
    stitch = g.smooth(seam, 0.0, 0.02)
    return g.mul(g.math('SQRT', g.mul(pill, 4.0)), puff), stitch


def crinkle(g, scale=14.0, seed=0.0):
    """MLI crinkles: sheets pressed into flat facets meeting at sharp
    creases (Voronoi cells, distorted), plus wrinkles at two scales."""
    p = g.vadd(obj(g), (seed * 13.1, seed * 5.3, seed * 2.9))
    pw = g.vadd(p, g.vmul(g.node('ShaderNodeTexNoise', inputs={'Vector': p, 'Scale': scale * 0.35, 'Detail': 3.0}, out='Color'), (0.08, 0.08, 0.08)))
    cells = g.voronoi(pw, scale=scale, feature='F1', out='Distance', rand=1.0)
    edge = g.voronoi(pw, scale=scale, feature='DISTANCE_TO_EDGE', out='Distance', rand=1.0)
    facet = g.node('ShaderNodeTexVoronoi', inputs={'Vector': pw, 'Scale': scale, 'Randomness': 1.0}, out='Color',
                   feature='F1', voronoi_dimensions='3D')
    fr, fg_, fb = g.sep_rgb(facet)
    tilt = g.add(g.mul(fr, 0.6), g.mul(fg_, 0.4))                  # a random slope per facet
    wr = g.noise(p, scale=scale * 3.0, detail=4.0, rough=0.65)
    h = g.add(g.add(g.mul(tilt, 0.5), g.mul(g.smooth(edge, 0.0, 0.08), 0.35)), g.mul(wr, 0.25))
    return h, fr


def grime(g, amount=0.3):
    """Contact dirt in the crevices (Cycles AO node, baked like the rest)."""
    ao = g.node('ShaderNodeAmbientOcclusion', inputs={'Distance': 0.04}, out='AO')
    return g.mul(g.sub(1.0, ao), amount)


# ---------------------------------------------------------------------------
# Interior (the cupola)

def interior_materials():
    def alu_frame(g):
        r = rand(g)
        mk = machining(g, 1400.0)
        sc = scuffs(g, 7.0)
        base = g.mix(g.mul(r, 0.6), g.rgb(lin(168, 170, 172)), g.rgb(lin(182, 184, 186)))
        rough = g.add(g.add(0.30, g.mul(mk, 0.06)), g.mul(sc, 0.12))
        return dict(color=base, rough=rough, metal=1.0, height=g.add(g.mul(mk, 0.3), g.mul(sc, 0.2)), bump=0.05, bump_dist=0.0004)
    pbr('alu_frame', alu_frame)

    def alu_dark(g):
        # the dome's inner skin: a satin light-grey primer over the forging,
        # worn to bare metal where hands and feet go
        sc = scuffs(g, 5.0, 1.0)
        n = g.noise(obj(g), scale=220.0, detail=2.0)
        worn = g.clamp01(g.mul(g.sub(sc, 0.22), 2.5))
        base = g.mix(worn, g.rgb(lin(168, 170, 172)), g.rgb(lin(190, 192, 196)))
        return dict(color=g.hsv(base, v=g.add(0.96, g.mul(sc, 0.2))), rough=g.add(0.5, g.mul(sc, 0.1)),
                    metal=g.mul(worn, 0.9), height=g.add(g.mul(n, 0.5), g.mul(sc, 0.3)), bump=0.06, bump_dist=0.0005)
    pbr('alu_dark', alu_dark)

    def steel(g):
        mk = machining(g, 3000.0)
        return dict(color=g.rgb(lin(190, 188, 184)), rough=g.add(0.18, g.mul(mk, 0.08)), metal=1.0,
                    height=mk, bump=0.03, bump_dist=0.0002)
    pbr('steel', steel)

    def paint_panel(g):
        sc = scuffs(g, 4.0, 2.0)
        n = g.noise(obj(g), scale=600.0, detail=2.0)
        base = g.mix(g.mul(rand(g), 0.4), g.rgb(lin(196, 196, 188)), g.rgb(lin(206, 204, 194)))
        base = g.mix(g.clamp01(g.mul(g.sub(sc, 0.1), 1.5)), base, g.rgb(lin(170, 168, 160)))
        return dict(color=base, rough=g.add(0.55, g.mul(sc, 0.1)), metal=0.0, height=n, bump=0.08, bump_dist=0.0003)
    pbr('paint_panel', paint_panel)

    def handrail(g):
        sc = scuffs(g, 12.0, 3.0)
        mk = machining(g, 800.0)
        base = g.rgb(lin(62, 92, 132))
        worn = g.clamp01(g.mul(g.sub(sc, 0.15), 2.0))
        base = g.mix(worn, base, g.rgb(lin(150, 158, 166)))
        return dict(color=base, rough=g.add(0.32, g.mul(sc, 0.1)), metal=g.add(0.7, g.mul(worn, 0.3)), height=mk, bump=0.03, bump_dist=0.0003)
    pbr('handrail', handrail)

    def velcro(g):
        n = g.noise(obj(g), scale=900.0, detail=3.0, rough=0.7)
        n2 = g.noise(obj(g), scale=90.0, detail=3.0)
        base = g.mix(n2, g.rgb(lin(206, 200, 184)), g.rgb(lin(188, 182, 168)))
        return dict(color=base, rough=0.95, metal=0.0, height=g.add(n, g.mul(n2, 0.3)), bump=0.4, bump_dist=0.0006, spec=0.3)
    pbr('velcro', velcro)

    def velcro_grey(g):
        n = g.noise(obj(g), scale=900.0, detail=3.0, rough=0.7)
        return dict(color=g.rgb(lin(92, 94, 96)), rough=0.95, metal=0.0, height=n, bump=0.4, bump_dist=0.0006, spec=0.3)
    pbr('velcro_grey', velcro_grey)

    def rubber(g):
        n = g.noise(obj(g), scale=300.0, detail=2.0)
        return dict(color=g.rgb(lin(18, 18, 19)), rough=g.add(0.55, g.mul(n, 0.1)), metal=0.0, height=n, bump=0.05, bump_dist=0.0003)
    pbr('rubber', rubber)

    def plastic_black(g):
        n = g.noise(obj(g), scale=1500.0, detail=2.0)
        sc = scuffs(g, 9.0, 4.0)
        return dict(color=g.rgb(lin(24, 24, 26)), rough=g.add(0.42, g.mul(sc, 0.15)), metal=0.0, height=n, bump=0.05, bump_dist=0.0002)
    pbr('plastic_black', plastic_black)

    def plastic_grey(g):
        n = g.noise(obj(g), scale=1500.0, detail=2.0)
        return dict(color=g.rgb(lin(120, 122, 124)), rough=0.5, metal=0.0, height=n, bump=0.05, bump_dist=0.0002)
    pbr('plastic_grey', plastic_grey)

    def fabric(g):
        w = weave(g, 0.0015)
        n = g.noise(obj(g), scale=12.0, detail=4.0)
        base = g.mix(n, g.rgb(lin(214, 210, 196)), g.rgb(lin(196, 190, 176)))
        return dict(color=base, rough=0.9, metal=0.0, height=g.add(w, g.mul(n, 2.0)), bump=0.25, bump_dist=0.0008, spec=0.3)
    pbr('fabric', fabric)

    for nm, c in (('cable_black', (22, 22, 24)), ('cable_grey', (120, 124, 128)), ('cable_orange', (200, 90, 24)),
                  ('cable_blue', (30, 70, 150)), ('cable_yellow', (210, 170, 40)), ('cable_white', (210, 210, 206))):
        def cable(g, c=c):
            n = g.noise(uvtex(g), scale=60.0, detail=2.0)
            return dict(color=g.rgb(lin(*c)), rough=g.add(0.38, g.mul(n, 0.1)), metal=0.0, height=n, bump=0.05, bump_dist=0.0002)
        pbr(nm, cable)

    def led(g):
        return dict(color=g.rgb((0.9, 0.92, 0.95)), rough=0.3, metal=0.0, emit=g.rgb((0.86, 0.93, 1.0)), estr=220.0)
    pbr('led', led, emissive=True)

    def led_room(g):
        return dict(color=g.rgb((0.9, 0.92, 0.95)), rough=0.3, metal=0.0, emit=g.rgb((0.86, 0.93, 1.0)), estr=45.0)
    pbr('led_room', led_room, emissive=True)

    def led_amber(g):
        return dict(color=g.rgb((0.9, 0.6, 0.2)), rough=0.3, metal=0.0, emit=g.rgb((1.0, 0.55, 0.12)), estr=12.0)
    pbr('led_amber', led_amber, emissive=True)

    def led_green(g):
        return dict(color=g.rgb((0.2, 0.9, 0.3)), rough=0.3, metal=0.0, emit=g.rgb((0.15, 1.0, 0.3)), estr=10.0)
    pbr('led_green', led_green, emissive=True)

    def screen(g):
        return dict(color=g.rgb((0.01, 0.01, 0.012)), rough=0.08, metal=0.0, emit=screen_ui(g), estr=2.2, spec=0.6)
    pbr('screen', screen, emissive=True)

    def label(g):
        uv = uvtex(g)
        u, v, _ = g.separate(uv)
        lines = g.wave(g.combine(v, 0, 0), scale=160.0, direction='X', profile='SAW')
        stripe = g.mul(g.smooth(lines, 0.55, 0.62), g.smooth(g.noise(uv, scale=90.0), 0.35, 0.5))
        base = g.mix(stripe, g.rgb(lin(226, 224, 214)), g.rgb(lin(30, 30, 32)))
        return dict(color=base, rough=0.45, metal=0.0)
    pbr('label', label)

    def label_yellow(g):
        uv = uvtex(g)
        u, v, _ = g.separate(uv)
        stripes = g.wave(g.combine(g.add(u, v), 0, 0), scale=45.0, direction='X', profile='SAW')
        base = g.mix(g.smooth(stripes, 0.48, 0.52), g.rgb(lin(222, 180, 20)), g.rgb(lin(20, 20, 20)))
        return dict(color=base, rough=0.45, metal=0.0)
    pbr('label_yellow', label_yellow)

    thin_glass('glass')


def thin_glass(name):
    """Window glass as a thin sheet: see-through without bending the view
    (a single refracting face would act as a prism), a Fresnel reflection,
    and it lets the sun through to the frame (no caustics needed)."""
    m, g = new_material(name)
    # anti-reflection coated: a quarter of bare glass's reflection
    fres = g.mul(g.node('ShaderNodeFresnel', inputs={'IOR': 1.47}, out=0), 0.3)
    tr = g.node('ShaderNodeBsdfTransparent', inputs={'Color': (0.96, 0.975, 0.98)}, out=0)
    gl = g.node('ShaderNodeBsdfGlossy', inputs={'Color': (1, 1, 1), 'Roughness': 0.015}, out=0)
    sh = g.node('ShaderNodeMixShader', inputs={0: fres, 1: tr, 2: gl}, out=0)
    g.output(sh)
    m['surface'] = 'glass'
    LIB[name] = m
    return m


def screen_ui(g):
    """A station laptop's display: dark background, a ground-track map with
    a sine-shaped orbit line, a few status panes. Pure nodes, no text."""
    uv = uvtex(g)
    u, v, _ = g.separate(uv)
    # the Geo writes the screen quad's UV as 0..1 on both axes ('local')
    bg = g.rgb((0.004, 0.008, 0.014))
    # map panel: left 62%
    inmap = g.mul(g.smooth(u, 0.03, 0.035), g.mul(g.smooth(u, 0.63, 0.625), g.mul(g.smooth(v, 0.08, 0.085), g.smooth(v, 0.92, 0.915))))
    land = g.smooth(g.noise(g.combine(g.mul(u, 3.0), g.mul(v, 1.6), 0.0), scale=2.4, detail=4.0), 0.52, 0.56)
    mapcol = g.mix(land, g.rgb((0.02, 0.05, 0.10)), g.rgb((0.05, 0.12, 0.06)))
    orbit_y = g.add(0.5, g.mul(g.math('SINE', g.mul(g.sub(u, 0.03), 10.5)), 0.28))
    orbit = g.smooth(g.math('ABSOLUTE', g.sub(v, orbit_y)), 0.012, 0.004)
    grid = g.mul(g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(u, 12.0)), 0.5)), 0.47, 0.49), 0.25)
    col = g.mix(inmap, bg, g.add(mapcol, g.mul(g.rgb((0.1, 0.12, 0.14)), grid)))
    col = g.mix(g.mul(orbit, inmap), col, g.rgb((0.9, 0.75, 0.25)))
    # status panes on the right: rows of bars
    pane = g.mul(g.smooth(u, 0.66, 0.665), g.smooth(u, 0.97, 0.965))
    rows = g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(v, 9.0)), 0.5)), 0.32, 0.28)
    barlen = g.noise(g.combine(g.math('FLOOR', g.mul(v, 9.0)), 0.0, 0.0), scale=3.0)
    bar = g.mul(rows, g.smooth(u, g.add(0.68, g.mul(barlen, 0.3)), g.add(0.675, g.mul(barlen, 0.3))))
    col = g.mix(g.mul(pane, bar), col, g.rgb((0.15, 0.55, 0.30)))
    col = g.mix(g.mul(pane, g.mul(rows, 0.15)), col, g.rgb((0.3, 0.35, 0.4)))
    # the green "go" header strip
    head = g.mul(g.smooth(v, 0.94, 0.945), g.smooth(v, 0.985, 0.98))
    col = g.mix(head, col, g.rgb((0.12, 0.18, 0.26)))
    return col


# ---------------------------------------------------------------------------
# Exterior (the station)

def exterior_materials():
    def beta(g):
        q, stitch = quilt(g, 0.28)
        w = weave(g, 0.0009)
        n = g.noise(obj(g), scale=2.5, detail=5.0, rough=0.55)
        n2 = g.noise(obj(g), scale=40.0, detail=4.0)
        yellow = g.smooth(n, 0.45, 0.8)
        base = g.mix(g.mul(rand(g), 0.5), g.rgb(lin(222, 222, 216)), g.rgb(lin(212, 210, 200)))
        base = g.mix(g.mul(yellow, 0.6), base, g.rgb(lin(210, 196, 164)))
        base = g.mix(g.mul(g.sub(1.0, stitch), 0.5), base, g.rgb(lin(160, 158, 150)))
        h = g.add(g.add(g.mul(q, 1.0), g.mul(w, 0.08)), g.mul(n2, 0.25))
        return dict(color=base, rough=g.add(0.62, g.mul(n2, 0.1)), metal=0.0, height=h, bump=0.35, bump_dist=0.006, spec=0.45)
    pbr('beta_cloth', beta)

    def mli_gold(g):
        h, facet = crinkle(g, 34.0)
        n = g.noise(obj(g), scale=3.0, detail=3.0)
        base = g.mix(g.mul(facet, 0.5), g.rgb(lin(236, 168, 72)), g.rgb(lin(222, 142, 48)))
        base = g.mix(g.mul(g.smooth(n, 0.6, 0.9), 0.4), base, g.rgb(lin(190, 110, 40)))
        rough = g.add(0.10, g.mul(g.noise(obj(g), scale=60.0, detail=3.0), 0.14))
        return dict(color=base, rough=rough, metal=1.0, height=h, bump=0.9, bump_dist=0.004)
    pbr('mli_gold', mli_gold)

    def mli_silver(g):
        h, facet = crinkle(g, 36.0, 2.0)
        base = g.mix(g.mul(facet, 0.4), g.rgb(lin(222, 224, 228)), g.rgb(lin(196, 198, 204)))
        rough = g.add(0.08, g.mul(g.noise(obj(g), scale=60.0, detail=3.0), 0.12))
        return dict(color=base, rough=rough, metal=1.0, height=h, bump=0.9, bump_dist=0.004)
    pbr('mli_silver', mli_silver)

    def kapton(g):
        h, facet = crinkle(g, 40.0, 3.0)
        base = g.mix(facet, g.rgb(lin(180, 96, 22)), g.rgb(lin(150, 70, 14)))
        return dict(color=base, rough=0.12, metal=0.6, height=h, bump=0.5, bump_dist=0.003)
    pbr('kapton', kapton)

    def white_paint(g):
        sc = scuffs(g, 3.0, 5.0)
        n = g.noise(obj(g), scale=400.0, detail=2.0)
        base = g.mix(g.mul(rand(g), 0.5), g.rgb(lin(226, 226, 222)), g.rgb(lin(212, 212, 206)))
        base = g.mix(g.clamp01(g.mul(g.sub(sc, 0.15), 1.2)), base, g.rgb(lin(190, 186, 176)))
        return dict(color=base, rough=g.add(0.4, g.mul(sc, 0.12)), metal=0.0, height=n, bump=0.05, bump_dist=0.0005)
    pbr('white_paint', white_paint)

    def alu_bare(g):
        mk = machining(g, 600.0)
        sc = scuffs(g, 4.0, 6.0)
        base = g.mix(g.mul(rand(g), 0.6), g.rgb(lin(176, 178, 182)), g.rgb(lin(150, 152, 156)))
        return dict(color=base, rough=g.add(0.28, g.mul(sc, 0.14)), metal=1.0, height=g.add(mk, sc), bump=0.05, bump_dist=0.0005)
    pbr('alu_bare', alu_bare)

    def alu_dark_ext(g):
        sc = scuffs(g, 4.0, 7.0)
        return dict(color=g.rgb(lin(58, 60, 64)), rough=g.add(0.4, g.mul(sc, 0.1)), metal=0.9, height=sc, bump=0.05, bump_dist=0.0005)
    pbr('alu_darkext', alu_dark_ext)

    def solar(g):
        uv = uvtex(g)
        u, v, _ = g.separate(uv)
        cw, ch = 0.080, 0.080
        fu = g.math('FRACT', g.mul(u, 1.0 / cw))
        fv = g.math('FRACT', g.mul(v, 1.0 / ch))
        gap = g.math('MAXIMUM', g.smooth(g.math('ABSOLUTE', g.sub(fu, 0.5)), 0.465, 0.475),
                     g.smooth(g.math('ABSOLUTE', g.sub(fv, 0.5)), 0.465, 0.475))
        # silver fingers across each cell and two busbars
        fingers = g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(fv, 28.0)), 0.5)), 0.45, 0.47)
        bus = g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(fu, 2.0)), 0.5)), 0.47, 0.485)
        grid = g.math('MAXIMUM', g.mul(fingers, 0.7), bus)
        cell = g.mix(g.mul(rand(g), 0.6), g.rgb(lin(14, 20, 46)), g.rgb(lin(10, 16, 34)))
        tint = g.noise(obj(g), scale=0.6, detail=2.0)
        cell = g.mix(g.mul(tint, 0.35), cell, g.rgb(lin(24, 30, 70)))
        col = g.mix(g.mul(grid, g.sub(1.0, gap)), cell, g.rgb(lin(170, 172, 176)))
        col = g.mix(gap, col, g.rgb(lin(200, 198, 190)))
        metal = g.mul(g.mul(grid, g.sub(1.0, gap)), 0.9)
        rough = g.add(0.05, g.mul(gap, 0.45))
        return dict(color=col, rough=rough, metal=metal, height=g.mul(gap, -1.0), bump=0.2, bump_dist=0.0005, spec=0.6, coat=g.sub(1.0, gap), coat_rough=0.03)
    pbr('solar_cell', solar)

    def solar_back(g):
        n = g.noise(obj(g), scale=30.0, detail=3.0)
        return dict(color=g.rgb(lin(200, 190, 160)), rough=0.5, metal=0.0, height=n, bump=0.1, bump_dist=0.001)
    pbr('solar_back', solar_back)

    def radiator(g):
        uv = uvtex(g)
        u, v, _ = g.separate(uv)
        rib = g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(v, 1.0 / 0.12)), 0.5)), 0.44, 0.48)
        n = g.noise(obj(g), scale=3.0, detail=4.0)
        base = g.mix(g.mul(g.smooth(n, 0.5, 0.8), 0.5), g.rgb(lin(228, 228, 224)), g.rgb(lin(206, 202, 192)))
        return dict(color=base, rough=g.add(0.35, g.mul(n, 0.1)), metal=0.0, height=rib, bump=0.3, bump_dist=0.002)
    pbr('radiator', radiator)

    def handrail_ext(g):
        sc = scuffs(g, 10.0, 8.0)
        base = g.rgb(lin(218, 164, 40))
        return dict(color=base, rough=g.add(0.34, g.mul(sc, 0.1)), metal=0.6, height=sc, bump=0.05, bump_dist=0.0005)
    pbr('handrail_yellow', handrail_ext)

    def capsule_white(g):
        sc = scuffs(g, 2.0, 9.0)
        n = g.noise(obj(g), scale=500.0, detail=2.0)
        base = g.mix(g.clamp01(g.mul(g.sub(sc, 0.2), 1.0)), g.rgb(lin(232, 232, 230)), g.rgb(lin(200, 198, 192)))
        return dict(color=base, rough=g.add(0.22, g.mul(sc, 0.08)), metal=0.0, height=n, bump=0.03, bump_dist=0.0004, coat=0.4)
    pbr('capsule_white', capsule_white)

    def heatshield(g):
        n = g.noise(obj(g), scale=8.0, detail=6.0)
        n2 = g.noise(obj(g), scale=120.0, detail=3.0)
        base = g.mix(g.smooth(n, 0.4, 0.7), g.rgb(lin(28, 26, 24)), g.rgb(lin(58, 50, 42)))
        return dict(color=base, rough=0.85, metal=0.0, height=g.add(n, n2), bump=0.3, bump_dist=0.003)
    pbr('heatshield', heatshield)

    def black_paint(g):
        sc = scuffs(g, 5.0, 10.0)
        return dict(color=g.rgb(lin(26, 26, 28)), rough=g.add(0.35, g.mul(sc, 0.1)), metal=0.0, height=sc, bump=0.03, bump_dist=0.0004)
    pbr('black_paint', black_paint)

    def nav_red(g):
        return dict(color=g.rgb((0.8, 0.05, 0.03)), rough=0.2, metal=0.0, emit=g.rgb((1.0, 0.06, 0.03)), estr=25.0)
    pbr('nav_red', nav_red, emissive=True)

    def nav_green(g):
        return dict(color=g.rgb((0.05, 0.8, 0.2)), rough=0.2, metal=0.0, emit=g.rgb((0.1, 1.0, 0.3)), estr=25.0)
    pbr('nav_green', nav_green, emissive=True)

    def nav_white(g):
        return dict(color=g.rgb((0.9, 0.9, 0.9)), rough=0.2, metal=0.0, emit=g.rgb((1.0, 0.98, 0.94)), estr=25.0)
    pbr('nav_white', nav_white, emissive=True)

    def window_ext(g):
        return dict(color=g.rgb((0.02, 0.025, 0.03)), rough=0.03, metal=0.0, spec=0.8, coat=1.0, coat_rough=0.01)
    pbr('window_dark', window_ext)


# ---------------------------------------------------------------------------
# Debris

def extras_materials():
    def weld_blue(g):
        return dict(color=g.rgb((0.3, 0.6, 1.0)), rough=0.2, metal=0.0, emit=g.rgb((0.35, 0.65, 1.0)), estr=18.0)
    pbr('weld_blue', weld_blue, emissive=True)

    def suit(g):
        # the spacesuit's outer layer: white Ortho-fabric, soft seams, a
        # little grubby at the knees and gloves
        w = weave(g, 0.0012)
        n = g.noise(obj(g), scale=6.0, detail=5.0)
        n2 = g.noise(obj(g), scale=60.0, detail=3.0)
        base = g.mix(g.smooth(n, 0.55, 0.85), g.rgb(lin(226, 224, 216)), g.rgb(lin(196, 192, 180)))
        return dict(color=base, rough=0.78, metal=0.0, height=g.add(g.mul(w, 0.3), g.add(n2, g.mul(n, 1.5))), bump=0.3,
                    bump_dist=0.003, spec=0.35)
    pbr('suit', suit)

    def suit_red(g):
        n = g.noise(obj(g), scale=60.0, detail=3.0)
        return dict(color=g.rgb(lin(170, 30, 26)), rough=0.8, metal=0.0, height=n, bump=0.2, bump_dist=0.002)
    pbr('suit_red', suit_red)

    def visor_gold(g):
        n = g.noise(obj(g), scale=30.0, detail=2.0)
        return dict(color=g.rgb(lin(250, 196, 100)), rough=g.add(0.03, g.mul(n, 0.03)), metal=1.0)
    pbr('visor_gold', visor_gold)

    def duck_yellow(g):
        n = g.noise(obj(g), scale=40.0, detail=2.0)
        return dict(color=g.rgb(lin(252, 206, 20)), rough=g.add(0.32, g.mul(n, 0.08)), metal=0.0, height=n, bump=0.03,
                    bump_dist=0.001, coat=0.3)
    pbr('duck_yellow', duck_yellow)

    def duck_orange(g):
        return dict(color=g.rgb(lin(240, 110, 20)), rough=0.35, metal=0.0, coat=0.3)
    pbr('duck_orange', duck_orange)

    def bag(g):
        w = weave(g, 0.0018)
        n = g.noise(obj(g), scale=9.0, detail=5.0)
        base = g.mix(g.smooth(n, 0.5, 0.85), g.rgb(lin(222, 220, 212)), g.rgb(lin(190, 186, 172)))
        return dict(color=base, rough=0.85, metal=0.0, height=g.add(w, g.mul(n, 1.2)), bump=0.35, bump_dist=0.003, spec=0.3)
    pbr('bag', bag)


def debris_materials():
    def torn_alu(g):
        pt = g.node('ShaderNodeNewGeometry', out='Pointiness')
        edge = g.smooth(pt, 0.52, 0.62)
        n = g.noise(obj(g), scale=9.0, detail=6.0)
        burn = g.clamp01(g.add(g.mul(edge, 0.9), g.mul(g.smooth(n, 0.55, 0.8), 0.6)))
        mk = machining(g, 500.0)
        base = g.mix(g.mul(rand(g), 0.6), g.rgb(lin(178, 180, 184)), g.rgb(lin(150, 150, 154)))
        heat = g.mix(g.smooth(n, 0.3, 0.7), g.rgb(lin(120, 90, 70)), g.rgb(lin(90, 70, 90)))       # heat tint
        base = g.mix(g.mul(burn, 0.5), base, heat)
        base = g.mix(g.mul(g.smooth(burn, 0.6, 1.0), 0.9), base, g.rgb(lin(24, 20, 18)))           # soot
        rough = g.add(0.2, g.mul(burn, 0.6))
        metal = g.sub(1.0, g.mul(g.smooth(burn, 0.6, 1.0), 0.8))
        return dict(color=base, rough=rough, metal=metal, height=g.add(mk, g.mul(n, 2.0)), bump=0.1, bump_dist=0.001)
    pbr('torn_alu', torn_alu)

    def torn_white(g):
        pt = g.node('ShaderNodeNewGeometry', out='Pointiness')
        edge = g.smooth(pt, 0.5, 0.62)
        n = g.noise(obj(g), scale=7.0, detail=6.0)
        chip = g.smooth(g.add(g.mul(edge, 0.8), g.mul(n, 0.5)), 0.55, 0.62)
        burn = g.smooth(g.add(g.mul(edge, 0.7), g.mul(g.noise(obj(g), scale=3.0, detail=4.0), 0.6)), 0.7, 0.95)
        base = g.mix(chip, g.rgb(lin(220, 220, 214)), g.rgb(lin(170, 172, 176)))
        base = g.mix(burn, base, g.rgb(lin(30, 26, 24)))
        return dict(color=base, rough=g.add(0.4, g.mul(burn, 0.4)), metal=g.mul(chip, 0.9), height=g.add(chip, n), bump=0.15, bump_dist=0.001)
    pbr('torn_white', torn_white)

    def honeycomb(g):
        uv = uvtex(g)
        vor = g.voronoi(g.vmul(obj(g), (1, 1, 1)), scale=160.0, feature='DISTANCE_TO_EDGE', rand=0.15)
        wall = g.smooth(vor, 0.06, 0.02)
        base = g.mix(wall, g.rgb(lin(50, 46, 40)), g.rgb(lin(196, 190, 170)))
        return dict(color=base, rough=g.sub(0.7, g.mul(wall, 0.4)), metal=g.mul(wall, 0.9), height=wall, bump=0.6, bump_dist=0.002)
    pbr('honeycomb', honeycomb)

    def composite(g):
        uv = uvtex(g)
        u, v, _ = g.separate(uv)
        k = 3.14159 / 0.006
        a = g.math('SINE', g.mul(u, k))
        b = g.math('SINE', g.mul(v, k))
        tw = g.smooth(g.mul(a, b), -0.1, 0.1)
        base = g.mix(tw, g.rgb(lin(34, 34, 36)), g.rgb(lin(48, 48, 52)))
        return dict(color=base, rough=g.add(0.25, g.mul(tw, 0.1)), metal=0.0, height=tw, bump=0.15, bump_dist=0.0006, coat=0.6)
    pbr('composite', composite)

    def burnt(g):
        n = g.noise(obj(g), scale=14.0, detail=8.0)
        n2 = g.noise(obj(g), scale=90.0, detail=4.0)
        base = g.mix(g.smooth(n, 0.4, 0.75), g.rgb(lin(20, 18, 17)), g.rgb(lin(70, 56, 44)))
        return dict(color=base, rough=0.8, metal=g.mul(g.smooth(n2, 0.7, 0.8), 0.5), height=g.add(n, n2), bump=0.35, bump_dist=0.002)
    pbr('burnt', burnt)
