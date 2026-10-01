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
not carry meaning is noise. Everything a player sees — the page's HTML
interface (`src/app/`, `src/ui/`) and what each game draws in its 3D world
(`src/games/`) — follows this document, so every screen reads as one product.

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

`font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro
Display", "Helvetica Neue", "Segoe UI", Roboto, system-ui, sans-serif;` with
`font-variant-numeric: tabular-nums` on every number. Headlines tighten tracking
(−0.02em at 34 px and up, −0.01em at 22–28 px). No web fonts are downloaded.

| Style | Size (px) | Weight | Use |
| --- | --- | --- | --- |
| Large Title | 56 | Bold | The one hero line on a screen; the final score |
| Title 1 | 34 | Bold | Screen titles, the round score in the HUD |
| Title 2 | 28 | Semibold | Game names, results headline |
| Title 3 | 22 | Semibold | Panel titles, the round clock |
| Headline | 17 | Semibold | Buttons, emphasis |
| Body | 17 | Regular | Instructions, descriptions |
| Subhead | 15 | Regular | Secondary lines |
| Footnote | 13 | Regular | Hints, captions |
| Eyebrow | 12 | Semibold, +0.06em, caps | The two-word label above a title |

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
rules, tabs or stripes on panels. For the same reason the controls in Settings
are neutral: white for *on* and for the choice made, never green (see Settings).

## Materials and shape

- **Glass** over the world: the region behind it blurred
  (`backdrop-filter: saturate(180%) blur(24px)`) with a hairline edge. It must
  stay legible over the brightest sky and the darkest road.
- **Corner radii** (continuous where the platform allows): 10 controls,
  16 small panels, 22 cards, 28 sheets. Buttons are full pills.
- **Hit targets** are at least 44 px for a pointer. Anything you shoot with a
  finger pistol is bigger still, because a hand is less precise than a mouse.
- **Shadows** only lift sheets and modals above the world: large radius, low
  opacity, no hard edges.
- **Spacing** on an 8-point grid (4 for tight pairs). Screen margins 24 at
  720p-equivalent, 32 on large windows.

## Layout

- **In a round, the world owns the centre.** Chrome lives in the corners:
  score top-left, clock top-centre, one Pause control top-right. Nothing else
  stays on screen. Map-specific readouts (health, wave, wind, integrity) sit in
  one small glass panel with the score, not in panels of their own.
- **The weapon's corner** (bottom right) says what the gun has left, in one
  glass shape and the same language whatever the gun: white for what is
  ready, an outline for what is spent, red when it cannot fire. A revolver
  is its cylinder of chambers; a rifle is its rounds in a row with the one in
  the chamber apart in its breech, the breech dashed while the bolt or lever
  is worked and red when it is empty; a laser is a ring that fills with its
  heat, a number in tabular figures inside, orange near the top and red while
  it vents. The golden weapon turns what is ready gold, in every game.
- **The clock** of a timed round sits top centre in a glass pill, Title 3 in
  tabular figures, orange for its last seconds; it never animates.
- **The scope.** A game with a scope draws its own reticle while the player
  looks through it, and the page's crosshair steps aside. Closing one eye
  scopes (with the hand), and so do Shift and the right mouse button, held or
  toggled as Settings says. On a touch screen a Scope button - a glass
  circle, 64 px, the scope's symbol - sits in the bottom-left corner, which
  the camera's picture would take with the hand, and turns white while
  pressed (or toggled on).
- **The camera preview** is a small rounded picture-in-picture, like FaceTime's,
  in a corner that the map keeps clear. It grows during setup, where seeing your
  hand matters, and shrinks in play, where the world matters. The hand skeleton
  on it is drawn in white with soft round joints, not in debug colours.
