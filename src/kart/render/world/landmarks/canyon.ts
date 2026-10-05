/**
 * The canyon world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build").
 * Canyon Run: the warm last hour of the day, red sandstone, dust and big skies.
 *
 * `boulder` is defined once, here, and also serves the volcano (a black rock cracked with lava).
 */
import { Group, Mesh, type Material } from "three";
import { byHeight, grid, lathe, MeshBuilder, mixRgb, pipe, ramp, rgb, rockBlob, scaleRgb, shapes, torus, tube, xf, type Rgb, type Shade, type V3 } from "./kit";
import { beam, drift, flutedPipe, hash, hazardGlass, noisyArch, taper, vec } from "./snow";
import type { HazardSpec, LandmarkSpec } from "./types";

type Halo = { x: number; y: number; z: number; size: number; colour: readonly [number, number, number]; alpha: number; twinkle?: number };

// ─── Palette ─────────────────────────────────────────────────────────────────

const CREAM = rgb("#ecd3a2");
const SAND = rgb("#e0b578");
const ORANGE = rgb("#d9783a");
const RED = rgb("#b04a2a");
const DEEP_RED = rgb("#8a3524");
const TAN = rgb("#d9a066");
const CAP = rgb("#6b3a2e");
const DUST = rgb("#d9b680");
const STRATA = [CREAM, ORANGE, RED, TAN, DEEP_RED, SAND, ORANGE, CAP];

/** Sandstone bands by height: each band a different colour, so a rock reads as layered at any size. */
function strataShade(seed: number, band = 2.6, tone = 1): Shade {
  return (p, i, j) => {
    const k = Math.floor(p[1] / band + hash(Math.floor(p[1] / band), seed) * 0.8);
    const c = STRATA[Math.abs(k) % STRATA.length]!;
    // Every facet is nudged a little, and the foot is darker (dust and shade).
    const foot = 0.7 + 0.3 * Math.min(1, Math.max(0, p[1] / 6));
    return scaleRgb(c, tone * foot * (0.9 + 0.2 * hash(i, j, seed + 3)));
  };
}

// ─── Mesa ────────────────────────────────────────────────────────────────────

interface Layer {
  h: number;
  col: Rgb;
  /** Radius of this layer's wall, as a fraction of the mesa's base radius: hard rock juts out, soft rock is cut back. */
  r: number;
  /** How much the wall leans in over its height (soft rock slumps; hard rock stands sheer). */
  batter?: number;
}

/** A ring of `n` points about (cx, cz), uneven and stretched along x. */
function mesaRing(cx: number, cz: number, r: number, y: number, stretch: number, seed: number, n = 13, jitter = 0): V3[] {
  const out: V3[] = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2 + (hash(j, seed, 9) - 0.5) * 0.18;
    const m = 0.84 + 0.3 * hash(j, seed, 1) + (jitter ? (hash(j, seed, Math.floor(y)) - 0.5) * jitter : 0);
    out.push([cx + Math.cos(a) * r * m * stretch, y, cz + Math.sin(a) * r * m]);
  }
  return out;
}

