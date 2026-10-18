/**
 * Aim Assist: how forgiving a shot is, in one place for every game that has
 * it (High Noon, Dead of Night, Orbital Decay; Overwatch Ridge is precision
 * by design: its shots are always exact, and the switch only marks the men to
 * find there).
 *
 * Each game's shooter keeps a table of tolerances, `ASSIST`, as fractions of
 * the view's smaller side: a shot that passes this close to a target counts
 * as a hit on it, whatever its distance (raymath.ts's `effectiveRadius`
 * widens the target's real volume to that angle). A finger in the air is
 * not a mouse - the aim check guarantees 95% of shots within 3.5% - so the
 * tables are what make a hand playable at all.
 *
 * The player's Aim Assist setting (`Settings.aimAssist`, on unless they turn
 * it off) scales those tables, read on every shot:
 *
 *   on   the tables grow by ASSIST_BOOST, so the torso's zone is as wide as
 *        the aim check's own 3.5%. The head's grows by the same factor, so a
 *        headshot is as hard to earn, in proportion, as before.
 *   off  no tolerance at all: a shot hits what it really passes through.
 *
 * Three rules hold either way, and are tested (assist.test.ts and each
 * game's shooter tests):
 *
 *   - Innocents (townsfolk, survivors, the friendly drone) get no help, and
 *     a shot that passes near one in front of a target gets none either:
 *     prefer no hit to a wrong hit.
 *   - Secrets are never helped further: their tolerance is not boosted, so
 *     assist does not trigger a secret the player was not aiming at.
 *   - A real hit always beats a near miss, so assist never takes a shot
 *     away from what it was truly on.
 */

/**
 * How much wider Aim Assist makes every target's tolerance, against the
 * game's own table. 2.6% (High Noon's torso) becomes 3.5%, the aim check's
 * own 95% line: a shot aimed at the middle of a bandit lands.
 */
export const ASSIST_BOOST = 1.35;

/** What a game's tolerance table is multiplied by for targets: the boost with Aim Assist on, nothing (exact) off. */
export function assistFactor(on: boolean): number {
  return on ? ASSIST_BOOST : 0;
}

/**
 * The same for secrets: kept as the game has it with Aim Assist on (never
 * boosted, so no secret is triggered by a shot that was not aimed at it),
 * nothing off.
 */
export function secretFactor(on: boolean): number {
  return on ? 1 : 0;
}

/**
 * A tolerance from a game's table (a fraction of the view's smaller side,
 * already scaled by assistFactor or secretFactor) as the angle it spans from
 * the eye through `camera`'s lens: what raymath.ts's `effectiveRadius`
 * widens a target to.
 */
export function assistAngle(camera: { fov: number; aspect: number }, fraction: number): number {
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  return Math.atan(fraction * 2 * tanHalf * Math.min(1, camera.aspect));
}

/** What a game's shooter weighs: one thing a shot passes near or through. */
export interface ShotCandidate {
  kind: string;
  /** Metres along the shot to where it meets it. */
  t: number;
  /** How near the middle of its zone the shot was, 0 (dead centre) to 1 (the edge). */
  score: number;
  /** The shot passes through the thing itself, not only its allowance. */
  physical: boolean;
}

/**
 * Which of the weighed candidates a shot counts as hitting, or none.
 *
 * 1. A real hit on anything wins, the nearest first, if nothing solid
 *    (`stopsAt`: the scenery's distance) is in the way.
 * 2. Otherwise the best near miss: lowest `rank` (what the player means to
 *    shoot first), then the nearest to the middle of its zone. Never an
 *    innocent, and never one behind scenery or behind `guardAt`: the nearest
 *    innocent the shot passed close beside, which takes the help away from
 *    anything farther than it.
 */
export function choose<C extends ShotCandidate>(
  list: readonly C[],
  count: number,
  stopsAt: number,
  rank: (c: C) => number,
  innocent: (c: C) => boolean,
  guardAt = Number.POSITIVE_INFINITY,
): C | null {
  let best: C | null = null;
  for (let i = 0; i < count; i++) {
    const c = list[i] as C;
    if (!c.physical || c.t > stopsAt + 0.1) continue;
    if (!best || c.t < best.t) best = c;
  }
  if (best) return best;
  for (let i = 0; i < count; i++) {
    const c = list[i] as C;
    if (c.physical || innocent(c) || c.t > stopsAt + 0.5 || c.t > guardAt) continue;
    if (!best || rank(c) < rank(best) || (rank(c) === rank(best) && c.score < best.score)) best = c;
  }
  return best;
}
