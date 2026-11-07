# Grip Prix

A kart racer for up to four people, steered with your hands. Hold your fists
up as if they gripped a wheel, and turn it: the kart follows the angle of the
line between your hands. Open your hands to brake, and keep them open to
back up. Every player brings their own camera — a laptop, a phone propped on
the table — and the race is shown on each player's screen, or all together on
one big screen in split screen, or both.

It is the second kind of game in Nintenthropic. The four shooting games aim
a finger pistol; Grip Prix holds a wheel. It lives on its own page, `race.html`,
and has its own tile on the landing, beside Finger Guns.

Nothing here is borrowed. The karts, drivers, items, tracks and names are
Grip Prix's own (no plumbers, no shells, no question-mark boxes).

## How it plays

- **Drive.** Both fists closed: the kart accelerates by itself. Turn the
  wheel: the angle between the line through your hands and the horizon
  steers. ±4° does nothing (a straight line stays straight); 40° is full
  lock (Settings: Steering, Gentle 50° / Normal 40° / Quick 30°), on a curve
  that is gentle near the centre.
- **Brake and back up.** Open both hands, going straight or slowly: brake.
  The brake is a pedal that comes on: a flick of open hands barely costs
  speed, held it takes about a second to lose most of it and under one and
  a half to crawl, and the kart flows on into backing up without stopping dead. You
  still steer while reversing — open hands are tracked as well as fists.
- **Drift.** Open both hands in a bend at speed, as if braking into it: the
  kart hops into a power-slide that way, its tail swinging out, and keeps its
  speed while the hands stay open. Turn into the slide to tighten it (the tail
  swings further), against it to run wider; hold it hard against the slide
  and the kart straightens out of it. Sparks grow blue, then orange, then
  white-hot; close your hands to let go, and the kart boosts — longer for
  each colour. It is the wheel's only drift: however far the wheel is
  turned, fists only steer.
- **Jumps and tricks.** Ramps throw the kart into the air, and so does the
  top of a hill taken fast. In the air, shake the wheel (quick left and right
  turns): the kart twirls, and boosts when it lands.
  Shake right at a ramp's lip and the kart springs off higher and further,
  and boosts longer.
- **Air sections** (`sim/air.ts`; `TrackDef.air`, see Track features). A pad across the road throws the kart into a
  planned flight: `flight` 3 (a cannon or a lip, tricks allowed) or 4 (a glide, parasol up). The flight is not
  integrated with gravity: its height over the road is a function of the metres the kart has run since the pad
  (`arcHeight`: a parabola for a cannon and a lip, a quick climb and a long, bending float down for a glide), so where
  it comes down is designed, a slow kart only takes longer, and the sim, a guest's prediction and every picture agree
  without a byte more on the wire. Nothing moves with the race clock here, only with the kart's own place along the road.
  A cannon takes any kart over 2 m/s and throws it at 21 m/s along the road; a glide takes one over 5 m/s, a lip one over
  9 m/s. In flight the wheel turns the course (0.45 rad/s a cannon or lip, 1.1 a glide; a jump is 0.55) while an
  autopilot swings the course toward the road's direction ahead (2.4/s, at most 1.2 rad/s) so a bend under the flight
  does not carry a kart that lets go into the scenery; steer past an open edge by more than the edge's metre and a half
  and the kart falls (the drone) as on the ground. The trick button is a trick in a cannon or lip flight (a boost
  on landing), not in a glide; a glide that lands within 3 m of the road's middle (the rings painted there) boosts 0.7 s.
  `jump` events carry `arc` ("cannon" | "glide" | "lip"); `KartView.glide` is 1 under the parasol. Bots (`bots.ts`)
  steer a planned flight toward a lane (a glide: the middle, each bot a little off it by its number) and trick in a
  cannon or lip flight by skill.
- **Slipstream.** Tuck in right behind another kart: you go a little faster
  and, after a moment, are flung out past it with a boost.
- **Hills.** A climb slows you a little; coming down, you gather speed and
  carry it out of the dip.
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
  Bots drive the drivers nobody picked and keep them all cup long, each with
  a temperament of its own (aggressive, careful or erratic; "Sim", Bots).
- **Grand Prix and Mirror.** The host can race a **cup** (four tracks in a
  row, points 15, 12, 10, 8, 6, 4, 2, 1, standings between races, a podium at
  the end) instead of a single race, and can flip every track left for right
  with **Mirror Mode**. Details below.
- **Tricks.** Clap to honk (a Honk! bubble over your kart, and a horn the
  karts near you hear; a bot within 15 m usually honks back), raise both
  open hands high to cheer, wave one open hand to say hello (a cheering
  driver cheers on the podium too). Keyboard: H, C, V; gamepad: Y. A clap is
  not a brake and a cheer is not an item.
