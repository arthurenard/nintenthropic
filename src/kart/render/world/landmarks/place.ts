/**
 * Puts landmarks and hazards in the world.
 *
 * Landmarks: each one in the track's list is built by its model (a
 * MeshBuilder or three), placed by `at` / `offset` / `turn` / `scale`, and
 * baked into a few merged geometries, one set per 300 m of the lap, so the
 * camera skips what it cannot see and thirty set pieces cost a handful of
 * draw calls. Only the parts a model says move (`moving`) stay separate.
 * A landmark with a `span` is built in the road's own frame and bent along
 * the road (and its banking) as it is baked.
 *
 * Hazards: one animated actor each, posed every frame from `hazardAt` and
 * the race clock, the same pure function the sim spins karts out with.
 */
import { landmarkFromArt } from "./fromArt";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
  type Points,
  type Texture,
} from "three";
import { seededRandom } from "../../../../engine/random";
import type { HazardDef, Landmark, TrackGeometry } from "../../../track/geometry";
import { hazardAt } from "../../../track/hazards";
import { makePoints } from "../../points";
import { smoothstep } from "../../math";
import type { Bank } from "../bank";
import { MeshBuilder, type V3 } from "../builder";
import { SOLID_MARGIN, WALL_DISTANCE } from "../features";
import { bakedLit, makeBakeUniforms, type BakeUniforms } from "../shading";
import { glowTexture } from "../textures";
import type { ThemeStyle } from "../themes";
import { HAZARDS, LANDMARKS } from "./index";
import type { Halo, HazardModel, HazardState, LandmarkContext, LandmarkModel } from "./types";

// ─── Materials ───────────────────────────────────────────────────────────────

export interface LandmarkMaterials {
  lit: MeshStandardMaterial;
  glow: MeshBasicMaterial;
  glass: MeshPhysicalMaterial;
  dispose(): void;
}

/** The three materials every landmark and hazard is drawn with: solid, glowing, translucent; all double sided. */
export function landmarkMaterials(bake: BakeUniforms = makeBakeUniforms()): LandmarkMaterials {
  const lit = bakedLit(new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.62, metalness: 0.02 }), bake, "landmark");
  const glow = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  const glass = new MeshPhysicalMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
  return {
    lit,
    glow,
    glass,
    dispose() {
      lit.dispose();
      glow.dispose();
      glass.dispose();
    },
  };
}

// ─── Baking ──────────────────────────────────────────────────────────────────

