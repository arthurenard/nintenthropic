# Handy on the web — architecture and contracts

Handy is a static website. Everything — hand tracking, the games, the 3D
rendering, the sound — runs in the player's browser. There is no server beyond
whatever hosts the files, and the camera picture never leaves the device.

This document is the contract the parts are built against. The interface rules
are in [DESIGN.md](DESIGN.md); the first game's design is in
[HIGH_NOON.md](HIGH_NOON.md).

## Principles

- **Web-native.** TypeScript, WebGL (Three.js), Web Audio, and MediaPipe Tasks
  for the web (WebAssembly + WebGL). No plug-ins, no server, no native code.
- **Fluid.** 60 fps on a MacBook with the hand tracker running alongside; a
  steady 30+ fps on an ordinary laptop thanks to dynamic resolution. Nothing
  in a frame waits on the network.
- **Fast to start.** The first screen is interactive in under 2 s on broadband;
  a game's assets load behind a progress bar with real numbers, and are cached.
- **Private.** Frames are read in memory and never stored or sent anywhere.
- **Original.** Every model, texture, sky and sound is made for Handy — in
  Blender scripts under `art/` or synthesised in code. Only code dependencies
  come from npm.

## Stack

| Concern | Choice |
| --- | --- |
| Language / build | TypeScript (strict), Vite |
| 3D | Three.js (WebGLRenderer, glTF, Draco) |
| Post-processing | `postprocessing` (pmndrs) or Three.js's own passes |
| Hand and face tracking | `@mediapipe/tasks-vision` (HandLandmarker / FaceLandmarker, GPU delegate), model files served from `public/models/` |
| Sound | Web Audio, every sound synthesised in TypeScript at load |
| Unit tests | Vitest (`src/**/*.test.ts`) |
| End-to-end | Playwright driving the installed Google Chrome with a fake camera and `--mute-audio` |
| Hosting | Any static host (`npm run build` → `dist/`); a GitHub Pages workflow |

## Repository layout

```
index.html            the page
src/
  main.ts             boots the app
  app/                screens: landing, first run, calibration, play, pause, results, share
  ui/                 design-language components and styles (from DESIGN.md)
  engine/             the game host: renderer, loop, dynamic resolution, asset loading
    types.ts          THE CONTRACT between app, input, audio and games (below)
    world/            what every realistic 3D game shares (see "Building a game")
    rules/            pure rules every game shares: health, streak, hints, rng...
    fx/               particles, decals, debris, lights, their textures
  dev/                the dev harness every game's dev.html runs in
  tracking/           camera + MediaPipe → HandFrame (and the eyes, for a scope)
  input/              HandFrame → Aim (filter, trigger, calibrated map); mouse / touch
  calibration/        the aim check that runs before every game
  audio/              the audio engine and the synthesised sound library
  games/
    index.ts          the games, as the arcade shows them
    western/          High Noon
    range/            the Test Range (dev and test builds only: ?range=1)
public/
  models/             MediaPipe .task bundles
  mediapipe/          tasks-vision WebAssembly files (copied from node_modules
                      whenever Vite starts; not committed)
  assets/western/     town.glb, sky.webp, characters, props (exported by art/)
art/
  western/            Blender build scripts: `blender -b -P art/western/build_town.py`
e2e/                  Playwright tests and fixtures
```

Three's Draco decoder needs no copy under `public/`: since r186 `DRACOLoader`
names its decoder files with `new URL(..., import.meta.url)`, which Vite serves
from `node_modules` in dev and emits, hashed, into the build. The asset loader
uses its glTF-only build.

The Python engine (`handy/`, `tests/`, `pyproject.toml`) is retired once the web
version ships; it stays in git history under the tag `python-final`.

## Runtime architecture

```
camera ──► tracking (MediaPipe, per video frame) ──► HandFrame
                                                       │
mouse / touch ─────────────────────────────┐           ▼
                                           ├──► input: filter → trigger → calibrated map ──► Aim
                                           │                                                  │
                    calibration (before every game) ◄─────────────────────────────────────────┤
                                                                                              ▼
engine host (rAF loop, renderer, resize, pause) ──► game.update(dt, now, aim) ──► game.render()
                                                       │
                                  HUD events ──► app (HTML glass HUD)      cues ──► audio
```