- **Eggs.** A rubber duck hides off the racing line on every track (drive up
  to it for a squeak and a toast; find them all and Dabble joins). Two karts
  over the line within 0.15 s for a top-three place get a **photo finish**. A
  win on the Fun Fair sets off fireworks. Enter the Konami code on the start
  screen (arrows, B, A; or a gamepad's d-pad, B, A) for a **golden kart** and
  the secret track, Five Finger Circuit, which winning both cups opens too.
- **Keyboard and gamepad** drive too (testing, accessibility): arrows or
  WASD, Space to drift (and to trick in the air), Left-Right-Left quickly to
  shake, E or Shift for the item; a gamepad's left stick, triggers, A to
  drift, the stick flicked left-right-left to shake, B or X for the item.

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
how far round they got. A finished kart (a player's too) drives itself on,
with nothing in hand: it drops its item at the line and the boxes give it
none, so a lap of honour spins no one still racing. A player who leaves
mid-race is replaced by a bot.

**The finish-line photo.** The moment to remember. As a wheel player's kart
crosses the line their camera takes a few stills over the next second and
keeps the one that caught them celebrating (both hands up beats a wave beats
hands off the wheel; with none, the moment they crossed), and the results show
it beside the table with their place, name and time, the best placed player's
the biggest. A player still on the road when the race is decided is taken as
it ends. Keyboard and gamepad players have no camera: their card is their
driver's portrait in their colour. In a room every device sees every photo.
**Share** on the results makes one picture of them all (to the share sheet, or
saved). Nothing is kept otherwise, and the pause sheet's **Finish Photo**
switch (on by default, shown to a device with a wheel player) turns it off.
Details under Input, Net and App.

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
races on as a bot, winning points for that row.

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

The camera picture never leaves the device, but for one photo of each wheel
player at the finish line (below), which goes to the room's other devices once
the race is decided, peer to peer like everything else: never to a server,
never stored, gone with the page. What goes over the network otherwise is each
player's steering, a few bytes sixty times a second, and the race as the host
runs it.

## Parts

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
| App | `app/`, `main.ts`, `/race.html` | The screens: start, you, choose your driver, the wheel check, how to drive, lobby, race, results, standings, podium. |
| Sound | `src/audio/cues/` pack `kart`, `src/kart/audio/` | An engine for each weight (and Rivet's motor), in three rev bands pitched by its revs, built from firings, an exhaust pipe, an intake and a harmonic series (wide and alive), roughened by how hard it works, with a bark at each gear change; other karts heard going by (stereo, Doppler, duller from behind); the tyres on the road and every surface, a scraped barrier and creaking suspension; the drift's squeal and its sparks' fizz through the three levels; the wind at speed, in the air and in a slipstream; boosts, landings, items, hits, a place won or lost, the countdown and the finish; each track's place, very quietly — synthesised like every Nintenthropic sound ("Sound" below). |

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

The numbers (all in `sim/tuning.ts`):

- **Speed.** Top 24 m/s on the road, ~90% of it in 3 s. Off the road (more
  than half the width from the centre) top speed falls to 11 m/s with drag.
  A barrier stands 6 m beyond each edge: hitting it kills the speed into it,
  loses 30% of the rest, and makes a `wall` event. Brushing it (under 3 m/s
  into it) wears 3 m/s off the speed each second, so a kart on the outside
  of a bend is slowed, not stopped. Nose against it and nearly stopped, the wheel turns the kart as it would at
  4 m/s, so a kart that met it head-on is never wedged.
- **Turning.** Yaw rate up to ~2.2 rad/s, rising with speed from nothing at a
  standstill to full by 6 m/s, a little less at top speed. Grip pulls the
  velocity toward the heading quickly (a slight slide, never ice), turning
  88% of the sideways speed it takes into forward speed. A nose more than
  15° off the way the kart goes (a slide let go, a shove) swings back toward
  it as the grip takes hold. `KartView.speed` is the whole speed, even in a
  slide (negative reversing); `course` is the way it goes.
- **Brake.** A pull toward a target speed, the way the throttle is one (the
  idea of a kart racer's eased speed, built here): the speed eases toward
  `throttle × top − 7 × brake` with rate 1.3/s (`drive.brakeRate`, times the
  ground's `brake`), so a brake alone heads for −7 m/s with no stop at zero
  and no reverse delay, and brake with throttle settles near top − 7. The
  pedal comes on: the pull starts at 20% of its rate and builds with a 0.5 s
  time constant (`brakeRamp`) while the brake is held (under 3 m/s it is at full pull at
  once, so backing up from rest does not wait), and fades three times
  faster than it came when let go (`kart.stand` is this build-up, in ticks, so
  a second tap picks up where the first left off). From 24 m/s on the road,
  held: 0.2 s 21.1 (the old brake: 18.0), 0.5 s 15.2 (9.0), 1.0 s 6.0 (0),
  a crawl under 2 at 1.35 s, zero at 1.5 s and backing up (the old brake reached
  zero at 0.8 s, then waited 0.3 s), -3.3 at 2 s, -7 by 6 s. From rest, held:
  -1.9 at 0.25 s, -3.3 at 0.5 s, -5.1 at 1 s. Brake with throttle: 21.4 at
  0.5 s, 19.5 at 1 s, 18.2 at 1.5 s, 16.7 settled. A 0.15 s flicker costs under
  1 m/s. Ice brakes at a quarter of the pull. Why the old one felt like 90% at once: a
  flat 30 m/s² from the first tick against a 24 m/s top, so 0.7 s took 21 of
  the 24 m/s, with nothing to build on and a dead stop before the reverse.
  Bots plan their bends for 16 m/s² (`bots.planBrake`), which the new brake
  gives over a typical 10 m/s shed (24 to 14 m/s takes about 0.6 s). 18 and 20
  were tried on five tracks, two seeds each: laps within noise, no falls
  either way, so it stays at 16.
- **Hop and drift.** `drift` rising at over 10 m/s with |steer| > 0.3 hops
  (0.25 s, up to 0.35 m) into a drift that way: a power-slide. The way the
  kart goes turns at 0.9 + 0.5 × own of a full turn (own: the wheel into the
  drift 1, straight 0, against it -1: 0.4..1.4), and its nose swings out to
  0.42 + 0.16 × own radians inside that (15°..33°), most of the way within the
  hop; it keeps 97% of the top speed; ice lets it slide on instead of coming
  round. Charge builds faster the tighter it turns: level 1 (blue) at 1.0 s,
  level 2 (orange) at 2.1 s, level 3 (the hottest) at 3.4 s of a middling
  turn. `drift` falling, a brake, or the wheel held at own ≤ -0.8 for 0.25 s
  (the way out of a slide toward the other side of the road) ends it: boosts
  of 0.7, 1.3 and 1.9 s. The wheel's brake comes with `slide` (its open
  hands): at over 10 m/s with |steer| > 0.3, or in a drift or its hop, it is
  `drift` held with the throttle down instead of a brake, so a brake into a
  bend slides and the hands closing let go; going straight or slower it
  brakes. Keys and pads never slide.
  Off the road the charge does not build. Let go, the nose comes back to the
  way the kart goes within a quarter of a second.
- **Hills.** Gravity pulls 9 m/s² per unit of grade along the road (from
  `TrackGeometry` heights, read over 2 m either side): a 10% climb settles at
  about 22.8 m/s. Downhill the top speed rises by 1.1 × the steepest descent
  of the last 22 m, so a kart carries what it gathered out of the dip.
- **Crests.** Where the road bows over a crest faster than gravity (12.5
  m/s²) can follow it down (the speed squared times its curvature over 1.08
  times gravity), the kart leaves it: a skim that stays driveable until it is
  0.3 m up, then a jump (`jump` with `crest`), tricks and all.
- **Slipstream.** 2 to 14 m behind another kart, within 1.8 m of its line,
  both over 14 m/s and going the same way (within 0.5 rad): the top speed is
  3% higher and after 1.5 s in the wake the kart is flung out with a 0.7 s
  boost (`boost` with source `draft`), then rests 2.5 s before a wake charges
  it again; `KartView.draft` is the charge.
- **Boost.** Top speed +35% and strong acceleration while it lasts. Nitro
  1.5 s, a pad 1.0 s, a start boost 1.0 s.
- **Start.** The countdown is 3 s plus half a second of "ready". Throttle
  rising from 0 to 1 in the last second before Go (while the lights say 1)
  gives the start boost; throttle held since before 1.2 s floods the engine
  (no drive for 0.6 s after Go). Bots get a start boost by skill. (The window
  is a whole second because hands closed as the 1 comes up reach the sim about
  0.8 s before Go, after the fist's 0.12 s hold and the camera.)
- **Karts touch.** Circles of radius 1.1 m push apart, the faster one
  shoving harder (restitution 0.6); a shove off a kart's middle turns it (one
  clipped at the tail swings its nose the other way, up to 0.2 rad); a
  `bump` event.
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
- **Bots** (`bots.ts`, `temperament.ts`, `variety.ts`, `racecraft.ts`; their
  numbers in `tuning.ts` `bots`). A bot is only another source of
  `DriveInput`. It follows a racing line (inside of each bend by its
  curvature) plus a lane of its own that wanders across the road, slows before
  a bend to `sqrt(a / |curvature|)` with a lookahead, and drifts long bends.
  `skill` 0..1 scales top speed (0.92..1.0), reactions and mistakes.
  - *Temperament*, beside skill: **aggressive** (dives up the inside, brakes
    late, leans on a kart alongside, holds a Puck for a clean shot, waits for a
    crowd round the leader with a Skyrocket), **careful** (clean, narrow lines,
    covers the inside, rarely errs, saves a Nitro for a long straight) or
    **erratic** (wide, changing lines, big braking-point swings, twice the
    mistakes, the odd verge cut with only a drift's boost). The bots of a grid
    are ranked by a hash of name and driver and dealt the three in turn, so
    every grid of three or more has all three and a bot keeps its temperament
    through a cup. A person's kart the bots drive (handed over, or on its lap
    of honour) is **steady**.
  - *No two laps alike.* The track's bends are listed once (`plan.ts`
    `corners`); each time round each bend a bot rolls (a hash of the seed, the
    kart, the bend and the lap: nothing new in the snapshot, and the same race
    replays) how deep it cuts in, where it brakes (±2 to ±12 m by temperament),
    how much speed it carries (±2%), whether it drifts, and whether it makes a
    mistake: running wide on the way out (to just short of the edge, half a
    metre over it for the erratic, half as far out of a hairpin), braking late
    and carrying too much speed, missing the apex, or letting a drift go
    before it charges. Now and then a wobble on a straight. None of it beside
    an open edge or on ice. Mistakes per bend: 11% at skill 0, a quarter of
    that at skill 1, times 0.35 (careful), 1 (aggressive) or 1.8 (erratic).
    In a slide it steers by the way it is going (`courseOf`), and a slide
    carrying it wide it saves by holding the wheel hard against it, which
    straightens the kart out. From skill 0.5 it may shake the wheel at a trick ramp's
    lip to kick the jump (its skill times 1 aggressive, 0.9 erratic, 0.5
    careful), and tricks in the air by skill otherwise.
  - *Racecraft* against every kart, bot or person: catching one, it picks a
    side (the inside of a bend coming up, else the side with room) and keeps to
    it once committed; on a straight at much the same pace it first tucks into
    the other's wake (`draft`) and goes by when the slingshot flings it out;
    boxed in, it lifts and drops in behind, never ramming (it
    closes on a tail at a nudge's 1.5 m/s, 3 for the aggressive). It covers the
    inside of the next bend from a kart close behind (careful always), but not
    once that kart is alongside; it leans on a kart beside it in a level fight
    (aggressive often); and it swerves from a Puck it sees coming (always, when
    sharp).
  - *Items with intent*: a Nitro out of a bend onto a straight or on a long
    straight (to finish a pass, for the bold); a Puck only with a kart lined up
    and the road straight between; a Seeker at once, or (careful) with the kart
    ahead within 150 m; a Slick or Decoy kept in hand until a kart is close on
    its tail and in line (a lone leader holds it); a Comet on a straight, or to
    be untouchable when something is coming for it; a Blast when a skyrocket,
    puck or seeker is about to hit, or with karts all round (one is enough for
    the aggressive); and anything else used after 14 s at the latest (22 s for
    the aggressive, 8 s for the erratic).
  - *Pack.* A gentle rubber band, never past the road's top speed: a bot
    more than 5 m ahead of the best player eases off by up to 10% (5% for a
    sharp one, so the quick ones stay worth beating) at 95 m; one more than
    5 m behind pushes up to 6% but no faster than a kart's top speed,
    and corners as if half as skilful again; well ahead of the player a bot
    also makes more mistakes, well behind fewer.
    `packStats.ts` races the bots and a scripted player (`PACK_REPORT=1 npx
    vitest run src/kart/sim/pack.test.ts --silent=false` prints a table).
- **The race's end** as in "A race" above. `result()` gives the standings.

`snapshot()` is plain JSON and small (round numbers to millimetres and
milliradians; under 3 KB for eight karts). `predict(karts, inputs)` steps
only those karts' physics against the world as it is.

**What a step costs.** Measured in Node on the M4 Max with `process.cpuUsage`, not the clock: eight karts (four of them
people's, handed to the bots to drive), a race of 5,400 ticks on each track, every second of it taken at the least of three
runs (a busy machine only ever adds time to work that is the same every run), medians of three alternating processes, this
checkout and the one before it. The machine's load moved the figures by up to a factor of two between half hours, so read
each pair and not the column. A tick of eight karts takes 20 to 36 µs on Meadow Loop, which has no hazards, and 50 to 58 µs on
the tracks that do (24 to 34 when the machine was quiet): under 0.4% of a frame. `view()` is 2 to 4 µs, `snapshot()` 2 to 9,
`result()` 0.1. The garbage a tick is counted by the scavenges of a 1 MB young generation (a scavenge, a megabyte), over
6,000 ticks.

| track | µs a tick before → after | KB of garbage a tick before → after |
| --- | --- | --- |
| Meadow Loop (no hazards) | 33 → 36 | 44 → 44 |
| Kitchen Rally | 128 → 55 | 249 → 62 |
| Harbour Lights | 73 → 58 | 142 → 66 |
| Canyon Run | 95 → 54 | 201 → 71 |
| Fun Fair | 124 → 58 | 195 → 60 |
| Glacier Pass | 129 → 56 | 253 → 63 |
| Volcano Rush | 190 → 58 | 303 → 65 |
| Starlight Ribbon | 123 → 57 | 138 → 56 |
| Five Finger Circuit | 132 → 50 | 234 → 73 |

- *The hazard dodge* (`bots.ts`) was the whole of the difference. Each tick a bot asks whether a hazard is coming and, if the
  way is not clear, tries 44 places across the road (four speeds, eleven shifts), 2.6 s ahead in steps of 0.15 s, asking
  each time where each hazard will be and where the road is. But where a hazard is, is the same for every bot and every
  place it tries, and the road ahead is the same for every shift at one speed. So each hazard's poses are worked out once a
  tick, when the first bot looks at it (`hazardPoses`), the road once for each speed (`roadAhead`, read without making a
  track sample; `bots.test.ts` holds it exactly equal to `TrackGeometry.at`), and a hazard plainly out of reach is not
  measured with a square root. The garbage fell furthest, since a try was made of small objects (a pose of a dozen
  numbers, a sample of ten, a point of three). It is exact: a whole race on each of the nine tracks, a hash of each second's
  snapshot, every event and the last view and result, ends the same as before.
- *Planning that could be done once a lap.* The plan of a track (its bends, the speeds it allows, the lines) is built once
  and kept (`planFor`). What a bot rolls for a bend each lap (`takeOf`: how deep it cuts, where it brakes, whether it
  makes a mistake) is a handful of hashes, worked out again every tick for the bend the kart is in and those its aim
  is in; with `bendNear` it is 6% of a step, a microsecond or two, and not cached.
- *Not done, measured.* The rest of a step is the physics and the 81-sample search for where each kart is on the road
  (`project`, a tenth of a step, in the geometry); Meadow Loop's 44 KB a tick of garbage is the bots' per-tick objects (the
  input handed to the kart, the bends it is near and how it takes them, the fight), 2.6 MB a second at 60 Hz.

## Net (`src/kart/net/`)

- **Transport.** One interface, three makers: PeerJS (WebRTC data channels;
  the default), BroadcastChannel (`?net=local`: several tabs of one browser,
  for development and the end-to-end tests), and an in-memory pair with
  latency, jitter and loss for unit tests. Each peer link has a reliable
  ordered channel (lobby, start, events, results) and an unreliable unordered
  one (inputs, snapshots). Over PeerJS they share one WebRTC connection: a
  guest opens one PeerJS connection (reliable), and both ends add a
  negotiated channel to it (id 7, `ordered: false`, `maxRetransmits: 0`), so
  nothing stale is ever resent and there is one path through the routers to
  find, not two. A guest of the old shape (two connections, protocol 6) gets
  far enough to be told the version is wrong.
- **Signalling.** PeerJS's public broker by default, configurable with
  `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_KEY` to
  run one's own. The broker sees only that two browsers want to talk.
- **The relay.** Devices that cannot reach each other directly (different
  networks, a strict router) meet through Cloudflare's TURN relay. A room asks
  the site's `api/ice.json` (`api/ice.js`: a Vercel function, or on
  Cloudflare behind `cloudflare/worker.js`) for its ICE servers while PeerJS
  loads; the function holds the TURN key (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`:
  Vercel's settings or the Worker's secrets), answers only the game's own pages
  (by Origin: its own address, or one it lists), and hands out a login that lapses after a
  day, less the port-53 addresses browsers block. `net/ice.ts` keeps an answer
  for half its life and falls back to STUN alone (a dev server, offline, no
  key, slower than 4 s), which still connects one Wi-Fi. Only relayed pairs
  cost anything (about 32 KB/s to each relayed guest, ~6 MB a three-minute
  race), and Cloudflare's first 1,000 GB are free. The lobby's hint and the
  network troubles say "anywhere" or "the same Wi-Fi" by whether this page
  got a relay (`relayReady`). `?relay=only` connects through the relay or not
  at all, to try it on one computer.
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
  between two snapshots; more when snapshots arrive unevenly (`LagMeter` in
  `view.ts`: enough to cover nine arrivals in ten of the last three seconds,
  250 ms at most, rising at once and easing back). On one Wi-Fi it stays at
  70 ms; on a line 75 ms away with 90 ms of jitter the guest drew a guessed
  (carried-on) picture in 1% of frames at a steady 70 ms and in none with it,
  and on 100 ms with 150 ms of jitter, 5-9% against none. Its own karts are predicted: on each snapshot,
  `restore` it, replay the inputs the host has not yet applied with
  `predict`, and ease any visible jump out over 100 ms. Ping every second; the
  round trip shows in `link.rtt`.
- **Who leaves.** The host leaving ends the room for everyone ("The host left
  the race."). A guest leaving: their karts become bots for the rest of the
  race and their slots free up in the lobby. A fifth player is turned away
  ("This race is full.").
- **Solo.** `soloSession` is the host without a transport.
- **Finish-line photos** (`sharePhoto`, `onPhoto` on the `Session`). A
  device holds its players' photos until the race is decided: the host sends
  its own (and any that came early) with the results, a guest sends its own
  when it hears the results, and the host passes each on to every device but
  the one it came from at once. So nothing the size of a photo goes over the
  line while anyone is still racing (a reliable message that large would hold
  up the snapshots behind it). A photo is a JPEG data URL of at most
  `MAX_PHOTO_CHARS` (48,000 characters, about 36 KB; a typical one is 15 to 30
  KB), and both ends drop anything else (`isPhoto`: base64 after
  `data:image/jpeg;base64,`, nothing more), any kart the sender does not drive,
  any race but this one, and a second photo of a kart. They are kept for one
  race, in memory, and a new race (a restart too) starts with none.
- **The wire** (protocol 8; 7 changed only how devices connect, 8 added the
  `photo` message both ways). A snapshot is one JSON line, about 1.1 KB for
  eight karts: the tick, the dice, the items in the air, the eggs, and the
  kart table, 54 numbers a kart (where it is and how fast, drift, boost, item,
  lap, the bot's own state...). A kart's row is mostly zeros and what the kart
  before it has, so the table goes as its first row against zeros and each
  row after as what differs from the row before it: a word of bits for every
  30 fields, then the values of the fields that have a bit (`packState`,
  `unpackState` in `protocol.ts`; the host writes it once for all guests). A
  guest rebuilds the table exactly as it would have come whole (`sim.test.ts`
  restores a race from each and runs the two on together); a table that does
  not add up is dropped like a lost snapshot. A guest of another protocol is
  refused, as before.

**What the net costs** (2026-11-01). Measured on the real sim over the
in-memory network: four devices with a player each and four bots (eight karts,
the most a race holds), 20 s of racing over a line of 20 ms with 8 ms of
jitter, every message counted at the link. "Before" is main at e18a55e, run
alternately with this branch on a machine at a load average of 100 to 1000, so
times are medians of six alternating runs (ranges in brackets) and allocations
of three; bytes are exact and are the numbers to trust.

| | before → after |
| --- | --- |
| a snapshot, 8 karts / 4 karts (bytes) | 1643 → 1080 / 883 → 592 |
| host to each guest (KB/s; 30 snapshots and 2.5 other messages a second) | 49.3 → 32.4 |
| host to three guests (KB/s) | 148.4 → 97.7 |
| a guest to the host, one player (KB/s; 61 messages a second) | 7.5 → 7.5 |
| a guest taking a snapshot: decode, unpack, restore, replay, picture (µs) | 45.5 → 33.5 (39-106 → 31-58) |
| restoring one in the guest's race, alone (µs) | 12.5 → 6.5 |
| a guest's frame: prediction and picture (µs) | 16.5 → 14.0 |
| a guest's frame, allocated (KB) | 36.6 → 24.1 |
| a blend of two pictures, allocated (KB) | 9.6 → 4.3 |
| asking which karts a screen draws, allocated (bytes) | 2137 → 81 |
| garbage collections in 20 s of the whole room | 39 → 34 |

- **What grows.** A snapshot is about 104 bytes and 122 a kart (123 and 190
  before): the host's upload is guests × karts × 30 a second, and nothing else
  in the net grows with either. A guest sends the same 7.5 KB a second whatever
  the room (18.9 with three players on one device). The playtest pass's five
  new numbers a kart (49 → 54) added 5% to a snapshot (1560 → 1643 bytes, before
  it was packed); the wheel's slide rides in a bit of the drift number and added
  nothing.
- **Time is small.** The net's share of a host frame is about 1.3 ms a second
  (it was 1.5), on top of the sim's 3.6; a guest spends about 2 ms a second
  (it was 2.6). What the net made was garbage: the host and each guest kept a
  copy of every picture the sim built, a blend made two `Map`s and a copy of
  every item box each frame, the app asked which karts it draws several times a
  frame, and a snapshot was read field by field by name. Now a picture is kept
  as the sim built it (`pictureOf`, which `sim.test.ts` holds the sim to);
  `blendViews` returns what did not move and looks ids up only when the lists
  do not line up; a guest asks its own copy of the race for its picture once
  after it changes; a session works out `views()` once for each lobby
  (`ScreenKarts`); and `unpackKart` reads by index. Packing the table adds a
  little garbage back (5 KB a snapshot in the guest). Every view of every
  device was byte for byte what it was in nine seeded rooms (loss, 30 and
  144 Hz, three players on a guest, a guest leaving, a pause, a restart), and
  every message was too until the table was packed.
- **Left alone.** Halving the inputs to 30 packets a second would halve their
  bytes and messages and delay a guest's input by half a tick on average at the
  host: it changes the race. A snapshot against the last one a guest has
  acknowledged would take about half again off the table, but needs
  acknowledgements, a snapshot of its own for each guest and a full one when the
  base is lost; the rest of the table is positions to the millimetre that change
  every tick. Not ours: `Race.view()` builds all eight karts (8 KB a tick) to
  give a guest the pose of its own, so a `pose(kart)` on the race would save most
  of that; and a restore pays `TrackGeometry.at` (2 KB), the eggs' `every` and
  `updatePlaces`' sort (1 KB) in the sim.

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
- **Gestures** as in "How it plays": both open for 150 ms → brake, with
  `slide` (the sim drifts on it in a bend at speed: the wheel's
  only drift, so it never sets `drift`); one open
  then closed within 0.6 s with the other a fist all along → one item press.
- **Shakes** (`shake.ts`): the wheel's angle swinging back 14° the other way
  twice within 0.55 s (no second for 0.35 s) → `shakes` +1, a count like the
  item presses (on the wire too). Not while braking, clapping or cheering.
  Keys: the arrows from one to the other and back; a pad: the stick or
  d-pad likewise. The sim uses a shake only in the air (a trick) or within
  0.3 s before a lip (a kick), so the steering of a slalom does nothing.
- **Tricks** (`gestures.ts`, in hand lengths, a hand's span being twice the
  wrist-to-knuckle size): a **clap** (palms from at least one hand length
  apart to within 0.6 and back to 0.9 inside half a second, not from a brake
  and not with the wheel near full lock) → `horn` +1, at most one in 0.4 s;
  **both open hands** two hand lengths above where the wheel is usually held
  (learnt from the fists), held 0.3 s → `emote: "cheer"` while they stay up;
  **one open hand** turning round twice in a second, the other a fist or down
  → `emote: "wave"`. While palms are together or a cheer is on, the wheel
  does not brake or flick an item. Keys: H honks, C and V hold cheer
  and wave; a gamepad's Y honks.
- **Hands near the edge** (`edges.ts`). A player leaning into a bend or
  shifting in their chair drifts toward the side of the camera's view (or,
  several on one camera, toward a neighbour's column) and loses a hand
  before they know it. `WheelStatus.edge` says which way to move back in, as
  the player sees themself (a fist near the right of the mirrored picture:
  "left"), when a palm is within 1.3 hand sizes (and at least 0.06 picture
  heights) of its zone's edge, or a hand last seen there went out within
  1.5 s; nothing while a clap or a cheer has the hands about. The race
  (`edgeHint.ts`) shows it once it has held 250 ms and keeps it 600 ms after
  the hands are back, in the player's viewport where "Show Both Hands" goes
  (an amber arrow: "Move Left", "Move Right", "Lower Your Hands", "Raise
  Your Hands"), and gives way to "Show Both Hands" once the hands are lost.
  It is this device's: a big screen is told only of lost hands.
- **The finish-line photo** (`photo.ts`). `grabPhoto` draws the camera's
  current frame into a small canvas at once (about what the corner picture
  costs a frame), mirrored as the player sees themself, and `encodePhoto` makes
  it a JPEG afterwards with `toBlob`, off the race's frame: quality 0.8, then
  0.66 and 0.52, then smaller, until it is under `MAX_PHOTO_CHARS`. What is cut
  (`photoCrop`): the player's column of a shared camera (their `Seat`), else
  the whole picture; a part narrower than 3:4 (three or four on one camera) is
  cut to 3:4 with the player's hands 62% of the way down it, so their face is
  in it (from a little above the middle with no hands seen), and one wider
  than 16:9 to 16:9 round the hands. The size (`photoSize`): the longest side
  at most 480 px and at most 140,000 pixels (480 x 270 for a 16:9 camera).
  `Services.photo(control)` grabs one for a wheel, with the hands the wheel
  sees, as a `Still` that is encoded only if it is the one kept; it is null
  for keys and pads. `WheelStatus.emote` says when the hands cheer or wave, so
  the photo can be the one that caught it.
- **`WheelPreview`.** A canvas that draws the mirrored camera picture with
  the wheel on it: a ring through both palms turned with them, its colour the
  mode (green driving, amber braking, red lost), each hand a dot that is
  filled for a fist and hollow when open. Small in a corner during the race,
  large on the wheel check and on a big-screen player's own device.
- **The dev page** `src/kart/input/dev.html`: the camera, the preview, and the
  numbers (angle, steer, grip, mode, drift, item presses, shakes, frame rate), with
  the Steering setting. The first thing to try with real hands.
- **What reading the hands costs the page** (2026-11-01, after the playtest pass, the
  sound pass and the open-hand drift; `tools/perf/input.mjs` for the page's JavaScript
  in node, `tracking.mjs` for the page in Chrome). The page's side
  of reading is small, and none of it was the open-hand drift's or the sound's: the
  wheel reader alone, four players, cost 1.64 ms of CPU a second of play at dc83280, the
  commit before them, and 1.32 at main (medians of five alternating rounds), and
  allocated 1863 and 1827 KB a second. Handing a camera frame to the workers
  (`LaneTracker.read`) is 0.1 ms of the page thread at one to four players (a
  `VideoFrame` cut to each column with `visibleRect`, no copy), and no frame is left open:
  `tools/perf/frames.mjs` counts the ones a page and its workers leave open (a frame
  garbage collected unclosed is only a console warning, too late and too rare to count
  on), and found none in a run of two players, while a worker made to leave its frames
  open showed 378 in the same twenty seconds. What did grow with the players, and with their
  square, was everything after it: each worker's answer was put back in place in the
  picture with every other column's last answer (an object for every landmark of every
  hand, again, each time), and every player's wheel was handed every published frame and
  worked out the fingers of all the hands in it, the other players' too. Now an answer is
  placed once, when it comes (`placeHands`, `joinPlaced`), the columns are worked out when
  the picture's size changes, a reader looks at where a hand's palm is before anything
  else and reads the fingers and size of its own two (`readPalm`, `finishReading`), and the
  sim's sample and the screens' status each build only what they hand back
  (`WheelReader.input`, `status`). Page thread CPU and garbage a second of play, the
  tracker, the wheels, the sim's 60 samples and a status a frame (`input.mjs --against`,
  medians of seven alternating rounds; the numbers of a busy machine, trust the ratios):

  | players | before | after |
  | --- | --- | --- |
  | 1 | 0.83 ms, 560 KB | 0.48 ms, 523 KB |
  | 2 | 1.68 ms, 1538 KB | 1.88 ms, 1112 KB |
  | 3 | 4.07 ms, 3302 KB | 2.88 ms, 1899 KB |
  | 4 | 8.11 ms, 7062 KB | 4.46 ms, 3263 KB |

  (The milliseconds of one and two players are within the noise: the same two players read
  1.72 and 1.55 ms with the sim's samples and statuses left out. The garbage is not.)

  Just as before: random plays of one to four players (fists, open hands, item
  flicks, claps, cheers, shakes, hands lost and found, strangers, misses; 56 plays of
  twelve seconds) through the tracker, the wheels and the sim's samples give the same
  published frames, inputs, statuses and finger counts to the last digit
  (`input.mjs --same`). In Chrome, with a camera picture, the wheels and their corner
  pictures drawn as a race draws them (`tracking.mjs --bases --wheels`, medians of three
  alternating rounds), the page thread is 51.4 and 51.3 ms of CPU a second for one
  player, 60.4 and 60.7 for two, 78.3 and 76.6 for three, 77.8 and 76.3 for four: the
  saving is smaller than the pictures and the test page's own painting, and the reads a
  second, the landmarker's time and the delay behind the camera did not move (for four,
  15.6 and 15.9 reads a second, 45.9 and 47.3 ms, 59 and 60 ms).
  Measured and left: a corner picture costs about 0.5 ms of CPU every time it is drawn
  (the camera's 1080p frame into a small canvas is nearly all of it; the 2D drawing on top
  is under a tenth), 28 ms a second at 60 draws; drawing every other frame took 68 to 62
  ms of the page thread for four players, but for three or four players the shared
  picture's wheels change on almost every frame (a column is published for each worker's
  answer, up to 120 a second), so only the camera's part could be skipped, and for one or
  two it is under 1% of a core. `Math.hypot` still allocates a number on every call (14%
  of what is left); `Math.sqrt` of the squares is not the same to the last bit, and the
  reading must stay what it was.

## Render (`src/kart/render/`)

Bright, clean, low-poly toys in strong sunlight: flat-shaded karts, soft
gradients, saturated but not garish. Every model is built in code behind a
small factory, and the Blender-made glTF from `art/kart/` replaces it where
that file exists (`render/art.ts`).

- **The world** from `TrackGeometry`: the road ribbon (with the height),
  kerbs striped on the outside of tight bends, a chequered start line under
  a gantry, the verge, the ground beyond (grass, sand, quay by theme), the
  barriers 6 m beyond each edge (tyre walls, fences, bollards by theme),
  boost pads (animated chevrons), item boxes (turning translucent cubes with a
  glowing emblem), scenery instanced well clear of the road (trees, rocks,
  cacti, lamps, cranes by theme), a sky dome and fog. The scenery and the
  grass tufts are kept out by the sim's own barrier, measured from each
  stretch of road (`world/clearance.ts`; the terrain grid's interpolated
  guess at it was out by a verge's width where a verge ends), every instance
  with its whole footprint at the size it is drawn; and whatever stands on
  the ground stands on the lowest ground under its own footing, so nothing
  hangs over a slope (a thing that would sink deeper than its height, on a
  cliff's lip, is left out).
- **Karts.** Chassis, four wheels turning with the speed and the front two
  with the steer, the driver (one of nine creatures, modelled in Blender, `art/kart/drivers/`,
  and posed by `render/drivers/`, whose code-built creatures stand in when the
  file is missing; each in a helmet, goggles or scarf in the kart's colour) leaning into turns
  with its hands on the wheel as it turns; cheering or waving with the player's
  gesture, bouncing at the finish, dizzy in a spin-out; the golden kart has a
  gold tub with the player's colour on its stripe, spoiler and hubs; body roll
  from how hard it corners (the heading's turn rate times the speed), pitch
  from the slope, the throttle and the brake, the nose following a jump's arc,
  the springs squashing on a landing as hard as it came down and bouncing
  back, a wobble as a drift starts (the body rocks out toward the outside of
  the bend on a roll spring of its own, about 0.075 rad at the first swing,
  then back two or three times, still within 0.65 s), a light tremble when
  slow or waiting on the grid (0.0045 rad of pitch and 0.0035 of roll at about
  72 to 86 rad/s, each kart out of step with the next, full below 1.5 m/s and
  gone by 4.5 m/s where the rough road's shake takes over; its phase is stepped
  so no frame turns through more than 1.9 rad of it, which keeps it a buzz at
  30 fps; none of this for Reduce Motion), a whole flat turn in the air for a
  trick; a blob shadow
  (`render/kart.ts`). **Three bodies and a livery** (`kartArt.ts`, `livery.ts`,
  `art/kart/karts/build.py`). A driver's weight class picks the kart: the light
  drivers (Bun, Pepper, Moss) a nimble open buggy (`kart.body.light`: a slim tub
  on a painted roll cage with a dash arch, side rails and braces, a bare engine
  with cooling fins and an air filter, an aerial with a pennant, a small nose
  with one round lamp, springs out in the open, eight-spoke wheels), the middle
  drivers (Kit, Juniper, Mango, Dabble) the classic sprint kart (`kart.body`, also
  named `kart.body.middle`: rounded tub, wing on curved struts, chrome bumpers,
  coil springs on the front dampers), the heavy drivers (Bramble, Rivet) a wide
  muscle kart (`kart.body.heavy`: flared fenders over all four wheels, a hood
  scoop, a grille and a deep bumper bar, twin stacks and big pipes, a ducktail
  wing, a thick roll hoop, deep-dish wheels with lug nuts: `kart.wheel.heavy`). The
  hubs, the exhaust mouths and the number plate are the same on all three, so the
  wheels, the flames, the skid marks and the collisions do not change; a file
  without the class bodies gives the sprint kart to everyone. Each driver's kart
  also wears a **livery**: a pattern in a second colour on the flanks and the hood
  (`kart.livery.<class>.<pattern>`, material "livery": spots Bun, waves Pepper,
  tiger stripes Moss, flames Kit, diamonds Juniper, lightning Mango, chevrons
  Bramble, checks Rivet, rally stripes Dabble; the pattern and the colour wanted
  are in `characters.ts`). The paint is the player's colour; the pattern's colour
  is the driver's own unless it would vanish into the paint (cream on yellow),
  when it becomes near-black or white; on the golden kart it is cream. The
  pattern is welded into the kart's body geometry when it is made: no draw call,
  no shader. The far kart (34 m and beyond) is the whole kart welded, driver at rest, then thinned by
  vertex clustering on a 0.2 m grid (`render/farLod.ts`, surfaces kept apart so chrome stays chrome and
  paint stays paint): about 2 to 3k triangles against 22k welded, with its own brake-light skin. The coachwork below is placed
  for the sprint kart and moves for the buggy and the muscle kart (`weight` in
  `kartExtras`). **Faces and looks.** The modelled drivers' eyes are 14% bigger
  with a larger glint (`EYE_GROW`), and their brows and mouths are drawn live
  (`drivers/expression.ts`): determined while racing (brows slanted and low,
  a small tight smile), gritted in a hard bend (steer over 0.72: low thick brows
  over a slot of teeth), raised with an O when dizzy, arched over a wide open
  grin with a tongue at a cheer or the finish, relaxed on the grid; a mood is held
  0.22 s before a milder one replaces it, a hit or a cheer shows at once. The
  face is welded onto the head's own geometry (one per mood, made when first
  worn and shared by the species' brow and mouth shapes; the racing face is made when
  the driver is), so it costs no draw call. Every modelled species has a mouth that
  changes: the rabbit, fox, otter, bear, frog and cat draw a smile, a gritted slot,
  an O and an open grin; the penguin and the duck part their beak in a dark gape
  (open a little at the strain, wide when hit, curled at a cheer); the robot's
  screen mouth is lit (dots, a bar, a zigzag, a ring, a smile). The code-built stand-ins keep their own fixed faces. Each driver blinks (`drivers/face.ts`:
  one lid mesh in the face's colour that slides down over the bead eyes, every
  2.2 to 5.4 s, now and then twice, about 0.2 s, each driver at its own
  times; no draw call while the eyes are open) and shuts its eyes in a
  grin, ^ ^, while cheering or after finishing, half shut and heavy when dizzy.
  On the grid (stopped: speed under 2.5 m/s, eased) the driver breathes and the
  head wanders over the track (`KartPose.rest`). A driver with another kart
  2 to 11 m behind, within 3.5 m of its line, at over 6 m/s, glances back over
  that side's shoulder for 0.75 s at most every 3.2 s (`KartPose.lookBack`;
  each actor sees the others through a registry in `kart.ts`, so it needs
  nothing from the sim or the wire, and a driver who asked for less motion
  does not). The **brake lights** (`brakeLights.ts`) are a skin laid over the
  tail lamps (the art's own: the vertices of material "tail"; or the code-built
  kart's two bars) in one shared additive material: they flare, a little larger,
  while the kart's eased deceleration is over 2.2 m/s² (full by 6.5), on the
  ground and above 1.5 m/s, and go out in about 0.1 s (`KartPose.brake`, worked
  out from the speed falling in `KartActor`). One extra draw call for a kart
  while it brakes, none otherwise. **Coachwork** (`kartExtras.ts`): each driver's
  kart carries its own touches welded into the body geometry (no draw calls): a
  cotton-tail puff and carrot fins (Bun), a dorsal fin (Pepper), bulging eyes on
  the bonnet (Moss), twin swept fins (Kit), a surfboard (Juniper), ears and
  whiskers (Mango), a roll hoop and bull bar (Bramble), an aerial and dish
  (Rivet), a bill and tail feathers (Dabble); the golden kart wears a crown. The
  turntable (`render/dev.html?turntable=1`) shows them: `&brake=1`, `&back=1`,
  `&shut=1`, `&rest=1` pose the new looks. Up a ramp the kart stands on the picture's wedge; off
  the lip it rides the sim's height, which starts at the wedge's top, so the
  two meet without a step. Effects:
  drift sparks (blue, then orange, then violet for the third charge, the charge
  glowing and pulsing at the rear wheels), boost flames (long, flickering, a
  flash at the pipes as a boost catches), streaks of wind rushing past a
  watched kart along its course from about 21 m/s, drawn in closer and thicker
  in a slipstream as it charges, and many more on a boost (none for Reduce
  Motion), small soft grey puffs from both exhausts every 0.13 to 0.2 s while a
  grounded kart is under 8 m/s and not boosting (waiting on the grid, pulling
  away; the karts no view follows puff from one pipe at a time, so half as
  many), dust off the road, a spin, a
  hop, a puff on a bump. The karts the views follow get the full show; the rest
  of the pack throws fewer sparks and flames (`Effects.focus`), so a pack
  drifting round a hairpin does not use up the particles of the karts watched.
- **Things.** The puck, the seeker (with a red glow and a fin), the slick (a
  glossy dark puddle).
- **Split screen.** One kart: the whole canvas. Two: top and bottom on a wide
  screen, side by side on a tall one. Three or four: quadrants; with three,
  the fourth shows the map and the standings. One renderer, one scene, a
  scissored viewport and chase camera per view.
- **Chase camera** (`render/cameras.ts`). Behind and above, eased, following
  the way the kart goes (`KartView.course`; a spun kart does not whirl it), and
  alive: it leans into a bend with the wheel (in a drift, with the drift's side,
  whatever the wheel), and tilts with a banked road as seen along its own
  heading (`bankSeen`; together at most 9 degrees); it sits lower behind a
  climb and aims up it, higher on a descent and aims down over a crest (the
  road's heights behind and ahead from `TrackGeometry`, a ramp's wedge among
  them: `rampSeen` holds the lip's height for 18 m past it, so the camera aims
  up the wedge at the jump, and `cameraSpace` keeps it out of the wedge); it
  aims a little into the bend ahead (the road's turn over the next 14 to 24 m);
  in a drift it sits 60% of the way from the nose to the course and moves out
  to the side of the slide, so the slide shows; off a jump it rises and pulls
  back to see the landing, and lands with a sprung dip as hard as the sim's
  `land` strength (the camera's own eye on the kart's height is the fallback;
  the two count once). Knocks shake it (bumps and walls by their strength,
  hits, strikes), landings too, rough ground rumbles it; the field of view
  widens with speed and boost, with a quick punch as a boost begins and a pop
  on a trick's kick at the lip; on a boost and flat out the outer part of the view streams
  outward from where the kart is heading (the rush, in the post chain). Through
  the countdown it settles from high over the grid. With Reduce Motion it keeps
  only what frames the road: no lean, tilt, shake, thump, punch or rush. Another
  kart within 3.4 m of a view's lens (on its kart's tail) is left out of that
  view, or it would fill the picture.
- **Each viewport's HUD** (HTML over the canvas, DESIGN.md's glass and type):
  place large ("1st", "2nd"…) bottom-right, springing up out of a flash for a
  place won and sinking in for a place lost (at most every 0.35 s: karts side
  by side swap places back and forth), lap ("Lap 2/3") and time
  top-left, the item in a glass slot top-centre (turning through the items
  while it rolls), "Final Lap", "Wrong Way", the countdown in the centre, the
  place on finishing. The final lap is orange (attention, not alarm): the lap
  in its panel all the way round, the banner, which pops in, and the view's
  edges, which glow twice as it begins. A minimap (the track's outline, a dot per kart, players
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

## Sound (`src/kart/audio/`, `src/audio/cues/kart*.ts`)

Every sound is synthesised in code when the race loads (the `kart` pack: three takes of each, made in workers),
nothing is sampled. `RaceAudio` (`race-audio.ts`) runs one race screen: it turns each `RaceEvent` into its sounds
(`events.ts`, a pure table), runs the loops that follow the karts' state (`engines.ts`, pure functions of a
`KartView`), plays the track's place (`ambience.ts`) and the music (`music/`). Each loop is started when it is first
heard and let go after half a second of silence, and is told only what has moved since it was last told.

- **Engines.** Four, by the driver: a light kart's buzzing two-stroke, a middleweight's punchy twin (one stroke hard
  and its partner half as hard), a heavy kart's V-twin (two firings a cycle, unevenly spaced: its lope), and Rivet the
  robot's electric motor. None is an oscillator with a filter on it; each is built the way the machine makes its sound
  (`src/audio/cues/kart-engines.ts`). Every firing is a push of gas (a pulse with a hard edge and a longer tail) that
  thumps (its low-passed push, the sub a kart's chest hears), strikes the exhaust pipe (a waveguide closed at one end,
  `pipeResonance` in `src/audio/dsp/resonators.ts`, ringing at its tube frequency and the odd multiples of it, then
  coloured by three or four formants of the body and the muffler), throws a puff of turbulent gas out of the mouth, and
  half a cycle later the intake draws and roars and the valves tick. Under it all runs the engine's periodic part as a
  full harmonic series (every multiple of the note, shaped by the same resonances, swelling and dipping with the
  firings' strength). No two firings are alike: their timing wanders, their strength spreads lognormally and breathes
  over a few cycles, and now and then one is weak. The two ears share the firings (so the low end is one engine in the
  middle and the sum to mono loses under 1.2 dB) but have their own pipe tuning, gas and intake noise and upper partials:
  a twin-outlet exhaust, wide above a few hundred hertz. Each engine is made in three rev bands (low, middle and high,
  made at revs 0.8, 1.2 and 1.8; `ENGINE_LAYERS`, `REV_LO`, `REV_MID`, `REV_HI`), so a loop is never played more than
  about a quarter from where it was made, its pipe's resonances stay where an exhaust would have them instead of
  sliding with the pitch, and the three cross over (`layerMix`, equal power: at most two sound at once). The motor is
  additive (the rotor's poles, the windings' and gears' whine, the drive's switching shimmer, a second rotor a whisker
  off beating at a different rate in each ear). The revs run from 0.64 just moving to about 1.75 at top speed; a boost
  adds 8 %, the air 20 % (the wheels spin free), a drift 3 %; off the road they fall 5 % and in a spin-out 25 %. How
  hard the engine works is the kart's acceleration and the climb under it: working, it sings higher, louder and
  rougher (the load layer, `kart_engine_grit`: a burst of gas on every firing, an intake resonance in each ear, the
  chain's and valves' rattle, a spit now and then, which is where "on throttle" brightens an engine); lifting off or
  rolling downhill it softens, and lifting off hard after pulling at high revs, the exhaust crackles (`kart_backfire`:
  seven to ten pops thinning out, each a thump, a crack and the pipe's ring, scattered across the field; at most once in
  2.5 s; not the motor's). Near a standstill the idle takes over (a lumpy put-put through the same pipe, thirteen thumps
  a second in a pattern that never repeats; the motor hums). A boost's growl (a deeper engine with flame in its throat)
  roars under it. Each note wavers a little, as an engine never holds one quite still. The revs run through four gears
  (`gearFactor`, a pure function of speed): ±6 % through a gear, a dip of about two semitones at each change, fading to
  nothing standing still, at top speed and in the air; each change up under power barks (`kart_shift`: the clutch's
  clunk, the revs cut, a rasp as the next gear takes the load; `gearIndex`, also a pure function of speed; not for the
  motor, not coasting, at most one in 0.4 s). In the last second before Go the whole grid blips its throttle
  (`gridFlare`: revs up by three quarters, the idle handing over to the engine, gone at Go).
- **Other karts.** Every local kart's engine and the nearest others' (at most four others, six karts in all), heard
  from the nearest local kart: louder close (to nothing at 70 m, the engine's distance roll-off and air on top), the
  nearest standing out of the pack (each further one stepped down), to the side it lies on (a kart 3.5 m to one side
  is half way over), duller when it is behind the listener (`earDistance`: the air's low-pass is given up to 40 % more
  distance, as the kart's own body is in the way), and bent by Doppler from the two karts' velocities, at a third of the
  real speed of sound so that a kart going by at 8 m/s more falls two or three semitones as it passes; one that goes by
  within 6 m at 3 m/s more rushes past (`kart_pass`: a burst of air whose band falls as it goes, different in each ear,
  with a soft pressure bump just after the front passes). The field is mixed, not rendered once for each view: a
  source is heard from the nearest local kart, and each local kart's viewport has its own place in the stereo field (one
  view centred, two left and right, four a 2 x 2), so with split screen the player in the left view hears their own kart
  and everything near it on the left, and a kart that drives from one view's neighbourhood into another's moves across
  the field. Their drift squeals (the three nearest) and events are heard by distance. With more than one player on the
  screen, each player's engine is quieter (two at 0.71 each, four at a half) and their everyday sounds a little (four at
  0.71); what must be heard is not.
- **Ground and contact.** Every loop here is stereo: what is low and heavy is one thing in the middle, what is high and
  grainy is made twice, once for each ear, and pulled towards the middle until the sum to mono loses under 2 dB (the
  tests hold it). The tyres roll on the road (a rumble, the hum of the tread, which rises with speed as the loop plays
  faster, the grain of the surface and the thump of a joint in the road, which comes faster with speed: quiet, growing to
  top speed, gone in the air). Each surface has its own: grass swishes (a swish, a sizzle of blades, stalks snapping,
  the turf's thrum), sand hisses and patters (a rush, 280 tiny grains a second, stones knocking), snow crunches (grains
  with a squeak in some, the fump of the pack giving way), mud squelches (a slosh, wet slaps of the tread pulling out,
  bubbles, a gurgle), ice hisses and creaks (fine crystals, glassy ticks, the lake groaning in a stick-slip glide).
  A drift squeals as a real tyre does: noise through three narrow resonances (not harmonics of each other) whose
  centres wander as the grip comes and goes, shuddering with stick and slip, over the scrub of the tread and a hiss,
  each ear's tyre a hair apart in pitch. Its pitch follows the slip (the speed and how hard the wheel is turned), each
  spark level is a tone and a half higher, and the step is a chirp: reaching a tier bends the squeal up a further 8 %
  that settles over a fifth of a second. From the first spark its sparks fizz under it, a major third higher at each
  level, with ringing glints; let go, the mini-turbo, a step up for each level, and from the third a whoomph and a run
  of glass. A barrier scraped along is a loop that lasts as long as the contact (`kart_scrape`: plastic and metal
  dragging with a flickering grip, the panel ringing at its own pitches, grit under it; the kart's `rub` flag (set by
  the sim on every tick it is pressed on a barrier, a gentle rub included) keeps it going, held a tenth of a second
  across skipped ticks, a hard hit adds its 0.35 s tail, its level follows the speed along the wall; another kart's scrape is still heard as a one-shot).
  The chassis creaks at a hard bump or landing (`kart_creak`, the player's own kart: a short stick-slip groan, falling).
  Bumps, walls and landings by the sim's strength (a hard landing thuds), and by the driver's weight (a light kart's
  land and bump are pitched up to 14 % higher, a heavy kart's down to 16 % lower). The wind (`kart_wind`: a rush that
  swells differently in each ear, a thin whistle, buffeting, a fine hiss) rises with speed and is loudest in the air;
  in another kart's wake the torn air of the slipstream (`kart_draft`: a deep roar with fast buffeting, a ripping band
  sweeping up and down, wide) rises as the draft charges. Not done: a kerb's rumble strip and water's splash (the sim
  reports neither a kerb nor water under a kart; they need a kerb flag and a water ground from the tracks). Spectrograms
  of old against new: `node tools/listen/cues.mjs --label after --shots DIR` (and `--label before --root <old checkout>`).
- **Moments and items (rebuilt from layers).** Nothing here is one oscillator and an envelope: each sound is a
  transient (a click, a thump, a crack), a body (a ring, a roar, a siren) and a tail (an echo, debris, rain), cut from
  the parts in `kart-synth.ts`: FM bells for metal and glass, a kalimba, a plucked string (Karplus-Strong) for the
  twang of a mini-turbo or a slingshot, a brass stab, a stack of detuned saws, noise through a sweeping resonance
  chopped into grains for whooshes with texture, showers of ringing shards, rain, sirens, tweets, and a few filtered
  echoes for a shock wave. Pitched parts sit in C major, as the music does. The recipes are in `kart-items.ts` (the
  box, the roulette and every item), `kart-events.ts` (sparks, boosts, the start), `kart-impacts.ts` (hits, bumps, the
  air, the fall) and `kart-jingles.ts` (the tunes, the crowd, the horns, the interface).
  - *The roulette.* Ticks of a wooden reel (pitch steered by `race-audio.ts`: they climb as the reel slows), the
    ratchet's latch when it stops (`kart_item_ready`), and, with the latch, a chime of the item's own (`chimeOrder`,
    played by `race-audio.ts` when the reel stops, so it always matches the item held): nitro a fifth climbing with a puff of gas, triple nitro three pips and a
    high one, puck two wooden taps, triple puck three climbing, seeker a sonar ping and its echo, slick a wet bubble
    sliding down, comet a run of glass to the top, storm a bell against its tritone over a low tick of thunder, skyrocket
    a whistle and a pop of stars, blast a thump under a wide chord, decoy the right chime a hair flat with a wink. Only
    the player who took the box hears it; the box bursting (a crack, a crunch, shards, a rising sparkle) is heard by all
    near.
  - *Each item.* Nitro: a gas hiss, two sparks, a whump and a jet's roar climbing through a resonance with a
    turbine's whine (the triple's is the same behind a ratchet of three clicks, higher). Puck: a solid thunk and a
    whirring disc; off a barrier a wooden knock and a clear metallic ping. Seeker: a launch and a sonar ping, a loop
    of homing beeps (`kart_seeker`, rate bent by the closing speed and up to a third faster inside 40 m, so the beeps quicken as it closes in), and a three-beep
    lock on the kart it hits. Slick: a gloopy splat with bubbles when dropped and a wet skid under the spin-out when it
    catches someone. Triple puck: three pucks circling the player's own kart hum while it holds them (`kart_orbit`,
    higher for each one fired). Comet: six seconds, lit by a run of bells, then a bed of detuned saws whose filter
    sweeps up every 1.5 s so it keeps rising, kalimba arpeggios and glitter, blinking faster in its last second and a
    half and closed by two bells. Storm: a crack and a buzz, thunder rolling at irregular swells with its echoes, and
    a patter of rain. Skyrocket: fuse crackle, a pop and a roar and a whistle that crosses the sky from the left to the
    right (stereo), a siren for the kart it hunts (`kart_skyrocket_warn`: the leader of the others still racing, if it
    is on this screen), and a burst of falling stars. Blast: a deep boom, a shock wave of air racing out and its echoes
    coming back. Decoy: set down with a soft pok and a shimmer, and when driven into the box smash cut cheap, a cork's
    pop, a "bip-boop" down a third and a slide whistle slipping off.
  - *Impacts.* A hit (puck, rocket, blast, comet): a hard bonk, a clang of the chassis, a short whirl and three stars.
    A spin-out (oil, decoy, storm): a skid's whirl winding down, a bonk, and four dizzy tweets circling, slower as the
    head clears. Kart against kart by the sim's strength: a tap below 0.55 (a bumper's tok and squeak), a clonk with a
    deep thump and a ringing bumper above it, louder and lower the harder. A barrier: a tyre stack's thud and a fence's
    rattle. A hazard: a pipe's clang, debris and a sad trombone's wah-wah-waaah. A ramp: a plucked twang and a rubber
    boing; a trick: pings spiralling up, a slide whistle and a ratchet of the spin round the head (stereo); a landing:
    a chunk of suspension and two settles, a heavy one a thud with the frame ringing, and a trick landed is cheered
    (`kart_land_cheer`, the player's own). Over the edge: two detuned whistles falling with a hollow "ooo", and the drone's
    claw closing with a clunk; the drone letting go: a click, rotors, a boing and two notes.
  - *Moments.* The countdown's blips climb the A major triad and Go is a brass-and-bell triad over a detuned pad and a
    kick; a lap is a pluck, a tine and a chime up the triad with a swish of the line; the final lap is three hard
    pick-ups and a brass chord with a crash, under two seconds and over before the music's own final-lap change
    matters; a place won is two plucks up, one lost two marimba notes down; the finish is timpani, brass, a pad, a
    crash, confetti cannons, a run of bells and a roaring crowd (second place and below a warmer, smaller one); the
    results open with applause (`applause`, a `KartSound` the app asks for, 1.8 s in so it does not stack on the win or loss jingle); a driver's cheer (both hands up) is a party
    blower, confetti and a "yay", a wave a two-tine hello and a swish of the hand (`emoteOrder`, from the
    emote on the kart's view, once as it begins, and not for a finished kart: that cheer is the sim's own); the photo finish's flash charges, then the shutter clacks and pops.
  - *Horns.* A clap honks the driver's own horn (`HORNS` in `events.ts`): Bun a party blower, Pepper a bulb horn, Moss a
    ribbit, Kit the classic two-tone, Juniper a steam whistle, Mango a bicycle bell, Bramble a tuba, Rivet a robot's
    honk, Dabble a quack; each kart's a little different in pitch.
  - *Voices.* Every cue has `maxInstances` (at most 5; most 2 to 4) and a `minGap`, the race audio stops a frame at
    eight orders (priority 3 spared) and any cue at two (`race-audio.test.ts` fires eight karts' items, hits and
    pick-ups at once and holds the count), and another kart's sounds fall off by distance (20, 32 or 45 m).
  - *Measured* (`node tools/listen/cue-sheet.mjs`, each cue rendered offline at its table level; `sheet.py` makes
    the spectrograms): all 94 cues unclipped, the highest true peak −5.6 dBTP at the bus, levels matched to the old
    ones (a take is normalised to one loudness, so the mix is the table's levels, and a race's mix stays at about −16
    LUFS: the scripted moments scene is −17.8 LUFS, short-term −15.4, −5.5 dBTP). Hits land harder and sooner: a boost
    pad's attack 140 to 5 ms, the reel's landing 162 to 3 ms, a place won 72 to 2 ms, a skyrocket's launch 53 to 4 ms,
    Go 23 to 5 ms; crest factor up on the strikes (hit 15.5 to 20.8 dB, puck fired 15 to 21, bump 14 to 19), a spin-out
    a half second longer (0.9 to 1.5 s) for its tweets; the whole pack's first takes cost 1.0 s of DSP (0.7 before,
    for 30 cues fewer: 94 and 64), in workers.
- **Places.** Each theme's beds, two copies of each apart in the stereo field, and something far off every few
  seconds, 15 to 70 m away (so darker and quieter): a breeze and larks (meadow), a fridge's hum and a pot on the boil
  (kitchen), water lapping, a sea breeze and gulls (harbour), a dry wind and a hawk (canyon), a crowd, generators and
  the high striker's bell (funfair), a thin wind and creaking ice (snow), the mountain's rumble and lava (volcano), a
  spaceship's drone, the void's hiss and a radio's bleeps (space), surf, wind in the palms and tropical birds (palm).
- **Rooms.** Every track has its own reverb (`space.ts`: an impulse response made once from the theme, with its own
  length, decay by band, pre-delay and return level: a meadow's is 0.9 s and airy, a kitchen hard tile, the funfair a
  big top, the glacier and the volcano caves of two seconds, space 2.6 s and dark). The arcade's engine takes it with
  `setImpulse` (`RaceAudio.load` hands it over), and the one-shots that matter send into it (`reverb` in the cue
  table: finish, cheer, laps, blasts, storms, the skyrocket's burst, hits, landings and boosts most, the countdown a
  little). The loops (engines, tyres, wind) stay dry: they are the near, steady ground the rest rings against. The
  countdown climbs the A major triad (one beep at A4, C#5, E5) and Go is the A above with the triad blooming over it
  and the crowd a beat behind (the cheer has a 1.5 s gap, so a restart never stacks it); a drift boost at the second and
  third charge has its own flame cue behind it (`kart_flame_short`, 1 s; `kart_flame_long`, 1.8 s), while the plain
  whoosh stays as it was for pads, kicks and the start boost.
- **The bus.** In a race the master gets a glue compressor (threshold −20 dB, 2.5:1, soft knee) and a −2.7 dB trim for
  its make-up gain ahead of the limiter, whose ceiling is −2 dBFS (`enterRoom` sets them; `leaveRoom` hands back the
  arcade's plain master and town room when the race audio is disposed). A new room is swapped in with the reverb return
  faded out for 70 ms, so a ringing send never clicks.
- **The mix.** Levels are dB at the bus, in `src/audio/cues/kart.ts` (its header has the ladder); the tests hold it
  (`cues.test.ts`: every take under the bus's −1 dBFS ceiling, the kinds stepped, the engines' twelve layers within
  3 dB, the places under the engines). The music dips under the big moments: the finish (to 0.3 of its level), the
  final lap (0.45), being hit, a storm's bolt or a skyrocket bursting near (0.5), a blast or a fall (0.6), the start
  boost (0.65), the third drift boost (0.72), a nitro (0.78); a lighter dip never cuts a deeper one short. Measured
  over three laps of eight bots on Meadow Loop with one kart in view, the sliders where a new player finds them: the
  whole mix −16.2 LUFS (true peak −3.7 dBTP; Glacier Pass −15.9 / −4.0, Volcano Rush −15.8 / −3.8, Kitchen Rally with
  four views −15.5 / −3.3), the music −22.9; each place alone −34 to −36.
- **What it costs.** Measured over a race of eight bots on Kitchen Rally with four views (Meadow Loop with one), against
  a bus that only counts, in Node on the M4 Max: the audio code takes 0.011 ms a frame with four views and 0.007 with one
  (CPU time, the least of three runs for each second of the race, medians of three alternating runs of the checkout
  before and this one; 0.017 and 0.010 before). In the page it is about 0.1 ms, nine tenths of it the browser's own
  Web Audio calls: fifteen loops steered a frame with four views, six with one, each a few `AudioParam` changes, and
  only what has moved is sent. Four views and eight bots run at most 30 steered loops at once (22 on average: four
  engines' two layers and rasp, the tyres and the wind of each player, the rivals' layers, the place's beds), four
  nodes each (the source, the air's low-pass, a gain, a panner), beside the one-shots and the music: at most 202 Web
  Audio nodes alive (116 on average) in the offline render, 130 (75) with one view. All are let go: 50 s of four views
  made 1,975 nodes and let go 1,942, the 33 left being the buses (in real time a stopped loop's nodes stay a fade-out
  longer, 0.15 to 0.3 s). Its garbage a frame, by scavenges of a 1 MB young generation: 37 KB with four views, 25 after
  RaceAudio stopped working out, for every item box on the road and every kart that makes no sound, who hears it. The
  sound is the same: the calls made to the audio engine over seven races (every loop started, every `set`, every
  one-shot, with all their numbers) hash the same before and after. A render with `tools/listen` cannot show it
  bit for bit (the takes are made in workers, so two renders of one checkout differ); the loudness, range, peak,
  brightness and width of the Kitchen Rally render, before and after, are in `compare.mjs`.
- **Re-inventing the motion sounds, measured.** `node tools/listen/cues.mjs --label <name> [--root <checkout>] [--takes 3]`
  renders each cue of the pack in Node (no browser, nothing played), writes a stereo WAV of each and measures it:
  centroid and rolloff, crest, amplitude-modulation depth (the spread of the level over 40 ms windows against its mean:
  0 is a static drone), harmonic richness (how many multiples of the firing note stand within 30 dB of the strongest, to
  8 kHz), stereo width (side over mid, dB) and the mono sum's loss. Means of three takes, the old recipes (the
  checkout before this pass) against the new: the combustion engines' aliveness went from 0.03 to 0.07 (a drone) to 0.11
  to 0.18; their harmonic richness from 14 to 25 lines to 25 to 40; their width from none (mono) to -9 to -5.6 dB, the mono sum
  losing 0.5 to 1.1 dB; the drift's squeal and every ground loop from mono to -2.6 to -9 dB wide, losing at most 1.9 dB
  summed; the combustion engines' crest 7 to 10 dB up to 11 to 14 (firings with edges, not a hum); the heavy engine's centroid from
  300-360 to 350-500 Hz, the light one's from 860-980 to 1340-1750, the middleweight's from 490-610 to 740-1190. A
  scripted lap of each weight (`solo-*` in `render.mjs`: idle, pulling away, cruising, lifting off, a climb, the air,
  four drift tiers, release, grass, sand, a nitro, ice, mud, snow), a kart going by and a pack of eight come out at -18.7
  to -19.9 LUFS with true peaks under -6.2 dBTP, and their stereo width from -17.7 dB to -6.4 to -8.3 dB (the pack from
  -11.9 to -7.5). The whole mix stays at -16: three laps of eight bots on Meadow Loop -16.4 LUFS (-16.2 before; true peak
  -3.4 dBTP), Glacier Pass -16.3 / -4.5, Volcano Rush -16.1 / -4.4, Kitchen Rally with four views -15.4 / -3.4. The
  audio graph's cost (`renderMs` in the render: the audio thread's work for eight bots on four views, effects only, 50 s)
  went from 1.97 s to 2.55 s (3.9 % to 5.1 % of one core, medians of three alternating runs; the stereo loops and the
  third layer), the audio code's own time a frame is unchanged at about 0.03 ms. Spectrograms before and after are made
  with `ffmpeg -i x.wav -lavfi showspectrumpic=s=1400x420:scale=log:fscale=log:stop=12000:start=40 x.png`. The pack's synthesis
  cost (`node tools/listen/pack-time.mjs`, every cue's first take, best of five in Node) went from 250 to about 580 ms
  (the engines are 12 of the 86 cues and about half of it; the harmonic series is one cycle's table laid through the
  loop, and the filters are primed with the loop's own tail instead of run over two copies); in the page the takes are made in workers, so the wait before a race grows by
  about a fifth of a second.
- **Listening without hearing.** `node tools/listen/render.mjs --label <name>` renders scripted scenes (one kart of
  each weight through everything, karts going by, a pack of eight, the moments, each place alone) and real races of
  bots through the real engine and `RaceAudio` on an `OfflineAudioContext`, in a muted headless Chrome, writes them to
  `tools/listen/out/<name>/` as WAV files with their loudness (BS.1770), true peak, spectrum and stereo width, and the
  audio code's time a frame; `node tools/listen/cue-sheet.mjs --label <name> [--spectrograms DIR]` renders every effect on its own at its table
  level and measures its length, attack time, crest factor, centroid, loudness and peak (`sheet.py` lays before and after spectrograms side by side); `compare.mjs a b` sets two renders side by side. `KART_AUDIO_REPORT=dir KART_AUDIO_WAV=1
  npx vitest run src/kart/audio/report.test.ts` writes each cue's picture and sound. Nothing is ever played.

### The music (`src/kart/audio/music/`)

Thirteen pieces and two jingles, all written for the game, all synthesised in the page (nothing sampled, nothing
borrowed): one tune for each track's world (Meadow Loop folk-pop with a whistle, an accordion and a strummed steel
guitar; Kitchen Rally a swing combo with an upright, a Rhodes, a muted trumpet and brushes; Harbour Lights a night
lounge with a sax and a sea song's triplet lilt; Canyon Run a surf-western with a spring-drenched twang and a gallop;
Fun Fair a calliope waltz that becomes a brass march; Glacier Pass icy bells, a choir and glittering arpeggios;
Volcano Rush driven twin guitars over rock toms; Starlight Ribbon a pumping supersaw synthwave; Five Finger Circuit a
calypso on steel pans), the menu and lobby, the two result screens, the podium and the win and lose jingles.

- **Writing.** A piece is sections of bars (`pieces/*.ts`): chord symbols with extensions, a tune written note by note
  (call and response in the rests), and generated bass, comping and arpeggio parts from named rhythms (`patterns.ts`:
  walking and walk-and-push upright lines, slap, calypso, surf, lilt, rolling, pulse and gallop basses; Charleston,
  bossa, sparse and pushed comps). Most pieces open with an intro or a build, state the tune, answer it, change
  colour in a bridge, and finish with a *lift* (the chorus again a tone higher with the band swelling: `shift` on a
  section, with `withFinale` in `pieces/dsl.ts`) and a two-bar *turn* on the dominant that falls into the first chord,
  so the seam of the loop is a turnaround, not a restart. Volcano Rush and Five Finger Circuit kick their last chorus a
  tone up in place. A race theme is 69 to 83 seconds before it loops.
- **The band.** `synth.ts` adds the engines the old presets could not be: `guitar` (a Karplus-Strong string with a
  wooden body's resonances and a pick's click), `rhodes` (two FM pairs, a tine's bark, a hammer's thunk, shorter as it
  climbs), `buzz` (stacked band-limited saws through a moving filter, with a scoop, a swell, a late vibrato, a breath
  and optional vowel formants: brass section and stabs, muted trumpet, sax, accordion and musette, supersaws, string
  ensemble, choir), and `layer` (a slap bass is a thumb and a pop; a steel pan a modal bell and an FM shimmer). The
  drums (`kit.ts`) are layered with real transients: a beater's tick over a pitched body over a sub, a snare's crack
  over its wires and shell, hats and cymbals from six detuned metal squares; six kit styles (pop, rock, brush, electro,
  latin, march) and the shared kit for congas, shakers and the rest.
- **Production.** Each part has a channel strip (`RackEntry`: high-pass, low-pass, peaking EQ, drive, rotary speaker,
  tremolo or auto-pan, chorus, width, compressor, and `duck`, the sidechain pump that dips it at every kick); the
  parts are balanced by loudness, sent to the room (with pre-delay and damping) and the ping-pong echo, folded into a
  seamless loop, opened with a touch of air and width, glued by a bus compressor (2.8:1, 6 ms attack), rounded by a
  breath of saturation and held by a look-ahead limiter that works round the loop, so a produced crest of 12 dB over a
  loudness of −18 dBFS (`CREST_DB`), the peaks at −6 and never past −1. Music is quiet under the effects as before
  (`MUSIC_TRIM`); the race mix and the ducking stay in `race-audio.ts`.
- **Dynamic.** At the final lap the piece switches on the next beat to its version 1.1 times faster and a semitone
  higher (`FINAL_LAP`), with a brass *stinger* (two bars and its tail, six to seven seconds) in the new key, made with that version, landing on the
  downbeat while the music ducks to 0.55 under it. While a local kart burns a Comet (`KartView.comet`), a one-bar layer
  of tambourine, shaker and bell pings in the theme's key loops over the music, coming in on the next bar line and
  leaving in half a second (`MusicPlayer.setComet`). The music opens up with the race: a high shelf rising to +3 dB
  and half a dB of level from the first lap to the last (`setIntensity`). The jingles (`music("jingle-win")`,
  `music("jingle-lose")`) are one-shots, a fanfare of brass over timpani and a rueful descent on a muted trumpet; coming
  off a race, `music("results-win")` and `music("results")` open with the matching jingle and fade into their own tune as
  its tail dies away. The comet layer is renewed at every restart of the music's loop (so a waltz bridge never leaves it
  behind), and the comet and the race intensity are let go whenever the phase is not racing. Pieces sit at the shared
  −18 dBFS give or take `fx.master.loud` (Glacier −1.5, Meadow −0.5, Volcano +0.5) so the calm ones are calmer. Palm and
  Volcano end their lifted chorus with a two-bar turn on the dominant, like the others.
- **Off the main thread, and what it costs.** The worker renders a piece in one go (the stages are the fallback's
  slices) while the loading bar shows its progress; the final-lap version, its stinger and the comet layer render in the
  background after the race loads. Measured in Node at 32 kHz on a quiet 16-core machine: 0.5 to 1.5 s a race theme, 0.5 to 0.9 s a screen's piece (the synthwave and the snow at the slow end; on the same machine shared with ten other jobs, load 40, the same pieces took 1.2 to 15 s). A race theme's loop is 18 to 21 MB at 32 kHz (27 to
  32 MB at 48 kHz) and its final-lap version 16 to 19 (24 to 29); `RaceAudio` keeps only the current theme's pair and the menu's;
  the results' and podium's tunes render when wanted (the results' common one as soon as a local kart finishes) and the
  unplayed one of the two results tunes is let go. The comet layer (2 s) and the stinger (about 6 s) are a few hundred kilobytes.
- **Checking without hearing.** `production.test.ts` holds the tools (a limiter that lets nothing through, a pump, a
  compressor), the kits (a kick is low, a hat high, every kit finite and ending in silence), the instruments (each plays
  the pitch asked, finite, ending in silence), the crest and loudness, the lift being the chorus a tone up, the
  jingles, the comet layer and the stinger; `pieces.test.ts` holds each piece (in tune with its own chords, the right
  length, loud but not too loud, balanced, seamless where it loops, the same every time, wide).
  `MUSIC_OUT=<folder> npx vitest run src/kart/audio/music/measure.test.ts` renders every piece and its final-lap
  version offline to WAV files with a `summary.json` (loudness, peak, crest, limiter depth, the share of energy in five
  bands, centroid, stereo width, render time, size); nothing is ever played.

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
  off and on, canvases compared); with `--against URL` it compares this dev page with another checkout's instead, the
  same race stepped a sixtieth of a second at a time (`?manual=1`, `Math.random` and the page's clock fixed) and the
  canvases compared byte for byte at frames 150, 500, 900 and 1500. `shots.mjs`: the same posed still from two dev pages
  at each tier, with the difference in 8-bit levels.
- `calls.mjs`: what a frame's draw calls are: one frame of the stepped race, each kind of object drawn (where it hangs
  in the scene, the kind of mesh and material), how many times in the views and in their shadow passes, and a total for
  each view. Calls and triangles are counted, so unlike a frame time they do not move with the machine's load.
- `tracking.mjs`: the hand tracker for 1 to 4 players on one camera (`e2e/tracker.html`), before and after the workers
  per player. `trackrace.mjs`: the tracker beside a race (`e2e/trackrace.html`), 1 to 4 players each beside as many
  views, before and after, alternating rounds (`--rounds n`), `--soft` on a software GPU. Their pictures: a hand photo
  per player, or two fists per player (`e2e/crowd.js`, `?players=N`).

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
  Hidden stand-ins for what appears only later (a slick, the storm cloud, the comet's bubble, the rescue drone;
  `standIns.test.ts`) are built with them, so none of those builds its shaders mid-race (each was a 250-480 ms
  freeze); the podium does the same before its first picture. Both waits give up (8 s, 1.5 s) so a lost context cannot
  hang them. It costs about 0.3 s more behind the loading screen.
- *Shadow casters per view* (`casters.ts`): a kart whose shadow a view cannot see is left out of that view's shadow
  pass. `same.mjs`: identical pictures on all nine tracks, 1 and 4 views.
- *A colour-only resolve*: each view's multisampled picture is resolved without the depth nobody reads, 0.7 to 1.4 ms
  less GPU time a frame, identical pixels.
- *What outlives a race* (`outliving.ts`): three r186's shared lookup texture, and Grip Prix's shared materials and
  geometries, keep dispose listeners that held every renderer alive (a renderer, six scenes, about fifty materials
  and twenty render targets a race). The race, the podium and the driver stage dispose them as they go: flat over
  five races.

  Before and after these four (`bench.mjs --bases`, high tier, medians of two on a loaded machine: trust the calls
  and triangles over the milliseconds):

  | | Draw calls | Kilo-triangles | Frame (ms) |
  | --- | --- | --- | --- |
  | Meadow, 1 view | 157 → 115 | 667 → 567 | 7.0 → 5.9 |
  | Meadow, 4 views | 677 → 578 | 2929 → 2708 | 10.5 → 8.1 |
  | Canyon, 1 view | 172 → 130 | 639 → 507 | |
  | Canyon, 4 views | 754 → 614 | 2752 → 2396 | |
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

**Local multiplayer, measured as a whole** (2026-11-07; `tools/perf/split.mjs`: the real race page, real sim, renderer, HUD
and net loop of a practice room, 2 to 4 scripted wheels, optionally the real camera so a tracking worker runs per column;
1440x900 at 1x, M4 Max, Auto tier, 15 s of racing weaving about so bots, items and bumps happen, 60 s for the longest).
Two, three and four players on Canyon Run and Fun Fair, scripted hands and the fake camera: 60 fps, p99 16.8 ms, no
frame over 33 ms, no main-thread task over 50 ms, no shader program linked after the green light, 270 to 560 draw calls
a frame (p99 up to 1020). Four players on Fun Fair with the camera for 60 s: the same, no hitch. The main thread is about
a fifth busy with four views (`--profile`: three.js's own scene walk and draw submission, then `cull.select`, `project`
and the minimap, each under half a millisecond a frame). It makes 20 MB/s of garbage (`--garbage`: four fifths is three.js
uniform uploads); that is a minor collection every second or so and none showed as a frame. Against main (9742f80) at 1x
the numbers are the same, because there was nothing to see on a fast machine. A weaker one is what `--cpu n` stands in for
(the main thread n times slower, four players, medians of one run, so read as a direction): at 8x main drew 23.5 fps on
Canyon Run (p99 100 ms, 72 frames over 50 ms) and 26.3 on Fun Fair (p99 67); this branch 25.9 (p99 67, 40 frames over 50) and
31.0 (p99 83); at 4x this branch still holds 60 fps. What a hitch would be made of, and is not here: the shaders are all
built behind the loading screen, the pictures are culled per view, the minimap redraws at 30 Hz, nothing allocates per
item box. What remains is draw calls: four views at the high tier submit 500 to 560 a frame, and below about a quarter of
this machine's single-thread speed four views stop holding 60 fps; the answer today is `onStrain` (the next race one tier
lower). Proposals: karts (welded meshes sooner, fewer draw calls a kart), the tracks (fewer distinct materials in the
landmarks) and a mid-race step down for the shadow pass of views 3 and 4.

*Not done, and not measured, against what was asked of this area:* the shadow pass still runs once per view (four times
with four players); there is no per-view resolution (the one dynamic resolution covers the whole canvas) and no tier that
steps down mid-race beyond `onStrain`; shader pre-warm was only observed (nothing links after the green light), not
changed; hands jumping between players, the wheel freezing, input-to-kart latency, tracker read rates, a laptop hosting
phones as wheels over real Wi-Fi (host snapshot cost) and any older laptop, integrated GPU or Safari were not measured.
The `--cpu n` figures are one run per side. A friend's "bugging" report is therefore not explained: no frame hitch was
found on a fast machine, so it is likely weaker hardware or tracking. If the minimap's canvas is resized it stays blank
until its next draw, at most 30 ms.

**Tiers.** `guessTier(gpu, cores, { splitScreen: true })` (Grip Prix passes it; the arcade's own guess is unchanged): a
base Apple chip (M1 to M4) starts at medium, as do Safari and an iPad, which report only "Apple GPU" (unless the
core count says a Pro or Max: 12 or more); Apple Pro, Max and Ultra start at high; old Intel graphics at low, Iris Xe
and Arc at medium; a laptop Adreno (X1) at medium, a phone's at low; the small GeForce parts (MX, GT) at medium; a big
GPU in a machine of four cores or fewer is a step down.

**The safety net.** If the frames stay slow for six seconds of racing with nothing left for pixels to do
(`StrainWatch` on `DynamicResolution.spent`: the scale at its floor, or fewer pixels found to buy no quicker frame and
given back), the renderer tells the app how long those frames took, and in Auto the next race tries a tier lower on this
device (`handy.kart.ceiling.v1`, kept 14 days, forgotten when the player chooses Graphics again). The lower tier is on
trial (`prefs.ts`, `noteStrain`): a race at it that keeps up for 30 s keeps it (`noteKeptUp`); a race at it that strains
again with frames less than a tenth quicker shows the tier was not what held them, so the tier above comes back and that
pace is remembered, and a later strain at it changes nothing. This is a browser holding the page to 30 fps to save the
battery (Chrome's Energy Saver, Low Power Mode): it used to drop the picture to its floor and save a lower tier for two
weeks, then the one below; now the picture dips for about 4 s at the start of a race and comes back sharp, and one race
runs a tier lower before High returns. Checked end to end in headless Chrome on an M4 Max, the page's frames held to
30 fps: High, a race at Medium, then High for good; at the browser's own pace, High at 60 fps and nothing saved. Earlier,
on a software GPU that said it was an M1: medium, then "Auto is using Low here: a race ran slowly, so it stepped down."

**Graphics.** The pause sheet has Graphics (Auto, Low, Medium, High; `handy.kart.graphics.v1`, Auto by default) and a
Frame Rate switch (`handy.kart.fps.v1`: a small readout beside the pause button). The renderer is built from the choice
at the start of each race, so a change shows from the next one (Restart, in the same sheet, is the way to see it now);
the footnote says which tier Auto uses here.

**Phones as wheels.** A phone whose race is on the host's big screen creates no renderer, no world and no canvas
(`views()` is empty: `app/race.ts` shows the controller), fetches none of `world-*.glb`, and no longer builds the
3D podium after a Grand Prix. What it still does is 3D for the driver picker and the lobby's portraits (the karts' and
drivers' models, Draco's decoder, three transient WebGL contexts) before it knows it is only a wheel.

**The living camera and the frenzy** (2026-10-30) add no shader program (87 and 85 programs on Canyon Run and Starlight
Ribbon before and after: everything new is uniforms in shaders already built at load) and no draw call: the camera reads
the road with one `project` and three `at` a view, the near-kart check is a distance a kart a view, the wind's streaks
and the bigger sparks share the existing pools (the karts not watched throw fewer). The rush is the costly part: while
a view's kart boosts (or goes past its top speed), each of that view's pixels outside the middle reads the picture
seven times (high; five on medium; it is off on low and while not boosting, one uniform test a pixel). Measured with
`bench.mjs --bases` (high and medium, 1 and 4 views, medians of two) on a machine at a load average of 650 to 950: frame
time, CPU and GPU within the noise (which was ±15 to 45% between runs of the same page); an A/B of the rush alone on one
frame redrawn could not be read at that load (the same frame took 3 to 25 ms of post). To measure on a quiet machine.

**The playtest pass, measured and trimmed** (2026-11-01; `bench.mjs --bases` against dc83280, then against origin/main,
high tier, resolution pinned, medians of 3 and 5 alternating rounds on a machine at a load average of 100 to 1000, where
milliseconds moved ±15 to 45% and counts did not). The pass, 2026-10-30 against dc83280, changed no frame time that
could be told from the noise, no program (85 to 87 on both) and no texture memory (218 MB, 235 MB of targets). It cost
draw calls (meadow-loop, 4 views, 613 to 642; canyon-run 562 to 633: the reshaped tracks and the new scenery rules, the
bench's races not being the same moment), 9 to 19% more garbage a frame (canyon-run, 4 views, 331 to 368 KB; 1 view 123 to
139), and a first frame 0.35 to 0.7 s later (canyon-run, 4 views, 2.6 to 3.1 s). Triangles stayed within 6%.

- *Three rebuilt a material's program all the time* (found by counting, in a scratch copy of three, why `setProgram` asked
  for a program): three sorts draws by material and, each time the next draw is of another kind, works the program out
  afresh (the parameters, a long cache key), which was a third to a half of a frame's garbage. Two causes, both older than the
  pass. The decoration's material was drawn by plain meshes and by instanced scenery with and without a colour each, and
  the flower stems shared the tufts' material: four rebuilds a view a frame. Each kind now draws with a twin of the material
  (`twinOf` in `shading.ts`: the same patches, program key and uniforms, a material of its own). And a transparent
  double-sided material (the glass of a landmark, a hazard's steam) is drawn by three in two passes, back faces and front,
  by setting `side` and `needsUpdate` twice, so each pass works the program out again: 2 to 54 times a frame in four views
  (27 objects in sight on Canyon Run, 22 on Glacier Pass, 21 on Starlight Ribbon, 1 to 2 on Meadow Loop). The world's
  glass now draws as two materials in the geometry's two groups (`twoPass.ts`): the same two draws, back then front, in
  the same place in the sort. Rebuilds a frame in four views, canyon-run: 73 to 0. Garbage a frame (heap sampling,
  stepped race, 600 frames, 4 views): canyon-run 684 to 353 KB, starlight-ribbon 551 to 372; `bench.mjs --bases`, medians
  of 5: canyon-run 155 to 140 KB with one view and 418 to 309 with four, glacier-pass 209 to 188 and 708 to 469,
  meadow-loop 126 to 108 and 369 to 297, five-finger-circuit 264 to 218 and 538 to 408. Main-thread CPU, `Profiler`
  over 400 stepped frames, 4 views, medians of 4 alternating rounds: `getProgram` 0.51 to 0 ms (canyon-run) and 0.50 to 0
  (glacier-pass); `renderer.frame` 5.02 to 4.61 ms and 5.49 to 4.99 (the minimums did not agree: ±15%).
- *The scatter at load* (`Clearance.at`, which the pass added for the tufts and the scenery): 450 ms of Canyon Run's 2.2 s
  load, a fifth of it, from a distance worked out to every stretch of road near each candidate. Stretches and buckets that
  cannot make the answer smaller are now passed over by their squared distance, with exactly the answer it gave (a test holds
  it to the plain search on every track, mirror and dev track, `toBe`). 30 000 candidates round the road: Canyon Run 170 to
  290 ms before, 35 after; Meadow Loop 114 to 176 before, 33 to 97 after. The first frame came 11 to 27% earlier with four
  views in the bench (meadow-loop 3.6 to 2.7 s, five-finger-circuit 3.0 to 2.4, canyon-run 3.3 to 2.6) and 1 to 17% earlier
  with one (the noise is as big as the smaller of those).
- Pictures: `same.mjs --against origin/main`, byte for byte, at frames 150, 500, 900 and 1500 of the same race: identical on
  all nine tracks, 1 and 4 views, high tier (the twins and the glass); identical again with `Clearance` on three tracks.
  No sound, sim or tuning code touched.
- *Not worth it, measured*: tracks cut into chunks of 96 m instead of 48 m. A view draws a chunk each of road, decoration
  and verge, so draw calls fell 5 to 14% (canyon-run 708 to 617 with four views, meadow-loop 1009 to 951, glacier-pass 877
  to 831, five-finger-circuit 673 to 627; the pictures identical), but triangles rose 0.2 to 4% and the main thread did not
  come out quicker in three alternating rounds. Left at 48.
- *Known, and outside `render/`*: `TrackGeometry.project` is a search along the whole line; the landmarks' placement
  calls it for 330 to 370 ms of every Canyon Run load. A bucket search that keeps the answer would take most of it.

**Not done yet.** Photo portraits for the driver picker where the room's race is on the host's screen (a phone then loads no
models at all); a cap on the pixels of a huge window (a 5K display at 2x draws 15 million pixels at the high tier);
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
   Practice; "Up to 4 players" under it. Where the art is missing or not
   fetched, the page's own meadow and road stand in. A phone that came with
   a `?join=` link does not fetch the art at all (it is on its way to a room).
   The back link is the Nintenthropic wordmark (a white pill with a soft shadow in the glass back link) and goes to the landing (`./`); the loading screen carries the same wordmark at its head. `race.html`
   carries `assets/kart/icon-180.png` as its icon and Apple touch icon.
2. **Who's Driving?** (`you.ts`). One calm card: your name (a friendly default), how you
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
4b. **How to Drive** (`howto.ts`, every visit, for hands, keys and pads
   alike, after the check or straight after the driver stage): six glass
   cards, one move each (Steer, Go, Brake, Drift and Boost, Use an Item,
   Honk), said for what the player drives with: an icon and a line for hands
   ("In a bend, open both hands to drift. Close them to boost."), the caps
   for keys and pads. A card lights while its move is being made, and an
   item or a honk pops its card, so the screen is tried, not only read; a
   line under the cards gives the flying start and the trick. Continue goes
   on to the lobby (the device says it is ready only then); for hands,
   raising both open hands (the cheer) goes on too, so nobody has to let go
   of the wheel for the mouse. Back goes to the driver stage.
5. **Lobby** (`lobby.ts`, `lobby.css`). Two columns. On the left, the room:
   the host's join card (the QR code, the code large, Copy Link), a big card
   for every racer (their driver in their kart colour, name, how they drive
   and on which screen, a green tick when ready) and a soft dashed seat for
   each friend still to come ("Join with code ABCD"). On the right, the race:
   Single Race or Grand Prix as a large segmented control; for a single race a
   carousel of postcards, one for each track, snapping, with its name and cup
   (`assets/kart/tracks/<id>.webp`, 960 x 540; where one is missing the track's
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
   (the host), Back to Lobby. Under the title, a line on how it went for the
   one player on this screen, kinder and funnier further down the table
   (`eggs.ts` `resultLine`: "By a mile.", "1.4 s behind Pebble.", "You saw
   more of the track than anyone.", "The drone knows you by name now."), or,
   for friends sharing a screen, who beat whom ("Ada beat Maya, Finn and
   Kit.", `sofaLine`). **The finish-line photos** (`finishGallery.ts`): a
   card for each player of the race (bots have none), in finishing order, the
   photo filling it and, over its foot, their medal, colour, name and time;
   the winner's card has the gold hairline the winner's row has. Beside the
   table from 1100 px wide (the photos on the left, at most 540 px, the pair
   in the middle), above it on a narrower screen. The best placed player's
   card leads, the biggest, with a larger caption, and the others are at most
   70% of its height, in rows of one height (`arrangePhotos`: the number of
   rows that shows the most of the pictures within the room there is, the
   table's height beside it, a third of the window above it), so no photo is
   cut. `layoutPodium` tries the leader in a row of its own over the rest
   (`arrangePodium`, which suits wide photos) and the leader as tall as there
   is room for with the rest beside it (tall ones: two to four on one camera),
   and keeps whichever shows more, the leader's card counted twice. They come
   up after
   the rows, in place order, and each photo develops like a print: a soft
   flash, then the colour coming in (a cross-fade with Reduce Motion). A
   keyboard or gamepad player's card, or one whose photo has not come yet (a
   guest's comes a moment after the results), is their driver's portrait in
   their colour, and a photo that comes later develops over it. With no photo
   and none on the way (another device's wheel player's), there are no cards:
   a race of keys and pads looks as it always did. The race screen takes the photos
   (`race.ts`, `FinishShutter` in `finishPhotos.ts`): for each of this
   device's wheel players, a burst (`PhotoBurst`: a still on that frame, then
   one every 300 ms for 1.2 s, each a small canvas until one is kept) that
   keeps the still most like celebrating by what the wheel saw as it was taken
   (`reaction`, from `WheelStatus.emote` and the grip: a cheer, both open
   hands raised, 3; a wave 2; hands let go of the wheel 1; else 0), the first
   of the best, so with nothing better it is the frame of the line; only the
   kept one is made a JPEG, when the burst ends (or the race screen does). A
   burst starts once, on the first of the sim's `finish` event for
   their kart (on the host and in practice, the frame that ran the tick it
   crossed the line; on a guest, when the host's events come, a round trip
   after its own screen drew the crossing, since a guest draws its own kart
   ahead of the host's word: a tenth of a second or so), its kart finished in
   the view (an event not seen while the race loaded), or the race decided
   before they got there. The
   pause sheet's Finish Photo switch (`handy.kart.photo.v1`), with a footnote
   on who sees the photo, only on a device with a wheel player; off, no photo
   is taken. The camera's question says it too: "The picture stays on this
   device; only your photo at the finish line goes to the friends you race."
   **Share** (once there is a photo) makes one picture of the cards
   (`finishShare.ts`, 1200 x 630 as the arcade's results card): the track's
   postcard blurred and darkened behind, Grip Prix's badge and name, the track
   and its laps (or the cup and the race), and the cards laid out as on the
   screen with place, name and time stamped on each, the winner's ringed in
   gold. It goes where the arcade's card goes (`ui/share.ts`, shared by both):
   the system's share sheet, or the Downloads with a toast. It is made only
   when asked. Files are named `nintenthropic-grip-prix-<track>.png`, and the
   footer draws the logo (`assets/brand/wordmark.png`, the word where it does
   not load).
   **The track's look on each photo** (`src/kart/app/photoFx/`). Every track
   has a `Look` (`looks.ts`): a colour filter that stays kind to faces (warm in
   the meadow, cool on the glacier, a night sky over the harbour, the fair, the
   volcano and the ribbon), a soft-light wash, a vignette, a stamp with the
   track and the place ("Meadow Loop · 1st") inside a thin frame, and
   the animated effects that play over the picture: petals, butterflies and a
   hot-air balloon (Meadow); steam, sprinkles and a pop of flour (Kitchen);
   fireworks over the water with their reflection and a lighthouse beam
   (Harbour); a sun flare, a dust devil and a tumbleweed (Canyon); fireworks
   and confetti (Fun Fair); frost creeping in, snow and glitter (Glacier);
   embers and a lava glow (Volcano); a ringed planet, twinkles and shooting
   stars (Starlight); palm-leaf shadows, bubbles and a sun glint (Five Finger).
   By place (`flourishFor`): the winner has a bobbing crown and a gold show,
   second and third silver and bronze sparkles, the last of three or more a
   small rain cloud. Each effect (`effects.ts`) is a pure function of the clock
   and the card's size, with no state, and repeats within `LOOP` (4 s): so the
   shared picture can freeze it on its best frame (`Look.peak`), a clip can loop
   without a join, and the tests compare frames. `player.ts` draws them on one
   canvas per card, one loop for all at most 30 times a second at no more than
   1.25 pixels a px, only for cards that are on screen (IntersectionObserver)
   while the page shows; Reduce Motion draws the best frame once. The page's
   grade is CSS (`filter` on the picture, a soft-light wash, a vignette), the
   shared picture's the same in canvas calls (`compose.ts`; a browser whose
   canvas has no `filter`, as Safari's, shares the wash without it).
   **Share Clip** (next to Share, only where the browser has `MediaRecorder` and
   `canvas.captureStream`) records the shared picture moving for one loop, 4 s at
   30 fps, as mp4 where the browser makes it and else webm, and passes it to the
   same share sheet or Downloads (`nintenthropic-grip-prix-<track>.mp4` or
   `.webm`); where recording fails the picture is shared instead.
   **Standings** (a Grand Prix, between races) wear the same, on the
   postcard of the race just run; the **Podium** (its end)
   has its own stage, and says to a player who did not win how close they
   came ("You took silver, 3 points behind.", `podiumLine`).

In a race, a hit between two people on the sofa earns a word in each one's
view ("Got Finn." for one, "Maya got you." for the other, "Own goal." for a
puck that comes back), at most one a view every 2.5 s (`eggs.ts` `taunts`);
a bot at either end says nothing. Each track's duck says where it was found
("Duck 3 of 9. Fished out of the sink."), and a duck found on a mirrored
track counts for its track.

**A gamepad** finds its way round the menus (`padnav.ts`): the d-pad or the
stick moves a visible focus ring to the nearest thing that way, A presses,
B steps back only where leaving loses nothing (You, the wheel check, How
to Drive, a sheet), and Start opens and closes the pause sheet. The driver stage reads
the pad itself, and in a race the pad drives.

Troubles say what happened and what to do: "There's no race with that code.
Check it and try again.", "This race is full.", "The host left the race.",
"Lost the connection to the race. Make sure everyone is on the same Wi-Fi,
then try again.", and for a code that never answers, "Can't
Reach the Race" ("Join from the same Wi-Fi as the host, then try again.") —
each with the way back as a button. When the room had a relay, the two
network ones say "Make sure everyone is online" and "Check your internet
connection" instead. A guest who has heard nothing from the
host for 2.5 s (a ping goes every second) sees "Waiting for <host>" over the
race instead of a world frozen without a word (`net/guest.ts` `QUIET_MS`).

The landing (`index.html`) gives Grip Prix a tile of its own beside Finger
Guns, and its Race opens this page; in `src/games/index.ts` Grip Prix is a
`GameEntry` with `page: "race.html"` and no `create`.

**What the race screen does a frame** (the real page in headless Chrome on Metal, four players on one camera and four
views, 1440x900 at 2x, a CDP profile of the main thread over 6 to 8 s, the checkout before and this one alternating,
four rounds each; this machine's load made the milliseconds move by a third between runs of one page, so the counts
below are the ones to trust). The main thread is busy 9 to 12 ms a frame; the picture takes 9 to 10 of them
(`renderer.frame`), the room 0.2 to 0.3 (the host's tick, the sim's step inside it), the sound 0.1 to 0.3 (see "Sound"),
the HUD 0.1 to 0.3, and the screen's own work between them under 0.05. The HUD changes the page's DOM 0.4 attributes
and under two text nodes a frame with four views (the clock's tenths; `update` writes only what has changed, and an
unchanged style value costs 0.1 µs to set again, so nothing there is worth guarding), and 146 µs of script a frame, three
quarters of it the minimap's dots (`minimap.ts`: the `ctx.font` for a place in a dot makes the browser bring the page's
styles up to date in the middle of the HUD's update, once a frame, which is why the HUD's time moves with what else
changed the page since the last frame). What the screen itself did that it need not was one thing: the Show Both Hands
pills measured the stage with `getBoundingClientRect` on every frame, which flushed styles and layout at the top of the
frame and left the HUD's own flush to do it again (1.14 and 1.20 style recalculations a frame; 0.10 to 0.15 ms in the
pills' code). The stage is now measured when it is resized (`fit`), the room's viewports are asked for once a frame
(`kartsOnScreen` builds its list each time it is asked: three times before), and what each kart drives with is worked
out when the lobby changes and not every frame: 1.0 style recalculation a frame (1.01, 1.00 in two runs) and 0.002 to
0.016 ms in the pills' code. The flush that remains is the one the page must make once a frame; the style time in all
(0.17 to 0.19 ms a frame) did not move.

## Tests

- Unit (Vitest): the geometry; the sim (a bot laps every track in a sane time
  and never leaves it, braking reverses, a drift slides, tightens, widens,
  straightens out and charges three boosts, jumps leave the wedge the picture
  draws and land pointing where they fly, a shake tricks only in the air and
  kicks at the lip, cannons, glides and lips fly the same arc every time and set a kart down on its mark (`air.test.ts`), crests throw and hills pull, the slipstream slings, items
  hit, places and laps count, the race ends, `snapshot`/`restore` round-trips,
  the same seed replays); the bots (`bots.test.ts`: temperaments mixed on every
  grid and kept through a cup, laps that differ, a pass on a side without a
  touch, the inside covered, Nitros saved for a straight, a Slick held for a
  kart on its tail, a Puck dodged, a band that never passes top speed;
  `pack.test.ts`: a sharp scripted driver beats a gentle one, in company); the net (lobby joins and leaves, a full room, inputs
  in order under loss, prediction converging, the host leaving); the wheel
  (angles, the level, fists and open hands from recorded landmarks, every
  gesture, a drift started at full lock and let go against it, shakes,
  hands lost).
- Performance (Vitest): the tier guess for each GPU family (and the split-screen
  rules), the safety net's watch and its ceiling in prefs, the per-view culling of
  instances (everything the frustum reaches is drawn once with its colour, a buffer is
  rewritten only when its cells change, and what the GPU holds of it, uploaded as
  three uploads it, is what the view draws), the tracker's tile schedule, the lazy
  renderers, the workers per player (`lanesFor`, a frame for one column is no news
  to another player's wheel, the column just read wins a shared hand), the try of
  the other delegate (`adapt.ts`) and the hands first (`handsFirst.ts`: steps down
  while frames drop, undone when they do not help, back up with room). Pictures and
  timings are `tools/perf/` (not run by CI).
- Sound (Vitest, in Node, nothing played): every cue renders finite, unclipped and
  of its length, its takes different, a loop without a click at its seam
  (`src/audio/sounds.test.ts`); the kart pack's mix by kind, every take under the
  bus's −1 dBFS ceiling, the engines' twelve layers within 3 dB of each other,
  brighter the lighter the kart and each on its note (`cues.test.ts`); RaceAudio
  against a recording bus (`race-audio.test.ts`): the sound of every event, an
  engine's revs, crossover, load and pops, a rival heard where it is at every step
  of a pass and bent by Doppler, the surfaces, the sparks, the places, the music's
  ducks, pause and mute.
- End to end (Playwright, `?net=local`, muted): a host and two guests in tabs
  of one browser join by code, drive by keyboard and finish a one-lap race;
  practice against bots; the landing's Race opens the page. The finish-line
  photos (`race-photo.spec.ts`, `?camera=real`: the scripted hands steer, and
  Chrome's fake camera is really opened behind them): a wheel player's photo on
  the results with their place and time and Share saving a 1200 x 630
  picture, two on one camera with a half each and the better placed the
  bigger, and a big-screen guest's photo on the host's results.
- The finish-line photos (Vitest): taken on the tick of the sim's finish event
  and once, from a finish whose event was not seen, and at the end for a
  player still racing (`finishPhotos.test.ts`, on the real sim); the burst's
  stills (the line's frame, then every 300 ms) and the one kept (a cheer over
  the line, the first of the best); the layout (whole pictures, no overlap,
  inside the space, the leader the biggest, stacked for wide photos and side
  by side for tall ones); the crop
  and size (`input/photo.test.ts`); the cards' rows; the room passing each
  photo to every other device only once the race is decided, and dropping
  anything that is not a small JPEG of the sender's own kart
  (`net/race.test.ts`).

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

- **Ramps** (`ramps`): a ramp across the road, a wedge 16 m long rising to
  2.4 m × lift / 7 at its lip (the sim's `wedgeAt` and the picture's
  `rampHeight` are the same curve, and a test holds them to it). The sim
  counts the wedge as road and launches from its top: over 9 m/s the kart is
  thrown up at lift × 0.72 m/s at top speed (about 1.2 s in the air, the arc's
  top some 3.5 m over the road), slower it only drops off the end. In the air
  the kart points where it flies (its nose swings round at 4/s) and the wheel
  turns its flight up to 0.55 rad/s, enough to bring a jump taken at an angle
  back over the road. The drift button (Space, a pad's A) or a shake in the air is a
  **trick**: the kart twirls, and boosts on landing (0.8 s). A shake within
  0.3 s before the lip or 0.2 s after it **kicks** the jump: 1.8 m/s more
  lift, 6% more speed, and a 1.1 s boost on landing. Jumps can cross a gap: a
  `drops` entry with `gap: true` and side `both`, starting just past the lip —
  a kart that lands short falls, and one shoved over the lip by another
  between its own steps jumps rather than falls. A kart higher than 2.4 m
  flies over an item box.
- **Launch and air sections** (`air`): `{ kind, at, length, height, offset?, width? }`. A **cannon** is a pad of chevrons
  with a pair of barrels beside the road that fires the kart in an arc of `height` m that comes down `length` m on;
  a **glide** lifts the kart off a brow to `height` m and floats it down the next `length` m under a striped parasol
  (target rings are painted where it lands: the middle of the road, the boost); a **lip** is a short, steep arc at
  one side of the road (`offset`, `width`) for a trick. Put the landing on a stretch the kart can drive (a long gap
  in the road under a cannon needs `drops` with `gap: true`, an open edge under a glide `drops` without), give a
  cannon 20 m of road after its landing before a hard bend, and keep hazards out of the landing (a kart in the air is
  above them: they are met when it comes down). The picture is `render/world/airPads.ts` (flat light, and posts
  beyond the barrier and the camera's margin, like the start gantry's legs) and `render/parasol.ts`; the map draws
  the flight as a band. Mirror mode flips the pad's offset.
  A planned flight never slows below a floor speed (`AIR.flightFloor` 12 m/s, a lip 8): a storm, a hit or a wall in
  mid-air cannot leave a kart hanging over the track, it carries on and lands. `sim/airTracks.test.ts` checks each air
  track (and its mirror): landing run straight, no hazard, item row or boost pad under a flight, bots fly every
  section, never fall, and finish across three seeds.
  **Not built** (kept for the timed moving set pieces engine of the Track features section, or later): the
  loop-the-loop ribbon, trick walls, vertical twists, the crumbling bridge over the lava, rock rain with a visible
  build-up (Volcano's eruption is the paired lava bombs on a 7 s period), and the Five Finger beach waves.
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
- **Timed set pieces** (track/pieces.ts, drawn by render/world/pieces.ts):
  hazards that act on a beat and *tell you first*. They are ordinary
  hazards, so the sim, the bots and the network need nothing new (every
  device computes the same pose from the race clock). The motions: `swing`
  (a wrecking ball or boat on a chain across the road, `span` metres either
  side of `offset`, low and dangerous through the middle of its swing and
  lifted clear of a kart's roof at each end), `crush` (a stomper or icicle:
  up, then from half the cycle a shake and a red flush while its shadow
  grows and reddens on the road, a fast fall at 72%, down for a moment, up at
  90%; dangerous only while its underside is under a metre), `slide` (a cart
  or wall panel that crosses the whole road once every cycle from out of
  sight to out of sight, a lamp on a post glowing before it comes; a
  negative `span` runs right to left) and `orbit` with `dir` (a sweeper
  arm: `sweeper()` lays a line of circles from a hub, one way or both).
  `HazardPose.warn` (0..1) is the telegraph the picture shows; `top` is how
  high a crusher hangs. Helpers `sweeper`, `stomperRow` (a wave across the
  lanes, with gaps), `pendulum` and `crosser` spread a piece over its
  hazards. The picture draws one instanced mesh per kind, one for the parts
  that move, one for the parts that never do (gantries, beams, rails, lamp
  posts: written once, on the first frame) and one for the shadows. Reduce
  Motion turns the rattle and the lamp's flicker into a steady colour.
  Mirror mode negates the `span` of a swing or slide (or flips `dir` when a
  slide has no span) so they stay in step with the flipped road.
  The bots read the same poses a couple of seconds ahead, as for any hazard,
  and wait (slow to 55%) or gamble (a tighter line) by skill. Not built yet:
  turntable platforms that carry a kart, floors and gates that rise. Also
  not built, from the round's wish list: the Canyon mine tunnel through the
  mesa and a swaying rope bridge, a Fun Fair funhouse of mirrors and a Ferris
  wheel to drive under with its swinging cars, the Glacier frozen waterfall
  to drive behind and a real rolling avalanche. The Canyon and Glacier road
  layouts are close to round one's; the set pieces are what changed.
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
  road is caught by its sides (a ship's hull across a straight, which a
  surface seen from above would not show):
  `src/kart/render/world/corridor.test.ts` (the code-built world, and the
  lower quality tiers' ground, scenery and grass) and `corridor.art.test.ts` (the
  Blender world: `nodeArt.ts` decodes the Draco files in Node and files them
  where `art.ts` would, so the real landmarks and scenery are measured).
  `CORRIDOR_REPORT=1` prints how far each offender must move. A third,
  `scenery.clear.test.ts`, holds every scattered instance (scenery and
  grass) to the sim's own rule (`kartSpace.ts`: the nearest stretch of road
  and its barrier) through its final matrix and again as each view's culled
  buffer holds it, at every tier, on every track and its mirror, with the
  art and without: nothing 15 cm high on the road or the verge, nothing
  solid in the camera's margin (grass may grow there), and nothing hanging
  over a slope; `clearance.test.ts` checks the scatter's measure against
  the sim's on every track, mirror and dev track. The chase
  camera is held to the same margin (`cameraSpace.ts`): it slides back toward
  the road in a bend, rises over rising ground and stays under a roof.
- **The duck** (`duck`): as in three of the shooting games, a rubber duck
  hides on every track, somewhere off the racing line.
- **Bank**: the road leans where its points say (`TrackPoint.bank`, radians,
  + tipping the right side down, eased from point to point: banked hairpins,
  S-bends that lean one way then the other, a twist on a straight) and, on a
  track that sets `bank` (radians per 1/m of curvature), into every bend by how
  hard it turns; the two add, up to 0.35 rad (`render/world/bank.ts`). For the
  picture: the sim drives on the centre line's height. The ground, verge,
  kerbs, barriers, lamps, karts and item boxes follow it, and mirror mode
  flips it. The track maps (`track/maps/`, written by their test) draw the
  height along the lap under the map, steep stretches in red and crests sharp
  enough to fly over marked, and the lean.

### What each theme can build

| Theme | Landmarks | Hazards |
| --- | --- | --- |
| meadow | windmill, barn, pond, hay-bales, hot-air-balloon, sheep, flower-field | — |
| canyon | mesa, rock-arch (span), cactus-grove, water-tower, mine-cart | boulder, tumbleweed, ore-cart (slide), wrecking-ball (swing), rock-crusher (crush) |
| harbour | crane, lighthouse, ship, containers, warehouse, buoy | crab, forklift |
| kitchen | teapot, fruit-bowl, toaster, grater (span: a tunnel), salt-shaker, pepper-mill, cookbook, cereal-box, mug, fork-arch (span), spoon-arch (span), sink, window, wall-clock | orange (roll), pea (cross), teacup (orbit) |
| snow | igloo, cabin, snowman, ice-arch (span), ice-cave (span: a tunnel), pine-snow, gondola, ski-jump | penguin (cross), snowball (roll), yeti (bob), icicle (crush) |
| volcano | volcano, lava-fall, basalt-columns, stone-bridge (span), obsidian-arch (span), hot-spring | fireball (bob), boulder (roll), geyser (bob) |
| funfair | ferris-wheel, carousel, big-top (span: a tunnel), rollercoaster (span: over the road), entrance-arch (span), food-stall, balloon-stand, hook-a-duck, helter-skelter, fireworks | teacup-ride (orbit), bumper-car (cross), arm-ball (orbit: a carousel's bar), funhouse-panel (slide), mallet (crush), swing-boat (swing) |
| space | ringed-planet, ring-gate (span), asteroid, satellite, space-station, nebula | asteroid (orbit), comet (roll) |
| palm | palm-tree, beach-hut, surfboard, sandcastle, beach-towel, giant-ring (span), wristwatch (span: the start gantry) | crab (cross), coconut (roll), beach-ball (roll) |

## The tracks

Two cups of four, as a Grand Prix is raced, and one secret.

**Acorn Cup**

1. **Meadow Loop** (meadow): the gentle opener. Up the windmill's hill
   (eight metres, leaning into the long left-hander), down an S that leans
   one way then the other, through a hollow and over a low hill to the pond
   by the banked hairpin (the duck); hay bales, a hot-air balloon drifting
   over.
2. **Kitchen Rally** (kitchen): toy-sized karts on a giant kitchen counter
   in late-afternoon sun through the window. A chopping-board start
   straight; round the fruit bowl; a chicane between salt and pepper; under
   the cheese grater (a tunnel); a ramp off a cookbook over the sink (fall in
   and the drone fishes you out — the duck floats in the sink); spilt milk
   (ice) on a bend; the counter's edge is a long open drop on the outside of a
   sweeping curve (the bends lean into their turns, that one highest on its
   open outside); oranges roll down the counter; a teacup spins. Everything is
   enormous: the teapot is thirty metres tall.
3. **Harbour Lights** (harbour): night on the quay, cranes and ships, a
   humpback bridge over a dock and a swing bridge on the back straight to fly
   over, right angles that lean a little into their turns, crabs scuttling
   across the chicane.
4. **Canyon Run** (canyon): the steep climb (sixteen metres), the ridge road,
   a jump over a gap in the ridge, a lip to fly off into the tumble down
   S-bends that lean one way and the other, boulders rolling down the
   descent, a sand cut inside the hairpin for the brave.

   *Design note (round two).* The signature is the old mine: the rails cross
   the road, and the quarry works it. Each lap has four beats you can read
   and time. On the ridge, two ore carts cross the rails one each way (a red
   lamp on a post lights before each runs), twenty metres before the long
   run-up to the gap. After the jump and the lip, a rope bridge: ten metres of
   planks over the gorge with nothing on either side. Down the tumble, two
   wrecking balls swing across the road half a beat apart, so you weave. Out
   of the neck the rails cross again, and then the wash: the gorge opens to
   twenty-two metres of sand with three rock crushers falling in a wave
   (shake, red shadow, slam), and a boost pad in the middle lane, under the
   last one, for the brave. The wow moments: the jump, the bridge, the wash.

**Comet Cup**

5. **Fun Fair** (funfair): dusk, every ride lit. Under the entrance arch;
   past two mallets (test your strength: one up while the other comes down);
   round the carousel; along the rollercoaster's own course, the lift hill
   (six and a half metres, weaving either side of the crest) and the plunge
   to the dip under the coaster; the hairpin by the hook-a-duck stall (the
   duck), banked hard; back through the big top, where striped funhouse walls
   slide across the road one each way; the plaza, where a carousel turns in
   the middle (a bar of horses to time, two ways round) with bumper cars
   crossing and a teacup ride beside; a ramp off the helter-skelter's foot;
   the hall of mirrors chicane under two pirate ships swinging a beat apart;
   fireworks over the finish.

   *Design note (round two).* The fair is a ride, so it has a ride's
   rhythm: a quiet straight, a climb, a drop, a dark tunnel with moving
   walls, a spinning plaza, a chicane. The top straight no longer runs
   flat: its heights are the coaster's (up 6.5 m, down to -2.4 m), so the
   plunge is the fair's wow moment, with a boost pad at the bottom. Every
   moving thing is announced: mallets shake and redden, wall panels light a
   lamp, the carousel turns slowly enough to read (6.5 s).
6. **Glacier Pass** (snow): an alpine pass at blue hour. A frozen lake (all
   ice, wide, level) to slide across in the valley, with a kicker on it (a
   short hop on the ice, a trick for a boost), then a climb of fifteen
   metres to the pass and a corkscrew three quarters of the way round a
   mountain hut, banked hard and falling all the way, a cliff on its outside
   and ice on its tight inside line; a crest to fly over on the shoulder, a
   twisting S that leans one way then the other through an ice cave glowing
   blue, a long falling in-run to a ski-jump over a crevasse (a drop), and
   moguls on the way home. Penguins waddle across, snowballs roll down at
   you, a yeti pops out of a snowdrift once a lap. The duck sits by an
   ice-fishing hole on the lake.

   *Design note (round two).* The pass has weather, and the weather is on a
   timer. In the ice cave three icicles let go one after another down the
   cave (each shakes, and its shadow reddens, a second before it drops), and out of the cave, on the in-run
   to the ski-jump, two big snowballs thunder down, one each side in turn
   (an avalanche you read and slip between, then straight into the jump).
   The lake's kicker is the first wow moment, the corkscrew the second, the
   cave the third, the ski-jump over the crevasse the fourth.
7. **Volcano Rush** (volcano): black rock and rivers of lava (drops). Up the
   volcano's flank in switchbacks (two banked hairpins, boulders rolling down
   the first leg at you); on the second leg a **geyser cannon** (`air` cannon,
   82 m, 8 m up) fires you across a tongue of lava that has eaten 66 m of the
   road (a `gap`: there is no way across on the ground); a ridge twenty-two
   metres up that weaves between lava on the outside of its bends, where the
   **eruption** goes off on the race clock: a pair of lava bombs leaps from
   either side every seven seconds (the middle is clear), the next pair half
   a beat later; then off the brow on a **glide** (140 m, 11 m up, a parasol)
   down the mountain over the open lava fields, steering for the rings painted
   where the road comes back (the boost), and the stone bridge over the lava
   lake with nothing either side, a boost strip along its left half only. The
   volcano smokes behind it all; the duck relaxes in a hot spring beside the
   second hairpin. *Design note:* the old jump over a lava gap became the
   glide, because a ramp can only throw a kart one way and the brow is the
   best view on the track; the cannon is the flank's wow moment and the
   eruption the ridge's; the glide's landing is a straight, level run before
   the last bends.
8. **Starlight Ribbon** (space): the finale. A glowing ribbon of road high
   over a ringed planet: up the twist, where the ribbon rolls one way and
   then the other, two crests with **low-gravity lips** (`air` lip, 64 m, 5 m
   up: a slow, floaty arc each, a trick boosts on landing), a banked carousel
   round the far end that falls all the way, with a **meteor shower** down it
   (two comets a beat apart, one each side) and an asteroid circling it, back
   along a lower ribbon and down it on a **solar-sail glide** (70 m, 7 m up,
   landing rings) and into the **cannon between two ribbons** (88 m, 9 m up,
   over 56 m of nothing). Almost no barriers (fall and the drone brings you
   back), boost strips, ring gates. The duck floats in an astronaut's helmet by
   a satellite. *Design note:* the lips replace the natural crest jumps so the
   floaty arcs are always the same, the asteroid moved off the dip so that
   nothing waits where the lips land, and glide then cannon on one straight is
   the finale's crescendo (a kart that lands the glide on its mark has speed
   for the cannon).

**Secret: Five Finger Circuit** (palm): an island shaped like an open hand,
seen from above — the hand you play with. The road runs up and down every finger
(the fingertips are hairpins), round the thumb, across the palm and back
along the wrist, where a giant wristwatch is the start gantry; a ring to
drive through on the straight by the wrist (the fingers are too close to one
another for anything to stand between them); palm trees, beach huts, crabs, coconuts.
A **wrist cannon** (36 m, 5 m up) on the first diagonal hops a kart up from the wrist
toward the first finger, a **fingertip lip** (34 m, 3.5 m up) hops the first finger's
long leg, and the **thumb glide** (95 m, 8 m up, a parasol) takes a kart off the thumb's
tip and down to the wrist over the water, to rings painted at the foot of the thumb.
*Design note:* the fingers are too close together and the legs too short for long
flights (a cannon needs 20 m of road after it before a hard bend), so the hand gets
short hops and one long glide down the thumb, the one long straight on the map; waves
washing the beach road on a timer are not built (see the timed set pieces). The
minimap is a hand, tilted: every finger climbs to its tip and back. The duck
sunbathes, in sunglasses, in the middle of the palm.
Unlocked by winning both cups (or, for those who know, the Konami code on the
start screen).