/** Where the unit normal `n` at `p` points after `map` (the map's own bending included): a short step along it, mapped. */
function mapNormal(map: (p: V3) => V3, p: V3, n: V3): V3 {
  const e = 0.05;
  const a = map(p);
  const b = map([p[0] + n[0] * e, p[1] + n[1] * e, p[2] + n[2] * e]);
  const x = b[0] - a[0];
  const y = b[1] - a[1];
  const z = b[2] - a[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Copies `src`'s triangles into `dst`, every point through `map`. Normals are recomputed flat, except
 * for a smooth source (a Blender-made model, `src.smooth`): it keeps the normal at each corner.
 */
export function bake(dst: MeshBuilder, src: MeshBuilder, map: (p: V3) => V3, smooth: boolean = src.smooth): void {
  const p = src.position;
  const c = src.color;
  const nr = src.normal;
  for (let i = 0; i < p.length; i += 9) {
    const a: V3 = [p[i]!, p[i + 1]!, p[i + 2]!];
    const b: V3 = [p[i + 3]!, p[i + 4]!, p[i + 5]!];
    const d: V3 = [p[i + 6]!, p[i + 7]!, p[i + 8]!];
    const ca: V3 = [c[i]!, c[i + 1]!, c[i + 2]!];
    const cb: V3 = [c[i + 3]!, c[i + 4]!, c[i + 5]!];
    const cd: V3 = [c[i + 6]!, c[i + 7]!, c[i + 8]!];
    if (smooth) {
      dst.triN(
        map(a),
        map(b),
        map(d),
        ca,
        cb,
        cd,
        mapNormal(map, a, [nr[i]!, nr[i + 1]!, nr[i + 2]!]),
        mapNormal(map, b, [nr[i + 3]!, nr[i + 4]!, nr[i + 5]!]),
        mapNormal(map, d, [nr[i + 6]!, nr[i + 7]!, nr[i + 8]!]),
      );
    } else {
      dst.tri(map(a), map(b), map(d), ca, cb, cd);
    }
  }
}

type Corner = { p: V3; c: V3; n?: V3 };

/**
 * Like `bake`, but first cuts every triangle that is longer than `maxZ`
 * metres along z into smaller ones, so a long wall bends smoothly round a
 * curve instead of cutting the corner.
 */
export function bakeBent(dst: MeshBuilder, src: MeshBuilder, map: (p: V3) => V3, maxZ = 2.5, smoothOverride?: boolean): void {
  const p = src.position;
  const c = src.color;
  const nr = src.normal;
  // A Blender-made model keeps its smooth normals (its builder says so, or the caller does).
  const smooth = smoothOverride ?? src.smooth;
  const stack: [Corner, Corner, Corner][] = [];
  const mid = (a: Corner, b: Corner): Corner => {
    const m: Corner = {
      p: [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2],
      c: [(a.c[0] + b.c[0]) / 2, (a.c[1] + b.c[1]) / 2, (a.c[2] + b.c[2]) / 2],
    };
    if (a.n && b.n) {
      const x = a.n[0] + b.n[0];
      const y = a.n[1] + b.n[1];
      const z = a.n[2] + b.n[2];
      const l = Math.hypot(x, y, z) || 1;
      m.n = [x / l, y / l, z / l];
    }
    return m;
  };
  const corner = (i: number): Corner => {
    const k: Corner = { p: [p[i]!, p[i + 1]!, p[i + 2]!], c: [c[i]!, c[i + 1]!, c[i + 2]!] };
    if (smooth) k.n = [nr[i]!, nr[i + 1]!, nr[i + 2]!];
    return k;
  };
  for (let i = 0; i < p.length; i += 9) {
    stack.push([corner(i), corner(i + 3), corner(i + 6)]);
    let guard = 0;
    while (stack.length && guard++ < 4000) {
      const [a, b, d] = stack.pop()!;
      const ez = [Math.abs(a.p[2] - b.p[2]), Math.abs(b.p[2] - d.p[2]), Math.abs(d.p[2] - a.p[2])];
      const worst = Math.max(...ez);
      if (worst <= maxZ) {
        if (smooth && a.n && b.n && d.n) dst.triN(map(a.p), map(b.p), map(d.p), a.c, b.c, d.c, mapNormal(map, a.p, a.n), mapNormal(map, b.p, b.n), mapNormal(map, d.p, d.n));
        else dst.tri(map(a.p), map(b.p), map(d.p), a.c, b.c, d.c);
        continue;
      }
      if (worst === ez[0]) {
        const m = mid(a, b);
        stack.push([a, m, d], [m, b, d]);
      } else if (worst === ez[1]) {
        const m = mid(b, d);
        stack.push([a, b, m], [a, m, d]);
      } else {
        const m = mid(d, a);
        stack.push([a, b, m], [m, b, d]);
      }
    }
  }
}

/** Where a point of a span landmark's own frame (x right, y up, z along) lands in the world. */
export function roadFrameMap(track: TrackGeometry, bank: Bank, s0: number, offset: number): (p: V3) => V3 {
  return ([x, y, z]) => {
    const s = s0 + z;
    const c = track.at(s);
    const roll = bank.rollAt(s);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    // The road's right and up, leaned by the bank: the right side dips, the up leans toward the inside.
    const lat = x + offset;
    const rx = -c.tz;
    const rz = c.tx;
    return [c.x + rx * (lat * cr + y * sr), c.y + -lat * sr + y * cr, c.z + rz * (lat * cr + y * sr)];
  };
}

// ─── Landmarks ───────────────────────────────────────────────────────────────

/**
 * The yaw (contract.ts heading) at which a landmark beside the road faces it:
 * its front, +z in model space, looks across the road. A landmark on the
 * centre line (offset 0) looks back at the oncoming kart. `tx, tz` is the
 * road's direction there.
 */
export function facingRoad(tx: number, tz: number, offset: number): number {
  const side = Math.sign(offset);
  // The road's right is (-tz, tx); the thing stands on that side (offset > 0) and looks the other way.
  return side === 0 ? Math.atan2(-tx, -tz) : Math.atan2(side * tz, side * -tx);
}

/** A circle on the ground that clutter (trees, rocks) must stay out of. */
export interface KeepOut {
  x: number;
  z: number;
  r: number;
}

/** A landmark as the track gives it, or placed by the world itself: `lift` raises it (the duck on a stool), `abs` puts it at a world position instead of beside the road. */
export type PlacedLandmark = Landmark & { lift?: number; abs?: { x: number; z: number; yaw: number } };

/** The roof of a thing over the road: how high its lowest surface above a kart's reach is, every `step` metres from `s0` along the lap. */
export interface Roof {
  s0: number;
  step: number;
  /** Metres above the road; Infinity where there is no roof. */
  heights: Float32Array;
}

export interface LandmarkLayer {
  group: Group;
  keepOut: KeepOut[];
  /** The roofs of the things over the road, for the camera to keep under. */
  roofs: Roof[];
  /** Number of landmarks actually built (unknown names are left out). */
  count: number;
  update(time: number): void;
  dispose(): void;
}

export interface PlaceEnv {
  track: TrackGeometry;
  style: ThemeStyle;
  bank: Bank;
  /** Where the sim's barrier stands at `s` metres along the lap, beyond the road's edge on this side (default: the usual 6 m). */
  wall?(s: number, side: -1 | 1): number;
  /** The ground's height at a point. */
  groundAt(x: number, z: number): number;
  /** Fraction of optional detail to keep (quality). Landmarks themselves are always built. */
  detail?: number;
}

const CHUNK_METRES = 300;

/** What a kart (or a camera swung out past the barrier) can meet of a thing over the road: between these heights above it. */
const SOLID_BAND: [number, number] = [0.45, 5];

/**
 * Widens a thing over the road where its legs or walls would stand inside the barrier, or within a camera's width of it:
 * everything beyond its innermost low part moves out, smoothly from where it begins, so the arch stands a little wider and
 * nothing solid is in the way of a kart. The model is in the road's frame (x to the right); `reach` is how far beyond the
 * road's edge, left and right, its low parts must stay clear. `dip` is how much lower, per metre beyond the edge, the banked
 * road tilts it on each side (the verge beside the road stays flat, so a leaning structure stands lower over it).
 */
export function standClear(model: LandmarkModel, halfWidth: number, reach: readonly [number, number], dip: readonly [number, number] = [0, 0]): void {
  const builders = [model.lit, model.glow, model.glass].filter((b): b is MeshBuilder => !!b);
  const [lo, hi] = SOLID_BAND;
  /** How near the road's edge, each side, any surface of the model stands in the band (Infinity: none). */
  const innermost = (): number[] => {
    const inner = [Infinity, Infinity];
    const f = [0, 0, 0];
    const bx = [0, 0, 0];
    for (const b of builders) {
      const p = b.position;
      for (let i = 0; i < p.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const x = p[i + k * 3]!;
          bx[k] = x;
          f[k] = p[i + k * 3 + 1]! - Math.max(0, Math.abs(x) - halfWidth) * dip[x < 0 ? 0 : 1]!;
        }
        // The triangle's corners in the band, and where its edges cross the band's limits.
        for (let k = 0; k < 3; k++) {
          const side = bx[k]! < 0 ? 0 : 1;
          if (f[k]! >= lo && f[k]! <= hi) inner[side] = Math.min(inner[side]!, Math.abs(bx[k]!) - halfWidth);
          const j = (k + 1) % 3;
          for (const limit of [lo, hi]) {
            if ((f[k]! - limit) * (f[j]! - limit) >= 0) continue;
            const t = (limit - f[k]!) / (f[j]! - f[k]!);
            const x = bx[k]! + (bx[j]! - bx[k]!) * t;
            inner[x < 0 ? 0 : 1] = Math.min(inner[x < 0 ? 0 : 1]!, Math.abs(x) - halfWidth);
          }
        }
      }
    }
    return inner.map((v) => Math.max(0, v));
  };
  for (let pass = 0; pass < 6; pass++) {
    const inner = innermost();
    // A little more than asked, so what stands at the line is not on it.
    const shift = [Math.max(0, reach[0] + 0.3 - inner[0]!), Math.max(0, reach[1] + 0.3 - inner[1]!)];
    if (!(shift[0]! > 0.05 || shift[1]! > 0.05)) return;
    const move = (x: number): number => {
      const k = x < 0 ? 0 : 1;
      const by = shift[k]!;
      if (by <= 0) return x;
      const ramp = smoothstep(inner[k]! - 3, inner[k]!, Math.abs(x) - halfWidth);
      return x + Math.sign(x) * by * ramp;
    };
    for (const b of builders) {
      const p = b.position;
      for (let i = 0; i < p.length; i += 3) p[i] = move(p[i]!);
    }
    if (model.halos) model.halos = model.halos.map((h) => ({ ...h, x: move(h.x) }));
  }
}

/** Where a span model's lowest surface above `SOLID_BAND` is, along its length, within `lateral` metres of the centre line. */
function roofProfile(model: LandmarkModel, s0: number, span: number, lateral: number): Roof {
  const step = 2;
  const heights = new Float32Array(Math.ceil(span / step) + 1).fill(Infinity);
  const note = (x: number, y: number, z: number): void => {
    if (Math.abs(x) > lateral || y <= SOLID_BAND[1]) return;
    const i = Math.round((z + span / 2) / step);
    if (i >= 0 && i < heights.length) heights[i] = Math.min(heights[i]!, y);
  };
  for (const b of [model.lit, model.glow, model.glass]) {
    if (!b) continue;
    const p = b.position;
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const a = i + k * 3;
        const n = i + ((k + 1) % 3) * 3;
        // The corner and the edge to the next, a metre at a time.
        const len = Math.max(1, Math.ceil(Math.hypot(p[n]! - p[a]!, p[n + 1]! - p[a + 1]!, p[n + 2]! - p[a + 2]!)));
        for (let q = 0; q < len; q++) {
          const t = q / len;
          note(p[a]! + (p[n]! - p[a]!) * t, p[a + 1]! + (p[n + 1]! - p[a + 1]!) * t, p[a + 2]! + (p[n + 2]! - p[a + 2]!) * t);
        }
      }
    }
  }
  return { s0: s0 - span / 2, step, heights };
}

