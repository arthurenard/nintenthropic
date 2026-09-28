/**
 * The round in flight: how long it takes to get there, how far it falls
 * and how far the wind carries it. Pure maths, so the scope's reticle, the
 * holdover dot, the world's shots and the balance tests all agree to the
 * millimetre.
 *
 * The model is the flat-fire one a real rifleman's tables come from:
 *
 * - Drag slows the round in proportion to its speed squared, so over the
 *   distance it covers its speed falls as v(x) = v0·e^(−k·x), and the time to
 *   reach x is t(x) = (e^(k·x) − 1) / (k·v0).
 * - Gravity pulls it down ½·g·t(x)² below the line the barrel points along.
 *   The barrel points a little above the line of sight, so the round rises
 *   through the sight line, peaks, and crosses it again at the zero range.
 * - A crosswind carries it aside in proportion to t(x)²: the round lags the
 *   moving air it passes through.
 *
 * The numbers are the design's (docs/OVERWATCH_RIDGE.md): 600 m/s, 0.4 s to
 * 250 m and 1.2 s to 700 m, zeroed at 150 m, 1.6 m low at 600 m held dead
 * on. That fall is gentler than the Earth's gravity would give a round this
 * slow (about 4 m at 600 m), so g here is the game's: it keeps every hold
 * the valley asks for inside the scope's marks. The reticle's marks are
 * drawn from these same functions, so what the scope shows is what the
 * round does.
 */
import type { V3 } from "../../../engine/rules/raymath";
import { DRAG, DROP_AT_600, MUZZLE_VELOCITY, WIND_DRIFT, ZERO_RANGE } from "./tuning";

export interface RoundModel {
  /** Muzzle velocity, m/s. */
  v0: number;
  /** Drag, per metre. */
  k: number;
  /** The game's gravity, m/s². */
  g: number;
  /** Zero range, metres. */
  zero: number;
  /** Crosswind drift coefficient: metres per (m/s of wind × s² of flight). */
  wind: number;
}

/** Seconds for a round with muzzle velocity `v0` and drag `k` to travel `x` metres. */
function flight(x: number, v0: number, k: number): number {
  if (!(x > 0)) return 0;
  return k > 0 ? Math.expm1(k * x) / (k * v0) : x / v0;
}

/**
 * The gravity that gives the design's drop: a round zeroed at ZERO_RANGE
 * lands DROP_AT_600 below the line of sight at 600 m.
 */
function designGravity(): number {
  const t600 = flight(600, MUZZLE_VELOCITY, DRAG);
  const tZero = flight(ZERO_RANGE, MUZZLE_VELOCITY, DRAG);
  // drop(600) = ½g·t600² − (½g·tZero² / zero)·600
  return DROP_AT_600 / (0.5 * t600 * t600 - (0.5 * tZero * tZero * 600) / ZERO_RANGE);
}

export const ROUND: Readonly<RoundModel> = Object.freeze({
  v0: MUZZLE_VELOCITY,
  k: DRAG,
  g: designGravity(),
  zero: ZERO_RANGE,
  wind: WIND_DRIFT,
});

/** Seconds from the muzzle to `x` metres downrange. */
export function timeOfFlight(x: number, m: RoundModel = ROUND): number {
  return flight(x, m.v0, m.k);
}

/** The round's speed `x` metres downrange, m/s. */
export function speedAt(x: number, m: RoundModel = ROUND): number {
  return m.v0 * Math.exp(-m.k * Math.max(0, x));
}

/** How far downrange the round is `t` seconds after the shot, metres. */
export function rangeAt(t: number, m: RoundModel = ROUND): number {
  if (!(t > 0)) return 0;
  return m.k > 0 ? Math.log1p(m.k * m.v0 * t) / m.k : m.v0 * t;
}

/** How far gravity has pulled the round below the barrel's line by `x` metres. */
function fall(x: number, m: RoundModel): number {
  const t = timeOfFlight(x, m);
  return 0.5 * m.g * t * t;
}

/** How far above the line of sight the barrel points, radians: the zero. */
export function zeroAngle(m: RoundModel = ROUND): number {
  return fall(m.zero, m) / m.zero;
}

/**
 * Where the round is relative to the line of sight `x` metres downrange,
 * in metres BELOW it: negative while it is above (between the muzzle and
 * the zero), zero at the zero range, growing past it.
 */
