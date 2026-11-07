/**
 * The tunes inside Grip Prix's sound effects: the countdown beeps, the lap
 * chime, the final-lap jingle, the two finish fanfares (a win and a "well
 * done"), the crowd, the rubber duck, the horn and the interface. All are
 * original, in C or G major, and their pitches are exact so that they sit
 * with the music (which is in tune with them) instead of against it.
 */
import { midiHz, sampled, smooth } from "../dsp/curves";
import { bandpass, highpass, lowpass } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, click, formants, saw, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { type SubSpec, type Voice, drumHit, modal, subtractive } from "../dsp/voices";
import { thump } from "./kit";
import { ar, expo } from "./kart-kit";

// --- the instruments of the jingles ---------------------------------------------------------------------

const BEEP: SubSpec = {
  oscs: [{ wave: "square", level: 0.5 }, { wave: "tri", level: 0.5 }, { wave: "sine", level: 0.2, mult: 2 }],
  cutoff: 2600, attack: 0.006, decay: 0.5, sustain: 0.85, release: 0.05, fixedPhase: true,
};
const BRASS: SubSpec = {
  oscs: [{ wave: "saw", cents: -6, level: 0.5 }, { wave: "saw", cents: 6, level: 0.5 }],
  cutoff: 380, keytrack: 1.7, envOct: 2, fdecay: 0.1, fsustain: 0.55, q: 1.2,
  attack: 0.025, decay: 0.4, sustain: 0.8, release: 0.12, vibrato: { rate: 5.6, depth: 8, delay: 0.2 }, velBright: 0.6,
};
const GLOCK = modal({
  partials: [[1, 1, 1], [2.76, 0.45, 0.5], [5.4, 0.25, 0.28], [8.9, 0.12, 0.15]],
  tau: 0.6, free: true, hammer: { level: 0.12, tau: 0.002, low: 8000 },
});
const VIBES = modal({
  partials: [[1, 1, 1], [4, 0.28, 0.4], [10, 0.08, 0.15]],
  tau: 0.9, tremolo: { rate: 5.2, depth: 0.3 }, hammer: { level: 0.08, tau: 0.003, low: 4000 }, damp: 0.25,
});
const MARIMBA = modal({
  partials: [[1, 1, 1], [3.93, 0.2, 0.28], [9.2, 0.05, 0.1]],
  tau: 0.22, hammer: { level: 0.25, tau: 0.003, low: 2500 }, damp: 0.1,
});
const brass: Voice = subtractive(BRASS);
/** A beep whose first few milliseconds start a shade sharp (a different amount each take) and settle to the exact pitch. */
const beepVoice = (t: Take): Voice => subtractive({ ...BEEP, glide: { semitones: t.rng.range(0.25, 0.6), time: 0.035 } });

/** Place a voice's note on ``out``. */
function note(out: Mono, t: Take, voice: Voice, at: number, midi: number, hold: number, vel = 0.85, gain = 1): void {
  t.put(out, voice({ sr: t.sr, freq: midiHz(midi), hold, vel, rng: t.rng.fork(`${midi}@${at}`) }), at, gain);
}

/** A faint noisy breath under tonal sounds: the texture that makes two takes two takes. */
function breath(out: Mono, t: Take, gain = 0.015): void {
  const n = bandpass(white(out.length, t.rng), t.sr, 800, 6000, 2);
  for (let i = 0; i < out.length; i++) out[i]! += gain * n[i]!;
}

// --- the countdown and the laps --------------------------------------------------------------------------------

/** 3, 2, 1: a short, round beep. */
export function beepLow(t: Take): Mono {
  const out = t.canvas(0.32);
  note(out, t, beepVoice(t), 0, 69, 0.2, 0.9);
  breath(out, t);
  return out;
}

/** Go: the same beep an octave up, held, and the A major triad blooming over it with a rising rush of air. */
export function beepHigh(t: Take): Mono {
  const out = t.canvas(1.1);
  note(out, t, beepVoice(t), 0, 81, 0.6, 0.95);
  // The triad (C#6, E6) and the octave above, in glass.
  note(out, t, GLOCK, 0, 93, 0.4, 0.7, 0.35);
  note(out, t, GLOCK, 0.02, 85, 0.5, 0.65, 0.28);
  note(out, t, GLOCK, 0.04, 88, 0.5, 0.65, 0.26);
  note(out, t, VIBES, 0.03, 73, 0.7, 0.6, 0.3);
  const air = bandNoise(t.n(0.5), t.sr, t.rng, 900, 7000, 2);
  shapeBy(air, (u) => smooth(u / 0.25) * smooth((1 - u) / 0.6));
  t.put(out, air, 0, 0.12);
  breath(out, t);
  return out;
}

