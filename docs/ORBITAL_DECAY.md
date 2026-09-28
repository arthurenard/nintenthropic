# Orbital Decay — game design

The third game of the web-native Handy. Four hundred kilometres up, in the
glass cupola of a space station, as a cloud of wreckage from a satellite
collision crosses your orbit. You have the station's point-defence laser and
seven windows between you and the vacuum. It must look and feel like something
Apple would put on stage — see [DESIGN.md](DESIGN.md) for the interface and
[HIGH_NOON.md](HIGH_NOON.md) for the conventions every game shares (the aim
check, Relaxed and Standard, one-time tips, the results note, secrets).

## The fantasy in one line

The most beautiful view there is — a blue planet turning below you, the sun
coming up over its edge — and it is full of shrapnel coming straight at the
glass. Out there, nothing makes a sound.

## The place: the cupola of Station Meridian

- **The window.** You float in a cupola like the one on the real space
  station: a **round centre window** straight ahead and **six trapezoid
  windows** around it, in a machined aluminium frame with bolts, handrails,
  a laptop on an arm, a few floating things tethered with velcro, and soft
  interior light. The frame is the chrome the world is seen through; it is
  close, detailed, and lit from inside (cool white LEDs) and from outside (the
  sun through the glass).
- **Outside.** The planet fills the lower two thirds of the view: oceans with
  the sun's glint, continents, cloud decks casting shadows, the day/night
  terminator sweeping slowly across as the station moves, city lights on the
  night side, and the thin blue line of the atmosphere at the limb. Around the
  window's edges: the station — a white truss, solar arrays catching the sun, a
  radiator, the robotic arm, a docked capsule — all at 10–40 m. Stars only when
  the sun is behind the planet.
- **Light.** One harsh key light (the sun: no atmosphere to soften it), blue
  earthshine from below as fill, deep black shadows. Metal, gold foil
  insulation, white thermal blankets, solar cells. This is realism in the NASA
  photograph sense.
- **Materials:** the planet is **our own making** — its continents, oceans,
  clouds and city lights are generated in Blender (procedural noise, domain-
  warped, not Earth's actual geography, but unmistakably a living, Earth-like
  world), baked to textures; the game draws it with a runtime atmosphere
  shader (scattering at the limb, the terminator's orange band, the ocean's
  specular glint).

## The player

- **Floating**, eyes at the cupola's centre, looking out and slightly down at
  the planet. No breathing sway — a slow zero-g drift of a few centimetres
  instead, and a jolt when something strikes the hull.
- **The laser.** The station's point-defence laser, aimed through the glass.
  It never runs out: every shot adds **heat** (the page shows a heat gauge);
  a burst fills it quickly, and at 100% it **overheats** — locked for 2.5 s.
  **Point off the screen to vent** it at once (the same gesture as reloading
  in the other games; a lost hand swung out of the picture counts; V on the
  keyboard). Firing draws a thin bright beam from the station's emitter (on
  the truss, below the window) to the target — visible, instant, silent
  outside.
