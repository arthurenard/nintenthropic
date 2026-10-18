/**
 * What the cold makes by itself: the ice arch and the ice cave, spans of glassy
 * ice the road runs under, hung with icicles kept clear of the chase camera;
 * and a stand of pines bowed under snow.
 */
import { byHeight, MeshBuilder, mixRgb, ramp, rgb, scaleRgb, shapes, xf, type Rgb, type Shade, type V3 } from "../kit";
import { beam, ceilingAt, drift, hash, icicle, noisyArch, ribbon } from "../rockKit";
import type { Halo, LandmarkSpec } from "../types";
import { ICE_GLOW, SNOW, SNOW_MID, snowShade } from "./common";

// ─── Ice arch and ice cave ───────────────────────────────────────────────────

const ICE_LO = rgb("#9bd8fa");
const ICE_HI = rgb("#e6f7ff");
const ICE_FROST: Rgb = [1.5, 1.45, 1.35];
const ICE_GLASS = rgb("#8fd0ff");

/** A facet-by-facet shade for ice: blue at the foot, pale at the top, each vertex nudged so facets glint. */
const iceShade = (top: number, seed: number, lo: Rgb = ICE_LO, hi: Rgb = ICE_HI): Shade => (p, i, j) => scaleRgb(mixRgb(lo, hi, Math.max(0, Math.min(1, p[1] / top))), 0.88 + 0.28 * hash(i, j, seed));

/** Glowing strips that hug the inside of a tunnel along its length, in dashes. */
function glowAlong(g: MeshBuilder, hw: number, top: number, legs: number, z0: number, z1: number, angles: number[], col: Rgb, dash = 6, gap = 2): void {
  for (const a of angles) {
    const x = Math.cos(a) * (hw - 0.3);
    const y = legs + Math.sin(a) * (top - legs) - 0.3;
    const inward: V3 = [-Math.cos(a), -Math.sin(a), 0];
    for (let z = z0; z + dash <= z1 + 0.01; z += dash + gap) {
      ribbon(g, [[x, y, z], [x, y, z + dash]], 0.28, inward, col);
    }
  }
}

export const iceArch: LandmarkSpec = {
  span: true,
  defaultSpan: 30,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const hw = Math.max(13, ctx.halfWidth + 6);
    const top = 13.8;
    const legs = 6.2;
    const half = ctx.span / 2;
    // The band is thickest over the crown and tucks in at the ends, leaning a little to one side: a natural bridge of ice.
    const thick = (t: number, zt: number) => (3.2 + 2.9 * Math.sin(Math.PI * t)) * (0.5 + 0.5 * Math.pow(Math.sin(Math.PI * zt), 0.55)) * (0.88 + 0.26 * t);
    const base = { halfIn: hw, topIn: top, legs, thick, z0: -half, z1: half, steps: Math.max(4, Math.round(ctx.span / 4)), arcSteps: 14, rough: 0.55, seed: 4, skirt: 3 };
    noisyArch(lit, { ...base, inner: iceShade(top, 1), outer: iceShade(top + 6, 2, ICE_LO, ICE_FROST) });
    noisyArch(glass, { ...base, grow: 0.3, shrink: 0.16, inner: ICE_GLASS, outer: ICE_GLASS });
    // Frosted ridges and crystals along the crown, and drifts at the feet.
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      const z = -half * 0.8 + t * half * 1.6;
      const x = (hash(k, 3) - 0.5) * 9;
      const yTop = top + 5.6 + 0.8 * Math.sin(t * Math.PI);
      lit.blob(x, yTop, z, 3.6, 1.5, 3.1, ramp(ICE_FROST, [1.6, 1.6, 1.7]), 1);
    }
    for (let k = 0; k < 7; k++) {
      const x = (k - 3) * 2.6 + (hash(k, 9) - 0.5) * 1.4;
      const z = (hash(k, 11) - 0.5) * half * 1.3;
      const h = 3 + hash(k, 5) * 3.2;
      const y = top + 5.8 - Math.abs(x) * 0.15;
      lit.add(shapes.cone(5), xf(x, y + h / 2, z, 0.9 + hash(k, 6) * 0.5, h, 0.9, k, 0.08 * (k - 3), 0.06 * (3 - k)), ramp(ICE_LO, [1.4, 1.5, 1.7]));
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) drift(lit, s * (hw + 4.2 + k * 0.6), -half * 0.6 + k * half * 0.6, 3.6, 1.8, 3.4, snowShade(0, 2.4), k + s * 7);
    }
    // Icicles hanging inside: short over the road, long beside it, always clear of the camera.
    for (let k = 0; k < 30; k++) {
      let x = (hash(k, 1) - 0.5) * 2 * (hw - 0.8);
      if (Math.abs(x) > 9.4 && Math.abs(x) < 11.4) x = (hash(k, 4) - 0.5) * 16;
      const ceil = ceilingAt(x, hw, top, legs);
      const cap = Math.abs(x) <= 11.4 ? Math.min(2.6, ceil - 9.6) : 3.2;
      if (cap < 0.5) continue;
      const len = Math.min(cap, 0.8 + hash(k, 2) * 2.4);
      icicle(glass, x, ceil + 0.2, -half * 0.9 + hash(k, 3) * half * 1.8, 0.2 + hash(k, 8) * 0.18, len, rgb("#9fdcff"), 5);
    }
    // The inner glow: three blue ribbons round the arch and a halo at the crown.
    for (const z of [-half * 0.45, 0, half * 0.45]) {
      const pts: V3[] = [];
      for (let k = 1; k < 16; k++) {
        const a = Math.PI - (k / 16) * Math.PI;
        pts.push([Math.cos(a) * (hw - 0.3), legs + Math.sin(a) * (top - legs) - 0.3, z]);
      }
      ribbon(glow, pts, 0.3, (i) => {
        const a = Math.PI - ((i + 1) / 16) * Math.PI;
        return [-Math.cos(a), -Math.sin(a), 0];
      }, ICE_GLOW);
    }
    const halos = [
      { x: 0, y: top - 1, z: 0, size: 24, colour: [0.35, 0.85, 1.5] as const, alpha: 0.5, twinkle: 0.12 },
      { x: -hw + 2, y: 6, z: 0, size: 13, colour: [0.35, 0.85, 1.5] as const, alpha: 0.35, twinkle: 0.1 },
      { x: hw - 2, y: 6, z: 0, size: 13, colour: [0.35, 0.85, 1.5] as const, alpha: 0.35, twinkle: 0.1 },
    ];
    return { lit, glow, glass, halos };
  },
};

