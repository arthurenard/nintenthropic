/**
 * The room: joining, leaving, a full house, mismatched versions, settings and
 * the start, all over the in-memory network.
 */
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, PLAYER_COLOURS, type SessionClosed } from "../contract";
import { PROTOCOL_VERSION, encode } from "./protocol";
import { player, World } from "./testkit";

async function openRoom(world: World, options = {}) {
  const host = world.host(options);
  host.setLocalPlayers([player("Ann")]);
  await world.run(0.1);
  return { host, code: host.lobby().code! };
}

function closedReasons(session: { onClosed(l: (r: SessionClosed) => void): () => void }): SessionClosed[] {
  const out: SessionClosed[] = [];
  session.onClosed((r) => out.push(r));
  return out;
}

describe("a room", () => {
  it("gets a four-letter code and seats the host first", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    const lobby = host.lobby();
    expect(lobby.host).toBe(host.device);
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]).toMatchObject({ slot: 0, name: "Ann", colour: PLAYER_COLOURS[0], device: host.device, screen: host.device });
    expect(lobby.phase).toBe("lobby");
  });

  it("lets guests join, each in the next slot with that slot's colour", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    const cy = world.guest(code);
    cy.setLocalPlayers([player("Cy")]);
    await world.run(1);

    const lobby = host.lobby();
    expect(lobby.players.map((p) => p.name)).toEqual(["Ann", "Bob", "Cy"]);
    expect(lobby.players.map((p) => p.colour)).toEqual(PLAYER_COLOURS.slice(0, 3));
    // Everyone sees the same lobby, and knows the room is open.
    expect(bob.lobby()).toEqual(lobby);
    expect(cy.lobby()).toEqual(lobby);
    expect(bob.link.connected).toBe(true);
    expect(bob.link.players).toBe(3);
    expect(host.link.players).toBe(3);
  });

  it("announces lobby changes to listeners, and stops when told", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    let heard = 0;
    const stop = host.onLobby(() => heard++);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    await world.run(1);
    expect(heard).toBeGreaterThan(0);
    stop();
    const before = heard;
    bob.setReady(true);
    await world.run(0.5);
    expect(heard).toBe(before);
    expect(host.lobby().players[1]!.ready).toBe(true);
  });

  it("seats two players from one device", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const pair = world.guest(code, { players: 2 });
    pair.setLocalPlayers([player("Dee"), player("Eli")]);
    await world.run(1);
    const players = host.lobby().players;
    expect(players.map((p) => [p.name, p.slot, p.device === pair.device])).toEqual([
      ["Ann", 0, false],
      ["Dee", 1, true],
      ["Eli", 2, true],
    ]);
  });

  it("turns a fifth player away with 'full'", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    for (let i = 1; i < MAX_PLAYERS; i++) world.guest(code).setLocalPlayers([player(`P${i}`)]);
    await world.run(1);
    expect(host.lobby().players).toHaveLength(MAX_PLAYERS);

    const late = world.guest(code);
    const reasons = closedReasons(late);
    await world.run(1);
    expect(reasons).toEqual(["full"]);
    expect(late.link.connected).toBe(false);
    expect(host.lobby().players).toHaveLength(MAX_PLAYERS);
  });

  it("will not seat a pair when only one seat is left", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    for (let i = 1; i < MAX_PLAYERS - 1; i++) world.guest(code).setLocalPlayers([player(`P${i}`)]);
    await world.run(1);
    const pair = world.guest(code, { players: 2 });
    const reasons = closedReasons(pair);
    await world.run(1);
    expect(reasons).toEqual(["full"]);
    expect(host.lobby().players).toHaveLength(MAX_PLAYERS - 1);
  });

  it("says 'not-found' for a code nobody hosts", async () => {
    const world = new World({ latency: 20 });
    await openRoom(world);
    const lost = world.guest("ZZZZ");
    const reasons = closedReasons(lost);
    await world.run(1);
    expect(reasons).toEqual(["not-found"]);
  });

  it("tells a late listener that the session had already closed", async () => {
    const world = new World({ latency: 20 });
    const lost = world.guest("ZZZZ");
    await world.run(1);
    const reasons = closedReasons(lost);
    await world.run(0.1);
    expect(reasons).toEqual(["not-found"]);
  });

  it("refuses a guest of another protocol version", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    // A hand-made guest speaking version 0.
    const link = await (async () => {
      const t = world.net.transport();
      const pending = t.connect(code);
      await world.run(0.2);
      return pending;
    })();
    const heard: string[] = [];
    link.onMessage((_c, data) => heard.push(data));
    link.send("reliable", encode({ t: "hello", v: PROTOCOL_VERSION - 1, device: "old", n: 1 }));
    await world.run(0.5);
    expect(heard.map((d) => JSON.parse(d))).toEqual([{ t: "reject", reason: "version" }]);
    expect(host.lobby().players).toHaveLength(1);
    expect(link.open).toBe(false);
  });

  it("frees a guest's slot when they leave, and the next newcomer takes it", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    const cy = world.guest(code);
    cy.setLocalPlayers([player("Cy")]);
    await world.run(1);
    bob.leave();
    await world.run(0.5);
    expect(host.lobby().players.map((p) => p.name)).toEqual(["Ann", "Cy"]);
    expect(cy.lobby().players.map((p) => p.name)).toEqual(["Ann", "Cy"]);

    const dee = world.guest(code);
    dee.setLocalPlayers([player("Dee")]);
    await world.run(1);
    expect(host.lobby().players.map((p) => [p.slot, p.name])).toEqual([[0, "Ann"], [1, "Dee"], [2, "Cy"]]);
  });

  it("drops a guest who goes quiet", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    await world.run(1);
    expect(host.lobby().players).toHaveLength(2);
    // Bob's tab freezes: he is no longer framed (nothing pings), though his link stays up.
    world.sessions.splice(world.sessions.indexOf(bob), 1);
    await world.run(10);
    expect(host.lobby().players).toHaveLength(1);
  });

  it("closes guests when the host leaves", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    const cy = world.guest(code);
    cy.setLocalPlayers([player("Cy")]);
    const bobCloses = closedReasons(bob);
    const cyCloses = closedReasons(cy);
    await world.run(1);
    host.leave();
    await world.run(0.5);
    expect(bobCloses).toEqual(["host-left"]);
    expect(cyCloses).toEqual(["host-left"]);
    expect(bob.link.connected).toBe(false);
  });

  it("says 'network' when the line is cut without a goodbye", async () => {
    const world = new World({ latency: 20 });
    const { code } = await openRoom(world);
    const bob = world.guest(code);
    const closes = closedReasons(bob);
    await world.run(1);
    for (const room of world.net.rooms.values()) room.sever();
    await world.run(0.1);
    expect(closes).toEqual(["network"]);
  });

  it("redraws a room code that is taken", async () => {
    const world = new World();
    // Dice that draw the device id (8 draws) and then a code: all zeros give "AAAA".
    const first = world.host({ random: () => 0 });
    await world.run(0.1);
    expect(first.lobby().code).toBe("AAAA");
    // The second host's first code is "AAAA" too (taken), so it draws again: "NNNN".
    const draws = [...Array(8).fill(0.1), 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    let n = 0;
    const second = world.host({ random: () => draws[n++ % draws.length]! });
    await world.run(0.1);
    expect(second.lobby().code).toBe("NNNN");
  });
});

