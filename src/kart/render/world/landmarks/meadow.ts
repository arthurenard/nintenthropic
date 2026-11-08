/**
 * The meadow world's landmarks (docs/GRIP_PRIX.md, "What each theme can build"): a bright morning
 * country of farm buildings, a reedy pond, hay, sheep and flowers. Chunky and friendly: every
 * model is a few clean shapes with a dark foot and a bright top, and a few bright accents.
 */
import type { Paint } from "../builder";
import { byHeight, extrudeZ, lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, xf, type Rgb, type Shade, type V3 } from "./kit";
import type { HazardSpec, LandmarkSpec, MovingPart } from "./types";
import * as second from "./meadowSet";

const TAU = Math.PI * 2;

const RED = rgb("#d23a30");
const RED_D = rgb("#8e231f");
const WHITE: Rgb = rgb("#fbf8f0");
const CREAM: Rgb = rgb("#f2e8d0");
const WOOD = rgb("#9a6a3c");
const WOOD_D = rgb("#6b4526");
const STONE = rgb("#9aa0a6");
const STRAW = rgb("#e9c456");
const GRASS = rgb("#4fb33f");
const GRASS_D = rgb("#2f8a35");

/** A convex polygon in the x-y plane, thickened along z and capped at both ends. */
function slab(b: MeshBuilder, poly: readonly (readonly [number, number])[], z0: number, z1: number, shade: Shade, steps = 1): void {
  extrudeZ(b, poly, z0, z1, steps, shade, { closed: true });
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  for (const z of [z0, z1]) {
    const c: V3 = [cx, cy, z];
    const col = (v: V3, k: number): Rgb => (typeof shade === "function" ? shade(v, 0, k) : shade);
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]!;
      const q = poly[(k + 1) % poly.length]!;
      const pa: V3 = [p[0], p[1], z];
      const qa: V3 = [q[0], q[1], z];
      b.tri(c, pa, qa, col(c, 0), col(pa, k), col(qa, k + 1));
    }
  }
}

/** A flat disc lying on the ground (or a plate), `h` thick, `n` sides. */
function disc(b: MeshBuilder, x: number, y: number, z: number, r: number, h: number, paint: Paint, n = 10): void {
  b.add(shapes.cylinder(n), xf(x, y + h / 2, z, r, h, r), paint);
}

/** A cylinder lying along z (axis front-to-back) centred on (x, y, z), length `len`. */
function barrelZ(b: MeshBuilder, x: number, y: number, z: number, r: number, len: number, paint: Paint, n = 12, yaw = 0): void {
  b.add(shapes.cylinder(n), xf(x, y, z, r, len, r, yaw, Math.PI / 2), paint);
}

// ─── Windmill ────────────────────────────────────────────────────────────────

