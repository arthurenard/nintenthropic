import { AnimationMixer, Box3, LoopOnce, PropertyBinding, Quaternion, QuaternionKeyframeTrack, Vector3, type AnimationClip, type Material, type Mesh, type Object3D, type SkinnedMesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "../../../engine/types";
import { contractName, findNode } from "../../../engine/world/names";
import { buildAnimalsAsset } from "./animals";
import { BICYCLE, buildCivilianAsset, crankAngle } from "./civilian";
import { FIGURE_CLIPS, HUMANOID_BONES, ONE_SHOT_CLIPS, triangles } from "./skin";
import { buildSoldierAsset } from "./soldier";
import { buildVehiclesAsset } from "./vehicles";

/**
 * The placeholder figures against the asset contract (docs/OVERWATCH_RIDGE.md,
 * "Characters and vehicles"): the nodes the game looks up by name, clips
 * that bind to real bones and pose a body without NaNs, and the shapes the
 * game counts on - feet on the ground, a rifle along +Z, a driver at the
 * wheel, pedals in step with the crank.
 */

const soldier = buildSoldierAsset();
const civilian = buildCivilianAsset();
const animals = buildAnimalsAsset();
const vehicles = buildVehiclesAsset();

function node(root: Object3D, name: string): Object3D {
  const n = findNode(root, name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

function clipOf(asset: LoadedAsset, name: string): AnimationClip {
  const c = asset.animations.find((a) => a.name === name);
  if (!c) throw new Error(`no clip ${name}`);
  return c;
}

const world = (o: Object3D) => o.getWorldPosition(new Vector3());

/** A clone of a figure (as the game's Rig makes it) and a way to pose it at a time into a clip. */
function stage(scene: Object3D): { model: Object3D; at: (clip: AnimationClip, t: number) => void; bone: (name: string) => Object3D } {
  const model = clone(scene);
  const mixer = new AnimationMixer(model);
  const at = (clip: AnimationClip, t: number) => {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    // Played forward from the start, as the game does, in a few steps.
    const steps = 4;
    for (let i = 0; i < steps; i++) mixer.update(t / steps);
    model.updateMatrixWorld(true);
  };
  return { model, at, bone: (name) => node(model, name) };
}

function skinnedMeshes(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) out.push(o as SkinnedMesh);
  });
  return out;
}

/** The lowest point of a skinned mesh as posed now, and whether every vertex is a finite number. */
function measure(mesh: SkinnedMesh): { low: number; finite: boolean } {
  const v = new Vector3();
  let low = Infinity;
  let finite = true;
  const n = mesh.geometry.getAttribute("position").count;
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) finite = false;
    low = Math.min(low, v.y);
  }
  return { low, finite };
}

const times = (clip: AnimationClip, n = 8) => Array.from({ length: n + 1 }, (_, i) => (clip.duration * i) / n);

/** Every track of every clip finds a bone in a clone of `scene`. */
function expectBinds(scene: Object3D, clips: readonly AnimationClip[]): void {
  const model = clone(scene);
  for (const clip of clips) {
    expect(clip.tracks.length, clip.name).toBeGreaterThan(0);
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
      const target = PropertyBinding.findNode(model, nodeName) as Object3D | null;
      expect(target, `${clip.name}: ${track.name}`).toBeTruthy();
      expect((target as { isBone?: boolean }).isBone, `${clip.name}: ${track.name} is not on a bone`).toBe(true);
      expect(["quaternion", "position"]).toContain(propertyName);
      // As the mixer will bind it.
      expect((PropertyBinding.create(model, track.name) as PropertyBinding).node, track.name).toBe(target);
    }
  }
}

/** Looping clips end where they start, so the loop has no seam. */
function expectSeamless(clips: readonly AnimationClip[]): void {
  for (const clip of clips) {
    if (ONE_SHOT_CLIPS.has(clip.name)) continue;
    for (const track of clip.tracks) {
      const size = track.getValueSize();
      const first = Array.from(track.values.slice(0, size));
      const last = Array.from(track.values.slice(track.values.length - size));
      if (track instanceof QuaternionKeyframeTrack) {
        const dot = Math.abs(new Quaternion(...first).dot(new Quaternion(...last)));
        expect(dot, `${clip.name}: ${track.name}`).toBeGreaterThan(0.9999);
      } else {
        first.forEach((x, i) => expect(Math.abs(x - (last[i] as number)), `${clip.name}: ${track.name}`).toBeLessThan(1e-4));
      }
    }
  }
}

