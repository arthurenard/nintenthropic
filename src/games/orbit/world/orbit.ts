/**
 * The station's orbit, as the game tells it: the sun where the art baked it
 * through each pass (drifting a little lower as the terminator sweeps),
 * setting over the limb in each breather, a few seconds of night, and
 * rising again; the ground turning under the station; the Moon rising over
 * the limb from the fourth pass. Directions are given relative to the
 * station - elevation above its horizontal (the plane square to the
 * planet's centre) and azimuth round from the view's heading, + to the
 * right - so the world can place them however the art sits. Pure maths.
 */
import { BREATHER } from "../rules/tuning";

const DEG = Math.PI / 180;

export interface SunAt {
  /** Above the station's horizontal, radians. */
  elevation: number;
  /** Round from the view's heading, + to the right, radians. */
  azimuth: number;
}

export interface SkyState {
  sun: SunAt;
  /** 0 in daylight .. 1 in the planet's shadow (the eye adapted, the stars out). */
  night: number;
}

/** In a pass the sun sinks this slowly (radians a second), never more than PASS_SINK. */
export const PASS_DRIFT = 0.06 * DEG;
export const PASS_SINK = 7 * DEG;
/** The breather: sunset over [0, SET_END], night until RISE_START, sunrise to its end. */
export const SET_END = 3.4;
export const RISE_START = 5.3;
/** Where the sun sets: this far round to the left, in view, and this far below the limb at night. */
export const SET_AZIMUTH = -34 * DEG;
export const BELOW_LIMB = 4 * DEG;
/**
 * The sun's height over the limb through a breather, as (seconds, radians)
 * keys after the first (where the pass left it) and before the last (the
 * art's sun again): quickly down the sky, a slow second and a half through
 * the last few degrees and over the limb - the colours are there - then
 * below; the same, reversed, at sunrise.
 */
const SET_KEYS: readonly [number, number][] = [
  [1.3, 3.5 * DEG],
  [2.9, -0.8 * DEG],
  [SET_END, -BELOW_LIMB],
  [RISE_START, -BELOW_LIMB],
  [5.8, -0.8 * DEG],
  [7.0, 3.5 * DEG],
];
/** By when the sun has come round into view to set (and from when it goes back after rising). */
const SLIDE_IN = 1.3;
const SLIDE_OUT = 7.0;

function ease(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/**
 * A smooth curve through keys that never overshoots them (a monotone cubic,
 * Fritsch-Carlson): the sun never bobs back up as it sets.
 */
export function monotone(keys: readonly [number, number][], t: number): number {
  const n = keys.length;
  const first = keys[0] as [number, number];
  const last = keys[n - 1] as [number, number];
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  const slope = (i: number) => {
    const a = keys[i] as [number, number];
    const b = keys[i + 1] as [number, number];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  const tangent = (i: number) => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const s0 = slope(i - 1);
    const s1 = slope(i);
    return s0 * s1 <= 0 ? 0 : (2 * s0 * s1) / (s0 + s1);
  };
  let i = 0;
  while (t > (keys[i + 1] as [number, number])[0]) i++;
  const a = keys[i] as [number, number];
  const b = keys[i + 1] as [number, number];
  const h = b[0] - a[0];
  const u = (t - a[0]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a[1] + (u3 - 2 * u2 + u) * h * tangent(i) + (-2 * u3 + 3 * u2) * b[1] + (u3 - u2) * h * tangent(i + 1);
}

/**
 * The night as the sun's height over the limb says it: 0 while any of the
 * sun is up, 1 once it is two degrees down.
 */
export function nightFor(sun: SunAt, dip: number): number {
  const over = sun.elevation + dip;
  return ease((-over - 0.3 * DEG) / (2 * DEG));
}

export interface SkyMoment {
  /** "day": a pass (or the aim check, the title card, the end); "breather": the night side. */
  kind: "day" | "breather";
  /** Seconds into it. */
  t: number;
  /** A breather: how long the pass before it lasted (where it left the sun). */
  after?: number;
}

/** The sun in a pass, `t` seconds in: the art's, sinking a little as the terminator nears. */
function passSun(day: SunAt, t: number): SunAt {
  return { elevation: day.elevation - Math.min(PASS_SINK, PASS_DRIFT * Math.max(0, t)), azimuth: day.azimuth };
}

/**
 * Where the sun is and how dark it is. `day` is the art's sun (its bake),
 * `dip` how far below the station's horizontal the limb lies.
 */
export function skyAt(moment: SkyMoment, day: SunAt, dip: number): SkyState {
  if (moment.kind === "day") {
    const sun = passSun(day, moment.t);
    return { sun, night: nightFor(sun, dip) };
  }
  const t = Math.min(BREATHER, Math.max(0, moment.t));
  const from = passSun(day, moment.after ?? 0);
  const keys: [number, number][] = [[0, from.elevation + dip], ...SET_KEYS, [BREATHER, day.elevation + dip]];
  // Round into view to set, and back to the art's place after rising.
  const az = t < SLIDE_OUT ? from.azimuth + (SET_AZIMUTH - from.azimuth) * ease(t / SLIDE_IN) : SET_AZIMUTH + (day.azimuth - SET_AZIMUTH) * ease((t - SLIDE_OUT) / (BREATHER - SLIDE_OUT));
  const sun = { elevation: monotone(keys, t) - dip, azimuth: az };
  return { sun, night: nightFor(sun, dip) };
}

/** How fast the ground turns under the station, radians of the planet a second (about twice the real rate). */
export const GROUND_RATE = 0.14 * DEG;
/** In the breathers the ground turns faster: the night side is a time-lapse. */
export const BREATHER_GROUND_RATE = 1.2 * DEG;

/** The Moon rises over the limb from this pass on. */
export const MOON_RISE_RATE = 0.16 * DEG;
export const MOON_TOP = 11 * DEG;
export const MOON_AZIMUTH = 24 * DEG;
/** Its disc, a little larger than life so it can be found and shot. */
export const MOON_RADIUS = 0.9 * DEG;

/** Where the Moon is, `t` seconds after it began to rise: from just under the limb up to MOON_TOP over it. */
export function moonAt(t: number, dip: number): SunAt {
  return { elevation: -dip - 2 * DEG + Math.min(MOON_TOP + 2 * DEG, Math.max(0, t) * MOON_RISE_RATE), azimuth: MOON_AZIMUTH };
}
