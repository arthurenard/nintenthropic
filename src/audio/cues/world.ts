/**
 * Dust Creek itself: the wind down Main Street, the church bell, doors and
 * shutters, the weather vane, a leaking water tower, tumbleweeds, spurs on
 * the boardwalk — and the gang's dynamite.
 *
 * The loops are built to be seamless by construction (see ../dsp/master.ts):
 * textures are rendered a little long and cross-faded into their own start;
 * rhythmic events are wrapped round so a tail past the end lands at the start.
 */
import { highpass, lowpass, svf } from "../dsp/filters";
import { loopify, wrap } from "../dsp/master";
import type { Rng } from "../dsp/rng";
import { type Mono, adsr, normalize, shapeBy, wobble } from "../dsp/signal";
import { addMetal, addMode, bandNoise, brown, click, decayInPlace, pink, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { addShard, bubble, burst, creak, knock, nWave, puff, saturate, scatter, thump, wanderTrack } from "./kit";

/** A periodic gust curve over ``length`` samples: a few sines with whole cycles, so it loops exactly. */
function gustCurve(n: number, length: number, rng: Rng, strength: number): Float32Array {
  const parts = [1, 2, 3, 5].map((k) => ({ k, a: rng.range(0.3, 1) / k ** 0.6, ph: rng.range(0, 6.28) }));
  // Evaluated every 32 samples and interpolated: a gust takes seconds, and
  // four sines and a power per sample were the wind's single largest cost.
  const step = 32;
  const coarse = new Float32Array(Math.ceil(n / step) + 2);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < coarse.length; k++) {
    let v = 0;
    for (const p of parts) v += p.a * Math.sin((2 * Math.PI * p.k * k * step) / length + p.ph);
    coarse[k] = v;
    if (k * step < length) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
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
 * Desert wind down the street, stereo: a low bed whose brightness rises with
 * each gust, a whistle wandering through the gaps in the boards, and sand
 * hissing on the facades at the height of a gust. The gusts are periodic in
 * the loop, so it loops exactly.
 *
 * Only one channel is synthesised. The other is the same seamless loop
 * turned round by a fraction of a second: still seamless, its noise already
 * uncorrelated with the first at that offset (so the wind is wide), and its
 * gusts arriving a moment later, as if crossing the street. Half the cost of
 * the most expensive sound in the library.
 */
export function wind(t: Take): Mono[] {
  const r = t.rng;
  const seconds = r.range(6.5, 7.5);
  const length = t.n(seconds);
  const n = length + t.n(0.8);
  const gustL = gustCurve(n, length, r, 0.75);
  const channels: Mono[] = [];
  for (let c = 0; c < 1; c++) {
    const rc = r.fork(c);
    const gust = gustL;
    const bed = pink(n, rc);
    svf(bed, t.sr, "lp", (u) => (260 + 700 * gust[Math.floor(u * n)]!) * t.p, 0.8, 64);
    highpass(bed, t.sr, 45, 2);
    normalize(bed);
    const walk = wanderTrack(n, rc, 0.8, t.sr);
    const whistle = svf(white(n, rc), t.sr, "bp",
      (u) => (380 + 900 * walk(u)) * t.p * (0.85 + 0.3 * gust[Math.floor(u * n)]!), rc.range(14, 22), 64);
    normalize(whistle);
    const grit = bandNoise(n, t.sr, rc, 2800, 9000, 2);
    const flick = wobble(n, t.sr, 30, () => rc.next());
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = gust[i]!;
      const sand = g > 0.65 ? (g - 0.65) * (0.6 + 0.4 * flick[i]!) : 0;
      out[i] = bed[i]! * g * 0.9 + whistle[i]! * g * g * 0.35 + grit[i]! * sand * 0.25;
    }
    channels.push(loopify(out, length));
  }
  const left = channels[0]!;
  const shift = t.n(r.range(0.35, 0.6));
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) right[i] = left[(i - shift + length) % length]!;
  return [left, right];
}

