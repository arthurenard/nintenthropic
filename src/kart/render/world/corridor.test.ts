/**
 * The sim and the picture must agree on what is solid: wherever a kart can
 * be (the road, and the verge out to the barrier or the open edge) the ground
 * the picture draws is at the road's height and nothing the picture stands
 * there rises into the way; and beyond the barrier, where the camera swings
 * out in a bend, nothing solid stands within a camera's width either.
 *
 * Both sides are built the way the game builds them (the sim's own tables for
 * the barriers; the world's terrain, scenery and landmarks for the picture;
 * see corridorProbe.ts) and the drivable area is sampled every couple of
 * metres. Set CORRIDOR_REPORT=1 to print every offender with how far it must move.
 */
import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../../track/geometry";
import { TRACKS } from "../../track/tracks";
import { measureTrack, type Offender } from "./corridorProbe";
import { analyseFeatures, WALL_DISTANCE } from "./features";

/** Set CORRIDOR_REPORT=1 to print what the test finds. */
const REPORT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CORRIDOR_REPORT;

const fmt = (o: Offender | null) => (o ? `${o.height.toFixed(2)} m at s=${o.s.toFixed(0)}, ${o.beyond.toFixed(1)} m beyond the edge` : "none");

describe("the drivable area", () => {
  for (const def of TRACKS) {
    describe(def.id, () => {
      const report = measureTrack(def);
      if (REPORT) {
        console.log(`${def.id}: ground rise ${fmt(report.groundRise)}; first flank ${report.flank ? `${report.flank.beyond.toFixed(1)} m past the barrier at s=${report.flank.s.toFixed(0)}` : "none"}`);
        for (const o of report.solids) console.log(`   ${o.what}: ${o.height.toFixed(2)} m over the road, ${o.beyond.toFixed(1)} m beyond the edge at s=${o.s.toFixed(0)} (${o.at?.map((v) => v.toFixed(0)).join(", ")}): push ${o.depth.toFixed(1)} m`);
      }

      it("keeps the picture's ground at the road's height wherever the sim lets a kart be", () => {
        expect(report.groundRise?.height ?? -1, `ground rises ${fmt(report.groundRise)}`).toBeLessThanOrEqual(0.6);
      });

      it("stands the barrier before the first flank, never past it", () => {
        // A hill, cliff or canyon wall (ground 2 m above the road) starts at least a metre beyond the barrier's face.
        expect(report.flank?.beyond ?? 99, `first flank ${report.flank ? `${report.flank.beyond.toFixed(1)} m past the barrier at s=${report.flank.s.toFixed(0)}` : ""}`).toBeGreaterThanOrEqual(1);
      });

      it("has nothing solid standing in it: no landmark, prop or scenery within a camera's width of the barrier, and 5 m clear overhead", () => {
        const list = report.solids.map((o) => `${o.what} ${o.height.toFixed(1)} m over the road, ${o.beyond.toFixed(1)} m beyond the edge at s=${o.s.toFixed(0)}`);
        expect(list).toEqual([]);
      });
    });
  }
});

describe("the barrier's picture", () => {
  it("is not drawn where its line runs through another stretch's ground: across a verge cut's hairpin, and only there", () => {
    for (const def of TRACKS) {
      const f = analyseFeatures(TrackGeometry.build(def));
      let hidden = 0;
      for (const side of [
        { hidden: f.hiddenLeft, wall: f.wallLeft },
        { hidden: f.hiddenRight, wall: f.wallRight },
      ]) {
        for (let i = 0; i < f.count; i++) {
          if (!side.hidden[i]) continue;
          hidden++;
          // Only a wide verge can reach another stretch's ground.
          expect(side.wall[i], `${def.id} hides a barrier at 6 m (sample ${i})`).toBeGreaterThan(WALL_DISTANCE);
        }
      }
      // The two hairpin cuts hide plenty; the other tracks nothing.
      if (def.id === "canyon-run" || def.id === "glacier-pass") expect(hidden, def.id).toBeGreaterThan(20);
      else expect(hidden, def.id).toBe(0);
    }
  });
});
