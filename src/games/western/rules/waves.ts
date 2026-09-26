/**
 * The wave table from docs/HIGH_NOON.md, extended past wave 6 by the rule
 * "+2 each", and everything else that tightens as the waves go on.
 *
 * | Wave | Bandits        | New                          |
 * | 1    | 4              | Slow aim; learn the town     |
 * | 2    | 6              | More covers in play          |
 * | 3    | 8              | Runners                      |
 * | 4    | 10             | Dynamiters                   |
 * | 5    | Black Jack + 8 | Boss                         |
 * | 6+   | +2 each        | Armour, faster aim, riflemen |
 */
import { BOSS_WAVE_EVERY } from "./tuning";

export interface WaveSpec {
  wave: number;
  /** Gang members, not counting Black Jack. */
  bandits: number;
  boss: boolean;
  /** Of the bandits, how many are each kind. The rest are ordinary gunmen. */
  runners: number;
  dynamiters: number;
  riflemen: number;
  /** Of the gunmen and riflemen, how many wear an iron plate. */
  armoured: number;
  /** Seconds from levelling the gun to the shot. */
  aimTime: number;
  /** Chance a shot from close range finds you. */
  hitChance: number;
  damage: number;
  /** Bandits in play at once (the rest wait their turn). */
  maxActive: number;
  /** Bandits out of cover and threatening you at once. */
  maxAiming: number;
  /**
   * How far down the street (metres) the gunmen and dynamiters may fight
   * from. The first waves keep them near, where a man reads clearly and the
   * town can be learned a stretch at a time; "more covers in play" after.
   */
  reach: number;
  /** Chance of a second shot before ducking back. */
  secondShot: number;
  /** Chance a bandit gives himself away before coming out. */
  tellChance: number;
  /** Innocents who show themselves during the wave. */
  townsfolk: number;
  /** What the title card says under "Wave N". */
  subtitle: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function isBossWave(wave: number): boolean {
  return wave >= BOSS_WAVE_EVERY && wave % BOSS_WAVE_EVERY === 0;
}

/** Aim time falls from 1.4 s on wave 1 to 0.7 s by wave 10, and stays there. */
export function aimTimeFor(wave: number): number {
  return clamp(1.4 - ((wave - 1) * 0.7) / 9, 0.7, 1.4);
}

/** Later waves' bandits hit harder. */
export function damageFor(wave: number): number {
  if (wave <= 5) return 34;
  if (wave <= 8) return 40;
  if (wave <= 11) return 45;
  return 50;
}

function banditsFor(wave: number): number {
  if (wave <= 4) return 2 * wave + 2; // 4, 6, 8, 10
  if (wave === 5) return 8;
  const regular = 2 * wave; // 12, 14, 16 ...
  return isBossWave(wave) ? regular - 2 : regular;
}

/** Wave 1 within 30 m, wave 2 within 40 m, then the whole street. */
export function reachFor(wave: number): number {
  if (wave <= 1) return 30;
  if (wave === 2) return 40;
  return Number.POSITIVE_INFINITY;
}

function subtitleFor(wave: number): string {
  switch (wave) {
    case 1:
      return "The Carver gang rides in.";
    case 2:
      return "They know the town now.";
    case 3:
      return "Runners. Lead your shot.";
    case 4:
      return "Dynamite. Shoot it in the air.";
    case 5:
      return "Black Jack Carver.";
    case 6:
      return "Iron plates. Aim for the head.";
    default:
      return isBossWave(wave) ? "Black Jack is back." : "They keep coming.";
  }
}

export function waveSpec(wave: number): WaveSpec {
  const w = Math.max(1, Math.floor(wave));
  const bandits = banditsFor(w);
  const boss = isBossWave(w);
  const runners = w < 3 ? 0 : w < 6 ? 2 : Math.min(4, 3 + Math.floor((w - 6) / 3));
  const dynamiters = w < 4 ? 0 : w < 6 ? 2 : Math.min(4, 2 + Math.floor((w - 6) / 3));
  const riflemen = w < 6 ? 0 : Math.min(5, 2 + Math.floor((w - 6) / 2));
  const gunmenAndRiflemen = bandits - runners - dynamiters;
  const armoured = w < 6 ? 0 : Math.min(Math.floor(gunmenAndRiflemen / 2), 2 + (w - 6));
  return {
    wave: w,
    bandits,
    boss,
    runners,
    dynamiters,
    riflemen,
    armoured,
    aimTime: aimTimeFor(w),
    hitChance: Math.min(0.75, 0.32 + 0.05 * (w - 1)),
    damage: damageFor(w),
    maxActive: w === 1 ? 2 : w <= 3 ? 3 : w <= 5 ? 4 : Math.min(7, 5 + Math.floor((w - 6) / 2)),
    maxAiming: w === 1 ? 1 : w <= 5 ? 2 : w <= 8 ? 3 : 4,
    reach: reachFor(w),
    secondShot: w <= 3 ? 0 : Math.min(0.5, 0.1 * (w - 3)),
    tellChance: w <= 2 ? 1 : Math.max(0.5, 1 - 0.1 * (w - 2)),
    townsfolk: w === 1 || w === 2 || boss ? 1 : Math.min(3, 2 + Math.floor((w - 3) / 4)),
    subtitle: subtitleFor(w),
  };
}
