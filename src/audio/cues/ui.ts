/**
 * The interface: soft, short, round. These are the only sounds heard outside
 * a game (menus, the aim check), so they are quiet, have no noise in them to
 * speak of, and never compete with the world: small wooden and glassy bars,
 * struck gently.
 */
import { midiHz } from "../dsp/curves";
import { type Mono, fade } from "../dsp/signal";
import { addMode, click } from "../dsp/sources";
import type { Take } from "../dsp/take";

/** How long a soft mallet takes to press into the bar: long enough that the onset is not a click. */
const PRESS = 0.0015;

/**
 * One soft strike: partials (ratio, level, decay) of a bar at ``freq``, each
 * starting from zero, with a millisecond and a half of attack. A sine that
 * starts at full swing is a step in its slope, which is a click; a mallet
 * never hits that hard, and an interface never should.
 */
function strike(out: Mono, t: Take, at: number, freq: number, partials: [number, number, number][]): void {
  const longest = Math.max(...partials.map((p) => p[2]));
  const note = t.canvas(longest * 7 + PRESS);
  for (const [ratio, level, tau] of partials) addMode(note, t.sr, 0, freq * ratio, level, tau, 0);
  fade(note, t.sr, PRESS, 0.01);
  t.put(out, note, at, 1);
}

/**
 * A tuned bar (a marimba's 1 : 3.93 : 9.2), struck softly. Each take strikes
 * it a little differently — a few cents off, its overtones a little louder
 * or softer and swinging the other way — so a menu tapped ten times does
 * not sound like one sample ten times.
 */
function bar(out: Mono, t: Take, at: number, midi: number, gain: number, tau: number): void {
  const r = t.rng;
  const f = midiHz(midi) * Math.pow(2, r.range(-4, 4) / 1200);
  strike(out, t, at, f, [
    [1, gain, tau],
    [3.93, t.g(gain * 0.18, 3) * r.sign(), tau * 0.25],
    [9.2, t.g(gain * 0.04, 3) * r.sign(), tau * 0.08],
  ]);
}

/** A tap: a small rounded tick, barely pitched. */
export function uiTap(t: Take): Mono {
  const out = t.canvas(0.09);
  const f = 1760 * t.p;
  strike(out, t, 0, f, [[1, 0.6, t.d(0.009)], [0.5, 0.35, t.d(0.014)]]);
  t.put(out, click(t.sr, t.rng, 0.0012, 1500, 7000), 0, 0.06);
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
  strike(out, t, 0, f, [
    [1, 0.6, t.d(0.12)],
    [2.76, t.g(0.18, 3) * r.sign(), t.d(0.04)],
    [r.range(1.002, 1.005), t.g(0.3, 2), t.d(0.1)],
  ]);
  t.put(out, click(t.sr, t.rng, 0.0015, 2500, 12000), 0, 0.05);
  return out;
}

/** The aim check is done: a quick G major arpeggio up to the octave, the last note left to ring. */
export function calibDone(t: Take): Mono {
  const out = t.canvas(1.3);
  [79, 83, 86].forEach((midi, k) => bar(out, t, k * t.j(0.075, 0.08), midi, 0.55, t.d(0.14)));
  bar(out, t, 3 * 0.078, 91, 0.7, t.d(0.45));
  return out;
}

/**
 * Gold: the oldest secret there is (a game's Konami unlock). Three bars
 * rising through D major, quicker and higher than the aim check's
 * arpeggio, the last one glassy and left to shimmer: a beating pair of
 * partials, as a struck glass has, so it glints rather than rings.
 */
export function uiGold(t: Take): Mono {
  const out = t.canvas(0.5);
  const r = t.rng;
  bar(out, t, 0, 86, 0.5, t.d(0.08));
  bar(out, t, t.j(0.065, 0.06), 90, 0.55, t.d(0.09));
  const f = midiHz(93) * Math.pow(2, r.range(-4, 4) / 1200);
  strike(out, t, 0.13, f, [
    [1, 0.6, t.d(0.2)],
    [r.range(1.003, 1.006), t.g(0.3, 2), t.d(0.17)],
    [2.76, t.g(0.14, 3) * r.sign(), t.d(0.05)],
    [3.93, t.g(0.07, 3) * r.sign(), t.d(0.03)],
  ]);
  return out;
}
