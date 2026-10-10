import { describe, expect, it } from "vitest";
import { DynamicResolution, StrainWatch } from "./dynamicResolution";

const VSYNC = 1000 / 60;

/** A GPU whose frame cost grows with the pixels drawn, shown through vsync:
 * a frame that misses its slot waits for the next one. */
function run(resolution: DynamicResolution, cost: (scale: number) => number, frames: number): number[] {
  const scales: number[] = [];
  for (let i = 0; i < frames; i++) {
    const work = cost(resolution.scale);
    resolution.sample(Math.ceil(work / VSYNC - 1e-9) * VSYNC);
    scales.push(resolution.scale);
  }
  return scales;
}

describe("dynamic resolution", () => {
  it("leaves a machine that keeps up at full resolution", () => {
    const resolution = new DynamicResolution();
    run(resolution, () => 9, 3000);
    expect(resolution.scale).toBe(1);
  });

  it("drops quickly when frames run long, and not below the floor", () => {
    const resolution = new DynamicResolution();
    const scales = run(resolution, () => 40, 60 * 10);
    expect(scales[45]).toBeLessThan(1); // within the first second
    expect(resolution.scale).toBe(0.6);
  });

  it("settles on the largest scale that holds 60 fps, without pumping", () => {
    // Pixel cost: 6 ms fixed plus 14 ms at full resolution, by area.
    const cost = (scale: number) => 6 + 14 * scale * scale;
    const resolution = new DynamicResolution();
    const scales = run(resolution, cost, 60 * 60);
    const settled = scales.slice(60 * 20);
    // It rests at 0.85 (0.9 misses the slot), trying 0.9 again ever more rarely.
    expect(cost(resolution.scale)).toBeLessThanOrEqual(VSYNC);
    const tooBig = settled.filter((scale) => cost(scale) > VSYNC).length;
    expect(tooBig / settled.length).toBeLessThan(0.03);
    const changes = settled.filter((scale, i) => i > 0 && scale !== settled[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(4);
  });

  it("comes back up once the load goes away", () => {
    const resolution = new DynamicResolution();
    run(resolution, () => 40, 60 * 5);
    expect(resolution.scale).toBe(0.6);
    run(resolution, () => 8, 60 * 30);
    expect(resolution.scale).toBe(1);
  });

  it("ignores a hitch", () => {
    const resolution = new DynamicResolution();
    for (let i = 0; i < 100; i++) resolution.sample(i === 50 ? 2000 : VSYNC);
    expect(resolution.scale).toBe(1);
  });

  it("is not pushed down by the odd long frame", () => {
    // A 100 ms frame now and then - garbage collection, a shader compiling -
    // while every other frame makes its slot.
    const resolution = new DynamicResolution();
    for (let i = 0; i < 60 * 30; i++) resolution.sample(i % 20 === 0 ? 100 : VSYNC);
    expect(resolution.scale).toBe(1);
  });

  it("starts where the tier guess says", () => {
    expect(new DynamicResolution({ initial: 0.75 }).scale).toBe(0.75);
    expect(new DynamicResolution({ initial: 0.1 }).scale).toBe(0.6);
  });
});

describe("the strain watch", () => {
  const frames = (watch: StrainWatch, seconds: number, atFloor: boolean, per = 1 / 30): number => {
    let told = 0;
    for (let t = 0; t < seconds - 1e-9; t += per) if (watch.frame(per, atFloor)) told++;
    return told;
  };

  it("says nothing while the resolution has room, and speaks once when it has sat at the floor long enough", () => {
    const watch = new StrainWatch(6);
    expect(frames(watch, 30, false)).toBe(0);
    expect(frames(watch, 5, true)).toBe(0);
    expect(frames(watch, 3, true)).toBe(1);
    expect(frames(watch, 30, true)).toBe(0);
  });

  it("starts counting again when the resolution comes off the floor or a hitch comes", () => {
    const watch = new StrainWatch(6);
    frames(watch, 5, true);
    frames(watch, 0.1, false);
    expect(frames(watch, 5, true)).toBe(0);
    watch.frame(2, true); // a tab put away, not time spent struggling
    expect(frames(watch, 5.5, true)).toBe(0);
    expect(frames(watch, 1, true)).toBe(1);
  });

  it("is told by dynamic resolution itself on a machine that cannot keep up at any size", () => {
    const resolution = new DynamicResolution();
    const watch = new StrainWatch(6);
    let seconds = 0;
    let told = -1;
    for (let i = 0; i < 60 * 30 && told < 0; i++) {
      resolution.sample(40);
      seconds += 0.04;
      if (watch.frame(0.04, resolution.scale <= resolution.min + 1e-6)) told = seconds;
    }
    // The scale takes a few seconds to reach the floor, then six more there.
    expect(told).toBeGreaterThan(6);
    expect(told).toBeLessThan(16);
  });

  it("never fires for a machine that keeps up, whatever its tier", () => {
    const resolution = new DynamicResolution({ initial: 0.7 });
    const watch = new StrainWatch(6);
    let told = 0;
    for (let i = 0; i < 60 * 120; i++) {
      resolution.sample(VSYNC);
      if (watch.frame(VSYNC / 1000, resolution.scale <= resolution.min + 1e-6)) told++;
    }
    expect(told).toBe(0);
  });
});
