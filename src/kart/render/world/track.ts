/**
 * The track itself, from its centre line: the road ribbon (banked into its
 * bends), kerbs on the outside of tight bends, the verge, the barriers (a
 * theme's own, 6 m beyond the edge unless a verge moves them), bend signs,
 * the start line and gantry, and (at night) lamps with their pools of light.
 * The features a track adds (ramps, open edges, gaps, patches, boost strips,
 * the space ribbon's glow) are drawn by trackFeatures.ts.
 *
 * Everything is cut into chunks of about 48 m of track. Each chunk is a couple
 * of merged geometries, so the camera skips whatever is behind it and a lap is
 * a few dozen draw calls, not thousands.
 */
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { TrackGeometry, TrackSample } from "../../track/geometry";
import { clamp } from "../math";
import type { QualitySettings } from "../quality";
import { Bank } from "./bank";
import { KartSpace } from "./kartSpace";
import { buildBarriers, onAnotherRoad, onKartGround, SOFT_PUSH } from "./barriers";
import { MeshBuilder, rgb, scaleRgb, type Rgb, type V3 } from "./builder";
import { SOLID_MARGIN, WALL_DISTANCE as WALL, type Features } from "./features";
import { GROUND_SINK, type Terrain } from "./terrain";
import type { ThemeStyle } from "./themes";
import { ROAD_TILE } from "./textures";
import type { Glow, TrackBuild } from "./trackContext";
import { buildFestoons, buildGapEnds, buildOpenEdges, buildPads, buildPatches, buildRamps, buildSpaceEdges, type PatchGeometry } from "./trackFeatures";

/** Samples per chunk (about metres: the geometry samples every metre). */
const CHUNK = 48;
/** A bend counts as tight when it curves harder than this (radius under about 33 m) somewhere along it... */
const TIGHT_PEAK = 1 / 33;
/** ...and the stretch of it curving more than this (radius under about 52 m) is what gets kerbs and signs. */
const TIGHT_EDGE = 1 / 52;

export interface TrackMeshes {
  /** Textured with the road texture (uv across, along / ROAD_TILE). */
  road: BufferGeometry[];
  /** Vertex coloured: kerbs, barriers, signs, gantry, lamps, ramps, cliffs. */
  deco: BufferGeometry[];
  /** The verge on both sides of the road: vertex coloured, uv = world metres / `groundMetres`, so it takes the ground's own material. */
  verge: BufferGeometry[];
  /** Boost pads and strips, textured with the chevrons (v in 4 m repeats). */
  pads: BufferGeometry | null;
  /** Additive light pools (vertex colour is the light). */
  pools: BufferGeometry | null;
  /** Additive glowing ribbons: the space road's edges, holographic rails. */
  additive: BufferGeometry | null;
  /** Ice, mud, sand, snow and grass patches. */
  patches: PatchGeometry[];
  glows: Glow[];
  /** The three bulbs of the start lights, world positions. */
  startLights: V3[];
  /** Where the banner hangs. */
  banner: { x: number; y: number; z: number; yaw: number; width: number; height: number };
  features: Features;
  bank: Bank;
}

const UP: V3 = [0, 1, 0];

/** The colours of the ground a verge can be made of (sand, mud...), as stripes of two. */
function surfaceStripes(kind: string): [Rgb, Rgb] | null {
  switch (kind) {
    case "sand":
      return [rgb("#f0d595"), rgb("#e8c984")];
    case "mud":
      return [rgb("#6b4a2e"), rgb("#5e4027")];
    case "snow":
      return [rgb("#f4f8ff"), rgb("#e4eefb")];
    case "ice":
      return [rgb("#bfe3ff"), rgb("#aad6fa")];
    case "grass":
      return [rgb("#79d255"), rgb("#6ac648")];
    default:
      return null;
  }
}

const spaces = new WeakMap<TrackGeometry, KartSpace>();

/** Can a kart be at (x, z) by the sim's own rule (on any road of the track, within its barrier)? Only asked of a track with branch roads. */
function kartCanBeAt(track: TrackGeometry, x: number, z: number): boolean {
  const main = track.open ? (track as unknown as { main: TrackGeometry }).main : track;
  let space = spaces.get(main);
  if (!space) {
    space = new KartSpace(main.def, main);
    spaces.set(main, space);
  }
  const p = space.place(x, z, 70);
  return p !== null && p.past < 0.6;
}

