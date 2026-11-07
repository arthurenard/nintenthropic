/**
 * Grip Prix's items, each with a sound a player learns: what the roulette
 * does, what the box does, what each item sounds like leaving, travelling
 * and arriving. Every sound is layered like a sound designer's: a transient
 * (a click, a thump, a crack), a body (a ring, a roar, a siren) and a tail
 * (an echo, debris, rain), built from the parts in ./kart-synth.ts.
 *
 *   box        a glassy crunch, shards, and a sparkle that rises
 *   roulette   a reel of wooden ticks (the game steers their pitch), a
 *              latch when it stops, and then a chime that is the item's own
 *   nitro      a gas hiss, two sparks, a whump of ignition, a jet's roar
 *   puck       a heavy thunk and a whirring disc; a ping off the barrier
 *   seeker     a launch and a sonar ping, a loop of homing beeps, a lock
 *   slick      a gloopy splat, bubbles, and (when it catches someone) a skid
 *   decoy      the box that wasn't: a pop and a cheeky wink
 *   comet      a rising shimmering bed with sparkle, six seconds, winding down
 *   storm      a crack, a rolling thunder, a patter of rain
 *   skyrocket  a fizz and a launch, a whistle across the sky, a siren for
 *              the target and a burst of falling stars
 *   blast      a deep boom and a shock wave that goes out and comes back
 *
 * Pitched parts sit in C major, as the rest of Grip Prix's sounds do.
 */
import { midiHz, smooth } from "../dsp/curves";
import { highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, click, white } from "../dsp/sources";
import type { Recipe, Take } from "../dsp/take";
import { bubble, thump } from "./kit";
import { ar, drive, expo, glide, swoosh, tone } from "./kart-kit";
import {
  BELL, CHIME, GLASS, GLITTER, KALIMBA, MARIMBA, PIP, STAB, TWANG,
  air, breath, crackle, knock, note, puff, rain, shower, siren, sweep, taps, unison, wander,
} from "./kart-synth";

// --- the box and the roulette ---------------------------------------------------------------------------

/**
 * An item box bursting: a bright crack, a crunch of glass and plastic (a
 * handful of tiny noise bursts), a scatter of shards, and a two-bell
 * sparkle that rises through the debris.
 */
export function boxSmash(t: Take): Mono {
  const out = t.canvas(0.95);
  const crack = bandNoise(t.n(0.05), t.sr, t.rng, 2200, 12000, 2);
  expo(crack, t.sr, 0.007, 0.0003);
  t.put(out, crack, 0, 1);
  t.put(out, thump(t, 0.12, 280, 100, 0.001, 0.026), 0, 0.5);
  // The crunch: eight micro-bursts of mid noise, each its own little break.
  for (let k = 0; k < 8; k++) {
    const b = bandNoise(t.n(0.02), t.sr, t.rng, t.rng.range(900, 2500), t.rng.range(4000, 8000), 2);
    expo(b, t.sr, t.rng.range(0.003, 0.007), 0.0003);
    t.put(out, b, 0.004 + k * 0.011 + t.rng.range(0, 0.008), t.rng.range(0.3, 0.55));
  }
  shower(out, t, 0.005, 0.2, 16, 2600, 10500, 0.26, [0.012, 0.055], 1.8);
  // The sparkle, rising: bell, glass, glass, and an airy shing over them.
  note(out, t, BELL, 0.05, 88, 0.2, 0.8, 0.5);
  note(out, t, GLASS, 0.1, 91, 0.2, 0.9, 0.6);
  note(out, t, GLASS, 0.16, 96, 0.3, 0.9, 0.55);
  t.put(out, air(t, 0.5, 3000, 11000, 1.4, puff(0.3, 1.5)), 0.06, 0.1);
  return out;
}

/** A tick of the item reel: a small wooden knock and a hard tine; the caller's playback rate sets the pitch (it climbs as the reel slows). */
export function rouletteTick(t: Take): Mono {
  const out = t.canvas(0.1);
  knock(out, t, 0, 1180, 1, 0.01);
  addMode(out, t.sr, 0, 3150 * t.rng.range(0.995, 1.005), 0.3, 0.008, 1);
  t.put(out, click(t.sr, t.rng, 0.0015, 2200, 9500), 0, 0.25);
  return out;
}

/**
 * The reel stops: the ratchet's pawl dropping into its notch (a hard click
 * and a short low knock), and a bright glint, so there is a satisfying
 * "that's it" before the item's own chime says which.
 */
export function itemLatch(t: Take): Mono {
  const out = t.canvas(0.5);
  t.put(out, click(t.sr, t.rng, 0.003, 1500, 10000), 0, 0.9);
  t.put(out, thump(t, 0.1, 340, 130, 0.001, 0.022), 0, 0.7);
  knock(out, t, 0.002, 760, 0.6, 0.018);
  note(out, t, GLASS, 0.02, 100, 0.2, 0.7, 0.45);
  t.put(out, air(t, 0.3, 5000, 12000, 1.6, puff(0.15, 2)), 0.01, 0.08);
  return out;
}

