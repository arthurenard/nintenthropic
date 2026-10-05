# Grip Prix

A kart racer for up to four people, steered with your hands. Hold your fists
up as if they gripped a wheel, and turn it: the kart follows the angle of the
line between your hands. Open your hands to brake, and keep them open to
back up. Every player brings their own camera — a laptop, a phone propped on
the table — and the race is shown on each player's screen, or all together on
one big screen in split screen, or both.

It is Handy's second kind of game. The four shooting games aim a finger
pistol; Grip Prix holds a wheel. It lives on its own page, `race.html`, and
the arcade lists it under its own heading, Racing.

Nothing here is borrowed. The karts, drivers, items, tracks and names are
Grip Prix's own (no plumbers, no shells, no question-mark boxes).

## How it plays

- **Drive.** Both fists closed: the kart accelerates by itself. Turn the
  wheel: the angle between the line through your hands and the horizon
  steers. ±4° does nothing (a straight line stays straight); 40° is full
  lock (Settings: Steering, Gentle 50° / Normal 40° / Quick 30°), on a curve
  that is gentle near the centre.
- **Brake and back up.** Open both hands: brake. Keep them open at a
  standstill and the kart reverses. You still steer while reversing — open
  hands are tracked as well as fists.
- **Hop and drift.** Lift the wheel sharply (both hands jerk up) while
  turning: the kart hops into a drift that way. Sparks grow blue, then
  orange; straighten the wheel to let go, and the kart boosts — longer for
  orange. A hop going straight is only a hop.
- **Items.** Drive through an item box for an item. Flick one hand open and
  closed again (under 0.6 s, the other hand staying a fist) to use it. Both
  hands opening together is a brake, never an item.
- **Start boost.** During the countdown, open your hands; close them on "1".
  Too early and the engine floods for a moment.
- **Hands gone.** One hand lost: the wheel holds its angle for 0.4 s, then
  eases to the centre. Both lost: the kart coasts, and the screen says "Show
  Both Hands".
- **Keyboard and gamepad** drive too (testing, accessibility): arrows or
  WASD, Space to drift, E or Shift for the item; a gamepad's left stick,
  triggers, A to drift, B or X for the item.

### Items

| Item | What it does |
| --- | --- |
| Nitro | A burst of speed, now. |
| Triple Nitro | Three bursts, one per use. |
| Puck | Fired straight ahead; bounces off the barriers; spins out what it hits (you too, after half a second). |
| Seeker | A puck that follows the track to the kart one place ahead. |
| Slick | A puddle of oil dropped behind you. Whoever drives through it spins. |

The roulette takes about a second. What you get depends on your place: the
leader gets Slicks and Pucks, the back of the pack Nitros and Seekers.

### A race

Three laps by default (the room may choose 1-5). Up to eight karts: the
players, and bots filling the grid when the room wants them (on by default,
six karts in all). Countdown 3-2-1-Go; the race ends when every player has
finished, or 25 s after the first player finished — the rest are placed by
how far round they got. A finished player's kart drives itself on. A player
who leaves mid-race is replaced by a bot.

## Where people play

A **room** has up to four players across any number of devices. One device
**hosts**: it runs the race. The others **join** with a four-letter code —
typed, or by scanning the QR code on the host's screen, which opens
`race.html?join=CODE`.

- **Each player's screen.** By default a player's race is shown on their own
  device: friends in different rooms, or on laptops side by side.
- **The big screen.** A player can choose "Show Me on the Big Screen"
  instead: the host's screen shows them, split screen with everyone else who
  chose it, and their own device is only their wheel (the camera picture with
  the wheel drawn on it, their place and lap).
- **Two on one camera.** A device can bring two players sharing one camera:
  the picture is split down the middle, left half the first player's wheel,
  right half the second's.
- **Practice** is a room with no one else, and never touches the network.

The camera picture never leaves the device. What goes over the network is
each player's steering, a few bytes sixty times a second, and the race as the
host runs it.

## Parts and owners

Everything is under `src/kart/`. Each part is built against
`src/kart/contract.ts` and nothing else of another part's.

