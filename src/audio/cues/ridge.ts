/**
 * Overwatch Ridge: dawn in an alpine valley, heard from a grassy ridge 60 m
 * above its floor, lying prone behind a bolt-action rifle.
 *
 * Most of what the player hears happens 200 to 900 m away, and sound takes
 * its time over that: a hit at 600 m arrives 1.75 s after the round. The
 * engine delays those cues (``travel``) and darkens them by distance, so the
 * recipes here are each sound *at its source*, full-bodied — the crack of a
 * round on granite as a man beside the rock would hear it. The exceptions
 * are the sounds whose space is the sound: the rifle's own report, which the
 * valley answers from its far walls, and the echo off the great cliff.
 *
 * The music (the stingers, the chimes) is in D, so a chime landing over a
 * stinger never clashes, and its pitches are exact: a game may raise the
 * streak's chime by playback rate.
 */
import { biquad, highpass, lowpass, svf } from "../dsp/filters";
import { loopify, wrap } from "../dsp/master";
import type { Rng } from "../dsp/rng";
import { type Mono, adsr, fade, normalize, perc, shapeBy, tailOff, wobble } from "../dsp/signal";
import {
  addMetal,
  addMode,
  addString,
  bandNoise,
  brown,
  click,
  decayInPlace,
  formants,
  glottal,
  pink,
  saw,
  white,
} from "../dsp/sources";
import { room, roomMono } from "../dsp/space";
import type { Take } from "../dsp/take";
import { addShard, bubble, burst, knock, nWave, puff, saturate, scatter, thump } from "./kit";
import { midiHz } from "./music";
import type { CueSpec } from "./table";
import { bellStrike } from "./world";

type Curve = (u: number) => number;

const lerp = (a: number, b: number, u: number): number => a + (b - a) * Math.min(1, Math.max(0, u));
/** A smoothstep of u clamped to 0..1: the soft edge of a swell or a fade. */
const smooth = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

// --- plumbing ---------------------------------------------------------------------------

/** A curve of u = 0..1 sampled every ``step`` samples, linear between: envelopes and pitch tracks are slow. */
function sampled(n: number, fn: Curve, step = 32): Float32Array {
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
 * A sine on a frequency track, with a little second and third harmonic if
 * asked: a rotating phasor whose step is re-aimed every 16 samples, so a
 * whistle, a bird or a drone costs a few multiplies a sample rather than a
 * sine. The harmonics come from the phasor itself (sin 2θ = 2 sin θ cos θ,
 * sin 3θ = 3 sin θ − 4 sin³ θ). It starts at zero phase: no step at the onset.
 */
function tone(n: number, sr: number, freq: Float32Array, h2 = 0, h3 = 0): Mono {
  const out = new Float32Array(n);
  let re = 1;
  let im = 0;
  let cw = 1;
  let sw = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) {
      const w = (2 * Math.PI * freq[i]!) / sr;
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

/**
 * A slow curve that repeats exactly every ``length`` samples — a few sines,
 * each a whole number of cycles in the loop — scaled into [1 − depth, 1] and
 * bent by ``bend`` (above 1: long lulls and shorter swells). Evaluated every
 * 32 samples, since gusts and swells take seconds.
 */
function periodicCurve(n: number, length: number, rng: Rng, harmonics: readonly number[], depth: number, bend = 1.6): Float32Array {
  const parts = harmonics.map((k) => ({ k, a: rng.range(0.3, 1) / k ** 0.6, ph: rng.range(0, 6.28) }));
  const step = 32;
  const coarse = new Float32Array(Math.ceil(n / step) + 2);
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < coarse.length; k++) {
    let v = 0;
    for (const p of parts) v += p.a * Math.sin((2 * Math.PI * p.k * k * step) / length + p.ph);
    coarse[k] = v;
    if (k * step < length) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  for (let k = 0; k < coarse.length; k++) {
    const u = Math.min(1, Math.max(0, (coarse[k]! - lo) / Math.max(1e-6, hi - lo)));
    coarse[k] = 1 - depth + depth * u ** bend;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / step);
    const f = (i - k * step) / step;
    out[i] = coarse[k]! + (coarse[k + 1]! - coarse[k]!) * f;
  }
  return out;
}

/** The same seamless loop started ``shift`` samples later: still seamless, and its noise its own at that offset. */
function rotate(buf: Mono, shift: number): Mono {
  const n = buf.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[(((i - shift) % n) + n) % n]!;
  return out;
}

/** A soft clip with no transcendental in it: tanh's Padé approximant, flat past ±3. */
function soft(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** Add ``layer`` to a stereo pair at ``pan`` (−1 left .. 1 right): equal power, the far ear half a millisecond late. */
function putPanned(t: Take, left: Mono, right: Mono, layer: Mono, at: number, gain: number, pan: number): void {
  const p = Math.max(-1, Math.min(1, pan));
  const itd = 0.0006 * Math.abs(p);
  t.put(left, layer, at + (p > 0 ? itd : 0), gain * Math.sqrt(1 - p));
  t.put(right, layer, at + (p < 0 ? itd : 0), gain * Math.sqrt(1 + p));
}

// --- shared layers ----------------------------------------------------------------------

/** Band noise under a rectified fast wobble: the wet, gritty part of an impact — soil, spray, a crackle. */
function flicker(t: Take, seconds: number, low: number, high: number, rate: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, low, high, 2);
  const flick = wobble(n, t.sr, rate, () => t.rng.next());
  for (let i = 0; i < n; i++) {
    const a = Math.abs(flick[i]!);
    buf[i]! *= a * Math.sqrt(a);
  }
  return normalize(buf);
}

/**
 * Cloth or grass brushed: bright noise crackling irregularly (fibres and
 * blades catching and slipping past each other), with a sprinkle of the
 * sharpest catches on top, swelling and dying over ``seconds``.
 */
function rustle(t: Take, seconds: number, low: number, high: number, rate: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, r, low, high, 2);
  const flick = wobble(n, t.sr, rate, () => r.next());
  const slow = wobble(n, t.sr, rate / 9, () => r.next());
  for (let i = 0; i < n; i++) {
    const f = Math.abs(flick[i]!);
    buf[i]! *= (0.15 + 0.85 * f * f) * (0.7 + 0.3 * slow[i]!);
  }
  shapeBy(buf, (u) => Math.sin(Math.PI * u) ** 1.5);
  scatter(buf, t, Math.round(seconds * 40), 0, seconds * 0.9, low * 1.5, Math.min(high * 1.4, 16000), 0.25, 1);
  return buf;
}

/**
 * Breath: air shaped by a mouth or a nose (formant resonances), following
 * ``level``. No voice in it — a breath is air — and no thump: the chest
 * is under the high-pass.
 */
function breathNoise(t: Take, seconds: number, tract: readonly [number, number, number][], level: Curve): Mono {
  const n = t.n(seconds);
  const out = formants(white(n, t.rng), t.sr, tract.map(([f, q, amp]) => ({ freq: f * t.cutoff, q, amp })));
  highpass(out, t.sr, 120, 2);
  normalize(out);
  return shapeBy(out, level);
}

interface VocalOptions {
  /** Fundamental in Hz over u = 0..1. */
  f0: Curve;
  /** Resonances: centre (Hz) over u, a Q and a level. */
  tract: { f: Curve; q: number; amp: number }[];
  /** How much of the source is voice (1) versus breath alone (0). */
  voicing?: Curve;
  jitter?: number;
  shimmer?: number;
  /** Pressed (1) or slack (0) folds. */
  tension?: number;
  /** Level over u. */
  level?: Curve;
  breath?: number;
  /** Period doubling, 0..1: a rough subharmonic under the voice (a goat, a growl). */
  rasp?: number;
}

/** One gesture of a throat: a glottal source on a pitch track, through a moving vocal tract. */
function vocal(t: Take, seconds: number, o: VocalOptions): Mono {
  const n = t.n(seconds);
  const f0 = sampled(n, o.f0);
  const voice = glottal(n, t.sr, t.rng, f0, {
    jitter: o.jitter ?? 0.02,
    shimmer: o.shimmer ?? 0.1,
    breath: o.breath ?? 0.08,
    tension: o.tension ?? 0.5,
  });
  normalize(voice);
  const air = white(n, t.rng);
  const voicing = sampled(n, o.voicing ?? (() => 1));
  const level = sampled(n, o.level ?? (() => 1));
  const rasp = o.rasp ?? 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    let s = voice[i]!;
    if (rasp > 0) {
      // Every other cycle weaker: a subharmonic, the roughness of a bleat.
      // A triangle at half the pitch, not a sine: no transcendental a sample.
      ph += f0[i]! / (2 * t.sr);
      if (ph >= 1) ph -= 1;
      s *= 1 - rasp * 2 * Math.abs(ph - 0.5);
    }
    const v = voicing[i]!;
    voice[i] = (s * v + air[i]! * 0.5 * (1 - v)) * level[i]!;
  }
  const out = formants(voice, t.sr, o.tract.map((f) => ({ freq: f.f, q: f.q, amp: f.amp })));
  return fade(out, t.sr, 0.004, 0.012);
}

/**
 * The valley answering a report: not one echo but hundreds — every fold,
 * gully and stand of larch along both slopes returning it a little later and
 * a little darker — which the ear hears as thunder: a low rumble that rolls
 * (its level surging as the returns bunch and thin), rising over ``rise``
 * seconds and dying away with time constant ``decay``.
 */
function valleyRoll(t: Take, rng: Rng, seconds: number, rise: number, decay: number, cutoff = 420): Mono {
  const n = t.n(seconds);
  const sr = t.sr;
  const body = brown(n, rng);
  lowpass(body, sr, t.c(cutoff), 4);
  highpass(body, sr, 30, 2);
  normalize(body);
  const grain = bandNoise(n, sr, rng, 140, t.c(cutoff * 2.8), 2);
  const roll = wobble(n, sr, rng.range(3, 5.5), () => rng.next());
  const surge = wobble(n, sr, rng.range(0.8, 1.4), () => rng.next());
  for (let i = 0; i < n; i++) {
    const a = Math.abs(roll[i]!);
    body[i] = (body[i]! + 0.3 * grain[i]!) * (0.4 + 0.6 * a) * (0.75 + 0.25 * surge[i]!);
  }
  return shapeBy(body, (u) => {
    const s = u * seconds;
    const end = u > 0.85 ? 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.85)) / 0.15) : 1;
    return smooth(s / rise) * Math.exp(-Math.max(0, s - rise) / decay) * end;
  });
}

/**
 * One slap-back off a far wall: the report returned darker (a kilometre and
 * more of air has taken its crack) and smeared over a few tens of
 * milliseconds, since a rock face is not a mirror but a spread of ledges.
 */
function valleySlap(t: Take, cutoff: number): Mono {
  const r = t.rng;
  const out = t.canvas(0.55);
  const spread = r.range(0.025, 0.05);
  const parts = r.int(4, 7);
  for (let k = 0; k < parts; k++) {
    const at = spread * Math.pow(k / parts, 1.3) + r.range(0, 0.004);
    const layer = burst(t, 0.3, 110, cutoff * r.range(0.8, 1.15), 0.003, t.d(0.04), 2);
    t.put(out, layer, at, r.range(0.4, 1) * (1 - 0.5 * (k / parts)) * r.sign());
  }
  t.put(out, thump(t, 0.35, 100 * t.p, 45 * t.p, 0.004, t.d(0.07), 0.5), 0.002, 0.8);
  return normalize(out);
}

/** A stone the size of a thumbnail landing on rock: a hard tick and two stiff, heavily damped modes. */
function addPebble(out: Mono, t: Take, at: number, gain: number): void {
  const r = t.rng;
  const f = r.range(1800, 3600);
  t.put(out, click(t.sr, r, 0.0015, 1200, 12000), at, gain);
  addMode(out, t.sr, at, f, gain * 0.5 * r.sign(), r.range(0.006, 0.012), 0);
  addMode(out, t.sr, at, f * r.range(1.5, 1.9), gain * 0.3 * r.sign(), r.range(0.004, 0.008), 0);
}

/**
 * A deformed round tumbling away off stone: its whine falling as it
 * recedes and wobbling as it turns — the *pyeeow*. Airy rather than pure: a
 * tone with noise tuned tightly around it.
 */
function ricochetWhine(t: Take, seconds: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const f0 = r.range(2400, 3600) * t.p;
  const end = r.range(0.3, 0.45);
  const tumble = r.range(24, 42);
  const fm = r.range(0.015, 0.03);
  const freq = sampled(n, (u) => f0 * Math.pow(end, Math.pow(u, 0.85)) * (1 + fm * Math.sin(2 * Math.PI * tumble * u * seconds)), 8);
  const body = tone(n, t.sr, freq, 0.2);
  const air = svf(white(n, r), t.sr, "bp", freq, 30);
  lowpass(air, t.sr, 6000, 2);
  normalize(air);
  const am = r.range(0.2, 0.4);
  const spin = sampled(n, (u) => (1 - am + am * Math.sin(2 * Math.PI * tumble * u * seconds + 1)) * Math.min(1, u * 25) / (1 + 3.5 * u), 8);
  for (let i = 0; i < n; i++) body[i] = (0.65 * body[i]! + 0.6 * air[i]!) * spin[i]!;
  return fade(body, t.sr, 0.002, 0.05);
}

// --- the rifle, in the player's hands ------------------------------------------------------

/**
 * The player's bolt-action .30, fired prone, heard from behind the stock.
 *
 * The blast: the muzzle's shock front (a sharp N-wave), the round's own
 * supersonic crack fused into it and a bright click of the action, all
 * driven into saturation as the real thing overloads every ear; a heavy,
 * chesty boom and a sub under it; the grass and the ground around the
 * shooter throwing the first of it back.
 *
 * Then the valley answers. The near slope is too close to separate, but the
 * far walls return the report as two or three discrete slaps between 0.6
 * and 1.8 s — each darker than the last, one from the left, one from the
 * right — and every fold between them fills the gaps, so the slaps roll
 * into a thunder that dies over three seconds. That roll is baked in (the
 * cue has no engine echo) and it is wide: each ear gets its own rumble.
 */
