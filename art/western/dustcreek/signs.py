"""Hand-painted signs, posters and the clock face.

Lettering is rendered once into small RGB *mask* images (R = main paint,
G = shadow/outline, B = accent), which the sign materials then treat as paint
on weathered boards: the same peeling/fading/dirt as everything else. Letters
are drawn from the macOS system faces (Clarendon, Rockwell...) that ship with
the OS — nothing is downloaded — and every glyph is nudged, tilted and scaled
a little so the result reads as a sign-writer's brush, not a font.

The wanted poster's finger-gun hand is drawn here from Bézier curves.
"""

import math
import os

import bpy
import bmesh
from mathutils import Vector, Matrix

from .core import rng
from .nodes import G, new_material, group_node
from .materials import lin

FONT_DIRS = ["/System/Library/Fonts/Supplemental", "/System/Library/Fonts", "/Library/Fonts"]
FONTS = {
    'clarendon': "SuperClarendon.ttc",
    'rockwell': "Rockwell.ttc",
    'copperplate': "Copperplate.ttc",
    'didot': "Didot.ttc",
    'bodoni': "Bodoni 72.ttc",
    'typewriter': "AmericanTypewriter.ttc",
    'herculanum': "Herculanum.ttf",
    'phosphate': "Phosphate.ttc",
    'georgia_bold': "Georgia Bold.ttf",
    'impact': "Impact.ttf",
}
_font_cache = {}

OUT_DIR = None  # set by build: where mask PNGs go


def font(key):
    if key in _font_cache:
        return _font_cache[key]
    fn = FONTS.get(key, key)
    for d in FONT_DIRS:
        p = os.path.join(d, fn)
        if os.path.exists(p):
            f = bpy.data.fonts.load(p, check_existing=True)
            _font_cache[key] = f
            return f
    # Fallback: Blender's built-in face keeps the build working anywhere.
    f = bpy.data.fonts.get("Bfont Regular") or bpy.data.fonts.load("<builtin>")
    _font_cache[key] = f
    return f


