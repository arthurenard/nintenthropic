import { HintLine as Line } from "../../engine/rules/hints";
import type { InputKind, Settings } from "../../engine/types";

/**
 * Overwatch Ridge's one-time tips: the game teaches the rifle a lesson at a
 * time, at the moment it matters, and never twice (the hint line itself is
 * the engine's: engine/rules/hints.ts). Ids are kept by the page between
 * visits (Settings.tipsSeen).
 */
export type TipId = "ridge.scope" | "ridge.hip" | "ridge.bolt" | "ridge.drop" | "ridge.wind" | "ridge.civilian" | "ridge.glint";

export const ALL_TIPS: readonly TipId[] = ["ridge.scope", "ridge.hip", "ridge.bolt", "ridge.drop", "ridge.wind", "ridge.civilian", "ridge.glint"];

/**
 * How the player looks through the scope, in their own terms. With the hand
 * and the eye it also says the way that always works, Shift: it stands at the
 * foot of the view until the player has looked through the scope once, and
 * the eye is not the only thing they are told.
 */
export function scopeHint(input: InputKind | undefined, scope: Settings["scope"]): string {
  const toggle = scope.button === "toggle";
  if (input === "touch") return toggle ? "Tap Scope to look through the scope." : "Hold Scope to look through the scope.";
  if (input === "mouse") return toggle ? "Press Shift or the right button to look through the scope." : "Hold Shift or the right button to look through the scope.";
  // With the hand: Shift, or on a touch screen the Scope button.
  const way = scope.touch ? "Scope" : "Shift";
  if (scope.eye) return `Close one eye to look through the scope. Or ${toggle ? "press" : "hold"} ${way}.`;
  return toggle ? `Press ${way} to look through the scope.` : `Hold ${way} to look through the scope.`;
}

/** What the spotter says to a scope looking at nothing: which way to turn it. */
export function turnWord(way: "left" | "right" | "up" | "down"): string {
  switch (way) {
    case "left":
      return "Your spotter: they’re to your left.";
    case "right":
      return "Your spotter: they’re to your right.";
    case "up":
      return "Your spotter: look higher.";
    case "down":
      return "Your spotter: look lower.";
  }
}

/**
 * What the spotter says when nobody has found the men yet: where they are, and
 * how far. `marked`: Aim Assist has a caret over each of them, and he says so.
 */
export function spotterWord(place: string, range: number, marked = true, several = true): string {
  const where = place ? ` ${place}` : "";
  return `Your spotter has ${several ? "them" : "him"}${where}, ${Math.round(range)} m out.${marked ? " Marked." : ""}`;
}

/** What the spotter says of the last man, not yet found: where, in the words you would use to point him out. */
export function lastOneWord(where: string): string {
  return `Last one: ${where}.`;
}

/** Each tip's words, in the player's own terms. */
export function tipText(id: TipId, input: InputKind | undefined, scope: Settings["scope"]): string {
  switch (id) {
    case "ridge.scope":
      return scopeHint(input, scope);
    case "ridge.hip":
      return "From the hip it could land anywhere. Look through the scope.";
    case "ridge.bolt":
      return "Raise your thumb to work the bolt.";
    case "ridge.drop":
      return "It drops with distance. Aim a mark higher for every hundred metres past the first two.";
    case "ridge.wind":
      return "The wind pushes the round. Aim into it.";
    case "ridge.civilian":
      return "Blue overalls and bicycles are locals. Hold your fire.";
    case "ridge.glint":
      return "A glint on the far side. That’s his scope.";
  }
}

/**
 * A lesson is learned when it has been shown - or, for the scope, which is
 * shown at the start of every game until then, when the player has looked
 * through it by themselves.
 */
const LEARNED_BY_DOING: readonly TipId[] = ["ridge.scope"];

export class HintLine extends Line {
  constructor(seen: Set<string>) {
    super(seen, LEARNED_BY_DOING);
  }
}

/** How to reload, in the player's terms (the right button scopes in this game, so a mouse reloads with R). */
export function reloadHint(input: InputKind | undefined): string {
  if (input === "mouse") return "Press R to reload.";
  if (input === "touch") return "Tap with two fingers to reload.";
  return "Point off the screen to reload.";
}

/** A calm word after someone the valley lives with is hit: who it was. */
export function innocentWord(role: string): string {
  switch (role) {
    case "farmer":
      return "That was the farmer.";
    case "cyclist":
      return "That was a cyclist.";
    case "shepherd":
      return "That was the shepherd.";
    case "child":
      return "That was a child.";
    case "cow":
      return "That was a cow.";
    case "sheep":
      return "That was a sheep.";
    case "goat":
      return "That was the goat.";
    case "eagle":
      return "That was the eagle.";
    case "dog":
      return "That was the farm dog.";
    default:
      return "That was one of the valley’s own.";
  }
}
