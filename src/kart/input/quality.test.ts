/**
 * The wheel's tracking quality in numbers: how late the steer is behind the hands, how it glides between camera frames,
 * and that a hand misread on one frame never brakes the kart. Made-up hands (testHands.ts), so the numbers are the
 * reader's own and repeat exactly.
 */
import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "../../input/filter";
import { mulberry32 } from "../../engine/rules/rng";
import { WHEEL, WheelReader, wheelAngle } from "./wheel";
import { Grip } from "./hands";
import { Rig, handFrame, wheelHands } from "./testHands";

describe("the steer follows the hands", () => {
  it("is at most a few degrees behind a wheel turned 90 degrees a second, on every tick between 30 frames a second", () => {
    const rig = new Rig({ fps: 30 });
    rig.wheel(1, { angle: 0 });
    const began = rig.now;
    let worst = 0;
    const speed = 90;
    const t0 = rig.now;
    // Turn for 0.8 s, looking at the reported angle at every 60 Hz tick after the first 0.3 s (the filter's warm-up).
    for (let step = 0; step < 48; step++) {
      const elapsed = (rig.now + 1000 / 60 - began) / 1000;
      rig.run(1 / 60, (e) => wheelHands({ angle: speed * (elapsed - 1 / 60 + e) }));
      if (elapsed > 0.3) worst = Math.max(worst, Math.abs(speed * (rig.now - t0) / 1000 - rig.last.status.angle));
    }
    // 90 degrees a second is 1.5 degrees a tick: a camera frame old is already 3 degrees behind, with no filter at all.
    expect(worst).toBeLessThan(5);
  });

  it("does not overshoot when the wheel stops", () => {
    const rig = new Rig({ fps: 30 });
    rig.wheel(0.6, { angle: 0 });
    rig.run(0.3, (e) => wheelHands({ angle: Math.min(20, 200 * e) })); // 0 to 20 degrees at 200 degrees a second, then still
    let highest = 0;
    for (let i = 0; i < 40; i++) {
      rig.wheel(1 / 60, { angle: 20 });
      highest = Math.max(highest, rig.last.status.angle);
    }
    expect(highest).toBeLessThan(23);
    expect(rig.last.status.angle).toBeGreaterThan(19);
  });

  it("holds still on a resting wheel", () => {
    const rig = new Rig({ fps: 30, jitter: 0.004 });
    rig.wheel(1, { angle: 0 });
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      rig.wheel(1 / 60, { angle: 0 });
      worst = Math.max(worst, Math.abs(rig.last.status.angle));
    }
    expect(worst).toBeLessThan(WHEEL.deadZone);
    expect(rig.last.input.steer).toBe(0);
  });
});

describe("the filter's numbers (angle noise of 0.4 degrees, 30 frames a second)", () => {
  const gauss = (random: () => number) => {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += random();
    return (sum - 3) * Math.SQRT2;
  };
  const lagAt = (speed: number, minCutoff: number, beta: number) => {
    const random = mulberry32(7);
    const filter = new OneEuroFilter(minCutoff, beta);
    let total = 0;
    let count = 0;
    for (let i = 0; i < 36; i++) {
      const t = i / 30;
      const out = filter.filter(speed * t + gauss(random) * 0.4, t);
      if (t > 0.6) {
        total += (speed * t - out) / speed;
        count++;
      }
    }
    return (total / count) * 1000;
  };

  it("lags less than the first settings did, at slow and medium turns", () => {
    const now = WHEEL.smoothing;
    expect(lagAt(30, now.minCutoff, now.beta)).toBeLessThan(lagAt(30, 1.5, 0.05) - 8);
    expect(lagAt(90, now.minCutoff, now.beta)).toBeLessThan(lagAt(90, 1.5, 0.05) - 4);
  });
});

