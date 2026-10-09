import { describe, expect, it } from "vitest";
import type { Game, GameEntry } from "../engine/types";
import { backdropCss } from "../ui/backdrop";
import { categoryOf, pickGame, shooters, step } from "./arcade";

const game = (id: string, open = true): GameEntry => ({
  id,
  title: id,
  blurb: "",
  poster: `assets/${id}/poster.webp`,
  ...(open ? { create: async () => ({}) as Game } : {}),
});
const racer: GameEntry = { ...game("grip-prix", false), category: "racing", page: "race.html" };
const arcade = [game("soon-first", false), game("high-noon"), game("dead-of-night"), game("overwatch-ridge", false)];
const open = (named: string | null, remembered: string | null = null) => pickGame(arcade, named, remembered)?.id;

describe("the game the arcade opens on", () => {
  it("is the one the address named", () => {
    expect(open("dead-of-night")).toBe("dead-of-night");
    // The address wins over what was chosen last.
    expect(open("dead-of-night", "high-noon")).toBe("dead-of-night");
  });

  it("is otherwise the one chosen last, and at first the first that can be played", () => {
    expect(open(null, "dead-of-night")).toBe("dead-of-night");
    expect(open(null)).toBe("high-noon");
  });

  it("passes over a name that is not a game in the arcade", () => {
    expect(open("no-such-game", "gone-since")).toBe("high-noon");
    expect(open("overwatch-ridge")).toBe("overwatch-ridge");
    // Grip Prix has left the arcade for its own tile: an old choice of it opens the arcade on a shooter.
    expect(pickGame(shooters([...arcade, racer]), null, "grip-prix")?.id).toBe("high-noon");
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

describe("what the arcade lists", () => {
  it("puts a game under Shooting unless its entry says Racing", () => {
    expect(categoryOf(game("high-noon"))).toBe("shooting");
    expect(categoryOf(racer)).toBe("racing");
  });

  it("is the shooters only, in the arcade's order: Grip Prix is a tile of the landing, not a card of the row", () => {
    const listed = shooters([game("high-noon"), racer, game("dead-of-night")]);
    expect(listed.map((g) => g.id)).toEqual(["high-noon", "dead-of-night"]);
    expect(listed.some((g) => categoryOf(g) === "racing")).toBe(false);
    expect(shooters([racer])).toEqual([]);
  });
});
