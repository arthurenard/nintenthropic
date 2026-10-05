/**
 * The palm world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build").
 *
 * Five Finger Circuit: a sunny island shaped like an open hand on a turquoise
 * sea. Sand, palms and bright beach toys, lit by a midday sun, so everything
 * here is solid and colourful; `glow` is only a touch (a lantern, a gem's
 * sparkle), and the one glass piece is the watch crystal.
 */
import { Group, Matrix4, Mesh, Quaternion, Vector3 } from "three";
import { archBand, byHeight, grid, lathe, MeshBuilder, mixRgb, ramp, rgb, rockBlob, scaleRgb, shapes, stripes, torus, tube, xf, type Rgb, type V3 } from "./kit";
import type { Halo, HazardSpec, LandmarkSpec, MovingPart } from "./types";

export const LANDMARKS: Record<string, LandmarkSpec> = {};
export const HAZARDS: Record<string, HazardSpec> = {};

const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────

const SAND = rgb("#f2d99b");
const SAND_DARK = rgb("#cfae6c");
const SAND_LIGHT = rgb("#fff0c2");
const WET_SAND = rgb("#a8864c");
const TRUNK_A = rgb("#c99a5e");
const TRUNK_B = rgb("#a8793f");
const FROND_LIGHT = rgb("#8ae37f");
const FROND_MID = rgb("#34c25a");
const FROND_DARK = rgb("#17803b");
const COCONUT = rgb("#6b4423");
const BAMBOO_A = rgb("#e3c06a");
const BAMBOO_B = rgb("#c99d44");
const THATCH_A = rgb("#d8b05a");
const THATCH_B = rgb("#b98d3c");
const WOOD = rgb("#8a5a2c");
const WOOD_DARK = rgb("#5a3a1e");
const TURQUOISE = rgb("#1fd0c8");
const CORAL = rgb("#ff6b57");
const SUNSET = rgb("#ff8a3d");
const YELLOW = rgb("#ffd23a");
const PINK = rgb("#ff6fa8");
const RED = rgb("#ee3b3b");
const BLUE = rgb("#2f7cf0");
const GREEN = rgb("#3ecb62");
const WHITE = rgb("#fffaf0");
const GOLD = rgb("#ffc233");
const GOLD_DARK = rgb("#b8801a");
const DARK = rgb("#2a2018");
const G_WARM: Rgb = [3.4, 2.1, 0.9];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const hash = (i: number): number => {
  const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Copies every triangle of `src` into `dst` through a matrix. */
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

const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();

/** A unit shape stood on `pos` with its +y along `dir`. */
function orient(b: MeshBuilder, shape: ReturnType<typeof shapes.cone>, pos: V3, dir: V3, sx: number, sy: number, sz: number, paint: Rgb | { bottom: Rgb; top: Rgb }): void {
  const d = new Vector3(dir[0], dir[1], dir[2]).normalize();
  _q.setFromUnitVectors(_up, d);
  b.add(shape, new Matrix4().compose(new Vector3(pos[0] + d.x * sy * 0.5, pos[1] + d.y * sy * 0.5, pos[2] + d.z * sy * 0.5), _q, new Vector3(sx, sy, sz)), paint);
}

/** A mound of sand, wide and low, to bed a thing into the ground. */
function sandMound(b: MeshBuilder, cx: number, cz: number, r: number, h: number, segments = 12): void {
  lathe(b, [[0, -1.2], [r, -1.2], [r * 0.97, -0.1], [r * 0.7, h * 0.55], [r * 0.38, h * 0.9], [0, h]], { at: [cx, 0, cz], segments, shade: byHeight(-0.2, h, SAND_DARK, SAND_LIGHT), caps: "top" });
}

/** Rich glossy colours for a beach ball panel number. */
const BALL_PANELS: Rgb[] = [RED, YELLOW, BLUE, WHITE, GREEN, SUNSET];

/** A beach ball of radius `r` centred on the origin: six panels and white caps. */
function beachBall(r: number): MeshBuilder {
  const b = new MeshBuilder();
  const prof: [number, number][] = [];
  for (let lat = -90; lat <= 90; lat += 22.5) prof.push([r * Math.cos((lat * Math.PI) / 180), r * Math.sin((lat * Math.PI) / 180)]);
  lathe(b, prof, {
    segments: 12,
    shade: (p, _i, j) => {
      const lat = Math.abs(Math.asin(p[1] / r));
      if (lat > 1.2) return WHITE;
      const c = BALL_PANELS[Math.floor(j / 2) % BALL_PANELS.length]!;
      return scaleRgb(c, 0.72 + 0.28 * (p[1] / r + 1) * 0.5 + 0.1);
    },
  });
  for (const s of [-1, 1]) {
    b.add(shapes.cylinder(8), xf(0, s * (r - 0.02), 0, r * 0.2, r * 0.1, r * 0.2), rgb("#e8e0cc"));
  }
  return b;
}

// ─── Palm tree ───────────────────────────────────────────────────────────────

/** One frond: a drooping spine with slender leaflets down both sides. */
function frond(b: MeshBuilder, base: V3, az: number, len: number, rise: number, droop: number, leaf: number, light: Rgb, dark: Rgb, rib: Rgb, seed: number): void {
  const N = 8;
  const dx = Math.cos(az);
  const dz = Math.sin(az);
  const sx = -dz;
  const sz = dx;
  const spine: V3[] = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    spine.push([base[0] + dx * len * s, base[1] + rise * Math.sin(s * Math.PI * 0.55) - droop * s * s, base[2] + dz * len * s]);
  }
  tube(b, spine, { radius: (t) => 0.2 - 0.1 * t, sides: 4, shade: rib });
  for (let k = 1; k <= N; k++) {
    const p = spine[k]!;
    const prev = spine[k - 1]!;
    const s = k / N;
    const L = leaf * (0.45 + 0.55 * Math.sin(Math.min(1, s * 1.05) * Math.PI)) * (0.9 + hash(seed + k) * 0.2);
    for (const side of [-1, 1]) {
      for (let h = 0; h < 2; h++) {
        const f = h === 0 ? 0.25 : 0.75;
        const a: V3 = [prev[0] + (p[0] - prev[0]) * (f - 0.22), prev[1] + (p[1] - prev[1]) * (f - 0.22), prev[2] + (p[2] - prev[2]) * (f - 0.22)];
        const c: V3 = [prev[0] + (p[0] - prev[0]) * (f + 0.22), prev[1] + (p[1] - prev[1]) * (f + 0.22), prev[2] + (p[2] - prev[2]) * (f + 0.22)];
        const down = 0.5 + 0.5 * s;
        const tip: V3 = [a[0] + sx * side * L * 0.9 + dx * L * 0.45, a[1] - L * down * 0.6, a[2] + sz * side * L * 0.9 + dz * L * 0.45];
        b.tri(a, c, tip, light, light, mixRgb(dark, light, 0.15 * h));
      }
    }
  }
}

