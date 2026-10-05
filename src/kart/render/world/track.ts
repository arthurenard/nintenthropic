/**
 * The track itself, from its centre line: the road ribbon, kerbs on the outside
 * of tight bends, the verge, the barriers 6 m beyond each edge, bend signs,
 * the start line and gantry, boost pads and (at night) lamps with their pools
 * of light.
 *
 * Everything is cut into chunks of about 48 m of track. Each chunk is a couple
 * of merged geometries, so the camera skips whatever is behind it and a lap is
 * a few dozen draw calls, not thousands.
 */
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { TrackGeometry, TrackSample } from "../../track/geometry";
import { clamp } from "../math";
import type { QualitySettings } from "../quality";
import { MeshBuilder, rgb, scaleRgb, type Rgb, type V3 } from "./builder";
import { GROUND_SINK, type Terrain } from "./terrain";
import type { ThemeStyle } from "./themes";
import { ROAD_TILE } from "./textures";

/** Samples per chunk (about metres: the geometry samples every metre). */
const CHUNK = 48;
/** A barrier's inner face stands this far beyond the road's edge: the sim's wall. */
export const WALL_DISTANCE = 6;
/** A bend counts as tight when it curves harder than this (radius under about 33 m) somewhere along it... */
const TIGHT_PEAK = 1 / 33;
/** ...and the stretch of it curving more than this (radius under about 52 m) is what gets kerbs and signs. */
const TIGHT_EDGE = 1 / 52;

export interface Glow {
  x: number;
  y: number;
  z: number;
  size: number;
  colour: Rgb;
  alpha: number;
}

export interface TrackMeshes {
  /** Textured with the road texture (uv across, along / ROAD_TILE). */
  road: BufferGeometry[];
  /** Vertex coloured: verge, kerbs, barriers, signs, gantry, lamps. */
  deco: BufferGeometry[];
  /** Boost pads, textured with the chevrons (v in 4 m repeats). */
  pads: BufferGeometry | null;
  /** Additive light pools (vertex colour is the light). */
  pools: BufferGeometry | null;
  glows: Glow[];
  /** The three bulbs of the start lights, world positions. */
  startLights: V3[];
  /** Where the banner hangs. */
  banner: { x: number; y: number; z: number; yaw: number; width: number; height: number };
}

const UP: V3 = [0, 1, 0];