type Chime = (out: Mono, t: Take) => void;

/** What the roulette lands on, as a motif each item owns: heard a second after the pick-up, on top of the latch. */
const CHIMES: Record<string, Chime> = {
  // Climbing a fifth with a puff of gas behind it.
  nitro: (out, t) => {
    [72, 79, 84].forEach((m, k) => note(out, t, CHIME, k * 0.07, m, 0.2, 0.85, 0.75));
    t.put(out, air(t, 0.35, 1200, 6000, 1.2, puff(0.1, 1.6)), 0.02, 0.35);
  },
  // Three quick pips and the high one above them: three charges.
  nitro3: (out, t) => {
    [84, 84, 84].forEach((m, k) => note(out, t, KALIMBA, k * 0.07, m, 0.1, 0.8, 0.7));
    note(out, t, CHIME, 0.23, 91, 0.3, 0.9, 0.8);
    t.put(out, air(t, 0.35, 1200, 6000, 1.2, puff(0.1, 1.6)), 0.2, 0.25);
  },
  // Two wooden taps: a puck on a table.
  puck: (out, t) => {
    knock(out, t, 0, 640, 0.9, 0.02);
    knock(out, t, 0.09, 860, 0.9, 0.02);
    note(out, t, KALIMBA, 0.09, 79, 0.2, 0.9, 0.7);
    note(out, t, CHIME, 0.17, 84, 0.3, 0.9, 0.7);
  },
  // Three taps climbing.
  puck3: (out, t) => {
    [76, 79, 84].forEach((m, k) => {
      knock(out, t, k * 0.075, 600 + 130 * k, 0.8, 0.018);
      note(out, t, KALIMBA, k * 0.075, m, 0.15, 0.9, 0.75);
    });
    note(out, t, CHIME, 0.2, 88, 0.3, 0.8, 0.5);
  },
  // A sonar ping, and its echo coming back.
  seeker: (out, t) => {
    note(out, t, BELL, 0, 96, 0.3, 0.9, 0.8);
    note(out, t, BELL, 0.17, 96, 0.3, 0.6, 0.42);
    note(out, t, BELL, 0.3, 96, 0.3, 0.4, 0.22);
    t.put(out, sweep(t, 0.15, (u) => 700 * Math.pow(4, u), 0.2), 0, 0.14);
  },
  // Low, wet and wobbly: a bubble and a slide down.
  slick: (out, t) => {
    t.put(out, bubble(t, 330, 0.03, 2.2), 0, 0.8);
    t.put(out, bubble(t, 480, 0.025, 2.0), 0.08, 0.6);
    note(out, t, MARIMBA, 0.04, 67, 0.2, 0.9, 0.8);
    note(out, t, MARIMBA, 0.15, 64, 0.3, 0.8, 0.7);
    t.put(out, sweep(t, 0.3, (u) => 900 * Math.pow(0.45, u), 0.2, 0, 7, 0.04), 0.04, 0.2);
  },
  // A run of sparkle to the top of the keyboard.
  comet: (out, t) => {
    [84, 88, 91, 96, 100, 103, 108].forEach((m, k) => note(out, t, BELL, k * 0.045, m, 0.15, 0.75, 0.4 + 0.05 * k));
    note(out, t, CHIME, 0.3, 96, 0.5, 0.9, 0.6);
    shower(out, t, 0.05, 0.4, 14, 5000, 12000, 0.14, [0.01, 0.04], 1);
  },
  // Dark: a bell and a tritone against it, a low tick of thunder under.
  storm: (out, t) => {
    note(out, t, BELL, 0, 84, 0.3, 0.9, 0.7);
    note(out, t, BELL, 0.015, 90, 0.3, 0.9, 0.6);
    t.put(out, thump(t, 0.35, 110, 40, 0.004, 0.09), 0, 0.8);
    t.put(out, crackle(t, 0.2, 3500, 0.06, 6), 0.02, 0.3);
  },
  // A whistle going up and a pop with a shower of stars at the top.
  skyrocket: (out, t) => {
    t.put(out, sweep(t, 0.3, (u) => 600 * Math.pow(4.4, Math.pow(u, 0.8)), 0.1, 0), 0, 0.3);
    note(out, t, BELL, 0.28, 96, 0.2, 0.9, 0.6);
    shower(out, t, 0.29, 0.3, 10, 4000, 10000, 0.16, [0.015, 0.05], 1.3);
    note(out, t, GLASS, 0.34, 103, 0.3, 0.8, 0.5);
  },
  // Weight: a low thump and a wide, open power chord of bells.
  blast: (out, t) => {
    t.put(out, thump(t, 0.35, 150, 38, 0.003, 0.08), 0, 1);
    [60, 67, 72].forEach((m, k) => note(out, t, CHIME, 0.02 + k * 0.03, m, 0.4, 0.9, 0.5));
    note(out, t, BELL, 0.1, 91, 0.3, 0.7, 0.35);
  },
  // Almost the right chime, with a wink: it lands a hair flat, and a tiny slide whistle slips out of it.
  decoy: (out, t) => {
    note(out, t, GLASS, 0, 84, 0.2, 0.85, 0.65);
    t.put(out, sweep(t, 0.09, (u) => 900 * Math.pow(2.2, u), 0.15), 0.12, 0.2);
    note(out, t, GLASS, 0.14, 83.6, 0.3, 0.8, 0.6);
  },
};