LANDMARKS["palm-tree"] = {
  footprint: 6,
  build() {
    const lit = new MeshBuilder();
    const H = 18;
    const lean = (y: number): number => 3.2 * (y / H) * (y / H);
    // The trunk: tan rings on a curve, leaning toward the sea, thicker at the foot.
    const path: V3[] = [];
    for (let k = 0; k <= 15; k++) {
      const y = (k / 15) * H;
      path.push([lean(y), y - 0.8, Math.sin(y * 0.2) * 0.35]);
    }
    tube(lit, path, { radius: (t) => 0.98 - 0.46 * t, sides: 7, shade: (_p, i) => (i % 2 === 0 ? TRUNK_A : TRUNK_B) });
    lit.blob(0, 0.2, 0, 1.5, 1.0, 1.5, ramp(TRUNK_B, TRUNK_A), 0);
    sandMound(lit, 0, 0, 4.2, 1.1);
    // The crown: ten fronds, a few young ones standing up, and five coconuts, turning as one on the top.
    const top = path[path.length - 1]!;
    const crown = new MeshBuilder();
    crown.blob(top[0], top[1] + 0.2, top[2], 0.85, 0.7, 0.85, ramp(COCONUT, TRUNK_B), 0);
    for (let k = 0; k < 10; k++) {
      const az = (k / 10) * TAU + hash(k) * 0.3;
      const len = 7.2 + hash(k + 11) * 1.8;
      frond(crown, [top[0], top[1] + 0.3, top[2]], az, len, 1.6 + hash(k + 21) * 1.6, 4.2 + hash(k + 31) * 2.2, 2.9, k % 3 === 0 ? FROND_LIGHT : FROND_MID, FROND_DARK, k % 2 === 0 ? SAND_LIGHT : rgb("#c9e8a0"), k * 7);
    }
    for (let k = 0; k < 3; k++) {
      const az = (k / 3) * TAU + 0.5;
      frond(crown, [top[0], top[1] + 0.6, top[2]], az, 3.6, 3.4, 1.0, 2.0, FROND_LIGHT, FROND_MID, rgb("#c9e8a0"), k * 13 + 100);
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.3;
      crown.blob(top[0] + Math.cos(a) * 0.85, top[1] - 0.45 - (k % 2) * 0.2, top[2] + Math.sin(a) * 0.85, 0.55, 0.62, 0.55, ramp(COCONUT, k % 2 ? rgb("#7a9a3a") : rgb("#9a6a3a")), 0);
    }
    const moving: MovingPart[] = [
      {
        lit: crown,
        pivot: [top[0], top[1], top[2]],
        update(t, part) {
          part.rotation.z = 0.035 * Math.sin(t * 0.8);
          part.rotation.x = 0.03 * Math.sin(t * 0.6 + 1.2);
          part.rotation.y = 0.02 * Math.sin(t * 0.4);
        },
      },
    ];
    return { lit, moving };
  },
};

// ─── Beach hut ───────────────────────────────────────────────────────────────

/** One side of a thatched roof: layers of straw laid like tiles, each with a ragged lower edge. */
function thatchSide(b: MeshBuilder, x0: number, x1: number, zEave: number, yEave: number, zRidge: number, yRidge: number, layers: number): void {
  for (let l = 0; l < layers; l++) {
    const u0 = l / layers;
    const u1 = (l + 1) / layers + 0.04;
    const at = (u: number, x: number, lift: number): V3 => [x, yEave + (yRidge - yEave) * u + lift, zEave + (zRidge - zEave) * u];
    const col = l % 2 === 0 ? THATCH_A : THATCH_B;
    const lift = 0.18 * (layers - l) / layers;
    const dark = scaleRgb(col, 0.62);
    b.quad(at(u0, x0, lift), at(u0, x1, lift), at(u1, x1, 0), at(u1, x0, 0), dark, dark, col, col);
    // The ragged fringe hanging from this layer's lower edge.
    const teeth = Math.round((x1 - x0) / 0.7);
    for (let t = 0; t < teeth; t++) {
      const xa = x0 + ((x1 - x0) * t) / teeth;
      const xb = x0 + ((x1 - x0) * (t + 1)) / teeth;
      const p0 = at(u0, xa, lift);
      const p1 = at(u0, xb, lift);
      const tipLen = 0.55 + 0.35 * hash(l * 40 + t);
      b.tri(p0, p1, [(p0[0] + p1[0]) / 2, p0[1] - tipLen * 0.7, p0[2] + (zEave - zRidge > 0 ? 0.25 : -0.25) * tipLen], dark, dark, scaleRgb(col, 0.5));
    }
  }
}

