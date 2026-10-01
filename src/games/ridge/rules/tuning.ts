/**
 * Every number that shapes how Overwatch Ridge plays, in one place, in
 * seconds, metres, metres per second and points. docs/OVERWATCH_RIDGE.md is
 * the source for the ones it names; the rest were tuned by playing and by
 * the balance simulations (balance.test.ts), and the comments say what each
 * one is for.
 */
import type { Difficulty } from "../../../engine/types";

// --- the rifle ------------------------------------------------------------------

/** Rounds in the internal magazine (a stripper clip's worth). */
export const MAGAZINE = 5;
/** Working the bolt after a shot: up, back, forward, down. */
export const BOLT_TIME = 0.6;
/** A clip stripped in through the open action. */
export const RELOAD_TIME = 2;

// --- the round in flight (see ballistics.ts) ----------------------------------

/** Muzzle velocity, m/s. */
export const MUZZLE_VELOCITY = 600;
/**
 * Drag, per metre travelled: the round's speed falls as e^(−k·x). Chosen so
 * the times of flight are the design's: 0.4 s to 250 m, 1.2 s to 700 m.
 */
export const DRAG = 1.0e-4;
/** The rifle is zeroed here: a round crosses the line of sight at 150 m. */
export const ZERO_RANGE = 150;
/** The design's drop: a round held dead on falls this far below the line at 600 m. */
export const DROP_AT_600 = 1.6;
/**
 * How strongly a crosswind carries the round aside: drift = WIND_DRIFT ×
 * wind × (time of flight)². The shape is the physical one (the round lags
 * the air it passes through); the strength is the game's, so that a strong
 * wind moves a shot at 600 m by about a man's width and a half.
 */
export const WIND_DRIFT = 0.165;
/** How far a round is followed before it is let go, metres. */
export const MAX_RANGE = 2600;
/**
 * From the hip, without the scope, the rifle is not held to the eye: a shot
 * wanders this much (radians, a standard deviation each way). Beyond 200 m
 * it is hopeless, which is the point.
 */
export const HIP_SPREAD = 0.0065;
/**
 * The windshield turns a round a little as it goes through (radians, a
 * standard deviation each way): a driver is hit where he is aimed at, or near it.
 */
export const GLASS_DEFLECTION = 0.00035;

// --- the scope ----------------------------------------------------------------

export const SCOPE_POWER = 6;
/** The view closing in to the scope's power. */
export const SCOPE_IN_TIME = 0.3;
export const SCOPE_OUT_TIME = 0.2;
/** Through the scope the hand pans the view at this fraction of its gain. */
export const SCOPE_PAN_GAIN = 0.25;
/** The breath's sway, in milliradians, when the hand is moving and when it has been still a while. */
export const SWAY_MOVING = 0.55;
export const SWAY_STILL = 0.22;
/** How long the hand must be still for the sway to settle. */
export const SWAY_SETTLE = 1;

// --- the player -----------------------------------------------------------------

export const HEALTH_MAX = 100;
/** Seconds without being hit before health comes back, and how fast it does. */
export const REGEN_DELAY = 4;
export const REGEN_RATE = 30;
/** What each enemy's hit takes. */
export const SNIPER_DAMAGE = 45;
export const MG_DAMAGE = 20;
export const MORTAR_NEAR_DAMAGE = 15;
export const MORTAR_HIT_DAMAGE = 50;

// --- the alert --------------------------------------------------------------------

/**
 * The valley's alert, 0 (quiet) to 1 (alerted), per stage. Each report of
 * the rifle heard across the valley adds this; a miss landing near a
 * hostile adds up to MISS_NEAR more, falling off to nothing at MISS_RADIUS.
 * A wounded man, a body found or a civilian shot alerts the valley outright.
 */
