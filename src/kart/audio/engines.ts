/**
 * What a kart's loops should be doing right now, as pure functions of the
 * kart's state: which engine it has, how high it revs and how hard it
 * works, how its two recorded layers share the revs, when the idle and the
 * growl come in, when the tyres squeal and the sparks fizz, which surface is
 * under the wheels, and how another kart's engine bends in pitch as it goes
 * by. RaceAudio only applies these numbers (smoothed) to the running loops.
 */
import { characterById } from "../characters";
import type { KartView } from "../contract";
import { TUNING } from "../sim/tuning";

/** The kart's top speed on the road, m/s, the sim's own (docs/GRIP_PRIX.md); the revs are scaled against it. */
export const TOP_SPEED = TUNING.drive.topSpeed;

/**
 * The four engines: a light kart's buzzing two-stroke, a middleweight's
 * single-cylinder thumper, a heavy kart's lumpy V-twin, and Rivet the
 * robot's electric motor (heavy too, and as deep).
 */
export type EngineFamily = "light" | "middle" | "heavy" | "electric";
export const ENGINE_FAMILIES = ["light", "middle", "heavy", "electric"] as const satisfies readonly EngineFamily[];

/**
 * Each engine is recorded twice: low in its revs and high. A loop pitched
 * far from where it was made sounds thin sped up and dull slowed down, so
 * each layer covers half the range and the two cross over in the middle.
 */
export const ENGINE_LAYERS: Record<EngineFamily, { lo: string; hi: string }> = {
  light: { lo: "kart_engine_light_lo", hi: "kart_engine_light_hi" },
  middle: { lo: "kart_engine_middle_lo", hi: "kart_engine_middle_hi" },
  heavy: { lo: "kart_engine_heavy_lo", hi: "kart_engine_heavy_hi" },
  electric: { lo: "kart_engine_electric_lo", hi: "kart_engine_electric_hi" },
};

/** Every engine layer's cue. */
export const ENGINE_CUES = ENGINE_FAMILIES.flatMap((f) => [ENGINE_LAYERS[f].lo, ENGINE_LAYERS[f].hi]);

/** The revs (the scale `engineTarget` gives) at which the low and the high layers were recorded: each plays at revs / this. */
export const REV_LO = 0.9;
export const REV_HI = 1.6;

/**
 * Each engine's note at revs 1, Hz: the recipes in src/audio/cues/kart-motion.ts are made on these (the tests hold the
 * two together). The light kart's sings highest; the heavy one's V-twin lopes lowest, firing twice a cycle.
 */
export const ENGINE_NOTE: Record<EngineFamily, number> = { light: 110, middle: 84, heavy: 46, electric: 58 };

/**
 * The rasp of a working engine (`kart_engine_grit`) pulses 100 times a second at rate 1; this is the rate that puts it
 * on each engine's firings at revs 1 (the V-twin's two a cycle; the motor's drive buzz).
 */
export const GRIT_RATE: Record<EngineFamily, number> = { light: 1.1, middle: 0.84, heavy: 0.92, electric: 0.58 };

/** How much rasp each engine has when it works (an electric motor has little), and how its idle sits. */
const GRIT_SHARE: Record<EngineFamily, number> = { light: 1, middle: 0.9, heavy: 1, electric: 0.35 };
/** The idle loop's playback rate by engine (its thumps a second, against the middleweight's), 0 for none: a motor does not idle. */
export const IDLE_RATE: Record<EngineFamily, number> = { light: 1.22, middle: 1, heavy: 0.78, electric: 0 };

/**
 * The engine a kart has, by its driver: light, middle and heavy by weight,
 * and Rivet the robot's motor. A kart with no driver given (a test, an old
 * guest) takes the four in turn by ``index``, so four players are four
 * engines.
 */
export function engineFamily(character: string | undefined, index: number): EngineFamily {
  if (character === "rivet") return "electric";
  const c = characterById(character);
  if (c) return c.weight;
  return ENGINE_FAMILIES[((index % 4) + 4) % 4]!;
}

/** A little pitch offset per local player, so two karts with one engine are still two karts. */
export const PLAYER_PITCH = [1, 0.94, 1.065, 0.89] as const;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const smoothstep = (a: number, b: number, x: number): number => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export interface EngineTarget {
  /** How fast the engine turns: about 0.64 just moving, 1.75 at top speed, up to ~2.3 boosting in the air. A layer plays at revs / its own. */
  revs: number;
  /** Level of the engine's two layers together, 0..1. */
  engine: number;
  /** The rasp of an engine working hard, 0..1: pulling away, climbing, ploughing through sand, boosting. */
  grit: number;
  /** Level of the idle loop, 0..1 (it hands over to the engine as the kart moves off). */
  idle: number;
  /** Level of the growl, 0..1 (on while a boost lasts). */
  growl: number;
}

