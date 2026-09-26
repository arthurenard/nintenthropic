/**
 * What a bullet (or a body) sounds like when it lands: in flesh, bone, wood,
 * dirt, iron, glass and water. These are the player's feedback, so each has
 * a crisp front that reads at 40 m and a body that says what was hit.
 */
import { biquad, highpass, lowpass, svf } from "../dsp/filters";
import { type Mono, adsr, normalize, shapeBy, wobble } from "../dsp/signal";
import { addMetal, addMode, bandNoise, click, decayInPlace, white } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { addShard, bubble, burst, creak, knock, nWave, puff, scatter, thump } from "./kit";

/** Noise that flickers: rectified slow noise as its envelope. The wet part of an impact. */
function squelch(t: Take, seconds: number, low: number, high: number, rate: number): Mono {
  const n = t.n(seconds);
  const buf = bandNoise(n, t.sr, t.rng, low, high, 2);
  const flick = wobble(n, t.sr, rate, () => t.rng.next());
  for (let i = 0; i < n; i++) buf[i]! *= Math.abs(flick[i]!) ** 1.5;
  return normalize(buf);
}

/**
 * A bullet into a body: the slap of cloth and skin (the part that carries
 * down the street), a dull thud of the mass under it, and a short wet
 * flicker. Never a splat: it has to be heard fifty times a game.
 */
export function hitFlesh(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.4);
  t.put(out, burst(t, 0.04, 700 * t.p, t.c(4500), 0.0004, t.d(0.006), 2), 0, t.g(0.9));
  t.put(out, burst(t, 0.03, t.c(2500), 9000, 0.0003, 0.004, 2), 0, t.g(0.35));
  t.put(out, burst(t, 0.25, 55, 420 * t.p, 0.0012, t.d(0.04), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.2, 150 * t.p, 62 * t.p, 0.001, t.d(0.035), 0.5), 0, t.g(0.75));
  const wet = squelch(t, 0.2, 800, 3800, 160);
  decayInPlace(wet, t.sr, 0.003, t.d(0.035));
  t.put(out, wet, 0.004, t.g(0.3));
  // Dust and cloth puffed out of the coat.
  t.put(out, puff(t, 0.12, 5000, 0.004, 0.025), 0.003, t.g(0.12));
  void r;
  return out;
}

/**
 * The headshot: the reward sound. A hard, bright crack of bone over the
 * body hit, and the hollow *tock* of the skull, pitched to cut through a
 * gunfight without becoming an arcade ding.
 */
export function hitHeadshot(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.5);
  t.put(out, nWave(t, 0.00025), 0, t.g(0.7));
  t.put(out, click(t.sr, r, 0.005, 900, t.c(13000)), 0, t.g(1.1));
  t.put(out, burst(t, 0.05, 1600 * t.p, t.c(9500), 0.0002, t.d(0.007), 2), 0, t.g(1.0));
  // The skull: two hollow modes a little apart, a knock, not a bell.
  addMode(out, t.sr, 0, 820 * t.p, 0.45, t.d(0.022), r.range(0, 6));
  addMode(out, t.sr, 0, 1340 * t.p, 0.3, t.d(0.014), r.range(0, 6));
  addMode(out, t.sr, 0, 2150 * t.p, 0.2, t.d(0.009), r.range(0, 6));
  t.put(out, burst(t, 0.2, 60, 380 * t.p, 0.001, t.d(0.03), 4), 0, t.g(0.75));
  t.put(out, thump(t, 0.15, 180 * t.p, 70 * t.p, 0.001, t.d(0.03), 0.5), 0, t.g(0.5));
  const wet = squelch(t, 0.2, 900, 4200, 200);
  decayInPlace(wet, t.sr, 0.002, t.d(0.03));
  t.put(out, wet, 0.003, t.g(0.28));
  // The hat or the dust behind: a scatter of fine grains.
  scatter(out, t, 5, 0.02, 0.2, 2500, 9000, 0.12);
  return out;
}

/** A bullet into a plank: a woody knock, a thud, and a crackle of splinters. */
export function hitWood(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.5);
  t.put(out, click(t.sr, r, 0.004, 500, t.c(9000)), 0, t.g(1.0));
  t.put(out, knock(t, r.range(290, 380) * t.p, t.d(0.032), 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.12, 70, 480, 0.0008, t.d(0.025), 4), 0, t.g(0.7));
  scatter(out, t, r.int(7, 12), 0.004, 0.16, 900, 7500, 0.45, 1.8);
  return out;
}

/**
 * A bullet into the street: a short *thup* in packed dirt, a spray of grit
 * thrown up, pebbles pattering down, and a breath of dust.
 */
