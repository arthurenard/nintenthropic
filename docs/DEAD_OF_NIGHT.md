# Dead of Night — game design

The second game of the web-native Handy. A night at the last gas station on a
country road: the power is out, the fog is in, and the dead are walking up
the road. You have a lever-action rifle, a flashlight under its barrel, and a
barricade. It must look and feel like something Apple would put on stage —
see [DESIGN.md](DESIGN.md) for the interface and [HIGH_NOON.md](HIGH_NOON.md)
for the conventions every game shares (the aim check, CoD-style health,
Relaxed and Standard, one-time tips, the results note, secrets).

## The fantasy in one line

Midnight at Miller's Gas & Eats. The streetlight buzzes, the corn whispers,
and out of the fog, one by one, something shuffles into your flashlight.

## The place: Miller's Gas & Eats, Route 9

- **Time:** a little after midnight. A full moon behind thin cloud gives a
  cold blue key light from high on the left; fog lies on the road and the
  fields and thickens toward the tree line. Warm practical lights punch
  through it: one sodium streetlight at the crossroads (it flickers), the
  station's neon sign, a candle in a motel window.
- **Where you stand:** under the station's canopy, behind a barricade of
  sandbags, a gas pump and a pickup truck on its side, looking north up
  Route 9. Eyes at 1.7 m. The road runs straight ahead into the fog (about
  80 m of it readable before the fog closes); the crossroads is at 25 m.
- **Left (west):** a split-rail fence, then a cornfield with a scarecrow, a
  red barn at 60 m, a grain silo, a windmill against the sky.
- **Right (east):** a phone booth under the streetlight, the six-room Starlite
  Motel with its sign (a few rooms lit by candles, doors ajar), then pine
  forest. Power lines follow the road.
- **Far:** a burned-out school bus sideways across the road at 45 m (cover and
  a spawn point: they climb out of it), a water tower, and — only when the fog
  thins between waves — the screen of a drive-in movie theatre on the hill.
- **Materials:** everything worn and damp: wet asphalt that mirrors the
  streetlight, peeling paint, rusted tin, cracked neon tubes, dew on the
  sandbags. Realistic, restrained, cold blues against warm sodium amber. Not
  gore for its own sake: the horror is in the fog and the silence.

## The player

- A first-person view from the barricade with a slow, nervous breathing sway.
- **Rifle:** a lever-action, **8 rounds**. The page shows a magazine (a row of
  eight rounds). **Reload by pointing off the screen** (the same gesture as
  High Noon — a lost hand swung out of the picture counts), or R; it takes
  1.2 s, rounds pushed in with a sound per round. A dry click and the hint on
  an empty magazine. Each shot works the lever (a short sound, a small kick).
- **The flashlight** is mounted under the barrel: its beam follows your aim.
  This is the signature of the game. The beam is a real spotlight cone through
  the fog (a lit volume with drifting noise), it lights the road, the corn,
  the bus and every figure in it, and **the dead's eyes shine back in it**
  before their bodies are clear of the fog — the Dead of Night equivalent of
  High Noon's glint. Everything the beam does not touch stays in moonlight.
- **Recoil:** a short kick, settling in 250 ms; the beam kicks with it.

## Health: regenerating, like Call of Duty

- 100 health. A walker at the barricade claws you for **25** every 1.4 s
  until it is dead; a runner's lunge takes 20; a bloater bursting at the
  barricade takes 60 (and damages nothing else — it was too close).
- **Being hurt:** as in High Noon — the edges bleed in, colour drains, a
  heartbeat, muffled sound, a damage arc toward the attacker.
- **Regeneration:** after 4 s without being hurt, 30 per second.
- **The fall:** at zero, the flashlight drops from your hands and rolls on the
  asphalt, its beam swinging across the canopy; the dead close in out of
  focus; black. A card: "Fell on Wave 5." Then the results.

## The dead

They come out of the fog along three lanes — the road, the cornfield (they
push through the corn, which sways and rustles ahead of them), and the tree
line past the motel — and one lane of surprises: out of the bus, from behind
the phone booth, and (wave 4+) over the fence at 12 m.

- **Walkers** — the most of them. A shambling walk with a varied gait (a
  limp, a drag, a lurch, arms up or hanging), 0.8–1.2 m/s. **A headshot kills.
  Three body shots drop one; each body shot staggers it back half a step**, so
  body shots buy time and head shots end things. They wear what they died in:
  a farmer's overalls, a trucker's cap and flannel, a waitress's uniform, a
  hunter's orange vest, a mechanic's coveralls, a businessman's suit.
