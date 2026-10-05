/**
 * The harbour world's landmarks and hazards (docs/GRIP_PRIX.md, "What each theme can build"): a
 * night quay of cranes, ships and containers under sodium lamps. Steely blues and rust reds in the
 * dark, with warm yellow windows and lamps (glow builder) and soft halos standing in for bloom.
 */
import { Group, Mesh, type Object3D } from "three";
import type { Paint } from "../builder";
import { byHeight, extrudeZ, grid, lathe, MeshBuilder, mixRgb, prism, ramp, rgb, rockBlob, scaleRgb, shapes, torus, tube, xf, type Rgb, type Shade, type V3 } from "./kit";
import type { HazardSpec, LandmarkSpec, MovingPart } from "./types";

const TAU = Math.PI * 2;

// The night is dark and blue, so surfaces are lifted and the lamps are warm.
const lift = (hex: string, k = 1.5): Rgb => scaleRgb(rgb(hex), k);
const NAVY = lift("#27406e", 1.7);
const HULL_RED = lift("#c23a2c", 1.5);
const CRANE_RED = lift("#d8382a", 1.6);
const CRANE_WHITE = lift("#eef0f4", 1.5);
const STEEL = lift("#8ea0b6", 1.5);
const STEEL_D = lift("#4a5a70", 1.5);
const CONCRETE = lift("#8c939c", 1.4);
const CONCRETE_D = lift("#4d535d", 1.4);
const YELLOW = lift("#f4c10f", 1.5);
const BLACK = lift("#20242c", 1.2);
const SODIUM: Rgb = [3.2, 2.3, 0.85];
const SODIUM_HALO: readonly [number, number, number] = [3.0, 2.0, 0.7];
const WINDOW: Rgb = [3.0, 2.4, 1.0];

const BOX_COLOURS: Rgb[] = [lift("#c8402b", 1.7), lift("#2f6cb8", 1.8), lift("#2f9a5f", 1.7), lift("#e0a21b", 1.6), lift("#dcdcd6", 1.4), lift("#e0702a", 1.7), lift("#7a58a0", 1.8), lift("#2aa0a8", 1.7)];

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

/** A shipping container, length along x: corrugated on the road side, with a door end and a label on some. */
const CL = 6.4;
const CW = 2.7;
const CH = 2.8;
function container(b: MeshBuilder, x: number, y: number, z: number, col: Rgb, rnd: () => number, ribs = true): void {
  b.box(x, y + CH / 2, z, CL, CH, CW, ramp(scaleRgb(col, 0.62), col));
  if (ribs) {
    for (let k = 0; k < 6; k++) b.box(x - CL / 2 + 0.7 + k * 1.0, y + CH / 2, z + CW / 2 + 0.05, 0.26, CH - 0.4, 0.1, ramp(scaleRgb(col, 0.5), scaleRgb(col, 0.9)));
    // Corner castings in dark steel on the road side.
    for (const sx of [-1, 1]) {
      b.box(x + sx * (CL / 2 - 0.2), y + 0.2, z + CW / 2 - 0.1, 0.4, 0.4, 0.4, BLACK);
      b.box(x + sx * (CL / 2 - 0.2), y + CH - 0.2, z + CW / 2 - 0.1, 0.4, 0.4, 0.4, BLACK);
    }
  }
  if (rnd() < 0.4) b.box(x + (rnd() - 0.5) * 2, y + CH * 0.65, z + CW / 2 + 0.12, 1.6, 0.5, 0.08, lift("#f4f4ee", 1.5));
}

/** A tall lamp post: a pole, an arm toward `dir` (+1 / -1 along z) and a sodium head; adds its halo. */
function lamp(lit: MeshBuilder, glow: MeshBuilder, halos: { x: number; y: number; z: number; size: number; colour: readonly [number, number, number]; alpha: number; twinkle?: number }[], x: number, z: number, h: number, dir = 1): void {
  lit.post(x, -0.5, z, 0.3, h + 0.5, ramp(STEEL_D, STEEL), 6, 0.6);
  lit.post(x, 0, z, 0.55, 0.7, ramp(STEEL_D, STEEL), 6);
  lit.rod([x, h - 0.3, z], [x, h + 0.7, z + dir * 1.8], 0.3, STEEL);
  lit.box(x, h + 0.55, z + dir * 2.2, 1.6, 0.35, 2.0, ramp(STEEL_D, STEEL));
  glow.box(x, h + 0.34, z + dir * 2.2, 1.3, 0.14, 1.7, SODIUM);
  halos.push({ x, y: h + 0.1, z: z + dir * 2.2, size: 9, colour: SODIUM_HALO, alpha: 0.5, twinkle: 0.08 });
}

type Halos = Parameters<typeof lamp>[2];

// ─── Crane ───────────────────────────────────────────────────────────────────

/** A lattice leg or boom truss between two points: two rails and zig-zag braces. */
function truss(b: MeshBuilder, a: V3, c: V3, width: number, thick: number, panels: number, rail: Paint, brace: Paint, up: V3 = [1, 0, 0]): void {
  // `up` is the direction in which the two rails are spread, normalised here.
  const l = Math.hypot(up[0], up[1], up[2]);
  const u: V3 = [(up[0] / l) * (width / 2), (up[1] / l) * (width / 2), (up[2] / l) * (width / 2)];
  const r1a: V3 = [a[0] + u[0], a[1] + u[1], a[2] + u[2]];
  const r1c: V3 = [c[0] + u[0], c[1] + u[1], c[2] + u[2]];
  const r2a: V3 = [a[0] - u[0], a[1] - u[1], a[2] - u[2]];
  const r2c: V3 = [c[0] - u[0], c[1] - u[1], c[2] - u[2]];
  b.rod(r1a, r1c, thick, rail);
  b.rod(r2a, r2c, thick, rail);
  for (let k = 0; k < panels; k++) {
    const t0 = k / panels;
    const t1 = (k + 1) / panels;
    const p = (r: V3, s: V3, t: number): V3 => [r[0] + (s[0] - r[0]) * t, r[1] + (s[1] - r[1]) * t, r[2] + (s[2] - r[2]) * t];
    if (k % 2 === 0) b.rod(p(r1a, r1c, t0), p(r2a, r2c, t1), thick * 0.7, brace);
    else b.rod(p(r2a, r2c, t0), p(r1a, r1c, t1), thick * 0.7, brace);
  }
}

