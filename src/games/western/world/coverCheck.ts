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

/**
 * The game's own adjustments to covers the town placed, by id, in world
 * metres. The saloon's roof edge perch sat right under the score panel in
 * the play framing's top-left corner, the one spot that kept the view from
 * closing in further; a few steps further along the same roof edge he is
 * clear of it (and still on the roof: the floor is checked).
 */
export const COVER_SHIFTS: Readonly<Record<string, { dx: number; dz: number }>> = {
  "saloon.roof": { dx: 0, dz: -2.6 },
};

/** Apply COVER_SHIFTS (or `shifts`) where the same floor carries the moved spot. */
export function shiftCovers(
  covers: readonly Cover[],
  queries: TownQueries,
  eye: Vector3,
  shifts: Readonly<Record<string, { dx: number; dz: number }>> = COVER_SHIFTS,
): { covers: Cover[]; shifted: string[] } {
  const shifted: string[] = [];
  const out = covers.map((c) => {
    const s = shifts[c.id];
    if (!s) return c;
    const exposed = { x: c.exposed.x + s.dx, y: c.exposed.y, z: c.exposed.z + s.dz };
    const hidden = { x: c.hidden.x + s.dx, y: c.hidden.y, z: c.hidden.z + s.dz };
    const floor = queries.groundAt(exposed.x, exposed.z, exposed.y + 1);
    if (Math.abs(floor - exposed.y) > 0.3) return c;
    shifted.push(c.id);
    return { ...c, exposed, hidden, distance: Math.hypot(exposed.x - eye.x, exposed.z - eye.z) };
  });
  return { covers: out, shifted };
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

type P3 = { x: number; y: number; z: number };

/** Is the straight line from the eye to `p` clear of the town (within `slack` metres of it)? */
function seenFromEye(queries: TownQueries, eye: Vector3, p: P3, slack: number): boolean {
  to.set(p.x, p.y, p.z);
  const d = to.distanceTo(eye);
  dir.copy(to).sub(eye).normalize();
  const h0 = queries.cast(eye, dir, d + 0.5, hit);
  return !h0 || h0.distance > d - slack;
}

/**
 * What a player aims at is in plain view: the middle of his head, and the
 * middle of his chest or of his shoulders. (coverVisible lets a post stand
 * in front of him as long as a shoulder shows; this is what reads, and what
 * a first shot at the middle of him will hit.)
 */
export function centreClear(queries: TownQueries, eye: Vector3, feet: P3): boolean {
  const at = (h: number) => ({ x: feet.x, y: feet.y + h, z: feet.z });
  if (!seenFromEye(queries, eye, at(1.62), 0.3)) return false;
  return seenFromEye(queries, eye, at(1.35), 0.3) || seenFromEye(queries, eye, at(1.5), 0.3);
}

/** No sample of a man at `feet` (at these heights, across his width) can be seen. */
export function hiddenFrom(queries: TownQueries, eye: Vector3, feet: P3, heights: readonly number[], halfWidth = 0.2): boolean {
  side.set(-(feet.z - eye.z), 0, feet.x - eye.x).normalize();
  const sx = side.x;
  const sz = side.z;
  for (const h of heights) {
    for (const s of [-halfWidth, 0, halfWidth]) {
      if (seenFromEye(queries, eye, { x: feet.x + sx * s, y: feet.y + h, z: feet.z + sz * s }, 0.25)) return false;
    }
  }
  return true;
}

/** Can a man walk straight from `a` to `b` (nothing solid at these heights)? */
function walkable(queries: TownQueries, a: P3, b: P3, heights: readonly number[] = [0.5, 1.6]): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-3) return true;
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  for (const h of heights) {
    from.set(a.x, a.y + h, a.z);
    dir.set(dx, 0, dz);
    if (queries.cast(from, dir, len + 0.2, hit)) return false;
  }
  return true;
}

const STAND = [1.4, 1.62, 1.85];
const CROUCH = [0.3, 0.6, 0.85];

/**
 * A post that stands between the eye and the middle of a man (the porch posts
 * in front of the barber's and the hotel's doors) is moved out of the way:
 * his spot is nudged, up to 0.6 m, to the nearest place on the same floor he
 * can step to where his head and chest are clear. A cover he rises from
 * moves whole, if he still crouches out of sight there.
 */
export function unblockCovers(covers: readonly Cover[], queries: TownQueries, eye: Vector3): { covers: Cover[]; moved: string[] } {
  const moved: string[] = [];
  const out = covers.map((c) => {
    if (centreClear(queries, eye, c.exposed)) return c;
    const rise = c.emerge === "rise";
    for (const r of [0.15, 0.3, 0.45, 0.6]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const p = { x: c.exposed.x + Math.cos(a) * r, y: c.exposed.y, z: c.exposed.z + Math.sin(a) * r };
        if (Math.abs(queries.groundAt(p.x, p.z, c.exposed.y + 0.6) - c.exposed.y) > 0.1) continue;
        if (!walkable(queries, c.exposed, p)) continue;
        if (!centreClear(queries, eye, p)) continue;
        if (rise && !hiddenFrom(queries, eye, p, CROUCH, 0.15)) continue;
        moved.push(c.id);
        const hidden = rise ? { x: c.hidden.x + (p.x - c.exposed.x), y: c.hidden.y, z: c.hidden.z + (p.z - c.exposed.z) } : c.hidden;
        return { ...c, exposed: p, hidden, distance: Math.hypot(p.x - eye.x, p.z - eye.z) };
      }
    }
    return c;
  });
  return { covers: out, moved };
}