export function drop(x: number, m: RoundModel = ROUND): number {
  if (!(x > 0)) return 0;
  return fall(x, m) - zeroAngle(m) * x;
}

/** How far a crosswind of `wind` m/s carries the round by `x` metres, in the wind's direction. */
export function drift(x: number, wind: number, m: RoundModel = ROUND): number {
  const t = timeOfFlight(x, m);
  return m.wind * wind * t * t;
}

/** The hold for the drop at `x` metres, milliradians above the target (1 mil is 1 m at 1,000 m). */
export function holdMils(x: number, m: RoundModel = ROUND): number {
  return x > 0 ? (1000 * drop(x, m)) / x : 0;
}

/** The hold for the wind at `x` metres, milliradians into the wind. */
export function windMils(x: number, wind: number, m: RoundModel = ROUND): number {
  return x > 0 ? (1000 * drift(x, wind, m)) / x : 0;
}

/**
 * The scope's range marks below the centre: one for every hundred metres
 * from 300 to 900. Put the target on the mark for its range - one mark more
 * for every hundred metres past the first two.
 */
export const RANGE_MARKS: readonly number[] = [300, 400, 500, 600, 700, 800, 900];

/** Each range mark's hold in milliradians below the centre. */
export function rangeMarkMils(m: RoundModel = ROUND): { range: number; mils: number }[] {
  return RANGE_MARKS.map((range) => ({ range, mils: holdMils(range, m) }));
}

/**
 * The line of sight's own frame, for placing the round in the world: `up`
 * is the world's up made square to the line, `side` the wind's direction
 * made square to it (scaled by the crosswind's speed).
 */
export interface SightFrame {
  origin: V3;
  /** Unit direction of the line of sight. */
  dir: V3;
  /** Unit, square to `dir`, as near the world's up as can be. */
  up: V3;
  /** The crosswind: the wind's velocity with its part along the line removed, m/s. */
  cross: V3;
}

/** The frame for a shot from `origin` along `dir` (unit) in a wind blowing `windX` m/s along +X. */
export function sightFrame(origin: V3, dir: V3, windX: number): SightFrame {
  // up⊥ = Y − dir·(dir·Y)
  let ux = -dir.x * dir.y;
  let uy = 1 - dir.y * dir.y;
  let uz = -dir.z * dir.y;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  // cross = W − dir·(dir·W), W = (windX, 0, 0)
  const along = dir.x * windX;
  return {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
    up: { x: ux, y: uy, z: uz },
    cross: { x: windX - dir.x * along, y: -dir.y * along, z: -dir.z * along },
  };
}

/** Where the round is `x` metres downrange along the frame's line of sight, into `out`. */
export function roundAt(f: SightFrame, x: number, out: V3, m: RoundModel = ROUND): V3 {
  const below = drop(x, m);
  const t = timeOfFlight(x, m);
  const carried = m.wind * t * t;
  out.x = f.origin.x + f.dir.x * x - f.up.x * below + f.cross.x * carried;
  out.y = f.origin.y + f.dir.y * x - f.up.y * below + f.cross.y * carried;
  out.z = f.origin.z + f.dir.z * x - f.up.z * below + f.cross.z * carried;
  return out;
}

/**
 * The holdover dot's offset for a target `range` metres away in a wind of
 * `windX` along the line `dir`: where, in milliradians from the reticle's
 * centre, the round will land (x right, y down), as the scope would show it.
 */
export function landingMils(range: number, dir: V3, windX: number, m: RoundModel = ROUND): { right: number; down: number } {
  const f = sightFrame({ x: 0, y: 0, z: 0 }, dir, windX);
  // The camera's right, square to the line and to its up.
  const rx = f.dir.y * f.up.z - f.dir.z * f.up.y;
  const ry = f.dir.z * f.up.x - f.dir.x * f.up.z;
  const rz = f.dir.x * f.up.y - f.dir.y * f.up.x;
  const t = timeOfFlight(range, m);
  const carried = m.wind * t * t;
  const right = (f.cross.x * rx + f.cross.y * ry + f.cross.z * rz) * carried;
  return { right: range > 0 ? (1000 * right) / range : 0, down: holdMils(range, m) };
}
