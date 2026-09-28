/**
 * Dead of Night: a little after midnight at Miller's Gas & Eats on Route 9.
 * Fog on the road and the fields, one sodium streetlight at the crossroads,
 * the corn, the power lines, the Starlite Motel — and the dead shuffling up
 * the road out of the fog.
 *
 * Realistic and restrained: dread, not a cartoon. The dead never speak; a
 * groan is a rough, irregular throat (a glottal pulse train with heavy
 * jitter, shimmer and the false folds' growl under it) and turbulent breath,
 * both shaped by a slack vocal tract, each take a different gesture. The
 * rifle carries the fight, so it is built like the revolver (an edge, a
 * crack, a body, a sub) and then given what the open country does to a shot
 * in fog: a long damp roll across the fields and a faint late return off the
 * tree line.
 *
 * Space is mostly left to the engine (its slap-back and reverb are added at
 * play time, see ../routing.ts); a sound bakes in only the space that *is*
 * the sound — a bark across half a mile of fields, a roar inside a mask, a
 * radio's little speaker.
 *
 * The loops are seamless by construction (see ../dsp/master.ts): textures are
 * rendered a little long and cross-faded into their own start, events are
 * wrapped round, and anything periodic (the ballast's buzz, the projector's
 * 24 frames a second, the ballad's bars) is built on a whole number of its
 * cycles in the loop.
 *
 * The night has more voices and more long sounds than the town, so more
 * than half of it is synthesised at half the rate (see halfRate): a groan,
 * a bell across the fields or a radio has nothing to say above a few kHz,
 * and the pack costs less to make than High Noon's for it.
 */
import { biquad, highpass, lowpass, resonate, svf } from "../dsp/filters";
import { loopify, wrap } from "../dsp/master";
import { Rng, hashSeed } from "../dsp/rng";
import { type Mono, adsr, fade, normalize, shapeBy, tailOff, wobble } from "../dsp/signal";
import { addMetal, addMode, addString, bandNoise, brown, click, decayInPlace, formants, glottal, pink, saw, white } from "../dsp/sources";
import { room, roomMono } from "../dsp/space";
import { Take } from "../dsp/take";
import { addShard, bubble, burst, creak, knock, nWave, puff, saturate, scatter, thump, wanderTrack } from "./kit";
import { midiHz } from "./music";
import type { CueSpec } from "./table";
import { bellStrike } from "./world";

type Curve = (u: number) => number;

const lerp = (a: number, b: number, u: number): number => a + (b - a) * Math.min(1, Math.max(0, u));

/** A function of u sampled into an array every ``step`` samples, linearly between. */
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

// --- shared layers --------------------------------------------------------------------

interface VocalOptions {
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
 * and a rattle added, because a dead man's voice has both.
 */
function vocal(t: Take, seconds: number, o: VocalOptions): Mono {
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
function tone(t: Take, freq: Float32Array, level: Float32Array, h2: number, h3: number): Mono {
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
function breathOn(t: Take, freq: Float32Array, level: Float32Array, q: number): Mono {
  const buf = svf(white(freq.length, t.rng), t.sr, "bp", freq, q, 16);
  normalize(buf);
  for (let i = 0; i < buf.length; i++) buf[i]! *= level[i]!;
  return buf;
}

/** Noise that flickers (rectified slow noise as its envelope): the wet part of anything soft that is hit. */
function wetNoise(t: Take, seconds: number, low: number, high: number, rate: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, low, high, 2);
  const flick = wobble(n, t.sr, rate, () => t.rng.next());
  for (let i = 0; i < n; i++) {
    const f = Math.abs(flick[i]!);
    buf[i]! *= f * Math.sqrt(f);
  }
  return normalize(buf);
}

/** Dry corn leaves rubbing and catching: bright noise gated by squared fast noise, so it crackles rather than hisses. */
function leafRasp(t: Take, seconds: number, rate: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, 1400, t.c(8000), 2);
  const flick = wobble(n, t.sr, rate, () => t.rng.next());
  for (let i = 0; i < n; i++) buf[i]! *= flick[i]! * flick[i]!;
  return normalize(buf);
}

/** Sand running out of a hole: a hiss of grains, each a tiny tick, thinning as it empties. */
function sandTrickle(t: Take, seconds: number): Mono {
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
function scrape(t: Take, seconds: number, centre: number, grain: number): Mono {
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
function slide(t: Take, seconds: number, from: number, to: number): Mono {
  const buf = white(t.n(seconds), t.rng);
  svf(buf, t.sr, "bp", (u) => (from + (to - from) * u) * t.p, 3, 16);
  normalize(buf);
  return adsr(buf, t.sr, seconds * 0.3, seconds * 0.4, 0.6, seconds * 0.25);
}

/** A steel clack: the lever or the bolt meeting its stop — a click, a hard band of noise, a short ring, the stock's knock. */
function clack(out: Mono, t: Take, at: number, base: number, gain: number, weight: number): void {
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
function brassCase(out: Mono, t: Take, at: number, gain: number): void {
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
function ringInto(out: Mono, ex: Mono, sr: number, freq: number, tau: number, amp: number, last = ex.length): void {
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
function panGains(p: number): [number, number] {
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** A seamless loop turned round by ``shift`` samples: still seamless, and a moment behind itself. */
function turned(buf: Mono, shift: number): Mono {
  const n = buf.length;
  const s = ((shift % n) + n) % n;
  const out = new Float32Array(n);
  out.set(buf.subarray(n - s), 0);
  out.set(buf.subarray(0, n - s), s);
  return out;
}

/** A soft thud on the road: the low mass of a foot or a body, and the scuff of its edge. */
function footfall(out: Mono, t: Take, at: number, gain: number, weight = 1): void {
  t.put(out, burst(t, 0.12, 45, 300 * t.p, 0.003, 0.022 * weight, 4), at, gain);
  t.put(out, burst(t, 0.03, 700, 4500, 0.001, 0.006), at, gain * 0.3);
}

/** One lub-dub: the valves closing, felt more than heard, with enough 100–200 Hz to reach a laptop's speakers. */
function heartBeat(t: Take, gap: number, strength: number): Mono {
  const out = t.canvas(gap + 0.35);
  t.put(out, thump(t, 0.25, 68 * t.p, 38 * t.p, 0.006, 0.04, 0.5), 0, strength);
  t.put(out, burst(t, 0.2, 30, 180, 0.005, 0.035, 4), 0, strength * 0.9);
  t.put(out, thump(t, 0.2, 88 * t.p, 50 * t.p, 0.004, 0.028, 0.5), gap, strength * 0.7);
  t.put(out, burst(t, 0.15, 40, 240, 0.004, 0.025, 4), gap, strength * 0.55);
  biquad(out, t.sr, "peak", 140, 1.2, 6);
  lowpass(out, t.sr, 420, 2);
  return out;
}

/**
 * One cycle of a mains buzz, ``P`` samples long (a whole number, so it tiles
 * exactly): harmonics of the cycle falling off by ``slope``, with a hump
 * where the fixture's housing rings, each harmonic its own level and phase.
 */
function buzzCycle(P: number, r: Rng, sr: number, count: number, hump: number, width: number, slope: number): Float32Array {
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
function halfRate(recipe: (t: Take) => Mono | Mono[], loop = false): (t: Take) => Mono | Mono[] {
  return (full) => {
    const t = new Take(full.sr / 2, Math.floor(full.rng.next() * 4294967296), full.index);
    const raw = recipe(t);
    return Array.isArray(raw) ? raw.map((ch) => upsample(ch, loop)) : upsample(raw, loop);
  };
}

// --- the rifle -------------------------------------------------------------------------

/**
 * The player's lever-action, from behind the stock: a harder, brighter
 * crack than a revolver (the edge, a click and a high band of noise driven
 * into saturation), a deep boom and a sub, then what open country does to a
 * shot in fog — no walls to slap back, only the ground and the damp air
 * carrying it away: a long low roll that darkens as it goes and churns as it
 * rolls, and a faint late return off the tree line half a second later.
 */
export function nightRifle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(2.7);
  const out = t.canvas(seconds);
  const head = t.canvas(0.3);
  t.put(head, nWave(t, t.j(0.0005, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.003, 1600, t.c(16000)), 0, t.g(1.15));
  // The round is supersonic: its own crack rides the blast, a few
  // milliseconds of the brightest noise, which a revolver does not have.
  t.put(head, burst(t, 0.03, 2500, 16000, 0.0001, t.d(0.004), 2, 2), 0, t.g(0.8));
  t.put(head, burst(t, 0.12, 750 * t.p, t.c(14000), 0.0002, t.d(0.016), 2, 1.5), 0, t.g(1.3));
  t.put(head, burst(t, 0.2, 320 * t.p, t.c(2600), 0.0008, t.d(0.038), 2), 0.001, t.g(0.6));
  saturate(head, 2.6);
  t.put(out, head, 0, 1);
  // The boom stays clean: saturating a low sine only squares it into mud.
  t.put(out, thump(t, 0.3, 175 * t.p, 48 * t.p, 0.0015, t.d(0.07), 0.45), 0.001, t.g(0.5));
  t.put(out, thump(t, 0.5, 54 * t.p, 33 * t.p, 0.004, t.d(0.12), 0.6), 0.003, t.g(0.3));
  t.put(out, burst(t, 0.3, 40, 300 * t.p, 0.002, t.d(0.07), 4), 0.001, t.g(0.4));
  // The roll across the fields: fog swallows the top first, so the low-pass
  // falls from ~1.5 kHz to ~400 Hz as it goes; it churns (the ground wave
  // and the air's eddies) and swells once or twice as it rolls away.
  const n = t.n(seconds - 0.01);
  const roll = pink(n, r);
  const top = t.c(1500);
  svf(roll, t.sr, "lp", (u) => top * Math.pow(0.28, Math.pow(u, 0.7)), 0.7, 64);
  highpass(roll, t.sr, 55, 2);
  normalize(roll);
  const churn = wobble(n, t.sr, r.range(5, 8), () => r.next());
  const swell = wobble(n, t.sr, r.range(1.2, 2), () => r.next());
  for (let i = 0; i < n; i++) roll[i]! *= (0.72 + 0.28 * churn[i]!) * (0.85 + 0.15 * swell[i]!);
  adsr(roll, t.sr, 0.035, 0.12, 0.75, 0.5);
  decayInPlace(roll, t.sr, 0, t.d(0.6));
  t.put(out, roll, 0.008, t.g(0.55));
  // The tree line: the blast come back, dark and soft, with a little roll of its own.
  const back = t.j(0.55, 0.25);
  t.put(out, burst(t, 0.35, 180, t.c(1300), 0.004, t.d(0.05), 2), back, t.g(0.16));
  const far = brown(t.n(0.9), r);
  lowpass(far, t.sr, 700, 2);
  highpass(far, t.sr, 60, 2);
  normalize(far);
  adsr(far, t.sr, 0.03, 0.1, 0.6, 0.4);
  decayInPlace(far, t.sr, 0, t.d(0.25));
  t.put(out, far, back + 0.01, t.g(0.1));
  return out;
}

/**
 * The lever worked after a shot. Down: the lever unlocks with a tick, the
 * bolt slides back, a steel clack at the bottom of the stroke, and the spent
 * case flicked out with a tick off the ejector. Up: the bolt runs forward and
 * chambers the round with a solid clack, the lever slapping home against the
 * tang. The case lands on the asphalt a moment later, ringing faintly.
 */
export function nightLever(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.72));
  t.put(out, click(t.sr, r, 0.002, 2500, 12000), 0.008, t.g(0.3));
  t.put(out, slide(t, t.j(0.05, 0.2), 2200, 3600), 0.012, t.g(0.3));
  const down = 0.012 + t.j(0.06, 0.15);
  clack(out, t, down, r.range(1900, 2300) * t.p, 0.85, 0.7);
  addMode(out, t.sr, down + 0.004, r.range(4200, 5000) * t.p, 0.06, 0.02, 0);
  const up = down + t.j(0.13, 0.2);
  t.put(out, slide(t, 0.045, 3000, 1900), up - 0.045, t.g(0.25));
  clack(out, t, up, r.range(1450, 1750) * t.p, 1.0, 1.0);
  t.put(out, click(t.sr, r, 0.002, 1200, 9000), up + t.j(0.012, 0.3), t.g(0.35));
  brassCase(out, t, down + t.j(0.32, 0.15), 0.12);
  return out;
}

/**
 * The hammer falling on an empty chamber: the sear's small tick, then the
 * hammer's snap on the firing pin a few milliseconds later — a bright steel
 * strike, the pin's thin ring, and the walnut stock's dull knock under it.
 * Small, dry, final.
 */
export function nightDry(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.26);
  t.put(out, click(t.sr, r, 0.0015, 2800, 12000), 0.004, t.g(0.22));
  const at = 0.004 + t.j(0.011, 0.3);
  t.put(out, click(t.sr, r, 0.004, 1400, t.c(14000)), at, t.g(1.0));
  const snap = bandNoise(t.n(0.02), t.sr, r, 1200, t.c(9000), 2);
  svf(snap, t.sr, "bp", 2300 * t.p, 2.6);
  normalize(snap);
  decayInPlace(snap, t.sr, 0.0002, 0.004);
  t.put(out, snap, at, t.g(0.85));
  addMetal(out, t.sr, r, at, 2150 * t.p, t.d(0.012), 0.4, [1, 1.61, 2.47, 3.3]);
  addMode(out, t.sr, at, 6100 * t.p, 0.05, t.d(0.02), 0);
  t.put(out, knock(t, r.range(300, 380) * t.p, 0.012, 1), at, t.g(0.35));
  return out;
}

/**
 * One cartridge thumbed into the loading gate: the bullet's nose pushing the
 * spring-loaded gate in (a short brassy slide), the gate snapping shut
 * behind the rim, the brass's own small ring, and the round shoving the
 * magazine column back against its spring (a soft thud, a thin ring). Heard
 * up to eight times in a row, so every take draws its own timing and pitches.
 */
export function nightRoundIn(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.17));
  const push = t.j(0.03, 0.3);
  const lift = r.range(1500, 2200);
  const nose = white(t.n(push), r);
  svf(nose, t.sr, "bp", (u) => (3000 + lift * u) * t.p, 4, 16);
  normalize(nose);
  adsr(nose, t.sr, push * 0.5, push * 0.3, 0.7, push * 0.2);
  t.put(out, nose, 0.004, t.g(0.22));
  const at = 0.004 + push;
  t.put(out, click(t.sr, r, 0.0025, 1800, t.c(13000)), at, t.g(0.9));
  addMetal(out, t.sr, r, at, r.range(2900, 3600) * t.p, t.d(0.008), 0.35, [1, 1.47, 2.2]);
  const brass = r.range(5200, 6800) * t.p;
  addMode(out, t.sr, at, brass, 0.08, t.d(0.018), 0);
  addMode(out, t.sr, at, brass * 1.51, 0.04, t.d(0.01), 0);
  t.put(out, burst(t, 0.03, 180, 1500, 0.001, 0.006, 2), at + 0.002, t.g(0.4));
  const spring = r.range(1900, 2600) * t.p;
  addMode(out, t.sr, at + 0.003, spring, 0.05, t.d(0.03), 0);
  addMode(out, t.sr, at + 0.003, spring * 1.013, 0.04, t.d(0.025), 0);
  addMode(out, t.sr, at + 0.003, spring * 2.9, 0.02, t.d(0.012), 0);
  return out;
}

/**
 * The flashlight's tail switch clicking on: the thumb squashing the rubber
 * boot, the metal dome snapping under it (a click the rubber dulls), and the
 * plastic cap's brief ring.
 */
export function nightClick(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.09));
  t.put(out, burst(t, 0.03, 300, 1800, 0.008, 0.006, 2), 0.002, t.g(0.15));
  const at = t.j(0.014, 0.25);
  t.put(out, click(t.sr, r, 0.0025, 1200, t.c(6500)), at, t.g(1.0));
  addMode(out, t.sr, at, r.range(1300, 1700) * t.p, 0.35, t.d(0.004), 0);
  addMode(out, t.sr, at, r.range(2800, 3400) * t.p, 0.2, t.d(0.0025), 0);
  addMode(out, t.sr, at, r.range(4600, 5400) * t.p, 0.1, 0.0015, 0);
  return out;
}

// --- bullets landing -------------------------------------------------------------------

/**
 * A bullet into one of the dead: the slap of wet cloth (duller than a dry
 * coat), a heavy slack thud of the mass under it, a wet flicker, and a
 * smaller second flick as the body gives. Heavy and wet, never a splat: it
 * is heard a hundred times a night.
 */
export function nightHit(t: Take): Mono {
  const out = t.canvas(t.L(0.38));
  t.put(out, burst(t, 0.04, 550 * t.p, t.c(3800), 0.0004, t.d(0.006), 2), 0, t.g(0.85));
  t.put(out, burst(t, 0.3, 45, 360 * t.p, 0.0015, t.d(0.05), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.25, 135 * t.p, 52 * t.p, 0.001, t.d(0.045), 0.5), 0, t.g(0.8));
  const wet = wetNoise(t, 0.22, 500, 3200, 140);
  decayInPlace(wet, t.sr, 0.004, t.d(0.04));
  t.put(out, wet, 0.004, t.g(0.34));
  const give = wetNoise(t, 0.12, 250, 1400, 90);
  decayInPlace(give, t.sr, 0.006, 0.025);
  t.put(out, give, t.j(0.035, 0.3), t.g(0.22));
  return out;
}

/**
 * The headshot, the reward: the crack of bone (the round's shock, a bright
 * click, a hard band of noise, the skull's hollow modes), then the wet knock
 * of the head snapping back — heavy, soft and low — and a fine spatter onto
 * the road a moment later.
 */
export function nightHeadshot(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.48));
  t.put(out, nWave(t, 0.00025), 0, t.g(0.6));
  t.put(out, click(t.sr, r, 0.004, 1100, t.c(13000)), 0, t.g(1.1));
  t.put(out, burst(t, 0.05, 1800 * t.p, t.c(10000), 0.0002, t.d(0.006), 2), 0, t.g(0.95));
  addMode(out, t.sr, 0, 760 * t.p, 0.45 * r.sign(), t.d(0.02), 0);
  addMode(out, t.sr, 0, 1270 * t.p, 0.3 * r.sign(), t.d(0.013), 0);
  addMode(out, t.sr, 0, 2050 * t.p, 0.18 * r.sign(), t.d(0.008), 0);
  const at = t.j(0.012, 0.3);
  t.put(out, burst(t, 0.2, 55, 420 * t.p, 0.001, t.d(0.035), 4), at, t.g(0.8));
  t.put(out, thump(t, 0.15, 190 * t.p, 75 * t.p, 0.001, t.d(0.03), 0.5), at, t.g(0.55));
  addMode(out, t.sr, at, r.range(420, 520) * t.p, 0.3, t.d(0.018), 0);
  const wet = wetNoise(t, 0.22, 700, 3800, 190);
  decayInPlace(wet, t.sr, 0.002, t.d(0.035));
  t.put(out, wet, at + 0.002, t.g(0.4));
  scatter(out, t, r.int(5, 9), 0.06, 0.3, 1500, 7000, 0.1, 1.3);
  return out;
}

/**
 * A bullet on sheet steel — the pump's cabinet, the pickup's door, the
 * burned bus: a hard bright strike, then the panel rings in many modes,
 * each a pair a hair apart that beats as it dies (the upper ones first),
 * over the dull bong of the panel's body. Some panels are loose and buzz
 * against their frame; some ring long, some are dead with rust.
 */
