import { describe, expect, it } from "vitest";
import { Rig, handFrame, wheelHands, type WheelPose } from "./testHands";
import { STEERING_LOCK, WHEEL, WheelReader, shapeSteer, type Steering } from "./wheel";

/** A rig that has been driving straight with fists for a second, so the wheel is settled. */
function driving(options: ConstructorParameters<typeof Rig>[0] = {}): Rig {
  const rig = new Rig(options);
  rig.wheel(1, { angle: 0 });
  return rig;
}

describe("the wheel's angle", () => {
  it("is nothing for a level wheel, and drives: fists mean throttle", () => {
    const rig = driving();
    const { status, input } = rig.last;
    expect(status.angle).toBeCloseTo(0, 0);
    expect(status.hands).toBe(2);
    expect(status.grip).toBe("fists");
    expect(status.mode).toBe("drive");
    expect(input).toMatchObject({ steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 0 });
  });

  it("is positive, turning right, when the right hand is lower", () => {
    const rig = driving();
    rig.wheel(1, { angle: 45 });
    expect(rig.last.status.angle).toBeGreaterThan(43);
    expect(rig.last.status.angle).toBeLessThan(47);
    expect(rig.last.input.steer).toBe(1);
  });

  it("is negative, turning left, when the left hand is lower", () => {
    const rig = driving();
    rig.wheel(1, { angle: -25 });
    expect(rig.last.status.angle).toBeCloseTo(-25, 0);
    expect(rig.last.input.steer).toBeLessThan(0);
    expect(rig.last.input.steer).toBeGreaterThan(-1);
  });

  it("is the same on a 3:2 camera as on a 16:9 one, given the picture's shape", () => {
    for (const aspect of [16 / 9, 3 / 2, 4 / 3]) {
      const rig = new Rig({ aspect });
      rig.wheel(1, { angle: 30 });
      expect(rig.last.status.angle).toBeCloseTo(30, 0);
    }
  });

  it("mirrors the hands as the player sees themself: left is their left", () => {
    const rig = driving();
    const { left, right } = rig.last.status;
    expect(left!.x).toBeLessThan(right!.x);
    expect(left!.x).toBeCloseTo(0.5 - 0.25 / (16 / 9), 2);
    expect(left!.size).toBeCloseTo(0.08, 2);
  });

  it("stays steady with the wobble of real tracking", () => {
    const rig = new Rig({ jitter: 0.006 });
    rig.wheel(1, { angle: 0 });
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      rig.wheel(0.5, { angle: 0 });
      worst = Math.max(worst, Math.abs(rig.last.input.steer));
    }
    expect(worst).toBe(0);
  });

  it("makes no brake, item or drift out of tracking noise on fists held for a long drive", () => {
    for (const yaw of [0, 90]) {
      const rig = new Rig({ jitter: 0.006 });
      rig.wheel(1, { angle: 0, yaw });
      let phantom = 0;
      for (let i = 0; i < 300; i++) {
        // A gentle weave of the wheel, as a real driver's hands make.
        rig.wheel(0.1, { angle: 12 * Math.sin(i / 8), yaw });
        const { status, input } = rig.last;
        if (status.mode !== "drive" || input.brake || input.drift || input.itemPresses || status.hands !== 2) phantom++;
      }
      expect(phantom).toBe(0);
    }
  });

  it("follows a turn without lagging far behind", () => {
    const rig = driving();
    rig.run(0.5, (t) => wheelHands({ angle: Math.min(40, t * 160) }));
    // 0.25 s into a 40° turn made in a quarter second, it is done to within a few degrees.
    expect(rig.last.status.angle).toBeGreaterThan(34);
  });
});

