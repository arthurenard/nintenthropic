/**
 * Every number that shapes how High Noon plays, in one place, in seconds,
 * metres and points. docs/HIGH_NOON.md is the source for the ones it names;
 * the rest were tuned by playing, and the comments say what each one is for.
 */

// --- the player -------------------------------------------------------------

export const HEALTH_MAX = 100;
/** Seconds without being hit before health starts to come back. */
export const REGEN_DELAY = 3.5;
/** Health per second once it does. */
export const REGEN_RATE = 40;

export const REVOLVER_CAPACITY = 6;
export const RELOAD_TIME = 0.9;

// --- scoring ----------------------------------------------------------------

export const KILL_POINTS = 100;
export const HEADSHOT_BONUS = 50;
export const QUICK_DRAW_BONUS = 100;
/** A kill this soon after the bandit showed himself is a Quick Draw. */
export const QUICK_DRAW_WINDOW = 0.5;
export const RUNNER_BONUS = 50;
export const DYNAMITE_AIR_BONUS = 150;
/** Black Jack's bounty on top of the kill. */
export const BOSS_BOUNTY = 500;
export const TOWNSFOLK_PENALTY = 200;
export const UNTOUCHABLE_BONUS = 500;
export const CLEAN_HANDS_BONUS = 250;
/** Accuracy bonus at 100% for a wave; scales linearly with accuracy. */
export const ACCURACY_BONUS_MAX = 500;
/** Consecutive hits needed for each step of the multiplier (x2 at 3, x3 at 6, x4 at 9). */
export const STREAK_STEP = 3;
export const STREAK_MAX_MULTIPLIER = 4;

// --- the gang ---------------------------------------------------------------

/** How long each way of coming out of cover takes, and going back. */
export const EMERGE_TIME = { lean_left: 0.3, lean_right: 0.3, rise: 0.4, step_out: 0.5 } as const;
export const HIDE_TIME = { lean_left: 0.25, lean_right: 0.25, rise: 0.35, step_out: 0.45 } as const;
/** The give-away before a bandit shows himself: a shadow, a creak, dust. */
export const TELL_TIME: readonly [number, number] = [0.45, 0.8];
/** Time spent out of sight between appearances. */
export const HIDDEN_WAIT: readonly [number, number] = [0.8, 2.5];
/** How long the sun glints on the barrel before the shot. */
export const GLINT_LEAD = 0.4;
export const FIRE_RECOVER = 0.3;
/** No two bandit shots closer than this, so every shot can be read and heard. */
export const MIN_SHOT_GAP = 0.45;
/**
 * Just after a hit, the gang's aim is shaken for a moment. Three hits in
 * quick succession still kill; three hits in the same instant never do.
 */
export const HIT_GRACE = 0.6;
export const HIT_GRACE_FACTOR = 0.55;
/**
 * The longer a wave drags on, the bolder the gang. Past BOLD_AFTER seconds of
 * fighting their hit chance climbs by BOLD_RATE per second, up to BOLD_MAX
 * times its wave's figure: regeneration keeps a player alive through a fair
 * fight, but one who stops shooting is overrun rather than kept alive for ever.
 */
export const BOLD_AFTER = 25;
export const BOLD_RATE = 0.04;
export const BOLD_MAX = 2.2;
/** Relocating while hidden, metres per second behind the facades. */
export const RELOCATE_SPEED = 3.5;
export const RELOCATE_CHANCE = 0.4;
export const ADJACENT_RADIUS = 12;
export const RUN_SPEED = 6.5;
export const RUN_CHANCE = 0.5;

/** Riflemen: slower to aim, harder hitting, and the rifle keeps its accuracy at range. */
export const RIFLE_AIM_FACTOR = 1.6;
export const RIFLE_DAMAGE_FACTOR = 1.5;
export const BOSS_AIM_FACTOR = 0.8;
export const BOSS_HEALTH = 3;
/** When Black Jack ducks, this many of his men come out to cover him. */
export const BOSS_COVER_FIRE = 2;

export const STAGGER_TIME = 0.45;
export const DEATH_TIME = 1.3;
export const FALL_DEATH_TIME = 1.6;

// --- dynamite ---------------------------------------------------------------

export const LIGHT_TIME = 0.7;
export const THROW_TIME = 0.5;
/** When, in the throw, the stick leaves the hand. */
export const THROW_RELEASE = 0.3;
export const DYNAMITE_RANGE = 38;
/** Seconds between landing and the bang: a bounce, a roll, a fizz. */
export const DYNAMITE_GROUND_FUSE = 0.55;
/** A dropped stick (its thrower shot) goes off this long after hitting the ground. */
export const DYNAMITE_DROP_FUSE = 0.5;
export const DYNAMITE_BLAST_RADIUS = 4.5;
export const DYNAMITE_PLAYER_RADIUS = 6;
export const DYNAMITE_DAMAGE = 55;
export const GRAVITY = 9.81;

// --- the waves --------------------------------------------------------------

export const INTERMISSION = 4;
/** The title card's time before the first wave's gang starts to move. */
export const WAVE_INTRO = 1.6;
export const BOSS_WAVE_EVERY = 5;

// --- townsfolk --------------------------------------------------------------

export const TOWNSFOLK_OUT: readonly [number, number] = [3.5, 5];
export const TOWNSFOLK_PEEK = 0.6;
export const HANDS_UP_TIME = 1.6;

// --- the duel (High Noon for real) -------------------------------------------

export const DUEL_PACES = 10;
export const DUEL_PACE_TIME = 0.55;
export const DUEL_STANDOFF = 2.8;
/** After the bell, how long he takes to draw and fire. */
export const DUEL_DRAW = 0.95;
