"""Check Dead of Night's assets against the contract in docs/DEAD_OF_NIGHT.md
(plain Python, no Blender needed):

    python3 art/night/check_night.py            # everything in public/assets/night
    python3 art/night/check_night.py road.glb   # one file

Reads each GLB's JSON chunk and proves: every contract node and extra the
game relies on, every mesh's surface, the baked layers and how they travel,
the corn's vertex layers, the humanoid bone names, every clip, the variants,
the sockets and the eyes, and the budgets (file size, triangles, atlases).
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "..", "public", "assets", "night")

SURFACES = {"asphalt", "dirt", "wood", "metal", "glass", "cloth", "plant", "sandbag", "water"}
LETTERS = ["G", "A1", "S1", "amp", "E", "A2", "T", "S2"]
ROAD_SECRETS = ["secret.scarecrow", "secret.scarecrow.head", "secret.booth.light", "secret.phone.motel",
                "secret.drivein.lamp", "secret.drivein.screen", "secret.radio", "secret.duck"] + \
               [f"secret.sign.{l}" for l in LETTERS]
BONES = ["hips", "spine", "chest", "neck", "head", "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
         "shoulder.R", "upper_arm.R", "forearm.R", "hand.R", "thigh.L", "shin.L", "foot.L",
         "thigh.R", "shin.R", "foot.R"]
WALKER_CLIPS = ["idle", "walk.shamble", "walk.limp", "walk.drag", "walk.lurch", "run", "lunge", "crawl", "claw",
                "stagger", "hit_head", "death_back", "death_forward", "death_crumple", "climb_out", "vault", "bloat_burst"]
MECH_CLIPS = list(WALKER_CLIPS) + ["roar", "mask_off", "swing"]
# the crawler's own clips (the game's CLIP_FALLBACKS, src/games/night/world/rigs.ts)
WALKER_CLIPS = WALKER_CLIPS + ["idle.low", "claw.low", "hit_head.low", "death.low"]
SURVIVOR_CLIPS = ["run", "run_lantern", "duck", "wave"]
CAT_CLIPS = ["sit", "hiss", "leap", "walk"]
OUTFITS = ["farmer", "trucker", "waitress", "hunter", "mechanic_small", "suit"]


def load(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    off, js, binlen = 12, None, 0
    while off < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk)
        else:
            binlen = clen
        off += 8 + clen
    return js, len(data), binlen


def tris_of_mesh(g, mi):
    t = 0
    for p in g["meshes"][mi]["primitives"]:
        idx = p.get("indices")
        if idx is not None:
            t += g["accessors"][idx]["count"] // 3
        else:
            t += g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return t


def image_sizes(g, data_path):
    """(name, bytes, width, height) of each embedded image, reading WebP headers."""
    with open(data_path, "rb") as f:
        raw = f.read()
    # binary chunk offset
    off = 12
    jlen = struct.unpack_from("<I", raw, off)[0]
    bin_off = off + 8 + jlen + 8
    out = []
    for im in g.get("images", []):
        bv = g["bufferViews"][im["bufferView"]]
        b = raw[bin_off + bv.get("byteOffset", 0): bin_off + bv.get("byteOffset", 0) + bv["byteLength"]]
        w = h = None
        if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            kind = b[12:16]
            if kind == b"VP8 ":
                w = struct.unpack_from("<H", b, 26)[0] & 0x3FFF
                h = struct.unpack_from("<H", b, 28)[0] & 0x3FFF
            elif kind == b"VP8L":
                bits = struct.unpack_from("<I", b, 21)[0]
                w = (bits & 0x3FFF) + 1
                h = ((bits >> 14) & 0x3FFF) + 1
            elif kind == b"VP8X":
                w = 1 + int.from_bytes(b[24:27], "little")
                h = 1 + int.from_bytes(b[27:30], "little")
        out.append((im.get("name"), bv["byteLength"], w, h, im.get("mimeType")))
    return out


class Report:
    def __init__(self, name):
        self.name = name
        self.errors = []
        self.notes = []

    def need(self, cond, msg):
        if not cond:
            self.errors.append(msg)

    def note(self, msg):
        self.notes.append(msg)

    def done(self):
        print(f"\n== {self.name}")
        for n in self.notes:
            print("  " + n)
        if self.errors:
            print("  CONTRACT ERRORS:")
            for e in self.errors:
                print("   -", e)
        else:
            print("  contract OK")
        return not self.errors


# ---------------------------------------------------------------------------
# Geometry helpers for the play-view proof (plain Python, no numpy needed)

def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)


def _qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v' = q v q*
    ix = w * vx + y * vz - z * vy
    iy = w * vy + z * vx - x * vz
    iz = w * vz + x * vy - y * vx
    iw = -x * vx - y * vy - z * vz
    return (ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x)


def world_transforms(g):
    """(position, rotation quaternion, scale) of every node in the world."""
    nodes = g["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    out = {}

    def get(i):
        if i in out:
            return out[i]
        n = nodes[i]
        t = n.get("translation", [0, 0, 0])
        r = n.get("rotation", [0, 0, 0, 1])
        sc = n.get("scale", [1, 1, 1])
        if i in parent:
            pt, pr, ps = get(parent[i])
            v = _qrot(pr, (t[0] * ps[0], t[1] * ps[1], t[2] * ps[2]))
            res = ((pt[0] + v[0], pt[1] + v[1], pt[2] + v[2]), _qmul(pr, r), (ps[0] * sc[0], ps[1] * sc[1], ps[2] * sc[2]))
        else:
            res = (tuple(t), tuple(r), tuple(sc))
        out[i] = res
        return res
    for i in range(len(nodes)):
        get(i)
    return out


def mesh_centre(g, node_i, xf):
    """World centre of a mesh node's bounds (accessor min/max, even Draco'd)."""
    n = g["nodes"][node_i]
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for pr in g["meshes"][n["mesh"]]["primitives"]:
        acc = g["accessors"][pr["attributes"]["POSITION"]]
        for k in range(3):
            lo[k] = min(lo[k], acc["min"][k])
            hi[k] = max(hi[k], acc["max"][k])
    t, r, sc = xf[node_i]
    c = [(lo[k] + hi[k]) / 2 * sc[k] for k in range(3)]
    v = _qrot(r, c)
    return (t[0] + v[0], t[1] + v[1], t[2] + v[2]), max((hi[k] - lo[k]) * sc[k] for k in range(3)) / 2


def play_sights(g):
    """The points src/games/night/world/sights.ts playSights() frames, in
    the eye's level frame (x right, y up, -z forward): (x, y, z, margin)."""
    nodes = g["nodes"]
    xf = world_transforms(g)
    idx = {n.get("name"): i for i, n in enumerate(nodes)}
    pos = lambda name: xf[idx[name]][0]
    eye = pos("camera.player")
    # the eye's heading (its yaw only: pitch is the framing's)
    fwd = _qrot(xf[idx["camera.player"]][1], (0, 0, -1))
    yaw = math.atan2(-fwd[0], -fwd[2])
    cy, sy = math.cos(yaw), math.sin(yaw)

    def to_eye(p):
        dx, dy, dz = p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]
        return (dx * cy - dz * sy, dy, dx * sy + dz * cy)
    out = []

    def figure(p):
        dx, dz = eye[0] - p[0], eye[2] - p[2]
        ln = math.hypot(dx, dz) or 1
        sx, sz = -dz / ln, dx / ln
        for s_ in (-1, 1):
            out.append((*to_eye((p[0] + sx * 0.28 * s_, p[1] + 1.72, p[2] + sz * 0.28 * s_)), 0.02, "figure"))
            out.append((*to_eye((p[0] + sx * 0.4 * s_, p[1] + 1.2, p[2] + sz * 0.4 * s_)), 0.02, "figure"))

    def ordered(prefix):
        ks = sorted((int(n[len(prefix):]), n) for n in idx if n and n.startswith(prefix) and n[len(prefix):].isdigit())
        return [pos(n) for _, n in ks]
    for p in ordered("barricade."):
        figure(p)
    for lane in ("road", "corn", "trees"):
        pts = ordered(f"lane.{lane}.")
        start = len(pts) - 2 if lane == "corn" else 1
        for p in pts[max(0, start):]:
            if math.hypot(p[0] - eye[0], p[2] - eye[2]) < 60:
                figure(p)
    for sp in ("bus", "booth", "fence"):
        if f"spawn.{sp}" in idx:
            for p in ordered(f"spawn.{sp}.path."):
                if math.hypot(p[0] - eye[0], p[2] - eye[2]) < 60:
                    figure(p)
    n = 1
    while f"path.survivor.{n}.1" in idx:
        for p in ordered(f"path.survivor.{n}."):
            out.append((*to_eye((p[0], p[1] + 1.6, p[2])), 0.02, "survivor"))
        n += 1
    for name in [f"secret.sign.{l}" for l in ("G", "A1", "S1", "amp", "E", "A2", "T", "S2")] + \
            ["secret.booth.light", "secret.radio", "secret.duck", "secret.scarecrow", "secret.drivein.lamp"]:
        if name in idx:
            i = idx[name]
            c = mesh_centre(g, i, xf)[0] if "mesh" in nodes[i] else pos(name)
            out.append((*to_eye(c), 0.01, name))
    for p in ordered("secret.cat.spot."):
        out.append((*to_eye((p[0], p[1] + 0.18, p[2])), 0.01, "cat"))
    if "moon.disc" in idx:
        c, r = mesh_centre(g, idx["moon.disc"], xf)
        cx, cy_, cz = to_eye(c)
        r *= 0.75
        for dx, dy in ((r, 0), (-r, 0), (0, r), (0, -r)):
            out.append((cx + dx, cy_ + dy, cz, 0.01, "moon"))
    return out


