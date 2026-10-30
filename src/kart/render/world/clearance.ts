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
import type { Features } from "./features";
import type { Terrain } from "./terrain";

/** Metres on a side of the buckets the centre line is filed in. */
const BUCKET = 16;

/** Within this many metres beyond a barrier `beyond` checks the terrain's grid against the road itself; farther out the grid is near enough. */
const NEAR = 40;

export class Clearance {
  /** Indices of the centre line's samples in each bucket. */
  private readonly buckets = new Map<number, number[]>();
  /** The farthest any barrier stands from the centre line (half the widest road and the widest verge). */
  readonly reach: number;
  private readonly track: TrackGeometry;
  private readonly features: Features;

  constructor(private readonly terrain: Terrain) {
    const track = (this.track = terrain.track);
    const features = (this.features = terrain.features);
    let reach = 0;
    track.samples.forEach((s, i) => {
      const key = this.key(Math.floor(s.x / BUCKET), Math.floor(s.z / BUCKET));
      const list = this.buckets.get(key);
      if (list) list.push(i);
      else this.buckets.set(key, [i]);
      reach = Math.max(reach, s.width / 2 + Math.max(features.wallLeft[i]!, features.wallRight[i]!));
    });
    this.reach = reach;
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

  private key(i: number, j: number): number {
    return i * 100003 + j;
  }

  /**
   * Metres beyond the barrier of the nearest point of a disk of radius `r` round (x, z): negative where any of it is
   * on the road or the verge inside the barrier. Looks no farther than `enough` metres beyond the barriers: a disk
   * farther out than that gets `enough`.
   */
  at(x: number, z: number, r = 0, enough = 40): number {
    const samples = this.track.samples;
    const n = samples.length;
    const look = enough + r + this.reach;
    let best = enough;
    const i0 = Math.floor((x - look) / BUCKET);
    const i1 = Math.floor((x + look) / BUCKET);
    const j0 = Math.floor((z - look) / BUCKET);
    const j1 = Math.floor((z + look) / BUCKET);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.buckets.get(this.key(i, j));
        if (!list) continue;
        for (const k of list) {
          // The stretch from this sample to the next.
          const a = samples[k]!;
          const b = samples[(k + 1) % n]!;
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          const len2 = ex * ex + ez * ez || 1;
          const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
          const dx = x - (a.x + ex * f);
          const dz = z - (a.z + ez * f);
          const d = Math.hypot(dx, dz);
          if (d - r - this.reach >= best) continue;
          // Which side of the stretch the disk is on (both, when it straddles the line through it).
          const len = Math.sqrt(len2);
          const lateral = (dx * -ez + dz * ex) / len;
          const left = Math.max(this.features.wallLeft[k]!, this.features.wallLeft[(k + 1) % n]!);
          const right = Math.max(this.features.wallRight[k]!, this.features.wallRight[(k + 1) % n]!);
          const wall = Math.abs(lateral) < r ? Math.max(left, right) : lateral > 0 ? right : left;
          const half = Math.max(a.width, b.width) / 2;
          best = Math.min(best, d - r - half - wall);
        }
      }
    }
    return best;
  }
}
