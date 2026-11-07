/**
 * How a Grip Prix kart's engine is made. Not an oscillator with a filter on it:
 * the way a small engine really sounds.
 *
 * Every firing is a push of hot gas out of the cylinder (a pulse with a hard
 * leading edge and a longer tail), which does four things at once:
 *
 *   - it thumps (the push itself, low-passed: the sub that a kart's chest hears);
 *   - it strikes the exhaust pipe, a waveguide closed at one end that rings at
 *     its tube frequency and the odd multiples of it, and the body and the
 *     muffler colour that ringing with three or four formants;
 *   - it throws a puff of turbulent gas out of the mouth (band-limited noise);
 *   - half a cycle later the intake draws and roars, and the valves tick.
 *
 * No two firings are alike (their timing wanders by a few percent, their
 * strength by a lognormal spread, the combustion breathes over a few cycles,
 * and now and then one is weak), which is what turns a buzz into something
 * alive. The two channels share the firings (so the low end is one engine in
 * the middle and the sum is mono-safe) but have their own pipe tuning, gas and
 * intake noise: a twin-outlet exhaust, wide above a few hundred hertz.
 *
 * Each engine is rendered as a loop in three rev bands (low, mid, high), so a
 * loop played at a rate near 1 keeps its pipe's resonances where an exhaust
 * would have them instead of sliding with the pitch, and the three crossfade.
 */
