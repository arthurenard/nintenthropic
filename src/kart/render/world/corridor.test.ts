/**
 * The sim and the picture must agree on what is solid: wherever a kart can
 * be (the road, and the verge out to the barrier or the open edge) the ground
 * the picture draws is at the road's height and nothing the picture stands
 * there rises into the way; and beyond the barrier, where the camera swings
 * out in a bend, nothing solid stands within a camera's width either.
 *
 * Both sides are built the way the game builds them (the sim's own tables for
 * the barriers; the world's terrain, scenery, landmarks and track decoration for
 * the picture; see corridorProbe.ts) and the drivable area is sampled every metre
 * along and half a metre across. What turns (sails, wheels) is looked at as it
 * sweeps. This is the code-built world: the Blender art replaces some of it at run
 * time, and corridor.art.test.ts measures that. Both run every track and its mirror.
 * Set CORRIDOR_REPORT=1 to print every offender with how far it must move.
 */
import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../../track/geometry";
import { mirrorTrack } from "../../track/mirror";
import { TRACKS } from "../../track/tracks";
import { measureTrack, type Offender, type Report } from "./corridorProbe";
import { analyseFeatures, WALL_DISTANCE } from "./features";

/** Set CORRIDOR_REPORT=1 to print what the test finds. */
const REPORT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CORRIDOR_REPORT;

const fmt = (o: Offender | null) => (o ? `${o.height.toFixed(2)} m at (${o.at?.map((v) => v.toFixed(0)).join(", ")}) s=${o.s.toFixed(0)} on ${o.what},${o.beyond.toFixed(1)} m beyond the edge` : "none");

describe("the drivable area", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)]) {
      describe(def.id, () => {
        let measured: Report | null = null;
        const report = (): Report => {
          measured ??= measureTrack(def);
          if (REPORT) {
            console.log(`${def.id}: ground rise ${fmt(measured.groundRise)}; first flank ${measured.flank ? `${measured.flank.beyond.toFixed(1)} m past the barrier at s=${measured.flank.s.toFixed(0)}` : "none"}`);
            for (const o of measured.solids) console.log(`   ${o.what}: ${o.height.toFixed(2)} m over the road, ${o.beyond.toFixed(1)} m beyond the edge at s=${o.s.toFixed(0)} (${o.at?.map((v) => v.toFixed(0)).join(", ")}): push ${o.depth.toFixed(1)} m`);
          }
          return measured;
        };

        it("keeps the picture's ground at the road's height wherever the sim lets a kart be", () => {
          const r = report();
          expect(r.groundRise?.height ?? -1, `ground rises ${fmt(r.groundRise)}`).toBeLessThanOrEqual(0.6);
        }, 120_000);

        it("stands the barrier before the first flank, never past it", () => {
          // A hill, cliff or canyon wall (ground 2 m above the road) starts at least a metre beyond the barrier's face.
          const r = report();
          expect(r.flank?.beyond ?? 99, `first flank ${r.flank ? `${r.flank.beyond.toFixed(1)} m past the barrier at s=${r.flank.s.toFixed(0)}` : ""}`).toBeGreaterThanOrEqual(1);
        }, 120_000);

        it("has nothing solid standing in it: no landmark, prop, decoration or scenery within a camera's width of the barrier, and 5 m clear overhead", () => {
          const list = report().solids.map((o) => `${o.what} ${o.height.toFixed(1)} m over the road, ${o.beyond.toFixed(1)} m beyond the edge at s=${o.s.toFixed(0)}`);
          expect(list).toEqual([]);
        }, 120_000);
      });
    }
  }
});

describe("the drivable area on the lower quality tiers", () => {
  // A coarser ground grid and a thinner scatter of scenery: landmarks and decoration do not change with the tier.
  for (const tier of ["medium", "low"] as const) {
    for (const def of TRACKS) {
      it(`${def.id} (${tier}): the ground stays at the road's height and nothing solid stands in the way`, () => {
        const r = measureTrack(def, { tier, things: false });
        expect(r.groundRise?.height ?? -1, `ground rises ${fmt(r.groundRise)}`).toBeLessThanOrEqual(0.6);
        expect(r.flank?.beyond ?? 99, "first flank").toBeGreaterThanOrEqual(1);
        expect(r.solids.map((o) => `${o.what} ${o.height.toFixed(1)} m over the road, ${o.beyond.toFixed(1)} m beyond the edge at s=${o.s.toFixed(0)}`)).toEqual([]);
      }, 120_000);
    }
  }
});

describe("the barrier's picture", () => {
  it("is not drawn where its line runs through another stretch's ground: across a verge cut's hairpin, and the inside of a tight U-turn", () => {
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
          // A wide verge's barrier line can reach another stretch's ground; so can an ordinary one only where two legs are
          // closer than their walls are wide (the palm island's fingertips).
          if (def.id !== "five-finger-circuit") expect(side.wall[i], `${def.id} hides a barrier at 6 m (sample ${i})`).toBeGreaterThan(WALL_DISTANCE);
        }
      }
      // Canyon's hairpin cut hides plenty; the palm island's fingertips a little; the tracks with branch roads a stretch at each junction; the others nothing.
      if (def.id === "canyon-run") expect(hidden, def.id).toBeGreaterThan(20);
      else if (def.id === "five-finger-circuit") expect(hidden, def.id).toBeGreaterThan(0);
      // A track with branch roads has its barrier opened where a branch leaves or joins the road (no wall across the way): they hide a stretch of it.
      else if ((def.routes ?? []).length > 0) expect(hidden, def.id).toBeGreaterThan(0);
      else expect(hidden, def.id).toBe(0);
    }
  });
});
