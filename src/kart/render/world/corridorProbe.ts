/**
 * Measures what the picture puts where the sim lets a kart (or the camera behind it) be: the drivable area of a track,
 * sampled every couple of metres, against the ground, landmarks and scenery the world builds. corridor.test.ts and
 * corridor.art.test.ts assert on it.
 */
import { Group, Matrix4, Mesh, MeshLambertMaterial, Vector3, type BufferGeometry, type InstancedMesh, type Object3D } from "three";
import { barrierDistance, buildTerrain as buildSimTerrain, gapAt, isOpen, type Terrain as SimTerrain } from "../../sim/terrain";
import { TUNING } from "../../sim/tuning";
import { TrackGeometry, type Landmark, type TrackDef } from "../../track/geometry";
import { QUALITY, type Tier } from "../quality";
import { buildBackdrop } from "./backdrop";
import { Bank } from "./bank";
import { SOLID_MARGIN } from "./features";
import { buildFoliage, foliageBounds } from "./foliage";
import { buildLandmarks, landmarkMaterials, type PlaceEnv, type PlacedLandmark } from "./landmarks/place";
import { buildScenery } from "./scenery";
import { buildTrackMeshes } from "./track";
import { makeBakeUniforms } from "./shading";
import { Terrain } from "./terrain";
import { styleFor, type ThemeStyle } from "./themes";

/** What a kart (or its camera) can meet: nothing may stand between these heights above the road. */
const BAND: [number, number] = [0.45, 5];

/** A thing must reach this far into the margin (metres) to count: one that only touches its outer edge is not in the way. */
const MIN_DEPTH = 0.25;

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
  /** Away from the road, across it (a unit vector on the ground): a point near the spot is `beyond` plus its step this way. */
  ox: number;
  oz: number;
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
        spots.push({ x, z, y, ref: Math.max(y, groundAt(x, z)), s: p.s, beyond, side: pSide, reach, margin: beyond > pWall, ox: -pSide * p.sample.tz, oz: pSide * p.sample.tx });
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
  /** Metres beyond the road's edge of what was hit, when it is not the spot's own (a wall passing beside it). */
  beyond?: number;
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

/** How close (metres, across the ground) a steep surface must pass to a spot to be in its way: the spots are 1 m apart along and 0.5 m across. */
const WALL_REACH = 0.5;
/** A triangle steeper than this (its shadow on the ground under this share of its area, about 60 degrees) is also walked over, point by point. */
const STEEP = 0.5;
/** The step of that walk, metres. */
const WALL_STEP = 0.35;

/**
 * Drops each triangle of `root`'s meshes onto the spots under it: wherever it covers one in the band, the lowest such surface is
 * noted. A steep triangle (a wall, a hull's side, a post) covers next to nothing seen from above, so it is also walked over and
 * noted at every spot it passes within WALL_REACH of, in the band: a solid whose roof is above the band and whose floor is below
 * the road (a ship's hull across the road) is caught by its sides. `skip` leaves out what is meant to be there (the barrier's own
 * picture, a ramp's wedge).
 */
