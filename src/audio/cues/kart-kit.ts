/**
 * Small tools the Grip Prix sounds share: curves, a glissando oscillator,
 * toy notes, and the loop makers (periodic by construction for tones,
 * wrapped grains and cross-faded noise for textures).
 */
import { loopify } from "../dsp/master";
import { type Mono, shapeBy } from "../dsp/signal";
import type { Take } from "../dsp/take";
import { type SubSpec, subtractive } from "../dsp/voices";

export const TAU = Math.PI * 2;

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * Math.min(1, Math.max(0, u));
/** A smoothstep of u clamped to 0..1. */
export const smooth = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};
/** Equal-tempered ratio for a number of semitones. */
export const semi = (n: number): number => Math.pow(2, n / 12);
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** A curve of u = 0..1 sampled every ``step`` samples, linear between: envelopes and pitch tracks are slow. */
export function sampled(n: number, fn: (u: number) => number, step = 16): Float32Array {
  const out = new Float32Array(n);
  let a = fn(0);
  for (let i = 0; i < n; i += step) {
    const j = Math.min(n, i + step);
    const b = fn(j / n);
    for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i)) / step;
    a = b;
  }
  return out;
}

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

/** Soft clip (Padé tanh), flat past ±3. */
export function soft(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** Drive a buffer through the soft clip in place, level-compensated at unity. */
export function drive(buf: Mono, amount: number): Mono {
  const norm = soft(amount);
  for (let i = 0; i < buf.length; i++) buf[i] = soft(amount * buf[i]!) / norm;
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

/** A toy note through the subtractive engine, placed on ``out`` at ``at`` seconds. */
export function playNote(out: Mono, t: Take, spec: SubSpec, at: number, midi: number, hold: number, vel = 0.85, gain = 1): void {
  const voice = subtractive(spec);
  t.put(out, voice({ sr: t.sr, freq: midiHz(midi), hold, vel, rng: t.rng.fork(`${midi}@${at}`) }), at, gain);
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

/** A slow modulator that repeats exactly every loop: ``cycles`` whole sine cycles in ``n`` samples, in [1 - depth, 1]. */
export function cyclic(n: number, cycles: number, depth: number, phase = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 1 - depth * (0.5 - 0.5 * Math.sin((TAU * cycles * i) / n + phase));
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
