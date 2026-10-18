/**
 * Rooms baked into a sound. Most of the space a sound lives in is added at
 * play time by the engine (the town's reverb and the street's slap-back, see
 * ../routing.ts); this is for the few sounds whose space *is* the sound — a
 * whistle in an empty valley, a stinger's tail, a bell in its tower.
 */
import type { Rng } from "./rng";
import type { Mono } from "./signal";

export interface RoomOptions {
  /** Seconds for the low end to fall 60 dB. */
  t60: number;
  /** How much faster the top dies than the bottom, 0..1 (1: as long). */
  damping?: number;
  /** Delay-line scale: 1 is a large hall, 0.3 a small room. */
  size?: number;
  /** Seconds before the tail begins. */
  predelay?: number;
  /** Wet level relative to the dry. */
  mix?: number;
  /** Extra tail length to render beyond the input, seconds. */
  tail?: number;
}

/**
 * An eight-line feedback delay network: eight mutually prime delays mixed
 * through a Householder matrix (every line feeds every other, energy
 * preserved), each line losing a little per pass and more at the top via a
 * one-pole low-pass. It gives a smooth, dense, frequency-dependent tail for a
 * few dozen operations a sample, and two decorrelated outputs for width.
 */
export function room(input: Mono, sr: number, rng: Rng, o: RoomOptions): [Mono, Mono] {
  const size = o.size ?? 1;
  const mix = o.mix ?? 0.3;
  const pre = Math.round((o.predelay ?? 0.01) * sr);
  const tail = o.tail ?? o.t60;
  const n = input.length + pre + Math.round(tail * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const base = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2797];
  const lens = base.map((b) => Math.max(8, Math.round(b * size * (sr / 44100) * rng.range(0.97, 1.03))));
  const lines = lens.map((len) => new Float32Array(len));
  // Per-line loss for the requested T60 at DC, and the low-pass coefficient
  // that makes the highs die ``damping`` times as long.
  const damping = o.damping ?? 0.4;
  const gains = lens.map((len) => Math.pow(10, (-3 * len) / (sr * o.t60)));
  const lpA = lens.map((len) => {
    const hiGain = Math.pow(10, (-3 * len) / (sr * o.t60 * Math.max(damping, 0.05)));
    const loGain = Math.pow(10, (-3 * len) / (sr * o.t60));
    // A one-pole whose response at Nyquist is hiGain/loGain of its DC response.
    const ratio = hiGain / loGain;
    return (1 - ratio) / (1 + ratio);
  });
  // The eight lines are unrolled into locals: this loop runs for every
  // sample of every stinger, and arrays of arrays indexed per line cost
  // several times more than the arithmetic itself.
  const [d0, d1, d2, d3, d4, d5, d6, d7] = lines as [Mono, Mono, Mono, Mono, Mono, Mono, Mono, Mono];
  const [n0, n1, n2, n3, n4, n5, n6, n7] = lens as [number, number, number, number, number, number, number, number];
  const [g0, g1, g2, g3, g4, g5, g6, g7] = gains as [number, number, number, number, number, number, number, number];
  const [a0, a1, a2, a3, a4, a5, a6, a7] = lpA as [number, number, number, number, number, number, number, number];
  let i0 = 0, i1 = 0, i2 = 0, i3 = 0, i4 = 0, i5 = 0, i6 = 0, i7 = 0;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
  const wet = 0.5 * mix;
  const inLen = input.length;
  for (let i = 0; i < n; i++) {
    const x = i >= pre && i - pre < inLen ? 0.35 * input[i - pre]! : 0;
    s0 = (1 - a0) * g0 * d0[i0]! + a0 * s0;
    s1 = (1 - a1) * g1 * d1[i1]! + a1 * s1;
    s2 = (1 - a2) * g2 * d2[i2]! + a2 * s2;
    s3 = (1 - a3) * g3 * d3[i3]! + a3 * s3;
    s4 = (1 - a4) * g4 * d4[i4]! + a4 * s4;
    s5 = (1 - a5) * g5 * d5[i5]! + a5 * s5;
    s6 = (1 - a6) * g6 * d6[i6]! + a6 * s6;
    s7 = (1 - a7) * g7 * d7[i7]! + a7 * s7;
    // Householder: every line gets its own output minus a quarter of the sum.
    const h = 0.25 * (s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7) - x;
    d0[i0] = s0 - h; d1[i1] = s1 - h; d2[i2] = s2 - h; d3[i3] = s3 - h;
    d4[i4] = s4 - h; d5[i5] = s5 - h; d6[i6] = s6 - h; d7[i7] = s7 - h;
    if (++i0 === n0) i0 = 0;
    if (++i1 === n1) i1 = 0;
    if (++i2 === n2) i2 = 0;
    if (++i3 === n3) i3 = 0;
    if (++i4 === n4) i4 = 0;
    if (++i5 === n5) i5 = 0;
    if (++i6 === n6) i6 = 0;
    if (++i7 === n7) i7 = 0;
    const dry = i < inLen ? input[i]! : 0;
    left[i] = dry + wet * (s0 - s2 + s4 - s6);
    right[i] = dry + wet * (s1 - s3 + s5 - s7);
  }
  return [left, right];
}

/** The mono sum of ``room``, for a sound that stays mono. */
export function roomMono(input: Mono, sr: number, rng: Rng, o: RoomOptions): Mono {
  const [l, r] = room(input, sr, rng, o);
  for (let i = 0; i < l.length; i++) l[i] = 0.5 * (l[i]! + r[i]!);
  return l;
}
