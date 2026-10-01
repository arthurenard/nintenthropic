import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../engine/rules/rng";
import type { LoadedAsset } from "../../../engine/types";
import type { Rig } from "../../../engine/world/character";
import { drawGait, paceOf } from "../rules/dead";
import { shippedExtras } from "../rules/testkit";
import { GAIT_SPEED, GAIT_WEIGHT, WALKER_HURRY } from "../rules/tuning";
import { GAITS } from "../rules/types";
import { waveSpec } from "../rules/waves";
import { burstMoment, CLIP_SPEED, clipSpeeds, dressDead, GAIT_LADDER, gaitForPace, MAX_PLAYBACK } from "./rigs";

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

/**
 * The dead go faster, and their feet must not slide: a clip plays at the pace
 * the dead walk at over the speed it was made for, so what matters is that
 * the rules' speeds and the art's agree, and that no clip is played far past
 * what it was made for - a faster gait is taken instead.
 */
const extras = await shippedExtras("walker");

describe("the dead's gaits and their clips", () => {
  const hurried = [...WALKER_HURRY, (WALKER_HURRY[0] + WALKER_HURRY[1]) / 2];

  it("walk at the speeds the shipped art was made for", () => {
    for (const gait of GAITS) expect(CLIP_SPEED[gait], gait).toBe(GAIT_SPEED[gait]);
    if (!extras) return;
    const clips = extras["clips"] as Record<string, { speed_mps?: number }>;
    for (const gait of GAITS) expect(clips[gait]?.speed_mps, `${gait} in walker.glb`).toBe(GAIT_SPEED[gait]);
  });

  it("walk Standard's dead about a third faster than the night first walked them (0.95 m/s)", () => {
    const random = mulberry32(11);
    let total = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const gait = drawGait(random);
      total += paceOf("walker", gait, WALKER_HURRY[0] + random() * (WALKER_HURRY[1] - WALKER_HURRY[0]));
    }
    expect(total / n / 0.945).toBeGreaterThan(1.3);
    expect(total / n / 0.945).toBeLessThan(1.4);
    // Mostly the lurch and the shamble: the limp and the drag are the odd ones out.
    expect(GAIT_WEIGHT["walk.lurch"] + GAIT_WEIGHT["walk.shamble"]).toBeGreaterThanOrEqual(0.7);
    expect(Object.values(GAIT_WEIGHT).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("play every walker's clip 15-60% faster than it was made, no more, at the pace the night is built on", () => {
    for (const gait of GAITS) {
      for (const hurry of hurried) {
        const playback = paceOf("walker", gait, hurry) / (CLIP_SPEED[gait] as number);
        expect(playback, `${gait} at ${hurry}`).toBeGreaterThanOrEqual(1.15 - 1e-9);
        expect(playback, `${gait} at ${hurry}`).toBeLessThanOrEqual(1.6 + 1e-9);
      }
    }
  });

  it("keep a gait while its clip would play within 1.8 times what it was made for, and take a faster one past that, never back", () => {
    expect(MAX_PLAYBACK).toBe(1.8);
    expect(gaitForPace("walk.shamble", 0.85 * 1.8, CLIP_SPEED)).toBe("walk.shamble");
    expect(gaitForPace("walk.shamble", 0.85 * 1.8 + 0.01, CLIP_SPEED)).toBe("walk.lurch");
    expect(gaitForPace("walk.drag", 0.6 * 1.8 + 0.01, CLIP_SPEED)).toBe("walk.limp");
    // A drag that goes very fast climbs the whole ladder to the run.
    expect(gaitForPace("walk.drag", 3, CLIP_SPEED)).toBe("run");
    // From where it is on: a lurch asked to go slow stays a lurch, a runner a runner, a crawler a crawler.
    expect(gaitForPace("walk.lurch", 0.3, CLIP_SPEED)).toBe("walk.lurch");
    expect(gaitForPace("run", 4.2, CLIP_SPEED)).toBe("run");
    expect(gaitForPace("crawl", 3, CLIP_SPEED)).toBe("crawl");
    // Faster is never slower: along the ladder, the same gait or one on.
    for (const gait of GAIT_LADDER) {
      let last = GAIT_LADDER.indexOf(gait);
      for (let pace = 0.3; pace < 6; pace += 0.1) {
        const at = GAIT_LADDER.indexOf(gaitForPace(gait, pace, CLIP_SPEED));
        expect(at, `${gait} at ${pace}`).toBeGreaterThanOrEqual(last);
        last = at;
      }
    }
  });

  it("never play a clip past 1.8 times what it was made for, whatever the wave, a long wave's pressure and the Mechanic do to the pace", () => {
    // (To wave 10, where Standard's hands fall: past 6.3 m/s - a wave 11 lurch under the full pressure and the
    // Mechanic - even the run is played faster than that, and there is no faster gait left to take.)
    for (let wave = 1; wave <= 10; wave++) {
      for (const gait of GAITS) {
        for (const hurry of hurried) {
          for (const pressure of [1, 1.35, 1.7]) {
            for (const mechanic of [1, 1.25]) {
              const pace = paceOf("walker", gait, hurry) * waveSpec(wave).pace * pressure * mechanic;
              const taken = gaitForPace(gait, pace, CLIP_SPEED);
              const playback = pace / (CLIP_SPEED[taken] as number);
              expect(playback, `wave ${wave} ${gait} x${hurry} pressure ${pressure} mechanic ${mechanic} -> ${taken}`).toBeLessThanOrEqual(MAX_PLAYBACK + 1e-9);
            }
          }
        }
      }
    }
  });
});
