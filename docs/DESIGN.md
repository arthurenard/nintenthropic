# Handy design language

The bar is simple to state and hard to meet: every screen should feel as if
Apple had made it. That means three things, in this order.

- **Clarity.** One idea per screen, said in as few words as it takes. Type
  that is easy to read at a glance, from arm's length, with a hand in the air.
- **Deference.** The game world is the hero. Chrome is quiet, translucent,
  pushed to the edges, and gets out of the way the moment it is not needed.
- **Depth.** Layers and motion explain where you are and what just happened —
  a sheet slides over the world, a hit pops, a score counts up — and never
  decorate for their own sake.

When in doubt, remove it. A line, a label, a colour or an animation that does
not carry meaning is noise. Both surfaces — the browser page (`handy/web/`) and
the desktop window drawn with OpenCV (`handy/scene.py`, `handy/app.py`, the
maps' HUDs) — follow this document, so a player moving between them sees one
product.

## Voice

- Short, warm, confident, second person. "Point at the target. Fold your thumb
  to fire." Not "Point naturally at the lit target and fold your thumb. Your
  crosshair appears after two shots."
- No engineering words in anything a player reads: not calibration, rig,
  tracking, fused, landmarks, session, model bundle. Say *aim setup*, *your
  hand*, *your camera*. (`--debug` may say anything.)
- **Title Case** for titles, buttons and map names ("Dead of Night", "Play
  Again", "Choose a Game"). Sentence case for everything else. No ALL CAPS
  except the tiny eyebrow label above a title, and never for more than two or
  three words.
- Errors say what happened and what to do, calmly, in one or two lines, with
  the fix as a button when there is one: "Your camera is being used by another
  app. Close it, then Try Again."
- Numbers use tabular figures so a changing score does not jitter. Times read
  `0:48`, scores group thousands (`1,240`).

## Type

The system face. On Apple devices that is SF Pro; elsewhere the platform's own.

- **Browser:** `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text",
  "SF Pro Display", "Helvetica Neue", "Segoe UI", Roboto, system-ui,
  sans-serif;` with `font-variant-numeric: tabular-nums` on every number.
  Headlines tighten tracking (−0.02em at 34 px and up, −0.01em at 22–28 px).
- **Desktop:** SF Pro loaded at runtime from `/System/Library/Fonts/SFNS.ttf`
  through `cv2.FontFace` (weights via `putText`'s weight argument: 400 regular,
  500 medium, 600 semibold, 700 bold), falling back to OpenCV's built-in sans
  when that file is not there. The font is read from the system, never copied
  into the repository.

| Style | Size (web px / desktop units at 720p) | Weight | Use |
| --- | --- | --- | --- |
| Large Title | 56 / 44 | Bold | The one hero line on a screen; the final score |
| Title 1 | 34 / 30 | Bold | Screen titles, the round score in the HUD |
| Title 2 | 28 / 24 | Semibold | Map names on cards, results headline |
| Title 3 | 22 / 20 | Semibold | Panel titles, the round clock |
| Headline | 17 / 16 | Semibold | Buttons, emphasis |
| Body | 17 / 16 | Regular | Instructions, descriptions |
| Subhead | 15 / 14 | Regular | Secondary lines |
| Footnote | 13 / 12 | Regular | Hints, captions |
| Eyebrow | 12 / 11 | Semibold, +0.06em, caps | The two-word label above a title |

Desktop sizes are multiplied by the layout's scale like everything else. A
screen uses at most three of these styles at once.

## Colour

Dark appearance only: the game is played in the dark with a camera light on.
Colour comes from the game worlds; the interface is monochrome plus one tint.

| Token | Value | Use |
| --- | --- | --- |
| Background | `#000000` | Page and window behind everything |
| Surface | `#1C1C1E` | Cards, sheets |
| Surface raised | `#2C2C2E` | Controls on a surface, pressed states |
| Glass | `rgba(28, 28, 30, 0.72)` + blur | Any panel over the game world |
| Hairline | `rgba(255, 255, 255, 0.10)` | The one-pixel edge of glass and cards |
| Label | `#FFFFFF` | Primary text |
| Label secondary | `rgba(235, 235, 245, 0.62)` | Secondary text |
| Label tertiary | `rgba(235, 235, 245, 0.32)` | Hints, disabled |
| **Tint — Ready** | `#30D158` | Your gun: the armed crosshair, ready state, progress, success |
| Danger | `#FF453A` | Health low, a lost hand, destructive actions |
| Warning | `#FF9F0A` | Attention without alarm |
| Gold | `#FFD60A` | New best, perfect hits |

Green means *your gun is ready* everywhere and nothing else competes with it.
Primary buttons are white pills with black labels (the way Apple Arcade's Play
button is); the tint is for state, not for decoration. No decorative coloured
rules, tabs or stripes on panels.

In OpenCV these are BGR: tint `(88, 209, 48)`, danger `(58, 69, 255)`, warning
`(10, 159, 255)`, gold `(10, 214, 255)`, surface `(30, 28, 28)`.

## Materials and shape

- **Glass** over the world: the region behind it blurred (web:
  `backdrop-filter: saturate(180%) blur(24px)`; desktop: a blur of that region
  at quarter resolution, then the glass tint) with a hairline edge. It must stay
  legible over the brightest sky and the darkest road.
- **Corner radii** (continuous where the platform allows): 10 controls,
  16 small panels, 22 cards, 28 sheets. Buttons are full pills.
- **Hit targets** are at least 44 pt on the web. On the desktop, anything you
  shoot with your finger is at least 64 units at 720p, because a hand is less
  precise than a mouse.
- **Shadows** only lift sheets and modals above the world: large radius, low
  opacity, no hard edges.
- **Spacing** on an 8-point grid (4 for tight pairs). Screen margins 24 at
  720p-equivalent, 32 on large windows.

## Layout

- **In a round, the world owns the centre.** Chrome lives in the corners:
  score top-left, clock top-centre, one Pause control top-right. Nothing else
  stays on screen. Map-specific readouts (health, wave, wind, integrity) sit in
  one small glass panel with the score, not in panels of their own.
- **The camera preview** is a small rounded picture-in-picture, like FaceTime's,
  in a corner that the map keeps clear. It grows during setup, where seeing your
  hand matters, and shrinks in play, where the world matters. The hand skeleton
  on it is drawn in white with soft round joints, not in debug colours.
- **Menus are sheets.** Pausing brings a glass sheet over a dimmed world with a
  few large choices (Resume, Restart, Choose a Game, Quit). On the desktop each
  is shootable and big enough to hit with a finger pistol.
- **Hints** appear when they help (a round's first seconds, a lost hand, an
  unknown key) and fade away when they stop helping.

## Motion

- UI transitions: 250 ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`.
- Sheets and cards arriving: 450 ms spring-like `cubic-bezier(0.2, 0.9, 0.1, 1)`.
- Feedback in play is immediate and short: a hit marker pops (scale 1.25 → 1 in
  120 ms), a score popup rises and fades in 600 ms, the crosshair kicks with the
  recoil. Nothing in the play path animates longer than half a second.
- Numbers that change a lot (the final score) count up; numbers that change
  every frame (the clock) never animate.
- Respect `prefers-reduced-motion`: cross-fade instead of move, no count-ups.

## Iconography

Line icons in the style of SF Symbols: 1.75 px strokes (scaled), round caps and
joins, drawn on a 24-unit grid, filled variants only for the active state.
Inline SVG on the web; drawn with anti-aliased OpenCV strokes on the desktop.
Needed: play, pause, restart, grid (choose a game), xmark (quit), speaker on/off,
camera, hand, checkmark, share.

## Sound

Every meaningful event has a sound, and the same event sounds the same in the
browser and the desktop app (both play the synthesised set from `audio.py`).
Interface sounds are soft and short; game sounds carry the weight. Mute is one
click and remembered.

## First run

1. A welcome that fits on one screen: what Handy is, one looping illustration of
   the gesture (point, fold the thumb, fire), and one button.
2. Before the browser asks for the camera, say why and what happens to the
   picture: "Handy needs your camera to see your hand. The picture stays on
   this computer."
3. Aim setup is the Target Range and feels like part of the game: large targets,
   a clear count of what is left, a small celebration on each good hit. A
   returning player whose saved aim still fits goes straight into the game, with
   Adjust Aim one click away.
4. A download on first use shows real progress ("Getting ready… 45%"), not a
   spinner.

## Results

A card worth sharing: the map's art as its header, the map's name, the outcome
in a word or two, the score large, three or four stats, *New Best* in gold only
when it is true, and two choices (Play Again, Choose a Game) plus Share — a PNG
of the card, branded Handy, saved or passed to the system share sheet.

## Checklist for any change

- Could a first-time player understand this screen in two seconds?
- Is anything on it decoration? Remove it.
- Does every number use tabular figures, every title Title Case, every string
  the voice above?
- Is it legible over the brightest and darkest parts of every map?
- Does it still look right at 1280×720, 1512×945 (a MacBook in fullscreen),
  2560×1440, and in a narrow browser window?
- Does it respect reduced motion, keyboard use and screen readers (web)?
