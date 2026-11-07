/**
 * What happens to a Grip Prix kart when it is hit, bumped, dropped or
 * thrown: the spin-out (a cartoon whirl, a bonk and dizzy tweets), being
 * struck, kart against kart (a tap or a clonk, by force), barriers, a
 * hazard (a pipe's clang, debris and a sad trombone), the ramp's spring,
 * the trick's twirl, landings (and the cheer for a trick landed), the fall
 * and the drone that fetches the kart back. Each is layered: a transient, a
 * body and a tail. The toy-box rule still holds: rounded, springy and
 * glassy, never a harsh crack, so being hit is funny rather than painful.
 */
import { midiHz, sampled, smooth } from "../dsp/curves";
import { bandpass, lowpass, svf } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMetal, addMode, bandNoise, click, formants, saw, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { bubble, thump } from "./kit";
import { ar, expo, glide } from "./kart-kit";
import { BELL, CHIME, GLASS, TWANG, WAH, air, knock, note, puff, shower, sweep, tweet } from "./kart-synth";

/** A swell that peaks in the middle. */
const swell = (u: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 1.3;

// --- hit and spin-out -------------------------------------------------------------------------------------------

/**
 * Struck by a puck, a rocket or a blast: a hard bonk (a falling sine, a
 * wooden knock), a clang of the chassis ringing, a short cartoon whirl
 * spinning down, and three stars sparkling out of it.
 */
export function hit(t: Take): Mono {
  const out = t.canvas(1.25);
  t.put(out, thump(t, 0.22, 240, 55, 0.001, 0.055), 0, 1);
  knock(out, t, 0, 540, 0.9, 0.03);
  t.put(out, bandNoise(t.n(0.045), t.sr, t.rng, 700, 6000, 2), 0, 0.45);
  addMetal(out, t.sr, t.rng, 0.003, 640, 0.18, 0.5, [1, 1.52, 2.31, 3.1]);
  // The whirl: a pitch spinning down, wobbling, with a flutter of the spin in its level.
  const whirl = sweep(t, 0.7, (u) => 1250 * Math.pow(0.14, u), 0.4, 0.12, 9, 0.05);
  const n = whirl.length;
  for (let i = 0; i < n; i++) whirl[i]! *= 0.75 + 0.25 * Math.sin((2 * Math.PI * (16 - 11 * (i / n)) * i) / t.sr);
  shapeBy(whirl, (u) => smooth(u / 0.03) * Math.pow(Math.max(0, 1 - u), 1.2));
  t.put(out, whirl, 0.05, 0.45);
  // The stars.
  note(out, t, GLASS, 0.5, 96, 0.2, 0.8, 0.4);
  note(out, t, GLASS, 0.62, 100, 0.2, 0.8, 0.36);
  note(out, t, BELL, 0.74, 103, 0.2, 0.7, 0.3);
  return out;
}

/**
 * Spinning out (on an oil slick, a decoy or a storm): a skid's squeal winding
 * down, tyre noise, a bonk as the kart comes round against something soft, a
 * spring settling, and four dizzy tweets circling its head, slower as it
 * comes to.
 */
export function spinout(t: Take): Mono {
  const out = t.canvas(1.55);
  // The whirl.
  const squeal = sweep(t, 0.75, (u) => 1650 * Math.pow(0.36, u), 0.5, 0.25, 7.5, 0.06);
  shapeBy(squeal, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.3));
  t.put(out, squeal, 0, 0.55);
  const tyre = bandNoise(t.n(0.75), t.sr, t.rng, 1800, 7500, 2);
  const nt = tyre.length;
  for (let i = 0; i < nt; i++) tyre[i]! *= 0.6 + 0.4 * Math.sin((2 * Math.PI * (13 - 8 * (i / nt)) * i) / t.sr);
  shapeBy(tyre, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.3));
  t.put(out, tyre, 0, 0.35);
  // The bonk and the settle.
  t.put(out, thump(t, 0.2, 230, 78, 0.002, 0.04), 0.6, 0.9);
  knock(out, t, 0.6, 470, 0.8, 0.03);
  const boing = glide(t, 0.3, 360, 150, 0.7, 0.3);
  expo(boing, t.sr, 0.09, 0.002);
  t.put(out, boing, 0.62, 0.5);
  // The dizzy tweets, circling: four, each higher or lower, spaced wider as the head clears.
  const stars = [[0.78, 3100], [0.97, 3500], [1.2, 2900], [1.46 - 0.04, 3300]] as const;
  stars.forEach(([at, f], k) => t.put(out, tweet(t, f * t.rng.range(0.97, 1.03), 0.09), at, 0.32 * (1 - 0.1 * k)));
  return out;
}

