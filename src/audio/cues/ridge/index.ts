/**
 * Overwatch Ridge: dawn in an alpine valley, heard from a grassy ridge 60 m
 * above its floor, lying prone behind a bolt-action rifle.
 *
 * Most of what the player hears happens 200 to 900 m away, and sound takes
 * its time over that: a hit at 600 m arrives 1.75 s after the round. The
 * engine delays those cues (``travel``) and darkens them by distance, so the
 * recipes here are each sound *at its source*, full-bodied — the crack of a
 * round on granite as a man beside the rock would hear it. The exceptions
 * are the sounds whose space is the sound: the rifle's own report, which the
 * valley answers from its far walls, and the echo off the great cliff.
 *
 * The music (the stingers, the chimes) is in D, so a chime landing over a
 * stinger never clashes, and its pitches are exact: a game may raise the
 * streak's chime by playback rate.
 *
 * The recipes are in this folder by part of the game: the rifle
 * (./rifle.ts), impacts (./impacts.ts), danger (./danger.ts), the valley
 * (./valley.ts) and the music (./music.ts), over the layers they share
 * (./layers.ts).
 */
import type { CueSpec } from "../table";
import {
  ridgeCrackNear,
  ridgeDeath,
  ridgeFarShot,
  ridgeHurt,
  ridgeMgBurst,
  ridgeMortarBlast,
  ridgeMortarLaunch,
  ridgeMortarWhistle,
  ridgeScopeCrack,
} from "./danger";
import {
  ridgeBodyFall,
  ridgeGlassShatter,
  ridgeHitDirt,
  ridgeHitFlesh,
  ridgeHitGlass,
  ridgeHitMetal,
  ridgeHitRock,
  ridgeHitWater,
  ridgeHitWood,
  ridgePlateRing,
} from "./impacts";
import { ridgeGameOver, ridgeGolden, ridgeKill, ridgeSecret, ridgeStageClear, ridgeStageStart, ridgeStreak } from "./music";
import { ridgeBolt, ridgeBreath, ridgeDry, ridgeReload, ridgeRifleShot, ridgeScopeIn, ridgeScopeOut } from "./rifle";
import {
  ridgeBirds,
  ridgeCheeseRoll,
  ridgeChurchBell,
  ridgeCowMoo,
  ridgeCowbell,
  ridgeDog,
  ridgeDuckSqueak,
  ridgeEagle,
  ridgeEcho,
  ridgeGoat,
  ridgeRiver,
  ridgeSheep,
  ridgeSiren,
  ridgeSteam,
  ridgeTruck,
  ridgeWhistleAlarm,
  ridgeWindGrass,
  ridgeYeti,
} from "./valley";

/**
 * Overwatch Ridge's cues. The mix (dB at the bus, every take normalised to
 * the same loudness first):
 *
 *   0    the player's rifle: the loudest thing in the game
 *  −2    a mortar bomb landing close
 *  −3…−7 the threats: a round cracking past, the counter-sniper, the player hit
 *  −6…−10 hits heard across the valley: clear, but under the shot that caused them
 *  −7…−16 the valley's events: the siren, the bell, the animals
 * −18…−24 beds: wind in the grass, the river, the birds, the player's breath
 *  −9…−16 stingers and interface
 */