- **Runners** (wave 3+) — the recently dead: a lurching sprint, 3.5 m/s, then
  a lunge. Two body shots or one to the head. Worth a bonus.
- **Crawlers** (wave 4+) — low on the road, dragging themselves, hard to see
  in the fog and easy to forget: they only need one shot, anywhere, but they
  are small and near the ground.
- **Bloaters** (wave 5+) — swollen, slow, pale green. **Shoot one in the belly
  and it bursts**: a burst of foul gas and matter that downs every walker
  within 3 m (a chain, scored). Let it reach the barricade and it bursts on
  you.
- **The Mechanic** (wave 6, then every sixth wave) — a huge man in grease-
  stained coveralls with a welding mask down over his face and a tyre iron.
  The mask stops bullets: **two shots knock it off**, then a headshot drops
  him; body shots only slow him (eight to drop). The dead around him come
  faster while he walks.

**Their tells.** Eyeshine in the beam before the body resolves; the corn
bending ahead of one; a groan (panned and distanced) when one leaves the fog;
the crickets falling silent when the dead are close.

**Hits** read physically: a headshot snaps the head back and they drop where
they stand; body shots twist and stagger them; the fallen stay on the road
until the breather (the fog takes them). A dark spray, never dismemberment —
PG-13, not gore.

## Townsfolk: none. The Survivor.

Now and then (wave 3+) a living survivor runs across the road with a lantern
toward the motel — Miller's daughter, then the old motel owner. Shooting one
costs 300 and the wave's **Clean Hands** bonus; they are unmistakable: they
carry a lit lantern, move like the living, call out ("Don't shoot!" is not
synthesised speech — a whistle and a shout-like vocal sound), and the beam
catches their lantern first.

## Waves

| Wave | Dead | New |
| --- | --- | --- |
| 1 | 6 walkers | The road only; learn the fog |
| 2 | 9 | The cornfield lane |
| 3 | 12 | Runners; the tree line |
| 4 | 14 | Crawlers; the surprises (bus, booth, fence) |
| 5 | 16 | Bloaters |
| 6 | The Mechanic + 14 | Boss |
| 7+ | +3 each | More runners, thicker fog, faster walkers |

A wave ends when every one of it is down. Then a **breather** (6 s): the fog
thins, the streetlight steadies and buzzes back to full, a distant church bell
counts the wave, the title card slides in ("Wave 3"), health refills, and the
crickets start again. There is no clock: you last until the night takes you.

## Scoring

- Headshot kill 150; body kill 60; crawler 100; runner +50; a kill beyond
  30 m ×1.5 (it bought road); bloater chain +100 per walker caught; the
  Mechanic's mask +100, the Mechanic 1000.
- Streak multiplier ×1 → ×4 on consecutive hits; a miss resets it.
- End of wave: accuracy bonus, **Untouched** (no damage) +500, **Clean Hands**
  (no survivor hit) +250.

## Difficulty

Relaxed and Standard, as in High Noon: one table in the game's `tuning.ts`.
Relaxed: the dead walk ~25% slower, claw for 18 instead of 25 (five in quick
succession to fall, not four), health returns after 3 s at 40/s, the fog is a
little thinner, bloaters burst with a wider warning, the Mechanic needs one
shot on the mask. Standard is the game as designed. Records are apart.

## One-time tips (Settings.tipsSeen)

`night.head` — the first walker: "Aim for the head. Body shots only slow them
down." · `night.eyes` — the first eyeshine in fog: "Eyes in the fog. Light
them up." · `night.bloater` — the first bloater: "Shoot the bloater before it
reaches you." · `night.crawler` — the first crawler: "Watch the road. Some of
them crawl." · `night.reload` — until the player reloads by themselves.

## The results note

What took you and what would help: "A walker at the barricade. Aim for the
head: three body shots take too long." · "A runner out of the corn. Runners
come fast; a headshot stops them dead." · "The bloater. Shoot it before it
reaches you." · late in a long wave: "The fog gets thicker the longer a wave
goes. Keep the road clear."

## Secrets (easter eggs)

Delightful, discoverable, never in the way. "Secrets 2 of 8" on the results.

1. **Gas & Eats.** The neon sign reads GAS & EATS. Shoot out letters until it
   reads EAT (shoot G, A, S, &, S): the sign sputters, and a groan from the
   fog sounds almost like approval.
