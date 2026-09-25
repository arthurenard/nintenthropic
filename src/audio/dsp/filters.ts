/**
 * Time-domain filters. The Python version shaped spectra with FFTs; here
 * every filter is a recursive one (biquads and state-variable filters),
 * which costs a handful of multiplies per sample and lets a filter move over
 * time — a whistle that wanders, a mouth that closes — which a single FFT
 * cannot do.
 */
import type { Mono } from "./signal";

export type BiquadKind =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "peak"
  | "lowshelf"
  | "highshelf"
  | "notch";

/** RBJ cookbook coefficients, normalised so a0 = 1. */
export function biquadCoefficients(
  kind: BiquadKind,
  sr: number,
  freq: number,
  q = Math.SQRT1_2,
  gainDb = 0,
): [number, number, number, number, number] {
  const f = Math.min(Math.max(freq, 10), sr * 0.49);
  const w = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * Math.max(q, 1e-3));
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (kind) {
    case "lowpass":
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "bandpass": // constant 0 dB peak gain
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1; b1 = -2 * cw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "peak":
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** One biquad, in place (transposed direct form II: good with floats). */
export function biquad(
  buf: Mono,
  sr: number,
  kind: BiquadKind,
  freq: number,
  q = Math.SQRT1_2,
  gainDb = 0,
): Mono {
  const [b0, b1, b2, a1, a2] = biquadCoefficients(kind, sr, freq, q, gainDb);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    buf[i] = y;
  }
  return buf;
}

/** Butterworth section Qs for an even order (2 → one section, 4 → two...). */
function butterworthQs(order: number): number[] {
  const sections = Math.max(1, Math.round(order / 2));
  const qs: number[] = [];
  for (let k = 0; k < sections; k++) {
    qs.push(1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (4 * sections))));
  }
  return qs;
}

/** Butterworth low-pass of ``order`` (1 is a one-pole, even orders are biquad cascades). */
export function lowpass(buf: Mono, sr: number, freq: number, order = 2): Mono {
  if (order === 1) return onePoleLowpass(buf, sr, freq);
  for (const q of butterworthQs(order)) biquad(buf, sr, "lowpass", freq, q);
  return buf;
}

export function highpass(buf: Mono, sr: number, freq: number, order = 2): Mono {
  if (order === 1) return onePoleHighpass(buf, sr, freq);
  for (const q of butterworthQs(order)) biquad(buf, sr, "highpass", freq, q);
  return buf;
}

/** A band between ``low`` and ``high``: a high-pass then a low-pass. */
export function bandpass(buf: Mono, sr: number, low: number, high: number, order = 2): Mono {
  highpass(buf, sr, low, order);
  return lowpass(buf, sr, high, order);
}

export function onePoleLowpass(buf: Mono, sr: number, freq: number): Mono {
  const a = Math.exp((-2 * Math.PI * Math.min(freq, sr * 0.49)) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * buf[i]! + a * y;
    buf[i] = y;
  }
  return buf;
}

export function onePoleHighpass(buf: Mono, sr: number, freq: number): Mono {
  const a = Math.exp((-2 * Math.PI * Math.min(freq, sr * 0.49)) / sr);
  let y = 0;
  let x1 = 0;
  const g = (1 + a) / 2;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    y = g * (x - x1) + a * y;
    x1 = x;
    buf[i] = y;
  }
  return buf;
}

/**
 * A spectral tilt of roughly ``dbPerOctave`` around 1 kHz, from two shelves.
 * Negative darkens (the high end of a distant or muffled sound), positive
 * brightens (a crack, glass).
 */
export function tilt(buf: Mono, sr: number, dbPerOctave: number): Mono {
  if (dbPerOctave === 0) return buf;
  // Two octaves below and two above 1 kHz: the shelves' combined slope
  // approximates a straight tilt over the band that matters.
  biquad(buf, sr, "lowshelf", 250, 0.5, -2 * dbPerOctave);
  biquad(buf, sr, "highshelf", 4000, 0.5, 2 * dbPerOctave);
  return buf;
}

export type Track = number | Float32Array | ((u: number) => number);

function trackAt(track: Track, i: number, n: number): number {
  if (typeof track === "number") return track;
  if (typeof track === "function") return track(i / n);
  return track[Math.min(i, track.length - 1)]!;
}

/**
 * A state-variable filter (Zavalishin's topology-preserving form) whose
 * centre and Q may move per sample. Coefficients are refreshed every
 * ``step`` samples: the tan() is the expensive part and a centre gliding
 * over a few hundred microseconds is inaudibly different from a smooth one.
 * ``mode`` "bp" is normalised to unit peak gain.
 */
export function svf(
  buf: Mono,
  sr: number,
  mode: "lp" | "bp" | "hp",
  freq: Track,
  q: Track = Math.SQRT1_2,
  step = 16,
): Mono {
  const n = buf.length;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0, a2 = 0, a3 = 0, k = 1;
  for (let i = 0; i < n; i++) {
    if (i % step === 0) {
      const f = Math.min(Math.max(trackAt(freq, i, n), 10), sr * 0.45);
      const qq = Math.max(trackAt(q, i, n), 0.05);
      const g = Math.tan((Math.PI * f) / sr);
      k = 1 / qq;
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v0 = buf[i]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = mode === "lp" ? v2 : mode === "bp" ? k * v1 : v0 - k * v1 - v2;
  }
  return buf;
}

/** A static resonance: the input band-passed around ``freq`` and added back at ``amount``. */
export function resonate(buf: Mono, sr: number, freq: number, q: number, amount: number): Mono {
  const band = biquad(Float32Array.from(buf), sr, "bandpass", freq, q);
  for (let i = 0; i < buf.length; i++) buf[i]! += amount * band[i]!;
  return buf;
}

/** Remove the mean and a little sub-audio drift (a one-pole high-pass at 20 Hz). */
export function dcBlock(buf: Mono, sr: number): Mono {
  return onePoleHighpass(buf, sr, 18);
}
