/**
 * The snow world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build").
 * Glacier Pass at blue hour: cool whites and blues, with warm lit windows and ice that glows.
 *
 * The first block holds small helpers (beams, discs, icicles, a noisy arch) that the volcano
 * and canyon files borrow too, so the three worlds share one way of building rock and ice.
 */
import { DoubleSide, Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from "three";
import { arc, archBand, byHeight, extrudeZ, dome2D, grid, lathe, MeshBuilder, mixRgb, pipe, prism, ramp, rgb, rockBlob, scaleRgb, shapes, stripes, torus, tube, xf, type Rgb, type Shade, type V3 } from "./kit";
import type { HazardSpec, LandmarkSpec, MovingPart } from "./types";

// ─── Shared helpers (also used by volcano.ts and canyon.ts) ──────────────────

export const vec = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  lerp: (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/** A repeatable hash in 0..1 of up to three numbers (so a model never needs Math.random). */
export function hash(a: number, b = 0, c = 0): number {
  const h = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/** A box from point `a` to point `c`, `w` wide (along `side`) and `t` thick: a sloped plank, a strut, a thick roof slab. */
export function beam(b: MeshBuilder, a: V3, c: V3, w: number, t: number, side: V3, col: Rgb, colEnd: Rgb = col): void {
  const dn = vec.norm(vec.sub(c, a));
  let s = vec.sub(side, vec.mul(dn, vec.dot(side, dn)));
  if (vec.len(s) < 1e-4) s = vec.sub([1, 0, 0], vec.mul(dn, dn[0]));
  s = vec.norm(s);
  const n = vec.norm(vec.cross(dn, s));
  const corner = (p: V3, sx: number, sn: number): V3 => [
    p[0] + s[0] * sx * (w / 2) + n[0] * sn * (t / 2),
    p[1] + s[1] * sx * (w / 2) + n[1] * sn * (t / 2),
    p[2] + s[2] * sx * (w / 2) + n[2] * sn * (t / 2),
  ];
  const sg: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const A = sg.map(([x, y]) => corner(a, x, y));
  const C = sg.map(([x, y]) => corner(c, x, y));
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    b.quad(A[k]!, A[k2]!, C[k2]!, C[k]!, col, col, colEnd, colEnd);
  }
  b.quad(A[0]!, A[1]!, A[2]!, A[3]!, col);
  b.quad(C[0]!, C[1]!, C[2]!, C[3]!, colEnd);
}

/** A flat polygon (a fan) in a plane: a glowing window pane, a pool, a lamp lens. `edge` colours the rim. */
export function disc(b: MeshBuilder, c: V3, r: number, facing: "x" | "y" | "z", sides: number, col: Rgb, edge: Rgb = col, squash = 1, rot = 0): void {
  const pt = (k: number): V3 => {
    const a = rot + (k / sides) * Math.PI * 2;
    const u = Math.cos(a) * r;
    const w = Math.sin(a) * r * squash;
    return facing === "y" ? [c[0] + u, c[1], c[2] + w] : facing === "z" ? [c[0] + u, c[1] + w, c[2]] : [c[0], c[1] + u, c[2] + w];
  };
  for (let k = 0; k < sides; k++) b.tri(c, pt(k), pt(k + 1), col, edge, edge);
}

/** A cone hanging from `y` down by `h`: an icicle or stalactite. */
export function icicle(b: MeshBuilder, x: number, y: number, z: number, r: number, h: number, col: Rgb, sides = 5): void {
  b.add(shapes.cone(sides), xf(x, y - h / 2, z, r, -h, r), col);
}

/** A flat-based mound of snow (or ash, or sand): a squashed faceted lump. */
export function drift(b: MeshBuilder, cx: number, cz: number, rx: number, ry: number, rz: number, shade: Shade, seed = 1, yaw = 0): void {
  rockBlob(b, cx, 0, cz, rx, ry, rz, shade, seed, { detail: 1, roughness: 0.14, flatBase: true, yaw });
}

/** A strip of quads along a path, `half` wide each side, lying on a surface with normal `n` (a lava streak, a glowing seam). */
export function ribbon(b: MeshBuilder, pts: readonly V3[], half: number | ((i: number) => number), n: V3 | ((i: number) => V3), col: Rgb | ((i: number) => Rgb)): void {
  const side = (i: number): V3 => {
    const a = pts[Math.max(0, i - 1)]!;
    const c = pts[Math.min(pts.length - 1, i + 1)]!;
    const nn = typeof n === "function" ? n(i) : n;
    return vec.norm(vec.cross(vec.norm(vec.sub(c, a)), nn));
  };
  const hw = (i: number) => (typeof half === "function" ? half(i) : half);
  const cl = (i: number) => (typeof col === "function" ? col(i) : col);
  for (let i = 0; i < pts.length - 1; i++) {
    const s0 = side(i);
    const s1 = side(i + 1);
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    b.quad(vec.add(p0, vec.mul(s0, -hw(i))), vec.add(p0, vec.mul(s0, hw(i))), vec.add(p1, vec.mul(s1, hw(i + 1))), vec.add(p1, vec.mul(s1, -hw(i + 1))), cl(i), cl(i), cl(i + 1), cl(i + 1));
  }
}

/** A box that narrows (or widens) from the bottom to the top: a hull, a plinth, a cart. */
export function taper(b: MeshBuilder, cx: number, cz: number, y0: number, y1: number, hx0: number, hz0: number, hx1: number, hz1: number, bottom: Rgb, top: Rgb, yaw = 0, top1 = true): void {
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const P = (x: number, z: number, y: number): V3 => [cx + x * cs + z * sn, y, cz - x * sn + z * cs];
  const lo: V3[] = [P(-hx0, -hz0, y0), P(hx0, -hz0, y0), P(hx0, hz0, y0), P(-hx0, hz0, y0)];
  const hi: V3[] = [P(-hx1, -hz1, y1), P(hx1, -hz1, y1), P(hx1, hz1, y1), P(-hx1, hz1, y1)];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    b.quad(lo[k]!, lo[k2]!, hi[k2]!, hi[k]!, bottom, bottom, top, top);
  }
  if (top1) b.quad(hi[0]!, hi[1]!, hi[2]!, hi[3]!, top);
  b.quad(lo[0]!, lo[1]!, lo[2]!, lo[3]!, bottom);
}

/** A round column with flutes (a saguaro, a pillar of basalt): ribs alternate between `r` and `0.8 r`; from `a` to `c`. */
export function flutedPipe(b: MeshBuilder, a: V3, c: V3, r: number, ribs: number, shade: Shade, rTop = r, cap = true): void {
  const dn = vec.norm(vec.sub(c, a));
  const hint: V3 = Math.abs(dn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = vec.norm(vec.cross(dn, hint));
  const w = vec.cross(dn, u);
  const ring = (p: V3, rr: number): V3[] => {
    const out: V3[] = [];
    for (let k = 0; k < ribs * 2; k++) {
      const ang = (k / (ribs * 2)) * Math.PI * 2;
      const rad = rr * (k % 2 === 0 ? 1 : 0.8);
      out.push([p[0] + (u[0] * Math.cos(ang) + w[0] * Math.sin(ang)) * rad, p[1] + (u[1] * Math.cos(ang) + w[1] * Math.sin(ang)) * rad, p[2] + (u[2] * Math.cos(ang) + w[2] * Math.sin(ang)) * rad]);
    }
    return out;
  };
  const r0 = ring(a, r);
  const r1 = ring(c, rTop);
  grid(b, [r0, r1], shade, true);
  if (cap) {
    const tc = (c0: V3, rr: V3[], i: number) => {
      for (let k = 0; k < rr.length; k++) {
        const p = rr[k]!;
        const q = rr[(k + 1) % rr.length]!;
        const sh = (pt: V3, j: number): Rgb => (typeof shade === "function" ? shade(pt, i, j) : shade);
        b.tri(c0, p, q, sh(c0, 0), sh(p, k), sh(q, k + 1));
      }
    };
    tc(c, r1, 1);
  }
}

export interface ArchOptions {
  /** Clear half width and clear crown height of the opening, and the straight legs under the curve. */
  halfIn: number;
  topIn: number;
  legs: number;
  /** How far the walls sink below y = 0 (so the feet sit into sloping ground). */
  skirt?: number;
  /** Thickness of the band at a fraction round it (0 left foot .. 1 right foot) and at a fraction along z. */
  thick: (t: number, zt: number) => number;
  z0: number;
  z1: number;
  steps: number;
  arcSteps?: number;
  /** Metres of repeatable wobble on the surfaces. */
  rough?: number;
  seed?: number;
  inner: Shade;
  outer: Shade;
  /** Grow the outer skin / pull the inner skin in, for a glass layer drawn over a lit one. */
  grow?: number;
  shrink?: number;
  faces?: { inner?: boolean; outer?: boolean; ends?: boolean };
}

/**
 * A tunnel or arch of irregular rock or ice: a rounded opening swept along z with a wobbling skin, thicker or
 * thinner as `thick` says. Built in the road's frame (x right, y up, z along) for the span landmarks.
 */
export function noisyArch(b: MeshBuilder, o: ArchOptions): void {
  const arcN = o.arcSteps ?? 12;
  const skirt = o.skirt ?? 2;
  const rough = o.rough ?? 0;
  const seed = o.seed ?? 1;
  const faces = { inner: true, outer: true, ends: true, ...(o.faces ?? {}) };
  const rise = Math.max(0.1, o.topIn - o.legs);
  const innerRows: V3[][] = [];
  const outerRows: V3[][] = [];
  const shr = o.shrink ?? 0;
  for (let i = 0; i <= o.steps; i++) {
    const zt = i / o.steps;
    const z = o.z0 + (o.z1 - o.z0) * zt;
    const inn: V3[] = [];
    const out: V3[] = [];
    // The profile: foot, top of the leg, then the curve from the left over to the right.
    const prof: { x: number; y: number; ux: number; uy: number }[] = [{ x: -1, y: -skirt, ux: -1, uy: 0 }];
    if (o.legs > 0) prof.push({ x: -1, y: o.legs, ux: -1, uy: 0 });
    for (let k = 0; k <= arcN; k++) {
      const a = Math.PI - (k / arcN) * Math.PI;
      prof.push({ x: Math.cos(a), y: Math.sin(a), ux: Math.cos(a), uy: Math.sin(a) });
    }
    if (o.legs > 0) prof.push({ x: 1, y: o.legs, ux: 1, uy: 0 });
    prof.push({ x: 1, y: -skirt, ux: 1, uy: 0 });
    const m = prof.length;
    prof.forEach((q, j) => {
      const t = j / (m - 1);
      const th = o.thick(t, zt);
      const isFoot = j === 0 || j === m - 1;
      const baseY = q.y === -skirt || isFoot ? -skirt : o.legs > 0 && (j === 1 || j === m - 2) ? o.legs : o.legs + q.y * rise;
      const onLeg = j <= (o.legs > 0 ? 1 : 0) || j >= m - (o.legs > 0 ? 2 : 1);
      const yIn = isFoot ? -skirt : onLeg && o.legs > 0 ? (j === 0 || j === m - 1 ? -skirt : o.legs) : baseY;
      const wob = (n: number) => (hash(i, j, seed + n) - 0.5) * 2 * rough;
      const xIn = q.x * (o.halfIn - shr) + wob(1) * 0.6;
      inn.push([xIn, yIn + (yIn > 0 ? wob(2) * 0.6 : 0), z]);
      // The outer skin stands `th` out along the same direction (leg: sideways, curve: along the ellipse's own normal).
      const nx = q.ux * th;
      const ny = (isFoot ? 0 : q.uy) * th;
      out.push([q.x * o.halfIn + nx + (o.grow ?? 0) * q.ux + wob(3), (isFoot ? -skirt : yIn) + ny + (yIn > 0 ? (o.grow ?? 0) * (q.uy || 0) : 0) + (yIn > 0 ? wob(4) : 0), z]);
    });
    innerRows.push(inn);
    outerRows.push(out);
  }
  if (faces.inner) grid(b, innerRows, o.inner);
  if (faces.outer) grid(b, outerRows, o.outer);
  if (faces.ends) {
    grid(b, [innerRows[0]!, outerRows[0]!], o.outer);
    grid(b, [innerRows[o.steps]!, outerRows[o.steps]!], o.outer);
  }
}

/** The ceiling height (inner skin) of the standard rounded tunnel at a given x, for hanging things clear of the camera. */
export function ceilingAt(x: number, halfIn: number, topIn: number, legs: number): number {
  const k = Math.min(1, Math.abs(x) / halfIn);
  return legs + (topIn - legs) * Math.sqrt(1 - k * k);
}

/** Moving-part shorthand: a single bright or glassy puff that loops up and away (smoke, steam). */
export function puffPart(glass: MeshBuilder, pivot: V3, phase: number, period: number, rise: number, drifting: V3, grow = 1.6): MovingPart {
  return {
    glass,
    pivot,
    update(t: number, part: Object3D) {
      const u = (((t / period + phase) % 1) + 1) % 1;
      part.position.set(drifting[0] * u, rise * u, drifting[2] * u);
      const s = (0.5 + u * grow) * Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
      part.scale.setScalar(Math.max(0.02, s));
      part.rotation.y = u * 2.2;
    },
  };
}

/** One translucent material for hazards that need steam or powder (the layer only hands out lit and glow ones). */
let glassMaterial: Material | null = null;
export function hazardGlass(): Material {
  if (!glassMaterial) glassMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.5, depthWrite: false });
  return glassMaterial;
}

