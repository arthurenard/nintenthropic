/**
 * The tunes and the crowd inside Grip Prix's sound effects: the countdown, the
 * lap chime, the final-lap sting, the two finish fanfares, the crowd and its
 * applause, a driver's wave and cheer, the horns (one for each driver), the
 * camera of a photo finish and the interface. All original, in C or G major
 * (the countdown in A, climbing its triad), and their pitches exact so they
 * sit with the music, which is in tune with them, instead of against it.
 *
 * Layered like everything else here: a strike, a body, a tail. A fanfare is
 * not a tune on one instrument; it is timpani under brass over bells, a crash
 * and a crowd. The interface is the opposite: small, tactile, a knock of
 * wood and a glint of glass, over before you have noticed it was there.
 */
import { midiHz, sampled, smooth } from "../dsp/curves";
import { bandpass, highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, click, formants, saw, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { type Voice, drumHit, fm, modal } from "../dsp/voices";
import { thump } from "./kit";
import { ar, drive, expo, tone } from "./kart-kit";
import { BELL, BRASS, CHIME, GLASS, KALIMBA, MARIMBA, PIP, STAB, TWANG, air, crackle, knock, note, puff, shower, sweep, tweet, unison } from "./kart-synth";

const VIBES: Voice = modal({
  partials: [[1, 1, 1], [4, 0.28, 0.4], [10, 0.08, 0.15]],
  tau: 0.9, tremolo: { rate: 5.2, depth: 0.3 }, hammer: { level: 0.08, tau: 0.003, low: 4000 }, damp: 0.25,
});
/** A clean blip: FM at 1:1, the index collapsing in a few milliseconds, so a ping with a bite. */
const BLIP: Voice = fm({ ratio: 1, index: 2.2, indexTau: 0.035, tau: 0.16, release: 0.06, attack: 0.002 });

/** A faint noisy breath under tonal sounds: the texture that makes two takes two takes. */
function breath(out: Mono, t: Take, gain = 0.012): void {
  const n = bandpass(white(out.length, t.rng), t.sr, 800, 6000, 2);
  for (let i = 0; i < out.length; i++) out[i]! += gain * n[i]!;
}

// --- the countdown and the laps ---------------------------------------------------------------------------

/** 3, 2, 1: a tight blip (the game plays it at the A major triad's three steps), a wooden tick under it and a glint above. */
export function beepLow(t: Take): Mono {
  const out = t.canvas(0.36);
  note(out, t, BLIP, 0, 69, 0.12, 0.95, 1);
  note(out, t, GLASS, 0, 81, 0.1, 0.6, 0.16);
  t.put(out, thump(t, 0.07, 190, 85, 0.001, 0.016), 0, 0.5);
  t.put(out, click(t.sr, t.rng, 0.0015, 2000, 8000), 0, 0.25);
  breath(out, t);
  return out;
}

/**
 * Go: the A major triad struck by brass over a detuned pad that blooms, a
 * bell an octave above, a kick underneath and a rising rush of air through
 * it all; the loudest, brightest moment of the start.
 */
export function beepHigh(t: Take): Mono {
  const out = t.canvas(1.25);
  [81, 85, 88].forEach((m, k) => note(out, t, STAB, 0.004 * k, m, 0.35, 0.95, 0.5));
  note(out, t, BLIP, 0, 93, 0.3, 1, 0.5);
  note(out, t, BELL, 0.01, 93, 0.3, 0.9, 0.38);
  note(out, t, CHIME, 0.02, 100, 0.5, 0.8, 0.3);
  const pad = unison(t, 1.1, midiHz(69) * t.p, [-12, -5, 0, 5, 12], 3600);
  shapeBy(pad, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.6));
  t.put(out, pad, 0, 0.3);
  t.put(out, thump(t, 0.3, 130, 44, 0.002, 0.07), 0, 0.7);
  t.put(out, air(t, 0.7, 900, 8000, 1.1, puff(0.25, 1.4), 80), 0, 0.2);
  shower(out, t, 0.03, 0.5, 12, 5000, 12000, 0.08, [0.01, 0.04], 1);
  breath(out, t);
  return out;
}

