/**
 * The features a track adds to its road, drawn: ramps (a cookbook in the
 * kitchen, a ski-jump in the snow, rock in the canyon...), open edges (the
 * shelf and the long fall below it), gaps in the road, boost strips, the
 * patches that change how the road drives (ice, mud, sand, snow, grass), the
 * space ribbon's glowing edges and the fair's strings of bulbs.
 *
 * Everything that is solid is vertex coloured into the track's chunks; patches
 * and boost strips are their own geometries (they need their own materials).
 */
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { Surface } from "../../track/geometry";
import { clamp, lerp, smoothstep } from "../math";
import { MeshBuilder, mixRgb, rgb, scaleRgb, type Rgb, type V3 } from "./builder";
import { DROP_DEPTH, inMetres, rampHeight, RAMP_LENGTH, type RampShape } from "./features";
import { GROUND_SINK } from "./terrain";
import { hash1, type TrackBuild } from "./trackContext";

const UP: V3 = [0, 1, 0];
const SIDES = [-1, 1] as const;

// ─── Open edges ──────────────────────────────────────────────────────────────

/** Where the ground stops at an open edge: the metres of level ground beyond the road's edge, and what colour it is. */
function shelf(theme: string): { width: number; colour: Rgb } {
  switch (theme) {
    case "kitchen":
      return { width: 1.8, colour: rgb("#f4efe6") };
    case "snow":
      return { width: 1.0, colour: rgb("#f4f9ff") };
    case "volcano":
      return { width: 0.9, colour: rgb("#2b2730") };
    case "canyon":
      return { width: 0.9, colour: rgb("#e0b074") };
    case "harbour":
      return { width: 0.8, colour: rgb("#aab4cb") };
    case "funfair":
      return { width: 0.9, colour: rgb("#5d4482") };
    case "palm":
      return { width: 0.9, colour: rgb("#f1dba4") };
    case "space":
      return { width: 0.0, colour: rgb("#14335e") };
    default:
      return { width: 0.9, colour: rgb("#79d255") };
  }
}

const CANYON_STRATA = ["#d4673a", "#e08a4c", "#c4552f", "#eaa968", "#b84a2c", "#f0bf86", "#cf6a3d"].map(rgb);

/** The colour of a cliff face `down` metres below its top, of `total`, at sample `i` (so panels and strata line up along the road). */
function cliffColour(theme: string, down: number, total: number, i: number, s: number): Rgb {
  const t = clamp(down / Math.max(1, total));
  switch (theme) {
    case "kitchen": {
      if (down < 1.9) return mixRgb(rgb("#f4efe6"), rgb("#cbbfae"), smoothstep(0.2, 1.9, down));
      // Shaker cabinet doors, fourteen metres wide: a dark seam between, a recessed panel in each.
      const u = ((s / 14) % 1 + 1) % 1;
      let c = rgb("#f1e6d0");
      if (u < 0.035 || u > 0.965) c = rgb("#7d5f3c");
      else if (u > 0.14 && u < 0.86 && down > 5 && down < total - 4) c = rgb("#e1d0ad");
      const k = 0.45 + 0.55 * (1 - t);
      return scaleRgb(c, k);
    }
    case "snow": {
      const band = hash1(Math.floor(down / 2.3) * 3.1 + 5);
      const c = mixRgb(rgb("#e6f4ff"), rgb("#4f86d0"), clamp(t * 1.2 + band * 0.18));
      return mixRgb(c, rgb("#0d2250"), smoothstep(0.55, 1.0, t));
    }
    case "volcano": {
      const col = mixRgb(rgb("#1d1a22"), rgb("#34303a"), hash1(Math.floor(i / 2) * 1.7));
      // The lava's light climbs the foot of the wall.
      const heat = smoothstep(0.62, 1.0, t);
      return mixRgb(col, [3.0, 0.95, 0.2], heat);
    }
    case "canyon": {
      const c = CANYON_STRATA[Math.floor(down / 2.6 + hash1(Math.floor(i / 6)) * 2) % CANYON_STRATA.length]!;
      return scaleRgb(c, 0.55 + 0.45 * (1 - t));
    }
    case "harbour":
      return down < 0.35 ? rgb("#ffcf2e") : scaleRgb(rgb("#8f9bb4"), 0.5 + 0.5 * (1 - t));
    case "funfair":
      return scaleRgb(mixRgb(rgb("#6d4f9a"), rgb("#4a3570"), hash1(Math.floor(i / 3))), 0.5 + 0.5 * (1 - t));
    case "palm":
      return scaleRgb(mixRgb(rgb("#ecd39a"), rgb("#caa670"), hash1(Math.floor(down / 1.5) + 4)), 0.5 + 0.5 * (1 - t));
    default:
      return scaleRgb(mixRgb(rgb("#8a6a45"), rgb("#5b422a"), t), 1);
  }
}

