/**
 * The frozen waterfall the glacier's split runs behind (a span): the road slips into a pocket in the cliff, a wall of dark
 * rock on its left and a roof of ice over it, and on its right the waterfall itself, frozen mid-fall: dozens of fluted
 * columns of translucent ice hung from the roof's edge and standing on a frozen pool, with the blue light of the day
 * coming through them. Everything that stands in the band a kart and its camera meet (up to 5 m) is beyond the barrier and
 * its margin, on both sides, so the road is clear: what is over it is the ice roof, eleven metres up.
 */
import { MeshBuilder, mixRgb, ramp, rgb, rockBlob, scaleRgb, shapes, xf, type Rgb, type Shade, type V3 } from "../kit";
import { beam, drift, flutedPipe, hash, icicle, ribbon } from "../rockKit";
import type { Halo, LandmarkSpec } from "../types";
import { ICE_GLOW, SNOW, SNOW_MID, snowShade } from "./common";

const ROCK_DARK = rgb("#3d4764");
const ROCK_MID = rgb("#5b6b8c");
const ROCK_PALE = rgb("#8896b4");
const ICE_LO = rgb("#8fd0f6");
const ICE_HI = rgb("#eaf8ff");
const ICE_GLASS = rgb("#8fd0ff");

/** Blue-grey rock in bands, a little warmer where the light catches it. */
const rock = (seed: number, tone = 1): Shade => (p: V3, i: number, j: number): Rgb => {
  const k = Math.floor(p[1] / 2.2 + hash(Math.floor(p[1] / 2.2), seed) * 0.7);
  const c = [ROCK_MID, ROCK_DARK, ROCK_PALE, ROCK_MID][Math.abs(k) % 4]!;
  return scaleRgb(c, tone * (0.86 + 0.24 * hash(i, j, seed + 2)));
};

const iceShade = (top: number, seed: number): Shade => (p: V3, i: number, j: number): Rgb =>
  scaleRgb(mixRgb(ICE_LO, ICE_HI, Math.max(0, Math.min(1, p[1] / top))), 0.9 + 0.22 * hash(i, j, seed));