export function nightHitMetal(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.05));
  t.put(out, click(t.sr, r, 0.003, 1800, 15000), 0, t.g(1.1));
  t.put(out, burst(t, 0.02, 1100, t.c(13000), 0.0002, 0.0035), 0, t.g(0.9));
  const base = r.range(300, 720) * t.p;
  const ring = r.range(0.14, 0.32);
  const ratios = [1, 1.37, 1.93, 2.41, 2.88, 3.62, 4.37, 5.5];
  ratios.forEach((ratio, k) => {
    const f = base * ratio * r.range(0.985, 1.015);
    const amp = t.g(Math.pow(0.72, k), 2) * 0.5;
    const tau = t.d(ring * Math.pow(0.8, k)) * r.range(0.8, 1.2);
    addMode(out, t.sr, 0, f, amp * r.sign(), tau, 0);
    addMode(out, t.sr, 0, f * (1 + r.range(0.002, 0.006)), amp * 0.5 * r.sign(), tau * 0.9, 0);
  });
  addMode(out, t.sr, 0, base * r.range(0.35, 0.45), 0.4, t.d(0.08), 0);
  t.put(out, burst(t, 0.06, 150, t.c(1800), 0.0005, 0.012), 0, t.g(0.5));
  if (r.chance(0.5)) {
    // A loose panel buzzing against its frame for a moment.
    const len = r.range(0.15, 0.3);
    const rattle = bandNoise(t.n(len), t.sr, r, 600, 4000, 2);
    const rate = r.range(38, 60);
    shapeBy(rattle, (u) => Math.pow(Math.max(0, Math.sin(2 * Math.PI * rate * u * len)), 6) * Math.pow(1 - u, 1.5), 8);
    t.put(out, rattle, 0.01, t.g(0.2));
  }
  return tailOff(out, t.sr, 0.25);
}

/**
 * A bullet into old wet wood — a fence rail, the barn, a pole: a duller
 * knock than a dry plank, more thud, a short tear of fibres, a few splinters.
 */
export function nightHitWood(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.45));
  t.put(out, click(t.sr, r, 0.004, 450, t.c(8000)), 0, t.g(0.9));
  t.put(out, knock(t, r.range(210, 320) * t.p, t.d(0.03), 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.14, 60, 420, 0.0008, t.d(0.03), 4), 0, t.g(0.8));
  const tear = creak(t, t.j(0.05, 0.3), (u) => 520 - 300 * u, [[800, 3, 1], [1900, 4, 0.5], [3800, 4, 0.2]], 0.9);
  decayInPlace(tear, t.sr, 0.001, 0.02);
  t.put(out, tear, 0.002, t.g(0.4));
  scatter(out, t, r.int(4, 8), 0.004, 0.14, 800, 6000, 0.35, 1.8);
  return out;
}

/**
 * A bullet into the road: the crack of the round flattening on asphalt
 * (hard, bright, short), the thud of the road under it, grit flung up in a
 * hiss, the chips landing, a pebble or two bouncing.
 */
export function nightHitGround(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.55));
  t.put(out, click(t.sr, r, 0.003, 1400, t.c(15000)), 0, t.g(1.2));
  t.put(out, burst(t, 0.05, 900 * t.p, t.c(11000), 0.0002, t.d(0.006), 2, 1), 0, t.g(0.9));
  t.put(out, burst(t, 0.12, 55, 380 * t.p, 0.0008, t.d(0.022), 4), 0, t.g(0.75));
  t.put(out, thump(t, 0.1, 140 * t.p, 60 * t.p, 0.001, t.d(0.02), 0.5), 0, t.g(0.45));
  const spray = wetNoise(t, 0.25, 2000, 9500, 450);
  decayInPlace(spray, t.sr, 0.002, t.d(0.04));
  t.put(out, spray, 0.002, t.g(0.35));
  scatter(out, t, r.int(14, 24), 0.03, 0.45, 2000, 9500, 0.25, 1.3);
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    addShard(out, t, r.range(0.12, 0.4), r.range(2500, 5000) * t.p, r.range(0.04, 0.09), 0.004);
  }
  return out;
}

/**
 * A bullet through a window pane (the station, the motel, the bus): the
 * crack, a short bright shatter, the crack racing out from the hole, a big
 * piece dropping onto the asphalt and a few shards after it.
 */
export function nightHitGlass(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.65));
  t.put(out, click(t.sr, r, 0.004, 2400, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.1, 2600 * t.p, 15000, 0.0003, t.d(0.02), 2, 2), 0, t.g(0.95));
  const pane = r.range(3100, 3700) * t.p;
  addMode(out, t.sr, 0, pane, 0.18, t.d(0.05), 0);
  addMode(out, t.sr, 0, pane * 1.005, 0.16, t.d(0.04), 0);
  addMode(out, t.sr, 0, pane * 1.64, 0.1, t.d(0.03), 0);
  for (let k = 0, c = r.int(7, 12); k < c; k++) {
    const at = 0.004 + Math.pow(k / 12, 1.6) * 0.08 + r.range(0, 0.004);
    t.put(out, click(t.sr, r, r.range(0.001, 0.0025), 3000, 15000), at, r.range(0.2, 0.5));
  }
  const drop = r.range(0.22, 0.34);
  t.put(out, knock(t, r.range(700, 1000), 0.008, 0.6), drop, t.g(0.25));
  t.put(out, click(t.sr, r, 0.003, 2000, 14000), drop, t.g(0.3));
  for (let k = 0, c = r.int(6, 10); k < c; k++) {
    addShard(out, t, r.range(0.05, 0.55), r.range(3500, 9000) * t.p, r.range(0.06, 0.18), r.range(0.01, 0.03));
  }
  return out;
}

/**
 * A bullet through the corn: a dry stalk snapping (the crack of a hollow
 * cane, its knock, a short tear of fibres), the long leaves thrashing and
 * crackling as they settle, and sometimes a second stalk giving way.
 */
export function nightHitCorn(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.7));
  const snapStalk = (at: number, gain: number): void => {
    t.put(out, click(t.sr, r, 0.003, 900, t.c(12000)), at, gain);
    t.put(out, knock(t, r.range(620, 900) * t.p, t.d(0.008), 1), at, gain * 0.7);
    const fibres = creak(t, t.j(0.04, 0.3), (u) => 900 - 500 * u, [[1400, 3, 1], [3200, 4, 0.5]], 1);
    decayInPlace(fibres, t.sr, 0.001, 0.015);
    t.put(out, fibres, at + 0.003, gain * 0.4);
  };
  snapStalk(0.004, t.g(1.0));
  const rustle = leafRasp(t, 0.6, r.range(60, 90));
  shapeBy(rustle, (u) => Math.min(1, u * 25) * Math.pow(1 - u, 2.2));
  t.put(out, rustle, 0.006, t.g(0.45));
  scatter(out, t, r.int(20, 34), 0.01, 0.55, 1800, 9000, 0.3, 1.8);
  if (r.chance(0.6)) snapStalk(r.range(0.1, 0.25), t.g(0.4));
  return out;
}

/**
 * A bullet into a puddle: the slap of the surface and, an inch under it, the
 * asphalt; a short plunk (a puddle has no depth for a deep one); the sheet of
 * water thrown up; drops pattering back onto the puddle and the road.
 */
export function nightHitWater(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.72));
  t.put(out, burst(t, 0.03, 450, t.c(3500), 0.0003, 0.005), 0, t.g(0.85));
  t.put(out, click(t.sr, r, 0.003, 1200, 10000), 0.001, t.g(0.45));
  t.put(out, burst(t, 0.08, 60, 320, 0.001, 0.016, 4), 0, t.g(0.5));
  t.put(out, bubble(t, r.range(500, 800) * t.p, t.d(0.015), r.range(1.6, 2.2)), 0.002, t.g(0.6));
  const splash = wetNoise(t, 0.35, 800, t.c(7500), 320);
  adsr(splash, t.sr, 0.008, 0.05, 0.35, 0.15);
  decayInPlace(splash, t.sr, 0, t.d(0.09));
  t.put(out, splash, 0.004, t.g(0.6));
  for (let k = 0, c = r.int(10, 16); k < c; k++) {
    const at = 0.06 + Math.pow(r.next(), 1.2) * 0.5;
    if (r.chance(0.6)) {
      t.put(out, bubble(t, r.range(1100, 3600) * t.p, r.range(0.004, 0.012), r.range(1.3, 1.9)), at, r.range(0.1, 0.3));
    } else {
      t.put(out, burst(t, 0.008, 1500, 8000, 0.0002, 0.0012), at, r.range(0.05, 0.15));
    }
  }
  return out;
}

/**
 * A bullet into a sandbag: a coarse pop of the burlap, then the sand
 * swallowing it — a dull, dead thump with no ring at all — grains spat back
 * out of the hole, and a thin trickle running out after.
 */
export function nightHitSandbag(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  t.put(out, burst(t, 0.03, 500, t.c(3200), 0.0004, 0.004), 0, t.g(0.6));
  t.put(out, click(t.sr, r, 0.002, 700, 6000), 0, t.g(0.35));
  t.put(out, burst(t, 0.2, 40, 260 * t.p, 0.0012, t.d(0.03), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.16, 110 * t.p, 48 * t.p, 0.0015, t.d(0.028), 0.5), 0, t.g(0.7));
  scatter(out, t, r.int(8, 14), 0.005, 0.1, 2500, 9000, 0.18, 1.5);
  t.put(out, sandTrickle(t, t.j(0.55, 0.15)), t.j(0.06, 0.3), t.g(0.22));
  return out;
}

/**
 * A bullet off the Mechanic's welding mask: a spark of a strike (sharper
 * than any other hit), then the curved steel shell rings — its low modes
 * long, the upper ones in beating pairs — over the hollow of the mask (a
 * low bong and the thud of the head inside it), and the hinge rattling as
 * his head is knocked back.
 */
export function nightMaskClang(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.2));
  t.put(out, nWave(t, 0.0003), 0, t.g(0.6));
  t.put(out, click(t.sr, r, 0.003, 2000, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.02, 1500, t.c(14000), 0.0002, 0.003), 0, t.g(0.9));
  const base = r.range(430, 560) * t.p;
  const table: [number, number, number][] = [
    [1, 1, 0.42], [1.53, 0.55, 0.3], [2.12, 0.6, 0.22], [2.79, 0.35, 0.15],
    [3.45, 0.3, 0.11], [4.3, 0.18, 0.07], [5.6, 0.1, 0.045], [7.1, 0.06, 0.03],
  ];
  for (const [ratio, amp, tau] of table) {
    for (const s of [-1, 1]) {
      const f = base * ratio * (1 + s * r.range(0.002, 0.006));
      addMode(out, t.sr, 0, f, 0.5 * amp * t.g(1, 2) * r.sign(), t.d(tau) * r.range(0.85, 1.15), 0);
    }
  }
  addMode(out, t.sr, 0, r.range(170, 230) * t.p, 0.5, t.d(0.09), 0);
  t.put(out, burst(t, 0.12, 60, 450, 0.001, t.d(0.03), 4), 0.001, t.g(0.6));
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    addMetal(out, t.sr, r, 0.05 + k * r.range(0.04, 0.07), r.range(2200, 3200), 0.008, 0.07, [1, 1.6, 2.3]);
  }
  return tailOff(out, t.sr, 0.3);
}

/**
 * A ricochet off the road or the steel: a spark of a click and a spit of
 * grit, then the whine of the deformed round tumbling away — its pitch
 * falling fast as it leaves and on as it goes, wobbling with each turn — a
 * thin tone inside a narrow band of air, dulled at the top by the fog.
 */
export function nightRicochet(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.85));
  t.put(out, click(t.sr, r, 0.003, 1400, 14000), 0, t.g(1.0));
  t.put(out, burst(t, 0.05, 1800, t.c(11000), 0.0003, 0.006), 0, t.g(0.7));
  t.put(out, burst(t, 0.05, 250, 1800, 0.0005, 0.01), 0, t.g(0.4));
  scatter(out, t, r.int(3, 6), 0.008, 0.1, 1800, 8000, 0.15);
  const n = t.n(t.L(r.range(0.5, 0.68)));
  const f0 = r.range(2400, 3600) * t.p;
  const end = r.range(0.28, 0.4);
  const tumble = r.range(22, 40);
  const fm = r.range(0.015, 0.03);
  const am = r.range(0.2, 0.4);
  const freq = new Float32Array(n);
  const level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const spin = Math.sin((2 * Math.PI * tumble * i) / t.sr);
    freq[i] = f0 * Math.pow(end, Math.pow(u, 0.75)) * (1 + fm * spin);
    level[i] = (Math.min(1, u * 30) / (1 + 4 * u)) * (1 - am + am * (0.5 + 0.5 * spin)) * (u < 0.9 ? 1 : (1 - u) / 0.1);
  }
  const whine = tone(t, freq, level, 0.18, 0);
  const air = breathOn(t, freq, level, 26);
  for (let i = 0; i < n; i++) whine[i] = 0.6 * whine[i]! + 0.5 * air[i]!;
  lowpass(whine, t.sr, t.c(7000), 2);
  t.put(out, whine, t.j(0.01, 0.3), t.g(0.6));
  return out;
}

// --- the dead --------------------------------------------------------------------------

/**
 * A dead man's groan, one of six shapes (by take): a low moan sinking from
 * "uh" to "oh"; a rattling exhale (the voice a slow creak of separate
 * pulses, fluttering with what is in the throat); a gurgling growl (the
 * false folds growling at half the pitch, the resonances wobbling with
 * liquid, bubbles bursting through); a hoarse moan rising as the mouth opens
 * and breaking at the top; a wet choke (short strangled pushes cut off by
 * the throat, then a wheeze back in); a long hollow "oo" whose voice drops
 * into a croak and back. Every one is a rough irregular throat plus layered
 * breath, and its pitch wanders: nothing here is steady, because nothing
 * about them is.
 */
export function nightGroan(t: Take): Mono {
  const r = t.rng;
  const shape = t.index % 6;
  const m = t.cutoff;
  const pitch = r.range(66, 90) * t.p;
  const len = t.j([1.7, 1.25, 1.45, 1.85, 1.2, 2.0][shape]!, 0.08);
  const out = t.canvas(len + 0.1);
  const drift = wanderTrack(t.n(len), r, 5, t.sr);
  const wander = (u: number): number => 1 + 0.07 * (2 * drift(u) - 1);
  const hoarse = (at: number, seconds: number, gain: number, f1: number, f2: number, env: Curve): void => {
    const air = vocal(t, seconds, {
      f0: () => pitch,
      voicing: () => 0,
      tract: [{ f: () => f1 * m, q: 3, amp: 1 }, { f: () => f2 * m, q: 4, amp: 0.55 }, { f: () => 2800 * m, q: 6, amp: 0.2 }],
      level: env,
      flutter: { rate: 12, depth: 0.4 },
    });
    t.put(out, air, at, gain);
  };
  if (shape === 0) {
    const moan = vocal(t, len, {
      f0: (u) => pitch * (0.97 + 0.1 * Math.sin(Math.PI * u) - 0.14 * u) * wander(u),
      voicing: (u) => 0.8 - 0.35 * Math.max(0, u - 0.6),
      tension: (u) => 0.35 + 0.2 * Math.sin(Math.PI * u),
      jitter: 0.07, shimmer: 0.3, breath: 0.25, rasp: 0.25, wet: 0.05,
      tract: [
        { f: () => 290 * m, q: 3, amp: 0.35 },
        { f: (u) => lerp(580, 450, u) * m, q: 5, amp: 1 },
        { f: (u) => lerp(1080, 820, u) * m, q: 7, amp: 0.5 },
        { f: () => 2450 * m, q: 10, amp: 0.18 },
      ],
      level: (u) => Math.pow(Math.min(1, u / 0.25), 1.5) * Math.pow(1 - u, 0.9),
      flutter: { rate: 4, depth: 0.3 },
    });
    t.put(out, moan, 0.02, 1);
    hoarse(0.02 + len * 0.35, len * 0.6, 0.22, 700, 1350, (u) => Math.sin(Math.PI * u) ** 2);
  } else if (shape === 1) {
    const rattle = vocal(t, len, {
      f0: (u) => pitch * 0.5 * (1 - 0.25 * u) * wander(u),
      voicing: (u) => 0.55 - 0.35 * u,
      tension: () => 0.2,
      jitter: 0.25, shimmer: 0.5, breath: 0.5,
      tract: [
        { f: (u) => lerp(650, 500, u) * m, q: 4, amp: 1 },
        { f: (u) => lerp(1250, 1000, u) * m, q: 6, amp: 0.55 },
        { f: () => 2500 * m, q: 8, amp: 0.2 },
      ],
      level: (u) => Math.min(1, u * 8) * Math.pow(1 - u, 1.1),
      flutter: { rate: 27, depth: 0.6 },
    });
    t.put(out, rattle, 0.02, 1);
    hoarse(0.02, len, 0.45, 820, 1700, (u) => Math.min(1, u * 5) * Math.pow(1 - u, 1.4));
  } else if (shape === 2) {
    const growl = vocal(t, len, {
      f0: (u) => pitch * 1.12 * (1 + 0.08 * Math.sin(Math.PI * u)) * wander(u),
      voicing: () => 0.85,
      tension: () => 0.75,
      jitter: 0.08, shimmer: 0.35, breath: 0.2, rasp: 0.65, wet: 0.16, wetRate: 13,
      tract: [
        { f: () => 300 * m, q: 3, amp: 0.3 },
        { f: (u) => lerp(640, 540, u) * m, q: 5, amp: 1 },
        { f: (u) => lerp(990, 900, u) * m, q: 6, amp: 0.6 },
        { f: () => 2400 * m, q: 9, amp: 0.2 },
      ],
      level: (u) => Math.pow(Math.sin(Math.PI * u), 0.7) * (0.7 + 0.3 * Math.sin(3 * Math.PI * u)),
      flutter: { rate: 18, depth: 0.35 },
    });
    t.put(out, growl, 0.02, 1);
    for (let k = 0, c = r.int(4, 8); k < c; k++) {
      t.put(out, bubble(t, r.range(160, 380) * t.p, r.range(0.008, 0.02), r.range(1.4, 2)), 0.02 + r.range(0.15, 0.85) * len, r.range(0.08, 0.2));
    }
  } else if (shape === 3) {
    const rise = vocal(t, len, {
      f0: (u) => pitch * (u < 0.82 ? 0.85 + 0.6 * Math.pow(u / 0.82, 1.3) : lerp(1.45, 1.1, (u - 0.82) / 0.18)) * wander(u),
      voicing: (u) => 0.65 + 0.2 * Math.sin(Math.PI * u),
      tension: (u) => 0.4 + 0.45 * u,
      jitter: 0.09, shimmer: 0.35, breath: 0.45, rasp: 0.2,
      tract: [
        { f: (u) => lerp(500, 740, u * 1.3) * m, q: 5, amp: 1 },
        { f: (u) => lerp(880, 1250, u) * m, q: 7, amp: 0.55 },
        { f: () => 2500 * m, q: 10, amp: 0.2 },
        { f: () => 3400 * m, q: 12, amp: 0.08 },
      ],
      level: (u) => Math.pow(Math.min(1, u / 0.35), 1.2) * (u < 0.85 ? 1 : (1 - u) / 0.15),
      flutter: { rate: 6, depth: 0.2 },
    });
    t.put(out, rise, 0.02, 1);
    hoarse(0.02 + len * 0.2, len * 0.8, 0.3, 760, 1500, (u) => Math.sin(Math.PI * u));
  } else if (shape === 4) {
    let at = 0.02;
    const pushes = r.int(3, 5);
    for (let k = 0; k < pushes; k++) {
      const bl = r.range(0.08, 0.14);
      const lift = 1.25 - 0.1 * k;
      const ukh = vocal(t, bl, {
        f0: (u) => pitch * lift * (1.05 - 0.2 * u),
        voicing: (u) => 0.7 - 0.4 * u,
        tension: () => 0.95,
        jitter: 0.1, shimmer: 0.4, breath: 0.35, rasp: 0.5, wet: 0.2, wetRate: 16,
        tract: [{ f: () => 560 * m, q: 5, amp: 1 }, { f: () => 1050 * m, q: 6, amp: 0.6 }, { f: () => 2450 * m, q: 9, amp: 0.2 }],
        // The throat shutting on it: cut off, not faded.
        level: (u) => Math.min(1, u * 20) * (u < 0.75 ? 1 : (1 - u) / 0.25),
      });
      t.put(out, ukh, at, 1 - 0.12 * k);
      at += bl + r.range(0.05, 0.1);
    }
    const wl = Math.max(0.2, len - at);
    const wheeze = vocal(t, wl, {
      f0: () => pitch,
      voicing: () => 0,
      tract: [{ f: (u) => lerp(420, 620, u) * m, q: 6, amp: 1 }, { f: () => 1850 * m, q: 12, amp: 0.8 }, { f: () => 3100 * m, q: 14, amp: 0.3 }],
      level: (u) => Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 1.5,
    });
    t.put(out, wheeze, at, 0.35);
  } else {
    const breakAt = r.range(0.35, 0.55);
    const breakLen = r.range(0.05, 0.08);
    const hollow = vocal(t, len, {
      // The voice drops into a croak an octave down for a moment, and back.
      f0: (u) => pitch * 1.05 * (1 - 0.18 * u) * (Math.abs(u - breakAt) < breakLen ? 0.5 : 1) * wander(u),
      voicing: () => 0.85,
      tension: () => 0.45,
      jitter: 0.06, shimmer: 0.25, breath: 0.3, rasp: 0.3,
      tract: [
        { f: (u) => lerp(380, 480, u) * m, q: 5, amp: 1 },
        { f: (u) => lerp(760, 860, u) * m, q: 6, amp: 0.5 },
        { f: () => 2300 * m, q: 9, amp: 0.12 },
      ],
      level: (u) => Math.pow(Math.min(1, u / 0.35), 1.6) * Math.pow(1 - u, 0.8),
      flutter: { rate: 5, depth: 0.25 },
    });
    t.put(out, hollow, 0.02, 1);
    hoarse(0.02 + len * 0.5, len * 0.45, 0.2, 600, 1100, (u) => Math.sin(Math.PI * u) ** 1.5);
  }
  highpass(out, t.sr, 65, 2);
  return out;
}

