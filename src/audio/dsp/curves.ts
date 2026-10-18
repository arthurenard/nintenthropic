/**
 * Curves over u = 0..1, and the one pitch conversion: the small arithmetic
 * recipes in every pack reach for when they shape a gesture over time.
 */

/** A value over u = 0..1: a pitch track, a formant's glide, an envelope. */
export type Curve = (u: number) => number;

/** ``a`` to ``b`` as u goes 0..1, held at either end beyond it. */
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * Math.min(1, Math.max(0, u));

/** A smoothstep of u clamped to 0..1: the soft edge of a swell or a fade. */
export const smooth = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** The frequency of MIDI note ``m`` (69 is A4, 440 Hz); fractional notes are cents between. */
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A curve sampled into an array every ``step`` samples and interpolated
 * linearly between: envelopes and pitch tracks are slow, and calling a
 * closure per sample is not free.
 */
export function sampled(n: number, fn: Curve, step = 32): Float32Array {
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
