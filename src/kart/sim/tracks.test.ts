/**
 * The tracks as a set: each is complete (a blurb, a duck, landmarks from its
 * theme's list, item rows, a lap of the right length), its features are laid
 * out so that they can be driven (a straight run-up to a jump, nothing on the
 * grid), and eight bots really do race it: three laps, none stuck, hardly a
 * fall.
 */
import { describe, expect, it } from "vitest";
import { TrackGeometry, inStretch, type TrackTheme } from "../track/geometry";
import { CUPS, TRACKS, trackById } from "../track/tracks";
import { planFor } from "./plan";
import { trackStats } from "./trackStats";

/** What each theme can build (docs/GRIP_PRIX.md, "What each theme can build"). */
const LANDMARKS: Record<TrackTheme, string[]> = {
  meadow: ["windmill", "barn", "pond", "hay-bales", "hot-air-balloon", "sheep", "flower-field"],
  canyon: ["mesa", "rock-arch", "cactus-grove", "water-tower", "mine-cart"],
  harbour: ["crane", "lighthouse", "ship", "containers", "warehouse", "buoy"],
  kitchen: ["teapot", "fruit-bowl", "toaster", "grater", "salt-shaker", "pepper-mill", "cookbook", "cereal-box", "mug", "fork-arch", "spoon-arch", "sink", "window", "wall-clock"],
  snow: ["igloo", "cabin", "snowman", "ice-arch", "ice-cave", "pine-snow", "gondola", "ski-jump"],
  volcano: ["volcano", "lava-fall", "basalt-columns", "stone-bridge", "obsidian-arch", "hot-spring"],
  funfair: ["ferris-wheel", "carousel", "big-top", "rollercoaster", "entrance-arch", "food-stall", "balloon-stand", "hook-a-duck", "helter-skelter", "fireworks"],
  space: ["ringed-planet", "ring-gate", "asteroid", "satellite", "space-station", "nebula"],
  palm: ["palm-tree", "beach-hut", "surfboard", "sandcastle", "beach-towel", "giant-ring", "wristwatch"],
};
const HAZARDS: Record<TrackTheme, string[]> = {
  meadow: [],
  canyon: ["boulder", "tumbleweed", "ore-cart", "wrecking-ball", "rock-crusher"],
  harbour: ["crab", "forklift"],
  kitchen: ["orange", "pea", "teacup"],
  snow: ["penguin", "snowball", "yeti", "icicle"],
  volcano: ["fireball", "boulder", "geyser"],
  funfair: ["teacup-ride", "bumper-car", "arm-ball", "funhouse-panel", "mallet", "swing-boat"],
  space: ["asteroid", "comet"],
  palm: ["crab", "coconut", "beach-ball"],
};

describe("the cups", () => {
  it("are two of four tracks in the order they are raced, with the secret one apart", () => {
    expect(CUPS.map((cup) => cup.name)).toEqual(["Acorn Cup", "Comet Cup"]);
    expect(CUPS[0]!.tracks).toEqual(["meadow-loop", "kitchen-rally", "harbour-lights", "canyon-run"]);
    expect(CUPS[1]!.tracks).toEqual(["fun-fair", "glacier-pass", "volcano-rush", "starlight-ribbon"]);
    for (const cup of CUPS) for (const id of cup.tracks) expect(trackById(id).id).toBe(id);
    expect(TRACKS.map((t) => t.id)).toEqual([...CUPS.flatMap((c) => c.tracks), "five-finger-circuit"]);
    expect(TRACKS.filter((t) => t.secret).map((t) => t.id)).toEqual(["five-finger-circuit"]);
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
  });
});

