/**
 * The funfair world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build").
 *
 * A fairground at dusk: every ride is lit, so the weight of each model is in
 * its `glow` builder (bulbs, neon, windows) and its halos, with chunky candy
 * coloured bodies underneath.
 */
import { Group, Matrix4, Mesh, Vector3 } from "three";
import { byHeight, extrudeZ, grid, lathe, MeshBuilder, mixRgb, pipe, ramp, rgb, scaleRgb, shapes, stripes, torus, tube, xf, type Rgb, type V3 } from "./kit";
import type { Halo, HazardSpec, LandmarkSpec, MovingPart } from "./types";

export const LANDMARKS: Record<string, LandmarkSpec> = {};
export const HAZARDS: Record<string, HazardSpec> = {};

const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────

const RED = rgb("#ff3355");
const ORANGE = rgb("#ff8a2a");
const YELLOW = rgb("#ffd23a");
const GREEN = rgb("#37d67a");
const TEAL = rgb("#1fc8c8");
const BLUE = rgb("#3b82ff");
const PURPLE = rgb("#9a5cff");
const PINK = rgb("#ff6fb7");
const CREAM = rgb("#fff1d6");
const WHITE = rgb("#ffffff");
const NAVY = rgb("#2a2150");
const GOLD = rgb("#ffc233");
const BRASS = rgb("#e8b84a");
const STEEL = rgb("#c9cde0");
const DARK = rgb("#241a45");
const CANDY: Rgb[] = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK];

// Glow colours: above 1 so they bloom.
const G_GOLD: Rgb = [4, 2.4, 1];
const G_PINK: Rgb = [4, 0.6, 2.2];
const G_CYAN: Rgb = [0.8, 3, 4];
const G_GREEN: Rgb = [0.9, 3.4, 1.3];
const G_WARM: Rgb = [3.4, 2.1, 0.9];
const G_WHITE: Rgb = [3.4, 3.2, 3];
const G_RED: Rgb = [4, 0.5, 0.6];
const LIGHTS: Rgb[] = [G_GOLD, G_PINK, G_CYAN, G_GREEN];

const candyAt = (i: number): Rgb => CANDY[((i % CANDY.length) + CANDY.length) % CANDY.length]!;
const lightAt = (i: number): Rgb => LIGHTS[((i % LIGHTS.length) + LIGHTS.length) % LIGHTS.length]!;

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Copies every triangle of `src` into `dst` through a matrix: one hand-built horse, stamped eight times. */
function stamp(dst: MeshBuilder, src: MeshBuilder, m: Matrix4): void {
  const p = src.position;
  const c = src.color;
  const e = m.elements;
  const at = (i: number): V3 => [
    e[0]! * p[i]! + e[4]! * p[i + 1]! + e[8]! * p[i + 2]! + e[12]!,
    e[1]! * p[i]! + e[5]! * p[i + 1]! + e[9]! * p[i + 2]! + e[13]!,
    e[2]! * p[i]! + e[6]! * p[i + 1]! + e[10]! * p[i + 2]! + e[14]!,
  ];
  for (let i = 0; i < p.length; i += 9) {
    dst.tri(at(i), at(i + 3), at(i + 6), [c[i]!, c[i + 1]!, c[i + 2]!], [c[i + 3]!, c[i + 4]!, c[i + 5]!], [c[i + 6]!, c[i + 7]!, c[i + 8]!]);
  }
}

/** A little glowing bulb: a box turned on its corner so it catches light from every side. */
function bulb(g: MeshBuilder, x: number, y: number, z: number, s: number, c: Rgb): void {
  g.box(x, y, z, s, s, s, c, 0.7, 0.6, 0.3);
}

/** A string of bulbs from a to b, `n` of them, colours cycling. */
function bulbLine(g: MeshBuilder, a: V3, b: V3, n: number, s: number, offset = 0): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    bulb(g, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, s, lightAt(i + offset));
  }
}

/** A rod cut into striped pieces, like a barber's pole: candy legs, striped masts. */
function stripedRod(b: MeshBuilder, a: V3, c: V3, thick: number, pieces: number, ca: Rgb, cb: Rgb): void {
  for (let k = 0; k < pieces; k++) {
    const t0 = k / pieces;
    const t1 = (k + 1) / pieces;
    const p = (t: number): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    b.rod(p(t0), p(t1), thick, k % 2 === 0 ? ca : cb);
  }
}

/** A flat disc facing +z (a dart board ring, a clock face): axis along z. */
function disc(b: MeshBuilder, x: number, y: number, z: number, r: number, thick: number, paint: Rgb | { bottom: Rgb; top: Rgb }, seg = 16): void {
  b.add(shapes.cylinder(seg), xf(x, y, z, r, thick, r, 0, Math.PI / 2), paint);
}

/** A scalloped edge: `n` half-round tabs hanging along the line from a to b (y down), alternating two colours. */
function scallops(b: MeshBuilder, a: V3, c: V3, n: number, drop: number, ca: Rgb, cb: Rgb): void {
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

/** A candy-striped box face wall: vertical stripes across the front of a stall. */
function stripedWall(b: MeshBuilder, x0: number, x1: number, y0: number, y1: number, z: number, n: number, ca: Rgb, cb: Rgb, shaded = true): void {
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n;
    const xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const col = i % 2 === 0 ? ca : cb;
    b.quad([xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], shaded ? scaleRgb(col, 0.62) : col, shaded ? scaleRgb(col, 0.62) : col, col, col);
  }
}

// ─── Block letters (5 x 7 cells) ─────────────────────────────────────────────

/** Rectangles [c0, r0, c1, r1] in cells, columns left to right, rows bottom to top. */
const LETTERS: Record<string, readonly (readonly [number, number, number, number])[]> = {
  F: [[0, 0, 1, 7], [0, 6, 5, 7], [0, 3, 4, 4]],
  U: [[0, 1, 1, 7], [4, 1, 5, 7], [0, 0, 5, 1]],
  N: [[0, 0, 1, 7], [4, 0, 5, 7]],
  A: [[0, 0, 1, 6], [4, 0, 5, 6], [1, 6, 4, 7], [1, 3, 4, 4]],
  I: [[0, 6, 5, 7], [0, 0, 5, 1], [2, 1, 3, 6]],
  R: [[0, 0, 1, 7], [1, 6, 4, 7], [4, 4, 5, 6.2], [1, 3, 4, 4]],
  "1": [[2, 0, 3, 7], [1, 5, 2, 6], [1, 0, 4, 1]],
  "2": [[0, 6, 5, 7], [4, 4, 5, 6], [0, 3, 5, 4], [0, 1, 1, 3], [0, 0, 5, 1]],
  "3": [[0, 6, 5, 7], [1, 3, 5, 4], [0, 0, 5, 1], [4, 0, 5, 7]],
  "6": [[0, 0, 1, 7], [1, 6, 5, 7], [1, 3, 5, 4], [1, 0, 5, 1], [4, 1, 5, 3]],
  "9": [[4, 0, 5, 7], [0, 6, 4, 7], [0, 3, 4, 4], [0, 4, 1, 6], [0, 0, 4, 1]],
};

/**
 * Block letters as boxes, reading left to right along +x when seen from +z
 * (or the other way round with `flip`). `x` is the left edge in the reader's
 * frame, `y` the baseline, `cell` one cell in metres, `depth` along z.
 */
function blockText(b: MeshBuilder, text: string, x: number, y: number, z: number, cell: number, depth: number, colour: (i: number) => Rgb, flip = false): number {
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
    cursor += (ch === "I" ? 5 : 5) + 1;
  }
  return cursor * cell;
}

// ─── Ferris wheel ────────────────────────────────────────────────────────────

LANDMARKS["ferris-wheel"] = {
  footprint: 22,
  build() {
    const R = 22;
    const HUB = 27;
    const N = 14;
    const ZS = 2.4;
    const W = 0.14;
    const frame = new MeshBuilder();
    const fGlow = new MeshBuilder();
    const wheelLit = new MeshBuilder();
    const wheelGlow = new MeshBuilder();

    // A boarding platform of planks, the base of the A-frame.
    frame.box(0, -0.5, 0, 42, 1.6, 26, ramp(rgb("#1d1440"), rgb("#4b3a8c")));
    frame.box(0, 0.05, 14.5, 12, 0.5, 4, ramp(rgb("#3b2c72"), rgb("#6a56b8")));

    // A-frame legs: striped candy poles from the hub down to splayed feet.
    const legAt = (sx: number, s: number, y: number): V3 => {
      const t = (HUB - y) / (HUB + 1.5);
      return [sx * 16 * t, y, s * (5 + 3.6 * t)];
    };
    for (const s of [-1, 1]) {
      for (const sx of [-1, 1]) {
        stripedRod(frame, legAt(sx, s, HUB), legAt(sx, s, -1.5), 1.25, 9, RED, CREAM);
        frame.box(sx * 16, -0.1, s * 8.6, 3, 1.2, 3, ramp(DARK, rgb("#5b4aa0")));
      }
      for (const y of [7, 15]) frame.rod(legAt(-1, s, y), legAt(1, s, y), 0.75, STEEL);
    }
    for (const sx of [-1, 1]) {
      for (const y of [7, 15]) frame.rod(legAt(sx, -1, y), legAt(sx, 1, y), 0.75, STEEL);
      frame.rod(legAt(sx, -1, 7), legAt(sx, 1, 15), 0.5, STEEL);
      frame.rod(legAt(sx, 1, 7), legAt(sx, -1, 15), 0.5, STEEL);
    }

    // The sign at the foot: a lit marquee with a golden star and a border of bulbs.
    frame.box(-6.5, 2.2, 9.6, 0.9, 5.2, 0.9, STEEL);
    frame.box(6.5, 2.2, 9.6, 0.9, 5.2, 0.9, STEEL);
    frame.box(0, 6.2, 9.8, 16, 5, 0.8, ramp(DARK, NAVY));
    fGlow.box(0, 6.2, 10.25, 14.4, 3.6, 0.1, [3, 0.5, 1.7]);
    for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      fGlow.rod([Math.cos(a) * -1.9, 6.2 + Math.sin(a) * -1.9, 10.4], [Math.cos(a) * 1.9, 6.2 + Math.sin(a) * 1.9, 10.4], 0.5, [4, 3, 0.8]);
    }
    bulbLine(fGlow, [-7.6, 8.5, 10.35], [7.6, 8.5, 10.35], 15, 0.5);
    bulbLine(fGlow, [-7.6, 3.9, 10.35], [7.6, 3.9, 10.35], 15, 0.5, 2);
    bulbLine(fGlow, [-7.6, 4.4, 10.35], [-7.6, 8.0, 10.35], 4, 0.5, 1);
    bulbLine(fGlow, [7.6, 4.4, 10.35], [7.6, 8.0, 10.35], 4, 0.5, 3);

    // The wheel: two rims either side of the cars, spokes, bracing and bulbs.
    const wheelShade = stripes(WHITE, PINK, "row", 2);
    for (const s of [-1, 1]) {
      const z = s * ZS;
      torus(wheelLit, R, 0.55, { at: [0, HUB, z], facing: "z", ringSegments: 28, tubeSegments: 5, shade: wheelShade });
      torus(wheelLit, 11, 0.4, { at: [0, HUB, z], facing: "z", ringSegments: 21, tubeSegments: 5, shade: stripes(WHITE, TEAL, "row", 1) });
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const half = ((k + 0.5) / N) * TAU;
        wheelLit.rod([0, HUB, z], [ca * R, HUB + sa * R, z], 0.4, STEEL);
        // Zig-zag bracing between the inner ring and the rim.
        wheelLit.rod([ca * 11, HUB + sa * 11, z], [Math.cos(half) * R, HUB + Math.sin(half) * R, z], 0.3, WHITE);
        wheelLit.rod([Math.cos(half) * R, HUB + Math.sin(half) * R, z], [Math.cos(a + TAU / N) * 11, HUB + Math.sin(a + TAU / N) * 11, z], 0.3, WHITE);
      }
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU + 0.05;
        bulb(wheelGlow, Math.cos(a) * (R + 0.85), HUB + Math.sin(a) * (R + 0.85), z, 0.62, lightAt(k));
      }
      for (let k = 0; k < 21; k++) {
        const a = (k / 21) * TAU;
        bulb(wheelGlow, Math.cos(a) * 11.7, HUB + Math.sin(a) * 11.7, z, 0.5, lightAt(k + 1));
      }
      // The hub star on each face.
      for (let k = 0; k < 4; k++) {
        const a = (k / 8) * TAU;
        wheelGlow.rod([Math.cos(a) * -4, HUB + Math.sin(a) * -4, s * 6.7], [Math.cos(a) * 4, HUB + Math.sin(a) * 4, s * 6.7], 0.55, k % 2 ? G_PINK : G_GOLD);
      }
      wheelGlow.add(shapes.cylinder(12), xf(0, HUB, s * 6.9, 1.5, 0.5, 1.5, 0, Math.PI / 2), G_WHITE);
    }
    // Rim ties between the two sides, and the hub and axle.
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU;
      wheelLit.rod([Math.cos(a) * R, HUB + Math.sin(a) * R, -ZS], [Math.cos(a) * R, HUB + Math.sin(a) * R, ZS], 0.5, STEEL);
    }
    wheelLit.add(shapes.cylinder(12), xf(0, HUB, 0, 2.4, 12.4, 2.4, 0, Math.PI / 2), ramp(rgb("#7c7fa8"), rgb("#e4e6f6")));
    wheelLit.add(shapes.cylinder(12), xf(0, HUB, 0, 3.4, 5, 3.4, 0, Math.PI / 2), RED);

    const parts: MovingPart[] = [
      {
        lit: wheelLit,
        glow: wheelGlow,
        pivot: [0, HUB, 0],
        update(t, part) {
          part.rotation.z = W * t;
        },
      },
    ];

    // Each car hangs from its own pin and stays upright: it travels the circle without turning.
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + 0.2;
      const px = R * Math.cos(a);
      const py = HUB + R * Math.sin(a);
      const colour = CANDY[k % CANDY.length]!;
      const l = new MeshBuilder();
      const g = new MeshBuilder();
      l.box(px, py, 0, 0.45, 0.45, 2 * ZS + 0.3, STEEL);
      for (const s of [-1, 1]) l.rod([px, py, s * ZS], [px, py - 1.7, s * 1.2], 0.3, STEEL);
      l.spire(px, py - 1.7, 0, 2.3, 1.4, ramp(scaleRgb(colour, 0.8), mixRgb(colour, WHITE, 0.25)), 8);
      l.post(px, py - 4.3, 0, 1.75, 2.6, ramp(scaleRgb(colour, 0.5), colour), 8);
      l.post(px, py - 4.55, 0, 1.95, 0.35, CREAM, 8);
      for (let w = 0; w < 4; w++) {
        const th = Math.PI / 8 + (w * Math.PI) / 2;
        g.box(px + Math.sin(th) * 1.66, py - 2.9, Math.cos(th) * 1.66, 0.95, 1.0, 0.14, G_WARM, th);
      }
      bulb(g, px, py - 0.2, 0, 0.45, lightAt(k));
      parts.push({
        lit: l,
        glow: g,
        pivot: [px, py, 0],
        update(t, part) {
          const phi = a + W * t;
          part.position.set(R * (Math.cos(phi) - Math.cos(a)), R * (Math.sin(phi) - Math.sin(a)), 0);
        },
      });
    }

    const halos: Halo[] = [{ x: 0, y: HUB, z: 7, size: 16, colour: [4, 2.6, 1.2], alpha: 0.55, twinkle: 0.3 }, { x: 0, y: 6.2, z: 11, size: 12, colour: [4, 0.8, 2], alpha: 0.5, twinkle: 0.2 }];
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * TAU;
      halos.push({ x: Math.cos(a) * (R + 0.8), y: HUB + Math.sin(a) * (R + 0.8), z: (k % 2 ? 1 : -1) * ZS, size: 5.5, colour: lightAt(k), alpha: 0.4, twinkle: 0.4 });
    }
    for (let k = 0; k < 9; k++) halos.push({ x: -7.2 + k * 1.8, y: 8.5, z: 10.4, size: 3.6, colour: lightAt(k), alpha: 0.5, twinkle: 0.4 });
    return { lit: frame, glow: fGlow, moving: parts, halos };
  },
};