/** The chime an item's roulette lands on: `kart_get_<item>`. */
export function itemGet(item: keyof typeof CHIMES): Recipe {
  return (t) => {
    const out = t.canvas(0.8);
    CHIMES[item]!(out, t);
    breath(out, t, 0.015);
    return lowpass(out, t.sr, 9500, 1);
  };
}

/** The items with a chime of their own, in the order the game names them. */
export const ITEM_CHIMES = Object.keys(CHIMES);

// --- nitro ---------------------------------------------------------------------------------------------------

/**
 * Using a nitro: a hiss of gas, two sparks of the igniter, a whump as it
 * catches, and a jet's roar (turbulent air climbing through a resonance, a
 * turbine's whine under it, a thump of sub). ``triple`` is the triple
 * nitro's: a ratchet of three clicks before it, a shorter and higher roar.
 */
function nitro(t: Take, triple: boolean): Mono {
  const out = t.canvas(1.15);
  const lead = triple ? 0.14 : 0;
  if (triple) for (let k = 0; k < 3; k++) knock(out, t, k * 0.04, 1500 + 280 * k, 0.55, 0.008);
  const hiss = highpass(white(t.n(0.2), t.rng), t.sr, 3200, 2);
  expo(hiss, t.sr, 0.05, 0.003);
  t.put(out, hiss, lead, 0.5);
  // Two sparks of the igniter.
  t.put(out, click(t.sr, t.rng, 0.0015, 3000, 12000), lead + 0.045, 0.9);
  t.put(out, click(t.sr, t.rng, 0.0015, 3000, 12000), lead + 0.075, 0.7);
  // The whump of ignition: a falling thump, a burst of low roar, and a shock of mid noise.
  const at = lead + 0.1;
  t.put(out, thump(t, 0.3, 150, 42, 0.002, 0.075), at, 1);
  const whump = bandNoise(t.n(0.2), t.sr, t.rng, 90, 1100, 2);
  expo(whump, t.sr, 0.05, 0.002);
  t.put(out, whump, at, 0.7);
  // The jet: turbulent air through a rising resonance, flickering, with a turbine whine.
  const top = triple ? 4200 : 3300;
  const roar = air(t, 0.85, 320, top, 2.4, puff(0.08, 1.15), 90, 0.8);
  drive(roar, 1.6);
  t.put(out, roar, at, 0.9);
  const whine = sweep(t, 0.8, (u) => (triple ? 520 : 400) * Math.pow(3.4, Math.pow(u, 0.7)), 0.3, 0.2, 31, 0.012);
  ar(whine, t.sr, 0.05, 0.3);
  t.put(out, whine, at + 0.03, 0.1);
  const sub = sweep(t, 0.6, (u) => 62 * (1 + 0.6 * u), 0.2);
  ar(sub, t.sr, 0.02, 0.3);
  t.put(out, sub, at, 0.45);
  return out;
}

export const nitroUse: Recipe = (t) => nitro(t, false);
export const nitroTriple: Recipe = (t) => nitro(t, true);

// --- puck and seeker --------------------------------------------------------------------------------------------

/**
 * A puck fired: a solid thunk (a falling sine and a wood-and-rubber knock),
 * the snap of a spring, and the whirr of a disc spinning off, thinning away.
 */
export function puckFire(t: Take): Mono {
  const out = t.canvas(0.55);
  t.put(out, thump(t, 0.16, 210, 58, 0.001, 0.04), 0, 1);
  knock(out, t, 0, 690, 0.8, 0.02);
  t.put(out, click(t.sr, t.rng, 0.003, 900, 7000), 0, 0.5);
  const snap = glide(t, 0.09, 1100, 320, 0.7, 0.3);
  expo(snap, t.sr, 0.03, 0.001);
  t.put(out, snap, 0.004, 0.4);
  // The whirr: noise on a falling band, its level chopped by the disc's spin, slower as it goes.
  const n = t.n(0.42);
  const whirr = bandNoise(n, t.sr, t.rng, 900, 3800, 2);
  svf(whirr, t.sr, "bp", (u) => 2600 * Math.pow(0.4, u), 2.2);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    whirr[i]! *= 0.55 + 0.45 * Math.sin(2 * Math.PI * (95 - 40 * u) * u * 0.42);
  }
  shapeBy(whirr, puff(0.06, 1.3));
  t.put(out, whirr, 0.01, 0.65);
  return out;
}

