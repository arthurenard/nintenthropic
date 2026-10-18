/**
 * Stingers and the interface: a wave beginning and a wave cleared, the
 * Mechanic arriving, the game over, a secret, the streak and the golden
 * rifle.
 */
import { midiHz } from "../../dsp/curves";
import { lowpass, svf } from "../../dsp/filters";
import { Rng, hashSeed } from "../../dsp/rng";
import { type Mono, adsr, fade, normalize, shapeBy, tailOff, wobble } from "../../dsp/signal";
import { addMode, addString, bandNoise, brown, click, saw } from "../../dsp/sources";
import { room, roomMono } from "../../dsp/space";
import type { Take } from "../../dsp/take";
import { burst, creak, puff, thump, wanderTrack } from "../kit";
import { bellStrike } from "../world";
import { nightLever } from "./rifle";

/**
 * A wave begins: dread. A low drone on D in two octaves — three saws a few
 * cents apart, their beating the unease, and a quieter fifth over them —
 * under a low-pass that opens as it swells in; a far rumble like thunder
 * beyond the hills; and, thin and high over it, the drone's 17th and 23rd
 * harmonics (a flat minor ninth and a sour tritone above the octaves) as
 * pure tones, beating slowly.
 */
export function nightWaveStart(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 4.0;
  const n = t.n(seconds);
  const dry = new Float32Array(n);
  const f = midiHz(38);
  for (const [fr, a] of [[f, 1], [f * Math.pow(2, 9 / 1200), 0.8], [(f / 2) * Math.pow(2, -7 / 1200), 0.9], [f * 1.5 * Math.pow(2, 4 / 1200), 0.35]] as const) {
    const s = saw(n, t.sr, fr, 0, r.next());
    for (let i = 0; i < n; i++) dry[i]! += a * s[i]!;
  }
  svf(dry, t.sr, "lp", (u) => 120 + 700 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 2, 0.9, 64);
  normalize(dry);
  adsr(dry, t.sr, 1.6, 0.8, 0.8, 1.5);
  const rumble = brown(n, r);
  lowpass(rumble, t.sr, 110, 4);
  normalize(rumble);
  const churn = wobble(n, t.sr, 2.5, () => r.next());
  for (let i = 0; i < n; i++) rumble[i]! *= 0.6 + 0.4 * churn[i]!;
  shapeBy(rumble, (u) => Math.sin(Math.PI * u) ** 1.5);
  t.put(dry, rumble, 0, 0.5);
  const hi = t.canvas(seconds);
  addMode(hi, t.sr, 0, f * 17, 1, 1000, 0);
  addMode(hi, t.sr, 0, f * 17 * 1.0012, 0.6, 1000, 0);
  addMode(hi, t.sr, 0, f * 23, 0.5, 1000, 0);
  shapeBy(hi, (u) => Math.sin(Math.PI * Math.max(0, (u - 0.2) / 0.8)) ** 2);
  t.put(dry, hi, 0, 0.035);
  tailOff(dry, t.sr, 0.3);
  return room(dry, t.sr, r, { t60: 2.2, size: 1, damping: 0.3, mix: 0.3, predelay: 0.03, tail: 0.3 });
}

/**
 * A wave cleared: a breath of relief — a soft exhale of air, and a warm
 * chord (D major with an added ninth) of near-pure partials, each a pair a
 * hair apart for a slow chorus, swelling in and letting go.
 */
export function nightWaveClear(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 2.9;
  const dry = t.canvas(seconds);
  t.put(dry, puff(t, 0.9, 900, 0.25, 0.3), 0, 0.1);
  const chord = t.canvas(seconds - 0.02);
  for (const [midi, g] of [[50, 1], [57, 0.9], [62, 0.8], [66, 0.7], [69, 0.55], [76, 0.4]] as const) {
    const f = midiHz(midi);
    addMode(chord, t.sr, 0, f, g * 0.6, 1000, r.range(0, 6.28));
    addMode(chord, t.sr, 0, f * 1.0025, g * 0.4, 1000, r.range(0, 6.28));
    addMode(chord, t.sr, 0, f * 2.002, g * 0.3, 1000, r.range(0, 6.28));
    if (midi < 60) addMode(chord, t.sr, 0, f * 3, g * 0.1, 1000, r.range(0, 6.28));
  }
  adsr(chord, t.sr, 0.35, 0.8, 0.7, 1.3);
  t.put(dry, normalize(chord), 0.02, 1);
  tailOff(dry, t.sr, 0.3);
  return room(dry, t.sr, r, { t60: 1.8, size: 0.9, damping: 0.35, mix: 0.3, predelay: 0.02, tail: 0.3 });
}