/**
 * The facade a door or window cover stands before: the nearest wall to its
 * spot, above the opening (and below a window's sill). Its outward normal,
 * level, and how far the spot stands out from it; null if no wall is near.
 */
function facadeAt(queries: TownQueries, c: Cover): { normal: Vector3; out: number } | null {
  // A fan of level rays; the wall most of them meet is the facade (a jamb,
  // a post or a sign is met by a few), and the nearest of its planes wins.
  const hits: { n: Vector3; out: number }[] = [];
  const heights = c.kind === "window" ? [2.4, 0.45] : [2.6];
  for (const h of heights) {
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      from.set(c.exposed.x, c.exposed.y + h, c.exposed.z);
      dir.set(dx, 0, dz);
      const h0 = queries.cast(from, dir, 3, hit);
      if (!h0) continue;
      const n = new Vector3(h0.normal.x, 0, h0.normal.z);
      if (n.lengthSq() < 0.5) continue;
      n.normalize();
      // The perpendicular distance from the spot to that wall's plane.
      const out = -(dx * n.x + dz * n.z) * h0.distance;
      if (out > 0.02) hits.push({ n, out });
    }
  }
  let best: { normal: Vector3; out: number; votes: number } | null = null;
  for (const a of hits) {
    const same = hits.filter((b) => b.n.dot(a.n) > 0.99 && Math.abs(b.out - a.out) < 0.1);
    if (!best || same.length > best.votes || (same.length === best.votes && a.out < best.out)) best = { normal: a.n, out: a.out, votes: same.length };
  }
  return best && best.votes >= 6 ? best : null;
}

/**
 * Where a man stands, just out of sight, to come out of each cover (see
 * Cover.ready): a doorway's threshold, a little inside a window, the edge of
 * a corner or a crate stack, the crouch behind a roof's edge. The clips do
 * the leaning, rising and stepping about that line; what the root travels in
 * view is kept to that short last stretch, instead of the whole way from
 * where he waited - through walls, at a glide.
 */
export function readySpots(covers: readonly Cover[], queries: TownQueries, eye: Vector3): Cover[] {
  return covers.map((c) => ({ ...c, ready: readySpot(c, queries, eye) }));
}

/**
 * From `from` (out of sight) toward `to`, the last place a standing man is
 * still wholly unseen: he walks that far unseen (out through a doorway and
 * across a gallery to where its rail stops hiding him) and is seen only for
 * the rest.
 */
function lastUnseen(queries: TownQueries, eye: Vector3, from: P3, to: P3): P3 {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  let last = from;
  for (let d = 0.05; d < len; d += 0.05) {
    const t = d / len;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
    if (!hiddenFrom(queries, eye, p, STAND)) break;
    last = p;
  }
  return last;
}

function readySpot(c: Cover, queries: TownQueries, eye: Vector3): P3 {
  const e = c.exposed;
  const h = c.hidden;
  const gap = Math.hypot(h.x - e.x, h.z - e.z);
  if (gap < 0.3) return { ...e };
  // Through the opening: straight back from the spot through the facade.
  if (c.kind === "door" || c.kind === "window") {
    const f = facadeAt(queries, c);
    if (f) {
      const back = f.out + (c.kind === "door" ? 0.05 : 0.35);
      const p = { x: e.x - f.normal.x * back, y: e.y, z: e.z - f.normal.z * back };
      // A window's sill is in the way at knee height: the way above it is
      // enough. A door is open under its lintel, and a saloon's swinging
      // doors swing: the way under and over them is.
      if (walkable(queries, e, p, c.kind === "window" ? [1.2, 1.6] : [0.12, 2.0])) return lastUnseen(queries, eye, p, e);
    }
  }
  // Along the way from the exposed spot back to where he waits, the first
  // place he is wholly out of sight (standing, or crouched for a rise), and
  // a hand further, so the clip's own lean starts behind the edge too.
  const heights = c.emerge === "rise" ? CROUCH : STAND;
  const steps = Math.ceil(gap / 0.05);
  for (let i = 1; i <= steps; i++) {
    const t = Math.min(1, i / steps + 0.1 / gap);
    const p = { x: e.x + (h.x - e.x) * t, y: e.y + (h.y - e.y) * t, z: e.z + (h.z - e.z) * t };
    if (hiddenFrom(queries, eye, p, heights)) return p;
  }
  return { ...h };
}
