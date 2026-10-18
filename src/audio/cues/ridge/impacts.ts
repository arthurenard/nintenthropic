/**
 * Impacts, heard from far away: each sound at its source, full-bodied, for
 * the engine to delay and darken by distance (see ./index.ts). Turf,
 * granite, steel and the aim check's gong, a windscreen, the lake, timber, a
 * body and its fall, and a side window bursting.
 */
import { smooth } from "../../dsp/curves";
import { type Mono, adsr, perc, shapeBy } from "../../dsp/signal";
import { addMetal, addMode, click, decayInPlace } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { addShard, bubble, burst, flicker, knock, nWave, puff, scatter, thump } from "../kit";
import { addPebble, ricochetWhine, rustle } from "./layers";

/**
 * A round into turf: it buries itself with a dull, heavy *thup* (the soil
 * takes the energy, so there is no crack to speak of), throws up a soft wet
 * spatter of soil and roots, and clods patter back onto the grass.
 */
export function ridgeHitDirt(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.62));
  t.put(out, burst(t, 0.15, 40, 360 * t.p, 0.0008, t.d(0.032), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.15, 115 * t.p, 48 * t.p, 0.001, t.d(0.03), 0.5), 0, t.g(0.7));
  t.put(out, burst(t, 0.04, 400, 3000, 0.0003, 0.005), 0, t.g(0.45));
  const spray = flicker(t, 0.3, 700, t.c(5500), 260);
  perc(spray, t.sr, 0.004, t.d(0.07));
  t.put(out, spray, 0.004, t.g(0.4));
  scatter(out, t, r.int(8, 14), 0.08, 0.5, 600, 4500, 0.2, 1.3);
  t.put(out, burst(t, 0.06, 300, 2500, 0.001, 0.008), r.range(0.3, 0.42), t.g(0.12));
  t.put(out, puff(t, 0.35, 2500, 0.02, 0.1), 0.01, t.g(0.08));
  return out;
}

/**
 * A round on granite: an instant hard crack as the jacket splashes and the
 * stone chips, the rock ringing briefly high and dry (a few stiff modes,
 * damped at once), grit thrown off and chips landing. Every other take the
 * round goes on, whining away as it tumbles.
 */
export function ridgeHitRock(t: Take): Mono {
  const r = t.rng;
  const whine = t.index % 2 === 1;
  const out = t.canvas(whine ? t.L(1.1) : t.L(0.5));
  t.put(out, nWave(t, 0.00025), 0, t.g(0.8));
  t.put(out, click(t.sr, r, 0.003, 1500, t.c(15000)), 0, t.g(1.2));
  t.put(out, burst(t, 0.05, 1800 * t.p, t.c(13000), 0.0002, t.d(0.006), 2, 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.08, 300, 2400, 0.0004, t.d(0.012)), 0, t.g(0.5));
  const modes: [number, number, number][] = [[2300, 0.35, 0.02], [3650, 0.25, 0.014], [5400, 0.18, 0.01], [7900, 0.1, 0.007]];
  for (const [f, a, tau] of modes) addMode(out, t.sr, 0, f * t.p * r.range(0.94, 1.06), a * r.sign(), t.d(tau), 0);
  scatter(out, t, r.int(6, 11), 0.005, 0.3, 1800, 9000, 0.25, 1.6);
  for (let k = 0, count = r.int(2, 4); k < count; k++) addPebble(out, t, r.range(0.12, 0.3), r.range(0.05, 0.12));
  addPebble(out, t, r.range(0.3, 0.38), 0.05);
  if (whine) t.put(out, ricochetWhine(t, t.L(r.range(0.6, 0.85))), t.j(0.01, 0.3), t.g(0.5));
  return out;
}

/**
 * A steel plate — the aim check's gongs, a truck's engine block — struck by
 * a round: the strike's bright click, then the plate ringing in inharmonic
 * pairs that beat as they die, the upper ones first, over the dull *bong*
 * of whatever holds it.
 */
export function ridgeHitMetal(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.9));
  t.put(out, click(t.sr, r, 0.003, 2000, 16000), 0, t.g(1.1));
  t.put(out, nWave(t, 0.0003), 0, t.g(0.6));
  t.put(out, burst(t, 0.03, 1500, t.c(14000), 0.0002, 0.004), 0, t.g(0.9));
  const base = r.range(620, 980) * t.p;
  const table: [number, number, number][] = [
    [1, 1, 0.42], [1.47, 0.5, 0.3], [2.09, 0.55, 0.22], [2.56, 0.3, 0.16], [3.3, 0.25, 0.1], [4.1, 0.14, 0.07], [5.3, 0.08, 0.045],
  ];
  for (const [ratio, amp, tau] of table) {
    // Each mode a close pair, one line stronger: the beat is a slow swirl, not a tremolo.
    const f = base * ratio * (1 + r.range(-0.006, 0.006));
    const beat = r.range(1, 4);
    const split = r.range(0.65, 0.8);
    const a = amp * t.g(0.5, 2);
    addMode(out, t.sr, 0, f - beat / 2, a * split, t.d(tau * r.range(0.85, 1.15)), r.range(0, 6.28));
    addMode(out, t.sr, 0, f + beat / 2, a * (1 - split), t.d(tau * r.range(0.85, 1.15)), r.range(0, 6.28));
  }
  addMode(out, t.sr, 0, r.range(160, 240) * t.p, 0.3, t.d(0.08), 0);
  t.put(out, burst(t, 0.06, 200, t.c(2500), 0.0005, 0.012), 0, t.g(0.4));
  return out;
}