describe.each(TRACKS)("$name", (track) => {
  const plan = planFor(track);
  const geo: TrackGeometry = plan.geo;
  const metres = (fraction: number) => fraction * geo.length;

  it("is complete: a lap of 0.9 to 1.5 km, a blurb, a duck, 12 to 30 landmarks of its theme, three or four item rows", () => {
    expect(geo.length).toBeGreaterThan(900);
    expect(geo.length).toBeLessThan(1500);
    expect(track.laps).toBe(3);
    expect((track.blurb ?? "").length).toBeGreaterThan(40);
    expect(track.duck).toBeDefined();
    const landmarks = track.landmarks ?? [];
    expect(landmarks.length).toBeGreaterThanOrEqual(12);
    expect(landmarks.length).toBeLessThanOrEqual(30);
    for (const l of landmarks) expect(LANDMARKS[track.theme], `${track.id}: ${l.kind}`).toContain(l.kind);
    for (const h of track.hazards ?? []) expect(HAZARDS[track.theme], `${track.id}: ${h.kind}`).toContain(h.kind);
    expect(track.itemRows.length).toBeGreaterThanOrEqual(3);
    expect(track.itemRows.length).toBeLessThanOrEqual(4);
    const lifts = (track.boostPads?.length ?? 0) + (track.surfaces ?? []).filter((s) => s.kind === "boost").length;
    expect(lifts).toBeGreaterThanOrEqual(2);
    // Every fraction is a fraction.
    const fractions = [
      ...track.itemRows,
      ...(track.boostPads ?? []).map((p) => p.at),
      ...(track.ramps ?? []).map((r) => r.at),
      ...(track.hazards ?? []).map((h) => h.at),
      ...landmarks.map((l) => l.at),
      track.duck!.at,
    ];
    for (const f of fractions) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the start line and the grid clear: nothing but road for 48 m before it and 18 m after", () => {
    const near = (s: number) => {
      const d = geo.delta(0, s);
      return d > -48 && d < 18;
    };
    for (let s = -48; s <= 18; s += 2) {
      const f = geo.wrap(s) / geo.length;
      for (const drop of track.drops ?? []) expect(inStretch(f, drop), `${track.id} drop at ${s}`).toBe(false);
      for (const surface of track.surfaces ?? []) if (surface.kind !== "boost") expect(inStretch(f, surface), `${track.id} ${surface.kind} at ${s}`).toBe(false);
      for (const verge of track.verges ?? []) expect(inStretch(f, verge), `${track.id} verge at ${s}`).toBe(false);
    }
    for (const h of track.hazards ?? []) {
      const roams = h.motion === "roll" ? (h.span ?? 0.05) * geo.length : h.motion === "orbit" ? (h.span ?? 8) : 0;
      expect(near(metres(h.at)) || near(metres(h.at) - roams) || near(metres(h.at) + roams), `${track.id} ${h.kind}`).toBe(false);
    }
    for (const r of track.ramps ?? []) expect(near(metres(r.at))).toBe(false);
    // The grid itself is straight: eight karts, 26 m behind the line.
    for (let s = -30; s <= 0; s += 2) expect(Math.abs(geo.at(s).curvature), `${track.id} grid`).toBeLessThan(1 / 40);
  });

  it("gives each jump a straight run-up and a landing, clear of hazards and item boxes", () => {
    for (const ramp of track.ramps ?? []) {
      const lip = metres(ramp.at);
      const gap = (track.drops ?? []).find((d) => d.gap && geo.delta(lip, metres(d.from)) > 0 && geo.delta(lip, metres(d.from)) < 4);
      // A bend shortly before is fine for a jump with no gap, but a gap needs a run-up of 80 m that is nearly straight...
      const need = gap ? 80 : 40;
      let sharpest = 0;
      for (let s = lip - need; s < lip; s += 2) sharpest = Math.max(sharpest, Math.abs(geo.at(s).curvature));
      expect(sharpest, `${track.id} run-up to ${lip.toFixed(0)}`).toBeLessThan(1 / 80);
      if (gap) {
        const length = metres(gap.to) - metres(gap.from);
        expect(length, `${track.id} gap`).toBeLessThanOrEqual(22);
        expect(length).toBeGreaterThanOrEqual(11);
        // ...and a landing of 30 m before the road bends.
        let landing = 0;
        for (let s = metres(gap.to); s < metres(gap.to) + 30; s += 2) landing = Math.max(landing, Math.abs(geo.at(s).curvature));
        expect(landing, `${track.id} landing`).toBeLessThan(1 / 60);
        // Nothing to hit on the way in or out.
        for (const h of track.hazards ?? []) {
          const d = geo.delta(metres(h.at), lip);
          const reach = h.motion === "roll" ? (h.span ?? 0.05) * geo.length : h.motion === "orbit" ? (h.span ?? 8) : 0;
          expect(d > 70 + 1 || d < -(metres(gap.to) - lip + 30) - reach, `${track.id} ${h.kind} too near the jump (${d.toFixed(0)} m, rolls ${reach.toFixed(0)})`).toBe(true);
        }
        for (const row of track.itemRows) expect(Math.abs(geo.delta(metres(row), lip + 8)), `${track.id} item row on the jump`).toBeGreaterThan(14);
      }
    }
  });

  it("keeps the ramp's wedge (16 m up to the lip) clear of pads, strips and item boxes, and its hazards over the road, off every open edge", () => {
    for (const ramp of track.ramps ?? []) {
      const lip = metres(ramp.at);
      const onWedge = (s: number) => {
        const d = geo.delta(s, lip);
        return d > -2 && d < 20;
      };
      for (const pad of track.boostPads ?? []) expect(onWedge(metres(pad.at)), `${track.id} pad on the wedge`).toBe(false);
      for (const row of track.itemRows) expect(onWedge(metres(row)), `${track.id} item row on the wedge`).toBe(false);
      for (const strip of (track.surfaces ?? []).filter((x) => x.kind === "boost")) {
        for (let s = metres(strip.from); geo.delta(s, metres(strip.to)) > 0; s += 2) expect(onWedge(s), `${track.id} strip on the wedge`).toBe(false);
      }
    }
    const drops = (track.drops ?? []).filter((d) => !d.gap);
    for (const h of track.hazards ?? []) {
      // Where the hazard goes along the lap.
      const from = h.motion === "roll" ? h.at - (h.span ?? 0.05) : h.at;
      let overEdge = false;
      for (let f = from; f <= h.at + 1e-9; f += 0.002) if (drops.some((d) => inStretch(f, d))) overEdge = true;
      if (!overEdge) continue;
      const half = geo.at(h.at * geo.length).width / 2;
      const reach =
        h.motion === "cross" ? (h.span ?? half + 1) + Math.abs(h.offset ?? 0) + h.radius : h.motion === "orbit" ? (h.span ?? 8) + Math.abs(h.offset ?? 0) + h.radius : Math.abs(h.offset ?? 0) + h.radius;
      expect(reach, `${track.id} ${h.kind} reaches past the road`).toBeLessThanOrEqual(half);
    }
  });

  it("makes its verge cuts worth driving: reachable, and short enough for a Nitro", () => {
    const wide = (track.verges ?? []).filter((v) => v.distance >= 12);
    expect(plan.cuts.length).toBe(wide.length);
    for (const cut of plan.cuts) {
      expect(cut.len).toBeLessThan(40);
      expect(geo.wrap(cut.to - cut.from) / cut.len).toBeGreaterThan(2);
    }
  });

  it("is raced by eight bots: three laps of 40 to 62 s at the front and no more than 75 s at the back, no one stuck, hardly a fall, no ride on the grass", { timeout: 60000 }, () => {
    for (const seed of [1, 2]) {
      const stats = trackStats(track, { seed });
      const where = `${track.id} seed ${seed}`;
      expect(stats.finished, `${where} finished`).toBe(true);
      expect(stats.bestLap, where).toBeGreaterThanOrEqual(40);
      expect(stats.bestLap, where).toBeLessThanOrEqual(62);
      expect(stats.worstLap, where).toBeLessThanOrEqual(75);
      expect(stats.stuck, `${where} stuck`).toBeLessThan(5);
      expect(stats.fallRate, `${where} falls (${stats.fallAt.join(", ")})`).toBeLessThanOrEqual(track.theme === "space" ? 0.2 : 0.1);
      expect(stats.offroad, `${where} off the road`).toBeLessThan(0.02);
      expect(stats.last - stats.first, `${where} spread`).toBeLessThan(25);
      // The features are used.
      if ((track.ramps ?? []).length > 0) expect(stats.jumps, where).toBeGreaterThanOrEqual(20);
      if ((track.hazards ?? []).length > 0) expect(stats.hazardHits / (8 * 3), `${where} hazard hits per kart-lap`).toBeLessThan(0.5);
    }
  });
});

