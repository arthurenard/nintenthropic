/**
 * What comes down off the kitchen shelf: the salt shaker in pressed glass, the
 * walnut pepper mill, a stack of cookbooks with a recipe card leaning on them,
 * and the cereal box with its smiling sun. Salt, peppercorns and hoops spill
 * round their feet.
 */
import type { Paint } from "../../builder";
import { byHeight, lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, torus, xf, type Rgb, type Shade } from "../kit";
import type { LandmarkSpec } from "../types";
import { chrome, GOLD, lift, STEEL_D, TAU, WALNUT, WHITE, WOOD_L } from "./common";

// ─── Salt shaker ─────────────────────────────────────────────────────────────

export const saltShaker: LandmarkSpec = {
  footprint: 12,
  build(ctx) {
    const lit = new MeshBuilder();
    const glass = new MeshBuilder();
    const salt: Rgb = [1.5, 1.7, 2.0];
    // The glass, faceted like pressed glass: alternate pale and paler panels.
    lathe(glass, [[0, 0.2], [6.1, 0.2], [6.9, 1.0], [7.6, 5], [7.7, 10], [7.2, 16], [6.5, 20], [6.1, 21.6], [0, 21.6]], {
      segments: 10,
      shade: (_p, _i, j) => (j % 2 === 0 ? [0.6, 0.85, 1.25] : [1.0, 1.15, 1.35]),
    });
    // The salt inside: a lit white core, its top a little uneven.
    lathe(lit, [[0, 0.5], [5.5, 0.5], [6.3, 1.3], [7.0, 5], [7.1, 10], [6.8, 14.2], [5.0, 15.2], [3.0, 14.7], [0, 15.6]], {
      segments: 10,
      shade: byHeight(0.5, 15.5, scaleRgb(salt, 0.8), salt),
    });
    // Crystals glittering in the top layer.
    for (let i = 0; i < 14; i++) {
      const a = ctx.rnd() * TAU;
      const r = ctx.rnd() * 5;
      lit.box(Math.cos(a) * r, 15.2 + ctx.rnd() * 0.5, Math.sin(a) * r, 0.7, 0.7, 0.7, [1.8, 2.0, 2.3], ctx.rnd() * 3, ctx.rnd(), 0);
    }
    // The chrome cap: a collar, a shoulder, a nearly flat top pierced with holes.
    const cap: [number, number][] = [[6.3, 20.9], [6.9, 21.2], [6.9, 22.6], [6.5, 23.6], [5.6, 24.6], [4.6, 25.2], [0, 25.45]];
    lathe(lit, cap, { segments: 10, shade: chrome(20.9, 25.5, 0.1), caps: "bottom" });
    lathe(lit, [[6.95, 21.6], [7.05, 21.6], [7.05, 22.0], [6.95, 22.0]], { segments: 10, shade: STEEL_D });
    const hole = rgb("#1d232b");
    lit.add(shapes.cylinder(6), xf(0, 25.5, 0, 0.55, 0.12, 0.55), hole);
    for (let i = 0; i < 6; i++) lit.add(shapes.cylinder(6), xf(Math.cos((i / 6) * TAU) * 2.0, 25.45, Math.sin((i / 6) * TAU) * 2.0, 0.55, 0.12, 0.55), hole);
    for (let i = 0; i < 11; i++) lit.add(shapes.cylinder(6), xf(Math.cos((i / 11) * TAU + 0.2) * 3.7, 25.35, Math.sin((i / 11) * TAU + 0.2) * 3.7, 0.55, 0.12, 0.55), hole);
    // A bright spill at the foot, spread toward the road.
    lit.blob(3.5, 0.2, 9.6, 4.6, 0.9, 3.2, ramp(scaleRgb(salt, 0.8), salt), 0);
    for (let i = 0; i < 30; i++) {
      const a = Math.PI * (0.05 + ctx.rnd() * 0.9);
      const r = 8.5 + ctx.rnd() * 7;
      const s = 0.45 + ctx.rnd() * 0.4;
      lit.box(Math.cos(a) * r, s * 0.45, Math.sin(a) * r, s, s, s, [1.6, 1.8, 2.1], ctx.rnd() * 3, ctx.rnd() * 0.5, ctx.rnd() * 0.5);
    }
    return { lit, glass };
  },
};

