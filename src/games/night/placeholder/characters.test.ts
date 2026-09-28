import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PropertyBinding,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type AnimationClip,
  type BufferGeometry,
  type Material,
} from "three";
import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "../../../engine/types";
import { contractName, findNode } from "../../../engine/world/names";
import { buildCatAsset, buildMechanicAsset, buildSurvivorAsset, buildWalkerAsset } from "./characters";
import { CAT, CAT_PAW_TIP, CAT_SPEEDS, GAIT_SPEEDS, HUMANOID, SURVIVOR_SPEEDS } from "./clips";

const BONES = HUMANOID.map(([name]) => name);
const CAT_BONES = CAT.map(([name]) => name);

/** The dead's clips and their lengths (s); null: a walk loop, 1.2–1.8 s. */
const DEAD: Record<string, number | null> = {
  idle: 2.5,
  "walk.shamble": null,
  "walk.limp": null,
  "walk.drag": null,
  "walk.lurch": null,
  run: 0.6,
  lunge: 0.5,
  crawl: 1.6,
  claw: 1.4,
  stagger: 0.55,
  hit_head: 0.4,
  death_back: 1.2,
  death_forward: 1.2,
  death_crumple: 1.0,
  climb_out: 1.6,
  vault: 1.0,
  bloat_burst: 0.8,
  // The crawler's low variants.
  "idle.low": 2.5,
  "claw.low": 1.4,
  "hit_head.low": 0.4,
  "death.low": 1.0,
};
const MECHANIC: Record<string, number | null> = { ...DEAD, roar: 1.8, mask_off: 0.6, swing: 0.9 };
const SURVIVOR: Record<string, number | null> = { idle: 3.0, run: 0.64, run_lantern: 0.66, duck: 0.5, wave: 1.0, stumble: 0.7 };
const CAT_CLIPS: Record<string, number | null> = { sit: 3.0, hiss: 1.0, leap: 0.6, walk: 0.5 };

const DEAD_LOOPS = ["idle", "walk.shamble", "walk.limp", "walk.drag", "walk.lurch", "run", "crawl", "claw", "idle.low", "claw.low"];

const assets = {
  walker: buildWalkerAsset(),
  mechanic: buildMechanicAsset(),
  survivor: buildSurvivorAsset(),
  cat: buildCatAsset(),
};