// ─── Carousel ────────────────────────────────────────────────────────────────

/** A painted carousel horse, 3.2 m long, facing +z, standing on y = 0 at its hooves-up pose, pole through the middle. */
function horse(coat: Rgb, mane: Rgb, saddle: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  const dark = scaleRgb(coat, 0.55);
  b.blob(0, 0, -0.1, 0.78, 0.82, 1.45, ramp(dark, coat), 1);
  b.blob(0, 0.2, 0.95, 0.72, 0.85, 0.75, ramp(dark, coat), 0);
  b.rod([0, 0.55, 1.1], [0, 1.75, 1.65], 0.85, ramp(dark, coat));
  b.box(0, 2.0, 2.05, 0.62, 0.68, 1.05, coat, 0, 0.45, 0);
  b.box(0, 1.78, 2.55, 0.5, 0.45, 0.4, mixRgb(coat, WHITE, 0.35), 0, 0.45, 0);
  for (const s of [-1, 1]) {
    b.spire(s * 0.22, 2.3, 1.7, 0.14, 0.4, dark, 4);
    b.box(s * 0.33, 2.08, 2.18, 0.08, 0.16, 0.16, DARK);
  }
  // Mane down the neck and a plume of a tail.
  for (let k = 0; k < 5; k++) b.blob(0, 0.95 + k * 0.28, 1.05 + k * 0.1 - 0.35, 0.2, 0.3, 0.22, mane, 0);
  b.blob(0, 0.5, -1.55, 0.2, 0.2, 0.35, mane, 0);
  b.rod([0, 0.45, -1.35], [0, -0.7, -1.9], 0.38, mane);
  // Saddle with gold trim and a blanket.
  b.box(0, 0.86, -0.15, 1.2, 0.18, 1.3, saddle);
  b.box(0, 0.93, -0.15, 1.28, 0.06, 0.2, GOLD);
  b.box(0, 1.0, -0.55, 0.9, 0.3, 0.2, saddle);
  // Four legs in a gallop: fore pair reaching, hind pair kicking back.
  for (const [sx, sz, reach] of [[-1, 1, 0.8], [1, 1, 0.8], [-1, -1, -0.7], [1, -1, -0.7]] as const) {
    const top: V3 = [sx * 0.42, -0.35, sz * 0.9];
    const knee: V3 = [sx * 0.42, -1.1, sz * 0.9 + reach * 0.45];
    const foot: V3 = [sx * 0.42, -1.25, sz * 0.9 + reach * 0.9 - 0.2];
    b.rod(top, knee, 0.34, coat);
    b.rod(knee, [foot[0], foot[1] + 0.3, foot[2] - 0.2], 0.26, coat);
    b.box(foot[0], foot[1] + 0.2, foot[2], 0.34, 0.26, 0.4, GOLD);
  }
  return b;
}

/** A carousel ostrich: long legs, a long neck, small head, folded wings. */
function ostrich(body: Rgb, feather: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  b.blob(0, 0, 0, 1.0, 0.95, 1.4, ramp(scaleRgb(body, 0.55), body), 1);
  b.blob(0, 0.2, -1.35, 0.6, 0.7, 0.8, feather, 0);
  b.blob(0, 0.15, -1.9, 0.5, 0.55, 0.6, feather, 0);
  for (const s of [-1, 1]) b.blob(s * 0.95, 0.1, -0.1, 0.18, 0.55, 0.9, scaleRgb(feather, 0.85), 0);
  b.rod([0, 0.4, 0.9], [0, 2.0, 1.25], 0.45, mixRgb(body, WHITE, 0.3));
  b.rod([0, 2.0, 1.25], [0, 2.55, 1.5], 0.36, mixRgb(body, WHITE, 0.3));
  b.blob(0, 2.7, 1.65, 0.3, 0.28, 0.4, mixRgb(body, WHITE, 0.4), 0);
  b.box(0, 2.62, 2.1, 0.18, 0.12, 0.45, ORANGE);
  b.box(-0.17, 2.78, 1.9, 0.05, 0.1, 0.1, DARK);
  b.box(0.17, 2.78, 1.9, 0.05, 0.1, 0.1, DARK);
  for (const s of [-1, 1]) {
    b.rod([s * 0.4, -0.3, 0.1], [s * 0.45, -1.5, 0.5], 0.28, ORANGE);
    b.rod([s * 0.45, -1.5, 0.5], [s * 0.45, -2.3, 0.15], 0.22, ORANGE);
    b.box(s * 0.45, -2.35, 0.4, 0.4, 0.14, 0.7, ORANGE);
  }
  b.box(0, 0.95, 0, 1.0, 0.16, 1.1, RED);
  return b;
}

/** A carousel cat, sitting up with an arched back and a curling tail. */
function cat(body: Rgb, stripe: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  b.blob(0, 0, -0.1, 0.9, 0.85, 1.3, ramp(scaleRgb(body, 0.55), body), 1);
  b.blob(0, 0.5, 0.95, 0.75, 0.75, 0.7, body, 1);
  for (const s of [-1, 1]) {
    b.spire(s * 0.42, 1.4, 0.95, 0.24, 0.55, body, 4);
    b.box(s * 0.28, 0.75, 1.55, 0.14, 0.18, 0.08, DARK);
    b.rod([s * 0.3, 0.45, 1.6], [s * 0.9, 0.5, 1.75], 0.07 + 0.08, WHITE);
    b.rod([s * 0.5, -0.2, 0.9], [s * 0.5, -1.3, 1.05], 0.4, body);
    b.rod([s * 0.5, -0.1, -0.9], [s * 0.5, -1.2, -1.1], 0.45, body);
  }
  b.blob(0, 0.3, 1.58, 0.14, 0.1, 0.1, PINK, 0);
  for (let k = 0; k < 3; k++) b.box(0, 0.55 - k * 0.2, -0.1 + k * 0.5 - 0.5, 1.6, 0.14, 0.18, stripe);
  const tail: V3[] = [];
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tail.push([0, 0.2 + Math.sin(t * 3.4) * 1.5, -1.3 - Math.sin(t * 2.2) * 0.9 + t * 0.4]);
  }
  tube(b, tail, { radius: 0.2, sides: 5, shade: stripe, caps: true });
  b.box(0, 0.9, 0, 0.9, 0.14, 0.9, TEAL);
  return b;
}

