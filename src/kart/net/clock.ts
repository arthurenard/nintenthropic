/**
 * Turns the real time that passed between frames into whole fixed ticks, so a
 * 144 Hz screen and a 30 Hz one run the same race at the same speed.
 */
import { TICK } from "../contract";

export class TickClock {
  private last: number | null = null;
  private owed = 0;

  /** Forget the past: the next call starts counting from its own `now`. */
  reset(): void {
    this.last = null;
    this.owed = 0;
  }

  /**
   * The whole ticks to run for a frame at `now` (milliseconds), at most `max`.
   * Time beyond that is dropped, not queued: a device that fell far behind
   * (a stalled tab) should skip ahead, not spend a second catching up.
   */
  ticks(now: number, max: number): number {
    if (this.last === null) {
      this.last = now;
      return 0;
    }
    const dt = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.owed += dt;
    const whole = Math.min(max, Math.floor(this.owed / TICK + 1e-9));
    this.owed -= whole * TICK;
    // At the cap, whole ticks still owed are forgotten; only the part of a tick carries on.
    if (whole === max) this.owed %= TICK;
    return whole;
  }
}
