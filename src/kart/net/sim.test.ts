/**
 * The room over the real sim (the other net tests use a stand-in): a guest's
 * kart is predicted without visible jumps, a guest who leaves is driven by the
 * sim's own bot, and the host's restart and pause work on the real race.
 */
import { describe, expect, it } from "vitest";
import { IDLE_INPUT, type KartView } from "../contract";
import { createSimRace } from "../sim/race";
import { MEADOW_LOOP } from "../track/tracks";
import { kartOf, player, scripted, World } from "./testkit";
import { packState, unpackState } from "./protocol";
import { pictureOf } from "./view";

const kartView = (view: { karts: readonly KartView[] } | undefined, id: number): KartView => {
  const kart = view?.karts.find((k) => k.id === id);
  if (!kart) throw new Error(`no kart ${id}`);
  return kart;
};

describe("the real sim's pictures", () => {
  it("are new each time, sharing nothing mutable, so the net keeps them without copying (view.ts `pictureOf`)", () => {
    const racers = [0, 1, 2, 3].map((id) => ({ id, name: `K${id}`, colour: "#fff", player: id < 2 ? id : null }));
    const race = createSimRace({ track: MEADOW_LOOP, laps: 2, seed: 9, racers });
    for (let i = 0; i < 400; i++) race.step(new Map([[0, { ...IDLE_INPUT, throttle: 1 }]]));
    const a = race.view();
    const b = race.view();
    expect(a.karts).not.toBe(b.karts);
    expect(a.things).not.toBe(b.things);
    expect(a.events).not.toBe(b.events);
    a.karts.forEach((k, i) => expect(k).not.toBe(b.karts[i]));
    a.things.forEach((t, i) => expect(t).not.toBe(b.things[i]));
    expect(a.things.length).toBeGreaterThan(0);
    // And what is kept does not move when the race does.
    const kept = pictureOf(race);
    const x = kept.karts[0]!.x;
    race.step(new Map([[0, { ...IDLE_INPUT, throttle: 1 }]]));
    expect(kept.karts[0]!.x).toBe(x);
    expect(kept.events).toEqual([]);
  });
});

describe("the real sim's snapshot on the wire", () => {
  it("is a third smaller packed, and a race restored from it is the race restored from the whole, and goes on the same", () => {
    const racers = [0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, name: `K${id}`, colour: "#fff", player: id >= 4 ? id - 4 : null, skill: 0.4 + id / 20 }));
    const setup = { track: MEADOW_LOOP, laps: 2, seed: 21, racers };
    const drive = (i: number) => new Map([4, 5, 6, 7].map((id) => [id, { ...IDLE_INPUT, throttle: 1, steer: Math.sin((i + id * 30) / 40) * 0.4, drift: i % 200 > 120, itemPresses: Math.floor(i / 150) }]));
    const host = createSimRace(setup);
    for (let i = 0; i < 900; i++) host.step(drive(i));
    const snap = host.snapshot();
    const whole = JSON.stringify(snap);
    const sent = JSON.stringify(packState(snap));
    expect(sent.length).toBeLessThan(whole.length * 0.8);

    const direct = createSimRace(setup);
    direct.restore(JSON.parse(whole));
    const packed = createSimRace(setup);
    packed.restore(unpackState(JSON.parse(sent))!);
    expect(packed.snapshot()).toEqual(direct.snapshot());
    for (let i = 900; i < 1100; i++) {
      host.step(drive(i));
      packed.step(drive(i));
    }
    // (Whole or packed, the wire has always written a negative zero as 0.)
    expect(JSON.parse(JSON.stringify(packed.snapshot()))).toEqual(JSON.parse(JSON.stringify(host.snapshot())));
  });
});

/** A driver that holds the throttle and weaves gently, so the prediction has something to get right. */
const weaver = () => scripted((_now, n) => ({ throttle: 1, steer: Math.sin(n / 40) * 0.25 }));

async function room(world: World, screen: "here" | "auto" = "here") {
  const host = world.host({ createRace: createSimRace });
  host.setLocalPlayers([player("Ann", weaver())]);
  await world.run(0.1);
  const bob = world.guest(host.lobby().code!, { createRace: createSimRace });
  bob.setLocalPlayers([player("Bob", weaver(), screen)]);
  await world.run(1);
  host.configure({ laps: 3, bots: true, racers: 4 });
  return { host, bob };
}

describe("a room over the real sim", () => {
  it("draws a guest's own kart smoothly and where the host has it, on a line with latency and loss", async () => {
    const world = new World({ latency: 45, jitter: 25, loss: 0.05 }, 11);
    const { host, bob } = await room(world);
    host.start();
    await world.run(6, undefined, 120);
    world.views.get(bob)!.length = 0;
    world.views.get(host)!.length = 0;
    await world.run(8, undefined, 120);

    const kart = kartOf(host, "Bob");
    const mine = world.views.get(bob)!.map((v) => kartView(v, kart));
    const theirs = world.views.get(host)!.map((v) => kartView(v, kart));
    expect(mine.length).toBeGreaterThan(900);
    let worst = 0;
    for (let i = 1; i < mine.length; i++) {
      worst = Math.max(worst, Math.hypot(mine[i]!.x - mine[i - 1]!.x, mine[i]!.z - mine[i - 1]!.z));
    }
    // 24 m/s is 0.2 m a frame at 120 Hz; corrections ease in rather than jump (a bump into a kart may add a little).
    expect(worst).toBeLessThan(0.8);
    // And it stays with the host's truth: the guest is ahead by about the line's delay, never far off it.
    const gap = Math.hypot(mine.at(-1)!.x - theirs.at(-1)!.x, mine.at(-1)!.z - theirs.at(-1)!.z);
    expect(gap).toBeLessThan(6);
  });

  it("hands a guest who leaves to the sim's own bot, which carries on round the track", async () => {
    const world = new World({ latency: 20 }, 4);
    const { host, bob } = await room(world);
    host.start();
    await world.run(6);
    const kart = kartOf(host, "Bob");
    const at = kartView(world.last(host), kart);
    bob.leave();
    await world.run(5);
    const later = kartView(world.last(host), kart);
    expect(Math.hypot(later.x - at.x, later.z - at.z)).toBeGreaterThan(40);
    expect(later.speed).toBeGreaterThan(10);
    expect(host.lobby().players.map((p) => p.name)).toEqual(["Ann"]);
  });

  it("restarts a race on the real sim and pauses it for a room on the big screen", async () => {
    const world = new World({ latency: 20 }, 5);
    const { host, bob } = await room(world, "auto");
    host.configure({ display: "host" });
    await world.run(0.3);
    host.start();
    await world.run(8);
    const tick = world.last(host)!.tick;
    expect(tick).toBeGreaterThan(300);

    expect(host.pause()).toBe(true);
    await world.run(2);
    const stopped = world.last(host)!;
    await world.run(1);
    expect(world.last(host)!.tick).toBe(stopped.tick);
    expect(world.last(bob)!.tick).toBeLessThanOrEqual(stopped.tick + 1);
    host.resume();
    await world.run(4);
    expect(world.last(host)!.tick).toBeGreaterThan(stopped.tick + 30);

    host.restart();
    await world.run(0.5);
    expect(world.last(host)!.tick).toBeLessThan(60);
    expect(world.last(host)!.phase).toBe("countdown");
    expect(world.last(bob)!.phase).toBe("countdown");
  });
});
