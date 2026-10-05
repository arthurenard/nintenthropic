import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceResult } from "../contract";
import { TRACKS } from "../track/tracks";
import { enterKonami, foundDuck, isUnlocked, loadUnlocks, wonCup } from "../unlocks";
import { CHARACTERS } from "../characters";
import { CUPS } from "../track/tracks";
import { KONAMI, KonamiDetector, PHOTO_GAP, duckTracks, konamiKey, padPresses, photoFinish, recordDuck, tricksFor, type KonamiKey } from "./eggs";

/** A localStorage that lives in the test. */
function storage(): void {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
}

beforeEach(storage);
afterEach(() => vi.unstubAllGlobals());

const press = (detector: KonamiDetector, keys: readonly (KonamiKey | null)[]): boolean[] => keys.map((key) => detector.press(key));

describe("the Konami code", () => {
  it("is up, up, down, down, left, right, left, right, B, A", () => {
    expect(KONAMI.join(" ")).toBe("up up down down left right left right b a");
    const done = press(new KonamiDetector(), KONAMI);
    expect(done.filter(Boolean)).toHaveLength(1);
    expect(done.at(-1)).toBe(true);
  });

  it("reads the keys by their codes, and nothing else", () => {
    expect(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"].map(konamiKey)).toEqual(["up", "down", "left", "right", "b", "a"]);
    expect(konamiKey("Space")).toBeNull();
    expect(konamiKey("KeyH")).toBeNull();
  });

  it("starts over on a wrong key, but a key that starts the code starts it", () => {
    const d = new KonamiDetector();
    // A slip in the middle: nothing.
    expect(press(d, ["up", "up", "down", "left", "down", "right", "left", "right", "b", "a"]).some(Boolean)).toBe(false);
    // Another key in the middle (Space, say) breaks it too.
    expect(press(d, ["up", "up", "down", "down", null, "left", "right", "left", "right", "b", "a"]).some(Boolean)).toBe(false);
    // An extra up at the start is fine: the code begins at the second.
    expect(press(d, ["up", "up", "up", "down", "down", "left", "right", "left", "right", "b", "a"]).at(-1)).toBe(true);
    // And it can be entered again.
    expect(press(d, KONAMI).at(-1)).toBe(true);
  });

  it("is entered on a gamepad by the d-pad and then B and A, once per press", () => {
    const pad = (...down: number[]) => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: down.includes(i), touched: false, value: down.includes(i) ? 1 : 0 })) });
    const was = new Set<KonamiKey>();
    const d = new KonamiDetector();
    // up(12) up down(13) down left(14) right(15) left right B(1) A(0): each pressed, then let go.
    const buttons = [12, 12, 13, 13, 14, 15, 14, 15, 1, 0];
    const results: boolean[] = [];
    for (const button of buttons) {
      for (const key of padPresses(pad(button), was)) results.push(d.press(key));
      // Held for a few looks: still one press.
      expect(padPresses(pad(button), was)).toEqual([]);
      padPresses(pad(), was);
    }
    expect(results).toHaveLength(10);
    expect(results.at(-1)).toBe(true);
    expect(results.slice(0, -1).some(Boolean)).toBe(false);
    expect(padPresses(null, was)).toEqual([]);
  });
});