LANDMARKS.carousel = {
  footprint: 14,
  build() {
    const RP = 12.5;
    const DECK = 1.4;
    const TOP = 11.8;
    const stage = new MeshBuilder();
    const stageGlow = new MeshBuilder();
    // Static stage the carousel turns on, with a bulb-studded kerb.
    lathe(stage, [[0, -1.5], [14, -1.5], [14.4, 0], [13.2, 1.0], [0, 1.0]], { segments: 24, shade: byHeight(-1.5, 1, DARK, rgb("#6b58b8")), caps: "top" });
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * TAU;
      bulb(stageGlow, Math.cos(a) * 14.1, 0.4, Math.sin(a) * 14.1, 0.5, lightAt(k));
    }
    // A little ticket step at the front.
    stage.box(0, -0.1, 15.5, 6, 1.2, 3, ramp(DARK, rgb("#6b58b8")));

    const spin = new MeshBuilder();
    const spinGlow = new MeshBuilder();
    // Deck, fascia, centre column, canopy: the turning part.
    lathe(spin, [[0, DECK - 0.4], [RP, DECK - 0.4], [RP, DECK], [0, DECK]], { segments: 20, shade: stripes(rgb("#f4e7c8"), rgb("#6b8fe0")), caps: "top" });
    lathe(spin, [[RP, DECK - 0.6], [RP + 0.35, DECK - 0.6], [RP + 0.35, DECK + 0.9], [RP, DECK + 0.9]], { segments: 20, shade: stripes(RED, CREAM), caps: "top" });
    for (let k = 0; k < 20; k++) {
      const a = ((k + 0.5) / 20) * TAU;
      spin.box(Math.cos(a) * (RP + 0.5), DECK + 0.15, Math.sin(a) * (RP + 0.5), 0.5, 0.35, 0.5, GOLD, -a);
      bulb(spinGlow, Math.cos(a) * (RP + 0.62), DECK - 0.25, Math.sin(a) * (RP + 0.62), 0.45, lightAt(k));
    }
    // The mirrored centre column: eight bright mirror panels between gold ribs.
    lathe(spin, [[2.8, DECK], [2.8, DECK + 0.8], [2.4, DECK + 1.2], [2.3, TOP - 0.4], [3.0, TOP]], { segments: 8, shade: byHeight(DECK, TOP, scaleRgb(GOLD, 0.7), GOLD), caps: "top" });
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * TAU;
      const d = 2.2;
      spinGlow.box(Math.sin(a) * d, (DECK + TOP) / 2 + 0.2, Math.cos(a) * d, 1.35, TOP - DECK - 2.3, 0.14, [1.6 + (k % 2) * 0.3, 1.9, 2.4], a);
    }
    for (const y of [3.6, 6.0, 8.4]) {
      lathe(spin, [[2.55, y - 0.18], [2.75, y - 0.18], [2.75, y + 0.18], [2.55, y + 0.18]], { segments: 8, shade: BRASS });
    }
    // The canopy: a striped, slightly bell-shaped roof with a scalloped valance and a flag.
    lathe(
      spin,
      [[13.8, TOP], [12, TOP + 0.9], [8.5, TOP + 2.0], [5, TOP + 3.2], [2.4, TOP + 4.2], [1.0, TOP + 4.8], [0.0, TOP + 6.0]],
      { segments: 20, shade: (p, _i, j) => (j % 2 === 0 ? mixRgb(RED, WHITE, Math.min(0.4, (p[1] - TOP) * 0.06)) : CREAM) },
    );
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * TAU;
      const a1 = ((i + 1) / 20) * TAU;
      const r = 13.8;
      const p0: V3 = [Math.cos(a0) * r, TOP, Math.sin(a0) * r];
      const p1: V3 = [Math.cos(a1) * r, TOP, Math.sin(a1) * r];
      const mid = (a0 + a1) / 2;
      const col = i % 2 === 0 ? RED : CREAM;
      const pts: V3[] = [p0];
      for (let k = 1; k < 4; k++) {
        const u = k / 4;
        const a = a0 + (a1 - a0) * u;
        pts.push([Math.cos(a) * r, TOP - Math.sin(u * Math.PI) * 1.4, Math.sin(a) * r]);
      }
      pts.push(p1);
      const c: V3 = [Math.cos(mid) * r, TOP + 0.05, Math.sin(mid) * r];
      for (let k = 0; k < pts.length - 1; k++) spin.tri(c, pts[k]!, pts[k + 1]!, col, scaleRgb(col, 0.8), scaleRgb(col, 0.8));
      spin.blob(Math.cos(mid) * r, TOP - 1.45, Math.sin(mid) * r, 0.22, 0.22, 0.22, GOLD, 0);
    }
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      bulb(spinGlow, Math.cos(a) * 13.4, TOP - 0.2, Math.sin(a) * 13.4, 0.55, lightAt(k));
    }
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      bulb(spinGlow, Math.cos(a) * 7, TOP + 0.1, Math.sin(a) * 7, 0.45, lightAt(k + 2));
    }
    spin.post(0, TOP + 5.8, 0, 0.18, 2.6, BRASS, 6);
    spin.blob(0, TOP + 8.5, 0, 0.45, 0.45, 0.45, GOLD, 0);
    spin.tri([0.1, TOP + 8.2, 0], [2.6, TOP + 7.7, 0.0], [0.1, TOP + 6.9, 0], RED, ORANGE, RED);
    spin.tri([0.1, TOP + 8.2, 0], [0.1, TOP + 6.9, 0], [2.6, TOP + 7.7, 0.0], PINK, PINK, PINK);

    // Brass poles for every mount (they turn with the deck).
    const mountsA = new MeshBuilder();
    const mountsB = new MeshBuilder();
    const coats: [Rgb, Rgb, Rgb][] = [
      [WHITE, RED, BLUE],
      [rgb("#c88a4f"), CREAM, RED],
      [rgb("#ffd1e0"), PURPLE, TEAL],
      [rgb("#7fd4c0"), YELLOW, PINK],
    ];
    const addMount = (k: number, r: number, a: number, kind: number): void => {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pipe(spin, [x, DECK, z], [x, TOP - 0.3, z], 0.2, BRASS, 6);
      spin.blob(x, TOP - 0.45, z, 0.4, 0.3, 0.4, GOLD, 0);
      const target = k % 2 === 0 ? mountsA : mountsB;
      const c = coats[k % coats.length]!;
      const m = kind === 0 ? horse(c[0], c[1], c[2]) : kind === 1 ? ostrich(c[0], c[1]) : cat(c[0], c[2]);
      const lift = kind === 0 ? 4.6 : kind === 1 ? 4.9 : 4.4;
      stamp(target, m, xf(x, DECK + lift + 0.4, z, 1.3, 1.3, 1.3, -a));
    };
    for (let k = 0; k < 8; k++) addMount(k, 10, (k / 8) * TAU, 0);
    for (let k = 0; k < 4; k++) addMount(k + 8, 6.4, ((k + 0.5) / 4) * TAU + 0.4, k % 2 === 0 ? 1 : 2);

    const halos: Halo[] = [{ x: 0, y: 7.5, z: 0, size: 18, colour: [3.2, 2, 1], alpha: 0.5, twinkle: 0.2 }];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      halos.push({ x: Math.cos(a) * 13.4, y: TOP - 0.2, z: Math.sin(a) * 13.4, size: 5, colour: lightAt(k), alpha: 0.45, twinkle: 0.4 });
    }
    halos.push({ x: 0, y: TOP + 8.5, z: 0, size: 6, colour: G_GOLD, alpha: 0.6, twinkle: 0.5 });
    const rot = (t: number): number => -0.2 * t;
    const moving: MovingPart[] = [
      { lit: spin, glow: spinGlow, pivot: [0, 0, 0], update: (t, part) => void (part.rotation.y = rot(t)) },
      {
        lit: mountsA,
        pivot: [0, 0, 0],
        update(t, part) {
          part.rotation.y = rot(t);
          part.position.y = 0.8 * Math.sin(1.7 * t);
        },
      },
      {
        lit: mountsB,
        pivot: [0, 0, 0],
        update(t, part) {
          part.rotation.y = rot(t);
          part.position.y = 0.8 * Math.sin(1.7 * t + Math.PI);
        },
      },
    ];
    return { lit: stage, glow: stageGlow, moving, halos };
  },
};

// ─── Big top ─────────────────────────────────────────────────────────────────

LANDMARKS["big-top"] = {
  span: true,
  defaultSpan: 60,
  build(ctx) {
    const L = ctx.span;
    const w = ctx.halfWidth + 8;
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const rows = Math.max(4, Math.round(L / 2));
    // A barrel vault: straight walls to 6.5 m, then half an ellipse up to a 17.2 m ridge (smooth, so the canvas looks swagged).
    const right: [number, number][] = [[w, 6.5]];
    for (let k = 1; k <= 9; k++) {
      const a = (k / 9) * (Math.PI / 2);
      right.push([w * Math.cos(a), 6.5 + 10.7 * Math.sin(a)]);
    }
    right.pop();
    const section: [number, number][] = [[-w, -1], ...right.map(([x, y]): [number, number] => [-x, y]), [0, 17.2], ...[...right].reverse(), [w, -1]];

    // The canvas: red and cream stripes running ridge to eave, darker at the foot.
    const canvas = (p: V3, i: number): Rgb => {
      const base = i % 2 === 0 ? RED : CREAM;
      return scaleRgb(base, 0.62 + 0.38 * Math.max(0, Math.min(1, (p[1] + 1) / 17)));
    };
    extrudeZ(lit, section, -L / 2, L / 2, rows, canvas);
    // Inside, the same stripes glow, so the tent is lit from within yet solid from outside.
    extrudeZ(glow, section, -L / 2, L / 2, rows, (_p, i) => (i % 2 === 0 ? [1.9, 0.4, 0.45] : [1.7, 1.35, 1.0]), { scaleAt: () => 0.985 });
    // A faint warm skin outside: the glow of the canvas.
    extrudeZ(glass, section, -L / 2, L / 2, rows, [1.1, 0.5, 0.5], { scaleAt: () => 1.015 });

    // Steel ribs inside every 12 m, each hung with bulbs.
    const ribs: number[] = [];
    for (let z = -L / 2 + 1; z <= L / 2 - 0.9; z += 12) ribs.push(z);
    ribs.push(L / 2 - 0.3);
    for (const z of ribs) {
      const path: V3[] = section.map(([x, y]): V3 => [x * 0.975, y * 0.975, z]);
      tube(lit, path, { radius: 0.34, sides: 4, shade: STEEL });
      for (let k = 1; k < section.length - 1; k++) {
        const [x, y] = section[k]!;
        bulb(glow, x * 0.955, y * 0.955, z, 0.5, lightAt(k + Math.round(z)));
      }
    }
    // The ridge: a beam with a row of bulbs under it, and a halo at intervals.
    for (let z = -L / 2 + 1.5; z <= L / 2 - 1; z += 3) {
      bulb(glow, 0, 16.5, z, 0.6, lightAt(Math.round(z / 3)));
      lit.box(0, 16.95, z, 0.4, 0.3, 3.0, STEEL);
    }
    // Two spotlight beams crossing the middle, from small lamps under the ridge.
    const beam = (lx: number, lz: number, rz: number, colour: Rgb): void => {
      lit.box(lx, 15.9, lz, 0.8, 0.7, 0.8, DARK);
      bulb(glow, lx, 15.5, lz, 0.5, G_WHITE);
      const len = 15.5;
      glass.add(shapes.cone(10), xf(lx + (Math.sin(rz) * len) / 2, 15.5 - (Math.cos(rz) * len) / 2, lz, 3.2, len, 3.2, 0, 0, rz), colour);
    };
    beam(-4, -L * 0.2, -0.62, [0.5, 0.9, 1.5]);
    beam(4, L * 0.12, 0.62, [1.5, 0.5, 1.1]);

    // Entrance valances, flaps tied back, bunting and flags at both ends.
    for (const e of [-1, 1]) {
      const z = e * (L / 2 + 0.1);
      const pts = section.slice(1, -1);
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k]!;
        const c = pts[k + 1]!;
        const n = k === 0 || k === pts.length - 2 ? 2 : 2;
        scallops(lit, [a[0], a[1], z], [c[0], c[1], z], n, 1.7, RED, CREAM);
      }
      // Flaps: gathered at a gold tie, flaring to the ground.
      for (const s of [-1, 1]) {
        const x0 = s * w;
        const fl: V3[][] = [
          [[x0, 6.4, z], [x0 - s * 1.3, 8.5, z], [x0 - s * 2.8, 10.6, z], [x0 - s * 4.2, 11.8, z]],
          [[x0, 4.2, z + e * 0.5], [x0 - s * 0.5, 4.2, z + e * 0.6], [x0 - s * 0.9, 4.2, z + e * 0.6], [x0 - s * 1.2, 4.2, z + e * 0.5]],
          [[x0, -0.5, z], [x0 - s * 1.6, -0.5, z + e * 0.3], [x0 - s * 3.0, -0.5, z + e * 0.2], [x0 - s * 4.1, -0.5, z]],
        ];
        grid(lit, fl, (p, i, j) => scaleRgb(j % 2 === 0 ? RED : rgb("#c01f45"), 0.75 + 0.1 * i));
        tube(lit, [[x0 + s * 0.2, 4.2, z + e * 0.7], [x0 - s * 0.6, 4.2, z + e * 0.8], [x0 - s * 1.4, 4.2, z + e * 0.7]], { radius: 0.2, sides: 4, shade: GOLD });
        lit.blob(x0 - s * 1.7, 3.6, z + e * 0.7, 0.35, 0.55, 0.35, GOLD, 0);
        bulb(glow, x0 - s * 1.5, 7.8, z + e * 0.2, 0.5, lightAt(s + 2));
      }
      // A flag on a mast over the ridge end.
      lit.rod([0, 16.8, z - e * 1.2], [0, 21.5, z - e * 1.2], 0.2, STEEL);
      lit.tri([0, 21.4, z - e * 1.2], [0, 19.8, z - e * 1.2], [0, 20.6, z - e * 1.2 - e * 2.8], YELLOW, ORANGE, RED);
    }
    // Bunting along both eaves, and guy ropes to pegs.
    for (const s of [-1, 1]) {
      const x = s * (w + 0.2);
      for (let z = -L / 2; z < L / 2 - 0.1; z += 3) {
        const segs = 3;
        for (let k = 0; k < segs; k++) {
          const z0 = z + (k * 3) / segs;
          const z1 = z + ((k + 1) * 3) / segs;
          const sag = (u: number): number => 6.2 - Math.sin(u * Math.PI) * 0.45;
          const p0: V3 = [x, sag(k / segs), z0];
          const p1: V3 = [x, sag((k + 1) / segs), z1];
          lit.rod(p0, p1, 0.15, DARK);
          const mz = (z0 + z1) / 2;
          const c = candyAt(Math.round(z) + k + (s > 0 ? 3 : 0));
          lit.tri([x, (p0[1] + p1[1]) / 2, z0 + 0.1], [x, (p0[1] + p1[1]) / 2, z1 - 0.1], [x + s * 0.05, (p0[1] + p1[1]) / 2 - 1.0, mz], c, c, scaleRgb(c, 0.8));
        }
      }
      for (let z = -L / 2 + 6; z < L / 2 - 3; z += 12) {
        lit.rod([s * (w - 0.2), 6.0, z], [s * (w + 4.5), -0.8, z], 0.2, GOLD);
        lit.box(s * (w + 4.6), -0.4, z, 0.5, 1.2, 0.5, DARK, 0, 0, 0.3);
      }
    }
    const halos: Halo[] = [];
    for (let z = -L / 2 + 6; z <= L / 2 - 5; z += 12) halos.push({ x: 0, y: 16.2, z, size: 9, colour: [3.4, 2.2, 1.0], alpha: 0.3, twinkle: 0.3 });
    for (const e of [-1, 1]) {
      for (const s of [-1, 1]) halos.push({ x: s * (w - 3), y: 8, z: e * (L / 2 - 1), size: 9, colour: lightAt(s + e + 4), alpha: 0.45, twinkle: 0.4 });
    }
    return { lit, glow, glass, halos };
  },
};