describe("Five Finger Circuit", () => {
  const track = trackById("five-finger-circuit");
  const geo = planFor(track).geo;

  it("reads as an open hand from above: four fingers and a thumb standing out of a palm, on a wrist", () => {
    // Heights (z, north on the minimap) along the lap; the peaks that stand clear of what lies between them and the next higher are the fingertips.
    const step = 3;
    const z: number[] = [];
    for (let s = 0; s < geo.length; s += step) z.push(geo.at(s).z);
    const n = z.length;
    const peaks: { i: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      // Highest within 20 m either way.
      let top = true;
      for (let k = -7; k <= 7; k++) if (z[(i + k + n) % n]! > z[i]! + 1e-9) top = false;
      if (!top) continue;
      // Stands 25 m clear of the lowest road between it and the next peak either way round (a finger's valley).
      let lowRight = z[i]!;
      for (let k = 1; k < n / 2; k++) {
        const v = z[(i + k) % n]!;
        lowRight = Math.min(lowRight, v);
        if (v > z[i]! + 1e-9) break;
      }
      let lowLeft = z[i]!;
      for (let k = 1; k < n / 2; k++) {
        const v = z[(i - k + n) % n]!;
        lowLeft = Math.min(lowLeft, v);
        if (v > z[i]! + 1e-9) break;
      }
      if (z[i]! - Math.max(lowLeft, lowRight) >= 25) peaks.push({ i, z: z[i]! });
    }
    expect(peaks.length).toBe(5);
    const tips = peaks.map((p) => p.z).sort((a, b) => b - a);
    // Four fingers close in height, and a thumb well below them.
    expect(tips[0]! - tips[3]!).toBeLessThan(45);
    expect(tips[3]! - tips[4]!).toBeGreaterThan(40);
    // The fingers stand side by side across the page, and the thumb off to one side of them.
    const across = peaks
      .map((p) => ({ x: geo.at(p.i * step).x, z: p.z }))
      .sort((a, b) => b.z - a.z)
      .slice(0, 4)
      .map((p) => p.x)
      .sort((a, b) => a - b);
    for (let i = 1; i < 4; i++) expect(across[i]! - across[i - 1]!).toBeGreaterThan(40);
    // Wider across the palm than the wrist, and about as tall as it is wide.
    const xs = geo.samples.map((s) => s.x);
    const zs = geo.samples.map((s) => s.z);
    const wide = Math.max(...xs) - Math.min(...xs);
    const tall = Math.max(...zs) - Math.min(...zs);
    expect(tall / wide).toBeGreaterThan(0.9);
    expect(tall / wide).toBeLessThan(1.5);
    // It starts at the wrist: low on the page, heading up it.
    expect(geo.heading(0)).toBeCloseTo(0, 1);
    expect(geo.at(0).z).toBeLessThan(Math.min(...peaks.map((p) => p.z)) - 100);
  });

  it("is secret, sunny, and has its giant wristwatch for a start gantry", () => {
    expect(track.secret).toBe(true);
    expect(track.theme).toBe("palm");
    const watch = (track.landmarks ?? []).find((l) => l.kind === "wristwatch")!;
    expect(watch.at).toBe(0);
    expect(watch.span).toBeGreaterThan(8);
    expect((track.landmarks ?? []).some((l) => l.kind === "giant-ring")).toBe(true);
  });
});
