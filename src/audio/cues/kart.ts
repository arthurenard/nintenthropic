/**
 * Grip Prix's sound pack: a toy-box kart racer, every sound synthesised in
 * code like the rest of Super Claude Bros. The recipes are in
 * ./kart-motion.ts (what a kart sounds like as it moves), ./kart-events.ts
 * (what happens to it), ./kart-items.ts (five of the items) and
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
  ambBird,
  ambBleep,
  ambBreeze,
  ambBubble,
  ambCreak,
  ambCrowd,
  ambDing,
  ambGull,
  ambHawk,
  ambHum,
  ambLava,
  ambRumble,
  ambWater,
} from "./kart-ambience";
import {
  engineElectricHi,
  engineElectricLo,
  engineGrit,
  engineGrowl,
  engineHeavyHi,
  engineHeavyLo,
  engineIdle,
  engineLightHi,
  engineLightLo,
  engineMiddleHi,
  engineMiddleLo,
  driftScreech,
  driftSparks,
  droneRotors,
  seekerWhistle,
  surfaceGrass,
  surfaceIce,
  surfaceMud,
  surfaceSand,
  surfaceSnow,
  tyreRoad,
  windRush,
} from "./kart-motion";
import {
  backfire,
  boostPad,
  boostWhoosh,
  boxSmash,
  bump,
  droneDrop,
  fall,
  flood,
  heavyLanding,
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
  slingshot,
  sparkBlue,
  sparkOrange,
  spinout,
  startBoost,
  superTurbo,
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
  placeDown,
  placeUp,
  shutter,
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
  // Each engine twice, low and high in its revs (src/kart/audio/engines.ts crosses them over), all equally loud.
  kart_engine_light_lo: { recipe: engineLightLo, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_light_hi: { recipe: engineLightHi, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_middle_lo: { recipe: engineMiddleLo, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_middle_hi: { recipe: engineMiddleHi, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_heavy_lo: { recipe: engineHeavyLo, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_heavy_hi: { recipe: engineHeavyHi, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_electric_lo: { recipe: engineElectricLo, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_engine_electric_hi: { recipe: engineElectricHi, pack: "kart", bus: "sfx", level: -10, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  // The rasp of a working engine, steered with the load (the player's own karts only).
  kart_engine_grit: { recipe: engineGrit, pack: "kart", bus: "sfx", level: -16, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_idle: { recipe: engineIdle, pack: "kart", bus: "sfx", level: -15, loop: true, priority: 2, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },
  kart_growl: { recipe: engineGrowl, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },

  // --- the drift and the ground ------------------------------------------------------------------------
  kart_drift: { recipe: driftScreech, pack: "kart", bus: "sfx", level: -12, loop: true, priority: 2, fadeIn: 0.05, fadeOut: 0.12, vary: 0, expect: [0.5, 0.7] },
  // The sparks fizzing under the squeal, hotter at each level (the player's own karts only).
  kart_drift_sparks: { recipe: driftSparks, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 2, fadeIn: 0.06, fadeOut: 0.15, vary: 0, expect: [1.1, 1.3] },
  // The tyres rolling on the road, quiet, growing with speed (the player's own karts only).
  kart_tyre_road: { recipe: tyreRoad, pack: "kart", bus: "sfx", level: -20, loop: true, priority: 1, fadeIn: 0.15, fadeOut: 0.12, vary: 0, expect: [1.5, 1.7] },
  kart_surf_ice: { recipe: surfaceIce, pack: "kart", bus: "sfx", level: -22, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.4, 1.8] },
  kart_surf_snow: { recipe: surfaceSnow, pack: "kart", bus: "sfx", level: -16, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.6, 2.0] },
  kart_surf_sand: { recipe: surfaceSand, pack: "kart", bus: "sfx", level: -19.5, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.5, 1.9] },
  kart_surf_mud: { recipe: surfaceMud, pack: "kart", bus: "sfx", level: -15, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.6, 2.0] },
  kart_surf_grass: { recipe: surfaceGrass, pack: "kart", bus: "sfx", level: -19, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.4, 1.8] },

  // --- sparks and boosts ----------------------------------------------------------------------------------
  kart_spark_blue: { recipe: sparkBlue, pack: "kart", bus: "sfx", level: -9, priority: 2, maxInstances: 4, vary: 0, minGap: 0.05, expect: [0.2, 0.7] },
  kart_spark_orange: { recipe: sparkOrange, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 4, vary: 0, minGap: 0.05, expect: [0.2, 0.8] },
  // Under the mini-turbo when the hottest (third) charge is let go.
  kart_super_turbo: { recipe: superTurbo, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 3, vary: 0, minGap: 0.05, expect: [0.6, 1.1] },
  // Flung out of a slipstream.
  kart_slingshot: { recipe: slingshot, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 3, vary: 0.02, minGap: 0.05, expect: [0.5, 0.95] },
  // Lifting off at high revs: the exhaust pops (the player's own karts only).
  kart_backfire: { recipe: backfire, pack: "kart", bus: "sfx", level: -11, priority: 1, maxInstances: 2, vary: 0.05, minGap: 0.3, expect: [0.12, 0.6] },
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

  // --- more items (./kart-items.ts): a comet's glitter (as long as the comet lasts), a storm, a skyrocket, a blast, a decoy ---
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
  // Under the landing of a long jump, louder the longer the flight (the player's own karts only).
  kart_thud: { recipe: heavyLanding, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 2, vary: 0.04, minGap: 0.15, expect: [0.5, 1.0] },
  // The wind round a fast kart, loudest in the air (steered: the player's own karts only).
  kart_wind: { recipe: windRush, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 1, fadeIn: 0.3, fadeOut: 0.4, vary: 0, expect: [1.3, 1.7] },
  kart_fall: { recipe: fall, pack: "kart", bus: "sfx", level: -6, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.2, expect: [1.2, 2.1] },
  kart_drone_drop: { recipe: droneDrop, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 3, vary: 0.02, minGap: 0.1, expect: [0.3, 0.9] },

  // --- countdown, laps, finishing ------------------------------------------------------------------------------------
  kart_beep_low: { recipe: beepLow, pack: "kart", bus: "ui", level: -4, priority: 3, maxInstances: 1, vary: 0, expect: [0.2, 0.6] },
  kart_beep_high: { recipe: beepHigh, pack: "kart", bus: "ui", level: -3, priority: 3, maxInstances: 1, vary: 0, expect: [0.5, 1.2] },
  kart_lap: { recipe: lapChime, pack: "kart", bus: "ui", level: -5, priority: 3, maxInstances: 2, vary: 0, minGap: 0.2, expect: [0.7, 1.6] },
  // A place won or lost: two notes, up or down, soft (at most one in a third of a second: karts side by side swap places).
  kart_place_up: { recipe: placeUp, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 1, vary: 0, minGap: 0.3, expect: [0.3, 0.8] },
  kart_place_down: { recipe: placeDown, pack: "kart", bus: "ui", level: -11, priority: 1, maxInstances: 1, vary: 0, minGap: 0.3, expect: [0.3, 0.8] },
  kart_final_lap: { recipe: finalLap, pack: "kart", bus: "ui", level: -2, priority: 3, maxInstances: 1, vary: 0, minGap: 0.5, expect: [1.5, 2.8] },
  kart_finish_win: { recipe: finishWin, pack: "kart", bus: "ui", level: -1, priority: 3, maxInstances: 1, vary: 0, expect: [2.8, 5] },
  kart_finish_ok: { recipe: finishOk, pack: "kart", bus: "ui", level: -2, priority: 3, maxInstances: 1, vary: 0, expect: [1.8, 3.8] },
  kart_cheer: { recipe: cheer, pack: "kart", bus: "ui", level: -7, priority: 2, maxInstances: 1, vary: 0.02, expect: [2.0, 3.6] },

  // --- loops of the air ---------------------------------------------------------------------------------------------------
  kart_seeker: { recipe: seekerWhistle, pack: "kart", bus: "sfx", level: -11, loop: true, priority: 3, fadeIn: 0.1, fadeOut: 0.15, vary: 0, expect: [0.6, 1.0] },
  kart_drone: { recipe: droneRotors, pack: "kart", bus: "sfx", level: -11, loop: true, priority: 3, fadeIn: 0.15, fadeOut: 0.25, vary: 0, expect: [0.8, 1.2] },

  // --- the places: very quiet beds (two of each, apart in the stereo field) and things far off (src/kart/audio/ambience.ts) ---
  kart_amb_breeze: { recipe: ambBreeze, pack: "kart", bus: "sfx", level: -19, loop: true, priority: 0, fadeIn: 1.5, fadeOut: 1, vary: 0, expect: [1.9, 2.1] },
  kart_amb_water: { recipe: ambWater, pack: "kart", bus: "sfx", level: -19, loop: true, priority: 0, fadeIn: 1.5, fadeOut: 1, vary: 0, expect: [1.9, 2.1] },
  kart_amb_hum: { recipe: ambHum, pack: "kart", bus: "sfx", level: -19, loop: true, priority: 0, fadeIn: 1.5, fadeOut: 1, vary: 0, expect: [1.9, 2.1] },
  kart_amb_rumble: { recipe: ambRumble, pack: "kart", bus: "sfx", level: -18, loop: true, priority: 0, fadeIn: 1.5, fadeOut: 1, vary: 0, expect: [1.9, 2.1] },
  kart_amb_crowd: { recipe: ambCrowd, pack: "kart", bus: "sfx", level: -20, loop: true, priority: 0, fadeIn: 1.5, fadeOut: 1, vary: 0, expect: [1.9, 2.1] },
  kart_amb_bird: { recipe: ambBird, pack: "kart", bus: "sfx", level: -18, priority: 0, maxInstances: 2, vary: 0.06, minGap: 0.3, expect: [0.2, 0.95] },
  kart_amb_gull: { recipe: ambGull, pack: "kart", bus: "sfx", level: -18, priority: 0, maxInstances: 2, vary: 0.05, minGap: 0.5, expect: [0.5, 1.35] },
  kart_amb_hawk: { recipe: ambHawk, pack: "kart", bus: "sfx", level: -18, priority: 0, maxInstances: 1, vary: 0.04, minGap: 1, expect: [0.8, 1.1] },
  kart_amb_bubble: { recipe: ambBubble, pack: "kart", bus: "sfx", level: -18, priority: 0, maxInstances: 2, vary: 0.06, minGap: 0.3, expect: [0.1, 0.85] },
  kart_amb_creak: { recipe: ambCreak, pack: "kart", bus: "sfx", level: -18, priority: 0, maxInstances: 1, vary: 0.06, minGap: 1, expect: [0.6, 1.05] },
  kart_amb_lava: { recipe: ambLava, pack: "kart", bus: "sfx", level: -16, priority: 0, maxInstances: 2, vary: 0.08, minGap: 0.3, expect: [0.3, 0.85] },
  kart_amb_bleep: { recipe: ambBleep, pack: "kart", bus: "sfx", level: -20, priority: 0, maxInstances: 1, vary: 0, minGap: 0.5, expect: [0.2, 0.75] },
  kart_amb_ding: { recipe: ambDing, pack: "kart", bus: "sfx", level: -20, priority: 0, maxInstances: 1, vary: 0.01, minGap: 1, expect: [0.8, 1.55] },

  // --- The rubber duck, and a horn ----------------------------------------------------------------------------------------------
  kart_duck: { recipe: duckSqueak, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 2, vary: 0.03, minGap: 0.2, expect: [0.4, 1.0] },
  kart_horn: { recipe: horn, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, expect: [0.5, 1.2] },
  // The photo finish's flash: the screen's own camera, so it bypasses the world like the interface.
  kart_shutter: { recipe: shutter, pack: "kart", bus: "ui", level: -7, priority: 2, maxInstances: 1, vary: 0.02, minGap: 0.3, expect: [0.15, 0.4] },

  // --- the interface -----------------------------------------------------------------------------------------------------------
  kart_ui_select: { recipe: uiSelect, pack: "kart", bus: "ui", level: -12, priority: 1, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.1, 0.6] },
  kart_ui_back: { recipe: uiBack, pack: "kart", bus: "ui", level: -13, priority: 1, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.1, 0.6] },
  kart_ui_ready: { recipe: uiReady, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.0] },
  kart_ui_join: { recipe: uiJoin, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.1] },
  kart_ui_leave: { recipe: uiLeave, pack: "kart", bus: "ui", level: -11, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.0] },
  kart_ui_start: { recipe: uiStart, pack: "kart", bus: "ui", level: -6, priority: 3, maxInstances: 1, vary: 0, expect: [0.8, 1.9] },
};