// --- kart against kart, against a wall ----------------------------------------------------------------------------

/**
 * A tap between karts: a rubbery bumper tok, a squeak of plastic, a tiny
 * rattle of a loose part. The game plays this one for the light touches.
 */
export function bump(t: Take): Mono {
  const out = t.canvas(0.3);
  t.put(out, thump(t, 0.1, 300, 120, 0.001, 0.025), 0, 1);
  knock(out, t, 0, 880, 0.7, 0.01);
  const squeak = glide(t, 0.07, 1500, 900, 0.7, 0.2);
  expo(squeak, t.sr, 0.02, 0.001);
  t.put(out, squeak, 0.004, 0.25);
  addMetal(out, t.sr, t.rng, 0.004, 1850, 0.03, 0.12, [1, 1.47, 2.09]);
  return out;
}

/**
 * Karts colliding hard: a clonk of metal on plastic with real weight (a deep
 * falling thump under it), a crunch, a bumper ringing, and a spring's boing
 * as they bounce apart.
 */
export function bumpHard(t: Take): Mono {
  const out = t.canvas(0.65);
  t.put(out, thump(t, 0.3, 170, 44, 0.001, 0.07), 0, 1.1);
  t.put(out, thump(t, 0.1, 340, 130, 0.001, 0.02), 0, 0.6);
  const crunch = bandNoise(t.n(0.12), t.sr, t.rng, 500, 5000, 2);
  expo(crunch, t.sr, 0.022, 0.0005);
  t.put(out, crunch, 0, 0.7);
  addMetal(out, t.sr, t.rng, 0.002, 520, 0.2, 0.7, [1, 1.43, 2.12, 2.91, 3.7]);
  knock(out, t, 0, 640, 0.6, 0.02);
  const boing = glide(t, 0.2, 520, 250, 0.7, 0.3);
  expo(boing, t.sr, 0.07, 0.002);
  t.put(out, boing, 0.03, 0.35);
  return out;
}

/** A barrier struck: tyres in a stack take the weight (a deep thud, a rubber thwoop), a fence behind them rattles. */
export function wallThud(t: Take): Mono {
  const out = t.canvas(0.65);
  t.put(out, thump(t, 0.35, 140, 42, 0.002, 0.08), 0, 1);
  const thwoop = sweep(t, 0.16, (u) => 320 * Math.pow(0.5, u), 0.3);
  expo(thwoop, t.sr, 0.05, 0.002);
  t.put(out, thwoop, 0, 0.5);
  const body = bandNoise(t.n(0.2), t.sr, t.rng, 150, 1500, 2);
  expo(body, t.sr, 0.05, 0.002);
  t.put(out, body, 0, 0.55);
  // The fence: a handful of wire-and-post rings, thinning.
  for (let k = 0; k < 3; k++) addMetal(out, t.sr, t.rng, 0.01 + k * 0.012, 420 * t.rng.range(0.9, 1.4), 0.12, 0.2 - 0.05 * k, [1, 2.1, 3.3]);
  addMode(out, t.sr, 0.004, 410 * t.rng.range(0.97, 1.03), 0.3, 0.07, 0.4);
  return lowpass(out, t.sr, 6000, 2);
}

/** Scraping along a barrier: a ragged rasp with a thin squeal in it. */
export function wallScrape(t: Take): Mono {
  const n = t.n(0.55);
  const rasp = bandNoise(n, t.sr, t.rng, 1300, 6500, 2);
  // Stick and slip: the level flutters at random.
  const flutter = new Float32Array(n);
  let v = 0.5;
  for (let i = 0; i < n; i += 96) {
    v = 0.25 + 0.75 * t.rng.next();
    for (let k = i; k < Math.min(n, i + 96); k++) flutter[k] = v;
  }
  lowpass(flutter, t.sr, 180, 1);
  for (let i = 0; i < n; i++) rasp[i]! *= flutter[i]!;
  const squeal = glide(t, 0.55, 2200 * t.p, 1900 * t.p, 1, 0.3);
  for (let i = 0; i < n; i++) rasp[i]! += 0.12 * squeal[i]! * flutter[i]!;
  shapeBy(rasp, (u) => smooth(u / 0.08) * smooth((1 - u) / 0.25));
  return rasp;
}

