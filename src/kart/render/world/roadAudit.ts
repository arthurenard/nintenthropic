/**
 * Measures the drawn road against itself and against what the sim lets a kart drive on, for roads.test.ts. It builds a
 * track's meshes the way the world does (the loop and every branch road), then walks the triangles of the road ribbon, the
 * verge and the track's decoration:
 *
 * - holes: a place a kart can stand (the road, and the verge out to the barrier) that has no drawn surface under it;
 * - steps: a place two drawn road surfaces lie over one another at different heights (a branch that leaves or joins the road
 *   a little above or below it, a quad that folds back over its neighbour), which shows as a crack, a step or flicker;
 * - phantoms: drawn road where the sim has a gap in the road;
 * - ground: a drawn road surface that sits higher or lower than the height the sim puts a kart at there.
 *
 * Everything is sampled every metre along each road and half a metre across it.
 */
import type { BufferGeometry } from "three";
import { barrierDistance, buildTerrain, gapAt, isOpen, type Terrain as SimTerrain } from "../../sim/terrain";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { QUALITY, type Tier } from "../quality";
import { Bank } from "./bank";
import { eachTriangle } from "./corridorProbe";
import { Terrain } from "./terrain";
import { styleFor } from "./themes";
import { buildTrackMeshes, type TrackMeshes } from "./track";
import { Matrix4 } from "three";

/** One drawn triangle that faces up, with the road it was drawn for. */
interface Tri {
  road: number;
  kind: "road" | "verge" | "deco";
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
}

/** Where a defect is, so a failing test says it. */
export interface Defect {
  road: number;
  s: number;
  offset: number;
  x: number;
  z: number;
  /** How bad, metres (a step's height, a mismatch). */
  size: number;
}

const worse = (a: Defect | null, b: Defect): Defect => (a && a.size >= b.size ? a : b);

export interface RoadAudit {
  id: string;
  /** Spots a kart can stand on road (inside the road's own width) with nothing drawn within reach under them. */
  roadHoles: number;
  roadHole: Defect | null;
  /** Spots on the verge, between the road's edge and the barrier (or the open edge's shelf), with nothing drawn there. */
  vergeHoles: number;
  vergeHole: Defect | null;
  /** Road spots where two road surfaces overlap at different heights (by more than 3 cm): ... */
  steps: number;
  /** Road spots where one road lies over its own inside edge (a bend tighter than its half width) at a different height. */
  selfOverlaps: number;
  stepsBy: Record<string, { n: number; worst: Defect | null }>;
  /** Overlap spots by how big the step is: over 10 cm, over 25 cm, over 50 cm. */
  stepSizes: [number, number, number];
  /** The tightest bend against the road's width: the worst of |curvature| x half width over the samples (1 or more: the inside edge folds). */
  pinch: Defect | null;
  /** ...the worst of them. */
  step: Defect | null;
  /** Road triangles drawn where the sim has a gap in the road. */
  phantoms: number;
  phantom: Defect | null;
  /** Spots in the sim's gaps that the road is drawn under, in the road's own ribbon. */
  /** The drawn road's height against the sim's (centre line plus the bank's lift), at road spots with no ramp wedge. */
  groundMiss: number;
  groundMisses: Defect | null;
  /** Between consecutive samples of one road: the biggest jump of an edge's height over a metre (a crack's lip). */
  edgeStep: Defect | null;
  /** The road's sections that fold: consecutive samples whose tangents turn back (more than 90 degrees). */
  folds: number;
  /** Sample spots over a sim gap that the picture also leaves open, and the ones it does not (should be 0). */
  gapAgreement: { sim: number; picture: number };
  /** Kart-reachable edge spots (inside the barrier's reach) on a side that the sim leaves with no barrier at all. */
  openEdgeSpots: number;
}

const CELL = 2;

/** A hash of triangles by 2 m cell of their (x, z) box. */
class TriGrid {
  private readonly cells = new Map<number, Tri[]>();
  add(t: Tri): void {
    const x0 = Math.floor(Math.min(t.ax, t.bx, t.cx) / CELL);
    const x1 = Math.floor(Math.max(t.ax, t.bx, t.cx) / CELL);
    const z0 = Math.floor(Math.min(t.az, t.bz, t.cz) / CELL);
    const z1 = Math.floor(Math.max(t.az, t.bz, t.cz) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i * 100003 + j;
        const list = this.cells.get(k);
        if (list) list.push(t);
        else this.cells.set(k, [t]);
      }
    }
  }
  /** Every triangle covering (x, z), with the height of its plane there. */
  at(x: number, z: number, visit: (t: Tri, y: number) => void): void {
    const list = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!list) return;
    for (const t of list) {
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
      const v = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
      const w = 1 - u - v;
      const e = -1e-4;
      if (u < e || v < e || w < e) continue;
      visit(t, u * t.ay + v * t.by + w * t.cy);
    }
  }
}

