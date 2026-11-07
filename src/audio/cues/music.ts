/**
 * The music in Dust Creek: the saloon's out-of-tune upright, a lonely
 * whistle, a twangy guitar, a harmonica, a drum and the bell — and the short
 * stingers built from them. All original: the tunes below were written for
 * Nintenthropic.
 *
 * Everything is in G major (the piano, the stingers) or its relative E minor
 * (the ominous and lonely whistles), so a stinger landing over a piano note
 * never clashes.
 */
import { midiHz } from "../dsp/curves";
import { biquad, highpass, lowpass, svf } from "../dsp/filters";
import { Rng, hashSeed } from "../dsp/rng";
import { type Mono, adsr, normalize, shapeBy, tailOff } from "../dsp/signal";
import { addMode, addString, bandNoise, click, saw, white } from "../dsp/sources";
import { room, roomMono } from "../dsp/space";
import type { Take } from "../dsp/take";
import { burst, thump } from "./kit";
import { reloadSpin } from "./guns";
import { bellStrike } from "./world";

// --- the saloon upright -----------------------------------------------------------

interface Note {
  at: number;
  midi: number;
  /** Seconds the key is held. */
  dur: number;
  /** 0..1. */
  vel: number;
}

/**
 * One key of the saloon's upright: two or three strings a dozen cents apart
 * (the honky-tonk sound is exactly that unison gone out of tune), struck by
 * a felt hammer whose width shrinks as it hits harder — louder is brighter —
 * and damped when the key comes up. The detuning is the *piano's*, drawn
 * from a fixed seed per key, so every cue that plays this piano plays the
 * same instrument.
 */
function strike(out: Mono, t: Take, n: Note, strings: number): void {
  const inst = new Rng(hashSeed("saloon-upright", n.midi));
  const f = midiHz(n.midi);
  const spread = inst.range(8, 13);
  const detunes = strings >= 3 ? [-spread, inst.range(-2, 2), spread * inst.range(0.7, 1)] : [-spread * 0.6, spread * 0.6];
  const t60 = Math.min(6, Math.max(0.9, 3.4 * Math.sqrt(262 / f)));
  const position = 1 / inst.range(7, 8.5);
  const vel = n.vel;
  for (const cents of detunes) {
    addString(out, t.sr, t.rng, n.at, f * Math.pow(2, cents / 1200), ((0.35 + 0.65 * vel) / strings) * 1.6, {
      t60: t60 * t.rng.range(0.9, 1.1),
      brightness: 0.45 + 0.4 * vel,
      pulse: 0.0024 - 0.0015 * vel,
      position,
      length: n.dur,
      release: 0.07,
    });
  }
  // The hammer and the action: a soft thump and a tick of wood.
  t.put(out, burst(t, 0.05, 50, 700, 0.0008, 0.012), n.at, 0.08 * vel);
  t.put(out, click(t.sr, t.rng, 0.002, 300, 3000), n.at - 0.004, 0.012);
}

/** The upright's case and soundboard: a warm low body, a honk in the upper mids, dull old felt at the top. */
function pianoBody(buf: Mono, sr: number): Mono {
  highpass(buf, sr, 55, 2);
  biquad(buf, sr, "peak", 190, 0.9, 3);
  biquad(buf, sr, "peak", 1400, 1.2, 2.5);
  biquad(buf, sr, "highshelf", 6000, 0.7, -4);
  return buf;
}

/**
 * The eight notes the saloon piano answers with when shot, rising: G major
 * pentatonic from G4 to B5, so any notes played together or in any order
 * make a chord that fits (1, 3 and 4 are a G major triad) and lead into the
 * tune, which is in G.
 */
export const PIANO_SCALE: readonly number[] = [67, 69, 71, 74, 76, 79, 81, 83];

/** ``piano_note_<k>`` (k = 1..8): one key, struck a little differently each take. */
export function pianoNote(k: number): (t: Take) => Mono {
  return (t) => {
    const out = t.canvas(1.9);
    strike(out, t, { at: 0.006, midi: PIANO_SCALE[k - 1]!, dur: t.j(1.1, 0.1), vel: t.rng.range(0.55, 0.85) }, 3);
    return pianoBody(out, t.sr);
  };
}

