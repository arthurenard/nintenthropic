/**
 * The six newer Grip Prix items, as sounds (the older ones are in
 * ./kart-events.ts). Each is a toy-box sound like the rest: a comet's six
 * seconds of glitter, a storm's electric crack and the thunder after it, a
 * skyrocket's launch with its whistle and its burst, a blast's thump, and the
 * item box that turned out not to be one (the box smash, gone wrong). Pitched
 * parts sit in C major, as the other pack's do.
 */
import { bandpass, highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, click, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { type Voice, modal } from "../dsp/voices";
import { thump } from "./kit";
import { ar, drive, expo, midiHz, sampled, smooth, tone } from "./kart-kit";

/** A glassy ping voice for the sparkles. */
const PING: Voice = modal({
  partials: [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.25]],
  tau: 0.22, free: true, hammer: { level: 0.1, tau: 0.002, low: 9000 },
});

function ping(out: Mono, t: Take, at: number, midi: number, gain = 1, vel = 0.8): void {
  t.put(out, PING({ sr: t.sr, freq: midiHz(midi) * t.rng.range(0.998, 1.002), hold: 0.1, vel, rng: t.rng.fork(`${midi}${at}`) }), at, gain);
}

/** A sweeping band of air: noise through a band-pass whose centre glides from ``from`` to ``to``. */
function whoosh(t: Take, seconds: number, from: number, to: number, q: number, envelope: (u: number) => number): Mono {
  const buf = white(t.n(seconds), t.rng);
  svf(buf, t.sr, "bp", (u) => from * Math.pow(to / from, u), q);
  normalize(buf);
  return shapeBy(buf, envelope);
}

const swoosh = (rise: number, power = 1.6) => (u: number): number => smooth(u / rise) * Math.pow(Math.max(0, 1 - u), power);

/** A pitch-gliding sine with a few harmonics. */
function glide(t: Take, seconds: number, from: number, to: number, curve = 1, h2 = 0, h3 = 0): Mono {
  const n = t.n(seconds);
  const f = sampled(n, (u) => from * Math.pow(to / from, Math.pow(u, curve)));
  return tone(n, t.sr, f, h2, h3);
}

/** The C-major pentatonic, high up: where the glitter lives (MIDI notes). */
const GLITTER = [84, 86, 88, 91, 93, 96, 98, 100, 103];

// --- comet ----------------------------------------------------------------------------------------------

/**
 * A Comet, all six seconds of it: a rising zip into a shimmering bed of
 * three soft tones that breathe, glitter pinging all over it, and in the last
 * second and a half (while the picture blinks) the whole thing winding down.
 */
export function cometGlitter(t: Take): Mono {
  const seconds = 6.1;
  const out = t.canvas(seconds);
  // The lift-off.
  t.put(out, whoosh(t, 0.7, 500, 6000, 1.2, swoosh(0.06, 1.4)), 0, 0.7);
  const zip = glide(t, 0.35, 420, 2300, 0.8, 0.3, 0.1);
  ar(zip, t.sr, 0.005, 0.1);
  t.put(out, zip, 0, 0.4);
  [84, 88, 91, 96].forEach((m, k) => ping(out, t, 0.05 + 0.07 * k, m, 0.8, 0.85));
  // The bed: C6, E6 and G6, each swelling and ebbing at its own slow rate, so the chord shimmers.
  const n = t.n(seconds);
  [
    { midi: 84, rate: 0.55, gain: 0.5 },
    { midi: 88.04, rate: 0.8, gain: 0.4 },
    { midi: 91.02, rate: 0.67, gain: 0.35 },
  ].forEach(({ midi, rate, gain }, k) => {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = midiHz(midi) * t.p * (1 + 0.004 * Math.sin((2 * Math.PI * (3 + k) * i) / t.sr));
    const voice = tone(n, t.sr, f, 0.12, 0.04);
    const phase = t.rng.range(0, 6.28);
    shapeBy(voice, (u) => {
      const s = u * seconds;
      const body = smooth(s / 0.5) * smooth((seconds - 1.2 - s) / 0.6 + 1);
      const wind = s > seconds - 1.5 ? 1 - 0.7 * smooth((s - (seconds - 1.5)) / 1.5) : 1;
      return body * wind * (0.55 + 0.45 * Math.sin(2 * Math.PI * rate * s + phase));
    }, 64);
    t.put(out, voice, 0, gain * 0.5);
  });
  // A soft airy hush under it, so the bed is not bare.
  const air = highpass(white(n, t.rng), t.sr, 6500, 2);
  shapeBy(air, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.25) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 9 * u * seconds * 0.25)), 128);
  t.put(out, air, 0, 0.05);
  // The glitter: pings at random times and heights, thicker at first, thinner at the end.
  for (let at = 0.6; at < seconds - 0.6; ) {
    const density = at < seconds - 1.8 ? 1 : 0.45;
    const midi = GLITTER[Math.floor(t.rng.next() * GLITTER.length)]!;
    ping(out, t, at, midi, t.rng.range(0.1, 0.35) * density, t.rng.range(0.5, 0.9));
    at += t.rng.range(0.07, 0.26) / density;
  }
  // The wind-down: a glide falling out of the sparkle, and one last ping at the end.
  const down = glide(t, 1.1, 1900, 380, 0.9, 0.25);
  ar(down, t.sr, 0.2, 0.5);
  t.put(out, down, seconds - 1.6, 0.18);
  ping(out, t, seconds - 0.7, 84, 0.45, 0.6);
  ping(out, t, seconds - 0.55, 79, 0.35, 0.55);
  return out;
}