describe("a hand misread on one frame never brakes", () => {
  it("a first frame back that says open, then fists, is not a brake", () => {
    for (const fps of [30, 15, 10]) {
      const rig = new Rig({ fps });
      rig.wheel(1, { angle: 0 });
      rig.empty(1);
      let braked = false;
      // The first frame back misreads both fists as open hands, then the truth.
      rig.run(1 / fps, () => wheelHands({ angle: 0, fingers: "open" }));
      braked ||= rig.last.status.mode === "brake";
      for (let i = 0; i < fps; i++) {
        rig.run(1 / fps, () => wheelHands({ angle: 0 }));
        braked ||= rig.last.status.mode === "brake" || rig.last.input.brake > 0;
      }
      expect(braked, `at ${fps} frames a second`).toBe(false);
    }
  });

  it("one open frame among fists, at 10 frames a second, changes nothing", () => {
    const rig = new Rig({ fps: 10 });
    rig.wheel(1, { angle: 0 });
    let braked = false;
    for (let i = 0; i < 20; i++) {
      rig.run(0.1, () => wheelHands({ angle: 0, fingers: i % 5 === 2 ? "open" : "fist" }));
      braked ||= rig.last.status.mode === "brake";
    }
    expect(braked).toBe(false);
    expect(rig.last.status.grip).toBe("fists");
  });

  it("open hands that stay open still brake, and quickly", () => {
    for (const fps of [30, 10]) {
      const rig = new Rig({ fps });
      rig.wheel(1, { angle: 0 });
      let at = -1;
      const began = rig.now;
      for (let i = 0; i < fps * 2 && at < 0; i++) {
        rig.run(1 / fps, () => wheelHands({ angle: 0, fingers: "open" }));
        if (rig.last.status.mode === "brake") at = rig.now - began;
      }
      expect(at, `at ${fps} frames a second`).toBeGreaterThan(0);
      expect(at).toBeLessThan(fps === 30 ? 400 : 600);
    }
  });
});

describe("Grip needs two frames", () => {
  it("does not change on one frame, however long the camera took", () => {
    const grip = new Grip();
    grip.update(0, 0);
    grip.update(0, 0.1);
    expect(grip.update(4, 1)).toBe(false);
    expect(grip.state).toBe("fist");
    expect(grip.update(0, 1.1)).toBe(false);
    expect(grip.update(4, 2)).toBe(false);
    expect(grip.update(4, 2.15)).toBe(true);
    expect(grip.state).toBe("open");
  });

  it("is steady from the second frame on", () => {
    const grip = new Grip();
    grip.update(4, 0);
    expect(grip.steady).toBe(false);
    grip.update(4, 0.05);
    expect(grip.steady).toBe(true);
  });
});

describe("frames that arrive late", () => {
  /** A wheel turned at `speed` degrees a second, 30 frames a second each `delay` ms old on arrival: the worst error against where the hands are now, and how far past `stop` it goes. */
  const run = (speed: number, delay: number, stop: number) => {
    const reader = new WheelReader();
    const truth = (ms: number) => Math.max(0, Math.min(stop, (speed * (ms - 1000)) / 1000));
    const stops = 1000 + (stop / speed) * 1000;
    let worst = 0;
    let highest = 0;
    for (let ms = 0; ms < 3000; ms += 1000 / 60) {
      if (Math.round(ms / (1000 / 60)) % 2 === 0) {
        const took = ms - delay;
        reader.push(handFrame(wheelHands({ angle: truth(took) }), took), ms);
      }
      const angle = reader.sample(ms).status.angle;
      if (ms > 1400 && ms < stops) worst = Math.max(worst, Math.abs(angle - truth(ms)));
      if (ms > stops) highest = Math.max(highest, angle);
    }
    return { worst, overshoot: highest - stop };
  };

  it("steers closer to where the hands are than to where they were", () => {
    const late = run(90, 70, 160);
    const prompt = run(90, 0, 160);
    expect(late.worst).toBeLessThan(prompt.worst + 6);
    expect(late.worst).toBeLessThan(7.5);
  });

  it("overshoots a wheel that stops by a few degrees at most, even a fast one", () => {
    expect(run(200, 70, 30).overshoot).toBeLessThan(3.5);
    expect(run(90, 70, 30).overshoot).toBeLessThan(2);
  });
});

describe("the line through the palms does not care which hand is which", () => {
  it("is the same with the hands swapped", () => {
    const a = { x: 0.3, y: 0.4 };
    const b = { x: 0.7, y: 0.5 };
    expect(wheelAngle(a, b, 16 / 9, null)).toBeCloseTo(wheelAngle(b, a, 16 / 9, null), 9);
  });
});
