/**
 * The race over a bad line: inputs, prediction, interpolation, a guest
 * leaving, who sees what, events and results.
 */
import { describe, expect, it } from "vitest";
import { TICK, type DriveInput, type KartView } from "../contract";
import { FAKE_COUNTDOWN } from "./fakeRace";
import { kartOf, player, scripted, straight, World } from "./testkit";

/** A room of Ann (host) and Bob (guest), ready to start. */
async function twoPlayers(world: World, bob: ReturnType<typeof player>, hostOptions = {}) {
  const host = world.host(hostOptions);
  host.setLocalPlayers([player("Ann")]);
  await world.run(0.1);
  const guest = world.guest(host.lobby().code!);
  guest.setLocalPlayers([bob]);
  await world.run(1);
  return { host, guest };
}

const kartIn = (view: { karts: readonly KartView[] } | undefined, id: number): KartView => {
  const kart = view?.karts.find((k) => k.id === id);
  if (!kart) throw new Error(`no kart ${id}`);
  return kart;
};

describe("inputs from a guest", () => {
  it("arrive in order and exactly once under 20% loss and 80 ms of jitter, item presses intact", async () => {
    const world = new World({ latency: 40, jitter: 80, loss: 0.2 }, 3);
    world.keep = false;
    let presses = 0;
    // Each sample's steer says which sample it was; the item count only ever goes up.
    const bobControl = scripted((_now, n) => {
      if (n >= 1200) return { throttle: 0, brake: 1, itemPresses: presses };
      if (n % 97 === 96) presses++;
      return { throttle: 1, steer: ((n % 199) - 99) / 100, itemPresses: presses };
    });
    const applied: { kart: number; seq: number; input: DriveInput }[] = [];
    const { host } = await twoPlayers(world, player("Bob", bobControl), {
      onApply: (kart: number, seq: number, input: DriveInput) => applied.push({ kart, seq, input }),
    });
    host.start();
    await world.run(24);

    expect(bobControl.samples).toBeGreaterThan(1300);
    const sent = 1200;
    // In order, never twice.
    for (let i = 1; i < applied.length; i++) expect(applied[i]!.seq).toBeGreaterThan(applied[i - 1]!.seq);
    // What was applied is what was sent: sample n's steer and count, rounded the same way at both ends.
    for (const { seq, input } of applied) {
      if (seq <= sent) {
        expect(input.steer).toBeCloseTo((((seq - 1) % 199) - 99) / 100, 10);
        expect(input.itemPresses).toBe(Math.floor(seq / 97));
      } else {
        // After sample 1200 Bob brakes, with the count where it ended.
        expect(input).toMatchObject({ throttle: 0, brake: 1, itemPresses: presses });
      }
    }
    // Packets carry the last six, so a lost packet costs nothing; what the host skips is its own doing
    // (it cuts a backlog of more than four to the newest two), and a press is a running count, so it survives that too.
    const inWindow = applied.filter((a) => a.seq <= sent).length;
    expect(inWindow).toBeGreaterThan(sent * 0.7);
    // Every press was counted by the sim, none lost and none doubled.
    expect(presses).toBe(12);
    const bob = kartOf(host, "Bob");
    expect(kartIn(host.frame(world.now) ?? undefined, bob).itemUses).toBe(presses);
  });

  it("are applied one per tick, the last held when none comes, the queue cut when it grows", async () => {
    const world = new World({ latency: 10 }, 5);
    const applied: number[] = [];
    const { host, guest } = await twoPlayers(world, player("Bob", straight()), {
      onApply: (_kart: number, seq: number) => applied.push(seq),
    });
    host.start();
    await world.run(1);
    const before = applied.length;
    // A burst: Bob's tab stalls for half a second, then delivers it all at once.
    world.sessions.splice(world.sessions.indexOf(guest), 1);
    await world.run(0.5);
    const held = applied.length - before;
    world.sessions.push(guest);
    await world.run(0.5);
    // While Bob was silent the host kept driving his kart on the last input (no new applications).
    expect(held).toBeLessThanOrEqual(2);
    // Afterwards there was never a long backlog: applications resume and stay in order.
    for (let i = 1; i < applied.length; i++) expect(applied[i]!).toBeGreaterThan(applied[i - 1]!);
    expect(applied.length - before).toBeGreaterThan(20);
  });

  it("ignore a kart that is not the sender's", async () => {
    const world = new World({ latency: 10 }, 5);
    const applied: number[] = [];
    const { host, guest } = await twoPlayers(world, player("Bob", straight()), {
      onApply: (kart: number) => applied.push(kart),
    });
    host.start();
    await world.run(1);
    // A cheat: Bob also claims Ann's kart.
    const ann = kartOf(host, "Ann");
    const bob = kartOf(host, "Bob");
    const link = (guest as unknown as { link_: { send(c: string, d: string): void } }).link_;
    const race = (guest as unknown as { raceId: number }).raceId;
    link.send("unreliable", JSON.stringify({ t: "in", r: race, k: [[ann, [[500000, 100, 100, 0, 0, 0]]]] }));
    await world.run(0.5);
    expect(applied).not.toContain(ann);

    // And a straggler from some earlier race, whose numbers are far ahead of this one's, is not this race's input.
    const before = applied.length;
    link.send("unreliable", JSON.stringify({ t: "in", r: race + 1, k: [[bob, [[900000, 100, 100, 0, 0, 0]]]] }));
    await world.run(0.5);
    expect(applied.slice(before)).not.toContain(900000);
    expect(applied.length - before).toBeGreaterThan(20); // Bob's real inputs went on being taken
  });

  it("do not mix in a snapshot of another race", async () => {
    const world = new World({ latency: 10 }, 5);
    const { host, guest } = await twoPlayers(world, player("Bob", straight()));
    host.start();
    await world.run(1);
    const tick = world.last(guest)!.tick;
    // A late snapshot from an earlier race, tick far ahead: it must not reach the picture.
    const raceId = (host as unknown as { raceId: number }).raceId;
    const state = (host as unknown as { race: { snapshot(): { tick: number } } }).race.snapshot();
    const stale = JSON.stringify({ t: "snap", r: raceId + 1, acks: {}, state: { ...state, tick: tick + 5000 } });
    (guest as unknown as { onMessage(d: string): void }).onMessage(stale);
    await world.run(0.2);
    expect(world.last(guest)!.tick).toBeLessThan(tick + 100);
  });
});

