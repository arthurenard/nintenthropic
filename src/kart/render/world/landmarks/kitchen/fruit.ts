/**
 * The fruit bowl: a turned walnut bowl heaped with oranges, apples, pears and
 * lemons, a hand of bananas and two bunches of grapes, each fruit a few
 * faceted shapes with a shine on its upper side.
 */
import { byHeight, lathe, MeshBuilder, mixRgb, ramp, rgb, rockBlob, scaleRgb, shapes, tube, xf, type Rgb, type V3 } from "../kit";
import type { LandmarkSpec } from "../types";
import { APPLE, LEAF, LEMON, ORANGE, PEAR, plaque, STALK, TAU, WALNUT, WOOD_L } from "./common";

/** A highlight patch on a ball of radius r about c, up and toward the viewer. */
function shine(b: MeshBuilder, c: V3, r: number, base: Rgb, strength = 0.55): void {
  plaque(b, c, r * 0.97, [0.35, 0.65, 0.68], r * 0.2, r * 0.42, r * 0.07, mixRgb(base, [1, 1, 0.92], strength), -0.5);
}

function fruitLeaf(b: MeshBuilder, x: number, y: number, z: number, len: number, yaw: number): void {
  b.add(shapes.ball(0), xf(x + Math.sin(yaw) * len * 0.5, y + len * 0.12, z + Math.cos(yaw) * len * 0.5, len * 0.28, len * 0.07, len * 0.5, yaw, -0.2), ramp(scaleRgb(LEAF, 0.7), LEAF));
}

function orange(b: MeshBuilder, x: number, y: number, z: number, r: number, seed: number): void {
  rockBlob(b, x, y, z, r, r * 0.95, r, byHeight(y - r, y + r, scaleRgb(ORANGE, 0.72), mixRgb(ORANGE, [1, 1, 0.6], 0.14)), seed, { detail: 1, roughness: 0.035 });
  b.blob(x, y + r * 0.95, z, r * 0.17, r * 0.06, r * 0.17, LEAF, 0);
  shine(b, [x, y, z], r, ORANGE);
}

function apple(b: MeshBuilder, x: number, y: number, z: number, r: number, col: Rgb, yaw = 0): void {
  b.blob(x, y, z, r, r * 0.9, r, ramp(scaleRgb(col, 0.65), mixRgb(col, [1, 0.7, 0.6], 0.12)), 1, yaw);
  b.blob(x, y + r * 0.8, z, r * 0.45, r * 0.25, r * 0.45, scaleRgb(col, 0.5), 0);
  b.rod([x, y + r * 0.7, z], [x + r * 0.1, y + r * 1.4, z], r * 0.1, STALK);
  fruitLeaf(b, x + r * 0.1, y + r * 1.3, z, r * 0.9, yaw + 0.8);
  shine(b, [x, y, z], r, col);
}

function pear(b: MeshBuilder, x: number, y: number, z: number, s: number, tilt: number, yaw: number): void {
  const prof: [number, number][] = [[0, 0], [1.3, 0.1], [2.1, 0.9], [2.4, 2.0], [1.9, 3.1], [1.3, 4.0], [1.0, 4.9], [1.0, 5.6], [0, 5.9]];
  lathe(b, prof.map(([r, h]): [number, number] => [r * s, h * s]), {
    at: [x, y, z],
    segments: 9,
    shade: byHeight(y, y + 5.9 * s, scaleRgb(PEAR, 0.7), mixRgb(PEAR, [1, 1, 0.5], 0.2)),
    matrix: xf(0, 0, 0, 1, 1, 1, yaw, tilt, 0),
  });
  const a = tilt;
  const tip: V3 = [x + Math.sin(yaw) * -Math.sin(a) * 5.8 * s, y + Math.cos(a) * 5.8 * s, z + Math.cos(yaw) * -Math.sin(a) * 5.8 * s];
  b.rod(tip, [tip[0], tip[1] + 1.0 * s, tip[2]], 0.18 * s, STALK);
}

function lemon(b: MeshBuilder, x: number, y: number, z: number, r: number, yaw: number): void {
  b.blob(x, y, z, r * 1.25, r * 0.88, r * 0.88, ramp(scaleRgb(LEMON, 0.72), LEMON), 1, yaw);
  for (const s of [-1, 1]) b.blob(x + Math.cos(yaw) * s * r * 1.2, y, z - Math.sin(yaw) * s * r * 1.2, r * 0.22, r * 0.2, r * 0.22, scaleRgb(LEMON, 0.8), 0);
  plaque(b, [x, y, z], r * 0.86, [0.3, 0.7, 0.65], r * 0.28, r * 0.4, r * 0.07, [1, 0.97, 0.6], -0.4);
}

/** A hand of bananas: `n` curved fingers fanned from one crown. */
function bananas(b: MeshBuilder, at: V3, yaw: number, n: number, len: number): void {
  const yellow = rgb("#ffd21f");
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (let k = 0; k < n; k++) {
    const spread = (k - (n - 1) / 2) * 0.1;
    const lift = k * 0.06;
    const path: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const lx = t * len;
      const ly = Math.sin(t * Math.PI * 0.95) * len * 0.22 + lift * t * len;
      const lz = (k - (n - 1) / 2) * 0.75 + spread * lx;
      path.push([at[0] + lx * c + lz * s, at[1] + ly, at[2] - lx * s + lz * c]);
    }
    tube(b, path, {
      radius: (t) => 0.62 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.9)) + 0.1,
      sides: 5,
      shade: (p, i) => (i === 0 ? STALK : i === 8 ? rgb("#4a3a22") : mixRgb(scaleRgb(yellow, 0.82), yellow, Math.min(1, (p[1] - at[1] + 1) / 4))),
    });
  }
  b.rod(at, [at[0] - c * 1.0, at[1] + 1.2, at[2] + s * 1.0], 0.45, STALK);
}

