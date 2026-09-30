# Overwatch Ridge — game design

The fourth game of the web-native Handy. First light over an alpine valley:
you lie on a ridge with a bolt-action rifle and a spotter's readout, and the
valley below you is where the job is. Close one eye and the scope brings it
six times closer. It must look and feel like something Apple would put on
stage — see [DESIGN.md](DESIGN.md) for the interface and
[HIGH_NOON.md](HIGH_NOON.md) for the conventions every game shares (the aim
check, CoD-style health, Relaxed and Standard, one-time tips, the results
note, secrets).

## The fantasy in one line

Mist on the river, cowbells, the first sun on the snow — and six hundred
metres away a man in a watchtower lights a cigarette. You breathe out, wait
for the wind to drop, and squeeze.

## The place: the Valle Serra

- **Time:** dawn. The sun is just up behind the player's left shoulder, low
  and warm; the valley floor is still in blue shadow with mist lying on the
  river; the peaks across the valley are lit gold and pink; the sky is clear
  and pale. The light moves slightly over a run (the mist burns off, the
  shadow line creeps down the far slope) — slow, for atmosphere.
- **Where you are:** prone on a grassy ridge 60 m above the valley floor, the
  rifle on a rock, a few grass blades and wildflowers in the foreground out of
  focus. The valley runs left to right across the view; the far side rises in
  forest, cliffs and snowfields to peaks 2–3 km away.
- **The valley floor, near to far (200–900 m):** a road along the river, a
  **stone bridge** at 350 m, a **checkpoint** with a barrier and a wooden
  watchtower at 280 m, a **farm** with a barn, hay bales and a fenced pasture
  (cows, a few sheep) at 250 m left, a **village** of stone houses and a
  **chapel with a bell tower** at 500 m, a switchback road up the far slope, a
  **dam** at the valley's head at 900 m with a walkway across it.
- **Materials:** real terrain at a distance — grass, rock, scree, snow, forest
  (thousands of fir trees), a stone road, water. Everything must hold up
  **through a 6× scope**: detail where the targets are.

## The player

- A prone view, eyes at the scope's height, with a slow breathing sway (felt
  most through the scope).
- **Unscoped** the whole valley is on screen and the crosshair is a hip-fire
  aim: a shot from the hip at this range spreads widely — hopeless beyond
  200 m, and the game says so once.