const crane: LandmarkSpec = {
  footprint: 16,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halos = [];
    const redP = ramp(scaleRgb(CRANE_RED, 0.7), CRANE_RED);
    const whiteP = ramp(scaleRgb(CRANE_WHITE, 0.75), CRANE_WHITE);
    // The quay: a concrete apron with a yellow edge line and bollards, sunk into the ground.
    lit.box(0, -0.1, 0, 30, 1.8, 22, ramp(CONCRETE_D, CONCRETE));
    lit.box(0, 0.82, 10.4, 30, 0.06, 0.7, YELLOW);
    for (const x of [-12, -5, 5, 12]) {
      lit.post(x, 0.8, 8.4, 0.5, 0.9, ramp(BLACK, STEEL_D), 8);
      lit.post(x, 1.55, 8.4, 0.62, 0.3, YELLOW, 8);
    }
    // Four legs of red lattice, two portals joined by cross beams.
    const legX = 8.6;
    const legZ = 5.4;
    const topY = 22;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        truss(lit, [sx * legX, 0.8, sz * legZ], [sx * legX, topY, sz * legZ], 2.0, 0.5, 8, redP, whiteP, [sz === 1 ? 0 : 1, 0, sz === 1 ? 1 : 0]);
        lit.box(sx * legX, 1.0, sz * legZ, 2.6, 0.7, 2.6, ramp(STEEL_D, STEEL));
      }
      lit.box(sx * legX, topY - 0.6, 0, 1.8, 1.4, 2 * legZ + 1.8, whiteP);
      lit.box(sx * legX, 9.8, 0, 0.5, 0.5, 2 * legZ, redP);
    }
    lit.box(0, topY - 0.4, -legZ, 2 * legX + 1.8, 1.4, 1.8, whiteP);
    lit.box(0, topY - 0.4, legZ, 2 * legX + 1.8, 1.4, 1.8, whiteP);
    // The machinery house and portal girder, white with a red stripe.
    lit.box(0, topY + 2.0, 0, 21, 3.2, 8.6, whiteP);
    lit.box(0, topY + 2.0, 4.35, 21.2, 0.7, 0.1, redP);
    lit.box(0, topY + 3.8, -1.5, 9, 1.0, 5, ramp(STEEL_D, STEEL));
    // The boom, a long lattice reaching toward the road, slightly raised, and the back-reach behind.
    const boomRoot: V3 = [0, topY + 2.4, 3];
    const boomTip: V3 = [0, topY + 7.2, 30];
    truss(lit, [boomRoot[0], boomRoot[1] - 1.4, boomRoot[2]], [boomTip[0], boomTip[1] - 1.4, boomTip[2]], 2.6, 0.42, 14, redP, whiteP, [1, 0, 0]);
    truss(lit, [boomRoot[0], boomRoot[1] + 1.6, boomRoot[2]], [boomTip[0], boomTip[1] + 1.6, boomTip[2]], 2.6, 0.42, 14, redP, whiteP, [1, 0, 0]);
    lit.rod([1.3, boomRoot[1] - 1.4, boomRoot[2]], [1.3, boomRoot[1] + 1.6, boomRoot[2]], 0.4, whiteP);
    lit.rod([-1.3, boomRoot[1] - 1.4, boomRoot[2]], [-1.3, boomRoot[1] + 1.6, boomRoot[2]], 0.4, whiteP);
    lit.rod([1.3, boomTip[1] - 1.4, boomTip[2]], [1.3, boomTip[1] + 1.6, boomTip[2]], 0.4, whiteP);
    lit.rod([-1.3, boomTip[1] - 1.4, boomTip[2]], [-1.3, boomTip[1] + 1.6, boomTip[2]], 0.4, whiteP);
    truss(lit, [0, topY + 2.4, -2], [0, topY + 2.0, -17], 2.4, 0.42, 6, redP, whiteP, [1, 0, 0]);
    lit.box(0, topY + 1.2, -15, 5, 4.6, 5, ramp(STEEL_D, STEEL));
    lit.box(0, topY + 1.4, -15, 5.1, 0.9, 5.1, YELLOW);
    // The A-frame above, with stays down to the boom tip and the back-reach.
    const apex: V3 = [0, 40.4, -1];
    for (const sx of [-1, 1]) {
      truss(lit, [sx * 5.4, topY + 3.6, 0.5], [sx * 0.7, apex[1] - 0.6, apex[2]], 1.6, 0.4, 6, redP, whiteP, [0, 0, 1]);
    }
    lit.box(0, apex[1], apex[2], 2.4, 1.0, 1.6, whiteP);
    lit.rod(apex, [0.6, boomTip[1] + 1.8, boomTip[2]], 0.2, STEEL);
    lit.rod(apex, [-0.6, boomTip[1] + 1.8, boomTip[2]], 0.2, STEEL);
    lit.rod(apex, [0, topY + 2.4, -17], 0.2, STEEL);
    // The beacon on top, with red aviation lamps, and floodlights along the boom.
    glow.blob(0, apex[1] + 1.1, apex[2], 0.7, 0.7, 0.7, [4.0, 0.4, 0.3], 1);
    halos.push({ x: 0, y: apex[1] + 1.1, z: apex[2], size: 11, colour: [3.5, 0.35, 0.25], alpha: 0.7, twinkle: 0.6 });
    for (const z of [10, 20]) {
      glow.box(0, boomTip[1] - (boomTip[2] - z) * 0.17 + 2.6, z, 1.4, 0.3, 1.0, SODIUM);
      halos.push({ x: 0, y: boomTip[1] - (boomTip[2] - z) * 0.17 + 2.4, z, size: 8, colour: [2.8, 2.2, 1.1], alpha: 0.4 });
    }
    // The driver's cab slung under the trolley half way out, with a lit window.
    const cabZ = 17;
    const cabY = topY + 7.2 - (boomTip[2] - cabZ) * 0.17 - 1.5;
    lit.box(0, cabY - 2.0, cabZ, 3.2, 2.8, 3.4, whiteP);
    lit.box(0, cabY - 0.5, cabZ, 3.6, 0.4, 3.8, redP);
    lit.box(0, cabY - 2.9, cabZ, 2.6, 0.5, 2.8, ramp(STEEL_D, STEEL));
    glow.box(0, cabY - 1.6, cabZ + 1.75, 2.4, 1.4, 0.1, WINDOW);
    halos.push({ x: 0, y: cabY - 1.6, z: cabZ + 2.2, size: 6, colour: [2.6, 2.0, 0.9], alpha: 0.45 });
    // The hook block, ropes and a container, hung from the trolley and swinging a little.
    const trolleyZ = 25;
    const trolleyY = topY + 7.2 - (boomTip[2] - trolleyZ) * 0.17 - 1.2;
    const load = new MeshBuilder();
    load.box(0, trolleyY - 0.6, trolleyZ, 2.8, 1.2, 3.0, ramp(STEEL_D, STEEL));
    const spreaderY = 14.6;
    for (const sx of [-1, 1]) for (const dz of [-1, 1]) load.rod([sx * 1.1, trolleyY - 1.1, trolleyZ + dz * 1.1], [sx * 2.7, spreaderY, trolleyZ + dz * 2.2], 0.2, rgb("#3a3f48"));
    load.box(0, spreaderY - 0.1, trolleyZ, 7.0, 0.6, 3.4, ramp(STEEL_D, STEEL));
    // The container, hung with its length across z (a crane turns a box to line it up with the bay).
    load.box(0, spreaderY - 0.4 - CH / 2, trolleyZ, CW + 0.2, CH, CL, ramp(scaleRgb(BOX_COLOURS[3]!, 0.7), BOX_COLOURS[3]!));
    for (let k = 0; k < 6; k++) load.box(CW / 2 + 0.2, spreaderY - 0.4 - CH / 2, trolleyZ - CL / 2 + 0.6 + k * 0.95, 0.1, CH - 0.4, 0.26, scaleRgb(BOX_COLOURS[3]!, 0.65));
    for (const dz of [-1, 1]) load.box(0, spreaderY - 0.4 - CH - 0.1, trolleyZ + dz * (CL / 2 - 0.2), CW + 0.3, 0.3, 0.4, BLACK);
    const moving: MovingPart[] = [
      {
        lit: load,
        pivot: [0, trolleyY, trolleyZ],
        update(t, part) {
          part.rotation.x = Math.sin(t * 0.8) * 0.045;
          part.rotation.z = Math.sin(t * 0.55 + 1) * 0.02;
        },
      },
    ];
    // Lamps on the quay.
    lamp(lit, glow, halos, 13.5, 8.8, 12, 1);
    lamp(lit, glow, halos, -13.5, 8.8, 12, 1);
    return { lit, glow, halos, moving };
  },
};

