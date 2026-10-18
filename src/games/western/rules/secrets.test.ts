import { describe, expect, it } from "vitest";
import { isHighNoon, SECRET_NAMES, SECRETS_TOTAL, SecretTracker } from "./secrets";

describe("secrets", () => {
  it("the bell: three tolls in a row open the church doors", () => {
    const s = new SecretTracker();
    s.shotAt("bell");
    expect(s.bell()).toMatchObject({ toll: 1, doorsOpen: false });
    s.shotAt("bell");
    expect(s.bell()).toMatchObject({ toll: 2, doorsOpen: false });
    s.shotAt("bell");
    expect(s.bell()).toMatchObject({ toll: 3, doorsOpen: true, newlyFound: true });
    expect(s.found.has("bell")).toBe(true);
  });

  it("the bell: any other shot breaks the run", () => {
    const s = new SecretTracker();
    s.shotAt("bell");
    s.bell();
    s.shotAt("bell");
    s.bell();
    s.shotAt(null);
    s.shotAt("bell");
    expect(s.bell()).toMatchObject({ toll: 1, doorsOpen: false });
    expect(s.found.has("bell")).toBe(false);
  });

  it("the weather vane, the water tower and the poster are found on the first hit", () => {
    const s = new SecretTracker();
    expect(s.vane()).toBe(true);
    expect(s.vane()).toBe(false);
    expect(s.waterTower()).toBe(true);
    expect(s.poster()).toBe(true);
    expect(s.count).toBe(3);
  });

  it("the chicken: three hits in one game make the Chicken of Steel", () => {
    const s = new SecretTracker();
    expect(s.chicken().newlyFound).toBe(false);
    expect(s.chicken().newlyFound).toBe(false);
    expect(s.chicken()).toEqual({ hits: 3, newlyFound: true });
    expect(s.chicken().newlyFound).toBe(false);
  });

  it("the piano: three notes play the tune", () => {
    const s = new SecretTracker();
    expect(s.piano().tune).toBe(false);
    expect(s.piano().tune).toBe(false);
    expect(s.piano()).toEqual({ notes: 3, tune: true, newlyFound: true });
  });

  it("tumbleweeds: the fifth earns a giant one, found when it rolls", () => {
    const s = new SecretTracker();
    for (let i = 0; i < 4; i++) expect(s.tumbleweed().giant).toBe(false);
    expect(s.tumbleweed().giant).toBe(true);
    expect(s.giantPending).toBe(true);
    expect(s.found.has("tumbleweeds")).toBe(false);
    expect(s.giantRolled()).toBe(true);
    expect(s.giantPending).toBe(false);
    expect(s.tumbleweed().giant).toBe(false);
  });

  it("names each of the eight, the ones you play for by what you did", () => {
    expect(Object.keys(SECRET_NAMES)).toHaveLength(SECRETS_TOTAL);
    expect(SECRET_NAMES).toMatchObject({ bell: "Three Tolls", vane: "Pointing at You", water_tower: "Spring a Leak", piano: "Honky-Tonk" });
  });

  it("high noon is 12:00 to 12:05 on the player's clock", () => {
    expect(isHighNoon(new Date(2026, 8, 26, 12, 0, 0))).toBe(true);
    expect(isHighNoon(new Date(2026, 8, 26, 12, 4, 59))).toBe(true);
    expect(isHighNoon(new Date(2026, 8, 26, 12, 5, 0))).toBe(false);
    expect(isHighNoon(new Date(2026, 8, 26, 11, 59, 59))).toBe(false);
    expect(isHighNoon(new Date(2026, 8, 26, 0, 2, 0))).toBe(false);
    const s = new SecretTracker();
    expect(s.highNoon()).toBe(true);
  });
});