export function dropOnto(root: Object3D, grid: SpotGrid, who: string, lowest: Map<number, Hit>, skip?: (spot: Spot) => boolean): void {
  root.updateMatrixWorld(true);
  const note = (k: number, y: number, beyond?: number) => {
    if (y < BAND[0] || y > BAND[1]) return;
    const old = lowest.get(k);
    if (!old || y < old.low) lowest.set(k, beyond === undefined ? { low: y, who } : { low: y, who, beyond });
  };
  const ab = new Vector3();
  const ac = new Vector3();
  const walk = (a: Vector3, b: Vector3, c: Vector3, x0: number, z0: number, x1: number, z1: number) => {
    let near = false;
    grid.box(x0 - WALL_REACH, z0 - WALL_REACH, x1 + WALL_REACH, z1 + WALL_REACH, () => (near = true));
    if (!near) return;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const nb = Math.max(1, Math.ceil(ab.length() / WALL_STEP));
    const nc = Math.max(1, Math.ceil(ac.length() / WALL_STEP));
    for (let i = 0; i <= nb; i++) {
      for (let j = 0; j <= nc; j++) {
        const u = i / nb;
        const v = j / nc;
        if (u + v > 1) break;
        const x = a.x + ab.x * u + ac.x * v;
        const y = a.y + ab.y * u + ac.y * v;
        const z = a.z + ab.z * u + ac.z * v;
        grid.box(x - WALL_REACH, z - WALL_REACH, x + WALL_REACH, z + WALL_REACH, (k) => {
          const p = grid.spots[k]!;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 > WALL_REACH ** 2) return;
          // Where the wall itself is, across the road: past the margin's end it is not in the way, whichever spot it passes,
          // and what is meant to be there is asked about where the wall stands, not where the spot does.
          const beyond = p.beyond + (x - p.x) * p.ox + (z - p.z) * p.oz;
          if (beyond > p.reach || skip?.({ ...p, beyond })) return;
          note(k, y - p.ref, beyond);
        });
      }
    }
  };
  const place = (geometry: BufferGeometry, world: Matrix4) => {
    eachTriangle(geometry, world, (a, b, c) => {
      const x0 = Math.min(a.x, b.x, c.x);
      const x1 = Math.max(a.x, b.x, c.x);
      const z0 = Math.min(a.z, b.z, c.z);
      const z1 = Math.max(a.z, b.z, c.z);
      if (!Number.isFinite(x0 + x1 + z0 + z1)) return;
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      // Twice the triangle's area (det is twice its shadow's, signed).
      const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length();
      if (Math.abs(det) < STEEP * area) walk(a, b, c, x0, z0, x1, z1);
      if (Math.abs(det) < 1e-9) return;
      grid.box(x0, z0, x1, z1, (k) => {
        const p = grid.spots[k]!;
        if (skip?.(p)) return;
        const u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / det;
        const v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / det;
        const w = 1 - u - v;
        if (u < -0.02 || v < -0.02 || w < -0.02) return;
        note(k, u * a.y + v * b.y + w * c.y - p.ref);
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
  /** Span landmarks the world had to cut to keep them out of another stretch's ground (see place.ts): a modelled one should need none. */
  cuts: string[];
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

/** How densely the drivable area is sampled: every `along` metres of the lap, every `across` metres across it. */
export interface Density {
  along: number;
  across: number;
}

export function makeProbe(def: TrackDef, density: Density = { along: 2, across: 1 }, tier: Tier = "high"): Probe {
  const geo = TrackGeometry.build(def);
  const bank = new Bank(geo);
  const style = styleFor(def.theme);
  const terrain = Terrain.build(geo, style, QUALITY[tier].cell);
  const sim = buildSimTerrain(def, geo);
  const spots = drivableSpots(def, geo, bank, (x, z) => terrain.heightAt(x, z), density.along, density.across);
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

/**
 * The clock times, seconds, at which what turns (a windmill's sails, a wheel, a carousel's roof) is looked at: its sweep, not
 * only its pose at the start. Not a round step, so a part that turns a whole number of times a second is not always caught
 * in the same place.
 */
export const CLOCK: readonly number[] = Array.from({ length: 24 }, (_, k) => k * 0.83);

/** The pieces of a layer that move (a part is its own Group; what stands still is merged into meshes). */
const movingOf = (group: Group): Object3D[] => group.children.filter((c) => c instanceof Group);

/** Drops a landmark layer's picture: all of it as it stands at the start, then only what moves, at each clock time. */
function dropLayer(layer: { group: Group; update(time: number): void }, grid: SpotGrid, who: string, lowest: Map<number, Hit>): void {
  layer.update(0);
  dropOnto(layer.group, grid, who, lowest);
  const moving = movingOf(layer.group);
  if (!moving.length) return;
  for (const t of CLOCK.slice(1)) {
    layer.update(t);
    for (const part of moving) dropOnto(part, grid, who, lowest);
  }
}

function worstOf(probe: Probe, lowest: Map<number, Hit>): Map<string, Offender> {
  const byWho = new Map<string, Offender>();
  for (const [k, hit] of lowest) {
    const p = probe.spots[k]!;
    const beyond = hit.beyond ?? p.beyond;
    const depth = p.reach - beyond;
    const old = byWho.get(hit.who);
    if (!old || depth > old.depth) byWho.set(hit.who, { what: hit.who, at: [p.x, p.z], s: p.s, beyond, height: hit.low, depth });
  }
  return byWho;
}

/**
 * What the track's own decoration (the start gantry, signs, lamps, ramps, the open edges' shelves...) puts where a kart's centre
 * can be, one offender for each stretch of 12 m. The barrier is meant to be there (it stands from the kart's reach outward) and so
 * is a ramp's wedge on the road; everything else is not.
 */
function decorationOffenders(probe: Probe, material: MeshLambertMaterial, tier: Tier): Offender[] {
  const { geo, terrain, sim } = probe;
  const meshes = buildTrackMeshes(geo, probe.style, terrain, QUALITY[tier]);
  const group = new Group();
  for (const g of meshes.deco) group.add(new Mesh(g, material));
  const lowest = new Map<number, Hit>();
  const ramps = terrain.features.ramps;
  const onRamp = (s: number): boolean =>
    ramps.some((r) => {
      let d = r.lip - s;
      if (d > geo.length / 2) d -= geo.length;
      if (d < -geo.length / 2) d += geo.length;
      return d > -2 && d < r.length + 2;
    });
  dropOnto(group, probe.grid, "decoration", lowest, (p) => {
    // The barrier's own picture: it stands from the face of the wall outward, and a soft one (a snowbank, a boulder) leans in a
    // little past the limit of a kart's centre (the wall less TUNING.barrierInset).
    if (p.beyond >= barrierDistance(sim, p.s, p.side) - TUNING.barrierInset - 0.7) return true;
    return p.beyond < 0 && onRamp(p.s);
  });
  for (const g of [...meshes.deco, ...meshes.road, ...meshes.verge, meshes.pads, meshes.pools, meshes.additive, ...meshes.patches.map((q) => q.geometry)]) g?.dispose();
  const found = new Map<string, Offender>();
  for (const [k, hit] of lowest) {
    const p = probe.spots[k]!;
    const beyond = hit.beyond ?? p.beyond;
    const depth = p.reach - beyond;
    // The start line's own: the gantry's legs and light box stand at s = 0.
    const gantry = Math.min(p.s, geo.length - p.s) < 8;
    const key = gantry ? `gantry${p.side}` : `${p.side}:${Math.round(p.s / 12)}`;
    const old = found.get(key);
    if (!old || depth > old.depth) {
      found.set(key, { what: `${gantry ? "start gantry" : "decoration"} (${p.side < 0 ? "left" : "right"} of the road)`, at: [p.x, p.z], s: p.s, beyond, height: hit.low, depth });
    }
  }
  return [...found.values()];
}

/**
 * What `measureTrack` builds: the quality tier (the ground's grid and the scenery's share), and whether the landmarks and the
 * track's decoration are measured (they do not change with the tier).
 */
export interface Measure {
  tier?: Tier;
  things?: boolean;
}

/** Measures one track: what the picture puts in the drivable area. */
export function measureTrack(def: TrackDef, { tier = "high", things = true }: Measure = {}): Report {
  const quality = QUALITY[tier];
  // Finer than the default, so a pole or a post cannot fall between two samples.
  const probe = makeProbe(def, { along: 1, across: 0.5 }, tier);
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
        // Measured from the road's edge there (lift holds the edge's height beyond it): on a banked bend it is not the centre line's.
        const road = p.sample.y + probe.bank.lift(p.s, p.offset);
        if (terrain.heightAt(x, z) - road > 2) {
          if (!flank || past < flank.beyond) flank = { what: "first flank", s: p.s, beyond: past, height: terrain.heightAt(x, z) - road, depth: -past };
          break;
        }
      }
    }
  }

  const lowest = new Map<number, Hit>();
  const cuts: string[] = [];
  const mats = landmarkMaterials();
  const placed = placedLandmarks(def);
  const keepOut = buildLandmarks(probe.env, placed, mats).keepOut;
  // One by one, so a hit has a name.
  if (things) {
    placed.forEach((lm: Landmark, k) => {
      const layer = buildLandmarks(probe.env, [lm], mats);
      dropLayer(layer, probe.grid, `${lm.kind}#${k}@${lm.at}`, lowest);
      if (layer.cuts > 0) cuts.push(`${lm.kind}#${k}@${lm.at}: ${layer.cuts} triangles cut away where it stands in another stretch's ground`);
      layer.dispose();
    });
  }
  mats.dispose();
  const material = new MeshLambertMaterial({ vertexColors: true });
  const scenery = buildScenery(probe.style, terrain, quality, material, 1234, keepOut);
  let n = 0;
  scenery.group.children.forEach((child) => dropOnto(child, probe.grid, `scenery#${n++}`, lowest));
  // What turns in the scenery (a modelled windmill's sails) is looked at as it sweeps.
  const turning = movingOf(scenery.group);
  if (turning.length) {
    for (const t of CLOCK.slice(1)) {
      scenery.update(t);
      for (const part of turning) dropOnto(part, probe.grid, `scenery#${scenery.group.children.indexOf(part)}`, lowest);
    }
  }
  scenery.dispose();
  // The tufts and flowers beyond the barrier: grass a metre tall is not for the road or the verge either (in the camera's
  // margin it may grow: a camera passes through grass).
  const foliage = buildFoliage(probe.style, terrain, quality, makeBakeUniforms(), keepOut, foliageBounds(geo.samples));
  if (foliage) {
    dropOnto(foliage.group, probe.grid, "foliage", lowest, (p) => p.margin);
    foliage.dispose();
  }
  // The volcano's great cone is the one backdrop that can come near the road (the others build from textures, and stand far off).
  if (things && probe.style.id === "volcano") {
    const own: { dispose(): void }[] = [];
    const backdrop = buildBackdrop(probe.style, terrain, own, makeBakeUniforms());
    if (backdrop) dropOnto(backdrop.group, probe.grid, "backdrop", lowest);
    backdrop?.dispose();
    for (const d of own) d.dispose();
  }

  // A thing that only touches the margin's outer edge (a quarter metre in) is not an offender: the margin is a rule of thumb.
  const solids = [...worstOf(probe, lowest).values(), ...(things ? decorationOffenders(probe, material, tier) : [])].filter((o) => o.depth >= MIN_DEPTH).sort((a, b) => b.depth - a.depth);
  material.dispose();
  return { groundRise: rise, flank, solids, cuts };
}