/**
 * A runner: harsher, faster and higher than a walker — the voice pressed
 * hard, the false folds tearing under it, the mouth wide open. One of four
 * shapes (by take): a snarl tearing up into a shriek and a hiss of breath
 * pulled back; two short snarls; a long rising shriek that cracks at the
 * top; a gnashing snarl with the teeth clacking and a spit.
 */
export function nightSnarl(t: Take): Mono {
  const r = t.rng;
  const shape = t.index % 4;
  const m = t.cutoff;
  const pitch = r.range(200, 260) * t.p;
  const out = t.canvas(1.1);
  const open = (k: number): VocalOptions["tract"] => [
    { f: (u) => lerp(820, 950, u) * m * k, q: 5, amp: 1 },
    { f: () => 1750 * m * k, q: 6, amp: 0.8 },
    { f: () => 2750 * m * k, q: 8, amp: 0.45 },
    { f: () => 3700 * m * k, q: 10, amp: 0.2 },
  ];
  const snarl = (at: number, seconds: number, gain: number, lift: number): void => {
    const s = vocal(t, seconds, {
      f0: (u) => pitch * lift * (0.8 + 0.25 * Math.sin(Math.PI * u)),
      tension: () => 0.95,
      jitter: 0.1, shimmer: 0.45, breath: 0.4, rasp: 0.75, wet: 0.08,
      tract: open(0.9),
      level: (u) => Math.min(1, u * 14) * (u < 0.7 ? 1 : (1 - u) / 0.3),
      flutter: { rate: 30, depth: 0.35 },
    });
    t.put(out, s, at, gain);
  };
  const inhale = (at: number, seconds: number, gain: number): void => {
    const h = vocal(t, seconds, {
      f0: () => pitch,
      voicing: () => 0,
      tract: [{ f: () => 900 * m, q: 5, amp: 0.6 }, { f: () => 2200 * m, q: 8, amp: 1 }, { f: () => 3600 * m, q: 9, amp: 0.5 }],
      level: (u) => Math.sin(Math.PI * u) ** 1.2,
    });
    t.put(out, h, at, gain);
  };
  if (shape === 0) {
    snarl(0.01, 0.16, 0.8, 0.5);
    const shriek = vocal(t, 0.5, {
      f0: (u) => pitch * (0.9 + 0.6 * Math.min(1, u * 2.5)),
      tension: () => 1,
      jitter: 0.06, shimmer: 0.35, breath: 0.35, rasp: 0.5,
      tract: open(1),
      level: (u) => Math.min(1, u * 10) * (u < 0.8 ? 1 : (1 - u) / 0.2),
    });
    t.put(out, shriek, 0.15, 1);
    inhale(0.7, 0.18, 0.35);
  } else if (shape === 1) {
    snarl(0.01, r.range(0.18, 0.24), 1, r.range(0.9, 1.05));
    snarl(0.32, r.range(0.22, 0.3), 0.9, r.range(1.0, 1.2));
    inhale(0.66, 0.16, 0.3);
  } else if (shape === 2) {
    const crack = r.range(0.78, 0.86);
    const long = vocal(t, 0.75, {
      f0: (u) => pitch * (u < crack ? 0.75 + 0.85 * u : 1.4 * 0.62),
      tension: (u) => 0.85 + 0.15 * u,
      jitter: 0.07, shimmer: 0.35, breath: 0.3, rasp: 0.45,
      tract: open(1.05),
      level: (u) => Math.min(1, u * 8) * (u < 0.88 ? 1 : (1 - u) / 0.12),
    });
    t.put(out, long, 0.02, 1);
    inhale(0.8, 0.14, 0.25);
  } else {
    snarl(0.01, r.range(0.42, 0.52), 1, r.range(0.8, 0.95));
    // Teeth: two or three hard clacks through it, and a spit.
    for (let k = 0, c = r.int(2, 4); k < c; k++) {
      const at = r.range(0.08, 0.45);
      t.put(out, click(t.sr, r, 0.002, 1500, 9000), at, 0.35);
      addMode(out, t.sr, at, r.range(2200, 3000), 0.12, 0.004, 0);
    }
    t.put(out, burst(t, 0.06, 900, 8000, 0.0008, 0.012, 2, 1), r.range(0.55, 0.65), 0.35);
  }
  highpass(out, t.sr, 120, 2);
  return out;
}

/**
 * The last air going out of one as it drops, one of four shapes (by take):
 * a long rattling exhale (the voice a creak of separate pulses, rattling
 * with what is in the throat); a choked groan and then the breath; a
 * gurgling rattle; a voiced sigh cut off by the throat closing.
 */
export function nightDeadFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.1);
  const shape = t.index % 4;
  const m = t.cutoff;
  const pitch = r.range(70, 90) * t.p;
  const exhale = (at: number, seconds: number, gain: number, voiced: number): void => {
    const ex = vocal(t, seconds, {
      f0: (u) => pitch * 0.45 * (1 - 0.3 * u),
      voicing: (u) => voiced * (1 - u),
      tension: () => 0.2,
      jitter: 0.3, shimmer: 0.5, breath: 0.6,
      tract: [
        { f: (u) => lerp(640, 480, u) * m, q: 4, amp: 1 },
        { f: (u) => lerp(1200, 1000, u) * m, q: 6, amp: 0.5 },
        { f: () => 2400 * m, q: 8, amp: 0.2 },
      ],
      level: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.2),
      flutter: { rate: 26, depth: 0.55 },
    });
    t.put(out, ex, at, gain);
  };
  if (shape === 0) {
    exhale(0.02, t.j(0.85, 0.1), 1, 0.5);
  } else if (shape === 1) {
    const len = t.j(0.2, 0.15);
    const groan = vocal(t, len, {
      f0: (u) => pitch * (1.1 - 0.35 * u),
      tension: () => 0.85,
      jitter: 0.08, shimmer: 0.35, breath: 0.3, rasp: 0.5,
      tract: [{ f: () => 560 * m, q: 5, amp: 1 }, { f: () => 1000 * m, q: 6, amp: 0.55 }, { f: () => 2400 * m, q: 9, amp: 0.2 }],
      level: (u) => Math.min(1, u * 15) * (u < 0.8 ? 1 : (1 - u) / 0.2),
    });
    t.put(out, groan, 0.02, 1);
    exhale(0.02 + len + r.range(0.04, 0.09), t.j(0.55, 0.12), 0.6, 0.15);
  } else if (shape === 2) {
    const rattle = vocal(t, t.j(0.8, 0.1), {
      f0: (u) => pitch * 0.32 * (1 - 0.2 * u),
      voicing: (u) => 0.75 - 0.4 * u,
      tension: () => 0.3,
      jitter: 0.35, shimmer: 0.6, breath: 0.45, wet: 0.2, wetRate: 14,
      tract: [{ f: () => 520 * m, q: 5, amp: 1 }, { f: () => 950 * m, q: 6, amp: 0.6 }, { f: () => 2300 * m, q: 8, amp: 0.2 }],
      level: (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.1),
      flutter: { rate: 20, depth: 0.5 },
    });
    t.put(out, rattle, 0.02, 1);
    for (let k = 0, c = r.int(2, 5); k < c; k++) {
      t.put(out, bubble(t, r.range(200, 420) * t.p, r.range(0.008, 0.016), r.range(1.4, 2)), r.range(0.15, 0.6), r.range(0.06, 0.14));
    }
  } else {
    const len = t.j(0.55, 0.12);
    const sigh = vocal(t, len, {
      f0: (u) => pitch * (1.05 - 0.4 * u),
      voicing: (u) => 0.9 - 0.5 * u,
      tension: (u) => 0.55 - 0.35 * u,
      jitter: 0.05, shimmer: 0.3, breath: 0.35, rasp: 0.2,
      tract: [
        { f: (u) => lerp(700, 520, u) * m, q: 6, amp: 1 },
        { f: (u) => lerp(1100, 1300, u) * m, q: 8, amp: 0.5 },
        { f: () => 2450 * m, q: 11, amp: 0.18 },
      ],
      level: (u) => Math.min(1, u * 8) * (u < 0.9 ? Math.pow(1 - u * 0.6, 1.2) : ((1 - u) / 0.1) * 0.46),
    });
    t.put(out, sigh, 0.02, 1);
    // The glottis shutting: a small wet click.
    t.put(out, click(t.sr, r, 0.002, 400, 3500), 0.02 + len - 0.01, 0.15);
  }
  highpass(out, t.sr, 70, 2);
  return out;
}

/**
 * A body onto wet asphalt: the torso's heavy thud and the second of the
 * limbs and head, each with the wet slap the road gives back, cloth
 * rustling. Half the takes go down in two stages: the knees first, then
 * the rest.
 */
export function nightBodyFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.95));
  const knees = t.index % 2 === 1;
  const hits: [number, number, number][] = knees
    ? [[0, 0.55, 260], [t.j(0.22, 0.2), 1.0, 200], [t.j(0.36, 0.15), 0.45, 230]]
    : [[0, 1.0, 200], [t.j(0.15, 0.3), 0.55, 170]];
  if (!knees && r.chance(0.6)) hits.push([t.j(0.3, 0.2), 0.3, 230]);
  for (const [at, gain, cutoff] of hits) {
    t.put(out, burst(t, 0.3, 35, t.c(cutoff * t.p), 0.004, t.d(0.055), 4), at, t.g(gain));
    t.put(out, thump(t, 0.25, 115 * t.p, 45 * t.p, 0.004, t.d(0.045), 0.5), at, t.g(0.7 * gain));
    const slap = wetNoise(t, 0.08, 500, 3500, 250);
    decayInPlace(slap, t.sr, 0.001, 0.012);
    t.put(out, slap, at + 0.002, t.g(0.3 * gain));
  }
  const cloth = bandNoise(t.n(0.25), t.sr, r, 400, 3000, 2);
  adsr(cloth, t.sr, 0.02, 0.06, 0.3, 0.12);
  t.put(out, cloth, 0.01, t.g(0.15));
  return out;
}

/**
 * Feet dragging on asphalt: two or three steps, the bad leg dragged — each
 * a soft flat footfall and then the shoe scraped forward over the grit
 * (a band of friction noise catching and letting go, a few grains rolling
 * under it); the good leg only scuffs. The gait is uneven, and the last
 * step is always the bad leg, dragged to the end.
 */
export function nightShuffle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.45);
  const out = t.canvas(seconds);
  const steps = r.int(2, 4);
  const first = r.range(0.01, 0.05);
  const last = seconds - r.range(0.47, 0.52);
  for (let k = 0; k < steps; k++) {
    const dragged = (steps - 1 - k) % 2 === 0;
    const at = k === 0 ? first : k === steps - 1 ? last : first + ((last - first) * k) / (steps - 1) * r.range(0.85, 1.15);
    const level = r.range(0.75, 1);
    footfall(out, t, at, level * 0.7);
    const len = dragged ? r.range(0.36, 0.42) : r.range(0.1, 0.16);
    const drag = scrape(t, len, r.range(1300, 2200) * t.p, r.range(70, 140));
    const from = at + (dragged ? 0.03 : 0.01);
    t.put(out, drag, from, level * (dragged ? 0.55 : 0.28));
    scatter(out, t, dragged ? r.int(6, 12) : r.int(2, 4), from, from + len, 2000, 8000, 0.12 * level, 1.1);
  }
  return out;
}

/**
 * Clawing at the barricade: a body thumping against the sandbags and
 * planks, then fingers and nails raking — across burlap, whose weave turns
 * the drag into a coarse buzzing rasp (a catch for every thread), or across
 * the planks in a squealing stick-slip — fibres picked loose, and sometimes
 * a second, weaker shove.
 */
export function nightClaw(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  const shove = (at: number, gain: number): void => {
    t.put(out, burst(t, 0.2, 35, 240, 0.003, t.d(0.045), 4), at, gain);
    t.put(out, knock(t, r.range(160, 220) * t.p, t.d(0.03), 1), at, gain * 0.45);
  };
  shove(0.01, t.g(0.8));
  let at = 0.01 + r.range(0.03, 0.08);
  for (let k = 0, rakes = r.int(2, 4); k < rakes; k++) {
    const len = r.range(0.14, 0.26);
    const wood = r.chance(0.35);
    const v0 = r.range(90, 160);
    const v1 = r.range(200, 320);
    const rake = wood
      ? creak(t, len, (u) => 300 + 500 * Math.sin(Math.PI * u), [[900, 6, 1], [2100, 7, 0.5], [3900, 8, 0.25]], 0.5)
      : creak(t, len, (u) => v0 + (v1 - v0) * Math.sin(Math.PI * Math.min(1, u * 1.3)), [[1300, 1.4, 1], [3200, 1.8, 0.7], [6500, 2, 0.35]], 0.8);
    adsr(rake, t.sr, len * 0.15, len * 0.3, 0.7, len * 0.3);
    t.put(out, rake, at, t.g(wood ? 0.35 : 0.5));
    scatter(out, t, r.int(4, 8), at, at + len, 2000, 8000, 0.12, 1.2);
    at += len * r.range(0.5, 0.9);
  }
  if (r.chance(0.6)) shove(r.range(0.4, 0.55), t.g(0.45));
  return out;
}

/**
 * A runner's lunge into the barricade: a hoarse bark of forced breath, half
 * voice and half air, and a tenth of a second later the impact — a heavy
 * body into sand and planks, the planks rattling in their frame, sand
 * shifting, and the breath knocked out of it.
 */
export function nightLunge(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.75));
  const m = t.cutoff;
  const pitch = r.range(150, 200) * t.p;
  const bark = vocal(t, t.j(0.17, 0.15), {
    f0: (u) => pitch * (1.15 - 0.35 * u),
    voicing: (u) => 0.55 - 0.3 * u,
    tension: () => 0.9,
    jitter: 0.08, shimmer: 0.35, breath: 0.5, rasp: 0.6,
    tract: [
      { f: (u) => lerp(780, 650, u) * m, q: 5, amp: 1 },
      { f: (u) => lerp(1350, 1200, u) * m, q: 6, amp: 0.6 },
      { f: () => 2500 * m, q: 9, amp: 0.3 },
      { f: () => 3500 * m, q: 10, amp: 0.12 },
    ],
    level: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 0.8),
  });
  t.put(out, bark, 0.005, t.g(0.8));
  const hit = t.j(0.13, 0.2);
  t.put(out, burst(t, 0.3, 30, 280, 0.002, t.d(0.06), 4), hit, t.g(1.0));
  t.put(out, thump(t, 0.3, 105 * t.p, 40 * t.p, 0.002, t.d(0.06), 0.5), hit, t.g(0.75));
  t.put(out, knock(t, r.range(150, 210) * t.p, t.d(0.045), 1), hit, t.g(0.5));
  t.put(out, click(t.sr, r, 0.004, 500, 7000), hit, t.g(0.4));
  for (let k = 0; k < 2; k++) {
    t.put(out, knock(t, r.range(220, 320) * t.p, 0.02, 1), hit + 0.035 + k * r.range(0.03, 0.06), t.g(0.18));
  }
  t.put(out, sandTrickle(t, 0.35), hit + 0.02, t.g(0.12));
  const ugh = vocal(t, 0.16, {
    f0: () => pitch * 0.7,
    voicing: () => 0.25,
    tension: () => 0.8,
    jitter: 0.1, breath: 0.5,
    tract: [{ f: () => 600 * m, q: 4, amp: 1 }, { f: () => 1150 * m, q: 5, amp: 0.5 }],
    level: (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.5),
  });
  t.put(out, ugh, hit + 0.01, t.g(0.3));
  return out;
}

/**
 * A bloater bursting: its skin straining for an instant, then a muffled wet
 * rupture — a gut, not a balloon: a deep thump, a low-passed blast of air, a
 * thick wet tear — the gas hissing out through the tear and sputtering,
 * a few big bubbles gurgling as it empties, and what was inside it
 * pattering down onto the road and the sandbags, thinning out.
 */
export function nightBloatBurst(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.9);
  const out = t.canvas(seconds);
  const strain = creak(t, 0.07, (u) => 60 + 140 * u, [[220, 3, 1], [520, 4, 0.6]], 0.6);
  adsr(strain, t.sr, 0.03, 0.02, 0.8, 0.01);
  t.put(out, strain, 0.005, t.g(0.2));
  const at = 0.07;
  t.put(out, thump(t, 0.5, 95 * t.p, 32 * t.p, 0.002, t.d(0.08), 0.5), at, t.g(0.9));
  t.put(out, burst(t, 0.4, 40, t.c(650), 0.002, t.d(0.06), 4), at, t.g(1.0));
  const tear = wetNoise(t, 0.5, 250, t.c(2400), 120);
  adsr(tear, t.sr, 0.004, 0.08, 0.35, 0.25);
  decayInPlace(tear, t.sr, 0, t.d(0.12));
  t.put(out, tear, at + 0.002, t.g(0.7));
  const hissLen = t.j(0.9, 0.15);
  const n = t.n(hissLen);
  const gas = bandNoise(n, t.sr, r, 900, t.c(6500), 2);
  const sput = wobble(n, t.sr, 22, () => r.next());
  for (let i = 0; i < n; i++) gas[i]! *= 0.45 + 0.55 * Math.abs(sput[i]!);
  adsr(gas, t.sr, 0.03, 0.2, 0.5, hissLen * 0.5);
  decayInPlace(gas, t.sr, 0, 0.35);
  t.put(out, gas, at + 0.02, t.g(0.35));
  for (let k = 0, c = r.int(3, 6); k < c; k++) {
    t.put(out, bubble(t, r.range(140, 320) * t.p, r.range(0.02, 0.04), r.range(1.3, 1.8)), at + r.range(0.08, 0.5), r.range(0.12, 0.25));
  }
  const span = seconds - at - 0.4;
  for (let k = 0, c = r.int(22, 34); k < c; k++) {
    const when = at + 0.15 + Math.pow(r.next(), 1.6) * span;
    const size = r.range(0.3, 1) * (1 - (0.6 * (when - at)) / seconds);
    t.put(out, burst(t, 0.04, 350, 3500, 0.0005, r.range(0.004, 0.012)), when, 0.25 * size);
    if (r.chance(0.3)) t.put(out, bubble(t, r.range(600, 1400), r.range(0.005, 0.01), 1.5), when + 0.003, 0.1 * size);
  }
  return out;
}