/** Clip lengths the contract asks for (about), seconds. */
const LENGTHS: Record<string, [number, number]> = {
  idle: [2, 3.5],
  idle_smoke: [4.5, 5.5],
  look_binoculars: [3.5, 4.5],
  walk: [1.1, 1.1],
  patrol_walk: [1.3, 1.3],
  run: [0.66, 0.66],
  crouch: [1.8, 2.2],
  prone: [2.5, 3.5],
  prone_aim: [1.8, 2.2],
  aim: [1.4, 1.8],
  fire: [0.3, 0.5],
  hit_body: [0.4, 0.6],
  wound_kneel: [0.8, 1.0],
  death_back: [1.2, 1.5],
  death_forward: [1.2, 1.5],
  death_crumple: [1.2, 1.5],
  dismount: [0.9, 1.1],
  drive: [1.8, 2.2],
  cycle: [0.9, 0.9],
  wave: [1.1, 1.3],
  panic: [0.7, 0.7],
  duck: [1.8, 2.2],
  "cow.walk": [1.2, 1.2],
  "cow.look_up": [0.8, 0.8],
  "sheep.look_up": [0.8, 0.8],
  "goat.hop": [0.8, 0.8],
  "goat.bleat": [0.8, 0.8],
  "eagle.glide": [2, 2],
  "eagle.flap": [0.5, 0.5],
  "eagle.land": [1, 1],
  "dog.run": [0.5, 0.5],
};

const materialsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

describe("the figures' clip lists", () => {
  it("are exactly FIGURE_CLIPS, in the contract's lengths", () => {
    expect(soldier.animations.map((c) => c.name)).toEqual(FIGURE_CLIPS.soldier);
    expect(civilian.animations.map((c) => c.name)).toEqual(FIGURE_CLIPS.civilian);
    expect(animals.animations.map((c) => c.name)).toEqual(FIGURE_CLIPS.animals);
    expect(vehicles.animations).toEqual([]);
    for (const clip of [...soldier.animations, ...civilian.animations, ...animals.animations]) {
      const range = LENGTHS[clip.name];
      if (!range) continue;
      expect(clip.duration, clip.name).toBeGreaterThanOrEqual(range[0] - 1e-6);
      expect(clip.duration, clip.name).toBeLessThanOrEqual(range[1] + 1e-6);
    }
    const all = new Set<string>([...FIGURE_CLIPS.soldier, ...FIGURE_CLIPS.civilian, ...FIGURE_CLIPS.animals]);
    for (const name of ONE_SHOT_CLIPS) expect(all.has(name), name).toBe(true);
  });
});

