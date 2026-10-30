/**
 * The sounds a Grip Prix kart makes while it moves: four engines (a light
 * kart's two-stroke, a middleweight's thumper, a heavy kart's V-twin and a
 * robot's electric motor), each recorded low and high in its revs, the rasp
 * of an engine working hard, an idle, a growl for boost, the tyres' roll on
 * the road, the drift's squeal and its sparks' fizz, the sound of each
 * surface under the wheels, a homing puck's whistle and the rescue drone's
 * rotors. All are loops, and all are steered at run time (an engine's pitch
 * follows its revs by playback rate), so each is built to be heard stretched.
 *
 * The loops are periodic by construction: every component is a whole number
 * of cycles in the loop, events that run past the end wrap round to the
 * start, and filters run over the loop twice so they meet the seam already
 * settled; the seam is exactly as smooth as any other moment.
 */
import { biquad, bandpass, highpass, lowpass } from "../dsp/filters";
import { type Mono, normalize } from "../dsp/signal";
import { addMode, bandNoise, brown, pink, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { bubble } from "./kit";
import { TAU, addWrapped, circular, cyclic, drive, expo, grains, noiseLoop, times, tone } from "./kart-kit";

// --- engines --------------------------------------------------------------------------------------

/** One component of a periodic sound: ``cycles`` whole cycles in the loop. */
interface Part {
  cycles: number;
  amp: number;
  /** Phase in radians (0 gives a cosine: aligned peaks, a pulse train). */
  phase: number;
}

/** Sum of sinusoids by rotating phasors: four multiplies a sample each, no sin() in the loop. */
function sumParts(n: number, parts: Part[]): Mono {
  const out = new Float32Array(n);
  for (const p of parts) {
    if (p.amp === 0) continue;
    const w = (TAU * p.cycles) / n;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let re = Math.cos(p.phase);
    let im = Math.sin(p.phase);
    for (let i = 0; i < n; i++) {
      out[i]! += p.amp * re;
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
    }
  }
  return out;
}

/** A slow wander that repeats exactly every loop: a few whole sine cycles at random phases, about -1..1. */
function wander(t: Take, n: number, cycles: readonly number[]): Mono {
  const w = sumParts(n, cycles.map((c) => ({ cycles: c, amp: t.rng.range(0.6, 1), phase: t.rng.range(0, TAU) })));
  return normalize(w);
}

/**
 * A combustion engine as its exhaust hears it: each firing a push of gas
 * (a rounded pulse that carries the low thump), its sharp leading edge, and
 * a puff of turbulent noise, all ringing the pipe's resonances. No two
 * firings are quite alike in time or strength, which is what turns a tone
 * into an engine.
 */
interface PulseEngine {
  /** Engine cycles a second at playback rate 1: the note's fundamental (exact: the loop holds a whole number of them). */
  hz: number;
  /** Loop length, s (rounded to whole cycles). */
  seconds: number;
  /** One engine cycle's firings: [where in the cycle, 0..1, strength]. A single cylinder has one; a V-twin an uneven pair. */
  pattern: readonly (readonly [number, number])[];
  /** Firing to firing: timing (± fraction of a period) and strength (±). */
  jitter: number;
  wobble: number;
  /** The push's width, a fraction of the firing period: narrow is buzzy, wide is round. */
  width: number;
  /** How hard each firing's sharp edge strikes the pipe, against its puff of gas (both ring the resonances). */
  edge: number;
  /** The pipe's and the body's resonances: [Hz, Q, gain]. */
  formants: readonly (readonly [number, number, number])[];
  /** The balance heard, each part levelled first: the push low-passed (the thump under it all), the pipe's ringing, the raw puffs. */
  body: number;
  bodyCut: number;
  ring: number;
  /** The exhaust's puff of noise on each firing. */
  puff: { low: number; high: number; level: number; decay: number };
  /** Soft-clip drive: the grain of a small engine flat out. */
  drive: number;
  lowpass?: number;
}

function pulseEngine(t: Take, e: PulseEngine): Mono {
  const sr = t.sr;
  const r = t.rng;
  const per = e.pattern.length;
  const cycles = Math.max(4, Math.round(e.hz * e.seconds));
  const n = Math.round((cycles * sr) / e.hz);
  const cycleLen = n / cycles;
  const period = cycleLen / per;
  // The push: a half-sine and a slower, shallower pull back, so each firing carries no net offset.
  const w = Math.max(3, Math.round(e.width * period));
  const push = new Float32Array(3 * w);
  for (let i = 0; i < w; i++) push[i] = Math.sin((Math.PI * i) / w);
  for (let i = 0; i < 2 * w; i++) push[w + i] = -0.5 * Math.sin((Math.PI * i) / (2 * w));
  const puffLen = Math.max(8, Math.round(e.puff.decay * period * 5));
  const puffK = Math.exp(-1 / Math.max(1, e.puff.decay * period));
  const thump = new Float32Array(n);
  const ring = new Float32Array(n);
  const gas = new Float32Array(n);
  // Strength breathes slowly as well as varying firing to firing.
  const breathe = wander(t, n, [2, 3, 5]);
  for (let c = 0; c < cycles; c++) {
    for (const [pos, strength] of e.pattern) {
      // A third of a cycle in, so the loop's seam falls in a firing's tail and not on its onset.
      const at = Math.round((c + pos + 0.37) * cycleLen + r.range(-1, 1) * e.jitter * period);
      const k = ((at % n) + n) % n;
      const a = strength * (1 + r.range(-1, 1) * e.wobble) * (1 + 0.5 * e.wobble * breathe[k]!);
      addWrapped(thump, push, at, a);
      ring[k]! += a * e.edge;
      ring[(k + 1) % n]! -= 0.5 * a * e.edge;
      let env = a * r.range(0.6, 1.2);
      for (let i = 0; i < puffLen; i++) {
        gas[(k + i) % n]! += env * (2 * r.next() - 1);
        env *= puffK;
      }
    }
  }
  circular(gas, (twice) => bandpass(twice, sr, e.puff.low, e.puff.high, 2));
  normalize(gas);
  // The pipe rings to each firing's edge and its puff of gas; the ringing is made and levelled apart from the thump,
  // so the recipe's numbers are the balance heard.
  const source = new Float32Array(n);
  for (let i = 0; i < n; i++) source[i] = ring[i]! + 0.25 * gas[i]!;
  const pipe = new Float32Array(n);
  // Each take's pipe is a shade different.
  const tune = r.range(0.97, 1.03);
  for (const [hz, q, gain] of e.formants) {
    const band = Float32Array.from(source);
    circular(band, (twice) => biquad(twice, sr, "bandpass", hz * tune, q));
    for (let i = 0; i < n; i++) pipe[i]! += gain * band[i]!;
  }
  normalize(pipe);
  circular(thump, (twice) => lowpass(twice, sr, e.bodyCut, 2));
  normalize(thump);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = e.body * thump[i]! + e.ring * pipe[i]! + e.puff.level * gas[i]!;
  normalize(out);
  drive(out, e.drive);
  if (e.lowpass) circular(out, (twice) => lowpass(twice, sr, e.lowpass!, 2));
  return out;
}

/** The revs (engines.ts) each layer was made at: the low layer covers a crawl to mid revs, the high one the rest. */
const REV_LO = 0.9;
const REV_HI = 1.6;

/** A light kart: a two-stroke's ring-a-ding buzz, a narrow sharp push ringing a bright expansion pipe. */
const LIGHT: Omit<PulseEngine, "hz" | "seconds"> = {
  pattern: [[0, 1]], jitter: 0.018, wobble: 0.14, width: 0.2, edge: 1,
  formants: [[1250, 3.2, 1], [2900, 4.5, 0.6], [5400, 5, 0.25], [640, 2.5, 0.45]],
  body: 0.55, bodyCut: 700, ring: 1, puff: { low: 1500, high: 6500, level: 0.22, decay: 0.18 }, drive: 2.1,
};

/** A middleweight: a single-cylinder thumper, rounder, with a mid-range bark. */
const MIDDLE: Omit<PulseEngine, "hz" | "seconds"> = {
  pattern: [[0, 1], [0.5, 0.18]], jitter: 0.02, wobble: 0.16, width: 0.3, edge: 1,
  formants: [[520, 2.8, 1], [1350, 3.8, 0.65], [2700, 4.5, 0.3]],
  body: 0.8, bodyCut: 450, ring: 0.95, puff: { low: 400, high: 3200, level: 0.2, decay: 0.24 }, drive: 1.7,
};

/** A heavyweight: a V-twin's uneven lope (two firings close, then a gap), deep and chesty. */
const HEAVY: Omit<PulseEngine, "hz" | "seconds"> = {
  pattern: [[0, 1], [0.5625, 0.85]], jitter: 0.024, wobble: 0.18, width: 0.38, edge: 1,
  formants: [[260, 2.4, 0.7], [720, 3, 1], [1700, 3.5, 0.6], [3200, 4, 0.2]],
  body: 0.8, bodyCut: 320, ring: 1, puff: { low: 180, high: 2600, level: 0.22, decay: 0.3 }, drive: 1.9, lowpass: 5000,
};

/** Each engine's note at revs 1, Hz: its cycles a second (the V-twin fires twice in each). */
const NOTE = { light: 110, middle: 84, heavy: 46, electric: 58 } as const;

/** Engine light, low and high in its revs. */
export const engineLightLo = (t: Take): Mono => pulseEngine(t, { ...LIGHT, hz: NOTE.light * REV_LO, seconds: 1 });
export const engineLightHi = (t: Take): Mono => pulseEngine(t, { ...LIGHT, hz: NOTE.light * REV_HI, seconds: 1 });
export const engineMiddleLo = (t: Take): Mono => pulseEngine(t, { ...MIDDLE, hz: NOTE.middle * REV_LO, seconds: 1 });
export const engineMiddleHi = (t: Take): Mono => pulseEngine(t, { ...MIDDLE, hz: NOTE.middle * REV_HI, seconds: 1 });
export const engineHeavyLo = (t: Take): Mono => pulseEngine(t, { ...HEAVY, hz: NOTE.heavy * REV_LO, seconds: 1 });
export const engineHeavyHi = (t: Take): Mono => pulseEngine(t, { ...HEAVY, hz: NOTE.heavy * REV_HI, seconds: 1 });

/**
 * Rivet's electric motor: a deep whirr of the rotor's poles with a second
 * rotor a whisker off (a slow beat), the windings' whine and the gears'
 * higher one, and the faint buzz of the drive that switches it.
 */
function electric(t: Take, revs: number): Mono {
  const r = t.rng;
  const hz = NOTE.electric * revs;
  const unit = Math.max(4, Math.round(hz));
  // About a second, exactly ``unit`` cycles of the note.
  const n = Math.round((unit * t.sr) / hz);
  const seconds = n / t.sr;
  const ph = (): number => r.range(0, TAU);
  const parts: Part[] = [
    { cycles: unit, amp: 0.8, phase: ph() },
    { cycles: unit * 2, amp: 0.6, phase: ph() },
    { cycles: unit * 3, amp: 0.32, phase: ph() },
    { cycles: unit * 4, amp: 0.2, phase: ph() },
    { cycles: unit * 6, amp: 0.14, phase: ph() },
    { cycles: unit + 1, amp: 0.45, phase: ph() },
    { cycles: 2 * unit + 1, amp: 0.2, phase: ph() },
    // The whine of the windings and the gears: a sixth and a twelfth harmonic of the poles' rate up, a little sharp of them.
    { cycles: Math.round(unit * 7.02), amp: 0.5 * r.range(0.85, 1.15), phase: ph() },
    { cycles: Math.round(unit * 9), amp: 0.18, phase: ph() },
    { cycles: Math.round(unit * 13.05), amp: 0.22 * r.range(0.85, 1.15), phase: ph() },
    { cycles: Math.round(unit * 19.1), amp: 0.08, phase: ph() },
  ];
  const body = normalize(sumParts(n, parts));
  const wob = wander(t, n, [3, 7]);
  // The drive's switching buzz: a narrow pulse train three times the poles' rate, soft.
  const buzz = new Float32Array(n);
  const step = n / (unit * 3);
  for (let k = 0; k < unit * 3; k++) {
    const at = Math.round(k * step);
    buzz[at % n]! += 1;
    buzz[(at + 1) % n]! -= 1;
  }
  circular(buzz, (twice) => bandpass(twice, t.sr, 1200, 6000, 2));
  normalize(buzz);
  const air = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 1800, 7000, 2));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i]! * (1 + 0.08 * wob[i]!) + 0.25 * buzz[i]! + 0.05 * air[i]!;
  drive(out, 1.3);
  return out;
}
export const engineElectricLo = (t: Take): Mono => electric(t, REV_LO);
export const engineElectricHi = (t: Take): Mono => electric(t, REV_HI);