export const iceCave: LandmarkSpec = {
  span: true,
  defaultSpan: 70,
  build(ctx) {
    const lit = new MeshBuilder();
    const glow = new MeshBuilder();
    const glass = new MeshBuilder();
    const hw = Math.max(13, ctx.halfWidth + 6);
    const top = 12.2;
    const legs = 6.4;
    const half = ctx.span / 2;
    const lip = 2.6;
    const thick = (t: number) => 3.4 + 2.6 * Math.sin(Math.PI * t);
    const body = { halfIn: hw, topIn: top, legs, thick, steps: Math.max(6, Math.round(ctx.span / 3)), arcSteps: 14, rough: 0.5, seed: 8, skirt: 3 };
    noisyArch(lit, { ...body, z0: -half + lip, z1: half - lip, inner: iceShade(top, 3, rgb("#7cc9f6"), rgb("#d6f2ff")), outer: iceShade(top + 6, 4, ICE_LO, ICE_FROST) });
    noisyArch(glass, { ...body, z0: -half + lip, z1: half - lip, grow: 0.32, shrink: 0.18, inner: ICE_GLASS, outer: ICE_GLASS });
    // Frosted entrance lips, fatter and whiter, wearing caps of snow.
    for (const s of [-1, 1]) {
      const z0 = s < 0 ? -half : half - lip - 0.01;
      noisyArch(lit, { ...body, thick: (t) => 5.2 + 3 * Math.sin(Math.PI * t), steps: 2, rough: 0.9, seed: 20 + s, z0, z1: z0 + lip + 0.01, inner: byHeight(0, top, [1.1, 1.15, 1.3], [1.5, 1.5, 1.6]), outer: byHeight(0, top + 8, [0.95, 1.0, 1.15], [1.6, 1.6, 1.7]) });
      const zc = s * (half - lip / 2);
      lit.blob(0, top + 8.1, zc, 11, 1.7, lip * 0.62 + 0.6, ramp(SNOW_MID, SNOW), 1);
      for (const sx of [-1, 1]) drift(lit, sx * (hw + 5.4), zc, 4.6, 2.4, 2.4, snowShade(0, 3), 40 + sx);
    }
    // Glow strips along the walls and roof, dashed, and a halo about every twelve metres.
    glowAlong(glow, hw, top, legs, -half + lip + 1, half - lip - 1, [0.1, 0.32, 0.5, 0.68, 0.9].map((f) => Math.PI * f), ICE_GLOW);
    const halos: Halo[] = [];
    let n = 0;
    for (let z = -half + 6; z <= half - 5; z += 12) {
      halos.push({ x: 0, y: top - 1.8, z, size: 20, colour: [0.35, 0.85, 1.5], alpha: 0.5, twinkle: 0.12 });
      const sd = n++ % 2 === 0 ? -1 : 1;
      halos.push({ x: sd * (hw - 2), y: 4.2, z: z + 6, size: 12, colour: [0.3, 0.8, 1.5], alpha: 0.35, twinkle: 0.1 });
    }
    // Stalactites from the roof: glassy blue cones, none low enough for the chase camera.
    for (let k = 0; k < 46; k++) {
      let x = (hash(k, 1) - 0.5) * 2 * (hw - 1);
      if (Math.abs(x) > 9.4 && Math.abs(x) < 11.5) x = (hash(k, 5) - 0.5) * 16;
      const ceil = ceilingAt(x, hw, top, legs);
      const cap = Math.abs(x) <= 11.5 ? Math.min(2.6, ceil - 9.6) : 3.4;
      if (cap < 0.5) continue;
      const len = Math.min(cap, 0.7 + hash(k, 2) * 2.6);
      const z = -half + lip + 1 + hash(k, 3) * (ctx.span - 2 * lip - 2);
      const r = 0.22 + hash(k, 8) * 0.22;
      icicle(k % 3 === 0 ? lit : glass, x, ceil + 0.25, z, r, len, k % 3 === 0 ? rgb("#a8e0ff") : rgb("#8fd6ff"), 5);
    }
    // A few frosted ridges on the walls.
    for (let k = 0; k < 8; k++) {
      const s = k % 2 === 0 ? -1 : 1;
      const z = -half + lip + 4 + (k / 7) * (ctx.span - 2 * lip - 8);
      lit.blob(s * (hw - 0.9), 1.6, z, 1.1, 1.7, 1.9, ramp([1.0, 1.1, 1.3], [1.5, 1.55, 1.7]), 1);
    }
    return { lit, glow, glass, halos };
  },
};

