/**
 * The kitchen's china: the giant teapot, painted with cobalt flowers on both
 * flanks, and a mug of coffee with a red heart on it, a spoon standing in it
 * and steam curling off the top.
 */
import type { Paint } from "../../builder";
import { lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, tube, xf, type Shade, type V3 } from "../kit";
import type { LandmarkSpec, MovingPart } from "../types";
import { bezier, BLUE, BLUE_PALE, CHINA, GOLD, lift, plaque, TAU } from "./common";

// ─── Teapot ──────────────────────────────────────────────────────────────────

const TEAPOT: [number, number][] = [
  [0, -2],
  [9.6, -2],
  [9.9, 0],
  [9.4, 1.0],
  [10.6, 1.8],
  [13.2, 4],
  [15, 8],
  [15.3, 12],
  [14.2, 16],
  [11.8, 19.5],
  [8.8, 22],
  [7.5, 23.2],
  [7.2, 23.5],
  [7.9, 23.9],
  [7.4, 24.9],
  [5.6, 27],
  [3.2, 29],
  [1.5, 30.2],
  [0, 30.7],
];

/** The belly's radius at height y, for painting on it. */
function bellyRadius(y: number): number {
  for (let i = 1; i < TEAPOT.length; i++) {
    const [r0, y0] = TEAPOT[i - 1]!;
    const [r1, y1] = TEAPOT[i]!;
    if (y1 > y0 && y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

/** A painted blob on the teapot's skin at azimuth `az` (0 = the spout side, radians), height y, hugging the belly. */
function paintOn(b: MeshBuilder, az: number, y: number, w: number, h: number, paint: Paint, roll = 0, lift = 0.12): void {
  const R = bellyRadius(y) * 0.985 + lift;
  b.add(shapes.ball(0), xf(Math.sin(az) * R, y, Math.cos(az) * R, w, h, 0.32, az, 0, roll), paint);
}

/** A flower of eight petals, a ring of small pale ones and a gold heart; `k` scales it. Offsets are in metres along the skin. */
function paintedFlower(b: MeshBuilder, az: number, y: number, k: number): void {
  const R = bellyRadius(y);
  const at = (dx: number, dy: number): [number, number] => [az + dx / R, y + dy];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    const [aa, yy] = at(Math.cos(a) * 2.1 * k, Math.sin(a) * 2.1 * k);
    paintOn(b, aa, yy, 0.95 * k, 1.6 * k, BLUE, a - Math.PI / 2);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const [aa, yy] = at(Math.cos(a) * 1.0 * k, Math.sin(a) * 1.0 * k);
    paintOn(b, aa, yy, 0.5 * k, 0.8 * k, BLUE_PALE, a - Math.PI / 2, 0.3);
  }
  paintOn(b, az, y, 0.85 * k, 0.85 * k, GOLD, 0, 0.45);
}

function paintedLeaf(b: MeshBuilder, az: number, y: number, a: number, k = 1): void {
  paintOn(b, az, y, 0.55 * k, 1.7 * k, BLUE_PALE, a - Math.PI / 2, 0.2);
}

export const teapot: LandmarkSpec = {
  footprint: 14,
  build() {
    const lit = new MeshBuilder();
    const shade: Shade = (p) => {
      const t = Math.max(0, Math.min(1, p[1] / 24));
      return mixRgb(scaleRgb(CHINA, 0.7), CHINA, Math.sqrt(t));
    };
    // The belly and lid turned from one profile, with a vertex on the front so the painting meets a ridge, not a face.
    lathe(lit, TEAPOT, { segments: 16, shade });
    // Cobalt bands: the foot, the waist, the shoulder, the lid's rim.
    for (const [y, h, grow] of [[1.4, 1.1, 0.25], [8.2, 0.9, 0.2], [19.2, 1.5, 0.2]] as const) {
      const r = bellyRadius(y);
      lathe(lit, [[r + grow, y - h / 2], [r + grow + 0.1, y - h / 2], [r + grow + 0.1, y + h / 2], [r + grow, y + h / 2]], { segments: 16, shade: BLUE });
    }
    lathe(lit, [[8.1, 23.8], [8.25, 23.8], [8.25, 24.15], [8.1, 24.15]], { segments: 16, shade: BLUE });
    // Dotted border round the shoulder.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const r = bellyRadius(17.4) * 0.99;
      lit.blob(Math.cos(a) * r, 17.4, Math.sin(a) * r, 0.42, 0.42, 0.42, BLUE, 0);
    }
    // Lid knob: a neck and a cobalt ball.
    lit.post(0, 30.4, 0, 0.95, 1.4, CHINA, 8);
    lit.blob(0, 32.4, 0, 1.9, 1.9, 1.9, ramp(scaleRgb(BLUE, 0.75), BLUE), 1);
    lit.blob(0.5, 33.1, 0.6, 0.45, 0.3, 0.3, BLUE_PALE, 0);

    // The spout: one S-curve out of the belly, flaring to a lip. It starts buried inside the pot.
    const spout = bezier([0, 4.5, 8], [0, 3.5, 24], [0, 16, 17], [0, 25, 26.5], 16);
    const spoutRadius = (t: number) => 4.0 - 2.2 * Math.pow(t, 0.8) + (t > 0.9 ? ((t - 0.9) / 0.1) * 0.6 : 0);
    tube(lit, spout, {
      radius: spoutRadius,
      sides: 10,
      shade,
    });
    for (const k of [9, 13]) tube(lit, spout.slice(k, k + 2), { radius: spoutRadius(k / 16) + 0.14, sides: 10, shade: BLUE });
    lit.blob(0, 7.0, 10.6, 4.9, 4.3, 3.6, ramp(scaleRgb(CHINA, 0.7), scaleRgb(CHINA, 0.9)), 1);
    // The dark mouth of the spout, facing along its last stretch.
    const e = spout[16]!;
    const f = spout[15]!;
    plaque(lit, e, 0.35, [0, e[1] - f[1], e[2] - f[2]], 2.0, 2.0, 0.3, rgb("#22304d"));

    // The handle: an ear of china behind, thick where it grows out of the belly.
    const handle = bezier([0, 20.5, -11.5], [0, 31, -26], [0, 1, -27], [0, 6.8, -12.8], 18);
    tube(lit, handle, {
      radius: (t) => 1.7 + 0.8 * Math.pow(Math.abs(t - 0.5) * 2, 3),
      sides: 8,
      shade,
    });
    for (const k of [5, 13]) tube(lit, handle.slice(k, k + 2), { radius: 1.7 + 0.8 * Math.pow(Math.abs(k / 18 - 0.5) * 2, 3) + 0.14, sides: 8, shade: BLUE });
    lit.blob(0, 23.5, -19.6, 1.3, 0.9, 1.7, BLUE, 0, 0);

    // The painting goes on the flanks, either side of the spout and the handle: a big cobalt flower with gold at its heart on each
    // side, smaller ones round it, leaves between. (A kart sees the front quarter and the side nearest, so both sides are done.)
    for (const side of [-1, 1]) {
      paintedFlower(lit, side * 1.5, 11.4, 1.6);
      paintedFlower(lit, side * 0.9, 6.4, 0.6);
      paintedFlower(lit, side * 0.85, 16.2, 0.55);
      paintedFlower(lit, side * 2.2, 7.6, 0.65);
      paintedFlower(lit, side * 2.2, 15.8, 0.5);
      for (const [daz, y, a] of [[-0.38, 11.4, 3.3], [0.4, 11.4, 6.0], [0.0, 8.2, 4.9], [0.0, 14.2, 1.6], [-0.45, 7.8, 2.6], [0.5, 7.0, 0.4], [0.8, 12.6, 0.7], [-0.7, 13, 2.4]] as const) paintedLeaf(lit, side * (1.5 + daz), y, a, 1.15);
    }
    // A pattern of cobalt dashes round the waist, and on the lid.
    for (let i = 0; i < 20; i++) {
      const az = (i / 20) * TAU;
      paintOn(lit, az, 5.0 + Math.sin(i * 1.3) * 0.25, 0.4, 0.4, BLUE, 0, 0.2);
      paintOn(lit, az, 25.8, 0.38, 0.55, BLUE, 0.4, 0.22);
    }
    return { lit };
  },
};

// ─── Mug ─────────────────────────────────────────────────────────────────────

export const mug: LandmarkSpec = {
  footprint: 14,
  build() {
    const lit = new MeshBuilder();
    const enamel = CHINA;
    const navy = lift("#1f4fae", 1.4);
    const red = lift("#e5392f", 1.3);
    const R = 9.2;
    const body: Shade = (p, _i, j) => scaleRgb(mixRgb(scaleRgb(enamel, 0.72), enamel, Math.min(1, p[1] / 18)), 1 + (j % 2 ? 0.02 : -0.02));
    // The enamel body, a rolled rim, the inside wall and the coffee's brim in one profile.
    lathe(lit, [[0, -0.5], [8.2, -0.5], [8.9, 0.5], [R, 3], [R, 19], [9.5, 20.2], [9.6, 21.3], [9.1, 21.8], [8.6, 21.3], [8.4, 20.2], [8.3, 18.4], [0, 18.4]], { segments: 16, shade: body });
    // A dark navy chipped rim and two navy stripes round the foot.
    lathe(lit, [[9.2, 20.5], [9.68, 20.5], [9.68, 21.5], [9.3, 22.0], [8.9, 22.0], [8.5, 21.6]], { segments: 16, shade: navy });
    for (const y of [3.2, 4.6]) lathe(lit, [[R + 0.08, y - 0.4], [R + 0.2, y - 0.4], [R + 0.2, y + 0.4], [R + 0.08, y + 0.4]], { segments: 16, shade: navy });
    // Coffee: a dark disc with a pale swirl, no glow.
    const coffee = lift("#5a3118", 1.3);
    lit.add(shapes.cylinder(16), xf(0, 18.6, 0, 8.25, 0.4, 8.25), ramp(scaleRgb(coffee, 0.85), coffee));
    lit.blob(-2.2, 18.85, 1.4, 3.2, 0.12, 2.0, lift("#c9925c", 1.3), 0, 0.5);
    lit.blob(2.6, 18.85, -2.4, 1.8, 0.12, 1.0, lift("#c9925c", 1.3), 0, -0.4);
    // A big red heart on the front: a turned square and two round lobes, sunk into the curve of the cup.
    const zs = (x: number) => Math.sqrt(R * R - x * x) * 0.985 + 0.14;
    const hy = 11.4;
    lit.box(0, hy, zs(0) + 0.1, 4.6, 4.6, 0.5, ramp(scaleRgb(red, 0.85), red), 0, 0, Math.PI / 4);
    for (const s of [-1, 1]) lit.blob(s * 1.62, hy + 1.62, zs(s * 1.62) + 0.1, 2.3, 2.3, 0.4, ramp(scaleRgb(red, 0.9), red), 1, s * 0.18);
    lit.blob(-1.8, hy + 2.7, zs(-1.8) + 0.45, 0.6, 0.35, 0.12, [1, 0.75, 0.7], 0);
    // The handle: a thick D of enamel on the right.
    const handle = bezier([8.6, 17.4, 0], [18.5, 19, 0], [18.5, 3.2, 0], [8.6, 5.2, 0], 14);
    tube(lit, handle, { radius: (t) => 1.8 + 0.5 * Math.pow(Math.abs(t - 0.5) * 2, 3), sides: 8, shade: body });
    // A teaspoon left standing in the coffee, its handle over the rim.
    const spoonS = rgb("#c4d2e6");
    lit.rod([-2.6, 17.2, -1.8], [-10.4, 26.2, -5.8], 0.7, ramp(scaleRgb(spoonS, 0.8), [1.3, 1.5, 1.9]));
    lit.blob(-10.8, 26.7, -6.0, 1.3, 0.35, 0.9, [1.3, 1.5, 1.9], 0, 0.5);
    lit.blob(-2.4, 17.6, -1.6, 1.5, 0.7, 1.1, scaleRgb(spoonS, 0.9), 0, 0.6);
    // Steam: three curling wisps of glass that rise, swell and thin out as they go.
    const moving: MovingPart[] = [];
    const wisps: [number, number, number][] = [[-3.2, 0, 0.0], [2.8, 2.4, 0.37], [0.4, -3.0, 0.7]];
    wisps.forEach(([x, z, phase], n) => {
      const g = new MeshBuilder();
      const path: V3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        path.push([x + Math.sin(t * 5.2 + n) * 1.5, 22.6 + t * 9, z + Math.cos(t * 4.4 + n) * 1.1]);
      }
      tube(g, path, { radius: (t) => 1.1 - 0.5 * t, sides: 5, shade: [1.25, 1.25, 1.3] });
      moving.push({
        glass: g,
        pivot: [x, 22.6, z],
        update(t, part) {
          const u = (t * 0.13 + phase) % 1;
          part.position.y = u * 9;
          part.scale.setScalar(Math.max(0.01, Math.sin(Math.PI * u)));
          part.rotation.y = t * 0.5 + n * 2;
        },
      });
    });
    return { lit, moving };
  },
};
