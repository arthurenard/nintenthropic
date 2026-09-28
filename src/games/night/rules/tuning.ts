/**
 * Every number that shapes how Dead of Night plays, in one place, in
 * seconds, metres, metres per second and points. docs/DEAD_OF_NIGHT.md is
 * the source for the ones it names; the rest were tuned against the balance
 * tests (rules/balance.test.ts) and by playing, and the comments say what
 * each one is for.
 */
import type { Difficulty } from "../../../engine/types";
import type { DeadKind, Gait } from "./types";

// --- the player -------------------------------------------------------------

export const HEALTH_MAX = 100;
/** Seconds without being hurt before health starts to come back. */
export const REGEN_DELAY = 4;
/** Health per second once it does. */
export const REGEN_RATE = 30;

// --- the rifle ----------------------------------------------------------------

/** A lever-action: eight rounds, one in the chamber and seven in the tube. */
export const RIFLE_CAPACITY = 8;
/**
 * Working the lever after a shot: it cannot fire again until the next round
 * is chambered. A little over the thumb's own fold-and-raise, so a steady
 * hand never waits on it, and a frantic one hears it.
 */
export const LEVER_TIME = 0.42;
/** Each round thumbed into the loading gate. */
export const ROUND_TIME = 0.125;
/**
 * A reload that found the chamber empty ends with the lever worked to
 * chamber a round: an empty rifle takes 8 × 0.125 + 0.2 = 1.2 s to load.
 */
export const RELOAD_LEVER = 0.2;

// --- the dead -------------------------------------------------------------------

/** Walking pace, metres per second, before difficulty and the waves: a walker's own is drawn from this range. */
export const WALKER_SPEED: readonly [number, number] = [0.8, 1.2];
/** Each walker's gait keeps its pace within the walker range; these nudge it (a limp is slower than a lurch). */
export const GAIT_PACE: Readonly<Record<Gait, number>> = {
  "walk.shamble": 1,
  "walk.limp": 0.88,
  "walk.drag": 0.8,
  "walk.lurch": 1.1,
};
export const RUNNER_SPEED = 3.5;
export const CRAWLER_SPEED = 0.45;
export const BLOATER_SPEED = 0.6;
export const MECHANIC_SPEED = 0.9;
/** The dead around the Mechanic come faster while he walks. */
export const MECHANIC_AURA = 1.25;

/** Body shots (a limb counts as the body) that drop each kind; a headshot always kills, but for the Mechanic's mask. */
export const BODY_SHOTS: Readonly<Record<DeadKind, number>> = {
  walker: 3,
  runner: 2,
  crawler: 1,
  // A bloater shot in the body bursts: see BLOATER_*.
  bloater: 1,
  mechanic: 8,
};
/** Each body shot staggers one back half a step. */
export const STAGGER_BACK = 0.5;
export const STAGGER_TIME = 0.55;
/** The Mechanic is only slowed: a shorter stagger, and no step back. */
export const MECHANIC_STAGGER = 0.3;
/** Headshots on the welding mask it takes to knock it off (Standard; see DIFFICULTY). */
export const MASK_HITS = 2;

/** Climbing out of the bus and vaulting the fence take this long, over the lane's first stretch. */
export const CLIMB_TIME = 1.6;
export const VAULT_TIME = 1.0;

/** A runner leaps at the barricade from this far out. */
export const LUNGE_RANGE = 2.5;
export const LUNGE_TIME = 0.5;

/** Being at the barricade: the first blow lands this long after arriving, then one every period. */
export interface Attack {
  first: number;
  period: number;
  damage: number;
}
export const ATTACKS: Readonly<Record<Exclude<DeadKind, "bloater">, Attack>> = {
  // A walker claws you for 25 every 1.4 s until it is dead (four quick claws to fall).
  walker: { first: 0.7, period: 1.4, damage: 25 },
  // A runner's lunge takes 20, and it lunges again.
  runner: { first: 0, period: 1.6, damage: 20 },
  // Down at your feet, a crawler claws at the sandbags' foot: less, as often.
  crawler: { first: 0.7, period: 1.4, damage: 15 },
  // The tyre iron, overhead.
  mechanic: { first: 0.9, period: 1.8, damage: 40 },
};
/** A bloater bursting at the barricade takes 60 (and nothing else: it was too close). */
export const BLOATER_BURST_DAMAGE = 60;
/** Shot and burst, a bloater downs everything within this many metres of it (the Mechanic shrugs it off). */
export const CHAIN_RADIUS = 3;
/** How long a body takes to go down, and a bloater to burst. */
export const DEATH_TIME = 1.2;

