/**
 * Where a road's edge stands over a drop (a bridge, a quay, a trestle, the lip of a gap), as the sim and the picture both
 * read it: a rail stands there, `RAIL_GAP` metres beyond the road's edge, so nobody goes over by accident. Only a gap in the
 * road itself (a jump the track makes) has nothing to stop a kart, and the sim says a kart that is in one falls.
 *
 * The edge closes in over about ten metres, not in one step: the barrier eases from where it usually stands to the rail,
 * and the picture's cliff opens along with it. Both are worked out here, once per road, so they cannot drift apart.
 */
import { inStretch, type TrackGeometry } from "./geometry";

/** Metres beyond the road's edge where the rail's inner face stands over a drop (a kart's centre may go to this less the sim's barrier inset). */
export const RAIL_GAP = 1.8;

/** Metres either side over which the edge opens and closes. */
const EASE = 5;

export interface RoadEdges {
  /** Per sample: 1 where this side has a drop beside it (a rail over it, or no road at all in a gap). */
  dropLeft: Uint8Array;
  dropRight: Uint8Array;
  /** The same eased over `EASE` metres either side, 0..1: how far the rail has come in, and the cliff opened. */
  railLeft: Float32Array;
  railRight: Float32Array;
  /** Per sample: 1 where the road itself is missing (a gap to jump). */
  gap: Uint8Array;
}

/** Box-blurs an array over `reach` samples either side (a loop wraps; a branch road clamps at its ends). */
function blur(a: Uint8Array, reach: number, open: boolean): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) sum += a[open ? Math.max(0, Math.min(n - 1, i + k)) : (i + k + n) % n]!;
    out[i] = sum / (reach * 2 + 1);
  }
  return out;
}

const known = new WeakMap<TrackGeometry, RoadEdges>();

export function edgesOf(geo: TrackGeometry): RoadEdges {
  const cached = known.get(geo);
  if (cached) return cached;
  const n = geo.samples.length;
  const dropLeft = new Uint8Array(n);
  const dropRight = new Uint8Array(n);
  const gap = new Uint8Array(n);
  for (const drop of geo.def.drops ?? []) {
    for (let i = 0; i < n; i++) {
      if (!inStretch(geo.samples[i]!.s / geo.length, drop)) continue;
      if (drop.side !== "right") dropLeft[i] = 1;
      if (drop.side !== "left") dropRight[i] = 1;
      if (drop.gap === true && drop.side === "both") gap[i] = 1;
    }
  }
  const reach = Math.max(1, Math.round(EASE / geo.spacing));
  const edges: RoadEdges = { dropLeft, dropRight, railLeft: blur(dropLeft, reach, geo.open), railRight: blur(dropRight, reach, geo.open), gap };
  known.set(geo, edges);
  return edges;
}

/**
 * Where the barrier stands over a drop: from `wall` (where it usually stands, or a verge's, or a junction's) it closes in to the
 * rail as `rail` (0..1) does. Not where the road is open to another (a junction's wall, farther out than the usual six
 * metres, is the way across from one road to the other): there the rail gives way to it.
 */
export function railWall(wall: number, rail: number): number {
  const open = Math.min(1, Math.max(0, (wall - 6) / 4));
  return wall + (RAIL_GAP - wall) * rail * (1 - open);
}
