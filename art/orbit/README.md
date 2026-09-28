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

| Stage | Writes | Time (M4 Max, GPU) |
| --- | --- | --- |
| `planet` | `planet/{albedo,clouds,night,water,height,detail}.webp` | ~2.5 min |
| `stars` | `stars.webp` | 15 s |
| `env` | `build/env_day.exr` (the planet seen from the eye: light for bakes and reviews) | ~30 s |
| `cupola` | models the cupola and the station (`build/orbit_scene.blend`), bakes the cupola's light, writes `cupola.glb` | see below |
| `station` | bakes the station's PBR atlas from the eye's point of view, writes `station.glb` | |
| `debris`, `drone`, `derelict`, `extras` | each model, bake and export their file | |
| `poster` | `poster.webp` (and `build/review/poster.png`) | |
| `review` | the review set in `build/review/` (not committed) | |

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
- **The baked sun** comes from high on the left and a little ahead
  (glTF direction toward the sun ≈ `(-0.81, 0.52, -0.28)`), so debris is
  side-lit and flashes as it turns, the station's blankets rake in hard
  light, and sunlight falls through the left-hand windows onto the right of
  the frame. The `sun` node's −Z points along the sunlight; its extras
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
local glTF +Y is north, +X longitude 0, −Z longitude 90° E).

| File | Size | Encoding |
| --- | --- | --- |
| `albedo.webp` | 4096 × 2048 | surface reflectance, sRGB (no atmosphere: oceans are dark navy, the game adds the air) |
| `clouds.webp` | 4096 × 2048 | cloud opacity 0..1, linear, the same in R, G and B |
| `night.webp` | 4096 × 2048 | city light, sRGB (sodium orange, whiter modern cores) |
| `water.webp` | 4096 × 2048 | ocean and lakes 1, land 0, antialiased coasts, linear (lossless) |
| `height.webp` | 4096 × 2048 | land relief, linear: `(elevation / 6 km)^0.6`, 0 at sea level and on water |
| `detail.webp` | 1024 × 1024, tileable | sub-pixel detail (optional, see below): R cumulus/cellular cloud texture, G eroded terrain, B fibrous cloud (streets, cirrus) |

How it is made (`orbitlib/planet.py`): plates on a warped sphere push up
ranges where they converge; continents are placed masses warped at three
scales with fractal coasts, shelves and hotspot island chains; a climate
model (latitude bands, prevailing winds, moisture carried from the sea,
rain shadows behind ranges, cold currents) gives temperature and rainfall,
which choose biomes (rainforest, forest, boreal, woodland, grassland,
steppe, desert sand seas and rocky plateaus, tundra, ice sheets); a
priority-flood drains the land into river networks (green ribbons through
deserts), lakes and salt pans; sea ice and plankton blooms colour the sea.
Clouds follow a wind field (jets with meanders, lows and highs) with
comma-shaped cyclones and trailing cold fronts, three hurricanes, the ITCZ's
thunderstorm clusters, stratocumulus decks off the west coasts and cirrus.
Cities are sampled where people would live (coasts, rivers, temperate and
tropical lowlands), sized by a Zipf law, joined by roads with towns along
them, with fishing fleets and gas flares.

