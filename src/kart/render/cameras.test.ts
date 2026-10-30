import { describe, expect, it } from "vitest";
import type { KartView, RaceView } from "../contract";
import { MEADOW_LOOP } from "../track/tracks";
import { Vector3 } from "three";
import { bankSeen, baseFov, chaseOffsets, ChaseCamera, COUNTDOWN_SPAN, MAX_ROLL, RAMP_HOLD, rampSeen, type CameraRoad } from "./cameras";

function kart(over: Partial<KartView> = {}): KartView {
  return {
    id: 0, x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
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
  it("stands farther back in a narrow view, and never closer in a wide one", () => {
    expect(chaseOffsets(0.5, 0, 0.6).distance).toBeGreaterThan(chaseOffsets(0.5, 0, 1.6).distance);
    expect(chaseOffsets(0.5, 0, 3.2).distance).toBeCloseTo(chaseOffsets(0.5, 0, 1.6).distance, 6);
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
    let last = high;
    // The countdown runs down; the camera only ever comes lower, and ends near the chase height.
    for (let t = COUNTDOWN_SPAN; t > 0; t -= 1 / 60) {
      c.update(k, view("countdown", t), 1 / 60, 1.6);
      expect(c.camera.position.y).toBeLessThanOrEqual(last + 1e-6);
      last = c.camera.position.y;
    }
    expect(high).toBeGreaterThan(last + 8);
    expect(last).toBeLessThan(k.y + 4);
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

/** A straight road along +z, rising `grade` metres a metre from z = 0 (flat before it), leaning `roll` radians. */
function road(grade = 0, roll = 0): CameraRoad {
  const y = (z: number) => Math.max(0, z) * grade;
  const sample = (s: number) => ({ x: 0, y: y(s), z: s, tx: 0, tz: 1, width: 12 });
  return {
    project: (x, z) => ({ s: z, offset: x, sample: sample(z) }),
    at: (s) => sample(s),
    rollAt: () => roll,
  };
}

/** Drives `kart(t)` for `seconds`, the kart going up +z at its speed, and hands back the camera. */
function drive(c: ChaseCamera, seconds: number, over: (t: number, z: number) => Partial<KartView>, r?: CameraRoad, start = 0): number {
  let z = start;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const extra = over(t, z);
    z += ((extra.speed ?? 20) * 1) / 60;
    c.update(kart({ z, y: r ? r.at(z).y : 0, speed: 20, ...extra }), view("racing"), 1 / 60, 1.6, undefined, r);
  }
  return z;
}

/** The camera's roll about its own view axis, radians, in rotateZ's sense (+ tips its right side up: the horizon's right end goes down). */
function rollOf(c: ChaseCamera): number {
  const up = new Vector3(0, 1, 0).applyQuaternion(c.camera.quaternion);
  const right = new Vector3(1, 0, 0).applyQuaternion(c.camera.quaternion);
  return Math.atan2(right.y, up.y);
}

describe("the camera's life", () => {
  it("leans into a bend with the wheel, and not at all for a calm player", () => {
    const c = new ChaseCamera();
    drive(c, 1.5, () => ({ steer: 1 }));
    expect(rollOf(c)).toBeLessThan(-0.02);
    const calm = new ChaseCamera();
    calm.calm = true;
    drive(calm, 1.5, () => ({ steer: 1 }));
    expect(Math.abs(rollOf(calm))).toBeLessThan(1e-3);
  });

  it("tilts with a banked road, the same way it leans into that bend, and never past its limit", () => {
    const c = new ChaseCamera();
    drive(c, 2, () => ({}), road(0, 0.3));
    expect(rollOf(c)).toBeLessThan(-0.1);
    expect(rollOf(c)).toBeGreaterThanOrEqual(-MAX_ROLL - 1e-3);
    // Banked the other way, it tilts the other way.
    const d = new ChaseCamera();
    drive(d, 2, () => ({}), road(0, -0.3));
    expect(rollOf(d)).toBeGreaterThan(0.1);
  });

  it("pitches up a climb and looks down over a crest", () => {
    const flat = new ChaseCamera();
    drive(flat, 2, () => ({}), road(0));
    const climb = new ChaseCamera();
    drive(climb, 2, () => ({}), road(0.3), 0);
    const pitch = (c: ChaseCamera) => new Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion).y;
    expect(pitch(climb)).toBeGreaterThan(pitch(flat) + 0.08);
    const descent = new ChaseCamera();
    drive(descent, 2, () => ({}), road(-0.3), 0);
    expect(pitch(descent)).toBeLessThan(pitch(flat) - 0.08);
  });

  it("swings out to the outside of a drift so the slide shows", () => {
    // Drifting right: the kart's nose points right of the way it goes, and the camera moves out to the left (-x here).
    const c = new ChaseCamera();
    drive(c, 2, () => ({ drift: 1, steer: 0.6, heading: -0.45 }));
    const straight = new ChaseCamera();
    drive(straight, 2, () => ({}));
    expect(c.camera.position.x).toBeGreaterThan(straight.camera.position.x - 5);
    // Behind the kart, it sits toward the outside of the slide: left of the line straight behind the heading.
    const k = { x: 0, heading: -0.45 };
    const lateral = (c.camera.position.x - k.x) * -Math.cos(k.heading);
    expect(lateral).toBeLessThan(0.2);
  });

  it("drops with a landing and springs back, but not for a calm player", () => {
    // Two cameras over the same jump: the calm one only follows the kart down; the other drops below it and comes back.
    const c = new ChaseCamera();
    const calm = new ChaseCamera();
    calm.calm = true;
    const air = (t: number) => (t > 0.5 && t < 1.5 ? 2.5 * Math.sin(((t - 0.5) / 1) * Math.PI) : 0);
    let dip = 0;
    let z = 0;
    for (let t = 0; t < 3; t += 1 / 60) {
      z += 20 / 60;
      const k = kart({ z, y: air(t) * 0.7, hop: air(t), speed: 20 });
      c.update(k, view("racing"), 1 / 60, 1.6);
      calm.update(k, view("racing"), 1 / 60, 1.6);
      if (t > 1.5 && t < 1.9) dip = Math.max(dip, calm.camera.position.y - c.camera.position.y);
      // Before the landing the two ride together.
      if (t < 1.45) expect(Math.abs(calm.camera.position.y - c.camera.position.y)).toBeLessThan(1e-6);
    }
    expect(dip).toBeGreaterThan(0.1);
    expect(dip).toBeLessThan(0.6);
    expect(Math.abs(calm.camera.position.y - c.camera.position.y)).toBeLessThan(0.01);
  });

  it("punches the lens open as a boost begins, and a calm player's opens gently", () => {
    const c = new ChaseCamera();
    drive(c, 1, () => ({}));
    const before = c.camera.fov;
    let widest = 0;
    drive(c, 0.4, () => ({ boost: 1.5 }));
    widest = c.camera.fov;
    expect(widest).toBeGreaterThan(before + 6);
    const calm = new ChaseCamera();
    calm.calm = true;
    drive(calm, 1, () => ({}));
    const calmBefore = calm.camera.fov;
    drive(calm, 0.4, () => ({ boost: 1.5 }));
    expect(calm.camera.fov - calmBefore).toBeLessThan((widest - before) * 0.5);
  });

  it("shakes on a knock and settles again", () => {
    const c = new ChaseCamera();
    drive(c, 1, () => ({}));
    c.kick(0.8);
    const z = drive(c, 0.1, () => ({}), undefined, 20);
    const shaken = c.camera.position.clone();
    const calmTwin = new ChaseCamera();
    drive(calmTwin, 1, () => ({}));
    drive(calmTwin, 0.1, () => ({}), undefined, 20);
    expect(shaken.distanceTo(calmTwin.camera.position)).toBeGreaterThan(0.01);
    // A second and a half later the shake is gone: the two cameras stand together again.
    drive(c, 1.5, () => ({}), undefined, z);
    drive(calmTwin, 1.5, () => ({}), undefined, z);
    expect(c.camera.position.distanceTo(calmTwin.camera.position)).toBeLessThan(0.01);
  });

  it("follows the course in a drift, so the kart is seen sliding with its nose inside the line", () => {
    // Going straight up +z, the nose 30 degrees to the right (a right-hand drift): the camera looks mostly along +z.
    const c = new ChaseCamera();
    drive(c, 2, () => ({ drift: 1, steer: 0.5, heading: -0.52, course: 0 }));
    const look = new Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion);
    const yaw = Math.atan2(look.x, look.z);
    // Looking a little to the right of the course, well short of the nose, from out to the left (+x) of the slide.
    expect(yaw).toBeLessThan(0);
    expect(yaw).toBeGreaterThan(-0.4);
    expect(c.camera.position.x).toBeGreaterThan(0.4);
  });

  it("reads the road ahead of the nose while backing up a hill, not the road behind it", () => {
    // Reversing, the sim's course points behind the kart; the camera still faces the nose and must read that way.
    const hill = road(0.12);
    const told = new ChaseCamera();
    const untold = new ChaseCamera();
    drive(told, 1, () => ({ speed: -6, course: Math.PI }), hill, 60);
    drive(untold, 1, () => ({ speed: -6 }), hill, 60);
    expect(told.camera.position.distanceTo(untold.camera.position)).toBeLessThan(0.01);
    const look = (c: ChaseCamera) => new Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion);
    expect(look(told).angleTo(look(untold))).toBeLessThan(0.01);
  });

  it("counts a landing once when both the sim and its own eye report it", () => {
    const once = new ChaseCamera();
    const twice = new ChaseCamera();
    drive(once, 0.5, () => ({}));
    drive(twice, 0.5, () => ({}));
    once.land(0.6);
    twice.land(0.6);
    twice.land(0.6);
    drive(once, 0.1, () => ({}), undefined, 10);
    drive(twice, 0.1, () => ({}), undefined, 10);
    expect(twice.camera.position.y).toBeCloseTo(once.camera.position.y, 6);
  });

  it("rushes on a boost and not for a calm player", () => {
    const c = new ChaseCamera();
    drive(c, 1, () => ({ boost: 1.2 }));
    expect(c.rush).toBeGreaterThan(0.5);
    const calm = new ChaseCamera();
    calm.calm = true;
    drive(calm, 1, () => ({ boost: 1.2 }));
    expect(calm.rush).toBe(0);
  });
});