class MaskScene:
    """A throwaway scene with an orthographic camera looking down on the XY
    plane. Items are added in metres of the sign; render() writes the PNG."""

    def __init__(self, key, width, height, px_per_m=300, max_px=2048):
        self.key = key
        self.w, self.h = width, height
        scale = min(px_per_m, max_px / max(width, height))
        self.res = (max(16, int(width * scale)), max(16, int(height * scale)))
        self.scene = bpy.data.scenes.new(f"mask_{key}")
        sc = self.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'GPU'
        sc.cycles.samples = 24
        sc.cycles.use_denoising = False
        sc.render.resolution_x, sc.render.resolution_y = self.res
        sc.render.resolution_percentage = 100
        sc.render.film_transparent = False
        sc.view_settings.view_transform = 'Standard'
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGB'
        w = bpy.data.worlds.new(f"maskworld_{key}")
        w.use_nodes = True
        bg = w.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0, 0, 0, 1)
        sc.world = w
        cam_data = bpy.data.cameras.new(f"maskcam_{key}")
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = max(width, height)
        cam = bpy.data.objects.new(f"maskcam_{key}", cam_data)
        cam.location = (width / 2, height / 2, 10)
        sc.collection.objects.link(cam)
        sc.camera = cam
        self.mats = {}
        self.r = rng(f"mask:{key}")

    def mat(self, ch):
        if ch in self.mats:
            return self.mats[ch]
        col = {'R': (1, 0, 0), 'G': (0, 1, 0), 'B': (0, 0, 1), 'W': (1, 1, 1)}[ch]
        m, g = new_material(f"mask_{self.key}_{ch}")
        em = g.node('ShaderNodeEmission', inputs={'Color': col, 'Strength': 1.0}, out=0)
        g.output(em)
        self.mats[ch] = m
        return m

    def _link(self, ob, ch, z):
        ob.location.z = z
        if ob.data.materials:
            ob.data.materials[0] = self.mat(ch)
        else:
            ob.data.materials.append(self.mat(ch))
        self.scene.collection.objects.link(ob)

    def text(self, s, x, y, size, face='clarendon', align='CENTER', ch='R', jitter=1.0, spacing=1.0,
             shadow=None, stretch=1.0, z=0.0, outline=None):
        """Draw text with its baseline centre at (x, y). size = cap height-ish.
        shadow: (dx, dy) offset for a drop shadow in channel G.
        outline: width of a G-channel outline around the letters."""
        layers = [(ch, 0.0, 0.0, z)]
        if shadow:
            layers.append(('G', shadow[0], shadow[1], z - 0.01))
        if outline:
            layers.append(('G', 0.0, 0.0, z - 0.02))
        for (c, dx, dy, zz) in layers:
            cu = bpy.data.curves.new(f"t_{self.key}", 'FONT')
            cu.body = s
            cu.font = font(face)
            cu.size = size
            cu.space_character = spacing
            cu.align_x = align
            cu.align_y = 'BOTTOM_BASELINE' if hasattr(cu, 'align_y') else 'BOTTOM'
            cu.resolution_u = 6
            if c == 'G' and outline:
                cu.offset = outline
            ob = bpy.data.objects.new("t", cu)
            ob.location = (x + dx, y + dy, zz)
            ob.scale = (stretch, 1, 1)
            self.scene.collection.objects.link(ob)
            # to mesh so each glyph can be jittered like a brush stroke
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            self.scene.collection.objects.unlink(ob)
            bpy.data.objects.remove(ob)
            if jitter > 0:
                self._jitter(me, size, jitter)
            mo = bpy.data.objects.new("tm", me)
            mo.location = (x + dx, y + dy, 0)
            mo.scale = (stretch, 1, 1)
            self._link(mo, c, zz)

    def _jitter(self, me, size, amt):
        bm = bmesh.new()
        bm.from_mesh(me)
        islands = []
        seen = set()
        for f in bm.faces:
            if f.index in seen:
                continue
            stack = [f]
            isl = set()
            while stack:
                cur = stack.pop()
                if cur.index in isl:
                    continue
                isl.add(cur.index)
                for e in cur.edges:
                    for lf in e.link_faces:
                        if lf.index not in isl:
                            stack.append(lf)
            seen |= isl
            islands.append(isl)
        bm.faces.ensure_lookup_table()
        r = self.r
        # group islands by glyph: islands whose x-centres are close belong
        # together (the dot of an i), so they move as one.
        for isl in islands:
            verts = {v for fi in isl for v in bm.faces[fi].verts}
            c = sum((v.co for v in verts), Vector()) / len(verts)
            ang = r.gauss(0, 0.022 * amt)
            sc = 1 + r.gauss(0, 0.03 * amt)
            off = Vector((r.gauss(0, 0.012 * amt), r.gauss(0, 0.02 * amt), 0)) * size
            rot = Matrix.Rotation(ang, 3, 'Z')
            for v in verts:
                v.co = c + rot @ ((v.co - c) * sc) + off
        # a slow wobble along the whole line: the painter's arm
        ph = r.uniform(0, 6.28)
        for v in bm.verts:
            v.co.y += math.sin(v.co.x / size * 0.9 + ph) * 0.012 * size * amt
        bm.to_mesh(me)
        bm.free()

    def rect(self, x0, y0, x1, y1, ch='B', line=None, z=-0.05):
        """Filled rectangle, or an outline of width `line`."""
        bm = bmesh.new()
        if line is None:
            vs = [bm.verts.new(p) for p in ((x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0))]
            bm.faces.new(vs)
        else:
            for (a, b, c, d) in (((x0, y0), (x1, y0), (x1, y0 + line), (x0, y0 + line)),
                                 ((x0, y1 - line), (x1, y1 - line), (x1, y1), (x0, y1)),
                                 ((x0, y0), (x0 + line, y0), (x0 + line, y1), (x0, y1)),
                                 ((x1 - line, y0), (x1, y0), (x1, y1), (x1 - line, y1))):
                vs = [bm.verts.new((p[0], p[1], 0)) for p in (a, b, c, d)]
                bm.faces.new(vs)
        me = bpy.data.meshes.new("r")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("r", me)
        self._link(ob, ch, z)

    def polyline(self, pts, width, ch='R', closed=False, z=0.0, smooth=True, taper=False):
        """A brush/pen stroke through 2D points (Bézier with auto handles)."""
        cu = bpy.data.curves.new("pl", 'CURVE')
        cu.dimensions = '2D'
        cu.fill_mode = 'BOTH'
        cu.bevel_depth = 0.0
        cu.extrude = 0.0
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = (p[0], p[1], 0)
            bp.handle_left_type = bp.handle_right_type = 'AUTO' if smooth else 'VECTOR'
        sp.use_cyclic_u = closed
        cu.resolution_u = 10
        # stroke = curve with a rectangular 'bevel' via offset: build as mesh
        ob = bpy.data.objects.new("pl", cu)
        self.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        self.scene.collection.objects.unlink(ob)
        bpy.data.objects.remove(ob)
        # me is an edge chain; thicken it into a ribbon
        bm = bmesh.new()
        bm.from_mesh(me)
        chain = [v.co.copy() for v in bm.verts]
        bm.free()
        bm = bmesh.new()
        n = len(chain)
        left, right = [], []
        for i, p in enumerate(chain):
            a = chain[max(0, i - 1)]
            b = chain[min(n - 1, i + 1)]
            d = (b - a)
            if d.length < 1e-9:
                d = Vector((1, 0, 0))
            d.normalize()
            nrm = Vector((-d.y, d.x, 0))
            t = i / max(1, n - 1)
            w = width * (math.sin(math.pi * t) ** 0.35 if taper else 1.0)
            left.append(bm.verts.new(p + nrm * w / 2))
            right.append(bm.verts.new(p - nrm * w / 2))
        for i in range(n - 1):
            bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
        if closed:
            bm.faces.new((left[-1], right[-1], right[0], left[0]))
        me2 = bpy.data.meshes.new("stroke")
        bm.to_mesh(me2)
        bm.free()
        ob2 = bpy.data.objects.new("stroke", me2)
        self._link(ob2, ch, z)

    def fill(self, pts, ch='R', z=-0.01, smooth=True):
        """A filled smooth closed shape."""
        cu = bpy.data.curves.new("fill", 'CURVE')
        cu.dimensions = '2D'
        cu.fill_mode = 'BOTH'
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = (p[0], p[1], 0)
            bp.handle_left_type = bp.handle_right_type = 'AUTO' if smooth else 'VECTOR'
        sp.use_cyclic_u = True
        ob = bpy.data.objects.new("fill", cu)
        ob.location.z = z
        cu.materials.append(self.mat(ch))
        self.scene.collection.objects.link(ob)

    def render(self):
        path = os.path.join(OUT_DIR, f"{self.key}.png")
        sc = self.scene
        sc.render.filepath = path
        win_scene = bpy.context.window.scene if bpy.context.window else None
        bpy.ops.render.render(write_still=True, scene=sc.name)
        # clean up: the scene and its throwaway data
        for ob in list(sc.collection.objects):
            data = ob.data
            bpy.data.objects.remove(ob)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Curve):
                    bpy.data.curves.remove(data)
                elif isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
        for m in self.mats.values():
            bpy.data.materials.remove(m)
        w = sc.world
        bpy.data.scenes.remove(sc)
        if w:
            bpy.data.worlds.remove(w)
        img = bpy.data.images.load(path, check_existing=False)
        img.name = f"mask_{self.key}"
        img.colorspace_settings.name = 'Non-Color'
        return img


