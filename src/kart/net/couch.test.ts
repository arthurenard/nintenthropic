/**
 * What a living room needs of the net: a race that starts only when everyone
 * is ready, the host's choice of where the race shows, a pause like a
 * console's, a hands-lost flag for the big screen, a guest who leaves
 * becoming a bot, and pictures that glide on a screen faster than the sim.
 */
import { describe, expect, it } from "vitest";
import type { KartView, Race, RaceSetup } from "../contract";
import { createFakeRace } from "./fakeRace";
import { kartOf, player, scripted, straight, World } from "./testkit";

/** Ann hosts; the others join by code. Everyone is seated, nobody told to be ready unless the world says so. */
async function room(world: World, guests: ReturnType<typeof player>[] = [], hostOptions = {}) {
  const host = world.host(hostOptions);
  host.setLocalPlayers([player("Ann")]);
  await world.run(0.1);
  const code = host.lobby().code!;
  const joined = guests.map((guest) => {
    const session = world.guest(code);
    session.setLocalPlayers([guest]);
    return session;
  });
  await world.run(1);
  return { host, code, guests: joined };
}

const kartView = (view: { karts: readonly KartView[] } | undefined, id: number): KartView => {
  const kart = view?.karts.find((k) => k.id === id);
  if (!kart) throw new Error(`no kart ${id}`);
  return kart;
};

