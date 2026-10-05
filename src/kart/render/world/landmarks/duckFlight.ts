/**
 * The rubber duck's day out. When a kart finds it (the sim's `duck` event) it
 * squeaks, turns round, and flies off over the fence; a while later it comes
 * paddling back from behind to where it was, facing the road again.
 *
 * `duckPose` is a pure function of the seconds since it took off, so the
 * whole day is tested without a scene; the duck's model (common.ts) asks it
 * every frame. The take-off time lives here, in one place, because there is
 * one duck in a world and the picture's renderer is what hears the event.
 */

/** The day's timetable, seconds from the squeak. */
export const DUCK_DAY = {
  /** The squeak: a squash and a hop. */
  squeak: 0.35,
  /** Airborne until here. */
  flying: 3.4,
  /** Out of sight until here... */
  away: 12,
  /** ...then paddling back until here. */
  home: 23,
  /** How far it flies off (metres, away from the road), and how high. */
  range: 140,
  height: 36,
  /** Where it starts paddling from (metres behind its place). */
  from: 70,
} as const;

export interface DuckPose {
  visible: boolean;
  /** Offsets from where it floats, in its own frame: x to its left, y up, z the way it faces at rest (towards the road). */
  x: number;
  y: number;
  z: number;
  /** Radians. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Vertical squash for the squeak, 1 at rest. */
  squash: number;
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * Where the duck is `elapsed` seconds after it was found, or null once it is
 * back to its usual self (the bobbing the model does by itself). `t` is the
 * ordinary clock, for the wobble in its wings and paddling.
 */
export function duckPose(elapsed: number, t: number): DuckPose | null {
  const d = DUCK_DAY;
  if (!(elapsed >= 0) || elapsed >= d.home) return null;
  const rest: DuckPose = { visible: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, squash: 1 };

  if (elapsed < d.squeak) {
    // A squeak: squashed, then stretched as it hops, then up it goes.
    const k = elapsed / d.squeak;
    return { ...rest, y: 1.2 * Math.sin(Math.PI * k), squash: 1 - 0.22 * Math.sin(Math.PI * Math.min(1, k * 1.6)) + 0.1 * smooth(k - 0.5), yaw: Math.PI * smooth(k) };
  }
  if (elapsed < d.flying) {
    // Off over the fence, away from the road (tail to the road: it has turned), climbing, flapping.
    const f = (elapsed - d.squeak) / (d.flying - d.squeak);
    return {
      ...rest,
      yaw: Math.PI,
      z: -d.range * f * f,
      y: 1.2 + d.height * smooth(f) + 1.4 * Math.sin(elapsed * 17),
      x: 6 * Math.sin(f * 3),
      pitch: -0.5 * smooth(f * 1.5),
      roll: 0.45 * Math.sin(elapsed * 15),
    };
  }
  if (elapsed < d.away) return { ...rest, visible: false };

  // Paddling home from behind, slowing as it arrives, rocking a little with each stroke.
  const g = (elapsed - d.away) / (d.home - d.away);
  const left = 1 - smooth(g);
  return {
    ...rest,
    z: -d.from * left,
    y: 0.12 * Math.sin(t * 5) * left,
    roll: 0.1 * Math.sin(t * 3.2) * left,
    pitch: 0.05 * Math.sin(t * 5.4) * left,
    yaw: 0.25 * Math.sin(t * 1.3) * left,
  };
}

/** When the duck took off, on the world's clock, or -Infinity. */
let tookOff = -Infinity;

/** The duck was found at world time `t`. False (and nothing changes) while it is already away. */
export function flyDuck(t: number): boolean {
  if (t - tookOff < DUCK_DAY.home) return false;
  tookOff = t;
  return true;
}

/** A new world or a new race: the duck is home. */
export function resetDuck(): void {
  tookOff = -Infinity;
}

/** The duck's pose at world time `t` (see duckPose), or null when it is just bobbing. */
export function duckAt(t: number): DuckPose | null {
  return duckPose(t - tookOff, t);
}
