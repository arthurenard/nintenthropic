import { describe, expect, it } from "vitest";
import { bossWoundWord, chickenWord, innocentWord } from "./hints";

describe("innocentWord", () => {
  it("says who it was, calmly, in a short sentence", () => {
    expect(innocentWord("barber")).toBe("That was the barber.");
    for (const role of ["barber", "woman", "bartender", "undertaker", "preacher"] as const) {
      expect(innocentWord(role)).toMatch(/^That was (the|a) [a-z]+\.$/);
    }
  });

  it("counts the second, and from the third the town has noticed", () => {
    expect(innocentWord("barber", 1)).toBe("That was the barber.");
    expect(innocentWord("woman", 2)).toBe("That was a townswoman. That makes two.");
    expect(innocentWord("preacher", 3)).toBe("The town has noticed.");
    expect(innocentWord("bartender", 7)).toBe("The town has noticed.");
  });
});

describe("chickenWord", () => {
  it("reassures you twice; the third shot is the secret's to announce", () => {
    expect(chickenWord(1)).toBe("The chicken is fine.");
    expect(chickenWord(2)).toBe("The chicken is still fine.");
    expect(chickenWord(3)).toBeNull();
    expect(chickenWord(4)).toBeNull();
  });
});

describe("bossWoundWord", () => {
  it("makes light of Black Jack's first two wounds, and says nothing of the third", () => {
    expect(bossWoundWord(2)).toBe("Just a scratch.");
    expect(bossWoundWord(1)).toBe("Two scratches.");
    expect(bossWoundWord(0)).toBeNull();
    expect(bossWoundWord(3)).toBeNull();
  });
});