/** A lap done: three glass notes up the major triad. */
export function lapChime(t: Take): Mono {
  const out = t.canvas(1.2);
  note(out, t, GLOCK, 0, 84, 0.2, 0.8);
  note(out, t, GLOCK, 0.09, 88, 0.2, 0.85);
  note(out, t, GLOCK, 0.18, 91, 0.4, 0.95);
  note(out, t, VIBES, 0.18, 79, 0.4, 0.6, 0.4);
  breath(out, t);
  return out;
}

/** The last lap begins: three pick-ups and a climb, brass over glass. */
export function finalLap(t: Take): Mono {
  const out = t.canvas(2.1);
  const steps: [number, number, number][] = [
    [0, 67, 0.1], [0.125, 67, 0.1], [0.25, 67, 0.1], [0.375, 72, 0.32],
    [0.78, 76, 0.1], [0.9, 79, 0.1], [1.02, 84, 0.7],
  ];
  for (const [at, midi, hold] of steps) {
    note(out, t, brass, at, midi, hold, 0.9);
    note(out, t, GLOCK, at, midi + 12, hold, 0.7, 0.4);
  }
  note(out, t, brass, 1.02, 76, 0.7, 0.7, 0.6);
  note(out, t, brass, 1.02, 72, 0.7, 0.7, 0.6);
  const crash = highpass(white(t.n(1.0), t.rng), t.sr, 5500, 2);
  expo(crash, t.sr, 0.3, 0.004);
  t.put(out, crash, 1.02, 0.16);
  breath(out, t);
  return out;
}

// --- finishing ------------------------------------------------------------------------------------------------------

/** A roll on the timpani that swells to ``end`` seconds. */
function timpaniRoll(out: Mono, t: Take, from: number, end: number, gain: number): void {
  const hits = Math.round((end - from) / 0.045);
  for (let k = 0; k < hits; k++) {
    const u = k / hits;
    const hitBuf = drumHit("timpani", t.sr, t.rng.fork(`timp${k}`), 0.4 + 0.5 * u);
    t.put(out, hitBuf, from + k * ((end - from) / hits), gain * (0.4 + 0.6 * u));
  }
}

/** First place: a roll, a brass fanfare up the triad, a big held chord and a cymbal. */
export function finishWin(t: Take): Mono {
  const out = t.canvas(3.8);
  timpaniRoll(out, t, 0, 0.62, 0.7);
  const tune: [number, number, number][] = [
    [0.62, 67, 0.14], [0.78, 72, 0.14], [0.94, 76, 0.14], [1.1, 79, 0.14], [1.26, 84, 1.9],
  ];
  for (const [at, midi, hold] of tune) {
    note(out, t, brass, at, midi, hold, 0.95);
    note(out, t, GLOCK, at, midi + 12, Math.min(hold, 0.4), 0.7, 0.35);
  }
  // The chord under the held note.
  for (const midi of [60, 64, 67, 72]) note(out, t, brass, 1.26, midi, 1.9, 0.75, 0.55);
  t.put(out, drumHit("crash", t.sr, t.rng, 0.85), 1.26, 0.5);
  // A glittering run at the top.
  [91, 95, 98, 103, 107].forEach((m, k) => note(out, t, GLOCK, 1.5 + k * 0.08, m, 0.2, 0.7, 0.4));
  breath(out, t);
  return out;
}

/** Not first: "well done". A friendly rise on vibes and a warm brass chord, no drum-roll. */
export function finishOk(t: Take): Mono {
  const out = t.canvas(2.8);
  const arp: [number, number][] = [[0, 67], [0.1, 71], [0.2, 74], [0.3, 79]];
  for (const [at, midi] of arp) {
    note(out, t, VIBES, at, midi, 0.25, 0.8);
    note(out, t, GLOCK, at, midi + 12, 0.15, 0.6, 0.3);
  }
  for (const midi of [55, 62, 67, 71, 74]) note(out, t, brass, 0.42, midi, 1.3, 0.55, 0.5);
  note(out, t, VIBES, 0.42, 86, 1.0, 0.8, 0.7);
  note(out, t, GLOCK, 0.9, 91, 0.3, 0.7, 0.4);
  breath(out, t);
  return out;
}

