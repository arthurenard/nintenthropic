import type { InputKind } from "../../engine/types";
import type { TownsfolkRole } from "./rules/types";

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

/**
 * A calm word after a townsperson is shot, so it reads without the sound
 * and without the popup's red: who it was, nothing more. `count` is how many
 * this game has hit, this one included: the second is counted, and from the
 * third the town itself has noticed.
 */
export function innocentWord(role: TownsfolkRole, count = 1): string {
  if (count >= 3) return "The town has noticed.";
  const who = whoWasShot(role);
  return count === 2 ? `${who} That makes two.` : who;
}

function whoWasShot(role: TownsfolkRole): string {
  switch (role) {
    case "barber":
      return "That was the barber.";
    case "bartender":
      return "That was the bartender.";
    case "undertaker":
      return "That was the undertaker.";
    case "preacher":
      return "That was the preacher.";
    case "woman":
      return "That was a townswoman.";
  }
}

/**
 * The chicken's first two near misses, said where it stood (the third makes
 * it the Chicken of Steel, and the toast says so); after that, nothing.
 */
export function chickenWord(hits: number): string | null {
  if (hits === 1) return "The chicken is fine.";
  if (hits === 2) return "The chicken is still fine.";
  return null;
}