| Part | Folder | Gives |
| --- | --- | --- |
| Contract | `contract.ts` | The shared types: `DriveInput`, `Race`, `RaceView`, `RaceRenderer`, `DriverControl`, `WheelStatus`, `Session`, the lobby. |
| Track | `track/` | `TrackDef` (data) and `TrackGeometry` (the centre line sampled every metre: `at`, `point`, `project`, `heading`, `wrap`, `delta`); the tracks in `tracks.ts`. |
| Sim | `sim/` | `createRace(setup): Race`: kart physics, drift, items, laps and places, bots. Pure TypeScript: no DOM, no three.js. |
| Net | `net/` | `hostSession`, `joinSession`, `soloSession` → `Session`; transports (PeerJS WebRTC, BroadcastChannel, in-memory). |
| Input | `input/` + `src/tracking/` | `wheelControl(...)`, `keyboardControl()`, `gamepadControl()` → `DriverControl`; the wheel's picture (`WheelPreview`); every hand the tracker sees. |
| Render | `render/` | `createRaceRenderer(canvas, hudRoot, options): RaceRenderer`: the world, the karts, split screen, chase cameras, effects, each viewport's HUD, the minimap. |
| App | `app/`, `main.ts`, `/race.html` | The screens: start, you, the wheel check, lobby, race, results; the arcade's Racing heading. |
| Sound | `src/audio/cues/` pack `kart` | Engines, drift, boosts, items, countdown — synthesised like every Handy sound. |

### Coordinates

Metres, y up; the race runs on the x-z plane, y is only the road's height for
the picture. A kart's `heading` is its rotation about +y: it faces
`(sin h, cos h)` in (x, z) — three.js's `rotation.y = heading` for a model
built facing +z — and its right is `(-cos h, sin h)`. Steering right (+1)
turns the heading down. Along the track, `s` is metres from the start line
and `offset` metres to the right of the centre line.

## Sim (`src/kart/sim/`)

Fixed step, `TICK = 1/60 s`. Every random choice from a seeded generator
(`mulberry32(setup.seed)`), never `Math.random`, and no iteration over
unordered things: the same setup and inputs replay the same race on the same
device. Devices need not agree bit for bit — the host's race is the truth and
guests only predict their own karts between its snapshots.

Starting numbers (tune by driving; keep them in one `tuning.ts`):

- **Speed.** Top 24 m/s on the road, ~90% of it in 3 s. Off the road (more
  than half the width from the centre) top speed falls to 11 m/s with drag.
  A barrier stands 6 m beyond each edge: hitting it kills the speed into it,
  loses 30% of the rest, and makes a `wall` event.
- **Turning.** Yaw rate up to ~2.2 rad/s, rising with speed from nothing at a
  standstill to full by 6 m/s, a little less at top speed. Grip pulls the
  velocity toward the heading quickly (a slight slide, never ice).
- **Brake.** 30 m/s²; held at a standstill for 0.3 s it reverses, up to 7 m/s.
- **Hop and drift.** `drift` rising at over 10 m/s with |steer| > 0.3 hops
  (0.25 s, up to 0.35 m) into a drift that way: the steer is remapped so the
  kart always turns into the drift (0.4..1.4 of full turn), grip is lower,
  and charge builds faster the tighter it turns: level 1 at 1.0 s, level 2 at
  2.2 s. `drift` falling (or a brake) ends it: level 1 boosts 0.7 s, level 2
  1.4 s. Off the road the charge does not build.
- **Boost.** Top speed +35% and strong acceleration while it lasts. Nitro
  1.5 s, a pad 1.0 s, a start boost 1.0 s.
- **Start.** The countdown is 3 s plus half a second of "ready". Throttle
  rising from 0 to 1 in the last 0.6 s before Go gives the start boost;
  throttle held since before 1.2 s floods the engine (no drive for 0.6 s
  after Go). Bots get a start boost by skill.
- **Karts touch.** Circles of radius 1.1 m push apart, the faster one
  shoving harder; a `bump` event.
- **Item boxes.** A row of five across the road at each of the track's
  `itemRows`; a box taken comes back after 3 s. Roulette 1.0 s. Odds by place
  (above). Puck: 40 m/s, 6 s, bounces off barriers, hits within 1.4 m.
  Seeker: 36 m/s along the centre line toward the kart one place ahead,
  homing within 30 m. Slick: dropped 2.5 m behind, stays until driven through
  (at most 12 on the track; the oldest goes). A hit spins the kart 1.2 s,
  cuts its speed to a fifth, and ends its drift.
