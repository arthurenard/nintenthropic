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
import {
  bodyFall,
  bottleBreak,
  glassBreak,
  hitDirt,
  hitFlesh,
  hitGlass,
  hitHeadshot,
  hitMetal,
  hitWater,
  hitWood,
  playerHurt,
  shutterBang,
  woodSplinter,
} from "./impacts";
import {
  bellToll,
  churchDoorCreak,
  doorCreak,
  dynamiteExplode,
  dynamiteFuse,
  dynamiteThrow,
  feathers,
  posterFlutter,
  spurs,
  tumbleweedRoll,
  vaneSpin,
  waterLeak,
  wind,
} from "./world";
import {
  banditDeath,
  chickenCluck,
  chickenSquawk,
  crowCaw,
  deathPlayer,
  dogBarkDistant,
  heartbeat,
  heartbeatBeat,
  horseNeigh,
} from "./creatures";
import {
  bossIntro,
  duelWhistle,
  gameOver,
  goldenUnlock,
  pianoNote,
  pianoTune,
  quickDraw,
  secretFound,
  slowmoBoom,
  streakUp,
  waveClear,
  waveStart,
} from "./music";
import { calibDone, calibHit, uiConfirm, uiTap } from "./ui";
import { NIGHT_CUES } from "./night";
import { ORBIT_CUES } from "./orbit";

/** piano_note_1 … piano_note_8: G major pentatonic, G4 to B5 (see PIANO_SCALE). */
const pianoNotes: Record<string, CueSpec> = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8].map((k) => [
    `piano_note_${k}`,
    {
      recipe: pianoNote(k), pack: "western", bus: "world", level: -10, reverb: 0.25,
      priority: 1, maxInstances: 6, vary: 0, expect: [1.0, 2.2],
    } satisfies CueSpec,
  ]),
);

/**
 * sfx: the fight. world: the town. ui: the interface (never muffled or
 * slowed). self: inside the player's head — the heartbeat, the death —
 * which the hurt muffle and duck do not touch.
 */
