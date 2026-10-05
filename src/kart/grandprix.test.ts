import { describe, expect, it } from "vitest";
import type { RaceResult, RacerSetup } from "./contract";
import { GrandPrixRun, POINTS, cupById, keyOf, pointsFor, trackOfRace } from "./grandprix";
import { CUPS } from "./track/tracks";

/** Two players (slots 0 and 2) and three bots, bots in front as the room grids them. */
const grid = (): RacerSetup[] => [
  { id: 0, name: "Pebble", colour: "#FF9F0A", player: null, skill: 0.4, character: "bun" },
  { id: 1, name: "Zigzag", colour: "#BF5AF2", player: null, skill: 0.7, character: "kit" },
  { id: 2, name: "Mochi", colour: "#64D2FF", player: null, skill: 0.9, character: "rivet" },
  { id: 3, name: "Ann", colour: "#FF453A", player: 0, character: "moss" },
  { id: 4, name: "Bob", colour: "#30D158", player: 2, character: "mango" },
];

/** A race result with the karts of `order` (grid ids) finishing in that order. */
const finish = (order: number[]): RaceResult => ({ standings: order.map((kart, i) => ({ kart, place: i + 1, time: 60 + i, bestLap: 20 + i })) });

describe("points", () => {
  it("go 15, 12, 10, 8, 6, 4, 2, 1 by place, and nothing after", () => {
    expect(POINTS).toEqual([15, 12, 10, 8, 6, 4, 2, 1]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(pointsFor)).toEqual([15, 12, 10, 8, 6, 4, 2, 1, 0, 0]);
  });
});

describe("the cups", () => {
  it("are found by id, the first for an unknown one, and name four tracks each", () => {
    expect(cupById("comet").name).toBe("Comet Cup");
    expect(cupById("nonsense").id).toBe(CUPS[0]!.id);
    for (const cup of CUPS) expect(cup.tracks).toHaveLength(4);
  });

  it("say which track a race is on: the cup's race, or the room's chosen track", () => {
    expect(trackOfRace({ track: "canyon-run" }, null)).toBe("canyon-run");
    expect(trackOfRace({ track: "canyon-run" }, { cup: "comet", race: 0 })).toBe("fun-fair");
    expect(trackOfRace({ track: "canyon-run" }, { cup: "comet", race: 3 })).toBe("starlight-ribbon");
    expect(trackOfRace({ track: "canyon-run" }, { cup: "acorn", race: 9 })).toBe("canyon-run");
  });
});

