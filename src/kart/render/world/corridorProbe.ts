/**
 * Measures what the picture puts where the sim lets a kart (or the camera behind it) be: the drivable area of a track,
 * sampled every couple of metres, against the ground, landmarks and scenery the world builds. corridor.test.ts asserts
 * on it; the same machinery can score where a landmark could stand instead.
 */
import { Matrix4, MeshLambertMaterial, Vector3, type BufferGeometry, type InstancedMesh, type Mesh, type Object3D } from "three";
import { barrierDistance, buildTerrain as buildSimTerrain, gapAt, isOpen, type Terrain as SimTerrain } from "../../sim/terrain";
import { TUNING } from "../../sim/tuning";
import { TrackGeometry, type Landmark, type TrackDef } from "../../track/geometry";
import { QUALITY } from "../quality";
import { buildBackdrop } from "./backdrop";
import { Bank } from "./bank";
import { SOLID_MARGIN } from "./features";
import { buildLandmarks, landmarkMaterials, type LandmarkMaterials, type PlaceEnv, type PlacedLandmark } from "./landmarks/place";
import { buildScenery } from "./scenery";
import { makeBakeUniforms } from "./shading";
import { Terrain } from "./terrain";
import { styleFor, type ThemeStyle } from "./themes";

const quality = QUALITY.high;

/** What a kart (or its camera) can meet: nothing may stand between these heights above the road. */
const BAND: [number, number] = [0.45, 5];

/** One place a kart (or the camera behind it) can be: where, how high the road is there, and which way it is from the road. */
export interface Spot {
  x: number;
  z: number;
  /** The road's surface here (banking included). */
  y: number;
  /** What a solid thing must stand above to count: the road, or the ground where it rises past the road (a hill is the ground's business, not a prop's). */
  ref: number;
  s: number;
  /** Metres beyond the road's edge (negative on the road). */
  beyond: number;
  side: -1 | 1;
  /** Metres beyond the road's edge where the margin ends: the barrier's face plus the camera's width (an open edge: the fall). */
  reach: number;
  /** True past the barrier, in the camera's margin: the ground need not be flat there, but nothing solid may stand. */
  margin: boolean;
}

/**
 * The drivable area: every `along` metres of the lap, across from the left barrier to the right one, and the margin beyond.
 * Each point is placed as the sim places a kart there: by the nearest stretch of road, whose barrier is the limit (so a
 * cut across a hairpin's inside is the two legs' ground, meeting where each is the nearer).
 */
export function drivableSpots(def: TrackDef, geo: TrackGeometry, bank: Bank, groundAt: (x: number, z: number) => number, along = 2, across = 1): Spot[] {
  const sim = buildSimTerrain(def, geo);
  const spots: Spot[] = [];
  const step = Math.max(1, Math.round(along / geo.spacing));
  for (let i = 0; i < geo.samples.length; i += step) {
    const c = geo.samples[i]!;
    const half = c.width / 2;
    for (const side of [-1, 1] as const) {
      const open = isOpen(sim, c.s, side);
      const wall = open ? TUNING.fall.edge + 0.5 : barrierDistance(sim, c.s, side);
      for (let o = side > 0 ? 0 : across; o <= half + wall + (open ? 0 : SOLID_MARGIN); o += across) {
        const lat = side * o;
        const x = c.x - c.tz * lat;
        const z = c.z + c.tx * lat;
        const p = geo.project(x, z);
        const pSide = p.offset > 0 ? 1 : -1;
        const pOpen = isOpen(sim, p.s, pSide);
        const pWall = pOpen ? TUNING.fall.edge + 0.5 : barrierDistance(sim, p.s, pSide);
        const beyond = Math.abs(p.offset) - p.sample.width / 2;
        const reach = pWall + (pOpen ? 0 : SOLID_MARGIN);
        // Out of the nearest road's own corridor: not a place a kart can be.
        if (beyond > reach) continue;
        const y = p.sample.y + bank.lift(p.s, p.offset);
        spots.push({ x, z, y, ref: Math.max(y, groundAt(x, z)), s: p.s, beyond, side: pSide, reach, margin: beyond > pWall });
      }
    }
  }
  return spots;
}

