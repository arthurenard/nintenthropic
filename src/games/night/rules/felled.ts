import type { DeadKind, LaneId } from "./types";

/** What took the player, as the match saw it. */
export interface Felled {
  kind: DeadKind;
  /** The way it came. */
  lane: LaneId;
  /** A bloater that burst on the barricade, rather than a blow. */
  burst: boolean;
  /** The late-wave pressure at that moment, 0 (none) to 1 (the fog at its thickest). */
  pressure: number;
  /** Headshots it takes to knock the Mechanic's mask off, on the difficulty played. */
  maskHits: number;
}

/** Past this much pressure, the length of the wave is what did it. */
export const LATE_PRESSURE = 0.5;

/** The way one of the dead came, as you would point it out: "out of the corn". */
export function wayOf(lane: LaneId): string {
  switch (lane) {
    case "road":
      return "up the road";
    case "corn":
      return "out of the corn";
    case "trees":
      return "from the tree line";
    case "bus":
      return "out of the bus";
    case "booth":
      return "from behind the phone booth";
    case "fence":
      return "over the fence";
  }
}

/** Who took the player, in a few words: "a runner out of the corn", "the bloater". */
export function takenBy(f: Felled): string {
  switch (f.kind) {
    case "walker":
      return "a walker at the barricade";
    case "runner":
      return `a runner ${wayOf(f.lane)}`;
    case "crawler":
      return "a crawler at the barricade";
    case "bloater":
      return "the bloater";
    case "mechanic":
      return "the Mechanic";
  }
}

/** The one thing that would help most next time, matched to what did it. */
export function advice(f: Felled): string {
  switch (f.kind) {
    case "walker":
      return "Aim for the head — three body shots take too long.";
    case "runner":
      return "Runners come fast; a headshot stops them dead.";
    case "crawler":
      return "Watch the road. Some of them crawl.";
    case "bloater":
      return "Shoot it before it reaches you.";
    case "mechanic":
      return f.maskHits === 1 ? "Knock his mask off, then one to the head." : "Two shots knock his mask off, then one to the head.";
  }
}

/**
 * The results card's line under the outcome: what took the player and what
 * would help, as docs/DEAD_OF_NIGHT.md words it ("A walker at the
 * barricade. Aim for the head — three body shots take too long."), or,
 * late in a long wave, the fog itself.
 */
export function felledNote(f: Felled): string {
  if (f.pressure >= LATE_PRESSURE) return "The fog gets thicker the longer a wave goes. Keep the road clear.";
  const by = takenBy(f);
  return `${by.charAt(0).toUpperCase()}${by.slice(1)}. ${advice(f)}`;
}
