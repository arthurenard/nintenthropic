"""Decoration: the signs, balconies, awnings, the wanted board with THE HAND,
the bank clock and the saloon piano. This is what turns eight boxes of
boards into a street with names."""

import math

from mathutils import Vector

from .core import Frame, MeshBuilder, tag
from . import buildings as B
from . import carpentry as C
from . import signs as S
from . import props as PR
from .materials import lin
from .town import make_sign, sign_panel, combo, text_line, border


def blade_sign(mb, lib, key, x0, x1, y, z0, z1, text, bg, fill, face='clarendon', size=None, shadow=None,
               chain_to=None):
    """A hanging sign square to the street: its face looks down the street
    at the player. Hung on two chains from the porch roof."""
    w, h = abs(x1 - x0), z1 - z0
    size = size or h * 0.55
    sm = make_sign(lib, key, w, h, combo(text_line(text, face=face, size=size,
                                                   shadow=(0.012, -0.012) if shadow else None),
                                         border(0.035, 0.018)), bg=bg, fill=fill, shadow=shadow, accent=fill, wear=0.4)
    f = Frame((min(x0, x1), y, 0.0))
    sign_panel(mb, f, 0.0, z0, w, z1, sm, y=0.02, thick=0.03, edge='trim_dark')
    if chain_to is not None:
        for xx in (0.12, w - 0.12):
            mb.box(f, (xx - 0.006, -0.006, z1), (xx + 0.006, 0.006, chain_to), 'iron_black', grain_axis=2)
    return sm


CREAM, DARK, RED, GOLD = lin(222, 204, 160), lin(34, 30, 26), lin(128, 38, 28), lin(200, 160, 84)


def store(b, lib, col):
    sm = make_sign(lib, 'store', 8.4, 1.25, combo(text_line("GENERAL STORE", size=0.78, shadow=(0.03, -0.03),
                                                             stretch=0.95), border(0.07, 0.035)),
                   bg=lin(52, 66, 56), fill=CREAM, shadow=RED, accent=lin(190, 150, 80), wear=0.55)
    sign_panel(b.wood, b.F, -4.2, 5.2, 4.2, 6.45, sm, y=-0.1, frame=0.06, frame_mat='trim_white')
    sm2 = make_sign(lib, 'store_goods', 3.6, 0.42, text_line("DRY GOODS  ·  HARDWARE  ·  FEED", face='rockwell',
                                                                size=0.24), bg=CREAM, fill=DARK, wear=0.5)
    sign_panel(b.wood, b.F, -1.8, 4.0, 1.8, 4.42, sm2, y=-0.08)
    blade_sign(b.wood, lib, 'store_blade', -9.7, -8.2, 5.9, 2.35, 2.95, "DRY GOODS", bg=lin(150, 40, 30),
               fill=CREAM, size=0.3, chain_to=3.25)
    # shelves of goods behind the display windows
    it = b.interior
    for s0 in (-4.6, 1.6):
        sf = b.F.sub((s0, 4.5, B.DECK_Z))
        for k in range(4):
            z = 0.4 + k * 0.5
            it.box(sf, (0, 0, z), (3.0, 0.4, z + 0.03), 'wood_dark', grain_axis=0)
            x = 0.05
            while x < 2.9:
                w = b.r.uniform(0.08, 0.22)
                hgt = b.r.uniform(0.12, 0.4)
                mat = b.r.choice(('paint_red', 'paint_cream', 'paint_blue', 'paint_ochre', 'wood_new', 'bottle_green'))
                it.box(sf, (x, 0.05, z + 0.03), (x + w, 0.35, z + 0.03 + hgt), mat, grain_axis=2)
                x += w + b.r.uniform(0.0, 0.05)
    it.box(b.F.sub((0, 2.2, B.DECK_Z)), (-2.5, 0, 0), (2.5, 0.6, 0.95), 'wood_dark', grain_axis=0)
    hanging_lamp(b, b.F.p(0.0, 2.0, B.DECK_Z + 2.9), col, energy=60.0)