// ─── Lighthouse ──────────────────────────────────────────────────────────────

const lighthouse: LandmarkSpec = {
  footprint: 16,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halos = [];
    const red = lift("#d8382a", 1.7);
    const white = lift("#f2f4f8", 1.6);
    const rockC = lift("#59616d", 1.5);
    // A knuckle of rock for the foot, then the tower in eight bands.
    rockBlob(lit, 0, 0.6, 0, 9.5, 3.4, 9.5, byHeight(-2, 4, scaleRgb(rockC, 0.6), rockC), 7, { detail: 1, roughness: 0.3, flatBase: true });
    rockBlob(lit, 6.2, 0.3, 4.2, 5, 2.2, 4.4, byHeight(-2, 2.5, scaleRgb(rockC, 0.6), rockC), 3, { detail: 1, roughness: 0.3, flatBase: true });
    const radius = (y: number) => 5.6 - (y / 34) * 2.2;
    const bands = 8;
    const y0 = 2.4;
    const y1 = 34;
    for (let k = 0; k < bands; k++) {
      const ya = y0 + ((y1 - y0) * k) / bands;
      const yb = y0 + ((y1 - y0) * (k + 1)) / bands;
      const col = k % 2 === 0 ? red : white;
      lathe(lit, [[radius(ya), ya], [radius(yb), yb]], { segments: 12, shade: byHeight(ya - 6, yb + 4, scaleRgb(col, 0.55), col) });
    }
    lathe(lit, [[0, 1.6], [5.9, 1.6], [5.9, y0], [radius(y0), y0]], { segments: 12, shade: scaleRgb(rockC, 0.9) });
    // A door, a stair of windows spiralling up, and a stone step.
    lit.box(0, 4.4, 5.6, 2.0, 3.6, 0.5, ramp(lift("#4a2a1a", 1.4), lift("#8a5a34", 1.4)));
    lit.box(0, 2.6, 6.6, 3.0, 0.6, 1.6, ramp(CONCRETE_D, CONCRETE));
    for (let k = 0; k < 5; k++) {
      const a = 0.4 + k * 2.2;
      const y = 8 + k * 5.2;
      const r = radius(y) - 0.02;
      lit.box(Math.sin(a) * r, y, Math.cos(a) * r, 0.9, 1.5, 0.5, lift("#222a3c", 1.2), a);
      glow.box(Math.sin(a) * (r + 0.28), y, Math.cos(a) * (r + 0.28), 0.5, 1.0, 0.16, [2.4, 1.8, 0.7], a);
    }
    // The gallery under the lantern: a deck, a railing of posts and rails.
    lathe(lit, [[3.1, 33.6], [5.2, 33.6], [5.2, 34.5], [3.1, 34.5]], { segments: 12, shade: byHeight(33, 35, scaleRgb(CONCRETE_D, 1.1), CONCRETE) });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      lit.post(Math.cos(a) * 5.0, 34.5, Math.sin(a) * 5.0, 0.15, 1.5, STEEL, 4);
    }
    torus(lit, 5.0, 0.1, { at: [0, 36.0, 0], ringSegments: 14, tubeSegments: 4, shade: STEEL });
    torus(lit, 5.0, 0.1, { at: [0, 35.2, 0], ringSegments: 14, tubeSegments: 4, shade: STEEL });
    // The lantern room: a ring of glass panes in dark mullions, a red domed roof, a ball and a vane.
    lit.post(0, 34.4, 0, 3.0, 0.6, STEEL_D, 12);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8;
      lit.post(Math.cos(a) * 2.8, 34.9, Math.sin(a) * 2.8, 0.14, 4.2, STEEL_D, 4);
    }
    lathe(glass, [[2.7, 34.9], [2.7, 39.1]], { segments: 8, shade: [0.8, 0.95, 1.1], phase: Math.PI / 8 });
    lathe(lit, [[3.5, 39.0], [3.5, 39.5], [2.6, 41.2], [1.2, 42.6], [0.0, 43.2]], { segments: 12, shade: byHeight(39, 43.2, scaleRgb(red, 0.8), red) });
    lit.blob(0, 43.5, 0, 0.55, 0.55, 0.55, STEEL, 1);
    lit.rod([0, 43.6, 0], [0, 46.2, 0], 0.16, STEEL_D);
    lit.rod([-1.2, 45.6, 0], [1.2, 45.6, 0], 0.16, STEEL_D);
    // The lamp: a bright core with a flare. The beam sweeps round, a long flat wedge of pale glass on each side.
    glow.blob(0, 37.0, 0, 1.1, 1.3, 1.1, [5, 4.6, 3.4], 1);
    lit.post(0, 34.5, 0, 0.5, 1.8, ramp(STEEL_D, STEEL), 6);
    halos.push({ x: 0, y: 37.0, z: 0, size: 16, colour: [3.2, 2.8, 1.8], alpha: 0.6, twinkle: 0.1 });
    halos.push({ x: 0, y: 37.0, z: 0, size: 34, colour: [2.4, 2.0, 1.2], alpha: 0.22 });
    const beam = new MeshBuilder();
    for (const dir of [1, -1]) {
      const near = (z: number, w: number, h: number): V3[] => [[-w, 37.0 - h, z], [w, 37.0 - h, z], [w, 37.0 + h, z], [-w, 37.0 + h, z]];
      grid(beam, [near(dir * 1.6, 0.8, 0.8), near(dir * 80, 9, 7)], (p) => scaleRgb([2.2, 2.0, 1.2], Math.max(0.35, 1 - Math.abs(p[2]) / 90)), true);
    }
    // A keeper's cottage with lit windows and a red roof.
    const cx = -13;
    const cz = 4;
    lit.box(cx, 2.4, cz, 9, 4.8, 6.4, ramp(scaleRgb(white, 0.6), white));
    slabRoof(lit, cx, 4.8, cz, 10.4, 7.6, 3.2, red);
    lit.box(cx + 3, 6.8, cz - 1.5, 1.1, 2.2, 1.1, ramp(CONCRETE_D, CONCRETE));
    lit.box(cx - 0.8, 1.6, cz + 3.25, 1.6, 3.2, 0.2, ramp(lift("#4a2a1a", 1.4), lift("#8a5a34", 1.4)));
    for (const wx of [cx - 3, cx + 2.4]) {
      lit.box(wx, 2.9, cz + 3.24, 1.9, 1.7, 0.12, white);
      glow.box(wx, 2.9, cz + 3.31, 1.4, 1.2, 0.06, WINDOW);
      halos.push({ x: wx, y: 2.9, z: cz + 3.9, size: 5, colour: [2.6, 1.9, 0.8], alpha: 0.4 });
    }
    const moving: MovingPart[] = [
      {
        glass: beam,
        pivot: [0, 37.0, 0],
        update(t, part) {
          // One sweep every six seconds.
          part.rotation.y = (t / 6) * TAU;
        },
      },
    ];
    return { lit, glow, glass, halos, moving };
  },
};