// ─── Palette ─────────────────────────────────────────────────────────────────

// Snow is tinted warm in the albedo because the sky light is a strong blue: lit, it lands as a cool white.
const SNOW: Rgb = [1.7, 1.5, 0.95];
const SNOW_LOW: Rgb = [0.82, 0.74, 0.72];
const SNOW_MID: Rgb = [1.25, 1.08, 0.78];
const SEAM: Rgb = [0.34, 0.32, 0.45];
const WARM: Rgb = [3.0, 1.95, 0.8];
const WARM_HALO: Rgb = [2.6, 1.6, 0.6];
const ICE_GLOW: Rgb = [0.45, 1.1, 1.9];
const WOOD = rgb("#a66e3c");
const WOOD_DARK = rgb("#5b3a22");

const snowShade = (y0: number, y1: number): Shade => byHeight(y0, y1, SNOW_MID, SNOW);

// ─── Igloo ───────────────────────────────────────────────────────────────────

const igloo: LandmarkSpec = {
  footprint: 9,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const R = 6.2;
    const H = 7;
    const rings = 7;
    const pt = (rad: number, hgt: number, phi: number, th: number): V3 => [rad * Math.cos(phi) * Math.sin(th), hgt * Math.sin(phi), rad * Math.cos(phi) * Math.cos(th)];
    const phi = (k: number) => (k / rings) * (Math.PI / 2);
    const inOpening = (k: number, thc: number) => {
      const c = ((thc + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      return k <= 1 && Math.abs(c) < 0.3;
    };
    // The smooth core of the dome, which the blocks sit on; its colour shows in the seams.
    const cols = 24;
    for (let k = 0; k < rings; k++) {
      for (let m = 0; m < cols; m++) {
        if (inOpening(k, ((m + 0.5) / cols) * Math.PI * 2)) continue;
        const th0 = (m / cols) * Math.PI * 2;
        const th1 = ((m + 1) / cols) * Math.PI * 2;
        const c = (p: V3) => mixRgb(SEAM, SNOW_MID, Math.max(0, p[1]) / H);
        const a = pt(R - 0.15, H - 0.15, phi(k), th0);
        const bb = pt(R - 0.15, H - 0.15, phi(k), th1);
        const cc = pt(R - 0.15, H - 0.15, phi(k + 1), th1);
        const d = pt(R - 0.15, H - 0.15, phi(k + 1), th0);
        lit.quad(a, bb, cc, d, c(a), c(bb), c(cc), c(d));
      }
    }
    lit.post(0, -1.5, 0, R + 0.1, 1.6, SEAM, 24); // a skirt into the ground
    // The blocks: slightly proud slabs with a gap between each, so the courses read as stacked snow bricks.
    for (let k = 0; k < rings; k++) {
      const mid = (phi(k) + phi(k + 1)) / 2;
      const n = Math.max(5, Math.round((Math.PI * 2 * R * Math.cos(mid)) / 2.7));
      for (let j = 0; j < n; j++) {
        const off = k % 2 === 0 ? 0 : 0.5;
        const th0 = ((j + off) / n) * Math.PI * 2;
        const th1 = ((j + off + 1) / n) * Math.PI * 2;
        if (inOpening(k, (th0 + th1) / 2)) continue;
        const gT = 0.022;
        const gP = 0.028;
        const corners: [number, number][] = [[phi(k) + gP, th0 + gT / Math.max(0.3, Math.cos(mid))], [phi(k) + gP, th1 - gT / Math.max(0.3, Math.cos(mid))], [phi(k + 1) - gP, th1 - gT / Math.max(0.3, Math.cos(mid))], [phi(k + 1) - gP, th0 + gT / Math.max(0.3, Math.cos(mid))]];
        const top = corners.map(([p, t]) => pt(R + 0.28, H + 0.28, p, t));
        const low = corners.map(([p, t]) => pt(R - 0.12, H - 0.12, p, t));
        const jit = 0.95 + hash(k, j, 3) * 0.1;
        const topCol = (p: V3): Rgb => scaleRgb(mixRgb(SNOW_LOW, SNOW, Math.min(1, Math.max(0, p[1] / H) * 0.9 + 0.1)), jit);
        lit.quad(top[0]!, top[1]!, top[2]!, top[3]!, topCol(top[0]!), topCol(top[1]!), topCol(top[2]!), topCol(top[3]!));
        for (let e = 0; e < 4; e++) {
          const e2 = (e + 1) % 4;
          lit.quad(top[e]!, top[e2]!, low[e2]!, low[e]!, scaleRgb(topCol(top[e]!), 0.78), scaleRgb(topCol(top[e2]!), 0.78), SEAM, SEAM);
        }
      }
    }
    // The tunnel: a snowy arch with a warm lining and a glowing back wall.
    archBand(lit, { width: 3.6, height: 3.0, thickness: 0.8, depth: 4.6, legs: 1.4, segments: 8, shade: byHeight(0, 4, SNOW_LOW, SNOW), at: [0, 0, 6.5] });
    const lining = dome2D(1.74, 2.96, 8, 1.4);
    extrudeZ(lit, lining, 4.3, 8.7, 2, byHeight(0, 3, rgb("#c9823f"), rgb("#f0c27a")));
    const wall = dome2D(1.74, 2.96, 8, 1.4);
    const wc: V3 = [0, 1.5, 4.4];
    for (let k = 0; k < wall.length - 1; k++) {
      const a = wall[k]!;
      const c = wall[k + 1]!;
      glow.tri(wc, [a[0], a[1], 4.4], [c[0], c[1], 4.4], [3.6, 2.4, 1.0], WARM, WARM);
    }
    glow.quad([-1.4, 0.05, 4.5], [1.4, 0.05, 4.5], [1.5, 0.05, 8.6], [-1.5, 0.05, 8.6], [1.6, 1.0, 0.4], [1.6, 1.0, 0.4], [1.0, 0.65, 0.3], [1.0, 0.65, 0.3]);
    // A small chimney hole at the crown, with a rim of snow and a dark throat.
    lit.post(0, 6.9, 0, 1.15, 0.9, ramp(SNOW_MID, SNOW), 8, 0.85);
    glow.add(shapes.cylinder(8), xf(0, 7.74, 0, 0.62, 0.05, 0.62), [1.3, 0.55, 0.2]);
    // Drifts at the foot, one banked up the tunnel.
    for (let k = 0; k < 7; k++) {
      const a = 0.9 + k * 0.78;
      drift(lit, Math.sin(a) * (R + 1.1), Math.cos(a) * (R + 1.1) - (k === 0 ? 0 : 0), 2.6 + hash(k, 1) * 1.4, 0.9 + hash(k, 2) * 0.8, 2.0 + hash(k, 3) * 1.0, snowShade(0, 1.6), k + 3, a);
    }
    drift(lit, 0, 10.6, 3.0, 0.45, 1.3, snowShade(0, 0.8), 21);
    // Skis and poles leaning on the dome, and a sled on its other side.
    const lean = (th: number, r0: number, y0: number, r1: number, y1: number, off: number): [V3, V3] => {
      const o: V3 = [Math.sin(th), 0, Math.cos(th)];
      const t: V3 = [Math.cos(th), 0, -Math.sin(th)];
      return [
        [o[0] * r0 + t[0] * off, y0, o[2] * r0 + t[2] * off],
        [o[0] * r1 + t[0] * off, y1, o[2] * r1 + t[2] * off],
      ];
    };
    const skiCols = [rgb("#d8392f"), rgb("#2f6fd0")];
    skiCols.forEach((col, k) => {
      const [f, t] = lean(0.95, 7.5, 0.12, 5.5, 3.7, (k - 0.5) * 0.7);
      beam(lit, f, t, 0.42, 0.16, [Math.cos(0.95), 0, -Math.sin(0.95)], col, scaleRgb(col, 1.15));
      const tip = vec.add(t, vec.mul(vec.norm(vec.sub(t, f)), 0.5));
      beam(lit, t, [tip[0], tip[1] + 0.22, tip[2]], 0.42, 0.16, [Math.cos(0.95), 0, -Math.sin(0.95)], scaleRgb(col, 1.15));
      const bind = vec.lerp(f, t, 0.45);
      lit.box(bind[0], bind[1], bind[2], 0.34, 0.2, 0.5, rgb("#2a2f3a"), 0.95);
    });
    for (let k = 0; k < 2; k++) {
      const [f, t] = lean(1.12, 7.3, 0.05, 5.4, 4.1, (k - 0.5) * 1.1 + 0.2);
      beam(lit, f, t, 0.16, 0.16, [1, 0, 0], rgb("#c9d2e2"));
      lit.blob(f[0], f[1] + 0.35, f[2], 0.3, 0.12, 0.3, rgb("#2a2f3a"), 0);
    }
    {
      // The sled leans on its tail: a pale board with a red stripe, two dark runners and a rope.
      const th = -0.85;
      const [f, t] = lean(th, 7.3, 0.1, 5.5, 3.5, 0);
      const side: V3 = [Math.cos(th), 0, -Math.sin(th)];
      beam(lit, f, t, 1.7, 0.14, side, rgb("#d9a15a"), rgb("#f0c27a"));
      beam(lit, vec.lerp(f, t, 0.08), vec.lerp(f, t, 0.92), 0.4, 0.2, side, rgb("#d8392f"), rgb("#e8554a"));
      for (const sd of [-0.78, 0.78]) {
        const f2 = vec.add(f, vec.mul(side, sd));
        const t2 = vec.add(t, vec.mul(side, sd));
        beam(lit, vec.add(f2, [0, -0.08, 0]), t2, 0.18, 0.3, side, rgb("#3a4150"));
        lit.blob(f2[0] + Math.sin(th) * 0.4, f2[1] + 0.3, f2[2] + Math.cos(th) * 0.4, 0.2, 0.36, 0.34, rgb("#3a4150"), 0);
      }
      const tipA = vec.lerp(f, t, 0.95);
      beam(lit, tipA, vec.add(tipA, [0, 0.9, 0]), 0.12, 0.12, side, rgb("#3a4150"));
    }
    const halos = [
      { x: 0, y: 1.8, z: 9.4, size: 11, colour: WARM_HALO, alpha: 0.6, twinkle: 0.08 },
      { x: 0, y: 1.6, z: 6.4, size: 7, colour: WARM_HALO, alpha: 0.4, twinkle: 0.1 },
      { x: 0, y: 8.2, z: 0, size: 3.5, colour: [2.4, 1.2, 0.5] as const, alpha: 0.4, twinkle: 0.2 },
    ];
    const smoke: MovingPart[] = [0, 1].map((k) => {
      const g = new MeshBuilder();
      g.blob(0, 8.6, 0, 0.8, 0.7, 0.8, rgb("#dfe7f6"), 0);
      return puffPart(g, [0, 8.6, 0], k * 0.5, 6, 6, [1.6, 0, 0.6], 1.5);
    });
    void ctx;
    return { lit, glow, halos, moving: smoke };
  },
};

// ─── Cabin ───────────────────────────────────────────────────────────────────

const cabin: LandmarkSpec = {
  footprint: 11,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const STONE = rgb("#7d8494");
    const logR = 0.34;
    const wallZ = 4.3;
    const wallX = 7.7;
    // A stone plinth to stand the logs on.
    lit.box(0, -0.25, 0, 17.0, 1.5, 9.8, ramp(scaleRgb(STONE, 0.6), STONE));
    // The log walls: courses of six-sided logs, the ends poking out at the corners.
    const courses = 8;
    const y0 = 0.5 + logR;
    for (let k = 0; k < courses; k++) {
      const y = y0 + k * logR * 1.94;
      const tone = (n: number) => {
        const base = mixRgb(WOOD_DARK, WOOD, 0.35 + hash(k, n) * 0.6 + k * 0.03);
        return base;
      };
      for (const s of [-1, 1]) {
        pipe(lit, [-wallX - 0.7, y, s * wallZ], [wallX + 0.7, y, s * wallZ], logR, tone(s), 6);
        pipe(lit, [s * wallX, y + logR * 0.97, -wallZ - 0.7], [s * wallX, y + logR * 0.97, wallZ + 0.7], logR, tone(s + 5), 6);
      }
    }
    // Gable wall boards above the logs, then the steep roof.
    const wallTop = y0 + courses * logR * 1.94 + 0.1;
    const rise = 5.4;
    const half = wallZ + 0.4;
    const ridgeY = wallTop + rise;
    for (const s of [-1, 1]) {
      lit.tri([s * wallX, wallTop - 0.3, -half], [s * wallX, wallTop - 0.3, half], [s * wallX, ridgeY - 0.1, 0], rgb("#6b4429"), rgb("#6b4429"), rgb("#8b5a34"));
      disc(glow, [s * (wallX + 0.04), wallTop + 2.3, 0], 0.85, "x", 10, [3.0, 2.0, 0.85], [2.2, 1.3, 0.5]);
      torus(lit, 0.95, 0.12, { at: [s * (wallX + 0.02), wallTop + 2.3, 0], facing: "x", ringSegments: 10, tubeSegments: 4, shade: rgb("#d9d2c0") });
    }
    const ov = 1.0; // overhang beyond the walls, front and back
    const eaveZ = half + ov;
    const eaveY = ridgeY - (rise / half) * eaveZ;
    const roofLen = 17.6;
    for (const s of [-1, 1]) {
      const ridge: V3 = [0, ridgeY, 0];
      const eave: V3 = [0, eaveY, s * eaveZ];
      // Planks, then a deep cap of snow on top with its edge bulging past the eave.
      beam(lit, ridge, eave, roofLen, 0.38, [1, 0, 0], rgb("#4a2f1c"), rgb("#6b4429"));
      const d = vec.norm(vec.sub(eave, ridge));
      const nUp = vec.norm(vec.cross([1, 0, 0], d)) as V3;
      const up: V3 = nUp[1] < 0 ? vec.mul(nUp, -1) : nUp;
      const lift = vec.mul(up, 0.2 + 0.55);
      const a = vec.add(ridge, lift);
      const c = vec.add(vec.add(eave, lift), vec.mul(d, 0.7));
      beam(lit, a, c, roofLen + 0.4, 1.1, [1, 0, 0], SNOW_MID, SNOW);
      // The lumpy edge of the snow over the eave.
      for (let k = 0; k < 11; k++) {
        const x = -8.1 + k * 1.62;
        const e = vec.add(c, vec.mul(up, -0.25));
        lit.blob(x, e[1] - 0.05, e[2] + s * 0.1, 1.0 + hash(k, 4) * 0.35, 0.62, 0.72, ramp(SNOW_MID, SNOW), 0);
      }
    }
    lit.box(0, ridgeY + 0.85, 0, roofLen + 0.5, 0.9, 1.7, ramp(SNOW_MID, SNOW)); // snow along the ridge
    const halos: { x: number; y: number; z: number; size: number; colour: readonly [number, number, number]; alpha: number; twinkle?: number }[] = [];
    // A little dormer on the front slope with its own lit window and a hat of snow.
    {
      const slope = rise / half;
      const roofAt = (z: number) => ridgeY - slope * z;
      const dx = -3.2;
      const fz = 3.6;
      const yb = roofAt(fz) - 0.2;
      const h = 2.3;
      lit.box(dx, yb + h / 2, fz - 0.9, 2.6, h, 1.8, ramp(rgb("#6b4429"), rgb("#9a6a40")));
      glow.quad([dx - 0.7, yb + 0.6, fz + 0.05], [dx + 0.7, yb + 0.6, fz + 0.05], [dx + 0.7, yb + h - 0.45, fz + 0.05], [dx - 0.7, yb + h - 0.45, fz + 0.05], [2.6, 1.6, 0.6], [2.6, 1.6, 0.6], WARM, WARM);
      lit.box(dx, yb + h - 0.3, fz + 0.1, 1.7, 0.18, 0.2, rgb("#d9d2c0"));
      lit.box(dx, yb + 0.55, fz + 0.12, 1.9, 0.2, 0.32, rgb("#d9d2c0"));
      for (const s of [-1, 1]) {
        const a: V3 = [dx, yb + h + 1.05, fz - 0.9];
        const c: V3 = [dx + s * 1.7, yb + h - 0.1, fz - 0.9];
        beam(lit, a, c, 1.9, 0.28, [0, 0, 1], rgb("#4a2f1c"));
        const nrm: V3 = vec.norm(vec.cross([0, 0, 1], vec.sub(c, a)));
        const up: V3 = nrm[1] < 0 ? vec.mul(nrm, -1) : nrm;
        const o = vec.mul(up, 0.55);
        beam(lit, vec.add(a, o), vec.add(c, vec.add(o, [s * 0.25, -0.1, 0])), 2.1, 0.8, [0, 0, 1], SNOW_MID, SNOW);
      }
      lit.tri([dx - 1.3, yb + h, fz + 0.02], [dx + 1.3, yb + h, fz + 0.02], [dx, yb + h + 1.0, fz + 0.02], rgb("#6b4429"));
      halos.push({ x: dx, y: yb + 1.3, z: fz + 1.5, size: 6, colour: WARM_HALO, alpha: 0.32, twinkle: 0.06 });
    }
    // Windows with frames, shutters, mullions and a glow; the front has two and a door, the +x gable a round one.
    const trim = rgb("#d9d2c0");
    const shutter = rgb("#3a7a63");
    const windows: [number, number][] = [[-5.2, 3.1], [5.2, 3.1]];
    for (const [wx, wy] of windows) {
      const z = wallZ + logR + 0.06;
      glow.quad([wx - 1.0, wy - 0.8, z + 0.02], [wx + 1.0, wy - 0.8, z + 0.02], [wx + 1.0, wy + 0.8, z + 0.02], [wx - 1.0, wy + 0.8, z + 0.02], [2.6, 1.6, 0.6], [2.6, 1.6, 0.6], WARM, WARM);
      lit.box(wx, wy + 0.95, z + 0.06, 2.5, 0.22, 0.34, trim);
      lit.box(wx, wy - 0.95, z + 0.1, 2.7, 0.24, 0.5, trim);
      lit.box(wx - 1.12, wy, z + 0.06, 0.22, 1.9, 0.34, trim);
      lit.box(wx + 1.12, wy, z + 0.06, 0.22, 1.9, 0.34, trim);
      lit.box(wx, wy, z + 0.08, 0.18, 1.7, 0.2, trim);
      lit.box(wx, wy, z + 0.08, 2.1, 0.18, 0.2, trim);
      for (const s of [-1, 1]) lit.box(wx + s * 1.78, wy, z + 0.1, 0.9, 2.0, 0.16, shutter, 0, 0, 0);
      halos.push({ x: wx, y: wy, z: z + 1.5, size: 12, colour: WARM_HALO, alpha: 0.55, twinkle: 0.06 });
    }
    // The door and the porch.
    const zf = wallZ + logR + 0.06;
    lit.box(0, 1.95, zf + 0.04, 2.0, 3.3, 0.16, rgb("#6e3b24"));
    for (let k = 0; k < 4; k++) lit.box(-0.75 + k * 0.5, 1.95, zf + 0.14, 0.06, 3.2, 0.08, rgb("#4e2a1a"));
    lit.box(0, 3.75, zf + 0.1, 2.7, 0.3, 0.36, trim);
    glow.quad([-0.6, 2.7, zf + 0.15], [0.6, 2.7, zf + 0.15], [0.6, 3.3, zf + 0.15], [-0.6, 3.3, zf + 0.15], WARM);
    lit.blob(0.75, 1.7, zf + 0.22, 0.12, 0.12, 0.12, rgb("#e8c05a"), 0);
    lit.box(0, 0.45, 5.9, 9.0, 0.35, 2.8, ramp(rgb("#6d472b"), rgb("#9a6a40"))); // deck
    for (let k = 0; k < 5; k++) lit.box(-3.6 + k * 1.8, 0.66, 5.9, 0.07, 0.04, 2.78, rgb("#4e3320"));
    lit.box(0, 0.2, 7.8, 5.0, 0.4, 1.2, rgb("#7b5233")); // steps
    lit.box(0, -0.05, 8.8, 5.4, 0.4, 1.0, rgb("#6d472b"));
    for (const s of [-1, 1]) {
      lit.post(s * 4.1, 0.3, 7.0, 0.3, 4.4, ramp(WOOD_DARK, WOOD), 6);
      lit.box(s * 4.1, 0.9, 7.0, 0.7, 0.6, 0.7, rgb("#4e3320"));
    }
    // The porch roof: a lean-to with its own snow.
    const pa: V3 = [0, wallTop - 0.6, wallZ + 0.6];
    const pc: V3 = [0, 4.7, 7.5];
    beam(lit, pa, pc, 9.6, 0.3, [1, 0, 0], rgb("#4a2f1c"), rgb("#6b4429"));
    beam(lit, [0, pa[1] + 0.65, pa[2]], [0, pc[1] + 0.7, pc[2] + 0.2], 9.9, 0.9, [1, 0, 0], SNOW_MID, SNOW);
    // Firewood stacked against the wall, and the lantern.
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 5 - row; k++) {
        const x = -3.6 + row * 0.24 + k * 0.5;
        pipe(lit, [x, 0.9 + row * 0.42, 5.2], [x, 0.9 + row * 0.42, 6.9], 0.22, mixRgb(rgb("#b88650"), rgb("#8b5a34"), hash(row, k)), 6);
      }
    }
    lit.box(-3.1, 0.7, 6.1, 2.6, 0.24, 0.24, WOOD_DARK);
    glow.add(shapes.ball(1), xf(1.9, 3.0, 6.9, 0.32, 0.4, 0.32), [3.4, 2.4, 0.9]);
    for (const [dx, dz] of [[0.38, 0.38], [-0.38, 0.38], [0.38, -0.38], [-0.38, -0.38]] as const) lit.box(1.9 + dx, 3.0, 6.9 + dz, 0.07, 0.9, 0.07, rgb("#20242c"));
    lit.box(1.9, 3.5, 6.9, 0.9, 0.1, 0.9, rgb("#20242c"));
    lit.box(1.9, 3.62, 6.9, 0.5, 0.2, 0.5, SNOW);
    beam(lit, [1.9, 3.7, 6.9], [1.9, 4.75, 6.9], 0.12, 0.12, [1, 0, 0], rgb("#20242c"));
    halos.push({ x: 1.9, y: 3.0, z: 7.3, size: 6.5, colour: WARM_HALO, alpha: 0.6, twinkle: 0.15 }, { x: 0, y: 2.8, z: 6.5, size: 8, colour: WARM_HALO, alpha: 0.3, twinkle: 0.05 });
    // The stone chimney through the back slope, with courses of different greys.
    const cx = -5.0;
    const cz = -1.5;
    for (let k = 0; k < 12; k++) {
      const y = 5 + k * 0.85;
      const t = hash(k, 7);
      lit.box(cx + (t - 0.5) * 0.08, y + 0.42, cz, 2.3 + (hash(k, 8) - 0.5) * 0.1, 0.84, 2.1, mixRgb(scaleRgb(STONE, 0.7), scaleRgb(STONE, 1.25), t));
    }
    lit.box(cx, 15.45, cz, 3.0, 0.5, 2.8, rgb("#62697a"));
    lit.box(cx, 16.05, cz, 2.7, 0.8, 2.4, ramp(SNOW_MID, SNOW));
    lit.box(cx, 16.5, cz, 1.0, 0.1, 1.0, rgb("#1a1f2b"));
    // Icicles under the eave.
    const eaveY2 = eaveY - 0.35;
    for (let k = 0; k < 21; k++) {
      const x = -8.2 + k * 0.82;
      icicle(glass, x, eaveY2, eaveZ + 0.1, 0.17 + hash(k, 5) * 0.06, 0.7 + hash(k, 6) * 1.3, rgb("#bfe8ff"), 5);
    }
    // Drifts, and a path of trodden snow to the steps.
    drift(lit, -8.6, 2.4, 2.4, 1.3, 3.2, snowShade(0, 2.2), 31);
    drift(lit, 8.8, 3.6, 2.6, 1.0, 3.8, snowShade(0, 2), 32);
    drift(lit, 7.8, -3.5, 3.2, 1.6, 2.6, snowShade(0, 2.5), 33);
    drift(lit, 0, 11.6, 3.2, 0.5, 1.4, snowShade(0, 1), 34);
    const smoke: MovingPart[] = [0, 1, 2].map((k) => {
      const g = new MeshBuilder();
      g.blob(cx, 16.9, cz, 1.2, 1.0, 1.2, rgb("#e3e9f4"), 0);
      return puffPart(g, [cx, 16.9, cz], k / 3, 7, 10, [4.5, 0, -1.2], 1.9);
    });
    return { lit, glow, glass, halos, moving: smoke };
  },
};

