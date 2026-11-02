import { describe, expect, it } from "vitest";
import { EDGE_AFTER, EDGE_KEEP, EdgeHint } from "./edgeHint";

describe("the note for hands near the edge", () => {
  it("comes once the hands have been near the edge a moment, not for a fist swung out and back", () => {
    const hint = new EdgeHint();
    expect(hint.update("left", 0)).toBeNull();
    expect(hint.update(null, EDGE_AFTER - 50)).toBeNull();
    expect(hint.update("left", 1000)).toBeNull();
    expect(hint.update("left", 1000 + EDGE_AFTER)).toBe("left");
  });

  it("stays a little after the hands are back in, so it does not flicker", () => {
    const hint = new EdgeHint();
    hint.update("right", 0);
    hint.update("right", EDGE_AFTER);
    expect(hint.update(null, 400)).toBe("right");
    expect(hint.update("right", 500)).toBe("right");
    expect(hint.update(null, 600)).toBe("right");
    expect(hint.update(null, 600 + EDGE_KEEP)).toBeNull();
  });

  it("turns to a new way once that one has held", () => {
    const hint = new EdgeHint();
    hint.update("left", 0);
    hint.update("left", EDGE_AFTER);
    expect(hint.update("down", 300)).toBe("left");
    expect(hint.update("down", 300 + EDGE_AFTER)).toBe("down");
    hint.reset();
    expect(hint.shown).toBeNull();
  });
});