/**
 * The Mechanic's roar, heard through a steel welding mask: a loud breath in
 * through the mask's slot, then a huge man's roar — pressed, rough, the
 * false folds growling under it, the mouth wide — muffled by the steel over
 * his face (the top gone) and ringing inside it: a short comb of the mask's
 * cavity and a few sharp resonances of the shell.
 */
export function nightMechRoar(t: Take): Mono {
  const r = t.rng;
  const len = t.j(2.2, 0.1);
  const out = t.canvas(len + 0.35);
  const pitch = r.range(72, 88) * t.p;
  const m = 0.9 * t.cutoff;
  const drift = wanderTrack(t.n(len), r, 4, t.sr);
  const inhale = vocal(t, 0.28, {
    f0: () => pitch,
    voicing: () => 0,
    tract: [{ f: (u) => lerp(500, 700, u), q: 4, amp: 1 }, { f: () => 1600, q: 5, amp: 0.5 }],
    level: (u) => Math.sin(Math.PI * u) ** 1.5,
  });
  t.put(out, inhale, 0, 0.2);
  const roar = vocal(t, len, {
    f0: (u) => pitch * (0.9 + 0.35 * Math.min(1, u * 4) - 0.3 * Math.max(0, u - 0.7)) * (1 + 0.06 * (2 * drift(u) - 1)),
    tension: (u) => 0.75 + 0.2 * Math.sin(Math.PI * u),
    jitter: 0.06, shimmer: 0.3, breath: 0.35, rasp: 0.55,
    tract: [
      { f: (u) => lerp(620, 760, u * 3) * m, q: 6, amp: 1 },
      { f: () => 1150 * m, q: 7, amp: 0.7 },
      { f: () => 2450 * m, q: 9, amp: 0.35 },
      { f: () => 3300 * m, q: 11, amp: 0.15 },
    ],
    level: (u) => Math.pow(Math.min(1, u * 5), 1.5) * (u < 0.8 ? 1 : Math.pow((1 - u) / 0.2, 1.3)),
    flutter: { rate: 9, depth: 0.2 },
  });
  t.put(out, roar, 0.22, 1);
  // Inside the mask: a feedback comb (the cavity), then the shell's own ringing modes.
  lowpass(out, t.sr, t.c(1900), 2);
  const d = t.n(r.range(0.0009, 0.0013));
  const fb = r.range(0.4, 0.5);
  for (let i = d; i < out.length; i++) out[i]! += fb * out[i - d]!;
  resonate(out, t.sr, r.range(600, 680) * t.p, 18, 0.9);
  resonate(out, t.sr, r.range(1400, 1550) * t.p, 24, 0.7);
  resonate(out, t.sr, r.range(2250, 2450) * t.p, 30, 0.4);
  highpass(out, t.sr, 60, 2);
  return out;
}

/**
 * The Mechanic's tyre iron: swung — a whoosh swelling as it comes down,
 * with the thin whistle of its hooked end — and striking the barricade: the
 * iron's own clang (a free bar's partials, 1 : 2.76 : 5.40 : 8.93), the
 * planks' knock and the sand's thud, grit jumping.
 */
export function nightSwing(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  const sw = t.j(0.3, 0.15);
  const n = t.n(sw + 0.04);
  const rise = (u: number): number => Math.sin(Math.PI * Math.min(1, u * 1.1));
  const air = white(n, r);
  svf(air, t.sr, "bp", (u) => (500 + 1300 * rise(u)) * t.p, 2.2, 16);
  normalize(air);
  const whistle = white(n, r);
  svf(whistle, t.sr, "bp", (u) => (500 + 1300 * rise(u)) * 1.9 * t.p, 14, 16);
  lowpass(whistle, t.sr, 4000, 2);
  normalize(whistle);
  for (let i = 0; i < n; i++) air[i] = air[i]! * 0.8 + whistle[i]! * 0.25;
  shapeBy(air, (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 2) * (0.3 + 0.7 * u));
  t.put(out, air, 0, t.g(0.45));
  const at = sw;
  t.put(out, click(t.sr, r, 0.004, 900, 12000), at, t.g(1.1));
  const f = r.range(650, 900) * t.p;
  for (const [k, a, tau] of [[1, 0.5, 0.13], [2.756, 0.35, 0.07], [5.404, 0.2, 0.04], [8.933, 0.1, 0.02]] as const) {
    addMode(out, t.sr, at, f * k * r.range(0.99, 1.01), a * r.sign(), t.d(tau), 0);
  }
  t.put(out, knock(t, r.range(150, 220) * t.p, t.d(0.04), 1), at, t.g(0.8));
  t.put(out, burst(t, 0.2, 35, 260, 0.002, t.d(0.05), 4), at, t.g(0.85));
  scatter(out, t, r.int(4, 8), at + 0.01, at + 0.25, 1500, 7000, 0.1, 1.4);
  return out;
}

/**
 * Something climbing out of the burned school bus: its weight on buckled
 * sheet steel — a low metallic groan and the pops of panels snapping
 * between shapes — safety glass crunching under a foot, and then a
 * two-footed thump down onto the road and a scuff.
 */
export function nightClimb(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.55);
  const out = t.canvas(seconds);
  const groanLen = r.range(0.55, 0.8);
  const walk = wanderTrack(t.n(groanLen), r, 5, t.sr);
  const metal = creak(t, groanLen, (u) => 35 + 70 * walk(u), [[300, 9, 1], [760, 12, 0.7], [1500, 14, 0.4], [2700, 16, 0.2]], 0.5);
  adsr(metal, t.sr, 0.1, 0.2, 0.7, 0.2);
  t.put(out, metal, 0.02, t.g(0.5));
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    const at = r.range(0.05, 0.75);
    const f = r.range(150, 320);
    t.put(out, click(t.sr, r, 0.003, 600, 8000), at, 0.4);
    addMode(out, t.sr, at, f, 0.5 * r.sign(), r.range(0.05, 0.09), 0);
    addMode(out, t.sr, at, f * r.range(1.6, 1.9), 0.3 * r.sign(), r.range(0.03, 0.06), 0);
    addMode(out, t.sr, at, f * r.range(3.1, 3.6), 0.15, r.range(0.015, 0.03), 0);
    t.put(out, burst(t, 0.05, 80, 600, 0.0008, 0.012, 2), at, 0.35);
  }
  for (let c = 0, count = r.int(1, 3); c < count; c++) {
    const at = r.range(0.15, 0.8);
    scatter(out, t, r.int(18, 30), at, at + r.range(0.06, 0.12), 2500, 10000, 0.3, 1.0);
    t.put(out, burst(t, 0.05, 400, 2600, 0.001, 0.01), at, 0.25);
    for (let k = 0; k < 2; k++) addShard(out, t, at + r.range(0, 0.1), r.range(3500, 8000), r.range(0.04, 0.1), r.range(0.008, 0.02));
  }
  const land = seconds - r.range(0.4, 0.5);
  t.put(out, burst(t, 0.25, 35, 260, 0.003, t.d(0.05), 4), land, t.g(0.9));
  t.put(out, thump(t, 0.2, 110 * t.p, 48 * t.p, 0.003, 0.04, 0.5), land, t.g(0.6));
  footfall(out, t, land + r.range(0.04, 0.09), t.g(0.5), 1.8);
  t.put(out, scrape(t, 0.2, 1800, 110), land + 0.06, t.g(0.2));
  scatter(out, t, r.int(4, 8), land, land + 0.25, 2000, 8000, 0.1, 1.3);
  return out;
}

/**
 * A body going over a split-rail fence: the rail creaking under its weight
 * (dry, then wet wood: a slow stick-slip), hands and knees knocking the
 * rail, cloth dragging over it, and a heavy thud onto the wet grass — grass
 * gives no slap, only a swish — and a second, lighter one.
 */
export function nightVault(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.0);
  const out = t.canvas(seconds);
  const creakLen = r.range(0.3, 0.42);
  const load = r.range(0.9, 1.1);
  const rail = creak(t, creakLen, (u) => (50 + 70 * Math.sin(Math.PI * u)) * load, [[240, 4, 1], [600, 5, 0.7], [1300, 6, 0.35]], 0.45);
  adsr(rail, t.sr, 0.05, 0.1, 0.7, 0.1);
  t.put(out, rail, 0.02, t.g(0.6));
  t.put(out, knock(t, r.range(260, 340) * t.p, 0.025, 1), 0.02, t.g(0.45));
  t.put(out, knock(t, r.range(230, 300) * t.p, 0.02, 1), 0.02 + r.range(0.1, 0.2), t.g(0.3));
  const cloth = bandNoise(t.n(0.25), t.sr, r, 500, 3500, 2);
  adsr(cloth, t.sr, 0.04, 0.08, 0.4, 0.1);
  t.put(out, cloth, 0.08, t.g(0.15));
  const land = 0.02 + creakLen + r.range(0.08, 0.16);
  t.put(out, burst(t, 0.3, 30, 200, 0.004, t.d(0.06), 4), land, t.g(1.0));
  t.put(out, thump(t, 0.25, 90 * t.p, 40 * t.p, 0.004, t.d(0.05), 0.5), land, t.g(0.7));
  const grass = bandNoise(t.n(0.15), t.sr, r, 1500, 6000, 2);
  decayInPlace(grass, t.sr, 0.004, 0.04);
  t.put(out, grass, land, t.g(0.2));
  t.put(out, burst(t, 0.2, 35, 220, 0.004, 0.035, 4), land + r.range(0.1, 0.18), t.g(0.45));
  return out;
}

/**
 * Something pushing through tall dry corn: two to four surges as it
 * shoulders forward, each the long leaves rasping and crackling against it
 * and each other, the stalks bending with a hollow creak, and now and then
 * one snapping.
 */
export function nightCornRustle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.45);
  const out = t.canvas(seconds);
  const surges = r.int(2, 5);
  const bumps: [number, number, number][] = [];
  for (let k = 0; k < surges; k++) {
    const c = 0.15 + (0.65 * (k + r.range(0.2, 0.8))) / surges;
    bumps.push([c, r.range(0.08, 0.14), r.range(0.6, 1)]);
  }
  const envelope = (u: number): number => {
    let e = 0;
    for (const [c, w, a] of bumps) e += a * Math.exp(-(((u - c) / w) ** 2));
    return Math.min(1, e) * Math.min(1, u * 20) * Math.min(1, (1 - u) * 12);
  };
  const rasp = leafRasp(t, seconds, r.range(50, 80));
  shapeBy(rasp, envelope, 32);
  t.put(out, rasp, 0, t.g(0.6));
  const hush = bandNoise(t.n(seconds), t.sr, r, 700, 2600, 2);
  shapeBy(hush, envelope, 64);
  t.put(out, hush, 0, t.g(0.15));
  for (const [c, w, a] of bumps) {
    const at = c * seconds;
    scatter(out, t, r.int(8, 16), Math.max(0, at - w * seconds), at + w * seconds, 2000, 9000, 0.2 * a, 1.0);
    const bend = creak(t, r.range(0.15, 0.25), (u) => 25 + 35 * Math.sin(Math.PI * u), [[500, 4, 1], [1200, 5, 0.6], [2600, 6, 0.3]], 0.6);
    adsr(bend, t.sr, 0.04, 0.05, 0.7, 0.05);
    t.put(out, bend, Math.max(0, at - 0.05), 0.2 * a);
  }
  if (r.chance(0.35)) {
    const at = r.range(0.3, 0.8) * seconds;
    t.put(out, click(t.sr, r, 0.003, 900, 11000), at, 0.4);
    t.put(out, knock(t, r.range(600, 850), 0.008, 1), at, 0.3);
  }
  return lowpass(out, t.sr, t.c(9000), 2);
}

// --- the player -----------------------------------------------------------------------

/**
 * Clawed: a muffled blow through the body and the slap of the jacket, three
 * nails raking across the cloth side by side (a fast coarse tear), and a
 * sharp breath in — no voice, no word.
 */
export function nightHurt(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  t.put(out, thump(t, 0.35, 92 * t.p, 38 * t.p, 0.002, t.d(0.08), 0.5), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 35, 260, 0.002, t.d(0.06), 4), 0, t.g(0.85));
  t.put(out, burst(t, 0.05, 450, 2600, 0.0005, 0.008), 0, t.g(0.45));
  const len = t.j(0.15, 0.2);
  for (let k = 0; k < 3; k++) {
    const speed = r.range(0.85, 1.15);
    const rake = creak(t, len, (u) => (380 + 350 * Math.sin(Math.PI * u)) * speed, [[1400, 1.3, 1], [3300, 1.6, 0.8], [6800, 2, 0.4]], 0.9);
    adsr(rake, t.sr, len * 0.1, len * 0.3, 0.6, len * 0.35);
    t.put(out, rake, 0.005 + k * r.range(0.004, 0.012), t.g(0.4));
  }
  const gasp = vocal(t, t.j(0.2, 0.15), {
    f0: () => 140,
    voicing: () => 0,
    tract: [
      { f: (u) => lerp(420, 720, u), q: 5, amp: 1 },
      { f: (u) => lerp(1500, 1850, u), q: 7, amp: 0.6 },
      { f: () => 2700, q: 9, amp: 0.25 },
    ],
    level: (u) => Math.pow(Math.min(1, u / 0.7), 1.5) * (u < 0.85 ? 1 : (1 - u) / 0.15),
  });
  t.put(out, gasp, t.j(0.24, 0.15), t.g(0.5));
  return out;
}

/**
 * The player's death, heard from inside and muffled: the knees going and
 * the body slumping onto the asphalt; the flashlight out of your hands — a
 * bright aluminium clank, two bounces, then rolling on the road (its clip
 * ticking once a turn, slower and slower) until it stops; two last
 * heartbeats, the second later and weaker; a pressure in the ears; and the
 * ears ringing as the night goes away.
 */
export function nightDeath(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(3.5);
  const body = t.canvas(3.5);
  t.put(body, burst(t, 0.3, 35, 300, 0.003, 0.05, 4), 0.12, 0.6);
  t.put(body, thump(t, 0.3, 95 * t.p, 45 * t.p, 0.003, 0.05, 0.5), 0.12, 0.45);
  t.put(body, thump(t, 0.5, 85 * t.p, 33 * t.p, 0.003, 0.12, 0.5), 0.42, 1.0);
  t.put(body, burst(t, 0.45, 30, 360, 0.003, 0.09, 4), 0.42, 0.9);
  t.put(body, burst(t, 0.2, 35, 280, 0.003, 0.04, 4), 0.58, 0.4);
  t.put(body, heartBeat(t, 0.3, 1), 1.0, 0.9);
  t.put(body, heartBeat(t, 0.36, 1), 2.25, 0.55);
  const swell = t.canvas(3.2);
  for (const [f, a] of [[55, 1], [82.4, 0.6], [110, 0.25]] as const) addMode(swell, t.sr, 0, f * t.p, a, 1000, r.range(0, 6));
  adsr(swell, t.sr, 0.6, 0.8, 0.6, 1.5);
  t.put(body, swell, 0.2, 0.2);
  lowpass(body, t.sr, 1000, 2);
  t.put(out, body, 0, 1);
  // The flashlight: an aluminium tube (a free bar's partials) bouncing, then rolling.
  const torch = t.canvas(3.3);
  const f = r.range(1150, 1500);
  let at = r.range(0.3, 0.36);
  let g = 1;
  let gap = r.range(0.11, 0.15);
  for (let k = 0; k < 3; k++) {
    t.put(torch, click(t.sr, r, 0.002, 1500, 12000), at, g * 0.6);
    addMode(torch, t.sr, at, f * r.range(0.99, 1.01), g * 0.6, 0.05, 0);
    addMode(torch, t.sr, at, f * 2.756, g * 0.35, 0.025, 0);
    addMode(torch, t.sr, at, f * 5.404, g * 0.15, 0.012, 0);
    t.put(torch, burst(t, 0.03, 200, 1500, 0.0005, 0.006), at, g * 0.3);
    at += gap;
    gap *= 0.6;
    g *= 0.5;
  }
  const rollLen = r.range(1.4, 1.9);
  const n = t.n(rollLen);
  const roll = bandNoise(n, t.sr, r, 700, 4200, 2);
  const rev0 = r.range(3.5, 5);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const rate = rev0 * Math.pow(1 - u, 1.3) + 0.05;
    const before = ph;
    ph += rate / t.sr;
    const bump = 0.5 + 0.5 * Math.cos(2 * Math.PI * ph);
    roll[i]! *= (0.4 + 0.6 * bump * bump) * Math.pow(1 - u, 1.2) * Math.min(1, u * 30);
    // The pocket clip meets the road once a turn.
    if (Math.floor(before) !== Math.floor(ph)) {
      addMode(torch, t.sr, at + i / t.sr, r.range(2500, 3100), 0.2 * Math.pow(1 - u, 0.8), 0.006, 0);
    }
  }
  t.put(torch, roll, at, 0.12);
  lowpass(torch, t.sr, 3800, 2);
  t.put(out, torch, 0, 0.5);
  const ring = t.canvas(3.2);
  const tinnitus = r.range(3300, 4000);
  addMode(ring, t.sr, 0, tinnitus, 1, 1000, 0);
  addMode(ring, t.sr, 0, tinnitus + 2.5, 0.6, 1000, 0);
  shapeBy(ring, (u) => Math.min(1, u * 5) ** 2 * Math.pow(1 - u, 1.5));
  t.put(out, ring, 0.15, 0.03);
  return out;
}

// --- the night: loops ------------------------------------------------------------------

/**
 * One pulse of a cricket's song: the file dragged over the scraper rings the
 * wing's harp at its note, so a pulse is a near-pure tone that swells and
 * dies (the difference of two decays) in a hundredth of a second or so.
 */
function cricketPulse(t: Take, f: number, seconds: number): Mono {
  const buf = t.canvas(seconds);
  const fall = seconds / 4.5;
  addMode(buf, t.sr, 0, f, 1, fall, 0);
  addMode(buf, t.sr, 0, f, -1, fall / 3, 0);
  addMode(buf, t.sr, 0, f * 2, 0.04, fall / 2, 0);
  fade(buf, t.sr, 0, seconds * 0.3);
  return normalize(buf);
}

/**
 * The fields at night, stereo: field crickets scattered left and right, each
 * singing its chirp (three to five pulses of its own note) on its own
 * period; a tree cricket's endless trill swelling and fading; spring peepers
 * (a rising *peep*, over and over); in most takes one bullfrog's deep
 * *jug-o-rum* somewhere off in the ditch; and under them all the far chorus,
 * a shimmer of thousands too far to tell apart.
 *
 * Every singer's period fits the loop a whole number of times and every
 * event is wrapped round, so the loop has no seam and no hiccup in anyone's
 * rhythm. The chorus is one seamless loop, the right channel's copy turned
 * round (noise, so the turn is inaudible and the two sides are
 * uncorrelated).
 */
