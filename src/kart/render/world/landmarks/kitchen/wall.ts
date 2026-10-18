/**
 * The kitchen's wall pieces, both built on the same wall of stack-bonded
 * tiles: the window, glowing with golden hour and throwing a long shaft of
 * light down across the road, and the wall clock, whose hands tell the real
 * time (clock.ts).
 */
import type { Paint } from "../../builder";
import { clockAngles } from "../clock";
import { byHeight, grid, lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, torus, xf, type Rgb, type V3 } from "../kit";
import type { LandmarkSpec, MovingPart } from "../types";
import { CHINA, GOLD, LEAF, lift, TAU, WHITE } from "./common";

// ─── The tiled wall ──────────────────────────────────────────────────────────

/**
 * A tiled wall: `cols` x `rows` stack-bonded ceramic tiles on a grout-coloured slab `depth` thick, front face at +z.
 * Tiles alternate between two whites so the grout lines read; `skip(i, j)` leaves a cell empty (a window), `accent`
 * paints whole rows in another colour. The wall stands on y = 0 and runs from x = -cols*cw/2.
 */
function tileWall(
  b: MeshBuilder,
  cols: number,
  rows: number,
  cw: number,
  rh: number,
  depth: number,
  skip: (i: number, j: number) => boolean,
  accent: (j: number) => Rgb | null,
): void {
  const w = cols * cw;
  const grout = rgb("#cfc8bb");
  const front = depth / 2;
  // The grout slab behind, in runs of cells so a window can be cut through it.
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      if (skip(i, j)) {
        i++;
        continue;
      }
      let k = i;
      while (k < cols && !skip(k, j)) k++;
      const y0 = j === 0 ? -1.5 : j * rh;
      const y1 = (j + 1) * rh;
      b.box(-w / 2 + ((i + k) / 2) * cw, (y0 + y1) / 2, 0, (k - i) * cw, y1 - y0, depth, ramp(scaleRgb(grout, 0.55 + 0.45 * (j / rows)), scaleRgb(grout, 0.6 + 0.4 * ((j + 1) / rows))));
      i = k;
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (skip(i, j)) continue;
      const ac = accent(j);
      const k = j / rows;
      const base: Rgb = (i + j) % 2 === 0 ? rgb("#fbf8f1") : rgb("#eaf0f2");
      const col = ac ?? mixRgb(scaleRgb(base, 0.8), base, 0.4 + 0.6 * k);
      const x = -w / 2 + (i + 0.5) * cw;
      const y = (j + 0.5) * rh;
      b.box(x, y, front + 0.12, cw - 0.22, rh - 0.22, 0.34, col);
    }
  }
}

// ─── Window ──────────────────────────────────────────────────────────────────

const GROUT_COLS = 12;

