# The trailer's shooter clips

Eight short, real gameplay clips of the four Finger Guns shooters for the
trailer's fast montage (see `../README.md`): 1920x1080 PNG frames at 60 fps, 3.5 s
each (the slow-motion one 5 s), captured frame by frame from the games' own dev
harnesses in headless, muted Chrome. Nothing is faked: the game runs, a scripted
hand aims and fires through the games' own input, and the HUD (score, ammo,
hit markers, the floating "+250 Headshot") is the app's. There is no hand
picture (the app's Pip stays hidden), no Pause button, no caption and no fade.

| id | game | what |
| --- | --- | --- |
| `hn-hero` | High Noon | four hits in two and a half seconds: a quick-draw headshot, a lit dynamite stick shot out of the air (fireball), two more bandits |
| `hn-2` | High Noon | two dynamiters, one each side of the street; both sticks shot out of the air, two fireballs |
| `dn-1` | Dead of Night | the flashlight beam sweeps over the foggy road onto the dead; headshots |
| `dn-2` | Dead of Night | a crowd in the beam; the bloater swells with each hit, bursts and takes its neighbours |
| `od-1` | Orbital Decay | the heat laser breaks a flurry of debris against the planet vista |
| `od-2` | Orbital Decay | a slab split by the laser near the glass, then a big piece slams the right pane |
| `or-1` | Overwatch Ridge | the scope rises, a pan across the valley onto the tower's lookout, the long shot lands |
| `or-slow` | Overwatch Ridge | the long shot and its hit in slow motion (120 steps a second, played at half speed) |

## Re-capture

The dev server must be running on port 4901 (`npx vite --port 4901 --strictPort`).

```bash
node tools/trailer/shooters/capture.mjs                  # all eight, about eight minutes (three at a time)
node tools/trailer/shooters/capture.mjs --only hn-hero,od-2
node tools/trailer/shooters/capture.mjs --manifest       # only rewrite shooters.json (the moments) from the events already captured
```

Each clip goes to `tools/trailer/out/clips/<id>/`: `00001.png ...`,
`events.json` (the audio cues the game asked for, times in playback seconds from
the clip's first frame; the pre-roll's, before it, have negative times), `hud.json` (the hit markers and floating scores, the
same clock), `contact.jpg` (every 15th frame). `tools/trailer/out/clips/shooters.json`
is the manifest the editor reads: `{ id, game, frames, fps: 60, slow, w, h, what,
moments: [{ t, what }] }`. For `or-slow`, `slow` is 2 and every time is in
**playback** seconds (simulated time x 2).

Takes are repeatable: each has a fixed seed and a fixed pre-roll (the real game
is simulated, unrecorded, before the first frame), the hand has its own fixed
seed, and the page's clock is Playwright's fake one. Two captures give identical
events.

A look, not a delivery:

```bash
node tools/trailer/shooters/capture.mjs --only dn-2 --preview            # 960x540 JPEGs, every 6th frame, to tools/trailer/out/preview/dn-2/
node tools/trailer/shooters/capture.mjs --only dn-2 --preview --every 3 --size 1920x1080 --frames 120
```

`--pre`, `--frames` and `--seed` override a take's pre-roll (simulated seconds),
length and seed. `probe.mjs <clip> "<expression>"` evaluates JavaScript in the
page (`window.__harness.game.debug`, `window.capture`).

## How it works

- `capture.html` / `capture.ts`: the frame renderer. One clip per page load;
  `capture.mjs` steps it one frame at a time (`step`, run Playwright's clock,
  `post`, screenshot). A frame is 1/60 s of game time, or 1/120 s for a slow
  clip, where the game is stepped by hand (`game.update(1/120)`) because the
  harness steps 1/60 at the least; CSS animations are scrubbed to the simulated
  time, so the HUD pops slow down too.
- `directors.ts`: one director per clip, a script that stages the moment
  through the games' own debug switches (a bandit out of a cover, a dynamiter's
  stick, a bloater among the dead, a fragment sent down a lane) and picks the
  hand's target. `aim.ts` is the hand: a slightly under-damped spring with a
  faint tremor, which fires once it has settled on the target (`maxSpeed`, how
  fast it may still be moving, is raised for fast targets).
- `browser.mjs`: the muted headless Chrome, and the dev server's address.
- `plan.mjs`: per clip, the seed, the pre-roll, the length, the harness query.
- `moments.mjs`: turns the game's own record of a take (audio cues, hit
  markers) into the manifest's `moments`, so they are exact.

Notes from making them:

- High Noon's wave director is held off (`match.spawnTimer`), so only the men
  staged in the script come out. A dynamiter's stick takes about 1.3 s to reach
  the player; it is shot at 8-9 m, where the fireball fills a quarter of the view.
- Orbital Decay's fragments are sent as the game sends them (`Match.send`), but
  from a named lane at a named speed, so each reaches the glass at a time the
  script chooses (a lane's distance over the speed). The side panes lie off
  screen, so everything that is shot is sent at the middle window.
- Overwatch Ridge: a head at 294 m is a few hand's breadths across, so a shot
  misses by 0.3 m unless the view is within a third of a milliradian. The hand
  works by eye: it moves by what the view still lacks, with the quarter gain,
  fires only when the view is on the man, keeps still while the thumb folds and
  only shoots a man who will still be standing when the round arrives (each man's
  mind switches what he is doing on a timer; one who ducks is missed).
