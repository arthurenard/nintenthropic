import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "../../../engine/types";
import type { Rig } from "../../../engine/world/character";
import { burstMoment, CLIP_SPEED, clipSpeeds, dressDead } from "./rigs";

/** A rig as dressDead sees it: the walker file's bodies and variations, and what it was dressed in. */
function fakeRig(): { rig: Rig; worn: () => string[] } {
  const model = new Group();
  for (const name of ["char.walker", "char.runner", "char.bloater", "char.crawler"]) {
    const o = new Object3D();
    o.name = name;
    o.userData["name"] = name;
    model.add(o);
  }
  const vars = new Map<string, Object3D>();
  for (const name of ["var.hair.balding", "var.hair.greasy", "var.hair.long", "var.hair.short", "var.outfit.farmer", "var.outfit.hunter", "var.outfit.trucker", "var.outfit.suit", "var.outfit.waitress", "var.outfit.mechanic_small"]) vars.set(name, new Object3D());
  let dressed: string[] = [];
  const rig = {
    model,
    vars,
    dress: (names: readonly string[]) => {
      dressed = [...names];
    },
    hold: () => {},
  } as unknown as Rig;
  return { rig, worn: () => dressed };
}

const visibleBody = (rig: Rig) => rig.model.children.filter((o) => o.visible).map((o) => o.name);

describe("dressing the dead", () => {
  it("wears the bloater and the crawler as they come: their own body, nothing over it", () => {
    for (const kind of ["bloater", "crawler"] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const { rig, worn } = fakeRig();
        let n = seed;
        dressDead(rig, kind, () => ((n = (n * 9301 + 49297) % 233280) / 233280));
        expect(visibleBody(rig), kind).toEqual([`char.${kind}`]);
        expect(worn(), kind).toEqual([]);
      }
    }
  });

  it("makes a runner the runner as he comes, or a walker's body in an outfit: never the runner in a walker's clothes", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { rig, worn } = fakeRig();
      let n = seed;
      dressDead(rig, "runner", () => ((n = (n * 9301 + 49297) % 233280) / 233280));
      const body = visibleBody(rig);
      seen.add(body.join());
      if (body[0] === "char.runner") expect(worn()).toEqual([]);
      else expect(worn().filter((x) => x.startsWith("var.outfit.")).length).toBe(1);
    }
    expect([...seen].sort()).toEqual(["char.runner", "char.walker"]);
  });

  it("puts a walker in an outfit, mostly with hair, and never long hair under a cap", () => {
    let withHair = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { rig, worn } = fakeRig();
      let n = seed;
      dressDead(rig, "walker", () => ((n = (n * 9301 + 49297) % 233280) / 233280));
      expect(visibleBody(rig)).toEqual(["char.walker"]);
      const w = worn();
      const outfits = w.filter((x) => x.startsWith("var.outfit."));
      const hair = w.filter((x) => x.startsWith("var.hair."));
      expect(outfits.length).toBe(1);
      expect(hair.length).toBeLessThanOrEqual(1);
      if (hair.length) withHair++;
      if (outfits[0] === "var.outfit.trucker" || outfits[0] === "var.outfit.hunter") expect(hair.every((x) => x === "var.hair.short")).toBe(true);
    }
    expect(withHair).toBeGreaterThan(20);
  });
});

describe("a file's clips", () => {
  const asset = (userData: Record<string, unknown>): LoadedAsset => {
    const scene = new Group();
    Object.assign(scene.userData, userData);
    return { scene, animations: [] };
  };

  it("walk at the ground speed the file says they were made for, over the table", () => {
    const speeds = clipSpeeds(asset({ clips: { "walk.shamble": { loop: true, speed_mps: 0.9 }, idle: { loop: true } } }));
    expect(speeds["walk.shamble"]).toBe(0.9);
    expect(speeds["walk.limp"]).toBe(CLIP_SPEED["walk.limp"]);
    expect(speeds["run_lantern"]).toBe(4.4);
  });

  it("cover more ground on a bigger body: the Mechanic's 1.15", () => {
    const speeds = clipSpeeds(asset({ scale: 1.15, clips: { "walk.shamble": { speed_mps: 0.85 } } }));
    expect(speeds["walk.shamble"]).toBeCloseTo(0.9775, 6);
  });

  it("burst a bloater where the file says", () => {
    expect(burstMoment(asset({ clips: { bloat_burst: { burst_s: 1.32 } } }))).toBe(1.32);
    expect(burstMoment(asset({}))).toBe(1.32);
    expect(burstMoment(asset({ clips: { bloat_burst: { burst_s: 0.9 } } }))).toBe(0.9);
  });
});