/**
 * The Mechanic arrives: a heavy low blow, as if something huge struck a
 * steel door close by (a sub thump, the door's low clang ringing, a dull
 * roar), then a long metal scrape — a tyre iron dragged over the asphalt
 * toward you, grinding and catching in a stick-slip squeal over grit — and
 * under it the dread drone, lower still.
 */
export function nightBoss(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 4.6;
  const dry = t.canvas(seconds);
  t.put(dry, thump(t, 1.2, 62, 27, 0.003, 0.3, 0.45), 0.02, 1.0);
  t.put(dry, burst(t, 1.0, 25, 170, 0.004, 0.25, 4), 0.02, 0.8);
  t.put(dry, click(t.sr, r, 0.006, 400, 9000), 0.02, 0.5);
  for (const [f, a, tau] of [[92, 1, 1.1], [151, 0.7, 0.8], [233, 0.55, 0.6], [347, 0.35, 0.45], [512, 0.25, 0.3], [731, 0.15, 0.2]] as const) {
    addMode(dry, t.sr, 0.02, f * r.range(0.99, 1.01), a * 0.3, tau, 0);
    addMode(dry, t.sr, 0.02, f * 1.004, a * 0.15, tau * 0.9, 0);
  }
  const start = 0.7;
  const len = seconds - start - 0.4;
  const walk = wanderTrack(t.n(len), r, 3, t.sr);
  const grind = creak(t, len, (u) => 260 + 520 * walk(u), [[1150, 10, 1], [2300, 12, 0.7], [3650, 14, 0.4], [5200, 16, 0.2]], 0.6);
  const gn = grind.length;
  const grit = bandNoise(gn, t.sr, r, 1500, 7000, 2);
  const catches = wobble(gn, t.sr, 300, () => r.next());
  for (let i = 0; i < gn; i++) grind[i] = 0.7 * grind[i]! + 0.35 * grit[i]! * catches[i]! * catches[i]!;
  shapeBy(grind, (u) => Math.min(1, u * 4) * (0.6 + 0.4 * walk(u)) * (u < 0.8 ? 1 : (1 - u) / 0.2));
  t.put(dry, grind, start, 0.5);
  const drone = saw(t.n(seconds), t.sr, midiHz(26), 0, r.next());
  lowpass(drone, t.sr, 200, 2);
  normalize(drone);
  adsr(drone, t.sr, 0.8, 1, 0.8, 1.2);
  t.put(dry, drone, 0, 0.2);
  tailOff(dry, t.sr, 0.4);
  return room(dry, t.sr, r, { t60: 2.4, size: 1, damping: 0.3, mix: 0.35, predelay: 0.03, tail: 0.3 });
}

/** A felt-hammered piano key: two strings a few cents apart, struck softly and left to ring. */
function feltNote(out: Mono, t: Take, at: number, midi: number, vel: number, hold: number): void {
  const f = midiHz(midi);
  for (const cents of [-3, 3]) {
    addString(out, t.sr, t.rng, at, f * Math.pow(2, cents / 1200), vel * 0.8, {
      t60: Math.min(5, 3.2 * Math.sqrt(262 / f)), brightness: 0.4, pulse: 0.0028, position: 0.13, length: hold, release: 0.2,
    });
  }
}

/**
 * The night took you: the church bell, close now and dark, and three soft
 * notes on a felt piano falling to D (A, F, D: D minor), a low pad rising
 * under the last and the whole of it fading into the dark.
 */
export function nightGameOver(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 4.4;
  const dry = t.canvas(seconds);
  const bell = bellStrike(t, midiHz(62), 4.2, 0.45);
  lowpass(bell, t.sr, 2400, 2);
  t.put(dry, bell, 0.02, 0.55);
  for (const [at, midi, vel] of [[0.45, 57, 0.8], [1.05, 53, 0.7], [1.75, 50, 0.9]] as const) feltNote(dry, t, at, midi, vel, 3.6 - at);
  const pad = t.canvas(2.6);
  for (const [midi, a] of [[38, 1], [45, 0.7], [50, 0.5], [53, 0.4]] as const) {
    addMode(pad, t.sr, 0, midiHz(midi), a, 1000, r.range(0, 6.28));
    addMode(pad, t.sr, 0, midiHz(midi) * 1.003, a * 0.6, 1000, r.range(0, 6.28));
  }
  adsr(pad, t.sr, 0.8, 0.8, 0.7, 1.2);
  t.put(dry, normalize(pad), 1.6, 0.25);
  tailOff(dry, t.sr, 0.8);
  return room(dry, t.sr, r, { t60: 2.4, size: 1, damping: 0.35, mix: 0.35, predelay: 0.02, tail: 0.3 });
}

/**
 * One tooth of a worn music box's comb, plucked by a pin: a clamped bar
 * (partials 1 : 6.27 : 17.55), strongly fundamental, a bright tick of the
 * pin. The box's tuning is the box's own — each tooth a few cents off, drawn
 * from a fixed seed — so every take plays the same old box.
 */