/** A lap done: three notes up the triad (a pluck, a tine, a chime), a swish of the line going by and a low roll under it. */
export function lapChime(t: Take): Mono {
  const out = t.canvas(1.25);
  note(out, t, PIP, 0, 84, 0.12, 0.9, 0.7);
  note(out, t, KALIMBA, 0.09, 88, 0.12, 0.9, 0.7);
  note(out, t, CHIME, 0.18, 91, 0.5, 0.95, 0.85);
  note(out, t, VIBES, 0.18, 79, 0.5, 0.6, 0.35);
  t.put(out, air(t, 0.35, 5200, 1200, 1.6, puff(0.3, 1.8)), 0, 0.18);
  t.put(out, drumHit("tom-low", t.sr, t.rng, 0.55), 0.18, 0.3);
  breath(out, t);
  return out;
}

/**
 * The last lap begins: three hard pick-ups on G, a climb to a bright C major
 * chord in brass over a bell, an alarm-clock riser under the pick-ups and a
 * crash. Short on purpose: the music changes for the last lap on its own, and
 * this must be over before it matters.
 */
export function finalLap(t: Take): Mono {
  const out = t.canvas(1.7);
  const hits: [number, number][] = [[0, 67], [0.1, 67], [0.2, 67]];
  for (const [at, midi] of hits) {
    note(out, t, STAB, at, midi, 0.07, 0.95, 0.9);
    note(out, t, BELL, at, midi + 12, 0.07, 0.8, 0.25);
  }
  t.put(out, air(t, 0.34, 600, 7000, 1.6, (u) => smooth(u / 0.9) * smooth((1 - u) / 0.1), 60), 0, 0.3);
  for (const [k, m] of [72, 76, 79, 84].entries()) note(out, t, BRASS, 0.34, m, 0.5, 0.95, k === 3 ? 0.65 : 0.55);
  note(out, t, BELL, 0.34, 96, 0.3, 0.95, 0.5);
  note(out, t, CHIME, 0.36, 103, 0.6, 0.9, 0.4);
  t.put(out, drumHit("crash", t.sr, t.rng, 0.8), 0.34, 0.4);
  t.put(out, thump(t, 0.4, 120, 40, 0.003, 0.09), 0.34, 0.8);
  breath(out, t);
  return out;
}

// --- finishing ----------------------------------------------------------------------------------------------

/** A roll on the timpani that swells to ``end`` seconds. */
function timpaniRoll(out: Mono, t: Take, from: number, end: number, gain: number): void {
  const hits = Math.round((end - from) / 0.045);
  for (let k = 0; k < hits; k++) {
    const u = k / hits;
    t.put(out, drumHit("timpani", t.sr, t.rng.fork(`timp${k}`), 0.4 + 0.5 * u), from + k * ((end - from) / hits), gain * (0.4 + 0.6 * u));
  }
}

/** A crowd's roar: noise through a vowel-ish band, swelling in and out, with a murmur of voices. */
function roar(t: Take, seconds: number, attack: number, release: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, 350, 3600, 2);
  svf(buf, t.sr, "bp", (u) => 900 + 500 * Math.sin(2 * Math.PI * 1.7 * u * seconds), 0.7);
  normalize(buf);
  return shapeBy(buf, (u) => smooth(u / attack) * smooth((1 - u) / release));
}

/** Confetti cannons: a pop (a short thump and a puff) and a rain of tiny bright bits. */
function confetti(out: Mono, t: Take, at: number, gain = 1): void {
  t.put(out, thump(t, 0.12, 240, 90, 0.001, 0.02), at, 0.7 * gain);
  const puffy = bandNoise(t.n(0.1), t.sr, t.rng, 600, 6000, 2);
  expo(puffy, t.sr, 0.02, 0.0008);
  t.put(out, puffy, at, 0.5 * gain);
  shower(out, t, at + 0.02, 0.4, 14, 4500, 12000, 0.1 * gain, [0.005, 0.02], 1.2);
}