- **Laps and places.** Progress = lap × length + s. A lap counts only when
  the kart crossed the line forward having been past the halfway point — no
  cutting back across the line. Places by progress (finished karts by finish
  time). Wrong way: facing more than 110° from the track's direction at
  speed for 1.5 s.
- **Bots.** Follow a racing line (inside of each bend by its curvature, plus
  a lane of their own), slow before a bend to `sqrt(a / |curvature|)` with a
  lookahead, drift long bends, use items sensibly (Nitro on a straight, Puck
  with a kart ahead in line, Slick when someone is close behind). `skill`
  0..1 scales top speed (0.92..1.0), reactions and mistakes. Gentle rubber
  band: a bot far ahead of the best player eases off a few percent, one far
  behind pushes a few percent.
- **The race's end** as in "A race" above. `result()` gives the standings.

`snapshot()` is plain JSON and small (round numbers to millimetres and
milliradians; under 3 KB for eight karts). `predict(karts, inputs)` steps
only those karts' physics against the world as it is.

## Net (`src/kart/net/`)

- **Transport.** One interface, three makers: PeerJS (WebRTC data channels;
  the default), BroadcastChannel (`?net=local`: several tabs of one browser,
  for development and the end-to-end tests), and an in-memory pair with
  latency, jitter and loss for unit tests. Each peer link has a reliable
  ordered channel (lobby, start, events, results) and an unreliable unordered
  one (inputs, snapshots).
- **Signalling.** PeerJS's public broker by default, configurable with
  `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_KEY` to
  run one's own; STUN `stun:stun.l.google.com:19302`, no TURN. Players on the
  same Wi-Fi always connect; across the internet most do. The broker sees
  only that two browsers want to talk.
- **Room codes.** Four letters from `ABCDEFGHJKLMNPQRSTUVWXYZ`; the host's
  peer id is `grip-prix-v1-<CODE>`. A code in use is drawn again.
- **The host** runs the race on the fixed tick from accumulated time (never
  more than 5 ticks in one frame). Each tick each kart takes one input:
  this device's controls are sampled directly; a guest's come numbered
  (`seq`), each packet carrying its last six, and are taken one per tick in
  order, the last held when none has come, the queue cut to the newest two
  when more than four wait. Snapshots go to every guest 30 times a second,
  with each guest's last applied `seq` per kart; events go reliably, batched.
- **A guest** keeps its own `Race`, built from the setup the host sent at the
  start. Others' karts are drawn about 70 ms behind the newest snapshot,
  between two snapshots. Its own karts are predicted: on each snapshot,
  `restore` it, replay the inputs the host has not yet applied with
  `predict`, and ease any visible jump out over 100 ms. Ping every second; the
  round trip shows in `link.rtt`.