// ─── Pines under snow ────────────────────────────────────────────────────────

const PINE_DARK = rgb("#21504a");
const PINE_MID = rgb("#3a8060");

function pine(lit: MeshBuilder, cx: number, cz: number, h: number, seed: number): void {
  const trunkH = h * 0.22;
  lit.post(cx, -1.2, cz, h * 0.04 + 0.35, trunkH + 2.4, ramp(rgb("#3a2518"), rgb("#6b4429")), 7, 0.75);
  const tiers = h > 18 ? 6 : 5;
  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const y = trunkH * 0.75 + u * (h - trunkH * 0.75 - h * 0.2);
    const r = h * 0.27 * (1 - u * 0.8);
    const th = h * 0.21 * (1 - u * 0.25);
    const yaw = seed + i * 0.7;
    lit.add(shapes.cone(8), xf(cx, y + th / 2, cz, r, th, r, yaw), ramp(PINE_DARK, PINE_MID));
    // The snow lies thick on the upper surface and stops short of the tip of each bough.
    lit.add(shapes.cone(8), xf(cx, y + th * 0.6, cz, r * 0.97, th * 1.0, r * 0.97, yaw + 0.2), ramp(SNOW_MID, SNOW));
    // A drooping lump of snow on the lowest boughs.
    if (i < 2) lit.blob(cx + Math.cos(yaw) * r * 0.72, y + th * 0.18, cz + Math.sin(yaw) * r * 0.72, r * 0.2, r * 0.12, r * 0.2, ramp(SNOW_MID, SNOW), 0);
  }
  lit.add(shapes.cone(6), xf(cx, h - h * 0.07, cz, h * 0.035, h * 0.14, h * 0.035), ramp(SNOW_MID, SNOW));
}

export const pineSnow: LandmarkSpec = {
  footprint: 14,
  build(ctx) {
    const lit = new MeshBuilder();
    const heights = [22, 18.5, 20, 16.5, 19, 15.5, 17.5];
    const spots: [number, number][] = [[0, 0], [-9.5, 3.5], [8.5, 5.5], [-6.5, -8], [6.5, -8.5], [-15, -3], [14.5, -2.5]];
    const n = 5 + Math.floor(ctx.rnd() * 3);
    for (let k = 0; k < n; k++) {
      const [x, z] = spots[k]!;
      pine(lit, x, z, heights[k]! * (0.95 + ctx.rnd() * 0.1), k * 1.3);
      drift(lit, x + 1.2, z + 3, 2.4, 0.9, 1.9, snowShade(0, 1.2), k + 50);
    }
    // A fallen branch with a ridge of snow along it, and a drift spilling out towards the road.
    beam(lit, [-3.5, 0.5, 9], [3.5, 1.3, 11.5], 0.5, 0.5, [0, 1, 0], rgb("#4e3320"), rgb("#6b4429"));
    beam(lit, [-3.5, 0.9, 9], [3.5, 1.7, 11.5], 0.6, 0.35, [0, 1, 0], SNOW_MID, SNOW);
    for (const [dx, dy, dz] of [[2.4, 1.5, 12.4], [-1.2, 1.1, 9.0]] as const) beam(lit, [dx - 1.0, dy, dz - 0.8], [dx, dy + 0.5, dz], 0.22, 0.22, [0, 1, 0], rgb("#4e3320"));
    drift(lit, 0, 11, 7, 1.0, 3.2, snowShade(0, 1.4), 70);
    drift(lit, -17, 4, 3.2, 1.3, 2.8, snowShade(0, 1.6), 71);
    return { lit };
  },
};
