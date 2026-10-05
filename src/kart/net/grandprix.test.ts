/**
 * The Grand Prix in a room: four races of a cup in a row, the standings
 * between them, the podium, bots that keep their names, a guest who leaves
 * with their points, a latecomer turned away, and Mirror mode on the wire.
 */
import { describe, expect, it } from "vitest";
import type { LobbyState, Session, SessionClosed } from "../contract";
import { GP_RESULTS_MS, GP_STANDINGS_MS, pointsFor } from "../grandprix";
import { MIRROR_SUFFIX } from "../track/mirror";
import { CUPS } from "../track/tracks";
import { player, straight, World } from "./testkit";

/** Ann (host) and Bob (guest), one lap a race, four bots, a cup chosen. */
async function room(world: World, settings: Parameters<Session["configure"]>[0] = {}) {
  const host = world.host();
  host.setLocalPlayers([player("Ann")]);
  await world.run(0.1);
  const guest = world.guest(host.lobby().code!);
  guest.setLocalPlayers([player("Bob", straight())]);
  await world.run(1);
  host.configure({ mode: "grand-prix", cup: "acorn", laps: 1, bots: true, racers: 6, ...settings });
  await world.run(0.3);
  return { host, guest };
}

const phase = (s: Session) => s.lobby().phase;

/** Runs until the room is in `wanted` (an error if it never gets there). */
async function until(world: World, session: Session, wanted: LobbyState["phase"], limit = 120): Promise<void> {
  const done = await world.until(() => phase(session) === wanted, limit);
  expect(phase(session), `waiting for ${wanted}`).toBe(wanted);
  expect(done).toBe(true);
}

describe("choosing a Grand Prix", () => {
  it("syncs the mode, the cup and the mirror to every guest, keeping them valid", async () => {
    const world = new World();
    const { host, guest } = await room(world, { mirror: true });
    expect(host.lobby().settings).toMatchObject({ mode: "grand-prix", cup: "acorn", mirror: true });
    expect(guest.lobby().settings).toEqual(host.lobby().settings);
    host.configure({ mode: "nonsense" as never, cup: "nowhere", mirror: "yes" as never });
    expect(host.lobby().settings).toMatchObject({ mode: "grand-prix", cup: "acorn", mirror: true });
    host.configure({ cup: "comet", mode: "race", mirror: false });
    expect(host.lobby().settings).toMatchObject({ mode: "race", cup: "comet", mirror: false });
    // A guest cannot choose.
    guest.configure({ mode: "grand-prix", cup: "acorn" });
    await world.run(0.3);
    expect(host.lobby().settings.cup).toBe("comet");
  });
});

