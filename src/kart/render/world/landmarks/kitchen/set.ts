/**
 * Kitchen Rally's second pass: the stand mixer whose whisk sweeps the road, the cooker the road climbs over, the spatula
 * lying beside it and the draining board with the tap that drips onto it. The mixer, the cooker and the drainer are
 * spans (LandmarkContext.span): built in the road's frame (x to the right of the centre line, y up, z along the road) and
 * bent along it, so anything long is cut into pieces of three metres or less. The whisk and the drip themselves are set
 * pieces (world/pieceSet.ts).
 */
import { MeshBuilder, rgb, scaleRgb, shapes, torus, tube, xf, type Rgb, type V3 } from "../kit";
import type { LandmarkSpec } from "../types";
import { bezier, chrome, APPLE, BLUE, GOLD, STEEL, STEEL_D, STEEL_L, WALNUT, lift, WHITE } from "./common";

const ENAMEL: Rgb = [1.0, 1.15, 1.5];
const ENAMEL_D: Rgb = [0.62, 0.72, 1.0];

/** A box along z cut into pieces of at most 2.8 m, so a span landmark bends with the road. */
function longBox(b: MeshBuilder, x: number, y: number, z0: number, z1: number, sx: number, sy: number, paint: Rgb | { bottom: Rgb; top: Rgb }): void {
  const n = Math.max(1, Math.ceil((z1 - z0) / 2.8));
  const step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) b.box(x, y, z0 + (i + 0.5) * step, sx, sy, step + 0.02, paint);
}

// ─── Mixer ───────────────────────────────────────────────────────────────────

/**
 * A stand mixer reaching over the road: a base and a column beside it (beyond the barrier and the camera), an arm across at
 * well over a kart's roof, and the motor head over the middle with the whisk's shaft below it. The whisk (a sweeper of
 * balloon heads on poles) turns under it round the post the pieces layer stands at the road's centre.
 */
export const mixer: LandmarkSpec = {
  span: true,
  defaultSpan: 16,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const hw = ctx.halfWidth;
    const L = ctx.span;
    const px = hw + 11;
    // The base: a long foot with rubber pads, the column rising from it and leaning a little.
    longBox(lit, px, 0.9, -L / 2 - 2, L / 2 + 2, 9, 1.8, { bottom: scaleRgb(ENAMEL_D, 0.8), top: ENAMEL });
    for (const z of [-L / 2 + 0.5, L / 2 - 0.5]) for (const dx of [-3.4, 3.4]) lit.box(px + dx, 0.12, z, 1.2, 0.24, 1.2, rgb("#25252b"));
    lit.box(px, 6.9, 0, 5.2, 10.2, 5.4, { bottom: scaleRgb(ENAMEL_D, 0.9), top: ENAMEL });
    lit.box(px, 12.3, 0, 5.0, 1.0, 5.2, { bottom: ENAMEL, top: WHITE });
    // The arm across the road at 11 m, tapering, with a chrome stripe along its side.
    const armY = 11.8;
    lit.box(px / 2 + 1.2, armY, 0, px - 1.5, 2.4, 3.6, { bottom: ENAMEL_D, top: ENAMEL });
    lit.box(px / 2 + 1.2, armY - 0.55, -1.82, px - 1.5, 0.35, 0.1, scaleRgb(STEEL_L, 0.85));
    // The motor head hung at the end of it, over the middle of the road, with its grille and the shaft down to the whisk.
    lit.blob(0, armY - 0.3, 0, 2.7, 2.4, 4.8, { bottom: ENAMEL_D, top: WHITE }, 1);
    lit.box(0, armY - 0.2, -4.5, 2.6, 1.4, 0.2, rgb("#2a2f3a"));
    lit.post(0, 7.0, 0, 0.7, 2.6, { bottom: STEEL_D, top: STEEL_L }, 10);
    lit.post(0, 6.6, 0, 0.5, 0.6, STEEL_L, 8);
    // A speed dial on the column's face, a red knob and a lever, an indicator LED on the head.
    lit.post(px - 2.7, 8.0, -0.2, 0.9, 0.5, STEEL_D, 12);
    lit.add(shapes.cylinder(12), xf(px - 2.75, 8.0, -1.1, 0.7, 0.8, 0.7, 0, Math.PI / 2), lift("#d62b2b", 1.4));
    lit.box(px - 2.75, 9.8, -2.4, 0.3, 1.3, 0.2, STEEL);
    glow.blob(0, armY - 0.3, -4.6, 0.3, 0.3, 0.2, [3.0, 0.35, 0.25], 1);
    // A small brand plate on the base (the bowl is the road).
    lit.box(px - 4.52, 1.1, 0, 0.1, 0.7, 3.0, GOLD);
    return { lit, glow, halos: [{ x: 0, y: armY - 0.3, z: -4.8, size: 3.4, colour: [3.0, 0.4, 0.3], alpha: 0.35, twinkle: 0.2 }] };
  },
};