/** First place: a timpani roll, a brass fanfare up the triad over a pad, a held chord with a crash, confetti, a run of bells and a roaring crowd. */
export function finishWin(t: Take): Mono {
  const out = t.canvas(4.0);
  timpaniRoll(out, t, 0, 0.62, 0.7);
  const tune: [number, number, number][] = [[0.62, 67, 0.14], [0.78, 72, 0.14], [0.94, 76, 0.14], [1.1, 79, 0.14], [1.26, 84, 1.9]];
  for (const [at, midi, hold] of tune) {
    note(out, t, BRASS, at, midi, hold, 0.95);
    note(out, t, BELL, at, midi + 12, Math.min(hold, 0.3), 0.8, 0.2);
  }
  for (const midi of [60, 64, 67, 72]) note(out, t, BRASS, 1.26, midi, 1.9, 0.75, 0.5);
  const pad = unison(t, 2.2, midiHz(60), [-14, -6, 0, 6, 14], 2800);
  shapeBy(pad, (u) => smooth(u / 0.06) * smooth((1 - u) / 0.5));
  t.put(out, pad, 1.26, 0.28);
  t.put(out, drumHit("crash", t.sr, t.rng, 0.85), 1.26, 0.5);
  t.put(out, thump(t, 0.5, 110, 38, 0.003, 0.12), 1.26, 0.8);
  confetti(out, t, 1.28, 1);
  confetti(out, t, 1.42, 0.7);
  [91, 95, 98, 103, 107].forEach((m, k) => note(out, t, k % 2 ? GLASS : BELL, 1.5 + k * 0.08, m, 0.2, 0.8, 0.34));
  t.put(out, roar(t, 2.6, 0.12, 0.6), 1.25, 0.22);
  breath(out, t);
  return out;
}

/** Not first: "well done". A friendly rise on vibes, a warm brass chord, a polite pop of confetti and a smaller, warm crowd. */
export function finishOk(t: Take): Mono {
  const out = t.canvas(3.0);
  const arp: [number, number][] = [[0, 67], [0.1, 71], [0.2, 74], [0.3, 79]];
  for (const [at, midi] of arp) {
    note(out, t, VIBES, at, midi, 0.25, 0.8);
    note(out, t, GLASS, at, midi + 12, 0.15, 0.6, 0.3);
  }
  for (const midi of [55, 62, 67, 71, 74]) note(out, t, BRASS, 0.42, midi, 1.3, 0.55, 0.45);
  note(out, t, VIBES, 0.42, 86, 1.0, 0.8, 0.6);
  note(out, t, CHIME, 0.9, 91, 0.3, 0.7, 0.35);
  confetti(out, t, 0.44, 0.5);
  t.put(out, roar(t, 2.2, 0.15, 0.6), 0.4, 0.14);
  breath(out, t);
  return out;
}

/**
 * A crowd cheering: voices rising on "aah" and "whoo", a roar underneath, hands
 * clapping and, over it, one two-finger whistle.
 */
export function cheer(t: Take): Mono {
  const r = t.rng;
  const seconds = 2.8;
  const out = t.canvas(seconds);
  for (let k = 0; k < 14; k++) {
    const len = r.range(0.7, 1.6);
    const n = t.n(len);
    const f0 = r.range(150, 330) * t.p;
    const track = sampled(n, (u) => f0 * (0.9 + 0.22 * Math.min(1, u * 3) - 0.1 * u) * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * u * len)), 16);
    const src = saw(n, t.sr, track, 0.25, r.next());
    const aah = r.chance(0.65);
    const voice = formants(src, t.sr, aah
      ? [{ freq: 750, q: 5, amp: 1 }, { freq: 1200, q: 6, amp: 0.6 }, { freq: 2600, q: 8, amp: 0.2 }]
      : [{ freq: 330, q: 5, amp: 1 }, { freq: 800, q: 6, amp: 0.4 }, { freq: 2400, q: 8, amp: 0.1 }]);
    normalize(voice);
    shapeBy(voice, (u) => smooth(u / 0.15) * smooth((1 - u) / 0.4));
    t.put(out, voice, r.range(0, 0.7), r.range(0.05, 0.11));
  }
  t.put(out, roar(t, seconds, 0.18, 0.45), 0, 0.45);
  for (let k = 0; k < 70; k++) {
    const at = 0.25 + r.next() ** 0.8 * 2.2;
    const c = bandpass(white(t.n(0.03), r), t.sr, r.range(700, 1500), r.range(3500, 6500), 2);
    expo(c, t.sr, 0.005, 0.0003);
    t.put(out, c, at, r.range(0.1, 0.3) * smooth((seconds - at) / 0.6));
  }
  // One whistle: up, hold, a flick at the end.
  const wh = sweep(t, 0.6, (u) => 2300 * (u < 0.15 ? 0.85 + u : 1 + (u > 0.8 ? 0.2 * (u - 0.8) : 0)), 0.04, 0, 11, 0.01);
  shapeBy(wh, (u) => smooth(u / 0.08) * smooth((1 - u) / 0.3));
  t.put(out, wh, 0.5, 0.045);
  return lowpass(out, t.sr, 9000, 2);
}

