/**
 * The kitchen's appliances: the chrome toaster with two slices up and its
 * elements glowing, and the double sink with an arching tap, a heap of foam, a
 * bar of soap bobbing on the water and bubbles that rise and fade.
 */
import { byHeight, extrudeZ, lathe, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, torus, tube, xf, type Rgb, type Shade, type V3 } from "../kit";
import type { LandmarkSpec, MovingPart } from "../types";
import { bezier, BLUE, CHINA, chrome, lift, STEEL, STEEL_D, STEEL_L, TAU } from "./common";

// ─── Toaster ─────────────────────────────────────────────────────────────────

/** A convex polygon in the x-y plane, thickened along z from z0 to z1 and capped at both ends. */
function slab(b: MeshBuilder, poly: readonly (readonly [number, number])[], z0: number, z1: number, shade: Shade): void {
  extrudeZ(b, poly, z0, z1, 1, shade, { closed: true });
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  for (const z of [z0, z1]) {
    const c: V3 = [cx, cy, z];
    const sc = typeof shade === "function" ? shade(c, 0, 0) : shade;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]!;
      const q = poly[(k + 1) % poly.length]!;
      const pa: V3 = [p[0], p[1], z];
      const qa: V3 = [q[0], q[1], z];
      const col = (v: V3): Rgb => (typeof shade === "function" ? shade(v, 0, k) : shade);
      b.tri(c, pa, qa, sc, col(pa), col(qa));
    }
  }
}

/** A rounded rectangle (or a rectangle with only some corners rounded) as a polygon, corners counter-clockwise. */
function roundRect(w: number, h: number, rTop: number, rBottom: number, y0 = 0, steps = 4): [number, number][] {
  const out: [number, number][] = [];
  const corner = (cx: number, cy: number, r: number, a0: number) => {
    if (r <= 0.001) out.push([cx, cy]);
    else for (let k = 0; k <= steps; k++) out.push([cx + Math.cos(a0 + (k / steps) * (Math.PI / 2)) * r, cy + Math.sin(a0 + (k / steps) * (Math.PI / 2)) * r]);
  };
  corner(w / 2 - rBottom, y0 + rBottom, rBottom, -Math.PI / 2);
  corner(w / 2 - rTop, y0 + h - rTop, rTop, 0);
  corner(-w / 2 + rTop, y0 + h - rTop, rTop, Math.PI / 2);
  corner(-w / 2 + rBottom, y0 + rBottom, rBottom, Math.PI);
  return out;
}

/** One slice of toast standing in a slot: crust, then two golden faces, both sides. */
function toast(b: MeshBuilder, x: number, z: number, y: number, w: number, h: number, t: number): void {
  const crust = rgb("#a85c25");
  const gold = lift("#e0a24b", 1.2);
  const crumb = lift("#f4cb7c", 1.2);
  const r = w * 0.27;
  const lobe = (inset: number, depth: number, col: Rgb, lift: number) => {
    const rr = r - inset;
    for (const s of [-1, 1]) b.add(shapes.cylinder(10), xf(x + s * w * 0.225, y + h - r, z, rr, depth, rr, 0, Math.PI / 2), ramp(scaleRgb(col, 0.9), col));
    b.box(x, y + (h - r) / 2 + 0.4 + lift, z, w - inset * 2 - 0.1, h - r - 0.9, depth, ramp(scaleRgb(col, 0.8), col));
  };
  lobe(0, t, crust, 0);
  lobe(0.8, t + 0.08, gold, 0);
  lobe(1.8, t + 0.14, crumb, 0);
  // Three pale air pockets in the crumb.
  for (const [dx, dy] of [[-1.6, 0.4], [2.0, 1.6], [0.4, 3.3]] as const) b.blob(x + dx, y + h * 0.5 + dy, z, 0.35, 0.3, t / 2 + 0.2, scaleRgb(gold, 0.95), 0);
}

