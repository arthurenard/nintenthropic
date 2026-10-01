import { describe, expect, it } from "vitest";
import { HintLine, TIP_GAP, TIP_SECONDS } from "./hints";

function playing(seen: Set<string> = new Set()): HintLine {
  const line = new HintLine(seen);
  line.setQuiet(false);
  return line;
}

describe("the hint line's standing line", () => {
  it("shows when nothing else does, and stays as long as it is not taken away", () => {
    const line = playing();
    expect(line.text).toBeNull();
    line.setStanding("Close one eye to look through the scope. Or hold Shift.");
    expect(line.text).toBe("Close one eye to look through the scope. Or hold Shift.");
    line.update(120);
    expect(line.text).toBe("Close one eye to look through the scope. Or hold Shift.");
    line.setStanding(null);
    expect(line.text).toBeNull();
  });

  it("gives way to a need, a word and a tip, and comes back after them", () => {
    const line = playing();
    line.setStanding("standing");
    line.setNeed("Point off the screen to reload.");
    expect(line.text).toBe("Point off the screen to reload.");
    line.setNeed(null);
    line.say("That was the farmer.", 2);
    expect(line.text).toBe("That was the farmer.");
    line.update(2.1);
    expect(line.text).toBe("standing");
    line.offer("ridge.bolt", "Raise your thumb to work the bolt.");
    line.update(TIP_GAP + 0.1);
    expect(line.text).toBe("Raise your thumb to work the bolt.");
    line.update(TIP_SECONDS + 0.1);
    expect(line.text).toBe("standing");
  });

  it("is let go when the line goes quiet (the aim check, the fall, the results)", () => {
    const line = playing();
    line.setStanding("standing");
    line.setQuiet(true);
    expect(line.text).toBeNull();
    // Quiet takes no standing line either; play says it again when it begins.
    line.setStanding("standing");
    expect(line.text).toBeNull();
    line.setQuiet(false);
    line.setStanding("standing");
    expect(line.text).toBe("standing");
  });
});
