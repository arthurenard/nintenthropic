"""Materials for Route 9 at night, all procedural Cycles node trees.

Everything is worn and damp: paint chipped to primer and rust, rust bleeding
down from every bolt, tin gone orange at its seams, cinder block stained
under its sills, burlap dark with rain. Rain matters twice: wet surfaces are
darker (water fills the pores) and glossier (a film of water), and the
up-facing ones carry beads and sheen - that is what makes the sodium light
and the neon glint on everything near the crossroads.

High Noon's weathered-wood and metal node groups (dustcreek.materials) are
reused for the fence, the barn and the poles; the rest is new. Albedos stay
in real-world ranges so the baked light is sane: asphalt 0.04-0.08,
concrete 0.2-0.3, fresh paint up to 0.6.
"""

import bpy

from .common import DN, lin
from dustcreek import materials as DM

_LIB = {}


def _register(name, m, surface):
    m["surface"] = surface
    _LIB[name] = m
    return m


# ---------------------------------------------------------------------------
# Shared node groups

def wet_group():
    """Rain on a surface: darkens porous albedo, lowers roughness, more on
    up-facing faces; beads of water on the tops. Inputs albedo/rough and
    how porous; outputs the wet albedo/rough and a bead height."""
    grp, g, gin, gout = DN.new_group("R9_Wet", [
        ("Color", 'NodeSocketColor', (0.5, 0.5, 0.5)),
        ("Rough", 'NodeSocketFloat', 0.7),
        ("Porous", 'NodeSocketFloat', 0.6),
        ("Wet", 'NodeSocketFloat', 1.0),
    ], [("Color", 'NodeSocketColor', None), ("Rough", 'NodeSocketFloat', None), ("Beads", 'NodeSocketFloat', None)])
    I = lambda n: g.out(gin, n)
    pos = g.geo('Position')
    nz = g.separate(g.geo('Normal'))[2]
    top = g.smooth(nz, 0.2, 0.85)
    patchy = g.noise(pos, scale=1.3, detail=4.0, rough=0.55)
    w = g.mul(I("Wet"), g.add(g.mul(top, 0.55), g.mul(g.smooth(patchy, 0.3, 0.7), 0.45)), clamp=True)
    dark = g.sub(1.0, g.mul(g.mul(w, I("Porous")), 0.45))
    col = g.hsv(I("Color"), s=g.madd(w, 0.15, 1.0), v=dark)
    rough = g.mixf(w, I("Rough"), g.mul(I("Rough"), 0.45))
    beads_v = g.voronoi(pos, scale=260.0, feature='F1', out='Distance')
    beads = g.mul(g.sub(1.0, g.smooth(beads_v, 0.05, 0.3)), g.mul(top, w))
    rough = g.mixf(g.mul(beads, 0.8), rough, 0.08)
    g.links.new(col, gout.inputs['Color'])
    g.links.new(rough, gout.inputs['Rough'])
    g.links.new(beads, gout.inputs['Beads'])
    return grp


