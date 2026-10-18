import { describe, expect, it } from "vitest";
import type { LobbyPlayer, LobbyState, RaceResult, RacerSetup } from "../contract";
import { canStart, hostName, kartOf, localPlayers, previewColours, screenLabel, screenOfRoom, showsRace, standingRows, waitingLine } from "./roster";

const player = (slot: number, name: string, device: string, extra: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  slot,
  name,
  colour: ["#FF453A", "#0A84FF", "#30D158", "#FFD60A"][slot]!,
  device,
  screen: device,
  control: "keyboard",
  ready: true,
  ...extra,
});

const lobby = (players: LobbyPlayer[], extra: Partial<LobbyState> = {}): LobbyState => ({
  code: "ABCD",
  host: "host",
  players,
  settings: { track: "meadow-loop", laps: 3, bots: true, racers: 6, display: "own" },
  phase: "lobby",
  result: null,
  karts: {},
  ...extra,
});

describe("coming back to the room", () => {
  const gp = { cup: "acorn", race: 1, points: [] };

  it("shows the screen of the room's phase, wherever it has got to", () => {
    expect(screenOfRoom({ phase: "racing", result: null })).toBe("race");
    expect(screenOfRoom({ phase: "results", result: { standings: [] } })).toBe("results");
    expect(screenOfRoom({ phase: "standings", result: null, grandPrix: gp })).toBe("standings");
    expect(screenOfRoom({ phase: "podium", result: null, grandPrix: gp })).toBe("podium");
    expect(screenOfRoom({ phase: "lobby", result: null })).toBe("lobby");
  });

  it("falls back to the lobby when a phase has nothing to show", () => {
    // Results with no standings, or a cup's screens with no cup: the lobby, never a blank screen.
    expect(screenOfRoom({ phase: "results", result: null })).toBe("lobby");
    expect(screenOfRoom({ phase: "standings", result: null, grandPrix: null })).toBe("lobby");
    expect(screenOfRoom({ phase: "podium", result: null })).toBe("lobby");
  });
});

describe("the room", () => {
  const room =lobby([player(0, "Maya", "host"), player(1, "Sam", "phone"), player(2, "Lu", "phone", { ready: false })]);

  it("knows the players on a device, by slot", () => {
    expect(localPlayers(room, "phone").map((p) => p.name)).toEqual(["Sam", "Lu"]);
    expect(localPlayers(room, "nobody")).toEqual([]);
  });

  it("names the host by their first player", () => {
    expect(hostName(room)).toBe("Maya");
    expect(hostName(lobby([player(0, "Sam", "phone")]))).toBe("the host");
  });

  it("may start when everyone is ready, and someone is there", () => {
    expect(canStart(room)).toBe(false);
    expect(waitingLine(room)).toBe("Waiting for Lu to get ready.");
    expect(waitingLine(lobby([player(0, "Maya", "host")]))).toBe("");
    const many = lobby([player(0, "A", "d", { ready: false }), player(1, "B", "d", { ready: false }), player(2, "C", "d", { ready: false })]);
    expect(waitingLine(many)).toBe("Waiting for 3 players to get ready.");
    expect(waitingLine(lobby([player(0, "A", "d", { ready: false }), player(1, "B", "d", { ready: false })]))).toBe("Waiting for A and B to get ready.");
    expect(canStart(lobby([player(0, "Maya", "host")]))).toBe(true);
    expect(canStart(lobby([]))).toBe(false);
  });

  it("finds the kart a slot is driving", () => {
    const racing = lobby(room.players, { karts: { 2: 0, 5: 1 } });
    expect(kartOf(racing, 0)).toBe(2);
    expect(kartOf(racing, 1)).toBe(5);
    expect(kartOf(racing, 3)).toBeNull();
  });

  it("says where each player's race is shown, as the viewer sees it", () => {
    const mixed = lobby([player(0, "Maya", "host"), player(1, "Sam", "phone", { screen: "host" }), player(2, "Lu", "tablet")]);
    expect(mixed.players.map((p) => screenLabel(p, "host"))).toEqual(["This screen", "Big screen", "Their screen"]);
    expect(mixed.players.map((p) => screenLabel(p, "tablet"))).toEqual(["Their screen", "Big screen", "This screen"]);
  });

  it("knows which devices show a race, after it as well as during it (the podium's ceremony)", () => {
    const podium = { phase: "podium" as const };
    const mixed = lobby([player(0, "Maya", "host"), player(1, "Sam", "phone", { screen: "host" }), player(2, "Lu", "tablet")], podium);
    expect(showsRace(mixed, "host")).toBe(true);
    expect(showsRace(mixed, "tablet")).toBe(true);
    // A phone that is only a wheel: its race was on the host's big screen.
    expect(showsRace(mixed, "phone")).toBe(false);
    // A big screen with no players of its own still shows the race of those who chose it.
    const watched = lobby([player(0, "Sam", "phone", { screen: "host" }), player(1, "Lu", "phone", { screen: "host" })], podium);
    expect(showsRace(watched, "host")).toBe(true);
    expect(showsRace(watched, "phone")).toBe(false);
    expect(showsRace(lobby([player(0, "Maya", "solo")], podium), "solo")).toBe(true);
  });
});

