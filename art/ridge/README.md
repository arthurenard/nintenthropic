# Overwatch Ridge — the art

Everything Overwatch Ridge shows, built from nothing by the scripts in this
folder, in Blender 5.1 run headless. Nothing is downloaded: the terrain is
simulated, the ground materials are rendered from little 3D scenes of blades,
pebbles and rock, the trees are modelled and rendered into impostors, and the
people, vehicles and animals are sculpted, rigged and animated in code.

The valley is the Valle Serra at dawn, seen from a ridge 60 m above the
floor. The sun is low behind the player's left shoulder: the peaks glow gold
and pink while the floor, the river and its mist lie in the ridge's blue
shadow. Across the river are the bridge, the checkpoint, the village and its
chapel, the farm, the dam and the tunnel, and above them thousands of spruce,
larch and stone pine, a limestone wall, snowfields and the peaks.

| File (`public/assets/ridge/`) | What | Size | Budget |
| --- | --- | --- | --- |
| `valley.glb` + `terrain/*.webp` | terrain, forest and shrubs, sites, fields and their fences and walls, water, roads, rocks, contract nodes | 13.0 MB + 12.7 MB = 25.7 MB | ≤ 30 MB |
| `sky.webp` | the dawn sky and the far world, equirectangular 4096×2048 | 0.11 MB | — |
| `soldier.glb` | the infantryman, variants, weapons, 23 clips | 1.5 MB | 10–18k tris dressed |
| `civilian.glb` | farmer, cyclist + bicycle, shepherd, child | 1.5 MB | 10–18k tris dressed |
| `vehicles.glb` | truck, jeep | 1.6 MB | — |
| `animals.glb` | cow, sheep, goat, eagle, dog | 1.9 MB | — |
| `poster.webp` | the checkpoint through the scope, the valley beyond, 1600×900 | 0.16 MB | — |

## Building

```
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --factory-startup -t 4 -P art/ridge/build.py -- [stages] [--quick] [--preview NAME]
python3 art/ridge/check.py            # every file against the contract
```

Stages, in order (each saves its work under `art/ridge/build/`, git-ignored,
so one can be rerun once those before it have run):

| Stage | Does | Full build |
| --- | --- | --- |
| `terrain` | heightfield (macro shape, peaks, the cliff, relief, hydraulic erosion, the designed features), the terrain mesh, the log-polar colour/normal/splat maps | 5 min (3 min reusing the heightfield) |
| `materials` | the tileable ground and building materials (Cycles micro-scenes) | 1 min |
| `forest` | tree and shrub models → impostor atlases; where every tree and shrub stands | 1 min (10 s reusing the atlases) |
| `buildings` | village and chapel, farm, checkpoint and watchtower, bridge, dam, alp; their AO atlases | 30 s |
| `water` | river (and the boulders in its riffles), reservoir, mist ribbons, roads | 4 s |
| `detail` | the floor's fences, dry-stone walls, haycocks, hay racks, field boulders and cairns, verge posts | 10 s |
| `contract` | the rock walls (`rock.cliff`, `rock.crag`), the named nodes, the foreground | 10 s |
| `sky` | `sky.webp` | 1 min |
| `bake` | the terrain's light map | 1 min |
| `export` | `valley.glb` + `terrain/*.webp` | 30 s |
| `review` | review renders into `art/ridge/build/review/` | 11 min |
| `poster` | `poster.webp` | 2.5 min |
| `characters`, `vehicles`, `animals` | `soldier.glb` + `civilian.glb`, `vehicles.glb`, `animals.glb` | see their READMEs |

All the valley stages take about 25 minutes on an M-series Mac (35 when
it is shared with other bakes); `characters` 5–15 min, `vehicles` a few minutes, `animals`
10–18 min. With no stage named, all of them run. `--quick` halves every resolution and
cuts samples for iteration. `RIDGE_REUSE_TERRAIN=1` skips the erosion
simulation when `build/terrain.npz` exists; `RIDGE_REUSE_IMPOSTORS=1` skips
re-rendering the tree atlases. Output is deterministic (every random draw is
seeded). The build never plays sound and uses Cycles on the GPU (Metal).