/** The tune, in beats: [beat, midi, length in beats, accent 0..1]. Four bars of stride in G. */
const MELODY: readonly [number, number, number, number][] = [
  [0, 74, 0.5, 1], [0.5, 76, 0.5, 0.4], [1, 74, 0.5, 0.7], [1.5, 71, 0.5, 0.4], [2, 67, 1, 0.9], [3, 71, 0.5, 0.5], [3.5, 74, 0.5, 0.5],
  [4, 76, 1, 1], [5, 79, 0.5, 0.6], [5.5, 76, 0.5, 0.4], [6, 72, 1.5, 0.8], [7.5, 76, 0.5, 0.5],
  [8, 78, 0.5, 1], [8.5, 79, 0.5, 0.5], [9, 78, 0.5, 0.6], [9.5, 74, 0.5, 0.4], [10, 69, 1, 0.8], [11, 72, 0.5, 0.5], [11.5, 69, 0.5, 0.4],
  [12, 71, 0.5, 0.8], [12.5, 74, 0.5, 0.6], [13, 79, 1, 1],
];
/** The left hand: a bass note on 1 and 3, a chord on 2 and 4. */
const BASS: readonly [number, number][] = [[0, 43], [2, 50], [4, 48], [6, 43], [8, 50], [10, 45], [12, 43]];
const CHORDS: readonly [number, number[]][] = [
  [1, [55, 59, 62]], [3, [55, 59, 62]],
  [5, [52, 55, 60]], [7, [52, 55, 60]],
  [9, [54, 57, 60]], [11, [54, 57, 60]],
  [13, [55, 59, 62]],
];

/**
 * A few bars of honky-tonk on the saloon piano: a swung melody over a
 * stride left hand, ending on a rolled G chord. Each take is another
 * performance — its own tempo, swing and touch.
 */
export function pianoTune(t: Take): Mono {
  const r = t.rng;
  const beat = 60 / r.range(150, 166);
  const swing = r.range(0.56, 0.64);
  const time = (b: number): number => {
    const whole = Math.floor(b);
    const frac = b - whole;
    return (whole + (frac === 0.5 ? swing : frac)) * beat + r.range(-0.008, 0.008) + 0.02;
  };
  const end = 14 * beat;
  const out = t.canvas(end + 2.2);
  for (const [b, midi, len, accent] of MELODY) {
    strike(out, t, { at: time(b), midi, dur: len * beat * 0.92, vel: 0.62 + 0.25 * accent + r.range(-0.05, 0.05) }, 3);
  }
  for (const [b, midi] of BASS) {
    strike(out, t, { at: time(b), midi, dur: beat * 0.85, vel: 0.62 + r.range(-0.05, 0.05) }, 3);
  }
  for (const [b, notes] of CHORDS) {
    for (const midi of notes) strike(out, t, { at: time(b) + r.range(0, 0.006), midi, dur: beat * 0.4, vel: 0.45 + r.range(-0.05, 0.05) }, 2);
  }
  // The last chord, rolled up from the bass and left to ring.
  const at = 14 * beat + 0.02;
  [43, 50, 67, 71, 74, 79].forEach((midi, k) => {
    strike(out, t, { at: at + k * 0.022, midi, dur: 1.5, vel: 0.7 + (k === 5 ? 0.15 : 0) }, k < 2 ? 3 : 2);
  });
  pianoBody(out, t.sr);
  return roomMono(out, t.sr, r, { t60: 0.7, size: 0.45, damping: 0.4, mix: 0.2, predelay: 0.006, tail: 0.1 });
}

// --- a whistle -------------------------------------------------------------------------

interface Whistled {
  at: number;
  midi: number;
  dur: number;
  /** Scoop up into the note from this many semitones below. */
  scoop?: number;
  /** Let the note fall away at its end. */
  fall?: boolean;
}

