import type { InputKind } from "../../engine/types";

/**
 * How to reload, in the player's own terms. A mouse player told to "point off
 * the screen" would drag the pointer out of the window; the page turns a
 * right-click (and R) or a two-finger tap into the same gesture.
 */
export function reloadHint(input: InputKind | undefined): string {
  if (input === "mouse") return "Right-click or press R to reload.";
  if (input === "touch") return "Tap with two fingers to reload.";
  return "Point off the screen to reload.";
}
