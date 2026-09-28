# The people of the Valle Serra

`soldier.glb` and `civilian.glb` for Overwatch Ridge, generated from nothing
by these scripts in Blender on High Noon's character library
(`art/western/characters/charlib`, imported read-only: sculpts as signed
distance fields, ring-built garments, an analytic atlas bake, bone-heat
weights, keyed clips with IK). Nothing is downloaded.

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    -P art/ridge/people/build.py -- [--only soldier,civilian] [--blend DIR] [--quick] [--out DIR]
```

writes `public/assets/ridge/{soldier,civilian}.glb` (Draco meshes, WebP
textures); the top-level `art/ridge/build.py` stage `characters` calls
`people.build.build(ASSETS, quick=...)`. `--blend DIR` also saves each scene
(git-ignored) for the review; `--quick` bakes 512 atlases (iteration only).
`--clips-only [--clips a,b]` reopens the saved scenes and re-bakes just the
clips (seconds, not minutes). Check with `python3 art/ridge/check.py soldier civilian`.

Review renders (`art/ridge/build/review/people/`, git-ignored):

```
Blender -b art/ridge/build/people/soldier.blend -t 4 -P art/ridge/people/review.py -- \
    --what turn,faces,hands,strips,distance --dress "var.helmet+var.pack+gun.rifle,..." \
    [--pair art/ridge/build/people/civilian.blend --pair-dress var.person.farmer]
