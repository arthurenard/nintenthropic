/**
 * The sounds a Grip Prix kart makes while it moves. The recipes now live in
 * ./kart-engines.ts (four engines in three rev bands each, their rasp, idle,
 * growl, the overrun crackle and the gear change's bark) and ./kart-ground.ts
 * (the tyres, the drift's squeal and sparks, every surface, the wind and the
 * slipstream, a scrape along a barrier, the suspension's creak and a rival
 * rushing past); this file re-exports them and keeps the two sounds of the
 * air that are not a kart's own: a homing puck's whistle and the rescue
 * drone's rotors. All of them are loops (but the one-shots), steered at run
 * time, so each is built to be heard stretched.
 */
import { lowpass } from "../dsp/filters";
import { type Mono, normalize } from "../dsp/signal";
import { bandNoise } from "../dsp/sources";
import type { Take } from "../dsp/take";
import { TAU, circular, cyclic, noiseLoop, times, tone } from "./kart-kit";

export * from "./kart-engines";
export * from "./kart-ground";

/** One component of a periodic sound: ``cycles`` whole cycles in the loop. */
interface Part {
  cycles: number;
  amp: number;
  /** Phase in radians (0 gives a cosine: aligned peaks, a pulse train). */
  phase: number;
}

/** Sum of sinusoids by rotating phasors: four multiplies a sample each, no sin() in the loop. */
function sumParts(n: number, parts: Part[]): Mono {
  const out = new Float32Array(n);
  for (const p of parts) {
    if (p.amp === 0) continue;
    const w = (TAU * p.cycles) / n;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let re = Math.cos(p.phase);
    let im = Math.sin(p.phase);
    for (let i = 0; i < n; i++) {
      out[i]! += p.amp * re;
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
    }
  }
  return out;
}

// --- the air ---------------------------------------------------------------------------------------------------

/** A homing puck's whistle: a clear tone wavering about, rising to a bright overtone. */
export function seekerWhistle(t: Take): Mono {
  const seconds = 0.8;
  const n = t.n(seconds);
  const r = t.rng;
  const base = Math.round(1380 * t.p * seconds);
  const wave = sumParts(n, [{ cycles: 6, amp: 1, phase: r.range(0, TAU) }]);
  const slow = sumParts(n, [{ cycles: 2, amp: 1, phase: r.range(0, TAU) }]);
  const freq = new Float32Array(n);
  for (let i = 0; i < n; i++) freq[i] = (base / seconds) * (1 + 0.045 * wave[i]! + 0.02 * slow[i]!);
  const whistle = tone(n, t.sr, freq, 0.22, 0.06);
  times(whistle, cyclic(n, 6, 0.25, r.range(0, TAU)));
  const air = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 2500, 6500, 2));
  for (let i = 0; i < n; i++) whistle[i] = whistle[i]! + 0.1 * air[i]!;
  return whistle;
}

/** The rescue drone's rotors: a throbbing blade-pass buzz, a motor whine and the wash of air. */
export function droneRotors(t: Take): Mono {
  const seconds = 1.0;
  const n = t.n(seconds);
  const r = t.rng;
  const blades = Math.round(78 * t.p * seconds);
  const parts: Part[] = [];
  for (let k = 1; k <= 22; k++) parts.push({ cycles: blades * k, amp: 1 / (k ** 1.1), phase: r.range(0, TAU) });
  const buzz = normalize(sumParts(n, parts));
  // Four rotors a little out of step beat against each other.
  const beat = cyclic(n, 3, 0.45, r.range(0, TAU));
  times(buzz, beat);
  const whineBase = Math.round(690 * t.p * seconds);
  const whineWob = sumParts(n, [{ cycles: 4, amp: 1, phase: r.range(0, TAU) }]);
  const wf = new Float32Array(n);
  for (let i = 0; i < n; i++) wf[i] = (whineBase / seconds) * (1 + 0.02 * whineWob[i]!);
  const whine = tone(n, t.sr, wf, 0.3, 0.1);
  const wash = noiseLoop(t, seconds, (m) => bandNoise(m, t.sr, r, 700, 3200, 2));
  const puff = new Float32Array(n);
  for (let i = 0; i < n; i++) puff[i] = 0.55 + 0.45 * Math.cos((TAU * blades * i) / n);
  times(wash, puff);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buzz[i]! * 0.9 + whine[i]! * 0.28 + wash[i]! * 0.4;
  circular(out, (twice) => lowpass(twice, t.sr, 5200, 2));
  return out;
}