- **Recoil:** none (it's light); a short shimmer of the beam and a tick in the
  heat gauge.

## Health: the seven panes

- There is no player health. There are **seven panes**, each with integrity
  100, shown in the corner panel as seven small segments (the cupola's layout
  in miniature), and on the glass itself: a strike leaves a chip, then cracks,
  then a spider web that catches the sunlight.
- A fragment that reaches the glass costs integrity **in proportion to its
  mass and speed**, on the pane it strikes: shrapnel 8, chunks 20, slabs 45,
  the satellite everything on two panes.
- **A pane at zero fails** and the game is over: the glass bursts outward in a
  glitter of shards, the air goes with it (a roar, then silence), the cupola's
  shutters slam, and a card: "The pane failed on Pass 4." Then the results.
- **The repair drone** (below) mends the most damaged pane while it works, 6
  integrity a second; each breather the crew seals chips (+15 to every pane
  under 100). Low integrity on any pane (< 35) sounds the station's master
  alarm (a soft, insistent two-tone, not a siren) and tints that pane's
  segment red.

## The debris

Fragments come from the depth of the view (60–120 m out) on gently curving
arcs; the ones that will hit the glass grow toward a pane, the ones that will
miss drift across and past (shooting them still scores). Each is a real
object tumbling under the sun: it flashes when a facet catches the light.

- **Shrapnel** — fist-sized scraps, fast (18–30 m/s). One shot vaporises one.
- **Chunks** — pieces of hull the size of a suitcase, 10–18 m/s. A hit **splits**
  a chunk into two or three shrapnel that **keep its momentum** — so a careless
  shot turns one problem into three.
- **Slabs** — a torn panel the size of a door, 6–12 m/s. Splits into chunks.
- **Solar panel shards** (pass 3+) — thin, tumbling: nearly invisible edge-on,
  huge face-on, flashing blue when they face the sun. Shoot them face-on.
- **Foil-wrapped pieces** (pass 4+) — gold insulation around a dense core:
  the first hit strips the foil, the second splits.
- **The Derelict** (pass 5, then every fifth pass) — a dead satellite the size
  of a car, tumbling end over end toward the station. Its body shrugs off the
  laser; its **fuel tank** (a white sphere, venting a thin plume when hit)
  shows as it tumbles. Three hits on the tank and it ruptures, and the whole
  satellite comes apart into a spray of chunks the player must then clear.
  If it arrives, it takes two panes.

**Tells.** A fragment coming at the glass gets a faint **proximity glow**
(the window's heads-up display outlines it in a soft ring and shows its
closing seconds) once it is within 5 s of impact — the Orbital Decay glint.
Things that will miss get no ring.

## The drone

A small white maintenance drone with cold-gas thrusters floats outside,
working. It flies to the most damaged pane and mends it, with a little blue
welding glow. **It is not debris.** Shooting it costs 300 and knocks it
spinning away for 12 s (no repairs). It has the station's running lights and
never looks like a fragment.

## Passes

The station goes round the planet once every 90 minutes; each round is a
**pass** through the debris field.

| Pass | Debris | New |
| --- | --- | --- |
| 1 | 10, shrapnel and chunks | Learn the view |
| 2 | 14 | Slabs |
| 3 | 18 | Solar panel shards; the drone starts working |
| 4 | 22 | Foil-wrapped pieces |
| 5 | The Derelict + 16 | Boss |
| 6+ | +4 each | Faster, more at once, more slabs |

A pass ends when its debris is gone (vaporised, or drifted past). Then a
**breather** (8 s): the station crosses into the planet's shadow — the sun
sets over the limb in a band of orange and blue, the night side's cities light
up, a storm flickers with lightning under the clouds, maybe an aurora — the
crew seals chips, the title card slides in ("Pass 3"), and the sun rises
again. No clock: you last until a pane fails.

## Scoring

- Vaporise 80; split 40; far bonus ×2 at spawn depth down to ×1 at 20 m; the
  Derelict's tank 200 a hit and 1500 for breaking it up.
- Streak multiplier ×1 → ×4 on consecutive hits; a miss resets it.
- End of pass: accuracy bonus; **Not a Scratch** (no pane damage) +500;
  **Good Neighbour** (the drone never hit) +250.

## Difficulty

Relaxed and Standard, one table in `tuning.ts`. Relaxed: debris ~25% slower,
strikes cost ~30% less integrity, the proximity ring appears at 7 s instead of
5, heat builds more slowly, the drone mends faster. Records apart.

## One-time tips (Settings.tipsSeen)

`orbit.split` — the first chunk split by a shot: "Big pieces split. Clear the
pieces too." · `orbit.ring` — the first proximity ring: "A ring means it's
coming at the glass." · `orbit.drone` — when the drone first flies out: "The
drone mends the glass. Don't shoot it." · `orbit.heat` — the first overheat,
or the start until the player has vented by themselves: "Point off the screen
to vent the laser." · `orbit.derelict` — the Derelict: "Hit its fuel tank."

## The results note

What broke the glass and what would help: "A chunk on the upper-left pane.
Chunks split into pieces — clear the pieces before they arrive." · "The
Derelict. Its fuel tank shows as it tumbles; three hits break it up." · "A
pane worn down over time. Keep the drone working: don't shoot it."

## Secrets (easter eggs)

"Secrets 2 of 8" on the results.

1. **The astronaut.** On pass 2, a spacewalker drifts along the truss on a
   tether. Shoot near (not at) them: they turn and give you a slow thumbs-down.
   Shoot them and — they were never there; a sticker of one on the truss.
2. **The lost tool bag.** A white tool bag tumbles past once, forever lost.
   Shoot it: "Lost and Found" — it bursts into floating tools.
3. **The duck.** A yellow rubber duck drifts through the debris field. Shoot
   it: it spins away, and the popup reads "In space, no one can hear you
   squeak." (Every game hides one duck.)
4. **The arm.** Shoot the robotic arm's hand: it waves.
5. **The capsule.** A crew member peers out of the docked capsule's window.
   Shoot near the capsule: they pull down the shade.
6. **The storm.** Shoot three lightning flashes in the night-side storm in one
   breather: an aurora ripples over the limb for the rest of the game.
7. **The Moon.** When the Moon rises over the limb (pass 4), shoot it: a tiny
   flag glints on it for a moment.
8. **The message.** On the night side, a city's lights spell a faint "HI" —
   shoot it and it blinks back "HI" twice.

Konami on the arcade: a golden laser and a gold heat gauge.

## The aim check

**Nine running lights** — the station's red, green and white navigation
beacons on the truss, the arrays, the radiator and the capsule, placed to
cover the screen's corners, edges and centre. The lit one blinks brighter; a
hit turns it steady green with a soft ring. The laser fires through the check
(no heat). Framing: the cupola's own view; play keeps it (no zoom — the
windows are the frame).