/**
 * A man whistling: a nearly pure tone with a breath of noise tuned around it,
 * scooping into notes, gliding between legato ones, a vibrato that arrives
 * only once a note is held, and a fall-off at the end of a phrase.
 */
function whistle(t: Take, notes: Whistled[], seconds: number, vibrato = 1): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const pitch = new Float32Array(n);
  const amp = new Float32Array(n);
  let last = notes[0]!.midi;
  notes.forEach((note, k) => {
    const start = t.n(note.at);
    const stop = Math.min(n, t.n(note.at + note.dur));
    const prev = notes[k - 1];
    const legato = prev !== undefined && prev.at + prev.dur >= note.at - 0.01;
    const from = note.scoop !== undefined ? note.midi - note.scoop : legato ? last : note.midi;
    const glide = note.scoop !== undefined ? 0.07 : 0.035;
    const rate = r.range(5.2, 6.0);
    for (let i = start; i < stop; i++) {
      const s = (i - start) / t.sr;
      const left = (stop - i) / t.sr;
      let m = note.midi + (from - note.midi) * Math.exp(-s / glide);
      if (note.fall && left < 0.3) m -= 3.5 * Math.pow(1 - left / 0.3, 2);
      const vib = vibrato * 0.3 * Math.min(1, Math.max(0, (s - 0.22) / 0.3)) * Math.sin(2 * Math.PI * rate * s);
      pitch[i] = m + vib;
      const attack = Math.min(1, s / (legato ? 0.02 : 0.05));
      const release = Math.min(1, left / (note.fall ? 0.3 : 0.07));
      amp[i] = Math.max(amp[i]!, attack * release * (legato ? 0.95 : 1));
    }
    last = note.midi;
  });
  const freq = new Float32Array(n);
  // Pitch to frequency every 8 samples, linearly between: a power per sample
  // was the whistle's largest cost, and a glide is smooth at this rate.
  for (let i = 0; i < n; i += 8) {
    const a = midiHz(pitch[i]! || last) * t.p;
    const j = Math.min(n - 1, i + 8);
    const b = midiHz(pitch[j]! || last) * t.p;
    for (let k = i; k < Math.min(n, i + 8); k++) freq[k] = a + ((b - a) * (k - i)) / 8;
  }
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    out[i] = (Math.sin(ph) + 0.035 * Math.sin(2 * ph)) * amp[i]!;
    ph += (2 * Math.PI * freq[i]!) / t.sr;
  }
  // The breath: noise tuned tightly around the note, and a little wide air.
  const breath = svf(white(n, r), t.sr, "bp", freq, 28, 16);
  normalize(breath);
  const air = bandNoise(n, t.sr, r, 1800, 7000, 2);
  for (let i = 0; i < n; i++) out[i]! += amp[i]! * (0.16 * breath[i]! + 0.025 * air[i]!);
  return out;
}

// --- a guitar, a drum, a harmonica ------------------------------------------------------

/** A steel string plucked hard near the bridge: the western twang. */
function twang(out: Mono, t: Take, at: number, midi: number, vel: number, t60 = 2.4, bright = 0.85): void {
  addString(out, t.sr, t.rng, at, midiHz(midi) * t.p, vel, {
    t60,
    brightness: bright,
    position: 0.16,
    hardness: 7500,
    length: t60,
    release: 0.2,
  });
  t.put(out, click(t.sr, t.rng, 0.0015, 1500, 8000), at, 0.04 * vel);
}

/** A strum: the notes of a chord a few milliseconds apart, low to high. */
function strum(out: Mono, t: Take, at: number, notes: number[], vel: number, t60 = 2.2): void {
  notes.forEach((midi, k) => twang(out, t, at + k * t.rng.range(0.009, 0.015), midi, vel * t.rng.range(0.85, 1), t60, 0.75));
}

