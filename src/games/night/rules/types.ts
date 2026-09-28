import type { V3 } from "../../../engine/rules/raymath";

/**
 * The ways the dead come to the barricade. Three lanes out of the fog - the
 * road, the cornfield, the tree line past the motel - and three surprises
 * (wave 4 on): out of the burned bus, from behind the phone booth, over the
 * fence at 12 m.
 */
export type LaneId = "road" | "corn" | "trees" | "bus" | "booth" | "fence";

export const SURPRISES: readonly LaneId[] = ["bus", "booth", "fence"];

/**
 * One lane, read from the road's `lane.<id>.<n>` waypoints (or a surprise's
 * `spawn.<id>` and `spawn.<id>.path.<n>`): where the dead come into play, in
 * the fog or the corn or the bus, to where the lane meets the barricade.
 * Plain data, so the rules can run and be tested without Three.js.
 */
export interface Lane {
  id: LaneId;
  /** Ground points in order, from where the dead appear toward the barricade. */
  points: V3[];
  /**
   * How far to either side of the line each of the dead may walk its own way
   * (metres): a crowd on the road does not walk in single file.
   */
  spread: number;
  /**
   * How far along the lane (metres) the corn hides them: the corn bends
   * ahead of one, and nothing more, until it steps out. 0 for none.
   */
  cover: number;
}

/** Where one of the dead stands when it reaches you: `barricade.<n>`. */
export interface Slot {
  index: number;
  pos: V3;
}

/** The road as the rules need it. */
export interface RoadPlan {
  lanes: readonly Lane[];
  slots: readonly Slot[];
  /** The player's eye; the player looks down −Z from here. */
  eye?: V3;
}

export type DeadKind = "walker" | "runner" | "crawler" | "bloater" | "mechanic";

/** A walker's way of walking: each a clip of its own, at its own pace. */
export type Gait = "walk.shamble" | "walk.limp" | "walk.drag" | "walk.lurch";

export const GAITS: readonly Gait[] = ["walk.shamble", "walk.limp", "walk.drag", "walk.lurch"];

export type DeadState =
  | "reserve"
  /** Climbing out of the bus, or over the fence: the first stretch of its lane. */
  | "emerging"
  | "approaching"
  /** Knocked back by a body shot, finding its feet. */
  | "staggered"
  /** A runner's leap at the barricade. */
  | "lunging"
  /** At the barricade, and every slot taken: pressing in behind. */
  | "waiting"
  | "attacking"
  /** A bloater at the barricade, swelling to burst. */
  | "swelling"
  | "dying"
  | "dead";

/** Where a shot landed on one of the dead, as the world's ray tests saw it. */
export type HitPart = "head" | "body" | "limb";

/** How one of the dead went down. */
export type DeathCause = HitPart | "chain" | "burst";

export type SurvivorRole = "daughter" | "owner";
