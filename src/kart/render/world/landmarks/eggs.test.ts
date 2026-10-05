import { Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clockAngles } from "./clock";
import { DUCK_DAY, duckAt, duckPose, flyDuck, resetDuck } from "./duckFlight";
import { LANDMARKS } from "./index";

const TAU = Math.PI * 2;
const context = { rnd: () => 0.5, theme: "kitchen" as const, night: false, scale: 1, span: 0, halfWidth: 7 };

afterEach(() => {
  vi.useRealTimers();
  resetDuck();
});

describe("the wall clock", () => {
  it("reads the time it is: the hour hand creeps with the minutes", () => {
    const at = (h: number, m: number, s = 0, ms = 0) => clockAngles(new Date(2026, 9, 5, h, m, s, ms));
    expect(at(0, 0).hour).toBeCloseTo(0, 6);
    expect(at(3, 0).hour).toBeCloseTo(TAU / 4, 6);
    expect(at(15, 0).hour).toBeCloseTo(TAU / 4, 6);
    expect(at(10, 10).hour).toBeCloseTo(((10 + 10 / 60) / 12) * TAU, 6);
    expect(at(10, 10).minute).toBeCloseTo((10 / 60) * TAU, 6);
    expect(at(6, 30).minute).toBeCloseTo(TAU / 2, 6);
    expect(at(6, 30).hour).toBeCloseTo(((6.5) / 12) * TAU, 6);
  });

  it("ticks the second hand once a second, settling quickly", () => {
    const second = (s: number, ms: number) => clockAngles(new Date(2026, 9, 5, 12, 0, s, ms)).second;
    // It sits on the second that has struck...
    expect(second(15, 600)).toBeCloseTo(TAU / 4, 6);
    expect(second(15, 999)).toBeCloseTo(TAU / 4, 6);
    // ...and moves on to the next in the first moments of it.
    expect(second(16, 0)).toBeCloseTo(TAU / 4, 6);
    expect(second(16, 40)).toBeGreaterThan(TAU / 4);
    expect(second(16, 40)).toBeLessThan((16 / 60) * TAU);
    expect(second(16, 300)).toBeCloseTo((16 / 60) * TAU, 6);
  });

  it("turns the hands of the kitchen's clock to the time it is now", () => {
    const parts = LANDMARKS["wall-clock"]!.build(context).moving!;
    expect(parts).toHaveLength(3);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 4, 20, 30, 500));
    const [hour, minute, second] = parts.map((part) => {
      const node = new Object3D();
      part.update(0, node);
      return node.rotation.z;
    });
    const now = clockAngles(new Date());
    expect(hour).toBeCloseTo(-now.hour, 9);
    expect(minute).toBeCloseTo(-now.minute, 9);
    expect(second).toBeCloseTo(-now.second, 9);
    // Later, the minute hand has moved on, however the race clock stands.
    vi.setSystemTime(new Date(2026, 9, 5, 4, 35, 0, 0));
    const later = new Object3D();
    parts[1]!.update(0, later);
    expect(later.rotation.z).toBeCloseTo(-(35 / 60) * TAU, 9);
  });
});

describe("the duck's day out", () => {
  it("squeaks, turns and flies off, is gone for a while, paddles back, and is itself again", () => {
    expect(duckPose(-1, 0)).toBeNull();
    expect(duckPose(DUCK_DAY.home + 0.01, 0)).toBeNull();
    // The squeak: squashed, hopping, turning round.
    const squeak = duckPose(DUCK_DAY.squeak / 2, 0)!;
    expect(squeak.visible).toBe(true);
    expect(squeak.squash).toBeLessThan(1);
    expect(squeak.y).toBeGreaterThan(0.5);
    // In the air: far from where it was, high, away from the road (negative z), facing the way it goes.
    const flying = duckPose((DUCK_DAY.squeak + DUCK_DAY.flying) / 2 + 0.5, 0)!;
    expect(flying.visible).toBe(true);
    expect(flying.z).toBeLessThan(-20);
    expect(flying.y).toBeGreaterThan(10);
    expect(flying.yaw).toBeCloseTo(Math.PI, 6);
    // Gone.
    expect(duckPose((DUCK_DAY.flying + DUCK_DAY.away) / 2, 0)!.visible).toBe(false);
    // Coming back from behind, nearer and nearer, facing the road.
    const back = [0.05, 0.4, 0.8].map((g) => duckPose(DUCK_DAY.away + g * (DUCK_DAY.home - DUCK_DAY.away), 0)!);
    expect(back.every((pose) => pose.visible)).toBe(true);
    expect(back[0]!.z).toBeLessThan(back[1]!.z);
    expect(back[1]!.z).toBeLessThan(back[2]!.z);
    expect(back[2]!.z).toBeLessThanOrEqual(0);
    expect(Math.abs(duckPose(DUCK_DAY.home - 0.001, 3)!.z)).toBeLessThan(0.05);
  });

  it("takes off once, when it is found, and not again until it is home", () => {
    expect(duckAt(5)).toBeNull();
    expect(flyDuck(10)).toBe(true);
    expect(flyDuck(12)).toBe(false);
    expect(duckAt(10.1)!.visible).toBe(true);
    expect(duckAt(10 + DUCK_DAY.flying + 1)!.visible).toBe(false);
    expect(duckAt(10 + DUCK_DAY.home + 1)).toBeNull();
    expect(flyDuck(10 + DUCK_DAY.home + 1)).toBe(true);
    resetDuck();
    expect(duckAt(11)).toBeNull();
  });

  it("is what the duck's own model does", () => {
    const part = LANDMARKS["rubber-duck"]!.build({ ...context, theme: "meadow" }).moving![0]!;
    const node = new Object3D();
    part.update(1, node);
    expect(node.visible).toBe(true);
    expect(Math.abs(node.position.z)).toBeLessThan(1e-9);
    flyDuck(1);
    part.update(1 + DUCK_DAY.squeak + 1, node);
    expect(node.position.z).toBeLessThan(-1);
    expect(node.rotation.y).toBeCloseTo(Math.PI, 6);
    part.update(1 + (DUCK_DAY.flying + DUCK_DAY.away) / 2, node);
    expect(node.visible).toBe(false);
    part.update(1 + DUCK_DAY.home + 0.5, node);
    expect(node.visible).toBe(true);
    expect(node.position.z).toBe(0);
    expect(node.scale.y).toBe(1);
  });
});