/**
 * A puck off a barrier: the barrier's wooden knock, a little rubber, and a
 * clear metallic ping (a struck bar) that tells you which way it went;
 * the ping's height changes with the take.
 */
export function puckBounce(t: Take): Mono {
  const out = t.canvas(0.45);
  knock(out, t, 0, t.rng.range(520, 640), 1, 0.014);
  t.put(out, thump(t, 0.08, 260, 110, 0.001, 0.018), 0, 0.6);
  const base = t.rng.range(1500, 1800);
  [1, 2.76, 5.4].forEach((ratio, k) => addMode(out, t.sr, 0.002, base * ratio, 0.55 / (1 + k * 1.2), 0.12 / (1 + k), t.rng.range(0, 6.28)));
  note(out, t, BELL, 0.01, [88, 91, 93][Math.floor(t.rng.next() * 3)]!, 0.1, 0.8, 0.28);
  return out;
}

/** A seeker leaving: the puck's thunk, lighter, and a sonar ping and a rising chirp as it arms and picks its target. */
export function seekerLaunch(t: Take): Mono {
  const out = t.canvas(0.7);
  t.put(out, thump(t, 0.13, 250, 80, 0.001, 0.03), 0, 0.9);
  knock(out, t, 0, 820, 0.7, 0.014);
  t.put(out, air(t, 0.4, 1200, 5200, 1.6, puff(0.15, 1.4), 70), 0.01, 0.5);
  note(out, t, BELL, 0.1, 91, 0.2, 0.9, 0.5);
  note(out, t, BELL, 0.24, 96, 0.2, 0.9, 0.45);
  const chirp = sweep(t, 0.16, (u) => 900 * Math.pow(2.6, u), 0.2);
  ar(chirp, t.sr, 0.004, 0.06);
  t.put(out, chirp, 0.3, 0.22);
  return lowpass(out, t.sr, 8500, 1);
}

/**
 * The homing seeker, a loop: a sonar beep (two notes, a fourth apart, each
 * an FM bell with a clean sine at its heart) five times a second, a sliver
 * of echo after each, and a faint turbine hum between. The game bends its
 * pitch with the closing speed, which quickens the beeps as it nears.
 */
export function seekerBeeps(t: Take): Mono {
  const seconds = 0.8;
  const n = t.n(seconds);
  const out = new Float32Array(n);
  const wrap = (buf: Mono, at: number, gain: number): void => {
    const start = Math.round(at * t.sr);
    for (let i = 0; i < buf.length; i++) out[(start + i) % n]! += gain * buf[i]!;
  };
  for (let k = 0; k < 4; k++) {
    // Each beep a hair different in pitch and level, so the loop is a machine at work and not a test tone.
    const f = midiHz(k % 2 === 0 ? 93 : 98) * t.rng.range(0.997, 1.003);
    const len = t.n(0.11);
    const beep = tone(len, t.sr, new Float32Array(len).fill(f), 0.12, 0);
    shapeBy(beep, (u) => smooth(u / 0.04) * Math.pow(Math.max(0, 1 - u), 1.4));
    const at = (k * seconds) / 4 + t.rng.range(0, 0.002);
    const level = t.rng.range(0.88, 1);
    wrap(beep, at, 0.8 * level);
    wrap(beep, at + 0.075, 0.2 * level);
    wrap(beep, at + 0.15, 0.07 * level);
  }
  // A faint hum between the beeps: a turbine two octaves below, in whole cycles of the loop.
  const hum = 3 * 105;
  for (let i = 0; i < n; i++) out[i]! += 0.05 * Math.sin((2 * Math.PI * hum * i) / (seconds * t.sr)) * (0.7 + 0.3 * Math.sin((2 * Math.PI * 4 * i) / n));
  return out;
}

/** A lock: three beeps rising, close together, and a glint, the sound of "got you" at the moment it lands (kept low enough to be firm, not shrill). */
export function seekerLock(t: Take): Mono {
  const out = t.canvas(0.4);
  [79, 83, 88].forEach((m, k) => {
    const beep = tone(t.n(0.06), t.sr, new Float32Array(t.n(0.06)).fill(midiHz(m) * t.rng.range(0.996, 1.004)), 0.15, 0);
    shapeBy(beep, (u) => smooth(u / 0.08) * Math.pow(Math.max(0, 1 - u), 1.2));
    t.put(out, beep, k * 0.05, 0.6);
  });
  note(out, t, BELL, 0.15, 96, 0.2, 0.9, 0.5);
  breath(out, t, 0.015);
  return lowpass(out, t.sr, 9000, 1);
}

/**
 * Three pucks circling a kart, a loop: a low hum of discs on their track,
 * a doppler wobble as each comes round (three times a turn, the turn a
 * second), a soft ping every time one passes the front and a whisper of
 * air. Every partial is a whole number of cycles in the loop, so it is
 * seamless; the game raises it a little as pucks are fired.
 */
