/**
 * The balance: the same simulated riflemen (testkit.ts's SKILLS) play the
 * real rules over both difficulties, twenty runs each, until they are
 * spotted, a job fails, or they pass stage 25. A steady hand should see the
 * jobs come round again on Standard; an average one should get through the
 * lessons and meet the counter-sniper; a shaky one should still clear the
 * first two, which have no clock. Relaxed carries every one of them further,
 * and even the steady hand still loses in the end.
 */
import { describe, expect, it } from "vitest";
import type { Difficulty } from "../../../engine/types";
import { playRun, SKILLS, standIdle, type Skill } from "./testkit";
import { CONVOY_TIME, STAGE_INTRO } from "./tuning";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** Stages cleared in each run, sorted, and why each ended. */
function campaign(skill: Skill, difficulty: Difficulty): { cleared: number[]; median: number; endings: string[] } {
  const runs = SEEDS.map((seed) => playRun(seed, skill, { difficulty, maxStage: 25, maxTime: 3600 }));
  const cleared = runs.map((r) => r.cleared).sort((a, b) => a - b);
  const median = cleared[Math.floor(cleared.length / 2)] as number;
  const endings = runs.map((r) => `${r.cleared}${r.ending ? r.ending.kind[0] : "+"}`);
  return { cleared, median, endings };
}

describe("balance: simulated riflemen over both difficulties", { timeout: 120_000 }, () => {
  const results = new Map<string, ReturnType<typeof campaign>>();
  const get = (name: keyof typeof SKILLS, difficulty: Difficulty) => {
    const key = `${name}.${difficulty}`;
    let r = results.get(key);
    if (!r) {
      r = campaign(SKILLS[name], difficulty);
      results.set(key, r);
      // eslint-disable-next-line no-console
      console.log(`${difficulty} ${name}: stages cleared ${r.cleared.join(" ")} (median ${r.median}); endings ${r.endings.join(" ")}`);
    }
    return r;
  };

  it("lets a steady hand see the jobs come round again on Standard, and still loses him", () => {
    const r = get("steady", "standard");
    expect(r.median).toBeGreaterThanOrEqual(5);
    expect(r.median).toBeLessThanOrEqual(14);
    expect(r.cleared[0]).toBeGreaterThanOrEqual(3);
    expect(r.cleared.filter((c) => c >= 25).length).toBeLessThanOrEqual(2);
  });

  it("gets an average hand through the lessons to the counter-sniper or the officer on Standard", () => {
    const r = get("average", "standard");
    expect(r.median).toBeGreaterThanOrEqual(3);
    expect(r.median).toBeLessThanOrEqual(6);
    expect(r.cleared[0]).toBeGreaterThanOrEqual(2);
  });

  it("lets a shaky hand clear the first two, which have no clock, and stops him soon after", () => {
    const r = get("shaky", "standard");
    expect(r.cleared[0]).toBeGreaterThanOrEqual(2);
    expect(r.median).toBeLessThanOrEqual(4);
  });

  it("carries every hand further on Relaxed", () => {
    for (const name of ["steady", "average", "shaky"] as const) {
      expect(get(name, "relaxed").median, name).toBeGreaterThanOrEqual(get(name, "standard").median);
    }
    expect(get("steady", "relaxed").median).toBeGreaterThanOrEqual(8);
    expect(get("average", "relaxed").median).toBeGreaterThanOrEqual(4);
  });

  it("is still a game you can lose on Relaxed", () => {
    const r = get("steady", "relaxed");
    expect(r.cleared.filter((c) => c >= 25).length).toBeLessThanOrEqual(8);
  });
});

describe("balance: a player who never fires", { timeout: 60_000 }, () => {
  it("is never harmed by the first two stages: quiet sentries and a patrol never look up", () => {
    for (const stage of [1, 2]) {
      const r = standIdle(1, "standard", 120, stage);
      expect(r.ending, `stage ${stage}`).toBeNull();
      expect(r.mission.health.value).toBe(100);
    }
  });

  it("loses the convoy when its clock runs out, a third later on Relaxed", () => {
    const std = standIdle(2, "standard", 120, 3);
    const rel = standIdle(2, "relaxed", 120, 3);
    expect(std.ending).toEqual({ kind: "convoy" });
    expect(rel.ending).toEqual({ kind: "convoy" });
    expect(std.time).toBeGreaterThan(STAGE_INTRO + CONVOY_TIME - 4);
    expect(std.time).toBeLessThan(STAGE_INTRO + CONVOY_TIME + 6);
    expect(rel.time).toBeGreaterThan(std.time + 8);
  });

  it("is found by the counter-sniper, later on Relaxed", () => {
    const std = SEEDS.slice(0, 8).map((s) => standIdle(s, "standard", 240, 4));
    const rel = SEEDS.slice(0, 8).map((s) => standIdle(s, "relaxed", 240, 4));
    for (const r of [...std, ...rel]) expect(r.ending?.kind).toBe("fell");
    const mean = (rs: typeof std) => rs.reduce((s, r) => s + r.time, 0) / rs.length;
    expect(mean(std)).toBeLessThan(60);
    expect(mean(rel)).toBeGreaterThan(mean(std));
  });

  it("lets the officer escape", () => {
    expect(standIdle(3, "standard", 200, 5).ending).toEqual({ kind: "officer" });
  });
});