/** A big low drum: a membrane's inharmonic modes over a falling thump, and the beater's slap. */
function drum(out: Mono, t: Take, at: number, f0: number, gain: number): void {
  const r = t.rng;
  t.put(out, thump(t, 1.2, f0 * 1.6, f0, 0.002, 0.22, 0.35), at, gain);
  const ratios = [1.59, 2.14, 2.3, 2.65, 2.92, 3.16];
  ratios.forEach((ratio, k) => addMode(out, t.sr, at, f0 * ratio * r.range(0.99, 1.01), gain * 0.35 * Math.pow(0.75, k), 0.16 * Math.pow(0.8, k), r.range(0, 6)));
  t.put(out, burst(t, 0.05, 200, 2500, 0.0005, 0.006), at, gain * 0.35);
  t.put(out, burst(t, 0.6, 30, 200, 0.003, 0.12, 4), at, gain * 0.6);
}

/**
 * A harmonica chord: each reed a band-limited buzz (a sawtooth and a
 * narrow pulse), the reeds a hair apart, breath under them, and the
 * player's cupped hand opening and closing a filter — the *wah*.
 */
function harmonica(t: Take, chords: { at: number; dur: number; notes: number[] }[], seconds: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const out = new Float32Array(n);
  for (const chord of chords) {
    const len = t.n(chord.dur);
    const start = t.n(chord.at);
    const reeds = new Float32Array(len);
    for (const midi of chord.notes) {
      const freq = new Float32Array(len);
      const f = midiHz(midi) * t.p * (1 + r.range(-0.002, 0.002));
      for (let i = 0; i < len; i++) {
        const s = i / t.sr;
        // A small bend up into the note, and a hand vibrato on a held chord.
        freq[i] = f * (1 - 0.03 * Math.exp(-s / 0.04)) * (1 + 0.006 * Math.sin(2 * Math.PI * 4.6 * s) * Math.min(1, s / 0.4));
      }
      const a = saw(len, t.sr, freq, 0, r.next());
      const b = saw(len, t.sr, freq, 0.3, r.next());
      for (let i = 0; i < len; i++) reeds[i]! += 0.6 * a[i]! + 0.4 * b[i]!;
    }
    const breath = bandNoise(len, t.sr, r, 800, 5000, 2);
    for (let i = 0; i < len; i++) reeds[i]! += 0.15 * breath[i]!;
    // The hand: a resonant low-pass opening over the first third, closing at the end.
    svf(reeds, t.sr, "lp", (u) => 550 + 2600 * Math.sin(Math.PI * Math.min(1, u * 1.2)) ** 0.7, 2.2, 32);
    adsr(reeds, t.sr, 0.03, 0.2, 0.8, Math.min(0.25, chord.dur * 0.4));
    for (let i = 0; i < len && start + i < n; i++) out[start + i]! += reeds[i]!;
  }
  return out;
}

/** A glockenspiel bar: partials of a free bar (1 : 2.71 : 5.2), a bright tick. */
function glock(out: Mono, t: Take, at: number, midi: number, gain: number, tau = 0.7): void {
  const f = midiHz(midi) * t.p;
  addMode(out, t.sr, at, f, gain, tau, t.rng.range(0, 6));
  addMode(out, t.sr, at, f * 2.71, gain * 0.3, tau * 0.35, t.rng.range(0, 6));
  addMode(out, t.sr, at, f * 5.2, gain * 0.12, tau * 0.12, t.rng.range(0, 6));
  t.put(out, click(t.sr, t.rng, 0.0015, 2000, 12000), at, gain * 0.15);
}

/** A rising noise sweep: the *shing* of a glint. */
function shing(t: Take, seconds: number, from: number, to: number): Mono {
  const buf = white(t.n(seconds), t.rng);
  svf(buf, t.sr, "bp", (u) => from * Math.pow(to / from, u), 3, 16);
  normalize(buf);
  return shapeBy(buf, (u) => Math.sin(Math.PI * u) ** 2);
}

// --- the stingers ----------------------------------------------------------------------

