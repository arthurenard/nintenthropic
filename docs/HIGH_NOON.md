# High Noon — game design

The flagship of the web-native Handy. A realistic western gunfight you play with
a finger pistol: bandits take cover in a sun-baked town, lean out, aim and fire
back, and you survive wave after wave. It must look and feel like something
Apple would put on stage — see [DESIGN.md](DESIGN.md) for the interface, and
this document for the game.

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
- **Revolver:** six rounds. A six-chamber cylinder in the HUD shows what's left.
  **Reload by pointing off the screen** (the arcade classic — the crosshair leaves
  the view for a moment) or by pressing R; it takes 0.9 s with a cylinder spin.
  Firing on empty clicks and shows the reload hint.
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
  to the dust. A tombstone card: "Here lies a fast hand. Fell on Wave 4." Then
  the results card.

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
  three covers, and his gang fires cover for him.

**Hits:** a headshot always kills. A body shot kills an ordinary bandit; armoured
ones (wave 6+, a visible iron plate) need two. Hit reactions and deaths are
physical: they twist with the hit, drop the gun, fall out of windows, tumble off
roofs, slump over barrels.

## Townsfolk

Now and then an innocent appears — the barber in his doorway, a woman on the
hotel balcony, the bartender at the saloon doors, the undertaker measuring the
street. Shooting one costs 200 points and the wave's **Clean Hands** bonus.
They are visibly different: no guns, pale clothes, hands up when bullets fly.

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

## Scoring

- Kill 100, headshot +50, **Quick Draw** +100 (kill within 0.5 s of a bandit
  emerging), runner +50, dynamite in the air +150.
- Streak multiplier ×1 → ×4 on consecutive hits; a miss resets it.
- End of wave: accuracy bonus, **Untouchable** (no damage taken) +500, **Clean
  Hands** (no townsfolk hit) +250.
- The results card: waves survived, kills, headshots, accuracy, best streak,
  score, New Best, secrets found.

## Secrets (easter eggs)

Delightful, discoverable, never in the way. The results card counts "Secrets
2 / 8".

1. **The bell.** Shoot the church bell: it tolls. Toll it three times in a row
   and the church doors creak open — the preacher peers out and shakes his head.
2. **The weather vane.** Shoot it and it spins wildly, then creaks to a stop
   pointing at you.
3. **The chicken.** A chicken pecks along the boardwalk. Shoot near it: a burst
   of feathers, an outraged cluck, and it runs off unharmed. Hit it three times
   in one game: **Chicken of Steel**.
4. **The water tower.** A shot springs a leak — a stream of water that splashes
   in the dust for the rest of the game.
5. **The piano.** Shoot the piano through the saloon window: a honky-tonk chord.
   Play three notes and it plays a few bars of a tune.
6. **Tumbleweeds.** Shoot five in one game and a *giant* tumbleweed rolls
   through the next breather.
7. **The wanted poster.** The sheriff's board has a poster of a finger-gun hand:
   "WANTED — THE HAND. $5,000". Shoot it and it flutters down.
8. **High noon, for real.** Play when your clock reads between 12:00 and 12:05:
   the sun stands overhead, shadows vanish under the eaves, and the first wave
   opens with a duel — one bandit, a ten-pace standoff, and a bell.

Also: typing the Konami code on the title screen unlocks the **Golden Revolver**
(a gold cylinder in the HUD and golden muzzle flashes) for the session.

## Feel

- Immediate, weighty feedback: a hit marker that pops, a dull thud or a sharp
  crack on a headshot, dust puffs and splinters where shots land, bullet holes
  that stay, glass that shatters, hats that fly off.
- Sound carries the world: wind, a distant dog, spurs on boardwalks, shutters,
  creaking signs, the bell. Gunshots echo down the street.
- 60 fps on a MacBook, with the hand tracker running alongside.