/** A flat-topped butte of strata: ledges, a talus apron at the foot, a darker cap, and cracks. Returns the top ring. */
function mesaBody(lit: MeshBuilder, cx: number, cz: number, baseR: number, strata: Layer[], stretch: number, seed: number): void {
  const n = 13;
  let y = 0;
  // The talus: a sloping apron of fallen rock round the foot.
  const talusH = strata.reduce((a, l) => a + l.h, 0) * 0.24;
  const tBot = mesaRing(cx, cz, baseR * 1.26, -2, stretch, seed, n, 0.1);
  const tMid = mesaRing(cx, cz, baseR * 1.12, talusH * 0.45, stretch, seed, n, 0.1);
  const tTop = mesaRing(cx, cz, baseR * 1.0, talusH, stretch, seed, n, 0.06);
  const talusShade: Shade = (p, i, j) => scaleRgb(mixRgb(scaleRgb(DUST, 0.8), RED, Math.max(0, Math.min(1, p[1] / talusH))), 0.78 + 0.3 * hash(i, j, seed + 5));
  grid(lit, [tBot, tMid, tTop], talusShade, true);
  y = talusH;
  let r = baseR;
  const rings: V3[][] = [tTop];
  strata.forEach((l, li) => {
    const rr = baseR * l.r;
    const rTop = rr * (1 - (l.batter ?? 0.012));
    const bot = mesaRing(cx, cz, rr, y, stretch, seed, n, 0.03);
    const top = mesaRing(cx, cz, rTop, y + l.h, stretch, seed, n, 0.03);
    // The step from the layer below to this one: a ledge if this layer is cut back, an overhang if it juts.
    const prevTop = rings[rings.length - 1]!;
    const prevR = li === 0 ? baseR : baseR * strata[li - 1]!.r * (1 - (strata[li - 1]!.batter ?? 0.012));
    if (Math.abs(rr - prevR) > 0.3) {
      const prevCol = li === 0 ? ORANGE : strata[li - 1]!.col;
      grid(lit, [prevTop, bot], rr < prevR ? scaleRgb(mixRgb(prevCol, SAND, 0.55), 1.1) : scaleRgb(prevCol, 0.5), true);
    }
    grid(lit, [bot, top], (p, i, j) => scaleRgb(l.col, (0.72 + 0.34 * ((p[1] - y) / l.h)) * (0.92 + 0.16 * hash(i, j, seed + li))), true);
    rings.push(top);
    y += l.h;
    r = rTop;
  });
  // The cap: a plate of dark rock on top, with a few boulders and a pinnacle or two.
  const lastRing = mesaRing(cx, cz, r, y, stretch, seed, n, 0.03);
  const c: V3 = [cx, y, cz];
  for (let j = 0; j < n; j++) {
    const p = lastRing[j]!;
    const q = lastRing[(j + 1) % n]!;
    lit.tri(c, q, p, scaleRgb(CAP, 1.25), scaleRgb(CAP, 1.1), scaleRgb(CAP, 1.1));
  }
  for (let k = 0; k < 5; k++) {
    const a = k * 1.7 + seed;
    const rr = r * (0.2 + 0.5 * hash(k, seed, 4));
    rockBlob(lit, cx + Math.cos(a) * rr * stretch, y, cz + Math.sin(a) * rr, 3 + hash(k, seed, 5) * 3, 2.2 + hash(k, seed, 6) * 2, 3, scaleRgb(CAP, 1.4), k + seed, { detail: 1, roughness: 0.25, flatBase: true });
  }
  lit.add(shapes.cone(5), xf(cx + r * 0.3 * stretch, y + 5, cz - r * 0.2, 2.6, 10, 2.4, seed), ramp(scaleRgb(RED, 0.8), TAN));
  // Cracks: dark slits running down the faces, a hair proud of the rock.
  for (let k = 0; k < 7; k++) {
    const j = Math.floor(hash(k, seed, 11) * n);
    const li = 1 + Math.floor(hash(k, seed, 12) * Math.max(1, rings.length - 3));
    const len = Math.min(rings.length - 1 - li, 1 + Math.floor(hash(k, seed, 13) * 3));
    for (let m = 0; m < len; m++) {
      const lo = rings[li + m]!;
      const hi = rings[li + m + 1]!;
      const a0 = vec.lerp(lo[j]!, lo[(j + 1) % n]!, 0.5);
      const a1 = vec.lerp(hi[j]!, hi[(j + 1) % n]!, 0.5);
      const out = vec.norm([a0[0] - cx, 0, a0[2] - cz]);
      const side = vec.norm(vec.cross([0, 1, 0], out));
      const w = 0.28;
      const off = vec.mul(out, 0.18);
      lit.quad(vec.add(vec.add(a0, off), vec.mul(side, -w)), vec.add(vec.add(a0, off), vec.mul(side, w)), vec.add(vec.add(a1, off), vec.mul(side, w * 0.6)), vec.add(vec.add(a1, off), vec.mul(side, -w * 0.6)), [0.07, 0.03, 0.02]);
    }
  }
  // Fallen rock on the talus.
  for (let k = 0; k < 10; k++) {
    const a = k * 0.66 + hash(k, seed, 14);
    const rr = baseR * (1.25 + 0.3 * hash(k, seed, 15));
    const s = 1.6 + hash(k, seed, 16) * 2.6;
    rockBlob(lit, cx + Math.cos(a) * rr * stretch, 0, cz + Math.sin(a) * rr, s, s * 0.8, s, strataShade(seed + k, 1.6, 0.9), k + seed, { detail: 1, roughness: 0.25, flatBase: true });
  }
}

const mesa: LandmarkSpec = {
  footprint: 52,
  build() {
    const lit = new MeshBuilder();
    const strata: Layer[] = [
      { h: 6, col: CREAM, r: 0.93, batter: 0.06 },
      { h: 5, col: ORANGE, r: 1.0 },
      { h: 7, col: RED, r: 1.04 },
      { h: 4, col: TAN, r: 0.92, batter: 0.07 },
      { h: 6, col: DEEP_RED, r: 1.0 },
      { h: 3, col: SAND, r: 0.9, batter: 0.06 },
      { h: 5, col: ORANGE, r: 0.98 },
      { h: 4, col: RED, r: 1.02 },
      { h: 3, col: CAP, r: 1.07, batter: 0 },
    ];
    mesaBody(lit, 0, 0, 33, strata, 1.3, 1);
    // A small butte beside it, a few strata only, standing a little apart.
    mesaBody(lit, -66, 14, 10, [{ h: 5, col: CREAM, r: 0.92, batter: 0.06 }, { h: 6, col: ORANGE, r: 1.0 }, { h: 6, col: RED, r: 1.05 }, { h: 3, col: CAP, r: 1.1, batter: 0 }], 0.9, 7);
    return { lit };
  },
};

// ─── Rock arch ───────────────────────────────────────────────────────────────

