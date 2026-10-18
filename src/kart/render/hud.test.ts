import { describe, expect, it } from "vitest";
import { bannerFor } from "./hud";

describe("the banners under the item slot", () => {
  it("show one at a time: a skyrocket on its way, then the wrong way, then the final lap", () => {
    expect(bannerFor(false, false, false)).toBeNull();
    expect(bannerFor(false, false, true)).toBe("final");
    expect(bannerFor(false, true, true)).toBe("wrong");
    expect(bannerFor(true, true, true)).toBe("incoming");
    expect(bannerFor(true, false, true)).toBe("incoming");
  });
});
