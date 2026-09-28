import { describe, expect, it } from "vitest";
import { asCameraSees, makeHand, type HandPose } from "./synthetic";
import { HandTrust, JUMP, RECENT, TRUST_AFTER } from "./trust";

/** A hand whose palm sits around (x, y) of the picture (as the player sees it). */
const handAt = (x: number, y: number, pose: HandPose = {}) =>
  asCameraSees(makeHand({ thumbDegrees: 20, indexTip: [x, y - 0.25], wrist: [x, y + 0.08], scale: 0.8, ...pose }));

describe("trusting the player's hand", () => {
  it("follows a hand that moves as a hand moves", () => {
    const trust = new HandTrust();
    let t = 0;
    for (let x = 0.3; x <= 0.7; x += 0.02) expect(trust.judge(handAt(x, 0.5), (t += 33))).toBe("trusted");
  });

  it("doubts a hand that appears far from the player's, then follows it if it stays", () => {
    const trust = new HandTrust();
    let t = 0;
    for (let i = 0; i < 10; i++) trust.judge(handAt(0.3, 0.5), (t += 33));
    // Someone else's hand across the picture.
    const jumped = t + 33;
    expect(trust.judge(handAt(0.8, 0.4), (t += 33))).toBe("doubted");
    while (t + 33 < jumped + TRUST_AFTER) expect(trust.judge(handAt(0.8, 0.4), (t += 33))).toBe("doubted");
    expect(trust.judge(handAt(0.8, 0.4), (t += 33))).toBe("adopted");
    expect(trust.judge(handAt(0.81, 0.4), (t += 33))).toBe("trusted");
  });

  it("stays with the player's hand when the tracker flickers to another and back", () => {
    const trust = new HandTrust();
    let t = 0;
    for (let i = 0; i < 10; i++) trust.judge(handAt(0.3, 0.5), (t += 33));
    for (let i = 0; i < 30; i++) {
      const theirs = i % 3 === 1;
      expect(trust.judge(theirs ? handAt(0.85, 0.5) : handAt(0.3, 0.5), (t += 33))).toBe(theirs ? "doubted" : "trusted");
    }
  });

  it("finds the hand again anywhere after it has been gone a while", () => {
    const trust = new HandTrust();
    let t = 0;
    for (let i = 0; i < 10; i++) trust.judge(handAt(0.2, 0.5), (t += 33));
    const lastSeen = t;
    while (t < lastSeen + RECENT + 50) expect(trust.judge(null, (t += 33))).toBe("none");
    expect(trust.judge(handAt(0.8, 0.5), (t += 33))).toBe("trusted");
  });

  it("measures the jump across the palm, in fractions of the picture", () => {
    const trust = new HandTrust();
    trust.judge(handAt(0.3, 0.5), 0);
    expect(trust.judge(handAt(0.3 + JUMP * 0.8, 0.5), 33)).toBe("trusted");
    expect(trust.judge(handAt(0.3 + JUMP * 0.8 + JUMP * 1.2, 0.5), 66)).toBe("doubted");
  });
});
