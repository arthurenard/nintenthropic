/**
 * What the wheel does with the tracker's slips, each a test that fails on the code before it was made robust:
 * letting go of the brake quickly, a hand half out of the picture, a hand lost for a frame in the middle of a shake,
 * and frames that arrive unevenly.
 */
import { describe, expect, it } from "vitest";
import { GRIP, Grip, NEITHER, clipped, finishReading, readPalm } from "./hands";
import { WHEEL, WheelReader } from "./wheel";
import { Rig, handFrame, wheelHands } from "./testHands";

describe("letting go of the brake", () => {
  it("takes a fist after two frames and 50 ms, but an open hand only after 120 ms", () => {
    const grip = new Grip();
    grip.update(4, 0);
    grip.update(4, 0.04);
    expect(grip.update(0, 1)).toBe(false);
    expect(grip.update(0, 1.034)).toBe(false); // two frames, but not yet 50 ms
    expect(grip.update(0, 1.067)).toBe(true);
    expect(grip.state).toBe("fist");
    expect(grip.update(4, 2)).toBe(false);
    expect(grip.update(4, 2.067)).toBe(false); // 67 ms is not enough to brake on
    expect(grip.update(4, 2.134)).toBe(true);
    expect(GRIP.holdFist).toBeLessThan(GRIP.hold);
  });

  it("the kart lets go of the brake within 0.25 s of the hands closing, at 30 frames a second", () => {
    const rig = new Rig({ fps: 30 });
    rig.wheel(0.5, { angle: 0 });
    rig.hold(1, wheelHands({ angle: 0, fingers: "open" }));
    expect(rig.last.input.brake).toBeGreaterThan(0);
    const closed = rig.now;
    let released = -1;
    for (let i = 0; i < 40 && released < 0; i++) {
      rig.hold(1 / 60, wheelHands({ angle: 0, fingers: "fist" }));
      if (rig.last.input.brake === 0) released = rig.now - closed;
    }
    expect(released).toBeGreaterThan(0);
    expect(released).toBeLessThan(250);
  });
});

describe("a hand half out of the picture", () => {
  it("is not read: its fingers are guesses", () => {
    const fist = wheelHands({ angle: 0 })[0];
    const open = handFrame([{ ...fist, fingers: "open", y: 0.995 }], 0).hands[0]!;
    expect(clipped(open.landmarks)).toBe(true);
    expect(finishReading(readPalm(open), open, 16 / 9).fingers).toBe(NEITHER);
    const inside = handFrame([{ ...fist, fingers: "open", y: 0.6 }], 0).hands[0]!;
    expect(clipped(inside.landmarks)).toBe(false);
    expect(finishReading(readPalm(inside), inside, 16 / 9).fingers).toBe(4);
  });

  it("keeps its grip while it is at the edge: no brake from fists whose lower hand drops off the bottom", () => {
    const rig = new Rig({ fps: 30 });
    rig.wheel(1, { angle: 0 });
    let braked = false;
    // The right hand sinks out of the bottom of the picture, its fingers misread as open on the way.
    rig.run(1, (e) => wheelHands({ angle: 0, right: { y: 0.45 + e * 0.6, fingers: e > 0.3 ? "open" : "fist" } }));
    braked ||= rig.last.status.mode === "brake";
    expect(braked).toBe(false);
  });
});

describe("a shake", () => {
  const swing = (rig: Rig, lose: number | null) => {
    // Right, left, right at 0.6 s between reversals (a quick turn, not a rattle), 40 degrees each way.
    let frame = 0;
    rig.run(1.8, (e) => {
      frame++;
      if (lose !== null && Math.abs(e - lose) < 0.02) return [];
      return wheelHands({ angle: 40 * Math.sin((e / 1.2) * Math.PI * 2) });
    });
    void frame;
  };

  it("is counted at the pace a person shakes it", () => {
    const rig = new Rig({ fps: 30 });
    rig.wheel(1, { angle: 0 });
    swing(rig, null);
    rig.wheel(0.3, { angle: 0 });
    expect(rig.last.input.shakes).toBeGreaterThanOrEqual(1);
  });

  it("is still counted when the tracker loses the hands for a frame in the middle of it", () => {
    const rig = new Rig({ fps: 30 });
    rig.wheel(1, { angle: 0 });
    swing(rig, 0.55);
    rig.wheel(0.3, { angle: 0 });
    expect(rig.last.input.shakes).toBeGreaterThanOrEqual(1);
  });
});

describe("frames that arrive unevenly", () => {
  const play = (gaps: (i: number) => number, pose: (seconds: number) => number, seconds: number) => {
    const reader = new WheelReader();
    let ms = 1000;
    let i = 0;
    const out: number[] = [];
    let nextFrame = ms;
    for (let tick = 0; ms < 1000 + seconds * 1000; tick++) {
      ms = 1000 + tick * (1000 / 60);
      while (nextFrame <= ms) {
        reader.push(handFrame(wheelHands({ angle: pose((nextFrame - 1000) / 1000) }), nextFrame), nextFrame);
        nextFrame += gaps(i++);
      }
      out.push(reader.sample(ms).status.angle);
    }
    return out;
  };
  // Frames 5 to 60 ms apart, in no pattern.
  const uneven = (i: number) => 5 + ((i * 37) % 56);

  it("a resting wheel stays inside the dead zone, however unevenly the frames come", () => {
    const angles = play(uneven, () => 0, 3);
    expect(Math.max(...angles.map(Math.abs))).toBeLessThan(WHEEL.deadZone);
  });

  it("a steady turn never steps further than the wheel went since the last frame, and never wobbles backwards", () => {
    const speed = 100;
    const angles = play(uneven, (t) => Math.min(35, speed * Math.max(0, t - 0.5)), 2);
    let most = 0;
    let least = 0;
    for (let i = 1; i < angles.length; i++) {
      most = Math.max(most, angles[i]! - angles[i - 1]!);
      least = Math.min(least, angles[i]! - angles[i - 1]!);
    }
    expect(most).toBeLessThan(speed * 0.06); // the longest gap between frames
    expect(least).toBeGreaterThan(-1);
  });
});