export type BusName = "sfx" | "world" | "ui" | "self";
/** Sounds are synthesised a pack at a time: "core" at start, a game's pack when it loads. */
export type Pack = "core" | "western" | "night" | "orbit";

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
  /** Not slowed by slow motion: sounds made to accompany it (the death, its boom, the stingers). */
  steady?: boolean;
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

  // --- hits: the player's feedback, never delayed by distance ----------------
  hit_flesh: {
    recipe: hitFlesh, pack: "western", bus: "sfx", level: -6, reverb: 0.12, echo: 0.2,
    priority: 3, maxInstances: 4, vary: 0.06, minGap: 0.03, expect: [0.15, 0.5],
  },
  hit_headshot: {
    recipe: hitHeadshot, pack: "western", bus: "sfx", level: -4, reverb: 0.15, echo: 0.3,
    priority: 3, maxInstances: 3, vary: 0.04, minGap: 0.03, expect: [0.2, 0.6],
  },
  hit_wood: {
    recipe: hitWood, pack: "western", bus: "sfx", level: -7, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 4, vary: 0.07, minGap: 0.025, expect: [0.15, 0.6],
  },
  hit_dirt: {
    recipe: hitDirt, pack: "western", bus: "sfx", level: -9, reverb: 0.12, echo: 0.2,
    priority: 1, maxInstances: 4, vary: 0.08, minGap: 0.025, expect: [0.2, 0.7],
  },
  hit_metal: {
    recipe: hitMetal, pack: "western", bus: "sfx", level: -8, reverb: 0.2, echo: 0.4,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.4, 1.3],
  },
  hit_glass: {
    recipe: hitGlass, pack: "western", bus: "sfx", level: -8, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.2, 0.8],
  },
  hit_water: {
    recipe: hitWater, pack: "western", bus: "sfx", level: -9, reverb: 0.15, echo: 0.2,
    priority: 1, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  player_hurt: {
    recipe: playerHurt, pack: "western", bus: "sfx", level: -3, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.04, minGap: 0.05, expect: [0.4, 1.0],
  },
  body_fall: {
    recipe: bodyFall, pack: "western", bus: "sfx", level: -10, reverb: 0.2, echo: 0.3,
    travel: true, priority: 1, maxInstances: 4, vary: 0.05, takes: 4, expect: [0.4, 1.2],
  },

  // --- breakage ----------------------------------------------------------------
  glass_break: {
    recipe: glassBreak, pack: "western", bus: "sfx", level: -7, reverb: 0.2, echo: 0.4,
    priority: 2, maxInstances: 3, vary: 0.05, expect: [0.8, 1.8],
  },
  bottle_break: {
    recipe: bottleBreak, pack: "western", bus: "sfx", level: -7, reverb: 0.2, echo: 0.3,
    priority: 2, maxInstances: 4, vary: 0.06, minGap: 0.02, expect: [0.3, 1.0],
  },
  wood_splinter: {
    recipe: woodSplinter, pack: "western", bus: "sfx", level: -8, reverb: 0.2, echo: 0.4,
    priority: 2, maxInstances: 3, vary: 0.06, expect: [0.3, 0.9],
  },
  shutter_bang: {
    recipe: shutterBang, pack: "western", bus: "world", level: -7, reverb: 0.3, echo: 0.8,
    travel: true, priority: 1, maxInstances: 2, vary: 0.05, expect: [0.3, 1.1],
  },

  // --- dynamite ------------------------------------------------------------------
  dynamite_fuse: {
    recipe: dynamiteFuse, pack: "western", bus: "sfx", level: -14, loop: true, reverb: 0.05,
    priority: 2, fadeIn: 0.05, fadeOut: 0.08, vary: 0.04, expect: [1.5, 2.5],
  },
  dynamite_throw: {
    recipe: dynamiteThrow, pack: "western", bus: "sfx", level: -12, reverb: 0.1,
    priority: 2, vary: 0.06, expect: [0.4, 1.0],
  },
  dynamite_explode: {
    recipe: dynamiteExplode, pack: "western", bus: "sfx", level: -2, reverb: 0.3, echo: 1,
    travel: true, priority: 3, maxInstances: 3, vary: 0.05, expect: [1.5, 3.6],
  },

  // --- the town ------------------------------------------------------------------
  wind: {
    recipe: wind, pack: "western", bus: "world", level: -18, loop: true,
    priority: 0, fadeIn: 2.5, fadeOut: 2.0, vary: 0.02, expect: [6, 8],
  },
  bell_toll: {
    recipe: bellToll, pack: "western", bus: "world", level: -8, reverb: 0.35, echo: 0.8,
    travel: true, priority: 1, maxInstances: 3, vary: 0.005, expect: [4, 7],
  },
  church_door_creak: {
    recipe: churchDoorCreak, pack: "western", bus: "world", level: -11, reverb: 0.3, echo: 0.3,
    travel: true, priority: 1, maxInstances: 1, vary: 0.03, expect: [1.5, 3.2],
  },
  door_creak: {
    recipe: doorCreak, pack: "western", bus: "world", level: -11, reverb: 0.25, echo: 0.2,
    travel: true, priority: 0, maxInstances: 2, vary: 0.06, expect: [0.6, 1.8],
  },
  vane_spin: {
    recipe: vaneSpin, pack: "western", bus: "world", level: -12, reverb: 0.3, echo: 0.2,
    travel: true, priority: 1, maxInstances: 1, vary: 0.03, expect: [2.5, 4.5],
  },
  water_leak: {
    recipe: waterLeak, pack: "western", bus: "world", level: -15, loop: true, reverb: 0.15,
    priority: 0, fadeIn: 0.4, fadeOut: 1.0, vary: 0.03, expect: [2.5, 3.6],
  },
  tumbleweed_roll: {
    recipe: tumbleweedRoll, pack: "western", bus: "world", level: -15, loop: true, reverb: 0.1,
    priority: 0, fadeIn: 0.6, fadeOut: 1.2, vary: 0.05, expect: [2, 4.5],
  },
  spurs: {
    recipe: spurs, pack: "western", bus: "world", level: -12, reverb: 0.2,
    travel: true, priority: 0, maxInstances: 2, vary: 0.04, expect: [1.2, 3.0],
  },
  poster_flutter: {
    recipe: posterFlutter, pack: "western", bus: "world", level: -12, reverb: 0.2,
    priority: 1, maxInstances: 1, vary: 0.05, expect: [0.9, 2.0],
  },
  feathers: {
    recipe: feathers, pack: "western", bus: "world", level: -14, reverb: 0.15,
    priority: 1, maxInstances: 2, vary: 0.08, expect: [0.5, 1.2],
  },

  // --- creatures -------------------------------------------------------------------
  bandit_death: {
    recipe: banditDeath, pack: "western", bus: "sfx", level: -11, reverb: 0.2, echo: 0.2,
    travel: true, priority: 1, maxInstances: 3, vary: 0.05, takes: 4, minGap: 0.1, expect: [0.2, 1.3],
  },
  chicken_cluck: {
    recipe: chickenCluck, pack: "western", bus: "world", level: -11, reverb: 0.15,
    travel: true, priority: 0, maxInstances: 1, vary: 0.06, expect: [0.2, 1.4],
  },
  chicken_squawk: {
    recipe: chickenSquawk, pack: "western", bus: "world", level: -8, reverb: 0.2, echo: 0.3,
    travel: true, priority: 1, maxInstances: 1, vary: 0.05, expect: [0.6, 1.3],
  },
  horse_neigh: {
    recipe: horseNeigh, pack: "western", bus: "world", level: -10, reverb: 0.3, echo: 0.4,
    travel: true, priority: 0, maxInstances: 1, vary: 0.04, expect: [1.2, 2.0],
  },
  crow_caw: {
    recipe: crowCaw, pack: "western", bus: "world", level: -13, reverb: 0.3, echo: 0.3,
    travel: true, priority: 0, maxInstances: 1, vary: 0.06, expect: [0.5, 1.6],
  },
  dog_bark_distant: {
    recipe: dogBarkDistant, pack: "western", bus: "world", level: -15, reverb: 0.2,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.8, 2.2],
  },

  // --- the player's body -------------------------------------------------------------
  heartbeat: {
    recipe: heartbeat, pack: "core", bus: "self", level: -8, loop: true, steady: true,
    priority: 3, fadeIn: 0.3, fadeOut: 0.6, vary: 0, expect: [0.7, 1.0],
  },
  heartbeat_beat: {
    recipe: heartbeatBeat, pack: "core", bus: "self", level: -9, steady: true,
    priority: 3, vary: 0.01, expect: [0.3, 0.8],
  },
  death_player: {
    recipe: deathPlayer, pack: "western", bus: "self", level: -4, reverb: 0.1, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 3.8],
  },

  // --- music: the saloon piano and the stingers (pitch exact: vary 0) ------------------
  ...pianoNotes,
  piano_tune: {
    recipe: pianoTune, pack: "western", bus: "world", level: -10, reverb: 0.25,
    priority: 1, maxInstances: 1, vary: 0, expect: [5, 9],
  },
  wave_start: {
    recipe: waveStart, pack: "western", bus: "sfx", steady: true, level: -7, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2.5, 5.5],
  },
  wave_clear: {
    recipe: waveClear, pack: "western", bus: "sfx", steady: true, level: -9, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 4],
  },
  boss_intro: {
    recipe: bossIntro, pack: "western", bus: "sfx", steady: true, level: -7, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [3.5, 7.5],
  },
  duel_whistle: {
    recipe: duelWhistle, pack: "western", bus: "sfx", steady: true, level: -8, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [4, 8.5],
  },
  quick_draw: {
    recipe: quickDraw, pack: "western", bus: "ui", level: -11,
    priority: 2, maxInstances: 2, vary: 0, expect: [0.5, 1.3],
  },
  streak_up: {
    recipe: streakUp, pack: "western", bus: "ui", level: -13,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 0.9],
  },
  secret_found: {
    recipe: secretFound, pack: "western", bus: "ui", level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 2.6],
  },
  golden_unlock: {
    recipe: goldenUnlock, pack: "western", bus: "ui", level: -9,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4],
  },
  game_over: {
    recipe: gameOver, pack: "western", bus: "ui", level: -9,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 6],
  },
  /** Internal: the boom under setFilter("slowmo"). */
  slowmo_boom: {
    recipe: slowmoBoom, pack: "core", bus: "sfx", level: -6, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [1.5, 3.5],
  },

  // --- the interface: soft and short -----------------------------------------------------
  ui_tap: {
    recipe: uiTap, pack: "core", bus: "ui", level: -20,
    priority: 1, maxInstances: 2, vary: 0.02, minGap: 0.03, expect: [0.03, 0.15],
  },
  ui_confirm: {
    recipe: uiConfirm, pack: "core", bus: "ui", level: -17,
    priority: 1, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.2, 0.6],
  },
  calib_hit: {
    recipe: calibHit, pack: "core", bus: "ui", level: -16,
    priority: 2, maxInstances: 3, vary: 0, minGap: 0.03, expect: [0.2, 0.6],
  },
  calib_done: {
    recipe: calibDone, pack: "core", bus: "ui", level: -14,
    priority: 2, maxInstances: 1, vary: 0, expect: [0.6, 1.6],
  },
  ...NIGHT_CUES,

  // --- Orbital Decay (./orbit.ts) -------------------------------------------------------
  ...ORBIT_CUES,
};

export const CUE_NAMES: readonly string[] = Object.keys(CUES);

export function cuesInPack(pack: Pack): string[] {
  return CUE_NAMES.filter((name) => CUES[name]!.pack === pack);
}
