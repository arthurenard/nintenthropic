/**
 * The kitchen's landmarks and hazards: toy karts on a giant counter, so a
 * teapot is thirty metres tall (docs/GRIP_PRIX.md, "What each theme can build").
 *
 * Everything here is china, steel, wood and fruit seen in late golden light:
 * cream and cobalt for the crockery, brushed steel with a bright top for the
 * cutlery and the appliances, warm saturated fruit. Each model is darker at
 * its foot and brighter at its top so it sits on the counter.
 */
import { Group, Mesh, type Object3D } from "three";
import type { Paint } from "../builder";
import { byHeight, extrudeZ, grid, lathe, MeshBuilder, mixRgb, prism, ramp, rgb, rockBlob, scaleRgb, shapes, torus, tube, xf, type Rgb, type Shade, type V3 } from "./kit";
import type { HazardSpec, LandmarkSpec, MovingPart } from "./types";

const TAU = Math.PI * 2;

// Palette. China is cream with cobalt; steel runs from a dim foot to a near-white top.
/** The kitchen's golden light warms and dims whatever faces the road, so the palette is lifted and a little cooler than it looks. */
const lift = (hex: string, k = 1.3): Rgb => scaleRgb(rgb(hex), k);
const CHINA: Rgb = [1.05, 1.22, 1.6];
const BLUE = lift("#2b73e0", 1.55);
const BLUE_PALE = lift("#5b9cf0", 1.45);
const GOLD = lift("#ffcf4a", 1.2);
const STEEL_D: Rgb = [0.3, 0.4, 0.62];
const STEEL: Rgb = [0.72, 1.0, 1.7];
const STEEL_L: Rgb = [1.15, 1.55, 2.5];
const WALNUT = lift("#5e3a22", 1.15);
const WOOD_L = lift("#a8794c", 1.2);
const WHITE: Rgb = [1.05, 1.22, 1.6];

/** Brushed steel for a lathe or a tube: dim at y0, bright at y1, with each facet a touch different. */
function chrome(y0: number, y1: number, glint = 0.07): Shade {
  return (p, _i, j) => {
    const t = Math.max(0, Math.min(1, (p[1] - y0) / (y1 - y0 || 1)));
    const k = 1 + (j % 3 === 0 ? glint : j % 3 === 1 ? -glint : 0);
    return scaleRgb(mixRgb(STEEL_D, STEEL_L, t), k);
  };
}

/** A cubic Bezier through four control points, `n` pieces. */
function bezier(a: V3, b: V3, c: V3, d: V3, n: number): V3[] {
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push([a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3, a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3]);
  }
  return out;
}

/** A thin ellipsoid lying on a ball's skin: ball centre, ball radius, outward direction, width, height, thickness. */
function plaque(b: MeshBuilder, c: V3, r: number, d: V3, w: number, h: number, t: number, paint: Paint, roll = 0): void {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const n: V3 = [d[0] / l, d[1] / l, d[2] / l];
  b.add(shapes.ball(0), xf(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, w, h, t, Math.atan2(n[0], n[2]), -Math.asin(n[1]), roll), paint);
}

/**
 * A flat-sided bar from p to q in the x-y plane, `w` wide across z and `t` thick in the plane:
 * a fork's tine, a spoon's handle. Widths may differ at the two ends.
 */
function beam(b: MeshBuilder, p: V3, q: V3, w0: number, w1: number, t: number, shade: (y: number, v: number) => Rgb): void {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const corner = (e: V3, w: number, s: number, v: number): V3 => [e[0] + nx * s * (t / 2), e[1] + ny * s * (t / 2), e[2] + v * (w / 2)];
  const c = (e: V3, w: number, s: number, v: number): Rgb => shade(corner(e, w, s, v)[1], v);
  const face = (a: [V3, number, number, number], bb: [V3, number, number, number], cc: [V3, number, number, number], d: [V3, number, number, number]) => {
    const pts = [a, bb, cc, d].map(([e, w, s, v]) => corner(e, w, s, v));
    const cols = [a, bb, cc, d].map(([e, w, s, v]) => c(e, w, s, v));
    b.quad(pts[0]!, pts[1]!, pts[2]!, pts[3]!, cols[0]!, cols[1]!, cols[2]!, cols[3]!);
  };
  for (const s of [-1, 1]) face([p, w0, s, -1], [q, w1, s, -1], [q, w1, s, 1], [p, w0, s, 1]);
  for (const v of [-1, 1]) face([p, w0, -1, v], [q, w1, -1, v], [q, w1, 1, v], [p, w0, 1, v]);
  face([p, w0, -1, -1], [p, w0, 1, -1], [p, w0, 1, 1], [p, w0, -1, 1]);
  face([q, w1, -1, -1], [q, w1, 1, -1], [q, w1, 1, 1], [q, w1, -1, 1]);
}

/** A convex polygon in the x-y plane, thickened along z from z0 to z1 and capped at both ends. */
function slab(b: MeshBuilder, poly: readonly (readonly [number, number])[], z0: number, z1: number, shade: Shade): void {
  extrudeZ(b, poly, z0, z1, 1, shade, { closed: true });
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  for (const z of [z0, z1]) {
    const c: V3 = [cx, cy, z];
    const sc = typeof shade === "function" ? shade(c, 0, 0) : shade;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]!;
      const q = poly[(k + 1) % poly.length]!;
      const pa: V3 = [p[0], p[1], z];
      const qa: V3 = [q[0], q[1], z];
      const col = (v: V3): Rgb => (typeof shade === "function" ? shade(v, 0, k) : shade);
      b.tri(c, pa, qa, sc, col(pa), col(qa));
    }
  }
}

/** A rounded rectangle (or a rectangle with only some corners rounded) as a polygon, corners counter-clockwise. */
function roundRect(w: number, h: number, rTop: number, rBottom: number, y0 = 0, steps = 4): [number, number][] {
  const out: [number, number][] = [];
  const corner = (cx: number, cy: number, r: number, a0: number) => {
    if (r <= 0.001) out.push([cx, cy]);
    else for (let k = 0; k <= steps; k++) out.push([cx + Math.cos(a0 + (k / steps) * (Math.PI / 2)) * r, cy + Math.sin(a0 + (k / steps) * (Math.PI / 2)) * r]);
  };
  corner(w / 2 - rBottom, y0 + rBottom, rBottom, -Math.PI / 2);
  corner(w / 2 - rTop, y0 + h - rTop, rTop, 0);
  corner(-w / 2 + rTop, y0 + h - rTop, rTop, Math.PI / 2);
  corner(-w / 2 + rBottom, y0 + rBottom, rBottom, Math.PI);
  return out;
}

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

