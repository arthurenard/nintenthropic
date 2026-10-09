import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../track/geometry";
import { MEADOW_LOOP } from "../track/tracks";
import { createDemoRace } from "./demo";
import { findLandmark, kartAt, parseShot, resolvePoint, shotView, toScreen, type Shot } from "./shot";

const g = TrackGeometry.build(MEADOW_LOOP);

describe("shot poses", () => {
  it("finds a landmark by kind, or by kind#n", () => {
    const windmill = MEADOW_LOOP.landmarks!.find((l) => l.kind === "windmill")!;
    expect(findLandmark(MEADOW_LOOP, "windmill")).toEqual({ at: windmill.at, offset: windmill.offset });
    const second = MEADOW_LOOP.landmarks!.filter((l) => l.kind === "barn")[1]!;
    expect(findLandmark(MEADOW_LOOP, "barn#1")).toEqual({ at: second.at, offset: second.offset });
    expect(findLandmark(MEADOW_LOOP, "no-such-thing")).toBeUndefined();
  });

  it("puts a point on the road, along it, beside it and above it", () => {
    const on = resolvePoint(g, MEADOW_LOOP, { at: 0.3 });
    const c = g.at(0.3 * g.length);
    expect(on.x).toBeCloseTo(c.x, 6);
    expect(on.z).toBeCloseTo(c.z, 6);
    const ahead = resolvePoint(g, MEADOW_LOOP, { at: 0.3, d: 10, up: 2 });
    expect(Math.hypot(ahead.x - on.x, ahead.z - on.z)).toBeGreaterThan(9.5);
    expect(ahead.y).toBeCloseTo(g.at(0.3 * g.length + 10).y + 2, 6);
    // Right of the centre line is the offset's positive side.
    const right = resolvePoint(g, MEADOW_LOOP, { at: 0.3, off: 5 });
    expect((right.x - c.x) * -c.tz + (right.z - c.z) * c.tx).toBeCloseTo(5, 5);
  });

  it("starts a landmark's point at the landmark, and takes absolute coordinates over", () => {
    const l = MEADOW_LOOP.landmarks!.find((m) => m.kind === "windmill")!;
    const w = g.point(l.at * g.length, l.offset);
    const p = resolvePoint(g, MEADOW_LOOP, { lm: "windmill", up: 10 });
    expect(p.x).toBeCloseTo(w.x, 6);
    expect(p.z).toBeCloseTo(w.z, 6);
    expect(p.y).toBeCloseTo(w.y + 10, 6);
    expect(resolvePoint(g, MEADOW_LOOP, { lm: "windmill", x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
    expect(() => resolvePoint(g, MEADOW_LOOP, { lm: "volcano" })).toThrow();
  });

  it("runs a kart up to its place: back in time it was further back along the road, at its own speed", () => {
    const shot: Shot = { eye: {}, target: {}, at: 0.5, pre: 1 };
    const there = kartAt(g, shot, { id: 0, d: 4, speed: 20, off: 2 }, 0);
    const before = kartAt(g, shot, { id: 0, d: 4, speed: 20, off: 2 }, 1);
    expect(there.s).toBeCloseTo(0.5 * g.length + 4, 6);
    expect(there.s - before.s).toBeCloseTo(20, 6);
    expect(there.offset).toBe(2);
    expect(there.view.heading).toBeCloseTo(g.heading(there.s), 6);
  });

  it("drifts the way the road bends when asked to, and lifts a kart that is up", () => {
    // The Meadow Loop's hairpin: find a stretch that really bends.
    let s = 0;
    for (let i = 0; i < g.length; i += 2) if (Math.abs(g.at(i).curvature) > Math.abs(g.at(s).curvature)) s = i;
    const bend = g.at(s).curvature;
    const k = kartAt(g, { eye: {}, target: {} }, { id: 1, at: s / g.length, drift: "auto", level: 2 }, 0);
    expect(k.view.drift).toBe(Math.sign(bend));
    expect(k.view.driftLevel).toBe(2);
    expect(Math.sign(k.view.steer ?? 0)).toBe(Math.sign(bend));
    const flying = kartAt(g, { eye: {}, target: {} }, { id: 2, up: 3 }, 0);
    expect(flying.view.hop).toBeCloseTo(3.4, 6);
  });
});

describe("shot projection", () => {
  const eye = { x: 0, y: 1, z: 0 };

  it("puts what the camera looks at in the middle, and what is behind it at a negative depth", () => {
    const look = { x: 0, y: 1, z: 20 };
    const mid = toScreen(eye, look, 55, 0, look);
    expect(mid.x).toBeCloseTo(0.5, 6);
    expect(mid.y).toBeCloseTo(0.5, 6);
    expect(mid.depth).toBeCloseTo(20, 6);
    expect(toScreen(eye, look, 55, 0, { x: 0, y: 1, z: -5 }).depth).toBeLessThan(0);
  });

  it("puts the left of the view on the left of the picture (facing +z, left is +x)", () => {
    const look = { x: 0, y: 1, z: 20 };
    expect(toScreen(eye, look, 55, 0, { x: 3, y: 1, z: 20 }).x).toBeLessThan(0.5);
    expect(toScreen(eye, look, 55, 0, { x: -3, y: 1, z: 20 }).x).toBeGreaterThan(0.5);
    expect(toScreen(eye, look, 55, 0, { x: 0, y: 4, z: 20 }).y).toBeLessThan(0.5);
  });

  it("with a positive roll lifts the horizon on the right", () => {
    const look = { x: 0, y: 1, z: 20 };
    const left = toScreen(eye, look, 55, 20, { x: 5, y: 1, z: 20 });
    const right = toScreen(eye, look, 55, 20, { x: -5, y: 1, z: 20 });
    expect(right.y).toBeLessThan(left.y);
  });

  it("sizes a metre by the field of view", () => {
    const look = { x: 0, y: 1, z: 20 };
    const wide = toScreen(eye, look, 90, 0, look).px;
    const narrow = toScreen(eye, look, 30, 0, look).px;
    expect(narrow).toBeGreaterThan(wide);
  });
});

describe("the shot parameter", () => {
  it("reads a pose, and nothing else", () => {
    expect(parseShot('{"eye":{"d":1},"target":{"up":2},"fov":50}')?.fov).toBe(50);
    expect(parseShot("not json")).toBeNull();
    expect(parseShot('{"eye":{}}')).toBeNull();
    expect(parseShot(null)).toBeNull();
  });

  it("leaves the item boxes out when asked, by taking them (a taken box is not drawn), not by removing them", () => {
    const demo = createDemoRace(MEADOW_LOOP, { karts: 2 });
    const view = demo.view();
    const boxes = view.things.filter((t) => t.kind === "box");
    expect(boxes.length).toBeGreaterThan(0);
    const pose = { eye: {}, target: {} } satisfies Shot;
    expect(shotView(view, pose)).toBe(view);
    const hidden = shotView(view, { ...pose, boxes: false });
    expect(hidden.things.filter((t) => t.kind === "box")).toHaveLength(boxes.length);
    expect(hidden.things.every((t) => t.kind !== "box" || !t.active)).toBe(true);
  });

  it("is only for the dev page: no other file of the game imports it", async () => {
    interface Fs {
      readdirSync(path: string): string[];
      readFileSync(path: string, encoding: "utf8"): string;
      statSync(path: string): { isDirectory(): boolean };
    }
    const fs = (await import("node:fs" as string)) as Fs;
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (fs.statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts") && /from "(\.\/|(\.\.\/)+kart\/render\/|\.\.\/render\/)shot"/.test(fs.readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    walk("src");
    expect(importers).toEqual(["src/kart/render/dev.ts"]);
  });
});
