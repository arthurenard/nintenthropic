# The Handheld trailer

A 40-second film for X: 1920x1080, 60 fps, H.264 + AAC (about -14 LUFS, true
peak under -1 dBTP), cut to a 120 BPM score so every cut falls on a beat. The
story and the grid are in [PLAN.md](PLAN.md). Every gameplay frame is the real
game, stepped one frame at a time in headless Chrome; every sound is
synthesised in code, and nothing is ever played through a speaker.

## Re-render

With the dev server on port 4901 (`npx vite --port 4901 --strictPort`):

```bash
node tools/trailer/shooters/capture.mjs   # Finger Guns: 8 clips, about 8 minutes
node tools/trailer/race/capture.mjs       # Grip Prix: 8 clips and their race sound, about 25 minutes
node tools/trailer/cards/render.mjs       # the opening, the wheel, the end card, the titles
node tools/trailer/music/compose.mjs      # the score (and music/analyze.mjs to check it)
node tools/trailer/edit.mjs               # the cut, the mix and the encode, about a minute
```

The film is `tools/trailer/out/handheld-trailer.mp4` (ignored by git), with
`contact.jpg` (two frames a second) beside it. Each part takes `--only id,id`
to redo a few pieces; `edit.mjs --picture [--until 22]` renders the picture
alone, for looking.

## The parts

| Folder | Makes |
| --- | --- |
| `shooters/` | The four shooters' clips through their dev harnesses, with a scripted aim and no hand picture; each clip's moments come from the game's own record of the take |
| `race/` | Grip Prix through its renderer dev page (`?manual=1` steps it exactly), all-bot races, free cameras, split screens; each clip's race sound rendered offline |
| `cards/` | The kinetic words, the sight that locks on and becomes a wheel, the end card, the titles (with alpha) |
| `music/` | The score, in pure Node DSP |
| `mix/` | The games' cues through their own engine on an OfflineAudioContext, the race stems, the music, ducking and the master |
| `edl.mjs`, `edit.mjs` | The cut on the grid (a cut can put a clip's moment on a beat), the titles, flashes and zoom punches, the encode |

No hand is drawn anywhere in the film: the words, the sight and the real games
carry it.