// ─── Cooker ──────────────────────────────────────────────────────────────────

/**
 * The cooker whose hob the road is: the cabinet's two long sides either side of it, below the road (oven doors with a warm
 * window and a chrome handle facing in), and the burners glowing on the road itself, flat rings of red-hot wire.
 */
export const cooker: LandmarkSpec = {
  span: true,
  defaultSpan: 56,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const hw = ctx.halfWidth;
    const L = ctx.span;
    const z0 = -L / 2;
    const z1 = L / 2;
    for (const s of [-1, 1]) {
      // The side of the cabinet, sunk below the road, and a chrome trim along its top edge.
      longBox(lit, s * (hw + 0.8), -4.6, z0, z1, 0.9, 9.0, { bottom: scaleRgb(ENAMEL_D, 0.7), top: ENAMEL });
      longBox(lit, s * (hw + 0.55), -0.28, z0, z1, 0.5, 0.34, scaleRgb(STEEL_L, 0.85));
      // Oven doors in the side, facing the road: a recessed warm window and a chrome handle bar, one per twelve metres.
      for (let z = z0 + 7; z < z1 - 5; z += 14) {
        glow.box(s * (hw + 0.32), -3.3, z, 0.08, 2.8, 7.4, [2.1, 1.1, 0.35]);
        lit.box(s * (hw + 0.28), -3.3, z - 3.9, 0.22, 3.2, 0.3, STEEL_D);
        lit.box(s * (hw + 0.28), -3.3, z + 3.9, 0.22, 3.2, 0.3, STEEL_D);
        lit.box(s * (hw + 0.28), -1.1, z, 0.22, 0.28, 8.2, STEEL_L);
        lit.box(s * (hw + 0.18), -1.6, z - 3.6, 0.3, 0.8, 0.3, STEEL);
        lit.box(s * (hw + 0.18), -1.6, z + 3.6, 0.3, 0.8, 0.3, STEEL);
      }
    }
    // The burners: two rings of red-hot wire laid on the road, four of them along it.
    const spots: [number, number][] = [[-3.4, z0 + 9], [3.4, z0 + 20], [-3.4, z0 + 31], [3.4, z0 + 42]];
    for (const [x, z] of spots) {
      if (z > z1 - 4) continue;
      torus(glow, 2.5, 0.16, { at: [x, 0.09, z], facing: "y", ringSegments: 22, tubeSegments: 3, shade: [2.5, 0.55, 0.12] });
      torus(glow, 1.4, 0.14, { at: [x, 0.09, z], facing: "y", ringSegments: 16, tubeSegments: 3, shade: [2.8, 0.7, 0.15] });
    }
    const halos = spots.filter(([, z]) => z <= z1 - 4).map(([x, z]) => ({ x, y: 0.6, z, size: 9, colour: [2.2, 0.55, 0.15] as const, alpha: 0.2, twinkle: 0.3 }));
    return { lit, glow, halos };
  },
};

// ─── Spatula ─────────────────────────────────────────────────────────────────

