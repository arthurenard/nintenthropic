/**
 * Grip Prix's drivers: who sits in each kart. Their own cast, nothing
 * borrowed. A driver's weight changes how the kart drives (the sim reads
 * WEIGHTS); the picture builds each one by `species`.
 */
import type { UnlockId } from "./unlocks";

export type Weight = "light" | "middle" | "heavy";

/** The patterns a kart's second colour makes on its flanks and hood (art/kart/karts/build.py draws them, one node each). */
export type LiveryPattern = "flames" | "spots" | "checks" | "waves" | "tiger" | "chevrons" | "bolts" | "diamonds" | "twin";

/** A driver's livery: the pattern on their kart and the colour they would like it in (a colour too near the paint is swapped for light or dark). */
export interface Livery {
  pattern: LiveryPattern;
  colour: string;
}

export interface Character {
  id: string;
  name: string;
  weight: Weight;
  /** What the picture builds. */
  species: "rabbit" | "penguin" | "frog" | "fox" | "otter" | "cat" | "bear" | "robot" | "duck";
  /** The pattern and second colour on their kart. */
  livery: Livery;
  /** One line for the character select. */
  blurb: string;
  /** Hidden until this is unlocked. */
  unlock?: UnlockId;
}

export const CHARACTERS: readonly Character[] = [
  { id: "bun", name: "Bun", weight: "light", species: "rabbit", livery: { pattern: "spots", colour: "#fff1dc" }, blurb: "First off the line, every time." },
  { id: "pepper", name: "Pepper", weight: "light", species: "penguin", livery: { pattern: "waves", colour: "#bfe6ff" }, blurb: "Never met an ice patch she didn't like." },
  { id: "moss", name: "Moss", weight: "light", species: "frog", livery: { pattern: "tiger", colour: "#7ed35a" }, blurb: "Hops into every drift." },
  { id: "kit", name: "Kit", weight: "middle", species: "fox", livery: { pattern: "flames", colour: "#ffb347" }, blurb: "Knows the inside line." },
  { id: "juniper", name: "Juniper", weight: "middle", species: "otter", livery: { pattern: "diamonds", colour: "#f3e3c3" }, blurb: "Takes the wet line on purpose." },
  { id: "mango", name: "Mango", weight: "middle", species: "cat", livery: { pattern: "bolts", colour: "#ffd23a" }, blurb: "Lands on all four wheels." },
  { id: "bramble", name: "Bramble", weight: "heavy", species: "bear", livery: { pattern: "chevrons", colour: "#f1c26b" }, blurb: "Bumps first, apologises later." },
  { id: "rivet", name: "Rivet", weight: "heavy", species: "robot", livery: { pattern: "checks", colour: "#dfe5f0" }, blurb: "Never blinks. Never brakes." },
  { id: "dabble", name: "Dabble", weight: "middle", species: "duck", livery: { pattern: "twin", colour: "#ffe55c" }, blurb: "Found every duck. Became one.", unlock: "duck-driver" },
];

/**
 * How weight drives, as multipliers on the sim's own numbers: light karts
 * pick up speed sooner and are shoved about; heavy ones top out a little
 * higher and shove back. Small differences — skill decides races.
 */
export interface WeightMods {
  acceleration: number;
  topSpeed: number;
  shoved: number;
  grip: number;
}

export const WEIGHTS: Record<Weight, WeightMods> = {
  light: { acceleration: 1.12, topSpeed: 0.97, shoved: 1.4, grip: 1.05 },
  middle: { acceleration: 1, topSpeed: 1, shoved: 1, grip: 1 },
  heavy: { acceleration: 0.9, topSpeed: 1.03, shoved: 0.6, grip: 0.96 },
};

export function characterById(id: string | undefined): Character | undefined {
  return id ? CHARACTERS.find((c) => c.id === id) : undefined;
}

/** A driver's weight (middle for none or an unknown id). */
export function weightOf(id: string | undefined): Weight {
  return characterById(id)?.weight ?? "middle";
}