export function nightCrickets(t: Take): Mono[] {
  const r = t.rng;
  const seconds = r.range(6.2, 7.6);
  const length = t.n(seconds);
  const extra = t.n(0.8);
  const left = new Float32Array(length + extra);
  const right = new Float32Array(length + extra);
  const place = (buf: Mono, at: number, gain: number, p: number): void => {
    const [gl, gr] = panGains(p);
    t.put(left, buf, at, gain * gl);
    t.put(right, buf, at, gain * gr);
  };
  // Nothing starts in the loop's first few milliseconds: the wrap carries it past the end instead.
  const start = (period: number): number => 0.012 + r.range(0, period);

  for (let c = 0, count = r.int(4, 7); c < count; c++) {
    const note = r.range(4300, 5200) * t.p;
    const near = r.next();
    const gain = 0.25 + 0.75 * near * near;
    const p = r.range(-0.95, 0.95);
    const pulse = cricketPulse(t, note, r.range(0.012, 0.018));
    const pulses = r.int(3, 6);
    const pulseGap = 1 / r.range(26, 34);
    const chirps = Math.max(1, Math.round(seconds * r.range(1.3, 2.6)));
    const period = seconds / chirps;
    const offset = start(period);
    for (let k = 0; k < chirps; k++) {
      const at = offset + k * period + r.range(0, 0.012);
      for (let q = 0; q < pulses; q++) {
        const shape = q === 0 ? 0.6 : q === pulses - 1 ? 0.8 : 1;
        place(pulse, at + q * pulseGap, gain * shape * r.range(0.85, 1.1), p);
      }
    }
  }

  for (let c = 0, count = r.int(1, 3); c < count; c++) {
    const note = r.range(2600, 3300) * t.p;
    const pulse = cricketPulse(t, note, r.range(0.01, 0.014));
    const beats = Math.round(seconds * r.range(38, 55));
    const period = seconds / beats;
    const p = r.range(-0.8, 0.8);
    const cycles = r.int(1, 3);
    const phase = r.range(0, 2 * Math.PI);
    const offset = start(period);
    for (let k = 0; k < beats; k++) {
      const u = k / beats;
      const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * cycles * u + phase);
      place(pulse, offset + k * period, 0.3 * swell * r.range(0.9, 1.05), p);
    }
  }

  for (let c = 0, count = r.int(2, 4); c < count; c++) {
    const note = r.range(2700, 3300) * t.p;
    const peeps = [0, 1].map(() => {
      const len = r.range(0.09, 0.13);
      const n = t.n(len);
      const lift = r.range(0.08, 0.14);
      const freq = sampled(n, (u) => note * (1 - lift + lift * Math.pow(u, 0.6)), 16);
      const level = sampled(n, (u) => Math.min(1, u * 12) * Math.pow(1 - u, 0.6));
      return tone(t, freq, level, 0.06, 0);
    });
    const calls = Math.max(1, Math.round(seconds / r.range(0.9, 1.5)));
    const period = seconds / calls;
    const p = r.range(-1, 1);
    const gain = r.range(0.25, 0.6);
    const offset = start(period);
    for (let k = 0; k < calls; k++) {
      if (r.chance(0.12)) continue;
      place(peeps[k % 2]!, offset + k * period + r.range(-0.04, 0.04), gain * r.range(0.85, 1.1), p);
    }
  }

  if (t.index % 3 !== 1) {
    const croak = r.range(92, 108);
    const frog = vocal(t, r.range(0.55, 0.7), {
      f0: (u) => croak * (1 - 0.08 * u),
      tension: () => 0.85,
      jitter: 0.03, shimmer: 0.15, rasp: 0.3,
      tract: [{ f: () => 230, q: 3, amp: 1 }, { f: () => 460, q: 4, amp: 0.6 }, { f: () => 1300, q: 5, amp: 0.3 }],
      // "jug" — a breath — "o-rum", the second note throbbing.
      level: (u) => (u < 0.33 ? Math.sin((Math.PI * u) / 0.33) : u < 0.42 ? 0 : Math.sin((Math.PI * (u - 0.42)) / 0.58) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 9 * u))),
    });
    lowpass(frog, t.sr, 1200, 2);
    place(frog, r.range(0.3, seconds), 0.55, r.range(-0.8, 0.8));
  }

  const bedN = length + t.n(0.3);
  const bed = bandNoise(bedN, t.sr, r, 3600, 6200, 2);
  const shimmer = wobble(bedN, t.sr, 28, () => r.next());
  for (let i = 0; i < bedN; i++) bed[i]! *= 0.4 + 0.6 * Math.abs(shimmer[i]!);
  const chorus = loopify(bed, length);
  const chorusR = turned(chorus, t.n(r.range(0.4, 0.9)));
  const L = wrap(left, length);
  const R = wrap(right, length);
  for (let i = 0; i < length; i++) {
    L[i]! += 0.06 * chorus[i]!;
    R[i]! += 0.06 * chorusR[i]!;
  }
  return [L, R];
}

/** A periodic gust curve over ``length`` samples: a few sines with whole cycles in the loop, so it loops exactly. */
function gustCurve(n: number, length: number, rng: Rng, strength: number): Float32Array {
  const parts = [1, 2, 3, 5].map((k) => ({ k, a: rng.range(0.3, 1) / k ** 0.6, ph: rng.range(0, 6.28) }));
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
    coarse[k] = 1 - strength + strength * u ** 1.6;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / step);
    const f = (i - k * step) / step;
    out[i] = coarse[k]! + (coarse[k + 1]! - coarse[k]!) * f;
  }
  return out;
}

/**
 * A slow night wind over the corn and the grass, stereo: a soft low body of
 * moving air whose top opens a little with each gust, and the corn's long
 * dry leaves rasping and ticking against each other — only when the air is
 * strong enough to move them, in waves as a gust runs through the field. No
 * whistle: there is nothing out here for it to whistle through.
 *
 * One channel is synthesised; the other is the same seamless loop turned
 * round by half a second, so the gusts cross the field.
 */
export function nightWind(t: Take): Mono[] {
  const r = t.rng;
  const seconds = r.range(6.4, 7.6);
  const length = t.n(seconds);
  const n = length + t.n(0.7);
  const gust = gustCurve(n, length, r, 0.7);
  const bed = pink(n, r);
  svf(bed, t.sr, "lp", (u) => (180 + 520 * gust[Math.floor(u * n)]!) * t.p, 0.7, 64);
  highpass(bed, t.sr, 40, 2);
  normalize(bed);
  const leaves = bandNoise(n, t.sr, r, 1800, t.c(8000), 2);
  const flick = wobble(n, t.sr, 55, () => r.next());
  const wave = wobble(n, t.sr, 5, () => r.next());
  const grass = bandNoise(n, t.sr, r, 2500, 9000, 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = gust[i]!;
    const f = flick[i]!;
    const strong = g > 0.45 ? (g - 0.45) / 0.55 : 0;
    const rasp = strong * strong * (0.2 + 0.8 * f * f) * (0.65 + 0.35 * wave[i]!);
    out[i] = bed[i]! * g * 0.9 + leaves[i]! * rasp * 0.6 + grass[i]! * g * g * 0.05;
  }
  const leftLoop = loopify(out, length);
  return [leftLoop, turned(leftLoop, t.n(r.range(0.4, 0.7)))];
}

/**
 * The sodium streetlight: its magnetic ballast buzzing on 120 Hz (the core
 * flexing twice each cycle of the mains) with harmonics up into the kHz and a
 * hump where the lamp's housing rings; the buzz slowly changing colour and
 * level; the arc's thin sizzle, re-striking every cycle; and now and then a
 * tiny sputter. The cycle is a whole number of samples and the loop a whole
 * number of cycles, so the buzz tiles exactly.
 */
export function nightBuzz(t: Take): Mono {
  const r = t.rng;
  const P = Math.round(t.sr / 120);
  const cycles = Math.round((r.range(2.6, 3.4) * t.sr) / P);
  const length = P * cycles;
  const a = buzzCycle(P, r, t.sr, 22, r.range(700, 1100), 350, 0.9);
  const b = buzzCycle(P, r, t.sr, 22, r.range(900, 1500), 450, 0.75);
  const m1 = r.int(1, 3);
  const m2 = r.int(2, 5);
  const p1 = r.range(0, 6.28);
  const p2 = r.range(0, 6.28);
  const out = new Float32Array(length);
  const step = 64;
  for (let i0 = 0; i0 < length; i0 += step) {
    const u = i0 / length;
    const mix = 0.5 + 0.5 * Math.sin(2 * Math.PI * m1 * u + p1);
    const lvl = 1 + 0.08 * Math.sin(2 * Math.PI * m2 * u + p2);
    const end = Math.min(length, i0 + step);
    for (let i = i0; i < end; i++) {
      const k = i % P;
      out[i] = lvl * (a[k]! + (b[k]! - a[k]!) * mix);
    }
  }
  const n = length + P * Math.round((0.15 * t.sr) / P);
  const sizzle = bandNoise(n, t.sr, r, 1800, t.c(7000), 2);
  const pulse = new Float32Array(P);
  const shift = r.next();
  for (let i = 0; i < P; i++) pulse[i] = Math.pow(Math.abs(Math.sin(Math.PI * (i / P + shift))), 8);
  for (let i = 0; i < n; i++) sizzle[i]! *= 0.25 + pulse[i % P]!;
  const hiss = loopify(sizzle, length);
  const seconds = length / t.sr;
  const events = new Float32Array(length + t.n(0.1));
  for (let k = 0, c = r.int(3, 8); k < c; k++) {
    let at = r.range(0.01, seconds + 0.01);
    for (let j = 0, clicks = r.int(2, 6); j < clicks; j++) {
      t.put(events, click(t.sr, r, r.range(0.0008, 0.0015), 1500, 12000), at, r.range(0.15, 0.4));
      at += r.range(0.002, 0.009);
    }
  }
  const crackle = wrap(events, length);
  for (let i = 0; i < length; i++) out[i]! += 0.12 * hiss[i]! + crackle[i]!;
  return out;
}

/**
 * The power lines along the road: their hum (120 Hz strongest, where the
 * corona pulses twice a cycle, with 60 and the harmonics under and over it),
 * the corona's faint frying riding each half-cycle, and the wires singing
 * faintly in the wind — two of the span's harmonics, found and lost as the
 * air shifts (narrow bands of noise, so they waver like the real thing).
 */
export function nightHum(t: Take): Mono {
  const r = t.rng;
  const P = Math.round(t.sr / 60);
  const cycles = Math.round((r.range(4.2, 5.2) * t.sr) / P);
  const length = P * cycles;
  const cyc = new Float32Array(P);
  const parts: [number, number][] = [[1, 0.35], [2, 1], [3, 0.3], [4, 0.45], [5, 0.12], [6, 0.2], [8, 0.1], [10, 0.06], [12, 0.04]];
  for (const [k, a0] of parts) {
    const a = a0 * Math.pow(10, r.range(-3, 3) / 20);
    const ph = r.range(0, 2 * Math.PI);
    for (let i = 0; i < P; i++) cyc[i]! += a * Math.sin((2 * Math.PI * k * i) / P + ph);
  }
  normalize(cyc);
  const out = new Float32Array(length);
  const m = r.int(1, 3);
  const mp = r.range(0, 6.28);
  for (let i0 = 0; i0 < length; i0 += 64) {
    const lvl = 0.85 + 0.15 * Math.sin((2 * Math.PI * m * i0) / length + mp);
    const end = Math.min(length, i0 + 64);
    for (let i = i0; i < end; i++) out[i] = lvl * cyc[i % P]!;
  }
  const n = length + P * Math.round((0.3 * t.sr) / P);
  const frying = bandNoise(n, t.sr, r, 2500, 9000, 2);
  const pulse = new Float32Array(P);
  for (let i = 0; i < P; i++) pulse[i] = Math.pow(Math.abs(Math.sin((2 * Math.PI * i) / P)), 6);
  for (let i = 0; i < n; i++) frying[i]! *= pulse[i % P]!;
  const fry = loopify(frying, length);
  const span = r.range(150, 230) * t.p;
  const h1 = r.int(2, 4);
  const h2 = h1 + r.int(1, 3);
  const singing = new Float32Array(n);
  for (const h of [h1, h2]) {
    const sway = wanderTrack(n, r, 0.6, t.sr);
    const sing = svf(white(n, r), t.sr, "bp", (u) => span * h * (1 + 0.012 * (2 * sway(u) - 1)), 70, 32);
    normalize(sing);
    const swell = wobble(n, t.sr, r.range(0.25, 0.45), () => r.next());
    for (let i = 0; i < n; i++) {
      const s = 0.5 + 0.5 * swell[i]!;
      singing[i]! += sing[i]! * s * s;
    }
  }
  const song = loopify(singing, length);
  for (let i = 0; i < length; i++) out[i]! += 0.05 * fry[i]! + 0.22 * song[i]!;
  return out;
}

/** One frame of the projector's intermittent: the claw dropping into the sprocket holes and pulling the film down — a double tick. */
function clatter(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.04);
  t.put(out, click(t.sr, r, 0.002, 600, 7000), 0.001, 1);
  addMode(out, t.sr, 0.001, r.range(1800, 2600), 0.3, 0.003, 0);
  t.put(out, burst(t, 0.02, 150, 1200, 0.0005, 0.004), 0.001, 0.6);
  const second = r.range(0.008, 0.012);
  t.put(out, click(t.sr, r, 0.0015, 900, 6000), second, 0.5);
  addMode(out, t.sr, second, r.range(2800, 3600), 0.15, 0.002, 0);
  return out;
}

/**
 * A film projector on the hill, far off: the intermittent clattering 24
 * times a second (the claw pulling the film down a frame at a time), the
 * two-bladed shutter chopping the air 48 times a second, the motor's thin
 * whine, and once a turn the take-up reel's bent flange scraping. Heard
 * across the fields, so the top is gone. The loop is a whole number of
 * frames, the whine and the reel a whole number of cycles in it.
 */
export function nightProjector(t: Take): Mono {
  const r = t.rng;
  const frames = r.int(60, 80);
  const length = Math.round((frames * t.sr) / 24);
  const fp = length / frames;
  const events = new Float32Array(length + t.n(0.3));
  const variants = [0, 1, 2, 3].map(() => clatter(t));
  for (let k = 0; k < frames; k++) {
    const at = (k * fp) / t.sr + 0.004 + r.range(-0.0003, 0.0003);
    t.put(events, variants[r.int(0, 4)]!, at, r.range(0.8, 1.05));
  }
  const turns = r.int(1, 3);
  for (let k = 0; k < turns; k++) {
    const at = ((k + r.range(0.2, 0.4)) * length) / turns / t.sr;
    t.put(events, scrape(t, 0.25, 1400, 90), at, 0.15);
  }
  const airN = length + t.n(0.2);
  const air = bandNoise(airN, t.sr, r, 300, 2000, 2);
  const blades = frames * 2;
  for (let i = 0; i < airN; i++) {
    const c = Math.cos((Math.PI * blades * i) / length);
    air[i]! *= 0.5 + 0.5 * c * c;
  }
  const whir = loopify(air, length);
  lowpass(events, t.sr, t.c(2400), 2);
  const ev = wrap(events, length);
  const whine = Math.round((r.range(180, 260) * length) / t.sr);
  const out = new Float32Array(length);
  const w = (2 * Math.PI * whine) / length;
  for (let i = 0; i < length; i++) {
    out[i] = ev[i]! + 0.08 * whir[i]! + 0.025 * Math.sin(w * i) + 0.012 * Math.sin(2 * w * i + 1);
  }
  return out;
}

// --- the ballad on the station's radio -------------------------------------------------------

/** The lead's melody over two bars of 12/8: [eighth, midi, eighths long]. An original doo-wop line in C. */
const BALLAD_LEAD: readonly [number, number, number][] = [
  [0, 64, 3], [3, 67, 3],
  [6, 69, 4], [10, 67, 1], [11, 64, 1],
  [12, 65, 3], [15, 69, 3],
  [18, 67, 3], [21, 65, 1.5], [22.5, 62, 1.5],
];

/** I–vi–IV–V, two chords a bar: the bass's root, fifth and walk into the next chord; the piano's triplet chord; the group's "ooh". */
const BALLAD_CHORDS: readonly { bass: readonly [number, number, number]; tri: readonly number[]; pad: readonly number[] }[] = [
  { bass: [48, 43, 47], tri: [67, 72, 76], pad: [55, 60, 64] },
  { bass: [45, 40, 43], tri: [69, 72, 76], pad: [57, 60, 64] },
  { bass: [41, 48, 42], tri: [69, 72, 77], pad: [57, 60, 65] },
  { bass: [43, 50, 47], tri: [71, 74, 77], pad: [55, 59, 65] },
];

/**
 * A 1950s ballad from the old tube radio behind the counter: a slow 12/8
 * doo-wop in C — I, vi, IV, V, two chords a bar — the piano hammering its
 * triplet chords on every eighth, an upright bass walking root, fifth and a
 * step into the next chord, brushes swirling on the snare with a tap on the
 * backbeat, the group's soft "ooh" under a crooner's "oh" (formant vowels,
 * no words). All of it through the radio: the little speaker's 250–3500 Hz,
 * its cone and cabinet honking, the tube's soft asymmetric saturation, a
 * thin static and crackle.
 *
 * The loop is exactly two bars: every event is placed on the bars' grid and
 * wrapped round, the brushes' swirl and the static are built over exactly
 * one loop, the speaker's filters run over the whole render before the wrap
 * (which filters the loop circularly), and the saturation is applied after
 * it, sample by sample. The seam is just the next beat.
 *
 * The radio passes nothing above 3.5 kHz, so the table plays the band at
 * half the rate (see halfRate): the longest sound of the night for half of
 * what it would cost, with nothing audible lost.
 */