export const REPORT_ALERT = 0.2;
export const MISS_NEAR_ALERT = 0.4;
export const MISS_RADIUS = 12;
/** A round cracking this close past a man startles him on his own, before the valley wakes. */
export const STARTLE_RADIUS = 5;
/** How far a hostile sees a body, metres, and how long he takes to notice it. */
export const BODY_SEEN_RADIUS = 30;
export const BODY_NOTICE: readonly [number, number] = [2.5, 4.5];
/** Below the alert, suspicion fades this much a second while nothing happens. */
export const ALERT_DECAY = 0.025;
/** Sound's speed: the valley hears a shot this long after it is taken, per metre. */
export const SPEED_OF_SOUND = 343;

// --- the enemy's fire ---------------------------------------------------------------

/** The counter-sniper: hidden, then scanning the ridge (his glint flickers), then aiming (it holds). */
export const SNIPER_HIDDEN: readonly [number, number] = [3, 6];
export const SNIPER_SCAN: readonly [number, number] = [2.5, 4.5];
/** His first shot comes no sooner than this into the stage: time to look for him. */
export const SNIPER_FIRST_SHOT = 9;
/** His chance of finding you with his first shot, how it grows with each shot, and its ceiling. */
export const SNIPER_HIT_CHANCE = 0.42;
export const SNIPER_HIT_GROWTH = 0.14;
export const SNIPER_HIT_MAX = 0.85;
/** Once a shot has found you he stays on you: his next comes this long after (and its glint before it). */
export const SNIPER_FOLLOW_UP = 1.4;
/** After a miss he goes to ground; this often he moves to another nest while hidden. */
export const SNIPER_RELOCATE = 0.45;

/** Machine-gunners, once the valley is alerted: a burst every so often, which finds you this often. */
export const MG_INTERVAL: readonly [number, number] = [3.2, 5.2];
export const MG_HIT_CHANCE = 0.3;
/** How long after the alert the first burst comes. */
export const MG_FIRST: readonly [number, number] = [1.5, 3];

/** Mortars, on alert stages: a round every so often, how long it flies, and where it lands. */
export const MORTAR_INTERVAL: readonly [number, number] = [9, 13];
export const MORTAR_FLIGHT = 6.5;
export const MORTAR_HIT_CHANCE = 0.14;
export const MORTAR_NEAR_CHANCE = 0.5;
/** The whistle of an incoming round starts this long before it lands. */
export const MORTAR_WHISTLE = 1.6;

/** A bullet crosses the valley faster than its sound: the crack by your ear arrives at this speed. */
export const ENEMY_BULLET_SPEED = 780;

// --- people and machines ------------------------------------------------------------

export const WALK_SPEED = 1.4;
export const PATROL_SPEED = 1.1;
export const RUN_SPEED = 4;
export const CYCLE_SPEED = 4.5;
export const FARMER_SPEED = 0.9;
/** How long a wounded man kneels before he crawls for cover (he can still be finished). */
export const WOUND_KNEEL = 2.5;
/** A driver shot, or an engine dead, brings a vehicle to a stop over this many metres. */
export const ROLL_OUT = 14;
/** Hits on an engine block that stop it. */
export const ENGINE_HITS = 3;
/** Soldiers jumping down from a stopped truck, one after another. */
export const DISMOUNT_GAP = 0.55;
export const DISMOUNT_TIME = 1;
/** Seconds the officer spends on the dam before he walks to his jeep. */
export const OFFICER_INSPECT = 24;
/** The officer's jeep, m/s on the dam road. */
export const JEEP_SPEED = 6;
/** The officer, alerted, makes for his jeep at a brisk walk: an officer does not run. */
export const OFFICER_HURRY = 2.2;

// --- stages -------------------------------------------------------------------------

/** The title card's time before a stage's people move. */
export const STAGE_INTRO = 2.2;
/** The breather between stages. */
export const BREATHER = 6;
/** The convoy's lead truck reaches the bridge this long after it sets off. */
export const CONVOY_TIME = 40;
/** How much road the convoy has to cover to the bridge, metres. */
export const CONVOY_ROAD = 190;
/** The convoy halts this long at the checkpoint's barrier on its way. */
export const CONVOY_HALT = 5;
/** A failed job's last moment (the convoy over the bridge) before the results. */
export const FAIL_HOLD = 3.2;

