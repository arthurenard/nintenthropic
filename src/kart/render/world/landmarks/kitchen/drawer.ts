/**
 * The cutlery drawer the kitchen's shortcut runs down, a span (see spans.ts for how those are built).
 */
import { extrudeZ, MeshBuilder, mixRgb, ramp, scaleRgb } from "../kit";
import type { LandmarkSpec } from "../types";
import { GOLD, lift, STEEL, STEEL_L, WALNUT, WOOD_L } from "./common";

// ─── Drawer ──────────────────────────────────────────────────────────────────

/**
 * The cutlery drawer the shortcut runs down (a span, built in the road's frame): a walnut drawer pulled right out of the
 * counter, its brass-edged walls either side of the road, felt-lined inside, a divider rail of steel spoons and forks laid
 * across over the road, well over a kart's head.
 */
export const drawer: LandmarkSpec = {
  span: true,
  defaultSpan: 40,
  build(ctx) {
    const lit = new MeshBuilder();
    const L = ctx.span;
    const z0 = -L / 2;
    const z1 = L / 2;
    // The walls stand beyond the barrier and the camera's margin.
    const hi = ctx.halfWidth + 7.7;
    const ho = hi + 1.1;
    const wallH = 4.6;
    const felt = lift("#7a1f2b", 1.25);
    const steps = Math.max(2, Math.round(L / 4));
    for (const s of [-1, 1]) {
      // The side: walnut outside, felt inside, a brass lip along the top.
      extrudeZ(lit, [[s * ho, 0], [s * ho, wallH], [s * hi, wallH], [s * hi, 0]], z0, z1, steps, (p, i) => scaleRgb(mixRgb(WALNUT, WOOD_L, Math.min(1, p[1] / wallH)), i % 2 ? 1.04 : 0.96));
      extrudeZ(lit, [[s * hi, wallH], [s * hi, 0.3]], z0, z1, steps, (p) => scaleRgb(felt, 0.7 + 0.3 * Math.min(1, p[1] / wallH)));
      lit.box(s * (hi + 0.55), wallH + 0.12, 0, 1.4, 0.24, L, GOLD);
    }
    // The drawer's front and back boards, with a knob on the front's outside, stand either side of the road at its ends.
    for (const [z, face] of [[z0 - 0.4, -1], [z1 + 0.4, 1]] as const) {
      for (const s of [-1, 1]) {
        lit.box(s * (hi + (ho - hi) / 2 + 2.2), wallH / 2 + 0.2, z, (ho - hi) + 4.4, wallH + 0.4, 0.8, ramp(WALNUT, WOOD_L));
        lit.box(s * (hi + 1.4), wallH / 2 + 0.2, z + face * 0.5, 1.6, 1.4, 0.3, GOLD);
      }
    }
    // The divider rail: a spoon or a fork laid across the road every few metres, over a kart's head.
    let k = 0;
    for (let z = z0 + 6; z < z1 - 3; z += 7) {
      const y = 6.4;
      lit.box(0, y, z, 2 * ho, 0.4, 0.55, ramp(STEEL, STEEL_L));
      const fork = k++ % 2 === 0;
      for (const s of [-1, 1]) {
        const x = s * (hi - 2.2);
        if (fork) {
          for (const t of [-0.42, -0.14, 0.14, 0.42]) lit.box(x, y, z + t * 1.3, 2.6, 0.32, 0.12, STEEL_L);
        } else {
          lit.blob(x, y, z, 1.5, 0.2, 0.9, STEEL_L, 0);
        }
      }
    }
    return { lit };
  },
};