/**
 * The rasp of an engine working hard: a burst of rough exhaust noise on
 * every firing (100 a second at rate 1, pitched to each engine's own), now
 * and then a spit of a crackle. Steered up as the kart pulls, climbs or
 * ploughs on, and away as it lifts off.
 */
export function engineGrit(t: Take): Mono {
  const sr = t.sr;
  const r = t.rng;
  const firings = Math.round(100 * 1.0);
  const n = t.n(1.0);
  const period = n / firings;
  const out = new Float32Array(n);
  const k = Math.exp(-1 / (0.2 * period));
  const len = Math.round(period * 1.1);
  for (let f = 0; f < firings; f++) {
    const at = Math.round(f * period + r.range(-0.04, 0.04) * period);
    const spit = r.next() < 0.08;
    let env = (spit ? 1.6 : 1) * r.range(0.35, 1);
    const kk = spit ? Math.exp(-1 / (0.08 * period)) : k;
    for (let i = 0; i < len; i++) {
      out[(((at + i) % n) + n) % n]! += env * (2 * r.next() - 1);
      env *= kk;
    }
  }
  circular(out, (twice) => bandpass(twice, sr, 750, 5200, 2));
  normalize(out);
  drive(out, 1.6);
  return out;
}

/** Idling: a lumpy put-put, thirteen soft thumps in a second, no two quite alike. */
export function engineIdle(t: Take): Mono {
  const n = t.n(1.0);
  const r = t.rng;
  const out = new Float32Array(n);
  const pulses = 13;
  for (let k = 0; k < pulses; k++) {
    const at = Math.floor(((k + r.range(-0.12, 0.12)) / pulses) * n);
    const strength = [1, 0.6, 0.85, 0.55, 0.95, 0.65, 0.8][k % 7]! * r.range(0.9, 1.1);
    const len = t.n(0.07);
    const thump = new Float32Array(len);
    // A falling sine: the cylinder's push.
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      thump[i] = Math.sin(ph) * Math.exp(-u * 6);
      ph += (TAU * (62 - 22 * u)) / t.sr;
    }
    const puff = bandpass(white(len, r), t.sr, 180, 1400, 2);
    expo(puff, t.sr, 0.012, 0.001);
    for (let i = 0; i < len; i++) thump[i]! += 0.45 * puff[i]!;
    addWrapped(out, thump, at, strength);
  }
  circular(out, (twice) => lowpass(twice, t.sr, 1800, 2));
  return out;
}

