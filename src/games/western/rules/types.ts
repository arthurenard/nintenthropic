import type { V3 } from "./raymath";

export type CoverKind = "window" | "door" | "barrel" | "crate" | "wagon" | "corner" | "roof" | "tower";
export type Emerge = "lean_left" | "lean_right" | "rise" | "step_out";

/**
 * A place a bandit fights from, read from the town's `cover.<id>` and
 * `cover.<id>.hidden` nodes (see docs/WEB_ARCHITECTURE.md). Plain data, so the
 * rules can run and be tested without Three.js.
 */
export interface Cover {
  id: string;
  kind: CoverKind;
  emerge: Emerge;
  level: 0 | 1 | 2;
  /** Feet position when out of cover, facing the player. */
  exposed: V3;
  /** Feet position while waiting out of sight. */
  hidden: V3;
  /**
   * Where he stands, just out of sight, to come out: the corner's edge, the
   * doorway's threshold, just inside a window. Coming out and going back
   * move him between here and `exposed` (while the clip leans, rises or
   * steps); the way between `hidden` and here is walked unseen. Worked out
   * by the game from the town; without it, `hidden`.
   */
  ready?: V3;
  /** Metres from the player's eye (horizontal). */
  distance: number;
  /** −1 left of the street, +1 right, 0 across the far end. */
  side: -1 | 0 | 1;
  /** Extra hints from the town's extras: "boss", "townsfolk", "duel". */
  tags: readonly string[];
}

export type Role = "gunman" | "rifleman" | "runner" | "dynamiter" | "boss" | "duelist";

export type BanditState =
  | "reserve"
  | "hidden"
  | "tell"
  | "emerging"
  | "aiming"
  | "firing"
  | "lighting"
  | "throwing"
  | "hiding"
  | "running"
  | "staggered"
  | "walking"
  | "standoff"
  | "dying"
  | "dead";

export type HitPart = "head" | "body" | "limb";

export type DeathClip = "death_back" | "death_forward" | "death_fall" | "death_slump";

export interface DeathChoice {
  clip: DeathClip;
  /** Falls from a window, balcony or roof to the ground below. */
  fall: boolean;
}

export type TownsfolkRole = "barber" | "woman" | "bartender" | "undertaker" | "preacher";
export type TownsfolkState = "hidden" | "peeking" | "out" | "hurt" | "leaving" | "gone";