const rockArch: LandmarkSpec = {
  span: true,
  defaultSpan: 34,
  build(ctx) {
    const lit = new MeshBuilder();
    const hw = Math.max(13, ctx.halfWidth + 6);
    const top = 15.5;
    const legs = 3.5;
    const half = ctx.span / 2;
    // Fatter on one leg than the other, and tucked in at the ends, so it is plainly not made by a machine.
    const thick = (t: number, zt: number) => (3.4 + 2.8 * Math.sin(Math.PI * t)) * (0.62 + 0.7 * t) * (0.6 + 0.4 * Math.pow(Math.sin(Math.PI * zt), 0.5));
    noisyArch(lit, { halfIn: hw, topIn: top, legs, thick, z0: -half, z1: half, steps: Math.max(5, Math.round(ctx.span / 4)), arcSteps: 14, rough: 0.7, seed: 6, skirt: 3, inner: strataShade(2, 2.4, 1.0), outer: strataShade(9, 2.6, 1.1) });
    // A keystone-like block wedged on the crown, tilted, and a smaller one beside it.
    const crownY = top + thick(0.5, 0.5) - 0.5;
    rockBlob(lit, 1.5, crownY + 0.2, 0, 5.2, 3.6, 5.6, strataShade(61, 1.6, 1.05), 3, { detail: 1, roughness: 0.22, flatBase: true, yaw: 0.25 });
    rockBlob(lit, -5.5, crownY - 0.4, 4, 2.8, 1.9, 3, strataShade(62, 1.4, 1.0), 4, { detail: 1, roughness: 0.25, flatBase: true, yaw: -0.4 });
    // A split-off pinnacle and rubble at the feet.
    lit.add(shapes.cone(6), xf(hw + 7, 6, -half * 0.35, 3.2, 12, 3.0, 0.4), ramp(scaleRgb(RED, 0.8), TAN));
    for (let k = 0; k < 9; k++) {
      const s = k % 2 === 0 ? -1 : 1;
      const rr = 2 + hash(k, 1) * 2.8;
      rockBlob(lit, s * (hw + 3.8 + hash(k, 2) * 4), 0, (hash(k, 3) - 0.5) * half * 1.7, rr, rr * 0.8, rr, strataShade(20 + k, 1.4, 0.95), k + 5, { detail: 1, roughness: 0.25, flatBase: true });
    }
    for (const s of [-1, 1]) drift(lit, s * (hw + 8), -half * 0.5 * s, 4.5, 1.1, 3.2, byHeight(0, 1.2, scaleRgb(DUST, 0.8), DUST), 5 + s);
    return { lit };
  },
};

// ─── Cactus grove ────────────────────────────────────────────────────────────

const CACTUS_DARK = rgb("#1d5a3a");
const CACTUS_LIGHT = rgb("#4e9c5e");

/** Green with darker valleys between the ribs (odd columns), lighter toward the top. */
const cactusShade = (y0: number, y1: number): ((p: V3, i: number, j: number) => Rgb) => (p, _i, j) => {
  const t = Math.max(0, Math.min(1, (p[1] - y0) / (y1 - y0 || 1)));
  return scaleRgb(mixRgb(CACTUS_DARK, CACTUS_LIGHT, t * 0.8 + 0.1), j % 2 === 0 ? 1.1 : 0.78);
};

function saguaro(lit: MeshBuilder, x: number, z: number, h: number, seed: number): void {
  const r = 0.75 + h * 0.035;
  flutedPipe(lit, [x, -0.6, z], [x, h, z], r, 6, cactusShade(0, h), r * 0.82, false);
  lit.blob(x, h, z, r * 0.82, r * 0.9, r * 0.82, ramp(CACTUS_LIGHT, scaleRgb(CACTUS_LIGHT, 1.15)), 1);
  const arms = h > 9 ? 2 : h > 7 ? 1 + Math.floor(hash(seed, 1) * 2) : 0 + Math.floor(hash(seed, 2) * 2);
  for (let k = 0; k < arms; k++) {
    const s = (k + seed) % 2 === 0 ? 1 : -1;
    const ya = h * (0.38 + 0.2 * hash(seed, k, 3));
    const La = 1.7 + hash(seed, k, 4) * 1.3;
    const Ha = 2.4 + hash(seed, k, 5) * Math.min(4.5, h * 0.35);
    const ar = r * 0.68;
    const elbow: V3 = [x + s * La, ya + 0.35, z];
    flutedPipe(lit, [x + s * (r - 0.15), ya, z], elbow, ar, 5, cactusShade(0, h), ar, false);
    lit.blob(elbow[0], elbow[1], elbow[2], ar * 1.02, ar * 1.02, ar * 1.02, cactusShade(0, h)([0, ya, 0], 0, 0), 0);
    const tip: V3 = [elbow[0], elbow[1] + Ha, elbow[2]];
    flutedPipe(lit, elbow, tip, ar, 5, cactusShade(0, h), ar * 0.85, false);
    lit.blob(tip[0], tip[1], tip[2], ar * 0.85, ar * 0.95, ar * 0.85, ramp(CACTUS_LIGHT, scaleRgb(CACTUS_LIGHT, 1.15)), 1);
    // Red blossoms on some tips.
    if (hash(seed, k, 6) > 0.35) {
      for (let f = 0; f < 5; f++) {
        const a = (f / 5) * Math.PI * 2;
        lit.blob(tip[0] + Math.cos(a) * 0.42, tip[1] + ar * 0.85 + 0.12, tip[2] + Math.sin(a) * 0.42, 0.3, 0.2, 0.3, rgb("#e0343a"), 0);
      }
      lit.blob(tip[0], tip[1] + ar * 0.85 + 0.3, tip[2], 0.26, 0.22, 0.26, rgb("#ffd34d"), 0);
    }
  }
}

