/**
 * The second pass on Canyon Run, Fun Fair and Glacier Pass: each uses all three engines together (an alternate route, timed
 * set pieces, an air section), the bots race them in either direction (they choose the routes, time the pieces and fly the
 * launches), and what the data promises holds: a straight landing, nothing under a flight, the branch lying clear of the main
 * road where its landmark stands, and laps of 40 to 62 s at the front.
 */
import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../track/geometry";
import { mirrorTrack } from "../track/mirror";
import { trackById } from "../track/tracks";
import { GO_TICK } from "./kart";
import { createSimRace } from "./race";
import { botField, trackStats } from "./trackStats";

const IDS = ["canyon-run", "fun-fair", "glacier-pass"];
const TIMED = ["swing", "crush", "slide", "orbit"];

describe.each(IDS)("%s, the second pass", (id) => {
  const track = trackById(id)!;
  const geo = TrackGeometry.build(track);
  const metres = (f: number) => f * geo.length;

  it("uses all three engines: an alternate route, two or more timed set pieces and an air section", () => {
    expect(track.routes?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(track.air?.length ?? 0).toBeGreaterThanOrEqual(1);
    const timed = (track.hazards ?? []).filter((h) => TIMED.includes(h.motion));
    expect(timed.length).toBeGreaterThanOrEqual(2);
    // The timed pieces tell you first: a crusher or a cart has a period long enough to read.
    for (const h of timed) expect(h.period, `${id} ${h.kind}`).toBeGreaterThanOrEqual(2.5);
  });

  it("has branches that are real roads: a landmark span on each, kept clear of the main road, with a lap of a sensible length", () => {
    for (const road of geo.routes) {
      expect(road.def.landmarks?.length ?? 0, `${id}/${road.routeDef.id} landmarks`).toBeGreaterThanOrEqual(1);
      // A branch is not hugely longer than what it replaces: a split within 1.8 times, a shortcut shorter.
      const ratio = road.realLength / (road.to - road.from);
      if (road.routeDef.kind === "shortcut") expect(ratio, `${id}/${road.routeDef.id} real over lap`).toBeLessThan(1);
      else expect(ratio, `${id}/${road.routeDef.id} real over lap`).toBeLessThan(1.8);
      // Where a span stands on it, the main road is at least 8 m from its edge through the middle half of the span.
      for (const lm of road.routeDef.landmarks ?? []) {
        if (lm.span === undefined) continue;
        const at = road.from + lm.at * (road.to - road.from);
        for (let d = -lm.span / 4; d <= lm.span / 4; d += 3) {
          const a = road.at(at + d);
          const near = geo.projectLoop(a.x, a.z).sample;
          const gap = Math.hypot(near.x - a.x, near.z - a.z) - a.width / 2 - near.width / 2;
          expect(gap, `${id}/${road.routeDef.id} ${lm.kind} ${d.toFixed(0)} m along`).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });

  it("lands each air section on a straight with nothing under the flight", () => {
    for (const a of track.air ?? []) {
      const pad = metres(a.at);
      const end = pad + a.length;
      let landing = 0;
      for (let s = end - 4; s < end + 8; s += 2) landing = Math.max(landing, Math.abs(geo.at(s).curvature));
      expect(landing, `${id} ${a.kind} landing`).toBeLessThan(a.kind === "glide" ? 1 / 20 : 1 / 30);
      const rel = (f: number) => geo.delta(pad, metres(f));
      for (const h of track.hazards ?? []) {
        const reach = h.motion === "roll" ? (h.span ?? 0.05) * geo.length : h.motion === "orbit" ? (h.span ?? 8) : h.motion === "slide" || h.motion === "cross" ? Math.abs(h.span ?? 0) : 0;
        const lo = rel(h.at) - (h.motion === "roll" ? reach : 0) - h.radius;
        const hi = rel(h.at) + h.radius;
        expect(hi > a.length - 12 && lo < a.length + 10, `${id} ${h.kind} on a ${a.kind}'s landing`).toBe(false);
        expect(hi > -6 && lo < 4, `${id} ${h.kind} on a ${a.kind}'s pad`).toBe(false);
      }
      for (const row of track.itemRows) expect(rel(row) > -2 && rel(row) < a.length + 10, `${id} item row under a ${a.kind}`).toBe(false);
      for (const pb of track.boostPads ?? []) expect(rel(pb.at) > -2 && rel(pb.at) < a.length + 4, `${id} boost pad under a ${a.kind}`).toBe(false);
    }
  });

  it.each([false, true])("is raced by eight bots, mirror %s: they fly it, take both roads between them, never fall, and finish", { timeout: 120000 }, (mirror) => {
    const t = mirror ? mirrorTrack(track) : track;
    for (const seed of [1, 2]) {
      const where = `${id} mirror ${mirror} seed ${seed}`;
      const stats = trackStats(t, { seed });
      expect(stats.finished, `${where} finished`).toBe(true);
      expect(stats.jumps / (8 * 3), `${where} flights per kart-lap`).toBeGreaterThanOrEqual(track.air!.length * 0.8);
      expect(stats.fallRate, `${where} falls`).toBeLessThan(0.1);
      expect(stats.bestLap, where).toBeGreaterThanOrEqual(40);
      expect(stats.bestLap, where).toBeLessThanOrEqual(62);
      expect(stats.worstLap, where).toBeLessThanOrEqual(75);
      expect(stats.hazardHits / (8 * 3), `${where} hits per kart-lap`).toBeLessThan(0.5);
      expect(stats.offroad, `${where} off the road`).toBeLessThan(0.02);
    }
    // Between them the bots drive the branch and the main road both, and every glide is flown.
    const race = createSimRace({ track: t, laps: 3, seed: 3, racers: botField() });
    const g = planOf(t);
    const onRoute = new Set<number>();
    const onMain = new Set<number>();
    let gliding = 0;
    while (race.tick < GO_TICK + 60 * 200 && race.view().phase !== "finished") {
      race.step(new Map());
      const view = race.view();
      for (const k of view.karts) {
        const p = g.project(k.x, k.z, k.lapProgress * g.length);
        (p.route === 0 ? onMain : onRoute).add(k.id);
        if ((k.glide ?? 0) > 0) gliding++;
      }
    }
    expect(race.view().phase).toBe("finished");
    expect(onRoute.size, `${id} someone drives the branch`).toBeGreaterThan(0);
    expect(onMain.size, `${id} someone drives the main road`).toBeGreaterThan(0);
    if ((track.air ?? []).some((a) => a.kind === "glide")) expect(gliding, `${id} the glide is flown`).toBeGreaterThan(60 * 8);
  });
});

function planOf(t: ReturnType<typeof trackById>): TrackGeometry {
  return TrackGeometry.build(t);
}
