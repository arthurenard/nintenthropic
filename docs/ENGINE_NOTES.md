> Detailed desktop engine reference. For current launch commands, browser play,
> control choices and calibration defaults, see [the main README](../README.md).

# Handy

A finger-pistol arcade with four games: DEAD OF NIGHT, HIGH NOON, ORBITAL
DECAY and OVERWATCH RIDGE. TARGET RANGE is the calibration warm-up. Its original
archery hall and faces are reused to learn aim and verify five accurate hits.
SUNSET SPEEDWAY is not offered in the game; its engine remains an internal
rendering and physics reference in this document.

Every one of them is drawn from OpenCV primitives — there is not a single image
asset in the project, and no game engine. Hand tracking is Google's
[MediaPipe Gesture Recognizer](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer),
running entirely on your machine.

## Quick start

```bash
uv run python -m handy
```

That is the whole setup: `uv` creates the environment and installs the
dependencies. The first run downloads the ~8 MB model bundle into
`~/.cache/handy/models/`; every run after that is fully offline.

**macOS camera permission.** The first launch asks your terminal for camera
access. If you never see a prompt and the app reports it cannot open the camera,
enable it under *System Settings → Privacy & Security → Camera* and restart the
terminal.

## Controls

Shooting maps use finger-pistol controls. OVERWATCH RIDGE automatically adds
an eye-controlled scope to those hand controls.

### FINGER PISTOL

Point your hand like a pistol; the crosshair follows your index fingertip. Drop
your thumb onto your fist to fire.

### AUTOMATIC SNIPER SCOPE

The pistol's hand, plus one eye. Point to aim and drop your thumb to fire,
exactly as with the finger pistol; **close one eye and you look down the
scope.** Open it again and you are back to the wide view.

OVERWATCH RIDGE enables this tracker automatically for hand controls. Both MediaPipe models run on the same camera frames — the hand
recogniser for aim and trigger, the face landmarker for the eye — bound into a
single subject by `marksman.py`, so the rest of the game sees one pointer and
one trigger. Scope detection uses the larger of the two lid-closure scores,
independent of gaze or wink asymmetry. A score above 0.55 held for 180 ms engages
the scope; below 0.30 releases it. This filters brief blinks, with 200 ms grace
for a missing face. While scoped, hand movement changes the view at a gain of
0.25, anchored to the point where the scope was engaged.


**How the scope works.** While the eye is shut the map stops following your
hand with a crosshair and instead *pans its view* with it: the glass shows a
six-times magnification centred wherever your hand is pointing, and the
reticle is fixed at the middle of that glass. A scoped shot goes where the
reticle sits, not where the crosshair was, which is how a rifle behaves and
why the crosshair disappears while you are scoped. Setup is the pistol's
setup — the hand-to-screen map learned by shooting targets — and the
sniper tracker reuses the same hand calibration as the other shooting maps.
The eye scope has no calibration step.

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

The desktop app selects the first live camera. Name additional cameras explicitly
to use depth fusion with hand controls. The browser uses one camera.

```bash
uv run python -m handy --list-cameras
uv run python -m handy --camera 0 --camera 2   # only these, no searching
```

One camera is enough. Two are better, and the reason is specific: a single camera
cannot tell distance from displacement. Move your hand a little closer to it and
the picture changes in exactly the way it would if you had moved sideways, so the
crosshair drifts and nothing in that camera's view can say so.

**The game says which cameras it is actually using**, on the line under the aim
state: `2 cameras fused` when both are feeding the crosshair, or
`1 of 2 cameras   cam 2 no hand` when one has lost sight of your hand, or
`cam 2 ignored` when setup ruled it out. Each preview in the corner is bordered
green, grey or red to match. With `--debug` the same line adds how far apart the
cameras are and the depth that disagreement solved to.

**Where to put the second one.** Off to the side, somewhere between about 20° and
60° from the line between you and the screen. Not at 90°: a camera looking
straight down the axis you sweep your hand along cannot see that sweep at all,
and its map has to stretch a direction it barely resolves. Setup measures this
and says so — it prints each camera's *gain*, and refuses to listen to one whose
map is stretched beyond sense, so a badly placed camera costs you nothing.

## Setup

The browser and desktop hand controls use `shot_calibration.py`. Shoot at a lit
target with the built-in thumb gesture. Two usable observations fit scale and
offset; three non-collinear observations fit an affine map. The crosshair is
visible after two shots. The initial fit is followed by five distinct target
centres to hit. These verification shots do not train the mapping. A miss may
refit the aim and reset progress; five accurate hits save the result and start
the selected game. Undo and restart remain available. The live camera and hand
skeleton stay visible over the Target Range scene.

