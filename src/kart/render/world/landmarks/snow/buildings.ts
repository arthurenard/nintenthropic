/**
 * What people have made in the snow: an igloo of stacked snow blocks with a
 * lit tunnel, skis and a sled leaning on it; a log cabin under a deep roof of
 * snow, with lit windows, a porch and a smoking chimney; and a snowman in a top
 * hat, whose scarf streams in the wind.
 */
import type { Object3D } from "three";
import { archBand, byHeight, dome2D, extrudeZ, MeshBuilder, mixRgb, pipe, ramp, rgb, rockBlob, scaleRgb, shapes, stripes, torus, xf, type Rgb, type V3 } from "../kit";
import { beam, disc, drift, hash, icicle, puffPart, vec } from "../rockKit";
import type { Halo, LandmarkSpec, MovingPart } from "../types";
import { SEAM, SNOW, SNOW_LOW, SNOW_MID, snowShade, WARM, WARM_HALO, WOOD, WOOD_DARK } from "./common";

// ─── Igloo ───────────────────────────────────────────────────────────────────

export const igloo: LandmarkSpec = {
  footprint: 9,
  build() {
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
      drift(lit, Math.sin(a) * (R + 1.1), Math.cos(a) * (R + 1.1), 2.6 + hash(k, 1) * 1.4, 0.9 + hash(k, 2) * 0.8, 2.0 + hash(k, 3) * 1.0, snowShade(0, 1.6), k + 3, a);
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
    return { lit, glow, halos, moving: smoke };
  },
};

// ─── Cabin ───────────────────────────────────────────────────────────────────

export const cabin: LandmarkSpec = {
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
    const halos: Halo[] = [];
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
    // Windows with frames, shutters, mullions and a glow; the front has two and a door, and each gable a round one.
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

export const snowman: LandmarkSpec = {
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
      beam(lit, [s * 0.5, 18.45, 2.5], [s * 1.7, 18.8, 2.2], 0.22, 0.2, [0, 0, 1], COAL);
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