const teapot: LandmarkSpec = {
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
      paintedFlower(lit, side * 1.5, 11.4, 1.15);
      paintedFlower(lit, side * 0.95, 7.2, 0.5);
      paintedFlower(lit, side * 0.9, 15.4, 0.46);
      paintedFlower(lit, side * 2.15, 8.0, 0.55);
      paintedFlower(lit, side * 2.1, 15.0, 0.42);
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

// ─── Fruit ───────────────────────────────────────────────────────────────────

const ORANGE = lift("#ff8a1c", 1.35);
const APPLE = lift("#d62b2b", 1.3);
const PEAR = lift("#a9c93a", 1.25);
const LEMON = lift("#ffe03a", 1.2);
const LEAF = lift("#3f9a3a", 1.3);
const STALK = lift("#6b4524", 1.3);

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
  const tip: V3 = [x + Math.sin(yaw) * Math.sin(a) * 5.8 * s * 0 + Math.sin(yaw) * -Math.sin(a) * 5.8 * s, y + Math.cos(a) * 5.8 * s, z + Math.cos(yaw) * -Math.sin(a) * 5.8 * s];
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

const fruitBowl: LandmarkSpec = {
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
    // The bottom ring: nine fruit packed round the wall, then a second ring and a crown.
    const ring1: [number, string][] = [[20, "apple"], [58, "orange"], [96, "lemon"], [132, "orange"], [170, "green"], [212, "apple"], [256, "orange"], [300, "pear"], [340, "orange"]];
    ring1.forEach(([deg, kind], n) => {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * 5.9;
      const z = Math.sin(a) * 5.9;
      const y = 4.9;
      if (kind === "orange") orange(lit, x, y, z, 2.35, n + 3);
      else if (kind === "apple") apple(lit, x, y, z, 2.4, APPLE, a);
      else if (kind === "green") apple(lit, x, y, z, 2.3, rgb("#8bc83c"), a);
      else if (kind === "lemon") lemon(lit, x, y - 0.4, z, 2.1, a + Math.PI / 2);
      else pear(lit, x, y - 2.3, z, 0.95, 0.5, a);
    });
    const ring2: [number, string][] = [[10, "apple"], [82, "orange"], [155, "pear"], [228, "orange"], [300, "green"]];
    ring2.forEach(([deg, kind], n) => {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * 3.0;
      const z = Math.sin(a) * 3.0;
      if (kind === "orange") orange(lit, x, 7.5, z, 2.3, n + 20);
      else if (kind === "apple") apple(lit, x, 7.5, z, 2.35, APPLE, a);
      else if (kind === "green") apple(lit, x, 7.5, z, 2.3, rgb("#8bc83c"), a);
      else pear(lit, x, 5.4, z, 0.95, -0.3, a);
    });
    apple(lit, -0.4, 10.0, -0.3, 2.4, rgb("#e63a2a"), 0.4);
    orange(lit, 1.6, 9.6, 1.8, 2.1, 77);
    // A hand of bananas draped over the front rim, grapes spilling the other side.
    bananas(lit, [-3.5, 9.4, 3.5], -0.3, 5, 11);
    grapes(lit, [-9.2, 6.6, 5.4], rnd);
    grapes(lit, [3.8, 9.2, -5.4], rnd);
    // A pair of cherries on the counter for the bowl's cheek.
    for (const s of [-1, 1]) {
      lit.blob(15.3 + s * 0.9, 1.2, 4 + s * 0.4, 1.2, 1.2, 1.2, ramp(rgb("#7a0f1c"), rgb("#d3213a")), 1);
      lit.rod([15.3 + s * 0.9, 2.2, 4 + s * 0.4], [15.3, 4.6, 4.2], 0.16, rgb("#5a8a2a"));
    }
    return { lit };
  },
};

// ─── Toaster ─────────────────────────────────────────────────────────────────

/** One slice of toast standing in a slot: crust, then two golden faces, both sides. */
function toast(b: MeshBuilder, x: number, z: number, y: number, w: number, h: number, t: number): void {
  const crust = rgb("#a85c25");
  const gold = lift("#e0a24b", 1.2);
  const crumb = lift("#f4cb7c", 1.2);
  const r = w * 0.27;
  const lobe = (inset: number, depth: number, col: Rgb, lift: number) => {
    const rr = r - inset;
    for (const s of [-1, 1]) b.add(shapes.cylinder(10), xf(x + s * w * 0.225, y + h - r, z, rr, depth, rr, 0, Math.PI / 2), ramp(scaleRgb(col, 0.9), col));
    b.box(x, y + (h - r) / 2 + 0.4 + lift, z, w - inset * 2 - 0.1, h - r - 0.9, depth, ramp(scaleRgb(col, 0.8), col));
  };
  lobe(0, t, crust, 0);
  lobe(0.8, t + 0.08, gold, 0);
  lobe(1.8, t + 0.14, crumb, 0);
  // Two pale air pockets in the crumb.
  for (const [dx, dy] of [[-1.6, 0.4], [2.0, 1.6], [0.4, 3.3]] as const) b.blob(x + dx, y + h * 0.5 + dy, z, 0.35, 0.3, t / 2 + 0.2, scaleRgb(gold, 0.95), 0);
}

const toaster: LandmarkSpec = {
  footprint: 16,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const bakelite = rgb("#26211f");
    const bakeliteL = rgb("#4b413a");
    const W = 26;
    const D = 16;
    // Four little feet, then a dark plinth.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lit.post(sx * 10.6, -1, sz * 5.8, 1.5, 2.6, ramp(bakelite, bakeliteL), 8, 0.8);
    lit.box(0, 2.1, 0, W - 1.2, 1.2, D - 1.2, ramp(bakelite, bakeliteL));
    // The chrome shell: rounded top, with a bright reflection of the window sliding across its face.
    const shell = roundRect(W, 11, 3.6, 1.2, 2.7);
    // Chrome mirrors its room: pale sky above, a dark band at the horizon, warm counter below, and the window sliding across.
    const shellShade: Shade = (p, _i, j) => {
      const t = Math.max(0, Math.min(1, (p[1] - 2.7) / 11));
      const sky: Rgb = [1.2, 1.5, 2.0];
      const horizon: Rgb = [0.38, 0.48, 0.68];
      const ground: Rgb = [1.0, 0.98, 1.0];
      const c = t > 0.55 ? mixRgb(horizon, sky, (t - 0.55) / 0.45) : mixRgb(ground, horizon, t / 0.55);
      const band = 0.9 + 0.12 * Math.sin(p[0] * 0.42 + 1.0) + (Math.abs(p[0] + 7.5) < 1.6 ? 0.3 : 0);
      return scaleRgb(c, band * (1 + (j % 2 ? 0.02 : -0.02)));
    };
    slab(lit, shell, -D / 2 + 0.6, D / 2 - 0.6, shellShade);
    // Rounded ends: the chrome swells a little at the front and back by a second, slimmer shell.
    slab(lit, roundRect(W - 3, 9.6, 3.2, 1, 3.3), -D / 2, D / 2, shellShade);
    // A retro red stripe and a thin chrome cornice.
    lit.box(0, 5.2, D / 2 - 0.5, W - 1.2, 0.7, 0.34, rgb("#e0412e"));
    lit.box(0, 4.2, D / 2 - 0.5, W - 1.2, 0.3, 0.34, rgb("#fff4dc"));
    // The top plate and its two slots.
    lit.box(0, 13.6, 0, W - 4.2, 0.7, D - 3, ramp(bakelite, bakeliteL));
    for (const zc of [3.7, -3.7]) {
      lit.box(0, 13.95, zc, 16, 0.12, 2.8, rgb("#0f0c0b"));
      // The elements glow warm in the gaps either side of the bread.
      for (const s of [-1, 1]) glow.box(0, 14.04, zc + s * 1.1, 15.6, 0.06, 0.45, [3.0, 1.35, 0.4]);
    }
    // Toast: the front slice stands a little lower than the back one.
    toast(lit, -0.2, 3.7, 13.4, 14.2, 11.5, 1.6);
    toast(lit, 0.4, -3.7, 13.4, 14.2, 13.6, 1.6);
    // The lever on the front, in its track.
    lit.box(-9.6, 8.0, D / 2 - 0.4, 1.0, 6.5, 0.16, rgb("#15110f"));
    lit.box(-9.6, 9.6, D / 2 + 0.5, 3.0, 1.5, 1.7, ramp(bakelite, bakeliteL));
    lit.box(-9.6, 9.6, D / 2 + 1.0, 2.4, 0.5, 1.0, rgb("#5d4f46"));
    // The browning dial with its tick marks.
    lit.add(shapes.cylinder(14), xf(8.6, 8.4, D / 2 + 0.4, 2.7, 1.5, 2.7, 0, Math.PI / 2), ramp(bakelite, bakeliteL));
    lit.add(shapes.cylinder(14), xf(8.6, 8.4, D / 2 + 1.25, 2.0, 0.3, 2.0, 0, Math.PI / 2), rgb("#6a5b50"));
    lit.box(8.6 + 0.6, 8.4 + 1.1, D / 2 + 1.5, 0.45, 1.6, 0.25, rgb("#fff4dc"), 0, 0, -0.45);
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.8 + (i / 8) * Math.PI * 1.6 + Math.PI / 2;
      lit.blob(8.6 + Math.cos(a) * 3.9, 8.4 + Math.sin(a) * 3.9, D / 2 - 0.2, 0.28, 0.28, 0.18, i < 5 ? rgb("#2a2420") : rgb("#e0412e"), 0);
    }
    // The cord, a thick black loop on the counter behind.
    const cord: V3[] = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      cord.push([13 + t * 12, 0.5 + Math.sin(t * 6) * 0.15, -3 - Math.sin(t * Math.PI) * 6 - t * 8]);
    }
    tube(lit, [[12, 3.5, -3], ...cord], { radius: 0.65, sides: 5, shade: rgb("#2a2626") });
    lit.box(25.4, 0.7, -17.5, 2.2, 1.4, 3.0, rgb("#2a2626"));
    const halos = [
      { x: 0, y: 15, z: 3.7, size: 15, colour: [2.6, 1.3, 0.5] as const, alpha: 0.25, twinkle: 0.12 },
      { x: 0, y: 15, z: -3.7, size: 15, colour: [2.6, 1.3, 0.5] as const, alpha: 0.25, twinkle: 0.12 },
    ];
    return { lit, glow, halos };
  },
};
// ─── Grater ──────────────────────────────────────────────────────────────────

