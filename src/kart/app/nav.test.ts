import { describe, expect, it } from "vitest";
import { moveIn, navKey, navPresses, type NavKey } from "./nav";

const pad = (pressed: number[] = [], axes: number[] = [0, 0]) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: 0 })),
  axes,
});

describe("moving about a menu with a pad", () => {
  it("reads the d-pad, A and B, once for each press", () => {
    const was = new Set<NavKey>();
    expect(navPresses(pad([15]), was)).toEqual(["right"]);
    // Held: nothing new.
    expect(navPresses(pad([15]), was)).toEqual([]);
    expect(navPresses(pad([]), was)).toEqual([]);
    expect(navPresses(pad([0, 14]), was).sort()).toEqual(["confirm", "left"]);
    expect(navPresses(pad([1]), was)).toEqual(["back"]);
  });

  it("reads the left stick once it leans far enough", () => {
    const was = new Set<NavKey>();
    expect(navPresses(pad([], [0.4, 0]), was)).toEqual([]);
    expect(navPresses(pad([], [0.8, 0]), was)).toEqual(["right"]);
    expect(navPresses(pad([], [0.9, 0]), was)).toEqual([]);
    expect(navPresses(pad([], [0, 0]), was)).toEqual([]);
    expect(navPresses(pad([], [-0.7, 0.2]), was)).toEqual(["left"]);
    expect(navPresses(pad([], [0, 0.95]), was)).toEqual(["down"]);
  });

  it("is quiet with no pad", () => {
    expect(navPresses(null, new Set())).toEqual([]);
  });
});

describe("keys and grids", () => {
  it("know the arrows and Return", () => {
    expect(navKey({ key: "ArrowLeft" })).toBe("left");
    expect(navKey({ key: "Enter" })).toBe("confirm");
    expect(navKey({ key: "a" })).toBeNull();
  });

  it("move along a grid and stop at its edges", () => {
    // Nine in a 5-wide grid: 0..4 above, 5..8 below.
    expect(moveIn(0, "right", 9, 5)).toBe(1);
    expect(moveIn(4, "right", 9, 5)).toBe(4);
    expect(moveIn(5, "left", 9, 5)).toBe(5);
    expect(moveIn(2, "down", 9, 5)).toBe(7);
    expect(moveIn(4, "down", 9, 5)).toBe(4);
    expect(moveIn(7, "up", 9, 5)).toBe(2);
    expect(moveIn(1, "up", 9, 5)).toBe(1);
    expect(moveIn(3, "confirm", 9, 5)).toBe(3);
  });
});