/** A pitched roof over a box: two sloped slabs and two gable triangles, centred on (x, z), eaves at y. */
function slabRoof(b: MeshBuilder, x: number, y: number, z: number, w: number, d: number, rise: number, col: Rgb): void {
  const half = w / 2;
  const ang = Math.atan2(rise, half);
  const len = Math.hypot(half, rise);
  for (const s of [-1, 1]) {
    b.box(x + s * half * 0.5, y + rise * 0.5 + 0.1, z, len + 0.3, 0.4, d, ramp(scaleRgb(col, 0.7), col), 0, 0, -s * ang);
  }
  prism(b, [[x - half + 0.4, z - d / 2 + 0.3], [x + half - 0.4, z - d / 2 + 0.3], [x + half - 0.4, z + d / 2 - 0.3], [x - half + 0.4, z + d / 2 - 0.3]], y - 0.2, y + 0.2, scaleRgb(col, 0.7));
}

// ─── Ship ────────────────────────────────────────────────────────────────────

const ship: LandmarkSpec = {
  footprint: 60,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halos = [];
    const rnd = ctx.rnd;
    // The dock basin: a slab of dark water along the quay and a concrete quay wall in front, so the ship floats in something.
    const waterC: Rgb = [0.06, 0.13, 0.3];
    lit.box(2, 0.0, -2, 138, 0.08, 46, waterC);
    lit.box(2, 0.35, 24.5, 144, 1.8, 3.4, ramp(CONCRETE_D, CONCRETE));
    lit.box(2, 1.35, 25.7, 144, 0.16, 0.5, YELLOW);
    // The hull: the plan is a long rounded box with a pointed bow toward +x; navy above, a red waterline stripe, red below.
    const plan: [number, number][] = [[-50, -8], [-50, 8], [30, 8], [42, 6.2], [52, 0], [42, -6.2], [30, -8]];
    prism(lit, plan, -2.2, 0.0, scaleRgb(HULL_RED, 0.7));
    prism(lit, plan.map(([x, z]): [number, number] => [x * 1.003, z * 1.012]), 0.0, 0.9, HULL_RED);
    prism(lit, plan, 0.9, 6.2, (p) => mixRgb(scaleRgb(NAVY, 0.7), NAVY, Math.min(1, (p[1] - 0.9) / 5)));
    // White lettering strip, deck and bulwark.
    lit.box(-20, 5.2, 8.05, 40, 0.6, 0.08, lift("#f2f4f8", 1.5));
    prism(lit, plan.map(([x, z]): [number, number] => [x * 0.985, z * 0.94]), 6.2, 6.5, lift("#6a6f78", 1.4));
    lit.box(-8, 6.9, 7.6, 96, 0.9, 0.3, lift("#d5d9df", 1.4));
    lit.box(-8, 6.9, -7.6, 96, 0.9, 0.3, lift("#d5d9df", 1.4));
    // The bow: a forecastle with a mast, an anchor and a bright foam beard at the waterline.
    lit.box(40, 7.2, 0, 8, 1.6, 8, ramp(scaleRgb(NAVY, 0.9), lift("#6a6f78", 1.4)));
    lit.post(41, 8, 0, 0.25, 6, ramp(STEEL_D, STEEL), 6);
    lit.blob(46, 0.6, 3.2, 2.2, 0.35, 0.9, [1.4, 1.7, 2.0], 0, 0.6);
    lit.blob(46, 0.6, -3.2, 2.2, 0.35, 0.9, [1.4, 1.7, 2.0], 0, -0.6);
    // Containers: five across and up to four high, in bays from the bridge to the bow.
    for (let bay = 0; bay < 9; bay++) {
      const x = -17 + bay * (CL + 0.2);
      if (x > 34) continue;
      for (let row = 0; row < 5; row++) {
        const z = (row - 2) * (CW + 0.2);
        const height = 2 + Math.floor(rnd() * 3) + (row === 2 ? 1 : 0);
        for (let level = 0; level < height; level++) container(lit, x, 6.5 + level * CH, z, BOX_COLOURS[Math.floor(rnd() * BOX_COLOURS.length)]!, rnd, row === 4 && level < 2);
      }
    }
    // The deckhouse near the stern: four white tiers with rows of lit windows, wings on the top deck, a mast and a funnel.
    const bx = -34;
    const tiers: [number, number, number][] = [[10, 13, 3.4], [9, 12.2, 3.2], [8, 11.4, 3.2], [7.4, 14.6, 3.0]];
    let y = 6.5;
    tiers.forEach(([dx, dz, h], i) => {
      lit.box(bx, y + h / 2, 0, dx, h, dz, ramp(scaleRgb(CRANE_WHITE, 0.72), CRANE_WHITE));
      lit.box(bx, y + h - 0.12, 0, dx + 0.5, 0.25, dz + 0.5, lift("#c8ccd4", 1.4));
      const rowsX = Math.floor(dx / 1.9);
      for (let k = 0; k < rowsX; k++) {
        const wx = bx - dx / 2 + 1.0 + k * ((dx - 1.5) / Math.max(1, rowsX - 1));
        glow.box(wx, y + h * 0.5, dz / 2 + 0.04, 0.9, 1.1, 0.06, i === 3 ? [3.4, 2.8, 1.4] : WINDOW);
      }
      if (i === 3) glow.box(bx + dx / 2 + 0.04, y + h * 0.5, 0, 0.06, 1.2, dz - 1.4, [3.4, 2.8, 1.4]);
      y += h;
    });
    lit.box(bx, y + 0.3, 0, 7, 0.6, 15.6, ramp(scaleRgb(CRANE_WHITE, 0.8), CRANE_WHITE));
    lit.post(bx, y + 0.6, 0, 0.25, 7, ramp(STEEL_D, STEEL), 6, 0.7);
    lit.rod([bx, y + 6, -2.5], [bx, y + 6, 2.5], 0.2, STEEL);
    glow.blob(bx, y + 8, 0, 0.4, 0.4, 0.4, [4, 4, 3.6], 0);
    halos.push({ x: bx, y: y + 8, z: 0, size: 5, colour: [3.0, 3.0, 2.8], alpha: 0.5, twinkle: 0.15 });
    glow.blob(bx, y + 4.4, 2.8, 0.3, 0.3, 0.3, [0.3, 4, 0.6], 0);
    glow.blob(bx, y + 4.4, -2.8, 0.3, 0.3, 0.3, [4, 0.3, 0.3], 0);
    halos.push({ x: bx, y: y + 4.4, z: 3.2, size: 4, colour: [0.3, 3.2, 0.6], alpha: 0.5 });
    halos.push({ x: bx, y: y + 4.4, z: -3.2, size: 4, colour: [3.2, 0.3, 0.3], alpha: 0.5 });
    // The funnel: red with a white band and a black top, aft of the bridge.
    const fx = -44;
    lathe(lit, [[3.6, 6.3], [3.4, 12], [3.0, 17]], { at: [fx, 0, 0], segments: 10, shade: byHeight(6, 17, scaleRgb(HULL_RED, 0.8), HULL_RED) });
    lathe(lit, [[3.3, 13], [3.1, 14.4]], { at: [fx, 0, 0], segments: 10, shade: lift("#f2f4f8", 1.5) });
    lathe(lit, [[3.1, 17], [3.15, 18.4], [0, 18.4]], { at: [fx, 0, 0], segments: 10, shade: lift("#1a1d24", 1.2) });
    // Deck lamps along the cargo, glowing sodium.
    for (const x of [-12, 8, 28]) {
      for (const z of [-8.4, 8.4]) {
        lit.post(x, 6.5, z, 0.12, 2.6, STEEL, 4);
        glow.box(x, 9.2, z, 0.8, 0.2, 0.8, SODIUM);
        halos.push({ x, y: 9.2, z, size: 6, colour: SODIUM_HALO, alpha: 0.4 });
      }
    }
    // Navigation lights on the bow and a lit port-side doorway.
    glow.blob(45, 8.6, 3.0, 0.3, 0.3, 0.3, [4, 0.3, 0.3], 0);
    halos.push({ x: 45, y: 8.6, z: 3.4, size: 4.5, colour: [3.2, 0.3, 0.3], alpha: 0.5, twinkle: 0.25 });
    return { lit, glow, halos };
  },
};