const windmill: LandmarkSpec = {
  footprint: 9,
  build() {
    const lit = new MeshBuilder();
    const plaster = rgb("#f6efe0");
    const stone = rgb("#8e969e");
    // A stone footing sunk into the field, then the tower: eight sides, tapering, banded in plaster and timber.
    lathe(lit, [[0, -1.5], [4.7, -1.5], [4.7, 1.2], [4.25, 1.5], [0, 1.5]], { segments: 8, shade: byHeight(-1.5, 1.5, scaleRgb(stone, 0.6), stone), phase: Math.PI / 8 });
    lathe(lit, [[3.95, 1.4], [3.8, 3.5], [3.3, 6.2], [2.85, 8.4], [2.75, 8.8]], {
      segments: 8,
      phase: Math.PI / 8,
      shade: (p) => mixRgb(scaleRgb(plaster, 0.7), plaster, Math.min(1, (p[1] - 1.4) / 7)),
    });
    // Timber corner posts up the eight corners.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8 + Math.PI / 8;
      const r0 = 3.97;
      const r1 = 2.78;
      lit.rod([Math.cos(a) * r0, 1.5, Math.sin(a) * r0], [Math.cos(a) * r1, 8.6, Math.sin(a) * r1], 0.36, ramp(WOOD_D, WOOD));
    }
    for (const y of [3.4, 6.0]) lathe(lit, [[3.75 - (y - 3.4) * 0.19, y - 0.2], [3.95 - (y - 3.4) * 0.19, y - 0.2], [3.95 - (y - 3.4) * 0.19, y + 0.2], [3.75 - (y - 3.4) * 0.19, y + 0.2]], { segments: 8, phase: Math.PI / 8, shade: WOOD });
    // The door, with a stone step, and windows with white frames.
    lit.box(0, 2.35, 3.9, 2.3, 3.2, 0.5, ramp(WOOD_D, WOOD));
    lit.box(0, 4.0, 3.95, 2.3, 0.7, 0.5, ramp(WOOD_D, WOOD), 0, 0, 0);
    lit.box(0, 1.25, 4.6, 3.2, 0.5, 1.4, ramp(scaleRgb(stone, 0.8), stone));
    lit.box(0.7, 2.3, 4.2, 0.28, 0.28, 0.2, rgb("#e8c04a"));
    for (const [wx, wz, ry] of [[2.4, 2.3, 0.9], [-2.4, 2.3, -0.9], [0, -3.1, Math.PI]] as const) {
      lit.box(wx, 5.4, wz, 1.4, 1.8, 0.5, WHITE, ry);
      lit.box(wx + Math.cos(ry) * 0.04, 5.4, wz - Math.sin(ry) * 0.04 + 0.14 * Math.cos(ry), 0.9, 1.2, 0.3, rgb("#4a6fa0"), ry);
    }
    // A timber gallery half way up: a ring of boards and a rail of posts.
    lathe(lit, [[3.6, 6.5], [4.6, 6.5], [4.6, 6.8], [3.6, 6.8]], { segments: 8, phase: Math.PI / 8, shade: WOOD });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      lit.post(Math.cos(a) * 4.5, 6.8, Math.sin(a) * 4.5, 0.12, 1.0, WOOD_D, 4);
    }
    lathe(lit, [[4.4, 7.7], [4.62, 7.7], [4.62, 7.95], [4.4, 7.95]], { segments: 16, shade: WOOD });
    // The cap: a red shingled cone with a wide eave, a ridge of darker courses, and a spike.
    lathe(lit, [[3.1, 8.5], [3.4, 8.9], [2.9, 10.5], [2.1, 11.9], [1.0, 12.9], [0, 13.5]], {
      segments: 8,
      phase: Math.PI / 8,
      shade: (p, i) => scaleRgb(mixRgb(RED_D, RED, Math.min(1, (p[1] - 8.5) / 5)), i % 2 === 0 ? 1 : 0.88),
    });
    lit.post(0, 13.4, 0, 0.1, 1.6, WOOD_D, 4);
    // The axle housing and the hub that carries the sails.
    const hub: V3 = [0, 10.0, 3.2];
    barrelZ(lit, 0, 10.0, 2.7, 0.75, 2.2, ramp(WOOD_D, WOOD), 8);
    lit.add(shapes.cone(8), xf(0, 10.0, 4.2, 0.7, 1.0, 0.7, 0, Math.PI / 2), rgb("#e8c04a"));
    // A tail pole running to the ground behind, with a stone to steady it.
    lit.rod([0, 10.2, -2.6], [0, 0.4, -9.5], 0.38, ramp(WOOD_D, WOOD));
    lit.blob(0, 0.5, -9.8, 0.9, 0.55, 0.9, stone, 0);
    // Sacks of flour at the door.
    for (const [sx, sz, h] of [[-2.8, 5.0, 1.0], [-3.8, 4.4, 0.9], [3.2, 5.2, 1.1]] as const) {
      lit.blob(sx, h * 0.55, sz, 0.75, h * 0.6, 0.65, ramp(scaleRgb(CREAM, 0.75), CREAM), 0);
      lit.blob(sx, h * 1.1, sz, 0.28, 0.22, 0.28, scaleRgb(CREAM, 0.85), 0);
    }

    // The sails: four lattice arms on the hub, each a long timber with a rail, slats and a cloth.
    const sails = new MeshBuilder();
    const cloth = rgb("#fff4dc");
    for (let k = 0; k < 4; k++) {
      const th = (k * Math.PI) / 2 + 0.3;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const at = (dx: number, dy: number, dz = 0): V3 => [hub[0] + dx * c - dy * s, hub[1] + dx * s + dy * c, hub[2] + dz];
      sails.rod(at(0, 0.6), at(0, 7.2), 0.34, WOOD_D);
      sails.rod(at(-1.6, 1.4), at(-1.6, 7.0), 0.22, WOOD);
      sails.rod(at(0, 7.2), at(-1.6, 7.0), 0.22, WOOD);
      sails.rod(at(0, 1.4), at(-1.6, 1.4), 0.22, WOOD);
      for (let j = 0; j < 7; j++) sails.rod(at(0, 1.7 + j * 0.85), at(-1.6, 1.7 + j * 0.85), 0.18, WOOD);
      // The cloth: a pale panel behind the slats, slightly proud of the arm's plane.
      const cx = (at(-0.8, 4.2)[0]);
      const cy = (at(-0.8, 4.2)[1]);
      sails.add(shapes.box(), xf(cx, cy, hub[2] - 0.12, 1.5, 5.4, 0.16, 0, 0, th), ramp(scaleRgb(cloth, 0.85), cloth));
    }
    sails.blob(hub[0], hub[1], hub[2] + 0.3, 0.85, 0.85, 0.7, rgb("#e8c04a"), 1);
    const moving: MovingPart[] = [
      {
        lit: sails,
        pivot: hub,
        update(t, part) {
          part.rotation.z = -t * 0.55;
        },
      },
    ];
    return { lit, moving };
  },
};

// ─── Barn ────────────────────────────────────────────────────────────────────

