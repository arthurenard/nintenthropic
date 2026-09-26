"""Dust Creek's Main Street: which building stands where, what it is made of
and what is painted on it.

Blender coordinates: the player stands at the origin, eye 1.7 m, looking
down +Y (the glTF export turns that into -Z). Left is -X. Facades stand at
x = +-10 m behind 2.6 m boardwalks; the church closes the street at y ~ 62.
"""

import math

import bpy
from mathutils import Vector

from .core import Frame, MeshBuilder, rng, collection, tag
from . import buildings as B
from . import carpentry as C
from . import signs as S
from .materials import lin

L, R = 'L', 'R'


# ---------------------------------------------------------------------------
# Sign helpers

def sign_panel(mb, f, s0, z0, s1, z1, mat, y=-0.06, thick=0.035, edge='trim_dark', rand=None, frame=0.0,
               frame_mat=None):
    """A painted board whose front face (facing frame -Y) carries `mat` with
    UV 'local' spanning 0..1 so the lettering mask maps onto it."""
    rr = 0.5 if rand is None else rand
    mb.add_face([f.p(s0, y - thick, z0), f.p(s1, y - thick, z0), f.p(s1, y - thick, z1), f.p(s0, y - thick, z1)],
                mat, rr, grain=[(s0, z0), (s1, z0), (s1, z1), (s0, z1)],
                local=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mb.box(f, (s0, y - thick, z0), (s1, y, z1), edge, rand=rr, grain_axis=0, skip=('-y',))
    if frame > 0:
        fm = frame_mat or edge
        for (a, b, c, d) in ((s0 - frame, s1 + frame, z0 - frame, z0), (s0 - frame, s1 + frame, z1, z1 + frame),
                             (s0 - frame, s0, z0, z1), (s1, s1 + frame, z0, z1)):
            mb.box(f, (a, y - thick - 0.03, c), (b, y, d), fm, grain_axis=0 if (b - a) > (d - c) else 2)


def make_sign(lib, key, w, h, draw, bg, fill, shadow=None, accent=None, wear=0.45, bleach=0.5, px=260,
              **kw):
    # the board paint weathers; the lettering is what the town reads, so
    # signs peel far less than the walls around them
    wear = min(wear, 0.62) * 0.55
    ms = S.MaskScene(key, w, h, px_per_m=px)
    draw(ms, w, h)
    img = ms.render()
    m = S.sign_material(key, img, bg=bg, fill=fill, shadow=shadow, accent=accent, wear=wear, bleach=bleach,
                        **kw)
    lib[m.name] = m
    return m.name


def text_line(txt, face='clarendon', size=0.6, dy=0.0, shadow=None, stretch=1.0, spacing=1.0, ch='R',
              jitter=1.0):
    def draw(ms, w, h):
        ms.text(txt, w / 2, h / 2 - size * 0.36 + dy, size, face=face, shadow=shadow, stretch=stretch,
                spacing=spacing, ch=ch, jitter=jitter)
    return draw


def border(inset=0.07, line=0.035, ch='B'):
    def draw(ms, w, h):
        ms.rect(inset, inset, w - inset, h - inset, ch=ch, line=line)
    return draw


def combo(*fns):
    def draw(ms, w, h):
        for f in fns:
            f(ms, w, h)
    return draw


# ---------------------------------------------------------------------------
# The street

def build_buildings(lib, col):
    """Create every Main Street building. Returns dict key -> Building."""
    out = {}

    # ---- LEFT, near to far ------------------------------------------------
    # General Store: a wide one-storey store with a stepped false front,
    # faded ochre clapboard, big display windows, porch roof over the walk.
    store = B.Building('store', L, 5.5, 11.0, 15.0, 'left_near', eave=4.6, front_h=7.0,
                       front_top=lambda s: 7.7 if abs(s) < 2.6 else 7.0, siding='clap',
                       wall_mat='paint_ochre', side_mat='wood_raw', side_siding='rough', trim_mat='trim_white',
                       porch_h=3.25)
    sn = store.s_near
    store.window(sn(0.18), 0.95, 1.9, 2.0, cols=3, rows=4, gid='store_1', anchor='win_a')
    store.door(sn(0.5), w=1.5, h=2.35, style='double', open_deg=70.0, anchor='door', transom=True,
               mat='paint_green', gid='store_transom')
    store.window(sn(0.82), 0.95, 1.9, 2.0, cols=3, rows=4, gid='store_2', anchor='win_b')
    store.side_window('far', 4.0, 1.3, 0.9, 1.4, gid='store_side')
    out['store'] = store

    # Saloon: two storeys, oxblood clapboard, a gallery balcony on posts,
    # batwing doors, and the piano in the near window.
    saloon = B.Building('saloon', L, 18.0, 13.0, 18.0, 'left_mid', eave=7.7, front_h=9.3,
                        front_top=lambda s: 9.3 + max(0.0, 1.1 * (1 - abs(s) / 3.2)), storeys=2, siding='clap',
                        wall_mat='paint_red', side_mat='wood_grey', side_siding='rough', trim_mat='trim_white',
                        porch_h=3.7, porch_roof=False)
    sn = saloon.s_near
    saloon.window(sn(0.17), 0.95, 1.8, 2.1, cols=2, rows=4, gid='saloon_piano', anchor='win_piano')
    saloon.door(sn(0.5), w=1.7, h=2.6, style='batwing', anchor='door', transom=True, mat='paint_brown',
                gid='saloon_transom')
    saloon.window(sn(0.83), 0.95, 1.8, 2.1, cols=2, rows=4, gid='saloon_1', anchor='win_b')
    saloon.window(sn(0.2), 4.8, 1.0, 1.7, cols=2, rows=4, gid='saloon_up_1', anchor='up_a')
    saloon.door(sn(0.5), w=1.05, h=2.3, style='panel', z=4.1, open_deg=75, anchor='up_door', mat='paint_brown',
                hinge='left')
    saloon.window(sn(0.8), 4.8, 1.0, 1.7, cols=2, rows=4, gid='saloon_up_2', anchor='up_b')
    saloon.side_window('near', 3.5, 4.6, 0.9, 1.6, gid='saloon_side_up')
    out['saloon'] = saloon

    # Barber: small board-and-batten shop, faded blue, striped awning.
    barber = B.Building('barber', L, 32.5, 6.0, 10.0, 'left_far', eave=4.0, front_h=5.7, siding='batten',
                        wall_mat='paint_blue', side_mat='wood_grey', side_siding='batten', trim_mat='trim_white',
                        porch_roof=False)
    sn = barber.s_near
    barber.window(sn(0.7), 0.95, 1.6, 1.8, cols=2, rows=3, gid='barber_1', anchor='win')
    barber.door(sn(0.27), w=1.0, h=2.2, style='panel', open_deg=60, anchor='door', mat='trim_white', hinge='right')
    out['barber'] = barber

    # ---- RIGHT, near to far ----------------------------------------------
    # Bank: the only stone front in town, with a clock in the parapet over
    # the door. Wood sides (they built the money end first).
    bank = B.Building('bank', R, 5.5, 10.0, 15.0, 'right_near', eave=5.3, front_h=7.4,
                      front_top=lambda s: 7.4 + (0.9 if abs(s) < 1.6 else 0.0), siding='stone',
                      wall_mat='stone_sand', side_mat='paint_brown', side_siding='clap', trim_mat='trim_dark',
                      porch_roof=False, cornice=False)
    sn = bank.s_near
    bank.window(sn(0.2), 1.0, 1.3, 2.6, cols=2, rows=4, gid='bank_1', anchor='win_a', bars=True,
                sash_mat='trim_dark')
    bank.door(sn(0.5), w=1.6, h=2.5, style='double', anchor='door', transom=True, mat='trim_dark', gid='bank_transom',
              open_deg=0.0)
    bank.window(sn(0.8), 1.0, 1.3, 2.6, cols=2, rows=4, gid='bank_2', anchor='win_b', bars=True,
                sash_mat='trim_dark')
    out['bank'] = bank

    # Sheriff: rough grey boards, barred window, porch, the wanted board.
    sheriff = B.Building('sheriff', R, 17.0, 7.5, 12.0, 'right_near', eave=4.3, front_h=6.2, siding='rough',
                         wall_mat='wood_grey', side_mat='wood_grey', side_siding='rough', trim_mat='trim_dark',
                         porch_h=3.2)
    sn = sheriff.s_near
    sheriff.door(sn(0.3), w=1.0, h=2.2, style='panel', open_deg=70, anchor='door', mat='paint_brown',
                 hinge='left')
    sheriff.window(sn(0.75), 1.0, 1.1, 1.5, cols=2, rows=3, gid='sheriff_1', anchor='win', bars=True,
                   sash_mat='trim_dark')
    out['sheriff'] = sheriff

    # Hotel: two storeys, cream clapboard, green trim, balcony on the porch
    # roof in front of the three upper windows.
    hotel = B.Building('hotel', R, 26.0, 12.5, 16.0, 'right_far', eave=7.8, front_h=9.9,
                       front_top=lambda s: 9.9, storeys=2, siding='clap', wall_mat='paint_cream',
                       side_mat='wood_raw', side_siding='rough', trim_mat='trim_green', porch_h=3.55)
    sn = hotel.s_near
    hotel.window(sn(0.2), 0.95, 1.4, 2.0, cols=2, rows=4, gid='hotel_1', anchor='win_a')
    hotel.door(sn(0.5), w=1.2, h=2.4, style='panel', anchor='door', transom=True, mat='trim_green', open_deg=65,
               gid='hotel_transom')
    hotel.window(sn(0.8), 0.95, 1.4, 2.0, cols=2, rows=4, gid='hotel_2', anchor='win_b')
    for i, fr in enumerate((0.2, 0.5, 0.8)):
        hotel.window(sn(fr), 4.8, 1.05, 1.75, cols=2, rows=4, gid=f'hotel_up_{i + 1}', anchor=f'up_{i + 1}',
                     shutters='trim_green')
    hotel.side_window('near', 3.0, 4.6, 0.9, 1.6, gid='hotel_side_up')
    hotel.side_window('near', 7.0, 4.6, 0.9, 1.6, gid='hotel_side_up2')
    out['hotel'] = hotel

    # Undertaker: narrow, black-painted battens, coffins leaning outside.
    under = B.Building('undertaker', R, 40.0, 7.0, 12.0, 'right_far', eave=4.1, front_h=6.0,
                       front_top=lambda s: 6.0 + (0.5 if abs(s) < 1.4 else 0.0), siding='batten',
                       wall_mat='paint_black', side_mat='wood_grey', side_siding='batten', trim_mat='trim_white',
                       porch_roof=False)
    sn = under.s_near
    under.door(sn(0.28), w=1.1, h=2.3, style='panel', open_deg=70, anchor='door', mat='paint_black', hinge='right')
    under.window(sn(0.72), 0.95, 1.4, 1.9, cols=2, rows=3, gid='undertaker_1', anchor='win')
    out['undertaker'] = under

    for b in out.values():
        b.build()
    return out


def decorate(blds, lib, col):
    from .decor import decorate as _decorate
    _decorate(blds, lib, col)