def paint_metal_group():
    """Painted sheet steel: chips down to primer and bare metal at edges and
    in patches, rust blooming from the chips and running down, grime."""
    grp, g, gin, gout = DN.new_group("R9_PaintMetal", [
        ("Paint", 'NodeSocketColor', lin(150, 30, 26)),
        ("Wear", 'NodeSocketFloat', 0.5),
        ("Rust", 'NodeSocketFloat', 0.5),
        ("Grime", 'NodeSocketFloat', 0.5),
        ("Gloss", 'NodeSocketFloat', 0.5),
        ("Scale", 'NodeSocketFloat', 1.0),
        ("Wet", 'NodeSocketFloat', 1.0),
    ], [("BSDF", 'NodeSocketShader', None)])
    I = lambda n: g.out(gin, n)
    s = I("Scale")
    pos = g.vmul(g.geo('Position'), g.combine(s, s, s))
    x, y, z = g.separate(pos)
    n1 = g.noise(pos, scale=3.0, detail=12.0, rough=0.7)
    n2 = g.noise(pos, scale=0.8, detail=3.0)
    chips_t = g.sub(0.78, g.mul(I("Wear"), 0.3))
    chip = g.smooth(g.add(g.mul(n1, 0.75), g.mul(n2, 0.35)), chips_t, g.add(chips_t, 0.02))
    rim = g.mul(g.smooth(g.add(g.mul(n1, 0.75), g.mul(n2, 0.35)), g.sub(chips_t, 0.03), chips_t), g.sub(1.0, chip))
    runs = g.noise(g.combine(g.mul(x, 11.0), g.mul(y, 11.0), g.mul(z, 0.6)), scale=1.6, detail=4.0)
    rust_m = g.mul(g.math('MAXIMUM', chip, g.mul(g.smooth(runs, 0.6, 0.85), 0.8)), I("Rust"), clamp=True)
    rust_c = g.mix(g.smooth(g.noise(pos, scale=14.0, detail=6.0), 0.3, 0.7), g.rgb(lin(62, 30, 16)), g.rgb(lin(122, 62, 30)))
    paint = g.mix(g.mul(n2, 0.3), I("Paint"), g.hsv(I("Paint"), s=0.8, v=1.18))
    paint = g.mix(g.mul(rim, 0.6), paint, g.rgb(lin(64, 64, 60)))           # primer at the chip rim
    col = g.mix(chip, paint, g.rgb(lin(72, 70, 66)))                          # bare steel
    col = g.mix(rust_m, col, rust_c)
    grime = g.mul(g.mul(g.smooth(g.noise(pos, scale=5.0, detail=6.0), 0.45, 0.8), I("Grime")), 0.7)
    col = g.mix(grime, col, g.hsv(col, v=0.55, s=0.8))
    rough = g.mixf(g.math('MAXIMUM', chip, rust_m), g.sub(0.75, g.mul(I("Gloss"), 0.5)), 0.85)
    wet = DN.group_node(g, bpy.data.node_groups["R9_Wet"], {"Color": col, "Rough": rough, "Porous": g.mul(rust_m, 0.8), "Wet": I("Wet")})
    metal = g.mul(g.mul(chip, g.sub(1.0, rust_m)), 0.8)
    h = g.add(g.mul(chip, -0.6), g.add(g.mul(rust_m, 0.4), g.mul(g.out(wet, 'Beads'), 0.6)))
    bsdf = g.principled(g.out(wet, 'Color'), rough=g.out(wet, 'Rough'), metal=metal,
                        normal=g.bump(h, strength=0.3, distance=0.001), coat=g.mul(I("Gloss"), 0.4))
    g.links.new(bsdf, gout.inputs['BSDF'])
    return grp


def paint_metal(name, paint, wear=0.5, rust=0.5, grime=0.5, gloss=0.5, scale=1.0, wet=1.0, surface='metal'):
    m, g = DN.new_material(name)
    n = DN.group_node(g, bpy.data.node_groups["R9_PaintMetal"], {
        "Paint": paint, "Wear": wear, "Rust": rust, "Grime": grime, "Gloss": gloss, "Scale": scale, "Wet": wet})
    g.output(g.out(n, "BSDF"))
    return _register(name, m, surface)


def simple(name, color, rough=0.7, metal=0.0, surface='wood', noise=0.15, scale=6.0, wet=1.0, porous=0.6,
           bump=0.15, spec=0.5, coat=None):
    """A plain principled material with value noise and rain."""
    m, g = DN.new_material(name)
    pos = g.geo('Position')
    n = g.noise(pos, scale=scale, detail=6.0, rough=0.6)
    col = g.mix(g.mul(n, noise * 2), g.rgb(color), g.hsv(g.rgb(color), v=0.7))
    w = DN.group_node(g, bpy.data.node_groups["R9_Wet"], {"Color": col, "Rough": rough, "Porous": porous, "Wet": wet})
    bsdf = g.principled(g.out(w, 'Color'), rough=g.out(w, 'Rough'), metal=metal, spec=spec, coat=coat,
                        normal=g.bump(g.add(n, g.out(w, 'Beads')), strength=bump, distance=0.003))
    g.output(bsdf)
    return _register(name, m, surface)


