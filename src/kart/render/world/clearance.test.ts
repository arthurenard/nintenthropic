import { describe, expect, it } from "vitest";
import { seededRandom } from "../../../engine/random";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { mirrorTrack } from "../../track/mirror";
import { TRACKS } from "../../track/tracks";
import { DEV_TRACKS } from "../devTracks";
import { QUALITY } from "../quality";
import { Clearance } from "./clearance";
import { KartSpace } from "./kartSpace";
import { Terrain } from "./terrain";
import { styleFor } from "./themes";

/** How far (metres) the two may differ: the sim measures from the curve through the samples, clearance.ts from the straight between them. */
const SLACK = 0.15;

/** Points scattered round the road, out to 45 m beyond its edge, where scenery comes nearest. */
function pointsNear(geo: TrackGeometry, count: number, seed: number): [number, number][] {
  const rnd = seededRandom(seed);
  const out: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const c = geo.samples[Math.floor(rnd() * geo.samples.length)]!;
    const o = (rnd() * 2 - 1) * (c.width / 2 + 45);
    out.push([c.x - c.tz * o + (rnd() - 0.5) * 4, c.z + c.tx * o + (rnd() - 0.5) * 4]);
  }
  return out;
}

// The terrain's grid alone (Terrain.clearAt) was out by as much as a verge is wide where one ends: 16 m at the end of Glacier
// Pass's cut, where it called ground 13 m inside the barrier 3 m clear of it. The scenery and the tufts measure with this instead.
describe("how far beyond the barrier a point is (clearance.ts)", () => {
  const defs: TrackDef[] = [...TRACKS, ...TRACKS.map(mirrorTrack), ...DEV_TRACKS];
  for (const def of defs) {
    it(`${def.id}: is never more than the sim's own measure, for a point or a footprint, at every tier's grid`, () => {
      const geo = TrackGeometry.build(def);
      const space = new KartSpace(def, geo);
      for (const tier of ["high", "low"] as const) {
        const terrain = Terrain.build(geo, styleFor(def.theme), QUALITY[tier].cell);
        const clearance = new Clearance(terrain);
        for (const [x, z] of pointsNear(geo, 2500, def.id.length * 31 + tier.length)) {
          const here = space.place(x, z, 120)!;
          // Where it matters: within 10 m of the limit (far out the sim measures along the curve's normal, not to the curve).
          // The sim's limit is the barrier, or nearer at an open edge: the barrier is the stricter of the two.
          if (here.past > 10) continue;
          expect(clearance.at(x, z, 0, 30), `${def.id} ${tier} at (${x.toFixed(1)}, ${z.toFixed(1)}), s=${here.s.toFixed(0)}`).toBeLessThanOrEqual(here.past + SLACK);
          expect(clearance.beyond(x, z), `${def.id} ${tier} at (${x.toFixed(1)}, ${z.toFixed(1)}), s=${here.s.toFixed(0)}`).toBeLessThanOrEqual(here.past + 0.5 + SLACK);
        }
        // A footprint: its nearest point to any barrier, never farther than the sim puts the nearest of its rim.
        const rnd = seededRandom(7);
        for (const [x, z] of pointsNear(geo, 300, 99)) {
          const r = 0.5 + rnd() * 6;
          let least = Infinity;
          for (let a = 0; a < 24; a++) least = Math.min(least, space.place(x + Math.sin((a / 24) * Math.PI * 2) * r, z + Math.cos((a / 24) * Math.PI * 2) * r, 140)!.past);
          least = Math.min(least, space.place(x, z, 140)!.past);
          if (least > 10) continue;
          expect(clearance.at(x, z, r, 30), `${def.id} ${tier}: a footprint of ${r.toFixed(1)} m at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThanOrEqual(least + SLACK);
        }
      }
    }, 120_000);
  }
});
