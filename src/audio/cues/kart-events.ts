/**
 * Everything that happens to a Grip Prix kart under power, as one-shots: the
 * sparks of a drift and the mini-turbo that pays for them, boosts and pads,
 * the start, a slipstream's slingshot, the exhaust's pops, a flooded engine.
 * (The items are in ./kart-items.ts; being hit, bumped, dropped and thrown in
 * ./kart-impacts.ts.) Toy-box sounds, layered: a click or a thump for the
 * strike, a body of FM bells, plucked strings and turbulent air, and a tail
 * of embers. Pitched pieces sit in C major so any two that overlap agree.
 */
import { sampled, smooth } from "../dsp/curves";
import { bandpass, highpass, lowpass } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { bandNoise, click, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { thump } from "./kit";
import { ar, expo, swoosh, tone, whoosh } from "./kart-kit";
import { BELL, CHIME, GLASS, KALIMBA, TWANG, air, crackle, note, puff, shower, sweep } from "./kart-synth";

/** A swell that peaks in the middle. */
const swell = (u: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 1.3;

// --- the drift ---------------------------------------------------------------------------------------------

/** The first spark level: a cool blue "tsk-ting", a bell with a fizz of cold sparks behind it. */
export function sparkBlue(t: Take): Mono {
  const out = t.canvas(0.5);
  t.put(out, click(t.sr, t.rng, 0.0015, 4000, 14000), 0, 0.5);
  note(out, t, BELL, 0, 91, 0.1, 0.85, 0.9);
  note(out, t, GLASS, 0.05, 98, 0.1, 0.7, 0.4);
  const fizz = highpass(white(t.n(0.2), t.rng), t.sr, 6500, 2);
  expo(fizz, t.sr, 0.05, 0.002);
  t.put(out, fizz, 0, 0.22);
  return out;
}

/** The second level, hotter and busier: three rising kalimba tines in a run, a crackle and a whisper of flame. */
export function sparkOrange(t: Take): Mono {
  const out = t.canvas(0.65);
  [88, 95, 100].forEach((m, k) => {
    note(out, t, KALIMBA, k * 0.055, m, 0.1, 0.9, 0.8);
    note(out, t, BELL, k * 0.055, m + 12, 0.1, 0.8, 0.28);
  });
  t.put(out, crackle(t, 0.3, 4200, 0.12, 4), 0.02, 0.4);
  const whisper = bandNoise(t.n(0.25), t.sr, t.rng, 900, 5000, 2);
  shapeBy(whisper, puff(0.2, 1.6));
  t.put(out, whisper, 0, 0.12);
  return out;
}

/**
 * The mini-turbo letting go: a stretched string let go (a low twang), a pop
 * of air, a zip up the scale on an FM chirp, a burst of turbulence and a bell
 * on top.
 */
export function miniTurbo(t: Take): Mono {
  const out = t.canvas(0.75);
  note(out, t, TWANG, 0, 40, 0.1, 0.95, 0.6);
  t.put(out, thump(t, 0.16, 200, 60, 0.002, 0.045), 0, 0.9);
  t.put(out, air(t, 0.55, 600, 5800, 1.3, swoosh(0.04, 1.7), 100), 0.005, 0.9);
  const zip = sweep(t, 0.2, (u) => 420 * Math.pow(4.6, Math.pow(u, 0.8)), 0.3, 0.1);
  ar(zip, t.sr, 0.004, 0.06);
  t.put(out, zip, 0.01, 0.4);
  note(out, t, BELL, 0.17, 96, 0.15, 0.85, 0.5);
  return out;
}

/**
 * The hottest charge let go: under the mini-turbo, a deep whoomph of the
 * fire catching and a roar, a run up the C major scale in bells and glass,
 * and a shimmer of embers trailing off.
 */
export function superTurbo(t: Take): Mono {
  const out = t.canvas(1.05);
  t.put(out, thump(t, 0.45, 120, 36, 0.003, 0.12), 0, 1);
  const roar = air(t, 0.6, 160, 2200, 1.5, puff(0.06, 2), 80);
  t.put(out, roar, 0, 0.6);
  [84, 88, 91, 96, 100, 103].forEach((m, k) => note(out, t, k % 2 ? GLASS : BELL, 0.03 + k * 0.045, m, 0.1, 0.9, 0.34 + 0.05 * k));
  t.put(out, crackle(t, 0.55, 4000, 0.1, 5), 0.05, 0.3);
  shower(out, t, 0.2, 0.7, 14, 5000, 11000, 0.1, [0.01, 0.04], 1);
  return out;
}

/**
 * Flung out of a slipstream: a rubber band let go (a string's twang and a
 * springy zip) with the air rushing past, thinning behind.
 */
export function slingshot(t: Take): Mono {
  const out = t.canvas(0.85);
  note(out, t, TWANG, 0, 47, 0.1, 0.9, 0.55);
  const n = t.n(0.2);
  const f = sampled(n, (u) => 240 * Math.pow(5.5, Math.pow(u, 0.6)) * (1 + 0.06 * Math.sin(2 * Math.PI * 22 * u * 0.2) * (1 - u)), 16);
  const zip = tone(n, t.sr, f, 0.3, 0.12);
  shapeBy(zip, (u) => smooth(u / 0.04) * (1 - u) ** 0.7);
  t.put(out, zip, 0, 0.55);
  t.put(out, click(t.sr, t.rng, 0.002, 1500, 9000), 0, 0.3);
  t.put(out, air(t, 0.7, 800, 5800, 1.2, swoosh(0.12, 1.5), 90), 0.03, 0.85);
  return out;
}

// --- boosts ---------------------------------------------------------------------------------------------------

/** A nitro's boost, felt rather than lit: a surge of air, a low fwoom rising under it, and the pressure of speed. */
export function boostWhoosh(t: Take): Mono {
  const out = t.canvas(1.35);
  t.put(out, air(t, 1.2, 420, 4200, 1.0, swoosh(0.08, 1.4), 80), 0, 1);
  const fwoom = sweep(t, 0.95, (u) => 80 * Math.pow(2.9, u), 0.3, 0.1);
  shapeBy(fwoom, swell);
  t.put(out, fwoom, 0, 0.5);
  t.put(out, thump(t, 0.2, 130, 50, 0.003, 0.05), 0, 0.5);
  return out;
}

/**
 * A boost pad: a flanged rush that sweeps up (a comb of air), a saw zip
 * with an echo, a punch underneath and a bright two-bell cadence on top.
 */
export function boostPad(t: Take): Mono {
  const out = t.canvas(0.8);
  const rush = air(t, 0.4, 700, 8500, 2.4, swoosh(0.05, 1.5), 0, 0.8);
  // The comb: a short delay mixed back, the delay shrinking, so the air seems to zip.
  const comb = Float32Array.from(rush);
  for (let i = 0; i < rush.length; i++) {
    const d = Math.round(t.sr * (0.003 - 0.0022 * (i / rush.length)));
    if (i >= d) comb[i]! += 0.8 * rush[i - d]!;
  }
  t.put(out, comb, 0, 0.6);
  const zip = sweep(t, 0.22, (u) => 330 * Math.pow(4.6, Math.pow(u, 0.75)), 0.35, 0.2);
  ar(zip, t.sr, 0.005, 0.08);
  t.put(out, zip, 0, 0.45);
  t.put(out, zip, 0.07, 0.15);
  t.put(out, thump(t, 0.14, 150, 55, 0.002, 0.035), 0, 0.6);
  note(out, t, BELL, 0.13, 91, 0.1, 0.9, 0.45);
  note(out, t, CHIME, 0.2, 96, 0.3, 0.95, 0.55);
  return out;
}

/** A rocket start: a thump, a roar of flame, a whistle climbing and a sparkle at the top. */
export function startBoost(t: Take): Mono {
  const out = t.canvas(1.4);
  t.put(out, thump(t, 0.3, 160, 46, 0.003, 0.08), 0, 1);
  t.put(out, air(t, 1.15, 240, 3200, 0.9, swoosh(0.07, 1.2), 80, 0.9), 0.01, 1);
  const whistle = sweep(t, 0.75, (u) => 320 * Math.pow(6.5, Math.pow(u, 1.3)), 0.2, 0.05);
  ar(whistle, t.sr, 0.02, 0.15);
  t.put(out, whistle, 0.05, 0.3);
  t.put(out, crackle(t, 0.5, 3500, 0.08, 4), 0.05, 0.25);
  note(out, t, BELL, 0.68, 96, 0.2, 0.9, 0.5);
  note(out, t, CHIME, 0.76, 103, 0.4, 0.95, 0.55);
  shower(out, t, 0.7, 0.4, 10, 5000, 11000, 0.1, [0.01, 0.04], 1);
  return out;
}

// --- the engine's voice -------------------------------------------------------------------------------

/**
 * The roar of a flame: a band of turbulent gas that flutters (a few dozen times a second, never evenly), a throatier
 * band under it and a sprinkle of crackle, swelling in and dying away. A boost's fire; the longer the boost, the
 * longer the take is stretched by its caller.
 */
function flameRoar(t: Take, seconds: number, attack: number): Mono {
  const n = t.n(seconds);
  const gas = bandNoise(n, t.sr, t.rng, 220, 2600, 2);
  const flutter = lowpass(white(n, t.rng), t.sr, 38, 2);
  normalize(flutter);
  for (let i = 0; i < n; i++) gas[i]! *= 0.62 + 0.38 * flutter[i]!;
  const throat = bandNoise(n, t.sr, t.rng, 70, 420, 2);
  for (let i = 0; i < n; i++) gas[i]! += 0.8 * throat[i]! * (0.7 + 0.3 * flutter[i]!);
  const crackle = highpass(white(n, t.rng), t.sr, 3500, 2);
  for (let i = 0; i < n; i++) crackle[i]! *= t.rng.next() < 0.025 ? 1 : 0.02;
  for (let i = 0; i < n; i++) gas[i]! += 0.35 * crackle[i]!;
  return shapeBy(gas, (u) => smooth(u / attack) * Math.pow(Math.max(0, 1 - u), 1.2));
}

/** The flame behind a hot drift boost (the second spark level): a second of fire. */
export function flameShort(t: Take): Mono {
  const out = t.canvas(1.0);
  t.put(out, flameRoar(t, 1.0, 0.04), 0, 1);
  return out;
}

/** The flame behind the hottest drift boost: nearly two seconds, throatier as it dies. */
export function flameLong(t: Take): Mono {
  const out = t.canvas(1.8);
  t.put(out, flameRoar(t, 1.8, 0.06), 0, 1);
  return out;
}


/**
 * Lifting off at high revs: the exhaust spits two to four little pops, each
 * a dull bang and a crackle, quickly dying away. Pitched to the engine.
 */
export function backfire(t: Take): Mono {
  const out = t.canvas(0.55);
  const count = 2 + Math.floor(t.rng.next() * 3);
  let at = 0;
  for (let k = 0; k < count; k++) {
    const strength = Math.pow(0.7, k) * t.rng.range(0.8, 1.1);
    const pop = thump(t, 0.06, t.rng.range(380, 520) * t.p, 90, 0.0008, 0.014);
    const spit = bandNoise(t.n(0.03), t.sr, t.rng, 900, 6000, 2);
    expo(spit, t.sr, 0.006, 0.0004);
    for (let i = 0; i < spit.length; i++) pop[i]! += 0.6 * spit[i]!;
    t.put(out, pop, at, strength);
    at += t.rng.range(0.05, 0.14);
  }
  return lowpass(out, t.sr, 7000, 2);
}


/** Another kart going by close and fast: a short swish of air, its band sliding down as the kart draws past. */
export function passSwish(t: Take): Mono {
  const out = t.canvas(0.5);
  t.put(out, whoosh(t, 0.45, 2800 * t.p, 650 * t.p, 1.5, swoosh(0.4, 2.2)), 0, 1);
  return out;
}


/** The engine flooded at the start: a stuttering sputter that coughs itself out. */
export function flood(t: Take): Mono {
  const out = t.canvas(0.95);
  const gaps = [0, 0.085, 0.18, 0.29, 0.43, 0.6, 0.8];
  gaps.forEach((at, k) => {
    const strength = Math.pow(0.78, k);
    const f = t.rng.range(95, 120) * t.p * (1 - 0.05 * k);
    const pulse = thump(t, 0.07, f * 1.5, f * 0.7, 0.002, 0.018);
    const noise = bandpass(white(t.n(0.05), t.rng), t.sr, 200, 1800, 2);
    expo(noise, t.sr, 0.012, 0.001);
    for (let i = 0; i < noise.length && i < pulse.length; i++) pulse[i]! += 0.7 * noise[i]!;
    t.put(out, pulse, at + t.rng.range(-0.006, 0.006), strength);
  });
  return lowpass(out, t.sr, 2600, 2);
}
