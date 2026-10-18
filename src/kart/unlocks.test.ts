import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mirrorTrack } from "./track/mirror";
import { MEADOW_LOOP, TRACKS } from "./track/tracks";
import { foundDuck, isUnlocked, loadUnlocks } from "./unlocks";

/** A localStorage that lives in the test. */
let items = new Map<string, string>();
beforeEach(() => {
  items = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const duckTracks = TRACKS.filter((track) => track.duck).map((track) => track.id);

describe("a duck found in Mirror Mode", () => {
  it("is its track's duck: it counts toward Dabble, once", () => {
    const mirrored = mirrorTrack(MEADOW_LOOP).id;
    expect(mirrored).not.toBe(MEADOW_LOOP.id);
    expect(foundDuck(mirrored)).toBe(true);
    expect(loadUnlocks().ducks).toEqual([MEADOW_LOOP.id]);
    // The same duck on the track the right way round is not a second find.
    expect(foundDuck(MEADOW_LOOP.id)).toBe(false);
    expect(foundDuck(mirrored)).toBe(false);
    // Every other duck, some in the mirror: Dabble joins.
    for (const [i, id] of duckTracks.entries()) foundDuck(i % 2 ? mirrorTrack(TRACKS.find((t) => t.id === id)!).id : id);
    expect(isUnlocked("duck-driver", loadUnlocks(), { duckTracks, cups: [] })).toBe(true);
  });

  it("kept under the mirror's id before it counted, counts now", () => {
    items.set("grip-prix.unlocks", JSON.stringify({ ducks: ["meadow-loop-mirror", "kitchen-rally", "kitchen-rally-mirror"], cups: [], konami: false }));
    expect(loadUnlocks().ducks).toEqual(["meadow-loop", "kitchen-rally"]);
  });
});
