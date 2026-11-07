/**
 * The sound designer's bench for Grip Prix's items, impacts and moments: the
 * layers every one of those sounds is built from. A sound here is never one
 * oscillator and an envelope; it is a transient (a click, a thump, a crack),
 * a body (tonal, resonant, or a sweep of air) and a tail (noise, an echo,
 * debris), and this file holds the parts those are cut from:
 *
 *   instruments   FM bells for metal and glass, a kalimba, a plucked string
 *                 (Karplus-Strong), a brass stab: voices to play notes on
 *   unison        a stack of detuned saws, the shimmer under a comet
 *   granular air  noise whose band sweeps and whose level is chopped into
 *                 grains: whooshes with texture, never a flat hiss
 *   debris        random showers of ringing shards, crackles, rain
 *   pitch shapes  sirens, tweets, slide whistles, wobbles
 *   echoes        a handful of filtered taps: the shock wave off the walls
 *
 * Everything is in the C major pentatonic where it is pitched (the music and
 * the other cues are, so any two that overlap agree) and nothing imitates a
 * known effect: the shapes are the genre's, the numbers are ours.
 */
import { midiHz, sampled, smooth } from "../dsp/curves";
import { highpass, lowpass, svf } from "../dsp/filters";
import type { Rng } from "../dsp/rng";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, saw, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { type SubSpec, type Voice, fm, modal, plucked, subtractive } from "../dsp/voices";
import { expo, tone } from "./kart-kit";

// --- instruments --------------------------------------------------------------------------------------------

/** A hard metallic bell: FM at an inharmonic ratio, the index collapsing fast, so a strike with a ring after it. */
export const BELL: Voice = fm({ ratio: 3.5, index: 2.8, indexTau: 0.06, tau: 0.42, release: 0.2, velIndex: 0.7 });
/** A warm chime: FM at 2:1, softer, longer. The reward voice. */
export const CHIME: Voice = fm({ ratio: 2, index: 1.5, indexTau: 0.22, tau: 0.8, release: 0.3, octave: 0.12, velIndex: 0.5 });
/** Glass: a free ring of inharmonic partials with a hard tick. */
export const GLASS: Voice = modal({
  partials: [[1, 1, 1], [2.76, 0.45, 0.5], [5.4, 0.25, 0.28], [8.9, 0.12, 0.15]],
  tau: 0.5, free: true, hammer: { level: 0.12, tau: 0.002, low: 8000 },
});
/** A kalimba's tine: a bright pluck with one high partial that dies at once. */
export const KALIMBA: Voice = modal({
  partials: [[1, 1, 1], [5.4, 0.32, 0.16], [11.7, 0.1, 0.08]],
  tau: 0.34, hammer: { level: 0.2, tau: 0.002, low: 5000 }, damp: 0.08,
});
/** A marimba bar: warm, short. */
export const MARIMBA: Voice = modal({
  partials: [[1, 1, 1], [3.93, 0.2, 0.28], [9.2, 0.05, 0.1]],
  tau: 0.22, hammer: { level: 0.25, tau: 0.003, low: 2500 }, damp: 0.1,
});
/** A plucked string, bright: the twang of a stretched band. */
export const TWANG: Voice = plucked({ t60: 0.5, brightness: 0.85, position: 0.12, hardness: 7000, damp: 0.03 });
/** A softer pluck: a pizzicato pip. */
export const PIP: Voice = plucked({ t60: 0.35, brightness: 0.6, position: 0.25, hardness: 4500, damp: 0.03 });
/** Two detuned saws through a swept filter: the brass of the stingers. */
const BRASS_SPEC: SubSpec = {
  oscs: [{ wave: "saw", cents: -7, level: 0.5 }, { wave: "saw", cents: 7, level: 0.5 }, { wave: "square", level: 0.2, mult: 0.5 }],
  cutoff: 420, keytrack: 1.9, envOct: 2.2, fdecay: 0.1, fsustain: 0.5, q: 1.3,
  attack: 0.018, decay: 0.4, sustain: 0.8, release: 0.12, velBright: 0.6,
};
export const BRASS: Voice = subtractive(BRASS_SPEC);
/** A hard stab of the same, for pulses: no swell. */
export const STAB: Voice = subtractive({ ...BRASS_SPEC, attack: 0.004, decay: 0.12, sustain: 0.5, release: 0.06, envOct: 2.8, fdecay: 0.06 });
/** A trombone-ish wah: a saw with a vowel's filter sweep and a slow vibrato. */
export const WAH: Voice = subtractive({
  oscs: [{ wave: "saw", cents: -5, level: 0.5 }, { wave: "saw", cents: 5, level: 0.5 }],
  cutoff: 260, envOct: 2.4, fdecay: 0.16, fsustain: 0.3, q: 2.2,
  attack: 0.03, decay: 0.3, sustain: 0.75, release: 0.1, vibrato: { rate: 5.2, depth: 14, delay: 0.1 },
});

