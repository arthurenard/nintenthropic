# The people of Dust Creek

Everything here is generated: every mesh, texture, rig and clip of High Noon's
characters is made by these scripts in Blender. Nothing is downloaded.

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P art/western/characters/build.py                # all four files
    [-- --only bandit,boss --blend /tmp/chars]         # some of them; also save the scenes
```

writes `public/assets/western/{bandit,boss,townsfolk,chicken}.glb` (glTF
binary, Draco meshes, WebP textures). A full build takes about 12 minutes on
an M-series Mac. `review.py` renders turnarounds, close-ups, clip contact
strips and in-game-distance shots from a scene saved with `--blend`.

## Conventions (the contract in docs/WEB_ARCHITECTURE.md, and what the game expects)

- Y up, metres; the character faces **+Z** (Blender −Y), his left is +X; the
  boot soles are on y = 0 and the origin is between the feet.
- One humanoid armature for every person: `hips` (root), `spine`, `chest`,
  `neck`, `head`, `shoulder.L/R`, `upper_arm.L/R`, `forearm.L/R`, `hand.L/R`,
  `thigh.L/R`, `shin.L/R`, `foot.L/R`. Rest pose: an A-pose, arms 45° down.
  The same joints in every file, so every clip plays on every person (the
  game lends the gang's clips to the townsfolk).
- `socket.gun` is an empty on `hand.R` at the centre of the fist. The props
  `gun.revolver`, `gun.rifle`, `prop.dynamite` are its children with identity
  transforms (their geometry is in the socket's frame): the barrel runs along
  the socket's local **−Z** (glTF), the top of the gun along +Y. In the last
  frame of `aim` and of every emerge clip the socket's −Z points along world
  +Z, at the player (checked in three.js). Toggle their visibility; they
  follow the hand.
- Clips are **in place**: no root motion. The hips move (a crouch, a fall),
  the origin does not. Sampled at 30 fps.
- No node or mesh is named like a bone.
- Budget: one 1024² atlas per person (albedo, normal, and an ORM texture:
  occlusion R, roughness G, metalness B), one material.

## bandit.glb

`char.bandit` (head, hands, shirt with rolled sleeves, trousers into riding
boots, belt, cartridge belt and holster with a spare revolver) and the
variants the game dresses with:

| Variant | |
| --- | --- |
| `var.hat.stetson`, `var.hat.bowler`, `var.hat.flat` | fitted to the head; rigid on `head` |
| `var.bandana.red`, `var.bandana.black` | pulled up over nose and mouth, knotted behind |
| `var.coat.duster`, `var.coat.jacket` | ring-built over the shirt; the skirt swings between hips and thighs |
| `var.vest` | waistcoat with a watch chain |
| `var.armour` | a riveted boiler-iron plate, rigid on `chest` |

## boss.glb — "Black Jack" Carver

`char.boss`: an older, craggy face with a scar across the left eye and a salt
and pepper horseshoe moustache, oxblood shirt, black vest, black chaps with
conchos, twin holsters, ivory-gripped nickel revolvers. The game dresses him
with `var.hat.stetson` (black, silver conchos) and `var.coat.duster` (black,
long). Same clips as the gang.

## townsfolk.glb — how the townsfolk are dressed

The game dresses townsfolk by role with these names (see
`src/games/western/world/cast.ts`), so **each `var.coat.*` is a whole person**
on the shared armature, with their own atlas:

| Role | Outfit the game shows | Person |
| --- | --- | --- |
| barber | `var.coat.apron` | a balding man with a waxed handlebar, striped shirt with sleeve garters, white apron |
| bartender | `var.coat.apron` + `var.vest` | the same man in a burgundy vest |
| woman | `var.coat.dress` + `var.hat.bonnet` | a young woman, auburn hair in a bun, lavender dress with a bustle |
| undertaker | `var.coat.black` + `var.hat.top` | a gaunt old man with grey mutton chops, black frock coat, cravat |
| preacher | `var.coat.black` | the same man, bareheaded |

`var.hat.straw` is there too (unused by the game so far). To make the
bartender and the preacher people of their own, a later pass can add, say,
`var.coat.bartender` and `var.coat.preacher` and have the game use them.

Clips: `idle`, `peek` (a hand shading the eyes against the low sun, looking
up and down the street; loops), `hands_up` (a flinch, then hands up, held),
`panic` (cowering, arms over the head; loops), `head_shake` (hands folded,
a slow disapproving shake; loops), `wave` (loops).

## chicken.glb

`char.chicken`, a white hen on her own rig (`body` root, `neck`, `head`,
`tail`, `wing.L/R`, `thigh`/`shin`/`foot.L/R` — the legs bend like a bird's).
Clips: `peck`, `walk` (for 0.4 m/s: the head holds still in the world, then
thrusts), `run` (for 2.6 m/s), `flutter`.

## The gang's clips

All emerge clips end exactly on the aim pose (revolver levelled at +Z, body
bladed a third of a turn to his left), so the game can hold their last frame
while aiming, and every hide clip starts on it.

| Clip | s | Notes |
| --- | --- | --- |
| `idle` | 3.0 loop | weight on the left leg, revolver hanging |
| `hidden` | 2.0 loop | crouched behind cover, gun up; head top 0.95 m |
| `lean_left_out` / `lean_left_in` | 0.33 / 0.30 | **left is his own left** (the player's right): the hidden pose has his head 0.38 m to his right, behind the corner, feet already at the exposed spot |
| `lean_right_out` / `lean_right_in` | 0.33 / 0.30 | mirror of the above |
| `rise` / `sink` | 0.40 / 0.33 | from and to `hidden` |
| `step_out` / `step_in` | 0.43 / 0.43 | one step: the hidden pose stands 0.40 m behind the exposed spot |
| `aim` | 1.0 loop | breathing, the gun's small hunt |
| `fire` | 0.37 | the muzzle kicks up through wrist and elbow, settles |
| `run` | 0.67 loop | two strides at about 4 m/s; contact feet travel back at that speed |
| `throw` | 0.63 | from `idle`; the stick leaves the hand at **0.30 s** (the rules' `THROW_RELEASE`) |
| `hit_body`, `hit_head` | 0.53 | snap, sag, back on target |
| `death_back`, `death_forward` | 1.27, 1.20 | the body meets the ground at **0.85 s** (the game's thud) |
| `death_slump` | 1.0 | folds forward over a sill or barrel; settles at **0.55 s** |
| `death_fall` | 1.3 | lurch, flail, lands face down at **78%** of the clip — the game stretches the clip to its fall time |
| `aim_rifle`, `fire_rifle` | 1.0 loop, 0.5 | extra: a shouldered rifle, left hand on the forend |

## How it is made

`charlib/` holds the pipeline:

- **Sculpts** are signed distance fields in numpy (`sdf.py`): faces
  (`head.py`), hands in their pose (`hands.py`), clothed bodies (`body.py`),
  gear, hats, guns (`gear.py`, `outfits.py`), the hen (`chicken.py`).
- **Game meshes**: garments that bend are ring-built like a modeller would box
  them out — torso rings, armholes, sleeves bridged on, a crotch template,
  rolled cuffs, collars (`rings.py`, `garments.py`) — then snapped onto the
  field; rigid parts are the sculpt decimated; hats are ring-built too.
- **Textures** are baked analytically (`abake.py`): every texel of the game
  mesh is snapped onto the sculpt's field and painted there (`texture.py`,
  `paint.py`), its normal is the field's gradient in the mesh's tangent frame,
  and ambient occlusion comes from the whole character's field.
- **Weights**: bone heat on a closed proxy of each person, transferred to
  every layer by nearest point (`skin.py`), so layers move together.
- **Animation**: poses in armature axes, two-bone IK for planted feet and
  aimed hands, eased keys with overshoot and anticipation, lag for overlap,
  breathing and sway layers (`anim.py`, `clips_bandit.py`, `clips_town.py`).
- `pipeline.py` / `cast.py` put each file together and export it.
