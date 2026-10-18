/**
 * The player: clawed, and the death, heard from inside.
 */
import { lerp } from "../../dsp/curves";
import { lowpass } from "../../dsp/filters";
import { type Mono, adsr, shapeBy } from "../../dsp/signal";
import { addMode, bandNoise, click } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { burst, creak, lubDub, thump } from "../kit";
import { vocal } from "./layers";

/**
 * Clawed: a muffled blow through the body and the slap of the jacket, three
 * nails raking across the cloth side by side (a fast coarse tear), and a
 * sharp breath in — no voice, no word.
 */
export function nightHurt(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.8));
  t.put(out, thump(t, 0.35, 92 * t.p, 38 * t.p, 0.002, t.d(0.08), 0.5), 0, t.g(1.0));
  t.put(out, burst(t, 0.3, 35, 260, 0.002, t.d(0.06), 4), 0, t.g(0.85));
  t.put(out, burst(t, 0.05, 450, 2600, 0.0005, 0.008), 0, t.g(0.45));
  const len = t.j(0.15, 0.2);
  for (let k = 0; k < 3; k++) {
    const speed = r.range(0.85, 1.15);
    const rake = creak(t, len, (u) => (380 + 350 * Math.sin(Math.PI * u)) * speed, [[1400, 1.3, 1], [3300, 1.6, 0.8], [6800, 2, 0.4]], 0.9);
    adsr(rake, t.sr, len * 0.1, len * 0.3, 0.6, len * 0.35);
    t.put(out, rake, 0.005 + k * r.range(0.004, 0.012), t.g(0.4));
  }
  const gasp = vocal(t, t.j(0.2, 0.15), {
    f0: () => 140,
    voicing: () => 0,
    tract: [
      { f: (u) => lerp(420, 720, u), q: 5, amp: 1 },
      { f: (u) => lerp(1500, 1850, u), q: 7, amp: 0.6 },
      { f: () => 2700, q: 9, amp: 0.25 },
    ],
    level: (u) => Math.pow(Math.min(1, u / 0.7), 1.5) * (u < 0.85 ? 1 : (1 - u) / 0.15),
  });
  t.put(out, gasp, t.j(0.24, 0.15), t.g(0.5));
  return out;
}

/**
 * The player's death, heard from inside and muffled: the knees going and
 * the body slumping onto the asphalt; the flashlight out of your hands — a
 * bright aluminium clank, two bounces, then rolling on the road (its clip
 * ticking once a turn, slower and slower) until it stops; two last
 * heartbeats, the second later and weaker; a pressure in the ears; and the
 * ears ringing as the night goes away.
 */
export function nightDeath(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(3.5);
  const body = t.canvas(3.5);
  t.put(body, burst(t, 0.3, 35, 300, 0.003, 0.05, 4), 0.12, 0.6);
  t.put(body, thump(t, 0.3, 95 * t.p, 45 * t.p, 0.003, 0.05, 0.5), 0.12, 0.45);
  t.put(body, thump(t, 0.5, 85 * t.p, 33 * t.p, 0.003, 0.12, 0.5), 0.42, 1.0);
  t.put(body, burst(t, 0.45, 30, 360, 0.003, 0.09, 4), 0.42, 0.9);
  t.put(body, burst(t, 0.2, 35, 280, 0.003, 0.04, 4), 0.58, 0.4);
  t.put(body, lubDub(t, 0.3, 1, 68, 88), 1.0, 0.9);
  t.put(body, lubDub(t, 0.36, 1, 68, 88), 2.25, 0.55);
  const swell = t.canvas(3.2);
  for (const [f, a] of [[55, 1], [82.4, 0.6], [110, 0.25]] as const) addMode(swell, t.sr, 0, f * t.p, a, 1000, r.range(0, 6));
  adsr(swell, t.sr, 0.6, 0.8, 0.6, 1.5);
  t.put(body, swell, 0.2, 0.2);
  lowpass(body, t.sr, 1000, 2);
  t.put(out, body, 0, 1);
  // The flashlight: an aluminium tube (a free bar's partials) bouncing, then rolling.
  const torch = t.canvas(3.3);
  const f = r.range(1150, 1500);
  let at = r.range(0.3, 0.36);
  let g = 1;
  let gap = r.range(0.11, 0.15);
  for (let k = 0; k < 3; k++) {
    t.put(torch, click(t.sr, r, 0.002, 1500, 12000), at, g * 0.6);
    addMode(torch, t.sr, at, f * r.range(0.99, 1.01), g * 0.6, 0.05, 0);
    addMode(torch, t.sr, at, f * 2.756, g * 0.35, 0.025, 0);
    addMode(torch, t.sr, at, f * 5.404, g * 0.15, 0.012, 0);
    t.put(torch, burst(t, 0.03, 200, 1500, 0.0005, 0.006), at, g * 0.3);
    at += gap;
    gap *= 0.6;
    g *= 0.5;
  }
  const rollLen = r.range(1.4, 1.9);
  const n = t.n(rollLen);
  const roll = bandNoise(n, t.sr, r, 700, 4200, 2);
  const rev0 = r.range(3.5, 5);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const rate = rev0 * Math.pow(1 - u, 1.3) + 0.05;
    const before = ph;
    ph += rate / t.sr;
    const bump = 0.5 + 0.5 * Math.cos(2 * Math.PI * ph);
    roll[i]! *= (0.4 + 0.6 * bump * bump) * Math.pow(1 - u, 1.2) * Math.min(1, u * 30);
    // The pocket clip meets the road once a turn.
    if (Math.floor(before) !== Math.floor(ph)) {
      addMode(torch, t.sr, at + i / t.sr, r.range(2500, 3100), 0.2 * Math.pow(1 - u, 0.8), 0.006, 0);
    }
  }
  t.put(torch, roll, at, 0.12);
  lowpass(torch, t.sr, 3800, 2);
  t.put(out, torch, 0, 0.5);
  const ring = t.canvas(3.2);
  const tinnitus = r.range(3300, 4000);
  addMode(ring, t.sr, 0, tinnitus, 1, 1000, 0);
  addMode(ring, t.sr, 0, tinnitus + 2.5, 0.6, 1000, 0);
  shapeBy(ring, (u) => Math.min(1, u * 5) ** 2 * Math.pow(1 - u, 1.5));
  t.put(out, ring, 0.15, 0.03);
  return out;
}