/** Applause: hands clapping, thin at first, thickening to a wall and fading, with a murmur of approval beneath. */
export function applause(t: Take): Mono {
  const seconds = 3.4;
  const out = t.canvas(seconds);
  for (let k = 0; k < 240; k++) {
    const u = t.rng.next();
    // The density rises quickly and falls slowly.
    const at = 0.05 + (u < 0.3 ? Math.pow(u / 0.3, 0.8) * 0.9 : 0.9 + ((u - 0.3) / 0.7) * 2.2);
    const cl = bandpass(white(t.n(0.04), t.rng), t.sr, t.rng.range(600, 1800), t.rng.range(3000, 7000), 2);
    expo(cl, t.sr, t.rng.range(0.003, 0.009), 0.0003);
    t.put(out, cl, at, t.rng.range(0.1, 0.35) * smooth((seconds - at) / 0.9));
  }
  t.put(out, roar(t, seconds, 0.2, 0.55), 0, 0.2);
  return lowpass(out, t.sr, 10500, 2);
}

/** A driver cheers (both hands up): a party blower, a pop of confetti and a happy "yay" of two voices. */
export function emoteCheer(t: Take): Mono {
  const out = t.canvas(0.95);
  const blow = sweep(t, 0.3, (u) => 480 * Math.pow(2.2, Math.sin(Math.PI * u * 0.9)), 0.4, 0.3);
  drive(blow, 2);
  shapeBy(blow, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.2));
  t.put(out, blow, 0, 0.3);
  const rasp = highpass(white(t.n(0.3), t.rng), t.sr, 2500, 2);
  shapeBy(rasp, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.2));
  t.put(out, rasp, 0, 0.05);
  confetti(out, t, 0.28, 0.8);
  for (let k = 0; k < 2; k++) {
    const n = t.n(0.45);
    const f0 = t.rng.range(250, 380) * t.p;
    const src = saw(n, t.sr, sampled(n, (u) => f0 * (0.9 + 0.25 * smooth(u * 2)), 16), 0.2, t.rng.next());
    const v = formants(src, t.sr, [{ freq: (u: number) => 800 - 300 * smooth(u * 2), q: 5, amp: 1 }, { freq: (u: number) => 1300 + 900 * smooth(u * 2), q: 6, amp: 0.5 }, { freq: 2700, q: 8, amp: 0.15 }]);
    normalize(v);
    shapeBy(v, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.45));
    t.put(out, v, 0.3 + 0.03 * k, 0.2);
  }
  note(out, t, CHIME, 0.3, 91, 0.3, 0.85, 0.45);
  note(out, t, CHIME, 0.4, 96, 0.4, 0.9, 0.45);
  return lowpass(out, t.sr, 11000, 1);
}

/** A driver waves (one hand): a friendly "hel-lo" on two kalimba tines, up a third, and a swish of the hand through the air. */
export function emoteWave(t: Take): Mono {
  const out = t.canvas(0.7);
  note(out, t, KALIMBA, 0, 91, 0.1, 0.8, 0.8);
  note(out, t, KALIMBA, 0.11, 95, 0.12, 0.85, 0.85);
  note(out, t, GLASS, 0.11, 107, 0.1, 0.6, 0.22);
  const swish = air(t, 0.3, 3500, 1400, 1.4, (u) => Math.sin(Math.PI * Math.min(1, u)) ** 1.5);
  t.put(out, swish, 0.02, 0.14);
  return out;
}

// --- the duck and the horns ---------------------------------------------------------------------------------------

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
    const hiss = bandpass(white(n, r), t.sr, 1500, 7000, 2);
    normalize(hiss);
    for (let i = 0; i < n; i++) body[i] = body[i]! + 0.15 * hiss[i]!;
    return shapeBy(body, (u) => smooth(u / 0.08) * (u > 0.7 ? smooth((1 - u) / 0.3) : 1));
  };
  t.put(out, squeak(0.17, base * 0.8, base * 1.15, base * 0.95), 0.01, 1);
  t.put(out, squeak(0.22, base * 0.85, base * 1.3, base * 0.9), 0.24, 0.9);
  return out;
}