- **Scoped** (close one eye, or hold Shift / the right mouse button / the
  on-screen Scope button — the platform's `Aim.scope`): the view jumps to **6×**
  in 0.3 s, centred where you were pointing; the page's crosshair is hidden
  and the scope draws a **fixed reticle** (a fine cross with mil marks) in the
  middle of a round glass with a dark surround. While scoped, your hand **pans
  the view** at a quarter of the gain (anchored where the scope went in), so a
  hand's tremor becomes a quarter of the movement; the breathing sway is
  there, and settles a little after a second of stillness. The shot goes where
  the reticle is.
- **The rifle:** bolt-action, **5 rounds** (the page shows a magazine and the
  bolt's state). After each shot the bolt must be **cycled — raise your thumb**
  (the re-arm) and the bolt works back and forward (0.6 s, a clean metallic
  sound, the scope jolts); you cannot fire until it is closed. **Reload by
  pointing off the screen** (unscoped) or R: 2 s, a clip stripped in.
- **Real ballistics:** a round at 600 m/s with drag takes time to get there
  (0.4 s at 250 m, 1.2 s at 700 m), drops (zeroed at 150 m; 1.6 m low at 600 m
  if you hold dead on), and drifts with the wind (a crosswind of up to 8 m/s).
  The reticle's mil marks match that drop, so holding a mark high at the
  range the readout gives is how you hit. You see the round's vapour trail
  through the scope and the impact (a puff of dust, a spark on stone, a splash)
  a moment after the shot.
- **The readout** (the page's score panel readouts): **Range** to whatever the
  reticle rests on, in metres (a laser rangefinder); **Wind** as a signed meter
  and m/s; **Stage**; **Targets** left. Wind is also in the world: grass and
  flags and the mist drift with it.

## Health: regenerating, like Call of Duty

- 100 health. Only some enemies can hurt you: **the counter-sniper** (a hit is
  45), **machine-gunners** once alerted (a burst that finds you is 20), and a
  **mortar** team on alert stages (a near miss 15, a hit 50).
- Hurt, regeneration (after 4 s, 30/s) and the fall as in High Noon. The fall:
  the scope's glass cracks, the view tips into the grass. "Spotted on
  Stage 4."
- **Alert.** Each stage starts quiet. A missed shot near a hostile, a hostile
  finding a body, or a shot heard close (sound travels: the valley hears your
  shot about a second after you take it) raises the alert. Alerted hostiles
  take cover, search the ridge with binoculars (a glint), and the gunners open
  up. Clean, quiet work is rewarded.

## The people of the valley

- **Hostiles** — soldiers in dark green with helmets: sentries (standing,
  smoking, walking a few steps), patrols (walking the road in twos and fours),
  guards at the checkpoint, **drivers** (in the trucks' cabs), an **officer**
  (a peaked cap, binoculars), **machine-gunners** (behind sandbags at the
  checkpoint), **the counter-sniper** (a ghillie suit, prone in the chapel
  tower or on a far ledge — his scope glints; the Overwatch Ridge glint). A
  headshot kills; two body shots kill; one body shot wounds (he drops to a
  knee, alerting the others).
- **Civilians** — never shoot them: the farmer in blue overalls in his
  pasture, a woman cycling the road, a shepherd with his flock on the far
  slope, children at the chapel on some stages. Shooting a civilian costs
  500, the **Clean Conscience** bonus, and one more alert. They are
  unmistakable through the scope: no helmet, no weapon, bright clothes.
- **Animals** — cows, sheep, a goat on a cliff, an eagle circling. Shooting
  one costs 100 and says so.
- **Vehicles** — a canvas-backed **truck** and a **jeep**: stop a vehicle by
  its driver (through the windshield — glass deflects the round a little) or
  its engine block (three hits; steam, then it rolls to a stop).

## Stages

Each stage is a short job with an objective, and the stages grow harder
(stronger, gustier wind; more distance; less mist; faster targets). Complete
the objective and the next stage begins after a breather. Fail it — the
convoy crosses the bridge, the officer escapes, or you fall — and the run is
over.

| Stage | Job | Teaches |
| --- | --- | --- |
| 1 | **Sentries**: three at the checkpoint and the tower, 250–300 m | Range and drop |
| 2 | **Patrol**: four walking the road, 300–450 m | Leading a moving target |
| 3 | **Convoy**: two trucks heading for the bridge; stop the lead truck before it crosses (40 s), then the soldiers who jump out | Vehicles, pressure |
| 4 | **Counter-sniper**: he is in the chapel tower or on a ledge; find his glint before he finds you | The glint, being hunted |
| 5 | **The officer**: he inspects the dam, then drives off along the dam road; take him before he reaches the tunnel (900 m, strong wind) | Wind, long range |
| 6+ | The jobs return, harder and mixed: more hostiles, gustier wind, the mortars on alert | Everything |

Between stages a **breather** (6 s): the title card ("Stage 3"), a
line on the job, health refills, the mist shifts, the wind changes (a new
direction and strength, shown as it comes).

## Scoring

- Headshot 150; body kill 80; the driver 250; engine stop 300; the counter-
  sniper 500; the officer 800. **Distance pays**: every hit is multiplied by
  1 + (range − 200) / 400 (×2 at 600 m).
- **One Shot, One Kill** streak: consecutive kills with one round each build
  ×1 → ×4; a miss or a wound resets it.
- End of stage: accuracy, **Ghost** (never alerted) +500, **Clean Conscience**
  (no civilian or animal hit) +250, time bonus on the timed jobs.

## Difficulty

Relaxed and Standard, one table in `tuning.ts`. Relaxed: a **holdover dot** in
the scope shows where the round will land at the range under the reticle (the
drop and the wind worked out for you), wind at most 4 m/s, the counter-
sniper's glint shows twice as long, alert rises slower, the timed jobs have a
third more time, damage ×0.75. Standard is the game as designed. Records
apart.

## One-time tips (Settings.tipsSeen)

`ridge.scope` — the start, until the player has scoped by themselves: "Close
one eye to look through the scope." (or "Hold Shift to look through the
scope." for a mouse player, "Hold Scope" on touch) · `ridge.drop` — the first
miss that fell short or long: "It drops with distance. Aim a mark higher for
every hundred metres past the first two." (wording to be checked against the
reticle) · `ridge.wind` — the first miss that drifted: "The wind pushes the
round. Aim into it." · `ridge.bolt` — the first shot: "Raise your thumb to
work the bolt." · `ridge.civilian` — the first civilian in the scope: "Blue
overalls and bicycles are farmers. Hold your fire." · `ridge.glint` — the
counter-sniper's first glint: "A glint on the far side. That's his scope."

## The results note

What ended the run and what would help: "The counter-sniper in the chapel
tower. His scope glints before he fires — find it first." · "The convoy
crossed the bridge. The driver is the quick stop; the engine takes three." ·
"The officer reached the tunnel. At 900 m the wind matters — aim into it."

## Secrets (easter eggs)

"Secrets 2 of 8" on the results.

1. **The bell.** Shoot the chapel bell: it rings — and you hear it a second and
   a half after the shot, because sound takes that long to cross the valley.
2. **The goat.** A goat stands on an impossible ledge. Shoot near it: it
   bleats and hops to an even more impossible one.
3. **The cheese.** The farmer's cart has a wheel of cheese on it. Shoot the
   wedge under the cart's wheel: the cheese rolls down the lane, bouncing, all
   the way to the river.
4. **The yeti.** On the far snowfield (1.8 km), only through the scope, a white
   figure peeks from behind a rock. Shoot the rock beside it: it ducks, and
   footprints appear in the snow leading away.
5. **The dam's siren.** Shoot the loudspeaker on the dam: a long wail echoes up
   the valley, and every cow turns to look at you.
6. **The eagle.** Don't shoot the eagle. Shoot near it three times: it lands on
   the rock right in front of your scope and stares at you.
7. **The duck.** A yellow rubber duck floats down the river. Shoot it: it
   bobs, and the popup reads "Duck at 412 m." (Every game hides one duck.)
8. **The echo.** Shoot the great cliff face across the valley: your shot's
   echo comes back three times, the last one sounding like a distant shot
   from someone else.

Konami on the arcade: a golden rifle and a gold magazine.

## The aim check

**Nine steel plates** on a range the soldiers set up on the valley's near
side, 120–250 m away, and on posts along the road, placed (in the unscoped
view) to cover the screen's corners, edges and centre; the aim check is
unscoped (a hand's aim is fitted to the wide view). The lit one gets a painted
white circle; a hit rings it (a clang heard a moment later) and it swings. The
framing is the wide view; the scope comes after.

## Feel and sound

- Morning in the mountains: wind over the grass, cowbells, a river's rush far
  below, birdsong, a dog at the farm, church bells on the hour.
- The rifle: a sharp crack and a long roll of echoes off the valley walls; the
  bolt's clean steel; the round's arrival a moment later (a thud, a ping on
  steel, glass, a splash). The scope going in: a soft cloth-and-glass sound.
- Breath: faint, felt through the scope.
- 60 fps on a MacBook with the hand and face trackers running.

## Asset contract

Y-up, metres; the player's eye at the origin, 60 m above the valley floor,
looking along −Z across the valley. Everything made by `art/ridge/` Blender
scripts; nothing downloaded; humans built on the shared character library
(`art/western/`, read-only; extend it in `art/ridge/`).

**This valley is seen through a 6× scope**, so High Noon's trick of baking
light from one eye into projected textures is not enough: surfaces need real
UVs and texel density where the targets are. Recommended approach, the art's
call (documented in `art/ridge/README.md`):
- **Terrain** as a heightfield mesh (or tiles) with a **splat map** blending
  tileable PBR materials made in Blender (grass, rock, scree, snow, dirt,
  road stone), plus a baked **light/AO map** on a second UV; the game renders
  it with a terrain shader (splat + triplanar on cliffs) under a runtime sun
  and the sky's environment light, with aerial perspective (distance haze
  that goes blue) and height mist.
- **Forest** as instanced trees (a few fir and larch models with LOD and a
  far billboard), placed by a density map.
- **Buildings, bridge, dam, checkpoint** with trim-sheet textures and baked
  AO; lit at runtime.
- **Water**: the river and the reservoir as meshes the game gives a water
  shader.

### `public/assets/ridge/valley.glb` (+ textures)

- **Named nodes:** `camera.player`; `sun` (−Z along the sunlight);
  `terrain` (+ `terrain.splat`, material tiles); `water.river`,
  `water.reservoir`; `forest.<species>` (instancing data or instanced
  meshes); `path.road.<n>` (the road's centreline, both directions),
  `path.dam.<n>` (the dam road to `tunnel`), `path.patrol.<n>`, `path.farmer.<n>`,
  `path.cyclist.<n>`, `path.shepherd.<n>`, `path.cheese.<n>`; `post.<id>`
  (where sentries stand, with extras `{ kind: "sentry" | "tower" | "gunner" |
  "guard" }`); `sniper.<n>` (counter-sniper nests, with `{ exposed, hidden }`
  children); `bridge.cross` (the line a convoy must not cross); `calib.1-9`
  (the steel plates); `secret.bell`, `secret.goat.<n>`, `secret.cheese`,
  `secret.cart.wedge`, `secret.yeti`, `secret.yeti.rock`, `secret.siren`,
  `secret.cliff`, `secret.duck.path.<n>`, `eagle.path.<n>`; `animals.cows.<n>`,
  `animals.sheep.<n>`.
- **Surfaces** in extras: `grass`, `rock`, `snow`, `dirt`, `stone`, `wood`,
  `metal`, `glass`, `water`, `cloth` — for the impact effects.
- **Budget:** ≤ 30 MB with textures (this is the big one; WebP, Draco, KTX2 if
  the pipeline supports it cleanly). Loaded behind the real-progress bar.
- **As built** (`art/ridge/README.md` has the shader's inputs): every terrain
  map — colour, normal, splat, and the light map too — shares one log-polar
  UV laid out from the eye (TEXCOORD_0), not a second UV; the forest is
  camera-facing impostor cards instanced with `EXT_mesh_gpu_instancing`
  (`forest.fir` is the spruce), with no 3D LODs since the eye never moves;
  the plates' rows fall at 0.71–0.87 of the screen's height (from 60 m up,
  targets 140–260 m out cannot spread further), each plate's `extras.vp`
  giving its screen position; extra nodes the game may use: `rock.cliff` and
  `rock.crag` (rock walls as meshes over the terrain), `rocks.slope`,
  `rocks.field`, `rocks.river`, `fields.*` (fences, dry-stone walls, hay),
  `road.posts.*`, `forest.bush.*` (shrubs), `dam.face`, `foreground.rock`,
  `foreground.grass`, `range.*`, `mist.river.*`, `road.*`, `tunnel`,
  `eagle.land`. The splat and light maps are lossless WebP whose alpha is
  data (unassociated), floored at 1/255 so the encoder keeps the RGB under
  it; the buildings' baked AO is glTF's occlusion texture on TEXCOORD_1.

### `public/assets/ridge/sky.webp`

A dawn sky (clear, pale, a few high clouds catching the sun) as background
and environment light.

### Characters and vehicles

- `soldier.glb`: the shared humanoid armature (High Noon's bone names), facing
  +Z, clips in place. Variants `var.helmet`, `var.cap.officer`, `var.ghillie`
  (the counter-sniper), `var.pack`, weapons `gun.rifle`, `gun.mg`,
  `prop.binoculars`, `prop.cigarette` in sockets. Clips: `idle`, `idle_smoke`,
  `look_binoculars`, `walk`, `patrol_walk`, `run`, `crouch`, `prone`,
  `prone_aim`, `aim`, `fire`, `hit_body`, `wound_kneel`, `death_back`,
  `death_forward`, `death_crumple`, `dismount` (from the truck), `drive` (seated).
- `civilian.glb`: `var.person.farmer`, `.cyclist` (with a bicycle rigid on the
  rig or a separate `bicycle` with pedalling), `.shepherd`, `.child`; clips
  `idle`, `walk`, `cycle`, `wave`, `panic`, `duck`.
- `vehicles.glb`: `truck` (canvas back, `wheel.<n>` pivots, `cab.glass`,
  `engine` (the shootable block), `seat.driver`), `jeep` (same parts).
- `animals.glb`: `cow` (graze, walk, look_up), `sheep`, `goat` (stand, hop,
  bleat), `eagle` (glide, flap, land), `dog`. As built, one file holds all
  five, so clips are named `<animal>.<clip>` (`cow.graze`).
- Vehicles, as built, carry extras for driving them (`wheelbase`,
  `wheel_radius`, `length`) and `dismount.<n>`, `bed.seat.<n>`, `seat.rear.<n>` nodes; see `art/ridge/vehicles/README.md`.
- **Budget:** 10–18k triangles per person, 1024² atlases.

### `public/assets/ridge/poster.webp`

The valley at dawn through the scope's edge — the chapel, the bridge, mist on
the river, the peaks lit gold. As built: the scope (leaning in to 20× so the
figures read) on an officer glassing the ridge at the checkpoint, the
reticle on his chest, a sentry smoking beside him; the lit Punta Serra and
the valley soft beyond the tube's rim.
