import { describe, expect, it } from "vitest";
import { Scorer } from "./scoring";
import { distanceMultiplier } from "./tuning";

describe("scoring", () => {
  it("pays for distance: ×1 up to 200 m, ×2 at 600 m", () => {
    expect(distanceMultiplier(150)).toBe(1);
    expect(distanceMultiplier(200)).toBe(1);
    expect(distanceMultiplier(600)).toBe(2);
    expect(distanceMultiplier(900)).toBeCloseTo(2.75);
  });

  it("scores each kind of kill at its own price, times the distance", () => {
    const s = new Scorer();
    expect(s.kill("headshot", 200, false).points).toBe(150);
    expect(s.kill("body", 200, false).points).toBe(80);
    expect(s.kill("driver", 600, false).points).toBe(500);
    expect(s.kill("sniper", 200, false).points).toBe(500);
    expect(s.kill("officer", 600, false).points).toBe(1600);
    expect(s.engineStop(200).points).toBe(300);
    expect(s.kills).toBe(5);
    expect(s.headshots).toBe(1);
    expect(s.longest).toBe(600);
  });

  it("builds One Shot, One Kill from ×1 to ×4, and a miss or a wound resets it", () => {
    const s = new Scorer();
    const pts = [0, 0, 0, 0, 0].map(() => s.kill("headshot", 200, true).points);
    expect(pts).toEqual([150, 300, 450, 600, 600]);
    s.breakStreak();
    expect(s.kill("headshot", 200, true).points).toBe(150);
    // A kill that took two rounds pays at the streak's rate but does not build it.
    expect(s.kill("body", 200, false).points).toBe(160);
    expect(s.multiplier).toBe(2);
    expect(s.bestStreak).toBe(5);
  });

  it("charges for a civilian and for an animal, and says who", () => {
    const s = new Scorer();
    s.kill("officer", 200, true);
    expect(s.civilian()).toEqual({ points: -500, labels: ["Civilian"] });
    expect(s.animal("Cow")).toEqual({ points: -100, labels: ["Cow"] });
    expect(s.score).toBe(200);
    expect(s.multiplier).toBe(1);
  });

  it("ends a stage with accuracy, Ghost, Clean Conscience and the time left", () => {
    const s = new Scorer();
    s.beginStage();
    for (let i = 0; i < 4; i++) s.shot();
    for (let i = 0; i < 3; i++) s.hit();
    const b = s.endStage(true, 12.4);
    expect(b.accuracy).toBeCloseTo(0.75);
    expect(b.accuracyPoints).toBe(225);
    expect(b.ghost).toBe(500);
    expect(b.cleanConscience).toBe(250);
    expect(b.time).toBe(124);
    expect(b.total).toBe(225 + 500 + 250 + 124);
    s.beginStage();
    s.shot();
    s.civilian();
    const c = s.endStage(false, null);
    expect(c.ghost).toBe(0);
    expect(c.cleanConscience).toBe(0);
    expect(c.time).toBe(0);
  });
});
