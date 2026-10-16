/**
 * Instruments: the engines behind anything in Handheld that plays a note.
 *
 * A *voice* turns one note (a pitch, how long the key is held, how hard it is
 * struck) into a mono buffer that starts at the note's first sample and runs
 * on through its release. Five engines cover what a toy-box orchestra needs:
 *
 *   subtractive  oscillators → low-pass filter → amplifier: basses, pads,
 *                brass, leads, a fuzzed guitar
 *   modal        a few ringing partials: bells, marimba, vibes, steel drum
 *   plucked      a vibrating string (Karplus-Strong): ukulele, twang, pizzicato
 *   organ        drawbar sines with a key click and a rotating-speaker shimmer
 *   fm           two-operator FM: electric piano, glassy bells
 *   breathy      a sine with breath and a scoop: a whistle, a flute
 *
 * Each is built once from a plain-data spec (a *preset*) and called for every
 * note, so an instrument is a few numbers and the sequencer never needs to
 * know how it sounds. Everything is deterministic: a note's randomness comes
 * from the Rng it is handed.
 *
 * Like the rest of the DSP it is plain TypeScript on Float32Arrays: it runs in
 * a Worker, on the main thread and in Node under Vitest alike.
 */
import type { Rng } from "./rng";
import { type Mono, samples } from "./signal";
import { addMode, addString } from "./sources";

/** One note to play. */
export interface NoteSpec {
  sr: number;
  /** Hz. */
  freq: number;
  /** Seconds the key is held; the release rings on past it. */
  hold: number;
  /** 0..1, how hard it is struck (louder is brighter). */
  vel: number;
  rng: Rng;
}

/** Plays a note: returns a mono buffer from the note's first sample to the end of its release. */
export type Voice = ((note: NoteSpec) => Mono) & {
  /** True for a voice that rings out whatever the key does (a bell): a renderer need not tell notes of different lengths apart. */
  ignoresHold?: boolean;
};

const TAU = 2 * Math.PI;