/** A wave begins: the church bell struck close, and a big low drum under it, in a wide space. */
export function waveStart(t: Take): Mono[] {
  const dry = t.canvas(3.6);
  t.put(dry, bellStrike(t, t.rng.range(540, 580) * t.p, 3.4, 1.1), 0.01, 0.8);
  drum(dry, t, 0.01, t.rng.range(48, 56), 1.0);
  tailOff(dry, t.sr, 0.5);
  return room(dry, t.sr, t.rng, { t60: 1.8, size: 1, damping: 0.35, mix: 0.35, predelay: 0.02, tail: 0.4 });
}

/** A wave cleared: a guitar strum from D to G, and a harmonic ringing over it. */
export function waveClear(t: Take): Mono[] {
  const dry = t.canvas(2.8);
  strum(dry, t, 0.01, [50, 57, 62, 66], 0.7, 1.2);
  strum(dry, t, 0.28, [43, 50, 55, 59, 62, 67], 0.9, 2.4);
  addMode(dry, t.sr, 0.3, midiHz(79) * t.p, 0.1, 0.5, 0);
  addMode(dry, t.sr, 0.3, midiHz(91) * t.p, 0.04, 0.3, 0);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, t.rng, { t60: 1.4, size: 0.8, damping: 0.4, mix: 0.25, predelay: 0.015, tail: 0.2 });
}

/**
 * Black Jack arrives: a low drum, a baritone twang trembling under it, and a
 * whistled motif that climbs a fourth and leans on the flat second — E
 * Phrygian, the sound of a man you should not have crossed.
 */
export function bossIntro(t: Take): Mono[] {
  const dry = t.canvas(5.0);
  drum(dry, t, 0.01, 44, 1.0);
  const bari = t.canvas(4.8);
  twang(bari, t, 0, 40, 0.9, 4.0, 0.7);
  shapeBy(bari, (u) => 0.6 + 0.4 * Math.sin(2 * Math.PI * 5.2 * u * 4.8), 16);
  t.put(dry, bari, 0.02, 0.8);
  const motif: Whistled[] = [
    { at: 0.45, midi: 71, dur: 0.32, scoop: 2 },
    { at: 0.8, midi: 76, dur: 0.95, scoop: 1 },
    { at: 1.78, midi: 77, dur: 0.38 },
    { at: 2.16, midi: 76, dur: 0.34 },
    { at: 2.52, midi: 71, dur: 1.45, fall: true },
  ];
  t.put(dry, whistle(t, motif, 4.1), 0, 0.55);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, t.rng, { t60: 2.6, size: 1, damping: 0.3, mix: 0.4, predelay: 0.03, tail: 0.3 });
}

/**
 * The standoff: one man whistling in an empty street, slow and lonely, in E
 * minor — up a fourth, a held high note, a turn down, home — and the valley
 * answering it.
 */
export function duelWhistle(t: Take): Mono[] {
  const r = t.rng;
  const tune: Whistled[] = [
    { at: 0.05, midi: 71, dur: 0.75, scoop: 2 },
    { at: 0.85, midi: 76, dur: 1.05 },
    { at: 1.95, midi: 74, dur: 0.24 },
    { at: 2.2, midi: 71, dur: 0.24 },
    { at: 2.45, midi: 69, dur: 0.36 },
    { at: 2.85, midi: 71, dur: 1.5, fall: true },
  ];
  const w = whistle(t, tune, 4.5, 1.2);
  const dry = t.canvas(5.4);
  t.put(dry, w, 0, 1);
  // The valley's answer: a darker copy of the phrase, a beat behind.
  const echo = lowpass(Float32Array.from(w), t.sr, 1800, 2);
  t.put(dry, echo, r.range(0.38, 0.46), 0.22);
  tailOff(dry, t.sr, 0.4);
  return room(dry, t.sr, r, { t60: 3.0, size: 1, damping: 0.35, mix: 0.45, predelay: 0.05, tail: 0.3 });
}

