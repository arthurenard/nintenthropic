/**
 * The road is one continuous surface wherever a kart can drive, and the picture agrees with the sim about it. For every track,
 * its mirror, and every road of each (the loop and each branch): no hole in the road, none in the verge or deck between its edge
 * and the barrier; no step where a branch leaves or joins the road, and none where two roads lie over one another; no bend tighter
 * than the road is wide, whose inside edge folds back over the road; the road drawn missing exactly where the sim has a gap, and
 * not a metre off; the drawn surface where the sim and the banking put the kart; and wherever the road has a drop beside it a
 * rail at its edge, drawn and solid, so nobody falls off a bridge by accident. roadAudit.ts measures; this holds it to numbers.
 * Set ROADS_REPORT=1 to print every track's numbers.
 */
import { describe, expect, it } from "vitest";
import { mirrorTrack } from "../../track/mirror";
import { TRACKS } from "../../track/tracks";
import { auditRoads, summarise, type Defect } from "./roadAudit";

const REPORT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ROADS_REPORT;

const where = (d: Defect | null) => (d ? `road ${d.road} at s=${d.s.toFixed(0)}, ${d.offset.toFixed(1)} m right of the middle, (${d.x.toFixed(0)}, ${d.z.toFixed(0)}), ${d.size.toFixed(2)}` : "none");

describe("the drawn roads", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)]) {
      describe(def.id, () => {
        const audit = (() => {
          let made: ReturnType<typeof auditRoads> | null = null;
          return () => {
            made ??= auditRoads(def, "low");
            if (REPORT) console.log(summarise(made));
            return made;
          };
        })();

        it("has no hole in the road, and none in the deck between its edge and the barrier", { timeout: 120_000 }, () => {
          const a = audit();
          expect(a.roadHoles, `a hole in the road: ${where(a.roadHole)}`).toBe(0);
          // (A sample or two where a gap or a wide verge ends is not a hole one can fall into; nor the three-metre nick where the
          // verge folds on itself, four metres past the road's edge, on the inside of Meadow's creek road as it turns onto the loop.)
          expect(a.vergeRun, `a hole beside the road: ${where(a.vergeHole)}`).toBeLessThanOrEqual(3);
        });

        it("has no verge drawn over a road: no patch of grass or deck lying on the asphalt where two roads meet", { timeout: 120_000 }, () => {
          const a = audit();
          // (A few centimetres along a road's very edge is the verge tucking under it.) Before, the loop's grass lay up to 1.3 m
          // above a branch climbing to meet it, a patch of grass over the asphalt.
          expect(a.buriedAt?.size ?? 0, `a verge over the road: ${where(a.buriedAt)}`).toBeLessThanOrEqual(0.2);
        });

        it("has no step where a branch leaves or joins the road, and no two roads' surfaces lie over one another at different heights", { timeout: 120_000 }, () => {
          const a = audit();
          expect(a.steps, `a step: ${where(a.step)}`).toBe(0);
          expect(a.edgeStep?.size ?? 0, `the road's edge jumps: ${where(a.edgeStep)}`).toBeLessThanOrEqual(0.5);
        });

        it("has no bend tighter than the road is wide, whose inside edge would fold back over the road", { timeout: 120_000 }, () => {
          const a = audit();
          expect(a.folds, "sections that turn back on one another").toBe(0);
          expect(a.pinch?.size ?? 0, `a bend tighter than the road is wide: ${where(a.pinch)}`).toBeLessThan(1.1);
        });

        it("draws the road missing exactly where the sim has a gap, and puts the kart on the drawn surface", { timeout: 120_000 }, () => {
          const a = audit();
          expect(a.gapPicture, "samples of gap in the picture and the sim").toBe(a.gapSim);
          expect(a.phantoms, `road drawn in a gap: ${where(a.phantom)}`).toBe(0);
          expect(a.gapEnd?.size ?? 0, `the drawn road ends away from the sim's gap: ${where(a.gapEnd)}`).toBeLessThanOrEqual(1.25);
          expect(a.groundMiss, `the drawn road is not where the sim puts the kart: ${where(a.groundMisses)}`).toBe(0);
        });

        it("has a rail drawn and solid at every drop, and nothing open to fall from outside a gap", { timeout: 120_000 }, () => {
          const a = audit();
          expect(a.openEdgeSpots, "samples where nothing stops a kart outside a gap").toBe(0);
          expect(a.railsInSim, "rails in the sim: every sample well inside a drop").toBeGreaterThanOrEqual(a.dropSpots * 0.9);
          if (a.dropSpots > 0) expect(a.railsChecked).toBeGreaterThan(5);
          expect(a.railsDrawn, `rails drawn (one missing: ${where(a.railMissing)})`).toBeGreaterThanOrEqual(a.railsChecked * 0.95);
        });
      });
    }
  }
});