describe("a guest's own kart", () => {
  it("answers the wheel at once, long before the host has heard", async () => {
    const world = new World({ latency: 100 }, 4);
    let steer = 0;
    const { host, guest } = await twoPlayers(world, player("Bob", scripted(() => ({ throttle: 1, steer }))));
    host.start();
    await world.run(3);
    const bob = kartOf(host, "Bob");
    const headingBefore = kartIn(world.last(guest), bob).heading;

    steer = 1;
    await world.run(0.1);
    const mine = kartIn(world.last(guest), bob);
    const hosts = kartIn(world.last(host), bob);
    expect(mine.steer).toBe(1);
    expect(mine.heading).toBeLessThan(headingBefore - 0.05);
    // 100 ms each way: the host has not seen the new wheel yet.
    expect(hosts.steer).toBe(0);
  });

  it("converges to the host's after corrections, and never jumps", async () => {
    const world = new World({ latency: 60, jitter: 40, loss: 0.15 }, 9);
    let drive = true;
    const bobControl = scripted((now) =>
      drive
        ? { throttle: 1, steer: Math.sin(now / 700) * 0.8, brake: 0 }
        : { throttle: 0, steer: 0, brake: 1 },
    );
    const { host, guest } = await twoPlayers(world, player("Bob", bobControl));
    host.start();
    const bob = kartOf(host, "Bob");

    // Eight seconds of driving on a bad line: the own kart moves smoothly, frame to frame.
    let last = { x: 0, z: 0 };
    let worst = 0;
    await world.run(1.5);
    last = kartIn(world.last(guest), bob);
    await world.run(8, () => {
      const kart = kartIn(world.last(guest), bob);
      const step = Math.hypot(kart.x - last.x, kart.z - last.z);
      // Nothing but what the kart could cover in a frame (24 m/s top speed is 0.4 m) plus easing.
      worst = Math.max(worst, step - kart.speed * TICK);
      last = kart;
    });
    expect(worst).toBeLessThan(0.45);

    // Then the line clears and Bob stops: his screen and the host's agree.
    drive = false;
    world.net.setConditions({ jitter: 0, loss: 0 });
    await world.run(6);
    const mine = kartIn(world.last(guest), bob);
    const truth = kartIn(world.last(host), bob);
    expect(mine.speed).toBeCloseTo(0, 3);
    expect(Math.hypot(mine.x - truth.x, mine.z - truth.z)).toBeLessThan(0.02);
    expect(Math.abs(mine.heading - truth.heading)).toBeLessThan(0.01);
  });

  it("is not predicted when the player is on the host's big screen", async () => {
    const world = new World({ latency: 60 }, 4);
    const { host, guest } = await twoPlayers(world, player("Bob", straight(), "host"));
    host.start();
    await world.run(3);
    const bob = kartOf(host, "Bob");
    // Bob's own device draws nothing of his own (the host does); he still drives, and his kart moves on the host.
    expect(guest.views()).toEqual([]);
    expect(host.views()).toContain(bob);
    expect(kartIn(world.last(host), bob).speed).toBeGreaterThan(5);
  });
});