/** A giant slotted turner lying on the counter beside the road, its long handle toward the back, the blade tipped up on a crumb. */
export const spatula: LandmarkSpec = {
  footprint: 8,
  build() {
    const lit = new MeshBuilder();
    const blade = { bottom: scaleRgb(STEEL_D, 0.9), top: STEEL_L };
    // The blade (slightly raised at the front), its slots, and the rolled neck.
    lit.box(0, 0.9, 3.4, 6.2, 0.4, 7.4, blade, 0, -0.1);
    for (let i = 0; i < 5; i++) lit.box(-2.4 + i * 1.2, 1.12, 3.6, 0.55, 0.06, 4.6, rgb("#1d2229"), 0, -0.1);
    lit.box(0, 0.62, -0.9, 2.6, 0.45, 2.2, scaleRgb(STEEL, 0.9), 0, 0.2);
    // The handle: walnut, long, with a steel ferrule and a hanging hole at the end; lying up on a stub of crumbs.
    lit.box(0, 1.15, -4.2, 1.1, 0.7, 4.0, WALNUT, 0, 0.1);
    lit.box(0, 1.5, -10, 1.6, 1.0, 9.0, { bottom: scaleRgb(WALNUT, 0.85), top: lift("#7a4b2a", 1.2) }, 0, 0.04);
    lit.add(shapes.cylinder(10), xf(0, 1.6, -14.7, 0.9, 0.2, 0.9, 0, Math.PI / 2), rgb("#161616"));
    lit.box(0, 1.1, -2.2, 1.3, 0.9, 0.5, STEEL);
    lit.blob(0.8, 0.35, -9.6, 0.9, 0.35, 0.7, lift("#e8c88a", 1.2), 0);
    lit.blob(-0.9, 0.3, -2.4, 0.7, 0.3, 0.6, lift("#e8c88a", 1.2), 0);
    return { lit };
  },
};

// ─── Drainer ─────────────────────────────────────────────────────────────────

/**
 * The tap over the draining board's trough: a chrome column beyond the barrier with a swan neck arching over the road to a
 * spout above its middle, and a hot and a cold lever. The drips fall from the pieces' own pipe a little lower; this is
 * what they leak from.
 */
export const drainer: LandmarkSpec = {
  span: true,
  defaultSpan: 70,
  build(ctx) {
    const lit = new MeshBuilder();
    const glass = new MeshBuilder();
    const hw = ctx.halfWidth;
    const px = hw + 10;
    const L = ctx.span;
    // The column: a polished tube from the board's deck, flaring at the foot, with the levers on its sides.
    const bellows: V3[] = bezier([px, -3, 0], [px, 6, 0], [px, 10, 0], [px, 14, 0], 6);
    tube(lit, bellows, { radius: (t) => 1.6 - 0.5 * t, sides: 10, shade: chrome(-3, 14, 0.06), caps: true });
    lit.post(px, -3, 0, 2.8, 0.9, { bottom: STEEL_D, top: STEEL }, 12, 0.6);
    // The swan neck, over the road, ending in a spout that points down above the middle of the board.
    const neck: V3[] = bezier([px, 14, 0], [px, 19, 0], [px * 0.35, 20.5, 0], [0, 17.5, 0], 12);
    tube(lit, neck, { radius: 0.95, sides: 10, shade: chrome(10, 21, 0.06) });
    lit.post(0, 15.2, 0, 0.8, 2.4, { bottom: STEEL, top: STEEL_L }, 10, 0.75);
    lit.post(0, 14.9, 0, 0.42, 0.4, { bottom: STEEL_D, top: STEEL }, 8);
    // Levers: a red one and a blue one, each on a short stem.
    for (const [dz, c] of [[-1.7, APPLE], [1.7, BLUE]] as const) {
      lit.add(shapes.cylinder(8), xf(px - 1.0, 6.5, dz, 0.35, 1.0, 0.35, 0, 0, Math.PI / 2), STEEL);
      lit.blob(px - 2.2, 6.5, dz, 0.55, 0.75, 0.45, c, 1);
    }
    // A thin film of water standing at the foot of the board's slope: a pale blue sheet just above the road, in pieces.
    for (let z = -L / 2 + 8; z < L / 2 - 8; z += 3) glass.box(0, 0.12, z, 2 * hw - 1.0, 0.04, 3.02, [0.5, 0.78, 1.0]);
    return { lit, glass };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = { mixer, cooker, spatula, drainer };
