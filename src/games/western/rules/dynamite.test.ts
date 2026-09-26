import { describe, expect, it } from "vitest";
import { arcPoint, Dynamite, flightTimeFor, solveArc } from "./dynamite";
import { throwHand } from "./match";
import { GRAVITY, THROW_HAND } from "./tuning";

describe("dynamite arcs", () => {
  it("leaves the hand and lands on the target at the flight time", () => {
    const a = { x: -8, y: 5.5, z: -30 };
    const b = { x: 1, y: 0.05, z: -4 };
    const v = { x: 0, y: 0, z: 0 };
    solveArc(a, b, 1.8, v);
    const p = { x: 0, y: 0, z: 0 };
    arcPoint(a, v, 0, p);
    expect(p).toEqual(a);
    arcPoint(a, v, 1.8, p);
    expect(p.x).toBeCloseTo(b.x);
    expect(p.y).toBeCloseTo(b.y);
    expect(p.z).toBeCloseTo(b.z);
  });

  it("leaves from the thrower's hand: up at chest height, out in front, to his left", () => {
    const feet = { x: -2, y: 0, z: -22 };
    const eye = { x: 0, y: 1.7, z: 0 };
    const hand = throwHand(feet, eye);
    expect(hand.y).toBeCloseTo(THROW_HAND.up);
    const toward = Math.hypot(eye.x - feet.x, eye.z - feet.z);
    const handToward = Math.hypot(eye.x - hand.x, eye.z - hand.z);
    // Nearer the player than his feet by about the forward reach.
    expect(toward - handToward).toBeCloseTo(THROW_HAND.forward, 1);
    // Facing the player (down +z), his left is the player's right: +x.
    expect(hand.x).toBeGreaterThan(feet.x + 0.3);
  });

  it("rises before it falls (it is lobbed, not thrown flat)", () => {
    const d = new Dynamite(0).launch({ x: 0, y: 1.9, z: -25 }, { x: 0, y: 0.05, z: -4 }, 1.8);
    expect(d.velocity.y).toBeGreaterThan(0);
    const apexT = d.velocity.y / GRAVITY;
    expect(apexT).toBeGreaterThan(0.3);
  });

  it("flies, lands, then goes off after a short fuse", () => {
    const d = new Dynamite(0).launch({ x: 0, y: 2, z: -20 }, { x: 0, y: 0, z: -4 }, 1.5);
    let exploded = false;
    let t = 0;
    while (!exploded && t < 5) {
      if (t < 1.48) expect(d.airborne).toBe(true);
      exploded = d.update(1 / 60);
      t += 1 / 60;
    }
    expect(exploded).toBe(true);
    expect(t).toBeGreaterThan(1.5);
    expect(t).toBeLessThan(2.2);
    expect(d.state).toBe("exploded");
  });

  it("gives long throws more time in the air, within limits", () => {
    expect(flightTimeFor(10)).toBe(1.3);
    expect(flightTimeFor(25)).toBeCloseTo(25 / 14);
    expect(flightTimeFor(80)).toBe(2.2);
  });

  it("a dropped stick goes off where it fell", () => {
    const d = new Dynamite(0).drop({ x: 3, y: 0.1, z: -20 }, 0.5);
    expect(d.airborne).toBe(false);
    let t = 0;
    while (!d.update(0.05)) t += 0.05;
    expect(t).toBeCloseTo(0.45, 1);
    expect(d.position.z).toBe(-20);
  });
});
