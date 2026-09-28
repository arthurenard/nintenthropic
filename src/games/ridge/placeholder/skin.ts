import {
  AnimationClip,
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InterpolateSmooth,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  VectorKeyframeTrack,
  type ColorRepresentation,
  type KeyframeTrack,
  type Material,
} from "three";
import { nameNode } from "../../../engine/world/names";

/**
 * The kit Overwatch Ridge's placeholder figures are built from: the shared
 * humanoid armature, an accumulator that binds primitive shapes rigidly to
 * one bone each, a clip builder that turns a few key poses into the kind of
 * clip a Blender export carries (quaternion tracks by the glTF loader's
 * sanitised bone names, plus the root bone's translation), and a small
 * solver that puts hands on a rifle and feet on the ground so the poses are
 * right without hand-tuning every angle.
 *
 * These are development stand-ins, loaded only outside production. They are
 * built to the same contract as the real files (docs/OVERWATCH_RIDGE.md,
 * "Characters and vehicles"): Y up, metres, facing +Z, feet at the origin,
 * clips in place. Through a 6× scope a man at 300 m is some 55 px tall, so
 * the shapes are bold and the colours strong, and the detail stops there.
 */

export type V3 = [number, number, number];

/** Every clip name each placeholder carries, in the order it carries them. */
export const FIGURE_CLIPS = {
  soldier: [
    "idle",
    "idle_smoke",
    "look_binoculars",
    "walk",
    "patrol_walk",
    "run",
    "crouch",
    "prone",
    "prone_aim",
    "aim",
    "fire",
    "hit_body",
    "wound_kneel",
    "death_back",
    "death_forward",
    "death_crumple",
    "dismount",
    "drive",
  ],
  civilian: ["idle", "walk", "cycle", "wave", "panic", "duck"],
  animals: [
    "cow.graze",
    "cow.walk",
    "cow.look_up",
    "sheep.graze",
    "sheep.walk",
    "sheep.look_up",
    "goat.stand",
    "goat.hop",
    "goat.bleat",
    "eagle.glide",
    "eagle.flap",
    "eagle.land",
    "dog.idle",
    "dog.run",
  ],
  vehicles: [],
} as const satisfies Record<string, readonly string[]>;

/** The clips that play once and hold their last frame; every other clip loops. */
export const ONE_SHOT_CLIPS: ReadonlySet<string> = new Set([
  "fire",
  "hit_body",
  "wound_kneel",
  "death_back",
  "death_forward",
  "death_crumple",
  "dismount",
  "cow.look_up",
  "sheep.look_up",
  "goat.hop",
  "goat.bleat",
  "eagle.land",
]);

// --- the armature ------------------------------------------------------------------

export type BoneDef = readonly [name: string, parent: string | null, offset: V3];

/**
 * High Noon's humanoid, bone for bone: the same names and proportions, so
 * one set of joints serves both games. Rest rotations are all identity, so
 * a bone's local axes are the figure's: +X its left, +Y up, +Z its front.
 */
