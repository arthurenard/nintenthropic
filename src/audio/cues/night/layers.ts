/**
 * Layers the night's sounds share: the dead's throat (``vocal``), a nearly
 * pure voice and the breath on it, the dry noises of the farm (corn leaves,
 * sand, grit), the rifle's steel and brass, the stereo and loop helpers, a
 * cycle of mains buzz, and ``halfRate``, which synthesises a recipe at half
 * the rate.
 */
import { type Curve, sampled } from "../../dsp/curves";
import { svf } from "../../dsp/filters";
import type { Rng } from "../../dsp/rng";
import { type Mono, adsr, fade, normalize, shapeBy, wobble } from "../../dsp/signal";
import { addMetal, addMode, bandNoise, click, decayInPlace, formants, glottal, white } from "../../dsp/sources";
import { Take } from "../../dsp/take";
import { burst, wanderTrack } from "../kit";

export interface VocalOptions {
  /** Fundamental in Hz over u = 0..1. */
  f0: Curve;
  /** How much of the source is voice (1) versus breath alone (0). */
  voicing?: Curve;
  /** Resonances: centre (Hz) over u, a Q and a level. */
  tract: { f: Curve; q: number; amp: number }[];
  jitter?: number;
  shimmer?: number;
  /** Pressed (1) or slack (0) folds. */
  tension?: Curve;
  /** Level over u (an envelope). */
  level?: Curve;
  /** Extra breath riding on the voice, 0..1. */
  breath?: number;
  /** Period-doubling roughness, 0..1: the false folds growling at half the pitch. */
  rasp?: number;
  /** Liquid in the throat: the resonances wobbling by up to this fraction, ``wetRate`` times a second. */
  wet?: number;
  wetRate?: number;
  /** A rattle: the level fluttering irregularly about ``rate`` times a second, by up to ``depth``. */
  flutter?: { rate: number; depth: number };
}

/**
 * One vocal gesture ``seconds`` long: a throat (glottal pulses with jitter,
 * shimmer and breath, or breath alone) through a vocal tract of moving
 * resonances. The same pattern as the creatures' voices, with a wet throat
 * and a rattle added, because a dead man's voice has both. Not shared with
 * them or with the ridge's: the growl's shape, the wet throat and the closing
 * normalise differ, and each pack's takes are tuned to its own.
 */
export function vocal(t: Take, seconds: number, o: VocalOptions): Mono {
  const n = t.n(seconds);
  const f0 = sampled(n, o.f0);
  const voice = glottal(n, t.sr, t.rng, f0, {
    jitter: o.jitter ?? 0.02,
    shimmer: o.shimmer ?? 0.1,
    breath: o.breath ?? 0.08,
    tension: o.tension ? sampled(n, o.tension) : 0.5,
  });
  normalize(voice);
  const air = white(n, t.rng);
  const voicing = sampled(n, o.voicing ?? (() => 1));
  const level = sampled(n, o.level ?? (() => 1));
  const flutter = o.flutter ? wobble(n, t.sr, o.flutter.rate, () => t.rng.next()) : null;
  const depth = o.flutter?.depth ?? 0;
  const rasp = o.rasp ?? 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const v = voicing[i]!;
    let s = voice[i]!;
    if (rasp > 0) {
      // Every other cycle weaker: a subharmonic growl under the voice (a
      // parabola over two cycles, which is all the shape this needs).
      ph += f0[i]! / (2 * t.sr);
      if (ph >= 1) ph -= 1;
      s *= 1 - rasp * 4 * ph * (1 - ph);
    }
    let g = level[i]!;
    if (flutter) g *= 1 - depth + depth * Math.abs(flutter[i]!);
    voice[i] = (s * v + air[i]! * 0.5 * (1 - v)) * g;
  }
  let tract = o.tract;
  if (o.wet) {
    const walk = wanderTrack(n, t.rng, o.wetRate ?? 11, t.sr);
    const w = o.wet;
    tract = tract.map((f) => ({ ...f, f: (u: number) => f.f(u) * (1 + w * (2 * walk(u) - 1)) }));
  }
  const out = formants(voice, t.sr, tract.map((f) => ({ freq: f.f, q: f.q, amp: f.amp })));
  // Whatever the level curve does, a gesture starts and ends at silence.
  // Unit peak, so a voice and the breath layered on it mix at the gains the
  // recipe names (voiced and unvoiced tracts come out at very different levels).
  return normalize(fade(out, t.sr, 0.004, 0.012));
}

/**
 * A nearly pure voice — a whistle, an owl's hoot, a wolf — on a pitch track
 * at a level track: a sine and its second and third harmonics, the
 * harmonics from the same sine and cosine (a sine per sample, not three).
 */
