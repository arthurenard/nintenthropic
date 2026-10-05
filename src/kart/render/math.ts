/**
 * Small pure helpers for the picture: easing, angles, and smoothing that does
 * not depend on the frame rate. Nothing here touches three.js or the DOM, so
 * it is cheap to test.
 */

export const TAU = Math.PI * 2;

export function clamp(x: number, lo = 0, hi = 1): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0 below `a`, 1 above `b`, a smooth S in between. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Moves `current` toward `target` the way a spring with no overshoot would:
 * the same amount of easing whether frames take 4 ms or 40 ms. `rate` is how
 * quickly it closes in, per second (4 is lazy, 15 is snappy).
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** An angle brought into -PI..PI. */
export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

/** The signed shortest turn from `from` to `to`, radians. */
export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** `damp` for angles: takes the short way round. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));
}

/** Easing that starts fast and settles (for things that arrive). */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t);
  return 1 - u * u * u;
}

/** A cheap repeatable hash of two integers to 0..1, for scattering things the same way every time. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1, from `hash2` on a lattice; a few of these add up to rolling ground. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Layered noise in about 0..1 (each octave half as strong and twice as fine). */
export function fbm2(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f + i * 17.3, y * f - i * 9.1) * amp;
    total += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / total;
}

/** m:ss.t, for tabular figures: 48.31 s reads "0:48.3". */
export function formatRaceTime(seconds: number, decimals = 1): string {
  const s = Math.max(0, seconds);
  const factor = 10 ** decimals;
  const total = Math.floor(s * factor + 1e-6) / factor;
  const m = Math.floor(total / 60);
  const rest = total - m * 60;
  return `${m}:${rest.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, "0")}`;
}

/** 1 → "1" + "st", 2 → "2" + "nd", 11 → "11" + "th": the place as a player says it. */
export function ordinal(n: number): { number: string; suffix: string } {
  const mod100 = n % 100;
  const mod10 = n % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return { number: String(n), suffix };
}
