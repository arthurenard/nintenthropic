/**
 * Orbital Decay's sounds. Out there nothing makes a sound: no shot, no
 * explosion, no debris going by. What you hear is the inside of the station
 * - its fans and pumps, the laser's capacitor charging and its thump
 * through the mount, the heat gauge's tick, the vent's hiss, the master
 * alarm's soft two-tone, the radio's Quindar beeps and chatter - and the
 * hull: a strike on the glass is a sharp crack, loud and close; a strike
 * on the station a dull boom through the structure; a pane failing is the
 * roar of the air going, then nothing.
 *
 * Its cues are a pack of their own ("orbit"), synthesised when the game
 * loads, and joined to the table (./table.ts) as ORBIT_CUES.
 */
import { bandpass, highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, adsr, fade, normalize, shapeBy, tailOff } from "../dsp/signal";
import { addMetal, addMode, bandNoise, click, pink, sweep, white } from "../dsp/sources";
import { room, roomMono } from "../dsp/space";
import { loopify, wrap } from "../dsp/master";
import type { Take } from "../dsp/take";
import { addShard, burst, creak, scatter, thump, wanderTrack } from "./kit";
import type { CueSpec } from "./table";

// --- small instruments ----------------------------------------------------------

/**
 * A soft electronic tone: a sine (and a little of its octave) with rounded
 * edges, the way a station's panels speak - never a buzzer.
 */
function tone(out: Mono, t: Take, at: number, freq: number, dur: number, amp: number, attack = 0.012, release = 0.04, octave = 0.12): void {
  const n = t.n(dur);
  const buf = sweep(n, t.sr, freq);
  if (octave > 0) {
    const up = sweep(n, t.sr, freq * 2);
    for (let i = 0; i < n; i++) buf[i] = buf[i]! + octave * up[i]!;
  }
  adsr(buf, t.sr, attack, dur * 0.5, 0.85, release);
  t.put(out, buf, at, amp);
}

/** Radio static: a band-limited hiss with crackle, as a headset hears it. */
function staticNoise(t: Take, seconds: number): Mono {
  const buf = bandNoise(t.n(seconds), t.sr, t.rng, 350, 3200, 2);
  const crackle = new Float32Array(buf.length);
  scatter(crackle, t, Math.round(seconds * 40), 0, seconds, 1500, 5000, 0.6, 1);
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * 0.35 + crackle[i]!;
  return buf;
}

/**
 * Speech through a radio, not words: a voice-like buzz (a glottal pulse
 * train through wandering formants) cut into syllables, band-limited.
 */
function babble(t: Take, seconds: number): Mono {
  const r = t.rng;
  const n = t.n(seconds);
  const pitch = r.range(105, 150) * t.p;
  const walk = wanderTrack(n, r, 5, t.sr);
  const src = sweep(n, t.sr, (u) => pitch * (0.92 + 0.16 * walk(u)));
  // A buzzier source: fold the sine into a pulse-ish wave.
  for (let i = 0; i < n; i++) src[i] = Math.tanh(src[i]! * 4);
  const f1 = wanderTrack(n, r.fork(1), 6, t.sr);
  const f2 = wanderTrack(n, r.fork(2), 7, t.sr);
  const a = svf(Float32Array.from(src), t.sr, "bp", (u) => 400 + 450 * f1(u), 6, 32);
  const b = svf(Float32Array.from(src), t.sr, "bp", (u) => 1100 + 900 * f2(u), 8, 32);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i]! + 0.6 * b[i]!;
  // Syllables: on for a tenth of a second or so, a breath between phrases.
  let at = 0;
  const gate = new Float32Array(n);
  while (at < seconds) {
    const len = r.range(0.07, 0.2);
    const s = t.n(at);
    const e = Math.min(n, t.n(at + len));
    for (let i = s; i < e; i++) {
      const u = (i - s) / Math.max(1, e - s);
      gate[i] = Math.sin(Math.PI * u);
    }
    at += len + (r.chance(0.18) ? r.range(0.15, 0.3) : r.range(0.01, 0.05));
  }
  for (let i = 0; i < n; i++) out[i] = out[i]! * gate[i]!;
  bandpass(out, t.sr, 300, 3000, 2);
  return normalize(out);
}