- **Menus are sheets.** Pausing brings a glass sheet over a dimmed world with a
  few large choices (Resume, Restart, Adjust Aim, Settings, Choose a Game).
  With two or more cameras, Switch Camera joins them after Adjust Aim, and a
  small glass icon button of the same name sits on the camera's picture during
  the aim check. It swaps to the next camera at once, names it in a toast
  ("FaceTime HD Camera"), and begins the aim check again for it - from that
  camera's saved aim when it has one. With one camera it is nowhere.
- **Hints** appear when they help (a round's first seconds, a lost hand, an
  unknown key) and fade away when they stop helping.
- **Tall and short windows.** The stage is never taller than its game's art
  allows - 1.1 : 1 unless the game says otherwise (`GameEntry.stage`), and a
  game may also set how wide it may go: in a tall window (a phone held
  upright) the world plays in a band across the middle, with black above and
  below (and in a window wider than a game allows, in a column with black at
  the sides), and on a touch screen a footnote
  suggests turning it sideways. A short stage (under 520 px, a phone on its
  side) shrinks the chrome to what its corners can spare: a smaller score
  panel, pause button and cylinder, and the hint at the foot of the view
  rather than over the street.

## Motion

- UI transitions: 250 ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`.
- Sheets and cards arriving: 450 ms spring-like `cubic-bezier(0.2, 0.9, 0.1, 1)`.
- Feedback in play is immediate and short: a hit marker pops (scale 1.25 → 1 in
  120 ms), a score popup rises and fades in 600 ms, the crosshair kicks with the
  recoil. Nothing in the play path animates longer than half a second.
- Numbers that change a lot (the final score) count up; numbers that change
  every frame (the clock) never animate.
- Respect `prefers-reduced-motion`: cross-fade instead of move, no count-ups.
  The player's own Reduce Motion (Settings) wins over the system's either way;
  the page marks `<html data-reduce-motion>` for both, and every reduced-motion
  rule hangs off that one attribute.

## Iconography

Line icons in the style of SF Symbols: 1.75 px strokes (scaled), round caps and
joins, drawn on a 24-unit grid, filled variants only for the active state.
Inline SVG.
Needed: play, pause, restart, grid (choose a game), xmark (quit), speaker on/off,
camera, hand, checkmark, share, gear (settings), scope, chevrons (a row that leads on,
a menu).

The mark is the one exception: a sculpted white hand making a finger pistol, aimed at
the game's own green crosshair, on a dark rounded square. Its forearm fades into the
dark, and a faint glow sits behind the crosshair. The hand is a Cycles render built
from real bone lengths (`tools/icons/hand.py`). `tools/icons/mark.mjs` lays it out,
and `node tools/icons/render.mjs` writes the app icons and the favicon to
`public/icons/`. The wordmark, the share card and the promo use `icon-192.png` or
`icon-512.png`. Never redraw the mark elsewhere, and never use it as a button icon.

## Sound

Every meaningful event has a sound, synthesised in code at load
(`src/audio/`): no audio files are shipped.
Interface sounds are soft and short; game sounds carry the weight. Mute is one
click and remembered.

## The arcade

The home screen is the arcade: the chosen game large, and every game in a
row beneath it.

- **The hero** is the chosen game: its poster (rounded 22, lifted by the
  shadow) beside its name (Large Title), two or three sentences about it,
  Play and Adjust Aim, how you are playing (Finger Pistol, or the mouse),
  and, quietly, your best in this game. When the window is short the picture
  gives way to the row before the words do.
- **The row** holds every game's poster as a card (16:9, rounded 16) with its
  name under it. The chosen card is ringed in white, the page's colour for a
  choice made, and the others sit back a little until the pointer is on
  them. It is a radio group: one tab stop, the arrow keys choose (Home and
  End go to the ends), a click chooses. With the keyboard the card in hand
  lifts toward you. In a narrow window the row goes two by two, every game
  in sight.
- **Coming Soon** games are in the row too, named and never faked: "Coming
  Soon" under the name, and in the hero, where Play would be, a quiet
  label rather than a button.
- **Posters.** Until a game's poster exists (it is rendered in Blender), its
  light stands in where the picture would be: a sky and a glow in the game's
  own colours (golden hour, moonlit fog, a planet's limb, dawn over a
  valley), never a picture pretending to be the game (`GameEntry.backdrop`).
- **Remembered, and shareable.** The chosen game is remembered, and is the
  page's address (`#dead-of-night`): a link opens the arcade on that game.
  Choose a Game, from the pause sheet or the results, comes back to the
  arcade with the game just played chosen.

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