// ─── Rollercoaster ───────────────────────────────────────────────────────────

/** A smooth curve through points (centripetal Catmull-Rom), resampled every `ds` metres of length. */
function smoothPath(pts: readonly V3[], ds: number): V3[] {
  const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const n = pts.length;
  const dense: V3[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = i === 0 ? ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]] as V3) : pts[i - 1]!;
    const p3 = i + 2 >= n ? ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]] as V3) : pts[i + 2]!;
    const t0 = 0;
    const t1 = t0 + Math.sqrt(dist(p0, p1) || 1e-3);
    const t2 = t1 + Math.sqrt(dist(p1, p2) || 1e-3);
    const t3 = t2 + Math.sqrt(dist(p2, p3) || 1e-3);
    const steps = 24;
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const mix = (a: V3, b: V3, ta: number, tb: number): V3 => {
        const u = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      };
      const A1 = mix(p0, p1, t0, t1);
      const A2 = mix(p1, p2, t1, t2);
      const A3 = mix(p2, p3, t2, t3);
      const B1 = mix(A1, A2, t0, t2);
      const B2 = mix(A2, A3, t1, t3);
      dense.push(mix(B1, B2, t1, t2));
    }
  }
  dense.push(pts[n - 1]!);
  const out: V3[] = [dense[0]!];
  let carried = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i]!;
    const seg = dist(a, b);
    let at = ds - carried;
    while (at <= seg) {
      const u = at / seg;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
      at += ds;
    }
    carried = seg - (at - ds);
  }
  return out;
}

LANDMARKS.rollercoaster = {
  span: true,
  defaultSpan: 120,
  build(ctx) {
    const hw = ctx.halfWidth;
    const k = ctx.span / 120;
    const X = hw + 9; // where the supports stand beside the road
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    // Waypoints: the lift hill on the left, a swoop over the road, a hump, a vertical loop on the right, and back over the road.
    const wp: V3[] = [
      [-X - 1.5, 3, -58 * k],
      [-X - 1.5, 7, -50 * k],
      [-X - 1, 15, -43 * k],
      [-X, 24, -37 * k],
      [-X, 31, -31 * k],
      [-X + 0.8, 32, -26 * k],
      [-X + 4.5, 28, -20 * k],
      [-6, 21.5, -13 * k],
      [0, 18.2, -8 * k],
      [6.5, 21, -3 * k],
      [X - 3, 26, 3 * k],
      [X + 3, 26.5, 8 * k],
      [X + 6, 21, 13 * k],
      [X + 7, 11, 18 * k],
      [X + 7, 4.2, 24 * k],
    ];
    // The vertical loop beside the road: a circle in the y-z plane that drifts sideways so the entry and exit clear each other.
    const cx = X + 7;
    const loopR = 10;
    const loopZ = 33 * k;
    wp.push([cx, 4.2, loopZ]);
    for (let q = 1; q <= 11; q++) {
      const th = (q / 12) * Math.PI * 2;
      wp.push([cx + (5 * th) / (Math.PI * 2), 14.2 - loopR * Math.cos(th), loopZ + loopR * Math.sin(th)]);
    }
    wp.push([cx + 5, 4.2, loopZ], [cx + 4.5, 4.8, loopZ + 11 * k], [X + 3, 9, 47 * k], [X - 3, 13.8, 50.5 * k], [6, 16, 53 * k], [-1, 15.2, 55 * k], [-9, 14.8, 56 * k], [-X - 2, 10, 57.5 * k], [-X - 2.5, 4, 59 * k]);
    const path = smoothPath(wp, 3.2);
    const n = path.length;

    // Frames: tangent T, side S (parallel transported so the track never twists), up U.
    const T: V3[] = [];
    const S: V3[] = [];
    const U: V3[] = [];
    let side: V3 = [1, 0, 0];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)]!;
      const c = path[Math.min(n - 1, i + 1)]!;
      let t: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1;
      t = [t[0] / tl, t[1] / tl, t[2] / tl];
      const d = side[0] * t[0] + side[1] * t[1] + side[2] * t[2];
      let sv: V3 = [side[0] - t[0] * d, side[1] - t[1] * d, side[2] - t[2] * d];
      const sl = Math.hypot(sv[0], sv[1], sv[2]) || 1;
      sv = [sv[0] / sl, sv[1] / sl, sv[2] / sl];
      side = sv;
      T.push(t);
      S.push(sv);
      U.push([t[1] * sv[2] - t[2] * sv[1], t[2] * sv[0] - t[0] * sv[2], t[0] * sv[1] - t[1] * sv[0]]);
    }
    const at = (i: number, s: number, u: number): V3 => {
      const p = path[i]!;
      const sv = S[i]!;
      const uv = U[i]!;
      return [p[0] + sv[0] * s + uv[0] * u, p[1] + sv[1] * s + uv[1] * u, p[2] + sv[2] * s + uv[2] * u];
    };
    const m4 = new Matrix4();
    const frameBox = (b: MeshBuilder, i: number, s: number, u: number, along: number, sx: number, sy: number, sz: number, paint: Rgb | { bottom: Rgb; top: Rgb }): void => {
      const c = at(i, s, u);
      const t = T[i]!;
      m4.makeBasis(new Vector3(...S[i]!), new Vector3(...U[i]!), new Vector3(...t));
      m4.setPosition(c[0] + t[0] * along, c[1] + t[1] * along, c[2] + t[2] * along);
      m4.scale(new Vector3(sx, sy, sz));
      b.add(shapes.box(), m4.clone(), paint);
    };

    const railL = path.map((_p, i) => at(i, -0.95, 0));
    const railR = path.map((_p, i) => at(i, 0.95, 0));
    const chord = path.map((_p, i) => at(i, 0, -2.3));
    tube(lit, railL, { radius: 0.32, sides: 4, shade: RED });
    tube(lit, railR, { radius: 0.32, sides: 4, shade: RED });
    tube(lit, chord, { radius: 0.42, sides: 4, shade: WHITE });
    // The neon keel: pink and cyan dashes under the sleepers.
    tube(
      glow,
      path.map((_p, i) => at(i, 0, -0.75)),
      { radius: 0.34, sides: 4, shade: (_p, i) => (Math.floor(i / 2) % 2 === 0 ? G_CYAN : G_PINK) },
    );
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) frameBox(lit, i, 0, -0.2, 0, 3.1, 0.26, 0.6, WHITE);
      if (i < n - 1) lit.rod(i % 2 === 0 ? railL[i]! : railR[i]!, chord[i + 1]!, 0.26, i % 4 < 2 ? WHITE : STEEL);
    }

    // Lattice supports wherever the track is high and clear of the road.
    const bays = 6;
    for (let i = 3; i < n - 2; i += 5) {
      const p = chord[i]!;
      if (Math.abs(p[0]) < hw + 5.5 || p[1] < 6) continue;
      // The loop is held from outside, not through its middle.
      if (p[0] > X + 2 && p[2] > 20 * k && p[2] < 46 * k) continue;
      const top = p[1] - 0.1;
      for (const dz of [-1.3, 1.3]) pipe(lit, [p[0], -1.5, p[2] + dz], [p[0], top, p[2] + dz], 0.45, WHITE, 4);
      for (let q = 0; q < bays; q++) {
        const y0 = -1.5 + ((top + 1.5) * q) / bays;
        const y1 = -1.5 + ((top + 1.5) * (q + 1)) / bays;
        lit.rod([p[0], y0, p[2] + (q % 2 ? 1.3 : -1.3)], [p[0], y1, p[2] + (q % 2 ? -1.3 : 1.3)], 0.3, RED);
        if (q % 2 === 0) lit.rod([p[0], y1, p[2] - 1.3], [p[0], y1, p[2] + 1.3], 0.3, RED);
      }
      lit.box(p[0], -1.2, p[2], 1.2, 1.2, 4, ramp(DARK, rgb("#6b58b8")));
    }
    // The loop's outrigger: a leaning mast from its crown out to a footing.
    const crown = path.reduce((best, p) => (p[1] > best[1] ? p : best), path[0]!);
    pipe(lit, [crown[0] + 1, crown[1] - 3, crown[2] - 1.3], [crown[0] + 7, -1.5, crown[2] - 1.3], 0.3, WHITE, 4);
    pipe(lit, [crown[0] + 1, crown[1] - 3, crown[2] + 1.3], [crown[0] + 7, -1.5, crown[2] + 1.3], 0.3, WHITE, 4);
    lit.box(crown[0] + 7, -1.2, crown[2], 1.4, 1.2, 4, ramp(DARK, rgb("#6b58b8")));

    // The train, parked on the crest of the lift hill: three cars in candy colours.
    const top = path.reduce((bi, p, i) => (p[2] < -20 * k && p[1] > path[bi]![1] ? i : bi), 0);
    const carColours = [RED, YELLOW, TEAL];
    for (let c = 0; c < 3; c++) {
      const i = top + c - 1;
      if (i < 0 || i >= n) continue;
      const col = carColours[c]!;
      frameBox(lit, i, 0, 0.62, 0, 2.2, 0.9, 3.0, ramp(scaleRgb(col, 0.6), col));
      frameBox(lit, i, 0, 1.2, -0.6, 2.0, 0.5, 1.4, mixRgb(col, WHITE, 0.3));
      frameBox(lit, i, 0, 0.2, 1.65, 1.6, 0.5, 0.3, GOLD);
      frameBox(glow, i, 0, 1.0, 1.52, 1.4, 0.25, 0.1, G_WARM);
      // Two riders' heads as lumps.
      for (const s of [-0.5, 0.5]) {
        const h = at(i, s, 1.55);
        lit.blob(h[0], h[1], h[2], 0.32, 0.36, 0.32, ramp(rgb("#d9915c"), rgb("#f5c9a0")), 0);
      }
    }
    // A halo trail along the track and bulbs on the keel.
    const halos: Halo[] = [];
    for (let i = 4; i < n; i += 8) halos.push({ x: path[i]![0], y: path[i]![1] - 0.8, z: path[i]![2], size: 6, colour: lightAt(i >> 3), alpha: 0.5, twinkle: 0.4 });
    for (let i = 0; i < n; i += 2) bulb(glow, chord[i]![0], chord[i]![1] - 0.5, chord[i]![2], 0.6, lightAt(i / 2));
    return { lit, glow, halos };
  },
};

// ─── Entrance arch ───────────────────────────────────────────────────────────

