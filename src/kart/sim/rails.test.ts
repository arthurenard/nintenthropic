/**
 * Nobody falls off a bridge by accident. Three karts at full throttle weave from one edge of the road to the other and past it,
 * hit the barriers at speed and bump into one another, along every road of every track and its mirror (the loop and each
 * branch): wherever the road has a drop beside it (a bridge, a quay, a trestle, the deck of a ship) a rail stands at its edge,
 * and the only falls are into a gap in the road itself, which is a jump the track makes (weave.ts).
 */
import { describe, expect, it } from "vitest";
import { RAIL_GAP } from "../track/edges";
import { mirrorTrack } from "../track/mirror";
import { TRACKS } from "../track/tracks";
import { planFor } from "./plan";
import { barrierDistance, isOpen } from "./terrain";
import { weave } from "./weave";

describe("the rails over a drop", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)]) {
      it(`${def.id}: a rail stands at the edge wherever the road has a drop beside it, and nothing is open outside a gap`, () => {
        const plan = planFor(def);
        let drops = 0;
        for (const [r, terrain] of [plan.terrain, ...plan.routes.map((route) => route.terrain)].entries()) {
          for (let i = 0; i < terrain.openLeft.length; i++) {
            const s = (terrain.open ? terrain.origin : 0) + i * terrain.spacing;
            for (const side of [-1, 1] as const) {
              const drop = (side < 0 ? terrain.openLeft : terrain.openRight)[i] === 1;
              const rail = (side < 0 ? terrain.railLeft : terrain.railRight)[i]!;
              if (!drop) continue;
              drops++;
              const where = `road ${r} s=${s.toFixed(0)} side ${side}`;
              // Only a gap in the road leaves nothing to stop a kart.
              if (isOpen(terrain, s, side)) expect(terrain.gaps.length, where).toBeGreaterThan(0);
              // Well inside the drop the barrier is the rail.
              if (rail >= 0.999) expect(barrierDistance(terrain, s, side), where).toBeLessThanOrEqual(RAIL_GAP + 0.01);
            }
          }
        }
        expect(drops, "the track has drops").toBeGreaterThan(0);
      });
    }
  }
});

describe("a weaving driver", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)]) {
      it(`${def.id}: never goes off a bridge, a quay or a trestle on any road`, { timeout: 120_000 }, () => {
        const roads = 1 + planFor(def).geo.routes.length;
        for (let road = 0; road < roads; road++) {
          const w = weave(def, road);
          expect(w.edgeFalls, `${def.id} road ${road}: falls that were not into a gap`).toEqual([]);
          // It drove the whole road, so a bridge in the middle was weaved over.
          expect(w.covered, `${def.id} road ${road} driven`).toBeGreaterThanOrEqual(w.length - 12);
        }
      });
    }
  }
});