function barrelCactus(lit: MeshBuilder, x: number, z: number, r: number): void {
  flutedPipe(lit, [x, -0.2, z], [x, r * 1.4, z], r, 7, cactusShade(0, r * 1.6), r * 0.8, false);
  lit.blob(x, r * 1.4, z, r * 0.8, r * 0.5, r * 0.8, ramp(CACTUS_LIGHT, scaleRgb(CACTUS_LIGHT, 1.2)), 1);
  for (let f = 0; f < 6; f++) {
    const a = (f / 6) * Math.PI * 2;
    lit.blob(x + Math.cos(a) * r * 0.45, r * 1.9, z + Math.sin(a) * r * 0.45, 0.24, 0.2, 0.24, rgb("#ffcf3f"), 0);
  }
}

function pricklyPear(lit: MeshBuilder, x: number, z: number, seed: number): void {
  const pads: [number, number, number, number][] = [[0, 1.0, 0, 0.1], [0.5, 2.4, 0, -0.45], [-0.7, 2.2, 0.1, 0.55], [1.5, 3.4, -0.1, -0.2]];
  pads.forEach(([dx, dy, dz, tilt], k) => {
    lit.add(shapes.ball(1), xf(x + dx * 1.1, dy, z + dz, 0.95, 1.05, 0.2, seed + k, 0, tilt), ramp(scaleRgb(CACTUS_DARK, 1.1), rgb("#58a66a")));
    lit.blob(x + dx * 1.1 + 0.3, dy + 0.9, z + dz + 0.2, 0.2, 0.2, 0.2, rgb("#c0283a"), 0); // a fruit
  });
}

const cactusGrove: LandmarkSpec = {
  footprint: 15,
  build(ctx) {
    const lit = new MeshBuilder();
    const n = 6 + Math.floor(ctx.rnd() * 4);
    const spots: [number, number, number][] = [[0, 0, 14], [-6.5, 3.5, 11], [6, 4, 9.5], [-3.5, -6, 12.5], [4.5, -6.5, 8], [-11, -2.5, 7], [11, -1, 10.5], [0, 8, 6.5], [-8.5, 8, 7.5]];
    for (let k = 0; k < n; k++) {
      const [x, z, h] = spots[k]!;
      saguaro(lit, x, z, h * (0.92 + ctx.rnd() * 0.16), k + 1);
    }
    barrelCactus(lit, 3.2, 9.5, 1.2);
    barrelCactus(lit, -5, 11, 0.9);
    pricklyPear(lit, 8.5, 9, 3);
    pricklyPear(lit, -12.5, 6, 8);
    // A bleached cow skull on a rock.
    rockBlob(lit, -1.5, 0, 12.5, 2.2, 1.1, 1.8, byHeight(0, 1.3, scaleRgb(RED, 0.8), SAND), 3, { detail: 1, roughness: 0.2, flatBase: true });
    const BONE = rgb("#efe6d0");
    lit.blob(-1.5, 1.9, 12.8, 0.55, 0.5, 0.95, ramp(scaleRgb(BONE, 0.8), BONE), 1, 0.3);
    lit.blob(-1.55, 1.75, 13.55, 0.34, 0.3, 0.4, BONE, 0, 0.3);
    for (const s of [-1, 1]) {
      lit.blob(-1.5 + s * 0.3, 2.1, 13.0, 0.17, 0.2, 0.1, [0.05, 0.03, 0.02], 0, 0.3);
      const horn: V3[] = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        horn.push([-1.5 + s * (0.5 + t * 1.1), 2.15 + Math.sin(t * Math.PI * 0.85) * 0.9, 12.7 - t * 0.2]);
      }
      tube(lit, horn, { radius: (t) => 0.2 - 0.05 * t, sides: 5, shade: BONE, caps: true });
    }
    // Sand drifted about, dry tufts and scattered stones.
    for (let k = 0; k < 6; k++) drift(lit, (hash(k, 1) - 0.5) * 30, (hash(k, 2) - 0.5) * 24 + 2, 3.5 + hash(k, 3) * 2, 0.5, 2.5, byHeight(0, 0.6, scaleRgb(DUST, 0.8), DUST), k + 70);
    for (let k = 0; k < 8; k++) lit.add(shapes.cone(5), xf((hash(k, 4) - 0.5) * 28, 0.6, (hash(k, 5) - 0.5) * 22 + 3, 0.6, 1.2, 0.6, k), rgb("#c9a45a"));
    for (let k = 0; k < 7; k++) rockBlob(lit, (hash(k, 6) - 0.5) * 30, 0, (hash(k, 7) - 0.5) * 24 + 2, 0.9, 0.6, 0.8, strataShade(30 + k, 1, 1), k, { detail: 0, roughness: 0.3, flatBase: true });
    return { lit };
  },
};

// ─── Water tower ─────────────────────────────────────────────────────────────

