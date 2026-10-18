/**
 * The rifle, in the player's hands: the shot, the bolt, a reload from a
 * stripper clip, a dry fire, the eye going to the scope and coming off it,
 * and the breath slowed for the shot.
 */
import { smooth } from "../../dsp/curves";
import { highpass, svf } from "../../dsp/filters";
import { wrap } from "../../dsp/master";
import { type Mono, adsr, normalize, wobble } from "../../dsp/signal";
import { addMetal, addMode, bandNoise, click, decayInPlace, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { burst, nWave, puff, saturate, thump } from "../kit";
import { breathNoise, putPanned, rustle, valleyRoll, valleySlap } from "./layers";

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