describe("the level", () => {
  it("takes the wheel as it is for level, and measures from there", () => {
    const rig = new Rig();
    rig.wheel(1, { angle: 10 });
    expect(rig.last.status.levelled).toBe(false);
    expect(rig.reader.setLevel()).toBe(true);
    expect(rig.reader.levelled).toBe(true);
    expect(rig.reader.level).toBeCloseTo(10, 0);
    rig.wheel(0.5, { angle: 10 });
    expect(rig.last.status.angle).toBeCloseTo(0, 0);
    expect(rig.last.status.levelled).toBe(true);
    rig.wheel(0.5, { angle: 40 });
    expect(rig.last.status.angle).toBeCloseTo(30, 0);
  });

  it("cannot be set without both hands in view", () => {
    const rig = new Rig();
    expect(rig.reader.setLevel()).toBe(false);
    rig.wheel(1, { angle: 0 });
    rig.empty(0.5);
    expect(rig.reader.setLevel()).toBe(false);
    expect(rig.reader.levelled).toBe(false);
  });

  it("can be remembered and forgotten", () => {
    const rig = new Rig();
    rig.reader.level = -6;
    rig.wheel(1, { angle: 0 });
    expect(rig.last.status.angle).toBeCloseTo(6, 0);
    rig.reader.resetLevel();
    expect(rig.reader.levelled).toBe(false);
    rig.wheel(0.5, { angle: 0 });
    expect(rig.last.status.angle).toBeCloseTo(0, 0);
  });

  it("sets itself after the wheel is held steady for a second, and says how far along it is", () => {
    const rig = new Rig();
    let done = 0;
    rig.reader.startAutoLevel(() => done++);
    rig.wheel(0.5, { angle: 7 });
    expect(rig.reader.levelProgress).toBeGreaterThan(0.3);
    expect(rig.reader.levelProgress).toBeLessThan(0.7);
    expect(rig.reader.levelled).toBe(false);
    rig.wheel(0.8, { angle: 7 });
    expect(rig.reader.levelProgress).toBe(1);
    expect(rig.reader.levelled).toBe(true);
    expect(rig.reader.level).toBeCloseTo(7, 0);
    expect(done).toBe(1);
    rig.wheel(1, { angle: 7 });
    expect(done).toBe(1);
    expect(rig.last.status.angle).toBeCloseTo(0, 0);
  });

  it("starts again when the wheel moves", () => {
    const rig = new Rig();
    rig.reader.startAutoLevel();
    rig.wheel(0.8, { angle: 0 });
    expect(rig.reader.levelProgress).toBeGreaterThan(0.6);
    rig.wheel(0.3, { angle: 20 });
    expect(rig.reader.levelProgress).toBeLessThan(0.5);
    expect(rig.reader.levelled).toBe(false);
  });

  it("starts again when the hands go", () => {
    const rig = new Rig();
    rig.reader.startAutoLevel();
    rig.wheel(0.8, { angle: 0 });
    rig.empty(0.2);
    expect(rig.reader.levelProgress).toBe(0);
  });

  it("does not take a wheel that is plainly turned for level", () => {
    const rig = new Rig();
    rig.reader.startAutoLevel();
    rig.wheel(3, { angle: 45 });
    expect(rig.reader.levelProgress).toBe(0);
    expect(rig.reader.levelled).toBe(false);
  });

  it("can be called off", () => {
    const rig = new Rig();
    rig.reader.startAutoLevel();
    rig.wheel(0.5, { angle: 0 });
    rig.reader.cancelAutoLevel();
    rig.wheel(2, { angle: 0 });
    expect(rig.reader.levelled).toBe(false);
    expect(rig.reader.levelProgress).toBe(0);
  });
});