const waterTower: LandmarkSpec = {
  footprint: 8,
  build() {
    const lit = new MeshBuilder();
    const PAINT = rgb("#b03a2c");
    const BARE = rgb("#8c6b4a");
    const IRON = rgb("#3a3430");
    /** Peeling red paint: mostly red, with patches of bare grey-brown wood showing through. */
    const peel = (seed: number, p = 0.3): Rgb => (hash(seed, 1) < p ? BARE : mixRgb(scaleRgb(PAINT, 0.8), PAINT, hash(seed, 2)));
    const base = 4.3;
    const topH = 3.5;
    const platY = 12.4;
    const corner = (sx: number, sz: number, y: number): V3 => {
      const k = (y + 1) / (platY + 1);
      const h = base + (topH - base) * k;
      return [sx * h, y, sz * h];
    };
    const levels = [-1, 3.3, 7.2, 10.2, platY];
    // Four slightly splayed legs, each in logs painted and peeling.
    let sd = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let k = 0; k < levels.length - 1; k++) {
          const a = corner(sx, sz, levels[k]!);
          const c = corner(sx, sz, levels[k + 1]!);
          beam(lit, a, c, 0.6, 0.6, [1, 0, 0], scaleRgb(peel(sd), 0.75), peel(sd++));
        }
        lit.box(sx * (base + 0.4), -0.5, sz * (base + 0.4), 1.5, 1.4, 1.5, ramp(rgb("#4d4a48"), rgb("#7b7774"))); // a stone footing
      }
    }
    const faces: [[number, number], [number, number]][] = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
    for (let k = 0; k < levels.length; k++) {
      for (const [a, b] of faces) beam(lit, corner(a[0], a[1], levels[k]!), corner(b[0], b[1], levels[k]!), 0.4, 0.4, [0, 1, 0], peel(sd++, 0.4));
      if (k < levels.length - 1) {
        for (const [a, b] of faces) {
          beam(lit, corner(a[0], a[1], levels[k]!), corner(b[0], b[1], levels[k + 1]!), 0.28, 0.28, [0, 1, 0], BARE);
          beam(lit, corner(b[0], b[1], levels[k]!), corner(a[0], a[1], levels[k + 1]!), 0.28, 0.28, [0, 1, 0], scaleRgb(BARE, 0.85));
        }
      }
    }
    // The deck under the tank.
    lit.box(0, platY + 0.25, 0, topH * 2 + 1.6, 0.5, topH * 2 + 1.6, ramp(rgb("#6b4a32"), rgb("#9a7550")));
    // The barrel: turned on a lathe, red staves with bare patches, iron hoops round it, and a conical roof.
    const prof: [number, number][] = [[0, platY + 0.5], [3.7, platY + 0.5], [4.25, platY + 1.6], [4.5, platY + 4.4], [4.3, platY + 6.6], [3.8, platY + 7.1], [0, platY + 7.1]];
    lathe(lit, prof, { segments: 16, shade: (p, i, j) => (hash(j, Math.floor(p[1]), 5) < 0.28 ? scaleRgb(BARE, 0.9 + 0.2 * hash(i, j)) : scaleRgb(PAINT, (j % 2 === 0 ? 1 : 0.85) * (0.85 + 0.25 * hash(i, j, 3)))) });
    for (const [y, r] of [[platY + 1.9, 4.3], [platY + 3.6, 4.58], [platY + 5.5, 4.5]] as const) torus(lit, r, 0.22, { at: [0, y, 0], facing: "y", ringSegments: 16, tubeSegments: 4, shade: IRON });
    lit.add(shapes.cone(16), xf(0, platY + 7.1 + 1.9, 0, 5.1, 3.8, 5.1), ramp(scaleRgb(PAINT, 0.55), scaleRgb(PAINT, 0.95)));
    lit.post(0, platY + 7.1 + 3.6, 0, 0.18, 1.4, IRON, 5);
    // The ladder up the front, and the dangling spout.
    for (const s of [-0.7, 0.7]) beam(lit, [s, -1, base + 0.2], [s, platY, topH + 0.2], 0.22, 0.22, [1, 0, 0], BARE);
    for (let k = 0; k < 17; k++) {
      const y = -0.6 + k * 0.77;
      const z = base + 0.2 + (topH - base) * ((y + 1) / (platY + 1));
      lit.box(0, y, z, 1.5, 0.16, 0.18, scaleRgb(BARE, 1.1));
    }
    pipe(lit, [-2.4, platY + 1.2, 4.45], [-2.4, platY - 2.8, 4.45], 0.26, IRON, 6);
    lit.add(shapes.cone(6), xf(-2.4, platY - 3.5, 4.45, 0.6, -1.4, 0.6), IRON);
    beam(lit, [-2.4, platY - 4.2, 4.45], [-2.4, platY - 6.4, 4.45], 0.12, 0.12, [1, 0, 0], rgb("#6b5a48")); // a rope
    lit.blob(-2.4, platY - 6.6, 4.45, 0.3, 0.3, 0.3, IRON, 0);
    drift(lit, 0, 7, 6, 0.5, 4, byHeight(0, 0.6, scaleRgb(DUST, 0.8), DUST), 11);
    for (let k = 0; k < 5; k++) lit.add(shapes.cone(5), xf((hash(k, 8) - 0.5) * 12, 0.6, (hash(k, 9) - 0.5) * 12, 0.6, 1.3, 0.6, k), rgb("#c9a45a"));
    return { lit };
  },
};

// ─── Mine cart ───────────────────────────────────────────────────────────────