/**
 * The church bell: a real bell's inharmonic partials — hum, prime, the minor
 * third of the tierce that makes a bell sound like a bell, quint, nominal and
 * the uppers — each a pair a hair apart that beats as it dies, the hum
 * outliving everything. Struck by an iron clapper: a clang of short high
 * partials and a dull knock over the first few milliseconds.
 */
export function bellToll(t: Take): Mono {
  return bellStrike(t, t.rng.range(540, 580) * t.p, 6.0, 1);
}

/** One bell strike on a nominal of ``nominal`` Hz, ``seconds`` long; ``bright`` scales the uppers. */
export function bellStrike(t: Take, nominal: number, seconds: number, bright: number): Mono {
  const r = t.rng;
  const out = t.canvas(seconds);
  // [ratio to nominal, level, T60 in seconds]
  const partials: [number, number, number][] = [
    [0.25, 0.55, 9.0], // hum
    [0.502, 0.45, 6.5], // prime
    [0.597, 0.6, 4.5], // tierce
    [0.753, 0.12, 3.2], // quint
    [1.0, 1.0, 3.0], // nominal
    [1.258, 0.4 * bright, 1.7],
    [1.335, 0.22 * bright, 1.5],
    [1.505, 0.28 * bright, 1.2],
    [2.0, 0.12 * bright, 0.8],
    [2.52, 0.07 * bright, 0.55],
    [2.67, 0.05 * bright, 0.45],
    [3.01, 0.04 * bright, 0.35],
  ];
  for (const [ratio, level, t60] of partials) {
    const f = nominal * ratio * (1 + r.range(-0.004, 0.004));
    const beat = r.range(0.5, 2.5);
    const tau = t.d(t60) / 6.9;
    // One line of each doublet dominates, so the beat is a slow waver and
    // not a full tremolo (an even split cancels to silence at every beat).
    const split = r.range(0.65, 0.85);
    addMode(out, t.sr, 0, f - beat / 2, level * split, tau * r.range(0.9, 1.1), r.range(0, 6.28));
    addMode(out, t.sr, 0, f + beat / 2, level * (1 - split), tau * r.range(0.9, 1.1), r.range(0, 6.28));
  }
  // The clapper: a clang of brief high partials, then a dull knock.
  for (let k = 0; k < 10; k++) {
    addMode(out, t.sr, 0, r.range(1800, 7000), 0.05 * bright, r.range(0.01, 0.05), r.range(0, 6.28));
  }
  t.put(out, burst(t, 0.01, 300, t.c(4000), 0.0002, 0.0018), 0, t.g(0.6));
  t.put(out, burst(t, 0.05, 150, 1400, 0.0006, 0.01), 0, t.g(0.35));
  // The last half second eases out (the hum is still faintly there).
  shapeBy(out, (u) => (u < 0.9 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.9)) / 0.1)), 64);
  return out;
}

/**
 * The church doors swinging open: a long, low groan of dry oak on iron
 * hinges — a stick-slip whose rate wanders slowly — with a thin squeal of the
 * hinge riding on it, and a soft knock as the door comes to rest.
 */
export function churchDoorCreak(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(r.range(1.9, 2.5));
  const out = t.canvas(seconds + 0.5);
  const walk = wanderTrack(t.n(seconds), r, 2.5, t.sr);
  const groan = creak(t, seconds, (u) => (28 + 55 * walk(u)) * (0.8 + 0.4 * Math.sin(Math.PI * u)),
    [[180, 3, 1], [420, 4, 0.8], [950, 5, 0.5], [2200, 6, 0.2]], 0.5);
  adsr(groan, t.sr, 0.15, 0.3, 0.8, 0.35);
  t.put(out, groan, 0, t.g(1.0));
  const walk2 = wanderTrack(t.n(seconds), r, 4, t.sr);
  const squeal = creak(t, seconds * 0.6, (u) => (320 + 260 * walk2(u)) * t.p, [[1300, 8, 1], [2600, 8, 0.5]], 0.15);
  adsr(squeal, t.sr, 0.2, 0.2, 0.6, 0.3);
  t.put(out, squeal, seconds * r.range(0.1, 0.3), t.g(0.18));
  t.put(out, knock(t, r.range(110, 150), t.d(0.06), 1), seconds - 0.05, t.g(0.35));
  t.put(out, burst(t, 0.2, 40, 250, 0.003, 0.05, 4), seconds - 0.05, t.g(0.3));
  return out;
}