describe("the standings", () => {
  const racers: RacerSetup[] = [
    { id: 0, name: "Maya", colour: "#FF453A", player: 0 },
    { id: 1, name: "Bolt", colour: "#FF9F0A", player: null, skill: 0.5 },
    { id: 2, name: "Sam", colour: "#0A84FF", player: 1 },
  ];
  const result: RaceResult = {
    standings: [
      { kart: 1, place: 1, time: 48.3, bestLap: 15.9 },
      { kart: 0, place: 2, time: 49.01, bestLap: 16.2 },
      { kart: 2, place: 3, time: null, bestLap: null },
    ],
  };
  const room = lobby([player(0, "Maya", "host"), player(1, "Sam", "phone")], { karts: { 0: 0, 2: 1 }, phase: "results", result });

  it("name and colour every kart, mark mine, and put the quickest lap in gold", () => {
    const rows = standingRows(result, racers, room, "host");
    expect(rows.map((r) => [r.placeLabel, r.name, r.mine, r.bot, r.fastest])).toEqual([
      ["1st", "Bolt", false, true, true],
      ["2nd", "Maya", true, false, false],
      ["3rd", "Sam", false, false, false],
    ]);
    expect(rows[2]!.time).toBeNull();
  });

  it("read their names and colours from the standings themselves, for a screen that never saw the grid", () => {
    const named: RaceResult = {
      standings: [
        { kart: 1, place: 1, time: 48.3, bestLap: 15.9, name: "Bolt", colour: "#FF9F0A" },
        { kart: 2, place: 2, time: 50.1, bestLap: 16.4, name: "Sam", colour: "#0A84FF" },
      ],
    };
    const rows = standingRows(named, [], room, "phone");
    expect(rows.map((r) => [r.name, r.colour, r.mine, r.bot])).toEqual([
      ["Bolt", "#FF9F0A", false, true],
      ["Sam", "#0A84FF", true, false],
    ]);
  });

  it("never leaves a row blank when the grid is not known", () => {
    const rows = standingRows(result, [], room, "host");
    expect(rows.map((r) => r.name)).toEqual(["Racer 2", "Maya", "Sam"]);
    expect(rows[0]!.bot).toBe(true);
  });
});

describe("the colours a device is about to be given", () => {
  const room = [player(0, "Maya", "host"), player(2, "Ada", "phone")];

  it("start with red for the first one into an empty room", () => {
    expect(previewColours([], "me", 1)).toEqual(["#FF453A"]);
  });

  it("are the lowest slots nobody else has, in order", () => {
    // Slots 0 and 2 are taken by other devices: this one gets 1, then 3.
    expect(previewColours(room, "me", 2)).toEqual(["#0A84FF", "#FFD60A"]);
  });

  it("do not count this device's own players as taken (it is coming back to choose again)", () => {
    expect(previewColours([player(0, "Maya", "me"), player(1, "Finn", "me")], "me", 2)).toEqual(["#FF453A", "#0A84FF"]);
  });

  it("never run out, whatever the room says", () => {
    expect(previewColours(room, "me", 4)).toHaveLength(4);
  });
});
