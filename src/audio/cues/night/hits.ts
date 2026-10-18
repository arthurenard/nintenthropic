/**
 * Bullets landing: in the dead (the body, the head, the Mechanic's welding
 * mask), in what stands round the station (steel, wet wood, the road, glass,
 * the corn, a puddle, a sandbag), and a ricochet.
 */
import { lowpass } from "../../dsp/filters";
import { type Mono, adsr, shapeBy, tailOff } from "../../dsp/signal";
import { addMetal, addMode, bandNoise, click, decayInPlace } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { addShard, bubble, burst, creak, flicker, knock, nWave, scatter, thump } from "../kit";
import { breathOn, leafRasp, sandTrickle, tone } from "./layers";

/**
 * A bullet into one of the dead: the slap of wet cloth (duller than a dry
 * coat), a heavy slack thud of the mass under it, a wet flicker, and a
 * smaller second flick as the body gives. Heavy and wet, never a splat: it
 * is heard a hundred times a night.
 */
export function nightHit(t: Take): Mono {
  const out = t.canvas(t.L(0.38));
  t.put(out, burst(t, 0.04, 550 * t.p, t.c(3800), 0.0004, t.d(0.006), 2), 0, t.g(0.85));
  t.put(out, burst(t, 0.3, 45, 360 * t.p, 0.0015, t.d(0.05), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.25, 135 * t.p, 52 * t.p, 0.001, t.d(0.045), 0.5), 0, t.g(0.8));
  const wet = flicker(t, 0.22, 500, 3200, 140);
  decayInPlace(wet, t.sr, 0.004, t.d(0.04));
  t.put(out, wet, 0.004, t.g(0.34));
  const give = flicker(t, 0.12, 250, 1400, 90);
  decayInPlace(give, t.sr, 0.006, 0.025);
  t.put(out, give, t.j(0.035, 0.3), t.g(0.22));
  return out;
}

/**
 * The headshot, the reward: the crack of bone (the round's shock, a bright
 * click, a hard band of noise, the skull's hollow modes), then the wet knock
 * of the head snapping back — heavy, soft and low — and a fine spatter onto
 * the road a moment later.
 */
export function nightHeadshot(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.48));
  t.put(out, nWave(t, 0.00025), 0, t.g(0.6));
  t.put(out, click(t.sr, r, 0.004, 1100, t.c(13000)), 0, t.g(1.1));
  t.put(out, burst(t, 0.05, 1800 * t.p, t.c(10000), 0.0002, t.d(0.006), 2), 0, t.g(0.95));
  addMode(out, t.sr, 0, 760 * t.p, 0.45 * r.sign(), t.d(0.02), 0);
  addMode(out, t.sr, 0, 1270 * t.p, 0.3 * r.sign(), t.d(0.013), 0);
  addMode(out, t.sr, 0, 2050 * t.p, 0.18 * r.sign(), t.d(0.008), 0);
  const at = t.j(0.012, 0.3);
  t.put(out, burst(t, 0.2, 55, 420 * t.p, 0.001, t.d(0.035), 4), at, t.g(0.8));
  t.put(out, thump(t, 0.15, 190 * t.p, 75 * t.p, 0.001, t.d(0.03), 0.5), at, t.g(0.55));
  addMode(out, t.sr, at, r.range(420, 520) * t.p, 0.3, t.d(0.018), 0);
  const wet = flicker(t, 0.22, 700, 3800, 190);
  decayInPlace(wet, t.sr, 0.002, t.d(0.035));
  t.put(out, wet, at + 0.002, t.g(0.4));
  scatter(out, t, r.int(5, 9), 0.06, 0.3, 1500, 7000, 0.1, 1.3);
  return out;
}

/**
 * A bullet on sheet steel — the pump's cabinet, the pickup's door, the
 * burned bus: a hard bright strike, then the panel rings in many modes,
 * each a pair a hair apart that beats as it dies (the upper ones first),
 * over the dull bong of the panel's body. Some panels are loose and buzz
 * against their frame; some ring long, some are dead with rust.
 */