export function orbitHum(t: Take): Mono {
  const seconds = 1.2;
  const n = t.n(seconds);
  const out = new Float32Array(n);
  const turns = 1;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    // Three discs round a circle: each one's level and pitch swing once a turn, a third of a turn apart.
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const a = 2 * Math.PI * (turns * u + k / 3);
      const level = 0.65 + 0.35 * Math.cos(a);
      v += level * Math.sin(2 * Math.PI * 156 * u + 1.1 * Math.sin(a) + k * 2.1);
    }
    out[i] = v / 3;
  }
  // 156 cycles in 1.2 s is a hum of 130 Hz (a C3), the discs' body; a fifth above it, 195 Hz, rides on it (whole cycles both).
  const body = Float32Array.from(out);
  for (let i = 0; i < n; i++) out[i]! += 0.35 * Math.sin((2 * Math.PI * 234 * i) / n + 0.5 * body[i]!) * (0.6 + 0.4 * Math.cos((2 * Math.PI * 3 * i) / n));
  // The pings, one for each puck passing the front, with the tail wrapping round the seam.
  for (let k = 0; k < 3; k++) {
    const at = (k * seconds) / 3 + t.rng.range(0, 0.004);
    const ring = t.canvas(0.25);
    addMode(ring, t.sr, 0, midiHz(88), 0.5, 0.05, 0);
    addMode(ring, t.sr, 0, midiHz(88) * 2.76, 0.18, 0.025, 1);
    const start = Math.round(at * t.sr);
    for (let i = 0; i < ring.length; i++) out[(start + i) % n]! += 0.4 * ring[i]!;
  }
  // The air: whole-cycle, slowly breathing.
  const hush = bandNoise(n, t.sr, t.rng, 1500, 4500, 2);
  for (let i = 0; i < n; i++) out[i]! += 0.03 * hush[i]! * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / n));
  return out;
}

// --- slick -------------------------------------------------------------------------------------------------------

/**
 * An oil slick dropped: a wet splat (noise on a closing low-pass), a
 * resonant "bleh" where a vowel's band opens and shuts, a soft thump, and
 * five bubbles gloopily popping, the last ones smaller.
 */
export function slickSplat(t: Take): Mono {
  const out = t.canvas(0.8);
  const splat = bandNoise(t.n(0.3), t.sr, t.rng, 250, 2800, 2);
  svf(splat, t.sr, "lp", (u) => 3400 * Math.pow(0.1, u), 1.2);
  expo(splat, t.sr, 0.06, 0.003);
  t.put(out, splat, 0, 0.9);
  // The squelch: noise through a narrow band that opens and closes, "bl-eh".
  const squelch = white(t.n(0.3), t.rng);
  svf(squelch, t.sr, "bp", (u) => 380 + 520 * Math.sin(Math.PI * Math.min(1, u * 1.3)), 6);
  shapeBy(squelch, puff(0.1, 1.3));
  t.put(out, squelch, 0.01, 0.8);
  t.put(out, thump(t, 0.15, 180, 70, 0.002, 0.04), 0, 0.7);
  for (let k = 0; k < 6; k++) {
    t.put(out, bubble(t, t.rng.range(240, 820) * (1 - 0.04 * k), t.rng.range(0.014, 0.034), t.rng.range(1.5, 2.4)), 0.06 + k * 0.06 + t.rng.range(0, 0.04), t.rng.range(0.3, 0.7) * (1 - 0.08 * k));
  }
  return out;
}

/**
 * Hitting an oil slick: tyres losing their grip, a squeal that wobbles
 * and slides as it wets out, and a rubbery squelch with it. It goes under
 * the spin-out's own whirl.
 */
export function slickSkid(t: Take): Mono {
  const out = t.canvas(0.75);
  const squeal = sweep(t, 0.6, (u) => 2100 * Math.pow(0.42, u), 0.4, 0.2, 9, 0.05);
  shapeBy(squeal, (u) => smooth(u / 0.06) * smooth((1 - u) / 0.35));
  t.put(out, squeal, 0, 0.45);
  const rubber = bandNoise(t.n(0.6), t.sr, t.rng, 1500, 6500, 2);
  const slip = rubber.length;
  for (let i = 0; i < slip; i++) rubber[i]! *= 0.5 + 0.5 * Math.sin((2 * Math.PI * 14 * i) / t.sr);
  shapeBy(rubber, puff(0.08, 1.2));
  t.put(out, rubber, 0, 0.4);
  const squelch = white(t.n(0.4), t.rng);
  svf(squelch, t.sr, "bp", (u) => 900 * Math.pow(0.4, u), 5);
  shapeBy(squelch, puff(0.1, 1.5));
  t.put(out, squelch, 0.04, 0.6);
  return out;
}

// --- decoy ------------------------------------------------------------------------------------------------------------

