# The animals of the Valle Serra

`public/assets/ridge/animals.glb`: a Brown Swiss **cow** with her bell, a Valais
Blacknose **sheep**, a chamois-coloured mountain **goat**, a golden **eagle** and
the farm's Bernese **dog**. Every mesh, texture, rig and clip is made by the
scripts in this folder, in Blender, from nothing.

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    -P art/ridge/fauna/build.py -- [--quick] [--blend DIR] [--only cow,eagle]
```

or the `animals` stage of `art/ridge/build.py`. A full build takes about
__BUILD__ on an M-series Mac (the cow is the slowest). `--only` writes a partial
file to `art/ridge/build/fauna/` instead (it never overwrites the real one);
`--blend` saves the scene for the review renders:

```
Blender -b art/ridge/build/fauna/fauna.blend -P art/ridge/fauna/review.py -- \
    [--what turn,close,clips,scope] [--only goat] [--fast]
```

Renders land in `art/ridge/build/review/fauna/` (not committed): turnaround and
close-up sheets, one contact sheet per clip, and the 6x scope views (vertical
FOV 7.5 deg, 2560x1440, a low dawn sun behind the camera to its left): the
cows at 250 m and the siren secret, the sheep at 700 m, the goat on a cliff at
600 m, the eagle landed 2.5 m in front of the scope. Check the file with
`python3 art/ridge/check.py animals`.

## Conventions

- Y up, metres; every animal faces **+Z**; its feet are on y = 0 around its
  origin. Clips are **in place**: the game moves the root (speeds below, in m/s,
  so nothing skates). Sampled at 30 fps.
- The root nodes are named `cow`, `sheep`, `goat`, `eagle`, `dog` (each an
  armature node: clone it with `SkeletonUtils.clone`). Each has **one skinned
  mesh**, `<animal>.body`, with one material and one atlas (albedo, normal, ORM;
  WebP): 1024^2 for the cow and the eagle, 512^2 for the others.
- Clip names are `<animal>.<clip>` (glTF animations are global). Each drives only
  its own animal's bones: bind a mixer to the animal's root.
- Bones share names across animals (`head`, `neck`, `tail.1`...); look them up
  under the animal's root. three.js strips the dots from node names; the
  original name is in `userData.name`.
- Root node extras carry what the game needs in numbers: `speeds`
  (`{clip: m/s}`), the goat's `hop` and the eagle's `land` (below).

## Quadrupeds (cow, sheep, goat, dog)

One skeleton tree: `pelvis` (root) - `spine` - `chest` - `neck` - `neck.2` -
`head` (- `jaw`, `ear.L`/`ear.R`); `pelvis` - `tail.1` - `tail.2` - `tail.3`;
`chest` - `front.upper.L/R` - `front.lower` - `front.foot` (the hoof or paw);
`pelvis` - `hind.upper.L/R` - `hind.lower` - `hind.foot`. To turn a head toward
the player on top of a clip, rotate `neck.2` and `head` after the mixer update.

| Clip | s | Loop | Notes |
| --- | --- | --- | --- |
| `cow.idle` | 6.0 | yes | standing, chewing the cud, looking about, ears and tail busy |
| `cow.graze` | 8.0 | yes | head down, tearing grass, chewing; a fore hoof steps forward (2.9 s) and back (6.2 s), a hind hoof stamps (4.7 s); tail swishes |
| `cow.walk` | 1.2 | yes | **0.9 m/s**, lateral-sequence walk, head nodding twice a cycle |
| `cow.look_up` | 1.8 | no | from `cow.graze`: the head comes up and **ends looking straight along +Z, raised 14 deg** (at a player 60 m up and 250 m away); hold the last frame. For "every cow turns to look at you", turn each cow's root toward the player while this plays |
| `sheep.idle` | 5.0 | yes | standing, chewing, looking about |
| `sheep.graze` | 6.0 | yes | quick nibbles, a step forward and back, tail wags |
| `sheep.walk` | 0.8 | yes | **0.7 m/s** |
| `sheep.run` | 0.46 | yes | **2.6 m/s**, a bounding trot (to flee a shot) |
| `goat.stand` | 6.0 | yes | alert on the ledge: head snapping round and holding, ears turning, tail flicks |
| `goat.bleat` | 1.6 | no | head up and forward, jaw open and trembling 0.34-1.0 s; ends in the `goat.stand` pose |
| `goat.hop` | 1.9 | no | the jump to a higher ledge - see below; ends in the `goat.stand` pose |
| `goat.walk` | 0.75 | yes | **0.8 m/s** (spare) |
| `dog.idle` | 5.0 | yes | standing, panting, tail wagging, looking about |
| `dog.walk` | 0.7 | yes | **1.0 m/s** |
| `dog.run` | 0.4 | yes | **4.5 m/s** rotary gallop, ears flying |
| `dog.bark` | 1.2 | yes | two barks per loop, braced forward, tail up |

**The cow's bell** is the bone `cow.bell` (child of `neck.2`, pivoting at the
bottom of the strap under the throat); the bell mesh is weighted to it alone.
In every cow clip it swings by simulation (a damped pendulum driven by the
neck), so it rings true to the motion; to add more (a startle, the siren),
rotate it about its local X/Z after the mixer update. Cowbell sound: the bell's
world position is the bone's.

**The goat's hop** (`goat.hop`, 1.9 s): the game moves the root, and only
between `takeoff` = 0.45 s and `land` = 1.07 s, along

    u = (t - takeoff) / (land - takeoff)
    root = start + forward * (1.62 u) + up * (1.5 u + 4 * 0.35 * u (1 - u))

(forward = the goat's +Z, up = +Y; extras `hop` = `{takeoff, land, forward,
up, arc, duration}`), so the goat ends 1.62 m forward and **1.5 m higher**, on
the new ledge, in the stand pose. The clip is the physical jump (crouch, a
0.1 s push to 2 m/s forward and 5.25 m/s up, ballistic flight, forelegs
landing just past the top of the arc, 0.3 s absorbing the speed) minus that
arc, so following the arc exactly gives a real jump. The valley's
`secret.goat.<n+1>` ledges should sit about there relative to `secret.goat.<n>`;
the arc can be scaled by +-25% and still look right. Sequence for the secret:
`goat.bleat`, then `goat.hop`, then `goat.stand`.

## Eagle

Bones: `body` (root, at the hips) - `neck` - `head`; `body` - `tail`; `body` -
`wing.1.L/R` (arm) - `wing.2` (forearm) - `wing.3` (hand and primaries);
`body` - `fold.L/R` (the folded wing); `body` - `thigh.L/R` - `shin` - `foot`.

The mesh holds two sets of wings: the **spread** wings (on `wing.*`) and
sculpted **folded** wings (on `fold.*`). The set not in use is scaled to 0.001
in every clip (it collapses inside the body), so nothing is needed from the
game - just don't override bone scales.

| Clip | s | Loop | Notes |
| --- | --- | --- | --- |
| `eagle.glide` | 4.0 | yes | wings spread, primaries fingered, small balancing corrections, head looking down; soaring speed is the game's (10-15 m/s reads right) |
| `eagle.flap` | 1.1 | yes | two big wingbeats (about 1.8 per second) |
| `eagle.land` | 3.0 | no | glide, flare, touchdown, fold, settle, stare - see below; hold the last frame, then play `eagle.stare` |
| `eagle.stare` | 3.0 | yes | perched, wings folded: the head held still between small quick moves, a slow cock of the head |

**Landing** (extras `land` = `{touch: 1.2, swap: 1.85, stare: 2.6, duration: 3.0}`):
0-0.35 s gliding in; 0.35-0.9 s the flare (body up, wings cupped forward,
tail down, legs thrown forward); **touchdown at 1.2 s** - the game must bring
the root to the rock by then, decelerating (e.g. `root = rock + (start - rock) *
(1 - t/1.2)^2`), and leave it still afterwards; 1.2-1.55 s balancing; the wings
fold and at **1.85 s** the folded wings replace the spread ones; a settle and a
cock of the head; from **2.6 s** the stare pose (head level, looking along +Z at
the scope), held to the end. Face the root toward the player before landing.

## Budgets

| Animal | Triangles | Atlas |
| --- | --- | --- |
__TRIS__

File: __SIZE__.

## How it is made

On High Noon's character library (`art/western/characters/charlib`, imported
read-only), extended here:

- **Sculpts** are signed distance fields (`sdf.py`), one module per animal;
  bodies use `lib.SmoothTube` (a generalised cylinder whose field has no steps,
  so the baked normals have no seams), heads are sculpted in their own frame.
- **Game meshes**: surface nets, collapse-decimated (the eagle's head in a
  second pass, so it keeps several times the density of the body).
- **UVs** are unwrapped by anatomical part (`lib.uv_by_parts`: a tail and the
  udder behind it can never share texels) and packed with a texel weight per
  part (faces and heads get the most).
- **Textures** are baked analytically (`lib.bake_job`, after charlib's
  `abake`): every texel snapped onto the sculpt, painted there, its normal the
  sculpt's gradient plus a fine relief (hair lying in its direction, wool curls,
  overlapping feathers), with a conservative raster so sliver islands get baked
  texels; occlusion at the animal's scale, ground included (`lib.big_ao`).
- **Weights**: bone heat on a closed proxy, corrected by part (tails, ears and
  jaws move alone); rigid parts (horns, the bell) and the eagle's wings are
  weighted analytically.
- **Clips** (`quad.py`, each animal's module): a gait generator (planted feet
  travelling back at exactly the walking speed, Hermite swings, the cannon
  flexing, shoulders gliding), keyed poses with easing, layers for chewing,
  ear flicks, tail swishes, breathing, and post passes that simulate pendulums
  (the bell, the dog's ears).