export function hitDirt(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.6);
  t.put(out, burst(t, 0.12, 50, 320 * t.p, 0.0008, t.d(0.028), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.12, 120 * t.p, 55 * t.p, 0.001, t.d(0.025), 0.5), 0, t.g(0.6));
  t.put(out, burst(t, 0.04, 500, 3500, 0.0003, 0.005), 0, t.g(0.55));
  const spray = squelch(t, 0.3, 1500, 8500, 400);
  decayInPlace(spray, t.sr, 0.004, t.d(0.06));
  t.put(out, spray, 0.003, t.g(0.4));
  scatter(out, t, r.int(12, 20), 0.03, 0.45, 1800, 9000, 0.22, 1.4);
  const dust = bandNoise(t.n(0.4), t.sr, r, 3000, 10000, 2);
  adsr(dust, t.sr, 0.03, 0.1, 0.4, 0.2);
  t.put(out, dust, 0.02, t.g(0.05));
  return out;
}

/**
 * A bullet on iron — a sign, a lantern, a wagon's tyre: a hard strike, then
 * the plate rings in inharmonic pairs that beat as they die (the upper ones
 * first), over the dull *bong* of the object's body.
 */
export function hitMetal(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.1));
  t.put(out, click(t.sr, r, 0.003, 2000, 15000), 0, t.g(1.1));
  t.put(out, burst(t, 0.02, 1200, t.c(14000), 0.0002, 0.0035), 0, t.g(1.0));
  const base = r.range(950, 1500) * t.p;
  const table: [number, number, number][] = [
    [1.0, 1.0, 0.3], [1.58, 0.35, 0.16], [2.33, 0.45, 0.12], [3.17, 0.2, 0.08], [3.9, 0.16, 0.06], [5.2, 0.08, 0.035],
  ];
  for (const [ratio, amp, tau] of table) {
    for (const s of ratio === 1 ? [0] : [-1, 1]) {
      const f = base * ratio * (1 + s * r.range(0.002, 0.005));
      addMode(out, t.sr, 0, f, amp * t.g(0.5, 2), t.d(tau * r.range(0.8, 1.2)), r.range(0, 6.28));
    }
  }
  addMode(out, t.sr, 0, r.range(210, 330) * t.p, 0.35, t.d(0.07), r.range(0, 6));
  t.put(out, burst(t, 0.05, 300, t.c(2200), 0.0005, 0.01), 0, t.g(0.4));
  return out;
}

/** A bullet through a window pane: a crack, a short bright shatter, a few shards. */
export function hitGlass(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.7);
  t.put(out, click(t.sr, r, 0.004, 2500, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.1, 2800 * t.p, 15000, 0.0003, t.d(0.018), 2, 2), 0, t.g(0.9));
  addMode(out, t.sr, 0, 3900 * t.p, 0.18, t.d(0.05), r.range(0, 6));
  addMode(out, t.sr, 0, 3917 * t.p, 0.18, t.d(0.04), r.range(0, 6));
  addMode(out, t.sr, 0, 6100 * t.p, 0.1, t.d(0.03), r.range(0, 6));
  // The crack running out from the hole: clicks racing and thinning.
  for (let k = 0; k < r.int(8, 14); k++) {
    const at = 0.004 + Math.pow(k / 14, 1.6) * 0.08 + r.range(0, 0.004);
    t.put(out, click(t.sr, r, r.range(0.001, 0.0025), 3000, 15000), at, r.range(0.2, 0.55));
  }
  for (let k = 0; k < r.int(5, 9); k++) {
    addShard(out, t, r.range(0.05, 0.5), r.range(3500, 9000) * t.p, r.range(0.08, 0.2), r.range(0.01, 0.03));
  }
  return out;
}

/**
 * A bullet into the trough: the slap of the surface, the *plunk* of the
 * cavity it tears (a bubble whose pitch rises as it closes), the splash
 * thrown up, and droplets falling back.
 */
export function hitWater(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  t.put(out, burst(t, 0.03, 400, t.c(3200), 0.0003, 0.005), 0, t.g(0.8));
  t.put(out, bubble(t, r.range(320, 520) * t.p, t.d(0.03), r.range(1.8, 2.6)), 0.002, t.g(0.9));
  t.put(out, burst(t, 0.1, 60, 300, 0.001, 0.02, 4), 0, t.g(0.5));
  const splash = squelch(t, 0.4, 700, t.c(7000), 300);
  adsr(splash, t.sr, 0.01, 0.06, 0.4, 0.2);
  decayInPlace(splash, t.sr, 0, t.d(0.11));
  t.put(out, splash, 0.006, t.g(0.55));
  for (let k = 0; k < r.int(7, 13); k++) {
    const at = 0.08 + Math.pow(r.next(), 1.3) * 0.55;
    t.put(out, bubble(t, r.range(900, 3200) * t.p, r.range(0.006, 0.018), r.range(1.3, 2.0)), at, r.range(0.12, 0.35));
  }
  return out;
}