def saloon(b, lib, col):
    F, Wd, r = b.F, b.W, b.r
    P = B.WALK_DEPTH
    zf = 4.05
    wd = b.wood
    # gallery posts from the walk up to the gallery roof, with knee braces
    n = 4
    for i in range(n + 1):
        s = -Wd / 2 + 0.12 + (Wd - 0.24) * i / n
        wd.box(F, (s - 0.075, -P + 0.05, B.DECK_Z), (s + 0.075, -P + 0.2, 7.05), 'wood_post', grain_axis=2)
        for sg in (-1, 1):
            if (i == 0 and sg < 0) or (i == n and sg > 0):
                continue
            wd.board(F, (s + sg * 0.06, -P + 0.12, zf - 0.75), (s + sg * 0.55, -P + 0.12, zf - 0.28), 0.09, 0.06,
                     'wood_post', up=(0, 1, 0))
    # beam, joists, ceiling boards and the deck
    wd.box(F, (-Wd / 2, -P + 0.02, zf - 0.32), (Wd / 2, -P + 0.24, zf - 0.08), 'wood_post', grain_axis=0)
    nj = int(Wd / 0.5)
    for k in range(nj + 1):
        s = -Wd / 2 + 0.1 + (Wd - 0.2) * k / nj
        wd.box(F, (s - 0.035, -P + 0.05, zf - 0.28), (s + 0.035, 0.0, zf - 0.08), 'wood_dark', grain_axis=1)
    wd.quad(F, [(-Wd / 2, -P, zf - 0.081), (-Wd / 2, 0, zf - 0.081), (Wd / 2, 0, zf - 0.081), (Wd / 2, -P, zf - 0.081)],
            'wood_dark')
    s = -Wd / 2
    while s < Wd / 2:
        pw = r.uniform(0.13, 0.17)
        wd.box(F, (s + 0.004, -P - 0.05, zf - 0.08), (min(s + pw, Wd / 2) - 0.004, 0.0, zf - 0.04), 'wood_floor',
               grain_axis=1)
        s += pw
    # the fascia board under the balcony carries the saloon's boast
    sm = make_sign(lib, 'saloon_fascia', Wd - 0.4, 0.34,
                   text_line("BILLIARDS   ·   WHISKEY   ·   CIGARS   ·   DANCING", face='clarendon', size=0.2,
                             spacing=1.15), bg=CREAM, fill=RED, wear=0.45)
    sign_panel(wd, F, -Wd / 2 + 0.2, zf - 0.42, Wd / 2 - 0.2, zf - 0.08, sm, y=-P - 0.04, thick=0.02)
    # railing on the gallery edge and its ends
    C.railing(wd, F.sub((0, -P + 0.12, 0)), -Wd / 2 + 0.1, Wd / 2 - 0.1, 0.0, zf - 0.04, 1.0, 'trim_white', r,
              baluster=0.09, posts_every=Wd / 4, solid=True)
    for sg in (-1, 1):
        ef = F.sub((sg * (Wd / 2 - 0.08), -P / 2, 0), rot_z=math.pi / 2)
        C.railing(wd, ef, -P / 2 + 0.1, P / 2 - 0.05, 0.0, zf - 0.04, 1.0, 'trim_white', r, baluster=0.08,
                  posts_every=3, solid=True)
    # gallery roof
    C.shed_roof(b.metal, F, -Wd / 2 - 0.05, Wd / 2 + 0.05, -0.02, -P - 0.3, 7.4, 7.08, 'tin_roof', r)
    wd.box(F, (-Wd / 2 - 0.05, -P - 0.34, 6.88), (Wd / 2 + 0.05, -P - 0.3, 7.12), 'trim_white', grain_axis=0)
    wd.box(F, (-Wd / 2, -P + 0.02, 6.86), (Wd / 2, -P + 0.24, 7.06), 'wood_post', grain_axis=0)
    nr = int(Wd / 0.6)
    for k in range(nr + 1):
        s = -Wd / 2 + 0.05 + (Wd - 0.1) * k / nr
        wd.board(F, (s, -0.05, 7.35), (s, -P - 0.25, 7.03), 0.12, 0.05, 'wood_dark', up=(0, 0, 1))
    b.anchors['balcony'] = dict(kind='roof', floor_z=zf, edge_y=-P + 0.12, frame=F)
    # big SALOON letters on the false front, and a blade sign under the gallery
    sm = make_sign(lib, 'saloon', 7.2, 1.35, combo(text_line("SALOON", size=1.05, shadow=(0.04, -0.035), stretch=1.1,
                                                               spacing=1.2), border(0.08, 0.04)),
                   bg=lin(38, 30, 26), fill=lin(214, 178, 96), shadow=lin(96, 26, 20), accent=CREAM, wear=0.5)
    sign_panel(wd, F, -3.6, 7.85, 3.6, 9.2, sm, y=-0.1, frame=0.07, frame_mat='trim_white')
    blade_sign(wd, lib, 'saloon_blade', -9.75, -8.05, 18.35, 2.55, 3.35, "SALOON", bg=lin(36, 30, 26),
               fill=lin(214, 178, 96), size=0.42, shadow=lin(96, 26, 20), chain_to=3.72)
    # the piano, placed on the player's line of sight through the near window
    a = b.anchors['win_piano']
    eye = Vector((0.0, 0.0, 1.7))
    c = a['center']
    d = (c - eye).normalized()
    t = (abs(c.x) + 1.35) / abs(d.x)
    ppos = eye + d * t
    ang = math.atan2(-d.x, d.y)   # keyboard (local -Y) turned back toward the street
    pf = Frame((ppos.x, ppos.y, B.DECK_Z), ang + math.radians(15))
    piano = PR.piano(col, lib, pf)
    hanging_lamp(b, pf.p(0.0, -0.3, 2.3), col, energy=260.0)
    hanging_lamp(b, F.p(Wd / 2 - 1.8, 3.5, B.DECK_Z + 2.6), col, energy=70.0)
    b.extra_objects.append(piano)
    # the room: bar and back bar with bottles, tables and chairs
    it = b.interior
    bf = F.sub((Wd / 2 - 1.6, 1.0, B.DECK_Z))
    it.box(bf, (-0.4, 0.0, 0.0), (0.2, 5.5, 1.08), 'piano_wood', grain_axis=1)
    it.box(bf, (-0.5, 0.0, 1.08), (0.25, 5.5, 1.13), 'piano_wood', grain_axis=1)
    it.box(bf, (1.2, 0.2, 0.0), (1.5, 5.4, 2.4), 'piano_wood', grain_axis=1)
    for k in range(30):
        yy = 0.4 + k * 0.17
        for zz in (1.15, 1.75):
            it.cylinder(bf, (1.25, yy, zz), 0.035, 0.28, 'bottle_green', segments=6)
    for (s, y) in ((-1.0, 3.2), (0.8, 5.0), (-2.8, 5.6)):
        tf = F.sub((s, y, B.DECK_Z))
        it.cylinder(tf, (0, 0, 0.0), 0.05, 0.72, 'wood_dark', segments=6)
        it.cylinder(tf, (0, 0, 0.72), 0.45, 0.04, 'wood_dark', segments=14)
        PR.chair(it, tf.sub((0.6, 0.0, 0.0), rot_z=1.6), r)
        PR.chair(it, tf.sub((-0.6, 0.1, 0.0), rot_z=-1.4), r)