export function ridgeRifleShot(t: Take): Mono[] {
  const r = t.rng;
  const sr = t.sr;
  const seconds = t.L(4.1);
  const n = t.n(seconds);
  const dry = new Float32Array(n);
  const head = t.canvas(0.3);
  t.put(head, nWave(t, t.j(0.0006, 0.15)), 0, t.g(1.0));
  t.put(head, click(sr, r, 0.003, 1800, t.c(16000)), 0, t.g(1.2));
  t.put(head, burst(t, 0.15, 800 * t.p, t.c(12500), 0.0002, t.d(0.011), 2, 1.5), 0, t.g(1.0));
  t.put(head, burst(t, 0.28, 260 * t.p, t.c(2800), 0.0008, t.d(0.042), 2), 0.0008, t.g(0.8));
  saturate(head, 2.8);
  t.put(dry, head, 0, 1);
  // The boom stays clean: saturating a low sine only squares it into mud.
  t.put(dry, thump(t, 0.4, 145 * t.p, 42 * t.p, 0.0015, t.d(0.08), 0.45), 0.001, t.g(0.5));
  t.put(dry, thump(t, 0.7, 54 * t.p, 30 * t.p, 0.004, t.d(0.14), 0.6), 0.002, t.g(0.36));
  t.put(dry, burst(t, 0.45, 35, 320 * t.p, 0.002, t.d(0.085), 4), 0.001, t.g(0.5));
  // The ground under the muzzle and the grass around it: the near wash.
  const near = bandNoise(t.n(1.0), sr, r, 90, t.c(2400), 2);
  adsr(near, sr, 0.015, 0.06, 0.6, 0.45);
  decayInPlace(near, sr, 0, t.d(0.17));
  t.put(dry, near, 0.006, t.g(0.24));

  const left = Float32Array.from(dry);
  const right = dry;
  // The far walls: first one side, then the other, then (mostly) the head of the valley.
  const side = r.sign();
  const slaps: [number, number, number, number][] = [
    [t.j(0.66, 0.12), 0.28, 0.65 * side, 2200],
    [t.j(1.12, 0.1), 0.22, -0.55 * side, 1700],
  ];
  if (t.index % 2 === 0 || r.chance(0.5)) slaps.push([t.j(1.6, 0.08), 0.15, r.range(-0.35, 0.35), 1300]);
  for (const [at, gain, pan, cutoff] of slaps) putPanned(t, left, right, valleySlap(t, t.c(cutoff)), at, t.g(gain, 1.5), pan);
  // The roll: an independent rumble in each ear, so it is as wide as the valley.
  const rollAt = t.j(0.45, 0.1);
  const rollLen = seconds - rollAt;
  const decay = t.d(0.95);
  t.put(left, valleyRoll(t, r.fork("left"), rollLen, 0.6, decay), rollAt, 0.3);
  t.put(right, valleyRoll(t, r.fork("right"), rollLen, 0.6, decay), rollAt, 0.3);
  return [left, right];
}

/** A bolt's steel stroke: noise through a narrow band sliding from ``from`` to ``to`` Hz, grained by the lugs in the raceway. */
function steelSlide(t: Take, seconds: number, from: number, to: number, q = 2.5): Mono {
  const n = t.n(seconds);
  const buf = white(n, t.rng);
  highpass(buf, t.sr, 900, 2);
  svf(buf, t.sr, "bp", (u) => (from + (to - from) * u) * t.p, q);
  normalize(buf);
  const grit = wobble(n, t.sr, 180, () => t.rng.next());
  for (let i = 0; i < n; i++) buf[i]! *= 0.55 + 0.45 * Math.abs(grit[i]!);
  return adsr(buf, t.sr, seconds * 0.15, seconds * 0.4, 0.75, seconds * 0.2);
}

/**
 * A steel part striking home: a click, a short hollow body, a brief
 * inharmonic ring and — ``weight`` 0..1 — the stock taking the blow.
 */
function steelClack(out: Mono, t: Take, at: number, base: number, weight: number, gain: number): void {
  const r = t.rng;
  t.put(out, click(t.sr, r, 0.003, base * 0.5, t.c(13000)), at, gain);
  const body = bandNoise(t.n(0.02), t.sr, r, base * 0.25, t.c(8000), 2);
  svf(body, t.sr, "bp", base * 0.6 * t.p, 2);
  normalize(body);
  decayInPlace(body, t.sr, 0.0002, 0.004 + 0.003 * weight);
  t.put(out, body, at, gain * 0.9);
  addMetal(out, t.sr, r, at, base * t.p, t.d(0.012 + 0.01 * weight), gain * 0.45);
  if (weight > 0) t.put(out, burst(t, 0.05, 90, 800, 0.0005, 0.006 + 0.006 * weight, 4), at, gain * 0.6 * weight);
}

/** The spent case landing on rock: a small brass tube ringing high, bouncing two or three times, each lower and sooner. */
function caseTinkle(out: Mono, t: Take, at: number, gain: number): void {
  const r = t.rng;
  const base = r.range(3600, 4600);
  let when = at;
  let g = gain;
  const bounces = r.int(2, 4);
  for (let k = 0; k < bounces; k++) {
    t.put(out, click(t.sr, r, 0.0015, 3000, 16000), when, g * 0.5);
    addMode(out, t.sr, when, base * r.range(0.99, 1.01), g * 0.3 * r.sign(), 0.04, 0);
    addMode(out, t.sr, when, base * 1.52 * r.range(0.99, 1.01), g * 0.14 * r.sign(), 0.03, 0);
    addMode(out, t.sr, when, base * 2.63 * r.range(0.99, 1.01), g * 0.18 * r.sign(), 0.025, 0);
    when += r.range(0.035, 0.07) * (1 - 0.3 * k);
    g *= r.range(0.4, 0.6);
  }
}

/** The round leaving the magazine: brass scraping up the feed ramp, grittier and lower than the bolt's steel. */
function roundScrape(t: Take, seconds: number): Mono {
  const n = t.n(seconds);
  const buf = white(n, t.rng);
  highpass(buf, t.sr, 600, 2);
  svf(buf, t.sr, "bp", (u) => (1500 - 500 * u) * t.p, 1.6);
  normalize(buf);
  const grit = wobble(n, t.sr, 260, () => t.rng.next());
  for (let i = 0; i < n; i++) buf[i]! *= Math.abs(grit[i]!);
  return adsr(buf, t.sr, seconds * 0.2, seconds * 0.3, 0.6, seconds * 0.25);
}

/**
 * Working the bolt: the handle lifted (the cocking cam compressing the
 * striker spring: a click and a short scrape), drawn back (a steel slide
 * fetching up on the bolt stop, the ejector flicking the case out), the
 * case tinkling onto the rock a fifth of a second later while the bolt goes
 * forward stripping the next round, and the handle locked down — the
 * heaviest, most solid clack of the four.
 */
export function ridgeBolt(t: Take): Mono {
  const out = t.canvas(t.L(0.74));
  steelClack(out, t, 0.004, 2600, 0, t.g(0.55));
  t.put(out, steelSlide(t, 0.05, 2400, 3200, 3), 0.008, t.g(0.2));
  const back = t.j(0.07, 0.15);
  const backLen = t.j(0.11, 0.12);
  t.put(out, steelSlide(t, backLen, 1800, 2900), back, t.g(0.42));
  const stop = back + backLen;
  steelClack(out, t, stop, 2100, 0.4, t.g(0.75));
  caseTinkle(out, t, stop + t.j(0.2, 0.2), t.g(0.35));
  const fwd = stop + t.j(0.1, 0.15);
  const fwdLen = t.j(0.1, 0.12);
  t.put(out, steelSlide(t, fwdLen, 2800, 1900), fwd, t.g(0.42));
  t.put(out, roundScrape(t, fwdLen * 0.7), fwd + fwdLen * 0.2, t.g(0.28));
  steelClack(out, t, fwd + fwdLen + t.j(0.05, 0.2), 1500, 1, t.g(1.0));
  return out;
}

/**
 * Reloading from a stripper clip, two seconds: bolt up and back; the clip
 * set in the charger guide (a clack, the rounds rattling in it); five
 * rounds thumbed down into the magazine — each a scrape of brass over the
 * magazine's lips and a click as it snaps under them, a little slower and
 * lower each time as the spring stiffens; the empty clip flicked away,
 * ringing once and tinkling on the rock; bolt forward and down.
 */
export function ridgeReload(t: Take): Mono {
  const r = t.rng;
  const sr = t.sr;
  const out = t.canvas(2.15);
  steelClack(out, t, 0.01, 2600, 0, t.g(0.5));
  t.put(out, steelSlide(t, 0.12, 1800, 2900), t.j(0.08, 0.1), t.g(0.4));
  steelClack(out, t, 0.21, 2100, 0.4, t.g(0.7));
  const clip = t.j(0.42, 0.06);
  t.put(out, steelSlide(t, 0.05, 1500, 2200, 2), clip - 0.05, t.g(0.2));
  steelClack(out, t, clip, 1800, 0.6, t.g(0.8));
  addMetal(out, sr, r, clip + 0.003, 4200 * t.p, 0.03, 0.12, [1, 1.38, 2.1]);
  let at = clip + t.j(0.15, 0.1);
  for (let k = 0; k < 5; k++) {
    const len = (0.085 + 0.012 * k) * r.range(0.9, 1.1);
    const n = t.n(len);
    const scrape = white(n, r);
    highpass(scrape, sr, 800, 2);
    svf(scrape, sr, "bp", (u) => (2400 - 900 * u - 60 * k) * t.p, 1.6);
    normalize(scrape);
    // The ratchet: the round's rim catching and slipping on the lips.
    const catchy = wobble(n, sr, r.range(110, 170), () => r.next());
    for (let i = 0; i < n; i++) scrape[i]! *= 0.35 + 0.65 * Math.abs(catchy[i]!);
    adsr(scrape, sr, len * 0.2, len * 0.3, 0.7, len * 0.15);
    t.put(out, scrape, at, 0.3 * r.range(0.85, 1.05));
    const snap = at + len;
    t.put(out, click(sr, r, 0.002, 1800, 12000), snap, 0.4 * r.range(0.85, 1.1));
    addMetal(out, sr, r, snap, (3300 - 120 * k) * t.p * r.range(0.97, 1.03), 0.008, 0.18, [1, 1.5, 2.3]);
    t.put(out, burst(t, 0.03, 150, 900, 0.0004, 0.004, 2), snap, 0.2);
    at = snap + r.range(0.035, 0.055);
  }
  // The empty clip flicked out: a spring-steel *tsing*, and it lands.
  const flick = Math.max(at + 0.04, t.j(1.36, 0.02));
  t.put(out, click(sr, r, 0.002, 2000, 12000), flick, 0.3);
  addMetal(out, sr, r, flick, 2900 * t.p, 0.025, 0.12, [1, 1.62, 2.44]);
  const land = flick + t.j(0.14, 0.15);
  for (let k = 0, count = r.int(2, 4); k < count; k++) {
    const when = land + k * r.range(0.03, 0.06);
    t.put(out, click(sr, r, 0.0015, 2500, 14000), when, 0.18 / (k + 1));
    addMetal(out, sr, r, when, r.range(3000, 4200), 0.012, 0.08 / (k + 1), [1, 1.47, 2.2]);
  }
  // Forward, the top round stripped into the chamber, and locked down.
  const fwd = Math.max(land + 0.12, t.j(1.6, 0.02));
  const fwdLen = t.j(0.11, 0.1);
  t.put(out, steelSlide(t, fwdLen, 2800, 1900), fwd, t.g(0.42));
  t.put(out, roundScrape(t, fwdLen * 0.7), fwd + fwdLen * 0.2, t.g(0.3));
  steelClack(out, t, Math.max(fwd + fwdLen + 0.04, t.j(1.8, 0.015)), 1500, 1, t.g(1.0));
  return out;
}

/**
 * The trigger pulled on an empty chamber: the faint tick of the trigger
 * taking up, then the striker, released by the sear, snapping forward onto
 * nothing — a small, sharp, dry click with a thin ring and a knock of the
 * stock.
 */
export function ridgeDry(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.22);
  t.put(out, click(t.sr, r, 0.0015, 2500, 12000), 0.003, t.g(0.2));
  const at = t.j(0.014, 0.3);
  t.put(out, click(t.sr, r, 0.003, 1500, t.c(14000)), at, t.g(1.0));
  const snap = bandNoise(t.n(0.015), t.sr, r, 1800, t.c(9000), 2);
  svf(snap, t.sr, "bp", 3100 * t.p, 3);
  normalize(snap);
  decayInPlace(snap, t.sr, 0.0002, 0.003);
  t.put(out, snap, at, t.g(0.8));
  addMetal(out, t.sr, r, at, 2900 * t.p, t.d(0.01), 0.35, [1, 1.58, 2.35, 3.2]);
  t.put(out, burst(t, 0.04, 120, 900, 0.0005, 0.005, 2), at, t.g(0.5));
  return out;
}

/**
 * The eye going to the scope: the sleeve and the cheek pad brushing (a soft
 * cloth rustle and the shoulder settling into the stock), then the faint
 * tick of the rubber eyecup meeting the brow, a glassy glint inside it.
 */
export function ridgeScopeIn(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.36));
  t.put(out, rustle(t, t.L(0.26), 500, t.c(5000), 70), 0, t.g(0.8));
  t.put(out, puff(t, 0.2, 600, 0.04, 0.05), 0.02, t.g(0.3));
  const cup = t.j(0.24, 0.1);
  t.put(out, burst(t, 0.03, 300, 2500, 0.0008, 0.004), cup, t.g(0.35));
  addMode(out, t.sr, cup, 5200 * t.p * r.range(0.97, 1.03), 0.05, 0.012, 0);
  addMode(out, t.sr, cup, 7900 * t.p * r.range(0.97, 1.03), 0.025, 0.008, 0);
  return out;
}

/** The eye coming off the scope: a lighter, quicker brush of cloth, the cheek leaving the stock. */
export function ridgeScopeOut(t: Take): Mono {
  const out = t.canvas(t.L(0.27));
  t.put(out, rustle(t, t.L(0.19), 900, t.c(7000), 90), 0, t.g(0.8));
  t.put(out, puff(t, 0.12, 900, 0.02, 0.03), 0.01, t.g(0.18));
  return out;
}

/**
 * The player's own breathing, slowed for the shot: in through the nose
 * (a narrower, brighter hiss), a pause at the top, out through the mouth
 * — longer, darker, trailing away — and the still moment before the next.
 * About four seconds, wrapped so it repeats exactly.
 */
