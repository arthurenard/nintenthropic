import { describe, expect, it } from "vitest";
import type { RaceEvent, RaceView } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { MEADOW_LOOP } from "../track/tracks";
import { createDemoRace } from "./demo";

function run(seconds: number, laps = 1) {
  const demo = createDemoRace(MEADOW_LOOP, { karts: 8, laps, autoRestart: false });
  const events: RaceEvent[] = [];
  const views: RaceView[] = [];
  for (let t = 0; t < seconds; t += 1 / 30) {
    demo.step(1 / 30, null);
    const v = demo.view();
    events.push(...v.events);
    views.push(v);
  }
  return { demo, events, views };
}

describe("the demo race", () => {
  const geometry = TrackGeometry.build(MEADOW_LOOP);

  it("counts down, then races", () => {
    const { views } = run(6);
    expect(views[0]!.phase).toBe("countdown");
    expect(views[0]!.countdown).toBeGreaterThan(3);
    const last = views[views.length - 1]!;
    expect(last.phase).toBe("racing");
    expect(last.countdown).toBe(0);
    expect(last.time).toBeGreaterThan(1);
  });

  it("always gives every kart its own place", () => {
    const { views } = run(40);
    for (const v of views) {
      expect(v.karts.map((k) => k.place).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });

  it("numbers its events once each, in order", () => {
    const { events } = run(40);
    expect(events.length).toBeGreaterThan(5);
    for (let i = 1; i < events.length; i++) expect(events[i]!.id).toBeGreaterThan(events[i - 1]!.id);
  });

  it("hands each event over only once", () => {
    const demo = createDemoRace(MEADOW_LOOP, { autoRestart: false });
    for (let i = 0; i < 300; i++) demo.step(1 / 30, null);
    demo.view();
    expect(demo.view().events).toEqual([]);
  });

  it("stays inside the barriers and finishes a lap on its own", () => {
    const { views } = run(100, 1);
    for (const v of views) {
      for (const k of v.karts) {
        const p = geometry.project(k.x, k.z);
        expect(Math.abs(p.offset)).toBeLessThan(p.sample.width / 2 + 6.5);
      }
    }
    const me = views[views.length - 1]!.karts[0]!;
    expect(me.finished).not.toBeNull();
    expect(me.lap).toBe(2);
  });

  it("shows every effect the picture draws: drifts, boosts, items, hits, bumps", () => {
    const { events, views } = run(90, 3);
    const types = new Set(events.map((e) => e.type));
    for (const t of ["boost", "drift-level", "pickup", "use", "hit", "lap"]) expect(types.has(t as RaceEvent["type"])).toBe(true);
    expect(views.some((v) => v.karts.some((k) => k.driftLevel === 2))).toBe(true);
    expect(views.some((v) => v.karts.some((k) => k.boost > 0))).toBe(true);
    expect(views.some((v) => v.karts.some((k) => k.spin > 0))).toBe(true);
    expect(views.some((v) => v.karts.some((k) => k.rolling))).toBe(true);
    expect(views.some((v) => v.things.some((t) => t.kind === "slick" || t.kind === "puck" || t.kind === "seeker"))).toBe(true);
    expect(views.some((v) => v.things.some((t) => t.kind === "box" && !t.active))).toBe(true);
  });
});
