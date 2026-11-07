/**
 * The table rows for the sounds a Grip Prix kart makes as it moves (the recipes are in ./kart-engines.ts and
 * ./kart-ground.ts): its engines, their load, the tyres and the ground, the air. The rest of the pack's table is in
 * ./kart.ts, which spreads this in.
 *
 * Every row here is stereo (a take of two channels), so none takes the 3 dB a mono cue loses to the panner: each is
 * set 3 dB under what the same sound at the same weight in the mix would have been as a mono take.
 */
import {
  barrierScrape,
  driftScreech,
  driftSparks,
  engineElectricHi,
  engineElectricLo,
  engineElectricMid,
  engineGrit,
  engineGrowl,
  engineHeavyHi,
  engineHeavyLo,
  engineHeavyMid,
  engineIdle,
  engineLightHi,
  engineLightLo,
  engineLightMid,
  engineMiddleHi,
  engineMiddleLo,
  engineMiddleMid,
  gearBark,
  overrunCrackle,
  passWhoosh,
  slipstreamRush,
  suspensionCreak,
  surfaceGrass,
  surfaceIce,
  surfaceMud,
  surfaceSand,
  surfaceSnow,
  tyreRoad,
  windRush,
} from "./kart-motion";
import type { CueSpec } from "./table";

const engine = (recipe: CueSpec["recipe"], expect: [number, number] = [1.5, 1.7]): CueSpec => ({
  recipe, pack: "kart", bus: "sfx", level: -10.5, loop: true, priority: 2, fadeIn: 0.12, fadeOut: 0.2, vary: 0, expect,
});

export const MOTION_CUES: Record<string, CueSpec> = {
  // --- engines: loops the game steers (rate = pitch, volume, pan, distance) ---------------------------
  // Each engine in three rev bands (low, mid, high; src/kart/audio/engines.ts crosses them over), all equally loud.
  kart_engine_light_lo: engine(engineLightLo),
  kart_engine_light_mid: engine(engineLightMid),
  kart_engine_light_hi: engine(engineLightHi),
  kart_engine_middle_lo: engine(engineMiddleLo),
  kart_engine_middle_mid: engine(engineMiddleMid),
  kart_engine_middle_hi: engine(engineMiddleHi),
  kart_engine_heavy_lo: engine(engineHeavyLo),
  kart_engine_heavy_mid: engine(engineHeavyMid),
  kart_engine_heavy_hi: engine(engineHeavyHi),
  kart_engine_electric_lo: engine(engineElectricLo, [1.5, 1.75]),
  kart_engine_electric_mid: engine(engineElectricMid, [1.5, 1.75]),
  kart_engine_electric_hi: engine(engineElectricHi, [1.5, 1.75]),
  // The roar and rasp of a working engine, steered with the load (the player's own karts only).
  kart_engine_grit: { recipe: engineGrit, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.2, vary: 0, expect: [0.9, 1.1] },
  kart_idle: { recipe: engineIdle, pack: "kart", bus: "sfx", level: -15.5, loop: true, priority: 2, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [2.0, 2.3] },
  kart_growl: { recipe: engineGrowl, pack: "kart", bus: "sfx", level: -17, loop: true, priority: 2, fadeIn: 0.08, fadeOut: 0.25, vary: 0, expect: [0.9, 1.1] },
  // Lifting off at high revs: the exhaust crackles (the player's own karts only).
  kart_backfire: { recipe: overrunCrackle, pack: "kart", bus: "sfx", level: -14, priority: 1, maxInstances: 2, vary: 0.05, minGap: 0.3, expect: [0.3, 1.0] },
  // Each gear change under power: the clutch, the cut and the bark.
  kart_shift: { recipe: gearBark, pack: "kart", bus: "sfx", level: -15, priority: 1, maxInstances: 2, vary: 0.04, minGap: 0.2, expect: [0.1, 0.3] },

  // --- the drift and the ground ------------------------------------------------------------------------
  kart_drift: { recipe: driftScreech, pack: "kart", bus: "sfx", level: -14, loop: true, priority: 2, fadeIn: 0.05, fadeOut: 0.12, vary: 0, expect: [1.1, 1.3] },
  // The sparks fizzing under the squeal, hotter at each level (the player's own karts only).
  kart_drift_sparks: { recipe: driftSparks, pack: "kart", bus: "sfx", level: -20, loop: true, priority: 2, fadeIn: 0.06, fadeOut: 0.15, vary: 0, expect: [1.1, 1.3] },
  // The tyres rolling on the road, quiet, growing with speed (the player's own karts only).
  kart_tyre_road: { recipe: tyreRoad, pack: "kart", bus: "sfx", level: -23, loop: true, priority: 1, fadeIn: 0.15, fadeOut: 0.12, vary: 0, expect: [1.9, 2.1] },
  kart_surf_ice: { recipe: surfaceIce, pack: "kart", bus: "sfx", level: -25, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.9, 2.1] },
  kart_surf_snow: { recipe: surfaceSnow, pack: "kart", bus: "sfx", level: -19, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.9, 2.1] },
  kart_surf_sand: { recipe: surfaceSand, pack: "kart", bus: "sfx", level: -22.5, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.9, 2.1] },
  kart_surf_mud: { recipe: surfaceMud, pack: "kart", bus: "sfx", level: -18, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.9, 2.1] },
  kart_surf_grass: { recipe: surfaceGrass, pack: "kart", bus: "sfx", level: -22, loop: true, priority: 1, fadeIn: 0.2, fadeOut: 0.25, vary: 0, expect: [1.9, 2.1] },
  // A barrier scraped along, held while the contact lasts (the player's own karts only).
  kart_scrape: { recipe: barrierScrape, pack: "kart", bus: "sfx", level: -16, loop: true, priority: 2, fadeIn: 0.04, fadeOut: 0.15, vary: 0, expect: [0.9, 1.1] },
  // The chassis taking a bump.
  kart_creak: { recipe: suspensionCreak, pack: "kart", bus: "sfx", level: -15, priority: 1, maxInstances: 2, vary: 0.06, minGap: 0.5, expect: [0.2, 0.7] },

  // --- the air --------------------------------------------------------------------------------------------------------
  // The wind round a fast kart, loudest in the air (steered: the player's own karts only), and sitting in a wake.
  kart_wind: { recipe: windRush, pack: "kart", bus: "sfx", level: -20, loop: true, priority: 1, fadeIn: 0.3, fadeOut: 0.4, vary: 0, expect: [1.9, 2.1] },
  kart_draft: { recipe: slipstreamRush, pack: "kart", bus: "sfx", level: -21, loop: true, priority: 1, fadeIn: 0.3, fadeOut: 0.4, vary: 0, expect: [1.9, 2.1] },
  // Another kart going by close and fast: a rush of air.
  kart_pass: { recipe: passWhoosh, pack: "kart", bus: "sfx", level: -15, priority: 0, maxInstances: 2, vary: 0.04, minGap: 0.2, expect: [0.4, 1.0] },
};