export function nightHitMetal(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.05));
  t.put(out, click(t.sr, r, 0.003, 1800, 15000), 0, t.g(1.1));
  t.put(out, burst(t, 0.02, 1100, t.c(13000), 0.0002, 0.0035), 0, t.g(0.9));
  const base = r.range(300, 720) * t.p;
  const ring = r.range(0.14, 0.32);
  const ratios = [1, 1.37, 1.93, 2.41, 2.88, 3.62, 4.37, 5.5];
  ratios.forEach((ratio, k) => {
    const f = base * ratio * r.range(0.985, 1.015);
    const amp = t.g(Math.pow(0.72, k), 2) * 0.5;
    const tau = t.d(ring * Math.pow(0.8, k)) * r.range(0.8, 1.2);
    addMode(out, t.sr, 0, f, amp * r.sign(), tau, 0);
    addMode(out, t.sr, 0, f * (1 + r.range(0.002, 0.006)), amp * 0.5 * r.sign(), tau * 0.9, 0);
  });
  addMode(out, t.sr, 0, base * r.range(0.35, 0.45), 0.4, t.d(0.08), 0);
  t.put(out, burst(t, 0.06, 150, t.c(1800), 0.0005, 0.012), 0, t.g(0.5));
  if (r.chance(0.5)) {
    // A loose panel buzzing against its frame for a moment.
    const len = r.range(0.15, 0.3);
    const rattle = bandNoise(t.n(len), t.sr, r, 600, 4000, 2);
    const rate = r.range(38, 60);
    shapeBy(rattle, (u) => Math.pow(Math.max(0, Math.sin(2 * Math.PI * rate * u * len)), 6) * Math.pow(1 - u, 1.5), 8);
    t.put(out, rattle, 0.01, t.g(0.2));
  }
  return tailOff(out, t.sr, 0.25);
}

/**
 * A bullet into old wet wood — a fence rail, the barn, a pole: a duller
 * knock than a dry plank, more thud, a short tear of fibres, a few splinters.
 */
export function nightHitWood(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.45));
  t.put(out, click(t.sr, r, 0.004, 450, t.c(8000)), 0, t.g(0.9));
  t.put(out, knock(t, r.range(210, 320) * t.p, t.d(0.03), 1), 0, t.g(1.0));
  t.put(out, burst(t, 0.14, 60, 420, 0.0008, t.d(0.03), 4), 0, t.g(0.8));
  const tear = creak(t, t.j(0.05, 0.3), (u) => 520 - 300 * u, [[800, 3, 1], [1900, 4, 0.5], [3800, 4, 0.2]], 0.9);
  decayInPlace(tear, t.sr, 0.001, 0.02);
  t.put(out, tear, 0.002, t.g(0.4));
  scatter(out, t, r.int(4, 8), 0.004, 0.14, 800, 6000, 0.35, 1.8);
  return out;
}

/**
 * A bullet into the road: the crack of the round flattening on asphalt
 * (hard, bright, short), the thud of the road under it, grit flung up in a
 * hiss, the chips landing, a pebble or two bouncing.
 */
export function nightHitGround(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.55));
  t.put(out, click(t.sr, r, 0.003, 1400, t.c(15000)), 0, t.g(1.2));
  t.put(out, burst(t, 0.05, 900 * t.p, t.c(11000), 0.0002, t.d(0.006), 2, 1), 0, t.g(0.9));
  t.put(out, burst(t, 0.12, 55, 380 * t.p, 0.0008, t.d(0.022), 4), 0, t.g(0.75));
  t.put(out, thump(t, 0.1, 140 * t.p, 60 * t.p, 0.001, t.d(0.02), 0.5), 0, t.g(0.45));
  const spray = flicker(t, 0.25, 2000, 9500, 450);
  decayInPlace(spray, t.sr, 0.002, t.d(0.04));
  t.put(out, spray, 0.002, t.g(0.35));
  scatter(out, t, r.int(14, 24), 0.03, 0.45, 2000, 9500, 0.25, 1.3);
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    addShard(out, t, r.range(0.12, 0.4), r.range(2500, 5000) * t.p, r.range(0.04, 0.09), 0.004);
  }
  return out;
}

/**
 * A bullet through a window pane (the station, the motel, the bus): the
 * crack, a short bright shatter, the crack racing out from the hole, a big
 * piece dropping onto the asphalt and a few shards after it.
 */