export const RIDGE_CUES: Record<string, CueSpec> = {
  // --- the rifle, in the player's hands ------------------------------------------------------
  ridge_rifle_shot: {
    // Stereo, and a stereo cue passes the engine's panner at centre 3 dB louder than a mono one: trimmed
    // so that the player's rifle is as loud as the revolver and the night's rifle (a test pins it).
    recipe: ridgeRifleShot, pack: "ridge", bus: "sfx", level: 0, trim: -3, reverb: 0.12, echo: 0,
    priority: 3, maxInstances: 3, vary: 0.02, takes: 4, expect: [3.0, 5.0],
  },
  ridge_bolt: {
    recipe: ridgeBolt, pack: "ridge", bus: "sfx", level: -9, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.02, expect: [0.5, 0.9],
  },
  ridge_reload: {
    recipe: ridgeReload, pack: "ridge", bus: "sfx", level: -9, reverb: 0.05,
    priority: 3, maxInstances: 1, vary: 0.02, expect: [1.8, 2.4],
  },
  ridge_dry: {
    recipe: ridgeDry, pack: "ridge", bus: "sfx", level: -10, reverb: 0.03,
    priority: 3, maxInstances: 2, vary: 0.03, expect: [0.05, 0.35],
  },
  ridge_scope_in: {
    recipe: ridgeScopeIn, pack: "ridge", bus: "sfx", level: -15,
    priority: 2, maxInstances: 1, vary: 0.04, minGap: 0.08, expect: [0.2, 0.5],
  },
  ridge_scope_out: {
    recipe: ridgeScopeOut, pack: "ridge", bus: "sfx", level: -17,
    priority: 2, maxInstances: 1, vary: 0.04, minGap: 0.08, expect: [0.15, 0.4],
  },
  ridge_breath: {
    recipe: ridgeBreath, pack: "ridge", bus: "self", level: -24, loop: true,
    priority: 3, maxInstances: 1, fadeIn: 0.6, fadeOut: 0.8, vary: 0.02, expect: [3.5, 5.0],
  },

  // --- impacts, heard from far away: they arrive distance / 343 m/s late ---------------------------
  ridge_hit_dirt: {
    recipe: ridgeHitDirt, pack: "ridge", bus: "sfx", level: -8, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 4, vary: 0.07, minGap: 0.03, expect: [0.25, 0.9],
  },
  ridge_hit_rock: {
    recipe: ridgeHitRock, pack: "ridge", bus: "sfx", level: -8, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 4, vary: 0.06, minGap: 0.03, takes: 4, expect: [0.3, 1.3],
  },
  ridge_hit_metal: {
    recipe: ridgeHitMetal, pack: "ridge", bus: "sfx", level: -7, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 3, vary: 0.04, minGap: 0.03, expect: [0.8, 2.2],
  },
  // The gong's note is its pitch: never varied.
  ridge_plate_ring: {
    recipe: ridgePlateRing, pack: "ridge", bus: "sfx", level: -8, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 3, vary: 0, minGap: 0.03, expect: [0.8, 2.2],
  },
  ridge_hit_glass: {
    recipe: ridgeHitGlass, pack: "ridge", bus: "sfx", level: -9, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.3, 1.0],
  },
  ridge_hit_water: {
    recipe: ridgeHitWater, pack: "ridge", bus: "sfx", level: -10, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  ridge_hit_wood: {
    recipe: ridgeHitWood, pack: "ridge", bus: "sfx", level: -9, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.2, 0.8],
  },
  ridge_hit_flesh: {
    recipe: ridgeHitFlesh, pack: "ridge", bus: "sfx", level: -6, reverb: 0.15, travel: true,
    priority: 2, maxInstances: 4, vary: 0.06, minGap: 0.03, expect: [0.15, 0.5],
  },
  ridge_body_fall: {
    recipe: ridgeBodyFall, pack: "ridge", bus: "world", level: -12, reverb: 0.2, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.05, expect: [0.3, 1.0],
  },
  ridge_glass_shatter: {
    recipe: ridgeGlassShatter, pack: "ridge", bus: "sfx", level: -9, reverb: 0.25, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.6, 1.6],
  },

  // --- danger -----------------------------------------------------------------------------
  ridge_crack_near: {
    recipe: ridgeCrackNear, pack: "ridge", bus: "sfx", level: -4, reverb: 0.06,
    priority: 3, maxInstances: 3, vary: 0.08, minGap: 0.04, expect: [0.15, 0.6],
  },
  ridge_far_shot: {
    recipe: ridgeFarShot, pack: "ridge", bus: "sfx", level: -5, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 3, vary: 0.04, takes: 4, expect: [1.5, 4.0],
  },
  ridge_mg_burst: {
    recipe: ridgeMgBurst, pack: "ridge", bus: "sfx", level: -6, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 2, vary: 0.04, expect: [1.0, 2.6],
  },
  ridge_mortar_launch: {
    recipe: ridgeMortarLaunch, pack: "ridge", bus: "sfx", level: -9, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 3, vary: 0.05, expect: [0.8, 2.0],
  },
  ridge_mortar_whistle: {
    recipe: ridgeMortarWhistle, pack: "ridge", bus: "sfx", level: -10, reverb: 0.1,
    priority: 2, maxInstances: 3, vary: 0.04, expect: [1.0, 2.2],
  },
  ridge_mortar_blast: {
    recipe: ridgeMortarBlast, pack: "ridge", bus: "sfx", level: -2, reverb: 0.3,
    priority: 3, maxInstances: 3, vary: 0.05, expect: [2.0, 4.2],
  },
  ridge_hurt: {
    recipe: ridgeHurt, pack: "ridge", bus: "sfx", level: -3, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.04, minGap: 0.05, expect: [0.3, 1.0],
  },
  ridge_scope_crack: {
    recipe: ridgeScopeCrack, pack: "ridge", bus: "self", level: -6, reverb: 0.05, steady: true,
    priority: 3, maxInstances: 1, vary: 0.03, expect: [0.4, 1.2],
  },
  ridge_death: {
    recipe: ridgeDeath, pack: "ridge", bus: "self", level: -5, reverb: 0.1, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 4.0],
  },

  // --- the valley ---------------------------------------------------------------------------
  ridge_wind_grass: {
    recipe: ridgeWindGrass, pack: "ridge", bus: "world", level: -18, loop: true,
    priority: 0, maxInstances: 1, fadeIn: 2.5, fadeOut: 2.0, vary: 0.02, expect: [7, 9.5],
  },
  ridge_river: {
    recipe: ridgeRiver, pack: "ridge", bus: "world", level: -22, loop: true,
    priority: 0, maxInstances: 1, fadeIn: 2.0, fadeOut: 2.0, vary: 0.02, expect: [6, 8.5],
  },
  ridge_birds: {
    recipe: ridgeBirds, pack: "ridge", bus: "world", level: -21, loop: true,
    priority: 0, maxInstances: 1, fadeIn: 1.5, fadeOut: 1.5, vary: 0.02, expect: [8, 12],
  },
  ridge_cowbell: {
    recipe: ridgeCowbell, pack: "ridge", bus: "world", level: -16, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 3, vary: 0.03, takes: 5, expect: [0.6, 1.9],
  },
  ridge_dog: {
    recipe: ridgeDog, pack: "ridge", bus: "world", level: -16, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.6, 2.2],
  },
  ridge_church_bell: {
    recipe: ridgeChurchBell, pack: "ridge", bus: "world", level: -9, reverb: 0.4, travel: true,
    priority: 1, maxInstances: 2, vary: 0.005, expect: [3.5, 7.0],
  },
  ridge_siren: {
    recipe: ridgeSiren, pack: "ridge", bus: "world", level: -7, reverb: 0.35, travel: true,
    priority: 1, maxInstances: 1, vary: 0.02, expect: [5, 9],
  },
  ridge_goat: {
    recipe: ridgeGoat, pack: "ridge", bus: "world", level: -12, reverb: 0.25, travel: true,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.5, 1.4],
  },
  ridge_cow_moo: {
    recipe: ridgeCowMoo, pack: "ridge", bus: "world", level: -14, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 1, vary: 0.04, expect: [1.0, 2.5],
  },
  ridge_sheep: {
    recipe: ridgeSheep, pack: "ridge", bus: "world", level: -16, reverb: 0.25, travel: true,
    priority: 0, maxInstances: 2, vary: 0.05, expect: [0.4, 1.2],
  },
  ridge_eagle: {
    recipe: ridgeEagle, pack: "ridge", bus: "world", level: -13, reverb: 0.3, travel: true,
    priority: 0, maxInstances: 1, vary: 0.04, expect: [0.6, 1.8],
  },
  ridge_duck_squeak: {
    recipe: ridgeDuckSqueak, pack: "ridge", bus: "world", level: -10, reverb: 0.2, travel: true,
    priority: 1, maxInstances: 1, vary: 0.05, expect: [0.3, 0.9],
  },
  ridge_truck: {
    recipe: ridgeTruck, pack: "ridge", bus: "world", level: -14, loop: true,
    priority: 1, maxInstances: 2, fadeIn: 1.5, fadeOut: 1.5, vary: 0.03, expect: [3, 5],
  },
  ridge_steam: {
    recipe: ridgeSteam, pack: "ridge", bus: "world", level: -12, reverb: 0.2, travel: true,
    priority: 1, maxInstances: 2, vary: 0.05, expect: [1.2, 3.0],
  },
  ridge_whistle_alarm: {
    recipe: ridgeWhistleAlarm, pack: "ridge", bus: "world", level: -10, reverb: 0.3, travel: true,
    priority: 2, maxInstances: 1, vary: 0.02, expect: [0.8, 2.2],
  },
  ridge_cheese_roll: {
    recipe: ridgeCheeseRoll, pack: "ridge", bus: "world", level: -13, reverb: 0.2, travel: true,
    priority: 1, maxInstances: 1, vary: 0.04, expect: [3, 6],
  },
  ridge_yeti: {
    recipe: ridgeYeti, pack: "ridge", bus: "world", level: -14, reverb: 0.35, travel: true,
    priority: 1, maxInstances: 1, vary: 0.03, expect: [1.0, 2.5],
  },
  ridge_echo: {
    recipe: ridgeEcho, pack: "ridge", bus: "world", level: -8, reverb: 0.3,
    priority: 2, maxInstances: 2, vary: 0.03, expect: [1.0, 2.5],
  },

  // --- stingers and interface (pitch exact: vary 0) -------------------------------------------------
  ridge_stage_start: {
    recipe: ridgeStageStart, pack: "ridge", bus: "sfx", steady: true, level: -9, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2, 4.5],
  },
  ridge_stage_clear: {
    recipe: ridgeStageClear, pack: "ridge", bus: "sfx", steady: true, level: -10, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4],
  },
  ridge_secret: {
    recipe: ridgeSecret, pack: "ridge", bus: "ui", level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 2.6],
  },
  ridge_streak: {
    recipe: ridgeStreak, pack: "ridge", bus: "ui", level: -13,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 0.9],
  },
  ridge_kill: {
    recipe: ridgeKill, pack: "ridge", bus: "ui", level: -16,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.03, expect: [0.08, 0.4],
  },
  ridge_game_over: {
    recipe: ridgeGameOver, pack: "ridge", bus: "ui", level: -9,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 6],
  },
  ridge_golden: {
    recipe: ridgeGolden, pack: "ridge", bus: "ui", level: -9,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4],
  },
};
