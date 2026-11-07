# High Noon — game design

The first game of Nintenthropic. A realistic western gunfight
you play with a finger pistol: bandits take cover in a sun-baked town, lean out,
aim and fire back, and you survive wave after wave. It must look and feel like
something Apple would put on stage — see [DESIGN.md](DESIGN.md) for the
interface, and this document for the game.

## The fantasy in one line

You stand alone in the middle of Main Street at golden hour. Shutters bang, a
bell tolls, and the Carver gang comes out of every window, doorway and barrel in
Dust Creek.

## The town: Dust Creek

- **Time of day:** late afternoon, sun low behind the player, so the facades
  facing you are warm and readable and the shadows stretch down the street away
  from you. Dust hangs in the air (height fog, light shafts). Distant mesas and a
  clear sky with a few high clouds.
- **Layout** (the player looks down the street; about 60 m to the far end):
  - Left side, near to far: *General Store* (porch, barrels), *Saloon* (two
    storeys, balcony, swinging doors, piano visible through a window), *Barber*
    (striped pole), *Livery* (big barn door, hay bales, a horse's head).
  - Right side, near to far: *Bank* (clock above the door), *Sheriff's Office*
    (wanted posters), *Hotel* (two storeys, three upper windows), *Undertaker*
    (coffins leaning outside).
  - Far end: *Church* with a bell tower and a weather vane; a water tower behind
    the right-hand roofs; a windmill on the ridge.
  - Street: packed dirt with wheel ruts and hoofprints, boardwalks with posts,
    hitching rails, a water trough, a broken wagon at mid-left, crates, barrels,
    lamp posts, a few tumbleweeds.
- **Materials:** everything weathered — sun-bleached planks, peeling paint,
  hand-painted signs, dusty glass, rusted iron. Realistic, not cartoon, but
  unmistakably art-directed: warm ambers and dusty teal shadows.

## The player

- A first-person view from standing eye height (1.7 m) with a gentle breathing
  sway. The crosshair is where the shot goes.
- **Framing:** the aim check looks through the town's own wide lens (every
  bottle in view); as a round begins the view closes in on the street, from
  the same eye, to the tightest lens and slight upward tilt that still show
  every cover's man clear of the page's corner chrome, fitted to the window's
  shape (about 34° tall at 16:10, 27–32° at 21:9), so a man at 30 m stands
  over 90 px tall at 1440 × 900.
- **Revolver:** six rounds. A six-chamber cylinder in the HUD shows what's left.
  **Reload by pointing off the screen** (the arcade classic — the crosshair leaves
  the view for a moment) or by pressing R; it takes 0.9 s with a cylinder spin.
  Firing on empty clicks and shows the reload hint, every time.
- **The hammer:** with the hand, raising the thumb again after a shot cocks the
  hammer, and a soft click says so — lighter than a bandit's, and never while
  reloading, on an empty cylinder (the dry click says it), for a hand found
  again after being lost, or closer together than a quarter second.
- **Recoil:** a short kick of the view and crosshair, settling in 250 ms.

## Health: regenerating, like Call of Duty

- Hidden health of 100. A bandit's hit costs 34 (so three hits in quick
  succession kill you); later waves' bandits hit harder.
- **Being hit:** blood creeps in from the screen's edges in proportion to damage,
  the colour drains, a heartbeat starts, sound muffles (low-pass), and a red
  **damage arc** points toward whoever shot you.
- **Regeneration:** after 3.5 s without being hit, health refills at 40 per
  second; the effects fade with it.
- **Death:** at zero. Time slows, the picture fades to sepia and the view tips
  to the dust. A card says what the results will and what did it: "Fell on
  Wave 4" over "A rifleman on the saloon roof." Then the results card.
- These are Standard's numbers; Relaxed is gentler (see Difficulty).

## The Carver gang: how bandits behave

Each bandit owns a **cover point** (window, doorway, barrel, crate, wagon,
corner, roof edge, bell tower) and cycles through:

1. **Hidden** — out of sight. A tell may give them away: a shadow moving behind
   a window, a creaking door, dust kicked up behind a barrel.