describe("what the eggs unlock", () => {
  it("opens the golden kart and the secret track with the Konami code, the first time only", () => {
    const all = { duckTracks: duckTracks(), cups: CUPS.map((cup) => cup.id) };
    expect(isUnlocked("golden", loadUnlocks(), all)).toBe(false);
    expect(isUnlocked("secret-track", loadUnlocks(), all)).toBe(false);
    expect(enterKonami()).toBe(true);
    expect(enterKonami()).toBe(false);
    expect(isUnlocked("golden", loadUnlocks(), all)).toBe(true);
    expect(isUnlocked("secret-track", loadUnlocks(), all)).toBe(true);
    expect(isUnlocked("duck-driver", loadUnlocks(), all)).toBe(false);
  });

  it("opens the secret track by winning every cup too", () => {
    const all = { duckTracks: duckTracks(), cups: CUPS.map((cup) => cup.id) };
    for (const cup of all.cups.slice(0, -1)) expect(wonCup(cup)).toBe(true);
    expect(isUnlocked("secret-track", loadUnlocks(), all)).toBe(false);
    expect(wonCup(all.cups.at(-1)!)).toBe(true);
    expect(wonCup(all.cups.at(-1)!)).toBe(false);
    expect(isUnlocked("secret-track", loadUnlocks(), all)).toBe(true);
    expect(isUnlocked("golden", loadUnlocks(), all)).toBe(false);
  });

  it("opens Dabble when every duck is found, and not before", () => {
    const dabble = CHARACTERS.find((c) => c.species === "duck")!;
    expect(dabble.unlock).toBe("duck-driver");
    const all = { duckTracks: duckTracks(), cups: [] };
    for (const track of all.duckTracks.slice(0, -1)) {
      expect(foundDuck(track)).toBe(true);
      expect(isUnlocked("duck-driver", loadUnlocks(), all)).toBe(false);
    }
    expect(foundDuck(all.duckTracks[0]!)).toBe(false);
    expect(foundDuck(all.duckTracks.at(-1)!)).toBe(true);
    expect(isUnlocked("duck-driver", loadUnlocks(), all)).toBe(true);
  });

  it("is kept between visits, and survives a storage that cannot be read", () => {
    foundDuck("meadow-loop");
    enterKonami();
    expect(loadUnlocks()).toMatchObject({ ducks: ["meadow-loop"], konami: true });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    });
    expect(loadUnlocks()).toEqual({ ducks: [], cups: [], konami: false });
    expect(() => foundDuck("harbour-lights")).not.toThrow();
  });
});

describe("the duck found", () => {
  it("counts the ducks of every track, the secret one too", () => {
    expect(duckTracks()).toHaveLength(TRACKS.length);
    expect(duckTracks()).toHaveLength(9);
  });

  it("says how many are found, the first time on each track, and when it is all of them says Dabble joins", () => {
    const tracks = duckTracks();
    expect(recordDuck(tracks[0]!)).toBe("Duck found! 1 of 9");
    expect(recordDuck(tracks[0]!)).toBeNull();
    expect(recordDuck(tracks[1]!)).toBe("Duck found! 2 of 9");
    expect(recordDuck(tracks[2]!)).toBe("Duck found! 3 of 9");
    for (const track of tracks.slice(3, -1)) recordDuck(track);
    expect(recordDuck(tracks.at(-1)!)).toBe("You found every duck — Dabble joins the race!");
    expect(recordDuck(tracks.at(-1)!)).toBeNull();
  });
});

describe("the photo finish", () => {
  const standings = (...rows: [kart: number, time: number | null][]): RaceResult["standings"] =>
    rows.map(([kart, time], i) => ({ kart, place: i + 1, time, bestLap: null }));

  it("is two karts over the line within 0.15 s for a place in the top three", () => {
    expect(PHOTO_GAP).toBe(0.15);
    expect(photoFinish(standings([3, 61.2], [1, 61.3], [0, 65]))).toEqual({ ahead: 3, behind: 1, place: 1, gap: expect.closeTo(0.1, 6) });
    expect(photoFinish(standings([3, 61], [1, 63], [0, 63.14], [2, 70]))).toMatchObject({ ahead: 1, behind: 0, place: 2 });
    expect(photoFinish(standings([3, 61], [1, 63], [0, 70], [2, 70.1]))).toMatchObject({ ahead: 0, behind: 2, place: 3 });
  });

  it("is not a gap of more than 0.15 s, nor a fight for fourth or lower, nor a kart that did not finish", () => {
    expect(photoFinish(standings([3, 61], [1, 61.16], [0, 70]))).toBeNull();
    expect(photoFinish(standings([3, 61], [1, 64], [0, 67], [2, 70], [4, 70.05]))).toBeNull();
    expect(photoFinish(standings([3, 61], [1, null], [0, null]))).toBeNull();
    expect(photoFinish([])).toBeNull();
  });

  it("picks the closest when there are two", () => {
    expect(photoFinish(standings([3, 61], [1, 61.1], [0, 61.14]))).toMatchObject({ place: 2, behind: 0 });
  });
});

describe("the tricks", () => {
  it("are told by what the player drives with", () => {
    expect(tricksFor("wheel")).toEqual(["Clap to honk.", "Raise both hands to cheer.", "Wave hello."]);
    expect(tricksFor("keyboard")[0]).toMatch(/H/);
    expect(tricksFor("gamepad")[0]).toMatch(/Y/);
  });
});
