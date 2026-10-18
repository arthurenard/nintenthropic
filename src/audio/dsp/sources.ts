/**
 * The raw materials: noise, sweeps, ringing modes, plucked strings and a
 * throat. Recipes combine these, shape them with envelopes and filters, and
 * place them on a canvas.
 */
import type { Rng } from "./rng";
import { bandpass, svf, type Track } from "./filters";
import { type Mono, normalize, samples } from "./signal";

/** White noise, uniform in [-1, 1). */
export function white(n: number, rng: Rng): Mono {
  return rng.fill(new Float32Array(n));
}

/** Pink noise (−3 dB/octave), Paul Kellet's economy filter, unit-ish peak. */
export function pink(n: number, rng: Rng): Mono {
  const out = rng.fill(new Float32Array(n));
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = out[i]!;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return out;
}

/** Brown noise (−6 dB/octave): leaky integrated white noise. */
export function brown(n: number, rng: Rng): Mono {
  const out = rng.fill(new Float32Array(n));
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.997 * y + 0.06 * out[i]!;
    out[i] = y;
  }
  return out;
}

/** Band-limited noise between ``low`` and ``high`` Hz, unit peak. */
export function bandNoise(n: number, sr: number, rng: Rng, low: number, high: number, order = 2): Mono {
  return normalize(bandpass(white(n, rng), sr, low, high, order));
}

/**
 * A sine whose frequency glides from ``f0`` to ``f1`` (exponentially, with
 * the progress bent by ``curve``: below 1 falls fast then settles, like a
 * drum's pitch or a gun's thump).
 */
export function chirp(n: number, sr: number, f0: number, f1: number, curve = 1, phase = 0): Mono {
  const out = new Float32Array(n);
  let ph = phase;
  const ratio = f1 / f0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    // The glide is re-aimed every 16 samples: two powers per sample were a
    // real share of every boom and thump in the library.
    if ((i & 15) === 0) {
      const u = Math.pow(i / Math.max(1, n - 1), curve);
      w = (2 * Math.PI * f0 * Math.pow(ratio, u)) / sr;
    }
    out[i] = Math.sin(ph);
    ph += w;
  }
  return out;
}

/** A sine following a frequency track (Hz per sample, or a function of u = 0..1). */
export function sweep(n: number, sr: number, freq: Track, phase = 0): Mono {
  const out = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const f = typeof freq === "number" ? freq : typeof freq === "function" ? freq(i / n) : freq[i]!;
    out[i] = Math.sin(ph);
    ph += (2 * Math.PI * f) / sr;
  }
  return out;
}

/**
 * Add one exponentially decaying partial into ``out`` at ``at`` seconds: the
 * atom of anything that rings (a bell, a bottle, a plank). Computed with the
 * two-multiply recursive oscillator (a resonator driven by an impulse), which
 * is exact and several times cheaper than a sine per sample, and stopped once
 * it has fallen 80 dB so long tails cost nothing past audibility.
 */
export function addMode(
  out: Mono,
  sr: number,
  at: number,
  freq: number,
  amp: number,
  tau: number,
  phase = 0,
): void {
  const start = Math.round(at * sr);
  if (start >= out.length || freq <= 0 || freq >= sr * 0.49 || amp === 0) return;
  const w = (2 * Math.PI * freq) / sr;
  const r = Math.exp(-1 / Math.max(1, tau * sr));
  const c = 2 * r * Math.cos(w);
  const r2 = r * r;
  let y2 = amp * Math.sin(phase - w) / r; // y[-1]
  let y1 = amp * Math.sin(phase); // y[0]
  const end = Math.min(out.length, start + Math.ceil(tau * sr * 9.2));
  for (let i = start < 0 ? 0 : start; i < end; i++) {
    out[i]! += y1;
    const y = c * y1 - r2 * y2;
    y2 = y1;
    y1 = y;
  }
}

/**
 * A small struck piece of metal: a short inharmonic stack (the ratios of a
 * free plate) with a bright noise edge, the upper modes dying first.
 */
export function addMetal(
  out: Mono,
  sr: number,
  rng: Rng,
  at: number,
  base: number,
  tau: number,
  amp = 1,
  ratios: readonly number[] = [1, 1.47, 2.09, 2.56, 3.3],
): void {
  ratios.forEach((ratio, k) => {
    const f = base * ratio * (1 + rng.range(-0.01, 0.01));
    addMode(out, sr, at, f, amp * Math.pow(0.7, k), tau * Math.pow(0.75, k), rng.range(0, 6.28));
  });
  const edge = bandNoise(samples(sr, 0.004), sr, rng, base * 0.8, Math.min(base * 5, 18000), 2);
  decayInPlace(edge, sr, 0.0002, 0.0012);
  const start = Math.round(at * sr);
  for (let i = 0; i < edge.length && start + i < out.length; i++) out[start + i]! += 0.8 * amp * edge[i]!;
}