// ─── Pepper mill ─────────────────────────────────────────────────────────────

export const pepperMill: LandmarkSpec = {
  footprint: 12,
  build(ctx) {
    const lit = new MeshBuilder();
    const peppercorn = lift("#3a2c26", 1.6);
    // The steel grinder at the foot.
    lathe(lit, [[0, -0.5], [5.4, -0.5], [5.7, 0.6], [5.7, 2.2], [6.3, 2.7]], { segments: 12, shade: chrome(-8, 14, 0.08), caps: "bottom" });
    // The turned walnut body: foot, belly, long waist, shoulder.
    const wood: Shade = (p, _i, j) => {
      const t = Math.max(0, Math.min(1, (p[1] - 2) / 33));
      return scaleRgb(mixRgb(scaleRgb(WALNUT, 0.7), WOOD_L, Math.pow(t, 0.8)), 1 + (j % 3 === 0 ? 0.06 : j % 3 === 1 ? -0.05 : 0));
    };
    lathe(lit, [[6.4, 2.6], [7.2, 4], [7.9, 7], [8.0, 10], [7.4, 14], [6.2, 18], [5.2, 22], [4.7, 25], [4.6, 27], [4.9, 27.4]], { segments: 12, shade: wood });
    // Two dark turned rings on the belly.
    for (const y of [12.2, 13.0]) lathe(lit, [[7.62, y - 0.3], [7.72, y - 0.3], [7.72, y + 0.3], [7.62, y + 0.3]], { segments: 12, shade: scaleRgb(WALNUT, 0.55) });
    // A steel band, then the slimmer top section and a rounded shoulder.
    lathe(lit, [[4.9, 27], [5.1, 27], [5.1, 29], [4.9, 29]], { segments: 12, shade: chrome(12, 44, 0.08) });
    lathe(lit, [[4.6, 29], [4.4, 31], [4.2, 33], [3.8, 34.6], [3.0, 35.6], [1.4, 36.1], [0, 36.2]], { segments: 12, shade: wood });
    // The knob.
    lit.post(0, 36, 0, 1.0, 1.6, scaleRgb(WALNUT, 0.7), 8);
    lit.blob(0, 38.5, 0, 2.6, 2.2, 2.6, ramp(scaleRgb(WALNUT, 0.85), WOOD_L), 1);
    lit.blob(0, 40.0, 0, 1.1, 0.35, 1.1, scaleRgb(WALNUT, 0.6), 0);
    // A second, slim steel ring under the shoulder.
    lathe(lit, [[4.55, 31.2], [4.75, 31.2], [4.75, 31.8], [4.55, 31.8]], { segments: 12, shade: chrome(12, 44, 0.08) });
    // Peppercorns that have escaped, and the dusting of ground pepper round them.
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * (0.02 + ctx.rnd() * 0.96);
      const r = 7 + ctx.rnd() * 9;
      const s = 0.45 + ctx.rnd() * 0.35;
      lit.blob(Math.cos(a) * r, s * 0.8, Math.sin(a) * r, s, s, s, ramp(scaleRgb(peppercorn, 0.8), peppercorn), 0);
    }
    for (let i = 0; i < 70; i++) {
      const a = ctx.rnd() * TAU;
      const r = 6 + ctx.rnd() * 10;
      const s = 0.3 + ctx.rnd() * 0.3;
      lit.blob(Math.cos(a) * r, 0.1, Math.sin(a) * r, s, 0.18, s, scaleRgb(peppercorn, 0.9), 0, a);
    }
    lit.blob(2.0, 0.1, 9.2, 4.2, 0.9, 2.8, ramp(scaleRgb(peppercorn, 0.7), scaleRgb(peppercorn, 1.1)), 0);
    return { lit };
  },
};

