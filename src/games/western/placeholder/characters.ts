import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import type { LoadedAsset } from "../../../engine/types";
import { nameNode } from "../world/names";
import { chickenClips, humanoidClips, townsfolkClips } from "./clips";

/**
 * Placeholder characters built to the contract the Blender characters follow
 * (docs/WEB_ARCHITECTURE.md): one skinned mesh on the shared humanoid armature
 * (hips, spine, chest, neck, head, shoulder/upper_arm/forearm/hand .L/.R,
 * thigh/shin/foot .L/.R), an empty `socket.gun` on `hand.R`, variation meshes
 * `var.hat.*`, `var.coat.*`, `var.bandana.*`, `var.vest`, `var.armour`, props
 * `gun.revolver`, `gun.rifle`, `prop.dynamite`, and the contract's clips.
 * Facing +Z, feet at the origin, clips in place. Primitive shapes, each bound
 * rigidly to one bone.
 */

type BoneDef = [name: string, parent: string | null, offset: [number, number, number]];

const HUMANOID: BoneDef[] = [
  ["hips", null, [0, 0.95, 0]],
  ["spine", "hips", [0, 0.12, 0]],
  ["chest", "spine", [0, 0.2, 0]],
  ["neck", "chest", [0, 0.2, 0]],
  ["head", "neck", [0, 0.09, 0.01]],
  ["shoulder.L", "chest", [0.07, 0.17, 0]],
  ["upper_arm.L", "shoulder.L", [0.12, 0, 0]],
  ["forearm.L", "upper_arm.L", [0, -0.28, 0]],
  ["hand.L", "forearm.L", [0, -0.25, 0]],
  ["shoulder.R", "chest", [-0.07, 0.17, 0]],
  ["upper_arm.R", "shoulder.R", [-0.12, 0, 0]],
  ["forearm.R", "upper_arm.R", [0, -0.28, 0]],
  ["hand.R", "forearm.R", [0, -0.25, 0]],
  ["thigh.L", "hips", [0.1, -0.05, 0]],
  ["shin.L", "thigh.L", [0, -0.43, 0]],
  ["foot.L", "shin.L", [0, -0.42, 0]],
  ["thigh.R", "hips", [-0.1, -0.05, 0]],
  ["shin.R", "thigh.R", [0, -0.43, 0]],
  ["foot.R", "shin.R", [0, -0.42, 0]],
];

interface Rig {
  armature: Object3D;
  bones: Bone[];
  byName: Map<string, Bone>;
  skeleton: Skeleton;
}

function buildSkeleton(defs: BoneDef[]): Rig {
  const byName = new Map<string, Bone>();
  const bones: Bone[] = [];
  const armature = nameNode(new Object3D(), "Armature");
  for (const [name, parent, offset] of defs) {
    const bone = nameNode(new Bone(), name);
    bone.position.set(...offset);
    (parent ? (byName.get(parent) as Bone) : armature).add(bone);
    byName.set(name, bone);
    bones.push(bone);
  }
  armature.updateMatrixWorld(true);
  return { armature, bones, byName, skeleton: new Skeleton(bones) };
}

/** Accumulates rigid parts into one skinned geometry. */
class SkinGeometry {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private wgt: number[] = [];
  constructor(private readonly rig: Rig) {}

  part(
    geometry: BufferGeometry,
    bone: string,
    color: Color | string,
    at: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
  ): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const m = new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
    const nm = new Matrix3().getNormalMatrix(m);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = typeof color === "string" ? new Color(color) : color;
    const bi = this.rig.bones.findIndex((b) => b.userData["name"] === bone);
    if (bi < 0) throw new Error(`no bone ${bone}`);
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.col.push(c.r, c.g, c.b);
      this.idx.push(bi, 0, 0, 0);
      this.wgt.push(1, 0, 0, 0);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(this.idx), 4));
    g.setAttribute("skinWeight", new BufferAttribute(new Float32Array(this.wgt), 4));
    g.computeBoundingSphere();
    // Skinned bounds move with the pose; a generous sphere keeps culling honest.
    if (g.boundingSphere) g.boundingSphere.radius = Math.max(g.boundingSphere.radius, 1.4);
    return g;
  }
}