// --- the station ------------------------------------------------------------------

/**
 * The station's fans and pumps: a low, clean hum - the blade-pass tone of
 * the air handlers and its harmonics, moving air, a coolant pump's slow
 * throb far down the hull - the sound of a place that is always running.
 */
export function orbitHum(t: Take): Mono[] {
  const r = t.rng;
  const length = t.n(r.range(5.5, 6.5));
  const n = length + t.n(0.6);
  const make = (label: number): Mono => {
    const rc = r.fork(label);
    const out = new Float32Array(n);
    const air = pink(n, rc);
    lowpass(air, t.sr, 700 * t.p, 2);
    highpass(air, t.sr, 60, 2);
    normalize(air);
    const blade = 118 * t.p * rc.range(0.99, 1.01);
    const wob = wanderTrack(n, rc, 0.4, t.sr);
    for (const [h, amp] of [
      [1, 0.5],
      [2, 0.22],
      [3, 0.12],
      [5, 0.05],
    ] as const) {
      const s = sweep(n, t.sr, (u) => blade * h * (1 + 0.004 * (wob(u) - 0.5)), rc.range(0, 6));
      for (let i = 0; i < n; i++) out[i] = out[i]! + amp * s[i]!;
    }
    // The pump: a 60 Hz tone breathing in and out.
    const pump = sweep(n, t.sr, 60 * t.p, rc.range(0, 6));
    for (let i = 0; i < n; i++) {
      const throb = 0.5 + 0.5 * Math.sin((2 * Math.PI * 0.45 * i) / t.sr);
      out[i] = out[i]! * 0.5 + air[i]! * 0.55 + pump[i]! * 0.18 * throb;
    }
    return loopify(out, length);
  };
  return [make(0), make(1)];
}

/**
 * The master alarm: soft and insistent, two tones a fourth apart, over and
 * over - telling, not shouting.
 */
export function orbitAlarm(t: Take): Mono {
  const period = t.j(0.8, 0.03);
  const out = t.canvas(period * 2 + 0.3);
  const lo = 587 * t.p;
  const hi = 784 * t.p;
  // Starting a breath in, so the loop's seam falls in a gap between tones.
  for (let k = 0; k < 2; k++) {
    tone(out, t, 0.04 + k * period, hi, period * 0.4, 0.8, 0.02, 0.06, 0.1);
    tone(out, t, 0.04 + k * period + period * 0.5, lo, period * 0.4, 0.8, 0.02, 0.06, 0.1);
  }
  return wrap(out, t.n(period * 2));
}

/** The radio's Quindar tone: the beep that opens a transmission from the ground. */
export function orbitQuindar(t: Take): Mono {
  const out = t.canvas(0.5);
  tone(out, t, 0.01, 2525 * t.p, 0.25, 0.8, 0.004, 0.01, 0);
  t.put(out, staticNoise(t, 0.4), 0.05, 0.1);
  return out;
}

/** A burst of radio: the intro beep, a few words from the ground, the outro beep. */
export function orbitRadio(t: Take): Mono {
  const r = t.rng;
  const words = r.range(0.8, 1.3);
  const out = t.canvas(words + 0.75);
  tone(out, t, 0.01, 2525, 0.25, 0.55, 0.004, 0.01, 0);
  t.put(out, staticNoise(t, words + 0.3), 0.25, 0.18);
  t.put(out, babble(t, words), 0.3, 0.8);
  tone(out, t, words + 0.4, 2475, 0.25, 0.55, 0.004, 0.01, 0);
  return out;
}