LANDMARKS["beach-hut"] = {
  footprint: 9,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const F = 2.4; // floor height
    const wallTop = 6.2;
    // Stilts, with cross bracing, and a deck of planks.
    for (const x of [-3.9, 3.9]) {
      for (const z of [-3, 0.4, 4.6]) lit.post(x, -1.6, z, 0.34, F + 1.8, ramp(WOOD_DARK, WOOD), 6);
      lit.rod([x, -1.0, -3], [x, 2.2, 0.4], 0.2, WOOD_DARK);
      lit.rod([x, 2.2, -3], [x, -1.0, 0.4], 0.2, WOOD_DARK);
    }
    lit.box(0, F + 0.05, 0.8, 9.2, 0.4, 8.8, ramp(WOOD, rgb("#b0773c")));
    for (let q = 0; q < 8; q++) lit.box(0, F + 0.28, -3.3 + q * 1.15, 9.0, 0.06, 0.12, WOOD_DARK);
    sandSkirt(lit);
    // Bamboo walls: vertical poles of two shades, lashed with rope.
    const pole = (x: number, y0: number, y1: number, z: number, i: number, yaw = 0): void => {
      lit.box(x, (y0 + y1) / 2, z, yaw ? 0.34 : 0.42, y1 - y0, yaw ? 0.42 : 0.34, ramp(i % 2 ? BAMBOO_B : scaleRgb(BAMBOO_A, 0.85), i % 2 ? BAMBOO_A : mixRgb(BAMBOO_A, WHITE, 0.2)));
    };
    for (let i = 0; i < 18; i++) pole(-4 + i * 0.47, F + 0.3, wallTop, -3.1, i);
    for (let i = 0; i < 11; i++) for (const s of [-1, 1]) pole(s * 3.95, F + 0.3, wallTop, -2.7 + i * 0.5, i, 1);
    for (let i = 0; i < 18; i++) {
      const x = -4 + i * 0.47;
      if (x > -1.1 && x < 1.1) continue; // the doorway
      const inWindow = x > 1.7 && x < 3.5;
      pole(x, inWindow ? F + 0.3 : F + 0.3, inWindow ? 3.9 : wallTop, 2.2, i);
      if (inWindow) pole(x, 5.5, wallTop, 2.2, i);
    }
    lit.box(0, 3.5, -3.0, 8.4, 0.2, 0.2, rgb("#7a5a2a"));
    lit.box(0, 5.4, -3.0, 8.4, 0.2, 0.2, rgb("#7a5a2a"));
    // The doorway (dark inside) and the propped-open shutter over the window.
    lit.box(0, F + 1.9, 1.6, 2.3, 3.7, 0.2, DARK);
    lit.box(-1.25, F + 1.9, 2.3, 0.28, 3.9, 0.3, WOOD);
    lit.box(1.25, F + 1.9, 2.3, 0.28, 3.9, 0.3, WOOD);
    lit.box(0, F + 3.9, 2.3, 2.8, 0.3, 0.3, WOOD);
    lit.box(2.6, 4.7, 1.9, 1.9, 1.5, 0.12, DARK);
    const sh: V3[][] = [
      [[1.6, 5.5, 2.35], [3.6, 5.5, 2.35]],
      [[1.6, 4.5, 3.9], [3.6, 4.5, 3.9]],
    ];
    grid(lit, sh, (_p, i) => (i === 0 ? scaleRgb(CORAL, 0.8) : CORAL));
    lit.rod([1.8, 4.5, 3.9], [1.8, 2.7, 3.9], 0.18, WOOD);
    lit.box(2.6, 5.0, 3.1, 1.8, 0.1, 0.1, WHITE);
    // The porch: deck, railing posts, steps, a ladder.
    for (const x of [-4.1, 4.1]) lit.post(x, F + 0.2, 5.2, 0.24, 3.4, ramp(WOOD_DARK, WOOD), 6);
    lit.box(0, F + 1.3, 5.2, 8.2, 0.2, 0.2, WOOD);
    lit.box(0, F + 0.7, 5.2, 8.2, 0.14, 0.2, WOOD);
    // The thatched roof: two pitches with a ridge cap, gable ends and a deep porch overhang.
    thatchSide(lit, -4.9, 4.9, 3.9, 6.0, -0.1, 9.4, 6);
    thatchSide(lit, -4.9, 4.9, -3.7, 6.0, -0.1, 9.4, 6);
    for (const s of [-1, 1]) {
      lit.tri([s * 4.8, 6.1, 3.7], [s * 4.8, 6.1, -3.6], [s * 4.8, 9.2, -0.1], THATCH_B, THATCH_B, THATCH_A);
    }
    lit.box(0, 9.55, -0.1, 10.2, 0.5, 0.9, ramp(THATCH_B, THATCH_A));
    // A rope ladder-style ladder from the sand to the deck, left of the porch.
    for (const x of [-2.6, -1.4]) lit.rod([x, -1.0, 7.4], [x, F + 0.8, 5.5], 0.2, WOOD);
    for (let q = 0; q < 5; q++) {
      const t = (q + 0.5) / 5;
      lit.rod([-2.6, -1.0 + (F + 1.8) * t, 7.4 - 1.9 * t], [-1.4, -1.0 + (F + 1.8) * t, 7.4 - 1.9 * t], 0.16, WOOD);
    }
    // The hammock between two porch posts: a striped, sagging ribbon.
    const hammock: V3[][] = [];
    for (let r = 0; r < 2; r++) {
      const row: V3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        row.push([-3.9 + 3.8 * t, 5.4 - 1.35 * Math.sin(t * Math.PI), 4.55 + r * 1.0]);
      }
      hammock.push(row);
    }
    grid(lit, hammock, (_p, _i, j) => (Math.floor(j / 2) % 2 === 0 ? CORAL : YELLOW));
    lit.rod([-3.9, 5.4, 4.55], [-3.9, 5.6, 5.1], 0.16, WHITE);
    lit.rod([-0.1, 5.4, 4.55], [-0.1, 5.6, 5.1], 0.16, WHITE);
    // A lantern hanging from the roof beam, and a flag on the ridge.
    lit.rod([2.2, 6.1, 4.9], [2.2, 5.5, 4.9], 0.16, DARK);
    lit.box(2.2, 5.1, 4.9, 0.55, 0.8, 0.55, ramp(WOOD_DARK, WOOD));
    glow.box(2.2, 5.1, 4.9, 0.36, 0.55, 0.36, G_WARM);
    lit.post(0, 9.6, -0.1, 0.12 + 0.05, 3.2, WOOD, 5);
    lit.tri([0.05, 12.7, -0.1], [0.05, 11.6, -0.1], [2.5, 12.1, -0.1], CORAL, CORAL, SUNSET);
    // A surfboard rack against the right side, three boards leaning.
    lit.box(6.2, 0.4, 0.6, 0.35, 2.6, 0.35, WOOD);
    lit.box(6.2, 0.4, 3.4, 0.35, 2.6, 0.35, WOOD);
    lit.box(6.2, 1.2, 2.0, 0.3, 0.3, 3.2, WOOD);
    for (const [k, col] of [TURQUOISE, SUNSET, PINK].entries()) {
      lit.blob(6.7 - k * 0.45, 3.4, 0.9 + k * 0.85, 0.13 + 0.17, 3.7, 0.9, ramp(scaleRgb(col, 0.8), mixRgb(col, WHITE, 0.25)), 1);
    }
    sandMound(lit, 0, 7, 3.5, 0.45, 10);
    return { lit, glow };
  },
};

/** Sand piled round the stilts. */
function sandSkirt(b: MeshBuilder): void {
  lathe(b, [[0, -1.2], [8, -1.2], [8.2, -0.6], [7.6, -0.1]], { at: [0, 0, 1], segments: 12, shade: byHeight(-1.2, 0, SAND_DARK, SAND), caps: "bottom" });
}

// ─── Surfboards ──────────────────────────────────────────────────────────────

/** A surfboard standing on its tail (y up the board, x across, deck facing +z) with a lean, two colour gradient, stripes, stringer and fins. */
function surfboard(b: MeshBuilder, x: number, z: number, y0: number, L: number, W: number, lx: number, lz: number, a: Rgb, c: Rgb, stripe: Rgb, fins: number): void {
  const N = 18;
  const M = 8;
  const hw = (t: number): number => (W / 2) * Math.pow(Math.sin(Math.PI * Math.pow(Math.max(0.01, t), 0.72)), 0.5);
  const tx = Math.tan(lx);
  const tz = Math.tan(lz);
  const P = (u: number, t: number, thick: number): V3 => {
    const yy = y0 + t * L;
    return [x + u * hw(t) + yy * tz, yy, z + thick + yy * tx];
  };
  const top = (u: number, t: number): number => 0.16 + 0.2 * (1 - u * u);
  const bot = (u: number, t: number): number => -0.16 - 0.1 * (1 - u * u);
  const rowsTop: V3[][] = [];
  const rowsBot: V3[][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const rt: V3[] = [];
    const rb: V3[] = [];
    for (let j = 0; j <= M; j++) {
      const u = -1 + (2 * j) / M;
      rt.push(P(u, t, top(u, t)));
      rb.push(P(u, t, bot(u, t)));
    }
    rowsTop.push(rt);
    rowsBot.push(rb);
  }
  const paint = (p: V3, i: number, j: number): Rgb => {
    const t = i / N;
    const u = -1 + (2 * j) / M;
    if (Math.abs(u) < 0.13) return WHITE;
    const bandStripe = (t > 0.22 && t < 0.27) || (t > 0.7 && t < 0.75);
    if (bandStripe) return stripe;
    void p;
    return mixRgb(a, c, Math.min(1, Math.max(0, t * 1.1 - 0.05)));
  };
  grid(b, rowsTop, paint);
  grid(b, rowsBot, (p, i) => scaleRgb(mixRgb(a, c, i / N), 0.62));
  // The rails: the thin wall round the edge.
  for (let i = 0; i < N; i++) {
    for (const j of [0, M]) {
      const col = scaleRgb(mixRgb(a, c, i / N), 0.78);
      b.quad(rowsTop[i]![j]!, rowsTop[i + 1]![j]!, rowsBot[i + 1]![j]!, rowsBot[i]![j]!, col);
    }
  }
  // Fins stand off the back, near the tail.
  const finY = y0 + 0.2 * L;
  const finLen = 0.16 * L;
  const offs = fins === 3 ? [-0.38, 0, 0.38] : [0];
  offs.forEach((o, k) => {
    const base = P(o * 1.2, 0.16 + (k === 1 ? 0.0 : 0.02), -0.3);
    const h = k === 1 || fins === 1 ? 0.2 * L * 0.4 : 0.14 * L * 0.4;
    b.add(shapes.cone(4), xf(base[0], base[1] + finLen * 0.5 * 0.0, base[2] - h * 0.5, 0.28, h, finLen, 0, -Math.PI / 2), ramp(scaleRgb(a, 0.7), mixRgb(a, WHITE, 0.2)));
  });
  void finY;
}