The fitter takes the median of recent thumb-up positions before each pull,
avoiding motion caused by shooting. It keeps up to three recent observations per
target, rejects degenerate or excessive-gain fits, and checks fit residuals.
These residuals describe calibration consistency, not independently measured
accuracy. Five shots within the inner two target rings provide the separate
accuracy check before launch.

The sniper shares this hand mapping. Its eye scope and the thumb trigger need
no calibration. Browser storage is per camera; desktop storage is at
`~/.cache/handy/calibration.json`. The older pose-based fitter remains available
internally for geometry experiments and regression tests. The projective and
depth-fitting studies below describe that experimental fitter, not the shooting
setup presented to players.

## Where your camera sits

The grid exists because the map from hand to screen depends on where your camera
is relative to what you are aiming at, and that map is a **homography** — the
general projective transform between two planes. It absorbs rotation, shear,
scale and keystone all at once. Two calibration points can only describe an
axis-aligned rectangle, which is the one case that almost never holds.

Simulated over a 1280×720 window, with realistic per-frame landmark shake
averaged over the dwell exactly as the real session does:

| camera placement | two-point box | nine-point fit |
| --- | --- | --- |
| square on | 74 px mean, 115 px worst | **4 px, 8 px** |
| slightly off-axis | 108 px, 190 px | **4 px, 10 px** |
| beside the monitor | 214 px, 413 px | **6 px, 14 px** |
| far off-axis | 438 px, 1039 px | **11 px, 26 px** |

Four points determine a homography exactly, which is enough — but their residual
is then always zero, so they cannot tell you the trace was shaky. Nine points are
fitted by least squares, so the error printed at the end of setup is a real
measurement of how well it went.

**An external monitor genuinely helps**, for a reason separate from all of the
above. With the webcam directly above the screen you are aiming at, sweeping the
crosshair across the screen barely moves your hand across the camera frame — you
are mostly rotating your wrist — so the gain from hand movement to crosshair
movement is enormous, and every tremor is magnified with it. Move the camera off
to the side and the same sweep costs real hand travel, the gain drops, and the
crosshair steadies. The arithmetic is direct: if your usable hand travel spans
30% of the frame, one unit of hand shake becomes 3.3 units of crosshair shake; at
60%, it halves. Previously that gain was paid for with a badly-shaped map — now
it is not.

## The maps

The chooser comes first — four cards: **shoot the card you want to play**, or
press its number. `b` brings it back at any time, or skip it with `--map range`,
`--map zombies`, `--map western`, `--map orbit` or `--map sniper`.
Each map keeps its own high score for each round length; the race is not run
against the round clock, so all of its results share one bucket.