export function nightHitGlass(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.65));
  t.put(out, click(t.sr, r, 0.004, 2400, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.1, 2600 * t.p, 15000, 0.0003, t.d(0.02), 2, 2), 0, t.g(0.95));
  const pane = r.range(3100, 3700) * t.p;
  addMode(out, t.sr, 0, pane, 0.18, t.d(0.05), 0);
  addMode(out, t.sr, 0, pane * 1.005, 0.16, t.d(0.04), 0);
  addMode(out, t.sr, 0, pane * 1.64, 0.1, t.d(0.03), 0);
  for (let k = 0, c = r.int(7, 12); k < c; k++) {
    const at = 0.004 + Math.pow(k / 12, 1.6) * 0.08 + r.range(0, 0.004);
    t.put(out, click(t.sr, r, r.range(0.001, 0.0025), 3000, 15000), at, r.range(0.2, 0.5));
  }
  const drop = r.range(0.22, 0.34);
  t.put(out, knock(t, r.range(700, 1000), 0.008, 0.6), drop, t.g(0.25));
  t.put(out, click(t.sr, r, 0.003, 2000, 14000), drop, t.g(0.3));
  for (let k = 0, c = r.int(6, 10); k < c; k++) {
    addShard(out, t, r.range(0.05, 0.55), r.range(3500, 9000) * t.p, r.range(0.06, 0.18), r.range(0.01, 0.03));
  }
  return out;
}

/**
 * A bullet through the corn: a dry stalk snapping (the crack of a hollow
 * cane, its knock, a short tear of fibres), the long leaves thrashing and
 * crackling as they settle, and sometimes a second stalk giving way.
 */
export function nightHitCorn(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.7));
  const snapStalk = (at: number, gain: number): void => {
    t.put(out, click(t.sr, r, 0.003, 900, t.c(12000)), at, gain);
    t.put(out, knock(t, r.range(620, 900) * t.p, t.d(0.008), 1), at, gain * 0.7);
    const fibres = creak(t, t.j(0.04, 0.3), (u) => 900 - 500 * u, [[1400, 3, 1], [3200, 4, 0.5]], 1);
    decayInPlace(fibres, t.sr, 0.001, 0.015);
    t.put(out, fibres, at + 0.003, gain * 0.4);
  };
  snapStalk(0.004, t.g(1.0));
  const rustle = leafRasp(t, 0.6, r.range(60, 90));
  shapeBy(rustle, (u) => Math.min(1, u * 25) * Math.pow(1 - u, 2.2));
  t.put(out, rustle, 0.006, t.g(0.45));
  scatter(out, t, r.int(20, 34), 0.01, 0.55, 1800, 9000, 0.3, 1.8);
  if (r.chance(0.6)) snapStalk(r.range(0.1, 0.25), t.g(0.4));
  return out;
}

/**
 * A bullet into a puddle: the slap of the surface and, an inch under it, the
 * asphalt; a short plunk (a puddle has no depth for a deep one); the sheet of
 * water thrown up; drops pattering back onto the puddle and the road.
 */
export function nightHitWater(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.72));
  t.put(out, burst(t, 0.03, 450, t.c(3500), 0.0003, 0.005), 0, t.g(0.85));
  t.put(out, click(t.sr, r, 0.003, 1200, 10000), 0.001, t.g(0.45));
  t.put(out, burst(t, 0.08, 60, 320, 0.001, 0.016, 4), 0, t.g(0.5));
  t.put(out, bubble(t, r.range(500, 800) * t.p, t.d(0.015), r.range(1.6, 2.2)), 0.002, t.g(0.6));
  const splash = flicker(t, 0.35, 800, t.c(7500), 320);
  adsr(splash, t.sr, 0.008, 0.05, 0.35, 0.15);
  decayInPlace(splash, t.sr, 0, t.d(0.09));
  t.put(out, splash, 0.004, t.g(0.6));
  for (let k = 0, c = r.int(10, 16); k < c; k++) {
    const at = 0.06 + Math.pow(r.next(), 1.2) * 0.5;
    if (r.chance(0.6)) {
      t.put(out, bubble(t, r.range(1100, 3600) * t.p, r.range(0.004, 0.012), r.range(1.3, 1.9)), at, r.range(0.1, 0.3));
    } else {
      t.put(out, burst(t, 0.008, 1500, 8000, 0.0002, 0.0012), at, r.range(0.05, 0.15));
    }
  }
  return out;
}

/**
 * A bullet into a sandbag: a coarse pop of the burlap, then the sand
 * swallowing it — a dull, dead thump with no ring at all — grains spat back
 * out of the hole, and a thin trickle running out after.
 */
