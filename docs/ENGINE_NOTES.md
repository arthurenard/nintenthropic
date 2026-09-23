> Detailed desktop engine reference. For current launch commands, browser play,
> control choices and calibration defaults, see [the main README](../README.md).

# Handy

A finger-pistol arcade with four games: DEAD OF NIGHT, HIGH NOON, ORBITAL
DECAY and OVERWATCH RIDGE. TARGET RANGE is the calibration warm-up: its archery
hall and faces are where you learn the aim and prove it with five accurate hits.

Every one of them is drawn from OpenCV primitives — there is not a single image
asset in the project, and no game engine. Hand tracking is Google's
[MediaPipe Gesture Recognizer](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer),
running entirely on your machine.

## Quick start

```bash
uv run python -m handy
```

That is the whole setup: `uv` creates the environment and installs the
dependencies. The first run downloads two model bundles into
`~/.cache/handy/models/` — the ~8 MB hand recogniser and the ~4 MB face
landmarker the sniper scope uses — and every run after that is fully offline.

**macOS camera permission.** The first launch asks your terminal for camera
access. If you never see a prompt and the app reports it cannot open the camera,
enable it under *System Settings → Privacy & Security → Camera* and restart the
terminal.

## Controls

Every map uses finger-pistol controls. OVERWATCH RIDGE automatically adds an
eye-controlled scope to them.

### FINGER PISTOL

Point your hand like a pistol; the crosshair follows your index fingertip. Drop
your thumb onto your fist to fire.

### AUTOMATIC SNIPER SCOPE

The pistol's hand, plus one eye. Point to aim and drop your thumb to fire,
exactly as with the finger pistol; **close one eye and you look down the
scope.** Open it again and you are back to the wide view.

OVERWATCH RIDGE enables this tracker automatically. Both MediaPipe models run on
the same camera frames — the hand recogniser for aim and trigger, the face
landmarker for the eye — bound into a single subject by `marksman.py`, so the
rest of the game sees one pointer and one trigger. Scope detection uses the
larger of the two lid-closure scores, independent of gaze or wink asymmetry. A
score above 0.55 held for 180 ms engages the scope; below 0.30 releases it. This
filters brief blinks, with 200 ms grace for a missing face. While scoped, hand
movement changes the view at a gain of 0.25, anchored to the point where the
scope was engaged.

**How the scope works.** While the eye is shut the map stops following your
hand with a crosshair and instead *pans its view* with it: the glass shows a
six-times magnification centred wherever your hand is pointing, and the
reticle is fixed at the middle of that glass. A scoped shot goes where the
reticle sits, not where the crosshair was, which is how a rifle behaves and
why the crosshair disappears while you are scoped. The scope shares the
pistol's hand setup, and the eye needs no calibration of its own.

**The game always fills the screen.** There is no windowed mode and no size to
set. Three things together guarantee no grey band, because each covers a way the
other two can be wrong. The window is *free-ratio*: whatever is drawn is
stretched to its full extent rather than letterboxed inside it, so even a frame
of the wrong size fills the screen. The frame is still drawn at the window's
*measured* size, so that stretch is normally zero — fullscreen on a notched
MacBook is 1512x945, not the panel's 1512x982, and only a measurement knows
that. And the measurement waits for macOS to finish animating into fullscreen,
because the first readings describe the window as it was before, and trusting
them is exactly how a band appears. The window is re-measured between screens
too, so a display that changes under a running game is caught.

The interface scales with it. Everything fixed is measured in units of a
720-tall window and multiplied up, so a laptop panel and a large display get the
same interface rather than the same pixel counts — buttons you can hit and text
you can read on both. Targets scale too, so the range plays the same on any
screen.

## Cameras

The desktop app uses the first camera showing a live picture. Name cameras
explicitly to aim with more than one; the browser always uses one.

```bash
uv run python -m handy --list-cameras
uv run python -m handy --camera 0 --camera 2   # only these, no searching
```