// --- hazards ------------------------------------------------------------------------------------------------------------

/**
 * A track hazard strikes: a hollow pipe clang (a long, low metal ring), a
 * clatter of debris falling and settling, and a sad trombone's "wah-wah
 * waaah" down a tone and a tone, the last bent flat.
 */
export function hazard(t: Take): Mono {
  const out = t.canvas(1.5);
  addMetal(out, t.sr, t.rng, 0, 360 * t.rng.range(0.98, 1.02), 0.35, 1, [1, 2.4, 3.9, 5.6]);
  t.put(out, thump(t, 0.2, 210, 62, 0.001, 0.045), 0, 0.9);
  const crash = bandNoise(t.n(0.5), t.sr, t.rng, 800, 8500, 2);
  expo(crash, t.sr, 0.09, 0.001);
  t.put(out, crash, 0.01, 0.4);
  shower(out, t, 0.03, 0.4, 14, 900, 4200, 0.25, [0.01, 0.05], 1.4);
  note(out, t, WAH, 0.22, 52, 0.17, 0.85, 0.5);
  note(out, t, WAH, 0.42, 50, 0.17, 0.85, 0.5);
  // The last note bends down as it dies.
  const last = WAH({ sr: t.sr, freq: midiHz(48), hold: 0.55, vel: 0.9, rng: t.rng.fork("wah3") });
  const bend = sampled(last.length, (u) => Math.pow(2, (-1.6 * smooth((u - 0.35) / 0.65)) / 12), 32);
  // A bend by resampling (cheap, and small enough to be inaudibly aliased).
  const bent = new Float32Array(last.length);
  let pos = 0;
  for (let i = 0; i < bent.length; i++) {
    const a = Math.floor(pos);
    const f = pos - a;
    bent[i] = a + 1 < last.length ? last[a]! * (1 - f) + last[a + 1]! * f : 0;
    pos += bend[i]!;
  }
  t.put(out, bent, 0.63, 0.5);
  return out;
}

// --- the air ------------------------------------------------------------------------------------------------------------------

/**
 * Off a ramp: the spring under the kart let go (a bright plucked twang and a
 * rubber boing climbing) and a rush of air as it leaves the ground.
 */
export function jump(t: Take): Mono {
  const out = t.canvas(0.7);
  note(out, t, TWANG, 0, 43, 0.15, 0.9, 0.5);
  const boing = sweep(t, 0.4, (u) => 190 * Math.pow(3, Math.pow(u, 0.7)), 0.35, 0.12, 16, 0.07 * 1);
  shapeBy(boing, (u) => smooth(u / 0.03) * Math.pow(Math.max(0, 1 - u), 0.8));
  t.put(out, boing, 0, 0.75);
  t.put(out, thump(t, 0.12, 200, 70, 0.001, 0.03), 0, 0.6);
  t.put(out, air(t, 0.5, 500, 3800, 1.3, puff(0.12, 1.2), 70), 0.04, 0.5);
  return out;
}

/**
 * A trick in the air: pings spiralling up the scale, a slide whistle's
 * "whee" up and back, and the whirl of the spin, a ratchet of clicks and a
 * swirl of air going once round the head, left, right and back (the one
 * stereo sound a kart makes: the kart spins).
 */
export function trick(t: Take): Mono[] {
  const out = t.canvas(1.0);
  [88, 91, 95, 100, 103].forEach((m, k) => note(out, t, k % 2 ? GLASS : BELL, k * 0.065, m, 0.1, 0.85, 0.36 + 0.04 * k));
  const whee = sweep(t, 0.45, (u) => 700 * Math.pow(2.3, Math.sin(Math.PI * Math.min(1, u * 1.15))), 0.12, 0.04, 7, 0.025);
  shapeBy(whee, (u) => smooth(u / 0.06) * smooth((1 - u) / 0.25));
  t.put(out, whee, 0.02, 0.2);
  // The ratchet of the spin: ticks that quicken then stop.
  const n = t.n(0.6);
  const swirl = white(n, t.rng);
  svf(swirl, t.sr, "bp", (u) => 900 + 3200 * Math.sin(Math.PI * u), 1.6);
  normalize(swirl);
  shapeBy(swirl, swell);
  const ticks = t.canvas(0.6);
  for (let at = 0.02, gap = 0.05; at < 0.5; gap *= 0.93) {
    t.put(ticks, click(t.sr, t.rng, 0.0015, 2500, 9000), at, 0.5);
    at += gap;
  }
  for (let i = 0; i < n; i++) swirl[i]! += ticks[i]! * 0.7;
  const left = Float32Array.from(out);
  const right = Float32Array.from(out);
  for (let i = 0; i < n; i++) {
    const a = Math.sin(2 * Math.PI * (i / n));
    left[i]! += 0.5 * Math.sqrt(0.5 * (1 + a)) * swirl[i]!;
    right[i]! += 0.5 * Math.sqrt(0.5 * (1 - a)) * swirl[i]!;
  }
  return [left, right];
}

