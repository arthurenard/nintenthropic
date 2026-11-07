/**
 * The band's richer instruments, built on the engines of src/audio/dsp/voices.ts
 * and added to by a few of their own:
 *
 *   layer    several voices struck together (a slap bass is a thumb and a pop)
 *   shaped   a voice followed by a filter, a drive or a bark
 *   guitar   a Karplus-Strong string with a wooden body and a pick's click
 *   rhodes   a tine electric piano: two FM pairs, a bark and a hammer thunk
 *   buzz     the one engine behind brass, reeds, supersaws, string sections and
 *            a choir: stacked band-limited saws through a moving filter, with
 *            a scoop, a swell, a late vibrato and a breath
 *
 * Everything is deterministic from the note's Rng, and runs in a Worker, on the
 * main thread and in Node alike.
 */
import { biquad } from "../../../audio/dsp/filters";
import { type Mono, samples } from "../../../audio/dsp/signal";
import { addString, polyBlep } from "../../../audio/dsp/sources";
import { type NoteSpec, type Voice, softClip } from "../../../audio/dsp/voices";

const TAU = 2 * Math.PI;

// --- combinators -------------------------------------------------------------------------------

export interface LayerPart {
  voice: Voice;
  gain?: number;
  /** Frequency multiplier (2 an octave up). */
  mult?: number;
  /** Seconds late. */
  at?: number;
  /** Seconds the key is held for this layer (default the note's). */
  hold?: number;
}

/** Several voices struck at once, summed. */
export function layer(...parts: LayerPart[]): Voice {
  const voice: Voice = (note) => {
    const bufs = parts.map((p, k) => ({
      p,
      buf: p.voice({ ...note, freq: note.freq * (p.mult ?? 1), hold: p.hold ?? note.hold, rng: note.rng.fork(`layer${k}`) }),
    }));
    let total = 8;
    for (const { p, buf } of bufs) total = Math.max(total, buf.length + Math.round((p.at ?? 0) * note.sr));
    const out = new Float32Array(total);
    for (const { p, buf } of bufs) {
      const at = Math.round((p.at ?? 0) * note.sr);
      const g = p.gain ?? 1;
      for (let i = 0; i < buf.length; i++) out[at + i]! += g * buf[i]!;
    }
    return out;
  };
  voice.ignoresHold = parts.every((p) => p.voice.ignoresHold);
  return voice;
}

/** A voice with something done to its buffer afterwards. */
export function shaped(voice: Voice, post: (buf: Mono, note: NoteSpec) => void): Voice {
  const out: Voice = (note) => {
    const buf = voice(note);
    post(buf, note);
    return buf;
  };
  out.ignoresHold = voice.ignoresHold;
  return out;
}

/** Drive a buffer through a soft clip with makeup, keeping its peak where it was. */
export function drive(buf: Mono, amount: number): void {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]!));
  if (p === 0) return;
  const k = amount / p;
  const makeup = p / softClip(amount);
  for (let i = 0; i < buf.length; i++) buf[i] = softClip(buf[i]! * k) * makeup;
}

// --- strings -----------------------------------------------------------------------------------

export interface GuitarSpec {
  /** Seconds to fall 60 dB. */
  t60: number;
  /** 0 dull .. 1 bright (the loop's damping). */
  brightness: number;
  /** The pick or the finger, Hz (low-pass of the strike). */
  hardness: number;
  /** Where along the string it is struck, 0..0.5. */
  position: number;
  /** Seconds a held string takes to be stopped by the hand when the key goes up (0 rings). */
  damp: number;
  /** The wooden body: resonances [Hz, Q, dB]. */
  body?: readonly (readonly [number, number, number])[];
  /** A pick's click, 0..1. */
  click?: number;
  /** A second string a few cents away (twelve-string, a double-stopped pair) and its level. */
  double?: { cents: number; level: number };
}

