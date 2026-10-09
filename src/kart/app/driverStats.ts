/**
 * What a driver's weight means, as the bars on the Choose Your Driver screen
 * say it: Speed, Acceleration, Handling and Weight, each 1 to 5 segments.
 * Nothing is made up here. The bars are read from characters.ts's WEIGHTS,
 * the same numbers the sim drives with: for each stat the weight class with
 * the least of it gets one segment and the one with the most gets five, the
 * rest in proportion. (The differences are small in the sim and the bars say
 * only who has more than whom: skill decides races.)
 */
import { WEIGHTS, type Weight, type WeightMods } from "../characters";

export type StatId = "speed" | "acceleration" | "handling" | "weight";

export interface Stat {
  id: StatId;
  label: string;
  /** The page's line icon (race.html's sprite). */
  icon: string;
  /** 1 to SEGMENTS. */
  segments: number;
}

export const SEGMENTS = 5;

/** Each stat: its name, its icon, and which of the sim's numbers it reads (a bigger number is more of the stat). */
const READ: readonly { id: StatId; label: string; icon: string; of(mods: WeightMods): number }[] = [
  { id: "speed", label: "Speed", icon: "gauge", of: (mods) => mods.topSpeed },
  { id: "acceleration", label: "Acceleration", icon: "bolt", of: (mods) => mods.acceleration },
  { id: "handling", label: "Handling", icon: "wheel", of: (mods) => mods.grip },
  // Being shoved less is what weight is.
  { id: "weight", label: "Weight", icon: "weight", of: (mods) => -mods.shoved },
];

/** The three classes' words, for the pill by a driver's name. */
export const CLASS_WORDS: Record<Weight, string> = { light: "Lightweight", middle: "Middleweight", heavy: "Heavyweight" };

/** 1 to SEGMENTS segments for `value` between the least (`low`) and the most (`high`) any class has. */
export function segmentsFor(value: number, low: number, high: number): number {
  if (!(high > low)) return Math.ceil(SEGMENTS / 2);
  const fraction = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return 1 + Math.round(fraction * (SEGMENTS - 1));
}

/** The four bars of a weight class. */
export function statsOf(weight: Weight): Stat[] {
  const classes = Object.values(WEIGHTS);
  return READ.map(({ id, label, icon, of }) => {
    const all = classes.map(of);
    return { id, label, icon, segments: segmentsFor(of(WEIGHTS[weight]), Math.min(...all), Math.max(...all)) };
  });
}