- **Who leaves.** The host leaving ends the room for everyone ("The host left
  the race."). A guest leaving: their karts become bots for the rest of the
  race and their slots free up in the lobby. A fifth player is turned away
  ("This race is full.").
- **Solo.** `soloSession` is the host without a transport.

## Input (`src/kart/input/`, `src/tracking/`)

- **Every hand.** `HandFrame` gains `hands`: every hand seen, each with its
  image landmarks, its world landmarks (MediaPipe's metric 3D points, which
  tell a fist from an open hand whichever way it faces the camera),
  handedness and score. `landmarks` stays the first hand's, so the shooting
  games are unchanged; they keep looking for one hand. Grip Prix asks the
  tracker for two (four for two on one camera).
- **The wheel.** Palm centre = mean of landmarks 0, 5, 9, 13, 17, mirrored
  (as the player sees themself). The two hands are told apart by side, then
  kept by continuity (each frame's nearest to the last), so a wheel turned
  past 90° does not swap them. Angle = `atan2(dy, dx)` from the left palm to
  the right, + when the right hand is lower (turning right). A One Euro filter
  smooths it with little lag. The level (an offset) is set by holding the
  wheel level for a second.
- **Fist or open.** From the world landmarks: a finger is out when its tip is
  much farther from the wrist than its middle joint; three or four fingers
  out is open, one or none a fist, with 120 ms of hold either way.
- **Gestures** as in "How it plays": both open for 150 ms → brake; one open
  then closed within 0.6 s with the other a fist all along → one item press;
  the wheel's centre rising faster than 1.6 hand-spans a second (the distance
  between the palms) by at least a quarter span → hop; drift held from the
  hop until |steer| < 0.15 for 200 ms or a brake.
- **`WheelPreview`.** A canvas that draws the mirrored camera picture with
  the wheel on it: a ring through both palms turned with them, its colour the
  mode (green driving, amber braking, red lost), each hand a dot that is
  filled for a fist and hollow when open. Small in a corner during the race,
  large on the wheel check and on a big-screen player's own device.
- **The dev page** `src/kart/input/dev.html`: the camera, the preview, and the
  numbers (angle, steer, grip, mode, drift, item presses, frame rate), with
  the Steering setting. The first thing to try with real hands.

## Render (`src/kart/render/`)

Bright, clean, low-poly toys in strong sunlight: flat-shaded karts, soft
gradients, saturated but not garish. Built in code (no downloaded art yet);
each model behind a small factory, so a Blender-made glTF can replace it.

- **The world** from `TrackGeometry`: the road ribbon (with the height),
  kerbs striped on the outside of tight bends, a chequered start line under
  a gantry, the verge, the ground beyond (grass, sand, quay by theme), the
  barriers 6 m beyond each edge (tyre walls, fences, bollards by theme),
  boost pads (animated chevrons), item boxes (turning translucent cubes with a
  glowing emblem), scenery instanced well clear of the road (trees, rocks,
  cacti, lamps, cranes by theme), a sky dome and fog.
- **Karts.** Chassis, four wheels turning with the speed and the front two
  with the steer, the driver in a round helmet in the kart's colour leaning
  into turns; body roll and pitch from the motion; a blob shadow. Effects:
  drift sparks (blue, then orange), boost flames, dust off the road, a spin,
  a hop, a puff on a bump.
- **Things.** The puck, the seeker (with a red glow and a fin), the slick (a
  glossy dark puddle).
- **Split screen.** One kart: the whole canvas. Two: top and bottom on a wide
  screen, side by side on a tall one. Three or four: quadrants; with three,
  the fourth shows the map and the standings. One renderer, one scene, a
  scissored viewport and chase camera per view.
- **Chase camera.** Behind and above, eased; the field of view widens with
  speed and boost; through the countdown it settles from high over the grid.
- **Each viewport's HUD** (HTML over the canvas, DESIGN.md's glass and type):
  place large ("1st", "2nd"…) bottom-right, lap ("Lap 2/3") and time
  top-left, the item in a glass slot top-centre (turning through the items
  while it rolls), "Final Lap", "Wrong Way", the countdown in the centre, the
  place on finishing. A minimap (the track's outline, a dot per kart, players
  ringed) bottom-left when there is one view, in the free quadrant with three.
- **Fast.** 60 fps with four viewports on a MacBook with tracking running:
  the engine's quality tiers and dynamic resolution, instanced scenery, no
  real-time shadows beyond one cheap map near the karts.
- **The dev page** `src/kart/render/dev.html`: the track and eight karts
  driven by the real sim (bots), the keyboard driving kart 0, `?views=1..4`.

## App (`race.html`, `src/kart/app/`, `src/kart/main.ts`)

Screens, in DESIGN.md's voice and style:

1. **Start.** Grip Prix's title over its world; Host a Race, Join a Race,
   Practice; back to the arcade.
2. **You.** Your name (a friendly default), how you drive (Wheel, Keyboard,
   Gamepad), Two on This Camera. Remembered.
3. **The wheel check** (wheel players): "Hold your fists up, like a wheel" →
   "Hold it level" (the level is set) → "Turn it" → "Open your hands to
   brake" → ready. After the first time, only "Hold it level".
4. **Lobby.** The host: the code large, the QR code, the players (colour,
   name, ready), the track, laps and bots, Start. A guest: the code, the
   players, "Waiting for <host> to start", Show Me On: This Screen / Big
   Screen.
