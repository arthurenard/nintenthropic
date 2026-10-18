/**
 * The ski slope's structures: the gondola, a cabin riding to and fro on a
 * sagging cable between two lattice pylons, and the ski jump with its in-run,
 * start tower and judges' tower.
 */
import type { Object3D } from "three";
import { byHeight, grid, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, torus, tube, xf, type Rgb, type V3 } from "../kit";
import { beam, drift, taper, vec } from "../rockKit";
import type { LandmarkSpec, MovingPart } from "../types";
import { SNOW, SNOW_MID, snowShade, WARM, WARM_HALO } from "./common";

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

export const gondola: LandmarkSpec = {
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

export const skiJump: LandmarkSpec = {
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
