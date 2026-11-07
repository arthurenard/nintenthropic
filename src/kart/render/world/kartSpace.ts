/**
 * Where a kart can be, by the sim's own rule, for the tests that check what the world stands there (scenery.clear.test.ts,
 * clearance.test.ts): a point belongs to the nearest stretch of the centre line, and a kart can be there out to that
 * stretch's barrier on that side (or, at an open edge, to where it falls). Nothing here is the picture's own measure, so a
 * test can hold the picture to it. For tests only.
 */
import { barrierDistance, buildTerrain, isOpen, type Terrain as SimTerrain } from "../../sim/terrain";
import { TUNING } from "../../sim/tuning";
import type { TrackDef, TrackGeometry } from "../../track/geometry";

/** Metres on a side of the buckets the centre line is filed in. */
const BUCKET = 8;

export interface Place {
  /** Metres along the lap of the nearest point of the centre line. */
  s: number;
  /** Metres right of it (negative: left). */
  offset: number;
  /** Metres beyond the limit of where a kart can be: the barrier's face, or the fall at an open edge (negative inside). */
  past: number;
  /** True where the limit is a barrier (a camera's margin beyond it must be clear too). */
  walled: boolean;
  /** The road's height at the nearest point of the centre line. */
  roadY: number;
}

interface Road {
  geo: TrackGeometry;
  sim: SimTerrain;
  buckets: Map<number, number[]>;
}

export class KartSpace {
  /** The loop, then each branch road: a point belongs to the nearest centre line of any of them, as in the sim. */
  private readonly roads: Road[];
  /** The farthest from the centre line a kart can be, anywhere on the lap (half the widest road and the widest verge). */
  readonly reach: number;

  constructor(
    def: TrackDef,
    private readonly geo: TrackGeometry,
  ) {
    let reach = 0;
    this.roads = [geo, ...geo.routes].map((road) => {
      const sim = buildTerrain(road === geo ? def : road.def, road);
      const buckets = new Map<number, number[]>();
      road.samples.forEach((s, i) => {
        reach = Math.max(reach, s.width / 2 + Math.max(sim.barrierLeft[i]!, sim.barrierRight[i]!));
        const key = this.key(Math.floor(s.x / BUCKET), Math.floor(s.z / BUCKET));
        const list = buckets.get(key);
        if (list) list.push(i);
        else buckets.set(key, [i]);
      });
      return { geo: road, sim, buckets };
    });
    this.reach = reach;
  }

  private key(i: number, j: number): number {
    return i * 100003 + j;
  }

  /** Where (x, z) is, by the nearest stretch of road within `look` metres; null when there is none that near. */
  place(x: number, z: number, look: number): Place | null {
    let best: Place | null = null;
    let bestD = look * look;
    for (const road of this.roads) {
      const found = this.placeOn(road, x, z, bestD);
      if (found && found.d2 < bestD) {
        bestD = found.d2;
        best = found.place;
      }
    }
    return best;
  }

  private placeOn(road: Road, x: number, z: number, limit: number): { d2: number; place: Place } | null {
    const { geo, sim, buckets } = road;
    const samples = geo.samples;
    const n = samples.length;
    const look = Math.sqrt(limit);
    const ci = Math.floor(x / BUCKET);
    const cj = Math.floor(z / BUCKET);
    let best = limit;
    let bestK = -1;
    let bestF = 0;
    const rings = Math.ceil(look / BUCKET) + 1;
    for (let ring = 0; ring <= rings; ring++) {
      // Every bucket of this ring is at least (ring - 1) buckets away (less a metre: a stretch reaches a metre past its sample): past the best found, stop.
      if (ring > 1 && ((ring - 1) * BUCKET - 1) ** 2 > best) break;
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          const list = buckets.get(this.key(i, j));
          if (!list) continue;
          for (const k of list) {
            // The stretch from this sample to the next, and the one from the previous: a point's nearest may be on either.
            for (const a0 of geo.open ? [k, k - 1] : [k, (k - 1 + n) % n]) {
              if (a0 < 0 || (geo.open && a0 >= n - 1)) continue;
              const a = samples[a0]!;
              const b = samples[(a0 + 1) % n]!;
              const ex = b.x - a.x;
              const ez = b.z - a.z;
              const len2 = ex * ex + ez * ez || 1;
              const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
              const d = (x - a.x - ex * f) ** 2 + (z - a.z - ez * f) ** 2;
              if (d < best) {
                best = d;
                bestK = a0;
                bestF = f;
              }
            }
          }
        }
      }
    }
    if (bestK < 0) return null;
    const c = geo.at(samples[bestK]!.s + bestF * geo.spacing);
    const offset = (x - c.x) * -c.tz + (z - c.z) * c.tx;
    const side = offset > 0 ? 1 : -1;
    const open = isOpen(sim, c.s, side);
    const limitOut = open ? TUNING.fall.edge + 0.5 : barrierDistance(sim, c.s, side);
    return { d2: best, place: { s: c.s, offset, past: Math.abs(offset) - c.width / 2 - limitOut, walled: !open, roadY: c.y } };
  }
}
