import { describe, expect, it } from "vitest";
import { openingOf, placeholderRoad, shippedRoad } from "./testkit";
import { LANE_REACH, OPENING_REACH } from "./tuning";
import { SURPRISES } from "./types";
import { fogFor, sightFor, waveSpec } from "./waves";

/**
 * How the night's first waves open: the road is not empty while the wave
 * begins. The first of the dead is in view within a second of the title card
 * going, a few come together, from places that already hide them, and the
 * first reaches the barricade in a little over twenty seconds, not the
 * better part of a minute. From wave 4 on the night is as it was designed.
 */
const road = (await shippedRoad()) ?? placeholderRoad();
const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
const difficulties = ["standard", "relaxed"] as const;

describe("the first waves' opening", () => {
  it("has the first of the dead in view within a second of the wave starting, and three of them in play within three", () => {
    for (const difficulty of difficulties) {
      for (const wave of [1, 2, 3]) {
        for (const seed of seeds) {
          const o = openingOf(seed, wave, { difficulty, road, seconds: 10 });
          const why = `${difficulty} wave ${wave} seed ${seed}`;
          expect(o.firstInView, why).toBeGreaterThanOrEqual(0);
          expect(o.firstInView, why).toBeLessThanOrEqual(1);
          expect(o.together, why).toBe(waveSpec(wave).opening.length);
          expect(o.together, why).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("comes by the bus first, which is in view at once: out of cover, not out of the open", () => {
    for (const wave of [1, 2, 3]) {
      const o = openingOf(1, wave, { road, seconds: 3 });
      expect(o.spawns[0]).toMatchObject({ lane: "bus", kind: "walker" });
      expect(o.spawns[0]!.at).toBeLessThan(0.5);
    }
  });

  it("begins closer in than the 62 m every lane began at, and is on the barricade much sooner", () => {
    for (const difficulty of difficulties) {
      const rows = seeds.map((seed) => openingOf(seed, 1, { difficulty, road, seconds: 60 }));
      const first = rows.map((o) => o.firstAtBarricade);
      for (const [i, o] of rows.entries()) {
        const near = o.spawns.slice(0, 3);
        expect(near.map((s) => s.lane), `seed ${i + 1}`).toEqual(["bus", "road", "booth"]);
        const mean = near.reduce((a, s) => a + s.distance, 0) / near.length;
        expect(mean, `seed ${i + 1}`).toBeLessThan(55);
        // The phone booth is 22 m out; the bus is 44 m.
        expect(Math.min(...near.map((s) => s.distance))).toBeLessThan(25);
      }
      // Walkers set off at 0.5-1.4 m/s on this wave (0.8 of the pace of the third): the booth's, 17 m of road,
      // reaches the barricade after 15-30 s on Standard and 28-58 s on Relaxed
      // (13-27 s and 17-38 s with the dead as slow as they first were; 58 s and 76 s from 62 m).
      expect(Math.min(...first), difficulty).toBeGreaterThan(8);
      expect(Math.max(...first), difficulty).toBeLessThan(difficulty === "standard" ? 35 : 65);
    }
  });

  it("never shows one appear in the open: each begins in a surprise's cover, in the corn, or out in the fog", () => {
    // A figure is first seen no clearer than half: an exponential-squared fog is that thick at 0.7 of its reach.
    const unseen = Math.SQRT1_2;
    for (let wave = 1; wave <= 12; wave++) {
      for (const seed of [1, 2, 3, 4]) {
        for (const spawn of openingOf(seed, wave, { road, seconds: 40 }).spawns) {
          const why = `wave ${wave} seed ${seed}: ${spawn.kind} by the ${spawn.lane} at ${spawn.distance.toFixed(0)} m`;
          const hidden = SURPRISES.includes(spawn.lane) || spawn.cover > 0 || spawn.distance >= unseen * sightFor(fogFor(wave));
          expect(hidden, why).toBe(true);
        }
      }
    }
  });

  it("starts the corn's and the tree line's dead where the lane hides them, closer in than the rest", () => {
    expect(OPENING_REACH.corn).toBeLessThan(LANE_REACH);
    expect(OPENING_REACH.trees).toBeLessThan(LANE_REACH);
    for (const seed of seeds) {
      const spawns = openingOf(seed, 3, { road, seconds: 3 }).spawns.slice(0, 3);
      expect(spawns.map((s) => s.lane)).toEqual(["bus", "trees", "corn"]);
      const trees = spawns[1]!;
      const corn = spawns[2]!;
      expect(trees.distance).toBeLessThanOrEqual(OPENING_REACH.trees! + 1);
      expect(corn.distance).toBeLessThanOrEqual(OPENING_REACH.corn! + 1);
      // The corn still hides it for what is left of its way through it (16 m on the shipped road, not 38).
      expect(corn.cover).toBeGreaterThan(8);
      expect(corn.cover).toBeLessThan(30);
    }
  });

  it("leaves the night from wave 4 on as it was designed: nothing opens, everything sets off at the fog's reach, at the wave's own gaps", () => {
    for (const wave of [4, 5, 7, 8, 10]) {
      const spec = waveSpec(wave);
      expect(spec.opening, `wave ${wave}`).toEqual([]);
      const o = openingOf(2, wave, { road, seconds: 30 });
      for (const s of o.spawns) {
        if (!SURPRISES.includes(s.lane)) expect(s.distance, `wave ${wave} ${s.lane}`).toBeGreaterThan(LANE_REACH - 3);
      }
      // One at a time, a gap apart (the clock runs at 30 Hz).
      expect(o.spawns[1]!.at - o.spawns[0]!.at, `wave ${wave}`).toBeGreaterThanOrEqual(spec.gap[0] - 0.05);
    }
  });
});