export function nightBallad(t: Take): Mono {
  const r = t.rng;
  const beat = 60 / r.range(56, 64);
  const length = t.n(8 * beat);
  const eighth = length / 24 / t.sr;
  const chordLen = 6 * eighth;
  const n = length + t.n(0.7);
  const loopSec = length / t.sr;
  const time = (u: number): number => (u * n) / t.sr;
  const human = (): number => 0.004 + r.range(0, 0.008);

  const piano = new Float32Array(n);
  const bass = new Float32Array(n);
  BALLAD_CHORDS.forEach((chord, c) => {
    for (let e = 0; e < 6; e++) {
      const at = (c * 6 + e) * eighth + human();
      const accent = e === 0 ? 0.85 : e === 3 ? 0.7 : 0.5;
      for (const midi of chord.tri) {
        addString(piano, t.sr, r, at, midiHz(midi), accent * r.range(0.9, 1.05), {
          t60: 1.4, brightness: 0.45, pulse: 0.0022, position: 0.13, length: eighth * 0.92, release: 0.035,
        });
      }
    }
    const [root, fifth, walk] = chord.bass;
    const steps: [number, number, number][] = [[0, root, 2.8], [3, fifth, 1.8], [5, walk, 0.9]];
    for (const [e, midi, len] of steps) {
      addString(bass, t.sr, r, (c * 6 + e) * eighth + human(), midiHz(midi), e === 0 ? 1 : 0.8, {
        t60: 1.5, brightness: 0.15, hardness: 900, position: 0.22, length: len * eighth, release: 0.08,
      });
    }
  });
  normalize(piano);
  normalize(bass);

  const drums = new Float32Array(n);
  for (let b = 0; b < 8; b++) {
    const at = b * 3 * eighth + human();
    if (b % 2 === 0) {
      t.put(drums, thump(t, 0.25, 95, 55, 0.003, 0.05, 0.5), at, 0.5);
      t.put(drums, burst(t, 0.04, 200, 900, 0.001, 0.008, 2), at, 0.15);
    } else {
      t.put(drums, burst(t, 0.2, 900, 7000, 0.004, 0.05, 2), at, 0.55);
      addMode(drums, t.sr, at, r.range(185, 205), 0.3, 0.03, 0);
      t.put(drums, burst(t, 0.2, 2000, 6000, 0.006, 0.07, 2), at, 0.25);
    }
  }
  for (let e = 0; e < 24; e++) {
    t.put(drums, burst(t, 0.04, 3000, 9000, 0.001, 0.012, 2), e * eighth + human(), e % 3 === 0 ? 0.12 : 0.07);
  }
  // The swirl: brushes circling on the head, one sweep a beat, built over exactly one loop.
  const swirl = bandNoise(length, t.sr, r, 1200, 6000, 2);
  shapeBy(swirl, (u) => 0.35 + 0.65 * Math.sin(Math.PI * 8 * u) ** 2);
  t.put(drums, swirl, 0, 0.1);

  // The crooner: one legato line, gliding into each note, a vibrato once a note is held, a breath between the phrases.
  const notes = BALLAD_LEAD.map(([e, midi, len], k) => ({
    at: e * eighth,
    end: (e + len) * eighth,
    midi,
    from: BALLAD_LEAD[(k + BALLAD_LEAD.length - 1) % BALLAD_LEAD.length]![1],
  }));
  const vib = r.range(5.0, 5.8);
  const noteAt = (s: number): (typeof notes)[number] => {
    let k = notes.length - 1;
    while (k > 0 && notes[k]!.at > s) k--;
    return notes[k]!;
  };
  const f0 = sampled(n, (u) => {
    const s = time(u);
    const note = noteAt(s);
    const held = s - note.at;
    const m = note.midi + (note.from - note.midi) * Math.exp(-held / 0.045);
    return midiHz(m + 0.18 * Math.min(1, Math.max(0, (held - 0.25) / 0.3)) * Math.sin(2 * Math.PI * vib * s));
  });
  const level = sampled(n, (u) => {
    const s = time(u);
    if (s >= loopSec) return 0;
    const ps = s < loopSec / 2 ? 0 : loopSec / 2;
    const swell = 0.85 + 0.15 * Math.min(1, (s - noteAt(s).at) / 0.3);
    return Math.min(1, (s - ps) / 0.06) * Math.min(1, (ps + loopSec / 2 - s) / 0.12) * swell;
  });
  const voice = glottal(n, t.sr, r, f0, { jitter: 0.008, shimmer: 0.05, breath: 0.06, tension: 0.45 });
  normalize(voice);
  const lead = formants(voice, t.sr, [
    { freq: 420, q: 5, amp: 1 },
    { freq: 850, q: 6, amp: 0.55 },
    { freq: 2500, q: 10, amp: 0.18 },
  ]);
  // The station's leveller: through a fixed "oh" a low E comes out several
  // dB under an A (its harmonics miss the resonances), and a crooner on the
  // air never did. A slow follower (a note's worth, so the vibrato still
  // breathes) evens the notes; then the phrasing goes on.
  const settle = Math.exp(-1 / (0.12 * t.sr));
  let env = 0;
  for (let i = 0; i < Math.min(n, t.n(0.2)); i++) env = settle * env + (1 - settle) * Math.abs(lead[i]!);
  for (let i = 0; i < n; i++) {
    env = settle * env + (1 - settle) * Math.abs(lead[i]!);
    lead[i] = (lead[i]! / (env + 1e-4)) * level[i]!;
  }
  normalize(lead);

  // The group's "ooh": three voices on the chord, re-sung at each change.
  const group = new Float32Array(n);
  for (let v = 0; v < 3; v++) {
    const wob = r.range(4.4, 5.2);
    const freq = sampled(n, (u) => {
      const s = time(u);
      const c = Math.min(3, Math.floor(s / chordLen));
      return midiHz(BALLAD_CHORDS[c]!.pad[v]!) * (1 + 0.004 * Math.sin(2 * Math.PI * wob * s + v));
    });
    const s = saw(n, t.sr, freq, 0, r.next());
    for (let i = 0; i < n; i++) group[i]! += s[i]!;
  }
  shapeBy(group, (u) => {
    const s = time(u);
    if (s >= loopSec) return 0;
    const x = s % chordLen;
    return Math.min(1, x / 0.08) * Math.min(1, (chordLen - x) / 0.06);
  }, 16);
  const ooh = formants(group, t.sr, [
    { freq: 330, q: 4, amp: 1 },
    { freq: 800, q: 5, amp: 0.45 },
  ]);
  lowpass(ooh, t.sr, 2500, 2);
  normalize(ooh);

  // The radio's own: static over exactly one loop, crackles as events.
  const mix = new Float32Array(n);
  const staticNoise = white(length, r);
  for (let k = 0, c = r.int(12, 24); k < c; k++) {
    t.put(mix, click(t.sr, r, r.range(0.0008, 0.002), 800, 8000), r.range(0.01, loopSec), r.range(0.03, 0.12));
  }
  for (let i = 0; i < n; i++) {
    mix[i]! += 0.5 * piano[i]! + 0.65 * bass[i]! + 0.45 * drums[i]! + 0.8 * lead[i]! + 0.3 * ooh[i]!;
  }
  t.put(mix, staticNoise, 0, 0.015);

  // The speaker: a small cone in a wooden cabinet — nothing under 250 Hz or
  // over 3.5 kHz, the cone honking in the upper mids, the box a little.
  highpass(mix, t.sr, 250, 2);
  lowpass(mix, t.sr, 3500, 4);
  biquad(mix, t.sr, "peak", 1500, 0.8, 7);
  biquad(mix, t.sr, "peak", 520, 1.6, 1.5);
  const out = normalize(wrap(mix, length));
  // The output tube: a soft, slightly asymmetric bend (a little even harmonic warmth).
  const drive = 1.8;
  const bias = 0.12;
  const off = Math.tanh(drive * bias);
  const norm = Math.tanh(drive * (1 + bias)) - off;
  for (let i = 0; i < length; i++) out[i] = (Math.tanh(drive * (out[i]! + bias)) - off) / norm;
  return out;
}

// --- world events and secrets ------------------------------------------------------------

/**
 * The streetlight flickering: the relay in its head letting go with a tick,
 * the buzz surging as the arc fights to stay lit, then the zap of the arc
 * breaking — a crack and a burst of chattering noise — and the buzz gone; a
 * faint tick of the glass as it cools.
 */
export function nightFlicker(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(0.34);
  const out = t.canvas(seconds);
  const relay = r.range(0.005, 0.02);
  t.put(out, click(t.sr, r, 0.002, 1800, 11000), relay, t.g(0.45));
  addMetal(out, t.sr, r, relay, r.range(2600, 3400), 0.005, 0.12, [1, 1.52, 2.3]);
  const cut = relay + t.j(0.1, 0.3);
  const P = Math.round(t.sr / 120);
  const cyc = buzzCycle(P, r, t.sr, 30, r.range(900, 1400), 500, 0.6);
  const nb = t.n(cut);
  const buzz = new Float32Array(nb);
  for (let i = 0; i < nb; i++) buzz[i] = cyc[i % P]! * (0.4 + (0.6 * i) / nb);
  fade(buzz, t.sr, 0.01, 0.002);
  t.put(out, buzz, 0, t.g(0.4));
  t.put(out, click(t.sr, r, 0.003, 1500, 14000), cut, t.g(1.0));
  const zap = bandNoise(t.n(0.04), t.sr, r, 1200, t.c(9000), 2);
  for (let i = 0; i < zap.length; i++) zap[i]! *= Math.sin((2 * Math.PI * 240 * i) / t.sr) > 0 ? 1 : 0.35;
  decayInPlace(zap, t.sr, 0.0003, 0.008);
  t.put(out, zap, cut, t.g(0.8));
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    t.put(out, click(t.sr, r, 0.0015, 1500, 12000), cut + ((k + 1) / 120) * r.range(0.9, 1.1), 0.4 * Math.pow(0.6, k));
  }
  addMode(out, t.sr, cut + r.range(0.1, 0.16), r.range(4500, 6500), 0.03, 0.01, 0);
  return out;
}

/**
 * A dog barking somewhere across the fields: two to four barks, their top
 * lost over half a mile of wet ground, a smear of the fields' reflections
 * behind each, and the slap off the barn a beat later.
 */
export function nightDog(t: Take): Mono {
  const r = t.rng;
  const count = r.int(2, 5);
  const base = r.range(380, 520) * t.p;
  const barks: { at: number; len: number }[] = [];
  let at = 0.02;
  for (let k = 0; k < count; k++) {
    const len = r.range(0.11, 0.16);
    barks.push({ at, len });
    at += len + (k % 2 === 0 ? r.range(0.14, 0.22) : r.range(0.3, 0.45));
  }
  const last = barks[barks.length - 1]!;
  const dry = t.canvas(last.at + last.len + 0.05);
  for (const b of barks) {
    const bark = vocal(t, b.len, {
      f0: (u) => base * (1.1 - 0.45 * u),
      voicing: (u) => Math.min(1, u * 8),
      tension: () => 0.92,
      jitter: 0.05, shimmer: 0.25, breath: 0.25, rasp: 0.15,
      tract: [
        { f: (u) => lerp(800, 560, u), q: 5, amp: 1 },
        { f: (u) => lerp(1500, 1000, u), q: 6, amp: 0.7 },
        { f: () => 2700, q: 8, amp: 0.3 },
      ],
      level: (u) => Math.min(1, u * 30) * Math.pow(1 - u, 0.8),
    });
    t.put(dry, bark, b.at, r.range(0.8, 1));
  }
  lowpass(dry, t.sr, t.c(1500), 2);
  highpass(dry, t.sr, 220, 2);
  const out = t.canvas(dry.length / t.sr + 0.72);
  t.put(out, dry, 0, 1);
  const smear = lowpass(Float32Array.from(dry), t.sr, 900, 2);
  for (const [delay, gain] of [[0.035, 0.3], [0.07, 0.2], [0.11, 0.12]] as const) t.put(out, smear, delay * r.range(0.8, 1.2), gain);
  t.put(out, smear, r.range(0.38, 0.55), 0.28);
  return out;
}

/**
 * An owl in the pines: a great horned owl's phrase, *hoo, h'hoo-hoo, hooo,
 * hoo* — soft near-pure hoots, each rising a little and sinking, breath in
 * them. The last take is the higher female answering, quicker.
 */
export function nightOwl(t: Take): Mono {
  const r = t.rng;
  const female = t.index % 3 === 2;
  const base = (female ? r.range(370, 420) : r.range(270, 320)) * t.p;
  const pace = r.range(0.85, 1.0);
  const phrase: readonly [number, number][] = female
    ? [[0.14, 0.12], [0.08, 0.05], [0.08, 0.12], [0.2, 0.15], [0.12, 0.1], [0.16, 0]]
    : [[0.22, 0.28], [0.09, 0.05], [0.1, 0.25], [0.34, 0.2], [0.26, 0]];
  let total = 0.02;
  for (const [len, gap] of phrase) total += (len + gap) * pace;
  const out = t.canvas(total + 0.1);
  let at = 0.02;
  for (const [len0, gap] of phrase) {
    const len = len0 * pace;
    const n = t.n(len);
    const lift = r.range(0.04, 0.08);
    const freq = sampled(n, (u) => base * (0.97 + lift * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 0.04 * u), 16);
    const level = sampled(n, (u) => Math.pow(Math.min(1, u / 0.18), 1.5) * Math.min(1, (1 - u) / 0.3));
    const hoot = tone(t, freq, level, 0.12, 0.04);
    const air = breathOn(t, freq, level, 8);
    for (let i = 0; i < n; i++) hoot[i]! += 0.12 * air[i]!;
    t.put(out, hoot, at, r.range(0.85, 1));
    at += (len0 + gap) * pace;
  }
  lowpass(out, t.sr, 2200, 2);
  highpass(out, t.sr, 120, 2);
  return out;
}

/**
 * One stroke of a church bell somewhere past the fields: a big bell (the
 * town's bell struck lower), dark and far — the fog has taken its top, the
 * clapper's clang is a dull knock — and its note coming back off the hills,
 * fainter and darker, half a second behind.
 */
export function nightBell(t: Take): Mono {
  const r = t.rng;
  const bell = bellStrike(t, r.range(360, 400) * t.p, 5.0, 0.55);
  lowpass(bell, t.sr, t.c(1400), 2);
  highpass(bell, t.sr, 70, 2);
  const out = t.canvas(5.4);
  t.put(out, bell, 0.01, 1);
  const echo = lowpass(Float32Array.from(bell), t.sr, 700, 2);
  t.put(out, echo, r.range(0.45, 0.7), 0.16);
  return tailOff(out, t.sr, 0.4);
}

/** One survivor: the things that make a voice that person's, the same in every take. */
interface Survivor {
  /** Their whistle's top note (Hz) and how much breath is in it (0 clean .. 1 airy). */
  whistle: number;
  airy: number;
  /** Their shouting pitch (Hz) and the size of their throat (formants scaled by it). */
  f0: number;
  throat: number;
  /** How rough the voice is: jitter, shimmer, breath, the growl of an old throat. */
  jitter: number;
  shimmer: number;
  breath: number;
  rasp: number;
  /** Seconds the shout lasts, and between footfalls. */
  shout: number;
  stride: number;
}

/** Miller's daughter: a sharp two-finger whistle, a young woman's clear shout. */
const DAUGHTER: Survivor = {
  whistle: 2850, airy: 0.12, f0: 400, throat: 1.17,
  jitter: 0.015, shimmer: 0.1, breath: 0.12, rasp: 0, shout: 0.34, stride: 0.3,
};

/** The old motel owner: a lower whistle through pursed lips, breathier; a rough, cracked old man's shout; a slower run. */
const OWNER: Survivor = {
  whistle: 1700, airy: 0.3, f0: 175, throat: 0.95,
  jitter: 0.045, shimmer: 0.25, breath: 0.3, rasp: 0.15, shout: 0.42, stride: 0.38,
};

/**
 * A living survivor calling out as they run: a whistle rising and falling,
 * then a shouted *hey!* — a breath of *h*, then the vowel gliding from "e"
 * to "i", its pitch leaping and falling as a shout does — with their feet on
 * the road under it. The person is fixed (their pitches and throat); a take
 * varies them only as one person's calls vary: a few percent of pitch, the
 * timing, the shape of the glide.
 */
function survivorCall(t: Take, who: Survivor): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.3));
  const stride = who.stride * r.range(0.93, 1.07);
  for (let k = 0; k < 3; k++) footfall(out, t, 0.02 + k * stride, 0.18);
  const wl = r.range(0.32, 0.42);
  const wf = who.whistle * t.p * r.range(0.97, 1.03);
  const wn = t.n(wl);
  const peakAt = r.range(0.3, 0.4);
  const freq = sampled(wn, (u) => wf * (u < peakAt ? lerp(0.8, 1.05, u / peakAt) : lerp(1.05, 0.9, (u - peakAt) / (1 - peakAt))), 16);
  const level = sampled(wn, (u) => Math.min(1, u / 0.06) * (u < 0.85 ? 1 : (1 - u) / 0.15));
  const whistle = tone(t, freq, level, 0.03, 0);
  const air = breathOn(t, freq, level, who.airy > 0.2 ? 10 : 24);
  for (let i = 0; i < wn; i++) whistle[i]! += who.airy * air[i]!;
  t.put(out, normalize(whistle), 0.05, who.airy > 0.2 ? 0.45 : 0.6);
  const at = 0.05 + wl + r.range(0.12, 0.22);
  const f0 = who.f0 * t.p * r.range(0.95, 1.05);
  const k = who.throat;
  const lift = r.range(1.08, 1.16);
  const hey = vocal(t, who.shout * r.range(0.88, 1.12), {
    f0: (u) => f0 * (u < 0.3 ? lerp(0.9, lift, u / 0.3) : lerp(lift, 0.82, (u - 0.3) / 0.7)),
    voicing: (u) => Math.min(1, Math.max(0, (u - 0.1) / 0.08)),
    tension: () => 0.85,
    jitter: who.jitter,
    shimmer: who.shimmer,
    breath: who.breath,
    rasp: who.rasp,
    tract: [
      { f: (u) => lerp(620, 420, u) * k, q: 6, amp: 1 },
      { f: (u) => lerp(1850, 2250, u) * k, q: 9, amp: 0.7 },
      { f: () => 2800 * k, q: 11, amp: 0.35 },
      { f: () => 3700 * k, q: 12, amp: 0.15 },
    ],
    level: (u) => Math.min(1, u * 14) * (u < 0.7 ? 1 : ((1 - u) / 0.3) ** 1.2),
  });
  t.put(out, hey, at, 1);
  return out;
}

/** Miller's daughter running for the motel, calling out: see survivorCall. */
export function nightSurvivorDaughter(t: Take): Mono {
  return survivorCall(t, DAUGHTER);
}

/** The old motel owner running for his door, calling out: see survivorCall. */
export function nightSurvivorOwner(t: Take): Mono {
  return survivorCall(t, OWNER);
}

/**
 * A thick mason jar bursting on its post: the strike, the jar's heavy
 * *tonk* (thick walls ring lower than a bottle, over the air inside it), the
 * crash, chunky pieces knocking onto the wood and the road and small shards
 * after them — and the candle inside snuffed with a soft pop of air.
 */
export function nightJarBreak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.75));
  t.put(out, click(t.sr, r, 0.004, 1800, 15000), 0, t.g(1.3));
  t.put(out, burst(t, 0.12, 1500 * t.p, 13000, 0.0004, t.d(0.03), 2, 1.5), 0, t.g(0.9));
  t.put(out, burst(t, 0.15, 500, 4000, 0.001, t.d(0.05), 2), 0.002, t.g(0.4));
  const wall = r.range(900, 1300) * t.p;
  addMode(out, t.sr, 0, wall, 0.4 * r.sign(), t.d(0.025), 0);
  addMode(out, t.sr, 0, wall * r.range(2.2, 2.5), 0.25 * r.sign(), t.d(0.015), 0);
  addMode(out, t.sr, 0, wall * r.range(4.0, 4.6), 0.12, t.d(0.008), 0);
  addMode(out, t.sr, 0, r.range(350, 450) * t.p, 0.25, t.d(0.02), 0);
  for (let k = 0, c = r.int(4, 8); k < c; k++) {
    const at = r.range(0.12, 0.45);
    t.put(out, knock(t, r.range(600, 1100), 0.008, 0.6), at, r.range(0.1, 0.22));
    t.put(out, click(t.sr, r, 0.003, 2000, 12000), at, r.range(0.15, 0.3));
  }
  for (let k = 0, c = r.int(8, 15); k < c; k++) {
    addShard(out, t, 0.03 + Math.pow(r.next(), 1.5) * 0.55, r.range(2500, 7500) * t.p, r.range(0.05, 0.16), r.range(0.01, 0.03));
  }
  const snuff = r.range(0.03, 0.08);
  t.put(out, puff(t, 0.08, 900, 0.002, 0.012), snuff, t.g(0.25));
  t.put(out, thump(t, 0.05, 180, 90, 0.001, 0.008, 0.5), snuff, t.g(0.15));
  return out;
}

/**
 * A neon tube shot out: the thin glass imploding (a sharp pop, the air
 * rushing in with a low *thoop*, a sprinkle of tiny shards), the
 * transformer arcing across the broken ends — a harsh 120 Hz buzz that
 * sputters on and off as it dies — and its whine falling away.
 */
