import { describe, expect, it } from "vitest";
import { Rifle } from "./rifle";
import { BOLT_TIME, MAGAZINE, RELOAD_TIME } from "./tuning";

function run(r: Rifle, seconds: number): string[] {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const e = r.update(1 / 60);
    if (e) events.push(e);
  }
  return events;
}

describe("the bolt-action rifle", () => {
  it("holds five rounds, one in the chamber, ready to fire", () => {
    const r = new Rifle();
    expect(r.capacity).toBe(5);
    expect(MAGAZINE).toBe(5);
    expect(r.rounds).toBe(5);
    expect(r.chambered).toBe(true);
    expect(r.style()).toEqual({ kind: "magazine", chambered: true, action: "ready" });
  });

  it("will not fire again until the bolt is worked, and the bolt takes 0.6 s", () => {
    const r = new Rifle();
    expect(r.trigger()).toBe("fired");
    expect(r.rounds).toBe(4);
    expect(r.state).toBe("spent");
    // A spent case in the chamber: the page shows the breech empty, the action closed.
    expect(r.style()).toEqual({ kind: "magazine", chambered: false, action: "ready" });
    expect(r.trigger()).toBe("spent");
    expect(r.cycle()).toBe(true);
    expect(r.style().action).toBe("cycling");
    expect(r.trigger()).toBe("busy");
    expect(run(r, BOLT_TIME - 0.05)).toEqual([]);
    expect(run(r, 0.1)).toEqual(["cycled"]);
    expect(r.trigger()).toBe("fired");
  });

  it("does nothing for a thumb raised with no spent case to eject", () => {
    const r = new Rifle();
    expect(r.cycle()).toBe(false);
    r.trigger();
    expect(r.cycle()).toBe(true);
    expect(r.cycle()).toBe(false);
  });

  it("opens on an empty magazine after the last round, and clicks dry", () => {
    const r = new Rifle();
    for (let i = 0; i < 5; i++) {
      expect(r.trigger()).toBe("fired");
      r.cycle();
      run(r, BOLT_TIME + 0.05);
    }
    expect(r.rounds).toBe(0);
    expect(r.state).toBe("open");
    expect(r.style()).toEqual({ kind: "magazine", chambered: false, action: "open" });
    expect(r.trigger()).toBe("dry");
  });

  it("strips a clip in over two seconds, from empty or topped up, but not when full", () => {
    const r = new Rifle();
    expect(r.reload()).toBe(false);
    r.trigger();
    r.cycle();
    run(r, 1);
    expect(r.reload()).toBe(true);
    expect(r.reloading).toBe(true);
    expect(r.trigger()).toBe("busy");
    expect(r.reload()).toBe(false);
    expect(run(r, RELOAD_TIME - 0.05)).toEqual([]);
    expect(run(r, 0.1)).toEqual(["reloaded"]);
    expect(r.rounds).toBe(5);
    expect(r.chambered).toBe(true);
  });
});
