import { describe, expect, it } from "vitest";
import { Grip, fingersOut, palmCentre, readHand } from "./hands";
import { seenHand, type SynthHand } from "./testHands";

const hand = (over: Partial<SynthHand> = {}): SynthHand => ({ x: 0.5, y: 0.5, fingers: "fist", ...over });

describe("fist or open, from the world points", () => {
  // The same hand seen palm-on, side-on (the side of a wheel-holding fist),
  // from the back, and tipped: the fingers' real lengths do not change.
  const views = [
    { yaw: 0 },
    { yaw: 45 },
    { yaw: 90 },
    { yaw: -90 },
    { yaw: 135 },
    { yaw: 180 },
    { yaw: 90, pitch: 40 },
    { yaw: 0, pitch: -50 },
    { yaw: 60, pitch: 20, roll: 45 },
    { yaw: 90, roll: -45 },
  ];

  for (const view of views) {
    it(`a fist reads as a fist and an open hand as open (${JSON.stringify(view)})`, () => {
      expect(fingersOut(seenHand(hand({ ...view, fingers: "fist" })).world)).toBeLessThanOrEqual(1);
      expect(fingersOut(seenHand(hand({ ...view, fingers: "open" })).world)).toBeGreaterThanOrEqual(3);
    });
  }

  it("counts the fingers out, one by one", () => {
    for (let n = 0; n <= 4; n++) expect(fingersOut(seenHand(hand({ fingers: n, yaw: 30 })).world)).toBe(n);
  });

  it("is not fooled by tracking noise", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const fist = seenHand(hand({ yaw: 90 }), { jitter: 0.004, seed });
      const open = seenHand(hand({ yaw: 90, fingers: "open" }), { jitter: 0.004, seed });
      expect(fingersOut(fist.world)).toBeLessThanOrEqual(1);
      expect(fingersOut(open.world)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("reading a hand", () => {
  it("puts the palm centre in the mirrored picture, as the player sees themself", () => {
    const reading = readHand(seenHand(hand({ x: 0.3, y: 0.6, yaw: 90 })), 16 / 9);
    expect(reading.x).toBeCloseTo(0.3, 3);
    expect(reading.y).toBeCloseTo(0.6, 3);
    // The camera's own picture has it the other way round.
    expect(palmCentre(seenHand(hand({ x: 0.3 })).landmarks).x).toBeCloseTo(0.7, 3);
  });

  it("measures the hand's size in picture heights, whatever the picture's shape", () => {
    for (const aspect of [16 / 9, 3 / 2, 4 / 3]) {
      const reading = readHand(seenHand(hand({ size: 0.09 }), { aspect }), aspect);
      expect(reading.size).toBeCloseTo(0.09, 3);
    }
  });
});

describe("Grip", () => {
  const feed = (grip: Grip, fingers: number, from: number, to: number, step = 1 / 30) => {
    for (let t = from; t <= to + 1e-9; t += step) grip.update(fingers, t);
  };

  it("takes what it first sees at once", () => {
    const grip = new Grip();
    expect(grip.update(4, 0)).toBe(true);
    expect(grip.state).toBe("open");
  });

  it("holds a new reading for 120 ms before believing it", () => {
    const grip = new Grip();
    grip.update(0, 0);
    feed(grip, 4, 1, 1.1);
    expect(grip.state).toBe("fist");
    feed(grip, 4, 1.1, 1.2);
    expect(grip.state).toBe("open");
  });

  it("dates a new state from the first frame of its reading, not from when it was believed", () => {
    const grip = new Grip();
    grip.update(0, 0);
    feed(grip, 4, 1, 1.3);
    expect(grip.state).toBe("open");
    expect(grip.since).toBeCloseTo(1, 3);
  });

  it("ignores one misread frame", () => {
    const grip = new Grip();
    feed(grip, 0, 0, 1);
    grip.update(4, 1.03);
    feed(grip, 0, 1.06, 1.5);
    expect(grip.state).toBe("fist");
  });

  it("keeps its state with two fingers out, neither fist nor open", () => {
    const grip = new Grip();
    feed(grip, 4, 0, 1);
    feed(grip, 2, 1.03, 3);
    expect(grip.state).toBe("open");
    const other = new Grip();
    feed(other, 0, 0, 1);
    feed(other, 2, 1.03, 3);
    expect(other.state).toBe("fist");
  });

  it("starts the hold again when a hand sat undecided before the change", () => {
    const grip = new Grip();
    feed(grip, 0, 0, 1);
    grip.update(4, 1.03); // a change begins...
    feed(grip, 2, 1.06, 2); // ...and stalls in the dead band for a second
    grip.update(4, 2.03); // so this is a new beginning, not the end of the old one
    expect(grip.state).toBe("fist");
  });

  it("forgets everything on reset", () => {
    const grip = new Grip();
    feed(grip, 4, 0, 1);
    grip.reset();
    expect(grip.state).toBeNull();
    expect(grip.update(0, 5)).toBe(true);
    expect(grip.state).toBe("fist");
  });
});