export const frozenFalls: LandmarkSpec = {
  span: true,
  defaultSpan: 36,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const halos: Halo[] = [];
    const L = ctx.span;
    const half = L / 2;
    const hw = Math.max(13.4, ctx.halfWidth + 8.4);
    const roofY = 11.2;
    // The cliff on the left: a wall of dark banded rock, buttressed with lumps, from the ground to well above the roof.
    for (let z = -half - 3; z < half + 3; z += 4.2) {
      const k = Math.round(z / 4.2);
      const x = -hw - 3.2 - hash(k, 3) * 2.4;
      const h = 15 + hash(k, 4) * 7;
      rockBlob(lit, x, -1.5, z, 5.2 + hash(k, 2) * 1.6, h, 4.4 + hash(k, 1) * 1.2, rock(k + 5, 0.9 + 0.2 * hash(k, 9)), k + 8, { detail: 1, roughness: 0.22, flatBase: true });
      rockBlob(lit, -hw - 1.0 - hash(k, 6) * 1.4, 0, z + 2, 2.8 + hash(k, 7) * 1.5, 3 + hash(k, 8) * 3, 3.4, rock(k + 15), k + 3, { detail: 1, roughness: 0.3, flatBase: true });
    }
    // The roof: a shelf of ice from the cliff out past the road's right edge, built of overlapping slabs so its ends and lip
    // are round, with snow heaped on top and a fringe of icicles under it.
    const roofShade: Shade = (p) => mixRgb(rgb("#9fd2f2"), rgb("#e4f6ff"), Math.max(0, Math.min(1, (p[1] - roofY) / 3.4)));
    for (let z = -half - 2; z < half + 2; z += 3.4) {
      const k = Math.round(z / 3.4);
      rockBlob(lit, -1.0 + (hash(k, 2) - 0.5) * 1.6, roofY + 1.7, z, hw + 4.6, 1.7 + hash(k, 3) * 0.5, 2.8, roofShade, k + 2, { detail: 1, roughness: 0.1 });
      lit.blob(-2 + hash(k, 1) * 8, roofY + 3.9, z + 1.2, 5 + hash(k, 2) * 2, 1.3, 2.6, ramp(SNOW_MID, SNOW), 1);
    }
    for (let k = 0; k < 24; k++) {
      const x = -hw + 1 + hash(k, 11) * 2 * (hw - 2);
      const len = 0.8 + hash(k, 12) * 1.6;
      icicle(glass, x, roofY - 0.1, -half + 1 + hash(k, 13) * (L - 2), 0.18 + hash(k, 14) * 0.14, len, rgb("#a8dcff"), 5);
    }
    // The waterfall: columns of ice hung from the roof's right edge, in two staggered rows, fat and fluted, some reaching the
    // frozen pool below and some stopping short in a point; each a pale lit core inside a translucent glassy skin.
    let n = 0;
    for (let z = -half + 1.2; z < half - 0.8; z += 1.7) {
      const row = n++ % 2;
      const x = hw + 0.4 + row * 1.2 + (hash(n, 1) - 0.5) * 0.4;
      const r = 0.7 + hash(n, 2) * 0.55;
      const bottom = hash(n, 3) < 0.25 ? 2.5 + hash(n, 4) * 3 : -0.2;
      flutedPipe(glass, [x, bottom, z], [x, roofY + 0.2, z], r * 1.08, 6, ICE_GLASS, r * 1.3, false);
      flutedPipe(lit, [x + 0.05, bottom + 0.3, z], [x + 0.05, roofY + 0.2, z], r * 0.62, 6, iceShade(roofY, n), r * 0.8, false);
      if (bottom > 1) lit.add(shapes.cone(6), xf(x, bottom - 0.5, z, r * 0.7, 1.4, r * 0.7, n, Math.PI), ramp(ICE_LO, ICE_HI));
    }
    // A few great columns, the main cataracts, fluted wide, with a glow behind them.
    for (const zt of [-0.55, 0, 0.55]) {
      const z = zt * half;
      const x = hw + 3.6;
      flutedPipe(glass, [x, -0.2, z], [x - 0.6, roofY + 0.4, z], 2.0, 8, ICE_GLASS, 2.6, false);
      flutedPipe(lit, [x, 0, z], [x - 0.6, roofY + 0.4, z], 1.3, 8, iceShade(roofY, 40 + zt * 10), 1.8, false);
      ribbon(glow, [[hw + 1.6, 1, z], [hw + 1.4, 6, z], [hw + 1.2, roofY - 0.5, z]], 0.4, [-1, 0, 0], ICE_GLOW);
      halos.push({ x: hw + 1.4, y: 6, z, size: 15, colour: [0.35, 0.85, 1.5], alpha: 0.45, twinkle: 0.12 });
    }
    // The frozen pool: a rolling mound of ice at the foot of the falls, outside the curtain.
    for (let z = -half; z < half; z += 5) {
      const k = Math.round(z / 5);
      rockBlob(lit, hw + 4.5 + hash(k, 4) * 1.6, 0, z + 2.5, 3.2 + hash(k, 5), 1.0 + hash(k, 6) * 0.8, 3.3, iceShade(2, 60 + k), k + 4, { detail: 1, roughness: 0.18, flatBase: true });
    }
    // The glow: ribbons down the cliff wall's face and along the roof's underside, so the pocket is lit blue from within.
    for (const x of [-hw + 0.6, -hw + 2.6]) {
      const pts: V3[] = [];
      for (let z = -half + 2; z <= half - 2; z += 4) pts.push([x, 5.4 + 0.5 * Math.sin(z * 0.4), z]);
      ribbon(glow, pts, 0.28, [1, 0, 0], ICE_GLOW);
    }
    for (let z = -half + 3; z < half; z += 9) halos.push({ x: 0, y: roofY - 2, z, size: 22, colour: [0.35, 0.85, 1.5], alpha: 0.4, twinkle: 0.12 });
    // Snow banked at the ends of the cliff, so it reads as a pocket in a mountain.
    for (const s of [-1, 1]) {
      drift(lit, -hw - 3, s * (half + 1), 5, 2.4, 3.2, snowShade(0, 3), 30 + s);
      beam(lit, [-hw - 8, 10, s * (half - 1)], [-hw - 3, 15, s * (half - 1)], 3, 2, [0, 0, 1], ROCK_DARK, ROCK_MID);
    }
    return { lit, glow, glass, halos };
  },
};