/**
 * The player is hit: no voice, just the body blow — a heavy low thump you
 * feel, the slap of it, a muffled crack of the round, and a pressure swell
 * that closes in and lets go, like the breath knocked out of you.
 */
export function playerHurt(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  t.put(out, thump(t, 0.4, 95 * t.p, 36 * t.p, 0.002, t.d(0.09), 0.5), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 35, 260, 0.002, t.d(0.07), 4), 0, t.g(0.9));
  t.put(out, burst(t, 0.05, 500, 2600, 0.0005, 0.009), 0, t.g(0.55));
  const crack = nWave(t, 0.0004);
  lowpass(crack, t.sr, 2500, 2);
  t.put(out, crack, 0, t.g(0.6));
  const swell = white(t.n(0.7), r);
  lowpass(swell, t.sr, 380, 4);
  normalize(swell);
  shapeBy(swell, (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 1.5) * Math.exp(-u * 2));
  t.put(out, swell, 0.01, t.g(0.4));
  // A second, softer pulse: the heart answering.
  t.put(out, thump(t, 0.2, 70 * t.p, 40 * t.p, 0.003, 0.05, 0.6), t.j(0.34, 0.1), t.g(0.35));
  return out;
}

/**
 * A body going down: the heavy thump of the torso, the second of the limbs
 * and head, leather and cloth, a gun clattering free, and dust settling.
 * Half the takes land in the dirt, half on the boardwalk (a woody knock).
 */
export function bodyFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.1));
  const boards = t.index % 2 === 1;
  const hits: [number, number, number][] = [[0, 1.0, 190], [t.j(0.16, 0.3), 0.6, 150]];
  if (r.chance(0.6)) hits.push([t.j(0.3, 0.2), 0.3, 220]);
  for (const [at, gain, cutoff] of hits) {
    t.put(out, burst(t, 0.3, 35, t.c(cutoff * t.p), 0.004, t.d(0.06), 4), at, t.g(gain));
    t.put(out, thump(t, 0.25, 120 * t.p, 45 * t.p, 0.004, t.d(0.05), 0.5), at, t.g(0.7 * gain));
    if (boards) t.put(out, knock(t, r.range(150, 220) * t.p, t.d(0.05), 1), at, t.g(0.5 * gain));
  }
  const leather = bandNoise(t.n(0.2), t.sr, r, 400, 3200, 2);
  adsr(leather, t.sr, 0.02, 0.05, 0.3, 0.1);
  t.put(out, leather, 0.01, t.g(0.2));
  // The gun hits the ground a moment after the hand lets go.
  if (r.chance(0.7)) {
    const at = t.j(0.24, 0.3);
    addMetal(out, t.sr, r, at, r.range(1700, 2400), 0.02, 0.18, [1, 1.52, 2.44]);
    t.put(out, burst(t, 0.05, 200, 1500, 0.0005, 0.01), at, t.g(0.2));
  }
  const dust = bandNoise(t.n(0.7), t.sr, r, 500, 2600, 2);
  adsr(dust, t.sr, 0.08, 0.3, 0.3, 0.3);
  t.put(out, dust, 0.1, t.g(0.08));
  return out;
}

/**
 * A window pane shattering and falling: the crack, the crash of the whole
 * pane letting go, the big pieces knocking on the boardwalk, and a long
 * cascade of shards tinkling and settling.
 */
export function glassBreak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.7));
  t.put(out, click(t.sr, r, 0.004, 2500, 16000), 0, t.g(1.3));
  t.put(out, burst(t, 0.2, 2000 * t.p, 15000, 0.0004, t.d(0.04), 2, 2), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 700, 5000, 0.002, t.d(0.06), 2), 0.004, t.g(0.4));
  for (const f of [1900, 3100, 4700, 6300]) {
    addMode(out, t.sr, 0, f * t.p * r.range(0.95, 1.05), 0.12, t.d(r.range(0.02, 0.05)), r.range(0, 6));
  }
  // The shards: a first dense spray, then pieces landing in clusters.
  for (let k = 0; k < r.int(28, 40); k++) {
    const at = 0.01 + Math.pow(r.next(), 1.7) * 1.2;
    const size = 1 - 0.6 * (at / 1.2);
    addShard(out, t, at, r.range(2800, 10000) * t.p, r.range(0.05, 0.22) * size, r.range(0.008, 0.035));
  }
  for (let k = 0; k < r.int(3, 6); k++) {
    const at = r.range(0.18, 0.6);
    t.put(out, knock(t, r.range(500, 900), 0.008, 0.6), at, r.range(0.1, 0.25));
    t.put(out, click(t.sr, r, 0.003, 2000, 14000), at, r.range(0.2, 0.4));
  }
  return out;
}

