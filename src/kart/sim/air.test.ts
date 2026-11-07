/**
 * Launch and air sections (sim/air.ts): cannons, glides and lips, on a plain stadium track so the numbers do not
 * depend on a real track's data.
 */
import { describe, expect, it } from "vitest";
import { TICK_HZ, type DriveInput, type RaceEvent, type TrackDef } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { mirrorTrack } from "../track/mirror";
import { arcHeight, arcSlope, type ArcSite } from "./air";
import { planFor } from "./plan";
import type { SimRace } from "./race";
import { KART_AT } from "./snapshot";
import { input, patch, race, racers, run, toGo, view } from "./testing";

function stadium(air: (f: (metres: number) => number) => TrackDef["air"]): TrackDef {
  const points: { x: number; z: number }[] = [];
  for (let z = 0; z < 400; z += 100) points.push({ x: 0, z });
  for (let degrees = 180; degrees > 0; degrees -= 30) points.push({ x: 100 + 100 * Math.cos((degrees * Math.PI) / 180), z: 400 + 100 * Math.sin((degrees * Math.PI) / 180) });
  for (let z = 400; z > 0; z -= 100) points.push({ x: 200, z });
  for (let degrees = 0; degrees > -180; degrees -= 30) points.push({ x: 100 + 100 * Math.cos((degrees * Math.PI) / 180), z: 100 * Math.sin((degrees * Math.PI) / 180) });
  const base: TrackDef = { id: "air-stadium", name: "Stadium", theme: "meadow", laps: 2, width: 14, points, itemRows: [] };
  const length = TrackGeometry.build(base).length;
  return { ...base, air: air((metres) => metres / length) };
}

function place(r: SimRace, track: TrackDef, s: number, offset: number, speed: number, extra: Partial<Record<keyof typeof KART_AT, number>> = {}): void {
  const geo = planFor(track).geo;
  const p = geo.point(s, offset);
  const h = geo.heading(s);
  patch(r, 0, { x: p.x, z: p.z, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, s, offset, progress: s, ...extra });
}

function fly(track: TrackDef, s: number, offset: number, speed: number, drive: (tick: number) => Partial<DriveInput> = () => ({ throttle: 1 })) {
  const r = race(track, racers(1, 0));
  toGo(r);
  place(r, track, s, offset, speed);
  const events: RaceEvent[] = [];
  let apex = 0;
  let airborne = 0;
  for (let i = 0; i < 900; i++) {
    events.push(...run(r, 1, () => input(drive(r.tick))));
    const hop = view(r).hop;
    apex = Math.max(apex, hop);
    if (hop > 0) airborne++;
    if (events.some((e) => e.type === "land")) break;
  }
  return { r, events, apex, airborne: airborne / TICK_HZ };
}

const first = <T extends RaceEvent["type"]>(events: RaceEvent[], type: T): Extract<RaceEvent, { type: T }> | undefined => events.find((e) => e.type === type) as Extract<RaceEvent, { type: T }> | undefined;

describe("the arc profiles", () => {
  const site = (kind: ArcSite["kind"]): ArcSite => ({ kind, s: 0, lo: -10, hi: 10, length: 100, height: 8 });
  it("leave and meet the road at their ends, and top out at their height", () => {
    for (const kind of ["cannon", "glide", "lip"] as const) {
      const a = site(kind);
      expect(arcHeight(a, 0)).toBe(0);
      expect(arcHeight(a, 100)).toBe(0);
      let top = 0;
      for (let d = 0; d <= 100; d += 0.5) top = Math.max(top, arcHeight(a, d));
      expect(top).toBeCloseTo(8, 1);
    }
  });
  it("glide down shallowly: a glide's landing is gentler than a cannon's", () => {
    expect(Math.abs(arcSlope(site("glide"), 99.5))).toBeLessThan(Math.abs(arcSlope(site("cannon"), 99.5)) * 0.6);
  });
});