const barn: LandmarkSpec = {
  footprint: 18,
  build() {
    const lit = new MeshBuilder();
    const W = 8.2;
    const L = 12;
    const board = (y0: number, y1: number): Shade => (p, i) => scaleRgb(mixRgb(RED_D, RED, Math.min(1, Math.max(0, (p[1] - y0) / (y1 - y0)))), i % 2 === 0 ? 1.0 : 0.93);
    // Walls and gambrel gable in one section, with vertical boards (every metre alternates).
    const section: [number, number][] = [[W, -1.4], [W, 7], [5.6, 10.6], [0, 13.2], [-5.6, 10.6], [-W, 7], [-W, -1.4]];
    slab(lit, section, -L, L, board(0, 13), 24);
    // A stone footing band.
    lit.box(0, 0.25, 0, 2 * W + 0.5, 0.9, 2 * L + 0.5, ramp(scaleRgb(STONE, 0.6), STONE));
    // The roof: four slabs of dark slate shingles, with overhang at the eaves and gables, and a ridge cap.
    const slate = rgb("#4c5568");
    const slateL = rgb("#6b7690");
    for (const s of [-1, 1]) {
      for (const [ax, ay, bx, by] of [[W + 0.6, 6.7, 5.6, 10.6], [5.6, 10.6, 0.2, 13.5]] as const) {
        const x0 = s * ax;
        const x1 = s * bx;
        const dx = x1 - x0;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        // Four courses per slope, alternating shade, laid along the slope.
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4;
          const cx = x0 + dx * t;
          const cy = ay + dy * t;
          lit.box(cx - Math.sin(ang) * 0.3, cy + Math.cos(ang) * 0.3, 0, len / 4 + 0.02, 0.5, 2 * L + 1.8, ramp(k % 2 === 0 ? slate : slateL, k % 2 === 0 ? slateL : slate), 0, 0, ang);
        }
      }
    }
    lit.box(0, 13.65, 0, 1.0, 0.5, 2 * L + 2, rgb("#2f3644"));
    // The big front doors with white trim and X braces.
    const f = L;
    const doorW = 3.5;
    for (const sx of [-1, 1]) {
      lit.box(sx * doorW * 0.5, 3.55, f + 0.1, doorW, 7.1, 0.4, ramp(scaleRgb(RED_D, 0.85), scaleRgb(RED, 0.95)));
    }
    lit.box(0, 3.55, f + 0.05, 0.3, 7.2, 0.5, rgb("#1e1612"));
    const trim = WHITE;
    for (const sx of [-1, 1]) {
      lit.box(sx * (doorW + 0.35), 3.7, f + 0.28, 0.5, 7.5, 0.36, trim);
    }
    lit.box(0, 7.3, f + 0.28, 2 * doorW + 1.2, 0.55, 0.36, trim);
    for (const sx of [-1, 1]) {
      const cx = sx * doorW * 0.5;
      lit.rod([cx - doorW * 0.46, 0.5, f + 0.38], [cx + doorW * 0.46, 6.7, f + 0.38], 0.36, trim);
      lit.rod([cx + doorW * 0.46, 0.5, f + 0.38], [cx - doorW * 0.46, 6.7, f + 0.38], 0.36, trim);
      lit.box(cx, 3.6, f + 0.34, doorW - 0.25, 0.4, 0.2, trim);
      lit.box(cx - doorW * 0.34 * sx, 3.5, f + 0.3, 0.36, 0.6, 0.4, rgb("#2a2420"));
    }
    // The hayloft door above, open on a tuft of hay, with a hoist beam out of the gable.
    lit.box(0, 10.4, f - 0.5 + 0.3, 3.2, 2.7, 0.5, trim);
    lit.box(0, 10.4, f - 0.5 + 0.55, 2.4, 2.0, 0.3, rgb("#2a2018"));
    lit.blob(0, 9.7, f + 0.1, 1.0, 0.6, 0.5, STRAW, 0);
    lit.blob(0.5, 10.1, f - 0.1, 0.5, 0.4, 0.4, scaleRgb(STRAW, 0.9), 0);
    lit.rod([0, 12.3, f - 0.4], [0, 12.3, f + 2.2], 0.3, WOOD_D);
    lit.rod([0, 12.3, f + 2.1], [0, 11.0, f + 2.1], 0.14, rgb("#2a2018"));
    lit.blob(0, 10.8, f + 2.1, 0.25, 0.25, 0.25, rgb("#8c8c94"), 0);
    // Side windows with white crosses.
    for (const sx of [-1, 1]) {
      for (const z of [-6, 0, 6]) {
        lit.box(sx * (W + 0.05), 5.0, z, 0.3, 1.8, 1.8, trim);
        lit.box(sx * (W + 0.15), 5.0, z, 0.2, 1.3, 1.3, rgb("#35405a"));
        lit.box(sx * (W + 0.24), 5.0, z, 0.1, 1.4, 0.18, trim);
        lit.box(sx * (W + 0.24), 5.0, z, 0.1, 0.18, 1.4, trim);
      }
    }
    // A weathervane on the ridge: a pole, a crossed pair of letters' bars, an arrow and a rooster.
    const wz = f - 3;
    lit.post(0, 13.9, wz, 0.12, 3.6, rgb("#2a2a30"), 4);
    lit.rod([-1.2, 15.4, wz], [1.2, 15.4, wz], 0.1, rgb("#2a2a30"));
    lit.rod([0, 15.4, wz - 1.2], [0, 15.4, wz + 1.2], 0.1, rgb("#2a2a30"));
    lit.rod([-2.0, 17.1, wz], [2.2, 17.1, wz], 0.16, rgb("#b8862a"));
    lit.add(shapes.cone(4), xf(2.4, 17.1, wz, 0.5, 0.9, 0.2, 0, 0, -Math.PI / 2), rgb("#b8862a"));
    lit.add(shapes.ball(0), xf(-2.1, 17.4, wz, 0.2, 0.9, 0.12, 0, 0, 0.3), rgb("#b8862a"));
    lit.blob(0, 18.0, wz, 0.65, 0.45, 0.14, rgb("#2a2a30"), 0);
    lit.blob(0.45, 18.55, wz, 0.22, 0.28, 0.12, rgb("#2a2a30"), 0);
    lit.add(shapes.ball(0), xf(-0.5, 18.5, wz, 0.12, 0.45, 0.1, 0, 0, 0.5), rgb("#2a2a30"));
    // A silo against the back corner: a tall cylinder with a dome and a few bands.
    lathe(lit, [[0, -1.2], [2.9, -1.2], [2.9, 15.5], [2.5, 16.2], [1.6, 17.0], [0, 17.6]], {
      at: [W + 3.6, 0, -L + 3.5],
      segments: 14,
      shade: (p) => mixRgb(scaleRgb(rgb("#c9ced6"), 0.7), rgb("#eef1f5"), Math.min(1, p[1] / 14)),
    });
    for (const y of [3, 6.5, 10, 13.5]) lathe(lit, [[2.9, y - 0.15], [3.05, y - 0.15], [3.05, y + 0.15], [2.9, y + 0.15]], { at: [W + 3.6, 0, -L + 3.5], segments: 14, shade: rgb("#6c7480") });
    // Hay bales by the doors.
    for (const [bx, by, bz, yw] of [[-8, 0.75, f + 4, 0.2], [-5.4, 0.75, f + 4.6, -0.1], [-6.9, 2.25, f + 4.3, 0.05]] as const) lit.box(bx, by, bz, 2.8, 1.5, 1.6, ramp(scaleRgb(STRAW, 0.75), STRAW), yw);
    return { lit };
  },
};

// ─── Pond ────────────────────────────────────────────────────────────────────

