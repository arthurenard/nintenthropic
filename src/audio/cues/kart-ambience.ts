/**
 * The places Grip Prix races through, heard very quietly under the engines:
 * a few beds that loop (a breeze, water lapping, a room's hum, the deep
 * rumble of a volcano, a distant crowd) and the odd thing that happens far
 * off (a bird, a gull, a hawk, a pot bubbling, the ice creaking, lava
 * blorping, a space radio's bleep, a funfair's bell). Which a track hears,
 * and how often, is src/kart/audio/ambience.ts.
 *
 * Every bed is mono; the race plays two of them apart in the stereo field
 * (different takes, starting at different points), which makes it wide.
 */
import { midiHz, sampled, smooth } from "../dsp/curves";
import { bandpass, highpass, lowpass } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, brown, pink, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { modal } from "../dsp/voices";
import { bubble } from "./kit";
import { TAU, circular, cyclic, expo, grains, noiseLoop, times, tone } from "./kart-kit";

// --- beds ------------------------------------------------------------------------------------------------

/** A breeze: soft air that swells and eases, a rustle of leaves on top. */
export function ambBreeze(t: Take): Mono {
  const seconds = 2.4;
  const n = t.n(seconds);
  const r = t.rng;
  const air = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 140, 1800, 2), 0.4);
  normalize(air);
  times(air, cyclic(n, 1, 0.45, r.range(0, TAU)));
  times(air, cyclic(n, 3, 0.25, r.range(0, TAU)));
  const rustle = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 2600, 7500, 2), 0.4);
  times(rustle, cyclic(n, 2, 0.7, r.range(0, TAU)));
  times(rustle, cyclic(n, 13, 0.6, r.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = air[i]! + 0.18 * rustle[i]!;
  return out;
}

/** Water lapping at a quay: low sloshes and the small bubbles they leave. */
export function ambWater(t: Take): Mono {
  const seconds = 2.4;
  const n = t.n(seconds);
  const r = t.rng;
  const slosh = noiseLoop(t, seconds, (m) => lowpass(brown(m, r), t.sr, 650, 2), 0.4);
  normalize(slosh);
  times(slosh, cyclic(n, 3, 0.75, r.range(0, TAU)));
  times(slosh, cyclic(n, 5, 0.4, r.range(0, TAU)));
  const plips = grains(t, seconds, 22, () => {
    const g = bubble(t, r.range(380, 1300), r.range(0.006, 0.016), 1.5);
    return g.length > 0 ? g : new Float32Array(1);
  });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = slosh[i]! + 0.35 * plips[i]!;
  return out;
}

/** A big room's hum: a fridge's motor and its mains buzz, a fan's air. */
export function ambHum(t: Take): Mono {
  const seconds = 2.0;
  const n = t.n(seconds);
  const r = t.rng;
  // 55 Hz and its harmonics, whole cycles in the loop (110 of them in two seconds): cyclic() is a sine of whole cycles.
  const cycles = Math.round(55 * seconds);
  const hum = new Float32Array(n);
  for (const [k, a] of [[1, 1], [3, 0.35], [5, 0.15], [2, 0.3], [7, 0.06]] as const) {
    const s = cyclic(n, cycles * k, 2, r.range(0, TAU));
    for (let i = 0; i < n; i++) hum[i]! += a * s[i]!;
  }
  normalize(hum);
  times(hum, cyclic(n, 1, 0.2, r.range(0, TAU)));
  const fan = noiseLoop(t, seconds, (m) => bandpass(pink(m, r), t.sr, 180, 1400, 2), 0.3);
  normalize(fan);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.6 * hum[i]! + 0.55 * fan[i]!;
  return out;
}

/** The ground's rumble by a volcano: a deep, uneven roar with the odd far-off thump in it. */
export function ambRumble(t: Take): Mono {
  const seconds = 2.4;
  const n = t.n(seconds);
  const r = t.rng;
  const roar = noiseLoop(t, seconds, (m) => lowpass(brown(m, r), t.sr, 160, 2), 0.4);
  normalize(roar);
  times(roar, cyclic(n, 2, 0.5, r.range(0, TAU)));
  times(roar, cyclic(n, 5, 0.3, r.range(0, TAU)));
  const thumps = grains(t, seconds, 2.5, (s) => {
    const len = t.n(0.35);
    const g = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      g[i] = Math.sin(ph) * Math.exp(-u * 7) * smooth(u / 0.04);
      ph += (TAU * (55 - 25 * u)) / t.sr;
    }
    return g.map((v) => v * s);
  });
  const hiss = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 1500, 5000, 2), 0.4);
  times(hiss, cyclic(n, 7, 0.8, r.range(0, TAU)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = roar[i]! + 0.6 * thumps[i]! + 0.05 * hiss[i]!;
  return out;
}

/** A crowd far off: many voices' murmur, no words, rising and falling. */
export function ambCrowd(t: Take): Mono {
  const seconds = 2.4;
  const n = t.n(seconds);
  const r = t.rng;
  const out = new Float32Array(n);
  // Three registers of talkers, five in each: one band of breath per register, shaped by the sum of its talkers'
  // syllables (independent voices add as their envelopes do), each talker at their own pace.
  for (const [low, high] of [[300, 1100], [450, 1700], [700, 2600]] as const) {
    const breath = noiseLoop(t, seconds, (m) => bandpass(white(m, r), t.sr, low, high, 2), 0.25);
    normalize(breath);
    const env = new Float32Array(n);
    for (let v = 0; v < 5; v++) {
      const syllables = cyclic(n, Math.round(r.range(3, 6) * seconds), 0.9, r.range(0, TAU));
      const phrase = cyclic(n, Math.max(1, Math.round(r.range(0.4, 1.2) * seconds)), 0.7, r.range(0, TAU));
      const g = r.range(0.6, 1);
      for (let i = 0; i < n; i++) env[i]! += g * syllables[i]! * phrase[i]!;
    }
    for (let i = 0; i < n; i++) out[i]! += breath[i]! * env[i]!;
  }
  circular(out, (twice) => lowpass(twice, t.sr, 2200, 2));
  return out;
}

// --- far-off happenings -----------------------------------------------------------------------------------

/** A songbird: a quick phrase of three to six chirps, each a sweep with a trill. */
export function ambBird(t: Take): Mono {
  const out = t.canvas(0.9);
  const r = t.rng;
  const chirps = 3 + Math.floor(r.next() * 4);
  let at = 0.01;
  const base = r.range(2600, 3600) * t.p;
  for (let k = 0; k < chirps && at < 0.8; k++) {
    const len = r.range(0.04, 0.09);
    const n = t.n(len);
    const up = r.next() < 0.5;
    const f = sampled(n, (u) => base * (up ? 0.8 + 0.5 * u : 1.3 - 0.45 * u) * (1 + 0.04 * Math.sin(2 * Math.PI * 38 * u * len)), 8);
    const chirp = tone(n, t.sr, f, 0.08, 0);
    shapeBy(chirp, (u) => Math.sin(Math.PI * u) ** 1.5);
    t.put(out, chirp, at, r.range(0.6, 1));
    at += len + r.range(0.02, 0.07);
  }
  return out;
}

/** A gull: two or three nasal, falling cries. */
export function ambGull(t: Take): Mono {
  const out = t.canvas(1.3);
  const r = t.rng;
  const cries = 2 + Math.floor(r.next() * 2);
  for (let k = 0; k < cries; k++) {
    const len = r.range(0.18, 0.3);
    const n = t.n(len);
    const f0 = r.range(950, 1150) * t.p;
    const f = sampled(n, (u) => f0 * (1.15 - 0.4 * u * u), 16);
    // A nasal voice: a buzzy tone through two formants, roughened.
    const voice = tone(n, t.sr, f, 0.7, 0.5);
    for (let i = 0; i < n; i++) voice[i]! *= 1 + 0.35 * Math.sin((2 * Math.PI * 70 * i) / t.sr);
    const nasal = bandpass(voice, t.sr, 900, 3200, 2);
    shapeBy(nasal, (u) => smooth(u / 0.1) * (1 - u) ** 0.6);
    t.put(out, nasal, k * r.range(0.32, 0.4), r.range(0.7, 1));
  }
  return out;
}

/** A hawk high over a canyon: one long, falling, rasping cry. */
export function ambHawk(t: Take): Mono {
  const len = 1.0;
  const n = t.n(len);
  const f = sampled(n, (u) => 2500 * t.p * (1.05 - 0.4 * u ** 1.4) * (1 + 0.015 * Math.sin(2 * Math.PI * 30 * u)), 16);
  const cry = tone(n, t.sr, f, 0.5, 0.3);
  const rasp = bandNoise(n, t.sr, t.rng, 1800, 4500, 2);
  for (let i = 0; i < n; i++) cry[i] = cry[i]! * (1 + 0.3 * Math.sin((2 * Math.PI * 95 * i) / t.sr)) + 0.25 * rasp[i]!;
  shapeBy(cry, (u) => smooth(u / 0.08) * (1 - u) ** 1.3);
  return lowpass(cry, t.sr, 5000, 2);
}

/** A pot on the boil, somewhere in the kitchen: a few big bubbles. */
export function ambBubble(t: Take): Mono {
  const out = t.canvas(0.8);
  const r = t.rng;
  const count = 3 + Math.floor(r.next() * 4);
  for (let k = 0; k < count; k++) t.put(out, bubble(t, r.range(160, 520), r.range(0.012, 0.03), 1.8), r.range(0, 0.6), r.range(0.4, 1));
  return out;
}

/** The ice groaning under its own weight: a low creak that slides, and a crack. */
export function ambCreak(t: Take): Mono {
  const out = t.canvas(1.0);
  const r = t.rng;
  const n = t.n(0.7);
  // Stick and slip: a train of little ticks whose rate slides, rung through the ice's resonance.
  const ticks = new Float32Array(n);
  let pos = 0;
  const rate = r.range(60, 110);
  while (pos < n) {
    const u = pos / n;
    ticks[Math.floor(pos)] = r.range(0.5, 1);
    pos += t.sr / (rate * (1 + 0.8 * Math.sin(Math.PI * u)));
  }
  const groan = bandpass(ticks, t.sr, 250, 1400, 2);
  normalize(groan);
  shapeBy(groan, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.3));
  t.put(out, groan, 0, 0.8);
  addMode(out, t.sr, 0.6, r.range(1800, 2600), 0.6, 0.05, 0);
  const snap = highpass(white(t.n(0.03), r), t.sr, 2500, 2);
  expo(snap, t.sr, 0.006, 0.0005);
  t.put(out, snap, 0.6, 0.6);
  return out;
}