# ---------------------------------------------------------------------------
# Sign material: the mask becomes paint on a weathered board

def sign_material(key, mask, bg, fill, shadow=None, accent=None, wear=0.45, bleach=0.5,
                  light=None, dark=None, fade=0.25, dirt=0.8):
    """A board painted `bg` with lettering `fill` (mask R), `shadow` (G) and
    `accent` (B). Lettering is scuffed by a dry-brush noise so it looks
    painted by hand and half-eaten by sun and sand."""
    m, g = new_material(f"sign_{key}")
    uv = g.uv('local')
    col = g.image(mask, uv, out='Color', extension='CLIP')
    R, Gc, B = g.sep_rgb(col)
    pos = g.geo('Position')
    dry = g.noise(g.vmul(uv, (40.0, 8.0, 1.0)), scale=3.0, detail=6.0, rough=0.7)
    scuff = g.smooth(g.noise(pos, scale=5.0, detail=8.0), 0.62, 0.72)
    keep = g.mul(g.smooth(dry, 0.18, 0.32), g.sub(1.0, g.mul(scuff, fade * 3)), clamp=True)
    paint = g.rgb(bg)
    if shadow is not None:
        paint = g.mix(g.mul(Gc, keep), paint, g.rgb(shadow))
    if accent is not None:
        paint = g.mix(g.mul(B, keep), paint, g.rgb(accent))
    paint = g.mix(g.mul(R, keep), paint, g.rgb(fill))
    n = group_node(g, bpy.data.node_groups["DC_Wood"], {
        "Paint": paint, "Paint Amount": 1.0, "Paint Wear": wear, "Bleach": bleach, "Dirt": dirt,
        "Nails": 1.0,
    })
    if light is not None:
        g.set_in(n, "Light", light)
    if dark is not None:
        g.set_in(n, "Dark", dark)
    g.output(g.out(n, "BSDF"))
    m["surface"] = 'wood'
    return m


