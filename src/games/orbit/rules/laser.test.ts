import { describe, expect, it } from "vitest";
import { Laser } from "./laser";
import { COOL_DELAY, COOL_RATE, HEAT_PER_SHOT, OVERHEAT_LOCK, SHOT_INTERVAL, VENT_TIME } from "./tuning";

function step(l: Laser, seconds: number, offscreen = false): string[] {
  const events: string[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const e = l.update(1 / 60, offscreen);
    if (e) events.push(e);
  }
  return events;
}

/** Fire as fast as the laser allows, `n` times. */
function burst(l: Laser, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(l.trigger());
    step(l, SHOT_INTERVAL + 0.01);
  }
  return out;
}

describe("the laser", () => {
  it("never runs out: every shot adds heat instead", () => {
    const l = new Laser();
    expect(l.trigger()).toBe("fired");
    expect(l.heat).toBeCloseTo(HEAT_PER_SHOT, 6);
  });

  it("overheats in a burst and locks for two and a half seconds", () => {
    const l = new Laser();
    const shots = burst(l, 12);
    const fired = shots.filter((s) => s === "fired").length;
    expect(fired).toBe(Math.ceil(1 / HEAT_PER_SHOT - 1e-9));
    expect(shots).toContain("overheated");
    expect(l.locked).toBe(true);
    const events = step(l, OVERHEAT_LOCK);
    expect(events).toContain("cooled");
    expect(l.locked).toBe(false);
    expect(l.trigger()).toBe("fired");
  });

  it("vents at once when the aim goes off the screen, and cuts a lock short", () => {
    const l = new Laser();
    burst(l, 8);
    expect(l.locked).toBe(true);
    expect(step(l, 1 / 60, true)).toEqual(["vent"]);
    expect(l.venting).toBe(true);
    expect(l.trigger()).toBe("venting");
    // Held off the screen, it vents once, not again and again.
    const events = step(l, VENT_TIME + 0.05, true);
    expect(events).toEqual(["vented"]);
    expect(l.heat).toBe(0);
    expect(l.locked).toBe(false);
    expect(l.trigger()).toBe("fired");
  });

  it("vents by key too, but only with something to vent", () => {
    const l = new Laser();
    expect(l.vent()).toBe(false);
    l.trigger();
    expect(l.vent()).toBe(true);
  });

  it("cools by itself after a moment's rest", () => {
    const l = new Laser();
    burst(l, 3);
    const hot = l.heat;
    step(l, COOL_DELAY * 0.5);
    expect(l.heat).toBeCloseTo(hot, 6);
    step(l, COOL_DELAY + 1);
    expect(l.heat).toBeLessThan(hot - COOL_RATE * 0.9);
  });

  it("keeps a rhythm: no two shots closer than its interval", () => {
    const l = new Laser();
    expect(l.trigger()).toBe("fired");
    expect(l.trigger()).toBe("rhythm");
    step(l, SHOT_INTERVAL + 0.01);
    expect(l.trigger()).toBe("fired");
  });

  it("heats more slowly on Relaxed's factor, and not at all in the aim check", () => {
    const relaxed = new Laser(0.75);
    relaxed.trigger();
    expect(relaxed.heat).toBeCloseTo(HEAT_PER_SHOT * 0.75, 6);
    const check = new Laser();
    check.cold = true;
    burst(check, 20);
    expect(check.heat).toBe(0);
    expect(check.locked).toBe(false);
  });
});
