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
| `karts.glb` | `art/kart/karts/` | `kart.body` (paint material "paint"), `kart.wheel` (one, origin at its hub), `kart.trim` | ≤ 12k tris, ≤ 0.6 MB |
| `drivers.glb` | `art/kart/drivers/` | `driver.<species>.<part>`: head, torso, arm.L, arm.R, helmet (paint), pivots at the joints | ≤ 5k tris each, ≤ 1.5 MB |
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