/** The grater's section: a rounded rectangle open at the ground, from the left foot over the top to the right foot. */
function graterSection(hw: number, top: number, rc: number): [number, number][] {
  const pts: [number, number][] = [[-hw, 0], [-hw, top - rc]];
  for (let k = 1; k <= 6; k++) {
    const a = Math.PI - (k / 6) * (Math.PI / 2);
    pts.push([-hw + rc + Math.cos(a) * rc, top - rc + Math.sin(a) * rc]);
  }
  for (let k = 1; k <= 3; k++) pts.push([-(hw - rc) + (k / 3) * 2 * (hw - rc), top]);
  for (let k = 1; k <= 6; k++) {
    const a = (Math.PI / 2) * (1 - k / 6);
    pts.push([hw - rc + Math.cos(a) * rc, top - rc + Math.sin(a) * rc]);
  }
  pts.push([hw, 0]);
  return pts;
}

const grater: LandmarkSpec = {
  span: true,
  defaultSpan: 44,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const L = ctx.span;
    const z0 = -L / 2;
    const z1 = L / 2;
    const hwIn = ctx.halfWidth + 4.9;
    const hwOut = hwIn + 0.7;
    const topIn = 15.2;
    const outer = graterSection(hwOut, topIn + 0.7, 6.6);
    const inner = graterSection(hwIn, topIn, 6.0);
    const steps = Math.max(2, Math.round(L / 4));
    // The skin, outside bright and mirrored, inside a warmer, darker steel lit by the glow within.
    extrudeZ(lit, outer, z0, z1, steps, (p, i, j) => {
      const t = Math.min(1, p[1] / (topIn + 0.7));
      return scaleRgb(mixRgb(STEEL_D, STEEL_L, Math.pow(t, 0.7)), 1 + (i % 2 ? 0.04 : -0.04) + (j % 5 === 0 ? 0.06 : 0));
    });
    extrudeZ(lit, inner, z0, z1, steps, (p, i) => {
      const t = Math.min(1, p[1] / topIn);
      return scaleRgb(mixRgb(scaleRgb(STEEL_D, 0.85), mixRgb(STEEL, [1.3, 1.1, 0.8], 0.35), t), 1 + (i % 2 ? 0.04 : -0.04));
    });
    // Rolled rims round both open ends, and a low plinth along each foot.
    for (const z of [z0, z1]) {
      const path = outer.map(([x, y]): V3 => [x * 0.985, y, z]);
      tube(lit, path, { radius: 0.62, sides: 6, shade: (p) => mixRgb(STEEL, STEEL_L, Math.min(1, p[1] / 14)) });
    }
    for (const s of [-1, 1]) lit.box(s * (hwIn + 0.35), 0.4, 0, 1.4, 0.8, L, rgb("#5a6573"));
    // Punched holes in rows up both walls, in and out: a dark mouth and a raised lip above it, every other row shifted.
    const lipOut = mixRgb(STEEL, STEEL_L, 0.5);
    const rows = [2.4, 4.9, 7.4, 9.9];
    const pitch = 3.4;
    const cols = Math.floor((L - 4) / pitch);
    for (const s of [-1, 1]) {
      rows.forEach((y, r) => {
        for (let c = 0; c < cols; c++) {
          const z = z0 + 2.4 + (c + (r % 2) * 0.5) * pitch;
          if (z > z1 - 2) continue;
          for (const [x, dir] of [[s * hwOut, s], [s * hwIn, -s]] as const) {
            lit.box(x + dir * 0.03, y, z, 0.16, 1.5, 0.95, rgb("#2b323b"));
            // The lip stands out of the sheet on the side the punch came from.
            lit.add(shapes.cone(4), xf(x + dir * 0.22, y + 0.95, z, 0.65, 0.8, 0.5, 0, 0, dir * 1.57), lipOut);
          }
        }
      });
    }
    // The roof carries the long slots of the coarse side.
    for (const sx of [-2.6, 2.6]) {
      for (let z = z0 + 3.2; z < z1 - 2; z += 4.6) {
        lit.box(sx, topIn + 0.72, z, 2.6, 0.12, 1.5, rgb("#2b323b"));
        lit.box(sx, topIn + 0.5, z + 0.95, 2.8, 0.34, 0.4, lipOut);
      }
    }
    // The bent handle: a stirrup arching over the middle of the roof.
    const handle: V3[] = [[0, topIn + 0.7, -9], [0, topIn + 3.8, -8.2], [0, topIn + 5.7, -4.5], [0, topIn + 6.1, 0], [0, topIn + 5.7, 4.5], [0, topIn + 3.8, 8.2], [0, topIn + 0.7, 9]];
    tube(lit, handle, { radius: 0.85, sides: 6, shade: (p) => mixRgb(STEEL, STEEL_L, Math.min(1, (p[1] - topIn) / 6)) });
    for (const z of [-9, 9]) lit.blob(0, topIn + 0.8, z, 1.5, 0.7, 1.5, STEEL_D, 0);
    // A soft light inside, as if the whole thing were lit from within: glowing runners along the roof, and halos.
    for (const sx of [-4.4, 4.4]) glow.box(sx, topIn - 0.12, 0, 0.6, 0.14, L, [2.4, 2.0, 1.2]);
    const halos = [];
    for (let z = z0 + 5; z <= z1 - 4; z += 11) halos.push({ x: 0, y: 13.2, z, size: 15, colour: [1.9, 1.5, 0.9] as const, alpha: 0.22 });
    return { lit, glow, halos };
  },
};

// ─── Salt shaker ─────────────────────────────────────────────────────────────

const saltShaker: LandmarkSpec = {
  footprint: 12,
  build(ctx) {
    const lit = new MeshBuilder();
    const glass = new MeshBuilder();
    const salt: Rgb = [1.5, 1.7, 2.0];
    // The glass, faceted like pressed glass: alternate pale and paler panels.
    lathe(glass, [[0, 0.2], [6.1, 0.2], [6.9, 1.0], [7.6, 5], [7.7, 10], [7.2, 16], [6.5, 20], [6.1, 21.6], [0, 21.6]], {
      segments: 10,
      shade: (_p, _i, j) => (j % 2 === 0 ? [0.6, 0.85, 1.25] : [1.0, 1.15, 1.35]),
    });
    // The salt inside: a lit white core, its top a little uneven.
    lathe(lit, [[0, 0.5], [5.5, 0.5], [6.3, 1.3], [7.0, 5], [7.1, 10], [6.8, 14.2], [5.0, 15.2], [3.0, 14.7], [0, 15.6]], {
      segments: 10,
      shade: byHeight(0.5, 15.5, scaleRgb(salt, 0.8), salt),
    });
    // Crystals glittering in the top layer.
    for (let i = 0; i < 14; i++) {
      const a = ctx.rnd() * TAU;
      const r = ctx.rnd() * 5;
      lit.box(Math.cos(a) * r, 15.2 + ctx.rnd() * 0.5, Math.sin(a) * r, 0.7, 0.7, 0.7, [1.8, 2.0, 2.3], ctx.rnd() * 3, ctx.rnd(), 0);
    }
    // The chrome cap: a collar, a shoulder, a nearly flat top pierced with holes.
    const cap: [number, number][] = [[6.3, 20.9], [6.9, 21.2], [6.9, 22.6], [6.5, 23.6], [5.6, 24.6], [4.6, 25.2], [0, 25.45]];
    lathe(lit, cap, { segments: 10, shade: chrome(20.9, 25.5, 0.1), caps: "bottom" });
    lathe(lit, [[6.95, 21.6], [7.05, 21.6], [7.05, 22.0], [6.95, 22.0]], { segments: 10, shade: STEEL_D });
    const hole = rgb("#1d232b");
    lit.add(shapes.cylinder(6), xf(0, 25.5, 0, 0.55, 0.12, 0.55), hole);
    for (let i = 0; i < 6; i++) lit.add(shapes.cylinder(6), xf(Math.cos((i / 6) * TAU) * 2.0, 25.45, Math.sin((i / 6) * TAU) * 2.0, 0.55, 0.12, 0.55), hole);
    for (let i = 0; i < 11; i++) lit.add(shapes.cylinder(6), xf(Math.cos((i / 11) * TAU + 0.2) * 3.7, 25.35, Math.sin((i / 11) * TAU + 0.2) * 3.7, 0.55, 0.12, 0.55), hole);
    // A bright spill at the foot, spread toward the road.
    lit.blob(3.5, 0.2, 9.6, 4.6, 0.9, 3.2, ramp(scaleRgb(salt, 0.8), salt), 0);
    for (let i = 0; i < 30; i++) {
      const a = Math.PI * (0.05 + ctx.rnd() * 0.9);
      const r = 8.5 + ctx.rnd() * 7;
      const s = 0.45 + ctx.rnd() * 0.4;
      lit.box(Math.cos(a) * r, s * 0.45, Math.sin(a) * r, s, s, s, [1.6, 1.8, 2.1], ctx.rnd() * 3, ctx.rnd() * 0.5, ctx.rnd() * 0.5);
    }
    return { lit, glass };
  },
};

