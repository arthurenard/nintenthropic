import { describe, expect, it } from "vitest";
import { fitPicture } from "./preview";

describe("which part of the camera's picture fills a canvas", () => {
  it("is the whole picture, a half, or a column, filling the canvas", () => {
    const whole = fitPicture(1600, 900, 16 / 9);
    expect(whole.dest).toMatchObject({ x: 0, y: 0, width: 1600, height: 900 });
    // A half of a 16:9 picture is 8:9; in a canvas of that shape it fits exactly.
    const half = fitPicture(800, 900, 16 / 9, "right");
    expect(half.dest.width).toBeCloseTo(800, 5);
    expect(half.point(0.5, 0)[0]).toBeCloseTo(0, 5);
    expect(half.point(1, 1)[0]).toBeCloseTo(800, 5);
    // The right half of the mirrored picture is the left half of the camera's own.
    expect(half.source(1920, 1080)).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    // And the left half is the left of the mirrored picture: the camera's own right half.
    const left = fitPicture(800, 900, 16 / 9, "left");
    expect(left.point(0, 0)[0]).toBeCloseTo(0, 5);
    expect(left.point(0.25, 0.5)[0]).toBeCloseTo(400, 5);
    expect(left.point(0.5, 0)[0]).toBeCloseTo(800, 5);
    expect(left.source(1920, 1080)).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it("puts a player's column where their hands are drawn, for any of up to four", () => {
    for (let index = 0; index < 4; index++) {
      const column = fitPicture(400, 900, 16 / 9, { index, of: 4 });
      expect(column.point(index / 4, 0)[0]).toBeCloseTo(0, 5);
      expect(column.point((index + 1) / 4, 0)[0]).toBeCloseTo(column.dest.width, 5);
      const from = column.source(1920, 1080);
      expect(from.width).toBeCloseTo(480, 5);
      // Mirrored: the leftmost column the player sees is the camera's own rightmost.
      expect(from.x).toBeCloseTo(1920 - (index + 1) * 480, 5);
    }
  });
});
