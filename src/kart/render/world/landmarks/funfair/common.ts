/**
 * What every funfair model is painted and trimmed with: the candy palette,
 * the glow colours (above 1, so they bloom), the pieces the rides and stalls
 * keep repeating (a bulb, a string of bulbs, a barber's-pole rod, a scalloped
 * edge), and block letters for a sign.
 */
import { MeshBuilder, rgb, scaleRgb, type Rgb, type V3 } from "../kit";

export const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────

export const RED = rgb("#ff3355");
export const ORANGE = rgb("#ff8a2a");
export const YELLOW = rgb("#ffd23a");
export const GREEN = rgb("#37d67a");
export const TEAL = rgb("#1fc8c8");
export const BLUE = rgb("#3b82ff");
export const PURPLE = rgb("#9a5cff");
export const PINK = rgb("#ff6fb7");
export const CREAM = rgb("#fff1d6");
export const WHITE = rgb("#ffffff");
export const NAVY = rgb("#2a2150");
export const GOLD = rgb("#ffc233");
export const BRASS = rgb("#e8b84a");
export const STEEL = rgb("#c9cde0");
export const DARK = rgb("#241a45");
export const CANDY: Rgb[] = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK];

// Glow colours: above 1 so they bloom.
export const G_GOLD: Rgb = [4, 2.4, 1];
export const G_PINK: Rgb = [4, 0.6, 2.2];
export const G_CYAN: Rgb = [0.8, 3, 4];
const G_GREEN: Rgb = [0.9, 3.4, 1.3];
export const G_WARM: Rgb = [3.4, 2.1, 0.9];
export const G_WHITE: Rgb = [3.4, 3.2, 3];
export const G_RED: Rgb = [4, 0.5, 0.6];
const LIGHTS: Rgb[] = [G_GOLD, G_PINK, G_CYAN, G_GREEN];

export const candyAt = (i: number): Rgb => CANDY[((i % CANDY.length) + CANDY.length) % CANDY.length]!;
export const lightAt = (i: number): Rgb => LIGHTS[((i % LIGHTS.length) + LIGHTS.length) % LIGHTS.length]!;

// ─── Trim ────────────────────────────────────────────────────────────────────

/** A little glowing bulb: a box turned on its corner so it catches light from every side. */
export function bulb(g: MeshBuilder, x: number, y: number, z: number, s: number, c: Rgb): void {
  g.box(x, y, z, s, s, s, c, 0.7, 0.6, 0.3);
}

/** A string of bulbs from a to b, `n` of them, colours cycling. */
export function bulbLine(g: MeshBuilder, a: V3, b: V3, n: number, s: number, offset = 0): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    bulb(g, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, s, lightAt(i + offset));
  }
}

/** A rod cut into striped pieces, like a barber's pole: candy legs, striped masts. */
export function stripedRod(b: MeshBuilder, a: V3, c: V3, thick: number, pieces: number, ca: Rgb, cb: Rgb): void {
  for (let k = 0; k < pieces; k++) {
    const t0 = k / pieces;
    const t1 = (k + 1) / pieces;
    const p = (t: number): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    b.rod(p(t0), p(t1), thick, k % 2 === 0 ? ca : cb);
  }
}

/** A scalloped edge: `n` half-round tabs hanging along the line from a to b (y down), alternating two colours. */
export function scallops(b: MeshBuilder, a: V3, c: V3, n: number, drop: number, ca: Rgb, cb: Rgb): void {
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const lerp = (t: number, dy = 0): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t + dy, a[2] + (c[2] - a[2]) * t];
    const col = i % 2 === 0 ? ca : cb;
    const top = scaleRgb(col, 0.85);
    const m0 = lerp(t0);
    const m1 = lerp(t1);
    // Five points round the half circle.
    const arcPt = (k: number): V3 => {
      const u = k / 4;
      const sag = Math.sin(u * Math.PI) * drop;
      return lerp(t0 + (t1 - t0) * u, -sag);
    };
    for (let k = 0; k < 4; k++) b.tri(k === 0 ? m0 : arcPt(k), arcPt(k + 1), k === 0 ? arcPt(1) : m1, top, col, col);
    b.tri(m0, m1, arcPt(2), top, top, col);
  }
}

// ─── Block letters (5 x 7 cells) ─────────────────────────────────────────────

/** Rectangles [c0, r0, c1, r1] in cells, columns left to right, rows bottom to top: the letters the entrance arch spells. */
const LETTERS: Record<string, readonly (readonly [number, number, number, number])[]> = {
  F: [[0, 0, 1, 7], [0, 6, 5, 7], [0, 3, 4, 4]],
  U: [[0, 1, 1, 7], [4, 1, 5, 7], [0, 0, 5, 1]],
  N: [[0, 0, 1, 7], [4, 0, 5, 7]],
  A: [[0, 0, 1, 6], [4, 0, 5, 6], [1, 6, 4, 7], [1, 3, 4, 4]],
  I: [[0, 6, 5, 7], [0, 0, 5, 1], [2, 1, 3, 6]],
  R: [[0, 0, 1, 7], [1, 6, 4, 7], [4, 4, 5, 6.2], [1, 3, 4, 4]],
};

/**
 * Block letters as boxes, reading left to right along +x when seen from +z
 * (or the other way round with `flip`). `x` is the left edge in the reader's
 * frame, `y` the baseline, `cell` one cell in metres, `depth` along z.
 */
export function blockText(b: MeshBuilder, text: string, x: number, y: number, z: number, cell: number, depth: number, colour: (i: number) => Rgb, flip = false): number {
  let cursor = 0;
  let index = 0;
  for (const ch of text) {
    if (ch === " ") {
      cursor += 3;
      continue;
    }
    const rects = LETTERS[ch];
    if (!rects) continue;
    const col = colour(index++);
    const mx = (c: number): number => x + (flip ? -1 : 1) * (cursor + c) * cell;
    for (const [c0, r0, c1, r1] of rects) {
      b.box((mx(c0) + mx(c1)) / 2, y + ((r0 + r1) / 2) * cell, z, (c1 - c0) * cell, (r1 - r0) * cell, depth, col);
    }
    // The diagonals that boxes cannot make.
    if (ch === "N") b.rod([mx(0.6), y + 6.6 * cell, z], [mx(4.4), y + 0.4 * cell, z], cell * 1.15, col);
    if (ch === "R") b.rod([mx(2.2), y + 3.2 * cell, z], [mx(4.6), y + 0.1 * cell, z], cell * 1.1, col);
    cursor += 5 + 1;
  }
  return cursor * cell;
}
