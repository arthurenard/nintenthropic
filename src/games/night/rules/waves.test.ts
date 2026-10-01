import { describe, expect, it } from "vitest";
import { buildQueue } from "./match";
import { mulberry32 } from "../../../engine/rules/rng";
import type { LaneId } from "./types";
import { fogFor, isMechanicWave, sightFor, waveSpec } from "./waves";

const ALL = new Set<LaneId>(["road", "corn", "trees", "bus", "booth", "fence"]);

describe("the wave table", () => {
  it("follows the design's first six waves", () => {
    const table = [1, 2, 3, 4, 5, 6].map((w) => waveSpec(w));
    expect(table.map((s) => s.dead)).toEqual([6, 9, 12, 14, 16, 14]);
    expect(table.map((s) => s.mechanic)).toEqual([false, false, false, false, false, true]);
    // Wave 1: walkers up the road only.
    expect(table[0]).toMatchObject({ runners: 0, crawlers: 0, bloaters: 0, surprises: 0, lanes: ["road"] });
    // Wave 2: the cornfield.
    expect(table[1]?.lanes).toEqual(["road", "corn"]);
    expect(table[1]?.runners).toBe(0);
    // Wave 3: runners and the tree line.
    expect(table[2]?.runners).toBeGreaterThan(0);
    expect(table[2]?.lanes).toContain("trees");
    // Wave 4: crawlers and the surprises.
    expect(table[3]?.crawlers).toBeGreaterThan(0);
    expect(table[3]?.surprises).toBeGreaterThan(0);
    expect(table[2]?.surprises).toBe(0);
    // Wave 5: bloaters.
    expect(table[3]?.bloaters).toBe(0);
    expect(table[4]?.bloaters).toBeGreaterThan(0);
  });

  it("opens the first three waves with a burst, the bus's door first, and nothing after", () => {
    const table = [1, 2, 3, 4, 5, 6, 7, 12].map((w) => waveSpec(w));
    expect(table.map((s) => s.opening)).toEqual([["bus", "road", "booth"], ["bus", "corn", "road"], ["bus", "trees", "corn"], [], [], [], [], []]);
    // Each one a lane the wave could send the dead by anyway, or a surprise's cover.
    for (const s of table.slice(0, 3)) for (const l of s.opening) expect([...s.lanes, "bus", "booth", "fence"]).toContain(l);
  });

  it("shortens the early gaps and leaves the later waves' escalation as it was designed", () => {
    expect([1, 2, 3].map((w) => waveSpec(w).gap)).toEqual([[1.8, 3.2], [1.8, 3.2], [1.8, 3.2]]);
    expect([1, 2, 3].map((w) => waveSpec(w).maxActive)).toEqual([5, 6, 7]);
    // From wave 4 on: exactly the table the night was balanced on.
    expect([4, 5, 6].map((w) => waveSpec(w).gap)).toEqual([[1.6, 3], [1.6, 3], [1.6, 3]]);
    expect([4, 5, 6, 7, 10].map((w) => waveSpec(w).maxActive)).toEqual([8, 8, 9, 10, 13]);
    expect(waveSpec(7).gap[0]).toBeCloseTo(1.3, 9);
    expect(waveSpec(7).gap[1]).toBeCloseTo(2.45, 9);
    expect(waveSpec(10).gap[0]).toBeCloseTo(1.0, 9);
    expect(waveSpec(10).gap[1]).toBeCloseTo(2.0, 9);
    // Never slower as the night goes on.
    for (let w = 2; w <= 20; w++) expect(waveSpec(w).gap[0], `wave ${w}`).toBeLessThanOrEqual(waveSpec(w - 1).gap[0]);
  });

  it("adds three a wave from wave 7, with more runners, thicker fog and faster walkers", () => {
    for (let w = 7; w <= 20; w++) {
      const s = waveSpec(w);
      const before = waveSpec(w - 1);
      if (!s.mechanic && !before.mechanic) expect(s.dead).toBe(before.dead + 3);
      expect(s.runners).toBeGreaterThanOrEqual(before.runners);
      expect(s.fog).toBeGreaterThanOrEqual(before.fog);
      expect(s.pace).toBeGreaterThanOrEqual(before.pace);
      expect(s.gap[0]).toBeLessThanOrEqual(before.gap[0]);
      expect(s.maxActive).toBeGreaterThanOrEqual(before.maxActive);
    }
    expect(waveSpec(7).dead).toBe(19);
    expect(waveSpec(10).pace).toBeGreaterThan(1);
  });

  it("brings the Mechanic every sixth wave", () => {
    expect([6, 12, 18].every(isMechanicWave)).toBe(true);
    expect([1, 5, 7, 11, 13].some(isMechanicWave)).toBe(false);
    expect(waveSpec(12).subtitle).toBe("The Mechanic is back.");
  });

  it("reads about 80 m of road on wave 1, and less as the fog thickens", () => {
    expect(sightFor(fogFor(1))).toBeGreaterThan(70);
    expect(sightFor(fogFor(1))).toBeLessThan(85);
    expect(sightFor(fogFor(10))).toBeLessThan(50);
    expect(sightFor(fogFor(30))).toBeGreaterThan(35);
  });

  it("sends survivors from wave 3", () => {
    expect(waveSpec(2).survivors).toBe(0);
    expect(waveSpec(3).survivors).toBe(1);
    expect(waveSpec(8).survivors).toBe(2);
  });
});