- Tracking runs on every **new camera frame** (`requestVideoFrameCallback`), in
  VIDEO running mode, and publishes the newest HandFrame with its capture time.
  The landmarker runs in a **worker** with its own WebGL context (GPU delegate,
  CPU fallback): the page hands it each frame as a zero-copy `VideoFrame` and
  reads back 21 points, so tracking costs the render loop about 0.1 ms a
  frame instead of the inference itself (11-15 ms on an idle M4 Max, 20-60 ms
  on a busy or ordinary machine, where on the page it halved the frame rate).
  The hop costs about 5 ms of latency. A frame that arrives while the last is
  still being read is skipped, never queued. Browsers that cannot run it in a
  worker track on the page.
- Input turns a HandFrame into an **Aim** once per new frame (never twice for
  the same frame), and the engine reads the latest Aim every animation frame.
  The crosshair may be extrapolated forward by the measured tracking delay
  using the filter's velocity, clamped to 60 ms.
- The crosshair is drawn by the page (a 2D overlay at device resolution), not
  inside the 3D scene, so it is always crisp and never waits for a render.
- A shot's `Aim` carries the position from just before the thumb began to fold
  (the hand moves with the fold), then the crosshair kicks up with the recoil
  and settles in about 250 ms.
- **Reloading with a pointer.** A mouse that leaves the stage is off the screen
  until it returns; right-click, and a two-finger tap on a touch screen, make a
  *synthetic offscreen moment*: `Aim.offscreen` is true for 250 ms with the
  crosshair where it is. The keyboard is the game's own (High Noon reloads on
  R itself), so the pointer does not turn R into a second reload.
- **Reloading with the hand.** Pointing past the view's edge is off the
  screen; so is a hand the camera lost as it left the picture across an edge
  (pointing past the view, or its fingertip at the picture's own edge), for
  up to 1.2 s after it goes. A hand that vanished mid-view is only lost, and a
  camera frame older than 400 ms is no hand at all.
- **The scope** (a game whose entry says `uses: { scope: true }`: Overwatch
  Ridge). `Aim.scope` follows Shift, the right mouse button (which in such a
  game scopes instead of reloading; a left click while it is held still
  fires) and, on a touch screen, the page's Scope button in the bottom-left
  corner - held, or toggled, as Settings says (Scope Button: Hold | Toggle).
  With the hand, in a game that also says `eye: true`, closing one eye
  scopes too (Close One Eye to Scope, on by default): the face landmarker
  (`public/models/face_landmarker.task`, 3.7 MB, loaded with the loading bar
  the first time such a game is played) runs in the tracking worker on the
  same camera frames as the hand, after it, and sends back only the two
  eyes' blink scores (`src/tracking/face.ts`). It scopes when the larger of
  the two is above 0.55 for 180 ms, lets go below 0.30, and waits 200 ms
  for a face it lost, so a blink never scopes (`src/input/scope.ts`). The
  face is read on every other camera frame: measured with
  `e2e/tracker.html?face=N` on an M4 Max under load, it costs 8-10 ms of the
  worker's time a read (p95 10-14 ms) and none of the page's; on every frame
  the worker was busy 20 ms a frame and skipped up to a third of the
  camera's frames, on every other it skips none more than the hand alone.
  No other game ever loads or runs it. A game draws its own reticle while
  scoped and hides the page's crosshair with `HudSink.crosshair("none")`.
- **When the hand goes.** In play, a hand gone for 1.5 s (longer than any
  reload's swing) holds the round: the world stops as for a pause while the
  camera goes on looking, under a "Show Your Hand" card. Seen steadily again
  for half a second, the player is counted back in 3-2-1. Resuming from the
  pause sheet with the hand goes through the same wait and count. Never in
  the aim check, the fall or the results (`src/app/handWatch.ts`).
- **When the camera goes.** A camera that ends, or runs without a new frame
  for 3 s, mid-game freezes the round under a sheet: Try Again (the same
  camera keeps the round and its aim; another starts afresh with its aim
  check), Use Mouse or Trackpad (the same round goes on with the pointer), or
  Choose a Game.
- **Another hand.** The landmarker follows one hand. A hand that turns up
  more than a quarter of the picture from where the player's just was moves
  no aim and fires nothing until it has stayed 0.3 s (`src/input/trust.ts`,
  which also records why two hands were not tracked instead).
- **The results.** With the hand, the camera goes on reading under the
  results card, and a deliberate shot - the thumb raised after the card came,
  then folded once it has settled (1.2 s) - plays again; the camera rests
  after a minute. Two seconds after the card arrives the world stops drawing
  (the last frame stays under it) until the next round.
- **Downloads** give up after 20 s without a byte (`fetchBytes`); with the
  browser offline the trouble says so.
- **Rendering.** The host's renderer has no canvas anti-aliasing (the games
  anti-alias in their own post-processing) and outputs sRGB; tone mapping is
  the game's. The HUD's red screen edge stays light, since the game draws its
  own blood in the corners; the damage arcs are the page's.
- **Rounds.** `CalibrationStage.begin()` (optional) stands the targets up for
  an aim check; the platform calls it before each check, and once more if the
  targets run out mid-check. A game whose stage has it plays Play Again,
  Restart and Adjust Aim on the same instance; any other is made afresh.
- **Until `start()`** the host still runs the game's `update` and `render` every
  frame (the world is alive behind the aim check). The check's shots belong to
  the check: the platform judges each one and tells the stage `hit` or `miss`;
  the game sees `aim.fired` too, and answers it only with the gun's sound and
  smoke. The stage plays the check's sounds (a bottle's ting on `hit`, the
  closing flourish on `done`), and the platform calls `done()` once, with the
  "you're ready" moment, a moment before `start()`; after a game begun without
  a check (the mouse) `start()` alone clears the stage.

