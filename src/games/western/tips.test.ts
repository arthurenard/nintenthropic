import { describe, expect, it } from "vitest";
import { ALL_TIPS, HintLine, TIP_GAP, TIP_SECONDS, tipText, type TipId } from "./tips";

const DT = 1 / 60;

function run(line: HintLine, seconds: number): (string | null)[] {
  const shown: (string | null)[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    line.update(DT);
    shown.push(line.text);
  }
  return shown;
}

/** Each distinct stretch of text, in order, with how long it showed. */
function stretches(shown: (string | null)[]): { text: string | null; seconds: number }[] {
  const out: { text: string | null; seconds: number }[] = [];
  for (const t of shown) {
    const last = out[out.length - 1];
    if (last && last.text === t) last.seconds += DT;
    else out.push({ text: t, seconds: DT });
  }
  return out;
}

function playing(seen: Set<string> = new Set()): HintLine {
  const line = new HintLine(seen);
  line.setQuiet(false);
  return line;
}

const offer = (line: HintLine, id: TipId) => line.offer(id, tipText(id, "hand"));

describe("one-time tips", () => {
  it("shows a tip once, for about four seconds, and never again", () => {
    const seen = new Set<string>();
    const line = playing(seen);
    offer(line, "western.glint");
    const shown = stretches(run(line, 6));
    expect(shown[0]?.text).toBe("A glint means he’s about to fire.");
    expect(shown[0]?.seconds).toBeCloseTo(TIP_SECONDS, 1);
    expect(shown[1]?.text).toBeNull();
    expect(seen.has("western.glint")).toBe(true);
    // The next glint, this game or the next: nothing.
    offer(line, "western.glint");
    expect(run(line, 5).every((t) => t === null)).toBe(true);
    const nextGame = playing(seen);
    offer(nextGame, "western.glint");
    expect(run(nextGame, 5).every((t) => t === null)).toBe(true);
  });

  it("queues tips whose moments come together, one at a time, with a breath between", () => {
    const line = playing();
    offer(line, "western.townsfolk");
    offer(line, "western.dynamite");
    offer(line, "western.townsfolk"); // the second townsperson: already waiting
    const shown = stretches(run(line, 12));
    expect(shown.map((s) => s.text)).toEqual([
      "Hold your fire. Townsfolk aren’t with the gang.",
      null,
      "Shoot the dynamite before it lands.",
      null,
    ]);
    expect(shown[1]?.seconds).toBeCloseTo(TIP_GAP, 1);
    expect(shown[2]?.seconds).toBeCloseTo(TIP_SECONDS, 1);
  });

  it("never shows during the aim check, and lets go of what was waiting", () => {
    const seen = new Set<string>();
    const line = new HintLine(seen); // quiet until play begins
    offer(line, "western.glint");
    expect(run(line, 5).every((t) => t === null)).toBe(true);
    expect(seen.size).toBe(0);
    // Waiting when the player falls: let go unshown, and offered again next time.
    line.setQuiet(false);
    offer(line, "western.townsfolk");
    offer(line, "western.dynamite");
    run(line, 1);
    line.setQuiet(true);
    expect(line.text).toBeNull();
    expect(seen.has("western.townsfolk")).toBe(true);
    expect(seen.has("western.dynamite")).toBe(false);
  });

  it("never replaces the reload hint while it is needed, and finishes after it", () => {
    const line = playing();
    offer(line, "western.glint");
    run(line, 1);
    line.setNeed("Point off the screen to reload.");
    offer(line, "western.dynamite");
    const during = run(line, 6);
    expect(during.every((t) => t === "Point off the screen to reload.")).toBe(true);
    line.setNeed(null);
    const after = stretches(run(line, 10)).map((s) => s.text);
    expect(after).toEqual(["A glint means he’s about to fire.", null, "Shoot the dynamite before it lands.", null]);
  });

  it("lets a brief word through over a tip, which then finishes", () => {
    const line = playing();
    offer(line, "western.townsfolk");
    run(line, 1);
    line.say("That was the barber.", 2);
    const shown = stretches(run(line, 8));
    expect(shown[0]).toMatchObject({ text: "That was the barber." });
    expect(shown[0]?.seconds).toBeCloseTo(2, 1);
    expect(shown[1]?.text).toBe("Hold your fire. Townsfolk aren’t with the gang.");
    expect(shown[1]?.seconds).toBeCloseTo(TIP_SECONDS - 1, 1);
  });

  it("keeps showing the reload tip at the start until the player reloads by themselves", () => {
    const seen = new Set<string>();
    for (let game = 0; game < 3; game++) {
      const line = playing(seen);
      offer(line, "western.reload");
      expect(stretches(run(line, 5))[0]?.text).toBe("Point off the screen to reload.");
      line.setQuiet(true);
    }
    expect(seen.has("western.reload")).toBe(false);
    // This game the player reloads mid-tip: it goes at once, and for good.
    const line = playing(seen);
    offer(line, "western.reload");
    run(line, 1);
    line.learned("western.reload");
    expect(line.text).toBeNull();
    expect(seen.has("western.reload")).toBe(true);
    const next = playing(seen);
    offer(next, "western.reload");
    expect(run(next, 5).every((t) => t === null)).toBe(true);
  });

  it("speaks to each way of playing about the reload", () => {
    expect(tipText("western.reload", "mouse")).toBe("Right-click or press R to reload.");
    expect(tipText("western.reload", undefined)).toBe("Point off the screen to reload.");
    for (const id of ALL_TIPS) expect(tipText(id, "hand").length).toBeLessThan(60);
  });
});