export function ridgeBreath(t: Take): Mono {
  const r = t.rng;
  const length = t.n(r.range(3.9, 4.4));
  const render = new Float32Array(length + t.n(0.4));
  const inLen = t.j(1.25, 0.1);
  const outLen = t.j(1.9, 0.1);
  const inhale = breathNoise(t, inLen, [[1300, 3, 1], [2600, 4, 0.6], [3700, 5, 0.3]], (u) => Math.sin(Math.PI * u) ** 1.3 * (0.6 + 0.4 * u));
  t.put(render, inhale, 0.15, 0.55);
  const exhale = breathNoise(t, outLen, [[650, 2.5, 1], [1250, 3, 0.6], [2500, 4, 0.25]], (u) => smooth(u * 6) * Math.pow(1 - u, 1.6));
  t.put(render, exhale, 0.15 + inLen + t.j(0.18, 0.2), 1);
  return wrap(render, length);
}

// --- impacts, heard from far away -------------------------------------------------------------

/**
 * A round into turf: it buries itself with a dull, heavy *thup* (the soil
 * takes the energy, so there is no crack to speak of), throws up a soft wet
 * spatter of soil and roots, and clods patter back onto the grass.
 */
export function ridgeHitDirt(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.62));
  t.put(out, burst(t, 0.15, 40, 360 * t.p, 0.0008, t.d(0.032), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.15, 115 * t.p, 48 * t.p, 0.001, t.d(0.03), 0.5), 0, t.g(0.7));
  t.put(out, burst(t, 0.04, 400, 3000, 0.0003, 0.005), 0, t.g(0.45));
  const spray = flicker(t, 0.3, 700, t.c(5500), 260);
  perc(spray, t.sr, 0.004, t.d(0.07));
  t.put(out, spray, 0.004, t.g(0.4));
  scatter(out, t, r.int(8, 14), 0.08, 0.5, 600, 4500, 0.2, 1.3);
  t.put(out, burst(t, 0.06, 300, 2500, 0.001, 0.008), r.range(0.3, 0.42), t.g(0.12));
  t.put(out, puff(t, 0.35, 2500, 0.02, 0.1), 0.01, t.g(0.08));
  return out;
}

/**
 * A round on granite: an instant hard crack as the jacket splashes and the
 * stone chips, the rock ringing briefly high and dry (a few stiff modes,
 * damped at once), grit thrown off and chips landing. Every other take the
 * round goes on, whining away as it tumbles.
 */
export function ridgeHitRock(t: Take): Mono {
  const r = t.rng;
  const whine = t.index % 2 === 1;
  const out = t.canvas(whine ? t.L(1.1) : t.L(0.5));
  t.put(out, nWave(t, 0.00025), 0, t.g(0.8));
  t.put(out, click(t.sr, r, 0.003, 1500, t.c(15000)), 0, t.g(1.2));
  t.put(out, burst(t, 0.05, 1800 * t.p, t.c(13000), 0.0002, t.d(0.006), 2, 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.08, 300, 2400, 0.0004, t.d(0.012)), 0, t.g(0.5));
  const modes: [number, number, number][] = [[2300, 0.35, 0.02], [3650, 0.25, 0.014], [5400, 0.18, 0.01], [7900, 0.1, 0.007]];
  for (const [f, a, tau] of modes) addMode(out, t.sr, 0, f * t.p * r.range(0.94, 1.06), a * r.sign(), t.d(tau), 0);
  scatter(out, t, r.int(6, 11), 0.005, 0.3, 1800, 9000, 0.25, 1.6);
  for (let k = 0, count = r.int(2, 4); k < count; k++) addPebble(out, t, r.range(0.12, 0.3), r.range(0.05, 0.12));
  addPebble(out, t, r.range(0.3, 0.38), 0.05);
  if (whine) t.put(out, ricochetWhine(t, t.L(r.range(0.6, 0.85))), t.j(0.01, 0.3), t.g(0.5));
  return out;
}

/**
 * A steel plate — the aim check's gongs, a truck's engine block — struck by
 * a round: the strike's bright click, then the plate ringing in inharmonic
 * pairs that beat as they die, the upper ones first, over the dull *bong*
 * of whatever holds it.
 */
export function ridgeHitMetal(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.9));
  t.put(out, click(t.sr, r, 0.003, 2000, 16000), 0, t.g(1.1));
  t.put(out, nWave(t, 0.0003), 0, t.g(0.6));
  t.put(out, burst(t, 0.03, 1500, t.c(14000), 0.0002, 0.004), 0, t.g(0.9));
  const base = r.range(620, 980) * t.p;
  const table: [number, number, number][] = [
    [1, 1, 0.42], [1.47, 0.5, 0.3], [2.09, 0.55, 0.22], [2.56, 0.3, 0.16], [3.3, 0.25, 0.1], [4.1, 0.14, 0.07], [5.3, 0.08, 0.045],
  ];
  for (const [ratio, amp, tau] of table) {
    // Each mode a close pair, one line stronger: the beat is a slow swirl, not a tremolo.
    const f = base * ratio * (1 + r.range(-0.006, 0.006));
    const beat = r.range(1, 4);
    const split = r.range(0.65, 0.8);
    const a = amp * t.g(0.5, 2);
    addMode(out, t.sr, 0, f - beat / 2, a * split, t.d(tau * r.range(0.85, 1.15)), r.range(0, 6.28));
    addMode(out, t.sr, 0, f + beat / 2, a * (1 - split), t.d(tau * r.range(0.85, 1.15)), r.range(0, 6.28));
  }
  addMode(out, t.sr, 0, r.range(160, 240) * t.p, 0.3, t.d(0.08), 0);
  t.put(out, burst(t, 0.06, 200, t.c(2500), 0.0005, 0.012), 0, t.g(0.4));
  return out;
}

/**
 * The aim check's steel gong rung across 150 m: a clean *ding* — one mode
 * dominant, so it has a clear pitch — its upper partials dying in a moment,
 * the plate swinging on its chains (two or three faint links rattling) and
 * the ring left to fade.
 */
export function ridgePlateRing(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.9));
  t.put(out, click(t.sr, r, 0.0025, 2500, 16000), 0, t.g(1.0));
  t.put(out, burst(t, 0.03, 2000, t.c(15000), 0.0002, 0.003), 0, t.g(0.7));
  const base = r.range(880, 1050) * t.p;
  const table: [number, number, number][] = [[1, 1, 0.5], [2.76, 0.35, 0.16], [4.03, 0.2, 0.08], [5.4, 0.12, 0.05], [7.1, 0.06, 0.03]];
  for (const [ratio, amp, tau] of table) {
    const f = base * ratio * (1 + r.range(-0.004, 0.004));
    addMode(out, t.sr, 0, f - 0.6, amp * 0.75, t.d(tau), 0);
    addMode(out, t.sr, 0, f + 0.6, amp * 0.25, t.d(tau * 0.9), 0);
  }
  addMode(out, t.sr, 0, base * 0.5 * r.range(0.97, 1.03), 0.12, t.d(0.2), 0);
  for (let k = 0, count = r.int(2, 4); k < count; k++) {
    addMetal(out, t.sr, r, r.range(0.08, 0.35), r.range(2600, 3800), 0.006, 0.05, [1, 1.6, 2.3]);
  }
  return out;
}

/**
 * A round through a windscreen: laminated glass does not fall, it crazes —
 * a crunchy crack, the fractures racing out from the hole, the pane's thud
 * in the car's frame, and a few crumbs of glass tinkling onto the dash.
 */
export function ridgeHitGlass(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.72));
  t.put(out, click(t.sr, r, 0.004, 2500, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.1, 2500 * t.p, 15000, 0.0003, t.d(0.015), 2, 2), 0, t.g(0.9));
  const crunch = flicker(t, 0.12, 1500, 9000, 420);
  perc(crunch, t.sr, 0.001, t.d(0.035));
  t.put(out, crunch, 0.002, t.g(0.5));
  for (let k = 0, count = r.int(10, 16); k < count; k++) {
    const at = 0.004 + Math.pow(k / 16, 1.5) * 0.09 + r.range(0, 0.004);
    t.put(out, click(t.sr, r, r.range(0.001, 0.0025), 3000, 15000), at, r.range(0.2, 0.5));
  }
  addMode(out, t.sr, 0, 3900 * t.p, 0.15, t.d(0.04), 0);
  addMode(out, t.sr, 0, 6100 * t.p, 0.08, t.d(0.025), 0);
  t.put(out, thump(t, 0.12, 230 * t.p, 130 * t.p, 0.001, t.d(0.025), 0.5), 0, t.g(0.4));
  t.put(out, burst(t, 0.06, 150, 1200, 0.0005, 0.015), 0, t.g(0.35));
  for (let k = 0, count = r.int(3, 6); k < count; k++) {
    addShard(out, t, r.range(0.05, 0.3), r.range(3500, 9000) * t.p, r.range(0.06, 0.16), r.range(0.01, 0.025));
  }
  addShard(out, t, r.range(0.3, 0.42), r.range(4000, 8000) * t.p, 0.06, 0.015);
  return out;
}

/**
 * A round into the lake: the slap of the surface, the *plunk* of the cavity
 * it tears (a bubble whose pitch rises as it closes), a column of spray
 * thrown up and falling back as droplets.
 */
export function ridgeHitWater(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.85));
  t.put(out, burst(t, 0.03, 400, t.c(3500), 0.0003, 0.005), 0, t.g(0.8));
  t.put(out, bubble(t, r.range(300, 480) * t.p, t.d(0.035), r.range(1.8, 2.6)), 0.002, t.g(0.9));
  t.put(out, burst(t, 0.1, 50, 300, 0.001, 0.022, 4), 0, t.g(0.55));
  const splash = flicker(t, 0.45, 700, t.c(7500), 320);
  adsr(splash, t.sr, 0.012, 0.06, 0.45, 0.22);
  decayInPlace(splash, t.sr, 0, t.d(0.12));
  t.put(out, splash, 0.006, t.g(0.6));
  for (let k = 0, count = r.int(8, 14); k < count; k++) {
    const at = 0.1 + Math.pow(r.next(), 1.3) * 0.5;
    t.put(out, bubble(t, r.range(900, 3200) * t.p, r.range(0.006, 0.016), r.range(1.3, 2.0)), at, r.range(0.12, 0.35));
  }
  return out;
}

/** A round into timber — a hut's beam, a fence post: a woody knock, the thud of the mass, splinters spitting. */
export function ridgeHitWood(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.55));
  t.put(out, click(t.sr, r, 0.004, 500, t.c(9000)), 0, t.g(1.0));
  t.put(out, knock(t, r.range(260, 360) * t.p, t.d(0.035), 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.14, 60, 450, 0.0008, t.d(0.028), 4), 0, t.g(0.75));
  scatter(out, t, r.int(7, 12), 0.004, 0.16, 900, 7500, 0.45, 1.8);
  t.put(out, knock(t, r.range(900, 1500), 0.006, 0.5), r.range(0.16, 0.28), t.g(0.12));
  return out;
}

/**
 * A round striking a body, far off: all that carries is a muffled *whump* —
 * the mass of it, the slap of the coat — the sharper parts lost to the
 * distance before they start.
 */
export function ridgeHitFlesh(t: Take): Mono {
  const out = t.canvas(0.42);
  t.put(out, burst(t, 0.3, 45, 380 * t.p, 0.0012, t.d(0.045), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.25, 125 * t.p, 50 * t.p, 0.0012, t.d(0.04), 0.5), 0, t.g(0.8));
  t.put(out, burst(t, 0.04, 500 * t.p, t.c(3000), 0.0004, t.d(0.006), 2), 0, t.g(0.55));
  const wet = flicker(t, 0.15, 600, 2800, 140);
  perc(wet, t.sr, 0.003, t.d(0.03));
  t.put(out, wet, 0.004, t.g(0.18));
  return out;
}

/**
 * A body dropping in the meadow: the torso's soft, heavy thud, the limbs a
 * moment after, the long grass crushed under them. No clatter: the grass
 * takes it all.
 */
export function ridgeBodyFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.85));
  const hits: [number, number, number][] = [[0, 1.0, 200], [t.j(0.14, 0.3), 0.55, 160]];
  if (r.chance(0.6)) hits.push([t.j(0.3, 0.2), 0.3, 240]);
  for (const [at, gain, cutoff] of hits) {
    t.put(out, burst(t, 0.3, 30, t.c(cutoff * t.p), 0.004, t.d(0.06), 4), at, t.g(gain));
    t.put(out, thump(t, 0.25, 110 * t.p, 42 * t.p, 0.004, t.d(0.05), 0.5), at, t.g(0.7 * gain));
    t.put(out, rustle(t, 0.3 * gain + 0.1, 1200, t.c(7000), 70), at, t.g(0.18 * gain));
  }
  t.put(out, puff(t, 0.4, 900, 0.02, 0.1), 0.01, t.g(0.1));
  return out;
}

/**
 * A side window giving way: toughened glass does not crack, it bursts — a
 * crack, a crash, then a rushing rain of little cubes onto the seat, the
 * running board and the road, the bigger clumps ticking on the steel.
 */
export function ridgeGlassShatter(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.35));
  t.put(out, click(t.sr, r, 0.004, 2500, 16000), 0, t.g(1.3));
  t.put(out, burst(t, 0.25, 1800 * t.p, 15000, 0.0004, t.d(0.05), 2, 2), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 600, 5000, 0.002, t.d(0.07), 2), 0.004, t.g(0.4));
  // The rush of cubes: noise crackling at the rate the pieces arrive, swelling and thinning.
  const cascade = flicker(t, 0.9, 3000, t.c(12000), 650);
  shapeBy(cascade, (u) => smooth(u * 12) * Math.pow(1 - u, 1.6));
  t.put(out, cascade, 0.01, t.g(0.4));
  for (let k = 0, count = r.int(40, 60); k < count; k++) {
    const at = 0.01 + Math.pow(r.next(), 1.5) * 1.0;
    const size = 1 - 0.6 * (at / 1.0);
    addShard(out, t, at, r.range(4000, 11000) * t.p, r.range(0.04, 0.16) * size, r.range(0.006, 0.02));
  }
  for (let k = 0, count = r.int(3, 6); k < count; k++) {
    const at = r.range(0.15, 0.7);
    addMetal(out, t.sr, r, at, r.range(1800, 3000), 0.01, r.range(0.05, 0.12), [1, 1.47, 2.2]);
    t.put(out, click(t.sr, r, 0.003, 2000, 14000), at, r.range(0.15, 0.3));
  }
  return out;
}

// --- danger ---------------------------------------------------------------------------------

/**
 * A round passing a metre from the head: the shock wave's N-wave, a third
 * of a millisecond, rising instantly — a whip crack right at the ear — its
 * bounce off the ground a couple of milliseconds behind (the player is
 * lying on it), and the air torn behind the round, a hiss falling away.
 */