/** A decoy set down: a soft "pok" of a box on tarmac, and a sly little shimmer. */
export function decoyDrop(t: Take): Mono {
  const out = t.canvas(0.5);
  t.put(out, thump(t, 0.1, 230, 95, 0.001, 0.02), 0, 0.9);
  knock(out, t, 0, 780, 0.7, 0.012);
  note(out, t, GLASS, 0.05, 96, 0.1, 0.6, 0.3);
  note(out, t, GLASS, 0.11, 100, 0.1, 0.5, 0.2);
  return out;
}

/**
 * An item box that was not one: the box smash, but cut short and a bit
 * cheap, then a cork's pop, and a cheeky wink: "bip-boop" down a third and a
 * slide whistle sliding off, as if the box were laughing.
 */
export function decoyPop(t: Take): Mono {
  const out = t.canvas(1.15);
  const crack = bandNoise(t.n(0.05), t.sr, t.rng, 2200, 10000, 2);
  expo(crack, t.sr, 0.008, 0.0003);
  t.put(out, crack, 0, 0.8);
  t.put(out, thump(t, 0.13, 250, 90, 0.001, 0.03), 0, 0.6);
  shower(out, t, 0.005, 0.12, 8, 2600, 9000, 0.2, [0.01, 0.04], 1.6);
  // The cork: a pitch that leaps up in a hundredth of a second.
  const pop = sweep(t, 0.05, (u) => 260 * Math.pow(4.6, Math.pow(u, 0.6)), 0.3);
  expo(pop, t.sr, 0.014, 0.001);
  t.put(out, pop, 0.09, 0.7);
  // The wink: bip, boop, a third down, in marimba.
  note(out, t, MARIMBA, 0.2, 84, 0.1, 0.9, 0.9);
  note(out, t, MARIMBA, 0.31, 79.2, 0.12, 0.95, 0.9);
  // And a slide whistle slipping off with a wobble.
  const slide = sweep(t, 0.5, (u) => 1500 * Math.pow(0.3, u), 0.1, 0, 7, 0.03);
  shapeBy(slide, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.4));
  t.put(out, slide, 0.45, 0.22);
  return lowpass(out, t.sr, 12000, 1);
}

// --- comet --------------------------------------------------------------------------------------------------------------

/**
 * A Comet, six seconds of invincibility. A run of bells up the scale and a
 * rush of air light it; then a bed of five detuned saws on C and a second of
 * G, through a filter that sweeps up every 1.5 seconds so the whole thing
 * keeps rising without going anywhere; an arpeggio of kalimba tines over it
 * and glitter; the last second and a half it blinks (the arpeggio doubles
 * its pace, the bed sinks) and two bells close it.
 */
export function cometRide(t: Take): Mono {
  const seconds = 6.1;
  const n = t.n(seconds);
  const out = t.canvas(seconds);
  // The lighting.
  [72, 76, 79, 84, 88, 91, 96].forEach((m, k) => note(out, t, BELL, k * 0.038, m, 0.15, 0.8, 0.55));
  t.put(out, air(t, 0.7, 400, 7500, 1.2, puff(0.06, 1.4), 120), 0, 0.8);
  t.put(out, thump(t, 0.3, 130, 50, 0.003, 0.06), 0, 0.5);
  // The bed: two stacks, swelling in and winding down; each sweeps up through its filter every 1.5 s.
  const body = (u: number): number => {
    const s = u * seconds;
    const wind = s > seconds - 1.5 ? 1 - 0.55 * smooth((s - (seconds - 1.5)) / 1.5) : 1;
    return smooth(s / 0.5) * smooth((seconds - 0.5 - s) / 0.7) * wind;
  };
  const tracks = [{ midi: 48, cents: [-16, -7, 0, 7, 16], gain: 0.5, cut: 3200 }, { midi: 67, cents: [-12, 0, 12], gain: 0.28, cut: 4800 }];
  for (const v of tracks) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const down = u * seconds > seconds - 1.5 ? 1 - 0.25 * smooth((u * seconds - (seconds - 1.5)) / 1.5) : 1;
      f[i] = midiHz(v.midi) * t.p * down * (1 + 0.003 * Math.sin((2 * Math.PI * 5.5 * i) / t.sr));
    }
    const pad = unison(t, seconds, f, v.cents, 9000);
    svf(pad, t.sr, "lp", (u) => 320 + v.cut * Math.pow(((u * seconds) % 1.5) / 1.5, 1.7), 1.6);
    shapeBy(pad, body);
    t.put(out, pad, 0, v.gain);
  }
  // An airy shimmer: high noise whose level swims.
  const hiss = highpass(white(n, t.rng), t.sr, 7000, 2);
  shapeBy(hiss, (u) => body(u) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 6 * u * seconds)));
  t.put(out, hiss, 0, 0.05);
  // The arpeggio: up through the pentatonic; in the last second and a half it runs twice as fast, falling.
  const cycle = [72, 76, 79, 84, 79, 76, 84, 88];
  let at = 0.55;
  let idx = 0;
  while (at < seconds - 0.7) {
    const blinking = at > seconds - 1.6;
    const m = blinking ? cycle[cycle.length - 1 - (idx % cycle.length)]! : cycle[idx % cycle.length]!;
    note(out, t, KALIMBA, at, m + (Math.floor(idx / cycle.length) % 2 === 0 ? 12 : 12), 0.08, 0.55 + 0.25 * (idx % 4 === 0 ? 1 : 0), blinking ? 0.34 : 0.28);
    at += blinking ? 0.05 : 0.1;
    idx++;
  }
  // Glitter, thinning.
  for (let g = 0.7; g < seconds - 0.7; ) {
    const thin = g < seconds - 1.8 ? 1 : 0.4;
    note(out, t, BELL, g, GLITTER[Math.floor(t.rng.next() * GLITTER.length)]!, 0.1, t.rng.range(0.4, 0.8), 0.22 * thin);
    g += t.rng.range(0.12, 0.4) / thin;
  }
  // Closing: the bed sinks, two bells.
  note(out, t, CHIME, seconds - 0.75, 84, 0.4, 0.9, 0.5);
  note(out, t, CHIME, seconds - 0.58, 79, 0.5, 0.8, 0.45);
  return out;
}

