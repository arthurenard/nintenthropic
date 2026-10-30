import { describe, expect, it } from "vitest";
import { race, racers, reach, run } from "../sim/testing";
import { TrackGeometry } from "./geometry";
import { MIRROR_SUFFIX, isMirrored, mirrorTrack, raceTrack, trackByRaceId } from "./mirror";
import { TRACKS } from "./tracks";

const negated = (n: number): number => (n === 0 ? 0 : -n);

describe("mirrorTrack", () => {
  for (const def of TRACKS) {
    const mirror = mirrorTrack(def);

    it(`${def.name}: flips every point and every lateral thing, and nothing else`, () => {
      expect(mirror.id).toBe(def.id + MIRROR_SUFFIX);
      expect(isMirrored(mirror)).toBe(true);
      expect(isMirrored(def)).toBe(false);
      expect(mirror.points).toHaveLength(def.points.length);
      def.points.forEach((point, i) => {
        expect(mirror.points[i]!.x).toBe(negated(point.x));
        expect(mirror.points[i]!.z).toBe(point.z);
        expect(mirror.points[i]!.y).toBe(point.y);
        expect(mirror.points[i]!.width).toBe(point.width);
        expect(mirror.points[i]!.bank).toBe(point.bank === undefined ? undefined : negated(point.bank));
      });
      expect(mirror.boostPads?.map((p) => p.offset)).toEqual(def.boostPads?.map((p) => negated(p.offset)));
      expect(mirror.boostPads?.map((p) => p.at)).toEqual(def.boostPads?.map((p) => p.at));
      expect(mirror.landmarks?.map((l) => [l.kind, l.at, l.span])).toEqual(def.landmarks?.map((l) => [l.kind, l.at, l.span]));
      expect(mirror.landmarks?.map((l) => l.offset)).toEqual(def.landmarks?.map((l) => negated(l.offset)));
      expect(mirror.landmarks?.map((l) => l.turn)).toEqual(def.landmarks?.map((l) => (l.turn === undefined ? undefined : negated(l.turn))));
      expect(mirror.hazards?.map((h) => h.offset)).toEqual(def.hazards?.map((h) => (h.offset === undefined ? undefined : negated(h.offset))));
      expect(mirror.verges?.map((v) => v.side)).toEqual(def.verges?.map((v) => (v.side === "left" ? "right" : "left")));
      expect(mirror.drops?.map((d) => d.side)).toEqual(def.drops?.map((d) => (d.side === "left" ? "right" : d.side === "right" ? "left" : "both")));
      expect(mirror.drops?.map((d) => d.gap)).toEqual(def.drops?.map((d) => d.gap));
      expect(mirror.surfaces?.map((s) => s.kind)).toEqual(def.surfaces?.map((s) => s.kind));
      expect(mirror.surfaces?.map((s) => s.offset)).toEqual(def.surfaces?.map((s) => (s.offset === undefined ? undefined : negated(s.offset))));
      expect(mirror.duck?.offset).toBe(def.duck ? negated(def.duck.offset) : undefined);
      expect(mirror.ramps).toEqual(def.ramps);
      expect(mirror.itemRows).toEqual(def.itemRows);
      expect(mirror.secret).toBe(def.secret);
      // Asking again gives the same object, and the mirror of a mirror is the original.
      expect(mirrorTrack(def)).toBe(mirror);
      expect(mirrorTrack(mirror)).toBe(def);
    });

    it(`${def.name}: is the same road the other way round (same length, every bend reversed), and never passes close to itself`, () => {
      const a = TrackGeometry.build(def);
      const b = TrackGeometry.build(mirror);
      expect(b.length).toBeCloseTo(a.length, 3);
      for (const s of [0, a.length * 0.17, a.length * 0.5, a.length * 0.83]) {
        const p = a.at(s);
        const q = b.at(s);
        expect(q.x).toBeCloseTo(-p.x, 3);
        expect(q.z).toBeCloseTo(p.z, 3);
        expect(q.curvature).toBeCloseTo(-p.curvature, 4);
        expect(q.y).toBeCloseTo(p.y, 6);
        expect(q.bank).toBeCloseTo(-p.bank, 6);
        // A place right of the road is left of its mirror, on the other side of the world.
        const pr = a.point(s, 4);
        const qr = b.point(s, -4);
        expect(qr.x).toBeCloseTo(-pr.x, 3);
        expect(qr.z).toBeCloseTo(pr.z, 3);
      }
      const step = 4;
      for (let i = 0; i < b.samples.length; i += step) {
        for (let j = i + step; j < b.samples.length; j += step) {
          const p = b.samples[i]!;
          const q = b.samples[j]!;
          if (Math.abs(b.delta(p.s, q.s)) < 60) continue;
          expect(Math.hypot(p.x - q.x, p.z - q.z), `${def.id} mirrored at ${p.s.toFixed(0)} m and ${q.s.toFixed(0)} m`).toBeGreaterThan((p.width + q.width) / 2 + 8);
        }
      }
    });
  }

  it("finds the mirror by a flag, and by the id a race reports", () => {
    const def = TRACKS[1]!;
    expect(raceTrack(def.id, false)).toBe(def);
    expect(raceTrack(def.id, undefined)).toBe(def);
    expect(raceTrack(def.id, true)).toBe(mirrorTrack(def));
    expect(trackByRaceId(def.id)).toBe(def);
    expect(trackByRaceId(def.id + MIRROR_SUFFIX)).toBe(mirrorTrack(def));
  });
});

describe("a bot on a mirrored track", () => {
  for (const def of TRACKS) {
    it(`finishes ${def.name} in a time like the original's and stays inside the barriers`, () => {
      const times: number[] = [];
      let outside = 0;
      let offroad = 0;
      let racing = 0;
      for (const track of [def, mirrorTrack(def)]) {
        const geo = TrackGeometry.build(track);
        const r = race(track, racers(0, 1, 0.8), { laps: 2 });
        for (let i = 0; i < 60 * 240 && r.view().phase !== "finished"; i++) {
          run(r, 1);
          if (track === def) continue;
          const k = r.view().karts[0]!;
          const p = geo.project(k.x, k.z);
          outside = Math.max(outside, Math.abs(p.offset) - reach(track, p.s, p.offset));
          if (k.offroad) offroad++;
          if (r.view().phase === "racing") racing++;
        }
        expect(r.view().phase, `${track.id} finished`).toBe("finished");
        times.push(r.result()!.standings[0]!.time!);
      }
      expect(times[1]!).toBeGreaterThan(times[0]! * 0.9);
      expect(times[1]!).toBeLessThan(times[0]! * 1.1);
      expect(outside).toBeLessThanOrEqual(0);
      expect(offroad / racing).toBeLessThan(0.03);
    });
  }
});