2. **The scarecrow.** Light it with the beam for two seconds: it slowly turns
   its head to follow you. Shoot it and it isn't there any more.
3. **The phone booth.** Shoot the booth's light: the phone rings three times,
   and a distant phone in the motel rings back.
4. **The drive-in.** Between waves, when the fog thins, shoot the projector
   booth's lamp on the hill: the screen flickers on with a scratchy black-and-
   white shadow play of a man fleeing a shambling figure — then the fog rolls
   back.
5. **The moon.** Shoot the moon three times: a wolf howls, far off. A fourth
   time: a second howl answers, much closer.
6. **The cat.** A black cat sits on a fence post by the corn. Shoot near it:
   it hisses and relocates to the top of the Gas & Eats sign, the wrecked
   car's roof, the motel sign. It survives everything.
7. **The radio.** Through the station window behind the counter (visible at the
   right edge of a wide screen; off screen below about 1.5:1), a radio. Shoot it: it plays a few bars of a 1950s ballad
   (synthesised) until the next wave.
8. **The duck.** A yellow rubber duck bobs in a puddle by the pumps. Shoot it:
   it squeaks and spins. (Every game hides one duck. Find them all.)

Konami on the arcade: the Golden Revolver → in Dead of Night, a golden rifle
and a golden beam.

## The aim check

Before every game, as High Noon's bottles: **nine mason jars** on the fence
posts, the pumps, the barricade and the bus, each with a candle stub glowing
inside, placed to cover the screen's corners, edges and centre. The lit one
glows brighter and its candle flares; a hit bursts it into glass and a puff of
wax smoke. The flashlight is on through the check (it helps the player see
where they aim). The check's framing is the scene's own wide lens; play closes
in from the same eye, as in High Noon.

## Feel and sound

- Sound carries the dread: crickets and frogs; a far dog; the streetlight's
  buzz and flicker; wind in the corn; the power lines humming; the groans
  (layered, formant-shaped noise, each one different); feet dragging on
  asphalt; the corn's rustle; the lever's clack; the rifle's report rolling
  away across the fields in the fog (long, damp echo); the heartbeat.
- Muzzle flash lights the canopy and the barricade for a frame (Reduce
  Flashing tones it to ≤ 20% and ramps it). The beam itself never flashes.
- 60 fps on a MacBook with the tracker running.

## Asset contract

All glTF is Y-up, metres, player at the origin, eyes at 1.7 m, looking along
−Z (north up the road). Everything is made by `art/night/` Blender scripts —
nothing downloaded — reusing High Noon's pipeline and character library
(`art/western/`, imported read-only; extend it in `art/night/`, don't edit the
western scripts).

### `public/assets/night/road.glb` — Route 9

- **Baked lighting** as in High Noon (Cycles bake to unlit atlases), **plus an
  albedo layer**: the flashlight must add light at runtime, which needs each
  surface's own colour without the baked light. So every baked group carries
  two textures: `lit` (moon, sky, the steady practical lights, ambient
  occlusion — no fog: the game draws fog) and `albedo`. The game's material
  shows `lit` and adds `albedo × spotlight(position, normal)` for the beam.
  How the second texture travels in glTF is the art's choice, documented in
  `art/night/README.md`: each baked material `night.<group>.<surface>` is
  unlit with `lit` as its base map, and its extras name `albedo`
  (`road_albedo_<group>.webp`, beside road.glb), `flicker`, `surface` and
  `glow`; the corn carries its layers per vertex (`COLOR_0` = lit,
  `_ALBEDO`, `_FLICKER`, `_SWAY`, material extras `bake: "vertex"`).
