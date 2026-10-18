/**
 * The player's lever-action rifle, from behind the stock: the shot, the
 * lever worked after it, a dry fire and a round thumbed into the gate; and
 * the flashlight's switch.
 */
import { highpass, lowpass, svf } from "../../dsp/filters";
import { type Mono, adsr, normalize, wobble } from "../../dsp/signal";
import { addMetal, addMode, bandNoise, brown, click, decayInPlace, pink, white } from "../../dsp/sources";
import type { Take } from "../../dsp/take";
import { burst, knock, nWave, saturate, thump } from "../kit";
import { brassCase, clack, slide } from "./layers";

/**
 * The player's lever-action, from behind the stock: a harder, brighter
 * crack than a revolver (the edge, a click and a high band of noise driven
 * into saturation), a deep boom and a sub, then what open country does to a
 * shot in fog — no walls to slap back, only the ground and the damp air
 * carrying it away: a long low roll that darkens as it goes and churns as it
 * rolls, and a faint late return off the tree line half a second later.
 */
export function nightRifle(t: Take): Mono {
  const r = t.rng;
  const seconds = t.L(2.7);
  const out = t.canvas(seconds);
  const head = t.canvas(0.3);
  t.put(head, nWave(t, t.j(0.0005, 0.2)), 0, t.g(1.0));
  t.put(head, click(t.sr, r, 0.003, 1600, t.c(16000)), 0, t.g(1.15));
  // The round is supersonic: its own crack rides the blast, a few
  // milliseconds of the brightest noise, which a revolver does not have.
  t.put(head, burst(t, 0.03, 2500, 16000, 0.0001, t.d(0.004), 2, 2), 0, t.g(0.8));
  t.put(head, burst(t, 0.12, 750 * t.p, t.c(14000), 0.0002, t.d(0.016), 2, 1.5), 0, t.g(1.3));
  t.put(head, burst(t, 0.2, 320 * t.p, t.c(2600), 0.0008, t.d(0.038), 2), 0.001, t.g(0.6));
  saturate(head, 2.6);
  t.put(out, head, 0, 1);
  // The boom stays clean: saturating a low sine only squares it into mud.
  t.put(out, thump(t, 0.3, 175 * t.p, 48 * t.p, 0.0015, t.d(0.07), 0.45), 0.001, t.g(0.5));
  t.put(out, thump(t, 0.5, 54 * t.p, 33 * t.p, 0.004, t.d(0.12), 0.6), 0.003, t.g(0.3));
  t.put(out, burst(t, 0.3, 40, 300 * t.p, 0.002, t.d(0.07), 4), 0.001, t.g(0.4));
  // The roll across the fields: fog swallows the top first, so the low-pass
  // falls from ~1.5 kHz to ~400 Hz as it goes; it churns (the ground wave
  // and the air's eddies) and swells once or twice as it rolls away.
  const n = t.n(seconds - 0.01);
  const roll = pink(n, r);
  const top = t.c(1500);
  svf(roll, t.sr, "lp", (u) => top * Math.pow(0.28, Math.pow(u, 0.7)), 0.7, 64);
  highpass(roll, t.sr, 55, 2);
  normalize(roll);
  const churn = wobble(n, t.sr, r.range(5, 8), () => r.next());
  const swell = wobble(n, t.sr, r.range(1.2, 2), () => r.next());
  for (let i = 0; i < n; i++) roll[i]! *= (0.72 + 0.28 * churn[i]!) * (0.85 + 0.15 * swell[i]!);
  adsr(roll, t.sr, 0.035, 0.12, 0.75, 0.5);
  decayInPlace(roll, t.sr, 0, t.d(0.6));
  t.put(out, roll, 0.008, t.g(0.55));
  // The tree line: the blast come back, dark and soft, with a little roll of its own.
  const back = t.j(0.55, 0.25);
  t.put(out, burst(t, 0.35, 180, t.c(1300), 0.004, t.d(0.05), 2), back, t.g(0.16));
  const far = brown(t.n(0.9), r);
  lowpass(far, t.sr, 700, 2);
  highpass(far, t.sr, 60, 2);
  normalize(far);
  adsr(far, t.sr, 0.03, 0.1, 0.6, 0.4);
  decayInPlace(far, t.sr, 0, t.d(0.25));
  t.put(out, far, back + 0.01, t.g(0.1));
  return out;
}

/**
 * The lever worked after a shot. Down: the lever unlocks with a tick, the
 * bolt slides back, a steel clack at the bottom of the stroke, and the spent
 * case flicked out with a tick off the ejector. Up: the bolt runs forward and
 * chambers the round with a solid clack, the lever slapping home against the
 * tang. The case lands on the asphalt a moment later, ringing faintly.
 */
