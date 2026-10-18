"""Procedural PBR materials for Dust Creek, all built as Cycles node trees.

The look we are after is a real frontier town at golden hour: timber that has
been baked grey by forty summers, paint that survives only in the sheltered
places, dust drifted against the bottom of every wall and on every ledge,
iron that has bled rust down the boards beneath it.

Everything reads from three inputs the MeshBuilder writes on every board:
  - UV "grain":  metres, U along the grain, so streaks follow each board.
  - UV "local":  U metres along, V 0..1 across (peeling starts at edges).
  - face attr "rand": one random value per board, so no two boards match.
and from world position (dirt height, dust on upward faces, big patches).

Colours are scene-linear albedos kept inside real-world ranges (weathered
wood ~0.1-0.35, dry dirt ~0.25-0.45) so the baked light is physically sane.
"""

import bpy

from .nodes import new_material, new_group, group_node

_LIB = {}


def lin(r, g, b):
    """sRGB 0-255 -> linear, so palettes can be picked from reference swatches."""
    def c(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (c(r), c(g), c(b))


# ---------------------------------------------------------------------------
# Node groups

def wood_group():
    grp, g, gin, gout = new_group("DC_Wood", [
        ("Light", 'NodeSocketColor', lin(138, 124, 108)),
        ("Dark", 'NodeSocketColor', lin(74, 62, 52)),
        ("Bleach", 'NodeSocketFloat', 0.5),
        ("Paint", 'NodeSocketColor', lin(200, 190, 170)),
        ("Paint Amount", 'NodeSocketFloat', 0.0),
        ("Paint Wear", 'NodeSocketFloat', 0.5),
        ("Dirt", 'NodeSocketFloat', 1.0),
        ("Dirt Height", 'NodeSocketFloat', 0.9),
        ("Grain Scale", 'NodeSocketFloat', 1.0),
        ("Rough", 'NodeSocketFloat', 0.85),
        ("Nails", 'NodeSocketFloat', 1.0),
        ("Dirt Base", 'NodeSocketFloat', 0.0),
    ], [("BSDF", 'NodeSocketShader', None), ("Albedo", 'NodeSocketColor', None)])
    I = lambda n: g.out(gin, n)

    u, v, _ = g.separate(g.uv('grain'))
    _, vn, _ = g.separate(g.uv('local'))
    r = g.attr('rand')
    r2 = g.math('FRACT', g.mul(r, 7.13))
    r3 = g.math('FRACT', g.mul(r, 13.71))
    gs = I("Grain Scale")
    pos = g.geo('Position')
    nrm = g.geo('Normal')

    # Broad streaks stretched hard along the grain; the per-board random W
    # decorrelates neighbouring boards.
    streak = g.noise(g.combine(g.mul(g.mul(u, gs), 0.22), g.mul(g.mul(v, gs), 7.0), g.mul(r, 23.0)),
                     scale=2.2, detail=7.0, rough=0.62)
    # Fine grain: noise squeezed ~80:1 along the board gives irregular
    # raised-grain lines (a sine wave read as corrugated card).
    fine = g.noise(g.combine(g.mul(g.mul(u, gs), 0.5), g.mul(g.mul(v, gs), 55.0), g.mul(r, 7.0)),
                   scale=1.4, detail=4.0, rough=0.55, dist=0.4)
    # Growth rings as faint distorted bands, low weight: the cathedral figure
    # of flat-sawn boards.
    rings = g.wave(g.combine(g.madd(streak, 0.25, g.mul(v, gs)), g.mul(g.mul(u, gs), 0.02), g.mul(r, 11.0)),
                   scale=5.0, dist=9.0, detail=4.0, direction='X', dscale=1.5)
    lines = g.madd(fine, 0.75, g.mul(rings, 0.25))
    grain = g.madd(lines, 0.35, g.mul(streak, 0.65))
    base = g.mix(g.smooth(grain, 0.3, 0.75), I("Dark"), I("Light"))
    # Per-board tone: some boards replaced later, some from a different log.
    base = g.hsv(base, h=g.madd(r3, 0.03, 0.485), s=g.madd(r2, 0.45, 0.7), v=g.madd(r2, 0.5, 0.75))

    # Checks: long thin splits along the grain.
    ck = g.wave(g.combine(g.mul(v, gs), g.mul(u, 0.02), g.mul(r, 5.0)), scale=19.0, dist=7.0,
                detail=1.0, direction='X', profile='SAW')
    ckmask = g.smooth(g.noise(g.combine(g.mul(u, 0.7), g.mul(v, 3.0), r), scale=1.5, detail=2.0), 0.45, 0.62)
    crack = g.mul(g.smooth(ck, 0.955, 0.99), ckmask)

    # Sun bleaching toward silver-grey, patchy.
    patch = g.noise(pos, scale=0.9, detail=3.0, rough=0.5)
    grey = g.mix(grain, g.rgb(lin(118, 112, 104)), g.rgb(lin(170, 164, 152)))
    bl = g.mul(I("Bleach"), g.madd(patch, 0.7, 0.55), clamp=True)
    col = g.mix(bl, base, grey)
    col = g.mix(g.mul(crack, 0.75), col, g.rgb(lin(30, 24, 20)))

    # Paint that peels from board edges and in patches. A slow, large-scale
    # 'exposure' field decides where whole areas have gone bare (weather
    # side, splash zone) and where the paint still holds; the fine field
    # draws the flakes along that boundary.
    peeln = g.noise(g.vadd(g.vmul(pos, (2.2, 2.2, 3.0)), g.combine(r, r2, 0)), scale=1.6, detail=12.0, rough=0.7)
    expo = g.noise(pos, scale=0.35, detail=2.0, rough=0.5)
    edge = g.sub(1.0, g.smooth(g.math('MINIMUM', vn, g.sub(1.0, vn)), 0.0, 0.2))
    pv = g.add(g.add(g.mul(peeln, 0.55), g.mul(g.smooth(expo, 0.3, 0.7), 0.55)),
               g.add(g.mul(edge, 0.16), g.mul(g.sub(1.0, streak), 0.08)))
    thr = g.sub(1.05, g.mul(I("Paint Wear"), 0.6))
    peeled = g.smooth(pv, thr, g.add(thr, 0.025))
    pmask = g.mul(I("Paint Amount"), g.sub(1.0, peeled))
    pnoise = g.noise(pos, scale=3.0, detail=4.0)
    pc = g.mix(g.madd(pnoise, 0.35, 0.0), I("Paint"), g.hsv(I("Paint"), s=0.6, v=1.25))
    pc = g.mix(g.mul(I("Bleach"), 0.5), pc, g.hsv(pc, s=0.55, v=1.15))
    pc = g.mix(g.mul(lines, 0.25), pc, g.hsv(pc, v=0.8))  # grain telegraphing through
    col = g.mix(pmask, col, pc)
    # Dark rim where flakes have lifted: dirt collects in the chipped edge.
    rim = g.mul(g.mul(g.smooth(pv, g.sub(thr, 0.03), thr), g.sub(1.0, peeled)), I("Paint Amount"))
    col = g.mix(g.mul(rim, 0.45), col, g.rgb(lin(40, 32, 26)))

    # Cut nails on the studs (every 24 in), two per board, bleeding rust.
    fu = g.math('FRACT', g.mul(u, 1.0 / 0.61))
    du = g.mul(g.sub(0.5, g.math('ABSOLUTE', g.sub(fu, 0.5))), 0.61)
    dv = g.mul(g.math('ABSOLUTE', g.sub(g.math('ABSOLUTE', g.sub(vn, 0.5)), 0.22)), 0.2)
    nd = g.math('SQRT', g.add(g.mul(du, du), g.mul(dv, dv)))
    nail = g.mul(g.sub(1.0, g.smooth(nd, 0.0035, 0.006)), I("Nails"))
    halo = g.mul(g.mul(g.sub(1.0, g.smooth(nd, 0.004, 0.022)), I("Nails")), g.mul(r3, 0.4))
    col = g.mix(halo, col, g.rgb(lin(92, 52, 30)))
    col = g.mix(nail, col, g.rgb(lin(28, 20, 16)))

    # Rain streaks: dark runs down vertical faces (and over the paint).
    px, py, pz = g.separate(pos)
    nzv = g.math('ABSOLUTE', g.separate(nrm)[2])
    vert = g.sub(1.0, g.smooth(nzv, 0.3, 0.6))
    rs = g.noise(g.combine(g.mul(px, 7.0), g.mul(py, 7.0), g.mul(pz, 0.35)), scale=1.0, detail=5.0, rough=0.6)
    rain = g.mul(g.mul(g.smooth(rs, 0.54, 0.8), vert), 0.45)
    col = g.mix(rain, col, g.hsv(col, s=0.8, v=0.7))
    # Dust: drifted against the bottom of walls and settled on ledges.
    z = g.separate(pos)[2]
    dn = g.noise(pos, scale=2.5, detail=6.0, rough=0.6)
    lowdirt = g.mul(g.sub(1.0, g.smooth(g.sub(z, I("Dirt Base")), 0.0, I("Dirt Height"))), g.madd(dn, 1.1, 0.25))
    top = g.mul(g.smooth(g.separate(nrm)[2], 0.55, 0.95), 0.55)
    dmask = g.mul(g.add(lowdirt, top), I("Dirt"), clamp=True)
    dust = g.mix(dn, g.rgb(lin(150, 122, 94)), g.rgb(lin(182, 152, 118)))
    col = g.mix(dmask, col, dust)

    rough = g.mixf(pmask, g.madd(lines, 0.08, I("Rough")), 0.62)
    rough = g.mixf(dmask, rough, 0.97)
    h = g.add(g.add(g.mul(fine, 0.3), g.mul(streak, 0.3)), g.sub(g.mul(pmask, 0.5), g.mul(crack, 1.2)))
    h = g.sub(h, g.mul(nail, -0.6))
    nrm_out = g.bump(h, strength=0.3, distance=0.004)
    bsdf = g.principled(col, rough=rough, normal=nrm_out, spec=0.35)
    g.links.new(bsdf, gout.inputs['BSDF'])
    g.links.new(col, gout.inputs['Albedo'])
    return grp


def metal_group():
    grp, g, gin, gout = new_group("DC_Metal", [
        ("Base", 'NodeSocketColor', lin(70, 68, 66)),
        ("Rust", 'NodeSocketFloat', 0.6),
        ("Rough", 'NodeSocketFloat', 0.55),
        ("Metallic", 'NodeSocketFloat', 0.7),
        ("Scale", 'NodeSocketFloat', 1.0),
        ("Dirt", 'NodeSocketFloat', 0.5),
        ("Rust A", 'NodeSocketColor', lin(56, 32, 20)),
        ("Rust B", 'NodeSocketColor', lin(110, 62, 36)),
    ], [("BSDF", 'NodeSocketShader', None)])
    I = lambda n: g.out(gin, n)
    pos = g.vmul(g.geo('Position'), g.combine(I("Scale"), I("Scale"), I("Scale")))
    x, y, z = g.separate(pos)
    rn = g.noise(pos, scale=3.0, detail=10.0, rough=0.68)
    runs = g.noise(g.combine(g.mul(x, 9.0), g.mul(y, 9.0), g.mul(z, 0.7)), scale=2.0, detail=3.0)
    mv = g.madd(runs, 0.25, rn)
    thr = g.sub(0.72, g.mul(I("Rust"), 0.42))
    mask = g.smooth(mv, thr, g.add(thr, 0.08))
    rc = g.mix(g.smooth(g.noise(pos, scale=9.0, detail=5.0), 0.3, 0.75), I("Rust A"), I("Rust B"))
    basec = g.mix(g.noise(pos, scale=6.0, detail=3.0), I("Base"), g.hsv(I("Base"), v=1.35))
    col = g.mix(mask, basec, rc)
    dust = g.mul(g.smooth(g.separate(g.geo('Normal'))[2], 0.5, 0.95), I("Dirt"))
    col = g.mix(g.mul(dust, 0.6), col, g.rgb(lin(160, 132, 102)))
    metal = g.mul(I("Metallic"), g.sub(1.0, g.math('MAXIMUM', mask, dust)))
    rough = g.mixf(mask, I("Rough"), 0.92)
    nrm = g.bump(g.add(mask, g.mul(rn, 0.3)), strength=0.25, distance=0.002)
    bsdf = g.principled(col, rough=rough, metal=metal, normal=nrm)
    g.links.new(bsdf, gout.inputs['BSDF'])
    return grp


def stone_group():
    """Cut sandstone blocks laid in courses, for the bank front and church
    foundations. UV 'grain' gives wall-plane metres."""
    grp, g, gin, gout = new_group("DC_Stone", [
        ("A", 'NodeSocketColor', lin(176, 142, 108)),
        ("B", 'NodeSocketColor', lin(150, 112, 80)),
        ("Mortar", 'NodeSocketColor', lin(190, 172, 150)),
        ("Block W", 'NodeSocketFloat', 0.62),
        ("Block H", 'NodeSocketFloat', 0.3),
        ("Dirt", 'NodeSocketFloat', 1.0),
        ("Rough", 'NodeSocketFloat', 0.9),
    ], [("BSDF", 'NodeSocketShader', None)])
    I = lambda n: g.out(gin, n)
    u, v, _ = g.separate(g.uv('grain'))
    pos = g.geo('Position')
    vec = g.combine(u, v, 0.0)
    br = g.new('ShaderNodeTexBrick', offset=0.5, squash=0.72, squash_frequency=2)
    g.set_in(br, 'Vector', vec)
    g.set_in(br, 'Color1', I("A"))
    g.set_in(br, 'Color2', I("B"))
    g.set_in(br, 'Mortar', I("Mortar"))
    g.set_in(br, 'Scale', 1.0)
    g.set_in(br, 'Mortar Size', 0.012)
    g.set_in(br, 'Mortar Smooth', 0.3)
    g.set_in(br, 'Bias', 0.0)
    g.set_in(br, 'Brick Width', I("Block W"))
    g.set_in(br, 'Row Height', I("Block H"))
    bc = g.out(br, 'Color')
    bf = g.out(br, 'Fac')
    grainn = g.noise(g.vmul(pos, (6, 6, 18)), scale=4.0, detail=8.0, rough=0.6)
    pits = g.voronoi(pos, scale=30.0, feature='F1')
    col = g.mix(g.mul(grainn, 0.45), bc, g.hsv(bc, v=0.8))
    col = g.mix(g.mul(g.sub(1.0, g.smooth(pits, 0.02, 0.08)), 0.5), col, g.hsv(col, v=0.6))
    # chipped block edges: mortar mask widened by noise
    chip = g.mul(g.smooth(bf, 0.2, 0.6), g.smooth(g.noise(pos, scale=8.0, detail=6.0), 0.5, 0.7))
    col = g.mix(g.mul(chip, 0.5), col, g.hsv(bc, v=0.7))
    z = g.separate(pos)[2]
    dn = g.noise(pos, scale=2.0, detail=6.0)
    dmask = g.mul(g.mul(g.sub(1.0, g.smooth(z, 0.0, 1.1)), g.madd(dn, 1.0, 0.3)), I("Dirt"), clamp=True)
    col = g.mix(dmask, col, g.rgb(lin(160, 128, 96)))
    # rain streaks under the cornice
    streaks = g.noise(g.combine(g.mul(g.separate(pos)[0], 14), g.mul(g.separate(pos)[1], 14), g.mul(z, 0.5)), scale=1.5, detail=4.0)
    col = g.mix(g.mul(g.smooth(streaks, 0.55, 0.8), 0.3), col, g.hsv(col, v=0.7, s=0.8))
    h = g.add(g.mul(bf, -1.0), g.add(g.mul(grainn, 0.4), g.mul(chip, -0.6)))
    nrm = g.bump(h, strength=0.5, distance=0.008)
    bsdf = g.principled(col, rough=I("Rough"), normal=nrm, spec=0.3)
    g.links.new(bsdf, gout.inputs['BSDF'])
    return grp


# ---------------------------------------------------------------------------
# Materials

def wood(name, light=None, dark=None, bleach=0.55, paint=None, paint_amount=0.0, wear=0.5,
         dirt=1.0, dirt_height=0.9, grain=1.0, rough=0.85, nails=1.0, dirt_base=0.0,
         surface='wood'):
    m, g = new_material(name)
    n = group_node(g, bpy.data.node_groups["DC_Wood"], {
        "Bleach": bleach, "Paint Amount": paint_amount, "Paint Wear": wear, "Dirt": dirt,
        "Dirt Height": dirt_height, "Grain Scale": grain, "Rough": rough, "Nails": nails,
        "Dirt Base": dirt_base,
    })
    if light is not None:
        g.set_in(n, "Light", light)
    if dark is not None:
        g.set_in(n, "Dark", dark)
    if paint is not None:
        g.set_in(n, "Paint", paint)
    g.output(g.out(n, "BSDF"))
    m["surface"] = surface
    _LIB[name] = m
    return m


def metal(name, base=lin(70, 68, 66), rust=0.6, rough=0.55, metallic=0.7, scale=1.0, dirt=0.5,
          surface='metal', patina=None):
    m, g = new_material(name)
    n = group_node(g, bpy.data.node_groups["DC_Metal"], {
        "Base": base, "Rust": rust, "Rough": rough, "Metallic": metallic, "Scale": scale, "Dirt": dirt})
    if patina is not None:
        g.set_in(n, "Rust A", patina[0])
        g.set_in(n, "Rust B", patina[1])
    g.output(g.out(n, "BSDF"))
    m["surface"] = surface
    _LIB[name] = m
    return m


def stone(name, a=None, b=None, mortar=None, bw=0.62, bh=0.3, dirt=1.0):
    m, g = new_material(name)
    n = group_node(g, bpy.data.node_groups["DC_Stone"], {"Block W": bw, "Block H": bh, "Dirt": dirt})
    for k, v in (("A", a), ("B", b), ("Mortar", mortar)):
        if v is not None:
            g.set_in(n, k, v)
    g.output(g.out(n, "BSDF"))
    m["surface"] = 'stone'
    _LIB[name] = m
    return m


def simple(name, color, rough=0.8, metal=0.0, surface='wood', noise=0.15, spec=0.4,
           sheen=None, coat=None, scale=6.0):
    """A plain principled material with a little value noise so nothing is
    ever a flat CG colour."""
    m, g = new_material(name)
    pos = g.geo('Position')
    n = g.noise(pos, scale=scale, detail=6.0, rough=0.6)
    col = g.mix(g.mul(n, noise * 2), g.rgb(color), g.hsv(g.rgb(color), v=0.7))
    bsdf = g.principled(col, rough=rough, metal=metal, spec=spec, sheen=sheen, coat=coat,
                        normal=g.bump(n, strength=0.15, distance=0.003))
    g.output(bsdf)
    m["surface"] = surface
    _LIB[name] = m
    return m


def glass_material():
    """Dusty window glass for `glass.<id>` panes. Kept deliberately simple
    (a standard glTF material) so the game can give it reflections; the dust
    is a small grayscale texture made in `signs.dust_texture`."""
    m, g = new_material("glass")
    m["surface"] = 'glass'
    _LIB["glass"] = m
    return m


def cloth(name, color, stripe=None, stripe_w=0.25, fade=0.4, surface='cloth'):
    m, g = new_material(name)
    u, v, _ = g.separate(g.uv('grain'))
    pos = g.geo('Position')
    base = g.rgb(color)
    if stripe is not None:
        s = g.math('FRACT', g.mul(v, 1.0 / (2 * stripe_w)))
        st = g.smooth(s, 0.48, 0.52)
        base = g.mix(st, base, g.rgb(stripe))
    weave = g.wave(g.combine(g.mul(u, 400.0), g.mul(v, 400.0), 0), scale=1.0, direction='DIAGONAL')
    n = g.noise(pos, scale=2.0, detail=6.0)
    col = g.mix(g.mul(n, fade), base, g.hsv(base, s=0.5, v=1.3))
    col = g.mix(g.mul(g.smooth(g.separate(g.geo('Normal'))[2], 0.4, 0.9), 0.5), col, g.rgb(lin(170, 142, 110)))
    stain = g.smooth(g.noise(pos, scale=4.0, detail=8.0), 0.62, 0.7)
    col = g.mix(g.mul(stain, 0.3), col, g.hsv(col, v=0.6))
    bsdf = g.principled(col, rough=0.95, sheen=0.3, normal=g.bump(weave, strength=0.1, distance=0.001))
    g.output(bsdf)
    m["surface"] = surface
    _LIB[name] = m
    return m


def hay_material():
    m, g = new_material("hay")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    fib = g.noise(g.combine(g.mul(x, 30), g.mul(y, 30), g.mul(z, 4)), scale=3.0, detail=6.0, rough=0.7)
    fib2 = g.noise(g.combine(g.mul(x, 4), g.mul(y, 40), g.mul(z, 40)), scale=3.0, detail=6.0, rough=0.7)
    f = g.math('MAXIMUM', fib, fib2)
    col = g.ramp(f, [(0.25, lin(96, 74, 38)), (0.55, lin(180, 146, 78)), (0.8, lin(220, 190, 120))])
    col = g.mix(g.mul(g.noise(pos, scale=1.5, detail=3), 0.5), col, g.rgb(lin(130, 118, 84)))
    bsdf = g.principled(col, rough=0.9, normal=g.bump(f, strength=0.6, distance=0.02), sheen=0.3)
    g.output(bsdf)
    m["surface"] = 'cloth'
    _LIB["hay"] = m
    return m


def dirt_prop_material():
    """Loose dirt for piles/mounds that are not part of the street."""
    m, g = new_material("dirt_pile")
    pos = g.geo('Position')
    n = g.noise(pos, scale=6.0, detail=10.0, rough=0.65)
    col = g.ramp(n, [(0.3, lin(128, 98, 70)), (0.7, lin(176, 142, 106))])
    bsdf = g.principled(col, rough=0.98, normal=g.bump(n, strength=0.5, distance=0.02))
    g.output(bsdf)
    m["surface"] = 'dirt'
    _LIB["dirt_pile"] = m
    return m


def horse_material():
    m, g = new_material("horse")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    hair = g.noise(g.combine(g.mul(x, 60), g.mul(y, 60), g.mul(z, 8)), scale=2.0, detail=4.0)
    blotch = g.noise(pos, scale=4.0, detail=4.0)
    col = g.ramp(g.madd(hair, 0.3, g.mul(blotch, 0.7)), [(0.3, lin(104, 56, 30)), (0.7, lin(150, 86, 48))])
    bsdf = g.principled(col, rough=0.55, sheen=0.6, normal=g.bump(hair, strength=0.2, distance=0.002))
    g.output(bsdf)
    m["surface"] = 'cloth'
    _LIB["horse"] = m
    return m


def piano_material():
    m, g = new_material("piano_wood")
    u, v, _ = g.separate(g.uv('grain'))
    lines = g.wave(g.combine(v, g.mul(u, 0.03), 0), scale=6.0, dist=4.0, detail=3.0)
    col = g.mix(lines, g.rgb(lin(30, 14, 8)), g.rgb(lin(62, 30, 16)))
    pos = g.geo('Position')
    dust = g.mul(g.smooth(g.separate(g.geo('Normal'))[2], 0.6, 0.95), 0.35)
    col = g.mix(dust, col, g.rgb(lin(150, 128, 100)))
    rough = g.mixf(dust, g.madd(g.noise(pos, scale=8.0), 0.15, 0.22), 0.8)
    bsdf = g.principled(col, rough=rough, coat=0.4)
    g.output(bsdf)
    m["surface"] = 'wood'
    _LIB["piano_wood"] = m
    return m


def build_library():
    """Create every shared material. Returns a dict name -> material."""
    _LIB.clear()
    wood_group()
    metal_group()
    stone_group()

    # Bare timber in several ages
    wood("wood_raw", bleach=0.6)
    wood("wood_grey", bleach=0.9, light=lin(150, 140, 128), dark=lin(92, 84, 76))
    wood("wood_dark", bleach=0.2, light=lin(110, 84, 62), dark=lin(58, 42, 32), dirt=0.6)
    wood("wood_new", bleach=0.15, light=lin(178, 140, 100), dark=lin(120, 86, 56), nails=0.0)
    wood("wood_interior", bleach=0.0, light=lin(96, 70, 50), dark=lin(52, 38, 28), dirt=0.2, nails=0.0)
    wood("wood_floor", bleach=0.75, light=lin(150, 132, 112), dark=lin(84, 70, 58), dirt=1.0,
         dirt_height=0.8, nails=1.0)
    wood("wood_post", bleach=0.7, dirt=1.0, dirt_height=0.7, nails=0.0)
    wood("wood_crate", bleach=0.6, light=lin(136, 118, 96), dark=lin(86, 70, 56), dirt=1.0, dirt_height=0.5,
         nails=1.0)
    wood("wood_barrel", bleach=0.45, light=lin(126, 100, 76), dark=lin(70, 54, 42), dirt=0.9, nails=0.0)
    # Painted timber: the town's palette. Faded, peeling, never saturated.
    wood("paint_red", paint=lin(128, 42, 30), paint_amount=1.0, wear=0.55)
    wood("paint_ochre", paint=lin(186, 140, 70), paint_amount=1.0, wear=0.5)
    wood("paint_green", paint=lin(78, 98, 82), paint_amount=1.0, wear=0.5)
    wood("paint_blue", paint=lin(92, 108, 124), paint_amount=1.0, wear=0.55)
    wood("paint_cream", paint=lin(214, 196, 160), paint_amount=1.0, wear=0.45)
    wood("paint_white", paint=lin(226, 220, 204), paint_amount=1.0, wear=0.55, bleach=0.5)
    wood("church_white", paint=lin(232, 228, 214), paint_amount=1.0, wear=0.32, bleach=0.3)
    wood("paint_brown", paint=lin(104, 70, 48), paint_amount=1.0, wear=0.4)
    wood("paint_black", paint=lin(28, 26, 24), paint_amount=1.0, wear=0.35)
    wood("trim_white", paint=lin(222, 214, 196), paint_amount=1.0, wear=0.35, nails=0.0)
    wood("trim_dark", paint=lin(60, 44, 34), paint_amount=1.0, wear=0.3, nails=0.0)
    wood("trim_green", paint=lin(58, 80, 64), paint_amount=1.0, wear=0.35, nails=0.0)
    wood("trim_red", paint=lin(120, 38, 28), paint_amount=1.0, wear=0.35, nails=0.0)
    wood("backing", bleach=0.0, light=lin(34, 28, 24), dark=lin(20, 16, 14), dirt=0.0, nails=0.0)
    # Roofing
    wood("shingle", bleach=0.85, light=lin(140, 128, 116), dark=lin(70, 62, 56), dirt=0.3, nails=0.0,
         grain=2.0)
    metal("tin_roof", base=lin(120, 118, 114), rust=0.55, rough=0.45, metallic=0.6, scale=0.5, dirt=0.3)
    metal("iron", base=lin(46, 44, 42), rust=0.45, rough=0.6, metallic=0.5)
    metal("iron_rusty", base=lin(56, 52, 48), rust=0.85, rough=0.7, metallic=0.4)
    metal("bronze", base=lin(150, 104, 56), rust=0.4, rough=0.35, metallic=0.9, scale=2.0, dirt=0.2,
          patina=(lin(58, 70, 56), lin(96, 128, 104)))
    metal("brass", base=lin(170, 132, 70), rust=0.15, rough=0.3, metallic=0.9, scale=2.0, dirt=0.2)
    stone("stone_sand", a=lin(186, 150, 114), b=lin(138, 102, 76), mortar=lin(172, 150, 124))
    stone("stone_rubble", a=lin(150, 130, 110), b=lin(120, 102, 86), mortar=lin(170, 150, 126),
          bw=0.45, bh=0.28)
    stone("brick", a=lin(150, 72, 50), b=lin(124, 58, 40), mortar=lin(180, 160, 136), bw=0.23, bh=0.075)
    cloth("canvas", lin(196, 178, 146))
    cloth("burlap", lin(150, 122, 88), fade=0.3)
    cloth("canvas_stripe", lin(200, 186, 156), stripe=lin(132, 56, 42), stripe_w=0.22)
    cloth("canvas_green", lin(92, 108, 88), stripe=lin(190, 176, 146), stripe_w=0.18)
    cloth("curtain_red", lin(110, 30, 26), fade=0.25)
    cloth("curtain_cream", lin(200, 184, 150), fade=0.2)
    cloth("leather", lin(88, 56, 34), fade=0.2)
    simple("rope", lin(150, 124, 86), rough=0.95, surface='cloth', noise=0.3, scale=40.0)
    simple("black_void", lin(8, 7, 6), rough=1.0, noise=0.05)
    simple("piano_keys", lin(214, 204, 180), rough=0.4, noise=0.08)
    simple("piano_black", lin(14, 12, 10), rough=0.3, noise=0.05)
    simple("bottle_green", lin(40, 70, 40), rough=0.2, surface='glass')
    simple("paper_plain", lin(206, 190, 156), rough=0.95, surface='cloth', noise=0.2)
    simple("water", lin(40, 44, 36), rough=0.08, surface='water', noise=0.05, spec=0.6)
    simple("bone", lin(200, 188, 160), rough=0.8, surface='wood', noise=0.2)
    simple("feathers", lin(170, 160, 140), rough=0.9, surface='cloth')
    simple("iron_black", lin(22, 20, 19), rough=0.5, surface='metal', noise=0.15)
    simple("sandstone", lin(176, 110, 70), rough=0.95, surface='stone', noise=0.35, scale=0.2)
    hay_material()
    dirt_prop_material()
    horse_material()
    piano_material()
    glass_material()
    return _LIB


def get(name):
    return _LIB[name]