LANDMARKS["entrance-arch"] = {
  span: true,
  defaultSpan: 14,
  build(ctx) {
    const hw = ctx.halfWidth;
    const inner = hw + 5; // the gateway's clear half width
    const TX = inner + 3.5; // tower centre
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];

    // Two decorated towers: striped shafts, galleries, onion domes, flags.
    for (const s of [-1, 1]) {
      const x = s * TX;
      lathe(lit, [[4.4, -1.5], [4.4, 0], [3.7, 1.0], [3.5, 3], [3.5, 11], [4.2, 11.4], [4.5, 12.4], [3.5, 12.8], [3.4, 13.8]], {
        at: [x, 0, 0],
        segments: 12,
        shade: (p, _i, j) => scaleRgb(j % 2 === 0 ? RED : CREAM, 0.6 + 0.4 * Math.min(1, (p[1] + 1) / 14)),
      });
      // Gallery and a pink-and-gold dome on a drum.
      lathe(lit, [[3.5, 13.6], [3.7, 14.2], [3.7, 15.4], [3.4, 16.0]], { at: [x, 0, 0], segments: 12, shade: stripes(PINK, YELLOW) });
      lathe(lit, [[3.4, 16], [4.6, 17.6], [4.2, 19.6], [2.6, 21.6], [1.1, 23.4], [0.2, 25]], {
        at: [x, 0, 0],
        segments: 12,
        shade: byHeight(16, 25, scaleRgb(PINK, 0.8), mixRgb(PINK, WHITE, 0.5)),
        caps: "top",
      });
      lit.post(x, 24.6, 0, 0.2, 4, BRASS, 6);
      lit.blob(x, 28.8, 0, 0.5, 0.5, 0.5, GOLD, 0);
      lit.tri([x, 28.4, 0], [x, 26.8, 0], [x - s * 0.1, 27.6, -2.6], RED, ORANGE, YELLOW);
      // Glowing windows on two storeys, and runs of bulbs up the corners.
      for (const y of [3.4, 7.2]) {
        for (let q = 0; q < 4; q++) {
          const th = (q / 4) * Math.PI * 2 + Math.PI / 4;
          glow.box(x + Math.sin(th) * 3.55, y + 0.9, Math.cos(th) * 3.55, 1.1, 2.0, 0.16, G_WARM, th);
          lit.box(x + Math.sin(th) * 3.5, y + 2.0, Math.cos(th) * 3.5, 1.5, 0.3, 0.3, GOLD, th);
        }
      }
      for (let q = 0; q < 6; q++) {
        const th = (q / 6) * Math.PI * 2 + 0.26;
        for (let y = 1; y <= 13; y += 1.5) bulb(glow, x + Math.sin(th) * 3.75, y, Math.cos(th) * 3.75, 0.36, lightAt(q + Math.round(y)));
      }
      for (let y = 4; y <= 22; y += 6) halos.push({ x, y, z: -4, size: 8, colour: lightAt(y), alpha: 0.5, twinkle: 0.4 });
    }

    // The arched sign: a curved lintel between the towers, letters in warm glow.
    const lo = (x: number): number => 14.2 + 1.2 * (1 - (x / inner) ** 2);
    const hi = (x: number): number => 21.2 + 1.8 * (1 - (x / inner) ** 2);
    const xs: number[] = [];
    for (let q = 0; q <= 40; q++) xs.push(-inner - 1 + ((2 * inner + 2) * q) / 40);
    const board = (z: number): V3[][] => [xs.map((x): V3 => [x, lo(x), z]), xs.map((x): V3 => [x, hi(x), z])];
    const boardShade = byHeight(14, 23, scaleRgb(NAVY, 0.9), rgb("#5a3b9c"));
    grid(lit, board(-0.9), boardShade);
    grid(lit, board(0.9), boardShade);
    grid(lit, [xs.map((x): V3 => [x, hi(x), -0.9]), xs.map((x): V3 => [x, hi(x), 0.9])], GOLD);
    grid(lit, [xs.map((x): V3 => [x, lo(x), -0.9]), xs.map((x): V3 => [x, lo(x), 0.9])], GOLD);
    // Gold trim and bulbs round the board.
    for (let q = 0; q < xs.length - 1; q++) {
      const a = xs[q]!;
      const b = xs[q + 1]!;
      lit.rod([a, lo(a) - 0.1, -1.1], [b, lo(b) - 0.1, -1.1], 0.5, GOLD);
      lit.rod([a, hi(a) + 0.1, -1.1], [b, hi(b) + 0.1, -1.1], 0.5, GOLD);
    }
    for (let q = 0; q < xs.length; q++) {
      const x = xs[q]!;
      bulb(glow, x, lo(x) + 0.6, -1.25, 0.46, lightAt(q));
      bulb(glow, x, hi(x) - 0.6, -1.25, 0.46, lightAt(q + 2));
    }
    // FUN FAIR, block letters 3.5 m tall, alternating gold and pink, reading correctly for a driver coming from -z.
    const cell = 0.54;
    const width = 42 * cell;
    const letterColour = (i: number): Rgb => (i % 2 === 0 ? [4, 2.6, 0.7] : [4, 0.7, 2.0]);
    blockText(glow, "FUN FAIR", -width / 2, 17.2, -1.6, cell, 0.8, letterColour, false);
    lit.box(0, 19.2, -1.05, width + 1.2, 5.0, 0.3, NAVY);
    // A big star on top.
    const sy = hi(0) + 3.2;
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI;
      glow.rod([Math.cos(a) * -3, sy + Math.sin(a) * -3, -1.2], [Math.cos(a) * 3, sy + Math.sin(a) * 3, -1.2], 0.7, q % 2 === 0 ? [4, 3, 0.8] : [4, 1, 1.6]);
    }
    glow.add(shapes.ball(0), xf(0, sy, -1.3, 1.3, 1.3, 0.5), G_WHITE);
    lit.box(0, hi(0) + 0.6, 0, 1.4, 1.4, 1.4, GOLD);
    for (let q = 0; q < 10; q++) halos.push({ x: -inner + 1.3 + q * ((2 * inner - 2.6) / 9), y: lo(0) + 1.4, z: -1.6, size: 5, colour: lightAt(q), alpha: 0.4, twinkle: 0.5 });
    halos.push({ x: 0, y: sy, z: -2, size: 13, colour: [4, 2.8, 1], alpha: 0.6, twinkle: 0.3 });
    halos.push({ x: 0, y: 19, z: -3, size: 20, colour: [3.4, 1.4, 1.6], alpha: 0.3, twinkle: 0.2 });
    return { lit, glow, halos };
  },
};

// ─── Stalls ──────────────────────────────────────────────────────────────────

/** A striped, sloping awning from a high back edge to a low front edge, with a scalloped front. */
function awning(b: MeshBuilder, x0: number, x1: number, yBack: number, zBack: number, yFront: number, zFront: number, n: number, ca: Rgb, cb: Rgb, drop = 1.0): void {
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n;
    const xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const col = i % 2 === 0 ? ca : cb;
    const dark = scaleRgb(col, 0.7);
    b.quad([xa, yBack, zBack], [xb, yBack, zBack], [xb, yFront, zFront], [xa, yFront, zFront], col, col, dark, dark);
    // A thin underside so the canvas has a body when seen from below.
    b.quad([xa, yBack - 0.18, zBack], [xa, yFront - 0.18, zFront], [xb, yFront - 0.18, zFront], [xb, yBack - 0.18, zBack], scaleRgb(col, 0.5));
  }
  scallops(b, [x0, yFront - 0.1, zFront], [x1, yFront - 0.1, zFront], n, drop, ca, cb);
}

/** A plush toy: a bear, a pig, a chick or a bunny as a few lumps, sitting facing +z. */
function plush(b: MeshBuilder, x: number, y: number, z: number, kind: number, s = 1): void {
  const fur = [rgb("#b9773f"), rgb("#ff9ec4"), rgb("#ffe14d"), rgb("#f4f1ff"), rgb("#6fd0ff")][kind % 5]!;
  const belly = mixRgb(fur, WHITE, 0.45);
  b.blob(x, y + 0.55 * s, z, 0.62 * s, 0.7 * s, 0.55 * s, ramp(scaleRgb(fur, 0.6), fur), 0);
  b.blob(x, y + 0.5 * s, z + 0.35 * s, 0.38 * s, 0.4 * s, 0.25 * s, belly, 0);
  b.blob(x, y + 1.38 * s, z + 0.05 * s, 0.52 * s, 0.48 * s, 0.48 * s, fur, 0);
  b.blob(x, y + 1.28 * s, z + 0.42 * s, 0.22 * s, 0.17 * s, 0.18 * s, belly, 0);
  b.box(x - 0.18 * s, y + 1.5 * s, z + 0.46 * s, 0.1 * s, 0.1 * s, 0.06 * s, DARK);
  b.box(x + 0.18 * s, y + 1.5 * s, z + 0.46 * s, 0.1 * s, 0.1 * s, 0.06 * s, DARK);
  for (const sx of [-1, 1]) {
    if (kind % 5 === 3) b.rod([x + sx * 0.2 * s, y + 1.7 * s, z], [x + sx * 0.3 * s, y + 2.5 * s, z - 0.05 * s], 0.18 * s, fur);
    else b.blob(x + sx * 0.38 * s, y + 1.75 * s, z, 0.2 * s, 0.2 * s, 0.14 * s, fur, 0);
    b.blob(x + sx * 0.7 * s, y + 0.65 * s, z + 0.1 * s, 0.2 * s, 0.38 * s, 0.2 * s, fur, 0);
  }
  if (kind % 5 === 2) b.box(x, y + 1.25 * s, z + 0.6 * s, 0.2 * s, 0.1 * s, 0.2 * s, ORANGE);
  if (kind % 5 === 1) b.blob(x, y + 1.25 * s, z + 0.55 * s, 0.14 * s, 0.1 * s, 0.1 * s, rgb("#ff6fa0"), 0);
}

/** A balloon: a glossy lump with a knot, bright at the top. */
function balloon(b: MeshBuilder, x: number, y: number, z: number, c: Rgb, r = 1): void {
  b.blob(x, y, z, 0.82 * r, 1.0 * r, 0.82 * r, ramp(mixRgb(c, WHITE, 0.1), mixRgb(c, WHITE, 0.5)), 0);
  b.spire(x, y - 1.25 * r, z, 0.18 * r, 0.3 * r, scaleRgb(c, 0.6), 4);
}

// ─── Food stall ──────────────────────────────────────────────────────────────

LANDMARKS["food-stall"] = {
  footprint: 11,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    // Floor, back and side walls, and a striped counter front.
    lit.box(0, -0.35, 0.2, 15, 1.0, 9.6, ramp(DARK, rgb("#6b58b8")));
    lit.box(0, 3.4, -3.8, 14, 6.8, 0.4, ramp(rgb("#d9c9a8"), CREAM));
    for (const s of [-1, 1]) lit.box(s * 6.9, 3.4, -0.6, 0.4, 6.8, 6.4, ramp(rgb("#d9c9a8"), CREAM));
    stripedWall(lit, -7, 7, 0.2, 3.2, 3.5, 14, RED, CREAM);
    lit.box(0, 3.35, 3.4, 14.4, 0.32, 2.2, ramp(rgb("#c4a574"), rgb("#f3e1bd")));
    lit.box(0, 3.1, 4.5, 14.4, 0.3, 0.14, GOLD);
    // Corner posts, candy striped.
    for (const x of [-7, 7]) for (const z of [-3.8, 4.4]) stripedRod(lit, [x, -0.5, z], [x, 7.6, z], 0.5, 8, RED, CREAM);
    // The awning, sloping toward the road, with bulbs along its scalloped front.
    awning(lit, -7.6, 7.6, 8.8, -4.4, 6.5, 5.9, 16, RED, CREAM, 1.0);
    for (const s of [-1, 1]) lit.tri([s * 7.65, 8.8, -4.4], [s * 7.65, 6.5, 5.9], [s * 7.65, 6.5, -4.4], scaleRgb(RED, 0.7), scaleRgb(RED, 0.7), scaleRgb(RED, 0.5));
    for (let q = 0; q < 17; q++) {
      const x = -7.4 + q * 0.925;
      bulb(glow, x, 5.7 - Math.sin((q / 16) * Math.PI) * 0.0, 5.95, 0.5, lightAt(q));
    }
    for (let q = 0; q < 12; q++) bulb(glow, -7.5 + q * 1.36, 8.0 - ((q + 1) % 2) * 0.0, 0.3, 0.4, lightAt(q + 1));
    // Warm lamps hanging inside.
    for (const x of [-4, 0, 4]) {
      lit.rod([x, 8.0, 0.5], [x, 6.4, 0.5], 0.15, DARK);
      glow.add(shapes.ball(0), xf(x, 6.1, 0.5, 0.55), G_WARM);
      halos.push({ x, y: 6.1, z: 0.5, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.6, twinkle: 0.2 });
    }
    halos.push({ x: 0, y: 4.5, z: 0, size: 16, colour: [3.0, 1.7, 0.8], alpha: 0.4, twinkle: 0.15 });
    // The menu board on the back wall: lit panel, price lines, three little pictures.
    lit.box(0, 4.7, -3.45, 8.4, 3.6, 0.3, ramp(DARK, NAVY));
    glow.box(0, 4.7, -3.28, 7.8, 3.0, 0.08, [0.8, 0.45, 1.5]);
    for (let q = 0; q < 4; q++) {
      glow.box(-1.2, 5.7 - q * 0.75, -3.2, 3.8 - (q % 2) * 0.8, 0.28, 0.08, lightAt(q));
      glow.box(2.3, 5.7 - q * 0.75, -3.2, 1.0, 0.28, 0.08, G_WHITE);
    }
    glow.add(shapes.cone(8), xf(-3.1, 4.9, -3.2, 0.5, 1.0, 0.5, 0, Math.PI), G_GOLD);
    glow.add(shapes.ball(0), xf(-3.1, 5.6, -3.2, 0.5, 0.5, 0.1), G_PINK);
    halos.push({ x: 0, y: 4.7, z: -2.8, size: 10, colour: [1.4, 0.8, 2.2], alpha: 0.4, twinkle: 0.2 });
    // A giant ice cream on the roof: waffle cone, three scoops and a cherry.
    const icx = -4.3;
    lit.add(shapes.cone(8), xf(icx, 10.6, 0.4, 1.7, 3.6, 1.7, 0, Math.PI), ramp(rgb("#b57b34"), rgb("#f2c26b")));
    lit.rod([icx, 8.4, 0.4], [icx, 8.9, 0.4], 0.5, rgb("#b57b34"));
    for (const [y, r, col] of [[12.7, 1.95, PINK], [14.6, 1.8, rgb("#bff0d4")], [16.3, 1.6, CREAM]] as const) lit.blob(icx, y, 0.4, r, r * 0.85, r, ramp(scaleRgb(col, 0.75), col), 1);
    for (let q = 0; q < 6; q++) lit.blob(icx + Math.cos(q) * 1.8, 11.9, 0.4 + Math.sin(q) * 1.8, 0.3, 0.55, 0.3, PINK, 0);
    lit.blob(icx, 17.9, 0.4, 0.45, 0.45, 0.45, RED, 0);
    halos.push({ x: icx, y: 14, z: 1.5, size: 9, colour: [3.0, 1.4, 1.8], alpha: 0.3, twinkle: 0.2 });
    // A popcorn tub and a stick of candy floss on the counter, both giant.
    const px = 4.4;
    lathe(lit, [[1.15, 3.5], [1.8, 6.0], [1.9, 6.3]], { at: [px, 0, 3.4], segments: 10, shade: stripes(RED, WHITE), caps: "bottom" });
    for (let q = 0; q < 12; q++) {
      const a = q * 2.4;
      lit.blob(px + Math.cos(a) * 0.9 * ((q % 3) / 3 + 0.4), 6.2 + (q % 4) * 0.28, 3.4 + Math.sin(a) * 0.9 * ((q % 3) / 3 + 0.4), 0.52, 0.46, 0.52, ramp(rgb("#e8cf86"), rgb("#fff6d6")), 0);
    }
    const cfx = 1.3;
    lit.add(shapes.cone(8), xf(cfx, 4.9, 3.4, 0.7, 2.6, 0.7, 0, Math.PI), WHITE);
    for (const [dx, dy, dz, r] of [[0, 6.6, 0, 1.3], [0.8, 6.9, 0.2, 0.9], [-0.8, 6.8, -0.2, 0.9], [0.1, 7.7, 0, 0.9]] as const) lit.blob(cfx + dx, dy, 3.4 + dz, r, r * 0.85, r, ramp(rgb("#ff8cc4"), rgb("#ffd2ea")), 1);
    // Till, napkin box and a sign saying open.
    lit.box(-1.8, 3.9, 3.0, 1.4, 0.9, 1.0, ramp(rgb("#555a88"), STEEL));
    lit.box(-0.1, 3.7, 3.2, 0.7, 0.5, 0.5, rgb("#ffffff"));
    glow.box(-5.6, 5.0, 5.3, 1.8, 0.6, 0.1, G_RED);
    lit.box(-5.6, 5.0, 5.2, 2.0, 0.8, 0.1, DARK);
    // The bin by the stall.
    lit.add(shapes.frustum(0.85, 10), xf(8.8, 0.9, 2.5, 0.7, 1.8, 0.7), ramp(rgb("#1e8a58"), GREEN));
    lit.add(shapes.frustum(0.6, 10), xf(8.8, 1.95, 2.5, 0.82, 0.3, 0.82), ramp(rgb("#145e3c"), rgb("#2a8a5a")));
    return { lit, glow, halos };
  },
};