describe.each([
  ["soldier", soldier],
  ["civilian", civilian],
] as const)("the %s", { timeout: 30_000 }, (kind, asset) => {
  it("is the shared humanoid, with a socket on each hand", () => {
    const body = node(asset.scene, "body") as SkinnedMesh;
    expect(body.isSkinnedMesh).toBe(true);
    expect(body.frustumCulled).toBe(false);
    expect(body.castShadow).toBe(true);
    const names = body.skeleton.bones.map(contractName);
    for (const bone of HUMANOID_BONES) expect(names, bone).toContain(bone);
    expect(contractName(node(asset.scene, "socket.gun").parent as Object3D)).toBe("hand.R");
    expect(contractName(node(asset.scene, "socket.hand.L").parent as Object3D)).toBe("hand.L");
    // Feet at the origin, facing +Z: the toes are in front of the heels.
    const box = new Box3().setFromBufferAttribute(body.geometry.getAttribute("position") as never);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeGreaterThan(1.7);
    expect(box.max.y).toBeLessThan(1.85);
    // The skin is its own material; the rest is named for what it is.
    const mats = materialsOf(body).map((m) => m.name);
    expect(mats).toContain("cloth");
    expect(mats).toContain("skin");
  });

  it("binds every track of every clip to a bone of a cloned model", () => {
    expectBinds(asset.scene, asset.animations);
    for (const clip of asset.animations) expect(clip.tracks.some((t) => t.name === "hips.position"), clip.name).toBe(true);
  });

  it("loops its looping clips without a seam", () => {
    expectSeamless(asset.animations);
  });

  it("poses without NaNs, never below the ground, knees bending the right way, through every clip", () => {
    const { model, at, bone } = stage(asset.scene);
    const meshes = skinnedMeshes(model);
    const body = meshes.find((m) => contractName(m) === "body") as SkinnedMesh;
    for (const clip of asset.animations) {
      for (const t of times(clip)) {
        at(clip, t);
        for (const m of meshes) expect(measure(m).finite, `${kind} ${clip.name} ${contractName(m)} at ${t}`).toBe(true);
        expect(measure(body).low, `${kind} ${clip.name} at ${t.toFixed(2)}`).toBeGreaterThan(-0.05);
        for (const side of ["L", "R"]) {
          // The ankle is never ahead of the thigh's line: a knee only bends forward.
          const ankle = bone(`thigh.${side}`).worldToLocal(world(bone(`foot.${side}`)));
          expect(ankle.z, `${kind} ${clip.name} knee.${side} at ${t.toFixed(2)}`).toBeLessThan(0.03);
        }
      }
    }
  });
});

/** How fast the planted foot slides back over a stride: the ground speed the clip is made for. */
function groundSpeed(asset: LoadedAsset, name: string): number {
  const { at, bone } = stage(asset.scene);
  const clip = clipOf(asset, name);
  const n = 60;
  let sum = 0;
  let count = 0;
  let prev: { side: string; z: number } | null = null;
  for (let i = 0; i <= n; i++) {
    at(clip, (clip.duration * i) / n);
    const l = world(bone("foot.L"));
    const r = world(bone("foot.R"));
    const planted = l.y < r.y ? { side: "L", z: l.z, y: l.y } : { side: "R", z: r.z, y: r.y };
    if (prev && prev.side === planted.side && planted.y < 0.09) {
      sum += (prev.z - planted.z) / (clip.duration / n);
      count++;
    }
    prev = planted;
  }
  return sum / count;
}

