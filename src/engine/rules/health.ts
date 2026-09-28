/**
 * How health comes back: after how long without a hit, and how fast. Read
 * every frame, so a game may ease the numbers as a round goes on (High
 * Noon's Relaxed does, as the late-wave pressure climbs).
 */
export interface Regeneration {
  /** Seconds without being hit before health starts to come back. */
  regenDelay: number;
  /** Health per second once it does. */
  regenRate: number;
}

/**
 * The defaults: back 3.5 s after the last hit at 40 a second, out of a
 * hundred (High Noon's Standard, where three quick hits of 34 fell you). A
 * game passes its own numbers, usually from its difficulty table.
 */
export const REGENERATION: Readonly<Regeneration> = Object.freeze({ regenDelay: 3.5, regenRate: 40 });
export const HEALTH_MAX = 100;

/**
 * The player's hidden health, Call of Duty style: nothing on screen says a
 * number; the picture itself (red edges, drained colour, a heartbeat) tells
 * you how close you are. It comes back on its own if you stop getting hit.
 */
export class PlayerHealth {
  value: number;
  /** Seconds since the last hit. */
  sinceHit = Number.POSITIVE_INFINITY;
  dead = false;
  /** When true (the dev harness's god mode), hits hurt but never kill. */
  immortal = false;

  constructor(
    private readonly regen: Regeneration = REGENERATION,
    /** Full health. */
    readonly max = HEALTH_MAX,
  ) {
    this.value = max;
  }

  /** 0 when unhurt, 1 at death's door. What the screen's effects follow. */
  get hurt(): number {
    return 1 - this.value / this.max;
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
    const { regenDelay, regenRate } = this.regen;
    if (this.sinceHit >= regenDelay && this.value < this.max) {
      // Only the part of this frame that falls after the delay regenerates, so
      // the refill starts exactly the delay after the hit at any frame rate.
      const regenTime = Math.min(dt, this.sinceHit - regenDelay);
      this.value = Math.min(this.max, this.value + regenRate * regenTime);
    }
  }

  /** Between waves: all of it back at once. */
  heal(): void {
    if (this.dead) return;
    this.value = this.max;
  }
}

/**
 * Where a shot came from, as the HUD's damage arc wants it (HudSink.damage):
 * radians from straight ahead, positive to the right. The player looks down
 * −Z from `eye`, turned by `yaw` about the vertical.
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