const mineCart: LandmarkSpec = {
  footprint: 17,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const RUST = rgb("#9a5230");
    const RUST_DARK = rgb("#5e3524");
    const IRON = rgb("#4a4440");
    const TIMBER = rgb("#7a5230");
    const TIMBER_DARK = rgb("#4a3020");
    const gauge = 1.15;
    // Rails and sleepers: thirty metres of track, half buried in gravel.
    drift(lit, 0, 0, 17, 0.55, 3.0, byHeight(0, 0.55, scaleRgb(DUST, 0.75), DUST), 3);
    for (let x = -14.4; x <= 14.5; x += 1.45) lit.box(x, 0.28, 0, 0.45, 0.3, gauge * 2 + 1.5, ramp(TIMBER_DARK, TIMBER));
    for (const s of [-1, 1]) beam(lit, [-15, 0.62, s * gauge], [15, 0.62, s * gauge], 0.26, 0.32, [0, 0, 1], scaleRgb(IRON, 1.3));
    // The buffer stop at the far end.
    lit.box(15.2, 0.9, 0, 0.7, 1.4, gauge * 2 + 1.2, ramp(TIMBER_DARK, TIMBER));
    // The cart: tapered body in rust with iron straps and a rim, ore heaped above.
    const cx = 2.5;
    taper(lit, cx, 0, 0.95, 2.6, 2.1, 0.95, 2.5, 1.4, scaleRgb(RUST_DARK, 1.2), RUST, 0, false);
    for (const sx of [-1.7, -0.6, 0.6, 1.7]) {
      lit.box(cx + sx * 1.15, 1.75, 1.18 - Math.abs(sx) * 0.02, 0.28, 1.6, 0.18, IRON);
      lit.box(cx + sx * 1.15, 1.75, -1.18 + Math.abs(sx) * 0.02, 0.28, 1.6, 0.18, IRON);
    }
    for (const sz of [-1, 1]) {
      beam(lit, [cx - 2.55, 2.66, sz * 1.45], [cx + 2.55, 2.66, sz * 1.45], 0.3, 0.22, [0, 0, 1], IRON);
    }
    for (const sx of [-1, 1]) beam(lit, [cx + sx * 2.55, 2.66, -1.45], [cx + sx * 2.55, 2.66, 1.45], 0.3, 0.22, [1, 0, 0], IRON);
    for (let k = 0; k < 9; k++) lit.blob(cx - 2.2 + k * 0.55, 2.25, 1.46, 0.09, 0.09, 0.09, scaleRgb(IRON, 1.5), 0); // rivets
    // Wheels on axles, and a coupling hook.
    for (const wx of [-1.5, 1.5]) {
      beam(lit, [cx + wx, 0.75, -gauge - 0.3], [cx + wx, 0.75, gauge + 0.3], 0.16, 0.16, [1, 0, 0], IRON);
      for (const s of [-1, 1]) {
        lit.add(shapes.cylinder(10), xf(cx + wx, 0.75, s * gauge, 0.62, 0.22, 0.62, 0, Math.PI / 2), IRON);
        lit.add(shapes.cylinder(6), xf(cx + wx, 0.75, s * (gauge + 0.13), 0.25, 0.14, 0.25, 0, Math.PI / 2), scaleRgb(RUST, 0.9));
      }
    }
    lit.box(cx + 2.9, 1.4, 0, 0.7, 0.18, 0.18, IRON);
    // Ore: gold and orange lumps heaped over the rim, with a few bright glints.
    const ORE = [rgb("#e0a52a"), rgb("#f0b830"), rgb("#d98a22"), rgb("#f4c84a")];
    for (let k = 0; k < 18; k++) {
      const x = cx - 2.0 + (k % 6) * 0.8 + (hash(k, 1) - 0.5) * 0.4;
      const z = -0.9 + Math.floor(k / 6) * 0.9 + (hash(k, 2) - 0.5) * 0.3;
      const hgt = 2.6 + 0.6 * (1 - Math.abs(x - cx) / 2.4) * (1 - Math.abs(z) / 1.3) + hash(k, 3) * 0.35;
      const s = 0.45 + hash(k, 4) * 0.3;
      rockBlob(lit, x, hgt, z, s, s * 0.85, s, byHeight(hgt - s, hgt + s, scaleRgb(ORE[k % 4]!, 0.75), ORE[k % 4]!), k + 2, { detail: 0, roughness: 0.25 });
    }
    for (let k = 0; k < 6; k++) glow.add(shapes.ball(0), xf(cx - 1.8 + k * 0.75, 3.35 + hash(k, 5) * 0.4, (hash(k, 6) - 0.5) * 1.6, 0.16, 0.16, 0.16, k), [3.4, 2.8, 1.1]);
    // The mine mouth: a rock face with a black opening, a timber frame, a hanging lantern and a pickaxe.
    const mx = -13.5;
    rockBlob(lit, mx - 9.5, 0, 0, 7.5, 7.6, 9.5, strataShade(40, 2.2, 0.95), 4, { detail: 1, roughness: 0.2, flatBase: true });
    rockBlob(lit, mx - 7.5, 0, 7.5, 4.5, 4.2, 4, strataShade(43, 2, 0.9), 5, { detail: 1, roughness: 0.2, flatBase: true });
    lit.box(mx - 0.6, 2.6, 0, 0.5, 5.2, gauge * 2 + 2.1, [0.01, 0.008, 0.008]);
    for (const s of [-1, 1]) {
      lit.post(mx, -0.6, s * (gauge + 1.3), 0.4, 6.4, ramp(TIMBER_DARK, TIMBER), 6);
      beam(lit, [mx, 0.5, s * (gauge + 1.3)], [mx, 4.4, s * (gauge + 0.1)], 0.3, 0.3, [1, 0, 0], TIMBER_DARK);
    }
    lit.box(mx + 0.05, 5.7, 0, 0.7, 0.7, gauge * 2 + 3.4, ramp(TIMBER_DARK, TIMBER));
    beam(lit, [mx + 0.3, 6.1, -gauge - 1.9], [mx + 0.3, 6.1, gauge + 1.9], 0.3, 0.3, [0, 0, 1], scaleRgb(TIMBER, 1.2));
    const lz = -gauge - 0.4;
    beam(lit, [mx + 0.45, 5.35, lz], [mx + 0.45, 4.45, lz], 0.1, 0.1, [1, 0, 0], IRON);
    glow.add(shapes.ball(1), xf(mx + 0.45, 4.1, lz, 0.32, 0.4, 0.32), [3.2, 2.2, 0.8]);
    lit.box(mx + 0.45, 4.62, lz, 0.55, 0.12, 0.55, IRON);
    lit.box(mx + 0.45, 3.58, lz, 0.55, 0.12, 0.55, IRON);
    for (const [dx, dz] of [[0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25]] as const) lit.box(mx + 0.45 + dx, 4.1, lz + dz, 0.07, 1.0, 0.07, IRON);
    // The pickaxe leans on the right-hand post.
    const px = mx + 0.9;
    const pz = gauge + 1.3 + 0.6;
    beam(lit, [px, 0.1, pz + 0.9], [px, 3.4, pz - 0.1], 0.14, 0.14, [1, 0, 0], rgb("#9a6a40"));
    beam(lit, [px, 3.4, pz - 0.85], [px, 3.2, pz + 0.65], 0.2, 0.2, [1, 0, 0], IRON);
    lit.add(shapes.cone(4), xf(px, 3.3, pz - 1.1, 0.14, 0.7, 0.14, 0, Math.PI / 2), IRON);
    lit.add(shapes.cone(4), xf(px, 3.3, pz + 0.95, 0.14, 0.6, 0.14, 0, -Math.PI / 2), IRON);
    // Spoil heaped by the entrance, and stones along the track.
    for (let k = 0; k < 6; k++) rockBlob(lit, mx + 2.2 + k * 0.5, 0, gauge + 3 + hash(k, 7) * 2.5, 0.9 + hash(k, 8), 0.6, 0.8, strataShade(50 + k, 1, 1), k + 8, { detail: 0, roughness: 0.3, flatBase: true });
    for (let k = 0; k < 4; k++) glow.add(shapes.ball(0), xf(cx - 1.0 + k * 0.6, 3.1, 0.3, 0.12, 0.12, 0.12), [3.6, 3.0, 1.3]);
    const halos: Halo[] = [
      { x: mx + 0.45, y: 4.1, z: lz, size: 8, colour: [2.8, 1.8, 0.6], alpha: 0.6, twinkle: 0.2 },
      { x: cx, y: 3.4, z: 0, size: 5, colour: [3.2, 2.5, 0.8], alpha: 0.45, twinkle: 0.7 },
      { x: cx - 1.5, y: 3.2, z: 0.6, size: 3, colour: [3.4, 2.8, 1.0], alpha: 0.6, twinkle: 0.9 },
    ];
    return { lit, glow, halos };
  },
};