// ─── Pepper mill ─────────────────────────────────────────────────────────────

const pepperMill: LandmarkSpec = {
  footprint: 12,
  build(ctx) {
    const lit = new MeshBuilder();
    const peppercorn = lift("#3a2c26", 1.6);
    // The steel grinder at the foot.
    lathe(lit, [[0, -0.5], [5.4, -0.5], [5.7, 0.6], [5.7, 2.2], [6.3, 2.7]], { segments: 12, shade: chrome(0, 2.7, 0.1), caps: "bottom" });
    // The turned walnut body: foot, belly, long waist, shoulder.
    const wood: Shade = (p, _i, j) => {
      const t = Math.max(0, Math.min(1, (p[1] - 2) / 33));
      return scaleRgb(mixRgb(scaleRgb(WALNUT, 0.7), WOOD_L, Math.pow(t, 0.8)), 1 + (j % 3 === 0 ? 0.06 : j % 3 === 1 ? -0.05 : 0));
    };
    lathe(lit, [[6.4, 2.6], [7.2, 4], [7.9, 7], [8.0, 10], [7.4, 14], [6.2, 18], [5.2, 22], [4.7, 25], [4.6, 27], [4.9, 27.4]], { segments: 12, shade: wood });
    // Two dark turned rings on the belly.
    for (const y of [12.2, 13.0]) lathe(lit, [[7.62, y - 0.3], [7.72, y - 0.3], [7.72, y + 0.3], [7.62, y + 0.3]], { segments: 12, shade: scaleRgb(WALNUT, 0.55) });
    // A steel band, then the slimmer top section and a rounded shoulder.
    lathe(lit, [[4.9, 27], [5.1, 27], [5.1, 29], [4.9, 29]], { segments: 12, shade: chrome(27, 29, 0.12) });
    lathe(lit, [[4.6, 29], [4.4, 31], [4.2, 33], [3.8, 34.6], [3.0, 35.6], [1.4, 36.1], [0, 36.2]], { segments: 12, shade: wood });
    // The knob.
    lit.post(0, 36, 0, 1.0, 1.6, scaleRgb(WALNUT, 0.7), 8);
    lit.blob(0, 38.5, 0, 2.6, 2.2, 2.6, ramp(scaleRgb(WALNUT, 0.85), WOOD_L), 1);
    lit.blob(0, 40.0, 0, 1.1, 0.35, 1.1, scaleRgb(WALNUT, 0.6), 0);
    // A second, slim steel ring under the shoulder.
    lathe(lit, [[4.55, 31.2], [4.75, 31.2], [4.75, 31.8], [4.55, 31.8]], { segments: 12, shade: chrome(31, 32, 0.12) });
    // Peppercorns that have escaped, and the dusting of ground pepper round them.
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * (0.02 + ctx.rnd() * 0.96);
      const r = 7 + ctx.rnd() * 9;
      const s = 0.45 + ctx.rnd() * 0.35;
      lit.blob(Math.cos(a) * r, s * 0.8, Math.sin(a) * r, s, s, s, ramp(scaleRgb(peppercorn, 0.8), peppercorn), 0);
    }
    for (let i = 0; i < 70; i++) {
      const a = ctx.rnd() * TAU;
      const r = 6 + ctx.rnd() * 10;
      const s = 0.3 + ctx.rnd() * 0.3;
      lit.blob(Math.cos(a) * r, 0.1, Math.sin(a) * r, s, 0.18, s, scaleRgb(peppercorn, 0.9), 0, a);
    }
    lit.blob(2.0, 0.1, 9.2, 4.2, 0.9, 2.8, ramp(scaleRgb(peppercorn, 0.7), scaleRgb(peppercorn, 1.1)), 0);
    return { lit };
  },
};

// ─── Cookbooks ───────────────────────────────────────────────────────────────

/**
 * A fat cookbook lying flat, spine toward +z: two covers, cream pages recessed on three sides, a spine with raised gold bands
 * and a title plate. Built in the book's own frame and turned by `yaw` about its centre.
 */
function book(b: MeshBuilder, cx: number, y0: number, cz: number, w: number, h: number, d: number, yaw: number, cover: Rgb, ribbon: Rgb): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const put = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, paint: Paint) =>
    b.add(shapes.box(), xf(cx + lx * c + lz * s, y0 + ly, cz - lx * s + lz * c, sx, sy, sz, yaw), paint);
  const dark = scaleRgb(cover, 0.62);
  put(0, 0.35, 0, w, 0.7, d, ramp(dark, cover));
  put(0, h - 0.35, 0, w, 0.7, d, ramp(cover, mixRgb(cover, [1, 1, 1], 0.12)));
  put(0, h / 2, d / 2 - 0.4, w, h, 0.8, ramp(dark, cover));
  const pages: Rgb = lift("#f6efd8", 1.15);
  put(0, h / 2, -0.15, w - 0.9, h - 1.2, d - 1.3, ramp(scaleRgb(pages, 0.75), pages));
  for (let k = 1; k <= 3; k++) put(0, 0.7 + (k * (h - 1.4)) / 4, -0.15, w - 0.9 + 0.06, 0.16, d - 1.3 + 0.06, scaleRgb(pages, 0.8));
  // Spine: gold bands across it, and a title plate with a few dark lines of text.
  for (const x of [-w / 2 + 2.2, -w / 2 + 3.4, w / 2 - 3.4, w / 2 - 2.2]) put(x, h / 2, d / 2 + 0.06, 0.7, h - 0.2, 0.18, GOLD);
  put(0, h / 2, d / 2 + 0.06, w * 0.4, h * 0.62, 0.18, lift("#fbf3da", 1.1));
  for (const k of [-1, 0, 1]) put(k * 0.0, h / 2 + k * h * 0.16, d / 2 + 0.17, w * (k === 0 ? 0.3 : 0.24), 0.22, 0.12, ribbon);
}

const cookbook: LandmarkSpec = {
  footprint: 18,
  build() {
    const lit = new MeshBuilder();
    const red = lift("#d6332f", 1.3);
    const teal = lift("#1f9a9a", 1.4);
    const sun = lift("#f5b82a", 1.25);
    book(lit, 0, -0.1, 0, 30, 6.4, 22, 0, red, WHITE);
    book(lit, -1.6, 6.25, -0.4, 26, 5.2, 19, 0.14, teal, WHITE);
    book(lit, 1.8, 11.4, 0.3, 21, 4.4, 15, -0.18, sun, lift("#8a2a1e", 1.3));
    // On the top cover: a plate with a red tomato, drawn in round blocks.
    const topY = 15.8;
    lit.add(shapes.cylinder(14), xf(1.8, topY + 0.1, 0.3, 5.2, 0.2, 5.2, 0), lift("#fbf3da", 1.1));
    lit.add(shapes.cylinder(14), xf(1.8, topY + 0.25, 0.3, 3.7, 0.18, 3.7, 0), lift("#4aa0e8", 1.2));
    lit.blob(1.8, topY + 1.3, 0.3, 2.2, 1.7, 2.2, ramp(lift("#a81f1f", 1.2), lift("#e83b30", 1.25)), 1);
    lit.blob(1.8, topY + 3.0, 0.3, 0.9, 0.3, 0.9, lift("#3f9a3a", 1.3), 0);
    // A recipe card leaning on the spine of the lowest book, red header and ruled lines, and a ribbon bookmark down the middle one.
    const card = lift("#fffaf0", 1.2);
    lit.box(-9.5, 3.4, 11.9, 8.4, 6.2, 0.3, ramp(scaleRgb(card, 0.8), card), 0, -0.2);
    lit.box(-9.5, 5.9, 12.1, 8.4, 1.3, 0.2, lift("#d6332f", 1.3), 0, -0.2);
    for (let k = 0; k < 4; k++) lit.box(-9.5, 4.4 - k * 0.9, 12.15 + k * 0.03, 6.4 - (k === 3 ? 2.4 : 0), 0.22, 0.12, lift("#4a5668", 1.2), 0, -0.2);
    lit.box(8.2, 8.6, 9.7, 1.0, 5.4, 0.2, lift("#e8482d", 1.3));
    lit.box(8.2, 11.32, 6.6, 1.0, 0.2, 6.4, lift("#e8482d", 1.3));
    lit.box(8.2, 5.7, 9.9, 1.0, 1.6, 0.2, lift("#e8482d", 1.3), 0, 0, 0.0);
    return { lit };
  },
};