/** A lighter door — a shop, the saloon's back door: shorter, higher, a quick tap at the end. */
export function doorCreak(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(r.range(0.8, 1.2));
  const out = t.canvas(seconds + 0.3);
  const walk = wanderTrack(t.n(seconds), r, 5, t.sr);
  const c = creak(t, seconds, (u) => (70 + 120 * walk(u)) * t.p, [[520, 4, 1], [1300, 5, 0.7], [2900, 6, 0.3]], 0.35);
  adsr(c, t.sr, 0.08, 0.2, 0.7, 0.2);
  t.put(out, c, 0, t.g(1.0));
  t.put(out, knock(t, r.range(200, 280), 0.03, 1), seconds - 0.02, t.g(0.3));
  return out;
}

/**
 * The weather vane, shot: it spins wildly — a squeak of the dry pivot and a
 * swish of air every turn — slowing as friction takes it, then creaks
 * through its last turns and settles with a clunk, pointing at you.
 */
export function vaneSpin(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(r.range(3.0, 3.8));
  const out = t.canvas(seconds + 0.4);
  const n = t.n(seconds);
  // Angular speed in turns/s: a hard start and a friction decay to zero.
  const w0 = r.range(4.5, 6);
  const speed = (u: number): number => w0 * Math.pow(Math.max(0, 1 - u), 1.6);
  // A clang where the shot struck it.
  t.put(out, click(t.sr, r, 0.003, 1500, 14000), 0, t.g(0.8));
  addMetal(out, t.sr, r, 0, r.range(1200, 1700), 0.05, 0.35);
  let turns = 0;
  let next = r.range(0.05, 0.3);
  const air = white(n, r);
  svf(air, t.sr, "bp", (u) => 500 + 1300 * speed(u) / w0, 1.2, 64);
  normalize(air);
  let phase = 0;
  let w = speed(0);
  let level = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      w = speed(i / n);
      level = (w / w0) * Math.sqrt(w / w0);
    }
    phase += w / t.sr;
    // The swish: louder with speed, pulsing once a turn as the tail faces the wind.
    const face = 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);
    air[i]! *= level * face * face;
    if (phase >= next) {
      const u = i / n;
      // A squeak per turn: stick-slip at a rate that falls with the speed.
      const len = Math.min(0.25, 0.12 + 0.15 / (1 + w));
      const at = i / t.sr;
      const rate = (200 + 90 * w) * t.p * r.range(0.9, 1.1);
      const sq = creak(t, len, (v) => rate * (1 + 0.15 * Math.sin(Math.PI * v)), [[900, 6, 1], [1900, 7, 0.5], [3100, 8, 0.2]], 0.2);
      adsr(sq, t.sr, 0.02, 0.05, 0.6, len * 0.4);
      t.put(out, sq, at, t.g(0.35 * (0.4 + 0.6 * (1 - u))));
      turns++;
      next = phase + r.range(0.95, 1.05);
    }
  }
  t.put(out, air, 0, t.g(0.25));
  // It settles: a slow last creak, a clunk against the stop.
  const end = seconds - 0.1;
  const last = creak(t, 0.4, (v) => 60 + 40 * (1 - v), [[700, 5, 1], [1500, 6, 0.5]], 0.4);
  adsr(last, t.sr, 0.05, 0.1, 0.6, 0.15);
  t.put(out, last, end - 0.35, t.g(0.3));
  addMetal(out, t.sr, r, end, r.range(800, 1100), 0.03, 0.2, [1, 1.47, 2.2]);
  void turns;
  return out;
}

/**
 * Water pouring from a bullet hole in the tower onto the dirt: a steady
 * splatter (noise flickering fast, as a stream breaks into drops), a patter
 * of heavier drops into the puddle, and small bubbles popping in it.
 */
