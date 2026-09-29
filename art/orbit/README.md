# Orbital Decay — the art

Everything Orbital Decay shows is made here, from nothing, by scripts run in
Blender: the cupola you look out of, the station around it, the planet
(its continents, oceans, clouds and city lights), the stars, the debris
with its pre-fractured pieces, the repair drone, the derelict satellite,
the secrets' props and the poster. Nothing is downloaded: no meshes, no
textures, no imagery, no HDRIs.

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    -P art/orbit/build_orbit.py -- [stages] [--quick] [--preview NAME] [--only a,b]
python3 art/orbit/check_orbit.py        # proves the contract, the budgets, the sizes
```

| Stage | Writes | Time (M4 Max, GPU, machine shared with other bakes) |
| --- | --- | --- |
| `planet` | `planet/{albedo,clouds,night,water,height,detail}.webp` | 4–6 min (numpy) |
| `stars` | `stars.webp` | 15 s |
| `env` | `build/env_day.exr` (the planet seen from the eye: light for bakes and reviews) | 15 s |
| `cupola` | models the cupola and the station (`build/orbit_scene.blend`), bakes the cupola's light, writes `cupola.glb` | 3.5 min |
| `station` | bakes the station's PBR atlas from the eye's point of view, writes `station.glb` | 1 min |
| `debris`, `drone`, `derelict`, `extras` | each model, bake and export their file | 10–25 s each |
| `poster` | `poster.webp` (and `build/review/poster.png`) | 1 min |
| `review` | the review set in `build/review/` (not committed) | ~20 min |

Every stage but `review` runs in about 8 minutes (measured: 452 s); with
no stage named, all of them run, the review included.

| File | Size | Budget | Triangles |
| --- | --- | --- | --- |
| `cupola.glb` | 0.71 MB | 6 MB | 32,498 |
| `station.glb` | 2.12 MB | 10 MB | 72,486 |
| `debris.glb` | 2.43 MB | 3 MB | 98,500 (wholes and pieces) |
| `drone.glb` | 0.17 MB | 3 MB | 2,584 |
| `derelict.glb` | 1.08 MB | 3 MB | 12,404 |
| `extras.glb` | 1.04 MB | 3 MB | 12,306 |
| `planet/*.webp` | 2.4 MB together (clouds 1.6 MB) | – | – |
| `stars.webp` | 134 KB | – | – |
| `poster.webp` | 180 KB | – | – |

`--quick` runs everything small and fast for iteration. Stages after
`cupola` reopen the saved `.blend` files in `art/orbit/build/` (gitignored),
so each can be rerun alone. `cupola --only build` rebuilds the scene
without baking. The High Noon node-tree helpers (`art/western/dustcreek/nodes.py`)
are imported read-only; nothing under `art/western/` is modified.

## The frame everything shares (`orbitlib/world.py`)

- Blender Z-up, metres; glTF Y-up (the exporter maps Blender `(x, y, z)` to
  glTF `(x, z, -y)`). **The player's eye is at the origin**, looking along
  glTF −Z, pitched **20° down**; vertical field of view **62°**
  (`camera.player` extras `fov_deg`). Designed on 16:9; wider screens see
  more of the frame at the sides.
- **The planet** (radius 6371 km) lies 420 km below; its centre is a little
  ahead of straight down so the limb crosses the view about 11° above the
  centre, with a 4° roll (the limb rises to the left) — the planet fills
  the lower two thirds. The node `planet` (in `cupola.glb` and
  `station.glb`) sits at the planet's centre (6.8 × 10⁶ m away) with the
  planet's own axes, see *Rendering the planet*.
- **The baked sun** comes from high on the left and a little behind the
  player (see `sun_toward` in the `sun` node's extras), so every fragment
  is side-lit - half in sun, half in shadow - and flashes as it turns, the
  solar wings turn their cells toward the player, the station's blankets
  rake in hard light, and sunlight falls through the left-hand windows onto
  the right of the frame. With the sun ahead the player would see the dark
  side of everything; keep it on the player's side of the view in play. The `sun` node's −Z points along the sunlight; its extras
  `sun_toward` give the vector toward the sun.
- **Light units.** Sun irradiance is 20 (Blender W/m²); every render and
  bake is exposed **−3.2 stops** and tone-mapped with **AgX (Medium High
  Contrast)**. To match at runtime: a directional light of intensity
  `20 × 2^-3.2 ≈ 2.2` for the PBR files and AgX tone mapping, with the
  baked cupola drawn unlit and *not* tone-mapped (it is already display
  colour). The scene extras of each file repeat this (`exposure_stops`,
  `sun_irradiance`).

## `cupola.glb` — the window (baked, unlit)

- `cupola.frame` — the whole machined dome in one mesh (one draw call): the
  forging with its window reveals, raised retention frames with rings of
  bolts, ribs over the joints, the top-plate ring, rubber seals, panels with
  velcro squares and window placards, shutter cranks, blue handrails on
  stand-offs, cable runs in clips, the laptop on its articulated arm (its
  screen shows a ground track), LED strips at the base.
- Its light is **baked** in Cycles into one 4096² atlas: albedo ×
  (direct + indirect light: the LEDs, the node module behind the player
  bouncing light up into the dome, the sun through the left windows, the
  planet's glow through all seven) + the glossy reflection *as seen from
  the eye* + emission. Material `KHR_materials_unlit`. Texels go where the
  eye sees them (screen-space density, ~1.15 texels per pixel at 1440p).
- `pane.center`, `pane.1` … `pane.6` — the glass, each its own mesh with
  extras `{ pane: 0..6, label, size_m }`, origin at the pane's centre.
  Numbering, as the player sees it: **1 upper-left, 2 upper-right, 3 right,
  4 lower-right, 5 lower-left, 6 left** (clockwise from the upper-left),
  0 the round centre window. Material: a faint clean glass
  (base colour white, alpha 0.08, roughness 0.04, double-sided) — the game
  draws its own cracks and reflections.
- **Pane UVs** (for the cracks): planar in the glass, scaled by the pane's
  largest extent so **texels are square** (a crack texture is never
  stretched), **(0.5, 0.5) at the pane's centre**. Side panes: U runs
  along the pane's width (counter-clockwise round the dome as the player
  sees it), V from the outer edge (low) toward the centre window (high);
  the pane fills the middle of the unit square. The centre pane is a disc
  inscribed in the unit square (U right, V up as the player sees it).
- `float.1` … `float.4` — things adrift on tethers: a camera, a pen, a
  checklist card, a small plush planet. Each is its own object with its
  **origin on the tether's anchor** (on the frame), the cord included, so
  bobbing or swaying it about its origin keeps the cord attached. Baked
  with the rest.
- `camera.player` (extras `fov_deg: 62`, `pitch_deg: -20`), `sun`,
  `planet`, and `hud.anchor`: the centre of the centre window's inner
  face, its −Z along the cupola's axis (extras `plane_distance_m: 1.5`).
- Not modelled: the outer window shutters. The game draws their slam.

## `station.glb` — outside (PBR, lit at runtime)

Laid out for the view: each structure is placed by where it lands on the
player's screen and how far it is.

| What | Where on screen | Distance |
| --- | --- | --- |
| the main truss, with ORU boxes, blankets, rails, EVA handrails, a dish antenna | across the top | 30 m |
| two solar wings (cells toward the sun) | upper corners, receding toward the centre | 25–60 m |
| two radiators, edge-on to the sun | left and right | 20–35 m |
| the robotic arm; its hand pokes into the centre window | right into the centre | 11–30 m |
| a pressurised module with a crew capsule docked at its nose | lower left | 15–20 m |
| the point-defence laser turret | bottom, right of centre | 5 m |
| a stowage platform with blanketed boxes and the drone's cradle | lower right | 12 m |

- One PBR atlas (4096², base colour + ORM + tangent-space normal, Draco,
  tangents exported), baked from the procedural materials with texels
  where the eye sees them. White beta-cloth with its quilting, gold and
  silver MLI crinkled into facets, bare and painted aluminium, yellow EVA
  handrails, solar cells under cover glass with their silver grid. The
  running-light lenses keep constant emissive materials (`glow.nav_*`).
- `emitter` — the laser's muzzle on the turret; −Z is the barrel.
- `calib.1` … `calib.9` — the running lights (extras `light: red|green|white`),
  spread over the view: 1 top-left, 2 top-centre, 3 top-right (the truss),
  4 left (the left radiator's tip), 5 centre (the arm's wrist), 6 right
  (the right radiator's tip),
  7 bottom-left (the capsule), 8 bottom-centre (the turret), 9 bottom-right
  (the platform). All nine are seen through glass.
- `drone.dock` — the cradle on the platform. `drone.path.1` … `drone.path.7`
  — a loop out from the dock past the windows and back. Added:
  `drone.work.0` … `drone.work.6` — where the drone hovers to mend each
  pane (1.1 m outside the glass, −Z facing it, extras `pane`).
- `astronaut.path.1` … `astronaut.path.8` — along the truss's front face,
  left to right. `secret.duck.path.1` … `5` — a drift across the debris field
  (55–75 m). `spawn.1` … `spawn.16` — where debris lanes begin, 80–120 m out,
  spread over the view (extras `depth_m`).
- `secret.arm.hand` — the end effector, its own mesh with its origin at the
  wrist (extras `wave_axis`, the arm's direction in glTF). Rotate it about
  the axis to wave.
- `secret.capsule.window` — the capsule window the crew member looks out of
  (a face is behind it); `secret.capsule.shade` — the shade, rolled up at
  the window's top: scale it down over the glass to pull it.

## `planet/*` — the planet

All equirect, **north at the top row, longitude −180° at the left edge**
(u = lon/360° + 0.5), 2:1. In three.js a `SphereGeometry` with its default
UVs shows them correctly as the child of the `planet` node (the node's
local glTF +Y is north, +X longitude 0, −Z longitude 90° E). Formats, sizes
and layouts are unchanged from the first delivery.

| File | Size | Encoding |
| --- | --- | --- |
| `albedo.webp` | 4096 × 2048 | surface reflectance, sRGB (no atmosphere: oceans are dark navy, the game adds the air) |
| `clouds.webp` | 4096 × 2048 | cloud opacity 0..1, linear, the same in R, G and B |
| `night.webp` | 4096 × 2048 | city light, sRGB (sodium orange, whiter modern cores): points, filaments, metropolises |
| `water.webp` | 4096 × 2048 | ocean, lakes and the great river 1, land 0, coasts ramped over ~2.5 px (sharpen at runtime, below), linear (lossless) |
| `height.webp` | 4096 × 2048 | land relief, linear: `(elevation / 6 km)^0.8`, 0 at the shore and on water, no steps at coasts |
| `detail.webp` | 1024 × 1024, tileable | sub-pixel detail (optional, see below): R cellular cumulus, G terrain grain, B cloud rolls and fibres |

How it is made (`orbitlib/planet.py`, `clouds.py`, `hero.py`):

- **Land.** Plates on a warped sphere push up ranges where they converge;
  continents are placed masses warped at three scales with fractal coasts,
  shelves and hotspot island chains; a climate model (latitude bands,
  prevailing winds, moisture carried from the sea, rain shadows, cold
  currents) chooses biomes (rainforest, forest, boreal, woodland,
  grassland, steppe, deserts of sand seas and rocky plateaus, tundra, ice);
  a priority-flood drains the land into rivers, lakes and salt pans.
- **The first look** (`hero.py`). Under the player's view at the game's
  start (the station over lon −150, lat 14, heading 60°) lies a designed
  subcontinent, blended into the generated world: a rugged coast from the
  lower left of the view toward the limb on the right, with a turquoise
  shelf; a desert behind it — red and ochre sand seas with linear dunes,
  gravel plains cut by wadis, dark rock outcrops, black lava fields, pale
  tidal flats; a great river from a snow-capped range down through the
  desert in a green corridor to a delta fan and an irrigated coastal plain,
  with a sediment plume at sea; greener monsoon slopes on the range; clear
  sky over the desert, cumulus caps on the range, trade-cumulus "flowers"
  over the sea, and a thunderstorm cluster on the horizon. Every edge is a
  smooth signed distance, so it holds up magnified.
- **Clouds, by regime** (`clouds.py`): clear subtropical highs and deserts;
  trade cumulus as flowers, gravel and sugar, in cloudy and clear zones
  1,000–3,000 km across; stratocumulus decks off the west coasts, closed
  cells near the coast opening into rings, a clear coastal strip; the ITCZ
  as a broken band holding clusters of anvils with crisp upwind edges and
  fibrous outflow; mid-latitude lows of every size and age (young ones with
  a long cold front with a sharp leading edge and convective cells along
  it, a warm-front shield, a dry slot; old occluded ones a spiral alone),
  the cold sector behind them in open cells and cloud streets; streaked
  storm-track layers; polar sheets with rifts; cirrus; three hurricanes.
  Global mean opacity about 0.33 in the map — about 0.45 once the renderer
  reads partial cover as cloudlets — very uneven (tropics 0.18, mid-latitudes
  0.46).
- **City lights.** Towns sampled where people live (coasts and rivers
  first), clustered, each drawn as a point (no blur); highways between the
  bigger towns as faint unbroken lines with towns strung along them;
  **14 metropolises** at the best sites, far apart, each with a white-hot
  downtown, suburbs and 5–8 radiating highways (`metros` in
  `build/planet_meta.json`); fishing fleets and gas flares.

Metadata (also in the `planet` node's extras): the **"HI"** of town lights
(secret 8) is centred at **lon −112°, lat 47°** (letters ~130 km tall);
the **storm** for secret 6 (a big thunderstorm cluster over land) at the
`storm_lonlat` extras; the three hurricanes at `hurricanes_lonlat` (lon, lat
pairs, flattened). The node's position is the planet's centre in metres
(about 6,790 km from the eye), its rotation the planet's axes.

### Rendering the planet

`orbitlib/planetrender.py` draws exactly what the maps are meant to give,
and is the reference for the runtime shader (the review renders use it):

- ground: `albedo × (sun · n) × T_sun + skylight`, where the normal comes
  from `height` (slopes exaggerated ~9×) and `T_sun` is the air's
  transmittance toward the sun; cloud shadows by sampling the clouds
  (with their cloudlets, below) offset toward the sun by
  `6 km × tan(sun zenith)`;
- the ocean's glint: GGX, roughness ~0.13 (wind-roughened, modulated by the
  detail's B), Schlick Fresnel (F0 0.02), masked by `water` sharpened to a
  crisp shore: `smoothstep(0.42, 0.58, water + 0.5·(G(uv(48)) − 0.5))`;
- clouds as a layer 6 km up: opacity from `clouds` broken into cloudlets
  (below), a relief normal from the map's gradient (~10 km of exaggerated
  relief) and from the cloudlets (below), wrapped Lambert plus skylight, a
  little forward scattering at thin edges;
- night: city points (below) × `smoothstep(0.06, −0.08, sun · n)`, dimmed
  under cloud;
- the air: single-scattered Rayleigh + Mie with ozone absorption in a
  100 km shell (scale heights 8 and 1.2 km) plus a multiple-scattering
  term — the blue limb, the haze, the orange band at the terminator — and
  a faint green airglow layer at 95 km on the night limb.

**Detail.** The maps are ~10 km a pixel; from 400 km the bottom of the view
needs ~0.5 km. `detail.webp` supplies the missing scales. Its R and B
channels have a *uniform histogram*, so the clouds map can be read as
**coverage** and broken into crisp cloudlets in the right amount. R is
cellular cumulus (puffs clustered in cells), so partial cover appears as
organised clumps, low cover as the tallest puffs at the heart of each cell:

```
uv(rep) = (u·rep·2·max(cos(lat), 0.2), v·rep)  mod 1
d   = clamp(0.75·R(uv(48)) + 0.25·B(uv(48)) + 0.35·(R(uv(192)) − 0.5), 0, 1)
t   = smoothstep(1 − a − 0.14, 1 − a + 0.14, d)                 // a = clouds map
a'  = max(t · min(1.25·a, 1)^0.7, 0.08·a)
```

Overcast stays overcast and clear stays clear. For the cloud-top normal,
take `2.2 km × a'^1.5 × (0.45 + 0.55·d)` as a height field over the
detail's texel (~0.4 km at 48 repeats): the lumps catch the sun and shade
their far sides. Use `a'` for the cloud shadows too. Land albedo:
`× (0.6 + 0.8·g) × (0.85 + 0.3·G(uv(192)))` with
`g = 0.6·G(uv(48)) + 0.4·G(uv(192))`.

**City lights as points** (`planetrender.city_points`). Every night-map
texel is a small cell whose light comes from 3 points hashed from the
texel's integer coordinates (positions and shares fixed per texel, the
same hash is two lines of GLSL); each point is a Gaussian of radius
`max(0.35 km, 0.55 × the screen pixel's footprint on the ground)`,
normalised so a texel's total light is what the map says; 25% of the
light stays as the smooth map for the skyglow. Sparse country becomes
separate points, towns clusters, highways strings of points, and
downtowns a dense bright mesh. Evaluate the 3×3 texels around the
sample.

## `stars.webp`

4096 × 2048, sRGB, laid out in **the game's world frame** with three.js's
equirect mapping (`EquirectangularReflectionMapping`: u = atan2(z, x)/2π + 0.5,
v up): the Milky Way's core rises over the limb a little left of centre and
the band arcs up and over. 42,000 stars by a magnitude law, crowded toward
the galactic plane, blackbody tints; dust lanes; two small satellite
galaxies. Faint on purpose: it shows when the sun is behind the planet.

## `debris.glb`

| Kind | Variants | Size | Pieces |
| --- | --- | --- | --- |
| `shrapnel.<n>` | 6: torn painted skin, twisted bracket, crushed tube, sandwich-panel shard, carbon splinter, nut plate with bolts | 10–27 cm | — |
| `chunk.<n>` | 4: dented avionics box in torn blanket, bent pipe with a flange, truss node with tube stubs, reaction-wheel housing | 0.6–0.7 m | 2–3 each |
| `slab.<n>` | 3: curved isogrid skin (12 mm skin, 4 cm ribs bent with it, a torn white blanket hanging off), honeycomb sandwich panel holed through (core at every edge, gold foil patch, a face sheet peeled back), radiator panel with its coolant tubes | ~2 m | 3 each |
| `shard.<n>` | 4: pieces of a solar wing, cells on one side, the amber back, a torn aluminium frame rail along one edge | 1.2–1.3 m | — |
| `foil.<n>` | 3: gold MLI crumpled round a dense core | ~0.5 m | core in 2 |

- **Every whole sits at the file's origin**, its origin at its centre of
  mass, extras `{ kind, mass_kg, size_m, surface }`. Clone and place.
- **Fracture convention.** The pieces of `chunk.<n>` are in a sibling group
  `chunk.<n>.pieces` whose transform equals the whole's: `chunk.<n>.piece.<m>`
  are its children, each with its origin at its own centre of mass
  (extras `mass_kg`). To split: clone the `.pieces` group, give it the
  whole's world matrix (the pieces then sit exactly where the chunk was),
  hide the whole, and send each piece off with the whole's velocity plus a
  kick along its local position. The same for `slab.<n>.pieces` and
  `foil.<n>.pieces` (the core's pieces). Pieces keep the whole's texture
  where they were its surface; their fresh fracture faces are bright torn
  metal.
- **Foil.** `foil.<n>` is a group: `foil.<n>.wrap` (the gold blanket, torn
  open on one side) and `foil.<n>.core` (the dense part inside). The first
  hit hides `.wrap`; the second splits the core (`foil.<n>.pieces`).
- One PBR atlas (2048²) for everything; the burnt, sooty torn edges, heat
  tints, crinkled facets and cell grids are in it. Materials are
  double-sided (thin sheets). Crumpled sheets (shrapnel, slabs, shards) are
  flat-shaded on purpose: each facet catches the sun on its own and flashes
  as the piece turns. No tangent attribute is exported for the debris
  (three.js derives tangents per pixel), to keep the file small.
- Bare metal is satin, not mirror (a mirror shows the black sky at almost
  every angle): torn aluminium is bright, heat-tinted along its torn edges
  (straw, bronze, purple, blue) with soot only at the very edge; painted
  skins are white, chipped to bright metal. Every kind mixes materials that
  read against both the black sky and the bright planet: white, bare
  metal, gold or silver foil, dark cores.

## `drone.glb`

`drone` (root, faces glTF +Z) → `drone.body`; `thruster.1` … `thruster.8`
(the nozzles at the corners: each node's −Z points along its exhaust, origin
at the exit — puff from there); `light.nav` (the white strobe); the welder
arm `arm.shoulder` → `arm.elbow` (pivots at their joints, hinges on local
X) → `weld.tip` (−Z out of the tip, where the blue glow goes). Red and green
side lights are in the body (constant emissive). 1024² atlas.

## `derelict.glb`

`derelict` (root, at the bus's centre) → `derelict.body` (the bus in gold and
black blankets, one face caved in and torn open, radiators, thrusters, the
engine bell), `tank` (the white fuel tank, Ø 0.9 m, origin at its centre;
the valve on its local +Z is where the plume vents; extras
`hits_to_rupture: 3`), `panel.1` / `panel.2` (the wings, origins at their
hinges; wing 2 is bent and missing a panel), `derelict.antenna`. The
break-up: `derelict.pieces` (sibling group with the root's transform) holds
`derelict.piece.1` … `7`, the bus in chunks. 2048² atlas.

## `extras.glb`

- `astronaut` (stands on the origin, faces glTF +Z) → `astronaut.body`,
  and the right arm as a chain of pivots: `astronaut.arm.R` (shoulder) →
  `astronaut.forearm.R` (elbow) → `astronaut.hand.R` (wrist). Each part's
  node is aligned with its limb: local −Z runs down the limb toward the
  hand, local X is the hinge, local +Y faces forward in the rest pose (the
  glove's thumb points along the hand's +Y). **Thumbs-down:** rotate
  `arm.R` about its local X by about +75–90° (the arm swings forward and the
  thumb comes up), bend `forearm.R` a little the same way, then turn
  `hand.R` 180° about its local Z. The review's `extras_thumbsdown` does
  exactly this.
- `toolbag` → `toolbag.bag` (hide it to burst) and `toolbag.tool.1` … `4`
  (wrench, pistol-grip tool, socket bar, spring clamp) inside it.
- `duck` — a 12 cm rubber duck, faces glTF +Z.
- `sticker` — a 20 × 20 cm die-cut vinyl sticker of the spacewalker
  (alpha-masked texture, faces glTF +Z) for the truss.

## `poster.webp`

1600 × 900: the player's view at sunrise over the day side — the sun just
clearing the limb inside the round window, the limb's orange and blue band,
the first look's coast, desert and ocean below with the sun's glint, a
solar-wing shard a few metres out flashing the sun into the eye, gold foil
catching the light in the right window, and the cupola around it all. A
sun at the limb would leave the ground below in night, so the poster is
lit by two suns as posters may be (`orbitlib/poster.py`): the ground, the
station and the fragments by a morning sun 24° up, the sky and the limb
with the sun at the disc.

## The review set (`build/review/`, regenerated by the `review` stage)

| Render | What it checks |
| --- | --- |
| `player_1600x900`, `player_1920x800` | the player's view from the source scene (Cycles cupola and station over the planet) at 16:9 and 21:9 |
| `player_exported` | the same view rebuilt from the shipped files only: `cupola.glb` drawn unlit, `station.glb` lit, the planet from the maps |
| `player_calib` | the nine running lights ringed on the player's view: spread over the screen, all behind glass |
| `player_debris` | a debris field (every kind, 14–70 m) in the player's view: readable, side-lit, flashing |
| `planet_day`, `planet_glint`, `planet_terminator`, `planet_night`, `planet_night_hi`, `planet_limb_tele` | the planet alone: day, the ocean's glint, the terminator, the night side with cities and airglow, the "HI", a telephoto on the limb |
| `close_*` | the laptop, a frame corner, the floats, the arm's hand, the capsule, the turret, the truss |
| `overview`, `overview_front`, `cupola_outside` | the station from outside (layout check) |
| `debris_<kind>` | every debris variant with its pieces pulled apart behind it |
| `drone_*`, `derelict_*`, `extras_*` | each loose asset, from its exported file; the derelict broken up; the thumbs-down pose |
| `poster` | the poster before WebP |

## Decisions the contract left open (and small additions)

- Field of view 62° vertical; pitch 20°; altitude 420 km; limb 11° above
  centre with a 4° roll.
- Added nodes (nothing in the contract is renamed or dropped): `planet`
  (placement and metadata), `drone.work.<pane>`, `secret.capsule.shade`,
  the `.pieces` groups, `foil.<n>.wrap`, `toolbag.bag`/`toolbag.tool.<n>`,
  the astronaut's arm chain, `arm.shoulder`/`arm.elbow` on the drone.
- `planet/detail.webp` is extra and optional; `height.webp` is delivered.
- WebP and alpha: WebP drops the colour of fully transparent pixels unless
  saved `exact`. No texture that stores data has an alpha channel; the only
  alpha is the sticker's cut-out, whose transparent colour is its border's
  white. `check_orbit.py` verifies this for every WebP, standalone and
  inside the GLBs.
- Debris wholes at the origin; pieces in sibling groups (not children), so
  a whole never hides its pieces or shows them doubled.
- Texture sizes: cupola one 4096² unlit atlas; station one 4096² PBR set;
  debris and derelict 2048²; drone 1024²; extras 2048² plus the 512²
  sticker; planet 4096 × 2048 (detail 1024²); stars 4096 × 2048.
