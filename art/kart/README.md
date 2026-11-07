# Grip Prix — the art

Grip Prix's modelled art, built from nothing by the scripts in this folder in
Blender 5.1 run headless (`/Applications/Blender.app/Contents/MacOS/Blender -b
-P art/kart/<part>/build.py`). Nothing is downloaded. The look: a bright, glossy, rounded toy world in warm sunlight —
a polished console kart racer, with only original designs.

Each file is optional: whatever is missing, the game draws its code-built
stand-in (src/kart/render/art.ts loads what exists).

| File (`public/assets/kart/`) | Built by | What | Budget |
| --- | --- | --- | --- |
| `karts.glb` | `art/kart/karts/` | Three bodies by weight class: `kart.body` (the sprint kart, also named `kart.body.middle`), `kart.body.light` (open buggy on a roll cage) and `kart.body.heavy` (wide-fendered muscle kart); `kart.wheel` (middle, five spokes), `kart.wheel.light` (eight wire spokes) and `kart.wheel.heavy` (deep dish with lug nuts), each one wheel, rear size, origin at its hub, axis x, outer face +x (the game scales it 0.84 for the front); `kart.steering` (ring in xy, origin at its hub); and `kart.livery.<class>.<pattern>` (27 small decal meshes in material "livery": flames, spots, checks, waves, tiger, chevrons, bolts, diamonds, twin; projected onto that class's hull). Material names the game reads: paint, trim, livery, stripe, chrome, rim, steel, rubber, tread, plastic, seat, lamp, tail, glass (src/kart/render/kartArt.ts). AO is in the vertex colours | each body <= 9.5k tris (middle about 8.2k, light 7.6k, heavy 9.1k), a livery <= 1.3k, file <= 1 MB |
| `drivers.glb` | `art/kart/drivers/` | `driver.<species>.<part>` for the nine species: head, torso, arm.L, arm.R, helmet, and the bits that move on their own (tail, scarf, sac, bulb); each node's translation is its joint | ≤ 5k tris per driver, ≤ 1.5 MB |
| `world-<theme>.glb` | `art/kart/world/` | `landmark.<kind>` (the doc's theme table), `scenery.<kind>.<n>` (trees, rocks...) | ≤ 3 MB each |
| `poster.webp`, `title.webp`, `icon.png`, `icon-180.png` | `art/kart/poster/` | Key art for the home page's card, the title screen's background and the app icon: Blender Cycles renders of the game's own models (see "The key art") | poster 1600×900 ≤ 250 KB, title 2560×1440 ≤ 450 KB |
| `tracks/<trackId>.webp` | `tools/kart-postcards.mjs` | The track picker's postcards, captured from the game's own renderer (see "The track postcards") | 960×540 ≤ 90 KB each |

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
  custom property `speed` (rad/s); optional `bob`, `bobspeed`, `phase` make it
  rise and fall as it turns. `<anything>.orbit.x|y|z` (with `speed`, and the
  circle's centre `cx`, `cy`, `cz`) keeps its attitude and travels the circle:
  a ferris wheel's cars. Normals in the file are kept (smooth shading); the
  world scripts (art/kart/world/made.py) are the reference.
- A span landmark (a tunnel, an arch over the road) is modelled in the road's
  frame: x metres right of the centre line, z along the road centred on 0,
  cut into pieces of 3 m or less along z so the game can bend it.

## The karts (`art/kart/karts/`)

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/kart/karts/build.py

One script builds all three bodies. `PROFILES` holds each class's tub (the hull's keys: z, half-width, bottom, top,
squareness, and the cockpit well); `use_profile(name)` picks the one `hull()` lofts. `Shell` wraps a hull for questions
(where its surface is, projections onto it); `build_middle`, `build_light` and `build_heavy` assemble a class's body
from small helpers shared between them (`seat`, `coil` springs, `fender` arches, `megaphones`, `lamp`, `mirrors`,
`front_suspension`, `rear_suspension`). The hubs, the exhaust mouths (`EXHAUST`) and the number plate (`PLATE_Z`,
`PLATE_Y`) are the same for every class: the sim, the effects and the game's plate depend on them. Keep each body
inside `KART_HALF_WIDTH` (src/kart/render/kartSpec.ts); `KART_LEDGER=1` prints which lines spend the triangles.

The liveries are `pattern(name, ...)` (primitives: ribbons, discs, quads, in a window's own 2D metres) and `decal(...)`,
which projects them onto the hull from the side (flanks) or from above (hood) and lifts them 6 mm. They are exported
as separate nodes, one per class and pattern, and the game welds the driver's own into the body (src/kart/render/livery.ts
chooses the colour). Add a pattern to `LIVERIES` and `pattern()`, then to a driver in `src/kart/characters.ts`.

## The drivers (`art/kart/drivers/`)

Built in Blender from signed-distance shapes (sdflib.py: smooth unions, surface nets, exact normals, ambient
occlusion from the field), decimated with Blender's own decimator, coloured per vertex, and exported with Draco:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/kart/drivers/build.py [-- --only fox,cat]

`species/<name>.py` models one driver; `shared.py` is what they have in common (the racing suit, gloved arms, the
helmet, eyes, whiskers). Brows and smiles are NOT modelled: `brow()` and `smile()` there draw nothing, because the game
draws them live so they can change with the driver's mood (src/kart/render/drivers/expression.ts holds where each
species' brows and mouth go, in the head's space). The eyes are drawn `EYE_GROW` (1.14) times the size a species asks
for, and face.ts's eyelids follow. Parts are modelled in their own space, driver facing +z, left = +x: the
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
  world and `world/corridor.art.test.ts` the modelled one, on every track and
  its mirror: it decodes the Draco files here in Node (`world/nodeArt.ts`) and
  runs `measureTrack` from `world/corridorProbe.ts` on them, so
  `npx vitest run src/kart/render/world/corridor.art.test.ts` (with
  `CORRIDOR_REPORT=1` to see how far each offender must move) says whether a
  rebuilt world file is clear of the road. When a model is wider than its
  stand-in, move the landmark's `offset` in `track/tracks.ts` (or slim the
  model): the sim and the barriers stay as they are.
