# Handy

A local webcam arcade with **four games** and a **Target Range warm-up**.
Play with a finger pistol in your browser or the fullscreen desktop app.
Mouse and touch are available as a smaller alternative in the browser.

## Install and run

You need [uv](https://docs.astral.sh/uv/getting-started/installation/) and
`git`. uv fetches Python 3.12 and every other dependency itself.

Try it without installing:

```bash
uvx --python 3.12 --from git+https://github.com/arthurenard/claude-of-duty handy --browser
```

Or install the `handy` command:

```bash
uv tool install --python 3.12 git+https://github.com/arthurenard/claude-of-duty
handy --browser   # the browser arcade
handy             # the fullscreen desktop app
```

`uv tool upgrade handy` updates it and `uv tool uninstall handy` removes it.
Keep `--python 3.12`: without it, uv installs into whichever Python it finds
first, even one Handy does not support.

From a checkout, prefix any command with `uv run`:

```bash
git clone https://github.com/arthurenard/claude-of-duty
cd claude-of-duty
uv run handy --browser
```

**First run.** Camera play downloads MediaPipe's hand model (~8 MB) and face
model (~4 MB), about 12 MB in all, into `~/.cache/handy/models/`. That happens
once; after it, the game never needs the network. Mouse and touch need no
model.

**Camera permission.** The browser arcade asks for the camera in the page;
allow it for `127.0.0.1` (macOS may also ask whether the browser itself may use
the camera). The desktop app uses your terminal's permission: macOS asks the
first time, and the setting is under **System Settings → Privacy & Security →
Camera**. Restart the terminal after changing it.

**Platforms.** Handy runs where MediaPipe 0.10.35 and OpenCV publish wheels:

- **macOS 13 or later on Apple silicon** — where Handy is developed and played.
- **Linux on x86_64** (glibc 2.28 or later) — CI runs the test suite there, but
  nobody has played it there with a camera yet. It needs the OpenGL, EGL and
  GLib libraries a desktop install already has (on Debian or Ubuntu: `libgl1
  libegl1 libgles2 libglib2.0-0`).
- **Windows on x86_64** — the wheels exist, but Handy has not been tried there.
- **Not supported:** Intel Macs, ARM Linux (such as a Raspberry Pi) and Windows
  on ARM, for which MediaPipe 0.10.35 or OpenCV publishes no wheel.

On macOS the test suite passes on Python 3.10 to 3.13; CI uses 3.12.

## Play in your browser

```bash
handy --browser
```

Open **http://127.0.0.1:8765** if a tab does not open automatically. Keep the
terminal running; Ctrl+C stops the server. Choose a game and press **Warm up & play**. Finger pistol is selected by default.
The smaller **Use mouse or touch instead** option needs no camera or calibration.

This is a **local browser interface backed by Python**, not a standalone hosted
website. The maps use the shared game engine and rendering. There is no
JavaScript copy of the game rules. It serves only this computer, one active game
at a time; starting in another tab replaces the previous session.

Camera frames travel only between the browser and the local Python process.
They are processed in memory, not saved or sent to a cloud service. Camera modes
download their MediaPipe model bundles on first use; after that they use the
cached bundles. Mouse and touch do not load models.

For a different port or to open the browser yourself:

```bash
handy --browser --port 8766 --no-open
```

Browser launch accepts `--port` and `--no-open`; choose the game, controls,
opponent, and duration in the page. Other CLI settings below belong to the
desktop app. Use a current desktop browser with camera permission enabled for
localhost. If the camera is denied, missing, or busy, choose mouse / touch
and play immediately.

## Which controls are there?

**Finger pistol is the main control:** move your index fingertip to aim, fold
your thumb to fire, and raise it to re-arm. The webcam preview shows your hand’s
tracked joints and connecting bones during warm-up and play.

Mouse / touch is an alternative: point and click or tap. Right-click or Shift
controls the sniper scope.

**On Overwatch Ridge, hand controls automatically track your eyes too.** Close
an eye and hold it briefly to look down the scope; open it to zoom out.
The detector uses lid closure directly and filters short natural blinks.
While scoped, hand motion moves the view at **one-quarter sensitivity**. You still aim and shoot
with your hand. There is no separate scope mode to select and **no eye
calibration**. The hand setup is shared with the other shooting maps.

Mouse players use right-click or Shift for the scope, without a camera.

## Calibration without guessing

Hand controls open **Target Range** before the selected game:

1. Keep your hand visible in the **live mirrored camera view**. The target field
   fills most of the window and keeps the same size when the game starts.
2. Point naturally at the lit target and **fold your thumb to shoot**. Raise it
   before the next shot. Thumb angle and distance from the fingers work out of
   the box; there are no thumb poses to calibrate.
3. After **two usable shots**, the crosshair shows your estimated aim. A third
   shot finishes the initial fit. A saved fit goes straight to the accuracy check.
4. Hit the centres of **five different targets** with that mapping. Only shots
   inside the inner two rings count. These hits verify the existing fit; they
   are not used to train it.
5. After the fifth accurate hit, the aim saves and your selected game starts
   automatically. A miss can refine the aim; changing the fit restarts the check.
   **Undo shot** removes a mistake; **Start over** clears the current attempt.

Setup uses your hand position just before the thumb folds, avoiding movement
caused by firing. No thumb or eye calibration is needed. Use **Adjust aim** after
moving your camera or seat. Browser settings are saved per camera and are
independent of the desktop calibration file.

The browser pauses when you switch tabs or windows. Use **Pause / P**, or resume
from the overlay. **Arcade** stops the camera and returns to game selection,
even while a game is still loading. A game whose tab goes quiet for a minute
(closed, crashed, or asleep) is closed so its models do not stay loaded. A
saved browser setup that can no longer be used is discarded and setup starts
afresh.

## Games and opponents

| Game | What you do |
| --- | --- |
| Dead of Night | Survive approaching waves; headshots kill, body shots slow |
| High Noon | Shoot bottles and bandits in a western street |
| Orbital Decay | Protect the station from incoming debris |
| Overwatch Ridge | Aim across a valley with a rifle and scope |

In **Dead of Night**, choose **Zombies** or **Humanoid robots** in the opponent
selector before starting. Robots have armoured bodies, illuminated visors and
spark impacts. They use the same head/body damage, score, and wave rules; robots
remain upright, while zombies also have crawling and limping variants.

## Desktop app

```bash
handy
handy --map zombies --enemy robots
handy --map sniper
```

macOS asks for camera access for your terminal the first time; manage it under
**System Settings → Privacy & Security → Camera**.

Desktop setup uses the same Target Range warm-up with a live hand skeleton.
Five accurate hits accept the aim and start play automatically. **B** undoes a
shot, **R** starts over, and **Esc** skips. Aim is saved in
`~/.cache/handy/calibration.json` and reused only when it was verified with the
same cameras, capture size and mirroring; otherwise setup runs again.

During desktop play: **Q** quit, **R** restart, **B** maps, **C** recalibrate,
**S** screenshot. In Dead of Night, **N** switches the opponent
and starts a fresh round. Browser controls are shown beside the play area.

## Options

Browser launch uses the first three flags. Configure browser gameplay in the
page; the remaining flags configure the desktop app.

| Flag | Default | Purpose |
| --- | --- | --- |
| `--browser` | off | Launch the local browser arcade; takes only `--port` and `--no-open` |
| `--port` | `8765` | Browser server port (with `--browser`) |
| `--no-open` | off | Start browser server without opening a tab (with `--browser`) |
| `--control` | `pistol` | The only hand control, kept for old scripts; the sniper eye scope is automatic |
| `--map` | chooser | `zombies`, `western`, `orbit`, `sniper` |
| `--enemy` | `zombies` | Dead of Night: `zombies` or `robots` |
| `--camera` | first live camera | Camera index; repeat for multiple cameras |
| `--list-cameras` | | List cameras and exit |
| `--capture` | `1280x720` | Camera resolution |
| `--no-mirror` | off | Use an unmirrored camera view |
| `--model` | cached bundle | Custom hand `.task` model; sniper also loads the face model |
| `--duration` | `60` | Seconds per round, up to 3600; `0` is endless |
| `--calibrate` | off | Redo saved setup (not with `--no-calibration`) |
| `--no-calibration` | off | Use defaults |
| `--calibration-file` | cache directory | Override calibration file |
| `--min-cutoff` | per control | Smoothing when holding still |
| `--beta` | per control | Responsiveness during movement |
| `--fire-above` | per control | Trigger travel needed to shoot |
| `--arm-below` | per control | Travel below which the trigger re-arms |
| `--recoil` | `26` | Crosshair kick in pixels; `0` disables |
| `--mute` / `--volume` | sound on / `1.0` | Sound output; volume 0–1 |
| `--targets` | `3` | Targets a round opens with (1–20; not High Noon) |
| `--spawn-interval` | `1.1` | Seconds between spawns as a round opens (not High Noon) |
| `--lifetime` | `5.0` | Target Range face lifetime; no playable map reads it |
| `--seed` | random | Reproducible target sequence |
| `--debug` | off | Tracking diagnostics |
| `--screenshot-dir` | `screenshots/` | Screenshot location |

## Development

```bash
uv sync                          # .venv, with Handy installed in editable mode
uv run pytest
uv run ruff check handy tests
for f in handy/web/*.js; do node --check "$f"; done
uv build                         # sdist and wheel, into dist/
```

`uv run handy` and `uv run python -m handy` both run the checkout. CI runs the
lint, the tests and the script check on macOS (Apple silicon) and Ubuntu, then
builds the wheel, installs it into a clean environment and starts the browser
arcade from it.

- `handy/browser.py` — local HTTP adapter, session lifecycle and browser input.
- `handy/web/` — dependency-free HTML, CSS, and JavaScript interface.
- `handy/shot_calibration.py`, `calibration.py`, `schemes.py`, `aiming.py` — shared control pipeline.
- `handy/game.py`, `handy/maps/` — shared game rules and drawing.
- `handy/app.py`, `cli.py` — desktop window and launch commands.
- `tests/` — game rules, calibration, browser lifecycle, rendering, and tracking.

The browser uses one camera and a game render sized to the target area. It uses lightweight
browser-generated sound cues; the desktop app retains the full sound mixer,
multi-camera fusion, and desktop high scores. Browser camera accuracy still
depends on lighting, framing, and the player; practice before starting a round.

The detailed tracking, rendering, camera-fusion, and map design explanations
are kept in [Engine notes](docs/ENGINE_NOTES.md).
