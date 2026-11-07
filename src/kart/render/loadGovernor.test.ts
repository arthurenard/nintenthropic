import { describe, expect, it } from "vitest";
import { keepLevel, keptLevel, LoadGovernor, lookFor, MAX_LEVEL } from "./loadGovernor";

/** Feeds `seconds` of frames of `ms` each; the levels it passed through. */
function run(g: LoadGovernor, ms: number, seconds: number, speed?: (level: number) => number): number[] {
  const levels: number[] = [];
  for (let t = 0; t < seconds * 1000; t += ms) {
    const interval = speed ? speed(g.level) : ms;
    if (g.sample(interval)) levels.push(g.level);
  }
  return levels;
}

describe("LoadGovernor", () => {
  it("leaves a machine that holds 60 fps alone", () => {
    const g = new LoadGovernor();
    expect(run(g, 16.7, 60)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it("steps down when frames run long and each step helps", () => {
    const g = new LoadGovernor();
    // 30 ms at level 0, a tenth quicker every level: reaches 60 fps at level 4... or stops when it is quick enough.
    const seen = run(g, 30, 40, (level) => 30 - level * 4.5);
    expect(seen[0]).toBe(1);
    expect(g.level).toBeGreaterThanOrEqual(2);
    expect(g.level).toBeLessThanOrEqual(MAX_LEVEL);
  });

  it("does not step on a single hitch", () => {
    const g = new LoadGovernor();
    run(g, 16.7, 5);
    g.sample(200);
    run(g, 16.7, 20);
    expect(g.level).toBe(0);
  });

  it("puts back a step that bought no quicker frame, and holds there", () => {
    const g = new LoadGovernor();
    // A browser holding the page to 30 fps: nothing drawn less changes it.
    const seen = run(g, 33.3, 60);
    expect(seen.length).toBeLessThanOrEqual(2);
    expect(g.level).toBe(0);
  });

  it("keeps a step that cut the main thread's work though the frames still come in whole refreshes", () => {
    const g = new LoadGovernor();
    const levels: number[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      // 33 ms frames whatever the level (vsync), but each level builds the frame 15% quicker.
      if (g.sample(33.3, 28 * 0.85 ** g.level)) levels.push(g.level);
    }
    expect(levels[0]).toBe(1);
    expect(g.level).toBeGreaterThanOrEqual(3);
  });

  it("goes back up slowly when the load has gone, and only one step at a time", () => {
    const g = new LoadGovernor(1000 / 60, 3);
    const seen = run(g, 16.7, 120);
    expect(seen[0]).toBe(2);
    expect(seen.every((l, i) => i === 0 || l === seen[i - 1]! - 1)).toBe(true);
  });

  it("does not flicker: a step up that fails is closed and the race stays where it was", () => {
    const g = new LoadGovernor(1000 / 60, 2);
    // Quick at level 2 and 3, slow at 1 and 0.
    const speed = (level: number) => (level >= 2 ? 16.7 : 30);
    const seen = run(g, 16.7, 300, speed);
    // It may try once or twice, but never more than the trials, and it never bounces more than 3 times.
    expect(seen.length).toBeLessThanOrEqual(6);
    expect(g.level).toBeGreaterThanOrEqual(2);
  });

  it("starts a new race at the level it is told", () => {
    const g = new LoadGovernor();
    g.reset(2);
    expect(g.level).toBe(2);
    g.reset();
    expect(g.level).toBe(0);
  });
});

describe("lookFor", () => {
  it("is the picture as it was at level 0", () => {
    const l = lookFor(0, 30);
    expect(l.shadowSpread).toBe(0);
    expect(l.shadowPasses).toBe(4);
    expect(l.kartDetail).toBe(Infinity);
    expect(l.particles).toBe(1);
    expect(l.sceneryReach).toBe(0);
  });

  it("only takes work away as the level rises", () => {
    for (let i = 1; i <= MAX_LEVEL; i++) {
      const a = lookFor(i - 1, 30);
      const b = lookFor(i, 30);
      expect(b.shadowSpread).toBeGreaterThanOrEqual(a.shadowSpread);
      expect(b.shadowPasses).toBeLessThanOrEqual(a.shadowPasses);
      expect(b.kartDetail).toBeLessThan(a.kartDetail);
      expect(b.particles).toBeLessThan(a.particles);
      expect(b.rushTaps).toBeLessThanOrEqual(a.rushTaps);
    }
  });
});

describe("what a device remembers", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it("starts a race at the level the last one ended at, for the same number of views", () => {
    const m = memory();
    keepLevel(m, 4, 3, 1000);
    expect(keptLevel(m, 4, 2000)).toBe(3);
    expect(keptLevel(m, 2, 2000)).toBe(0);
  });

  it("forgets after two weeks, and survives storage that is missing or broken", () => {
    const m = memory();
    keepLevel(m, 4, 2, 0);
    expect(keptLevel(m, 4, 15 * 24 * 3600 * 1000)).toBe(0);
    expect(keptLevel(null, 4)).toBe(0);
    expect(() => keepLevel({ getItem: () => "not json", setItem: () => { throw new Error("full"); } }, 4, 1)).not.toThrow();
    expect(keptLevel({ getItem: () => "{{" }, 4)).toBe(0);
  });

  it("lets pixels act only after the cheap steps", () => {
    const g = new LoadGovernor();
    expect(g.yields).toBe(false);
    g.reset(2);
    expect(g.yields).toBe(true);
  });
});
