/**
 * The wave table from docs/DEAD_OF_NIGHT.md, extended past wave 6 by the
 * rule "+6 each: more runners, a bigger crowd at once, thicker fog, faster
 * walkers", and everything else that tightens as the night goes on.
 *
 * | Wave | Dead              | New                                           |
 * | 1    | 6 walkers         | The road only; learn the fog, at a gentle pace |
 * | 2    | 9                 | The cornfield lane; the first runner and crawler |
 * | 3    | 11                | The tree line; the surprises begin            |
 * | 4    | 14                | The first bloater                             |
 * | 5    | 17                | More of each                                  |
 * | 6    | The Mechanic + 20 | Boss                                          |
 * | 7+   | +6 each           | More runners, a bigger crowd at once, faster walkers |
 *
 * Waves 1 and 2 are gentle on purpose (the dead walk at 0.8 and 0.9 of the
 * pace of wave 3), so that a first wave can be learned, and the first three
 * open with a burst (OPENINGS): the first of the dead in view within a
 * second of the title card going, a few of them at once, from places already
 * hidden.
 */
import { MECHANIC_EVERY } from "./tuning";
import type { LaneId } from "./types";

export interface WaveSpec {
  wave: number;
  /** The dead, not counting the Mechanic. */
  dead: number;
  mechanic: boolean;
  /** Of the dead, how many are each kind; the rest are walkers. */
  runners: number;
  crawlers: number;
  bloaters: number;
  /** Of them, how many come by the surprises (the bus, the booth, the fence). */
  surprises: number;
  /** The lanes out of the fog this wave uses. */
  lanes: readonly LaneId[];
  /**
   * How the wave opens: the lanes its first dead come by, in order, all
   * together (a moment apart), from close in. Each starts where nothing
   * shows it appear - in the bus's door, in the corn (OPENING_REACH), past
   * the right of the view, behind the bus on the road, behind the phone
   * booth - so the road is not empty while the wave begins. Empty from
   * wave 4 on.
   */
  opening: readonly LaneId[];
  /** The dead in play at once (the rest wait their turn in the fog). */
  maxActive: number;
  /** Seconds between one coming into play and the next, drawn from this range. */
  gap: readonly [number, number];
  /** Every walker's pace is multiplied by this: gentle on waves 1 and 2, faster and faster walkers from wave 4. */
  pace: number;
  /**
   * The fog's density (an exponential-squared coefficient per metre) at the
   * wave's start: thicker with the waves. The world draws it; the rules use
   * it for how far the road can be read.
   */
  fog: number;
  /** Living survivors who run across the road during the wave. */
  survivors: number;
  /** What the title card says under "Wave N". */
  subtitle: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How each of the first waves opens (WaveSpec.opening): the burned bus's door
 * first, which is in view at once and climbing out, then the rest; always
 * walkers, taken from the front of the wave's own (its runners come as the
 * wave brings them). The phone booth is the closest of them, 22 m out: on
 * wave 1 it is the one that reaches the barricade first, a little over twenty
 * seconds in.
 */
const OPENINGS: Readonly<Record<number, readonly LaneId[]>> = {
  1: ["bus", "road", "booth"],
  2: ["bus", "corn", "road"],
  3: ["bus", "trees", "corn"],
};

export function isMechanicWave(wave: number): boolean {
  return wave >= MECHANIC_EVERY && wave % MECHANIC_EVERY === 0;
}

function deadFor(wave: number): number {
  const table = [6, 9, 11, 14, 17, 20];
  if (wave <= 6) return table[wave - 1] as number;
  // +6 each from wave 7; a Mechanic's wave keeps the count of the wave before.
  const regular = 20 + 6 * (wave - 6);
  return isMechanicWave(wave) ? regular - 6 : regular;
}

/** The fog thickens from wave to wave: about 80 m of road readable on wave 1, 45 m by wave 10. */
export function fogFor(wave: number): number {
  return clamp(0.0155 + 0.0014 * (wave - 1), 0.0155, 0.029);
}

/**
 * The night's own lines for a wave with nothing new in it, taken in turn
 * (High Noon's "They keep coming." is the west's).
 */
export const PLAIN_WAVE_LINES: readonly string[] = ["Keep the road clear.", "The road is never empty.", "More of them.", "The corn is moving again."];

function subtitleFor(wave: number): string {
  switch (wave) {
    case 1:
      return "Something is coming up the road.";
    case 2:
      return "Runners in the corn.";
    case 3:
      return "From the tree line, too.";
    case 4:
      return "Bloaters. Shoot them early.";
    case 5:
      return "More of them.";
    case 6:
      return "The Mechanic.";
    default:
      if (isMechanicWave(wave)) return "The Mechanic is back.";
      // Said only while it is true: the fog stops thickening at wave 11.
      if (wave % 2 === 1 && fogFor(wave) > fogFor(wave - 1)) return "The fog is getting thicker.";
      return PLAIN_WAVE_LINES[wave % PLAIN_WAVE_LINES.length] as string;
  }
}

export function waveSpec(wave: number): WaveSpec {
  const w = Math.max(1, Math.floor(wave));
  const dead = deadFor(w);
  const mechanic = isMechanicWave(w);
  const runners = w < 2 ? 0 : w <= 6 ? w - 1 : Math.min(14, Math.floor(5 + 1.5 * (w - 6)));
  const crawlers = w < 2 ? 0 : w <= 3 ? 1 : w <= 4 ? 2 : w <= 6 ? 3 : Math.min(6, 3 + Math.floor((w - 6) / 2));
  const bloaters = w < 4 ? 0 : w === 4 ? 1 : w <= 6 ? 2 : Math.min(5, 2 + Math.floor((w - 6) / 2));
  const surprises = w < 3 ? 0 : w === 3 ? 2 : w === 4 ? 3 : w <= 6 ? 4 : Math.min(9, 4 + Math.floor((w - 5) / 2));
  const lanes: LaneId[] = w === 1 ? ["road"] : w === 2 ? ["road", "corn"] : ["road", "corn", "trees"];
  return {
    wave: w,
    dead,
    mechanic,
    runners,
    crawlers,
    bloaters,
    surprises,
    lanes,
    opening: OPENINGS[w] ?? [],
    maxActive: w === 1 ? 5 : w === 2 ? 6 : w === 3 ? 7 : w <= 5 ? 9 : Math.min(30, 10 + 2 * (w - 6)),
    gap: w <= 3 ? [1.7, 3.0] : w <= 6 ? [1.4, 2.5] : [Math.max(0.3, 1.2 - 0.15 * (w - 6)), Math.max(0.7, 2.2 - 0.25 * (w - 6))],
    pace: w === 1 ? 0.8 : w === 2 ? 0.9 : Math.min(1.8, 1 + 0.09 * (w - 3)),
    fog: fogFor(w),
    survivors: w < 3 ? 0 : w <= 5 ? 1 : 2,
    subtitle: subtitleFor(w),
  };
}

/**
 * How far into the fog the road can be read at a density: where a figure
 * is a quarter as clear as up close (the fog is exponential-squared).
 */
export function sightFor(density: number): number {
  return Math.sqrt(Math.log(4)) / Math.max(1e-4, density);
}