// ─── Containers ──────────────────────────────────────────────────────────────

const containers: LandmarkSpec = {
  footprint: 28,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halos = [];
    const rnd = ctx.rnd;
    // The base slab, with yellow edge lines, and a hazard-striped crossing left open in the middle of the block.
    lit.box(0, -0.2, 0, 52, 1.2, 22, ramp(CONCRETE_D, CONCRETE));
    for (const z of [-10.4, 10.4]) lit.box(0, 0.44, z, 52, 0.06, 0.4, YELLOW);
    const gapAt = 3;
    const cols = 7;
    const rows = 2;
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (CL + 0.5);
      if (c === gapAt) {
        // A crossing painted with black and yellow slashes, with a pair of bollards.
        for (let k = 0; k < 7; k++) lit.box(x - 3 + k * 1.0, 0.42, 0, 0.5, 0.06, 7, k % 2 === 0 ? YELLOW : BLACK, 0, 0, 0);
        for (const sz of [-3.8, 3.8]) {
          lit.post(x, 0.4, sz, 0.35, 1.2, YELLOW, 8);
          lit.post(x, 1.1, sz, 0.38, 0.3, BLACK, 8);
        }
        continue;
      }
      for (let r = 0; r < rows; r++) {
        const z = (r - 0.5) * (CW + 0.6) * 1.0 + 0.4;
        const h = 3 + Math.floor(rnd() * 2);
        for (let level = 0; level < h; level++) {
          container(lit, x, 0.4 + level * CH, z + 2.7, BOX_COLOURS[(c * 3 + r * 5 + level * 2 + Math.floor(rnd() * 3)) % BOX_COLOURS.length]!, rnd, r === 1);
        }
      }
    }
    // Chain-link fencing at the corners, and two tall lamps with sodium heads.
    lamp(lit, glow, halos, -25, 9.5, 16, 1);
    lamp(lit, glow, halos, 25, 9.5, 16, 1);
    // A hand pallet jack and a few traffic cones by the crossing.
    for (let k = 0; k < 3; k++) {
      lit.add(shapes.cone(8), xf(4.2 + k * 0.9, 1.0, 8.4, 0.35, 1.0, 0.35), ramp(lift("#e0501e", 1.6), lift("#ff8a50", 1.6)));
      lit.box(4.2 + k * 0.9, 0.5, 8.4, 0.9, 0.12, 0.9, BLACK);
    }
    return { lit, glow, halos };
  },
};

// ─── Warehouse ───────────────────────────────────────────────────────────────

