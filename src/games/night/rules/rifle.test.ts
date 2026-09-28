import { describe, expect, it } from "vitest";
import { Rifle } from "./rifle";
import { LEVER_TIME, RELOAD_LEVER, RIFLE_CAPACITY, ROUND_TIME } from "./tuning";

const DT = 1 / 120;

function run(r: Rifle, seconds: number, offscreen = false) {
  const tally = { started: 0, roundsIn: 0, chambered: 0, done: 0 };
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const e = r.update(DT, offscreen);
    if (e.started) tally.started++;
    tally.roundsIn += e.roundsIn;
    if (e.chambered) tally.chambered++;
    if (e.done) tally.done++;
  }
  return tally;
}

describe("the lever-action", () => {
  it("holds eight, one in the chamber", () => {
    const r = new Rifle();
    expect(r.capacity).toBe(8);
    expect(r.rounds).toBe(RIFLE_CAPACITY);
    expect(r.action).toBe("ready");
  });

  it("works the lever after each shot, and cannot fire until it is back", () => {
    const r = new Rifle();
    expect(r.trigger()).toBe("fired");
    expect(r.rounds).toBe(7);
    expect(r.action).toBe("cycling");
    expect(r.trigger()).toBe("busy");
    const t = run(r, LEVER_TIME + 0.02);
    expect(t.chambered).toBe(1);
    expect(r.action).toBe("ready");
    expect(r.trigger()).toBe("fired");
  });

  it("leaves the action open after the last round, and clicks dry", () => {
    const r = new Rifle();
    for (let i = 0; i < 8; i++) {
      expect(r.trigger()).toBe("fired");
      run(r, LEVER_TIME + 0.02);
    }
    expect(r.rounds).toBe(0);
    expect(r.action).toBe("open");
    expect(r.trigger()).toBe("dry");
    expect(r.trigger()).toBe("dry");
  });

  it("loads an empty rifle round by round in 1.2 s, working the lever at the end", () => {
    const r = new Rifle();
    for (let i = 0; i < 8; i++) {
      r.trigger();
      run(r, LEVER_TIME + 0.02);
    }
    expect(r.reload()).toBe(true);
    expect(r.reload()).toBe(false);
    expect(r.trigger()).toBe("busy");
    const early = run(r, 8 * ROUND_TIME + RELOAD_LEVER - 0.03);
    expect(r.reloading).toBe(true);
    const late = run(r, 0.06);
    expect(early.roundsIn + late.roundsIn).toBe(8);
    expect(late.done).toBe(1);
    expect(early.chambered + late.chambered).toBe(1);
    expect(8 * ROUND_TIME + RELOAD_LEVER).toBeCloseTo(1.2, 6);
    expect(r.rounds).toBe(8);
    expect(r.action).toBe("ready");
  });

  it("tops up a part-empty tube with a round in the chamber, without the lever", () => {
    const r = new Rifle();
    for (let i = 0; i < 3; i++) {
      r.trigger();
      run(r, LEVER_TIME + 0.02);
    }
    expect(r.rounds).toBe(5);
    r.reload();
    const t = run(r, 3 * ROUND_TIME + 0.02);
    expect(t.roundsIn).toBe(3);
    expect(t.done).toBe(1);
    expect(t.chambered).toBe(0);
    expect(r.rounds).toBe(8);
  });

  it("reloads on the moment the aim leaves the screen, not while it stays off", () => {
    const r = new Rifle();
    r.trigger();
    run(r, LEVER_TIME + 0.02);
    const t = run(r, 1.5, true);
    expect(t.started).toBe(1);
    expect(t.done).toBe(1);
    expect(r.rounds).toBe(8);
    // Still off the screen with a full rifle: nothing more.
    expect(run(r, 0.5, true).started).toBe(0);
  });

  it("has nothing to do when full", () => {
    const r = new Rifle();
    expect(r.reload()).toBe(false);
  });

  it("lets a lever mid-stroke finish before the rounds go in", () => {
    const r = new Rifle();
    r.trigger();
    expect(r.reload()).toBe(true);
    const t = run(r, LEVER_TIME + ROUND_TIME + 0.02);
    expect(t.chambered).toBe(1);
    expect(t.roundsIn).toBe(1);
  });
});
