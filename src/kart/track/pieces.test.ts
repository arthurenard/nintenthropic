import { describe, expect, it } from "vitest";
import { TICK_HZ, type TrackDef } from "../contract";
import { GO_TICK } from "../sim/kart";
import { planFor } from "../sim/plan";
import { trackStats } from "../sim/trackStats";
import { input, patch, race, racers, run, toGo } from "../sim/testing";
import { TrackGeometry, type HazardDef } from "./geometry";
import { CRUSH, hazardAt } from "./hazards";
import { mirrorTrack } from "./mirror";
import { crosser, pendulum, stomperRow, sweeper } from "./pieces";

const points = [
  { x: 0, z: 0 },
  { x: 0, z: 150 },
  { x: 0, z: 300 },
  { x: -60, z: 380 },
  { x: -180, z: 380 },
  { x: -240, z: 300 },
  { x: -240, z: 150 },
  { x: -240, z: 0 },
  { x: -180, z: -80 },
  { x: -60, z: -80 },
];
const track = (hazards: HazardDef[]): TrackDef => ({ id: "pieces-test", name: "t", theme: "canyon", laps: 3, width: 14, points, itemRows: [], hazards });
const geo = TrackGeometry.build(track([]));

describe("the stomper", () => {
  const crusher: HazardDef = { kind: "rock-crusher", at: 0.1, motion: "crush", period: 4.4, radius: 2.2, offset: 0 };

  it("tells you before it falls: a shake and a lamp for at least a second, then a fall, a moment down, and up again", () => {
    expect((CRUSH.fall - CRUSH.warn) * crusher.period).toBeGreaterThan(0.9);
    let firstWarn = Infinity;
    let firstActive = Infinity;
    let lastActive = -Infinity;
    for (let t = 0; t < crusher.period; t += 0.01) {
      const p = hazardAt(geo, crusher, t);
      if (p.warn > 0) firstWarn = Math.min(firstWarn, t);
      if (p.active) {
        firstActive = Math.min(firstActive, t);
        lastActive = Math.max(lastActive, t);
      }
    }
    expect(firstActive - firstWarn).toBeGreaterThan(0.9);
    // Down for a fair moment, not most of the cycle.
    expect((lastActive - firstActive) / crusher.period).toBeGreaterThan(0.1);
    expect((lastActive - firstActive) / crusher.period).toBeLessThan(0.3);
  });

  it("is high above a kart's roof when it is not down, and never dangerous then", () => {
    for (let t = 0; t < crusher.period; t += 0.02) {
      const p = hazardAt(geo, crusher, t);
      if (!p.active) expect(p.y).toBeGreaterThanOrEqual(1);
      if (p.cycle < CRUSH.warn - 0.02) expect(p.y).toBeGreaterThan(8);
    }
  });

  it("is a pure function of the race clock (a cycle later is the same)", () => {
    for (const t of [0.3, 1.7, 3.9]) {
      const a = hazardAt(geo, crusher, t);
      const b = hazardAt(geo, crusher, t + 3 * crusher.period);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(b.active).toBe(a.active);
      expect(b.warn).toBeCloseTo(a.warn, 6);
    }
  });

  it("falls in a wave across a row, with a lane left open", () => {
    const row = stomperRow({ at: 0.1, lanes: [-4.5, 0, 4.5], period: 4, gaps: [1] });
    expect(row.map((h) => h.offset)).toEqual([-4.5, 4.5]);
    expect(row[0]!.phase).not.toBe(row[1]!.phase);
  });

  it("spins out a kart under it when it falls, and not before", { timeout: 30000 }, () => {
    const t = track([crusher]);
    const r = race(t, racers(1, 0));
    toGo(r);
    const plan = planFor(t);
    const s = crusher.at * plan.geo.length;
    const p = plan.geo.point(s, 0);
    let hit = -1;
    for (let i = 0; i < 60 * 12 && hit < 0; i++) {
      patch(r, 0, { x: p.x, z: p.z, vx: 0, vz: 0, heading: plan.geo.heading(s), s, offset: 0 });
      const events = run(r, 1, () => input({ throttle: 0 }));
      if (events.some((e) => e.type === "hazard")) hit = (r.tick - GO_TICK) / TICK_HZ;
    }
    expect(hit).toBeGreaterThan(CRUSH.fall * crusher.period - 0.3);
    expect(hit).toBeLessThan(CRUSH.down * crusher.period + 0.1);
  });
});