// --- the spotter ----------------------------------------------------------------------

/**
 * A man 300 m away is a few pixels tall in the wide view, and a newcomer
 * has no way to know where to look. The spotter marks where the job's men
 * are while the view is wide: on every difficulty for the first stages (the
 * stages that teach), and on Relaxed throughout (DifficultyTuning.spotter).
 * Later, on Standard, he only speaks - and marks - once the fight is this
 * many seconds old with no one yet in the glass.
 */
export const SPOTTER_STAGES = 2;
export const SPOTTER_FIRST = 8;
export const SPOTTER_DELAY = 14;
/** A scope that has looked at nothing this long (and no one found yet) is told which way to turn, and again no sooner than this many seconds later. */
export const SPOTTER_LOST = 5;
export const SPOTTER_REPEAT = 10;

// --- scoring --------------------------------------------------------------------------

export const HEADSHOT_POINTS = 150;
export const BODY_KILL_POINTS = 80;
export const DRIVER_POINTS = 250;
export const ENGINE_POINTS = 300;
export const SNIPER_POINTS = 500;
export const OFFICER_POINTS = 800;
export const CIVILIAN_PENALTY = 500;
export const ANIMAL_PENALTY = 100;
export const GHOST_BONUS = 500;
export const CLEAN_CONSCIENCE_BONUS = 250;
/** Accuracy bonus at 100% for a stage, scaled linearly with the stage's accuracy. */
export const ACCURACY_BONUS_MAX = 300;
/** Points for every second left on a timed job's clock. */
export const TIME_BONUS_PER_SECOND = 10;
/** The One Shot, One Kill streak: ×1 to ×4, a step for every kill with one round. */
export const STREAK_STEP = 1;
export const STREAK_MAX = 4;
/** Distance pays: every hit is worth 1 + (range − 200) / 400 times its points. */
export function distanceMultiplier(range: number): number {
  return Math.max(1, 1 + (range - 200) / 400);
}

// --- difficulty ----------------------------------------------------------------------

/**
 * What a difficulty changes. The valley, the stages and the scoring are the
 * same on both: only the help in the scope, the wind's strength, the
 * counter-sniper's warning, how fast the valley grows suspicious, the
 * timed jobs' clocks and how hard a hit is.
 */
export interface DifficultyTuning {
  /** The holdover dot in the scope: where the round will land at the range under the reticle. */
  holdoverDot: boolean;
  /** The spotter's marks over the job's men while the view is wide, in every stage (otherwise the first stages' only). */
  spotter: boolean;
  /** The strongest the wind blows, m/s. */
  maxWind: number;
  /** How long the counter-sniper's scope glints steadily before he fires, seconds. */
  sniperGlint: number;
  /** Multiplies every rise of the alert short of an outright one. */
  alertFactor: number;
  /** Multiplies a timed job's time (the convoy's drive, the officer's inspection and drive). */
  timeFactor: number;
  /** Multiplies what a hit takes off you. */
  damageFactor: number;
}

/**
 * Standard is the game as designed. Relaxed marks the men to find while the
 * view is wide, puts a holdover dot in the scope (the drop and the wind
 * worked out for you), keeps the wind under
 * 4 m/s, lets the counter-sniper's glint show twice as long, lets the
 * valley grow suspicious more slowly, gives the timed jobs a third more
 * time, and softens every hit by a quarter.
 */
export const DIFFICULTY: Readonly<Record<Difficulty, Readonly<DifficultyTuning>>> = {
  standard: {
    holdoverDot: false,
    spotter: false,
    maxWind: 8,
    sniperGlint: 1.1,
    alertFactor: 1,
    timeFactor: 1,
    damageFactor: 1,
  },
  relaxed: {
    holdoverDot: true,
    spotter: true,
    maxWind: 4,
    sniperGlint: 2.2,
    alertFactor: 0.6,
    timeFactor: 4 / 3,
    damageFactor: 0.75,
  },
};
