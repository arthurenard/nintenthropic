import { HintLine as Line, TIP_GAP, TIP_SECONDS } from "../../engine/rules/hints";
import type { InputKind } from "../../engine/types";

/**
 * Orbital Decay's one-time tips: the game teaches itself a lesson at a
 * time, at the moment it matters, and never twice (the hint line itself,
 * and how it queues and times them, is the engine's: engine/rules/hints.ts).
 * Ids are kept by the page between visits (Settings.tipsSeen).
 */
export type TipId = "orbit.heat" | "orbit.ring" | "orbit.split" | "orbit.drone" | "orbit.derelict";

export const ALL_TIPS: readonly TipId[] = ["orbit.heat", "orbit.ring", "orbit.split", "orbit.drone", "orbit.derelict"];

export { TIP_GAP, TIP_SECONDS };

/**
 * How to vent the laser, in the player's own terms. A mouse player told to
 * "point off the screen" would drag the pointer out of the window; the page
 * turns a right-click or a two-finger tap into the same gesture, and V is
 * the game's own key.
 */
export function ventHint(input: InputKind | undefined): string {
  if (input === "mouse") return "Right-click or press V to vent the laser.";
  if (input === "touch") return "Tap with two fingers to vent the laser.";
  return "Point off the screen to vent the laser.";
}

/** Each tip's words, in the player's own terms. */
export function tipText(id: TipId, input: InputKind | undefined): string {
  switch (id) {
    case "orbit.heat":
      return ventHint(input);
    case "orbit.ring":
      return "A ring means it’s coming at the glass.";
    case "orbit.split":
      return "Big pieces split. Clear the pieces too.";
    case "orbit.drone":
      return "The drone mends the glass. Don’t shoot it.";
    case "orbit.derelict":
      return "Hit its fuel tank.";
  }
}

/**
 * A lesson is learned when it has been shown, or - for venting, which is
 * shown at the start of every game until then - when the player has done
 * it by themselves.
 */
const LEARNED_BY_DOING: readonly TipId[] = ["orbit.heat"];

/** Orbital Decay's hint line: venting is learned by doing it, every other tip by seeing it. */
export class HintLine extends Line {
  constructor(seen: Set<string>) {
    super(seen, LEARNED_BY_DOING);
  }
}