export function tone(t: Take, freq: Float32Array, level: Float32Array, h2: number, h3: number): Mono {
  const n = freq.length;
  const out = new Float32Array(n);
  const k = (2 * Math.PI) / t.sr;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    out[i] = level[i]! * (s + h2 * 2 * s * c + h3 * s * (3 - 4 * s * s));
    ph += k * freq[i]!;
    if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
  }
  return out;
}

/** Breath riding a tone: noise tuned tightly round its pitch, at its level. */
export function breathOn(t: Take, freq: Float32Array, level: Float32Array, q: number): Mono {
  const buf = svf(white(freq.length, t.rng), t.sr, "bp", freq, q, 16);
  normalize(buf);
  for (let i = 0; i < buf.length; i++) buf[i]! *= level[i]!;
  return buf;
}

/** Dry corn leaves rubbing and catching: bright noise gated by squared fast noise, so it crackles rather than hisses. */
export function leafRasp(t: Take, seconds: number, rate: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, 1400, t.c(8000), 2);
  const flick = wobble(n, t.sr, rate, () => t.rng.next());
  for (let i = 0; i < n; i++) buf[i]! *= flick[i]! * flick[i]!;
  return normalize(buf);
}

/** Sand running out of a hole: a hiss of grains, each a tiny tick, thinning as it empties. */
export function sandTrickle(t: Take, seconds: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, 2200, t.c(9000), 2);
  const grain = wobble(n, t.sr, 260, () => t.rng.next());
  for (let i = 0; i < n; i++) {
    const g = Math.abs(grain[i]!);
    buf[i]! *= g * g * g;
  }
  normalize(buf);
  return shapeBy(buf, (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.6));
}

/** Something dragged over grit: a band of friction noise, catching and letting go, swelling and dying. */
export function scrape(t: Take, seconds: number, centre: number, grain: number): Mono {
  const n = t.n(seconds);
  const buf = white(n, t.rng);
  svf(buf, t.sr, "bp", (u) => centre * (0.85 + 0.3 * u), 1.1, 32);
  const g = wobble(n, t.sr, grain, () => t.rng.next());
  for (let i = 0; i < n; i++) {
    const v = Math.abs(g[i]!);
    buf[i]! *= 0.35 + 0.65 * v * v;
  }
  normalize(buf);
  return shapeBy(buf, (u) => Math.pow(Math.sin(Math.PI * u), 0.7) * (1 - 0.35 * u));
}

/** A bolt sliding in the receiver: steel on steel, a short band of noise sweeping as it travels. */
export function slide(t: Take, seconds: number, from: number, to: number): Mono {
  const buf = white(t.n(seconds), t.rng);
  svf(buf, t.sr, "bp", (u) => (from + (to - from) * u) * t.p, 3, 16);
  normalize(buf);
  return adsr(buf, t.sr, seconds * 0.3, seconds * 0.4, 0.6, seconds * 0.25);
}

/** A steel clack: the lever or the bolt meeting its stop — a click, a hard band of noise, a short ring, the stock's knock. */
export function clack(out: Mono, t: Take, at: number, base: number, gain: number, weight: number): void {
  const r = t.rng;
  t.put(out, click(t.sr, r, 0.003, base * 0.5, t.c(12000)), at, gain * 0.8);
  const body = bandNoise(t.n(0.025), t.sr, r, 250, t.c(7000), 2);
  svf(body, t.sr, "bp", base * 0.5, 2.2);
  normalize(body);
  decayInPlace(body, t.sr, 0.0002, 0.005);
  t.put(out, body, at, gain * weight);
  addMetal(out, t.sr, r, at, base, t.d(0.012), gain * 0.7, [1, 1.5, 2.2, 2.9]);
  t.put(out, burst(t, 0.04, 120, 900, 0.0005, 0.006, 2), at, gain * 0.45 * weight);
}

/**
 * A spent .30-30 case landing on the asphalt: a thin brass tube, so a clear
 * high ring each time it touches, bouncing lower and quicker, then a little
 * rolling tick.
 */
export function brassCase(out: Mono, t: Take, at: number, gain: number): void {
  const r = t.rng;
  const f = r.range(3600, 4600) * t.p;
  let when = at;
  let g = gain;
  let gap = r.range(0.07, 0.1);
  const bounces = r.int(3, 5);
  for (let k = 0; k < bounces; k++) {
    addMode(out, t.sr, when, f * r.range(0.997, 1.003), g, 0.03 * r.range(0.8, 1.2), 0);
    addMode(out, t.sr, when, f * 1.52, g * 0.4, 0.018, 0);
    addMode(out, t.sr, when, f * 2.74, g * 0.25, 0.01, 0);
    t.put(out, click(t.sr, r, 0.0015, 2500, 14000), when, g * 0.5);
    when += gap;
    gap *= r.range(0.55, 0.7);
    g *= r.range(0.45, 0.65);
  }
  for (let k = 0; k < 2; k++) addMode(out, t.sr, when + k * r.range(0.02, 0.04), f * r.range(0.99, 1.01), g * 0.4, 0.008, 0);
}

