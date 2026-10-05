/**
 * The sounds a Grip Prix kart makes while it moves: four engines of different
 * character, an idle, a growl for boost, the drift's squeal, the sound of each
 * surface under the wheels, a homing puck's whistle and the rescue drone's
 * rotors. All are loops, and all are steered at run time (the engine's pitch
 * follows the speedometer by playback rate), so each is built to be heard
 * stretched to a half and doubled.
 *
 * The tonal loops are periodic by construction: every component is a whole
 * number of cycles in the loop, so the seam is exactly as smooth as any other
 * moment. The textures are cross-faded or wrapped noise.
 */
import { bandpass, highpass, lowpass } from "../dsp/filters";
import { type Mono, normalize } from "../dsp/signal";
import { addMode, bandNoise, brown, pink, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { bubble } from "./kit";
import { TAU, addWrapped, calmSeam, circular, cyclic, drive, expo, grains, noiseLoop, times, tone } from "./kart-kit";

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

/** A gaussian bump, for shaping a harmonic series with formants. */
const bump = (x: number, centre: number, width: number): number => Math.exp(-(((x - centre) / width) ** 2));

interface EngineRecipe {
  /** Fundamental (firing frequency) at playback rate 1, Hz. */
  f0: number;
  /** Loop length, seconds. */
  seconds: number;
  /** Harmonic amplitudes by number (k from 1), and the highest. */
  harmonic: (k: number, hz: number) => number;
  maxK: number;
  /** Phase of every harmonic: 0 aligns them into a pulse, ±π/2 into a saw. */
  phase: number;
  /** Subharmonics: [fraction of f0 (1/2, 1/4...), amp]. */
  subs?: [number, number][];
  /** Amplitude modulation at a fraction of f0 (the rattle), depth 0..1. */
  rattle?: { fraction: number; depth: number };
  /** Soft-clip drive. */
  drive: number;
  /** The exhaust: noise in this band, gated by each firing, at this level and sharpness. */
  noise: { low: number; high: number; level: number; sharp: number };
  /** Low-pass over everything, Hz (0 for none). */
  lowpass?: number;
}

function engine(t: Take, r: EngineRecipe): Mono {
  const n = t.n(r.seconds);
  // The take's pitch wanders a little: four takes, four slightly different engines.
  // An even number of cycles lets the subharmonics fit the loop.
  const unit = Math.max(4, Math.round(r.f0 * t.p * r.seconds / 4) * 4);
  const parts: Part[] = [];
  for (let k = 1; k <= r.maxK; k++) {
    const hz = (unit / r.seconds) * k;
    const amp = r.harmonic(k, hz);
    if (amp > 1e-3) parts.push({ cycles: unit * k, amp, phase: r.phase });
  }
  for (const [fraction, amp] of r.subs ?? []) parts.push({ cycles: Math.round(unit * fraction), amp, phase: 0.4 });
  const body = sumParts(n, parts);
  if (r.rattle) {
    const mod = cyclic(n, Math.round(unit * r.rattle.fraction), r.rattle.depth, t.rng.range(0, TAU));
    times(body, mod);
  }
  // Exhaust noise, a puff on each firing.
  const noise = noiseLoop(t, r.seconds, (m) => bandNoise(m, t.sr, t.rng, r.noise.low, r.noise.high, 2));
  const puff = new Float32Array(n);
  for (let i = 0; i < n; i++) puff[i] = Math.pow(0.5 + 0.5 * Math.cos((TAU * unit * i) / n), r.noise.sharp);
  times(noise, puff);
  normalize(body);
  for (let i = 0; i < n; i++) body[i] = body[i]! + r.noise.level * noise[i]!;
  drive(body, r.drive);
  if (r.lowpass) circular(body, (twice) => lowpass(twice, t.sr, r.lowpass!, 2));
  return calmSeam(body);
}

/** Engine A: a two-stroke buzz, bright and busy. */
export function engineBuzz(t: Take): Mono {
  return engine(t, {
    f0: 105, seconds: 0.9, harmonic: (k) => 1 / k ** 0.95, maxK: 28, phase: 0.0,
    rattle: { fraction: 0.5, depth: 0.3 }, drive: 1.8, noise: { low: 600, high: 4200, level: 0.28, sharp: 2 },
  });
}

/** Engine B: a four-stroke putt, round and lopsided. */
export function enginePutt(t: Take): Mono {
  return engine(t, {
    f0: 66, seconds: 1.0, harmonic: (k) => Math.exp(-k / 4.5), maxK: 18, phase: -0.6,
    subs: [[0.5, 0.75], [1.5, 0.28]], rattle: { fraction: 0.25, depth: 0.25 }, drive: 1.5,
    noise: { low: 150, high: 900, level: 0.4, sharp: 3 }, lowpass: 2600,
  });
}

/** Engine C: an electric whirr, nearly pure, with a rising whine. */
export function engineWhirr(t: Take): Mono {
  const n = t.n(0.8);
  const unit = Math.max(4, Math.round(165 * t.p * 0.8));
  const parts: Part[] = [
    { cycles: unit, amp: 1, phase: 0 },
    { cycles: unit * 2, amp: 0.38, phase: 1.1 },
    { cycles: unit * 3, amp: 0.2, phase: 2.3 },
    { cycles: unit * 4, amp: 0.09, phase: 0.2 },
    // A second rotor a whisker off: slow beating.
    { cycles: unit + 1, amp: 0.55, phase: 0.7 },
    { cycles: 2 * (unit + 1), amp: 0.2, phase: 2 },
    // The whine, from the motor's windings.
    { cycles: Math.round(unit * 5.5), amp: 0.22, phase: 0.3 },
    { cycles: Math.round(unit * 11), amp: 0.08, phase: 1.3 },
  ];
  const body = normalize(sumParts(n, parts));
  // A little phase modulation at a low rate: a living pitch.
  const wob = sumParts(n, [{ cycles: 3, amp: 1, phase: 0 }]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i]! * (1 + 0.06 * wob[i]!);
  const air = noiseLoop(t, 0.8, (m) => bandNoise(m, t.sr, t.rng, 1500, 7000, 2));
  for (let i = 0; i < n; i++) out[i]! += 0.05 * air[i]!;
  return out;
}

/** Engine D: a raspy square-wave rattle, nasal. */
export function engineRasp(t: Take): Mono {
  return engine(t, {
    f0: 90, seconds: 1.0,
    harmonic: (k, hz) => (k % 2 === 1 ? (1 / k) * (1 + 3 * bump(hz, 900, 260) + 2.2 * bump(hz, 2300, 500)) : 0),
    maxK: 41, phase: 0, rattle: { fraction: 0.25, depth: 0.4 }, drive: 2.4,
    noise: { low: 1000, high: 5000, level: 0.3, sharp: 1.5 },
  });
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

/** The boost growl: a deeper, heavier engine for when the nitro is on. */
export function engineGrowl(t: Take): Mono {
  return engine(t, {
    f0: 56, seconds: 1.0, harmonic: (k) => 1 / k ** 0.8, maxK: 30, phase: -1.2,
    subs: [[0.5, 0.5]], rattle: { fraction: 0.5, depth: 0.45 }, drive: 4,
    noise: { low: 100, high: 1400, level: 0.45, sharp: 2 }, lowpass: 3800,
  });
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
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = squeal[i]! * 0.8 + hiss[i]! * 0.5;
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
  const body = noiseLoop(t, seconds, (m) => lowpass(brown(m, t.rng), t.sr, 420, 2), 0.3);
  normalize(body);
  times(body, cyclic(n, 3, 0.6, t.rng.range(0, TAU)));
  const pops = grains(t, seconds, 9, (s) => {
    const g = bubble(t, t.rng.range(140, 520), t.rng.range(0.012, 0.03), 1.8);
    return g.length > 0 ? g : new Float32Array(1);
  });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i]! * 0.7 + pops[i]! * 0.8;
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