/** The heat gauge's tick: a small, dry click. */
export function orbitHeatTick(t: Take): Mono {
  const out = t.canvas(0.08);
  t.put(out, click(t.sr, t.rng, 0.0015, 1800, 9000), 0, 0.6);
  addMode(out, t.sr, 0, 3200 * t.p, 0.35, t.d(0.008), 0);
  return out;
}

/** The HUD's ring appearing: a soft, high blip. */
export function orbitRing(t: Take): Mono {
  const out = t.canvas(0.14);
  tone(out, t, 0.002, 1760 * t.p, 0.07, 0.8, 0.005, 0.05, 0.05);
  return out;
}

// --- the laser --------------------------------------------------------------------

/**
 * A shot, heard from inside: the capacitor's whine climbing as it charges
 * in a blink, the discharge's crackle, and the thump of the mount through
 * the structure under your feet. The loudest thing in the game.
 */
export function orbitLaser(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.55));
  const charge = sweep(t.n(0.07), t.sr, (u) => (1400 + 4200 * Math.pow(u, 1.4)) * t.p);
  shapeBy(charge, (u) => Math.pow(u, 1.5));
  t.put(out, charge, 0, t.g(0.35));
  // The discharge: a hard edge and a crackle.
  t.put(out, click(t.sr, r, 0.003, 1200, 14000), 0.07, t.g(1.2));
  t.put(out, burst(t, 0.12, 1800 * t.p, 9000, 0.0004, t.d(0.022), 2, -2), 0.07, t.g(0.6));
  // The mount's thump, and the ring of the capacitor bleeding off.
  t.put(out, thump(t, 0.35, 120 * t.p, 48 * t.p, 0.002, t.d(0.07), 0.45), 0.07, t.g(1.1));
  addMode(out, t.sr, 0.07, 5600 * t.p * r.range(0.99, 1.01), 0.06, t.d(0.09), 0);
  addMetal(out, t.sr, r, 0.07, 340 * t.p, t.d(0.06), 0.18);
  return out;
}

/** Overheated: a relay drops, the capacitor's whine winds down, a low buzz of the interlock. */
export function orbitOverheat(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.1));
  t.put(out, click(t.sr, r, 0.004, 400, 6000), 0, t.g(1));
  t.put(out, thump(t, 0.15, 180, 90, 0.001, 0.02), 0, t.g(0.6));
  const whine = sweep(t.n(0.9), t.sr, (u) => (3400 * Math.pow(0.2, u)) * t.p);
  shapeBy(whine, (u) => (1 - u) * Math.min(1, u * 30));
  t.put(out, whine, 0.02, t.g(0.3));
  const buzz = sweep(t.n(0.7), t.sr, 110 * t.p);
  for (let i = 0; i < buzz.length; i++) buzz[i] = Math.tanh(buzz[i]! * 3);
  lowpass(buzz, t.sr, 900, 2);
  adsr(buzz, t.sr, 0.02, 0.3, 0.6, 0.2);
  t.put(out, buzz, 0.05, t.g(0.3));
  return out;
}

/** Venting: a valve's clunk and the coolant's hiss rushing out through the mount. */
export function orbitVent(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  t.put(out, click(t.sr, r, 0.003, 300, 5000), 0, t.g(0.8));
  t.put(out, thump(t, 0.12, 150, 80, 0.001, 0.015), 0, t.g(0.4));
  const hiss = bandNoise(t.n(0.8), t.sr, r, 2200 * t.c(1), 9500, 2);
  adsr(hiss, t.sr, 0.02, 0.25, 0.4, 0.35);
  t.put(out, hiss, 0.02, t.g(0.7));
  const low = bandNoise(t.n(0.6), t.sr, r, 300, 1200, 2);
  adsr(low, t.sr, 0.02, 0.2, 0.3, 0.25);
  t.put(out, low, 0.02, t.g(0.25));
  return out;
}

// --- the hull ---------------------------------------------------------------------

/**
 * A strike on the glass: sharp, loud, close. The hit itself, the crack
 * racing out through the pane, the glass ringing in its frame, and the
 * frame taking the blow.
 */