/** A band-limiting correction at a saw's or pulse's jump (PolyBLEP): the alias-free edge. */
function polyBlep(phase: number, dt: number): number {
  if (phase < dt) {
    const x = phase / dt;
    return x + x - x * x - 1;
  }
  if (phase > 1 - dt) {
    const x = (phase - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** A cheap tanh-like soft clip (Padé), flat past ±3: the grit of a fuzzed guitar. */
export function softClip(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// --- subtractive ----------------------------------------------------------------------------

export type Wave = "sine" | "tri" | "square" | "saw" | "pulse";

export interface SubOsc {
  wave: Wave;
  /** Detune in cents. */
  cents?: number;
  /** Level, 0..1 (default 1; the oscillators are summed, so keep the total near 1). */
  level?: number;
  /** Frequency multiplier: 0.5 is an octave down, 2 an octave up. */
  mult?: number;
  /** Pulse width for "pulse", 0.05..0.5 (0.5 is a square). */
  width?: number;
}

export interface SubSpec {
  oscs: SubOsc[];
  /** The low-pass cutoff at rest, Hz. With ``keytrack`` it is added to a share of the note's own pitch. */
  cutoff: number;
  /** 0..1: how much of the note's frequency is added to the cutoff (a bright high note, a dull low one). */
  keytrack?: number;
  /** The filter envelope's reach, octaves up from the cutoff at the moment of the strike. */
  envOct?: number;
  /** Seconds for the filter envelope to fall toward ``fsustain`` of its reach. */
  fdecay?: number;
  fsustain?: number;
  /** Filter resonance (Q); 0.7 is flat. */
  q?: number;
  /** Amplifier: attack s, decay s (time constant), sustain level 0..1, release s (to silence). */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Pitch vibrato: rate Hz, depth cents, seconds before it comes in. */
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Starts this many semitones off the pitch and glides in over ``time`` seconds (a scoop, a fall). */
  glide?: { semitones: number; time: number };
  /** Soft-clip drive after the filter (1 is clean; 4 is fuzz). */
  drive?: number;
  /** White noise mixed in before the filter (breath, grit), 0..1. */
  noise?: number;
  /** The oscillators start at phase zero (a bass's attack is the same every time) rather than random. */
  fixedPhase?: boolean;
  /** Velocity's reach on the cutoff, in octaves (0 for none). */
  velBright?: number;
}

/** Subtractive synthesis. One loop does oscillators, filter and amplifier, so a note costs a few dozen operations a sample. */
export function subtractive(spec: SubSpec): Voice {
  const oscs = spec.oscs;
  const count = oscs.length;
  const q = spec.q ?? 0.7;
  return ({ sr, freq, hold, vel, rng }) => {
    const total = Math.max(2, samples(sr, hold + spec.release));
    const out = new Float32Array(total);
    const holdN = Math.min(total, samples(sr, hold));
    const attackN = Math.max(1, spec.attack * sr);
    const decayK = 1 - Math.exp(-1 / Math.max(1, spec.decay * sr));
    // Released over ``release`` seconds to about −60 dB.
    const relK = Math.exp(-6.9 / Math.max(1, spec.release * sr));
    const fK = Math.exp(-1 / Math.max(1, (spec.fdecay ?? 0.2) * sr));
    const fSus = spec.fsustain ?? 0;
    const envOct = spec.envOct ?? 0;
    const velOct = (spec.velBright ?? 0) * (vel - 0.7);
    const base = spec.cutoff * Math.pow(2, velOct) + (spec.keytrack ?? 0) * freq;
    const vib = spec.vibrato;
    const vibW = vib ? (TAU * vib.rate) / sr : 0;
    const vibDelay = vib?.delay ?? 0;
    const glide = spec.glide;
    const drive = spec.drive ?? 1;
    const noise = spec.noise ?? 0;

    // Per-oscillator state.
    const phase = new Float64Array(count);
    const ratio = new Float64Array(count);
    const level = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const o = oscs[k]!;
      ratio[k] = (o.mult ?? 1) * Math.pow(2, (o.cents ?? 0) / 1200);
      level[k] = o.level ?? 1;
      phase[k] = spec.fixedPhase ? 0 : rng.next();
    }
    let lfo = rng.next() * TAU;
    let fenv = 1;
    let amp = 0;
    let ic1 = 0;
    let ic2 = 0;
    let a1 = 0;
    let a2 = 0;
    let a3 = 0;
    let k0 = 1 / q;
    let pitch = 1;
    let noiseState = (rng.next() * 4294967296) | 0 || 0x9e3779b9;
    const gl = glide ? Math.pow(2, glide.semitones / 12) : 1;
    const glT = glide ? Math.max(1, glide.time * sr) : 1;

    for (let i = 0; i < total; i++) {
      if ((i & 7) === 0) {
        // Control rate: pitch (vibrato, glide) and the filter.
        let m = 1;
        if (vib) {
          const depth = i / sr < vibDelay ? 0 : Math.min(1, (i / sr - vibDelay) * 4);
          m = Math.pow(2, (vib.depth * depth * Math.sin(lfo)) / 1200);
        }
        if (glide) m *= i < glT ? gl + (1 - gl) * (i / glT) : 1;
        pitch = m;
        const cut = base * Math.pow(2, envOct * (fSus + (1 - fSus) * fenv));
        const f = Math.min(Math.max(cut, 20), sr * 0.45);
        const g = Math.tan((Math.PI * f) / sr);
        k0 = 1 / q;
        a1 = 1 / (1 + g * (g + k0));
        a2 = g * a1;
        a3 = g * a2;
      }
      if (vib) lfo += vibW;
      fenv *= fK;

      // Oscillators.
      let s = 0;
      for (let k = 0; k < count; k++) {
        const dt = Math.min(0.45, (freq * ratio[k]! * pitch) / sr);
        let ph = phase[k]!;
        let v: number;
        switch (oscs[k]!.wave) {
          case "saw":
            v = 2 * ph - 1 - polyBlep(ph, dt);
            break;
          case "square":
          case "pulse": {
            const w = oscs[k]!.wave === "square" ? 0.5 : (oscs[k]!.width ?? 0.5);
            v = ph < w ? 1 : -1;
            v += polyBlep(ph, dt);
            let p2 = ph - w;
            if (p2 < 0) p2 += 1;
            v -= polyBlep(p2, dt);
            break;
          }
          case "tri":
            v = 4 * Math.abs(ph - 0.5) - 1;
            break;
          default:
            v = Math.sin(TAU * ph);
        }
        s += level[k]! * v;
        ph += dt;
        if (ph >= 1) ph -= 1;
        phase[k] = ph;
      }
      if (noise > 0) {
        noiseState ^= noiseState << 13;
        noiseState ^= noiseState >>> 17;
        noiseState ^= noiseState << 5;
        s += noise * noiseState * 4.656612873077393e-10;
      }

      // Filter (state-variable, low-pass).
      const v3 = s - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      let y = v2;
      if (drive !== 1) y = softClip(drive * y) / softClip(drive);

      // Amplifier.
      if (i < holdN) {
        if (i < attackN) amp = i / attackN;
        else amp += (spec.sustain - amp) * decayK;
      } else {
        amp *= relK;
      }
      out[i] = y * amp * (0.35 + 0.65 * vel);
    }
    // A last short fade so a long release never ends on a step.
    const fade = Math.min(total, 24);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

// --- modal -----------------------------------------------------------------------------------

export interface ModalSpec {
  /** [frequency ratio, amplitude, decay multiplier] of each partial. */
  partials: readonly (readonly [number, number, number])[];
  /** The fundamental's decay time constant, seconds. */
  tau: number;
  /** The partials above the first come up with velocity by this much (0 none, 1 a lot). */
  brightVel?: number;
  /** A tick of the mallet: level, and how short. */
  hammer?: { level: number; tau: number; low?: number };
  /** Amplitude shimmer: vibes' motor. */
  tremolo?: { rate: number; depth: number };
  /** Beating: a second copy of every partial this many cents off, at this level. */
  chorus?: { cents: number; level: number };
  /** Ring on past the key's release (a bell) instead of being damped. */
  free?: boolean;
  /** Seconds a held key's ring takes to be damped on release. */
  damp?: number;
}

/** Ringing partials: the sound of anything struck. */
export function modal(spec: ModalSpec): Voice {
  const voice: Voice = ({ sr, freq, hold, vel, rng }) => {
    const damp = spec.damp ?? 0.12;
    // A ringing note is let go after about 4 s (a bell's last 30 dB are inaudible under a mix, and a long tail costs every note it is mixed into).
    const ring = Math.min(spec.tau * 6.5, 4);
    const length = spec.free ? ring : Math.min(ring, hold + damp * 3);
    const total = Math.max(8, samples(sr, length));
    const out = new Float32Array(total);
    const bright = spec.brightVel ?? 0.5;
    spec.partials.forEach(([ratio, amp, decay], k) => {
      const f = freq * ratio;
      if (f >= sr * 0.45) return;
      // Louder strikes excite the upper partials more.
      const a = amp * (k === 0 ? 1 : Math.pow(0.35 + 0.65 * vel, bright * 2));
      addMode(out, sr, 0, f, a, spec.tau * decay, rng.next() * TAU);
      if (spec.chorus) addMode(out, sr, 0, f * Math.pow(2, spec.chorus.cents / 1200), a * spec.chorus.level, spec.tau * decay, rng.next() * TAU);
    });
    if (spec.hammer) {
      const h = spec.hammer;
      const n = Math.min(total, samples(sr, h.tau * 8));
      let x = (rng.next() * 4294967296) | 0 || 0x9e3779b9;
      let lp = 0;
      const a = Math.exp((-TAU * (h.low ?? 5000)) / sr);
      const k = Math.exp(-1 / Math.max(1, h.tau * sr));
      let e = 1;
      for (let i = 0; i < n; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        lp = (1 - a) * (x * 4.656612873077393e-10) + a * lp;
        out[i]! += h.level * lp * e * (0.4 + 0.6 * vel);
        e *= k;
      }
    }
    if (spec.tremolo) {
      const w = (TAU * spec.tremolo.rate) / sr;
      let ph = rng.next() * TAU;
      for (let i = 0; i < total; i++) {
        out[i]! *= 1 - spec.tremolo.depth * (0.5 + 0.5 * Math.sin(ph));
        ph += w;
      }
    }
    // Damp on release; a bell is let ring but still ends in a fade.
    const holdN = samples(sr, hold);
    if (!spec.free && holdN < total) {
      const k = Math.exp(-6.9 / Math.max(1, damp * sr));
      let g = 1;
      for (let i = holdN; i < total; i++) {
        g *= k;
        out[i]! *= g;
      }
    }
    const fade = Math.min(total >> 1, samples(sr, spec.free ? 0.25 : 0.02));
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    const gain = 0.25 + 0.75 * vel;
    for (let i = 0; i < total; i++) out[i]! *= gain;
    return out;
  };
  voice.ignoresHold = !!spec.free;
  return voice;
}

// --- plucked strings ---------------------------------------------------------------------------

export interface PluckSpec {
  /** Seconds for the string to fall 60 dB. */
  t60: number;
  /** 0 dull .. 1 bright. */
  brightness: number;
  /** Where it is plucked along the string, 0..0.5. */
  position?: number;
  /** The pick or the finger: noise low-pass, Hz. */
  hardness?: number;
  /** Damped on release this fast, seconds (a held note stops; 0 lets it ring). */
  damp?: number;
  /** A second string a few cents off (a twelve-string, a mandolin's pair) and its level. */
  double?: { cents: number; level: number };
}

/** A plucked string. */
export function plucked(spec: PluckSpec): Voice {
  return ({ sr, freq, hold, vel, rng }) => {
    const damp = spec.damp ?? 0.1;
    const length = damp > 0 ? Math.min(spec.t60, hold + damp * 4) : spec.t60;
    const total = Math.max(16, samples(sr, length + 0.05));
    const out = new Float32Array(total);
    const opts = {
      t60: spec.t60,
      brightness: Math.min(1, spec.brightness * (0.6 + 0.5 * vel)),
      position: spec.position ?? 0.18,
      hardness: (spec.hardness ?? 5000) * (0.7 + 0.6 * vel),
      length: damp > 0 ? hold : spec.t60,
      release: Math.max(0.02, damp),
    };
    addString(out, sr, rng, 0, freq, 0.6 + 0.4 * vel, opts);
    if (spec.double) addString(out, sr, rng, 0, freq * Math.pow(2, spec.double.cents / 1200), (0.6 + 0.4 * vel) * spec.double.level, opts);
    const fade = Math.min(total >> 1, 64);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

// --- organ -------------------------------------------------------------------------------------

export interface OrganSpec {
  /** Level of each harmonic (1, 2, 3, ...): the drawbars, as multiples of the note's pitch. */
  harmonics: readonly number[];
  /** Rotating-speaker shimmer: rate Hz and depth 0..1 (amplitude), and a little pitch vibrato in cents. */
  shimmer?: { rate: number; depth: number; cents: number };
  attack?: number;
  release?: number;
  /** A chiff at the start: breath noise, level. */
  chiff?: number;
}

/** An organ: harmonics at fixed levels, a key click, and a spinning speaker. */
export function organ(spec: OrganSpec): Voice {
  const harmonics = spec.harmonics;
  return ({ sr, freq, hold, vel, rng }) => {
    const attack = spec.attack ?? 0.008;
    const release = spec.release ?? 0.07;
    const total = Math.max(8, samples(sr, hold + release));
    const out = new Float32Array(total);
    const holdN = Math.min(total, samples(sr, hold));
    const m = harmonics.length;
    // One rotating phasor per drawbar: four multiplies each, no sin() in the loop.
    const re = new Float64Array(m).fill(1);
    const im = new Float64Array(m);
    const cw = new Float64Array(m);
    const sw = new Float64Array(m);
    const sh = spec.shimmer;
    const lfoW = sh ? (TAU * sh.rate) / sr : 0;
    let lfo = rng.next() * TAU;
    const aN = Math.max(1, attack * sr);
    const rK = Math.exp(-6.9 / Math.max(1, release * sr));
    let amp = 0;
    for (let i = 0; i < total; i++) {
      if ((i & 15) === 0) {
        const bend = sh ? Math.pow(2, (sh.cents * Math.sin(lfo)) / 1200) : 1;
        for (let k = 0; k < m; k++) {
          const w = (TAU * freq * (k + 1) * bend) / sr;
          cw[k] = Math.cos(w);
          sw[k] = Math.sin(w);
          const norm = 1 / Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
          re[k]! *= norm;
          im[k]! *= norm;
        }
      }
      let s = 0;
      for (let k = 0; k < m; k++) {
        s += harmonics[k]! * im[k]!;
        const nr = re[k]! * cw[k]! - im[k]! * sw[k]!;
        im[k] = re[k]! * sw[k]! + im[k]! * cw[k]!;
        re[k] = nr;
      }
      if (i < holdN) amp = i < aN ? i / aN : 1;
      else amp *= rK;
      let tremolo = 1;
      if (sh) {
        tremolo = 1 - sh.depth * (0.5 + 0.5 * Math.sin(lfo));
        lfo += lfoW;
      }
      out[i] = s * amp * tremolo * (0.5 + 0.5 * vel);
    }
    if (spec.chiff) {
      const n = Math.min(total, samples(sr, 0.05));
      let x = (rng.next() * 4294967296) | 0 || 0x9e3779b9;
      let lp = 0;
      const a = Math.exp((-TAU * Math.min(freq * 4, 6000)) / sr);
      for (let i = 0; i < n; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        lp = (1 - a) * (x * 4.656612873077393e-10) + a * lp;
        out[i]! += spec.chiff * lp * Math.exp((-i / sr) * 90);
      }
    }
    const fade = Math.min(total >> 1, 24);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

// --- FM ----------------------------------------------------------------------------------------

export interface FmSpec {
  /** Modulator frequency as a multiple of the carrier's. */
  ratio: number;
  /** Modulation index at the strike, and the time constant it falls with. */
  index: number;
  indexTau: number;
  /** A second, fixed ratio of the carrier added for body (0 for none): level. */
  feedback?: number;
  /** Amplitude: time constant of the decay, and the release after the key goes up. */
  tau: number;
  release: number;
  attack?: number;
  /** The index also rises with velocity by this fraction. */
  velIndex?: number;
  /** Level of the carrier's own octave (a body of the piano's second partial). */
  octave?: number;
}

/** Two-operator FM: electric pianos, glassy bells, a pluck with some bite. */
export function fm(spec: FmSpec): Voice {
  return ({ sr, freq, hold, vel }) => {
    const total = Math.max(8, samples(sr, Math.min(hold + spec.release, spec.tau * 7) + 0.02));
    const out = new Float32Array(total);
    const holdN = samples(sr, hold);
    const aN = Math.max(1, (spec.attack ?? 0.002) * sr);
    const ik = Math.exp(-1 / Math.max(1, spec.indexTau * sr));
    const ak = Math.exp(-1 / Math.max(1, spec.tau * sr));
    const rk = Math.exp(-6.9 / Math.max(1, spec.release * sr));
    let index = spec.index * (1 + (spec.velIndex ?? 0.5) * (vel - 0.7));
    let amp = 1;
    let released = 1;
    let pc = 0;
    let pm = 0;
    const wc = (TAU * freq) / sr;
    const wm = wc * spec.ratio;
    const fb = spec.feedback ?? 0;
    let last = 0;
    for (let i = 0; i < total; i++) {
      const mod = Math.sin(pm + fb * last);
      last = mod;
      let s = Math.sin(pc + index * mod);
      if (spec.octave) s += spec.octave * Math.sin(2 * pc);
      pc += wc;
      pm += wm;
      index *= ik;
      amp *= ak;
      if (i >= holdN) released *= rk;
      const env = (i < aN ? i / aN : 1) * released;
      out[i] = s * amp * env * (0.3 + 0.7 * vel);
    }
    const fade = Math.min(total >> 1, 24);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

// --- breathy -----------------------------------------------------------------------------------

export interface BreathySpec {
  /** Level of the second and third harmonics (a whistle has few; a flute more). */
  h2: number;
  h3: number;
  /** Breath noise level and its band (Hz), riding the note. */
  breath: number;
  breathBand: [number, number];
  /** Vibrato: rate, cents, seconds before it enters. */
  vibrato: { rate: number; depth: number; delay: number };
  /** The note starts this many cents flat and scoops up over ``scoopTime``. */
  scoop: number;
  scoopTime: number;
  attack: number;
  release: number;
}

/** A whistle or a flute: a sine with a little breath, a scoop into the pitch, and a late vibrato. */
export function breathy(spec: BreathySpec): Voice {
  return ({ sr, freq, hold, vel, rng }) => {
    const total = Math.max(8, samples(sr, hold + spec.release));
    const out = new Float32Array(total);
    const holdN = samples(sr, hold);
    const aN = Math.max(1, spec.attack * sr);
    const rK = Math.exp(-6.9 / Math.max(1, spec.release * sr));
    let ph = 0;
    let lfo = rng.next() * TAU;
    const lw = (TAU * spec.vibrato.rate) / sr;
    let amp = 0;
    let x = (rng.next() * 4294967296) | 0 || 0x9e3779b9;
    // Two one-pole stages make the breath's band.
    const aLo = Math.exp((-TAU * spec.breathBand[0]) / sr);
    const aHi = Math.exp((-TAU * spec.breathBand[1]) / sr);
    let lpHi = 0;
    let lpLo = 0;
    let bend = 1;
    for (let i = 0; i < total; i++) {
      if ((i & 7) === 0) {
        const t = i / sr;
        const vib = t < spec.vibrato.delay ? 0 : Math.min(1, (t - spec.vibrato.delay) * 3);
        const scoop = t < spec.scoopTime ? spec.scoop * (1 - t / spec.scoopTime) : 0;
        bend = Math.pow(2, (vib * spec.vibrato.depth * Math.sin(lfo) + scoop) / 1200);
      }
      lfo += lw;
      ph += (TAU * freq * bend) / sr;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const n = x * 4.656612873077393e-10;
      lpHi = (1 - aHi) * n + aHi * lpHi;
      lpLo = (1 - aLo) * lpHi + aLo * lpLo;
      const band = lpHi - lpLo;
      const tone = Math.sin(ph) + spec.h2 * Math.sin(2 * ph) + spec.h3 * Math.sin(3 * ph);
      if (i < holdN) amp = i < aN ? i / aN : 1;
      else amp *= rK;
      out[i] = (tone + spec.breath * band * 6) * amp * (0.5 + 0.5 * vel);
    }
    const fade = Math.min(total >> 1, 24);
    for (let i = 0; i < fade; i++) out[total - 1 - i]! *= i / fade;
    return out;
  };
}

// --- drums -------------------------------------------------------------------------------------

/** Fill ``n`` samples with white noise from the rng. */
function noiseBuf(n: number, rng: Rng): Float32Array {
  return rng.fill(new Float32Array(n));
}

/** A second-order band-pass or high-pass over a buffer, in place: the drum kit's only filter. */
function sv(buf: Mono, sr: number, mode: "lp" | "bp" | "hp", freq: number, q: number): Mono {
  const g = Math.tan((Math.PI * Math.min(freq, sr * 0.45)) / sr);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  let ic1 = 0;
  let ic2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const v0 = buf[i]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = mode === "lp" ? v2 : mode === "bp" ? k * v1 : v0 - k * v1 - v2;
  }
  return buf;
}

export type DrumKind =
  | "kick"
  | "kick-soft"
  | "kick-808"
  | "snare"
  | "snare-brush"
  | "snare-electro"
  | "clap"
  | "rim"
  | "hat"
  | "hat-open"
  | "ride"
  | "crash"
  | "shaker"
  | "tambourine"
  | "tom-low"
  | "tom-mid"
  | "tom-high"
  | "conga-low"
  | "conga-high"
  | "bongo"
  | "clave"
  | "cowbell"
  | "woodblock"
  | "sleigh"
  | "timpani";

/** A decaying sine with a falling pitch: the body of a drum. */
function boom(sr: number, n: number, f0: number, f1: number, pitchTau: number, ampTau: number, level = 1): Mono {
  const out = new Float32Array(n);
  let ph = 0;
  const pk = Math.exp(-1 / Math.max(1, pitchTau * sr));
  const ak = Math.exp(-1 / Math.max(1, ampTau * sr));
  let f = f0 - f1;
  let a = level;
  for (let i = 0; i < n; i++) {
    out[i] = a * Math.sin(ph);
    ph += (TAU * (f1 + f)) / sr;
    f *= pk;
    a *= ak;
  }
  return out;
}

function addInto(dst: Mono, src: Mono, gain = 1, at = 0): void {
  const end = Math.min(dst.length, src.length + at);
  for (let i = at; i < end; i++) dst[i]! += gain * src[i - at]!;
}

/** Decays a buffer exponentially in place (a noise burst's envelope), with a short attack. */
function decay(buf: Mono, sr: number, tau: number, attack = 0.0005): Mono {
  const k = Math.exp(-1 / Math.max(1, tau * sr));
  const a = Math.max(1, attack * sr);
  let e = 1;
  for (let i = 0; i < buf.length; i++) {
    buf[i]! *= e * (i < a ? i / a : 1);
    e *= k;
  }
  return buf;
}

/** One drum hit, mono, ending in silence. ``vel`` 0..1 scales the level and a little of the brightness. */
export function drumHit(kind: DrumKind, sr: number, rng: Rng, vel = 0.8): Mono {
  const L = (s: number) => Math.max(8, samples(sr, s));
  let out: Mono;
  switch (kind) {
    case "kick": {
      out = boom(sr, L(0.32), 150, 52, 0.018, 0.11, 1);
      const click = decay(sv(noiseBuf(L(0.01), rng), sr, "bp", 3500, 1), sr, 0.002);
      addInto(out, click, 0.5);
      break;
    }
    case "kick-soft": {
      out = boom(sr, L(0.28), 105, 48, 0.03, 0.12, 1);
      break;
    }
    case "kick-808": {
      out = boom(sr, L(0.6), 120, 44, 0.05, 0.28, 1);
      for (let i = 0; i < out.length; i++) out[i] = softClip(1.6 * out[i]!) / softClip(1.6);
      break;
    }
    case "snare": {
      out = new Float32Array(L(0.26));
      addInto(out, boom(sr, out.length, 210, 165, 0.02, 0.05, 0.7));
      const n = decay(sv(noiseBuf(out.length, rng), sr, "hp", 1800, 0.8), sr, 0.07);
      addInto(out, n, 0.9);
      break;
    }
    case "snare-brush": {
      out = new Float32Array(L(0.2));
      const n = decay(sv(noiseBuf(out.length, rng), sr, "bp", 5200, 0.7), sr, 0.07, 0.01);
      addInto(out, n, 0.6);
      addInto(out, boom(sr, out.length, 190, 170, 0.02, 0.03, 0.18));
      break;
    }
    case "snare-electro": {
      out = new Float32Array(L(0.32));
      addInto(out, boom(sr, out.length, 260, 150, 0.015, 0.05, 0.6));
      const n = decay(sv(noiseBuf(out.length, rng), sr, "hp", 1500, 0.7), sr, 0.11);
      addInto(out, n, 0.9);
      break;
    }
    case "clap": {
      out = new Float32Array(L(0.3));
      for (let k = 0; k < 4; k++) {
        const burst = decay(sv(noiseBuf(L(0.04), rng), sr, "bp", 1500, 1.2), sr, k === 3 ? 0.09 : 0.006, 0.0005);
        addInto(out, burst, k === 3 ? 0.9 : 0.6, Math.round(k * 0.011 * sr));
      }
      break;
    }
    case "rim": {
      out = new Float32Array(L(0.06));
      addInto(out, boom(sr, out.length, 520, 440, 0.01, 0.012, 0.8));
      addInto(out, decay(sv(noiseBuf(out.length, rng), sr, "bp", 2800, 1.4), sr, 0.006), 0.7);
      break;
    }
    case "hat": {
      out = decay(sv(noiseBuf(L(0.1), rng), sr, "hp", 7000, 1), sr, 0.018);
      break;
    }
    case "hat-open": {
      out = decay(sv(noiseBuf(L(0.45), rng), sr, "hp", 6500, 1), sr, 0.12);
      break;
    }
    case "ride": {
      out = new Float32Array(L(0.9));
      for (const [f, a] of [[3300, 0.5], [4750, 0.4], [6100, 0.35], [8300, 0.3]] as const) addMode(out, sr, 0, f * rng.range(0.99, 1.01), a, 0.22, rng.next() * TAU);
      addInto(out, decay(sv(noiseBuf(out.length, rng), sr, "hp", 7500, 1), sr, 0.1), 0.25);
      break;
    }
    case "crash": {
      out = decay(sv(noiseBuf(L(1.6), rng), sr, "hp", 3800, 0.8), sr, 0.5, 0.002);
      break;
    }
    case "shaker": {
      out = decay(sv(noiseBuf(L(0.12), rng), sr, "bp", 6500, 1.1), sr, 0.03, 0.012);
      break;
    }
    case "tambourine": {
      out = new Float32Array(L(0.3));
      addInto(out, decay(sv(noiseBuf(out.length, rng), sr, "hp", 6000, 1), sr, 0.05, 0.001), 0.8);
      for (const f of [4200, 5400, 7300]) addMode(out, sr, 0, f * rng.range(0.98, 1.02), 0.2, 0.06, rng.next() * TAU);
      break;
    }
    case "tom-low":
      out = boom(sr, L(0.45), 130, 80, 0.05, 0.16, 1);
      break;
    case "tom-mid":
      out = boom(sr, L(0.4), 180, 115, 0.045, 0.14, 1);
      break;
    case "tom-high":
      out = boom(sr, L(0.35), 240, 160, 0.04, 0.12, 1);
      break;
    case "conga-low": {
      out = boom(sr, L(0.3), 230, 175, 0.012, 0.09, 1);
      addInto(out, decay(sv(noiseBuf(L(0.01), rng), sr, "bp", 1800, 1), sr, 0.003), 0.4);
      break;
    }
    case "conga-high": {
      out = boom(sr, L(0.25), 330, 255, 0.01, 0.07, 1);
      addInto(out, decay(sv(noiseBuf(L(0.01), rng), sr, "bp", 2400, 1), sr, 0.003), 0.4);
      break;
    }
    case "bongo": {
      out = boom(sr, L(0.2), 420, 330, 0.008, 0.05, 1);
      addInto(out, decay(sv(noiseBuf(L(0.01), rng), sr, "bp", 3000, 1), sr, 0.003), 0.4);
      break;
    }
    case "clave": {
      out = new Float32Array(L(0.12));
      addMode(out, sr, 0, 2500 * rng.range(0.99, 1.01), 1, 0.018, 0);
      addMode(out, sr, 0, 5100, 0.3, 0.008, 1);
      break;
    }
    case "cowbell": {
      out = new Float32Array(L(0.4));
      addMode(out, sr, 0, 587, 0.8, 0.12, 0);
      addMode(out, sr, 0, 845, 1, 0.16, 1);
      addInto(out, decay(sv(noiseBuf(L(0.01), rng), sr, "bp", 3000, 1), sr, 0.002), 0.3);
      break;
    }
    case "woodblock": {
      out = new Float32Array(L(0.1));
      addMode(out, sr, 0, 1050, 1, 0.014, 0);
      addMode(out, sr, 0, 1700, 0.4, 0.01, 1);
      break;
    }
    case "sleigh": {
      out = new Float32Array(L(0.45));
      for (let k = 0; k < 6; k++) {
        const f = 4300 * rng.range(0.85, 1.35);
        addMode(out, sr, k * 0.004 * rng.next(), f, 0.25, 0.09, rng.next() * TAU);
        addMode(out, sr, k * 0.004 * rng.next(), f * 1.52, 0.15, 0.06, rng.next() * TAU);
      }
      addInto(out, decay(sv(noiseBuf(out.length, rng), sr, "hp", 7500, 1), sr, 0.04), 0.2);
      break;
    }
    case "timpani": {
      out = boom(sr, L(0.8), 110, 78, 0.12, 0.3, 1);
      addInto(out, boom(sr, out.length, 165, 120, 0.1, 0.15, 0.4));
      break;
    }
  }
  const g = 0.35 + 0.65 * vel;
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const norm = peak > 0 ? g / peak : 0;
  for (let i = 0; i < out.length; i++) out[i]! *= norm;
  // End in silence.
  const fade = Math.min(out.length >> 1, 48);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade;
  return out;
}
