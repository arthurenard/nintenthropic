/**
 * Every number that shapes how Orbital Decay plays, in one place, in
 * seconds, metres and points. docs/ORBITAL_DECAY.md is the source for the
 * ones it names; the rest were tuned by playing and by the balance tests
 * (balance.test.ts), and the comments say what each one is for.
 */
import type { Difficulty } from "../../../engine/types";

// --- the debris -------------------------------------------------------------

export type Kind = "shrapnel" | "chunk" | "slab" | "shard" | "foil" | "derelict";

export interface KindSpec {
  /** Metres per second, the slowest and the fastest (Standard). */
  speed: readonly [number, number];
  /**
   * Integrity a strike costs the pane at the middle of that speed range;
   * faster costs more, slower less (in proportion to momentum).
   */
  cost: number;
  /** Its size for the rules (metres): roughly half its longest side. */
  radius: number;
  /** What a hit makes of it. */
  splitsInto: Kind | null;
  /** How many pieces (the fewest and the most). */
  pieces: readonly [number, number];
  /** Hits it takes before it goes (a foil wrap takes one to strip). */
  hits: number;
}

export const KINDS: Readonly<Record<Kind, KindSpec>> = {
  // Fist-sized scraps, fast: one shot vaporises one.
  shrapnel: { speed: [18, 30], cost: 8, radius: 0.16, splitsInto: null, pieces: [0, 0], hits: 1 },
  // Pieces of hull the size of a suitcase: a hit splits one into shrapnel that keeps its momentum.
  chunk: { speed: [10, 18], cost: 20, radius: 0.42, splitsInto: "shrapnel", pieces: [2, 3], hits: 1 },
  // A torn panel the size of a door: splits into chunks.
  slab: { speed: [6, 12], cost: 45, radius: 0.95, splitsInto: "chunk", pieces: [2, 3], hits: 1 },
  // A solar panel's shard: thin, light; a hit face-on shatters it.
  shard: { speed: [12, 20], cost: 12, radius: 0.6, splitsInto: null, pieces: [0, 0], hits: 1 },
  // Gold insulation round a dense core: the first hit strips the foil, the second splits the core.
  foil: { speed: [9, 15], cost: 26, radius: 0.46, splitsInto: "shrapnel", pieces: [2, 3], hits: 2 },
  // A dead satellite the size of a car. Its body shrugs off the laser.
  derelict: { speed: [4.6, 5.8], cost: 100, radius: 2.1, splitsInto: "chunk", pieces: [6, 7], hits: 3 },
};

/**
 * A strike's cost scales with the fragment's speed against the middle of
 * its kind's range, within these bounds, so a slow straggler still chips
 * and a fast one never costs a pane twice over.
 */
export const COST_SPEED_RANGE: readonly [number, number] = [0.75, 1.3];

/**
 * Pieces of something on its way to the cupola fly on to where it was
 * going, landing this many metres round its mark: the same pane, a
 * neighbour, the frame, or just past.
 */
export const PIECE_SPREAD: readonly [number, number] = [0.15, 1.3];
/** Pieces of anything else fly apart at this many metres per second on top of its velocity. */
export const SPLIT_KICK: readonly [number, number] = [0.8, 2.4];
/** And from this far out from its centre, as a fraction of its radius. */
export const SPLIT_SPREAD = 0.6;

/**
 * Fragments arrive on gently curving arcs: a steady sideways acceleration
 * of up to this many metres per second squared bends a path.
 */
export const CURVE_ACCEL: readonly [number, number] = [0.15, 0.9];

/**
 * A shard is nearly invisible edge-on and huge face-on: a shot counts only
 * while it turns at least this far toward the player (the cosine of the
 * angle between its face and the line of sight).
 */
export const SHARD_FACE_ON = 0.42;
/** Tumbling, in turns a second: the slowest and fastest. */
export const TUMBLE_RATE: readonly [number, number] = [0.08, 0.45];
/** Shards turn slowly enough to be caught face-on. */
export const SHARD_TUMBLE: readonly [number, number] = [0.12, 0.3];

// --- the Derelict -----------------------------------------------------------

/** Three hits on the tank rupture it. */
export const TANK_HITS = 3;
/** It tumbles end over end, a turn in this many seconds. */
export const DERELICT_TURN = 7;
/** The tank shows (can be shot) while it faces the eye at least this much. */
export const TANK_FACING = 0.18;
/** How far out it comes from. */
export const DERELICT_DEPTH = 118;
/** How far (m) the Derelict's arc may bow from its straight line, at most. */
export const DERELICT_SWAY = 5;
/** Panes it takes if it arrives: the one it strikes and a neighbour. */
export const DERELICT_PANES = 2;

// --- the glass --------------------------------------------------------------