// ─── Hazards ─────────────────────────────────────────────────────────────────

const meshOf = (b: MeshBuilder, mat: Material): Mesh => new Mesh(b.build(), mat);

/**
 * A boulder, shared with the volcano: a core wrapped in loose angular chunks. Sandstone in the canyon (a dark core
 * between lighter plates, dust behind it); in the volcano black basalt, the gaps between the chunks glowing lava,
 * with embers trailing.
 */
const boulder: HazardSpec = {
  build(ctx) {
    const volcanic = ctx.theme === "volcano";
    const R = 1.8;
    const root = new Group();
    const inner = new Group();
    root.add(inner);
    const lit = new MeshBuilder();
    const glowB = new MeshBuilder();
    const ico = shapes.ball(1).positions;
    const SAND_PALETTE = [rgb("#c8703a"), rgb("#d98a4a"), rgb("#b45a2e"), rgb("#e6b27a"), rgb("#a84f2a")];
    const BASALT_PALETTE = [rgb("#241f27"), rgb("#2d2830"), rgb("#1b171d"), rgb("#383240")];
    const palette = volcanic ? BASALT_PALETTE : SAND_PALETTE;
    for (let f = 0, face = 0; f < ico.length; f += 9, face++) {
      const A: V3 = [ico[f]!, ico[f + 1]!, ico[f + 2]!];
      const B: V3 = [ico[f + 3]!, ico[f + 4]!, ico[f + 5]!];
      const C: V3 = [ico[f + 6]!, ico[f + 7]!, ico[f + 8]!];
      const g = vec.mul(vec.add(vec.add(A, B), C), 1 / 3);
      const shrink = volcanic ? 0.86 : 0.95;
      const top = (v: V3, k: number): V3 => vec.mul(vec.norm(vec.lerp(v, g, 1 - shrink)), R * (1 + (hash(face, 1) - 0.5) * 0.16 + (hash(face, k, 2) - 0.5) * 0.04));
      const bot = (v: V3): V3 => vec.mul(vec.norm(vec.lerp(v, g, 1 - shrink)), R * 0.84);
      const tp = [top(A, 0), top(B, 1), top(C, 2)];
      const bt = [bot(A), bot(B), bot(C)];
      const col = palette[Math.floor(hash(face, 3) * palette.length) % palette.length]!;
      const lightPatch = !volcanic && hash(face, 4) > 0.8;
      const base = lightPatch ? SAND_PALETTE[3]! : col;
      const tone = 0.85 + 0.3 * hash(face, 5);
      lit.tri(tp[0]!, tp[1]!, tp[2]!, scaleRgb(base, tone));
      for (let e = 0; e < 3; e++) {
        const e2 = (e + 1) % 3;
        lit.quad(tp[e]!, tp[e2]!, bt[e2]!, bt[e]!, scaleRgb(base, tone * 0.8), scaleRgb(base, tone * 0.8), scaleRgb(base, tone * 0.5), scaleRgb(base, tone * 0.5));
      }
    }
    if (volcanic) {
      // The glowing core shows through the gaps between the chunks.
      glowB.add(shapes.ball(1), xf(0, 0, 0, R * 0.93, R * 0.93, R * 0.93), [1.5, 0.52, 0.07]);
      glowB.add(shapes.ball(0), xf(0, 0, 0, R * 0.97, R * 0.97, R * 0.97, 0.3), [1.1, 0.3, 0.04]);
    } else {
      lit.add(shapes.ball(1), xf(0, 0, 0, R * 0.9, R * 0.9, R * 0.9), rgb("#5e3220"));
    }
    inner.add(meshOf(lit, ctx.lit));
    if (volcanic) inner.add(meshOf(glowB, ctx.glow));
    // The trail: dust for sandstone, a streak of embers for basalt, both along -z behind it.
    const trail: Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const tb = new MeshBuilder();
      if (volcanic) tb.blob(0, 0, 0, 0.3, 0.3, 0.3, [1.1, 0.34, 0.04], 0);
      else tb.blob(0, 0, 0, 1.0, 0.65, 1.0, rgb("#e2c08a"), 0);
      const m = meshOf(tb, volcanic ? ctx.glow : hazardGlass());
      root.add(m);
      trail.push(m);
    }
    return {
      root,
      radius: R,
      update(s) {
        const sc = root.scale.y || 1;
        // Rolling and bouncing: it hops a little with each turn, landing with a bump.
        inner.rotation.x = s.travel / (R * sc);
        inner.rotation.z = Math.sin(s.travel * 0.2) * 0.1;
        inner.position.y = R * 0.97 + Math.abs(Math.sin((s.travel / (R * sc)) * 1.5)) * 0.32;
        trail.forEach((m, k) => {
          const u = (((s.time * 1.5 + k / 4) % 1) + 1) % 1;
          if (volcanic) {
            m.position.set(Math.sin(k * 2.3 + s.time) * 0.7, 0.5 + u * 1.3, -1.7 - u * 2.4);
            m.scale.setScalar(Math.max(0.05, 1 - u));
          } else {
            m.position.set(Math.sin(k * 2.3) * 0.9, 0.3 + u * 0.8, -1.9 - u * 2.6);
            m.scale.setScalar(0.5 + u * 1.2);
          }
        });
      },
    };
  },
};

