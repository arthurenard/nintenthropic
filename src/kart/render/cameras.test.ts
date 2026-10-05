import { describe, expect, it } from "vitest";
import type { KartView, RaceView } from "../contract";
import { MEADOW_LOOP } from "../track/tracks";
import { baseFov, chaseOffsets, ChaseCamera, COUNTDOWN_SPAN } from "./cameras";

function kart(over: Partial<KartView> = {}): KartView {
  return {
    id: 0, x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, item: null, itemUses: 0, rolling: false, place: 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
    ...over,
  };
}

function view(phase: RaceView["phase"], countdown = 0): RaceView {
  return { tick: 0, phase, countdown, time: 0, laps: 3, track: MEADOW_LOOP, racers: [], karts: [], things: [], events: [] };
}

describe("baseFov", () => {
  it("stays within sensible limits for any shape of viewport", () => {
    for (const aspect of [0.5, 1, 1.6, 2.4, 3.2, 5]) {
      const f = baseFov(aspect);
      expect(f).toBeGreaterThanOrEqual(50);
      expect(f).toBeLessThanOrEqual(66);
    }
  });
  it("narrows as the view gets wider", () => {
    expect(baseFov(3.2)).toBeLessThanOrEqual(baseFov(1.6));
  });
});

describe("chaseOffsets", () => {
  it("trails farther and rides higher with speed and boost", () => {
    const slow = chaseOffsets(0, 0);
    const fast = chaseOffsets(1, 0);
    expect(fast.distance).toBeGreaterThan(slow.distance);
    expect(fast.height).toBeGreaterThan(slow.height);
    expect(chaseOffsets(1, 1).distance).toBeGreaterThan(fast.distance);
  });
});

describe("ChaseCamera", () => {
  it("sits behind the kart, looking along its heading", () => {
    const c = new ChaseCamera();
    const k = kart({ x: 10, z: 20, heading: 0, speed: 20 });
    for (let i = 0; i < 90; i++) c.update(k, view("racing"), 1 / 60, 1.6);
    expect(c.camera.position.z).toBeLessThan(k.z - 4);
    expect(Math.abs(c.camera.position.x - k.x)).toBeLessThan(0.5);
    expect(c.camera.position.y).toBeGreaterThan(k.y + 2);
  });

  it("starts high over the grid in the countdown and comes down by the green", () => {
    const c = new ChaseCamera();
    const k = kart();
    c.update(k, view("countdown", COUNTDOWN_SPAN), 1 / 60, 1.6);
    const high = c.camera.position.y;
    c.update(k, view("countdown", 0.02), 1 / 60, 1.6);
    const low = c.camera.position.y;
    expect(high).toBeGreaterThan(low + 8);
  });

  it("does not whirl with a spinning kart", () => {
    const c = new ChaseCamera();
    // Driving straight along +z at 20 m/s while the heading spins round.
    let z = 0;
    for (let i = 0; i < 60; i++) {
      z += 20 / 60;
      c.update(kart({ z, heading: 0, speed: 20 }), view("racing"), 1 / 60, 1.6);
    }
    const before = c.camera.position.clone();
    for (let i = 0; i < 60; i++) {
      z += 20 / 60;
      c.update(kart({ z, heading: (i / 60) * Math.PI * 4, speed: 20, spin: 1 - i / 60 }), view("racing"), 1 / 60, 1.6);
    }
    // The camera stayed behind the kart on the line of travel, within a few metres either side.
    expect(Math.abs(c.camera.position.x - before.x)).toBeLessThan(2.5);
    expect(c.camera.position.z).toBeLessThan(z - 3);
  });
});