describe("starting", () => {
  it("waits for every player to be ready, and a race again keeps them ready", async () => {
    const world = new World({ latency: 20 });
    world.autoReady = false;
    const { host, guests } = await room(world, [player("Bob")]);
    const [bob] = guests as [typeof host];

    host.start();
    expect(host.lobby().phase).toBe("lobby");
    host.setReady(true);
    host.start();
    // Bob is still getting his wheel level.
    expect(host.lobby().phase).toBe("lobby");
    bob.setReady(true);
    await world.run(0.5);
    host.start();
    expect(host.lobby().phase).toBe("racing");
    await world.run(1);

    host.backToLobby();
    await world.run(0.5);
    expect(host.lobby().players.map((p) => p.ready)).toEqual([true, true]);
    expect(bob.lobby().players.map((p) => p.ready)).toEqual([true, true]);
    host.start();
    expect(host.lobby().phase).toBe("racing");

    // Someone new arrives after the race and is not ready: the next start waits for them.
    host.backToLobby();
    const cy = world.guest(host.lobby().code!);
    cy.setLocalPlayers([player("Cy")]);
    await world.run(1);
    host.start();
    expect(host.lobby().phase).toBe("lobby");
  });

  it("restarts the race: a new seed, the countdown again, the same people", async () => {
    const world = new World({ latency: 20 });
    const { host, guests } = await room(world, [player("Bob")]);
    const [bob] = guests as [typeof host];
    host.start();
    await world.run(3);
    const first = host.lobby().race;
    expect(world.last(host)!.tick).toBeGreaterThan(120);

    host.restart();
    await world.run(0.5);
    expect(host.lobby().phase).toBe("racing");
    expect(host.lobby().race).not.toBe(first);
    expect(bob.lobby().race).toBe(host.lobby().race);
    expect(world.last(host)!.tick).toBeLessThan(60);
    expect(world.last(bob)!.tick).toBeLessThan(90);
    expect(host.lobby().players).toHaveLength(2);
    // A guest cannot restart anyone's race.
    const tick = world.last(host)!.tick;
    bob.restart();
    await world.run(0.2);
    expect(world.last(host)!.tick).toBeGreaterThan(tick);
  });

  it("keeps this device's players in the order they were given", async () => {
    const world = new World({ latency: 20 });
    const { host, code } = await room(world, [player("Bob")]);
    const pair = world.guest(code, { players: 2 });
    pair.setLocalPlayers([player("Zed"), player("Abe")]);
    await world.run(1);
    const mine = host.lobby().players.filter((p) => p.device === pair.device);
    expect(mine.map((p) => p.name)).toEqual(["Zed", "Abe"]);
    // And again when it changes its mind about who plays.
    pair.setLocalPlayers([player("Abe"), player("Zed")]);
    await world.run(1);
    expect(host.lobby().players.filter((p) => p.device === pair.device).map((p) => p.name)).toEqual(["Abe", "Zed"]);
  });

  it("tells two players of the same name apart", async () => {
    const world = new World({ latency: 20 });
    const { host } = await room(world, [player("Ann"), player("ann"), player("Cy")]);
    expect(host.lobby().players.map((p) => p.name)).toEqual(["Ann", "Ann 2", "ann 3", "Cy"]);
  });

  it("puts the names and colours of everyone in the results", async () => {
    const world = new World({ latency: 20 });
    const { host, guests } = await room(world, [player("Bob")]);
    const [bob] = guests as [typeof host];
    host.configure({ laps: 1, bots: true, racers: 4 });
    host.start();
    expect(await world.until(() => host.lobby().phase === "results", 120)).toBe(true);
    await world.run(0.5);
    for (const session of [host, bob]) {
      const standings = session.lobby().result!.standings;
      expect(standings).toHaveLength(4);
      for (const row of standings) {
        expect(row.name).toBeTruthy();
        expect(row.colour).toMatch(/^#[0-9A-F]{6}$/i);
      }
      expect(standings.map((row) => row.name)).toContain("Bob");
    }
  });
});

describe("where the race shows", () => {
  it("follows the host's choice for players who have not chosen, and keeps a player's own", async () => {
    const world = new World({ latency: 20 });
    const { host, guests } = await room(world, [player("Bob", straight(), "auto"), player("Cy", straight(), "here")]);
    const [bob, cy] = guests as [typeof host, typeof host];
    const screenOf = (name: string) => host.lobby().players.find((p) => p.name === name)!.screen;

    expect(host.lobby().settings.display).toBe("own");
    expect(screenOf("Bob")).toBe(bob.device);

    host.configure({ display: "host" });
    await world.run(0.5);
    expect(screenOf("Ann")).toBe(host.device);
    expect(screenOf("Bob")).toBe(host.device);
    // Cy chose his own screen and keeps it.
    expect(screenOf("Cy")).toBe(cy.device);
    expect(bob.lobby().settings.display).toBe("host");

    host.configure({ display: "own" });
    await world.run(0.5);
    expect(screenOf("Bob")).toBe(bob.device);

    // A player can choose for themself either way.
    bob.setLocalPlayers([player("Bob", straight(), "host")]);
    await world.run(0.5);
    expect(screenOf("Bob")).toBe(host.device);
    bob.setLocalPlayers([player("Bob", straight(), "auto")]);
    await world.run(0.5);
    expect(screenOf("Bob")).toBe(bob.device);
  });

  it("still gives a guest who is only a wheel the race's view, for place, lap and item", async () => {
    const world = new World({ latency: 20 });
    const { host, guests } = await room(world, [player("Bob", straight(), "host")]);
    const [bob] = guests as [typeof host];
    host.start();
    await world.run(4);
    expect(bob.views()).toEqual([]);
    expect(host.views()).toEqual([kartOf(host, "Ann"), kartOf(host, "Bob")]);
    const view = world.last(bob)!;
    expect(view).toBeDefined();
    const mine = kartView(view, kartOf(bob, "Bob"));
    expect(mine.place).toBeGreaterThan(0);
    expect(mine.lap).toBeGreaterThanOrEqual(1);
    expect(view.laps).toBe(3);
  });
});

describe("pausing like a console", () => {
  it("stops practice, shows nothing moving, and resumes with a 3-2-1", async () => {
    const world = new World();
    const solo = world.solo();
    solo.setLocalPlayers([player("Ann")]);
    solo.start();
    await world.run(3);
    const tick = world.last(solo)!.tick;
    expect(tick).toBeGreaterThan(100);

    expect(solo.pause()).toBe(true);
    expect(solo.lobby().pause).toEqual({ by: solo.device, resume: null });
    await world.run(2);
    const frozen = world.last(solo)!;
    expect(frozen.tick).toBeLessThanOrEqual(tick + 1);
    const at = kartView(frozen, 0);
    await world.run(1);
    expect(kartView(world.last(solo), 0).x).toBe(at.x);

    solo.resume();
    expect(solo.lobby().pause).toEqual({ by: solo.device, resume: 3 });
    const counts = new Set<number | null | undefined>();
    await world.run(3.2, () => counts.add(solo.lobby().pause?.resume));
    expect([...counts].filter((n) => n)).toEqual([3, 2, 1]);
    expect(solo.lobby().pause).toBeNull();
    // Not a tick of the stopped time is owed to the race.
    await world.run(1);
    const after = world.last(solo)!.tick;
    expect(after - frozen.tick).toBeLessThan(75);
    expect(after).toBeGreaterThan(frozen.tick + 30);
  });

  it("stops the race for everyone when the room watches the host's screen", async () => {
    const world = new World({ latency: 20 });
    const bobControl = straight();
    const { host, guests } = await room(world, [player("Bob", bobControl, "auto")]);
    const [bob] = guests as [typeof host];
    host.configure({ display: "host" });
    await world.run(0.3);
    host.start();
    await world.run(5);

    expect(host.pause()).toBe(true);
    await world.run(0.3);
    expect(bob.lobby().pause).toEqual({ by: host.device, resume: null });
    const hostTick = world.last(host)!.tick;
    const bobTick = world.last(bob)!.tick;
    const samples = (bobControl as ReturnType<typeof scripted>).samples;
    await world.run(3);
    // Nothing moves anywhere, and Bob's wheel is not read while he waits.
    expect(world.last(host)!.tick).toBeLessThanOrEqual(hostTick + 1);
    expect(world.last(bob)!.tick).toBe(bobTick);
    expect((bobControl as ReturnType<typeof scripted>).samples).toBe(samples);
    // The line stays up through a long pause (the pings keep it so).
    expect(bob.link.connected).toBe(true);
    // A guest's pause is only theirs.
    expect(bob.pause()).toBe(false);

    host.resume();
    await world.run(0.5);
    expect(bob.lobby().pause?.resume).toBe(3);
    await world.run(3);
    expect(bob.lobby().pause).toBeNull();
    await world.run(1);
    expect(world.last(host)!.tick).toBeGreaterThan(hostTick + 30);
    expect(world.last(bob)!.tick).toBeGreaterThan(bobTick + 20);
  });

  it("is only a screen's own when everyone races on their own screen", async () => {
    const world = new World({ latency: 20 });
    const { host, guests } = await room(world, [player("Bob")]);
    const [bob] = guests as [typeof host];
    host.start();
    await world.run(3);
    expect(host.pause()).toBe(false);
    expect(host.lobby().pause ?? null).toBeNull();
    const tick = world.last(bob)!.tick;
    await world.run(1);
    expect(world.last(bob)!.tick).toBeGreaterThan(tick + 30);
  });

  it("turns away someone who knocks while the race is stopped", async () => {
    const world = new World({ latency: 20 });
    const { host, code, guests } = await room(world, [player("Bob", straight(), "host")]);
    expect(guests).toHaveLength(1);
    host.start();
    await world.run(2);
    host.pause();
    const reasons: string[] = [];
    const late = world.guest(code);
    late.onClosed((reason) => reasons.push(reason));
    await world.run(1);
    expect(reasons).toEqual(["started"]);
  });
});

describe("hands lost", () => {
  it("tells the host's big screen whose hands are gone, and forgets them with the race", async () => {
    const world = new World({ latency: 20 });
    const { host, guests } = await room(world, [player("Bob", straight(), "host")]);
    const [bob] = guests as [typeof host];
    host.start();
    await world.run(1);
    const lost = (name: string) => host.lobby().players.find((p) => p.name === name)!.handsLost === true;

    bob.setHandsLost([true]);
    await world.run(0.3);
    expect(lost("Bob")).toBe(true);
    expect(bob.lobby().players.find((p) => p.name === "Bob")!.handsLost).toBe(true);
    expect(lost("Ann")).toBe(false);

    bob.setHandsLost([false]);
    host.setHandsLost([true]);
    await world.run(0.3);
    expect(lost("Bob")).toBe(false);
    expect(lost("Ann")).toBe(true);

    host.backToLobby();
    await world.run(0.3);
    expect(lost("Ann")).toBe(false);
  });
});

describe("a guest who leaves", () => {
  it("is handed to the sim's own bot, not left to coast", async () => {
    const world = new World({ latency: 20 });
    const handed: number[] = [];
    const createRace = (setup: RaceSetup): Race => {
      const race = createFakeRace(setup);
      return Object.assign(race, { handOver: (kart: number) => void handed.push(kart) });
    };
    const { host, guests } = await room(world, [player("Bob")], { createRace });
    const [bob] = guests as [typeof host];
    host.start();
    await world.run(2);
    const kart = kartOf(host, "Bob");
    bob.leave();
    await world.run(0.5);
    expect(handed).toEqual([kart]);
    expect(host.lobby().karts[kart]).toBeUndefined();
    expect(host.lobby().players.map((p) => p.name)).toEqual(["Ann"]);
  });
});

describe("pictures between ticks", () => {
  /** How far a kart moved from one frame to the next. */
  const steps = (views: readonly { karts: readonly KartView[] }[], id: number): number[] => {
    const out: number[] = [];
    for (let i = 1; i < views.length; i++) {
      const a = kartView(views[i - 1], id);
      const b = kartView(views[i], id);
      out.push(Math.hypot(b.x - a.x, b.z - a.z));
    }
    return out;
  };

  it("glides on a 120 Hz screen: every frame moves, not every other one", async () => {
    const world = new World();
    const solo = world.solo();
    solo.setLocalPlayers([player("Ann")]);
    solo.start();
    await world.run(4, undefined, 120);
    world.views.get(solo)!.length = 0;
    await world.run(1, undefined, 120);
    const moved = steps(world.views.get(solo)!, kartOf(solo, "Ann"));
    expect(moved.length).toBeGreaterThan(100);
    const least = Math.min(...moved);
    const most = Math.max(...moved);
    // Top speed 24 m/s at 120 frames a second is 0.2 m a frame; it never stalls and never doubles up.
    expect(least).toBeGreaterThan(0.1);
    expect(most).toBeLessThan(0.3);
  });

  it("glides for a guest's own kart on a 120 Hz screen too", async () => {
    const world = new World({ latency: 25 });
    const { host, guests } = await room(world, [player("Bob")]);
    const [bob] = guests as [typeof host];
    host.start();
    await world.run(4, undefined, 120);
    world.views.get(bob)!.length = 0;
    await world.run(1, undefined, 120);
    const moved = steps(world.views.get(bob)!, kartOf(bob, "Bob"));
    expect(moved.length).toBeGreaterThan(100);
    expect(Math.min(...moved)).toBeGreaterThan(0.1);
    expect(Math.max(...moved)).toBeLessThan(0.35);
    // And the others, drawn between snapshots, glide as well.
    const others = steps(world.views.get(bob)!, kartOf(bob, "Ann"));
    expect(Math.min(...others)).toBeGreaterThan(0.05);
  });
});
