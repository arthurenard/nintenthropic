"""Check town.glb against the High Noon asset contract (plain Python, no
Blender needed):  python3 art/western/check_glb.py [path/to/town.glb]

Reads the GLB's JSON chunk and verifies the node names and extras the game
relies on, that every mesh node says what surface it is, and reports sizes
and a triangle count.
"""

import json
import os
import struct
import sys

ALLOWED_SURF = {"wood", "dirt", "glass", "metal", "stone", "cloth", "water"}
KINDS = {"window", "door", "barrel", "crate", "wagon", "corner", "roof", "tower"}
EMERGE = {"lean_left", "lean_right", "rise", "step_out"}
SECRETS = ["secret.bell", "secret.vane", "secret.water_tower", "secret.piano", "secret.poster",
           "secret.church_doors.left", "secret.church_doors.right"]


def load(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    off = 12
    js = None
    binlen = 0
    while off < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk)
        else:
            binlen = clen
        off += 8 + clen
    return js, len(data), binlen


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "public",
                                                              "assets", "western", "town.glb")
    g, size, binlen = load(path)
    nodes = g["nodes"]
    names = {n.get("name"): n for n in nodes}
    errors = []

    def need(cond, msg):
        if not cond:
            errors.append(msg)

    cam = names.get("camera.player")
    need(cam is not None and "camera" in cam, "camera.player missing or not a camera")
    if cam:
        fov = cam.get("extras", {}).get("fov_deg", 0)
        need(40 <= fov <= 55, f"camera.player extras.fov_deg {fov} out of range")
    need("sun" in names, "sun missing")
    covers = [n for n in names if n and n.startswith("cover.") and not n.endswith(".hidden")]
    for c in covers:
        ex = names[c].get("extras", {})
        need(ex.get("kind") in KINDS, f"{c}: bad kind {ex.get('kind')}")
        need(ex.get("emerge") in EMERGE, f"{c}: bad emerge {ex.get('emerge')}")
        need(ex.get("level") in (0, 1, 2), f"{c}: bad level {ex.get('level')}")
        need(c + ".hidden" in names, f"{c}: no hidden twin")
    need(len(covers) >= 20, f"only {len(covers)} covers")
    for i in range(1, 10):
        need(f"calib.{i}" in names, f"calib.{i} missing")
    for s in SECRETS:
        need(s in names, f"{s} missing")
    need(any(n and n.startswith("glass.") for n in names), "no glass panes")
    need(any(n and n.startswith("path.chicken.") for n in names), "no chicken path")
    need(any(n and n.startswith("path.tumbleweed.") for n in names), "no tumbleweed path")
    need("ground.shadow" in names, "ground.shadow missing")
    scene_ex = g["scenes"][g.get("scene", 0)].get("extras", {})
    need(isinstance(scene_ex.get("fog_color"), str) and scene_ex["fog_color"].startswith("#"), "scene fog_color missing")
    need(isinstance(scene_ex.get("fog_density"), (int, float)), "scene fog_density missing")
    flags = {f: [c for c in covers if names[c].get("extras", {}).get(f) is True] for f in ("boss", "townsfolk", "duel")}
    need(len(flags["boss"]) == 3, f"expected 3 boss covers, got {flags['boss']}")
    need(len(flags["duel"]) >= 1, "no duel cover")
    tris = 0
    for n in nodes:
        if "mesh" in n:
            surf = n.get("extras", {}).get("surface")
            need(surf in ALLOWED_SURF, f"{n.get('name')}: surface extra {surf!r}")
            for p in g["meshes"][n["mesh"]]["primitives"]:
                idx = p.get("indices")
                if idx is not None:
                    tris += g["accessors"][idx]["count"] // 3
    imgs = g.get("images", [])
    print(f"file: {size / 1e6:.2f} MB (binary chunk {binlen / 1e6:.2f} MB)")
    print(f"nodes: {len(nodes)}  meshes: {len(g.get('meshes', []))}  materials: {len(g.get('materials', []))}  "
          f"images: {len(imgs)} ({', '.join(i.get('mimeType', '?') for i in imgs)})")
    print(f"triangles: {tris}")
    print(f"covers: {len(covers)}  extensions: {g.get('extensionsUsed')}")
    print(f"scenes: {[sc.get('name') for sc in g['scenes']]}  scene extras: "
          f"{ {k: v for k, v in g['scenes'][g.get('scene', 0)].get('extras', {}).items() if k.startswith('fog_') and k != 'fog_note'} }")
    if errors:
        print("CONTRACT ERRORS:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("contract OK")


if __name__ == "__main__":
    main()
