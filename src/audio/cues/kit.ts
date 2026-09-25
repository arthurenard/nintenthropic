/**
 * Layers that many recipes share. Each returns a fresh buffer (or adds into
 * one) shaped for a job — the noise of a blast, the thump of a body, the
 * tinkle of a shard — so a recipe reads as a list of the events in the sound.
 */
import { bandpass, biquad, highpass, lowpass, svf, tilt } from "../dsp/filters";
import type { Rng } from "../dsp/rng";
import { type Mono, normalize, perc } from "../dsp/signal";
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
  let ph = 0;
  const k = Math.exp(-1 / (tau * t.sr));
  let e = 1;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = freq * (1 + (rise - 1) * Math.pow(u, 0.6));
    buf[i] = Math.sin(ph) * e * Math.min(1, i / (0.0004 * t.sr));
    ph += (2 * Math.PI * f) / t.sr;
    e *= k;
  }
  return buf;
}

/** A shard of glass or a pebble: a tiny inharmonic ring with a bright tick. */
export function addShard(out: Mono, t: Take, at: number, freq: number, amp: number, tau: number): void {
  const r = t.rng;
  addMode(out, t.sr, at, freq, amp, tau, r.range(0, 6.28));
  addMode(out, t.sr, at, freq * r.range(1.42, 1.62), amp * 0.45, tau * 0.6, r.range(0, 6.28));
  addMode(out, t.sr, at, freq * r.range(2.2, 2.9), amp * 0.2, tau * 0.35, r.range(0, 6.28));
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

/**
 * Wind through a gap: noise through a narrow band-pass whose centre wanders
 * between ``low`` and ``high``, the whistle a real wind finds and loses.
 */
export function whistleNoise(t: Take, n: number, rng: Rng, low: number, high: number, q: number, rate: number): Mono {
  const walk = wanderTrack(n, rng, rate);
  const src = white(n, rng);
  const ratio = high / low;
  return svf(src, t.sr, "bp", (u) => low * Math.pow(ratio, walk(u)), q, 32);
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

/** Band-pass a buffer in place between two corners (convenience re-export for recipes). */
export function band(buf: Mono, t: Take, low: number, high: number, order = 2): Mono {
  return bandpass(buf, t.sr, low, high, order);
}
