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
- **Items.** Drive through an item box for an item (eleven kinds, below).
  Flick one hand open and closed again (under 0.6 s, the other hand staying a
  fist) to use it. Both hands opening together is a brake, never an item.
- **Start boost.** During the countdown, open your hands; close them on "1".
  Too early and the engine floods for a moment.
- **Hands gone.** One hand lost: the wheel holds its angle for 0.4 s, then
  eases to the centre. Both lost: the kart coasts, and the screen says "Show
  Both Hands".
- **Drivers.** Everyone picks one of eight drivers (a ninth, Dabble the duck,
  joins once every track's rubber duck has been found), in three weights
  (`src/kart/characters.ts`): **light** (Bun, Pepper, Moss) pick up speed 12%
  sooner and grip a little better but top out 3% lower and are shoved about
  (x1.4); **middle** (Kit, Juniper, Mango, Dabble) are the baseline; **heavy**
  (Bramble, Rivet) accelerate 10% slower and grip a little less but top out
  3% higher and shove back (x0.6). Small differences: skill decides races.
  Bots drive the drivers nobody picked and keep them all cup long.
- **Grand Prix and Mirror.** The host can race a **cup** (four tracks in a
  row, points 15, 12, 10, 8, 6, 4, 2, 1, standings between races, a podium at
  the end) instead of a single race, and can flip every track left for right
  with **Mirror Mode**. Details below.
- **Tricks.** Clap to honk (a Honk! bubble over your kart, and a horn the
  karts near you hear), raise both open hands high to cheer, wave one open
  hand to say hello (a cheering driver cheers on the podium too). Keyboard:
  H, C, V; gamepad: Y. A clap is not a brake and a cheer is not an item.
- **Eggs.** A rubber duck hides off the racing line on every track (drive up
  to it for a squeak and a toast; find them all and Dabble joins). Two karts
  over the line within 0.15 s for a top-three place get a **photo finish**. A
  win on the Fun Fair sets off fireworks. Enter the Konami code on the start
  screen (arrows, B, A; or a gamepad's d-pad, B, A) for a **golden kart** and
  the secret track, Five Finger Circuit, which winning both cups opens too.
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
| Triple Puck | Three Pucks, one per use; they orbit your kart until fired. |
| Comet | Six seconds untouchable (pucks, slicks, hazards and bumps pass through), 15% faster, the grass no slower than the road; the karts it touches spin. |
| Storm | A dark cloud over every kart ahead of you: each spins briefly (0.7 s), then crawls at 60% speed for 3 s. A Comet is spared. |
| Skyrocket | Flies high over the track to the leader (the runner-up when you lead) and bursts there: everyone within 9 m spins. A ring on the road and a warning on their screen show it coming. |
| Blast | An instant ring of force, 7 m round you: spins karts inside it and destroys Pucks, Seekers, Slicks, Decoys and Skyrockets there. |
| Decoy Box | Dropped behind like a Slick, but it looks like an item box (a duller colour, a wink). Whoever drives into it spins. |

The roulette takes about a second. What you get depends on your place: the
leader gets Slicks, Decoys, Pucks and Blasts; the middle of the pack Pucks,
Seekers, Triple Pucks and Nitros; the back Triple Nitros, Comets and Seekers
and, rarely, Storms and Skyrockets. A Storm is dealt once in 15 seconds at
most, and no more than one Skyrocket is in the air or in hand at a time.

### A race

Three laps by default (the room may choose 1-5). Up to eight karts: the
players, and bots filling the grid when the room wants them (on by default,
six karts in all). Countdown 3-2-1-Go; the race ends when every player has
finished, or 25 s after the first player finished — the rest are placed by
how far round they got. A finished player's kart drives itself on. A player
who leaves mid-race is replaced by a bot.

### Grand Prix and Mirror

The host's lobby chooses **Single Race** or **Grand Prix**. A Grand Prix is a
cup's four tracks in a row (the Acorn Cup or the Comet Cup, shown with their
tracks in the lobby; laps are per race). Points go 15, 12, 10, 8, 6, 4, 2, 1
by place; ties go to the better place in the last race (`src/kart/grandprix.ts`,
`GrandPrixRun`, which the host keeps and publishes as `LobbyState.grandPrix`).
After each race the **results** (with the points each place earned) give way to
the **standings** by themselves after 10 s, and the standings to the next race
(or, after the fourth, the **podium**) after 15 s; the host's Standings / Next
Race button (`Session.next()`) skips ahead, so a big screen needs no phone.
The standings count the points up from where they were, the rows sliding to
their new places with a mark for who rose or fell (`app/standings.ts`). Bots
keep their names, colours and drivers (`RacerSetup`) through the cup; the
leader starts on pole. The cup runs on the settings it began with. A latecomer
is turned away ("started"); a guest who leaves keeps their row and their kart
races on as a bot.

The **podium** (`render/podium.ts`, `createPodium(canvas)`, shown by
`app/podium.ts`) is a 3D ceremony: the top three drivers in their karts on a
three-step podium with gold, silver and bronze trophies turning over them,
confetti, and the camera swinging round the front (still, with little
confetti, for reduced motion); the cup's name, who won, and the final
standings beside it (a sheet at the foot on a phone); Play Again (`restart()`,
the same cup from the start) or Back to Lobby. `render/podium.html` is a dev
page for it. A player who wins a cup on this device has it written down
(`wonCup`); winning the second one says "You unlocked a secret track!".

**Mirror** (`LobbySettings.mirror`, a switch in the lobby): `mirrorTrack(def)`
(`track/mirror.ts`) flips every point's x and every lateral thing (offsets
negated, left and right swapped, landmark turns negated); the flag, not the
track, goes to the guests (`StartInfo.mirror`), who rebuild the same def. A
mirrored track's id is the original's plus `-mirror`. The secret track is in
the host's track list (single races) once the host's device has opened it.

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
- **Up to four on one camera.** A device can bring two, three or four players
  sharing one camera, standing side by side: the mirrored picture is split
  into that many vertical columns, left to right, and a hand belongs to the
  player whose column holds its palm. A hand that strays within 2% of a line
  stays its player's until it is clearly across. With three or four the
  tracker looks for six or eight hands at a lower confidence (0.4 instead of
  0.5) and the camera is asked for 1920x1080; the wheel check and the race
  show one picture with the columns marked in the players' colours. The
  host's screen is the big screen by default. The room still holds four.
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
| App | `app/`, `main.ts`, `/race.html` | The screens: start, you, choose your driver, the wheel check, lobby, race, results, standings, podium; the arcade's Racing heading. |
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
  cuts its speed to a fifth, and ends its drift. Decoy: a slick that looks
  like a box (at most 8). Odds are three rows (`oddsFirst`, `oddsMid`,
  `oddsLast` in `tuning.ts`) blended by place. Comet 6 s (+15% top speed, no
  slowing on rough ground, `immune` held up so items and hazards pass through,
  the sim spins what it touches and bumps pass through it). Storm: spin 0.7 s,
  `zap` 3 s at 60% top speed, rationed by `stormAt`. Skyrocket: 60 m/s along
  the centre line to the leader, burst after 1 s at the earliest, 9 m radius;
  the bots use a Blast when one comes within 6 m. Blast: radius 7 m. The sim
  tells the picture with `strike` events (a bolt per kart a storm zaps, a
  skyrocket's burst, a blast) and `KartView.comet` / `zapped`.
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
  tracker for two (four, six or eight for two, three or four on one camera).
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
- **Tricks** (`gestures.ts`, in hand lengths, a hand's span being twice the
  wrist-to-knuckle size): a **clap** (palms from at least one hand length
  apart to within 0.6 and back to 0.9 inside half a second, not from a brake
  and not with the wheel near full lock) → `horn` +1, at most one in 0.4 s;
  **both open hands** two hand lengths above where the wheel is usually held
  (learnt from the fists), held 0.3 s → `emote: "cheer"` while they stay up;
  **one open hand** turning round twice in a second, the other a fist or down
  → `emote: "wave"`. While palms are together or a cheer is on, the wheel
  does not brake, hop or flick an item. Keys: H honks, C and V hold cheer
  and wave; a gamepad's Y honks.
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
  with the steer, the driver (one of nine creatures, modelled in Blender, `art/kart/drivers/`,
  and posed by `render/drivers/`, whose code-built creatures stand in when the
  file is missing; each in a helmet, goggles or scarf in the kart's colour) leaning into turns
  with its hands on the wheel as it turns; cheering or waving with the player's
  gesture, bouncing at the finish, dizzy in a spin-out; the golden kart has a
  gold tub with the player's colour on its stripe, spoiler and hubs; body roll
  and pitch from the motion; a blob shadow. Effects:
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

Screens, in DESIGN.md's voice and style (frosted glass over one sky, big
tight type, springy motion; a white pill is the one main action of a screen;
`menu.css` holds the material, each screen has its own file):

1. **Start** (`start.ts`, `title.css`). Full-bleed key art
   (`assets/kart/title.webp`, 2560 x 1440: the action on the right, the left
   calm) with a slow drift, the Grip Prix wordmark (heavy italic, a chequered
   strip, speed lines) and a glass menu on the left: Host a Race (the white
   pill), the race code field and its Join a Race button in one capsule,
   Practice; "Up to 4 players" under it. Until the art is drawn, or where it
   is not fetched, the page's own meadow and road stand in. A phone that came
   with a `?join=` link does not fetch the art at all (it is on its way to a
   room). The back link goes to the Handy landing (`./`). `race.html` carries
   `assets/kart/icon-180.png` as its icon and Apple touch icon.
2. **You** (`you.ts`). One calm card: your name (a friendly default), how you
   drive as three tiles (Wheel, Keyboard, Gamepad), the wheel's steering, and
   Players on This Camera (1 to 4, each with a name). Remembered.
3. **Choose Your Driver** (`driver.ts`, `driverStats.ts`, `render/stage.ts`).
   The player's turn at the stage, one seat at a time (a chip for each seat
   says whose turn it is; Next Driver, then Continue; Back goes back a seat):
   the chosen driver sitting in their kart in the colour the room will give
   them, live 3D as a product shot on a glossy grey plinth with a thin ring in
   their colour, on a calm studio backdrop (a pool of light behind the stage,
   deeper blue toward the words): the race's own grade, a warm key light that
   throws the kart's shadow, a cool fill and two rims. It rests at a front
   three-quarter, begins to turn by itself only after a few idle seconds, and
   comes back to the front when another driver is chosen (drag to spin; the
   driver waves as they land). On a desktop the stage takes the left 60% and
   the words are one column, centred, on the right; the nine drivers run along
   the foot on the same grid. Their name big, their weight class, a line
   about them and four bars (Speed, Acceleration, Handling, Weight, 1 to 5
   segments each, read from `WEIGHTS`: the class with the least of a thing has
   one, the class with the most five, as the sim has it); the nine drivers
   as portrait tiles (the selected one lifts; Dabble is a locked silhouette
   that says "Find every duck", and looking at it shows how); the Golden Kart
   switch once the Konami code has been entered. Arrows (or a pad's d-pad or
   stick) choose, Return (A) goes on, B goes back. The stage is the one
   WebGL renderer of the screen and goes with it; where there is no WebGL, only
   software drawing, or the browser asks for less data (`?stage=3d` and
   `?stage=photo` choose by hand) it is a portrait of the driver instead.