/** Quick Draw: a glint of steel — a shimmering *tiing* over a rising *shing* — and two bright harmonics. */
export function quickDraw(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(1.15);
  t.put(out, shing(t, 0.14, 900, 7000), 0, 0.35);
  for (let k = 0; k < 5; k++) {
    const f = r.range(2600, 7200);
    addMode(out, t.sr, 0.1, f, 0.08, r.range(0.12, 0.35), r.range(0, 6));
    addMode(out, t.sr, 0.1, f * 1.003, 0.08, r.range(0.12, 0.35), r.range(0, 6));
  }
  twang(out, t, 0.08, 83, 0.6, 0.9, 0.95);
  twang(out, t, 0.15, 88, 0.6, 0.9, 0.95);
  return tailOff(out, t.sr, 0.4);
}

/** The streak rises: two bright plucks up a fifth. Pitch is exact, so a game can raise it by rate per level. */
export function streakUp(t: Take): Mono {
  const out = t.canvas(0.7);
  twang(out, t, 0.005, 86, 0.7, 0.7, 0.95);
  twang(out, t, 0.075, 93, 0.8, 0.8, 0.95);
  glock(out, t, 0.075, 93, 0.05, 0.3);
  return tailOff(out, t.sr, 0.25);
}

/** A secret found: a harmonica's *wah* from D to G, a small grin of a sound. */
export function secretFound(t: Take): Mono {
  const out = harmonica(t, [
    { at: 0.02, dur: 0.24, notes: [62, 66, 69] },
    { at: 0.3, dur: 1.2, notes: [67, 71, 74] },
  ], 1.7);
  return roomMono(out, t.sr, t.rng, { t60: 0.9, size: 0.6, mix: 0.2, predelay: 0.01, tail: 0.1 });
}

/** The Golden Revolver: the cylinder spun, a golden arpeggio chiming up, and a glint. */
export function goldenUnlock(t: Take): Mono[] {
  const dry = t.canvas(2.9);
  const spin = reloadSpin(t);
  t.put(dry, spin, 0, 0.45);
  [67, 71, 74, 79, 83].forEach((midi, k) => glock(dry, t, 0.35 + k * 0.085, midi + 12, 0.35, 0.9));
  t.put(dry, shing(t, 0.25, 1500, 9000), 0.7, 0.2);
  for (let k = 0; k < 8; k++) addMode(dry, t.sr, 0.78 + k * 0.04, t.rng.range(5000, 9500), 0.03, 0.2, 0);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, t.rng, { t60: 1.6, size: 0.9, mix: 0.3, predelay: 0.015, tail: 0.2 });
}

/** The tombstone: a low guitar falling A, E, low A, and a soft drum as it lands. */
export function gameOver(t: Take): Mono[] {
  const dry = t.canvas(4.4);
  twang(dry, t, 0.02, 57, 0.8, 2.0, 0.7);
  twang(dry, t, 0.6, 52, 0.8, 2.2, 0.7);
  twang(dry, t, 1.2, 45, 0.95, 3.2, 0.65);
  drum(dry, t, 1.2, 46, 0.5);
  shapeBy(dry, (u) => (u < 0.3 ? 1 : 1 - 0.15 * Math.sin(2 * Math.PI * 4.5 * (u - 0.3) * 4.4)), 16);
  tailOff(dry, t.sr, 0.9);
  return room(dry, t.sr, t.rng, { t60: 2.2, size: 1, mix: 0.35, predelay: 0.02, tail: 0.2 });
}

/** The low boom under slow motion: a sub drop and a rumble that takes its time. */
export function slowmoBoom(t: Take): Mono {
  const out = t.canvas(3.2);
  t.put(out, thump(t, 3.0, 58 * t.p, 26 * t.p, 0.01, 0.55, 0.45), 0, 1);
  const rumble = bandNoise(t.n(3.1), t.sr, t.rng, 25, 170, 4);
  adsr(rumble, t.sr, 0.12, 0.4, 0.6, 1.5);
  t.put(out, rumble, 0, 0.5);
  // A breath of air falling with it, so it is heard on small speakers.
  const air = bandNoise(t.n(1.6), t.sr, t.rng, 120, 900, 2);
  shapeBy(air, (u) => Math.min(1, u * 8) * Math.pow(1 - u, 2));
  t.put(out, air, 0, 0.12);
  return out;
}
