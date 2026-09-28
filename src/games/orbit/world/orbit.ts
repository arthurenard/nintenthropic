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

function ease(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
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
}

/**
 * Where the sun is and how dark it is. `day` is the art's sun (its bake),
 * `dip` how far below the station's horizontal the limb lies.
 */
export function skyAt(moment: SkyMoment, day: SunAt, dip: number): SkyState {
  if (moment.kind === "day") {
    const sun = { elevation: day.elevation - Math.min(PASS_SINK, PASS_DRIFT * moment.t), azimuth: day.azimuth };
    return { sun, night: nightFor(sun, dip) };
  }
  const t = Math.min(BREATHER, Math.max(0, moment.t));
  const low = { elevation: -dip - BELOW_LIMB, azimuth: SET_AZIMUTH };
  // Quickly down the sky, slowly over the limb (the colours are there), and below.
  const settle = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 2.5);
  let k: number;
  if (t <= SET_END) k = settle(t / SET_END);
  else if (t < RISE_START) k = 1;
  else k = settle(1 - (t - RISE_START) / (BREATHER - RISE_START));
  // Down steeply, sliding into view as it goes; up the same way.
  const kAz = Math.pow(k, 0.6);
  const sun = {
    elevation: day.elevation + (low.elevation - day.elevation) * k,
    azimuth: day.azimuth + (low.azimuth - day.azimuth) * kAz,
  };
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