export const toaster: LandmarkSpec = {
  footprint: 16,
  build() {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const bakelite = rgb("#26211f");
    const bakeliteL = rgb("#4b413a");
    const W = 26;
    const D = 16;
    // Four little feet, then a dark plinth.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lit.post(sx * 10.6, -1, sz * 5.8, 1.5, 2.6, ramp(bakelite, bakeliteL), 8, 0.8);
    lit.box(0, 2.1, 0, W - 1.2, 1.2, D - 1.2, ramp(bakelite, bakeliteL));
    // The chrome shell, with a rounded top.
    const shell = roundRect(W, 11, 3.6, 1.2, 2.7);
    // Chrome mirrors its room: pale sky above, a dark band at the horizon, warm counter below, and a bright stripe of the window.
    const shellShade: Shade = (p, _i, j) => {
      const t = Math.max(0, Math.min(1, (p[1] - 2.7) / 11));
      const sky: Rgb = [1.2, 1.5, 2.0];
      const horizon: Rgb = [0.38, 0.48, 0.68];
      const ground: Rgb = [1.0, 0.98, 1.0];
      const c = t > 0.55 ? mixRgb(horizon, sky, (t - 0.55) / 0.45) : mixRgb(ground, horizon, t / 0.55);
      const band = 0.9 + 0.12 * Math.sin(p[0] * 0.42 + 1.0) + (Math.abs(p[0] + 7.5) < 1.6 ? 0.3 : 0);
      return scaleRgb(c, band * (1 + (j % 2 ? 0.02 : -0.02)));
    };
    slab(lit, shell, -D / 2 + 0.6, D / 2 - 0.6, shellShade);
    // Rounded ends: the chrome swells a little at the front and back by a second, slimmer shell.
    slab(lit, roundRect(W - 3, 9.6, 3.2, 1, 3.3), -D / 2, D / 2, shellShade);
    // A retro red stripe and a thin chrome cornice.
    lit.box(0, 5.2, D / 2 - 0.5, W - 1.2, 0.7, 0.34, rgb("#e0412e"));
    lit.box(0, 4.2, D / 2 - 0.5, W - 1.2, 0.3, 0.34, rgb("#fff4dc"));
    // The top plate and its two slots.
    lit.box(0, 13.6, 0, W - 4.2, 0.7, D - 3, ramp(bakelite, bakeliteL));
    for (const zc of [3.7, -3.7]) {
      lit.box(0, 13.95, zc, 16, 0.12, 2.8, rgb("#0f0c0b"));
      // The elements glow warm in the gaps either side of the bread.
      for (const s of [-1, 1]) glow.box(0, 14.04, zc + s * 1.1, 15.6, 0.06, 0.45, [3.0, 1.35, 0.4]);
    }
    // Toast: the front slice stands a little lower than the back one.
    toast(lit, -0.2, 3.7, 13.4, 14.2, 11.5, 1.6);
    toast(lit, 0.4, -3.7, 13.4, 14.2, 13.6, 1.6);
    // The lever on the front, in its track.
    lit.box(-9.6, 8.0, D / 2 - 0.4, 1.0, 6.5, 0.16, rgb("#15110f"));
    lit.box(-9.6, 9.6, D / 2 + 0.5, 3.0, 1.5, 1.7, ramp(bakelite, bakeliteL));
    lit.box(-9.6, 9.6, D / 2 + 1.0, 2.4, 0.5, 1.0, rgb("#5d4f46"));
    // The browning dial with its tick marks.
    lit.add(shapes.cylinder(14), xf(8.6, 8.4, D / 2 + 0.4, 2.7, 1.5, 2.7, 0, Math.PI / 2), ramp(bakelite, bakeliteL));
    lit.add(shapes.cylinder(14), xf(8.6, 8.4, D / 2 + 1.25, 2.0, 0.3, 2.0, 0, Math.PI / 2), rgb("#6a5b50"));
    lit.box(8.6 + 0.6, 8.4 + 1.1, D / 2 + 1.5, 0.45, 1.6, 0.25, rgb("#fff4dc"), 0, 0, -0.45);
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.8 + (i / 8) * Math.PI * 1.6 + Math.PI / 2;
      lit.blob(8.6 + Math.cos(a) * 3.9, 8.4 + Math.sin(a) * 3.9, D / 2 - 0.2, 0.28, 0.28, 0.18, i < 5 ? rgb("#2a2420") : rgb("#e0412e"), 0);
    }
    // The cord, a thick black loop on the counter behind.
    const cord: V3[] = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      cord.push([13 + t * 12, 0.5 + Math.sin(t * 6) * 0.15, -3 - Math.sin(t * Math.PI) * 6 - t * 8]);
    }
    tube(lit, [[12, 3.5, -3], ...cord], { radius: 0.65, sides: 5, shade: rgb("#2a2626") });
    lit.box(25.4, 0.7, -17.5, 2.2, 1.4, 3.0, rgb("#2a2626"));
    const halos = [
      { x: 0, y: 15, z: 3.7, size: 15, colour: [2.6, 1.3, 0.5] as const, alpha: 0.25, twinkle: 0.12 },
      { x: 0, y: 15, z: -3.7, size: 15, colour: [2.6, 1.3, 0.5] as const, alpha: 0.25, twinkle: 0.12 },
    ];
    return { lit, glow, halos };
  },
};