// --- storm -----------------------------------------------------------------------------------------------------------------

/**
 * A bolt on a kart: a bright crack and a buzz of electricity (a saw at mains
 * pitch, chopped), the zap falling away, thunder rolling after it with its
 * echoes off the hills, a patter of rain that swells and passes, and a
 * crackle of the last sparks.
 */
export function stormStrike(t: Take): Mono {
  const out = t.canvas(2.7);
  const crack = bandNoise(t.n(0.1), t.sr, t.rng, 1800, 15000, 2);
  expo(crack, t.sr, 0.016, 0.0004);
  t.put(out, crack, 0, 1);
  t.put(out, click(t.sr, t.rng, 0.004, 2000, 14000), 0, 0.8);
  // The buzz: a 120 Hz-ish saw through a bright band, gated hard in time with itself.
  const buzzLen = t.n(0.22);
  const buzz = bandNoise(buzzLen, t.sr, t.rng, 1500, 9000, 2);
  for (let i = 0; i < buzzLen; i++) buzz[i]! *= Math.sin((2 * Math.PI * 118 * i) / t.sr) > -0.2 ? 1 : 0.15;
  shapeBy(buzz, puff(0.02, 2.2));
  t.put(out, buzz, 0, 0.5);
  const zap = glide(t, 0.24, 5600 * t.p, 240, 0.5, 0.5, 0.3);
  drive(zap, 3);
  ar(zap, t.sr, 0.001, 0.12);
  t.put(out, zap, 0, 0.36);
  t.put(out, crackle(t, 0.5, 3000, 0.1, 5), 0.02, 0.45);
  // Thunder: a roll of low noise, its swells like a wind-up, and the same rumble thrown back off the hills.
  const rumble = lowpass(bandNoise(t.n(2.1), t.sr, t.rng, 36, 520, 2), t.sr, 400 * t.cutoff, 2);
  const m = rumble.length;
  // The roll: swells at irregular intervals (a random walk, smoothed), never a steady throb.
  const roll = wander(m, t.rng, 0.25, 1, 4.5, t.sr);
  for (let i = 0; i < m; i++) rumble[i]! *= roll[i]!;
  shapeBy(rumble, (u) => smooth(u / 0.05) * Math.pow(Math.max(0, 1 - u), 1.6));
  t.put(out, rumble, 0.07, 1.1);
  t.put(out, thump(t, 0.8, 90, 33, 0.01, 0.2), 0.09, 0.8);
  taps(out, t, rumble, [0.45, 0.85], [0.3, 0.16], 700);
  // Rain: swells in after the bolt, passes.
  const drops = rain(t, 1.8, 480);
  shapeBy(drops, (u) => smooth(u / 0.3) * smooth((1 - u) / 0.45));
  t.put(out, drops, 0.5, 0.45);
  return lowpass(out, t.sr, 14000, 1);
}

// --- skyrocket ---------------------------------------------------------------------------------------------------------------

/**
 * A skyrocket leaving: a crackle of fuse, a pop out of the tube, a roar of
 * gas, and a whistle climbing away across the sky from the left of the
 * picture to the right. Stereo: the sweep is the sound.
 */