## Feel and sound

- **Nothing outside makes a sound.** You hear the inside: the station's fans
  and pumps (a low, clean hum), the laser's capacitor whine and thump through
  the mount, the heat gauge's tick, radio blips, the soft two-tone alarm. You
  hear the hull: a strike on the glass is a sharp crack, loud, close; a strike
  on the station a dull boom through the structure. A debris hit outside is a
  silent flash of vaporised metal and a spray of glittering sparks.
- The sun's glare blooms; the planet's night side is deep and calm.
- 60 fps on a MacBook with the tracker running.

## Asset contract

Y-up, metres, the player's eye at the origin, looking along −Z and down ~20°
toward the planet. Everything made by `art/orbit/` Blender scripts; nothing
downloaded.

### `public/assets/orbit/cupola.glb` — the window

- The cupola interior and frame: static, **baked** as High Noon's town (Cycles
  into unlit atlases; interior LEDs plus the sun through the windows), since
  the eye never moves.
- **Named nodes:** `camera.player`; `sun` (an empty whose −Z points along the
  sunlight, for everything lit at runtime); `pane.center`, `pane.1`…`pane.6`
  (each window's glass as its own mesh, with extras `{ pane: 0..6 }`, UVs
  across the glass for the cracks the game draws); `hud.anchor` (where the
  window's heads-up rings project); a few `float.<n>` (floating objects on
  tethers the game can bob).
- **Budget:** ≤ 6 MB.

### `public/assets/orbit/station.glb` — outside

- The station's exterior around the window (truss, arrays, radiator, the arm
  with a pivoting hand `secret.arm.hand`, the docked capsule with
  `secret.capsule.window` and a shade), **PBR, lit at runtime** by the sun and
  earthshine (they must respond to the sun as it moves and to the laser's
  glow); detailed textures baked from Blender procedural materials (foil,
  white blankets, solar cells, bare aluminium).