export function buildTrackMeshes(track: TrackGeometry, style: ThemeStyle, terrain: Terrain, quality: QualitySettings, groundMetres = 64, own?: Features): TrackMeshes {
  const n = track.samples.length;
  const spacing = track.spacing;
  const samples = track.samples;
  // A branch road is built by the same code, open at both ends: its own features, no start line, no bunting.
  const features = own ?? terrain.features;
  const open = track.open;
  /** Metres of road between samples (a branch's samples are spaced in the lap's metres). */
  const realStep = spacing * track.stretch;
  const bank = Bank.of(track);
  const wrapI = open ? (i: number) => Math.max(0, Math.min(n - 1, i)) : (i: number) => ((i % n) + n) % n;
  const S = (i: number): TrackSample => samples[wrapI(i)]!;
  /** A point `off` metres right of sample i's centre, lifted by dy, following the bank. */
  const P = (i: number, off: number, dy = 0): V3 => {
    const a = S(i);
    return [a.x - a.tz * off, a.y + bank.liftAt(i, off) + dy, a.z + a.tx * off];
  };
  const chunks = Math.ceil(n / CHUNK);
  const road: MeshBuilder[] = [];
  const deco: MeshBuilder[] = [];
  const vergeB: MeshBuilder[] = [];
  for (let c = 0; c < chunks; c++) {
    road.push(new MeshBuilder(true));
    deco.push(new MeshBuilder(false));
    vergeB.push(new MeshBuilder(true));
  }
  /** The ground's uv of four corners, as quad() wants them. */
  const groundUv = (...p: V3[]): number[] => p.flatMap((q) => [q[0] / groundMetres, q[2] / groundMetres]);
  const chunkOf = (i: number) => Math.min(chunks - 1, Math.floor(wrapI(i) / CHUNK));
  const glows: Glow[] = [];
  const additive = new MeshBuilder();
  const ctx: TrackBuild = {
    track,
    style,
    terrain,
    quality,
    features,
    bank,
    n,
    spacing,
    S,
    P,
    chunkOf,
    deco,
    additive,
    glows,
    wall: (i, side) => (side < 0 ? features.wallLeft : features.wallRight)[wrapI(i)]!,
    hidden: (i, side) => (side < 0 ? features.hiddenLeft : features.hiddenRight)[wrapI(i)] === 1,
    open: (i, side) => (side < 0 ? features.dropLeft : features.dropRight)[wrapI(i)]!,
    gap: (i) => features.gap[wrapI(i)] === 1,
  };
  const colour = {
    kerbA: rgb(style.kerb[0]),
    kerbB: rgb(style.kerb[1]),
    vergeA: rgb(style.verge[0]),
    vergeB: rgb(style.verge[1]),
  };
  const space = style.id === "space";

  // ── Road ──────────────────────────────────────────────────────────────────
  const WHITE: Rgb = [1, 1, 1];
  /** The road's up at sample i: tipped back on a climb, forward on a descent, and sideways by its lean. */
  const roadUp = (i: number): V3 => {
    const a = S(i);
    const grade = (S(i + 1).y - S(i - 1).y) / (2 * realStep);
    const lean = Math.tan(bank.rollAt(a.s));
    const x = -(grade * a.tx + lean * a.tz);
    const z = lean * a.tx - grade * a.tz;
    const len = Math.hypot(x, 1, z);
    return [x / len, 1 / len, z / len];
  };
  let upHere = roadUp(0);
  for (let i = 0; i < n; i++) {
    const upNext = roadUp(i + 1);
    const up: V3 = [(upHere[0] + upNext[0]) / 2, (upHere[1] + upNext[1]) / 2, (upHere[2] + upNext[2]) / 2];
    upHere = upNext;
    if (ctx.gap(i) || ctx.gap(i + 1)) continue;
    const a = S(i);
    const b = S(i + 1);
    const hw0 = a.width / 2;
    const hw1 = b.width / 2;
    const v0 = (i * realStep) / ROAD_TILE;
    const v1 = ((i + 1) * realStep) / ROAD_TILE;
    // Four strips across, so a banked road is not a single tilted plane through its middle.
    const cols = bank.any ? 4 : 1;
    for (let k = 0; k < cols; k++) {
      const u0 = k / cols;
      const u1 = (k + 1) / cols;
      const l0 = -hw0 + u0 * hw0 * 2;
      const l1 = -hw0 + u1 * hw0 * 2;
      const m0 = -hw1 + u0 * hw1 * 2;
      const m1 = -hw1 + u1 * hw1 * 2;
      road[chunkOf(i)]!.quad(P(i, l0), P(i, l1), P(i + 1, m1), P(i + 1, m0), WHITE, WHITE, WHITE, WHITE, up, [u0, v0, u1, v0, u1, v1, u0, v1]);
    }
  }

  // ── Verge, both sides: two stripes of the theme's ground colour, sloping away at the edge ──
  const groundAt = (p: V3): Rgb => {
    const gi = clamp(Math.round((p[0] - terrain.minX) / terrain.cell), 0, terrain.nx - 1);
    const gj = clamp(Math.round((p[2] - terrain.minZ) / terrain.cell), 0, terrain.nz - 1);
    return terrain.colourAt(gi, gj);
  };
  for (let i = 0; i < n && !space; i += 2) {
    const a = S(i);
    const b = S(i + 2);
    for (const side of [-1, 1] as const) {
      // An open edge has its shelf and cliff instead; a gap has no road to flank.
      if (ctx.open(i, side) > 0.3 || ctx.open(i + 2, side) > 0.3 || ctx.gap(i) || ctx.gap(i + 2)) continue;
      const w0 = ctx.wall(i, side);
      const w1 = ctx.wall(i + 2, side);
      const kind = (side < 0 ? features.vergeLeft : features.vergeRight)[wrapI(i)];
      const own = kind ? surfaceStripes(kind) : null;
      const [sa, sb] = own ?? [colour.vergeA, colour.vergeB];
      const stripe = Math.floor(i / 8) % 2 === 0 ? sa : sb;
      const next = Math.floor((i + 2) / 8) % 2 === 0 ? sa : sb;
      const vergeOuter0 = w0 + 3.4;
      const vergeOuter1 = w1 + 3.4;
      const h0 = a.width / 2 - 0.05;
      const h1 = b.width / 2 - 0.05;
      const flat0 = a.width / 2 + w0 + 0.4;
      const flat1 = b.width / 2 + w1 + 0.4;
      const out0 = a.width / 2 + vergeOuter0;
      const out1 = b.width / 2 + vergeOuter1;
      // Inner strip, flat just under the road's surface.
      const d = -0.025;
      // The last stretch before the barrier darkens a little: the wall's contact shadow, baked.
      const m0 = flat0 - 1.5;
      const m1 = flat1 - 1.5;
      const shade = scaleRgb(stripe, 0.7);
      const shadeNext = scaleRgb(next, 0.7);
      const inner: V3[] =
        side > 0 ? [P(i, h0, d), P(i, m0, d), P(i + 2, m1, d), P(i + 2, h1, d)] : [P(i, -m0, d), P(i, -h0, d), P(i + 2, -h1, d), P(i + 2, -m1, d)];
      const wall: V3[] =
        side > 0 ? [P(i, m0, d), P(i, flat0, d), P(i + 2, flat1, d), P(i + 2, m1, d)] : [P(i, -flat0, d), P(i, -m0, d), P(i + 2, -m1, d), P(i + 2, -flat1, d)];
      const dc = vergeB[chunkOf(i)]!;
      dc.quad(inner[0]!, inner[1]!, inner[2]!, inner[3]!, stripe, stripe, next, next, UP, groundUv(inner[0]!, inner[1]!, inner[2]!, inner[3]!));
      if (side > 0) dc.quad(wall[0]!, wall[1]!, wall[2]!, wall[3]!, stripe, shade, shadeNext, next, UP, groundUv(wall[0]!, wall[1]!, wall[2]!, wall[3]!));
      else dc.quad(wall[0]!, wall[1]!, wall[2]!, wall[3]!, shade, stripe, next, shadeNext, UP, groundUv(wall[0]!, wall[1]!, wall[2]!, wall[3]!));
      // Outer strip falls to the ground beside it, taking the ground's colour so there is no seam. Where a verge puts
      // the barrier far out the ground there is not at the road's own level, so it falls (or rises) to where the ground is.
      const edgeP = (j: number, o: number): V3 => {
        const base = P(j, o, 0);
        const g = terrain.heightAt(base[0], base[2]);
        return [base[0], Math.min(g + 0.02, base[1] + 0.3), base[2]];
      };
      const far = w0 > WALL + 1;
      const slope: V3[] =
        side > 0
          ? [P(i, flat0, d), far ? edgeP(i, out0) : P(i, out0, -GROUND_SINK + 0.02), far ? edgeP(i + 2, out1) : P(i + 2, out1, -GROUND_SINK + 0.02), P(i + 2, flat1, d)]
          : [far ? edgeP(i, -out0) : P(i, -out0, -GROUND_SINK + 0.02), P(i, -flat0, d), P(i + 2, -flat1, d), far ? edgeP(i + 2, -out1) : P(i + 2, -out1, -GROUND_SINK + 0.02)];
      const outerA = groundAt(side > 0 ? slope[1]! : slope[0]!);
      const outerB = groundAt(side > 0 ? slope[2]! : slope[3]!);
      const slopeUv = groundUv(slope[0]!, slope[1]!, slope[2]!, slope[3]!);
      if (side > 0) dc.quad(slope[0]!, slope[1]!, slope[2]!, slope[3]!, shade, outerA, outerB, shadeNext, UP, slopeUv);
      else dc.quad(slope[0]!, slope[1]!, slope[2]!, slope[3]!, outerA, shade, shadeNext, outerB, UP, slopeUv);
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
    if (!kerbed[i] || ctx.gap(i) || ctx.gap(i + 1)) continue;
    const a = S(i);
    const b = S(i + 1);
    // Bends right (+): the outside is the left (negative offset).
    const side = a.curvature > 0 ? -1 : 1;
    // On an open edge the kerb would be the shelf's: leave it (and where a branch road leaves, there is no edge).
    if (ctx.open(i, side) > 0.3 || (ctx.hidden(i, side) && ctx.wall(i, side) > 6.5)) continue;
    const stripe = Math.floor(i / 2) % 2 === 0 ? colour.kerbA : colour.kerbB;
    // A kerb has a profile: it rises from the road in a short bevel, runs flat along its top, and bevels down to the verge.
    // The bevels take the light differently from the top, which is what makes the stripe read as a solid thing.
    const in0 = a.width / 2 - 0.12;
    const in1 = b.width / 2 - 0.12;
    const out0 = a.width / 2 + 1.25;
    const out1 = b.width / 2 + 1.25;
    const mix = (x: number, y: number, t: number) => x + (y - x) * t;
    const prof: [number, number][] = [
      [0, 0.012],
      [0.1, 0.075],
      [0.9, 0.075],
      [1, 0.004],
    ];
    const rx = -a.tz * side;
    const rz = a.tx * side;
    // Not across another road (where a branch leaves or joins this one).
    if (track.routes.length > 0 || open) {
      if ([a.width / 2 - 0.1, a.width / 2 + 0.6, a.width / 2 + 1.3].some((o) => onAnotherRoad(ctx, a.x + rx * o, a.z + rz * o, 0.6))) continue;
    }
    const slope: V3 = [rx * 0.62, 0.78, rz * 0.62];
    const slopeIn: V3 = [-rx * 0.62, 0.78, -rz * 0.62];
    const bevel = scaleRgb(stripe, 0.8);
    for (let k = 0; k < prof.length - 1; k++) {
      const [t0, l0] = prof[k]!;
      const [t1, l1] = prof[k + 1]!;
      const o = (i0: number, i1: number, t: number) => mix(i0, i1, t);
      const s0 = side > 0 ? 1 : -1;
      const A0 = P(i, s0 * o(in0, out0, t0), l0);
      const A1 = P(i, s0 * o(in0, out0, t1), l1);
      const B1 = P(i + 1, s0 * o(in1, out1, t1), l1);
      const B0 = P(i + 1, s0 * o(in1, out1, t0), l0);
      const flat = k === 1;
      const col = flat ? stripe : bevel;
      const n: V3 = flat ? UP : k === 0 ? slopeIn : slope;
      if (side > 0) deco[chunkOf(i)]!.quad(A0, A1, B1, B0, col, col, col, col, n);
      else deco[chunkOf(i)]!.quad(A1, A0, B0, B1, col, col, col, col, n);
    }
  }

  // ── Barriers, and the edges that have none ───────────────────────────────
  buildBarriers(ctx);
  buildOpenEdges(ctx);
  buildGapEnds(ctx);

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
      if (ctx.open(i, side) > 0.1 || ctx.gap(i) || ctx.hidden(i, side)) continue;
      const o = side * (a.width / 2 + ctx.wall(i, side) + 1.45 + (style.barrier === "tyres" ? 0.5 : 0.2) + ((SOFT_PUSH as Record<string, number | undefined>)[style.barrier] ?? 0));
      const cx = a.x - a.tz * o;
      const cz = a.z + a.tx * o;
      // Not on another stretch of road (a branch's bends can lie close to one another).
      if (onKartGround(ctx, cx, cz) || onKartGround(ctx, cx + (-a.tz * side) * 1.7, cz + (a.tx * side) * 1.7)) continue;
      if ((track.routes.length > 0 || open) && (kartCanBeAt(track, cx, cz) || kartCanBeAt(track, cx + (-a.tz * side) * 1.7, cz + (a.tx * side) * 1.7))) continue;
      const y0 = a.y + bank.liftAt(i, side * (a.width / 2)) + 0.3;
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
          cx + rx * (cu + p[0] * 0.95 * dir) + -fx * 0.02,
          y0 + 0.9 + 0.85 + p[1] * 1.15,
          cz + rz * (cu + p[0] * 0.95 * dir) + -fz * 0.02,
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
      // Two posts, reaching down to the ground behind the barrier (level with the road's edge there, banked or not).
      for (const sgn of [-1, 1]) {
        bd.post(cx + rx * 1.3 * sgn - fx * 0.08, y0 - 1.0, cz + rz * 1.3 * sgn - fz * 0.08, 0.07, 3.3, postCol, 6);
      }
      last = i;
    }
  }

  // ── Start line and gantry at s = 0 ───────────────────────────────────────
  const startLights: V3[] = [];
  let banner = { x: 0, y: 0, z: 0, yaw: 0, width: 1, height: 1 };
  if (!open) {
    const g0 = track.at(0);
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
      return [c.x - c.tz * u, c.y + bank.lift(v, u) + dy, c.z + c.tx * u];
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
    // A giant wristwatch over the line (the palm island's start) carries the lights itself; every other
    // start has a gantry: two stout legs, a beam, a light box on its face, and the banner under it.
    const watch = (track.def.landmarks ?? []).some((l) => l.kind === "wristwatch" && Math.min(Math.abs(l.at * track.length), Math.abs(track.length - l.at * track.length)) < 20);
    // The legs stand beyond the barrier and the camera's margin (a kart can drive out to the barrier, so nothing solid may be
    // on the verge): the beam is longer than the road is wide, and the banner under it spans the road and a little more.
    const leg = hw + Math.max(ctx.wall(0, -1), ctx.wall(0, 1)) + SOLID_MARGIN + 0.9;
    const bannerHalf = hw + 1.9;
    const base = g0.y;
    const white2 = rgb("#f4f5f8");
    const accent = rgb("#ff453a");
    const steel = rgb("#2b2f3b");
    const rightX = -g0.tz;
    const rightZ = g0.tx;
    const yawBeam = Math.atan2(-rightZ, rightX);
    const beamY = base + (watch ? 9.6 : 8.1);
    if (!watch) {
      for (const sgn of [-1, 1]) {
        const lx = g0.x + rightX * leg * sgn;
        const lz = g0.z + rightZ * leg * sgn;
        bd.post(lx, base - 0.2, lz, 0.45, 8.0, { bottom: scaleRgb(white2, 0.6), top: white2 }, 10, 0.8);
        bd.post(lx, base - 0.2, lz, 0.62, 0.7, steel, 10, 1);
        bd.post(lx, base + 1.3, lz, 0.5, 0.5, accent, 10, 0.9);
      }
      bd.box(g0.x, beamY, g0.z, leg * 2 + 1.1, 1.0, 0.95, { bottom: scaleRgb(white2, 0.7), top: white2 }, yawBeam);
      bd.box(g0.x, beamY + 0.55, g0.z, leg * 2 + 1.3, 0.22, 1.1, accent, yawBeam);
    }
    // The light box faces the grid (behind the line: -tangent).
    const fx = -g0.tx;
    const fz = -g0.tz;
    const lbx = g0.x + fx * 0.62;
    const lbz = g0.z + fz * 0.62;
    bd.box(lbx, beamY, lbz, 5.0, 1.15, 0.34, steel, yawBeam);
    if (watch) {
      // Two slim hangers up to the watch's case, which is some twelve metres above the road.
      for (const sgn of [-1, 1]) bd.rod([lbx + rightX * 2.3 * sgn, beamY + 0.5, lbz + rightZ * 2.3 * sgn], [lbx + rightX * 2.3 * sgn, base + 13, lbz + rightZ * 2.3 * sgn], 0.14, steel);
    }
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
      width: bannerHalf * 2 - 0.4,
      height: 1.75,
    };
  }

  // ── Bunting along the start straight, by day ─────────────────────────────
  if (style.bunting && !open) {
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
        const o = side * (a.width / 2 + ctx.wall(i, side) + 3.6);
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
  if (style.lamps) {
    const steel = rgb("#2a2f40");
    const poolPos: number[] = [];
    const poolCol: number[] = [];
    const lampEvery = 46;
    const lapSpan = open ? (n - 1) * spacing : track.length;
    const count = Math.floor(lapSpan / lampEvery);
    for (let k = 0; k < count; k++) {
      const s = (k + 0.5) * (lapSpan / count);
      const i = Math.round(s / spacing);
      const a = S(i);
      const side = k % 2 === 0 ? 1 : -1;
      if (ctx.open(i, side) > 0.1 || ctx.hidden(i, side)) continue;
      const o = side * (a.width / 2 + ctx.wall(i, side) + 2.4);
      const px = a.x - a.tz * o;
      const pz = a.z + a.tx * o;
      const bd = deco[chunkOf(i)]!;
      const h = 8.4;
      // The pole stands on the ground beside the road, which leans with it: level with the road's edge on that side.
      const foot = a.y + bank.liftAt(i, side * a.width);
      bd.post(px, foot - 0.3, pz, 0.2, h + 0.3, { bottom: scaleRgb(steel, 0.7), top: steel }, 8, 0.65);
      // The arm leans out over the road (toward it: against the side the pole stands on).
      const toRoadX = side * a.tz;
      const toRoadZ = -side * a.tx;
      const ax = px + toRoadX * 1.7;
      const az = pz + toRoadZ * 1.7;
      bd.box((px + ax) / 2, foot + h - 0.1, (pz + az) / 2, 1.7, 0.16, 0.16, steel, Math.atan2(-(az - pz), ax - px));
      bd.box(ax, foot + h - 0.2, az, 1.15, 0.16, 0.5, [4.2, 3.2, 1.8], Math.atan2(-(az - pz), ax - px));
      glows.push({ x: ax, y: foot + h - 0.3, z: az, size: 4.2, colour: [1.0, 0.82, 0.45], alpha: 0.95 });
      glows.push({ x: ax, y: foot + h - 0.3, z: az, size: 13, colour: [1.0, 0.72, 0.35], alpha: 0.2 });
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
        const fall = Math.pow(Math.max(0, 1 - r), 1.8) * 0.8;
        const c: Rgb = [1.0 * fall, 0.78 * fall, 0.42 * fall];
        return [[wx, proj.sample.y + bank.lift(proj.s, proj.offset) + 0.045, wz], c];
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

  // ── What the track adds ──────────────────────────────────────────────────
  buildRamps(ctx);
  buildSpaceEdges(ctx);
  buildFestoons(ctx);
  const pads = buildPads(ctx);
  const patches = buildPatches(ctx);

  return {
    road: road.filter((b) => !b.empty).map((b) => b.build()),
    deco: deco.filter((b) => !b.empty).map((b) => b.build()),
    verge: vergeB.filter((b) => !b.empty).map((b) => b.build()),
    pads,
    pools,
    additive: additive.empty ? null : additive.build(),
    patches,
    glows,
    startLights,
    banner,
    features,
    bank,
  };
}
