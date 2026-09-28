/**
 * The wave table from docs/DEAD_OF_NIGHT.md, extended past wave 6 by the
 * rule "+3 each: more runners, thicker fog, faster walkers", and everything
 * else that tightens as the night goes on.
 *
 * | Wave | Dead              | New                             |
 * | 1    | 6 walkers         | The road only; learn the fog    |
 * | 2    | 9                 | The cornfield lane              |
 * | 3    | 12                | Runners; the tree line          |
 * | 4    | 14                | Crawlers; the surprises         |
 * | 5    | 16                | Bloaters                        |
 * | 6    | The Mechanic + 14 | Boss                            |
 * | 7+   | +3 each           | More runners, thicker fog, faster walkers |
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
  /** The dead in play at once (the rest wait their turn in the fog). */
  maxActive: number;
  /** Seconds between one coming into play and the next, drawn from this range. */
  gap: readonly [number, number];
  /** Every walker's pace is multiplied by this: faster walkers from wave 7. */
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

export function isMechanicWave(wave: number): boolean {
  return wave >= MECHANIC_EVERY && wave % MECHANIC_EVERY === 0;
}

function deadFor(wave: number): number {
  const table = [6, 9, 12, 14, 16, 14];
  if (wave <= 6) return table[wave - 1] as number;
  // +3 each from wave 7; a Mechanic's wave keeps the count of the wave before.
  const regular = 16 + 3 * (wave - 6);
  return isMechanicWave(wave) ? regular - 3 : regular;
}

/** The fog thickens from wave to wave: about 80 m of road readable on wave 1, 45 m by wave 10. */
export function fogFor(wave: number): number {
  return clamp(0.0155 + 0.0014 * (wave - 1), 0.0155, 0.029);
}

function subtitleFor(wave: number): string {
  switch (wave) {
    case 1:
      return "Something is coming up the road.";
    case 2:
      return "The corn is moving.";
    case 3:
      return "Runners. And the tree line.";
    case 4:
      return "Some of them crawl.";
    case 5:
      return "Bloaters. Shoot them early.";
    case 6:
      return "The Mechanic.";
    default:
      return isMechanicWave(wave) ? "The Mechanic is back." : wave % 2 ? "The fog is getting thicker." : "They keep coming.";
  }
}

export function waveSpec(wave: number): WaveSpec {
  const w = Math.max(1, Math.floor(wave));
  const dead = deadFor(w);
  const mechanic = isMechanicWave(w);
  const runners = w < 3 ? 0 : w <= 4 ? 2 : w <= 6 ? 3 : Math.min(10, 4 + (w - 7));
  const crawlers = w < 4 ? 0 : w <= 6 ? 2 : Math.min(5, 3 + Math.floor((w - 7) / 3));
  const bloaters = w < 5 ? 0 : w <= 6 ? 2 : Math.min(4, 2 + Math.floor((w - 7) / 3));
  const surprises = w < 4 ? 0 : w <= 5 ? 3 : Math.min(7, 4 + Math.floor((w - 6) / 2));
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
    maxActive: w === 1 ? 4 : w === 2 ? 6 : w === 3 ? 7 : w <= 5 ? 8 : Math.min(22, 9 + (w - 6)),
    gap: w === 1 ? [2.6, 4.4] : w <= 3 ? [2, 3.6] : w <= 6 ? [1.6, 3] : [Math.max(0.45, 1.4 - 0.1 * (w - 6)), Math.max(1, 2.6 - 0.15 * (w - 6))],
    pace: w <= 4 ? 1 : Math.min(1.5, 1 + 0.04 * (w - 4)),
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