export const windowWall: LandmarkSpec = {
  footprint: 30,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const cw = 4;
    const rh = 2.5;
    const frameWhite = lift("#fbfbf7", 1.2);
    const cob = lift("#2f7ae6", 1.35);
    const opening = { x0: -12, x1: 12, y0: 10, y1: 37.5 };
    tileWall(
      lit,
      GROUT_COLS,
      18,
      cw,
      rh,
      3,
      (i, j) => {
        const x = -24 + (i + 0.5) * cw;
        const y = (j + 0.5) * rh;
        return x > opening.x0 && x < opening.x1 && y > opening.y0 && y < opening.y1;
      },
      (j) => (j === 2 || j === 15 ? cob : j === 3 || j === 14 ? lift("#d6e6fa", 1.2) : null),
    );
    // A cap along the top of the wall and a skirting round its foot.
    lit.box(0, 45.5, 0, 50, 1.4, 4.4, ramp(frameWhite, WHITE));
    lit.box(0, 0.7, 0.1, 49.4, 1.8, 3.6, ramp(scaleRgb(frameWhite, 0.7), frameWhite));
    // The window: a deep white frame, two transoms and a mullion.
    const bar = (x: number, y: number, w: number, h: number, d = 4.2) => lit.box(x, y, 0.1, w, h, d, ramp(scaleRgb(frameWhite, 0.8), frameWhite));
    bar(opening.x0 + 0.1, 23.75, 3.0, 29.5);
    bar(opening.x1 - 0.1, 23.75, 3.0, 29.5);
    bar(0, opening.y0 + 0.3, 27, 2.6);
    bar(0, opening.y1 - 0.3, 27, 2.6);
    bar(0, 0.5 * (opening.y0 + opening.y1), 1.3, 27.5, 3.4);
    bar(0, 19.4, 24, 1.1, 3.4);
    bar(0, 28.6, 24, 1.1, 3.4);
    // The sill, a ledge sticking out toward the road.
    lit.box(0, 9.3, 3.2, 31, 1.2, 6.2, ramp(scaleRgb(frameWhite, 0.85), frameWhite));
    // The pane: golden hour, white-gold at the top fading to orange at the bottom, a low sun and the dark line of far hills.
    const rows = 10;
    const colsN = 4;
    const pane = (y: number): Rgb => mixRgb([3.4, 1.55, 0.5], [4.2, 3.7, 2.6], Math.pow((y - opening.y0) / (opening.y1 - opening.y0), 0.8));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < colsN; c++) {
        const x0 = opening.x0 + 0.1 + (c * (opening.x1 - opening.x0 - 0.2)) / colsN;
        const x1 = opening.x0 + 0.1 + ((c + 1) * (opening.x1 - opening.x0 - 0.2)) / colsN;
        const y0 = opening.y0 + (r * (opening.y1 - opening.y0)) / rows;
        const y1 = opening.y0 + ((r + 1) * (opening.y1 - opening.y0)) / rows;
        glow.quad([x0, y0, -0.3], [x1, y0, -0.3], [x1, y1, -0.3], [x0, y1, -0.3], pane(y0), pane(y0), pane(y1), pane(y1));
      }
    }
    glow.blob(6, 15.5, 0.0, 3.8, 3.8, 0.15, [4.8, 4.4, 3.4], 1);
    glow.blob(-6, 12.6, 0.0, 9, 2.2, 0.15, [2.4, 1.0, 0.3], 1);
    glow.blob(7.5, 12.2, 0.0, 7, 2.0, 0.15, [2.2, 0.9, 0.28], 1);
    // The shaft of light the window throws, long and slanting down toward the road: pale gold glass, an open prism (the counter is
    // its floor) with a narrower, brighter core, fading with distance.
    for (const [k, brightness] of [[1, 2.3], [0.55, 2.6]] as const) {
      const section = (z: number, grow: number, drop: number): V3[] => {
        const hx = 12 * k * grow;
        const y0 = opening.y0 + (opening.y1 - opening.y0) * (0.5 - 0.5 * k) - drop;
        const y1 = opening.y0 + (opening.y1 - opening.y0) * (0.5 + 0.5 * k) - drop;
        return [[-hx, Math.max(0.2, y0), z], [-hx, y1, z], [hx, y1, z], [hx, Math.max(0.2, y0), z]];
      };
      grid(glass, [section(2.3, 1, 0), section(80, 1.9, 24 * (k + 0.4))], (p) => {
        const f = Math.max(0, 1 - (p[2] - 2) / 80);
        return scaleRgb([1.2, 0.95, 0.45], brightness * (0.25 + 0.9 * f));
      });
    }
    // The curtain, tied back on the left: striped drops from a rod.
    lit.rod([-17, 39.6, 2.6], [-1, 39.6, 2.6], 0.5, rgb("#6a4a2a"));
    for (const x of [-17, -1]) lit.blob(x, 39.6, 2.6, 0.9, 0.9, 0.9, GOLD, 0);
    for (let i = 0; i < 7; i++) {
      const x = -15.5 + i * 1.5;
      const col = i % 2 === 0 ? lift("#4f86d8", 1.4) : lift("#f6efe0", 1.2);
      const tie = -14 + i * 0.85;
      lit.rod([x, 39, 2.6], [tie, 24, 3.4], 1.25, ramp(scaleRgb(col, 0.75), col));
      lit.rod([tie, 24, 3.4], [-15.8 + i * 1.9 - 0.8, 10.2, 2.9], 1.25, ramp(scaleRgb(col, 0.6), col));
    }
    lit.box(-11.4, 23.9, 3.6, 7.2, 0.8, 1.8, GOLD, 0, 0, 0.05);
    // A potted plant on the sill: terracotta, leaves and pink blooms.
    lathe(lit, [[0, 9.8], [1.9, 9.8], [2.5, 12.8], [2.8, 13.0], [2.8, 13.9], [2.4, 13.9], [2.2, 13.2], [0, 13.2]], { at: [9, 0, 3.4], segments: 10, shade: byHeight(9.8, 13.9, scaleRgb(rgb("#c8663a"), 1.0), lift("#e88a58", 1.2)) });
    lit.blob(9, 13.3, 3.4, 2.2, 0.35, 2.2, lift("#4a3020", 1.2), 0);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      const lx = 9 + Math.cos(a) * 1.2;
      const lz = 3.4 + Math.sin(a) * 1.2;
      lit.rod([9, 13.3, 3.4], [lx + Math.cos(a) * 1.4, 17.5 + (i % 3) * 1.2, lz + Math.sin(a) * 1.4], 0.25, LEAF);
      lit.blob(lx + Math.cos(a) * 1.7, 17.9 + (i % 3) * 1.2, lz + Math.sin(a) * 1.7, 0.7, 1.5, 0.4, ramp(scaleRgb(LEAF, 0.7), LEAF), 0, -a + 1.57);
    }
    for (const [dx, dy, dz] of [[-0.9, 20.6, 0.3], [0.9, 19.7, -0.6], [0.2, 21.2, 1.0]] as const) lit.blob(9 + dx, dy, 3.4 + dz, 0.9, 0.9, 0.9, lift("#ff6fa5", 1.3), 0);
    const halos = [
      { x: 0, y: 24, z: 3, size: 58, colour: [3.2, 2.2, 1.0] as const, alpha: 0.3 },
      { x: 4, y: 18, z: 4, size: 26, colour: [4.0, 3.4, 2.2] as const, alpha: 0.35 },
    ];
    return { lit, glow, glass, halos };
  },
};

