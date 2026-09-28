import { describe, expect, it } from "vitest";
import { Drone } from "./drone";
import { Glass } from "./panes";
import { DRONE_FLIGHT, DRONE_KNOCKED, DRONE_SETUP } from "./tuning";
import { v3 } from "./vec";

function run(d: Drone, g: Glass, seconds: number, working = true, rate = 6): string[] {
  const out: string[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const e = d.update(1 / 60, g, working, rate);
    if (e) out.push(e);
  }
  return out;
}

describe("the repair drone", () => {
  it("stays docked until it works and there is glass to mend", () => {
    const d = new Drone();
    const g = new Glass();
    g.strike(2, 30, v3(), 0);
    expect(run(d, g, 2, false)).toEqual([]);
    expect(d.state).toBe("docked");
    const g2 = new Glass();
    expect(run(d, g2, 2, true)).toEqual([]);
    expect(d.state).toBe("docked");
  });

  it("flies to the worst pane, sets up, and mends it at its rate", () => {
    const d = new Drone();
    const g = new Glass();
    g.strike(1, 10, v3(), 0);
    g.strike(4, 40, v3(), 0);
    expect(run(d, g, 0.1)).toEqual(["launch"]);
    expect(d.to).toBe(4);
    run(d, g, DRONE_FLIGHT + DRONE_SETUP - 0.05);
    expect(d.state).toBe("mending");
    expect(g.integrity[4]).toBeCloseTo(60, 0);
    run(d, g, 1);
    expect(g.integrity[4]).toBeCloseTo(66, 0);
  });

  it("moves on to the next pane, and goes home when the glass is whole", () => {
    const d = new Drone();
    const g = new Glass();
    g.strike(1, 10, v3(), 0);
    g.strike(4, 12, v3(), 0);
    const events = run(d, g, 20);
    expect(events).toContain("done");
    expect(events[events.length - 1]).toBe("home");
    expect(g.whole).toBe(true);
    expect(d.state).toBe("docked");
  });

  it("leaves a pane for one much worse", () => {
    const d = new Drone();
    const g = new Glass();
    g.strike(1, 20, v3(), 0);
    run(d, g, DRONE_FLIGHT + DRONE_SETUP + 0.2);
    expect(d.pane).toBe(1);
    g.strike(5, 60, v3(), 0);
    run(d, g, 0.1);
    expect(d.to).toBe(5);
  });

  it("is knocked spinning for twelve seconds when shot, and mends nothing meanwhile", () => {
    const d = new Drone();
    const g = new Glass();
    g.strike(3, 50, v3(), 0);
    run(d, g, DRONE_FLIGHT + DRONE_SETUP + 0.5);
    d.shot();
    expect(d.knocked).toBe(true);
    expect(d.hitThisPass).toBe(true);
    const before = g.integrity[3]!;
    run(d, g, DRONE_KNOCKED - 0.1);
    expect(g.integrity[3]).toBe(before);
    expect(run(d, g, 0.2)).toEqual(["back"]);
    expect(d.state).toBe("flying");
  });
});