def paper_material(key, mask, paper=lin(214, 196, 158), ink=lin(34, 26, 20), red=lin(120, 30, 22),
                   age=0.6):
    """A printed poster: ink (R), red ink (G), tinted areas (B) on sun-browned
    paper with water stains and darkened edges."""
    m, g = new_material(f"paper_{key}")
    uv = g.uv('local')
    col = g.image(mask, uv, out='Color', extension='CLIP')
    R, Gc, B = g.sep_rgb(col)
    u, v, _ = g.separate(uv)
    pos = g.geo('Position')
    fib = g.noise(g.vmul(uv, (60, 60, 1)), scale=4.0, detail=8.0, rough=0.7)
    stain = g.noise(g.vmul(uv, (2.5, 2.5, 1)), scale=2.0, detail=6.0, rough=0.6, w=None)
    edge = g.math('MINIMUM', g.math('MINIMUM', u, g.sub(1.0, u)), g.math('MINIMUM', v, g.sub(1.0, v)))
    edgedark = g.sub(1.0, g.smooth(edge, 0.0, 0.08))
    base = g.mix(g.mul(fib, 0.3), g.rgb(paper), g.hsv(g.rgb(paper), v=0.85))
    base = g.mix(g.mul(g.smooth(stain, 0.55, 0.75), age * 0.6), base, g.hsv(g.rgb(paper), s=1.4, v=0.7))
    base = g.mix(g.mul(edgedark, age), base, g.rgb(lin(150, 118, 76)))
    inkkeep = g.smooth(g.noise(g.vmul(uv, (90, 90, 1)), scale=3.0, detail=4.0), 0.2, 0.35)
    base = g.mix(g.mul(B, 0.8), base, g.hsv(g.rgb(paper), v=0.75, s=1.3))
    base = g.mix(g.mul(Gc, inkkeep), base, g.rgb(red))
    base = g.mix(g.mul(R, inkkeep), base, g.rgb(ink))
    bsdf = g.principled(base, rough=0.92, normal=g.bump(fib, strength=0.15, distance=0.001),
                        subsurface=None)
    g.output(bsdf)
    m["surface"] = 'cloth'
    return m


# ---------------------------------------------------------------------------
# Specific artwork