/** A hash of the spots by 2 m cell, so a triangle finds the ones under it. */
export class SpotGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(
    readonly spots: readonly Spot[],
    private readonly cell = 2,
  ) {
    spots.forEach((p, k) => {
      const key = this.key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      const list = this.cells.get(key);
      if (list) list.push(k);
      else this.cells.set(key, [k]);
    });
  }
  private key(i: number, j: number): number {
    return i * 100003 + j;
  }
  /** Calls `visit` with every spot whose cell the box touches. */
  box(x0: number, z0: number, x1: number, z1: number, visit: (k: number) => void): void {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const k of list) visit(k);
      }
    }
  }
}

/** The lowest surface over a spot that lies in the band a kart (or its camera) would meet, and whose it is. */
export interface Hit {
  low: number;
  who: string;
}

/** Feeds every triangle of a mesh, in world space, to `tri`. */
export function eachTriangle(geometry: BufferGeometry, world: Matrix4, tri: (a: Vector3, b: Vector3, c: Vector3) => void): void {
  const pos = geometry.getAttribute("position");
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t + 2 < count; t += 3) {
    a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(world);
    b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(world);
    c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(world);
    tri(a, b, c);
  }
}

/** Drops each triangle of `root`'s meshes onto the spots under it: wherever it covers one in the band, the lowest such surface is noted. */
export function dropOnto(root: Object3D, grid: SpotGrid, who: string, lowest: Map<number, Hit>): void {
  root.updateMatrixWorld(true);
  const place = (geometry: BufferGeometry, world: Matrix4) => {
    eachTriangle(geometry, world, (a, b, c) => {
      const x0 = Math.min(a.x, b.x, c.x);
      const x1 = Math.max(a.x, b.x, c.x);
      const z0 = Math.min(a.z, b.z, c.z);
      const z1 = Math.max(a.z, b.z, c.z);
      if (!Number.isFinite(x0 + x1 + z0 + z1)) return;
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-9) return;
      grid.box(x0, z0, x1, z1, (k) => {
        const p = grid.spots[k]!;
        const u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / det;
        const v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / det;
        const w = 1 - u - v;
        if (u < -0.02 || v < -0.02 || w < -0.02) return;
        const y = u * a.y + v * b.y + w * c.y - p.ref;
        if (y < BAND[0] || y > BAND[1]) return;
        const old = lowest.get(k);
        if (!old || y < old.low) lowest.set(k, { low: y, who });
      });
    });
  };
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry) return;
    if ((m as unknown as InstancedMesh).isInstancedMesh) {
      const im = m as unknown as InstancedMesh;
      const inst = new Matrix4();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, inst);
        place(im.geometry, inst.premultiply(im.matrixWorld));
      }
    } else {
      place(m.geometry, m.matrixWorld);
    }
  });
}

export interface Offender {
  what: string;
  /** Where in the world the worst spot is. */
  at?: [number, number];
  s: number;
  /** Metres beyond the road's edge (negative over the road). */
  beyond: number;
  /** Metres above the road. */
  height: number;
  /** How far it would have to move out to clear the barrier and the camera's margin. */
  depth: number;
}

export interface Report {
  /** The highest the ground rises above the road inside the drivable area. */
  groundRise: Offender | null;
  /** The first flank (ground 2 m above the road) nearest to the barrier: `beyond` is metres past its face. */
  flank: Offender | null;
  /** Solid things standing in the drivable area or its margin, worst first (one per thing). */
  solids: Offender[];
}

/** A track built the way the game builds it, with its drivable area, ready to have things dropped onto. */
export interface Probe {
  def: TrackDef;
  geo: TrackGeometry;
  bank: Bank;
  style: ThemeStyle;
  terrain: Terrain;
  sim: SimTerrain;
  spots: Spot[];
  grid: SpotGrid;
  env: PlaceEnv;
}

export function makeProbe(def: TrackDef): Probe {
  const geo = TrackGeometry.build(def);
  const bank = new Bank(geo);
  const style = styleFor(def.theme);
  const terrain = Terrain.build(geo, style, quality.cell);
  const sim = buildSimTerrain(def, geo);
  const spots = drivableSpots(def, geo, bank, (x, z) => terrain.heightAt(x, z));
  const wall = (s: number, side: -1 | 1) => barrierDistance(sim, s, side);
  const env: PlaceEnv = { track: geo, style, bank, groundAt: (x: number, z: number) => terrain.heightAt(x, z), wall };
  return { def, geo, bank, style, terrain, sim, spots, grid: new SpotGrid(spots), env };
}