LANDMARKS.surfboard = {
  footprint: 6,
  build() {
    const lit = new MeshBuilder();
    sandMound(lit, 0, 0, 5.2, 1.5, 12);
    surfboard(lit, 0, 0, 0.4, 16, 3.6, -0.07, 0.06, TURQUOISE, SUNSET, WHITE, 3);
    sandMound(lit, 4.7, -0.4, 3.4, 1.1, 10);
    surfboard(lit, 4.7, -0.4, 0.2, 9.5, 2.5, -0.05, -0.12, CORAL, YELLOW, TURQUOISE, 1);
    // The leash: a black cord from the tail looping into the sand, with a cuff.
    const cord: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      cord.push([1.2 + Math.sin(t * Math.PI) * 1.6 + t * 1.2, 0.5 + 1.3 * Math.sin(t * Math.PI * 0.9) * (1 - t), -0.5 - 0.8 * t + Math.sin(t * 6) * 0.35]);
    }
    tube(lit, cord, { radius: 0.13, sides: 4, shade: DARK });
    lit.box(0.9, 1.3, -0.45, 0.5, 0.6, 0.5, rgb("#3a3a58"));
    // A few shells and a starfish at the foot.
    for (const [x, z, c] of [[-2.8, 3.4, PINK], [-1.9, 3.9, SAND_LIGHT], [2.4, 3.8, CORAL]] as const) {
      lit.add(shapes.cone(7), xf(x, 0.25, z, 0.42, 0.5, 0.42, hash(x) * 6), ramp(scaleRgb(c, 0.8), mixRgb(c, WHITE, 0.3)));
    }
    starfish(lit, 0.9, 4.2, SUNSET);
    return { lit };
  },
};

/** A five-armed starfish lying flat. */
function starfish(b: MeshBuilder, x: number, z: number, col: Rgb, r = 1.0): void {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.4;
    b.tri([x, 0.2, z], [x + Math.cos(a - 0.4) * r * 0.42, 0.14, z + Math.sin(a - 0.4) * r * 0.42], [x + Math.cos(a) * r, 0.06, z + Math.sin(a) * r], col, col, scaleRgb(col, 0.8));
    b.tri([x, 0.2, z], [x + Math.cos(a) * r, 0.06, z + Math.sin(a) * r], [x + Math.cos(a + 0.4) * r * 0.42, 0.14, z + Math.sin(a + 0.4) * r * 0.42], col, scaleRgb(col, 0.8), col);
  }
  b.blob(x, 0.2, z, 0.2 * r, 0.1 * r, 0.2 * r, mixRgb(col, WHITE, 0.4), 0);
}

// ─── Sandcastle ──────────────────────────────────────────────────────────────

