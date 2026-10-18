import { describe, expect, it } from "vitest";
import { Group, ShaderMaterial, type Material, type Mesh, type Object3D } from "three";
import type { KartView, RaceView, ThingView } from "../contract";
import { Effects } from "./effects";
import { ItemFx } from "./itemfx";
import { Things } from "./things";

/** What a material's shader is built from: the material itself, or for a shader of our own its source (each comet's bubble has its own material). */
function shaderOf(material: Material): unknown {
  return material instanceof ShaderMaterial ? material.fragmentShader : material;
}

/** The shaders of every mesh under `root`, hidden or not. */
function shaders(...roots: Object3D[]): Set<unknown> {
  const found = new Set<unknown>();
  for (const root of roots) {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) found.add(shaderOf(m));
    });
  }
  return found;
}

function kart(id: number, extra: Partial<KartView> = {}): KartView {
  return {
    id, x: id * 4, y: 0, z: 0, heading: 0, speed: 20, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0, offroad: false,
    surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: id + 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
    ...extra,
  };
}

describe("what is made the first time it is needed", () => {
  it("is already in the scene, hidden, so the warm-up builds its shaders behind the loading screen", () => {
    const fx = new Effects(200);
    const things = new Things(fx);
    const items = new ItemFx(fx, { geometry: things.puck, material: things.lit });
    const before = shaders(things.group, items.group);

    // A slick on the road, a kart under a storm cloud and one inside a comet's bubble.
    const slick: ThingView = { id: 1, kind: "slick", x: 0, y: 0, z: 0, heading: 0, active: true };
    things.update([slick], 0);
    const karts = [kart(0, { zapped: 2.5 }), kart(1, { comet: 4 })];
    const actors = new Map(karts.map((k) => [k.id, { root: new Group() }]));
    const view = { karts, things: [] } as unknown as RaceView;
    items.update(view, new Map(karts.map((k) => [k.id, k])), actors, 1 / 60, 1);

    const after = shaders(things.group, items.group, ...[...actors.values()].map((a) => a.root));
    for (const shader of after) expect(before.has(shader)).toBe(true);
    // And each kind did appear (the test would prove nothing if none had been made).
    expect(after.size).toBeGreaterThan(0);
    expect([...actors.values()].some((a) => a.root.children.length > 0)).toBe(true);

    // The stand-ins are hidden: nothing extra is drawn in a race.
    const hidden = [...things.group.children, ...items.group.children].filter((o) => !o.visible && o.children.length > 0);
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    items.dispose();
    things.dispose();
    fx.dispose();
  });
});