describe("other karts on a guest", () => {
  it("glide between snapshots, smoothly, and a moment behind", async () => {
    const world = new World({ latency: 40, jitter: 40, loss: 0.1 }, 11);
    const { host, guest } = await twoPlayers(world, player("Bob", straight()));
    host.configure({ racers: 4 });
    host.start();
    await world.run(2);

    // A bot goes round at a steady 18 m/s; on the guest it should too, frame after frame.
    const bot = 0;
    let last = kartIn(world.last(guest), bot);
    const expected = 18 * TICK;
    const ratios: number[] = [];
    await world.run(6, () => {
      const kart = kartIn(world.last(guest), bot);
      const step = Math.hypot(kart.x - last.x, kart.z - last.z);
      // Never backwards: the step points the way the kart faces.
      expect((kart.x - last.x) * Math.sin(kart.heading) + (kart.z - last.z) * Math.cos(kart.heading)).toBeGreaterThanOrEqual(-1e-9);
      ratios.push(step / expected);
      last = kart;
    });
    const smooth = ratios.filter((r) => r > 0.6 && r < 1.4).length / ratios.length;
    expect(smooth).toBeGreaterThan(0.95);
    expect(Math.max(...ratios)).toBeLessThan(2.2);

    // And a moment behind: the host is ahead of what the guest draws.
    const behind = (kartIn(world.last(host), bot).x - kartIn(world.last(guest), bot).x) ** 2 +
      (kartIn(world.last(host), bot).z - kartIn(world.last(guest), bot).z) ** 2;
    expect(Math.sqrt(behind)).toBeGreaterThan(18 * 0.05);
    expect(Math.sqrt(behind)).toBeLessThan(18 * 0.4);
  });
});

describe("a guest who leaves mid-race", () => {
  it("frees the slot, and the kart keeps going", async () => {
    const world = new World({ latency: 30 }, 6);
    const { host, guest } = await twoPlayers(world, player("Bob", straight()));
    host.configure({ racers: 4 });
    host.start();
    await world.run(5);
    const bob = kartOf(host, "Bob");
    const going = kartIn(world.last(host), bob);
    expect(going.speed).toBeGreaterThan(10);

    guest.leave();
    await world.run(0.5);
    const lobby = host.lobby();
    expect(lobby.players.map((p) => p.name)).toEqual(["Ann"]);
    expect(lobby.karts[bob]).toBeUndefined();
    expect(lobby.phase).toBe("racing");

    // The autopilot drives it on, and keeps it on the road.
    await world.run(6);
    const later = kartIn(world.last(host), bob);
    expect(later.speed).toBeGreaterThan(8);
    expect(Math.hypot(later.x - going.x, later.z - going.z)).toBeGreaterThan(60);
  });

  it("does the same when the guest's line dies", async () => {
    const world = new World({ latency: 30 }, 6);
    const { host } = await twoPlayers(world, player("Bob", straight()));
    host.start();
    await world.run(2);
    const bob = kartOf(host, "Bob");
    for (const room of world.net.rooms.values()) room.sever();
    await world.run(1);
    expect(host.lobby().players).toHaveLength(1);
    expect(host.lobby().karts[bob]).toBeUndefined();
    await world.run(2);
    expect(kartIn(world.last(host), bob).speed).toBeGreaterThan(8);
  });

  it("frees the slot for a newcomer after the race", async () => {
    const world = new World({ latency: 30 }, 6);
    const { host, guest } = await twoPlayers(world, player("Bob", straight()));
    host.start();
    await world.run(2);
    guest.leave();
    await world.run(0.5);
    host.backToLobby();
    const cy = world.guest(host.lobby().code!);
    cy.setLocalPlayers([player("Cy")]);
    await world.run(1);
    expect(host.lobby().players.map((p) => [p.slot, p.name])).toEqual([[0, "Ann"], [1, "Cy"]]);
  });
});

