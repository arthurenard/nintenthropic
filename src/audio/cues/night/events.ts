/**
 * World events and secrets: the streetlight flickering, a dog across the
 * fields, an owl, the church bell, the survivors calling as they run for
 * cover, a mason jar, a neon tube, the telephone, a wolf, the black cat, the
 * rubber duck and the scarecrow.
 */
import { lerp, sampled } from "../../dsp/curves";
import { biquad, highpass, lowpass, svf } from "../../dsp/filters";
import { type Mono, adsr, fade, normalize, shapeBy, tailOff, wobble } from "../../dsp/signal";
import { addMetal, addMode, bandNoise, click, decayInPlace, formants, saw, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { addShard, burst, creak, knock, nWave, puff, scatter, thump, wanderTrack } from "../kit";
import { bellStrike } from "../world";
import { breathOn, buzzCycle, footfall, leafRasp, ringInto, tone, vocal } from "./layers";

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
