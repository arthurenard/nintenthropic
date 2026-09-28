/**
 * The balance, played by simulated players against the real rules over 24
 * games each (see testkit.ts for how they play): the passes each lasts on
 * Standard and on Relaxed, and an idle player losing a pane on both.
 *
 * | Simulated player                | Standard: breached on pass (median) | Relaxed      |
 * | Steady hand (0.65 s, 80% hits)  | 5–9 (8)                             | 9–13 (11)    |
 * | Slow, wild hand (1.0 s, 55%)    | 4–8 (6)                             | 8–11 (10)    |
 * | Slowest hand (1.3 s, 45%)       | 4–8 (5)                             | 5–11 (9)     |
 * | Never shoots                    | a pane fails on pass 2–4, 70–200 s  | on pass 5 (the Derelict), 270–290 s |
 */
import { describe, expect, it } from "vitest";
import { playUntilBreach, standIdle, type Skill } from "./testkit";

const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
const STEADY: Skill = { reaction: 0.65, accuracy: 0.8 };
const WILD: Skill = { reaction: 1.0, accuracy: 0.55 };
const SLOWEST: Skill = { reaction: 1.3, accuracy: 0.45 };

function passes(skill: Skill, difficulty: "standard" | "relaxed"): { list: number[]; median: number } {
  const list = seeds.map((s) => playUntilBreach(s, skill, { difficulty, maxPass: 30 }).pass).sort((a, b) => a - b);
  return { list, median: list[Math.floor(list.length / 2)] as number };
}

describe("balance on Standard", () => {
  const steady = passes(STEADY, "standard");
  const wild = passes(WILD, "standard");
  const slowest = passes(SLOWEST, "standard");

  it("lets a steady hand through the learning passes, and still breaks the glass in the end", () => {
    // eslint-disable-next-line no-console
    console.log(`Standard, steady hand breached on passes: ${steady.list.join(" ")} (median ${steady.median})`);
    expect(steady.list[0]).toBeGreaterThanOrEqual(4);
    expect(steady.median).toBeGreaterThanOrEqual(7);
    expect(steady.median).toBeLessThanOrEqual(11);
    expect(steady.list[steady.list.length - 1]).toBeLessThanOrEqual(16);
  });

  it("is harder on a slow, wild hand, and hardest on the slowest, but never over in the first three passes", () => {
    // eslint-disable-next-line no-console
    console.log(`Standard, wild hand: ${wild.list.join(" ")} (median ${wild.median}); slowest: ${slowest.list.join(" ")} (median ${slowest.median})`);
    expect(wild.list[0]).toBeGreaterThanOrEqual(4);
    expect(slowest.list[0]).toBeGreaterThanOrEqual(3);
    expect(wild.median).toBeLessThan(steady.median);
    expect(slowest.median).toBeLessThanOrEqual(wild.median);
    expect(slowest.median).toBeLessThanOrEqual(6);
  });
});

describe("balance on Relaxed", () => {
  it("lasts every hand longer than Standard, and still ends", () => {
    const pairs: [string, Skill, number, number][] = [
      ["steady", STEADY, 9, 16],
      ["wild", WILD, 7, 14],
      ["slowest", SLOWEST, 6, 12],
    ];
    for (const [name, skill, lo, hi] of pairs) {
      const relaxed = passes(skill, "relaxed");
      const standard = passes(skill, "standard");
      // eslint-disable-next-line no-console
      console.log(`Relaxed, ${name} hand breached on passes: ${relaxed.list.join(" ")} (median ${relaxed.median})`);
      expect(relaxed.median, name).toBeGreaterThan(standard.median);
      expect(relaxed.median, name).toBeGreaterThanOrEqual(lo);
      expect(relaxed.median, name).toBeLessThanOrEqual(hi);
      // A game you can lose: everyone is breached by pass 25.
      expect(relaxed.list[relaxed.list.length - 1], name).toBeLessThanOrEqual(25);
    }
  });
});

describe("an idle player", () => {
  it("loses a pane on Standard within the first few passes", () => {
    const runs = seeds.slice(0, 12).map((s) => standIdle(s, "standard", 600));
    for (const r of runs) {
      expect(r.failed).toBe(true);
      expect(r.pass).toBeLessThanOrEqual(5);
      expect(r.time).toBeLessThan(260);
    }
    // Most never see the Derelict.
    expect(runs.filter((r) => r.pass < 5).length).toBeGreaterThanOrEqual(9);
  });

  it("loses a pane on Relaxed too, by the Derelict's pass at the latest", () => {
    for (const s of seeds.slice(0, 12)) {
      const r = standIdle(s, "relaxed", 900);
      expect(r.failed, `seed ${s}`).toBe(true);
      expect(r.pass).toBeLessThanOrEqual(5);
    }
  });
});