// ─── Sink ────────────────────────────────────────────────────────────────────

export const sink: LandmarkSpec = {
  footprint: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const deckY = 5.2;
    const waterY = 2.8;
    const deck = ramp(scaleRgb(STEEL, 0.95), STEEL_L);
    // The stainless cabinet under the worktop, with two panelled doors and handles.
    lit.box(0, (deckY - 1.5) / 2 - 0.2, 0, 49, deckY + 1.5 - 0.4, 39, ramp(STEEL_D, scaleRgb(STEEL, 0.85)));
    for (const x of [-12.5, 12.5]) {
      lit.box(x, 2.3, 19.6, 22, 4.6, 0.4, ramp(scaleRgb(STEEL_D, 1.1), scaleRgb(STEEL, 0.95)));
      lit.box(x, 2.4, 19.9, 19.4, 3.2, 0.2, ramp(STEEL_D, scaleRgb(STEEL, 0.78)));
      lit.box(x + (x > 0 ? -8.5 : 8.5), 3.4, 20.25, 0.5, 2.2, 0.45, STEEL_L);
    }
    // The worktop: slabs round the two basins and the drainer, with a bright bead along the front and a back splash.
    const slab2 = (x0: number, x1: number, z0: number, z1: number) => lit.box((x0 + x1) / 2, deckY - 0.5, (z0 + z1) / 2, x1 - x0, 1.0, z1 - z0, deck);
    slab2(-25, 25, 14, 20);
    slab2(-25, 25, -20, -12);
    slab2(-25, -24, -12, 14);
    slab2(-8, -6, -12, 14);
    slab2(8, 10, -12, 14);
    slab2(10, 25, -12, 14);
    lit.box(0, deckY + 2.4, -19.4, 50, 4.8, 1.4, ramp(scaleRgb(STEEL, 0.9), STEEL_L));
    lit.box(0, deckY + 0.1, 20.1, 50, 0.7, 0.9, STEEL_L);
    lit.box(0, deckY + 0.1, 14.2, 50, 0.4, 0.5, STEEL_L);
    for (const [x0, x1] of [[-24, -8], [-6, 8]] as const) {
      const w = x1 - x0;
      const cx = (x0 + x1) / 2;
      const wallH = deckY - 0.3;
      // Basin walls down to the floor, a dark plughole, and the water's glass skin.
      for (const z of [-12, 14]) lit.box(cx, wallH / 2 + 0.3, z, w, wallH, 0.5, ramp(STEEL_D, STEEL));
      for (const x of [x0, x1]) lit.box(x, wallH / 2 + 0.3, 1, 0.5, wallH, 26, ramp(STEEL_D, STEEL));
      lit.box(cx, 0.2, 1, w, 0.4, 26, ramp(rgb("#37424f"), STEEL_D));
      lit.add(shapes.cylinder(10), xf(cx, 0.45, -1, 1.4, 0.2, 1.4), rgb("#161b22"));
      glass.box(cx, waterY, 1, w - 0.3, 0.12, 25.6, [0.55, 1.0, 1.35]);
    }
    // Ripples on the water, bright: rings round the tap's drip and a sheen across the other basin.
    for (const r of [2.0, 3.6, 5.2]) torus(glow, r, 0.14, { at: [-14, waterY + 0.1, -2], facing: "y", ringSegments: 18, tubeSegments: 3, shade: [1.1 + 0.4 * (r / 5), 1.9, 2.5] });
    glow.blob(1, waterY + 0.1, 4, 4.5, 0.05, 2.2, [1.0, 1.7, 2.3], 0);
    glow.blob(-16, waterY + 0.1, 8, 3.2, 0.05, 1.4, [1.0, 1.7, 2.3], 0);
    // A sponge on the divider.
    lit.box(-7, deckY + 0.6, 6, 3.4, 1.3, 5.2, ramp(lift("#d9a81c", 1.2), lift("#ffd23a", 1.25)));
    lit.box(-7, deckY + 1.3, 6, 3.4, 0.4, 5.2, lift("#2f9a4a", 1.3));
    // The drainer: ribs along it, two cups with handles, a rack with a pair of plates on edge.
    for (let x = 11.5; x < 24.5; x += 1.9) lit.box(x, deckY + 0.3, 1, 0.9, 0.5, 25, STEEL_L);
    for (const [x, z] of [[13.2, -7], [18.5, -3]] as const) {
      lathe(lit, [[0, 0], [1.9, 0], [2.0, 1.2], [2.9, 4.6], [2.5, 4.7], [1.9, 1.5], [0, 1.4]], {
        at: [x, deckY + 0.5, z],
        segments: 12,
        shade: byHeight(deckY, deckY + 5.2, scaleRgb(CHINA, 0.8), CHINA),
      });
      lathe(lit, [[2.55, 3.0], [2.75, 3.0], [2.95, 4.5], [2.75, 4.6]], { at: [x, deckY + 0.5, z], segments: 12, shade: BLUE });
      tube(lit, bezier([x + 2.7, deckY + 4.0, z], [x + 5.4, deckY + 4.4, z], [x + 5.4, deckY + 1.4, z], [x + 2.2, deckY + 1.6, z], 8), { radius: 0.5, sides: 5, shade: CHINA });
    }
    lit.box(19.5, deckY + 0.9, 7.0, 10, 0.5, 0.5, STEEL);
    lit.box(19.5, deckY + 0.9, 3.6, 10, 0.5, 0.5, STEEL);
    for (const x of [15.2, 23.8]) lit.box(x, deckY + 1.6, 5.3, 0.5, 1.8, 4.4, STEEL);
    for (const x of [17.6, 21.4]) {
      lit.add(shapes.cylinder(14), xf(x, deckY + 5.6, 5.3, 5.2, 0.6, 5.2, 0, 0, Math.PI / 2 - 0.12), ramp(CHINA, CHINA));
      lit.add(shapes.cylinder(14), xf(x + 0.33, deckY + 5.6, 5.3, 3.1, 0.4, 3.1, 0, 0, Math.PI / 2 - 0.12), BLUE);
    }
    // The tall arching tap with its lever and two taps, standing between the basins at the back.
    lit.post(-7, deckY, -14.4, 2.8, 1.4, ramp(STEEL, STEEL_L), 10, 0.85);
    const pipePath: V3[] = [[-7, deckY, -14.4], [-7, deckY + 5, -14.4], ...bezier([-7, deckY + 8, -14.4], [-7, deckY + 24, -14.4], [-14, deckY + 24, -6], [-14, deckY + 13.4, -2.6], 14)];
    tube(lit, pipePath, { radius: 1.45, sides: 8, shade: chrome(deckY, deckY + 21, 0.1) });
    lit.post(-14, deckY + 11.8, -2.6, 1.7, 1.8, ramp(STEEL, STEEL_L), 8, 0.8);
    lit.rod([-7, deckY + 7, -14.4], [-0.6, deckY + 11, -14.4], 0.8, ramp(STEEL, STEEL_L));
    lit.blob(0.2, deckY + 11.4, -14.4, 1.4, 1.4, 1.4, STEEL_L, 1);
    for (const [dx, col] of [[-4, rgb("#d6332f")], [4, rgb("#2f6fd6")]] as const) {
      lit.post(-7 + dx, deckY + 0.6, -14.4, 1.2, 1.6, ramp(STEEL, STEEL_L), 8, 0.8);
      lit.blob(-7 + dx, deckY + 2.6, -14.4, 1.3, 0.8, 1.3, col, 1);
    }
    glass.box(-14, deckY + 6.4, -2.6, 0.7, 11.2, 0.7, [0.7, 1.15, 1.5]);
    // Foam piled up over the near basin, a big white heap taller than the rim.
    const foam: Rgb = [1.3, 1.75, 2.7];
    for (let i = 0; i < 40; i++) {
      const a = ctx.rnd() * TAU;
      const r = ctx.rnd() * 7;
      const y = waterY + 0.6 + (1 - r / 7) * 6.5 + ctx.rnd() * 1.6;
      const s2 = 1.3 + ctx.rnd() * 1.8;
      lit.blob(-16 + Math.cos(a) * r * 1.1, y, 5 + Math.sin(a) * r * 1.5, s2, s2 * 0.9, s2, ramp(scaleRgb(foam, 0.72), foam), 1);
    }
    const moving: MovingPart[] = [];
    // A bar of soap and a raft of bubbles bobbing on the other basin.
    {
      const soap = new MeshBuilder();
      const bub = new MeshBuilder();
      const bar = lift("#ffd6ec", 1.2);
      soap.box(0.5, waterY + 0.5, 3, 5.0, 1.8, 3.2, ramp(scaleRgb(bar, 0.85), bar));
      soap.blob(0.5, waterY + 1.45, 3, 2.4, 0.3, 1.4, mixRgb(bar, [1, 1, 1], 0.4), 0);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const r = 0.8 + (i % 3) * 0.6;
        bub.blob(-2.5 + Math.cos(a) * (2.8 + i * 0.4), waterY + 0.5 + r * 0.4, 5 + Math.sin(a) * (3.4 + i * 0.5), r, r, r, [1.1, 1.3, 1.5], 1);
      }
      moving.push({
        lit: soap,
        glass: bub,
        pivot: [0, waterY, 3],
        update(t, part) {
          part.position.y = Math.sin(t * 1.7) * 0.22;
          part.rotation.y = Math.sin(t * 0.7) * 0.22;
        },
      });
    }
    // Bubbles rising from the foam: three that float up, swell and fade.
    for (let n = 0; n < 3; n++) {
      const g = new MeshBuilder();
      const x = -19 + n * 3.4;
      const z = 5 + (n - 1) * 3.5;
      for (let i = 0; i < 3; i++) g.blob(x + i * 1.1, 11 + i * 1.5, z + (i % 2) * 1.4, 1.0 + i * 0.3, 1.0 + i * 0.3, 1.0 + i * 0.3, [1.1, 1.35, 1.6], 1);
      moving.push({
        glass: g,
        pivot: [x, 11, z],
        update(t, part) {
          const u = (t * 0.1 + n * 0.33) % 1;
          part.position.y = u * 10 - 2;
          part.scale.setScalar(Math.max(0.01, Math.sin(Math.PI * u)));
        },
      });
    }
    const halos = [{ x: -14, y: 6, z: 2, size: 18, colour: [1.2, 1.8, 2.4] as const, alpha: 0.18, twinkle: 0.2 }];
    return { lit, glow, glass, moving, halos };
  },
};
