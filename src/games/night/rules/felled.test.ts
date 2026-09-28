import { describe, expect, it } from "vitest";
import { felledNote, takenBy, wayOf, type Felled } from "./felled";
import type { DeadKind, LaneId } from "./types";

const f = (kind: DeadKind, lane: LaneId = "road", pressure = 0, maskHits = 2): Felled => ({ kind, lane, burst: kind === "bloater", pressure, maskHits });

describe("what took you", () => {
  it("says it as the design words it", () => {
    expect(felledNote(f("walker"))).toBe("A walker at the barricade. Aim for the head — three body shots take too long.");
    expect(felledNote(f("runner", "corn"))).toBe("A runner out of the corn. Runners come fast; a headshot stops them dead.");
    expect(felledNote(f("bloater"))).toBe("The bloater. Shoot it before it reaches you.");
  });

  it("names the way a runner came", () => {
    const ways: [LaneId, string][] = [
      ["road", "up the road"],
      ["corn", "out of the corn"],
      ["trees", "from the tree line"],
      ["bus", "out of the bus"],
      ["booth", "from behind the phone booth"],
      ["fence", "over the fence"],
    ];
    for (const [lane, words] of ways) {
      expect(wayOf(lane)).toBe(words);
      expect(takenBy(f("runner", lane))).toBe(`a runner ${words}`);
    }
  });

  it("has a word for the crawler and the Mechanic, and the Mechanic's mask on each difficulty", () => {
    expect(felledNote(f("crawler"))).toBe("A crawler at the barricade. Watch the road. Some of them crawl.");
    expect(felledNote(f("mechanic"))).toBe("The Mechanic. Two shots knock his mask off, then one to the head.");
    expect(felledNote(f("mechanic", "road", 0, 1))).toBe("The Mechanic. Knock his mask off, then one to the head.");
  });

  it("blames the fog late in a long wave", () => {
    expect(felledNote(f("walker", "road", 0.6))).toBe("The fog gets thicker the longer a wave goes. Keep the road clear.");
    expect(felledNote(f("walker", "road", 0.4))).toContain("A walker at the barricade.");
  });
});
