import { describe, expect, it } from "vitest";
import { Spotter, type SpotterSays } from "./spotter";
import { SPOTTER_DELAY, SPOTTER_FIRST, SPOTTER_LOST, SPOTTER_REPEAT, SPOTTER_STAGES } from "./tuning";

/** Steps the spotter for `seconds` at 10 Hz; returns everything he said. */
function step(spotter: Spotter, seconds: number, { fighting = true, scoped = false, inGlass = false } = {}): SpotterSays[] {
  const said: SpotterSays[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    const says = spotter.update(0.1, fighting, scoped, inGlass);
    if (says) said.push(says);
  }
  return said;
}

describe("the spotter", () => {
  it("marks the men in the first stages on Standard, and every stage on Relaxed", () => {
    const standard = new Spotter("standard");
    for (let stage = 1; stage <= SPOTTER_STAGES; stage++) {
      standard.begin(stage);
      expect(standard.marking).toBe(true);
    }
    standard.begin(SPOTTER_STAGES + 1);
    expect(standard.marking).toBe(false);
    const relaxed = new Spotter("relaxed");
    relaxed.begin(7);
    expect(relaxed.marking).toBe(true);
  });

  it("tells where, once, when the fight is a few seconds old and nobody has been found", () => {
    const spotter = new Spotter("standard");
    spotter.begin(1);
    expect(step(spotter, SPOTTER_FIRST - 1)).toEqual([]);
    expect(step(spotter, 2)).toEqual(["tell"]);
    expect(step(spotter, 60)).toEqual([]);
  });

  it("waits longer after the first stage, and then marks them whatever the stage", () => {
    const spotter = new Spotter("standard");
    spotter.begin(4);
    expect(spotter.marking).toBe(false);
    expect(step(spotter, SPOTTER_DELAY - 1)).toEqual([]);
    expect(spotter.marking).toBe(false);
    expect(step(spotter, 2)).toEqual(["tell"]);
    expect(spotter.marking).toBe(true);
    // A new stage starts afresh.
    spotter.begin(5);
    expect(spotter.marking).toBe(false);
  });

  it("keeps quiet for a player who has found them, and counts only the fight", () => {
    const spotter = new Spotter("standard");
    spotter.begin(3);
    // The intro and the breathers are not the fight.
    expect(step(spotter, 60, { fighting: false })).toEqual([]);
    // A moment in the glass is not finding (a glance past); half a second is.
    step(spotter, 0.2, { scoped: true, inGlass: true });
    expect(spotter.hasFound).toBe(false);
    step(spotter, 0.5, { scoped: true, inGlass: true });
    expect(spotter.hasFound).toBe(true);
    expect(step(spotter, 120, { scoped: true })).toEqual([]);
    expect(spotter.marking).toBe(false);
  });

  it("tells a scope that is looking at nothing which way to turn, now and then, until it finds them", () => {
    const spotter = new Spotter("standard");
    spotter.begin(1);
    // Looking through the scope at nothing: told after a while, not at once.
    expect(step(spotter, SPOTTER_LOST - 1, { scoped: true })).toEqual([]);
    expect(step(spotter, 2, { scoped: true })).toEqual(["lost"]);
    // Not again at once (he does not talk over himself, and the telling waits for it too)...
    expect(step(spotter, SPOTTER_REPEAT - 3, { scoped: true })).toEqual([]);
    // ... but again, and again, while it looks at nothing.
    const later = step(spotter, 60, { scoped: true });
    expect(later.filter((says) => says === "lost").length).toBeGreaterThanOrEqual(2);
    expect(later.filter((says) => says === "tell")).toHaveLength(1);
    // Found, he is quiet.
    step(spotter, 1, { scoped: true, inGlass: true });
    expect(step(spotter, 60, { scoped: true })).toEqual([]);
    // A stage that is not marking says nothing of the sort.
    const quiet = new Spotter("standard");
    quiet.begin(4);
    expect(step(quiet, 10, { scoped: true })).toEqual([]);
    // Unscoped time does not count toward being lost.
    const wide = new Spotter("relaxed");
    wide.begin(3);
    expect(step(wide, SPOTTER_LOST * 2)).toEqual([]);
  });
});
