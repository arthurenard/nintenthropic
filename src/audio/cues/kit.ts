/**
 * Layers that many recipes share. Each returns a fresh buffer (or adds into
 * one) shaped for a job — the noise of a blast, the thump of a body, the
 * tinkle of a shard — so a recipe reads as a list of the events in the sound.
 */
import { biquad, highpass, lowpass, tilt } from "../dsp/filters";
import type { Rng } from "../dsp/rng";
import { type Mono, normalize, perc, wobble } from "../dsp/signal";
import { addMode, bandNoise, chirp, decayInPlace, white } from "../dsp/sources";
import type { Take } from "../dsp/take";

/** Band-limited noise with a percussive envelope: the body of most impacts. */
export function burst(
  t: Take,
  seconds: number,
  low: number,
  high: number,
  attack: number,
  tau: number,
  order = 2,
  tiltDb = 0,
): Mono {
  const buf = bandNoise(t.n(seconds), t.sr, t.rng, low, high, order);
  if (tiltDb) normalize(tilt(buf, t.sr, tiltDb));
  return decayInPlace(buf, t.sr, attack, tau);
}

/** A falling sine with a percussive envelope: a thump, a drum's body, a gun's boom. */
export function thump(t: Take, seconds: number, f0: number, f1: number, attack: number, tau: number, curve = 0.5): Mono {
  const buf = chirp(t.n(seconds), t.sr, f0, f1, curve, t.rng.range(0, 0.6));
  return decayInPlace(buf, t.sr, attack, tau);
}

/**
 * Soft saturation (tanh with a drive), level-preserving at the peak. A real
 * gunshot overloads everything it passes through; a little of that density
 * makes it read as loud without raising the peak.
 */
export function saturate(buf: Mono, drive: number): Mono {
  const norm = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(drive * buf[i]!) / norm;
  return buf;
}

/**
 * An N-wave: the pressure signature of a shock (a supersonic bullet, the
 * front of a blast) — an instant rise, a straight fall through zero to the
 * same depth, and an instant recovery, ``width`` seconds long.
 */
export function nWave(t: Take, width: number): Mono {
  const n = Math.max(3, t.n(width));
  const buf = new Float32Array(n + 8);
  for (let i = 0; i < n; i++) buf[i] = 1 - (2 * i) / (n - 1);
  // The steps are not truly instant in air: a gentle low-pass rounds them.
  return lowpass(buf, t.sr, 14000, 2);
}

/**
 * A bubble: the pitch of a closing air cavity rises as it shrinks, which is
 * the sound of a droplet hitting water (a *plip*), not a splash.
 */
export function bubble(t: Take, freq: number, tau: number, rise = 1.6): Mono {
  const n = t.n(tau * 7);
  const buf = new Float32Array(n);
  const k = Math.exp(-1 / (tau * t.sr));
  const attack = 0.0004 * t.sr;
  // A rotating phasor, its step re-aimed every 16 samples as the pitch
  // rises: bubbles come by the hundred in a leak, and a sine and a power
  // per sample made them the leak's largest cost.
  let re = 1;
  let im = 0;
  let cw = 1;
  let sw = 0;
  let e = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) {
      const f = freq * (1 + (rise - 1) * Math.pow(i / n, 0.6));
      const w = (2 * Math.PI * f) / t.sr;
      cw = Math.cos(w);
      sw = Math.sin(w);
      const norm = 1 / Math.sqrt(re * re + im * im);
      re *= norm;
      im *= norm;
    }
    buf[i] = im * e * (i < attack ? i / attack : 1);
    const nr = re * cw - im * sw;
    im = re * sw + im * cw;
    re = nr;
    e *= k;
  }
  return buf;
}

/** A shard of glass or a pebble: a tiny inharmonic ring with a bright tick. */
export function addShard(out: Mono, t: Take, at: number, freq: number, amp: number, tau: number): void {
  const r = t.rng;
  // The modes start from zero (phase 0 or π): a ring that starts mid-swing
  // is a step, and a step is a low thump under every tinkle. The tick
  // below is the strike's edge instead.
  addMode(out, t.sr, at, freq, amp * r.sign(), tau, 0);
  addMode(out, t.sr, at, freq * r.range(1.42, 1.62), amp * 0.45 * r.sign(), tau * 0.6, 0);
  addMode(out, t.sr, at, freq * r.range(2.2, 2.9), amp * 0.2 * r.sign(), tau * 0.35, 0);
  const tick = bandNoise(t.n(0.002), t.sr, r, 3000, 16000, 2);
  decayInPlace(tick, t.sr, 0.0001, 0.0005);
  t.put(out, tick, at, amp * 0.6);
}

/**
 * Stick-slip friction: the creak of a hinge or a rope. A pulse train whose
 * rate wanders (each slip is a pulse; the rate is the pitch you hear), with
 * irregular pulse sizes, then a body of wooden resonances. ``rate`` is a
 * track of pulses per second over u = 0..1.
 */