// ─── Snowman ─────────────────────────────────────────────────────────────────

const snowman: LandmarkSpec = {
  footprint: 8,
  build() {
    const lit = new MeshBuilder();
    const COAL = rgb("#1c1f26");
    const ball = (cx: number, cy: number, cz: number, r: number, seed: number) =>
      rockBlob(lit, cx, cy, cz, r, r * 0.97, r, byHeight(cy - r, cy + r, scaleRgb(SNOW_LOW, 1.05), SNOW), seed, { detail: 1, roughness: 0.05, yaw: seed });
    ball(0, 4.5, 0, 5.3, 1);
    ball(0, 11.2, 0, 3.8, 2);
    ball(0, 16.9, 0.15, 2.8, 3);
    // A face on the head: coal eyes, rosy cheeks, a smile, and a carrot nose pointing at the road.
    const disk = (x: number, y: number, z: number, r: number, thick: number, col: Rgb, tilt = 0) => lit.add(shapes.cylinder(8), xf(x, y, z, r, thick, r, 0, Math.PI / 2 + tilt), col);
    for (const s of [-1, 1]) {
      disk(s * 1.0, 17.7, 2.45, 0.42, 0.5, COAL);
      lit.blob(s * 1.0 + 0.1, 17.9, 2.78, 0.1, 0.1, 0.05, rgb("#ffffff"), 0);
      disk(s * 1.95, 16.4, 2.0, 0.55, 0.36, rgb("#ff9aa8"));
      beam(lit, [s * 0.5, 18.45, 2.5], [s * 1.7, 18.8 - s * 0.0, 2.2], 0.22, 0.2, [0, 0, 1], COAL);
    }
    for (let k = 0; k < 7; k++) {
      const x = -1.5 + k * 0.5;
      const y = 15.7 + 0.5 * (x / 1.5) * (x / 1.5);
      disk(x, y, Math.sqrt(Math.max(1, 2.8 * 2.8 - x * x - (y - 16.9) * (y - 16.9))) * 0.97 + 0.15, 0.27, 0.5, COAL);
    }
    lit.add(shapes.cone(8), xf(0, 16.55, 2.6 + 1.7, 0.6, 3.6, 0.6, 0, Math.PI / 2 + 0.12), ramp(rgb("#c9531a"), rgb("#ff8a2a")));
    // The red-and-white scarf round the neck, and the three buttons.
    torus(lit, 2.25, 0.7, { at: [0, 14.4, 0], facing: "y", ringSegments: 16, tubeSegments: 6, shade: stripes(rgb("#d6352e"), rgb("#f5f5ff"), "row", 1) });
    for (let k = 0; k < 3; k++) {
      const y = 13.5 - k * 2.0;
      const z = Math.sqrt(Math.max(1, 3.8 * 3.8 - (y - 11.2) * (y - 11.2))) * 0.97;
      disk(0, y, z, 0.52, 0.6, COAL);
    }
    // The top hat, tilted, with a band.
    const hat = new MeshBuilder();
    hat.add(shapes.cylinder(14), xf(0, 19.05, 0, 3.3, 0.4, 3.3), ramp(rgb("#1a1c26"), rgb("#2f3345")));
    hat.post(0, 19.2, 0, 2.05, 3.2, ramp(rgb("#1a1c26"), rgb("#343a50")), 14, 0.92);
    hat.post(0, 19.7, 0, 2.12, 0.8, rgb("#c93a35"), 14, 1.0);
    hat.add(shapes.cylinder(14), xf(0, 22.45, 0, 1.9, 0.12, 1.9), rgb("#3a4058"));
    // Stick arms with twig fingers.
    const STICK = rgb("#5b3d26");
    for (const s of [-1, 1]) {
      const sh: V3 = [s * 3.4, 11.8, 0];
      const el: V3 = s > 0 ? [s * 6.2, 9.6, 0.6] : [s * 6.2, 14.8, 0.4];
      const hd: V3 = s > 0 ? [s * 9.2, 7.4, 1.2] : [s * 9.6, 18.4, 1.0];
      beam(lit, sh, el, 0.62, 0.62, [0, 1, 0], STICK);
      beam(lit, el, hd, 0.46, 0.46, [0, 1, 0], STICK);
      for (let k = 0; k < 3; k++) {
        const ang = (k - 1) * 0.55;
        const end: V3 = [hd[0] + s * Math.cos(ang) * 1.9, hd[1] + Math.sin(ang) * 1.9 * (s > 0 ? -1 : 1), hd[2] + (k - 1) * 0.3];
        beam(lit, hd, end, 0.26, 0.26, [0, 1, 0], STICK);
      }
      const mid = vec.lerp(sh, el, 0.55);
      beam(lit, mid, [mid[0] + s * 1.4, mid[1] + (s > 0 ? 1.8 : -1.6), mid[2] - 0.4], 0.3, 0.3, [0, 1, 0], STICK);
    }
    // Lumps of snow trodden round the foot.
    for (let k = 0; k < 8; k++) {
      const a = k * 0.8 + 0.3;
      drift(lit, Math.sin(a) * 6.2, Math.cos(a) * 6.2, 1.6 + hash(k, 1) * 1.2, 0.8 + hash(k, 2) * 0.5, 1.6, snowShade(0, 1.4), k + 40);
    }
    // The scarf's two tails stream out sideways in the wind, each a row of stripes that sways.
    const tails: MovingPart[] = [
      { len: 8, y: 14.7, z: 0.9, phase: 0, w: 1.5 },
      { len: 5.5, y: 14.0, z: -0.6, phase: 1.7, w: 1.3 },
    ].map((d) => {
      const g = new MeshBuilder();
      const pieces = Math.round(d.len / 1.1);
      for (let k = 0; k < pieces; k++) {
        const x0 = 2.4 + k * 1.1;
        const wob = Math.sin(k * 0.9) * 0.35;
        beam(g, [x0, d.y - k * 0.1, d.z + wob], [x0 + 1.12, d.y - (k + 1) * 0.1, d.z + Math.sin((k + 1) * 0.9) * 0.35], d.w, 0.26, [0, 1, 0], k % 2 === 0 ? rgb("#d6352e") : rgb("#f5f5ff"));
      }
      return {
        lit: g,
        pivot: [2.4, d.y, d.z] as V3,
        update(t: number, part: Object3D) {
          part.rotation.y = Math.sin(t * 1.9 + d.phase) * 0.14;
          part.rotation.z = Math.sin(t * 2.7 + d.phase * 1.3) * 0.09 + 0.05;
          part.rotation.x = Math.sin(t * 3.3 + d.phase) * 0.05;
        },
      };
    });
    tails.push({
      lit: hat,
      pivot: [0, 19.0, 0],
      update(t: number, part: Object3D) {
        part.rotation.z = 0.12 + Math.sin(t * 0.8) * 0.01;
      },
    });
    return { lit, moving: tails };
  },
};