// --- storm ------------------------------------------------------------------------------------------------

/** A bolt: a hard electric crack, a zap falling through the air, and the thunder that rolls after it. */
export function stormCrack(t: Take): Mono {
  const out = t.canvas(2.2);
  const crack = bandNoise(t.n(0.12), t.sr, t.rng, 1800, 14000, 2);
  expo(crack, t.sr, 0.018, 0.0005);
  t.put(out, crack, 0, 1);
  t.put(out, click(t.sr, t.rng, 0.004, 2000, 12000), 0, 0.8);
  const zap = glide(t, 0.22, 5200 * t.p, 260, 0.5, 0.5, 0.3);
  drive(zap, 3);
  ar(zap, t.sr, 0.001, 0.12);
  t.put(out, zap, 0, 0.42);
  // Crackle: a handful of sparks right after the crack.
  for (let k = 0; k < 7; k++) addMode(out, t.sr, t.rng.range(0.03, 0.22), t.rng.range(3000, 9000), t.rng.range(0.15, 0.4), t.rng.range(0.01, 0.03), t.rng.range(0, 6.28));
  // The thunder: a rumble that swells a moment after, rolling.
  const rumble = lowpass(bandNoise(t.n(1.9), t.sr, t.rng, 40, 520, 2), t.sr, 420 * t.cutoff, 2);
  const n = rumble.length;
  const roll = sampled(n, (u) => 0.55 + 0.45 * Math.sin(2 * Math.PI * (5 + 3 * u) * u * 1.9 + 1));
  for (let i = 0; i < n; i++) rumble[i]! *= roll[i]!;
  shapeBy(rumble, (u) => smooth(u / 0.06) * Math.pow(Math.max(0, 1 - u), 1.7), 64);
  t.put(out, rumble, 0.08, 1.15);
  t.put(out, thump(t, 0.7, 95, 36, 0.01, 0.2), 0.1, 0.7);
  return lowpass(out, t.sr, 12000, 1);
}

// --- skyrocket --------------------------------------------------------------------------------------------

/** A skyrocket leaving: a fizz, an ignition thump, a roar and a whistle climbing away. */
export function skyrocketLaunch(t: Take): Mono {
  const out = t.canvas(1.7);
  const hiss = highpass(white(t.n(0.3), t.rng), t.sr, 3500, 2);
  expo(hiss, t.sr, 0.08, 0.004);
  t.put(out, hiss, 0, 0.55);
  t.put(out, thump(t, 0.3, 170, 52, 0.002, 0.08), 0.05, 1);
  t.put(out, whoosh(t, 1.4, 350, 3200, 0.9, swoosh(0.06, 1.1)), 0.06, 0.9);
  const whistle = glide(t, 1.3, 620 * t.p, 3100 * t.p, 0.9, 0.22, 0.05);
  shapeBy(whistle, (u) => smooth(u / 0.08) * Math.pow(Math.max(0, 1 - u), 1.2));
  t.put(out, whistle, 0.1, 0.38);
  ping(out, t, 0.12, 96, 0.3);
  return out;
}