function collect(grid: TriGrid, geometry: BufferGeometry, road: number, kind: Tri["kind"]): void {
  const id = new Matrix4();
  eachTriangle(geometry, id, (a, b, c) => {
    // Faces up only: the cliffs, walls and undersides are not a surface a kart can stand on.
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || Math.abs(ny) / len < 0.5) return;
    grid.add({ road, kind, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z });
  });
}

/** Reads a road's own mesh groups into the grid. */
function load(grid: TriGrid, meshes: TrackMeshes, road: number): void {
  for (const g of meshes.road) collect(grid, g, road, "road");
  for (const g of meshes.verge) collect(grid, g, road, "verge");
  for (const g of meshes.deco) collect(grid, g, road, "deco");
}

/** Every drawn up-facing surface over (x, z) (for looking into a defect). */
export function surfacesAt(def: TrackDef, points: [number, number][], tier: Tier = "high"): string[] {
  const { grid } = buildGrid(def, tier);
  return points.map(([x, z]) => {
    const found: string[] = [];
    grid.at(x, z, (t, y) => found.push(`${t.kind}${t.road}@${y.toFixed(2)}`));
    return `(${x},${z}): ${found.join(" ")}`;
  });
}

function buildGrid(def: TrackDef, tier: Tier) {
  const geo = TrackGeometry.build(def);
  const style = styleFor(def.theme);
  const quality = QUALITY[tier];
  const terrain = Terrain.build(geo, style, quality.cell);
  const roads: TrackGeometry[] = [geo, ...geo.routes];
  const grid = new TriGrid();
  const built = roads.map((road, r) => buildTrackMeshes(road, style, terrain, quality, 64, r === 0 ? undefined : terrain.routeFeatures[r - 1]));
  built.forEach((m, r) => load(grid, m, r));
  return { geo, style, quality, terrain, roads, grid, built };
}