- **The streetlight flickers**: its baked contribution must be separable — a
  single-channel `flicker` mask (where the streetlight's light falls) the game
  multiplies by the flicker, or a separate baked layer. *(As built:
  `road_flicker_<group>.webp` named in each material's extras — the lamp's
  light in units of `albedo × SODIUM`, ÷ the scene's `flicker_scale` — and
  `_FLICKER` on the corn; `colour = lit − albedo × SODIUM × flicker_scale ×
  street × (1 − on) + albedo × beam / π`.)*
- **Named nodes:** `camera.player`; `moon` (an empty whose −Z is the moonlight
  direction, for the characters); `light.street` (the lamp head), `light.neon`,
  `light.motel.<n>`; `lane.road.<n>`, `lane.corn.<n>`, `lane.trees.<n>`
  (ordered waypoints each lane walks, from the fog to the barricade);
  `spawn.bus`, `spawn.booth`, `spawn.fence` (surprise spawns with an exit path
  `spawn.<id>.path.<n>`; `spawn.bus` at the foot of the bus's door and
  `spawn.fence` at the rail, the clips carrying the body from behind them
  onto the path's short first stretch); `path.survivor.<n>.<k>` (the
  survivors' runs); `street.lamp` (the lamp's lens, its own mesh);
  `spread` on each lane and spawn; `barricade.<n>` (where the dead stand when they reach
  you, spread along the barricade); `calib.1-9` (the mason jars);
  `secret.sign.<letter>` (each neon letter separately: `G`, `A1`, `S1`, `amp`,
  `E`, `A2`, `T`, `S2`), `secret.scarecrow` (with a `secret.scarecrow.head`
  pivot), `secret.booth.light`, `secret.phone.motel`, `secret.drivein.lamp`,
  `secret.drivein.screen` (a plane the game can put a video texture or shader
  on), `secret.radio`, `secret.cat.spot.<n>`, `secret.duck`; `moon.disc` (the
  moon, far away, shootable — as built low over the fields front-left,
  azimuth −24°, 14° up, inside the play view); `light.booth` (added: the phone
  booth's panel); `ground.shadow`; `corn` (the corn as separate
  instanced/card geometry the game can sway, with the paths ahead of each corn
  lane).
- **Surfaces** in extras as High Noon's: `asphalt`, `dirt`, `wood`, `metal`,
  `glass`, `cloth`, `plant` (corn), `sandbag`, `water` (puddles).
- **Budget:** ≤ 14 MB with textures (WebP, Draco).

### `public/assets/night/sky.webp`

A night sky (moon and cloud, faint stars through breaks), rendered in Blender;
the background and the characters' environment light.

### Characters: `walker.glb`, `mechanic.glb`, `survivor.glb`, `cat.glb`

- **The same humanoid armature and bone names as High Noon's characters**
  (`hips` … `foot.R`, see WEB_ARCHITECTURE.md), facing +Z, feet at the origin,
  clips in place, so clips can be shared and the engine's character runtime
  plays them.
- `walker.glb`: `char.walker` with outfit variants the game dresses:
  `var.outfit.farmer`, `.trucker`, `.waitress`, `.hunter`, `.mechanic_small`,
  `.suit`; `var.hair.<n>`; body variants `var.runner` (leaner, fresher),
  `var.crawler` (legs gone below the knee — or a separate `char.crawler`),
  `var.bloater` (swollen, with a bursting belly morph or a separate mesh). Pale,
  mottled skin, dark sunken eyes with a **reflective eye material** (the eyes'
  shine in the beam is a gameplay cue — a small emissive-when-lit patch the
  game can drive, e.g. named `eyes`).
  Clips: `idle` (swaying), `walk.shamble`, `walk.limp`, `walk.drag`,
  `walk.lurch`, `run`, `lunge`, `crawl`, `claw` (attacking at the barricade,
  loops), `stagger`, `hit_head`, `death_back`, `death_forward`,
  `death_crumple`, `climb_out` (from the bus), `vault` (over the fence),
  `bloat_burst` (for the bloater).
- `mechanic.glb`: the Mechanic, `var.mask` (the welding mask, rigid on `head`,
  separate so it can fly off), a tyre iron in `socket.weapon` on `hand.R`.
  Clips as the walker's plus `roar`, `mask_off`, `swing`.
- `survivor.glb`: two living people (`var.person.daughter`,
  `var.person.owner`), a lantern prop in `socket.lantern` on `hand.L` with a
  flame the game can light; clips `run`, `run_lantern`, `duck`, `wave`.
- `cat.glb`: a black cat — `sit`, `hiss`, `leap`, `walk`.
- **Budget:** 10–18k triangles and one 1024² atlas set per character file.
  *(As built: `walker.glb` has one 2048² set — it carries thirteen people's
  skin and clothes, the base, six outfits, four hair, runner, bloater,
  crawler; the eyes of every file have their own small texture so the game can
  drive their shine; the Mechanic's 1.15× size is on the armature object.)*

### `public/assets/night/poster.webp`

The arcade's card and the share image: the road into the fog at night, the
beam catching eyes, the station's neon — composed like High Noon's poster.
