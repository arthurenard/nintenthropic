/**
 * The palm world's second-pass landmarks (docs/GRIP_PRIX.md, Five Finger Circuit): the tiki arch, the gate at either end of the
 * palm trail, the sandy cut across the middle of the hand. Carved bamboo posts on stone feet, a log across the top under a fringe of
 * thatch, lanterns, and a torch at each foot; a row of torches lines the trail's mouth.
 */
import { MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, xf, type Rgb } from "./kit";
import { hash } from "./rockKit";
import type { Halo, LandmarkSpec } from "./types";

const BAMBOO = rgb("#c9a24a");
const BAMBOO_DARK = rgb("#7a5a22");
const THATCH = rgb("#b89046");
const THATCH_DARK = rgb("#6d4f22");
const STONE = rgb("#8d8a80");
const TEAL = rgb("#1aa6a0");
const CORAL = rgb("#e8553a");
const FLAME: Rgb = [2.2, 1.1, 0.25];
const LANTERN: Rgb = [2.4, 1.5, 0.5];

const tikiArch: LandmarkSpec = {
  span: true,
  defaultSpan: 10,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const hw = Math.max(12.5, ctx.halfWidth + 8);
    const half = ctx.span / 2;
    const postH = 8.8;
    for (const s of [-1, 1]) {
      const x = s * hw;
      // The foot: two courses of stone and a skirt of leaves.
      lit.box(x, 0.45, 0, 3.3, 1.5, 3.3, ramp(scaleRgb(STONE, 0.7), STONE));
      lit.box(x, 1.5, 0, 2.7, 0.6, 2.7, scaleRgb(STONE, 1.1));
      // The post: a bamboo trunk, banded, with a chevron of paint round it at three heights.
      lit.post(x, 1.7, 0, 1.05, postH - 1.7, ramp(BAMBOO_DARK, BAMBOO), 10, 0.88);
      for (let k = 0; k < 3; k++) {
        const y = 2.9 + k * 1.7;
        lit.post(x, y, 0, 1.2, 0.34, k % 2 ? CORAL : TEAL, 10);
        for (let n = 0; n < 8; n++) {
          const a = (n / 8) * Math.PI * 2 + k * 0.4;
          lit.box(x + Math.cos(a) * 1.07, y + 0.17, Math.sin(a) * 1.07, 0.36, 0.5, 0.18, k % 2 ? TEAL : CORAL, -a);
        }
      }
      // The crown: a cap of thatch over the top, with a spike of reed.
      lit.add(shapes.frustum(0.55, 10), xf(x, postH + 0.55, 0, 1.85, 1.3, 1.85), ramp(THATCH_DARK, THATCH));
      lit.add(shapes.cone(8), xf(x, postH + 1.9, 0, 0.5, 1.7, 0.5), ramp(THATCH_DARK, THATCH));
      // A torch at the foot, set a little toward the road: a bamboo pole, a bowl, a flame.
      const tx = x - s * 2.4;
      lit.post(tx, 0, 0, 0.16, 3.0, ramp(BAMBOO_DARK, BAMBOO), 6);
      lit.post(tx, 3.0, 0, 0.42, 0.3, BAMBOO_DARK, 8, 0.7);
      glow.add(shapes.cone(5), xf(tx, 3.75, 0, 0.32, 1.1, 0.32), FLAME);
      glow.blob(tx, 3.5, 0, 0.3, 0.3, 0.3, [2.8, 1.6, 0.5], 0);
    }
    // The lintel: a heavy bamboo log across the top, a second, thinner one under it, lashed to the posts, thatch fringe hanging.
    const beamY = postH - 0.4;
    lit.add(shapes.cylinder(10), xf(0, beamY, 0, 0.55, hw * 2 + 3.6, 0.55, 0, 0, Math.PI / 2), ramp(BAMBOO_DARK, BAMBOO));
    lit.add(shapes.cylinder(8), xf(0, beamY - 1.2, 0, 0.3, hw * 2 + 1.2, 0.3, 0, 0, Math.PI / 2), ramp(BAMBOO_DARK, BAMBOO));
    for (const s of [-1, 1]) for (const dy of [0, -1.2]) lit.post(s * hw, beamY + dy - 0.35, 0, 1.2, 0.2, THATCH_DARK, 8);
    const fringeN = Math.round(hw * 2 / 1.1);
    for (let i = 0; i < fringeN; i++) {
      const x = -hw + 1 + (i / (fringeN - 1)) * (hw * 2 - 2);
      const len = 0.9 + hash(i, 1, 5) * 0.7;
      lit.add(shapes.cone(4), xf(x, beamY - 0.5 - len / 2, (i % 2 ? 1 : -1) * 0.25, 0.28, len, 0.28, 0, Math.PI), ramp(THATCH, THATCH_DARK));
    }
    // A pennant of teal and coral from the middle and two lanterns that glow, hung on cords.
    lit.box(0, beamY - 1.9, 0, 0.12, 1.4, 0.9, mixRgb(TEAL, CORAL, 0.5));
    lit.box(0.55, beamY - 1.6, 0, 0.9, 0.7, 0.12, TEAL);
    lit.box(-0.55, beamY - 1.6, 0, 0.9, 0.7, 0.12, CORAL);
    const halos: Halo[] = [];
    for (const s of [-1, 1]) {
      const lx = s * (hw * 0.5);
      lit.box(lx, beamY - 0.9, 0, 0.05, 0.9, 0.05, BAMBOO_DARK);
      glow.blob(lx, beamY - 1.8, 0, 0.5, 0.62, 0.5, LANTERN, 1);
      halos.push({ x: lx, y: beamY - 1.8, z: 0, size: 8, colour: [2.4, 1.3, 0.4], alpha: 0.45, twinkle: 0.2 });
      halos.push({ x: s * (hw - 2.4), y: 3.8, z: 0, size: 6, colour: [2.4, 1.2, 0.35], alpha: 0.5, twinkle: 0.3 });
    }
    // Torches along the sides, either way from the gate, as far as the span runs (a mouth to the trail).
    for (const s of [-1, 1]) {
      for (let z = -half + 2; z <= half - 1; z += 5) {
        if (Math.abs(z) < 3) continue;
        const x = s * (hw - 0.2);
        lit.post(x, 0, z, 0.13, 2.2, ramp(BAMBOO_DARK, BAMBOO), 6);
        glow.add(shapes.cone(5), xf(x, 2.7, z, 0.24, 0.8, 0.24), FLAME);
        halos.push({ x, y: 2.8, z, size: 4, colour: [2.4, 1.2, 0.35], alpha: 0.4, twinkle: 0.3 });
      }
    }
    return { lit, glow, halos };
  },
};

export const LANDMARKS: Record<string, LandmarkSpec> = { "tiki-arch": tikiArch };
export const HAZARDS = {};
