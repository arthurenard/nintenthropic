/**
 * The night's loops: the crickets in the fields, the wind over the corn, the
 * streetlight's ballast, the power lines and the projector on the hill.
 */
import { sampled } from "../../dsp/curves";
import { highpass, lowpass, svf } from "../../dsp/filters";
import { loopify, wrap } from "../../dsp/master";
import { type Mono, fade, normalize, wobble } from "../../dsp/signal";
import { addMode, bandNoise, click, pink, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { burst, periodicCurve, wanderTrack } from "../kit";
import { buzzCycle, panGains, scrape, tone, turned, vocal } from "./layers";

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
  const gust = periodicCurve(n, length, r, [1, 2, 3, 5], 0.7);
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
