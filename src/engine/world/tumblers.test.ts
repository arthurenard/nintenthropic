import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Tumblers } from "./tumblers";

describe("things knocked loose", () => {
  it("fall, bounce and come to rest on their floor", () => {
    const tumblers = new Tumblers(2);
    const hat = new Object3D();
    hat.position.set(0, 2, 0);
    const t = tumblers.take();
    t.object = hat;
    t.vel.set(1, 3, 0);
    t.floor = 0.1;
    for (let i = 0; i < 240 && !t.resting; i++) tumblers.update(1 / 60);
    expect(t.resting).toBe(true);
    expect(hat.position.y).toBeCloseTo(0.1);
    expect(hat.position.x).toBeGreaterThan(0.5);
  });

  it("go back where they came from, and the oldest is reused when all are out", () => {
    const tumblers = new Tumblers(1);
    const hand = new Group();
    const gun = new Object3D();
    hand.add(gun);
    gun.position.set(0.1, 0.2, 0.3);
    const t = tumblers.take();
    t.home = hand;
    t.homePos.copy(gun.position);
    t.homeQuat.copy(gun.quaternion);
    t.object = gun;
    new Group().attach(gun);
    gun.position.set(5, 0, 5);
    // The only tumbler, taken again: the gun goes back in the hand first.
    const again = tumblers.take();
    expect(again).toBe(t);
    expect(gun.parent).toBe(hand);
    expect(gun.position.toArray()).toEqual([0.1, 0.2, 0.3]);
  });
});
