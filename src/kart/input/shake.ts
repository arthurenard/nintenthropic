/**
 * A shake of the wheel: quick turns left and right, the way it swings
 * reversing at least `SHAKE.reversals` times within `SHAKE.window` seconds.
 * Counted, as item presses are (DriveInput.shakes), so a packet lost or sent
 * twice on the way to the host never loses or doubles one. The sim acts on a
 * shake only in the air or just before a ramp's lip, so steering on the road,
 * however busy, does nothing with it.
 *
 * Fed one number that swings (the wheel's angle in degrees, the keys' -1/0/1,
 * the stick) and the time; `swing` says how far it must go back the other way
 * for a reversal to count, in that number's own units.
 */

export const SHAKE = {
  /** Reversals that make a shake... */
  reversals: 2,
  /** ...within this long, seconds (0.55 missed a person's natural quick turns right, left, right: 0.6 s between reversals). */
  window: 0.7,
  /** No second shake for this long after one, seconds. */
  cooldown: 0.35,
} as const;

export class ShakeCounter {
  /** Shakes so far. */
  count = 0;
  /** Which way the value is swinging: +1 up, -1 down, 0 not yet known. */
  private way = 0;
  /** The furthest it has gone the current way (or, before a way is known, the least and most seen). */
  private extreme = 0;
  private low = Infinity;
  private high = -Infinity;
  private reversals: number[] = [];
  private quietUntil = -Infinity;

  constructor(private readonly swing: number) {}

  /** The value at `t` seconds. */
  push(t: number, value: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(t)) return;
    if (this.way === 0) {
      // From rest, half a swing says which way the first stroke goes (from the middle to one side is half of side to side).
      this.low = Math.min(this.low, value);
      this.high = Math.max(this.high, value);
      if (value - this.low >= this.swing / 2) this.turn(t, 1, value, false);
      else if (this.high - value >= this.swing / 2) this.turn(t, -1, value, false);
      return;
    }
    if (this.way > 0) {
      if (value > this.extreme) this.extreme = value;
      else if (this.extreme - value >= this.swing) this.turn(t, -1, value, true);
    } else {
      if (value < this.extreme) this.extreme = value;
      else if (value - this.extreme >= this.swing) this.turn(t, 1, value, true);
    }
  }

  /** Lets go of the swing so far (the hands went, the wheel was let go): the next stroke starts afresh. */
  reset(): void {
    this.way = 0;
    this.low = Infinity;
    this.high = -Infinity;
    this.reversals.length = 0;
  }

  private turn(t: number, way: number, value: number, reversal: boolean): void {
    this.way = way;
    this.extreme = value;
    if (!reversal) return;
    this.reversals.push(t);
    while (this.reversals.length > 0 && t - this.reversals[0]! > SHAKE.window) this.reversals.shift();
    if (this.reversals.length >= SHAKE.reversals && t >= this.quietUntil) {
      this.count++;
      this.reversals.length = 0;
      this.quietUntil = t + SHAKE.cooldown;
    }
  }
}
