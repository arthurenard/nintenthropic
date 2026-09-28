import { HintLine as Line, TIP_GAP, TIP_SECONDS } from "../../engine/rules/hints";
import type { InputKind } from "../../engine/types";
import { reloadHint } from "./hints";

/**
 * High Noon's one-time tips: the game teaches itself a lesson at a time, at
 * the moment it matters, and never twice (the hint line itself, and how it
 * queues and times them, is the engine's: engine/rules/hints.ts). Ids are
 * kept by the page between visits (Settings.tipsSeen).
 */
export type TipId = "western.reload" | "western.townsfolk" | "western.glint" | "western.dynamite";

export const ALL_TIPS: readonly TipId[] = ["western.reload", "western.townsfolk", "western.glint", "western.dynamite"];

export { TIP_GAP, TIP_SECONDS };

/** Each tip's words, in the player's own terms. */
export function tipText(id: TipId, input: InputKind | undefined): string {
  switch (id) {
    case "western.reload":
      return reloadHint(input);
    case "western.townsfolk":
      return "Hold your fire. Townsfolk aren’t with the gang.";
    case "western.glint":
      return "A glint means he’s about to fire.";
    case "western.dynamite":
      return "Shoot the dynamite before it lands.";
  }
}

/**
 * A lesson is learned when it has been shown, or - for the reload, which
 * is shown at the start of every game until then - when the player has
 * done it by themselves.
 */
const LEARNED_BY_DOING: readonly TipId[] = ["western.reload"];

/** High Noon's hint line: the reload is learned by doing it, every other tip by seeing it. */
export class HintLine extends Line {
  constructor(seen: Set<string>) {
    super(seen, LEARNED_BY_DOING);
  }
}
