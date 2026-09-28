import { Streak } from "../../../engine/rules/streak";
import {
  ACCURACY_BONUS_MAX,
  BODY_KILL,
  CHAIN_BONUS,
  CLEAN_HANDS_BONUS,
  CRAWLER_KILL,
  FAR_KILL,
  FAR_MULTIPLIER,
  HEADSHOT_KILL,
  MASK_BONUS,
  MECHANIC_KILL,
  RUNNER_BONUS,
  STREAK_MAX_MULTIPLIER,
  STREAK_STEP,
  SURVIVOR_PENALTY,
  UNTOUCHED_BONUS,
} from "./tuning";
import type { DeadKind } from "./types";

export interface KillFacts {
  kind: DeadKind;
  headshot: boolean;
  /** Metres from the eye (horizontal). */
  distance: number;
}

export interface Award {
  points: number;
  /** The words for the popup, most important first: "Headshot", "Runner". */
  labels: string[];
  multiplier: number;
}

export interface WaveBonuses {
  accuracy: number;
  accuracyPoints: number;
  untouched: number;
  cleanHands: number;
  total: number;
}

/**
 * Points, the streak multiplier, and the numbers for the results card.
 *
 * A "hit" for the streak is a shot that lands on one of the dead; a shot
 * into the road, the corn or the fog is a miss and resets it, and so does
 * a survivor shot. Shots at the night's secrets (the sign, the moon, the
 * duck...) are neither: secrets are never in the way, so they neither build
 * nor break a streak nor count in accuracy.
 */
export class Scorer {
  score = 0;
  private readonly run = new Streak(STREAK_STEP, STREAK_MAX_MULTIPLIER);
  shots = 0;
  hits = 0;
  kills = 0;
  headshots = 0;
  survivorsHit = 0;

  private waveShots = 0;
  private waveHits = 0;
  private waveHurt = false;
  private waveSurvivorHit = false;

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

  /**
   * One of the dead down by the player's hand: a headshot 150, a body kill
   * 60, a crawler 100 however it was hit, a runner 50 more, the Mechanic
   * 1000; a kill beyond 30 m bought road, ×1.5; then the streak.
   */
  kill(facts: KillFacts): Award {
    const labels: string[] = [];
    let points: number;
    if (facts.kind === "mechanic") {
      points = MECHANIC_KILL;
      labels.push("The Mechanic");
      if (facts.headshot) labels.push("Headshot");
    } else if (facts.kind === "crawler") {
      points = CRAWLER_KILL;
      labels.push("Crawler");
    } else {
      points = facts.headshot ? HEADSHOT_KILL : BODY_KILL;
      if (facts.headshot) labels.push("Headshot");
    }
    if (facts.kind === "runner") {
      points += RUNNER_BONUS;
      labels.push("Runner");
    }
    if (facts.distance > FAR_KILL) {
      points *= FAR_MULTIPLIER;
      labels.push("Long Shot");
    }
    this.kills++;
    if (facts.headshot) this.headshots++;
    const multiplier = this.multiplier;
    points = Math.round(points * multiplier);
    this.score += points;
    return { points, labels, multiplier };
  }

  /** A bloater's burst caught `count` of the dead: 100 each, with the streak. */
  chain(count: number): Award {
    this.kills += count;
    const multiplier = this.multiplier;
    const points = CHAIN_BONUS * count * multiplier;
    this.score += points;
    return { points, labels: [`Chain ×${count}`], multiplier };
  }

  /** The Mechanic's mask knocked off. */
  mask(): Award {
    const multiplier = this.multiplier;
    const points = MASK_BONUS * multiplier;
    this.score += points;
    return { points, labels: ["Mask Off"], multiplier };
  }

  /** A survivor shot: points, the streak and this wave's Clean Hands. */
  survivor(): Award {
    this.survivorsHit++;
    this.waveSurvivorHit = true;
    this.run.break();
    this.score -= Math.min(this.score, SURVIVOR_PENALTY);
    return { points: -SURVIVOR_PENALTY, labels: ["Survivor"], multiplier: 1 };
  }

  hurt(): void {
    this.waveHurt = true;
  }

  /** The end of a wave: accuracy, Untouched, Clean Hands; the wave's tallies start again. */
  endWave(): WaveBonuses {
    const accuracy = this.waveShots === 0 ? 0 : this.waveHits / this.waveShots;
    // Rounded to tens so the popup reads cleanly.
    const accuracyPoints = Math.round((accuracy * ACCURACY_BONUS_MAX) / 10) * 10;
    const untouched = this.waveHurt ? 0 : UNTOUCHED_BONUS;
    const cleanHands = this.waveSurvivorHit ? 0 : CLEAN_HANDS_BONUS;
    const total = accuracyPoints + untouched + cleanHands;
    this.score += total;
    this.waveShots = 0;
    this.waveHits = 0;
    this.waveHurt = false;
    this.waveSurvivorHit = false;
    return { accuracy, accuracyPoints, untouched, cleanHands, total };
  }
}
