/**
 * Danger: a round cracking past, the counter-sniper and a machine gun across
 * the valley, a mortar's launch, its whistle and its blast, the player hit,
 * the scope cracking as the player falls, and the death.
 */
import { sampled, smooth } from "../../dsp/curves";
import { lowpass, svf } from "../../dsp/filters";
import { type Mono, adsr, normalize, perc, shapeBy, wobble } from "../../dsp/signal";
import { addMode, bandNoise, click, decayInPlace, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { addShard, burst, flicker, knock, nWave, saturate, scatter, thump } from "../kit";
import { addPebble, breathNoise, rustle, tone, valleyRoll, valleySlap } from "./layers";

/**
 * A round passing a metre from the head: the shock wave's N-wave, a third
 * of a millisecond, rising instantly — a whip crack right at the ear — its
 * bounce off the ground a couple of milliseconds behind (the player is
 * lying on it), and the air torn behind the round, a hiss falling away.
 */
export function ridgeCrackNear(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.48));
  const snap = t.canvas(0.02);
  t.put(snap, nWave(t, t.j(0.00035, 0.2)), 0, 1);
  t.put(snap, click(t.sr, r, 0.0015, 2500, 18000), 0, t.g(0.7));
  saturate(snap, 2);
  t.put(out, snap, 0.002, t.g(1.0));
  t.put(out, nWave(t, t.j(0.0004, 0.2)), 0.002 + t.j(0.0022, 0.4), t.g(0.5));
  t.put(out, burst(t, 0.02, 3000, 16000, 0.0001, 0.003), 0.002, t.g(0.5));
  t.put(out, burst(t, 0.05, 60, 500, 0.0005, 0.008, 2), 0.002, t.g(0.3));
  const len = t.L(0.36);
  const tear = white(t.n(len), r);
  const hi = t.c(6000);
  const lo = hi * r.range(0.22, 0.3);
  svf(tear, t.sr, "bp", (u) => lo + (hi - lo) * Math.pow(1 - u, 2), 1.8);
  normalize(tear);
  shapeBy(tear, (u) => Math.min(1, u * 60) * Math.exp(-u * 6));
  t.put(out, tear, 0.003, t.g(0.5));
  return out;
}

/**
 * A rifle fired from across the valley — the counter-sniper. At its source
 * a report like the player's own, less sharp (the engine's distance takes
 * the rest of the crack), and the valley rolling it on for seconds after.
 */
export function ridgeFarShot(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(3.0);
  const out = t.canvas(seconds);
  const head = t.canvas(0.3);
  t.put(head, nWave(t, t.j(0.0005, 0.2)), 0, t.g(0.6));
  t.put(head, burst(t, 0.2, 300 * t.p, t.c(6000), 0.0004, t.d(0.02), 2, -1), 0, t.g(1.0));
  t.put(head, burst(t, 0.25, 400, 2400, 0.001, t.d(0.04), 2), 0.001, t.g(0.8));
  saturate(head, 2);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 0.45, 120 * t.p, 40 * t.p, 0.002, t.d(0.09), 0.5), 0.001, t.g(0.55));
  t.put(out, burst(t, 0.5, 35, 260, 0.002, t.d(0.1), 4), 0.001, t.g(0.6));
  t.put(out, valleyRoll(t, r, seconds - 0.04, 0.35, t.d(0.8)), 0.04, t.g(0.6));
  for (const at of [t.j(0.5, 0.2), t.j(1.05, 0.15)]) t.put(out, valleySlap(t, t.c(1500)), at, t.g(0.2));
  return out;
}

/**
 * A machine gun far off: a burst of six to nine reports at about twelve a
 * second, each a little different in level and timing (the gunner's hold,
 * the belt), running together under a roll of the valley that builds
 * through the burst and outlasts it.
 */