// ─── Cookbooks ───────────────────────────────────────────────────────────────

/**
 * A fat cookbook lying flat, spine toward +z: two covers, cream pages recessed on three sides, a spine with raised gold bands
 * and a title plate. Built in the book's own frame and turned by `yaw` about its centre.
 */
function book(b: MeshBuilder, cx: number, y0: number, cz: number, w: number, h: number, d: number, yaw: number, cover: Rgb, ribbon: Rgb): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const put = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, paint: Paint) =>
    b.add(shapes.box(), xf(cx + lx * c + lz * s, y0 + ly, cz - lx * s + lz * c, sx, sy, sz, yaw), paint);
  const dark = scaleRgb(cover, 0.62);
  put(0, 0.35, 0, w, 0.7, d, ramp(dark, cover));
  put(0, h - 0.35, 0, w, 0.7, d, ramp(cover, mixRgb(cover, [1, 1, 1], 0.12)));
  put(0, h / 2, d / 2 - 0.4, w, h, 0.8, ramp(dark, cover));
  const pages: Rgb = lift("#f6efd8", 1.15);
  put(0, h / 2, -0.15, w - 0.9, h - 1.2, d - 1.3, ramp(scaleRgb(pages, 0.75), pages));
  for (let k = 1; k <= 3; k++) put(0, 0.7 + (k * (h - 1.4)) / 4, -0.15, w - 0.9 + 0.06, 0.16, d - 1.3 + 0.06, scaleRgb(pages, 0.8));
  // Spine: gold bands across it, and a title plate with a few dark lines of text.
  for (const x of [-w / 2 + 2.2, -w / 2 + 3.4, w / 2 - 3.4, w / 2 - 2.2]) put(x, h / 2, d / 2 + 0.06, 0.7, h - 0.2, 0.18, GOLD);
  put(0, h / 2, d / 2 + 0.06, w * 0.4, h * 0.62, 0.18, lift("#fbf3da", 1.1));
  for (const k of [-1, 0, 1]) put(0, h / 2 + k * h * 0.16, d / 2 + 0.17, w * (k === 0 ? 0.3 : 0.24), 0.22, 0.12, ribbon);
}

export const cookbook: LandmarkSpec = {
  footprint: 18,
  build() {
    const lit = new MeshBuilder();
    const red = lift("#d6332f", 1.3);
    const teal = lift("#1f9a9a", 1.4);
    const sun = lift("#f5b82a", 1.25);
    book(lit, 0, -0.1, 0, 30, 6.4, 22, 0, red, WHITE);
    book(lit, -1.6, 6.25, -0.4, 26, 5.2, 19, 0.14, teal, WHITE);
    book(lit, 1.8, 11.4, 0.3, 21, 4.4, 15, -0.18, sun, lift("#8a2a1e", 1.3));
    // On the top cover: a plate with a red tomato, drawn in round blocks.
    const topY = 15.8;
    lit.add(shapes.cylinder(14), xf(1.8, topY + 0.1, 0.3, 5.2, 0.2, 5.2, 0), lift("#fbf3da", 1.1));
    lit.add(shapes.cylinder(14), xf(1.8, topY + 0.25, 0.3, 3.7, 0.18, 3.7, 0), lift("#4aa0e8", 1.2));
    lit.blob(1.8, topY + 1.3, 0.3, 2.2, 1.7, 2.2, ramp(lift("#a81f1f", 1.2), lift("#e83b30", 1.25)), 1);
    lit.blob(1.8, topY + 3.0, 0.3, 0.9, 0.3, 0.9, lift("#3f9a3a", 1.3), 0);
    // A recipe card leaning on the spine of the lowest book, red header and ruled lines, and a ribbon bookmark down the middle one.
    const card = lift("#fffaf0", 1.2);
    lit.box(-9.5, 3.4, 11.9, 8.4, 6.2, 0.3, ramp(scaleRgb(card, 0.8), card), 0, -0.2);
    lit.box(-9.5, 5.9, 12.1, 8.4, 1.3, 0.2, lift("#d6332f", 1.3), 0, -0.2);
    for (let k = 0; k < 4; k++) lit.box(-9.5, 4.4 - k * 0.9, 12.15 + k * 0.03, 6.4 - (k === 3 ? 2.4 : 0), 0.22, 0.12, lift("#4a5668", 1.2), 0, -0.2);
    lit.box(8.2, 8.6, 9.7, 1.0, 5.4, 0.2, lift("#e8482d", 1.3));
    lit.box(8.2, 11.32, 6.6, 1.0, 0.2, 6.4, lift("#e8482d", 1.3));
    lit.box(8.2, 5.7, 9.9, 1.0, 1.6, 0.2, lift("#e8482d", 1.3), 0, 0, 0.0);
    return { lit };
  },
};