describe("steer shaping", () => {
  it("does nothing inside the dead zone of 4° either way", () => {
    for (const steering of ["gentle", "normal", "quick"] as Steering[]) {
      for (const angle of [0, 1, 3.9, 4, -3.9, -4]) expect(shapeSteer(angle, steering)).toBe(0);
      expect(shapeSteer(4.5, steering)).toBeGreaterThan(0);
      expect(shapeSteer(-4.5, steering)).toBeLessThan(0);
    }
  });

  it("is full lock at 50°, 40° and 30° for Gentle, Normal and Quick, and no more beyond", () => {
    expect(STEERING_LOCK).toEqual({ gentle: 50, normal: 40, quick: 30 });
    for (const steering of ["gentle", "normal", "quick"] as Steering[]) {
      const lock = STEERING_LOCK[steering];
      expect(shapeSteer(lock, steering)).toBeCloseTo(1, 6);
      expect(shapeSteer(-lock, steering)).toBeCloseTo(-1, 6);
      expect(shapeSteer(lock + 30, steering)).toBe(1);
      expect(shapeSteer(-lock - 90, steering)).toBe(-1);
      expect(shapeSteer(lock - 1, steering)).toBeLessThan(1);
    }
  });

  it("rises smoothly and never backwards from the dead zone to full lock", () => {
    let last = 0;
    for (let angle = 0; angle <= 60; angle += 0.5) {
      const steer = shapeSteer(angle, "normal");
      expect(steer).toBeGreaterThanOrEqual(last);
      expect(steer - last).toBeLessThan(0.1);
      last = steer;
    }
  });

  it("is gentle near the centre: less than the straight line from the dead zone to the lock", () => {
    for (const angle of [8, 14, 20, 26, 32]) {
      const straight = (angle - WHEEL.deadZone) / (40 - WHEEL.deadZone);
      expect(shapeSteer(angle, "normal")).toBeLessThan(straight);
    }
    expect(shapeSteer(12, "normal")).toBeLessThan(0.2);
  });

  it("is the same turn the other way", () => {
    for (const angle of [5, 12, 25, 39]) expect(shapeSteer(-angle, "quick")).toBe(-shapeSteer(angle, "quick"));
  });

  it("reaches the kart, with the Steering setting changeable at any time", () => {
    const rig = driving();
    rig.wheel(0.6, { angle: 30 });
    const normal = rig.last.input.steer;
    expect(normal).toBeCloseTo(shapeSteer(30, "normal"), 1);
    rig.reader.steering = "quick";
    rig.wheel(0.1, { angle: 30 });
    expect(rig.last.input.steer).toBeCloseTo(1, 1);
    rig.reader.steering = "gentle";
    rig.wheel(0.1, { angle: 30 });
    expect(rig.last.input.steer).toBeLessThan(normal);
  });
});

describe("telling the hands apart", () => {
  it("keeps them as they were when the wheel is turned past 90° and one is level with, then past, the other", () => {
    const rig = driving();
    const angles: number[] = [];
    // A slow quarter turn and more: 0 to 170° in four seconds.
    rig.run(4, (t) => wheelHands({ angle: (t / 4) * 170 }));
    angles.push(rig.last.status.angle);
    const { left, right } = rig.last.status;
    // The left hand has gone round over the right one: it is the one on the right of the picture now.
    expect(left!.x).toBeGreaterThan(right!.x);
    expect(angles[0]).toBeGreaterThan(160);
    expect(rig.last.input.steer).toBe(1);
  });

  it("does not swap them at exactly 90°, with the hands one above the other", () => {
    const rig = driving();
    rig.run(3, (t) => wheelHands({ angle: (t / 3) * 120 }));
    expect(rig.last.status.angle).toBeGreaterThan(115);
    expect(rig.last.status.angle).toBeLessThan(125);
    rig.run(3, (t) => wheelHands({ angle: 120 - (t / 3) * 120 }));
    rig.wheel(0.5, { angle: 0 });
    expect(rig.last.status.angle).toBeCloseTo(0, 0);
  });

  it("goes round the other way past -90° too", () => {
    const rig = driving();
    rig.run(3, (t) => wheelHands({ angle: -(t / 3) * 140 }));
    expect(rig.last.status.angle).toBeLessThan(-135);
    expect(rig.last.input.steer).toBe(-1);
  });

  it("tells them by side when they first appear, however MediaPipe lists them", () => {
    const rig = new Rig();
    const [left, right] = wheelHands({ angle: 20 });
    rig.hold(1, [right, left]);
    expect(rig.last.status.angle).toBeCloseTo(20, 0);
    expect(rig.last.status.left!.x).toBeLessThan(rig.last.status.right!.x);
  });

  it("knows a lone hand coming back by where it was", () => {
    const rig = driving();
    const [left, right] = wheelHands({ angle: 0 });
    rig.hold(0.5, [right]);
    expect(rig.last.status.hands).toBe(1);
    expect(rig.last.status.right).not.toBeNull();
    expect(rig.last.status.left).toBeNull();
    rig.hold(0.5, [left]);
    expect(rig.last.status.left).not.toBeNull();
    expect(rig.last.status.right).toBeNull();
  });
});

