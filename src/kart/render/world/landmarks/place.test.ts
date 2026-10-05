import { describe, expect, it } from "vitest";
import { TrackGeometry, type TrackDef } from "../../../track/geometry";
import { hazardAt } from "../../../track/hazards";
import { Bank } from "../bank";
import { MeshBuilder } from "../builder";
import { styleFor } from "../themes";
import { LANDMARKS, HAZARDS, THEME_HAZARDS, THEME_LANDMARKS } from "./index";
import { bake, bakeBent, buildHazards, buildLandmarks, facingRoad, landmarkMaterials, roadFrameMap } from "./place";
import type { Texture } from "three";

function straight(bank?: number): TrackDef {
  return {
    id: "t",
    name: "t",
    theme: "kitchen",
    laps: 1,
    width: 14,
    itemRows: [],
    bank,
    points: [
      { x: 0, z: 0 },
      { x: 0, z: 150 },
      { x: 0, z: 300 },
      { x: -60, z: 380 },
      { x: -180, z: 380 },
      { x: -240, z: 300 },
      { x: -240, z: 150 },
      { x: -240, z: 0 },
      { x: -180, z: -80 },
      { x: -60, z: -80 },
    ],
  };
}

describe("facingRoad", () => {
  const road = { tx: 0, tz: 1 };
  const front = (yaw: number) => [Math.sin(yaw), Math.cos(yaw)];

  it("turns a thing on the right of the road to face left, across it, and the reverse", () => {
    const right = front(facingRoad(road.tx, road.tz, 40));
    // The road's right is -x: a thing there looks toward +x.
    expect(right[0]).toBeCloseTo(1, 6);
    const left = front(facingRoad(road.tx, road.tz, -40));
    expect(left[0]).toBeCloseTo(-1, 6);
  });

  it("makes a thing on the centre line look back at the kart coming", () => {
    const f = front(facingRoad(road.tx, road.tz, 0));
    expect(f[1]).toBeCloseTo(-1, 6);
  });
});

describe("bake and bakeBent", () => {
  it("copies triangles through a map", () => {
    const src = new MeshBuilder();
    src.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0]);
    const dst = new MeshBuilder();
    bake(dst, src, ([x, y, z]) => [x + 10, y, z]);
    expect(dst.triangles).toBe(1);
    expect(dst.position[0]).toBe(10);
  });

  it("cuts long triangles short, so a long wall can follow a bend", () => {
    const src = new MeshBuilder();
    src.quad([0, 0, -20], [0, 5, -20], [0, 5, 20], [0, 0, 20], [1, 1, 1]);
    const dst = new MeshBuilder();
    bakeBent(dst, src, (p) => p, 2.5);
    expect(dst.triangles).toBeGreaterThan(20);
    const p = dst.position;
    for (let i = 0; i < p.length; i += 9) {
      const zs = [p[i + 2]!, p[i + 5]!, p[i + 8]!];
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(2.5 + 1e-6);
    }
  });
});

describe("roadFrameMap", () => {
  it("puts x to the road's right, z along it and y up", () => {
    const g = TrackGeometry.build(straight());
    const map = roadFrameMap(g, new Bank(g), 100, 0);
    const base = g.point(100, 0);
    const p = map([3, 2, 10]);
    const q = g.point(110, 3);
    expect(p[0]).toBeCloseTo(q.x, 3);
    expect(p[2]).toBeCloseTo(q.z, 3);
    expect(p[1]).toBeCloseTo(base.y + 2, 3);
  });

  it("follows a bend: a point far along a curved road is where the road is", () => {
    const g = TrackGeometry.build(straight());
    const map = roadFrameMap(g, new Bank(g), 300, 0);
    const p = map([0, 0, 90]);
    const c = g.at(390);
    expect(p[0]).toBeCloseTo(c.x, 2);
    expect(p[2]).toBeCloseTo(c.z, 2);
  });

  it("leans with the bank: the right-hand side is lower in a right-hand bend", () => {
    const g = TrackGeometry.build(straight(14));
    const bank = new Bank(g);
    // Find a spot in the first bend (it turns toward -x: a right-hand bend for a kart facing +z).
    const s = g.project(-60, 380).s;
    expect(bank.rollAt(s)).toBeGreaterThan(0.01);
    const map = roadFrameMap(g, bank, s, 0);
    const high = map([-5, 0, 0]);
    const low = map([5, 0, 0]);
    expect(low[1]).toBeLessThan(high[1]);
  });
});