/** A reed horn: ``freqs`` sounding together, each a pair of detuned saws, through a low-pass that opens as the note starts ("bwa"). */
function reedHorn(t: Take, out: Mono, at: number, len: number, freqs: readonly number[], cutoff: number, gain = 1): void {
  const n = t.n(len);
  const sum = new Float32Array(n);
  for (const f of freqs) {
    for (const c of [-6, 6]) {
      const s = saw(n, t.sr, f * Math.pow(2, c / 1200) * t.rng.range(0.999, 1.001), 0.1, t.rng.next());
      for (let i = 0; i < n; i++) sum[i]! += s[i]! / (freqs.length * 2);
    }
  }
  svf(sum, t.sr, "lp", (u) => cutoff * (0.35 + 0.65 * smooth(u * len / 0.05)), 1.4);
  ar(sum, t.sr, 0.01, 0.05);
  t.put(out, sum, at, gain);
}

/** The classic car horn: a short parp and a long one, a third apart, brassy. (Kit's, and anyone's without a horn of their own.) */
export function horn(t: Take): Mono {
  const out = t.canvas(1.0);
  reedHorn(t, out, 0, 0.17, [349, 440], 2400);
  reedHorn(t, out, 0.22, 0.5, [392, 494], 2400);
  t.put(out, thump(t, 0.1, 160, 70, 0.002, 0.025), 0, 0.2);
  return out;
}

/** Bun's: a party blower, a reedy "pa-pwee" that scoops up, and a roll of the paper unrolling. */
export function hornParty(t: Take): Mono {
  const out = t.canvas(0.8);
  const n = t.n(0.5);
  const f = sampled(n, (u) => 520 * Math.pow(1.9, smooth(u / 0.25)) * (u > 0.8 ? 1 - 0.3 * (u - 0.8) : 1), 16);
  const reed = saw(n, t.sr, f, 0.15, 0.3);
  const body = formants(reed, t.sr, [{ freq: 1100, q: 3, amp: 1 }, { freq: 2800, q: 4, amp: 0.6 }]);
  normalize(body);
  shapeBy(body, (u) => smooth(u / 0.04) * smooth((1 - u) / 0.18));
  t.put(out, body, 0, 0.9);
  t.put(out, thump(t, 0.08, 220, 100, 0.001, 0.015), 0, 0.3);
  const tail = air(t, 0.2, 2500, 5500, 2, puff(0.2, 2));
  t.put(out, tail, 0.45, 0.1);
  return out;
}

/** Pepper's: a bicycle bulb horn, a rubbery "hoo-onk": FM that bends up into the note and sags out of it. */
export function hornSqueeze(t: Take): Mono {
  const out = t.canvas(0.8);
  const n = t.n(0.55);
  const f = sampled(n, (u) => 330 * (u < 0.15 ? 0.7 + 2 * u : 1) * (u > 0.7 ? 1 - 0.28 * smooth((u - 0.7) / 0.3) : 1), 16);
  const v = tone(n, t.sr, f, 0.7, 0.55);
  const mod = tone(n, t.sr, Float32Array.from(f, (x) => x * 1.01), 0.3, 0.2);
  for (let i = 0; i < n; i++) v[i] = v[i]! * (0.75 + 0.25 * mod[i]!);
  drive(v, 2.4);
  lowpass(v, t.sr, 2600, 2);
  shapeBy(v, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.25));
  t.put(out, v, 0, 1);
  return out;
}

/** Moss's: a frog's "rib-bit": two throaty pulses, the first low and the second a hop higher, each a croak of pulsed noise on a sine. */
export function hornRibbit(t: Take): Mono {
  const out = t.canvas(0.75);
  const croak = (at: number, len: number, f: number): void => {
    const n = t.n(len);
    const base = tone(n, t.sr, sampled(n, (u) => f * (1 + 0.35 * u), 16), 0.5, 0.3);
    for (let i = 0; i < n; i++) base[i]! *= 0.5 + 0.5 * Math.sin((2 * Math.PI * 42 * i) / t.sr);
    const body = formants(base, t.sr, [{ freq: 520, q: 4, amp: 1 }, { freq: 1500, q: 5, amp: 0.4 }]);
    normalize(body);
    shapeBy(body, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.3));
    t.put(out, body, at, 1);
  };
  croak(0, 0.2, 150);
  croak(0.26, 0.28, 195);
  return out;
}

