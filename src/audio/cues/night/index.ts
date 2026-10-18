/**
 * Dead of Night: a little after midnight at Miller's Gas & Eats on Route 9.
 * Fog on the road and the fields, one sodium streetlight at the crossroads,
 * the corn, the power lines, the Starlite Motel — and the dead shuffling up
 * the road out of the fog.
 *
 * Realistic and restrained: dread, not a cartoon. The dead never speak; a
 * groan is a rough, irregular throat (a glottal pulse train with heavy
 * jitter, shimmer and the false folds' growl under it) and turbulent breath,
 * both shaped by a slack vocal tract, each take a different gesture. The
 * rifle carries the fight, so it is built like the revolver (an edge, a
 * crack, a body, a sub) and then given what the open country does to a shot
 * in fog: a long damp roll across the fields and a faint late return off the
 * tree line.
 *
 * Space is mostly left to the engine (its slap-back and reverb are added at
 * play time, see ../../routing.ts); a sound bakes in only the space that *is*
 * the sound — a bark across half a mile of fields, a roar inside a mask, a
 * radio's little speaker.
 *
 * The loops are seamless by construction (see ../../dsp/master.ts): textures
 * are rendered a little long and cross-faded into their own start, events
 * are wrapped round, and anything periodic (the ballast's buzz, the
 * projector's 24 frames a second, the ballad's bars) is built on a whole
 * number of its cycles in the loop.
 *
 * The night has more voices and more long sounds than the town, so more than
 * half of it is synthesised at half the rate (see halfRate in ./layers.ts):
 * a groan, a bell across the fields or a radio has nothing to say above a
 * few kHz, and the pack costs less to make than High Noon's for it.
 *
 * The recipes are in this folder by part of the game: the rifle
 * (./rifle.ts), bullets landing (./hits.ts), the dead (./dead.ts), the
 * player (./player.ts), the loops (./beds.ts), the radio's ballad
 * (./ballad.ts), the world's events and secrets (./events.ts) and the
 * stingers (./stingers.ts), over the layers they share (./layers.ts).
 */
import type { CueSpec } from "../table";
import { nightBallad } from "./ballad";
import { nightBuzz, nightCrickets, nightHum, nightProjector, nightWind } from "./beds";
import {
  nightBloatBurst,
  nightBodyFall,
  nightClaw,
  nightClimb,
  nightCornRustle,
  nightDeadFall,
  nightGroan,
  nightLunge,
  nightMechRoar,
  nightShuffle,
  nightSnarl,
  nightSwing,
  nightVault,
} from "./dead";
import {
  nightBell,
  nightDog,
  nightFlicker,
  nightHiss,
  nightHowl,
  nightJarBreak,
  nightNeon,
  nightOwl,
  nightPhoneRing,
  nightScarecrow,
  nightSqueak,
  nightSurvivorDaughter,
  nightSurvivorOwner,
} from "./events";
import {
  nightHeadshot,
  nightHit,
  nightHitCorn,
  nightHitGlass,
  nightHitGround,
  nightHitMetal,
  nightHitSandbag,
  nightHitWater,
  nightHitWood,
  nightMaskClang,
  nightRicochet,
} from "./hits";
import { halfRate } from "./layers";
import { nightDeath, nightHurt } from "./player";
import { nightClick, nightDry, nightLever, nightRifle, nightRoundIn } from "./rifle";
import { nightBoss, nightGameOver, nightGolden, nightSecret, nightStreak, nightWaveClear, nightWaveStart } from "./stingers";

/**
 * The night's cues, all in the "night" pack (synthesised when Dead of Night
 * loads). The mix, in one place (dB at the bus):
 *
 *    0    the player's rifle: the loudest thing in the night
 *   −3…−6 the player hurt, a bloater bursting, hits that reward (the head, the mask)
 *   −6…−10 the other hits, the dead up close, the rifle's mechanics
 *   −9…−17 the world's events and secrets, the dead far off
 *  −16…−24 beds: crickets, wind, the streetlight, the lines, the projector
 *
 * A recipe wrapped in ``halfRate`` is synthesised at half the rate and
 * brought up at the end: the voices, the far and the dark, the loops and the
 * stingers — everything with nothing to say near the top of the spectrum.
 */