describe("settings and the start", () => {
  it("syncs the host's settings to every guest, keeping them in range", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    await world.run(1);

    host.configure({ laps: 5, bots: false, racers: 99 });
    await world.run(0.5);
    expect(host.lobby().settings).toMatchObject({ laps: 5, bots: false, racers: 8 });
    expect(bob.lobby().settings).toEqual(host.lobby().settings);

    host.configure({ laps: 0 });
    expect(host.lobby().settings.laps).toBe(1);
    host.configure({ laps: 17, track: "no-such-track" });
    expect(host.lobby().settings.laps).toBe(5);
    expect(host.lobby().settings.track).toBe("meadow-loop");

    // A guest cannot change them.
    bob.configure({ laps: 2 });
    await world.run(0.5);
    expect(host.lobby().settings.laps).toBe(5);
  });

  it("starts the same race on every device: bots at the front, players behind", async () => {
    const world = new World({ latency: 30 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    const cy = world.guest(code);
    cy.setLocalPlayers([player("Cy")]);
    await world.run(1);
    host.configure({ racers: 6, laps: 1 });
    host.start();
    await world.run(1);

    for (const s of [host, bob, cy]) expect(s.lobby().phase).toBe("racing");
    const hostView = world.last(host)!;
    const bobView = world.last(bob)!;
    const cyView = world.last(cy)!;
    expect(hostView.racers).toHaveLength(6);
    expect(bobView.racers).toEqual(hostView.racers);
    expect(cyView.racers).toEqual(hostView.racers);
    expect(bobView.laps).toBe(1);
    expect(bobView.track.id).toBe(hostView.track.id);
    // Bots (player: null) first, then the three players in slot order.
    expect(hostView.racers.map((r) => r.player)).toEqual([null, null, null, 0, 1, 2]);
    expect(hostView.racers.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hostView.racers.slice(3).map((r) => r.name)).toEqual(["Ann", "Bob", "Cy"]);
    expect(host.lobby().karts).toEqual({ 3: 0, 4: 1, 5: 2 });
    expect(bob.lobby().karts).toEqual(host.lobby().karts);
    // Original, friendly bot names, all different.
    const botNames = hostView.racers.slice(0, 3).map((r) => r.name);
    expect(new Set(botNames).size).toBe(3);
  });

  it("fills only to the players when bots are off, and never fewer than the players", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob")]);
    await world.run(1);
    host.configure({ bots: false });
    host.start();
    await world.run(0.5);
    expect(world.last(host)!.racers).toHaveLength(2);
    host.backToLobby();
    await world.run(0.5);
    expect(bob.lobby().phase).toBe("lobby");
    expect(world.last(bob)).toBeDefined();

    host.configure({ bots: true, racers: 1 });
    host.start();
    await world.run(0.5);
    expect(world.last(host)!.racers).toHaveLength(2);
  });

  it("turns away someone who knocks after the start", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await openRoom(world);
    host.start();
    await world.run(0.2);
    const late = world.guest(code);
    const reasons = closedReasons(late);
    await world.run(1);
    expect(reasons).toEqual(["started"]);
  });

  it("runs solo with no transport at all", async () => {
    const world = new World();
    let transports = 0;
    const solo = world.solo({ transport: () => (transports++, world.net.transport()) });
    solo.setLocalPlayers([player("Pia")]);
    solo.start();
    await world.run(2);
    expect(transports).toBe(0);
    expect(solo.lobby().code).toBeNull();
    expect(solo.lobby().phase).toBe("racing");
    expect(world.last(solo)!.racers).toHaveLength(6);
    expect(world.last(solo)!.phase).toBe("racing");
  });
});
