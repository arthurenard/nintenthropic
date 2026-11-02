/**
 * Hands near the edge of the picture. A player leaning into a bend, or
 * shuffling in their chair, drifts toward the side of the camera's view (or,
 * with several on one camera, toward a neighbour's column) and loses a hand
 * before they know it. Before that happens the race says which way to move,
 * as the player sees themself in the mirrored picture: a fist near its right
 * edge is moved left.
 *
 * Pure: fed where a palm is and how big it looks, in the mirrored picture.
 */
import type { EdgeWay } from "../contract";

/** Which way to move the hands back in: as the player sees themself (mirrored, so their own left is "left"). */
export type Way = EdgeWay;

export const EDGE = {
  /**
   * A palm whose centre is nearer an edge than this many hand sizes (wrist to
   * middle knuckle) is near it: a fist reaches a little over half a size past
   * its palm's centre, so it is then most of a hand from the edge (the
   * tracker holds on until about half of it is out), time to move back in.
   */
  near: 1.3,
  /** ...and never less than this, picture heights (a hand far from the camera looks small). */
  least: 0.06,
  /** A hand gone this recently, seconds, last seen near an edge, went out that way. */
  gone: 1.5,
} as const;

export interface EdgeHand {
  /** The palm's centre in the mirrored picture, 0..1, y down. */
  x: number;
  y: number;
  /** Wrist to middle knuckle, picture heights. */
  size: number;
}

export interface Nearness {
  way: Way;
  /** How far in it still is, of the margin: 0 on the edge, up to 1 where "near" begins. */
  room: number;
}

/**
 * Whether a palm is near an edge of its zone (the player's column of the picture, `[left, right]` as fractions of its
 * width; the whole picture is `[0, 1]`), and which way would bring it back in. Null when it is well inside.
 */
export function nearEdge(hand: EdgeHand, zone: readonly [number, number], aspect: number): Nearness | null {
  const margin = Math.max(EDGE.least, hand.size * EDGE.near);
  // In picture heights, so a margin is as wide across as it is down.
  const left = (hand.x - zone[0]) * aspect;
  const right = (zone[1] - hand.x) * aspect;
  const top = hand.y;
  const bottom = 1 - hand.y;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest >= margin) return null;
  const room = Math.max(0, nearest) / margin;
  if (nearest === left) return { way: "right", room };
  if (nearest === right) return { way: "left", room };
  if (nearest === top) return { way: "down", room };
  return { way: "up", room };
}

export interface EdgeSlot {
  /** The newest reading of this hand, or null if it has never been seen. */
  reading: EdgeHand | null;
  /** How long ago it was seen, seconds. */
  ago: number;
  /** Whether it counts as in the picture now. */
  present: boolean;
}

/**
 * The way to move both hands back in, or null when neither is near an edge. A hand already gone out (seen within
 * `EDGE.gone`, near an edge when last seen) says it first: it is the one being lost. Otherwise the hand nearest its edge.
 */
export function edgeWay(slots: readonly EdgeSlot[], zone: readonly [number, number], aspect: number): Way | null {
  let gone: Way | null = null;
  let best: Nearness | null = null;
  for (const slot of slots) {
    if (!slot.reading || slot.ago > EDGE.gone) continue;
    const near = nearEdge(slot.reading, zone, aspect);
    if (!near) continue;
    if (!slot.present) gone ??= near.way;
    else if (!best || near.room < best.room) best = near;
  }
  return gone ?? best?.way ?? null;
}