function skinned(rig: Rig, name: string, geometry: BufferGeometry, material: Material): SkinnedMesh {
  const mesh = nameNode(new SkinnedMesh(geometry, material), name);
  mesh.bind(rig.skeleton, new Matrix4());
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

const cloth = (rough = 0.85) => new MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0, name: "cloth" });
const metal = () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.85, name: "metal" });

const box = (x: number, y: number, z: number) => new BoxGeometry(x, y, z);
const cap = (r: number, len: number) => new CapsuleGeometry(r, len, 4, 10);
const cyl = (rt: number, rb: number, h: number, seg = 14) => new CylinderGeometry(rt, rb, h, seg);

interface BodyColors {
  skin: string;
  shirt: string;
  trousers: string;
  boots: string;
  belt: string;
  sleeves?: string;
}

/** The body every humanoid shares: the parts that are always there. */
function body(rig: Rig, c: BodyColors, woman = false): SkinGeometry {
  const s = new SkinGeometry(rig);
  const sleeves = c.sleeves ?? c.shirt;
  s.part(box(0.32, 0.2, 0.2), "hips", c.trousers, [0, 0.95, 0]);
  s.part(box(0.335, 0.06, 0.215), "hips", c.belt, [0, 1.03, 0]);
  s.part(box(0.07, 0.05, 0.03), "hips", "#b8a05a", [0, 1.03, 0.11]);
  s.part(box(0.3, 0.22, 0.19), "spine", c.shirt, [0, 1.13, 0]);
  s.part(box(0.38, 0.26, 0.22), "chest", c.shirt, [0, 1.33, 0], [0, 0, 0], [1, 1, 1]);
  s.part(box(0.44, 0.1, 0.2), "chest", c.shirt, [0, 1.43, 0]);
  s.part(cyl(0.05, 0.055, 0.12, 10), "neck", c.skin, [0, 1.51, 0.005]);
  s.part(new IcosahedronGeometry(0.105, 2), "head", c.skin, [0, 1.64, 0.012], [0, 0, 0], [0.95, 1.14, 1.02]);
  s.part(box(0.035, 0.055, 0.045), "head", c.skin, [0, 1.625, 0.118]);
  s.part(box(0.022, 0.018, 0.01), "head", "#1d1612", [0.04, 1.665, 0.1]);
  s.part(box(0.022, 0.018, 0.01), "head", "#1d1612", [-0.04, 1.665, 0.1]);
  s.part(cap(0.052, 0.18), "upper_arm.L", sleeves, [0.19, 1.3, 0]);
  s.part(cap(0.052, 0.18), "upper_arm.R", sleeves, [-0.19, 1.3, 0]);
  s.part(cap(0.044, 0.17), "forearm.L", sleeves, [0.19, 1.035, 0]);
  s.part(cap(0.044, 0.17), "forearm.R", sleeves, [-0.19, 1.035, 0]);
  s.part(box(0.07, 0.1, 0.05), "hand.L", c.skin, [0.19, 0.86, 0.005]);
  s.part(box(0.07, 0.1, 0.05), "hand.R", c.skin, [-0.19, 0.86, 0.005]);
  if (!woman) {
    s.part(cap(0.078, 0.28), "thigh.L", c.trousers, [0.1, 0.69, 0]);
    s.part(cap(0.078, 0.28), "thigh.R", c.trousers, [-0.1, 0.69, 0]);
  }
  s.part(cap(0.06, 0.26), "shin.L", c.trousers, [0.1, 0.27, 0]);
  s.part(cap(0.06, 0.26), "shin.R", c.trousers, [-0.1, 0.27, 0]);
  s.part(cap(0.066, 0.14), "shin.L", c.boots, [0.1, 0.18, 0]);
  s.part(cap(0.066, 0.14), "shin.R", c.boots, [-0.1, 0.18, 0]);
  s.part(box(0.1, 0.09, 0.25), "foot.L", c.boots, [0.1, 0.045, 0.05]);
  s.part(box(0.1, 0.09, 0.25), "foot.R", c.boots, [-0.1, 0.045, 0.05]);
  return s;
}

