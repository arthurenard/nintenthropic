/**
 * The launch and air sections of the three air tracks: each flight clears what is under it, lands on a straight with
 * nothing in the way, and the bots really fly them (in the mirror too).
 */
import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../track/geometry";
import { mirrorTrack } from "../track/mirror";
import { trackById } from "../track/tracks";
import { trackStats } from "./trackStats";

const IDS = ["volcano-rush", "starlight-ribbon", "five-finger-circuit"];

describe.each(IDS)("%s air sections", (id) => {
  const track = trackById(id)!;
  const geo = TrackGeometry.build(track);
  const metres = (f: number) => f * geo.length;

  it("has at least one, each with a straight landing and nothing in the way from the pad to the landing", () => {
    expect(track.air?.length ?? 0).toBeGreaterThan(0);
    for (const a of track.air ?? []) {
      const pad = metres(a.at);
      const end = pad + a.length;
      let landing = 0;
      for (let s = end - 4; s < end + 8; s += 2) landing = Math.max(landing, Math.abs(geo.at(s).curvature));
      expect(landing, `${id} ${a.kind} landing`).toBeLessThan(a.kind === "glide" ? 1 / 20 : 1 / 30);
      // Where things sit relative to the pad (m along the road; the flight runs 0 to its length).
      const rel = (f: number) => geo.delta(pad, metres(f));
      for (const h of track.hazards ?? []) {
        const reach = h.motion === "roll" ? (h.span ?? 0.05) * geo.length : h.motion === "orbit" ? (h.span ?? 8) : 0;
        // The hazard's own stretch of road must not overlap the landing run (the flight's last 12 m and 10 m past it) or the pad.
        const lo = rel(h.at) - reach - h.radius;
        const hi = rel(h.at) + h.radius + (h.motion === "orbit" ? reach : 0);
        const touchesLanding = hi > a.length - 12 && lo < a.length + 10;
        const touchesPad = hi > -6 && lo < 4;
        expect(touchesLanding || touchesPad, `${id} ${h.kind} at ${h.at} on a ${a.kind}'s pad or landing`).toBe(false);
      }
      for (const row of track.itemRows) expect(rel(row) > -2 && rel(row) < a.length + 10, `${id} item row under a ${a.kind}`).toBe(false);
      for (const pb of track.boostPads ?? []) expect(rel(pb.at) > -2 && rel(pb.at) < a.length + 4, `${id} boost pad under a ${a.kind}`).toBe(false);
    }
  });

  it.each([false, true])("is flown by eight bots, mirror %s: they jump, never fall, and finish", { timeout: 90000 }, (mirror) => {
    const t = mirror ? mirrorTrack(track) : track;
    for (const seed of [1, 2, 3]) {
      const stats = trackStats(t, { seed });
      const where = `${id} mirror ${mirror} seed ${seed}`;
      expect(stats.finished, `${where} finished`).toBe(true);
      expect(stats.jumps / (8 * 3), where).toBeGreaterThanOrEqual(track.air!.length * 0.8);
      expect(stats.fallRate, where).toBeLessThan(0.15);
      expect(stats.worstLap, where).toBeLessThanOrEqual(85);
    }
  });
});