export function ridgeCrackNear(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.48));
  const snap = t.canvas(0.02);
  t.put(snap, nWave(t, t.j(0.00035, 0.2)), 0, 1);
  t.put(snap, click(t.sr, r, 0.0015, 2500, 18000), 0, t.g(0.7));
  saturate(snap, 2);
  t.put(out, snap, 0.002, t.g(1.0));
  t.put(out, nWave(t, t.j(0.0004, 0.2)), 0.002 + t.j(0.0022, 0.4), t.g(0.5));
  t.put(out, burst(t, 0.02, 3000, 16000, 0.0001, 0.003), 0.002, t.g(0.5));
  t.put(out, burst(t, 0.05, 60, 500, 0.0005, 0.008, 2), 0.002, t.g(0.3));
  const len = t.L(0.36);
  const tear = white(t.n(len), r);
  const hi = t.c(6000);
  const lo = hi * r.range(0.22, 0.3);
  svf(tear, t.sr, "bp", (u) => lo + (hi - lo) * Math.pow(1 - u, 2), 1.8);
  normalize(tear);
  shapeBy(tear, (u) => Math.min(1, u * 60) * Math.exp(-u * 6));
  t.put(out, tear, 0.003, t.g(0.5));
  return out;
}

/**
 * A rifle fired from across the valley — the counter-sniper. At its source
 * a report like the player's own, less sharp (the engine's distance takes
 * the rest of the crack), and the valley rolling it on for seconds after.
 */
export function ridgeFarShot(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(3.0);
  const out = t.canvas(seconds);
  const head = t.canvas(0.3);
  t.put(head, nWave(t, t.j(0.0005, 0.2)), 0, t.g(0.6));
  t.put(head, burst(t, 0.2, 300 * t.p, t.c(6000), 0.0004, t.d(0.02), 2, -1), 0, t.g(1.0));
  t.put(head, burst(t, 0.25, 400, 2400, 0.001, t.d(0.04), 2), 0.001, t.g(0.8));
  saturate(head, 2);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 0.45, 120 * t.p, 40 * t.p, 0.002, t.d(0.09), 0.5), 0.001, t.g(0.55));
  t.put(out, burst(t, 0.5, 35, 260, 0.002, t.d(0.1), 4), 0.001, t.g(0.6));
  t.put(out, valleyRoll(t, r, seconds - 0.04, 0.35, t.d(0.8)), 0.04, t.g(0.6));
  for (const at of [t.j(0.5, 0.2), t.j(1.05, 0.15)]) t.put(out, valleySlap(t, t.c(1500)), at, t.g(0.2));
  return out;
}

/**
 * A machine gun far off: a burst of six to nine reports at about twelve a
 * second, each a little different in level and timing (the gunner's hold,
 * the belt), running together under a roll of the valley that builds
 * through the burst and outlasts it.
 */
export function ridgeMgBurst(t: Take): Mono {
  const r = t.rng;
  const shots = r.int(6, 10);
  const rate = r.range(11, 13.5);
  const span = shots / rate;
  const out = t.canvas(span + t.L(1.2));
  for (let k = 0; k < shots; k++) {
    const at = 0.005 + k / rate + r.range(-0.004, 0.004);
    const g = r.range(0.75, 1) * (k === 0 ? 1.1 : 1);
    const report = t.canvas(0.25);
    t.put(report, nWave(t, 0.0004), 0, 0.4 * g);
    t.put(report, burst(t, 0.12, 280 * t.p * r.range(0.9, 1.1), t.c(5000), 0.0003, t.d(0.018), 2), 0, g);
    t.put(report, burst(t, 0.15, 400, 2000, 0.001, 0.035), 0.001, 0.5 * g);
    saturate(report, 1.8);
    t.put(report, thump(t, 0.2, 130 * t.p, 50 * t.p, 0.001, t.d(0.04), 0.5), 0.001, 0.45 * g);
    t.put(out, report, at, 1);
  }
  const rollLen = span + t.L(1.1);
  t.put(out, valleyRoll(t, r, rollLen, span * 0.8, t.d(0.45)), 0.02, t.g(0.45));
  return out;
}

/**
 * A tube open at one end, ringing: a feedback comb with inverted feedback
 * (a round trip of half a period), so it rings on the odd harmonics as a
 * closed pipe does, with a little low-pass in the loop so the ring darkens
 * as it dies.
 */
function tube(buf: Mono, sr: number, freq: number, feedback: number): Mono {
  const d = Math.max(2, Math.round(sr / (2 * freq)));
  const line = new Float32Array(d);
  let idx = 0;
  let lp = 0;
  for (let i = 0; i < buf.length; i++) {
    lp = 0.55 * lp + 0.45 * line[idx]!;
    const y = buf[i]! - feedback * lp;
    line[idx] = y;
    idx = idx + 1 === d ? 0 : idx + 1;
    buf[i] = y;
  }
  return buf;
}

/**
 * A mortar firing, down in the valley: the bomb's charge going off at the
 * bottom of the barrel — the hollow *thoonk* of the tube as the gas leaves
 * it (a short pop through a ringing pipe) — and the valley answering, low.
 */
export function ridgeMortarLaunch(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.35));
  const pop = t.canvas(0.5);
  t.put(pop, burst(t, 0.3, 60, t.c(1800), 0.0015, t.d(0.03), 2), 0, 1);
  t.put(pop, thump(t, 0.35, 170 * t.p, 80 * t.p, 0.002, t.d(0.06), 0.4), 0, 0.9);
  tube(pop, t.sr, r.range(95, 125) * t.p, 0.82);
  normalize(pop);
  t.put(out, pop, 0.005, 1);
  t.put(out, burst(t, 0.4, 30, 200, 0.003, t.d(0.08), 4), 0.005, t.g(0.5));
  t.put(out, valleyRoll(t, r, t.L(1.2), 0.2, t.d(0.35), 320), 0.03, t.g(0.3));
  return out;
}

/**
 * An incoming shell: the whistle of air over its fins and fuse, its pitch
 * falling as it closes (the Doppler shift easing as it comes), louder and
 * louder — and then the famous gap: it thins out just before it lands,
 * which the game fills with the blast.
 */
export function ridgeMortarWhistle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.6);
  const n = t.n(seconds);
  const f0 = r.range(1500, 1900) * t.p;
  const f1 = f0 * r.range(0.42, 0.52);
  const wob = r.range(5, 8);
  const freq = sampled(n, (u) => f0 * Math.pow(f1 / f0, Math.pow(u, 1.25)) * (1 + 0.006 * Math.sin(2 * Math.PI * wob * u * seconds)), 8);
  const out = tone(n, t.sr, freq, 0.15, 0.04);
  const air = svf(white(n, r), t.sr, "bp", freq, 12);
  normalize(air);
  const rush = white(n, r);
  svf(rush, t.sr, "bp", (u) => 2400 - 1400 * u, 1.2, 32);
  normalize(rush);
  for (let i = 0; i < n; i++) out[i] = 0.7 * out[i]! + 0.35 * air[i]! + 0.12 * rush[i]!;
  shapeBy(out, (u) => (0.06 + 0.94 * u ** 2.2) * smooth(u * 10) * (u > 0.86 ? smooth((0.97 - u) / 0.11) : 1));
  return out;
}

/**
 * A mortar bomb a few tens of metres away: the blast front, a crack driven
 * into saturation, a heavy boom and a roar of turbulent air — then the
 * dirt it threw up coming down, soil in a crumbling shower and stones
 * knocking among it, thinning over two seconds as the valley rolls it away.
 */
export function ridgeMortarBlast(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(3.6);
  const out = t.canvas(seconds);
  const head = t.canvas(0.5);
  t.put(head, nWave(t, t.j(0.0014, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.006, 500, 14000), 0, t.g(0.9));
  t.put(head, burst(t, 0.4, 150, t.c(7000), 0.0005, t.d(0.04), 2, -1), 0, t.g(1.0));
  t.put(head, burst(t, 0.45, 300, t.c(2200), 0.003, t.d(0.09), 2), 0.002, t.g(0.7));
  saturate(head, 3.2);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 1.0, 80 * t.p, 28 * t.p, 0.004, t.d(0.2), 0.5), 0.002, t.g(0.75));
  t.put(out, burst(t, 1.2, 25, 200, 0.004, t.d(0.28), 4), 0.002, t.g(0.8));
  const roarN = t.n(1.6);
  const roar = bandNoise(roarN, t.sr, r, 90, t.c(1400), 2);
  const churn = wobble(roarN, t.sr, 18, () => r.next());
  for (let i = 0; i < roarN; i++) roar[i]! *= 0.6 + 0.4 * churn[i]!;
  adsr(roar, t.sr, 0.02, 0.2, 0.5, 0.8);
  decayInPlace(roar, t.sr, 0, t.d(0.45));
  t.put(out, roar, 0.01, t.g(0.5));
  t.put(out, valleyRoll(t, r, seconds - 0.05, 0.4, t.d(1.0)), 0.05, t.g(0.4));
  // The soil coming down: a crumbling shower, then clods, then stones.
  const soilLen = 2.3;
  const soil = flicker(t, soilLen, 500, t.c(4000), 300);
  shapeBy(soil, (u) => smooth(u * 5) * Math.pow(1 - u, 1.8));
  t.put(out, soil, 0.35, t.g(0.16));
  scatter(out, t, r.int(50, 70), 0.35, 2.6, 700, 5000, 0.12, 1.5);
  for (let k = 0, count = r.int(10, 16); k < count; k++) {
    const at = 0.45 + Math.pow(r.next(), 1.4) * 2.0;
    t.put(out, knock(t, r.range(500, 1100), 0.008, 0.6), at, r.range(0.04, 0.12));
    addPebble(out, t, at, r.range(0.04, 0.1));
  }
  return out;
}

/**
 * The player hit: no voice, just the body blow — a heavy thump felt in the
 * chest, the slap of it and a muffled crack of the round — and the breath
 * knocked out through the teeth, a sharp pained exhale that catches once.
 */
export function ridgeHurt(t: Take): Mono {
  const out = t.canvas(t.L(0.82));
  t.put(out, thump(t, 0.4, 95 * t.p, 36 * t.p, 0.002, t.d(0.09), 0.5), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 35, 260, 0.002, t.d(0.07), 4), 0, t.g(0.9));
  t.put(out, burst(t, 0.05, 500, 2800, 0.0005, 0.009), 0, t.g(0.55));
  const crack = nWave(t, 0.0004);
  lowpass(crack, t.sr, 2500, 2);
  t.put(out, crack, 0, t.g(0.5));
  const len = t.j(0.42, 0.15);
  const breath = breathNoise(t, len, [[850, 3, 1], [1500, 4, 0.8], [2700, 6, 0.55], [4300, 7, 0.35]], (u) =>
    smooth((u * len) / 0.012) * Math.pow(1 - u, 1.8) * (1 - 0.55 * Math.exp(-(((u - 0.22) / 0.06) ** 2))));
  t.put(out, breath, t.j(0.04, 0.3), t.g(0.6));
  t.put(out, thump(t, 0.2, 70 * t.p, 40 * t.p, 0.003, 0.05, 0.6), t.j(0.36, 0.1), t.g(0.3));
  return out;
}

/**
 * The scope's glass cracking as the player falls: one sharp, crystalline
 * crack (a small thick lens: high, clear partials, ringing a moment), then
 * the splinters — fractures running out from the first, each a tiny click
 * and pip, quick then thinning — and a chip settling inside the tube.
 */
export function ridgeScopeCrack(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  t.put(out, click(t.sr, r, 0.003, 3000, 18000), 0, t.g(1.2));
  t.put(out, nWave(t, 0.0002), 0, t.g(0.6));
  t.put(out, burst(t, 0.05, 3000, 16000, 0.0002, t.d(0.006), 2, 2), 0, t.g(0.9));
  for (const [f, a, tau] of [[4700, 0.25, 0.06], [6900, 0.18, 0.045], [9100, 0.12, 0.035], [11800, 0.08, 0.03]] as const) {
    addMode(out, t.sr, 0, f * t.p * r.range(0.97, 1.03), a, t.d(tau), 0);
  }
  const count = r.int(18, 28);
  let at = 0.006;
  for (let k = 0; k < count; k++) {
    at += (0.002 + 0.03 * Math.pow(k / count, 2)) * r.range(0.5, 1.5);
    const g = 0.4 * (1 - 0.6 * (k / count)) * r.range(0.5, 1);
    t.put(out, click(t.sr, r, r.range(0.0008, 0.002), 3000, 16000), at, g);
    addMode(out, t.sr, at, r.range(4000, 10000), g * 0.2 * r.sign(), r.range(0.004, 0.012), 0);
  }
  const crackle = flicker(t, 0.35, 2500, 12000, 500);
  perc(crackle, t.sr, 0.001, t.d(0.1));
  t.put(out, crackle, 0.004, t.g(0.3));
  addShard(out, t, at + r.range(0.08, 0.18), r.range(5000, 8000), 0.08, 0.02);
  return out;
}

/**
 * The fall: a last heavy breath out, long and shaking; the body settling
 * into the grass, a soft heavy thud and the blades crushed under it, an arm
 * after; and under it all a low drone — a fifth, sinking — as the world
 * recedes.
 */
export function ridgeDeath(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(3.4);
  const len = t.j(1.2, 0.1);
  const shake = r.range(4, 6.5);
  const exhale = breathNoise(t, len, [[600, 2.5, 1], [1150, 3, 0.6], [2400, 4, 0.25]], (u) =>
    smooth((u * len) / 0.06) * Math.pow(1 - u, 1.4) * (0.75 + 0.25 * Math.sin(2 * Math.PI * shake * u * len)));
  t.put(out, exhale, 0.02, 0.55);
  const fall = t.j(0.3, 0.2);
  t.put(out, burst(t, 0.4, 30, 240, 0.003, 0.09, 4), fall, 0.9);
  t.put(out, thump(t, 0.4, 82 * t.p, 34 * t.p, 0.003, 0.1, 0.5), fall, 0.7);
  t.put(out, rustle(t, 0.6, 900, 6500, 55), fall, 0.22);
  const arm = fall + t.j(0.42, 0.2);
  t.put(out, burst(t, 0.25, 35, 300, 0.003, 0.05, 4), arm, 0.4);
  t.put(out, rustle(t, 0.3, 1200, 7000, 70), arm, 0.12);
  const dn = t.n(3.1);
  const drone = new Float32Array(dn);
  for (const [ratio, amp] of [[1, 1], [1.5, 0.45], [2.01, 0.2]] as const) {
    const s = tone(dn, t.sr, sampled(dn, (u) => 58 * ratio * Math.pow(0.8, u)));
    for (let i = 0; i < dn; i++) drone[i]! += amp * s[i]!;
  }
  adsr(drone, t.sr, 0.9, 0.8, 0.7, 1.5);
  t.put(out, drone, 0.2, 0.3);
  return out;
}

