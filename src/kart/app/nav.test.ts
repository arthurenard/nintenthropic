import { describe, expect, it } from "vitest";
import { moveIn, navKey, nearestBox, navPresses, type Box, type NavKey } from "./nav";

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
    // Start: the pause sheet.
    expect(navPresses(pad([9]), was)).toEqual(["menu"]);
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

describe("the d-pad over a screen", () => {
  const box = (x: number, y: number, width = 100, height = 44): Box => ({ x, y, width, height });

  it("walks a column of buttons in order, and stops at its ends", () => {
    const column = [box(0, 0), box(0, 60), box(0, 120)];
    expect(nearestBox(column[0]!, column, "down")).toBe(1);
    expect(nearestBox(column[1]!, column, "down")).toBe(2);
    expect(nearestBox(column[2]!, column, "down")).toBe(-1);
    expect(nearestBox(column[2]!, column, "up")).toBe(1);
  });

  it("goes along a row sideways, and never takes a neighbour in the row for one below", () => {
    const row = [box(0, 0), box(120, 0), box(240, 0)];
    expect(nearestBox(row[0]!, row, "right")).toBe(1);
    expect(nearestBox(row[2]!, row, "left")).toBe(1);
    expect(nearestBox(row[1]!, row, "down")).toBe(-1);
  });

  it("goes to what shares its column before what is nearer off to the side", () => {
    // From a wide button: a small one to the lower right is nearer than the one straight below, but not in its column.
    const from = box(0, 0, 400, 44);
    const below = box(0, 140, 400, 44);
    const aside = box(420, 50, 60, 44);
    expect(nearestBox(from, [aside, below], "down")).toBe(1);
    // A narrow field under a wide button is in its column: the start screen's code field, between Host and Practice.
    const field = box(10, 60, 250, 44);
    const join = box(270, 60, 120, 44);
    const practice = box(0, 120, 400, 44);
    expect(nearestBox(from, [practice, join, field], "down")).toBe(2);
    // With nothing in its column, the nearest off to the side.
    expect(nearestBox(box(0, 0), [box(300, 200), box(150, 100)], "down")).toBe(1);
  });
});