/** The shelf beyond an open edge, the wall that falls from it, and the fittings on the wall. */
export function buildOpenEdges(b: TrackBuild): void {
  if (!b.features.anyDrop) return;
  const theme = b.style.id;
  if (theme === "space") return; // the ribbon's own edge glows (buildSpaceEdges)
  const sh = shelf(theme);
  const depth = DROP_DEPTH[theme];
  for (const side of SIDES) {
    for (let i = 0; i < b.n; i++) {
      const o0 = b.open(i, side);
      const o1 = b.open(i + 1, side);
      if (o0 < 0.02 && o1 < 0.02) continue;
      if (b.gap(i)) continue;
      const a = b.S(i);
      const c = b.S(i + 1);
      const bld = b.deco[b.chunkOf(i)]!;
      const e0 = side * (a.width / 2 - 0.05);
      const e1 = side * (c.width / 2 - 0.05);
      const s0 = side * (a.width / 2 + sh.width);
      const s1 = side * (c.width / 2 + sh.width);
      const shade = scaleRgb(sh.colour, 0.94);
      // The shelf: level with the road, the same stuff as the world's own edge.
      const q = [b.P(i, e0, -0.03), b.P(i, s0, -0.03), b.P(i + 1, s1, -0.03), b.P(i + 1, e1, -0.03)] as const;
      if (side > 0) bld.quad(q[0], q[1], q[2], q[3], sh.colour, shade, shade, sh.colour, UP);
      else bld.quad(q[1], q[0], q[3], q[2], shade, sh.colour, sh.colour, shade, UP);
      // The wall, in horizontal bands so the colour can change down it.
      const top0 = b.P(i, s0, -0.03);
      const top1 = b.P(i + 1, s1, -0.03);
      const total0 = lerp(GROUND_SINK, depth, o0);
      const total1 = lerp(GROUND_SINK, depth, o1);
      // A deep wall's first three stops are metres (the lip, the doors' top); the rest, and all of a shallow
      // wall's, are fractions of its height.
      const stops = depth > 20 ? [0, 1.9, 5, 0.3, 0.6, 1.0] : [0, 0.12, 0.45, 0.8, 1.0];
      const down = (k: number, total: number): number => {
        const stop = stops[k]!;
        if (depth > 20) return k < 3 ? Math.min(stop, total) : stop * total;
        return stop * total;
      };
      for (let k = 0; k < stops.length - 1; k++) {
        const d00 = down(k, total0);
        const d01 = down(k + 1, total0);
        const d10 = down(k, total1);
        const d11 = down(k + 1, total1);
        if (d01 - d00 < 0.01 && d11 - d10 < 0.01) continue;
        const c00 = cliffColour(theme, d00, total0, i, a.s);
        const c01 = cliffColour(theme, d01, total0, i, a.s);
        const c10 = cliffColour(theme, d10, total1, i + 1, c.s);
        const c11 = cliffColour(theme, d11, total1, i + 1, c.s);
        const A: V3 = [top0[0], top0[1] - d00, top0[2]];
        const B: V3 = [top0[0], top0[1] - d01, top0[2]];
        const C: V3 = [top1[0], top1[1] - d11, top1[2]];
        const D: V3 = [top1[0], top1[1] - d10, top1[2]];
        // Faces outward: away from the road.
        if (side > 0) bld.quad(B, A, D, C, c01, c00, c10, c11);
        else bld.quad(A, B, C, D, c00, c01, c11, c10);
      }
    }
  }
  // Fittings on the cabinet fronts: a chrome handle on each door.
  if (theme === "kitchen") {
    for (const side of SIDES) {
      for (let i = 0; i < b.n; i += 1) {
        const a = b.S(i);
        const o = b.open(i, side);
        if (o < 0.95 || b.gap(i)) continue;
        // Once per fourteen metres, at the door's middle.
        const u = ((a.s / 14) % 1 + 1) % 1;
        const prevU = ((((a.s - b.spacing) / 14) % 1) + 1) % 1;
        if (!(prevU < 0.5 && u >= 0.5)) continue;
        const bld = b.deco[b.chunkOf(i)]!;
        const p = b.P(i, side * (a.width / 2 + sh.width + 0.2), -0.03);
        const steel = rgb("#d6dbe4");
        const dx = a.tx;
        const dz = a.tz;
        bld.box(p[0], p[1] - 8, p[2], 0.35, 0.35, 5.0, steel, Math.atan2(dx, dz));
        bld.box(p[0], p[1] - 7.6, p[2], 0.4, 0.2, 1.0, scaleRgb(steel, 0.8), Math.atan2(dx, dz));
      }
    }
  }
}

