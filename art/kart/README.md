# Grip Prix — the art

Grip Prix's modelled art, built from nothing by the scripts in this folder in
Blender 5.1 run headless (`/Applications/Blender.app/Contents/MacOS/Blender -b
-P art/kart/<part>/build.py`). Never drive an open Blender window. Nothing is
downloaded. The look: a bright, glossy, rounded toy world in warm sunlight —
a polished console kart racer, with only original designs.

Each file is optional: whatever is missing, the game draws its code-built
stand-in (src/kart/render/art.ts loads what exists).

| File (`public/assets/kart/`) | Built by | What | Budget |
| --- | --- | --- | --- |
| `karts.glb` | `art/kart/karts/` | `kart.body` (the whole fixed kart; material "paint" takes the racer's colour), `kart.wheel` (one, rear size, origin at its hub, axis x, outer face +x; the game scales it 0.84 for the front), `kart.steering` (ring in xy, origin at its hub). Material names the game reads: paint, trim, stripe, chrome, rim, steel, rubber, tread, plastic, seat, lamp, tail, glass (src/kart/render/kartArt.ts). AO is in the vertex colours | ≤ 12k tris, ≤ 0.6 MB |
| `drivers.glb` | `art/kart/drivers/` | `driver.<species>.<part>` for the nine species: head, torso, arm.L, arm.R, helmet, and the bits that move on their own (tail, scarf, sac, bulb); each node's translation is its joint | ≤ 5k tris per driver, ≤ 1.5 MB |
| `world-<theme>.glb` | `art/kart/world/` | `landmark.<kind>` (the doc's theme table), `scenery.<kind>.<n>` (trees, rocks...) | ≤ 3 MB each |

## Rules for every model

- Metres, y up, front +z (three.js), base on y = 0, origin where the game
  pivots it. Same size as the code-built stand-in it replaces (measure it).
- Draco-compressed .glb (`export_draco_mesh_compression_enable=True`),
  materials as glTF PBR (base colour, metallic, roughness, emissive).
- Smooth shading with bevels; real modelled detail, not boxes.
- Landmarks and scenery: colour in base colours and/or vertex colours, no
  textures (the world merges them into vertex-coloured geometry; see
  src/kart/render/world/landmarks/fromArt.ts). Bake ambient occlusion into a
  vertex colour layer. Glowing parts: an emissive colour. Glass, ice and
  canvas: transparent, or a material named "glass". A part that turns: a
  child node named `<anything>.spin.x|y|z` about its own origin, with a
  custom property `speed` (rad/s).
- A span landmark (a tunnel, an arch over the road) is modelled in the road's
  frame: x metres right of the centre line, z along the road centred on 0,
  cut into pieces of 3 m or less along z so the game can bend it.

## The drivers (`art/kart/drivers/`)

Built in Blender from signed-distance shapes (sdflib.py: smooth unions, surface nets, exact normals, ambient
occlusion from the field), decimated with Blender's own decimator, coloured per vertex, and exported with Draco:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/kart/drivers/build.py [-- --only fox,cat]

`species/<name>.py` models one driver; `shared.py` is what they have in common (the racing suit, gloved arms, the
helmet, eyes, brows, smiles, whiskers). Parts are modelled in their own space, driver facing +z, left = +x: the
head about its centre (0, 0.84, 0.06), an arm along +z from its shoulder (+-shoulder, 0.46, 0.02), the torso about
the hips. The game (src/kart/render/drivers/fromArt.ts) joins a part's pieces into one geometry and reads each
piece's material by name:

- `fur cloth trim plastic steel gloss glass`: the vertex colour is the colour.
- `lamp glow`: the same, made to shine (x2, x6).
- `paint paintcloth vest`: the vertex grey is how lit it is, and the game paints it in the kart's colour (`vest`: a
  white with a breath of it). The helmet, collar, belt, cuffs and bib are these, so a driver wears its kart.

A species with all four of head, torso, arm.L, arm.R is built from the art; any missing piece of a bit (tail,
scarf...) is the code-built one. The helmet joins the head. Otherwise the driver is the code-built stand-in.

## The natural worlds (`art/kart/world/nature*.py`)

`Blender -b --factory-startup -P art/kart/world/nature.py -- [meadow canyon snow volcano palm]`
writes `world-<theme>.glb` for the meadow, canyon, glacier, volcano and
island: `scenery.<kind>.<n>` kits (several variants a kind, instanced by
src/kart/render/world/scenery.ts in place of the code-built shape; at most
~1.5k triangles each, smooth normals, ambient occlusion in the vertex colours)
and the signature landmarks. `naturekit.py` is the kit (bmesh primitives that
paint their vertices, a BVH ambient-occlusion bake, the glTF export);
`nature_<theme>.py` holds a world's scenery and `nature_<theme>_lm.py` its
landmarks. Things to know when changing them:

- Modelled landmarks keep their smooth normals in the world (`LandmarkModel.smooth`).
- A modelled span landmark has one fixed span (rock-arch 16 m, ice-arch 14,
  stone-bridge 98, giant-ring 10, wristwatch 12: what tracks.ts asks for); a
  part of it that turns (`.spin`) is ignored, because the game bends the
  whole model along the road.
- Keep every model inside the code-built footprint: nothing solid within a
  camera's width of the barrier. `world/corridor.test.ts` checks the code-built
  world; to check the modelled one, load the art in a page and run
  `measureTrack` from `world/corridorProbe.ts` (the dev pages load it).
- `gallery.html?theme=canyon&kind=mesa` shows a landmark and
  `kind=scenery:cactus` a kind of scenery, with the Blender art loaded.
