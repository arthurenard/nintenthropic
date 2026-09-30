/**
 * What broke the glass, and what would help: the results' note, said the
 * way you would point it out ("A chunk on the upper-left pane.") and then
 * matched to the one thing that would help most next time.
 */
import { PANE_NAMES } from "./layout";
import type { Kind } from "./tuning";

export interface Breach {
  /** What struck the pane that failed. */
  kind: Kind;
  /** It was a piece of something split: what that was. */
  pieceOf: Kind | null;
  pane: number;
  /** Strikes that pane had taken before the last. */
  earlier: number;
  /** What the last strike cost it. */
  cost: number;
  /** The drone had been shot this game. */
  droneShot: boolean;
  pass: number;
}

/** A strike this small, on a pane struck this often before, wore it down. */
export const WORN_STRIKES = 4;
export const WORN_COST = 25;

/** "the upper-left pane" */
export function paneName(pane: number): string {
  return `the ${PANE_NAMES[pane] ?? "centre"} pane`;
}

function worn(b: Breach): boolean {
  return b.kind !== "derelict" && b.earlier >= WORN_STRIKES && b.cost <= WORN_COST;
}

/** What struck it, as a player would say it: "A chunk", "Pieces of a slab". */
function what(b: Breach): string {
  const whole: Record<Kind, string> = {
    shrapnel: "Shrapnel",
    chunk: "A chunk",
    slab: "A slab",
    shard: "A solar panel shard",
    foil: "A foil-wrapped piece",
    derelict: "The Derelict",
  };
  const of: Partial<Record<Kind, string>> = {
    chunk: "Pieces of a chunk",
    slab: "Pieces of a slab",
    foil: "Pieces of a foil-wrapped core",
    derelict: "Wreckage of the Derelict",
  };
  return b.pieceOf ? (of[b.pieceOf] ?? whole[b.kind]) : whole[b.kind];
}

/** The cause, in one sentence: "A chunk on the upper-left pane." */
export function breachCause(b: Breach): string {
  if (b.kind === "derelict") return "The Derelict.";
  if (worn(b)) return "A pane worn down over time.";
  return `${what(b)} on ${paneName(b.pane)}.`;
}

/** The one thing that would help most, matched to what did it. */
export function breachAdvice(b: Breach): string {
  if (b.kind === "derelict") return "Its fuel tank shows as it tumbles; three hits break it up.";
  if (worn(b)) {
    return b.droneShot ? "Keep the drone working: don’t shoot it." : "Every chip adds up: clear the small pieces too.";
  }
  switch (b.pieceOf ?? b.kind) {
    case "chunk":
      return "Chunks split into pieces: clear the pieces before they arrive.";
    case "slab":
      return "Split slabs far out, and there’s time to clear the pieces.";
    case "foil":
      return "The first hit strips the foil; the second breaks it.";
    case "shard":
      return "Shards turn: shoot them face-on.";
    case "derelict":
      return "When it breaks up, clear the pieces nearest the glass first.";
    default:
      return "It’s fast: the ring counts down, so take the lowest first.";
  }
}

/** The results card's line under the outcome. */
export function breachNote(b: Breach): string {
  return `${breachCause(b)} ${breachAdvice(b)}`;
}