export const HUMANOID: readonly BoneDef[] = [
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

export const HUMANOID_BONES: readonly string[] = HUMANOID.map(([n]) => n);

/** Where the hips rest above the feet. */
export const HIPS_REST: V3 = [0, 0.95, 0];

/** The grip on `hand.R` (as in High Noon), and its twin on `hand.L`, in the hand's frame. */
export const SOCKET_GUN: V3 = [0, -0.07, 0.015];
export const SOCKET_HAND_L: V3 = [0, -0.07, 0.015];

export interface Armature {
  armature: Object3D;
  bones: Bone[];
  byName: Map<string, Bone>;
  skeleton: Skeleton;
}

export function buildSkeleton(defs: readonly BoneDef[]): Armature {
  const byName = new Map<string, Bone>();
  const bones: Bone[] = [];
  const armature = nameNode(new Object3D(), "Armature");
  for (const [name, parent, offset] of defs) {
    const bone = nameNode(new Bone(), name);
    bone.position.set(...offset);
    const into = parent === null ? armature : byName.get(parent);
    if (!into) throw new Error(`bone ${name}: its parent ${parent} comes later or not at all`);
    into.add(bone);
    byName.set(name, bone);
    bones.push(bone);
  }
  // The skeleton's inverse bind matrices are read from the bones' world matrices now.
  armature.updateMatrixWorld(true);
  return { armature, bones, byName, skeleton: new Skeleton(bones) };
}

export function boneOf(arm: Armature, name: string): Bone {
  const b = arm.byName.get(name);
  if (!b) throw new Error(`no bone ${name}`);
  return b;
}

// --- materials -------------------------------------------------------------------

interface Finish {
  roughness: number;
  metalness: number;
  emissive?: string;
  intensity?: number;
  opacity?: number;
  twoSided?: boolean;
}

/** How each kind of surface takes the light. Colours come from the vertices. */
const FINISHES: Record<string, Finish> = {
  cloth: { roughness: 0.88, metalness: 0 },
  skin: { roughness: 0.6, metalness: 0 },
  hair: { roughness: 0.8, metalness: 0 },
  leather: { roughness: 0.72, metalness: 0 },
  wood: { roughness: 0.68, metalness: 0 },
  straw: { roughness: 0.9, metalness: 0 },
  wool: { roughness: 0.96, metalness: 0 },
  fur: { roughness: 0.92, metalness: 0 },
  feather: { roughness: 0.86, metalness: 0 },
  horn: { roughness: 0.5, metalness: 0 },
  paper: { roughness: 0.8, metalness: 0 },
  rubber: { roughness: 0.93, metalness: 0 },
  // Seen from inside too: a truck's tilt is open at the back.
  canvas: { roughness: 0.95, metalness: 0, twoSided: true },
  // Gun metal: oiled, blued steel.
  metal: { roughness: 0.4, metalness: 0.85 },
  // Painted steel: a helmet, a truck's body. Named "metal" all the same.
  painted: { roughness: 0.62, metalness: 0.3 },
  glass: { roughness: 0.1, metalness: 0.2, opacity: 0.55 },
  // A lit cigarette's tip: it glows by itself, and the bloom finds it at dusk.
  ember: { roughness: 0.6, metalness: 0, emissive: "#ff5a14", intensity: 3 },
};

/**
 * One asset's materials, shared by its meshes. A spec is the material's name,
 * optionally with a finish after a colon: "metal:painted" is named "metal"
 * (the name the game reads) but finished like paint rather than bare steel.
 */
export class Materials {
  private readonly cache = new Map<string, MeshStandardMaterial>();

  get(spec: string): MeshStandardMaterial {
    let m = this.cache.get(spec);
    if (m) return m;
    const [name = "cloth", finishName] = spec.split(":");
    const f = FINISHES[finishName ?? name] ?? { roughness: 0.85, metalness: 0 };
    m = new MeshStandardMaterial({ name, vertexColors: true, roughness: f.roughness, metalness: f.metalness });
    if (f.emissive) {
      m.emissive.set(f.emissive);
      m.emissiveIntensity = f.intensity ?? 1;
    }
    if (f.opacity !== undefined) {
      m.transparent = true;
      m.opacity = f.opacity;
      m.depthWrite = false;
    }
    if (f.twoSided) m.side = DoubleSide;
    this.cache.set(spec, m);
    return m;
  }
}

// --- geometry --------------------------------------------------------------------

export const box = (x: number, y: number, z: number): BufferGeometry => new BoxGeometry(x, y, z);
export const cap = (r: number, len: number, capSeg = 2, radial = 8): BufferGeometry => new CapsuleGeometry(r, len, capSeg, radial);
export const cyl = (rt: number, rb: number, h: number, seg = 10, open = false): BufferGeometry => new CylinderGeometry(rt, rb, h, seg, 1, open);
export const ball = (r: number, w = 10, h = 7): BufferGeometry => new SphereGeometry(r, w, h);
/** The top half of a sphere: a helmet's shell, a hat's crown. */
export const dome = (r: number, w = 12, h = 4): BufferGeometry => new SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
/** A lumpy low-poly ball: wool, ghillie tufts. */
export const blob = (r: number, detail = 0): BufferGeometry => new IcosahedronGeometry(r, detail);

type Tint = ColorRepresentation;
/** Euler angles in radians (XYZ, as three's default), or a quaternion. */
type Rot = V3 | Quaternion;

interface Slot {
  pos: number[];
  nor: number[];
  col: number[];
  bone: number[];
}

const UP = new Vector3(0, 1, 0);

/** A cylinder's placement between two points: its centre, its turn from +Y, its length. */
export function between(a: V3, b: V3): { at: V3; rot: Quaternion; len: number } {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const rot = new Quaternion().setFromUnitVectors(UP, len > 1e-9 ? d.divideScalar(len) : UP);
  return { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot, len };
}

/**
 * Parts accumulated into one geometry, grouped by material. The current
 * material (`mat()`) applies to every part added after it, so a body reads
 * as a list: `s.mat("skin").part(...)`.
 */
abstract class Parts {
  protected readonly slots = new Map<string, Slot>();
  private current = "cloth";

  /** Parts added from now on take this material (see Materials.get for the spec). */
  mat(spec: string): this {
    this.current = spec;
    return this;
  }

  protected push(geometry: BufferGeometry, color: Tint, at: V3, rot: Rot, scale: V3, bone: number): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const q = rot instanceof Quaternion ? rot : new Quaternion().setFromEuler(new Euler(rot[0], rot[1], rot[2]));
    const m = new Matrix4().compose(new Vector3(...at), q, new Vector3(...scale));
    const nm = new Matrix3().getNormalMatrix(m);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = new Color(color);
    let slot = this.slots.get(this.current);
    if (!slot) {
      slot = { pos: [], nor: [], col: [], bone: [] };
      this.slots.set(this.current, slot);
    }
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      slot.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      slot.nor.push(v.x, v.y, v.z);
      slot.col.push(c.r, c.g, c.b);
      slot.bone.push(bone);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
  }

  get triangles(): number {
    let n = 0;
    for (const s of this.slots.values()) n += s.pos.length / 9;
    return n;
  }

  get empty(): boolean {
    return this.slots.size === 0;
  }

  /** One geometry, a group per material in the order they were first used. */
  protected assemble(skin: boolean): { geometry: BufferGeometry; specs: string[] } {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const wgt: number[] = [];
    const g = new BufferGeometry();
    const specs: string[] = [];
    for (const [spec, s] of this.slots) {
      const start = pos.length / 3;
      for (let i = 0; i < s.pos.length; i++) pos.push(s.pos[i] as number);
      for (let i = 0; i < s.nor.length; i++) nor.push(s.nor[i] as number);
      for (let i = 0; i < s.col.length; i++) col.push(s.col[i] as number);
      for (const b of s.bone) {
        idx.push(b, 0, 0, 0);
        wgt.push(1, 0, 0, 0);
      }
      if (this.slots.size > 1) g.addGroup(start, s.pos.length / 3, specs.length);
      specs.push(spec);
    }
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    if (skin) {
      g.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(idx), 4));
      g.setAttribute("skinWeight", new BufferAttribute(new Float32Array(wgt), 4));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, specs };
  }
}