LANDMARKS.sandcastle = {
  footprint: 13,
  build() {
    const lit = new MeshBuilder();
    const glass = new MeshBuilder();
    const sand = (y0: number, y1: number): ReturnType<typeof byHeight> => byHeight(y0, y1, SAND_DARK, SAND_LIGHT);
    // The base: a raised mound inside a moat of wet sand holding a ring of water.
    lathe(lit, [[0, -1.2], [9.6, -1.2], [9.8, 0.2], [9.0, 0.9], [0, 0.9]], { segments: 20, shade: sand(-1, 1), caps: "top" });
    lathe(lit, [[9.8, -0.1], [13.2, -0.1], [13.4, 0.1], [13.8, 0.9], [14.8, -1.0]], { segments: 20, shade: byHeight(-0.1, 0.9, WET_SAND, SAND_DARK) });
    lathe(glass, [[9.9, 0.04], [13.0, 0.04]], { segments: 20, shade: [0.2, 0.75, 0.95], caps: "top" });
    // Curtain walls with crenellations.
    const wall = (x0: number, z0: number, x1: number, z1: number, h: number): void => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      lit.box((x0 + x1) / 2, h / 2 + 0.4, (z0 + z1) / 2, 1.6, h + 0.2, len, ramp(SAND_DARK, SAND), yaw);
      const n = Math.max(2, Math.floor(len / 1.8));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        lit.box(x0 + dx * t, h + 0.95, z0 + dz * t, 1.1, 0.9, 0.9, ramp(SAND, SAND_LIGHT), yaw);
      }
    };
    const W = 7.2;
    wall(-W, -W, W, -W, 3.8);
    wall(-W, -W, -W, W, 3.8);
    wall(W, -W, W, W, 3.8);
    // The front wall, with a gate in it.
    wall(-W, W, -2.2, W, 3.8);
    wall(2.2, W, W, W, 3.8);
    lit.box(0, 4.0, W, 4.4, 1.6, 1.6, ramp(SAND_DARK, SAND));
    for (let k = 0; k < 3; k++) lit.box(-1.4 + k * 1.4, 5.2, W, 0.9, 0.9, 0.9, ramp(SAND, SAND_LIGHT));
    lit.box(0, 1.4, W - 0.35, 3.0, 2.8, 0.6, DARK);
    lit.add(shapes.cylinder(10), xf(0, 2.8, W - 0.35, 1.5, 0.6, 1.5, 0, Math.PI / 2), DARK);
    // A plank bridge across the moat to the gate.
    lit.box(0, 0.3, W + 4.7, 2.6, 0.25, 4.6, ramp(WOOD, rgb("#b0773c")));
    // Corner towers with bucket tops, and a keep.
    const tower = (cx: number, cz: number, r: number, h: number, roof: "cone" | "bucket", flag: Rgb): void => {
      lathe(lit, [[r * 1.3, -0.4], [r * 1.12, 0.6], [r, 1.6], [r * 0.94, h], [r * 1.25, h + 0.3], [r * 1.25, h + 0.9]], { at: [cx, 0, cz], segments: 10, shade: sand(0, h + 1) });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        lit.box(cx + Math.cos(a) * r * 1.12, h + 1.4, cz + Math.sin(a) * r * 1.12, 0.9, 0.9, 0.9, ramp(SAND, SAND_LIGHT), -a);
      }
      if (roof === "cone") lathe(lit, [[r * 1.05, h + 0.9], [r * 0.15, h + 0.9 + r * 1.9]], { at: [cx, 0, cz], segments: 10, shade: byHeight(h, h + r * 2.8, SAND, SAND_LIGHT) });
      else lathe(lit, [[r * 1.0, h + 0.9], [r * 0.82, h + 2.6], [r * 0.5, h + 3.1], [0.05, h + 3.2]], { at: [cx, 0, cz], segments: 10, shade: byHeight(h, h + 3.3, SAND, SAND_LIGHT) });
      const top = h + 0.9 + (roof === "cone" ? r * 1.9 : 3.2);
      lit.post(cx, top - 0.2, cz, 0.12 + 0.05, 2.2, WOOD, 5);
      lit.tri([cx + 0.05, top + 2.0, cz], [cx + 0.05, top + 1.0, cz], [cx + 1.6, top + 1.5, cz + 0.2], flag, flag, scaleRgb(flag, 0.8));
      lit.tri([cx + 0.05, top + 2.0, cz], [cx + 1.6, top + 1.5, cz + 0.2], [cx + 0.05, top + 1.0, cz], scaleRgb(flag, 0.8), scaleRgb(flag, 0.7), scaleRgb(flag, 0.8));
    };
    tower(-W, -W, 2.3, 8.2, "cone", CORAL);
    tower(W, -W, 2.3, 8.2, "bucket", TURQUOISE);
    tower(-W, W, 2.3, 7.4, "bucket", YELLOW);
    tower(W, W, 2.3, 7.4, "cone", PINK);
    tower(0, -1.5, 3.6, 11.5, "bucket", RED);
    // Shells at the gate, a starfish by the moat, and a bucket and spade.
    for (const [x, z, c] of [[-3.4, W + 3.2, PINK], [-2.6, W + 4.0, WHITE], [3.4, W + 3.6, CORAL], [4.2, W + 2.8, YELLOW]] as const) {
      lit.add(shapes.cone(7), xf(x, 0.35, z, 0.5, 0.55, 0.5, hash(x * 3) * 6), ramp(scaleRgb(c, 0.8), mixRgb(c, WHITE, 0.3)));
    }
    starfish(lit, -6.5, W + 7.5, SUNSET, 1.3);
    lit.add(shapes.frustum(0.72, 10), xf(8.6, 1.0, W + 6.0, 1.5, 2.0, 1.5), ramp(scaleRgb(RED, 0.75), RED));
    lit.add(shapes.frustum(0.74, 10), xf(8.6, 1.4, W + 6.0, 1.52, 0.5, 1.52), WHITE);
    tube(lit, [[7.3, 2.0, W + 6.0], [8.6, 3.3, W + 6.0], [9.9, 2.0, W + 6.0]], { radius: 0.12, sides: 4, shade: STEEL_GREY });
    lit.rod([11.2, 0.4, W + 4.6], [12.6, 2.9, W + 3.2], 0.24, WOOD);
    lit.box(10.7, 0.22, W + 5.1, 1.5, 0.12, 1.9, TURQUOISE, 0.6);
    return { lit, glass };
  },
};

const STEEL_GREY = rgb("#8a8a98");

// ─── Beach towel ─────────────────────────────────────────────────────────────

LANDMARKS["beach-towel"] = {
  footprint: 11,
  build() {
    const lit = new MeshBuilder();
    const LX = 16;
    const LZ = 8;
    const NX = 24;
    const NZ = 8;
    // A few low ridges where the towel has been rumpled.
    const hgt = (x: number, z: number): number => {
      const r1 = Math.max(0, 1 - Math.abs(x + 3.5 - z * 0.5) / 1.2);
      const r2 = Math.max(0, 1 - Math.abs(x - 4.5 + z * 0.35) / 1.0);
      const r3 = Math.max(0, 1 - Math.hypot(x + 6.5, z - 2) / 1.8);
      return 0.14 + 0.26 * r1 + 0.22 * r2 + 0.2 * r3 + 0.04 * Math.sin(x * 1.3 + z);
    };
    const rows: V3[][] = [];
    for (let k = 0; k <= NZ; k++) {
      const z = -LZ / 2 + (LZ * k) / NZ;
      const row: V3[] = [];
      for (let i = 0; i <= NX; i++) {
        const x = -LX / 2 + (LX * i) / NX;
        row.push([x, hgt(x, z), z]);
      }
      rows.push(row);
    }
    const stripeCols = [CORAL, WHITE, TURQUOISE, YELLOW, PINK, WHITE, BLUE, SUNSET];
    grid(lit, rows, (p, i) => scaleRgb(stripeCols[i % stripeCols.length]!, 0.78 + 1.2 * (p[1] - 0.14)));
    // The folded edge and the fringe at both short ends.
    for (let i = 0; i < NX; i++) {
      for (const s of [0, NZ]) {
        const a = rows[s]![i]!;
        const c = rows[s]![i + 1]!;
        lit.quad([a[0], a[1], a[2]], [c[0], c[1], c[2]], [c[0], 0.0, c[2] + (s === 0 ? -0.05 : 0.05)], [a[0], 0.0, a[2] + (s === 0 ? -0.05 : 0.05)], scaleRgb(stripeCols[s === 0 ? 0 : 7]!, 0.6));
      }
    }
    for (let k = 0; k < NZ; k++) {
      for (const s of [0, NX]) {
        const a = rows[k]![s]!;
        const c = rows[k + 1]![s]!;
        const sg = s === 0 ? -1 : 1;
        lit.quad([a[0], a[1], a[2]], [c[0], c[1], c[2]], [c[0] + sg * 0.05, 0.0, c[2]], [a[0] + sg * 0.05, 0.0, a[2]], scaleRgb(stripeCols[k]!, 0.6));
        for (let f = 0; f < 3; f++) {
          const z = a[2] + (c[2] - a[2]) * ((f + 0.5) / 3);
          lit.box(a[0] + sg * 0.45, 0.14, z, 0.8, 0.14, 0.2, scaleRgb(stripeCols[k]!, 0.9));
        }
      }
    }
    // Sunglasses, big round lenses: lying on the towel.
    const sx = -4.2;
    const sz = 1.0;
    for (const s of [-1, 1]) {
      torus(lit, 0.95, 0.14, { at: [sx + s * 1.25, 0.62, sz], facing: "y", ringSegments: 12, tubeSegments: 4, shade: rgb("#1a1a28") });
      lit.add(shapes.cylinder(12), xf(sx + s * 1.25, 0.58, sz, 0.93, 0.07, 0.93), ramp(rgb("#1a2a5a"), rgb("#4a78c8")));
      lit.rod([sx + s * 2.15, 0.7, sz], [sx + s * 3.0, 0.4, sz - 1.3], 0.16, rgb("#1a1a28"));
    }
    lit.box(sx, 0.7, sz, 0.8, 0.18, 0.2, rgb("#1a1a28"));
    // A bottle of sun lotion standing up.
    const bx = 3.1;
    const bz = -1.4;
    lit.add(shapes.cylinder(10), xf(bx, 1.15, bz, 0.52, 2.0, 0.52), ramp(scaleRgb(SUNSET, 0.8), SUNSET));
    lit.add(shapes.cylinder(10), xf(bx, 1.2, bz, 0.54, 0.7, 0.54), WHITE);
    lit.add(shapes.frustum(0.7, 10), xf(bx, 2.4, bz, 0.45, 0.5, 0.45), WHITE);
    lit.add(shapes.cylinder(10), xf(bx, 2.82, bz, 0.26, 0.35, 0.26), YELLOW);
    lit.blob(bx, 1.25, bz + 0.52, 0.2, 0.2, 0.05, YELLOW, 0);
    // A pair of flip-flops, one tipped over.
    for (const [x, z, yaw, c, tilt] of [[5.4, 1.6, 0.3, PINK, 0], [6.7, 2.4, -0.5, PINK, 0.35]] as const) {
      lit.blob(x, 0.35 + tilt, z, 0.7, 0.14, 1.5, ramp(scaleRgb(c, 0.8), c), 0, yaw);
      lit.blob(x, 0.3 + tilt, z, 0.62, 0.1, 1.4, WHITE, 0, yaw);
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      lit.rod([x + dx * 0.7, 0.55 + tilt, z + dz * 0.7], [x - 0.6 * dz, 0.7 + tilt, z + 0.6 * dx - dz * 0.0], 0.15, YELLOW);
      lit.rod([x + dx * 0.7, 0.55 + tilt, z + dz * 0.7], [x + 0.6 * dz, 0.7 + tilt, z - 0.6 * dx], 0.15, YELLOW);
    }
    // The beach ball, standing on the towel, and a little parasol in the corner.
    stamp(lit, beachBall(1.2), new Matrix4().makeTranslation(-1.2, 1.45, -2.0));
    const pp: V3 = [6.8, 0, -2.6];
    lit.rod([pp[0], 0, pp[2]], [pp[0] - 0.9, 6.0, pp[2] + 0.4], 0.18, WOOD);
    const canopy = new MeshBuilder();
    lathe(canopy, [[0, 1.1], [1.8, 0.9], [3.4, 0.2], [3.5, 0.0]], { segments: 8, shade: stripes(CORAL, WHITE) });
    stamp(lit, canopy, new Matrix4().compose(new Vector3(pp[0] - 0.9, 6.0, pp[2] + 0.4), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.16), new Vector3(1, 1, 1)));
    // A rolled towel pillow at the head.
    lit.box(-7.1, 0.9, -0.2, 3.4, 1.5, 1.9, ramp(scaleRgb(TURQUOISE, 0.7), TURQUOISE));
    lit.box(-7.1, 1.66, -0.2, 3.5, 0.1, 0.5, WHITE);
    return { lit };
  },
};