export function ridgeMgBurst(t: Take): Mono {
  const r = t.rng;
  const shots = r.int(6, 10);
  const rate = r.range(11, 13.5);
  const span = shots / rate;
  const out = t.canvas(span + t.L(1.2));
  for (let k = 0; k < shots; k++) {
    const at = 0.005 + k / rate + r.range(-0.004, 0.004);
    const g = r.range(0.75, 1) * (k === 0 ? 1.1 : 1);
    const report = t.canvas(0.25);
    t.put(report, nWave(t, 0.0004), 0, 0.4 * g);
    t.put(report, burst(t, 0.12, 280 * t.p * r.range(0.9, 1.1), t.c(5000), 0.0003, t.d(0.018), 2), 0, g);
    t.put(report, burst(t, 0.15, 400, 2000, 0.001, 0.035), 0.001, 0.5 * g);
    saturate(report, 1.8);
    t.put(report, thump(t, 0.2, 130 * t.p, 50 * t.p, 0.001, t.d(0.04), 0.5), 0.001, 0.45 * g);
    t.put(out, report, at, 1);
  }
  const rollLen = span + t.L(1.1);
  t.put(out, valleyRoll(t, r, rollLen, span * 0.8, t.d(0.45)), 0.02, t.g(0.45));
  return out;
}

/**
 * A tube open at one end, ringing: a feedback comb with inverted feedback
 * (a round trip of half a period), so it rings on the odd harmonics as a
 * closed pipe does, with a little low-pass in the loop so the ring darkens
 * as it dies.
 */
function tube(buf: Mono, sr: number, freq: number, feedback: number): Mono {
  const d = Math.max(2, Math.round(sr / (2 * freq)));
  const line = new Float32Array(d);
  let idx = 0;
  let lp = 0;
  for (let i = 0; i < buf.length; i++) {
    lp = 0.55 * lp + 0.45 * line[idx]!;
    const y = buf[i]! - feedback * lp;
    line[idx] = y;
    idx = idx + 1 === d ? 0 : idx + 1;
    buf[i] = y;
  }
  return buf;
}

/**
 * A mortar firing, down in the valley: the bomb's charge going off at the
 * bottom of the barrel — the hollow *thoonk* of the tube as the gas leaves
 * it (a short pop through a ringing pipe) — and the valley answering, low.
 */
export function ridgeMortarLaunch(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(1.35));
  const pop = t.canvas(0.5);
  t.put(pop, burst(t, 0.3, 60, t.c(1800), 0.0015, t.d(0.03), 2), 0, 1);
  t.put(pop, thump(t, 0.35, 170 * t.p, 80 * t.p, 0.002, t.d(0.06), 0.4), 0, 0.9);
  tube(pop, t.sr, r.range(95, 125) * t.p, 0.82);
  normalize(pop);
  t.put(out, pop, 0.005, 1);
  t.put(out, burst(t, 0.4, 30, 200, 0.003, t.d(0.08), 4), 0.005, t.g(0.5));
  t.put(out, valleyRoll(t, r, t.L(1.2), 0.2, t.d(0.35), 320), 0.03, t.g(0.3));
  return out;
}

/**
 * An incoming shell: the whistle of air over its fins and fuse, its pitch
 * falling as it closes (the Doppler shift easing as it comes), louder and
 * louder — and then the famous gap: it thins out just before it lands,
 * which the game fills with the blast.
 */
export function ridgeMortarWhistle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(1.6);
  const n = t.n(seconds);
  const f0 = r.range(1500, 1900) * t.p;
  const f1 = f0 * r.range(0.42, 0.52);
  const wob = r.range(5, 8);
  const freq = sampled(n, (u) => f0 * Math.pow(f1 / f0, Math.pow(u, 1.25)) * (1 + 0.006 * Math.sin(2 * Math.PI * wob * u * seconds)), 8);
  const out = tone(n, t.sr, freq, 0.15, 0.04);
  const air = svf(white(n, r), t.sr, "bp", freq, 12);
  normalize(air);
  const rush = white(n, r);
  svf(rush, t.sr, "bp", (u) => 2400 - 1400 * u, 1.2, 32);
  normalize(rush);
  for (let i = 0; i < n; i++) out[i] = 0.7 * out[i]! + 0.35 * air[i]! + 0.12 * rush[i]!;
  shapeBy(out, (u) => (0.06 + 0.94 * u ** 2.2) * smooth(u * 10) * (u > 0.86 ? smooth((0.97 - u) / 0.11) : 1));
  return out;
}