describe("brake", () => {
  it("is both hands open for 150 ms, with the throttle lifted", () => {
    const rig = driving();
    rig.wheel(0.1, { angle: 0, fingers: "open" });
    expect(rig.last.status.mode).toBe("drive");
    expect(rig.last.input.brake).toBe(0);
    rig.wheel(0.3, { angle: 0, fingers: "open" });
    expect(rig.last.status.mode).toBe("brake");
    expect(rig.last.status.grip).toBe("open");
    expect(rig.last.input).toMatchObject({ brake: 1, throttle: 0, drift: false });
  });

  it("lets go when the fists close again", () => {
    const rig = driving();
    rig.wheel(0.6, { angle: 0, fingers: "open" });
    expect(rig.last.input.brake).toBe(1);
    rig.wheel(0.4, { angle: 0 });
    expect(rig.last.input).toMatchObject({ brake: 0, throttle: 1 });
    expect(rig.last.status.mode).toBe("drive");
  });

  it("keeps steering, and is tracked, with the hands open: facing the camera or side-on", () => {
    for (const yaw of [0, 90]) {
      const rig = driving();
      rig.wheel(1, { angle: 30, fingers: "open", yaw });
      expect(rig.last.status.mode).toBe("brake");
      expect(rig.last.status.angle).toBeCloseTo(30, 0);
      expect(rig.last.input.steer).toBeGreaterThan(0.4);
      expect(rig.last.status.left!.open).toBe(true);
      expect(rig.last.status.right!.open).toBe(true);
    }
  });

  it("does not come from one open hand: that is only an item in waiting", () => {
    const rig = driving();
    rig.wheel(2, { angle: 0, left: { fingers: "open" } });
    expect(rig.last.status.mode).toBe("drive");
    expect(rig.last.status.grip).toBe("one-open");
    expect(rig.last.input).toMatchObject({ brake: 0, throttle: 1 });
  });

  it("ignores a single frame of open hands", () => {
    const rig = driving();
    rig.run(0.03, () => wheelHands({ angle: 0, fingers: "open" }));
    rig.wheel(0.5, { angle: 0 });
    expect(rig.last.input.brake).toBe(0);
  });

  it("starts at once when open hands come into view (a first sight needs no hold)", () => {
    const rig = new Rig();
    rig.wheel(0.3, { angle: 0, fingers: "open" });
    expect(rig.last.status.mode).toBe("brake");
  });
});

