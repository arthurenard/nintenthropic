/**
 * What every effect draws with: the card's scene (its size and the clock), the looping phase helpers, a fixed pseudo-random
 * number, the four-point star, and `clearOf`, which keeps the effects off the face in the middle of a webcam picture.
 */
import { LOOP } from "./looks";

export type Ctx = CanvasRenderingContext2D;

/** The card being drawn on: its size, a unit of size (its shorter side), and the clock, seconds. */
export interface Scene {
  w: number;
  h: number;
  u: number;
  t: number;
  /** Seconds since the results came up, for the one-off touches (a clip's first flash); undefined for a loop frame. */
  intro?: number;
}

export const TAU = Math.PI * 2;
export const frac = (x: number) => x - Math.floor(x);
/** A fixed pseudo-random number in 0..1 for the i-th thing (and a salt for another). */
export const rnd = (i: number, salt = 0) => frac(Math.sin(i * 127.1 + salt * 311.7 + 1.7) * 43758.5453);
/** A looping phase 0..1: `k` whole cycles in LOOP, shifted by `off`. */
export const ph = (t: number, k: number, off = 0) => frac((t * k) / LOOP + off);
export const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
export const sine = (t: number, k: number, off = 0) => Math.sin(TAU * ph(t, k, off));
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => {
  const v = clamp01(x);
  return v * v * (3 - 2 * v);
};

/** Where a face is in a webcam picture: the middle, a little above the centre. */
const FACE = { x: 0.5, y: 0.46, rx: 0.25, ry: 0.34 };

/**
 * How much of an effect may show at x, y: 1 away from the face, fading to a tenth over it (an effect that shrinks by this
 * is a smaller speck over the face, not a pop). Used by the things that drift across the whole card.
 */
export function clearOf(s: Scene, x: number, y: number): number {
  const d = Math.hypot((x / s.w - FACE.x) / FACE.rx, (y / s.h - FACE.y) / FACE.ry);
  return 0.1 + 0.9 * smooth((d - 0.75) / 0.6);
}

/** A four-point twinkle. */
export function star(c: Ctx, x: number, y: number, r: number): void {
  const inner = r * 0.18;
  c.moveTo(x, y - r);
  c.lineTo(x + inner, y - inner);
  c.lineTo(x + r, y);
  c.lineTo(x + inner, y + inner);
  c.lineTo(x, y + r);
  c.lineTo(x - inner, y + inner);
  c.lineTo(x - r, y);
  c.lineTo(x - inner, y - inner);
  c.closePath();
}

/** Four-point twinkles at fixed places, each blooming once per loop (or twice), kept off the face. */
export function sparkles(c: Ctx, s: Scene, n: number, size: number, colour: string, salt: number, box = { x: 0, y: 0, w: 1, h: 1 }): void {
  c.fillStyle = colour;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const p = ph(s.t, 1 + (i % 2), rnd(i, salt));
    const bloom = Math.sin(Math.PI * p) ** 3;
    if (bloom < 0.04) continue;
    const x = s.w * (box.x + box.w * rnd(i, salt + 1));
    const y = s.h * (box.y + box.h * rnd(i, salt + 2));
    star(c, x, y, s.u * size * (0.5 + rnd(i, salt + 3)) * bloom * clearOf(s, x, y));
  }
  c.fill();
}