/** Back on the road: a chunk of suspension (a falling thump, a puff of dust), a tyre's chirp and two springy settles. */
export function land(t: Take): Mono {
  const out = t.canvas(0.55);
  t.put(out, thump(t, 0.25, 175, 50, 0.002, 0.055), 0, 1);
  const puffy = bandNoise(t.n(0.14), t.sr, t.rng, 200, 2200, 2);
  expo(puffy, t.sr, 0.03, 0.002);
  t.put(out, puffy, 0, 0.5);
  const chirp = glide(t, 0.05, 1700, 1250, 0.7, 0.2);
  expo(chirp, t.sr, 0.012, 0.0008);
  t.put(out, chirp, 0.004, 0.2);
  for (let k = 0; k < 2; k++) {
    const settle = glide(t, 0.16, 280 - 60 * k, 190 - 40 * k, 1, 0.3);
    expo(settle, t.sr, 0.05, 0.002);
    t.put(out, settle, 0.04 + 0.1 * k, 0.4 * (1 - 0.4 * k));
  }
  return out;
}

/**
 * Down from a long jump: a deep thud through the chassis, the springs
 * crunching and rattling as they take it, a metallic ring of the frame, and
 * a cloud of dust.
 */
export function heavyLanding(t: Take): Mono {
  const out = t.canvas(0.8);
  t.put(out, thump(t, 0.5, 120, 33, 0.002, 0.14), 0, 1.1);
  const crunch = bandNoise(t.n(0.22), t.sr, t.rng, 120, 1700, 2);
  expo(crunch, t.sr, 0.05, 0.002);
  t.put(out, crunch, 0, 0.55);
  addMetal(out, t.sr, t.rng, 0.004, 300, 0.2, 0.28, [1, 1.58, 2.4]);
  const rattle = glide(t, 0.34, 230, 150, 1, 0.4, 0.2);
  const n = rattle.length;
  for (let i = 0; i < n; i++) rattle[i]! *= Math.exp((-i / n) * 6) * (0.6 + 0.4 * Math.cos((2 * Math.PI * 19 * i) / t.sr));
  t.put(out, rattle, 0.02, 0.35);
  const dust = bandNoise(t.n(0.4), t.sr, t.rng, 600, 4000, 2);
  shapeBy(dust, puff(0.1, 2));
  t.put(out, dust, 0.02, 0.18);
  return out;
}

/**
 * A trick landed: a small crowd's "woo!" (three voices on a rising vowel), a
 * rising pair of bells and a puff of confetti: the reward for sticking it.
 */
export function landCheer(t: Take): Mono {
  const out = t.canvas(0.9);
  for (let k = 0; k < 3; k++) {
    const len = t.rng.range(0.38, 0.5);
    const n = t.n(len);
    const f0 = t.rng.range(200, 320) * t.p;
    const track = sampled(n, (u) => f0 * (0.85 + 0.3 * smooth(u * 1.6)) * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * u * len)), 16);
    const src = saw(n, t.sr, track, 0.2, t.rng.next());
    const voice = formants(src, t.sr, [
      { freq: (u: number) => 320 + 420 * smooth(u * 2), q: 5, amp: 1 },
      { freq: (u: number) => 800 + 500 * smooth(u * 2), q: 6, amp: 0.5 },
      { freq: 2500, q: 8, amp: 0.15 },
    ]);
    normalize(voice);
    shapeBy(voice, (u) => smooth(u / 0.12) * smooth((1 - u) / 0.45));
    t.put(out, voice, 0.02 + k * 0.025, 0.2);
  }
  note(out, t, CHIME, 0.02, 91, 0.2, 0.9, 0.6);
  note(out, t, CHIME, 0.1, 96, 0.4, 0.95, 0.65);
  shower(out, t, 0.08, 0.5, 18, 4000, 11000, 0.12, [0.006, 0.025], 1.2);
  return lowpass(out, t.sr, 11000, 1);
}