// ─── Giant ring ──────────────────────────────────────────────────────────────

/** A cut gem standing on its point: a crown of eight facets in blue and pink, with a flat table. */
function gem(b: MeshBuilder, glow: MeshBuilder, x: number, y: number, z: number, s: number, a: Rgb, c: Rgb): void {
  const g = new MeshBuilder();
  lathe(
    g,
    [[0.3, 0], [2.6, 2.1], [3.3, 2.7], [3.4, 3.2], [2.3, 5.0], [1.9, 5.2]],
    { segments: 8, scale: [1, 1, 0.8], shade: (p, _i, j) => mixRgb(j % 2 === 0 ? a : c, WHITE, 0.15 + 0.5 * Math.min(1, p[1] / 5.2)), caps: "top" },
  );
  stamp(b, g, new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(s, s, s)));
  glow.add(shapes.cylinder(8), xf(x, y + 5.22 * s, z, 1.7 * s, 0.1 * s, 1.36 * s), [2.2, 2.6, 3.4]);
}

LANDMARKS["giant-ring"] = {
  span: true,
  defaultSpan: 10,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halo[] = [];
    // Centre 9 m up, the band 3.3 m wide and 2.2 m deep: the opening is 25.7 m wide at road level and 24.7 m high.
    // The lower part sinks into the ground, so the band is only built down to just below the road.
    const C = 9;
    const RC = 16.8;
    const reach = (128 * Math.PI) / 180;
    const NSEG = 40;
    const prof: [number, number, number][] = [
      // radial offset, z, shade code (0 outer groove, 1 bevel, 2 inner, 3 flat)
      [1.1, 0.7, 0],
      [1.1, -0.7, 0],
      [0.85, -1.45, 1],
      [-0.85, -1.45, 1],
      [-1.1, -0.7, 2],
      [-1.1, 0.7, 2],
      [-0.85, 1.45, 1],
      [0.85, 1.45, 1],
    ];
    const rows: V3[][] = [];
    for (let i = 0; i <= NSEG; i++) {
      const th = -reach + (2 * reach * i) / NSEG; // from the top, either way round
      const sx = Math.sin(th);
      const cy = Math.cos(th);
      rows.push(prof.map(([dr, z]): V3 => [sx * (RC + dr), C + cy * (RC + dr), z]));
    }
    grid(
      lit,
      rows.map((r) => [...r, r[0]!]),
      (p, i, j) => {
        const kind = prof[j % prof.length]![2];
        const shine = 0.75 + 0.25 * Math.sin(i * 0.9) + (p[1] / 40) * 0.2;
        const base = kind === 0 ? GOLD_DARK : kind === 2 ? mixRgb(GOLD, GOLD_DARK, 0.4) : mixRgb(GOLD, WHITE, 0.18);
        return scaleRgb(base, shine);
      },
    );
    // The engraved groove: two fine ridges either side of the dark channel on the outer face.
    for (const z of [-0.45, 0.45]) {
      const path: V3[] = [];
      for (let i = 0; i <= NSEG; i++) {
        const th = -reach + (2 * reach * i) / NSEG;
        path.push([Math.sin(th) * (RC + 1.15), C + Math.cos(th) * (RC + 1.15), z]);
      }
      tube(lit, path, { radius: 0.15, sides: 4, shade: mixRgb(GOLD, WHITE, 0.4) });
    }
    // End caps, buried in the ground.
    for (const s of [-1, 1]) {
      const th = s * reach;
      lit.box(Math.sin(th) * RC, C + Math.cos(th) * RC, 0, 2.6, 2.6, 3.2, GOLD_DARK, 0, 0, -th);
    }
    // The setting: claws holding a big cut gem at the top, small stones on the shoulders.
    const topY = C + RC + 1.1;
    lit.box(0, topY + 0.6, 0, 6.6, 1.5, 3.4, ramp(GOLD_DARK, GOLD));
    for (const [cx, cz] of [[-2.6, -1.2], [2.6, -1.2], [-2.6, 1.2], [2.6, 1.2]] as const) lit.add(shapes.cone(5), xf(cx, topY + 2.2, cz, 0.55, 3.4, 0.55), ramp(GOLD_DARK, GOLD));
    gem(lit, glow, 0, topY + 1.3, 0, 1.15, BLUE, PINK);
    for (const [deg, a, c] of [[-24, PINK, BLUE], [24, BLUE, PINK], [-42, BLUE, PINK], [42, PINK, BLUE]] as const) {
      const th = (deg * Math.PI) / 180;
      const px = Math.sin(th) * (RC + 1.0);
      const py = C + Math.cos(th) * (RC + 1.0);
      lit.box(px, py, 0, 2.6, 1.0, 3.2, GOLD_DARK, 0, 0, -th);
      const g = new MeshBuilder();
      const gl = new MeshBuilder();
      gem(g, gl, 0, 0, 0, 0.42, a, c);
      stamp(lit, g, new Matrix4().compose(new Vector3(px + Math.sin(th) * 0.4, py + Math.cos(th) * 0.4, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -th), new Vector3(1, 1, 1)));
      stamp(glow, gl, new Matrix4().compose(new Vector3(px + Math.sin(th) * 0.4, py + Math.cos(th) * 0.4, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -th), new Vector3(1, 1, 1)));
    }
    // Sparkles: crossed glints over the gem.
    for (const [dx, dy, r] of [[-3.6, 3.8, 2.0], [3.8, 5.8, 1.5], [1.2, 8.6, 1.1]] as const) {
      glow.rod([dx - r, topY + dy, -1.9], [dx + r, topY + dy, -1.9], 0.18, [3.4, 3.4, 4]);
      glow.rod([dx, topY + dy - r, -1.9], [dx, topY + dy + r, -1.9], 0.18, [3.4, 3.4, 4]);
      halos.push({ x: dx, y: topY + dy, z: -2.2, size: 3.2, colour: [2.6, 2.8, 3.6], alpha: 0.8, twinkle: 0.9 });
    }
    halos.push({ x: 0, y: topY + 4.2, z: -2, size: 12, colour: [1.6, 2.0, 3.6], alpha: 0.45, twinkle: 0.7 });
    halos.push({ x: 0, y: topY + 4.2, z: 2, size: 12, colour: [3.2, 1.6, 2.8], alpha: 0.35, twinkle: 0.7 });
    return { lit, glow, halos };
  },
};

