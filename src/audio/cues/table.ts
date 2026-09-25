/**
 * THE cue table: every sound a game can ask for by name, the recipe that
 * synthesises it, and how the engine plays it — which bus, how loud in the
 * mix, how much of the street's echo and the town's reverb, whether it
 * arrives late with distance, how it is varied each time.
 *
 * A new game adds its sounds here (under its own pack, so they are
 * synthesised only when that game loads) and nowhere else.
 *
 * The mix, in one place (dB at the bus, every take normalised to the same
 * loudness first):
 *
 *   0    the player's revolver: the loudest thing in the game
 *  −2    dynamite, the rifle (before distance)
 *  −3    the gang's revolvers (before distance, which takes more)
 *  −5…−8 hits and impacts: clear but under the shot that caused them
 *  −8…−12 the world's events: bell, shutters, doors, animals
 * −16…−22 beds: wind, fuse, trickle, tumbleweed
 * −14…−18 interface: soft, short
 */
import type { Recipe } from "../dsp/take";
import {
  banditShot,
  bulletWhiz,
  reloadSpin,
  revolverCock,
  revolverDry,
  revolverShot,
  ricochet,
  rifleShot,
} from "./guns";

export type BusName = "sfx" | "world" | "ui";
/** Sounds are synthesised a pack at a time: "core" at start, a game's pack when it loads. */
export type Pack = "core" | "western";

export interface CueSpec {
  recipe: Recipe;
  pack: Pack;
  bus: BusName;
  /** Mix level in dB. */
  level: number;
  /** How many takes to synthesise (3 unless a sound needs more variety). */
  takes?: number;
  loop?: boolean;
  /** Play-time random rate variation, ± fraction (0 keeps pitch exact: notes). */
  vary?: number;
  /** Play-time random level variation, ± dB. */
  varyGain?: number;
  /** Send to the town's reverb, 0..1. */
  reverb?: number;
  /** How much of the street's slap-back it gets, 0..1. */
  echo?: number;
  /** Arrives distance / speed-of-sound late (world events; never feedback). */
  travel?: boolean;
  /** Voice stealing: higher survives. 3 player, 2 threats, 1 world, 0 garnish. */
  priority?: number;
  /** At most this many at once; the oldest goes. */
  maxInstances?: number;
  /** A repeat sooner than this (s) is dropped: two identical hits in one frame are one sound. */
  minGap?: number;
  /** Loops: fade in and out (s). */
  fadeIn?: number;
  fadeOut?: number;
  /** A mastering trim in dB, for the rare sound that must sit off the common loudness. */
  trim?: number;
  /** Duration a take must fall in (s), checked by the tests. */
  expect: [number, number];
}

export const CUES: Record<string, CueSpec> = {
  // --- the guns -------------------------------------------------------------
  revolver_shot: {
    recipe: revolverShot, pack: "western", bus: "sfx", level: 0, reverb: 0.22, echo: 1,
    priority: 3, maxInstances: 4, vary: 0.025, takes: 4, expect: [0.6, 1.6],
  },
  revolver_dry: {
    recipe: revolverDry, pack: "western", bus: "sfx", level: -9, reverb: 0.05,
    priority: 3, vary: 0.03, expect: [0.05, 0.4],
  },
  revolver_cock: {
    recipe: revolverCock, pack: "western", bus: "sfx", level: -11, reverb: 0.05,
    priority: 2, vary: 0.03, expect: [0.12, 0.45],
  },
  reload_spin: {
    recipe: reloadSpin, pack: "western", bus: "sfx", level: -9, reverb: 0.06,
    priority: 3, maxInstances: 1, vary: 0.02, expect: [0.7, 1.2],
  },
  bandit_shot: {
    recipe: banditShot, pack: "western", bus: "sfx", level: -3, reverb: 0.3, echo: 1,
    travel: true, priority: 2, maxInstances: 6, vary: 0.04, takes: 4, expect: [0.6, 1.8],
  },
  rifle_shot: {
    recipe: rifleShot, pack: "western", bus: "sfx", level: -2, reverb: 0.3, echo: 1,
    travel: true, priority: 2, maxInstances: 4, vary: 0.03, expect: [0.7, 2.0],
  },
  bullet_whiz: {
    recipe: bulletWhiz, pack: "western", bus: "sfx", level: -6, reverb: 0.08,
    priority: 2, maxInstances: 3, vary: 0.08, minGap: 0.04, expect: [0.2, 0.7],
  },
  ricochet: {
    recipe: ricochet, pack: "western", bus: "sfx", level: -9, reverb: 0.25, echo: 0.5,
    priority: 1, maxInstances: 3, vary: 0.08, expect: [0.3, 1.1],
  },
};

export const CUE_NAMES: readonly string[] = Object.keys(CUES);

export function cuesInPack(pack: Pack): string[] {
  return CUE_NAMES.filter((name) => CUES[name]!.pack === pack);
}