export function nightNeon(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.45);
  const out = t.canvas(seconds);
  t.put(out, nWave(t, 0.0003), 0, t.g(0.7));
  t.put(out, click(t.sr, r, 0.003, 2000, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.06, 1000, t.c(9000), 0.0002, t.d(0.01), 2, 1), 0, t.g(0.8));
  t.put(out, thump(t, 0.06, 300, 120, 0.001, 0.015, 0.5), 0.002, t.g(0.4));
  for (let k = 0, c = r.int(6, 11); k < c; k++) {
    addShard(out, t, r.range(0.05, 0.5), r.range(4000, 10000), r.range(0.04, 0.1), r.range(0.006, 0.015));
  }
  const len = t.j(0.8, 0.2);
  const n = t.n(len);
  const P = Math.round(t.sr / 120);
  const cyc = buzzCycle(P, r, t.sr, 36, r.range(1200, 2000), 700, 0.5);
  const arc = bandNoise(n, t.sr, r, 1500, 8000, 2);
  const buzz = new Float32Array(n);
  let on = true;
  let flip = t.n(r.range(0.01, 0.06));
  for (let i = 0; i < n; i++) {
    if (--flip <= 0) {
      on = !on;
      flip = t.n(on ? r.range(0.02, 0.09) : r.range(0.01, 0.07) * (1 + (3 * i) / n));
    }
    buzz[i] = on ? cyc[i % P]! * 0.8 + arc[i]! * 0.35 : 0;
  }
  // The gates are hard: soften each edge a hair so they buzz rather than click.
  lowpass(buzz, t.sr, 6000, 1);
  shapeBy(buzz, (u) => Math.pow(1 - u, 1.3) * Math.min(1, u * 40));
  t.put(out, buzz, 0.02, t.g(0.45));
  const wn = t.n(Math.min(seconds - 0.05, t.j(1.0, 0.1)));
  const fTop = r.range(1500, 2100);
  const freq = sampled(wn, (u) => fTop * Math.pow(0.18, Math.pow(u, 0.8)), 16);
  const level = sampled(wn, (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.5));
  t.put(out, tone(t, freq, level, 0.2, 0), 0.03, t.g(0.12));
  return out;
}

/**
 * One ring of an old bell telephone: the ringer's armature swinging on the
 * 20 Hz ringing current, its clapper striking the two small gongs in turn —
 * each gong a few inharmonic modes that ring on through the next strikes, so
 * they jangle — the armature's own tick, the Bakelite body's hollow, and
 * when the current stops, the gongs dying away.
 */
export function nightPhoneRing(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(2.3);
  const out = t.canvas(seconds);
  const n = out.length;
  const ringFor = r.range(1.75, 1.95) * (seconds / 2.3);
  const hz = r.range(19.5, 20.5);
  const exA = new Float32Array(n);
  const exB = new Float32Array(n);
  const ticks = [0, 1, 2].map(() => {
    const tk = t.canvas(0.012);
    t.put(tk, click(t.sr, r, 0.0015, 1200, 9000), 0, 1);
    t.put(tk, burst(t, 0.01, 300, 1500, 0.0003, 0.003), 0, 0.6);
    return tk;
  });
  let last = 0;
  let k = 0;
  for (let s = 0.01; s < 0.01 + ringFor; s += 1 / hz) {
    const build = Math.min(1, 0.45 + k * 0.18);
    const ia = Math.round(s * t.sr);
    const ib = Math.round((s + (0.5 / hz) * r.range(0.95, 1.05)) * t.sr);
    if (ia < n) exA[ia] = build * r.range(0.85, 1.1);
    if (ib < n) {
      exB[ib] = build * r.range(0.85, 1.1);
      last = ib + 1;
    }
    t.put(out, ticks[k % 3]!, s, 0.05 * build);
    k++;
  }
  const fa = r.range(1250, 1400) * t.p;
  const fb = fa * r.range(1.16, 1.24);
  const gong: [number, number, number][] = [[1, 1, 0.35], [2.2, 0.55, 0.2], [3.6, 0.35, 0.12], [5.3, 0.2, 0.07]];
  for (const [f, ex] of [[fa, exA], [fb, exB]] as const) {
    for (const [ratio, amp, tau] of gong) {
      ringInto(out, ex, t.sr, f * ratio * r.range(0.995, 1.005), tau * r.range(0.9, 1.1), amp * 0.2, last);
    }
    // The fundamental is a doublet: a slow warble as it dies.
    ringInto(out, ex, t.sr, f * 1.003, 0.3, 0.08, last);
  }
  biquad(out, t.sr, "peak", r.range(480, 560), 2, 5);
  return tailOff(out, t.sr, 0.3);
}

/**
 * A wolf howling far off: a rising glide into a long held note — a slow
 * vibrato, a drift, the note lifting a little as the breath holds — and a
 * falling end as the breath runs out. Nearly a pure tone, as a wolf's howl
 * is, with a breath of air on it and the mouth opening and closing (the
 * upper harmonics come and go with it).
 */
export function nightHowl(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(3.4);
  const peak = r.range(430, 560) * t.p;
  const rise = r.range(0.28, 0.45);
  const fall = r.range(0.55, 0.8);
  const len = seconds - 0.12;
  const hold = len - rise - fall;
  const vib = r.range(4.5, 5.5);
  const n = t.n(len);
  const drift = wanderTrack(n, r, 1.5, t.sr);
  const freq = sampled(n, (u) => {
    const s = u * len;
    let base: number;
    if (s < rise) base = lerp(0.55, 1, Math.pow(s / rise, 0.6));
    else if (s < rise + hold) base = 1 + 0.04 * Math.sin((Math.PI * (s - rise)) / hold);
    else base = lerp(1, 0.62, Math.pow((s - rise - hold) / fall, 1.4));
    const v = 0.012 * Math.min(1, Math.max(0, (s - rise) / 0.4)) * Math.sin(2 * Math.PI * vib * s);
    return peak * base * (1 + v) * (1 + 0.025 * (2 * drift(u) - 1));
  }, 16);
  const level = sampled(n, (u) => {
    const s = u * len;
    const tail = len - fall * 0.8;
    return Math.pow(Math.min(1, s / 0.12), 1.5) * (s < tail ? 1 : Math.pow(Math.max(0, (len - s) / (fall * 0.8)), 1.3));
  });
  const howl = tone(t, freq, level, 0.22, 0.08);
  svf(howl, t.sr, "lp", (u) => 900 + 2600 * Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.9, 64);
  const air = breathOn(t, freq, level, 14);
  for (let i = 0; i < n; i++) howl[i]! += 0.08 * air[i]!;
  const out = t.canvas(seconds);
  t.put(out, howl, 0.05, 1);
  lowpass(out, t.sr, t.c(3500), 2);
  return out;
}

/** A spit: a sharp puff of air through bared teeth, and the pop of the lips. */
function spit(out: Mono, t: Take, at: number, gain: number): void {
  t.put(out, burst(t, 0.06, 600, 9000, 0.0008, 0.012, 2, 1), at, gain);
  t.put(out, burst(t, 0.02, 150, 1200, 0.0003, 0.004), at, gain * 0.5);
  t.put(out, click(t.sr, t.rng, 0.0015, 1000, 9000), at, gain * 0.3);
}

/**
 * The black cat, startled: a spit, then a hiss — broad noise from the open
 * mouth with the peaks its mouth and throat give it, trembling — a second
 * spit, and a shorter hiss to finish.
 */
export function nightHiss(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(0.85);
  const out = t.canvas(seconds);
  spit(out, t, 0.01, 1);
  const hissOf = (at: number, len: number, gain: number): void => {
    const n = t.n(len);
    const hiss = formants(white(n, r), t.sr, [
      { freq: r.range(2200, 2800), q: 2.5, amp: 1 },
      { freq: r.range(4800, 5800), q: 3, amp: 0.8 },
      { freq: r.range(7500, 8800), q: 3, amp: 0.5 },
    ]);
    highpass(hiss, t.sr, 900, 2);
    normalize(hiss);
    const tremble = wobble(n, t.sr, r.range(14, 22), () => r.next());
    for (let i = 0; i < n; i++) {
      const u = i / n;
      hiss[i]! *= (0.8 + 0.2 * tremble[i]!) * Math.min(1, u * 15) * (u < 0.7 ? 1 : Math.pow((1 - u) / 0.3, 1.3));
    }
    t.put(out, hiss, at, gain);
  };
  const hl = Math.min(t.j(0.42, 0.15), seconds * 0.5);
  hissOf(0.04, hl, 0.8);
  const again = 0.04 + hl + r.range(0.03, 0.08);
  spit(out, t, again, 0.8);
  hissOf(again + 0.02, Math.max(0.05, Math.min(0.16, seconds - again - 0.06)), 0.55);
  return out;
}

/**
 * The rubber duck squeezed: air forced through the squeaker's little reed —
 * a buzzy squeal whose pitch climbs with the pressure and sags as the duck
 * empties, wavering — the rubber body squashing with a soft low squeal of
 * its own, and, when let go, the air drawn back in through the reed.
 */
export function nightSqueak(t: Take): Mono {
  const r = t.rng;
  const len = t.j(0.3, 0.2);
  const out = t.canvas(len + 0.12);
  const n = t.n(len);
  const f0 = r.range(1900, 2600) * t.p;
  const flutter = r.range(26, 36);
  const freq = sampled(n, (u) => f0 * (0.78 + 0.32 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.7)), 0.6) - 0.12 * u) * (1 + 0.02 * Math.sin(2 * Math.PI * flutter * u * len)), 8);
  const reed = saw(n, t.sr, freq, 0.35);
  const body = formants(reed, t.sr, [
    { freq: f0 * 1.1, q: 4, amp: 1 },
    { freq: f0 * 2.2, q: 5, amp: 0.5 },
    { freq: 5200, q: 3, amp: 0.2 },
  ]);
  normalize(body);
  const air = bandNoise(n, t.sr, r, 1500, 8000, 2);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const voiced = Math.min(1, Math.max(0, (u - 0.04) / 0.05));
    const env = Math.min(1, u * 12) * (u < 0.75 ? 1 : (1 - u) / 0.25);
    body[i] = (body[i]! * voiced + air[i]! * 0.15) * env;
  }
  t.put(out, body, 0.005, 1);
  const rub = creak(t, len * 0.8, (u) => 180 + 120 * u, [[520, 5, 1], [1150, 6, 0.5]], 0.4);
  adsr(rub, t.sr, 0.02, 0.05, 0.6, 0.05);
  t.put(out, rub, 0.005, 0.15);
  if (r.chance(0.7)) {
    const bn = t.n(0.08);
    const back = saw(bn, t.sr, f0 * 1.25, 0.35);
    lowpass(back, t.sr, 6000, 2);
    normalize(back);
    shapeBy(back, (u) => Math.sin(Math.PI * u) ** 2);
    t.put(out, back, len + 0.02, 0.18);
  }
  return out;
}

/**
 * The scarecrow's head turning slowly on its post to follow you: the rope
 * binding it groaning against the wood (a slow stick-slip with the post's
 * body under it), a thinner creak of the rope's fibres now and then, and the
 * straw in its collar rustling as it goes.
 */
export function nightScarecrow(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(2.0);
  const out = t.canvas(seconds);
  const turn = seconds - r.range(0.15, 0.3);
  const walk = wanderTrack(t.n(turn), r, 2.5, t.sr);
  const post = creak(t, turn, (u) => (18 + 30 * walk(u)) * (0.7 + 0.5 * Math.sin(Math.PI * u)), [[160, 3, 1], [420, 4, 0.7], [900, 5, 0.4], [2000, 6, 0.15]], 0.5);
  adsr(post, t.sr, 0.2, 0.3, 0.8, 0.3);
  t.put(out, post, 0.02, t.g(1.0));
  for (let k = 0, c = r.int(1, 3); k < c; k++) {
    const len = r.range(0.2, 0.4);
    const walk2 = wanderTrack(t.n(len), r, 5, t.sr);
    const rope = creak(t, len, (u) => (120 + 140 * walk2(u)) * t.p, [[1100, 6, 1], [2300, 7, 0.5]], 0.3);
    adsr(rope, t.sr, 0.05, 0.1, 0.6, 0.1);
    t.put(out, rope, r.range(0.1, Math.max(0.15, turn - len)), t.g(0.2));
  }
  const straw = leafRasp(t, turn, r.range(40, 70));
  shapeBy(straw, (u) => Math.sin(Math.PI * u) ** 0.8);
  t.put(out, straw, 0.02, t.g(0.1));
  scatter(out, t, r.int(20, 35), 0.05, turn, 2000, 9000, 0.06, 1.0);
  // Old straw and a field away: nothing up at the top.
  return lowpass(out, t.sr, t.c(6500), 2);
}

// --- stingers and the interface ------------------------------------------------------------

/**
 * A wave begins: dread. A low drone on D in two octaves — three saws a few
 * cents apart, their beating the unease — under a low-pass that opens as it
 * swells in; a far rumble like thunder beyond the hills; and, thin and high
 * over it, the drone's 17th and 23rd harmonics (a flat minor ninth and a
 * sour tritone above the octaves) as pure tones, beating slowly.
 */
export function nightWaveStart(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 4.0;
  const n = t.n(seconds);
  const dry = new Float32Array(n);
  const f = midiHz(38);
  for (const [fr, a] of [[f, 1], [f * Math.pow(2, 9 / 1200), 0.8], [(f / 2) * Math.pow(2, -7 / 1200), 0.9], [f * 1.5 * Math.pow(2, 4 / 1200), 0.35]] as const) {
    const s = saw(n, t.sr, fr, 0, r.next());
    for (let i = 0; i < n; i++) dry[i]! += a * s[i]!;
  }
  svf(dry, t.sr, "lp", (u) => 120 + 700 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 2, 0.9, 64);
  normalize(dry);
  adsr(dry, t.sr, 1.6, 0.8, 0.8, 1.5);
  const rumble = brown(n, r);
  lowpass(rumble, t.sr, 110, 4);
  normalize(rumble);
  const churn = wobble(n, t.sr, 2.5, () => r.next());
  for (let i = 0; i < n; i++) rumble[i]! *= 0.6 + 0.4 * churn[i]!;
  shapeBy(rumble, (u) => Math.sin(Math.PI * u) ** 1.5);
  t.put(dry, rumble, 0, 0.5);
  const hi = t.canvas(seconds);
  addMode(hi, t.sr, 0, f * 17, 1, 1000, 0);
  addMode(hi, t.sr, 0, f * 17 * 1.0012, 0.6, 1000, 0);
  addMode(hi, t.sr, 0, f * 23, 0.5, 1000, 0);
  shapeBy(hi, (u) => Math.sin(Math.PI * Math.max(0, (u - 0.2) / 0.8)) ** 2);
  t.put(dry, hi, 0, 0.035);
  tailOff(dry, t.sr, 0.3);
  return room(dry, t.sr, r, { t60: 2.2, size: 1, damping: 0.3, mix: 0.3, predelay: 0.03, tail: 0.3 });
}

/**
 * A wave cleared: a breath of relief — a soft exhale of air, and a warm
 * chord (D major with an added ninth) of near-pure partials, each a pair a
 * hair apart for a slow chorus, swelling in and letting go.
 */
export function nightWaveClear(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 2.9;
  const dry = t.canvas(seconds);
  t.put(dry, puff(t, 0.9, 900, 0.25, 0.3), 0, 0.1);
  const chord = t.canvas(seconds - 0.02);
  for (const [midi, g] of [[50, 1], [57, 0.9], [62, 0.8], [66, 0.7], [69, 0.55], [76, 0.4]] as const) {
    const f = midiHz(midi);
    addMode(chord, t.sr, 0, f, g * 0.6, 1000, r.range(0, 6.28));
    addMode(chord, t.sr, 0, f * 1.0025, g * 0.4, 1000, r.range(0, 6.28));
    addMode(chord, t.sr, 0, f * 2.002, g * 0.3, 1000, r.range(0, 6.28));
    if (midi < 60) addMode(chord, t.sr, 0, f * 3, g * 0.1, 1000, r.range(0, 6.28));
  }
  adsr(chord, t.sr, 0.35, 0.8, 0.7, 1.3);
  t.put(dry, normalize(chord), 0.02, 1);
  tailOff(dry, t.sr, 0.3);
  return room(dry, t.sr, r, { t60: 1.8, size: 0.9, damping: 0.35, mix: 0.3, predelay: 0.02, tail: 0.3 });
}

/**
 * The Mechanic arrives: a heavy low blow, as if something huge struck a
 * steel door close by (a sub thump, the door's low clang ringing, a dull
 * roar), then a long metal scrape — a tyre iron dragged over the asphalt
 * toward you, grinding and catching in a stick-slip squeal over grit — and
 * under it the dread drone, lower still.
 */
export function nightBoss(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 4.6;
  const dry = t.canvas(seconds);
  t.put(dry, thump(t, 1.2, 62, 27, 0.003, 0.3, 0.45), 0.02, 1.0);
  t.put(dry, burst(t, 1.0, 25, 170, 0.004, 0.25, 4), 0.02, 0.8);
  t.put(dry, click(t.sr, r, 0.006, 400, 9000), 0.02, 0.5);
  for (const [f, a, tau] of [[92, 1, 1.1], [151, 0.7, 0.8], [233, 0.55, 0.6], [347, 0.35, 0.45], [512, 0.25, 0.3], [731, 0.15, 0.2]] as const) {
    addMode(dry, t.sr, 0.02, f * r.range(0.99, 1.01), a * 0.3, tau, 0);
    addMode(dry, t.sr, 0.02, f * 1.004, a * 0.15, tau * 0.9, 0);
  }
  const start = 0.7;
  const len = seconds - start - 0.4;
  const walk = wanderTrack(t.n(len), r, 3, t.sr);
  const grind = creak(t, len, (u) => 260 + 520 * walk(u), [[1150, 10, 1], [2300, 12, 0.7], [3650, 14, 0.4], [5200, 16, 0.2]], 0.6);
  const gn = grind.length;
  const grit = bandNoise(gn, t.sr, r, 1500, 7000, 2);
  const catches = wobble(gn, t.sr, 300, () => r.next());
  for (let i = 0; i < gn; i++) grind[i] = 0.7 * grind[i]! + 0.35 * grit[i]! * catches[i]! * catches[i]!;
  shapeBy(grind, (u) => Math.min(1, u * 4) * (0.6 + 0.4 * walk(u)) * (u < 0.8 ? 1 : (1 - u) / 0.2));
  t.put(dry, grind, start, 0.5);
  const drone = saw(t.n(seconds), t.sr, midiHz(26), 0, r.next());
  lowpass(drone, t.sr, 200, 2);
  normalize(drone);
  adsr(drone, t.sr, 0.8, 1, 0.8, 1.2);
  t.put(dry, drone, 0, 0.2);
  tailOff(dry, t.sr, 0.4);
  return room(dry, t.sr, r, { t60: 2.4, size: 1, damping: 0.3, mix: 0.35, predelay: 0.03, tail: 0.3 });
}

/** A felt-hammered piano key: two strings a few cents apart, struck softly and left to ring. */
function feltNote(out: Mono, t: Take, at: number, midi: number, vel: number, hold: number): void {
  const f = midiHz(midi);
  for (const cents of [-3, 3]) {
    addString(out, t.sr, t.rng, at, f * Math.pow(2, cents / 1200), vel * 0.8, {
      t60: Math.min(5, 3.2 * Math.sqrt(262 / f)), brightness: 0.4, pulse: 0.0028, position: 0.13, length: hold, release: 0.2,
    });
  }
}

/**
 * The night took you: the church bell, close now and dark, and three soft
 * notes on a felt piano falling to D (A, F, D: D minor), a low pad rising
 * under the last and the whole of it fading into the dark.
 */
