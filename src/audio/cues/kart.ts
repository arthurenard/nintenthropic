/**
 * Grip Prix's sound pack: a toy-box kart racer, every sound synthesised in
 * code like the rest of Handheld. The recipes are in ./kart-motion.ts (what a
 * kart sounds like as it moves), ./kart-events.ts (what happens to it) and
 * ./kart-jingles.ts (the tunes and the interface); this is only the table
 * that says how each is played.
 *
 * Levels are dB at the bus, every take having been normalised to the same
 * loudness first (see ../dsp/master.ts). The mix, in one place:
 *
 *   −1…−4   what the player must not miss: the finish fanfares, the final-lap
 *           jingle, the countdown, being hit, a hazard, starting
 *   −4…−7   the player's own actions: boosts, items, jumps, bumps, walls
 *   −7…−11  sparks, ticks, the crowd, the horn's neighbours
 *   −10…−22 loops: engines (steered by speed and distance), the drift's
 *           squeal, the surface under the wheels, the whistle of a seeker
 *   −9…−13  the interface, soft and short
 *
 * The music (see src/kart/audio/music) plays at about −23 dBFS RMS under all
 * of it: a bed the effects stand on, a little quieter than they are.
 */
import {
  engineBuzz,
  engineGrowl,
  engineIdle,
  enginePutt,
  engineRasp,
  engineWhirr,
  driftScreech,
  droneRotors,
  seekerWhistle,
  surfaceGrass,
  surfaceIce,
  surfaceMud,
  surfaceSand,
  surfaceSnow,
} from "./kart-motion";
import {
  boostPad,
  boostWhoosh,
  boxSmash,
  bump,
  droneDrop,
  fall,
  flood,
  hazard,
  hit,
  itemReady,
  jump,
  land,
  miniTurbo,
  nitroUse,
  puckBounce,
  puckFire,
  rouletteTick,
  slickSplat,
  sparkBlue,
  sparkOrange,
  spinout,
  startBoost,
  trick,
  wallScrape,
  wallThud,
} from "./kart-events";
import { blastWump, cometGlitter, decoyPop, skyrocketBurst, skyrocketLaunch, stormCrack } from "./kart-items";
import {
  beepHigh,
  beepLow,
  cheer,
  duckSqueak,
  finalLap,
  finishOk,
  finishWin,
  horn,
  lapChime,
  uiBack,
  uiJoin,
  uiLeave,
  uiReady,
  uiSelect,
  uiStart,
} from "./kart-jingles";
import type { CueSpec } from "./table";

/**
 * Every kart sound, by name. "ui" cues bypass the world's muffle and are
 * never slowed; the race's own sounds go through "sfx".
 */