export function nightHitSandbag(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  t.put(out, burst(t, 0.03, 500, t.c(3200), 0.0004, 0.004), 0, t.g(0.6));
  t.put(out, click(t.sr, r, 0.002, 700, 6000), 0, t.g(0.35));
  t.put(out, burst(t, 0.2, 40, 260 * t.p, 0.0012, t.d(0.03), 4), 0, t.g(1.0));
  t.put(out, thump(t, 0.16, 110 * t.p, 48 * t.p, 0.0015, t.d(0.028), 0.5), 0, t.g(0.7));
  scatter(out, t, r.int(8, 14), 0.005, 0.1, 2500, 9000, 0.18, 1.5);
  t.put(out, sandTrickle(t, t.j(0.55, 0.15)), t.j(0.06, 0.3), t.g(0.22));
  return out;
}

/**
 * A bullet off the Mechanic's welding mask: a spark of a strike (sharper
 * than any other hit), then the curved steel shell rings — its low modes
 * long, the upper ones in beating pairs — over the hollow of the mask (a
 * low bong and the thud of the head inside it), and the hinge rattling as
 * his head is knocked back.
 */
export function nightMaskClang(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.2));
  t.put(out, nWave(t, 0.0003), 0, t.g(0.6));
  t.put(out, click(t.sr, r, 0.003, 2000, 16000), 0, t.g(1.2));
  t.put(out, burst(t, 0.02, 1500, t.c(14000), 0.0002, 0.003), 0, t.g(0.9));
  const base = r.range(430, 560) * t.p;
  const table: [number, number, number][] = [
    [1, 1, 0.42], [1.53, 0.55, 0.3], [2.12, 0.6, 0.22], [2.79, 0.35, 0.15],
    [3.45, 0.3, 0.11], [4.3, 0.18, 0.07], [5.6, 0.1, 0.045], [7.1, 0.06, 0.03],
  ];
  for (const [ratio, amp, tau] of table) {
    for (const s of [-1, 1]) {
      const f = base * ratio * (1 + s * r.range(0.002, 0.006));
      addMode(out, t.sr, 0, f, 0.5 * amp * t.g(1, 2) * r.sign(), t.d(tau) * r.range(0.85, 1.15), 0);
    }
  }
  addMode(out, t.sr, 0, r.range(170, 230) * t.p, 0.5, t.d(0.09), 0);
  t.put(out, burst(t, 0.12, 60, 450, 0.001, t.d(0.03), 4), 0.001, t.g(0.6));
  for (let k = 0, c = r.int(2, 4); k < c; k++) {
    addMetal(out, t.sr, r, 0.05 + k * r.range(0.04, 0.07), r.range(2200, 3200), 0.008, 0.07, [1, 1.6, 2.3]);
  }
  return tailOff(out, t.sr, 0.3);
}

/**
 * A ricochet off the road or the steel: a spark of a click and a spit of
 * grit, then the whine of the deformed round tumbling away — its pitch
 * falling fast as it leaves and on as it goes, wobbling with each turn — a
 * thin tone inside a narrow band of air, dulled at the top by the fog.
 */
export function nightRicochet(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.85));
  t.put(out, click(t.sr, r, 0.003, 1400, 14000), 0, t.g(1.0));
  t.put(out, burst(t, 0.05, 1800, t.c(11000), 0.0003, 0.006), 0, t.g(0.7));
  t.put(out, burst(t, 0.05, 250, 1800, 0.0005, 0.01), 0, t.g(0.4));
  scatter(out, t, r.int(3, 6), 0.008, 0.1, 1800, 8000, 0.15);
  const n = t.n(t.L(r.range(0.5, 0.68)));
  const f0 = r.range(2400, 3600) * t.p;
  const end = r.range(0.28, 0.4);
  const tumble = r.range(22, 40);
  const fm = r.range(0.015, 0.03);
  const am = r.range(0.2, 0.4);
  const freq = new Float32Array(n);
  const level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const spin = Math.sin((2 * Math.PI * tumble * i) / t.sr);
    freq[i] = f0 * Math.pow(end, Math.pow(u, 0.75)) * (1 + fm * spin);
    level[i] = (Math.min(1, u * 30) / (1 + 4 * u)) * (1 - am + am * (0.5 + 0.5 * spin)) * (u < 0.9 ? 1 : (1 - u) / 0.1);
  }
  const whine = tone(t, freq, level, 0.18, 0);
  const air = breathOn(t, freq, level, 26);
  for (let i = 0; i < n; i++) whine[i] = 0.6 * whine[i]! + 0.5 * air[i]!;
  lowpass(whine, t.sr, t.c(7000), 2);
  t.put(out, whine, t.j(0.01, 0.3), t.g(0.6));
  return out;
}