describe("the soldier", () => {
  it("has the contract's variations and props where the game looks for them", () => {
    for (const v of ["var.helmet", "var.cap.officer", "var.ghillie", "var.pack", "var.sling"]) {
      const mesh = node(soldier.scene, v) as SkinnedMesh;
      expect(mesh.isSkinnedMesh, v).toBe(true);
      expect(mesh.skeleton, v).toBe((node(soldier.scene, "body") as SkinnedMesh).skeleton);
    }
    for (const p of ["gun.rifle", "gun.mg", "prop.binoculars"]) expect(contractName(node(soldier.scene, p).parent as Object3D), p).toBe("socket.gun");
    const cig = node(soldier.scene, "prop.cigarette");
    expect(contractName(cig.parent as Object3D)).toBe("socket.hand.L");
    const ember: Material[] = [];
    cig.traverse((o) => {
      if ((o as Mesh).isMesh) ember.push(...materialsOf(o as Mesh).filter((m) => m.name === "ember"));
    });
    expect(ember.length).toBe(1);
    // Nothing under a prop may look like a prop itself: the rig would take it for one.
    soldier.scene.traverse((o) => {
      const parent = o.parent ? contractName(o.parent) : "";
      if (parent.startsWith("gun.") || parent.startsWith("prop.")) expect(contractName(o)).not.toMatch(/^(gun|prop|var|socket)\./);
    });
  });

  it("stays within the triangle budget, dressed in any one variation with any one prop", () => {
    const body = triangles(node(soldier.scene, "body"));
    const vars = ["var.helmet", "var.cap.officer", "var.ghillie", "var.pack", "var.sling"].map((v) => triangles(node(soldier.scene, v)));
    const props = ["gun.rifle", "gun.mg", "prop.binoculars", "prop.cigarette"].map((p) => triangles(node(soldier.scene, p)));
    expect(body + Math.max(...vars) + Math.max(...props)).toBeLessThanOrEqual(3000);
  });

  it("aims the rifle along +Z, standing, firing and prone", () => {
    const { at, bone } = stage(soldier.scene);
    const socket = () => node(bone("hand.R"), "socket.gun");
    for (const name of ["aim", "prone_aim", "fire"]) {
      const clip = clipOf(soldier, name);
      at(clip, name === "fire" ? 0 : clip.duration / 2);
      const s = socket();
      const muzzle = s.localToWorld(new Vector3(0, -1, 0)).sub(world(s)).normalize();
      expect(muzzle.z, name).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
    }
    // Shouldered: the grip by the right shoulder, the muzzle well out in front.
    at(clipOf(soldier, "aim"), 0);
    const grip = world(socket());
    expect(grip.x).toBeLessThan(0);
    expect(grip.y).toBeGreaterThan(1.35);
    expect(grip.z).toBeGreaterThan(0.15);
  });

  it("lies prone along +Z: head forward, feet back, hips a hand's breadth up", () => {
    const { at, bone } = stage(soldier.scene);
    for (const name of ["prone", "prone_aim"]) {
      at(clipOf(soldier, name), 0);
      expect(world(bone("head")).z, name).toBeGreaterThan(0.55);
      expect(world(bone("foot.L")).z, name).toBeLessThan(-0.6);
      expect(world(bone("hips")).y, name).toBeLessThan(0.2);
      expect(world(bone("hips")).y, name).toBeGreaterThan(0.08);
    }
  });

  it("ends each death lying on the ground", () => {
    const { model, at, bone } = stage(soldier.scene);
    const body = node(model, "body") as SkinnedMesh;
    for (const name of ["death_back", "death_forward", "death_crumple"]) {
      const clip = clipOf(soldier, name);
      at(clip, clip.duration);
      expect(world(bone("hips")).y, name).toBeLessThan(0.3);
      expect(world(bone("head")).y, name).toBeLessThan(0.4);
      expect(measure(body).low, name).toBeCloseTo(0, 1);
    }
  });

  it("sits to drive with the hips 0.5 m above the root and the hands 0.45 m ahead", () => {
    const { at, bone } = stage(soldier.scene);
    at(clipOf(soldier, "drive"), 0);
    expect(world(bone("hips")).y).toBeCloseTo(0.5, 1);
    for (const side of ["L", "R"]) {
      const hand = world(bone(`hand.${side}`));
      expect(hand.z, side).toBeGreaterThan(0.3);
      expect(hand.z, side).toBeLessThan(0.55);
    }
  });

  it("jumps down from the truck bed to stand at the origin", () => {
    const { at, bone } = stage(soldier.scene);
    const clip = clipOf(soldier, "dismount");
    at(clip, 0);
    const start = world(bone("hips"));
    expect(start.y).toBeCloseTo(0.95 + 1.2, 1);
    expect(start.z).toBeCloseTo(-0.8, 1);
    at(clip, clip.duration);
    const end = world(bone("hips"));
    expect(end.y).toBeCloseTo(0.93, 1);
    expect(Math.abs(end.z)).toBeLessThan(0.05);
  });

  it("walks, patrols and runs at the speeds the game moves him", () => {
    expect(groundSpeed(soldier, "walk")).toBeCloseTo(1.4, 0);
    expect(groundSpeed(soldier, "patrol_walk")).toBeCloseTo(1.1, 0);
    expect(Math.abs(groundSpeed(soldier, "run") - 4) / 4).toBeLessThan(0.25);
  });
});