export function skyrocketLaunch(t: Take): Mono[] {
  const seconds = 1.7;
  const out = t.canvas(seconds);
  t.put(out, crackle(t, 0.3, 3500, 0.12, 4), 0, 0.5);
  t.put(out, thump(t, 0.28, 170, 52, 0.002, 0.07), 0.12, 1);
  t.put(out, click(t.sr, t.rng, 0.003, 1200, 8000), 0.12, 0.5);
  t.put(out, air(t, 1.35, 380, 3600, 1.0, puff(0.06, 1.1), 110, 0.9), 0.13, 0.8);
  const left = Float32Array.from(out);
  const right = Float32Array.from(out);
  // The whistle, with a slow doppler wobble, and its pan.
  const w = sweep(t, 1.4, (u) => 640 * t.p * Math.pow(5, Math.pow(u, 0.85)), 0.25, 0.08, 6, 0.012);
  shapeBy(w, (u) => smooth(u / 0.08) * Math.pow(Math.max(0, 1 - u), 1.1));
  const start = t.n(0.12);
  for (let i = 0; i < w.length && start + i < left.length; i++) {
    const u = i / w.length;
    const a = smooth(u * 1.1);
    left[start + i]! += 0.34 * w[i]! * Math.sqrt(1 - a);
    right[start + i]! += 0.34 * w[i]! * Math.sqrt(a);
  }
  note(left, t, BELL, 0.15, 96, 0.2, 0.7, 0.2);
  note(right, t, BELL, 0.15, 96, 0.2, 0.7, 0.2);
  return [left, right];
}

/**
 * The target's warning: an air-raid siren, high-low-high-low, tremulous,
 * with an insistent pulse under it. It is the sound that says look up.
 */
export function skyrocketWarn(t: Take): Mono {
  const out = t.canvas(1.3);
  t.put(out, siren(t, 1.2, 760 * t.p, 1240 * t.p, 3, 0.4), 0, 0.8);
  // A pulse a beat under the siren: a heartbeat of dread, four of them.
  for (let k = 0; k < 5; k++) t.put(out, thump(t, 0.12, 190, 90, 0.002, 0.03), 0.02 + k * 0.24, 0.5);
  breath(out, t, 0.02);
  return out;
}

/**
 * The burst: a deep boom, a crack of light, a round body of noise, then
 * glittering stars falling out of the sky (bells and a shower of sparks),
 * and the last crackle of embers.
 */
export function skyrocketBurst(t: Take): Mono {
  const out = t.canvas(2.4);
  t.put(out, thump(t, 0.75, 155, 33, 0.002, 0.16), 0, 1);
  const crack = bandNoise(t.n(0.2), t.sr, t.rng, 600, 10000, 2);
  expo(crack, t.sr, 0.035, 0.001);
  t.put(out, crack, 0, 0.85);
  const body = lowpass(bandNoise(t.n(1.2), t.sr, t.rng, 80, 950, 2), t.sr, 720, 2);
  expo(body, t.sr, 0.28, 0.004);
  t.put(out, body, 0, 0.85);
  // The stars: a sparkle that falls in pitch as it spreads, in the pentatonic, with a long shimmer of bells.
  for (let k = 0; k < 12; k++) note(out, t, k % 3 === 0 ? BELL : GLASS, 0.06 + k * 0.065 + t.rng.range(0, 0.03), GLITTER[GLITTER.length - 1 - (k % GLITTER.length)]!, 0.1, t.rng.range(0.6, 0.95), 0.34);
  shower(out, t, 0.04, 1.4, 34, 2400, 9500, 0.22, [0.02, 0.1], 1.5);
  t.put(out, crackle(t, 0.9, 4500, 0.1, 3.5), 0.4, 0.4);
  return lowpass(out, t.sr, 14000, 1);
}

// --- blast ------------------------------------------------------------------------------------------------------------------------

/**
 * A ring of force: a deep boom (sub and thump), a punch of mid, a shock
 * wave of air that races outward, a "wub" of pressure, and the ring coming
 * back off the walls, twice, darker.
 */
export function blastBoom(t: Take): Mono {
  const out = t.canvas(1.5);
  t.put(out, thump(t, 0.7, 110, 27, 0.003, 0.17), 0, 1.15);
  t.put(out, thump(t, 0.2, 280, 85, 0.001, 0.035), 0, 0.55);
  const punch = bandNoise(t.n(0.12), t.sr, t.rng, 200, 4000, 2);
  expo(punch, t.sr, 0.02, 0.0005);
  t.put(out, punch, 0, 0.7);
  // The shock: a band of air that sweeps up and out, then thins.
  const shock = air(t, 0.75, 220, 6500, 1.0, swoosh(0.04, 2.0), 0, 0.9);
  t.put(out, shock, 0.005, 0.85);
  // The wub: a pressure wave, low, bending down.
  const wub = sweep(t, 0.9, (u) => 62 * (1 - 0.35 * u), 0.3, 0.1);
  shapeBy(wub, (u) => smooth(u / 0.03) * Math.pow(Math.max(0, 1 - u), 1.5));
  t.put(out, wub, 0, 0.5);
  // The ring coming back off the walls.
  taps(out, t, shock, [0.2, 0.38], [0.35, 0.18], 2400);
  note(out, t, GLASS, 0.13, 88, 0.1, 0.7, 0.2);
  note(out, t, GLASS, 0.24, 81, 0.1, 0.6, 0.16);
  return out;
}