def fits(sights, fov, aspect, pitch_range=(-1.0, 6.0)):
    """True with the pitch if every sight is on screen at this vertical fov."""
    tv = math.tan(math.radians(fov) / 2)
    th = tv * aspect
    p = pitch_range[0]
    while p <= pitch_range[1] + 1e-9:
        c, s_ = math.cos(math.radians(p)), math.sin(math.radians(p))
        ok = True
        for x, y, z, m, _ in sights:
            # the camera pitched up by p: rotate the point down by p
            y2 = y * c - (-z) * s_
            f2 = (-z) * c + y * s_
            if f2 <= 0 or abs(x / f2) / th > 1 - m or abs(y2 / f2) / tv > 1 - m:
                ok = False
                break
        if ok:
            return True, p
        p += 0.25
    return False, None


def check_frame(fov_road, aspect):
    """engine/world/framing.ts checkFraming: widened below 4:3."""
    if aspect >= 4 / 3:
        return fov_road
    t = math.tan(math.radians(fov_road) / 2) * (4 / 3) / max(0.2, aspect)
    return math.degrees(2 * math.atan(t))


def webp_alpha_problem(data):
    """None if the WebP carries no alpha, or alpha that is opaque
    everywhere; otherwise a description. A WebP encoder throws away the
    colour under zero alpha unless told `exact`, so a texture storing data
    in its channels must not carry alpha."""
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return "not a WebP"
    kind = data[12:16]
    has_alpha = (kind == b"VP8X" and data[20] & 0x10) or (kind == b"VP8L" and (struct.unpack_from("<I", data, 21)[0] >> 28) & 1)
    if not has_alpha:
        return None
    try:
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(data))
        if "A" not in im.mode:
            return None
        lo = min(im.getchannel("A").getdata())
        return None if lo == 255 else f"alpha down to {lo}: colour under it may be lost"
    except ImportError:
        return "carries an alpha channel (PIL not available to prove it opaque)"


