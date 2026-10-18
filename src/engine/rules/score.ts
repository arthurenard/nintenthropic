import { Streak } from "./streak";

/**
 * The part of a game's Scorer that every shooter whose streak is a run of
 * hits keeps the same way (High Noon, Dead of Night, Orbital Decay): the
 * score, the shots and hits its accuracy is worked out from, a round's own
 * (a wave's, a pass's) for that round's accuracy bonus, and the streak
 * multiplier a run of hits builds. A game's Scorer extends it with what its
 * points are for; what counts as a shot, and what breaks the streak besides a
 * miss, is the game's call.
 */
export class Scorekeeper {
  score = 0;
  shots = 0;
  hits = 0;
  /** Consecutive hits, a step of the multiplier at a time. */
  protected readonly run: Streak;
  private roundShots = 0;
  private roundHits = 0;

  constructor(step: number, maxMultiplier: number) {
    this.run = new Streak(step, maxMultiplier);
  }

  get multiplier(): number {
    return this.run.multiplier;
  }

  get streak(): number {
    return this.run.count;
  }

  get bestStreak(): number {
    return this.run.best;
  }

  get accuracy(): number {
    return this.shots === 0 ? 0 : this.hits / this.shots;
  }

  /** A shot that counts toward accuracy, and whether it hit. Returns true if the multiplier went up. */
  shot(hit: boolean): boolean {
    this.shots++;
    this.roundShots++;
    if (!hit) {
      this.run.break();
      return false;
    }
    this.hits++;
    this.roundHits++;
    return this.run.hit();
  }

  /**
   * The end of a round: its accuracy, and the bonus for it (`max` for every
   * shot a hit, rounded to tens so the popup reads cleanly). The round's
   * shots and hits start again.
   */
  protected endRound(max: number): { accuracy: number; accuracyPoints: number } {
    const accuracy = this.roundShots === 0 ? 0 : this.roundHits / this.roundShots;
    const accuracyPoints = Math.round((accuracy * max) / 10) * 10;
    this.roundShots = 0;
    this.roundHits = 0;
    return { accuracy, accuracyPoints };
  }
}