/** The transient edge: a few milliseconds of bright noise, sharply enveloped. */
export function click(sr: number, rng: Rng, width = 0.003, low = 800, high = 12000): Mono {
  const burst = bandNoise(samples(sr, width), sr, rng, low, high, 2);
  return decayInPlace(burst, sr, 0.0002, width / 3);
}

/** Rise over ``attack`` then decay with time constant ``tau`` (in place). */
export function decayInPlace(buf: Mono, sr: number, attack: number, tau: number): Mono {
  const a = Math.max(1, attack * sr);
  const k = Math.exp(-1 / Math.max(1, tau * sr));
  let e = 1;
  for (let i = 0; i < buf.length; i++) {
    buf[i]! *= (i < a ? i / a : 1) * e;
    e *= k;
  }
  return buf;
}

export interface StringOptions {
  /** Seconds for the fundamental to fall 60 dB. */
  t60: number;
  /** 0 (dull, every harmonic damped hard) .. 1 (bright, the loop filter nearly flat). */
  brightness?: number;
  /** Where along the string it is struck, 0..0.5: a comb that removes those harmonics. */
  position?: number;
  /** The excitation; noise shaped by the options when omitted. */
  excitation?: Mono;
  /** Low-pass of the default noise excitation, Hz: the felt of a hammer, the flesh of a finger. */
  hardness?: number;
  /**
   * Strike with a smooth pulse this many seconds wide (a felt hammer)
   * instead of a period of noise (a pick or a finger). Narrower is harder.
   */
  pulse?: number;
  /** Stop after this many seconds (a damper), with a short release. */
  length?: number;
  /** Seconds of the damped release after ``length``. */
  release?: number;
}

/**
 * A plucked or struck string: an extended Karplus–Strong loop. A delay line
 * one period long, a two-tap loop filter whose gain sets the decay and whose
 * balance sets how fast the upper harmonics die, and a first-order all-pass
 * that tunes the fractional part of the period exactly — without it a
 * detuned piano unison would be out by whole cents at the top of the range.
 * Costs a few operations per sample however many harmonics it has.
 */
export function addString(out: Mono, sr: number, rng: Rng, at: number, freq: number, amp: number, o: StringOptions): void {
  const start = Math.round(at * sr);
  if (start >= out.length) return;
  const brightness = Math.min(Math.max(o.brightness ?? 0.5, 0), 1);
  // Loop filter y = g((1-s)x + s x[-1]): s = 0.5 is the classic average
  // (darkest), s → 0 leaves the loop nearly flat (brightest).
  const s = 0.5 - 0.45 * brightness;
  const period = sr / freq;
  // The loop filter delays by s samples; the all-pass carries the rest of the fraction.
  const total = period - s;
  let N = Math.floor(total - 0.1);
  let frac = total - N;
  if (frac < 0.1) {
    N -= 1;
    frac += 1;
  }
  N = Math.max(2, N);
  const C = (1 - frac) / (1 + frac);
  // Per-period gain for the requested T60, divided by the loop filter's own
  // loss at the fundamental.
  const w = (2 * Math.PI * freq) / sr;
  const hMag = Math.sqrt((1 - s) * (1 - s) + s * s + 2 * s * (1 - s) * Math.cos(w));
  const g = Math.min(0.99995, Math.pow(10, -3 / (freq * Math.max(o.t60, 0.01))) / Math.max(hMag, 1e-6));

  // The excitation: one period of noise (or the given burst), low-passed
  // for the hardness of what struck it and combed for where it struck.
  const line = new Float32Array(N);
  if (o.excitation) {
    for (let i = 0; i < N; i++) line[i] = o.excitation[i % o.excitation.length]!;
  } else if (o.pulse) {
    // A raised-cosine bump (the felt's contact), with a trace of noise for
    // the texture of the strike.
    const w = Math.min(N - 1, Math.max(2, o.pulse * sr));
    const c = N / 2;
    for (let i = 0; i < N; i++) {
      const x = (i - c) / w;
      line[i] = (Math.abs(x) < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * x) : 0) + 0.06 * (2 * rng.next() - 1);
    }
  } else {
    for (let i = 0; i < N; i++) line[i] = 2 * rng.next() - 1;
    const hard = o.hardness ?? 6000;
    const a = Math.exp((-2 * Math.PI * hard) / sr);
    let y = 0;
    // Two passes round the period, so the filter's start-up is not a step.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        y = (1 - a) * line[i]! + a * y;
        if (pass === 1) line[i] = y;
      }
    }
  }
  const position = o.position ?? 0;
  if (position > 0) {
    const d = Math.max(1, Math.round(position * N));
    const copy = Float32Array.from(line);
    for (let i = 0; i < N; i++) line[i] = copy[i]! - copy[(i - d + N) % N]!;
  }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += line[i]!;
  mean /= N;
  let p = 0;
  for (let i = 0; i < N; i++) {
    line[i]! -= mean;
    p = Math.max(p, Math.abs(line[i]!));
  }
  const norm = p > 0 ? amp / p : 0;
  for (let i = 0; i < N; i++) line[i]! *= norm;

  const length = o.length ?? o.t60;
  const release = o.release ?? 0.08;
  const stopAt = Math.round(length * sr);
  const end = Math.min(out.length - start, stopAt + Math.round(release * 6 * sr), Math.round(o.t60 * 1.2 * sr));
  const relK = Math.exp(-1 / Math.max(1, release * sr));
  let idx = 0;
  let prev = 0; // the loop filter's previous input
  let apX = 0; // all-pass state
  let apY = 0;
  let damp = 1;
  for (let i = 0; i < end; i++) {
    const x = line[idx]!;
    const lf = g * ((1 - s) * x + s * prev);
    prev = x;
    const ap = C * lf + apX - C * apY;
    apX = lf;
    apY = ap;
    line[idx] = ap;
    idx = idx + 1 === N ? 0 : idx + 1;
    if (i >= stopAt) damp *= relK;
    out[start + i]! += x * damp;
  }
}

