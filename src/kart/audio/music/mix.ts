/**
 * The mixing desk's dynamics and stereo tools, on whole buffers: a compressor
 * (for a part and for the bus), the pumping duck that a kick drum gives the
 * bass and pads, a rotary speaker, a tremolo, mid/side width and a look-ahead
 * limiter that works round a loop so the seam is as clean as any other place.
 *
 * Like the rest of the DSP: plain Float32Arrays, no Web Audio.
 */
import type { Mono } from "../../../audio/dsp/signal";
import { softClip } from "../../../audio/dsp/voices";

const TAU = 2 * Math.PI;
const BLOCK = 16;

export interface CompSpec {
  /** dBFS above which the part is turned down. */
  threshold: number;
  ratio: number;
  /** Seconds. */
  attack: number;
  release: number;
  /** dB added after, to make the loudness back. */
  makeup?: number;
  /** Soft knee width, dB (default 6). */
  knee?: number;
}

/**
 * A feed-forward stereo-linked compressor. The gain is worked out every 16
 * samples from the loudest sample in the block, smoothed with the attack and
 * release, and ramped between blocks; with ``circular`` its state is first
 * warmed on the last half second, so a loop's start is compressed as it would
 * have been had the music been playing round and round.
 */
export function compress(left: Mono, right: Mono, sr: number, spec: CompSpec, circular = false): void {
  const n = left.length;
  const knee = spec.knee ?? 6;
  const makeup = Math.pow(10, (spec.makeup ?? 0) / 20);
  const blockT = BLOCK / sr;
  const aAtt = Math.exp(-blockT / Math.max(blockT, spec.attack));
  const aRel = Math.exp(-blockT / Math.max(blockT, spec.release));
  let gr = 0; // gain reduction in dB (>= 0), smoothed
  const reduction = (peak: number): number => {
    const db = 20 * Math.log10(Math.max(peak, 1e-6));
    const over = db - spec.threshold;
    let r: number;
    if (2 * over < -knee) r = 0;
    else if (2 * Math.abs(over) <= knee) r = (1 - 1 / spec.ratio) * ((over + knee / 2) ** 2) / (2 * knee);
    else r = (1 - 1 / spec.ratio) * over;
    return r;
  };
  const peakIn = (from: number, to: number): number => {
    let p = 0;
    for (let i = from; i < to; i++) p = Math.max(p, Math.abs(left[i]!), Math.abs(right[i]!));
    return p;
  };
  const step = (target: number): void => {
    gr = target > gr ? aAtt * gr + (1 - aAtt) * target : aRel * gr + (1 - aRel) * target;
  };
  if (circular) {
    const from = Math.max(0, n - Math.round(0.5 * sr));
    for (let s = from; s < n; s += BLOCK) step(reduction(peakIn(s, Math.min(n, s + BLOCK))));
  }
  let prevGain = Math.pow(10, -gr / 20) * makeup;
  for (let s = 0; s < n; s += BLOCK) {
    const end = Math.min(n, s + BLOCK);
    step(reduction(peakIn(s, end)));
    const gain = Math.pow(10, -gr / 20) * makeup;
    const len = end - s;
    for (let i = 0; i < len; i++) {
      const g = prevGain + ((gain - prevGain) * (i + 1)) / len;
      left[s + i]! *= g;
      right[s + i]! *= g;
    }
    prevGain = gain;
  }
}

/**
 * The pump: a gain envelope that dips at each of ``times`` (a kick drum, in
 * seconds) by ``depth`` (0..1) and swells back, the way a pad breathes under
 * a four-on-the-floor kick.
 */
export function pumpEnvelope(length: number, sr: number, times: readonly number[], depth: number, release = 0.16, attack = 0.006): Float32Array {
  const env = new Float32Array(length).fill(1);
  const tail = Math.round((attack + release * 3.2) * sr);
  const attackN = Math.max(1, Math.round(attack * sr));
  for (const t of times) {
    const start = Math.round(t * sr);
    for (let k = 0; k < tail; k++) {
      const i = start + k;
      if (i < 0 || i >= length) continue;
      const dip = k < attackN ? k / attackN : Math.exp(-(k - attackN) / (release * 0.45 * sr));
      const g = 1 - depth * (k < attackN ? dip : dip);
      if (g < env[i]!) env[i] = g;
    }
  }
  return env;
}

/**
 * A rotating speaker on a part: the horn's turn moves the sound between the
 * ears and bends its pitch a hair (a swept short delay), as an organ's does.
 * ``rate`` Hz (slow ~0.7, fast ~6.5), ``depth`` 0..1.
 */
export function rotary(left: Mono, right: Mono, sr: number, rate: number, depth: number): void {
  const n = left.length;
  const size = Math.ceil(0.004 * sr) + 4;
  const dl = new Float32Array(size);
  const dr = new Float32Array(size);
  const w = (TAU * rate) / sr;
  let ph = 0;
  let wi = 0;
  const base = 0.0016 * sr;
  const swing = 0.0012 * sr * depth;
  for (let i = 0; i < n; i++) {
    const m = 0.5 * (left[i]! + right[i]!);
    dl[wi] = m;
    dr[wi] = m;
    const sl = Math.sin(ph);
    const sr2 = Math.sin(ph + Math.PI);
    const tap = (buf: Float32Array, d: number): number => {
      let rd = wi - d;
      if (rd < 0) rd += size;
      let i0 = Math.floor(rd);
      // (A tap a hair behind zero rounds up to the buffer's size: it belongs at the start.)
      if (i0 >= size) i0 -= size;
      const f = rd - Math.floor(rd);
      const i1 = i0 + 1 === size ? 0 : i0 + 1;
      return buf[i0]! * (1 - f) + buf[i1]! * f;
    };
    left[i] = tap(dl, base + swing * sl) * (1 - depth * 0.5 * (0.5 + 0.5 * sl)) * 1.1;
    right[i] = tap(dr, base + swing * sr2) * (1 - depth * 0.5 * (0.5 + 0.5 * Math.sin(ph + Math.PI))) * 1.1;
    ph += w;
    wi = wi + 1 === size ? 0 : wi + 1;
  }
}