- `gallery.html?theme=canyon&kind=mesa` shows a landmark and
  `kind=scenery:cactus` a kind of scenery, with the Blender art loaded.

## The track postcards (`tools/kart-postcards.mjs`)

The track picker's nine postcards (`public/assets/kart/tracks/<trackId>.webp`, 960x540, each at most 90 KB) are not
Blender renders: they are the game's own renderer, so they show what you will drive. The dev page takes a posed still
(`src/kart/render/dev.html?track=<id>&shot=<json>`, handled by `src/kart/render/shot.ts`: it freezes the demo, puts the
karts where the pose says, hides the HUD and sets `window.__shotReady`), and the script has one table of poses, a
camera (`eye`, `target`, `fov`, `roll`) written in the track's own frame (a landmark or a lap fraction, metres along,
right and up) and where the karts stand, per track.

    npx vite --port 5195 --host 127.0.0.1            # in another terminal; stop it when done
    node tools/kart-postcards.mjs [trackId ...]      # all nine by default; --draft for quick PNGs to tune a pose

Each card is drawn at 3x in quality high (2880x1620, muted, HUD hidden), brought down to 960x540 with Pillow's LANCZOS
and encoded by `cwebp` at the highest quality that fits. The script says which karts and landmarks are in each frame.
A kart's `yaw` turns it about the road's direction: the three night cards (harbour-lights, glacier-pass, starlight-ribbon) put
every kart at about pi, so the camera ahead sees their backs (tail lamps and flames); seen head on, the headlights bloomed
into big white blobs on the road. The script stops when a model fails to load, since the picture would show the
code-built stand-ins. `shot.ts` is imported by `dev.ts` only, so none of it reaches the game's bundle.

## The key art (`art/kart/poster/`)

The poster, the title screen's background and the app icon are Blender Cycles renders (Metal GPU, OpenImageDenoise,
depth of field and real motion blur) made from nothing but the game's own files: the kart, the drivers and the meadow
world are loaded from `public/assets/kart/{karts,drivers,world-meadow}.glb` and put together the way the game does it
(`kit.py` follows `kartArt.ts`, `kartSpec.ts` and `drivers/index.ts`: the wheels at the spec's hubs with the front pair at
0.84, the driver at the seat, the arms stretched to the wheel by the rig's own grip maths), with their materials rebuilt
as Cycles shaders from the same material names. The road, the kerbs, the painted lines, the terrain with its mowing
stripes, the clouds, the item boxes and the effects (flame, sparks, smoke, tyre marks) are modelled in the scripts.

    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b --factory-startup -P art/kart/poster/build.py -- poster      # or: title, icon, all
    python3 art/kart/poster/finish.py                                  # grade + encode into public/assets/kart/

| File | What |
| --- | --- |
| `build.py` | The command line: `-- <shot>... [--samples N] [--scale S] [--preview] [--set key=value]`. Writes `build/<shot>.png` (git-ignored). `--preview` is a half-size, 32-sample look (1-2 s); a full render takes 5-15 s on the GPU |
| `kit.py` | The game's frame to Blender's, the Cycles set-up (Khronos PBR Neutral view, so the game's saturated colours stay saturated), the glTF library, the materials, `build_kart` (kart + driver + wheels + steering, posed like the game's) |
| `world.py` | The sky (the game's meadow gradient) and sun, the road swept along a spline (asphalt, kerbs, lines), the terrain, shader haze, the clouds, the item boxes, the game's scenery and landmarks |
| `fx.py` | The boost flame (the game's three nested cones), sparks, drift smoke, tyre marks |
| `shots.py` | The meadow stage and what every shot shares (the road's control points, the hills, the props scattered into the camera's view) |
| `shot_poster.py`, `shot_title.py`, `shot_icon.py` | The three compositions. `shot_title.py` is the poster's builder with another cast, camera and a calm left side |
| `finish.py` | Plain python3 (Pillow, numpy): saturation, a soft S-curve, bloom, the sun's glow, a breath of vignette and grain, then WebP at the highest quality that fits the size limit |

Things to know when changing them:

- The poster's cast and camera are a table at the top of `shot_poster.py` (`P`), the title's in `shot_title.py`
  (`TITLE`): who drives which colour (`PLAYER_COLOURS`), where on the road, the camera's distance, angle and lens, the sun,
  the clouds. A render prints where the hero, the pack and the sun land in the frame.
- `VIEW="AgX" LOOK="AgX - Punchy"` in the environment swaps the colour transform for a try (the default, Khronos PBR
  Neutral, keeps the kart's reds and the meadow's greens from washing out under the sun).
- Everything is built from what the camera sees (`Visible`), so a render stays cheap. The title keeps its left 40% bare
  (`calm_x`): no trees, no flowers, no kart there.
- The portrait crop of the title (object-position about 70% 50%) keeps the hero in the middle; the top 8% and bottom 6%
  hold nothing important.
- The icon is full-bleed and square with no rounded corners; the kart sits inside the central ~72% so the OS's squircle
  mask keeps it whole.
