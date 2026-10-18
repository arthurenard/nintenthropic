import { describe, expect, it } from "vitest";
import { FrameStats, watchPixelRatio } from "./host";

describe("the frame timings", () => {
  it("leaves out the loop's first frame, whose time can come before the loop began", () => {
    const stats = new FrameStats();
    stats.record(-180, 2); // the browser began this frame before start(), during a long load
    stats.record(0, 2);
    for (let i = 0; i < 10; i++) stats.record(16.7, 1);
    const s = stats.summary();
    expect(s.frames).toBe(10);
    expect(s.interval.mean).toBeCloseTo(16.7, 6);
  });

  it("leaves out a hitch", () => {
    const stats = new FrameStats();
    stats.record(16.7, 1);
    stats.record(900, 1);
    expect(stats.summary().frames).toBe(1);
  });
});

/** A window whose pixel ratio the test moves, with media queries that hear of it. */
function fakeScreen(ratio: number) {
  const listeners: { query: string; callback: () => void }[] = [];
  const scope = {
    devicePixelRatio: ratio,
    matchMedia(query: string) {
      return {
        addEventListener(_type: string, callback: () => void) {
          listeners.push({ query, callback });
        },
      } as unknown as MediaQueryList;
    },
  };
  return {
    scope: scope as unknown as Pick<Window, "devicePixelRatio" | "matchMedia">,
    queries: () => listeners.map((l) => l.query),
    /** The window moves to a screen of another density: the queries that no longer match say so, once. */
    move(next: number) {
      scope.devicePixelRatio = next;
      const due = listeners.splice(0);
      for (const l of due) l.callback();
    },
  };
}

describe("the pixel ratio watch", () => {
  it("hears every move to a screen of another density, not just the first", () => {
    const screen = fakeScreen(1);
    let changes = 0;
    watchPixelRatio(() => changes++, screen.scope);
    expect(screen.queries()).toEqual(["(resolution: 1dppx)"]);
    screen.move(2);
    expect(changes).toBe(1);
    expect(screen.queries()).toEqual(["(resolution: 2dppx)"]);
    screen.move(1.5);
    expect(changes).toBe(2);
    expect(screen.queries()).toEqual(["(resolution: 1.5dppx)"]);
  });

  it("does nothing where media queries cannot be asked", () => {
    expect(() => watchPixelRatio(() => {}, { devicePixelRatio: 2 } as unknown as Window)).not.toThrow();
  });
});