const warehouse: LandmarkSpec = {
  footprint: 28,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const halos: Halos = [];
    const rnd = ctx.rnd;
    const W = 42;
    const D = 19;
    const H = 8.4;
    const wall = lift("#6f8aa6", 1.7);
    const wallDark = lift("#4a617c", 1.7);
    // The shed itself: a long block of corrugated steel in blue-grey, with a darker plinth.
    lit.box(0, H / 2 - 0.5, 0, W, H + 1, D, ramp(scaleRgb(wallDark, 0.8), wall));
    lit.box(0, 0.5, 0, W + 0.5, 1.4, D + 0.5, ramp(CONCRETE_D, CONCRETE));
    // Ribs on the front face and the near end.
    for (let k = 0; k < 26; k++) lit.box(-W / 2 + 1 + k * 1.6, H / 2 + 0.2, D / 2 + 0.06, 0.34, H - 1.2, 0.12, ramp(scaleRgb(wallDark, 0.9), wall));
    for (let k = 0; k < 10; k++) lit.box(W / 2 + 0.06, H / 2 + 0.2, -D / 2 + 1 + k * 1.9, 0.12, H - 1.2, 0.34, ramp(scaleRgb(wallDark, 0.9), wall));
    // A stripe of white trim under the eaves.
    lit.box(0, H - 0.6, 0, W + 0.4, 0.5, D + 0.4, lift("#e8ecf2", 1.5));
    // The saw-tooth roof: five teeth, each a sloped plane rising to a glazed face looking toward the near end.
    const teeth = 5;
    const tw = W / teeth;
    for (let k = 0; k < teeth; k++) {
      const x0 = -W / 2 + k * tw;
      const tri: [number, number][] = [[x0, H - 0.3], [x0 + tw, H - 0.3], [x0 + tw, H + 4.2]];
      extrudeZ(lit, tri, -D / 2 - 0.4, D / 2 + 0.4, 4, (p, i) => scaleRgb(mixRgb(lift("#59626f", 1.6), lift("#8d96a3", 1.6), Math.min(1, (p[1] - H) / 4.2)), i % 2 ? 1 : 0.92), { closed: true });
      for (const z of [-D / 2 - 0.4, D / 2 + 0.4]) {
        const sc = lift("#59626f", 1.7);
        lit.tri([x0, H - 0.3, z], [x0 + tw, H - 0.3, z], [x0 + tw, H + 4.2, z], scaleRgb(sc, 0.8), scaleRgb(sc, 0.8), sc);
      }
      // The glazed riser: tall bright panes in a frame.
      for (let w = 0; w < 5; w++) {
        const wz = -D / 2 + 2 + w * ((D - 2) / 5);
        glow.box(x0 + tw + 0.08, H + 1.6, wz + 1.5, 0.08, 3.2, 3.1, [2.2, 2.0, 1.3]);
      }
    }
    // The loading dock: a raised concrete platform along the front with steps, bumpers, a half-open roller door and a closed one.
    lit.box(-4, 0.9, D / 2 + 1.7, 28, 1.8, 3.4, ramp(CONCRETE_D, CONCRETE));
    lit.box(-4, 1.85, D / 2 + 3.3, 28, 0.08, 0.5, YELLOW);
    for (const x of [-12, -4, 4]) lit.box(x, 2.6, D / 2 + 0.2, 1.0, 1.0, 0.5, BLACK);
    lit.box(-8, 3.6, D / 2 + 0.1, 6.6, 5.6, 0.4, ramp(scaleRgb(wallDark, 0.8), wallDark));
    glow.box(-8, 3.2, D / 2 + 0.34, 5.6, 3.8, 0.06, [2.6, 2.0, 0.9]);
    for (let k = 0; k < 6; k++) lit.box(-8, 3.4 + 2.4 - k * 0.9, D / 2 + 0.4, 6.0, 0.3, 0.12, ramp(STEEL_D, STEEL));
    lit.box(-8, 6.2, D / 2 + 0.38, 7.0, 0.9, 0.4, ramp(STEEL_D, STEEL));
    lit.box(2, 3.6, D / 2 + 0.1, 6.6, 5.6, 0.4, ramp(scaleRgb(wallDark, 0.8), wallDark));
    for (let k = 0; k < 6; k++) lit.box(2, 1.3 + k * 0.9, D / 2 + 0.34, 6.4, 0.24, 0.12, ramp(STEEL_D, STEEL));
    lit.box(-8, 8.7, D / 2 + 0.7, 0.4, 0.4, 0.8, STEEL_D);
    glow.box(-8, 8.2, D / 2 + 1.6, 1.4, 0.3, 1.0, [3.6, 2.8, 0.7]);
    halos.push({ x: -8, y: 8.0, z: D / 2 + 2.1, size: 10, colour: [3.4, 2.5, 0.6], alpha: 0.6, twinkle: 0.1 });
    glow.box(2, 8.2, D / 2 + 1.6, 1.4, 0.3, 1.0, SODIUM);
    halos.push({ x: 2, y: 8.0, z: D / 2 + 2.1, size: 9, colour: SODIUM_HALO, alpha: 0.5 });
    // A row of lit windows high in the wall.
    for (let k = 0; k < 4; k++) {
      glow.box(10 + k * 3.2, 6.3, D / 2 + 0.06, 2.2, 1.1, 0.06, WINDOW);
      lit.box(10 + k * 3.2, 6.3, D / 2 + 0.03, 2.6, 1.5, 0.04, lift("#e8ecf2", 1.5));
    }
    // Pallets with cartons stacked at the near end, and a sign board.
    const wood = lift("#9a7448", 1.6);
    for (const [px, pz, h] of [[W / 2 + 4, 4, 3], [W / 2 + 4, 7.4, 2], [W / 2 + 7.8, 5, 4]] as const) {
      for (let lv = 0; lv < h; lv++) {
        lit.box(px, 0.4 + lv * 1.5, pz, 3.0, 0.3, 3.0, ramp(scaleRgb(wood, 0.7), wood));
        const carton = lift("#c89558", 1.5);
        for (const [dx, dz] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]] as const) lit.box(px + dx, 0.95 + lv * 1.5, pz + dz, 1.35, 1.05, 1.35, ramp(scaleRgb(carton, 0.75), mixRgb(carton, [1, 1, 1], rnd() * 0.2)));
        lit.box(px, 0.95 + lv * 1.5, pz + 1.45, 3, 0.12, 0.05, lift("#f4d34a", 1.5));
      }
    }
    lamp(lit, glow, halos, W / 2 + 1.5, D / 2 + 3, 12, 1);
    return { lit, glow, halos };
  },
};

// ─── Buoys ───────────────────────────────────────────────────────────────────

const buoy: LandmarkSpec = {
  footprint: 14,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halos = [];
    // A little pontoon the buoys are moored beside: planks on floats, with bollards and a ladder.
    lit.box(0, 0.3, 8.5, 12, 0.8, 5.4, ramp(lift("#3a2a1a", 1.5), lift("#9a7448", 1.6)));
    for (let k = 0; k < 6; k++) lit.box(-5 + k * 2, 0.77, 8.5, 0.12, 0.1, 5.4, lift("#3a2a1a", 1.5));
    for (const sx of [-1, 1]) lit.post(sx * 4.6, -0.8, 8.5, 0.9, 1.2, ramp(lift("#2a4a8a", 1.8), lift("#4a7ad0", 1.8)), 8);
    for (const x of [-4.8, 4.8]) {
      lit.post(x, 0.7, 10.6, 0.34, 0.7, ramp(BLACK, STEEL), 8);
      lit.post(x, 1.35, 10.6, 0.42, 0.18, YELLOW, 8);
    }
    lit.rod([0, 0.9, 11.2], [0, -0.6, 11.4], 0.15, STEEL);
    glow.blob(-5.4, 2.0, 6.2, 0.22, 0.22, 0.22, SODIUM, 0);
    lit.post(-5.4, 0.7, 6.2, 0.1, 1.2, STEEL, 4);
    halos.push({ x: -5.4, y: 2.1, z: 6.2, size: 4.5, colour: SODIUM_HALO, alpha: 0.5 });
    // Three buoys of different make: a red can, a white sphere on a stem and a green cone, each on its own chain, bobbing.
    const makers: { x: number; z: number; col: Rgb; tint: Rgb; kind: "can" | "sphere" | "cone"; phase: number; halo: readonly [number, number, number] }[] = [
      { x: -4.2, z: -1.0, col: lift("#e8402e", 2.4), tint: lift("#ff8a70", 2.2), kind: "can", phase: 0, halo: [3.6, 0.35, 0.25] },
      { x: 0.6, z: -3.6, col: lift("#f2f4f8", 1.7), tint: [1.9, 2.0, 2.2], kind: "sphere", phase: 1.8, halo: [3.4, 3.4, 3.2] },
      { x: 4.8, z: -0.4, col: lift("#2f9a5f", 1.9), tint: lift("#5fe08c", 1.8), kind: "cone", phase: 3.4, halo: [0.35, 3.6, 0.8] },
    ];
    const moving: MovingPart[] = [];
    makers.forEach((m, n) => {
      const body = new MeshBuilder();
      const light = new MeshBuilder();
      if (m.kind === "can") {
        lathe(body, [[0.2, -0.6], [1.1, -0.6], [1.45, 0.2], [1.3, 1.0], [1.25, 2.2], [1.0, 2.4], [0.5, 2.4]], { at: [m.x, 0, m.z], segments: 10, shade: byHeight(-0.6, 2.4, scaleRgb(m.col, 0.65), m.tint) });
        lathe(body, [[1.3, 1.1], [1.36, 1.1], [1.34, 1.6], [1.28, 1.6]], { at: [m.x, 0, m.z], segments: 10, shade: lift("#f2f4f8", 1.8) });
      } else if (m.kind === "sphere") {
        body.blob(m.x, 1.2, m.z, 1.5, 1.5, 1.5, ramp(scaleRgb(m.col, 0.65), m.col), 1);
        lathe(body, [[1.6, 0.9], [1.64, 0.9], [1.64, 1.5], [1.6, 1.5]], { at: [m.x, 0, m.z], segments: 10, shade: lift("#d8382a", 1.8) });
        body.post(m.x, 2.4, m.z, 0.28, 1.2, m.col, 6);
      } else {
        lathe(body, [[0.2, -0.6], [1.4, -0.6], [1.5, 0.3], [0.6, 2.4], [0.28, 3.0]], { at: [m.x, 0, m.z], segments: 10, shade: byHeight(-0.6, 3, scaleRgb(m.col, 0.65), m.tint) });
      }
      // The lamp cage on top: three struts and a bright lens.
      const ly = m.kind === "can" ? 2.4 : m.kind === "sphere" ? 3.0 : 3.0;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + n;
        body.rod([m.x + Math.cos(a) * 0.55, ly, m.z + Math.sin(a) * 0.55], [m.x, ly + 1.4, m.z], 0.12, STEEL_D);
      }
      light.blob(m.x, ly + 0.8, m.z, 0.42, 0.5, 0.42, [m.halo[0] * 1.3, m.halo[1] * 1.3, m.halo[2] * 1.3], 1);
      // A short chain dropping into the water.
      body.rod([m.x, -0.4, m.z], [m.x, -2.2, m.z], 0.2, rgb("#3a3f48"));
      moving.push({
        lit: body,
        glow: light,
        pivot: [m.x, 0, m.z],
        update(t, part) {
          part.position.y = Math.sin(t * 1.3 + m.phase) * 0.4;
          part.rotation.z = Math.sin(t * 0.9 + m.phase) * 0.12;
          part.rotation.x = Math.cos(t * 0.7 + m.phase * 1.3) * 0.1;
        },
      });
      // A pale ring of disturbed water round the waterline.
      glass.add(shapes.cylinder(14), xf(m.x, 0.1, m.z, 2.4, 0.08, 2.4), [0.7, 1.0, 1.4]);
      halos.push({ x: m.x, y: ly + 0.9, z: m.z, size: 7, colour: m.halo, alpha: 0.8, twinkle: 1 });
    });
    return { lit, glow, glass, moving, halos };
  },
};