/** Lava: a thick blorp of a bubble bursting and a spatter of hiss. */
export function ambLava(t: Take): Mono {
  const out = t.canvas(0.8);
  const r = t.rng;
  t.put(out, bubble(t, r.range(70, 130), r.range(0.05, 0.08), 2.2), 0, 1);
  const spatter = bandNoise(t.n(0.4), t.sr, r, 1200, 6000, 2);
  for (let i = 0; i < spatter.length; i++) spatter[i]! *= (r.next() < 0.15 ? 1 : 0.15) * Math.exp((-i / spatter.length) * 5);
  t.put(out, spatter, 0.12, 0.25);
  return lowpass(out, t.sr, 5000, 2);
}

/** A space radio somewhere: two to four soft bleeps on the pentatonic scale. */
export function ambBleep(t: Take): Mono {
  const out = t.canvas(0.7);
  const r = t.rng;
  const notes = [84, 86, 88, 91, 93, 96];
  const count = 2 + Math.floor(r.next() * 3);
  for (let k = 0; k < count; k++) {
    const n = t.n(0.07);
    const f = new Float32Array(n).fill(midiHz(notes[Math.floor(r.next() * notes.length)]!));
    const b = tone(n, t.sr, f, 0.05, 0.02);
    shapeBy(b, (u) => smooth(u / 0.1) * smooth((1 - u) / 0.3));
    t.put(out, b, k * 0.11, r.range(0.6, 1));
  }
  return out;
}

const BELL = modal({ partials: [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.93, 0.1, 0.2]], tau: 0.7, hammer: { level: 0.15, tau: 0.002, low: 6000 } });

/** A funfair's bell: the high striker rung by someone strong, far off. */
export function ambDing(t: Take): Mono {
  const out = t.canvas(1.5);
  t.put(out, BELL({ sr: t.sr, freq: midiHz(91) * t.rng.range(0.995, 1.005), hold: 1.2, vel: 0.9, rng: t.rng.fork("ding") }), 0, 1);
  return out;
}