describe("the item", () => {
  /** A fist wheel for a second, one hand open for `open` seconds, then fists again for a second. */
  function flick(open: number, which: "left" | "right" = "left", angle = 0): Rig {
    const rig = driving();
    rig.wheel(open, { angle, [which]: { fingers: "open" } });
    rig.wheel(1, { angle });
    return rig;
  }

  it("is one hand opened and closed again within 0.6 s, the other staying a fist", () => {
    expect(flick(0.3, "left").last.input.itemPresses).toBe(1);
    expect(flick(0.3, "right").last.input.itemPresses).toBe(1);
    expect(flick(0.5, "right").last.input.itemPresses).toBe(1);
  });

  it("works while the wheel is turned", () => {
    expect(flick(0.3, "right", 25).last.input.itemPresses).toBe(1);
  });

  it("counts once per flick, and the count only goes up", () => {
    const rig = driving();
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      rig.wheel(0.3, { angle: 0, left: { fingers: "open" } });
      rig.wheel(0.6, { angle: 0 });
      counts.push(rig.last.input.itemPresses);
    }
    expect(counts).toEqual([1, 2, 3]);
  });

  it("registers when the hand closes, not before", () => {
    const rig = driving();
    rig.wheel(0.4, { angle: 0, right: { fingers: "open" } });
    expect(rig.last.input.itemPresses).toBe(0);
    rig.wheel(0.5, { angle: 0 });
    expect(rig.last.input.itemPresses).toBe(1);
  });

  it("keeps the throttle on through the flick: the kart does not slow to use an item", () => {
    const rig = driving();
    rig.wheel(0.3, { angle: 0, left: { fingers: "open" } });
    expect(rig.last.input.throttle).toBe(1);
    expect(rig.last.input.brake).toBe(0);
  });

  it("is not a hand held open for longer than 0.6 s", () => {
    expect(flick(1.0).last.input.itemPresses).toBe(0);
  });

  it("is not a flick too quick to be seen: under the 120 ms hold", () => {
    expect(flick(0.07).last.input.itemPresses).toBe(0);
  });

  it("is not both hands opening and closing together: that is a brake, never an item", () => {
    const rig = driving();
    rig.wheel(0.4, { angle: 0, fingers: "open" });
    expect(rig.last.status.mode).toBe("brake");
    rig.wheel(1, { angle: 0 });
    expect(rig.last.input.itemPresses).toBe(0);
  });

  it("is not both hands opening within 250 ms of each other, however they close", () => {
    for (const gap of [0.05, 0.15, 0.24]) {
      const rig = driving();
      // The left opens first; the right follows `gap` seconds later; the left closes first, after 0.5 s.
      rig.run(gap, () => wheelHands({ angle: 0, left: { fingers: "open" } }));
      rig.wheel(0.3, { angle: 0, fingers: "open" });
      rig.wheel(0.3, { angle: 0, right: { fingers: "open" } });
      rig.wheel(1, { angle: 0 });
      expect(rig.last.input.itemPresses).toBe(0);
    }
  });

  it("is not the second hand opening while the first is still open, even after a quarter second", () => {
    const rig = driving();
    rig.wheel(0.3, { angle: 0, left: { fingers: "open" } });
    rig.wheel(0.25, { angle: 0, fingers: "open" });
    rig.wheel(1, { angle: 0 });
    expect(rig.last.input.itemPresses).toBe(0);
  });

  it("can follow a flick of the other hand soon after", () => {
    const rig = driving();
    rig.wheel(0.3, { angle: 0, left: { fingers: "open" } });
    rig.wheel(0.5, { angle: 0 });
    rig.wheel(0.3, { angle: 0, right: { fingers: "open" } });
    rig.wheel(0.5, { angle: 0 });
    expect(rig.last.input.itemPresses).toBe(2);
  });

  it("is not a hand that appears open and closes (it was never opened)", () => {
    const rig = new Rig();
    const [left, right] = wheelHands({ angle: 0 });
    rig.hold(0.5, [right]);
    rig.hold(0.3, [{ ...left, fingers: "open" }, right]);
    rig.wheel(1, { angle: 0 });
    expect(rig.last.input.itemPresses).toBe(0);
  });

  it("is not made by the brake letting go with one hand a moment before the other", () => {
    const rig = driving();
    rig.wheel(0.4, { angle: 0, fingers: "open" });
    rig.wheel(0.1, { angle: 0, right: { fingers: "open" } });
    rig.wheel(1, { angle: 0 });
    expect(rig.last.input.itemPresses).toBe(0);
  });

  it("is told apart in a side-on fist as well as a palm-on one", () => {
    for (const yaw of [0, 90, 180]) {
      const rig = driving();
      rig.wheel(0.3, { angle: 10, yaw, left: { fingers: "open" } });
      rig.wheel(1, { angle: 10, yaw });
      expect(rig.last.input.itemPresses).toBe(1);
    }
  });
});