// ─── Cereal box ──────────────────────────────────────────────────────────────

const cerealBox: LandmarkSpec = {
  footprint: 16,
  build(ctx) {
    const lit = new MeshBuilder();
    const W = 24;
    const D = 10;
    const H = 45;
    const yellow = lift("#ffb62b", 1.2);
    const skyBlue = lift("#59bdf5", 1.3);
    const red = lift("#e5392f", 1.3);
    const cream = lift("#fff3d6", 1.2);
    const dark = lift("#35282a", 1.2);
    // The carton: yellow, darker toward the foot, with a lighter, slightly proud front panel.
    lit.box(0, H / 2 - 0.5, 0, W, H + 1, D, ramp(scaleRgb(yellow, 0.62), yellow));
    const f = D / 2;
    // The picture: a blue sky panel over green hills.
    lit.box(0, 29.5, f + 0.08, W - 2.4, 28, 0.2, ramp(mixRgb(skyBlue, WHITE, 0.45), skyBlue));
    lit.blob(-3.6, 16.2, f + 0.1, 7.6, 3.0, 0.5, lift("#5cc24a", 1.3), 1);
    lit.blob(5.2, 16.0, f + 0.12, 5.6, 2.2, 0.5, lift("#3fa64a", 1.3), 1);
    // A smiling sun with rays.
    const sx = -4.2;
    const sy = 35.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      lit.add(shapes.cone(4), xf(sx + Math.cos(a) * 6.8, sy + Math.sin(a) * 6.8, f + 0.45, 0.9, 1.7, 0.4, 0, 0, a - Math.PI / 2), lift("#ffd23f", 1.25));
    }
    lit.add(shapes.cylinder(16), xf(sx, sy, f + 0.55, 5.2, 0.8, 5.2, 0, Math.PI / 2), lift("#ffd23f", 1.25));
    for (const dx of [-1.8, 1.8]) {
      lit.blob(sx + dx, sy + 1.0, f + 1.05, 0.7, 1.0, 0.3, dark, 0);
      lit.blob(sx + dx * 1.2, sy - 1.2, f + 0.99, 0.8, 0.6, 0.2, lift("#ff8f70", 1.2), 0);
    }
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * (1.12 + (k / 6) * 0.76);
      lit.blob(sx + Math.cos(a) * 2.7, sy + 0.2 + Math.sin(a) * 2.2, f + 1.05, 0.4, 0.4, 0.28, dark, 0);
    }
    // Clouds.
    for (const [x, y, k] of [[6.4, 40.4, 1], [8.0, 33.5, 0.7]] as const) {
      lit.blob(x, y, f + 0.4, 3 * k, 1.2 * k, 0.4, WHITE, 1);
      lit.blob(x - 1.6 * k, y - 0.4 * k, f + 0.45, 2 * k, 1.0 * k, 0.4, WHITE, 1);
    }
    // The bowl of hoops and milk, centre front: a blue bowl, a white milk disc, golden rings piled up.
    lit.blob(0, 8.0, f + 1.2, 8.2, 5.4, 1.6, ramp(lift("#1f5fc0", 1.4), lift("#4a8fe8", 1.4)), 1);
    lit.add(shapes.cylinder(18), xf(0, 11.4, f + 1.5, 7.6, 1.0, 1.5, 0, 0, 0), WHITE);
    for (let i = 0; i < 9; i++) {
      const hx = -5.4 + i * 1.35 + (i % 2) * 0.2;
      const hy = 12.2 + Math.sin(i * 1.9) * 0.7 + (i % 3) * 0.5;
      torus(lit, 1.0, 0.4, { at: [hx, hy, f + 2.3 + (i % 2) * 0.2], facing: "z", ringSegments: 8, tubeSegments: 5, shade: i % 3 === 0 ? lift("#e8a23a", 1.2) : lift("#f2c25a", 1.2) });
    }
    // The name on a red banner, spelled in cream blocks of different heights.
    lit.box(0, 22.2, f + 0.45, W - 3, 5, 0.9, ramp(scaleRgb(red, 0.8), red), 0, 0, 0.0);
    for (let i = 0; i < 6; i++) {
      const w = 2.2;
      const h = 2.2 + (i % 3 === 1 ? 0.8 : 0);
      lit.box(-8.6 + i * 3.4, 22.2, f + 1.0, w, h, 0.5, cream);
      lit.box(-8.6 + i * 3.4, 22.2 + (i % 2 ? 0.4 : -0.4), f + 1.3, w * 0.4, h * 0.4, 0.2, red);
    }
    // Stripes at the foot, and a shelf-label corner.
    for (let i = 0; i < 4; i++) lit.box(0, 1.9 + i * 1.3, f + 0.1, W - 0.2, 0.65, 0.16, i % 2 ? cream : red);
    // The side panel, with its nutrition table.
    for (const sgn of [-1, 1]) {
      lit.box(sgn * (W / 2 + 0.06), 24, 0, 0.14, 30, D - 1.6, ramp(scaleRgb(yellow, 0.75), mixRgb(yellow, [1, 0.8, 0.4], 0.2)));
      lit.box(sgn * (W / 2 + 0.2), 24, 0, 0.14, 21, 5.8, cream);
      for (let k = 0; k < 8; k++) lit.box(sgn * (W / 2 + 0.3), 31 - k * 2.3, 0, 0.1, 0.4, 4.2 - (k % 3) * 0.8, dark);
    }
    // The top: a dark opening with a golden mound of hoops inside, and a cut flap hinged at the back, standing open.
    lit.box(0, H + 0.01, 0, W - 2, 0.12, D - 2, rgb("#1d1612"));
    lit.blob(0, H, 0, 8.5, 1.2, 3, ramp(lift("#c98a2a", 1.2), lift("#f2c25a", 1.2)), 1);
    lit.box(0, H + 3.0, -f + 1.0, W - 2.2, 6.4, 0.5, ramp(yellow, cream), 0, -0.25);
    lit.box(0, H + 0.6, f - 0.5, W - 2.2, 1.2, 0.5, ramp(scaleRgb(yellow, 0.9), yellow), 0, 0.18);
    // Spilled hoops at the foot: flat ones in the fore, a couple leaning.
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * (0.1 + ctx.rnd() * 0.8);
      const r = 14 + ctx.rnd() * 9;
      const col = i % 3 === 0 ? lift("#e8a23a", 1.2) : i % 3 === 1 ? lift("#f2c25a", 1.2) : lift("#d9822a", 1.2);
      torus(lit, 0.95, 0.38, { at: [Math.cos(a) * r, 0.4, Math.sin(a) * r + 2], facing: "y", ringSegments: 8, tubeSegments: 5, shade: col });
    }
    for (const [x, z] of [[-5, 17], [4, 20]] as const) torus(lit, 0.95, 0.38, { at: [x, 1.2, z], facing: "z", ringSegments: 8, tubeSegments: 5, shade: lift("#f2c25a", 1.2) });
    return { lit };
  },
};

// ─── Mug ─────────────────────────────────────────────────────────────────────

