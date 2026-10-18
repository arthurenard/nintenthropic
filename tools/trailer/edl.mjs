/**
 * The trailer's cut, on the 120 BPM grid (a beat is 0.5 s, a bar 2 s; see README.md).
 * A cut either enters its source at `in` seconds, or `align`s one of the clip's
 * moments (shooters.json / race.json) to `at` seconds after the cut, so a hit
 * lands on a beat. Titles are the cards' alpha overlays; flashes are white,
 * falling off over `frames`; punches are a short zoom on the drops.
 */
export const FPS = 60;
export const TOTAL = 40;

export const CUTS = [
  // Bars 1-2: the words, the sight locking on, white.
  { at: 0, dur: 4, card: "hook" },
  // Bars 3-10: Finger Guns.
  { at: 4, dur: 2, clip: "hn-hero", align: { moment: 1, at: 1.0 } }, // the dynamite fireball on 5.0
  { at: 6, dur: 2, clip: "hn-2", align: { moment: 0, at: 0.5 } }, // fireballs on 6.5 and 7.25
  { at: 8, dur: 2, clip: "dn-1", in: 0.78 }, // the beam lands, headshots from 8.5
  { at: 10, dur: 2, clip: "dn-2", align: { moment: 3, at: 1.5 } }, // the bloater bursts on 11.5
  { at: 12, dur: 2, clip: "od-1", align: { moment: 1, at: 0.5 } }, // the laser on 12.5
  { at: 14, dur: 2, clip: "od-2", align: { moment: 3, at: 1.5 } }, // the slab cracks the glass on 15.5
  { at: 16, dur: 2, clip: "or-1", in: 0 }, // the scope rises, the pan, the shot
  { at: 18, dur: 2, clip: "or-slow", align: { moment: 1, at: 1.5 } }, // the headshot, slowed, on 19.5
  // Bar 11: the sight becomes a wheel.
  { at: 20, dur: 2, card: "turn" },
  // Bars 12-17: Grip Prix.
  { at: 22, dur: 2, clip: "gp-go", align: { moment: 2, at: 0.03 } }, // GO on 22.0, out of the white
  { at: 24, dur: 2, clip: "gp-drift", align: { moment: 2, at: 1.5 } }, // the drift lets go in flames on 25.5
  { at: 26, dur: 2, clip: "gp-four", in: 0 }, // four players, one camera
  { at: 28, dur: 2, clip: "gp-jump", align: { moment: 0, at: 0.25 } }, // the whole pack in the air
  { at: 30, dur: 2, clip: "gp-cine", align: { moment: 0, at: 1.5 } }, // the volcano erupts beside the pack on 31.5
  { at: 32, dur: 0.5, clip: "gp-night", align: { moment: 0, at: 0.2 } }, // half-bar cuts into the end
  { at: 32.5, dur: 0.5, clip: "gp-item", align: { moment: 1, at: 0.25 } },
  { at: 33, dur: 1, clip: "gp-finish", align: { moment: 0, at: 0.5 } },
  // Bars 18-20: the mark.
  { at: 34, dur: 6, card: "end" },
];

export const TITLES = [
  { at: 4.25, card: "t-high-noon" },
  { at: 8, card: "t-dead-of-night" },
  { at: 12, card: "t-orbital-decay" },
  { at: 16, card: "t-overwatch-ridge" },
  { at: 22.25, card: "t-grip-prix" },
  { at: 26, card: "t-four" },
];

export const FLASHES = [
  { at: 4, frames: 14, peak: 1 },
  { at: 8, frames: 8, peak: 0.35 },
  { at: 12, frames: 8, peak: 0.35 },
  { at: 16, frames: 8, peak: 0.35 },
  { at: 22, frames: 14, peak: 1 },
  { at: 26, frames: 8, peak: 0.3 },
  { at: 30, frames: 8, peak: 0.3 },
  { at: 34, frames: 12, peak: 0.8 },
];

export const PUNCHES = [
  { at: 4, amount: 0.05, decay: 0.16 },
  { at: 8, amount: 0.025, decay: 0.12 },
  { at: 12, amount: 0.025, decay: 0.12 },
  { at: 16, amount: 0.025, decay: 0.12 },
  { at: 22, amount: 0.06, decay: 0.18 },
  { at: 26, amount: 0.025, decay: 0.12 },
  { at: 30, amount: 0.025, decay: 0.12 },
];