describe("who sees which kart", () => {
  it("shows each player on their own device, or on the host's big screen", async () => {
    const world = new World({ latency: 20 }, 2);
    const host = world.host();
    host.setLocalPlayers([player("Ann")]);
    await world.run(0.1);
    const code = host.lobby().code!;
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob", straight(), "host")]);
    const cy = world.guest(code);
    cy.setLocalPlayers([player("Cy")]);
    const dee = world.guest(code);
    dee.setLocalPlayers([player("Dee", straight(), "host")]);
    await world.run(1);
    host.start();
    await world.run(0.5);

    const kart = (name: string) => kartOf(host, name);
    expect(host.views()).toEqual([kart("Ann"), kart("Bob"), kart("Dee")]);
    expect(cy.views()).toEqual([kart("Cy")]);
    expect(bob.views()).toEqual([]);
    expect(dee.views()).toEqual([]);
    // A player who changes their mind in the lobby is shown where they chose, once the next race starts.
    host.backToLobby();
    await world.run(0.5);
    cy.setLocalPlayers([player("Cy", straight(), "host")]);
    await world.run(0.5);
    host.start();
    await world.run(0.5);
    expect(host.views()).toEqual([kart("Ann"), kart("Bob"), kart("Cy"), kart("Dee")]);
    expect(cy.views()).toEqual([]);
  });

  it("lists, in slot order, the karts whose player is shown on this device", async () => {
    const world = new World({ latency: 20 }, 2);
    const host = world.host({ players: 2 });
    host.setLocalPlayers([player("Ann"), player("Abe", straight(), "here")]);
    await world.run(0.1);
    const code = host.lobby().code!;
    const bob = world.guest(code);
    bob.setLocalPlayers([player("Bob", straight(), "host")]);
    await world.run(1);
    expect(host.views()).toEqual([]); // not racing yet
    host.start();
    await world.run(0.5);

    const karts = (name: string) => kartOf(host, name);
    // The host's screen: its own two and Bob, who chose the big screen.
    expect(host.views()).toEqual([karts("Ann"), karts("Abe"), karts("Bob")]);
    expect(bob.views()).toEqual([]);

    // The same lobby gives the same answer on the guest.
    expect(bob.lobby().karts).toEqual(host.lobby().karts);
  });

  it("gives a guest who keeps himself on his own screen his own kart", async () => {
    const world = new World({ latency: 20 }, 2);
    const host = world.host();
    host.setLocalPlayers([player("Ann")]);
    await world.run(0.1);
    const code = host.lobby().code!;
    const bob = world.guest(code, { players: 2 });
    bob.setLocalPlayers([player("Bob", straight(), "here"), player("Bea", straight(), "host")]);
    await world.run(1);
    host.start();
    await world.run(0.5);
    expect(bob.views()).toEqual([kartOf(host, "Bob")]);
    expect(host.views()).toEqual([kartOf(host, "Ann"), kartOf(host, "Bea")]);
  });
});

describe("events", () => {
  it("reach every device once, in the frame after they happen", async () => {
    const world = new World({ latency: 30, jitter: 20, loss: 0.1 }, 8);
    let presses = 0;
    const bobControl = scripted((_now, n) => {
      if (n % 120 === 119) presses++;
      return { throttle: 1, itemPresses: presses };
    });
    const { host, guest } = await twoPlayers(world, player("Bob", bobControl));
    host.start();
    await world.run(24);
    for (const s of [host, guest]) {
      const events = world.views.get(s)!.flatMap((v) => v.events);
      const ids = events.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(events.filter((e) => e.type === "use").length).toBe(presses);
      expect(events.some((e) => e.type === "lap")).toBe(true);
    }
    const hostIds = world.views.get(host)!.flatMap((v) => v.events.map((e) => e.id));
    const guestIds = world.views.get(guest)!.flatMap((v) => v.events.map((e) => e.id));
    expect(guestIds).toEqual(hostIds);
  });
});