export function auditRoads(def: TrackDef, tier: Tier = "high"): RoadAudit {
  const { geo, roads, grid, built } = buildGrid(def, tier);
  const sims: SimTerrain[] = roads.map((road) => buildTerrain(road === geo ? def : road.def, road));
  const banks = roads.map((road) => Bank.of(road));

  const out: RoadAudit = {
    id: def.id,
    roadHoles: 0,
    roadHole: null,
    vergeHoles: 0,
    vergeHole: null,
    steps: 0,
    stepsBy: {},
    selfOverlaps: 0,
    pinch: null,
    stepSizes: [0, 0, 0],
    step: null,
    phantoms: 0,
    phantom: null,
    groundMiss: 0,
    groundMisses: null,
    edgeStep: null,
    folds: 0,
    gapAgreement: { sim: 0, picture: 0 },
    openEdgeSpots: 0,
  };

  roads.forEach((road, r) => {
    const sim = sims[r]!;
    const bank = banks[r]!;
    const n = road.samples.length;
    const features = built[r]!.features;
    // Each sample of the road and the next: the ribbon's edges must run on without a jump.
    for (let i = 0; i + 1 < n; i++) {
      const a = road.samples[i]!;
      const b = road.samples[i + 1]!;
      if (a.tx * b.tx + a.tz * b.tz < 0) out.folds++;
      out.pinch = worse(out.pinch, { road: r, s: a.s, offset: 0, x: a.x, z: a.z, size: Math.abs(a.curvature) * (a.width / 2) });
      if (features.gap[i] || features.gap[i + 1]) continue;
      for (const side of [-1, 1]) {
        const ya = a.y + bank.liftAt(i, side * a.width / 2);
        const yb = b.y + bank.liftAt(i + 1, side * b.width / 2);
        const d: Defect = { road: r, s: a.s, offset: (side * a.width) / 2, x: a.x, z: a.z, size: Math.abs(yb - ya) };
        out.edgeStep = worse(out.edgeStep, d);
      }
    }

    for (let i = 0; i < n; i++) {
      const c = road.samples[i]!;
      const half = c.width / 2;
      const inGap = gapAt(sim, c.s) !== null;
      // The picture's gap and the sim's must be the same stretch.
      const pictureGap = features.gap[i] === 1;
      if (inGap) out.gapAgreement.sim++;
      if (pictureGap) out.gapAgreement.picture++;
      for (const side of [-1, 1] as const) {
        const open = isOpen(sim, c.s, side);
        const wall = open ? 0 : barrierDistance(sim, c.s, side);
        if (open) out.openEdgeSpots++;
        // Out across the road, and the verge to the barrier (or an open edge's: 0.8 m of shelf only).
        const reach = half + (open ? 0.8 : wall - 0.8);
        for (let o = side > 0 ? 0 : 0.5; o <= reach; o += 0.5) {
          const lat = side * o;
          const x = c.x - c.tz * lat;
          const z = c.z + c.tx * lat;
          const onRoad = o <= half - 0.05;
          const want = c.y + bank.lift(c.s, lat);
          if (inGap) {
            // Only the road's own ribbon counts: another road may lie across a gap.
            if (o > half || o < 0.5) continue;
            if (i < 1 || i > n - 2 || gapAt(sim, road.samples[i - 1]!.s) === null || gapAt(sim, road.samples[i + 1]!.s) === null) continue;
            grid.at(x, z, (t, y) => {
              if (t.kind !== "road" || t.road !== r) return;
              out.phantoms++;
              out.phantom = worse(out.phantom, { road: r, s: c.s, offset: lat, x, z, size: Math.abs(y - want) });
            });
            continue;
          }
          let covered = false;
          let road0 = 0;
          let lowest = Infinity;
          let top = -Infinity;
          grid.at(x, z, (t, y) => {
            // A surface the kart could stand on: at its height, or up a ramp's wedge, or a hair under it.
            if (y < want - 0.35 || y > want + 3.2) return;
            covered = true;
            if (t.kind === "road") {
              road0++;
              lowest = Math.min(lowest, y);
              top = Math.max(top, y);
            }
          });
          const d: Defect = { road: r, s: c.s, offset: lat, x, z, size: 1 };
          if (!covered) {
            if (onRoad) {
              out.roadHoles++;
              out.roadHole = worse(out.roadHole, d);
            } else {
              out.vergeHoles++;
              out.vergeHole = worse(out.vergeHole, d);
            }
          }
          if (onRoad && road0 > 0) {
            // How the drawn road differs from where the sim stands a kart (a ramp's wedge rises: only a lower surface counts).
            const miss = Math.max(0, want - top, lowest - want > 0.3 ? lowest - want : 0);
            if (miss > 0.12) {
              out.groundMiss++;
              out.groundMisses = worse(out.groundMisses, { ...d, size: miss });
            }
          }
          if (onRoad) {
            // Two road surfaces at once that differ in height: a step, or flicker.
            const ys: { y: number; road: number }[] = [];
            grid.at(x, z, (t, y) => {
              if (t.kind === "road" && y > want - 1.5 && y < want + 1.5) ys.push({ y, road: t.road });
            });
            // Between two roads only: a road folding over its own inside edge in a bend tighter than its width is the pinch's.
            let spread = 0;
            for (const p of ys) for (const q of ys) if (p.road !== q.road) spread = Math.max(spread, Math.abs(p.y - q.y));
            let own = 0;
            for (const p of ys) for (const q of ys) if (p.road === q.road) own = Math.max(own, Math.abs(p.y - q.y));
            if (own > 0.03) out.selfOverlaps++;
            if (spread > 0.03) {
              out.steps++;
              if (spread > 0.1) out.stepSizes[0]++;
              if (spread > 0.25) out.stepSizes[1]++;
              if (spread > 0.5) out.stepSizes[2]++;
              out.step = worse(out.step, { ...d, size: spread });
              const kinds = [...new Set(ys.map((p) => p.road))].sort().join("+");
              const bucket = `${r}:${kinds}`;
              const cur = out.stepsBy[bucket] ?? { n: 0, worst: null };
              cur.n++;
              cur.worst = worse(cur.worst, { ...d, size: spread });
              out.stepsBy[bucket] = cur;
            }
          }
        }
      }
    }
  });
  return out;
}

export function summarise(a: RoadAudit): string {
  const at = (d: Defect | null) => (d ? `road${d.road} s=${d.s.toFixed(0)} off=${d.offset.toFixed(1)} (${d.x.toFixed(0)},${d.z.toFixed(0)}) ${d.size.toFixed(2)}m` : "-");
  return [
    `${a.id}: roadHoles ${a.roadHoles} [${at(a.roadHole)}]`,
    `vergeHoles ${a.vergeHoles} [${at(a.vergeHole)}]`,
    `steps ${a.steps} >10cm ${a.stepSizes[0]} >25cm ${a.stepSizes[1]} >50cm ${a.stepSizes[2]} [${at(a.step)}]`,
    ...Object.entries(a.stepsBy).map(([k, v]) => `  steps ${k}: ${v.n} worst ${at(v.worst)}`),
    `phantoms ${a.phantoms} [${at(a.phantom)}]`,
    `groundMiss ${a.groundMiss} [${at(a.groundMisses)}]`,
    `edgeStep [${at(a.edgeStep)}]`,
    `folds ${a.folds} selfOverlaps ${a.selfOverlaps} pinch [${at(a.pinch)}]`,
    `gaps sim ${a.gapAgreement.sim} picture ${a.gapAgreement.picture}`,
    `openEdge ${a.openEdgeSpots}`,
  ].join("\n   ");
}
