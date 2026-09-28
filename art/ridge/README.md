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
| `valley.glb` + `terrain/*.webp` | terrain, forest, sites, water, roads, rocks, contract nodes | SIZE_VALLEY | ≤ 30 MB |
| `sky.webp` | the dawn sky and the far world, equirectangular 4096×2048 | SIZE_SKY | — |
| `soldier.glb` | the infantryman, variants, weapons, 23 clips | SIZE_SOLDIER | 10–18k tris dressed |
| `civilian.glb` | farmer, cyclist + bicycle, shepherd, child | SIZE_CIVILIAN | 10–18k tris dressed |
| `vehicles.glb` | truck, jeep | SIZE_VEHICLES | — |
| `animals.glb` | cow, sheep, goat, eagle, dog | SIZE_ANIMALS | — |
| `poster.webp` | the valley through the scope, 1600×900 | SIZE_POSTER | — |

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
| `terrain` | heightfield (macro shape, peaks, the cliff, relief, hydraulic erosion, the designed features), the terrain mesh, the log-polar colour/normal/splat maps | T_TERRAIN |
| `materials` | the tileable ground and building materials (Cycles micro-scenes) | T_MATERIALS |
| `forest` | tree models → impostor atlases; where every tree stands | T_FOREST |
| `buildings` | village and chapel, farm, checkpoint and watchtower, bridge, dam, alp | T_BUILDINGS |
| `water` | river, reservoir, mist ribbons, roads | T_WATER |
| `contract` | the rock walls (`rock.cliff`, `rock.crag`), the named nodes, the foreground | T_CONTRACT |
| `sky` | `sky.webp` | T_SKY |
| `bake` | the terrain's light map | T_BAKE |
| `export` | `valley.glb` + `terrain/*.webp` | T_EXPORT |
| `review` | review renders into `art/ridge/build/review/` | T_REVIEW |
| `poster` | `poster.webp` | T_POSTER |
| `characters`, `vehicles`, `animals` | `soldier.glb` + `civilian.glb`, `vehicles.glb`, `animals.glb` | see their READMEs |

With no stage named, all of them run. `--quick` halves every resolution and
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
or recompute it from the world position. Maps (`terrain/`, WebP, SIZE_MAPS):

| File | Channels |
| --- | --- |
| `color.webp` | macro albedo, sRGB: meadows, forest floor, rock bands and streaks, snow, the land cover's colour at a distance |
| `normal.webp` | world-space normal in glTF axes, rgb = n·0.5 + 0.5 (heightfield + detail below the mesh's resolution) |
| `splat0.webp` | r grass, g rock, b scree, a snow |
| `splat1.webp` | r dirt, g forest floor, b gravel, a alpine turf |
| `light.webp` | r sky visibility (AO, trees and buildings included); g the sun's horizon: `deg = g·40 − 10`, lit when the sun's elevation is above it; b tree/building shadow at the design sun (1 lit); a valley-mist density factor (1 on the river, ~0.3 far from it) |

Splat weights sum to 1 across the eight channels.

### The tiles

Eight tileable PBR materials (`terrain/tile_<name>_{albedo,normal,hra}.webp`,
1024² or 512²): albedo sRGB; normal tangent-space (+Z up out of the tile);
hra = r height (0–1 over the tile's relief), g roughness, b AO.
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
beds' tones, black water streaks, rust, turf on the ledges and Cycles' baked
AO — which is plain glTF: three.js' GLTFLoader turns vertex colours on by
itself. Light them like the buildings. The same material dresses the
boulders (`rocks.slope`, `foreground.rock`, `secret.yeti.rock`).

## The forest

About TREES_TOTAL trees of four species (spruce in three variants, larch in
two, stone pine, birch in two), placed from the land cover's forest density
and cleared from every sightline to a target. Each tree is an **impostor
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
  the 6× scope sees a card as the 512×1024 render of that tree.

## Buildings, props and roads

One object per site and material (`village.house.3.plaster`,
`checkpoint.hut.boards`, …) with standard glTF PBR materials made from the
building tiles (rubble, ashlar, plaster, boards, slabs, shingles, concrete,
paint in five colours, sandbags, setts, timber, hay); UVs in tile units, so
the textures repeat at their real size. Plain materials for glass, iron,
the bell and the cheese. Roads (`road.main.<n>`, `road.lane`,
`road.switchbacks`, `road.dam`) are ribbons 4 cm over the carved ground:
UV.u across the road, UV.v along it in tile lengths.

## Water and mist

- `water.river`: a ribbon on the surface from the dam's outlet down the
  valley. UV.u across (0 bank → 1 bank), UV.v along the flow in metres
  (downstream +v). **COLOR_0 is data, not colour**: r foam/white water, g
  depth (0 at the banks, 1 mid-stream) — give it the water shader (or
  switch `vertexColors` off). It runs 1.5 m under the banks, so the
  shoreline is where the ground meets it.
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
  - mist: extinction `(1/650)·exp(−(y + 60)/22)` integrated along the eye
    ray (closed form in `valley/post.py`), scaled by `light.a` at the
    ground point, toward `(0.31, 0.35, 0.40)`;
  - both in-scatter colours × `mix(0.35, 1, sunlit)`, sunlit being the
    ground point's sun test from the light map: air in the ridge's shadow
    scatters far less light, and without this the shaded floor goes milky.
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
4. **Extra nodes** the game can use or ignore: `rock.cliff`, `rock.crag`,
   `rocks.slope`, `foreground.rock` (the rifle's rest) and
   `foreground.grass` (vertex-coloured blades; uv.v 0 root → 1 tip for
   swaying), `range.*` (the plates' posts), `mist.river.*`, `road.*`,
   `eagle.land`, `tunnel`.
5. **Animals' clips** are named `<animal>.<clip>` (`cow.graze`) because one
   file holds five animals; see `fauna/README.md`.
6. **Vehicles** carry extras for the drive (`wheelbase`, `wheel_radius`,
   `length`) and `dismount.<n>` / `bed.seat.<n>` / `seat.rear.<n>` nodes;
   see `vehicles/README.md`.

## Review renders

`art/ridge/build/review/` (git-ignored): `valley_wide.png`,
`valley_wide_21x9.png`, the 6× scope views `valley_scope_<site>.png`
(checkpoint, bridge, chapel, chapel_tower_12x, dam, tunnel, farm, village,
goat_crag, cliff, yeti, peaks at 3×), the people placed in the valley
`valley_people_*.png`, and the characters' and animals' turnarounds, game
distance views and clip contact sheets under `people/`, `fauna/` and
`vehicles/`.

## Code map

- `build.py` stage runner; `check.py` the contract checker; `glbtool.py`
  GLB reading/writing (instancing, node lookups) in plain Python.
- `valley/`: `layout.py` (the plan: every site, road, river point),
  `noise.py`, `terrain.py` + `features.py` (heightfield), `mesh.py` +
  `ground.py` (terrain mesh and review material), `landcover.py` + `maps.py`
  (splat, colour, normal), `tiles.py` + `btiles.py` (materials), `trees.py`
  + `forest.py` (forest), `kit.py` + `buildings.py` + `sites.py` + `bmats.py`
  (architecture), `water.py`, `crags.py` (rock walls, boulders),
  `contract.py` + `foreground.py` (nodes, near ground), `lightmap.py`,
  `sky.py`, `post.py` (fog), `export.py`, `review.py`, `poster.py`,
  `pipeline.py` (the stages).
- `people/`, `vehicles/`, `fauna/`: the characters, vehicles and animals.