/**
 * A bottle bursting: the hollow *tonk* of the bottle itself, the crash, and
 * shards spraying and tinkling down. The aim check's target, so crisp.
 */
export function bottleBreak(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.95));
  t.put(out, click(t.sr, r, 0.004, 2000, 16000), 0, t.g(1.4));
  t.put(out, burst(t, 0.12, 2400 * t.p, 14000, 0.0004, t.d(0.024), 2, 2), 0, t.g(1.0));
  // The bottle's body: its wall modes and the air in it.
  addMode(out, t.sr, 0, r.range(1600, 2100) * t.p, 0.5, t.d(0.02), r.range(0, 6));
  addMode(out, t.sr, 0, r.range(2900, 3400) * t.p, 0.3, t.d(0.012), r.range(0, 6));
  addMode(out, t.sr, 0, r.range(4800, 5400) * t.p, 0.15, t.d(0.008), r.range(0, 6));
  addMode(out, t.sr, 0, r.range(280, 380) * t.p, 0.3, t.d(0.018), r.range(0, 6));
  for (let k = 0; k < r.int(12, 18); k++) {
    const at = 0.02 + Math.pow(r.range(0, 0.5), 1.3) * 1.2;
    addShard(out, t, at, r.range(3500, 9500) * t.p, r.range(0.15, 0.4), r.range(0.008, 0.03));
  }
  return out;
}

/**
 * Wood splitting: a sharp crack, the fibres tearing (a fast burst of
 * stick-slip crackles), the plank's knock, splinters flying and small bits
 * dropping onto the boards.
 */
export function woodSplinter(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  t.put(out, click(t.sr, r, 0.004, 600, 11000), 0, t.g(1.2));
  const tear = creak(t, t.j(0.07, 0.3), (u) => 420 - 250 * u, [[900, 3, 1], [2100, 4, 0.6], [4200, 4, 0.3]], 0.9);
  decayInPlace(tear, t.sr, 0.001, 0.03);
  t.put(out, tear, 0.002, t.g(0.7));
  t.put(out, knock(t, r.range(240, 330) * t.p, t.d(0.035), 1), 0, t.g(0.9));
  t.put(out, burst(t, 0.12, 60, 420, 0.001, 0.03, 4), 0, t.g(0.6));
  scatter(out, t, r.int(10, 16), 0.005, 0.3, 1000, 8000, 0.4, 1.6);
  for (let k = 0; k < r.int(3, 6); k++) {
    const at = r.range(0.15, 0.55);
    t.put(out, knock(t, r.range(700, 1400), 0.006, 0.5), at, r.range(0.08, 0.2));
  }
  return out;
}

/**
 * A shutter slamming in the wind: the plank's heavy knock, the bounce off
 * its frame a moment later, and the latch rattling on its hook.
 */
export function shutterBang(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.0));
  const swing = puff(t, 0.12, 700, 0.06, 0.03);
  t.put(out, swing, 0, t.g(0.12));
  const at = 0.06;
  t.put(out, click(t.sr, r, 0.005, 400, 7000), at, t.g(1.0));
  t.put(out, knock(t, r.range(150, 210) * t.p, t.d(0.07), 1), at, t.g(1.0));
  t.put(out, burst(t, 0.2, 40, 300, 0.001, t.d(0.05), 4), at, t.g(0.9));
  const bounce = at + t.j(0.075, 0.25);
  t.put(out, knock(t, r.range(180, 250) * t.p, t.d(0.04), 1), bounce, t.g(0.4));
  t.put(out, click(t.sr, r, 0.004, 500, 6000), bounce, t.g(0.35));
  let rattle = bounce + 0.02;
  for (let k = 0; k < r.int(3, 6); k++) {
    addMetal(out, t.sr, r, rattle, r.range(2400, 3600), 0.008, 0.08 * (1 - k * 0.12), [1, 1.6, 2.3]);
    rattle += r.range(0.025, 0.06);
  }
  return out;
}

/** Shared by recipes that want a whoosh swept through a band: re-exported for the world. */
export function sweptAir(t: Take, seconds: number, from: number, to: number, q: number): Mono {
  const buf = white(t.n(seconds), t.rng);
  svf(buf, t.sr, "bp", (u) => from * Math.pow(to / from, u), q);
  highpass(buf, t.sr, 150, 2);
  biquad(buf, t.sr, "lowpass", 9000);
  return normalize(buf);
}