export function buildTrackMeshes(track: TrackGeometry, style: ThemeStyle, terrain: Terrain, quality: QualitySettings): TrackMeshes {
  const n = track.samples.length;
  const spacing = track.spacing;
  const samples = track.samples;
  const S = (i: number): TrackSample => samples[((i % n) + n) % n]!;
  /** A point `off` metres right of sample i's centre, lifted by dy. */
  const P = (i: number, off: number, dy = 0): V3 => {
    const a = S(i);
    return [a.x - a.tz * off, a.y + dy, a.z + a.tx * off];
  };
  const chunks = Math.ceil(n / CHUNK);
  const road: MeshBuilder[] = [];
  const deco: MeshBuilder[] = [];
  for (let c = 0; c < chunks; c++) {
    road.push(new MeshBuilder(true));
    deco.push(new MeshBuilder(false));
  }
  const chunkOf = (i: number) => Math.min(chunks - 1, Math.floor(((i % n) + n) % n / CHUNK));
  const glows: Glow[] = [];
  const colour = {
    kerbA: rgb(style.kerb[0]),
    kerbB: rgb(style.kerb[1]),
    vergeA: rgb(style.verge[0]),
    vergeB: rgb(style.verge[1]),
  };

  // ── Road ──────────────────────────────────────────────────────────────────
  const WHITE: Rgb = [1, 1, 1];
  for (let i = 0; i < n; i++) {
    const a = S(i);
    const b = S(i + 1);
    const hw0 = a.width / 2;
    const hw1 = b.width / 2;
    const v0 = (i * spacing) / ROAD_TILE;
    const v1 = ((i + 1) * spacing) / ROAD_TILE;
    road[chunkOf(i)]!.quad(P(i, -hw0), P(i, hw0), P(i + 1, hw1), P(i + 1, -hw1), WHITE, WHITE, WHITE, WHITE, UP, [0, v0, 1, v0, 1, v1, 0, v1]);
  }

  // ── Verge, both sides: two stripes of the theme's ground colour, sloping away at the edge ──
  const vergeOuter = WALL_DISTANCE + 3.4;
  const groundAt = (p: V3): Rgb => {
    const gi = clamp(Math.round((p[0] - terrain.minX) / terrain.cell), 0, terrain.nx - 1);
    const gj = clamp(Math.round((p[2] - terrain.minZ) / terrain.cell), 0, terrain.nz - 1);
    return terrain.colourAt(gi, gj);
  };
  for (let i = 0; i < n; i += 2) {
    const a = S(i);
    const b = S(i + 2);
    const stripe = Math.floor(i / 8) % 2 === 0 ? colour.vergeA : colour.vergeB;
    const next = Math.floor((i + 2) / 8) % 2 === 0 ? colour.vergeA : colour.vergeB;
    for (const side of [-1, 1] as const) {
      const h0 = a.width / 2 - 0.05;
      const h1 = b.width / 2 - 0.05;
      const flat0 = a.width / 2 + WALL_DISTANCE + 0.4;
      const flat1 = b.width / 2 + WALL_DISTANCE + 0.4;
      const out0 = a.width / 2 + vergeOuter;
      const out1 = b.width / 2 + vergeOuter;
      // Inner strip, flat just under the road's surface.
      const d = -0.025;
      const inner: V3[] =
        side > 0
          ? [P(i, h0, d), P(i, flat0, d), P(i + 2, flat1, d), P(i + 2, h1, d)]
          : [P(i, -flat0, d), P(i, -h0, d), P(i + 2, -h1, d), P(i + 2, -flat1, d)];
      deco[chunkOf(i)]!.quad(inner[0]!, inner[1]!, inner[2]!, inner[3]!, stripe, stripe, next, next, UP);
      // Outer strip falls to the ground beside it, taking the ground's colour so there is no seam.
      const slope: V3[] =
        side > 0
          ? [P(i, flat0, d), P(i, out0, -GROUND_SINK + 0.02), P(i + 2, out1, -GROUND_SINK + 0.02), P(i + 2, flat1, d)]
          : [P(i, -out0, -GROUND_SINK + 0.02), P(i, -flat0, d), P(i + 2, -flat1, d), P(i + 2, -out1, -GROUND_SINK + 0.02)];
      const outerA = groundAt(side > 0 ? slope[1]! : slope[0]!);
      const outerB = groundAt(side > 0 ? slope[2]! : slope[3]!);
      if (side > 0) deco[chunkOf(i)]!.quad(slope[0]!, slope[1]!, slope[2]!, slope[3]!, stripe, outerA, outerB, next, UP);
      else deco[chunkOf(i)]!.quad(slope[0]!, slope[1]!, slope[2]!, slope[3]!, outerA, stripe, next, outerB, UP);
    }
  }

  // ── Kerbs on the outside of tight bends ──────────────────────────────────
  const tight = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = S(i).curvature;
    if (Math.abs(k) <= TIGHT_EDGE) continue;
    // Only where the same bend, within a few dozen metres, really tightens: a gentle wobble gets nothing.
    for (let j = -25; j <= 25; j++) {
      const kj = S(i + j).curvature;
      if (Math.sign(kj) === Math.sign(k) && Math.abs(kj) > TIGHT_PEAK) {
        tight[i] = 1;
        break;
      }
    }
  }
  const kerbed = new Uint8Array(n);
  const reach = 10;
  for (let i = 0; i < n; i++) {
    if (!tight[i]) continue;
    for (let k = -reach; k <= reach; k++) kerbed[(((i + k) % n) + n) % n] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (!kerbed[i]) continue;
    const a = S(i);
    const b = S(i + 1);
    // Bends right (+): the outside is the left (negative offset).
    const side = a.curvature > 0 ? -1 : 1;
    const stripe = Math.floor(i / 2) % 2 === 0 ? colour.kerbA : colour.kerbB;
    const inner0 = a.width / 2 - 0.12;
    const inner1 = b.width / 2 - 0.12;
    const outer0 = a.width / 2 + 1.25;
    const outer1 = b.width / 2 + 1.25;
    const lift = (e: number) => 0.055 - 0.035 * clamp(e);
    const quad =
      side > 0
        ? ([P(i, inner0, lift(0)), P(i, outer0, lift(1)), P(i + 1, outer1, lift(1)), P(i + 1, inner1, lift(0))] as const)
        : ([P(i, -outer0, lift(1)), P(i, -inner0, lift(0)), P(i + 1, -inner1, lift(0)), P(i + 1, -outer1, lift(1))] as const);
    const shade = scaleRgb(stripe, 1);
    deco[chunkOf(i)]!.quad(quad[0], quad[1], quad[2], quad[3], shade, shade, shade, shade, UP);
  }

  // ── Barriers: walk each side's wall line at an even spacing ──────────────
  const walk = (offsetOf: (a: TrackSample) => number, step: number, emit: (x: number, y: number, z: number, dx: number, dz: number, index: number, count: number) => void) => {
    let acc = 0;
    let count = 0;
    let prev: V3 | null = null;
    for (let i = 0; i <= n; i++) {
      const a = S(i);
      const o = offsetOf(a);
      const p: V3 = [a.x - a.tz * o, a.y, a.z + a.tx * o];
      if (prev) {
        const dx = p[0] - prev[0];
        const dz = p[2] - prev[2];
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          let t = step - acc;
          while (t <= len) {
            const f = t / len;
            emit(prev[0] + dx * f, prev[1] + (p[1] - prev[1]) * f, prev[2] + dz * f, dx / len, dz / len, i - 1, count++);
            t += step;
          }
          acc = len - (t - step);
        }
      }
      prev = p;
    }
  };

  const tyreSteps = quality.detailedTyres ? 8 : 6;
  const tyre = (b: MeshBuilder, cx: number, y: number, cz: number, R: number, H: number, side: Rgb, top: Rgb, rot: number) => {
    const r = R * 0.52;
    const dark = scaleRgb(side, 0.62);
    const inside: Rgb = [0.01, 0.01, 0.012];
    for (let k = 0; k < tyreSteps; k++) {
      const a0 = rot + (k / tyreSteps) * Math.PI * 2;
      const a1 = rot + ((k + 1) / tyreSteps) * Math.PI * 2;
      const o0: V3 = [cx + Math.cos(a0) * R, y, cz + Math.sin(a0) * R];
      const o1: V3 = [cx + Math.cos(a1) * R, y, cz + Math.sin(a1) * R];
      const t0: V3 = [o0[0], y + H, o0[2]];
      const t1: V3 = [o1[0], y + H, o1[2]];
      // Outer wall: lighter at the top, a baked shadow at the foot.
      b.quad(o1, o0, t0, t1, dark, dark, side, side);
      if (quality.detailedTyres) {
        const i0: V3 = [cx + Math.cos(a0) * r, y + H, cz + Math.sin(a0) * r];
        const i1: V3 = [cx + Math.cos(a1) * r, y + H, cz + Math.sin(a1) * r];
        b.quad(t1, t0, i0, i1, top, top, top, top, UP);
        b.tri([cx, y + H * 0.35, cz], i1, i0, inside, inside, inside, UP);
      } else {
        b.tri([cx, y + H, cz], t1, t0, top, top, top, UP);
      }
    }
  };

  const barrier = style.barrier;
  const wallBase = WALL_DISTANCE;
  if (barrier === "tyres") {
    const reds = [rgb("#e8352d"), rgb("#f6f6f2")];
    const rubber = rgb("#1d1f24");
    for (const side of [-1, 1] as const) {
      walk(
        (a) => side * (a.width / 2 + wallBase + 0.55),
        1.12,
        (x, y, z, dx, dz, i, k) => {
          const band = Math.floor(k / 3) % 2;
          const paint = reds[band]!;
          const bld = deco[chunkOf(i)]!;
          const swing = (k * 2.399) % 6.28;
          tyre(bld, x, y - 0.04, z, 0.56, 0.36, paint, rubber, swing);
          // The second row sits half a tyre along and a little in, like a real stack.
          tyre(bld, x + dx * 0.5 + dz * 0.08 * side, y + 0.34, z + dz * 0.5 - dx * 0.08 * side, 0.54, 0.36, reds[(band + 1) % 2]!, rubber, swing + 0.4);
        },
      );
    }
  } else if (barrier === "fence") {
    const wood = rgb("#b88655");
    const woodLight = rgb("#d3a572");
    const woodDark = scaleRgb(wood, 0.62);
    for (const side of [-1, 1] as const) {
      let lastX = NaN;
      let lastZ = NaN;
      let lastY = 0;
      walk(
        (a) => side * (a.width / 2 + wallBase + 0.5),
        2.6,
        (x, y, z, _dx, _dz, i) => {
          const bld = deco[chunkOf(i)]!;
          bld.post(x, y - 0.1, z, 0.13, 1.4, { bottom: woodDark, top: wood }, 6);
          bld.box(x, y + 1.32, z, 0.34, 0.1, 0.34, woodLight);
          if (!Number.isNaN(lastX)) {
            const mx = (x + lastX) / 2;
            const mz = (z + lastZ) / 2;
            const my = (y + lastY) / 2;
            const dx = x - lastX;
            const dz = z - lastZ;
            const len = Math.hypot(dx, dz);
            const yaw = Math.atan2(-dz, dx);
            const slope = Math.atan2(y - lastY, len);
            for (const [h, c] of [
              [0.55, wood],
              [1.0, woodLight],
            ] as const) {
              bld.box(mx, my + h, mz, len, 0.13, 0.1, c, yaw, 0, slope);
            }
          }
          lastX = x;
          lastZ = z;
          lastY = y;
        },
      );
    }
  } else {
    // Harbour: a low concrete kerb wall with painted blocks, and bollards with lamps on top.
    const concrete = rgb("#a9b2c6");
    const concreteDark = scaleRgb(concrete, 0.6);
    const paintA = rgb("#2f6bff");
    const paintB = rgb("#f2f4fa");
    const yellow = rgb("#ffcf2e");
    const black = rgb("#1a1d27");
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < n; i++) {
        const a = S(i);
        const b = S(i + 1);
        const o0 = side * (a.width / 2 + wallBase);
        const o1 = side * (b.width / 2 + wallBase);
        const t = 0.9;
        const stripe = Math.floor(i / 4) % 2 === 0 ? paintA : paintB;
        const bd = deco[chunkOf(i)]!;
        const inner0 = P(i, o0, -0.04);
        const inner1 = P(i + 1, o1, -0.04);
        const outer0 = P(i, o0 + side * t, -0.04);
        const outer1 = P(i + 1, o1 + side * t, -0.04);
        const up = (p: V3, h: number): V3 => [p[0], p[1] + h, p[2]];
        // Face toward the road, then the top, with a painted band.
        const faceFlip = side < 0;
        const f0 = inner0;
        const f1 = inner1;
        if (faceFlip) {
          bd.quad(f0, f1, up(f1, 0.62), up(f0, 0.62), concreteDark, concreteDark, concrete, concrete);
          bd.quad(up(f0, 0.62), up(f1, 0.62), up(outer1, 0.62), up(outer0, 0.62), concrete, concrete, concrete, concrete, UP);
          bd.quad(up(f0, 0.34), up(f1, 0.34), up(f1, 0.5), up(f0, 0.5), stripe, stripe, stripe, stripe);
        } else {
          bd.quad(f1, f0, up(f0, 0.62), up(f1, 0.62), concreteDark, concreteDark, concrete, concrete);
          bd.quad(up(f1, 0.62), up(f0, 0.62), up(outer0, 0.62), up(outer1, 0.62), concrete, concrete, concrete, concrete, UP);
          bd.quad(up(f1, 0.34), up(f0, 0.34), up(f0, 0.5), up(f1, 0.5), stripe, stripe, stripe, stripe);
        }
      }
      walk(
        (a) => side * (a.width / 2 + wallBase + 0.45),
        5,
        (x, y, z, _dx, _dz, i) => {
          const bd = deco[chunkOf(i)]!;
          bd.post(x, y + 0.5, z, 0.17, 0.75, { bottom: black, top: yellow }, 8, 0.9);
          bd.post(x, y + 1.22, z, 0.19, 0.09, [3.4, 2.5, 0.7], 8);
        },
      );
    }
  }

  // ── Bend signs: yellow boards with chevrons beyond the outer barrier, on tight bends ──
  {
    const board = rgb("#ffcf1f");
    const ink = rgb("#16181f");
    const postCol = rgb("#4a4f5c");
    let last = -100;
    for (let i = 0; i < n; i += 1) {
      if (!tight[i] || i - last < 7) continue;
      const a = S(i);
      const side = a.curvature > 0 ? -1 : 1;
      const o = side * (a.width / 2 + wallBase + 1.45 + (barrier === "tyres" ? 0.5 : 0.2));
      const cx = a.x - a.tz * o;
      const cz = a.z + a.tx * o;
      const y0 = a.y + 0.3;
      // The viewer is on the road looking outward: f = outward direction.
      const fx = side > 0 ? -a.tz : a.tz;
      const fz = side > 0 ? a.tx : -a.tx;
      // viewerRight = (-fz, fx)
      const rx = -fz;
      const rz = fx;
      const hwid = 1.7;
      const y1 = y0 + 1.7;
      const bl: V3 = [cx - rx * hwid, y0 + 0.9, cz - rz * hwid];
      const br: V3 = [cx + rx * hwid, y0 + 0.9, cz + rz * hwid];
      const tr: V3 = [br[0], y1 + 0.9, br[2]];
      const tl: V3 = [bl[0], y1 + 0.9, bl[2]];
      const bd = deco[chunkOf(i)]!;
      bd.quad(bl, br, tr, tl, board);
      // Chevrons point the way the bend goes: to the viewer's right for a bend to the right.
      const dir = a.curvature > 0 ? 1 : -1;
      for (let k = -1; k <= 1; k++) {
        const cu = k * 1.0;
        const pts: [number, number][] = [
          [-0.35, -0.5],
          [-0.08, -0.5],
          [0.38, 0],
          [-0.08, 0.5],
          [-0.35, 0.5],
          [0.12, 0],
        ];
        const w = (p: [number, number]): V3 => [
          cx + rx * (cu + p[0] * 0.95 * dir) + (-fx) * 0.02,
          y0 + 0.9 + 0.85 + p[1] * 1.15,
          cz + rz * (cu + p[0] * 0.95 * dir) + (-fz) * 0.02,
        ];
        const [A, B, C, D, E, F] = pts.map(w) as [V3, V3, V3, V3, V3, V3];
        if (dir > 0) {
          bd.tri(A, B, C, ink);
          bd.tri(A, C, F, ink);
          bd.tri(F, C, D, ink);
          bd.tri(F, D, E, ink);
        } else {
          bd.tri(B, A, C, ink);
          bd.tri(C, A, F, ink);
          bd.tri(C, F, D, ink);
          bd.tri(D, F, E, ink);
        }
      }
      // Two posts, reaching down to the ground behind the barrier.
      for (const sgn of [-1, 1]) {
        bd.post(cx + rx * 1.3 * sgn - fx * 0.08, a.y - 0.7, cz + rz * 1.3 * sgn - fz * 0.08, 0.07, 3.3, postCol, 6);
      }
      last = i;
    }
  }

  // ── Start line and gantry at s = 0 ───────────────────────────────────────
  const g0 = track.at(0);
  const startLights: V3[] = [];
  let banner = { x: 0, y: 0, z: 0, yaw: 0, width: 1, height: 1 };
  {
    const bd = deco[0]!;
    const hw = g0.width / 2;
    const cols = Math.max(8, Math.round(g0.width / 0.9 / 2) * 2);
    const cw = g0.width / cols;
    const black = rgb("#16181e");
    const white = rgb("#fbfbf7");
    const rows = 3;
    const rl = 0.62;
    const pt = (u: number, v: number, dy: number): V3 => {
      const c = track.at(v);
      return [c.x - c.tz * u, c.y + dy, c.z + c.tx * u];
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = (r + c) % 2 === 0 ? white : black;
        const u0 = -hw + c * cw;
        const u1 = u0 + cw;
        const v0 = -rl * rows * 0.5 + r * rl;
        const v1 = v0 + rl;
        bd.quad(pt(u0, v0, 0.03), pt(u1, v0, 0.03), pt(u1, v1, 0.03), pt(u0, v1, 0.03), col, col, col, col, UP);
      }
    }
    // Gantry: two stout legs, a beam, a light box on its face, and the banner under it.
    const leg = hw + 1.9;
    const base = g0.y;
    const white2 = rgb("#f4f5f8");
    const accent = rgb("#ff453a");
    const steel = rgb("#2b2f3b");
    const rightX = -g0.tz;
    const rightZ = g0.tx;
    const yawBeam = Math.atan2(-rightZ, rightX);
    for (const sgn of [-1, 1]) {
      const lx = g0.x + rightX * leg * sgn;
      const lz = g0.z + rightZ * leg * sgn;
      bd.post(lx, base - 0.2, lz, 0.45, 8.0, { bottom: scaleRgb(white2, 0.6), top: white2 }, 10, 0.8);
      bd.post(lx, base - 0.2, lz, 0.62, 0.7, steel, 10, 1);
      bd.post(lx, base + 1.3, lz, 0.5, 0.5, accent, 10, 0.9);
    }
    const beamY = base + 8.1;
    bd.box(g0.x, beamY, g0.z, leg * 2 + 1.1, 1.0, 0.95, { bottom: scaleRgb(white2, 0.7), top: white2 }, yawBeam);
    bd.box(g0.x, beamY + 0.55, g0.z, leg * 2 + 1.3, 0.22, 1.1, accent, yawBeam);
    // The light box faces the grid (behind the line: -tangent).
    const fx = -g0.tx;
    const fz = -g0.tz;
    const lbx = g0.x + fx * 0.62;
    const lbz = g0.z + fz * 0.62;
    bd.box(lbx, beamY, lbz, 5.0, 1.15, 0.34, steel, yawBeam);
    for (const k of [-1, 0, 1]) {
      const bx = lbx + rightX * k * 1.5 + fx * 0.26;
      const bz = lbz + rightZ * k * 1.5 + fz * 0.26;
      startLights.push([bx + fx * 0.05, beamY, bz + fz * 0.05]);
    }
    banner = {
      x: g0.x + fx * 0.52,
      y: beamY - 1.55,
      z: g0.z + fz * 0.52,
      yaw: Math.atan2(fx, fz),
      width: leg * 2 - 0.4,
      height: 1.75,
    };
  }

  // ── Bunting along the start straight, by day ─────────────────────────────
  if (!style.night) {
    const flagColours = ["#ff453a", "#ffd60a", "#0a84ff", "#30d158", "#ffffff", "#ff9f0a", "#bf5af2"].map(rgb);
    const pole = rgb("#d8dce6");
    const string = rgb("#2b2e37");
    const span = 7;
    const from = -84;
    const to = 63;
    for (const side of [-1, 1] as const) {
      const tops: V3[] = [];
      const index: number[] = [];
      for (let k = from; k <= to; k += span) {
        const i = Math.round(k / spacing);
        const a = S(i);
        const o = side * (a.width / 2 + wallBase + 3.6);
        const x = a.x - a.tz * o;
        const z = a.z + a.tx * o;
        deco[chunkOf(i)]!.post(x, a.y - 0.6, z, 0.08, 6.2, { bottom: scaleRgb(pole, 0.7), top: pole }, 6, 0.8);
        tops.push([x, a.y + 5.2, z]);
        index.push(i);
      }
      for (let k = 0; k < tops.length - 1; k++) {
        const p = tops[k]!;
        const q = tops[k + 1]!;
        const bd = deco[chunkOf(index[k]!)]!;
        const flags = 8;
        let prev: V3 = p;
        for (let f = 1; f <= flags; f++) {
          const t = f / flags;
          const sag = 0.9 * (1 - (2 * t - 1) ** 2);
          const here: V3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - sag, p[2] + (q[2] - p[2]) * t];
          bd.rod(prev, here, 0.035, string);
          // A pennant hangs from the string's middle: a triangle, drawn from both sides.
          const mid: V3 = [(prev[0] + here[0]) / 2, (prev[1] + here[1]) / 2, (prev[2] + here[2]) / 2];
          const apex: V3 = [mid[0], mid[1] - 0.62, mid[2]];
          const c = flagColours[(k * flags + f + (side > 0 ? 3 : 0)) % flagColours.length]!;
          const dim = scaleRgb(c, 0.8);
          bd.tri(prev, here, apex, c, c, dim);
          bd.tri(here, prev, apex, c, c, dim);
          prev = here;
        }
      }
    }
  }

  // ── Night lamps with pools of light ──────────────────────────────────────
  let pools: BufferGeometry | null = null;
  if (style.night) {
    const steel = rgb("#2a2f40");
    const poolPos: number[] = [];
    const poolCol: number[] = [];
    const lampEvery = 46;
    const count = Math.floor(track.length / lampEvery);
    for (let k = 0; k < count; k++) {
      const s = (k + 0.5) * (track.length / count);
      const i = Math.round(s / spacing);
      const a = S(i);
      const side = k % 2 === 0 ? 1 : -1;
      const o = side * (a.width / 2 + wallBase + 2.4);
      const px = a.x - a.tz * o;
      const pz = a.z + a.tx * o;
      const bd = deco[chunkOf(i)]!;
      const h = 8.4;
      bd.post(px, a.y - 0.3, pz, 0.2, h + 0.3, { bottom: scaleRgb(steel, 0.7), top: steel }, 8, 0.65);
      // The arm leans out over the road (toward it: against the side the pole stands on).
      const toRoadX = side * a.tz;
      const toRoadZ = -side * a.tx;
      const ax = px + toRoadX * 1.7;
      const az = pz + toRoadZ * 1.7;
      bd.box((px + ax) / 2, a.y + h - 0.1, (pz + az) / 2, 1.7, 0.16, 0.16, steel, Math.atan2(-(az - pz), ax - px));
      bd.box(ax, a.y + h - 0.2, az, 1.15, 0.16, 0.5, [4.2, 3.2, 1.8], Math.atan2(-(az - pz), ax - px));
      glows.push({ x: ax, y: a.y + h - 0.3, z: az, size: 4.2, colour: [1.0, 0.82, 0.45], alpha: 0.95 });
      glows.push({ x: ax, y: a.y + h - 0.3, z: az, size: 13, colour: [1.0, 0.72, 0.35], alpha: 0.2 });
      // The pool on the road beneath: a grid whose brightness falls with distance.
      const R = 10;
      const gridN = 8;
      const cxw = ax + toRoadX * 4.5;
      const czw = az + toRoadZ * 4.5;
      const cell = (2 * R) / gridN;
      const tx = a.tx;
      const tz = a.tz;
      const rx = -a.tz;
      const rz = a.tx;
      const at = (u: number, v: number): [V3, Rgb] => {
        const wx = cxw + rx * u + tx * v;
        const wz = czw + rz * u + tz * v;
        const proj = track.project(wx, wz, a.s);
        const r = Math.hypot(u, v) / R;
        const fall = Math.pow(Math.max(0, 1 - r), 1.8) * 0.34;
        const c: Rgb = [1.0 * fall, 0.78 * fall, 0.42 * fall];
        return [[wx, proj.sample.y + 0.045, wz], c];
      };
      for (let gu = 0; gu < gridN; gu++) {
        for (let gv = 0; gv < gridN; gv++) {
          const u0 = -R + gu * cell;
          const v0 = -R + gv * cell;
          const corners = [at(u0, v0), at(u0 + cell, v0), at(u0 + cell, v0 + cell), at(u0, v0 + cell)];
          for (const idx of [0, 1, 2, 0, 2, 3]) {
            const c = corners[idx]!;
            poolPos.push(...c[0]);
            poolCol.push(...c[1]);
          }
        }
      }
    }
    pools = new BufferGeometry();
    pools.setAttribute("position", new Float32BufferAttribute(poolPos, 3));
    pools.setAttribute("color", new Float32BufferAttribute(poolCol, 3));
    pools.computeBoundingSphere();
  }

  // ── Boost pads ───────────────────────────────────────────────────────────
  let pads: BufferGeometry | null = null;
  if (track.def.boostPads?.length) {
    const b = new MeshBuilder(true);
    const lengthHalf = 4.2;
    const widthHalf = 2.5;
    const steps = 10;
    for (const pad of track.def.boostPads) {
      const sc = pad.at * track.length;
      for (let k = 0; k < steps; k++) {
        const s0 = sc - lengthHalf + (k / steps) * lengthHalf * 2;
        const s1 = sc - lengthHalf + ((k + 1) / steps) * lengthHalf * 2;
        const p = (s: number, o: number): V3 => {
          const q = track.point(s, o);
          return [q.x, q.y + 0.04, q.z];
        };
        const o0 = pad.offset - widthHalf;
        const o1 = pad.offset + widthHalf;
        const v0 = ((s0 - sc) / 4) % 1000;
        const v1 = ((s1 - sc) / 4) % 1000;
        b.quad(p(s0, o0), p(s0, o1), p(s1, o1), p(s1, o0), [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], UP, [0, v0, 1, v0, 1, v1, 0, v1]);
      }
    }
    pads = b.build();
  }

  return {
    road: road.filter((b) => !b.empty).map((b) => b.build()),
    deco: deco.filter((b) => !b.empty).map((b) => b.build()),
    pads,
    pools,
    glows,
    startLights,
    banner,
  };
}