const pond: LandmarkSpec = {
  footprint: 16,
  build(ctx) {
    const lit = new MeshBuilder();
    const glass = new MeshBuilder();
    const R = 13;
    // The bank: a low rim of mud and grass round the water.
    lathe(lit, [[R - 1.8, 0.25], [R - 0.8, 0.5], [R + 1.5, 0.45], [R + 2.6, 0.0], [R + 3.0, -0.6]], {
      segments: 24,
      shade: (_p, i) => (i < 2 ? rgb("#6b5a3a") : mixRgb(rgb("#6b5a3a"), GRASS_D, Math.min(1, i / 3))),
    });
    // The water: a disc of glass, deep teal in the middle and light turquoise at the edge, with a ring of paler ripple.
    const rings: V3[][] = [];
    const radii = [0, 0.4, 0.7, 0.9, 1.0];
    for (const f of radii) {
      const row: V3[] = [];
      for (let k = 0; k < 24; k++) row.push([Math.cos((k / 24) * TAU) * (R - 0.9) * f, 0.3, Math.sin((k / 24) * TAU) * (R - 0.9) * f]);
      rings.push(row);
    }
    // Written out as quads so each ring carries its own colour.
    for (let i = 0; i < rings.length - 1; i++) {
      const t0 = radii[i]!;
      const t1 = radii[i + 1]!;
      const c0: Rgb = mixRgb([0.05, 0.38, 0.55], [0.35, 0.95, 1.05], Math.pow(t0, 1.4));
      const c1: Rgb = mixRgb([0.05, 0.38, 0.55], [0.35, 0.95, 1.05], Math.pow(t1, 1.4));
      for (let k = 0; k < 24; k++) {
        const k2 = (k + 1) % 24;
        glass.quad(rings[i]![k]!, rings[i]![k2]!, rings[i + 1]![k2]!, rings[i + 1]![k]!, c0, c0, c1, c1);
      }
    }
    // Stones round the edge.
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU + 0.2;
      const r = R + 0.3 + 0.8 * Math.sin(k * 2.1);
      lit.blob(Math.cos(a) * r, 0.35, Math.sin(a) * r, 0.9 + 0.3 * Math.sin(k * 3.3), 0.6, 0.8, ramp(scaleRgb(STONE, 0.7), STONE), 0, k);
    }
    // Reeds: clusters of tall thin cones, with brown cattail heads on some.
    const reedAt: [number, number][] = [];
    for (let k = 0; k < 11; k++) reedAt.push([((k * 0.57 + 0.15) % 1) * TAU, R - 0.4 + 0.5 * Math.sin(k)]);
    reedAt.forEach(([a, r], idx) => {
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const count = 4 + (idx % 3);
      for (let m = 0; m < count; m++) {
        const ox = (ctx.rnd() - 0.5) * 1.4;
        const oz = (ctx.rnd() - 0.5) * 1.4;
        const h = 3.2 + ctx.rnd() * 2.6;
        lit.add(shapes.cone(4), xf(cx + ox, h / 2, cz + oz, 0.22, h, 0.22, ctx.rnd() * 3, (ctx.rnd() - 0.5) * 0.22, (ctx.rnd() - 0.5) * 0.22), ramp(GRASS_D, rgb("#9ad04a")));
        if (m === 0 && idx % 2 === 0) lit.post(cx + ox, h - 1.1, cz + oz, 0.2, 1.1, rgb("#6b3f1f"), 5);
      }
    });
    // Lily pads, each a flat green disc, some with a pink bloom.
    const pads: [number, number, number, boolean][] = [[-3.5, -2.4, 1.5, true], [1.8, -4.8, 1.1, false], [3.4, 2.2, 1.7, true], [-5.6, 3.2, 1.2, false], [-1.0, 4.4, 1.0, true], [6.2, -1.8, 1.0, false], [-7.0, -0.6, 1.4, true]];
    for (const [px, pz, pr, bloom] of pads) {
      disc(lit, px, 0.3, pz, pr, 0.12, ramp(scaleRgb(GRASS_D, 0.9), rgb("#7ccf4a")), 10);
      lit.box(px + pr * 0.5, 0.4, pz, pr * 0.9, 0.06, 0.12, rgb("#6bbfd0"), 0);
      if (bloom) {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * TAU;
          lit.add(shapes.cone(4), xf(px + Math.cos(a) * 0.38, 0.62, pz + Math.sin(a) * 0.38, 0.22, 0.6, 0.22, 0, Math.sin(a) * 0.9, -Math.cos(a) * 0.9), ramp(rgb("#e0509a"), rgb("#ffd0e6")));
        }
        lit.blob(px, 0.5, pz, 0.2, 0.2, 0.2, rgb("#ffd34d"), 0);
      }
    }
    // A frog sitting on one pad.
    lit.blob(3.5, 0.65, 2.3, 0.4, 0.28, 0.5, rgb("#58c04a"), 0);
    lit.blob(3.38, 0.9, 2.55, 0.12, 0.12, 0.12, rgb("#fff"), 0);
    lit.blob(3.62, 0.9, 2.55, 0.12, 0.12, 0.12, rgb("#fff"), 0);
    // The jetty: planks on posts, out over the water from the road-side bank.
    const jx = 0;
    for (let k = 0; k < 11; k++) lit.box(jx, 0.95, R + 1.2 - k * 1.0, 3.0, 0.22, 0.88, ramp(WOOD_D, WOOD));
    for (const sx of [-1, 1]) {
      lit.box(sx * 1.45, 0.75, R - 3.8, 0.28, 0.3, 11.6, WOOD_D);
      for (const z of [R + 1.4, R - 2.2, R - 5.8, R - 8.6]) lit.post(sx * 1.55, -0.6, z, 0.2, 2.3, ramp(WOOD_D, WOOD), 6);
    }
    // A coil of rope and a bucket at the bank end of the jetty.
    disc(lit, -0.8, 1.06, R + 0.2, 0.55, 0.26, rgb("#c8a266"), 8);
    lathe(lit, [[0, 1.06], [0.45, 1.06], [0.55, 1.7], [0.0, 1.6]], { at: [1.0, 0, R + 0.5], segments: 8, shade: byHeight(1, 1.7, scaleRgb(WOOD, 0.7), WOOD) });
    const boat: V3[][] = [];
    for (let i = 0; i <= 6; i++) {
      const z = -2.2 + (i / 6) * 4.4;
      const w = 0.9 * Math.sqrt(Math.max(0.02, 1 - Math.pow(z / 2.3, 2)));
      boat.push([[-w + 4.2, 0.75, z + R - 4.5], [-w * 0.7 + 4.2, 0.3, z + R - 4.5], [w * 0.7 + 4.2, 0.3, z + R - 4.5], [w + 4.2, 0.75, z + R - 4.5]]);
    }
    for (let i = 0; i < boat.length - 1; i++) {
      const A = boat[i]!;
      const Bn = boat[i + 1]!;
      for (let j = 0; j < 3; j++) lit.quad(A[j]!, A[j + 1]!, Bn[j + 1]!, Bn[j]!, i % 2 === 0 ? RED : RED_D, WHITE, WHITE, RED_D);
    }
    lit.box(4.2, 0.78, R - 4.5, 1.2, 0.12, 0.6, WOOD);
    lit.rod([2.4, 1.0, R - 3.5], [3.4, 0.8, R - 3.9], 0.12, rgb("#d9c9a0"));
    return { lit, glass };
  },
};