export const PANES = 7;
export const INTEGRITY_MAX = 100;
/** Below this a pane's segment turns red and the master alarm sounds. */
export const ALARM_BELOW = 35;
/** Each breather the crew seals chips: this much back on every pane under full. */
export const CREW_SEAL = 15;
/** A strike this costly or more leaves a crack rather than a chip; this or more a spider web. */
export const CRACK_COST = 14;
export const WEB_COST = 32;

// --- the laser --------------------------------------------------------------

/** Heat added by a shot, as a share of the gauge. */
export const HEAT_PER_SHOT = 0.15;
/** Heat shed every second, once this long has passed since the last shot. */
export const COOL_RATE = 0.2;
export const COOL_DELAY = 0.45;
/** Overheated at the top: locked for this long. */
export const OVERHEAT_LOCK = 2.5;
/** Venting (pointing off the screen, or V) empties the gauge in this long, and cuts a lock short. */
export const VENT_TIME = 0.55;
/** A laser has a rhythm: no two shots closer than this. */
export const SHOT_INTERVAL = 0.11;

// --- the drone --------------------------------------------------------------

/** From this pass on the drone works. */
export const DRONE_FROM_PASS = 3;
/** Flying from the dock (or one pane) to a pane's work spot. */
export const DRONE_FLIGHT = 2.6;
/** Setting up at the pane before the weld starts. */
export const DRONE_SETUP = 0.6;
/** Shot: knocked spinning away, no repairs, for this long. */
export const DRONE_KNOCKED = 12;
/** It leaves a pane for another only when that one is this much worse. */
export const DRONE_SWITCH = 25;

// --- scoring ----------------------------------------------------------------

export const VAPORISE_POINTS = 80;
export const SPLIT_POINTS = 40;
/** The first hit on a foil-wrapped piece, which only strips the wrap. */
export const STRIP_POINTS = 40;
/** Far bonus: ×2 at FAR_FROM metres and beyond, down to ×1 at NEAR_AT. */
export const FAR_FROM = 60;
export const NEAR_AT = 20;
export const TANK_HIT_POINTS = 200;
export const DERELICT_POINTS = 1500;
export const DRONE_PENALTY = 300;
export const NOT_A_SCRATCH_BONUS = 500;
export const GOOD_NEIGHBOUR_BONUS = 250;
/** Accuracy bonus at 100% for a pass; scales linearly with accuracy. */
export const ACCURACY_BONUS_MAX = 500;
/** Consecutive hits for each step of the multiplier (×2 at 3, ×3 at 6, ×4 at 9). */
export const STREAK_STEP = 3;
export const STREAK_MAX_MULTIPLIER = 4;

// --- the passes ---------------------------------------------------------------

/** The title card's time before a pass's debris starts to come. */
export const PASS_INTRO = 2.2;
/** The breather on the night side between passes. */
export const BREATHER = 8;
/** When, in the breather, the crew seals the chips (the sun is down). */
export const SEAL_AT = 3.2;
/** When the next pass's title card slides in. */
export const TITLE_AT = 4.6;
/** Every fifth pass the Derelict comes. */
export const DERELICT_EVERY = 5;
/**
 * A fragment that will miss is let go once it has passed this far behind
 * the plane of the eye, or this long after its closest approach.
 */
export const PASSED_AFTER = 1.2;

// --- difficulty ---------------------------------------------------------------

/**
 * What a difficulty changes. The passes, the debris and the scoring are the
 * same on both: only how fast it comes, how hard it strikes, how early the
 * ring warns, how quickly the laser heats and how fast the drone mends.
 */
export interface DifficultyTuning {
  /** Multiplies every fragment's speed. */
  speedFactor: number;
  /** Multiplies what a strike costs a pane. */
  strikeFactor: number;
  /** Seconds before impact the proximity ring appears. */
  ringLead: number;
  /** Multiplies the heat each shot adds. */
  heatFactor: number;
  /** Integrity per second the drone mends while it works. */
  droneRate: number;
}

/**
 * Standard is the game as designed. Relaxed is for a first evening, a
 * younger player or a tired arm: the same passes and debris, a quarter
 * slower, strikes a third softer, the ring two seconds sooner, a laser that
 * heats more slowly and a drone that mends faster. It is still a game you
 * can lose: stop shooting and a pane fails on either.
 */
export const DIFFICULTY: Readonly<Record<Difficulty, Readonly<DifficultyTuning>>> = {
  standard: { speedFactor: 1, strikeFactor: 1, ringLead: 5, heatFactor: 1, droneRate: 6 },
  relaxed: { speedFactor: 0.75, strikeFactor: 0.7, ringLead: 7, heatFactor: 0.75, droneRate: 9 },
};
