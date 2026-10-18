/**
 * Plumbing and layers the ridge's sounds share: a sine on a pitch track, a
 * loop turned round, panning; cloth and grass brushed, breath and a throat
 * (``vocal``); the valley answering a report (its roll and a far wall's
 * slap-back), a pebble on rock and a ricochet's whine.
 */
import { type Curve, sampled, smooth } from "../../dsp/curves";
import { highpass, lowpass, svf } from "../../dsp/filters";
import type { Rng } from "../../dsp/rng";
import { type Mono, fade, normalize, shapeBy, wobble } from "../../dsp/signal";
import { addMode, bandNoise, brown, click, formants, glottal, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { burst, scatter, thump } from "../kit";

/**
 * A sine on a frequency track, with a little second and third harmonic if
 * asked: a rotating phasor whose step is re-aimed every 16 samples, so a
 * whistle, a bird or a drone costs a few multiplies a sample rather than a
 * sine. The harmonics come from the phasor itself (sin 2θ = 2 sin θ cos θ,
 * sin 3θ = 3 sin θ − 4 sin³ θ). It starts at zero phase: no step at the onset.
 */
export function tone(n: number, sr: number, freq: Float32Array, h2 = 0, h3 = 0): Mono {
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

/** The same seamless loop started ``shift`` samples later: still seamless, and its noise its own at that offset. */
export function rotate(buf: Mono, shift: number): Mono {
  const n = buf.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[(((i - shift) % n) + n) % n]!;
  return out;
}

/** Add ``layer`` to a stereo pair at ``pan`` (−1 left .. 1 right): equal power, the far ear half a millisecond late. */
export function putPanned(t: Take, left: Mono, right: Mono, layer: Mono, at: number, gain: number, pan: number): void {
  const p = Math.max(-1, Math.min(1, pan));
  const itd = 0.0006 * Math.abs(p);
  t.put(left, layer, at + (p > 0 ? itd : 0), gain * Math.sqrt(1 - p));
  t.put(right, layer, at + (p < 0 ? itd : 0), gain * Math.sqrt(1 + p));
}

// --- shared layers ----------------------------------------------------------------------

/**
 * Cloth or grass brushed: bright noise crackling irregularly (fibres and
 * blades catching and slipping past each other), with a sprinkle of the
 * sharpest catches on top, swelling and dying over ``seconds``.
 */
export function rustle(t: Take, seconds: number, low: number, high: number, rate: number): Mono {
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
export function breathNoise(t: Take, seconds: number, tract: readonly [number, number, number][], level: Curve): Mono {
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

/**
 * One gesture of a throat: a glottal source on a pitch track, through a
 * moving vocal tract. Not shared with the creatures' or the night's: its
 * growl is a triangle and its tension a constant, and the ridge's takes are
 * tuned to both.
 */
export function vocal(t: Take, seconds: number, o: VocalOptions): Mono {
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
export function valleyRoll(t: Take, rng: Rng, seconds: number, rise: number, decay: number, cutoff = 420): Mono {
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
export function valleySlap(t: Take, cutoff: number): Mono {
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
export function addPebble(out: Mono, t: Take, at: number, gain: number): void {
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
export function ricochetWhine(t: Take, seconds: number): Mono {
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