def barber(b, lib, col):
    sm = make_sign(lib, 'barber', 4.6, 0.9, combo(text_line("BARBER", size=0.62, shadow=(0.02, -0.02), spacing=1.25),
                                                   border(0.06, 0.03)), bg=CREAM, fill=lin(40, 52, 90),
                   shadow=lin(150, 40, 30), accent=lin(150, 40, 30), wear=0.5)
    sign_panel(b.wood, b.F, -2.3, 4.25, 2.3, 5.15, sm, y=-0.08)
    sm = make_sign(lib, 'barber_small', 2.2, 0.36, text_line("SHAVE & HAIRCUT  25¢", face='rockwell', size=0.19),
                   bg=lin(40, 52, 90), fill=CREAM, wear=0.4)
    o = [op for op in b.front_openings if op.kind == 'window'][0]
    sign_panel(b.wood, b.F, o.s - 1.1, 3.35, o.s + 1.1, 3.71, sm, y=-0.07)
    # striped canvas awning over the window: strips running down the slope
    aw0, aw1 = o.s0 - 0.35, o.s1 + 0.35
    ns = 10
    for k in range(ns):
        sa = aw0 + (aw1 - aw0) * k / ns
        sb = aw0 + (aw1 - aw0) * (k + 1) / ns
        b.cloth.board(b.F, ((sa + sb) / 2, -0.02, 3.05), ((sa + sb) / 2, -1.05, 2.6), (sb - sa) + 0.002, 0.01,
                      'canvas_stripe', up=(0, 0, 1))
        b.cloth.box(b.F, (sa, -1.07, 2.38), (sb, -1.05, 2.62), 'canvas_stripe', grain_axis=2)
    for s in (aw0, aw1):
        b.metal.board(b.F, (s, -0.02, 2.45), (s, -1.05, 2.6), 0.02, 0.02, 'iron_black', up=(0, 0, 1))
    sp = b.s_near(0.96)
    PR.barber_pole(b.wood, b.metal, b.F.sub((sp, -0.28, 1.15)), b.r, h=1.5)
    for z in (1.3, 1.95):
        b.metal.board(b.F, (sp, -0.28, z), (sp, 0.0, z), 0.03, 0.03, 'iron_black', up=(0, 0, 1))
    # barber chair inside the door
    it = b.interior
    cf = b.F.sub((b.s_near(0.55), 2.2, B.DECK_Z))
    PR.chair(it, cf, b.r, mat='leather')
    hanging_lamp(b, b.F.p(b.s_near(0.5), 1.8, B.DECK_Z + 2.6), col, energy=45.0)