function materialsFor(specs: string[], mats: Materials): Material | Material[] {
  const list = specs.map((s) => mats.get(s));
  return list.length === 1 ? (list[0] as Material) : list;
}

/** The bind-pose vertices of a skinned geometry, each with its one bone, for settling poses on the ground. */
export interface SkinPoints {
  pos: Float32Array;
  bone: Uint16Array;
}

/** Rigid parts, each bound wholly to one bone, gathered into one skinned mesh. */
export class SkinGeometry extends Parts {
  constructor(private readonly arm: Armature) {
    super();
  }

  private index(bone: string): number {
    const i = this.arm.bones.findIndex((b) => b.userData["name"] === bone);
    if (i < 0) throw new Error(`no bone ${bone}`);
    return i;
  }

  /** A shape placed in the bind pose (the armature's rest, in metres), bound to `bone`. */
  part(geometry: BufferGeometry, bone: string, color: Tint, at: V3, rot: Rot = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    this.push(geometry, color, at, rot, scale, this.index(bone));
    return this;
  }

  /** A rod from `a` to `b`, radius `r` (tapering to `rb`). */
  rod(bone: string, color: Tint, a: V3, b: V3, r: number, seg = 6, rb = r): this {
    const { at, rot, len } = between(a, b);
    return this.part(cyl(rb, r, len, seg), bone, color, at, rot);
  }

  mesh(name: string, mats: Materials): SkinnedMesh {
    const { geometry, specs } = this.assemble(true);
    // A skinned mesh's bounds move with the pose; a generous sphere keeps culling honest.
    if (geometry.boundingSphere) geometry.boundingSphere.radius = Math.max(geometry.boundingSphere.radius, 1.4);
    const mesh = nameNode(new SkinnedMesh(geometry, materialsFor(specs, mats)), name);
    mesh.bind(this.arm.skeleton, new Matrix4());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  points(): SkinPoints {
    const pos: number[] = [];
    const bone: number[] = [];
    for (const s of this.slots.values()) {
      for (let i = 0; i < s.pos.length; i++) pos.push(s.pos[i] as number);
      for (const b of s.bone) bone.push(b);
    }
    return { pos: new Float32Array(pos), bone: new Uint16Array(bone) };
  }
}

/** Rigid parts gathered into one plain mesh: vehicles, props, the bicycle. */
export class RigidGeometry extends Parts {
  part(geometry: BufferGeometry, color: Tint, at: V3, rot: Rot = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    this.push(geometry, color, at, rot, scale, 0);
    return this;
  }

  rod(color: Tint, a: V3, b: V3, r: number, seg = 6, rb = r): this {
    const { at, rot, len } = between(a, b);
    return this.part(cyl(rb, r, len, seg), color, at, rot);
  }

  mesh(name: string | null, mats: Materials, surface?: string): Mesh {
    const { geometry, specs } = this.assemble(false);
    const mesh = new Mesh(geometry, materialsFor(specs, mats));
    if (name) nameNode(mesh, name);
    if (surface) mesh.userData["surface"] = surface;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Total triangles under a node, for the budgets. */
export function triangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  return n;
}

// --- poses and clips -------------------------------------------------------------

/** Bone rotations in degrees, applied yaw (Y), then pitch (X), then roll (Z). */
export type Pose = Record<string, V3>;

export interface Key {
  t: number;
  pose: Pose;
  /** Offset of the root bone (the hips) from its rest position, metres. */
  root?: V3;
}

const DEG = Math.PI / 180;
const _euler = new Euler();

export function quatOf(r: V3, out = new Quaternion()): Quaternion {
  return out.setFromEuler(_euler.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, "YXZ"));
}

const round = (x: number) => Math.round(x * 100) / 100;

export function degreesOf(q: Quaternion): V3 {
  _euler.setFromQuaternion(q, "YXZ");
  return [round(_euler.x / DEG), round(_euler.y / DEG), round(_euler.z / DEG)];
}

/** Merge poses: later ones win, bone by bone. */
export function pose(...parts: Pose[]): Pose {
  return Object.assign({}, ...parts) as Pose;
}

/** Mirror a pose left to right. */
export function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [bone, [x, y, z]] of Object.entries(p)) {
    const other = bone.endsWith(".L") ? bone.slice(0, -2) + ".R" : bone.endsWith(".R") ? bone.slice(0, -2) + ".L" : bone;
    out[other] = [x, -y, -z];
  }
  return out;
}