/** The landmarks of a track as the world places them: its list and the duck. */
export function placedLandmarks(def: TrackDef): PlacedLandmark[] {
  const placed: PlacedLandmark[] = [...(def.landmarks ?? [])];
  if (def.duck) placed.push({ kind: "rubber-duck", at: def.duck.at, offset: def.duck.offset, lift: def.duck.y ?? 0 });
  return placed;
}

/** What one landmark puts in the drivable area (its worst spot), or null if it is clear of it. */
export function landmarkOffender(probe: Probe, lm: PlacedLandmark, mats: LandmarkMaterials, who = lm.kind): Offender | null {
  const lowest = new Map<number, Hit>();
  const layer = buildLandmarks(probe.env, [lm], mats);
  layer.update(0);
  dropOnto(layer.group, probe.grid, who, lowest);
  layer.dispose();
  return worstOf(probe, lowest).get(who) ?? null;
}

function worstOf(probe: Probe, lowest: Map<number, Hit>): Map<string, Offender> {
  const byWho = new Map<string, Offender>();
  for (const [k, hit] of lowest) {
    const p = probe.spots[k]!;
    const depth = p.reach - p.beyond;
    const old = byWho.get(hit.who);
    if (!old || depth > old.depth) byWho.set(hit.who, { what: hit.who, at: [p.x, p.z], s: p.s, beyond: p.beyond, height: hit.low, depth });
  }
  return byWho;
}

/** Measures one track: what the picture puts in the drivable area. */
export function measureTrack(def: TrackDef): Report {
  const probe = makeProbe(def);
  const { geo, terrain, sim, spots } = probe;

  let rise: Offender | null = null;
  for (const p of spots) {
    if (p.margin) continue;
    const dy = terrain.heightAt(p.x, p.z) - p.y;
    if (!rise || dy > rise.height) rise = { what: "ground", s: p.s, beyond: p.beyond, height: dy, depth: 0 };
  }

  // Going out from the road across the drivable area and past the barrier: where is the first ground 2 m above the road there?
  let flank: Offender | null = null;
  for (let i = 0; i < geo.samples.length; i += 2) {
    const c = geo.samples[i]!;
    for (const side of [-1, 1] as const) {
      if (isOpen(sim, c.s, side) || gapAt(sim, c.s)) continue;
      for (let e = 0; e < 200; e += 1) {
        const lat = side * (c.width / 2 + e);
        const x = c.x - c.tz * lat;
        const z = c.z + c.tx * lat;
        const p = geo.project(x, z);
        const pSide = p.offset > 0 ? 1 : -1;
        const past = Math.abs(p.offset) - p.sample.width / 2 - barrierDistance(sim, p.s, pSide);
        if (past < 0 || isOpen(sim, p.s, pSide)) continue;
        if (terrain.heightAt(x, z) - p.sample.y > 2) {
          if (!flank || past < flank.beyond) flank = { what: "first flank", s: p.s, beyond: past, height: terrain.heightAt(x, z) - p.sample.y, depth: -past };
          break;
        }
      }
    }
  }

  const lowest = new Map<number, Hit>();
  const mats = landmarkMaterials();
  const placed = placedLandmarks(def);
  const keepOut = buildLandmarks(probe.env, placed, mats).keepOut;
  // One by one, so a hit has a name.
  placed.forEach((lm: Landmark, k) => {
    const layer = buildLandmarks(probe.env, [lm], mats);
    layer.update(0);
    dropOnto(layer.group, probe.grid, `${lm.kind}#${k}@${lm.at}`, lowest);
    layer.dispose();
  });
  mats.dispose();
  const material = new MeshLambertMaterial({ vertexColors: true });
  const scenery = buildScenery(probe.style, terrain, quality, material, 1234, keepOut);
  let n = 0;
  scenery.group.children.forEach((child) => dropOnto(child, probe.grid, `scenery#${n++}`, lowest));
  scenery.dispose();
  material.dispose();
  // The volcano's great cone is the one backdrop that can come near the road (the others build from textures, and stand far off).
  if (probe.style.id === "volcano") {
    const own: { dispose(): void }[] = [];
    const backdrop = buildBackdrop(probe.style, terrain, own, makeBakeUniforms());
    if (backdrop) dropOnto(backdrop.group, probe.grid, "backdrop", lowest);
    backdrop?.dispose();
    for (const d of own) d.dispose();
  }

  const solids =[...worstOf(probe, lowest).values()].sort((a, b) => b.depth - a.depth);
  return { groundRise: rise, flank, solids };
}
