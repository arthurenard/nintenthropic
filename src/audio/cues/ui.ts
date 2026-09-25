/**
 * The interface: soft, short, round. These are the only sounds heard outside
 * a game (menus, the aim check), so they are quiet, have no noise in them to
 * speak of, and never compete with the world: small wooden and glassy bars,
 * struck gently.
 */
import type { Mono } from "../dsp/signal";
import { addMode, click } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { midiHz } from "./music";

/**
 * A tuned bar (a marimba's 1 : 3.93 : 9.2), struck softly. Each take strikes
 * it a little differently — a few cents off, its overtones a little louder
 * or softer, caught at another point of their cycle — so a menu tapped ten
 * times does not sound like one sample ten times.
 */
function bar(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const r = t.rng;
  const f = midiHz(midi) * Math.pow(2, r.range(-4, 4) / 1200);
  addMode(out, t.sr, at, f, gain, tau, r.range(-0.4, 0.4));
  addMode(out, t.sr, at, f * 3.93, t.g(gain * 0.18, 3), tau * 0.25, r.range(0, 6.28));
  addMode(out, t.sr, at, f * 9.2, t.g(gain * 0.04, 3), tau * 0.08, r.range(0, 6.28));
}

/** A tap: a small rounded tick, barely pitched. */
export function uiTap(t: Take): Mono {
  const out = t.canvas(0.09);
  const f = 1760 * t.p;
  addMode(out, t.sr, 0, f, 0.6, t.d(0.009), 0);
  addMode(out, t.sr, 0, f / 2, 0.35, t.d(0.014), 0);
  t.put(out, click(t.sr, t.rng, 0.0012, 1500, 7000), 0, 0.12);
  return out;
}

/** Confirm: two soft bars rising a fifth. */
export function uiConfirm(t: Take): Mono {
  const out = t.canvas(0.45);
  bar(out, t, 0, 84, 0.7, t.d(0.12));
  bar(out, t, 0.075, 91, 0.6, t.d(0.14));
  return out;
}

/** An aim-check shot registered: a glassy *ting* over the bottle breaking. Exact pitch, so a game may step it up by rate. */
export function calibHit(t: Take): Mono {
  const out = t.canvas(0.4);
  const r = t.rng;
  const f = midiHz(88) * Math.pow(2, r.range(-4, 4) / 1200);
  addMode(out, t.sr, 0, f, 0.6, t.d(0.12), r.range(-0.4, 0.4));
  addMode(out, t.sr, 0, f * 2.76, t.g(0.18, 3), t.d(0.04), r.range(0, 6.28));
  addMode(out, t.sr, 0, f * r.range(1.002, 1.005), t.g(0.3, 2), t.d(0.1), r.range(0, 6.28));
  t.put(out, click(t.sr, t.rng, 0.0015, 2500, 12000), 0, 0.1);
  return out;
}

/** The aim check is done: a quick G major arpeggio up to the octave, the last note left to ring. */
export function calibDone(t: Take): Mono {
  const out = t.canvas(1.3);
  [79, 83, 86].forEach((midi, k) => bar(out, t, k * t.j(0.075, 0.08), midi, 0.55, t.d(0.14)));
  bar(out, t, 3 * 0.078, 91, 0.7, t.d(0.45));
  return out;
}