5. **Race.** The canvas, each viewport's HUD, the wheel's picture in a
   corner for every wheel player on this device. Escape or the pause button:
   a sheet with Leave Race (the host's also Restart).
6. **Results.** The standings, times and best laps; Race Again (the host),
   Back to Lobby.

Troubles say what happened and what to do: "There's no race with that code.
Check it and try again.", "This race is full.", "The host left the race.",
"Lost the connection to the race." — each with the way back as a button.

The arcade (`index.html`) gains a heading per kind of game: **Shooting**
(the four) and **Racing** (Grip Prix). A `GameEntry` may say `page:
"race.html"`; its Play opens that page.

## Tests

- Unit (Vitest): the geometry; the sim (a bot laps every track in a sane time
  and never leaves it, braking reverses, a drift charges and boosts, items
  hit, places and laps count, the race ends, `snapshot`/`restore` round-trips,
  the same seed replays); the net (lobby joins and leaves, a full room, inputs
  in order under loss, prediction converging, the host leaving); the wheel
  (angles, the level, fists and open hands from recorded landmarks, every
  gesture, hands lost).
- End to end (Playwright, `?net=local`, muted): a host and two guests in tabs
  of one browser join by code, drive by keyboard and finish a one-lap race;
  practice against bots; the arcade's Racing heading opens the page.

## The couch: four friends, one big screen

The Mario Kart evening is the one to get exactly right: a TV, four people on
a sofa, split screen. Here each friend's wheel is their phone, propped up in
front of them (or a laptop), and the TV is the host's screen.

- The host's lobby says where the race shows: **On Everyone's Own Screen**
  or **On This Screen** (split screen; every player's device becomes only
  their wheel: the camera picture with the wheel drawn on it, their place,
  lap and item, big). A player can still change their own.
- Phones need a secure page for the camera. `npm run party` serves the game
  over HTTPS on the local network (a self-signed certificate: the phone asks
  once to trust it) and the QR code in the lobby points at the computer's
  address on the network, never at `127.0.0.1`.
- Once the host starts, everything happens on the big screen: countdown,
  race, results, the next race. Phones only need attention to join.

## Track features

`TrackDef` (track/geometry.ts) says, beyond the road itself:

- **Ramps** (`ramps`): a ramp across the road; fast enough over its lip and
  the kart flies (about a second). The hop gesture (or Space) in the air is a
  **trick**: the driver spins, and the kart boosts on landing (0.8 s). The
  picture draws a 16 m wedge, 2.4 m high, ending at the lip; the sim's `hop`
  is 0 up the wedge and at the lip. Jumps can cross a gap: a `drops` entry
  with `gap: true` and side `both`, starting just past the lip — a kart that
  lands short falls.
- **Drops** (`drops`): edges with no barrier. Over the edge (or into lava,
  a sink, space) the kart **falls**, and a **rescue drone** (a little
  propeller drone with a hook, Grip Prix's own) lifts it back to the road a
  little behind, facing the right way: about 2.5 s lost, no item lost.
  Throughout the rescue the kart's x/y/z stay where it fell (the picture
  flies the drone from there); then it is set down on the centre line 15 m
  behind (48 m before a gap), at a standstill, untouchable for 1.5 s.
- **Verges** (`verges`): the barrier farther out on one side, over sand or
  grass: the cut across a hairpin worth taking with a Nitro.
- **Surfaces** (`surfaces`): ice (little grip: the kart slides on), mud,
  sand, snow (slow off-road with spray), boost strips.
- **Hazards** (`hazards`): things that move on their own (track/hazards.ts:
  a pure function of race time) and spin out a kart they touch.
- **Landmarks** (`landmarks`): set pieces the picture builds, by name from
  the theme's list below; `span` for a thing over the road (a tunnel, an
  arch).
- **The duck** (`duck`): every Handy game hides a rubber duck. Every track
  has one somewhere off the racing line.
- **Bank** (`bank`): the road leans into its bends (for the picture).

### What each theme can build