2. **Emerge** — peek out (lean left/right from a corner or barrel), rise (from
   behind a barrel, crate or roof edge), or step out (from a doorway).
3. **Aim** — revolver or rifle comes up; a brief glint of sunlight on the metal
   telegraphs the shot. Aim time is 1.4 s on wave 1, falling to 0.7 s.
4. **Fire** — muzzle flash that lights nearby surfaces, a bullet whiz past your
   ear on a miss, damage on a hit. Hit chance rises with the waves and falls
   with distance.
5. **Hide** — back into cover, then re-emerge at the same point or an adjacent
   one after 0.8–2.5 s.

Variations, introduced wave by wave:

- **Runners** (wave 3+) sprint between covers across the street — moving
  targets worth a bonus.
- **Dynamiters** (wave 4+) light a stick and lob it in an arc toward you. Shoot
  it in the air to blow it up (and anyone near it); let it land and it costs
  heavy damage.
- **Riflemen** on roofs and in the bell tower: slower to aim, more damage, and
  farther away.
- **The boss, "Black Jack" Carver** (wave 5, then every fifth wave): a long
  duster and a scar, takes three body shots or one headshot, moves between
  three covers, and his gang fires cover for him. The first two body shots
  are made light of over him: "Just a scratch.", then "Two scratches."

**Hits:** a headshot always kills. A body shot kills an ordinary bandit; armoured
ones (wave 6+, a visible iron plate) need two. Hit reactions and deaths are
physical: they twist with the hit, drop the gun, fall out of windows, tumble off
roofs, slump over barrels.

**Aim Assist** (Settings, on unless turned off). A finger is not a mouse, so a
shot that passes just beside a target still counts: within 3.5% of the view's
smaller side of a bandit's torso (the aim check's own 95% line), and the
head's zone, the dynamite's and the chicken's, in the same proportion, so a
headshot is as hard to earn, relative to the body, as ever. It reaches
bandits however they move (a runner is a target, and so is a stick of dynamite
in the air), never a townsperson, and never past one the shot passed close
beside: no hit is better than a wrong one. A real hit always beats a near
miss, and a secret's allowance is never widened, so assist does not trigger
one the player was not aiming at. Off, a shot hits exactly what it passes
through. The tables are `ASSIST` in `world/shooting.ts`, scaled on every shot
(`engine/rules/assist.ts`).

## Townsfolk

Now and then an innocent appears — the barber in his doorway, a woman on the
hotel balcony, the bartender at the saloon doors, the undertaker measuring the
street. Shooting one costs 200 points and the wave's **Clean Hands** bonus.
They are visibly different: no guns, pale clothes, hands up when bullets fly.