/**
 * The aim check's steel gong rung across 150 m: a clean *ding* — one mode
 * dominant, so it has a clear pitch — its upper partials dying in a moment,
 * the plate swinging on its chains (two or three faint links rattling) and
 * the ring left to fade.
 */
export function ridgePlateRing(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.9));
  t.put(out, click(t.sr, r, 0.0025, 2500, 16000), 0, t.g(1.0));
  t.put(out, burst(t, 0.03, 2000, t.c(15000), 0.0002, 0.003), 0, t.g(0.7));
  const base = r.range(880, 1050) * t.p;
  const table: [number, number, number][] = [[1, 1, 0.5], [2.76, 0.35, 0.16], [4.03, 0.2, 0.08], [5.4, 0.12, 0.05], [7.1, 0.06, 0.03]];
  for (const [ratio, amp, tau] of table) {
    const f = base * ratio * (1 + r.range(-0.004, 0.004));
    addMode(out, t.sr, 0, f - 0.6, amp * 0.75, t.d(tau), 0);
    addMode(out, t.sr, 0, f + 0.6, amp * 0.25, t.d(tau * 0.9), 0);
  }
  addMode(out, t.sr, 0, base * 0.5 * r.range(0.97, 1.03), 0.12, t.d(0.2), 0);
  for (let k = 0, count = r.int(2, 4); k < count; k++) {
    addMetal(out, t.sr, r, r.range(0.08, 0.35), r.range(2600, 3800), 0.006, 0.05, [1, 1.6, 2.3]);
  }
  return out;
}

/**
 * A round through a windscreen: laminated glass does not fall, it crazes —
 * a crunchy crack, the fractures racing out from the hole, the pane's thud
 * in the car's frame, and a few crumbs of glass tinkling onto the dash.
 */
export function ridgeHitGlass(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.72));
  t.put(out, click(t.sr, r, 0.004, 2500, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.1, 2500 * t.p, 15000, 0.0003, t.d(0.015), 2, 2), 0, t.g(0.9));
  const crunch = flicker(t, 0.12, 1500, 9000, 420);
  perc(crunch, t.sr, 0.001, t.d(0.035));
  t.put(out, crunch, 0.002, t.g(0.5));
  for (let k = 0, count = r.int(10, 16); k < count; k++) {
    const at = 0.004 + Math.pow(k / 16, 1.5) * 0.09 + r.range(0, 0.004);
    t.put(out, click(t.sr, r, r.range(0.001, 0.0025), 3000, 15000), at, r.range(0.2, 0.5));
  }
  addMode(out, t.sr, 0, 3900 * t.p, 0.15, t.d(0.04), 0);
  addMode(out, t.sr, 0, 6100 * t.p, 0.08, t.d(0.025), 0);
  t.put(out, thump(t, 0.12, 230 * t.p, 130 * t.p, 0.001, t.d(0.025), 0.5), 0, t.g(0.4));
  t.put(out, burst(t, 0.06, 150, 1200, 0.0005, 0.015), 0, t.g(0.35));
  for (let k = 0, count = r.int(3, 6); k < count; k++) {
    addShard(out, t, r.range(0.05, 0.3), r.range(3500, 9000) * t.p, r.range(0.06, 0.16), r.range(0.01, 0.025));
  }
  addShard(out, t, r.range(0.3, 0.42), r.range(4000, 8000) * t.p, 0.06, 0.015);
  return out;
}

/**
 * A round into the lake: the slap of the surface, the *plunk* of the cavity
 * it tears (a bubble whose pitch rises as it closes), a column of spray
 * thrown up and falling back as droplets.
 */
export function ridgeHitWater(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.85));
  t.put(out, burst(t, 0.03, 400, t.c(3500), 0.0003, 0.005), 0, t.g(0.8));
  t.put(out, bubble(t, r.range(300, 480) * t.p, t.d(0.035), r.range(1.8, 2.6)), 0.002, t.g(0.9));
  t.put(out, burst(t, 0.1, 50, 300, 0.001, 0.022, 4), 0, t.g(0.55));
  const splash = flicker(t, 0.45, 700, t.c(7500), 320);
  adsr(splash, t.sr, 0.012, 0.06, 0.45, 0.22);
  decayInPlace(splash, t.sr, 0, t.d(0.12));
  t.put(out, splash, 0.006, t.g(0.6));
  for (let k = 0, count = r.int(8, 14); k < count; k++) {
    const at = 0.1 + Math.pow(r.next(), 1.3) * 0.5;
    t.put(out, bubble(t, r.range(900, 3200) * t.p, r.range(0.006, 0.016), r.range(1.3, 2.0)), at, r.range(0.12, 0.35));
  }
  return out;
}