function hat(rig: Rig, kind: "stetson" | "bowler" | "flat" | "straw" | "bonnet" | "top", color: string, band = "#2a1d14"): BufferGeometry {
  const s = new SkinGeometry(rig);
  switch (kind) {
    case "stetson":
      s.part(cyl(0.22, 0.22, 0.02, 20), "head", color, [0, 1.735, 0.01], [0.05, 0, 0]);
      s.part(cyl(0.095, 0.115, 0.14, 16), "head", color, [0, 1.81, 0.01]);
      s.part(cyl(0.117, 0.117, 0.03, 16), "head", band, [0, 1.76, 0.01]);
      s.part(box(0.02, 0.03, 0.2), "head", color, [0, 1.88, 0.01]);
      break;
    case "bowler":
      s.part(cyl(0.155, 0.155, 0.018, 20), "head", color, [0, 1.735, 0.01]);
      s.part(new SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), "head", color, [0, 1.74, 0.01], [0, 0, 0], [1, 1.05, 1]);
      s.part(cyl(0.114, 0.114, 0.025, 16), "head", band, [0, 1.755, 0.01]);
      break;
    case "flat":
      s.part(cyl(0.25, 0.25, 0.018, 22), "head", color, [0, 1.735, 0.01]);
      s.part(cyl(0.11, 0.115, 0.09, 16), "head", color, [0, 1.785, 0.01]);
      s.part(cyl(0.117, 0.117, 0.025, 16), "head", band, [0, 1.755, 0.01]);
      break;
    case "straw":
      s.part(cyl(0.26, 0.26, 0.016, 22), "head", color, [0, 1.73, 0.01]);
      s.part(cyl(0.1, 0.112, 0.1, 16), "head", color, [0, 1.785, 0.01]);
      s.part(cyl(0.114, 0.114, 0.022, 16), "head", band, [0, 1.75, 0.01]);
      break;
    case "bonnet":
      s.part(new SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), "head", color, [0, 1.63, -0.01], [-0.35, 0, 0], [1, 1.1, 1.1]);
      s.part(cyl(0.14, 0.14, 0.02, 18), "head", color, [0, 1.7, 0.07], [1.2, 0, 0]);
      break;
    case "top":
      s.part(cyl(0.17, 0.17, 0.016, 20), "head", color, [0, 1.735, 0.01]);
      s.part(cyl(0.1, 0.095, 0.22, 16), "head", color, [0, 1.85, 0.01]);
      s.part(cyl(0.101, 0.101, 0.03, 16), "head", band, [0, 1.76, 0.01]);
      break;
  }
  return s.build();
}

function coat(rig: Rig, color: string, long: boolean, trim?: string): BufferGeometry {
  const s = new SkinGeometry(rig);
  s.part(box(0.42, 0.3, 0.25), "chest", color, [0, 1.32, -0.005]);
  s.part(box(0.48, 0.1, 0.24), "chest", color, [0, 1.44, -0.005]);
  s.part(box(0.34, 0.24, 0.225), "spine", color, [0, 1.12, -0.005]);
  // Lapels.
  s.part(box(0.06, 0.26, 0.02), "chest", trim ?? new Color(color).multiplyScalar(0.7), [0.07, 1.32, 0.12], [0, 0, -0.15]);
  s.part(box(0.06, 0.26, 0.02), "chest", trim ?? new Color(color).multiplyScalar(0.7), [-0.07, 1.32, 0.12], [0, 0, 0.15]);
  s.part(cap(0.062, 0.18), "upper_arm.L", color, [0.19, 1.3, 0]);
  s.part(cap(0.062, 0.18), "upper_arm.R", color, [-0.19, 1.3, 0]);
  s.part(cap(0.054, 0.15), "forearm.L", color, [0.19, 1.05, 0]);
  s.part(cap(0.054, 0.15), "forearm.R", color, [-0.19, 1.05, 0]);
  if (long) {
    // Duster skirts, one on each thigh so they swing with the legs.
    s.part(box(0.2, 0.62, 0.26), "thigh.L", color, [0.1, 0.66, -0.01], [0, 0, 0.06]);
    s.part(box(0.2, 0.62, 0.26), "thigh.R", color, [-0.1, 0.66, -0.01], [0, 0, -0.06]);
    s.part(box(0.36, 0.16, 0.24), "hips", color, [0, 0.93, -0.005]);
  } else {
    s.part(box(0.36, 0.2, 0.24), "hips", color, [0, 0.93, -0.005]);
  }
  return s.build();
}

