"""Check Overwatch Ridge's assets against the contract in docs/OVERWATCH_RIDGE.md
(plain Python 3, no Blender, no numpy):

    python3 art/ridge/check.py [valley|sky|soldier|civilian|vehicles|animals|poster ...]

With no argument every file in public/assets/ridge/ is checked. Proves every
contract node, extra, bone, clip and budget the game builds against, prints
sizes and triangle counts, and exits non-zero on any contract error.
"""

import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbtool import GLB, glb_images, image_size  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSETS = os.path.join(REPO, "public", "assets", "ridge")

SURFACES = {"grass", "rock", "snow", "dirt", "stone", "wood", "metal", "glass", "water", "cloth"}
BONES = ["hips", "spine", "chest", "neck", "head",
         "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
         "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
         "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]
SOLDIER_CLIPS = ["idle", "idle_smoke", "look_binoculars", "walk", "patrol_walk", "run", "crouch", "prone",
                 "prone_aim", "aim", "fire", "hit_body", "wound_kneel", "death_back", "death_forward",
                 "death_crumple", "dismount", "drive"]
SOLDIER_NODES = ["var.helmet", "var.cap.officer", "var.ghillie", "var.pack",
                 "gun.rifle", "gun.mg", "prop.binoculars", "prop.cigarette", "socket.gun"]
CIVILIAN_CLIPS = ["idle", "walk", "cycle", "wave", "panic", "duck"]
CIVILIAN_NODES = ["var.person.farmer", "var.person.cyclist", "var.person.shepherd", "var.person.child"]
VEHICLE_PARTS = ["cab.glass", "engine", "seat.driver"]
ANIMAL_CLIPS = {
    "cow": ["graze", "walk", "look_up"],
    "sheep": ["graze", "walk"],
    "goat": ["stand", "hop", "bleat"],
    "eagle": ["glide", "flap", "land"],
    "dog": ["idle", "walk", "run"],
}
POST_KINDS = {"sentry", "tower", "gunner", "guard"}
SECRETS = ["secret.bell", "secret.cheese", "secret.cart.wedge", "secret.yeti", "secret.yeti.rock",
           "secret.siren", "secret.cliff"]
PERSON_TRIS = (10000, 18000)
VALLEY_BUDGET_MB = 30.0


class Report:
    def __init__(self, title):
        self.title = title
        self.errors = []
        self.warnings = []
        self.lines = []

    def need(self, cond, msg):
        if not cond:
            self.errors.append(msg)
        return cond

    def warn(self, cond, msg):
        if not cond:
            self.warnings.append(msg)
        return cond

    def info(self, msg):
        self.lines.append(msg)

    def show(self):
        print(f"\n== {self.title}")
        for l in self.lines:
            print("  " + l)
        for w in self.warnings:
            print("  warning: " + w)
        for e in self.errors:
            print("  ERROR: " + e)
        print("  " + ("contract OK" if not self.errors else f"{len(self.errors)} contract error(s)"))
        return not self.errors


def sequence(names, prefix):
    """Waypoints prefix.1 .. prefix.N (consecutive, from 1)."""
    rx = re.compile("^" + re.escape(prefix) + r"\.(\d+)$")
    idx = sorted(int(m.group(1)) for n in names if n and (m := rx.match(n)))
    ok = idx == list(range(1, len(idx) + 1))
    return idx, ok


def node_pos(n):
    return n.get("translation", [0.0, 0.0, 0.0])


def world_positions(g):
    """World translation of every node (TRS only; rotations applied)."""
    import functools
    par = g.parents()

    def qrot(q, v):
        x, y, z, w = q
        # v' = v + 2w(q x v) + 2 q x (q x v)
        cx = y * v[2] - z * v[1]
        cy = z * v[0] - x * v[2]
        cz = x * v[1] - y * v[0]
        cx2 = y * cz - z * cy
        cy2 = z * cx - x * cz
        cz2 = x * cy - y * cx
        return [v[0] + 2 * (w * cx + cx2), v[1] + 2 * (w * cy + cy2), v[2] + 2 * (w * cz + cz2)]

    @functools.lru_cache(maxsize=None)
    def xf(i):
        n = g.nodes[i]
        t = n.get("translation", [0, 0, 0])
        r = n.get("rotation", [0, 0, 0, 1])
        s = n.get("scale", [1, 1, 1])
        if i in par:
            pt, pr, ps = xf(par[i])
            v = [t[0] * ps[0], t[1] * ps[1], t[2] * ps[2]]
            v = qrot(pr, v)
            return (tuple(pt[k] + v[k] for k in range(3)), pr, ps)
        return (tuple(t), r, s)
    return {i: xf(i)[0] for i in range(len(g.nodes))}


def dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def clip_rates(g):
    """{animation name: (duration s, samples per second)}"""
    out = {}
    for a in g.json.get("animations", []):
        best = (0.0, 0.0)
        for s in a["samplers"]:
            acc = g.json["accessors"][s["input"]]
            if "max" in acc and acc["count"] > 1:
                dur = acc["max"][0] - acc["min"][0]
                if dur > best[0]:
                    best = (dur, (acc["count"] - 1) / dur if dur > 0 else 0.0)
        out[a.get("name")] = best
    return out


def _decode_rgba(data):
    """Pixels of an image file as RGBA bytes, or None without Pillow (the
    checker otherwise needs nothing but Python)."""
    try:
        from PIL import Image
    except ImportError:
        return None
    import io
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    return im.width, im.height, im.tobytes()


def transparent_colour(r, name, data):
    """WebP (and some PNG) encoders throw away the colour under a fully
    transparent texel. The splat maps keep a weight there, the impostors
    their bled border: no texel may have alpha 0 (the exporter floors it at
    1/255). Returns the decoded pixels (or None without Pillow)."""
    px = _decode_rgba(data)
    if px is None:
        r.warn(False, f"{name}: Pillow missing, transparent texels not checked")
        return None
    w, h, b = px
    idx = range(3, len(b), 4 * 97)            # a sparse sample: pure Python
    a0 = sum(1 for i in idx if b[i] == 0)
    r.need(a0 == 0, f"{name}: {a0}/{len(idx)} sampled texels have alpha 0 (their colour is lost in WebP)")
    # and the colour under a nearly transparent texel is still there (not
    # zeroed, not divided by the alpha on the way out)
    low = [i for i in idx if b[i] < 8]
    if len(low) > 20:
        mean = sum(b[i - 3] + b[i - 2] + b[i - 1] for i in low) / (3 * len(low))
        r.need(mean > 3, f"{name}: the colour under its transparent texels is black (mean {mean:.1f})")
    return px


def splat_weights(r, p0, p1):
    """The eight weights of splat0 + splat1 sum to 1 at every texel: if the
    colour under a transparent texel were lost, they would not."""
    if p0 is None or p1 is None or len(p0[2]) != len(p1[2]):
        return
    b0, b1 = p0[2], p1[2]
    bad = cnt = 0
    for i in range(0, len(b0), 4 * 97):
        ssum = b0[i] + b0[i + 1] + b0[i + 2] + b0[i + 3] + b1[i] + b1[i + 1] + b1[i + 2] + b1[i + 3]
        cnt += 1
        bad += not (215 <= ssum <= 300)
    r.info(f"splat weights: {cnt - bad}/{cnt} sampled texels sum to 1 +- 0.15")
    r.need(bad <= cnt * 0.01, f"splat maps: {bad}/{cnt} sampled texels' eight weights do not sum to ~1")


def textures_report(r, g, max_side=None):
    for name, w, h, fmt, size in glb_images(g):
        r.info(f"image {name}: {w}x{h} {fmt} {size / 1024:.0f} KB")
        if max_side and w and h:
            r.need(max(w, h) <= max_side, f"image {name} {w}x{h} exceeds {max_side}px")
    # every embedded image with an alpha channel keeps its colour under it
    for im in g.json.get("images", []):
        if "bufferView" not in im:
            continue
        bv = g.json["bufferViews"][im["bufferView"]]
        off = bv.get("byteOffset", 0)
        data = bytes(g.bin[off: off + bv["byteLength"]])
        px = _decode_rgba(data)
        if px is None:
            continue
        if any(px[2][i] < 255 for i in range(3, len(px[2]), 4 * 131)):
            transparent_colour(r, f"image {im.get('name')}", data)


def skinned_meshes(g):
    return [n for n in g.nodes if "mesh" in n and "skin" in n]


def check_bones(r, g):
    skins = g.json.get("skins", [])
    if not r.need(skins, "no skin"):
        return
    for sk in skins:
        names = [g.nodes[j].get("name") for j in sk["joints"]]
        missing = [b for b in BONES if b not in names]
        r.need(not missing, f"skin {sk.get('name')} misses bones {missing}")
    bone_set = set(BONES)
    joint_nodes = {j for sk in skins for j in sk["joints"]}
    for i, n in enumerate(g.nodes):
        if i not in joint_nodes and n.get("name") in bone_set:
            r.need(False, f"node {n.get('name')} shares a bone's name")


def check_clips(r, g, wanted, fps=30.0):
    rates = clip_rates(g)
    have = sorted(rates)
    r.info(f"clips ({len(have)}): " + ", ".join(f"{k} {rates[k][0]:.2f}s" for k in have))
    for c in wanted:
        if r.need(c in rates, f"clip {c} missing"):
            dur, hz = rates[c]
            r.warn(abs(hz - fps) < 1.5 or dur == 0, f"clip {c} sampled at {hz:.1f}/s, not {fps}")


def person_tris(g, body, extras_names):
    idx = g.node_index(body)
    if idx is None or "mesh" not in g.nodes[idx]:
        return None
    t = g.mesh_triangles(g.nodes[idx]["mesh"])
    for n in extras_names:
        j = g.node_index(n)
        if j is not None and "mesh" in g.nodes[j]:
            t += g.mesh_triangles(g.nodes[j]["mesh"])
    return t


def mesh_tris_by_name(g):
    out = {}
    for n in g.nodes:
        if "mesh" in n:
            out[n.get("name")] = g.mesh_triangles(n["mesh"])
    return out


# ---------------------------------------------------------------------------

def check_valley(path):
    r = Report(f"valley.glb  ({path})")
    if not r.need(os.path.exists(path), "valley.glb missing"):
        return r
    g = GLB.load(path)
    names = [n.get("name") for n in g.nodes]
    nameset = set(names)
    by = {n.get("name"): n for n in g.nodes}
    wp = world_positions(g)
    pos = {g.nodes[i].get("name"): wp[i] for i in wp}
    size = os.path.getsize(path)

    cam = by.get("camera.player")
    if r.need(cam is not None and "camera" in cam, "camera.player missing or not a camera"):
        fov = cam.get("extras", {}).get("fov_deg", 0)
        r.need(30 <= fov <= 60, f"camera.player extras.fov_deg {fov} out of range")
        r.need(dist(pos["camera.player"], (0, 0, 0)) < 0.01, "camera.player not at the origin")
    r.need("sun" in nameset, "sun missing")
    r.need("terrain" in nameset, "terrain missing")
    r.need("terrain.splat" in nameset, "terrain.splat missing")
    # textures the terrain shader reads, beside the glb
    tex_total = 0
    tex_dir = os.path.dirname(path)
    ex = by.get("terrain.splat", {}).get("extras", {})
    files = ex.get("files", {})
    r.need(bool(files), "terrain.splat extras.files missing")
    decoded = {}
    for key, rel in sorted(files.items()):
        fp = os.path.join(tex_dir, rel)
        if r.need(os.path.exists(fp), f"terrain texture {key}: {rel} missing"):
            if key in ("splat0", "splat1", "light"):
                decoded[key] = transparent_colour(r, f"terrain/{key}", open(fp, "rb").read())
            with open(fp, "rb") as f:
                w, h, fmt = image_size(f.read(64))
            sz = os.path.getsize(fp)
            tex_total += sz
            r.info(f"texture {key:16s} {rel:34s} {w}x{h} {fmt} {sz / 1024:.0f} KB")
    splat_weights(r, decoded.get("splat0"), decoded.get("splat1"))
    for w in ("water.river", "water.reservoir"):
        n = by.get(w)
        if r.need(n is not None, f"{w} missing"):
            r.need("mesh" in n or n.get("children"), f"{w} has no mesh")
    # forest
    species = sorted({n.split(".")[1] for n in names if n and n.startswith("forest.") and n.count(".") >= 1})
    r.need("fir" in species and "larch" in species, f"forest species {species}: need fir and larch")
    inst_total = 0
    per_species = {}
    for i, n in enumerate(g.nodes):
        nm = n.get("name") or ""
        if nm.startswith("forest.") and "EXT_mesh_gpu_instancing" in n.get("extensions", {}):
            c = g.instance_count(n)
            inst_total += c
            sp = nm.split(".")[1]
            per_species[sp] = per_species.get(sp, 0) + c
    r.info(f"forest: {inst_total} instanced trees " + str(per_species))
    r.need(inst_total >= 2000, f"only {inst_total} instanced trees")
    # paths
    for p, least in (("path.road", 10), ("path.dam", 2), ("path.patrol", 2), ("path.farmer", 2),
                     ("path.cyclist", 2), ("path.shepherd", 2), ("path.cheese", 2),
                     ("secret.duck.path", 2), ("eagle.path", 3), ("animals.cows", 3), ("animals.sheep", 3),
                     ("secret.goat", 2)):
        idx, ok = sequence(names, p)
        r.need(len(idx) >= least, f"{p}.<n>: {len(idx)} found, need {least}")
        r.need(ok, f"{p}.<n> not numbered 1..N: {idx}")
    r.need("tunnel" in nameset, "tunnel missing")
    idx, _ = sequence(names, "path.dam")
    if idx and "tunnel" in pos:
        d = dist(pos[f"path.dam.{idx[-1]}"], pos["tunnel"])
        r.need(d < 40, f"path.dam ends {d:.0f} m from the tunnel")
    # posts
    posts = [n for n in names if n and n.startswith("post.")]
    kinds = {}
    for p in posts:
        k = by[p].get("extras", {}).get("kind")
        r.need(k in POST_KINDS, f"{p}: kind {k!r}")
        kinds.setdefault(k, []).append(p)
    r.need(len(posts) >= 6, f"only {len(posts)} posts")
    r.need(set(kinds) >= POST_KINDS, f"post kinds present: {sorted(kinds)}")
    r.info(f"posts: " + ", ".join(f"{k}: {len(v)}" for k, v in sorted(kinds.items())))
    # sniper nests
    nests = [n for n in names if n and re.match(r"^sniper\.\d+$", n)]
    r.need(len(nests) >= 2, f"only {len(nests)} sniper nests")
    for s in nests:
        kids = {g.nodes[c].get("name") for c in by[s].get("children", [])}
        r.need({f"{s}.exposed", f"{s}.hidden"} <= kids, f"{s}: children {sorted(kids)}")
    r.need("bridge.cross" in nameset, "bridge.cross missing")
    for i in range(1, 10):
        r.need(f"calib.{i}" in nameset, f"calib.{i} missing")
    for s in SECRETS:
        r.need(s in nameset, f"{s} missing")
    # ranges quoted by the design (from the eye)
    for nm, lo, hi in (("secret.yeti", 1500, 2300), ("tunnel", 750, 1150)):
        if nm in pos:
            d = dist(pos[nm], (0, 0, 0))
            r.warn(lo <= d <= hi, f"{nm} at {d:.0f} m (design: {lo}-{hi})")
            r.info(f"{nm}: {d:.0f} m")
    for i in range(1, 10):
        nm = f"calib.{i}"
        if nm in pos:
            d = dist(pos[nm], (0, 0, 0))
            r.warn(100 <= d <= 270, f"{nm} at {d:.0f} m (design 120-250)")
    # surfaces
    tris = 0
    no_surface = []
    for i, n in enumerate(g.nodes):
        if "mesh" in n:
            t = g.mesh_triangles(n["mesh"]) * g.instance_count(n)
            tris += t
            s = n.get("extras", {}).get("surface")
            if s not in SURFACES:
                no_surface.append(f"{n.get('name')}={s!r}")
    r.need(not no_surface, f"meshes without a valid surface extra: {no_surface[:12]}")
    textures_report(r, g)
    scene_ex = g.json["scenes"][g.json.get("scene", 0)].get("extras", {})
    r.info(f"scene extras: {sorted(scene_ex)}")
    total = size + tex_total
    r.info(f"file {size / 1e6:.2f} MB + terrain textures {tex_total / 1e6:.2f} MB = {total / 1e6:.2f} MB "
           f"(budget {VALLEY_BUDGET_MB} MB)")
    r.info(f"nodes {len(g.nodes)}, meshes {len(g.json.get('meshes', []))}, materials "
           f"{len(g.json.get('materials', []))}, triangles drawn (instances included) {tris:,}")
    r.info(f"extensions: {g.json.get('extensionsUsed')}")
    r.need(total / 1e6 <= VALLEY_BUDGET_MB, f"valley over budget: {total / 1e6:.2f} MB")
    return r


def check_person_file(path, title, nodes, clips, bodies, dress):
    r = Report(f"{title}  ({path})")
    if not r.need(os.path.exists(path), f"{title} missing"):
        return r
    g = GLB.load(path)
    names = {n.get("name") for n in g.nodes}
    check_bones(r, g)
    for n in nodes:
        r.need(n in names, f"{n} missing")
    check_clips(r, g, clips)
    tb = mesh_tris_by_name(g)
    r.info("meshes: " + ", ".join(f"{k} {v}" for k, v in sorted(tb.items())))
    for body in bodies:
        if body not in tb:
            r.need(False, f"body mesh {body} missing")
            continue
        worst = person_tris(g, body, dress.get(body, []))
        r.info(f"{body} dressed: {worst} triangles")
        r.need(worst <= PERSON_TRIS[1], f"{body}: {worst} triangles over {PERSON_TRIS[1]}")
        r.warn(worst >= PERSON_TRIS[0] * 0.6, f"{body}: only {worst} triangles")
    textures_report(r, g, 1024)
    r.info(f"file {os.path.getsize(path) / 1024:.0f} KB")
    return r


def check_soldier(path):
    g = GLB.load(path) if os.path.exists(path) else None
    bodies = []
    if g:
        bodies = [n.get("name") for n in g.nodes if "mesh" in n and "skin" in n and (n.get("name") or "").startswith("char.")]
    # the heaviest plausible dressing: helmet, pack, rifle (or the ghillie)
    dress = {b: ["var.helmet", "var.pack", "gun.mg"] for b in bodies}
    r = check_person_file(path, "soldier.glb", SOLDIER_NODES, SOLDIER_CLIPS, bodies or ["char.soldier"], dress)
    return r


def check_civilian(path):
    return check_person_file(path, "civilian.glb", CIVILIAN_NODES, CIVILIAN_CLIPS,
                             CIVILIAN_NODES, {})


def check_vehicles(path):
    r = Report(f"vehicles.glb  ({path})")
    if not r.need(os.path.exists(path), "vehicles.glb missing"):
        return r
    g = GLB.load(path)
    by_idx = {i: n for i, n in enumerate(g.nodes)}
    for root in ("truck", "jeep"):
        ri = g.node_index(root)
        if not r.need(ri is not None, f"{root} missing"):
            continue
        desc = []
        stack = list(g.nodes[ri].get("children", []))
        while stack:
            c = stack.pop()
            desc.append(c)
            stack += g.nodes[c].get("children", [])
        dn = [g.nodes[c].get("name") for c in desc]
        wheels = [n for n in dn if n and re.match(r"^wheel\.\d+$", n)]
        r.need(len(wheels) >= 4, f"{root}: wheels {wheels}")
        for p in VEHICLE_PARTS:
            r.need(p in dn, f"{root}: {p} missing")
        tris = sum(g.mesh_triangles(g.nodes[c]["mesh"]) for c in desc + [ri] if "mesh" in g.nodes[c])
        r.info(f"{root}: {tris} triangles, parts: {sorted(n for n in dn if n)}")
        for c in desc + [ri]:
            n = g.nodes[c]
            if "mesh" in n:
                s = n.get("extras", {}).get("surface")
                r.need(s in SURFACES, f"{root}/{n.get('name')}: surface {s!r}")
    textures_report(r, g, 2048)
    r.info(f"file {os.path.getsize(path) / 1024:.0f} KB")
    return r


def check_animals(path):
    r = Report(f"animals.glb  ({path})")
    if not r.need(os.path.exists(path), "animals.glb missing"):
        return r
    g = GLB.load(path)
    names = {n.get("name") for n in g.nodes}
    rates = clip_rates(g)
    r.info("clips: " + ", ".join(f"{k} {v[0]:.2f}s" for k, v in sorted(rates.items())))
    for a, clips in ANIMAL_CLIPS.items():
        r.need(a in names, f"{a} missing")
        for c in clips:
            r.need(f"{a}.{c}" in rates, f"clip {a}.{c} missing")
    tb = mesh_tris_by_name(g)
    r.info("meshes: " + ", ".join(f"{k} {v}" for k, v in sorted(tb.items())))
    textures_report(r, g, 1024)
    r.info(f"file {os.path.getsize(path) / 1024:.0f} KB")
    return r


def check_image(path, title, min_w, aspect=None):
    r = Report(f"{title}  ({path})")
    if not r.need(os.path.exists(path), f"{title} missing"):
        return r
    with open(path, "rb") as f:
        w, h, fmt = image_size(f.read(64))
    r.info(f"{w}x{h} {fmt}, {os.path.getsize(path) / 1024:.0f} KB")
    r.need(fmt == "webp", f"{title} is {fmt}, not webp")
    r.need(w and w >= min_w, f"{title} only {w} wide")
    if aspect and w and h:
        r.need(abs(w / h - aspect) < 0.02, f"{title} aspect {w / h:.3f}, want {aspect}")
    return r


def main():
    which = sys.argv[1:] or ["valley", "sky", "soldier", "civilian", "vehicles", "animals", "poster"]
    reports = []
    for w in which:
        if w == "valley":
            reports.append(check_valley(os.path.join(ASSETS, "valley.glb")))
        elif w == "sky":
            reports.append(check_image(os.path.join(ASSETS, "sky.webp"), "sky.webp", 2048, aspect=2.0))
        elif w == "poster":
            reports.append(check_image(os.path.join(ASSETS, "poster.webp"), "poster.webp", 1600))
        elif w == "soldier":
            reports.append(check_soldier(os.path.join(ASSETS, "soldier.glb")))
        elif w == "civilian":
            reports.append(check_civilian(os.path.join(ASSETS, "civilian.glb")))
        elif w == "vehicles":
            reports.append(check_vehicles(os.path.join(ASSETS, "vehicles.glb")))
        elif w == "animals":
            reports.append(check_animals(os.path.join(ASSETS, "animals.glb")))
        else:
            print("unknown:", w)
            sys.exit(2)
    ok = all([rep.show() for rep in reports])
    print("\nALL OK" if ok else "\nCONTRACT ERRORS")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