// --- the valley -------------------------------------------------------------------------------

/**
 * Morning wind over the ridge, stereo: soft gusty breaths (a dark bed that
 * opens a little with each gust) and, riding the gusts, the fine hiss of a
 * whole slope of long grass — blades brushing blades, shimmering as they
 * flutter — with the seed heads' softer swish beneath. Nothing here for the
 * wind to whistle through. The gusts are periodic in the loop, so it loops
 * exactly; the second channel is the same loop turned round by half a
 * second, so the gusts cross the ridge from one ear to the other.
 */
export function ridgeWindGrass(t: Take): Mono[] {
  const r = t.rng;
  const sr = t.sr;
  const length = t.n(r.range(7.8, 8.6));
  const n = length + t.n(0.9);
  const gust = periodicCurve(n, length, r, [1, 2, 3, 5], 0.7);
  const bed = pink(n, r);
  svf(bed, sr, "lp", (u) => (240 + 650 * gust[Math.min(n - 1, Math.floor(u * n))]!) * t.p, 0.7, 64);
  highpass(bed, sr, 40, 2);
  normalize(bed);
  const blades = bandNoise(n, sr, r, 2200, t.c(9500), 2);
  const heads = bandNoise(n, sr, r, 600, 2400, 2);
  const flutter = wobble(n, sr, 24, () => r.next());
  const sway = wobble(n, sr, 3, () => r.next());
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = gust[i]!;
    const f = 0.65 + 0.35 * Math.abs(flutter[i]!);
    out[i] = bed[i]! * g * 0.8 + blades[i]! * g * g * f * 0.22 + heads[i]! * g * (0.7 + 0.3 * sway[i]!) * 0.1;
  }
  const left = loopify(out, length);
  return [left, rotate(left, t.n(r.range(0.4, 0.7)))];
}

/**
 * The river far below: a rush of white water heard from 60 m up and half a
 * kilometre off — dark, broadband, its detail long gone, swelling slowly
 * as the wind carries it up the slope and away.
 */
export function ridgeRiver(t: Take): Mono {
  const r = t.rng;
  const sr = t.sr;
  const length = t.n(r.range(6.6, 7.4));
  const n = length + t.n(0.7);
  const swell = periodicCurve(n, length, r, [1, 2, 3], 0.3, 1);
  const body = brown(n, r);
  lowpass(body, sr, t.c(700), 2);
  highpass(body, sr, 35, 2);
  normalize(body);
  const rush = pink(n, r);
  lowpass(rush, sr, t.c(1800), 2);
  highpass(rush, sr, 150, 2);
  normalize(rush);
  const top = bandNoise(n, sr, r, 1500, 4500, 2);
  for (let i = 0; i < n; i++) body[i] = (0.75 * body[i]! + 0.45 * rush[i]! + 0.06 * top[i]!) * swell[i]!;
  return loopify(body, length);
}

/** One bird note: a near-pure whistle on a pitch curve (Hz over u), rising in over ``attack`` of it and falling away. */
function birdNote(out: Mono, t: Take, at: number, seconds: number, f: Curve, gain: number, attack = 0.15): void {
  const n = t.n(seconds);
  const note = tone(n, t.sr, sampled(n, f, 8), 0.06, 0.02);
  shapeBy(note, (u) => smooth(u / attack) * (u > 0.6 ? smooth((1 - u) / 0.4) : 1), 8);
  t.put(out, note, at, gain);
}

/** A blackbird-like phrase, near: three to six fluted notes gliding and turning, sometimes a high twitter to end. */
function warble(out: Mono, t: Take, at: number, gain: number): void {
  const r = t.rng;
  let when = at;
  for (let k = 0, notes = r.int(3, 7); k < notes; k++) {
    const len = r.range(0.07, 0.2);
    const a = r.range(1400, 2700);
    const b = a * r.range(0.75, 1.35);
    const turn = r.range(0.2, 0.6);
    birdNote(out, t, when, len, (u) => (u < turn ? lerp(a, b, u / turn) : lerp(b, 0.9 * a + 0.1 * b, (u - turn) / (1 - turn))), gain * r.range(0.6, 1));
    when += len + r.range(0.03, 0.09);
  }
  if (r.chance(0.5)) {
    const len = r.range(0.12, 0.22);
    const c = r.range(3500, 5000);
    const rate = r.range(40, 70);
    birdNote(out, t, when, len, (u) => c * (1 + 0.08 * Math.sin(2 * Math.PI * rate * u * len)), gain * 0.35, 0.1);
  }
}

/** A chaffinch-like trill, farther off: a run of quick notes falling in pitch, ending in a flourish. */
function trill(out: Mono, t: Take, at: number, gain: number): void {
  const r = t.rng;
  const count = r.int(8, 14);
  const gap = r.range(0.055, 0.075);
  const top = r.range(4200, 5200);
  const bottom = top * r.range(0.55, 0.7);
  for (let k = 0; k < count; k++) {
    const f = lerp(top, bottom, k / (count - 1));
    birdNote(out, t, at + k * gap, 0.04, (u) => f * (1.12 - 0.25 * u), gain * (0.7 + 0.3 * Math.sin((Math.PI * k) / count)), 0.2);
  }
  const fl = at + count * gap + 0.02;
  birdNote(out, t, fl, 0.26, (u) => (u < 0.4 ? lerp(bottom * 1.3, top * 0.95, u / 0.4) : lerp(top * 0.95, bottom * 0.9, (u - 0.4) / 0.6)), gain * 0.9, 0.1);
}

/** A great tit, far: *tee-cha, tee-cha*, two to four times. */
function teeCha(out: Mono, t: Take, at: number, gain: number): void {
  const r = t.rng;
  const hi = r.range(4800, 5600);
  const lo = hi * r.range(0.7, 0.78);
  const period = r.range(0.26, 0.32);
  for (let k = 0, reps = r.int(2, 5); k < reps; k++) {
    birdNote(out, t, at + k * period, 0.1, (u) => hi * (1.02 - 0.04 * u), gain, 0.2);
    birdNote(out, t, at + k * period + 0.13, 0.08, (u) => lo * (1 - 0.05 * u), gain * 0.8, 0.2);
  }
}

/**
 * Dawn birdsong, near and far: a blackbird's fluted phrases close by, a
 * chaffinch's trill farther down the slope, a tit calling from the trees
 * beyond — sparse, with room between. Every phrase is placed in the loop
 * and wrapped round, so one that runs past the end finishes at the start.
 */
export function ridgeBirds(t: Take): Mono {
  const r = t.rng;
  const seconds = r.range(9.6, 10.8);
  const length = t.n(seconds);
  const pad = t.n(2.4);
  const near = new Float32Array(length + pad);
  const far = new Float32Array(length + pad);
  for (let at = r.range(0.1, 0.8); at < seconds - 0.3; at += r.range(2.8, 4.2)) warble(near, t, at, 0.5);
  for (let at = r.range(1.2, 2.2); at < seconds - 0.3; at += r.range(4.0, 5.8)) trill(far, t, at, 0.5);
  for (let at = r.range(0.4, 3.0); at < seconds - 0.3; at += r.range(3.2, 5)) teeCha(far, t, at, 0.3);
  lowpass(far, t.sr, t.c(6500), 2);
  for (let i = 0; i < near.length; i++) near[i]! += 0.6 * far[i]!;
  return wrap(near, length);
}

/**
 * A cow shifting in the meadow, its bell clanking one to three times as the
 * clapper swings. Half the takes are a hammered sheet-iron bell (a
 * *Treichel*: hollow, tinny, many close partials dying fast), half a small
 * cast bronze one (clearer, longer). Each strike excites the bell a little
 * differently, as the clapper hits a different spot.
 */
export function ridgeCowbell(t: Take): Mono {
  const r = t.rng;
  const strikes = 1 + (t.index % 3);
  const bronze = t.index % 2 === 1;
  const base = (bronze ? r.range(560, 760) : r.range(380, 560)) * t.p;
  const times: number[] = [];
  let at = 0.005;
  for (let k = 0; k < strikes; k++) {
    times.push(at);
    at += r.range(0.13, 0.36);
  }
  const out = t.canvas(times[times.length - 1]! + t.L(bronze ? 1.0 : 0.85));
  // [ratio, level, tau]
  const table: [number, number, number][] = bronze
    ? [[1, 1, 0.45], [2.08, 0.5, 0.28], [2.9, 0.35, 0.18], [3.9, 0.22, 0.1], [5.2, 0.12, 0.06]]
    : [[1, 1, 0.24], [1.34, 0.7, 0.16], [1.93, 0.55, 0.11], [2.46, 0.4, 0.08], [3.1, 0.3, 0.05], [3.8, 0.2, 0.035], [4.7, 0.12, 0.025]];
  let force = 1;
  for (const when of times) {
    t.put(out, click(t.sr, r, 0.002, 800, 9000), when, 0.35 * force);
    t.put(out, burst(t, 0.03, 250, t.c(4000), 0.0003, 0.003), when, 0.4 * force);
    for (const [ratio, level, tau] of table) {
      addMode(out, t.sr, when, base * ratio * (1 + r.range(-0.008, 0.008)), level * force * r.range(0.6, 1.2) * r.sign(), t.d(tau), 0);
    }
    // The hollow of the bell: its air, a low short *tonk*.
    addMode(out, t.sr, when, base * 0.55, 0.3 * force, 0.04, 0);
    force *= r.range(0.45, 0.8);
  }
  return out;
}

/**
 * A farm dog down in the valley: two or three barks — a harsh voiced burst
 * with a noisy onset and the pitch falling through it — with the chest
 * behind each.
 */
export function ridgeDog(t: Take): Mono {
  const r = t.rng;
  const count = 2 + (t.index % 2);
  const spacing = count === 2 ? r.range(0.46, 0.6) : r.range(0.3, 0.42);
  const out = t.canvas(0.02 + (count - 1) * spacing * 1.1 + 0.4);
  const base = r.range(300, 420) * t.p;
  for (let k = 0; k < count; k++) {
    const at = 0.01 + k * spacing * r.range(0.95, 1.05);
    const len = r.range(0.13, 0.18);
    const f = base * r.range(0.94, 1.08);
    const bark = vocal(t, len, {
      f0: (u) => f * (1.1 + 0.1 * Math.min(1, u * 8) - 0.5 * u),
      voicing: (u) => Math.min(1, u * 12),
      tension: 0.9,
      jitter: 0.05,
      shimmer: 0.25,
      breath: 0.25,
      rasp: 0.3,
      tract: [
        { f: (u) => lerp(720, 520, u), q: 5, amp: 1 },
        { f: (u) => lerp(1500, 1000, u), q: 6, amp: 0.7 },
        { f: () => 2700, q: 8, amp: 0.35 },
        { f: () => 3800, q: 10, amp: 0.12 },
      ],
      level: (u) => Math.min(1, u * 30) * Math.pow(1 - u, 0.8),
    });
    t.put(out, bark, at, k === count - 1 ? 0.85 : 1);
    t.put(out, burst(t, 0.08, 80, 400, 0.002, 0.02, 4), at, 0.25);
  }
  return out;
}

/** The chapel bell across the valley, struck once: smaller than a church's, so higher and a little shorter. */
export function ridgeChurchBell(t: Take): Mono {
  return bellStrike(t, t.rng.range(760, 820) * t.p, t.L(5.0), 0.85);
}

/**
 * The dam's siren through its loudspeaker: a hand-cranked style wail. The
 * rotor, spun up by the crank, chops the air through its ports into a
 * pulse whose pitch is its speed — two rotors, a minor third apart, the
 * classic warning chord — rising over a second and a half (quickly, then
 * easing as it nears top speed), held with the crank's uneven strokes
 * wobbling it, then left to coast down. Driven hard through a horn: rough
 * and brassy, no deep bass, no air on top.
 */
export function ridgeSiren(t: Take): Mono {
  const r = t.rng;
  const sr = t.sr;
  const rise = t.j(1.5, 0.1);
  const hold = t.j(2.6, 0.15);
  const fall = t.j(2.7, 0.1);
  const seconds = rise + hold + fall;
  const n = t.n(seconds);
  const top = r.range(400, 460) * t.p;
  const low = top * 0.25;
  const crank = r.range(1.1, 1.6);
  const speed = sampled(n, (u) => {
    const s = u * seconds;
    if (s < rise) return low + ((top - low) * (1 - Math.exp((-3 * s) / rise))) / (1 - Math.exp(-3));
    if (s < rise + hold) return top * (1 + 0.012 * Math.sin(2 * Math.PI * crank * (s - rise)));
    return top * Math.pow(0.22, Math.pow((s - rise - hold) / fall, 1.4));
  });
  const second = new Float32Array(n);
  for (let i = 0; i < n; i++) second[i] = speed[i]! * 1.2;
  const a = saw(n, sr, speed, 0.4, r.next());
  const b = saw(n, sr, second, 0.4, r.next());
  const air = bandNoise(n, sr, r, 400, 3500, 2);
  const rough = wobble(n, sr, 45, () => r.next());
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = speed[i]! / top;
    const v = (a[i]! + 0.55 * b[i]!) * (0.85 + 0.15 * rough[i]!) + 0.35 * air[i]! * (0.5 + 0.25 * a[i]!);
    out[i] = soft(1.8 * v * x * Math.sqrt(x));
  }
  highpass(out, sr, 220, 2);
  biquad(out, sr, "peak", 700, 1.2, 5);
  biquad(out, sr, "peak", 1700, 1.6, 4);
  lowpass(out, sr, 4500, 2);
  return fade(out, sr, 0.03, 0.12);
}

/**
 * A goat's bleat, *meh-eh-eh*: the mouth closed for a moment (a nasal *m*),
 * then open on a pressed, nasal *eh*, pulsing — pitch and level together —
 * seven to nine times a second.
 */
