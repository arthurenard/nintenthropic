/**
 * Everything that happens to a Grip Prix kart, as one-shots: the sparks of a
 * drift and the mini-turbo that pays for them, boosts, item boxes, the items
 * themselves, bumps and walls, jumps and falls. Toy-box sounds: rounded
 * thumps, springy boings, sweeping air and glassy pings, never a harsh crack.
 * Pitched pieces (the pings, the arpeggios) sit in C major so any two that
 * overlap agree.
 */
import { sampled, smooth } from "../dsp/curves";
import { bandpass, highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, normalize, shapeBy } from "../dsp/signal";
import { addMode, bandNoise, click, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { bubble, thump } from "./kit";
import { ar, drive, expo, glide, ping, swoosh, tone, whoosh } from "./kart-kit";

/** A swell that peaks in the middle. */
const swell = (u: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 1.3;

// --- the drift -------------------------------------------------------------------------------------------

/** The first spark level: a cool blue tink with a fizz, a single clear ping. */
export function sparkBlue(t: Take): Mono {
  const out = t.canvas(0.5);
  ping(out, t, 0, 91, 1, 0.8);
  ping(out, t, 0.045, 98, 0.45, 0.7);
  const fizz = highpass(white(t.n(0.2), t.rng), t.sr, 6000, 2);
  expo(fizz, t.sr, 0.05, 0.002);
  t.put(out, fizz, 0, 0.25);
  return out;
}

/** The second level: the same, hotter and busier: three rising pings and a crackle. */
export function sparkOrange(t: Take): Mono {
  const out = t.canvas(0.65);
  ping(out, t, 0, 88, 0.9, 0.85);
  ping(out, t, 0.06, 95, 0.9, 0.85);
  ping(out, t, 0.12, 100, 1, 0.9);
  const crackle = highpass(white(t.n(0.3), t.rng), t.sr, 4500, 2);
  const n = crackle.length;
  for (let i = 0; i < n; i++) crackle[i]! *= (t.rng.next() < 0.12 ? 1 : 0.15) * Math.exp((-i / n) * 4);
  t.put(out, crackle, 0.02, 0.35);
  return out;
}

/** The mini-turbo letting go: a pop, a zip up the scale and a burst of air. */
export function miniTurbo(t: Take): Mono {
  const out = t.canvas(0.7);
  t.put(out, thump(t, 0.16, 190, 62, 0.002, 0.045), 0, 0.9);
  t.put(out, whoosh(t, 0.5, 700, 5200, 1.3, swoosh(0.04, 1.8)), 0.005, 0.9);
  const zip = glide(t, 0.18, 420, 1900, 0.8, 0.25);
  ar(zip, t.sr, 0.004, 0.06);
  t.put(out, zip, 0.01, 0.45);
  ping(out, t, 0.17, 96, 0.5, 0.8);
  return out;
}

// --- boosts ---------------------------------------------------------------------------------------------------

/** A boost's whoosh: a long rush of air, a low fwoom under it. */
export function boostWhoosh(t: Take): Mono {
  const out = t.canvas(1.3);
  t.put(out, whoosh(t, 1.2, 450, 3800, 1.0, swoosh(0.08, 1.4)), 0, 1);
  const fwoom = glide(t, 0.9, 85, 230, 0.7, 0.3, 0.1);
  shapeBy(fwoom, swell);
  t.put(out, fwoom, 0, 0.5);
  return out;
}

/** A boost pad: a quick bright zing up and two glass pings. */
export function boostPad(t: Take): Mono {
  const out = t.canvas(0.8);
  const zing = glide(t, 0.22, 330, 1480, 0.7, 0.35, 0.2);
  ar(zing, t.sr, 0.005, 0.08);
  t.put(out, zing, 0, 0.55);
  t.put(out, whoosh(t, 0.35, 1600, 7000, 1.4, swoosh(0.06, 1.5)), 0, 0.6);
  ping(out, t, 0.14, 88, 0.8);
  ping(out, t, 0.23, 95, 0.9);
  return out;
}

/** A rocket start: a thump, a roar, a whistle climbing and a sparkle at the top. */
export function startBoost(t: Take): Mono {
  const out = t.canvas(1.3);
  t.put(out, thump(t, 0.3, 160, 48, 0.003, 0.08), 0, 1);
  t.put(out, whoosh(t, 1.1, 260, 2800, 0.9, swoosh(0.07, 1.2)), 0.01, 1);
  const whistle = glide(t, 0.7, 320, 2100, 1.3, 0.2, 0.05);
  ar(whistle, t.sr, 0.02, 0.15);
  t.put(out, whistle, 0.05, 0.4);
  ping(out, t, 0.7, 96, 0.8);
  ping(out, t, 0.78, 103, 0.9);
  return out;
}

/** The engine flooded at the start: a stuttering sputter that coughs itself out. */
export function flood(t: Take): Mono {
  const out = t.canvas(0.95);
  const gaps = [0, 0.085, 0.18, 0.29, 0.43, 0.6, 0.8];
  gaps.forEach((at, k) => {
    const strength = Math.pow(0.78, k);
    const f = t.rng.range(95, 120) * t.p * (1 - 0.05 * k);
    const pulse = thump(t, 0.07, f * 1.5, f * 0.7, 0.002, 0.018);
    const noise = bandpass(white(t.n(0.05), t.rng), t.sr, 200, 1800, 2);
    expo(noise, t.sr, 0.012, 0.001);
    for (let i = 0; i < noise.length && i < pulse.length; i++) pulse[i]! += 0.7 * noise[i]!;
    t.put(out, pulse, at + t.rng.range(-0.006, 0.006), strength);
  });
  return lowpass(out, t.sr, 2600, 2);
}

// --- item boxes and items ---------------------------------------------------------------------------------------

/** An item box bursting: a bright crack, a scatter of shards and a rising two-note chime. */
export function boxSmash(t: Take): Mono {
  const out = t.canvas(0.9);
  const crack = bandNoise(t.n(0.06), t.sr, t.rng, 2000, 9000, 2);
  expo(crack, t.sr, 0.01, 0.0005);
  t.put(out, crack, 0, 0.9);
  t.put(out, thump(t, 0.12, 260, 110, 0.001, 0.025), 0, 0.5);
  for (let k = 0; k < 9; k++) {
    addMode(out, t.sr, t.rng.range(0.005, 0.16), t.rng.range(2500, 9500), t.rng.range(0.1, 0.3), t.rng.range(0.012, 0.05), t.rng.range(0, 6.28));
  }
  ping(out, t, 0.07, 84, 0.7);
  ping(out, t, 0.16, 91, 0.9);
  return out;
}

/** A tick of the item roulette: a small wooden knock, pitch set by the caller's playback rate. */
export function rouletteTick(t: Take): Mono {
  const out = t.canvas(0.1);
  addMode(out, t.sr, 0, 1250 * t.rng.range(0.99, 1.01), 1, 0.012, 0);
  addMode(out, t.sr, 0, 2750, 0.35, 0.007, 1);
  t.put(out, click(t.sr, t.rng, 0.002, 1500, 8000), 0, 0.3);
  return out;
}

/** The roulette lands: an arpeggio of glass pings, C major, with a long top note. */
export function itemReady(t: Take): Mono {
  const out = t.canvas(1.0);
  ping(out, t, 0, 84, 0.8);
  ping(out, t, 0.08, 88, 0.85);
  ping(out, t, 0.16, 91, 0.95);
  ping(out, t, 0.24, 96, 1, 0.9);
  const air = highpass(white(t.n(0.3), t.rng), t.sr, 7000, 2);
  expo(air, t.sr, 0.08, 0.01);
  t.put(out, air, 0.22, 0.12);
  return out;
}

/** Using a nitro: a hiss of gas, an ignition thump and a growl climbing into a rush. */
export function nitroUse(t: Take): Mono {
  const out = t.canvas(1.0);
  const hiss = highpass(white(t.n(0.18), t.rng), t.sr, 3000, 2);
  expo(hiss, t.sr, 0.05, 0.003);
  t.put(out, hiss, 0, 0.6);
  t.put(out, thump(t, 0.25, 140, 46, 0.002, 0.07), 0.08, 1);
  const growl = glide(t, 0.6, 70, 240, 0.8, 0.5, 0.3);
  drive(growl, 2.5);
  ar(growl, t.sr, 0.02, 0.2);
  t.put(out, growl, 0.08, 0.5);
  t.put(out, whoosh(t, 0.7, 500, 3500, 1.1, swoosh(0.1, 1.3)), 0.1, 0.8);
  return out;
}

/** A puck fired: a springy thwonk and a short zip. */
export function puckFire(t: Take): Mono {
  const out = t.canvas(0.5);
  const thwonk = glide(t, 0.12, 620, 170, 0.6, 0.3);
  expo(thwonk, t.sr, 0.05, 0.002);
  t.put(out, thwonk, 0, 1);
  t.put(out, click(t.sr, t.rng, 0.003, 1000, 8000), 0, 0.5);
  t.put(out, whoosh(t, 0.32, 2800, 700, 1.8, swoosh(0.05, 1.5)), 0.01, 0.7);
  return out;
}

/** A puck off a wall: a rubbery boing and a hard tick. */
export function puckBounce(t: Take): Mono {
  const out = t.canvas(0.4);
  const boing = glide(t, 0.2, t.rng.range(780, 960), t.rng.range(500, 580), 0.8, 0.3);
  expo(boing, t.sr, 0.07, 0.002);
  t.put(out, boing, 0, 1);
  addMode(out, t.sr, 0, t.rng.range(2100, 2600), 0.4, 0.015, t.rng.range(0, 6.28));
  t.put(out, click(t.sr, t.rng, 0.002, 1500, 9000), 0, 0.5);
  return out;
}

/** An oil slick dropped: a wet splat with bubbles gloopily popping. */
export function slickSplat(t: Take): Mono {
  const out = t.canvas(0.8);
  const splat = bandNoise(t.n(0.3), t.sr, t.rng, 250, 2600, 2);
  svf(splat, t.sr, "lp", (u) => 3200 * Math.pow(0.12, u), 1.1);
  expo(splat, t.sr, 0.06, 0.003);
  t.put(out, splat, 0, 1);
  t.put(out, thump(t, 0.15, 170, 70, 0.002, 0.04), 0, 0.7);
  for (let k = 0; k < 5; k++) t.put(out, bubble(t, t.rng.range(250, 800), t.rng.range(0.015, 0.035), 1.8), t.rng.range(0.05, 0.4), t.rng.range(0.3, 0.7));
  return out;
}

// --- hits ------------------------------------------------------------------------------------------------------------

/** Struck by a puck: a bonk, a cartoon whirl spinning down and three little stars. */
export function hit(t: Take): Mono {
  const out = t.canvas(1.2);
  t.put(out, thump(t, 0.2, 230, 62, 0.001, 0.05), 0, 1);
  t.put(out, bandNoise(t.n(0.04), t.sr, t.rng, 600, 5000, 2), 0, 0.5);
  const n = t.n(0.8);
  const f = sampled(n, (u) => 1150 * Math.pow(0.17, u) * (1 + 0.05 * Math.sin(2 * Math.PI * 9 * u * 0.8)), 16);
  const whirl = tone(n, t.sr, f, 0.35, 0.1);
  shapeBy(whirl, (u) => smooth(u / 0.03) * (1 - u) ** 1.2);
  t.put(out, whirl, 0.05, 0.55);
  ping(out, t, 0.55, 96, 0.3);
  ping(out, t, 0.65, 100, 0.3);
  ping(out, t, 0.75, 103, 0.25);
  return out;
}

/** Spinning out on an oil slick: a skidding squeal wobbling down and a springy settle. */
export function spinout(t: Take): Mono {
  const out = t.canvas(1.1);
  const n = t.n(0.7);
  const f = sampled(n, (u) => 1600 * Math.pow(0.4, u) * (1 + 0.06 * Math.sin(2 * Math.PI * 7 * u * 0.7)), 16);
  const squeal = tone(n, t.sr, f, 0.5, 0.25);
  shapeBy(squeal, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.3));
  t.put(out, squeal, 0, 0.7);
  const hiss = bandNoise(n, t.sr, t.rng, 2000, 7000, 2);
  shapeBy(hiss, (u) => smooth(u / 0.05) * smooth((1 - u) / 0.3));
  t.put(out, hiss, 0, 0.4);
  const boing = glide(t, 0.3, 330, 150, 0.7, 0.3);
  expo(boing, t.sr, 0.1, 0.002);
  t.put(out, boing, 0.62, 0.7);
  t.put(out, thump(t, 0.12, 200, 80, 0.002, 0.03), 0.65, 0.5);
  return out;
}

/** Kart against kart: a squashy thump and a short rubbery boing. */
export function bump(t: Take): Mono {
  const out = t.canvas(0.3);
  t.put(out, thump(t, 0.12, 280, 100, 0.001, 0.032), 0, 1);
  const boing = glide(t, 0.1, 640, 430, 0.8, 0.3);
  expo(boing, t.sr, 0.04, 0.002);
  t.put(out, boing, 0.005, 0.45);
  const tick = bandNoise(t.n(0.02), t.sr, t.rng, 800, 3500, 2);
  expo(tick, t.sr, 0.005, 0.0005);
  t.put(out, tick, 0, 0.4);
  return out;
}

/** A barrier struck: a heavier thunk and a rattle of the fence. */
export function wallThud(t: Take): Mono {
  const out = t.canvas(0.55);
  t.put(out, thump(t, 0.3, 150, 48, 0.002, 0.075), 0, 1);
  const body = bandNoise(t.n(0.2), t.sr, t.rng, 150, 1400, 2);
  expo(body, t.sr, 0.05, 0.002);
  t.put(out, body, 0, 0.6);
  addMode(out, t.sr, 0.004, 410 * t.rng.range(0.97, 1.03), 0.3, 0.07, 0.4);
  addMode(out, t.sr, 0.006, 655 * t.rng.range(0.97, 1.03), 0.22, 0.05, 1.1);
  return lowpass(out, t.sr, 5000, 2);
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

// --- air ---------------------------------------------------------------------------------------------------------------

/** Off a ramp: a spring's boing up and a rush of air. */
export function jump(t: Take): Mono {
  const out = t.canvas(0.65);
  const n = t.n(0.4);
  const f = sampled(n, (u) => 190 * Math.pow(2.9, Math.pow(u, 0.7)) * (1 + 0.07 * Math.sin(2 * Math.PI * 16 * u * 0.4) * (1 - u)), 16);
  const boing = tone(n, t.sr, f, 0.35, 0.12);
  shapeBy(boing, (u) => smooth(u / 0.03) * (1 - u) ** 0.8);
  t.put(out, boing, 0, 0.9);
  t.put(out, whoosh(t, 0.45, 600, 3000, 1.4, swoosh(0.1, 1.2)), 0.05, 0.6);
  return out;
}

/** A trick in the air: a spiral of pings and a swirl of air that rises and falls. */
export function trick(t: Take): Mono {
  const out = t.canvas(0.9);
  [88, 91, 95, 100, 103].forEach((m, k) => ping(out, t, k * 0.065, m, 0.7 + 0.06 * k, 0.8));
  const n = t.n(0.6);
  const swirl = white(n, t.rng);
  svf(swirl, t.sr, "bp", (u) => 900 + 3200 * Math.sin(Math.PI * u), 1.6);
  normalize(swirl);
  shapeBy(swirl, (u) => swell(u));
  t.put(out, swirl, 0, 0.5);
  return out;
}

/** Back on the road: a soft thump and the suspension settling with a small boing. */
export function land(t: Take): Mono {
  const out = t.canvas(0.5);
  t.put(out, thump(t, 0.25, 170, 52, 0.002, 0.06), 0, 1);
  const puff = bandNoise(t.n(0.12), t.sr, t.rng, 200, 2000, 2);
  expo(puff, t.sr, 0.03, 0.002);
  t.put(out, puff, 0, 0.5);
  const settle = glide(t, 0.2, 260, 190, 1, 0.3);
  const n = settle.length;
  for (let i = 0; i < n; i++) settle[i]! *= Math.exp((-i / n) * 5) * (0.7 + 0.3 * Math.cos((2 * Math.PI * 14 * i) / t.sr));
  t.put(out, settle, 0.03, 0.4);
  return out;
}

/** Over the edge: a falling whistle with a gust of wind behind it. */
export function fall(t: Take): Mono {
  const out = t.canvas(1.8);
  const n = t.n(1.6);
  const f = sampled(n, (u) => 2100 * Math.pow(0.17, Math.pow(u, 0.85)) * (1 + 0.012 * Math.sin(2 * Math.PI * 7 * u * 1.6)), 16);
  const whistle = tone(n, t.sr, f, 0.18, 0.05);
  shapeBy(whistle, (u) => smooth(u / 0.03) * smooth((1 - u) / 0.3));
  t.put(out, whistle, 0, 1);
  const wind = bandNoise(n, t.sr, t.rng, 300, 1800, 2);
  shapeBy(wind, (u) => smooth(u / 0.2) * smooth((1 - u) / 0.3));
  t.put(out, wind, 0, 0.18);
  return out;
}

/** The drone lets go: a cork's pop and a little cheerful boing. */
export function droneDrop(t: Take): Mono {
  const out = t.canvas(0.55);
  const pop = glide(t, 0.06, 760, 210, 0.6, 0.2);
  expo(pop, t.sr, 0.02, 0.001);
  t.put(out, pop, 0, 1);
  t.put(out, click(t.sr, t.rng, 0.003, 1200, 8000), 0, 0.5);
  const boing = glide(t, 0.2, 420, 940, 0.9, 0.3);
  ar(boing, t.sr, 0.01, 0.1);
  t.put(out, boing, 0.09, 0.4);
  ping(out, t, 0.2, 88, 0.45);
  return out;
}

/** A track hazard strikes: a hollow bonk, a clatter and a slide whistle sliding down. */
export function hazard(t: Take): Mono {
  const out = t.canvas(1.1);
  addMode(out, t.sr, 0, 520 * t.rng.range(0.98, 1.02), 1, 0.05, 0);
  addMode(out, t.sr, 0, 790, 0.5, 0.035, 1);
  t.put(out, thump(t, 0.15, 210, 70, 0.001, 0.04), 0, 0.8);
  const crash = bandNoise(t.n(0.4), t.sr, t.rng, 900, 8000, 2);
  expo(crash, t.sr, 0.09, 0.002);
  t.put(out, crash, 0.01, 0.55);
  const n = t.n(0.7);
  const f = sampled(n, (u) => 1500 * Math.pow(0.17, u) * (1 + 0.025 * Math.sin(2 * Math.PI * 6 * u * 0.7)), 16);
  const slide = tone(n, t.sr, f, 0.12, 0.03);
  shapeBy(slide, (u) => smooth(u / 0.04) * smooth((1 - u) / 0.25));
  t.put(out, slide, 0.18, 0.5);
  return out;
}