// ─── Hazards ─────────────────────────────────────────────────────────────────

/** The turn of a wheel of natural radius r rolling `travel` world metres, given the root's scale. */
const wheelAngle = (travel: number, root: Object3D, r: number): number => travel / (r * root.scale.x);

const crab: HazardSpec = {
  build(ctx) {
    // Sandy orange at the beach, red-orange in the harbour.
    const beach = ctx.theme === "palm";
    const shell = beach ? lift("#f09a4a", 1.5) : lift("#e5412a", 1.7);
    const shellL = beach ? lift("#ffcf88", 1.5) : lift("#ff7a50", 1.7);
    const belly = beach ? lift("#f4dcb0", 1.4) : lift("#f0b8a0", 1.4);
    const dark = beach ? lift("#8a4a22", 1.4) : lift("#8e1d14", 1.5);
    const bodyB = new MeshBuilder();
    // The carapace is wide along z, the way it walks, and low; it looks toward +x.
    bodyB.blob(0, 0.62, 0, 0.78, 0.45, 1.1, ramp(shell, shellL), 1);
    bodyB.blob(0, 0.42, 0, 0.7, 0.28, 1.0, belly, 0);
    // Raised bumps on the back and a pair of eyes on stalks at the front.
    for (const [dx, dz] of [[-0.1, -0.5], [0.0, 0.0], [-0.1, 0.5], [0.25, -0.25], [0.25, 0.3]] as const) bodyB.blob(dx, 0.98, dz, 0.12, 0.06, 0.12, dark, 0);
    for (const sz of [-1, 1]) {
      bodyB.rod([0.55, 0.9, sz * 0.4], [0.62, 1.3, sz * 0.46], 0.14, shell);
      bodyB.blob(0.64, 1.38, sz * 0.46, 0.17, 0.17, 0.17, [1.5, 1.5, 1.4], 0);
      bodyB.blob(0.8, 1.38, sz * 0.46, 0.08, 0.1, 0.08, rgb("#101010"), 0);
    }
    bodyB.blob(0.78, 0.5, 0, 0.12, 0.05, 0.3, dark, 0);
    // Legs: four on each side of the body (it walks along z), each a jointed arch.
    const legs: Group[] = [];
    const legMat = ctx.lit;
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const g = new MeshBuilder();
        // A leg built reaching to +z; the -z ones are the mirror.
        g.rod([0, 0, 0], [0.04, 0.5, 0.6], 0.2, ramp(dark, shell));
        g.rod([0.04, 0.5, 0.6], [0.2, 0.0, 1.08], 0.17, ramp(dark, shellL));
        g.blob(0.2, 0.04, 1.12, 0.13, 0.06, 0.13, dark, 0);
        const m = new Mesh(g.build(), legMat);
        const grp = new Group();
        grp.add(m);
        grp.scale.z = sz;
        grp.position.set(-0.45 + k * 0.32, 0.5, sz * 0.78);
        grp.rotation.y = (-0.35 + k * 0.23) * sz;
        legs.push(grp);
      }
    }
    // Claws: an arm from each front corner lifted high, a fixed pincer and a hinged one that snaps.
    const claws: { grp: Group; hinge: Group; sz: number }[] = [];
    for (const sz of [-1, 1]) {
      const arm = new MeshBuilder();
      arm.rod([0, 0, 0], [0.45, 0.45, sz * 0.22], 0.28, ramp(dark, shell));
      arm.rod([0.45, 0.45, sz * 0.22], [0.9, 0.35, sz * 0.4], 0.3, ramp(dark, shell));
      const fixed = new MeshBuilder();
      fixed.blob(0.55, 0, 0, 0.7, 0.3, 0.27, ramp(shell, shellL), 1);
      fixed.add(shapes.cone(5), xf(1.22, -0.03, 0, 0.18, 0.5, 0.15, 0, 0, -Math.PI / 2), shellL);
      const moving = new MeshBuilder();
      moving.blob(0.5, 0, 0, 0.6, 0.22, 0.22, ramp(shell, shellL), 1);
      moving.add(shapes.cone(5), xf(1.1, 0.0, 0, 0.15, 0.44, 0.12, 0, 0, -Math.PI / 2), shellL);
      const grp = new Group();
      grp.add(new Mesh(arm.build(), legMat));
      const hand = new Group();
      hand.position.set(0.9, 0.35, sz * 0.4);
      hand.rotation.y = sz * 0.5;
      hand.add(new Mesh(fixed.build(), legMat));
      const hinge = new Group();
      hinge.position.set(0, 0.0, 0);
      hinge.add(new Mesh(moving.build(), legMat));
      hand.add(hinge);
      grp.add(hand);
      grp.position.set(0.5, 0.55, sz * 0.8);
      claws.push({ grp, hinge, sz });
    }
    const root = new Group();
    root.add(new Mesh(bodyB.build(), ctx.lit), ...legs, ...claws.map((c) => c.grp));
    return {
      root,
      radius: 1.1,
      update(s) {
        // A scuttle: legs lift and shuffle in two alternating sets, in step with the ground covered.
        const ph = (s.travel / root.scale.x) * 5.2;
        legs.forEach((g, i) => {
          const q = ph + (i % 2 === 0 ? 0 : Math.PI) + i * 0.4;
          g.rotation.x = Math.sin(q) * 0.38 * g.scale.z;
          g.rotation.z = Math.max(0, Math.cos(q)) * 0.25;
        });
        claws.forEach(({ grp, hinge, sz }, i) => {
          // Raised and waving, the pincers snapping shut and open.
          grp.rotation.z = 0.5 + Math.sin(s.time * 3 + i) * 0.12;
          grp.rotation.y = sz * (0.2 + Math.sin(s.time * 2.2 + i * 2) * 0.12);
          hinge.rotation.y = -sz * (0.1 + Math.max(0, Math.sin(s.time * 7 + i * 1.7)) * 0.55);
        });
        root.position.y = Math.abs(Math.sin(ph * 0.5)) * 0.02;
      },
    };
  },
};

