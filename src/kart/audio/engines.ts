/**
 * What a kart's loops should be doing right now, as pure functions of the
 * kart's state: where an engine's pitch sits for a speed, when the growl
 * comes in, when the tyres squeal, which surface is under the wheels and how
 * loud. RaceAudio only applies these numbers (smoothed) to the running loops.
 */
import type { KartView } from "../contract";

/** The kart's top speed on the road, m/s (docs/GRIP_PRIX.md); engine pitch is scaled against it. */
export const TOP_SPEED = 24;

/** The four engine timbres, in the order local players take them. */
export const ENGINE_CUES = ["kart_engine_a", "kart_engine_b", "kart_engine_c", "kart_engine_d"] as const;

/** A little pitch offset per local player, so two karts of one timbre are still two karts. */
export const PLAYER_PITCH = [1, 0.935, 1.075, 0.875] as const;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const smoothstep = (a: number, b: number, x: number): number => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export interface EngineTarget {
  /** Playback rate of the engine loop: its pitch. */
  rate: number;
  /** Level of the engine loop, 0..1. */
  engine: number;
  /** Level of the idle loop, 0..1 (it hands over to the engine as the kart moves off). */
  idle: number;
  /** Level of the growl, 0..1 (on while a boost lasts). */
  growl: number;
}

/**
 * Pitch follows speed (a run from a low idle at a standstill to a shriek at
 * top speed and past it on a boost), drops a little in a drift and off the
 * road, climbs when the wheels leave the ground, sags in a spin-out, and the
 * engine is cut while the drone carries the kart.
 */
export function engineTarget(k: KartView): EngineTarget {
  const f = k.speed / TOP_SPEED;
  const forward = Math.max(0, f);
  let rate = f >= 0 ? 0.64 + 1.1 * Math.pow(Math.min(forward, 1.6), 0.9) : 0.64 + 0.5 * Math.min(1, -f * 3);
  if (k.boost > 0) rate *= 1.1;
  if (k.drift !== 0) rate *= 0.95;
  if (k.offroad) rate *= 0.94;
  if (k.hop > 0.3) rate *= 1.15;
  if (k.spin > 0) rate *= 0.75;
  const carried = k.rescue > 0;
  const speed = Math.abs(k.speed);
  const alive = carried ? 0 : 1;
  const engine = alive * (k.spin > 0 ? 0.55 : 1) * smoothstep(0.2, 2.5, speed) * (0.55 + 0.45 * Math.min(1, forward));
  const idle = alive * (1 - smoothstep(0.4, 4.5, speed)) * (k.spin > 0 ? 0.6 : 1);
  const growl = alive * (k.boost > 0 ? 1 : 0);
  return { rate, engine, idle, growl };
}

export interface DriftTarget {
  on: boolean;
  rate: number;
  volume: number;
}

/** The squeal: on while sliding on the road at a decent speed, brighter and louder as the sparks go from blue to orange. */
export function driftTarget(k: KartView): DriftTarget {
  const on = k.drift !== 0 && k.hop < 0.25 && k.rescue <= 0 && !k.offroad && Math.abs(k.speed) > 5;
  return {
    on,
    rate: 0.88 + 0.3 * clamp(Math.abs(k.speed) / TOP_SPEED, 0, 1) + 0.09 * k.driftLevel,
    volume: 0.6 + 0.22 * k.driftLevel,
  };
}

/** The surfaces that sound under the wheels, with their cues. The road, a boost strip and the air make none. */
export const SURFACE_CUES = {
  ice: "kart_surf_ice",
  snow: "kart_surf_snow",
  sand: "kart_surf_sand",
  mud: "kart_surf_mud",
  grass: "kart_surf_grass",
} as const;

export type SoundingSurface = keyof typeof SURFACE_CUES;

export interface SurfaceTarget {
  surface: SoundingSurface | null;
  rate: number;
  volume: number;
}

export function surfaceTarget(k: KartView): SurfaceTarget {
  const surface = k.surface in SURFACE_CUES ? (k.surface as SoundingSurface) : null;
  const speed = Math.abs(k.speed);
  const grounded = k.hop < 0.2 && k.rescue <= 0;
  return {
    surface,
    rate: 0.8 + 0.45 * clamp(speed / TOP_SPEED, 0, 1),
    volume: surface && grounded ? smoothstep(1.5, 14, speed) : 0,
  };
}

/** The step of an exponential ease toward a target over ``dt``, with time constant ``tau``: smooths the jumps between a network's snapshots. */
export function ease(current: number, target: number, dt: number, tau: number): number {
  if (!(dt > 0)) return current;
  return lerp(current, target, 1 - Math.exp(-dt / Math.max(1e-4, tau)));
}

/** How much quieter each local engine is when more than one is on the screen: the mix has to hold four. */
export function crowdTrim(locals: number): number {
  return 1 / Math.sqrt(Math.max(1, locals));
}
