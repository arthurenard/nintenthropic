import { describe, expect, it } from "vitest";
import { Hammer, HAMMER_MIN_GAP, type HammerFrame } from "./hammer";

const DT = 1 / 60;
const LIVE: Omit<HammerFrame, "armed" | "fired"> = { live: true, reloading: false, rounds: 5 };

/** Frames of the thumb: "u" up (armed), "f" the fold that fires, "d" down (still folded). */
function play(h: Hammer, thumb: string, gun: Partial<HammerFrame> = {}): number[] {
  const clicks: number[] = [];
  [...thumb].forEach((c, i) => {
    const frame: HammerFrame = { ...LIVE, ...gun, armed: c === "u", fired: c === "f" };
    if (h.update(DT, frame)) clicks.push(i);
  });
  return clicks;
}

const hold = (c: string, seconds: number) => c.repeat(Math.round(seconds / DT));

describe("the hammer's click", () => {
  it("sounds once as the thumb comes back up after a shot", () => {
    const h = new Hammer();
    const thumb = hold("u", 0.5) + "f" + hold("d", 0.15) + hold("u", 0.5);
    expect(play(h, thumb)).toEqual([Math.round(0.5 / DT) + 1 + Math.round(0.15 / DT)]);
  });

  it("does not sound for a hand found again after being lost", () => {
    const h = new Hammer();
    expect(play(h, hold("u", 0.5) + hold("d", 0.5) + hold("u", 0.5))).toEqual([]);
  });

  it("stays quiet while reloading and on an empty cylinder", () => {
    const thumb = hold("u", 0.3) + "f" + hold("d", 0.15) + hold("u", 0.3);
    expect(play(new Hammer(), thumb, { reloading: true })).toEqual([]);
    expect(play(new Hammer(), thumb, { rounds: 0 })).toEqual([]);
  });

  it("stays quiet in the aim check, and a fold there is not heard in play", () => {
    const h = new Hammer();
    expect(play(h, hold("u", 0.3) + "f" + hold("d", 0.1), { live: false })).toEqual([]);
    expect(play(h, hold("u", 0.5))).toEqual([]);
  });

  it("cannot chatter, however fast the thumb seems to flick", () => {
    const h = new Hammer();
    // A fold and a raise every 50 ms for a second: at most one click per gap.
    const clicks = play(h, "ufd".repeat(20));
    expect(clicks.length).toBeGreaterThan(0);
    expect(clicks.length).toBeLessThanOrEqual(Math.ceil(1 / HAMMER_MIN_GAP));
    for (let i = 1; i < clicks.length; i++) expect(((clicks[i] as number) - (clicks[i - 1] as number)) * DT).toBeGreaterThanOrEqual(HAMMER_MIN_GAP - 1e-9);
  });
});