```

## Conventions (both files)

- Y up, metres, **facing +Z**, the boot soles on y = 0, the origin between
  the feet. High Noon's armature and bone names exactly (`hips` root ...
  `foot.R`); rest pose an A-pose. No node or mesh is named like a bone.
- Clips are **in place** (the origin never moves; the hips do), sampled at
  **30 fps**. Walks and runs move the feet back at their speed: move the
  root at the speed given below and nothing skates.
- Props are children of their socket with **identity transforms** (their
  vertices are in the socket's frame): toggle `visible`, they follow the hand.
  A socket's local -Z (glTF) runs along the barrel, +Y is the top of the gun
  (charlib's `socket.gun` convention).
- One material per atlas: albedo, normal, ORM (occlusion R, roughness G,
  metalness B), 1024², WebP. Double-sided.

## soldier.glb

`char.soldier` is always shown: a young infantryman of a fictional
mid-century army (no insignia): a dark field-green tunic with patch pockets
over trousers bloused into laced boots, a pale olive-khaki webbing belt with
four ammunition pouches, Y-braces and a water bottle.

| Node | What | Hangs from |
| --- | --- | --- |
| `var.helmet` | round steel helmet, chin strap | rigid on `head` |
| `var.cap.officer` | peaked service cap | rigid on `head` |
| `var.coat.officer` | the officer's dark double-breasted greatcoat, belted, a pistol holster | skinned |
| `var.ghillie` | the counter-sniper's hooded suit of jute strips (hide the helmet) | skinned |
| `var.pack` | rucksack, groundsheet roll, entrenching tool | rigid on `chest` |
| `socket.gun` | the right fist's grip | `hand.R` |
| `gun.rifle` | bolt-action service rifle with a sling | `socket.gun` |
| `gun.rifle.scoped` | the counter-sniper's rifle; its child **`socket.glint`** sits on the objective lens, -Z out through it | `socket.gun` |
| `gun.mg` | bipod light machine gun (top magazine), built on the rifle's key points so every rifle clip holds it | `socket.gun` |
| `prop.binoculars` | in the right fist, round the right barrel | `socket.gun` |
| `socket.hand.L` | the left fist's grip (socket.gun mirrored) | `hand.L` |
| `prop.cigarette` | pinched in the left hand | `socket.hand.L` |
| `socket.back` | a frame on the chest | `chest` |
| `gun.rifle.slung` | the rifle hung on the right shoulder, muzzle up (show instead of `gun.rifle`) | `socket.back` |

Dressings: sentry/patrol/guard = `var.helmet` (+ `var.pack`) + `gun.rifle`
(or `gun.rifle.slung`); officer = `var.cap.officer` + `var.coat.officer` (+
`prop.binoculars`); gunner = `var.helmet` + `gun.mg`; counter-sniper =
`var.ghillie` + `gun.rifle.scoped`; driver = `var.helmet`, no gun.

Two atlases: `soldier` (the man, helmet, cap, greatcoat, pack) and
`soldier_kit` (weapons, binoculars, cigarette, the ghillie) - one would halve
the man's texel density for props most soldiers never show.

### Clips

| Clip | s | Loop | Props | Notes |
| --- | --- | --- | --- | --- |
| `idle` | 4.0 | yes | `gun.rifle` | at ease, rifle at a low ready across the body; a look up the road |
| `idle_smoke` | 7.0 | yes | `gun.rifle.slung`, `prop.cigarette` | right thumb in the sling; the cigarette at the lips 1.25-2.2 s, smoke let out 2.9 s |
| `look_binoculars` | 8.0 | yes | `prop.binoculars`, `gun.rifle.slung` | glasses on the eyes, a slow scan right, across to the left, back |
| `walk` | 1.10 | yes | `gun.rifle` | alert, rifle at the low ready: **root at 1.30 m/s** |
| `patrol_walk` | 2.48 | yes | `gun.rifle.slung` | a bored man on a road, thumb in the sling, left arm swinging, head wandering: **root at 1.05 m/s** |
| `run` | 0.66 | yes | `gun.rifle` | port arms: **root at 3.60 m/s** |
| `crouch` | 3.0 | yes | `gun.rifle` | down on his heels, rifle at the ready, head turning, breathing hard |
| `prone` | 3.0 | yes | `gun.rifle` | on his belly behind cover, rifle on the ground ahead, breathing |
| `prone_aim` | 3.0 | yes | `gun.rifle.scoped` / `gun.rifle` / `gun.mg` | elbows planted, cheek on the stock, the scope on his eye; breathing sway |
| `prone_fire` | 0.6 | no | as prone_aim | *extra* - one shot from prone (`fire` is standing) |
| `prone_death` | 1.0 | no | as prone_aim | *extra* - shot where he lies; still at 0.55 s |
| `aim` | 2.0 | yes | `gun.rifle` / `gun.mg` | standing, bladed, sights on the right eye |
| `fire` | 0.6 | no | as aim | the kick and the settle, ends on `aim` |
| `fire_burst` | 0.6 | yes | `gun.mg` | *extra* - a machine-gun burst standing (behind sandbags): four rounds a loop |
| `prone_fire_burst` | 0.6 | yes | `gun.mg` | *extra* - the burst from prone, on the bipod |
| `hit_body` | 0.6 | no | as aim | from and to `aim` |
| `wound_kneel` | 1.4 | no | `gun.rifle` | from `idle`: the hit, the right knee hits the ground at **0.50 s**, bent over, left hand clamped to the wound, rifle grounded; hold the last frame |
| `wounded` | 2.0 | yes | `gun.rifle` | *extra* - `wound_kneel`'s last frame, breathing hard |
| `death_kneel` | 1.1 | no | `gun.rifle` | *extra* - the second hit from `wounded`: face down, **lands 0.55 s** |
| `death_back` | 1.4 | no | `gun.rifle` | from `idle`: flung back, sits into the fall, **lands on his back at 0.80 s**, bounce |
| `death_forward` | 1.4 | no | `gun.rifle` | from `idle`: doubles over, knees at 0.45 s, **face down at 0.88 s** |
| `death_crumple` | 1.2 | no | `gun.rifle` | from `idle`: knees buckle (0.42 s), **topples onto his side at 0.70 s** |
| `dismount` | 2.1 | no | `gun.rifle` | out of the back of the truck (below); ends on `idle`'s first frame |
| `drive` | 4.0 | yes | none | seated at the wheel (below) |
| `drive_death` | 1.3 | no | none | *extra* - shot at the wheel, slumps over it; still at 0.9 s |

Prone: he lies along +Z with his head toward it. The pelvis is **0.62 m
behind the origin** (glTF z = -0.62), both elbows planted on the ground 7-8
cm ahead of the origin, the boots 1.3-1.46 m behind it; the eye 0.34 m up
at z = +0.08; the muzzle **0.29 m up, 0.92 m ahead** (gun.mg's 1.0 m) and
the `socket.glint` lens 0.34 m up, 0.51 m ahead. The machine gun's bipod
feet rest on the ground 0.87 m ahead. Put the root where he lies (a
tower's floor, a ledge) with 1 m clear ahead of it for the barrel.

The machine gun fires bursts with `fire_burst` (standing) and
`prone_fire_burst`: four kicks per 0.6 s loop, played while the gun fires.

Standing `aim`: the muzzle is 1.47 m up, 1.14 m ahead; with `gun.mg` its
bipod feet hang 1.17 m up, 1.08 m ahead - a sandbag wall about that high
takes its weight.

### The truck (numbers shared with the vehicles)

- `drive`: put the root at the vehicle's `seat.driver` (same position and
  orientation, glTF +Z = forward). The pelvis (`hips` head) sits 0.42 m
  above the root and 0.02 m behind it; the feet rest 0.40-0.42 m ahead on
  the floor at the root's height; the hands hold the rim (centre 0.80 m up
  and 0.38 m ahead, radius 0.19 m, tilted 30° back from vertical) at ten to
  two. The hands follow the wheel turned by
  `steer(t) = 7° sin(2πt/4) + 3° sin(2π·3t/4 + 1)` (clockwise as he sees it) -
  turn the wheel mesh by the same angle to match. Road bumps come up through
  the seat at 0.97, 2.46 and 3.36 s.
- `dismount`: the root on the ground behind the tailgate (the truck's
  `dismount.<n>`), facing away from it. He starts crouched on the bed, feet
  **1.15 m above the root and 0.55 m behind it**; a step to the edge, the
  feet leave the bed at **0.62 s**, he lands at the root on bent knees at
  **1.02 s**, rises to `idle` by 2.1 s.

## civilian.glb

Four people on the shared armature, one whole skinned mesh each with its own
atlas - the game shows exactly one `var.person.*`. They are unmistakable
through the scope: no helmet, no weapon, bright clothes.

| Node | Who |
| --- | --- |
| `var.person.farmer` | a weathered man in faded blue bib-and-brace overalls over a pale check shirt, green rubber boots, a straw hat |
| `var.person.cyclist` | a young woman in a red jacket, a navy skirt and stockings, a yellow headscarf; rides the `bicycle` |
| `var.person.shepherd` | an old man with a white beard, a red wool jacket, a mustard knitted scarf, a felt hat and his crook (part of his mesh, in his left fist) |
| `var.person.child` | a boy of nine in a yellow jumper, navy shorts and knee socks; **extras.scale = 0.64** |

**The child** is built on the adult skeleton with a child's proportions (a
head 1.3 times the adult's, seated lower on a short neck; a slighter build,
smaller hands) - scale the whole rig by the node's `extras.scale` (0.64:
1.80 m becomes 1.15 m) when he is shown, and his speeds with it.

**The bicycle** is a node hierarchy on the same rig - bones added after the
people were weighted, each carrying its rigid mesh:
`bicycle` (frame, bars, saddle, mudguards, rack, lamp) >
`bicycle.wheel.front`, `bicycle.wheel.rear`, `bicycle.crank` (chainset) >
`bicycle.pedal.L`, `bicycle.pedal.R`. Show the `bicycle` node with the
cyclist (hide it otherwise); the `cycle` clip animates the crank (one turn
per 1.2 s), the wheels (2.5 times as fast, 28-inch) and the pedals (level
with her soles) with her legs. It stands at the origin, its footprint centred
on it, pointing +Z.

| Clip | s | Loop | Notes |
| --- | --- | --- | --- |
| `idle` | 4.0 | yes | standing about, a look round |
| `walk` | 1.16 | yes | **root at 1.25 m/s** (the child: × 0.64) |
| `run` | 0.70 | yes | *extra* - running away: **root at 3.2 m/s** |
| `cycle` | 2.4 | yes | on the bicycle: **root at 4.58 m/s** (16.5 km/h); two crank turns, five wheel turns |
| `wave` | 1.2 | yes | the right arm up, the hand swinging |
| `panic` | 1.0 | yes | hunched, hands clamped over the head, looking about |
| `duck` | 0.8 | no | a flinch, then down on the heels, hands over the head; hold the last frame |
| `death` | 1.3 | no | *extra* - if one is ever shot: knees, then face down at 0.85 s |

The left hand in the standing clips is a fist round a vertical staff at the
thigh - where the shepherd's crook lives; on the others it reads as a
relaxed hand.

## Where this goes beyond or departs from the contract

- **Extra nodes**: `gun.rifle.scoped` + `socket.glint` (asked for),
  `gun.rifle.slung` on a new `socket.back`, `socket.hand.L`, `var.coat.officer`.
- **Extra clips**: soldier `wounded`, `death_kneel` (the second hit while
  kneeling), `prone_fire`, `prone_death`, `drive_death`, `fire_burst`,
  `prone_fire_burst`; civilian `run`, `death`. The contract's clips are all
  there under their names.
- **Two atlases in soldier.glb** (`soldier`, `soldier_kit`), each 1024²; the
  civilians have one per person.
- **The bicycle is bones on the civilian rig** (not deform bones, not in any
  weights), so its channels ride in the same `cycle` animation; every other
  clip keys them at rest.
- **The child** is the adult rig at `extras.scale` 0.64 (as proposed).
- `idle`, the deaths and `wound_kneel` start from `idle`'s pose (a sentry's
  rifle at the low ready), not `aim`: crossfade ~0.1 s from whatever plays.

## How it is made

- `build.py` - entry; `soldier.py`, `civilian.py` - who wears what, the
  sockets, the files.
- `assemble.py` - charlib's `pipeline.person` extended: several atlases per
  file, props on any socket, per-point skinning (ghillie strips take the
  weights of the point they are sewn on), parts joined into a variant.
- `parts.py` - heads (with a filled-out lower face; at any scale for the
  child), hands in their poses, boots.
- `wear.py`, `wear_civ.py` - garments and gear as fields and ring meshes:
  the tunic and greatcoat (charlib's coat, closed, over the trousers'
  seat), combat and rubber boots, webbing, helmet, cap, pack; overalls, skirt,
  stockings, headscarf, knitted scarf, crook, jumper.
- `ghillie.py` - the suit and its ~900 strips.
- `arms.py` - rifle, scoped rifle, machine gun, binoculars, cigarette, the
  slung rifle, in their socket frames.
- `bicycle.py` - the bicycle's parts, bones and wheel/crank keys.
- `kin.py` - props placed first (sights on the eye, glasses on the eyes, a
  cigarette on the lips, fists on a steering wheel), both wrists solved from
  them.
- `gait.py` - walks and runs with a heel-to-toe foot roll on a ground moving
  at the gait's speed.
- `clips_soldier.py`, `clips_civilian.py` - the clips.
- `review.py` - the review renders.