import { biquad, bandpass, highpass, lowpass } from "../dsp/filters";
import { pipeResonance, slowWander } from "../dsp/resonators";
import { type Mono, normalize } from "../dsp/signal";
import { addMode, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { TAU, addCycles, addWrapped, circular, drive, noiseLoop, times } from "./kart-kit";

/** The revs (src/kart/audio/engines.ts) at which the low, mid and high layers are made. */
export const LAYER_REVS = { lo: 0.8, mid: 1.2, hi: 1.8 } as const;

/** Each engine's note at revs 1, Hz: engine cycles a second (the V-twin fires twice in each). */
export const NOTE = { light: 110, middle: 84, heavy: 46, electric: 58 } as const;

export interface EngineSpec {
  /** Engine cycles a second at playback rate 1 (exact: the loop holds a whole number of them). */
  hz: number;
  /** Loop length, s (rounded to whole cycles). */
  seconds: number;
  /** One cycle's firings: [where in the cycle, 0..1, strength]. */
  pattern: readonly (readonly [number, number])[];
  /** Firing to firing: timing (± fraction of a period), strength spread (lognormal sigma), chance of a weak one. */
  jitter: number;
  wobble: number;
  misfire: number;
  /** The push: its rise and fall as fractions of the firing period. Narrow is buzzy, wide is round. */
  push: { rise: number; fall: number };
  /** How hard the leading edge strikes the pipe. */
  edge: number;
  /** The exhaust pipe: tube frequency, how much comes back each trip, its dullness, and the left-right difference (twin outlets). */
  pipe: { hz: number; feedback: number; damp: number; spread: number };
  /** The body's and the muffler's resonances: [Hz, Q, gain]. */
  formants: readonly (readonly [number, number, number])[];
  /** Balance heard, each part levelled first: the sub thump (its low-pass), the pipe's ringing, the gas puff, the intake roar, the valve ticks, a mechanical hiss. */
  sub: { level: number; cut: number };
  ring: number;
  gas: { low: number; high: number; level: number; decay: number };
  intake: { cut: number; level: number; decay: number };
  tick: { level: number; low: number; high: number };
  hiss: number;
  /** The periodic part of the firing sequence as a harmonic series (every multiple of the note, shaped by the pipe's and the body's resonances, each ear's upper partials in their own phase), in step with the firings' strength; its level. */
  harm?: number;
  /** Soft-clip drive: the grain of a small engine flat out. */
  drive: number;
  lowpass?: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Rotate a periodic loop (both channels together) so that its seam falls where the level on either side is closest:
 * a low hum's level swings with its phase, and a seam on the swing would be heard as a lurch once a second.
 */
export function smoothSeam(pair: Mono[], sr: number): Mono[] {
  const n = pair[0]!.length;
  const w = Math.round(0.005 * sr);
  const level = (from: number): number => {
    let sum = 0;
    for (const ch of pair) for (let i = 0; i < w; i++) sum += ch[(from + i + n) % n]! ** 2;
    return Math.sqrt(sum / (w * pair.length)) + 1e-6;
  };
  let best = 0;
  let bestJump = Infinity;
  for (let k = 0; k < 96; k++) {
    const at = Math.floor((k * n) / 96);
    const jump = Math.abs(Math.log(level(at) / level(at - w)));
    if (jump < bestJump) {
      bestJump = jump;
      best = at;
    }
  }
  return pair.map((ch) => {
    const out = new Float32Array(n);
    out.set(ch.subarray(best), 0);
    out.set(ch.subarray(0, best), n - best);
    return out;
  });
}

/** Pull a stereo pair towards its middle: the side signal times ``k`` (1 leaves it, 0 is mono). */
export function narrow(pair: Mono[], k: number): Mono[] {
  const [l, r] = pair as [Mono, Mono];
  for (let i = 0; i < l.length; i++) {
    const m = 0.5 * (l[i]! + r[i]!);
    const d = 0.5 * k * (l[i]! - r[i]!);
    l[i] = m + d;
    r[i] = m - d;
  }
  return pair;
}

/** An engine loop, [left, right]. */
export function engineLoop(t: Take, e: EngineSpec): Mono[] {
  const sr = t.sr;
  const r = t.rng;
  const per = e.pattern.length;
  const cycles = Math.max(4, Math.round(e.hz * e.seconds));
  const n = Math.round((cycles * sr) / e.hz);
  const cycleLen = n / cycles;
  const period = cycleLen / per;
  const breathe = slowWander(n, 5, () => r.next());

  // --- the firings -------------------------------------------------------------------------------------
  const at: number[] = [];
  const amp: number[] = [];
  // The loop's seam goes in the middle of the longest gap between firings, so it falls in a tail and never on an onset.
  const where = e.pattern.map((p) => p[0]).sort((x, y) => x - y);
  let seam = 0;
  let widest = -1;
  where.forEach((p, i) => {
    const gap = (where[(i + 1) % where.length]! - p + 1) % 1 || 1;
    if (gap > widest) {
      widest = gap;
      seam = p + 0.5 * gap;
    }
  });
  for (let c = 0; c < cycles; c++) {
    for (const [pos, strength] of e.pattern) {
      const k = Math.round((c + ((pos - seam + 2) % 1)) * cycleLen + r.gauss() * 0.5 * e.jitter * period);
      const wrapped = ((k % n) + n) % n;
      let a = strength * clamp(Math.exp(e.wobble * r.gauss()), 0.45, 1.8) * (1 + 0.28 * breathe[wrapped]!);
      if (r.next() < e.misfire) a *= r.range(0.25, 0.5);
      at.push(wrapped);
      amp.push(a);
    }
  }

  // --- the push (the thump) and the edge (what strikes the pipe) ------------------------------------------
  const rise = Math.max(2, Math.round(e.push.rise * period));
  const fall = Math.max(3, Math.round(e.push.fall * period));
  const shapes = [0.8, 1, 1.25].map((s) => {
    const f = Math.max(3, Math.round(fall * s));
    const len = rise + 5 * f;
    const p = new Float32Array(len);
    for (let j = 0; j < len; j++) p[j] = j < rise ? Math.pow(Math.sin((0.5 * Math.PI * j) / rise), 2) : Math.exp(-(j - rise) / f);
    return p;
  });
  const thump = new Float32Array(n);
  const edge = new Float32Array(n);
  for (let i = 0; i < at.length; i++) {
    addWrapped(thump, shapes[r.int(0, 3)]!, at[i]!, amp[i]!);
    edge[at[i]!]! += amp[i]! * e.edge;
    edge[(at[i]! + 1) % n]! -= 0.5 * amp[i]! * e.edge;
  }
  circular(thump, (twice) => lowpass(twice, sr, e.sub.cut, 2));
  normalize(thump);

  // --- the intake's roar: an envelope half a cycle behind each firing, shared by both sides -----------------
  const intakeEnv = new Float32Array(n);
  const intakeLen = Math.max(8, Math.round(e.intake.decay * period * 5));
  const intakeK = Math.exp(-1 / Math.max(1, e.intake.decay * period));
  for (let i = 0; i < at.length; i++) {
    let env = amp[i]! * r.range(0.7, 1.1);
    const start = at[i]! + Math.round(0.5 * period);
    for (let j = 0; j < intakeLen; j++) {
      intakeEnv[(start + j) % n]! += env * Math.min(1, j / 6);
      env *= intakeK;
    }
  }

  // --- the valves' ticks: shared, so they sit in the middle ---------------------------------------------------
  const ticks = new Float32Array(n);
  if (e.tick.level > 0) {
    for (let i = 0; i < at.length; i++) {
      const start = at[i]! + Math.round((0.3 + 0.1 * r.next()) * period);
      const len = Math.max(6, Math.round(0.0012 * sr));
      for (let j = 0; j < len; j++) ticks[(start + j) % n]! += amp[i]! * (2 * r.next() - 1) * Math.exp((-4 * j) / len);
    }
    circular(ticks, (twice) => bandpass(twice, sr, e.tick.low, e.tick.high, 2));
    normalize(ticks);
  }

  const puffLen = Math.max(8, Math.round(e.gas.decay * period * 5));
  const puffK = Math.exp(-1 / Math.max(1, e.gas.decay * period));
  const gasLevels = amp.map((a) => a * r.range(0.6, 1.2));
  const tune = r.range(0.97, 1.03);
  const out: Mono[] = [];

  // --- the harmonic series, lockstep with the firings' strength ------------------------------------------------------
  // Each firing's strength held between firings and eased across them: the series swells and dips as the combustion does.
  const strength = new Float32Array(n);
  if (e.harm) {
    const order = at.map((_, i) => i).sort((a, b) => at[a]! - at[b]!);
    for (let m = 0; m < order.length; m++) {
      const a = at[order[m]!]!;
      const b = m + 1 < order.length ? at[order[m + 1]!]! : at[order[0]!]! + n;
      const va = amp[order[m]!]!;
      const vb = amp[order[(m + 1) % order.length]!]!;
      for (let i = a; i < b; i++) {
        const u = (i - a) / Math.max(1, b - a);
        strength[i % n]! = 0.3 + 0.7 * (va + (vb - va) * u * u * (3 - 2 * u)) / (e.pattern.reduce((s, p) => Math.max(s, p[1]), 1));
      }
    }
  }
  const series = (side: number): Mono => {
    const sum = new Float32Array(n);
    const top = Math.min(6500, e.lowpass ?? 6500);
    const base = e.hz;
    const shape = (f: number): number => {
      let g = 0;
      for (const [hz, q, gain] of e.formants) {
        const x = (f / (hz * tune) - (hz * tune) / f) * q;
        g += gain / Math.sqrt(1 + x * x);
      }
      for (let m = 0; m < 5; m++) {
        const hz = e.pipe.hz * tune * (2 * m + 1);
        const x = (f / hz - hz / f) * 4;
        g += 0.7 * Math.pow(e.pipe.feedback, m) / Math.sqrt(1 + x * x);
      }
      return (0.15 + g) / Math.sqrt(1 + (f / top) ** 4);
    };
    for (let k = 1; base * k < top; k++) {
      const f = base * k;
      // The low partials are one engine in the middle; the upper ones are each ear's own.
      const stray = k <= 4 ? 0 : side * r.range(0, 0.55 * Math.PI) * Math.min(1, (k - 4) / 8);
      addCycles(sum, cycles * k, shape(f) / Math.pow(k, 0.35), r.range(0, TAU) * 0 + (k * 2.399963 + stray));
    }
    normalize(sum);
    times(sum, strength);
    return sum;
  };

  for (const side of [-1, 1]) {
    // The pipe rings to the firings' edges (and a little of the gas).
    const gas = new Float32Array(n);
    for (let i = 0; i < at.length; i++) {
      let env = gasLevels[i]!;
      for (let j = 0; j < puffLen; j++) {
        gas[(at[i]! + j) % n]! += env * (2 * r.next() - 1);
        env *= puffK;
      }
    }
    circular(gas, (twice) => bandpass(twice, sr, e.gas.low, e.gas.high, 2));
    normalize(gas);
    const source = new Float32Array(n);
    for (let i = 0; i < n; i++) source[i] = edge[i]! + 0.55 * gas[i]!;
    const wide = 1 + side * e.pipe.spread;
    const tube = Float32Array.from(source);
    circular(tube, (twice) => pipeResonance(twice, sr, e.pipe.hz * tune * wide, e.pipe.feedback, e.pipe.damp));
    const ring = new Float32Array(n);
    for (let i = 0; i < n; i++) ring[i] = 0.5 * tube[i]!;
    for (const [hz, q, gain] of e.formants) {
      const band = Float32Array.from(tube);
      circular(band, (twice) => biquad(twice, sr, "bandpass", hz * tune * (1 + side * e.pipe.spread * 0.7), q));
      for (let i = 0; i < n; i++) ring[i]! += gain * band[i]!;
    }
    normalize(ring);

    const roar = white(n, r);
    circular(roar, (twice) => lowpass(twice, sr, e.intake.cut, 2));
    times(roar, intakeEnv);
    normalize(roar);

    const hiss = white(n, r);
    circular(hiss, (twice) => highpass(twice, sr, 4500, 2));
    times(hiss, breathe.map((b) => 0.7 + 0.3 * b));
    normalize(hiss);

    const harmonics = e.harm ? series(side) : null;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ch[i] = (harmonics ? e.harm! * harmonics[i]! : 0) + e.sub.level * thump[i]! + e.ring * ring[i]! + e.gas.level * gas[i]! + e.intake.level * roar[i]! + e.tick.level * ticks[i]! + e.hiss * hiss[i]!;
    }
    out.push(ch);
  }
  // One level for both sides, so the picture stays where the engine put it.
  const peak = Math.max(...out.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  for (const ch of out) {
    for (let i = 0; i < n; i++) ch[i]! /= peak || 1;
    drive(ch, e.drive);
    if (e.lowpass) circular(ch, (twice) => lowpass(twice, sr, e.lowpass!, 2));
  }
  return out;
}

// --- the characters ------------------------------------------------------------------------------------------

type Character = Omit<EngineSpec, "hz" | "seconds">;

/** A light kart: a two-stroke's ring-a-ding buzz, a narrow sharp push ringing a bright expansion chamber. */
const LIGHT: Character = {
  pattern: [[0, 1]], jitter: 0.012, wobble: 0.15, misfire: 0.025,
  push: { rise: 0.05, fall: 0.12 }, edge: 1,
  pipe: { hz: 1050, feedback: 0.55, damp: 0.22, spread: 0.08 },
  formants: [[1250, 3.4, 1], [2900, 4.5, 0.6], [5400, 5, 0.25], [640, 2.5, 0.45]],
  sub: { level: 0.6, cut: 650 }, ring: 0.95,
  gas: { low: 1700, high: 7200, level: 0.17, decay: 0.16 },
  intake: { cut: 2600, level: 0.22, decay: 0.3 },
  tick: { level: 0.05, low: 3500, high: 8000 }, hiss: 0.025, harm: 0.34, drive: 2.2,
};

/** A middleweight: a punchy twin, one stroke hard and its partner half as hard, rounder, with a mid-range bark. */
const MIDDLE: Character = {
  pattern: [[0, 1], [0.5, 0.5]], jitter: 0.012, wobble: 0.17, misfire: 0.02,
  push: { rise: 0.07, fall: 0.2 }, edge: 1,
  pipe: { hz: 520, feedback: 0.58, damp: 0.28, spread: 0.09 },
  formants: [[520, 2.8, 1], [1350, 3.8, 0.65], [2700, 4.5, 0.3]],
  sub: { level: 0.8, cut: 430 }, ring: 0.85,
  gas: { low: 420, high: 3300, level: 0.16, decay: 0.24 },
  intake: { cut: 1500, level: 0.38, decay: 0.34 },
  tick: { level: 0.07, low: 2500, high: 6000 }, hiss: 0.02, harm: 0.3, drive: 1.8,
};

/** A heavyweight: a V-twin's uneven lope (two firings close, then a gap), deep, throaty, with a wide muffler's boom. */
const HEAVY: Character = {
  pattern: [[0, 1], [0.5625, 0.85]], jitter: 0.014, wobble: 0.2, misfire: 0.03,
  push: { rise: 0.1, fall: 0.3 }, edge: 0.9,
  pipe: { hz: 190, feedback: 0.64, damp: 0.38, spread: 0.1 },
  formants: [[260, 2.4, 0.7], [720, 3, 1], [1700, 3.5, 0.6], [3200, 4, 0.2]],
  sub: { level: 0.7, cut: 240 }, ring: 1,
  gas: { low: 180, high: 2700, level: 0.24, decay: 0.3 },
  intake: { cut: 1000, level: 0.5, decay: 0.4 },
  tick: { level: 0.08, low: 1800, high: 4500 }, hiss: 0.018, harm: 0.26, drive: 2, lowpass: 5200,
};

/**
 * One rev band of one engine. Higher revs open the engine up: more gas and
 * more of the pipe coming back, a tighter push.
 */
function layer(character: Character, note: number, revs: number, seconds: number): (t: Take) => Mono[] {
  return (t) => {
    const open = revs - 1;
    return engineLoop(t, {
      ...character,
      hz: note * revs,
      seconds,
      gas: { ...character.gas, level: character.gas.level * (1 + 0.45 * open) },
      pipe: { ...character.pipe, feedback: clamp(character.pipe.feedback + 0.04 * open, 0, 0.9) },
      push: { rise: character.push.rise, fall: character.push.fall * (1 - 0.18 * open) },
    });
  };
}

const SECONDS = 1.6;
export const engineLightLo = layer(LIGHT, NOTE.light, LAYER_REVS.lo, SECONDS);
export const engineLightMid = layer(LIGHT, NOTE.light, LAYER_REVS.mid, SECONDS);
export const engineLightHi = layer(LIGHT, NOTE.light, LAYER_REVS.hi, SECONDS);
export const engineMiddleLo = layer(MIDDLE, NOTE.middle, LAYER_REVS.lo, SECONDS);
export const engineMiddleMid = layer(MIDDLE, NOTE.middle, LAYER_REVS.mid, SECONDS);
export const engineMiddleHi = layer(MIDDLE, NOTE.middle, LAYER_REVS.hi, SECONDS);
export const engineHeavyLo = layer(HEAVY, NOTE.heavy, LAYER_REVS.lo, SECONDS);
export const engineHeavyMid = layer(HEAVY, NOTE.heavy, LAYER_REVS.mid, SECONDS);
export const engineHeavyHi = layer(HEAVY, NOTE.heavy, LAYER_REVS.hi, SECONDS);

// --- the robot's motor -----------------------------------------------------------------------------------------

/**
 * Rivet's electric motor: a deep whirr of the rotor's poles, the windings'
 * and the gears' whine, the drive's switching shimmer, and a second rotor a
 * whisker off (a slow beat) that sits a little differently in each ear: the
 * low partials are one motor in the middle, the whine is wide.
 */
function electric(t: Take, revs: number): Mono[] {
  const r = t.rng;
  const hz = NOTE.electric * revs;
  const unit = Math.max(4, Math.round(hz * 1.6));
  // About 1.6 s, exactly ``unit`` cycles of the note.
  const n = Math.round((unit * t.sr) / hz);
  const seconds = n / t.sr;
  const sets: [number, number, number][] = [
    // [cycles, amplitude, how far the right ear's phase strays (radians)]
    [unit, 0.8, 0.05], [unit * 2, 0.6, 0.1], [unit * 3, 0.32, 0.3], [unit * 4, 0.2, 0.6], [unit * 6, 0.14, 1.2],
    // The whine of the windings and the gears: a seventh and a thirteenth of the poles' rate up, a little sharp of them.
    [Math.round(unit * 7.02), 0.5 * r.range(0.85, 1.15), 2.2], [Math.round(unit * 9), 0.18, 2.4],
    [Math.round(unit * 13.05), 0.22 * r.range(0.85, 1.15), 2.8], [Math.round(unit * 19.1), 0.08, 3],
  ];
  const phases = sets.map(() => r.range(0, TAU));
  const beat = r.range(0, TAU);
  const wob = slowWander(n, 6, () => r.next());
  const out: Mono[] = [];
  for (const side of [-1, 1]) {
    const body = new Float32Array(n);
    sets.forEach(([cycles, a, stray], k) => addCycles(body, cycles, a, phases[k]! + (side > 0 ? stray * r.range(0.6, 1) * (r.next() < 0.5 ? -1 : 1) : 0)));
    // The second rotor beats against the first at a different rate each side.
    addCycles(body, unit + side, 0.45, beat);
    addCycles(body, 2 * unit + 2 * side, 0.2, beat * 2);
    normalize(body);
    // The drive's switching shimmer: noise in a narrow high band, breathing with the load.
    const shimmer = noiseLoop(t, seconds, (m) => bandpass(white(m, r), t.sr, 5200, 8800, 2), 0.2);
    normalize(shimmer);
    times(shimmer, wob.map((w) => 0.55 + 0.4 * w));
    const buzz = new Float32Array(n);
    const step = n / (unit * 3);
    for (let k = 0; k < unit * 3; k++) {
      const p = Math.round(k * step);
      buzz[p % n]! += 1;
      buzz[(p + 1) % n]! -= 1;
    }
    circular(buzz, (twice) => bandpass(twice, t.sr, 1200, 6000, 2));
    normalize(buzz);
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = body[i]! * (1 + 0.22 * wob[i]!) * (1 + 0.1 * Math.sin((TAU * 7 * i) / n + beat)) + 0.25 * buzz[i]! + 0.18 * shimmer[i]!;
    drive(ch, 1.3);
    out.push(ch);
  }
  return smoothSeam(out, t.sr);
}
export const engineElectricLo = (t: Take): Mono[] => electric(t, LAYER_REVS.lo);
export const engineElectricMid = (t: Take): Mono[] => electric(t, LAYER_REVS.mid);
export const engineElectricHi = (t: Take): Mono[] => electric(t, LAYER_REVS.hi);

// --- the load: rasp, rattle, idle, boost ----------------------------------------------------------------------

/**
 * The roar and rasp of an engine working hard: a burst of rough gas on every
 * firing (100 a second at rate 1, pitched to each engine's own), an intake
 * resonance in each ear, the clatter of the chain and the valves, and now and
 * then a spit. Steered up as the kart pulls, climbs or ploughs on, and away as
 * it lifts off; it is where "on throttle" brightens an engine.
 */
export function engineGrit(t: Take): Mono[] {
  const sr = t.sr;
  const r = t.rng;
  const firings = 100;
  const n = t.n(1.0);
  const period = n / firings;
  const len = Math.round(period * 1.1);
  const bursts: { at: number; env: number; k: number }[] = [];
  for (let f = 0; f < firings; f++) {
    const spit = r.next() < 0.08;
    bursts.push({
      at: Math.round(f * period + r.range(-0.04, 0.04) * period),
      env: (spit ? 1.6 : 1) * r.range(0.35, 1),
      k: spit ? Math.exp(-1 / (0.08 * period)) : Math.exp(-1 / (0.2 * period)),
    });
  }
  const rattle = new Float32Array(n);
  for (const b of bursts) {
    const click = Math.max(5, Math.round(0.001 * sr));
    for (let j = 0; j < click; j++) rattle[(((b.at + Math.round(period * 0.4) + j) % n) + n) % n]! += b.env * (2 * r.next() - 1) * Math.exp((-4 * j) / click);
  }
  circular(rattle, (twice) => bandpass(twice, sr, 2600, 7000, 2));
  normalize(rattle);
  const out: Mono[] = [];
  for (const side of [-1, 1]) {
    const ch = new Float32Array(n);
    for (const b of bursts) {
      let env = b.env;
      for (let i = 0; i < len; i++) {
        ch[(((b.at + i) % n) + n) % n]! += env * (2 * r.next() - 1);
        env *= b.k;
      }
    }
    circular(ch, (twice) => bandpass(twice, sr, 750, 5200, 2));
    const res = Float32Array.from(ch);
    circular(res, (twice) => biquad(twice, sr, "bandpass", 1500 * (1 + 0.08 * side), 3.2));
    for (let i = 0; i < n; i++) ch[i]! += 0.7 * res[i]!;
    normalize(ch);
    for (let i = 0; i < n; i++) ch[i]! += 0.22 * rattle[i]!;
    out.push(ch);
  }
  for (const ch of out) drive(ch, 1.6);
  return narrow(out, 0.7);
}

/**
 * Idling: a lumpy put-put through the same pipe and body, thirteen soft thumps
 * a second in a pattern that never quite repeats (a loose, long-short rhythm
 * with the odd weak one).
 */
export function engineIdle(t: Take): Mono[] {
  return engineLoop(t, {
    hz: 3.25, seconds: 2.0, pattern: [[0, 1], [0.25, 0.55], [0.5, 0.85], [0.75, 0.5]],
    jitter: 0.12, wobble: 0.25, misfire: 0.07,
    push: { rise: 0.12, fall: 0.5 }, edge: 0.7,
    pipe: { hz: 170, feedback: 0.6, damp: 0.4, spread: 0.1 },
    formants: [[190, 2.2, 1], [540, 3, 0.7], [1250, 3.5, 0.3]],
    sub: { level: 0.45, cut: 240 }, ring: 1.2,
    gas: { low: 200, high: 1800, level: 0.3, decay: 0.45 },
    intake: { cut: 900, level: 0.4, decay: 0.5 },
    tick: { level: 0.1, low: 1800, high: 4200 }, hiss: 0.01, drive: 1.4, lowpass: 3600,
  });
}

/** The boost growl: a deeper, heavier engine roaring under the kart's own while the nitro burns, flame in its throat. */
export function engineGrowl(t: Take): Mono[] {
  const sr = t.sr;
  const pipe = engineLoop(t, {
    hz: 56, seconds: 1.0, pattern: [[0, 1]], jitter: 0.04, wobble: 0.22, misfire: 0.04,
    push: { rise: 0.08, fall: 0.3 }, edge: 0.6,
    pipe: { hz: 230, feedback: 0.66, damp: 0.35, spread: 0.11 },
    formants: [[320, 2.2, 1], [900, 3, 0.7], [2100, 4, 0.35]],
    sub: { level: 1, cut: 300 }, ring: 0.9,
    gas: { low: 250, high: 2800, level: 0.3, decay: 0.3 },
    intake: { cut: 1100, level: 0.3, decay: 0.4 },
    tick: { level: 0, low: 1800, high: 4500 }, hiss: 0.02, drive: 3.4, lowpass: 3800,
  });
  // The flame: a rushing roar, pulsing on the firings, different in each ear.
  const n = pipe[0]!.length;
  return pipe.map((ch) => {
    const flame = noiseLoop(t, n / sr, (m) => bandpass(white(m, t.rng), sr, 500, 4200, 2), 0.2);
    normalize(flame);
    for (let i = 0; i < n; i++) ch[i]! += 0.28 * flame[i]! * (0.6 + 0.4 * Math.sin((TAU * 56 * i) / sr));
    return ch;
  });
}

/**
 * The exhaust's overrun crackle on lifting off at high revs: a burst of pops
 * in the pipe that thins out as the unburnt fuel runs out, each a little
 * thump, a crack and the pipe's ring, scattered across the stereo field.
 */
export function overrunCrackle(t: Take): Mono[] {
  const sr = t.sr;
  const r = t.rng;
  const seconds = 0.9;
  const n = t.n(seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const count = 7 + r.int(0, 4);
  let when = 0.01;
  for (let k = 0; k < count; k++) {
    const strength = (1 - 0.55 * (k / count)) * r.range(0.6, 1.1);
    const pan = r.range(-0.85, 0.85);
    const len = t.n(0.09);
    const pop = new Float32Array(len);
    // A thump, a crack, and the pipe ringing after it.
    addMode(pop, sr, 0, r.range(90, 150), 0.8, 0.018, r.range(0, TAU));
    const crack = white(Math.round(0.005 * sr), r);
    for (let i = 0; i < crack.length; i++) pop[i]! += 0.9 * crack[i]! * Math.exp((-5 * i) / crack.length);
    addMode(pop, sr, 0, r.range(900, 1700) * t.p, 0.25, 0.012, r.range(0, TAU));
    const lg = Math.cos(((pan + 1) * Math.PI) / 4);
    const rg = Math.sin(((pan + 1) * Math.PI) / 4);
    const start = t.n(when);
    for (let i = 0; i < len && start + i < n; i++) {
      left[start + i]! += strength * lg * pop[i]!;
      right[start + i]! += strength * rg * pop[i]!;
    }
    when += r.range(0.025, 0.055) * (1 + 1.6 * (k / count));
  }
  return [left, right];
}

/**
 * A gear change: the clutch's clunk, the revs cut off and a bark as the next
 * gear takes the load, a pop of the exhaust at the end of it.
 */
export function gearBark(t: Take): Mono[] {
  const sr = t.sr;
  const r = t.rng;
  const n = t.n(0.22);
  const make = (): Mono => {
    const out = new Float32Array(n);
    addMode(out, sr, 0, 78 * t.p, 0.8, 0.03, r.range(0, TAU));
    const clunk = lowpass(white(t.n(0.02), r), sr, 900, 2);
    for (let i = 0; i < clunk.length; i++) out[i]! += 0.5 * clunk[i]! * Math.exp((-5 * i) / clunk.length);
    // The bark: a short rasp rising in pitch as the revs catch.
    const rasp = bandpass(white(t.n(0.1), r), sr, 800, 3200, 2);
    for (let i = 0; i < rasp.length; i++) {
      const u = i / rasp.length;
      out[t.n(0.05) + i]! += 0.55 * rasp[i]! * Math.sin(Math.PI * u) * (0.4 + 0.6 * u);
    }
    return out;
  };
  return [make(), make()];
}
