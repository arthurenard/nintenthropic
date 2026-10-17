import { describe, expect, it } from "vitest";
import { Progress } from "./fetch";
import { guessTier, isSoftwareGpu } from "./tier";

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
    expect(guessTier("NVIDIA GeForce RTX 3060", 4)).toBe("medium");
  });

  it("puts the small discrete GPUs of laptops a step down, and a laptop Adreno with the laptops", () => {
    expect(guessTier("ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11)")).toBe("medium");
    expect(guessTier("ANGLE (NVIDIA, NVIDIA GeForce GT 730 Direct3D11)")).toBe("medium");
    expect(guessTier("ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11)")).toBe("high");
    expect(guessTier("ANGLE (Qualcomm, Adreno (TM) 740)")).toBe("low");
    expect(guessTier("ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU)")).toBe("medium");
  });
});

describe("a GPU drawn in software", () => {
  it("is told from a real one (the hand tracker then reads on the CPU)", () => {
    expect(isSoftwareGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareGpu("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareGpu("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)")).toBe(true);
    expect(isSoftwareGpu("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)")).toBe(false);
  });
});

describe("the tier of a game that draws four views", () => {
  const split = { splitScreen: true };
  const m = (chip: string) => `ANGLE (Apple, ANGLE Metal Renderer: Apple ${chip}, Unspecified Version)`;

  it("starts a base Apple chip at medium, and a Pro, Max or Ultra at high", () => {
    for (const chip of ["M1", "M2", "M3", "M4"]) expect(guessTier(m(chip), 8, split)).toBe("medium");
    for (const chip of ["M1 Pro", "M2 Max", "M3 Ultra", "M4 Max", "M4 Pro"]) expect(guessTier(m(chip), 12, split)).toBe("high");
  });

  it("starts Safari and an iPad (which say 'Apple GPU') at medium, unless the cores say a Pro or a Max", () => {
    expect(guessTier("Apple GPU", 8, split)).toBe("medium");
    expect(guessTier("Apple GPU", 10, split)).toBe("medium");
    expect(guessTier("Apple GPU", 16, split)).toBe("high");
  });

  it("leaves a game with one view as it was", () => {
    expect(guessTier(m("M1"), 8)).toBe("high");
    expect(guessTier("Apple GPU", 16)).toBe("medium");
  });

  it("starts old Intel graphics at low and a modern one at medium", () => {
    expect(guessTier("ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11)", 4, split)).toBe("low");
    expect(guessTier("ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine)", 8, split)).toBe("low");
    expect(guessTier("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)", 8, split)).toBe("medium");
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