/**
 * Revs follow speed (from a low idle at a standstill to a shriek at top
 * speed and past it on a boost), rise a little in a drift (the wheels
 * spinning on the slide), fall off the road where the engine labours, rev
 * freely when the wheels leave the ground, sag in a spin-out, and the engine
 * is cut while the drone carries the kart. `work` (-1..1, from `engineWork`)
 * is how hard it pulls: pulling away or climbing it sings a little higher,
 * louder and rougher; lifting off or rolling downhill it drops back, quieter
 * and smoother.
 */
export function engineTarget(k: KartView, work = 0): EngineTarget {
  const f = k.speed / TOP_SPEED;
  const forward = Math.max(0, f);
  const w = clamp(work, -1, 1);
  const air = smoothstep(0.25, 0.9, k.hop);
  let revs = f >= 0 ? 0.64 + 1.1 * Math.pow(Math.min(forward, 1.6), 0.9) : 0.64 + 0.5 * Math.min(1, -f * 3);
  if (k.boost > 0) revs *= 1.08;
  if (k.drift !== 0) revs *= 1.03;
  if (k.offroad) revs *= 0.95;
  revs *= 1 + 0.2 * air;
  if (k.spin > 0) revs *= 0.75;
  revs *= 1 + (w > 0 ? 0.05 : 0.035) * w;
  const carried = k.rescue > 0;
  const speed = Math.abs(k.speed);
  const alive = carried ? 0 : 1;
  const pulling = Math.max(0, w);
  const lifting = Math.max(0, -w);
  const engine =
    alive *
    (k.spin > 0 ? 0.55 : 1) *
    smoothstep(0.2, 2.5, speed) *
    (0.6 + 0.4 * Math.min(1, forward)) *
    (1 + 0.15 * pulling - 0.28 * lifting) *
    (1 + 0.08 * air);
  const grit =
    alive *
    smoothstep(0.5, 4, speed) *
    clamp(0.22 + 0.7 * pulling - 0.2 * lifting + (k.boost > 0 ? 0.35 : 0) + (k.offroad ? 0.25 : 0) + (k.drift !== 0 ? 0.12 : 0) - 0.4 * air, 0, 1);
  const idle = alive * (1 - smoothstep(0.4, 4.5, speed)) * (k.spin > 0 ? 0.6 : 1);
  const growl = alive * (k.boost > 0 ? 1 : 0);
  return { revs, engine, grit, idle, growl };
}

/**
 * How hard the engine is working, -1..1: the kart's acceleration (m/s²) and the road's slope (rise over run) together,
 * as the force the engine must find: about 8 m/s² pulling away, or a 1-in-3 climb at a steady speed, is full load (a
 * toy kart's hills count for more than gravity alone would make them: a climb must be heard).
 */
export function engineWork(acceleration: number, slope = 0): number {
  return clamp((acceleration + 9.8 * 2.5 * slope) / 8, -1, 1);
}

/** The share of each layer at these revs: an equal-power crossover from the low layer to the high one. */
export function layerMix(revs: number): { lo: number; hi: number } {
  const u = smoothstep(1.08, 1.42, revs);
  return { lo: Math.cos(0.5 * Math.PI * u), hi: Math.sin(0.5 * Math.PI * u) };
}

/** The rasp's level for an engine, as a share of the engine's own (an electric motor whirs, it does not rasp). */
export function gritShare(family: EngineFamily): number {
  return GRIT_SHARE[family];
}

/**
 * Speed of sound for the karts' Doppler, m/s: a third of the real one, so a kart going by at a few metres a second
 * faster bends its note by a semitone or two as a toy racer's should, not by the real fraction of one.
 */
export const DOPPLER_SOUND = 110;

/**
 * The pitch factor of a sound from kart `source` heard at kart `listener`: higher while it closes in, lower as it
 * draws away. From the two karts' velocities (along `course`, or the heading), so it does not jitter with positions.
 */
