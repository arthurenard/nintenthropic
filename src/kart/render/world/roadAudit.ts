/**
 * Measures the drawn road against itself and against what the sim lets a kart drive on, for roads.test.ts. It builds a
 * track's meshes the way the world does (the loop and every branch road), then looks at the triangles of the road ribbon, the
 * verge, the shelves, rails and ramps (the track's decoration) and the space road's light:
 *
 * - holes: a place a kart can stand (the road, and out to the barrier over the verge or the shelf) that has no drawn surface
 *   under it, and cracks in the road's top along its own length, at a gap's ends and between two roads;
 * - steps: a place two drawn road surfaces lie over one another at different heights (a branch that leaves or joins the road a
 *   little above or below it), which shows as a ledge or as two textures fighting;
 * - phantoms: road drawn where the sim has a gap in the road, and gap ends that lie more than a metre from the sim's;
 * - ground: a drawn road surface that is not at the height the sim's road and the banking put a kart at;
 * - folds: a bend tighter than the road is wide, whose inside edge crosses back over the road;
 * - rails: where the sim has a drop beside the road it has a rail at the edge (its barrier), and the picture draws one there.
 *
 * Each is sampled every half metre across the road and every metre along it (a quarter metre along at a gap's ends).
 */
import { Matrix4, type BufferGeometry } from "three";
import { barrierDistance, buildTerrain, gapAt, isOpen, type Terrain as SimTerrain } from "../../sim/terrain";
import { TUNING } from "../../sim/tuning";
import { RAIL_GAP } from "../../track/edges";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { QUALITY, type Tier } from "../quality";
import { Bank } from "./bank";
import { eachTriangle } from "./corridorProbe";
import { Terrain } from "./terrain";
import { styleFor } from "./themes";
import { buildTrackMeshes, type TrackMeshes } from "./track";

/** One drawn triangle that faces up, with the road it was drawn for. */
interface Tri {
  road: number;
  kind: "road" | "other";
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
  /** How bad, metres (a step's height, a mismatch), or 1 for a hole. */
  size: number;
}

const worse = (a: Defect | null, b: Defect): Defect => (a && a.size >= b.size ? a : b);

export interface RoadAudit {
  id: string;
  /** Spots a kart can stand on the road (inside its width) with no surface drawn under them. */
  roadHoles: number;
  roadHole: Defect | null;
  /** Where those holes are: road, side, metre along, offset (capped). */
  holeList: string[];
  /** The longest stretch of the road, metres, that has verge holes all along it: a hole a sample or two long is a gap's or a verge's end. */
  vergeRun: number;
  /** Spots a kart can stand on beyond the road's edge, out to the barrier, with no surface drawn under them. */
  vergeHoles: number;
  vergeHole: Defect | null;
  /** Spots on the road's top where two roads' surfaces lie over one another at different heights (over 8 cm). */
  steps: number;
  step: Defect | null;
  /** Spots of road drawn in a gap of the sim's, and the farthest a drawn road's end lies from the sim's gap end, metres. */
  phantoms: number;
  phantom: Defect | null;
  gapEnd: Defect | null;
  /** Samples the sim says are in a gap, and the picture says are. */
  gapSim: number;
  gapPicture: number;
  /** Spots where the drawn road is not at the sim's height plus the banking's lift (over 12 cm). */
  groundMiss: number;
  groundMisses: Defect | null;
  /** The biggest jump of a road's edge height between consecutive sections (metres over about one metre). */
  edgeStep: Defect | null;
  /** The tightest bend against the road's width: |curvature| x half the width (1 or more: the inside edge folds back). */
  pinch: Defect | null;
  /** Consecutive sections whose directions turn back on one another. */
  folds: number;
  /** Samples with a drop beside the road, a rail over it in the sim (its barrier within the rail's gap), and one drawn there. */
  dropSpots: number;
  railsInSim: number;
  railsDrawn: number;
  /** How many of them were looked for (every third sample). */
  railsChecked: number;
  railMissing: Defect | null;
  /** Samples where the sim leaves an edge with nothing to stop a kart outside a gap (must be none). */
  openEdgeSpots: number;
}

/** Two road surfaces over one another closer in height than this are not a step the eye finds (metres). */
const STEP = 0.08;

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

