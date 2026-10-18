import { reloadHint } from "../../engine/rules/hints";
import type { InputKind } from "../../engine/types";
import type { SurvivorRole } from "./rules/types";

/**
 * Dead of Night's one-time tips (docs/DEAD_OF_NIGHT.md): the night teaches
 * itself a lesson at a time, at the moment it matters, and never twice.
 * The hint line itself, and how it queues and times them, is the engine's
 * (engine/rules/hints.ts); the page keeps the ids seen between visits
 * (Settings.tipsSeen).
 */
export type TipId = "night.reload" | "night.head" | "night.eyes" | "night.bloater" | "night.crawler";

export const ALL_TIPS: readonly TipId[] = ["night.reload", "night.head", "night.eyes", "night.bloater", "night.crawler"];

/** Each tip's words, in the player's own terms. */
export function tipText(id: TipId, input: InputKind | undefined): string {
  switch (id) {
    case "night.reload":
      return reloadHint(input);
    case "night.head":
      return "Aim for the head. Body shots only slow them down.";
    case "night.eyes":
      return "Eyes in the fog. Light them up.";
    case "night.bloater":
      return "Shoot the bloater before it reaches you.";
    case "night.crawler":
      return "Watch the road. Some of them crawl.";
  }
}

/** A calm word after a survivor is shot, so it reads without the sound and without the popup's red. */
export function survivorWord(role: SurvivorRole): string {
  return role === "daughter" ? "That was Miller’s daughter." : "That was the motel owner.";
}

/**
 * A lesson is learned when it has been shown, or - for the reload, which
 * is shown at the start of every game until then - when the player has
 * done it by themselves (the game's HintLine is made with these).
 */
export const LEARNED_BY_DOING: readonly TipId[] = ["night.reload"];