export function nightLever(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.72));
  t.put(out, click(t.sr, r, 0.002, 2500, 12000), 0.008, t.g(0.3));
  t.put(out, slide(t, t.j(0.05, 0.2), 2200, 3600), 0.012, t.g(0.3));
  const down = 0.012 + t.j(0.06, 0.15);
  clack(out, t, down, r.range(1900, 2300) * t.p, 0.85, 0.7);
  addMode(out, t.sr, down + 0.004, r.range(4200, 5000) * t.p, 0.06, 0.02, 0);
  const up = down + t.j(0.13, 0.2);
  t.put(out, slide(t, 0.045, 3000, 1900), up - 0.045, t.g(0.25));
  clack(out, t, up, r.range(1450, 1750) * t.p, 1.0, 1.0);
  t.put(out, click(t.sr, r, 0.002, 1200, 9000), up + t.j(0.012, 0.3), t.g(0.35));
  brassCase(out, t, down + t.j(0.32, 0.15), 0.12);
  return out;
}

/**
 * The hammer falling on an empty chamber: the sear's small tick, then the
 * hammer's snap on the firing pin a few milliseconds later — a bright steel
 * strike, the pin's thin ring, and the walnut stock's dull knock under it.
 * Small, dry, final.
 */
export function nightDry(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(0.26);
  t.put(out, click(t.sr, r, 0.0015, 2800, 12000), 0.004, t.g(0.22));
  const at = 0.004 + t.j(0.011, 0.3);
  t.put(out, click(t.sr, r, 0.004, 1400, t.c(14000)), at, t.g(1.0));
  const snap = bandNoise(t.n(0.02), t.sr, r, 1200, t.c(9000), 2);
  svf(snap, t.sr, "bp", 2300 * t.p, 2.6);
  normalize(snap);
  decayInPlace(snap, t.sr, 0.0002, 0.004);
  t.put(out, snap, at, t.g(0.85));
  addMetal(out, t.sr, r, at, 2150 * t.p, t.d(0.012), 0.4, [1, 1.61, 2.47, 3.3]);
  addMode(out, t.sr, at, 6100 * t.p, 0.05, t.d(0.02), 0);
  t.put(out, knock(t, r.range(300, 380) * t.p, 0.012, 1), at, t.g(0.35));
  return out;
}

/**
 * One cartridge thumbed into the loading gate: the bullet's nose pushing the
 * spring-loaded gate in (a short brassy slide), the gate snapping shut
 * behind the rim, the brass's own small ring, and the round shoving the
 * magazine column back against its spring (a soft thud, a thin ring). Heard
 * up to eight times in a row, so every take draws its own timing and pitches.
 */
export function nightRoundIn(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.17));
  const push = t.j(0.03, 0.3);
  const lift = r.range(1500, 2200);
  const nose = white(t.n(push), r);
  svf(nose, t.sr, "bp", (u) => (3000 + lift * u) * t.p, 4, 16);
  normalize(nose);
  adsr(nose, t.sr, push * 0.5, push * 0.3, 0.7, push * 0.2);
  t.put(out, nose, 0.004, t.g(0.22));
  const at = 0.004 + push;
  t.put(out, click(t.sr, r, 0.0025, 1800, t.c(13000)), at, t.g(0.9));
  addMetal(out, t.sr, r, at, r.range(2900, 3600) * t.p, t.d(0.008), 0.35, [1, 1.47, 2.2]);
  const brass = r.range(5200, 6800) * t.p;
  addMode(out, t.sr, at, brass, 0.08, t.d(0.018), 0);
  addMode(out, t.sr, at, brass * 1.51, 0.04, t.d(0.01), 0);
  t.put(out, burst(t, 0.03, 180, 1500, 0.001, 0.006, 2), at + 0.002, t.g(0.4));
  const spring = r.range(1900, 2600) * t.p;
  addMode(out, t.sr, at + 0.003, spring, 0.05, t.d(0.03), 0);
  addMode(out, t.sr, at + 0.003, spring * 1.013, 0.04, t.d(0.025), 0);
  addMode(out, t.sr, at + 0.003, spring * 2.9, 0.02, t.d(0.012), 0);
  return out;
}

/**
 * The flashlight's tail switch clicking on: the thumb squashing the rubber
 * boot, the metal dome snapping under it (a click the rubber dulls), and the
 * plastic cap's brief ring.
 */
export function nightClick(t: Take): Mono {
  const r = t.rng;
  const out = t.canvas(t.L(0.09));
  t.put(out, burst(t, 0.03, 300, 1800, 0.008, 0.006, 2), 0.002, t.g(0.15));
  const at = t.j(0.014, 0.25);
  t.put(out, click(t.sr, r, 0.0025, 1200, t.c(6500)), at, t.g(1.0));
  addMode(out, t.sr, at, r.range(1300, 1700) * t.p, 0.35, t.d(0.004), 0);
  addMode(out, t.sr, at, r.range(2800, 3400) * t.p, 0.2, t.d(0.0025), 0);
  addMode(out, t.sr, at, r.range(4600, 5400) * t.p, 0.1, 0.0015, 0);
  return out;
}