// ─── Ice arch and ice cave ───────────────────────────────────────────────────

const ICE_LO = rgb("#9bd8fa");
const ICE_HI = rgb("#e6f7ff");
const ICE_FROST: Rgb = [1.5, 1.45, 1.35];
const ICE_GLASS = rgb("#8fd0ff");

/** A facet-by-facet shade for ice: blue at the foot, pale at the top, each vertex nudged so facets glint. */
const iceShade = (top: number, seed: number, lo: Rgb = ICE_LO, hi: Rgb = ICE_HI): Shade => (p, i, j) => scaleRgb(mixRgb(lo, hi, Math.max(0, Math.min(1, p[1] / top))), 0.88 + 0.28 * hash(i, j, seed));

/** Glowing strips that hug the inside of a tunnel along its length, in dashes. */
function glowAlong(g: MeshBuilder, hw: number, top: number, legs: number, z0: number, z1: number, angles: number[], col: Rgb, dash = 6, gap = 2): void {
  for (const a of angles) {
    const x = Math.cos(a) * (hw - 0.3);
    const y = legs + Math.sin(a) * (top - legs) - 0.3;
    const inward: V3 = [-Math.cos(a), -Math.sin(a), 0];
    for (let z = z0; z + dash <= z1 + 0.01; z += dash + gap) {
      ribbon(g, [[x, y, z], [x, y, z + dash]], 0.28, inward, col);
    }
  }
}

