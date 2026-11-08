/**
 * Where a branch road leaves the loop and rejoins it, it makes up the height between the loop's surface and its own. Made up
 * in a dozen metres (as it once was) that was a ramp with a crest at its top, and a kart at plain top speed (24 m/s) took off
 * from it into a little hop it had not asked for (19.9 m/s on Starlight's comet trail). Now every branch holds a kart on the road
 * near its ends to well past plain top speed; a boost (about 32 m/s) may still lift off a branch's own hill, as on the old roads
 * (whose lowest was 29.1 m/s, on Volcano Rush's lava tube) and on the loop's crests.
 */
import { describe, expect, it } from "vitest";
import { mirrorTrack } from "../track/mirror";
import { TRACKS } from "../track/tracks";
import { planFor } from "./plan";
import { TUNING } from "./tuning";

/** The speed above which a kart leaves the road over a crest this sharp (kart.ts overCrest). */
const flies = (bow: number): number => (bow > 0 ? Math.sqrt((TUNING.ramp.gravity * TUNING.ramp.crest) / bow) : Infinity);

/** Metres of a branch from either end that count as its junction. */
const JUNCTION = 130;
/** Plain top speed is 24 m/s. */
const HELD_TO = 29.5;

describe("a branch road's junctions", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)]) {
      it(`${def.id}: hold a kart on the road to well past top speed where each branch leaves and rejoins the loop`, () => {
        const plan = planFor(def);
        for (const [r, route] of plan.routes.entries()) {
          const t = route.terrain;
          const n = t.crest.length;
          const metres = t.spacing * route.geo.stretch;
          let slowest = Infinity;
          let where = 0;
          for (let i = 0; i < n; i++) {
            const fromEnd = Math.min(i, n - 1 - i) * metres;
            if (fromEnd > JUNCTION) continue;
            const speed = flies(t.crest[i]!);
            if (speed < slowest) {
              slowest = speed;
              where = i;
            }
          }
          expect(slowest, `${def.id} branch ${r + 1}, ${(where * metres).toFixed(0)} m along`).toBeGreaterThan(HELD_TO);
        }
      });
    }
  }
});
