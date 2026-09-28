import { Streak } from "../../../engine/rules/streak";
import {
  ACCURACY_BONUS_MAX,
  BOSS_BOUNTY,
  CLEAN_HANDS_BONUS,
  DYNAMITE_AIR_BONUS,
  HEADSHOT_BONUS,
  KILL_POINTS,
  QUICK_DRAW_BONUS,
  RUNNER_BONUS,
  STREAK_MAX_MULTIPLIER,
  STREAK_STEP,
  TOWNSFOLK_PENALTY,
  UNTOUCHABLE_BONUS,
} from "./tuning";

export interface KillFacts {
  headshot: boolean;
  quickDraw: boolean;
  runner: boolean;
  boss: boolean;
  /** Killed by a blast rather than a bullet. */
  blast: boolean;
}

export interface Award {
  points: number;
  /** The words for the popup, most important first: "Headshot", "Quick Draw". */
  labels: string[];
  multiplier: number;
}

export interface WaveBonuses {
  accuracy: number;
  accuracyPoints: number;
  untouchable: number;
  cleanHands: number;
  total: number;
}

/**
 * Points, the streak multiplier, and the numbers for the results card.
 *
 * A "hit" for the streak is a shot that lands on a bandit or a stick of
 * dynamite; a shot into the scenery is a miss and resets it. Shots at the
 * town's secrets (the bell, the chicken...) are neither: secrets are never
 * in the way, so they neither build nor break a streak nor count in accuracy.
 */
export class Scorer {
  score = 0;
  /** Consecutive hits: ×2 at three, ×3 at six, ×4 at nine. */
  private readonly run = new Streak(STREAK_STEP, STREAK_MAX_MULTIPLIER);
  shots = 0;
  hits = 0;
  kills = 0;
  headshots = 0;
  townsfolkHit = 0;

  private waveShots = 0;
  private waveHits = 0;
  private waveDamaged = false;
  private waveInnocentHit = false;

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
    this.waveShots++;
    if (!hit) {
      this.run.break();
      return false;
    }
    this.hits++;
    this.waveHits++;
    return this.run.hit();
  }

  kill(facts: KillFacts): Award {
    const labels: string[] = [];
    let points = KILL_POINTS;
    if (facts.boss) {
      points += BOSS_BOUNTY;
      labels.push("Black Jack");
    }
    if (facts.headshot) {
      points += HEADSHOT_BONUS;
      labels.push("Headshot");
    }
    if (facts.quickDraw) {
      points += QUICK_DRAW_BONUS;
      labels.push("Quick Draw");
    }
    if (facts.runner) {
      points += RUNNER_BONUS;
      labels.push("Runner");
    }
    if (facts.blast) labels.push("Blast");
    this.kills++;
    if (facts.headshot) this.headshots++;
    const multiplier = this.multiplier;
    points *= multiplier;
    this.score += points;
    return { points, labels, multiplier };
  }

  dynamiteInAir(): Award {
    const multiplier = this.multiplier;
    const points = DYNAMITE_AIR_BONUS * multiplier;
    this.score += points;
    return { points, labels: ["Dynamite"], multiplier };
  }

  /** An innocent was shot: points, the streak and this wave's Clean Hands. */
  innocent(): Award {
    this.townsfolkHit++;
    this.waveInnocentHit = true;
    this.run.break();
    const lost = Math.min(this.score, TOWNSFOLK_PENALTY);
    this.score -= lost;
    return { points: -TOWNSFOLK_PENALTY, labels: ["Townsperson"], multiplier: 1 };
  }

  damaged(): void {
    this.waveDamaged = true;
  }

  /** The end of a wave: its bonuses are added to the score and the wave's tallies reset. */
  endWave(): WaveBonuses {
    const accuracy = this.waveShots === 0 ? 0 : this.waveHits / this.waveShots;
    // Rounded to tens so the popup reads cleanly.
    const accuracyPoints = Math.round((accuracy * ACCURACY_BONUS_MAX) / 10) * 10;
    const untouchable = this.waveDamaged ? 0 : UNTOUCHABLE_BONUS;
    const cleanHands = this.waveInnocentHit ? 0 : CLEAN_HANDS_BONUS;
    const total = accuracyPoints + untouchable + cleanHands;
    this.score += total;
    this.waveShots = 0;
    this.waveHits = 0;
    this.waveDamaged = false;
    this.waveInnocentHit = false;
    return { accuracy, accuracyPoints, untouchable, cleanHands, total };
  }
}