const iceArch: LandmarkSpec = {
  span: true,
  defaultSpan: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const hw = Math.max(13, ctx.halfWidth + 6);
    const top = 13.8;
    const legs = 6.2;
    const half = ctx.span / 2;
    // The band is thickest over the crown and tucks in at the ends, leaning a little to one side: a natural bridge of ice.
    const thick = (t: number, zt: number) => (3.2 + 2.9 * Math.sin(Math.PI * t)) * (0.5 + 0.5 * Math.pow(Math.sin(Math.PI * zt), 0.55)) * (0.88 + 0.26 * t);
    const base = { halfIn: hw, topIn: top, legs, thick, z0: -half, z1: half, steps: Math.max(4, Math.round(ctx.span / 4)), arcSteps: 14, rough: 0.55, seed: 4, skirt: 3 };
    noisyArch(lit, { ...base, inner: iceShade(top, 1), outer: iceShade(top + 6, 2, ICE_LO, ICE_FROST) });
    noisyArch(glass, { ...base, grow: 0.3, shrink: 0.16, inner: ICE_GLASS, outer: ICE_GLASS });
    // Frosted ridges and crystals along the crown, and drifts at the feet.
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      const z = -half * 0.8 + t * half * 1.6;
      const x = (hash(k, 3) - 0.5) * 9;
      const yTop = top + 5.6 + 0.8 * Math.sin(t * Math.PI);
      lit.blob(x, yTop, z, 3.6, 1.5, 3.1, ramp(ICE_FROST, [1.6, 1.6, 1.7]), 1);
    }
    for (let k = 0; k < 7; k++) {
      const x = (k - 3) * 2.6 + (hash(k, 9) - 0.5) * 1.4;
      const z = (hash(k, 11) - 0.5) * half * 1.3;
      const h = 3 + hash(k, 5) * 3.2;
      const y = top + 5.8 - Math.abs(x) * 0.15;
      lit.add(shapes.cone(5), xf(x, y + h / 2, z, 0.9 + hash(k, 6) * 0.5, h, 0.9, k, 0.08 * (k - 3), 0.06 * (3 - k)), ramp(ICE_LO, [1.4, 1.5, 1.7]));
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) drift(lit, s * (hw + 4.2 + k * 0.6), -half * 0.6 + k * half * 0.6, 3.6, 1.8, 3.4, snowShade(0, 2.4), k + s * 7);
    }
    // Icicles hanging inside: short over the road, long beside it, always clear of the camera.
    for (let k = 0; k < 30; k++) {
      let x = (hash(k, 1) - 0.5) * 2 * (hw - 0.8);
      if (Math.abs(x) > 9.4 && Math.abs(x) < 11.4) x = (hash(k, 4) - 0.5) * 16;
      const ceil = ceilingAt(x, hw, top, legs);
      const cap = Math.abs(x) <= 11.4 ? Math.min(2.6, ceil - 9.6) : 3.2;
      if (cap < 0.5) continue;
      const len = Math.min(cap, 0.8 + hash(k, 2) * 2.4);
      icicle(glass, x, ceil + 0.2, -half * 0.9 + hash(k, 3) * half * 1.8, 0.2 + hash(k, 8) * 0.18, len, rgb("#9fdcff"), 5);
    }
    // The inner glow: three blue ribbons round the arch and a halo at the crown.
    for (const z of [-half * 0.45, 0, half * 0.45]) {
      const pts: V3[] = [];
      for (let k = 1; k < 16; k++) {
        const a = Math.PI - (k / 16) * Math.PI;
        pts.push([Math.cos(a) * (hw - 0.3), legs + Math.sin(a) * (top - legs) - 0.3, z]);
      }
      ribbon(glow, pts, 0.3, (i) => {
        const a = Math.PI - ((i + 1) / 16) * Math.PI;
        return [-Math.cos(a), -Math.sin(a), 0];
      }, ICE_GLOW);
    }
    const halos = [
      { x: 0, y: top - 1, z: 0, size: 24, colour: [0.35, 0.85, 1.5] as const, alpha: 0.5, twinkle: 0.12 },
      { x: -hw + 2, y: 6, z: 0, size: 13, colour: [0.35, 0.85, 1.5] as const, alpha: 0.35, twinkle: 0.1 },
      { x: hw - 2, y: 6, z: 0, size: 13, colour: [0.35, 0.85, 1.5] as const, alpha: 0.35, twinkle: 0.1 },
    ];
    return { lit, glow, glass, halos };
  },
};

const iceCave: LandmarkSpec = {
  span: true,
  defaultSpan: 70,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const hw = Math.max(13, ctx.halfWidth + 6);
    const top = 12.2;
    const legs = 6.4;
    const half = ctx.span / 2;
    const lip = 2.6;
    const thick = (t: number) => 3.4 + 2.6 * Math.sin(Math.PI * t);
    const body = { halfIn: hw, topIn: top, legs, thick, steps: Math.max(6, Math.round(ctx.span / 3)), arcSteps: 14, rough: 0.5, seed: 8, skirt: 3 };
    noisyArch(lit, { ...body, z0: -half + lip, z1: half - lip, inner: iceShade(top, 3, rgb("#7cc9f6"), rgb("#d6f2ff")), outer: iceShade(top + 6, 4, ICE_LO, ICE_FROST) });
    noisyArch(glass, { ...body, z0: -half + lip, z1: half - lip, grow: 0.32, shrink: 0.18, inner: ICE_GLASS, outer: ICE_GLASS });
    // Frosted entrance lips, fatter and whiter, wearing caps of snow.
    for (const s of [-1, 1]) {
      const z0 = s < 0 ? -half : half - lip - 0.01;
      noisyArch(lit, { ...body, thick: (t) => 5.2 + 3 * Math.sin(Math.PI * t), steps: 2, rough: 0.9, seed: 20 + s, z0, z1: z0 + lip + 0.01, inner: byHeight(0, top, [1.1, 1.15, 1.3], [1.5, 1.5, 1.6]), outer: byHeight(0, top + 8, [0.95, 1.0, 1.15], [1.6, 1.6, 1.7]) });
      const zc = s * (half - lip / 2);
      lit.blob(0, top + 8.1, zc, 11, 1.7, lip * 0.62 + 0.6, ramp(SNOW_MID, SNOW), 1);
      for (const sx of [-1, 1]) drift(lit, sx * (hw + 5.4), zc, 4.6, 2.4, 2.4, snowShade(0, 3), 40 + sx);
    }
    // Glow strips along the walls and roof, dashed, and a halo about every twelve metres.
    glowAlong(glow, hw, top, legs, -half + lip + 1, half - lip - 1, [0.1, 0.32, 0.5, 0.68, 0.9].map((f) => Math.PI * f), ICE_GLOW);
    const halos: { x: number; y: number; z: number; size: number; colour: readonly [number, number, number]; alpha: number; twinkle?: number }[] = [];
    let n = 0;
    for (let z = -half + 6; z <= half - 5; z += 12) {
      halos.push({ x: 0, y: top - 1.8, z, size: 20, colour: [0.35, 0.85, 1.5], alpha: 0.5, twinkle: 0.12 });
      const sd = n++ % 2 === 0 ? -1 : 1;
      halos.push({ x: sd * (hw - 2), y: 4.2, z: z + 6, size: 12, colour: [0.3, 0.8, 1.5], alpha: 0.35, twinkle: 0.1 });
    }
    // Stalactites from the roof: glassy blue cones, none low enough for the chase camera.
    for (let k = 0; k < 46; k++) {
      let x = (hash(k, 1) - 0.5) * 2 * (hw - 1);
      if (Math.abs(x) > 9.4 && Math.abs(x) < 11.5) x = (hash(k, 5) - 0.5) * 16;
      const ceil = ceilingAt(x, hw, top, legs);
      const cap = Math.abs(x) <= 11.5 ? Math.min(2.6, ceil - 9.6) : 3.4;
      if (cap < 0.5) continue;
      const len = Math.min(cap, 0.7 + hash(k, 2) * 2.6);
      const z = -half + lip + 1 + hash(k, 3) * (ctx.span - 2 * lip - 2);
      const r = 0.22 + hash(k, 8) * 0.22;
      icicle(k % 3 === 0 ? lit : glass, x, ceil + 0.25, z, r, len, k % 3 === 0 ? rgb("#a8e0ff") : rgb("#8fd6ff"), 5);
    }
    // A few frosted ridges on the walls.
    for (let k = 0; k < 8; k++) {
      const s = k % 2 === 0 ? -1 : 1;
      const z = -half + lip + 4 + (k / 7) * (ctx.span - 2 * lip - 8);
      lit.blob(s * (hw - 0.9), 1.6, z, 1.1, 1.7, 1.9, ramp([1.0, 1.1, 1.3], [1.5, 1.55, 1.7]), 1);
    }
    return { lit, glow, glass, halos };
  },
};

// ─── Pines under snow ────────────────────────────────────────────────────────

const PINE_DARK = rgb("#21504a");
const PINE_MID = rgb("#3a8060");

function pine(lit: MeshBuilder, cx: number, cz: number, h: number, seed: number): void {
  const trunkH = h * 0.22;
  lit.post(cx, -1.2, cz, h * 0.04 + 0.35, trunkH + 2.4, ramp(rgb("#3a2518"), rgb("#6b4429")), 7, 0.75);
  const tiers = h > 18 ? 6 : 5;
  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const y = trunkH * 0.75 + u * (h - trunkH * 0.75 - h * 0.2);
    const r = h * 0.27 * (1 - u * 0.8);
    const th = h * 0.21 * (1 - u * 0.25);
    const yaw = seed + i * 0.7;
    lit.add(shapes.cone(8), xf(cx, y + th / 2, cz, r, th, r, yaw), ramp(PINE_DARK, PINE_MID));
    // The snow lies thick on the upper surface and stops short of the tip of each bough.
    lit.add(shapes.cone(8), xf(cx, y + th * 0.6, cz, r * 0.97, th * 1.0, r * 0.97, yaw + 0.2), ramp(SNOW_MID, SNOW));
    // A drooping lump of snow on the lowest boughs.
    if (i < 2) lit.blob(cx + Math.cos(yaw) * r * 0.72, y + th * 0.18, cz + Math.sin(yaw) * r * 0.72, r * 0.2, r * 0.12, r * 0.2, ramp(SNOW_MID, SNOW), 0);
  }
  lit.add(shapes.cone(6), xf(cx, h - h * 0.07, cz, h * 0.035, h * 0.14, h * 0.035), ramp(SNOW_MID, SNOW));
}

const pineSnow: LandmarkSpec = {
  footprint: 14,
  build(ctx) {
    const lit = new MeshBuilder();
    const heights = [22, 18.5, 20, 16.5, 19, 15.5, 17.5];
    const spots: [number, number][] = [[0, 0], [-9.5, 3.5], [8.5, 5.5], [-6.5, -8], [6.5, -8.5], [-15, -3], [14.5, -2.5]];
    const n = 5 + Math.floor(ctx.rnd() * 3);
    for (let k = 0; k < n; k++) {
      const [x, z] = spots[k]!;
      pine(lit, x, z, heights[k]! * (0.95 + ctx.rnd() * 0.1), k * 1.3);
      drift(lit, x + 1.2, z + 3, 2.4, 0.9, 1.9, snowShade(0, 1.2), k + 50);
    }
    // A fallen branch with a ridge of snow along it, and a drift spilling out towards the road.
    beam(lit, [-3.5, 0.5, 9], [3.5, 1.3, 11.5], 0.5, 0.5, [0, 1, 0], rgb("#4e3320"), rgb("#6b4429"));
    beam(lit, [-3.5, 0.9, 9], [3.5, 1.7, 11.5], 0.6, 0.35, [0, 1, 0], SNOW_MID, SNOW);
    for (const [dx, dy, dz] of [[2.4, 1.5, 12.4], [-1.2, 1.1, 9.0]] as const) beam(lit, [dx - 1.0, dy, dz - 0.8], [dx, dy + 0.5, dz], 0.22, 0.22, [0, 1, 0], rgb("#4e3320"));
    drift(lit, 0, 11, 7, 1.0, 3.2, snowShade(0, 1.4), 70);
    drift(lit, -17, 4, 3.2, 1.3, 2.8, snowShade(0, 1.6), 71);
    return { lit };
  },
};

// ─── Gondola ─────────────────────────────────────────────────────────────────

const PYLON_X = 35;
const CABLE_TOP = 24.75;
const CABLE_SAG = 1.3;
const cableY = (x: number) => CABLE_TOP - CABLE_SAG * (1 - (x / PYLON_X) * (x / PYLON_X));

