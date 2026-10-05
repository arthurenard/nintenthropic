import { describe, expect, it } from "vitest";
import { cameraSize, handConfidence, handsFor, isCrowd, seenHands } from "./hands";
import type { Landmark } from "./types";

const points = (x: number, z = 0): Landmark[] => Array.from({ length: 21 }, (_, i) => ({ x: x + i / 100, y: 0.5, z }));

describe("seenHands", () => {
  it("keeps every complete hand, in MediaPipe's order, with its world points and handedness", () => {
    const hands = seenHands({
      landmarks: [points(0.2), points(0.6)],
      worldLandmarks: [points(0, 1), points(0, 2)],
      handedness: [[{ categoryName: "Left", score: 0.9 }], [{ categoryName: "Right", score: 0.8 }]],
    });
    expect(hands).toHaveLength(2);
    expect(hands[0]!.landmarks[0]!.x).toBeCloseTo(0.2);
    expect(hands[0]!.world[0]!.z).toBe(1);
    expect(hands[0]!.handedness).toBe("Left");
    expect(hands[0]!.score).toBeCloseTo(0.9);
    expect(hands[1]!.landmarks[0]!.x).toBeCloseTo(0.6);
    expect(hands[1]!.world[0]!.z).toBe(2);
    expect(hands[1]!.handedness).toBe("Right");
  });

  it("finds nothing when no hand is in view", () => {
    expect(seenHands({ landmarks: [], worldLandmarks: [], handedness: [] })).toEqual([]);
  });

  it("skips a hand with fewer than 21 points", () => {
    const hands = seenHands({ landmarks: [points(0.2).slice(0, 20), points(0.6)], worldLandmarks: [points(0), points(0)] });
    expect(hands).toHaveLength(1);
    expect(hands[0]!.landmarks[0]!.x).toBeCloseTo(0.6);
  });

  it("copies the points, so a result MediaPipe reuses cannot change a published frame", () => {
    const raw = points(0.3);
    const [hand] = seenHands({ landmarks: [raw], worldLandmarks: [points(0)] });
    raw[0]!.x = 0.9;
    expect(hand!.landmarks[0]!.x).toBeCloseTo(0.3);
  });

  it("leans on the image points when a hand has no world points, rather than dropping the hand", () => {
    const [hand] = seenHands({ landmarks: [points(0.4)] });
    expect(hand!.world[0]!.x).toBeCloseTo(0.4);
    expect(hand!.handedness).toBeNull();
    expect(hand!.score).toBe(0);
  });

  it("calls an unknown handedness null", () => {
    const [hand] = seenHands({ landmarks: [points(0.4)], handedness: [[{ categoryName: "", score: 0.5 }]] });
    expect(hand!.handedness).toBeNull();
  });
});

describe("hands for the players on one camera", () => {
  it("looks for two hands a player, up to eight", () => {
    expect([1, 2, 3, 4].map(handsFor)).toEqual([2, 4, 6, 8]);
    expect(handsFor(0)).toBe(2);
    expect(handsFor(9)).toBe(8);
  });

  it("is less certain, and asks the camera for more pixels, only for three or four players", () => {
    for (const hands of [1, 2, 4]) {
      expect(isCrowd(hands)).toBe(false);
      expect(handConfidence(hands)).toBe(0.5);
      expect(cameraSize(hands)).toEqual({ width: 1280, height: 720 });
    }
    for (const hands of [6, 8]) {
      expect(isCrowd(hands)).toBe(true);
      expect(handConfidence(hands)).toBe(0.4);
      expect(cameraSize(hands)).toEqual({ width: 1920, height: 1080 });
    }
  });
});
