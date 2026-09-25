/**
 * Buffers, envelopes and mixing: the plumbing every recipe uses.
 *
 * Everything works in place on Float32Arrays where it can, because the whole
 * library is synthesised at load time and allocation is a real share of that
 * cost. Times are in seconds at the edges of the API and in samples inside.
 */

export type Mono = Float32Array;
/** One or two channels; recipes return mono unless width matters (wind). */
export type Channels = Mono[];

export function samples(sr: number, seconds: number): number {
  return Math.max(1, Math.round(seconds * sr));
}

/** Add ``src`` into ``dst`` starting ``at`` seconds in, clipped to fit. */
export function place(dst: Mono, src: Mono, at: number, sr: number, gain = 1): void {
  const start = Math.round(at * sr);
  if (start >= dst.length || gain === 0) return;
  const from = start < 0 ? -start : 0;
  const end = Math.min(src.length, dst.length - start);
  for (let i = from; i < end; i++) dst[start + i]! += gain * src[i]!;
}

export function scale(buf: Mono, gain: number): Mono {
  for (let i = 0; i < buf.length; i++) buf[i]! *= gain;
  return buf;
}

export function peak(buf: Mono): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]!);
    if (v > p) p = v;
  }
  return p;
}

export function rms(buf: Mono, from = 0, to = buf.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Scale to a unit (or given) peak; silence stays silence. */
export function normalize(buf: Mono, to = 1): Mono {
  const p = peak(buf);
  return p > 0 ? scale(buf, to / p) : buf;
}

export function db(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

export function toDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-12));
}

/**
 * A percussive envelope applied in place: a short rise (so the ear hears an
 * edge, not a click) then a pure exponential. The last 10 % eases out, so a
 * layer cut mid-decay leaves no step.
 */
export function perc(buf: Mono, sr: number, attack: number, decay: number): Mono {
  const n = buf.length;
  const a = Math.max(1, attack * sr);
  const k = Math.exp(-1 / Math.max(1, decay * sr));
  const easeFrom = Math.floor(n * 0.9);
  let e = 1;
  for (let i = 0; i < n; i++) {
    let g = e;
    if (i < a) g *= i / a;
    if (i >= easeFrom) g *= 0.5 + 0.5 * Math.cos((Math.PI * (i - easeFrom)) / Math.max(1, n - easeFrom));
    buf[i]! *= g;
    e *= k;
  }
  return buf;
}

/**
 * Attack / decay / sustain / release over the whole buffer, in place. The
 * attack is a gentle power curve, the decay exponential toward the sustain,
 * the release a raised cosine to zero at the very end.
 */
export function adsr(
  buf: Mono,
  sr: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
): Mono {
  const n = buf.length;
  const a = Math.max(1, attack * sr);
  const k = Math.exp(-3 / Math.max(1, decay * sr));
  const r = Math.max(1, release * sr);
  let fall = 1;
  for (let i = 0; i < n; i++) {
    let g: number;
    if (i < a) {
      g = Math.pow(i / a, 0.7);
    } else {
      g = sustain + (1 - sustain) * fall;
      fall *= k;
    }
    const left = n - 1 - i;
    if (left < r) g *= 0.5 - 0.5 * Math.cos((Math.PI * left) / r);
    buf[i]! *= g;
  }
  return buf;
}

/** Raised-cosine fades at either end, in place. */
export function fade(buf: Mono, sr: number, fadeIn: number, fadeOut: number): Mono {
  const n = buf.length;
  const fi = Math.min(n, Math.round(fadeIn * sr));
  const fo = Math.min(n, Math.round(fadeOut * sr));
  for (let i = 0; i < fi; i++) buf[i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
  for (let i = 0; i < fo; i++) buf[n - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  return buf;
}

/** Multiply by a curve given per sample: ``shape(u)`` with u = 0..1 over the buffer. */
export function shapeBy(buf: Mono, shape: (u: number) => number, step = 32): Mono {
  const n = buf.length;
  // The curve is evaluated every ``step`` samples and interpolated between:
  // envelopes are slow, and calling a closure per sample is not free.
  let prev = shape(0);
  for (let i = 0; i < n; i += step) {
    const j = Math.min(n, i + step);
    const next = shape(j / n);
    for (let k = i; k < j; k++) buf[k]! *= prev + ((next - prev) * (k - i)) / step;
    prev = next;
  }
  return buf;
}

/** A slow random wobble in [-1, 1]: noise sampled at ``rate`` Hz and smoothly interpolated. */
export function wobble(n: number, sr: number, rate: number, next: () => number): Mono {
  const out = new Float32Array(n);
  const hop = Math.max(2, Math.round(sr / Math.max(rate, 0.01)));
  let a = 2 * next() - 1;
  let b = 2 * next() - 1;
  for (let i = 0; i < n; i++) {
    const k = i % hop;
    if (k === 0 && i > 0) {
      a = b;
      b = 2 * next() - 1;
    }
    const u = k / hop;
    const s = u * u * (3 - 2 * u);
    out[i] = a + (b - a) * s;
  }
  return out;
}

/** Sum of channels to one (for measurements). */
export function mixdown(channels: Channels): Mono {
  const first = channels[0]!;
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / channels.length;
  return out;
}