/** Juniper's: a steam whistle: three low sines in a chord, breath in them, a slow attack and a sag. */
export function hornSteam(t: Take): Mono {
  const out = t.canvas(1.2);
  const n = t.n(0.95);
  const sum = new Float32Array(n);
  [392, 494, 587].forEach((f, k) => {
    const track = sampled(n, (u) => f * (u < 0.1 ? 0.96 + 0.4 * u : 1) * (u > 0.75 ? 1 - 0.05 * smooth((u - 0.75) / 0.25) : 1) * (1 + 0.004 * Math.sin(2 * Math.PI * (5.5 + k) * u)), 16);
    const v = tone(n, t.sr, track, 0.25, 0.1);
    for (let i = 0; i < n; i++) sum[i]! += v[i]! / 3;
  });
  const breathy = bandNoise(n, t.sr, t.rng, 2500, 7000, 2);
  for (let i = 0; i < n; i++) sum[i]! += 0.1 * breathy[i]!;
  shapeBy(sum, (u) => smooth(u / 0.12) * smooth((1 - u) / 0.28));
  t.put(out, sum, 0, 1);
  return out;
}

/** Mango's: a bicycle bell, ting-ting: a struck metal cup, bright and long. */
export function hornBell(t: Take): Mono {
  const out = t.canvas(1.2);
  for (const at of [0, 0.15]) {
    note(out, t, BELL, at, 103, 0.3, 0.95, 0.8);
    addMode(out, t.sr, at, midiHz(103) * 1.007, 0.35, 0.35, 0.5);
    addMode(out, t.sr, at, midiHz(103) * 2.4, 0.18, 0.18, 1);
    t.put(out, click(t.sr, t.rng, 0.002, 3000, 12000), at, 0.4);
  }
  return out;
}

/** Bramble's: a tuba: a low square-ish saw an octave and more under the others, a long "paaarp" with a sub under it. */
export function hornTuba(t: Take): Mono {
  const out = t.canvas(1.1);
  const n = t.n(0.75);
  const f = sampled(n, (u) => 98 * (u < 0.1 ? 0.93 + 0.7 * u : 1) * (u > 0.8 ? 1 - 0.1 * (u - 0.8) : 1), 16);
  const a = saw(n, t.sr, f, 0.3, 0.1);
  const b = saw(n, t.sr, Float32Array.from(f, (x) => x * 1.006), 0.3, 0.6);
  for (let i = 0; i < n; i++) a[i] = (a[i]! + b[i]!) * 0.5;
  svf(a, t.sr, "lp", (u) => 500 + 700 * smooth(u / 0.1), 1.6);
  const sub = tone(n, t.sr, f, 0.4);
  for (let i = 0; i < n; i++) a[i]! += 0.5 * sub[i]!;
  shapeBy(a, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.2));
  t.put(out, a, 0, 1);
  return out;
}

/** Rivet's: a robot's honk: a square wave with FM, bit-crunched, "bzzt-bip", two short blips and a rising one. */
export function hornRobot(t: Take): Mono {
  const out = t.canvas(0.75);
  const blip = (at: number, len: number, f0: number, f1: number): void => {
    const n = t.n(len);
    const track = sampled(n, (u) => f0 * Math.pow(f1 / f0, u), 16);
    const v = tone(n, t.sr, track, 0.5, 0.45);
    const m = tone(n, t.sr, Float32Array.from(track, (x) => x * 2.01), 0);
    for (let i = 0; i < n; i++) v[i] = Math.round((v[i]! + 0.35 * m[i]!) * 6) / 6;
    lowpass(v, t.sr, 4200, 1);
    ar(v, t.sr, 0.004, 0.02);
    t.put(out, v, at, 0.9);
  };
  blip(0, 0.1, 330, 330);
  blip(0.13, 0.08, 330, 440);
  blip(0.25, 0.28, 440, 660);
  return out;
}

// --- the camera -------------------------------------------------------------------------------------------------------------

/**
 * The photo finish: a flash charging (a whine climbing in a tenth of a
 * second), the shutter's two clacks, mirror then blind, each a hard click with
 * a ring of the body, and the pop of the flash.
 */