def bank(b, lib, col):
    F = b.F
    sm = make_sign(lib, 'bank', 6.0, 0.62, text_line("DUST  CREEK  BANK", face='copperplate', size=0.44, spacing=1.1),
                   bg=lin(30, 34, 32), fill=GOLD, wear=0.25, bleach=0.2)
    sign_panel(b.wood, F, -3.0, 4.3, 3.0, 4.92, sm, y=-0.33, frame=0.05, frame_mat='trim_dark')
    b.stone.box(F, (-b.W / 2 - 0.1, -0.52, 5.35), (b.W / 2 + 0.1, 0.02, 5.6), 'stone_sand', rand=0.6, grain_axis=0,
                uv_offset=(0.1, 0.3))
    b.stone.box(F, (-b.W / 2 - 0.15, -0.58, 7.2), (b.W / 2 + 0.15, 0.02, 7.45), 'stone_sand', rand=0.3, grain_axis=0,
                uv_offset=(0.4, 0.2))
    b.stone.box(F, (-1.75, -0.5, 8.05), (1.75, 0.02, 8.35), 'stone_sand', rand=0.8, grain_axis=0, uv_offset=(0.7, 0.1))
    img, _ = S.clock_face()
    cm = S.paper_material('clock', img, paper=lin(226, 218, 196), ink=lin(20, 18, 16), red=lin(20, 18, 16), age=0.35)
    cm['surface'] = 'metal'
    lib[cm.name] = cm
    cz = 6.5
    cf = F.sub((0.0, -0.36, cz)).sub(rot_x=math.pi / 2)
    b.metal.cylinder(cf, (0, 0, 0.0), 0.5, 0.14, 'brass', segments=32, caps=(False, True))
    fr = 0.42
    pts = [(math.cos(2 * math.pi * i / 32) * fr, math.sin(2 * math.pi * i / 32) * fr) for i in range(32)]
    b.metal.add_face([F.p(x, -0.505, cz + z) for (x, z) in pts], cm.name, 0.5, grain=[(x, z) for (x, z) in pts],
                     local=[((x / fr + 1) / 2, (z / fr + 1) / 2) for (x, z) in pts])
    b.anchors['clock'] = dict(center=F.p(0, -0.5, cz))
    # teller's counter behind the windows
    it = b.interior
    it.box(F.sub((0, 3.0, B.DECK_Z)), (-4.0, 0, 0), (4.0, 0.6, 1.1), 'piano_wood', grain_axis=0)
    for k in range(12):
        x = -3.8 + k * 0.7
        it.box(F.sub((x, 3.25, B.DECK_Z + 1.1)), (-0.01, -0.01, 0), (0.01, 0.01, 0.9), 'brass', grain_axis=2)


