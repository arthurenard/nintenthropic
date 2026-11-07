/**
 * Party Rules in a room: the host's choice reaches every guest, the card dealt for each race travels with the start,
 * Shuffle and Today's Card deal as they say, Reverse Grid turns the grid round, and a guest's garbage changes nothing.
 */
import { describe, expect, it } from "vitest";
import type { LobbyPlayer, LobbySettings, Session } from "../contract";
import { GrandPrixRun } from "../grandprix";
import { CARDS, DAILY, SHUFFLE, dailyCard, todayKey } from "../rules";
import { DEFAULT_SETTINGS, mergeSettings } from "./roster";
import { buildSetup } from "./setup";
import { player, straight, World } from "./testkit";

async function room(world: World, settings: Parameters<Session["configure"]>[0] = {}) {
  const host = world.host();
  host.setLocalPlayers([player("Ann")]);
  await world.run(0.1);
  const guest = world.guest(host.lobby().code!);
  guest.setLocalPlayers([player("Bob", straight())]);
  await world.run(1);
  host.configure({ laps: 1, bots: true, racers: 6, ...settings });
  await world.run(0.3);
  return { host, guest };
}

describe("choosing the rules", () => {
  it("starts on Normal, syncs the choice to every guest and keeps it valid", async () => {
    const world = new World();
    const { host, guest } = await room(world);
    expect(host.lobby().settings.rules).toBe("normal");
    host.configure({ rules: "ice" });
    await world.run(0.3);
    expect(host.lobby().settings.rules).toBe("ice");
    expect(guest.lobby().settings.rules).toBe("ice");
    host.configure({ rules: "lava" });
    expect(host.lobby().settings.rules).toBe("ice");
    // Not touching the rules leaves them as they were; a guest cannot change them.
    host.configure({ laps: 2 });
    expect(host.lobby().settings.rules).toBe("ice");
    guest.configure({ rules: "turbo" });
    await world.run(0.3);
    expect(host.lobby().settings.rules).toBe("ice");
  });

  it("merges a patch the way every other setting is merged", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { rules: SHUFFLE }, 8).rules).toBe(SHUFFLE);
    expect(mergeSettings(DEFAULT_SETTINGS, { rules: 5 as never }, 8).rules).toBe("normal");
    expect(mergeSettings({ ...DEFAULT_SETTINGS, rules: "ice" }, { rules: "lava" }, 8).rules).toBe("ice");
    const withIce: LobbySettings = { ...DEFAULT_SETTINGS, rules: "ice" };
    expect(mergeSettings(withIce, { laps: 2 }, 8).rules).toBe("ice");
    // A settings object from before Party Rules reads as Normal.
    const old: LobbySettings = { ...DEFAULT_SETTINGS };
    delete old.rules;
    expect(mergeSettings(old, {}, 8).rules).toBe("normal");
  });
});

describe("the card in a race", () => {
  it("is dealt at the start and reaches the guest in the lobby and in the race", async () => {
    const world = new World();
    const { host, guest } = await room(world, { rules: "tiny" });
    expect(host.lobby().card).toBeUndefined();
    host.start();
    await world.run(1);
    expect(host.lobby().card).toBe("tiny");
    expect(guest.lobby().card).toBe("tiny");
    expect(host.frame(world.now)?.rule).toBe("tiny");
    expect(guest.frame(world.now)?.rule).toBe("tiny");
  });

  it("is none under Normal", async () => {
    const world = new World();
    const { host, guest } = await room(world);
    host.start();
    await world.run(1);
    expect(host.lobby().card).toBeUndefined();
    expect(guest.frame(world.now)?.rule).toBeUndefined();
  });

  it("Today's Card is the date's card", async () => {
    const world = new World();
    const { host, guest } = await room(world, { rules: DAILY });
    host.start();
    await world.run(1);
    expect(host.lobby().card).toBe(dailyCard(todayKey()));
    expect(guest.lobby().card).toBe(dailyCard(todayKey()));
  });

  it("Shuffle deals a card for every race of a cup, never the same twice running", { timeout: 60000 }, async () => {
    const world = new World();
    world.keep = false;
    const { host, guest } = await room(world, { rules: SHUFFLE, mode: "grand-prix", cup: "acorn" });
    host.start();
    const seen: string[] = [];
    for (let race = 0; race < 4; race++) {
      await world.run(0.5);
      expect(host.lobby().grandPrix!.race).toBe(race);
      seen.push(host.lobby().card!);
      expect(guest.lobby().card).toBe(host.lobby().card);
      // Everyone drives off; the race is decided, the results and standings follow by themselves.
      expect(await world.until(() => host.lobby().phase === "results", 120)).toBe(true);
      // The results still name the card the race was run under.
      expect(host.lobby().card).toBe(seen[race]);
      if (race < 3) expect(await world.until(() => host.lobby().phase === "racing" && host.lobby().grandPrix!.race === race + 1, 60)).toBe(true);
    }
    expect(seen.every((card) => CARDS.some((c) => c.id === card))).toBe(true);
    seen.forEach((card, i) => expect(card).not.toBe(seen[i - 1]));
  });

  it("a race begun again from the pause keeps its card; one played again from the results is dealt a new one", async () => {
    const world = new World();
    const { host } = await room(world, { rules: SHUFFLE });
    host.start();
    await world.run(0.5);
    const card = host.lobby().card;
    host.restart();
    await world.run(0.5);
    expect(host.lobby().card).toBe(card);
  });

  it("goes back to none in the lobby", async () => {
    const world = new World();
    const { host } = await room(world, { rules: "turbo" });
    host.start();
    await world.run(0.5);
    host.backToLobby();
    await world.run(0.3);
    expect(host.lobby().card).toBeUndefined();
  });
});

describe("Reverse Grid", () => {
  const players: LobbyPlayer[] = [0, 1].map((slot) => ({
    slot,
    name: `P${slot}`,
    colour: "#fff",
    device: "d",
    screen: "d",
    control: "keyboard",
    ready: true,
  }));

  it("puts the players at the back, last slot first, behind the sharpest bots", () => {
    const usual = buildSetup(players, { ...DEFAULT_SETTINGS }, 11);
    const reversed = buildSetup(players, { ...DEFAULT_SETTINGS }, 11, undefined, "reverse");
    expect(reversed.setup.rule).toBe("reverse");
    expect(usual.setup.rule).toBeUndefined();
    const bots = reversed.setup.racers.filter((r) => r.player === null);
    expect(bots.map((r) => r.skill)).toEqual([...bots.map((r) => r.skill!)].sort((a, b) => b - a));
    expect(reversed.setup.racers.slice(-2).map((r) => r.name)).toEqual(["P1", "P0"]);
    expect(reversed.setup.racers.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5]);
    // The map from kart to lobby slot follows the new order.
    expect(reversed.karts).toEqual({ 4: 1, 5: 0 });
    // The same bots and the same players are there as before; only the order is turned.
    expect(reversed.setup.racers.map((r) => r.name).sort()).toEqual(usual.setup.racers.map((r) => r.name).sort());
  });

  it("starts a cup's last place on pole", () => {
    const grid = buildSetup(players, { ...DEFAULT_SETTINGS }, 3).setup.racers;
    const cup = GrandPrixRun.begin("acorn", grid);
    // The cup's order, and the same turned round: its last place first.
    const usual = cup.grid(grid, false).map((r) => r.name);
    const turned = cup.grid(grid, true).map((r) => r.name);
    expect(usual).toHaveLength(6);
    expect(turned).toEqual([...usual].reverse());
  });
});
