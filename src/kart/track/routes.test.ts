import { describe, expect, it } from "vitest";
import { TrackGeometry } from "./geometry";
import { mirrorTrack } from "./mirror";
import { ROUTE_OVAL } from "./routeFixture";

describe("alternate routes: the geometry", () => {
  const geo = TrackGeometry.build(ROUTE_OVAL);

  it("builds a branch for each route, open, in the lap's own metres", () => {
    expect(geo.routes.length).toBe(2);
    for (const [i, road] of geo.routes.entries()) {
      expect(road.route).toBe(i + 1);
      expect(road.open).toBe(true);
      expect(road.length).toBe(geo.length);
      expect(road.from).toBeCloseTo(road.routeDef.from * geo.length, 6);
      expect(road.samples[0]!.s).toBeCloseTo(road.from, 6);
      expect(road.samples[road.samples.length - 1]!.s).toBeCloseTo(road.to, 4);
      // The samples run forward in the lap's metres.
      for (let k = 1; k < road.samples.length; k++) expect(road.samples[k]!.s).toBeGreaterThan(road.samples[k - 1]!.s);
    }
  });

  it("leaves and rejoins the main road at its own point, along its heading, at its width", () => {
    for (const road of geo.routes) {
      for (const [sample, s] of [
        [road.samples[0]!, road.from],
        [road.samples[road.samples.length - 1]!, road.to],
      ] as const) {
        const main = geo.at(s);
        expect(Math.hypot(sample.x - main.x, sample.z - main.z)).toBeLessThan(0.05);
        expect(sample.y).toBeCloseTo(main.y, 2);
        expect(sample.width).toBeCloseTo(main.width, 2);
        expect(sample.tx * main.tx + sample.tz * main.tz).toBeGreaterThan(0.97);
      }
    }
  });

  it("narrows to its own width between the flares", () => {
    const cut = geo.routes[0]!;
    const middle = cut.at((cut.from + cut.to) / 2);
    expect(middle.width).toBeCloseTo(9, 1);
  });

  it("is shorter than the road it replaces for a shortcut, and about as long for a split", () => {
    const cut = geo.routes[0]!;
    const island = geo.routes[1]!;
    expect(cut.stretch).toBeLessThan(0.95);
    expect(island.stretch).toBeGreaterThan(0.9);
    expect(island.stretch).toBeLessThan(1.25);
  });

  it("is told apart by the nearest road: on the branch, on the main road, and in the flare either", () => {
    const cut = geo.routes[0]!;
    const middle = (cut.from + cut.to) / 2;
    const on = cut.point(middle, 1);
    const p = geo.project(on.x, on.z, middle);
    expect(p.route).toBe(1);
    expect(p.s).toBeCloseTo(middle, 0);
    expect(p.offset).toBeCloseTo(1, 1);
    const road = geo.point(geo.length * 0.5, 2);
    expect(geo.project(road.x, road.z, geo.length * 0.5).route).toBe(0);
    // A kart on the branch keeps it against a main road that is nearer by less than the margin; a hint on the main road keeps that.
    const start = cut.at(cut.from + 3);
    const a = geo.project(start.x, start.z, start.s, 0);
    expect(a.route).toBe(0);
    const b = geo.project(start.x, start.z, start.s, 1);
    expect(b.route).toBe(1);
  });

  it("clamps at its ends and leaves the loop alone", () => {
    const cut = geo.routes[0]!;
    expect(cut.at(cut.from - 50).s).toBeCloseTo(cut.from, 4);
    expect(cut.at(cut.to + 50).s).toBeCloseTo(cut.to, 4);
    expect(cut.covers(cut.from + 1)).toBe(true);
    expect(cut.covers(cut.to + 5)).toBe(false);
    expect(geo.at(10).s).toBeCloseTo(10, 6);
  });

  it("is mirrored with the track: x negated, every lateral thing swapped, still joined to the road", () => {
    const flipped = TrackGeometry.build(mirrorTrack(ROUTE_OVAL));
    expect(flipped.routes.length).toBe(2);
    flipped.routes.forEach((road, i) => {
      const original = geo.routes[i]!;
      expect(road.samples.length).toBe(original.samples.length);
      for (const k of [0, 10, Math.floor(road.samples.length / 2), road.samples.length - 1]) {
        expect(road.samples[k]!.x).toBeCloseTo(-original.samples[k]!.x, 3);
        expect(road.samples[k]!.z).toBeCloseTo(original.samples[k]!.z, 3);
      }
    });
    expect(mirrorTrack(mirrorTrack(ROUTE_OVAL))).toBe(ROUTE_OVAL);
  });

  it("refuses a route that runs backwards or over the start line", () => {
    const bad = { ...ROUTE_OVAL, routes: [{ ...ROUTE_OVAL.routes![0]!, from: 0.9, to: 0.1 }] };
    expect(() => TrackGeometry.build(bad)).toThrow();
  });
});