export function waterLeak(t: Take): Mono {
  const r = t.rng;
  const seconds = r.range(2.8, 3.4);
  const length = t.n(seconds);
  const n = length + t.n(0.5);
  const stream = bandNoise(n, t.sr, r, 500, t.c(5000), 2);
  const flick = wobble(n, t.sr, 90, () => r.next());
  const slow = wobble(n, t.sr, 3, () => r.next());
  for (let i = 0; i < n; i++) {
    const f = Math.abs(flick[i]!);
    stream[i]! *= (0.35 + 0.65 * f * Math.sqrt(f)) * (0.85 + 0.15 * slow[i]!);
  }
  const bed = loopify(stream, length);
  // Drops and bubbles as events, wrapped round the loop. None starts in the
  // loop's first few milliseconds (the wrap carries them past the end
  // instead): an onset exactly on the seam is indistinguishable from a click.
  const events = new Float32Array(length + t.n(0.3));
  const drops = Math.round(seconds * r.range(22, 30));
  for (let k = 0; k < drops; k++) {
    const at = r.range(0.008, seconds + 0.008);
    t.put(events, bubble(t, r.range(700, 2600) * t.p, r.range(0.005, 0.014), r.range(1.3, 1.9)), at, r.range(0.1, 0.35));
  }
  for (let k = 0; k < Math.round(seconds * 7); k++) {
    const at = r.range(0.008, seconds + 0.008);
    t.put(events, burst(t, 0.04, 90, 600, 0.001, 0.008, 2), at, r.range(0.15, 0.3));
  }
  const ev = wrap(events, length);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = 0.6 * bed[i]! + ev[i]!;
  return out;
}

/**
 * A tumbleweed rolling over packed dirt: a scratch of dry twigs each time it
 * comes round and bounces, a soft thud under the bigger bounces, and a thin
 * rustle between. The bounces fall on a period that fits the loop exactly.
 */
export function tumbleweedRoll(t: Take): Mono {
  const r = t.rng;
  const bounces = r.int(5, 7);
  const period = r.range(0.45, 0.6);
  const length = t.n(bounces * period);
  const events = new Float32Array(length + t.n(0.4));
  for (let k = 0; k < bounces; k++) {
    const at = k * period + r.range(-0.04, 0.04) + 0.05;
    const big = r.range(0.5, 1);
    const scratch = new Float32Array(t.n(0.22));
    scatter(scratch, t, r.int(14, 24), 0, r.range(0.1, 0.18), 1200, 8000, 0.5 * big, 0.9);
    lowpass(scratch, t.sr, 7000, 2);
    t.put(events, scratch, at, 1);
    t.put(events, burst(t, 0.1, 50, 260, 0.004, 0.025, 4), at, 0.35 * big * big);
  }
  const bedN = length + t.n(0.4);
  const rustle = bandNoise(bedN, t.sr, r, 1500, 7000, 2);
  const flick = wobble(bedN, t.sr, 60, () => r.next());
  for (let i = 0; i < bedN; i++) rustle[i]! *= Math.abs(flick[i]!) ** 2;
  const bed = loopify(rustle, length);
  const ev = wrap(events, length);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = ev[i]! + 0.12 * bed[i]!;
  return out;
}

/**
 * Boots with spurs on the boardwalk: three or four steps, each a heel's
 * knock on the planks and the rowel and jingle-bobs chiming a moment after.
 */
export function spurs(t: Take): Mono {
  const r = t.rng;
  const steps = r.int(3, 5);
  const gap = t.j(0.46, 0.1);
  const out = t.canvas(steps * gap + 0.5);
  for (let k = 0; k < steps; k++) {
    const at = 0.02 + k * gap * r.range(0.95, 1.05);
    const level = r.range(0.75, 1) * (k === 0 ? 0.8 : 1);
    t.put(out, knock(t, r.range(170, 240) * t.p, 0.025, 1), at, level * 0.8);
    t.put(out, click(t.sr, r, 0.003, 400, 6000), at, level * 0.5);
    t.put(out, burst(t, 0.06, 60, 300, 0.001, 0.015, 4), at, level * 0.4);
    // The jingle: two to four little bits of steel, just after the heel.
    let j = at + r.range(0.015, 0.04);
    for (let m = 0; m < r.int(2, 5); m++) {
      const f = r.range(3200, 6800) * t.p;
      addMode(out, t.sr, j, f, level * 0.12, r.range(0.03, 0.08), r.range(0, 6));
      addMode(out, t.sr, j, f * r.range(1.35, 1.6), level * 0.06, r.range(0.02, 0.05), r.range(0, 6));
      t.put(out, click(t.sr, r, 0.0015, 3000, 14000), j, level * 0.15);
      j += r.range(0.012, 0.045);
    }
  }
  return out;
}