/** The cut ends of the road where there is a gap to jump: a slab face down to the floor. */
export function buildGapEnds(b: TrackBuild): void {
  const theme = b.style.id;
  const depth = Math.min(DROP_DEPTH[theme], 40);
  for (let i = 0; i < b.n; i++) {
    const was = b.gap(i - 1);
    const is = b.gap(i);
    if (was === is) continue;
    const a = b.S(i);
    const bld = b.deco[b.chunkOf(i)]!;
    const hw = a.width / 2;
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const u0 = -hw + (k / steps) * hw * 2;
      const u1 = -hw + ((k + 1) / steps) * hw * 2;
      const top0 = b.P(i, u0);
      const top1 = b.P(i, u1);
      const rows = [0, 1.2, 4, depth];
      for (let r = 0; r < rows.length - 1; r++) {
        const c0 = cliffColour(theme, rows[r]!, depth, i + k, a.s);
        const c1 = cliffColour(theme, rows[r + 1]!, depth, i + k, a.s);
        const A: V3 = [top0[0], top0[1] - rows[r]! - 0.03, top0[2]];
        const B: V3 = [top0[0], top0[1] - rows[r + 1]!, top0[2]];
        const C: V3 = [top1[0], top1[1] - rows[r + 1]!, top1[2]];
        const D: V3 = [top1[0], top1[1] - rows[r]! - 0.03, top1[2]];
        // Both windings: the face is seen from whichever side the kart comes.
        bld.quad(A, B, C, D, c0, c1, c1, c0);
        bld.quad(B, A, D, C, c1, c0, c0, c1);
      }
    }
  }
}

// ─── Ramps ───────────────────────────────────────────────────────────────────

interface RampSkin {
  /** The surface: `s` 0 at the foot to 1 at the lip, `u` 0..1 across. */
  top: (s: number, u: number) => Rgb;
  /** A side wall at `fromTop` metres below the wedge's top there (height `h`), `ratio` of the full height. */
  side: (fromTop: number, h: number, ratio: number) => Rgb;
  /** The face at the lip, `u` across and `fromTop` metres down from its top. */
  back: (u: number, fromTop: number) => Rgb;
  /** Cut the side walls and the lip's face into bands this high (metres), for pages and planks. Default: one band. */
  band?: number;
  decorate?: (b: TrackBuild, r: RampShape, lipIndex: number) => void;
}