People, vehicles and animals have their own READMEs with every node, bone,
clip and extra: [`people/README.md`](people/README.md),
[`vehicles/README.md`](vehicles/README.md), [`fauna/README.md`](fauna/README.md).
They share High Noon's armature and character library (`art/western/`,
imported read-only).

## Conventions

- glTF: Y up, metres. The player's eye is at the origin looking along −Z
  (pitch −1°, vertical FOV 50°); the valley floor is at y ≈ −60. Blender's
  scripts work Z-up, looking along +Y: (x, y, z)_blender = (x, −z, y)_glTF.
- "Bearing" in this README: degrees clockwise from straight ahead (−Z), as
  seen from above.
- The sun: bearing 215° (behind the left shoulder), elevation 5.5° at the
  design time, playable 4–9° (`scene.extras.lighting`).
- Names with dots survive in `object.userData.name` (three.js strips the dots
  from `name`); look nodes up by that.
- Every mesh has `extras.surface` (grass, rock, snow, dirt, stone, wood,
  metal, glass, water, cloth) for the impact effects.

## The terrain

`terrain` holds 30 chunks, `terrain.<band>.<sector>`: 5 range bands (0–80,
80–300, 300–900, 900–2200, 2200–6000 m) × 6 bearing sectors across ±62°. The
mesh is a constrained Delaunay triangulation of points spaced by range from
the eye (1.2 m where the targets stand, then r/170, r/215 on the far rock
band), with the road and the river's banks as constraint edges; triangles
the eye cannot see beyond 1.2 km are culled. Normals come from the
heightfield. About 460k triangles. Beyond 6 km the world is in the sky.

### The maps: one log-polar UV (TEXCOORD_0)

Because the eye never moves, the maps are laid out in the eye's own polar
frame, so texel density falls off with range exactly as the screen's does:
the same texels cover a metre at 50 m and fifty metres at 3 km.

```
theta = atan2(x, -z)                              // glTF x, z of the ground point; bearing, radians
u = (theta - radians(-62)) / radians(124)
v = 1 - ln(clamp(hypot(x, z), 30, 6000) / 30) / ln(6000 / 30)
```

TEXCOORD_0 of every chunk holds exactly this (the formula and constants are
also in `terrain.splat.extras.mapping`), so the shader can use the attribute
or recompute it from the world position. Maps (`terrain/`, WebP, 2048×4096):