/**
 * A throat: a glottal pulse train on a pitch track, with jitter (cycle to
 * cycle pitch wobble), shimmer (level wobble) and breath noise riding each
 * cycle. The pulse is a Rosenberg shape — a smooth opening and a quicker
 * closing — whose derivative is what the vocal tract is excited by; its
 * sharp closure is what gives a voice its buzz.
 */
export function glottal(
  n: number,
  sr: number,
  rng: Rng,
  f0: Track,
  o: { jitter?: number; shimmer?: number; breath?: number; open?: number; tension?: Track } = {},
): Mono {
  const out = new Float32Array(n);
  const jitter = o.jitter ?? 0.02;
  const shimmer = o.shimmer ?? 0.1;
  const breath = o.breath ?? 0.2;
  let phase = 0;
  let cycleJ = 1;
  let cycleA = 1;
  let prevFlow = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const base = typeof f0 === "number" ? f0 : typeof f0 === "function" ? f0(u) : f0[i]!;
    // The open quotient: how much of each cycle the folds are apart. A
    // pressed, strained voice (tension → 1) closes sooner and buzzes harder.
    const tension = o.tension === undefined ? 0.5
      : typeof o.tension === "number" ? o.tension
      : typeof o.tension === "function" ? o.tension(u) : o.tension[i]!;
    const open = (o.open ?? 0.65) * (1.15 - 0.5 * tension);
    phase += (base * cycleJ) / sr;
    if (phase >= 1) {
      phase -= 1;
      cycleJ = 1 + jitter * (2 * rng.next() - 1);
      cycleA = 1 + shimmer * (2 * rng.next() - 1);
    }
    const rise = open * 0.62;
    let flow: number;
    if (phase < rise) flow = 0.5 - 0.5 * Math.cos((Math.PI * phase) / rise);
    else if (phase < open) flow = Math.cos((0.5 * Math.PI * (phase - rise)) / (open - rise));
    else flow = 0;
    // The flow's slope, scaled by the period so a low voice and a high one
    // reach the same level (a closure over more samples is a gentler slope).
    const d = (flow - prevFlow) * cycleA * (sr / Math.max(base, 20)) * 0.15;
    prevFlow = flow;
    // Breath: noise that is loudest while the folds are open.
    out[i] = d + breath * (2 * rng.next() - 1) * (0.25 + flow);
  }
  return out;
}

export interface Formant {
  /** Centre frequency: fixed, per sample, or a function of u = 0..1. */
  freq: Track;
  /** Bandwidth-ish Q. */
  q: number;
  amp: number;
}

/** A vocal tract: parallel resonances, each band-passed and summed at its level. */
export function formants(src: Mono, sr: number, list: Formant[]): Mono {
  const out = new Float32Array(src.length);
  for (const f of list) {
    const band = svf(Float32Array.from(src), sr, "bp", f.freq, f.q, 32);
    for (let i = 0; i < out.length; i++) out[i]! += f.amp * band[i]!;
  }
  return out;
}

/** PolyBLEP: the correction that removes a sawtooth's or a pulse's aliasing at each jump. */
export function polyBlep(ph: number, dt: number): number {
  if (ph < dt) {
    const x = ph / dt;
    return x + x - x * x - 1;
  }
  if (ph > 1 - dt) {
    const x = (ph - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * A band-limited sawtooth (``width`` 0) or pulse (``width`` 0..1, the
 * difference of two saws) following a frequency track: the buzz of a reed.
 */
export function saw(n: number, sr: number, freq: Float32Array | number, width = 0, phase = 0): Mono {
  const out = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const f = typeof freq === "number" ? freq : freq[i]!;
    const dt = f / sr;
    let v = 2 * ph - 1 - polyBlep(ph, dt);
    if (width > 0) {
      let p2 = ph + width;
      if (p2 >= 1) p2 -= 1;
      v -= 2 * p2 - 1 - polyBlep(p2, dt);
    }
    out[i] = v;
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return out;
}