function dress(rig: Rig, color: string): BufferGeometry {
  const s = new SkinGeometry(rig);
  s.part(cyl(0.2, 0.34, 0.85, 18), "hips", color, [0, 0.52, 0]);
  s.part(box(0.36, 0.2, 0.22), "hips", color, [0, 0.98, 0]);
  return s.build();
}

function apron(rig: Rig): BufferGeometry {
  const s = new SkinGeometry(rig);
  s.part(box(0.3, 0.5, 0.02), "hips", "#f1eee6", [0, 0.8, 0.115]);
  s.part(box(0.24, 0.24, 0.02), "chest", "#f1eee6", [0, 1.28, 0.125]);
  return s.build();
}

function bandana(rig: Rig, color: string): BufferGeometry {
  const s = new SkinGeometry(rig);
  s.part(box(0.2, 0.09, 0.05), "head", color, [0, 1.585, 0.095]);
  s.part(new CylinderGeometry(0.075, 0.001, 0.09, 3), "head", color, [0, 1.52, 0.1], [0, Math.PI / 6, Math.PI]);
  s.part(cyl(0.065, 0.065, 0.05, 12), "neck", color, [0, 1.49, 0.01]);
  return s.build();
}

function vest(rig: Rig, color: string): BufferGeometry {
  const s = new SkinGeometry(rig);
  s.part(box(0.395, 0.3, 0.232), "chest", color, [0, 1.3, 0]);
  s.part(box(0.31, 0.2, 0.2), "spine", color, [0, 1.13, 0]);
  s.part(box(0.02, 0.02, 0.01), "chest", "#c9b060", [0.05, 1.2, 0.12]);
  return s.build();
}

function armour(rig: Rig): BufferGeometry {
  const s = new SkinGeometry(rig);
  s.part(box(0.32, 0.36, 0.04), "chest", "#7a7672", [0, 1.26, 0.13]);
  s.part(box(0.27, 0.16, 0.035), "spine", "#6d6965", [0, 1.07, 0.115]);
  for (const [x, y] of [
    [0.13, 1.42],
    [-0.13, 1.42],
    [0.13, 1.1],
    [-0.13, 1.1],
  ] as [number, number][]) {
    s.part(new SphereGeometry(0.012, 6, 4), "chest", "#4a4744", [x, y, 0.152]);
  }
  // Straps over the shoulders.
  s.part(box(0.05, 0.03, 0.26), "chest", "#3b2a1c", [0.12, 1.46, 0]);
  s.part(box(0.05, 0.03, 0.26), "chest", "#3b2a1c", [-0.12, 1.46, 0]);
  return s.build();
}

/** Guns and dynamite hang from `socket.gun`, pointing along the hand (its −Y). */
function props(socket: Object3D, silver = false): void {
  const steel = new MeshStandardMaterial({ color: silver ? "#b9b6ae" : "#2d2c2c", roughness: silver ? 0.25 : 0.4, metalness: 0.9, name: "gunmetal" });
  const wood = new MeshStandardMaterial({ color: "#5a3a22", roughness: 0.7, name: "grip" });
  const revolver = nameNode(new Group(), "gun.revolver");
  const grip = new Mesh(box(0.035, 0.1, 0.04), wood);
  grip.position.set(0, 0.03, -0.02);
  grip.rotation.x = -0.35;
  const frame = new Mesh(box(0.03, 0.07, 0.05), steel);
  frame.position.set(0, -0.03, 0.0);
  const cylinder = new Mesh(cyl(0.022, 0.022, 0.05, 8), steel);
  cylinder.position.set(0, -0.05, 0.012);
  const barrel = new Mesh(cyl(0.009, 0.009, 0.17, 8), steel);
  barrel.position.set(0, -0.15, 0.022);
  revolver.add(grip, frame, cylinder, barrel);
  const rifle = nameNode(new Group(), "gun.rifle");
  const stock = new Mesh(box(0.04, 0.34, 0.07), wood);
  stock.position.set(0, 0.2, -0.01);
  const receiver = new Mesh(box(0.035, 0.16, 0.05), steel);
  receiver.position.set(0, -0.05, 0.01);
  const long = new Mesh(cyl(0.011, 0.011, 0.72, 8), steel);
  long.position.set(0, -0.48, 0.02);
  const fore = new Mesh(box(0.04, 0.3, 0.045), wood);
  fore.position.set(0, -0.28, 0.0);
  rifle.add(stock, receiver, long, fore);
  const dyn = nameNode(new Group(), "prop.dynamite");
  const stick = new Mesh(cyl(0.022, 0.022, 0.2, 10), new MeshStandardMaterial({ color: "#a8231b", roughness: 0.7, name: "dynamite" }));
  stick.position.set(0, -0.05, 0.02);
  const fuse = new Mesh(cyl(0.003, 0.003, 0.06, 4), new MeshStandardMaterial({ color: "#d9c9a0", roughness: 0.9 }));
  fuse.position.set(0, -0.18, 0.02);
  dyn.add(stick, fuse);
  for (const p of [revolver, rifle, dyn]) {
    p.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
    });
    socket.add(p);
  }
  rifle.visible = false;
  dyn.visible = false;
}

