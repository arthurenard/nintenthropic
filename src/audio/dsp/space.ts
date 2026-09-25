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
  const idx = new Array<number>(8).fill(0);
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
  const lpState = new Float64Array(8);
  const outs = new Float64Array(8);
  const signs = [1, -1, 1, -1, 1, 1, -1, -1];
  for (let i = 0; i < n; i++) {
    const x = i >= pre && i - pre < input.length ? input[i - pre]! : 0;
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const v = lines[k]![idx[k]!]!;
      const a = lpA[k]!;
      lpState[k] = (1 - a) * v * gains[k]! + a * lpState[k]!;
      outs[k] = lpState[k]!;
      sum += outs[k]!;
    }
    // Householder: y = x - (2/N) * sum(x)
    const h = (2 / 8) * sum;
    let l = 0;
    let r = 0;
    for (let k = 0; k < 8; k++) {
      const fed = outs[k]! - h + x * 0.35;
      const line = lines[k]!;
      line[idx[k]!] = fed;
      idx[k] = idx[k]! + 1 === line.length ? 0 : idx[k]! + 1;
      if (k % 2 === 0) l += signs[k]! * outs[k]!;
      else r += signs[k]! * outs[k]!;
    }
    const dry = i < input.length ? input[i]! : 0;
    left[i] = dry + mix * l * 0.5;
    right[i] = dry + mix * r * 0.5;
  }
  return [left, right];
}

/** The mono sum of ``room``, for a sound that stays mono. */
export function roomMono(input: Mono, sr: number, rng: Rng, o: RoomOptions): Mono {
  const [l, r] = room(input, sr, rng, o);
  for (let i = 0; i < l.length; i++) l[i] = 0.5 * (l[i]! + r[i]!);
  return l;
}