/**
 * A mortar bomb a few tens of metres away: the blast front, a crack driven
 * into saturation, a heavy boom and a roar of turbulent air — then the
 * dirt it threw up coming down, soil in a crumbling shower and stones
 * knocking among it, thinning over two seconds as the valley rolls it away.
 */
export function ridgeMortarBlast(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(3.6);
  const out = t.canvas(seconds);
  const head = t.canvas(0.5);
  t.put(head, nWave(t, t.j(0.0014, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.006, 500, 14000), 0, t.g(0.9));
  t.put(head, burst(t, 0.4, 150, t.c(7000), 0.0005, t.d(0.04), 2, -1), 0, t.g(1.0));
  t.put(head, burst(t, 0.45, 300, t.c(2200), 0.003, t.d(0.09), 2), 0.002, t.g(0.7));
  saturate(head, 3.2);
  t.put(out, head, 0, 1);
  t.put(out, thump(t, 1.0, 80 * t.p, 28 * t.p, 0.004, t.d(0.2), 0.5), 0.002, t.g(0.75));
  t.put(out, burst(t, 1.2, 25, 200, 0.004, t.d(0.28), 4), 0.002, t.g(0.8));
  const roarN = t.n(1.6);
  const roar = bandNoise(roarN, t.sr, r, 90, t.c(1400), 2);
  const churn = wobble(roarN, t.sr, 18, () => r.next());
  for (let i = 0; i < roarN; i++) roar[i]! *= 0.6 + 0.4 * churn[i]!;
  adsr(roar, t.sr, 0.02, 0.2, 0.5, 0.8);
  decayInPlace(roar, t.sr, 0, t.d(0.45));
  t.put(out, roar, 0.01, t.g(0.5));
  t.put(out, valleyRoll(t, r, seconds - 0.05, 0.4, t.d(1.0)), 0.05, t.g(0.4));
  // The soil coming down: a crumbling shower, then clods, then stones.
  const soilLen = 2.3;
  const soil = flicker(t, soilLen, 500, t.c(4000), 300);
  shapeBy(soil, (u) => smooth(u * 5) * Math.pow(1 - u, 1.8));
  t.put(out, soil, 0.35, t.g(0.16));
  scatter(out, t, r.int(50, 70), 0.35, 2.6, 700, 5000, 0.12, 1.5);
  for (let k = 0, count = r.int(10, 16); k < count; k++) {
    const at = 0.45 + Math.pow(r.next(), 1.4) * 2.0;
    t.put(out, knock(t, r.range(500, 1100), 0.008, 0.6), at, r.range(0.04, 0.12));
    addPebble(out, t, at, r.range(0.04, 0.1));
  }
  return out;
}

/**
 * The player hit: no voice, just the body blow — a heavy thump felt in the
 * chest, the slap of it and a muffled crack of the round — and the breath
 * knocked out through the teeth, a sharp pained exhale that catches once.
 */
export function ridgeHurt(t: Take): Mono {
  const out = t.canvas(t.L(0.82));
  t.put(out, thump(t, 0.4, 95 * t.p, 36 * t.p, 0.002, t.d(0.09), 0.5), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 35, 260, 0.002, t.d(0.07), 4), 0, t.g(0.9));
  t.put(out, burst(t, 0.05, 500, 2800, 0.0005, 0.009), 0, t.g(0.55));
  const crack = nWave(t, 0.0004);
  lowpass(crack, t.sr, 2500, 2);
  t.put(out, crack, 0, t.g(0.5));
  const len = t.j(0.42, 0.15);
  const breath = breathNoise(t, len, [[850, 3, 1], [1500, 4, 0.8], [2700, 6, 0.55], [4300, 7, 0.35]], (u) =>
    smooth((u * len) / 0.012) * Math.pow(1 - u, 1.8) * (1 - 0.55 * Math.exp(-(((u - 0.22) / 0.06) ** 2))));
  t.put(out, breath, t.j(0.04, 0.3), t.g(0.6));
  t.put(out, thump(t, 0.2, 70 * t.p, 40 * t.p, 0.003, 0.05, 0.6), t.j(0.36, 0.1), t.g(0.3));
  return out;
}