Every map is a module that supplies what stands in front of you, what a shot
does to it, and how it is drawn — all of it with OpenCV primitives and numpy.
Whatever does not move (a street, a valley, a station window) is painted once
and copied into each frame; only the moving things and the damage that
accumulates are drawn per frame. See [Performance](#performance) for what that
costs.

### TARGET RANGE

Archery faces fade in and time out. Ten in the gold down to two in the white.
Calm, and entirely about aim.

### DEAD OF NIGHT

They come up the road out of the fog.

- **Head shots kill outright** and score most. The head is small, and it gets
  much smaller with distance — at twenty metres it is a couple of pixels across.
- **Body shots only slow them down.** Three staggers them and drops them; each
  one knocks it off its stride, which buys you a moment.
- **Distance pays.** A kill at twenty-five metres is worth twice one at three,
  because it is a harder shot and it buys more road.
- **Do not let them reach you.** One that gets a hand on you takes a bite out of
  your health. Four bites and the night is over: `OVERRUN` rather than `SURVIVED`.
- **It gets worse.** Every fifteen seconds a new wave: they come more often,
  walk faster, and more of them stand on the road at once.

The road is drawn through a real pinhole projection rather than sprites scaled by
eye, so distance behaves the way distance does — apparent height halves when the
distance doubles, the centre-line dashes shorten and converge correctly, and the
roadside posts recede at true spacing. Every figure is drawn from the same
measurements the shot is tested against, so the silhouette and the hitbox cannot
drift apart.

### HIGH NOON

A dusty frontier main street, bottles on the rail, bandits in the doorways.

- **Bottles** shatter (30), **cans** spin off the rail (20), **signs** swing
  when you hit them (25, with a cooldown so you cannot farm one). The rail is
  restocked a second after you clear it.
- **Bandits** show themselves for a couple of seconds in doorways, windows and
  behind the barrels, and are worth 100 — plus up to 100 more the faster you
  drop them. Under 0.7 s from his appearing is a **QUICK DRAW**.
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
  pieces keep the parent's momentum, so a careless shot turns one problem into
  two. Small pieces are cleared outright (80, doubled for a hit at spawn
  depth); a split is worth 40.
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

A long valley at golden hour, a rifle, and an eye for the scope. Hand controls add the eye scope automatically — unscoped you see the whole valley and shoot from the hip, which
at two to six hundred metres is hopeless.

- **Close one eye to scope in.** The view jumps six times closer, pans with
  your hand, and a fixed reticle sits at the centre of the glass. The readout
  above it gives the range to whatever the reticle rests on, and the wind.
- **Real ballistics.** The round takes time to get there, drops on the way,
  and the wind pushes it sideways, all in proportion to the distance. The
  reticle's mil marks are calibrated to that drop, so holding a mark high at
  the range the HUD reads is how you hit. You hear the bolt cycle after each
  shot and the impact a moment later, when the round arrives.
- **Head shots kill** (100, the driver of the truck 150); body shots wound,
  three of them drop a patrol (40). Every hit pays more the further away it
  was, and more again as the stages advance every twenty seconds.
- The valley is the same pinhole projection the road is: sentries on their
  posts, patrols walking the road, a truck every half minute, and the sway of
  your own breathing on the glass.

### SUNSET SPEEDWAY (internal reference)

The one map you do not shoot. A kart race at golden hour — three laps against
five rivals on a circuit generated fresh from the seed, and the controls are an
invisible steering wheel. A lap comes out between 2 500 and 3 000 units of road
in fifteen to seventeen straights and corners — around 55 seconds a lap, and
two and a half to three minutes a race.

**The grid waits for you.** Nothing happens until both hands are up: the screen
says HANDS ON THE WHEEL, and gripping with both fists starts the lights.

**The countdown is the calibration.** There is no setup step and no calibration
file for the race. Instead, the three seconds you sit gripped and ready at the
lights *are* the measurement: the game takes the median roll of the last second
or so of two-handed grip and makes that straight-ahead. However you actually
hold the wheel — a tilted camera, a comfortable lean, one shoulder lower than
the other — stops steering the kart.

A grip it cannot believe is refused rather than adopted: readings spread over
20° apart are hands still moving rather than a resting grip, and a median past
25° is more likely someone caught mid-turn than a posture. It keeps asking for
2½ seconds after the lights, and only then settles for the nearest plausible
neutral — half a phantom pull beats a whole one — and lights **LEVEL** on the
wheel widget so a race-long pull is something you can see the reason for
instead of something that feels like the game ignoring you. `r` restarts.

Then:

- **Roll to steer.** The line between your wrists is the wheel's spoke. 50° of
  roll is full lock — a turn of the forearms, not a contortion — and the
  response is deliberately soft near centre and firm out at the lock, because a
  webcam wheel wobbles a few degrees just sitting still.
- **Your grip is the throttle.** A closed fist is flat out, fingers half
  uncurled is a lift, and flat palms are the brake. The middle of that range is
  the point: without a trailing throttle the only speed control on the whole
  wheel is an on-off brake, so every corner is taken at either everything or
  nothing — and a driver who cannot shed *a little* speed cannot drive a corner
  at all through a fifth of a second of camera lag. Off the throttle the kart
  slows at about a third of braking.
- **Open both hands to brake.** Two consecutive fresh readings of both palms
  open, so one misread frame is not a stab at the brake pedal. Grip is the
  whole game: carry too much speed into a bend and the kart ploughs wide toward
  the gravel and the wall. Off the road you keep a bit over half your grip on
  the shoulder and a quarter of it out in the deep stuff, with a **GRAVEL**
  badge under the minimap saying so.
- **Losing a hand is not an input.** One wrist visible holds the last two-hand
  steer for ¾ of a second and then eases off; losing both coasts the steering
  back to centre over 0.4 s rather than snapping. A dropout is never remapped
  from wherever the surviving wrist happens to sit.
- **Drift and boost.** Hold most of full lock above 58% of top speed and, after
  a third of a second, the back steps out — faster under braking. The sparks
  count the charge in three hard steps you can read mid-corner at 170 km/h:
  **blue**, then **orange**, then **magenta-white**. Straightening out of a
  0.9-second slide pays a 0.9-second boost; hold it for 1.8 seconds and it pays
  2.0. The boost is worth about a quarter over top speed, and the exhaust will
  not pay out again for two seconds.
- **A slide is a wager, not a shortcut.** Sideways buys a sliver more rotation
  than gripping does and no more, and it bleeds speed the whole time it lasts.
  The boost at the end is the *only* thing that pays for it: hold the slide,
  straighten cleanly, and you come out ahead; botch the exit and you simply
  went slower. The lateral advantage used to be worth far more than that, which
  made "never stop sliding" the fastest way round by 8.5% of a race — at which
  point the drift stops being a decision, and hand tracking jittery enough to
  trip the gate is *rewarded* for being jittery.
- **The circuit has teeth.** Corners are dealt from a vocabulary of sweepers,
  bends and hairpins, and the generator *drives* each candidate lap flat out to
  certify that at least two of its corners genuinely put a kart that never
  lifted into the gravel before the exit. A lap nobody ever has to lift for is
  a lap nobody has to drive.
- **The rivals race their own race**, at 76–97% of your top speed, with a light
  rubber band in both directions — a touch more mercy when you are behind than
  chase when you are ahead.

The HUD is four corners and nothing in the middle of the picture:

- **Top left** — position, lap and clock on one plate; a **BOOST** tile that
  appears beside it only while the exhaust is actually holding something, and
  is simply not there the rest of the time; and under both the **DRIFT** meter,
  one bar in the charge's own colour filling through its three stages, so what
  you have banked is readable without looking away from the corner.
- **Top right** — the circuit and everyone on it, with the **GRAVEL** badge
  appearing under it the moment a wheel leaves the tarmac.
- **Bottom right** — the speedometer, a horizon line under the dial that tilts
  with the wheel you are actually holding, and under both a wordless pedal-travel
  bar: green as the throttle fills off your hands, flooded red under braking.
  The throttle is an axis, not a switch — a grip is full power, fingers
  half-uncurled is a lift — and how far that pedal has travelled is the one
  thing the dial and the wheel do not already tell you.
- **Bottom left** — the running order, one row per kart in classification order
  with your own row picked out in gold. A status row appears under it only when
  you can do something about what it says: **WHEEL LEVEL?** when the neutral had
  to be guessed and the kart may pull all race, **HANDS OFF** when it cannot see
  you at all. When the wheel is behaving, the row is simply not there — a lamp
  that reports "normal" for a whole race is noise wearing the costume of
  information.

The two opaque pods in the bottom corners get out of the way on their own: when
a kart's footprint reaches into one, that pod blends the road back over itself
for as long as the kart is there, so a rival drawing alongside is never hidden
behind an instrument.

Finishing pays 20 points a place from the back, so P1 of six is 120 and P6 is
20, filed under one high-score bucket per map because a race is not run against
the round clock. On the results screen — podium, full classification, your lap
times with the best one flagged — **open both hands and then close them** to
race again. Both halves of that, so neither crossing the line braking nor
simply relaxing your arms can wipe the classification away before you have read
it.

During a race `q`/`Esc` quit, `b` goes back to the chooser and `r` restarts.
The other keys belong to the aiming loop and do nothing here — there is no
setup to redo, no scheme to switch, and no clock to run out.

On the way out the session prints the last thing you played, in that map's own
terms: `SUNSET SPEEDWAY: P1 of 6, 3/3 laps, best lap 53.3 s` if you saw the
flag, and `retired at 1/3 laps` if you did not. A race is not measured in hits
and shots, so it does not report them.

All of it runs on the same single camera and the same MediaPipe hand model as
the pistol — the wheel just tracks two hands instead of one.

## How to play

On the five shooting maps:

- **Aim** — hold your hand as a pistol and point it at the screen. The crosshair
  follows your index fingertip across the calibrated box.
- **Fire** — rotate your thumb down onto your fist, like a hammer falling. Raise
  it back up to re-cock: one fold is one shot, never a burst.
- **Score** — targets are worth 10 in the gold down to 2 in the white ring, and
  they fade away after a few seconds. Consecutive hits build a streak.
- **Beat the clock** — a round is 60 seconds. When it ends you get a score card
  with your accuracy, best streak and bullseyes, and your record for that round
  length is kept in `~/.cache/handy/scores.json`. Shoot anywhere to play again.
- **Quit** — shoot the **QUIT** button in the top-right corner, click it, or
  press `q`.

Play `--duration 0` for an endless practice range with no clock.

On SUNSET SPEEDWAY there is no clock and nothing to shoot: hold both hands up
to start, drive three laps, and the flag ends it. `--duration`, `--recoil`,
`--targets`, `--spawn-interval` and `--lifetime` have nothing to act on there,
and neither do the trigger and crosshair flags.

The webcam preview sits in the top-left corner at a quarter of the window's width
and height, with the tracked skeleton drawn on it so you can see what the model
sees — in a race it shows both hands, and its border goes grey when the wheel
has lost them.

| Key | Action | In a race? |
| --- | --- | --- |
| `q` / `Esc` | quit | yes |
| `r` | restart the round | yes |
| `b` | back to the map chooser | yes |
| `c` | run setup again | no — a race has no setup |
| `e` | return to hand controls | no — a race has no aiming |
| `space` | on the score card, play again | no — open then close both hands instead |
| `s` | save a screenshot to `screenshots/` | no |

Mirroring is not among them. Setup fits each camera's map against one
handedness of the landmark stream, so flipping the image mid-round sends every
aim point to the opposite side of the screen. It is chosen at launch instead,
with `--no-mirror`.

## How the trigger works

The trigger measures **strokes, not levels**: it fires when the signal has
risen far enough from its recent trough, and re-arms when it has fallen far
enough from its peak. Absolute thresholds were wrong three times over — rest is
not zero, a play stroke is quicker and shallower than the deliberate pose setup
measured, and the return between shots is rarely complete. A thumb that comes
half way back up has plainly ended its pull, and now earns the next shot. The
trough only accepts a lower level once it persists, so a blink's two-frame dip
cannot turn its own recovery into a firing stroke; and setup caps the span a
heroic calibration pose may claim, so a thumb slammed flat during setup cannot
make every quick play-fold a near miss.

One absolute line does hold, and it is what keeps the ARMED light honest:
**reaching the pose setup measured as *fired* always fires**. Strokes alone are
not quite enough on their own, because re-arming asks for a smaller return than
firing asks for a rise — so a thumb that habitually comes to rest half folded
would re-arm the gun into a state no pull could ever fire it from, and then sit
there saying ARMED for the rest of the round. The resting level may therefore
drift *up* only so far, and never past the point where the calibrated pose
still clears the threshold.


The gun fires on the **angle** of your thumb, not on how far away it is. The
measurement is the angle between your thumb and your hand's own up axis — wrist
to middle knuckle — so it says exactly what it should say: *the thumb is no
longer pointing up*. Measuring against the hand rather than against the screen
means you can tilt and roll your wrist while tracking a target without the gun
going off.

The built-in gesture combines thumb rotation relative to the palm with the
thumb-tip-to-index-knuckle distance in palm spans. A fold in either signal can
fire; releasing both re-arms it. Hysteresis and median filtering suppress jitter.
Acquiring a folded thumb never fires until the thumb has been raised. Neither
signal is learned during aim calibration. `--fire-above` and `--arm-below` can
adjust the normalized gesture thresholds.

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

The four newer maps each speak in their own voice, again all synthesised
and all registered by name in `audio.py` so a map can ask for a sound with a
string and nothing else. A map raises a cue by appending its name to the
round's cue list; the app drains that list every frame and plays each one.
HIGH NOON has a rifle crack, breaking glass, a ricochet, splintering wood, a
bandit going down, the church bell and the wind. ORBITAL DECAY has a
suppressed shot, the tick of debris on the hull, a heavier thud, the crack of
the glass, the alarm and the static of a hit on the drone. OVERWATCH RIDGE has
the rifle's report, the bolt cycling, the scope going in and out, a distant
impact, the ping of a head shot and gusts of wind. SUNSET SPEEDWAY has the
countdown beep and the lights going green, an engine in three registers that
the race picks between on the speed and re-triggers on a period set by it, a
lap chime, tyre squeal, a brake squeal, the bed of gravel noise while a wheel
is off the road, the bump of a wall or another kart, the flag and the crowd.
Each is built in a few takes at slightly different pitches so nothing repeats
exactly.

The full set is seconds of DSP, so it is synthesised on a worker thread while
you play. That thread builds one plain take of every named cue *first* and
makes it live immediately, because a race launched straight onto the track with
`--map kart` counts three lights down inside the first seconds and a silent
countdown is a bug, not a loading state; the richer takes replace them when
they land. Meanwhile the main thread gets an instant kit — one take of the
shot, the cock, the ring pings, the groans — so the menus are never waiting on
a synthesiser.

The useful one is the soft click when the pistol re-cocks: it tells you the gun
is ready without your having to look away from the target. If no audio device can
be opened the game says so once and plays on in silence. `--mute` and
`--volume 0.4` do what you would expect.

## What the second camera actually does

Not averaging. Averaging two wrong answers just splits the difference — measured
across the placements below, it was *worse* than the better camera alone.

Both cameras make the same mistake for the same reason: each reports the truth
plus its own slide times however far your hand is off the surface it was
calibrated on. The drift is unknown, but it is the **same** drift for both — so
the disagreement between them gives it away. Solve for it, undo it in both, then
combine what is left, weighted by how much each camera's map magnifies noise.

The disagreement is a measurement, not an error to be smoothed over.

Measured end to end through the real setup walkthrough and the real aiming code,
with a hand drifting ±9 cm off the calibration surface, on a 1280×720 window:

| second camera | one camera | two cameras | |
| --- | --- | --- | --- |
| 20° off-axis | 53.9 px | **41.9 px** | −22% |
| 40° off-axis | 53.9 px | **43.0 px** | −20% |
| 60° off-axis | 53.9 px | **44.4 px** | −18% |
| 90° off-axis | 53.9 px | 53.9 px | ±0% — ignored, as it should be |

Run with `--debug` and the HUD shows how many cameras are being listened to and
how far apart they are.

## Steadying the crosshair

Aiming runs through a [One Euro filter](https://gery.casiez.net/1euro/), which
adapts to how fast your hand is moving: it smooths hard when you are holding
still on a target, where jitter is what you notice, and lets go when you sweep
across the screen, where lag is what you notice. A fixed smoothing factor has to
choose one or the other.

If the crosshair still shivers when you hold it, lower `--min-cutoff`. If it
feels like it drags behind a fast sweep, raise `--beta`.

## Options

```bash
uv run python -m handy --map range --targets 5 --lifetime 3.5 --seed 42
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--control` | `pistol` | hand controls; the sniper map adds an eye scope automatically |
| `--map` | chooser | `range`, `zombies`, `western`, `orbit`, `sniper` or `kart`, skipping the chooser |
| `--camera` | every one found | webcam index; repeat it to name several |
| `--list-cameras` | | list available cameras and exit |
| `--capture` | `1280x720` | camera resolution |
| `--no-mirror` | off | show the raw image instead of a mirrored one; the wheel follows it, so left stays left |
| `--duration` | `60` | seconds per round; `0` plays endlessly |
| `--recoil` | `26` | pixels the crosshair kicks per shot; `0` disables |
| `--mute` / `--volume` | on / `1.0` | sound output |
| `--min-cutoff` | per scheme | crosshair steadiness when still, in Hz |
| `--beta` | per scheme | filter responsiveness |
| `--fire-above` | per scheme | fraction of the trigger's travel that fires |
| `--arm-below` | per scheme | fraction it must return under to re-cock |
| `--calibrate` | off | run setup again even if one is saved |
| `--no-calibration` | off | skip setup, use the built-in defaults |
| `--calibration-file` | `~/.cache/handy/calibration.json` | where setup is stored |
| `--targets` | `3` | targets standing at once |
| `--spawn-interval` | `1.1` | seconds between spawns |
| `--lifetime` | `5.0` | seconds a target stays up |
| `--seed` | random | fix the target sequence — or the circuit — for practice |
| `--debug` | off | show the live thumb reading and fps |
| `--screenshot-dir` | `screenshots/` | where `s` saves frames |
| `--model` | cached download | path to your own hand `.task` bundle; sniper play also loads the face model automatically |

## Everything runs on your Mac

Inference is 100% local: MediaPipe loads the `.task` bundle from disk and runs it
on the CPU through XNNPACK. No frame, landmark or gesture ever leaves the
machine, and nothing is sent to Google.

The only external network access in the desktop engine is the one-time model download in
`models.py`. Delete `~/.cache/handy/models/` and it downloads again; keep it and
the app never opens a socket. `tests/test_offline.py` enforces this: it monkey-
patches `socket.connect`, `connect_ex`, `create_connection` and `getaddrinfo` to
raise, then runs both inference paths — any stray network call fails the suite.

To be certain it never reaches the network, point at the cached bundle directly:

```bash
uv run python -m handy --model ~/.cache/handy/models/gesture_recognizer.task
```

## Layout

```
handy/
  models.py       downloads and caches the .task bundle
  recognition.py  MediaPipe hand wrapper -> plain Hand / Frame dataclasses
  schemes.py      hand controls and automatic sniper tracking
  faces.py        face tracking for the sniper scope
  marksman.py     a hand and a face from one camera, read as one subject
  display.py      measuring the screen before anything is drawn on it
  filtering.py    One Euro filter and friends, for a steady crosshair
  homography.py   fits and applies the hand-to-screen projective map
  fusion.py       turns several cameras' disagreement into one better answer
  cameras.py      finding and opening the cameras
  audio.py        numpy-synthesised sound effects and a small mixer
  highscores.py   the best score for each map and round length
  aiming.py       landmarks -> thumb angle, crosshair position, trigger pulls
  calibration.py  the setup walkthrough, and the rig it produces
  game.py         the round every map shares: clock, score, streaks, shots
  karting.py      the wheel, the kart physics, the race, and the drive loop
  maps/
    archery.py    the target range: rings, spawning, fading
    zombies.py    the road: perspective, walkers, damage, waves
    western.py    the street: buildings and shadows by the hour, bottles, bandits
    orbit.py      the window: debris on arcs, splitting, the pane's integrity
    sniper.py     the valley: the scope, ballistics, wind, the reticle
    kart.py       the speedway: track, karts, scenery, HUD - all the drawing
  scene.py        shared chrome - HUD, crosshair, setup, chooser, score card
  rendering.py    hand skeleton, drawn into the webcam inset
  app.py          window layout and the capture -> aim -> score -> draw loop
  cli.py          argument parsing and entry point
tests/            geometry, filtering, calibration, game rules, layout and
                  drawing, plus the offline guarantee and an end-to-end check
                  against the real model
```

A map supplies what stands in front of you, what a shot does to it, and how it
is drawn; `game.py` owns everything about keeping the round. Adding a map means
one module and one entry in the registry.

A map may also declare itself a `drive` map instead of a `shoot` one, which is
the whole of what SUNSET SPEEDWAY needed from the rest of the game: the session
loop hands it to `karting.drive()` rather than to `app.play()`, and gets back
the same `(round, reason)` the aiming loop returns, so QUIT, MAPS and RESTART
mean the same thing on the track as everywhere else. Everything particular to
racing — reading two wrists as a wheel, the kart physics, the circuit
generator, the race — lives in `karting.py`, and every pixel of it in
`maps/kart.py`.

A control scheme supplies a two-dimensional pointer and one trigger measurement.
The sniper map adds an eye-closure reading for the scope. Hand calibration,
the projective map, camera fusion, filtering and recoil are shared across the
shooting maps. Internally, `marksman.py` combines the hand and face trackers;
players do not choose a separate control scheme or calibrate their eyes.

`filtering.py`, `homography.py`, `fusion.py`, `aiming.py`, `calibration.py`,
`game.py`, all six maps, `highscores.py` and the mixer in `audio.py` hold the
rules and are pure Python — no OpenCV, no camera, no sound card — so the whole
aim, trigger, calibration, recoil and scoring path is unit tested against
synthetic hands with geometry the tests control exactly. The same holds for the
wheel, the kart physics and the circuit generator in `karting.py`: they touch
no OpenCV and no camera, and all they want of MediaPipe is the plain `Hand`
dataclass, so a whole three-lap race can be driven in a test at 60 Hz by a
scripted driver and its lap times asserted on. Only `karting.drive()`, at the
bottom of that module, needs `cv2` and the window — which is why it imports
them inside the function rather than at the top of the file.
`recognition.py` converts MediaPipe's result objects into small frozen
dataclasses, so nothing else in the project touches the MediaPipe API.

## The drift is a wager, not a shortcut

Lift with the lock already on and the back steps out; straighten cleanly and the
exhaust pays you back. Being sideways buys a sliver more rotation than gripping
and no more, and it bleeds speed the whole time — the drift is **paid for by the
boost at the end of it, never by better cornering**. That balance matters more
here than in a game played with a pad: when "never stop sliding" is the fastest
line, any input noisy enough to trip the gate gets rewarded for being noisy, and
a webcam wheel is noisy. Measured, holding a slide through every bend once beat
driving properly by 8.5% a race; it is now within noise of it, and shakier hands
finish behind steadier ones.

## Reading the kart HUD

The running order, the lap and position plate, a minimap built from the real
track segments, a speedometer with the steering under it, and a wordless pedal
bar showing how far the throttle has travelled - green off the hands, red under
braking. A status row appears under the running order only when something needs
your attention (`HANDS OFF`, `WHEEL LEVEL?`) and is silent otherwise: a lamp
that reports "normal" for a whole race is noise wearing the costume of
information.

## Performance

Measured at 1512x949 on an M4 Max, with the caches warm:

| map | ms/frame |
| --- | --- |
| the five shooting maps (`draw_world`) | 0.9–2.3 |
| SUNSET SPEEDWAY, one frame replayed (`draw_world` + `draw_hud`) | ~9.2 |
| SUNSET SPEEDWAY, median frame of a whole race | ~10.7 |

**Those last two are the same code, and the gap between them is the honest
number.** Timing one frame thirty times over is the easy measurement and it
lies: every cache keyed on a pulsing radius or a wave phase is warm by the
second repetition, which is not a thing that ever happens while you are
driving. Walking a real race forward, where no timestamp comes round twice, is
half a millisecond to a millisecond dearer — and it is the only measurement
that would have caught the glow sprites, which were being rebuilt from scratch
sixty times a second because a power cube pulses its bloom's colour and its
radius together and so missed a cache keyed on both.

The race is the expensive one, and unavoidably so: it has no still background
to copy. The road is re-projected every frame because the camera is moving
along it, and on top of that go the trackside furniture, five rival karts, the
skid marks, the dust, the sparks and eight HUD instruments. On a corner it also
pays for the camera roll, which is a per-column vertical shear of the whole
frame rather than a true rotation — for the four or five degrees a kart racer
banks it is the same picture, and it costs one pass of memcpy instead of more
than everything else in the frame put together.

The budget is ~10 ms and a real race is still a little over it. What is left is
spread thin rather than pooled anywhere: roughly 2.5 ms goes on painting the
hundred and thirty pieces of trackside furniture in front of the camera, 0.6 ms
on the radial speed blur, and the rest in a dozen 0.2–0.4 ms pieces — the
grass, the barriers, the crowd fence, the bunting, the near verge. There is no
single thing left to fix in `handy/maps/kart.py`; the next millisecond costs
scenery.

The scenery a map does *not* redraw — its road, sky, station, valley, and the
speedway's sunset backdrop and podium art — is built once and cached on
`(size, seed)`. The richest of those take a couple of seconds to build (the
night road is the worst at about 2.5 s), so `app.warm_maps` pre-builds every
map's backdrop on a background thread while you are still choosing how to aim.
Entering a map never freezes, and a map drawn before its turn simply builds it
twice, which is harmless.

## Development

```bash
uv run pytest
uv run ruff check handy tests
```

`tests/data/portrait.jpg` is MediaPipe's own published sample portrait, used as a
fixture so the face tests run against the real model rather than only synthetic
landmarks.

The lint is not there for style. A suite of pure unit tests never imports the
entry point, so it cannot see a stale definition left shadowing an import, or a
name that no longer exists on a branch nothing covers — `F811` and `F821` catch
exactly those. `tests/test_app.py` closes the same gap from the other side: it
runs the real startup path with only `cv2.VideoCapture` replaced, so every
signature between the entry point and the camera is the real one.

MediaPipe is pinned to the 0.10 line: version 1.x aborts on macOS with
`Check failed: service_ Service is unavailable` when its Metal path initialises.

The project is not installed into the virtualenv (`package = false`), it is
imported from this directory. An editable install would depend on a `.pth` file
inside `.venv`, and a background process on this Mac flags anything under a
dot-directory on the Desktop as hidden — which CPython skips, so the import
breaks minutes after a successful `uv sync`.

## Notes

Recognition is asynchronous: frames are pushed into MediaPipe's live-stream mode
and the newest available result is drawn, so the crosshair never stalls waiting
on inference. On Apple silicon this comfortably keeps up with a 720p stream.

Aiming deliberately follows the *position* of your hand rather than the direction
your finger appears to point: when you aim at the screen, the index finger points
at the camera and is so foreshortened that its 2D direction carries almost no
information. The thumb, side-on to the camera, stays perfectly readable — which
is why it makes the trigger.

The thumb angle is computed from a cross and dot product rather than from
`acos`, which loses its precision exactly where the two poses have to be told
apart: when the vectors are nearly parallel.

The homography is fitted with a hand-rolled direct linear transform on Hartley-
normalised coordinates. The test suite cross-checks it against OpenCV's
`getPerspectiveTransform`, which agrees to within 1e-6.

A camera's usefulness is judged by the largest singular value of its map's local
Jacobian, not by the square root of its determinant. A nearly side-on camera has
a map enormously stretched in one direction and squashed in the other, and the
determinant — a geometric mean — hides exactly that. Worst-case amplification is
what decides when to stop listening.