describe("hop and drift", () => {
  /** The wheel at `angle` with its centre rising by `rise` picture heights over `seconds`. */
  function lift(rig: Rig, angle: number, rise: number, seconds: number) {
    const [cx, cy] = [0.5, 0.45];
    rig.run(seconds, (t) => wheelHands({ angle, centre: [cx, cy - rise * Math.min(1, t / seconds)] }));
    return rig.wheel(0.1, { angle, centre: [cx, cy - rise] });
  }

  it("a sharp lift of the turned wheel is a hop that starts a drift", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    expect(rig.last.input.drift).toBe(false);
    // Half a hand-span (0.25 of a picture height) in a tenth of a second.
    lift(rig, 30, 0.25, 0.1);
    expect(rig.last.input.drift).toBe(true);
    expect(rig.last.input.steer).toBeGreaterThan(0.5);
  });

  it("holds the drift as long as the wheel stays turned", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, 0.25, 0.1);
    rig.wheel(3, { angle: 30, centre: [0.5, 0.2] });
    expect(rig.last.input.drift).toBe(true);
  });

  it("lets go once the wheel has been straight for 200 ms, and not before", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, 0.25, 0.1);
    // A dip through the straight for less than 200 ms does not end it.
    rig.wheel(0.1, { angle: 0, centre: [0.5, 0.2] });
    rig.wheel(0.5, { angle: 30, centre: [0.5, 0.2] });
    expect(rig.last.input.drift).toBe(true);
    rig.wheel(0.15, { angle: 0, centre: [0.5, 0.2] });
    expect(rig.last.input.drift).toBe(true);
    rig.wheel(0.5, { angle: 0, centre: [0.5, 0.2] });
    expect(rig.last.input.drift).toBe(false);
  });

  it("ends on a brake", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, 0.25, 0.1);
    expect(rig.last.input.drift).toBe(true);
    rig.wheel(0.5, { angle: 30, centre: [0.5, 0.2], fingers: "open" });
    expect(rig.last.status.mode).toBe("brake");
    expect(rig.last.input.drift).toBe(false);
  });

  it("a hop going straight is let go of almost at once: only a hop", () => {
    const rig = driving();
    rig.run(0.1, (t) => wheelHands({ angle: 0, centre: [0.5, 0.45 - 0.25 * Math.min(1, t / 0.1)] }));
    // The drift flag goes up, for the sim to see with the steer under its 0.3...
    expect(rig.last.input.drift).toBe(true);
    expect(Math.abs(rig.last.input.steer)).toBeLessThan(0.3);
    // ...and is gone a fifth of a second after.
    rig.wheel(0.5, { angle: 0, centre: [0.5, 0.2] });
    expect(rig.last.input.drift).toBe(false);
  });

  it("is still seen when the jerk costs a dropped frame", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    rig.run(0.2, (t) => (t > 0.05 && t < 0.09 ? [] : wheelHands({ angle: 30, centre: [0.5, 0.45 - 0.25 * Math.min(1, t / 0.12)] })));
    expect(rig.last.input.drift).toBe(true);
  });

  it("is not a slow lift", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, 0.25, 1.5);
    expect(rig.last.input.drift).toBe(false);
  });

  it("is not a small jerk: under a quarter of a hand-span", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, 0.08, 0.05);
    expect(rig.last.input.drift).toBe(false);
  });

  it("is not a drop: only upwards", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, -0.25, 0.1);
    expect(rig.last.input.drift).toBe(false);
  });

  it("is judged in hand-spans: a wheel held small and far hops with a smaller lift", () => {
    const rig = new Rig();
    rig.wheel(1, { angle: 30, span: 0.2 });
    rig.run(0.1, (t) => wheelHands({ angle: 30, span: 0.2, centre: [0.5, 0.45 - 0.1 * Math.min(1, t / 0.1)] }));
    expect(rig.last.input.drift).toBe(true);
  });

  it("does not hop twice from one lift", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    lift(rig, 30, 0.25, 0.1);
    rig.wheel(0.4, { angle: 0, centre: [0.5, 0.2] });
    rig.wheel(0.4, { angle: 30, centre: [0.5, 0.2] });
    expect(rig.last.input.drift).toBe(false);
  });
});