// ─── Cereal box ──────────────────────────────────────────────────────────────

export const cerealBox: LandmarkSpec = {
  footprint: 16,
  build(ctx) {
    const lit = new MeshBuilder();
    const W = 24;
    const D = 10;
    const H = 45;
    const yellow = lift("#ffb62b", 1.2);
    const skyBlue = lift("#59bdf5", 1.3);
    const red = lift("#e5392f", 1.3);
    const cream = lift("#fff3d6", 1.2);
    const dark = lift("#35282a", 1.2);
    // The carton: yellow, darker toward the foot, with a lighter, slightly proud front panel.
    lit.box(0, H / 2 - 0.5, 0, W, H + 1, D, ramp(scaleRgb(yellow, 0.62), yellow));
    const f = D / 2;
    // The picture: a blue sky panel over green hills.
    lit.box(0, 29.5, f + 0.08, W - 2.4, 28, 0.2, ramp(mixRgb(skyBlue, WHITE, 0.45), skyBlue));
    lit.blob(-3.6, 16.2, f + 0.1, 7.6, 3.0, 0.5, lift("#5cc24a", 1.3), 1);
    lit.blob(5.2, 16.0, f + 0.12, 5.6, 2.2, 0.5, lift("#3fa64a", 1.3), 1);
    // A smiling sun with rays.
    const sx = -4.2;
    const sy = 35.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      lit.add(shapes.cone(4), xf(sx + Math.cos(a) * 6.8, sy + Math.sin(a) * 6.8, f + 0.45, 0.9, 1.7, 0.4, 0, 0, a - Math.PI / 2), lift("#ffd23f", 1.25));
    }
    lit.add(shapes.cylinder(16), xf(sx, sy, f + 0.55, 5.2, 0.8, 5.2, 0, Math.PI / 2), lift("#ffd23f", 1.25));
    for (const dx of [-1.8, 1.8]) {
      lit.blob(sx + dx, sy + 1.0, f + 1.05, 0.7, 1.0, 0.3, dark, 0);
      lit.blob(sx + dx * 1.2, sy - 1.2, f + 0.99, 0.8, 0.6, 0.2, lift("#ff8f70", 1.2), 0);
    }
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * (1.12 + (k / 6) * 0.76);
      lit.blob(sx + Math.cos(a) * 2.7, sy + 0.2 + Math.sin(a) * 2.2, f + 1.05, 0.4, 0.4, 0.28, dark, 0);
    }
    // Clouds.
    for (const [x, y, k] of [[6.4, 40.4, 1], [8.0, 33.5, 0.7]] as const) {
      lit.blob(x, y, f + 0.4, 3 * k, 1.2 * k, 0.4, WHITE, 1);
      lit.blob(x - 1.6 * k, y - 0.4 * k, f + 0.45, 2 * k, 1.0 * k, 0.4, WHITE, 1);
    }
    // The bowl of hoops and milk, centre front: a blue bowl, a white milk disc, golden rings piled up.
    lit.blob(0, 8.0, f + 1.2, 8.2, 5.4, 1.6, ramp(lift("#1f5fc0", 1.4), lift("#4a8fe8", 1.4)), 1);
    lit.add(shapes.cylinder(18), xf(0, 11.4, f + 1.5, 7.6, 1.0, 1.5, 0, 0, 0), WHITE);
    for (let i = 0; i < 9; i++) {
      const hx = -5.4 + i * 1.35 + (i % 2) * 0.2;
      const hy = 12.2 + Math.sin(i * 1.9) * 0.7 + (i % 3) * 0.5;
      torus(lit, 1.0, 0.4, { at: [hx, hy, f + 2.3 + (i % 2) * 0.2], facing: "z", ringSegments: 8, tubeSegments: 5, shade: i % 3 === 0 ? lift("#e8a23a", 1.2) : lift("#f2c25a", 1.2) });
    }
    // The name on a red banner, spelled in cream blocks of different heights.
    lit.box(0, 22.2, f + 0.45, W - 3, 5, 0.9, ramp(scaleRgb(red, 0.8), red), 0, 0, 0.0);
    for (let i = 0; i < 6; i++) {
      const w = 2.2;
      const h = 2.2 + (i % 3 === 1 ? 0.8 : 0);
      lit.box(-8.6 + i * 3.4, 22.2, f + 1.0, w, h, 0.5, cream);
      lit.box(-8.6 + i * 3.4, 22.2 + (i % 2 ? 0.4 : -0.4), f + 1.3, w * 0.4, h * 0.4, 0.2, red);
    }
    // Stripes at the foot.
    for (let i = 0; i < 4; i++) lit.box(0, 1.9 + i * 1.3, f + 0.1, W - 0.2, 0.65, 0.16, i % 2 ? cream : red);
    // The side panel, with its nutrition table.
    for (const sgn of [-1, 1]) {
      lit.box(sgn * (W / 2 + 0.06), 24, 0, 0.14, 30, D - 1.6, ramp(scaleRgb(yellow, 0.75), mixRgb(yellow, [1, 0.8, 0.4], 0.2)));
      lit.box(sgn * (W / 2 + 0.2), 24, 0, 0.14, 21, 5.8, cream);
      for (let k = 0; k < 8; k++) lit.box(sgn * (W / 2 + 0.3), 31 - k * 2.3, 0, 0.1, 0.4, 4.2 - (k % 3) * 0.8, dark);
    }
    // The top: a dark opening with a golden mound of hoops inside, and a cut flap hinged at the back, standing open.
    lit.box(0, H + 0.01, 0, W - 2, 0.12, D - 2, rgb("#1d1612"));
    lit.blob(0, H, 0, 8.5, 1.2, 3, ramp(lift("#c98a2a", 1.2), lift("#f2c25a", 1.2)), 1);
    lit.box(0, H + 3.0, -f + 1.0, W - 2.2, 6.4, 0.5, ramp(yellow, cream), 0, -0.25);
    lit.box(0, H + 0.6, f - 0.5, W - 2.2, 1.2, 0.5, ramp(scaleRgb(yellow, 0.9), yellow), 0, 0.18);
    // Spilled hoops at the foot: flat ones in the fore, a couple leaning.
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * (0.1 + ctx.rnd() * 0.8);
      const r = 14 + ctx.rnd() * 9;
      const col = i % 3 === 0 ? lift("#e8a23a", 1.2) : i % 3 === 1 ? lift("#f2c25a", 1.2) : lift("#d9822a", 1.2);
      torus(lit, 0.95, 0.38, { at: [Math.cos(a) * r, 0.4, Math.sin(a) * r + 2], facing: "y", ringSegments: 8, tubeSegments: 5, shade: col });
    }
    for (const [x, z] of [[-5, 17], [4, 20]] as const) torus(lit, 0.95, 0.38, { at: [x, 1.2, z], facing: "z", ringSegments: 8, tubeSegments: 5, shade: lift("#f2c25a", 1.2) });
    return { lit };
  },
};
