import { describe, expect, it } from "vitest";
import { duckPass, SECRET_NAMES, SECRETS_TOTAL } from "./secrets";

describe("the secrets", () => {
  it("brings the duck by on the second pass, and back every sixth after for whoever missed it", () => {
    const passes = Array.from({ length: 20 }, (_, i) => i + 1).filter(duckPass);
    expect(passes).toEqual([2, 8, 14, 20]);
  });

  it("names all eight in the player's words, none in an engineer's", () => {
    expect(Object.keys(SECRET_NAMES)).toHaveLength(SECRETS_TOTAL);
    for (const name of Object.values(SECRET_NAMES)) expect(name).not.toMatch(/hello, world/i);
  });
});