export function ridgeGoat(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.15));
  const len = t.j(0.85, 0.15);
  const f0 = r.range(330, 430) * t.p;
  const rate = r.range(7, 9.5);
  const ph = r.range(0, 6.28);
  const bleat = vocal(t, len, {
    f0: (u) => f0 * (0.92 + 0.14 * Math.min(1, u * 5) - 0.12 * u) * (1 + 0.06 * Math.sin(2 * Math.PI * rate * u * len + ph)),
    tension: 0.85,
    jitter: 0.03,
    shimmer: 0.2,
    breath: 0.15,
    rasp: 0.15,
    tract: [
      { f: () => 260, q: 6, amp: 0.6 },
      { f: (u) => lerp(420, 680, u * 5), q: 5, amp: 1 },
      { f: () => 1850, q: 7, amp: 0.7 },
      { f: () => 2750, q: 9, amp: 0.35 },
    ],
    level: (u) => Math.min(1, u * 15) * (u < 0.85 ? 1 : (1 - u) / 0.15) * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(2 * Math.PI * rate * u * len + ph))),
  });
  t.put(out, bleat, 0.01, 1);
  return out;
}

/**
 * A cow's moo: the mouth shut on a low hum (*mmm*), opening to a round
 * *ooo* as the pitch lifts, then closing and falling away — slow, heavy,
 * a little rough.
 */
export function ridgeCowMoo(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(2.0));
  const len = t.j(1.55, 0.12);
  const base = r.range(105, 140) * t.p;
  const moo = vocal(t, len, {
    f0: (u) => base * (0.85 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.3)) - 0.1 * u),
    tension: 0.6,
    jitter: 0.02,
    shimmer: 0.15,
    breath: 0.2,
    rasp: 0.2,
    tract: [
      { f: () => 220, q: 5, amp: 0.8 },
      { f: (u) => (u < 0.5 ? lerp(260, 520, u / 0.5) : lerp(520, 380, (u - 0.5) / 0.5)), q: 5, amp: 1 },
      { f: (u) => (u < 0.5 ? lerp(700, 950, u / 0.5) : lerp(950, 800, (u - 0.5) / 0.5)), q: 6, amp: 0.5 },
      { f: () => 2300, q: 8, amp: 0.12 },
    ],
    level: (u) => Math.min(1, u * 5) ** 1.5 * (u < 0.8 ? 1 : (1 - u) / 0.2),
  });
  t.put(out, moo, 0.01, 1);
  return out;
}

/** A sheep's bleat, *baa*: higher and shorter than the goat's, with a quicker tremble. */
export function ridgeSheep(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  const len = t.j(0.55, 0.15);
  const f0 = r.range(430, 520) * t.p;
  const rate = r.range(10, 12.5);
  const baa = vocal(t, len, {
    f0: (u) => f0 * (0.95 + 0.08 * Math.min(1, u * 6) - 0.1 * u) * (1 + 0.04 * Math.sin(2 * Math.PI * rate * u * len)),
    tension: 0.8,
    jitter: 0.03,
    shimmer: 0.18,
    breath: 0.2,
    rasp: 0.1,
    tract: [
      { f: (u) => lerp(600, 900, u * 4), q: 5, amp: 1 },
      { f: () => 1500, q: 6, amp: 0.6 },
      { f: () => 2600, q: 8, amp: 0.3 },
    ],
    level: (u) => Math.min(1, u * 14) * (u < 0.8 ? 1 : (1 - u) / 0.2) * (0.7 + 0.3 * Math.sin(2 * Math.PI * rate * u * len)),
  });
  t.put(out, baa, 0.01, 1);
  return out;
}

/** A raptor's scream: a tone with its own harmonics and a hoarse breath tuned around it, roughened by a fast flutter. */
function scream(t: Take, seconds: number, f: Curve, rasp: number, noise: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const freq = sampled(n, f, 8);
  const body = tone(n, t.sr, freq, 0.45, 0.2);
  const air = svf(white(n, r), t.sr, "bp", freq, 7);
  normalize(air);
  const rough = wobble(n, t.sr, r.range(90, 140), () => r.next());
  for (let i = 0; i < n; i++) body[i] = body[i]! * (1 - rasp * Math.abs(rough[i]!)) + noise * air[i]!;
  return shapeBy(body, (u) => smooth(u / 0.08) * (u > 0.7 ? smooth((1 - u) / 0.3) : 1));
}

/** An eagle over the valley: a short clean *kee* rising, then a long hoarse *ahh* falling away. */
export function ridgeEagle(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.3));
  const f = r.range(2600, 3100) * t.p;
  const keeLen = t.j(0.13, 0.15);
  t.put(out, scream(t, keeLen, (u) => f * (0.9 + 0.15 * u), 0.15, 0.25), 0.01, 0.8);
  const len = t.j(0.7, 0.15);
  const ahh = scream(t, len, (u) => f * (1.12 - 0.42 * u ** 0.8) * (1 + 0.012 * Math.sin(2 * Math.PI * 9 * u * len)), 0.45, 0.55);
  t.put(out, ahh, 0.01 + keeLen + r.range(0.03, 0.06), 1);
  return out;
}

/**
 * A rubber duck squeezed: air forced out through the squeaker's reed — a
 * buzzy tone rising as the squeeze tightens and sagging as it empties,
 * coloured by the hollow rubber body — then squeezed again.
 */
function squeak(t: Take, seconds: number, f0: number, f1: number, f2: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const freq = sampled(n, (u) => (u < 0.3 ? lerp(f0, f1, smooth(u / 0.3)) : lerp(f1, f2, ((u - 0.3) / 0.7) ** 1.5)), 8);
  const reed = saw(n, t.sr, freq, 0.2, r.next());
  const body = formants(reed, t.sr, [{ freq: 1200, q: 2, amp: 0.4 }, { freq: 2300, q: 3, amp: 1 }, { freq: 3900, q: 5, amp: 0.5 }]);
  normalize(body);
  const air = svf(white(n, r), t.sr, "bp", freq, 6);
  normalize(air);
  const flutter = wobble(n, t.sr, 60, () => r.next());
  for (let i = 0; i < n; i++) body[i] = body[i]! * (0.9 + 0.1 * flutter[i]!) + 0.2 * air[i]!;
  return shapeBy(body, (u) => smooth(u / 0.08) * (u > 0.75 ? smooth((1 - u) / 0.25) : 1));
}

/** Somebody's rubber duck on a fence post, shot at: two squeezes, *squee-squeek*. */
export function ridgeDuckSqueak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.7));
  const base = r.range(1000, 1400) * t.p;
  const len1 = t.j(0.17, 0.15);
  t.put(out, puff(t, 0.08, 1200, 0.01, 0.02), 0.004, 0.25);
  t.put(out, squeak(t, len1, base * 0.8, base * 1.15, base * 0.95), 0.01, 1);
  const at2 = 0.01 + len1 + t.j(0.11, 0.2);
  t.put(out, puff(t, 0.08, 1200, 0.01, 0.02), at2 - 0.006, 0.2);
  t.put(out, squeak(t, t.j(0.2, 0.15), base * 0.85, base * 1.25, base * 0.9), at2, 0.9);
  return out;
}

/**
 * A diesel army truck on the gravel road, a few hundred metres off, loops.
 * A six-cylinder at about 1400 rpm fires 70 times a second: each cylinder
 * a puff through the exhaust with the hard knock of compression ignition in
 * it, one cylinder a little weaker than the next, so the engine *chugs* at
 * its cycle rate rather than buzzing. The loop holds a whole number of
 * engine cycles, so the firing never stumbles at the seam. Under it the
 * tyres rumble on the road with stones popping from under them, and the
 * gearbox whines faintly.
 */
export function ridgeTruck(t: Take): Mono {
  const r = t.rng;
  const sr = t.sr;
  const cycleRate = (r.range(1250, 1550) * t.p) / 120;
  const cycles = Math.round(r.range(3.7, 4.3) * cycleRate);
  const seconds = cycles / cycleRate;
  const length = t.n(seconds);
  const cylinders = 6;
  const puffs: Mono[] = [];
  for (let c = 0; c < cylinders; c++) {
    const p = t.canvas(0.06);
    t.put(p, burst(t, 0.06, 35, t.c(520) * r.range(0.85, 1.15), 0.0015, 0.009 * r.range(0.8, 1.2), 2), 0, r.range(0.7, 1));
    t.put(p, burst(t, 0.02, 900, t.c(3800), 0.0002, 0.0022, 2), 0.001, r.range(0.12, 0.25));
    puffs.push(p);
  }
  const firings = cycles * cylinders;
  const render = new Float32Array(length + t.n(0.2));
  for (let k = 0; k < firings; k++) {
    t.put(render, puffs[k % cylinders]!, 0.004 + (k * seconds) / firings + r.range(-0.0005, 0.0005), r.range(0.85, 1.1));
  }
  biquad(render, sr, "peak", t.c(95), 1.2, 6);
  biquad(render, sr, "peak", t.c(340), 1.5, 4);
  lowpass(render, sr, t.c(2600), 2);
  const engine = normalize(wrap(render, length));
  const n = length + t.n(0.5);
  const rumble = brown(n, r);
  lowpass(rumble, sr, t.c(260), 2);
  highpass(rumble, sr, 30, 2);
  normalize(rumble);
  const bump = wobble(n, sr, 7, () => r.next());
  for (let i = 0; i < n; i++) rumble[i]! *= 0.7 + 0.3 * bump[i]!;
  const road = loopify(rumble, length);
  const stones = new Float32Array(length + t.n(0.1));
  for (let k = 0, count = Math.round(seconds * r.range(30, 45)); k < count; k++) {
    const w = r.range(0.0015, 0.004);
    const grain = bandNoise(t.n(w), sr, r, r.range(500, 900), 4000, 2);
    perc(grain, sr, 0.0001, w / 3);
    t.put(stones, grain, r.range(0.01, seconds + 0.01), r.range(0.1, 0.35));
  }
  const crunch = wrap(stones, length);
  // The whine: a whole number of cycles in the loop, its level swaying twice round it.
  const whineHz = (Math.round((r.range(620, 820) * t.p * length) / sr) * sr) / length;
  const whine = tone(length, sr, new Float32Array(length).fill(whineHz));
  const sway = sampled(length, (u) => 0.7 + 0.3 * Math.sin(2 * Math.PI * 2 * u));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = engine[i]! + 0.45 * road[i]! + 0.25 * crunch[i]! + 0.06 * whine[i]! * sway[i]!;
  return out;
}

/**
 * An engine block holed: the cooling system lets go — a hard spit, then a
 * jet of steam, broadband and high, falling in pitch and force as the
 * pressure bleeds away and sputtering as water comes with it, over the low
 * whoosh of the cloud.
 */
export function ridgeSteam(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(2.2);
  const n = t.n(seconds);
  const out = t.canvas(seconds + 0.05);
  t.put(out, click(t.sr, r, 0.004, 800, 12000), 0, t.g(0.7));
  t.put(out, burst(t, 0.06, 1200, t.c(12000), 0.0005, 0.012), 0, t.g(0.6));
  const jet = white(n, r);
  highpass(jet, t.sr, 700, 2);
  svf(jet, t.sr, "bp", (u) => t.c(6500) * Math.pow(0.35, u), 0.7, 32);
  normalize(jet);
  const sputter = wobble(n, t.sr, 16, () => r.next());
  const fast = wobble(n, t.sr, 90, () => r.next());
  for (let i = 0; i < n; i++) {
    const depth = 0.15 + 0.6 * (i / n);
    jet[i]! *= (1 - depth + depth * Math.abs(sputter[i]!)) * (0.85 + 0.15 * fast[i]!);
  }
  const decay = t.d(0.7);
  shapeBy(jet, (u) => smooth((u * seconds) / 0.015) * Math.exp((-u * seconds) / decay) * (u > 0.85 ? smooth((1 - u) / 0.15) : 1));
  t.put(out, jet, 0.003, 1);
  t.put(out, puff(t, seconds * 0.6, 700, 0.01, t.d(0.25)), 0.002, t.g(0.35));
  return out;
}

/** A pea whistle blast: a tone near 3 kHz warbling as the pea is blown round its chamber, a chiff to start, breath around it. */
function peaBlast(t: Take, seconds: number, f: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const rate = r.range(28, 40);
  const ph = r.range(0, 6.28);
  const freq = sampled(n, (u) => {
    const s = u * seconds;
    return f * (1 + 0.035 * Math.sin(2 * Math.PI * rate * s + ph)) * (1 - 0.03 * Math.exp(-s / 0.02));
  }, 8);
  const body = tone(n, t.sr, freq, 0.12, 0.04);
  const am = sampled(n, (u) => 0.7 + 0.3 * Math.sin(2 * Math.PI * rate * u * seconds + ph + 0.8), 8);
  const breath = svf(white(n, r), t.sr, "bp", freq, 12);
  normalize(breath);
  const air = bandNoise(n, t.sr, r, 2000, 9000, 2);
  for (let i = 0; i < n; i++) body[i] = body[i]! * am[i]! + 0.25 * breath[i]! + 0.04 * air[i]!;
  shapeBy(body, (u) => smooth((u * seconds) / 0.015) * smooth(((1 - u) * seconds) / 0.03), 8);
  t.put(body, burst(t, 0.03, 1500, 8000, 0.001, 0.006), 0, 0.3);
  return body;
}

/** A sentry raising the alarm on a pea whistle: two or three shrill blasts. */
export function ridgeWhistleAlarm(t: Take): Mono {
  const r = t.rng;
  const patterns: readonly (readonly number[])[] = [[0.2, 0.2, 0.62], [0.48, 0.72], [0.3, 0.3, 0.3]];
  const pattern = patterns[t.index % patterns.length]!;
  const f = r.range(2800, 3300) * t.p;
  let at = 0.01;
  const blasts: [number, number][] = [];
  for (const len of pattern) {
    const l = len * r.range(0.9, 1.1);
    blasts.push([at, l]);
    at += l + r.range(0.1, 0.16);
  }
  const out = t.canvas(at + 0.05);
  for (const [when, len] of blasts) t.put(out, peaBlast(t, len, f * r.range(0.99, 1.01)), when, 1);
  return out;
}

/**
 * A wheel of hard mountain cheese loose on a stony lane: it rolls on its
 * rind like a wooden wheel, gathering pace downhill — a rumble thickening
 * with speed, pulsing once a turn where the rind is worn flat — knocking on
 * stones, leaving the ground two or three times and landing heavier, until
 * it runs off into the meadow: a soft plop in the grass, and it rocks to
 * rest.
 */
