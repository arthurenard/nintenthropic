import { describe, expect, it } from "vitest";
import { planFor } from "../../sim/plan";
import { TUNING } from "../../sim/tuning";
import { createSimRace } from "../../sim/race";
import { TrackGeometry } from "../../track/geometry";
import { TRACKS } from "../../track/tracks";
import { racers } from "../../sim/testing";
import { KART_HALF_WIDTH } from "../kartModel";
import { BOX_SIZE, rainbow, rowSlots, slotsFromThings } from "./boxes";

describe("the item boxes drawn", () => {
  it("are exactly the sim's boxes: same ids, same places, hidden while taken", () => {
    for (const track of TRACKS) {
      const plan = planFor(track);
      const race = createSimRace({ track, laps: 1, seed: 1, racers: racers(1, 0) });
      const slots = slotsFromThings(race.view().things);
      expect(slots, track.id).not.toBeNull();
      expect(slots!).toHaveLength(plan.boxes.length);
      slots!.forEach((slot, i) => {
        expect(slot.id).toBe(i);
        expect(slot).toMatchObject({ x: plan.boxes[i]!.x, y: plan.boxes[i]!.y, z: plan.boxes[i]!.z, active: true });
      });
    }
  });

  it("are where the track's own rows say when the source sends none, which is where the sim puts them", () => {
    expect(TUNING.items.boxesPerRow).toBe(5);
    expect(TUNING.items.rowSpread).toBeCloseTo(0.68, 6);
    for (const track of TRACKS) {
      const plan = planFor(track);
      const rows = rowSlots(TrackGeometry.build(track));
      expect(rows).toHaveLength(plan.boxes.length);
      rows.forEach((slot, i) => {
        expect(slot.x).toBeCloseTo(plan.boxes[i]!.x, 6);
        expect(slot.z).toBeCloseTo(plan.boxes[i]!.z, 6);
        expect(slot.y).toBeCloseTo(plan.boxes[i]!.y, 6);
      });
    }
  });

  it("are sized so that anything that visibly touches one takes it: the sim's reach covers the cube's corner and a tyre", () => {
    // A corner of the turning cube reaches BOX_SIZE / sqrt 2 from its middle, and the kart's widest part is KART_HALF_WIDTH from its own.
    expect(BOX_SIZE).toBeCloseTo(1.6, 6);
    expect(KART_HALF_WIDTH).toBeCloseTo(1.16, 2);
    expect(TUNING.items.pickupRadius).toBeGreaterThanOrEqual(BOX_SIZE / Math.SQRT2 + KART_HALF_WIDTH - 0.01);
    // And the cube is not drawn smaller than the sim's reach by much: a box does not take a kart that is plainly clear of it.
    expect(TUNING.items.pickupRadius).toBeLessThan(BOX_SIZE / Math.SQRT2 + KART_HALF_WIDTH + 0.5);
  });

  it("colour themselves from the rainbow", () => {
    const red = rainbow(0);
    expect(red[0]).toBeGreaterThan(0.9);
    const seen = new Set([0, 0.2, 0.4, 0.6, 0.8].map((h) => rainbow(h).map((v) => v.toFixed(2)).join()));
    expect(seen.size).toBe(5);
    for (const h of [0, 0.3, 0.77, 1]) for (const v of rainbow(h)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
