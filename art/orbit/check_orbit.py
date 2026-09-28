"""Check Orbital Decay's assets against the contract in docs/ORBITAL_DECAY.md
(plain Python, no Blender needed):

    python3 art/orbit/check_orbit.py [public/assets/orbit]

Reads each GLB's JSON chunk and each WebP's header, verifies every named
node and extra the game relies on, the budgets, the texture sizes, and
prints sizes and triangle counts. Exits non-zero on any contract error.
"""

import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "..", "public", "assets", "orbit")
MB = 1024 * 1024
BUDGET = {"cupola.glb": 6, "station.glb": 10, "debris.glb": 3, "drone.glb": 3, "derelict.glb": 3, "extras.glb": 3}
SURFACES = {"metal", "glass", "cloth", "rubber", "plastic", "foil"}


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", f"{path}: not a GLB"
    off, js = 12, None
    while off < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        if ctype == b"JSON":
            js = json.loads(data[off + 8: off + 8 + clen])
        off += 8 + clen
    return js, len(data)


def webp_size(path):
    with open(path, "rb") as f:
        b = f.read(40)
    if b[:4] != b"RIFF" or b[8:12] != b"WEBP":
        raise ValueError(f"{path}: not a WebP")
    kind = b[12:16]
    if kind == b"VP8 ":
        w, h = struct.unpack_from("<HH", b, 26)
        return w & 0x3FFF, h & 0x3FFF
    if kind == b"VP8L":
        bits = struct.unpack_from("<I", b, 21)[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X":
        w = int.from_bytes(b[24:27], "little") + 1
        h = int.from_bytes(b[27:30], "little") + 1
        return w, h
    raise ValueError(f"{path}: unknown WebP chunk {kind}")


def webp_alpha(data):
    """True if a WebP (bytes) carries an alpha channel (read from its
    header: the VP8X ALPHA flag, or the VP8L alpha_is_used bit)."""
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    kind = data[12:16]
    if kind == b"VP8X":
        return bool(data[20] & 0x10)
    if kind == b"VP8L":
        bits = struct.unpack_from("<I", data, 21)[0]
        return bool((bits >> 28) & 1)
    return False


def glb_images(g, blob):
    """(name, bytes, role) for every image in a GLB. role: 'color' for base
    colour with alpha allowed (alphaMode MASK or BLEND), 'color' for any
    other base colour or emissive map, 'data' for normal, ORM/occlusion and
    anything else (whose every channel must survive encoding)."""
    roles = {}
    for m in g.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        blend = m.get("alphaMode", "OPAQUE") in ("MASK", "BLEND")
        for key, tex in (("baseColorTexture", pbr.get("baseColorTexture")), ("emissiveTexture", m.get("emissiveTexture"))):
            if tex:
                src = g["textures"][tex["index"]]
                src = src.get("source", src.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
                roles.setdefault(src, "color_alpha" if (blend and key == "baseColorTexture") else "color")
        for key in ("normalTexture", "occlusionTexture"):
            if m.get(key):
                src = g["textures"][m[key]["index"]]
                roles[src.get("source", src.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))] = "data"
        if pbr.get("metallicRoughnessTexture"):
            src = g["textures"][pbr["metallicRoughnessTexture"]["index"]]
            roles[src.get("source", src.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))] = "data"
    out = []
    for i, im in enumerate(g.get("images", [])):
        if "bufferView" not in im:
            continue
        bv = g["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        out.append((im.get("name", f"image{i}"), blob[o:o + bv["byteLength"]], roles.get(i, "data")))
    return out


def check_webp_alpha(r, d):
    """WebP drops the colour of fully transparent pixels unless told to keep
    it ('exact'). So: every texture that stores data must have no alpha at
    all; only colour cut-outs (alphaMode MASK/BLEND) may, and where PIL is
    available their colour under zero alpha must not be dark (it bleeds
    into the edge when filtered)."""
    import glob
    items = []
    for p in sorted(glob.glob(os.path.join(d, "**", "*.webp"), recursive=True)):
        with open(p, "rb") as f:
            items.append((os.path.relpath(p, d), f.read(), "data"))
    for p in sorted(glob.glob(os.path.join(d, "*.glb"))):
        with open(p, "rb") as f:
            data = f.read()
        off, js, blob = 12, None, b""
        while off < len(data):
            clen, ctype = struct.unpack_from("<I4s", data, off)
            if ctype == b"JSON":
                js = json.loads(data[off + 8: off + 8 + clen])
            elif ctype == b"BIN\x00":
                blob = data[off + 8: off + 8 + clen]
            off += 8 + clen
        for name, b, role in glb_images(js, blob):
            items.append((f"{os.path.basename(p)}:{name}", b, role))
    n_alpha = 0
    for name, b, role in items:
        a = webp_alpha(b)
        if a is None:
            continue
        if a:
            n_alpha += 1
            r.need(role == "color_alpha", f"{name}: has an alpha channel but is used as {role} (data could be lost under zero alpha)")
            try:
                import io
                from PIL import Image
                import numpy as _np
                im = Image.open(io.BytesIO(b)).convert("RGBA")
                px = _np.asarray(im).astype(float)
                zero = px[..., 3] == 0
                edge = zero & (_np.roll(~zero, 1, 0) | _np.roll(~zero, -1, 0) | _np.roll(~zero, 1, 1) | _np.roll(~zero, -1, 1))
                if edge.any():
                    lum = px[..., :3][edge].mean()
                    r.need(lum > 100, f"{name}: colour under the transparent edge is dark ({lum:.0f}/255): it will fringe")
            except ImportError:
                pass
    r.say(f"webp: {len(items)} images checked, {n_alpha} with alpha (colour cut-outs only)")


class Report:
    def __init__(self):
        self.errors = []
        self.lines = []

    def need(self, cond, msg):
        if not cond:
            self.errors.append(msg)
        return cond

    def say(self, msg):
        self.lines.append(msg)


def tri_count(g, node):
    n = 0
    if "mesh" in node:
        for p in g["meshes"][node["mesh"]]["primitives"]:
            idx = p.get("indices")
            if idx is not None:
                n += g["accessors"][idx]["count"] // 3
            else:
                n += g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return n


def glb_summary(r, name, g, size):
    nodes = g.get("nodes", [])
    tris = sum(tri_count(g, n) for n in nodes)
    imgs = g.get("images", [])
    r.say(f"{name}: {size / MB:.2f} MB (budget {BUDGET.get(name, '-')} MB), {len(nodes)} nodes, "
          f"{len(g.get('meshes', []))} meshes, {len(g.get('materials', []))} materials, "
          f"{len(imgs)} images ({', '.join(sorted({i.get('mimeType', '?') for i in imgs})) or '-'}), {tris:,} triangles")
    if name in BUDGET:
        r.need(size <= BUDGET[name] * MB, f"{name}: {size / MB:.2f} MB over the {BUDGET[name]} MB budget")
    used = set(g.get("extensionsUsed", []))
    if "KHR_draco_mesh_compression" not in used and g.get("meshes"):
        r.say(f"  note: {name} has no Draco compression")
    return {n.get("name"): n for n in nodes}


def numbered(names, prefix):
    out = {}
    for n in names:
        if n and n.startswith(prefix):
            rest = n[len(prefix):]
            if re.fullmatch(r"\d+", rest):
                out[int(rest)] = n
    return out


def extras(n):
    return (n or {}).get("extras", {}) or {}


def check_surfaces(r, name, g, names):
    for n in g.get("nodes", []):
        if "mesh" in n:
            s = extras(n).get("surface")
            r.need(s in SURFACES, f"{name}: mesh node {n.get('name')} has surface {s!r}")


def rotate(q, v):
    """Rotate vector v by the glTF quaternion q = (x, y, z, w)."""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 q.xyz x v ; v' = v + w t + q.xyz x t
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def check_frames(r, name, names):
    """The camera looks along -Z pitched down ~20 degrees; the sun node's
    -Z agrees with its sun_toward extras (pointing away from the sun)."""
    cam = names.get("camera.player")
    if cam is not None:
        fwd = rotate(cam.get("rotation", [0, 0, 0, 1]), (0, 0, -1))
        pitch = math.degrees(math.asin(max(-1.0, min(1.0, fwd[1]))))
        r.need(abs(fwd[0]) < 1e-3 and -30 < pitch < -10, f"{name}: camera.player looks along {fwd} (pitch {pitch:.1f})")
        r.say(f"  camera: forward ({fwd[0]:+.3f}, {fwd[1]:+.3f}, {fwd[2]:+.3f}), pitch {pitch:.1f} deg")
    sun = names.get("sun")
    if sun is not None:
        down = rotate(sun.get("rotation", [0, 0, 0, 1]), (0, 0, -1))
        tow = extras(sun).get("sun_toward")
        if r.need(isinstance(tow, list) and len(tow) == 3, f"{name}: sun has no sun_toward extras"):
            dot = -sum(a * b for a, b in zip(down, tow))
            r.need(dot > 0.999, f"{name}: sun -Z {down} disagrees with sun_toward {tow}")
            r.say(f"  sun: light travels ({down[0]:+.3f}, {down[1]:+.3f}, {down[2]:+.3f})")


def check_cupola(r, d):
    p = os.path.join(d, "cupola.glb")
    if not r.need(os.path.exists(p), "cupola.glb missing"):
        return
    g, size = load_glb(p)
    names = glb_summary(r, "cupola.glb", g, size)
    cam = names.get("camera.player")
    r.need(cam is not None and "camera" in cam, "cupola: camera.player missing or not a camera")
    if cam:
        fov = extras(cam).get("fov_deg")
        r.need(isinstance(fov, (int, float)) and 40 <= fov <= 80, f"cupola: camera.player fov_deg {fov}")
    r.need("sun" in names, "cupola: sun missing")
    check_frames(r, "cupola", names)
    r.need("hud.anchor" in names, "cupola: hud.anchor missing")
    r.need("planet" in names, "cupola: planet node missing (planet placement)")
    panes = {"pane.center": 0, **{f"pane.{i}": i for i in range(1, 7)}}
    for nm, idx in panes.items():
        n = names.get(nm)
        if not r.need(n is not None and "mesh" in n, f"cupola: {nm} missing or not a mesh"):
            continue
        r.need(extras(n).get("pane") == idx, f"cupola: {nm} extras.pane {extras(n).get('pane')} != {idx}")
        prims = g["meshes"][n["mesh"]]["primitives"]
        r.need(all("TEXCOORD_0" in pr["attributes"] for pr in prims), f"cupola: {nm} has no UVs for the cracks")
    floats = numbered(names, "float.")
    r.need(len(floats) >= 1, "cupola: no float.<n>")
    for i, nm in floats.items():
        r.need("mesh" in names[nm] or "children" in names[nm], f"cupola: {nm} is empty")
    mats = g.get("materials", [])
    unlit = [m for m in mats if "KHR_materials_unlit" in m.get("extensions", {})]
    r.need(len(unlit) >= 1, "cupola: no unlit (baked) material")
    check_surfaces(r, "cupola.glb", g, names)
    r.say(f"  panes 7, floats {sorted(floats)}, unlit materials {len(unlit)}")


def check_station(r, d):
    p = os.path.join(d, "station.glb")
    if not r.need(os.path.exists(p), "station.glb missing"):
        return
    g, size = load_glb(p)
    names = glb_summary(r, "station.glb", g, size)
    for nm in ("emitter", "drone.dock", "secret.arm.hand", "secret.capsule.window", "sun", "planet"):
        r.need(nm in names, f"station: {nm} missing")
    check_frames(r, "station", names)
    for i in range(1, 10):
        r.need(f"calib.{i}" in names, f"station: calib.{i} missing")
    for prefix, least in (("drone.path.", 2), ("astronaut.path.", 2), ("secret.duck.path.", 2), ("spawn.", 4)):
        found = numbered(names, prefix)
        r.need(len(found) >= least, f"station: only {len(found)} {prefix}<n>")
        r.say(f"  {prefix}<n>: {len(found)}")
    r.need("mesh" in names.get("secret.arm.hand", {}), "station: secret.arm.hand has no mesh")
    check_surfaces(r, "station.glb", g, names)


def check_planet(r, d):
    pd = os.path.join(d, "planet")
    for nm, need_dims in (("albedo", (4096, 2048)), ("clouds", None), ("night", None), ("water", None)):
        p = os.path.join(pd, nm + ".webp")
        if not r.need(os.path.exists(p), f"planet/{nm}.webp missing"):
            continue
        w, h = webp_size(p)
        r.need(w == 2 * h, f"planet/{nm}.webp is {w}x{h}, not 2:1 equirect")
        if need_dims:
            r.need((w, h) == need_dims, f"planet/{nm}.webp is {w}x{h}, contract says {need_dims[0]}x{need_dims[1]}")
        r.say(f"planet/{nm}.webp: {w}x{h}, {os.path.getsize(p) / 1024:.0f} KB")
    for nm in ("height", "detail"):
        p = os.path.join(pd, nm + ".webp")
        if os.path.exists(p):
            w, h = webp_size(p)
            r.say(f"planet/{nm}.webp (optional): {w}x{h}, {os.path.getsize(p) / 1024:.0f} KB")
    p = os.path.join(d, "stars.webp")
    if r.need(os.path.exists(p), "stars.webp missing"):
        w, h = webp_size(p)
        r.need(w == 2 * h, f"stars.webp is {w}x{h}, not 2:1 equirect")
        r.say(f"stars.webp: {w}x{h}, {os.path.getsize(p) / 1024:.0f} KB")


def check_debris(r, d):
    p = os.path.join(d, "debris.glb")
    if not r.need(os.path.exists(p), "debris.glb missing"):
        return
    g, size = load_glb(p)
    names = glb_summary(r, "debris.glb", g, size)
    kinds = {}
    for k in ("shrapnel", "chunk", "slab", "shard", "foil"):
        found = numbered(names, k + ".")
        kinds[k] = found
        r.need(len(found) >= 2, f"debris: only {len(found)} {k}.<n> variants")
        for i, nm in found.items():
            if k != "foil":
                r.need("mesh" in names[nm], f"debris: {nm} has no mesh")
            ex = extras(names[nm])
            r.need(ex.get("kind") == k, f"debris: {nm} extras.kind {ex.get('kind')!r}")
            r.need(isinstance(ex.get("mass_kg"), (int, float)), f"debris: {nm} has no mass_kg")

    def children(nm):
        return {g["nodes"][c].get("name") for c in names[nm].get("children", [])}
    for i, nm in kinds.get("foil", {}).items():
        kids = children(nm)
        r.need(f"{nm}.core" in kids and f"{nm}.wrap" in kids, f"debris: {nm} needs children {nm}.wrap and {nm}.core")
    for k in ("chunk", "slab"):
        for i, nm in kinds.get(k, {}).items():
            grp = nm + ".pieces"
            if not r.need(grp in names, f"debris: {grp} missing"):
                continue
            pieces = numbered(names, nm + ".piece.")
            r.need(len(pieces) >= 2, f"debris: {nm} has {len(pieces)} pieces (needs 2+)")
            kids = children(grp)
            for m, pn in pieces.items():
                r.need(pn in kids, f"debris: {pn} is not in {grp}")
            wt, gt = names[nm].get("translation", [0, 0, 0]), names[grp].get("translation", [0, 0, 0])
            r.need(max(abs(a - b) for a, b in zip(wt, gt)) < 1e-3, f"debris: {grp} is not at {nm}'s position")
    r.say("  " + ", ".join(f"{k} {len(v)}" for k, v in kinds.items()))
    check_surfaces(r, "debris.glb", g, names)


def check_drone(r, d):
    p = os.path.join(d, "drone.glb")
    if not r.need(os.path.exists(p), "drone.glb missing"):
        return
    g, size = load_glb(p)
    names = glb_summary(r, "drone.glb", g, size)
    r.need(len(numbered(names, "thruster.")) >= 4, "drone: fewer than 4 thruster.<n>")
    for nm in ("light.nav", "weld.tip"):
        r.need(nm in names, f"drone: {nm} missing")
    r.say(f"  thrusters {len(numbered(names, 'thruster.'))}")


def check_derelict(r, d):
    p = os.path.join(d, "derelict.glb")
    if not r.need(os.path.exists(p), "derelict.glb missing"):
        return
    g, size = load_glb(p)
    names = glb_summary(r, "derelict.glb", g, size)
    r.need("tank" in names and "mesh" in names["tank"], "derelict: tank missing or not a mesh")
    r.need(len(numbered(names, "panel.")) >= 2, "derelict: fewer than 2 panel.<n>")
    pieces = numbered(names, "derelict.piece.")
    r.need(len(pieces) >= 4, f"derelict: only {len(pieces)} derelict.piece.<n>")
    r.say(f"  panels {len(numbered(names, 'panel.'))}, pieces {len(pieces)}")


def check_extras(r, d):
    p = os.path.join(d, "extras.glb")
    if not r.need(os.path.exists(p), "extras.glb missing"):
        return
    g, size = load_glb(p)
    names = glb_summary(r, "extras.glb", g, size)
    for nm in ("astronaut", "toolbag", "duck", "sticker"):
        r.need(nm in names, f"extras: {nm} missing")
    r.need(any(n and n.startswith("astronaut.arm") for n in names), "extras: astronaut has no pivoting arm node")


def check_poster(r, d):
    p = os.path.join(d, "poster.webp")
    if r.need(os.path.exists(p), "poster.webp missing"):
        w, h = webp_size(p)
        r.say(f"poster.webp: {w}x{h}, {os.path.getsize(p) / 1024:.0f} KB")


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    r = Report()
    for fn in (check_cupola, check_station, check_planet, check_debris, check_drone, check_derelict, check_extras, check_poster,
               check_webp_alpha):
        try:
            fn(r, d)
        except Exception as e:           # a malformed file is a contract error, not a crash
            r.errors.append(f"{fn.__name__}: {e!r}")
    print("\n".join(r.lines))
    if r.errors:
        print("\nCONTRACT ERRORS:")
        for e in r.errors:
            print("  -", e)
        sys.exit(1)
    print("\ncontract OK")


if __name__ == "__main__":
    main()