/**
 * The wanted poster, shot: a rip as it tears off its nail, then paper
 * flapping as it zig-zags down (the flaps slowing as it falls), and a
 * papery slap on the boards.
 */
export function posterFlutter(t: Take): Mono {
  const r = t.rng;
  const fall = t.L(r.range(0.9, 1.2));
  const out = t.canvas(fall + 0.5);
  const rip = new Float32Array(t.n(0.18));
  scatter(rip, t, r.int(25, 40), 0, 0.15, 1200, 9000, 0.6, 1.0);
  t.put(out, rip, 0, t.g(0.9));
  t.put(out, burst(t, 0.12, 800, 5000, 0.004, 0.03), 0, t.g(0.4));
  const n = t.n(fall);
  const flap = bandNoise(n, t.sr, r, 700, t.c(5500), 2);
  const rate0 = r.range(9, 12);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    ph += (rate0 * (1 - 0.45 * u)) / t.sr;
    const beat = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * ph), 3);
    flap[i]! *= beat * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, u * 1.2)));
  }
  t.put(out, flap, 0.1, t.g(0.4));
  const crinkle = new Float32Array(n);
  scatter(crinkle, t, r.int(10, 18), 0, fall, 2000, 9000, 0.25, 1.0);
  t.put(out, crinkle, 0.1, 1);
  t.put(out, burst(t, 0.06, 250, 3000, 0.001, 0.012), 0.1 + fall, t.g(0.5));
  t.put(out, burst(t, 0.08, 60, 300, 0.002, 0.015, 4), 0.1 + fall, t.g(0.25));
  return out;
}

/** A burst of feathers: a soft *pff* of air and a flurry of the lightest papery ticks, settling. */
export function feathers(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.0));
  t.put(out, puff(t, 0.3, t.c(1300), 0.003, 0.05), 0, t.g(0.8));
  t.put(out, burst(t, 0.1, 900, 5000, 0.002, 0.02), 0, t.g(0.3));
  const flurry = new Float32Array(t.n(0.9));
  scatter(flurry, t, r.int(40, 60), 0.01, 0.85, 2500, 10000, 0.2, 2.0);
  lowpass(flurry, t.sr, 9000, 2);
  t.put(out, flurry, 0, 1);
  const swish = bandNoise(t.n(0.6), t.sr, r, 1500, 6000, 2);
  shapeBy(swish, (u) => Math.sin(Math.PI * u) ** 2 * (1 - u));
  t.put(out, swish, 0.05, t.g(0.12));
  return out;
}

/**
 * A lit fuse: a spitting hiss, sputtering irregularly, with bright sparks
 * cracking off it. Loops.
 */
export function dynamiteFuse(t: Take): Mono {
  const r = t.rng;
  const seconds = r.range(1.8, 2.2);
  const length = t.n(seconds);
  const n = length + t.n(0.3);
  const hiss = bandNoise(n, t.sr, r, 2200, t.c(11000), 2);
  const low = bandNoise(n, t.sr, r, 600, 2400, 2);
  const sput = wobble(n, t.sr, 14, () => r.next());
  const fast = wobble(n, t.sr, 120, () => r.next());
  const bedRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = 0.55 + 0.45 * sput[i]!;
    bedRaw[i] = (hiss[i]! * (0.7 + 0.3 * fast[i]!) + 0.35 * low[i]!) * s;
  }
  const bed = loopify(bedRaw, length);
  const sparks = new Float32Array(length + t.n(0.05));
  for (let k = 0; k < Math.round(seconds * r.range(35, 50)); k++) {
    t.put(sparks, click(t.sr, r, r.range(0.0006, 0.002), 2500, 16000), r.range(0.008, seconds + 0.008), r.range(0.15, 0.7) ** 2 * 1.4);
  }
  const ev = wrap(sparks, length);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = 0.55 * bed[i]! + ev[i]!;
  return out;
}