def finger_gun(ms, cx, cy, s, ch='R', line=0.012):
    """The Hand, drawn as a woodcut: a right hand making a finger pistol,
    pointing right. (cx, cy) centre, s = overall scale (height ~ s)."""
    def P(pts):
        return [(cx + x * s, cy + y * s) for x, y in pts]
    lw = line
    # outline of index finger (barrel) along the top, back over the knuckles,
    # down the palm heel and wrist; thumb up as the hammer.
    index = P([(-0.10, 0.10), (0.10, 0.12), (0.32, 0.13), (0.50, 0.13), (0.56, 0.11), (0.57, 0.07),
               (0.53, 0.04), (0.33, 0.035), (0.14, 0.03)])
    thumb = P([(-0.14, 0.12), (-0.11, 0.22), (-0.07, 0.34), (-0.03, 0.40), (0.01, 0.40), (0.03, 0.36),
               (0.02, 0.28), (0.0, 0.18), (0.02, 0.12)])
    fist = P([(0.14, 0.03), (0.18, -0.02), (0.19, -0.07), (0.15, -0.10), (0.18, -0.14), (0.17, -0.19),
              (0.12, -0.22), (0.14, -0.26), (0.11, -0.30), (0.04, -0.32), (-0.08, -0.31), (-0.18, -0.26)])
    palm = P([(-0.14, 0.12), (-0.22, 0.06), (-0.26, -0.06), (-0.24, -0.18), (-0.18, -0.26)])
    wrist_top = P([(-0.24, -0.02), (-0.44, -0.04), (-0.62, -0.05)])
    wrist_bot = P([(-0.20, -0.26), (-0.40, -0.26), (-0.62, -0.25)])
    cuff = P([(-0.60, 0.02), (-0.66, -0.14), (-0.60, -0.31)])
    cuff2 = P([(-0.60, 0.02), (-0.80, 0.03)])
    cuff3 = P([(-0.60, -0.31), (-0.80, -0.32)])
    for stroke in (index, thumb, fist, palm, wrist_top, wrist_bot, cuff, cuff2, cuff3):
        ms.polyline(stroke, lw * s, ch=ch)
    # finger creases on the curled fingers
    for (a, b) in (((0.08, -0.03), (0.17, -0.04)), ((0.07, -0.12), (0.16, -0.13)),
                   ((0.05, -0.21), (0.13, -0.22))):
        ms.polyline(P([a, ((a[0] + b[0]) / 2, a[1] - 0.012), b]), lw * 0.7 * s, ch=ch)
    # knuckle creases on the index finger
    for x in (0.30, 0.44):
        ms.polyline(P([(x, 0.125), (x + 0.01, 0.09), (x, 0.045)]), lw * 0.6 * s, ch=ch)
    # thumbnail
    ms.polyline(P([(-0.045, 0.37), (-0.02, 0.385), (0.005, 0.37)]), lw * 0.6 * s, ch=ch)
    # fingernail
    ms.polyline(P([(0.53, 0.12), (0.555, 0.10), (0.55, 0.075)]), lw * 0.6 * s, ch=ch)
    # engraving hatch shading under the palm and on the curled fingers
    r = ms.r
    for i in range(14):
        t = i / 13
        x0 = -0.22 + t * 0.34
        ms.polyline(P([(x0, -0.28 + 0.02 * math.sin(t * 7)), (x0 + 0.05, -0.12 - 0.04 * t)]),
                    lw * 0.35 * s, ch=ch)
    for i in range(10):
        t = i / 9
        x0 = -0.56 + t * 0.3
        ms.polyline(P([(x0, -0.24), (x0 + 0.03, -0.17)]), lw * 0.3 * s, ch=ch)
    # smoke curl from the fingertip, for fun
    ms.polyline(P([(0.60, 0.10), (0.66, 0.14), (0.63, 0.19), (0.69, 0.24), (0.66, 0.30)]),
                lw * 0.5 * s, ch=ch, taper=True)


def wanted_the_hand():
    """'WANTED — THE HAND — $5,000' with the finger-gun drawing."""
    W, H = 0.46, 0.64
    ms = MaskScene("poster_hand", W, H, px_per_m=1800)
    ms.text("WANTED", W / 2, H - 0.105, 0.085, face='clarendon', jitter=0.25, stretch=0.92)
    ms.rect(0.03, H - 0.125, W - 0.03, H - 0.118, ch='R')
    ms.text("— THE HAND —", W / 2, H - 0.17, 0.032, face='clarendon', jitter=0.2)
    ms.rect(0.07, 0.19, W - 0.07, H - 0.195, ch='R', line=0.004)
    finger_gun(ms, W / 2 + 0.01, (0.19 + H - 0.195) / 2 + 0.005, 0.30, line=0.022)
    ms.text("DEAD OR ALIVE", W / 2, 0.14, 0.026, face='clarendon', jitter=0.2)
    ms.text("$5,000", W / 2, 0.065, 0.06, face='clarendon', ch='G', jitter=0.25)
    ms.text("REWARD", W / 2, 0.035, 0.016, face='typewriter', jitter=0.1)
    ms.rect(0.012, 0.012, W - 0.012, H - 0.012, ch='R', line=0.003)
    return ms.render(), (W, H)