interface Chunk {
  lit: MeshBuilder;
  glow: MeshBuilder;
  glass: MeshBuilder;
}

function modelRadius(model: LandmarkModel): number {
  let r2 = 0;
  const p = model.lit.position;
  for (let i = 0; i < p.length; i += 3) r2 = Math.max(r2, p[i]! * p[i]! + p[i + 2]! * p[i + 2]!);
  return Math.sqrt(r2);
}

export function buildLandmarks(env: PlaceEnv, list: readonly PlacedLandmark[], mats: LandmarkMaterials): LandmarkLayer {
  const { track } = env;
  const group = new Group();
  const keepOut: KeepOut[] = [];
  const roofs: Roof[] = [];
  const chunks = new Map<number, Chunk>();
  const animated: ((t: number) => void)[] = [];
  const halos: (Halo & { phase: number })[] = [];
  const disposables: { dispose(): void }[] = [];
  /** Soft dark blobs on the ground under the big things, so they sit there instead of floating. */
  const blobs: { x: number; y: number; z: number; rx: number; rz: number; yaw: number; strength: number }[] = [];
  const sun = new Vector3(...env.style.sky.sunDir).normalize();
  let count = 0;

  const chunkAt = (s: number): Chunk => {
    const k = Math.floor(track.wrap(s) / CHUNK_METRES);
    let c = chunks.get(k);
    if (!c) {
      c = { lit: new MeshBuilder(), glow: new MeshBuilder(), glass: new MeshBuilder() };
      chunks.set(k, c);
    }
    return c;
  };

  list.forEach((lm, index) => {
    const spec = LANDMARKS[lm.kind];
    if (!spec) return;
    const span = spec.span ? (lm.span ?? spec.defaultSpan ?? 40) : 0;
    const at = lm.at * track.length;
    const c = track.at(at);
    const scale = lm.scale ?? 1;
    const ctx: LandmarkContext = {
      rnd: seededRandom(1000 + index * 7919),
      theme: env.style.id,
      night: env.style.night,
      scale,
      span,
      halfWidth: c.width / 2,
    };
    // The Blender-made model when there is one (art/kart/), else the code-built one.
    const model = landmarkFromArt(lm.kind) ?? spec.build(ctx);
    const chunk = chunkAt(at);
    const rnd = seededRandom(31 + index);

    if (spec.span) {
      // Its legs and walls stand beyond the barrier and the camera's margin, wherever the barrier is along its span.
      const reach: [number, number] = env.wall ? [0, 0] : [WALL_DISTANCE, WALL_DISTANCE];
      const dip: [number, number] = [0, 0];
      let wide = c.width / 2;
      for (let d = -span / 2; d <= span / 2; d += 2) {
        if (env.wall) {
          reach[0] = Math.max(reach[0], env.wall(at + d, -1));
          reach[1] = Math.max(reach[1], env.wall(at + d, 1));
        }
        wide = Math.max(wide, track.at(at + d).width / 2);
        const roll = Math.sin(env.bank.rollAt(track.wrap(at + d)));
        dip[0] = Math.max(dip[0], -roll);
        dip[1] = Math.max(dip[1], roll);
      }
      standClear(model, wide, [reach[0] + SOLID_MARGIN, reach[1] + SOLID_MARGIN], dip);
      if (lm.offset === 0) roofs.push(roofProfile(model, at, span, wide + Math.max(reach[0], reach[1]) + SOLID_MARGIN));
      const map = roadFrameMap(track, env.bank, at, lm.offset);
      bakeBent(chunk.lit, model.lit, map, 2.5, model.smooth);
      if (model.glow) bakeBent(chunk.glow, model.glow, map, 2.5, model.smooth);
      if (model.glass) bakeBent(chunk.glass, model.glass, map, 2.5, model.smooth);
      for (const h of model.halos ?? []) {
        const w = map([h.x, h.y, h.z]);
        halos.push({ ...h, x: w[0], y: w[1], z: w[2], phase: rnd() * 6.28 });
      }
      count++;
      return;
    }

    // Standing beside the road, turned to face it (an offset of 0: facing the oncoming kart).
    const yaw = lm.abs ? lm.abs.yaw : facingRoad(c.tx, c.tz, lm.offset) + (lm.turn ?? 0);
    const p = lm.abs ? { x: lm.abs.x, y: 0, z: lm.abs.z } : track.point(at, lm.offset);
    const r = modelRadius(model) * scale;
    // The lowest ground under its footprint: models carry a skirt below y = 0 to bury the difference.
    let y = env.groundAt(p.x, p.z);
    if (r > 3) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) y = Math.min(y, env.groundAt(p.x + dx * r * 0.6, p.z + dz * r * 0.6));
    }
    y += lm.lift ?? 0;
    const m = new Matrix4().compose(new Vector3(p.x, y - 0.05, p.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(scale, scale, scale));
    const e = m.elements;
    const map = ([x, yy, z]: V3): V3 => [
      e[0]! * x + e[4]! * yy + e[8]! * z + e[12]!,
      e[1]! * x + e[5]! * yy + e[9]! * z + e[13]!,
      e[2]! * x + e[6]! * yy + e[10]! * z + e[14]!,
    ];
    bake(chunk.lit, model.lit, map, model.smooth);
    if (model.glow) bake(chunk.glow, model.glow, map, model.smooth);
    if (model.glass) bake(chunk.glass, model.glass, map, model.smooth);
    for (const h of model.halos ?? []) {
      const w = map([h.x, h.y, h.z]);
      halos.push({ ...h, x: w[0], y: w[1], z: w[2], size: h.size * scale, phase: rnd() * 6.28 });
    }
    for (const part of model.moving ?? []) {
      const outer = new Group();
      outer.matrixAutoUpdate = false;
      const pm = m.clone().multiply(new Matrix4().makeTranslation(part.pivot[0], part.pivot[1], part.pivot[2]));
      outer.matrix.copy(pm);
      outer.matrixWorldNeedsUpdate = true;
      const inner = new Group();
      outer.add(inner);
      const shift = (b: MeshBuilder, material: Material) => {
        const g = new MeshBuilder();
        bake(g, b, ([x, yy, z]) => [x - part.pivot[0], yy - part.pivot[1], z - part.pivot[2]], model.smooth);
        const mesh = new Mesh(g.build(), material);
        disposables.push(mesh.geometry);
        inner.add(mesh);
      };
      if (part.lit && !part.lit.empty) shift(part.lit, mats.lit);
      if (part.glow && !part.glow.empty) shift(part.glow, mats.glow);
      if (part.glass && !part.glass.empty) shift(part.glass, mats.glass);
      group.add(outer);
      animated.push((t) => part.update(t, inner));
    }
    keepOut.push({ x: p.x, z: p.z, r: Math.max(spec.footprint ?? 0, r * 0.85) });
    // Its contact shadow: the footprint's ellipse, nudged away from the sun.
    {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let maxY = 0;
      const pp = model.lit.position;
      for (let i = 0; i < pp.length; i += 3) {
        minX = Math.min(minX, pp[i]!);
        maxX = Math.max(maxX, pp[i]!);
        minZ = Math.min(minZ, pp[i + 2]!);
        maxZ = Math.max(maxZ, pp[i + 2]!);
        maxY = Math.max(maxY, pp[i + 1]!);
      }
      if (Number.isFinite(minX) && r > 1.5 && !lm.abs && env.style.id !== "space") {
        const cxm = ((minX + maxX) / 2) * scale;
        const czm = ((minZ + maxZ) / 2) * scale;
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const reach = Math.min(maxY * scale * 0.22, r * 0.5);
        const hs = Math.hypot(sun.x, sun.z) || 1;
        blobs.push({
          x: p.x + cxm * cs + czm * sn - (sun.x / hs) * reach,
          y: y + 0.08,
          z: p.z - cxm * sn + czm * cs - (sun.z / hs) * reach,
          rx: Math.max(1.5, ((maxX - minX) / 2) * scale * 1.18),
          rz: Math.max(1.5, ((maxZ - minZ) / 2) * scale * 1.18),
          yaw,
          strength: Math.min(1, 0.55 + maxY * scale * 0.01),
        });
      }
    }
    count++;
  });

  for (const [key, chunk] of chunks) {
    for (const [builder, material, order] of [
      [chunk.lit, mats.lit, 0],
      [chunk.glow, mats.glow, 0],
      [chunk.glass, mats.glass, 3],
    ] as const) {
      if (builder.empty) continue;
      const geometry = builder.build();
      disposables.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      mesh.name = `landmarks-${key}`;
      group.add(mesh);
    }
  }

  // The contact shadows, one mesh: quads with the soft-blob texture.
  if (blobs.length && typeof document !== "undefined") {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    for (const b of blobs) {
      const cs = Math.cos(b.yaw);
      const sn = Math.sin(b.yaw);
      const corner = (u: number, v: number): [number, number, number] => [b.x + u * b.rx * cs + v * b.rz * sn, b.y, b.z - u * b.rx * sn + v * b.rz * cs];
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const t = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        pos.push(...q[idx]!);
        uv.push(t[idx]![0]!, t[idx]![1]!);
        col.push(b.strength, b.strength, b.strength);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const tex = glowTexture(0, 1.1);
    const mat = new MeshBasicMaterial({ map: tex, color: 0x070b18, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    disposables.push(g, tex, mat);
    const mesh = new Mesh(g, mat);
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // Halos: soft round lights standing in for bloom, twinkling.
  let points: Points | null = null;
  if (halos.length) {
    points = makePoints(halos.length, true);
    const pos = points.geometry.getAttribute("position");
    const col = points.geometry.getAttribute("aColour");
    const size = points.geometry.getAttribute("aSize");
    halos.forEach((h, i) => {
      pos.setXYZ(i, h.x, h.y, h.z);
      col.setXYZW(i, h.colour[0], h.colour[1], h.colour[2], h.alpha);
      size.setX(i, h.size);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
    group.add(points);
    const twinkly = halos.map((h, i) => ({ h, i })).filter(({ h }) => (h.twinkle ?? 0) > 0);
    if (twinkly.length) {
      animated.push((t) => {
        for (const { h, i } of twinkly) {
          const k = 1 - (h.twinkle ?? 0) * (0.5 + 0.5 * Math.sin(t * 3.1 + h.phase) * Math.sin(t * 1.7 + h.phase * 2));
          col.setW(i, h.alpha * k);
        }
        col.needsUpdate = true;
      });
    }
  }

  return {
    group,
    keepOut,
    roofs,
    count,
    update(time) {
      for (const f of animated) f(time);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      if (points) {
        points.geometry.dispose();
        (points.material as Material).dispose();
      }
      group.removeFromParent();
    },
  };
}

// ─── Hazards ─────────────────────────────────────────────────────────────────

interface Actor {
  def: HazardDef;
  model: HazardModel | null;
  body: Group;
  ground: Group;
  last: { x: number; z: number } | null;
  travel: number;
  near: number;
  state: HazardState;
  marker: Mesh | null;
  scale: number;
}

export interface HazardLayer {
  group: Group;
  /** Poses every hazard for race time `time` seconds. */
  update(time: number, dt: number): void;
  dispose(): void;
}

export function buildHazards(env: PlaceEnv, defs: readonly HazardDef[], mats: LandmarkMaterials, shadow: Texture): HazardLayer {
  const { track } = env;
  const group = new Group();
  const actors: Actor[] = [];
  const disposables: { dispose(): void }[] = [];
  const shadowGeo = new PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  disposables.push(shadowGeo);
  const markerGeo = new BufferGeometry();
  disposables.push(markerGeo);

  defs.forEach((def, index) => {
    const spec = HAZARDS[def.kind];
    const body = new Group();
    const ground = new Group();
    let model: HazardModel | null = null;
    let marker: Mesh | null = null;
    let scale = 1;
    if (spec) {
      model = spec.build({ rnd: seededRandom(500 + index * 131), theme: env.style.id, night: env.style.night, lit: mats.lit, glow: mats.glow });
      scale = def.radius / Math.max(0.05, model.radius);
      model.root.scale.setScalar(scale);
      body.add(model.root);
      model.root.traverse((o: Object3D) => {
        const g = (o as Mesh).geometry as BufferGeometry | undefined;
        if (g) disposables.push(g);
      });
    } else {
      // A name the picture does not know: a plain marker ball, so what hits a kart is still seen.
      const b = new MeshBuilder();
      b.blob(0, def.radius, 0, def.radius, def.radius, def.radius, [1.0, 0.35, 0.2], 1);
      const g = b.build();
      disposables.push(g);
      marker = new Mesh(g, mats.lit);
      body.add(marker);
    }
    const blob = new Mesh(shadowGeo, new MeshBasicMaterial({ map: shadow, color: 0x070b18, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    disposables.push(blob.material as Material);
    blob.scale.set(def.radius * 2.6, 1, def.radius * 2.6);
    blob.position.y = 0.07;
    blob.renderOrder = 2;
    ground.add(blob);
    group.add(ground, body);
    actors.push({
      def,
      model,
      body,
      ground,
      last: null,
      travel: 0,
      near: def.at * track.length,
      state: { time: 0, travel: 0, speed: 0, cycle: 0, height: 0, active: true, heading: 1 },
      marker,
      scale,
    });
  });

  return {
    group,
    update(time, dt) {
      for (const a of actors) {
        const pose = hazardAt(track, a.def, time);
        let proj = track.project(pose.x, pose.z, a.near);
        if (Math.hypot(proj.sample.x - pose.x, proj.sample.z - pose.z) > 60) proj = track.project(pose.x, pose.z);
        a.near = proj.s;
        const roadY = proj.sample.y + env.bank.lift(proj.s, proj.offset);
        // How far it has gone, for legs and wheels; a jump (a roll that starts over) does not count.
        let step = 0;
        if (a.last) {
          step = Math.hypot(pose.x - a.last.x, pose.z - a.last.z);
          if (step > 12) step = 0;
        }
        a.travel += step;
        a.last = { x: pose.x, z: pose.z };
        a.body.position.set(pose.x, roadY + pose.y, pose.z);
        a.body.rotation.y = pose.heading;
        a.ground.position.set(pose.x, roadY, pose.z);
        const sinC = Math.sin(pose.cycle * Math.PI * 2);
        const st = a.state;
        st.time = time;
        st.travel = a.travel;
        st.speed = dt > 1e-4 ? step / dt : 0;
        st.cycle = pose.cycle;
        st.height = pose.y;
        st.active = pose.active;
        st.heading = a.def.motion === "cross" && sinC < 0 ? -1 : 1;
        a.body.visible = pose.y > -a.def.radius * 3;
        // The blob under it fades as it rises or sinks.
        const blob = a.ground.children[0] as Mesh;
        (blob.material as MeshBasicMaterial).opacity = 0.5 * Math.max(0, 1 - Math.abs(pose.y) / (a.def.radius * 2.5)) * (pose.y < -a.def.radius ? 0 : 1);
        a.model?.update(st);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };
}

// ─── Small helpers shared with the rest of the world ─────────────────────────

/** The checked name of a hazard kind the picture can draw, for tests and the dev tracks. */
export const knownHazard = (kind: string): boolean => kind in HAZARDS;
export const knownLandmark = (kind: string): boolean => kind in LANDMARKS;
