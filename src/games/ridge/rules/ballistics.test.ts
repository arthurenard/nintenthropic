import { describe, expect, it } from "vitest";
import {
  drift,
  drop,
  holdMils,
  landingMils,
  rangeAt,
  rangeMarkMils,
  rangeUnderDot,
  ROUND,
  roundAt,
  sightFrame,
  speedAt,
  timeOfFlight,
  windMils,
  zeroAngle,
} from "./ballistics";

describe("the round in flight, against the design's numbers", () => {
  it("leaves the muzzle at 600 m/s and slows with drag", () => {
    expect(speedAt(0)).toBe(600);
    expect(speedAt(700)).toBeLessThan(600);
    expect(speedAt(700)).toBeGreaterThan(540);
  });

  it("takes 0.4 s to reach 250 m and 1.2 s to reach 700 m", () => {
    expect(timeOfFlight(250)).toBeGreaterThan(0.38);
    expect(timeOfFlight(250)).toBeLessThan(0.45);
    expect(timeOfFlight(700)).toBeGreaterThan(1.17);
    expect(timeOfFlight(700)).toBeLessThan(1.25);
    // Longer than it would take with no drag at all.
    expect(timeOfFlight(700)).toBeGreaterThan(700 / 600);
  });

  it("is zeroed at 150 m: it crosses the line of sight there, above it before and below after", () => {
    expect(drop(150)).toBeCloseTo(0, 9);
    expect(drop(75)).toBeLessThan(0);
    expect(drop(250)).toBeGreaterThan(0);
    expect(zeroAngle()).toBeGreaterThan(0);
  });

  it("falls 1.6 m below the line at 600 m held dead on", () => {
    expect(drop(600)).toBeCloseTo(1.6, 6);
  });

  it("falls a little at 250 m and a lot at 700 m", () => {
    // The table a player learns: about a hand below at 250, a man's height at 700.
    expect(drop(250)).toBeGreaterThan(0.08);
    expect(drop(250)).toBeLessThan(0.25);
    expect(drop(700)).toBeGreaterThan(2);
    expect(drop(700)).toBeLessThan(2.7);
    for (let x = 200; x < 1000; x += 50) expect(drop(x + 50)).toBeGreaterThan(drop(x));
  });

  it("is carried by the wind in proportion to the square of its time aloft", () => {
    expect(drift(600, 0)).toBe(0);
    expect(drift(600, 8)).toBeGreaterThan(1.1);
    expect(drift(600, 8)).toBeLessThan(1.8);
    expect(drift(600, -8)).toBeCloseTo(-drift(600, 8));
    const t300 = timeOfFlight(300);
    const t600 = timeOfFlight(600);
    expect(drift(600, 4) / drift(300, 4)).toBeCloseTo((t600 * t600) / (t300 * t300), 6);
  });

  it("finds its range from its time aloft and back", () => {
    for (const x of [50, 250, 600, 900, 1800]) expect(rangeAt(timeOfFlight(x))).toBeCloseTo(x, 6);
  });
});

describe("the scope's marks", () => {
  it("put the range marks at the drop for each range, a mark for every hundred metres past two hundred", () => {
    const marks = rangeMarkMils();
    expect(marks.map((m) => m.range)).toEqual([300, 400, 500, 600, 700, 800, 900]);
    for (const m of marks) expect(m.mils).toBeCloseTo((1000 * drop(m.range)) / m.range, 9);
    // Evenly enough spaced that "a mark higher for every hundred metres" is true.
    for (let i = 1; i < marks.length; i++) {
      const step = marks[i]!.mils - marks[i - 1]!.mils;
      expect(step).toBeGreaterThan(0.45);
      expect(step).toBeLessThan(0.8);
    }
    expect(holdMils(600)).toBeCloseTo((1000 * 1.6) / 600, 6);
  });

  it("put the holdover dot where the round lands", () => {
    const dir = { x: 0, y: -0.1, z: -1 };
    const n = Math.hypot(dir.x, dir.y, dir.z);
    const unit = { x: dir.x / n, y: dir.y / n, z: dir.z / n };
    const still = landingMils(450, unit, 0);
    expect(still.right).toBeCloseTo(0, 9);
    expect(still.down).toBeCloseTo(holdMils(450), 9);
    // A wind blowing to the right (+X) carries the round to the right of the reticle.
    const windy = landingMils(450, unit, 6);
    expect(windy.right).toBeGreaterThan(0);
    expect(windy.right).toBeCloseTo(windMils(450, 6), 2);
  });
});

describe("the round in the world", () => {
  it("follows the line of sight, below it by the drop and downwind by the drift", () => {
    const dir = { x: 0, y: 0, z: -1 };
    const f = sightFrame({ x: 0, y: 0, z: 0 }, dir, 5);
    const p = { x: 0, y: 0, z: 0 };
    roundAt(f, 600, p);
    expect(p.z).toBeCloseTo(-600, 6);
    expect(p.y).toBeCloseTo(-drop(600), 6);
    expect(p.x).toBeCloseTo(drift(600, 5), 6);
  });

  it("feels only the crosswind: a wind straight along the line carries nothing aside", () => {
    const f = sightFrame({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 7);
    const p = { x: 0, y: 0, z: 0 };
    roundAt(f, 400, p);
    expect(p.x).toBeCloseTo(400, 6);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it("uses the game's gravity, gentler than the Earth's, as the design's drop needs", () => {
    expect(ROUND.g).toBeGreaterThan(2);
    expect(ROUND.g).toBeLessThan(9.81);
  });
});

describe("Relaxed's holdover dot", () => {
  // A man 950 m off on a dam; above him the slope behind at 1,300 m, below him the dam's crest a few metres short.
  const dir = { x: 0, y: -0.06, z: -1 };
  const man = 950;
  const onHim = holdMils(man);
  const valley = (at: { right: number; down: number }) => (Math.abs(at.down - onHim) <= 1 ? man : at.down > onHim ? man - 15 : 1300);

  it("is worked out for where its own line lands, not for the hill behind the reticle", () => {
    // Held over him so the round lands on him: the reticle rests on the slope behind.
    expect(valley({ right: 0, down: 0 })).toBe(1300);
    const settled = rangeUnderDot(1300, dir, 0, valley);
    expect(settled).toBe(man);
    expect(landingMils(settled!, dir, 0).down).toBeCloseTo(onHim, 6);
  });

  it("stays as the rangefinder has it when the reticle is on what the dot falls on", () => {
    expect(rangeUnderDot(300, dir, 3, () => 300)).toBe(300);
    expect(rangeUnderDot(null, dir, 3, () => 300)).toBeNull();
    // A line into the sky keeps the last range it had.
    expect(rangeUnderDot(700, dir, 3, () => null)).toBe(700);
  });
});