describe("the civilian", () => {
  it("has the four people and the crook, and nothing that looks like a weapon", () => {
    for (const v of ["var.person.farmer", "var.person.cyclist", "var.person.shepherd", "var.person.child"]) {
      expect((node(civilian.scene, v) as SkinnedMesh).isSkinnedMesh, v).toBe(true);
    }
    expect(contractName(node(civilian.scene, "prop.crook").parent as Object3D)).toBe("socket.gun");
    civilian.scene.traverse((o) => expect(contractName(o)).not.toMatch(/^gun\.|helmet/));
  });

  it("keeps the bicycle rigid at the scene root, its wheels and crank on pivots", () => {
    const bike = node(civilian.scene, "bicycle");
    expect(bike.parent).toBe(civilian.scene);
    bike.traverse((o) => expect((o as SkinnedMesh).isSkinnedMesh ?? false).toBe(false));
    const box = new Box3().setFromObject(bike);
    expect(box.max.z - box.min.z).toBeCloseTo(1.7, 1);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    const front = node(bike, "bicycle.wheel.front");
    const rear = node(bike, "bicycle.wheel.rear");
    expect(front.position.y).toBeCloseTo(BICYCLE.wheelRadius, 2);
    expect(rear.position.y).toBeCloseTo(BICYCLE.wheelRadius, 2);
    expect(front.position.z).toBeGreaterThan(0.3);
    expect(rear.position.z).toBeLessThan(-0.3);
    expect(node(bike, "bicycle.crank").position.toArray()).toEqual(BICYCLE.crank);
  });

  it("pedals in step with a crank turning once per cycle, seated at the rest hips height", () => {
    const { at, bone } = stage(civilian.scene);
    const clip = clipOf(civilian, "cycle");
    for (const t of times(clip, 6)) {
      at(clip, t);
      expect(world(bone("hips")).y).toBeCloseTo(0.95, 1);
      const a = crankAngle(t);
      const [, y, z] = BICYCLE.crank;
      // The right pedal leads; the ankle sits a little above and behind it.
      const pedal = new Vector3(-BICYCLE.pedalX, y - BICYCLE.crankLength * Math.sin(a), z + BICYCLE.crankLength * Math.cos(a));
      const ankle = world(bone("foot.R"));
      expect(ankle.distanceTo(pedal.add(new Vector3(0, 0.068, -0.1))), `t=${t}`).toBeLessThan(0.03);
    }
  });

  it("walks and panics at the speeds the game moves them", () => {
    expect(groundSpeed(civilian, "walk")).toBeCloseTo(1.3, 0);
    expect(Math.abs(groundSpeed(civilian, "panic") - 3) / 3).toBeLessThan(0.25);
  });

  it("stays within the triangle budget, a cyclist on the bicycle included", () => {
    const body = triangles(node(civilian.scene, "body"));
    for (const v of ["var.person.farmer", "var.person.shepherd", "var.person.child"]) {
      expect(body + triangles(node(civilian.scene, v)) + triangles(node(civilian.scene, "prop.crook")), v).toBeLessThanOrEqual(3000);
    }
    expect(body + triangles(node(civilian.scene, "var.person.cyclist")) + triangles(node(civilian.scene, "bicycle"))).toBeLessThanOrEqual(3000);
  });
});

describe("the animals", { timeout: 30_000 }, () => {
  const KINDS = ["cow", "sheep", "goat", "eagle", "dog"] as const;
  const clipsOf = (kind: string) => animals.animations.filter((c) => c.name.startsWith(`${kind}.`));

  it("are each a top-level node with its own armature and skinned mesh", () => {
    expect(animals.scene.children.map(contractName).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      const root = node(animals.scene, kind);
      const meshes = skinnedMeshes(root);
      expect(meshes.length, kind).toBe(1);
      const mesh = meshes[0] as SkinnedMesh;
      expect(mesh.frustumCulled).toBe(false);
      for (const b of mesh.skeleton.bones) {
        let inside = false;
        for (let o: Object3D | null = b; o; o = o.parent) if (o === root) inside = true;
        expect(inside, `${kind}: ${contractName(b)}`).toBe(true);
      }
      expect(triangles(root), kind).toBeLessThanOrEqual(2500);
    }
  });

  it("have clips that bind within their own animal", () => {
    for (const kind of KINDS) {
      const clips = clipsOf(kind);
      expect(clips.length, kind).toBeGreaterThan(0);
      expectBinds(node(animals.scene, kind), clips);
    }
    expectSeamless(animals.animations);
  });

  it("pose without NaNs, and stand on the ground (the eagle in flight excepted)", () => {
    for (const kind of KINDS) {
      const { model, at } = stage(node(animals.scene, kind));
      const mesh = skinnedMeshes(model)[0] as SkinnedMesh;
      for (const clip of clipsOf(kind)) {
        for (const t of times(clip)) {
          at(clip, t);
          const { low, finite } = measure(mesh);
          expect(finite, `${clip.name} at ${t}`).toBe(true);
          if (clip.name !== "eagle.glide" && clip.name !== "eagle.flap") expect(low, `${clip.name} at ${t.toFixed(2)}`).toBeGreaterThan(-0.05);
        }
      }
    }
  });

  it("graze with the muzzle down, look up with the head high, and the eagle lands on its feet", () => {
    for (const kind of ["cow", "sheep"]) {
      const { at, bone } = stage(node(animals.scene, kind));
      const graze = clipOf(animals, `${kind}.graze`);
      at(graze, 0);
      const down = world(bone("head")).y;
      const look = clipOf(animals, `${kind}.look_up`);
      at(look, look.duration);
      expect(world(bone("head")).y, kind).toBeGreaterThan(down + 0.25);
    }
    const { model, at } = stage(node(animals.scene, "eagle"));
    const land = clipOf(animals, "eagle.land");
    at(land, land.duration);
    expect(measure(skinnedMeshes(model)[0] as SkinnedMesh).low).toBeCloseTo(0, 1);
    const size = new Box3().setFromObject(node(animals.scene, "cow")).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(2.1);
    expect(size.z).toBeLessThan(2.5);
  });
});