// --- survivors ------------------------------------------------------------------

/** A survivor's run across the road, metres per second. */
export const SURVIVOR_SPEED = 4.3;

// --- scoring ------------------------------------------------------------------

export const HEADSHOT_KILL = 150;
export const BODY_KILL = 60;
export const CRAWLER_KILL = 100;
export const RUNNER_BONUS = 50;
/** A kill beyond this many metres bought road: ×1.5. */
export const FAR_KILL = 30;
export const FAR_MULTIPLIER = 1.5;
/** A bloater's burst: this for every one of the dead it catches. */
export const CHAIN_BONUS = 100;
export const MASK_BONUS = 100;
export const MECHANIC_KILL = 1000;
export const SURVIVOR_PENALTY = 300;
export const UNTOUCHED_BONUS = 500;
export const CLEAN_HANDS_BONUS = 250;
/** Accuracy bonus at 100% for a wave; it scales linearly with accuracy. */
export const ACCURACY_BONUS_MAX = 500;
/** Consecutive hits for each step of the multiplier (×2 at 3, ×3 at 6, ×4 at 9). */
export const STREAK_STEP = 3;
export const STREAK_MAX_MULTIPLIER = 4;

// --- the waves --------------------------------------------------------------------

/** The title card's time before the first wave's dead start to come. */
export const WAVE_INTRO = 2;
/** The breather between waves: the fog thins, the bell counts, health comes back. */
export const BREATHER = 6;
export const MECHANIC_EVERY = 6;

// --- difficulty -------------------------------------------------------------------

/**
 * What a difficulty changes. The road, the waves, the dead and the scoring
 * are the same on both: only how fast the dead come, how hard they hurt,
 * how soon the player recovers, how thick the fog is, how long a bloater
 * swells before it bursts on you, the Mechanic's mask, and how soon a long
 * wave turns against you.
 */
export interface DifficultyTuning {
  /** Multiplies every one of the dead's pace. */
  speedFactor: number;
  /** Multiplies what a claw, a lunge, a swing or a burst takes off you (rounded to whole points). */
  damageFactor: number;
  /** Seconds without being hurt before health starts to come back. */
  regenDelay: number;
  /** Health per second once it does. */
  regenRate: number;
  /** Multiplies the fog's density: how far into it the road can be read. */
  fogFactor: number;
  /** How long a bloater at the barricade swells before it bursts: the moment to shoot it. */
  burstWarning: number;
  /** Headshots it takes to knock the Mechanic's mask off. */
  maskHits: number;
  /**
   * The late-wave pressure. boldAfter seconds after the last of a wave has
   * come out of the fog, the fog thickens and the dead quicken, climbing by
   * boldRate a second to boldMax times their pace: a wave dragged on (a
   * crawler forgotten on the road, the dead left walking in the fog) turns
   * against the player.
   */
  boldAfter: number;
  boldRate: number;
  boldMax: number;
}

/**
 * Standard is the game as designed. Relaxed is for a first evening, a
 * younger player or a tired arm: the dead walk a quarter slower and claw
 * for 20 instead of 25 (five quick claws to fall, not four), health comes
 * back after 3 s at 40 a second, the fog is a little thinner, a bloater
 * swells for longer at the barricade before it bursts, and one shot takes
 * the Mechanic's mask off. As a wave drags on, the pressure wears these
 * allowances away toward Standard's, so it is still a night you can lose.
 */
export const DIFFICULTY: Readonly<Record<Difficulty, Readonly<DifficultyTuning>>> = {
  standard: {
    speedFactor: 1,
    damageFactor: 1,
    regenDelay: REGEN_DELAY,
    regenRate: REGEN_RATE,
    fogFactor: 1,
    burstWarning: 0.8,
    maskHits: MASK_HITS,
    boldAfter: 25,
    boldRate: 0.02,
    boldMax: 1.45,
  },
  relaxed: {
    speedFactor: 0.75,
    // 25 becomes 20: five claws in quick succession to fall.
    damageFactor: 0.8,
    regenDelay: 3,
    regenRate: 40,
    fogFactor: 0.85,
    burstWarning: 1.8,
    maskHits: 1,
    boldAfter: 40,
    boldRate: 0.013,
    boldMax: 1.45,
  },
};

/** The numbers a difficulty's allowances wear toward, as a long wave's pressure climbs. */
export const WORN: readonly (keyof DifficultyTuning)[] = ["speedFactor", "damageFactor", "regenDelay", "regenRate", "fogFactor", "burstWarning"];
