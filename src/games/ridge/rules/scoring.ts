/**
 * Points. Every hit is worth its kind's points times the distance it was
 * made at (1 + (range − 200) / 400: twice at 600 m), times the One Shot,
 * One Kill streak: consecutive kills with one round each build ×1 to ×4,
 * and a miss or a wound sends it back. A stage ends with its bonuses:
 * accuracy, Ghost (never alerted), Clean Conscience (nobody the valley
 * lives with was hit) and time on the clock of a timed job.
 */
import { Streak } from "../../../engine/rules/streak";
import {
  ACCURACY_BONUS_MAX,
  ANIMAL_PENALTY,
  BODY_KILL_POINTS,
  CIVILIAN_PENALTY,
  CLEAN_CONSCIENCE_BONUS,
  distanceMultiplier,
  DRIVER_POINTS,
  ENGINE_POINTS,
  GHOST_BONUS,
  HEADSHOT_POINTS,
  OFFICER_POINTS,
  SNIPER_POINTS,
  STREAK_MAX,
  STREAK_STEP,
  TIME_BONUS_PER_SECOND,
} from "./tuning";

export interface Award {
  points: number;
  /** What earned it, for the popup: "Headshot", "412 m", "×3". */
  labels: string[];
}

export type KillKind = "headshot" | "body" | "driver" | "sniper" | "officer";

export interface StageBonuses {
  accuracy: number;
  accuracyPoints: number;
  ghost: number;
  cleanConscience: number;
  time: number;
  total: number;
}

/**
 * Not the engine's Scorekeeper, as the other shooters' scorers are: One
 * Shot, One Kill builds its streak from kills made with a single round, not
 * from hits, so the shots, the hits and the streak are counted apart.
 */
export class Scorer {
  score = 0;
  kills = 0;
  headshots = 0;
  shots = 0;
  hits = 0;
  /** The longest kill, metres. */
  longest = 0;
  readonly streak = new Streak(STREAK_STEP, STREAK_MAX);
  /** This stage's shots and hits, for its accuracy bonus. */
  stageShots = 0;
  stageHits = 0;
  /** Someone the valley lives with was hit this stage. */
  stageInnocent = false;

  get multiplier(): number {
    return this.streak.multiplier;
  }

  get accuracy(): number {
    return this.shots > 0 ? this.hits / this.shots : 0;
  }

  get bestStreak(): number {
    return this.streak.best;
  }

  beginStage(): void {
    this.stageShots = 0;
    this.stageHits = 0;
    this.stageInnocent = false;
  }

  shot(): void {
    this.shots++;
    this.stageShots++;
  }

  /** A round that struck what it was meant for (a man, an engine). */
  hit(): void {
    this.hits++;
    this.stageHits++;
  }

  /** A kill: `oneShot` when the man went down to a single round, which builds the streak. */
  kill(kind: KillKind, range: number, oneShot: boolean): Award {
    const base =
      kind === "officer" ? OFFICER_POINTS : kind === "sniper" ? SNIPER_POINTS : kind === "driver" ? DRIVER_POINTS : kind === "headshot" ? HEADSHOT_POINTS : BODY_KILL_POINTS;
    const far = distanceMultiplier(range);
    const mult = this.streak.multiplier;
    const points = Math.round(base * far * mult);
    this.score += points;
    this.kills++;
    if (kind === "headshot") this.headshots++;
    this.longest = Math.max(this.longest, range);
    const labels: string[] = [];
    if (kind === "headshot") labels.push("Headshot");
    else if (kind === "driver") labels.push("Driver");
    else if (kind === "sniper") labels.push("Sniper");
    else if (kind === "officer") labels.push("Officer");
    labels.push(`${Math.round(range)} m`);
    if (mult > 1) labels.push(`×${mult}`);
    if (oneShot) this.streak.hit();
    return { points, labels };
  }

  /** An engine stopped with its third hit. */
  engineStop(range: number): Award {
    const points = Math.round(ENGINE_POINTS * distanceMultiplier(range));
    this.score += points;
    return { points, labels: ["Engine", `${Math.round(range)} m`] };
  }

  /** A round that went wide, or only wounded: the streak starts again. */
  breakStreak(): void {
    this.streak.break();
  }

  civilian(): Award {
    this.score = Math.max(0, this.score - CIVILIAN_PENALTY);
    this.stageInnocent = true;
    this.streak.break();
    return { points: -CIVILIAN_PENALTY, labels: ["Civilian"] };
  }

  animal(name: string): Award {
    this.score = Math.max(0, this.score - ANIMAL_PENALTY);
    this.stageInnocent = true;
    this.streak.break();
    return { points: -ANIMAL_PENALTY, labels: [name] };
  }

  /** The stage's bonuses, added to the score. */
  endStage(neverAlerted: boolean, secondsLeft: number | null): StageBonuses {
    const accuracy = this.stageShots > 0 ? Math.min(1, this.stageHits / this.stageShots) : 0;
    const accuracyPoints = Math.round(ACCURACY_BONUS_MAX * accuracy);
    const ghost = neverAlerted ? GHOST_BONUS : 0;
    const cleanConscience = this.stageInnocent ? 0 : CLEAN_CONSCIENCE_BONUS;
    const time = secondsLeft !== null && secondsLeft > 0 ? Math.round(secondsLeft * TIME_BONUS_PER_SECOND) : 0;
    const total = accuracyPoints + ghost + cleanConscience + time;
    this.score += total;
    return { accuracy, accuracyPoints, ghost, cleanConscience, time, total };
  }
}