export interface ClipOptions {
  /** The bone that carries the translation (the hips; an animal's body). */
  root: string;
  /** Where that bone rests. */
  rest: V3;
  /**
   * Bones given a track in every clip whether a key names them or not, at
   * rest where not, as a Blender action keyed on the whole armature is; a
   * crossfade then always has both ends to blend.
   */
  bones?: readonly string[];
}

/**
 * Build an AnimationClip from key poses, the way the Blender actions will
 * arrive: a quaternion track per bone, named by the glTF loader's sanitised
 * node names, and the root bone's translation. Bones a key does not name
 * are at rest in it.
 */
export function makeClip(name: string, keys: readonly Key[], o: ClipOptions, smooth = true): AnimationClip {
  const bones = new Set<string>(o.bones ?? []);
  for (const k of keys) for (const b of Object.keys(k.pose)) bones.add(b);
  const times = keys.map((k) => k.t);
  const tracks: KeyframeTrack[] = [];
  const q = new Quaternion();
  for (const bone of bones) {
    const values: number[] = [];
    let prev: Quaternion | null = null;
    for (const k of keys) {
      quatOf(k.pose[bone] ?? [0, 0, 0], q);
      // Keep successive keys on the same hemisphere so slerp takes the short way.
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev = q.clone();
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new QuaternionKeyframeTrack(`${PropertyBinding.sanitizeNodeName(bone)}.quaternion`, times, values));
  }
  if (o.bones || keys.some((k) => k.root)) {
    const values: number[] = [];
    for (const k of keys) {
      const r = k.root ?? [0, 0, 0];
      values.push(o.rest[0] + r[0], o.rest[1] + r[1], o.rest[2] + r[2]);
    }
    const track = new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(o.root)}.position`, times, values);
    if (smooth && keys.length > 2) track.setInterpolation(InterpolateSmooth);
    tracks.push(track);
  }
  return new AnimationClip(name, keys[keys.length - 1]?.t ?? 0, tracks);
}

/** A humanoid clip: every bone keyed, the hips' translation too. */
export const HUMAN_CLIP: ClipOptions = { root: "hips", rest: HIPS_REST, bones: HUMANOID_BONES };

/** Clips built one after another, noting how far any hand or foot fell short of its target in each. */
export class ClipSet {
  readonly clips: AnimationClip[] = [];
  /** The largest miss of any reach while building each clip, metres. */
  readonly misses = new Map<string, number>();

  constructor(
    private readonly poser: Poser,
    private readonly options: ClipOptions,
  ) {}

  add(name: string, keys: readonly Key[], smooth = true): AnimationClip {
    this.misses.set(name, this.poser.takeWorstMiss());
    const clip = makeClip(name, keys, this.options, smooth);
    this.clips.push(clip);
    return clip;
  }
}

// --- the solver --------------------------------------------------------------------

const _v1 = new Vector3();

/**
 * A private copy of an armature to pose and measure while building clips:
 * where a bone is in a pose, two-bone reaches (an arm to a rifle's grip, a
 * leg to a pedal), and how low a skinned body reaches (so a figure lying
 * down lies on the ground rather than above or in it).
 */
export class Poser {
  readonly arm: Armature;
  private readonly rest: Vector3[] = [];
  private readonly bindInverse: Matrix4[] = [];
  private worst = 0;

  constructor(
    defs: readonly BoneDef[],
    readonly root: string,
  ) {
    this.arm = buildSkeleton(defs);
    for (const b of this.arm.bones) {
      this.rest.push(b.position.clone());
      this.bindInverse.push(b.matrixWorld.clone().invert());
    }
  }

  bone(name: string): Bone {
    return boneOf(this.arm, name);
  }

  /** Put the armature in a pose, the root bone offset from its rest by `root`. */
  set(p: Pose, root?: V3): this {
    this.arm.bones.forEach((b, i) => {
      b.position.copy(this.rest[i] as Vector3);
      b.quaternion.identity();
    });
    for (const [name, r] of Object.entries(p)) quatOf(r, this.bone(name).quaternion);
    if (root) this.bone(this.root).position.add(_v1.set(...root));
    this.arm.armature.updateMatrixWorld(true);
    return this;
  }

  /** A point in a bone's frame, in the figure's (the armature's) frame. */
  point(bone: string, local: V3 = [0, 0, 0]): Vector3 {
    return this.bone(bone).localToWorld(new Vector3(...local));
  }

  /** A direction in a bone's frame, in the figure's frame. */
  direction(bone: string, local: V3): Vector3 {
    return new Vector3(...local).normalize().applyQuaternion(this.bone(bone).getWorldQuaternion(new Quaternion()));
  }

  /** The worst miss since the last call, and start counting afresh. */
  takeWorstMiss(): number {
    const w = this.worst;
    this.worst = 0;
    return w;
  }

  /**
   * Two-bone reach: turn `upper` and `lower` so the start of `end` (a
   * wrist, an ankle) lands on `target`, bending toward `pole` (a direction:
   * elbows out and down, knees forward). With `endRot`, `end` also takes
   * that orientation in the figure's frame. Each bone turns the short way
   * from its rest, which keeps the twist natural. Out of reach, the limb
   * straightens toward the target and the miss is noted.
   */
  reach(p: Pose, root: V3 | undefined, chain: readonly [string, string, string], target: Vector3, pole: Vector3, endRot?: Quaternion): Pose {
    this.set(p, root);
    const [upperName, lowerName, endName] = chain;
    const upper = this.bone(upperName);
    const lower = this.bone(lowerName);
    const end = this.bone(endName);
    const s = upper.getWorldPosition(new Vector3());
    const parentQ = (upper.parent as Object3D).getWorldQuaternion(new Quaternion());
    const l1 = lower.position.length();
    const l2 = end.position.length();
    const toT = target.clone().sub(s);
    const dist = toT.length();
    const dir = dist > 1e-6 ? toT.divideScalar(dist) : new Vector3(0, -1, 0);
    const dMax = (l1 + l2) * 0.999;
    const dMin = Math.abs(l1 - l2) + 1e-3;
    this.worst = Math.max(this.worst, dist - dMax, dMin - dist);
    const d = Math.min(dMax, Math.max(dMin, dist));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const bendTo = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (bendTo.lengthSq() < 1e-8) bendTo.set(0, 0, 1).addScaledVector(dir, -dir.z);
    bendTo.normalize();
    const elbow = s.clone().addScaledVector(dir, a).addScaledVector(bendTo, h);
    const wrist = s.clone().addScaledVector(dir, d);
    const u1 = elbow.clone().sub(s).normalize();
    const u2 = wrist.sub(elbow).normalize();
    const q1 = new Quaternion().setFromUnitVectors(lower.position.clone().normalize(), u1.applyQuaternion(parentQ.clone().invert()));
    const upperW = parentQ.multiply(q1);
    const q2 = new Quaternion().setFromUnitVectors(end.position.clone().normalize(), u2.applyQuaternion(upperW.clone().invert()));
    const out: Pose = { ...p, [upperName]: degreesOf(q1), [lowerName]: degreesOf(q2) };
    if (endRot) out[endName] = degreesOf(upperW.multiply(q2).invert().multiply(endRot));
    return out;
  }

  /** The lowest point of a skinned body in a pose. */
  lowest(pts: SkinPoints, p: Pose, root?: V3): number {
    this.set(p, root);
    const skin = this.arm.bones.map((b, i) => new Matrix4().multiplyMatrices(b.matrixWorld, this.bindInverse[i] as Matrix4));
    let low = Infinity;
    const v = new Vector3();
    for (let i = 0; i < pts.bone.length; i++) {
      v.set(pts.pos[i * 3] as number, pts.pos[i * 3 + 1] as number, pts.pos[i * 3 + 2] as number).applyMatrix4(skin[pts.bone[i] as number] as Matrix4);
      if (v.y < low) low = v.y;
    }
    return low;
  }

  /**
   * Move a key's root up or down so the body's lowest point is `floor`
   * above the ground: exactly (a body lying down, a boot on the ground) or,
   * with `liftOnly`, only if it would be below (a body in mid-fall).
   */
  settle(pts: SkinPoints, k: Key, floor = 0, liftOnly = false): Key {
    const dy = floor - this.lowest(pts, k.pose, k.root);
    if (liftOnly && dy <= 0) return k;
    const r = k.root ?? [0, 0, 0];
    return { ...k, root: [r[0], r[1] + dy, r[2]] };
  }

  /**
   * Keep a body above the ground between its keys as well as on them: where
   * blending two keys (as the mixer will) would take it more than
   * `tolerance` below the ground, add a key there lifted clear. Twice over,
   * so the new keys' own blends are checked too. For clips whose root
   * moves linearly (a smooth curve could still dip between the keys).
   */
  keepAbove(pts: SkinPoints, keys: readonly Key[], tolerance = 0.01): Key[] {
    let list = [...keys];
    for (let pass = 0; pass < 2; pass++) {
      const out: Key[] = [];
      list.forEach((b, i) => {
        const a = list[i - 1];
        if (a) {
          for (const f of [1 / 3, 2 / 3]) {
            const k = blendKeys(a, b, f);
            if (this.lowest(pts, k.pose, k.root) < -tolerance) out.push(this.settle(pts, k, 0, true));
          }
        }
        out.push(b);
      });
      list = out;
    }
    return list;
  }
}

/** A key part way from `a` to `b`, as the mixer blends them: each bone slerped, the root lerped. */
export function blendKeys(a: Key, b: Key, f: number): Key {
  const p: Pose = {};
  const qa = new Quaternion();
  const qb = new Quaternion();
  for (const bone of new Set([...Object.keys(a.pose), ...Object.keys(b.pose)])) {
    quatOf(a.pose[bone] ?? [0, 0, 0], qa);
    quatOf(b.pose[bone] ?? [0, 0, 0], qb);
    p[bone] = degreesOf(qa.slerp(qb, f));
  }
  const ra = a.root ?? [0, 0, 0];
  const rb = b.root ?? [0, 0, 0];
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return { t: Math.round(lerp(a.t, b.t) * 1000) / 1000, pose: p, root: [lerp(ra[0], rb[0]), lerp(ra[1], rb[1]), lerp(ra[2], rb[2])] };
}

// --- the humanoid -------------------------------------------------------------------

export const ARM_L = ["upper_arm.L", "forearm.L", "hand.L"] as const;
export const ARM_R = ["upper_arm.R", "forearm.R", "hand.R"] as const;
export const LEG_L = ["thigh.L", "shin.L", "foot.L"] as const;
export const LEG_R = ["thigh.R", "shin.R", "foot.R"] as const;

export interface Humanoid {
  root: Group;
  arm: Armature;
  socketGun: Object3D;
  socketHandL: Object3D;
}

/** The armature under a named root, with `socket.gun` on the right hand and `socket.hand.L` on the left. */
export function humanoid(name: string): Humanoid {
  const arm = buildSkeleton(HUMANOID);
  const root = nameNode(new Group(), name);
  root.add(arm.armature);
  const socketGun = nameNode(new Object3D(), "socket.gun");
  socketGun.position.set(...SOCKET_GUN);
  boneOf(arm, "hand.R").add(socketGun);
  const socketHandL = nameNode(new Object3D(), "socket.hand.L");
  socketHandL.position.set(...SOCKET_HAND_L);
  boneOf(arm, "hand.L").add(socketHandL);
  return { root, arm, socketGun, socketHandL };
}

export interface BodyColors {
  skin: string;
  top: string;
  sleeves?: string;
  trousers: string;
  boots: string;
  belt: string;
  hair: string;
}

/**
 * The body every humanoid here shares, in High Noon's proportions: a man
 * some 1.76 m tall. Coarse on purpose: at 55 px a head is seven pixels.
 */
export function humanBody(s: SkinGeometry, c: BodyColors): SkinGeometry {
  const sleeves = c.sleeves ?? c.top;
  s.mat("cloth");
  s.part(box(0.32, 0.2, 0.2), "hips", c.trousers, [0, 0.95, 0]);
  s.part(box(0.335, 0.06, 0.215), "hips", c.belt, [0, 1.03, 0]);
  s.part(box(0.3, 0.22, 0.19), "spine", c.top, [0, 1.13, 0]);
  s.part(box(0.38, 0.26, 0.22), "chest", c.top, [0, 1.33, 0]);
  s.part(box(0.44, 0.1, 0.2), "chest", c.top, [0, 1.43, 0]);
  s.part(cap(0.052, 0.18), "upper_arm.L", sleeves, [0.19, 1.3, 0]);
  s.part(cap(0.052, 0.18), "upper_arm.R", sleeves, [-0.19, 1.3, 0]);
  s.part(cap(0.044, 0.17), "forearm.L", sleeves, [0.19, 1.035, 0]);
  s.part(cap(0.044, 0.17), "forearm.R", sleeves, [-0.19, 1.035, 0]);
  s.part(cap(0.078, 0.28), "thigh.L", c.trousers, [0.1, 0.69, 0]);
  s.part(cap(0.078, 0.28), "thigh.R", c.trousers, [-0.1, 0.69, 0]);
  s.part(cap(0.06, 0.26), "shin.L", c.trousers, [0.1, 0.29, 0]);
  s.part(cap(0.06, 0.26), "shin.R", c.trousers, [-0.1, 0.29, 0]);
  s.mat("leather");
  s.part(cyl(0.066, 0.068, 0.2, 8), "shin.L", c.boots, [0.1, 0.15, 0]);
  s.part(cyl(0.066, 0.068, 0.2, 8), "shin.R", c.boots, [-0.1, 0.15, 0]);
  s.part(box(0.1, 0.09, 0.26), "foot.L", c.boots, [0.1, 0.045, 0.05]);
  s.part(box(0.1, 0.09, 0.26), "foot.R", c.boots, [-0.1, 0.045, 0.05]);
  s.mat("skin");
  s.part(cyl(0.05, 0.055, 0.12, 8), "neck", c.skin, [0, 1.51, 0.005]);
  s.part(blob(0.105, 1), "head", c.skin, [0, 1.64, 0.012], [0, 0, 0], [0.95, 1.14, 1.02]);
  s.part(box(0.035, 0.055, 0.045), "head", c.skin, [0, 1.625, 0.118]);
  s.part(box(0.07, 0.1, 0.05), "hand.L", c.skin, [0.19, 0.86, 0.005]);
  s.part(box(0.07, 0.1, 0.05), "hand.R", c.skin, [-0.19, 0.86, 0.005]);
  s.mat("hair");
  s.part(dome(0.108, 10, 3), "head", c.hair, [0, 1.655, 0.0], [-0.25, 0, 0], [1.0, 0.95, 1.06]);
  s.part(box(0.022, 0.018, 0.01), "head", "#1d1612", [0.04, 1.665, 0.1]);
  s.part(box(0.022, 0.018, 0.01), "head", "#1d1612", [-0.04, 1.665, 0.1]);
  return s;
}

/** Feet a little apart. */
export const STANCE: Pose = { "thigh.L": [0, 0, 5], "thigh.R": [0, 0, -5], "foot.L": [0, 0, -5], "foot.R": [0, 0, 5] };

/** Standing easy, arms at the sides. */
export const STAND: Pose = pose(STANCE, {
  "upper_arm.L": [4, 0, 7],
  "forearm.L": [-12, 0, 0],
  "upper_arm.R": [4, 0, -7],
  "forearm.R": [-18, 0, 0],
});

/** High Noon's crouch: down on the heels, back bent. */
export const CROUCH: Pose = {
  spine: [24, 0, 0],
  chest: [10, 0, 0],
  neck: [-14, 0, 0],
  head: [-10, 0, 0],
  "thigh.L": [-102, 0, 8],
  "shin.L": [118, 0, 0],
  "foot.L": [-16, 0, 0],
  "thigh.R": [-96, 0, -8],
  "shin.R": [112, 0, 0],
  "foot.R": [-16, 0, 0],
};
export const CROUCH_ROOT: V3 = [0, -0.47, -0.05];

/**
 * Something held in the right hand at its `socket.gun` (a rifle, the
 * binoculars), and optionally steadied by the left. Points are in a bone's
 * frame (`frame`), or the figure's when it is null. Props point along the
 * hand's −Y with their top along its +Z, so `dir` is where the muzzle goes
 * and `up` where the sights face.
 */
export interface Hold {
  frame: string | null;
  grip: V3;
  dir: V3;
  up: V3;
  /** How far along `dir` from the grip the left hand holds it, metres; null leaves the left arm alone. */
  fore: number | null;
  /** Where the left hand's wrist goes instead, in the same frame, for things not held along their length. */
  leftAt?: V3;
  poleR?: V3;
  poleL?: V3;
}

/** The hand's orientation in the figure's frame when its −Y points along `dir` and its +Z toward `up`. */
export function handFrame(dir: Vector3, up: Vector3): Quaternion {
  const y = dir.clone().negate().normalize();
  const z = up.clone().addScaledVector(y, -up.dot(y)).normalize();
  const x = new Vector3().crossVectors(y, z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Put the hands on a held thing: the right on its grip, the left along it. */
export function holdWith(poser: Poser, p: Pose, root: V3 | undefined, h: Hold): Pose {
  poser.set(p, root);
  const toFigure = (v: V3) => (h.frame ? poser.point(h.frame, v) : new Vector3(...v));
  const dirOf = (v: V3) => (h.frame ? poser.direction(h.frame, v) : new Vector3(...v).normalize());
  const grip = toFigure(h.grip);
  const dir = dirOf(h.dir);
  const up = dirOf(h.up);
  const rot = handFrame(dir, up);
  const wrist = grip.clone().sub(new Vector3(...SOCKET_GUN).applyQuaternion(rot));
  let out = poser.reach(p, root, ARM_R, wrist, new Vector3(...(h.poleR ?? [-1, -0.8, -0.3])), rot);
  let left: Vector3 | null = null;
  if (h.leftAt) left = toFigure(h.leftAt);
  else if (h.fore !== null) {
    // Under the gun, the hand's middle (not its wrist) on the fore-end.
    const upOrtho = up.clone().addScaledVector(dir, -up.dot(dir)).normalize();
    left = grip.clone().addScaledVector(dir, h.fore).addScaledVector(upOrtho, -0.04);
  }
  if (left) {
    const poleL = new Vector3(...(h.poleL ?? [1, -0.8, -0.3]));
    out = poser.reach(out, root, ARM_L, left, poleL);
    // Draw the wrist back along the forearm so the palm, not the wrist, is on the mark.
    poser.set(out, root);
    const along = poser.point("hand.L").sub(poser.point("forearm.L")).normalize();
    out = poser.reach(out, root, ARM_L, left.clone().addScaledVector(along, -0.05), poleL);
  }
  return out;
}

// --- walking and running -------------------------------------------------------------

export interface GaitOptions {
  /** One full stride (left and right), seconds. */
  period: number;
  /** The ground speed the clip is made for, m/s: the planted foot slides back at it. */
  speed: number;
  /** The fraction of the stride each foot is on the ground: over 0.5 walks, under runs. */
  duty: number;
  samples: number;
  /** How high the swinging ankle rises, metres. */
  stepHeight: number;
  /** Hips lowered from rest the whole stride. */
  sink: number;
  /**
   * How much further the hips may drop where the legs are spread widest.
   * Real hips drop some 5 cm in a walk (the pelvis turns and tilts, the
   * ankle rolls); past this a far foot is left a little short of the
   * ground instead, which reads better at a distance than a bounce.
   */
  maxDip?: number;
  /** Hips raised in the middle of each flight (a run). */
  lift?: number;
  /** Feet from the centre line. */
  track?: number;
  /** Where the planted foot's travel is centred, forward of the hips. */
  centre?: number;
  /** Side to side over the planted foot. */
  sway?: number;
  /** The upper body at a phase of the stride (0: the left heel strikes). */
  upper: (phase: number) => Pose;
  /** After the legs: hands on a rifle, and the like. */
  finish?: (p: Pose, root: V3, phase: number) => Pose;
}

/** How high the ankle must be for the boot's sole to touch the ground at a pitch (degrees, toes down positive). */
function ankleHeight(pitch: number): number {
  const s = Math.sin(pitch * DEG);
  const c = Math.cos(pitch * DEG);
  return Math.max(0.05 * c - 0.08 * s, 0.05 * c + 0.18 * s);
}

interface FootAt {
  planted: boolean;
  z: number;
  y: number;
  pitch: number;
}

function footAt(phase: number, o: GaitOptions): FootAt {
  const reach = o.speed * o.period * o.duty;
  const c = o.centre ?? 0;
  if (phase < o.duty) {
    const s = phase / o.duty;
    // Heel strike, flat, then up on the toes to push off.
    const pitch = s < 0.15 ? -12 * (1 - s / 0.15) : s > 0.65 ? 32 * ((s - 0.65) / 0.35) : 0;
    return { planted: true, z: c + reach / 2 - s * reach, y: ankleHeight(pitch), pitch };
  }
  const s = (phase - o.duty) / (1 - o.duty);
  const pitch = 32 * (1 - s) * (1 - s) - 12 * s * s;
  const ease = 0.5 - 0.5 * Math.cos(Math.PI * s);
  return { planted: false, z: c - reach / 2 + reach * ease, y: ankleHeight(pitch) + o.stepHeight * Math.sin(Math.PI * s), pitch };
}

/**
 * A stride cycle in place: each foot planted and sliding back at the ground
 * speed, then lifted and swung forward; the hips as high as the planted legs
 * allow; the upper body from `upper`. Keys at even phases, the last the same
 * as the first so it loops.
 */
export function gait(poser: Poser, o: GaitOptions): Key[] {
  const keys: Key[] = [];
  const leg = 0.85;
  const track = o.track ?? 0.1;
  for (let i = 0; i <= o.samples; i++) {
    const phase = (i % o.samples) / o.samples;
    const feet = [
      { chain: LEG_L, sx: 1, ...footAt(phase, o) },
      { chain: LEG_R, sx: -1, ...footAt((phase + 0.5) % 1, o) },
    ];
    let y = HIPS_REST[1] - o.sink;
    if (o.lift && o.duty < 0.5) {
      const q = phase % 0.5;
      if (q >= o.duty) y += o.lift * Math.sin((Math.PI * (q - o.duty)) / (0.5 - o.duty));
      else y -= o.lift * 0.4 * Math.sin((Math.PI * q) / o.duty);
    }
    const high = y;
    for (const f of feet) {
      const k = f.planted ? 0.985 : 1;
      const dx = f.sx * (track - 0.1);
      y = Math.min(y, f.y + Math.sqrt(Math.max(0, (k * leg) ** 2 - f.z * f.z - dx * dx)) + 0.05);
    }
    y = Math.max(y, high - (o.maxDip ?? 0.06));
    // Weight over the planted foot.
    const sway = (o.sway ?? 0) * Math.cos(2 * Math.PI * phase);
    const root: V3 = [sway, y - HIPS_REST[1], 0];
    let p = o.upper(phase);
    for (const f of feet) {
      p = poser.reach(p, root, f.chain, new Vector3(f.sx * track, f.y, f.z), new Vector3(f.sx * 0.12, 0, 1), quatOf([f.pitch, 0, 0]));
    }
    if (o.finish) p = o.finish(p, root, phase);
    keys.push({ t: round((i / o.samples) * o.period * 1000) / 1000, pose: p, root });
  }
  return keys;
}

/** A small deterministic random source, so every build of a figure is the same. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