export function orbitCrack(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.1));
  t.put(out, click(t.sr, r, 0.003, 2000, 16000), 0, t.g(1.4));
  t.put(out, burst(t, 0.08, 2500 * t.p, 15000, 0.0002, t.d(0.012), 2, 3), 0, t.g(1));
  for (let k = 0; k < r.int(10, 18); k++) {
    const at = 0.002 + Math.pow(k / 18, 1.5) * 0.06 + r.range(0, 0.003);
    t.put(out, click(t.sr, r, r.range(0.0008, 0.002), 3000, 16000), at, r.range(0.25, 0.7));
  }
  for (const f of [2300, 3700, 5200, 7100]) addMode(out, t.sr, 0, f * t.p * r.range(0.97, 1.03), 0.08, t.d(r.range(0.05, 0.12)), 0);
  // The frame: a heavy thud and the metal's ring.
  t.put(out, thump(t, 0.4, 150 * t.p, 60 * t.p, 0.001, t.d(0.06), 0.5), 0, t.g(0.9));
  addMetal(out, t.sr, r, 0, 420 * t.p, t.d(0.12), 0.25);
  for (let k = 0; k < r.int(3, 6); k++) addShard(out, t, r.range(0.02, 0.3), r.range(4000, 9000), r.range(0.04, 0.12), r.range(0.01, 0.03));
  return out;
}

/**
 * A strike on the station: a dull boom that comes through the structure,
 * the hull's low modes ringing on and a groan as it settles.
 */
export function orbitBoom(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.9));
  t.put(out, thump(t, 1.6, 90 * t.p, 34 * t.p, 0.004, t.d(0.3), 0.5), 0, t.g(1));
  t.put(out, burst(t, 0.5, 40, 300, 0.004, t.d(0.1), 4), 0, t.g(0.7));
  for (const f of [180, 263, 377, 512, 689]) addMode(out, t.sr, 0.005, f * t.p * r.range(0.97, 1.03), r.range(0.05, 0.12), t.d(r.range(0.25, 0.5)), r.range(0, 6));
  const groan = creak(t, 0.7, (u) => 70 + 50 * u, [
    [240, 6, 1],
    [520, 8, 0.5],
  ], 0.4);
  t.put(out, groan, 0.35, t.g(0.12));
  lowpass(out, t.sr, 3000, 2);
  return tailOff(out, t.sr, 0.5);
}

/** The hull ticking and creaking as it goes from sun to shadow. */
export function orbitCreak(t: Take): Mono {
  const r = t.rng;
  const len = r.range(0.5, 1.0);
  const out = creak(t, len, (u) => 40 + 160 * Math.sin(Math.PI * u), [
    [310 * t.p, 9, 1],
    [720 * t.p, 12, 0.6],
    [1450 * t.p, 14, 0.3],
  ], 0.5);
  fade(out, t.sr, 0.02, 0.08);
  return out;
}

/** A pane failing: the air roaring out through the hole, then nothing at all. */
export function orbitDecompress(t: Take): Mono[] {
  const r = t.rng;
  const seconds = t.L(2.0);
  const n = t.n(seconds);
  const make = (label: number): Mono => {
    const rc = r.fork(label);
    const roar = white(n, rc);
    const walk = wanderTrack(n, rc, 6, t.sr);
    svf(roar, t.sr, "lp", (u) => 900 + 5000 * (1 - u) * (0.6 + 0.4 * walk(u)), 0.9, 32);
    const rumble = bandNoise(n, t.sr, rc, 25, 200, 4);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      // A slam of pressure, a roar, and it thins as the air goes - then stops.
      const env = Math.min(1, u * 60) * (1 - Math.pow(u, 0.7)) * (1 + 0.25 * Math.sin(u * 40 + label));
      out[i] = (roar[i]! * 0.8 + rumble[i]! * 0.6) * env;
    }
    t.put(out, thump(t, 0.4, 70, 30, 0.002, 0.1), 0, 1.2);
    return out;
  };
  return [make(0), make(1)];
}

