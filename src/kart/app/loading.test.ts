import { describe, expect, it } from "vitest";
import { raceWords } from "./loading";

describe("what the loading screen says of the race", () => {
  it("names the track and its cup, and the laps, for a single race", () => {
    expect(raceWords({ track: "meadow-loop", laps: 3 }, null)).toEqual({ trackId: "meadow-loop", trackName: "Meadow Loop", eyebrow: "Acorn Cup · 3 laps" });
    expect(raceWords({ track: "starlight-ribbon", laps: 1 }, undefined).eyebrow).toBe("Comet Cup · 1 lap");
  });

  it("says which race of the cup a Grand Prix is on, and takes the track from the cup", () => {
    const words = raceWords({ track: "meadow-loop", laps: 3 }, { cup: "acorn", race: 1 });
    expect(words.trackId).toBe("kitchen-rally");
    expect(words.trackName).toBe("Kitchen Rally");
    expect(words.eyebrow).toBe("Acorn Cup · Race 2 of 4");
    expect(raceWords({ track: "meadow-loop", laps: 1 }, { cup: "comet", race: 3 }).eyebrow).toBe("Comet Cup · Race 4 of 4");
  });

  it("says so when the tracks are mirrored", () => {
    expect(raceWords({ track: "meadow-loop", laps: 2, mirror: true }, null).eyebrow).toBe("Acorn Cup · 2 laps · Mirror");
    expect(raceWords({ track: "meadow-loop", laps: 2, mirror: true }, { cup: "acorn", race: 0 }).eyebrow).toBe("Acorn Cup · Race 1 of 4 · Mirror");
  });

  it("calls the secret track the secret track: it is in no cup", () => {
    expect(raceWords({ track: "five-finger-circuit", laps: 3 }, null)).toEqual({
      trackId: "five-finger-circuit",
      trackName: "Five Finger Circuit",
      eyebrow: "Secret Track · 3 laps",
    });
  });
});