function pylon(lit: MeshBuilder, glow: MeshBuilder, cx: number): void {
  const STEEL = rgb("#7d8aa0");
  const STEEL_DARK = rgb("#4b566b");
  const RED = rgb("#d8332a");
  const WHITE = rgb("#f2f0ec");
  const H = 23.4;
  const baseHalf = 3.4;
  const topHalf = 1.0;
  const hwAt = (y: number) => baseHalf + (topHalf - baseHalf) * ((y + 1) / (H + 1));
  const levels = [-1, 3.8, 8.6, 13.4, 18.2, H];
  const corner = (sx: number, sz: number, y: number): V3 => [cx + sx * hwAt(y), y, sz * hwAt(y)];
  // Four tapering legs, striped red and white on the top stretch like an aviation marker.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let k = 0; k < levels.length - 1; k++) {
        const a = corner(sx, sz, levels[k]!);
        const c = corner(sx, sz, levels[k + 1]!);
        const striped = k >= levels.length - 3;
        const col = striped ? (k % 2 === 0 ? RED : WHITE) : STEEL;
        beam(lit, a, c, 0.6, 0.6, [1, 0, 0], col, col);
      }
    }
  }
  // Rings and X braces on every face.
  const faces: [[number, number], [number, number]][] = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
  for (let k = 0; k < levels.length; k++) {
    const y = levels[k]!;
    for (const [a, b] of faces) beam(lit, corner(a[0], a[1], y), corner(b[0], b[1], y), 0.34, 0.34, [0, 1, 0], STEEL_DARK);
    if (k < levels.length - 1) {
      const y2 = levels[k + 1]!;
      for (const [a, b] of faces) {
        beam(lit, corner(a[0], a[1], y), corner(b[0], b[1], y2), 0.28, 0.28, [0, 1, 0], STEEL_DARK);
        beam(lit, corner(b[0], b[1], y), corner(a[0], a[1], y2), 0.28, 0.28, [0, 1, 0], STEEL_DARK);
      }
    }
  }
  // The cross arm, the sheave wheel the cable runs over, and red warning lamps.
  lit.box(cx, H + 0.4, 0, 1.3, 0.9, 7.4, ramp(STEEL_DARK, STEEL));
  torus(lit, 1.15, 0.32, { at: [cx, H + 1.8, 0], facing: "z", ringSegments: 14, tubeSegments: 5, shade: rgb("#2c3342") });
  lit.box(cx, H + 1.8, 0, 0.6, 0.6, 0.9, rgb("#2c3342"));
  for (const s of [-1, 1]) {
    lit.box(cx, H + 1.3, s * 0.75, 1.6, 2.2, 0.3, STEEL_DARK);
    glow.add(shapes.ball(0), xf(cx, H + 1.2, s * 3.9, 0.45, 0.45, 0.45), [3.4, 0.4, 0.3]);
  }
  // A concrete foot with snow on it.
  lit.box(cx, -0.4, 0, baseHalf * 2 + 1.6, 1.8, baseHalf * 2 + 1.6, ramp(rgb("#575d6b"), rgb("#8b92a2")));
  lit.box(cx, 0.55, 0, baseHalf * 2 + 0.6, 0.3, baseHalf * 2 + 0.6, SNOW_MID);
  for (const [dx, dz] of [[4.6, 3.5], [-4.2, -3.8], [3.5, -4.6]] as const) drift(lit, cx + dx, dz, 2.2, 0.9, 2.0, snowShade(0, 1.2), Math.floor(cx + dx));
}

const gondola: LandmarkSpec = {
  footprint: 8,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    pylon(lit, glow, -PYLON_X);
    pylon(lit, glow, PYLON_X);
    // The carrying cable, sagging a little, and a thinner return cable behind it.
    const path = (z: number, drop: number): V3[] => {
      const pts: V3[] = [];
      for (let k = 0; k <= 16; k++) {
        const x = -PYLON_X + (k / 16) * PYLON_X * 2;
        pts.push([x, cableY(x) - drop, z]);
      }
      return pts;
    };
    tube(lit, path(0, 0), { radius: 0.17, sides: 5, shade: rgb("#2b2f39") });
    tube(lit, path(-1.6, 0.05), { radius: 0.13, sides: 5, shade: rgb("#3a3f4b") });
    // The cabin: hangs from a clamp on the cable, rides to and fro on a slow clock, swinging a little.
    const cab = new MeshBuilder();
    const cabGlow = new MeshBuilder();
    const y0 = cableY(0);
    const RED = rgb("#d8332a");
    cab.box(0, y0 - 0.05, 0, 0.9, 0.7, 1.1, rgb("#2c3342"));
    cab.box(0, y0 - 2.0, 0, 0.22, 3.8, 0.22, rgb("#3a4150"));
    cab.box(0, y0 - 3.95, 0, 2.6, 0.25, 0.5, rgb("#3a4150"));
    taper(cab, 0, 0, y0 - 8.0, y0 - 4.6, 2.35, 1.7, 2.2, 1.6, scaleRgb(RED, 0.65), RED);
    taper(cab, 0, 0, y0 - 4.6, y0 - 4.1, 2.2, 1.6, 1.6, 1.0, rgb("#f2f0ec"), rgb("#f6f4f0"));
    cab.box(0, y0 - 4.05, 0, 1.9, 0.3, 1.3, SNOW);
    cab.box(0, y0 - 7.85, 0, 4.8, 0.3, 3.5, rgb("#3a4150"));
    for (const sz of [-1, 1]) {
      for (const sx of [-0.95, 0.95]) cabGlow.quad([sx * 1.0 - 0.5, y0 - 7.0, sz * 1.82], [sx * 1.0 + 0.5, y0 - 7.0, sz * 1.82], [sx * 1.0 + 0.5, y0 - 5.5, sz * 1.82], [sx * 1.0 - 0.5, y0 - 5.5, sz * 1.82], [2.6, 1.6, 0.6], [2.6, 1.6, 0.6], WARM, WARM);
    }
    for (const sx of [-1, 1]) cabGlow.quad([sx * 2.48, y0 - 7.0, -0.8], [sx * 2.48, y0 - 7.0, 0.8], [sx * 2.48, y0 - 5.5, 0.8], [sx * 2.48, y0 - 5.5, -0.8], [2.6, 1.6, 0.6], [2.6, 1.6, 0.6], WARM, WARM);
    const swing: MovingPart = {
      lit: cab,
      glow: cabGlow,
      pivot: [0, y0, 0],
      update(t: number, part: Object3D) {
        const x = Math.sin(t * 0.16) * (PYLON_X - 8);
        part.position.set(x, cableY(x) - y0, 0);
        part.rotation.z = Math.sin(t * 0.9) * 0.035;
        part.rotation.x = Math.sin(t * 0.7 + 1) * 0.02;
      },
    };
    return { lit, glow, moving: [swing], halos: [{ x: -PYLON_X, y: 25.5, z: 3.9, size: 4, colour: [3.0, 0.3, 0.25], alpha: 0.5, twinkle: 0.6 }, { x: PYLON_X, y: 25.5, z: 3.9, size: 4, colour: [3.0, 0.3, 0.25], alpha: 0.5, twinkle: 0.6 }] };
  },
};

// ─── Ski jump ────────────────────────────────────────────────────────────────

