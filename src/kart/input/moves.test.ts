/**
 * The wheel reader on real hands: the moves in fixtures/moves.json (a person doing the game's moves in front of a
 * webcam, replayed through the real hand tracker: tools/replay/record.mjs), against what he was doing at each moment
 * (replay.ts SEGMENTS, labelled by eye from the video).
 */
import { describe, expect, it } from "vitest";
import recording from "./fixtures/moves.json";
import { play, score, SEGMENTS, type Recording, type Tick } from "./replay";
import { WheelReader } from "./wheel";

const moves = recording as unknown as Recording;
const run = (options: Parameters<typeof play>[2] = {}): Tick[] => play(() => new WheelReader(), moves, options);

describe("a recording of real moves, read by the wheel", () => {
  const ticks = run();
  const result = score(ticks);

  it("never brakes while the hands are fists", () => {
    expect(result.fistTicks).toBeGreaterThan(200);
    expect(result.falseBrakeTicks).toBe(0);
  });

  it("brakes quickly when both hands are held open, and lets go quickly when one closes", () => {
    expect(result.brakeAfter["open-start"]).toBeLessThan(0.3);
    expect(result.brakeAfter["brake-1"]).toBeLessThan(0.35);
    expect(result.brakeRelease["brake-1"]!).toBeLessThan(0.3);
  });

  it("does not brake for a hand that is mostly out of the picture or loosely held", () => {
    expect(result.brakeOutsideOpen).toBeLessThan(0.1);
  });

  it("counts the one-hand flick once, and no item anywhere else", () => {
    expect(result.items).toBe(1);
    expect(result.falseItems).toBe(0);
  });

  it("steers the right way at both locks, and to full right lock", () => {
    expect(result.lockLeft.rightWay).toBeGreaterThan(0.95);
    expect(result.lockLeft.mean).toBeLessThan(-0.85);
    expect(result.lockRight.rightWay).toBeGreaterThan(0.95);
    expect(result.lockRight.mean).toBeGreaterThan(0.95);
  });

  it("is steady on resting fists: no jitter beyond a degree or two, no jump of steer", () => {
    expect(result.jitter).toBeLessThan(3);
    expect(result.steadyJump).toBeLessThan(0.1);
  });

  it("counts the shake of quick turns", () => {
    expect(result.shakes).toBeGreaterThanOrEqual(1);
  });

  it("is as good with half the frames (a camera read at 15 a second, as three or four players on one camera are)", () => {
    const slow = score(run({ drop: 2 }));
    expect(slow.falseBrakeTicks).toBe(0);
    expect(slow.falseItems).toBe(0);
    expect(slow.items).toBe(1);
    expect(slow.lockRight.rightWay).toBeGreaterThan(0.95);
  });

  it("is as good at a third of the frames (10 a second)", () => {
    const slow = score(run({ drop: 3 }));
    expect(slow.falseBrakeTicks).toBe(0);
    expect(slow.falseItems).toBe(0);
  });

  it("is the same with every frame 80 ms older (a slow machine)", () => {
    const old = score(run({ delayOf: (_i, recorded) => recorded + 80 }));
    expect(old.falseBrakeTicks).toBe(0);
    expect(old.items).toBe(1);
  });

  it("has labels that lie inside the recording", () => {
    expect(SEGMENTS.at(-1)!.t1).toBeLessThanOrEqual(moves.duration + 0.01);
  });
});
