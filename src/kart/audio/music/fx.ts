/**
 * The mixing desk's effects, on whole buffers: a stereo chorus to thicken a
 * part, a ping-pong delay for the leads, a reverb for glue, and the folding
 * that makes a loop seamless.
 *
 * All of them run over a buffer that is longer than the loop (the loop plus a
 * tail) so that what rings on past the last bar is there to be folded back
 * onto the start; see ``fold``.
 */
import { Rng } from "../../../audio/dsp/rng";
import type { Mono } from "../../../audio/dsp/signal";
import { room } from "../../../audio/dsp/space";

/** Equal-power pan gains for -1 (left) .. 1 (right). */
export function panGains(pan: number): [number, number] {
  const p = (Math.max(-1, Math.min(1, pan)) + 1) * 0.25 * Math.PI;
  return [Math.cos(p), Math.sin(p)];
}

/**
 * Stereo chorus on a pair of buffers, in place: each side gets a copy of the
 * other's signal through a short delay that slowly wobbles, which thickens a
 * mono-ish part and spreads it. ``amount`` 0..1 is how much of it is mixed in.
 */
export function chorus(left: Mono, right: Mono, sr: number, amount: number, rate = 0.45): void {
  const n = left.length;
  const base = 0.014 * sr;
  const depth = 0.0025 * sr;
  const size = Math.ceil(base + depth + 4);
  const dl = new Float32Array(size);
  const dr = new Float32Array(size);
  const wl = (2 * Math.PI * rate) / sr;
  const wr = (2 * Math.PI * rate * 1.13) / sr;
  let pl = 0;
  let pr = 1.7;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i]!;
    const r = right[i]!;
    dl[w] = l;
    dr[w] = r;
    // Fractional taps, linear.
    const tl = base + depth * Math.sin(pl);
    const tr = base + depth * Math.sin(pr);
    const readL = w - tl;
    const readR = w - tr;
    const il = Math.floor(readL);
    const ir = Math.floor(readR);
    const fl = readL - il;
    const fr = readR - ir;
    const a = dr[((il % size) + size) % size]!;
    const b = dr[(((il + 1) % size) + size) % size]!;
    const c = dl[((ir % size) + size) % size]!;
    const d = dl[(((ir + 1) % size) + size) % size]!;
    left[i] = l + amount * 0.7 * (a + (b - a) * fl);
    right[i] = r + amount * 0.7 * (c + (d - c) * fr);
    pl += wl;
    pr += wr;
    w = w + 1 === size ? 0 : w + 1;
  }
}

/**
 * A ping-pong delay: ``input`` (mono) echoes alternately left and right,
 * ``delaySamples`` apart, each repeat ``feedback`` as loud and darker (a
 * one-pole low-pass at ``tone`` Hz in the loop). Only the echoes are returned,
 * so the dry sound stays where it was.
 */
export function pingPong(input: Mono, sr: number, delaySamples: number, feedback: number, tone: number): [Mono, Mono] {
  const n = input.length;
  const d = Math.max(1, Math.round(delaySamples));
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * tone) / sr);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i++) {
    const x = i >= d ? input[i - d]! : 0;
    // The left echo is fed by the input and the right echo's return; the right by the left.
    const fromRight = i >= d ? right[i - d]! : 0;
    const fromLeft = i >= d ? left[i - d]! : 0;
    lpL = (1 - a) * (x + feedback * fromRight) + a * lpL;
    lpR = (1 - a) * (feedback * fromLeft) + a * lpR;
    left[i] = lpL;
    right[i] = lpR;
  }
  return [left, right];
}

/**
 * A reverb over a mono send: the eight-line feedback network of
 * ../../../audio/dsp/space.ts, returned as a wet-only stereo pair that is
 * ``extra`` seconds longer than the input (its tail, to be folded).
 */
export function reverb(send: Mono, sr: number, rng: Rng, t60: number, size: number, extra: number): [Mono, Mono] {
  const [l, r] = room(send, sr, rng, { t60, size, damping: 0.35, predelay: 0.012, mix: 1, tail: extra });
  // ``room`` returns dry + wet; the dry is taken back out, leaving the wet alone.
  for (let i = 0; i < send.length; i++) {
    l[i]! -= send[i]!;
    r[i]! -= send[i]!;
  }
  return [l, r];
}

/**
 * Makes a rendered buffer loop: everything past ``length`` samples is added
 * back onto the start (wrapping as often as it takes) and the buffer cut to
 * ``length``. Because the notes, the reverb and the echoes of the last bars
 * were all rendered onto the end, this is what the music would have sounded
 * like had it been playing forever — and so the seam is not there.
 */
export function fold(buf: Mono, length: number): Mono {
  const out = new Float32Array(length);
  for (let i = 0; i < buf.length; i++) out[i % length]! += buf[i]!;
  return out;
}

/** Remove the mean (a loop's DC, which a high-pass with memory would turn into a click at the seam). */
export function removeMean(buf: Mono): void {
  let mean = 0;
  for (let i = 0; i < buf.length; i++) mean += buf[i]!;
  mean /= buf.length;
  for (let i = 0; i < buf.length; i++) buf[i]! -= mean;
}

/** RMS over a stereo pair (both channels together), linear. */
export function stereoRms(left: Mono, right: Mono): number {
  let s = 0;
  for (let i = 0; i < left.length; i++) s += left[i]! * left[i]! + right[i]! * right[i]!;
  return Math.sqrt(s / (2 * left.length));
}

export function peakOf(left: Mono, right: Mono): number {
  let p = 0;
  for (let i = 0; i < left.length; i++) p = Math.max(p, Math.abs(left[i]!), Math.abs(right[i]!));
  return p;
}

/** A smooth peak limiter in place: linear below ``knee``, bent toward (never reaching) ``ceiling`` above. */
export function softLimit(buf: Mono, knee: number, ceiling: number): void {
  const span = ceiling - knee;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const m = Math.abs(x);
    if (m > knee) buf[i] = (x < 0 ? -1 : 1) * (knee + span * Math.tanh((m - knee) / span));
  }
}
