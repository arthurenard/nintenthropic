import { describe, expect, it } from "vitest";
import { formatScore, formatTime, shareFileName, titleCase } from "./format";

describe("formatting", () => {
  it("groups a score's thousands", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(1240)).toBe("1,240");
    expect(formatScore(1234567.4)).toBe("1,234,567");
    expect(formatScore(Number.NaN)).toBe("0");
  });

  it("reads a time as minutes and seconds", () => {
    expect(formatTime(48)).toBe("0:48");
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(0.2)).toBe("0:01");
    expect(formatTime(-3)).toBe("0:00");
  });

  it("writes titles in Title Case", () => {
    expect(titleCase("DEAD OF NIGHT")).toBe("Dead of Night");
    expect(titleCase("choose a game")).toBe("Choose a Game");
    expect(titleCase("the bell")).toBe("The Bell");
  });

  it("names a share card after its game", () => {
    expect(shareFileName("High Noon")).toBe("nintenthropic-high-noon.png");
    expect(shareFileName("Dead of Night!")).toBe("nintenthropic-dead-of-night.png");
  });
});