// ─── Hay bales ───────────────────────────────────────────────────────────────

/** A square bale: a straw block with two loops of twine. */
function squareBale(b: MeshBuilder, x: number, y: number, z: number, yaw: number, rnd: () => number): void {
  const straw = mixRgb(STRAW, rgb("#f4d878"), rnd() * 0.5);
  b.box(x, y + 1.0, z, 4.4, 2.0, 2.5, ramp(scaleRgb(straw, 0.68), straw), yaw);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (const lx of [-1.2, 1.2]) {
    b.box(x + lx * c, y + 1.0, z - lx * s, 0.2, 2.1, 2.6, rgb("#5c4a2a"), yaw);
    b.box(x + lx * c, y + 1.0, z - lx * s, 0.24, 2.0, 2.54, rgb("#7a6236"), yaw);
  }
  // A few loose stalks sticking out.
  for (let k = 0; k < 4; k++) b.rod([x + (rnd() - 0.5) * 3.6, y + 1.9, z + (rnd() - 0.5) * 1.8], [x + (rnd() - 0.5) * 4, y + 2.7, z + (rnd() - 0.5) * 2], 0.18, straw);
}

/** A round bale standing on its rim, its circular face to the front: rings of straw, a net of twine. */
function roundBale(b: MeshBuilder, x: number, y: number, z: number, r: number, len: number, rnd: () => number): void {
  const straw = mixRgb(STRAW, rgb("#f4d878"), rnd() * 0.4);
  barrelZ(b, x, y + r, z, r, len, ramp(scaleRgb(straw, 0.65), straw), 14);
  for (const sgn of [-1, 1]) {
    const fz = z + sgn * (len / 2 + 0.03);
    for (const [k, col] of [[0.88, scaleRgb(straw, 0.88)], [0.62, scaleRgb(straw, 1.05)], [0.38, scaleRgb(straw, 0.85)], [0.16, scaleRgb(straw, 1.1)]] as const) {
      b.add(shapes.cylinder(14), xf(x, y + r, fz + sgn * (1 - k) * 0.06, r * k, 0.08, r * k, 0, Math.PI / 2), col);
    }
  }
  // Twine in two bands round the circumference.
  for (const dz of [-len * 0.28, len * 0.28]) barrelZ(b, x, y + r, z + dz, r + 0.06, 0.16, rgb("#4f3d22"), 14);
}

const hayBales: LandmarkSpec = {
  footprint: 10,
  build(ctx) {
    const lit = new MeshBuilder();
    // A pyramid of six square bales (3, 2, 1) laid alternately a little askew.
    const rnd = ctx.rnd;
    const rows: [number, number, number][][] = [
      [[-4.6, 0, 0.1], [0, 0, -0.1], [4.6, 0, 0.05]],
      [[-2.3, 2.0, 0.1], [2.3, 2.0, -0.08]],
      [[0, 4.0, 0.06]],
    ];
    rows.forEach((row) => row.forEach(([x, y, yaw]) => squareBale(lit, x, y - 0.05, 0, yaw, rnd)));
    // Three round bales beside: two on the grass, one on top of them.
    roundBale(lit, 9.8, -0.05, 1.6, 2.1, 2.3, rnd);
    roundBale(lit, 14.0, -0.05, 1.2, 2.1, 2.3, rnd);
    roundBale(lit, 11.9, 3.6, 1.4, 1.9, 2.2, rnd);
    // A loose scatter of straw on the ground.
    for (let k = 0; k < 14; k++) {
      const a = rnd() * TAU;
      const r = 6 + rnd() * 8;
      lit.blob(Math.cos(a) * r - 1, 0.1, Math.sin(a) * r + 3, 0.5 + rnd() * 0.4, 0.14, 0.3, STRAW, 0, a);
    }
    // A pitchfork stuck in the top bale, leaning back: a long handle, a crossbar and three tines.
    const fx = 1.6;
    const fy = 5.8;
    const fz = 0.2;
    const wood = ramp(WOOD_D, WOOD);
    lit.rod([fx, fy + 0.4, fz], [fx - 1.5, fy + 7.4, fz - 2.4], 0.3, wood);
    lit.rod([fx - 0.7, fy + 0.5, fz - 0.1], [fx + 0.7, fy + 0.5, fz + 0.1], 0.24, rgb("#7a828c"));
    for (const dx of [-0.7, 0, 0.7]) lit.rod([fx + dx, fy + 0.5, fz + dx * 0.2], [fx + dx * 1.1, fy - 1.3, fz + dx * 0.25 + 0.15], 0.18, rgb("#aab2bc"));
    return { lit };
  },
};

// ─── Hot-air balloon ─────────────────────────────────────────────────────────