/** A crowd cheering: voices rising on "aah" and "whoo", a roar underneath and hands clapping. */
export function cheer(t: Take): Mono {
  const r = t.rng;
  const seconds = 2.8;
  const out = t.canvas(seconds);
  const voices = 13;
  for (let k = 0; k < voices; k++) {
    const len = r.range(0.7, 1.6);
    const n = t.n(len);
    const f0 = r.range(150, 330) * t.p;
    const track = sampled(n, (u) => f0 * (0.9 + 0.22 * Math.min(1, u * 3) - 0.1 * u) * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * u * len)), 16);
    const src = saw(n, t.sr, track, 0.25, r.next());
    // "aah" or "ooh": two formant sets.
    const aah = r.chance(0.65);
    const voice = formants(src, t.sr, aah
      ? [{ freq: 750, q: 5, amp: 1 }, { freq: 1200, q: 6, amp: 0.6 }, { freq: 2600, q: 8, amp: 0.2 }]
      : [{ freq: 330, q: 5, amp: 1 }, { freq: 800, q: 6, amp: 0.4 }, { freq: 2400, q: 8, amp: 0.1 }]);
    normalize(voice);
    shapeBy(voice, (u) => smooth(u / 0.15) * smooth((1 - u) / 0.4));
    t.put(out, voice, r.range(0, 0.7), r.range(0.05, 0.11));
  }
  const roar = bandNoise(t.n(seconds), t.sr, r, 400, 3200, 2);
  shapeBy(roar, (u) => smooth(u / 0.18) * smooth((1 - u) / 0.45));
  t.put(out, roar, 0, 0.5);
  for (let k = 0; k < 70; k++) {
    const at = 0.25 + r.next() ** 0.8 * 2.2;
    const c = bandpass(white(t.n(0.03), r), t.sr, r.range(700, 1500), r.range(3500, 6500), 2);
    expo(c, t.sr, 0.005, 0.0003);
    t.put(out, c, at, r.range(0.1, 0.3) * smooth((seconds - at) / 0.6));
  }
  return lowpass(out, t.sr, 9000, 2);
}

// --- the duck and the horn -----------------------------------------------------------------------------------------------

/** A rubber duck squeezed: air through the squeaker's reed, rising as the squeeze tightens and sagging as it empties, twice. */
export function duckSqueak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.8);
  const base = r.range(1050, 1350) * t.p;
  const squeak = (len: number, f0: number, f1: number, f2: number): Mono => {
    const n = t.n(len);
    const freq = sampled(n, (u) => (u < 0.3 ? f0 + (f1 - f0) * smooth(u / 0.3) : f1 + (f2 - f1) * ((u - 0.3) / 0.7) ** 1.5), 8);
    const reed = saw(n, t.sr, freq, 0.2, r.next());
    const body = formants(reed, t.sr, [{ freq: 1250, q: 2, amp: 0.4 }, { freq: 2400, q: 3, amp: 1 }, { freq: 3900, q: 5, amp: 0.5 }]);
    normalize(body);
    const air = bandpass(white(n, r), t.sr, 1500, 7000, 2);
    normalize(air);
    for (let i = 0; i < n; i++) body[i] = body[i]! + 0.15 * air[i]!;
    return shapeBy(body, (u) => smooth(u / 0.08) * (u > 0.7 ? smooth((1 - u) / 0.3) : 1));
  };
  t.put(out, squeak(0.17, base * 0.8, base * 1.15, base * 0.95), 0.01, 1);
  t.put(out, squeak(0.22, base * 0.85, base * 1.3, base * 0.9), 0.24, 0.9);
  return out;
}

/** A two-tone horn: a short parp and a long one, each a pair of reeds a third apart. */
export function horn(t: Take): Mono {
  const out = t.canvas(1.0);
  const parp = (at: number, len: number, f: number): void => {
    const n = t.n(len);
    const a = saw(n, t.sr, f * t.rng.range(0.998, 1.002), 0.1, t.rng.next());
    const b = saw(n, t.sr, f * 1.26 * t.rng.range(0.998, 1.002), 0.1, t.rng.next());
    for (let i = 0; i < n; i++) a[i] = a[i]! + 0.8 * b[i]!;
    lowpass(a, t.sr, 1700, 2);
    ar(a, t.sr, 0.012, 0.05);
    t.put(out, a, at, 1);
  };
  parp(0, 0.17, 349);
  parp(0.22, 0.5, 392);
  return out;
}

