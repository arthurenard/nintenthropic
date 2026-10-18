import { describe, expect, it } from "vitest";
import { GpuWatch } from "./gpu";

/** An OffscreenCanvas holding the one context MediaPipe made on it (or none). */
class FakeCanvas {
  made: "webgl2" | "webgl" | null = "webgl2";
  lost = false;
  asked: string[] = [];
  getContext(type: string): { isContextLost(): boolean } | null {
    this.asked.push(type);
    return type === this.made ? { isContextLost: () => this.lost } : null;
  }
}

describe("a landmarker whose GPU has gone", () => {
  const watchWith = (canvas: FakeCanvas) => new GpuWatch(() => canvas as unknown as OffscreenCanvas);

  it("is given a canvas of its own on the GPU, and none on the CPU", () => {
    const canvas = new FakeCanvas();
    const gpu = watchWith(canvas);
    expect(gpu.canvasFor("GPU")).toBe(canvas);
    expect(gpu.canvasFor("CPU")).toBeUndefined();
  });

  it("is told by the context MediaPipe made on its canvas, WebGL 2 or 1", () => {
    for (const made of ["webgl2", "webgl"] as const) {
      const canvas = new FakeCanvas();
      canvas.made = made;
      const gpu = watchWith(canvas);
      const task = gpu.watch({}, gpu.canvasFor("GPU"));
      expect(gpu.lost(task)).toBe(false);
      canvas.lost = true;
      expect(gpu.lost(task), made).toBe(true);
    }
  });

  it("is never one on the CPU, or one not watched", () => {
    const canvas = new FakeCanvas();
    const gpu = watchWith(canvas);
    const cpu = gpu.watch({}, undefined);
    canvas.lost = true;
    expect(gpu.lost(cpu)).toBe(false);
    expect(gpu.lost({})).toBe(false);
    expect(gpu.lost(null)).toBe(false);
    // Nothing on the CPU was asked for a context it does not have (asking would make one).
    expect(canvas.asked).toEqual([]);
  });
});