function tooth(out: Mono, t: Take, at: number, midi: number, gain: number): void {
  const box = new Rng(hashSeed("night-music-box", midi));
  const f = midiHz(midi) * Math.pow(2, box.range(-9, 9) / 1200);
  const tau = 0.7 * Math.sqrt(880 / f);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 1.0015, gain * 0.2, tau * 0.8, 0);
  addMode(out, t.sr, at, f * 6.27, gain * 0.12, 0.06, 0);
  addMode(out, t.sr, at, f * 17.55, gain * 0.03, 0.015, 0);
  t.put(out, click(t.sr, t.rng, 0.001, 2000, 12000), at, gain * 0.08);
}

/**
 * A secret found: a small eerie music-box motif somewhere in the dark — A
 * minor, leaning on the raised seventh, its spring running down (each note
 * a hair later than the last), ending on a tritone that does not resolve.
 */
export function nightSecret(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(2.0);
  const motif: readonly [number, number, number][] = [
    [0, 88, 0.8], [0.17, 81, 0.7], [0.34, 84, 0.75], [0.52, 83, 0.7], [0.72, 80, 0.75], [0.95, 81, 0.8], [0.95, 87, 0.45],
  ];
  const slowing = r.range(1.0, 1.08);
  for (const [at, midi, g] of motif) tooth(out, t, 0.01 + at * (1 + (slowing - 1) * at), midi, g * r.range(0.9, 1.05));
  return roomMono(out, t.sr, r, { t60: 0.9, size: 0.35, damping: 0.5, mix: 0.25, predelay: 0.004, tail: 0.1 });
}

/**
 * The streak climbs: a soft tick and a small pure chime on D6 (a bar's
 * partials, starting from rest so the onset is soft). Pitch exact, so the
 * game can raise it up the major triad by rate.
 */
export function nightStreak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.6);
  t.put(out, click(t.sr, r, 0.0012, 1500, 6000), 0.002, 0.05);
  addMode(out, t.sr, 0.002, r.range(2200, 2600), 0.1, 0.003, 0);
  const f = midiHz(86) * Math.pow(2, r.range(-3, 3) / 1200);
  const note = t.canvas(0.58);
  addMode(note, t.sr, 0, f, 0.6, t.d(0.2), 0);
  addMode(note, t.sr, 0, f * 1.003, 0.2, t.d(0.18), 0);
  addMode(note, t.sr, 0, f * 2, 0.08, 0.1, 0);
  addMode(note, t.sr, 0, f * 2.76, t.g(0.1, 3) * r.sign(), t.d(0.05), 0);
  fade(note, t.sr, 0.0015, 0.02);
  t.put(out, note, 0.01, 1);
  return out;
}

/** A small golden bar: warm partials (1 : 2.76 : 5.4) and a soft tick. */
function goldBar(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const f = midiHz(midi);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 2.76, gain * 0.25, tau * 0.3, 0);
  addMode(out, t.sr, at, f * 5.4, gain * 0.08, tau * 0.1, 0);
  t.put(out, click(t.sr, t.rng, 0.0012, 2000, 10000), at, gain * 0.1);
}

/**
 * The golden rifle: the lever racked, a warm arpeggio of little golden bars
 * up D major, a shimmer of high partials in slowly beating pairs like light
 * moving on brass, and a warm chord under it all.
 */
export function nightGolden(t: Take): Mono[] {
  const r = t.rng;
  const seconds = 2.8;
  const dry = t.canvas(seconds);
  t.put(dry, nightLever(t), 0, 0.35);
  [74, 78, 81, 86, 90].forEach((midi, k) => goldBar(dry, t, 0.3 + k * 0.085, midi, 0.3, 0.8));
  for (let k = 0; k < 8; k++) {
    const f = r.range(3500, 8000);
    addMode(dry, t.sr, 0.55 + k * 0.03, f, 0.02, r.range(0.3, 0.6), 0);
    addMode(dry, t.sr, 0.55 + k * 0.03, f * 1.0015, 0.02, r.range(0.3, 0.6), 0);
  }
  const pad = t.canvas(2.3);
  for (const [midi, a] of [[50, 1], [54, 0.7], [57, 0.7], [62, 0.5]] as const) {
    addMode(pad, t.sr, 0, midiHz(midi), a, 1000, r.range(0, 6.28));
    addMode(pad, t.sr, 0, midiHz(midi) * 2, a * 0.2, 1000, r.range(0, 6.28));
  }
  adsr(pad, t.sr, 0.4, 0.6, 0.7, 1.0);
  t.put(dry, normalize(pad), 0.3, 0.2);
  tailOff(dry, t.sr, 0.5);
  return room(dry, t.sr, r, { t60: 1.6, size: 0.9, damping: 0.4, mix: 0.3, predelay: 0.015, tail: 0.2 });
}