/** A hash of the corners of every triangle (of any facing), to find what stands near a point. */
class VertexGrid {
  private readonly cells = new Map<number, [number, number, number][]>();
  add(x: number, y: number, z: number): void {
    const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    const list = this.cells.get(k);
    if (list) list.push([x, y, z]);
    else this.cells.set(k, [[x, y, z]]);
  }
  /** Is there a corner within `radius` metres of (x, z) (plan) between heights `lo` and `hi`? */
  near(x: number, z: number, radius: number, lo: number, hi: number): boolean {
    for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++) {
      for (let j = Math.floor((z - radius) / CELL); j <= Math.floor((z + radius) / CELL); j++) {
        for (const p of this.cells.get(i * 100003 + j) ?? []) if (Math.hypot(p[0] - x, p[2] - z) <= radius && p[1] >= lo && p[1] <= hi) return true;
      }
    }
    return false;
  }
}

const IDENTITY = new Matrix4();

function collect(grid: TriGrid, geometry: BufferGeometry, road: number, kind: Tri["kind"], corners?: VertexGrid, twoSided = false): void {
  eachTriangle(geometry, IDENTITY, (a, b, c) => {
    corners?.add(a.x, a.y, a.z);
    corners?.add(b.x, b.y, b.z);
    corners?.add(c.x, c.y, c.z);
    // Faces up only: the cliffs, walls and undersides are not a surface a kart can stand on. (The light of the space road is drawn
    // both ways round: it counts either way.)
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || (twoSided ? Math.abs(ny) : ny) / len < 0.5) return;
    grid.add({ road, kind, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z });
  });
}

function build(def: TrackDef, tier: Tier) {
  const geo = TrackGeometry.build(def);
  const style = styleFor(def.theme);
  const quality = QUALITY[tier];
  const terrain = Terrain.build(geo, style, quality.cell);
  const roads: TrackGeometry[] = [geo, ...geo.routes];
  const grid = new TriGrid();
  const corners = new VertexGrid();
  const built: TrackMeshes[] = roads.map((road, r) => buildTrackMeshes(road, style, terrain, quality, 64, r === 0 ? undefined : terrain.routeFeatures[r - 1]));
  built.forEach((m, r) => {
    for (const g of m.road) collect(grid, g, r, "road");
    for (const g of [...m.verge, ...m.deco]) collect(grid, g, r, "other");
    if (m.additive) collect(grid, m.additive, r, "other", undefined, true);
    for (const g of m.deco) {
      eachTriangle(g, IDENTITY, (a, b, c) => {
        for (const p of [a, b, c]) corners.add(p.x, p.y, p.z);
      });
    }
    for (const g of m.additive ? [m.additive] : []) {
      eachTriangle(g, IDENTITY, (a, b, c) => {
        for (const p of [a, b, c]) corners.add(p.x, p.y, p.z);
      });
    }
  });
  return { geo, style, quality, terrain, roads, grid, corners, built };
}

/** Every drawn up-facing surface over (x, z), for looking into a defect. */
export function surfacesAt(def: TrackDef, points: [number, number][], tier: Tier = "high"): string[] {
  const { grid } = build(def, tier);
  return points.map(([x, z]) => {
    const found: string[] = [];
    grid.at(x, z, (t, y) => found.push(`${t.kind}${t.road}@${y.toFixed(2)}`));
    return `(${x},${z}): ${found.join(" ")}`;
  });
}

