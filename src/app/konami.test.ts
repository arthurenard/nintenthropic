import { describe, expect, it } from "vitest";
import { KONAMI, endsWithKonami } from "./konami";

describe("the Konami code", () => {
  it("is recognised at the end of whatever was typed before", () => {
    expect(endsWithKonami(KONAMI)).toBe(true);
    expect(endsWithKonami(["x", "ArrowUp", ...KONAMI])).toBe(true); // a third up first
    expect(endsWithKonami(KONAMI.slice(0, -1))).toBe(false);
    expect(endsWithKonami([...KONAMI.slice(0, -1), "b"])).toBe(false);
  });
});