const mug: LandmarkSpec = {
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

// ─── Fork arch and spoon arch ────────────────────────────────────────────────

/** Steel for a flat bar: bright at the top, dim at the foot, a little brighter on its faces than its edges. */
const barShade = (top: number) => (y: number, v: number): Rgb => scaleRgb(mixRgb(STEEL_D, STEEL_L, Math.pow(Math.max(0, Math.min(1, y / top)), 0.8)), 1 + 0.05 * v);

const forkArch: LandmarkSpec = {
  span: true,
  defaultSpan: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const base = ctx.halfWidth + 8.6;
    const shade = barShade(33);
    const pairs = Math.max(1, Math.round(ctx.span / 24));
    for (let n = 0; n < pairs; n++) {
      const zc = (n - (pairs - 1) / 2) * 24;
      for (const s of [-1, 1]) {
        // The centre line of a fork, from the buried foot of its handle to the tips of its tines (x counted from the road's middle).
        const P = (x: number, y: number, z = 0): V3 => [s * x, y, zc + z];
        // Handle, leaning in a little, with a wide rounded foot; then a neck that flares into the head, which bends inward.
        beam(lit, P(-base, -1.4), P(-base + 1.0, 4), 3.9, 3.0, 1.2, shade);
        beam(lit, P(-base + 1.0, 4), P(-base + 1.8, 15.5), 3.0, 2.3, 1.0, shade);
        beam(lit, P(-base + 1.8, 15.5), P(-base + 5.0, 23.5), 2.3, 12.4, 0.9, shade);
        // The four tines.
        for (const dz of [-4.9, -1.65, 1.65, 4.9]) {
          beam(lit, P(-base + 5.0, 23.5, dz), P(-base + 8.6, 28.6, dz), 2.3, 2.0, 0.9, shade);
          beam(lit, P(-base + 8.6, 28.6, dz), P(-0.5, 32.2, dz), 2.0, 1.1, 0.9, shade);
        }
        // A short web joining the tines where they leave the head.
        beam(lit, P(-base + 4.7, 23.2), P(-base + 7.0, 26.4), 12.4, 12.0, 0.9, shade);
        // A bright line down the handle, and a chunk of counter chipped where it went in.
        lit.rod(P(-base - 0.15, 0), P(-base + 1.8, 15.0), 0.3, STEEL_L);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + n;
          lit.blob(s * -base + Math.cos(a) * 3.4, 0.2, zc + Math.sin(a) * 3.0, 0.6, 0.35, 0.6, rgb("#f4ecdc"), 0, a);
        }
      }
    }
    return { lit };
  },
};

const spoonArch: LandmarkSpec = {
  span: true,
  defaultSpan: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const base = ctx.halfWidth + 8.6;
    const shade = barShade(34);
    const pairs = Math.max(1, Math.round(ctx.span / 26));
    // The bowl: an ellipse of 8 x 5.6 m, scooped 3 m deep, its long axis leaning 50 degrees, cupped side toward the road.
    const ux = Math.cos(0.87);
    const uy = Math.sin(0.87);
    const nx = uy;
    const ny = -ux;
    const a = 8.2;
    const bz = 5.8;
    const depth = 3.0;
    const tipX = 0.5;
    const cx = tipX + ux * a;
    const cy = 26.2;
    for (let n = 0; n < pairs; n++) {
      const zc = (n - (pairs - 1) / 2) * 26;
      for (const s of [-1, 1]) {
        const P = (x: number, y: number, z = 0): V3 => [s * x, y, zc + z];
        beam(lit, P(-base, -1.4), P(-base + 1.0, 4), 3.4, 2.8, 1.2, shade);
        beam(lit, P(-base + 1.0, 4), P(-base + 2.0, 14.5), 2.8, 2.2, 1.0, shade);
        beam(lit, P(-base + 2.0, 14.5), P(-cx - ux * a * 0.95 + 0.6, cy - uy * a * 0.95 + 0.4), 2.2, 2.0, 0.9, shade);
        // The bowl as rings of a paraboloid: point (r, phi) on the ellipse, sunk along the normal.
        const rings: V3[][] = [];
        for (let i = 0; i <= 5; i++) {
          const r = i / 5;
          const row: V3[] = [];
          for (let k = 0; k < 16; k++) {
            const phi = (k / 16) * TAU;
            const lu = Math.cos(phi) * a * r;
            const lz = Math.sin(phi) * bz * r;
            const d = -depth * (1 - r * r);
            row.push(P(-cx + ux * lu + nx * d, cy + uy * lu + ny * d, lz));
          }
          rings.push(row);
        }
        grid(lit, rings, (p, i) => {
          const r = i / 5;
          const base2 = mixRgb(STEEL_D, STEEL_L, Math.max(0, Math.min(1, (p[1] - 18) / 16)));
          return scaleRgb(base2, 0.85 + 0.35 * r);
        }, true);
        // The rolled rim round the bowl.
        const rim = rings[5]!;
        tube(lit, rim, { radius: 0.38, sides: 5, shade: STEEL_L, closed: true });
        // The chips of counter at the foot.
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * TAU + n;
          lit.blob(s * -base + Math.cos(ang) * 3.4, 0.2, zc + Math.sin(ang) * 3.0, 0.6, 0.35, 0.6, rgb("#f4ecdc"), 0, ang);
        }
      }
    }
    return { lit };
  },
};

// ─── Sink ────────────────────────────────────────────────────────────────────

