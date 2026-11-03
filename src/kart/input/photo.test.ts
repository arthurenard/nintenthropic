import { describe, expect, it } from "vitest";
import { PHOTO_ASPECT, PHOTO_PIXELS, PHOTO_SIDE, photoCrop, photoSize } from "./photo";

describe("which part of the camera's picture is a player's photo", () => {
  it("is the whole picture for one player on a 16:9 or a 4:3 camera", () => {
    expect(photoCrop(1280, 720, null)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(photoCrop(640, 480, null)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });

  it("is a player's own column when two share the camera, mirrored as they see it", () => {
    // The left of the mirrored picture is the camera's own right half.
    expect(photoCrop(1280, 720, { index: 0, of: 2 })).toEqual({ x: 640, y: 0, width: 640, height: 720 });
    expect(photoCrop(1280, 720, { index: 1, of: 2 })).toEqual({ x: 0, y: 0, width: 640, height: 720 });
  });

  it("cuts a crowd's narrow column to 3:4 round the player's hands, their face above them", () => {
    for (let index = 0; index < 4; index++) {
      const seat = { index, of: 4 };
      // Hands held at 60% of the way down, in this player's quarter.
      const hands = [
        { x: (index + 0.3) / 4, y: 0.6 },
        { x: (index + 0.7) / 4, y: 0.6 },
      ];
      const crop = photoCrop(1920, 1080, seat, hands);
      expect(crop.width).toBe(480);
      expect(crop.width / crop.height).toBeCloseTo(PHOTO_ASPECT.min, 2);
      // Mirrored: the leftmost column the players see is the camera's rightmost.
      expect(crop.x).toBe(1920 - (index + 1) * 480);
      // The hands sit below the middle of the photo, with room above them for a face.
      const handsDown = (0.6 * 1080 - crop.y) / crop.height;
      expect(handsDown).toBeCloseTo(0.62, 2);
    }
    // No hands seen: from a little above the middle, where heads are.
    const blind = photoCrop(1920, 1080, { index: 2, of: 4 });
    expect(blind.y).toBeGreaterThan(0);
    expect(blind.y + blind.height / 2).toBeLessThan(540);
  });

  it("never reaches past the picture, however far the hands are to a side", () => {
    const high = photoCrop(1920, 1080, { index: 1, of: 3 }, [{ x: 0.5, y: 0.05 }]);
    expect(high.y).toBe(0);
    const low = photoCrop(1920, 1080, { index: 1, of: 3 }, [{ x: 0.5, y: 0.99 }]);
    expect(low.y + low.height).toBeLessThanOrEqual(1080);
    // An ultra-wide camera is cut to 16:9 round the hands, inside the picture.
    const wide = photoCrop(2560, 1080, null, [{ x: 0.95, y: 0.5 }]);
    expect(wide.width / wide.height).toBeCloseTo(PHOTO_ASPECT.max, 2);
    expect(wide.x).toBe(0);
    const middle = photoCrop(2560, 1080, null);
    expect(middle.x).toBe(Math.round((2560 - middle.width) / 2));
  });
});

describe("how big a photo is", () => {
  it("keeps the crop's shape, small enough to send, never larger than the crop", () => {
    expect(photoSize({ width: 1280, height: 720 })).toEqual({ width: 480, height: 270 });
    for (const crop of [
      { width: 640, height: 720 },
      { width: 480, height: 640 },
      { width: 1920, height: 1080 },
      { width: 300, height: 200 },
    ]) {
      const size = photoSize(crop);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(PHOTO_SIDE);
      expect(size.width * size.height).toBeLessThanOrEqual(PHOTO_PIXELS * 1.01);
      expect(size.width / size.height).toBeCloseTo(crop.width / crop.height, 1);
      expect(size.width).toBeLessThanOrEqual(crop.width);
    }
    expect(photoSize({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
  });
});
