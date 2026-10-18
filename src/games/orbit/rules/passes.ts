/**
 * The pass table from docs/ORBITAL_DECAY.md, extended past pass 6 by its
 * rule "+4 each: faster, more at once, more slabs", and everything else that
 * tightens as the passes go on.
 *
 * | Pass | Debris            | New                                        |
 * | 1    | 10                | Shrapnel and chunks: learn the view        |
 * | 2    | 14                | Slabs                                      |
 * | 3    | 18                | Solar panel shards; the drone starts work  |
 * | 4    | 22                | Foil-wrapped pieces                        |
 * | 5    | The Derelict + 16 | Boss                                       |
 * | 6+   | +4 each           | Faster, more at once, more slabs           |
 */
import { DERELICT_EVERY, type Kind } from "./tuning";

export interface PassSpec {
  pass: number;
  /** Fragments sent this pass (not counting the pieces they split into, or the Derelict). */
  count: number;
  /** How many of each kind, in the order the director shuffles them. */
  mix: Partial<Record<Kind, number>>;
  derelict: boolean;
  /** Multiplies every fragment's speed (on top of the difficulty's). */
  speed: number;
  /** Fragments sent and still in flight at once (their pieces not counted). */
  maxActive: number;
  /** Seconds between one fragment and the next, the shortest and longest. */
  gap: readonly [number, number];
  /** The chance a fragment comes with another beside it, down a neighbouring lane. */
  cluster: number;
  /** Of what is sent, the share aimed at a pane; `frame` at the cupola's metal; the rest miss. */
  panes: number;
  frame: number;
  /** What the title card says under "Pass N". */
  subtitle: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function isDerelictPass(pass: number): boolean {
  return pass >= DERELICT_EVERY && pass % DERELICT_EVERY === 0;
}

/** 10, 14, 18, 22, then 26 from pass 6, +4 each; a Derelict's pass sends ten fewer. */
export function countFor(pass: number): number {
  const regular = pass <= 5 ? 6 + 4 * pass : 2 + 4 * pass;
  return isDerelictPass(pass) ? regular - 10 : regular;
}

/** The kinds a pass sends, as whole numbers adding up to its count. */
export function mixFor(pass: number, count: number): Partial<Record<Kind, number>> {
  // Shares by pass: slabs from 2, shards from 3, foil from 4, and past 5
  // the slabs grow at the shrapnel's expense.
  const later = Math.max(0, pass - 5);
  const share: Partial<Record<Kind, number>> =
    pass <= 1
      ? { shrapnel: 0.6, chunk: 0.4 }
      : pass === 2
        ? { shrapnel: 0.46, chunk: 0.36, slab: 0.18 }
        : pass === 3
          ? { shrapnel: 0.4, chunk: 0.3, slab: 0.14, shard: 0.16 }
          : {
              shrapnel: Math.max(0.2, 0.33 - 0.02 * later),
              chunk: 0.26,
              slab: Math.min(0.26, 0.13 + 0.02 * later),
              shard: 0.13,
              foil: 0.15,
            };
  const kinds = Object.keys(share) as Kind[];
  const total = kinds.reduce((s, k) => s + (share[k] ?? 0), 0);
  const out: Partial<Record<Kind, number>> = {};
  let given = 0;
  // Largest remainders: whole fragments, adding up exactly to the count.
  const rest: [Kind, number][] = [];
  for (const k of kinds) {
    const exact = ((share[k] ?? 0) / total) * count;
    const whole = Math.floor(exact);
    out[k] = whole;
    given += whole;
    rest.push([k, exact - whole]);
  }
  rest.sort((a, b) => b[1] - a[1]);
  for (let i = 0; given < count; i++, given++) {
    const k = (rest[i % rest.length] as [Kind, number])[0];
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Past the sixth, the plain passes' cards take turns, so the long run is not one line over and over. */
const LATER: readonly string[] = ["More debris.", "Still raining metal.", "The field has not thinned."];

function subtitleFor(pass: number): string {
  switch (pass) {
    case 1:
      return "Shoot the debris before it hits the glass.";
    case 2:
      return "Slabs. Split them far out.";
    case 3:
      return "Solar panel shards. Shoot them face-on.";
    case 4:
      return "Foil. The first hit strips it.";
    case 5:
      return "The Derelict. Hit its fuel tank.";
    case 6:
      return "Faster now.";
    default:
      return isDerelictPass(pass) ? "Another derelict." : (LATER[(pass - 7) % LATER.length] as string);
  }
}

export function passSpec(pass: number): PassSpec {
  const p = Math.max(1, Math.floor(pass));
  const count = countFor(p);
  return {
    pass: p,
    count,
    mix: mixFor(p, count),
    derelict: isDerelictPass(p),
    // Pass 1 is for learning the view; from the third the pressure builds a
    // pass at a time: faster, more at once, closer together.
    speed: p <= 2 ? 0.86 + 0.04 * p : clamp(0.95 + 0.05 * p, 1, 1.7),
    maxActive: p === 1 ? 2 : p === 2 ? 3 : Math.min(10, p),
    gap: p === 1 ? [2.4, 3.6] : p === 2 ? [1.7, 2.8] : [Math.max(0.45, 1.8 - 0.13 * p), Math.max(0.9, 3.0 - 0.2 * p)],
    cluster: p < 3 ? 0 : Math.min(0.5, 0.1 + 0.04 * p),
    panes: Math.min(0.85, 0.6 + 0.03 * p),
    frame: 0.08,
    subtitle: subtitleFor(p),
  };
}