const hotAirBalloon: LandmarkSpec = {
  footprint: 12,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const base = 35;
    const hook: V3 = [0, base - 2.6, 0];
    // The envelope: an onion of panels, striped red, white, yellow and blue, with a bright skirt.
    const pal: Rgb[] = [rgb("#e23b32"), rgb("#fbf6ea"), rgb("#f2c230"), rgb("#2f78d6")];
    const env = new MeshBuilder();
    lathe(env, [[2.5, base + 4.4], [3.5, base + 6], [5.8, base + 9], [7.6, base + 13], [8.0, base + 17], [7.2, base + 21], [5.2, base + 25], [2.8, base + 28], [0, base + 29.6]], {
      segments: 12,
      shade: (p, i, j) => {
        const c = pal[j % pal.length]!;
        const t = Math.min(1, Math.max(0, (p[1] - (base + 4)) / 26));
        return scaleRgb(c, 0.95 + 0.35 * Math.pow(t, 0.7));
      },
    });
    // A wide golden band and the burner's collar.
    lathe(env, [[7.95, base + 15.6], [8.1, base + 15.6], [8.1, base + 16.6], [7.95, base + 16.6]], { segments: 12, shade: rgb("#e8b830") });
    lathe(env, [[2.5, base + 3.6], [2.7, base + 3.6], [2.7, base + 4.6], [2.5, base + 4.6]], { segments: 12, shade: rgb("#3a3a42") });
    // The basket: wicker with a rim, and four posts up to the skirt.
    const wick = rgb("#b8864a");
    env.box(0, base - 0.2, 0, 3.4, 2.2, 3.4, ramp(scaleRgb(wick, 0.7), wick));
    env.box(0, base + 0.95, 0, 3.7, 0.3, 3.7, scaleRgb(wick, 1.15));
    for (let k = 0; k < 4; k++) env.box(0, base - 0.4 + (k - 1.5) * 0.0, 1.72, 3.4, 0.14, 0.12, scaleRgb(wick, 0.75));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) env.rod([sx * 1.65, base + 0.9, sz * 1.65], [sx * 2.3, base + 4.4, sz * 2.3], 0.22, rgb("#5a4a3a"));
    // Two passengers' heads and hats over the rim.
    env.blob(-0.7, base + 1.5, 0.4, 0.5, 0.5, 0.5, rgb("#f1c9a0"), 1);
    env.blob(-0.7, base + 1.9, 0.4, 0.62, 0.32, 0.62, rgb("#d23a30"), 1);
    env.blob(0.8, base + 1.4, -0.2, 0.46, 0.46, 0.46, rgb("#e0b088"), 1);
    env.blob(0.8, base + 1.82, -0.2, 0.58, 0.3, 0.58, rgb("#2f78d6"), 1);
    // Ropes between the hook below the basket and the ground: short chains to the basket here, long lines on the ground below.
    env.rod([0, base - 1.3, 0], hook, 0.3, rgb("#5a4a3a"));
    // The burner: a flame in glow, and a brass box.
    env.box(0, base + 3.7, 0, 0.8, 0.5, 0.8, rgb("#b8862a"));
    const flame = new MeshBuilder();
    flame.add(shapes.cone(6), xf(0, base + 5.1, 0, 0.7, 2.4, 0.7), [3.4, 1.7, 0.4]);
    flame.add(shapes.cone(6), xf(0, base + 4.7, 0, 0.35, 1.5, 0.35), [4.2, 3.4, 1.4]);
    // The static lines: a pole by the field with a flag, three lines up to the hook, and pegs.
    const pole = 7;
    lit.post(7, -0.6, 0, 0.28, pole + 0.6, ramp(WOOD_D, WOOD), 6);
    lit.box(7.9, pole - 0.7, 0, 1.6, 1.0, 0.14, rgb("#e23b32"));
    lit.blob(7, pole + 0.2, 0, 0.4, 0.4, 0.4, rgb("#e8b830"), 0);
    lit.rod([7, pole, 0], [0, base - 3.6, 0], 0.2, rgb("#5a4a3a"));
    for (const [px, pz] of [[-7, 4], [-3, -7.5]] as const) {
      lit.rod([px, 0.3, pz], [0, base - 3.6, 0], 0.2, rgb("#5a4a3a"));
      lit.post(px, -0.5, pz, 0.2, 1.1, WOOD_D, 5);
    }
    lit.rod([0, base - 3.6, 0], hook, 0.3, rgb("#5a4a3a"));
    const moving: MovingPart[] = [
      {
        lit: env,
        glow: flame,
        pivot: [0, base, 0],
        update(t, part) {
          part.position.y = Math.sin(t * 0.7) * 0.7;
          part.rotation.y = Math.sin(t * 0.3) * 0.12;
          part.rotation.z = Math.sin(t * 0.5) * 0.015;
        },
      },
    ];
    const halos = [{ x: 0, y: base + 5, z: 0, size: 7, colour: [3.2, 1.7, 0.5] as const, alpha: 0.5, twinkle: 0.4 }];
    return { lit, glow, moving, halos };
  },
};

// ─── Sheep ───────────────────────────────────────────────────────────────────

/** One sheep (or lamb) at (x, z) facing `yaw`: clustered lumps of wool, a dark face and four dark legs. */
function sheep(b: MeshBuilder, x: number, z: number, yaw: number, k: number, headDown: boolean, rnd: () => number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Local to world: lx across the body, ly up, lz the way it faces.
  const P = (lx: number, ly: number, lz: number): V3 => [x + (lx * c + lz * s) * k, ly * k, z + (-lx * s + lz * c) * k];
  const wool = rgb("#f7f3e6");
  const woolD = scaleRgb(wool, 0.72);
  const face = rgb("#3b3432");
  // Legs first, dark and thick.
  for (const [lx, lz] of [[-0.42, 0.62], [0.42, 0.62], [-0.42, -0.62], [0.42, -0.62]] as const) {
    const p = P(lx, 0, lz);
    b.post(p[0], 0, p[2], 0.15 * k, 0.78 * k, ramp(scaleRgb(face, 0.8), face), 5);
    const q = P(lx, 0.04, lz + 0.05);
    b.blob(q[0], 0.06 * k, q[2], 0.17 * k, 0.07 * k, 0.2 * k, scaleRgb(face, 0.7), 0);
  }
  // The fleece: a big body lump and a ring of smaller ones round it.
  const lumps: [number, number, number, number, number][] = [
    [0, 1.2, 0, 0.9, 0.78],
    [0.55, 1.15, 0.45, 0.55, 0.5],
    [-0.55, 1.15, 0.45, 0.55, 0.5],
    [0.6, 1.1, -0.45, 0.55, 0.5],
    [-0.6, 1.12, -0.45, 0.55, 0.5],
    [0, 1.55, -0.1, 0.62, 0.52],
    [0, 1.1, -0.9, 0.45, 0.42],
  ];
  for (const [lx, ly, lz, rr, ry] of lumps) {
    const p = P(lx, ly, lz);
    b.blob(p[0], p[1], p[2], rr * k, ry * k, rr * k, ramp(woolD, wool), rr > 0.8 ? 1 : 0, yaw + rnd());
  }
  // The head: a dark wedge on a short neck, with ears, eyes, and a woolly topknot.
  const hy = headDown ? 0.55 : 1.45;
  const hz = headDown ? 1.35 : 1.15;
  const head = P(0, hy, hz);
  b.blob(head[0], head[1], head[2], 0.3 * k, 0.32 * k, 0.4 * k, ramp(scaleRgb(face, 0.8), mixRgb(face, [0.5, 0.45, 0.42], 0.3)), 1, yaw);
  const nose = P(0, hy - 0.04, hz + 0.32);
  b.blob(nose[0], nose[1], nose[2], 0.17 * k, 0.15 * k, 0.17 * k, rgb("#d9a9a0"), 0);
  for (const ex of [-1, 1]) {
    const e = P(ex * 0.34, hy + 0.1, hz - 0.1);
    b.blob(e[0], e[1], e[2], 0.22 * k, 0.09 * k, 0.12 * k, face, 0, yaw + ex * 0.4);
    const eye = P(ex * 0.18, hy + 0.12, hz + 0.18);
    b.blob(eye[0], eye[1], eye[2], 0.06 * k, 0.06 * k, 0.06 * k, [1.2, 1.2, 1.1], 0);
  }
  const top = P(0, hy + 0.3, hz - 0.1);
  b.blob(top[0], top[1], top[2], 0.28 * k, 0.2 * k, 0.28 * k, wool, 0);
  if (!headDown) {
    const neck = P(0, 1.25, 0.8);
    b.blob(neck[0], neck[1], neck[2], 0.28 * k, 0.4 * k, 0.28 * k, face, 0);
  }
  const tail = P(0, 1.0, -1.25);
  b.blob(tail[0], tail[1], tail[2], 0.22 * k, 0.22 * k, 0.22 * k, wool, 0);
}

