import { describe, expect, it } from "vitest";
import { LastOne, Spotter, type SpotterSays } from "./spotter";
import { LAST_ONE_AFTER, LAST_ONE_REPEAT, SPOTTER_DELAY, SPOTTER_FIRST, SPOTTER_LOST, SPOTTER_REPEAT } from "./tuning";

/** Steps the spotter for `seconds` at 10 Hz; returns everything he said. */
function step(spotter: Spotter, seconds: number, { fighting = true, scoped = false, inGlass = false, directions = true } = {}): SpotterSays[] {
  const said: SpotterSays[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    const says = spotter.update(0.1, fighting, scoped, inGlass, directions);
    if (says) said.push(says);
  }
  return said;
}

describe("the spotter", () => {
  it("tells where, once, when the fight is a few seconds old and nobody has been found", () => {
    const spotter = new Spotter();
    spotter.begin(1);
    expect(step(spotter, SPOTTER_FIRST - 1)).toEqual([]);
    expect(step(spotter, 2)).toEqual(["tell"]);
    expect(step(spotter, 60)).toEqual([]);
  });

  it("waits longer after the first stage", () => {
    const spotter = new Spotter();
    spotter.begin(4);
    expect(step(spotter, SPOTTER_DELAY - 1)).toEqual([]);
    expect(step(spotter, 2)).toEqual(["tell"]);
    // A new stage starts afresh.
    spotter.begin(5);
    expect(step(spotter, SPOTTER_DELAY - 1)).toEqual([]);
    expect(step(spotter, 2)).toEqual(["tell"]);
  });

  it("keeps quiet for a player who has found them, and counts only the fight", () => {
    const spotter = new Spotter();
    spotter.begin(3);
    // The intro and the breathers are not the fight.
    expect(step(spotter, 60, { fighting: false })).toEqual([]);
    // A moment in the glass is not finding (a glance past); half a second is.
    step(spotter, 0.2, { scoped: true, inGlass: true });
    expect(spotter.hasFound).toBe(false);
    step(spotter, 0.5, { scoped: true, inGlass: true });
    expect(spotter.hasFound).toBe(true);
    expect(step(spotter, 120, { scoped: true })).toEqual([]);
  });

  it("tells a scope that is looking at nothing which way to turn, now and then, until it finds them", () => {
    const spotter = new Spotter();
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
    // Unscoped time does not count toward being lost.
    const wide = new Spotter();
    wide.begin(3);
    expect(step(wide, SPOTTER_LOST * 2)).toEqual([]);
  });

  it("leaves the turning to the scope's rim arrow when there is one, and still says where the men are", () => {
    const spotter = new Spotter();
    spotter.begin(1);
    // With Aim Assist on the arrow on the rim says which way to pan: no word of it, however long the scope looks at nothing.
    expect(step(spotter, 60, { scoped: true, directions: false })).toEqual(["tell"]);
  });
});

/** Steps the last-man tracker for `seconds` at 10 Hz; returns what it said. */
function walk(last: LastOne, seconds: number, who: number | null, found = false, fighting = true): "tell"[] {
  const said: "tell"[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    const says = last.update(0.1, fighting, who, found);
    if (says) said.push(says);
  }
  return said;
}

describe("the last man", () => {
  it("is helped when he has not been found for a while: his mark breathes, and the spotter says where, once", () => {
    const last = new LastOne();
    expect(walk(last, LAST_ONE_AFTER - 1, 7)).toEqual([]);
    expect(last.pulsing).toBeNull();
    expect(walk(last, 2, 7)).toEqual(["tell"]);
    expect(last.pulsing).toBe(7);
    // Said once, not over and over...
    expect(walk(last, LAST_ONE_REPEAT - 4, 7)).toEqual([]);
    expect(last.pulsing).toBe(7);
    // ... and again if he is still not found a good while later.
    expect(walk(last, 6, 7)).toEqual(["tell"]);
  });

  it("starts the wait over when the player finds him, and counts a glance past as nothing", () => {
    const last = new LastOne();
    walk(last, LAST_ONE_AFTER + 1, 7);
    expect(last.pulsing).toBe(7);
    // A glance across him: the help stays.
    walk(last, 0.2, 7, true);
    expect(last.pulsing).toBe(7);
    // Held on him for a moment: found. The breathing stops, and the clock starts again.
    walk(last, 0.6, 7, true);
    expect(last.pulsing).toBeNull();
    expect(walk(last, LAST_ONE_AFTER - 1, 7)).toEqual([]);
    expect(walk(last, 2, 7)).toEqual(["tell"]);
  });

  it("is only for the one man left of several, and only in the fight", () => {
    const last = new LastOne();
    expect(walk(last, 60, null)).toEqual([]);
    expect(last.pulsing).toBeNull();
    // The intro and the breathers do not count.
    expect(walk(last, 60, 7, false, false)).toEqual([]);
    expect(last.pulsing).toBeNull();
    // A different man being left (or the stage beginning again) starts the wait over.
    walk(last, LAST_ONE_AFTER + 1, 7);
    expect(last.pulsing).toBe(7);
    expect(walk(last, 1, 8)).toEqual([]);
    expect(last.pulsing).toBeNull();
    last.begin();
    expect(last.pulsing).toBeNull();
  });
});
