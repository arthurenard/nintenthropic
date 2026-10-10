/**
 * The corridor test again, with the Blender art in place of the code-built stand-ins, on every track and on its mirror.
 *
 * At run time the modelled landmarks (landmark.<kind>) and scenery (scenery.<kind>.<n>) of public/assets/kart/world-<theme>.glb
 * replace the code-built shapes the placement was worked out with, and they are not the same size. corridor.test.ts cannot see
 * them, so this loads the real files (nodeArt.ts decodes the Draco geometry in Node), files them where art.ts would, and
 * measures the drivable area with the same probe (corridorProbe.ts): nothing visible and solid stands on the road, on the
 * verge out to the barrier, or within a camera's width beyond it, and the ground stays at the road's height.
 *
 * Fix an offender by moving the picture (the landmark's offset, a scenery footprint, the model in art/kart/world/), never the
 * sim. CORRIDOR_REPORT=1 prints every offender with how far it must move, and which landmarks have no art yet (their stand-in
 * is measured instead).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Object3D } from "three";
import { mirrorTrack } from "../../track/mirror";
import { TRACKS } from "../../track/tracks";
import { measureTrack, type Offender } from "./corridorProbe";
import { loadWorldArt } from "./nodeArt";

// What art.ts would hold: swapped for the theme under test before each measurement.
const nodes = vi.hoisted(() => new Map<string, Object3D>());
vi.mock("../art", () => ({
  artNode: (name: string) => nodes.get(name)?.clone(true) ?? null,
  hasArt: (name: string) => nodes.has(name),
  artNames: (prefix: string) => [...nodes.keys()].filter((n) => n.startsWith(prefix)).sort(),
}));

const REPORT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CORRIDOR_REPORT;

const worlds = new Map<string, Map<string, Object3D>>();
beforeAll(async () => {
  for (const theme of new Set(TRACKS.map((t) => t.theme))) worlds.set(theme, await loadWorldArt(theme));
}, 60_000);

const line = (o: Offender) => `${o.what}: ${o.height.toFixed(1)} m over the road, ${o.beyond.toFixed(1)} m beyond the edge at s=${o.s.toFixed(0)} (${o.at?.map((v) => v.toFixed(0)).join(", ")}), must move ${o.depth.toFixed(1)} m`;

describe("the modelled worlds' files", () => {
  it("load, with landmarks in them", () => {
    for (const theme of new Set(TRACKS.map((t) => t.theme))) {
      const art = worlds.get(theme)!;
      expect([...art.keys()].some((n) => n.startsWith("landmark.")), `${theme}'s world file has landmarks`).toBe(true);
    }
  });

  it("model the landmarks the tracks stand (a missing one is measured as its code-built stand-in)", () => {
    const missing: string[] = [];
    for (const def of TRACKS) {
      const art = worlds.get(def.theme)!;
      for (const kind of new Set((def.landmarks ?? []).map((l) => l.kind))) if (!art.has(`landmark.${kind}`)) missing.push(`${def.id}: ${kind}`);
    }
    if (REPORT) console.log(`landmarks without art (their stand-ins are measured):\n   ${missing.join("\n   ")}`);
    expect(missing.length).toBeLessThan(TRACKS.reduce((n, t) => n + (t.landmarks?.length ?? 0), 0));
  });
});

describe("the drivable area, with the Blender art", () => {
  for (const base of TRACKS) {
    for (const def of [base, mirrorTrack(base)]) {
      it(`${def.id}: nothing solid on the road or the verge, none within a camera's width of the barrier, 5 m clear overhead`, () => {
        nodes.clear();
        for (const [name, node] of worlds.get(def.theme)!) nodes.set(name, node);
        const report = measureTrack(def);
        if (REPORT) {
          console.log(`${def.id}: ground rise ${report.groundRise?.height.toFixed(2)} m; ${report.solids.length} solids`);
          for (const o of report.solids) console.log(`   ${line(o)}`);
        }
        expect(report.groundRise?.height ?? -1, "the ground rises into the way").toBeLessThanOrEqual(0.6);
        expect(report.solids.map(line)).toEqual([]);
        // The world cuts a span landmark where it would stand in another stretch's ground; a modelled one is placed (or modelled) to need no cut.
        expect(report.cuts, "modelled landmarks that had to be cut").toEqual([]);
      }, 120_000);
    }
  }
});