4. **The wheel check** (wheel players): "Hold your fists up, like a wheel" →
   "Hold it level" (the level is set) → "Turn it" → "Open your hands to
   brake" → ready. After the first time, only "Hold it level". Back goes to
   the driver stage.
5. **Lobby** (`lobby.ts`, `lobby.css`). Two columns. On the left, the room:
   the host's join card (the QR code, the code large, Copy Link), a big card
   for every racer (their driver in their kart colour, name, how they drive
   and on which screen, a green tick when ready) and a soft dashed seat for
   each friend still to come ("Join with code ABCD"). On the right, the race:
   Single Race or Grand Prix as a large segmented control; for a single race a
   carousel of postcards, one for each track, snapping, with its name and cup
   (`assets/kart/tracks/<id>.webp`, 960 x 540; until one is drawn the track's
   own outline from `TrackGeometry`, in white over its world's colours,
   stands in: `trackArt.ts`); the screen stands on the chosen track's postcard
   (or the chosen cup's first), blurred, dimmed and veiled, crossfading when the
   choice changes (`backdrop.ts`; the sky where a postcard is missing); for a Grand Prix the cups as cards that show
   their four tracks; Laps, Bots and Mirror Mode as a compact strip; where the
   host's room shows the race; and a big Start. A guest sees the same room,
   read-only ("<host> sets the race"), with Show Me On: This Screen / Big
   Screen, and "Waiting for <host> to start".
6. **Race.** The canvas, each viewport's HUD, the wheel's picture in a
   corner for every wheel player on this device. While the world is built:
   the track's postcard, blurred and darkened, its name big with its cup
   (and "Race 2 of 4" in a Grand Prix), a thin progress bar and a tip about
   the hands that changes (`loading.ts`: open both hands to brake, flick one
   hand to use an item, hop to drift, clap to honk; in keys or buttons for
   the others). Escape or the pause button: a sheet with Leave Race (the
   host's also Restart).
7. **Results.** The track's postcard blurred behind a glass table (the
   page's backdrop, as in the lobby and the standings: `backdrop.ts`, darker
   glass over a picture so every word passes AA): each place a row in its
   player's colour that comes up in turn (last place first, the winner last),
   the medal colours for the top three, the fastest lap in gold; the title is
   gold, silver or bronze for a podium place and white otherwise; Race Again
   (the host), Back to Lobby. **Standings** (a Grand Prix, between races) wear
   the same, on the postcard of the race just run; the **Podium** (its end)
   has its own stage.

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
  grass: the cut across a hairpin worth taking with a Nitro. The road on
  the two legs of such a hairpin must meet the cut at about the same height
  (the sim places a kart by the nearest road, so its height changes where
  the nearer leg does), and the picture draws no barrier where the line
  would run through another stretch's ground.
- **Surfaces** (`surfaces`): ice (little grip: the kart slides on), mud,
  sand, snow (slow off-road with spray), boost strips.
- **Hazards** (`hazards`): things that move on their own (track/hazards.ts:
  a pure function of race time) and spin out a kart they touch.
- **Landmarks** (`landmarks`): set pieces the picture builds, by name from
  the theme's list below; `span` for a thing over the road (a tunnel, an
  arch). What the picture builds never stands where a kart can be: nothing
  solid within the barrier and 1.5 m beyond it (a camera's margin), nothing
  over the road lower than 5 m, the ground out to the barrier at the road's
  height, and the first hill or wall beyond it. A span landmark's legs are
  moved out to stand clear; a landmark beside the road needs an `offset`
  (and `scale`) that clears it, and its footprint may reach the road's other
  legs where the track doubles back. `src/kart/render/world/corridor.test.ts`
  measures all of it on every track (`CORRIDOR_REPORT=1` prints how far each
  offender must move). The chase camera is held to the same margin
  (`cameraSpace.ts`): it slides back toward the road in a bend, rises over
  rising ground and stays under a roof.
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