const sheepFlock: LandmarkSpec = {
  footprint: 10,
  build(ctx) {
    const lit = new MeshBuilder();
    // A grass patch under the flock, so the little group sits on its own bit of green.
    lit.blob(0, -0.6, 0, 14.5, 0.9, 10.5, ramp(GRASS_D, GRASS), 1);
    const flock: [number, number, number, number, boolean][] = [
      [-7.2, 1.0, 0.7, 1.0, false],
      [-1.4, -4.6, -0.6, 1.0, false],
      [6.4, 1.6, 2.6, 1.0, true],
      [-1.0, 5.2, 0.2, 1.0, false],
      [4.6, -5.4, -0.3, 0.95, false],
      [-4.4, 0.4, 0.9, 0.5, false],
      [2.4, 3.0, 1.2, 0.5, false],
    ];
    for (const [x, z, yaw, k, down] of flock) sheep(lit, x, z, yaw, k * 1.45, down, ctx.rnd);
    // Tufts of tall grass and a few daisies round the edge.
    for (let i = 0; i < 18; i++) {
      const a = ctx.rnd() * TAU;
      const r = 8.5 + ctx.rnd() * 4.5;
      lit.spire(Math.cos(a) * r, -0.2, Math.sin(a) * r * 0.72, 0.3, 0.9 + ctx.rnd() * 0.7, ramp(GRASS_D, rgb("#8fe05a")), 4);
    }
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + 0.3;
      const r = 10 + (i % 3) * 0.9;
      lit.rod([Math.cos(a) * r, 0, Math.sin(a) * r * 0.72], [Math.cos(a) * r, 0.9, Math.sin(a) * r * 0.72], 0.1, GRASS_D);
      lit.blob(Math.cos(a) * r, 1.0, Math.sin(a) * r * 0.72, 0.28, 0.1, 0.28, WHITE, 0);
      lit.blob(Math.cos(a) * r, 1.06, Math.sin(a) * r * 0.72, 0.1, 0.06, 0.1, rgb("#ffd34d"), 0);
    }
    return { lit };
  },
};

// ─── Flower field ────────────────────────────────────────────────────────────

const flowerField: LandmarkSpec = {
  footprint: 20,
  build(ctx) {
    const lit = new MeshBuilder();
    const W = 15;
    const D = 10;
    // The bed: a flat mound of dark soil and green, rounded at the corners.
    lit.blob(0, -0.3, 0, W + 1.0, 0.9, D + 1.0, ramp(rgb("#5a3d22"), GRASS_D), 1);
    lit.blob(0, 0.05, 0, W - 0.4, 0.7, D - 0.4, ramp(GRASS_D, rgb("#58c448")), 1);
    // Flowers on stems with leaves, in drifts of colour: reds, yellows, whites, purples.
    const palette: Rgb[] = [rgb("#e23b44"), rgb("#f6c92c"), rgb("#fbf6ea"), rgb("#8d4ad0"), rgb("#ff8fb0"), rgb("#ff9a2e")];
    const cell = 2.25;
    for (let gx = -W + 1.2; gx < W - 0.8; gx += cell) {
      for (let gz = -D + 1.1; gz < D - 0.7; gz += cell) {
        const x = gx + (ctx.rnd() - 0.5) * cell * 0.8;
        const z = gz + (ctx.rnd() - 0.5) * cell * 0.8;
        // Rounded edge: leave out cells outside the ellipse.
        if ((x * x) / (W * W) + (z * z) / (D * D) > 0.9) continue;
        const drift = Math.sin(x * 0.33 + 1.2) + Math.cos(z * 0.45 - 0.4) + Math.sin((x + z) * 0.21);
        const col = palette[Math.floor(((drift + 3) / 6) * palette.length + ctx.rnd() * 1.4) % palette.length]!;
        const h = 2.0 + ctx.rnd() * 1.8;
        const lean = (ctx.rnd() - 0.5) * 0.25;
        flowerOn(lit, x, z, h, col, lean, ctx.rnd);
      }
    }
    // A low picket fence along the road edge: posts, two rails, a little gate gap in the middle.
    const fz = D + 2.2;
    for (let x = -W; x <= W; x += 2.5) {
      if (Math.abs(x) < 1.3) continue;
      lit.box(x, 0.8, fz, 0.34, 1.7, 0.3, ramp(WOOD_D, WHITE));
      lit.blob(x, 1.7, fz, 0.2, 0.2, 0.2, WHITE, 0);
    }
    for (const y of [0.6, 1.2]) {
      lit.box(-W / 2 - 0.6, y, fz, W - 1.6, 0.24, 0.2, WHITE);
      lit.box(W / 2 + 0.6, y, fz, W - 1.6, 0.24, 0.2, WHITE);
    }
    // A watering can by the gate.
    lathe(lit, [[0, 0], [0.55, 0], [0.6, 0.9], [0.5, 1.0], [0, 1.0]], { at: [-1.9, 0, fz + 0.9], segments: 8, shade: byHeight(0, 1, rgb("#2f78d6"), rgb("#6fb6ee")) });
    lit.rod([-1.5, 0.5, fz + 0.9], [-0.7, 1.0, fz + 0.9], 0.18, rgb("#2f78d6"));
    return { lit };
  },
};