/** The boost growl: a deeper, heavier engine roaring under the kart's own while the nitro burns. */
export function engineGrowl(t: Take): Mono {
  return pulseEngine(t, {
    hz: 56, seconds: 1.0, pattern: [[0, 1]], jitter: 0.03, wobble: 0.22, width: 0.32, edge: 0.6,
    formants: [[320, 2.2, 1], [900, 3, 0.7], [2100, 4, 0.35]],
    body: 1, bodyCut: 300, ring: 0.9, puff: { low: 250, high: 2600, level: 0.3, decay: 0.3 }, drive: 3.5, lowpass: 3800,
  });
}

// --- the road ------------------------------------------------------------------------------------------

/**
 * The tyres rolling on the road: a low roar of rubber on tarmac with a
 * little texture of the grain in it, quiet, swelling with speed. It falls
 * away in the air, which is half of what makes a jump feel airborne.
 */
export function tyreRoad(t: Take): Mono {
  const seconds = 1.6;
  const n = t.n(seconds);
  const r = t.rng;
  const roar = noiseLoop(t, seconds, (m) => bandpass(brown(m, r), t.sr, 55, 520, 2), 0.3);
  normalize(roar);
  times(roar, cyclic(n, 3, 0.25, r.range(0, TAU)));
  const grain = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 650, 2600, 2), 0.3);
  normalize(grain);
  times(grain, cyclic(n, 11, 0.5, r.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = roar[i]! + 0.32 * grain[i]!;
  return out;
}

// --- the drift --------------------------------------------------------------------------------------

/**
 * The tyres' squeal in a drift: a thin shriek (a tone with its harmonics,
 * wavering with the rubber's grip and slip) over a hiss of sliding rubber. A
 * toy kart's squeal: bright, not menacing.
 */
export function driftScreech(t: Take): Mono {
  const seconds = 0.6;
  const n = t.n(seconds);
  const r = t.rng;
  const base = Math.round(1050 * t.p * seconds);
  // The pitch slips about with two cyclic wobbles.
  const w1 = sumParts(n, [{ cycles: 5, amp: 1, phase: r.range(0, TAU) }]);
  const w2 = sumParts(n, [{ cycles: 13, amp: 1, phase: r.range(0, TAU) }]);
  // Frequency in cycles-per-loop is base * (1 + wobble) but its integral must stay a whole number: the wobbles integrate to zero over the loop.
  const freq = new Float32Array(n);
  for (let i = 0; i < n; i++) freq[i] = (base / seconds) * (1 + 0.035 * w1[i]! + 0.018 * w2[i]!);
  const squeal = tone(n, t.sr, freq, 0.55, 0.3);
  const flutter = cyclic(n, 7, 0.45, r.range(0, TAU));
  times(squeal, flutter);
  const hiss = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 2200, 8000, 2));
  // The rubber scrubbing sideways under it: a rougher, lower band that stutters with the grip.
  const scrub = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 380, 1500, 2));
  times(scrub, cyclic(n, 17, 0.6, r.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = squeal[i]! * 0.8 + hiss[i]! * 0.45 + scrub[i]! * 0.3;
  return out;
}

/**
 * The sparks of a drift, fizzing under the squeal: a dense crackle of tiny
 * bright clicks over a hiss, with a glint of two high partials. Silent
 * before the first spark; RaceAudio raises it and pitches it up at each
 * level, so the charge is heard building before it is let go.
 */
export function driftSparks(t: Take): Mono {
  const seconds = 1.2;
  const n = t.n(seconds);
  const r = t.rng;
  const crackle = grains(t, seconds, 260, (s) => {
    const len = t.n(r.range(0.0006, 0.0025));
    const g = white(len, r);
    for (let i = 0; i < len; i++) g[i]! *= Math.exp((-4 * i) / len) * (0.4 + s * s);
    return g;
  });
  circular(crackle, (twice) => bandpass(twice, t.sr, 2400, 10000, 2));
  normalize(crackle);
  const hiss = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 4200, 10000, 2));
  times(hiss, cyclic(n, 9, 0.5, r.range(0, TAU)));
  const glint = sumParts(n, [
    { cycles: Math.round(3150 * seconds), amp: 1, phase: r.range(0, TAU) },
    { cycles: Math.round(4720 * seconds), amp: 0.6, phase: r.range(0, TAU) },
  ]);
  times(glint, cyclic(n, 23, 0.85, r.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = crackle[i]! * 0.8 + hiss[i]! * 0.35 + glint[i]! * 0.06;
  return out;
}

// --- surfaces ---------------------------------------------------------------------------------------------

/** Ice: a hiss of fine crystals and the odd glassy tick. */
export function surfaceIce(t: Take): Mono {
  const seconds = 1.6;
  const n = t.n(seconds);
  const hiss = noiseLoop(t, seconds, (m) => highpass(white(m, t.rng), t.sr, 4200, 2), 0.3);
  times(hiss, cyclic(n, 3, 0.35, t.rng.range(0, TAU)));
  const ticks = grains(t, seconds, 7, (s) => {
    const g = new Float32Array(t.n(0.03));
    addMode(g, t.sr, 0, t.rng.range(3200, 7200), s, 0.004, t.rng.range(0, TAU));
    return g;
  });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = hiss[i]! * 0.5 + ticks[i]! * 0.7;
  return out;
}

/** Snow: a squeaky crunch, grain after grain. */
export function surfaceSnow(t: Take): Mono {
  const seconds = 1.8;
  const n = t.n(seconds);
  const crunch = grains(t, seconds, 42, (s) => {
    const len = t.n(t.rng.range(0.008, 0.028));
    const g = bandpass(white(len, t.rng), t.sr, t.rng.range(900, 2200), t.rng.range(3500, 7000), 2);
    return expo(g, t.sr, 0.006 + 0.004 * s, 0.0005);
  });
  const bed = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, t.rng, 400, 3000, 2), 0.3);
  times(bed, cyclic(n, 4, 0.5, t.rng.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = crunch[i]! + bed[i]! * 0.22;
  return out;
}

/** Sand and gravel: a coarse rush with stones knocking. */
export function surfaceSand(t: Take): Mono {
  const seconds = 1.7;
  const n = t.n(seconds);
  const rush = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, t.rng, 1200, 6500, 2), 0.3);
  times(rush, cyclic(n, 6, 0.4, t.rng.range(0, TAU)));
  const stones = grains(t, seconds, 36, (s) => {
    const g = new Float32Array(t.n(0.03));
    addMode(g, t.sr, 0, t.rng.range(500, 2400), s, t.rng.range(0.002, 0.006), t.rng.range(0, TAU));
    const tick = bandpass(white(t.n(0.006), t.rng), t.sr, 2000, 7000, 2);
    expo(tick, t.sr, 0.0015, 0.0003);
    for (let i = 0; i < tick.length; i++) g[i]! += 0.8 * tick[i]!;
    return g;
  });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rush[i]! * 0.55 + stones[i]! * 0.55;
  return out;
}

