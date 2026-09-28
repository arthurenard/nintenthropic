# Handy

**An arcade you play with your hand.** Point your finger at the screen, fold
your thumb to fire. It runs in your browser, sees your hand through your
webcam, and never sends the picture anywhere.

![Dust Creek at golden hour](public/assets/western/poster.webp)

## High Noon

Golden hour in Dust Creek, and the Carver gang comes out of every window,
doorway and barrel. They lean out, aim — watch for the glint of the sun on a
barrel — and fire back. Clear a wave and the next rides in: runners crossing
the street, dynamite you can shoot out of the air, riflemen on the roofs, and
Black Jack Carver himself.

- **Six shots.** Point off the screen to reload.
- **Take cover by being quick.** Get hit and the picture bleeds red at the
  edges; stay out of the line of fire for a few seconds and you recover. Three
  hits in quick succession, and it's over.
- **Spare the townsfolk.** The barber, the bartender and the undertaker have no
  quarrel with you.
- **Eight secrets** hide in Dust Creek. Try the bell.

More games — Dead of Night, Orbital Decay and Overwatch Ridge — are on their
way, and already in the arcade's row as Coming Soon. In Overwatch Ridge you
will close one eye to look through the scope (or hold Shift, or the right
mouse button).

## Play

Handy is a website: open it in a current browser on a computer with a webcam,
choose a game in the arcade's row, choose **Play**, and allow the camera. A
link to a game (`…/#high-noon`) opens the arcade on it.

To run it on your own machine:

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

**How to aim.** Hold your hand like a pistol; the crosshair follows your index
fingertip. Fold your thumb down to fire, raise it to cock again. If your
hand leaves the camera's view mid-round, the round waits for it and counts you
back in; after a fall, fold your thumb on the results to play again.

**Before every game, a quick aim check.** You warm up on bottles along the
street. It ends by itself as soon as 95% of your shots would land where you
aim — about six shots the first time, three when Handy remembers your aim.

**No camera?** Choose **Use Mouse or Trackpad**: click to fire, right-click to
reload.

| Key | Does |
| --- | --- |
| `P`, `Space` or `Esc` | Pause |
| `R` | Reload |
| `M` | Mute |

**Settings** — the gear in the corner, or Settings on the pause sheet — has
the difficulty (Relaxed is slower and gentler, for a first evening or a tired
arm), the volume, a larger or high-contrast crosshair, how steady the aim is
held, which camera to use, whether the camera's picture stays in the corner in
play, and Reduce Motion and Reduce Flashing. Everything is remembered in your
browser; Forget Saved Aim and Reset Handy clear it.

**Records.** Your best score is kept for each game and difficulty, and apart for your
hand and for a mouse or touch screen (which is far easier to aim). The arcade
shows the one to beat under Play; the results say when you beat it, and by how
much.

Handy can be installed as an app from the browser (Install Handy, or Add to
Dock / Add to Home Screen); it opens full screen.

## Privacy

Hand tracking is Google's MediaPipe, running inside your browser in
WebAssembly. The camera picture is read in memory, frame by frame, and never
stored or sent anywhere. In Overwatch Ridge, the one game with a scope, the
camera also reads whether one of your eyes is closed (you close one to look
through the scope); only the two eyes' blink scores are kept, only in that
game, and they never leave the device either. Handy has no server and no
analytics; the only files it downloads are its own.

## Requirements

A computer with a webcam and a current browser with WebGL 2. Handy is built
and tested in Google Chrome on macOS; current Edge, Safari and Firefox should
work but haven't been played through yet.

## Development

```bash
npm install
npm run dev          # the site, with hot reload
npm run typecheck
npx vitest run       # unit tests
npx playwright test  # end to end in headless Chrome (muted), with a fake camera
npm run build        # the static site, into dist/
```

- `src/app/`, `src/ui/`: the page — screens, the glass HUD, the aim check.
- `src/tracking/`, `src/input/`, `src/calibration/`: the camera, hand tracking
  (in a worker), the trigger and the aim map.
- `src/engine/`: the game host; `src/engine/types.ts` is the contract every
  game is built against.
- `src/audio/`: the Web Audio engine and every sound, synthesised in code.
- `src/games/western/`: High Noon.
- `art/western/`: the Blender scripts that build Dust Creek and its people.
  Everything under `public/assets/` is made by these scripts — there are no
  downloaded assets:

  ```bash
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/western/build_town.py
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/western/characters/build.py
  ```

CI runs the type check, the unit tests, the build and the end-to-end tests on
every push. Once the repository is public, every push to `main` also publishes
the site on GitHub Pages (enable it under Settings → Pages → GitHub Actions).

The design language is in [docs/DESIGN.md](docs/DESIGN.md), the architecture
and its contracts in [docs/WEB_ARCHITECTURE.md](docs/WEB_ARCHITECTURE.md), and
High Noon's design in [docs/HIGH_NOON.md](docs/HIGH_NOON.md). The answer to
the September 2026 product review, item by item, is in
[docs/REVIEW_RESPONSE.md](docs/REVIEW_RESPONSE.md).

Handy began as a Python desktop app; that version is kept in git under the tag
`python-final`.