function rampSkin(theme: string): RampSkin {
  switch (theme) {
    case "kitchen": {
      // A fat cookbook, cover up: cloth edge, gold frame, a plate of cream on a red field; pages showing at the sides and at the lip.
      const cover = rgb("#b8392f");
      const cloth = rgb("#7e2a22");
      const gold = rgb("#f0c24f");
      const cream = rgb("#f6edd6");
      const page = rgb("#e3d4b0");
      return {
        top: (s, u) => {
          const edge = Math.min(u, 1 - u, 1 - s);
          if (edge < 0.055) return cloth;
          if (edge < 0.085) return gold;
          const d = Math.hypot((u - 0.5) * 1.0, (s - 0.5) * 0.62);
          if (d < 0.16) return cream;
          if (d < 0.2) return gold;
          if (d < 0.205) return cloth;
          return cover;
        },
        band: 0.13,
        side: (fromTop, _h, _ratio) => (fromTop < 0.1 ? cloth : Math.floor(fromTop / 0.13) % 2 === 0 ? cream : page),
        back: (u, fromTop) => (fromTop < 0.1 ? cloth : Math.floor(u * 70) % 2 === 0 ? cream : page),
      };
    }
    case "snow": {
      const snow = rgb("#f6faff");
      const blue = rgb("#7fb0e8");
      return {
        top: (_s, u) => (Math.abs(u - 0.3) < 0.018 || Math.abs(u - 0.7) < 0.018 ? blue : snow),
        side: () => rgb("#c9dcf4"),
        back: () => rgb("#9ab8e0"),
      };
    }
    case "volcano": {
      const rock = rgb("#2a2630");
      return {
        top: (s) => (s > 0.93 ? [3.6, 1.2, 0.22] : mixRgb(rock, rgb("#3c3744"), hash1(Math.floor(s * 40)))),
        side: (_f, _h, ratio) => mixRgb(rgb("#1c1a21"), rgb("#33303a"), clamp(ratio)),
        back: (u) => (hash1(Math.floor(u * 30)) > 0.8 ? [3.0, 0.9, 0.18] : rgb("#1c1a21")),
      };
    }
    case "canyon": {
      return {
        top: (s) => mixRgb(rgb("#d9784a"), rgb("#e69a5c"), hash1(Math.floor(s * 14))),
        side: (_f, _h, ratio) => CANYON_STRATA[Math.floor(ratio * 7) % CANYON_STRATA.length]!,
        back: (u) => CANYON_STRATA[Math.floor(u * 7) % CANYON_STRATA.length]!,
      };
    }
    case "harbour": {
      const yellow = rgb("#ffcf2e");
      const black = rgb("#1a1d27");
      return {
        top: (s) => (Math.floor(s * 14) % 2 === 0 ? yellow : black),
        side: () => rgb("#4a5370"),
        back: (u) => (Math.floor(u * 10) % 2 === 0 ? yellow : black),
      };
    }
    case "funfair": {
      const red = rgb("#ee3a52");
      const cream = rgb("#fff3dc");
      return {
        top: (s) => (Math.floor(s * 12) % 2 === 0 ? red : cream),
        side: (_f, _h, ratio) => (Math.floor(ratio * 6) % 2 === 0 ? red : cream),
        back: (u) => (Math.floor(u * 12) % 2 === 0 ? red : cream),
        decorate: (b, r, lipIndex) => {
          // Bulbs along both sides of the wedge.
          const steps = 6;
          for (let k = 0; k <= steps; k++) {
            for (const side of SIDES) {
              const idx = lipIndex - Math.round((k / steps) * RAMP_LENGTH);
              const a = b.S(idx);
              const p = b.P(idx, side * (a.width / 2 - 0.3));
              const h = rampHeight([r], a.s, b.track.length);
              b.glows.push({ x: p[0], y: p[1] + h + 0.5, z: p[2], size: 1.8, colour: k % 2 ? [1, 0.45, 0.6] : [1, 0.85, 0.4], alpha: 0.85 });
            }
          }
        },
      };
    }
    case "space": {
      return {
        top: (s, u) => (Math.min(u, 1 - u) < 0.03 || s > 0.94 ? [0.5, 2.8, 3.6] : mixRgb(rgb("#12406a"), rgb("#1f6aa8"), hash1(Math.floor(s * 20) + Math.floor(u * 8)))),
        side: () => [0.2, 1.1, 1.6],
        back: () => [0.4, 2.2, 3.0],
      };
    }
    case "palm": {
      return {
        top: (s) => (Math.floor(s * 18) % 2 === 0 ? rgb("#e1cf8e") : rgb("#c9b673")),
        side: () => rgb("#17c3c0"),
        back: (u) => (Math.floor(u * 14) % 2 === 0 ? rgb("#e1cf8e") : rgb("#b39f60")),
      };
    }
    default: {
      // Planks.
      return {
        top: (s) => (Math.floor(s * 20) % 2 === 0 ? rgb("#c99a62") : rgb("#b9854f")),
        side: () => rgb("#8a5d36"),
        back: (u) => (Math.floor(u * 12) % 2 === 0 ? rgb("#8a5d36") : rgb("#7a4e2c")),
      };
    }
  }
}