describe("the vehicles", () => {
  const truck = node(vehicles.scene, "truck");
  const jeep = node(vehicles.scene, "jeep");

  it.each([
    ["truck", truck, 6, 6.8],
    ["jeep", jeep, 4, 3.4],
  ] as const)("the %s has its parts where the game looks for them", (kind, root, wheels, length) => {
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    expect(box.max.z - box.min.z, kind).toBeCloseTo(length, 0);
    expect(box.min.y, kind).toBeGreaterThan(-0.02);
    // Facing +Z: the bonnet, and so the engine, are in front.
    const engine = node(root, "engine") as Mesh;
    expect(engine.isMesh).toBe(true);
    expect(materialsOf(engine)[0]?.name).toBe("metal");
    const engineBox = new Box3().setFromObject(engine);
    expect(engineBox.min.z, kind).toBeGreaterThan(0);
    expect(box.containsBox(engineBox), kind).toBe(true);
    const glass = node(root, "cab.glass") as Mesh;
    expect(materialsOf(glass)[0]?.name).toBe("glass");
    expect(materialsOf(glass)[0]?.transparent).toBe(true);
    for (let i = 0; i < wheels; i++) {
      const pivot = node(root, `wheel.${i}`);
      const tyre = new Box3().setFromObject(pivot);
      // The pivot is at the hub: the wheel hangs round it, down to the ground.
      expect(tyre.getCenter(new Vector3()).distanceTo(world(pivot)), `${kind} wheel.${i}`).toBeLessThan(0.01);
      expect(tyre.min.y, `${kind} wheel.${i}`).toBeCloseTo(0, 1);
      expect(pivot.children.some((c) => (c as Mesh).isMesh)).toBe(true);
    }
    expect(findNode(root, `wheel.${wheels}`)).toBeNull();
    const driver = node(root, "seat.driver");
    expect((driver as Mesh).isMesh ?? false).toBe(false);
    expect(driver.position.x, "the driver sits on the left").toBeGreaterThan(0.2);
    root.traverse((o) => {
      if ((o as Mesh).isMesh) expect(["metal", "glass", "cloth"], contractName(o)).toContain(o.userData["surface"]);
    });
    expect(triangles(root), kind).toBeLessThanOrEqual(6000);
  });

  it("gives the truck a canvas-covered bed with four seats in the back, and the jeep a passenger seat", () => {
    const canvas: Material[] = [];
    truck.traverse((o) => {
      if ((o as Mesh).isMesh) canvas.push(...materialsOf(o as Mesh).filter((m) => m.name === "canvas"));
    });
    expect(canvas.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) expect(node(truck, `seat.back.${i}`).position.y).toBeCloseTo(1.2, 2);
    expect(findNode(truck, "seat.back.4")).toBeNull();
    expect(node(jeep, "seat.passenger").position.x).toBeLessThan(0);
  });
});