/** Place a voice's note on ``out`` (the exact pitch; the take's own pitch spread is for noises, not notes). */
export function note(out: Mono, t: Take, voice: Voice, at: number, midi: number, hold: number, vel = 0.85, gain = 1): void {
  t.put(out, voice({ sr: t.sr, freq: midiHz(midi), hold, vel, rng: t.rng.fork(`${midi}@${at}`) }), at, gain);
}

/** The C major pentatonic across the top of the keyboard, in MIDI notes: where glitter lives. */
export const GLITTER = [84, 86, 88, 91, 93, 96, 98, 100, 103];
/** One octave of it from C5, for run-ups. */
export const PENTA = [72, 74, 76, 79, 81, 84];

// --- unison --------------------------------------------------------------------------------------------------

/**
 * A stack of detuned band-limited saws on one pitch track, softened by a
 * low-pass: a pad's shimmer. ``cents`` lists the detune of each saw.
 */
export function unison(t: Take, seconds: number, freq: number | Float32Array, cents: readonly number[], cutoff: number): Mono {
  const n = t.n(seconds);
  const out = new Float32Array(n);
  for (const c of cents) {
    const ratio = Math.pow(2, c / 1200);
    const f = typeof freq === "number" ? freq * ratio : Float32Array.from(freq, (v) => v * ratio);
    const s = saw(n, t.sr, f, 0, t.rng.next());
    for (let i = 0; i < n; i++) out[i]! += s[i]! / cents.length;
  }
  return lowpass(out, t.sr, cutoff, 2);
}

// --- granular air ----------------------------------------------------------------------------------------------

/**
 * Noise through a resonant band that glides from ``from`` to ``to`` (Hz,
 * exponentially along ``curve``), its level chopped into grains ``grain``
 * times a second (0 for none) by a random stepped gain smoothed to a few
 * milliseconds. A whoosh with texture, so a boost is turbulence and not a
 * hiss. Normalised, shaped by ``envelope``.
 */
export function air(t: Take, seconds: number, from: number, to: number, q: number, envelope: (u: number) => number, grain = 0, curve = 1): Mono {
  const n = t.n(seconds);
  const buf = white(n, t.rng);
  svf(buf, t.sr, "bp", (u) => from * Math.pow(to / from, Math.pow(u, curve)), q);
  normalize(buf);
  if (grain > 0) {
    const step = Math.max(1, Math.round(t.sr / grain));
    const g = new Float32Array(n);
    let v = 1;
    for (let i = 0; i < n; i += step) {
      v = 0.35 + 0.65 * t.rng.next();
      g.fill(v, i, Math.min(n, i + step));
    }
    lowpass(g, t.sr, Math.min(900, grain * 3), 1);
    for (let i = 0; i < n; i++) buf[i]! *= g[i]!;
  }
  return shapeBy(buf, envelope);
}

/** A rise then a fall: attack over the first ``rise`` of the length, a power-law fall after. */
export const puff = (rise: number, power = 1.6) => (u: number): number => smooth(u / rise) * Math.pow(Math.max(0, 1 - u), power);

// --- debris ----------------------------------------------------------------------------------------------------

/**
 * A shower of ringing shards: ``count`` short decaying partials at random
 * times (their spread bent by ``bias``: above 1 front-loaded), random pitches
 * in [lo, hi] and random sizes. Glass, sparks, confetti.
 */
export function shower(
  out: Mono,
  t: Take,
  at: number,
  span: number,
  count: number,
  lo: number,
  hi: number,
  amp: number,
  tau: [number, number] = [0.012, 0.05],
  bias = 1.6,
): void {
  for (let k = 0; k < count; k++) {
    const when = at + Math.pow(t.rng.next(), bias) * span;
    const f = lo * Math.pow(hi / lo, t.rng.next());
    addMode(out, t.sr, when, f, amp * t.rng.range(0.35, 1), t.rng.range(tau[0], tau[1]), t.rng.range(0, 6.28));
  }
}

/** Crackle: random dense clicks through a high-pass, at ``density`` of the samples, dying along an exponential. */
export function crackle(t: Take, seconds: number, low: number, density: number, decay = 4): Mono {
  const n = t.n(seconds);
  const buf = highpass(white(n, t.rng), t.sr, low, 2);
  for (let i = 0; i < n; i++) buf[i]! *= (t.rng.next() < density ? 1 : 0.06) * Math.exp((-i / n) * decay);
  return buf;
}