/** A wedge across the road that rises to a lip, in the world's own stuff. */
export function buildRamps(b: TrackBuild): void {
  const lap = b.track.length;
  for (const r of b.features.ramps) {
    const skin = rampSkin(b.style.id);
    const lipIndex = Math.round(r.lip / b.spacing);
    const first = lipIndex - Math.round(r.length / b.spacing);
    const cols = 12;
    const lift = 0.05;
    const height = (j: number): number => rampHeight([r], b.S(j).s, lap) + lift;
    for (let j = first; j < lipIndex; j++) {
      const a = b.S(j);
      const c = b.S(j + 1);
      const h0 = height(j);
      const h1 = j + 1 === lipIndex ? r.height + lift : height(j + 1);
      const bld = b.deco[b.chunkOf(j)]!;
      const hw0 = a.width / 2 - 0.45;
      const hw1 = c.width / 2 - 0.45;
      const sf0 = (j - first) / (lipIndex - first);
      const sf1 = (j + 1 - first) / (lipIndex - first);
      for (let k = 0; k < cols; k++) {
        const u0 = k / cols;
        const u1 = (k + 1) / cols;
        const p00 = b.P(j, -hw0 + u0 * hw0 * 2, h0);
        const p01 = b.P(j, -hw0 + u1 * hw0 * 2, h0);
        const p11 = b.P(j + 1, -hw1 + u1 * hw1 * 2, h1);
        const p10 = b.P(j + 1, -hw1 + u0 * hw1 * 2, h1);
        const col = skin.top((sf0 + sf1) / 2, (u0 + u1) / 2);
        bld.quad(p00, p01, p11, p10, col, col, col, col, UP);
      }
      // The sides: from the wedge's top down to the road.
      for (const side of SIDES) {
        const t0 = b.P(j, side * hw0, h0);
        const t1 = b.P(j + 1, side * hw1, h1);
        const f0 = b.P(j, side * hw0, 0.02);
        const f1 = b.P(j + 1, side * hw1, 0.02);
        const bands = skin.band ? Math.max(1, Math.round(Math.max(h0, h1) / skin.band)) : 1;
        for (let q = 0; q < bands; q++) {
          const a0 = q / bands;
          const a1 = (q + 1) / bands;
          const mix = (p: V3, t: V3, f: number): V3 => [p[0] + (t[0] - p[0]) * f, p[1] + (t[1] - p[1]) * f, p[2] + (t[2] - p[2]) * f];
          const fromTop = (1 - (a0 + a1) / 2) * ((h0 + h1) / 2);
          const col = skin.side(fromTop, h0, h0 / r.height);
          const dark = scaleRgb(col, 0.8);
          const lo = [mix(f0, t0, a0), mix(f1, t1, a0)] as const;
          const hi = [mix(f0, t0, a1), mix(f1, t1, a1)] as const;
          if (side > 0) bld.quad(lo[0], hi[0], hi[1], lo[1], dark, col, col, dark);
          else bld.quad(hi[0], lo[0], lo[1], hi[1], col, dark, dark, col);
        }
      }
    }
    // The lip's face: a cliff the height of the ramp.
    const a = b.S(lipIndex);
    const bld = b.deco[b.chunkOf(lipIndex)]!;
    const hw = a.width / 2 - 0.45;
    for (let k = 0; k < cols * 2; k++) {
      const u0 = -hw + (k / (cols * 2)) * hw * 2;
      const u1 = -hw + ((k + 1) / (cols * 2)) * hw * 2;
      const top0 = b.P(lipIndex, u0, r.height + lift);
      const top1 = b.P(lipIndex, u1, r.height + lift);
      const foot0 = b.P(lipIndex, u0, 0.02);
      const foot1 = b.P(lipIndex, u1, 0.02);
      const bands = skin.band ? Math.max(1, Math.round(r.height / skin.band)) : 1;
      for (let q = 0; q < bands; q++) {
        const a0 = q / bands;
        const a1 = (q + 1) / bands;
        const at = (p: V3, t: V3, f: number): V3 => [p[0] + (t[0] - p[0]) * f, p[1] + (t[1] - p[1]) * f, p[2] + (t[2] - p[2]) * f];
        const col = skin.back((k + 0.5) / (cols * 2), (1 - (a0 + a1) / 2) * r.height);
        const dark = scaleRgb(col, 0.78);
        bld.quad(at(foot0, top0, a0), at(foot1, top1, a0), at(foot1, top1, a1), at(foot0, top0, a1), dark, dark, col, col);
      }
    }
    // Whatever the world adds to its ramps (the fair's bulbs).
    skin.decorate?.(b, r, lipIndex);
    if (b.style.id === "snow" || b.style.id === "kitchen" || b.style.id === "volcano") {
      // A flag at each corner of the lip, so the jump is seen from far off.
      for (const side of SIDES) {
        const p = b.P(lipIndex - 1, side * (a.width / 2 - 0.15), r.height);
        const flag: Rgb = b.style.id === "snow" ? rgb("#ff7a1a") : b.style.id === "kitchen" ? rgb("#2f7fd6") : [3.2, 1.0, 0.2];
        bld.post(p[0], p[1], p[2], 0.07, 3.4, rgb("#e8ebf2"), 6);
        const dir: V3 = [b.S(lipIndex).tx, 0, b.S(lipIndex).tz];
        bld.tri([p[0], p[1] + 3.4, p[2]], [p[0] + dir[0] * 1.4, p[1] + 3.0, p[2] + dir[2] * 1.4], [p[0], p[1] + 2.6, p[2]], flag);
        bld.tri([p[0], p[1] + 3.4, p[2]], [p[0], p[1] + 2.6, p[2]], [p[0] + dir[0] * 1.4, p[1] + 3.0, p[2] + dir[2] * 1.4], flag);
      }
    }
  }
}