/** A two-pole resonator driven by ``ex`` and added into ``out``: one mode struck by every impulse in the excitation. */
export function ringInto(out: Mono, ex: Mono, sr: number, freq: number, tau: number, amp: number, last = ex.length): void {
  if (freq <= 0 || freq >= sr * 0.49) return;
  const w = (2 * Math.PI * freq) / sr;
  const rr = Math.exp(-1 / Math.max(1, tau * sr));
  const c = 2 * rr * Math.cos(w);
  const r2 = rr * rr;
  const g = amp * Math.sin(w);
  const end = Math.min(out.length, last + Math.ceil(tau * sr * 9.2));
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < end; i++) {
    const y = g * (ex[i] ?? 0) + c * y1 - r2 * y2;
    y2 = y1;
    y1 = y;
    out[i]! += y;
  }
}

/** Equal-power gains for a place in the stereo field, p = −1 (left) .. 1 (right). */
export function panGains(p: number): [number, number] {
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** A seamless loop turned round by ``shift`` samples: still seamless, and a moment behind itself. */
export function turned(buf: Mono, shift: number): Mono {
  const n = buf.length;
  const s = ((shift % n) + n) % n;
  const out = new Float32Array(n);
  out.set(buf.subarray(n - s), 0);
  out.set(buf.subarray(0, n - s), s);
  return out;
}

/** A soft thud on the road: the low mass of a foot or a body, and the scuff of its edge. */
export function footfall(out: Mono, t: Take, at: number, gain: number, weight = 1): void {
  t.put(out, burst(t, 0.12, 45, 300 * t.p, 0.003, 0.022 * weight, 4), at, gain);
  t.put(out, burst(t, 0.03, 700, 4500, 0.001, 0.006), at, gain * 0.3);
}

/**
 * One cycle of a mains buzz, ``P`` samples long (a whole number, so it tiles
 * exactly): harmonics of the cycle falling off by ``slope``, with a hump
 * where the fixture's housing rings, each harmonic its own level and phase.
 */
export function buzzCycle(P: number, r: Rng, sr: number, count: number, hump: number, width: number, slope: number): Float32Array {
  const out = new Float32Array(P);
  const f1 = sr / P;
  for (let k = 1; k <= count && f1 * k < sr * 0.45; k++) {
    const f = f1 * k;
    const a = Math.pow(k, -slope) * (1 + 2 * Math.exp(-(((f - hump) / width) ** 2))) * Math.pow(10, r.range(-4, 4) / 20);
    const ph = r.range(0, 2 * Math.PI);
    const w = (2 * Math.PI * k) / P;
    for (let i = 0; i < P; i++) out[i]! += a * Math.sin(w * i + ph);
  }
  return normalize(out);
}

/**
 * A take rendered at half the rate brought up to the full rate: every other
 * sample is the render's own, the ones between are cubic (Catmull-Rom)
 * midpoints of their neighbours — for a loop taken round the seam, so it
 * stays seamless. The images this leaves above the half rate's top are
 * about 30 dB down for anything under 5 kHz, and up where no laptop plays.
 */
function upsample(x: Mono, loop: boolean): Mono {
  const n = x.length;
  const out = new Float32Array(2 * n);
  const edge = (i: number): number => (loop ? x[(i + n) % n]! : x[Math.min(n - 1, Math.max(0, i))]!);
  for (let i = 0; i < n; i++) {
    const a = i >= 1 ? x[i - 1]! : edge(i - 1);
    const b = x[i]!;
    const c = i + 1 < n ? x[i + 1]! : edge(i + 1);
    const d = i + 2 < n ? x[i + 2]! : edge(i + 2);
    out[2 * i] = b;
    out[2 * i + 1] = (9 * (b + c) - (a + d)) / 16;
  }
  return out;
}

/**
 * A recipe played at half the take's rate and brought up to the full rate
 * at the end. For a sound with nothing to say above a few kHz — the far, the
 * dark, the muffled, the radio, a voice — half the samples are half the
 * work, and nothing audible is lost. The bright sounds (the rifle, the hits,
 * glass, clicks) are never halved.
 */
export function halfRate(recipe: (t: Take) => Mono | Mono[], loop = false): (t: Take) => Mono | Mono[] {
  return (full) => {
    const t = new Take(full.sr / 2, Math.floor(full.rng.next() * 4294967296), full.index);
    const raw = recipe(t);
    return Array.isArray(raw) ? raw.map((ch) => upsample(ch, loop)) : upsample(raw, loop);
  };
}