export const NIGHT_CUES: Record<string, CueSpec> = {
  // --- the rifle -------------------------------------------------------------
  night_rifle: {
    recipe: nightRifle, pack: "night", bus: "sfx", level: 0, reverb: 0.25, echo: 0.8,
    priority: 3, maxInstances: 4, vary: 0.025, takes: 4, expect: [1.5, 3.5],
  },
  night_lever: {
    recipe: nightLever, pack: "night", bus: "sfx", level: -8, reverb: 0.05, echo: 0.15,
    priority: 3, maxInstances: 2, vary: 0.03, expect: [0.3, 0.9],
  },
  night_dry: {
    recipe: nightDry, pack: "night", bus: "sfx", level: -9, reverb: 0.04,
    priority: 3, maxInstances: 2, vary: 0.03, expect: [0.05, 0.4],
  },
  night_round_in: {
    recipe: nightRoundIn, pack: "night", bus: "sfx", level: -12, reverb: 0.03,
    priority: 2, maxInstances: 3, vary: 0.04, varyGain: 1.5, minGap: 0.05, takes: 5, expect: [0.08, 0.35],
  },
  night_click: {
    recipe: nightClick, pack: "night", bus: "sfx", level: -14,
    priority: 2, maxInstances: 1, vary: 0.03, minGap: 0.05, expect: [0.03, 0.2],
  },

  // --- bullets landing: the player's feedback, never delayed by distance -----
  night_hit: {
    recipe: nightHit, pack: "night", bus: "sfx", level: -6, reverb: 0.12, echo: 0.2,
    priority: 3, maxInstances: 4, vary: 0.06, minGap: 0.03, expect: [0.15, 0.5],
  },
  night_headshot: {
    recipe: nightHeadshot, pack: "night", bus: "sfx", level: -4, reverb: 0.15, echo: 0.3,
    priority: 3, maxInstances: 3, vary: 0.04, minGap: 0.03, expect: [0.2, 0.6],
  },
  night_hit_metal: {
    recipe: nightHitMetal, pack: "night", bus: "sfx", level: -8, reverb: 0.2, echo: 0.4,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.4, 1.3],
  },
  night_hit_wood: {
    recipe: nightHitWood, pack: "night", bus: "sfx", level: -7, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 4, vary: 0.07, minGap: 0.025, expect: [0.15, 0.6],
  },
  night_hit_ground: {
    recipe: nightHitGround, pack: "night", bus: "sfx", level: -9, reverb: 0.12, echo: 0.2,
    priority: 1, maxInstances: 4, vary: 0.08, minGap: 0.025, expect: [0.2, 0.7],
  },
  night_hit_glass: {
    recipe: nightHitGlass, pack: "night", bus: "sfx", level: -8, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.03, expect: [0.2, 0.8],
  },
  night_hit_corn: {
    recipe: nightHitCorn, pack: "night", bus: "sfx", level: -10, reverb: 0.1, echo: 0.1,
    priority: 1, maxInstances: 3, vary: 0.08, minGap: 0.03, expect: [0.3, 0.9],
  },
  night_hit_water: {
    recipe: nightHitWater, pack: "night", bus: "sfx", level: -9, reverb: 0.15, echo: 0.2,
    priority: 1, maxInstances: 3, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  night_hit_sandbag: {
    recipe: nightHitSandbag, pack: "night", bus: "sfx", level: -9, reverb: 0.1, echo: 0.2,
    priority: 1, maxInstances: 4, vary: 0.07, minGap: 0.03, expect: [0.3, 1.0],
  },
  night_mask_clang: {
    recipe: nightMaskClang, pack: "night", bus: "sfx", level: -5, reverb: 0.25, echo: 0.5,
    priority: 3, maxInstances: 2, vary: 0.03, minGap: 0.05, expect: [0.5, 1.6],
  },
  night_ricochet: {
    recipe: nightRicochet, pack: "night", bus: "sfx", level: -9, reverb: 0.25, echo: 0.5,
    priority: 1, maxInstances: 3, vary: 0.08, expect: [0.3, 1.1],
  },

  // --- the dead -----------------------------------------------------------------
  night_groan: {
    recipe: halfRate(nightGroan), pack: "night", bus: "sfx", level: -10, reverb: 0.3, echo: 0.3,
    travel: true, priority: 1, maxInstances: 4, vary: 0.06, minGap: 0.15, takes: 6, expect: [0.8, 2.4],
  },
  night_snarl: {
    recipe: halfRate(nightSnarl), pack: "night", bus: "sfx", level: -9, reverb: 0.25, echo: 0.3,
    travel: true, priority: 2, maxInstances: 3, vary: 0.05, minGap: 0.1, takes: 4, expect: [0.4, 1.2],
  },
  night_dead_fall: {
    recipe: halfRate(nightDeadFall), pack: "night", bus: "sfx", level: -11, reverb: 0.2, echo: 0.2,
    travel: true, priority: 1, maxInstances: 3, vary: 0.05, minGap: 0.1, takes: 4, expect: [0.3, 1.3],
  },
  night_body_fall: {
    recipe: nightBodyFall, pack: "night", bus: "sfx", level: -10, reverb: 0.2, echo: 0.3,
    travel: true, priority: 1, maxInstances: 4, vary: 0.05, takes: 4, expect: [0.4, 1.2],
  },
  night_shuffle: {
    recipe: halfRate(nightShuffle), pack: "night", bus: "world", level: -14, reverb: 0.2, echo: 0.1,
    travel: true, priority: 0, maxInstances: 4, vary: 0.06, takes: 4, expect: [0.8, 2.0],
  },
  night_claw: {
    recipe: nightClaw, pack: "night", bus: "sfx", level: -8, reverb: 0.08, echo: 0.1,
    priority: 2, maxInstances: 3, vary: 0.06, minGap: 0.08, takes: 4, expect: [0.4, 1.0],
  },
  night_lunge: {
    recipe: nightLunge, pack: "night", bus: "sfx", level: -6, reverb: 0.1, echo: 0.2,
    priority: 3, maxInstances: 2, vary: 0.05, minGap: 0.1, expect: [0.4, 1.0],
  },
  night_bloat_burst: {
    recipe: nightBloatBurst, pack: "night", bus: "sfx", level: -3, reverb: 0.3, echo: 0.5,
    priority: 3, maxInstances: 2, vary: 0.05, expect: [1.0, 2.6],
  },
  night_mech_roar: {
    recipe: halfRate(nightMechRoar), pack: "night", bus: "sfx", level: -6, reverb: 0.35, echo: 0.5,
    travel: true, priority: 3, maxInstances: 1, vary: 0.03, expect: [1.5, 3.2],
  },
  night_swing: {
    recipe: nightSwing, pack: "night", bus: "sfx", level: -6, reverb: 0.15, echo: 0.3,
    priority: 3, maxInstances: 2, vary: 0.05, expect: [0.4, 1.2],
  },
  night_climb: {
    recipe: halfRate(nightClimb), pack: "night", bus: "world", level: -11, reverb: 0.25, echo: 0.2,
    travel: true, priority: 1, maxInstances: 2, vary: 0.05, expect: [0.8, 2.0],
  },
  night_vault: {
    recipe: halfRate(nightVault), pack: "night", bus: "world", level: -11, reverb: 0.2, echo: 0.1,
    travel: true, priority: 1, maxInstances: 2, vary: 0.05, expect: [0.5, 1.4],
  },
  night_corn_rustle: {
    recipe: halfRate(nightCornRustle), pack: "night", bus: "world", level: -12, reverb: 0.15,
    travel: true, priority: 1, maxInstances: 3, vary: 0.06, takes: 4, expect: [0.8, 2.0],
  },

  // --- the player ----------------------------------------------------------------
  night_hurt: {
    recipe: nightHurt, pack: "night", bus: "sfx", level: -3, reverb: 0.05,
    priority: 3, maxInstances: 2, vary: 0.04, minGap: 0.05, expect: [0.4, 1.0],
  },
  night_death: {
    recipe: halfRate(nightDeath), pack: "night", bus: "self", level: -4, reverb: 0.1, steady: true,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 4.0],
  },

  // --- the night: beds -------------------------------------------------------------
  night_crickets: {
    recipe: halfRate(nightCrickets, true), pack: "night", bus: "world", level: -18, loop: true,
    priority: 0, fadeIn: 2.0, fadeOut: 1.5, vary: 0.02, expect: [5.5, 8.5],
  },
  night_wind: {
    recipe: halfRate(nightWind, true), pack: "night", bus: "world", level: -19, loop: true,
    priority: 0, fadeIn: 2.5, fadeOut: 2.0, vary: 0.02, expect: [6, 8],
  },
  night_buzz: {
    recipe: halfRate(nightBuzz, true), pack: "night", bus: "world", level: -20, loop: true, reverb: 0.05,
    priority: 0, fadeIn: 0.3, fadeOut: 0.3, vary: 0, expect: [2, 4],
  },
  night_hum: {
    recipe: halfRate(nightHum, true), pack: "night", bus: "world", level: -24, loop: true,
    priority: 0, fadeIn: 1.0, fadeOut: 1.0, vary: 0, expect: [3, 6],
  },
  night_projector: {
    recipe: halfRate(nightProjector, true), pack: "night", bus: "world", level: -16, loop: true, reverb: 0.3,
    priority: 0, fadeIn: 0.6, fadeOut: 1.0, vary: 0.01, expect: [2, 4],
  },
  night_ballad: {
    recipe: halfRate(nightBallad, true), pack: "night", bus: "world", level: -11, loop: true, reverb: 0.15,
    priority: 1, fadeIn: 0.3, fadeOut: 1.0, vary: 0, expect: [7, 12],
  },

  // --- world events and secrets -------------------------------------------------------
  night_flicker: {
    recipe: nightFlicker, pack: "night", bus: "world", level: -14, reverb: 0.15, echo: 0.2,
    priority: 0, maxInstances: 1, vary: 0.05, minGap: 0.08, expect: [0.1, 0.6],
  },
  night_dog: {
    recipe: halfRate(nightDog), pack: "night", bus: "world", level: -16, reverb: 0.25,
    priority: 0, maxInstances: 1, vary: 0.05, expect: [0.8, 2.4],
  },
  night_owl: {
    recipe: halfRate(nightOwl), pack: "night", bus: "world", level: -17, reverb: 0.3,
    priority: 0, maxInstances: 1, vary: 0.03, expect: [0.8, 2.0],
  },
  night_bell: {
    recipe: halfRate(nightBell), pack: "night", bus: "world", level: -10, reverb: 0.4, echo: 0.3,
    priority: 1, maxInstances: 4, vary: 0.005, expect: [3.5, 6.5],
  },
  night_survivor_daughter: {
    recipe: halfRate(nightSurvivorDaughter), pack: "night", bus: "sfx", level: -8, reverb: 0.25, echo: 0.3,
    priority: 2, maxInstances: 1, vary: 0.02, expect: [0.8, 1.8],
  },
  night_survivor_owner: {
    recipe: halfRate(nightSurvivorOwner), pack: "night", bus: "sfx", level: -8, reverb: 0.25, echo: 0.3,
    priority: 2, maxInstances: 1, vary: 0.02, expect: [0.8, 1.8],
  },
  night_jar_break: {
    recipe: nightJarBreak, pack: "night", bus: "sfx", level: -7, reverb: 0.15, echo: 0.3,
    priority: 2, maxInstances: 4, vary: 0.05, minGap: 0.02, expect: [0.3, 1.0],
  },
  night_neon: {
    recipe: nightNeon, pack: "night", bus: "world", level: -9, reverb: 0.25, echo: 0.4,
    travel: true, priority: 1, maxInstances: 2, vary: 0.04, expect: [0.8, 2.0],
  },
  night_phone_ring: {
    recipe: halfRate(nightPhoneRing), pack: "night", bus: "world", level: -9, reverb: 0.2, echo: 0.3,
    travel: true, priority: 1, maxInstances: 3, vary: 0.01, expect: [1.6, 2.6],
  },
  night_howl: {
    recipe: halfRate(nightHowl), pack: "night", bus: "world", level: -10, reverb: 0.45, echo: 0.3,
    travel: true, priority: 1, maxInstances: 2, vary: 0.03, expect: [2.5, 4.5],
  },
  night_hiss: {
    recipe: nightHiss, pack: "night", bus: "world", level: -9, reverb: 0.12,
    travel: true, priority: 1, maxInstances: 1, vary: 0.05, expect: [0.4, 1.2],
  },
  night_squeak: {
    recipe: nightSqueak, pack: "night", bus: "world", level: -9, reverb: 0.1,
    priority: 1, maxInstances: 2, vary: 0.06, minGap: 0.05, expect: [0.2, 0.6],
  },
  night_scarecrow: {
    recipe: halfRate(nightScarecrow), pack: "night", bus: "world", level: -11, reverb: 0.2,
    travel: true, priority: 1, maxInstances: 1, vary: 0.03, expect: [1.2, 2.8],
  },

  // --- stingers and the interface (pitch exact: vary 0) ------------------------------------
  night_wave_start: {
    recipe: halfRate(nightWaveStart), pack: "night", bus: "sfx", steady: true, level: -8, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2.5, 5.0],
  },
  night_wave_clear: {
    recipe: halfRate(nightWaveClear), pack: "night", bus: "sfx", steady: true, level: -10, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4.0],
  },
  night_boss: {
    recipe: halfRate(nightBoss), pack: "night", bus: "sfx", steady: true, level: -7, reverb: 0.1,
    priority: 2, maxInstances: 1, vary: 0, expect: [2.5, 6.0],
  },
  night_game_over: {
    recipe: halfRate(nightGameOver), pack: "night", bus: "ui", level: -9,
    priority: 3, maxInstances: 1, vary: 0, expect: [2.5, 6.0],
  },
  night_secret: {
    recipe: halfRate(nightSecret), pack: "night", bus: "ui", level: -10,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.2, 2.6],
  },
  night_streak: {
    recipe: nightStreak, pack: "night", bus: "ui", level: -13,
    priority: 2, maxInstances: 2, vary: 0, minGap: 0.05, expect: [0.3, 0.9],
  },
  night_golden: {
    recipe: halfRate(nightGolden), pack: "night", bus: "ui", level: -9,
    priority: 2, maxInstances: 1, vary: 0, expect: [1.5, 4.0],
  },
};