// ─── Wristwatch ──────────────────────────────────────────────────────────────

LANDMARKS.wristwatch = {
  span: true,
  defaultSpan: 14,
  build(ctx) {
    const hw = ctx.halfWidth;
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const CY = 23.5;
    const R = 11;
    const leather = byHeight(0, 16, rgb("#6a3418"), rgb("#b4672e"));
    const CHROME = rgb("#dfe6f2");
    // The straps: one arch of leather, stitched and holed, standing on both sides of the road and joining under the case.
    const inner = hw + 6;
    archBand(lit, { width: 2 * inner, height: 12, thickness: 3.4, depth: 1.4, legs: 2, segments: 16, shade: leather });
    const a = inner + 1.7;
    const bb = 12 + 1.7;
    const onStrap = (phi: number, off: number): { p: V3; ang: number } => {
      // Centre line (an ellipse over straight legs of 2 m) at angle phi from the right foot over the top.
      const ca = Math.cos(phi);
      const sa = Math.sin(phi);
      const ex = (a + off * 0.0) * ca;
      const ey = 2 + (bb - 2) * sa;
      const tx = -(a * sa);
      const ty = (bb - 2) * ca;
      const l = Math.hypot(tx, ty) || 1;
      const nx = ty / l;
      const ny = -tx / l;
      return { p: [ex + nx * off, ey + ny * off, 0], ang: Math.atan2(ty, tx) };
    };
    for (const edge of [-1.25, 1.25]) {
      for (let k = 1; k < 34; k++) {
        const phi = (k / 34) * Math.PI;
        const { p, ang } = onStrap(phi, edge);
        lit.box(p[0], p[1], -0.78, 0.7, 0.24, 0.12, rgb("#f3e2b8"), 0, 0, ang);
      }
    }
    // Holes along the left strap, near the buckle.
    for (let k = 0; k < 7; k++) {
      const phi = Math.PI * (0.62 + k * 0.045);
      const { p } = onStrap(phi, 0);
      lit.add(shapes.cylinder(8), xf(p[0], p[1], -0.74, 0.34, 0.1, 0.34, 0, Math.PI / 2), rgb("#2a1608"));
    }
    // The buckle at the apex: a gold frame with a prong, and the lugs that hold the case.
    lit.box(0, 13.4, -0.85, 5.0, 0.55, 0.35, GOLD);
    lit.box(0, 16.8, -0.85, 5.0, 0.55, 0.35, GOLD);
    lit.box(-2.3, 15.1, -0.85, 0.55, 3.9, 0.35, GOLD);
    lit.box(2.3, 15.1, -0.85, 0.55, 3.9, 0.35, GOLD);
    lit.rod([-1.8, 15.1, -1.1], [2.3, 15.1, -1.1], 0.3, GOLD_DARK);
    for (const s of [-1, 1]) lit.box(s * 5.6, 14.6, 0, 2.2, 4.4, 2.6, ramp(GOLD_DARK, CHROME), 0, 0, s * 0.35);

    // The case and bezel are turned about the case's own axis, then laid along z with the face toward the oncoming kart (-z).
    const loc = new MeshBuilder();
    lathe(loc, [[R * 0.88, -2.3], [R, -1.7], [R, 1.0], [R * 1.04, 1.3]], { segments: 30, shade: byHeight(-2.3, 1.3, rgb("#7d8aa6"), CHROME) });
    lathe(loc, [[R * 1.04, 0.9], [R * 1.06, 2.6], [R * 0.92, 3.0], [R * 0.9, 2.8]], { segments: 30, shade: stripes(CHROME, rgb("#aebbd6")) });
    lathe(loc, [[0, 1.15], [R * 0.9, 1.15]], { segments: 30, shade: rgb("#fff6dc"), caps: "top" });
    lathe(loc, [[R * 0.74, 1.2], [R * 0.9, 1.2], [R * 0.9, 1.3], [R * 0.74, 1.3]], { segments: 30, shade: rgb("#2d6fd8") });
    lathe(loc, [[0.0, 1.4], [0.9, 1.4], [0.9, 1.9], [0, 2.1]], { segments: 10, shade: GOLD });
    const caseM = new Matrix4().makeRotationX(-Math.PI / 2);
    caseM.setPosition(0, CY, 0);
    stamp(lit, loc, caseM);
    // The glass crystal over the dial.
    const gl = new MeshBuilder();
    lathe(gl, [[R * 0.9, 2.7], [R * 0.78, 3.4], [R * 0.5, 4.0], [R * 0.2, 4.3], [0, 4.35]], { segments: 30, shade: [0.8, 0.95, 1.2] });
    stamp(glass, gl, caseM);
    // The crown and pushers on the right side.
    lit.add(shapes.cylinder(10), xf(R + 0.9, CY, 0, 1.2, 1.7, 1.2, 0, 0, Math.PI / 2), ramp(GOLD_DARK, GOLD));
    lit.add(shapes.cylinder(10), xf(R + 1.9, CY, 0, 1.0, 0.9, 1.0, 0, 0, Math.PI / 2), CHROME);
    for (const s of [-1, 1]) lit.rod([Math.cos(s * 0.55) * (R + 0.2), CY + Math.sin(s * 0.55) * (R + 0.2), 0], [Math.cos(s * 0.55) * (R + 1.5), CY + Math.sin(s * 0.55) * (R + 1.5), 0], 0.7, CHROME);
    // The dial: hour blocks, four numerals, a minute track, and the hands at ten past ten.
    const DZ = -1.3;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * TAU;
      const big = k % 3 === 0;
      const r = big ? 8.7 : 8.9;
      lit.box(Math.sin(ang) * r, CY + Math.cos(ang) * r, DZ - 0.1, big ? 0.7 : 0.5, big ? 1.5 : 1.1, 0.3, big ? rgb("#1b3a8f") : rgb("#2d4aa8"), 0, 0, -ang);
    }
    const cell = 0.3;
    const digit = (ch: string, cx: number, cy: number): void => {
      const w = 5 * cell;
      blockDigits(lit, ch, cx - w / 2, cy - 3.5 * cell, DZ - 0.1, cell, rgb("#17235e"));
    };
    digit("3", R * 0.6 - 0.2, CY);
    digit("9", -(R * 0.6 - 0.2), CY);
    digit("6", 0, CY - R * 0.6 + 0.2);
    // "12" as two digits.
    blockDigits(lit, "1", -0.9 - 5 * cell * 0.5, CY + R * 0.6 - 0.2 - 3.5 * cell, DZ - 0.1, cell, rgb("#17235e"));
    blockDigits(lit, "2", 0.9 - 5 * cell * 0.5, CY + R * 0.6 - 0.2 - 3.5 * cell, DZ - 0.1, cell, rgb("#17235e"));
    const hand = (deg: number, len: number, tail: number, thick: number, z: number, c: Rgb): void => {
      const ang = (deg * Math.PI) / 180;
      const dx = Math.sin(ang);
      const dy = Math.cos(ang);
      lit.rod([-dx * tail, CY - dy * tail, z], [dx * len, CY + dy * len, z], thick, c);
      lit.rod([dx * len * 0.55, CY + dy * len * 0.55, z - 0.05], [dx * len, CY + dy * len, z - 0.05], thick * 0.5, mixRgb(c, WHITE, 0.5));
    };
    hand(305, 5.4, 1.4, 0.75, DZ - 0.55, rgb("#17235e"));
    hand(60, 8.0, 1.6, 0.5, DZ - 0.95, rgb("#17235e"));
    hand(160, 8.6, 2.0, 0.2, DZ - 1.25, RED);
    lit.blob(0, CY, DZ - 1.35, 0.55, 0.55, 0.3, GOLD, 0);
    // A tiny logo window and a date window.
    lit.box(0, CY - 3.2, DZ - 0.1, 2.0, 1.1, 0.2, WHITE);
    const halos: Halo[] = [];
    halos.push({ x: 0, y: CY + 6, z: -4.6, size: 7, colour: [2.4, 2.6, 3.2], alpha: 0.35, twinkle: 0.5 });
    return { lit, glow, glass, halos };
  },
};

