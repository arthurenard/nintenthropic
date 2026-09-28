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
MECH_CLIPS = WALKER_CLIPS + ["roar", "mask_off", "swing"]
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


def check_road(path):
    R = Report(os.path.basename(path))
    g, size, binlen = load(path)
    nodes = g["nodes"]
    names = {}
    for i, n in enumerate(nodes):
        names.setdefault(n.get("name"), n)
    ex = lambda n: names[n].get("extras", {}) if n in names else {}
    R.need(size <= 14e6, f"file {size / 1e6:.2f} MB > 14 MB budget")
    cam = names.get("camera.player")
    R.need(cam is not None and "camera" in cam, "camera.player missing or not a camera")
    if cam:
        R.need(40 <= cam.get("extras", {}).get("fov_deg", 0) <= 55, "camera.player fov_deg")
    for n in ("moon", "moon.disc", "light.street", "light.neon", "ground.shadow", "corn"):
        R.need(n in names, f"{n} missing")
    R.need(isinstance(ex("moon").get("direction"), list), "moon extras.direction missing")
    R.need("mesh" in names.get("moon.disc", {}), "moon.disc is not a mesh")
    motel = [n for n in names if n and n.startswith("light.motel.")]
    R.need(len(motel) >= 1, "no light.motel.<n>")
    for lane in ("road", "corn", "trees"):
        pts = sorted(int(n.split(".")[-1]) for n in names if n and n.startswith(f"lane.{lane}.") and n.split(".")[-1].isdigit())
        R.need(len(pts) >= 4 and pts == list(range(1, len(pts) + 1)), f"lane.{lane}.<n> not 1..n ({pts})")
    for sp in ("bus", "booth", "fence"):
        R.need(f"spawn.{sp}" in names, f"spawn.{sp} missing")
        pts = [n for n in names if n and n.startswith(f"spawn.{sp}.path.")]
        R.need(len(pts) >= 2, f"spawn.{sp}.path.<n> missing")
    bar = [n for n in names if n and n.startswith("barricade.") and n.split(".")[-1].isdigit()]
    R.need(len(bar) >= 4, f"only {len(bar)} barricade.<n>")
    for i in range(1, 10):
        R.need(f"calib.{i}" in names, f"calib.{i} missing")
    for s in ROAD_SECRETS:
        R.need(s in names, f"{s} missing")
    cats = [n for n in names if n and n.startswith("secret.cat.spot.")]
    R.need(len(cats) >= 3, f"only {len(cats)} secret.cat.spot.<n>")
    head = names.get("secret.scarecrow.head")
    sc = names.get("secret.scarecrow")
    if head is not None and sc is not None:
        idx = nodes.index(head)
        R.need(idx in sc.get("children", []), "secret.scarecrow.head is not a child of secret.scarecrow")
    corn = names.get("corn")
    if corn:
        kids = [nodes[i] for i in corn.get("children", [])]
        R.need(len(kids) >= 1, "corn has no meshes")
        for k in kids:
            m = g["meshes"][k["mesh"]]
            for p in m["primitives"]:
                a = p["attributes"]
                for want in ("COLOR_0", "_ALBEDO", "_SWAY"):
                    R.need(want in a or any(x.upper() == want for x in a), f"{k.get('name')}: no {want} ({list(a)})")
    # surfaces and triangles
    tris = 0
    for n in nodes:
        if "mesh" in n:
            s = n.get("extras", {}).get("surface")
            R.need(s in SURFACES, f"{n.get('name')}: surface extra {s!r}")
            tris += tris_of_mesh(g, n["mesh"])
    # layers on the baked materials
    baked = [m for m in g.get("materials", []) if m.get("name", "").startswith("night.") and m["name"] not in ("night.corn", "night.moon")]
    R.need(len(baked) >= 5, f"only {len(baked)} baked materials")
    for m in baked:
        pbr = m.get("pbrMetallicRoughness", {})
        R.need("emissiveTexture" in m, f"{m['name']}: no emissiveTexture (lit)")
        R.need("baseColorTexture" in pbr, f"{m['name']}: no baseColorTexture (albedo)")
        R.need("occlusionTexture" in m, f"{m['name']}: no occlusionTexture (flicker)")
        R.need("metallicRoughnessTexture" in pbr, f"{m['name']}: no metallicRoughnessTexture")
        R.need(m.get("emissiveFactor", [0, 0, 0]) == [1.0, 1.0, 1.0], f"{m['name']}: emissiveFactor {m.get('emissiveFactor')}")
        R.need("KHR_materials_unlit" not in m.get("extensions", {}), f"{m['name']}: must not be unlit")
    sx = g["scenes"][g.get("scene", 0)].get("extras", {})
    R.need(isinstance(sx.get("fog_color"), str) and sx["fog_color"].startswith("#"), "scene fog_color")
    R.need(isinstance(sx.get("fog_density"), (int, float)), "scene fog_density")
    R.need(isinstance(sx.get("layers"), dict), "scene layers doc")
    imgs = image_sizes(g, path)
    R.note(f"file {size / 1e6:.2f} MB (budget 14), binary {binlen / 1e6:.2f} MB, triangles {tris:,}")
    R.note(f"nodes {len(nodes)}, meshes {len(g.get('meshes', []))}, materials {len(g.get('materials', []))}, "
           f"extensions {g.get('extensionsUsed')}")
    tex = sum(b for _, b, _, _, _ in imgs)
    R.note(f"images {len(imgs)} ({tex / 1e6:.2f} MB): " + ", ".join(f"{n} {w}x{h}" for n, b, w, h, _ in imgs))
    R.note(f"fog {sx.get('fog_color')} density {sx.get('fog_density')}")
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
            nodes=["char.walker", "eyes"] + [f"var.outfit.{o}" for o in OUTFITS] + ["var.runner", "var.bloater", "char.crawler"],
            max_tex=2048),
            dressed={f"walker+{o}": ["char.walker", f"var.outfit.{o}", "eyes"] for o in OUTFITS}),
        "mechanic.glb": lambda p: check_character(p, MECH_CLIPS, dict(
            nodes=["char.mechanic", "var.mask", "socket.weapon", "prop.tyre_iron", "eyes"],
            parented=[("prop.tyre_iron", "socket.weapon")]),
            dressed={"mechanic masked": ["char.mechanic", "var.mask", "prop.tyre_iron", "eyes"]}),
        "survivor.glb": lambda p: check_character(p, SURVIVOR_CLIPS, dict(
            nodes=["var.person.daughter", "var.person.owner", "socket.lantern", "prop.lantern", "prop.lantern.flame"],
            parented=[("prop.lantern", "socket.lantern")]),
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
        print(f"\n== {extra}: " + (f"{os.path.getsize(p) / 1024:.0f} KB" if os.path.exists(p) else "MISSING"))
        ok &= os.path.exists(p)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