function grapes(b: MeshBuilder, at: V3, rnd: () => number): void {
  const col = rgb("#6c2f93");
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const rad = (rows - r) * 0.5 + 0.15;
    const n = Math.max(1, Math.round(rad * 3.2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + r * 0.7;
      const px = at[0] + Math.cos(a) * rad;
      const py = at[1] - r * 0.85;
      const pz = at[2] + Math.sin(a) * rad;
      b.blob(px, py, pz, 0.62, 0.62, 0.62, ramp(scaleRgb(col, 0.6), mixRgb(col, [1, 0.8, 1], 0.1 + rnd() * 0.1)), 0);
      b.blob(px - 0.12, py + 0.22, pz + 0.26, 0.14, 0.2, 0.1, mixRgb(col, [1, 1, 1], 0.55), 0);
    }
  }
  b.rod([at[0], at[1] + 0.4, at[2]], [at[0] + 0.5, at[1] + 1.8, at[2]], 0.28, STALK);
  fruitLeaf(b, at[0] + 0.5, at[1] + 1.5, at[2], 2.2, 1.0);
}

export const fruitBowl: LandmarkSpec = {
  footprint: 13,
  build(ctx) {
    const lit = new MeshBuilder();
    // The bowl: a turned walnut bowl, outside then inside in one profile, with a pale rim.
    const prof: [number, number][] = [[0, -1.5], [5.0, -1.5], [5.3, 0.4], [4.8, 0.9], [6.7, 1.6], [8.7, 3.3], [10.3, 5.4], [11.0, 7.0], [11.3, 7.5], [10.7, 7.9], [10.1, 7.4], [9.4, 5.6], [7.4, 3.7], [4.5, 2.7], [0, 2.5]];
    lathe(lit, prof, {
      segments: 18,
      shade: (p, i, j) => {
        const inside = i >= 10;
        const t = Math.max(0, Math.min(1, p[1] / 7.5));
        const wood = mixRgb(scaleRgb(WALNUT, inside ? 0.55 : 0.6), inside ? WALNUT : WOOD_L, t);
        const rim = i >= 8 && i <= 10;
        return scaleRgb(rim ? mixRgb(WOOD_L, [1, 0.9, 0.7], 0.25) : wood, 1 + (j % 2 === 0 ? 0.05 : -0.05));
      },
    });
    // A lighter inlay ring on the foot.
    lathe(lit, [[5.2, 0.2], [5.4, 0.2], [5.4, 0.6], [5.2, 0.6]], { segments: 18, shade: WOOD_L });

    const rnd = ctx.rnd;
    // The bottom ring: nine fruit packed round the wall, then a second ring, a crown, and a hand of bananas on top.
    const ring1: [number, string][] = [[20, "apple"], [58, "orange"], [96, "lemon"], [132, "orange"], [170, "green"], [212, "apple"], [256, "orange"], [300, "pear"], [340, "orange"]];
    ring1.forEach(([deg, kind], n) => {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * 6.2;
      const z = Math.sin(a) * 6.2;
      const y = 5.6;
      if (kind === "orange") orange(lit, x, y, z, 2.85, n + 3);
      else if (kind === "apple") apple(lit, x, y, z, 2.9, APPLE, a);
      else if (kind === "green") apple(lit, x, y, z, 2.8, rgb("#8bc83c"), a);
      else if (kind === "lemon") lemon(lit, x, y - 0.5, z, 2.5, a + Math.PI / 2);
      else pear(lit, x, y - 2.8, z, 1.15, 0.5, a);
    });
    const ring2: [number, string][] = [[10, "apple"], [82, "orange"], [155, "pear"], [228, "orange"], [300, "green"]];
    ring2.forEach(([deg, kind], n) => {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * 3.4;
      const z = Math.sin(a) * 3.4;
      if (kind === "orange") orange(lit, x, 8.7, z, 2.8, n + 20);
      else if (kind === "apple") apple(lit, x, 8.7, z, 2.85, APPLE, a);
      else if (kind === "green") apple(lit, x, 8.7, z, 2.8, rgb("#8bc83c"), a);
      else pear(lit, x, 6.2, z, 1.15, -0.3, a);
    });
    apple(lit, -0.4, 11.7, -0.3, 2.9, rgb("#e63a2a"), 0.4);
    orange(lit, 2.0, 11.0, 2.2, 2.5, 77);
    bananas(lit, [-4.2, 12.0, 4.6], -0.3, 5, 13);
    grapes(lit, [-10.6, 7.6, 6.4], rnd);
    grapes(lit, [4.4, 11.0, -6.2], rnd);
    // A pair of cherries on the counter for the bowl's cheek.
    for (const s of [-1, 1]) {
      lit.blob(15.3 + s * 0.9, 1.2, 4 + s * 0.4, 1.2, 1.2, 1.2, ramp(rgb("#7a0f1c"), rgb("#d3213a")), 1);
      lit.rod([15.3 + s * 0.9, 2.2, 4 + s * 0.4], [15.3, 4.6, 4.2], 0.16, rgb("#5a8a2a"));
    }
    return { lit };
  },
};