describe("the pendulum", () => {
  const ball = pendulum({ at: 0.1, reach: 5, period: 3 });

  it("is low and dangerous through the middle of its swing and lifts clear at each end", () => {
    const active: number[] = [];
    for (let t = 0; t < 3; t += 0.05) {
      const p = hazardAt(geo, ball, t);
      const proj = geo.project(p.x, p.z);
      expect(Math.abs(proj.offset)).toBeLessThanOrEqual(5.05);
      if (p.active) active.push(Math.abs(proj.offset));
      else expect(p.y).toBeGreaterThanOrEqual(ball.radius * 0.9);
    }
    expect(Math.max(...active)).toBeLessThan(5);
    expect(active.length).toBeGreaterThan(10);
  });
});

describe("the crosser", () => {
  const cart = crosser({ at: 0.1, reach: 12, period: 6 });

  it("runs the whole road once a cycle, out of sight before and after, with a lamp lit before it comes", () => {
    const first = hazardAt(geo, cart, 0.001);
    const last = hazardAt(geo, cart, cart.period * 0.499);
    expect(geo.project(first.x, first.z).offset).toBeCloseTo(-12, 0);
    expect(geo.project(last.x, last.z).offset).toBeCloseTo(12, 0);
    const waiting = hazardAt(geo, cart, cart.period * 0.7);
    expect(waiting.active).toBe(false);
    expect(waiting.y).toBeLessThan(-cart.radius);
    expect(hazardAt(geo, cart, cart.period * 0.95).warn).toBeGreaterThan(0.1);
    expect(hazardAt(geo, cart, cart.period * 0.6).warn).toBe(0);
    // A negative reach goes the other way.
    const back = hazardAt(geo, crosser({ at: 0.1, reach: -12, period: 6 }), 0.001);
    expect(geo.project(back.x, back.z).offset).toBeCloseTo(12, 0);
  });
});

describe("the sweeper", () => {
  const arm = sweeper({ at: 0.1, offset: 0, length: 8, period: 4, both: true });

  it("is a line of circles from the hub, turning together, and a bar through it when both ways", () => {
    expect(arm.length).toBeGreaterThan(6);
    const hub = geo.point(0.1 * geo.length, 0);
    for (const h of arm) {
      const p = hazardAt(geo, h, 1.3);
      expect(Math.hypot(p.x - hub.x, p.z - hub.z)).toBeCloseTo(h.span!, 4);
    }
    // The two halves are opposite each other.
    const a = hazardAt(geo, arm[0]!, 0);
    const b = hazardAt(geo, arm[arm.length - 1]!, 0);
    expect((a.x - hub.x) * (b.x - hub.x) + (a.z - hub.z) * (b.z - hub.z)).toBeLessThan(0);
    // And a negative dir turns the other way.
    const back = sweeper({ at: 0.1, length: 8, period: 4, dir: -1 })[0]!;
    const fwd = sweeper({ at: 0.1, length: 8, period: 4 })[0]!;
    expect(hazardAt(geo, back, 1).x).not.toBeCloseTo(hazardAt(geo, fwd, 1).x, 1);
  });
});

describe("mirror mode", () => {
  it("flips the pieces with the road: same timing, mirrored places", () => {
    const def = track([pendulum({ at: 0.1, reach: 4, period: 3 }), ...stomperRow({ at: 0.2, lanes: [-3, 3], period: 4 })]);
    const mirror = mirrorTrack(def);
    const g = TrackGeometry.build(def);
    const m = TrackGeometry.build(mirror);
    for (let i = 0; i < def.hazards!.length; i++) {
      for (const t of [0, 0.9, 2.2]) {
        const a = hazardAt(g, def.hazards![i]!, t);
        const b = hazardAt(m, mirror.hazards![i]!, t);
        expect(b.x).toBeCloseTo(-a.x, 3);
        expect(b.z).toBeCloseTo(a.z, 3);
        expect(b.active).toBe(a.active);
        expect(b.warn).toBe(a.warn);
      }
    }
  });
});

describe("the bots", () => {
  it("read the beat: eight of them lap a track of a stomper row, a sweeper, a pendulum and a cart with few hits and nobody stuck", { timeout: 60000 }, () => {
    const def = track([
      ...stomperRow({ at: 0.08, lanes: [-5, 0, 5], period: 4.4, stagger: 0.22 }),
      ...sweeper({ at: 0.2, length: 8, period: 6.5, both: true }),
      pendulum({ at: 0.35, reach: 4.5, period: 3.2 }),
      crosser({ at: 0.5, reach: 10, period: 6 }),
    ]);
    const stats = trackStats({ ...def, id: "pieces-bots", points: points.map((p) => ({ ...p, z: p.z })) }, { seed: 4, laps: 2 });
    expect(stats.finished).toBe(true);
    expect(stats.stuck).toBeLessThan(5);
    expect(stats.hazardHits / (8 * 2), JSON.stringify(stats.hitsBy)).toBeLessThan(0.6);
  });
});