## The contract: `src/engine/types.ts`

The TypeScript interfaces in `src/engine/types.ts` are the contract. In short:

- `Aim` — `{ x, y }` in viewport fractions (0,0 top-left), `tracking`, `armed`,
  `fired` (true on exactly one update per shot), `travel` (0–1 thumb fold),
  `offscreen` (true while the crosshair is outside the view — High Noon's
  reload gesture), `scope` (the player asks to look through a scope; always
  false in a game whose entry does not use one: see "The scope" below).
- `InputSource` — `sample(now) → Aim`, `kind: "hand" | "mouse" | "touch"`.
- `Game` — `load(ctx, onProgress)`, `start()`, `update(dt, now, aim)`,
  `render()`, `resize(w, h, dpr)`, `pause()`, `resume()`, `dispose()`, plus
  `calibration: CalibrationStage` (the game's own targets for the aim check).
- `GameContext` — the renderer and canvas, `audio: AudioBus`, `hud: HudSink`,
  `assets: AssetLoader`, settings, a seeded random source, `quality`, and
  `input` (optional: how the player aims, so hints can say "right-click to
  reload" to a mouse player). `Settings.scope` says how the player scopes
  (`eye`: closing an eye does, now; `button`: hold or toggle), for a game's
  hints; `Settings.unlocks` holding "golden" means a golden weapon in every
  game (High Noon's Golden Revolver). `Settings.aimAssist` is the player's
  Aim Assist (on unless they turn it off): a game reads it live, on every shot,
  and makes the shot forgiving with it on and exact with it off
  (`engine/rules/assist.ts`; Overwatch Ridge never reads it).
- `GameEntry` — a game in the arcade (`src/games/index.ts`): `id`, `title`,
  `blurb`, `about` (the hero's two or three sentences), `poster` (16:9, under
  `public/`), `backdrop` (the game's light, drawn where the poster would be
  until it exists: a sky's colour stops and a glow), `uses` (what it asks of
  the platform: `scope`, `eye`), `stage` (`minAspect`, `maxAspect`: the
  stage's shape its art can hold; 1.1 and unlimited if unset), and `create`,
  absent while the game is Coming Soon.
- Optional members a game may use: `AudioBus.setSpace(space)` (the street's
  walls, for the echoes), `CalibrationStage.begin()` (above).
- `HudSink` — how a game reports score, readouts (label/value/meter/tone, as on
  the desktop: a wave, integrity, wind), wave titles, damage direction, hit
  markers, secrets, and the end of the game (`GameOver` with stats), and its
  weapon in the bottom-right corner: `ammo(left, capacity, reloading, style)`
  draws a revolver's cylinder (the default) or, with `{ kind: "magazine",
  chambered, action }`, a rifle's rounds in a row with the chambered one apart
  in its breech (`action` "ready", "cycling" while the bolt or lever is
  worked, "open" with the bolt back); `heat(level, venting)` (optional) a
  laser's heat as a ring that fills with each shot, orange near the top, red
  while it vents and cannot fire. `weaponFinish("gold")` (optional) gilds
  whichever it is; `crosshair("none" | "default")` (optional) hides the
  page's crosshair while the game draws its own reticle; `clock(seconds,
  tone)` (optional) shows a timed round's clock at the top (0:48), `null` to
  take it away.
- `AudioBus` — `play(cue, { volume, pan, rate, delay })`, `loop(cue)`,
  `setFilter("hurt", amount)`, `mute`.
- `CalibrationStage` — `targets()` returns the game's aim-check targets as
  viewport positions and radii; `light(id)`, `hit(id)`, `miss(id)`, `done()`
  let the game show and break them (bottles in High Noon).

## Building a game

A game is a folder, `src/games/<id>/`, whose `index.ts` exports a
`createGame(): Promise<Game>` that imports the rest on demand, and an entry
in `src/games/index.ts` (below). High Noon (`src/games/western/`) is the
worked example of everything here, and the Test Range (`src/games/range/`,
dev and test builds only) the smallest: an aim check, a clock, each weapon
style and a scope in a few hundred lines. What High Noon learned that every
realistic 3D game needs lives in the engine; use it rather than growing your
own, and keep in your folder only what is truly your game's.

### A new game, step by step

1. **Its entry** in `src/games/index.ts` is already there for the coming
   games: fill in `about`, point `poster` at your 16:9 poster under
   `public/assets/<folder>/` (until it exists your `backdrop` stands in, so
   tune it to your game's light), set `uses` (`scope`, `eye`) and `stage`
   (the shape your art holds), and add `create` when it can be played - the
   arcade then offers Play instead of Coming Soon.
2. **Its aim check** is its own `CalibrationStage`: targets spread over the
   corners, edges and centre of the view, in your world.
3. **Its HUD** goes through `HudSink`: `score`, `readouts` (one small panel:
   wave, integrity, wind), `ammo` with your weapon's style or `heat`,
   `clock` for a timed round, `crosshair("none")` while you draw a reticle,
   `weaponFinish("gold")` when `Settings.unlocks` has "golden". Keep your
   targets clear of the chrome: `chromeKeepOut(w, h, hand, { panel, dock:
   WEAPON_DOCK.magazine, scopeButton })`.
4. **Its words**: tips through `HintLine` with ids prefixed by your game
   (`night.headshot`), hints in the player's terms (`GameContext.input`,
   `Settings.scope`), and DESIGN.md's voice.
5. **Its sounds** are cues in `src/audio/cues/` in a pack of its own (its
   name added to `Pack` in `cues/table.ts`), synthesised while the game
   loads with `loadSoundPack(ctx.audio, "<pack>")`.
6. **Its harness**: `dev.html` and `dev.ts` (below), and its art loaded
   through `Art`, with placeholders for development only.
7. Records, saved aims and one-time tips are kept per game by the page:
   nothing to do.

### `src/engine/world/`: the 3D world

| Module | What it gives you |
| --- | --- |
| `post.ts` | `PostFX(renderer, scene, camera, quality, options)`: the scene into a 4×/2×/0 MSAA half-float target by tier (the anti-aliasing), bloom on what is brighter than the world (off on low), and one grade pass: exposure, a highlight shoulder, your own colour grade (`grade: { glsl, uniforms }`, a `vec3 grade(vec3 c, float l)`), and the player's state - `desaturate`, `hurt` (a colour creeping in from the corners), `sepia`, `flash` (a colour added to the picture), a vignette. Leave out what you do not want (`hurt: false`, `bloom: false`...): it is compiled out. `set(name, value)` for every uniform, yours included. It turns the renderer's tone mapping off: the grade is the tone map. |
| `flash.ts` | `ScreenFlash`: the whole picture's flash for a blast close by, which jumps and fades on Standard and swells and ebbs at a tenth of the brightness with Reduce Flashing. Feed `update(dt)` to `post.set("flash", ...)`. |
| `character.ts` | Skinned glTF characters: `templateFrom(kind, asset, borrowedClips, { fallbacks, rim })` once per file, a `RigPool` of rigs made at load (never mid-game), and each `Rig` plays clips with crossfades (`play(name, fade, loop, timeScale)`, falling back through your table, then `idle`), `dress([...var names])`, `worn("var.hat.")`, `hold("gun.rifle" | null)`, `socket("socket.gun")`, `tint()`, `setOpacity()`, and procedural layers over the clips: `aimAt(point, weight)` pitches the chest, `hitReact(side, strength)` twists it, `kick()` recoils the arm. `lighting.key` (how much of the directional light reaches it: a baked world decides by a ray) and `lighting.shade`, and a rim light shared by a template (`rimLight(colour)`). `updateJoints()` gives the world positions a shot is tested against. `turnRig`/`headingTo` turn one the short way round. |
| `tumblers.ts` | Things knocked loose that tumble to rest (a hat, a dropped gun) without a physics engine; a thing taken from a rig goes back home with `restore`. |
| `names.ts` | The asset contract's dotted names (`cover.saloon_door`, `shoulder.L`): three.js strips the dots, `contractName(o)` gives them back; `findNode`, `nodesWithPrefix`, `extraString`, `extraNumber`, and `nameNode` for placeholders built in code. |
| `playerCamera.ts` | `PlayerCamera(eye, orientation, fov, { near, far, groundY })`: a standing first-person eye with a slow breath, a kick when the gun fires (`kick`), a flinch when hit (`flinch(direction, amount)`), a shake (`rumble`), the slow fall at death (`setDeath(progress, side)`), framings eased from one to the next (`setFraming(framing, seconds)`), `still` for the aim check and `reducedMotion`. |
| `framing.ts` | Fitting a lens to a fixed eye: `fitFraming(sights, aspect, options)` finds the tightest field of view and pitch that show every point the fight happens at (`Sight`s, in the art camera's space), targets clear of the page's chrome (`chromeKeepOut(width, height, hand, { panel, dock })`, with `WEAPON_DOCK` for each weapon's corner); `checkFraming` widens the art's own lens for a narrow window. Pure maths, tested without a renderer. |
| `sound.ts` | `Sound(bus, camera)`: cues placed in the world (`at(cue, position)` works out pan and distance from the camera), named loops that survive a pause (stopped on `pause`, started again on `resume`), and the `hurt` filter held over a pause (a paused game is not being hurt). |
| `sky.ts` | `SkyLight(renderer, scene, texture, intensity)`: an equirectangular sky as the background and, through PMREM, the environment light; `asSky(texture)`; `horizonColour(texture)` for the fog to meet the sky without a seam. |
| `scene.ts` | `fitShadowCamera(sun, box)` spends the shadow map on the part of the world that matters; `shadowMapSize(tier)`; `disposeTree(root)`. |
| `queries.ts` | `SceneryQueries(solids, moving)`: rays against the scenery fast enough to ask dozens of times a frame (a `TriangleGrid` of 2 m columns): `cast` (where a bullet lands), `groundAt` (under a falling body), `lightReaches` (is the sun on him). |
| `art.ts` | `Art(ctx, files, options, onProgress)`: a game's glTF and textures through the engine's protected download, weighted into one progress bar. Every file is required: in production one that does not load fails the load with a `DownloadError` ("Couldn’t Load the Game", Try Again). In development and tests a missing file may be stood in for by a placeholder built in code, which your game imports behind `import.meta.env.MODE !== "production"` (so a production build drops it) and hands to `gltf(name, standIn)` / `texture(name, standIn)`; `probe()` first asks which files are really there. |

`src/engine/fx/` holds the particle system, decals, debris, the pooled
lights and their textures; High Noon's `world/effects.ts` shows how a game
builds its own presets (dust, sparks, a muzzle flash, a reduced-flashing
variant of each) on them.

### `src/engine/rules/`: pure rules

| Module | What it gives you |
| --- | --- |
| `health.ts` | `PlayerHealth(regeneration, max)`: hidden health that comes back after a delay at a rate (read every frame, so a difficulty can ease them), `hurt` 0..1 for the picture's effects, `immortal` for a harness's god mode; `damageDirection(eye, yaw, from)` for `HudSink.damage`. |
| `streak.ts` | `Streak(step, maxMultiplier)`: consecutive hits build a multiplier a step at a time; what breaks it is your call. |
| `hints.ts` | `HintLine(tipsSeen, learnedByDoing)`: the hint line's one urgent need, a brief word, and one-time tips queued one at a time for four seconds, never twice (`Settings.tipsSeen`, ids prefixed with your game's name). Read `text` every frame and pass it to `hud.hint` when it changes. |
| `hammer.ts` | `Hammer`: the frames on which the re-arm's soft click should sound as the thumb comes back up after a shot, and never when it should not. |
| `rng.ts` | `range`, `chance`, `pick`, `shuffle` over `GameContext.random`, and `mulberry32` for a replayable `?seed=`: route every decision through the seeded source and a seed replays a round exactly. |
| `raymath.ts` | Ray against sphere and capsule (a head, a torso, a limb) with an honest angular tolerance: aim assist that is not a magnet. |
| `assist.ts` | Aim Assist for every game that has it: `assistFactor(on)` scales a shooter's table of tolerances (`ASSIST_BOOST` = 1.35 on, none off), `secretFactor(on)` keeps a secret's allowance as it is (never boosted, so a secret is not triggered by a shot that was not aimed at it), and `choose(...)` picks what a shot hit: a real hit first, else the best near miss, never an innocent and never past one the shot passed close beside. |

### What stays yours

High Noon keeps in its folder what only it needs, and so should every game:
its rules (the gang, waves, dynamite, secrets, what felled you), its world
(the town's layout and covers, the bottles of its aim check, the ambience,
its effects' recipes, what a shot can hit), its colour grade
(`western/world/grade.ts`), its tips' words, its clip fallbacks and rim
light (`western/world/rigs.ts`), its revolver, and its placeholders.

### The dev harness

Every game gets `src/games/<id>/dev.html` (a page with one script) and a
`dev.ts` of a few lines:

```ts
import { runHarness } from "../../dev/harness";
import { MY_GAME } from "../index";
import { createMyGame } from "./index";
void runHarness({ entry: MY_GAME, tips: ALL_TIPS, create: (p) => createMyGame({ startWave: p.wave, assetBase: p.assetBase }) });
```

It runs the game alone in the page's real chrome (the HUD, the crosshair,
the results card, from index.html and `src/app`), with the mouse as the gun
and the silent `NullAudioBus`, after a short aim check on the game's own
targets. Query parameters: `?seed=`, `?wave=`, `?difficulty=relaxed`,
`?flashing=reduced`, `?tips=seen`, `?assetBase=/folder/`, `?god=1`,
`?golden=1`, `?quality=`, `?input=mouse|touch|hand`, `?skipcalib=1`,
`?manual=1` (drive it from `window.__handy`: `advance(seconds)`,
`bench(frames)`, `mouse.aimAt/fire/reloadGesture`, and `hud.log` of every
HudSink call), `?w=&h=&dpr=`; a game reads its own from `HarnessParams`
(High Noon's `?noon=1`).

## The aim check: calibrate before every game, finish at 95%

Every game begins with a short aim check in its own world (High Noon: bottles
on the fence, sills and barrels). It ends on its own as soon as the aim is
**95% accurate**, which for a returning player whose saved aim still fits takes
three shots.

- **What is fitted.** An affine map from the fingertip's position in the
  (mirrored) camera image to the viewport, as the desktop's shot setup did. The
  hand position for each shot is the median of the thumb-up samples just before
  the fold, so the motion of firing does not move the aim.
- **Learning.** With no saved aim for this camera: the first two shots at
  well-spread targets fit scale and offset (the crosshair appears), the third
  fits the full affine map. Every later shot refits it (least squares over the
  recent shots, outliers beyond 3σ dropped).
- **Measuring.** Each shot, before it is used to refit, gives an honest
  *predictive* error: the distance between where the current map says the shot
  went and the target's centre, in viewport units (fractions of the smaller
  viewport side). From the last six such errors, σ is estimated as a 2D
  Gaussian (`σ² = Σe² / 2n`), and a systematic bias as their mean vector.
- **The score.** `aim = 1 − exp(−R² / 2σ²)`: the probability that a shot lands
  within `R` of where you aim, with `R` = 3.5% of the smaller viewport side (a
  bandit's torso at mid-street). Shown live as a ring filling to 95%.
- **Only full maps are scored.** The two-shot map of scale and offset is there
  to put a crosshair on screen; it cannot know how the camera is turned, so its
  miss on the third shot is shown but not scored - it would be the camera's
  error, not the player's, and hold a rotated camera back six shots. A first
  check therefore takes at least six shots (two to learn, one to fit, three to
  prove); a returning player's three.
- **Done** when `aim ≥ 95%` over at least three predictive errors and the bias
  is under `R / 2`. The map that earned the score is the one saved and played
  on. A saved fit starts measuring from the first shot. After 12
  shots below 95%, offer **Play Anyway** with one specific tip (light, framing,
  distance) — never trap the player.
- **Stored** per camera (`deviceId`), video size and game in `localStorage`,
  and as the camera's latest: a game with no aim of its own yet starts from
  the latest (any game's), measured from its first shot, so a player set up
  once is ready in three shots in every game. With a
  version number; anything unreadable is discarded and the check starts fresh.

## What the browser keeps

Everything is a convenience in `localStorage` (the Golden Revolver in
`sessionStorage`, for the visit): versioned keys under `handy.`, JSON, every
read checked and every write allowed to fail, so a window that stores nothing
plays the same without remembering (`src/app/prefs.ts`).

- `handy.settings.v1` — the Settings sheet: volume, difficulty, crosshair,
  Aim Steadiness (Steady unless chosen otherwise), Aim Assist (on unless turned
  off), Show Camera in Play, Reduce Motion (absent: follow the system), Reduce
  Flashing, and a `revision`. Revision 2 made Steady the default (it was
  Balanced): settings saved without a revision hold a Balanced that was only
  the old default, so it reads as Steady, and anything saved from revision 2 on
  is kept as chosen - a Balanced picked after the move stays. The move is a
  read: the stored value is left alone until the player next changes a setting.
  The app puts them into effect: `settings` for the
  game (`difficulty` is held for a round in play and changes when the next
  begins; `aimAssist` is read live, on every shot), `AudioEngine.setVolume` (apart from mute), `Crosshair.style`,
  `AimController.steadiness` for every new hand input (and `setSteadiness` on
  the one in play), `Pip.showInPlay`, `<html data-reduce-motion>`.
- `handy.best.v2.<game>.<relaxed|standard>.<hand|pointer>` —
  `{ score, outcome, at }`, written the moment a round ends.
- `handy.tips-seen.v1` — `Settings.tipsSeen`, a set that writes itself through
  on every `add`.
- `handy.aim.v1.<camera>.<size>.<game>` and `handy.aim.v1.<camera>.<size>`
  — saved aims, a game's own and the camera's latest (above);
  `handy.camera.v1` / `handy.camera-choice.v1` — the camera used last, and the
  one chosen in Settings, which is asked for exactly and gives way to any other
  if it has gone.
- `handy.scope.v1` — the Scope group of Settings: `{ eye, button }`, shown
  only while a game with a scope can be played.
- `handy.game.v1` — the game chosen in the arcade (the address's
  `#<game>` or `?game=<game>` wins over it).
- `handy.welcomed.v1`, `handy.muted.v1`, `handy.control.v1`,
  `handy.camera-opened.v1`, `handy.downloaded.v1` — small flags.

Reset Handy removes every `handy.` key from both storages.

## Asset contract: High Noon

All glTF is Y-up, metres. The player stands at the origin, eyes at 1.7 m,
looking down the street toward −Z; the church is at about z = −60. Left is −X.

### `public/assets/western/town.glb` — Dust Creek

- **Static scenery** with its lighting baked in Cycles (direct sun, sky and
  bounce light, ambient occlusion) into its colour textures, exported with
  `KHR_materials_unlit`. The game adds no light to it, which is what makes it
  look like a Cycles render at no runtime cost.
- **Named nodes** (glTF node names; custom properties become `extras`):
  - `camera.player` — the player's eye.
  - `sun` — an empty whose −Z axis points along the sunlight used for the bake,
    so dynamic objects (characters, bottles, tumbleweeds) are lit to match.
  - `cover.<id>` — where a bandit stands when **exposed**, facing the player,
    with extras `{ kind: "window" | "door" | "barrel" | "crate" | "wagon" |
    "corner" | "roof" | "tower", emerge: "lean_left" | "lean_right" | "rise" |
    "step_out", level: 0 | 1 | 2 }`; and `cover.<id>.hidden` — where they wait
    out of sight. At least 20 covers across both sides and the far end.
  - `calib.<1-9>` — spots for the aim-check bottles, spread so that in the
    player's view they cover the screen's corners, edges and centre.
  - `secret.bell` (pivot at the yoke), `secret.vane` (pivot on its axis),
    `secret.water_tower`, `secret.piano`, `secret.poster`,
    `secret.church_doors.left|right` (pivots at the hinges) — separate objects
    with sensible origins so the game can animate them.
  - `glass.<id>` — window panes that can shatter.
  - `path.chicken.<n>`, `path.tumbleweed.<n>` — waypoints.
  - `ground.shadow` — a plane over the street where the game draws the dynamic
    objects' shadows.
- **Surfaces** for impacts: each mesh's extras include `surface: "wood" |
  "dirt" | "glass" | "metal" | "stone" | "cloth" | "water"`.
- **Budget:** at most 12 MB with textures (WebP, Draco-compressed meshes).

### `public/assets/western/sky.webp`

An equirectangular sky rendered in Blender (Nishita sky at golden hour, with
clouds and the distant mesas), used as the background and, through PMREM, as
the environment light for dynamic objects.

### Characters: `bandit.glb`, `boss.glb`, `townsfolk.glb`, `chicken.glb`

- One skinned mesh per character on a shared humanoid armature with these bone
  names: `hips`, `spine`, `chest`, `neck`, `head`, `shoulder.L/R`,
  `upper_arm.L/R`, `forearm.L/R`, `hand.L/R`, `thigh.L/R`, `shin.L/R`,
  `foot.L/R`, and an empty `socket.gun` parented to `hand.R`.
- Facing +Z in glTF, feet at the origin, clips **in place** (no root motion).
- Variation meshes, toggled by the game: `var.hat.<name>`, `var.coat.<name>`,
  `var.bandana.<name>`, `var.vest`, `var.armour`; props `gun.revolver`,
  `gun.rifle`, `prop.dynamite`.
- Animation clips (names are the contract): `idle`, `hidden` (crouched or
  pressed to the wall), `lean_left_out`, `lean_left_in`, `lean_right_out`,
  `lean_right_in`, `rise`, `sink`, `step_out`, `step_in`, `aim`, `fire`,
  `run`, `throw`, `hit_body`, `hit_head`, `death_back`, `death_forward`,
  `death_fall`, `death_slump`. Townsfolk: `idle`, `peek`, `hands_up`, `panic`,
  `head_shake`, `wave`. Chicken: `peck`, `walk`, `run`, `flutter`.
- **Budget:** 8–15k triangles and 1024² WebP textures per character.

## Performance budgets

| | Target |
| --- | --- |
| Frame time, MacBook (M-series), 1440p | ≤ 8 ms render + tracking in parallel → 60 fps |
| Frame time, integrated GPU laptop | 30+ fps via dynamic resolution (0.6×–1× DPR) |
| Hand tracking per camera frame | ≤ 12 ms (GPU delegate) |
| Face (a game that reads the eye) | ≤ 12 ms a read, every other camera frame, in the worker |
| Camera frame → crosshair on screen | ≤ 50 ms |
| First screen interactive | ≤ 2 s |
| High Noon download | ≤ 25 MB including the tracking model, cached after |

## Testing

- **Unit (Vitest):** the aim pipeline (filter, trigger, affine fit, the aim
  score), game rules (waves, health regeneration, scoring, bandit state
  machines), HUD formatting, storage. The Python tests are the reference for
  anything ported.
- **Test builds** (`vite build --mode e2e`; never production) add hooks:
  `?input=script` swaps the camera and tracker for a scripted hand that drives
  the real aim pipeline, and `?fail=camera-denied|camera-busy|camera-missing|
  camera-insecure|model|game|webgl` shows each error, and `?range=1` adds
  the Test Range to the arcade (`src/games/range/`: a timed game with a
  scope, `?weapon=cylinder|magazine|heat`), whose scripted eyes the tests set
  with `handyTest.eyes()`. `e2e/smoke.html` and `e2e/tracker.html` (with
  `?face=N` for the face on every Nth frame) load and time the tracker alone
  on the dev server.
- **End to end (Playwright, installed Chrome, `--mute-audio`):** landing →
  camera priming → aim check → High Noon → pause → results, with a fake camera
  (`--use-file-for-fake-video-capture`) showing a hand; and the whole flow with
  the mouse. Screenshots of every state are part of the review.
- **Silence:** nothing a developer runs may play sound through the speakers.