/** The cupola's shutters slamming shut, one after another. */
export function orbitShutter(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.3));
  for (let k = 0; k < 3; k++) {
    const at = k * r.range(0.06, 0.12);
    const g = k === 0 ? 1 : r.range(0.4, 0.7);
    t.put(out, click(t.sr, r, 0.004, 500, 9000), at, g);
    t.put(out, thump(t, 0.3, 140 * t.p, 55, 0.001, t.d(0.05), 0.5), at, g * 0.9);
    addMetal(out, t.sr, r, at, r.range(280, 420) * t.p, t.d(0.2), g * 0.5, [1, 1.51, 2.27, 2.76, 3.9]);
  }
  return out;
}

/** The crew sealing chips from inside: an applicator's clicks and a soft hiss. */
export function orbitSeal(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.1));
  for (let k = 0; k < 3; k++) t.put(out, click(t.sr, r, 0.003, 800, 7000), 0.05 + k * r.range(0.15, 0.25), 0.4);
  const hiss = bandNoise(t.n(0.7), t.sr, r, 1500, 7000, 2);
  adsr(hiss, t.sr, 0.08, 0.3, 0.5, 0.25);
  t.put(out, hiss, 0.2, 0.3);
  return out;
}

// --- the drone and the Derelict (heard only as the station's warnings) --------------

/** The drone's telemetry faults: two quick low beeps from the panel. */
export function orbitDroneHit(t: Take): Mono {
  const out = t.canvas(0.55);
  tone(out, t, 0.01, 392 * t.p, 0.12, 0.8, 0.006, 0.03, 0.2);
  tone(out, t, 0.2, 330 * t.p, 0.18, 0.8, 0.006, 0.05, 0.2);
  return out;
}

/** The proximity alarm for the Derelict: a low, pulsing tone, three times. */
export function orbitDerelict(t: Take): Mono {
  const out = t.canvas(1.8);
  for (let k = 0; k < 3; k++) {
    tone(out, t, 0.02 + k * 0.5, 440 * t.p, 0.3, 0.8, 0.03, 0.12, 0.25);
    tone(out, t, 0.02 + k * 0.5, 220 * t.p, 0.3, 0.4, 0.03, 0.12, 0);
  }
  return out;
}

// --- the stingers -----------------------------------------------------------------

