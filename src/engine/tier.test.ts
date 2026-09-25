import { describe, expect, it } from "vitest";
import { Progress } from "./fetch";
import { guessTier } from "./tier";

describe("the GPU tier guess", () => {
  it("reads the common names", () => {
    expect(guessTier("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)")).toBe("high");
    expect(guessTier("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)")).toBe("high");
    expect(guessTier("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)")).toBe("medium");
    expect(guessTier("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)")).toBe("low");
    expect(guessTier("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("low");
    expect(guessTier("Mali-G78")).toBe("low");
    expect(guessTier("")).toBe("medium");
  });

  it("does not trust a big GPU in a small machine", () => {
    expect(guessTier("NVIDIA GeForce GTX 1050", 2)).toBe("medium");
  });
});

describe("combined progress", () => {
  it("fills once, weighted by each part's share of the wait", () => {
    const seen: number[] = [];
    const progress = new Progress((fraction) => seen.push(fraction));
    const wasm = progress.part("wasm", 12);
    const model = progress.part("model", 8);
    wasm(0.5);
    expect(progress.fraction).toBeCloseTo(0.3, 9);
    wasm(1);
    model(1);
    expect(progress.fraction).toBe(1);
    wasm(0.2); // a part never goes backwards
    expect(progress.fraction).toBe(1);
    expect(seen.every((value, i) => i === 0 || value >= seen[i - 1]!)).toBe(true);
  });
});