/** A ball of dry, tangled twigs rolling along: a few dozen crossed rods in tan and brown. */
const tumbleweed: HazardSpec = {
  build(ctx) {
    const R = 1.2;
    const root = new Group();
    const inner = new Group();
    root.add(inner);
    const b = new MeshBuilder();
    const cols = [rgb("#b8955c"), rgb("#8a6a3e"), rgb("#d6bd88"), rgb("#6e5232"), rgb("#c4a46c")];
    const onSphere = (u: number, v: number, r: number): V3 => {
      const y = 1 - 2 * u;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const a = v * Math.PI * 2;
      return [Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r];
    };
    for (let k = 0; k < 44; k++) {
      const p0 = onSphere(hash(k, 1), hash(k, 2), R * (0.8 + 0.2 * hash(k, 3)));
      const p1 = onSphere(hash(k, 4), hash(k, 5), R * (0.8 + 0.2 * hash(k, 6)));
      // Bow each twig outward through a midpoint, so the ball is round and the twigs curve.
      const mid = vec.mul(vec.norm(vec.add(p0, p1)), R * (0.85 + 0.2 * hash(k, 7)));
      const col = cols[k % cols.length]!;
      const t = 0.11 + hash(k, 8) * 0.05;
      b.rod(p0, mid, t, col);
      b.rod(mid, p1, t, scaleRgb(col, 0.92));
    }
    // A knot of finer twigs through the middle.
    for (let k = 0; k < 6; k++) b.rod(onSphere(hash(k, 11), hash(k, 12), R * 0.6), onSphere(hash(k, 13), hash(k, 14), R * 0.6), 0.12, cols[(k + 2) % cols.length]!);
    inner.add(meshOf(b, ctx.lit));
    return {
      root,
      radius: R,
      update(s) {
        const sc = root.scale.y || 1;
        // It tumbles forward and wobbles, bouncing as it goes.
        inner.rotation.x = s.travel / (R * sc);
        inner.rotation.z = Math.sin(s.travel * 0.4) * 0.3;
        inner.rotation.y = Math.sin(s.travel * 0.25) * 0.4;
        inner.position.y = R * 0.95 + Math.abs(Math.sin(s.travel * 0.9 / sc)) * 0.35;
      },
    };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = {
  mesa,
  "rock-arch": rockArch,
  "cactus-grove": cactusGrove,
  "water-tower": waterTower,
  "mine-cart": mineCart,
};
export const HAZARDS: Record<string, HazardSpec> = { boulder, tumbleweed };
