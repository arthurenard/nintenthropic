import { describe, expect, it } from "vitest";
import { Glass, markSize } from "./panes";
import { ALARM_BELOW, CREW_SEAL, INTEGRITY_MAX } from "./tuning";
import { v3 } from "./vec";

const at = v3(0, 0, -1.5);

describe("the glass", () => {
  it("starts whole: seven panes at a hundred", () => {
    const g = new Glass();
    expect(g.integrity).toEqual([100, 100, 100, 100, 100, 100, 100]);
    expect(g.whole).toBe(true);
    expect(g.worst()).toBeNull();
  });

  it("takes a strike's cost off the pane it lands on, and leaves a mark by its weight", () => {
    const g = new Glass();
    const chip = g.strike(2, 8, at, 1);
    expect(g.integrity[2]).toBe(92);
    expect(chip.mark.size).toBe("chip");
    expect(g.strike(2, 20, at, 2).mark.size).toBe("crack");
    expect(g.strike(3, 45, at, 3).mark.size).toBe("web");
    expect(markSize(8)).toBe("chip");
    expect(markSize(20)).toBe("crack");
    expect(markSize(45)).toBe("web");
    expect(g.strikes[2]).toBe(2);
    expect(g.worst()).toBe(3);
  });

  it("fails at zero, once", () => {
    const g = new Glass();
    expect(g.strike(0, 60, at, 1).failed).toBe(false);
    expect(g.strike(0, 60, at, 2).failed).toBe(true);
    expect(g.failed).toBe(0);
    expect(g.integrity[0]).toBe(0);
    expect(g.strike(1, 200, at, 3).failed).toBe(false);
  });

  it("never fails in god mode", () => {
    const g = new Glass();
    g.immortal = true;
    expect(g.strike(0, 500, at, 1).failed).toBe(false);
    expect(g.integrity[0]).toBe(1);
  });

  it("mends up to full, and the marks fade oldest first as it does", () => {
    const g = new Glass();
    g.strike(4, 20, at, 1);
    g.strike(4, 20, at, 2);
    expect(g.mend(4, 25)).toBe(25);
    const marks = g.marks.filter((m) => m.pane === 4);
    // 15 of damage left: the newer crack shows at three quarters, the older has gone.
    expect(marks).toHaveLength(1);
    expect(marks[0]!.at).toBe(2);
    expect(marks[0]!.left).toBeCloseTo(0.75, 5);
    expect(g.mend(4, 100)).toBe(15);
    expect(g.integrity[4]).toBe(INTEGRITY_MAX);
    expect(g.marks.filter((m) => m.pane === 4)).toHaveLength(0);
  });

  it("is sealed by the crew each breather: +15 to every pane under full", () => {
    const g = new Glass();
    g.strike(1, 30, at, 1);
    g.strike(5, 8, at, 1);
    expect(g.seal(CREW_SEAL)).toEqual([1, 5]);
    expect(g.integrity[1]).toBe(85);
    expect(g.integrity[5]).toBe(100);
    expect(g.integrity[0]).toBe(100);
  });

  it("sounds the alarm under 35", () => {
    const g = new Glass();
    g.strike(6, INTEGRITY_MAX - ALARM_BELOW, at, 1);
    expect(g.alarm).toBe(false);
    g.strike(6, 1, at, 2);
    expect(g.alarm).toBe(true);
    expect(g.weakest).toBe(ALARM_BELOW - 1);
  });
});
