import { describe, expect, it } from "vitest";
import type { Game, GameEntry } from "../engine/types";
import { backdropCss } from "../ui/backdrop";
import { initialGame, step } from "./arcade";

const game = (id: string, open = true): GameEntry => ({
  id,
  title: id,
  blurb: "",
  poster: `assets/${id}/poster.webp`,
  ...(open ? { create: async () => ({}) as Game } : {}),
});
const arcade = [game("soon-first", false), game("high-noon"), game("dead-of-night"), game("overwatch-ridge", false)];
const open = (from: Partial<{ hash: string; search: string; remembered: string | null }>) =>
  initialGame(arcade, { hash: "", search: "", remembered: null, ...from })?.id;

describe("the game the arcade opens on", () => {
  it("is the one the address names, by its hash or ?game=", () => {
    expect(open({ hash: "#dead-of-night" })).toBe("dead-of-night");
    expect(open({ search: "?input=script&game=overwatch-ridge" })).toBe("overwatch-ridge");
    // The hash is what the page writes as the player chooses: it wins.
    expect(open({ hash: "#dead-of-night", search: "?game=high-noon" })).toBe("dead-of-night");
  });

  it("is otherwise the one chosen last, and at first the first that can be played", () => {
    expect(open({ remembered: "dead-of-night" })).toBe("dead-of-night");
    expect(open({})).toBe("high-noon");
  });

  it("passes over a name that is not a game in the arcade", () => {
    expect(open({ hash: "#no-such-game", remembered: "gone-since" })).toBe("high-noon");
    expect(open({ hash: "#%E2%80%A6" })).toBe("high-noon");
    expect(open({ hash: "#%E2" })).toBe("high-noon");
  });
});

describe("the row of games by keyboard", () => {
  it("moves one along with the arrows, wrapping round, and to the ends with Home and End", () => {
    expect(step(4, 0, "ArrowRight")).toBe(1);
    expect(step(4, 0, "ArrowDown")).toBe(1);
    expect(step(4, 0, "ArrowLeft")).toBe(3);
    expect(step(4, 3, "ArrowRight")).toBe(0);
    expect(step(4, 2, "Home")).toBe(0);
    expect(step(4, 1, "End")).toBe(3);
    expect(step(4, 1, "Enter")).toBeNull();
  });
});

describe("a game's backdrop", () => {
  it("is its sky under its glow, as the page draws it", () => {
    const css = backdropCss({
      sky: [
        ["#000", 0],
        ["#123", 1],
      ],
      glow: { x: 0.62, y: 1.08, width: 1.2, height: 0.9, stops: [["red", 0], ["transparent", 0.62]] },
    });
    expect(css).toBe("radial-gradient(120% 90% at 62% 108%, red 0%, transparent 62%), linear-gradient(180deg, #000 0%, #123 100%)");
    expect(backdropCss({ sky: [["#000", 0]] })).toBe("linear-gradient(180deg, #000 0%)");
  });
});