// --- the interface -----------------------------------------------------------------------------------------------------------

/** Moving between choices: one small marimba knock. */
export function uiSelect(t: Take): Mono {
  const out = t.canvas(0.3);
  note(out, t, MARIMBA, 0, 88, 0.1, 0.7);
  t.put(out, click(t.sr, t.rng, 0.0015, 2000, 9000), 0, 0.05);
  return out;
}

/** Back: a lower, softer knock. */
export function uiBack(t: Take): Mono {
  const out = t.canvas(0.3);
  note(out, t, MARIMBA, 0, 79, 0.1, 0.6);
  t.put(out, click(t.sr, t.rng, 0.0015, 1500, 6000), 0, 0.04);
  return out;
}

/** Ready: two bright notes up a fifth. */
export function uiReady(t: Take): Mono {
  const out = t.canvas(0.7);
  note(out, t, MARIMBA, 0, 84, 0.12, 0.8);
  note(out, t, GLOCK, 0.08, 91, 0.2, 0.85);
  note(out, t, MARIMBA, 0.08, 91, 0.2, 0.7, 0.5);
  return out;
}

/** Someone joins: three notes up the triad. */
export function uiJoin(t: Take): Mono {
  const out = t.canvas(0.8);
  [84, 88, 91].forEach((m, k) => {
    note(out, t, MARIMBA, k * 0.075, m, 0.1, 0.8);
    note(out, t, GLOCK, k * 0.075, m + 12, 0.15, 0.6, 0.3);
  });
  return out;
}

/** Someone leaves: two notes sinking. */
export function uiLeave(t: Take): Mono {
  const out = t.canvas(0.7);
  note(out, t, MARIMBA, 0, 91, 0.1, 0.65);
  note(out, t, MARIMBA, 0.1, 84, 0.18, 0.55);
  return out;
}

/** Start: a rush of air, a rising arpeggio and a bright chord. */
export function uiStart(t: Take): Mono {
  const out = t.canvas(1.4);
  const air = bandNoise(t.n(0.5), t.sr, t.rng, 600, 5000, 2);
  shapeBy(air, (u) => smooth(u / 0.7) * smooth((1 - u) / 0.3));
  t.put(out, air, 0, 0.25);
  [72, 76, 79, 84].forEach((m, k) => {
    note(out, t, MARIMBA, 0.1 + k * 0.07, m, 0.12, 0.85);
    note(out, t, GLOCK, 0.1 + k * 0.07, m + 12, 0.15, 0.6, 0.3);
  });
  for (const m of [72, 76, 79, 84]) note(out, t, VIBES, 0.42, m, 0.5, 0.7, 0.4);
  t.put(out, thump(t, 0.15, 150, 55, 0.002, 0.04), 0.08, 0.35);
  return out;
}

/**
 * The photo finish: a camera's shutter, the mirror flipping up and the blind
 * snapping shut a beat later, each a hard click with a short ring of the body.
 */
export function shutter(t: Take): Mono {
  const out = t.canvas(0.3);
  const clack = (at: number, low: number, high: number, ring: number, gain: number): void => {
    t.put(out, click(t.sr, t.rng, 0.004, low, high), at, gain);
    const body = t.canvas(0.06);
    addMode(body, t.sr, 0, ring * t.rng.range(0.98, 1.02), 1, 0.008, 0);
    addMode(body, t.sr, 0, ring * 2.3, 0.4, 0.005, 1);
    t.put(out, body, at, 0.35 * gain);
  };
  clack(0, 1800, 9000, 1900, 1);
  clack(0.065, 1200, 6000, 1400, 0.75);
  return out;
}

/** A place won: two quick glass notes stepping up a fifth. */
export function placeUp(t: Take): Mono {
  const out = t.canvas(0.55);
  note(out, t, GLOCK, 0, 86, 0.08, 0.7);
  note(out, t, GLOCK, 0.07, 93, 0.12, 0.8);
  return out;
}

/** A place lost: two softer notes stepping down. */
export function placeDown(t: Take): Mono {
  const out = t.canvas(0.55);
  note(out, t, MARIMBA, 0, 84, 0.08, 0.6);
  note(out, t, MARIMBA, 0.08, 77, 0.12, 0.6);
  return out;
}