describe("a Grand Prix run", () => {
  it("keys players by their slot and bots by their name", () => {
    expect(grid().map(keyOf)).toEqual(["b:Pebble", "b:Zigzag", "b:Mochi", "p0", "p2"]);
  });

  it("scores each race by place and orders the standings by points", () => {
    const run = GrandPrixRun.begin("acorn", grid());
    expect(run.race).toBe(0);
    expect(run.races).toBe(4);
    expect(run.last).toBe(false);
    run.record(finish([3, 0, 4, 1, 2]), grid());
    const state = run.state();
    expect(state.cup).toBe("acorn");
    expect(state.points.map((p) => [p.name, p.points])).toEqual([["Ann", 15], ["Pebble", 12], ["Bob", 10], ["Zigzag", 8], ["Mochi", 6]]);
    expect(state.points.map((p) => [p.place, p.gain])).toEqual([[1, 15], [2, 12], [3, 10], [4, 8], [5, 6]]);
    // The first race has no rank before it.
    expect(state.points.every((p) => p.was === undefined)).toBe(true);
  });

  it("adds up over the cup, and remembers each row's rank before the last race", () => {
    const run = GrandPrixRun.begin("acorn", grid());
    run.record(finish([3, 0, 4, 1, 2]), grid());
    run.advance();
    // Race two: Mochi wins, Ann last.
    const second = run.grid([grid()[3]!, grid()[4]!]);
    const ids = (name: string) => second.find((r) => r.name === name)!.id;
    run.record(finish([ids("Mochi"), ids("Zigzag"), ids("Pebble"), ids("Bob"), ids("Ann")]), second);
    const { points } = run.state();
    const byName = Object.fromEntries(points.map((p) => [p.name, p]));
    expect(byName.Ann).toMatchObject({ points: 15 + 6, gain: 6, place: 5, was: 1 });
    expect(byName.Mochi).toMatchObject({ points: 6 + 15, gain: 15, place: 1, was: 5 });
    expect(byName.Pebble).toMatchObject({ points: 12 + 10, gain: 10, was: 2 });
    // Mochi and Ann are level on 21: Mochi won the last race, so Mochi is ahead.
    expect(points.map((p) => [p.name, p.points])).toEqual([["Pebble", 22], ["Mochi", 21], ["Ann", 21], ["Zigzag", 20], ["Bob", 18]]);
  });

  it("breaks a tie by the better place in the last race", () => {
    const run = GrandPrixRun.begin("acorn", grid().slice(0, 3));
    // Race one: Pebble 1st (15), Zigzag 2nd (12), Mochi 3rd (10).
    run.record(finish([0, 1, 2]), grid().slice(0, 3));
    run.advance();
    const second = run.grid([]);
    const id = (name: string) => second.find((r) => r.name === name)!.id;
    // Race two: Zigzag 1st (27 in all), Mochi 2nd (22), Pebble 3rd (25).
    run.record(finish([id("Zigzag"), id("Mochi"), id("Pebble")]), second);
    run.advance();
    const third = run.grid([]);
    const id3 = (name: string) => third.find((r) => r.name === name)!.id;
    // Race three: Mochi 1st (15) -> 37; Pebble 2nd (12) -> 37; Zigzag 3rd (10) -> 37. All level on 37.
    run.record(finish([id3("Mochi"), id3("Pebble"), id3("Zigzag")]), third);
    const level = run.state().points;
    expect(level.map((p) => p.points)).toEqual([37, 37, 37]);
    // Level on points: the better place in the last race ranks higher.
    expect(level.map((p) => p.name)).toEqual(["Mochi", "Pebble", "Zigzag"]);
  });

  it("puts the leader on pole and keeps every bot's name, colour, skill and driver all cup long", () => {
    const run = GrandPrixRun.begin("comet", grid());
    run.record(finish([4, 3, 0, 1, 2]), grid());
    for (let race = 1; race < 4; race++) {
      run.advance();
      const next = run.grid([grid()[3]!, grid()[4]!]);
      expect(next).toHaveLength(5);
      expect(next.map((r) => r.id)).toEqual([0, 1, 2, 3, 4]);
      // The leader is on pole.
      expect(next[0]!.name).toBe(run.state().points[0]!.name);
      for (const bot of grid().slice(0, 3)) {
        expect(next.find((r) => r.name === bot.name)).toMatchObject({ colour: bot.colour, skill: bot.skill, character: bot.character, player: null });
      }
      for (const racer of grid().slice(3)) {
        expect(next.find((r) => r.name === racer.name)).toMatchObject({ colour: racer.colour, character: racer.character, player: racer.player });
      }
      run.record(finish(next.map((r) => r.id)), next);
    }
    expect(run.last).toBe(true);
    // A cup stays on its last race.
    run.advance();
    expect(run.race).toBe(3);
    expect(run.track).toBe("starlight-ribbon");
  });

  it("keeps the row of a player who leaves, and drives their kart as a bot from then on", () => {
    const run = GrandPrixRun.begin("acorn", grid());
    run.record(finish([4, 3, 0, 1, 2]), grid());
    run.leave([2]);
    run.advance();
    // Bob (slot 2) is gone from the room: only Ann is left to give.
    const next = run.grid([grid()[3]!]);
    expect(next).toHaveLength(5);
    expect(next.filter((r) => r.player !== null).map((r) => r.name)).toEqual(["Ann"]);
    expect(next.find((r) => r.name === "Bob")).toMatchObject({ player: null, colour: "#30D158", character: "mango" });
    expect(next.find((r) => r.name === "Bob")!.skill).toBeGreaterThan(0);
    const bob = run.state().points.find((p) => p.name === "Bob")!;
    expect(bob).toMatchObject({ key: "p2", player: null, points: 15 });
  });

  it("takes a player's fresh details from the room (a new name) but keeps their row", () => {
    const run = GrandPrixRun.begin("acorn", grid());
    run.record(finish([3, 4, 0, 1, 2]), grid());
    run.advance();
    run.grid([{ ...grid()[3]!, name: "Annie", character: "bun" }, grid()[4]!]);
    expect(run.state().points.find((p) => p.key === "p0")).toMatchObject({ name: "Annie", character: "bun", points: 15 });
  });
});