def generic_wanted(i, name, amount):
    W, H = 0.42, 0.58
    r = rng(f"poster{i}")
    ms = MaskScene(f"poster_{i}", W, H, px_per_m=900)
    ms.text("WANTED", W / 2, H - 0.1, 0.075, face=r.choice(['clarendon', 'rockwell']), jitter=0.3)
    ms.text(name, W / 2, H - 0.15, 0.03, face='typewriter', jitter=0.2)
    # a blank portrait frame (faces are not our business; the gang's are the game's)
    ms.rect(0.09, 0.18, W - 0.09, H - 0.19, ch='B')
    ms.rect(0.09, 0.18, W - 0.09, H - 0.19, ch='R', line=0.004)
    # a man in a hat: shoulders, neck, head, brim, crown (a woodcut, faceless)
    cx = W / 2
    b0 = 0.18
    ms.fill([(cx - 0.12, b0), (cx - 0.115, b0 + 0.05), (cx - 0.08, b0 + 0.085), (cx - 0.03, b0 + 0.1),
             (cx + 0.03, b0 + 0.1), (cx + 0.08, b0 + 0.085), (cx + 0.115, b0 + 0.05), (cx + 0.12, b0)], ch='R',
            smooth=False)
    ms.fill([(cx - 0.022, b0 + 0.095), (cx - 0.02, b0 + 0.125), (cx + 0.02, b0 + 0.125), (cx + 0.022, b0 + 0.095)],
            ch='R', smooth=False)
    ms.fill([(cx + 0.045 * math.cos(t), b0 + 0.165 + 0.055 * math.sin(t)) for t in
             [i * math.pi / 8 for i in range(16)]], ch='R')
    ms.fill([(cx - 0.1, b0 + 0.2), (cx - 0.06, b0 + 0.213), (cx + 0.06, b0 + 0.213), (cx + 0.1, b0 + 0.2),
             (cx + 0.07, b0 + 0.222), (cx - 0.07, b0 + 0.222)], ch='R')
    ms.fill([(cx - 0.05, b0 + 0.215), (cx - 0.045, b0 + 0.27), (cx - 0.01, b0 + 0.262), (cx + 0.01, b0 + 0.262),
             (cx + 0.045, b0 + 0.27), (cx + 0.05, b0 + 0.215)], ch='R')
    ms.text(amount, W / 2, 0.08, 0.05, face='clarendon', jitter=0.3, ch='G')
    ms.text("REWARD", W / 2, 0.04, 0.02, face='typewriter', jitter=0.1)
    return ms.render(), (W, H)


def clock_face():
    D = 0.8
    ms = MaskScene("clock", D, D, px_per_m=900)
    c = D / 2
    rad = D * 0.36
    for h in range(12):
        a = math.pi / 2 - h * math.pi / 6
        txt = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"][h]
        ms.text(txt, c + math.cos(a) * rad, c + math.sin(a) * rad - 0.022, 0.06, face='didot', jitter=0.05,
                stretch=0.8)
    for m in range(60):
        a = math.pi / 2 - m * math.pi / 30
        r0, r1 = D * 0.44, D * 0.465 if m % 5 else D * 0.475
        ms.polyline([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * r1, c + math.sin(a) * r1)],
                    0.004, ch='R', smooth=False)
    # hands at 5:42 — late afternoon, matching the sun
    hh = (5 + 42 / 60) / 12 * 2 * math.pi
    mm = 42 / 60 * 2 * math.pi
    ms.polyline([(c, c), (c + math.sin(hh) * D * 0.22, c + math.cos(hh) * D * 0.22)], 0.018, ch='G', smooth=False)
    ms.polyline([(c, c), (c + math.sin(mm) * D * 0.34, c + math.cos(mm) * D * 0.34)], 0.011, ch='G', smooth=False)
    ms.fill([(c + 0.02 * math.cos(t), c + 0.02 * math.sin(t)) for t in [i * math.pi / 4 for i in range(8)]], ch='G')
    return ms.render(), (D, D)
