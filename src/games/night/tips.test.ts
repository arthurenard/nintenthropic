import { describe, expect, it } from "vitest";
import { ALL_TIPS, HintLine, reloadHint, survivorWord, TIP_SECONDS, tipText, type TipId } from "./tips";

const DT = 1 / 60;

function run(line: HintLine, seconds: number): (string | null)[] {
  const shown: (string | null)[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    line.update(DT);
    shown.push(line.text);
  }
  return shown;
}

function playing(seen: Set<string> = new Set()): HintLine {
  const line = new HintLine(seen);
  line.setQuiet(false);
  return line;
}

const offer = (line: HintLine, id: TipId) => line.offer(id, tipText(id, "hand"));

describe("the night's one-time tips", () => {
  it("are the design's five, each prefixed with the game's name", () => {
    expect([...ALL_TIPS].sort()).toEqual(["night.bloater", "night.crawler", "night.eyes", "night.head", "night.reload"]);
  });

  it("say what the design says", () => {
    expect(tipText("night.head", "hand")).toBe("Aim for the head. Body shots only slow them down.");
    expect(tipText("night.eyes", "hand")).toBe("Eyes in the fog. Light them up.");
    expect(tipText("night.bloater", "hand")).toBe("Shoot the bloater before it reaches you.");
    expect(tipText("night.crawler", "hand")).toBe("Watch the road. Some of them crawl.");
  });

  it("say how to reload in the player's own terms", () => {
    expect(tipText("night.reload", "hand")).toBe("Point off the screen to reload.");
    expect(reloadHint("mouse")).toBe("Right-click or press R to reload.");
    expect(reloadHint("touch")).toBe("Tap with two fingers to reload.");
  });

  it("show a tip once, for about four seconds, and never again", () => {
    const seen = new Set<string>();
    const line = playing(seen);
    offer(line, "night.eyes");
    const shown = run(line, 6);
    expect(shown.filter((t) => t === "Eyes in the fog. Light them up.").length * DT).toBeCloseTo(TIP_SECONDS, 1);
    expect(seen.has("night.eyes")).toBe(true);
    const next = playing(seen);
    offer(next, "night.eyes");
    expect(run(next, 5).every((t) => t === null)).toBe(true);
  });

  it("keep the reload's tip until the player has reloaded by themselves", () => {
    const seen = new Set<string>();
    const line = playing(seen);
    offer(line, "night.reload");
    run(line, 6);
    expect(seen.has("night.reload")).toBe(false);
    line.learned("night.reload");
    expect(seen.has("night.reload")).toBe(true);
  });

  it("name the survivor shot, calmly", () => {
    expect(survivorWord("daughter")).toBe("That was Miller’s daughter.");
    expect(survivorWord("owner")).toBe("That was the motel owner.");
  });
});
