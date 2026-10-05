/**
 * The room over the real sim (the other net tests use a stand-in): a guest's
 * kart is predicted without visible jumps, a guest who leaves is driven by the
 * sim's own bot, and the host's restart and pause work on the real race.
 */
import { describe, expect, it } from "vitest";
import type { KartView } from "../contract";
import { createSimRace } from "../sim/race";
import { kartOf, player, scripted, World } from "./testkit";

const kartView = (view: { karts: readonly KartView[] } | undefined, id: number): KartView => {
  const kart = view?.karts.find((k) => k.id === id);
  if (!kart) throw new Error(`no kart ${id}`);
  return kart;
};

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