**The game says which cameras it is actually using**, on the line under the aim
state: `2 cameras fused` when both are feeding the crosshair, or
`1 of 2 cameras   cam 2 no hand` when one has lost sight of your hand, or
`cam 2 ignored` when setup ruled it out. Each preview in the corner is bordered
green, grey or red to match.

**Where to put the second one.** Off to the side, somewhere between about 20° and
60° from the line between you and the screen. Not at 90°: a camera looking
straight down the axis you sweep your hand along cannot see that sweep at all,
and its map has to stretch a direction it barely resolves. Setup measures this —
it works out each camera's *gain* — and a camera it cannot fit, or whose map is
stretched beyond sense, sits the session out instead of failing the whole setup,
so a badly placed camera costs you nothing.

## Setup

The browser and desktop hand controls use `shot_calibration.py`. Shoot at a lit
target with the built-in thumb gesture. Two usable observations fit scale and
offset; three non-collinear observations fit an affine map, which also absorbs
the rotation and shear of a camera that sits off to one side. The crosshair is
visible after two shots. The initial fit is followed by five distinct target
centres to hit. These verification shots do not train the mapping. A miss may
refit the aim and reset progress; five accurate hits save the result and start
the selected game. Undo and restart remain available. The live camera and hand
skeleton stay visible over the Target Range scene.

The fitter takes the median of the thumb-up positions just before each pull, so
the motion of firing does not move the aim — including a fold that pauses part
way down. It keeps up to three recent observations per target, rejects
degenerate, ill-conditioned or excessive-gain fits, and checks fit residuals.
Those residuals describe calibration consistency, not independently measured
accuracy; the five hits inside the inner two rings are the separate accuracy
check before launch.

With several cameras each one is fitted on its own. A camera that misses the hand
on a shot simply drops out of that shot, and one that cannot be fitted at all is
left out of the aim.

