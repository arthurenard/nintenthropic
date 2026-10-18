# Grip Prix

A kart racer for up to four people, steered with your hands. Hold your fists
up as if they gripped a wheel, and turn it: the kart follows the angle of the
line between your hands. Open your hands to brake, and keep them open to
back up. Every player brings their own camera — a laptop, a phone propped on
the table — and the race is shown on each player's screen, or all together on
one big screen in split screen, or both.

It is Handheld's second kind of game. The four shooting games aim a finger
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
  karts near you hear; a bot within 15 m usually honks back), raise both open hands high to cheer, wave one open
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
| Puck | Fired straight ahead; bounces off the barriers; spins out what it hits (you too, after half a second); a kart flying off a ramp passes over it. |
| Seeker | A puck that follows the track to the kart one place ahead. |
| Slick | A puddle of oil dropped behind you. Whoever drives through it spins. |
| Triple Puck | Three Pucks, one per use; they orbit your kart until fired. |
| Comet | Six seconds untouchable (pucks, slicks, hazards and bumps pass through), 15% faster, the grass no slower than the road; the karts it touches spin. |
| Storm | A dark cloud over every kart ahead of you: each spins briefly (0.7 s), then crawls at 60% speed for 3 s. A Comet is spared, and so is a kart the drone is carrying or has just set down. |
| Skyrocket | Flies high over the track to the leader of those still racing (the runner-up when you lead) and bursts there: everyone within 9 m spins. A ring on the road and a warning on their screen show it coming. |
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
mirrored track's id is the original's plus `-mirror`. The picture is the
world's mirror image: each landmark's model is reflected too
(`landmarks/mirror.ts`), not only turned, so a pond with its bank on one side
or a cart with its load stands the way the original does and what was clear of
the road on the original is clear on its mirror. The secret track is in
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
  stays its player's until it is clearly across. From two players up each
  column is read in a tile of the picture and a worker of its own, all at
  once (see Input). With three or four the tracker looks for six or eight
  hands at a lower confidence (0.4 instead of 0.5) and the camera is asked
  for 1920x1080; the wheel check and the race show one picture with the
  columns marked in the players' colours. The host's screen is the big
  screen by default. The room still holds four.
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
| Sound | `src/audio/cues/` pack `kart` | Engines, drift, boosts, items, countdown — synthesised like every Handheld sound. |

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
  rising from 0 to 1 in the last second before Go (while the lights say 1)
  gives the start boost; throttle held since before 1.2 s floods the engine
  (no drive for 0.6 s after Go). Bots get a start boost by skill. (The window
  was 0.6 s: hands closed as the 1 came up reached the sim about 0.8 s before
  Go, after the fist's 0.12 s hold and the camera, and missed it.)
- **Karts touch.** Circles of radius 1.1 m push apart, the faster one
  shoving harder; a `bump` event.
- **Item boxes.** A row of five across the road at each of the track's
  `itemRows`; a box taken comes back after 3 s. Roulette 1.0 s. Odds by place
  (above). Puck: 40 m/s, 6 s, bounces off barriers, hits within 1.4 m.
  Seeker: 36 m/s along the centre line toward the kart one place ahead,
  homing within 30 m (along the road as well as straight across, so it
  never turns for a kart beyond the barrier on the next finger). Slick:
  dropped 2.5 m behind, stays until driven through (at most 12 on the
  track; the oldest goes). A hit spins the kart 1.2 s,
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
- **Players sharing a camera** (`tracking/tracker.ts`, `LaneTracker`). From
  two players up the picture is cut into one tile per player (`tiles.ts`, a
  column reaching 6% into its neighbours) and each tile is read by a worker
  of its own looking for two hands (`lanesFor`): the first on the GPU, the
  others on the CPU, side by side (four players, on a machine of eight cores
  or more, all on the CPU). The page hands each worker its column as
  a VideoFrame cut to it (`visibleRect`, no copy; a browser that cannot cut
  one sends the whole frame and the worker cuts it). A worker says what it
  found as soon as it has, and a frame is published for that column alone:
  `HandFrame.read` names the columns it looked at, the other columns' hands
  are the ones last seen there, and a seated wheel takes a frame that did
  not read its column for no news (`readsSeat`), neither hands gone nor
  hands held still. A hand two tiles both saw is kept once, the column just
  read winning, and inside that column (but for its edges) a neighbour's
  older sighting of a hand it did not see is left out. An empty seat's column is read on every third frame
  (`TileSchedule`). Two players' tiles give each palm nearly twice the
  pixels in MediaPipe's 192-pixel palm detector, and one player hunting for
  a lost hand no longer slows the other's reads.
- **Which delegate** (`tracking/adapt.ts`). A worker whose WebGL is drawn
  in software (SwiftShader, llvmpipe: what a browser falls back to when the
  graphics driver is blocklisted, as on many older laptops; `isSoftwareGpu`)
  starts on the CPU, whatever was asked: there a GPU read takes seconds. A
  worker whose landmarker has taken more than 40 ms a frame (the median of
  a second and a half of reading) is asked to try the other delegate: it
  makes a second landmarker, the two read frames in turn for 24 frames (or
  until one is plainly twice as quick), and the quicker is kept (by 15% or
  more; a landmarker that fails a read loses); not asked again for a minute
  (twice as long after each try that changed nothing, up to eight), one
  worker at a time, and a CPU worker does not try the GPU while another
  worker has it. Grip Prix asks for the tries; the shooting games do not.
- **The hands first** (`app/handsFirst.ts`). Every read ends by fetching the
  landmarker's answer back from the GPU, behind whatever the race has asked
  it to draw. While the tracker drops more than a quarter of the frames it
  wanted (for a second), the race's resolution comes down a step (0.1, to
  0.6 at the lowest: `RaceRenderer.limitResolution`, on top of dynamic
  resolution); with three seconds of room it goes back up 0.05, and a step
  up that brings the drops back is undone and left alone for a while. Steps
  down that did not help (at 0.6 the tracker reads no larger a share than in
  the two seconds before the first) are undone, so the picture never pays
  for nothing. A frame counts as wanted at a reading's pace, thirty a second
  (a 60 fps camera's in-between frames are not drops), and only for seats
  being played (an empty seat's column, read every third frame, is left
  out); the same counts give the Frame Rate readout its "hands N/s".
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
  hop until |steer| < 0.15 for 200 ms or a brake. A hop while the drift is
  still held (after a hop that was only a hop, or a drift a spin-out ended)
  lets go of it for 50 ms first, so the kart sees a fresh press and hops.
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
  the engine's quality tiers and dynamic resolution, instanced scenery that
  each view culls cell by cell, no real-time shadows beyond one cheap map near
  the karts. How it was measured, and what each tier costs: "Performance"
  below.
- **The dev page** `src/kart/render/dev.html`: the track and eight karts
  driven by the real sim (bots), the keyboard driving kart 0, `?views=1..4`;
  `?profile=1` times the frame and `?scale=1` holds the resolution (see
  "Performance").

## Performance

Measured, then changed, in this order; everything below is on an Apple M4 Max in Chrome on Metal,
a 1440x900 window at 2x, resolution pinned at 1 so tiers compare at equal pixels, eight bots on the real sim.

**Tools** (`tools/perf/`, all headless Chrome with `--use-angle=metal --enable-gpu --mute-audio`, frame-rate limit off):

- `bench.mjs`: every track x 1 or 4 views x tier through the dev page (`dev.html?profile=1`): fps, CPU ms (sim, scene
  update, draw submit, HUD), GPU ms (EXT_disjoint_timer_query_webgl2: the views with their shadow passes, and the
  post chain), draw calls, triangles, shader programs, texture and renderbuffer memory (counted at the WebGL calls),
  time to the first frame, the worst of the first 240 frames, heap allocated per frame. `--bases a,b --rounds n`
  alternates two dev pages (two checkouts) and prints medians, which is the only fair way on a busy machine (the same
  configuration measured 190 and 275 fps an hour apart); `--cpu n` slows the page's main thread; `--soft` draws on a
  software GPU, where every triangle and pixel costs.
- `same.mjs`: proves an optimisation leaves the picture alone (the same moment redrawn through the post chain with it
  off and on, canvases compared). `shots.mjs`: the same posed still from two dev pages at each tier, with the
  difference in 8-bit levels.
- `tracking.mjs`: the hand tracker for 1 to 4 players on one camera (`e2e/tracker.html`), before and after the workers
  per player. `trackrace.mjs`: the tracker beside a race (`e2e/trackrace.html`), 1 to 4 players each beside as many
  views, before and after, alternating rounds (`--rounds n`), `--soft` on a software GPU. Their pictures: a hand photo
  per player, or two fists per player (`e2e/crowd.js`, `?players=N`).
- A worktree whose `node_modules` is a link needs a Vite config that adds the real `node_modules` to `server.fs.allow`,
  or Three's Draco decoder is refused (403) and every Blender model falls back to its code-built stand-in.

**What the numbers said.** On this machine a frame is limited by the number of GL calls, not by triangles or pixels:
the main thread sits in `uniformMatrix4fv` and the draw calls waiting for the GPU process (a quarter to a half of
its time), the GPU's own time for the views is a few milliseconds, and hiding every tree changes the frame time
by nothing. Four views multiply draw calls and vertices by four and pixels by none, so they are where weaker
hardware breaks: 700 to 1200 calls and 2 to 9 million triangles a frame at the high tier, a third of the
calls in the shadow pass. The Blender art had doubled the triangles; most were never on screen. Three.js's own
per-draw bookkeeping (uniform uploads, material parameters, sorting) is about four fifths of the 100 to 800 KB allocated per
frame, so it falls with the draw calls; the game's own is about 50 KB.

**Before and after, the worst tracks, medians of two or three alternating runs** (draw calls and kilo-triangles are
what one frame draws; "hitch" is the longest of the first 240 frames of a race, ms, which the dev loop clamps at 100,
and which carries the machine's other work too; meadow-loop, four views, high, drew 8.8 M triangles and 939 calls and
now draws 4.3 M and 783, measured at one moment with `same.mjs`):

| track, views, tier | frame ms | draw calls | k triangles | hitch ms |
| --- | --- | --- | --- | --- |
| canyon-run, 1 view, high | 9.4 to 8.4 | 199 to 165 | 1322 to 620 | 100+ to 14 |
| canyon-run, 4 views, high | 9.9 to 10.1 | 858 to 721 | 5454 to 2621 | 55 to 17 |
| canyon-run, 4 views, medium | 10.1 to 8.9 | 790 to 629 | 4149 to 2357 | 38 to 51 |
| canyon-run, 4 views, low | 6.0 to 5.0 | 738 to 571 | 3091 to 2128 | 12 to 9 |
| five-finger-circuit, 1 view, high | 5.7 to 5.7 | 186 to 171 | 1038 to 515 | 100+ to 12 |
| five-finger-circuit, 4 views, high | 7.1 to 6.8 | 863 to 736 | 4644 to 2489 | 62 to 16 |
| five-finger-circuit, 4 views, medium | 5.1 to 4.8 | 834 to 673 | 3548 to 2151 | 40 to 11 |
| starlight-ribbon, 4 views, high | 6.5 to 6.5 | 689 to 674 | 1860 to 1855 | 37 to 16 |

On this GPU the frame time barely moves (it was never the triangles), which is the point of the other columns:
what a weaker GPU or a slower driver pays for falls by 30 to 60% in triangles and 15 to 25% in calls. On a software GPU
(`--soft`, 640x360, meadow-loop, four views) one frame took 4.7 s and now takes 2.2 s. The first frame of a race, which
compiled thirty-odd shaders while the countdown began, went from 148, 227 and 185 ms (meadow, glacier, canyon, four views)
to 27, 19 and 21 ms, and the 63 to 113 ms hitch at the green light (a kart's flames, their program only built when
first drawn) is gone; the shaders (about 80 programs, up from 37 compiled lazily) are now built behind the loading
screen, which can take a few hundred milliseconds longer to finish (the first frame came within 0 to 600 ms of its old
time, either way, in a noisy run). Texture memory is 218 MB and 235 MB of multisampled targets at the high tier
(110 MB and 3 MB at low). Between races each renderer gives its context back (`forceContextLoss`), so the GPU's
memory goes with it; four restarts in one page grew the JS heap from 113 to 117 MB.

**What changed, and why**

- *Scenery culling per view* (`world/cull.ts`, its own commit; positions, scales and colours untouched). A scenery
  kind was one InstancedMesh for the whole map, so three could only ask if all of it was in view and it always was.
  Instances are grouped in 48 m cells with bounding spheres; a view draws only the cells its frustum touches, from an
  instance buffer of its own that is rewritten only when its cells change. Scenery and foliage (tufts, flower
  stems, petals). `same.mjs` compares the canvases with it off and on: identical on all nine tracks, 1 and 4 views, high
  and medium.
- *Shaders and first pictures at load* (`warmUp` in `renderer.ts`): compile in parallel (`compileAsync`), then draw two
  pictures through the whole post chain with the hidden things (flames, the item pool) shown, then clear the canvas.
- *Ground tiles of 40 cells* instead of 20: a fifth fewer draw calls, same picture.
- *Lesser tiers*: karts are welded into one mesh from 26 m (medium) and 18 m (low) instead of 34 m; ground tiles of 60
  and 80 cells; bloom's thresholded copy at half size. The high tier keeps all of its detail: the same still of every
  track at the high tier, before and after, differs by 0.000 levels (identical pixels; `shots.mjs`); medium and low
  differ by 0.01 to 0.7 levels on average (the half-size glow and the welded far karts).
- *Drawing code loaded with the race, not the page* (`app/lazyRenderer.ts`): the start screen, the lobby and a phone that
  is only a wheel no longer download three.js and the world builders. Script loaded eagerly by `race.html`: 1.6 MB
  to 0.29 MB.
- *Hand tracking*: a tile whose seat has shown no hand for a second is read every third frame (`TileSchedule` in
  `tiles.ts`, staggered across tiles); a tile with hands is read on every frame, so steering never waits. Measured
  on the GPU delegate in the worker, 30 fps camera: four seats with two hands up 29 to 24 ms per camera frame, four seats
  with three up 37 to 24 ms (13.6 to 26 reads a second, 81 to 17 frames skipped). One player on the whole picture:
  11 to 13 ms; two: 17 to 20; three: 24 to 27; four, all seated and playing: about 30 to 40. One inference is in
  flight at a time already (a frame that arrives while the worker is busy is dropped, never queued).

**Hand tracking beside a race** (`e2e/trackrace.html`, `tools/perf/trackrace.mjs`: a picture of a hand at 30 fps read by
the tracking worker on the GPU delegate while the dev page draws a race in an iframe of the same page; medians of three
runs, the M4 Max at 1440x900@2). Measured when hand recognition felt worse than it had:

| players on the camera, views | tracker alone | beside the race | race with the stand-ins (`?art=0`) |
| --- | --- | --- | --- |
| 1, 1 view: inference / delay | 12.5 / 28 ms | 14.7 / 30 ms | 14.2 / 29 ms |
| 2, 2 views | 17 / 32 ms | 27.5 / 39 ms | 27 / 39 ms |
| 4, 4 views (reads a second) | 33 / 48 ms (19) | 63 / 73 ms (13) | 50 / 63 ms (13) |

- A race costs one player's tracking about 2 ms, with or without the Blender art; the menus and the wheel check cost it
  under 2 ms (inference 13.2 ms, 11.1 without their backdrop blur). The art adds 0 to 12 ms to four players' tracking.
- Four players is where it hurts: four landmarkers read one after another in one worker (28 to 33 ms a frame on an idle
  GPU, already the camera's whole interval), and a race beside them roughly doubles that, so the tracker reads 13
  frames a second instead of 28, 70 ms behind the camera.
- The one cause that was in our hands was the HUD's glass: `backdrop-filter` over a canvas that changes every frame is
  GPU compositor work on the GPU the tracker uses, whatever the radius (blur 16 px, 6 px and 16 px without the
  saturate cost the same; none does not). Without it: four players 64 to 49 ms and 74 to 62 ms behind; two players
  28.5 to 26 ms, frames skipped 63 to 9, 22 to 29 reads a second. The glass is now left flat (the low tier's
  slightly more opaque style) when two or more wheel players share the screen (`hudBlurFor`); one wheel player keeps
  the blur (it cost under 2 ms).
- Not worth it, measured: a lower tier (no change), a lower resolution (63 to 48 ms at 0.65), drawing the race at 30 or
  20 fps (45 or 36 ms, reads 14 to 18 a second), a second tracking worker (alone 31 to 19 ms, beside the race 62 to
  46 ms, still 13 reads a second): the race's frames and the tracker take turns on the GPU, and the turns, not the
  pixels, are the cost. (Each of these alone; a worker per player with all but one on the CPU, and the race giving up
  pixels for them, together, are what worked: see below.)
- A seat that lost its hands (opening them to brake, a fast turn) is read on every frame for the next 30 reads, about
  a second, before an empty seat goes to every third (`QUIET_AFTER`), so it is found again on the very next frame.

**Several players on one camera: a worker each, and the race makes room** (`tools/perf/trackrace.mjs` and
`tracking.mjs` compare the tracker as it was, "before", with how the game runs it now, "after"; rounds alternate).
Measured when three players side by side did not work well on the M4 Max, and two did not on an older laptop.

- Every read ends by fetching the landmarker's answer back from the GPU: the palm detector's, then each hand's, one
  after another. MediaPipe takes every picture in as a WebGL texture whatever the delegate, so the CPU delegate waits
  on the GPU too. Each fetch waits behind whatever the race has asked the GPU to draw, so what a read costs beside a
  race is set by the race's load on the GPU far more than by the landmarker's own work. Three CPU landmarkers took
  87 ms a read beside three views at the high tier, 53 beside one view, 33 beside three views at the low tier (the
  race drawing the code-built stand-ins in all three).
- Three players, three views, high tier (a first, single-round matrix, the race drawing the stand-ins): one worker
  reading the three tiles one after another, 10.9 reads a second for each player, 79 ms behind the camera; a worker
  per tile all on the GPU, 4.8 reads a second (the three contexts and the race take turns on the GPU and all slow
  down); one on the GPU and two on the CPU, 11.7 and 62 ms; the same with the race at 0.6 of its resolution, or at
  the medium tier, 25.8 and 40 ms. One worker gains nothing from the lighter race (11.8 and 74 ms at 0.6): its reads
  are one after another whatever the GPU is doing. The workers and the lighter race are worth something only
  together.
- Two players: about 29 reads a second and 38 to 40 ms behind with one worker on the whole picture or a worker each,
  at either resolution, on this machine. Their tiles are still worth it: each palm gets nearly twice the pixels in the
  palm detector, and one player hunting for a lost hand (the detector runs on every frame until it is found) no longer
  slows the other.
- Before and after, with the Blender art, meadow-loop at the high tier, 1440x900 at 2x (`trackrace.mjs --rounds 2`,
  both rounds: how many times a second each player's hands were read, and how far behind the camera, p50; the race
  held 60 fps in every case; "ceiling" is where the race's resolution settled, "workers" the delegates they ended on):

| players, views | before | after | ceiling, workers |
| --- | --- | --- | --- |
| 1, 1 | 29.3 a second, 30 to 40 ms | 29.0 to 29.4, 30 to 40 ms | 1, GPU |
| 2, 2 | 29.2 to 29.4, 39 ms | 29.3, 41 to 42 ms | 1, GPU + CPU |
| 3, 3 | 10.3, 87 to 88 ms (p95 107 to 109) | 22.5 to 24.6, 39 to 41 ms (p95 55 to 61) | 0.7 to 0.8, GPU + 2 CPU |
| 4, 4 | 7.0 to 7.5, 121 to 124 ms (p95 143 to 157) | 21.5 to 22.3, 42 ms (p95 58) | 0.6 to 0.7, 4 CPU |

- With four, the GPU worker tried the CPU and kept it (`adapt.ts`) in both rounds, and more of the picture's fists were
  found on each frame (5.9 of 8 instead of 4.4: a hand read often is followed, not searched for again). In a third
  run it stayed on the GPU and everyone's reads halved (11.3 a second), so four players now start all on the CPU: 21.3
  a second, 42 ms, the race at 0.6 and 60 fps. On a machine loaded by other work (load average 48), four players read
  3.2 times a second, 196 ms behind, before, and 15.0, 52 ms, after.

- So: from two players up, a tile and a worker each (`lanesFor`: the first on the GPU, the others on the CPU; all four
  on the CPU for four players, where one left on the GPU halved everyone's reads: 11.3 a second instead of 22), each
  publishing as soon as it has read; a slow worker tries the other delegate (`adapt.ts`), for the machine where the
  CPU is the quicker; and while the tracker drops frames the race gives up pixels (`handsFirst.ts`), down to 0.6 of
  its resolution, and takes them back when the tracker has room. Not measured on the older laptop itself: the
  adaptation is there so that it finds its own balance, and the Frame Rate readout says what it got ("60 fps · hands
  29/s").

**Tiers.** `guessTier(gpu, cores, { splitScreen: true })` (Grip Prix passes it; the arcade's own guess is unchanged): a
base Apple chip (M1 to M4) starts at medium, as do Safari and an iPad, which report only "Apple GPU" (unless the
core count says a Pro or Max: 12 or more); Apple Pro, Max and Ultra start at high; old Intel graphics at low, Iris Xe
and Arc at medium; a laptop Adreno (X1) at medium, a phone's at low; the small GeForce parts (MX, GT) at medium; a big
GPU in a machine of four cores or fewer is a step down.

**The safety net.** If dynamic resolution has sat at its floor for six seconds of racing (`StrainWatch`), the renderer
tells the app, and in Auto the next race starts a tier lower on this device (`handy.kart.ceiling.v1`, kept 14 days,
forgotten when the player chooses Graphics again). Checked end to end on a software GPU that said it was an M1:
medium, then "Auto is using Low here: a race ran slowly, so it stepped down."

**Graphics.** The pause sheet has Graphics (Auto, Low, Medium, High; `handy.kart.graphics.v1`, Auto by default) and a
Frame Rate switch (`handy.kart.fps.v1`: a small readout beside the pause button). The renderer is built from the choice
at the start of each race, so a change shows from the next one (Restart, in the same sheet, is the way to see it now);
the footnote says which tier Auto uses here.

**Phones as wheels.** A phone whose race is on the host's big screen creates no renderer, no world and no canvas
(`views()` is empty: `app/race.ts` shows the controller), fetches none of `world-*.glb`, and no longer builds the
3D podium after a Grand Prix. What it still does is 3D for the driver picker and the lobby's portraits (the karts' and
drivers' models, Draco's decoder, three transient WebGL contexts) before it knows it is only a wheel.

**Next.** Photo portraits for the driver picker where the room's race is on the host's screen (a phone then loads no
models at all); caster culling for the shadow pass (karts behind a view's camera, 23% of the draw calls at four views are
the shadow pass); a cap on the pixels of a huge window (a 5K display at 2x draws 15 million pixels at the high tier);
merging the track's road, kerb and verge meshes beyond 150 m; the race giving up shadows or bloom before pixels when the
tracker is short of the GPU (`handsFirst.ts` only knows the resolution).

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
   room). The back link goes to the Handheld landing (`./`). `race.html` carries
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
   the others). Escape or the pause button: a sheet with the Music and
   Effects sliders, Graphics (Auto, Low, Medium, High) and a Frame Rate
   switch (`graphicsui.ts`; see "Performance"), and Leave Race (the host's
   also Restart).
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
- Performance (Vitest): the tier guess for each GPU family (and the split-screen
  rules), the safety net's watch and its ceiling in prefs, the per-view culling of
  instances (everything the frustum reaches is drawn once with its colour, a buffer is
  rewritten only when its cells change), the tracker's tile schedule, the lazy
  renderers, the workers per player (`lanesFor`, a frame for one column is no news
  to another player's wheel, the column just read wins a shared hand), the try of
  the other delegate (`adapt.ts`) and the hands first (`handsFirst.ts`: steps down
  while frames drop, undone when they do not help, back up with room). Pictures and
  timings are `tools/perf/` (not run by CI).
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
  moved out to stand clear (and, where the track doubles back beside itself,
  what would stand in the neighbouring stretch's ground is cut away, so a
  modelled one is placed to need no cut); a landmark beside the road needs an
  `offset` (and `scale`) that clears it, and its footprint may reach the
  road's other legs where the track doubles back (on the palm island nothing
  fits between the legs of a finger). The track's own decoration obeys the
  same rule: the start gantry's legs stand beyond the barrier and its margin,
  the barrier is not drawn where the nearest road would let a kart stand
  (the inside of a tight U-turn), and a soft barrier (snowbank, basalt) is
  drawn so that its face meets the wall rather than reaching in. Two tests
  measure all of it every metre along and half a metre across, on every track
  and its mirror, with what turns looked at as it sweeps, and every steep
  surface (a wall, a hull's side, a trunk) walked over a third of a metre at
  a time, so a solid whose roof is above 5 m and whose floor is below the
  road is caught by its sides: Harbour Lights' two ships stood across the
  start straight and the far straight that way (their sterns on the road,
  the karts driving through the hull), a palm tree stood in the middle of a
  finger of the palm island, and the meadow's pond had its reeds on the
  verge, none of which a surface seen from above could show. The ships are
  now moored alongside the quay, in the water (`turn` 0, 115 and 120 m out),
  the pond is a little smaller (0.9) and centred in its hairpin, and a dozen
  landmarks moved a few metres:
  `src/kart/render/world/corridor.test.ts` (the code-built world, and the
  lower quality tiers' ground and scenery) and `corridor.art.test.ts` (the
  Blender world: `nodeArt.ts` decodes the Draco files in Node and files them
  where `art.ts` would, so the real landmarks and scenery are measured).
  `CORRIDOR_REPORT=1` prints how far each offender must move. The chase
  camera is held to the same margin (`cameraSpace.ts`): it slides back toward
  the road in a bend, rises over rising ground and stays under a roof.
- **The duck** (`duck`): every Handheld game hides a rubber duck. Every track
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
seen from above — Handheld's own hand. The road runs up and down every finger
(the fingertips are hairpins), round the thumb, across the palm and back
along the wrist, where a giant wristwatch is the start gantry; a ring to
drive through on the straight by the wrist (the fingers are too close to one
another for anything to stand between them); palm trees, beach huts, crabs, coconuts. The
minimap is a hand. The duck sunbathes on a towel in the middle of the palm.
Unlocked by winning both cups (or, for those who know, the Konami code on the
start screen).