// ─── Balloon stand ───────────────────────────────────────────────────────────

LANDMARKS["balloon-stand"] = {
  footprint: 9,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    lit.box(0, -0.35, 0, 11, 1.0, 7.4, ramp(DARK, rgb("#6b58b8")));
    // Back wall with a dart board, flanked by shelves of prizes.
    lit.box(0, 3.4, -3.0, 10.4, 6.8, 0.4, ramp(rgb("#2d6fb8"), rgb("#58a8f0")));
    for (const s of [-1, 1]) lit.box(s * 5.1, 3.4, -0.4, 0.4, 6.8, 5.6, ramp(rgb("#2d6fb8"), rgb("#58a8f0")));
    stripedWall(lit, -5.2, 5.2, 0.2, 2.8, 2.8, 10, YELLOW, WHITE);
    lit.box(0, 2.95, 2.9, 10.8, 0.3, 1.8, ramp(rgb("#c4a574"), rgb("#f3e1bd")));
    // Dart board: concentric rings, bull and a few darts stuck in it.
    const bx = 0;
    const by = 4.5;
    for (const [i, r, col] of [[0, 2.1, DARK], [1, 1.8, WHITE], [2, 1.45, RED], [3, 1.1, WHITE], [4, 0.75, BLUE], [5, 0.38, YELLOW]] as const) disc(lit, bx, by, -2.7 + i * 0.05, r, 0.12, col, 20);
    for (const [dx, dy] of [[0.3, 0.2], [-0.8, 0.6], [1.0, -0.5], [-0.2, -1.1]] as const) {
      lit.rod([bx + dx, by + dy, -2.45], [bx + dx - 0.15, by + dy - 0.1, -1.3], 0.15, STEEL);
      lit.box(bx + dx - 0.15, by + dy - 0.1, -1.2, 0.5, 0.5, 0.06, RED);
    }
    // Prize shelves with plush toys.
    for (const s of [-1, 1]) {
      for (const [i, y] of [3.9, 5.8].entries()) {
        lit.box(s * 3.7, y - 0.15, -2.2, 2.6, 0.2, 1.4, rgb("#d9b878"));
        for (let q = 0; q < 2; q++) plush(lit, s * 3.7 + (q - 0.5) * 1.3, y - 0.05, -2.2, q + i * 2 + (s > 0 ? 1 : 0), 0.72);
      }
    }
    // Posts and a lit, striped, gabled canopy.
    for (const x of [-5.2, 5.2]) for (const z of [-3.0, 3.1]) stripedRod(lit, [x, -0.5, z], [x, 7.4, z], 0.4, 8, RED, CREAM);
    awning(lit, -5.8, 5.8, 9.2, -3.2, 7.0, 4.6, 12, YELLOW, PINK, 0.9);
    for (let q = 0; q < 13; q++) bulb(glow, -5.6 + q * 0.93, 6.4, 4.7, 0.46, lightAt(q));
    for (let q = 0; q < 9; q++) bulb(glow, -4.6 + q * 1.15, 8.3, 0.5, 0.4, lightAt(q + 1));
    for (const x of [-2.8, 2.8]) {
      glow.add(shapes.ball(0), xf(x, 5.9, 0.8, 0.5), G_WARM);
      halos.push({ x, y: 5.9, z: 0.8, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.6, twinkle: 0.2 });
    }
    halos.push({ x: 0, y: 4.2, z: 0.2, size: 14, colour: [3.0, 1.7, 0.8], alpha: 0.35, twinkle: 0.15 });
    // A lit sign over the canopy: a big balloon on a navy board.
    lit.box(0, 10.8, -1.6, 5.4, 3.4, 0.4, ramp(DARK, NAVY));
    glow.add(shapes.ball(1), xf(0, 11.0, -1.3, 1.1, 1.25, 0.15), G_PINK);
    glow.rod([0, 9.7, -1.25], [-0.3, 9.1, -1.25], 0.14, G_WHITE);
    for (const [dx, dy, c] of [[-1.7, 11.4, G_GOLD], [1.7, 11.4, G_CYAN]] as const) glow.add(shapes.ball(0), xf(dx, dy, -1.3, 0.6, 0.7, 0.12), c);
    halos.push({ x: 0, y: 11, z: -0.6, size: 9, colour: [3.4, 1.0, 1.8], alpha: 0.4, twinkle: 0.4 });

    // The balloon cluster tied to the canopy corner, swaying: its own moving part, pivoted at the knot.
    const ax = 4.4;
    const ay = 9.3;
    const az = 0.6;
    const cluster = new MeshBuilder();
    const colours = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK];
    cluster.blob(ax, ay + 0.05, az, 0.28, 0.28, 0.28, GOLD, 0);
    const rnd = (i: number): number => ((Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1;
    for (let q = 0; q < 26; q++) {
      const ang = q * 2.4;
      const ring = 0.6 + (q % 4) * 0.75 + rnd(q) * 0.4;
      const rise = 5.0 + (q % 4) * 1.35 + rnd(q + 9) * 1.0;
      const bx2 = ax + Math.cos(ang) * ring;
      const bz2 = az + Math.sin(ang) * ring * 0.8;
      const by2 = ay + rise;
      cluster.rod([ax, ay + 0.2, az], [bx2, by2 - 1.2, bz2], 0.15, WHITE);
      balloon(cluster, bx2, by2, bz2, colours[(q * 3 + (q >> 3)) % colours.length]!, 0.95 + rnd(q + 3) * 0.2);
    }
    return {
      lit,
      glow,
      halos,
      moving: [
        {
          lit: cluster,
          pivot: [ax, ay, az],
          update(t, part) {
            part.rotation.z = 0.07 * Math.sin(t * 0.9);
            part.rotation.x = 0.05 * Math.sin(t * 0.7 + 1.3);
          },
        },
      ],
    };
  },
};

// ─── Hook-a-duck ─────────────────────────────────────────────────────────────

/** A yellow toy duck about 1.7 m long with a hook ring on its back, facing +z. */
function toyDuck(): MeshBuilder {
  const b = new MeshBuilder();
  const Y = rgb("#ffe433");
  b.blob(0, 0.55, 0, 0.85, 0.65, 1.1, ramp(rgb("#f5c400"), mixRgb(Y, WHITE, 0.25)), 1);
  b.blob(0, 1.35, 0.7, 0.52, 0.5, 0.5, ramp(rgb("#f0b800"), mixRgb(Y, WHITE, 0.15)), 0);
  b.box(0, 1.25, 1.25, 0.46, 0.14, 0.5, ORANGE);
  b.box(-0.27, 1.5, 1.05, 0.1, 0.1, 0.06, DARK);
  b.box(0.27, 1.5, 1.05, 0.1, 0.1, 0.06, DARK);
  b.spire(0, 0.8, -1.15, 0.3, 0.7, Y, 4);
  for (const s of [-1, 1]) {
    b.blob(s * 0.78, 0.65, -0.05, 0.14, 0.38, 0.62, rgb("#f0b800"), 0);
    b.box(s * 0.84, 0.35, 0.1, 0.1, 0.26, 0.26, DARK);
  }
  // The hook ring on the back and a number plate on the belly side.
  torus(b, 0.3, 0.1, { at: [0, 1.35, -0.4], facing: "x", ringSegments: 8, tubeSegments: 4, shade: STEEL });
  return b;
}

