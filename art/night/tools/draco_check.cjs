// Decode every Draco-compressed primitive of a GLB with three.js's own Draco
// decoder (the one the game ships) and check each decoded attribute against
// its accessor - proof that the browser can read what Blender wrote,
// including the corn's custom _ALBEDO/_SWAY/_FLICKER attributes (Blender
// 5.1's own importer cannot read those back; three can).
//
//   node art/night/tools/draco_check.cjs public/assets/night/road.glb [...more.glb]
const fs = require('fs');
const os = require('os');
const path = require('path');

function findDecoder() {
  // node_modules may sit in a folder above this one: walk up from here
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const p = path.join(dir, 'node_modules/three/examples/jsm/libs/draco/draco_decoder.js');
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  throw new Error('three.js is not installed (npm install)');
}

// three's package is an ES module; its Emscripten decoder is plain CommonJS
const tmp = path.join(os.tmpdir(), 'draco_decoder_check.cjs');
fs.copyFileSync(findDecoder(), tmp);
const DracoDecoderModule = require(tmp);
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function check(draco, file) {
  const buf = fs.readFileSync(file);
  const jlen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jlen).toString());
  const binStart = 20 + jlen + 8;
  let bad = 0, n = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      const ext = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (!ext) continue;
      const bv = json.bufferViews[ext.bufferView];
      const off = binStart + (bv.byteOffset || 0);
      const data = buf.slice(off, off + bv.byteLength);
      const decoder = new draco.Decoder();
      const db = new draco.DecoderBuffer();
      db.Init(new Int8Array(data), data.length);
      const geom = new draco.Mesh();
      const st = decoder.DecodeBufferToMesh(db, geom);
      if (!st.ok()) { console.log(`  FAIL ${mesh.name}: ${st.error_msg()}`); bad++; continue; }
      n++;
      for (const [name, id] of Object.entries(ext.attributes)) {
        const att = decoder.GetAttributeByUniqueId(geom, id);
        const acc = json.accessors[prim.attributes[name]];
        if (!att || att.num_components() !== NCOMP[acc.type] || geom.num_points() !== acc.count) {
          console.log(`  MISMATCH ${mesh.name} ${name}`);
          bad++;
        }
      }
      const idx = json.accessors[prim.indices];
      if (idx && geom.num_faces() * 3 !== idx.count) { console.log(`  MISMATCH ${mesh.name} indices`); bad++; }
      draco.destroy(geom); draco.destroy(db); draco.destroy(decoder);
    }
  }
  console.log(`${path.basename(file)}: decoded ${n} Draco primitives, ${bad} problems`);
  return bad === 0;
}

DracoDecoderModule().then((draco) => {
  let ok = true;
  for (const f of process.argv.slice(2)) ok = check(draco, f) && ok;
  process.exit(ok ? 0 : 1);
});