const sink: LandmarkSpec = {
  footprint: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const deckY = 5.2;
    const waterY = 2.8;
    const deck = ramp(scaleRgb(STEEL, 0.95), STEEL_L);
    // The stainless cabinet under the worktop, with two panelled doors and handles.
    lit.box(0, (deckY - 1.5) / 2 - 0.2, 0, 49, deckY + 1.5 - 0.4, 39, ramp(STEEL_D, scaleRgb(STEEL, 0.85)));
    for (const x of [-12.5, 12.5]) {
      lit.box(x, 2.3, 19.6, 22, 4.6, 0.4, ramp(scaleRgb(STEEL_D, 1.1), scaleRgb(STEEL, 0.95)));
      lit.box(x, 2.4, 19.9, 19.4, 3.2, 0.2, ramp(STEEL_D, scaleRgb(STEEL, 0.78)));
      lit.box(x + (x > 0 ? -8.5 : 8.5), 3.4, 20.25, 0.5, 2.2, 0.45, STEEL_L);
    }
    // The worktop: slabs round the two basins and the drainer, with a bright bead along the front and a back splash.
    const slab2 = (x0: number, x1: number, z0: number, z1: number) => lit.box((x0 + x1) / 2, deckY - 0.5, (z0 + z1) / 2, x1 - x0, 1.0, z1 - z0, deck);
    slab2(-25, 25, 14, 20);
    slab2(-25, 25, -20, -12);
    slab2(-25, -24, -12, 14);
    slab2(-8, -6, -12, 14);
    slab2(8, 10, -12, 14);
    slab2(10, 25, -12, 14);
    lit.box(0, deckY + 2.4, -19.4, 50, 4.8, 1.4, ramp(scaleRgb(STEEL, 0.9), STEEL_L));
    lit.box(0, deckY + 0.1, 20.1, 50, 0.7, 0.9, STEEL_L);
    lit.box(0, deckY + 0.1, 14.2, 50, 0.4, 0.5, STEEL_L);
    for (const [x0, x1] of [[-24, -8], [-6, 8]] as const) {
      const w = x1 - x0;
      const cx = (x0 + x1) / 2;
      const wallH = deckY - 0.3;
      // Basin walls down to the floor, a dark plughole, and the water's glass skin.
      for (const z of [-12, 14]) lit.box(cx, wallH / 2 + 0.3, z, w, wallH, 0.5, ramp(STEEL_D, STEEL));
      for (const x of [x0, x1]) lit.box(x, wallH / 2 + 0.3, 1, 0.5, wallH, 26, ramp(STEEL_D, STEEL));
      lit.box(cx, 0.2, 1, w, 0.4, 26, ramp(rgb("#37424f"), STEEL_D));
      lit.add(shapes.cylinder(10), xf(cx, 0.45, -1, 1.4, 0.2, 1.4), rgb("#161b22"));
      glass.box(cx, waterY, 1, w - 0.3, 0.12, 25.6, [0.55, 1.0, 1.35]);
    }
    // Ripples on the water, bright: rings round the tap's drip and a sheen across the other basin.
    for (const r of [2.0, 3.6, 5.2]) torus(glow, r, 0.14, { at: [-14, waterY + 0.1, -2], facing: "y", ringSegments: 18, tubeSegments: 3, shade: [1.1 + 0.4 * (r / 5), 1.9, 2.5] });
    glow.blob(1, waterY + 0.1, 4, 4.5, 0.05, 2.2, [1.0, 1.7, 2.3], 0);
    glow.blob(-16, waterY + 0.1, 8, 3.2, 0.05, 1.4, [1.0, 1.7, 2.3], 0);
    // A sponge on the divider.
    lit.box(-7, deckY + 0.6, 6, 3.4, 1.3, 5.2, ramp(lift("#d9a81c", 1.2), lift("#ffd23a", 1.25)));
    lit.box(-7, deckY + 1.3, 6, 3.4, 0.4, 5.2, lift("#2f9a4a", 1.3));
    // The drainer: ribs along it, two cups with handles, a rack with a pair of plates on edge.
    for (let x = 11.5; x < 24.5; x += 1.9) lit.box(x, deckY + 0.3, 1, 0.9, 0.5, 25, STEEL_L);
    for (const [x, z] of [[13.2, -7], [18.5, -3]] as const) {
      lathe(lit, [[0, 0], [1.9, 0], [2.0, 1.2], [2.9, 4.6], [2.5, 4.7], [1.9, 1.5], [0, 1.4]], {
        at: [x, deckY + 0.5, z],
        segments: 12,
        shade: byHeight(deckY, deckY + 5.2, scaleRgb(CHINA, 0.8), CHINA),
      });
      lathe(lit, [[2.55, 3.0], [2.75, 3.0], [2.95, 4.5], [2.75, 4.6]], { at: [x, deckY + 0.5, z], segments: 12, shade: BLUE });
      tube(lit, bezier([x + 2.7, deckY + 4.0, z], [x + 5.4, deckY + 4.4, z], [x + 5.4, deckY + 1.4, z], [x + 2.2, deckY + 1.6, z], 8), { radius: 0.5, sides: 5, shade: CHINA });
    }
    lit.box(19.5, deckY + 0.9, 7.0, 10, 0.5, 0.5, STEEL);
    lit.box(19.5, deckY + 0.9, 3.6, 10, 0.5, 0.5, STEEL);
    for (const x of [15.2, 23.8]) lit.box(x, deckY + 1.6, 5.3, 0.5, 1.8, 4.4, STEEL);
    for (const x of [17.6, 21.4]) {
      lit.add(shapes.cylinder(14), xf(x, deckY + 5.6, 5.3, 5.2, 0.6, 5.2, 0, 0, Math.PI / 2 - 0.12), ramp(CHINA, CHINA));
      lit.add(shapes.cylinder(14), xf(x + 0.33, deckY + 5.6, 5.3, 3.1, 0.4, 3.1, 0, 0, Math.PI / 2 - 0.12), BLUE);
    }
    // The tall arching tap with its lever and two taps, standing between the basins at the back.
    lit.post(-7, deckY, -14.4, 2.8, 1.4, ramp(STEEL, STEEL_L), 10, 0.85);
    const pipePath: V3[] = [[-7, deckY, -14.4], [-7, deckY + 5, -14.4], ...bezier([-7, deckY + 8, -14.4], [-7, deckY + 24, -14.4], [-14, deckY + 24, -6], [-14, deckY + 13.4, -2.6], 14)];
    tube(lit, pipePath, { radius: 1.45, sides: 8, shade: chrome(deckY, deckY + 21, 0.1) });
    lit.post(-14, deckY + 11.8, -2.6, 1.7, 1.8, ramp(STEEL, STEEL_L), 8, 0.8);
    lit.rod([-7, deckY + 7, -14.4], [-0.6, deckY + 11, -14.4], 0.8, ramp(STEEL, STEEL_L));
    lit.blob(0.2, deckY + 11.4, -14.4, 1.4, 1.4, 1.4, STEEL_L, 1);
    for (const [dx, col] of [[-4, rgb("#d6332f")], [4, rgb("#2f6fd6")]] as const) {
      lit.post(-7 + dx, deckY + 0.6, -14.4, 1.2, 1.6, ramp(STEEL, STEEL_L), 8, 0.8);
      lit.blob(-7 + dx, deckY + 2.6, -14.4, 1.3, 0.8, 1.3, col, 1);
    }
    glass.box(-14, deckY + 6.4, -2.6, 0.7, 11.2, 0.7, [0.7, 1.15, 1.5]);
    // Foam piled up over the near basin, a big white heap taller than the rim.
    const foam: Rgb = [1.3, 1.75, 2.7];
    for (let i = 0; i < 40; i++) {
      const a = ctx.rnd() * TAU;
      const r = ctx.rnd() * 7;
      const y = waterY + 0.6 + (1 - r / 7) * 6.5 + ctx.rnd() * 1.6;
      const s2 = 1.3 + ctx.rnd() * 1.8;
      lit.blob(-16 + Math.cos(a) * r * 1.1, y, 5 + Math.sin(a) * r * 1.5, s2, s2 * 0.9, s2, ramp(scaleRgb(foam, 0.72), foam), 1);
    }
    const moving: MovingPart[] = [];
    // A bar of soap and a raft of bubbles bobbing on the other basin.
    {
      const soap = new MeshBuilder();
      const bub = new MeshBuilder();
      const bar = lift("#ffd6ec", 1.2);
      soap.box(0.5, waterY + 0.5, 3, 5.0, 1.8, 3.2, ramp(scaleRgb(bar, 0.85), bar));
      soap.blob(0.5, waterY + 1.45, 3, 2.4, 0.3, 1.4, mixRgb(bar, [1, 1, 1], 0.4), 0);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const r = 0.8 + (i % 3) * 0.6;
        bub.blob(-2.5 + Math.cos(a) * (2.8 + i * 0.4), waterY + 0.5 + r * 0.4, 5 + Math.sin(a) * (3.4 + i * 0.5), r, r, r, [1.1, 1.3, 1.5], 1);
      }
      moving.push({
        lit: soap,
        glass: bub,
        pivot: [0, waterY, 3],
        update(t, part) {
          part.position.y = Math.sin(t * 1.7) * 0.22;
          part.rotation.y = Math.sin(t * 0.7) * 0.22;
        },
      });
    }
    // Bubbles rising from the foam: three that float up, swell and fade.
    for (let n = 0; n < 3; n++) {
      const g = new MeshBuilder();
      const x = -19 + n * 3.4;
      const z = 5 + (n - 1) * 3.5;
      for (let i = 0; i < 3; i++) g.blob(x + i * 1.1, 11 + i * 1.5, z + (i % 2) * 1.4, 1.0 + i * 0.3, 1.0 + i * 0.3, 1.0 + i * 0.3, [1.1, 1.35, 1.6], 1);
      moving.push({
        glass: g,
        pivot: [x, 11, z],
        update(t, part) {
          const u = (t * 0.1 + n * 0.33) % 1;
          part.position.y = u * 10 - 2;
          part.scale.setScalar(Math.max(0.01, Math.sin(Math.PI * u)));
        },
      });
    }
    const halos = [{ x: -14, y: 6, z: 2, size: 18, colour: [1.2, 1.8, 2.4] as const, alpha: 0.18, twinkle: 0.2 }];
    return { lit, glow, glass, moving, halos };
  },
};

// ─── Window and wall clock ───────────────────────────────────────────────────

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

const GROUT_COLS = 12;

const windowWall: LandmarkSpec = {
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

const wallClock: LandmarkSpec = {
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
    // The hour hand stands at ten past ten, a spade-tipped bar, fixed.
    const ha = (305 / 360) * TAU;
    lit.rod([0, cy, zf + 1.4], [Math.sin(ha) * 4.4, cy + Math.cos(ha) * 4.4, zf + 1.4], 0.85, ink);
    lit.blob(Math.sin(ha) * 4.7, cy + Math.cos(ha) * 4.7, zf + 1.4, 0.8, 1.2, 0.3, ink, 0, -ha);
    const cap = (w: number, len: number, z: number, paint: Paint, tail: number) => {
      const g = new MeshBuilder();
      g.box(0, cy + len / 2 - tail / 2, z, w, len + tail, 0.4, paint);
      g.blob(0, cy + len, z, w * 0.9, w * 1.4, 0.3, paint, 0);
      return g;
    };
    const minute = cap(0.8, 6.6, zf + 1.8, ink, 1.0);
    const second = cap(0.35, 7.4, zf + 2.3, rim, 2.0);
    second.add(shapes.cylinder(10), xf(0, cy - 2.0, zf + 2.3, 0.8, 0.4, 0.8, 0, Math.PI / 2), rim);
    const moving: MovingPart[] = [
      {
        lit: minute,
        pivot: [0, cy, zf + 1.8],
        update(t, part) {
          // One turn in 144 s, so it creeps visibly.
          part.rotation.z = -(((t / 144) % 1) + 60 / 360) * TAU;
        },
      },
      {
        lit: second,
        pivot: [0, cy, zf + 2.3],
        update(t, part) {
          // One turn in 12 s, to be seen from a kart.
          part.rotation.z = -((t / 12) % 1) * TAU;
        },
      },
    ];
    lit.add(shapes.cylinder(12), xf(0, cy, zf + 2.55, 1.0, 0.7, 1.0, 0, Math.PI / 2), rim);
    // A little bell on each side of the top of the case.
    for (const s of [-1, 1]) lit.blob(s * 7.4, cy + 9.4, zf + 0.4, 1.8, 1.4, 1.4, ramp(scaleRgb(rim, 0.8), rim), 1);
    return { lit, moving };
  },
};

