/**
 * The streak multiplier: consecutive hits build it a step at a time, a miss
 * (or whatever a game counts as breaking it) sends it back to ×1. High Noon
 * steps up every three hits to ×4; a game passes its own step and ceiling.
 *
 * What counts as a hit or a miss is the game's call: High Noon's secrets
 * neither build nor break a streak, and shooting a townsperson breaks it.
 */
export class Streak {
  /** Hits in a row now. */
  count = 0;
  /** The longest run this round. */
  best = 0;

  constructor(
    /** Consecutive hits for each step of the multiplier (×2 at `step`, ×3 at twice it...). */
    readonly step = 3,
    readonly maxMultiplier = 4,
  ) {}

  get multiplier(): number {
    return Math.min(this.maxMultiplier, 1 + Math.floor(this.count / this.step));
  }

  /** One more in a row. Returns true if the multiplier went up. */
  hit(): boolean {
    const before = this.multiplier;
    this.count++;
    this.best = Math.max(this.best, this.count);
    return this.multiplier > before;
  }

  /** A miss: back to ×1 (the best run is kept). */
  break(): void {
    this.count = 0;
  }
}

/**
 * The streak's chime climbing a major triad as the multiplier does (×2 the
 * root, ×3 the third, ×4 the fifth), as a playback rate.
 */
export function streakRate(multiplier: number): number {
  const semitones = multiplier >= 4 ? 7 : multiplier === 3 ? 4 : 0;
  return Math.pow(2, semitones / 12);
}