/**
 * The scope's glass cracking as the player falls: one sharp, crystalline
 * crack (a small thick lens: high, clear partials, ringing a moment), then
 * the splinters — fractures running out from the first, each a tiny click
 * and pip, quick then thinning — and a chip settling inside the tube.
 */
export function ridgeScopeCrack(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.9));
  t.put(out, click(t.sr, r, 0.003, 3000, 18000), 0, t.g(1.2));
  t.put(out, nWave(t, 0.0002), 0, t.g(0.6));
  t.put(out, burst(t, 0.05, 3000, 16000, 0.0002, t.d(0.006), 2, 2), 0, t.g(0.9));
  for (const [f, a, tau] of [[4700, 0.25, 0.06], [6900, 0.18, 0.045], [9100, 0.12, 0.035], [11800, 0.08, 0.03]] as const) {
    addMode(out, t.sr, 0, f * t.p * r.range(0.97, 1.03), a, t.d(tau), 0);
  }
  const count = r.int(18, 28);
  let at = 0.006;
  for (let k = 0; k < count; k++) {
    at += (0.002 + 0.03 * Math.pow(k / count, 2)) * r.range(0.5, 1.5);
    const g = 0.4 * (1 - 0.6 * (k / count)) * r.range(0.5, 1);
    t.put(out, click(t.sr, r, r.range(0.0008, 0.002), 3000, 16000), at, g);
    addMode(out, t.sr, at, r.range(4000, 10000), g * 0.2 * r.sign(), r.range(0.004, 0.012), 0);
  }
  const crackle = flicker(t, 0.35, 2500, 12000, 500);
  perc(crackle, t.sr, 0.001, t.d(0.1));
  t.put(out, crackle, 0.004, t.g(0.3));
  addShard(out, t, at + r.range(0.08, 0.18), r.range(5000, 8000), 0.08, 0.02);
  return out;
}

/**
 * The fall: a last heavy breath out, long and shaking; the body settling
 * into the grass, a soft heavy thud and the blades crushed under it, an arm
 * after; and under it all a low drone — a fifth, sinking — as the world
 * recedes.
 */
export function ridgeDeath(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(3.4);
  const len = t.j(1.2, 0.1);
  const shake = r.range(4, 6.5);
  const exhale = breathNoise(t, len, [[600, 2.5, 1], [1150, 3, 0.6], [2400, 4, 0.25]], (u) =>
    smooth((u * len) / 0.06) * Math.pow(1 - u, 1.4) * (0.75 + 0.25 * Math.sin(2 * Math.PI * shake * u * len)));
  t.put(out, exhale, 0.02, 0.55);
  const fall = t.j(0.3, 0.2);
  t.put(out, burst(t, 0.4, 30, 240, 0.003, 0.09, 4), fall, 0.9);
  t.put(out, thump(t, 0.4, 82 * t.p, 34 * t.p, 0.003, 0.1, 0.5), fall, 0.7);
  t.put(out, rustle(t, 0.6, 900, 6500, 55), fall, 0.22);
  const arm = fall + t.j(0.42, 0.2);
  t.put(out, burst(t, 0.25, 35, 300, 0.003, 0.05, 4), arm, 0.4);
  t.put(out, rustle(t, 0.3, 1200, 7000, 70), arm, 0.12);
  const dn = t.n(3.1);
  const drone = new Float32Array(dn);
  for (const [ratio, amp] of [[1, 1], [1.5, 0.45], [2.01, 0.2]] as const) {
    const s = tone(dn, t.sr, sampled(dn, (u) => 58 * ratio * Math.pow(0.8, u)));
    for (let i = 0; i < dn; i++) drone[i]! += amp * s[i]!;
  }
  adsr(drone, t.sr, 0.9, 0.8, 0.7, 1.5);
  t.put(out, drone, 0.2, 0.3);
  return out;
}