A townsperson shot is said in words, so it reads without the sound and
without the red: "−200 Townsperson" rises where they stood, in the danger
tone, and the hint line says calmly who it was — "That was the barber." — for
two seconds. A second in the same game is counted ("That was the barber.
That makes two."), and from the third, "The town has noticed." They flinch
and go back inside; nothing more is shown.

## Waves

| Wave | Bandits | New |
| --- | --- | --- |
| 1 | 4 | Slow aim; learn the town |
| 2 | 6 | More covers in play |
| 3 | 8 | Runners |
| 4 | 10 | Dynamiters |
| 5 | Black Jack + 8 | Boss |
| 6+ | +2 each | Armour, faster aim, riflemen |

A wave ends when every bandit in it is down. Then a four-second breather: the
bell tolls, a title card slides in ("Wave 3"), health refills, a tumbleweed rolls
across, and the next wave begins. There is no clock: you last until you fall.
Past wave 6 the cards take turns under the title: "They keep coming.",
"Nobody told them to stop.", "The gang has cousins." (and "Black Jack is
back." on his waves).

## Scoring

- Kill 100, headshot +50, **Quick Draw** +100 (kill within 0.5 s of a bandit
  emerging), runner +50, dynamite in the air +150.
- Streak multiplier ×1 → ×4 on consecutive hits; a miss resets it.
- End of wave: accuracy bonus, **Untouchable** (no damage taken) +500, **Clean
  Hands** (no townsfolk hit) +250.
- The results card: waves survived, kills, headshots, accuracy, best streak,
  score, New Best, secrets found — and under the outcome, one or two short
  sentences on what felled you and the one thing that would help most next
  time (see below).

## What felled you

The rules remember the hit that ended the game: a bullet or dynamite, who
fired or threw it, from which cover, and how far the wave's pressure had
climbed. The results' note says it the way you would point it out, then
matches the advice to it:

| What did it | The note |
| --- | --- |
| A rifleman | "A rifleman on the saloon roof. Riflemen aim longer from up high, so there’s time to look up." |
| Dynamite | "Dynamite from behind the wagon. Shoot it in the air, before it lands." |
| Black Jack | "Black Jack Carver at the livery door. One shot to the head brings him down." |
| Any other bandit | "A bandit behind the wagon. Watch for the glint: it means he’s about to fire." |
| A bullet late in a long wave (the pressure past half way) | "A bandit at the hotel door. The longer a wave lasts, the bolder they get." |

Covers are named as places ("the saloon balcony", "the livery door", "a hotel
window", "the church tower"): the real town's one by one, any other by its
kind and building. The fall's card uses the same words: "A rifleman on the
saloon roof."

## Difficulty

Two, chosen on the page and read when a round starts (a change applies from
the next one): **Standard**, the game as designed and every number above, and
**Relaxed**, for a first evening, a younger player or a tired arm. Relaxed is
the same town, the same waves and gang and the same scoring; only the gang's
nerve and the player's resilience change. Every number lives in one table,
`DIFFICULTY` in `rules/tuning.ts`.

| | Standard | Relaxed |
| --- | --- | --- |
| Aim time | 1.4 s on wave 1, falling to 0.7 s | half as long again: 2.1 s to 1.05 s |
| Glint before the shot | 0.4 s | 0.6 s, a generous warning |
| Chance a shot finds you | the wave's figure | ×0.7 |
| Damage | 34 a hit early on: three quick hits to fall | ×0.75: 26, four quick hits to fall |
| Health comes back | 3.5 s after a hit, 40 a second | 2.5 s after, 50 a second |
| Late-wave pressure | from 25 s of fighting, hit chance +4% a second, up to ×2.2 | from 40 s, +2.5% a second, up to ×2.2 |
| Dynamite's fuse | lit in 0.7 s; 1.3–2.2 s in the air | lit in 1.1 s; ×1.2 in the air (never above 2.4 s, or the lob leaves the picture) |

It must still be a fight you can lose. On Relaxed the late-wave pressure also
wears the allowances away: as it climbs from nothing to its height, the aim,
the glint, the hit chance, the damage, the health's return and the fuse ease
from Relaxed's numbers to Standard's. A player who keeps shooting rarely feels
it; one who stops is overrun, as on Standard, only later.

The balance tests play the same simulated players over both, 24 games each
(`rules/difficulty.test.ts`; Standard's own are in `rules/balance.test.ts`):

| Simulated player | Standard: falls on wave (median) | Relaxed |
| --- | --- | --- |
| Steady hand (0.65 s to shoot, 80% hits) | 5–10 (8) | 9–26 (15); 22 of 24 still fall by wave 25 |
| Slow, wild hand (1.0 s, 55%) | 3–6 (5) | 7–10 (9) |
| Slowest hand (1.3 s, 45%) | 2–5 (4) | 4–10 (7) |
| Never shoots | overrun on wave 1 after 44–96 s | overrun on wave 1 after 86–129 s |

## Learning as you play

High Noon teaches itself a lesson at a time, at the moment it matters, on the
hint line at the foot of the view. Each tip shows once ever (the page keeps
`Settings.tipsSeen`), for four seconds; tips whose moments come together wait
their turn, never two at once, never over the reload hint while it is needed,
and never during the aim check.

| Tip | When | Words |
| --- | --- | --- |
| `western.reload` | the start of every game, until you have reloaded by yourself once | "Point off the screen to reload." (or the mouse's or touch screen's way) |
| `western.glint` | the first glint of a bandit about to fire | "A glint means he’s about to fire." |
| `western.townsfolk` | the first townsperson to appear | "Hold your fire. Townsfolk aren’t with the gang." |
| `western.dynamite` | the first stick thrown | "Shoot the dynamite before it lands." |

The empty-cylinder reload hint is not a tip but a state: it shows whenever
you fire on empty, until you reload. A brief word after a mistake ("That was
the barber.") shows over a tip, which then finishes.

## Reduced flashing

With `Settings.reducedFlashing` on (read every frame, so the pause menu's
switch holds from Resume), nothing in play changes the whole picture's
brightness sharply:

- The screen's white flash for a blast close by is a tenth as strong, and
  swells and ebbs over a few tenths of a second instead of jumping.
- Muzzle flashes, the spark of a bullet on metal, the fireball and its sparks
  drop to a fifth of their brightness or less and fade in.
- Every flashing light (muzzle, blast, the Golden Revolver's shot) is a fifth
  as bright and fades three times as slowly. The baked town takes no light:
  these fall on the people, the glass and the debris.
- The red and grey of being hit close in over a quarter of a second rather
  than in one frame.

Measured through the dev harness on wave 4, a stick landing at your feet
brightens the picture by under a fifth of what it does otherwise, and no
frame is more than 0.015 brighter than the last (0.25 otherwise). The
bandits' glint is unchanged: it is small, a single steady flare rather than a
flicker, and the warning a player needs most.

## The art, and nothing in its place

The town, the gang, the townsfolk, the chicken and the two skies are files
under `public/assets/western/`, and every one is required: in production a
file that does not load fails the game's load with a `DownloadError`, and the
page says "Couldn’t Load the Game" with Try Again. The procedural stand-ins in
`src/games/western/placeholder/` (a whole toy Dust Creek, built to the same
node names, bones and clips) are for development and tests only: they arrive
through a dynamic import that a production build removes, with every path
that uses them.

## Secrets (easter eggs)

Delightful, discoverable, never in the way. The results card counts "Secrets
2 / 8", and each find's toast names it (in brackets below).

1. **The bell** (Three Tolls). Shoot the church bell: it tolls. Toll it three
   times in a row and the church doors creak open — the preacher peers out and
   shakes his head (once at a time, however often he is rung for).
2. **The weather vane** (Pointing at You). Shoot it and it spins wildly, then
   creaks to a stop pointing at you.
3. **The chicken** (Chicken of Steel). A chicken pecks along the boardwalk.
   Shoot near it: a burst of feathers, an outraged cluck, and it runs off
   unharmed, while the words where it stood say "The chicken is fine." (and
   the second time, "The chicken is still fine."). Hit it three times in one
   game: **Chicken of Steel**.
4. **The water tower** (Spring a Leak). A shot springs a leak — a stream of
   water that splashes in the dust for the rest of the game.
5. **The piano** (Honky-Tonk). Shoot the piano through the saloon window: a
   honky-tonk chord. Play three notes and it plays a few bars of a tune.
6. **Tumbleweeds** (Giant Tumbleweed). Shoot five in one game and a *giant*
   tumbleweed rolls through the next breather.
7. **The wanted poster** (Wanted: The Hand). The sheriff's board has a poster
   of a finger-gun hand: "WANTED — THE HAND. $5,000". Shoot it and it
   flutters down.
8. **High noon, for real** (High Noon). Play when your clock reads between
   12:00 and 12:05: the sun stands overhead, shadows vanish under the eaves,
   and the first wave opens with a duel — one bandit, a ten-pace standoff,
   and a bell. Shot as the bell tolls, he is a Quick Draw; shot before it, on
   his paces, he goes down all the same, and the hint line says it was "Not
   very sporting."

Also: typing the Konami code on the landing or in the arcade unlocks the
**Golden Revolver** (a gold cylinder in the HUD and golden muzzle flashes) for
the visit.

## Feel

- Immediate, weighty feedback: a hit marker that pops, a dull thud or a sharp
  crack on a headshot, dust puffs and splinters where shots land, bullet holes
  that stay, glass that shatters, hats that fly off.
- Sound carries the world: wind, a distant dog, spurs on boardwalks, shutters,
  creaking signs, the bell. Gunshots echo down the street.
- 60 fps on a MacBook, with the hand tracker running alongside.