describe("a cup, race by race", () => {
  it("runs the cup's four tracks in order: results, standings, the next race by itself, then the podium", async () => {
    const world = new World();
    world.keep = false;
    const { host, guest } = await room(world);
    const acorn = CUPS.find((cup) => cup.id === "acorn")!;
    host.start();
    expect(phase(host)).toBe("racing");
    expect(host.lobby().grandPrix).toMatchObject({ cup: "acorn", race: 0 });

    const tracks: string[] = [];
    const names: string[][] = [];
    const seen: string[] = [];
    for (let race = 0; race < 4; race++) {
      // The race: its track is the cup's, on the host and (once the start reaches it) on the guest.
      expect(host.lobby().grandPrix!.race).toBe(race);
      await world.run(0.5);
      const view = host.frame(world.now);
      tracks.push(view!.track.id);
      names.push(view!.racers.map((r) => r.name));
      expect(guest.frame(world.now)?.track.id).toBe(acorn.tracks[race]);

      await until(world, host, "results");
      await world.run(0.2);
      expect(phase(guest)).toBe("results");
      expect(host.lobby().result).not.toBeNull();
      // The race's points are in already.
      const total = host.lobby().grandPrix!.points.reduce((sum, row) => sum + row.points, 0);
      expect(total).toBe(Array.from({ length: 6 }, (_, i) => pointsFor(i + 1)).reduce((a, b) => a + b, 0) * (race + 1));
      seen.push("results");

      // Nobody presses anything: the standings come up by themselves after a few seconds, the next race after a few more.
      await world.run(GP_RESULTS_MS / 1000 - 1);
      expect(phase(host)).toBe("results");
      await world.run(1.5);
      expect(phase(host)).toBe("standings");
      await world.run(0.3);
      expect(phase(guest)).toBe("standings");
      expect(host.lobby().result).not.toBeNull();
      seen.push("standings");
      await world.run(GP_STANDINGS_MS / 1000 - 2);
      expect(phase(host)).toBe("standings");
      await world.run(2.5);
      if (race < 3) {
        expect(phase(host)).toBe("racing");
        await world.run(0.3);
        expect(phase(guest)).toBe("racing");
        // Nobody had to get ready again.
        expect(host.lobby().players.map((p) => p.ready)).toEqual([true, true]);
      }
    }
    expect(tracks).toEqual(acorn.tracks);
    expect(seen).toEqual(Array.from({ length: 4 }, () => ["results", "standings"]).flat());
    // The same bots, in the same colours, all cup long.
    for (const list of names) expect([...list].sort()).toEqual([...names[0]!].sort());

    // After the last standings: the podium, on every device, with the final points.
    expect(phase(host)).toBe("podium");
    expect(phase(guest)).toBe("podium");
    const final = host.lobby().grandPrix!;
    expect(final.race).toBe(3);
    expect(final.points).toHaveLength(6);
    expect(final.points.map((p) => p.points)).toEqual([...final.points.map((p) => p.points)].sort((a, b) => b - a));
    expect(guest.lobby().grandPrix).toEqual(final);
    expect(final.points.filter((p) => p.player !== null).map((p) => p.name).sort()).toEqual(["Ann", "Bob"]);
  }, 60_000);

  it("moves on when the host says so, and plays the same cup again from the podium", async () => {
    const world = new World();
    world.keep = false;
    const { host, guest } = await room(world);
    host.start();
    await until(world, host, "results");
    host.next!();
    expect(phase(host)).toBe("standings");
    host.next!();
    expect(phase(host)).toBe("racing");
    expect(host.lobby().grandPrix!.race).toBe(1);
    // Next does nothing in a race, and a guest's call does nothing anywhere.
    host.next!();
    expect(phase(host)).toBe("racing");
    for (let race = 1; race < 4; race++) {
      await until(world, host, "results");
      guest.next?.();
      expect(phase(host)).toBe("results");
      host.next!();
      host.next!();
    }
    expect(phase(host)).toBe("podium");
    const before = host.lobby().grandPrix!;
    expect(before.race).toBe(3);

    // Play Again: a new cup of the same kind, nothing carried over.
    host.restart();
    expect(phase(host)).toBe("racing");
    expect(host.lobby().grandPrix).toMatchObject({ cup: "acorn", race: 0 });
    expect(host.lobby().grandPrix!.points.every((p) => p.points === 0)).toBe(true);
    await world.run(0.3);
    expect(phase(guest)).toBe("racing");

    // Back to the lobby ends it: the settings can be changed again.
    await until(world, host, "results");
    host.backToLobby();
    expect(phase(host)).toBe("lobby");
    expect(host.lobby().grandPrix ?? null).toBeNull();
    host.configure({ mode: "race", laps: 2 });
    expect(host.lobby().settings).toMatchObject({ mode: "race", laps: 2 });
  }, 60_000);

  it("refuses a latecomer once the cup has begun, between races as in them, and settings stay put", async () => {
    const world = new World();
    world.keep = false;
    const { host } = await room(world);
    host.start();
    await until(world, host, "results");
    expect(phase(host)).toBe("results");
    const late = world.guest(host.lobby().code!);
    const closed: SessionClosed[] = [];
    late.onClosed((reason) => closed.push(reason));
    late.setLocalPlayers([player("Cy")]);
    await world.run(1);
    expect(closed).toEqual(["started"]);
    expect(host.lobby().players.map((p) => p.name)).toEqual(["Ann", "Bob"]);
    // The room's settings are the cup's until it ends.
    host.configure({ cup: "comet", laps: 5 });
    expect(host.lobby().settings).toMatchObject({ cup: "acorn", laps: 1 });
  }, 60_000);

  it("keeps a guest's points when they leave, and their kart races on as a bot", async () => {
    const world = new World();
    world.keep = false;
    const { host, guest } = await room(world);
    host.start();
    await until(world, host, "results");
    const bob = host.lobby().grandPrix!.points.find((p) => p.name === "Bob")!;
    expect(bob.player).not.toBeNull();
    expect(bob.points).toBeGreaterThan(0);
    guest.leave();
    await world.run(0.5);
    expect(host.lobby().players.map((p) => p.name)).toEqual(["Ann"]);
    host.next!();
    host.next!();
    expect(phase(host)).toBe("racing");
    expect(host.lobby().grandPrix!.race).toBe(1);
    const view = host.frame(world.now)!;
    // The grid has the same number of karts, Bob's among them as a bot: no kart belongs to anyone but Ann.
    expect(view.racers).toHaveLength(6);
    const racer = view.racers.find((r) => r.name === "Bob")!;
    expect(racer).toMatchObject({ player: null, colour: bob.colour });
    expect(Object.values(host.lobby().karts)).toEqual([0]);
    const row = host.lobby().grandPrix!.points.find((p) => p.key === bob.key)!;
    expect(row).toMatchObject({ name: "Bob", player: null, points: bob.points });
  }, 60_000);
});

describe("Mirror mode over the wire", () => {
  it("sends the flag, not the track: host and guest race the same mirrored road, and the next race too", async () => {
    const world = new World();
    world.keep = false;
    const { host, guest } = await room(world, { mode: "race", track: "kitchen-rally", mirror: true });
    host.start();
    await world.run(0.5);
    const hostView = host.frame(world.now)!;
    const guestView = guest.frame(world.now)!;
    expect(hostView.track.id).toBe("kitchen-rally" + MIRROR_SUFFIX);
    expect(guestView.track.id).toBe(hostView.track.id);
    expect(guestView.track.points).toEqual(hostView.track.points);
    const original = CUPS.flatMap((cup) => cup.tracks).includes("kitchen-rally");
    expect(original).toBe(true);
    await until(world, host, "results");
    host.backToLobby();
    host.configure({ mirror: false });
    host.start();
    await world.run(0.5);
    expect(host.frame(world.now)!.track.id).toBe("kitchen-rally");
    await world.run(0.3);
    expect(guest.frame(world.now)!.track.id).toBe("kitchen-rally");
  }, 60_000);

  it("mirrors every race of a Grand Prix", async () => {
    const world = new World();
    world.keep = false;
    const { host, guest } = await room(world, { mirror: true });
    host.start();
    await until(world, host, "results");
    host.next!();
    host.next!();
    await world.run(0.5);
    expect(host.frame(world.now)!.track.id).toBe(CUPS[0]!.tracks[1] + MIRROR_SUFFIX);
    expect(guest.frame(world.now)!.track.id).toBe(CUPS[0]!.tracks[1] + MIRROR_SUFFIX);
  }, 60_000);
});