function humanoid(name: string, colors: BodyColors, woman = false): { root: Group; rig: Rig; clothMat: MeshStandardMaterial } {
  const rig = buildSkeleton(HUMANOID);
  const root = nameNode(new Group(), name);
  root.add(rig.armature);
  const clothMat = cloth();
  rig.armature.add(skinned(rig, "body", body(rig, colors, woman).build(), clothMat));
  const socket = nameNode(new Object3D(), "socket.gun");
  socket.position.set(0, -0.07, 0.015);
  (rig.byName.get("hand.R") as Bone).add(socket);
  return { root, rig, clothMat };
}

const HIPS_REST: [number, number, number] = [0, 0.95, 0];

export function buildBanditAsset(): LoadedAsset {
  const { root, rig, clothMat } = humanoid("bandit", {
    skin: "#b98a68",
    shirt: "#8a6f58",
    trousers: "#3c3833",
    boots: "#2b211a",
    belt: "#3a2a1c",
  });
  const add = (n: string, g: BufferGeometry, m: Material = clothMat) => rig.armature.add(skinned(rig, n, g, m));
  add("var.hat.stetson", hat(rig, "stetson", "#5b4331"));
  add("var.hat.bowler", hat(rig, "bowler", "#211e1c", "#3b3530"));
  add("var.hat.flat", hat(rig, "flat", "#34302c"));
  add("var.coat.duster", coat(rig, "#6f5d48", true));
  add("var.coat.jacket", coat(rig, "#3e3b37", false));
  add("var.bandana.red", bandana(rig, "#9c2a22"));
  add("var.bandana.black", bandana(rig, "#1e1d1c"));
  add("var.vest", vest(rig, "#4a3a2b"));
  add("var.armour", armour(rig), metal());
  props(rig.byName.get("hand.R")?.children.find((c) => c.userData["name"] === "socket.gun") as Object3D);
  return { scene: root, animations: humanoidClips(HIPS_REST) };
}

export function buildBossAsset(): LoadedAsset {
  const { root, rig, clothMat } = humanoid("boss", {
    skin: "#a57a5c",
    shirt: "#2c2826",
    trousers: "#1f1d1c",
    boots: "#171210",
    belt: "#2a1c12",
  });
  const add = (n: string, g: BufferGeometry, m: Material = clothMat) => rig.armature.add(skinned(rig, n, g, m));
  add("var.hat.stetson", hat(rig, "stetson", "#141211", "#6d5a3a"));
  add("var.coat.duster", coat(rig, "#1c1a19", true, "#3a2f28"));
  // The scar, and a grey moustache.
  const face = new SkinGeometry(rig);
  face.part(box(0.012, 0.075, 0.01), "head", "#6b2a22", [0.055, 1.635, 0.098], [0, 0, 0.35]);
  face.part(box(0.1, 0.022, 0.02), "head", "#8d857c", [0, 1.595, 0.108]);
  add("face", face.build());
  props(rig.byName.get("hand.R")?.children.find((c) => c.userData["name"] === "socket.gun") as Object3D, true);
  return { scene: root, animations: humanoidClips(HIPS_REST) };
}