def sheriff(b, lib, col):
    F = b.F
    P = B.WALK_DEPTH
    sm = make_sign(lib, 'sheriff', 5.4, 0.95, combo(text_line("SHERIFF", size=0.66, shadow=(0.025, -0.025),
                                                              spacing=1.2), border(0.06, 0.03)),
                   bg=lin(120, 34, 26), fill=CREAM, shadow=DARK, accent=CREAM, wear=0.55)
    sign_panel(b.wood, F, -2.7, 4.55, 2.7, 5.5, sm, y=-0.08, frame=0.05, frame_mat='trim_dark')
    blade_sign(b.wood, lib, 'jail_blade', 8.2, 9.7, 17.35, 2.3, 2.85, "JAIL", bg=DARK, fill=CREAM, size=0.36,
               chain_to=3.2)
    # The wanted board: nailed across the sheriff's first porch post, facing
    # straight down the street, so the player reads it (a board flat on the
    # facade is seen edge-on from mid-street, and the door was moved to the
    # far side so the board screens nothing a bandit uses).
    P_ = B.WALK_DEPTH
    post = F.p(b.W / 2 - 0.12, -P_ + 0.12, B.DECK_Z)
    bw_, bh_ = 1.25, 1.3
    front = Frame((post.x + 0.5, post.y - 0.09, B.DECK_Z + 0.95))
    b.wood.box(front, (-bw_ / 2, 0.0, 0.0), (bw_ / 2, 0.03, bh_), 'wood_dark', grain_axis=0)
    for (a1, b1, c1, d1) in ((-bw_ / 2 - 0.04, bw_ / 2 + 0.04, bh_ - 0.02, bh_ + 0.05),
                             (-bw_ / 2 - 0.04, bw_ / 2 + 0.04, -0.05, 0.02),
                             (-bw_ / 2 - 0.04, -bw_ / 2 + 0.03, 0.0, bh_), (bw_ / 2 - 0.03, bw_ / 2 + 0.04, 0.0, bh_)):
        b.wood.box(front, (a1, -0.02, c1), (b1, 0.0, d1), 'trim_dark', grain_axis=0 if b1 - a1 > d1 - c1 else 2)
    # a leg at the far end, down to the boardwalk
    b.wood.box(front, (bw_ / 2 - 0.12, 0.03, -0.95), (bw_ / 2 - 0.04, 0.1, bh_), 'wood_post', grain_axis=2)
    sm = make_sign(lib, 'wanted_header', 1.1, 0.17, text_line("WANTED", face='clarendon', size=0.13, spacing=1.25),
                   bg=lin(34, 28, 24), fill=CREAM, wear=0.35)
    sign_panel(b.wood, front, -0.55, bh_ - 0.21, 0.55, bh_ - 0.04, sm, y=-0.021, thick=0.01)
    img, (pw, ph) = S.generic_wanted(0, "BLACK JACK CARVER", "$2,000")
    pm = S.paper_material("poster0", img, age=0.75)
    lib[pm.name] = pm
    pf = front.sub((0.3, -0.024, 0.2)).sub(rot_y=0.04)
    sc = 0.78
    b.wood.add_face([pf.p(-pw * sc / 2, 0, 0), pf.p(pw * sc / 2, 0, 0), pf.p(pw * sc / 2, 0, ph * sc),
                     pf.p(-pw * sc / 2, 0, ph * sc)], pm.name, 0.2,
                    grain=[(0, 0), (pw, 0), (pw, ph), (0, ph)], local=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # two more on the facade by the door, for texture
    for i, (nm, amt, fr_, pz, rot) in enumerate((("ELI 'DUSTY' CARVER", "$500", 0.5, 1.25, -0.05),
                                                  ("THE WICHITA KID", "$750", 0.58, 1.2, 0.04)), 1):
        img, (pw, ph) = S.generic_wanted(i, nm, amt)
        pm = S.paper_material(f"poster{i}", img, age=0.7 + 0.1 * i)
        lib[pm.name] = pm
        pf = F.sub((b.s_near(fr_), -0.035, B.DECK_Z + pz)).sub(rot_y=rot)
        sc = 0.8
        b.wood.add_face([pf.p(-pw * sc / 2, 0, 0), pf.p(pw * sc / 2, 0, 0), pf.p(pw * sc / 2, 0, ph * sc),
                         pf.p(-pw * sc / 2, 0, ph * sc)], pm.name, 0.2,
                        grain=[(0, 0), (pw, 0), (pw, ph), (0, ph)], local=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # THE HAND: the secret poster, its own object, pivot at its top nail
    img, (pw, ph) = S.wanted_the_hand()
    pm = S.paper_material("the_hand", img, age=0.5)
    lib[pm.name] = pm
    mb = MeshBuilder("secret.poster")
    lf = Frame()
    pts = [(-pw / 2, 0, -ph), (pw / 2, 0, -ph), (pw / 2, -0.006, -ph / 2), (-pw / 2, -0.006, -ph / 2)]
    mb.add_face([lf.p(*p) for p in pts], pm.name, 0.2, grain=[(0, 0), (pw, 0), (pw, ph / 2), (0, ph / 2)],
                local=[(0, 0), (1, 0), (1, 0.5), (0, 0.5)])
    pts = [(-pw / 2, -0.006, -ph / 2), (pw / 2, -0.006, -ph / 2), (pw / 2, 0, 0), (-pw / 2, 0, 0)]
    mb.add_face([lf.p(*p) for p in pts], pm.name, 0.2, grain=[(0, ph / 2), (pw, ph / 2), (pw, ph), (0, ph)],
                local=[(0, 0.5), (1, 0.5), (1, 1), (0, 1)])
    mb.cylinder(lf.sub((0, -0.006, -0.03)).sub(rot_x=math.pi / 2), (0, 0, 0), 0.009, 0.012, 'iron', segments=6)
    pob = mb.build(col, lib, surface='cloth', group='right_near')
    pob.matrix_world = front.sub((-0.26, -0.024, bh_ - 0.25)).sub(rot_y=-0.03).m
    tag(pob, pivot='top_nail', text="WANTED - THE HAND - $5,000")
    b.extra_objects.append(pob)
    b.anchors['wanted_board'] = dict(center=front.p(0, -0.05, bh_ / 2))
    # a desk and a cell's bars inside
    it = b.interior
    it.box(F.sub((b.s_near(0.3), 2.5, B.DECK_Z)), (-0.7, 0, 0), (0.7, 0.8, 0.78), 'wood_dark', grain_axis=0)
    for k in range(14):
        it.cylinder(F.sub((b.s_near(0.95) * 0.0 + (-2.8 + k * 0.2) * -b.near, 5.2, B.DECK_Z)), (0, 0, 0), 0.015,
                    b.eave - B.DECK_Z - 0.1, 'iron_black', segments=6)


def hotel(b, lib, col):
    F, Wd, r = b.F, b.W, b.r
    P = B.WALK_DEPTH
    h = b.porch_h
    wd = b.wood
    # A narrow balcony at the upper floor, on brackets above the porch roof,
    # in front of the three windows. Kept shallow (1.1 m) with a low rail:
    # from the street a deep balcony's rail, seen edge-on, would screen the
    # windows behind it. Railing only on the front and the far end.
    zf = 4.05
    bd = 1.1
    s = -Wd / 2 + 0.3
    while s < Wd / 2 - 0.3:
        pw = r.uniform(0.13, 0.17)
        wd.box(F, (s + 0.004, -bd, zf - 0.04), (min(s + pw, Wd / 2 - 0.3) - 0.004, -0.02, zf), 'wood_floor',
               grain_axis=1)
        s += pw
    wd.box(F, (-Wd / 2 + 0.3, -bd - 0.03, zf - 0.22), (Wd / 2 - 0.3, -bd + 0.02, zf - 0.04), 'trim_green', grain_axis=0)
    for k in range(7):
        sb = -Wd / 2 + 0.5 + (Wd - 1.0) * k / 6
        wd.board(F, (sb, -0.02, zf - 0.55), (sb, -bd + 0.1, zf - 0.06), 0.1, 0.07, 'trim_green', up=(1, 0, 0))
    C.railing(wd, F.sub((0, -bd + 0.05, 0)), -Wd / 2 + 0.35, Wd / 2 - 0.35, 0.0, zf, 0.9, 'trim_green', r,
              baluster=0.08, posts_every=Wd / 3)
    ef = F.sub((-b.near * (Wd / 2 - 0.35), -bd / 2, 0), rot_z=math.pi / 2)
    C.railing(wd, ef, -bd / 2 + 0.08, bd / 2 - 0.05, 0.0, zf, 0.9, 'trim_green', r, baluster=0.08, posts_every=3)
    b.anchors['balcony'] = dict(kind='roof', floor_z=zf, edge_y=-bd + 0.05, frame=F)
    sm = make_sign(lib, 'hotel', 7.0, 1.3, combo(text_line("HOTEL", size=1.0, shadow=(0.035, -0.03), spacing=1.35),
                                                  border(0.08, 0.04)), bg=lin(58, 80, 64), fill=CREAM, shadow=DARK,
                   accent=GOLD, wear=0.45)
    sign_panel(wd, F, -3.5, 8.0, 3.5, 9.3, sm, y=-0.1, frame=0.06, frame_mat='trim_green')
    sm = make_sign(lib, 'hotel_rooms', 5.0, 0.38, text_line("ROOMS  ·  BATHS  ·  MEALS", face='rockwell', size=0.22,
                                                              spacing=1.1), bg=CREAM, fill=lin(58, 80, 64), wear=0.45)
    sign_panel(wd, F, -2.5, 7.15, 2.5, 7.53, sm, y=-0.07)
    blade_sign(wd, lib, 'hotel_blade', 8.15, 9.75, 26.35, 2.2, 2.95, "HOTEL", bg=lin(58, 80, 64), fill=CREAM,
               size=0.4, chain_to=3.3)
    # a faded painted advert on the near side wall, above the sheriff's roof
    sf, conv = b.side_frames['near']
    sm = make_sign(lib, 'hotel_ghost', 6.0, 1.3, combo(
        lambda ms, w, hh: ms.text("HOTEL", w / 2, hh * 0.46, 0.6, face='clarendon', spacing=1.3),
        lambda ms, w, hh: ms.text("ROOMS 50¢", w / 2, hh * 0.1, 0.3, face='rockwell', spacing=1.2)),
        bg=lin(120, 100, 84), fill=lin(222, 212, 190), wear=0.8, bleach=0.8, fade=0.7)
    d0, d1 = conv(0.8), conv(6.8)
    sign_panel(wd, sf, min(d0, d1), 6.2, max(d0, d1), 7.5, sm, y=-0.035, thick=0.005, edge='wood_raw')
    # stairs and a lobby desk inside
    it = b.interior
    it.box(F.sub((b.s_near(0.5), 3.0, B.DECK_Z)), (-1.2, 0, 0), (1.2, 0.6, 1.05), 'piano_wood', grain_axis=0)
    hanging_lamp(b, F.p(b.s_near(0.5), 2.0, B.DECK_Z + 2.6), col, energy=60.0)


def undertaker(b, lib, col):
    sm = make_sign(lib, 'undertaker', 5.6, 0.8, combo(text_line("UNDERTAKER", size=0.52, shadow=(0.018, -0.018),
                                                                spacing=1.12), border(0.05, 0.025)),
                   bg=lin(22, 20, 18), fill=lin(214, 208, 190), shadow=lin(90, 20, 16), accent=lin(170, 150, 110),
                   wear=0.45)
    sign_panel(b.wood, b.F, -2.8, 4.45, 2.8, 5.25, sm, y=-0.08)
    sm = make_sign(lib, 'coffins', 2.0, 0.34, text_line("COFFINS · EMBALMING", face='rockwell', size=0.16),
                   bg=lin(214, 208, 190), fill=lin(22, 20, 18), wear=0.4)
    o = [op for op in b.front_openings if op.kind == 'window'][0]
    sign_panel(b.wood, b.F, o.s - 1.0, 3.35, o.s + 1.0, 3.69, sm, y=-0.07)


def lamp_material(lib):
    from .nodes import new_material
    if "lamp_glow" in lib:
        return
    m, g = new_material("lamp_glow")
    em = g.node('ShaderNodeEmission', inputs={'Color': (1.0, 0.62, 0.3), 'Strength': 9.0}, out=0)
    g.output(em)
    m["surface"] = 'glass'
    lib["lamp_glow"] = m


def hanging_lamp(b, p, col, energy=70.0):
    """An oil lamp hung from the ceiling, already lit at sundown: a brass
    font, a glowing chimney, a tin shade — and a warm point light that the
    bake carries into the room, so windows glow a little from the street."""
    import bpy
    lamp_material(b._lib)
    f = Frame((p.x, p.y, p.z))
    b.metal.cylinder(f, (0, 0, 0.0), 0.07, 0.08, 'brass', segments=10)
    b.metal.cylinder(f, (0, 0, 0.08), 0.035, 0.16, 'lamp_glow', segments=10)
    b.metal.cylinder(f, (0, 0, 0.22), 0.2, 0.08, 'iron_black', segments=12, radius_top=0.05)
    top = b.eave if b.storeys == 1 else B.DECK_Z + 3.55
    b.metal.cylinder(f, (0, 0, 0.3), 0.006, max(0.05, top - p.z - 0.3), 'iron_black', segments=4)
    ld = bpy.data.lights.new(f"lamp_{b.key}", 'POINT')
    ld.energy = energy
    ld.color = (1.0, 0.62, 0.32)
    ld.shadow_soft_size = 0.06
    lo = bpy.data.objects.new(f"lamp_{b.key}", ld)
    lo.location = (p.x, p.y, p.z + 0.12)
    col.objects.link(lo)


def decorate(blds, lib, col):
    for b in blds.values():
        b._lib = lib
    lamp_material(lib)
    store(blds['store'], lib, col)
    saloon(blds['saloon'], lib, col)
    barber(blds['barber'], lib, col)
    bank(blds['bank'], lib, col)
    sheriff(blds['sheriff'], lib, col)
    hotel(blds['hotel'], lib, col)
    undertaker(blds['undertaker'], lib, col)
