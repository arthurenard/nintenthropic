/**
 * How far a point (or a round footprint) stands beyond the sim's barrier, worked out from the road itself.
 *
 * The terrain keeps, at each vertex of its grid, how far beyond the road's edge the vertex is and where the barrier
 * stands there, and interpolates between vertices (Terrain.clearAt). That is good to about a cell where the barrier
 * keeps its usual 6 m, and wrong by as much as a verge is wide where the barrier jumps between two vertices: at the
 * end of a hairpin's cut the grid called ground 13 m inside the barrier 3 to 5 m clear of it, so scenery placed by
 * the grid alone could stand in the cut, where karts drive.
 *
 * Here every stretch of road keeps its own ground. A point is as far beyond the barrier as the least, over the
 * stretches of centre line near it, of its distance from the stretch less the road's half width and the barrier on
 * the point's side of it (the farther of the stretch's two ends). The sim measures from the nearest stretch alone, so
 * this is never more than the sim's measure: what is clear here is clear in the race.
 */
import type { TrackGeometry } from "../../track/geometry";
import { WALL_DISTANCE, type Features } from "./features";
import type { Terrain } from "./terrain";

/** Metres on a side of the buckets the centre line is filed in. */
const BUCKET = 16;

/** Within this many metres beyond a barrier `beyond` checks the terrain's grid against the road itself; farther out the grid is near enough. */
const NEAR = 40;

/** What `at` keeps of the centre line's buckets: the stretches that start in one, and the most any of them can matter from afar. */
interface Bucket {
  stretches: Int32Array;
  /** The largest, over its stretches, of `limit` (below). */
  reach: number;
}

export class Clearance {
  /** The buckets in a grid from (`i0`, `j0`), `ni` by `nj`; undefined where no sample of the centre line falls. */
  private readonly buckets: (Bucket | undefined)[] = [];
  private readonly i0: number;
  private readonly j0: number;
  private readonly ni: number;
  private readonly nj: number;
  /** The farthest any barrier stands from the centre line (half the widest road and the widest verge). */
  readonly reach: number;
  /**
   * Each stretch of the centre line, from sample k to the next, as `at` measures it, worked out once: where it starts and
   * which way it runs, its length, the barriers beside it, half its width, and `limit`, the most that its half width and its
   * barrier can take off a distance (never more than `reach`): a stretch farther than that cannot make a point nearer.
   */
  private readonly ax: Float64Array;
  private readonly az: Float64Array;
  private readonly ex: Float64Array;
  private readonly ez: Float64Array;
  private readonly len2: Float64Array;
  private readonly len: Float64Array;
  private readonly left: Float64Array;
  private readonly right: Float64Array;
  private readonly half: Float64Array;
  private readonly limit: Float64Array;
  /** The longest stretch: how far one reaches from the bucket its first sample is in. */
  private readonly slack: number;

  constructor(private readonly terrain: Terrain) {
    const track = terrain.track;
    // The loop, then each branch road (alternate routes): every stretch of every road is filed, and a point is measured from the least.
    const roads = [
      { samples: track.samples, features: terrain.features, open: false },
      ...track.routes.map((road, r) => ({ samples: road.samples, features: terrain.routeFeatures[r]!, open: true })),
    ];
    const total = roads.reduce((sum, road) => sum + road.samples.length, 0);
    this.ax = new Float64Array(total);
    this.az = new Float64Array(total);
    this.ex = new Float64Array(total);
    this.ez = new Float64Array(total);
    this.len2 = new Float64Array(total);
    this.len = new Float64Array(total);
    this.left = new Float64Array(total);
    this.right = new Float64Array(total);
    this.half = new Float64Array(total);
    this.limit = new Float64Array(total);
    let reach = 0;
    let longest = 0;
    let minI = Infinity;
    let maxI = -Infinity;
    let minJ = Infinity;
    let maxJ = -Infinity;
    for (const road of roads) {
      road.samples.forEach((s, i) => {
        reach = Math.max(reach, s.width / 2 + Math.max(WALL_DISTANCE, road.features.wallLeft[i]!, road.features.wallRight[i]!));
        minI = Math.min(minI, Math.floor(s.x / BUCKET));
        maxI = Math.max(maxI, Math.floor(s.x / BUCKET));
        minJ = Math.min(minJ, Math.floor(s.z / BUCKET));
        maxJ = Math.max(maxJ, Math.floor(s.z / BUCKET));
      });
    }
    this.reach = reach;
    const filed: { k: number; x: number; z: number }[] = [];
    let base = 0;
    for (const road of roads) {
      const samples = road.samples;
      const n = samples.length;
      const features = road.features;
      // A branch road is open at its ends: no stretch closes it.
      const stretches = road.open ? n - 1 : n;
      for (let i = 0; i < stretches; i++) {
        const k = base + i;
        const a = samples[i]!;
        const b = samples[(i + 1) % n]!;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        this.ax[k] = a.x;
        this.az[k] = a.z;
        this.ex[k] = ex;
        this.ez[k] = ez;
        this.len2[k] = ex * ex + ez * ez || 1;
        this.len[k] = Math.sqrt(this.len2[k]!);
        // The barrier stands at least its usual six metres out, as far as the scenery's concerned: over a drop it is a rail at the
        // road's edge, and a tree or a tuft still stays where it always did, clear of the deck.
        this.left[k] = Math.max(WALL_DISTANCE, features.wallLeft[i]!, features.wallLeft[(i + 1) % n]!);
        this.right[k] = Math.max(WALL_DISTANCE, features.wallRight[i]!, features.wallRight[(i + 1) % n]!);
        this.half[k] = Math.max(a.width, b.width) / 2;
        this.limit[k] = Math.min(reach, this.half[k]! + Math.max(this.left[k]!, this.right[k]!));
        longest = Math.max(longest, this.len[k]!);
        filed.push({ k, x: a.x, z: a.z });
      }
      base += n;
    }
    this.slack = longest + 1e-6;
    this.i0 = minI;
    this.j0 = minJ;
    this.ni = maxI - minI + 1;
    this.nj = maxJ - minJ + 1;
    const lists: number[][] = [];
    for (const f of filed) {
      const at = (Math.floor(f.x / BUCKET) - minI) * this.nj + (Math.floor(f.z / BUCKET) - minJ);
      (lists[at] ??= []).push(f.k);
    }
    lists.forEach((list, at) => {
      this.buckets[at] = { stretches: Int32Array.from(list), reach: Math.max(...list.map((k) => this.limit[k]!)) };
    });
  }

