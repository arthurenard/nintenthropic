/**
 * The kitchen's spans, built in the road's frame and bent along it
 * (LandmarkContext.span): the box grater the road runs through, and pairs of
 * giant forks and spoons stuck in the counter either side, leaning in until
 * their heads meet over the road.
 */
import { extrudeZ, grid, MeshBuilder, mixRgb, rgb, scaleRgb, shapes, tube, xf, type Rgb, type V3 } from "../kit";
import type { LandmarkSpec } from "../types";
import { STEEL, STEEL_D, STEEL_L, TAU } from "./common";

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

export const grater: LandmarkSpec = {
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

// ─── Fork arch and spoon arch ────────────────────────────────────────────────

/** Steel for a flat bar: bright at the top, dim at the foot, a little brighter on its faces than its edges. */
const barShade = (top: number) => (y: number, v: number): Rgb => scaleRgb(mixRgb(STEEL_D, STEEL_L, Math.pow(Math.max(0, Math.min(1, y / top)), 0.8)), 1 + 0.05 * v);

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

export const forkArch: LandmarkSpec = {
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

export const spoonArch: LandmarkSpec = {
  span: true,
  defaultSpan: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const base = ctx.halfWidth + 8.6;
    const shade = barShade(34);
    const pairs = Math.max(1, Math.round(ctx.span / 26));
    // The bowl: an ellipse of 16.4 x 11.6 m, scooped 3 m deep, its long axis leaning 50 degrees, cupped side toward the road.
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
