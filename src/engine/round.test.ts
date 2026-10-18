import { describe, expect, it } from "vitest";
import { CalibrationProxy, Schedule, type CalibrationTargets } from "./round";

describe("a game's schedule", () => {
  it("runs things on the game's own clock, holds them while it stands still, and forgets them when cleared", () => {
    let now = 0;
    const schedule = new Schedule(() => now);
    const ran: string[] = [];
    schedule.later(1, () => ran.push("bonus"));
    schedule.later(0.5, () => ran.push("toast"));
    now = 0.6;
    schedule.run();
    schedule.run();
    expect(ran).toEqual(["toast"]);
    schedule.later(5, () => ran.push("never"));
    now = 1;
    schedule.run();
    expect(ran).toEqual(["toast", "bonus"]);
    schedule.clear();
    now = 10;
    schedule.run();
    expect(ran).toEqual(["toast", "bonus"]);
  });

  it("leaves what a run asks for until the next frame", () => {
    const schedule = new Schedule(() => 0);
    const ran: string[] = [];
    schedule.later(0, () => {
      ran.push("first");
      schedule.later(0, () => ran.push("second"));
    });
    schedule.run();
    expect(ran).toEqual(["first"]);
    schedule.run();
    expect(ran).toEqual(["first", "second"]);
  });
});

describe("the aim check's stand-in", () => {
  it("shows nothing before the game's targets exist, then forwards to them and tells the game they are in use", () => {
    const proxy = new CalibrationProxy({ one: "bottle", many: "bottles" });
    let begun = 0;
    let used = 0;
    proxy.onBegin = () => begun++;
    proxy.onUse = () => used++;
    proxy.begin();
    expect(proxy.targets()).toEqual([]);
    const lit: (string | null)[] = [];
    const targets: CalibrationTargets = {
      targets: () => [{ id: "a", x: 0.5, y: 0.5, radius: 0.05 }],
      light: (id) => lit.push(id),
      hit: () => {},
      miss: () => {},
      done: () => {},
    };
    proxy.target = targets;
    expect(proxy.targets().map((t) => t.id)).toEqual(["a"]);
    proxy.light("a");
    expect(lit).toEqual(["a"]);
    expect([begun, used]).toEqual([1, 3]);
  });
});
