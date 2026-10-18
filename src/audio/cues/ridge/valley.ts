/**
 * The valley: the wind in the grass and the river far below, the birds, the
 * farms' animals and an eagle, the chapel bell and the dam's siren, an army
 * truck and its engine holed, a sentry's whistle, the secrets on the slopes
 * (a rubber duck, a wheel of cheese, something on the far slope), and the
 * echo off the great cliff.
 */
import { type Curve, lerp, sampled, smooth } from "../../dsp/curves";
import { biquad, highpass, lowpass, svf } from "../../dsp/filters";
import { loopify, wrap } from "../../dsp/master";
import { type Mono, fade, normalize, perc, shapeBy, wobble } from "../../dsp/signal";
import { addMode, bandNoise, brown, click, formants, pink, saw, white } from "../../dsp/sources";
import { roomMono } from "../../dsp/space";
import type { Take } from "../../dsp/take";
import { softClip } from "../../dsp/voices";
import { burst, knock, periodicCurve, puff, thump } from "../kit";
import { bellStrike } from "../world";
import { rotate, rustle, tone, valleyRoll, vocal } from "./layers";

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
    out[i] = softClip(1.8 * v * x * Math.sqrt(x));
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