// ─── Patches that change how the road drives ─────────────────────────────────

const PATCH_COLOUR: Record<Exclude<Surface, "boost">, Rgb> = {
  ice: [0.62, 0.84, 1.0],
  mud: [0.46, 0.3, 0.17],
  sand: [0.93, 0.79, 0.5],
  snow: [0.95, 0.98, 1.0],
  grass: [0.36, 0.72, 0.26],
};

export interface PatchGeometry {
  kind: Exclude<Surface, "boost">;
  geometry: BufferGeometry;
}

/** One translucent skin per kind of patch, with soft ends so a patch fades into the road. */
export function buildPatches(b: TrackBuild): PatchGeometry[] {
  const lap = b.track.length;
  const byKind = new Map<string, { pos: number[]; col: number[]; uv: number[] }>();
  for (const p of b.features.surfaces) {
    if (p.kind === "boost") continue;
    const kind = p.kind;
    let g = byKind.get(kind);
    if (!g) {
      g = { pos: [], col: [], uv: [] };
      byKind.set(kind, g);
    }
    const len = (((p.to - p.from) % lap) + lap) % lap || lap;
    const base = PATCH_COLOUR[kind];
    const cols = 6;
    for (let i = 0; i < b.n; i++) {
      const a = b.S(i);
      if (!inMetres(p, a.s, lap)) continue;
      const c = b.S(i + 1);
      const along = (((a.s - p.from) % lap) + lap) % lap;
      const alongNext = along + b.spacing;
      const fade = (m: number) => smoothstep(0, 3.5, m) * smoothstep(0, 3.5, len - m);
      const f0 = fade(along);
      const f1 = fade(Math.min(len, alongNext));
      const w = p.width > 0 ? p.width : a.width - 0.8;
      const w1 = p.width > 0 ? p.width : c.width - 0.8;
      for (let k = 0; k < cols; k++) {
        const u0 = k / cols;
        const u1 = (k + 1) / cols;
        const o = (u: number, width: number) => p.offset + (u - 0.5) * width;
        const edge = (u: number) => smoothstep(0, 0.22, Math.min(u, 1 - u));
        const corner = (j: number, u: number, width: number, f: number): [V3, number] => [b.P(j, o(u, width), 0.04), f * edge(u)];
        const quad = [corner(i, u0, w, f0), corner(i, u1, w, f0), corner(i + 1, u1, w1, f1), corner(i + 1, u0, w1, f1)];
        const uvs = [
          [u0, along / 6],
          [u1, along / 6],
          [u1, alongNext / 6],
          [u0, alongNext / 6],
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const [pt, alpha] = quad[idx]!;
          g.pos.push(pt[0], pt[1], pt[2]);
          g.col.push(base[0], base[1], base[2], alpha);
          g.uv.push(uvs[idx]![0]!, uvs[idx]![1]!);
        }
      }
    }
  }
  const out: PatchGeometry[] = [];
  for (const [kind, g] of byKind) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(g.pos, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(g.col, 4));
    geometry.setAttribute("uv", new Float32BufferAttribute(g.uv, 2));
    const normals = new Float32Array(g.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    out.push({ kind: kind as PatchGeometry["kind"], geometry });
  }
  return out;
}

