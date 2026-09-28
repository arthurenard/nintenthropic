// Ported from tests/test_filtering.py: the same cases, the same numbers.
import { describe, expect, it } from "vitest";
import { gaussian, seededRandom } from "../engine/random";
import { MedianOf3, OneEuroFilter, PointFilter, Velocity, smoothingFactor } from "./filter";

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const deviation = (values: number[]) => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

describe("the One Euro filter", () => {
  it("opens up with the cutoff", () => {
    const slow = smoothingFactor(0.5, 1 / 30);
    const fast = smoothingFactor(5.0, 1 / 30);
    expect(0 < slow && slow < fast && fast < 1).toBe(true);
  });

  it("passes the first sample straight through", () => {
    expect(new OneEuroFilter().filter(0.42, 0)).toBe(0.42);
  });

  it("keeps a constant signal constant", () => {
    const filter = new OneEuroFilter();
    let value = 0;
    for (let step = 0; step < 30; step++) value = filter.filter(1.0, step / 30);
    expect(value).toBeCloseTo(1.0, 9);
  });

  it("holds a still hand much steadier than the raw signal", () => {
    const noise = gaussian(seededRandom(4));
    const filter = new OneEuroFilter(1.0, 0.5);
    const raw: number[] = [];
    const smoothed: number[] = [];
    for (let step = 0; step < 120; step++) {
      const sample = 0.5 + noise(0, 0.01); // a hand trying to hold still
      raw.push(sample);
      smoothed.push(filter.filter(sample, step / 30));
    }
    const settledRaw = raw.slice(30);
    const settled = smoothed.slice(30);
    expect(deviation(settled)).toBeLessThan(deviation(settledRaw) / 3);
    expect(Math.abs(mean(settled) - 0.5)).toBeLessThan(0.01);
  });

  it("tracks a fast sweep more closely than a fixed low-pass", () => {
    // The point of One Euro: speed buys responsiveness, stillness buys precision.
    const adaptive = new OneEuroFilter(1.0, 2.0);
    const fixed = new OneEuroFilter(1.0, 0.0);
    let target = 0;
    let fast = 0;
    let slow = 0;
    for (let step = 0; step < 20; step++) {
      const t = step / 30;
      target = t * 3.0; // a brisk sweep across the screen
      fast = adaptive.filter(target, t);
      slow = fixed.filter(target, t);
    }
    expect(Math.abs(target - fast)).toBeLessThan(Math.abs(target - slow));
  });

  it("does not divide by zero on a stalled clock", () => {
    const filter = new OneEuroFilter();
    filter.filter(1.0, 5.0);
    expect(filter.filter(2.0, 5.0)).toBe(1.0); // same timestamp: no time has passed to move in
  });

  it("holds the value and the speed when the clock stalls or runs back", () => {
    // A repeated or backwards timestamp used to be read as a fresh start: the
    // raw sample passed straight through - one unfiltered jump of the
    // crosshair - the speed estimate was zeroed, and the clock was wound back.
    const random = seededRandom(1);
    const filter = new OneEuroFilter(1.0, 0.5);
    let held = 0;
    for (let step = 0; step < 60; step++) held = filter.filter(0.5 + (random() * 0.02 - 0.01), step / 30);
    const now = 59 / 30;
    expect(filter.filter(0.9, now)).toBe(held); // a repeated timestamp moves nothing
    expect(filter.filter(0.9, now - 0.5)).toBe(held); // nor does one from the past
    // And the next real frame is measured from the last real one, not from
    // the stale timestamp: one frame's step, not a sixth of a second's.
    expect(Math.abs(filter.filter(0.51, now + 1 / 30) - held)).toBeLessThan(0.01);
  });

  it("cannot be poisoned for good by one bad sample", () => {
    // NaN folded into the average stays there: every later output was NaN.
    const filter = new OneEuroFilter();
    filter.filter(0.5, 0);
    expect(filter.filter(Number.NaN, 1 / 30)).toBe(0.5);
    expect(filter.filter(Number.POSITIVE_INFINITY, 2 / 30)).toBe(0.5);
    expect(filter.filter(0.5, 3 / 30)).toBeCloseTo(0.5, 9);
    expect(filter.filter(0.6, 4 / 30)).toBeGreaterThan(0.5); // and it carries on filtering
  });

  it("forgets its history on reset", () => {
    const filter = new OneEuroFilter();
    for (let step = 0; step < 10; step++) filter.filter(1.0, step / 30);
    filter.reset();
    expect(filter.filter(9.0, 10.0)).toBe(9.0);
  });

  it("smooths both axes of a point", () => {
    const points = new PointFilter(1.0, 0.0);
    points.filter([0, 0], 0);
    const [x, y] = points.filter([1, 1], 1 / 30);
    expect(x > 0 && x < 1).toBe(true);
    expect(x).toBeCloseTo(y, 12);
  });

  it("refuses nonsense parameters", () => {
    expect(() => new OneEuroFilter(0)).toThrow();
    expect(() => new OneEuroFilter(1, -1)).toThrow();
  });
});