const skiJump: LandmarkSpec = {
  footprint: 16,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const WOODC = rgb("#9a6a40");
    const WOODD = rgb("#5b3a22");
    const STEEL = rgb("#6c7a92");
    const RED = rgb("#d8332a");
    const WHITE = rgb("#f2f0ec");
    const BLUE = rgb("#2f6fd0");
    // The in-run profile: steep from the gate, easing out into a gently falling take-off table at the lip.
    const n = 27;
    const zA = -21;
    const zB = 19;
    const prof: { z: number; y: number }[] = [];
    let y = 27;
    for (let i = 0; i < n; i++) {
      const z = zA + ((zB - zA) * i) / (n - 1);
      prof.push({ z, y });
      const ang = z < -6 ? 36 : z < 14 ? 36 - (26 * (z + 6)) / 20 : 10;
      y -= Math.tan((ang * Math.PI) / 180) * ((zB - zA) / (n - 1));
    }
    const W = 2.6;
    const thick = 0.7;
    const row = (xs: number[], dy: number): V3[][] => prof.map((p) => xs.map((x): V3 => [x, p.y - dy, p.z]));
    const grooved = (p: V3, _i: number, j: number): Rgb => (j >= 1 && j <= 4 ? mixRgb(SNOW, [0.6, 0.8, 1.1], Math.abs(p[0]) > 0.9 && Math.abs(p[0]) < 1.6 ? 0.7 : 0.0) : SNOW);
    grid(lit, row([-W, -1.55, -1.2, 1.2, 1.55, W], 0), grooved);
    grid(lit, row([-W, W], thick), byHeight(-1, 27, WOODD, WOODC));
    grid(lit, [prof.map((p): V3 => [-W, p.y, p.z]), prof.map((p): V3 => [-W, p.y - thick, p.z])], byHeight(-1, 27, WOODD, WOODC));
    grid(lit, [prof.map((p): V3 => [W, p.y, p.z]), prof.map((p): V3 => [W, p.y - thick, p.z])], byHeight(-1, 27, WOODD, WOODC));
    // Striped guard boards along both edges.
    for (const s of [-1, 1]) {
      for (let i = 0; i < n - 1; i++) {
        const a = prof[i]!;
        const c = prof[i + 1]!;
        beam(lit, [s * (W + 0.15), a.y + 0.45, a.z], [s * (W + 0.15), c.y + 0.45, c.z], 0.2, 0.9, [1, 0, 0], i % 2 === 0 ? RED : WHITE);
      }
    }
    // The take-off lip: a bright board across the end.
    const last = prof[n - 1]!;
    lit.box(0, last.y - 0.05, last.z + 0.6, W * 2 + 0.4, 0.7, 1.2, ramp(RED, [1.0, 0.45, 0.4]));
    // Supports: pairs of posts every few metres, tied and cross-braced.
    const bents = [0, 3, 6, 9, 12, 15, 18, 21, 24, 26];
    const post = (sx: number, i: number): [V3, V3] => [[sx, -1.2, prof[i]!.z], [sx, prof[i]!.y - thick, prof[i]!.z]];
    bents.forEach((i, bi) => {
      for (const sx of [-1.9, 1.9]) {
        const [a, c] = post(sx, i);
        beam(lit, a, c, 0.55, 0.55, [1, 0, 0], scaleRgb(WOODD, 1.1), WOODC);
        if (bi > 0) {
          const [pa, pc] = post(sx, bents[bi - 1]!);
          beam(lit, [pa[0], pa[1] + 0.4, pa[2]], [c[0], c[1] - 1.5, c[2]], 0.3, 0.3, [1, 0, 0], WOODD);
          beam(lit, [a[0], a[1] + 0.4, a[2]], [pc[0], pc[1] - 1.5, pc[2]], 0.3, 0.3, [1, 0, 0], WOODD);
        }
      }
      const lowY = Math.max(0.3, prof[i]!.y * 0.4);
      beam(lit, [-1.9, lowY, prof[i]!.z], [1.9, lowY, prof[i]!.z], 0.3, 0.3, [0, 1, 0], WOODD);
    });
    // The start tower: four tapering legs, rings, braces, a platform with a gate and a little hut.
    const tz = -24.2;
    const tH = 27;
    const tcorner = (sx: number, sz: number, yy: number): V3 => {
      const hx = 3.6 - (yy / tH) * 0.7;
      const hz = 2.8 - (yy / tH) * 0.4;
      return [sx * hx, yy, tz + sz * hz];
    };
    const lv = [-1, 5, 11, 17, 23, tH];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k < lv.length - 1; k++) beam(lit, tcorner(sx, sz, lv[k]!), tcorner(sx, sz, lv[k + 1]!), 0.65, 0.65, [1, 0, 0], STEEL, STEEL);
    const tfaces: [[number, number], [number, number]][] = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
    for (let k = 0; k < lv.length; k++) {
      for (const [a, c] of tfaces) {
        beam(lit, tcorner(a[0], a[1], lv[k]!), tcorner(c[0], c[1], lv[k]!), 0.38, 0.38, [0, 1, 0], scaleRgb(STEEL, 0.7));
        if (k < lv.length - 1) {
          beam(lit, tcorner(a[0], a[1], lv[k]!), tcorner(c[0], c[1], lv[k + 1]!), 0.3, 0.3, [0, 1, 0], scaleRgb(STEEL, 0.7));
          beam(lit, tcorner(c[0], c[1], lv[k]!), tcorner(a[0], a[1], lv[k + 1]!), 0.3, 0.3, [0, 1, 0], scaleRgb(STEEL, 0.7));
        }
      }
    }
    lit.box(0, tH + 0.1, tz, 7.8, 0.5, 6.2, ramp(WOODD, WOODC));
    lit.box(0, tH + 0.45, tz + 0.2, 7.8, 0.22, 6.2, SNOW_MID);
    // The start gate (a red-and-white frame) and the hut behind it with a glowing window.
    for (const sx of [-1, 1]) lit.post(sx * 2.7, tH + 0.4, tz + 2.4, 0.22, 3.2, WHITE, 6);
    lit.box(0, tH + 3.5, tz + 2.4, 5.8, 0.32, 0.32, RED);
    lit.box(0, tH + 1.9, tz - 0.6, 5.2, 3.2, 3.0, ramp(rgb("#7a4b2c"), rgb("#9d6a40")));
    beam(lit, [0, tH + 5.0, tz - 0.6], [0, tH + 3.2, tz + 1.4], 5.8, 0.35, [1, 0, 0], rgb("#4a2f1c"));
    beam(lit, [0, tH + 5.0, tz - 0.6], [0, tH + 3.2, tz - 2.6], 5.8, 0.35, [1, 0, 0], rgb("#4a2f1c"));
    beam(lit, [0, tH + 5.35, tz - 0.6], [0, tH + 3.75, tz + 1.5], 5.9, 0.6, [1, 0, 0], SNOW_MID, SNOW);
    beam(lit, [0, tH + 5.35, tz - 0.6], [0, tH + 3.75, tz - 2.7], 5.9, 0.6, [1, 0, 0], SNOW_MID, SNOW);
    glow.quad([-1.2, tH + 1.5, tz + 0.95], [1.2, tH + 1.5, tz + 0.95], [1.2, tH + 2.7, tz + 0.95], [-1.2, tH + 2.7, tz + 0.95], WARM);
    // A steep stair up the back of the tower.
    beam(lit, [4.8, -1, tz - 9], [3.9, tH, tz - 3.3], 1.3, 0.3, [1, 0, 0], WOODD, WOODC);
    for (let k = 0; k < 13; k++) {
      const p = vec.lerp([4.8, -1, tz - 9], [3.9, tH, tz - 3.3], (k + 0.5) / 13);
      lit.box(p[0], p[1] + 0.2, p[2], 1.5, 0.12, 0.4, WOODC);
    }
    // Pennants on a mast at the top, and flag poles down both sides of the in-run.
    lit.post(0, tH + 5.2, tz - 0.6, 0.12, 4.0, rgb("#d9d2c0"), 5);
    lit.tri([0.1, tH + 8.8, tz - 0.6], [0.1, tH + 7.6, tz - 0.6], [2.8, tH + 8.4, tz - 0.8], RED, RED, [1.0, 0.4, 0.35]);
    lit.tri([-0.1, tH + 8.5, tz - 0.6], [-0.1, tH + 7.5, tz - 0.6], [-2.3, tH + 8.0, tz - 0.4], BLUE);
    const flagCols = [RED, WHITE, BLUE];
    for (let i = 2, f = 0; i < n - 2; i += 3, f++) {
      for (const s of [-1, 1]) {
        const p = prof[i]!;
        const x = s * (W + 1.2);
        lit.post(x, p.y - 0.8, p.z, 0.1, 6.2, WHITE, 5);
        const top = p.y + 5.2;
        const col = flagCols[(f + (s > 0 ? 1 : 0)) % 3]!;
        lit.quad([x, top, p.z], [x, top, p.z + 2.4], [x, top - 1.3, p.z + 2.2], [x, top - 1.3, p.z], col, scaleRgb(col, 1.1), col, scaleRgb(col, 0.9));
      }
    }
    // The judges' tower to one side: legs, floors, a lit cabin with a red roof and pennants.
    const jx = 13;
    const jz = 8;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lit.post(jx + sx * 2.2, -1, jz + sz * 2.2, 0.28, 8.5, WOODD, 6);
    for (const yy of [2, 5.5]) {
      lit.box(jx, yy, jz, 5.4, 0.3, 5.4, WOODC);
      for (const [a, c] of [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]] as const) beam(lit, [jx + a[0] * 2.2, yy - 3.2, jz + a[1] * 2.2], [jx + c[0] * 2.2, yy + 0.2, jz + c[1] * 2.2], 0.26, 0.26, [0, 1, 0], WOODD);
    }
    lit.box(jx, 10.6, jz, 6.4, 3.4, 5.4, ramp(rgb("#8a5a34"), rgb("#b98250")));
    lit.box(jx, 8.6, jz, 6.8, 0.5, 5.8, WOODD);
    for (const wx of [-1.9, 0, 1.9]) {
      glow.quad([jx + wx - 0.8, 9.8, jz + 2.74], [jx + wx + 0.8, 9.8, jz + 2.74], [jx + wx + 0.8, 11.2, jz + 2.74], [jx + wx - 0.8, 11.2, jz + 2.74], [2.6, 1.6, 0.6], [2.6, 1.6, 0.6], WARM, WARM);
    }
    glow.quad([jx - 3.24, 9.8, jz - 1.8], [jx - 3.24, 9.8, jz + 1.8], [jx - 3.24, 11.2, jz + 1.8], [jx - 3.24, 11.2, jz - 1.8], [2.6, 1.6, 0.6], [2.6, 1.6, 0.6], WARM, WARM);
    beam(lit, [jx, 14.0, jz], [jx, 12.2, jz + 3.6], 7.4, 0.35, [1, 0, 0], rgb("#a52a24"), RED);
    beam(lit, [jx, 14.0, jz], [jx, 12.2, jz - 3.6], 7.4, 0.35, [1, 0, 0], rgb("#a52a24"), RED);
    beam(lit, [jx, 14.4, jz], [jx, 12.6, jz + 3.6], 7.3, 0.55, [1, 0, 0], SNOW_MID, SNOW);
    beam(lit, [jx, 14.4, jz], [jx, 12.6, jz - 3.6], 7.3, 0.55, [1, 0, 0], SNOW_MID, SNOW);
    lit.post(jx + 2.8, 14.0, jz, 0.1, 3.4, WHITE, 5);
    lit.tri([jx + 2.8, 17.2, jz], [jx + 2.8, 16.2, jz], [jx + 2.8, 16.7, jz + 2.4], BLUE);
    lit.post(jx - 2.8, 14.0, jz, 0.1, 3.0, WHITE, 5);
    lit.tri([jx - 2.8, 16.8, jz], [jx - 2.8, 15.8, jz], [jx - 2.8, 16.3, jz + 2.2], RED);
    // Snow drifted against the legs and at the foot of the lip.
    drift(lit, jx + 3, jz + 3.2, 3.2, 1.2, 2.4, snowShade(0, 1.6), 61);
    drift(lit, -1, zB + 2.5, 5, 1.0, 3.4, snowShade(0, 1.4), 62);
    drift(lit, 0, tz + 5.5, 4.4, 1.2, 3.2, snowShade(0, 1.6), 63);
    const halos = [
      { x: jx, y: 10.6, z: jz + 3.6, size: 14, colour: WARM_HALO, alpha: 0.5, twinkle: 0.06 },
      { x: jx - 4.4, y: 10.6, z: jz, size: 10, colour: WARM_HALO, alpha: 0.4, twinkle: 0.06 },
      { x: 0, y: tH + 2.1, z: tz + 2.0, size: 9, colour: WARM_HALO, alpha: 0.45, twinkle: 0.06 },
    ];
    return { lit, glow, halos };
  },
};

// ═════════════════════════════════════════ (more landmarks below) ════════════════

export const LANDMARKS: Record<string, LandmarkSpec> = { igloo, cabin, snowman, "ice-arch": iceArch, "ice-cave": iceCave, "pine-snow": pineSnow, gondola, "ski-jump": skiJump };
// ─── Hazards ─────────────────────────────────────────────────────────────────

const meshOf = (b: MeshBuilder, mat: Material): Mesh => new Mesh(b.build(), mat);

/** A penguin waddling along +z: body rocking, flippers swinging, feet taking turns. */
const penguin: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const body = new Group();
    root.add(body);
    const NAVY = rgb("#232a3c");
    const NAVY_HI = rgb("#3a4560");
    const ORANGE = rgb("#ff9a2a");
    const BELLY: Rgb = [1.35, 1.3, 1.15];
    const b = new MeshBuilder();
    b.blob(0, 0.95, -0.02, 0.5, 0.82, 0.45, ramp(NAVY, NAVY_HI), 1);
    b.blob(0, 0.88, 0.16, 0.4, 0.68, 0.36, ramp([1.0, 0.95, 0.9], BELLY), 1);
    b.blob(0, 1.78, 0.04, 0.31, 0.3, 0.3, ramp(NAVY_HI, NAVY), 1);
    b.blob(0, 1.5, 0.2, 0.24, 0.2, 0.16, ramp(ORANGE, [1.6, 1.3, 0.35]), 0); // the golden throat
    for (const s of [-1, 1]) {
      b.blob(s * 0.2, 1.88, 0.27, 0.1, 0.1, 0.05, rgb("#ffffff"), 0);
      b.blob(s * 0.2, 1.88, 0.31, 0.055, 0.055, 0.03, rgb("#101216"), 0);
      b.blob(s * 0.2, 1.74, 0.26, 0.09, 0.07, 0.06, rgb("#ffb0a8"), 0); // pink cheeks
    }
    b.add(shapes.cone(5), xf(0, 1.74, 0.42, 0.075, 0.32, 0.075, 0, Math.PI / 2 + 0.22), ramp(rgb("#d9701a"), ORANGE));
    b.add(shapes.cone(5), xf(0, 0.55, -0.55, 0.2, 0.5, 0.18, 0, -Math.PI / 2 - 0.5), NAVY); // tail
    // A little red scarf in the track's colours.
    torus(b, 0.27, 0.085, { at: [0, 1.52, 0.02], facing: "y", ringSegments: 10, tubeSegments: 4, shade: stripes(rgb("#d6352e"), rgb("#f5f5ff"), "row", 1) });
    b.box(0.2, 1.3, 0.22, 0.14, 0.55, 0.08, rgb("#d6352e"), 0, 0, 0.1);
    body.add(meshOf(b, ctx.lit));
    const wing = (side: number): Group => {
      const g = new Group();
      g.position.set(side * 0.5, 1.4, 0);
      const f = new MeshBuilder();
      f.blob(side * 0.09, -0.3, 0, 0.07, 0.42, 0.2, ramp(NAVY_HI, NAVY), 0);
      g.add(meshOf(f, ctx.lit));
      body.add(g);
      return g;
    };
    const wings = [wing(-1), wing(1)];
    const foot = (side: number): Group => {
      const g = new Group();
      g.position.set(side * 0.24, 0, 0.05);
      const f = new MeshBuilder();
      f.blob(0, 0.07, 0.14, 0.17, 0.07, 0.3, ramp(rgb("#d9701a"), ORANGE), 0);
      g.add(meshOf(f, ctx.lit));
      root.add(g);
      return g;
    };
    const feet = [foot(-1), foot(1)];
    return {
      root,
      radius: 0.7,
      update(s) {
        // One full waddle (a step with each foot) every 1.4 m of walking.
        const ph = (s.travel / 1.4) * Math.PI * 2;
        body.rotation.z = Math.sin(ph) * 0.14;
        body.rotation.y = Math.sin(ph + 1.2) * 0.05;
        body.position.y = Math.abs(Math.sin(ph)) * 0.05;
        wings[0]!.rotation.z = 0.3 + Math.sin(ph) * 0.4;
        wings[1]!.rotation.z = -0.3 + Math.sin(ph) * 0.4;
        feet[0]!.position.y = Math.max(0, Math.sin(ph)) * 0.13;
        feet[1]!.position.y = Math.max(0, -Math.sin(ph)) * 0.13;
        feet[0]!.position.z = 0.05 + Math.cos(ph) * 0.12;
        feet[1]!.position.z = 0.05 - Math.cos(ph) * 0.12;
      },
    };
  },
};

