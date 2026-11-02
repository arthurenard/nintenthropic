import { describe, expect, it } from "vitest";
import type { KartView } from "../contract";
import { Effects } from "./effects";

describe("the particles", () => {
  it("all go when a new race begins, so the last one's smoke and confetti do not hang over the grid", () => {
    const fx = new Effects(400);
    fx.confetti(0, 0, 0);
    fx.puff(0, 0, 0, 12);
    fx.update(1 / 60);
    expect(fx.live).toBeGreaterThan(90);
    fx.clear();
    expect(fx.live).toBe(0);
    fx.dispose();
  });
});

function kart(over: Partial<KartView> = {}): KartView {
  return {
    id: 0, x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
    ...over,
  };
}

/** How many smoke sprites (the ordinary-blended pool) are alive after a kart has done this for `seconds`. */
function smokeAfter(seconds: number, over: Partial<KartView>, watched: boolean, fps = 60): number {
  const fx = new Effects(900);
  if (watched) fx.focus = new Set([0]);
  const k = kart(over);
  for (let i = 0; i < seconds * fps; i++) {
    fx.kart(k, 1 / fps);
    fx.update(1 / fps);
  }
  const live = (fx as unknown as { norm: { live: number } }).norm.live;
  fx.dispose();
  return live;
}

describe("the exhaust's puffs", () => {
  it("breathe from a kart that is slow, a handful alive at once, and fewer from the karts no view follows", () => {
    const watched = smokeAfter(3, { speed: 0 }, true);
    const other = smokeAfter(3, { speed: 0 }, false);
    // Two pipes every 0.13 s, each puff alive for 0.6 to 0.9 s: about a dozen.
    expect(watched).toBeGreaterThan(8);
    expect(watched).toBeLessThan(18);
    expect(other).toBeGreaterThan(watched * 0.35);
    expect(other).toBeLessThan(watched * 0.65);
    // A kart pulling away puffs a little less often than one standing still.
    expect(smokeAfter(3, { speed: 7 }, true)).toBeLessThan(watched);
    expect(smokeAfter(3, { speed: 7 }, true)).toBeGreaterThan(5);
  });

  it("come as often at 30 frames a second as at 60", () => {
    expect(Math.abs(smokeAfter(3, { speed: 0 }, true, 30) - smokeAfter(3, { speed: 0 }, true, 60))).toBeLessThanOrEqual(4);
  });

  it("stop above 8 m/s, on a boost and in the air", () => {
    expect(smokeAfter(3, { speed: 9 }, true)).toBe(0);
    expect(smokeAfter(3, { speed: 3, boost: 1 }, true)).toBe(0);
    expect(smokeAfter(3, { speed: 3, hop: 1.5 }, true)).toBe(0);
  });
});
