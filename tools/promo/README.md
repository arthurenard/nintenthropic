# The Handy promo video

A 38-second, 1920x1080, 60 fps film of the four games, made from the real
games: every gameplay frame is a screenshot of the game running in headless
Chrome, and every sound is one of the games' own synthesised cues. Nothing is
downloaded, generated or recorded, and nothing is ever played through a speaker
(the browser is muted, the audio is mixed offline, and no player is invoked).

## Re-render

```bash
npm ci
node tools/promo/render.mjs            # everything, about fifteen minutes
```

The dev server is started on port 4901 if nothing is listening there. The
result is in `tools/promo/out/` (ignored by git):

- `handy-promo.mp4`: H.264 (yuv420p, BT.709), AAC, `+faststart`, about -14 LUFS
- `handy-promo-poster.jpg`: the title card
- `contact.jpg`: one frame a second
- `frames/<segment>/`: the numbered frames and each game's `events.json`
- `mix.wav`: the soundtrack before loudness normalisation

Useful options:

| Option | Does |
| --- | --- |
| `--preview` | A quick look: 960x540 at 30 fps (JPEG frames) |
| `--only western,night` | Capture just these segments again, then mix and encode |
| `--stage frames\|audio\|video` | Run only one step (frames and audio are kept between runs) |
| `--concurrency 4` | How many scenes are captured at once |

To look at one scene while tuning it, `frames.mjs` renders a single scene to
numbered JPEGs (`--every 12` keeps every twelfth frame), `probe.mjs` evaluates
an expression in the page, `grab.mjs` tiles stills from the finished video at
given times, and `loud.mjs` measures a filter chain's loudness:

```bash
node tools/promo/frames.mjs --scene night --pre 3 --dur 8 --every 12 --size 1920x1080 --out tools/promo/out/preview/night
node tools/promo/probe.mjs western "window.__handy.game.debug.covers()"
node tools/promo/grab.mjs 7.6 15 22.6 30      # -> tools/promo/out/grab.png
```

## How it works

**Plan.** `timeline.mjs` lists the scenes, their lengths, captions and the
bed's chords. Scenes cross-fade for 0.4 s; there are no wipes.

**Frames** (`frames.mjs`, `capture.html`, `capture.ts`). One scene per page
load, stepped from Node one frame at a time, so the footage is perfectly smooth
whatever the machine's speed:

- A game runs through its own dev harness (`src/dev/harness.ts`, `?manual=1`)
  and is advanced exactly 1/60 s per video frame with `__handy.advance()`, then
  screenshotted. The HUD, crosshair and hit markers are the real ones; only the
  Pause button is hidden.
- The page's timers and animation frames run on Playwright's fake clock, and
  every CSS animation and transition is scrubbed to the simulated time
  (`scrub()`), so a hit marker pops and a score rises exactly as it would in play.
- The hand is scripted (`aim.ts`, `directors.ts`): a slightly under-damped
  spring chases the target the game's own debug view reports, with a faint
  tremor, and fires once settled. In Overwatch Ridge the hand raises the scope
  and pans it at the scope's quarter gain, as a player's would. A director's
  `script` stages moments (a bandit out of a barrel, a bloater among the dead,
  a slab of debris let through to crack the glass) through the games' debug
  switches, in the real machinery.
- The small picture in the corner is the app's own `Pip` class drawing a
  finger-pistol skeleton (`hand.ts`) that follows the aim and folds its thumb
  a beat before each shot. No camera and no person is involved.
- The cold open uses the app's own finger-pistol illustration (the welcome
  screen's SVG); the title and end cards are built from the app's markup and
  design tokens (`cards.ts`, `promo.css`): the system face, glass, Title Case
  titles, fades rather than wipes.

**Sound** (`audio.ts`). While a game is captured, its audio bus records every
`play`, `loop` and `stop` with the simulated time. `audio.html` then runs the
games' own engine (`src/audio/engine.ts`) on an `OfflineAudioContext`,
suspending at each event's time to play it, and adds a quiet synthesised pad
and a few music-box notes where the picture is calm. `render.mjs` then finds a
gain and a limiter ceiling by measuring what a player would decode (the mix is
encoded to AAC, decoded and measured, up to eight rounds): about -14 LUFS
integrated and a true peak under -1 dBTP. The games' shots are much louder than
their beds, so the limiter works hard, and AAC adds an overshoot of its own that
the ceiling has to leave room for. Check the result with
`node tools/promo/loud.mjs anull tools/promo/out/handy-promo.mp4`.

**Video** (`render.mjs`). ffmpeg reads each segment's frames, converts to
BT.709 yuv420p, chains `xfade`, and muxes the audio.

## Tuning a take

Everything that makes a take repeatable is in `timeline.mjs` (`pre`, `seed`)
and `directors.ts`. Change a scene's staging there, capture it alone with
`--only`, and look at `contact.jpg`.
