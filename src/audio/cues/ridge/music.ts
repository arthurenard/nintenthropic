/**
 * The music: stingers and chimes in D, every pitch exact (see ./index.ts). A
 * muted horn, low strings, a soft drum, a chime and a pluck, and what they
 * play when a stage begins and is cleared, for a secret, the streak, a kill,
 * the game over and the golden rifle.
 */
import { midiHz, sampled, smooth } from "../../dsp/curves";
import { biquad, highpass, lowpass, svf } from "../../dsp/filters";
import { type Mono, adsr, fade, normalize, shapeBy, tailOff } from "../../dsp/signal";
import { addMode, addString, bandNoise, click, saw, white } from "../../dsp/sources";
import { room, roomMono } from "../../dsp/space";
import type { Take } from "../../dsp/take";
import { burst, thump } from "../kit";
import { ridgeBolt } from "./rifle";

/**
 * A muted horn: a lip reed's buzz (a band-limited sawtooth, a small scoop
 * up into the note) whose brightness follows its loudness as brass does,
 * through the nasal peak of a mute, swelling in over ``swell`` seconds.
 */
function horn(out: Mono, t: Take, at: number, midi: number, dur: number, gain: number, swell = 0.25): void {
  const r = t.rng;
  const n = t.n(dur);
  const f = midiHz(midi) * Math.pow(2, r.range(-3, 3) / 1200);
  const env = sampled(n, (u) => {
    const s = u * dur;
    return smooth(s / swell) * smooth((dur - s) / 0.35);
  });
  const freq = sampled(n, (u) => {
    const s = u * dur;
    return f * (1 - 0.012 * Math.exp(-s / 0.05)) * (1 + 0.004 * Math.sin(2 * Math.PI * 5 * s) * smooth((s - 0.4) / 0.4));
  });
  const buzz = saw(n, t.sr, freq, 0, r.next());
  svf(buzz, t.sr, "lp", (u) => f * (1.2 + 5 * env[Math.min(n - 1, Math.floor(u * n))]!), 0.8, 32);
  biquad(buzz, t.sr, "peak", 1100, 1.4, 4);
  biquad(buzz, t.sr, "highshelf", 3500, 0.7, -8);
  for (let i = 0; i < n; i++) buzz[i]! *= env[i]!;
  t.put(out, buzz, at, gain);
}

/**
 * Low strings: three bowed voices a note, a few cents apart, each with its
 * own vibrato, through a warm body, swelling in over ``attack``.
 */
function strings(out: Mono, t: Take, at: number, notes: readonly number[], dur: number, gain: number, attack: number): void {
  const r = t.rng;
  const n = t.n(dur);
  const sum = new Float32Array(n);
  for (const midi of notes) {
    for (let v = 0; v < 3; v++) {
      const f = midiHz(midi) * Math.pow(2, ((v - 1) * r.range(4, 8)) / 1200);
      const rate = r.range(4.6, 5.8);
      const ph = r.range(0, 6.28);
      const s = saw(n, t.sr, sampled(n, (u) => f * (1 + 0.003 * Math.sin(2 * Math.PI * rate * u * dur + ph))), 0, r.next());
      for (let i = 0; i < n; i++) sum[i]! += s[i]! / notes.length;
    }
  }
  lowpass(sum, t.sr, 2200, 2);
  biquad(sum, t.sr, "peak", 250, 0.8, 3);
  highpass(sum, t.sr, 45, 2);
  adsr(sum, t.sr, attack, 0.3, 0.85, Math.min(0.8, dur * 0.4));
  t.put(out, sum, at, gain);
}

/** A low drum struck with a soft mallet: the membrane's falling thump and its inharmonic modes, felt more than heard. */
function softDrum(out: Mono, t: Take, at: number, f0: number, gain: number): void {
  const r = t.rng;
  t.put(out, thump(t, 1.2, f0 * 1.5, f0, 0.004, 0.22, 0.35), at, gain);
  [1.59, 2.14, 2.3, 2.65].forEach((ratio, k) => {
    addMode(out, t.sr, at, f0 * ratio * r.range(0.99, 1.01), gain * 0.25 * 0.75 ** k, 0.14 * 0.8 ** k, 0);
  });
  t.put(out, burst(t, 0.05, 100, 1500, 0.002, 0.008), at, gain * 0.2);
  t.put(out, burst(t, 0.6, 30, 180, 0.004, 0.12, 4), at, gain * 0.5);
}