**When a saved setup is reused.** Browser storage is per camera. The desktop
keeps its setup in `~/.cache/handy/calibration.json`, and reuses it only when it
proves it fits: it must have been fitted by this setup (not an older version's),
every number in it finite, every camera's map defined across the whole camera
image, and it must have been made with the same cameras, the same capture size
and the same mirroring as now. Anything else runs setup again — a minute of
shooting targets, against a session spent aiming with a map that points
somewhere else. The file is written whole or not at all, and one unreadable
entry costs only itself.

**An external monitor genuinely helps.** With the webcam directly above the
screen you are aiming at, sweeping the crosshair across the screen barely moves
your hand across the camera frame — you are mostly rotating your wrist — so the
gain from hand movement to crosshair movement is enormous, and every tremor is
magnified with it. Move the camera off to the side and the same sweep costs real
hand travel, the gain drops, and the crosshair steadies. The arithmetic is
direct: if your usable hand travel spans 30% of the frame, one unit of hand shake
becomes 3.3 units of crosshair shake; at 60%, it halves.

## The maps

The chooser comes first — four cards: **shoot the card you want to play**, or
press its number. `b` brings it back at any time, or skip it with `--map zombies`,
`--map western`, `--map orbit` or `--map sniper`. Each map keeps its own high
score for each round length.

Every map is a module that supplies what stands in front of you, what a shot
does to it, and how it is drawn — all of it with OpenCV primitives and numpy.
Whatever does not move (a street, a valley, a station window) is painted once
and copied into each frame; only the moving things and the damage that
accumulates are drawn per frame. See [Performance](#performance) for what that
costs.

Every map runs on the round's own clock. Whatever a map schedules in advance —
the first truck at eight seconds, two patrols already walking the road — is
written in seconds from the start of the round, so it happens on time however
long the machine has been up.

`--seed` fixes a round: the world (who comes out, where and when) draws from its
own generator, apart from the effects of your own shots and anything drawn a
frame at a time, so a miss into the sky or a faster machine does not change what
comes next.

### TARGET RANGE

Archery faces fade in and time out. Ten in the gold down to two in the white.
Calm, and entirely about aim. It is the setup warm-up rather than a card on the
chooser.

### DEAD OF NIGHT

They come up the road out of the fog.

- **Head shots kill outright** and score most. The head is small, and it gets
  smaller with distance.
- **Body shots only slow them down.** Three staggers them and drops them; each
  one knocks it off its stride, which buys you a moment.
- **Distance pays.** A kill is worth `1 + distance / 22 m` times its base score,
  so dropping one where it first appears, up to 14.5 m out, pays about
  two-thirds more than one at arm's length.
- **Do not let them reach you.** One that gets a hand on you takes a bite out of
  your health. Six bites and the night is over — the health bar is notched once
  per bite — and the round ends `OVERRUN` rather than `SURVIVED`.
- **It gets worse.** Every fifteen seconds a new wave: they come more often,
  walk faster, start closer, and more of them stand on the road at once.

Choose **Zombies** or **Humanoid robots** before the round; `N` switches and
starts afresh. Robots have armoured bodies, illuminated visors and spark impacts,
the same head/body damage, score and wave rules, and always stay upright, where
zombies also crawl and limp.

The road is drawn through a real pinhole projection rather than sprites scaled by
eye, so distance behaves the way distance does — apparent height halves when the
distance doubles, the centre-line dashes shorten and converge correctly, and the
roadside posts recede at true spacing. Every figure is drawn from the same
geometry the shot is tested against — head, torso and reaching arms, and the
hunch or lurch that carries the head forward — so the silhouette and the hitbox
cannot drift apart.

### HIGH NOON

A dusty frontier main street, bottles on the rail, bandits in the doorways.

- **Bottles** shatter (30), **cans** spin off the rail (20), **signs** swing
  when you hit them (25). A sign pays once per swing: shots into it while it is
  still swinging are misses, so it cannot be farmed for hits or a streak. The
  rail is restocked a second after you clear it.
- **Bandits** show themselves for a couple of seconds in doorways, windows and
  behind the barrels, and are worth 100 — plus up to 100 more the faster you
  drop them. Under 0.7 s from the moment he has fully stepped out is a
  **QUICK DRAW**.
- **Townsfolk step out too.** Shooting one costs 50 and tolls the church bell,
  and a clean round — nobody innocent hit — is scored `CLEANED UP`.
- **The sun moves.** The street is rebuilt six times over a round as the light
  goes amber and the shadows stretch; every building, barrel and shadow is
  drawn, not sprited. Missed shots leave holes in the wood and ricochet off
  everything else; tumbleweed and dust drift through between.

### ORBITAL DECAY

Debris tumbling past a station window. Out there, nothing makes a sound.

- Fragments come in on ballistic arcs from sixteen to twenty-seven metres out;
  some will miss the station, some are coming straight at the glass.
- **A shot on a big fragment does not remove it — it splits it**, and the
  pieces keep the parent's momentum, parting only slowly. Split one that is
  coming at the glass and most of it is still coming, in more pieces: a careless
  shot turns one problem into two. Small pieces are cleared outright (80,
  doubled for a hit at spawn depth); a split is worth 40.
- **The pane keeps a ledger.** Every fragment that reaches it costs integrity
  in proportion to its mass and speed, and cracks the glass where it struck.
  Below 35 the alarm sounds; at zero the pane fails and the round is over:
  `PANE FAILED` rather than `PANE HELD`.
- **A maintenance drone is working outside.** It is not debris. Hitting it
  costs 150.

The shot is suppressed and what you hear of a hit is what comes through the
hull; a fragment's silhouette on screen is exactly the polygon the hit test
uses.

### OVERWATCH RIDGE

A long valley at golden hour, a rifle, and an eye for the scope. Unscoped you
see the whole valley and shoot from the hip, which at two to six hundred metres
is hopeless.

- **Close one eye to scope in.** The view jumps six times closer, pans with
  your hand, and a fixed reticle sits at the centre of the glass. The readout
  above it gives the range to whatever the reticle rests on, and the wind.
- **Real ballistics.** The round takes time to get there, drops on the way,
  and the wind pushes it sideways, all in proportion to the distance. The
  reticle's mil marks are calibrated to that drop, so holding a mark high at
  the range the HUD reads is how you hit. You hear the bolt cycle after each
  shot and the impact a moment later, when the round arrives.
- **Head shots kill** (100, the driver of the truck 150); body shots wound
  (10), and three of them drop a patrol (40). A kill pays more the further away
  it was, `1 + distance / 250 m`, and 15% more again at each stage, which
  advances every twenty seconds. Wounds and hits on the truck's hull (6) pay a
  flat amount.
- The valley is the same pinhole projection the road is: sentries on their
  posts, patrols walking the road, a truck every half minute, and the sway of
  your own breathing on the glass.

## How to play

- **Aim** — hold your hand as a pistol and point it at the screen. The crosshair
  follows your index fingertip across the calibrated box.
- **Fire** — rotate your thumb down onto your fist, like a hammer falling. Raise
  it back up to re-cock: one fold is one shot, never a burst.
- **Score** — each map scores in its own terms, above. Consecutive hits build a
  streak.
- **Beat the clock** — a round is 60 seconds. When it ends you get a score card
  with your accuracy, best streak and the map's own highlight, and your record
  for that map and round length is kept in `~/.cache/handy/scores.json`. The
  card ignores the trigger for its first second and then wants a fresh pull, so
  a shot fired at the buzzer cannot skip it; shoot again to play another round.
- **Quit** — shoot the **QUIT** button in the top-right corner, click it, or
  press `q`.

Play `--duration 0` for an endless round with no clock.

The webcam preview sits in the top-left corner at a quarter of the window's width
and height, with the tracked skeleton drawn on it so you can see what the model
sees.

| Key | Action |
| --- | --- |
| `q` / `Esc` | quit |
| `r` | restart the round |
| `b` | back to the map chooser |
| `c` | run setup again |
| `n` | Dead of Night: switch zombies / robots and start afresh |
| `space` | on the score card, play again |
| `s` | save a screenshot to `screenshots/` |

Mirroring is not among them. Setup fits each camera's map against one
handedness of the landmark stream, so flipping the image mid-round sends every
aim point to the opposite side of the screen. It is chosen at launch instead,
with `--no-mirror` — and a setup saved with the other choice is not reused.

## How the trigger works

The gun reads two things about your thumb, both measured against your own hand
rather than the screen, so you can tilt and roll your wrist while tracking a
target without the gun going off:

- its **angle** from the hand's up axis — wrist to middle knuckle — which says
  exactly what it should: *the thumb is no longer pointing up*;
- its **reach**: how far the thumb tip is from the index knuckle, in palm spans.

Each becomes a travel from 0 (cocked) to 1 (fully folded) — the angle from 25°
to 65°, the reach from 0.85 to 0.40 palm spans — and the trigger follows
whichever has travelled further. It fires when that passes half way and re-arms
once it is back under 0.3, so either a rotation or a fold toward the knuckle
fires, and both must release before the next shot. The gap between the two is
hysteresis: a thumb hovering at one line cannot chatter.

A median over the last three readings stops a single misread frame from firing;
each recognition result is heard once, so a frame delivered twice cannot become
two of those three. A hand that is acquired with the thumb already folded never
fires until the thumb has been raised, and a hand that blinks out of tracking
keeps its state rather than re-cocking. None of this is learned during setup,
and there is nothing to calibrate. `--fire-above` and `--arm-below` move the two
lines.

The thumb angle is computed from a cross and dot product rather than from
`acos`, which loses its precision exactly where the two poses have to be told
apart: when the vectors are nearly parallel.

## Recoil

Each shot kicks the crosshair up and it settles back over about a quarter of a
second, so emptying the magazine as fast as your thumb allows genuinely costs
accuracy. Measured over a simulated 60-second round: spraying six shots a second
drops from 45 bullseyes to 21 with recoil on, while shooting twice a second is
completely unaffected. Set `--recoil 0` to turn it off.

## Sound

Every sound is synthesised with numpy at startup — there are no asset files, and
no dependency beyond the `sounddevice` that MediaPipe already installs. The shot
is a noise crack over a falling tone, the hit is a ping that rises the closer you
land to the gold, the miss is a dull thud.

On the road the same machinery plays a wavering low groan when something new
comes out of the fog, a wet impact that cracks on a head shot, and a body blow
when one reaches you.

The other maps each speak in their own voice, again all synthesised and all
registered by name in `audio.py` so a map can ask for a sound with a string and
nothing else. A map raises a cue by appending its name to the round's cue list;
the app drains that list every frame and plays each one. HIGH NOON has a rifle
crack, breaking glass, a ricochet, splintering wood, a bandit going down, the
church bell and the wind. ORBITAL DECAY has a suppressed shot, the tick of debris
on the hull, a heavier thud, the crack of the glass, the alarm and the static of
a hit on the drone. OVERWATCH RIDGE has the rifle's report, the bolt cycling, the
scope going in and out, a distant impact, the ping of a head shot and gusts of
wind. Each is built in a few takes at slightly different pitches so nothing
repeats exactly.

The full set is seconds of DSP, so it is synthesised on a worker thread while
you play. That thread builds one plain take of every named cue *first* and makes
it live immediately; the richer takes replace them when they land. Meanwhile the
main thread gets an instant kit — one take of the shot, the cock, the ring
pings, the groans — so the menus are never waiting on a synthesiser. With
`--mute`, or when no audio device can be opened, nothing is synthesised at all.

The useful one is the soft click when the pistol re-cocks: it tells you the gun
is ready without your having to look away from the target. If no audio device can
be opened the game says so once and plays on in silence. `--mute` and
`--volume 0.4` do what you would expect.

## What a second camera does

A single camera cannot tell distance from displacement: move your hand a little
closer to it and the picture changes much as it would if you had moved sideways.
A second camera, placed off to the side, sees that sweep from another angle.

Each camera's aim is weighted by how little its map magnifies noise, so the
camera that resolves your movement best counts most, and one whose map is
stretched beyond sense is not listened to at all. That judgement uses the
largest singular value of the map's local Jacobian, not the square root of its
determinant: a nearly side-on camera has a map enormously stretched in one
direction and squashed in the other, and the determinant — a geometric mean —
hides exactly that. Worst-case amplification is what decides when to stop
listening.

An earlier version also solved for the depth drift two cameras disagree about.
That needed a per-camera measurement the shooting setup never takes, so it never
ran, and it has been removed rather than advertised.

## Steadying the crosshair

Aiming runs through a [One Euro filter](https://gery.casiez.net/1euro/), which
adapts to how fast your hand is moving: it smooths hard when you are holding
still on a target, where jitter is what you notice, and lets go when you sweep
across the screen, where lag is what you notice. A fixed smoothing factor has to
choose one or the other. A stalled clock or a garbled sample holds the crosshair
where it is rather than throwing it.

If the crosshair still shivers when you hold it, lower `--min-cutoff`. If it
feels like it drags behind a fast sweep, raise `--beta`.

## Options

```bash
uv run python -m handy --map sniper --duration 90 --seed 42
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--map` | chooser | `zombies`, `western`, `orbit` or `sniper`, skipping the chooser |
| `--enemy` | `zombies` | Dead of Night opponent: `zombies` or `robots` |
| `--camera` | first live camera | webcam index; repeat it to aim with several |
| `--list-cameras` | | list available cameras and exit |
| `--capture` | `1280x720` | camera resolution |
| `--no-mirror` | off | show the raw image instead of a mirrored one |
| `--duration` | `60` | seconds per round, up to 3600; `0` plays endlessly |
| `--recoil` | `26` | pixels the crosshair kicks per shot; `0` disables |
| `--mute` / `--volume` | on / `1.0` | sound output; volume 0–1 |
| `--min-cutoff` | `1.2` | crosshair steadiness when still, in Hz |
| `--beta` | `0.8` | filter responsiveness |
| `--fire-above` | `0.5` | trigger travel that fires |
| `--arm-below` | `0.3` | travel it must return under to re-cock |
| `--calibrate` | off | run setup again even if one is saved |
| `--no-calibration` | off | skip setup, use the built-in defaults |
| `--calibration-file` | `~/.cache/handy/calibration.json` | where setup is stored |
| `--targets` | `3` | how many targets a round opens with (not High Noon) |
| `--spawn-interval` | `1.1` | seconds between spawns as a round opens (not High Noon) |
| `--lifetime` | `5.0` | seconds a Target Range face stays up; no playable map reads it |
| `--seed` | random | fix the round, for practice |
| `--debug` | off | show the live thumb reading and fps |
| `--screenshot-dir` | `screenshots/` | where `s` saves frames |
| `--model` | cached download | path to your own hand `.task` bundle |

`--calibrate` and `--no-calibration` cannot be combined. Values that cannot be
played — a negative duration, an infinite recoil, no targets — are refused in
the terminal rather than discovered with the window already fullscreen.

## Everything runs on your Mac

Inference is 100% local: MediaPipe loads the `.task` bundles from disk and runs
them on the CPU through XNNPACK. No frame, landmark or gesture ever leaves the
machine, and nothing is sent to Google.

The only external network access is the one-time model download in `models.py`.
It fetches a pinned version of each bundle, gives up after 30 seconds of silence
rather than hanging the launch, and checks the file's SHA-256 before trusting
it. Delete `~/.cache/handy/models/` and it downloads again; keep it and the
desktop app never opens a socket. (Browser mode serves the page on 127.0.0.1
only.) `tests/test_offline.py` enforces this: it monkey-patches
`socket.connect`, `connect_ex`, `create_connection` and `getaddrinfo` to raise,
then runs both inference paths — any stray network call fails the suite.

To be certain it never reaches the network, point at the cached bundle directly:

```bash
uv run python -m handy --model ~/.cache/handy/models/gesture_recognizer.task
```

## Layout

```
handy/
  models.py           downloads, verifies and caches the .task bundles
  recognition.py      MediaPipe hand wrapper -> plain Hand / Frame dataclasses
  schemes.py          the finger-pistol control and the sniper's eye scope
  faces.py            face tracking for the sniper scope
  marksman.py         a hand and a face from one camera, read as one subject
  display.py          measuring the screen before anything is drawn on it
  filtering.py        One Euro filter and friends, for a steady crosshair
  homography.py       fits and applies the hand-to-screen map
  fusion.py           combines several cameras' aim into one
  cameras.py          finding and opening the cameras
  audio.py            numpy-synthesised sound effects and a small mixer
  highscores.py       the best score for each map and round length
  storage.py          writing a file whole or not at all
  aiming.py           landmarks -> thumb reading, crosshair position, trigger pulls
  calibration.py      the rig a setup produces, and the book it is saved in
  shot_calibration.py the Target Range setup: shoot targets, fit, verify
  game.py             the round every map shares: clock, score, streaks, shots
  maps/
    archery.py        the target range: rings, spawning, fading
    zombies.py        the road: perspective, walkers, damage, waves
    western.py        the street: buildings and shadows by the hour, bottles, bandits
    orbit.py          the window: debris on arcs, splitting, the pane's integrity
    sniper.py         the valley: the scope, ballistics, wind, the reticle
  scene.py            shared chrome - HUD, crosshair, setup, chooser, score card
  rendering.py        hand skeleton, drawn into the webcam inset
  app.py              window layout and the capture -> aim -> score -> draw loop
  browser.py          the local browser arcade: HTTP server and game sessions
  web/                its dependency-free HTML, CSS and JavaScript
  cli.py              argument parsing and entry point
tests/                geometry, filtering, calibration, game rules, layout and
                      drawing, the browser server, plus the offline guarantee
                      and end-to-end checks against the real model
```

A map supplies what stands in front of you, what a shot does to it, and how it
is drawn; `game.py` owns everything about keeping the round. Adding a map means
one module and one entry in the registry. A map lays out what it schedules in
seconds from the start of the round and shifts it in `Round.begin`, and draws
cosmetic randomness from `effects_rng` (or a `stream` of its own) so that
`--seed` keeps meaning the same round.

A control scheme supplies a two-dimensional pointer and one trigger measurement.
The sniper map adds an eye-closure reading for the scope. Hand setup, the aim
map, camera fusion, filtering and recoil are shared across every map.
Internally, `marksman.py` combines the hand and face trackers; players do not
choose a separate control scheme or calibrate their eyes.

`filtering.py`, `homography.py`, `fusion.py`, `aiming.py`, `calibration.py`,
`shot_calibration.py`, `game.py`, the maps' rules, `highscores.py` and the mixer
in `audio.py` are pure Python — no OpenCV window, no camera, no sound card — so
the whole aim, trigger, setup, recoil and scoring path is unit tested against
synthetic hands with geometry the tests control exactly. `recognition.py`
converts MediaPipe's result objects into small frozen dataclasses, so nothing
else in the project touches the MediaPipe API.

## Performance

Measured at 1512x945 on an Apple silicon Mac, with the caches warm (median per
frame of `draw_world`):

| map | ms/frame |
| --- | --- |
| Target Range | 2.2 |
| Dead of Night (zombies / robots) | 1.7 / 1.4 |
| High Noon | 1.2 |
| Orbital Decay | 1.3 |
| Overwatch Ridge, unscoped / scoped | 2.7 / 6.2 |

The scenery a map does *not* redraw — its road, sky, station, valley, and each
of High Noon's six hours of light — is built once and cached on its size and
seed. Those take up to a few hundred milliseconds to build, so `app.warm_maps`
pre-builds every map's backdrop, every High Noon hour included, on a background
thread while you are still choosing what to play, and a round's clock does not
start until its first frame has been drawn. Dead of Night's moon glow, once a
single full-frame blur that took most of three seconds, is now blurred at a
fraction of the size and scaled back up, indistinguishable to within a couple of
levels.

The HUD's translucent plates reuse their blend mask rather than rebuilding it
every frame, and the round clock blends only its own pill, not the whole frame.

## Development

```bash
uv run pytest
uv run ruff check handy tests
node --check handy/web/app.js
```

`tests/data/portrait.jpg` and `tests/data/thumbs_down.jpg` are MediaPipe's own
published samples, used as fixtures so the face and hand tests run against the
real models rather than only synthetic landmarks. Tests that need a model bundle
skip, rather than fail, when it is not cached and the network is unavailable.
The suite never writes into your own `~/.cache/handy` apart from that models
folder, and a test checks it.

The lint is not there for style. A suite of pure unit tests never imports the
entry point, so it cannot see a stale definition left shadowing an import, or a
name that no longer exists on a branch nothing covers — `F811` and `F821` catch
exactly those. `tests/test_app.py` closes the same gap from the other side: it
runs the real startup path with only `cv2.VideoCapture` replaced, so every
signature between the entry point and the camera is the real one.

MediaPipe is pinned to the 0.10 line: version 1.x aborts on macOS with
`Check failed: service_ Service is unavailable` when its Metal path initialises.

The project is not installed into the virtualenv (`package = false`); it is
imported from the checkout. That was first adopted because the project lived in
an iCloud-synced Desktop, which marks files under a dot-directory as hidden —
and CPython skips a hidden `.pth` file, so an editable install broke minutes
after a successful `uv sync`. Keep the checkout out of iCloud-synced folders.

## Notes

Recognition is asynchronous: frames are pushed into MediaPipe's live-stream mode
and the newest available result is drawn, so the crosshair never stalls waiting
on inference. On Apple silicon this comfortably keeps up with a 720p stream.

Aiming deliberately follows the *position* of your hand rather than the direction
your finger appears to point: when you aim at the screen, the index finger points
at the camera and is so foreshortened that its 2D direction carries almost no
information. The thumb, side-on to the camera, stays perfectly readable — which
is why it makes the trigger.

The aim map is fitted in Hartley-normalised coordinates and refused when it is
ill-conditioned — points a hair off a line are as degenerate as points on it —
and a point past a projective map's horizon is refused rather than thrown to the
opposite corner of the screen.
