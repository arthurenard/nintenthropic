"""False-front buildings: the backbone of a frontier main street.

A building is authored in its own frame (see carpentry.py): the facade is the
plane y=0 facing -Y (the street), s runs along the frontage, the body extends
to +y. `Building` collects its boards into a handful of MeshBuilders by
surface type, cuts openings, adds casing, sashes, doors, porch, balcony,
false front with cornice, gable roof behind, a simple interior behind every
window (so glass never shows the sky through the house), and records
*anchors* — world-space doorways, windows, roof edges — that the contract
stage turns into bandit cover points.
"""

import math

from mathutils import Vector

from .core import Frame, MeshBuilder, rng, tag
from . import carpentry as C
from .carpentry import Opening

STREET_HALF = 10.0     # facade planes at x = +-10
WALK_DEPTH = 2.6       # boardwalk depth in front of the facades
DECK_Z = 0.40          # boardwalk / floor level


class Building:
    def __init__(self, key, side, y0, width, depth, group, eave=4.4, front_h=6.8,
                 front_top=None, storeys=1, siding='clap', wall_mat='paint_ochre', side_mat=None,
                 side_siding=None, trim_mat='trim_white', roof='tin', roof_pitch=18.0, porch=True,
                 porch_h=3.3, porch_roof=True, setback=0.0, cornice=True, floor_z=DECK_Z,
                 walk=True, lean=0.0):
        self.key, self.side, self.W, self.D = key, side, width, depth
        self.group = group
        self.eave, self.front_h = eave, front_h
        self.front_top = front_top or C.top_fn_flat(front_h)
        self.storeys = storeys
        self.siding, self.side_siding = siding, side_siding or siding
        self.wall_mat, self.side_mat = wall_mat, side_mat or wall_mat
        self.trim = trim_mat
        self.roof, self.pitch = roof, roof_pitch
        self.porch, self.porch_h, self.porch_roof = porch, porch_h, porch_roof
        self.cornice = cornice
        self.floor_z = floor_z
        self.walk = walk
        yc = y0 + width / 2
        x = -(STREET_HALF + setback) if side == 'L' else (STREET_HALF + setback)
        rot = math.radians(90 if side == 'L' else -90) + lean
        self.F = Frame((x, yc, 0), rot)
        # 'near' end of the frontage (toward the player) in local s
        self.near = -1 if side == 'L' else 1
        self.r = rng(f"bld:{key}")
        n = f"bld.{key}"
        self.wood = MeshBuilder(f"{n}.wood")
        self.metal = MeshBuilder(f"{n}.metal")
        self.stone = MeshBuilder(f"{n}.stone")
        self.cloth = MeshBuilder(f"{n}.cloth")
        self.interior = MeshBuilder(f"{n}.interior")
        self.front_openings = []
        self.side_openings = {'near': [], 'far': []}
        self.upper_openings = []
        self.glass = []      # (id, frame, rect, y)
        self.anchors = {}
        self.extra_objects = []

    # -- helpers --------------------------------------------------------------
    def world(self, s, y, z):
        return self.F.p(s, y, z)

    def s_near(self, frac):
        """s coordinate `frac` of the way from the near end to the far end."""
        return self.near * (self.W / 2) * (1 - 2 * frac)

    def window(self, s, z, w, h, cols=2, rows=4, gid=None, interior=True, sash=True, upper=False,
               shutters=None, anchor=None, bars=False, sash_mat=None):
        o = Opening('window', s, z, w, h, cols=cols, rows=rows, gid=gid, sash=sash, anchor=anchor,
                    bars=bars, sash_mat=sash_mat, shutters=shutters)
        self.front_openings.append(o)
        return o

    def side_window(self, which, d, z, w, h, cols=2, rows=4, gid=None, anchor=None):
        """Window on a side wall, `d` metres from the front corner."""
        o = Opening('window', d, z, w, h, cols=cols, rows=rows, gid=gid, anchor=anchor)
        self.side_openings[which].append(o)
        return o

    def door(self, s, w=1.05, h=2.25, style='panel', open_deg=0.0, hinge='left', anchor=None,
             transom=False, z=None, mat=None, gid=None):
        z = self.floor_z if z is None else z
        o = Opening('door', s, z, w, h + (0.45 if transom else 0.0), style=style, open_deg=open_deg,
                    hinge=hinge, anchor=anchor, transom=transom, door_h=h, mat=mat, gid=gid)
        self.front_openings.append(o)
        return o

    # -- build ----------------------------------------------------------------
    def build(self):
        F, r, W, D = self.F, self.r, self.W, self.D
        wood = self.wood
        top = self.front_top
        # FRONT WALL (false front) ------------------------------------------
        if self.siding != 'stone':
            C.siding(wood, F, -W / 2, W / 2, 0.0, top, self.front_openings, self.siding, self.wall_mat, r,
                     backing=wood)
        else:
            self._stone_front()
        # corner boards up the full height of the false front
        for s in (-W / 2, W / 2):
            h = top(s)
            wood.box(F, (s - 0.09, -0.06, 0.0), (s + 0.09, 0.08, h), self.trim, grain_axis=2)
        # cap board along the outline of the false front
        self._front_cap()
        # openings
        for i, o in enumerate(self.front_openings):
            self._opening(F, o, i, facade=True)
        # SIDE + BACK WALLS --------------------------------------------------
        e = self.eave
        self.side_frames = {}
        for which in ('near', 'far'):
            s_side = self.near * W / 2 if which == 'near' else -self.near * W / 2
            # Wall frame whose -Y faces outward. On the +s side, local x runs
            # from the front (y=0) back; on the -s side it runs from the back
            # to the front, so side openings are given as distance-from-front
            # and converted here.
            if s_side > 0:
                sf = F.sub((W / 2, 0, 0), rot_z=math.pi / 2)
                conv = (lambda d: d)
                back_end = D
            else:
                sf = F.sub((-W / 2, D, 0), rot_z=-math.pi / 2)
                conv = (lambda d, D=D: D - d)
                back_end = 0.0
            self.side_frames[which] = (sf, conv)
            ops = [Opening(o.kind, conv(o.s), o.z, o.w, o.h, **o.kw) for o in self.side_openings[which]]
            C.siding(wood, sf, 0.0, D, 0.0, C.top_fn_flat(e), ops, self.side_siding, self.side_mat, r,
                     backing=wood)
            for i, o in enumerate(ops):
                self._opening(sf, o, 100 + i + (50 if which == 'far' else 0), facade=False)
            wood.box(sf, (back_end - 0.08, -0.06, 0.0), (back_end + 0.08, 0.06, e), self.trim, grain_axis=2)
            # plain frieze board under the eave
            wood.box(sf, (0.0, -0.05, e - 0.22), (D, 0.0, e), self.trim, grain_axis=0)
        # back wall with gable
        bf = F.sub((0, D, 0), rot_z=math.pi)
        rise = (W / 2) * math.tan(math.radians(self.pitch))
        gtop = lambda s: e + max(0.0, rise * (1 - abs(s) / (W / 2)))
        C.siding(wood, bf, -W / 2, W / 2, 0.0, gtop, [], 'rough', self.side_mat, r, backing=None)
        # ROOF ---------------------------------------------------------------
        roof_mb = self.metal if self.roof == 'tin' else wood
        mat = 'tin_roof' if self.roof == 'tin' else 'shingle'
        self.ridge = C.gable_roof(roof_mb, F, -W / 2 - 0.02, W / 2 + 0.02, 0.15, D, e, self.pitch, mat, r,
                                  overhang=0.3, style=self.roof, fascia_mat='trim_dark')
        # the false front must hide the gable: it rises above the ridge
        # FOUNDATION skirt (under the floor)
        wood.box(F, (-W / 2, 0.02, -0.05), (W / 2, D, self.floor_z), 'wood_dark', grain_axis=0,
                 skip=('+z', '-z', '+y'))
        # PORCH --------------------------------------------------------------
        if self.walk:
            self._boardwalk()
        if self.porch and self.porch_roof:
            self._porch_roof()
        if self.cornice:
            self._cornice()
        self._interior()
        return self

    # -- pieces ------------------------------------------------------------
    def _stone_front(self):
        """Cut stone facade: slabs around the openings (grid decomposition)."""
        F, W = self.F, self.W
        top = self.front_top
        mb = self.stone
        ops = self.front_openings
        xs = sorted({-W / 2, W / 2, *[o.s0 for o in ops], *[o.s1 for o in ops]})
        zs = sorted({0.0, top(0), *[o.z for o in ops], *[o.z1 for o in ops]})
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                a, b, c, d = xs[i], xs[i + 1], zs[j], zs[j + 1]
                sm, zm = (a + b) / 2, (c + d) / 2
                if any(o.s0 - 1e-4 <= sm <= o.s1 + 1e-4 and o.z - 1e-4 <= zm <= o.z1 + 1e-4 for o in ops):
                    continue
                d = min(d, top(sm))
                if d <= c:
                    continue
                mb.box(F, (a, -0.3, c), (b, 0.02, d), 'stone_sand', rand=0.5, grain_axis=0,
                       skip=('+y',), uv_offset=(0, 0))
        # stone voussoirs / lintels over the openings: a proud keystone lintel
        for o in ops:
            mb.box(F, (o.s0 - 0.15, -0.34, o.z1), (o.s1 + 0.15, -0.28, o.z1 + 0.32), 'stone_sand', rand=0.2,
                   grain_axis=0, uv_offset=(0.3, 0.1))
            if o.kind == 'window':
                mb.box(F, (o.s0 - 0.1, -0.38, o.z - 0.1), (o.s1 + 0.1, -0.2, o.z), 'stone_sand', rand=0.7,
                       grain_axis=0, uv_offset=(0.2, 0.5))
        # pilasters at the corners
        for s in (-W / 2, W / 2 - 0.5):
            mb.box(F, (s, -0.42, 0.0), (s + 0.5, -0.28, top(0) - 0.6), 'stone_sand', rand=0.1, grain_axis=2,
                   uv_offset=(0.17, 0.0))

    def _front_cap(self):
        F, W = self.F, self.W
        top = self.front_top
        n = 40
        pts = [(-W / 2 + W * i / n, top(-W / 2 + W * i / n)) for i in range(n + 1)]
        # merge collinear runs into boards
        segs = []
        i = 0
        while i < n:
            j = i + 1
            while j < n and abs((pts[j + 1][1] - pts[j][1]) - (pts[j][1] - pts[j - 1][1])) < 1e-4:
                j += 1
            segs.append((pts[i], pts[j]))
            i = j
        for (a, b) in segs:
            if abs(a[1] - b[1]) < 1e-4:
                self.wood.box(F, (a[0] - 0.05, -0.1, a[1] - 0.02), (b[0] + 0.05, 0.12, a[1] + 0.06), self.trim,
                              grain_axis=0)
            else:
                self.wood.board(F, (a[0], -0.01, a[1] + 0.02), (b[0], -0.01, b[1] + 0.02), 0.2, 0.08, self.trim,
                                up=(0, 0, 1))
        # vertical risers where the outline steps
        for k in range(1, n + 1):
            (sa, za), (sb, zb) = pts[k - 1], pts[k]
            if abs(za - zb) > 0.05 and abs(sb - sa) < W / n + 1e-6:
                s = sb if zb > za else sa
                lo, hi = min(za, zb), max(za, zb)
                self.wood.box(F, (s - 0.05, -0.1, lo), (s + 0.05, 0.12, hi + 0.06), self.trim, grain_axis=2)

    def _cornice(self):
        """Projecting cornice with brackets, at the top of the flat part of the
        false front (or at a given height)."""
        F, W, r = self.F, self.W, self.r
        h = min(self.front_top(-W / 2), self.front_top(W / 2)) - 0.25
        cm = self.trim
        wood = self.wood
        wood.box(F, (-W / 2 - 0.12, -0.32, h - 0.05), (W / 2 + 0.12, 0.0, h + 0.08), cm, grain_axis=0)
        wood.box(F, (-W / 2 - 0.08, -0.22, h - 0.2), (W / 2 + 0.08, 0.0, h - 0.05), cm, grain_axis=0)
        wood.box(F, (-W / 2 + 0.05, -0.08, h - 0.55), (W / 2 - 0.05, 0.0, h - 0.2), cm, grain_axis=0)
        n = max(3, int(W / 0.9))
        for i in range(n + 1):
            s = -W / 2 + 0.1 + (W - 0.2) * i / n
            wood.box(F, (s - 0.05, -0.28, h - 0.52), (s + 0.05, 0.0, h - 0.05), cm, grain_axis=2,
                     taper=(0.0, 0.0))
            wood.box(F, (s - 0.05, -0.2, h - 0.62), (s + 0.05, 0.0, h - 0.52), cm, grain_axis=2)

    def _opening(self, f, o, i, facade=True):
        r, wood = self.r, self.wood
        trim = self.trim
        kw = o.kw
        if self.siding == 'stone' and facade:
            pass
        else:
            C.casing(wood, f, o, trim, r)
        if o.kind == 'window':
            smat = kw.get('sash_mat') or trim
            if kw.get('sash', True):
                rects = C.sash(wood, f, o, smat, kw.get('cols', 2), kw.get('rows', 4), r=r)
            else:
                rects = [(o.s0 + 0.03, o.z + 0.03, o.s1 - 0.03, o.z1 - 0.03, 0.06)]
            gid = kw.get('gid') or f"{self.key}_{i}"
            self.glass.append((gid, f, rects))
            if kw.get('bars'):
                n = int(o.w / 0.12)
                for k in range(1, n):
                    s = o.s0 + o.w * k / n
                    self.metal.cylinder(f.sub((s, -0.05, o.z)), (0, 0, 0), 0.012, o.h, 'iron', segments=6)
            if kw.get('shutters'):
                for sgn in (-1, 1):
                    s0 = o.s0 - o.casing - o.w / 2 if sgn < 0 else o.s1 + o.casing
                    sh_mat = kw['shutters']
                    ang = self.r.uniform(-0.25, 0.1)
                    hf = f.sub((o.s0 - o.casing if sgn < 0 else o.s1 + o.casing, -0.06, o.z))
                    hf = hf.sub(rot_z=ang * sgn)
                    for k in range(4):
                        a = k * o.w / 8
                        wood.box(hf, (sgn * a if sgn > 0 else -a - o.w / 8, -0.02, 0),
                                 (sgn * a + o.w / 8 if sgn > 0 else -a, 0.0, o.h), sh_mat, grain_axis=2)
            anchor = kw.get('anchor')
            if anchor:
                self.anchors[anchor] = dict(kind='window', frame=f, s=o.s, z=o.z, w=o.w, h=o.h,
                                            center=f.p(o.s, 0, o.z + o.h / 2), normal=f.d(0, -1, 0),
                                            sill=f.p(o.s, -0.1, o.z))
        elif o.kind == 'door':
            style = kw.get('style', 'panel')
            dh = kw.get('door_h', o.h)
            mat = kw.get('mat') or 'paint_brown'
            if kw.get('transom'):
                ot = Opening('window', o.s, o.z + dh + 0.06, o.w, o.h - dh - 0.08, casing=0.0)
                wood.box(f, (o.s0, -0.05, o.z + dh), (o.s1, 0.06, o.z + dh + 0.06), trim, grain_axis=0)
                rects = C.sash(wood, f, ot, trim, 3, 1, double_hung=False, r=r)
                self.glass.append((kw.get('gid') or f"{self.key}_t{i}", f, rects))
            if style == 'panel':
                C.panel_door(wood, f, o.s0 + 0.01, o.s1 - 0.01, o.z, o.z + dh - 0.01, mat, r,
                             hinge=kw.get('hinge', 'left'), open_deg=kw.get('open_deg', 0.0), y=0.07)
            elif style == 'double':
                half = o.w / 2
                C.panel_door(wood, f, o.s0 + 0.01, o.s + 0.0, o.z, o.z + dh - 0.01, mat, r, hinge='left',
                             open_deg=kw.get('open_deg', 0.0), y=0.07)
                C.panel_door(wood, f, o.s, o.s1 - 0.01, o.z, o.z + dh - 0.01, mat, r, hinge='right',
                             open_deg=kw.get('open_deg2', kw.get('open_deg', 0.0)), y=0.07)
            elif style == 'batwing':
                # the full doors folded back inside, the batwings in the opening
                half = o.w / 2 - 0.02
                self.batwings = []
                for hinge, s in (('left', o.s0 + 0.02), ('right', o.s1 - 0.02)):
                    mb = MeshBuilder(f"prop.{self.key}_batwing.{hinge}")
                    hf = C.batwing(mb, f, s, o.z + 0.45, o.z + 1.85, half, mat, r, hinge=hinge,
                                   open_deg=kw.get('open_deg', 0.0))
                    self.batwings.append((mb, hf))
                C.panel_door(wood, f, o.s0 + 0.01, o.s, o.z, o.z + dh - 0.01, mat, r, hinge='left',
                             open_deg=100, y=0.08)
                C.panel_door(wood, f, o.s, o.s1 - 0.01, o.z, o.z + dh - 0.01, mat, r, hinge='right',
                             open_deg=100, y=0.08)
            elif style == 'open':
                pass
            anchor = kw.get('anchor')
            if anchor:
                self.anchors[anchor] = dict(kind='door', frame=f, s=o.s, z=o.z, w=o.w, h=dh,
                                            center=f.p(o.s, 0, o.z), normal=f.d(0, -1, 0))

    def _boardwalk(self):
        """Boardwalk in front: planks across the walk, a sill beam and a
        fascia at the street edge, joists underneath where you can glimpse
        them."""
        F, W, r = self.F, self.W, self.r
        wood = self.wood
        P = WALK_DEPTH
        z = DECK_Z
        s = -W / 2 - 0.02
        while s < W / 2 + 0.02:
            pw = r.uniform(0.13, 0.17)
            sb = min(s + pw, W / 2 + 0.02)
            dz = r.uniform(-0.006, 0.006)
            wood.box(F, (s + 0.004, -P, z - 0.04 + dz), (sb - 0.004, 0.0, z + dz), 'wood_floor', grain_axis=1,
                     skip=('-y',) if False else ())
            s = sb
        # fascia board at the street edge + sill
        wood.box(F, (-W / 2, -P - 0.04, 0.0), (W / 2, -P + 0.02, z - 0.04), 'wood_raw', grain_axis=0)
        wood.box(F, (-W / 2, -P + 0.02, z - 0.24), (W / 2, -P + 0.2, z - 0.04), 'wood_dark', grain_axis=0,
                 skip=('-z',))
        # dark void under the deck (seen through the plank gaps)
        wood.quad(F, [(-W / 2, -P, 0.02), (W / 2, -P, 0.02), (W / 2, 0, 0.02), (-W / 2, 0, 0.02)],
                  'black_void', rand=0.1)
        # steps down at the ends (the alleys)
        for s_end, d in ((-W / 2, 1), (W / 2, -1)):
            pass
        self.walk_edge = [F.p(-W / 2, -P, z), F.p(W / 2, -P, z)]

    def _porch_roof(self):
        F, W, r = self.F, self.W, self.r
        wood = self.wood
        P = WALK_DEPTH
        h = self.porch_h
        post_y = -P + 0.12
        n = max(2, int(round(W / 3.0)))
        for i in range(n + 1):
            s = -W / 2 + 0.12 + (W - 0.24) * i / n
            wood.box(F, (s - 0.065, post_y - 0.065, DECK_Z), (s + 0.065, post_y + 0.065, h), 'wood_post',
                     grain_axis=2)
            # knee braces
            for sg in (-1, 1):
                if (i == 0 and sg < 0) or (i == n and sg > 0):
                    continue
                wood.board(F, (s + sg * 0.05, post_y, h - 0.55), (s + sg * 0.5, post_y, h - 0.08), 0.08, 0.06,
                           'wood_post', up=(0, 1, 0))
        # beam
        wood.box(F, (-W / 2, post_y - 0.08, h), (W / 2, post_y + 0.08, h + 0.2), 'wood_post', grain_axis=0)
        # ledger on the wall
        wood.box(F, (-W / 2, -0.12, h + 0.35), (W / 2, -0.02, h + 0.5), 'wood_dark', grain_axis=0)
        # rafters
        k = int(W / 0.6)
        for i in range(k + 1):
            s = -W / 2 + 0.05 + (W - 0.1) * i / k
            wood.board(F, (s, -0.05, h + 0.45), (s, -P - 0.2, h + 0.14), 0.12, 0.05, 'wood_dark',
                       up=(0, 0, 1))
        C.shed_roof(self.metal, F, -W / 2 - 0.05, W / 2 + 0.05, -0.02, -P - 0.3, h + 0.52, h + 0.22,
                    'tin_roof', r)
        # fascia on the roof edge
        wood.box(F, (-W / 2 - 0.05, -P - 0.34, h + 0.05), (W / 2 + 0.05, -P - 0.3, h + 0.26), self.trim,
                 grain_axis=0)
        self.anchors['porch_roof'] = dict(kind='roof', edge=[F.p(-W / 2, -P - 0.3, h + 0.26),
                                                            F.p(W / 2, -P - 0.3, h + 0.26)])

    def _interior(self):
        """Inward-facing box per storey behind the facade so windows and open
        doors show a dim room, not the sky."""
        F, W, D = self.F, self.W, self.D
        mb = self.interior
        storey_h = 3.6 if self.storeys > 1 else self.eave - self.floor_z
        for k in range(self.storeys):
            z0 = self.floor_z + k * 3.6
            z1 = z0 + storey_h - 0.05
            s0, s1, y0, y1 = -W / 2 + 0.03, W / 2 - 0.03, 0.03, min(D - 0.1, 7.0)
            # floor (planks), ceiling, back wall, side walls — all facing in
            mb.quad(F, [(s0, y0, z0 + 0.001), (s0, y1, z0 + 0.001), (s1, y1, z0 + 0.001), (s1, y0, z0 + 0.001)],
                    'wood_interior')
            mb.quad(F, [(s0, y0, z1), (s1, y0, z1), (s1, y1, z1), (s0, y1, z1)], 'wood_dark')
            mb.quad(F, [(s0, y1, z0), (s0, y1, z1), (s1, y1, z1), (s1, y1, z0)], 'wood_interior')
            mb.quad(F, [(s0, y0, z0), (s0, y0, z1), (s0, y1, z1), (s0, y1, z0)], 'wood_interior')
            mb.quad(F, [(s1, y0, z0), (s1, y1, z0), (s1, y1, z1), (s1, y0, z1)], 'wood_interior')

    # -- output ---------------------------------------------------------------
    def emit(self, col, lib):
        objs = []
        for mb, surf in ((self.wood, 'wood'), (self.metal, 'metal'), (self.stone, 'stone'),
                         (self.cloth, 'cloth'), (self.interior, 'wood')):
            ob = mb.build(col, lib, surface=surf, group=self.group, building=self.key)
            if ob:
                objs.append(ob)
        for mb, hf in getattr(self, 'batwings', []):
            ob = mb.build(col, lib, surface='wood', group=self.group, building=self.key, animatable=1)
            if ob:
                objs.append(ob)
        return objs
