import { describe, expect, it } from "vitest";
import type { LobbyPlayer, LobbyState, RaceResult, RacerSetup } from "../contract";
import { canStart, hostName, kartOf, localPlayers, screenLabel, standingRows, waitingLine } from "./roster";

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
  settings: { track: "meadow-loop", laps: 3, bots: true, racers: 6 },
  phase: "lobby",
  result: null,
  karts: {},
  ...extra,
});

describe("the room", () => {
  const room = lobby([player(0, "Maya", "host"), player(1, "Sam", "phone"), player(2, "Lu", "phone", { ready: false })]);

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

  it("never leaves a row blank when the grid is not known", () => {
    const rows = standingRows(result, [], room, "host");
    expect(rows.map((r) => r.name)).toEqual(["Racer 2", "Maya", "Sam"]);
    expect(rows[0]!.bot).toBe(true);
  });
});
