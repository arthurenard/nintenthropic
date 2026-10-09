import { describe, expect, it } from "vitest";
import type { GameEntry } from "../engine/types";
import { hashFor, hashId, parseRoute } from "./route";

const game = (id: string): GameEntry => ({ id, title: id, blurb: "", poster: `assets/${id}/poster.webp` });
const shooting = [game("high-noon"), game("dead-of-night"), game("overwatch-ridge")];
const at = (hash: string, search = "") => parseRoute({ hash, search }, shooting);

describe("where an address is", () => {
  it("is the landing for no name at all", () => {
    expect(at("")).toEqual({ space: "landing", focus: null });
    expect(at("", "?input=script")).toEqual({ space: "landing", focus: null });
  });

  it("is the arcade for #arcade, on the game chosen last", () => {
    expect(at("#arcade")).toEqual({ space: "arcade", game: null });
  });

  it("is the arcade on a game for its name, as a hash or as ?game= (old links keep working)", () => {
    expect(at("#high-noon")).toEqual({ space: "arcade", game: "high-noon" });
    expect(at("", "?game=dead-of-night")).toEqual({ space: "arcade", game: "dead-of-night" });
    expect(at("", "?input=script&game=overwatch-ridge")).toEqual({ space: "arcade", game: "overwatch-ridge" });
  });

  it("is the landing with Grip Prix's tile in hand for its name: it is a page of its own, not a game of the arcade", () => {
    expect(at("#grip-prix")).toEqual({ space: "landing", focus: "grip-prix" });
    expect(at("", "?game=grip-prix")).toEqual({ space: "landing", focus: "grip-prix" });
  });

  it("takes the hash over ?game=, which is a link someone passed on", () => {
    expect(at("#dead-of-night", "?game=high-noon")).toEqual({ space: "arcade", game: "dead-of-night" });
    expect(at("#grip-prix", "?game=high-noon")).toEqual({ space: "landing", focus: "grip-prix" });
  });

  it("passes over a name that is no game, and a hash that is not text", () => {
    expect(at("#no-such-game")).toEqual({ space: "landing", focus: null });
    expect(at("#no-such-game", "?game=high-noon")).toEqual({ space: "arcade", game: "high-noon" });
    expect(at("#%E2%80%A6")).toEqual({ space: "landing", focus: null });
    expect(at("#%E2")).toEqual({ space: "landing", focus: null });
    expect(hashId("#%E2")).toBe("");
    expect(hashId("#dead-of-night")).toBe("dead-of-night");
  });

  it("knows only the games it is given: the Test Range joins the arcade with the others", () => {
    expect(parseRoute({ hash: "#test-range", search: "" }, shooting)).toEqual({ space: "landing", focus: null });
    expect(parseRoute({ hash: "#test-range", search: "" }, [...shooting, game("test-range")])).toEqual({ space: "arcade", game: "test-range" });
  });
});

describe("the hash a route is written as", () => {
  it("is the game's id in the arcade, and none on the landing", () => {
    expect(hashFor({ space: "landing", focus: null })).toBe("");
    expect(hashFor({ space: "landing", focus: "grip-prix" })).toBe("");
    expect(hashFor({ space: "arcade", game: null }, shooting[1])).toBe("#dead-of-night");
    expect(hashFor({ space: "arcade", game: "high-noon" })).toBe("#high-noon");
    expect(hashFor({ space: "arcade", game: null })).toBe("#arcade");
  });
});