/** A music box's tine (a steel cantilever: partials at 1 and 6.27 of the note) plucked by a pin: a clear chime and a tiny tick. */
function chime(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const f = midiHz(midi) * Math.pow(2, t.rng.range(-3, 3) / 1200);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 6.27, gain * 0.2, tau * 0.12, 0);
  addMode(out, t.sr, at, f * 1.002, gain * 0.15, tau * 0.8, 0);
  t.put(out, click(t.sr, t.rng, 0.001, 3000, 12000), at, gain * 0.06);
}

/**
 * A steel string plucked bright and close. The pick leaves the string over a
 * millisecond, and its noise is a pick's, not a file's: the string rings
 * bright without a crackle at the start, which in the reward, heard again
 * and again and pitched up a fifth at ×4, would turn harsh.
 */
function pluck(out: Mono, t: Take, at: number, midi: number, vel: number, t60: number): void {
  const note = t.canvas(t60 + 0.2);
  addString(note, t.sr, t.rng, 0, midiHz(midi), vel, { t60, brightness: 0.9, position: 0.14, hardness: 4500, length: t60, release: 0.15 });
  fade(note, t.sr, 0.001, 0);
  t.put(out, note, at, 1);
  t.put(out, click(t.sr, t.rng, 0.0012, 2000, 9000), at, 0.03 * vel);
}

/**
 * A stage begins: a soft low drum and a brushed shimmer, the low strings
 * swelling on an open D (a fifth with the ninth: cool, not sweet), and a
 * muted horn calling up a fourth, A to D, like an alphorn across the valley.
 */
export function ridgeStageStart(t: Take): Mono[] {
  const r = t.rng;
  const dry = t.canvas(3.4);
  softDrum(dry, t, 0.01, r.range(50, 56), 0.9);
  const shimmer = bandNoise(t.n(0.9), t.sr, r, 5000, 12000, 2);
  adsr(shimmer, t.sr, 0.004, 0.2, 0.2, 0.5);
  t.put(dry, shimmer, 0.01, 0.05);
  strings(dry, t, 0, [38, 45, 50, 52], 3.1, 0.5, 0.9);
  horn(dry, t, t.j(0.35, 0.1), 57, 0.7, 0.4);
  horn(dry, t, t.j(1.0, 0.05), 62, 1.9, 0.5, 0.35);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, r, { t60: 2.2, size: 1, damping: 0.35, mix: 0.35, predelay: 0.03, tail: 0.5 });
}

/**
 * A stage cleared: the strings on A with the fourth suspended, easing onto
 * the third, then home to D; the horn stepping up to the D chord's third
 * over it; a music-box chime on the resolution.
 */
export function ridgeStageClear(t: Take): Mono[] {
  const dry = t.canvas(2.9);
  strings(dry, t, 0, [45, 50, 52, 57], 0.75, 0.45, 0.12);
  strings(dry, t, 0.55, [45, 49, 52, 57], 0.45, 0.4, 0.08);
  strings(dry, t, 0.95, [38, 45, 50, 54, 57], 1.8, 0.5, 0.1);
  horn(dry, t, 0.05, 64, 0.85, 0.3, 0.12);
  horn(dry, t, 0.95, 66, 1.6, 0.4, 0.1);
  chime(dry, t, 0.95, 86, 0.1, 0.5);
  chime(dry, t, t.j(1.07, 0.03), 90, 0.08, 0.6);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, t.rng, { t60: 1.8, size: 0.9, damping: 0.4, mix: 0.3, predelay: 0.02, tail: 0.3 });
}