/** A big rolling snowball: chunky lumps, stones and a stick stuck in it, and a trail of powder. */
const snowball: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const inner = new Group();
    inner.position.y = 1.5;
    root.add(inner);
    const b = new MeshBuilder();
    const shade = byHeight(-1.5, 1.5, SNOW_LOW, SNOW);
    rockBlob(b, 0, 0, 0, 1.45, 1.45, 1.45, shade, 3, { detail: 1, roughness: 0.1 });
    // Packed-on lumps all round, so the outline stays chunky as it turns.
    for (let k = 0; k < 14; k++) {
      const y = 1 - 2 * ((k + 0.5) / 14);
      const r = Math.sqrt(1 - y * y);
      const a = k * 2.399;
      const s = 0.4 + hash(k, 2) * 0.3;
      b.blob(Math.cos(a) * r * 1.28, y * 1.28, Math.sin(a) * r * 1.28, s, s * 0.85, s, ramp(SNOW_MID, SNOW), 0, a);
    }
    // Pebbles and a couple of sticks caught in it.
    for (let k = 0; k < 7; k++) {
      const y = 0.9 - k * 0.3 + (hash(k, 7) - 0.5) * 0.2;
      const r = Math.sqrt(Math.max(0.05, 1 - y * y));
      const a = k * 1.9 + 0.5;
      b.blob(Math.cos(a) * r * 1.55, y * 1.55, Math.sin(a) * r * 1.55, 0.2, 0.15, 0.2, rgb("#59606e"), 0, a);
    }
    for (let k = 0; k < 2; k++) {
      const a = 1.1 + k * 2.6;
      const y = 0.3 - k * 0.6;
      const r = Math.sqrt(1 - y * y);
      const p0: V3 = [Math.cos(a) * r * 1.3, y * 1.3, Math.sin(a) * r * 1.3];
      beam(b, p0, vec.add(p0, vec.mul(vec.norm(p0), 0.9)), 0.17, 0.17, [0, 1, 0], rgb("#5b3d26"));
    }
    inner.add(meshOf(b, ctx.lit));
    // Powder kicked up behind: a few translucent puffs trailing along -z.
    const puffs: Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const pb = new MeshBuilder();
      pb.blob(0, 0, 0, 0.9, 0.55, 0.9, rgb("#e8f0ff"), 0);
      const m = meshOf(pb, hazardGlass());
      root.add(m);
      puffs.push(m);
    }
    return {
      root,
      radius: 1.5,
      update(s) {
        // Rolling without slipping: the turn is the distance over the radius it is drawn at.
        inner.rotation.x = s.travel / (1.5 * root.scale.y);
        puffs.forEach((m, k) => {
          const u = (((s.time * 1.3 + k / 3) % 1) + 1) % 1;
          m.position.set(Math.sin(k * 2.1) * 0.7, 0.4 + u * 0.7, -1.7 - u * 2.2);
          m.scale.setScalar(0.5 + u * 0.9);
        });
      },
    };
  },
};

/** A yeti who pops out of a snow mound to roar: shaggy, blue-faced, tusked, and a bit daft. */
const yeti: HazardSpec = {
  build(ctx) {
    const root = new Group();
    const mound = new Group();
    const figure = new Group();
    root.add(mound, figure);
    const FUR: Rgb[] = [[1.7, 1.55, 1.15], [1.35, 1.3, 1.2], [1.05, 1.1, 1.2], [1.55, 1.45, 1.2]];
    const furAt = (k: number): Rgb => FUR[k % FUR.length]!;
    // The permanent mound the yeti climbs out of: it stays put while the figure rises.
    const m = new MeshBuilder();
    rockBlob(m, 0, 0, 0, 2.3, 1.25, 2.3, byHeight(0, 1.2, SNOW_MID, SNOW), 5, { detail: 1, roughness: 0.1, flatBase: true });
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05;
      rockBlob(m, Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1, 0.8 + hash(k, 1) * 0.5, 0.45, 0.8, snowShade(0, 0.5), k + 9, { detail: 0, roughness: 0.2, flatBase: true });
    }
    mound.add(meshOf(m, ctx.lit));
    // The figure, about 3.2 m tall with its feet at the origin.
    const f = new MeshBuilder();
    const lump = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, k: number, ramped = true) => f.blob(cx, cy, cz, rx, ry, rz, ramped ? ramp(scaleRgb(furAt(k), 0.7), furAt(k)) : furAt(k), 0, k);
    // Legs and feet.
    for (const s of [-1, 1]) {
      lump(s * 0.62, 0.5, 0.05, 0.5, 0.55, 0.5, s + 4);
      lump(s * 0.66, 0.2, 0.45, 0.46, 0.22, 0.55, s + 7);
    }
    // Torso: a big core with shaggy lumps clustered over it.
    f.blob(0, 1.75, 0, 1.15, 1.2, 0.98, ramp(scaleRgb(FUR[1]!, 0.75), FUR[0]!), 1);
    for (let k = 0; k < 44; k++) {
      const y = 1 - 2 * ((k + 0.5) / 44);
      const r = Math.sqrt(1 - y * y);
      const a = k * 2.399;
      const s = 0.26 + hash(k, 3) * 0.14;
      lump(Math.cos(a) * r * 1.1, 1.75 + y * 1.15, Math.sin(a) * r * 0.96, s, s, s, k);
    }
    f.blob(0, 1.5, 0.78, 0.7, 0.8, 0.4, ramp([1.0, 1.0, 1.1], [1.5, 1.5, 1.6]), 0); // pale tummy
    // The head: fur on top, an ice-blue face, huge eyes, a roaring mouth with tusks.
    const head = new Group();
    head.position.set(0, 2.65, 0.1);
    const hb = new MeshBuilder();
    hb.blob(0, 0.1, 0, 0.8, 0.72, 0.74, ramp(scaleRgb(FUR[1]!, 0.85), FUR[0]!), 1);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2;
      hb.blob(Math.cos(a) * 0.6, 0.5 + hash(k, 5) * 0.12, Math.sin(a) * 0.52 - 0.1, 0.22, 0.2, 0.22, ramp(scaleRgb(furAt(k), 0.8), furAt(k)), 0, a);
    }
    hb.blob(0, 0.15, 0.58, 0.58, 0.5, 0.26, ramp(rgb("#5fb6ec"), rgb("#9fdcff")), 1); // the face
    hb.blob(0, -0.08, 0.76, 0.34, 0.25, 0.13, rgb("#37131c"), 0); // open mouth
    hb.blob(0, -0.17, 0.8, 0.2, 0.08, 0.1, rgb("#e0607a"), 0); // tongue
    for (const s of [-1, 1]) {
      hb.add(shapes.cone(5), xf(s * 0.2, -0.0, 0.83, 0.09, 0.28, 0.09, 0, 0, 0), rgb("#fffbea")); // tusks, point up from the lower jaw
      hb.add(shapes.cone(5), xf(s * 0.2, -0.08, 0.84, 0.09, -0.3, 0.09), rgb("#fffbea")); // and one down
      hb.blob(s * 0.27, 0.34, 0.74, 0.2, 0.21, 0.1, rgb("#ffffff"), 1); // eyes
      hb.blob(s * 0.27, 0.33, 0.83, 0.09, 0.1, 0.05, rgb("#101216"), 0);
      hb.blob(s * 0.27, 0.57, 0.7, 0.26, 0.1, 0.12, ramp(scaleRgb(FUR[2]!, 0.8), FUR[2]!), 0, s); // shaggy brows
    }
    head.add(meshOf(hb, ctx.lit));
    figure.add(head);
    // Long arms, raised: a chain of lumps from shoulder to a clawed hand.
    const arms: Group[] = [];
    for (const s of [-1, 1]) {
      const g = new Group();
      g.position.set(s * 1.1, 2.35, 0.05);
      const ab = new MeshBuilder();
      const pts: V3[] = [[s * 0.2, 0.0, 0], [s * 0.45, 0.38, 0.08], [s * 0.7, 0.75, 0.18], [s * 0.95, 1.12, 0.28], [s * 1.12, 1.5, 0.36]];
      pts.forEach((p, k) => {
        const r = 0.36 - k * 0.025;
        ab.blob(p[0], p[1], p[2], r, r, r, ramp(scaleRgb(furAt(k + 1), 0.8), furAt(k + 1)), 0, k);
        ab.blob(p[0] + s * 0.15, p[1] + 0.1, p[2] - 0.1, r * 0.8, r * 0.8, r * 0.8, furAt(k + 2), 0, k + 1);
      });
      for (let c = 0; c < 3; c++) {
        const base: V3 = [s * (1.2 + (c - 1) * 0.12), 1.8, 0.4 + (c - 1) * 0.28];
        ab.add(shapes.cone(5), xf(base[0], base[1] + 0.22, base[2], 0.1, 0.5, 0.1, 0, 0, -s * (c - 1) * 0.35), rgb("#eaf2ff"));
      }
      g.add(meshOf(ab, ctx.lit));
      figure.add(g);
      arms.push(g);
    }
    figure.add(meshOf(f, ctx.lit));
    const jaw = head;
    return {
      root,
      radius: 2,
      update(s) {
        // `height` is in the layer's metres; the model is in its own, so divide the scale out.
        const sc = root.scale.y || 1;
        const h = s.height / sc;
        mound.position.y = -h;
        // The yeti stands on the mound as soon as it is up, and hops a little at the top of its pop.
        const feet = h < 1 ? h : 1 + (h - 1) * 0.3;
        // Deep down it sinks a little further, so nothing but mound shows.
        figure.position.y = feet - h - 0.9 * Math.max(0, Math.min(1, (-h - 1.8) / 1.2));
        const up = Math.max(0, Math.min(1, (h + 2.4) / 2.2)); // arms stay tucked while it is mostly buried
        const roar = 0.5 + 0.5 * Math.sin(s.time * 8);
        arms[0]!.rotation.z = -(1 - up) * 1.1 + Math.sin(s.time * 6) * 0.22 * up;
        arms[1]!.rotation.z = (1 - up) * 1.1 - Math.sin(s.time * 6 + 1.3) * 0.22 * up;
        jaw.rotation.x = -0.12 * up - roar * 0.12 * up;
        jaw.rotation.z = Math.sin(s.time * 8) * 0.04;
        figure.rotation.z = Math.sin(s.time * 5) * 0.035 * up;
        figure.scale.set(1 + roar * 0.02 * up, 1 + roar * 0.03 * up, 1);
      },
    };
  },
};

export const HAZARDS: Record<string, HazardSpec> = { penguin, snowball, yeti };
void Group;
void Mesh;
void arc;
void lathe;
void prism;
void tube;
void ICE_GLOW;