describe("hands lost", () => {
  it("one hand: holds the wheel's angle for 0.4 s, then eases to the centre over 0.6 s, with the throttle on", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    const held = rig.last.input.steer;
    expect(held).toBeGreaterThan(0.5);
    const [, right] = wheelHands({ angle: 30 });
    rig.hold(0.3, [right]);
    expect(rig.last.status.hands).toBe(1);
    expect(rig.last.input.steer).toBeCloseTo(held, 1);
    rig.hold(0.4, [right]);
    // 0.7 s on: well into the ease.
    expect(rig.last.input.steer).toBeLessThan(held * 0.8);
    expect(rig.last.input.steer).toBeGreaterThan(0);
    rig.hold(0.5, [right]);
    expect(rig.last.input.steer).toBe(0);
    expect(rig.last.input.throttle).toBe(1);
    expect(rig.last.status.mode).toBe("drive");
  });

  it("one hand: keeps what the other was doing, so a brake in progress carries on a moment", () => {
    const rig = driving();
    rig.wheel(0.6, { angle: 0, fingers: "open" });
    const [left] = wheelHands({ angle: 0, fingers: "open" });
    rig.hold(0.2, [left]);
    expect(rig.last.status.mode).toBe("brake");
  });

  it("both: the steer eases to the centre, mode says lost, and the throttle lifts after half a second", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    const held = rig.last.input.steer;
    rig.empty(0.2);
    expect(rig.last.status.mode).toBe("drive");
    expect(rig.last.input.steer).toBeCloseTo(held, 1);
    rig.empty(0.2);
    expect(rig.last.status.mode).toBe("lost");
    expect(rig.last.status.hands).toBe(0);
    expect(rig.last.status.grip).toBe("none");
    expect(rig.last.input.throttle).toBe(1); // 0.4 s: still within the half second
    expect(rig.last.input.steer).toBeLessThan(held);
    rig.empty(0.2);
    expect(rig.last.input.throttle).toBe(0);
    expect(rig.last.input.brake).toBe(0); // it coasts, it does not stop
    rig.empty(0.6);
    expect(rig.last.input.steer).toBe(0);
  });

  it("both: a camera that stops sending frames is the same as hands gone", () => {
    const rig = driving();
    // The clock runs, no frame arrives.
    for (let i = 0; i < 60; i++) rig.reader.sample((rig.now += 1000 / 60));
    const { status, input } = rig.reader.sample(rig.now);
    expect(status.mode).toBe("lost");
    expect(input.throttle).toBe(0);
  });

  it("is lost, throttle off, before any hand has been seen", () => {
    const rig = new Rig();
    rig.empty(1);
    expect(rig.last.status.mode).toBe("lost");
    expect(rig.last.input).toMatchObject({ steer: 0, throttle: 0, brake: 0, drift: false });
  });

  it("shrugs off a dropped frame or two", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    const held = rig.last.input.steer;
    rig.run(0.07, () => []);
    expect(rig.last.status.mode).toBe("drive");
    expect(rig.last.status.hands).toBe(2);
    expect(rig.last.input.steer).toBeCloseTo(held, 2);
    rig.wheel(0.3, { angle: 30 });
    expect(rig.last.input.steer).toBeCloseTo(held, 1);
  });

  it("comes back in smoothly when the hands return", () => {
    const rig = driving();
    rig.wheel(1, { angle: 30 });
    rig.empty(2);
    expect(rig.last.input.steer).toBe(0);
    rig.wheel(0.1, { angle: 30 });
    expect(rig.last.status.mode).toBe("drive");
    expect(rig.last.input.steer).toBeLessThan(0.5); // eased in, not snapped
    rig.wheel(0.6, { angle: 30 });
    expect(rig.last.input.steer).toBeCloseTo(shapeSteer(30, "normal"), 1);
    expect(rig.last.input.throttle).toBe(1);
  });

  it("does not use hands that went away long ago to tell the new ones apart", () => {
    const rig = driving();
    rig.wheel(0.5, { angle: 30 });
    rig.empty(3);
    rig.wheel(1, { angle: -20 });
    expect(rig.last.status.angle).toBeCloseTo(-20, 0);
    expect(rig.last.status.left!.x).toBeLessThan(rig.last.status.right!.x);
  });
});