export function creak(
  t: Take,
  seconds: number,
  rate: (u: number) => number,
  body: readonly [number, number, number][],
  roughness = 0.35,
): Mono {
  const n = t.n(seconds);
  const r = t.rng;
  const pulses = new Float32Array(n);
  let phase = 0;
  let size = 1;
  for (let i = 0; i < n; i++) {
    const f = Math.max(1, rate(i / n));
    phase += f / t.sr;
    if (phase >= 1) {
      phase -= 1 + roughness * 0.15 * (r.next() - 0.5);
      size = 1 + roughness * (2 * r.next() - 1);
      // A slip is a short sharp pulse: one positive sample and a smaller recovery.
      pulses[i] = size;
      if (i + 1 < n) pulses[i + 1] = -0.4 * size;
    }
  }
  const out = new Float32Array(n);
  for (const [freq, q, amp] of body) {
    const band = biquad(Float32Array.from(pulses), t.sr, "bandpass", freq * t.p, q);
    for (let i = 0; i < n; i++) out[i]! += amp * band[i]!;
  }
  // A thin rasp of the grain over the top.
  const rasp = highpass(Float32Array.from(pulses), t.sr, 2500, 2);
  for (let i = 0; i < n; i++) out[i]! += 0.15 * rasp[i]!;
  return normalize(out);
}

/** A smooth random walk in [0, 1], changing direction about ``rate`` times a second. */
export function wanderTrack(n: number, rng: Rng, rate: number, sr = 44100): (u: number) => number {
  const stops = Math.max(2, Math.round(((n / sr) * rate) + 2));
  const values: number[] = [];
  let v = rng.next();
  for (let k = 0; k < stops; k++) {
    values.push(v);
    v = Math.min(1, Math.max(0, v + 0.45 * (2 * rng.next() - 1)));
  }
  return (u: number) => {
    const x = Math.min(Math.max(u, 0), 1) * (stops - 1);
    const k = Math.min(Math.floor(x), stops - 2);
    const f = x - k;
    const s = f * f * (3 - 2 * f);
    return values[k]! + (values[k + 1]! - values[k]!) * s;
  };
}

/** A wooden knock: a few plank modes and a dull thud under them. */
export function knock(t: Take, base: number, tau: number, amp = 1): Mono {
  const r = t.rng;
  const out = t.canvas(tau * 9 + 0.05);
  const ratios = [1, r.range(2.0, 2.3), r.range(3.4, 3.9), r.range(5.1, 5.9)];
  ratios.forEach((ratio, k) => {
    addMode(out, t.sr, 0, base * ratio, amp * Math.pow(0.55, k), tau * Math.pow(0.6, k), r.range(0, 6.28));
  });
  const thud = burst(t, 0.08, 60, base * 2.5, 0.0008, tau * 0.6, 2);
  t.put(out, thud, 0, amp * 0.7);
  return out;
}

/** Grains scattered over a span: gravel, debris, splinters. Each grain is a tiny click. */
export function scatter(
  out: Mono,
  t: Take,
  count: number,
  from: number,
  to: number,
  low: number,
  high: number,
  level: number,
  bias = 1.5,
): void {
  const r = t.rng;
  for (let k = 0; k < count; k++) {
    const at = from + (to - from) * Math.pow(r.next(), bias);
    const w = r.range(0.0015, 0.005);
    const g = bandNoise(t.n(w), t.sr, r, low * r.range(0.8, 1.2), high, 2);
    perc(g, t.sr, 0.0001, w / 3);
    // Later grains are smaller: the scatter thins out as it settles.
    const fall = 1 - 0.7 * ((at - from) / Math.max(1e-6, to - from));
    t.put(out, g, at, level * r.range(0.3, 1) * fall);
  }
}

/** A low-passed puff of air: the body of a whoosh, a flap, a feather burst. */
export function puff(t: Take, seconds: number, cutoff: number, attack: number, tau: number): Mono {
  const buf = white(t.n(seconds), t.rng);
  lowpass(buf, t.sr, cutoff, 2);
  normalize(buf);
  return decayInPlace(buf, t.sr, attack, tau);
}

/**
 * Band noise under a rectified slow wobble, so its level flickers: the wet,
 * gritty part of an impact — flesh, soil, spray, a crackle.
 */
export function flicker(t: Take, seconds: number, low: number, high: number, rate: number): Mono {
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
 * One lub-dub of a heart: the valves closing, felt more than heard, with
 * enough 100–200 Hz for a laptop's speakers. ``lub`` and ``dub`` are where
 * the two thumps' pitches start, Hz.
 */
export function lubDub(t: Take, gap: number, strength: number, lub = 70, dub = 90): Mono {
  const out = t.canvas(gap + 0.35);
  t.put(out, thump(t, 0.25, lub * t.p, 38 * t.p, 0.006, 0.04, 0.5), 0, strength);
  t.put(out, burst(t, 0.2, 30, 180, 0.005, 0.035, 4), 0, strength * 0.9);
  t.put(out, thump(t, 0.2, dub * t.p, 50 * t.p, 0.004, 0.028, 0.5), gap, strength * 0.7);
  t.put(out, burst(t, 0.15, 40, 240, 0.004, 0.025, 4), gap, strength * 0.55);
  // The chest wall: a muffled knock that makes it audible on small speakers.
  biquad(out, t.sr, "peak", 140, 1.2, 6);
  lowpass(out, t.sr, 420, 2);
  return out;
}

/**
 * A slow curve that repeats exactly every ``length`` samples — a few sines,
 * each a whole number of cycles in the loop — scaled into [1 − depth, 1] and
 * bent by ``bend`` (above 1: long lulls and shorter swells): the gusts of a
 * wind loop, the swell of a river. Evaluated every 32 samples and
 * interpolated: a gust takes seconds, and a few sines and a power per
 * sample would be a wind loop's largest cost.
 */
export function periodicCurve(n: number, length: number, rng: Rng, harmonics: readonly number[], depth: number, bend = 1.6): Float32Array {
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