- **Named nodes:** `emitter` (the laser's muzzle), `calib.1-9` (the running
  lights), `drone.dock` and `drone.path.<n>`, `astronaut.path.<n>`,
  `secret.duck.path.<n>`, `spawn.<n>` (where debris lanes begin, far out).
- **Budget:** ≤ 10 MB.

### `public/assets/orbit/planet/*` — the planet

- `albedo.webp` (land and ocean colour, equirect, 4096×2048), `clouds.webp`
  (cloud cover, animated by the game at runtime), `night.webp` (city lights),
  `water.webp` (an ocean mask for the specular glint), optionally `height.webp`
  for a subtle relief. Procedurally generated in Blender. The game renders the
  sphere, the clouds' shadows and the atmosphere.
- `stars.webp` — a star field (with a faint Milky Way band), for the night side.

### Debris and characters: `debris.glb`, `drone.glb`, `derelict.glb`, `extras.glb`

- `debris.glb`: several variants of each kind — `shrapnel.<n>`, `chunk.<n>`,
  `slab.<n>`, `shard.<n>` (solar panel), `foil.<n>` (gold foil wrap over a
  core `foil.<n>.core`) — with **pre-fractured pieces** for the splits
  (`chunk.<n>.piece.<m>` arranged to reassemble the chunk), PBR materials that
  catch a harsh sun.
- `drone.glb`: the drone with `thruster.<n>` nozzles, `light.nav`, a welder
  arm with `weld.tip`.
- `derelict.glb`: the satellite, `tank` (the shootable fuel tank), `panel.<n>`
  (its solar wings), pieces for the break-up.
- `extras.glb`: `astronaut` (a spacewalker, simple rig or rigid parts with a
  pivoting arm for the thumbs-down), `toolbag`, `duck`, `sticker`.
- **Budget:** each ≤ 3 MB.

### `public/assets/orbit/poster.webp`

The cupola's windows, the planet at sunrise, a fragment glinting in the sun.

### As delivered by the art pass (details in `art/orbit/README.md`)

Nothing above is renamed or dropped; these are the conventions the
contract left open, and a few additions.

- **Frame and light.** Vertical field of view 62° (`camera.player` extras
  `fov_deg`), pitch 20°, altitude 420 km, the limb about 11° above the view's
  centre with a 4° roll. A node **`planet`** (in `cupola.glb` and
  `station.glb`) sits at the planet's centre with its axes (glTF +Y north,
  +X longitude 0): a `SphereGeometry` child with default UVs shows the maps
  right; its extras carry the radius, altitude, cloud height, the "HI"
  (lon −112°, lat 47°), the storm and the hurricanes. Sun irradiance 20,
  exposure −3.2 stops, AgX: the baked cupola is display colour (draw it
  unlit, not tone-mapped).
- **Panes.** 1 upper-left, 2 upper-right, 3 right, 4 lower-right,
  5 lower-left, 6 left (clockwise from the upper-left), 0 the centre.
  UVs planar with square texels, (0.5, 0.5) at the pane's centre.
- **Planet.** `height.webp` is delivered, and an optional tileable
  `planet/detail.webp` breaks the clouds into crisp cloudlets below the
  maps' ~10 km a pixel (recipe in the README).
- **Debris.** Wholes at the origin (origin at the centre of mass, extras
  `kind`, `mass_kg`, `size_m`). Pieces live in a sibling group
  `chunk.<n>.pieces` (likewise `slab.<n>.pieces`, `foil.<n>.pieces`) whose
  transform is the whole's: clone it onto the whole to reassemble.
  `foil.<n>` is a group of `foil.<n>.wrap` (hide to strip) and
  `foil.<n>.core`.
- **Added nodes.** `drone.work.<pane>` (where the drone hovers to mend
  each pane), `secret.capsule.shade`, `derelict.pieces`, `toolbag.bag` and
  `toolbag.tool.<n>`, the astronaut's arm chain (`astronaut.arm.R` →
  `astronaut.forearm.R` → `astronaut.hand.R`), the drone's `arm.shoulder` →
  `arm.elbow` → `weld.tip`.