/** Tremolo, optionally as an auto-pan (the two sides out of step): rate Hz, depth 0..1. */
export function tremolo(left: Mono, right: Mono, sr: number, rate: number, depth: number, pan = false): void {
  const w = (TAU * rate) / sr;
  for (let i = 0; i < left.length; i++) {
    const s = 0.5 + 0.5 * Math.sin(i * w);
    left[i]! *= 1 - depth * s;
    right[i]! *= 1 - depth * (pan ? 1 - s : s);
  }
}

/** Mid/side width: 1 as it was, 0 mono, over 1 wider. */
export function widen(left: Mono, right: Mono, width: number): void {
  for (let i = 0; i < left.length; i++) {
    const m = 0.5 * (left[i]! + right[i]!);
    const s = 0.5 * (left[i]! - right[i]!) * width;
    left[i] = m + s;
    right[i] = m - s;
  }
}

/** A gentle tape-like saturation in place: odd harmonics creep in as the level rises. */
export function saturate(buf: Mono, amount: number): void {
  const k = amount;
  const norm = 1 / softClip(k);
  for (let i = 0; i < buf.length; i++) buf[i] = softClip(buf[i]! * k) * norm;
}

/**
 * A look-ahead brick-wall limiter that treats the buffer as a loop: the gain
 * needed to hold each sample under ``ceiling`` is spread over the samples
 * before it (``look`` seconds) so no peak is clipped and no click is made,
 * and it lets go over ``release`` seconds. Returns the deepest reduction, dB.
 */
export function limit(left: Mono, right: Mono, sr: number, ceiling: number, look = 0.003, release = 0.08): number {
  // The gain is worked out on blocks of eight samples and drawn between them: eight times cheaper, and no sample gets through,
  // because every block's gain is held under the need of the blocks on either side of it.
  const B = 8;
  const n = left.length;
  const m = Math.ceil(n / B);
  const need = new Float32Array(m).fill(1);
  for (let b = 0; b < m; b++) {
    const end = Math.min(n, (b + 1) * B);
    let p = 0;
    for (let i = b * B; i < end; i++) p = Math.max(p, Math.abs(left[i]!), Math.abs(right[i]!));
    if (p > ceiling) need[b] = ceiling / p;
  }
  const gain = gainFor(need, sr / B, look, release);
  let deepest = 1;
  for (let b = 0; b < m; b++) {
    const g0 = gain[b]!;
    const g1 = gain[b + 1 === m ? 0 : b + 1]!;
    if (g0 < deepest) deepest = g0;
    const end = Math.min(n, (b + 1) * B);
    for (let i = b * B; i < end; i++) {
      const g = g0 + ((g1 - g0) * (i - b * B)) / B;
      left[i]! *= g;
      right[i]! *= g;
    }
  }
  return -20 * Math.log10(deepest);
}

/** The gain curve that holds a loop of per-block needs (1 = nothing needed), see ``limit``. */
function gainFor(need: Float32Array, sr: number, look: number, release: number): Float32Array {
  const n = need.length;
  const L = Math.max(2, Math.round(look * sr));
  // Sliding minimum over ±L, round the loop (a monotonic deque over the buffer with L samples of its far end in front of it).
  const ext = new Float32Array(n + 2 * L);
  for (let k = 0; k < ext.length; k++) ext[k] = need[(((k - L) % n) + n) % n]!;
  const centred = new Float32Array(n);
  const dq = new Int32Array(ext.length);
  let head = 0;
  let tail = 0;
  for (let j = 0; j < ext.length; j++) {
    while (tail > head && ext[dq[tail - 1]!]! >= ext[j]!) tail--;
    dq[tail++] = j;
    const i = j - 2 * L;
    if (i >= 0) {
      while (dq[head]! < i) head++;
      centred[i] = ext[dq[head]!]!;
    }
  }
  // Boxcar smoothing of width L+1 keeps the gain at or under the need while taking the corners off.
  const half = Math.max(1, L >> 1);
  const smooth = new Float32Array(n);
  let acc = 0;
  for (let k = -half; k <= half; k++) acc += centred[((k % n) + n) % n]!;
  for (let i = 0; i < n; i++) {
    smooth[i] = acc / (2 * half + 1);
    acc += centred[(i + half + 1) % n]! - centred[(((i - half) % n) + n) % n]!;
  }
  // Release: after a dip the gain climbs back at a set rate, never above the smoothed need. Two laps so the loop's start knows about its end.
  const rel = Math.exp(-1 / Math.max(1, release * sr));
  let g = 1;
  const gain = new Float32Array(n);
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < n; i++) {
      g = Math.min(smooth[i]!, 1 - (1 - g) * rel);
      if (lap === 1) gain[i] = g;
    }
  }
  return gain;
}
