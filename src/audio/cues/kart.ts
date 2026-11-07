/**
 * Grip Prix's sound pack: a toy-box kart racer, every sound synthesised in
 * code like the rest of Super Claude Bros. The recipes are in
 * ./kart-motion.ts (what a kart sounds like as it moves), ./kart-events.ts
 * (a kart under power: drift sparks, boosts, the start), ./kart-items.ts
 * (the box, the roulette and every item), ./kart-impacts.ts (hits, bumps,
 * hazards, the air, the fall), ./kart-jingles.ts (the tunes, the crowd, the
 * horns and the interface) and ./kart-ambience.ts (the places), all cut from
 * the parts in ./kart-synth.ts; this is only the table that says how each is
 * played.
 *
 * Levels are dB at the bus, every take having been normalised to the same
 * loudness first (see ../dsp/master.ts). The mix, in one place:
 *
 *   −1…−4   what the player must not miss: the finish fanfares, the final-lap
 *           jingle, the countdown, being hit, a hazard, starting
 *   −4…−7   the player's own actions: boosts, items, jumps, bumps, walls
 *   −7…−12  sparks, ticks, the crowd, the horn's neighbours, a kart going by
 *   −10…−22 loops: engines (two layers each, steered by revs and distance),
 *           their rasp, the drift's squeal and its sparks, the road and the
 *           surface under the wheels, the whistle of a seeker
 *   −16…−20 the places, played lower still (src/kart/audio/ambience.ts)
 *   −9…−13  the interface, soft and short
 *
 * The music (see src/kart/audio/music) plays under all of it: over a race of
 * bots with the sliders at their defaults (tools/listen), about −23 LUFS
 * against the effects' −19.7, a bed the effects stand on.
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
  flameLong,
  flameShort,
  flood,
  miniTurbo,
  passSwish,
  slingshot,
  sparkBlue,
  sparkOrange,
  startBoost,
  superTurbo,
} from "./kart-events";
import {
  bump,
  bumpHard,
  droneDrop,
  fall,
  hazard,
  heavyLanding,
  hit,
  jump,
  land,
  landCheer,
  spinout,
  trick,
  wallScrape,
  wallThud,
} from "./kart-impacts";
import {
  ITEM_CHIMES,
  blastBoom,
  boxSmash,
  cometRide,
  decoyDrop,
  decoyPop,
  itemGet,
  itemLatch,
  nitroTriple,
  nitroUse,
  orbitHum,
  puckBounce,
  puckFire,
  rouletteTick,
  seekerBeeps,
  seekerLaunch,
  seekerLock,
  skyrocketBurst,
  skyrocketLaunch,
  skyrocketWarn,
  slickSkid,
  slickSplat,
  stormStrike,
} from "./kart-items";
import {
  applause,
  beepHigh,
  beepLow,
  cheer,
  duckSqueak,
  emoteCheer,
  emoteWave,
  finalLap,
  finishOk,
  finishWin,
  horn,
  hornBell,
  hornParty,
  hornRibbit,
  hornRobot,
  hornSqueeze,
  hornSteam,
  hornTuba,
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
  kart_engine_light_lo: { recipe: engineLightLo, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_light_hi: { recipe: engineLightHi, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_middle_lo: { recipe: engineMiddleLo, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_middle_hi: { recipe: engineMiddleHi, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_heavy_lo: { recipe: engineHeavyLo, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_heavy_hi: { recipe: engineHeavyHi, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.95, 1.06] },
  kart_engine_electric_lo: { recipe: engineElectricLo, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_engine_electric_hi: { recipe: engineElectricHi, pack: "kart", bus: "sfx", level: -7.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  // The rasp of a working engine, steered with the load (the player's own karts only).
  kart_engine_grit: { recipe: engineGrit, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_idle: { recipe: engineIdle, pack: "kart", bus: "sfx", level: -12.5, loop: true, priority: 2, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },
  kart_growl: { recipe: engineGrowl, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },

  // --- the drift and the ground ------------------------------------------------------------------------
  kart_drift: { recipe: driftScreech, pack: "kart", bus: "sfx", level: -11, loop: true, priority: 2, fadeIn: 0.05, fadeOut: 0.12, vary: 0, expect: [0.5, 0.7] },
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
  kart_spark_blue: { recipe: sparkBlue, pack: "kart", bus: "sfx", level: -9, priority: 2, maxInstances: 4, vary: 0, minGap: 0.05, reverb: 0.2, expect: [0.2, 0.7] },
  kart_spark_orange: { recipe: sparkOrange, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 4, vary: 0, minGap: 0.05, reverb: 0.2, expect: [0.2, 0.8] },
  // Under the mini-turbo when the hottest (third) charge is let go.
  kart_super_turbo: { recipe: superTurbo, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 3, vary: 0, minGap: 0.05, reverb: 0.2, expect: [0.6, 1.1] },
  // Flung out of a slipstream.
  kart_slingshot: { recipe: slingshot, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 3, vary: 0.02, minGap: 0.05, reverb: 0.1, expect: [0.5, 0.95] },
  // Another kart going by close and fast: a swish of air.
  kart_pass: { recipe: passSwish, pack: "kart", bus: "sfx", level: -12, priority: 0, maxInstances: 2, vary: 0.04, minGap: 0.2, expect: [0.3, 0.55] },
  // Lifting off at high revs: the exhaust pops (the player's own karts only).
  kart_backfire: { recipe: backfire, pack: "kart", bus: "sfx", level: -11, priority: 1, maxInstances: 2, vary: 0.05, minGap: 0.3, expect: [0.12, 0.6] },
  kart_mini_turbo: { recipe: miniTurbo, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 4, vary: 0.02, minGap: 0.05, reverb: 0.1, expect: [0.3, 0.8] },
  kart_boost_whoosh: { recipe: boostWhoosh, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 4, vary: 0.03, minGap: 0.05, reverb: 0.12, expect: [0.8, 1.5] },
  kart_flame_short: { recipe: flameShort, pack: "kart", bus: "sfx", level: -9, priority: 2, maxInstances: 2, vary: 0.03, minGap: 0.2, reverb: 0.12, expect: [0.8, 1.2] },
  kart_flame_long: { recipe: flameLong, pack: "kart", bus: "sfx", level: -8, priority: 2, maxInstances: 2, vary: 0.03, minGap: 0.2, reverb: 0.14, expect: [1.5, 2.1] },
  kart_boost_pad: { recipe: boostPad, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 4, vary: 0.01, minGap: 0.05, reverb: 0.1, expect: [0.4, 1.0] },
  kart_start_boost: { recipe: startBoost, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 4, vary: 0.01, minGap: 0.05, reverb: 0.12, expect: [0.8, 1.6] },
  kart_flood: { recipe: flood, pack: "kart", bus: "sfx", level: -6, priority: 3, maxInstances: 4, vary: 0.04, minGap: 0.1, reverb: 0.1, expect: [0.5, 1.2] },

  // --- item boxes and items ----------------------------------------------------------------------------------
  kart_box_smash: { recipe: boxSmash, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 4, vary: 0.01, minGap: 0.03, reverb: 0.14, expect: [0.5, 1.2] },
  kart_roulette_tick: { recipe: rouletteTick, pack: "kart", bus: "ui", level: -11, priority: 2, maxInstances: 4, vary: 0, minGap: 0.025, expect: [0.04, 0.2] },
  kart_item_ready: { recipe: itemLatch, pack: "kart", bus: "ui", level: -7, priority: 3, maxInstances: 2, vary: 0, minGap: 0.1, reverb: 0.1, expect: [0.2, 0.7] },
  kart_nitro: { recipe: nitroUse, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.05, reverb: 0.1, expect: [0.8, 1.3] },
  kart_nitro_triple: { recipe: nitroTriple, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.05, reverb: 0.1, expect: [0.8, 1.3] },
  kart_puck_fire: { recipe: puckFire, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 3, vary: 0.03, minGap: 0.05, reverb: 0.08, expect: [0.3, 0.8] },
  kart_seeker_launch: { recipe: seekerLaunch, pack: "kart", bus: "sfx", level: -6, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, reverb: 0.1, expect: [0.4, 0.9] },
  // Three pucks circling the player's kart that holds a triple puck.
  kart_orbit: { recipe: orbitHum, pack: "kart", bus: "sfx", level: -15, loop: true, priority: 2, fadeIn: 0.15, fadeOut: 0.2, vary: 0, expect: [1.0, 1.4] },
  kart_seeker_lock: { recipe: seekerLock, pack: "kart", bus: "sfx", level: -8, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, reverb: 0.1, expect: [0.25, 0.6] },
  kart_puck_bounce: { recipe: puckBounce, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 3, vary: 0.04, minGap: 0.04, reverb: 0.1, expect: [0.2, 0.6] },
  kart_slick_splat: { recipe: slickSplat, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 3, vary: 0.03, minGap: 0.05, reverb: 0.08, expect: [0.4, 1.1] },
  kart_slick_skid: { recipe: slickSkid, pack: "kart", bus: "sfx", level: -8, priority: 3, maxInstances: 2, vary: 0.03, minGap: 0.1, reverb: 0.06, expect: [0.5, 1.0] },
  kart_decoy_drop: { recipe: decoyDrop, pack: "kart", bus: "sfx", level: -9, priority: 2, maxInstances: 2, vary: 0.03, minGap: 0.1, reverb: 0.08, expect: [0.2, 0.7] },

  // --- more items (./kart-items.ts): a comet's glitter (as long as the comet lasts), a storm, a skyrocket, a blast, a decoy ---
  kart_comet: { recipe: cometRide, pack: "kart", bus: "sfx", level: -8, priority: 2, maxInstances: 2, vary: 0, reverb: 0.12, expect: [5.8, 6.6] },
  kart_storm: { recipe: stormStrike, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 3, vary: 0.03, minGap: 0.05, reverb: 0.35, expect: [2.2, 3.2] },
  kart_skyrocket: { recipe: skyrocketLaunch, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, reverb: 0.12, expect: [1.4, 2.1] },
  kart_skyrocket_warn: { recipe: skyrocketWarn, pack: "kart", bus: "ui", level: -6, priority: 3, maxInstances: 1, vary: 0, minGap: 0.5, reverb: 0.06, expect: [0.9, 1.6] },
  kart_skyrocket_burst: { recipe: skyrocketBurst, pack: "kart", bus: "sfx", level: -2, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, reverb: 0.4, expect: [1.9, 2.8] },
  kart_blast: { recipe: blastBoom, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.1, reverb: 0.3, expect: [1.1, 1.8] },
  kart_decoy_pop: { recipe: decoyPop, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.05, reverb: 0.15, expect: [1.0, 1.6] },

  // The roulette lands on an item, and the item says which: a chime of its own (a second after the pick-up, over the latch).
  ...Object.fromEntries(ITEM_CHIMES.map((item): [string, CueSpec] => [`kart_get_${item}`, { recipe: itemGet(item), pack: "kart", bus: "ui", level: -5, priority: 3, maxInstances: 2, vary: 0, minGap: 0.1, reverb: 0.18, expect: [0.3, 0.8] }])),

  // --- hits ---------------------------------------------------------------------------------------------------------
  kart_hit: { recipe: hit, pack: "kart", bus: "sfx", level: -2, priority: 3, maxInstances: 4, vary: 0.02, minGap: 0.08, reverb: 0.15, expect: [0.7, 1.5] },
  kart_spinout: { recipe: spinout, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 3, vary: 0.02, minGap: 0.08, reverb: 0.15, expect: [1.2, 1.7] },
  kart_bump: { recipe: bump, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 3, vary: 0.06, minGap: 0.05, reverb: 0.06, expect: [0.15, 0.5] },
  kart_bump_hard: { recipe: bumpHard, pack: "kart", bus: "sfx", level: -4, priority: 2, maxInstances: 2, vary: 0.05, minGap: 0.08, reverb: 0.1, expect: [0.4, 0.9] },
  kart_wall_thud: { recipe: wallThud, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.08, reverb: 0.15, expect: [0.3, 0.9] },
  kart_wall_scrape: { recipe: wallScrape, pack: "kart", bus: "sfx", level: -10, priority: 1, maxInstances: 3, vary: 0.05, minGap: 0.1, expect: [0.3, 0.9] },
  kart_hazard: { recipe: hazard, pack: "kart", bus: "sfx", level: -3, priority: 3, maxInstances: 3, vary: 0.03, minGap: 0.1, reverb: 0.15, expect: [0.7, 1.5] },

  // --- the air --------------------------------------------------------------------------------------------------------
  kart_jump: { recipe: jump, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 4, vary: 0.03, minGap: 0.1, reverb: 0.08, expect: [0.3, 0.9] },
  kart_trick: { recipe: trick, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 3, vary: 0, minGap: 0.1, reverb: 0.15, expect: [0.7, 1.3] },
  kart_land: { recipe: land, pack: "kart", bus: "sfx", level: -6, priority: 2, maxInstances: 3, vary: 0.04, minGap: 0.1, reverb: 0.1, expect: [0.3, 0.8] },
  // The cheer for a trick landed (the player's own karts only).
  kart_land_cheer: { recipe: landCheer, pack: "kart", bus: "sfx", level: -8, priority: 2, maxInstances: 2, vary: 0.03, minGap: 0.3, reverb: 0.2, expect: [0.6, 1.1] },
  // Under the landing of a long jump, louder the longer the flight (the player's own karts only).
  kart_thud: { recipe: heavyLanding, pack: "kart", bus: "sfx", level: -5, priority: 2, maxInstances: 2, vary: 0.04, minGap: 0.15, reverb: 0.15, expect: [0.5, 1.0] },
  // The wind round a fast kart, loudest in the air (steered: the player's own karts only).
  kart_wind: { recipe: windRush, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 1, fadeIn: 0.3, fadeOut: 0.4, vary: 0, expect: [1.3, 1.7] },
  kart_fall: { recipe: fall, pack: "kart", bus: "sfx", level: -6, priority: 3, maxInstances: 2, vary: 0.02, minGap: 0.2, reverb: 0.25, expect: [1.6, 2.4] },
  kart_drone_drop: { recipe: droneDrop, pack: "kart", bus: "sfx", level: -7, priority: 2, maxInstances: 2, vary: 0.02, minGap: 0.1, reverb: 0.1, expect: [0.4, 1.0] },

  // --- countdown, laps, finishing ------------------------------------------------------------------------------------
  kart_beep_low: { recipe: beepLow, pack: "kart", bus: "ui", level: -4, priority: 3, maxInstances: 1, vary: 0, reverb: 0.06, expect: [0.2, 0.6] },
  kart_beep_high: { recipe: beepHigh, pack: "kart", bus: "ui", level: -3, priority: 3, maxInstances: 1, vary: 0, reverb: 0.2, expect: [0.8, 1.4] },
  kart_lap: { recipe: lapChime, pack: "kart", bus: "ui", level: -5, priority: 3, maxInstances: 2, vary: 0, minGap: 0.2, reverb: 0.25, expect: [0.8, 1.6] },
  // A place won or lost: two notes, up or down, soft (at most one in a third of a second: karts side by side swap places).
  kart_place_up: { recipe: placeUp, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 1, vary: 0, minGap: 0.3, reverb: 0.1, expect: [0.3, 0.8] },
  kart_place_down: { recipe: placeDown, pack: "kart", bus: "ui", level: -11, priority: 1, maxInstances: 1, vary: 0, minGap: 0.3, expect: [0.3, 0.8] },
  kart_final_lap: { recipe: finalLap, pack: "kart", bus: "ui", level: -2, priority: 3, maxInstances: 1, vary: 0, minGap: 0.5, reverb: 0.25, expect: [1.2, 2.0] },
  kart_finish_win: { recipe: finishWin, pack: "kart", bus: "ui", level: -1, priority: 3, maxInstances: 1, vary: 0, reverb: 0.35, expect: [2.8, 5] },
  kart_finish_ok: { recipe: finishOk, pack: "kart", bus: "ui", level: -2, priority: 3, maxInstances: 1, vary: 0, reverb: 0.3, expect: [1.8, 3.8] },
  kart_cheer: { recipe: cheer, pack: "kart", bus: "ui", level: -7, priority: 2, maxInstances: 1, vary: 0.02, minGap: 1.5, reverb: 0.4, expect: [2.0, 3.6] },
  // The results' applause (a screen asks for it), a driver's cheer (both hands up) and wave (one hand).
  kart_applause: { recipe: applause, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 1, vary: 0.02, minGap: 2, reverb: 0.3, expect: [2.6, 3.8] },
  kart_emote_cheer: { recipe: emoteCheer, pack: "kart", bus: "sfx", level: -9, priority: 1, maxInstances: 2, vary: 0.03, minGap: 1, reverb: 0.2, expect: [0.6, 1.1] },
  kart_emote_wave: { recipe: emoteWave, pack: "kart", bus: "sfx", level: -12, priority: 1, maxInstances: 2, vary: 0.03, minGap: 1, reverb: 0.1, expect: [0.3, 0.8] },

  // --- loops of the air ---------------------------------------------------------------------------------------------------
  kart_seeker: { recipe: seekerBeeps, pack: "kart", bus: "sfx", level: -13, loop: true, priority: 3, fadeIn: 0.05, fadeOut: 0.12, vary: 0, expect: [0.6, 1.0] },
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
  kart_duck: { recipe: duckSqueak, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 2, vary: 0.03, minGap: 0.2, reverb: 0.1, expect: [0.4, 1.0] },
  kart_horn: { recipe: horn, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.12, expect: [0.5, 1.2] },
  // A horn of each driver's own (events.ts maps them): Bun a party blower, Pepper a bulb horn, Moss a ribbit, Juniper a steam whistle, Mango a bicycle bell, Bramble a tuba, Rivet a robot.
  kart_horn_party: { recipe: hornParty, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.12, expect: [0.5, 1.2] },
  kart_horn_squeeze: { recipe: hornSqueeze, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.1, expect: [0.5, 1.2] },
  kart_horn_ribbit: { recipe: hornRibbit, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.1, expect: [0.5, 1.2] },
  kart_horn_steam: { recipe: hornSteam, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.15, expect: [0.5, 1.4] },
  kart_horn_bell: { recipe: hornBell, pack: "kart", bus: "sfx", level: -5, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.15, expect: [0.6, 1.4] },
  kart_horn_tuba: { recipe: hornTuba, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.12, expect: [0.5, 1.3] },
  kart_horn_robot: { recipe: hornRobot, pack: "kart", bus: "sfx", level: -4, priority: 3, maxInstances: 3, vary: 0.01, minGap: 0.1, reverb: 0.1, expect: [0.5, 1.1] },
  // The photo finish's flash: the screen's own camera, so it bypasses the world like the interface.
  kart_shutter: { recipe: shutter, pack: "kart", bus: "ui", level: -7, priority: 2, maxInstances: 1, vary: 0.02, minGap: 0.3, expect: [0.2, 0.5] },

  // --- the interface -----------------------------------------------------------------------------------------------------------
  kart_ui_select: { recipe: uiSelect, pack: "kart", bus: "ui", level: -12, priority: 1, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.1, 0.6] },
  kart_ui_back: { recipe: uiBack, pack: "kart", bus: "ui", level: -13, priority: 1, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.1, 0.6] },
  kart_ui_ready: { recipe: uiReady, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.0] },
  kart_ui_join: { recipe: uiJoin, pack: "kart", bus: "ui", level: -9, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.1] },
  kart_ui_leave: { recipe: uiLeave, pack: "kart", bus: "ui", level: -11, priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 1.0] },
  kart_ui_start: { recipe: uiStart, pack: "kart", bus: "ui", level: -6, priority: 3, maxInstances: 1, vary: 0, reverb: 0.2, expect: [0.8, 1.9] },
};
