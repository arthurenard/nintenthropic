import { describe, expect, it } from "vitest";
import { breachCause, breachNote, paneName, type Breach } from "./felled";

const base: Breach = { kind: "chunk", pieceOf: null, pane: 1, earlier: 0, cost: 20, droneShot: false, pass: 4 };

describe("what broke the glass", () => {
  it("names the pane as a player would", () => {
    expect(paneName(0)).toBe("the centre pane");
    expect(paneName(1)).toBe("the upper-left pane");
    expect(paneName(6)).toBe("the left pane");
  });

  it("says a chunk, and to clear its pieces", () => {
    expect(breachNote(base)).toBe("A chunk on the upper-left pane. Chunks split into pieces: clear the pieces before they arrive.");
    expect(breachNote({ ...base, kind: "shrapnel", pieceOf: "chunk" })).toBe(
      "Pieces of a chunk on the upper-left pane. Chunks split into pieces: clear the pieces before they arrive.",
    );
  });

  it("says the Derelict, and where to hit it", () => {
    expect(breachNote({ ...base, kind: "derelict", cost: 100 })).toBe("The Derelict. Its fuel tank shows as it tumbles; three hits break it up.");
  });

  it("says a pane worn down over time, and to keep the drone working if it was shot", () => {
    const worn: Breach = { ...base, kind: "shrapnel", earlier: 6, cost: 9 };
    expect(breachNote({ ...worn, droneShot: true })).toBe("A pane worn down over time. Keep the drone working: don’t shoot it.");
    expect(breachCause(worn)).toBe("A pane worn down over time.");
  });

  it("matches each kind to its advice", () => {
    expect(breachNote({ ...base, kind: "shard", pane: 6 })).toBe("A solar panel shard on the left pane. Shards turn: shoot them face-on.");
    expect(breachNote({ ...base, kind: "foil", pane: 5 })).toMatch(/^A foil-wrapped piece on the lower-left pane\. The first hit strips the foil/);
    expect(breachNote({ ...base, kind: "slab", pane: 0 })).toMatch(/^A slab on the centre pane\. Split slabs far out/);
    expect(breachNote({ ...base, kind: "shrapnel", pane: 3 })).toMatch(/^Shrapnel on the right pane\./);
  });
});
