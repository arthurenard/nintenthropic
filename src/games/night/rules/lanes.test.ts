import { describe, expect, it } from "vitest";
import { horizontalDistance, withinReach } from "./dead";
import { makeMatch, placeholderRoad, shippedRoad } from "./testkit";
import { LANE_REACH } from "./tuning";
import type { Lane } from "./types";

const eye = { x: 0, y: 1.7, z: 0 };
const length = (l: Lane) => {
  let s = 0;
  for (let i = 1; i < l.points.length; i++) s += horizontalDistance(l.points[i - 1]!, l.points[i]!);
  return s;
};

describe("a lane out of the fog", () => {
  const far: Lane = {
    id: "corn",
    points: [
      { x: 0, y: 0, z: -100 },
      { x: 0, y: 0, z: -50 },
      { x: 0, y: 0, z: -4 },
    ],
    spread: 1,
    cover: 70,
  };

  it("starts where it first comes within reach, and keeps the rest of its way", () => {
    const l = withinReach(far, eye, 62);
    expect(horizontalDistance(l.points[0]!, eye)).toBeCloseTo(62, 5);
    expect(l.points.slice(1)).toEqual(far.points.slice(1));
    expect(length(l)).toBeCloseTo(58, 5);
  });

  it("is hidden by the corn for what is left of its cover", () => {
    expect(withinReach(far, eye, 62).cover).toBeCloseTo(32, 5);
    expect(withinReach({ ...far, cover: 20 }, eye, 62).cover).toBe(0);
  });

  it("is left alone when it starts within reach", () => {
    const near: Lane = { ...far, points: far.points.slice(1) };
    expect(withinReach(near, eye, 62)).toBe(near);
  });
});

describe("a match's lanes", () => {
  it("set off within reach, the surprises from where they are", async () => {
    for (const road of [placeholderRoad(), (await shippedRoad()) ?? placeholderRoad()]) {
      const { m } = makeMatch(1, { road });
      for (const lane of m.plan.lanes) {
        const start = horizontalDistance(lane.points[0]!, m.eye);
        expect(start, lane.id).toBeLessThanOrEqual(LANE_REACH + 1e-6);
        // Each still a long walk: nobody starts at the barricade.
        if (!["bus", "booth", "fence"].includes(lane.id)) expect(length(lane), lane.id).toBeGreaterThan(30);
      }
    }
  });
});