LANDMARKS["hook-a-duck"] = {
  footprint: 11,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halo[] = [];
    const PZ = 1.0; // the pool's centre
    lit.box(0, -0.35, 0, 15, 1.0, 10.4, ramp(DARK, rgb("#6b58b8")));
    // Back wall and a hanging prizes board.
    lit.box(0, 3.5, -4.4, 14.4, 7, 0.4, ramp(rgb("#1f8f9c"), rgb("#52d0d8")));
    for (const s of [-1, 1]) lit.box(s * 7.1, 3.5, -1.6, 0.4, 7, 5.6, ramp(rgb("#1f8f9c"), rgb("#52d0d8")));
    lit.box(0, 4.6, -4.1, 9.0, 3.6, 0.25, ramp(rgb("#d9b878"), rgb("#f6e0b0")));
    for (let q = 0; q < 6; q++) {
      const x = -3.6 + q * 1.44;
      lit.rod([x, 6.4, -3.9], [x, 5.9, -3.9], 0.15, STEEL);
      plush(lit, x, 4.7, -3.7, q, 0.8);
      plush(lit, x + 0.7, 3.45, -3.7, q + 2, 0.6);
    }
    // Counters left and right of the pool, striped.
    for (const s of [-1, 1]) {
      lit.box(s * 5.9, 1.6, 0.9, 2.6, 3.2, 8.2, ramp(DARK, NAVY));
      stripedWall(lit, s * 4.6 - 0.0, s * 7.2, 0.2, 3.0, 5.1, 3, RED, CREAM);
      lit.box(s * 5.9, 3.3, 0.9, 2.9, 0.3, 8.5, ramp(rgb("#c4a574"), rgb("#f3e1bd")));
    }
    // The round pool: striped wall, rim, pale floor, water (glass), a glow under the water.
    lathe(lit, [[3.9, -1], [4.15, -1], [4.15, 1.3], [3.9, 1.3]], { at: [0, 0, PZ], segments: 20, shade: stripes(RED, CREAM) });
    torus(lit, 4.1, 0.38, { at: [0, 1.4, PZ], facing: "y", ringSegments: 20, tubeSegments: 5, shade: stripes(WHITE, YELLOW, "row", 1) });
    lathe(lit, [[0, 0.2], [3.95, 0.2]], { at: [0, 0, PZ], segments: 20, shade: rgb("#bfe9f5"), caps: "top" });
    glow.add(shapes.cylinder(20), xf(0, 0.35, PZ, 3.9, 0.06, 3.9), [0.25, 1.1, 1.6]);
    lathe(glass, [[0, 1.0], [3.95, 1.0]], { at: [0, 0, PZ], segments: 20, shade: [0.3, 0.9, 1.3], caps: "top" });
    halos.push({ x: 0, y: 1.6, z: PZ, size: 12, colour: [0.5, 1.9, 2.8], alpha: 0.3, twinkle: 0.3 });
    // Posts, a striped canopy sloping to the road, bulbs and lamps.
    for (const x of [-7, 7]) for (const z of [-4.4, 5.6]) stripedRod(lit, [x, -0.5, z], [x, 7.6, z], 0.5, 8, YELLOW, TEAL);
    awning(lit, -7.8, 7.8, 9.0, -4.8, 7.0, 6.2, 16, YELLOW, TEAL, 1.0);
    for (let q = 0; q < 17; q++) bulb(glow, -7.6 + q * 0.95, 6.2, 6.3, 0.5, lightAt(q));
    for (const x of [-3, 3]) {
      glow.add(shapes.ball(0), xf(x, 6.0, -1.0, 0.5), G_WARM);
      halos.push({ x, y: 6.0, z: -1.0, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.55, twinkle: 0.2 });
    }
    // The sign: a duck in warm glow on a navy board, lit by bulbs.
    lit.box(0, 11.2, -3.0, 8.2, 4.0, 0.5, ramp(DARK, NAVY));
    glow.add(shapes.ball(1), xf(-0.2, 10.7, -2.7, 1.5, 1.1, 0.14), [4, 3.0, 0.6]);
    glow.add(shapes.ball(1), xf(1.0, 11.8, -2.7, 0.8, 0.8, 0.14), [4, 3.0, 0.6]);
    glow.box(1.95, 11.65, -2.7, 0.9, 0.3, 0.14, G_RED);
    glow.add(shapes.ball(0), xf(-1.5, 11.4, -2.7, 0.35, 0.9, 0.14, 0, 0, 0.5), [4, 3.0, 0.6]);
    bulbLine(glow, [-3.8, 13.0, -2.7], [3.8, 13.0, -2.7], 12, 0.4);
    bulbLine(glow, [-3.8, 9.4, -2.7], [3.8, 9.4, -2.7], 12, 0.4, 2);
    halos.push({ x: 0, y: 11.2, z: -2.2, size: 11, colour: [3.8, 2.6, 0.8], alpha: 0.4, twinkle: 0.3 });

    // Ducks in three drifting groups (each its own turning part, bobbing out of step), plus a pulsing ripple ring.
    const groups: [number, number, number][][] = [
      [[2.6, 0.0, 0], [2.2, 2.3, 1], [3.0, 4.2, 2], [1.4, 5.5, 3]],
      [[3.1, 1.2, 4], [1.8, 3.4, 5], [2.5, 5.1, 6]],
      [[1.0, 0.4, 7], [2.9, 3.0, 8], [2.0, 4.6, 9]],
    ];
    const duckSrc = toyDuck();
    const moving: MovingPart[] = groups.map((g, gi) => {
      const b = new MeshBuilder();
      for (const [r, a] of g) stamp(b, duckSrc, xf(Math.cos(a) * r, 0.95, PZ + Math.sin(a) * r, 1, 1, 1, -a + Math.PI / 2));
      const rate = (gi % 2 === 0 ? 1 : -1) * (0.1 + gi * 0.035);
      return {
        lit: b,
        pivot: [0, 0.95, PZ],
        update(t, part) {
          part.rotation.y = rate * t;
          part.position.y = 0.12 * Math.sin(t * (1.1 + gi * 0.3) + gi * 2) + 0.05;
          part.rotation.z = 0.04 * Math.sin(t * 0.9 + gi);
        },
      };
    });
    const ripple = new MeshBuilder();
    torus(ripple, 2.0, 0.12, { at: [0, 1.02, PZ], facing: "y", ringSegments: 20, tubeSegments: 3, shade: [1, 1, 1] });
    moving.push({
      glass: ripple,
      pivot: [0, 1.0, PZ],
      update(t, part) {
        const k = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8));
        part.scale.set(k, 1, k);
      },
    });
    return { lit, glow, glass, halos, moving };
  },
};

// ─── Helter skelter ──────────────────────────────────────────────────────────

LANDMARKS["helter-skelter"] = {
  footprint: 10,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    const HT = 24.5; // top of the tower
    const radius = (y: number): number => 6.2 - 3.5 * Math.pow(Math.max(0, y) / HT, 0.9);
    const SEG = 16;
    const phase = Math.PI / SEG;

    // The tower: candy-striped cone on a gold-trimmed skirt, then the lantern.
    const prof: [number, number][] = [[7.2, -1.8], [7.2, 0.4], [6.5, 0.9]];
    for (let y = 1.5; y <= HT + 0.01; y += 2.25) prof.push([radius(y), y]);
    lathe(lit, prof, { segments: SEG, phase, shade: (p, _i, j) => scaleRgb(j % 2 === 0 ? RED : CREAM, 0.58 + 0.42 * Math.min(1, Math.max(0, p[1]) / 14)) });
    lathe(lit, [[7.25, -0.2], [7.25, 0.5], [6.6, 0.95]], { segments: SEG, phase, shade: GOLD });
    // The top deck, a ring of columns, a glowing lantern and a striped roof with a flag.
    lathe(lit, [[2.7, HT - 0.2], [4.3, HT], [4.4, HT + 0.5], [2.4, HT + 0.5]], { segments: SEG, phase, shade: stripes(GOLD, YELLOW), caps: "top" });
    lathe(glow, [[2.2, HT + 0.5], [2.2, HT + 3.6]], { segments: 12, shade: [3.4, 2.1, 0.9], caps: "top" });
    for (let q = 0; q < 8; q++) {
      const a = (q / 8) * TAU;
      lit.post(Math.cos(a) * 2.45, HT + 0.5, Math.sin(a) * 2.45, 0.22, 3.2, WHITE, 6);
    }
    lathe(lit, [[3.9, HT + 3.6], [3.9, HT + 4.2], [0.3, HT + 7.2], [0, HT + 7.4]], { segments: 12, shade: stripes(RED, CREAM), caps: "bottom" });
    lit.post(0, HT + 7.2, 0, 0.12 + 0.05, 2.8, BRASS, 6);
    lit.blob(0, HT + 10.2, 0, 0.4, 0.4, 0.4, GOLD, 0);
    lit.tri([0.1, HT + 10.0, 0], [0.1, HT + 8.6, 0], [2.8, HT + 9.3, 0.3], RED, RED, ORANGE);
    lit.tri([0.1, HT + 10.0, 0], [2.8, HT + 9.3, 0.3], [0.1, HT + 8.6, 0], PINK, PINK, PINK);
    halos.push({ x: 0, y: HT + 2.2, z: 0, size: 14, colour: [4, 2.6, 1.1], alpha: 0.65, twinkle: 0.25 });
    halos.push({ x: 0, y: HT + 2.2, z: 0, size: 26, colour: [3.0, 1.5, 0.9], alpha: 0.25, twinkle: 0.2 });

    // The slide: three turns of ribbon, red and white, with a balustrade, rail and bulbs.
    const TURNS = 3;
    const PER = 24;
    const N = TURNS * PER;
    const Y0 = 2.6;
    const Y1 = HT - 0.5;
    const A0 = Math.PI / 2 + 1.1;
    const pt = (i: number, rr: number, dy = 0): V3 => {
      const t = i / N;
      const y = Y0 + (Y1 - Y0) * t;
      const a = A0 + TURNS * TAU * t;
      return [Math.cos(a) * (radius(y) + rr), y + dy, Math.sin(a) * (radius(y) + rr)];
    };
    for (let i = 0; i < N; i++) {
      const colA = Math.floor(i / 3) % 2 === 0 ? RED : WHITE;
      const dark = scaleRgb(colA, 0.6);
      lit.quad(pt(i, -0.3), pt(i, 2.1), pt(i + 1, 2.1), pt(i + 1, -0.3), colA);
      // The underside and the outer edge give the ribbon thickness.
      lit.quad(pt(i, -0.3, -0.4), pt(i + 1, -0.3, -0.4), pt(i + 1, 2.1, -0.4), pt(i, 2.1, -0.4), dark);
      lit.quad(pt(i, 2.1), pt(i + 1, 2.1), pt(i + 1, 2.1, -0.4), pt(i, 2.1, -0.4), scaleRgb(colA, 0.75));
      // Balustrade: a painted panel with a gold cap.
      const pan = Math.floor(i / 3) % 2 === 0 ? CREAM : PINK;
      lit.quad(pt(i, 2.0), pt(i + 1, 2.0), pt(i + 1, 2.0, 1.0), pt(i, 2.0, 1.0), scaleRgb(pan, 0.8), scaleRgb(pan, 0.8), pan, pan);
      lit.quad(pt(i, 2.0, 1.0), pt(i + 1, 2.0, 1.0), pt(i + 1, 1.5, 1.0), pt(i, 1.5, 1.0), GOLD);
      if (i % 3 === 0) {
        const [x, y, z] = pt(i, 2.0);
        lit.box(x, y + 0.6, z, 0.34, 1.3, 0.34, BRASS);
        bulb(glow, ...pt(i, 2.05, 1.35), 0.42, lightAt(i / 3));
      }
    }
    // A short ladder from the top of the slide to the deck.
    const top = pt(N, 0.8, 0);
    lit.rod([top[0], top[1] - 0.1, top[2]], [top[0], HT + 0.4, top[2]], 0.3, STEEL);
    // Lit windows spiral up between the turns, with a door and mat at the foot.
    for (let k = 0; k < 14; k++) {
      const y = 4.4 + k * 1.4;
      const a = Math.PI * 1.2 + k * 1.1;
      const r = radius(y) * 0.985;
      glow.box(Math.cos(a) * r, y + 0.5, Math.sin(a) * r, 0.95, 1.5, 0.22, k % 3 === 0 ? G_PINK : G_WARM, Math.PI / 2 - a);
      lit.box(Math.cos(a) * (r - 0.05), y + 0.5, Math.sin(a) * (r - 0.05), 1.35, 1.9, 0.16, GOLD, Math.PI / 2 - a);
      if (k % 2 === 0) halos.push({ x: Math.cos(a) * (r + 0.4), y: y + 0.5, z: Math.sin(a) * (r + 0.4), size: 5, colour: [3.4, 2.0, 0.9], alpha: 0.4, twinkle: 0.3 });
    }
    const dz = radius(2) * Math.cos(phase) - 0.05;
    lit.box(0, 2.3, dz + 0.4, 3.5, 4.6, 0.9, ramp(rgb("#8a6a3a"), GOLD));
    lit.add(shapes.cylinder(12), xf(0, 4.5, dz + 0.4, 1.75, 0.9, 1.75, 0, Math.PI / 2), GOLD);
    glow.box(0, 2.1, dz + 0.9, 2.5, 3.8, 0.08, G_WARM);
    glow.add(shapes.cylinder(12), xf(0, 4.5, dz + 0.9, 1.25, 0.08, 1.25, 0, Math.PI / 2), G_WARM);
    lit.box(0, 0.12, dz + 2.7, 3.2, 0.24, 3.2, ramp(scaleRgb(RED, 0.7), RED));
    lit.box(0, 0.26, dz + 2.7, 2.2, 0.06, 2.2, CREAM);
    halos.push({ x: 0, y: 2.6, z: dz + 1.8, size: 9, colour: [3.4, 2.0, 0.9], alpha: 0.5, twinkle: 0.2 });
    // Flag poles round the foot.
    for (let q = 0; q < 6; q++) {
      const a = (q / 6) * TAU + 0.3;
      const x = Math.cos(a) * 8.2;
      const z = Math.sin(a) * 8.2;
      lit.post(x, -0.5, z, 0.16, 5, STEEL, 6);
      lit.tri([x, 4.4, z], [x, 3.2, z], [x + Math.cos(a + 1.57) * 1.7, 3.8, z + Math.sin(a + 1.57) * 1.7], candyAt(q), candyAt(q + 1), scaleRgb(candyAt(q), 0.8));
    }
    return { lit, glow, halos };
  },
};

// ─── Fireworks ───────────────────────────────────────────────────────────────