export function doppler(source: KartView, listener: KartView): number {
  const dx = source.x - listener.x;
  const dz = source.z - listener.z;
  const d = Math.hypot(dx, dz) + 1;
  const hs = source.course ?? source.heading;
  const hl = listener.course ?? listener.heading;
  const vx = source.speed * Math.sin(hs) - listener.speed * Math.sin(hl);
  const vz = source.speed * Math.cos(hs) - listener.speed * Math.cos(hl);
  // Closing speed: positive when the gap shrinks.
  const closing = -(dx * vx + dz * vz) / d;
  return clamp(DOPPLER_SOUND / (DOPPLER_SOUND - clamp(closing, -40, 40)), 0.84, 1.18);
}

export interface WindTarget {
  rate: number;
  volume: number;
}

/**
 * The wind round the player's own kart: nothing at a cruise, rising toward top speed and past it on a boost, and
 * loudest in the air off a jump (a hop's few centimetres make none); in another kart's slipstream it rises, higher, as
 * the draft charges. Carried by the drone, none.
 */
export function windTarget(k: KartView): WindTarget {
  if (k.rescue > 0) return { rate: 1, volume: 0 };
  const speed = Math.abs(k.speed);
  const air = smoothstep(0.5, 2.2, k.hop);
  const draft = clamp(k.draft ?? 0, 0, 1);
  const volume = Math.min(1, smoothstep(15, 30, speed) * 0.6 + air * 0.55 + draft * 0.35 + (k.boost > 0 ? 0.15 : 0));
  return { rate: 0.75 + 0.4 * clamp(speed / TOP_SPEED, 0, 1.3) + 0.12 * air + 0.15 * draft, volume };
}

export interface DriftTarget {
  on: boolean;
  rate: number;
  volume: number;
  /** The sparks' fizz under the squeal: none before the first spark, then hotter and higher at each level. */
  sparks: number;
  sparkRate: number;
}

/** Each spark level a step up: the squeal a tone and a half, the fizz a major third. */
const SQUEAL_STEP = Math.pow(2, 1.5 / 12);
const SPARK_RATE = [1, 1, 1.26, 1.59] as const;
const SPARK_LEVEL = [0, 0.5, 0.75, 1] as const;

/** The squeal: on while sliding on the road at a decent speed, louder and a step higher at each spark level, its fizz building with it. */
export function driftTarget(k: KartView): DriftTarget {
  const on = k.drift !== 0 && k.hop < 0.25 && k.rescue <= 0 && !k.offroad && Math.abs(k.speed) > 5;
  const level = clamp(Math.round(k.driftLevel), 0, 3);
  return {
    on,
    rate: (0.86 + 0.26 * clamp(Math.abs(k.speed) / TOP_SPEED, 0, 1)) * Math.pow(SQUEAL_STEP, level),
    volume: Math.min(1, 0.45 + 0.15 * level + 0.12 * Math.abs(k.steer)),
    sparks: on ? SPARK_LEVEL[level]! : 0,
    sparkRate: SPARK_RATE[level]!,
  };
}

/**
 * The sound of the ground under the wheels, with its cue: the tyres' roll on
 * the road (and along a boost strip), and each surface off it. The air makes
 * none.
 */
export const SURFACE_CUES = {
  road: "kart_tyre_road",
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
  const ground = k.surface === "boost" ? "road" : k.surface;
  const surface = ground in SURFACE_CUES ? (ground as SoundingSurface) : null;
  const speed = Math.abs(k.speed);
  const grounded = k.hop < 0.2 && k.rescue <= 0;
  // The road's roll is the quietest and grows with speed the longest; a surface off it is heard from a crawl.
  const road = surface === "road";
  return {
    surface,
    rate: road ? 0.7 + 0.55 * clamp(speed / TOP_SPEED, 0, 1.25) : 0.8 + 0.45 * clamp(speed / TOP_SPEED, 0, 1),
    volume: surface && grounded ? (road ? 0.75 * smoothstep(2, 24, speed) : smoothstep(1.5, 14, speed)) : 0,
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

/**
 * Another kart's engine as heard from the nearest local one: full beside it, falling to nothing at ENGINE_RADIUS (the
 * engine's own distance roll-off and air come on top), and stepped down by its rank among the others heard, so the
 * one alongside stands out of the pack instead of eight engines making one roar.
 */
export const ENGINE_RADIUS = 70;
const RANK_GAIN = [1, 0.72, 0.56, 0.46] as const;
export function rivalLevel(distance: number, rank: number): number {
  const reach = distance <= 0 ? 1 : distance >= ENGINE_RADIUS ? 0 : 1 - Math.pow(distance / ENGINE_RADIUS, 1.5);
  return 0.85 * reach * (RANK_GAIN[Math.min(rank, RANK_GAIN.length - 1)] ?? 0.4);
}