/** A round into timber — a hut's beam, a fence post: a woody knock, the thud of the mass, splinters spitting. */
export function ridgeHitWood(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.55));
  t.put(out, click(t.sr, r, 0.004, 500, t.c(9000)), 0, t.g(1.0));
  t.put(out, knock(t, r.range(260, 360) * t.p, t.d(0.035), 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.14, 60, 450, 0.0008, t.d(0.028), 4), 0, t.g(0.75));
  scatter(out, t, r.int(7, 12), 0.004, 0.16, 900, 7500, 0.45, 1.8);
  t.put(out, knock(t, r.range(900, 1500), 0.006, 0.5), r.range(0.16, 0.28), t.g(0.12));
  return out;
}

/**
 * A round striking a body, far off: all that carries is a muffled *whump* —
 * the mass of it, the slap of the coat — the sharper parts lost to the
 * distance before they start.
 */
export function ridgeHitFlesh(t: Take): Mono {
  const out = t.canvas(0.42);
  t.put(out, burst(t, 0.3, 45, 380 * t.p, 0.0012, t.d(0.045), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.25, 125 * t.p, 50 * t.p, 0.0012, t.d(0.04), 0.5), 0, t.g(0.8));
  t.put(out, burst(t, 0.04, 500 * t.p, t.c(3000), 0.0004, t.d(0.006), 2), 0, t.g(0.55));
  const wet = flicker(t, 0.15, 600, 2800, 140);
  perc(wet, t.sr, 0.003, t.d(0.03));
  t.put(out, wet, 0.004, t.g(0.18));
  return out;
}

/**
 * A body dropping in the meadow: the torso's soft, heavy thud, the limbs a
 * moment after, the long grass crushed under them. No clatter: the grass
 * takes it all.
 */
export function ridgeBodyFall(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.85));
  const hits: [number, number, number][] = [[0, 1.0, 200], [t.j(0.14, 0.3), 0.55, 160]];
  if (r.chance(0.6)) hits.push([t.j(0.3, 0.2), 0.3, 240]);
  for (const [at, gain, cutoff] of hits) {
    t.put(out, burst(t, 0.3, 30, t.c(cutoff * t.p), 0.004, t.d(0.06), 4), at, t.g(gain));
    t.put(out, thump(t, 0.25, 110 * t.p, 42 * t.p, 0.004, t.d(0.05), 0.5), at, t.g(0.7 * gain));
    t.put(out, rustle(t, 0.3 * gain + 0.1, 1200, t.c(7000), 70), at, t.g(0.18 * gain));
  }
  t.put(out, puff(t, 0.4, 900, 0.02, 0.1), 0.01, t.g(0.1));
  return out;
}

/**
 * A side window giving way: toughened glass does not crack, it bursts — a
 * crack, a crash, then a rushing rain of little cubes onto the seat, the
 * running board and the road, the bigger clumps ticking on the steel.
 */
export function ridgeGlassShatter(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.35));
  t.put(out, click(t.sr, r, 0.004, 2500, 16000), 0, t.g(1.3));
  t.put(out, burst(t, 0.25, 1800 * t.p, 15000, 0.0004, t.d(0.05), 2, 2), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 600, 5000, 0.002, t.d(0.07), 2), 0.004, t.g(0.4));
  // The rush of cubes: noise crackling at the rate the pieces arrive, swelling and thinning.
  const cascade = flicker(t, 0.9, 3000, t.c(12000), 650);
  shapeBy(cascade, (u) => smooth(u * 12) * Math.pow(1 - u, 1.6));
  t.put(out, cascade, 0.01, t.g(0.4));
  for (let k = 0, count = r.int(40, 60); k < count; k++) {
    const at = 0.01 + Math.pow(r.next(), 1.5) * 1.0;
    const size = 1 - 0.6 * (at / 1.0);
    addShard(out, t, at, r.range(4000, 11000) * t.p, r.range(0.04, 0.16) * size, r.range(0.006, 0.02));
  }
  for (let k = 0, count = r.int(3, 6); k < count; k++) {
    const at = r.range(0.15, 0.7);
    addMetal(out, t.sr, r, at, r.range(1800, 3000), 0.01, r.range(0.05, 0.12), [1, 1.47, 2.2]);
    t.put(out, click(t.sr, r, 0.003, 2000, 14000), at, r.range(0.15, 0.3));
  }
  return out;
}