/** The stick flung end over end: a whoosh pulsing with its spin, the fuse's hiss passing by. */
export function dynamiteThrow(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(0.75);
  const out = t.canvas(seconds + 0.1);
  const n = t.n(seconds);
  const air = white(n, r);
  svf(air, t.sr, "bp", (u) => (1500 - 700 * u) * t.p, 1.4, 32);
  normalize(air);
  const spin = r.range(8, 13);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const pulse = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * spin * (i / t.sr)), 2);
    air[i]! *= pulse * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 1.5;
  }
  t.put(out, air, 0, t.g(0.8));
  const hiss = bandNoise(n, t.sr, r, 2500, 10000, 2);
  shapeBy(hiss, (u) => Math.sin(Math.PI * u) ** 2);
  t.put(out, hiss, 0, t.g(0.2));
  // The arm's swing and the coat: a short low swish at the start.
  t.put(out, puff(t, 0.2, 900, 0.03, 0.05), 0, t.g(0.35));
  return out;
}

/**
 * A stick of dynamite going off: the blast front, a crack driven into
 * saturation, a chest-deep boom and a roar of turbulent air, then the dirt
 * and splinters raining down over two seconds as a long rumble rolls away.
 */
export function dynamiteExplode(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(3.2));
  const head = t.canvas(0.5);
  t.put(head, nWave(t, t.j(0.0012, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.006, 500, 14000), 0, t.g(0.9));
  t.put(head, burst(t, 0.4, 150, t.c(8000), 0.0005, t.d(0.035), 2, -1), 0, t.g(1.0));
  t.put(head, burst(t, 0.45, 300, t.c(2500), 0.003, t.d(0.08), 2), 0.002, t.g(0.7));
  saturate(head, 3.0);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 0.9, 85 * t.p, 30 * t.p, 0.004, t.d(0.18), 0.5), 0.002, t.g(0.7));
  t.put(out, burst(t, 1.0, 30, 220, 0.004, t.d(0.25), 4), 0.002, t.g(0.8));
  // The roar: turbulent air, its level churning.
  const roarN = t.n(1.6);
  const roar = bandNoise(roarN, t.sr, r, 90, t.c(1500), 2);
  const churn = wobble(roarN, t.sr, 18, () => r.next());
  for (let i = 0; i < roarN; i++) roar[i]! *= 0.6 + 0.4 * churn[i]!;
  adsr(roar, t.sr, 0.02, 0.2, 0.5, 0.8);
  decayInPlace(roar, t.sr, 0, t.d(0.45));
  t.put(out, roar, 0.01, t.g(0.5));
  // The rumble rolling away.
  const rumble = brown(t.n(2.8), r);
  lowpass(rumble, t.sr, 220, 4);
  normalize(rumble);
  adsr(rumble, t.sr, 0.08, 0.3, 0.6, 1.2);
  decayInPlace(rumble, t.sr, 0, t.d(0.9));
  t.put(out, rumble, 0.03, t.g(0.55));
  // Debris: dirt, then wood and pebbles landing, thinning out.
  scatter(out, t, r.int(40, 60), 0.3, 2.4, 1200, 8000, 0.14, 1.8);
  for (let k = 0; k < r.int(6, 11); k++) {
    const at = 0.4 + Math.pow(r.next(), 1.5) * 1.6;
    t.put(out, knock(t, r.range(250, 700), 0.012, 0.6), at, r.range(0.05, 0.14));
  }
  for (let k = 0; k < r.int(3, 6); k++) {
    addShard(out, t, 0.5 + r.next() * 1.5, r.range(2500, 6000), r.range(0.02, 0.05), 0.02);
  }
  return out;
}