// ─── Boost pads and strips ───────────────────────────────────────────────────

/** The chevron pads of the track's `boostPads` and its long boost-strip surfaces, textured (v in 4 m repeats). */
export function buildPads(b: TrackBuild): BufferGeometry | null {
  const def = b.track.def;
  const strips = b.features.surfaces.filter((s) => s.kind === "boost");
  if (!def.boostPads?.length && !strips.length) return null;
  const builder = new MeshBuilder(true);
  const white: Rgb = [1, 1, 1];
  const lengthHalf = 4.2;
  const widthHalf = 2.5;
  const steps = 10;
  const P = (s: number, o: number): V3 => {
    const q = b.track.at(s);
    const lift = b.bank.lift(s, o);
    return [q.x - q.tz * o, q.y + lift + 0.04, q.z + q.tx * o];
  };
  for (const pad of def.boostPads ?? []) {
    const sc = pad.at * b.track.length;
    for (let k = 0; k < steps; k++) {
      const s0 = sc - lengthHalf + (k / steps) * lengthHalf * 2;
      const s1 = sc - lengthHalf + ((k + 1) / steps) * lengthHalf * 2;
      const o0 = pad.offset - widthHalf;
      const o1 = pad.offset + widthHalf;
      const v0 = ((s0 - sc) / 4) % 1000;
      const v1 = ((s1 - sc) / 4) % 1000;
      builder.quad(P(s0, o0), P(s0, o1), P(s1, o1), P(s1, o0), white, white, white, white, UP, [0, v0, 1, v0, 1, v1, 0, v1]);
    }
  }
  const lap = b.track.length;
  for (const p of strips) {
    const len = (((p.to - p.from) % lap) + lap) % lap || lap;
    const step = 2;
    for (let m = 0; m < len; m += step) {
      const s0 = p.from + m;
      const s1 = p.from + Math.min(len, m + step);
      const w = p.width > 0 ? p.width : b.track.at(s0).width - 1.6;
      const o0 = p.offset - w / 2;
      const o1 = p.offset + w / 2;
      const v0 = m / 4;
      const v1 = Math.min(len, m + step) / 4;
      builder.quad(P(s0, o0), P(s0, o1), P(s1, o1), P(s1, o0), white, white, white, white, UP, [0, v0, 1, v0, 1, v1, 0, v1]);
    }
  }
  return builder.build();
}

// ─── Space: the ribbon's glowing edges ───────────────────────────────────────