// ─── Wall clock ──────────────────────────────────────────────────────────────

/** One digit as seven segments of boxes, in the wall's x-y plane at depth z; (cx, cy) the middle, `h` the height. */
function digit(b: MeshBuilder, d: number, cx: number, cy: number, z: number, h: number, paint: Paint): void {
  const SEG = [0b1110111, 0b0100100, 0b1011101, 0b1101101, 0b0101110, 0b1101011, 0b1111011, 0b0100101, 0b1111111, 0b1101111];
  const m = SEG[d]!;
  const w = h * 0.55;
  const t = h * 0.16;
  // bits: 0 top, 1 upper left, 2 upper right, 3 middle, 4 lower left, 5 lower right, 6 bottom
  const parts: [number, number, number, number, number][] = [
    [0, h / 2 - t / 2, w, t, 0],
    [-w / 2 + t / 2, h / 4, t, h / 2 - t, 1],
    [w / 2 - t / 2, h / 4, t, h / 2 - t, 2],
    [0, 0, w, t, 3],
    [-w / 2 + t / 2, -h / 4, t, h / 2 - t, 4],
    [w / 2 - t / 2, -h / 4, t, h / 2 - t, 5],
    [0, -h / 2 + t / 2, w, t, 6],
  ];
  for (const [x, y, sx, sy, bit] of parts) if (m & (1 << bit)) b.box(cx + x, cy + y, z, sx, sy, 0.4, paint);
}

