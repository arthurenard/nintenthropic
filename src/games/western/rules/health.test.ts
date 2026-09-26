import { describe, expect, it } from "vitest";
import { damageDirection, PlayerHealth } from "./health";

function run(h: PlayerHealth, seconds: number, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) h.update(dt);
}

describe("regenerating health", () => {
  it("dies to three hits of 34 in quick succession", () => {
    const h = new PlayerHealth();
    expect(h.hit(34)).toBe(false);
    run(h, 0.5);
    expect(h.hit(34)).toBe(false);
    run(h, 0.5);
    expect(h.hit(34)).toBe(true);
    expect(h.dead).toBe(true);
  });

  it("waits 3.5 s after a hit, then refills at 40 per second", () => {
    const h = new PlayerHealth();
    h.hit(60);
    run(h, 3.4);
    expect(h.value).toBeCloseTo(40);
    run(h, 0.1);
    expect(h.value).toBeCloseTo(40, 0);
    run(h, 0.5);
    expect(h.value).toBeCloseTo(60, 0);
    run(h, 1.0);
    expect(h.value).toBeCloseTo(100);
  });

  it("restarts the wait on every hit", () => {
    const h = new PlayerHealth();
    h.hit(34);
    run(h, 3);
    h.hit(10);
    run(h, 3);
    expect(h.value).toBeCloseTo(56);
  });

  it("regenerates the same at any frame rate", () => {
    const a = new PlayerHealth();
    const b = new PlayerHealth();
    a.hit(50);
    b.hit(50);
    run(a, 4.5, 1 / 30);
    run(b, 4.5, 1 / 144);
    expect(a.value).toBeCloseTo(b.value, 0);
  });

  it("reports hurt from 0 to 1 and stays dead", () => {
    const h = new PlayerHealth();
    expect(h.hurt).toBe(0);
    h.hit(50);
    expect(h.hurt).toBeCloseTo(0.5);
    h.hit(100);
    expect(h.hurt).toBe(1);
    run(h, 10);
    expect(h.value).toBe(0);
    expect(h.hit(10)).toBe(false);
  });

  it("heals fully between waves", () => {
    const h = new PlayerHealth();
    h.hit(80);
    h.heal();
    expect(h.value).toBe(100);
  });
});

describe("damage direction", () => {
  const eye = { x: 0, z: 0 };
  it("is 0 straight ahead, positive to the right, negative to the left", () => {
    expect(damageDirection(eye, 0, { x: 0, z: -20 })).toBeCloseTo(0);
    expect(damageDirection(eye, 0, { x: 10, z: -10 })).toBeCloseTo(Math.PI / 4);
    expect(damageDirection(eye, 0, { x: -10, z: -10 })).toBeCloseTo(-Math.PI / 4);
    expect(damageDirection(eye, 0, { x: 5, z: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it("points behind for shots from behind", () => {
    expect(Math.abs(damageDirection(eye, 0, { x: 0.01, z: 10 }))).toBeGreaterThan(3);
  });

  it("accounts for the player's own heading", () => {
    // Turned 90° left (yaw +π/2), a shooter straight down −Z is now on the right.
    expect(damageDirection(eye, Math.PI / 2, { x: 0, z: -10 })).toBeCloseTo(Math.PI / 2);
  });
});
