# Trailer cards and titles

The trailer's cards and titles, rendered as 1920x1080, 60 fps PNG sequences
(`tools/trailer/out/cards/<id>/00001.png...`, `00001` = t 0) plus
`tools/trailer/out/cards/cards.json` (`id`, `frames`, `alpha`, `what`, `beats`
with exact times, `fps`, `w`, `h`). No hand is drawn anywhere: words and the
app's sight only.

```
node tools/trailer/cards/render.mjs                     all cards
node tools/trailer/cards/render.mjs --only hook,turn    some
node tools/trailer/cards/render.mjs --guides            end card with empty, outlined icon slots, to out/cards-guides/ (a layout check)
node tools/trailer/cards/render.mjs --no-holds          screenshot every frame (see below)
```

`cards.html` + `cards.js` are pure state: `cards.update(t)` sets everything at
t seconds (no CSS animation, no timers). `render.mjs` steps it frame by frame in
headless Chrome (`--mute-audio`), so every run gives the same pixels (checked:
a second render is byte-identical). Titles are shot with a transparent
background (straight alpha); the hook, turn and end cards are opaque black.
Frames inside a hold (nothing moves) are shot once and copied (checked byte for
byte against `--no-holds`).

## What is here

| id | length | alpha | what |
| --- | --- | --- | --- |
| `hook` | 4 s | no | Kinetic type, 136 px 700: "No controller." (0.0), "No keyboard." (1.0), "No mouse." (2.0) in grey-white, each a 7-frame snap in (fade, scale 1.04 to 1) that is first visible on the beat frame, and a 4-frame out that is gone two frames before the next beat; "Just your hands." (3.0) in pure white. At 3.5 the white sight (the mark's reticle, 420 px, measures from `SIGHT` in `tools/icons/mark.mjs`) snaps in and lands from 1.6x (ease-out, no overshoot, to 3.74) with the ticks sliding in; the words fade out by 3.6; the dot, in the sunset gradient, pops in with a soft glow that flares and settles. The frame ramps to white from 3.85; the last frame is pure white (the cut is on white at 4.0). |
| `turn` | 2 s | no | The sight, centre, becomes a three-spoke wheel: the four ticks pull back into the rim (0.0-0.3), spokes grow from the dot to the rim at 3, 6 and 9 o'clock, the dot swells into the hub (the sunset gradient again), the rim thickens, the whole drifts up 80 px (to 0.85). "Now grab the wheel." (72 px 700) rises in at 0.3-0.8. 1.3-1.85: the wheel turns 25 degrees left and back (smooth at both ends, peak at 1.575). The last six frames ramp to white; the last is pure white (the cut at 2.0 is GO). |
| `t-high-noon`, `t-dead-of-night`, `t-orbital-decay`, `t-overwatch-ridge` | 2 s | yes | top right, right aligned, 72 px margins: eyebrow "Finger Guns" (24 px, caps, +0.08em, 78% white), name (92 px, 700, -0.026em). In 0.0-0.4 s (rise and fade), out 1.65 s to the last frame (fade and lift); the last frame is empty. Soft shadow and a faint feathered scrim behind the words. |
| `t-grip-prix` | 2 s | yes | same, eyebrow "Up to 4 Players", name "Grip Prix" |
| `t-four` | 2 s | yes | centred, one line, 80 px 700: "Up to 4 players. One camera." The second sentence follows 0.15 s behind; out from 1.65 s. Stronger shadow and scrim for busy footage. |
| `end` | 6 s | no | Sized to stay readable on a phone (X shows the video ~360 px wide). The app icon (280 px) over a soft sunset glow (0.0-0.6), "Handheld" (160 px, 0.3-0.9), "Games you play with your hands." (68 px, 85% white, 1.0-1.6), a row of two families, [app icon] "Finger Guns" and [kart icon] "Grip Prix" (96 px tiles, 48 px labels, 2.2-2.8), "In your browser. No controller." (44 px, 70% white, 3.0-3.5). The stack glides up 2.1-2.9 s to make room for the row. Fade to pure black 5.3 s to the last frame. |

Type is the system face (`-apple-system`, SF Pro in Chrome on this Mac) with the
tracking from `docs/DESIGN.md`. Easing is a soft cubic-bezier; nothing bounces or wipes.

## The end card's icons

Read from the repo on every render, so a redone icon is picked up by re-rendering
`end`: `public/icons/icon-512.png` (the app slot and the Finger Guns tile) and
`public/assets/kart/icon.png` (Grip Prix, clipped to a 22.5% rounded square with
a hairline). To override one, put `app.png`, `finger-guns.png` or `grip-prix.png`
(or `.svg`/`.webp`/`.jpg`) in `tools/trailer/cards/icons/`. The slots are marked
`SLOT` in `cards.js` and `cards.html`; their final rects are in `cards.json`
(`slots`; the stack is still gliding before 2.9 s).

`tools/icons/mark.mjs` exports `SIGHT` (the sight's measures) for the hook and
turn cards; `markSvg()`'s output is unchanged by it.
