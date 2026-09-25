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

/** A tuned bar (a marimba's 1 : 3.93 : 9.2), struck softly. */
function bar(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const f = midiHz(midi);
  addMode(out, t.sr, at, f, gain, tau, 0);
  addMode(out, t.sr, at, f * 3.93, gain * 0.18, tau * 0.25, 0);
  addMode(out, t.sr, at, f * 9.2, gain * 0.04, tau * 0.08, 0);
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
  const f = midiHz(88);
  addMode(out, t.sr, 0, f, 0.6, t.d(0.12), 0);
  addMode(out, t.sr, 0, f * 2.76, 0.18, t.d(0.04), 0);
  addMode(out, t.sr, 0, f * 1.003, 0.3, t.d(0.1), 0);
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
