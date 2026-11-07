import { describe, expect, it } from "vitest";
import type { TrackTheme } from "./kinds";
import { SPACES, enterRoom, spaceImpulse } from "./space";

const SR = 24000;

describe("a track's room", () => {
  it("has an impulse response for every theme, longer where the place is bigger, and the same each time", () => {
    const themes = Object.keys(SPACES) as TrackTheme[];
    expect(themes.length).toBe(9);
    for (const theme of themes) {
      const [l, r] = spaceImpulse(theme, SR);
      expect(l.length).toBe(r.length);
      expect(l.length).toBeGreaterThan(SR * SPACES[theme].seconds * 0.99);
      expect(l.every(Number.isFinite)).toBe(true);
      // Nothing before the pre-delay.
      const pre = Math.floor(SPACES[theme].predelay * SR) - 1;
      expect(l.subarray(0, pre).every((x) => x === 0)).toBe(true);
      expect(spaceImpulse(theme, SR)[0]).toBe(l);
    }
    expect(spaceImpulse("snow", SR)[0].length).toBeGreaterThan(spaceImpulse("meadow", SR)[0].length * 2);
  });

  it("is two different channels (the width of the room)", () => {
    const [l, r] = spaceImpulse("funfair", SR);
    let same = 0;
    for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same++;
    expect(same / l.length).toBeLessThan(0.05);
  });

  it("is given to a bus that takes a room, and passed over by one that does not", () => {
    const calls: { n: number; level: number | undefined }[] = [];
    const bus = { ctx: { sampleRate: SR }, setImpulse: (l: Float32Array, _r: Float32Array, level?: number) => calls.push({ n: l.length, level }) };
    expect(enterRoom(bus, "canyon")).toBe(true);
    expect(calls[0]!.level).toBe(SPACES.canyon.level);
    expect(enterRoom({}, "canyon")).toBe(false);
  });
});
