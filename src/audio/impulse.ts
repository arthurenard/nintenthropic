/**
 * The town's reverb, as an impulse response synthesised in code (the engine
 * loads it into a ConvolverNode). Dust Creek is outdoors: wooden fronts
 * either side and open sky above, so its reverb is short and a little
 * sparse — a quick cluster of early reflections off the boards and a diffuse
 * tail whose top dies much faster than its bottom — not a hall. The discrete
 * slap-back off the facades is done separately and exactly (routing.ts).
 */
import { bandpass, lowpass } from "./dsp/filters";
import { Rng } from "./dsp/rng";

export interface ImpulseOptions {
  seconds?: number;
  /** T60 of the low, middle and top bands, seconds. */
  t60?: [number, number, number];
  seed?: number;
}

/** Two decorrelated channels, energy-normalised to 1. */
export function townImpulse(sr: number, o: ImpulseOptions = {}): [Float32Array, Float32Array] {
  const seconds = o.seconds ?? 1.6;
  const [tLow, tMid, tHigh] = o.t60 ?? [1.3, 0.95, 0.4];
  const n = Math.round(seconds * sr);
  const rng = new Rng(o.seed ?? 0x70b1);
  const out: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const r = rng.fork(c);
    const ch = new Float32Array(n);
    // The diffuse tail: three bands of noise, each with its own decay, and a
    // build-up over the first 20 ms (diffusion takes time to develop).
    const bands: [number, number, number][] = [[40, 350, tLow], [350, 3000, tMid], [3000, 14000, tHigh]];
    for (const [lo, hi, t60] of bands) {
      const b = bandpass(r.fill(new Float32Array(n)), sr, lo, hi, 2);
      const k = Math.exp(-6.9 / (t60 * sr));
      let e = 1;
      for (let i = 0; i < n; i++) {
        const build = Math.min(1, i / (0.02 * sr));
        ch[i]! += b[i]! * e * build * build;
        e *= k;
      }
    }
    // Early reflections: a dozen taps in the first 70 ms, off porches,
    // posts and the ground, each a little duller than the last.
    for (let k = 0; k < 12; k++) {
      const at = Math.round((0.004 + 0.066 * Math.pow(r.next(), 1.3)) * sr);
      const gain = 0.6 * (1 - k / 14) * r.range(0.4, 1) * r.sign();
      const tap = lowpass(r.fill(new Float32Array(Math.round(0.0015 * sr))), sr, r.range(2500, 9000), 2);
      for (let i = 0; i < tap.length && at + i < n; i++) ch[at + i]! += gain * tap[i]! * (1 - i / tap.length) * 4;
    }
    // Ease the last 10 %: the tail is already 40 dB down there.
    const ease = Math.round(n * 0.1);
    for (let i = 0; i < ease; i++) ch[n - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / ease);
    out.push(ch);
  }
  let energy = 0;
  for (const ch of out) for (let i = 0; i < n; i++) energy += ch[i]! * ch[i]!;
  const norm = 1 / Math.sqrt(energy / 2);
  for (const ch of out) for (let i = 0; i < n; i++) ch[i]! *= norm;
  return [out[0]!, out[1]!];
}