/** 5 x 7 block digits (1 2 3 6 9) as boxes, reading left to right along +x. */
const DIGITS: Record<string, readonly (readonly [number, number, number, number])[]> = {
  "1": [[2, 0, 3, 7], [1, 5, 2, 6], [1, 0, 4, 1]],
  "2": [[0, 6, 5, 7], [4, 4, 5, 6], [0, 3, 5, 4], [0, 1, 1, 3], [0, 0, 5, 1]],
  "3": [[0, 6, 5, 7], [1, 3, 5, 4], [0, 0, 5, 1], [4, 0, 5, 7]],
  "6": [[0, 0, 1, 7], [1, 6, 5, 7], [1, 3, 5, 4], [1, 0, 5, 1], [4, 1, 5, 3]],
  "9": [[4, 0, 5, 7], [0, 6, 4, 7], [0, 3, 4, 4], [0, 4, 1, 6], [0, 0, 4, 1]],
};

function blockDigits(b: MeshBuilder, ch: string, x: number, y: number, z: number, cell: number, col: Rgb): void {
  for (const [c0, r0, c1, r1] of DIGITS[ch] ?? []) {
    b.box(x + ((c0 + c1) / 2) * cell, y + ((r0 + r1) / 2) * cell, z, (c1 - c0) * cell, (r1 - r0) * cell, 0.25, col);
  }
}

// ─── Hazards ─────────────────────────────────────────────────────────────────

HAZARDS.coconut = {
  build(ctx) {
    const b = new MeshBuilder();
    // A hairy brown nut: a lumpy ball with a pale husk patch, three dark eyes and a few stray fibres.
    rockBlob(b, 0, 0, 0, 0.9, 0.88, 0.9, byHeight(-0.9, 0.9, rgb("#4a2c14"), rgb("#8a5a30")), 3, { detail: 1, roughness: 0.1 });
    b.blob(0.2, 0.55, 0.72, 0.42, 0.34, 0.2, ramp(rgb("#d9b878"), rgb("#f3dcaa")), 0);
    for (const [x, y, z] of [[-0.18, 0.74, 0.5], [0.18, 0.86, 0.38], [0.0, 0.62, 0.66]] as const) b.blob(x * 1.1, y, z, 0.1, 0.1, 0.07, DARK, 0);
    for (let k = 0; k < 9; k++) {
      const a = hash(k + 3) * TAU;
      const y = (hash(k + 9) - 0.5) * 1.6;
      const r = Math.sqrt(Math.max(0.05, 1 - y * y));
      const x = Math.cos(a) * r * 0.9;
      const z = Math.sin(a) * r * 0.9;
      b.rod([x, y, z], [x * 1.12, y * 1.12 + 0.05, z * 1.12], 0.16, rgb("#7a4a22"));
    }
    const inner = new Group();
    inner.add(new Mesh(b.build(), ctx.lit));
    const root = new Group();
    root.add(inner);
    return {
      root,
      radius: 0.9,
      update(s) {
        // Rolling along +z: the turn is the distance over the radius, with a small hop on each half turn.
        inner.rotation.x = s.travel / 0.9;
        inner.position.y = 0.9 + 0.12 * Math.abs(Math.sin(s.travel / 0.9));
      },
    };
  },
};

HAZARDS["beach-ball"] = {
  build(ctx) {
    const b = beachBall(1.4);
    const inner = new Group();
    inner.add(new Mesh(b.build(), ctx.lit));
    const root = new Group();
    root.add(inner);
    return {
      root,
      radius: 1.4,
      update(s) {
        inner.rotation.x = s.travel / 1.4;
        inner.position.y = 1.4 + 0.1 * Math.abs(Math.sin(s.travel / 1.4 * 0.5));
      },
    };
  },
};