export function ridgeCheeseRoll(t: Take): Mono {
  const r = t.rng;
  const sr = t.sr;
  const roll = t.L(r.range(3.2, 3.9));
  const out = t.canvas(roll + 1.2);
  const n = t.n(roll);
  const w0 = r.range(1.2, 1.7);
  const w1 = r.range(3.8, 5);
  const bounces: [number, number][] = [];
  for (let k = 0, count = r.int(2, 4); k < count; k++) {
    bounces.push([roll * r.range(0.3 + k * 0.18, 0.4 + k * 0.18), r.range(0.08, 0.18)]);
  }
  const airborne = (s: number): boolean => bounces.some(([b, len]) => s >= b && s < b + len);
  const rumble = pink(n, r);
  svf(rumble, sr, "lp", (u) => 180 + 420 * u, 0.9, 64);
  highpass(rumble, sr, 45, 2);
  normalize(rumble);
  // Its envelope, once a turn, block by block (a turn takes a fifth of a second at the fastest).
  let phase = 0;
  let grounded = 0;
  let g0 = 0;
  for (let i = 0; i < n; i += 32) {
    const u = i / n;
    phase += ((w0 + (w1 - w0) * Math.pow(u, 1.2)) * 32) / sr;
    grounded += ((airborne(i / sr) ? 0 : 1) - grounded) * 0.2;
    const c = Math.cos(2 * Math.PI * phase);
    const c4 = c * c * c * c;
    const g1 = (0.6 + 0.4 * c4) * (0.35 + 0.65 * u) * grounded * smooth(u * 12) * (u > 0.97 ? smooth((1 - u) / 0.03) : 1);
    for (let k = i; k < Math.min(n, i + 32); k++) rumble[k]! *= g0 + ((g1 - g0) * (k - i)) / 32;
    g0 = g1;
  }
  t.put(out, rumble, 0, 0.5);
  for (let s = r.range(0.1, 0.3); s < roll - 0.05; ) {
    const u = s / roll;
    if (!airborne(s)) {
      const g = r.range(0.25, 0.7) * (0.5 + 0.5 * u);
      t.put(out, knock(t, r.range(150, 240) * t.p, t.d(0.03), 1), s, g * 0.5);
      t.put(out, thump(t, 0.12, 110, 55, 0.001, 0.025, 0.5), s, g * 0.5);
      t.put(out, click(sr, r, 0.002, 800, 6000), s, g * 0.25);
    }
    s += r.range(0.12, 0.45) / (0.6 + 0.8 * u);
  }
  for (const [b, len] of bounces) {
    t.put(out, burst(t, 0.2, 40, t.c(420), 0.001, 0.035, 4), b + len, 0.8);
    t.put(out, knock(t, r.range(130, 190) * t.p, t.d(0.045), 1), b + len, 0.55);
  }
  t.put(out, burst(t, 0.3, 35, t.c(260), 0.002, 0.05, 4), roll, 0.9);
  t.put(out, thump(t, 0.25, 95 * t.p, 42 * t.p, 0.003, 0.05, 0.5), roll, 0.7);
  t.put(out, rustle(t, 0.35, 1200, 7000, 60), roll, 0.25);
  let gap = r.range(0.16, 0.22);
  let at = roll + 0.25;
  let g = 0.3;
  for (let k = 0, rocks = r.int(3, 6); k < rocks && at < roll + 1.05; k++) {
    t.put(out, burst(t, 0.1, 40, 300, 0.002, 0.02, 4), at, g);
    t.put(out, rustle(t, 0.08, 1500, 6000, 80), at, g * 0.4);
    at += gap;
    gap *= 0.72;
    g *= 0.72;
  }
  return out;
}

/**
 * Something on the far slope, faint and not quite placeable: a low,
 * breathy hoot, *hooo*, the lips rounded and the pitch lifting and sinking,
 * a catch, and a short grunted *uh*. A little of the far valley's air is
 * baked into it: this one should never sound close.
 */
export function ridgeYeti(t: Take): Mono {
  const r = t.rng;
  const base = r.range(85, 110) * t.p;
  const hooLen = t.j(0.95, 0.12);
  const uhLen = t.j(0.32, 0.15);
  const gap = r.range(0.08, 0.14);
  const dry = t.canvas(hooLen + gap + uhLen + 0.1);
  const hoo = vocal(t, hooLen, {
    f0: (u) => base * (1 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 0.1 * u),
    tension: 0.35,
    jitter: 0.03,
    shimmer: 0.15,
    breath: 0.5,
    rasp: 0.25,
    tract: [
      { f: (u) => lerp(300, 360, u), q: 6, amp: 1 },
      { f: (u) => lerp(650, 720, u), q: 7, amp: 0.35 },
      { f: () => 2300, q: 8, amp: 0.06 },
    ],
    level: (u) => Math.min(1, u * 4) ** 1.5 * (u < 0.8 ? 1 : (1 - u) / 0.2),
  });
  t.put(dry, hoo, 0.01, 1);
  const uh = vocal(t, uhLen, {
    f0: (u) => base * 0.82 * (1 - 0.15 * u),
    tension: 0.75,
    breath: 0.3,
    rasp: 0.5,
    tract: [
      { f: () => 520, q: 5, amp: 1 },
      { f: () => 1150, q: 6, amp: 0.4 },
      { f: () => 2400, q: 8, amp: 0.1 },
    ],
    level: (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.2),
  });
  t.put(dry, uh, 0.01 + hooLen + gap, 0.8);
  biquad(dry, t.sr, "lowshelf", 180, 0.7, 4);
  return roomMono(dry, t.sr, r, { t60: 1.6, size: 1, damping: 0.3, mix: 0.3, predelay: 0.04, tail: 0.5 });
}

/**
 * The player's shot coming back off a great cliff: all its crack gone to
 * the air on the way, and the face — not flat, a spread of buttresses and
 * gullies — returning the report as dozens of reflections over a tenth of a
 * second: a dark, blurred boom that rolls on.
 */
export function ridgeEcho(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.9);
  const out = t.canvas(seconds);
  const spread = t.j(0.12, 0.2);
  for (let k = 0; k < 24; k++) {
    const at = spread * Math.pow(r.next(), 0.8);
    const g = r.range(0.3, 1) * (1 - (0.6 * at) / spread);
    t.put(out, burst(t, 0.18, 90, t.c(1600) * r.range(0.8, 1.2), 0.002, t.d(0.03), 2), at, 0.25 * g * r.sign());
  }
  t.put(out, thump(t, 0.35, 90 * t.p, 40 * t.p, 0.004, t.d(0.08), 0.5), 0.01, t.g(0.6));
  t.put(out, valleyRoll(t, r, seconds - 0.03, 0.12, t.d(0.45)), 0.03, t.g(0.4));
  return lowpass(out, t.sr, t.c(2000), 2);
}

// --- the music: stingers and chimes, in D (pitch exact) ----------------------------------------------

/**
 * A muted horn: a lip reed's buzz (a band-limited sawtooth, a small scoop
 * up into the note) whose brightness follows its loudness as brass does,
 * through the nasal peak of a mute, swelling in over ``swell`` seconds.
 */
function horn(out: Mono, t: Take, at: number, midi: number, dur: number, gain: number, swell = 0.25): void {
  const r = t.rng;
  const n = t.n(dur);
  const f = midiHz(midi) * Math.pow(2, r.range(-3, 3) / 1200);
  const env = sampled(n, (u) => {
    const s = u * dur;
    return smooth(s / swell) * smooth((dur - s) / 0.35);
  });
  const freq = sampled(n, (u) => {
    const s = u * dur;
    return f * (1 - 0.012 * Math.exp(-s / 0.05)) * (1 + 0.004 * Math.sin(2 * Math.PI * 5 * s) * smooth((s - 0.4) / 0.4));
  });
  const buzz = saw(n, t.sr, freq, 0, r.next());
  svf(buzz, t.sr, "lp", (u) => f * (1.2 + 5 * env[Math.min(n - 1, Math.floor(u * n))]!), 0.8, 32);
  biquad(buzz, t.sr, "peak", 1100, 1.4, 4);
  biquad(buzz, t.sr, "highshelf", 3500, 0.7, -8);
  for (let i = 0; i < n; i++) buzz[i]! *= env[i]!;
  t.put(out, buzz, at, gain);
}

/**
 * Low strings: three bowed voices a note, a few cents apart, each with its
 * own vibrato, through a warm body, swelling in over ``attack``.
 */
function strings(out: Mono, t: Take, at: number, notes: readonly number[], dur: number, gain: number, attack: number): void {
  const r = t.rng;
  const n = t.n(dur);
  const sum = new Float32Array(n);
  for (const midi of notes) {
    for (let v = 0; v < 3; v++) {
      const f = midiHz(midi) * Math.pow(2, ((v - 1) * r.range(4, 8)) / 1200);
      const rate = r.range(4.6, 5.8);
      const ph = r.range(0, 6.28);
      const s = saw(n, t.sr, sampled(n, (u) => f * (1 + 0.003 * Math.sin(2 * Math.PI * rate * u * dur + ph))), 0, r.next());
      for (let i = 0; i < n; i++) sum[i]! += s[i]! / notes.length;
    }
  }
  lowpass(sum, t.sr, 2200, 2);
  biquad(sum, t.sr, "peak", 250, 0.8, 3);
  highpass(sum, t.sr, 45, 2);
  adsr(sum, t.sr, attack, 0.3, 0.85, Math.min(0.8, dur * 0.4));
  t.put(out, sum, at, gain);
}

/** A low drum struck with a soft mallet: the membrane's falling thump and its inharmonic modes, felt more than heard. */
function softDrum(out: Mono, t: Take, at: number, f0: number, gain: number): void {
  const r = t.rng;
  t.put(out, thump(t, 1.2, f0 * 1.5, f0, 0.004, 0.22, 0.35), at, gain);
  [1.59, 2.14, 2.3, 2.65].forEach((ratio, k) => {
    addMode(out, t.sr, at, f0 * ratio * r.range(0.99, 1.01), gain * 0.25 * 0.75 ** k, 0.14 * 0.8 ** k, 0);
  });
  t.put(out, burst(t, 0.05, 100, 1500, 0.002, 0.008), at, gain * 0.2);
  t.put(out, burst(t, 0.6, 30, 180, 0.004, 0.12, 4), at, gain * 0.5);
}

/** A music box's tine (a steel cantilever: partials at 1 and 6.27 of the note) plucked by a pin: a clear chime and a tiny tick. */
function chime(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const f = midiHz(midi) * Math.pow(2, t.rng.range(-3, 3) / 1200);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 6.27, gain * 0.2, tau * 0.12, 0);
  addMode(out, t.sr, at, f * 1.002, gain * 0.15, tau * 0.8, 0);
  t.put(out, click(t.sr, t.rng, 0.001, 3000, 12000), at, gain * 0.06);
}

/**
 * A steel string plucked bright and close. The pick leaves the string over a
 * millisecond, and its noise is a pick's, not a file's: the string rings as
 * bright as before, without a crackle at the start that the reward, heard
 * again and again and pitched up a fifth at ×4, made harsh.
 */
function pluck(out: Mono, t: Take, at: number, midi: number, vel: number, t60: number): void {
  const note = t.canvas(t60 + 0.2);
  addString(note, t.sr, t.rng, 0, midiHz(midi), vel, { t60, brightness: 0.9, position: 0.14, hardness: 4500, length: t60, release: 0.15 });
  fade(note, t.sr, 0.001, 0);
  t.put(out, note, at, 1);
  t.put(out, click(t.sr, t.rng, 0.0012, 2000, 9000), at, 0.03 * vel);
}

/**
 * A stage begins: a soft low drum and a brushed shimmer, the low strings
 * swelling on an open D (a fifth with the ninth: cool, not sweet), and a
 * muted horn calling up a fourth, A to D, like an alphorn across the valley.
 */
export function ridgeStageStart(t: Take): Mono[] {
  const r = t.rng;
  const dry = t.canvas(3.4);
  softDrum(dry, t, 0.01, r.range(50, 56), 0.9);
  const shimmer = bandNoise(t.n(0.9), t.sr, r, 5000, 12000, 2);
  adsr(shimmer, t.sr, 0.004, 0.2, 0.2, 0.5);
  t.put(dry, shimmer, 0.01, 0.05);
  strings(dry, t, 0, [38, 45, 50, 52], 3.1, 0.5, 0.9);
  horn(dry, t, t.j(0.35, 0.1), 57, 0.7, 0.4);
  horn(dry, t, t.j(1.0, 0.05), 62, 1.9, 0.5, 0.35);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, r, { t60: 2.2, size: 1, damping: 0.35, mix: 0.35, predelay: 0.03, tail: 0.5 });
}

/**
 * A stage cleared: the strings on A with the fourth suspended, easing onto
 * the third, then home to D; the horn stepping up to the D chord's third
 * over it; a music-box chime on the resolution.
 */
export function ridgeStageClear(t: Take): Mono[] {
  const dry = t.canvas(2.9);
  strings(dry, t, 0, [45, 50, 52, 57], 0.75, 0.45, 0.12);
  strings(dry, t, 0.55, [45, 49, 52, 57], 0.45, 0.4, 0.08);
  strings(dry, t, 0.95, [38, 45, 50, 54, 57], 1.8, 0.5, 0.1);
  horn(dry, t, 0.05, 64, 0.85, 0.3, 0.12);
  horn(dry, t, 0.95, 66, 1.6, 0.4, 0.1);
  chime(dry, t, 0.95, 86, 0.1, 0.5);
  chime(dry, t, t.j(1.07, 0.03), 90, 0.08, 0.6);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, t.rng, { t60: 1.8, size: 0.9, damping: 0.4, mix: 0.3, predelay: 0.02, tail: 0.3 });
}

/** A secret found: a music box turning a little figure up through D major and back down to rest. */
export function ridgeSecret(t: Take): Mono {
  const r = t.rng;
  const tempo = r.range(0.95, 1.05);
  const figure: readonly [number, number][] = [[0, 81], [0.12, 86], [0.24, 90], [0.36, 93], [0.54, 91], [0.66, 90], [0.78, 88]];
  const out = t.canvas(1.9);
  for (const [at, midi] of figure) chime(out, t, 0.01 + at * tempo + r.range(-0.004, 0.004), midi, r.range(0.3, 0.4), 0.35);
  const last = 0.01 + 0.96 * tempo;
  chime(out, t, last, 86, 0.45, 0.8);
  chime(out, t, last + 0.004, 93, 0.25, 0.7);
  tailOff(out, t.sr, 0.3);
  return roomMono(out, t.sr, r, { t60: 0.8, size: 0.5, damping: 0.4, mix: 0.2, predelay: 0.008, tail: 0.2 });
}

/** The streak rises: a bright pluck up a fourth, A to D, a little bell over the second. Exact pitch, so a game can raise it by rate. */
export function ridgeStreak(t: Take): Mono {
  const out = t.canvas(0.62);
  pluck(out, t, 0.005, 81, 0.7, 0.6);
  pluck(out, t, 0.07, 86, 0.8, 0.7);
  chime(out, t, 0.07, 98, 0.06, 0.25);
  return tailOff(out, t.sr, 0.2);
}

