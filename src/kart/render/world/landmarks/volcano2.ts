/**
 * The volcano world's second-pass landmarks (docs/GRIP_PRIX.md, Volcano Rush): the lava tube, a tunnel through the crater's rock
 * that a shortcut runs through, black basalt on the outside and lit from below by two channels of live lava.
 */
import { byHeight, MeshBuilder, mixRgb, ramp, scaleRgb, shapes, xf, type Rgb, type Shade } from "./kit";
import { ceilingAt, hash, icicle, noisyArch, vec } from "./rockKit";
import type { Halo, LandmarkSpec } from "./types";

const LAVA_HOT: Rgb = [1.9, 1.3, 0.35];
const LAVA: Rgb = [1.4, 0.48, 0.07];
const LAVA_DEEP: Rgb = [1.0, 0.24, 0.04];
const GLOW_HALO: Rgb = [2.6, 0.95, 0.28];

/** The tube's inside: warm near the floor from the lava channels, cooling to near black at the crown, with a vein of glow now and then. */
const inside = (top: number, seed: number): Shade => (p, i, j) => {
  const t = Math.max(0, Math.min(1, p[1] / top));
  const base = mixRgb([0.5, 0.17, 0.06], [0.04, 0.032, 0.04], Math.sqrt(t));
  const vein = hash(i, j, seed) > 0.93 ? 0.9 : 0;
  return mixRgb(scaleRgb(base, 0.8 + 0.5 * hash(i, j, seed + 1)), LAVA, vein * (1 - t));
};
const outside = (top: number, seed: number): Shade => (p, i, j) => {
  const t = Math.max(0, Math.min(1, p[1] / top));
  const base = mixRgb([0.075, 0.034, 0.028], [0.07, 0.062, 0.078], t);
  return scaleRgb(base, 0.75 + 0.55 * hash(i, j, seed));
};

