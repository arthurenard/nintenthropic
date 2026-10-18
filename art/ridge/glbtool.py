"""Read, inspect and patch GLB files in plain Python (no Blender, no numpy).

Why patch after Blender's exporter instead of asking it for everything:
- Blender cannot hold two objects with the same name, but the contract wants
  `wheel.1` under both `truck` and `jeep`: we export `truck.wheel.1` and
  rename afterwards (`rename_nodes`).
- The forest is tens of thousands of trees. Blender's exporter can write
  EXT_mesh_gpu_instancing, but only from one child object per instance, which
  is slow and heavy for 50k trees; `add_instancing` appends the instance
  transforms to a node directly (three.js's GLTFLoader turns such a node into
  an InstancedMesh with no game code).

Used by the build (inside Blender's Python) and by check.py (system Python).
"""

import json
import struct

GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

COMPONENT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class GLB:
    def __init__(self, js, binary):
        self.json = js
        self.bin = bytearray(binary or b"")

    # -- io ----------------------------------------------------------------
    @classmethod
    def load(cls, path):
        with open(path, "rb") as f:
            data = f.read()
        magic, version, length = struct.unpack_from("<4sII", data, 0)
        if magic != GLB_MAGIC:
            raise ValueError(f"{path}: not a GLB")
        off = 12
        js, binary = None, b""
        while off < len(data):
            clen, ctype = struct.unpack_from("<II", data, off)
            chunk = data[off + 8: off + 8 + clen]
            if ctype == JSON_CHUNK:
                js = json.loads(chunk.decode("utf-8"))
            elif ctype == BIN_CHUNK:
                binary = chunk
            off += 8 + clen
        return cls(js, binary)

    def save(self, path):
        js = json.dumps(self.json, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        binary = bytes(self.bin)
        binary += b"\0" * ((4 - len(binary) % 4) % 4)
        if self.json.get("buffers"):
            self.json["buffers"][0]["byteLength"] = len(binary)
            # the length changed after padding: rewrite the JSON with it
            js = json.dumps(self.json, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + (8 + len(binary) if binary else 0)
        with open(path, "wb") as f:
            f.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
            f.write(struct.pack("<II", len(js), JSON_CHUNK))
            f.write(js)
            if binary:
                f.write(struct.pack("<II", len(binary), BIN_CHUNK))
                f.write(binary)

    # -- lookups -------------------------------------------------------------
    @property
    def nodes(self):
        return self.json.get("nodes", [])

    def node_index(self, name):
        for i, n in enumerate(self.nodes):
            if n.get("name") == name:
                return i
        return None

    def parents(self):
        par = {}
        for i, n in enumerate(self.nodes):
            for c in n.get("children", []):
                par[c] = i
        return par

    def mesh_triangles(self, mesh_index):
        tris = 0
        for p in self.json["meshes"][mesh_index]["primitives"]:
            mode = p.get("mode", 4)
            if "indices" in p:
                cnt = self.json["accessors"][p["indices"]]["count"]
            else:
                cnt = self.json["accessors"][p["attributes"]["POSITION"]]["count"]
            if mode == 4:
                tris += cnt // 3
            elif mode in (5, 6):
                tris += max(cnt - 2, 0)
        return tris

    def instance_count(self, node):
        ext = node.get("extensions", {}).get("EXT_mesh_gpu_instancing")
        if not ext:
            return 1
        attrs = ext["attributes"]
        a = attrs.get("TRANSLATION") or next(iter(attrs.values()))
        return self.json["accessors"][a]["count"]

    # -- patching -------------------------------------------------------------
    def _append(self, payload, target=None):
        """Append bytes to the binary chunk as a new bufferView; returns its index."""
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin.extend(payload)
        if not self.json.get("buffers"):
            self.json["buffers"] = [{"byteLength": 0}]
        bv = {"buffer": 0, "byteOffset": off, "byteLength": len(payload)}
        if target is not None:
            bv["target"] = target
        self.json.setdefault("bufferViews", []).append(bv)
        self.json["buffers"][0]["byteLength"] = len(self.bin)
        return len(self.json["bufferViews"]) - 1

    def add_accessor_f32(self, values, typ, minmax=False):
        """values: flat list of floats."""
        n = TYPE_COUNT[typ]
        count = len(values) // n
        bv = self._append(struct.pack(f"<{len(values)}f", *values))
        acc = {"bufferView": bv, "componentType": 5126, "count": count, "type": typ}
        if minmax and count:
            acc["min"] = [min(values[i::n]) for i in range(n)]
            acc["max"] = [max(values[i::n]) for i in range(n)]
        self.json.setdefault("accessors", []).append(acc)
        return len(self.json["accessors"]) - 1

    def add_accessor_packed(self, rows, typ, ctype, normalized=True):
        """Integer components packed with each element padded to 4 bytes
        (glTF's alignment rule); rows: list of tuples of ints."""
        fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H"}[ctype]
        size = COMPONENT_SIZE[ctype]
        n = TYPE_COUNT[typ]
        elem = size * n
        stride = (elem + 3) // 4 * 4
        pad = stride - elem
        buf = bytearray()
        for r in rows:
            buf += struct.pack(f"<{n}{fmt}", *r)
            buf += b"\0" * pad
        bv = self._append(bytes(buf))
        if stride != elem:
            self.json["bufferViews"][bv]["byteStride"] = stride
        acc = {"bufferView": bv, "componentType": ctype, "count": len(rows), "type": typ, "normalized": normalized}
        self.json.setdefault("accessors", []).append(acc)
        return len(self.json["accessors"]) - 1

    def add_instancing_packed(self, node_index, translations, yaws, scales, scale_max):
        """Instances that only turn about the vertical and scale uniformly,
        packed small: TRANSLATION float32, ROTATION normalized int16 (a
        quaternion about +Y), SCALE normalized uint8 x scale_max (the holder
        node's mesh must be authored at scale_max times... no: the SCALE
        accessor is normalized to [0, 1], so the mesh is authored at size
        scale_max and the instance scale is s / scale_max)."""
        import math
        flat = [float(c) for v in translations for c in v]
        attrs = {"TRANSLATION": self.add_accessor_f32(flat, "VEC3", minmax=True)}
        rot = []
        for y in yaws:
            s, c = math.sin(y / 2), math.cos(y / 2)
            rot.append((0, int(round(s * 32767)), 0, int(round(c * 32767))))
        attrs["ROTATION"] = self.add_accessor_packed(rot, "VEC4", 5122)
        sc = []
        for s in scales:
            q = max(0, min(255, int(round(s / scale_max * 255))))
            sc.append((q, q, q))
        attrs["SCALE"] = self.add_accessor_packed(sc, "VEC3", 5121)
        node = self.nodes[node_index]
        node.setdefault("extensions", {})["EXT_mesh_gpu_instancing"] = {"attributes": attrs}
        used = self.json.setdefault("extensionsUsed", [])
        if "EXT_mesh_gpu_instancing" not in used:
            used.append("EXT_mesh_gpu_instancing")

    def add_instancing(self, node_index, translations, rotations, scales):
        """EXT_mesh_gpu_instancing on a node that already holds a mesh.
        translations: [(x,y,z)] glTF space; rotations: [(x,y,z,w)]; scales: [(x,y,z)]."""
        flat = lambda seq: [float(c) for v in seq for c in v]
        attrs = {
            "TRANSLATION": self.add_accessor_f32(flat(translations), "VEC3", minmax=True),
            "ROTATION": self.add_accessor_f32(flat(rotations), "VEC4"),
            "SCALE": self.add_accessor_f32(flat(scales), "VEC3"),
        }
        node = self.nodes[node_index]
        node.setdefault("extensions", {})["EXT_mesh_gpu_instancing"] = {"attributes": attrs}
        used = self.json.setdefault("extensionsUsed", [])
        if "EXT_mesh_gpu_instancing" not in used:
            used.append("EXT_mesh_gpu_instancing")

    def rename_nodes(self, fn):
        """fn(name, parent_name) -> new name or None to keep."""
        par = self.parents()
        for i, n in enumerate(self.nodes):
            p = par.get(i)
            new = fn(n.get("name", ""), self.nodes[p].get("name", "") if p is not None else None)
            if new:
                n["name"] = new


# ---------------------------------------------------------------------------
# image headers (so the checker can report texture sizes without decoding)

def image_size(data):
    """(width, height, format) from the first bytes of a PNG / WebP / JPEG."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h, "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF, "webp"
        if kind == b"VP8L":
            b = data[21:25]
            bits = int.from_bytes(b, "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, "webp"
        if kind == b"VP8X":
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h, "webp"
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                break
            marker = data[i + 1]
            ln = struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h, "jpeg"
            i += 2 + ln
    return None, None, "?"


def glb_images(g):
    """[(name, width, height, format, bytes)] for images embedded in the GLB."""
    out = []
    for im in g.json.get("images", []):
        if "bufferView" in im:
            bv = g.json["bufferViews"][im["bufferView"]]
            off = bv.get("byteOffset", 0)
            data = bytes(g.bin[off: off + bv["byteLength"]])
            w, h, fmt = image_size(data)
            out.append((im.get("name", "?"), w, h, fmt, len(data)))
        else:
            out.append((im.get("name", im.get("uri", "?")), None, None, "uri", 0))
    return out