/** Directions spread evenly over a sphere (a Fibonacci spiral). */
function sphereDirs(n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

LANDMARKS.fireworks = {
  footprint: 10,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    // A launch deck of planks with a rack of mortar tubes, crates, barrels and a ramp with three rockets.
    lit.box(0, -0.4, 0, 22, 1.0, 14, ramp(DARK, rgb("#6b4a2c")));
    for (let q = 0; q < 6; q++) lit.box(-9.5 + q * 3.8, 0.12, 0, 0.14 + 0.06, 0.1, 13.6, rgb("#4a3320"));
    // Mortar rack: a frame holding 4 x 3 tubes, leaning back a little.
    lit.box(-6, 0.9, -1, 6.6, 1.4, 3.4, ramp(rgb("#4a3320"), rgb("#8a6a3a")));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const x = -8.1 + i * 1.4;
        const z = -2.1 + j * 1.1;
        const col = candyAt(i * 3 + j);
        lit.add(shapes.cylinder(8), xf(x, 3.0, z, 0.5, 4.0, 0.5, 0, -0.12), ramp(scaleRgb(col, 0.5), col));
        lit.add(shapes.cylinder(8), xf(x, 5.2 + 0.0, z + 0.27, 0.42, 0.3, 0.42, 0, -0.12), DARK);
        lit.add(shapes.cylinder(8), xf(x, 2.1, z, 0.55, 0.3, 0.55), GOLD);
      }
    }
    // Crates with warning stripes, stacked, and powder barrels.
    for (const [x, y, z, yaw] of [[1.5, 0.8, -3.6, 0.1], [3.4, 0.8, -3.2, -0.2], [2.4, 2.3, -3.4, 0.15]] as const) {
      lit.box(x, y, z, 2.0, 1.5, 2.0, ramp(rgb("#8a5a2a"), rgb("#d9a050")), yaw);
      lit.box(x, y, z + 0.02, 2.06, 0.34, 2.06, DARK, yaw);
      lit.box(x, y + 0.2, z + 1.03, 1.2, 0.6, 0.06, RED, yaw);
    }
    for (const [x, z] of [[-1.6, -4.4], [0.1, -4.8]] as const) {
      lit.add(shapes.cylinder(10), xf(x, 0.95, z, 0.9, 1.7, 0.9), ramp(scaleRgb(RED, 0.6), RED));
      lit.add(shapes.cylinder(10), xf(x, 0.9, z, 0.96, 0.2, 0.96), GOLD);
      lit.add(shapes.cylinder(10), xf(x, 1.5, z, 0.96, 0.2, 0.96), GOLD);
    }
    // The ramp: a slanted rail with three big rockets, noses to the sky.
    lit.rod([5.5, 0.4, 3.5], [10.2, 4.4, 2.2], 0.4, rgb("#6b4a2c"));
    lit.rod([5.5, 0.4, -0.5], [10.2, 4.4, -1.8], 0.4, rgb("#6b4a2c"));
    for (let q = 0; q < 3; q++) {
      const z = 2.4 - q * 1.9;
      const col = [RED, BLUE, GREEN][q]!;
      const base: V3 = [6.0 + q * 0.2, 1.3, z];
      const tip: V3 = [9.6 + q * 0.4, 4.5, z - 0.6];
      lit.rod(base, tip, 0.9, ramp(scaleRgb(col, 0.6), col));
      lit.rod([tip[0], tip[1], tip[2]], [tip[0] + 1.0, tip[1] + 0.9, tip[2] - 0.15], 0.5, GOLD);
      bulb(glow, base[0] - 0.4, base[1] - 0.3, base[2], 0.5, G_GOLD);
    }
    // Fuse trail and lanterns.
    for (let q = 0; q < 6; q++) bulb(glow, 3 + q * 1.1, 0.35, 4.6 - q * 0.6, 0.28, q === 5 ? G_WHITE : G_RED);
    halos.push({ x: 8, y: 0.5, z: 1.5, size: 5, colour: G_WHITE, alpha: 0.7, twinkle: 0.9 });
    for (const x of [-10, 10]) {
      lit.post(x, -0.5, 6, 0.18, 4.5, STEEL, 6);
      glow.add(shapes.ball(0), xf(x, 4.4, 6, 0.5), G_WARM);
      halos.push({ x, y: 4.4, z: 6, size: 6, colour: [3.4, 2.0, 0.9], alpha: 0.6, twinkle: 0.3 });
    }
    halos.push({ x: -6, y: 6, z: -1, size: 6, colour: G_GOLD, alpha: 0.5, twinkle: 0.8 });

    // Three bursts in the sky, each looping: expand, hold, fall and fade, wait.
    const dirs = sphereDirs(24);
    const burstDefs: { c: V3; R: number; a: Rgb; b: Rgb; phase: number; period: number }[] = [
      { c: [-14, 58, 6], R: 15, a: [2.8, 1.6, 0.25], b: [3.2, 1.0, 0.2], phase: 0, period: 8 },
      { c: [16, 66, 10], R: 13, a: [2.8, 0.35, 1.5], b: [2.2, 0.5, 2.8], phase: 3.1, period: 8.6 },
      { c: [2, 46, -6], R: 11, a: [0.3, 1.9, 3.0], b: [0.5, 2.8, 1.6], phase: 5.6, period: 7.4 },
    ];
    const moving: MovingPart[] = burstDefs.map((d) => {
      const g = new MeshBuilder();
      g.add(shapes.ball(1), xf(d.c[0], d.c[1], d.c[2], 2.4), G_WHITE);
      dirs.forEach((u, i) => {
        const col = i % 2 === 0 ? d.a : d.b;
        g.rod([d.c[0] + u[0] * d.R * 0.2, d.c[1] + u[1] * d.R * 0.2, d.c[2] + u[2] * d.R * 0.2], [d.c[0] + u[0] * d.R * 0.92, d.c[1] + u[1] * d.R * 0.92, d.c[2] + u[2] * d.R * 0.92], 0.5, col);
        g.box(d.c[0] + u[0] * d.R, d.c[1] + u[1] * d.R, d.c[2] + u[2] * d.R, 1.1, 1.1, 1.1, [3, 2.5, 1.8], 0.7, 0.6, 0.3);
        // A second, inner shell of short sparks.
        g.rod([d.c[0] + u[0] * d.R * 0.5, d.c[1] + u[1] * d.R * 0.5, d.c[2] + u[2] * d.R * 0.5], [d.c[0] + u[0] * d.R * 0.66, d.c[1] + u[1] * d.R * 0.66, d.c[2] + u[2] * d.R * 0.66], 0.35, col);
      });
      return {
        glow: g,
        pivot: d.c,
        update(t, part) {
          const u = (((t + d.phase) % d.period) + d.period) % d.period;
          let s = 0;
          let fall = 0;
          if (u < 2.4) {
            const x = u / 2.4;
            s = 0.05 + 0.95 * (1 - Math.pow(1 - x, 3));
          } else if (u < 3.6) {
            s = 1 + 0.04 * (u - 2.4);
          } else if (u < 5.0) {
            const x = (u - 3.6) / 1.4;
            s = 1.05 * (1 - x * x);
            fall = 7 * x * x;
          }
          part.visible = s > 0.001;
          part.scale.setScalar(s);
          part.position.set(0, -fall, 0);
        },
      };
    });
    return { lit, glow, halos, moving };
  },
};

// ─── Hazards ─────────────────────────────────────────────────────────────────

HAZARDS["teacup-ride"] = {
  build(ctx) {
    const base = new MeshBuilder();
    const baseGlow = new MeshBuilder();
    // A round platform ringed with bulbs.
    lathe(base, [[0, 0], [2.3, 0], [2.3, 0.22], [2.1, 0.34], [0, 0.34]], { segments: 16, shade: stripes(rgb("#6b58b8"), rgb("#9a86e8")), caps: "top" });
    for (let q = 0; q < 14; q++) {
      const a = (q / 14) * TAU;
      bulb(baseGlow, Math.cos(a) * 2.05, 0.42, Math.sin(a) * 2.05, 0.3, lightAt(q));
    }
    // The cup: striped pastel body, gold rim, a handle, a seat, a bar and a little wheel.
    const cup = new MeshBuilder();
    const pastel = stripes(rgb("#ff9ec8"), rgb("#fff3f8"));
    lathe(cup, [[0.7, 0.34], [1.15, 0.5], [1.55, 0.95], [1.68, 1.5], [1.66, 1.75]], { segments: 12, shade: pastel, caps: "bottom" });
    lathe(cup, [[1.64, 1.7], [1.78, 1.7], [1.78, 1.9], [1.64, 1.9]], { segments: 12, shade: GOLD });
    lathe(cup, [[1.5, 1.7], [1.2, 0.95], [0.7, 0.5]], { segments: 12, shade: rgb("#c9a3d9") });
    cup.box(0, 1.0, -0.75, 1.9, 0.3, 0.7, ramp(rgb("#2a6fd0"), rgb("#58a8f0")));
    cup.box(0, 1.55, -1.1, 1.9, 0.7, 0.2, rgb("#58a8f0"));
    tube(cup, [[-0.75, 1.65, 0.55], [-0.75, 1.9, 0.7], [0.75, 1.9, 0.7], [0.75, 1.65, 0.55]], { radius: 0.09, sides: 4, shade: STEEL });
    torus(cup, 0.38, 0.09, { at: [0, 1.45, 0.1], facing: "y", ringSegments: 10, tubeSegments: 4, shade: GOLD });
    pipe(cup, [0, 0.95, 0.1], [0, 1.45, 0.1], 0.1, STEEL, 4);
    tube(cup, [[1.72, 1.55, 0], [2.05, 1.5, 0], [2.15, 1.2, 0], [1.9, 0.85, 0], [1.6, 0.8, 0]], { radius: 0.12, sides: 4, shade: GOLD });
    const g = new Group();
    const baseMesh = new Mesh(base.build(), ctx.lit);
    const baseGlowMesh = new Mesh(baseGlow.build(), ctx.glow);
    const spin = new Group();
    spin.add(new Mesh(cup.build(), ctx.lit));
    g.add(baseMesh, baseGlowMesh, spin);
    return {
      root: g,
      radius: 2.3,
      update(s) {
        spin.rotation.y = s.time * 2.8;
        spin.position.y = 0;
      },
    };
  },
};

HAZARDS["bumper-car"] = {
  build(ctx) {
    const b = new MeshBuilder();
    const gl = new MeshBuilder();
    const col = rgb("#ff3d7a");
    // A round-bodied dodgem: floor skirt, bubble body, black rubber ring, seat and wheel.
    lathe(b, [[0.7, 0.2], [1.0, 0.3], [1.08, 0.7], [0.98, 1.05], [0.7, 1.25], [0.45, 1.3]], { segments: 12, shade: byHeight(0.2, 1.3, scaleRgb(col, 0.7), mixRgb(col, WHITE, 0.2)) });
    torus(b, 1.16, 0.24, { at: [0, 0.55, 0], facing: "y", ringSegments: 14, tubeSegments: 5, shade: rgb("#232323") });
    b.box(0, 1.0, -0.35, 0.9, 0.3, 0.6, rgb("#2a2150"));
    b.box(0, 1.35, -0.62, 0.9, 0.7, 0.18, rgb("#2a2150"));
    b.box(0, 1.15, 0.45, 0.6, 0.3, 0.3, rgb("#fff1d6"));
    torus(b, 0.28, 0.07, { at: [0, 1.45, 0.4], facing: "z", ringSegments: 10, tubeSegments: 4, shade: rgb("#232323") });
    b.rod([0, 1.2, 0.5], [0, 1.45, 0.4], 0.14, STEEL);
    // The pole at the back, topped by a sparkling lamp.
    pipe(b, [0, 1.0, -0.78], [0, 3.4, -0.78], 0.09, STEEL, 5);
    b.blob(0, 3.5, -0.78, 0.2, 0.2, 0.2, STEEL, 0);
    gl.add(shapes.ball(1), xf(0, 3.72, -0.78, 0.26), [4, 3.4, 1.2]);
    gl.rod([-0.45, 3.72, -0.78], [0.45, 3.72, -0.78], 0.09, [3, 2.6, 1]);
    gl.rod([0, 3.27, -0.78], [0, 4.17, -0.78], 0.09, [3, 2.6, 1]);
    // The headlamp, and a stripe down the bonnet.
    gl.add(shapes.ball(0), xf(0, 0.8, 1.0, 0.22, 0.2, 0.12), [4, 3.4, 1.8]);
    b.box(0, 1.28, 0.1, 0.18, 0.06, 1.0, WHITE);
    const inner = new Group();
    inner.add(new Mesh(b.build(), ctx.lit), new Mesh(gl.build(), ctx.glow));
    const root = new Group();
    root.add(inner);
    return {
      root,
      radius: 1.5,
      update(s) {
        // The whole car rocks a little with the road it covers.
        inner.rotation.z = 0.06 * Math.sin(s.travel * 0.9);
        inner.rotation.x = 0.04 * Math.sin(s.travel * 1.4 + 1);
        inner.position.y = 0.04 * (1 + Math.sin(s.travel * 2.2));
      },
    };
  },
};