/** One flower: a stem, a pair of leaves and a head of petals around a bright eye. */
function flowerOn(b: MeshBuilder, x: number, z: number, h: number, col: Rgb, lean: number, rnd: () => number): void {
  const green = GRASS_D;
  const tx = x + Math.sin(lean) * h;
  b.add(shapes.cone(4), xf((x + tx) / 2, h / 2, z, 0.13, h, 0.13, 0, 0, -lean), ramp(green, rgb("#6bd04a")));
  b.add(shapes.cone(3), xf(x + Math.sin(lean) * h * 0.4 + 0.5, h * 0.38, z + 0.1, 0.3, 1.3, 0.1, 0, 0, -1.1), rgb("#46b845"));
  b.add(shapes.cone(3), xf(x - 0.45, h * 0.26, z - 0.1, 0.28, 1.2, 0.1, 0, 0, 1.1), rgb("#3ca03f"));
  const style = Math.floor(rnd() * 3);
  if (style === 0) {
    // A daisy-like flower: a petal disc tilted toward the road, and a golden eye.
    b.add(shapes.cone(7), xf(tx, h + 0.05, z, 0.95, 0.5, 0.95, 0, 0.5), ramp(scaleRgb(col, 0.82), col));
    b.blob(tx, h + 0.4, z + 0.18, 0.3, 0.2, 0.3, rgb("#ffcf3a"), 0);
  } else if (style === 1) {
    // A tulip: a cup of petals.
    b.add(shapes.cone(5), xf(tx, h + 0.55, z, 0.55, 1.2, 0.55, 0, Math.PI), ramp(scaleRgb(col, 0.78), col));
  } else {
    // A round pompom head.
    b.blob(tx, h + 0.45, z, 0.62, 0.62, 0.62, ramp(scaleRgb(col, 0.8), col), 0);
  }
}

/**
 * The barn the shortcut runs through (a span, built in the road's frame): a red barn open at both ends, white trim round the
 * doors, a hayloft door high in each gable, tie beams across the road under the roof. In one door, out the other.
 */
const barnRun: LandmarkSpec = {
  span: true,
  defaultSpan: 32,
  build(ctx) {
    const lit = new MeshBuilder();
    const L = ctx.span;
    const z0 = -L / 2;
    const z1 = L / 2;
    // The walls stand beyond the barrier and the camera's margin (6 + 1.5 m past the road's edge).
    const hi = ctx.halfWidth + 7.7;
    const ho = hi + 0.7;
    const eave = 6.4;
    const peak = 12.2;
    const shell = (w: number, e: number, p: number): [number, number][] => [[-w, 0], [-w, e], [-w * 0.68, e + (p - e) * 0.55], [0, p], [w * 0.68, e + (p - e) * 0.55], [w, e], [w, 0]];
    const steps = Math.max(2, Math.round(L / 3));
    const board = (y0: number, y1: number): Shade => (p, i) => scaleRgb(mixRgb(RED_D, RED, Math.min(1, Math.max(0, (p[1] - y0) / (y1 - y0)))), i % 2 === 0 ? 1.0 : 0.93);
    extrudeZ(lit, shell(ho, eave, peak + 0.7), z0, z1, steps, board(0, peak));
    extrudeZ(lit, shell(hi, eave, peak), z0, z1, steps, (p) => scaleRgb(mixRgb(WOOD_D, WOOD, Math.min(1, p[1] / peak)), 0.95));
    // A slate roof over the shell: two slabs a side, as the beside-the-road barn's.
    const slate = rgb("#4c5568");
    const slateL = rgb("#6b7690");
    for (const s of [-1, 1]) {
      const pts: [number, number, number, number][] = [
        [ho + 0.5, eave + 0.2, ho * 0.68, eave + (peak + 0.7 - eave) * 0.55],
        [ho * 0.68, eave + (peak + 0.7 - eave) * 0.55, 0.2, peak + 1.0],
      ];
      for (const [ax, ay, bx, by] of pts) {
        const dx = s * (bx - ax);
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        lit.box(s * ax + dx / 2, ay + dy / 2 + 0.3, 0, len, 0.5, L + 1.6, ramp(slate, slateL), 0, 0, s * ang);
      }
    }
    lit.box(0, peak + 1.25, 0, 1.0, 0.5, L + 1.8, rgb("#2f3644"));
    // White trim round both open ends, and a hayloft door high in each gable.
    for (const z of [z0, z1]) {
      const out = z < 0 ? -0.3 : 0.3;
      for (const s of [-1, 1]) lit.box(s * (ho + 0.05), eave / 2, z + out, 0.7, eave, 0.5, WHITE);
      lit.box(0, eave + 1.4, z + out, 2 * ho, 0.7, 0.5, WHITE);
      lit.box(0, eave + 4.4, z + out * 0.4, 3.0, 2.6, 0.5, WHITE);
      lit.box(0, eave + 4.4, z + out * 0.8, 2.2, 1.9, 0.3, rgb("#2a2018"));
      lit.blob(0, eave + 3.7, z + out * 1.2, 0.9, 0.5, 0.45, STRAW, 0);
    }
    // Tie beams across the road, well over a kart's head, with a lantern hung from each.
    for (let z = z0 + 5; z < z1 - 3; z += 6.5) {
      lit.box(0, eave + 1.0, z, 2 * hi, 0.45, 0.45, WOOD_D);
    }
    return { lit };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = {
  windmill,
  barn,
  "barn-run": barnRun,
  pond,
  "hay-bales": hayBales,
  "hot-air-balloon": hotAirBalloon,
  sheep: sheepFlock,
  "flower-field": flowerField,
  ...second.LANDMARKS,
};

export const HAZARDS: Record<string, HazardSpec> = { ...second.HAZARDS };
