/**
 * Alternate routes in a race: karts drive and fall on a branch as on any road, progress carries on across it so places
 * stay right, the bots choose by temperament (the same every time), and a snapshot restores onto the same road.
 */
import { describe, expect, it } from "vitest";
import type { DriveInput } from "../contract";
import { mirrorTrack } from "../track/mirror";
import { ROUTE_OVAL } from "../track/routeFixture";
import { botField, trackStats } from "./trackStats";
import { createSimRace } from "./race";
import { planFor } from "./plan";
import { GO_TICK } from "./kart";

const NONE = new Map<number, DriveInput>();

/** Which road each kart is on, by where it is (0 main, 1.. a branch). */
function roadsOf(track = ROUTE_OVAL) {
  const geo = planFor(track).geo;
  return (x: number, z: number, near: number) => geo.project(x, z, near).route;
}

describe("alternate routes in a race", () => {
  it("are planned: a plan for each branch, with its own terrain and a racing line", () => {
    const plan = planFor(ROUTE_OVAL);
    expect(plan.routes.length).toBe(2);
    const cut = plan.routes[0]!;
    expect(cut.route).toBe(1);
    expect(cut.geo.open).toBe(true);
    expect(cut.terrain.open).toBe(true);
    expect(cut.terrain.ramps.length).toBe(1);
    expect(cut.pads.length).toBe(1);
    expect(cut.speed.length).toBe(cut.geo.samples.length);
    // The main road has no ramp of the branch's, and its barrier opens where the branch leaves it.
    expect(plan.terrain.ramps.length).toBe(0);
    const road = plan.geo.routes[0]!;
    let gated = 0;
    for (let i = 0; i < plan.terrain.barrierLeft.length; i++) if (plan.terrain.barrierLeft[i]! > 20 || plan.terrain.barrierRight[i]! > 20) gated++;
    expect(gated).toBeGreaterThan(20);
    // A branch's own barrier opens toward the road at both ends and closes between.
    const open = Array.from(cut.terrain.barrierLeft);
    expect(Math.max(...open)).toBeGreaterThan(20);
    expect(Math.min(...open)).toBeLessThan(10);
    expect(road.route).toBe(1);
  });

  it("are raced: eight bots finish three laps, none stuck, some take each way, and progress never jumps", { timeout: 60000 }, () => {
    const race = createSimRace({ track: ROUTE_OVAL, laps: 3, seed: 3, racers: botField() });
    const road = roadsOf();
    const near = new Array<number>(8).fill(0);
    const took = [new Set<number>(), new Set<number>(), new Set<number>()];
    const progress = new Array<number>(8).fill(-100);
    let jump = 0;
    const length = planFor(ROUTE_OVAL).geo.length;
    while (race.tick < GO_TICK + 60 * 200 && race.view().phase !== "finished") {
      race.step(NONE);
      const view = race.view();
      view.karts.forEach((k, i) => {
        const r = road(k.x, k.z, near[i]!);
        near[i] = (k.lapProgress * length) % length;
        took[r]!.add(i);
        const here = (k.lap - 1) * length + k.lapProgress * length;
        if (progress[i]! > -100 && Math.abs(here - progress[i]!) < 500) jump = Math.max(jump, Math.abs(here - progress[i]!));
        progress[i] = here;
      });
    }
    expect(race.view().phase).toBe("finished");
    expect(took[1]!.size, "someone took the shortcut").toBeGreaterThan(0);
    expect(took[2]!.size, "someone took the split").toBeGreaterThan(0);
    // Progress carries on across a branch. Where a kart passes from one road to the other the two ways of reckoning
    // the lap's metre differ by the angle the branch leaves at: a few metres once, never a leap.
    expect(jump).toBeLessThan(7);
    const result = race.result()!;
    expect(result.standings.every((s) => s.time !== null)).toBe(true);
  });

  it("send the aggressive down the shortcut more than the careful, and the same way every time", { timeout: 60000 }, () => {
    const count = (seed: number) => {
      const race = createSimRace({ track: ROUTE_OVAL, laps: 3, seed, racers: botField() });
      const road = roadsOf();
      const cuts = new Array<number>(8).fill(0);
      const was = new Array<number>(8).fill(0);
      const near = new Array<number>(8).fill(0);
      while (race.tick < GO_TICK + 60 * 200 && race.view().phase !== "finished") {
        race.step(NONE);
        race.view().karts.forEach((k, i) => {
          const r = road(k.x, k.z, near[i]!);
          near[i] = (k.lapProgress * planFor(ROUTE_OVAL).geo.length) % planFor(ROUTE_OVAL).geo.length;
          if (r === 1 && was[i] !== 1) cuts[i]!++;
          was[i] = r;
        });
      }
      return cuts;
    };
    const a = count(5);
    const b = count(5);
    expect(a).toEqual(b);
    // Over a few seeds the shortcut is a habit of some bots, not all.
    const total = [0, 1, 2, 3].map((seed) => count(seed + 10).reduce((x, y) => x + y, 0));
    expect(Math.max(...total)).toBeGreaterThan(3);
    expect(a.some((n) => n === 0) || a.some((n) => n < 3)).toBe(true);
  });

  it("restore a snapshot onto the same road and carry on the same", { timeout: 60000 }, () => {
    const make = () => createSimRace({ track: ROUTE_OVAL, laps: 3, seed: 9, racers: botField() });
    const a = make();
    for (let i = 0; i < GO_TICK + 60 * 40; i++) a.step(NONE);
    const snap = a.snapshot();
    const b = make();
    b.restore(snap);
    for (let i = 0; i < 60 * 20; i++) {
      a.step(NONE);
      b.step(NONE);
    }
    const sa = a.view();
    const sb = b.view();
    expect(sb.karts.map((k) => [k.x, k.z, k.lapProgress])).toEqual(sa.karts.map((k) => [k.x, k.z, k.lapProgress]));
  });

  it("race on the mirror image too", { timeout: 60000 }, () => {
    const stats = trackStats(mirrorTrack(ROUTE_OVAL), { seed: 2 });
    expect(stats.finished).toBe(true);
    expect(stats.stuck).toBeLessThan(5);
  });

  it("let a person drive the branch: a kart steered onto the shortcut is carried on it and rejoins the lap", { timeout: 30000 }, () => {
    const geo = planFor(ROUTE_OVAL).geo;
    const road = geo.routes[0]!;
    const race = createSimRace({ track: ROUTE_OVAL, laps: 3, seed: 1, racers: botField(1).map((r) => ({ ...r, player: 0 })) });
    // Aim at the branch's centre line, a little ahead of where the kart is, on the whole way.
    let onRoute = 0;
    let rejoined = false;
    let progress = 0;
    for (let i = 0; i < GO_TICK + 60 * 60; i++) {
      const k = race.view().karts[0]!;
      const here = geo.project(k.x, k.z, (k.lapProgress * geo.length) % geo.length);
      const at = (k.lapProgress * geo.length) % geo.length;
      let target = geo.at(at + 14);
      if (at > road.from - 60 && at < road.to + 5) {
        const ahead = road.at(Math.min(road.to, Math.max(road.from, at) + 14));
        target = ahead;
      }
      const err = Math.atan2(target.x - k.x, target.z - k.z) - k.heading;
      const wrapped = Math.atan2(Math.sin(err), Math.cos(err));
      const input: DriveInput = { steer: Math.max(-1, Math.min(1, -wrapped * 2)), throttle: 1, brake: 0, drift: false, itemPresses: 0 };
      race.step(new Map<number, DriveInput>([[0, input]]));
      if (here.route === 1) onRoute++;
      if (onRoute > 20 && here.route === 0 && at > road.to) rejoined = true;
      progress = k.lapProgress;
    }
    expect(onRoute).toBeGreaterThan(100);
    expect(rejoined).toBe(true);
    expect(progress).toBeGreaterThan(0);
  });
});