export function shutter(t: Take): Mono {
  const out = t.canvas(0.36);
  const charge = sweep(t, 0.11, (u) => 1400 * Math.pow(3.2, u), 0.1);
  ar(charge, t.sr, 0.005, 0.03);
  t.put(out, charge, 0, 0.1);
  const clack = (at: number, low: number, high: number, ring: number, gain: number): void => {
    t.put(out, click(t.sr, t.rng, 0.004, low, high), at, gain);
    const body = t.canvas(0.06);
    addMode(body, t.sr, 0, ring * t.rng.range(0.98, 1.02), 1, 0.008, 0);
    addMode(body, t.sr, 0, ring * 2.3, 0.4, 0.005, 1);
    t.put(out, body, at, 0.35 * gain);
  };
  clack(0.12, 1800, 9000, 1900, 1);
  clack(0.185, 1200, 6000, 1400, 0.75);
  const flash = bandNoise(t.n(0.05), t.sr, t.rng, 3000, 14000, 2);
  expo(flash, t.sr, 0.012, 0.0005);
  t.put(out, flash, 0.12, 0.3);
  return out;
}

// --- the interface -----------------------------------------------------------------------------------------------------------

/** Moving between choices: one small tine, a hair of wood under it. */
export function uiSelect(t: Take): Mono {
  const out = t.canvas(0.3);
  note(out, t, KALIMBA, 0, 88, 0.08, 0.7, 1);
  knock(out, t, 0, 1500, 0.12, 0.004);
  return out;
}

/** Back: a lower, softer tine. */
export function uiBack(t: Take): Mono {
  const out = t.canvas(0.3);
  note(out, t, MARIMBA, 0, 79, 0.1, 0.6, 1);
  knock(out, t, 0, 900, 0.1, 0.004);
  return out;
}

/** Ready: two bright notes up a fifth, a tine and a bell, and a glint. */
export function uiReady(t: Take): Mono {
  const out = t.canvas(0.7);
  note(out, t, KALIMBA, 0, 84, 0.12, 0.8, 0.8);
  note(out, t, CHIME, 0.08, 91, 0.3, 0.85, 0.8);
  note(out, t, GLASS, 0.1, 103, 0.1, 0.6, 0.18);
  return out;
}

/** Someone joins: three notes up the triad and a little bubble of a pop. */
export function uiJoin(t: Take): Mono {
  const out = t.canvas(0.85);
  [84, 88, 91].forEach((m, k) => {
    note(out, t, KALIMBA, k * 0.075, m, 0.1, 0.8, 0.8);
    note(out, t, GLASS, k * 0.075, m + 12, 0.12, 0.6, 0.2);
  });
  t.put(out, thump(t, 0.06, 420, 180, 0.001, 0.012), 0, 0.3);
  return out;
}

/** Someone leaves: two notes sinking, soft. */
export function uiLeave(t: Take): Mono {
  const out = t.canvas(0.7);
  note(out, t, MARIMBA, 0, 91, 0.1, 0.65, 1);
  note(out, t, MARIMBA, 0.1, 84, 0.18, 0.55, 0.9);
  return out;
}

/** Start: a rush of air, a rising arpeggio, a bright chord, and a thump that lands it. */
export function uiStart(t: Take): Mono {
  const out = t.canvas(1.5);
  t.put(out, air(t, 0.5, 600, 6000, 1.3, (u) => smooth(u / 0.7) * smooth((1 - u) / 0.3)), 0, 0.25);
  [72, 76, 79, 84].forEach((m, k) => {
    note(out, t, KALIMBA, 0.1 + k * 0.07, m, 0.12, 0.85, 0.8);
    note(out, t, GLASS, 0.1 + k * 0.07, m + 12, 0.15, 0.6, 0.25);
  });
  for (const m of [72, 76, 79, 84]) note(out, t, VIBES, 0.42, m, 0.5, 0.7, 0.4);
  note(out, t, CHIME, 0.42, 96, 0.5, 0.9, 0.4);
  t.put(out, thump(t, 0.2, 150, 52, 0.002, 0.045), 0.4, 0.5);
  return out;
}

/** A place won: two quick plucks stepping up a fifth, and a glint. */
export function placeUp(t: Take): Mono {
  const out = t.canvas(0.55);
  note(out, t, PIP, 0, 86, 0.08, 0.8, 0.9);
  note(out, t, PIP, 0.07, 93, 0.12, 0.9, 1);
  note(out, t, GLASS, 0.08, 105, 0.1, 0.6, 0.18);
  return out;
}

/** A place lost: two softer marimba notes stepping down. */
export function placeDown(t: Take): Mono {
  const out = t.canvas(0.55);
  note(out, t, MARIMBA, 0, 84, 0.08, 0.6, 1);
  note(out, t, MARIMBA, 0.08, 77, 0.12, 0.6, 1);
  return out;
}