export function auditRoads(def: TrackDef, tier: Tier = "high"): RoadAudit {
  const { geo, roads, grid, corners, built } = build(def, tier);
  const sims: SimTerrain[] = roads.map((road) => buildTerrain(road === geo ? def : road.def, road));
  const banks = roads.map((road) => Bank.of(road));
  const out: RoadAudit = {
    id: def.id,
    roadHoles: 0,
    roadHole: null,
    vergeHoles: 0,
    holeList: [],
    vergeRun: 0,
    vergeHole: null,
    steps: 0,
    step: null,
    phantoms: 0,
    phantom: null,
    gapEnd: null,
    gapSim: 0,
    gapPicture: 0,
    groundMiss: 0,
    groundMisses: null,
    edgeStep: null,
    pinch: null,
    folds: 0,
    dropSpots: 0,
    railsInSim: 0,
    railsDrawn: 0,
    railsChecked: 0,
    railMissing: null,
    openEdgeSpots: 0,
  };

  const holeColumns = new Set<string>();
  roads.forEach((road, r) => {
    const sim = sims[r]!;
    const bank = banks[r]!;
    const features = built[r]!.features;
    const n = road.samples.length;

    // Section by section: the ribbon must run on without a jump, a fold or a kink.
    for (let i = 0; i + 1 < n; i++) {
      const a = road.samples[i]!;
      const b = road.samples[i + 1]!;
      if (a.tx * b.tx + a.tz * b.tz < 0) out.folds++;
      out.pinch = worse(out.pinch, { road: r, s: a.s, offset: 0, x: a.x, z: a.z, size: Math.abs(a.curvature) * (a.width / 2) });
      if (features.gap[i] || features.gap[i + 1]) continue;
      for (const side of [-1, 1]) {
        const ya = a.y + bank.liftAt(i, (side * a.width) / 2);
        const yb = b.y + bank.liftAt(i + 1, (side * b.width) / 2);
        out.edgeStep = worse(out.edgeStep, { road: r, s: a.s, offset: (side * a.width) / 2, x: a.x, z: a.z, size: Math.abs(yb - ya) });
      }
    }

    for (let i = 0; i < n; i++) {
      const c = road.samples[i]!;
      if (gapAt(sim, c.s) !== null) out.gapSim++;
      if (features.gap[i] === 1) out.gapPicture++;
    }

    // Where the road is drawn along its middle, a quarter metre at a time: the cracks in its top, and where it ends at a gap.
    const first = road.open ? road.origin : 0;
    const span = road.open ? (road as unknown as { span: number }).span : road.length;
    const along = (s: number): number => (road.open ? s : road.wrap(s));
    const drawn = (x: number, z: number, y: number): boolean => {
      let found = false;
      grid.at(x, z, (t, yy) => {
        if (t.kind === "road" && Math.abs(yy - y) < 0.35) found = true;
      });
      return found;
    };
    let lastDrawn: boolean | null = null;
    let lastS = 0;
    for (let d = 0; d <= span; d += 0.25) {
      const s = along(first + d);
      const c = road.at(s);
      const here = drawn(c.x, c.z, c.y + bank.lift(s, 0));
      const inGap = gapAt(sim, s) !== null;
      if (inGap && here) {
        out.phantoms++;
        out.phantom = worse(out.phantom, { road: r, s, offset: 0, x: c.x, z: c.z, size: 1 });
      }
      if (lastDrawn !== null && here !== lastDrawn) {
        // The drawn road starts or stops here: it must be where the sim's gap starts or stops (to a metre), and only there.
        const edge = (s + lastS) / 2;
        const gaps = sim.gaps.map((g) => Math.min(Math.abs(road.delta(edge, g.from)), Math.abs(road.delta(edge, g.to))));
        const off = gaps.length ? Math.min(...gaps) : Infinity;
        if (off > 1) out.gapEnd = worse(out.gapEnd, { road: r, s: edge, offset: 0, x: c.x, z: c.z, size: off });
      }
      lastDrawn = here;
      lastS = s;
    }

    // Across the road and out to the barrier, every metre along it.
    for (let i = 0; i < n; i++) {
      const c = road.samples[i]!;
      const half = c.width / 2;
      const inGap = gapAt(sim, c.s) !== null;
      for (const side of [-1, 1] as const) {
        const open = isOpen(sim, c.s, side);
        if (open && !inGap) out.openEdgeSpots++;
        const wall = barrierDistance(sim, c.s, side);
        // A kart's centre can be out to the barrier's face less its inset; at a gap there is no road to stand on.
        const reach = half + Math.max(0, wall - TUNING.barrierInset);
        if (inGap) continue;
        for (let o = side > 0 ? 0 : 0.5; o <= reach; o += 0.5) {
          const lat = side * o;
          const x = c.x - c.tz * lat;
          const z = c.z + c.tx * lat;
          const onRoad = o <= half - 0.05;
          // Where another road is nearer (a branch beside the loop, where their barriers open to one another) the sim holds a kart by that
          // road, and its surface is the one under it.
          if (roads.length > 1 && o > half && geo.project(x, z, undefined, r).route !== r) continue;
          const want = c.y + bank.lift(c.s, lat);
          let covered = false;
          let top = -Infinity;
          let lowest = Infinity;
          const ys: { y: number; road: number }[] = [];
          grid.at(x, z, (t, y) => {
            // A surface a kart could stand on: at its height, or up a ramp's wedge.
            if (y < want - 0.35 || y > want + 3.2) return;
            covered = true;
            if (t.kind === "road") {
              top = Math.max(top, y);
              lowest = Math.min(lowest, y);
              if (y > want - 1.5 && y < want + 1.5) ys.push({ y, road: t.road });
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
              if (out.holeList.length < 400) out.holeList.push(`${r}:${c.s.toFixed(0)}:${lat.toFixed(1)}`);
              holeColumns.add(`${r}:${side}:${i}`);
            }
          }
          if (!onRoad) continue;
          if (top > -Infinity) {
            // The drawn road against the sim's height and the banking (a ramp's wedge only raises it).
            const miss = Math.max(0, want - top, lowest - want > 0.3 ? lowest - want : 0);
            if (miss > 0.12) {
              out.groundMiss++;
              out.groundMisses = worse(out.groundMisses, { ...d, size: miss });
            }
          }
          let spread = 0;
          for (const p of ys) for (const q of ys) if (p.road !== q.road) spread = Math.max(spread, Math.abs(p.y - q.y));
          if (spread > STEP) {
            out.steps++;
            out.step = worse(out.step, { ...d, size: spread });
          }
        }
        // A drop beside the road has a rail at its edge, in the sim and in the picture.
        const drop = (side < 0 ? sim.openLeft : sim.openRight)[i] === 1;
        const rail = (side < 0 ? sim.railLeft : sim.railRight)[i]!;
        if (drop && rail >= 0.99) {
          out.dropSpots++;
          if (wall <= RAIL_GAP + 0.01) out.railsInSim++;
          // Drawn: some part of the barrier stands within a metre or two of the rail's line, a little above the deck. (A rail where
          // another road lies across the way is left to that road's own barrier.)
          if (i % 3 === 0 && !features.hiddenLeft[i] && !features.hiddenRight[i]) {
            const lat = side * (half + wall + 0.5);
            const x = c.x - c.tz * lat;
            const z = c.z + c.tx * lat;
            const y = c.y + bank.liftAt(i, side * half);
            out.railsChecked++;
            if (corners.near(x, z, 1.6, y - 0.4, y + 3)) out.railsDrawn++;
            else out.railMissing = worse(out.railMissing, { road: r, s: c.s, offset: lat, x, z, size: 1 });
          }
        }
      }
    }
  });
  // The longest run of consecutive samples with a hole in them, on one side of one road.
  for (const key of holeColumns) {
    const [r, side, i] = key.split(":");
    if (holeColumns.has(`${r}:${side}:${Number(i) - 1}`)) continue;
    let run = 1;
    while (holeColumns.has(`${r}:${side}:${Number(i) + run}`)) run++;
    out.vergeRun = Math.max(out.vergeRun, run);
  }
  return out;
}

export function summarise(a: RoadAudit): string {
  const at = (d: Defect | null) => (d ? `road${d.road} s=${d.s.toFixed(0)} off=${d.offset.toFixed(1)} (${d.x.toFixed(0)},${d.z.toFixed(0)}) ${d.size.toFixed(2)}` : "-");
  return [
    `${a.id}: roadHoles ${a.roadHoles} [${at(a.roadHole)}] vergeHoles ${a.vergeHoles} (longest run ${a.vergeRun} m) [${at(a.vergeHole)}]`,
    `   steps ${a.steps} [${at(a.step)}] groundMiss ${a.groundMiss} [${at(a.groundMisses)}] edgeStep [${at(a.edgeStep)}]`,
    `   phantoms ${a.phantoms} [${at(a.phantom)}] gapEnd [${at(a.gapEnd)}] gaps sim ${a.gapSim} picture ${a.gapPicture}`,
    `   pinch [${at(a.pinch)}] folds ${a.folds} openEdges ${a.openEdgeSpots}`,
    `   rails: drop spots ${a.dropSpots} in sim ${a.railsInSim} drawn ${a.railsDrawn} (of ${a.railsChecked} checked) missing [${at(a.railMissing)}]`,
  ].join("\n");
}