describe("a cannon", () => {
  const track = stadium((f) => [{ kind: "cannon", at: f(200), length: 70, height: 6 }]);

  it("throws the kart up in an arc of its height and sets it down 70 m on, going on", () => {
    const { r, events, apex } = fly(track, 150, 0, 24);
    const jump = first(events, "jump")!;
    expect(jump.arc).toBe("cannon");
    expect(first(events, "land")).toBeDefined();
    expect(apex).toBeGreaterThan(5.5);
    expect(apex).toBeLessThan(6.5);
    expect(view(r).hop).toBe(0);
    const geo = planFor(track).geo;
    const landed = geo.project(view(r).x, view(r).z).s;
    expect(landed - 200).toBeGreaterThan(68);
    expect(landed - 200).toBeLessThan(76);
    expect(view(r).speed).toBeGreaterThan(20);
  });

  it("takes a slow kart too, and throws it fast enough to carry", () => {
    const { events, r } = fly(track, 199, 0, 4, () => ({ throttle: 0 }));
    expect(first(events, "jump")).toBeDefined();
    expect(first(events, "land")).toBeDefined();
    expect(view(r).speed).toBeGreaterThan(15);
  });

  it("boosts on landing after a trick, not without one", () => {
    const plain = fly(track, 150, 0, 24);
    expect(first(plain.events, "land")!.boost).toBe(false);
    const tricked = fly(track, 150, 0, 24, (t) => ({ throttle: 1, drift: t % 120 > 30 && t % 120 < 90 }));
    expect(first(tricked.events, "trick")).toBeDefined();
    expect(first(tricked.events, "land")!.boost).toBe(true);
    expect(view(tricked.r).boost).toBeGreaterThan(0.3);
  });

  it("is a pure function of where the kart is along the road: the same flight twice, the same heights", () => {
    const heights = () => {
      const r = race(track, racers(1, 0));
      toGo(r);
      place(r, track, 150, 0, 24);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        run(r, 1, () => input({ throttle: 1 }));
        out.push(view(r).hop);
      }
      return out;
    };
    expect(heights()).toEqual(heights());
  });

  it("works in the mirror", () => {
    const mirrored = mirrorTrack(track);
    const { events, apex } = fly(mirrored, 150, 0, 24);
    expect(first(events, "land")).toBeDefined();
    expect(apex).toBeGreaterThan(5.5);
  });

  it("keeps a kart that lets go of the wheel on the road through a bend", () => {
    const bend = stadium((f) => [{ kind: "cannon", at: f(430), length: 110, height: 7 }]);
    const { r, events } = fly(bend, 400, 0, 24);
    expect(first(events, "land")).toBeDefined();
    const geo = planFor(bend).geo;
    const k = view(r);
    expect(Math.abs(geo.project(k.x, k.z).offset)).toBeLessThan(7);
  });
});

describe("a glide", () => {
  const track = stadium((f) => [{ kind: "glide", at: f(200), length: 110, height: 9 }]);

  it("lifts the kart and floats it down over a long distance, much longer in the air than a jump of its height", () => {
    const { events, apex, airborne } = fly(track, 150, 0, 24);
    expect(first(events, "jump")!.arc).toBe("glide");
    expect(apex).toBeGreaterThan(8.5);
    expect(airborne).toBeGreaterThan(3.5);
  });

  it("gives a short boost for landing near the middle of the road, none for landing wide, and a wheel can pick which", () => {
    const middle = fly(track, 150, 0, 24);
    expect(first(middle.events, "land")!.boost).toBe(true);
    expect(view(middle.r).boost).toBeGreaterThan(0.3);
    const wide = fly(track, 195, 0, 24, () => ({ throttle: 1, steer: 0.3 }));
    const geo = planFor(track).geo;
    const offset = geo.project(view(wide.r).x, view(wide.r).z).offset;
    expect(Math.abs(offset)).toBeGreaterThan(3);
    expect(first(wide.events, "land")!.boost).toBe(false);
  });

  it("is no trick: the drift button does nothing in a glide", () => {
    const { events } = fly(track, 150, 0, 24, () => ({ throttle: 1, drift: true }));
    expect(first(events, "trick")).toBeUndefined();
  });
});

describe("a lip", () => {
  const track = stadium((f) => [{ kind: "lip", at: f(200), length: 36, height: 3.5, offset: 4, width: 6 }]);
  it("throws a fast kart on its side, not one beside it or a slow one", () => {
    expect(first(fly(track, 160, 4, 22).events, "jump")!.arc).toBe("lip");
    expect(first(fly(track, 160, -4, 22).events, "jump")).toBeUndefined();
    expect(first(fly(track, 195, 4, 6, () => ({ throttle: 0 })).events, "jump")).toBeUndefined();
  });
});
