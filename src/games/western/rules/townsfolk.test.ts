import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../engine/rules/rng";
import { roleForCover, Townsperson, type TownsfolkEvents } from "./townsfolk";
import type { Cover } from "./types";

const door: Cover = {
  id: "barber.door",
  kind: "door",
  emerge: "step_out",
  level: 0,
  exposed: { x: -9.1, y: 0.4, z: -34.1 },
  ready: { x: -10.0, y: 0.4, z: -34.1 },
  hidden: { x: -10.3, y: 0.4, z: -33.2 },
  distance: 35.3,
  side: -1,
  tags: [],
};

const quiet: TownsfolkEvents = { townsfolkAppear() {}, townsfolkHide() {}, townsfolkGone() {} };

describe("townsfolk", () => {
  it("come to the door from its threshold, not through the wall where they waited", () => {
    const p = Townsperson.create(1, "barber", door, mulberry32(2));
    const xs: number[] = [];
    for (let i = 0; i < 600 && p.state !== "out"; i++) {
      p.step(1 / 60, quiet);
      if (p.visible) xs.push(p.pos.x);
    }
    expect(xs.length).toBeGreaterThan(5);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-10.0 - 1e-9);
    expect(p.pos.x).toBeCloseTo(-9.1);
    // And back inside, out of sight, when they go.
    for (let i = 0; i < 1200 && p.state !== "gone"; i++) p.step(1 / 60, quiet);
    expect(p.visible).toBe(false);
    expect(p.pos).toEqual(door.hidden);
  });

  it("are who lives there: the barber at the barber's, a woman at the hotel", () => {
    const r = mulberry32(1);
    expect(roleForCover(door, r)).toBe("barber");
    expect(roleForCover({ ...door, id: "hotel.window_up_2" }, r)).toBe("woman");
    expect(roleForCover({ ...door, id: "saloon.door" }, r)).toBe("bartender");
    expect(roleForCover({ ...door, id: "undertaker.door" }, r)).toBe("undertaker");
  });
});