/** A plucked string with a body: guitars, a ukulele, a mandolin, a banjo, a harp. */
export function guitar(spec: GuitarSpec): Voice {
  return ({ sr, freq, hold, vel, rng }) => {
    const length = spec.damp > 0 ? Math.min(spec.t60, hold + spec.damp * 4) : spec.t60;
    const total = Math.max(32, samples(sr, length + 0.06));
    const out = new Float32Array(total);
    const amp = 0.6 + 0.4 * vel;
    const o = {
      t60: spec.t60,
      brightness: Math.min(1, spec.brightness * (0.6 + 0.5 * vel)),
      position: spec.position,
      hardness: spec.hardness * (0.7 + 0.6 * vel),
      length: spec.damp > 0 ? hold : spec.t60,
      release: Math.max(0.02, spec.damp),
    };
    addString(out, sr, rng, 0, freq, amp, o);
    if (spec.double) addString(out, sr, rng, 0, freq * Math.pow(2, spec.double.cents / 1200), amp * spec.double.level, o);
    if (spec.body) {
      const body = Float32Array.from(out);
      for (const [f, q, db] of spec.body) biquad(body, sr, "peak", f, q, db);
      // The body's resonances, mixed over the string: the wood answering.
      for (let i = 0; i < total; i++) out[i] = 0.55 * out[i]! + 0.55 * body[i]!;
    }
    if (spec.click) {
      const n = Math.min(total, samples(sr, 0.012));
      let lp = 0;
      const a = Math.exp((-TAU * 5000) / sr);
      for (let i = 0; i < n; i++) {
        lp = (1 - a) * (rng.next() * 2 - 1) + a * lp;
        out[i]! += spec.click * 0.9 * lp * Math.exp(-i / (0.0018 * sr)) * (0.4 + 0.6 * vel);
      }
    }
    riseIn(out, sr);
    const fade = Math.min(total >> 1, 64);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

/** A 1.2 ms rise at the start of a plucked note: the strike is still sharp, but a note on the first beat of a loop does not open it with a step. */
export function riseIn(buf: Mono, sr: number, seconds = 0.0012): void {
  const n = Math.min(buf.length >> 1, Math.max(2, Math.round(seconds * sr)));
  for (let i = 0; i < n; i++) buf[i]! *= i / n;
}

// --- electric piano ----------------------------------------------------------------------------

export interface RhodesSpec {
  /** Seconds for the body to fall by e (a middle C). */
  tau: number;
  /** The warm part of the tone: modulation index of the 1:1 pair. */
  warm: number;
  /** The tine's bark at the strike: modulation index of the 14:1 pair. */
  bark: number;
  /** Seconds the bark takes to die. */
  barkTau?: number;
  /** Soft-clip drive, 1 clean. */
  drive?: number;
  release?: number;
}

/** A tine electric piano. Two FM pairs on one carrier, a hammer thunk, higher notes shorter as on the real thing. */
export function rhodes(spec: RhodesSpec): Voice {
  return ({ sr, freq, hold, vel, rng }) => {
    const tau = spec.tau * Math.pow(261.6 / freq, 0.45);
    const release = spec.release ?? 0.2;
    const total = Math.max(32, samples(sr, Math.min(hold + release, tau * 6.5) + 0.03));
    const out = new Float32Array(total);
    const holdN = samples(sr, hold);
    const wc = (TAU * freq) / sr;
    let pc = 0;
    let p1 = 0;
    let p2 = 0;
    let i1 = spec.warm * (0.6 + 0.6 * vel);
    let i2 = spec.bark * (0.4 + 0.9 * vel);
    const k1 = Math.exp(-1 / (tau * 0.5 * sr));
    const k2 = Math.exp(-1 / ((spec.barkTau ?? 0.04) * sr));
    const ka = Math.exp(-1 / (tau * sr));
    const kr = Math.exp(-6.9 / (release * sr));
    let amp = 1;
    let rel = 1;
    for (let i = 0; i < total; i++) {
      const s = Math.sin(pc + i1 * Math.sin(p1) + i2 * Math.sin(p2)) + 0.12 * Math.sin(2 * pc + 0.5 * i1 * Math.sin(p1));
      pc += wc;
      p1 += wc;
      p2 += wc * 14;
      i1 *= k1;
      i2 *= k2;
      amp *= ka;
      if (i >= holdN) rel *= kr;
      out[i] = s * amp * rel * Math.min(1, i / 24);
    }
    // The hammer's thunk.
    const n = Math.min(total, samples(sr, 0.03));
    let lp = 0;
    const a = Math.exp((-TAU * 900) / sr);
    for (let i = 0; i < n; i++) {
      lp = (1 - a) * (rng.next() * 2 - 1) + a * lp;
      out[i]! += 0.35 * lp * Math.exp(-i / (0.006 * sr));
    }
    if (spec.drive && spec.drive > 1) drive(out, spec.drive);
    const g = 0.3 + 0.7 * vel;
    for (let i = 0; i < total; i++) out[i]! *= g;
    const fade = Math.min(total >> 1, 32);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

// --- the stacked-saw engine --------------------------------------------------------------------

export interface BuzzSpec {
  /** Voices in the stack, spread evenly over ±``spread`` cents. */
  saws: number;
  spread: number;
  /** A square an octave down, level. */
  sub?: number;
  /** Pulse width instead of saws (0 for saws). */
  pulse?: number;
  /** Filter cutoff: ``base`` Hz plus ``track`` times the pitch, opened by ``open`` octaves over ``swell`` seconds then settling to ``rest`` of it. */
  base: number;
  track: number;
  open: number;
  swell: number;
  rest: number;
  q: number;
  /** Level envelope. */
  attack: number;
  release: number;
  /** The note starts this many semitones off the pitch and slides in over ``scoopTime``. */
  scoop?: number;
  scoopTime?: number;
  vibrato?: { rate: number; depth: number; delay: number };
  /** Slow breathing of the level (bellows, a section's swell), rate Hz and depth 0..1. */
  tremolo?: { rate: number; depth: number };
  breath?: number;
  /** A mid bump of the throat, [Hz, dB]. */
  formant?: readonly [number, number];
  /** Vowel formants [Hz, level] for a choir, mixed at ``vowelMix``. */
  vowel?: readonly (readonly [number, number])[];
  vowelMix?: number;
  drive?: number;
  /** Louder notes are brighter by this many octaves of cutoff. */
  velBright?: number;
}

/** Brass, reeds, supersaws, string sections and choirs: one engine, different numbers. */
export function buzz(spec: BuzzSpec): Voice {
  return ({ sr, freq, hold, vel, rng }) => {
    const total = Math.max(32, samples(sr, hold + spec.release));
    const out = new Float32Array(total);
    const holdN = Math.min(total, samples(sr, hold));
    const n = spec.saws;
    const phase = new Float64Array(n);
    const ratio = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      phase[k] = rng.next();
      ratio[k] = Math.pow(2, (n === 1 ? 0 : spec.spread * (2 * (k / (n - 1)) - 1)) / 1200);
    }
    let subPh = rng.next();
    const attackN = Math.max(1, spec.attack * sr);
    const relK = Math.exp(-6.9 / Math.max(1, spec.release * sr));
    const vib = spec.vibrato;
    const vibW = vib ? (TAU * vib.rate) / sr : 0;
    let lfo = rng.next() * TAU;
    const trem = spec.tremolo;
    const tremW = trem ? (TAU * trem.rate) / sr : 0;
    const tph = rng.next() * TAU;
    const scoop = spec.scoop ?? 0;
    const scoopN = Math.max(1, (spec.scoopTime ?? 0.05) * sr);
    const velOct = (spec.velBright ?? 0.6) * (vel - 0.7);
    const baseCut = (spec.base + spec.track * freq) * Math.pow(2, velOct);
    const swellN = Math.max(1, spec.swell * sr);
    // The filter: a TPT state-variable low-pass.
    let ic1 = 0;
    let ic2 = 0;
    let a1 = 0;
    let a2 = 0;
    let a3 = 0;
    const k = 1 / Math.max(0.1, spec.q);
    let amp = 0;
    let bend = 1;
    let lpB = 0;
    const breathA = Math.exp((-TAU * Math.min(5000, freq * 3)) / sr);
    for (let i = 0; i < total; i++) {
      if ((i & 7) === 0) {
        const t = i / sr;
        const vibAmt = vib ? (t < vib.delay ? 0 : Math.min(1, (t - vib.delay) * 3)) * vib.depth * Math.sin(lfo) : 0;
        const slide = i < scoopN ? scoop * (1 - i / scoopN) * 100 : 0;
        bend = Math.pow(2, (vibAmt + slide) / 1200);
        // The brightness blooms over the swell then rests.
        const u = Math.min(1, i / swellN);
        const open = spec.open * (u < 1 ? Math.sin((u * Math.PI) / 2) : 1) * (1 - (1 - spec.rest) * u);
        const cut = Math.min(sr * 0.45, baseCut * Math.pow(2, open * (0.7 + 0.5 * vel)));
        const g = Math.tan((Math.PI * cut) / sr);
        a1 = 1 / (1 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
      }
      lfo += vibW;
      let s = 0;
      for (let j = 0; j < n; j++) {
        const dt = (freq * ratio[j]! * bend) / sr;
        let ph = phase[j]! + dt;
        if (ph >= 1) ph -= 1;
        phase[j] = ph;
        let v = 2 * ph - 1 - polyBlep(ph, dt);
        if (spec.pulse) {
          let p2 = ph + spec.pulse;
          if (p2 >= 1) p2 -= 1;
          v -= 2 * p2 - 1 - polyBlep(p2, dt);
        }
        s += v;
      }
      s /= Math.sqrt(n);
      if (spec.sub) {
        const dt = (freq * 0.5 * bend) / sr;
        subPh += dt;
        if (subPh >= 1) subPh -= 1;
        s += spec.sub * (subPh < 0.5 ? 1 : -1);
      }
      if (spec.breath) {
        lpB = (1 - breathA) * (rng.next() * 2 - 1) + breathA * lpB;
        s += spec.breath * 3 * lpB;
      }
      const v3 = s - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      if (i < holdN) amp = i < attackN ? i / attackN : 1;
      else amp *= relK;
      const tr = trem ? 1 - trem.depth * (0.5 + 0.5 * Math.sin(tph + i * tremW)) : 1;
      out[i] = v2 * amp * tr;
    }
    if (spec.formant) biquad(out, sr, "peak", spec.formant[0], 1.4, spec.formant[1]);
    if (spec.vowel) {
      const dry = Float32Array.from(out);
      const wet = new Float32Array(total);
      for (const [f, lvl] of spec.vowel) {
        const band = biquad(Float32Array.from(dry), sr, "bandpass", f, 5);
        for (let i = 0; i < total; i++) wet[i]! += lvl * band[i]!;
      }
      const mix = spec.vowelMix ?? 0.8;
      for (let i = 0; i < total; i++) out[i] = (1 - mix) * dry[i]! + mix * 3 * wet[i]!;
    }
    if (spec.drive && spec.drive > 1) drive(out, spec.drive);
    const g = 0.45 + 0.55 * vel;
    for (let i = 0; i < total; i++) out[i]! *= g;
    const fade = Math.min(total >> 1, 32);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}