describe("two players on one camera", () => {
  const players = (leftAngle: number, rightAngle: number, left?: WheelPose, right?: WheelPose) => {
    // Each wheel fits its half of the picture: centres a quarter and three quarters across.
    const [a, b] = wheelHands({ angle: leftAngle, centre: [0.25, 0.45], span: 0.3, ...left });
    const [c, d] = wheelHands({ angle: rightAngle, centre: [0.75, 0.45], span: 0.3, ...right });
    return [a, b, c, d];
  };

  it("each reader sees only the hands in its half", () => {
    const one = new Rig({ half: "left" });
    const two = new Rig({ half: "right" });
    for (let i = 0; i < 60; i++) {
      const hands = players(20, -20);
      one.run(1 / 30, () => hands);
      two.run(1 / 30, () => hands);
    }
    expect(one.last.status.hands).toBe(2);
    expect(two.last.status.hands).toBe(2);
    expect(one.last.status.angle).toBeCloseTo(20, 0);
    expect(two.last.status.angle).toBeCloseTo(-20, 0);
    expect(one.last.status.right!.x).toBeLessThan(0.5);
    expect(two.last.status.left!.x).toBeGreaterThan(0.5);
  });

  it("gestures belong to the player whose hands made them", () => {
    const one = new Rig({ half: "left" });
    const two = new Rig({ half: "right" });
    const feed = (seconds: number, hands: ReturnType<typeof players>) => {
      one.run(seconds, () => hands);
      two.run(seconds, () => hands);
    };
    feed(1, players(0, 0));
    // The second player flicks their right hand; the first player's hands do nothing.
    feed(0.3, players(0, 0, undefined, { angle: 0, right: { fingers: "open" } }));
    feed(1, players(0, 0));
    expect(one.last.input.itemPresses).toBe(0);
    expect(two.last.input.itemPresses).toBe(1);
    // The first player brakes.
    feed(0.5, players(0, 0, { angle: 0, fingers: "open" }));
    expect(one.last.status.mode).toBe("brake");
    expect(two.last.status.mode).toBe("drive");
  });

  it("one player alone in the picture leaves the other's wheel lost", () => {
    const one = new Rig({ half: "left" });
    const two = new Rig({ half: "right" });
    const hands = wheelHands({ angle: 10, centre: [0.25, 0.45], span: 0.3 });
    one.hold(1, hands);
    two.hold(1, hands);
    expect(one.last.status.mode).toBe("drive");
    expect(two.last.status.mode).toBe("lost");
    expect(two.last.status.hands).toBe(0);
  });

  it("a single hand tells left from right by its half's own middle", () => {
    const two = new Rig({ half: "right" });
    const [left, right] = wheelHands({ angle: 0, centre: [0.75, 0.45], span: 0.3 });
    two.hold(0.5, [right]);
    expect(two.last.status.right).not.toBeNull();
    expect(two.last.status.left).toBeNull();
    const again = new Rig({ half: "right" });
    again.hold(0.5, [left]);
    expect(again.last.status.left).not.toBeNull();
  });

  it("without halves, a crowd of four is read as two hands, not mixed up", () => {
    const rig = new Rig();
    rig.hold(1, players(0, 0));
    expect(rig.last.status.hands).toBe(2);
  });
});

describe("a HandFrame with no hands field filled", () => {
  it("reads as an empty picture rather than throwing", () => {
    const reader = new WheelReader();
    reader.push({ ...handFrame([], 1000) });
    expect(reader.sample(1100).status.hands).toBe(0);
  });
});