export function nightGameOver(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 4.4;
  const dry = t.canvas(seconds);
  const bell = bellStrike(t, midiHz(62), 4.2, 0.45);
  lowpass(bell, t.sr, 2400, 2);
  t.put(dry, bell, 0.02, 0.55);
  for (const [at, midi, vel] of [[0.45, 57, 0.8], [1.05, 53, 0.7], [1.75, 50, 0.9]] as const) feltNote(dry, t, at, midi, vel, 3.6 - at);
  const pad = t.canvas(2.6);
  for (const [midi, a] of [[38, 1], [45, 0.7], [50, 0.5], [53, 0.4]] as const) {
    addMode(pad, t.sr, 0, midiHz(midi), a, 1000, r.range(0, 6.28));
    addMode(pad, t.sr, 0, midiHz(midi) * 1.003, a * 0.6, 1000, r.range(0, 6.28));
  }
  adsr(pad, t.sr, 0.8, 0.8, 0.7, 1.2);
  t.put(dry, normalize(pad), 1.6, 0.25);
  tailOff(dry, t.sr, 0.8);
  return room(dry, t.sr, r, { t60: 2.4, size: 1, damping: 0.35, mix: 0.35, predelay: 0.02, tail: 0.3 });
}

/**
 * One tooth of a worn music box's comb, plucked by a pin: a clamped bar
 * (partials 1 : 6.27 : 17.55), strongly fundamental, a bright tick of the
 * pin. The box's tuning is the box's own — each tooth a few cents off, drawn
 * from a fixed seed — so every take plays the same old box.
 */
function tooth(out: Mono, t: Take, at: number, midi: number, gain: number): void {
  const box = new Rng(hashSeed("night-music-box", midi));
  const f = midiHz(midi) * Math.pow(2, box.range(-9, 9) / 1200);
  const tau = 0.7 * Math.sqrt(880 / f);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 1.0015, gain * 0.2, tau * 0.8, 0);
  addMode(out, t.sr, at, f * 6.27, gain * 0.12, 0.06, 0);
  addMode(out, t.sr, at, f * 17.55, gain * 0.03, 0.015, 0);
  t.put(out, click(t.sr, t.rng, 0.001, 2000, 12000), at, gain * 0.08);
}

/**
 * A secret found: a small eerie music-box motif somewhere in the dark — A
 * minor, leaning on the raised seventh, its spring running down (each note
 * a hair later than the last), ending on a tritone that does not resolve.
 */
export function nightSecret(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(2.0);
  const motif: readonly [number, number, number][] = [
    [0, 88, 0.8], [0.17, 81, 0.7], [0.34, 84, 0.75], [0.52, 83, 0.7], [0.72, 80, 0.75], [0.95, 81, 0.8], [0.95, 87, 0.45],
  ];
  const slowing = r.range(1.0, 1.08);
  for (const [at, midi, g] of motif) tooth(out, t, 0.01 + at * (1 + (slowing - 1) * at), midi, g * r.range(0.9, 1.05));
  return roomMono(out, t.sr, r, { t60: 0.9, size: 0.35, damping: 0.5, mix: 0.25, predelay: 0.004, tail: 0.1 });
}

/**
 * The streak climbs: a soft tick and a small pure chime on D6 (a bar's
 * partials, starting from rest so the onset is soft). Pitch exact, so the
 * game can raise it up the major triad by rate.
 */
export function nightStreak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.6);
  t.put(out, click(t.sr, r, 0.0012, 1500, 6000), 0.002, 0.05);
  addMode(out, t.sr, 0.002, r.range(2200, 2600), 0.1, 0.003, 0);
  const f = midiHz(86) * Math.pow(2, r.range(-3, 3) / 1200);
  const note = t.canvas(0.58);
  addMode(note, t.sr, 0, f, 0.6, t.d(0.2), 0);
  addMode(note, t.sr, 0, f * 1.003, 0.2, t.d(0.18), 0);
  addMode(note, t.sr, 0, f * 2, 0.08, 0.1, 0);
  addMode(note, t.sr, 0, f * 2.76, t.g(0.1, 3) * r.sign(), t.d(0.05), 0);
  fade(note, t.sr, 0.0015, 0.02);
  t.put(out, note, 0.01, 1);
  return out;
}

/** A small golden bar: warm partials (1 : 2.76 : 5.4) and a soft tick. */
function goldBar(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const f = midiHz(midi);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 2.76, gain * 0.25, tau * 0.3, 0);
  addMode(out, t.sr, at, f * 5.4, gain * 0.08, tau * 0.1, 0);
  t.put(out, click(t.sr, t.rng, 0.0012, 2000, 10000), at, gain * 0.1);
}

/**
 * The golden rifle: the lever racked, a warm arpeggio of little golden bars
 * up D major, a shimmer of high partials in slowly beating pairs like light
 * moving on brass, and a warm chord under it all.
 */
export function nightGolden(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 2.8;
  const dry = t.canvas(seconds);
  t.put(dry, nightLever(t), 0, 0.35);
  [74, 78, 81, 86, 90].forEach((midi, k) => goldBar(dry, t, 0.3 + k * 0.085, midi, 0.3, 0.8));
  for (let k = 0; k < 8; k++) {
    const f = r.range(3500, 8000);
    addMode(dry, t.sr, 0.55 + k * 0.03, f, 0.02, r.range(0.3, 0.6), 0);
    addMode(dry, t.sr, 0.55 + k * 0.03, f * 1.0015, 0.02, r.range(0.3, 0.6), 0);
  }
  const pad = t.canvas(2.3);
  for (const [midi, a] of [[50, 1], [54, 0.7], [57, 0.7], [62, 0.5]] as const) {
    addMode(pad, t.sr, 0, midiHz(midi), a, 1000, r.range(0, 6.28));
    addMode(pad, t.sr, 0, midiHz(midi) * 2, a * 0.2, 1000, r.range(0, 6.28));
  }
  adsr(pad, t.sr, 0.4, 0.6, 0.7, 1.0);
  t.put(dry, normalize(pad), 0.3, 0.2);
  tailOff(dry, t.sr, 0.5);
  return room(dry, t.sr, r, { t60: 1.6, size: 0.9, damping: 0.4, mix: 0.3, predelay: 0.015, tail: 0.2 });
}

// --- the table -----------------------------------------------------------------------------

/**
 * The night's cues, all in the "night" pack (synthesised when Dead of Night
 * loads). The mix, in one place (dB at the bus):
 *
 *    0    the player's rifle: the loudest thing in the night
 *   −3…−6 the player hurt, a bloater bursting, hits that reward (the head, the mask)
 *   −6…−10 the other hits, the dead up close, the rifle's mechanics
 *   −9…−17 the world's events and secrets, the dead far off
 *  −16…−24 beds: crickets, wind, the streetlight, the lines, the projector
 *
 * A recipe wrapped in ``halfRate`` is synthesised at half the rate and
 * brought up at the end: the voices, the far and the dark, the loops and the
 * stingers — everything with nothing to say near the top of the spectrum.
 */
export const NIGHT_CUES: Record<string, CueSpec> = {
  // --- the rifle -------------------------------------------------------------
  night_rifle: {
    recipe: nightRifle, pack: "night", bus: "sfx", level: 0, reverb: 0.25, echo: 0.8,
    priority: 3, maxInstances: 4, vary: 0.025, takes: 4, expect: [1.5, 3.5],
  },
  night_lever: {
    recipe: nightLever, pack: "night", bus: "sfx", level: -8, reverb: 0.05, echo: 0.15,
    priority: 3, maxInstances: 2, vary: 0.03, expect: [0.3, 0.9],
  },
  night_dry: {
    recipe: nightDry, pack: "night", bus: "sfx", level: -9, reverb: 0.04,
    priority: 3, maxInstances: 2, vary: 0.03, expect: [0.05, 0.4],
  },
  night_round_in: {
    recipe: nightRoundIn, pack: "night", bus: "sfx", level: -12, reverb: 0.03,
    priority: 2, maxInstances: 3, vary: 0.04, varyGain: 1.5, minGap: 0.05, takes: 5, expect: [0.08, 0.35],
  },
  night_click: {
    recipe: nightClick, pack: "night", bus: "sfx", level: -14,
    priority: 2, maxInstances: 1, vary: 0.03, minGap: 0.05, expect: [0.03, 0.2],
  },

  // --- bullets landing: the player's feedback, never delayed by distance -----
  night_hit: {
    recipe: nightHit, pack: "night", bus: "sfx", level: -6, reverb: 0.12, echo: 0.2,
    priority: 3, maxInstances: 4, vary: 0.06, minGap: 0.03, expect: [0.15, 0.5],
  },
  night_headshot: {
    recipe: nightHeadshot, pack: "night", bus: "sfx", level: -4, reverb: 0.15, echo: 0.3,
    priority: 3, maxInstances: 3, vary: 0.04, minGap: 0.03, expect: [0.2, 0.6],
  },
  night_hit_metal: {
    recipe: nightHitMetal, pack: "night", bus: "sfx", level: -8, reverb: 0.2, echo: 0.4,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.4, 1.3],
  },
  night_hit_wood: {
    recipe: nightHitWood, pack: "night", bus: "sfx", level: -7, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 4, vary: 0.07, minGap: 0.025, expect: [0.15, 0.6],
  },
  night_hit_ground: {
    recipe: nightHitGround, pack: "night", bus: "sfx", level: -9, reverb: 0.12, echo: 0.2,
    priority: 1, maxInstances: 4, vary: 0.08, minGap: 0.025, expect: [0.2, 0.7],
  },
  night_hit_glass: {
    recipe: nightHitGlass, pack: "night", bus: "sfx", level: -8, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.2, 0.8],
  },
  night_hit_corn: {
    recipe: nightHitCorn, pack: "night", bus: "sfx", level: -10, reverb: 0.1, echo: 0.1,
    priority: 1, maxInstances: 3, vary: 0.08, minGap: 0.03, expect: [0.3, 0.9],
  },
  night_hit_water: {
    recipe: nightHitWater, pack: "night", bus: "sfx", level: -9, reverb: 0.15, echo: 0.2,
    priority: 1, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  night_hit_sandbag: {
    recipe: nightHitSandbag, pack: "night", bus: "sfx", level: -9, reverb: 0.1, echo: 0.2,
    priority: 1, maxInstances: 4, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  night_mask_clang: {
    recipe: nightMaskClang, pack: "night", bus: "sfx", level: -5, reverb: 0.25, echo: 0.5,
    priority: 3, maxInstances: 2, vary: 0.03, minGap: 0.05, expect: [0.5, 1.6],
  },
  night_ricochet: {
    recipe: nightRicochet, pack: "night", bus: "sfx", level: -9, reverb: 0.25, echo: 0.5,
    priority: 1, maxInstances: 3, vary: 0.08, expect: [0.3, 1.1],
  },

  // --- the dead -----------------------------------------------------------------
  night_groan: {
    recipe: halfRate(nightGroan), pack: "night", bus: "sfx", level: -10, reverb: 0.3, echo: 0.3,
    travel: true, priority: 1, maxInstances: 4, vary: 0.06, minGap: 0.15, takes: 6, expect: [0.8, 2.4],
  },
  night_snarl: {
    recipe: halfRate(nightSnarl), pack: "night", bus: "sfx", level: -9, reverb: 0.25, echo: 0.3,
    travel: true, priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.1, takes: 4, expect: [0.4, 1.2],
  },
  night_dead_fall: {
    recipe: halfRate(nightDeadFall), pack: "night", bus: "sfx", level: -11, reverb: 0.2, echo: 0.2,
    travel: true, priority: 1, maxInstances: 3, vary: 0.05, minGap: 0.1, takes: 4, expect: [0.3, 1.3],
  },
  night_body_fall: {
    recipe: nightBodyFall, pack: "night", bus: "sfx", level: -10, reverb: 0.2, echo: 0.3,
    travel: true, priority: 1, maxInstances: 4, vary: 0.05, takes: 4, expect: [0.4, 1.2],
  },
  night_shuffle: {
    recipe: halfRate(nightShuffle), pack: "night", bus: "world", level: -14, reverb: 0.2, echo: 0.1,
    travel: true, priority: 0, maxInstances: 4, vary: 0.06, takes: 4, expect: [0.8, 2.0],
  },
  night_claw: {
    recipe: nightClaw, pack: "night", bus: "sfx", level: -8, reverb: 0.08, echo: 0.1,
    priority: 2, maxInstances: 3, vary: 0.06, minGap: 0.08, takes: 4, expect: [0.4, 1.0],
  },
  night_lunge: {
    recipe: nightLunge, pack: "night", bus: "sfx", level: -6, reverb: 0.1, echo: 0.2,
    priority: 3, maxInstances: 2, vary: 0.05, minGap: 0.1, expect: [0.4, 1.0],
  },
  night_bloat_burst: {
    recipe: nightBloatBurst, pack: "night", bus: "sfx", level: -3, reverb: 0.3, echo: 0.5,
    priority: 3, maxInstances: 2, vary: 0.05, expect: [1.0, 2.6],
  },
  night_mech_roar: {
    recipe: halfRate(nightMechRoar), pack: "night", bus: "sfx", level: -6, reverb: 0.35, echo: 0.5,
    travel: true, priority: 3, maxInstances: 1, vary: 0.03, expect: [1.5, 3.2],
  },
  night_swing: {
    recipe: nightSwing, pack: "night", bus: "sfx", level: -6, reverb: 0.15, echo: 0.3,
    priority: 3, maxInstances: 2, vary: 0.05, expect: [0.4, 1.2],
  },
  night_climb: {
    recipe: halfRate(nightClimb), pack: "night", bus: "world", level: -11, reverb: 0.25, echo: 0.2,
    travel: true, priority: 1, maxInstances: 2, vary: 0.05, expect: [0.8, 2.0],
  },
  night_vault: {
    recipe: halfRate(nightVault), pack: "night", bus: "world", level: -11, reverb: 0.2, echo: 0.1,
    travel: true, priority: 1, maxInstances: 2, vary: 0.05, expect: [0.5, 1.4],
  },
  night_corn_rustle: {
    recipe: halfRate(nightCornRustle), pack: "night", bus: "world", level: -12, reverb: 0.15,
    travel: true, priority: 1, maxInstances: 3, vary: 0.06, takes: 4, expect: [0.8, 2.0],
  },

  // --- the player ----------------------------------------------------------------
  night_hurt: {
    recipe: nightHurt, pack: "night", bus: "sfx", level: -3, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.04, minGap: 0.05, expect: [0.4, 1.0],
  },
  night_death: {
    recipe: halfRate(nightDeath), pack: "night", bus: "self", level: -4, reverb: 0.1, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 4.0],
  },

  // --- the night: beds -------------------------------------------------------------
  night_crickets: {
    recipe: halfRate(nightCrickets, true), pack: "night", bus: "world", level: -18, loop: true,
    priority: 0, fadeIn: 2.0, fadeOut: 1.5, vary: 0.02, expect: [5.5, 8.5],
  },
  night_wind: {
    recipe: halfRate(nightWind, true), pack: "night", bus: "world", level: -19, loop: true,
    priority: 0, fadeIn: 2.5, fadeOut: 2.0, vary: 0.02, expect: [6, 8],
  },
  night_buzz: {
    recipe: halfRate(nightBuzz, true), pack: "night", bus: "world", level: -20, loop: true, reverb: 0.05,
    priority: 0, fadeIn: 0.3, fadeOut: 0.3, vary: 0, expect: [2, 4],
  },
  night_hum: {
    recipe: halfRate(nightHum, true), pack: "night", bus: "world", level: -24, loop: true,
    priority: 0, fadeIn: 1.0, fadeOut: 1.0, vary: 0, expect: [3, 6],
  },
  night_projector: {
    recipe: halfRate(nightProjector, true), pack: "night", bus: "world", level: -16, loop: true, reverb: 0.3,
    priority: 0, fadeIn: 0.6, fadeOut: 1.0, vary: 0.01, expect: [2, 4],
  },
  night_ballad: {
    recipe: halfRate(nightBallad, true), pack: "night", bus: "world", level: -11, loop: true, reverb: 0.15,
    priority: 1, fadeIn: 0.3, fadeOut: 1.0, vary: 0, expect: [7, 12],
  },

  // --- world events and secrets -------------------------------------------------------
  night_flicker: {
    recipe: nightFlicker, pack: "night", bus: "world", level: -14, reverb: 0.15, echo: 0.2,
    priority: 0, maxInstances: 1, vary: 0.05, minGap: 0.08, expect: [0.1, 0.6],
  },
  night_dog: {
    recipe: halfRate(nightDog), pack: "night", bus: "world", level: -16, reverb: 0.25,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.8, 2.4],
  },
  night_owl: {
    recipe: halfRate(nightOwl), pack: "night", bus: "world", level: -17, reverb: 0.3,
    priority: 0, maxInstances: 1, vary: 0.03, expect: [0.8, 2.0],
  },
  night_bell: {
    recipe: halfRate(nightBell), pack: "night", bus: "world", level: -10, reverb: 0.4, echo: 0.3,
    priority: 1, maxInstances: 4, vary: 0.005, expect: [3.5, 6.5],
  },
  night_survivor_daughter: {
    recipe: halfRate(nightSurvivorDaughter), pack: "night", bus: "sfx", level: -8, reverb: 0.25, echo: 0.3,
    priority: 2, maxInstances: 1, vary: 0.02, expect: [0.8, 1.8],
  },
  night_survivor_owner: {
    recipe: halfRate(nightSurvivorOwner), pack: "night", bus: "sfx", level: -8, reverb: 0.25, echo: 0.3,
    priority: 2, maxInstances: 1, vary: 0.02, expect: [0.8, 1.8],
  },
  night_jar_break: {
    recipe: nightJarBreak, pack: "night", bus: "sfx", level: -7, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 4, vary: 0.05, minGap: 0.02, expect: [0.3, 1.0],
  },
  night_neon: {
    recipe: nightNeon, pack: "night", bus: "world", level: -9, reverb: 0.25, echo: 0.4,
    travel: true, priority: 1, maxInstances: 2, vary: 0.04, expect: [0.8, 2.0],
  },
  night_phone_ring: {
    recipe: halfRate(nightPhoneRing), pack: "night", bus: "world", level: -9, reverb: 0.2, echo: 0.3,
    travel: true, priority: 1, maxInstances: 3, vary: 0.01, expect: [1.6, 2.6],
  },
  night_howl: {
    recipe: halfRate(nightHowl), pack: "night", bus: "world", level: -10, reverb: 0.45, echo: 0.3,
    travel: true, priority: 1, maxInstances: 2, vary: 0.03, expect: [2.5, 4.5],
  },
  night_hiss: {
    recipe: nightHiss, pack: "night", bus: "world", level: -9, reverb: 0.12,
    travel: true, priority: 1, maxInstances: 1, vary: 0.05, expect: [0.4, 1.2],
  },
  night_squeak: {
    recipe: nightSqueak, pack: "night", bus: "world", level: -9, reverb: 0.1,
    priority: 1, maxInstances: 2, vary: 0.06, minGap: 0.05, expect: [0.2, 0.6],
  },
  night_scarecrow: {
    recipe: halfRate(nightScarecrow), pack: "night", bus: "world", level: -11, reverb: 0.2,
    travel: true, priority: 1, maxInstances: 1, vary: 0.03, expect: [1.2, 2.8],
  },

  // --- stingers and the interface (pitch exact: vary 0) ------------------------------------
  night_wave_start: {
    recipe: halfRate(nightWaveStart), pack: "night", bus: "sfx", steady: true, level: -8, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2.5, 5.0],
  },
  night_wave_clear: {
    recipe: halfRate(nightWaveClear), pack: "night", bus: "sfx", steady: true, level: -10, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4.0],
  },
  night_boss: {
    recipe: halfRate(nightBoss), pack: "night", bus: "sfx", steady: true, level: -7, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2.5, 6.0],
  },
  night_game_over: {
    recipe: halfRate(nightGameOver), pack: "night", bus: "ui", level: -9,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 6.0],
  },
  night_secret: {
    recipe: halfRate(nightSecret), pack: "night", bus: "ui", level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 2.6],
  },
  night_streak: {
    recipe: nightStreak, pack: "night", bus: "ui", level: -13,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 0.9],
  },
  night_golden: {
    recipe: halfRate(nightGolden), pack: "night", bus: "ui", level: -9,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4.0],
  },
};
