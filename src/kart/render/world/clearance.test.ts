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

/** One road's stretches, filed in buckets of 16 m (the loop, or a branch, which is open at its ends). */
interface PlainRoad {
  samples: TrackGeometry["samples"];
  features: Terrain["features"];
  open: boolean;
  buckets: Map<number, number[]>;
}

/** `Clearance.at` as it was first written: every stretch of every bucket of every road in reach, its distance worked out in full. */
function plainAt(roads: PlainRoad[], reach: number, x: number, z: number, r: number, enough: number): number {
  const look = enough + r + reach;
  let best = enough;
  for (const { samples, features, open, buckets } of roads) {
    const n = samples.length;
    for (let i = Math.floor((x - look) / 16); i <= Math.floor((x + look) / 16); i++) {
      for (let j = Math.floor((z - look) / 16); j <= Math.floor((z + look) / 16); j++) {
        for (const k of buckets.get(i * 100003 + j) ?? []) {
          if (open && k >= n - 1) continue;
          const a = samples[k]!;
          const b = samples[(k + 1) % n]!;
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          const len2 = ex * ex + ez * ez || 1;
          const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
          const dx = x - (a.x + ex * f);
          const dz = z - (a.z + ez * f);
          const d = Math.hypot(dx, dz);
          if (d - r - reach >= best) continue;
          const len = Math.sqrt(len2);
          const lateral = (dx * -ez + dz * ex) / len;
          const left = Math.max(features.wallLeft[k]!, features.wallLeft[(k + 1) % n]!);
          const right = Math.max(features.wallRight[k]!, features.wallRight[(k + 1) % n]!);
          const wall = Math.abs(lateral) < r ? Math.max(left, right) : lateral > 0 ? right : left;
          best = Math.min(best, d - r - Math.max(a.width, b.width) / 2 - wall);
        }
      }
    }
  }
  return best;
}

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

// Worked out stretch by stretch with the far ones passed over, it has to give exactly what looking at all of them gives:
// the scenery and the tufts stand where it says, and a different last digit could move one.
describe("the search for the nearest stretch (clearance.ts)", () => {
  const defs: TrackDef[] = [...TRACKS, ...TRACKS.map(mirrorTrack), ...DEV_TRACKS];
  for (const def of defs) {
    it(`${def.id}: gives the very answer of the plain search, for points, footprints and every horizon`, () => {
      const geo = TrackGeometry.build(def);
      const terrain = Terrain.build(geo, styleFor(def.theme), QUALITY.high.cell);
      const clearance = new Clearance(terrain);
      let reach = 0;
      const roads: PlainRoad[] = [
        { samples: geo.samples, features: terrain.features, open: false, buckets: new Map() },
        ...geo.routes.map((road, r) => ({ samples: road.samples, features: terrain.routeFeatures[r]!, open: true, buckets: new Map<number, number[]>() })),
      ];
      for (const road of roads) {
        road.samples.forEach((s, i) => {
          const key = Math.floor(s.x / 16) * 100003 + Math.floor(s.z / 16);
          road.buckets.set(key, [...(road.buckets.get(key) ?? []), i]);
          reach = Math.max(reach, s.width / 2 + Math.max(road.features.wallLeft[i]!, road.features.wallRight[i]!));
        });
      }
      const rnd = seededRandom(def.id.length * 17 + 5);
      const near = pointsNear(geo, 700, 3);
      // And some from anywhere on the map, mostly far from the road.
      for (let k = 0; k < 150; k++) near.push([terrain.minX + rnd() * (terrain.maxX - terrain.minX), terrain.minZ + rnd() * (terrain.maxZ - terrain.minZ)]);
      for (const [x, z] of near) {
        const r = rnd() < 0.4 ? 0 : 0.3 + rnd() * 7;
        const enough = [1, 8, 30, 40, terrain.clearAt(x, z)][Math.floor(rnd() * 5)]!;
        expect(clearance.at(x, z, r, enough), `${def.id} at (${x.toFixed(2)}, ${z.toFixed(2)}) r ${r.toFixed(2)} enough ${enough.toFixed(2)}`).toBe(plainAt(roads, reach, x, z, r, enough));
      }
    }, 120_000);
  }
});
