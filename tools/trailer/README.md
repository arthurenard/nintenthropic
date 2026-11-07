# The Nintenthropic trailer

A 40-second film for X: 1920x1080, 60 fps, H.264 + AAC (about -14 LUFS, true
peak under -1 dBTP), cut to a 120 BPM score. A beat is 0.5 s (30 frames) and a
bar 2 s (120 frames); every cut falls on a beat, most on a bar. Every gameplay
frame is the real game, stepped one frame at a time in headless Chrome; every
sound is synthesised in code, and nothing is ever played through a speaker.

X starts a video muted, so the picture tells the whole story by itself: big,
few words. With the sound on, the music and the games' own sounds hit together
on the cuts.

## The story

"No controller. No keyboard. No mouse. Just your hands.", a line a beat; the
sight (the app's mark) snaps in and locks on. Bang: the four Finger Guns
shooters in quick cuts. "Now grab the wheel.": the sight's ring stays and its
ticks swing into the spokes of a steering wheel, which turns. Go: Grip Prix,
four karts, four players on one camera. Then the mark: **Nintenthropic.
Games you play with your hands.**

No hand is drawn anywhere in the film: the words, the sight and the real games
carry it.

## The grid

Bars of 2 s, on the trailer's clock; `edl.mjs` is the cut itself.

| Bars | Time | Picture | Music |
| --- | --- | --- | --- |
| 1-2 | 0:00-0:04 | **Hook** card on black: "No controller." (0.0), "No keyboard." (1.0), "No mouse." (2.0), "Just your hands." (3.0); the sight lands and locks on at 3.5; white by 4.0 | A thump on each word, a drone, a ticking clock, a rising tone; a lock-on blip, then a near-silent breath |
| 3-4 | 0:04-0:08 | High Noon: four quick hits and a dynamite fireball, then two sticks shot out of the air | **Drop** at 4.0: the groove in full; the motif comes in on bar 4 |
| 5-6 | 0:08-0:12 | Dead of Night: the beam finds the dead; the bloater bursts | The groove |
| 7-8 | 0:12-0:16 | Orbital Decay: the laser breaks the debris; a slab cracks the glass | The groove, the filters opening |
| 9-10 | 0:16-0:20 | Overwatch Ridge: the scope rises and the long shot lands; then the headshot in slow motion | Half time on bar 10, a riser into 20.0 |
| 11 | 0:20-0:22 | **Turn** card: the sight becomes a steering wheel, "Now grab the wheel.", the wheel turns; white by 22.0 | The break: the pad and the motif alone, a riser and a reverse swell |
| 12-17 | 0:22-0:34 | Grip Prix: GO on 22.0, a drift that lets go in flames, four players on one split screen, the pack in the air, the volcano erupting beside it, then half-bar cuts (a night track, an item) into the finish | **Second drop** at 22.0, bigger than the first; the climax on bars 16-17, a snare roll into 34.0 |
| 18-20 | 0:34-0:40 | **End** card: the app icon, "Nintenthropic", "Games you play with your hands.", Finger Guns and Grip Prix, "In your browser. No controller."; it fades to black from 39.3 | The last hit on 34.0, the resolution and a long tail, faded out by 40.0 |

Each game's title sits over its first bar, an eyebrow over a name ("Finger
Guns" over "High Noon", "Up to 4 Players" over "Grip Prix"), and "Up to 4
players. One camera." sits over the split screen.

## Re-render

With the dev server on port 4901 (`npx vite --port 4901 --strictPort`):

```bash
node tools/trailer/shooters/capture.mjs   # Finger Guns: 8 clips, about 8 minutes
node tools/trailer/race/capture.mjs       # Grip Prix: 8 clips and their race sound, about 25 minutes
node tools/trailer/cards/render.mjs       # the opening, the wheel, the end card, the titles
node tools/trailer/music/compose.mjs      # the score (and music/analyze.mjs to check it)
node tools/trailer/edit.mjs               # the cut, the mix and the encode, about a minute
```

The film is `tools/trailer/out/super-claude-bros-trailer.mp4` (ignored by git),
with `contact.jpg` (two frames a second) beside it. Each part takes `--only
id,id` to redo a few pieces; `edit.mjs --picture [--until 22]` renders the
picture alone, for looking.

## The parts

| Folder | Makes | Writes, in `tools/trailer/out/` |
| --- | --- | --- |
| `shooters/` | The four shooters' clips through their dev harnesses, with a scripted aim and no hand picture; each clip's moments come from the game's own record of the take | `clips/<id>/` (frames, `events.json`), `clips/shooters.json` |
| `race/` | Grip Prix through its renderer dev page (`?manual=1` steps it exactly), all-bot races, free cameras, split screens; each clip's race sound rendered offline | `clips/<id>/` (frames, `race.wav`), `clips/race.json` |
| `cards/` | The kinetic words, the sight that locks on and becomes a wheel, the end card, the titles (with alpha) | `cards/<id>/`, `cards/cards.json` |
| `music/` | The score, in pure Node DSP | `music/music.wav`, `music/cues.json` |
| `mix/` | The games' cues through their own engine on an OfflineAudioContext, the race stems, the music, ducking and the master | `mix/master.m4a` |
| `edl.mjs`, `edit.mjs` | The cut on the grid (a cut can put a clip's moment on a beat), the titles, flashes and zoom punches, the encode | `super-claude-bros-trailer.mp4`, `contact.jpg` |

A clip manifest (`shooters.json`, `race.json`) has one entry a clip:
`{ id, game, frames, fps: 60, slow: 1 | 2, w: 1920, h: 1080, what, moments: [{ t, what }] }`.
`what` says in a line what the clip shows; each moment is a hit, an explosion or
the like, `t` seconds into the clip; a race clip also names its `audio`. Clips
run a little longer than their slot (3-4 s for a 2 s slot), so a cut can `align`
its best moment to a beat instead of starting at a fixed point.