export function buildTownsfolkAsset(): LoadedAsset {
  const { root, rig, clothMat } = humanoid("townsfolk", {
    skin: "#e0b596",
    shirt: "#ece6d8",
    trousers: "#8b857b",
    boots: "#4a3a2c",
    belt: "#5a4633",
  });
  const add = (n: string, g: BufferGeometry, m: Material = clothMat) => rig.armature.add(skinned(rig, n, g, m));
  add("var.hat.straw", hat(rig, "straw", "#e0c889", "#8a5a3a"));
  add("var.hat.bonnet", hat(rig, "bonnet", "#e9dfcf"));
  add("var.hat.top", hat(rig, "top", "#191716"));
  add("var.coat.apron", apron(rig));
  add("var.coat.dress", dress(rig, "#c9b8d6"));
  add("var.coat.black", coat(rig, "#1d1b1a", true));
  add("var.vest", vest(rig, "#6b4c3a"));
  return { scene: root, animations: townsfolkClips(HIPS_REST) };
}

export function buildChickenAsset(): LoadedAsset {
  const defs: BoneDef[] = [
    ["body", null, [0, 0.24, 0]],
    ["neck", "body", [0, 0.07, 0.1]],
    ["head", "neck", [0, 0.1, 0.02]],
    ["leg.L", "body", [0.05, -0.06, 0]],
    ["leg.R", "body", [-0.05, -0.06, 0]],
    ["wing.L", "body", [0.1, 0.03, 0]],
    ["wing.R", "body", [-0.1, 0.03, 0]],
    ["tail", "body", [0, 0.05, -0.12]],
  ];
  const rig = buildSkeleton(defs);
  const root = nameNode(new Group(), "chicken");
  root.add(rig.armature);
  const s = new SkinGeometry(rig);
  s.part(new SphereGeometry(0.12, 14, 10), "body", "#f3eee4", [0, 0.25, 0], [0, 0, 0], [0.85, 0.85, 1.2]);
  s.part(new SphereGeometry(0.06, 12, 8), "neck", "#f3eee4", [0, 0.34, 0.11], [0, 0, 0], [0.9, 1.3, 0.9]);
  s.part(new SphereGeometry(0.05, 12, 8), "head", "#f5f1e9", [0, 0.42, 0.13]);
  s.part(box(0.015, 0.05, 0.06), "head", "#c42b21", [0, 0.475, 0.125]);
  s.part(new CylinderGeometry(0.001, 0.016, 0.04, 6), "head", "#e5a42b", [0, 0.415, 0.185], [Math.PI / 2, 0, 0]);
  s.part(box(0.012, 0.03, 0.012), "head", "#c42b21", [0, 0.385, 0.16]);
  s.part(box(0.02, 0.02, 0.01), "head", "#111", [0.035, 0.43, 0.15]);
  s.part(box(0.02, 0.02, 0.01), "head", "#111", [-0.035, 0.43, 0.15]);
  for (const side of [1, -1]) {
    const leg = side > 0 ? "leg.L" : "leg.R";
    s.part(cyl(0.01, 0.01, 0.13, 6), leg, "#e5a42b", [side * 0.05, 0.1, 0]);
    s.part(box(0.05, 0.01, 0.07), leg, "#e5a42b", [side * 0.05, 0.035, 0.02]);
    s.part(new SphereGeometry(0.07, 10, 6), side > 0 ? "wing.L" : "wing.R", "#e8e1d4", [side * 0.1, 0.27, -0.01], [0, 0, 0], [0.35, 0.7, 1.1]);
  }
  s.part(new SphereGeometry(0.06, 10, 6), "tail", "#ebe4d7", [0, 0.33, -0.13], [-0.6, 0, 0], [0.5, 1.2, 0.8]);
  // Not "body": that is the root bone's name, and a clip binding by name must find the bone.
  rig.armature.add(skinned(rig, "chicken.mesh", s.build(), cloth(0.9)));
  return { scene: root, animations: chickenClips([0, 0.24, 0]) };
}