describe("the end of a race", () => {
  it("goes to the results on every device, with the same standings, and back to the lobby", async () => {
    const world = new World({ latency: 30, jitter: 10, loss: 0.05 }, 12);
    world.keep = false;
    const { host, guest } = await twoPlayers(world, player("Bob", straight()));
    host.setLocalPlayers([player("Ann", straight())]);
    host.configure({ laps: 1, racers: 4 });
    host.start();
    const ended = await world.until(() => host.lobby().phase === "results" && guest.lobby().phase === "results", 80);
    expect(ended).toBe(true);
    const result = host.lobby().result!;
    expect(result.standings.map((s) => s.place)).toEqual([1, 2, 3, 4]);
    expect(guest.lobby().result).toEqual(result);
    // The two humans, both finishing, are among the standings with times.
    const bob = kartOf(host, "Bob");
    expect(result.standings.find((s) => s.kart === bob)!.time).not.toBeNull();
    // Outside a race there is nothing to draw.
    expect(host.frame(world.now)).toBeNull();
    expect(guest.frame(world.now)).toBeNull();

    host.backToLobby();
    await world.run(0.5);
    expect(guest.lobby().phase).toBe("lobby");
    expect(guest.lobby().result).toBeNull();
    // Race again.
    world.keep = true;
    host.start();
    await world.run(1);
    expect(guest.lobby().phase).toBe("racing");
    expect(world.last(guest)).toBeDefined();
  });

  it("keeps the race on screen for the results delay so the finish is seen", async () => {
    const world = new World({ latency: 20 }, 12);
    const { host } = await twoPlayers(world, player("Bob", straight()), { resultsDelay: 2 });
    host.setLocalPlayers([player("Ann", straight())]);
    host.configure({ laps: 1, racers: 2, bots: false });
    host.start();
    await world.until(() => world.last(host)?.phase === "finished", 80);
    expect(host.lobby().phase).toBe("racing");
    await world.run(1);
    expect(host.lobby().phase).toBe("racing");
    await world.run(1.5);
    expect(host.lobby().phase).toBe("results");
  });
});

describe("the host's tick", () => {
  it("runs at 60 a second whatever the frame rate, and at most 5 ticks in a frame", async () => {
    const world = new World({ latency: 20 }, 1);
    const { host } = await twoPlayers(world, player("Bob", straight()));
    host.start();
    // 30 Hz frames for two seconds: still 60 ticks a second.
    for (let i = 0; i < 60; i++) {
      world.now += 1000 / 30;
      world.net.advance(1000 / 30);
      host.frame(world.now);
    }
    const ticks = world.last(host)?.tick ?? host.frame(world.now)!.tick;
    expect(Math.abs(ticks - 120)).toBeLessThanOrEqual(2);

    // A frame after a long stall catches up by 5 ticks only.
    const before = host.frame(world.now)!.tick;
    world.now += 3000;
    const after = host.frame(world.now)!.tick;
    expect(after - before).toBe(5);
  });

  it("keeps the race going from a timer when frames stop (a hidden tab)", async () => {
    const world = new World({ latency: 20 }, 1);
    let timer: () => void = () => {};
    const { host, guest } = await twoPlayers(world, player("Bob", straight()), {
      schedule: (run: () => void) => {
        timer = run;
        return () => {};
      },
    });
    host.start();
    await world.run(1);
    const tick = host.frame(world.now)!.tick;
    // No frames for three seconds; the browser's timer fires once a second.
    for (let i = 0; i < 3; i++) {
      world.now += 1000;
      world.net.advance(1000);
      timer();
    }
    const resumed = host.frame(world.now)!.tick;
    expect(resumed - tick).toBeGreaterThan(150);
    await world.run(0.5);
    expect(guest.lobby().phase).toBe("racing");
  });

  it("counts down before the cars move", async () => {
    const world = new World({ latency: 20 }, 1);
    const { host } = await twoPlayers(world, player("Bob", straight()));
    host.start();
    await world.run(0.5);
    expect(world.last(host)!.phase).toBe("countdown");
    expect(kartIn(world.last(host), kartOf(host, "Bob")).speed).toBe(0);
    await world.run(FAKE_COUNTDOWN * TICK + 1);
    expect(world.last(host)!.phase).toBe("racing");
  });
});

describe("the line's health", () => {
  it("measures the round trip every second", async () => {
    const world = new World({ latency: 40 }, 1);
    const { guest } = await twoPlayers(world, player("Bob", straight()));
    expect(guest.link.rtt).not.toBeNull();
    expect(guest.link.rtt!).toBeGreaterThan(70);
    expect(guest.link.rtt!).toBeLessThan(110);
  });
});