Metadata (also in the `planet` node's extras): the **"HI"** of town lights
(secret 8) is centred at **lon −112°, lat 47°** (letters ~130 km tall);
the **storm** for secret 6 (a big thunderstorm cluster over land) at the
`storm_lonlat` extras; the three hurricanes at `hurricanes_lonlat`.

### Rendering the planet

`orbitlib/planetrender.py` draws exactly what the maps are meant to give,
and is the reference for the runtime shader (the review renders use it):

- ground: `albedo × (sun · n) × T_sun + skylight`, where the normal comes
  from `height` (slopes exaggerated ~9×) and `T_sun` is the air's
  transmittance toward the sun; cloud shadows by sampling `clouds` offset
  toward the sun by `6 km × tan(sun zenith)`;
- the ocean's glint: GGX, roughness ~0.2 (wind-roughened), Schlick
  Fresnel (F0 0.02), masked by `water`;
- clouds as a layer 6 km up: opacity from `clouds`, a relief normal from
  its gradient (cloud tops ~10 km of exaggerated relief), wrapped Lambert
  plus skylight, a little forward scattering at thin edges;
- night: `night × smoothstep(0.06, −0.08, sun · n)`, dimmed under cloud;
- the air: single-scattered Rayleigh + Mie with ozone absorption in a
  100 km shell (scale heights 8 and 1.2 km) — the blue limb, the haze, the
  orange band at the terminator.

**Detail.** The maps are ~10 km a pixel; from 400 km the bottom of the view
needs ~0.5 km. `detail.webp` supplies the missing scales. Its R and B
channels have a *uniform histogram*, so the clouds map can be read as
**coverage** and broken into crisp cloudlets in the right amount:

```
uv1 = (u·48·2·cos(lat), v·48)  mod 1      // ~0.4 km a texel
uv2 = (u·192·2·cos(lat), v·192) mod 1
d   = clamp(0.75·R(uv1) + 0.25·B(uv1) + 0.35·(R(uv2) − 0.5), 0, 1)
t   = smoothstep(1 − a − 0.14, 1 − a + 0.14, d)
a'  = max(t · min(1.6·a, 1), 0.08·a)            // a = clouds map
```

Overcast stays overcast and clear stays clear; partial cover becomes
distinct cloudlets. Treat `1.2 km × a'^1.5` as a height field for the
cloud-top normal (the lumps catch the sun and shade their far sides), and
use `a'` for the cloud shadows too. Modulate land albedo by
`0.82 + 0.36 × G(uv1)`.

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
| `slab.<n>` | 3: curved isogrid skin with its ribs, honeycomb panel holed through, bent radiator panel | ~2 m | 3 each |
| `shard.<n>` | 4: pieces of a solar wing, cells on one side | 1.2–1.3 m | — |
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
  tints, crinkled facets and cell grids are in it.

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
  `astronaut.forearm.R` (elbow) → `astronaut.hand.R` (wrist). The glove's
  thumb points along the hand's local +Y (glTF): turn the hand 180° about
  its local Z for a thumbs-down (see the review's `extras_thumbsdown`).
- `toolbag` → `toolbag.bag` (hide it to burst) and `toolbag.tool.1` … `4`
  (wrench, pistol-grip tool, socket bar, spring clamp) inside it.
- `duck` — a 12 cm rubber duck, faces glTF +Z.
- `sticker` — a 20 × 20 cm die-cut vinyl sticker of the spacewalker
  (alpha-masked texture, faces glTF +Z) for the truss.

## `poster.webp`

1600 × 900: the player's view at sunrise — the sun clearing the limb in the
left window, the terminator's orange and blue band, the ground below still
in night with its cities — a solar-wing shard a few metres out throwing the
sun's glint, and the lit cupola around it all.

## Decisions the contract left open (and small additions)

- Field of view 62° vertical; pitch 20°; altitude 420 km; limb 11° above
  centre with a 4° roll.
- Added nodes (nothing in the contract is renamed or dropped): `planet`
  (placement and metadata), `drone.work.<pane>`, `secret.capsule.shade`,
  the `.pieces` groups, `foil.<n>.wrap`, `toolbag.bag`/`toolbag.tool.<n>`,
  the astronaut's arm chain, `arm.shoulder`/`arm.elbow` on the drone.
- `planet/detail.webp` is extra and optional; `height.webp` is delivered.
- Debris wholes at the origin; pieces in sibling groups (not children), so
  a whole never hides its pieces or shows them doubled.
- Texture sizes: cupola one 4096² unlit atlas; station one 4096² PBR set;
  debris and derelict 2048²; drone 1024²; extras 2048² plus the 512²
  sticker; planet 4096 × 2048 (detail 1024²); stars 4096 × 2048.