/** Mud: a thick low slosh with bubbles bursting in it. */
export function surfaceMud(t: Take): Mono {
  const seconds = 1.8;
  const n = t.n(seconds);
  const body = noiseLoop(t, seconds, (m) => lowpass(brown(m, t.rng), t.sr, 700, 2), 0.3);
  normalize(body);
  times(body, cyclic(n, 3, 0.6, t.rng.range(0, TAU)));
  const pops = grains(t, seconds, 12, () => {
    const g = bubble(t, t.rng.range(180, 650), t.rng.range(0.012, 0.03), 1.8);
    return g.length > 0 ? g : new Float32Array(1);
  });
  // The squelch of the tyres pulling out of it: a wet mid-band slurp that swells with each turn of the wheel.
  const squelch = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, t.rng, 350, 1400, 2), 0.3);
  times(squelch, cyclic(n, 7, 0.85, t.rng.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i]! * 0.6 + pops[i]! * 1.1 + squelch[i]! * 0.25;
  return out;
}

/** Grass: a soft swish, the verge brushing the wheels. */
export function surfaceGrass(t: Take): Mono {
  const seconds = 1.6;
  const n = t.n(seconds);
  const swish = noiseLoop(t, seconds, (m) => bandpass(pink(m, t.rng), t.sr, 500, 3600, 2), 0.3);
  normalize(swish);
  times(swish, cyclic(n, 5, 0.5, t.rng.range(0, TAU)));
  return swish;
}