// ─── Hazards ─────────────────────────────────────────────────────────────────

/** A ball rolls without slipping: the turn is the distance over the radius, and the layer has scaled the root by metres per natural unit. */
const rollAngle = (travel: number, root: Object3D, naturalRadius: number): number => travel / (naturalRadius * root.scale.x);

/** The ball of a rolling hazard on its own group (so it can turn), and a still highlight patch that stays put on top. */
function rollingBall(ctx: { lit: import("three").Material }, ball: MeshBuilder, highlight: MeshBuilder, r: number): { root: Group; spin: Group } {
  const spin = new Group();
  spin.add(new Mesh(ball.build(), ctx.lit));
  spin.position.y = r;
  const still = new Mesh(highlight.build(), ctx.lit);
  still.position.y = r;
  const root = new Group();
  root.add(spin, still);
  return { root, spin };
}

const orangeHazard: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    // The peel: a ball with a dimpled skin (every vertex nudged), darker at the foot.
    rockBlob(b, 0, 0, 0, 1, 0.97, 1, byHeight(-1, 1, scaleRgb(ORANGE, 0.7), mixRgb(ORANGE, [1, 1, 0.6], 0.12)), 5, { detail: 2, roughness: 0.035 });
    // The button where the stalk was, with a leaf, and a ring of darker pores.
    b.blob(0, 0.96, 0, 0.2, 0.07, 0.2, LEAF, 0);
    b.rod([0, 0.98, 0], [0.12, 1.12, 0], 0.07, STALK);
    b.add(shapes.ball(0), xf(0.34, 1.0, 0.06, 0.34, 0.05, 0.14, 0.1, 0, 0.35), ramp(scaleRgb(LEAF, 0.7), LEAF));
    for (let k = 0; k < 14; k++) {
      const a = k * 2.4;
      const y = Math.sin(k * 1.7) * 0.85;
      const r = Math.sqrt(1 - y * y);
      b.blob(Math.cos(a) * r, y, Math.sin(a) * r, 0.07, 0.07, 0.07, scaleRgb(ORANGE, 0.58), 0);
    }
    // The shine does not turn with the peel.
    const h = new MeshBuilder();
    plaque(h, [0, 0, 0], 1.0, [0.3, 0.7, 0.65], 0.22, 0.4, 0.06, mixRgb(ORANGE, [1.6, 1.5, 1.2], 0.6), -0.5);
    const { root, spin } = rollingBall(ctx, b, h, 1);
    return {
      root,
      radius: 1,
      update(s) {
        spin.rotation.x = rollAngle(s.travel, root, 1);
      },
    };
  },
};

const pea: HazardSpec = {
  build(ctx) {
    const b = new MeshBuilder();
    const green = lift("#6fd13b", 1.25);
    // A glossy pea: a smooth ball (finer than the orange's), with the pod's seam running round it and a tiny dark scar.
    b.blob(0, 0, 0, 0.7, 0.68, 0.7, ramp(scaleRgb(green, 0.65), mixRgb(green, [1, 1, 0.7], 0.18)), 2);
    torus(b, 0.7, 0.07, { facing: "z", ringSegments: 16, tubeSegments: 4, shade: scaleRgb(green, 0.5) });
    b.blob(0, 0.66, 0, 0.1, 0.05, 0.1, rgb("#2d4d1a"), 0);
    const h = new MeshBuilder();
    plaque(h, [0, 0, 0], 0.7, [0.35, 0.65, 0.7], 0.14, 0.27, 0.05, mixRgb(green, [1.6, 1.8, 1.4], 0.7), -0.5);
    const { root, spin } = rollingBall(ctx, b, h, 0.7);
    return {
      root,
      radius: 0.7,
      update(s) {
        // It crosses the road: the ball turns about its x axis as it advances along z.
        spin.rotation.x = rollAngle(s.travel, root, 0.7);
      },
    };
  },
};

const teacup: HazardSpec = {
  build(ctx) {
    const cup = new MeshBuilder();
    const china = CHINA;
    // A saucer with a raised ring, and the cup on it with a rolled lip; the tea inside is dark.
    lathe(cup, [[0, 0.02], [0.8, 0.02], [1.0, 0.08], [1.6, 0.46], [1.66, 0.56], [1.55, 0.56], [1.0, 0.3], [0, 0.26]], { segments: 14, shade: byHeight(0, 0.6, scaleRgb(china, 0.8), china) });
    lathe(cup, [[0, 0.24], [0.5, 0.24], [0.55, 0.36], [0.98, 1.0], [1.08, 1.5], [1.14, 1.58], [1.05, 1.62], [0.96, 1.52], [0.9, 1.4], [0, 1.2]], { segments: 14, shade: byHeight(0.2, 1.6, scaleRgb(china, 0.85), china) });
    cup.add(shapes.cylinder(14), xf(0, 1.3, 0, 0.9, 0.06, 0.9), lift("#7a4320", 1.3));
    // Cobalt bands round the rim and the saucer, and a ring of painted dots.
    lathe(cup, [[1.1, 1.36], [1.16, 1.36], [1.17, 1.56], [1.11, 1.56]], { segments: 14, shade: BLUE });
    lathe(cup, [[1.5, 0.43], [1.62, 0.5], [1.64, 0.56], [1.5, 0.52]], { segments: 14, shade: BLUE });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      cup.blob(Math.cos(a) * 1.04, 0.78, Math.sin(a) * 1.04, 0.1, 0.1, 0.1, BLUE, 0);
    }
    // The handle: a loop on one side.
    tube(cup, bezier([1.0, 1.25, 0], [1.9, 1.35, 0], [1.9, 0.5, 0], [0.7, 0.55, 0], 8), { radius: 0.12, sides: 5, shade: china });
    // Steam: three pale puffs of glow that drift up and thin out, kept apart from the china.
    const puffs: Mesh[] = [];
    const glowMat = ctx.glow;
    for (let k = 0; k < 3; k++) {
      const g = new MeshBuilder();
      g.blob(0, 0, 0, 0.24, 0.24, 0.24, [1.3, 1.3, 1.4], 1);
      const m = new Mesh(g.build(), glowMat);
      puffs.push(m);
    }
    const body = new Group();
    body.add(new Mesh(cup.build(), ctx.lit), ...puffs);
    const wobble = new Group();
    wobble.add(body);
    wobble.position.y = 0.5;
    body.position.y = -0.5;
    const root = new Group();
    root.add(wobble);
    return {
      root,
      radius: 1.6,
      update(s) {
        // Spinning about its own axis and rocking a little, as if on a ride.
        body.rotation.y = s.time * 2.6;
        wobble.rotation.x = Math.sin(s.time * 2.1) * 0.1;
        wobble.rotation.z = Math.cos(s.time * 2.1) * 0.1;
        puffs.forEach((p, k) => {
          const u = (s.time * 0.5 + k / 3) % 1;
          p.position.set(Math.sin(u * 6 + k * 2) * 0.22, 1.7 + u * 1.3, Math.cos(u * 5 + k) * 0.18);
          p.scale.setScalar(Math.max(0.01, Math.sin(Math.PI * u) * (1 + u)));
        });
      },
    };
  },
};

// BEGIN EXPORTS
export const LANDMARKS: Record<string, LandmarkSpec> = {
  teapot,
  "fruit-bowl": fruitBowl,
  toaster,
  grater,
  "salt-shaker": saltShaker,
  "pepper-mill": pepperMill,
  cookbook,
  "cereal-box": cerealBox,
  mug,
  "fork-arch": forkArch,
  "spoon-arch": spoonArch,
  sink,
  window: windowWall,
  "wall-clock": wallClock,
};

export const HAZARDS: Record<string, HazardSpec> = {
  orange: orangeHazard,
  pea,
  teacup,
};