/**
 * Over the edge: a whistle falling away (two detuned sines beating), a hollow
 * "oooo" of a voice dropping with it, the wind rising, and, at the end, the
 * drone's claw closing on the kart with a clunk and a whirr of rotors.
 */
export function fall(t: Take): Mono {
  const out = t.canvas(2.1);
  const n = t.n(1.6);
  const hz = (u: number): number => 2000 * Math.pow(0.15, Math.pow(u, 0.85)) * (1 + 0.012 * Math.sin(2 * Math.PI * 7 * u * 1.6));
  const a = sweep(t, 1.6, hz, 0.18, 0.05);
  const b = sweep(t, 1.6, (u) => hz(u) * 1.011, 0.12, 0.03);
  for (let i = 0; i < n; i++) a[i]! += b[i]!;
  shapeBy(a, (u) => smooth(u / 0.03) * smooth((1 - u) / 0.3));
  t.put(out, a, 0, 0.55);
  // The "ooo": a falling sung vowel.
  const voiceFreq = sampled(n, (u) => 420 * Math.pow(0.35, u), 16);
  const src = saw(n, t.sr, voiceFreq, 0.25, 0.1);
  const oo = formants(src, t.sr, [{ freq: 320, q: 5, amp: 1 }, { freq: 780, q: 6, amp: 0.3 }]);
  normalize(oo);
  shapeBy(oo, (u) => smooth(u / 0.15) * smooth((1 - u) / 0.4));
  t.put(out, oo, 0, 0.16);
  const wind = bandNoise(n, t.sr, t.rng, 300, 2200, 2);
  shapeBy(wind, (u) => smooth(u / 0.3) * smooth((1 - u) / 0.3));
  t.put(out, wind, 0, 0.18);
  // The claw: a latch, a clunk and a whirr that carries the kart off.
  knock(out, t, 1.62, 330, 0.9, 0.04);
  t.put(out, thump(t, 0.2, 150, 55, 0.002, 0.04), 1.62, 0.8);
  addMetal(out, t.sr, t.rng, 1.62, 780, 0.1, 0.35, [1, 1.7, 2.7]);
  const rotor = bandNoise(t.n(0.4), t.sr, t.rng, 160, 1400, 2);
  const m = rotor.length;
  for (let i = 0; i < m; i++) rotor[i]! *= 0.55 + 0.45 * Math.sin((2 * Math.PI * 38 * i) / t.sr);
  shapeBy(rotor, puff(0.2, 1.1));
  t.put(out, rotor, 1.64, 0.28);
  return out;
}

/**
 * The drone lets go: the claw's click and release, the rotors whirring up
 * and thinning, a spring's cheerful boing as the kart drops onto the road,
 * and two notes saying "back in".
 */
export function droneDrop(t: Take): Mono {
  const out = t.canvas(0.75);
  t.put(out, click(t.sr, t.rng, 0.003, 1500, 9000), 0, 0.8);
  knock(out, t, 0, 520, 0.7, 0.02);
  const rotor = bandNoise(t.n(0.3), t.sr, t.rng, 200, 1800, 2);
  for (let i = 0; i < rotor.length; i++) rotor[i]! *= 0.55 + 0.45 * Math.sin((2 * Math.PI * (44 - 20 * (i / rotor.length)) * i) / t.sr);
  shapeBy(rotor, puff(0.05, 1.4));
  t.put(out, rotor, 0.01, 0.3);
  const boing = sweep(t, 0.24, (u) => 420 * Math.pow(2.4, u), 0.3);
  ar(boing, t.sr, 0.01, 0.1);
  t.put(out, boing, 0.1, 0.4);
  t.put(out, bubble(t, 560, 0.02, 2.4), 0.1, 0.5);
  t.put(out, thump(t, 0.14, 190, 70, 0.002, 0.035), 0.16, 0.6);
  note(out, t, GLASS, 0.26, 88, 0.2, 0.8, 0.4);
  note(out, t, GLASS, 0.36, 95, 0.3, 0.9, 0.44);
  return out;
}