describe("the registry", () => {
  it("builds every landmark and hazard the docs name, and no model is empty", () => {
    const missing: string[] = [];
    for (const [theme, names] of Object.entries(THEME_LANDMARKS)) {
      for (const name of names) if (!(name in LANDMARKS)) missing.push(`${theme}:${name}`);
    }
    for (const [theme, list] of Object.entries(THEME_HAZARDS)) {
      for (const h of list) if (!(h.kind in HAZARDS)) missing.push(`${theme}:hazard:${h.kind}`);
    }
    expect(missing).toEqual([]);
  });

  it("builds every landmark without error, with some geometry", () => {
    for (const [name, spec] of Object.entries(LANDMARKS)) {
      let n = 0;
      const seed = (name.length * 7919) % 1000;
      const rnd = (() => {
        let s = seed + 1;
        return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      })();
      const model = spec.build({ rnd, theme: "kitchen", night: false, scale: 1, span: spec.defaultSpan ?? 30, halfWidth: 7 });
      n = model.lit.triangles + (model.glow?.triangles ?? 0) + (model.glass?.triangles ?? 0) + (model.moving ?? []).reduce((a, m) => a + (m.lit?.triangles ?? 0) + (m.glow?.triangles ?? 0) + (m.glass?.triangles ?? 0), 0);
      expect(n, name).toBeGreaterThan(10);
      for (const v of model.lit.position) expect(Number.isFinite(v), name).toBe(true);
    }
  });
});

describe("buildLandmarks", () => {
  const track = TrackGeometry.build(straight());
  const env = { track, style: styleFor("space"), bank: new Bank(track), groundAt: () => 0 };

  it("leaves out a name it does not know", () => {
    const mats = landmarkMaterials();
    const layer = buildLandmarks(env, [{ kind: "no-such-thing", at: 0.1, offset: 30 }], mats);
    expect(layer.count).toBe(0);
    expect(layer.group.children).toHaveLength(0);
    layer.dispose();
    mats.dispose();
  });

  it("stands a landmark at its offset from the road and keeps clutter off it", () => {
    const mats = landmarkMaterials();
    const layer = buildLandmarks(env, [{ kind: "teapot", at: 0.1, offset: 44 }], mats);
    expect(layer.count).toBe(1);
    expect(layer.keepOut).toHaveLength(1);
    const k = layer.keepOut[0]!;
    const proj = track.project(k.x, k.z);
    expect(proj.offset).toBeCloseTo(44, 0);
    expect(k.r).toBeGreaterThan(5);
    layer.dispose();
    mats.dispose();
  });

  it("bends a span landmark along the road: all of it stays over the road", () => {
    const mats = landmarkMaterials();
    const s0 = 0.05;
    const span = 44;
    const layer = buildLandmarks(env, [{ kind: "grater", at: s0, offset: 0, span }], mats);
    expect(layer.count).toBe(1);
    let outside = 0;
    layer.group.traverse((o) => {
      const mesh = o as { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getZ(i: number): number } } };
      if (!mesh.isMesh || !mesh.geometry) return;
      const pos = mesh.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const proj = track.project(pos.getX(i), pos.getZ(i));
        const along = track.delta(s0 * track.length, proj.s);
        if (Math.abs(along) > span / 2 + 3 || Math.abs(proj.offset) > 7 + 20) outside++;
      }
    });
    expect(outside).toBe(0);
    layer.dispose();
    mats.dispose();
  });
});

describe("buildHazards", () => {
  const track = TrackGeometry.build(straight());
  const env = { track, style: styleFor("kitchen"), bank: new Bank(track), groundAt: () => 0 };
  const fake = {} as Texture;

  it("poses each hazard where hazardAt says, on the race clock", () => {
    const mats = landmarkMaterials();
    const def = { kind: "orange", at: 0.1, motion: "roll" as const, period: 6, radius: 1.5, span: 0.05 };
    const layer = buildHazards(env, [def], mats, fake);
    for (const t of [0, 1.7, 4.2]) {
      layer.update(t, 1 / 60);
      const pose = hazardAt(track, def, t);
      const body = layer.group.children[1]!;
      expect(body.position.x).toBeCloseTo(pose.x, 4);
      expect(body.position.z).toBeCloseTo(pose.z, 4);
      expect(body.rotation.y).toBeCloseTo(pose.heading, 6);
    }
    layer.dispose();
    mats.dispose();
  });

  it("draws a hazard it has no model for as a marker, never leaves it out", () => {
    const mats = landmarkMaterials();
    const layer = buildHazards(env, [{ kind: "mystery", at: 0.2, motion: "cross", period: 4, radius: 1 }], mats, fake);
    const body = layer.group.children[1]!;
    expect(body.children.length).toBe(1);
    layer.dispose();
    mats.dispose();
  });

  it("lifts a bobbing hazard out of the ground and sinks it again", () => {
    const mats = landmarkMaterials();
    const def = { kind: "yeti", at: 0.1, motion: "bob" as const, period: 4, radius: 2, offset: 9 };
    const layer = buildHazards(env, [def], mats, fake);
    const heights: number[] = [];
    for (let t = 0; t < 4; t += 0.25) {
      layer.update(t, 0.25);
      heights.push(layer.group.children[1]!.position.y);
    }
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights) + 2);
    layer.dispose();
    mats.dispose();
  });
});