| File | Channels |
| --- | --- |
| `color.webp` | macro albedo, sRGB: meadows, forest floor, rock bands and streaks, snow, the land cover's colour at a distance |
| `normal.webp` | world-space normal in glTF axes, rgb = n·0.5 + 0.5 (heightfield + detail below the mesh's resolution) |
| `splat0.webp` | r grass, g rock, b scree, a snow |
| `splat1.webp` | r dirt (verges, farmyards, cow paths, the undercut river banks), g forest floor, b gravel (the river's bed and bars), a alpine turf (and the fields' hay and fresh stubble, which share its tawny tile) |
| `light.webp` | r sky visibility (AO, trees and buildings included); g the sun's horizon: `deg = g·40 − 10`, lit when the sun's elevation is above it; b tree/building shadow at the design sun (1 lit); a valley-mist density factor (1 on the river, ~0.3 far from it) |

Splat weights sum to 1 across the eight channels.

`splat0`, `splat1` and `light` are **lossless** WebP with a straight
(unassociated) alpha that is data, never a premultiplier; the alpha is
floored at 1/255 so no encoder throws away the colour under it (read
`a < 2/255` as 0). Until the second pass they were not: the exported splat
maps had lost their RGB wherever alpha was 0 and `light.webp`'s RGB was
premultiplied by its alpha (OpenImageIO treats a fourth channel as a
premultiplying alpha unless told otherwise). `check.py` now decodes them and
proves the eight weights sum to 1 and that colour survives under every
transparent texel, the impostor atlases' included.

### The tiles

Eight tileable PBR materials (`terrain/tile_<name>_{albedo,normal,hra}.webp`,
1024² or 512²): albedo sRGB; normal tangent-space (+Z up out of the tile);
hra = r height (0–1 over the tile's relief), g roughness, b AO. The ground
tiles are high-passed: variation broader than a tenth of the tile is taken
out (the colour map carries it), because anything broad repeats as a grid
through the scope.
`terrain.splat.extras.tiles` gives each one's size in metres and its mean
linear albedo:

| Tile | Size | Projection |
| --- | --- | --- |
| grass 3 m, alpine 2 m, dirt 2 m, forest 2.5 m, gravel 1.5 m, snow 4 m | | world XZ / size (from above) |
| rock 4 m, scree 3 m | | triplanar (these lie on steep ground) |

### The terrain shader (what the game implements)

```
w_i      = splat_i * (hra_i.r + 0.25)               // height-weighted: stones stand out of grass
w_i     /= sum(w)
d_i      = tile_albedo_i(p / size_i) / mean_i        // the tile's variation around 1 (mips average to 1)
d_i     *= 0.5 + 0.5 * tile_albedo_i(rot37(p) / (2.618 * size_i) + (0.37, 0.61)) / mean_i
                                                     // anti-tiling (not rock/scree): the tile again, larger and
                                                     // turned, so a meadow shows no 3 m grid through the scope
detail   = sum_i w_i * d_i
albedo   = color.rgb * detail
N        = normalize(normal.rgb*2-1 + sum_i w_i * (tile normal_i bent onto the geometric normal - the geometric normal))
ao       = light.r * sum_i w_i * hra_i.b
g_deg    = light.g * 40 - 10
sunlit   = smoothstep(g_deg - 0.5, g_deg + 0.5, sunElevation) * mix(light.b, 1, smoothstep(5.5, 9, sunElevation))
color    = albedo * (sun * sunlit * max(dot(N, L), 0) + sky(N) * ao)
         -> then aerial perspective and mist (below)
```

Tiles are sampled at world XZ / size_m (tangent = world X, bitangent =
world −Z), triplanar for rock and scree. `light.b` (tree and building
shadows) is baked for the design sun; fading it out as the sun climbs keeps
it from contradicting `light.g`. The review renders use this recipe in Cycles
(`valley/ground.py`, `review_material`) with Cycles' own shadows in place of
`light.g`/`light.b`; the game may drop the tiles beyond ~1 km, where they
average to 1 anyway.

### Rock walls

A heightfield cannot hold a wall: the 170 m limestone cliff across the
valley (`secret.cliff`) and the goat's crag would be stretched triangles, a
smooth curtain under the scope. Each is a mesh of its own over the terrain
(`rock.cliff`, 65k triangles; `rock.crag`, 30k): the terrain round the wall
voxel-remeshed so steep faces get even triangles, then pushed out by a model
of bedded limestone (slabs with overhanging undersides, recessed soft beds,
vertical joints between blocks that stand out by different amounts, gullies
and pillars). They stand a few metres proud of the terrain (which never
shows through) and sink under it where the ground stops being steep.

Their material is the rock tile (UV0, 4 m) multiplied by **COLOR_0** — the
beds' tones, black water streaks, rust, turf on the ledges, weathering at a
second and third scale, and Cycles' baked AO — which is plain glTF: three.js'
GLTFLoader turns vertex colours on by itself. Every block of rock starts the
tile at its own offset (the joints hide the seams), so the 4 m tile never
shows its repeat. Light them like the buildings. The same material dresses
the boulders (`rocks.slope`, `rocks.field`, `rocks.river`, `foreground.rock`,
`secret.yeti.rock`).

## The valley floor

The floor is farmed (`valley/fields.py`): strips square to the river,
26–78 m wide, each split once across and leaning a little, each field in a
state the colour and splat maps paint — **mown** (pale, yellow-green, mower
stripes 2.4 m wide), **hay** (straw windrows, haycocks), **meadow** (uncut,
darker, the autumn crocus in flower), **pasture** (mottled, rushes, cow paths
worn to earth), **aftermath** (vivid regrowth) — with the uncut strip a mower
leaves along a boundary. The floor under the plates is grazed and unfenced.
The river's margin is lush and dark; the road has a dusty verge and a band
of uncut grass.

Meshes on it (`detail` stage), all plain glTF:

| Node | What | Material |
| --- | --- | --- |
| `fields.fences.timber` | post-and-rail fences on the field boundaries (within 1.4 km) | timber tile |
| `fields.walls` | dry-stone walls (within 1.8 km), slumping in places | rubble tile × COLOR_0 (moss on the coping, damp foot) |
| `fields.hay.hay`, `fields.hay.timber` | haycocks on poles in the hay fields, hay racks near the village and farm | hay, timber tiles |
| `rocks.field` | boulders in the pastures, cairns of cleared stones | rock tile × COLOR_0 |
| `rocks.river` | boulders in the riffles (the water's foam rings them) | rock tile × COLOR_0 |
| `road.posts.paint_white`, `road.posts.dark` | white verge posts with a black band, both sides of the road | paint |
| `forest.bush.<a-d>` | shrubs: alder and willow clumps on the river banks, hazel and alder hedges on the "hedge" boundaries, juniper cushions on the open slopes | impostor cards (below) |

## The forest

About 102,500 trees of four species (spruce in three variants, larch in
two, stone pine, birch in two) and 2,600 shrubs (`bush`, four
variants: alder, willow, hazel, juniper), placed from the land cover's
forest density, the river's banks and the hedgerows, and cleared from every
sightline to a target. Each tree is an **impostor
card** (a quad with an alpha-tested atlas rendered from a detailed 3D model:
albedo with AO folded in, card-space normal map); every card faces the eye.

- `forest.<species>.<variant>` and `forest.<species>.<variant>.m` (the tree
  seen from its other side, for variety) are one card each, carrying
  **`EXT_mesh_gpu_instancing`**: TRANSLATION float32, ROTATION as normalised
  int16 quaternions (a yaw about +Y that turns the card to the eye), SCALE as
  normalised uint8 in 0–1. The cards are authored 1.2× too large
  (`SCALE_MAX = 1.2`), so the unpacked scale × the card gives the tree's size.
  three.js' GLTFLoader builds an `InstancedMesh` for each (it dequantises the
  attributes itself).
- Material: alpha test at 0.4 (MASK), double-sided. Shade a card with the
  light map sampled at its base (its sky visibility, sun horizon and canopy
  shadow), the normal map's card-space normal turned by the instance's yaw,
  and the same fog as the ground.
- No 3D LODs: the eye never moves, so a tree is only ever seen from one side;
  the 6× scope sees a card as the 512×1024 render of that tree. The shrubs'
  cards are square (512×512 cells); each card mesh's `extras.card_width_m`
  / `card_height_m` give its size.

## Buildings, props and roads

One object per site and material (`village.house.3.plaster`,
`checkpoint.hut.boards`, …) with standard glTF PBR materials made from the
building tiles (rubble, ashlar, plaster, boards, slabs, shingles, concrete,
paint in five colours, sandbags, setts, timber, hay); UVs in tile units, so
the textures repeat at their real size. Plain materials for glass, iron,
the bell and the cheese.

**Baked AO**: every building object (one per site and material, the bridge
and the dam included) has its own material and its own ambient-occlusion
image (128–1024², baked by Cycles with the terrain and the neighbours
occluding): glTF `occlusionTexture` on **TEXCOORD_1** (a second UV map,
`ao`). GLTFLoader wires it to `aoMap` with `texture.channel = 1`; it darkens
only the ambient light — the eaves, window reveals, the foot of every wall,
the narrow streets. The dam's downstream face (`dam.face`) carries its
weathering and AO in COLOR_0 instead.

Each AO image is opaque grey (R = G = B; glTF reads the red channel) and never
the same size as its material's roughness tile, or the glTF exporter would pack
the two into one ORM image; `check.py` fails on a near-black red channel, a
non-grey or non-opaque image, or a shared one. The bake writes through the
*active* UV map, so `ao` is the active map while it runs (an unwrap of each object
on its own, filling 0..1) and the tile UVs are made active again after it.

Roads (`road.main.<n>`, `road.lane`,
`road.switchbacks`, `road.dam`) are ribbons 4 cm over the carved ground:
UV.u across the road, UV.v along it in tile lengths.

## Water and mist

- `water.river`: a ribbon on the surface from the dam's outlet down the
  valley. UV.u across (0 bank → 1 bank), UV.v along the flow in metres
  (downstream +v). **COLOR_0 is data, not colour**: r foam/white water (the
  outlet, the riffles, a ring and a wake round every rock in them), g depth
  (0 at the water's edge, 1 in the deepest water) — give it the water shader
  (or switch `vertexColors` off). Suggested: `mix(bed colour ~(0.075, 0.072,
  0.05), deep ~(0.010, 0.016, 0.015), depth^0.6)`, foam broken up by a noise
  scrolling with the flow, rougher where it foams. The river is no canal:
  its width breathes ±25%, it meanders down-valley, the insides of its bends
  lay gravel bars (the water pulls back from them) and the outsides cut
  under an earth bank; the ribbon runs a metre or so under the banks and
  bars, so the shoreline is where the ground meets it.
- `water.reservoir`: the lake behind the dam, clipped to the ground.
- `mist.river.1-3`: soft ribbons 3–14 m above the river (UV.u across, UV.v
  along, COLOR_0.a fades their edges) for a scrolling mist shader.

## Sky, fog and light

- `sky.webp`: equirectangular in three.js' layout (u = 0.25 is −Z, the
  valley's axis). It holds the Nishita dawn sky, a band of cirrus lit from
  below, and the far world (the ranges beyond 6 km, rendered with their own
  aerial perspective), so it is the background and the environment light.
- `scene.extras.fog` (valley.glb) — the model the review renders use:
  - haze: transmittance `exp(−d·1/14000)` toward `(0.36, 0.46, 0.62)` linear;
  - mist: extinction `(1/810)·exp(−(y + 60)/22)` integrated along the eye
    ray (closed form in `valley/post.py`), scaled by `light.a` at the
    ground point, toward `(0.30, 0.32, 0.35)`;
  - both in-scatter colours × `mix(0.35, 1, sunlit)`, sunlit being the
    ground point's sun test from the light map: air in the ridge's shadow
    scatters far less light, and without this the shaded floor goes milky;
  - then the **grade**: the whole frame (sky included) × `(1.10, 1.0, 0.84)`
    in linear before tone mapping — a white balance for the shade the valley
    lies in. Without it the sky-lit meadows read teal; with it they are a
    cool, dewy green-grey and the sun's warmth stays warm
    (`scene.extras.fog.grade_white_balance`).
- The scope's exposure: the review's 6× views let the eye adapt — the
  view's median luminance toward mid-grey, never darker than the wide view,
  at most +2 EV (`post.adapted_exposure`). The game's scope should do the
  same over ~0.5 s: the targets lie in the shade.
- `scene.extras.lighting`: sun bearing/elevation/colour, sun-to-sky ratio.
  Review renders: sun strength 28, colour (1.0, 0.50, 0.26), AgX Medium High
  Contrast, exposure −0.45.

## Contract nodes and where they differ from the design doc

All of `docs/OVERWATCH_RIDGE.md`'s nodes are there (the checker proves it).
Deviations, each keeping the doc's intent (the doc's contract section says
the same):

1. **The light map shares TEXCOORD_0** with every other terrain map (the
   log-polar layout) instead of a second UV: one layout serves the splat,
   colour, normal and light maps with density matched to the screen.
2. **Trees are impostor cards, not 3D LOD meshes**: the camera never moves,
   so one view per tree is exact; the checker counts ≥ 2000 instances each for
   `forest.fir` and `forest.larch` (the node names use the doc's species:
   `forest.fir` is the spruce).
3. **Plates' screen coverage**: `calib.1-9` sit in three rows at ~140, 200
   and 260 m on the player's slope (bearings −24°, 0°, +24°); from a ridge
   60 m up a 50° view the rows fall at 0.71–0.87 of the screen's height, not
   spread over it. Each carries `extras.vp` (its 4:3 and 16:9 viewport
   position).
4. **The goat's ledges** `secret.goat.1-4` climb the crag one hop apart
   (1.6–1.9 m across, 0.9–1.1 m up, each visible from the eye), close to
   `goat.hop`'s arc (1.62 m across, 1.5 m up): scale the arc to the real
   offset between consecutive ledges.
5. **Extra nodes** the game can use or ignore: `rock.cliff`, `rock.crag`,
   `rocks.slope`, `rocks.field`, `rocks.river`, `fields.*`, `road.posts.*`,
   `forest.bush.*`, `foreground.rock` (the rifle's rest) and
   `foreground.grass` (vertex-coloured blades; uv.v 0 root → 1 tip for
   swaying), `range.*` (the plates' posts), `mist.river.*`, `road.*`,
   `eagle.land`, `tunnel`, `dam.face` (the dam's weathered downstream face,
   concrete tile × COLOR_0).
6. **Animals' clips** are named `<animal>.<clip>` (`cow.graze`) because one
   file holds five animals; see `fauna/README.md`.
7. **Vehicles** carry extras for the drive (`wheelbase`, `wheel_radius`,
   `length`) and `dismount.<n>` / `bed.seat.<n>` / `seat.rear.<n>` nodes;
   see `vehicles/README.md`.

## People, vehicles, animals at a glance

The full node, bone and clip tables are in the three READMEs; what the game
most needs to get right:

- **Soldier** (8.3k body; 10.9–17.9k dressed): walk 1.30 m/s, patrol_walk
  1.05, run 3.60 (move the root at these speeds, nothing skates). Deaths land
  at 0.70–0.88 s; `wound_kneel` kneels at 0.50 s, then loop `wounded`. Prone:
  pelvis 0.62 m behind the root, muzzle 0.29 m up and 0.92 m ahead.
  `gun.rifle.scoped` has `socket.glint` on its lens (the counter-sniper's
  flash). Extra clips: `prone_fire`, `prone_death`, `wounded`,
  `death_kneel`, `drive_death`, `fire_burst`, `prone_fire_burst`.
- **Civilians** (6.5–8.3k each): show one `var.person.*`; the child carries
  `extras.scale = 0.64` (scale the rig and his speeds). The bicycle is bones
  on the cyclist's rig, animated inside `cycle` (4.58 m/s).
- **Vehicles**: `wheel.<n>` roll about local X (`+= distance / radius`),
  the front pair steer about local Y (Euler order `'YXZ'`); `dismount.<n>`
  and `bed.seat.<n>` place the troops; `fx.exhaust`, `fx.steam` for effects.
- **Animals**: clips `<animal>.<clip>`, root extras give each clip's speed;
  the goat's hop and the eagle's landing are root motion the game drives
  (formulas in `fauna/README.md`); the eagle's wing sets swap by bone scale,
  so always play a clip on it and cut, never cross-fade, between perched and
  flying clips.

## Performance

`valley.glb` draws ~1.13M triangles with every instance: terrain 454k, tree
and shrub cards 210k (105k instances of 24 card meshes, 24 instanced draw
calls), rock walls 129k, the river and reservoir 68k, the fields' fences,
walls and hay 65k, the foreground grass 61k, the village 61k, boulders 37k,
the rest ~50k; 129 primitives, 62 materials (the buildings' each carry
their own AO image). The terrain shader is the cost to watch: 8 materials × 3
tiles (+1 anti-tiling sample each) + 5 maps; drop the tiles past ~1 km and
the anti-tiling past ~500 m if the frame time needs it.

## Review renders

`art/ridge/build/review/` (git-ignored): `valley_wide.png`,
`valley_wide_21x9.png`, the 6× scope views `valley_scope_<site>.png`
(checkpoint, bridge, chapel, chapel_tower_12x, dam, tunnel, farm, village,
river, river_far, goat_crag, cliff, yeti, peaks at 3×) — the first pass's
are kept in `before/` — the people placed in the valley
`valley_people_*.png`, and the characters' and animals' turnarounds, game
distance views and clip contact sheets under `people/`, `fauna/` and
`vehicles/`.

## Code map

- `build.py` stage runner; `check.py` the contract checker; `glbtool.py`
  GLB reading/writing (instancing, node lookups) in plain Python.
- `valley/`: `layout.py` (the plan: every site, road, river point),
  `noise.py`, `terrain.py` + `features.py` (heightfield), `fields.py` (the
  floor's fields), `detail.py` (their fences, walls, hay), `bake_ao.py`
  (the buildings' AO), `imgio.py` (image files), `mesh.py` +
  `ground.py` (terrain mesh and review material), `landcover.py` + `maps.py`
  (splat, colour, normal), `tiles.py` + `btiles.py` (materials), `trees.py`
  + `forest.py` (forest), `kit.py` + `buildings.py` + `sites.py` + `bmats.py`
  (architecture), `water.py`, `crags.py` (rock walls, boulders),
  `contract.py` + `foreground.py` (nodes, near ground), `lightmap.py`,
  `sky.py`, `post.py` (fog), `export.py`, `review.py`, `poster.py`,
  `pipeline.py` (the stages).
- `people/`, `vehicles/`, `fauna/`: the characters, vehicles and animals.
