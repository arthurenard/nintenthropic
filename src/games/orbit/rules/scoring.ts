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
import { Scorekeeper } from "../../../engine/rules/score";
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

export class Scorer extends Scorekeeper {
  /** Debris vaporised outright (shrapnel, shards, pieces). */
  vaporised = 0;
  /** Fragments split. */
  splits = 0;
  derelicts = 0;
  droneHits = 0;

  private passDamaged = false;
  private passDroneHit = false;

  constructor() {
    super(STREAK_STEP, STREAK_MAX_MULTIPLIER);
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
    // A shot that counts, and a miss: the streak is broken.
    this.shot(false);
    this.score = Math.max(0, this.score - DRONE_PENALTY);
    return { points: -DRONE_PENALTY, labels: ["Drone"], multiplier: 1 };
  }

  damaged(): void {
    this.passDamaged = true;
  }

  /** The end of a pass: its bonuses are added to the score and the pass's tallies reset. */
  endPass(): PassBonuses {
    const { accuracy, accuracyPoints } = this.endRound(ACCURACY_BONUS_MAX);
    const notAScratch = this.passDamaged ? 0 : NOT_A_SCRATCH_BONUS;
    const goodNeighbour = this.passDroneHit ? 0 : GOOD_NEIGHBOUR_BONUS;
    const total = accuracyPoints + notAScratch + goodNeighbour;
    this.score += total;
    this.passDamaged = false;
    this.passDroneHit = false;
    return { accuracy, accuracyPoints, notAScratch, goodNeighbour, total };
  }
}