| Theme | Landmarks | Hazards |
| --- | --- | --- |
| meadow | windmill, barn, pond, hay-bales, hot-air-balloon, sheep, flower-field | — |
| canyon | mesa, rock-arch (span), cactus-grove, water-tower, mine-cart | boulder, tumbleweed |
| harbour | crane, lighthouse, ship, containers, warehouse, buoy | crab, forklift |
| kitchen | teapot, fruit-bowl, toaster, grater (span: a tunnel), salt-shaker, pepper-mill, cookbook, cereal-box, mug, fork-arch (span), spoon-arch (span), sink, window, wall-clock | orange (roll), pea (cross), teacup (orbit) |
| snow | igloo, cabin, snowman, ice-arch (span), ice-cave (span: a tunnel), pine-snow, gondola, ski-jump | penguin (cross), snowball (roll), yeti (bob) |
| volcano | volcano, lava-fall, basalt-columns, stone-bridge (span), obsidian-arch (span), hot-spring | fireball (bob), boulder (roll), geyser (bob) |
| funfair | ferris-wheel, carousel, big-top (span: a tunnel), rollercoaster (span: over the road), entrance-arch (span), food-stall, balloon-stand, hook-a-duck, helter-skelter, fireworks | teacup-ride (orbit), bumper-car (cross) |
| space | ringed-planet, ring-gate (span), asteroid, satellite, space-station, nebula | asteroid (orbit), comet (roll) |
| palm | palm-tree, beach-hut, surfboard, sandcastle, beach-towel, giant-ring (span), wristwatch (span: the start gantry) | crab (cross), coconut (roll), beach-ball (roll) |

## The tracks

Two cups of four, as a Grand Prix is raced, and one secret.

**Acorn Cup**

1. **Meadow Loop** (meadow): the gentle opener. Windmill on the hill, a pond
   by the hairpin (the duck), hay bales, a hot-air balloon drifting over.
2. **Kitchen Rally** (kitchen): toy-sized karts on a giant kitchen counter
   in late-afternoon sun through the window. A chopping-board start
   straight; round the fruit bowl; a chicane between salt and pepper; under
   the cheese grater (a tunnel); a ramp off a cookbook over the sink (fall in
   and the drone fishes you out — the duck floats in the sink); spilt milk
   (ice) on a bend; the counter's edge is a long open drop on the outside of a
   sweeping curve; oranges roll down the counter; a teacup spins. Everything is
   enormous: the teapot is thirty metres tall.
3. **Harbour Lights** (harbour): night on the quay, cranes and ships, crabs
   scuttling across the chicane.
4. **Canyon Run** (canyon): the climb, the ridge road, a jump over a gap in
   the ridge, boulders rolling down the descent, a sand cut inside the
   hairpin for the brave.

**Comet Cup**

5. **Fun Fair** (funfair): dusk, every ride lit. Under the entrance arch;
   round the carousel; through the big top (a tunnel full of lights); under
   the rollercoaster; a teacup ride spinning beside the road and bumper cars
   crossing a wide plaza; a ramp off the helter-skelter's foot; the hook-a-duck
   stall (the duck); fireworks over the finish.
6. **Glacier Pass** (snow): an alpine pass at blue hour. Ice patches on the
   bends, a frozen lake (all ice, wide) to slide across, an ice cave glowing
   blue, a ski-jump over a crevasse (a drop), penguins waddling across,
   snowballs rolling down, a yeti who pops out of a snowdrift once a lap.
   The duck sits by an ice-fishing hole on the lake.
7. **Volcano Rush** (volcano): black rock and rivers of lava (drops), a stone
   bridge over lava with nothing either side, fireballs leaping from the lava,
   boulders, a jump over a lava gap, the volcano smoking behind it all. The
   duck relaxes in a hot spring.
8. **Starlight Ribbon** (space): the finale. A glowing ribbon of road high
   over a ringed planet, banked bends and almost no barriers (fall and the
   drone brings you back), boost strips, ring gates, a long jump between two
   ribbons, asteroids orbiting the road. The duck floats in an astronaut's
   helmet by a satellite.

**Secret: Five Finger Circuit** (palm): an island shaped like an open hand,
seen from above — Handy's own hand. The road runs up and down every finger
(the fingertips are hairpins), round the thumb, across the palm and back
along the wrist, where a giant wristwatch is the start gantry; a ring on the
ring finger to drive through; palm trees, beach huts, crabs, coconuts. The
minimap is a hand. The duck sunbathes on a towel in the middle of the palm.
Unlocked by winning both cups (or, for those who know, the Konami code on the
start screen).
