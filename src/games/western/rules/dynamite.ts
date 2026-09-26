import type { V3 } from "./raymath";
import { DYNAMITE_GROUND_FUSE, GRAVITY } from "./tuning";

export type DynamiteState = "flying" | "landed" | "dropped" | "exploded";

/**
 * A lit stick of dynamite on a ballistic arc from the thrower's hand to a
 * spot just in front of the player. The arc is solved for a flight time, so
 * the stick always takes long enough to be seen and shot, whatever the range.
 */
export class Dynamite {
  readonly start: V3 = { x: 0, y: 0, z: 0 };
  readonly target: V3 = { x: 0, y: 0, z: 0 };
  readonly velocity: V3 = { x: 0, y: 0, z: 0 };
  readonly position: V3 = { x: 0, y: 0, z: 0 };
  state: DynamiteState = "flying";
  flightTime = 1;
  /** Seconds since release (or since it was dropped). */
  age = 0;
  /** Seconds left before it goes off once on the ground. */
  fuse = DYNAMITE_GROUND_FUSE;
  /** Which bandit threw it, for the blast's credits and his own demise. */
  throwerId = -1;
  constructor(readonly id: number) {}

  /** Launch from `start` to land on `target` after `flightTime` seconds. */
  launch(start: V3, target: V3, flightTime: number): this {
    copy(this.start, start);
    copy(this.target, target);
    copy(this.position, start);
    this.flightTime = flightTime;
    solveArc(start, target, flightTime, this.velocity);
    this.state = "flying";
    this.age = 0;
    this.fuse = DYNAMITE_GROUND_FUSE;
    return this;
  }

  /** Drop at the feet (its thrower was shot with it lit in his hand). */
  drop(at: V3, fuse: number): this {
    copy(this.start, at);
    copy(this.target, at);
    copy(this.position, at);
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.state = "dropped";
    this.age = 0;
    this.fuse = fuse;
    return this;
  }

  /** Advance; returns true on the frame it should explode. */
  update(dt: number): boolean {
    if (this.state === "exploded") return false;
    this.age += dt;
    if (this.state === "flying") {
      if (this.age >= this.flightTime) {
        copy(this.position, this.target);
        this.state = "landed";
        this.fuse -= this.age - this.flightTime;
      } else {
        arcPoint(this.start, this.velocity, this.age, this.position);
      }
      return false;
    }
    this.fuse -= dt;
    if (this.fuse <= 0) {
      this.state = "exploded";
      return true;
    }
    return false;
  }

  /** In the air, where a bullet can meet it. */
  get airborne(): boolean {
    return this.state === "flying";
  }
}

function copy(out: V3, v: V3): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}

/** The launch velocity that carries a body from `a` to `b` in `time` seconds under gravity. */
export function solveArc(a: V3, b: V3, time: number, out: V3): V3 {
  out.x = (b.x - a.x) / time;
  out.z = (b.z - a.z) / time;
  out.y = (b.y - a.y + 0.5 * GRAVITY * time * time) / time;
  return out;
}

export function arcPoint(a: V3, v: V3, t: number, out: V3): V3 {
  out.x = a.x + v.x * t;
  out.y = a.y + v.y * t - 0.5 * GRAVITY * t * t;
  out.z = a.z + v.z * t;
  return out;
}

/** Flight time for a throw over `distance` metres: long enough to see and shoot it. */
export function flightTimeFor(distance: number): number {
  return Math.min(2.2, Math.max(1.3, distance / 14));
}