def concrete(name, color=lin(118, 116, 110), dirt=0.6, blocks=None, paint=None, surface='asphalt'):
    """Cast concrete or (with blocks=(w, h)) cinder block, optionally painted
    (paint flaking off the block face). Water stains run down from ledges."""
    m, g = DN.new_material(name)
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    mid = g.noise(pos, scale=2.0, detail=6.0, rough=0.6)
    fine = g.noise(pos, scale=40.0, detail=3.0)
    col = g.mix(g.add(g.mul(mid, 0.6), g.mul(fine, 0.4)), g.hsv(g.rgb(color), v=0.8), g.hsv(g.rgb(color), v=1.12))
    pits = g.voronoi(pos, scale=90.0, feature='F1', out='Distance')
    col = g.mix(g.mul(g.sub(1.0, g.smooth(pits, 0.02, 0.1)), 0.4), col, g.hsv(col, v=0.6))
    h = g.add(g.mul(fine, 0.3), g.mul(g.sub(1.0, g.smooth(pits, 0.02, 0.1)), -0.5))
    if blocks is not None:
        bw, bh = blocks
        # running bond in the wall's own plane: use whichever horizontal axis the face runs along
        nrm = g.geo('Normal')
        nx = g.math('ABSOLUTE', g.separate(nrm)[0])
        u = g.mixf(g.smooth(nx, 0.4, 0.6), x, y)
        br = g.new('ShaderNodeTexBrick', offset=0.5)
        g.set_in(br, 'Vector', g.combine(u, z, 0.0))
        g.set_in(br, 'Color1', col)
        g.set_in(br, 'Color2', g.hsv(col, v=0.93))
        g.set_in(br, 'Mortar', g.hsv(col, v=0.72))
        g.set_in(br, 'Scale', 1.0)
        g.set_in(br, 'Mortar Size', 0.008)
        g.set_in(br, 'Mortar Smooth', 0.2)
        g.set_in(br, 'Brick Width', bw)
        g.set_in(br, 'Row Height', bh)
        col = g.out(br, 'Color')
        mortar = g.out(br, 'Fac')
        h = g.sub(h, g.mul(mortar, 0.8))
    if paint is not None:
        pn = g.noise(pos, scale=3.5, detail=10.0, rough=0.7)
        keep = g.sub(1.0, g.smooth(g.add(g.mul(pn, 0.8), g.mul(mid, 0.3)), 0.66, 0.69))
        pc = g.mix(g.mul(mid, 0.4), g.rgb(paint), g.hsv(g.rgb(paint), v=0.82))
        col = g.mix(keep, col, pc)
        h = g.add(h, g.mul(keep, 0.2))
    # water stains: dark runs down the wall from the top, and rising damp
    runs = g.noise(g.combine(g.mul(x, 7.0), g.mul(y, 7.0), g.mul(z, 0.5)), scale=1.4, detail=5.0, rough=0.6)
    col = g.mix(g.mul(g.smooth(runs, 0.55, 0.8), 0.5 * dirt), col, g.hsv(col, v=0.6, s=0.9))
    damp = g.mul(g.sub(1.0, g.smooth(z, 0.05, 0.6)), g.madd(mid, 0.6, 0.3))
    col = g.mix(g.mul(damp, 0.7 * dirt), col, g.hsv(col, v=0.55, s=1.1))
    w = DN.group_node(g, bpy.data.node_groups["R9_Wet"], {"Color": col, "Rough": 0.85, "Porous": 0.8, "Wet": 1.0})
    bsdf = g.principled(g.out(w, 'Color'), rough=g.out(w, 'Rough'), spec=0.4,
                        normal=g.bump(g.add(h, g.out(w, 'Beads')), strength=0.35, distance=0.004))
    g.output(bsdf)
    return _register(name, m, surface)