// --- the air ---------------------------------------------------------------------------------------------------

/** A homing puck's whistle: a clear tone wavering about, rising to a bright overtone. */
export function seekerWhistle(t: Take): Mono {
  const seconds = 0.8;
  const n = t.n(seconds);
  const r = t.rng;
  const base = Math.round(1380 * t.p * seconds);
  const wave = sumParts(n, [{ cycles: 6, amp: 1, phase: r.range(0, TAU) }]);
  const slow = sumParts(n, [{ cycles: 2, amp: 1, phase: r.range(0, TAU) }]);
  const freq = new Float32Array(n);
  for (let i = 0; i < n; i++) freq[i] = (base / seconds) * (1 + 0.045 * wave[i]! + 0.02 * slow[i]!);
  const whistle = tone(n, t.sr, freq, 0.22, 0.06);
  times(whistle, cyclic(n, 6, 0.25, r.range(0, TAU)));
  const air = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 2500, 6500, 2));
  for (let i = 0; i < n; i++) whistle[i] = whistle[i]! + 0.1 * air[i]!;
  return whistle;
}

/** The rescue drone's rotors: a throbbing blade-pass buzz, a motor whine and the wash of air. */
export function droneRotors(t: Take): Mono {
  const seconds = 1.0;
  const n = t.n(seconds);
  const r = t.rng;
  const blades = Math.round(78 * t.p * seconds);
  const parts: Part[] = [];
  for (let k = 1; k <= 22; k++) parts.push({ cycles: blades * k, amp: 1 / (k ** 1.1), phase: r.range(0, TAU) });
  const buzz = normalize(sumParts(n, parts));
  // Four rotors a little out of step beat against each other.
  const beat = cyclic(n, 3, 0.45, r.range(0, TAU));
  times(buzz, beat);
  const whineBase = Math.round(690 * t.p * seconds);
  const whineWob = sumParts(n, [{ cycles: 4, amp: 1, phase: r.range(0, TAU) }]);
  const wf = new Float32Array(n);
  for (let i = 0; i < n; i++) wf[i] = (whineBase / seconds) * (1 + 0.02 * whineWob[i]!);
  const whine = tone(n, t.sr, wf, 0.3, 0.1);
  const wash = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 700, 3200, 2));
  const puff = new Float32Array(n);
  for (let i = 0; i < n; i++) puff[i] = 0.55 + 0.45 * Math.cos((TAU * blades * i) / n);
  times(wash, puff);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buzz[i]! * 0.9 + whine[i]! * 0.28 + wash[i]! * 0.4;
  circular(out, (twice) => lowpass(twice, t.sr, 5200, 2));
  return out;
}

/**
 * The wind past a fast kart and round one in the air: a broad rush of air that swells and eases, and
 * a thin hiss riding on it. Steered by the game (louder and higher with speed, loudest off a jump).
 */
export function windRush(t: Take): Mono {
  const seconds = 1.5;
  const n = t.n(seconds);
  const r = t.rng;
  const rush = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 220, 2200, 2), 0.3);
  normalize(rush);
  times(rush, cyclic(n, 3, 0.35, r.range(0, TAU)));
  const hiss = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 2800, 7500, 2));
  normalize(hiss);
  times(hiss, cyclic(n, 5, 0.55, r.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rush[i]! * 0.85 + hiss[i]! * 0.2;
  return out;
}
