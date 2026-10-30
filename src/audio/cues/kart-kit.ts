/**
 * Small tools the Grip Prix sounds share: a glissando oscillator, the
 * glassy ping and the sweeping air of the events and the items, envelopes,
 * and the loop makers (periodic by construction for tones, wrapped grains
 * and cross-faded noise for textures).
 */
import { midiHz, sampled, smooth } from "../dsp/curves";
import { svf } from "../dsp/filters";
import { loopify } from "../dsp/master";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { type Voice, modal, softClip } from "../dsp/voices";

export const TAU = Math.PI * 2;

/**
 * A sine on a frequency track with optional second and third harmonics: a
 * rotating phasor re-aimed every 16 samples, so a siren costs a few
 * multiplies a sample rather than a sin(). Starts at zero phase.
 */
export function tone(n: number, sr: number, freq: Float32Array, h2 = 0, h3 = 0): Mono {
  const out = new Float32Array(n);
  let re = 1;
  let im = 0;
  let cw = 1;
  let sw = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) {
      const w = (TAU * freq[i]!) / sr;
      cw = Math.cos(w);
      sw = Math.sin(w);
      const norm = 1 / Math.sqrt(re * re + im * im);
      re *= norm;
      im *= norm;
    }
    out[i] = im + h2 * 2 * re * im + h3 * (3 * im - 4 * im * im * im);
    const nr = re * cw - im * sw;
    im = re * sw + im * cw;
    re = nr;
  }
  return out;
}

/** A glassy ping voice for the sparkles. */
const PING: Voice = modal({
  partials: [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.25]],
  tau: 0.22, free: true, hammer: { level: 0.1, tau: 0.002, low: 9000 },
});

/** One ping, placed on ``out``. */
export function ping(out: Mono, t: Take, at: number, midi: number, gain = 1, vel = 0.8): void {
  t.put(out, PING({ sr: t.sr, freq: midiHz(midi) * t.rng.range(0.998, 1.002), hold: 0.1, vel, rng: t.rng.fork(`${midi}${at}`) }), at, gain);
}

/** A sweeping band of air: noise through a band-pass whose centre glides from ``from`` to ``to`` (exponentially). */
export function whoosh(t: Take, seconds: number, from: number, to: number, q: number, envelope: (u: number) => number): Mono {
  const n = t.n(seconds);
  const buf = white(n, t.rng);
  svf(buf, t.sr, "bp", (u) => from * Math.pow(to / from, u), q);
  normalize(buf);
  return shapeBy(buf, envelope);
}

/** Fast rise, slow fall. */
export const swoosh = (rise: number, power = 1.6) => (u: number): number => smooth(u / rise) * Math.pow(Math.max(0, 1 - u), power);

/** A pitch-gliding sine with a few harmonics, between two frequencies on a curve. */
export function glide(t: Take, seconds: number, from: number, to: number, curve = 1, h2 = 0, h3 = 0): Mono {
  const n = t.n(seconds);
  const f = sampled(n, (u) => from * Math.pow(to / from, Math.pow(u, curve)), 16);
  return tone(n, t.sr, f, h2, h3);
}

/** Drive a buffer through the soft clip in place, level-compensated at unity. */
export function drive(buf: Mono, amount: number): Mono {
  const norm = softClip(amount);
  for (let i = 0; i < buf.length; i++) buf[i] = softClip(amount * buf[i]!) / norm;
  return buf;
}

/** Attack-and-release: a linear rise over ``attack`` seconds and a cosine fall over the last ``release``. */
export function ar(buf: Mono, sr: number, attack: number, release: number): Mono {
  const n = buf.length;
  const a = Math.max(1, Math.round(attack * sr));
  const r = Math.max(1, Math.round(release * sr));
  for (let i = 0; i < Math.min(a, n); i++) buf[i]! *= i / a;
  for (let i = 0; i < Math.min(r, n); i++) buf[n - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / r);
  return buf;
}

/** Multiply by an exponential decay with time constant ``tau`` and a short attack, in place. */
export function expo(buf: Mono, sr: number, tau: number, attack = 0.001): Mono {
  const k = Math.exp(-1 / Math.max(1, tau * sr));
  const a = Math.max(1, attack * sr);
  let e = 1;
  for (let i = 0; i < buf.length; i++) {
    buf[i]! *= e * (i < a ? i / a : 1);
    e *= k;
  }
  return buf;
}