export const wallClock: LandmarkSpec = {
  footprint: 24,
  build() {
    const lit = new MeshBuilder();
    const cw = 4;
    const rh = 2.5;
    const cob = lift("#2f7ae6", 1.35);
    const rim = lift("#e5392f", 1.35);
    const cream = lift("#fff6de", 1.25);
    const ink = lift("#2a3552", 1.3);
    tileWall(lit, 9, 16, cw, rh, 3, () => false, (j) => (j === 2 || j === 13 ? cob : j === 3 || j === 12 ? lift("#d6e6fa", 1.2) : null));
    lit.box(0, 40.7, 0, 37, 1.4, 4.4, ramp(CHINA, WHITE));
    lit.box(0, 0.7, 0.1, 36.4, 1.8, 3.6, ramp(scaleRgb(CHINA, 0.7), CHINA));
    const cy = 23;
    const zf = 1.9;
    // The red rim, a cream face and the numerals.
    torus(lit, 9.3, 1.1, { at: [0, cy, zf + 0.55], facing: "z", ringSegments: 28, tubeSegments: 6, shade: (p) => scaleRgb(rim, 0.8 + 0.3 * Math.max(0, Math.min(1, (p[1] - cy + 10) / 20))) });
    lit.add(shapes.cylinder(28), xf(0, cy, zf + 0.5, 9.0, 0.7, 9.0, 0, Math.PI / 2), ramp(scaleRgb(cream, 0.85), cream));
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * TAU;
      const big = n % 3 === 0;
      const r = big ? 4.6 : 4.9;
      const h = big ? 2.6 : 1.7;
      const x = Math.sin(a) * r;
      const y = cy + Math.cos(a) * r;
      const z = zf + 0.9;
      if (n < 10) digit(lit, n, x, y, z, h, ink);
      else {
        digit(lit, 1, x - h * 0.38, y, z, h, ink);
        digit(lit, n - 10, x + h * 0.38, y, z, h, ink);
      }
    }
    for (let m = 0; m < 60; m++) {
      if (m % 5 === 0) continue;
      const a = (m / 60) * TAU;
      lit.box(Math.sin(a) * 7.65, cy + Math.cos(a) * 7.65, zf + 0.9, 0.32, 0.9, 0.3, ink, 0, 0, -a);
    }
    for (let m = 0; m < 12; m++) {
      const a = (m / 12) * TAU;
      lit.box(Math.sin(a) * 7.2, cy + Math.cos(a) * 7.2, zf + 0.9, 0.55, 1.5, 0.35, rim, 0, 0, -a);
    }
    // The hour hand, a spade-tipped bar, drawn at twelve; the clock turns it to the real time.
    const hour = new MeshBuilder();
    hour.rod([0, cy, zf + 1.4], [0, cy + 4.4, zf + 1.4], 0.85, ink);
    hour.blob(0, cy + 4.7, zf + 1.4, 0.8, 1.2, 0.3, ink, 0, 0);
    const hand = (w: number, len: number, z: number, paint: Paint, tail: number) => {
      const g = new MeshBuilder();
      g.box(0, cy + len / 2 - tail / 2, z, w, len + tail, 0.4, paint);
      g.blob(0, cy + len, z, w * 0.9, w * 1.4, 0.3, paint, 0);
      return g;
    };
    const minute = hand(0.8, 6.6, zf + 1.8, ink, 1.0);
    const second = hand(0.35, 7.4, zf + 2.3, rim, 2.0);
    second.add(shapes.cylinder(10), xf(0, cy - 2.0, zf + 2.3, 0.8, 0.4, 0.8, 0, Math.PI / 2), rim);
    // The hands tell the real time (clock.ts), on the player's own clock.
    const moving: MovingPart[] = [
      {
        lit: hour,
        pivot: [0, cy, zf + 1.4],
        update(_t, part) {
          part.rotation.z = -clockAngles(new Date()).hour;
        },
      },
      {
        lit: minute,
        pivot: [0, cy, zf + 1.8],
        update(_t, part) {
          part.rotation.z = -clockAngles(new Date()).minute;
        },
      },
      {
        lit: second,
        pivot: [0, cy, zf + 2.3],
        update(_t, part) {
          part.rotation.z = -clockAngles(new Date()).second;
        },
      },
    ];
    lit.add(shapes.cylinder(12), xf(0, cy, zf + 2.55, 1.0, 0.7, 1.0, 0, Math.PI / 2), rim);
    // A little bell on each side of the top of the case.
    for (const s of [-1, 1]) lit.blob(s * 7.4, cy + 9.4, zf + 0.4, 1.8, 1.4, 1.4, ramp(scaleRgb(rim, 0.8), rim), 1);
    return { lit, moving };
  },
};