/**
 * A kill confirmed: a soft low *thock* — a woodblock struck gently — with
 * the mallet pressing in over a millisecond and a half, so it is a tick you
 * feel rather than a click you hear.
 */
export function ridgeKill(t: Take): Mono {
  const r = t.rng;
  const note = t.canvas(0.2);
  const f = r.range(270, 300);
  addMode(note, t.sr, 0, f, 0.7, t.d(0.028), 0);
  addMode(note, t.sr, 0, f * 2.72, t.g(0.2, 3) * r.sign(), t.d(0.012), 0);
  addMode(note, t.sr, 0, f * 4.3, t.g(0.06, 3) * r.sign(), t.d(0.006), 0);
  t.put(note, burst(t, 0.03, 60, 600, 0.0015, 0.008, 2), 0, 0.2);
  fade(note, t.sr, 0.0015, 0.01);
  return note;
}

/** Game over: the low strings on D minor, a muted horn falling from A to the low D, and a soft drum as it lands. */
export function ridgeGameOver(t: Take): Mono[] {
  const r = t.rng;
  const dry = t.canvas(4.2);
  strings(dry, t, 0, [38, 45, 50, 53], 3.9, 0.55, 0.6);
  horn(dry, t, 0.15, 57, 1.1, 0.35);
  horn(dry, t, 1.25, 50, 2.5, 0.4);
  softDrum(dry, t, 1.25, r.range(42, 46), 0.6);
  tailOff(dry, t.sr, 0.9);
  return room(dry, t.sr, r, { t60: 2.4, size: 1, damping: 0.35, mix: 0.35, predelay: 0.02, tail: 0.4 });
}

/** The golden rifle: its bolt worked, a bright arpeggio chiming up through D major, a glint and a shimmer of high bells. */
export function ridgeGolden(t: Take): Mono[] {
  const r = t.rng;
  const dry = t.canvas(2.8);
  t.put(dry, ridgeBolt(t), 0, 0.4);
  [86, 90, 93, 98, 102].forEach((midi, k) => chime(dry, t, 0.55 + k * 0.085, midi, 0.35, 0.9));
  const glint = white(t.n(0.25), r);
  svf(glint, t.sr, "bp", (u) => 1500 * Math.pow(6, u), 3, 16);
  normalize(glint);
  shapeBy(glint, (u) => Math.sin(Math.PI * u) ** 2);
  t.put(dry, glint, 0.85, 0.18);
  for (let k = 0; k < 10; k++) addMode(dry, t.sr, 0.9 + k * 0.04, r.range(5000, 9500), 0.03, 0.25, 0);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, r, { t60: 1.6, size: 0.9, damping: 0.4, mix: 0.3, predelay: 0.015, tail: 0.2 });
}

// --- the table --------------------------------------------------------------------------------

/**
 * Overwatch Ridge's cues. The mix (dB at the bus, every take normalised to
 * the same loudness first):
 *
 *   0    the player's rifle: the loudest thing in the game
 *  −2    a mortar bomb landing close
 *  −3…−7 the threats: a round cracking past, the counter-sniper, the player hit
 *  −6…−10 hits heard across the valley: clear, but under the shot that caused them
 *  −9…−16 the valley's events: the bell, the siren, the animals
 * −18…−24 beds: wind in the grass, the river, the birds, the player's breath
 *  −9…−16 stingers and interface
 */
export const RIDGE_CUES: Record<string, CueSpec> = {
  // --- the rifle, in the player's hands ------------------------------------------------------
  ridge_rifle_shot: {
    // Stereo, and a stereo cue passes the engine's panner at centre 3 dB louder than a mono one: trimmed
    // so that the player's rifle is as loud as the revolver and the night's rifle (a test pins it).
    recipe: ridgeRifleShot, pack: "ridge", bus: "sfx", level: 0, trim: -3, reverb: 0.12, echo: 0,
    priority: 3, maxInstances: 3, vary: 0.02, takes: 4, expect: [3.0, 5.0],
  },
  ridge_bolt: {
    recipe: ridgeBolt, pack: "ridge", bus: "sfx", level: -9, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.02, expect: [0.5, 0.9],
  },
  ridge_reload: {
    recipe: ridgeReload, pack: "ridge", bus: "sfx", level: -9, reverb: 0.05,
    priority: 3, maxInstances: 1, vary: 0.02, expect: [1.8, 2.4],
  },
  ridge_dry: {
    recipe: ridgeDry, pack: "ridge", bus: "sfx", level: -10, reverb: 0.03,
    priority: 3, maxInstances: 2, vary: 0.03, expect: [0.05, 0.35],
  },
  ridge_scope_in: {
    recipe: ridgeScopeIn, pack: "ridge", bus: "sfx", level: -15,
    priority: 2, maxInstances: 1, vary: 0.04, minGap: 0.08, expect: [0.2, 0.5],
  },
  ridge_scope_out: {
    recipe: ridgeScopeOut, pack: "ridge", bus: "sfx", level: -17,
    priority: 2, maxInstances: 1, vary: 0.04, minGap: 0.08, expect: [0.15, 0.4],
  },
  ridge_breath: {
    recipe: ridgeBreath, pack: "ridge", bus: "self", level: -24, loop: true,
    priority: 3, maxInstances: 1, fadeIn: 0.6, fadeOut: 0.8, vary: 0.02, expect: [3.5, 5.0],
  },

  // --- impacts, heard from far away: they arrive distance / 343 m/s late ---------------------------
  ridge_hit_dirt: {
    recipe: ridgeHitDirt, pack: "ridge", bus: "sfx", level: -8, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 4, vary: 0.07, minGap: 0.03, expect: [0.25, 0.9],
  },
  ridge_hit_rock: {
    recipe: ridgeHitRock, pack: "ridge", bus: "sfx", level: -8, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 4, vary: 0.06, minGap: 0.03, takes: 4, expect: [0.3, 1.3],
  },
  ridge_hit_metal: {
    recipe: ridgeHitMetal, pack: "ridge", bus: "sfx", level: -7, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 3, vary: 0.04, minGap: 0.03, expect: [0.8, 2.2],
  },
  ridge_hit_glass: {
    recipe: ridgeHitGlass, pack: "ridge", bus: "sfx", level: -9, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.3, 1.0],
  },
  ridge_hit_water: {
    recipe: ridgeHitWater, pack: "ridge", bus: "sfx", level: -10, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  ridge_hit_wood: {
    recipe: ridgeHitWood, pack: "ridge", bus: "sfx", level: -9, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.2, 0.8],
  },
  ridge_hit_flesh: {
    recipe: ridgeHitFlesh, pack: "ridge", bus: "sfx", level: -6, reverb: 0.15, travel: true,
    priority: 2, maxInstances: 4, vary: 0.06, minGap: 0.03, expect: [0.15, 0.5],
  },
  ridge_body_fall: {
    recipe: ridgeBodyFall, pack: "ridge", bus: "world", level: -12, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.05, expect: [0.3, 1.0],
  },
  ridge_glass_shatter: {
    recipe: ridgeGlassShatter, pack: "ridge", bus: "sfx", level: -9, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.6, 1.6],
  },

  // --- danger -----------------------------------------------------------------------------
  ridge_crack_near: {
    recipe: ridgeCrackNear, pack: "ridge", bus: "sfx", level: -4, reverb: 0.06,
    priority: 3, maxInstances: 3, vary: 0.08, minGap: 0.04, expect: [0.15, 0.6],
  },
  ridge_far_shot: {
    recipe: ridgeFarShot, pack: "ridge", bus: "sfx", level: -5, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 3, vary: 0.04, takes: 4, expect: [1.5, 4.0],
  },
  ridge_mg_burst: {
    recipe: ridgeMgBurst, pack: "ridge", bus: "sfx", level: -6, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 2, vary: 0.04, expect: [1.0, 2.6],
  },
  ridge_mortar_launch: {
    recipe: ridgeMortarLaunch, pack: "ridge", bus: "sfx", level: -9, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, expect: [0.8, 2.0],
  },
  ridge_mortar_whistle: {
    recipe: ridgeMortarWhistle, pack: "ridge", bus: "sfx", level: -10, reverb: 0.1,
    priority: 2, maxInstances: 3, vary: 0.04, expect: [1.0, 2.2],
  },
  ridge_mortar_blast: {
    recipe: ridgeMortarBlast, pack: "ridge", bus: "sfx", level: -2, reverb: 0.3,
    priority: 3, maxInstances: 3, vary: 0.05, expect: [2.0, 4.2],
  },
  ridge_hurt: {
    recipe: ridgeHurt, pack: "ridge", bus: "sfx", level: -3, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.04, minGap: 0.05, expect: [0.3, 1.0],
  },
  ridge_scope_crack: {
    recipe: ridgeScopeCrack, pack: "ridge", bus: "self", level: -6, reverb: 0.05, steady: true,
    priority: 3, maxInstances: 1, vary: 0.03, expect: [0.4, 1.2],
  },
  ridge_death: {
    recipe: ridgeDeath, pack: "ridge", bus: "self", level: -5, reverb: 0.1, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 4.0],
  },

  // --- the valley ---------------------------------------------------------------------------
  ridge_wind_grass: {
    recipe: ridgeWindGrass, pack: "ridge", bus: "world", level: -18, loop: true,
    priority: 0, maxInstances: 1, fadeIn: 2.5, fadeOut: 2.0, vary: 0.02, expect: [7, 9.5],
  },
  ridge_river: {
    recipe: ridgeRiver, pack: "ridge", bus: "world", level: -22, loop: true,
    priority: 0, maxInstances: 1, fadeIn: 2.0, fadeOut: 2.0, vary: 0.02, expect: [6, 8.5],
  },
  ridge_birds: {
    recipe: ridgeBirds, pack: "ridge", bus: "world", level: -21, loop: true,
    priority: 0, maxInstances: 1, fadeIn: 1.5, fadeOut: 1.5, vary: 0.02, expect: [8, 12],
  },
  ridge_cowbell: {
    recipe: ridgeCowbell, pack: "ridge", bus: "world", level: -16, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 3, vary: 0.03, takes: 5, expect: [0.6, 1.9],
  },
  ridge_dog: {
    recipe: ridgeDog, pack: "ridge", bus: "world", level: -16, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.6, 2.2],
  },
  ridge_church_bell: {
    recipe: ridgeChurchBell, pack: "ridge", bus: "world", level: -9, reverb: 0.4, travel: true,
    priority: 1, maxInstances: 2, vary: 0.005, expect: [3.5, 7.0],
  },
  ridge_siren: {
    recipe: ridgeSiren, pack: "ridge", bus: "world", level: -7, reverb: 0.35, travel: true,
    priority: 1, maxInstances: 1, vary: 0.02, expect: [5, 9],
  },
  ridge_goat: {
    recipe: ridgeGoat, pack: "ridge", bus: "world", level: -12, reverb: 0.25, travel: true,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.5, 1.4],
  },
  ridge_cow_moo: {
    recipe: ridgeCowMoo, pack: "ridge", bus: "world", level: -14, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 1, vary: 0.04, expect: [1.0, 2.5],
  },
  ridge_sheep: {
    recipe: ridgeSheep, pack: "ridge", bus: "world", level: -16, reverb: 0.25, travel: true,
    priority: 0, maxInstances: 2, vary: 0.05, expect: [0.4, 1.2],
  },
  ridge_eagle: {
    recipe: ridgeEagle, pack: "ridge", bus: "world", level: -13, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 1, vary: 0.04, expect: [0.6, 1.8],
  },
  ridge_duck_squeak: {
    recipe: ridgeDuckSqueak, pack: "ridge", bus: "world", level: -10, reverb: 0.2, travel: true,
    priority: 1, maxInstances: 1, vary: 0.05, expect: [0.3, 0.9],
  },
  ridge_truck: {
    recipe: ridgeTruck, pack: "ridge", bus: "world", level: -14, loop: true,
    priority: 1, maxInstances: 2, fadeIn: 1.5, fadeOut: 1.5, vary: 0.03, expect: [3, 5],
  },
  ridge_steam: {
    recipe: ridgeSteam, pack: "ridge", bus: "world", level: -12, reverb: 0.2, travel: true,
    priority: 1, maxInstances: 2, vary: 0.05, expect: [1.2, 3.0],
  },
  ridge_whistle_alarm: {
    recipe: ridgeWhistleAlarm, pack: "ridge", bus: "world", level: -10, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 1, vary: 0.02, expect: [0.8, 2.2],
  },
  ridge_cheese_roll: {
    recipe: ridgeCheeseRoll, pack: "ridge", bus: "world", level: -13, reverb: 0.2, travel: true,
    priority: 1, maxInstances: 1, vary: 0.04, expect: [3, 6],
  },
  ridge_yeti: {
    recipe: ridgeYeti, pack: "ridge", bus: "world", level: -14, reverb: 0.35, travel: true,
    priority: 1, maxInstances: 1, vary: 0.03, expect: [1.0, 2.5],
  },
  ridge_echo: {
    recipe: ridgeEcho, pack: "ridge", bus: "world", level: -8, reverb: 0.3,
    priority: 2, maxInstances: 2, vary: 0.03, expect: [1.0, 2.5],
  },

  // --- stingers and interface (pitch exact: vary 0) -------------------------------------------------
  ridge_stage_start: {
    recipe: ridgeStageStart, pack: "ridge", bus: "sfx", steady: true, level: -9, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2, 4.5],
  },
  ridge_stage_clear: {
    recipe: ridgeStageClear, pack: "ridge", bus: "sfx", steady: true, level: -10, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4],
  },
  ridge_secret: {
    recipe: ridgeSecret, pack: "ridge", bus: "ui", level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 2.6],
  },
  ridge_streak: {
    recipe: ridgeStreak, pack: "ridge", bus: "ui", level: -13,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 0.9],
  },
  ridge_kill: {
    recipe: ridgeKill, pack: "ridge", bus: "ui", level: -16,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.08, 0.4],
  },
  ridge_game_over: {
    recipe: ridgeGameOver, pack: "ridge", bus: "ui", level: -9,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 6],
  },
  ridge_golden: {
    recipe: ridgeGolden, pack: "ridge", bus: "ui", level: -9,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4],
  },
  ridge_plate_ring: {
    recipe: ridgePlateRing, pack: "ridge", bus: "sfx", level: -8, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 3, vary: 0, minGap: 0.03, expect: [0.8, 2.2],
  },
};