/** A soft bell of a note, for the stingers: a struck bar's first few partials. */
function chime(out: Mono, t: Take, at: number, freq0: number, amp: number, tau0: number): void {
  // Each take strikes it a hair differently: a few cents off, a little longer or shorter.
  const freq = freq0 * Math.pow(2, t.rng.range(-3, 3) / 1200);
  const tau = t.d(tau0);
  addMode(out, t.sr, at, freq, amp, tau, 0);
  addMode(out, t.sr, at, freq * 2.76, amp * 0.18, tau * 0.3, 0);
  addMode(out, t.sr, at, freq * 5.4, amp * 0.05, tau * 0.12, 0);
  addMode(out, t.sr, at, freq * 1.003, amp * 0.25, tau * 0.8, 0);
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** A pass begins: the Quindar beep, and three calm notes rising (D major, open). */
export function orbitPassStart(t: Take): Mono[] {
  const dry = t.canvas(1.6);
  tone(dry, t, 0.0, 2525, 0.2, 0.35, 0.004, 0.01, 0);
  [62, 69, 74].forEach((m, k) => chime(dry, t, 0.28 + k * 0.16, hz(m + 12), 0.5, 0.5));
  tailOff(dry, t.sr, 0.4);
  return room(dry, t.sr, t.rng, { t60: 1.2, size: 0.5, mix: 0.25, predelay: 0.01, tail: 0.3 });
}

/** A pass cleared: two notes resolving, and the ground's outro beep. */
export function orbitPassClear(t: Take): Mono[] {
  const dry = t.canvas(2.0);
  chime(dry, t, 0.02, hz(78), 0.55, 0.6);
  chime(dry, t, 0.22, hz(86), 0.6, 0.9);
  tone(dry, t, 1.2, 2475, 0.2, 0.25, 0.004, 0.01, 0);
  tailOff(dry, t.sr, 0.4);
  return room(dry, t.sr, t.rng, { t60: 1.4, size: 0.5, mix: 0.25, predelay: 0.01, tail: 0.3 });
}

/** The streak's step: a bright blip (the game raises it a note a step). */
export function orbitStreak(t: Take): Mono {
  const out = t.canvas(0.5);
  chime(out, t, 0.004, hz(86), 0.7, 0.12);
  chime(out, t, 0.06, hz(93), 0.6, 0.16);
  return tailOff(out, t.sr, 0.15);
}

/** A secret found: a sparkle of chimes climbing. */
export function orbitSecret(t: Take): Mono {
  const out = t.canvas(1.8);
  [74, 78, 81, 86, 90].forEach((m, k) => chime(out, t, 0.02 + k * 0.07, hz(m), 0.45, 0.4));
  return roomMono(tailOff(out, t.sr, 0.4), t.sr, t.rng, { t60: 1.0, size: 0.5, mix: 0.25, predelay: 0.01, tail: 0.2 });
}

/** The golden laser: the capacitor sings up an arpeggio. */
export function orbitGolden(t: Take): Mono[] {
  const dry = t.canvas(2.4);
  const sing = sweep(t.n(0.5), t.sr, (u) => 800 + 3200 * u);
  shapeBy(sing, (u) => Math.sin(Math.PI * u));
  t.put(dry, sing, 0, 0.15);
  [74, 78, 81, 86, 90, 93].forEach((m, k) => chime(dry, t, 0.3 + k * 0.08, hz(m), 0.4, 0.7));
  tailOff(dry, t.sr, 0.5);
  return room(dry, t.sr, t.rng, { t60: 1.6, size: 0.8, mix: 0.3, predelay: 0.015, tail: 0.2 });
}

/** The end: a low, grave fall, and the station's hum going quiet under it. */
export function orbitGameOver(t: Take): Mono[] {
  const dry = t.canvas(3.4);
  chime(dry, t, 0.02, hz(62), 0.7, 1.4);
  chime(dry, t, 0.55, hz(57), 0.7, 1.6);
  chime(dry, t, 1.1, hz(50), 0.8, 2.2);
  const wash = bandNoise(t.n(2.6), t.sr, t.rng, 80, 600, 2);
  adsr(wash, t.sr, 0.6, 1, 0.3, 1.2);
  t.put(dry, wash, 0.4, 0.08);
  tailOff(dry, t.sr, 0.8);
  return room(dry, t.sr, t.rng, { t60: 2.2, size: 1, mix: 0.3, predelay: 0.02, tail: 0.3 });
}

export const ORBIT_CUES: Record<string, CueSpec> = {
  // The station, always running.
  orbit_hum: {
    recipe: orbitHum, pack: "orbit", bus: "world", level: -20, loop: true,
    priority: 0, fadeIn: 1.5, fadeOut: 1.5, vary: 0.01, expect: [5, 7],
  },
  orbit_alarm: {
    recipe: orbitAlarm, pack: "orbit", bus: "world", level: -14, loop: true,
    priority: 2, fadeIn: 0.1, fadeOut: 0.4, vary: 0, expect: [1.4, 1.8],
  },
  orbit_quindar: {
    recipe: orbitQuindar, pack: "orbit", bus: "ui", level: -17,
    priority: 1, maxInstances: 1, vary: 0, expect: [0.25, 0.6],
  },
  orbit_radio: {
    recipe: orbitRadio, pack: "orbit", bus: "world", level: -19,
    priority: 0, maxInstances: 1, vary: 0.02, expect: [1.2, 2.3],
  },
  orbit_heat_tick: {
    recipe: orbitHeatTick, pack: "orbit", bus: "ui", level: -20,
    priority: 1, maxInstances: 2, vary: 0.03, minGap: 0.03, expect: [0.02, 0.15],
  },
  orbit_ring: {
    recipe: orbitRing, pack: "orbit", bus: "ui", level: -22,
    priority: 1, maxInstances: 2, vary: 0, minGap: 0.25, expect: [0.05, 0.2],
  },
  // The laser: the player's own, the loudest thing in the game.
  orbit_laser: {
    recipe: orbitLaser, pack: "orbit", bus: "sfx", level: -1, reverb: 0.04,
    priority: 3, maxInstances: 4, vary: 0.03, takes: 4, expect: [0.3, 0.8],
  },
  orbit_overheat: {
    recipe: orbitOverheat, pack: "orbit", bus: "sfx", level: -8, reverb: 0.04,
    priority: 3, maxInstances: 1, vary: 0.02, expect: [0.7, 1.3],
  },
  orbit_vent: {
    recipe: orbitVent, pack: "orbit", bus: "sfx", level: -9, reverb: 0.04,
    priority: 3, maxInstances: 1, vary: 0.03, expect: [0.5, 1.0],
  },
  // The hull.
  orbit_crack: {
    recipe: orbitCrack, pack: "orbit", bus: "sfx", level: -2, reverb: 0.06,
    priority: 3, maxInstances: 3, vary: 0.05, minGap: 0.03, takes: 4, expect: [0.4, 1.2],
  },
  orbit_boom: {
    recipe: orbitBoom, pack: "orbit", bus: "sfx", level: -5, reverb: 0.08,
    priority: 2, maxInstances: 2, vary: 0.05, minGap: 0.05, expect: [1.0, 2.1],
  },
  orbit_creak: {
    recipe: orbitCreak, pack: "orbit", bus: "world", level: -18, reverb: 0.05,
    priority: 0, maxInstances: 1, vary: 0.08, expect: [0.3, 1.2],
  },
  orbit_decompress: {
    recipe: orbitDecompress, pack: "orbit", bus: "sfx", level: -1, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [1.6, 2.3],
  },
  orbit_shutter: {
    recipe: orbitShutter, pack: "orbit", bus: "sfx", level: -4, reverb: 0.06, steady: true,
    priority: 3, maxInstances: 1, vary: 0.02, expect: [0.6, 1.4],
  },
  orbit_seal: {
    recipe: orbitSeal, pack: "orbit", bus: "world", level: -16, reverb: 0.05,
    priority: 1, maxInstances: 1, vary: 0.04, expect: [0.5, 1.2],
  },
  // The station's warnings.
  orbit_drone_hit: {
    recipe: orbitDroneHit, pack: "orbit", bus: "ui", level: -13,
    priority: 2, maxInstances: 1, vary: 0, expect: [0.3, 0.6],
  },
  orbit_derelict: {
    recipe: orbitDerelict, pack: "orbit", bus: "world", level: -11,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 1.9],
  },
  // The stingers (pitch exact: vary 0).
  orbit_pass_start: {
    recipe: orbitPassStart, pack: "orbit", bus: "sfx", steady: true, level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 2.4],
  },
  orbit_pass_clear: {
    recipe: orbitPassClear, pack: "orbit", bus: "sfx", steady: true, level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.4, 2.6],
  },
  orbit_streak: {
    recipe: orbitStreak, pack: "orbit", bus: "ui", level: -14,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.2, 0.6],
  },
  orbit_secret: {
    recipe: orbitSecret, pack: "orbit", bus: "ui", level: -11,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.0, 2.4],
  },
  orbit_golden: {
    recipe: orbitGolden, pack: "orbit", bus: "ui", level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 3.2],
  },
  orbit_game_over: {
    recipe: orbitGameOver, pack: "orbit", bus: "ui", level: -10,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 4.4],
  },
};