function node(a: LoadedAsset, name: string): Object3D {
  const n = findNode(a.scene, name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

function clip(a: LoadedAsset, name: string): AnimationClip {
  const c = a.animations.find((x) => x.name === name);
  if (!c) throw new Error(`no clip ${name}`);
  return c;
}

function triangles(a: LoadedAsset): number {
  let n = 0;
  a.scene.traverse((o) => {
    const g = (o as Mesh).isMesh ? ((o as Mesh).geometry as BufferGeometry) : null;
    if (g) n += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  return n;
}

function materials(m: Mesh): Material[] {
  return Array.isArray(m.material) ? m.material : [m.material];
}

/**
 * Plays a clip on the asset's own scene and samples `points` (world positions
 * of bones, or of a point some way down a bone) at `n` + 1 evenly spaced times.
 */
function sample(a: LoadedAsset, c: AnimationClip, points: { bone: string; down?: number }[], n: number, loop = true): Vector3[][] {
  const mixer = new AnimationMixer(a.scene);
  const action = mixer.clipAction(c);
  action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
  action.clampWhenFinished = !loop;
  action.play();
  const out: Vector3[][] = points.map(() => []);
  for (let i = 0; i <= n; i++) {
    // Just short of the end on a loop, which would wrap to the start.
    const t = loop ? Math.min((c.duration * i) / n, c.duration - 1e-4) : (c.duration * i) / n;
    mixer.setTime(t);
    a.scene.updateMatrixWorld(true);
    points.forEach((p, j) => (out[j] as Vector3[]).push(node(a, p.bone).localToWorld(new Vector3(0, -(p.down ?? 0), 0))));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(a.scene);
  a.scene.traverse((o) => {
    const rest = o.userData["restPose"] as [Vector3, Quaternion, Vector3] | undefined;
    if (rest) {
      o.position.copy(rest[0]);
      o.quaternion.copy(rest[1]);
      o.scale.copy(rest[2]);
    }
  });
  a.scene.updateMatrixWorld(true);
  return out;
}

// Remember the rest pose, so sampling a clip leaves the scene as it found it.
for (const a of Object.values(assets)) a.scene.traverse((o) => (o.userData["restPose"] = [o.position.clone(), o.quaternion.clone(), o.scale.clone()]));

/**
 * How fast a planted foot slides back while it is down: the median, over the
 * samples where it is within 1.5 cm of its lowest, of its backward speed.
 */
function plantedSpeed(a: LoadedAsset, name: string, points: { bone: string; down?: number }[]): { speed: number; contact: number } {
  const c = clip(a, name);
  const n = 240;
  const dt = c.duration / n;
  const tracks = sample(a, c, points, n);
  const speeds: number[] = [];
  let contact = 0;
  for (const path of tracks) {
    const low = Math.min(...path.map((v) => v.y));
    const down = path.map((v) => v.y < low + 0.015);
    contact += down.filter(Boolean).length / path.length / tracks.length;
    for (let i = 0; i + 1 < path.length; i++) {
      if (down[i] && down[i + 1]) speeds.push(-((path[i + 1] as Vector3).z - (path[i] as Vector3).z) / dt);
    }
  }
  speeds.sort((x, y) => x - y);
  return { speed: speeds[Math.floor(speeds.length / 2)] ?? 0, contact };
}

describe("the placeholder characters' contract", () => {
  it.each([
    ["walker", BONES],
    ["mechanic", BONES],
    ["survivor", BONES],
    ["cat", CAT_BONES],
  ] as const)("%s has every bone of its armature", (kind, bones) => {
    for (const b of bones) {
      const n = node(assets[kind], b);
      expect((n as { isBone?: boolean }).isBone, b).toBe(true);
    }
  });

  it.each([
    ["walker", ["walker", "char.walker", "char.runner", "char.crawler", "char.bloater", "belly", "eyes", "var.outfit.farmer", "var.outfit.trucker", "var.outfit.waitress", "var.outfit.hunter", "var.outfit.mechanic_small", "var.outfit.suit", "var.hair.1", "var.hair.2", "var.hair.3", "var.hair.4"]],
    ["mechanic", ["mechanic", "char.mechanic", "var.mask", "eyes", "socket.weapon", "prop.tyre_iron"]],
    ["survivor", ["survivor", "var.person.daughter", "var.person.owner", "socket.lantern", "prop.lantern", "lantern.flame"]],
    ["cat", ["cat", "char.cat", "eyes"]],
  ] as const)("%s has every named node", (kind, names) => {
    expect(contractName(assets[kind].scene)).toBe(names[0]);
    for (const n of names) expect(findNode(assets[kind].scene, n), n).not.toBeNull();
  });

  it.each(Object.keys(assets) as (keyof typeof assets)[])("%s names no mesh or node like a bone", (kind) => {
    const bones = new Set<string>();
    assets[kind].scene.traverse((o) => {
      if ((o as { isBone?: boolean }).isBone) bones.add(o.name);
    });
    assets[kind].scene.traverse((o) => {
      if (!(o as { isBone?: boolean }).isBone) expect(bones.has(o.name), contractName(o)).toBe(false);
    });
  });

  it.each([
    ["walker", DEAD],
    ["mechanic", MECHANIC],
    ["survivor", SURVIVOR],
    ["cat", CAT_CLIPS],
  ] as const)("%s has every clip at its length", (kind, spec) => {
    for (const [name, length] of Object.entries(spec)) {
      const d = clip(assets[kind], name).duration;
      if (length === null) {
        expect(d, name).toBeGreaterThanOrEqual(1.2);
        expect(d, name).toBeLessThanOrEqual(1.8);
      } else expect(Math.abs(d - length), name).toBeLessThanOrEqual(0.05);
    }
    if (kind === "walker" || kind === "mechanic") expect(clip(assets[kind], "claw").duration).toBeCloseTo(1.4, 6);
  });

  it.each(Object.keys(assets) as (keyof typeof assets)[])("%s: every track binds to a node that exists", (kind) => {
    const names = new Set<string>();
    assets[kind].scene.traverse((o) => names.add(o.name));
    for (const c of assets[kind].animations) {
      for (const t of c.tracks) {
        const parsed = PropertyBinding.parseTrackName(t.name);
        expect(names.has(parsed.nodeName), `${c.name}: ${t.name}`).toBe(true);
      }
    }
  });

  it("loops begin and end on the same pose", () => {
    const loops: [keyof typeof assets, string[]][] = [
      ["walker", DEAD_LOOPS],
      ["mechanic", DEAD_LOOPS],
      ["survivor", ["idle", "run", "run_lantern", "wave"]],
      ["cat", ["sit", "walk"]],
    ];
    for (const [kind, names] of loops) {
      for (const name of names) {
        for (const t of clip(assets[kind], name).tracks) {
          const w = t.getValueSize();
          const first = Array.from(t.values.slice(0, w));
          const last = Array.from(t.values.slice(t.values.length - w));
          if (w === 4) {
            // A quaternion and its negative are the same turn.
            const dot = first.reduce((s, v, i) => s + v * (last[i] as number), 0);
            expect(Math.abs(dot), `${kind} ${name} ${t.name}`).toBeCloseTo(1, 5);
          } else first.forEach((v, i) => expect(v, `${kind} ${name} ${t.name}`).toBeCloseTo(last[i] as number, 5));
        }
      }
    }
  });

  it.each(["walker", "mechanic", "survivor"] as const)("%s stands with its feet on the ground at rest", (kind) => {
    const a = assets[kind];
    const k = kind === "mechanic" ? 1.2 : 1;
    a.scene.updateMatrixWorld(true);
    for (const side of ["L", "R"]) expect(node(a, `foot.${side}`).getWorldPosition(new Vector3()).y).toBeLessThan(0.08 * k);
    const bodies = kind === "walker" ? ["char.walker", "char.runner", "char.bloater"] : kind === "mechanic" ? ["char.mechanic"] : ["var.person.daughter", "var.person.owner"];
    for (const b of bodies) {
      const g = (node(a, b) as Mesh).geometry;
      g.computeBoundingBox();
      expect(Math.abs(g.boundingBox?.min.y ?? 1), b).toBeLessThan(0.01);
    }
  });

  it.each(["walker", "mechanic", "cat"] as const)("%s faces +Z (its eyes are in front of its head)", (kind) => {
    const a = assets[kind];
    a.scene.updateMatrixWorld(true);
    const eyes = node(a, "eyes") as Mesh;
    eyes.geometry.computeBoundingBox();
    const centre = eyes.geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
    expect(centre.z).toBeGreaterThan(node(a, "head").getWorldPosition(new Vector3()).z + 0.03);
  });

  it("the Mechanic is a huge man, over two metres", () => {
    const g = (node(assets.mechanic, "char.mechanic") as Mesh).geometry;
    g.computeBoundingBox();
    expect(g.boundingBox?.max.y ?? 0).toBeGreaterThanOrEqual(2.0);
    expect(g.boundingBox?.max.y ?? 0).toBeLessThan(2.3);
  });

  it("the parts the game drives are meshes with the materials it looks for", () => {
    for (const kind of ["walker", "mechanic", "cat"] as const) {
      const eyes = node(assets[kind], "eyes") as SkinnedMesh;
      expect(eyes.isSkinnedMesh).toBe(true);
      const m = eyes.material as MeshStandardMaterial;
      expect(m.isMeshStandardMaterial).toBe(true);
      expect(m.name).toBe("eyes");
      expect(m.emissive.getHex()).toBe(0);
      expect(m.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.05);
      // Bound to the head alone.
      const head = eyes.skeleton.bones.findIndex((b) => contractName(b) === "head");
      const idx = eyes.geometry.getAttribute("skinIndex");
      for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBe(head);
    }
    const belly = node(assets.walker, "belly") as SkinnedMesh;
    expect(belly.isSkinnedMesh).toBe(true);
    const bound = new Set<string>();
    const idx = belly.geometry.getAttribute("skinIndex");
    const wgt = belly.geometry.getAttribute("skinWeight");
    for (let i = 0; i < idx.count; i++) {
      for (let j = 0; j < 4; j++) if (wgt.getComponent(i, j) > 0) bound.add(contractName(belly.skeleton.bones[idx.getComponent(i, j)] as Object3D));
    }
    expect([...bound].sort()).toEqual(["hips", "spine"]);
    const mask = node(assets.mechanic, "var.mask") as Mesh;
    expect(mask.isMesh).toBe(true);
    expect((mask as SkinnedMesh).isSkinnedMesh).toBeFalsy();
    expect(contractName(mask.parent as Object3D)).toBe("head");
    expect(materials(mask).map((m) => m.name)).toContain("glass");
    const iron = node(assets.mechanic, "prop.tyre_iron") as Mesh;
    expect(iron.isMesh).toBe(true);
    expect(contractName(iron.parent as Object3D)).toBe("socket.weapon");
    expect(contractName(node(assets.mechanic, "socket.weapon").parent as Object3D)).toBe("hand.R");
    const flame = node(assets.survivor, "lantern.flame") as Mesh;
    expect(flame.isMesh).toBe(true);
    expect((flame.material as MeshStandardMaterial).name).toBe("flame");
    expect((flame.material as MeshStandardMaterial).emissive.getHex()).not.toBe(0);
    expect(contractName(node(assets.survivor, "prop.lantern").parent as Object3D)).toBe("socket.lantern");
    expect(contractName(node(assets.survivor, "socket.lantern").parent as Object3D)).toBe("hand.L");
  });

  it("every material is a MeshStandardMaterial, coloured per vertex but for the eyes and glass", () => {
    for (const a of Object.values(assets)) {
      a.scene.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        for (const m of materials(o as Mesh)) {
          expect((m as MeshStandardMaterial).isMeshStandardMaterial, m.name).toBe(true);
          if (!["eyes", "glass", "globe", "flame"].includes(m.name)) expect(m.vertexColors, m.name).toBe(true);
        }
      });
    }
  });

  it.each(Object.keys(assets) as (keyof typeof assets)[])("%s stays within its triangle budget", (kind) => {
    // Every body, outfit and hair of the file together, not only what one figure shows.
    expect(triangles(assets[kind])).toBeLessThan(6000);
  });
});

describe("the placeholder clips", () => {
  const feet = [{ bone: "foot.L" }, { bone: "foot.R" }];
  const hands = [{ bone: "hand.L" }, { bone: "hand.R" }];
  const paws = ["FL", "FR", "BL", "BR"].map((leg) => ({ bone: `paw.${leg}`, down: CAT_PAW_TIP }));

  it.each([
    ...Object.entries(GAIT_SPEEDS).map(([name, speed]) => ["walker", name, speed] as const),
    ...Object.entries(GAIT_SPEEDS).map(([name, speed]) => ["mechanic", name, speed] as const),
    ...Object.entries(SURVIVOR_SPEEDS).map(([name, speed]) => ["survivor", name, speed] as const),
    ...Object.entries(CAT_SPEEDS).map(([name, speed]) => ["cat", name, speed] as const),
  ])("%s %s: a planted foot slides back at the authored %s m/s", (kind, name, speed) => {
    // The crawler pulls itself along with its hands; the cat walks on its paws.
    const points = kind === "cat" ? paws : name === "crawl" ? hands : feet;
    const { speed: measured, contact } = plantedSpeed(assets[kind], name, points);
    expect(contact).toBeGreaterThan(0.2);
    expect(measured).toBeGreaterThan(speed * 0.8);
    expect(measured).toBeLessThan(speed * 1.2);
  });

  it.each(["walker", "mechanic"] as const)("%s: the claw's stroke peaks at 0.7 s, reaching forward over the sandbags", (kind) => {
    const a = assets[kind];
    const c = clip(a, "claw");
    const n = 140;
    const [l, r] = sample(a, c, hands, n) as [Vector3[], Vector3[]];
    const reach = l.map((v, i) => (v.z + (r[i] as Vector3).z) / 2);
    const peak = reach.indexOf(Math.max(...reach));
    expect(Math.abs((peak / n) * c.duration - 0.7)).toBeLessThanOrEqual(0.05);
    const k = kind === "mechanic" ? 1.2 : 1;
    // Over waist-high bags: the hands stay above 0.9 m the whole stroke.
    for (const v of [...l, ...r]) expect(v.y).toBeGreaterThan(0.9 * k);
  });

  it.each(["walker", "mechanic"] as const)("%s: every death ends on the ground, the body down by 0.8 s", (kind) => {
    const a = assets[kind];
    const k = kind === "mechanic" ? 1.2 : 1;
    // The crawler's clips leave its missing shins and feet where they fall.
    const limbs = (name: string) => BONES.filter((b) => !(name.endsWith(".low") && (b.startsWith("shin") || b.startsWith("foot"))));
    for (const name of ["death_back", "death_forward", "death_crumple", "bloat_burst", "death.low"]) {
      const c = clip(a, name);
      const n = Math.round(c.duration * 100);
      const bones = limbs(name);
      const paths = sample(a, c, bones.map((bone) => ({ bone })), n, false);
      const hips = paths[bones.indexOf("hips")] as Vector3[];
      const head = paths[bones.indexOf("head")] as Vector3[];
      const end = hips[n] as Vector3;
      const at08 = hips[Math.round(0.8 * 100)] as Vector3;
      expect(end.y, name).toBeLessThan(0.3 * k);
      expect((head[n] as Vector3).y, name).toBeLessThan(0.45 * k);
      expect(Math.abs(at08.y - end.y), name).toBeLessThan(0.06 * k);
      // No joint sinks into the road on the way down.
      paths.forEach((path, i) => {
        for (const v of path) expect(v.y, `${name} ${bones[i]}`).toBeGreaterThan(-0.02);
      });
    }
  });

  it.each(["walker", "mechanic", "survivor"] as const)("%s: no joint goes under the road in any clip", (kind) => {
    const a = assets[kind];
    for (const c of a.animations) {
      const bones = c.name.endsWith(".low") ? BONES.filter((b) => !b.startsWith("shin") && !b.startsWith("foot")) : BONES;
      const paths = sample(a, c, bones.map((bone) => ({ bone })), 60, false);
      paths.forEach((path, i) => {
        for (const v of path) expect(v.y, `${c.name} ${bones[i]}`).toBeGreaterThan(-0.02);
      });
    }
  });

  it("the walker climbs down out of the bus from 0.9 m to the road", () => {
    const a = assets.walker;
    const c = clip(a, "climb_out");
    const [l, r] = sample(a, c, feet, 16, false) as [Vector3[], Vector3[]];
    expect((l[0] as Vector3).y).toBeGreaterThan(0.85);
    expect((r[0] as Vector3).y).toBeGreaterThan(0.85);
    expect((l[16] as Vector3).y).toBeLessThan(0.08);
    expect((r[16] as Vector3).y).toBeLessThan(0.08);
  });

  it("the survivor's lantern hangs steady and plumb while she runs with it", () => {
    const a = assets.survivor;
    const c = clip(a, "run_lantern");
    const n = 40;
    const [hand] = sample(a, c, [{ bone: "hand.L" }], n) as [Vector3[]];
    const ys = hand.map((v) => v.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    expect(Math.min(...hand.map((v) => v.z))).toBeGreaterThan(0.25);
  });

  it("the crawler stays low", () => {
    const a = assets.walker;
    for (const name of ["crawl", "idle.low", "claw.low", "hit_head.low", "death.low"]) {
      const c = clip(a, name);
      const [hips, head] = sample(a, c, [{ bone: "hips" }, { bone: "head" }], 20, name !== "death.low" && name !== "hit_head.low") as [Vector3[], Vector3[]];
      for (const v of hips) expect(v.y, name).toBeLessThan(0.25);
      for (const v of head) expect(v.y, name).toBeLessThan(0.75);
    }
  });
});
