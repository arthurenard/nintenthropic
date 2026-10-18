import { offScreenHint } from "../../engine/rules/hints";
import type { InputKind } from "../../engine/types";

/**
 * Orbital Decay's one-time tips: the game teaches itself a lesson at a
 * time, at the moment it matters, and never twice (the hint line itself,
 * and how it queues and times them, is the engine's: engine/rules/hints.ts).
 * Ids are kept by the page between visits (Settings.tipsSeen).
 */
export type TipId = "orbit.heat" | "orbit.ring" | "orbit.split" | "orbit.drone" | "orbit.derelict";

export const ALL_TIPS: readonly TipId[] = ["orbit.heat", "orbit.ring", "orbit.split", "orbit.drone", "orbit.derelict"];

/** How to vent the laser, in the player's own terms: V is the game's own key. */
export function ventHint(input: InputKind | undefined): string {
  return offScreenHint(input, "vent the laser", "Right-click or press V");
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
 * What the hint line says when the drone is shot: the lesson the first time,
 * and after that the crew's patience wearing thin (and, if it was at a
 * window when it was hit, whose window).
 */
export function droneShotLine(hits: number, mending: boolean): string {
  if (hits <= 1) return "That was the drone.";
  return mending ? "The drone. It was mending your window." : "The drone. Again.";
}

/**
 * A lesson is learned when it has been shown, or - for venting, which is
 * shown at the start of every game until then - when the player has done
 * it by themselves (the game's HintLine is made with these).
 */
export const LEARNED_BY_DOING: readonly TipId[] = ["orbit.heat"];