const forklift: HazardSpec = {
  build(ctx) {
    const body = new MeshBuilder();
    const glow = new MeshBuilder();
    const yellow = lift("#f6c010", 1.6);
    const yellowD = lift("#b07a08", 1.5);
    const tyre = lift("#1d2026", 1.5);
    // The chassis and the counterweight at the back; forks are forward, toward +z.
    body.box(0, 0.78, -0.4, 1.9, 0.8, 3.0, ramp(yellowD, yellow));
    body.box(0, 1.15, -1.7, 1.95, 1.4, 1.1, ramp(yellowD, yellow));
    for (let k = 0; k < 5; k++) body.box(-0.8 + k * 0.4, 1.4, -2.27, 0.3, 1.2, 0.08, k % 2 === 0 ? BLACK : yellow);
    body.box(0, 1.25, 0.6, 1.5, 0.5, 1.2, ramp(yellowD, yellow));
    // Seat, steering column and wheel.
    body.box(0, 1.55, -0.9, 0.9, 0.35, 0.8, lift("#2c3038", 1.6));
    body.box(0, 2.0, -1.2, 0.9, 0.9, 0.2, lift("#2c3038", 1.6));
    body.rod([0, 1.4, 0.35], [0, 2.0, 0.1], 0.14, STEEL_D);
    body.add(shapes.cylinder(10), xf(0, 2.1, 0.08, 0.34, 0.08, 0.34, 0, 0.4), BLACK);
    // The roll cage: four posts and a roof grid.
    for (const sx of [-1, 1]) {
      body.rod([sx * 0.85, 1.4, 0.55], [sx * 0.85, 3.0, 0.45], 0.14, ramp(BLACK, STEEL_D));
      body.rod([sx * 0.85, 1.6, -1.5], [sx * 0.85, 3.0, -1.2], 0.14, ramp(BLACK, STEEL_D));
      body.rod([sx * 0.85, 3.0, 0.45], [sx * 0.85, 3.0, -1.2], 0.14, STEEL_D);
    }
    body.box(0, 3.06, -0.4, 1.9, 0.1, 1.9, STEEL_D);
    for (const z of [0.1, -0.4, -0.9]) body.box(0, 3.14, z, 1.9, 0.1, 0.12, STEEL_D);
    // The mast: two uprights with cross ties, a carriage, and a pair of forks pointing +z.
    for (const sx of [-1, 1]) body.box(sx * 0.55, 1.7, 1.55, 0.22, 3.3, 0.28, ramp(STEEL_D, STEEL));
    for (const y of [0.8, 1.9, 3.1]) body.box(0, y, 1.55, 1.3, 0.22, 0.3, STEEL_D);
    body.box(0, 0.75, 1.8, 1.7, 0.5, 0.24, ramp(STEEL_D, STEEL));
    body.box(0, 1.4, 1.8, 1.6, 0.14, 0.24, STEEL_D);
    for (const sx of [-1, 1]) {
      body.box(sx * 0.5, 0.28, 3.0, 0.22, 0.2, 2.2, ramp(STEEL_D, STEEL));
      body.box(sx * 0.5, 0.65, 1.95, 0.22, 0.8, 0.2, STEEL_D);
    }
    // Lights: a pair of white headlamps on the mast, red tail lamps, and an amber beacon on the roof that flashes.
    for (const sx of [-1, 1]) {
      glow.box(sx * 0.85, 1.2, 1.78, 0.26, 0.2, 0.08, [3.6, 3.4, 2.6]);
      glow.box(sx * 0.7, 1.35, -2.3, 0.3, 0.18, 0.06, [3.4, 0.3, 0.2]);
    }
    body.post(0, 3.2, -0.4, 0.3, 0.14, BLACK, 8);
    const beacon = new MeshBuilder();
    beacon.blob(0, 3.45, -0.4, 0.3, 0.34, 0.3, [4.2, 2.3, 0.3], 1);
    const beaconGlow = new Mesh(beacon.build(), ctx.glow);
    // Wheels: big drive wheels at the front and small steering wheels at the back, each turning with the ground.
    const wheel = (r: number, w: number): Group => {
      const g = new MeshBuilder();
      g.add(shapes.cylinder(12), xf(0, 0, 0, r, w, r, 0, 0, Math.PI / 2), ramp(scaleRgb(tyre, 0.8), tyre));
      g.add(shapes.cylinder(8), xf(0, 0, 0, r * 0.55, w + 0.06, r * 0.55, 0, 0, Math.PI / 2), lift("#b8bec8", 1.6));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        g.blob(0, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, (w + 0.14) / 2, 0.05, 0.05, STEEL_D, 0);
      }
      const grp = new Group();
      grp.add(new Mesh(g.build(), ctx.lit));
      return grp;
    };
    const wheels: { grp: Group; r: number }[] = [];
    for (const [x, y, z, r, w] of [[-1.05, 0.58, 0.7, 0.58, 0.5], [1.05, 0.58, 0.7, 0.58, 0.5], [-0.95, 0.42, -1.65, 0.42, 0.4], [0.95, 0.42, -1.65, 0.42, 0.4]] as const) {
      const g = wheel(r, w);
      g.position.set(x, y, z);
      wheels.push({ grp: g, r });
    }
    const root = new Group();
    root.add(new Mesh(body.build(), ctx.lit), new Mesh(glow.build(), ctx.glow), beaconGlow, ...wheels.map((w) => w.grp));
    return {
      root,
      radius: 2.2,
      update(s) {
        for (const w of wheels) w.grp.rotation.x = wheelAngle(s.travel, root, w.r);
        // The beacon flashes amber, twice a second.
        const on = Math.sin(s.time * 7) > -0.2 ? 1 : 0.35;
        beaconGlow.scale.setScalar(on);
        beaconGlow.position.y = 3.45 * (1 - on);
        beaconGlow.position.z = -0.4 * (1 - on);
        root.position.y = Math.sin(s.travel * 3) * 0.015;
      },
    };
  },
};

// BEGIN EXPORTS
export const LANDMARKS: Record<string, LandmarkSpec> = {
  crane,
  lighthouse,
  ship,
  containers,
  warehouse,
  buoy,
};

export const HAZARDS: Record<string, HazardSpec> = {
  crab,
  forklift,
};