export const KART_CUES: Record<string, CueSpec> = {
  // --- engines: loops the game steers (rate = pitch, volume, pan, distance) ---------------------------
  kart_engine_a: { recipe: engineBuzz, pack: "kart", bus: "sfx", level: -13, loop: true, priority: 2, fadeIn: 0.15, fadeOut: 0.2, vary: 0, expect: [0.8, 1.0] },
  kart_engine_b: { recipe: enginePutt, pack: "kart", bus: "sfx", level: -12, loop: true, priority: 2, fadeIn: 0.15, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_engine_c: { recipe: engineWhirr, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.15, fadeOut: 0.2, vary: 0, expect: [0.7, 0.9] },
  kart_engine_d: { recipe: engineRasp, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.15, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_idle: { recipe: engineIdle, pack: "kart", bus: "sfx", level: -15, loop: true, priority: 2, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },
  kart_growl: { recipe: engineGrowl, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },

  // --- the drift and the ground ------------------------------------------------------------------------
  kart_drift: { recipe: driftScreech, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.05, fadeOut: 0.12, vary: 0, expect: [0.5, 0.7] },
  kart_surf_ice: { recipe: surfaceIce, pack: "kart", bus: "sfx", level: -22, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.4, 1.8] },
  kart_surf_snow: { recipe: surfaceSnow, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.6, 2.0] },
  kart_surf_sand: { recipe: surfaceSand, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.5, 1.9] },
  kart_surf_mud: { recipe: surfaceMud, pack: "kart", bus: "sfx", level: -15, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.6, 2.0] },
  kart_surf_grass: { recipe: surfaceGrass, pack: "kart", bus: "sfx", level: -21, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.4, 1.8] },

  // --- sparks and boosts ----------------------------------------------------------------------------------
  kart_spark_blue: { recipe: sparkBlue, pack: "kart", bus: "sfx", level: -9, priority: 2, maxInstances: 4, vary: 0, minGap: 0.05, expect: [0.2, 0.7] },
  kart_spark_orange: { recipe: sparkOrange, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 4, vary: 0, minGap: 0.05, expect: [0.2, 0.8] },
  kart_mini_turbo: { recipe: miniTurbo, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 4, vary: 0.02, minGap: 0.05, expect: [0.3, 0.8] },
  kart_boost_whoosh: { recipe: boostWhoosh, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 4, vary: 0.03, minGap: 0.05, expect: [0.8, 1.5] },
  kart_boost_pad: { recipe: boostPad, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 4, vary: 0.01, minGap: 0.05, expect: [0.4, 1.0] },
  kart_start_boost: { recipe: startBoost, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 4, vary: 0.01, minGap: 0.05, expect: [0.8, 1.6] },
  kart_flood: { recipe: flood, pack: "kart", bus: "sfx", level: -6, priority: 3, maxInstances: 4, vary: 0.04, minGap: 0.1, expect: [0.5, 1.2] },

  // --- item boxes and items ----------------------------------------------------------------------------------
  kart_box_smash: { recipe: boxSmash, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 5, vary: 0.01, minGap: 0.03, expect: [0.4, 1.1] },
  kart_roulette_tick: { recipe: rouletteTick, pack: "kart", bus: "ui", level: -11, priority: 2, maxInstances: 4, vary: 0, minGap: 0.025, expect: [0.04, 0.2] },
  kart_item_ready: { recipe: itemReady, pack: "kart", bus: "ui", level: -4, priority: 3, maxInstances: 4, vary: 0, minGap: 0.1, expect: [0.5, 1.3] },
  kart_nitro: { recipe: nitroUse, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 4, vary: 0.02, minGap: 0.05, expect: [0.6, 1.3] },
  kart_puck_fire: { recipe: puckFire, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 4, vary: 0.03, minGap: 0.05, expect: [0.3, 0.8] },
  kart_puck_bounce: { recipe: puckBounce, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 4, vary: 0.04, minGap: 0.04, expect: [0.2, 0.6] },
  kart_slick_splat: { recipe: slickSplat, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 4, vary: 0.03, minGap: 0.05, expect: [0.4, 1.1] },

  // --- the newer items: a comet's glitter (as long as the comet lasts), a storm, a skyrocket, a blast, a decoy ----------------
  kart_comet: { recipe: cometGlitter, pack: "kart", bus: "sfx", level: -8, priority: 2, maxInstances: 3, vary: 0, expect: [5.8, 6.6] },
  kart_storm: { recipe: stormCrack, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 4, vary: 0.03, minGap: 0.05, expect: [1.8, 2.5] },
  kart_skyrocket: { recipe: skyrocketLaunch, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, expect: [1.4, 2.1] },
  kart_skyrocket_burst: { recipe: skyrocketBurst, pack: "kart", bus: "sfx", level: -2, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, expect: [1.7, 2.4] },
  kart_blast: { recipe: blastWump, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.1, expect: [0.9, 1.5] },
  kart_decoy_pop: { recipe: decoyPop, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 4, vary: 0.02, minGap: 0.05, expect: [1.1, 1.7] },

  // --- hits ---------------------------------------------------------------------------------------------------------
  kart_hit: { recipe: hit, pack: "kart", bus: "sfx", level: -2, priority: 3, maxInstances: 4, vary: 0.02, minGap: 0.08, expect: [0.7, 1.5] },
  kart_spinout: { recipe: spinout, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 4, vary: 0.02, minGap: 0.08, expect: [0.7, 1.4] },
  kart_bump: { recipe: bump, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 4, vary: 0.06, minGap: 0.05, expect: [0.1, 0.6] },
  kart_wall_thud: { recipe: wallThud, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.08, expect: [0.3, 0.9] },
  kart_wall_scrape: { recipe: wallScrape, pack: "kart", bus: "sfx", level: -10, priority: 1, maxInstances: 3, vary: 0.05, minGap: 0.1, expect: [0.3, 0.9] },
  kart_hazard: { recipe: hazard, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 3, vary: 0.03, minGap: 0.1, expect: [0.7, 1.5] },

  // --- the air --------------------------------------------------------------------------------------------------------
  kart_jump: { recipe: jump, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 4, vary: 0.03, minGap: 0.1, expect: [0.3, 0.9] },
  kart_trick: { recipe: trick, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 4, vary: 0, minGap: 0.1, expect: [0.5, 1.2] },
  kart_land: { recipe: land, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 4, vary: 0.04, minGap: 0.1, expect: [0.3, 0.9] },
  kart_fall: { recipe: fall, pack: "kart", bus: "sfx", level: -6, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.2, expect: [1.2, 2.1] },
  kart_drone_drop: { recipe: droneDrop, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 3, vary: 0.02, minGap: 0.1, expect: [0.3, 0.9] },

  // --- countdown, laps, finishing ------------------------------------------------------------------------------------
  kart_beep_low: { recipe: beepLow, pack: "kart", bus: "ui", level: -4, priority: 3, maxInstances: 1, vary: 0, expect: [0.2, 0.6] },
  kart_beep_high: { recipe: beepHigh, pack: "kart", bus: "ui", level: -3, priority: 3, maxInstances: 1, vary: 0, expect: [0.5, 1.2] },
  kart_lap: { recipe: lapChime, pack: "kart", bus: "ui", level: -5, priority: 3, maxInstances: 2, vary: 0, minGap: 0.2, expect: [0.7, 1.6] },
  kart_final_lap: { recipe: finalLap, pack: "kart", bus: "ui", level: -2, priority: 3, maxInstances: 1, vary: 0, minGap: 0.5, expect: [1.5, 2.8] },
  kart_finish_win: { recipe: finishWin, pack: "kart", bus: "ui", level: -1, priority: 3, maxInstances: 1, vary: 0, expect: [2.8, 5] },
  kart_finish_ok: { recipe: finishOk, pack: "kart", bus: "ui", level: -2, priority: 3, maxInstances: 1, vary: 0, expect: [1.8, 3.8] },
  kart_cheer: { recipe: cheer, pack: "kart", bus: "ui", level: -7, priority: 2, maxInstances: 1, vary: 0.02, expect: [2.0, 3.6] },

  // --- loops of the air ---------------------------------------------------------------------------------------------------
  kart_seeker: { recipe: seekerWhistle, pack: "kart", bus: "sfx", level: -11, loop: true, priority: 3, fadeIn: 0.1, fadeOut: 0.15, vary: 0, expect: [0.6, 1.0] },
  kart_drone: { recipe: droneRotors, pack: "kart", bus: "sfx", level: -11, loop: true, priority: 3, fadeIn: 0.15, fadeOut: 0.25, vary: 0, expect: [0.8, 1.2] },

  // --- Handheld's rubber duck, and a horn ---------------------------------------------------------------------------------------
  kart_duck: { recipe: duckSqueak, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 2, vary: 0.03, minGap: 0.2, expect: [0.4, 1.0] },
  kart_horn: { recipe: horn, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, expect: [0.5, 1.2] },

  // --- the interface -----------------------------------------------------------------------------------------------------------
  kart_ui_select: { recipe: uiSelect, pack: "kart", bus: "ui", level: -12, priority: 1, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.1, 0.6] },
  kart_ui_back: { recipe: uiBack, pack: "kart", bus: "ui", level: -13, priority: 1, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.1, 0.6] },
  kart_ui_ready: { recipe: uiReady, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.0] },
  kart_ui_join: { recipe: uiJoin, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.1] },
  kart_ui_leave: { recipe: uiLeave, pack: "kart", bus: "ui", level: -11, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.0] },
  kart_ui_start: { recipe: uiStart, pack: "kart", bus: "ui", level: -6, priority: 3, maxInstances: 1, vary: 0, expect: [0.8, 1.9] },
};
