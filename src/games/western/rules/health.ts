import { HEALTH_MAX, REGEN_DELAY, REGEN_RATE } from "./tuning";

/**
 * The player's hidden health, Call of Duty style: nothing on screen says a
 * number; the picture itself (red edges, drained colour, a heartbeat) tells
 * you how close you are. It comes back on its own if you stop getting hit.
 */
export class PlayerHealth {
  value = HEALTH_MAX;
  /** Seconds since the last hit. */
  sinceHit = Number.POSITIVE_INFINITY;
  dead = false;
  /** When true (the dev harness's god mode), hits hurt but never kill. */
  immortal = false;

  /** 0 when unhurt, 1 at death's door. What the screen's effects follow. */
  get hurt(): number {
    return 1 - this.value / HEALTH_MAX;
  }

  /** Take a hit; returns true if it was the one that killed. */
  hit(amount: number): boolean {
    if (this.dead || amount <= 0) return false;
    this.value = Math.max(0, this.value - amount);
    this.sinceHit = 0;
    if (this.value <= 0) {
      if (this.immortal) {
        this.value = 1;
        return false;
      }
      this.dead = true;
      return true;
    }
    return false;
  }

  update(dt: number): void {
    if (this.dead) return;
    this.sinceHit += dt;
    if (this.sinceHit >= REGEN_DELAY && this.value < HEALTH_MAX) {
      // Only the part of this frame that falls after the delay regenerates, so
      // the refill starts exactly 3.5 s after the hit at any frame rate.
      const regenTime = Math.min(dt, this.sinceHit - REGEN_DELAY);
      this.value = Math.min(HEALTH_MAX, this.value + REGEN_RATE * regenTime);
    }
  }

  /** Between waves: all of it back at once. */
  heal(): void {
    if (this.dead) return;
    this.value = HEALTH_MAX;
  }
}

/**
 * Where a shot came from, as the HUD's damage arc wants it: radians from
 * straight ahead, positive to the right. The player looks down −Z from `eye`.
 */
export function damageDirection(
  eye: { x: number; z: number },
  yaw: number,
  from: { x: number; z: number },
): number {
  const dx = from.x - eye.x;
  const dz = from.z - eye.z;
  // atan2(right, forward) with forward = −Z: straight ahead is 0, right is +.
  const world = Math.atan2(dx, -dz);
  let a = world + yaw;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
