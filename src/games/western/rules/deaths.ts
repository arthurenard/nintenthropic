import type { Random } from "../../../engine/rules/rng";
import type { BanditState, Cover, DeathChoice, HitPart } from "./types";

/** More floor than this in front of a man up high, and he falls on it, not off it. */
export const MAX_LEDGE = 1.1;

/**
 * How a bandit goes down depends on where he was and how he was hit: out of
 * a window or off a roof he falls to the street; behind a barrel, crate or
 * wagon he slumps over it; in a doorway or at a corner a headshot throws him
 * back and a body shot folds him forward or back; a runner pitches forward
 * with his own momentum.
 */
export function chooseDeath(
  cover: Cover,
  part: HitPart | "blast",
  state: BanditState,
  random: Random,
): DeathChoice {
  if (state === "running" || state === "walking") return { clip: "death_forward", fall: false };
  if (cover.level >= 1 && (cover.kind === "window" || cover.kind === "roof" || cover.kind === "tower") && (cover.ledge ?? 0) < MAX_LEDGE) {
    return { clip: "death_fall", fall: true };
  }
  // At a window with a deep balcony in front, the wall is at his back: he
  // pitches forward onto the boards.
  if (cover.kind === "window") return { clip: "death_forward", fall: false };
  if (part === "blast") return { clip: "death_back", fall: false };
  // Slumping over it needs him behind it: a man who rose over a barrel,
  // crate or wagon. One who leans out round its end stands beside it, with
  // nothing to fold over, and goes down like a man at a corner.
  if ((cover.kind === "barrel" || cover.kind === "crate" || cover.kind === "wagon") && cover.emerge === "rise") {
    // Only once he has risen over it; still half-crouched, he falls back.
    return { clip: state === "emerging" || state === "hiding" ? "death_back" : "death_slump", fall: false };
  }
  if (part === "head") return { clip: "death_back", fall: false };
  return { clip: random() < 0.5 ? "death_forward" : "death_back", fall: false };
}