A card worth sharing: the map's art as its header, the map's name (and
"Relaxed" beside it when it was), the outcome in a word or two with the game's
one line under it when it has one (what felled you, or the thing to watch
next time), the score large, three or four stats, *New Best* in gold only when
it is true, with how far it beat the last one beside it, and otherwise,
quietly, the best to beat. Then two choices (Play Again, Choose a Game) plus
Share — a PNG of the card, branded Handy, saved or passed to the system share
sheet.

The card that arrives with the fall, before the results, says the same words
the results will: the outcome as its title ("Fell on Wave 4", "Breached on
Pass 2", "Spotted on Stage 3") and, under it, what did it ("A walker at the
barricade."). A wave, pass or stage opens the same way: "Wave 3", "Pass 3",
"Stage 3", and one short line under it. Notes and tips use full stops and
colons, not dashes.

Records are kept apart for each game, difficulty and control: the hand and a
pointer never share one (a mouse is far easier to aim). The arcade shows the
best to beat for the control and difficulty chosen, in one quiet line under
Play, and nothing before there is one.

## Settings

One sheet, from the arcade's gear and from the pause sheet, laid out the way
the system's own settings are.

- **Grouped rows.** Rows sit in rounded groups (16) on the sheet's glass, with a
  hairline between them that starts where their words do, an eyebrow over each
  group, and a footnote under it when something needs saying (secondary, 13).
  Row names are Title Case at 17; values are secondary.
- **One control per kind of choice.** Two or three options: a segmented control,
  which is a radio group (one tab stop; the arrow keys choose, as with radio
  buttons). On or off: a switch. A level: a slider with a speaker at each end.
  One of a list (cameras): a menu showing the current one, only when there is
  more than one. Each reaches 44 px however small it looks.
- **Neutral, not green.** A switch that is on is a white track with a black
  knob; the chosen segment is a white thumb with black words — the same white
  as the primary buttons, and a grey track or fill when off.
  Green would read as *your gun is ready*.
- **At once, and kept.** A change takes effect as it is made and is remembered;
  there is no Save. What cannot change mid-round (the difficulty, the camera)
  waits for the next, and the footnote says so when the sheet is over a paused
  game.
- **Aim Assist** is a switch in a group of its own, on unless the player turns
  it off, with a footnote that says what it does and where it does not apply:
  "Makes targets a little easier to hit. Overwatch Ridge always stays exact."
  Aim Steadiness (a segmented control above it) starts on Steady, which holds
  a shaky hand still; the player who prefers a quicker crosshair chooses
  Balanced or Responsive.
- **A game's own group** shows only while such a game can be played: Scope
  (Close One Eye to Scope, a switch, on; Scope Button, Hold | Toggle), with a
  footnote that says how to scope in the player's terms.
- **Destructive rows** are red words that ask first, in an alert that says what
  will be lost, with Cancel focused.
- In a narrow window the sheet rises from the bottom at full height and scrolls,
  and each segmented choice goes under its name, as wide as the row.

## Checklist for any change

- Could a first-time player understand this screen in two seconds?
- Is anything on it decoration? Remove it.
- Does every number use tabular figures, every title Title Case, every string
  the voice above?
- Is it legible over the brightest and darkest parts of every map?
- Does it still look right at 1280×720, 1512×945 (a MacBook in fullscreen),
  2560×1440, and in a narrow browser window?
- Does it respect reduced motion (the system's and the player's), keyboard use
  and screen readers (web)?