  /**
   * How far beyond the barrier a point is, for scattering things (negative inside it). The terrain's grid is good to a few
   * tenths of a metre where the barrier keeps to one distance, and is kept there, so a scatter stays as it was; where the
   * road's own measure says nearer (the end of a verge, where the grid is out by the verge's width) that wins.
   */
  beyond(x: number, z: number): number {
    const grid = this.terrain.clearAt(x, z);
    if (grid >= NEAR) return grid;
    return Math.min(grid, this.at(x, z, 0, grid) + 0.5);
  }

  /**
   * Metres beyond the barrier of the nearest point of a disk of radius `r` round (x, z): negative where any of it is
   * on the road or the verge inside the barrier. Looks no farther than `enough` metres beyond the barriers: a disk
   * farther out than that gets `enough`.
   *
   * It looks at the stretches of the centre line near it in the order they are filed, and takes the least. A stretch that
   * cannot make that least smaller is passed over without working out its distance (a bucket of them by its square, one by
   * its squared distance), which leaves what is found as it was.
   */
  at(x: number, z: number, r = 0, enough = 40): number {
    const look = enough + r + this.reach;
    let best = enough;
    const i0 = Math.max(this.i0, Math.floor((x - look) / BUCKET));
    const i1 = Math.min(this.i0 + this.ni - 1, Math.floor((x + look) / BUCKET));
    const j0 = Math.max(this.j0, Math.floor((z - look) / BUCKET));
    const j1 = Math.min(this.j0 + this.nj - 1, Math.floor((z + look) / BUCKET));
    for (let i = i0; i <= i1; i++) {
      // How far this column of buckets is from the point, across.
      const colX = i * BUCKET;
      const gx = x < colX ? colX - x : x > colX + BUCKET ? x - colX - BUCKET : 0;
      for (let j = j0; j <= j1; j++) {
        const bucket = this.buckets[(i - this.i0) * this.nj + (j - this.j0)];
        if (!bucket) continue;
        const rowZ = j * BUCKET;
        const gz = z < rowZ ? rowZ - z : z > rowZ + BUCKET ? z - rowZ - BUCKET : 0;
        // Every stretch that starts in this bucket is within `slack` of its square, so none is nearer than this.
        const gap = Math.sqrt(gx * gx + gz * gz) - this.slack;
        if (gap > best + r + bucket.reach + 1e-6) continue;
        const list = bucket.stretches;
        for (let q = 0; q < list.length; q++) {
          const k = list[q]!;
          // The stretch from this sample to the next.
          const ax = this.ax[k]!;
          const az = this.az[k]!;
          const ex = this.ex[k]!;
          const ez = this.ez[k]!;
          const f = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / this.len2[k]!));
          const dx = x - (ax + ex * f);
          const dz = z - (az + ez * f);
          const limit = this.limit[k]!;
          // Too far for its distance to matter: skipped by the squares, with room to spare for the rounding of the exact test.
          const near = best + r + limit;
          if (near > 0 && dx * dx + dz * dz > near * near * 1.000001 + 1e-6) continue;
          const d = Math.hypot(dx, dz);
          if (d - r - this.reach >= best || d - r - limit >= best + 1e-9) continue;
          // Which side of the stretch the disk is on (both, when it straddles the line through it).
          const lateral = (dx * -ez + dz * ex) / this.len[k]!;
          const left = this.left[k]!;
          const right = this.right[k]!;
          const wall = Math.abs(lateral) < r ? Math.max(left, right) : lateral > 0 ? right : left;
          best = Math.min(best, d - r - this.half[k]! - wall);
        }
      }
    }
    return best;
  }
}