describe("rampSeen", () => {
  const ramps = [{ lip: 100, length: 16, height: 2.4 }];
  it("climbs the wedge to the lip, then comes down gently past it instead of dropping at once", () => {
    expect(rampSeen(ramps, 80, 1000)).toBe(0);
    expect(rampSeen(ramps, 92, 1000)).toBeGreaterThan(0.5);
    expect(rampSeen(ramps, 100, 1000)).toBeCloseTo(2.4, 6);
    // Past the lip it keeps most of the height a few metres on, and none once well past it.
    expect(rampSeen(ramps, 103, 1000)).toBeGreaterThan(2);
    expect(rampSeen(ramps, 100 + RAMP_HOLD + 1, 1000)).toBe(0);
    let last = Infinity;
    for (let s = 100; s <= 100 + RAMP_HOLD; s += 1) {
      const h = rampSeen(ramps, s, 1000);
      expect(h).toBeLessThanOrEqual(last + 1e-9);
      last = h;
    }
  });
  it("finds a ramp across the start line", () => {
    expect(rampSeen([{ lip: 5, length: 16, height: 2 }], 995, 1000)).toBeGreaterThan(0.3);
  });
});

describe("bankSeen", () => {
  it("is the road's whole lean looking along it, none across it, and reversed looking back", () => {
    expect(bankSeen(0.3, 0, 1, 0)).toBeCloseTo(0.3, 6);
    expect(Math.abs(bankSeen(0.3, 0, 1, Math.PI / 2))).toBeLessThan(1e-9);
    expect(bankSeen(0.3, 0, 1, Math.PI)).toBeCloseTo(-0.3, 6);
  });
});
