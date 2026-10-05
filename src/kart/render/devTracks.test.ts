import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../track/geometry";
import { DEV_TRACKS, turtle } from "./devTracks";
import { THEME_HAZARDS, THEME_LANDMARKS } from "./world/landmarks";

describe("turtle", () => {
  it("closes a loop whose moves bring it back", () => {
    const pts = turtle([["s", 100], ["a", 90, 50], ["s", 100], ["a", 90, 50], ["s", 100], ["a", 90, 50], ["s", 100], ["a", 90, 50]]);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    // The last point is a step from the first, not on top of it.
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeGreaterThan(5);
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeLessThan(40);
  });
});

describe("the dev tracks", () => {
  for (const def of DEV_TRACKS) {
    describe(def.id, () => {
      const g = TrackGeometry.build(def);

      it("is a sensible length and never passes close to itself", () => {
        expect(g.length).toBeGreaterThan(700);
        expect(g.length).toBeLessThan(2200);
        let closest = Infinity;
        for (let i = 0; i < g.samples.length; i += 4) {
          for (let j = i + 1; j < g.samples.length; j += 4) {
            const along = Math.min(j - i, g.samples.length - (j - i)) * g.spacing;
            if (along < 120) continue;
            const a = g.samples[i]!;
            const b = g.samples[j]!;
            closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
          }
        }
        // Road width plus both barriers and a little room, so no two parts of the lap share a wall.
        expect(closest).toBeGreaterThan(def.width + 2 * 6 + 20);
      });

      it("uses only landmarks and hazards its world has names for", () => {
        const names = THEME_LANDMARKS[def.theme] ?? [];
        for (const l of def.landmarks ?? []) expect(names, `${l.kind}`).toContain(l.kind);
        const kinds = (THEME_HAZARDS[def.theme] ?? []).map((h) => h.kind);
        for (const h of def.hazards ?? []) expect(kinds, `${h.kind}`).toContain(h.kind);
      });

      it("uses every feature", () => {
        expect(def.ramps?.length).toBeGreaterThan(0);
        expect(def.drops?.length).toBeGreaterThan(0);
        expect(def.surfaces?.length).toBeGreaterThan(0);
        expect(def.hazards?.length).toBeGreaterThan(0);
        expect(def.landmarks?.length).toBeGreaterThan(5);
        expect(def.duck).toBeDefined();
        expect(def.bank).toBeGreaterThan(0);
      });
    });
  }
});