def burlap(name, color=lin(104, 84, 56)):
    """Sandbags: coarse woven jute, soaked dark, mud splashed up the low ones."""
    m, g = DN.new_material(name)
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    u, v, _ = g.separate(g.uv('local'))
    weave_a = g.math('SINE', g.mul(g.add(x, y), 260.0))
    weave_b = g.math('SINE', g.mul(z, 260.0))
    weave = g.mul(g.add(weave_a, weave_b), 0.25)
    slub = g.noise(g.combine(g.mul(g.add(x, y), 30.0), g.mul(z, 4.0), 0.0), scale=2.0, detail=3.0)
    mid = g.noise(pos, scale=3.0, detail=5.0)
    col = g.mix(g.add(g.mul(mid, 0.6), g.mul(slub, 0.4)), g.hsv(g.rgb(color), v=0.75), g.hsv(g.rgb(color), v=1.15))
    col = g.mix(g.mul(g.add(weave, 0.5), 0.25), col, g.hsv(col, v=0.75))
    r = g.attr('rand')
    col = g.hsv(col, h=g.madd(r, 0.04, 0.48), s=g.madd(r, 0.3, 0.85), v=g.madd(r, 0.5, 0.75))
    # printed stencil and stitched seams read at arm's length
    seam_u = g.sub(1.0, g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(g.add(x, y), 1.6)), 0.5)), 0.47, 0.5))
    col = g.mix(g.mul(seam_u, 0.15), col, g.hsv(col, v=0.7))
    mud = g.mul(g.sub(1.0, g.smooth(z, 0.05, 0.55)), g.madd(mid, 0.8, 0.2))
    col = g.mix(g.mul(mud, 0.8), col, g.rgb(lin(46, 36, 26)))
    w = DN.group_node(g, bpy.data.node_groups["R9_Wet"], {"Color": col, "Rough": 0.95, "Porous": 1.0, "Wet": 1.0})
    h = g.add(g.mul(weave, 0.4), g.mul(slub, 0.5))
    bsdf = g.principled(g.out(w, 'Color'), rough=g.out(w, 'Rough'), sheen=0.3,
                        normal=g.bump(h, strength=0.4, distance=0.002))
    g.output(bsdf)
    return _register(name, m, 'sandbag')


def glass_dark(name, tint=(0.05, 0.06, 0.065), rough=0.05, dirt=0.5, surface='glass'):
    """Window glass at night: nearly black, a mirror for the lights, a film
    of grime and rain streaks that catch them."""
    m, g = DN.new_material(name)
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    streak = g.noise(g.combine(g.mul(x, 30.0), g.mul(y, 30.0), g.mul(z, 2.0)), scale=2.0, detail=4.0)
    grime = g.noise(pos, scale=4.0, detail=5.0)
    r = g.madd(g.smooth(grime, 0.4, 0.8), 0.25 * dirt, g.mul(g.smooth(streak, 0.55, 0.75), 0.15))
    col = g.mix(g.mul(g.smooth(grime, 0.5, 0.8), dirt), g.rgb(tint), g.rgb(lin(60, 58, 52)))
    bsdf = g.principled(col, rough=g.add(r, rough), spec=0.9, coat=0.3)
    g.output(bsdf)
    return _register(name, m, surface)


def emissive(name, color, strength, base=None, surface='glass', flicker=False):
    """A lamp's lit part: the neon tubes, the sodium lens, a candle flame.
    Emission plus a glassy base so it also reads unlit in the albedo pass."""
    m, g = DN.new_material(name)
    em = g.node('ShaderNodeEmission', inputs={'Color': color, 'Strength': strength}, out=0)
    b = g.principled(base or tuple(c * 0.5 for c in color), rough=0.15, spec=0.8)
    mix = g.node('ShaderNodeAddShader', inputs={0: em, 1: b}, out=0)
    g.output(mix)
    m["emissive"] = 1
    return _register(name, m, surface)