/**
 * Add ``layer`` into ``out`` starting at sample ``start``, wrapping past the
 * end back to the beginning: events in a loop that straddle the seam.
 */
export function addWrapped(out: Mono, layer: Mono, start: number, gain = 1): void {
  const n = out.length;
  for (let i = 0; i < layer.length; i++) out[(((start + i) % n) + n) % n]! += gain * layer[i]!;
}

/**
 * A texture of random short grains, seamless as a loop: ``rate`` grains a
 * second at random times (those near the end wrap), each made by ``grain``
 * (called with the grain's loudness 0..1) and scaled by it.
 */
export function grains(t: Take, seconds: number, rate: number, grain: (strength: number) => Mono): Mono {
  const n = t.n(seconds);
  const out = new Float32Array(n);
  const count = Math.max(1, Math.round(rate * seconds));
  // No grain *begins* within 25 ms of the seam: its tail may wrap, but an onset exactly on the join would be heard as one.
  const margin = t.n(0.025);
  for (let k = 0; k < count; k++) {
    const strength = 0.25 + 0.75 * t.rng.next() ** 1.5;
    addWrapped(out, grain(strength), margin + Math.floor(t.rng.next() * (n - 2 * margin)), strength);
  }
  return out;
}

/**
 * Apply a filter to a loop so that it is as smooth at the seam as anywhere:
 * a filter starts from rest, so run it over two copies end to end and keep
 * the second, by which time it has settled into the loop's own steady state.
 */
export function circular(buf: Mono, filter: (twice: Mono) => void): Mono {
  const n = buf.length;
  const twice = new Float32Array(2 * n);
  twice.set(buf, 0);
  twice.set(buf, n);
  filter(twice);
  buf.set(twice.subarray(n));
  return buf;
}

/** Noise made loopable: render ``n + overlap`` of it, cross-fade the overlap into the start. */
export function noiseLoop(t: Take, seconds: number, make: (samples: number) => Mono, overlap = 0.25): Mono {
  const n = t.n(seconds);
  return loopify(make(n + t.n(overlap)), n);
}

/**
 * A slow modulator that repeats exactly every loop: ``cycles`` whole sine cycles in ``n`` samples, in [1 - depth, 1].
 * A rotating phasor (re-aimed every 4096 samples so it never drifts) rather than a sin() a sample: the loops use
 * dozens of these.
 */
export function cyclic(n: number, cycles: number, depth: number, phase = 0): Float32Array {
  const out = new Float32Array(n);
  const w = (TAU * cycles) / n;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 4095) === 0) {
      re = Math.cos(w * i + phase);
      im = Math.sin(w * i + phase);
    }
    out[i] = 1 - depth * (0.5 - 0.5 * im);
    const nr = re * cw - im * sw;
    im = re * sw + im * cw;
    re = nr;
  }
  return out;
}

/** Multiply two buffers in place: ``a *= b``. */
export function times(a: Mono, b: Float32Array): Mono {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i]! *= b[i]!;
  return a;
}

/**
 * Start a periodic loop where it is calmest: an exactly periodic buffer has
 * no click wherever it is cut, but cutting it at a steep edge puts the
 * steepest step of the waveform at the seam, which is what a seam check (or
 * a tired ear) looks for. Rotates to the sample with the smallest step from
 * the one before it, near a zero crossing's lull rather than a pulse's edge.
 */
export function calmSeam(buf: Mono): Mono {
  const n = buf.length;
  let best = 0;
  let bestStep = Infinity;
  for (let i = 0; i < n; i++) {
    const step = Math.abs(buf[i]! - buf[(i + n - 1) % n]!) + 0.5 * Math.abs(buf[(i + 1) % n]! - buf[i]!);
    if (step < bestStep) {
      bestStep = step;
      best = i;
    }
  }
  if (best === 0) return buf;
  const copy = Float32Array.from(buf);
  for (let i = 0; i < n; i++) buf[i] = copy[(i + best) % n]!;
  return buf;
}
