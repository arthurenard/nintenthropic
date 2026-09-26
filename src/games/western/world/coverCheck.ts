import { Vector3 } from "three";
import type { Cover } from "../rules/types";
import type { RayHit, TownQueries } from "./queries";

const from = new Vector3();
const to = new Vector3();
const dir = new Vector3();
const hit: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };

const side = new Vector3();

/**
 * Can the eye see a man's chest or head standing at `feet`? Six rays, across
 * his shoulders at chest and head height: a thin post in front of him blocks
 * one of them, not him. Two clear rays make him visible.
 */
export function coverVisible(queries: TownQueries, eye: Vector3, feet: { x: number; y: number; z: number }): boolean {
  side.set(-(feet.z - eye.z), 0, feet.x - eye.x).normalize();
  let clear = 0;
  for (const h of [1.4, 1.62]) {
    for (const s of [-0.18, 0, 0.18]) {
      to.set(feet.x + side.x * s, feet.y + h, feet.z + side.z * s);
      const d = to.distanceTo(eye);
      dir.copy(to).sub(eye).normalize();
      from.copy(eye);
      const h0 = queries.cast(from, dir, d + 0.5, hit);
      if (!h0 || h0.distance > d - 0.3) clear++;
      if (clear >= 2) return true;
    }
  }
  return false;
}

export interface CoverReport {
  kept: Cover[];
  moved: string[];
  dropped: string[];
}

/**
 * A bandit the player cannot see is not a fair fight. Every cover's exposed
 * spot is checked from the eye: if neither chest nor head shows (a window
 * seen edge-on down the street, a spot set too deep inside a doorway), the
 * spot is nudged toward the player until it does, up to a metre; failing
 * that the cover is left out. Whatever was changed is reported, for the art.
 */
export function checkCovers(covers: readonly Cover[], queries: TownQueries, eye: Vector3): CoverReport {
  const kept: Cover[] = [];
  const moved: string[] = [];
  const dropped: string[] = [];
  for (const c of covers) {
    if (coverVisible(queries, eye, c.exposed)) {
      kept.push(c);
      continue;
    }
    const toward = new Vector3(eye.x - c.exposed.x, 0, eye.z - c.exposed.z).normalize();
    let fixed: Cover | null = null;
    for (const step of [0.25, 0.5, 0.75, 1.0]) {
      const p = { x: c.exposed.x + toward.x * step, y: c.exposed.y, z: c.exposed.z + toward.z * step };
      // Only where the same floor still carries him (not out of a window into the air).
      const floor = queries.groundAt(p.x, p.z, c.exposed.y + 1.0);
      if (Math.abs(floor - c.exposed.y) > 0.3) break;
      if (coverVisible(queries, eye, p)) {
        fixed = { ...c, exposed: p, distance: Math.hypot(p.x - eye.x, p.z - eye.z) };
        break;
      }
    }
    if (fixed) {
      kept.push(fixed);
      moved.push(c.id);
    } else {
      dropped.push(c.id);
    }
  }
  return { kept, moved, dropped };
}