describe("the wave's queue", () => {
  it("holds every one of the wave's dead, the Mechanic first", () => {
    const spec = waveSpec(6);
    const q = buildQueue(spec, mulberry32(4), ALL);
    expect(q.length).toBe(15);
    expect(q[0]).toEqual({ kind: "mechanic", lane: "road" });
    const count = (k: string) => q.filter((e) => e.kind === k).length;
    expect(count("runner")).toBe(spec.runners);
    expect(count("crawler")).toBe(spec.crawlers);
    expect(count("bloater")).toBe(spec.bloaters);
  });

  it("sends the surprises by the bus, the booth and the fence, walkers and runners only", () => {
    const spec = waveSpec(5);
    const q = buildQueue(spec, mulberry32(9), ALL);
    const surprises = q.filter((e) => e.lane === "bus" || e.lane === "booth" || e.lane === "fence");
    expect(surprises.length).toBe(spec.surprises);
    expect(new Set(surprises.map((e) => e.lane)).size).toBe(3);
    for (const e of surprises) expect(["walker", "runner"]).toContain(e.kind);
  });

  it("keeps crawlers out of the corn, and every kind to the wave's own lanes", () => {
    for (let seed = 1; seed < 20; seed++) {
      const q = buildQueue(waveSpec(4), mulberry32(seed), ALL);
      for (const e of q) if (e.kind === "crawler") expect(["road", "trees"]).toContain(e.lane);
      // Wave 1: the opening's three (the bus, the road, the phone booth), then the road alone.
      const early = buildQueue(waveSpec(1), mulberry32(seed), ALL);
      expect(early.slice(0, 3).map((e) => e.lane)).toEqual(["bus", "road", "booth"]);
      for (const e of early.slice(3)) expect(e.lane).toBe("road");
    }
  });

  it("brings the opening forward as walkers, and changes nothing else about the wave", () => {
    for (const wave of [1, 2, 3]) {
      const spec = waveSpec(wave);
      const q = buildQueue(spec, mulberry32(7), ALL);
      expect(q.length).toBe(spec.dead);
      expect(q.slice(0, spec.opening.length).map((e) => [e.kind, e.lane, e.near])).toEqual(spec.opening.map((l) => ["walker", l, true]));
      // Only those are the opening's; the rest are the wave as before: its runners, the lanes it opens.
      expect(q.slice(spec.opening.length).some((e) => e.near)).toBe(false);
      expect(q.filter((e) => e.kind === "runner").length).toBe(spec.runners);
      for (const e of q.slice(spec.opening.length)) expect(spec.lanes).toContain(e.lane);
    }
    // Nothing from wave 4 on.
    for (const wave of [4, 5, 6, 9]) expect(buildQueue(waveSpec(wave), mulberry32(7), ALL).some((e) => e.near)).toBe(false);
  });

  it("skips an opening lane the road does not have, and falls back to the wave's own", () => {
    const q = buildQueue(waveSpec(1), mulberry32(7), new Set<LaneId>(["road", "booth"]));
    expect(q.slice(0, 2).map((e) => e.lane)).toEqual(["road", "booth"]);
    expect(q.length).toBe(6);
    const bare = buildQueue(waveSpec(3), mulberry32(7), new Set<LaneId>(["road"]));
    for (const e of bare) expect(e.lane).toBe("road");
  });

  it("falls back to the road for a lane the road does not have", () => {
    const q = buildQueue(waveSpec(5), mulberry32(2), new Set<LaneId>(["road"]));
    for (const e of q) expect(e.lane).toBe("road");
  });
});