def rubber(name="rubber"):
    return simple(name, lin(22, 22, 23), rough=0.85, surface='metal', noise=0.2, scale=30.0, porous=0.2)


def chrome(name="chrome"):
    m, g = DN.new_material(name)
    pos = g.geo('Position')
    n = g.noise(pos, scale=8.0, detail=6.0)
    pit = g.smooth(g.noise(pos, scale=30.0, detail=6.0), 0.62, 0.7)
    col = g.mix(pit, g.rgb(lin(200, 200, 200)), g.rgb(lin(92, 60, 38)))
    g.output(g.principled(col, rough=g.madd(n, 0.1, g.mul(pit, 0.6)), metal=g.sub(1.0, g.mul(pit, 0.9))))
    return _register(name, m, 'metal')


# ---------------------------------------------------------------------------

def build_library():
    _LIB.clear()
    # High Noon's node groups (read-only reuse): weathered wood, rusty metal, stone
    DM.wood_group()
    DM.metal_group()
    DM.stone_group()
    wet_group()
    paint_metal_group()
    from . import ground, corn
    ground.material(_LIB)
    corn.material(_LIB)

    # wood (dustcreek's DC_Wood), darkened and glossier for the rain
    def wood(name, **kw):
        m = DM.wood(name, **kw)
        return _register(name, m, 'wood')
    wood("fence_wood", bleach=0.85, light=lin(104, 98, 90), dark=lin(58, 54, 50), dirt=0.5, dirt_height=0.5, nails=0.0)
    wood("pole_wood", bleach=0.2, light=lin(66, 52, 40), dark=lin(34, 27, 22), dirt=0.3, nails=0.0)
    wood("barn_red", paint=lin(118, 30, 22), paint_amount=1.0, wear=0.6, bleach=0.6, dirt=0.7)
    wood("barn_trim", paint=lin(196, 190, 176), paint_amount=1.0, wear=0.55, nails=0.0)
    wood("barn_grey", bleach=0.9, light=lin(112, 104, 94), dark=lin(60, 56, 50), dirt=0.6)
    wood("pallet_wood", bleach=0.5, light=lin(130, 110, 86), dark=lin(80, 64, 50), dirt=0.8, dirt_height=0.4)
    wood("plank_dark", bleach=0.2, light=lin(80, 62, 48), dark=lin(44, 34, 27), dirt=0.3, nails=0.0)
    wood("shingle_wood", bleach=0.8, light=lin(96, 90, 84), dark=lin(52, 48, 44), dirt=0.2, nails=0.0, grain=2.0)
    wood("motel_door", paint=lin(46, 96, 104), paint_amount=1.0, wear=0.45, nails=0.0)
    wood("motel_door2", paint=lin(152, 60, 44), paint_amount=1.0, wear=0.45, nails=0.0)
    wood("scarecrow_pole", bleach=0.7, dirt=0.3, nails=0.0)

    # painted metal
    paint_metal("pump_red", lin(150, 28, 24), wear=0.45, rust=0.35, gloss=0.6)
    paint_metal("pump_cream", lin(206, 196, 170), wear=0.5, rust=0.4, gloss=0.5)
    paint_metal("canopy_white", lin(196, 194, 186), wear=0.55, rust=0.45, grime=0.8, gloss=0.3, scale=0.5)
    paint_metal("canopy_red", lin(140, 32, 28), wear=0.5, rust=0.5, grime=0.7, gloss=0.3, scale=0.5)
    paint_metal("sign_back", lin(40, 44, 50), wear=0.4, rust=0.6, grime=0.8, gloss=0.2, scale=0.6)
    paint_metal("sign_face", lin(214, 206, 186), wear=0.5, rust=0.5, grime=0.7, gloss=0.3, scale=0.6)
    paint_metal("booth_red", lin(132, 26, 24), wear=0.5, rust=0.45, gloss=0.4)
    paint_metal("booth_alu", lin(150, 152, 154), wear=0.2, rust=0.2, gloss=0.5)
    paint_metal("truck_paint", lin(62, 92, 110), wear=0.55, rust=0.6, gloss=0.3)
    paint_metal("car_paint", lin(120, 118, 96), wear=0.5, rust=0.6, gloss=0.35)
    paint_metal("car_paint2", lin(96, 30, 32), wear=0.5, rust=0.55, gloss=0.35)
    paint_metal("bus_yellow", lin(176, 120, 22), wear=0.8, rust=0.85, grime=1.0, gloss=0.1, scale=0.6)
    paint_metal("bus_char", lin(24, 20, 18), wear=0.9, rust=0.9, grime=1.0, gloss=0.05, scale=0.8)
    paint_metal("drum_blue", lin(40, 64, 96), wear=0.6, rust=0.7, gloss=0.2)
    paint_metal("drum_red", lin(120, 34, 26), wear=0.6, rust=0.7, gloss=0.2)
    paint_metal("mailbox", lin(110, 112, 104), wear=0.5, rust=0.6)
    paint_metal("stop_red", lin(150, 22, 22), wear=0.3, rust=0.3, gloss=0.4, scale=2.0)
    paint_metal("windmill_metal", lin(120, 118, 112), wear=0.8, rust=0.9, gloss=0.1, scale=0.3)
    paint_metal("tower_metal", lin(150, 150, 142), wear=0.7, rust=0.7, gloss=0.2, scale=0.2)
    paint_metal("screen_white", lin(196, 196, 190), wear=0.4, rust=0.5, grime=1.0, gloss=0.1, scale=0.2)
    paint_metal("radio_case", lin(120, 76, 44), wear=0.3, rust=0.1, gloss=0.6, scale=3.0)
    m = DM.metal("galvanized", base=lin(120, 122, 122), rust=0.35, rough=0.5, metallic=0.5, scale=0.8, dirt=0.3)
    _register("galvanized", m, 'metal')
    m = DM.metal("rusty", base=lin(70, 64, 58), rust=0.9, rough=0.7, metallic=0.3)
    _register("rusty", m, 'metal')
    m = DM.metal("tin_roof", base=lin(126, 124, 118), rust=0.7, rough=0.5, metallic=0.5, scale=0.5, dirt=0.4)
    _register("tin_roof", m, 'metal')
    m = DM.metal("iron_dark", base=lin(40, 40, 40), rust=0.5, rough=0.6, metallic=0.5)
    _register("iron_dark", m, 'metal')
    rubber()
    chrome()

    # masonry and concrete (surface 'asphalt': hard mineral, chips and dust)
    concrete("concrete", lin(112, 110, 104))
    concrete("curb", lin(126, 124, 118), dirt=0.9)
    concrete("cinder_cream", lin(120, 116, 106), blocks=(0.40, 0.20), paint=lin(206, 196, 168))
    concrete("cinder_mint", lin(120, 116, 106), blocks=(0.40, 0.20), paint=lin(150, 186, 168))
    concrete("cinder_bare", lin(104, 102, 98), blocks=(0.40, 0.20))
    concrete("stucco_white", lin(200, 196, 184), dirt=0.8)
    concrete("silo_concrete", lin(140, 136, 126), dirt=0.9, blocks=(0.76, 0.30))
    concrete("brick_red", lin(110, 50, 38), blocks=(0.21, 0.07))

    burlap("sandbag", lin(96, 80, 58))
    burlap("sandbag_pale", lin(146, 128, 94))
    glass_dark("glass_dark")
    glass_dark("glass_dirty", tint=(0.08, 0.085, 0.08), rough=0.12, dirt=1.0)
    simple("tar_roof", lin(28, 27, 26), rough=0.8, surface='asphalt', noise=0.3, scale=4.0)
    simple("asphalt_shingle", lin(46, 40, 38), rough=0.85, surface='wood', noise=0.35, scale=9.0)
    simple("black_void", lin(4, 4, 4), rough=1.0, noise=0.05, wet=0.0)
    simple("interior_dark", lin(30, 26, 22), rough=0.9, noise=0.2, wet=0.0)
    simple("vinyl_red", lin(110, 20, 22), rough=0.4, surface='cloth', noise=0.15, wet=0.0, porous=0.1)
    simple("formica", lin(170, 176, 160), rough=0.3, noise=0.1, wet=0.0)
    simple("linoleum", lin(80, 76, 66), rough=0.5, noise=0.2, wet=0.0, scale=3.0)
    simple("cloth_denim", lin(46, 58, 80), rough=0.95, surface='cloth', noise=0.3, porous=1.0)
    simple("cloth_plaid", lin(110, 40, 30), rough=0.95, surface='cloth', noise=0.35, porous=1.0)
    simple("cloth_hat", lin(72, 58, 40), rough=0.95, surface='cloth', noise=0.35, porous=1.0)
    simple("straw", lin(150, 122, 70), rough=0.9, surface='cloth', noise=0.45, scale=40.0, porous=0.8, bump=0.5)
    simple("paper", lin(186, 176, 150), rough=0.9, surface='cloth', noise=0.25, porous=1.0)
    simple("cardboard", lin(120, 92, 60), rough=0.9, surface='wood', noise=0.3, porous=1.0)
    simple("bark", lin(52, 42, 34), rough=0.95, surface='wood', noise=0.5, scale=12.0, bump=0.6)
    simple("pine_needles", lin(24, 36, 24), rough=0.8, surface='plant', noise=0.45, scale=14.0, bump=0.4)
    simple("dry_grass", lin(96, 86, 52), rough=0.8, surface='plant', noise=0.4, scale=20.0, porous=0.7)
    simple("green_grass", lin(46, 56, 30), rough=0.7, surface='plant', noise=0.4, scale=20.0, porous=0.7)
    simple("corn_leaf", lin(142, 128, 78), rough=0.6, surface='plant', noise=0.35, scale=6.0, porous=0.5)
    simple("rubber_duck", lin(230, 180, 20), rough=0.35, surface='metal', noise=0.05, wet=0.3, porous=0.0)
    simple("wax", lin(214, 200, 170), rough=0.5, noise=0.1, wet=0.0)
    simple("bakelite", lin(40, 26, 18), rough=0.3, surface='metal', noise=0.1, wet=0.0)
    simple("plastic_white", lin(200, 196, 186), rough=0.4, surface='metal', noise=0.1)
    simple("seat_leather", lin(60, 40, 30), rough=0.6, surface='cloth', noise=0.3)
    simple("ash", lin(40, 38, 36), rough=0.95, surface='metal', noise=0.5, scale=10.0)

    # lamps and their lit parts
    emissive("neon_red", (1.0, 0.09, 0.07), 42.0, base=(0.35, 0.05, 0.04))
    emissive("sodium_lens", (1.0, 0.55, 0.18), 30.0, base=(0.6, 0.45, 0.3))
    emissive("flame", (1.0, 0.55, 0.18), 18.0, base=(0.8, 0.6, 0.3), surface='cloth')
    emissive("fluoro", (0.8, 0.95, 1.0), 9.0, base=(0.7, 0.75, 0.75))
    emissive("pilot_lamp", (1.0, 0.85, 0.6), 25.0, base=(0.5, 0.45, 0.4))
    simple("neon_dead", lin(120, 110, 104), rough=0.1, surface='glass', noise=0.05, spec=0.8)
    return _LIB


def get(name):
    return _LIB[name]