/** Rain: a dense patter of tiny drops, high, with a hush under it. Steady, to be shaped by the caller. */
export function rain(t: Take, seconds: number, drops = 700): Mono {
  const n = t.n(seconds);
  const out = new Float32Array(n);
  const hush = bandNoiseHiss(t, n);
  for (let i = 0; i < n; i++) out[i]! += 0.25 * hush[i]!;
  for (let k = 0; k < drops * seconds; k++) {
    addMode(out, t.sr, t.rng.next() * seconds, t.rng.range(3500, 10500), t.rng.range(0.1, 0.45), t.rng.range(0.0008, 0.0035), t.rng.range(0, 6.28));
  }
  return out;
}

function bandNoiseHiss(t: Take, n: number): Mono {
  return bandNoise(n, t.sr, t.rng, 4000, 11000, 2);
}

// --- pitch shapes ------------------------------------------------------------------------------------------------

/** A sine (with a touch of harmonics) following ``hz(u)``, u = 0..1, with a wobble of ``depth`` (a fraction) at ``rate`` Hz. */
export function sweep(t: Take, seconds: number, hz: (u: number) => number, h2 = 0, h3 = 0, rate = 0, depth = 0): Mono {
  const n = t.n(seconds);
  const f = sampled(n, (u) => hz(u) * (rate ? 1 + depth * Math.sin(2 * Math.PI * rate * u * seconds) : 1), 16);
  return tone(n, t.sr, f, h2, h3);
}

/** A bird-like tweet: up fast, over and down, with a quick flutter. ``f`` is the peak. */
export function tweet(t: Take, f: number, seconds = 0.09): Mono {
  const buf = sweep(t, seconds, (u) => f * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, u * 1.1)) - 0.12 * u), 0.15, 0, 38, 0.03);
  return shapeBy(buf, (u) => smooth(u / 0.12) * smooth((1 - u) / 0.3));
}

/**
 * A two-tone siren: the pitch swaps between ``lo`` and ``hi`` ``cycles`` times
 * over the length, gliding between them (``glide`` of each half), with a few
 * harmonics, for a warning that is unmistakably a warning.
 */
export function siren(t: Take, seconds: number, lo: number, hi: number, cycles: number, glideFrac = 0.35): Mono {
  const buf = sweep(t, seconds, (u) => {
    const phase = (u * cycles * 2) % 2;
    const half = phase < 1 ? phase : phase - 1;
    const rising = phase < 1;
    const s = smooth(half / glideFrac);
    return rising ? lo * Math.pow(hi / lo, s) : hi * Math.pow(lo / hi, s);
  }, 0.5, 0.3);
  return shapeBy(buf, (u) => smooth(u / 0.04) * smooth((1 - u) / 0.15));
}

// --- echoes ---------------------------------------------------------------------------------------------------------

/**
 * Taps of the sound itself at later times, each quieter and darker: the
 * shock wave bouncing off the walls, a clap in a stairwell. Added to ``out``
 * from ``src``; a tap is a copy low-passed more with each repeat.
 */
export function taps(out: Mono, t: Take, src: Mono, times: readonly number[], gains: readonly number[], dark = 3200): void {
  times.forEach((at, k) => {
    const copy = lowpass(Float32Array.from(src), t.sr, dark * Math.pow(0.6, k), 1);
    t.put(out, copy, at, gains[k] ?? 0.3);
  });
}

/** A little wood-and-rubber knock: the click of a part meeting a part. ``f`` is the body's pitch. */
export function knock(out: Mono, t: Take, at: number, f: number, gain = 1, tau = 0.012): void {
  addMode(out, t.sr, at, f * t.rng.range(0.99, 1.01), gain, tau, 0);
  addMode(out, t.sr, at, f * 2.2, gain * 0.35, tau * 0.6, 1);
  const tick = bandNoise(t.n(0.003), t.sr, t.rng, 1500, 9000, 2);
  expo(tick, t.sr, 0.0008, 0.0001);
  t.put(out, tick, at, gain * 0.5);
}

/** A random-walk of values with a time constant, as a track: ``n`` samples in [lo, hi]. */
export function wander(n: number, rng: Rng, lo: number, hi: number, rate: number, sr: number): Float32Array {
  const out = new Float32Array(n);
  const step = Math.max(1, Math.round(sr / rate));
  let v = rng.range(lo, hi);
  let target = v;
  for (let i = 0; i < n; i++) {
    if (i % step === 0) target = rng.range(lo, hi);
    v += (target - v) * (1 / step) * 4;
    out[i] = v;
  }
  return out;
}