const lavaTube: LandmarkSpec = {
  span: true,
  defaultSpan: 80,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const hw = Math.max(13.5, ctx.halfWidth + 9);
    const top = 9.4;
    const legs = 4.2;
    const half = ctx.span / 2;
    const lip = 3.2;
    const thick = (t: number) => 2.6 + 1.6 * Math.sin(Math.PI * t);
    const body = { halfIn: hw, topIn: top, legs, thick, steps: Math.max(6, Math.round(ctx.span / 3)), arcSteps: 14, rough: 0.7, seed: 31, skirt: 3 };
    noisyArch(lit, { ...body, z0: -half + lip, z1: half - lip, inner: inside(top, 3), outer: outside(top + 7, 4) });
    // The mouths: fatter, rougher rims of black glass, a crust of cooling lava on their lips.
    for (const s of [-1, 1]) {
      const z0 = s < 0 ? -half : half - lip - 0.01;
      noisyArch(lit, { ...body, thick: (t) => 3.2 + 2 * Math.sin(Math.PI * t), steps: 2, rough: 1.2, seed: 40 + s, z0, z1: z0 + lip + 0.01, inner: byHeight(0, top, [0.45, 0.14, 0.05], [0.05, 0.04, 0.05]), outer: byHeight(0, top + 9, [0.06, 0.03, 0.03], [0.12, 0.1, 0.13]) });
      const zc = s * (half - lip / 2);
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (0.08 + (k / 6) * 0.84);
        const x = Math.cos(a) * (hw + 3.2);
        const y = legs + Math.sin(a) * (top - legs + 3.2);
        glow.box(x, y, zc + s * 0.7, 0.5, 0.2, lip * 0.7, k % 2 ? LAVA : LAVA_HOT, 0, 0, a - Math.PI / 2);
      }
    }
    // Two channels of lava along the floor, at the walls, just outside the road and its barrier.
    const channel = hw - 0.9;
    for (const s of [-1, 1]) {
      for (let z = -half + lip; z < half - lip - 1; z += 3) {
        const t = hash(Math.round(z), s, 5);
        glow.box(s * channel, 0.2, z + 1.5, 1.6, 0.25, 3.05, t > 0.7 ? LAVA_HOT : t > 0.25 ? LAVA : LAVA_DEEP);
      }
      // Dark crust floating on it.
      for (let k = 0; k < 9; k++) {
        const z = -half + lip + 2 + hash(k, s + 3, 6) * (ctx.span - 2 * lip - 4);
        lit.add(shapes.cylinder(6), xf(s * (channel + (hash(k, 9, s) - 0.5) * 0.8), 0.5, z, 0.8 + hash(k, 7, s) * 0.5, 0.18, 0.8, k), [0.03, 0.025, 0.03]);
      }
    }
    // Glowing seams that run along the crown, dashed, and basalt teeth hanging from it (none low enough for the chase camera).
    const seam = (a: number) => [Math.cos(a) * (hw - 0.5), legs + Math.sin(a) * (top - legs) - 0.5] as const;
    for (const f of [0.18, 0.4, 0.6, 0.82]) {
      const [sx, sy] = seam(Math.PI * f);
      for (let z = -half + lip + 1; z < half - lip - 2; z += 6) glow.box(sx, sy, z + 1.4, 0.38, 0.26, 3.6, hash(Math.round(z), Math.round(f * 10), 8) > 0.5 ? LAVA : LAVA_DEEP, 0, 0, Math.PI * f - Math.PI / 2);
    }
    for (let k = 0; k < 40; k++) {
      const x = (hash(k, 1, 2) - 0.5) * 2 * (hw - 1.5);
      const ceil = ceilingAt(x, hw, top, legs);
      const cap = Math.abs(x) <= 9.5 ? Math.min(2.2, ceil - 8.4) : 3.2;
      if (cap < 0.5) continue;
      const len = Math.min(cap, 0.6 + hash(k, 2, 3) * 2.4);
      const z = -half + lip + 1 + hash(k, 3, 4) * (ctx.span - 2 * lip - 2);
      icicle(lit, x, ceil + 0.25, z, 0.25 + hash(k, 8, 1) * 0.25, len, k % 4 === 0 ? [0.5, 0.18, 0.07] : [0.06, 0.05, 0.07], 5);
    }
    // A few shelves of rock on the walls, warmed from below.
    for (let k = 0; k < 8; k++) {
      const s = k % 2 === 0 ? -1 : 1;
      const z = -half + lip + 4 + (k / 7) * (ctx.span - 2 * lip - 8);
      lit.blob(s * (hw - 0.8), 1.7, z, 1.1, 1.6, 2.0, ramp([0.5, 0.17, 0.06], [0.06, 0.05, 0.07]), 1);
    }
    // Standing outside the mouths: two bright pillars of rock (the way in, lit from inside).
    for (const s of [-1, 1]) {
      const zc = s * (half + 1.6);
      for (const sx of [-1, 1]) {
        const x = sx * (hw + 4.2);
        lit.add(shapes.cone(5), xf(x, 5.5, zc, 1.6, 11, 1.6, k0(sx, s)), ramp([0.5, 0.17, 0.06], [0.05, 0.04, 0.06]));
        glow.add(shapes.cone(4), xf(x, 9.3, zc, 0.32, 3.4, 0.32), LAVA_HOT);
      }
    }
    const halos: Halo[] = [];
    for (let z = -half + 6; z <= half - 5; z += 11) {
      halos.push({ x: 0, y: top - 2.4, z, size: 20, colour: GLOW_HALO, alpha: 0.4, twinkle: 0.16 });
      halos.push({ x: (z % 22 === 0 ? -1 : 1) * (channel - 0.5), y: 1.4, z: z + 5, size: 11, colour: GLOW_HALO, alpha: 0.34, twinkle: 0.12 });
    }
    for (const s of [-1, 1]) halos.push({ x: 0, y: 5, z: s * (half - 1), size: 28, colour: GLOW_HALO, alpha: 0.4, twinkle: 0.1 });
    void vec;
    void LAVA_DEEP;
    return { lit, glow, halos };
  },
};

const k0 = (a: number, b: number): number => a * 0.7 + b * 1.3;

export const LANDMARKS: Record<string, LandmarkSpec> = { "lava-tube": lavaTube };
export const HAZARDS = {};