/** A secret found: a music box turning a little figure up through D major and back down to rest. */
export function ridgeSecret(t: Take): Mono {
  const r = t.rng;
  const tempo = r.range(0.95, 1.05);
  const figure: readonly [number, number][] = [[0, 81], [0.12, 86], [0.24, 90], [0.36, 93], [0.54, 91], [0.66, 90], [0.78, 88]];
  const out = t.canvas(1.9);
  for (const [at, midi] of figure) chime(out, t, 0.01 + at * tempo + r.range(-0.004, 0.004), midi, r.range(0.3, 0.4), 0.35);
  const last = 0.01 + 0.96 * tempo;
  chime(out, t, last, 86, 0.45, 0.8);
  chime(out, t, last + 0.004, 93, 0.25, 0.7);
  tailOff(out, t.sr, 0.3);
  return roomMono(out, t.sr, r, { t60: 0.8, size: 0.5, damping: 0.4, mix: 0.2, predelay: 0.008, tail: 0.2 });
}

/** The streak rises: a bright pluck up a fourth, A to D, a little bell over the second. Exact pitch, so a game can raise it by rate. */
export function ridgeStreak(t: Take): Mono {
  const out = t.canvas(0.62);
  pluck(out, t, 0.005, 81, 0.7, 0.6);
  pluck(out, t, 0.07, 86, 0.8, 0.7);
  chime(out, t, 0.07, 98, 0.06, 0.25);
  return tailOff(out, t.sr, 0.2);
}

/**
 * A kill confirmed: a soft low *thock* — a woodblock struck gently — with
 * the mallet pressing in over a millisecond and a half, so it is a tick you
 * feel rather than a click you hear.
 */
export function ridgeKill(t: Take): Mono {
  const r = t.rng;
  const note = t.canvas(0.2);
  const f = r.range(270, 300);
  addMode(note, t.sr, 0, f, 0.7, t.d(0.028), 0);
  addMode(note, t.sr, 0, f * 2.72, t.g(0.2, 3) * r.sign(), t.d(0.012), 0);
  addMode(note, t.sr, 0, f * 4.3, t.g(0.06, 3) * r.sign(), t.d(0.006), 0);
  t.put(note, burst(t, 0.03, 60, 600, 0.0015, 0.008, 2), 0, 0.2);
  fade(note, t.sr, 0.0015, 0.01);
  return note;
}

/** Game over: the low strings on D minor, a muted horn falling from A to the low D, and a soft drum as it lands. */
export function ridgeGameOver(t: Take): Mono[] {
  const r = t.rng;
  const dry = t.canvas(4.2);
  strings(dry, t, 0, [38, 45, 50, 53], 3.9, 0.55, 0.6);
  horn(dry, t, 0.15, 57, 1.1, 0.35);
  horn(dry, t, 1.25, 50, 2.5, 0.4);
  softDrum(dry, t, 1.25, r.range(42, 46), 0.6);
  tailOff(dry, t.sr, 0.9);
  return room(dry, t.sr, r, { t60: 2.4, size: 1, damping: 0.35, mix: 0.35, predelay: 0.02, tail: 0.4 });
}

/** The golden rifle: its bolt worked, a bright arpeggio chiming up through D major, a glint and a shimmer of high bells. */
export function ridgeGolden(t: Take): Mono[] {
  const r = t.rng;
  const dry = t.canvas(2.8);
  t.put(dry, ridgeBolt(t), 0, 0.4);
  [86, 90, 93, 98, 102].forEach((midi, k) => chime(dry, t, 0.55 + k * 0.085, midi, 0.35, 0.9));
  const glint = white(t.n(0.25), r);
  svf(glint, t.sr, "bp", (u) => 1500 * Math.pow(6, u), 3, 16);
  normalize(glint);
  shapeBy(glint, (u) => Math.sin(Math.PI * u) ** 2);
  t.put(dry, glint, 0.85, 0.18);
  for (let k = 0; k < 10; k++) addMode(dry, t.sr, 0.9 + k * 0.04, r.range(5000, 9500), 0.03, 0.25, 0);
  tailOff(dry, t.sr, 0.6);
  return room(dry, t.sr, r, { t60: 1.6, size: 0.9, damping: 0.4, mix: 0.3, predelay: 0.015, tail: 0.2 });
}