/** The burst: a big round boom, a flash of noise and a shower of glitter and crackle falling away. */
export function skyrocketBurst(t: Take): Mono {
  const out = t.canvas(2.0);
  t.put(out, thump(t, 0.7, 150, 34, 0.002, 0.15), 0, 1);
  const crack = bandNoise(t.n(0.2), t.sr, t.rng, 600, 9000, 2);
  expo(crack, t.sr, 0.04, 0.001);
  t.put(out, crack, 0, 0.9);
  const body = lowpass(bandNoise(t.n(1.2), t.sr, t.rng, 80, 900, 2), t.sr, 700, 2);
  expo(body, t.sr, 0.3, 0.004);
  t.put(out, body, 0, 0.9);
  // The shower.
  for (let k = 0; k < 26; k++) {
    const at = 0.05 + Math.pow(t.rng.next(), 1.6) * 1.3;
    addMode(out, t.sr, at, t.rng.range(2200, 8800), t.rng.range(0.1, 0.32), t.rng.range(0.02, 0.09), t.rng.range(0, 6.28));
  }
  for (let k = 0; k < 6; k++) ping(out, t, 0.1 + 0.07 * k + t.rng.range(0, 0.04), GLITTER[(k * 2) % GLITTER.length]!, 0.28, 0.7);
  return lowpass(out, t.sr, 13000, 1);
}

// --- blast ---------------------------------------------------------------------------------------------------

/** A ring of force: a deep thump, a burst of air spreading out and a ripple of glass. */
export function blastWump(t: Take): Mono {
  const out = t.canvas(1.1);
  t.put(out, thump(t, 0.5, 120, 30, 0.002, 0.11), 0, 1.1);
  t.put(out, thump(t, 0.2, 260, 90, 0.001, 0.04), 0, 0.5);
  t.put(out, whoosh(t, 0.7, 250, 4200, 1.0, swoosh(0.03, 2.0)), 0.005, 0.85);
  const shock = bandpass(white(t.n(0.08), t.rng), t.sr, 300, 3000, 2);
  expo(shock, t.sr, 0.015, 0.0005);
  t.put(out, shock, 0, 0.6);
  // The ripple going out: a glide down in a glassy sine, and two pings.
  const ring = glide(t, 0.6, 1500 * t.p, 420, 0.6, 0.3);
  ar(ring, t.sr, 0.004, 0.3);
  t.put(out, ring, 0.02, 0.28);
  ping(out, t, 0.12, 88, 0.35);
  ping(out, t, 0.22, 81, 0.3);
  return out;
}

// --- decoy ---------------------------------------------------------------------------------------------------

/**
 * An item box that was not one: the box smash (a bright crack and a scatter
 * of shards), but the chime that should rise sags down in the wrong notes, and
 * a sad slide-whistle wah follows it.
 */
export function decoyPop(t: Take): Mono {
  const out = t.canvas(1.3);
  const crack = bandNoise(t.n(0.06), t.sr, t.rng, 2000, 9000, 2);
  expo(crack, t.sr, 0.01, 0.0005);
  t.put(out, crack, 0, 0.9);
  t.put(out, thump(t, 0.14, 250, 100, 0.001, 0.03), 0, 0.55);
  for (let k = 0; k < 8; k++) {
    addMode(out, t.sr, t.rng.range(0.005, 0.14), t.rng.range(2500, 9000), t.rng.range(0.1, 0.28), t.rng.range(0.012, 0.045), t.rng.range(0, 6.28));
  }
  // The wrong chime: it starts where the right one would, then slips a half-step flat and keeps falling.
  ping(out, t, 0.07, 84, 0.7);
  ping(out, t, 0.17, 90.5, 0.7);
  ping(out, t, 0.27, 83, 0.6);
  // The wah: a slide whistle going down with a wobble.
  const n = t.n(0.7);
  const f = sampled(n, (u) => 520 * t.p * Math.pow(0.42, u) * (1 + 0.035 * Math.sin(2 * Math.PI * 6 * u * 0.7)));
  const wah = tone(n, t.sr, f, 0.35, 0.12);
  shapeBy(wah, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.35));
  t.put(out, wah, 0.38, 0.38);
  return lowpass(out, t.sr, 11000, 1);
}

/** Exposed for the tests: the pieces a rendered take is made of. */
export const KART_ITEM_RECIPES = { cometGlitter, stormCrack, skyrocketLaunch, skyrocketBurst, blastWump, decoyPop };
