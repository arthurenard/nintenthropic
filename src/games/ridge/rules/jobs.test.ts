import { describe, expect, it } from "vitest";
import { jobFor, stageSpec, stageTitle } from "./jobs";
import { endingNote, endingOutcome, fallCard } from "./notes";

describe("the stages", () => {
  it("teach a lesson at a time, then come round again", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(jobFor)).toEqual([
      "sentries", "patrol", "convoy", "sniper", "officer",
      "sentries", "patrol", "convoy", "sniper", "officer",
      "sentries",
    ]);
    expect(stageTitle(3)).toBe("Stage 3 — Convoy");
    expect(stageTitle(4)).toBe("Stage 4 — Counter-Sniper");
  });

  it("grow harder: more men, faster, less mist, a sniper watching and mortars from the sixth", () => {
    const s1 = stageSpec(1);
    const s6 = stageSpec(6);
    expect(s1.men).toBe(3);
    expect(s6.men).toBeGreaterThan(s1.men);
    expect(s6.pace).toBeGreaterThan(s1.pace);
    expect(s6.mist).toBeLessThan(s1.mist);
    expect(s1.mortars).toBe(false);
    expect(s6.mortars).toBe(true);
    expect(s1.sniper).toBe(false);
    expect(s6.sniper).toBe(true);
    expect(stageSpec(9).sniper).toBe(false); // the counter-sniper's own stage has one already
  });

  it("gives the timed jobs a third more time on Relaxed", () => {
    expect(stageSpec(3).time).toBe(40);
    expect(stageSpec(3, "relaxed").time).toBeCloseTo(40 * (4 / 3));
    expect(stageSpec(5, "relaxed").time).toBeCloseTo(stageSpec(5).time * (4 / 3));
    expect(stageSpec(8).time).toBeLessThan(40);
    expect(stageSpec(1).time).toBe(0);
  });

  it("puts children at the chapel on the counter-sniper's stages", () => {
    expect(stageSpec(4).children).toBe(true);
    expect(stageSpec(3).children).toBe(false);
  });
});

describe("the results note", () => {
  it("says what ended the run and what would help", () => {
    expect(endingOutcome({ kind: "fell", by: "sniper", place: "in the chapel tower" }, 4)).toBe("Spotted on Stage 4");
    expect(endingNote({ kind: "fell", by: "sniper", place: "in the chapel tower" })).toBe(
      "The counter-sniper in the chapel tower. His scope glints before he fires — find it first.",
    );
    expect(endingNote({ kind: "convoy" })).toBe("The convoy crossed the bridge. The driver is the quick stop; the engine takes three.");
    expect(endingNote({ kind: "officer" })).toBe("The officer reached the tunnel. At 900 m the wind matters — aim into it.");
    expect(endingOutcome({ kind: "convoy" }, 3)).toBe("Convoy Crossed on Stage 3");
    expect(endingNote({ kind: "fell", by: "gunner", place: "at the checkpoint" })).toMatch(/^A machine-gunner at the checkpoint\. /);
    expect(fallCard({ kind: "fell", by: "mortar", place: "behind the village" }, 7)).toEqual({ title: "Spotted.", line: "On Stage 7, by a mortar behind the village." });
  });
});
