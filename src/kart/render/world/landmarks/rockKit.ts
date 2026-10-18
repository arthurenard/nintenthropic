/**
 * The rock and ice kit the snow, volcano and canyon worlds share, so the three
 * build stone and ice one way: small vector sums, a repeatable hash, beams and
 * tapered boxes, flat discs, icicles, drifts, ribbons, fluted columns, and the
 * noisy arch their tunnels, caves and bridges are swept from. It sits on
 * kit.ts and, like it, writes triangles into a MeshBuilder. The last two
 * helpers serve moving parts: a puff of smoke or steam that rises and fades,
 * and the one translucent material the hazards draw it with.
 */
import { DoubleSide, MeshLambertMaterial, type Material, type Object3D } from "three";
import { grid, MeshBuilder, rockBlob, shapes, xf, type Rgb, type Shade, type V3 } from "./kit";
import type { MovingPart } from "./types";

/** Small sums on [x, y, z] points and directions. */
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

export interface NoisyArchOptions {
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
export function noisyArch(b: MeshBuilder, o: NoisyArchOptions): void {
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