describe("the median of three", () => {
  it("swallows a single spike", () => {
    const median = new MedianOf3();
    expect(median.filter(10.0)).toBe(10.0);
    expect(median.filter(10.5)).toBe(10.0); // the window is full from the first sample
    expect(median.filter(90.0)).toBe(10.5); // the spike never reaches the output
    expect(median.filter(10.2)).toBe(10.5);
  });

  it("does not let the very second sample be a spike either", () => {
    const median = new MedianOf3();
    median.filter(0.0);
    expect(median.filter(0.9)).toBe(0.0); // one wild frame out of two is still one wild frame
  });

  it("starts afresh after a reset", () => {
    const median = new MedianOf3();
    for (const sample of [0.9, 0.9, 0.9]) median.filter(sample);
    median.reset();
    expect(median.filter(0.0)).toBe(0.0); // no stale samples voting from before the reset
    expect(median.filter(0.9)).toBe(0.0); // and the window is full again from that first one
  });
});

describe("the velocity of a filtered signal", () => {
  it("reads a steady sweep at its true speed, not the filter's inflated one", () => {
    const filter = new OneEuroFilter(1.2, 0.8);
    const velocity = new Velocity();
    let speed = 0;
    for (let step = 0; step < 60; step++) {
      const t = step / 30;
      speed = velocity.update(filter.filter(0.8 * t, t), t);
    }
    expect(speed).toBeCloseTo(0.8, 1);
  });

  it("is zero for a still signal and after a reset", () => {
    const velocity = new Velocity();
    for (let step = 0; step < 10; step++) velocity.update(0.3, step / 30);
    expect(velocity.value).toBeCloseTo(0, 9);
    velocity.update(0.9, 1);
    velocity.reset();
    expect(velocity.value).toBe(0);
  });
});

describe("retuning a filter", () => {
  it("takes new settings and keeps what it has seen", () => {
    const filter = new PointFilter();
    expect([filter.minCutoff, filter.beta]).toEqual([1.2, 0.8]);
    for (let step = 0; step < 10; step++) filter.filter([0.2, 0.2], step / 30);
    filter.tune(0.6, 0.5);
    expect([filter.minCutoff, filter.beta]).toEqual([0.6, 0.5]);
    // Not started afresh: a jump is smoothed, not passed straight through.
    const [x] = filter.filter([0.8, 0.2], 10 / 30);
    expect(x).toBeGreaterThan(0.2);
    expect(x).toBeLessThan(0.5);
  });

  it("refuses settings that make no sense", () => {
    const filter = new OneEuroFilter();
    expect(() => filter.tune(0, 0.8)).toThrow(RangeError);
    expect(() => filter.tune(1, -1)).toThrow(RangeError);
    expect(() => new OneEuroFilter(-1)).toThrow(RangeError);
    expect([filter.minCutoff, filter.beta]).toEqual([1.2, 0.8]);
  });
});
