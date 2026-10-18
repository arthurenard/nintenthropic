# Grip Prix, filmed for the trailer

Eight clips of Grip Prix for the 40-second Super Claude Bros. trailer (bars 12-17, the part after the "Now grab the wheel." card),
filmed from the game itself: the real sim, the real renderer and its Blender art, the real HUD, stepped exactly one
video frame at a time in a muted headless Chrome. Nothing is faked: no stand-in karts, no generated images. The
sounds of each clip are the race's own, rendered offline from the same frames; nothing is ever played.

```bash
node tools/trailer/race/capture.mjs                      # everything: frames, sound, contact sheets, race.json (about 25 minutes)
node tools/trailer/race/capture.mjs --only gp-go,gp-four # some of the clips (the others stay in race.json)
node tools/trailer/race/capture.mjs --only gp-cine --no-audio
node tools/trailer/race/capture.mjs --no-frames          # sound and manifest again, from the views of the last capture
node tools/trailer/race/capture.mjs --dsf 1              # draw at 1x instead of 2x: twice as quick, a little less smooth
```

The dev server must be running on port 4901 (`npx vite --port 4901 --strictPort`); the capture never starts or stops
it. Everything is written to `tools/trailer/out/` (git-ignored):

| File | |
| --- | --- |
| `clips/<id>/00001.png ...` | 1920x1080 frames, 60 fps. Drawn at 2x (3840x2160) and brought down by Chrome (a smooth, supersampled edge) |
| `clips/<id>/race.wav` | the race's own sound, 48 kHz stereo 32-bit float, frame 1 at sample 0, exactly `frames x 800` samples |
| `clips/<id>/contact.jpg` | every 15th frame, to look at |
| `clips/race.json` | the manifest: `{ id, game, frames, fps: 60, slow: 1, w, h, what, moments: [{ t, what }], audio, audioStats }` |
| `race-work/<id>/views.json` | every frame's view (karts, events, things), for the sound and the moments |

## The clips

All of them are the real sim with seed 5 (eight bots on the track), so a re-capture is the same race. They are a
little longer than a slot (4.5 to 5.5 s) so the edit can choose its in-point; `moments` gives the times (seconds into the
clip) of the things that want a beat.

| id | where | what |
| --- | --- | --- |
| `gp-go` | Meadow Loop, daylight | The start from the back of the grid: the camera dives over eight karts under the red lights, GO at 2.5 s (frame 150), the pack launches in flames, the kart under the camera drives out under the GRIP PRIX gantry. HUD on |
| `gp-drift` | Canyon Run, golden hour | A long right-hand drift in a chase camera: blue sparks, orange sparks, the release into a boost with flames. HUD on |
| `gp-four` | Five Finger Circuit, beach | The four-way split screen with the centre map and standings (the HUD that sells "four players"): close racing, pucks, a drift boost |
| `gp-jump` | Kitchen Rally, sunset | All eight karts leap off the ramp in a row, tricks in the air against the sunset sky and the giant kitchen's cabinets (a low camera at the counter's edge, looking up), then the landing boosts. HUD on |
| `gp-item` | Meadow Loop | A skyrocket: the camera rides it over the road, the red target zone closes on the leader, the burst, karts spinning with stars. HUD on |
| `gp-night` | Harbour Lights, night | From behind a mid-pack kart: tail lamps, headlight pools, cranes, the lighthouse beam, a nitro boost. No HUD |
| `gp-cine` | Volcano Rush | The "wow" shot: a camera at the roadside rides alongside a tight pack and swings round it, the lava-streaked volcano and a glowing lava gate behind, a geyser erupting. No HUD |
| `gp-finish` | Fun Fair, dusk | The leader crosses the finish line under the gantry, confetti, the camera tilts up to the fireworks. No HUD |

## How it works

- **`src/kart/render/dev.ts`** (the trailer's one hook in the game's code): `?manual=1` stops the page's
  animation-frame loop and adds `__grip.advance(dt = 1/60, before?)`, which steps the source exactly `dt`, draws one
  frame and returns the frame's view (`before(view)` runs just ahead of the draw: that is where a free camera is set);
  `?seed=` hands a seed to the real sim (`?sim=1`). Everything else is built on those and on what the page already exposed.
- **`lib.mjs`**: muted headless Chrome on the GPU (`--mute-audio --use-angle=metal --ignore-gpu-blocklist --enable-gpu
  --enable-gpu-rasterization`), the page, and an init script that makes the run repeatable: `Math.random` is a seeded
  generator and `performance.now` is pinned to the simulated clock (camera kicks, spin-out sparkles and the like are the
  same every time), the HUD's CSS animations are paused and scrubbed to the simulated time on every frame, and the
  WebGL canvas keeps its drawing buffer, so a screenshot never catches a blank one.
- **`shoot.mjs`**: runs a clip. `skip` simulated seconds without drawing (the page's `?skip=`), `pre` drawn frames that
  are not kept, then `frames` PNGs; it records every frame's view. If the dev server reloads the page half way (it
  does when it re-optimises dependencies) the clip is filmed again from the start.
- **`rig.mjs`**: the cameras and helpers the directors use inside the page (`window.__rig`): points on the track, a
  chase camera of its own (the game's keeps a fixed distance and is blocked by a kart that overtakes close by), an orbit
  that rides along a kart and swings round it. A director may also set things up in the sim through its own debug
  hooks (`demo.forceUse`, `demo.patch`), which `plan.mjs` says where: **`gp-item`** forces the skyrocket,
  **`gp-night`** forces a nitro, **`gp-drift`** gives the drifting leader a head start on its charge (a bot only reaches
  the blue sparks in that bend) and **`gp-finish`** shows the winner to the renderer as a person, which is what sets off
  the Fun Fair's fireworks (the sim still drives it as a bot). Everything else is the race as the sim ran it.
- **`audio.mjs`, `audio.ts`, `audio.html`**: the sound. The recorded views are replayed through the race's real audio
  (`createRaceAudio` on the games' `WebAudioEngine`, on an `OfflineAudioContext`, as `src/kart/audio/dev.ts` does for its
  scripted race), calling `audio.frame(view, localKarts(views), dt)` at each frame's time. Up to 90 frames of the pre-roll
  are played first (the engines are already running when the clip begins) and cut off. The music is left out (the trailer
  has its own): engines, drift squeals, sparks, pickups, items, hits, jumps, landings, the start lights and GO.
  The listener is the kart the camera follows (all four, panned, in the split screen). `audioStats` in `race.json` has
  each file's RMS and peak in dBFS; check a WAV by its levels, never by playing it.
- **`plan.mjs`**: the clips (tracks, times, cameras, moments). `scan.mjs` lists a track's events and drift episodes
  without drawing (it is how the moments were found), `lm.mjs` a track's landmarks, `preview.mjs` a cheap look
  (960x540 JPEGs every Nth frame and a contact sheet: `node tools/trailer/race/preview.mjs --only gp-cine --every 15`; `--set key=value`
  tries another value of any field, e.g. `--set skip=12`), `darkcheck.py` lists black or repeated frames.

## Checks

`capture.mjs` prints, per clip, the frames, the network problems (a failed `.glb` or `.wasm` would mean a stand-in kart:
there are none) and the dark or repeated frames (none). Look at `contact.jpg` before using a clip.