/** The space road's edge lights, its shoulders of faint light and the thickness of the slab. */
export function buildSpaceEdges(b: TrackBuild): void {
  if (b.style.id !== "space") return;
  const core: Rgb = [0.35, 2.4, 3.2];
  const mid: Rgb = [0.1, 0.8, 1.3];
  const none: Rgb = [0, 0, 0];
  const shoulder: Rgb = [0.02, 0.1, 0.2];
  for (let i = 0; i < b.n; i++) {
    if (b.gap(i) || b.gap(i + 1)) continue;
    const a = b.S(i);
    const c = b.S(i + 1);
    for (const side of SIDES) {
      const open = Math.max(b.open(i, side), b.open(i + 1, side));
      const hw0 = a.width / 2;
      const hw1 = c.width / 2;
      const p = (j: number, hw: number, o: number, dy: number): V3 => b.P(j, side * (hw + o), dy);
      const strip = (o0: number, o1: number, c0: Rgb, c1: Rgb, dy = 0.05) => {
        const q = [p(i, hw0, o0, dy), p(i, hw0, o1, dy), p(i + 1, hw1, o1, dy), p(i + 1, hw1, o0, dy)] as const;
        b.additive.quad(q[0], q[1], q[2], q[3], c0, c1, c1, c0, UP);
      };
      // The bright edge line, on the road, and a soft bloom outward.
      strip(-0.55, -0.15, mid, core);
      strip(-0.15, 0.2, core, mid);
      strip(0.2, open > 0.5 ? 3.4 : 1.8, mid, none);
      // The slab's thickness: a face going down, bright at the road and fading.
      const top0 = p(i, hw0, 0, 0);
      const top1 = p(i + 1, hw1, 0, 0);
      const down = 0.9;
      const lo: Rgb = [0.02, 0.14, 0.3];
      if (side > 0) b.additive.quad([top0[0], top0[1] - down, top0[2]], top0, top1, [top1[0], top1[1] - down, top1[2]], lo, mid, mid, lo);
      else b.additive.quad(top0, [top0[0], top0[1] - down, top0[2]], [top1[0], top1[1] - down, top1[2]], top1, mid, lo, lo, mid);
      // Shoulder: faint light across the strip between the road and the rail (not where the edge is open).
      if (open < 0.5) {
        const w0 = b.wall(i, side as -1 | 1);
        const w1 = b.wall(i + 1, side as -1 | 1);
        const q = [p(i, hw0, 0.2, 0.03), p(i, hw0, w0, 0.03), p(i + 1, hw1, w1, 0.03), p(i + 1, hw1, 0.2, 0.03)] as const;
        b.additive.quad(q[0], q[1], q[2], q[3], shoulder, shoulder, shoulder, shoulder, UP);
      }
    }
  }
}

// ─── The fair: strings of bulbs across the road ──────────────────────────────

export function buildFestoons(b: TrackBuild): void {
  if (b.style.id !== "funfair") return;
  const every = 38;
  const count = Math.floor(b.track.length / every);
  const steel = rgb("#d8dce8");
  const colours: Rgb[] = [
    [1.0, 0.82, 0.35],
    [1.0, 0.3, 0.55],
    [0.3, 0.85, 1.0],
    [0.55, 1.0, 0.5],
  ];
  for (let k = 0; k < count; k++) {
    const i = Math.round(((k + 0.5) * every) / b.spacing);
    const a = b.S(i);
    if (b.open(i, -1) > 0.1 || b.open(i, 1) > 0.1 || b.gap(i)) continue;
    // Skip the start, where the gantry stands.
    if (a.s < 30 || a.s > b.track.length - 30) continue;
    const bld = b.deco[b.chunkOf(i)]!;
    const reach = a.width / 2 + b.wall(i, 1) + 2.2;
    const left = b.P(i, -reach, 0);
    const right = b.P(i, reach, 0);
    const height = 10.5;
    for (const p of [left, right]) {
      bld.post(p[0], p[1] - 0.5, p[2], 0.2, height + 0.5, { bottom: rgb("#8b94aa"), top: steel }, 8, 0.7);
      bld.blob(p[0], p[1] + height + 0.1, p[2], 0.35, 0.35, 0.35, [4, 3.2, 1.6], 0);
    }
    const bulbs = 15;
    let prev: V3 = [left[0], left[1] + height, left[2]];
    for (let q = 1; q <= bulbs; q++) {
      const t = q / bulbs;
      const sag = 1.4 * (1 - (2 * t - 1) ** 2);
      const here: V3 = [lerp(left[0], right[0], t), lerp(left[1], right[1], t) + height - sag, lerp(left[2], right[2], t)];
      bld.rod(prev, here, 0.05, rgb("#2b2e37"));
      if (q < bulbs) {
        const col = colours[(q + k) % 4]!;
        bld.blob(here[0], here[1] - 0.12, here[2], 0.17, 0.17, 0.17, [col[0] * 4, col[1] * 4, col[2] * 4], 0);
        b.glows.push({ x: here[0], y: here[1] - 0.12, z: here[2], size: 3.0, colour: col, alpha: 0.7 });
      }
      prev = here;
    }
  }
}
