/**
 * A driver that tries to go off the road: three karts at full throttle that weave from one edge to the other and past it,
 * so they hit the barriers and rails at speed and bump into one another, along every road of a track (the loop and each
 * branch). It counts where a kart falls. A fall into a gap in the road (a jump the track makes: the weavers do not jump)
 * is the track's own and counts apart: the kart is set down past the gap and drives on. Any other fall is a kart that went
 * off a bridge, a quay or a trestle by accident, which must not happen. For the tests (rails.test.ts) and for looking at a
 * track: print the result.
 */
import { IDLE_INPUT, type DriveInput, type TrackDef } from "../contract";
import type { RouteRoad } from "../track/geometry";
import { planFor } from "./plan";
import { inSpan } from "./terrain";
import { patch, race, racers, toGo, view } from "./testing";

export interface WeaveResult {
  road: number;
  /** Falls that were not into a gap: where along the lap (metres) and how far right of the road's middle. */
  edgeFalls: { s: number; offset: number }[];
  /** Falls into a gap in the road (the weavers do not jump). */
  gapFalls: number;
  /** Times a kart hit a barrier or rail. */
  walls: number;
  /** Metres of the road the first kart drove (of its length). */
  covered: number;
  length: number;
  /** The farthest any kart's centre was beyond the road's edge, metres. */
  beyond: number;
}

/** A kart's wheel toward the point `ahead` metres on, `offset` right of the middle of its road. */
function steerToward(road: ReturnType<typeof planFor>["geo"], k: { x: number; z: number; heading: number }, s: number, ahead: number, offset: number): number {
  const aim = road.point(s + ahead, offset);
  const err = Math.atan2(aim.x - k.x, aim.z - k.z) - k.heading;
  return Math.max(-1, Math.min(1, -Math.atan2(Math.sin(err), Math.cos(err)) * 2));
}

/**
 * Weaves three karts along road `route` (0 the loop, 1.. a branch) of `track`, from its start (a branch: its junction) to
 * its end, for at most `seconds` of racing.
 */
export function weave(track: TrackDef, route: number, options: { seed?: number; seconds?: number } = {}): WeaveResult {
  const plan = planFor(track);
  const main = plan.geo;
  const geo = route === 0 ? main : main.routes[route - 1]!;
  const terrain = route === 0 ? plan.terrain : plan.routes[route - 1]!.terrain;
  const length = route === 0 ? main.length : (geo as RouteRoad).span;
  const from = route === 0 ? 0 : geo.origin;
  const r = race(track, racers(3, 0), { seed: options.seed ?? 1 });
  toGo(r);
  const place = (id: number, s: number, offset: number, speed: number): void => {
    const p = geo.point(s, offset);
    const h = geo.heading(s);
    patch(r, id, { x: p.x, z: p.z, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, s, offset, progress: s, route, steer: 0, rescue: 0 });
  };
  // Start the three a little apart, so they meet as they weave.
  for (let id = 0; id < 3; id++) place(id, geo.wrap(from + 4 + id * 5), (id - 1) * 3, 14);
  const out: WeaveResult = { road: route, edgeFalls: [], gapFalls: 0, walls: 0, covered: 0, length, beyond: 0 };
  const limit = Math.round((options.seconds ?? 400) * 60);
  let previous: number | null = null;
  const hold = [-1, -1, -1];
  const last: (number | undefined)[] = [undefined, undefined, undefined];
  for (let t = 0; t < limit; t++) {
    const inputs = new Map<number, DriveInput>();
    for (let id = 0; id < 3; id++) {
      const k = view(r, id);
      const here = route === 0 ? main.projectLoop(k.x, k.z, last[id]) : geo.projectOpen(k.x, k.z, last[id]);
      last[id] = here.s;
      const half = here.sample.width / 2;
      // Each swings across the whole road and out to the barrier (and into it), at its own pace and phase.
      const period = 28 + id * 9;
      const swing = Math.sin((2 * Math.PI * (t / 60 + id * 1.7)) / (period / 14));
      const reach = half + 3;
      // And now and then holds hard against the edge, to scrape along it.
      if (t % (240 + id * 70) === 0) hold[id] = t + 70;
      const target = hold[id]! > t ? (id % 2 === 0 ? 1 : -1) * (half + 3) : swing * reach;
      inputs.set(id, { ...IDLE_INPUT, throttle: 1, steer: steerToward(geo, k, here.s, 12, target), drift: false });
      if (id === 0) {
        // Metres driven along the road (never counting a step back).
        if (previous !== null) out.covered += Math.max(0, Math.min(8, geo.delta(previous, here.s)));
        previous = here.s;
      }
      out.beyond = Math.max(out.beyond, Math.abs(here.offset) - half);
    }
    r.step(inputs);
    for (const e of r.takeEvents()) {
      if (e.type === "wall") out.walls++;
      if (e.type !== "fall") continue;
      const k = view(r, e.kart);
      const p = route === 0 ? main.projectLoop(k.x, k.z, last[e.kart]) : geo.projectOpen(k.x, k.z, last[e.kart]);
      const s = p.s;
      const gap = terrain.gaps.find((g) => inSpan(s, { from: g.from - 12, to: g.to + 12 }, terrain.length));
      if (gap) {
        out.gapFalls++;
        // The track's own: set down past the gap and on.
        if (e.kart === 0) out.covered += Math.max(0, geo.delta(s, gap.to + 18));
        place(e.kart, geo.wrap(gap.to + 18), 0, 18);
      } else {
        out.edgeFalls.push({ s, offset: p.offset });
        place(e.kart, geo.wrap(s - 20), 0, 14);
      }
    }
    if (out.covered >= length - 6) break;
  }
  return out;
}