def embedded_images(g, path):
    with open(path, "rb") as f:
        raw = f.read()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    bin_off = 12 + 8 + jlen + 8
    for im in g.get("images", []):
        bv = g["bufferViews"][im["bufferView"]]
        yield im.get("name"), raw[bin_off + bv.get("byteOffset", 0): bin_off + bv.get("byteOffset", 0) + bv["byteLength"]]


def webp_size(b):
    kind = b[12:16]
    if kind == b"VP8 ":
        return struct.unpack_from("<H", b, 26)[0] & 0x3FFF, struct.unpack_from("<H", b, 28)[0] & 0x3FFF
    if kind == b"VP8L":
        bits = struct.unpack_from("<I", b, 21)[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X":
        return 1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little")
    return None, None


def check_road(path):
    R = Report(os.path.basename(path))
    g, size, binlen = load(path)
    nodes = g["nodes"]
    names = {}
    for i, n in enumerate(nodes):
        names.setdefault(n.get("name"), n)
    ex = lambda n: names[n].get("extras", {}) if n in names else {}
    folder = os.path.dirname(path)
    cam = names.get("camera.player")
    R.need(cam is not None and "camera" in cam, "camera.player missing or not a camera")
    if cam:
        R.need(40 <= cam.get("extras", {}).get("fov_deg", 0) <= 55, "camera.player fov_deg")
    for n in ("moon", "moon.disc", "light.street", "light.neon", "ground.shadow", "corn", "street.lamp"):
        R.need(n in names, f"{n} missing")
    R.need(isinstance(ex("moon").get("direction"), list), "moon extras.direction missing")
    R.need("mesh" in names.get("moon.disc", {}), "moon.disc is not a mesh")
    R.need("mesh" in names.get("street.lamp", {}), "street.lamp is not a mesh")
    motel = [n for n in names if n and n.startswith("light.motel.")]
    R.need(len(motel) >= 1, "no light.motel.<n>")
    for lane in ("road", "corn", "trees"):
        pts = sorted(int(n.split(".")[-1]) for n in names if n and n.startswith(f"lane.{lane}.") and n.split(".")[-1].isdigit())
        R.need(len(pts) >= 4 and pts == list(range(1, len(pts) + 1)), f"lane.{lane}.<n> not 1..n ({pts})")
        R.need(isinstance(ex(f"lane.{lane}.1").get("spread"), (int, float)), f"lane.{lane}.1 has no spread")
    for sp in ("bus", "booth", "fence"):
        R.need(f"spawn.{sp}" in names, f"spawn.{sp} missing")
        R.need(isinstance(ex(f"spawn.{sp}").get("spread"), (int, float)), f"spawn.{sp} has no spread")
        pts = [n for n in names if n and n.startswith(f"spawn.{sp}.path.")]
        R.need(len(pts) >= 2, f"spawn.{sp}.path.<n> missing")
    runs = sorted({n.split(".")[2] for n in names if n and n.startswith("path.survivor.")})
    R.need(len(runs) >= 1, "no path.survivor.<n>.<k>")
    for r_ in runs:
        ks = [n for n in names if n and n.startswith(f"path.survivor.{r_}.")]
        R.need(len(ks) >= 2 and f"path.survivor.{r_}.1" in names, f"path.survivor.{r_} has {len(ks)} points")
    bar = [n for n in names if n and n.startswith("barricade.") and n.split(".")[-1].isdigit()]
    R.need(len(bar) >= 4, f"only {len(bar)} barricade.<n>")
    for i in range(1, 10):
        R.need(f"calib.{i}" in names, f"calib.{i} missing")
    for s_ in ROAD_SECRETS:
        R.need(s_ in names, f"{s_} missing")
    cats = [n for n in names if n and n.startswith("secret.cat.spot.")]
    R.need(len(cats) >= 3, f"only {len(cats)} secret.cat.spot.<n>")
    head = names.get("secret.scarecrow.head")
    sc = names.get("secret.scarecrow")
    if head is not None and sc is not None:
        R.need(nodes.index(head) in sc.get("children", []), "secret.scarecrow.head is not a child of secret.scarecrow")
    # the cat's perches: more than 1.2 m from every other secret (how the game tells them apart)
    xf = world_transforms(g)
    idx = {n.get("name"): i for i, n in enumerate(nodes)}
    secret_at = {}
    for n in idx:
        if n and n.startswith(("secret.", "moon.disc")) and not n.startswith("secret.cat."):
            i = idx[n]
            secret_at[n] = mesh_centre(g, i, xf)[0] if "mesh" in nodes[i] else xf[i][0]
    for c in cats:
        p = xf[idx[c]][0]
        d, who = min((math.dist(p, q), n) for n, q in secret_at.items())
        R.need(d > 1.2, f"{c} is {d:.2f} m from {who} (the game needs > 1.2 m)")
    corn = names.get("corn")
    if corn:
        kids = [nodes[i] for i in corn.get("children", [])]
        R.need(len(kids) >= 1, "corn has no meshes")
        for k in kids:
            m = g["meshes"][k["mesh"]]
            for pr in m["primitives"]:
                a = pr["attributes"]
                for want in ("COLOR_0", "_ALBEDO", "_SWAY", "_FLICKER"):
                    R.need(want in a or any(x.upper() == want for x in a), f"{k.get('name')}: no {want} ({list(a)})")
                mat = g["materials"][pr["material"]]
                R.need(mat.get("extras", {}).get("bake") == "vertex", f"{mat['name']}: extras.bake != 'vertex'")
    # surfaces and triangles
    tris = 0
    for n in nodes:
        if "mesh" in n:
            s_ = n.get("extras", {}).get("surface")
            R.need(s_ in SURFACES, f"{n.get('name')}: surface extra {s_!r}")
            tris += tris_of_mesh(g, n["mesh"])
    # the baked materials as the game reads them (stage.ts): unlit, `lit` as
    # the base map, extras naming the albedo and flicker files beside the GLB
    mats = g.get("materials", [])
    baked = [m for m in mats if m.get("name", "").startswith("night.") and m["name"] not in ("night.corn", "night.moon")]
    R.need(len(baked) >= 5, f"only {len(baked)} baked materials")
    side_bytes = 0
    seen_files = set()
    for m in mats:
        if m.get("name") in ("night.moon", "ground_shadow"):
            continue
        e = m.get("extras", {})
        R.need(e.get("surface") in SURFACES, f"{m.get('name')}: extras.surface {e.get('surface')!r}")
        R.need(isinstance(e.get("glow"), (int, float)), f"{m.get('name')}: extras.glow missing")
    for m in baked:
        e = m.get("extras", {})
        pbr = m.get("pbrMetallicRoughness", {})
        R.need("KHR_materials_unlit" in m.get("extensions", {}), f"{m['name']}: not unlit")
        R.need("baseColorTexture" in pbr, f"{m['name']}: no baseColorTexture (lit)")
        for key in ("albedo", "flicker"):
            fn = e.get(key)
            if fn is None:
                R.need(key != "albedo", f"{m['name']}: extras.albedo missing")
                continue
            fp = os.path.join(folder, fn)
            R.need(os.path.exists(fp), f"{m['name']}: {key} file {fn} missing")
            if os.path.exists(fp) and fn not in seen_files:
                seen_files.add(fn)
                side_bytes += os.path.getsize(fp)
    sx = g["scenes"][g.get("scene", 0)].get("extras", {})
    R.need(isinstance(sx.get("fog_color"), str) and sx["fog_color"].startswith("#"), "scene fog_color")
    R.need(isinstance(sx.get("fog_density"), (int, float)), "scene fog_density")
    R.need(isinstance(sx.get("flicker_scale"), (int, float)), "scene flicker_scale")
    R.need(isinstance(sx.get("layers"), dict), "scene layers doc")
    R.need(size + side_bytes <= 14e6, f"road.glb + its layers {(size + side_bytes) / 1e6:.2f} MB > 14 MB budget")
    # every WebP, in the GLB and beside it: no alpha that could eat its colour
    for name, data in embedded_images(g, path):
        prob = webp_alpha_problem(data)
        R.need(prob is None, f"{name}: {prob}")
    for fn in sorted(seen_files):
        with open(os.path.join(folder, fn), "rb") as fh:
            data = fh.read()
        prob = webp_alpha_problem(data)
        R.need(prob is None, f"{fn}: {prob}")
    # the play view: every sight the game frames fits the widest framing it
    # allows, at 16:9 and at the narrowest stage (1.2:1)
    fov_road = cam.get("extras", {}).get("fov_deg", 45) if cam else 45
    all_sights = play_sights(g)
    # The radio is the one sight that is not everywhere: it is behind the
    # diner's window at the right edge (the design's "visible at the right
    # edge"), 32.6 degrees right - on screen from about 1.5:1, and the pump
    # hides every closer place inside the diner (see art/night/README.md)
    WIDE_ONLY = {"secret.radio"}
    for label, aspect in (("16:9", 16 / 9), ("4:3", 4 / 3), ("1.2:1", 1.2)):
        widest = max(fov_road, check_frame(fov_road, aspect))
        sights = all_sights
        if aspect < 1.5:
            sights = [s_ for s_ in all_sights if s_[4] not in WIDE_ONLY]
            if not fits(all_sights, widest, aspect)[0]:
                R.note(f"play view {label}: secret.radio is off screen (wide-only secret, documented)")
        ok, pitch = fits(sights, widest, aspect)
        tight = next((f / 4 for f in range(120, int(widest * 4) + 1) if fits(sights, f / 4, aspect)[0]), None)
        if not ok:
            worst = max(sights, key=lambda s: abs(s[0] / -s[2]))
            R.need(False, f"play view {label}: not every sight fits at fov {widest:.1f} (widest: {worst[4]} at "
                          f"{math.degrees(math.atan2(worst[0], -worst[2])):.1f} deg)")
        else:
            R.note(f"play view {label}: all {len(sights)} sights fit; tightest vertical fov {tight} (widest allowed {widest:.1f})")
    imgs = image_sizes(g, path)
    R.note(f"file {size / 1e6:.2f} MB + layers beside it {side_bytes / 1e6:.2f} MB (budget 14), triangles {tris:,}")
    R.note(f"nodes {len(nodes)}, meshes {len(g.get('meshes', []))}, materials {len(mats)}, extensions {g.get('extensionsUsed')}")
    tex = sum(b for _, b, _, _, _ in imgs)
    R.note(f"images {len(imgs)} ({tex / 1e6:.2f} MB): " + ", ".join(f"{n} {w}x{h}" for n, b, w, h, _ in imgs))
    R.note(f"side layers: {', '.join(sorted(seen_files))}")
    R.note(f"fog {sx.get('fog_color')} density {sx.get('fog_density')}, flicker_scale {sx.get('flicker_scale')}")
    return R.done()


def skin_bones(g):
    out = set()
    for sk in g.get("skins", []):
        for j in sk["joints"]:
            out.add(g["nodes"][j].get("name"))
    return out


def check_character(path, clips, needs, tri_range=(10000, 18000), dressed=None):
    R = Report(os.path.basename(path))
    g, size, binlen = load(path)
    nodes = g["nodes"]
    names = {n.get("name"): n for n in nodes}
    bones = skin_bones(g)
    if needs.get("humanoid", True):
        for b in BONES:
            R.need(b in bones, f"bone {b} missing")
    anims = {a.get("name") for a in g.get("animations", [])}
    for c in clips:
        R.need(c in anims, f"clip {c} missing")
    for n in needs.get("nodes", []):
        R.need(n in names, f"{n} missing")
    for n, parent in needs.get("parented", []):
        if n in names and parent in names:
            idx = nodes.index(names[n])
            R.need(idx in names[parent].get("children", []), f"{n} is not a child of {parent}")
    # no node named like a bone besides the bones
    meshes = {n.get("name"): n for n in nodes if "mesh" in n}
    for b in BONES:
        R.need(b not in meshes, f"a mesh is named like bone {b}")
    tri = {nm: tris_of_mesh(g, n["mesh"]) for nm, n in meshes.items()}
    if dressed:
        for label, parts in dressed.items():
            t = sum(tri.get(p, 0) for p in parts)
            miss = [p for p in parts if p not in tri]
            R.need(not miss, f"{label}: missing {miss}")
            R.need(tri_range[0] * 0.5 <= t <= tri_range[1], f"{label}: {t} triangles (budget {tri_range})")
            R.note(f"{label}: {t:,} tris")
    imgs = image_sizes(g, path)
    for n, b, w, h, _ in imgs:
        R.need(w is None or max(w, h) <= needs.get("max_tex", 1024), f"image {n} {w}x{h} > {needs.get('max_tex', 1024)}")
    for n, data in embedded_images(g, path):
        prob = webp_alpha_problem(data)
        R.need(prob is None, f"image {n}: {prob}")
    lens = {a.get("name"): max((g["accessors"][s["input"]].get("max", [0])[0] for s in a["samplers"]), default=0)
            for a in g.get("animations", [])}
    R.note(f"file {size / 1024:.0f} KB, meshes: " + ", ".join(f"{k} {v}" for k, v in sorted(tri.items())))
    R.note("images: " + ", ".join(f"{n} {w}x{h} {b // 1024}KB" for n, b, w, h, _ in imgs))
    R.note("clips: " + ", ".join(f"{k} {v:.2f}s" for k, v in sorted(lens.items())))
    return R.done()


def main():
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    ok = True
    files = {
        "road.glb": lambda p: check_road(p),
        "walker.glb": lambda p: check_character(p, WALKER_CLIPS, dict(
            nodes=["char.walker", "eyes"] + [f"var.outfit.{o}" for o in OUTFITS] + ["char.runner", "char.bloater", "char.crawler"],
            max_tex=2048),
            dressed={**{f"walker+{o}": ["char.walker", f"var.outfit.{o}", "eyes"] for o in OUTFITS},
                     **{k: [f"char.{k}", "eyes"] for k in ("runner", "bloater", "crawler")}}),
        "mechanic.glb": lambda p: check_character(p, MECH_CLIPS, dict(
            nodes=["char.mechanic", "var.mask", "socket.weapon", "prop.tyre_iron", "eyes"],
            parented=[("prop.tyre_iron", "socket.weapon")]),
            dressed={"mechanic masked": ["char.mechanic", "var.mask", "prop.tyre_iron", "eyes"]}),
        "survivor.glb": lambda p: check_character(p, SURVIVOR_CLIPS, dict(
            nodes=["var.person.daughter", "var.person.owner", "socket.lantern", "prop.lantern", "lantern.flame"],
            parented=[("prop.lantern", "socket.lantern"), ("lantern.flame", "prop.lantern")]),
            dressed={"daughter": ["var.person.daughter", "prop.lantern"], "owner": ["var.person.owner", "prop.lantern"]}),
        "cat.glb": lambda p: check_character(p, CAT_CLIPS, dict(humanoid=False, nodes=["char.cat", "eyes"], max_tex=1024),
                                             tri_range=(800, 8000), dressed={"cat": ["char.cat", "eyes"]}),
    }
    for fn, check in files.items():
        if only and fn not in only and not any(os.path.basename(o) == fn for o in only):
            continue
        p = os.path.join(ASSETS, fn)
        if not os.path.exists(p):
            print(f"\n== {fn}: MISSING")
            ok = False
            continue
        ok &= bool(check(p))
    for extra in ("sky.webp", "poster.webp"):
        p = os.path.join(ASSETS, extra)
        if only and extra not in only:
            continue
        if not os.path.exists(p):
            print(f"\n== {extra}: MISSING")
            ok = False
            continue
        with open(p, "rb") as fh:
            data = fh.read()
        prob = webp_alpha_problem(data)
        w, h = webp_size(data)
        print(f"\n== {extra}: {len(data) / 1024:.0f} KB, {w}x{h}, " + ("no alpha" if prob is None else f"ALPHA PROBLEM: {prob}"))
        ok &= prob is None
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
