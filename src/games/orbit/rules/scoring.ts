/**
 * Points, the streak multiplier, the pass's bonuses and the numbers for the
 * results card.
 *
 * A "hit" for the streak is a shot that lands on debris (the Derelict's
 * tank included); a shot at nothing while debris is in play is a miss and
 * resets it. The drone is not debris: a shot into it costs points and the
 * streak. Secrets, the breather's sky and the Derelict's armoured body
 * neither build nor break a streak.
 */
import { Streak } from "../../../engine/rules/streak";
import {
  ACCURACY_BONUS_MAX,
  DERELICT_POINTS,
  DRONE_PENALTY,
  FAR_FROM,
  GOOD_NEIGHBOUR_BONUS,
  NEAR_AT,
  NOT_A_SCRATCH_BONUS,
  SPLIT_POINTS,
  STREAK_MAX_MULTIPLIER,
  STREAK_STEP,
  STRIP_POINTS,
  TANK_HIT_POINTS,
  VAPORISE_POINTS,
} from "./tuning";

export interface Award {
  points: number;
  /** The words for the popup, most important first. */
  labels: string[];
  multiplier: number;
}

export interface PassBonuses {
  accuracy: number;
  accuracyPoints: number;
  notAScratch: number;
  goodNeighbour: number;
  total: number;
}

/** ×2 at FAR_FROM metres and beyond, ×1 at NEAR_AT and nearer, straight between. */
export function farBonus(distance: number): number {
  const k = (distance - NEAR_AT) / (FAR_FROM - NEAR_AT);
  return 1 + Math.min(1, Math.max(0, k));
}

export type HitWhat = "vaporise" | "split" | "strip" | "tank" | "breakup";

export class Scorer {
  score = 0;
  private readonly run = new Streak(STREAK_STEP, STREAK_MAX_MULTIPLIER);
  shots = 0;
  hits = 0;
  /** Debris vaporised outright (shrapnel, shards, pieces). */
  vaporised = 0;
  /** Fragments split. */
  splits = 0;
  derelicts = 0;
  droneHits = 0;

  private passShots = 0;
  private passHits = 0;
  private passDamaged = false;
  private passDroneHit = false;

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
    this.passShots++;
    if (!hit) {
      this.run.break();
      return false;
    }
    this.hits++;
    this.passHits++;
    return this.run.hit();
  }

  /** Points for a hit on debris `distance` metres away. */
  hit(what: HitWhat, distance: number): Award {
    const labels: string[] = [];
    let base: number;
    switch (what) {
      case "vaporise":
        base = VAPORISE_POINTS;
        this.vaporised++;
        break;
      case "split":
        base = SPLIT_POINTS;
        this.splits++;
        labels.push("Split");
        break;
      case "strip":
        base = STRIP_POINTS;
        labels.push("Foil");
        break;
      case "tank":
        base = TANK_HIT_POINTS;
        labels.push("Tank");
        break;
      case "breakup":
        base = TANK_HIT_POINTS + DERELICT_POINTS;
        this.derelicts++;
        labels.push("Derelict");
        break;
    }
    // The Derelict's points are its own; distance pays for everything else.
    const far = what === "tank" || what === "breakup" ? 1 : farBonus(distance);
    if (far >= 1.5) labels.push("Far");
    const multiplier = this.multiplier;
    const points = Math.round((base * far) / 10) * 10 * multiplier;
    this.score += points;
    return { points, labels, multiplier };
  }

  /** The drone was shot: points, the streak and this pass's Good Neighbour. */
  drone(): Award {
    this.droneHits++;
    this.passDroneHit = true;
    this.shots++;
    this.passShots++;
    this.run.break();
    this.score = Math.max(0, this.score - DRONE_PENALTY);
    return { points: -DRONE_PENALTY, labels: ["Drone"], multiplier: 1 };
  }

  damaged(): void {
    this.passDamaged = true;
  }

  /** The end of a pass: its bonuses are added to the score and the pass's tallies reset. */
  endPass(): PassBonuses {
    const accuracy = this.passShots === 0 ? 0 : this.passHits / this.passShots;
    const accuracyPoints = Math.round((accuracy * ACCURACY_BONUS_MAX) / 10) * 10;
    const notAScratch = this.passDamaged ? 0 : NOT_A_SCRATCH_BONUS;
    const goodNeighbour = this.passDroneHit ? 0 : GOOD_NEIGHBOUR_BONUS;
    const total = accuracyPoints + notAScratch + goodNeighbour;
    this.score += total;
    this.passShots = 0;
    this.passHits = 0;
    this.passDamaged = false;
    this.passDroneHit = false;
    return { accuracy, accuracyPoints, notAScratch, goodNeighbour, total };
  }
}
