import {
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
  LatheGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";
import type { LoadedAsset } from "../../../engine/types";
import { nameNode } from "../../../engine/world/names";
import { CAT, catClips, catKit, deadClips, HUMANOID, humanoidKit, mechanicClips, scaledHumanoid, survivorClips, type BoneDef, type Vec3 } from "./clips";

/**
 * Dead of Night's placeholder characters, built to the contract the Blender
 * characters follow (docs/DEAD_OF_NIGHT.md, "Characters"): the humanoid
 * armature High Noon's characters use (hips … foot.R), facing +Z with the
 * feet at the origin, primitive shapes each bound rigidly to one bone,
 * coloured per vertex. They stand in for `walker.glb`, `mechanic.glb`,
 * `survivor.glb` and `cat.glb` in development and tests only.
 *
 * They are meant to read at night: a figure 5–60 m away under a flashlight
 * is a silhouette and a few colours, so the shapes carry the character (a
 * cap, a skirt, a swollen belly, long hair), the clothes are mid-toned so the
 * beam finds them, and the dead's eyes are a separate mesh the game makes
 * shine.
 */

const TAU = Math.PI * 2;

// --- a skeleton, and shapes skinned to it ---------------------------------------------

class Skel {
  readonly armature = nameNode(new Object3D(), "Armature");
  readonly bones: Bone[] = [];
  readonly byName = new Map<string, Bone>();
  readonly skeleton: Skeleton;

  /** `k`: height relative to the standard humanoid; `w`: width. Sizes are scaled by them. */
  constructor(
    defs: BoneDef[],
    readonly k = 1,
    readonly w = 1,
  ) {
    for (const [name, parent, offset] of defs) {
      const bone = nameNode(new Bone(), name);
      bone.position.set(...offset);
      (parent ? this.bone(parent) : this.armature).add(bone);
      this.byName.set(name, bone);
      this.bones.push(bone);
    }
    this.armature.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.bones);
  }

  bone(name: string): Bone {
    const b = this.byName.get(name);
    if (!b) throw new Error(`no bone ${name}`);
    return b;
  }

  /** A joint's place in the rest pose. */
  j(name: string): Vector3 {
    return this.bone(name).getWorldPosition(new Vector3());
  }

  index(name: string): number {
    const i = this.bones.indexOf(this.bone(name));
    return i;
  }
}

/** How a part is coloured: flat, per vertex (by position), or per triangle (by its centre). */
type Paint = string | Color | { v: (world: Vector3, local: Vector3) => Color } | { f: (local: Vector3, world: Vector3) => Color };

/** Bound to one bone, or blended from bone `a` to bone `b` along an axis (a belly across hips and spine). */
type Bind = string | { a: string; b: string; axis: 0 | 1 | 2; from: number; to: number };

interface PartOptions {
  /** Tear the bottom edge: its vertices pulled up by up to this much, raggedly. */
  jag?: number;
  /** Material index, for a mesh with more than one material. */
  mat?: number;
}

interface Bucket {
  pos: number[];
  nor: number[];
  col: number[];
  idx: number[];
  wgt: number[];
}

/** Accumulates parts into one geometry: skinned to `skel`, or plain when it is null. */
class Parts {
  private readonly buckets = new Map<number, Bucket>();
  constructor(private readonly skel: Skel | null) {}

  add(geometry: BufferGeometry, bind: Bind, paint: Paint, at: Vec3 | Vector3, rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], o: PartOptions = {}): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const place = Array.isArray(at) ? new Vector3(...at) : at;
    const m = new Matrix4().compose(place, new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
    const nm = new Matrix3().getNormalMatrix(m);
    const pa = g.getAttribute("position");
    const na = g.getAttribute("normal");
    const locals: Vector3[] = [];
    let minY = Infinity;
    for (let i = 0; i < pa.count; i++) {
      const v = new Vector3().fromBufferAttribute(pa, i);
      locals.push(v);
      minY = Math.min(minY, v.y);
    }
    if (o.jag) {
      for (const v of locals) {
        if (v.y < minY + 1e-5) v.y += o.jag * (0.15 + 0.85 * hash3(Math.round(v.x * 1e4), 0, Math.round(v.z * 1e4), 11));
      }
    }
    const worlds = locals.map((v) => v.clone().applyMatrix4(m));
    const cols: Color[] = [];
    if (typeof paint === "object" && "f" in paint) {
      const lc = new Vector3();
      const wc = new Vector3();
      for (let i = 0; i + 2 < locals.length; i += 3) {
        lc.copy(locals[i] as Vector3).add(locals[i + 1] as Vector3).add(locals[i + 2] as Vector3).divideScalar(3);
        wc.copy(worlds[i] as Vector3).add(worlds[i + 1] as Vector3).add(worlds[i + 2] as Vector3).divideScalar(3);
        const c = paint.f(lc, wc);
        cols.push(c, c, c);
      }
    } else if (typeof paint === "object" && "v" in paint) {
      for (let i = 0; i < locals.length; i++) cols.push(paint.v(worlds[i] as Vector3, locals[i] as Vector3));
    } else {
      const c = typeof paint === "string" ? new Color(paint) : paint;
      for (let i = 0; i < locals.length; i++) cols.push(c);
    }
    const b = this.bucket(o.mat ?? 0);
    const n = new Vector3();
    for (let i = 0; i < locals.length; i++) {
      const w = worlds[i] as Vector3;
      b.pos.push(w.x, w.y, w.z);
      n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      b.nor.push(n.x, n.y, n.z);
      const c = cols[i] as Color;
      b.col.push(c.r, c.g, c.b);
      if (!this.skel) continue;
      if (typeof bind === "string") {
        b.idx.push(this.skel.index(bind), 0, 0, 0);
        b.wgt.push(1, 0, 0, 0);
      } else {
        const t = smooth(bind.from, bind.to, w.getComponent(bind.axis));
        b.idx.push(this.skel.index(bind.a), this.skel.index(bind.b), 0, 0);
        b.wgt.push(1 - t, t, 0, 0);
      }
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
    return this;
  }

  get triangles(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.pos.length / 9;
    return n;
  }

  build(): BufferGeometry {
    const out = new BufferGeometry();
    const order = [...this.buckets.keys()].sort((a, b) => a - b);
    const all: Bucket = { pos: [], nor: [], col: [], idx: [], wgt: [] };
    for (const key of order) {
      const b = this.buckets.get(key) as Bucket;
      if (order.length > 1) out.addGroup(all.pos.length / 3, b.pos.length / 3, key);
      for (const f of ["pos", "nor", "col", "idx", "wgt"] as const) for (const v of b[f]) all[f].push(v);
    }
    out.setAttribute("position", new BufferAttribute(new Float32Array(all.pos), 3));
    out.setAttribute("normal", new BufferAttribute(new Float32Array(all.nor), 3));
    out.setAttribute("color", new BufferAttribute(new Float32Array(all.col), 3));
    if (this.skel) {
      out.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(all.idx), 4));
      out.setAttribute("skinWeight", new BufferAttribute(new Float32Array(all.wgt), 4));
    }
    out.computeBoundingBox();
    out.computeBoundingSphere();
    // Skinned bounds move with the pose (a figure lying down is longer than tall).
    if (this.skel && out.boundingSphere) out.boundingSphere.radius = Math.max(out.boundingSphere.radius, 1.4 * this.skel.k);
    return out;
  }

  private bucket(mat: number): Bucket {
    let b = this.buckets.get(mat);
    if (!b) {
      b = { pos: [], nor: [], col: [], idx: [], wgt: [] };
      this.buckets.set(mat, b);
    }
    return b;
  }
}

function skinned(sk: Skel, name: string, geometry: BufferGeometry, material: Material, visible = true): SkinnedMesh {
  const mesh = nameNode(new SkinnedMesh(geometry, material), name);
  mesh.bind(sk.skeleton, new Matrix4());
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = visible;
  sk.armature.add(mesh);
  return mesh;
}

// --- shapes ---------------------------------------------------------------------------

const box = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new BoxGeometry(x, y, z, sx, sy, sz);
const cap = (r: number, len: number, radial = 6, ends = 2) => new CapsuleGeometry(r, Math.max(0.001, len), ends, radial);
const cyl = (rt: number, rb: number, h: number, seg = 8, open = false, hs = 1) => new CylinderGeometry(rt, rb, h, seg, hs, open);
const ball = (r: number, ws = 6, hs = 4) => new SphereGeometry(r, ws, hs);

/**
 * A capsule from joint `a` to joint `b`, `ext` longer at each end. `ends`:
 * rings in each rounded end; 1 (a blunt point) for limbs clothes cover.
 */
function limb(s: Parts, bone: Bind, a: Vector3, b: Vector3, r: number, paint: Paint, ext = 0, radial = 6, ends = 2): void {
  const { mid, rot, len } = along(a, b);
  s.add(cap(r, len + 2 * ext - 2 * r, radial, ends), bone, paint, mid, rot);
}

/** An open tube (a sleeve, a trouser leg) from `a` down to `b`, radius `r` at the top and `rb` at the bottom. */
function tube(s: Parts, bone: Bind, a: Vector3, b: Vector3, r: number, rb: number, paint: Paint, o: { jag?: number; radial?: number; hs?: number } = {}): void {
  // Stood with its top toward `a`, so its bottom edge (the one a tear rags) is at `b`.
  const { mid, rot, len } = along(b, a);
  const opts: PartOptions = {};
  if (o.jag) opts.jag = o.jag;
  // Its sides start at +X, as a capsule's do (a cylinder's start at +Z): a
  // six-sided sleeve then lines up with the six-sided arm inside it, and the
  // arm's corners do not poke out between the sleeve's.
  s.add(new CylinderGeometry(r, rb, len, o.radial ?? 8, o.hs ?? 1, true, Math.PI / 2), bone, paint, mid, rot, [1, 1, 1], opts);
}

/** The middle of a segment and the rotation that stands a Y-up shape along it. */
function along(a: Vector3, b: Vector3): { mid: Vector3; rot: Vec3; len: number } {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  const e = new Euler().setFromQuaternion(q, "XYZ");
  return { mid: a.clone().add(b).multiplyScalar(0.5), rot: [e.x, e.y, e.z], len };
}

const up = (v: Vector3, x: number, y: number, z: number) => new Vector3(v.x + x, v.y + y, v.z + z);

// --- colour: noise, mottled skin, plaid, camo, grime -----------------------------------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const w = s(z - zi);
  let out = 0;
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        out += hash3(xi + dx, yi + dy, zi + dz, seed) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      }
    }
  }
  return out;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A seeded random stream, so every build is the same figure. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(p: Paint, local: Vector3, world: Vector3): Color {
  if (typeof p === "string") return new Color(p);
  if (p instanceof Color) return p.clone();
  if ("f" in p) return p.f(local, world).clone();
  return p.v(world, local).clone();
}

/**
 * Dead skin: a pale base, mottled, with bruise-dark blotches and a few
 * greener patches of rot. Coloured by position, so neighbouring parts blend.
 */
function deadSkin(base: string, seed: number, o: { mottle?: number; blotches?: number; bruise?: string; rot?: string } = {}): Paint {
  const b = new Color(base);
  const bruise = new Color(o.bruise ?? "#4d3a45");
  const rot = new Color(o.rot ?? "#66714a");
  const amount = o.mottle ?? 0.32;
  const many = o.blotches ?? 0.4;
  return {
    v: (w) => {
      const c = b.clone().multiplyScalar(1 - amount / 2 + amount * noise3(w.x * 16, w.y * 16, w.z * 16, seed));
      c.lerp(bruise, 0.75 * smooth(1 - many, 1.1 - many, noise3(w.x * 7 + 5, w.y * 7, w.z * 7, seed + 1)));
      c.lerp(rot, 0.5 * smooth(0.6, 0.78, noise3(w.x * 5, w.y * 5 + 9, w.z * 5, seed + 2)));
      return c;
    },
  };
}

/** Living skin, a little warmth in the cheeks. */
function liveSkin(base: string, face: Vector3, cheek = "#df8f80"): Paint {
  const b = new Color(base);
  const c = new Color(cheek);
  return {
    v: (w) => {
      const d = Math.hypot(Math.abs(w.x - face.x) - 0.045, w.y - (face.y - 0.02), w.z - (face.z + 0.07));
      return b.clone().lerp(c, 0.45 * (1 - smooth(0.0, 0.035, d)));
    },
  };
}

/**
 * Cloth: a paint for a box of `size` split in `segs`, and for a tube `h`
 * long. A patterned cloth (`fine`) needs its shapes split finely enough to
 * carry the pattern; a plain one does not, and saves the triangles.
 */
interface Fabric {
  fine: boolean;
  box(size: Vec3, segs: Vec3): Paint;
  tube(h: number, radial: number, hs: number): Paint;
}

const solid = (p: Paint): Fabric => ({ fine: false, box: () => p, tube: () => p });

/** A check: stripes both ways, darker where they cross (flannel, a farmer's shirt). */
function plaid(light: string, dark: string): Fabric {
  const a = new Color(light);
  const b = new Color(dark);
  return {
    fine: true,
    box: (size, segs) => ({
      f: (l) => {
        const d = [0, 1, 2].map((i) => Math.abs(Math.abs(l.getComponent(i)) - (size[i] as number) / 2));
        const face = d.indexOf(Math.min(...d));
        let t = 0;
        for (const i of [0, 1, 2]) {
          if (i === face) continue;
          const cell = Math.floor(((l.getComponent(i) + (size[i] as number) / 2) / (size[i] as number)) * (segs[i] as number));
          if (cell % 2 === 0) t += 0.5;
        }
        return a.clone().lerp(b, t);
      },
    }),
    tube: (h, radial, hs) => ({
      f: (l) => {
        const around = Math.floor(((Math.atan2(l.x, l.z) + Math.PI) / TAU) * radial);
        const along = Math.floor(((l.y + h / 2) / h) * hs);
        return a.clone().lerp(b, (around % 2 === 0 ? 0.5 : 0) + (along % 2 === 0 ? 0.5 : 0));
      },
    }),
  };
}

/** Brown woodland camouflage, in blotches the size of a hand. */
function camo(seed: number): Fabric {
  const tones = ["#5d4c34", "#3d3325", "#7a6a4b", "#2b261c"].map((c) => new Color(c));
  const p: Paint = {
    f: (_l, w) => {
      const n = noise3(w.x * 11, w.y * 11, w.z * 11, seed);
      return (tones[n < 0.35 ? 0 : n < 0.5 ? 1 : n < 0.66 ? 2 : 3] as Color).clone();
    },
  };
  return { ...solid(p), fine: true };
}

/**
 * Dirt on clothes: darker patches, mud toward the ground, all a little
 * faded; `stains` adds black grease blotches (the Mechanic).
 */
function dirty(fab: Fabric, seed: number, amount = 0.4, k = 1, stains = 0): Fabric {
  const mud = new Color("#2b2217");
  const grease = new Color("#0e0d0c");
  const soil = (c: Color, w: Vector3) => {
    c.multiplyScalar(1 - amount * smooth(0.42, 0.8, noise3(w.x * 8, w.y * 8, w.z * 8, seed)));
    c.lerp(mud, 0.5 * Math.min(1, Math.max(0, (0.45 * k - w.y) / (0.45 * k))));
    if (stains) c.lerp(grease, stains * smooth(0.55, 0.7, noise3(w.x * 5, w.y * 5, w.z * 5, seed + 3)));
    return c;
  };
  const wrap = (p: Paint): Paint => {
    if (typeof p === "object" && "f" in p) return { f: (l, w) => soil(p.f(l, w).clone(), w) };
    return { v: (w, l) => soil(sample(p, l, w), w) };
  };
  return { fine: fab.fine, box: (size, segs) => wrap(fab.box(size, segs)), tube: (h, r, hs) => wrap(fab.tube(h, r, hs)) };
}

/** How finely a cloth's box is split: patterned cloth needs the cells, a torn hem a few cuts along it. */
function segsFor(fab: Fabric, fine: Vec3, hem = 0): Vec3 {
  if (fab.fine) return fine;
  return hem ? [3, 1, 1] : [1, 1, 1];
}

/** A tube's sides and rings for a cloth. */
function tubeCut(fab: Fabric): { radial: number; hs: number } {
  return fab.fine ? { radial: 8, hs: 2 } : { radial: 6, hs: 1 };
}

// --- heads -----------------------------------------------------------------------------

/** Where the head's centre sits: every head of a skeleton (and its eyes) is built round it. */
function headCentre(sk: Skel): Vector3 {
  return up(sk.j("head"), 0, 0.08 * sk.k, 0.004 * sk.k);
}

/** A dead face: gaunt, a slack jaw hanging open, sunken dark sockets under a heavy brow. */
function deadHead(s: Parts, sk: Skel, skin: Paint): void {
  const k = sk.k;
  const C = headCentre(sk);
  const at = (x: number, y: number, z: number) => up(C, x * k, y * k, z * k);
  s.add(new IcosahedronGeometry(0.1 * k, 1), "head", skin, at(0, 0, 0), [0, 0, 0], [0.9, 1.1, 1.0]);
  s.add(box(0.084 * k, 0.045 * k, 0.085 * k), "head", skin, at(0, -0.078, 0.028), [0.18, 0, 0]);
  s.add(box(0.05 * k, 0.018 * k, 0.012 * k), "head", "#1a0f0e", at(0, -0.062, 0.086), [0.18, 0, 0]);
  s.add(box(0.1 * k, 0.022 * k, 0.03 * k), "head", skin, at(0, 0.042, 0.078));
  s.add(box(0.022 * k, 0.04 * k, 0.026 * k), "head", skin, at(0, -0.006, 0.1));
  for (const x of [-1, 1]) {
    s.add(ball(0.022 * k), "head", "#140c0d", at(0.036 * x, 0.018, 0.083), [0, 0, 0], [1.1, 0.8, 0.45]);
    s.add(box(0.012 * k, 0.042 * k, 0.03 * k), "head", skin, at(0.087 * x, 0.0, 0.0));
  }
}

/** The dead's eyes: two small glossy beads in the sockets, one mesh the game lights. */
function eyes(sk: Skel): BufferGeometry {
  const s = new Parts(sk);
  const C = headCentre(sk);
  const k = sk.k;
  for (const x of [-1, 1]) s.add(ball(0.0115 * k, 7, 5), "head", "#ffffff", up(C, 0.036 * x * k, 0.018 * k, 0.091 * k), [0, 0, 0], [1.1, 0.85, 0.6]);
  return s.build();
}

function eyeMaterial(): MeshStandardMaterial {
  // Near black and glossy; the game drives the emissive so they shine back in the beam.
  return new MeshStandardMaterial({ name: "eyes", color: "#060607", roughness: 0.12, metalness: 0, emissive: "#000000" });
}

// --- the dead ---------------------------------------------------------------------------

interface DeadShape {
  /** Limbs thinner (<1) or thicker. */
  limbs?: number;
  /** Torso wider and deeper. */
  torso?: number;
  legs?: boolean;
  /** The shins show (no trousers over them): give them rounded ends. */
  bareShins?: boolean;
  /** What the pelvis wears when nothing else does. */
  shorts?: Paint;
  feet?: Paint;
}

function deadBody(s: Parts, sk: Skel, skin: Paint, o: DeadShape = {}): void {
  const { k, w } = sk;
  const t = o.limbs ?? 1;
  const f = o.torso ?? 1;
  const J = (n: string) => sk.j(n);
  deadHead(s, sk, skin);
  const C = headCentre(sk);
  const neckLo = J("neck").y - 0.03 * k;
  const neckHi = C.y - 0.05 * k;
  s.add(cyl(0.04 * k * Math.sqrt(f), 0.043 * k * Math.sqrt(f), neckHi - neckLo, 6, true), "neck", skin, [0, (neckHi + neckLo) / 2, 0.004 * k]);
  const cy = J("chest").y;
  const sy = J("spine").y;
  const hy = J("hips").y;
  s.add(box(0.33 * w * f, 0.24 * k, 0.19 * k * f), "chest", skin, [0, cy + 0.07 * k, 0]);
  s.add(box(0.4 * w * Math.sqrt(f), 0.08 * k, 0.17 * k * f), "chest", skin, [0, cy + 0.16 * k, 0]);
  s.add(box(0.27 * w * f, 0.2 * k, 0.16 * k * f), "spine", skin, [0, sy + 0.07 * k, 0]);
  s.add(box(0.3 * w * f, 0.17 * k, 0.18 * k * f), "hips", o.shorts ?? skin, [0, hy + 0.01 * k, 0]);
  // Upper arms and legs are nearly always under clothes: blunter ends, fewer triangles.
  for (const side of ["L", "R"] as const) {
    limb(s, `upper_arm.${side}`, J(`upper_arm.${side}`), J(`forearm.${side}`), 0.04 * k * t, skin, 0.02 * k, 6, 1);
    limb(s, `forearm.${side}`, J(`forearm.${side}`), J(`hand.${side}`), 0.034 * k * t, skin, 0.01 * k);
    const hand = J(`hand.${side}`);
    s.add(box(0.055 * k * Math.sqrt(t), 0.085 * k, 0.034 * k * Math.sqrt(t)), `hand.${side}`, skin, up(hand, 0, -0.04 * k, 0.005 * k));
    // Fingers curled into a claw.
    s.add(box(0.05 * k * Math.sqrt(t), 0.06 * k, 0.024 * k), `hand.${side}`, skin, up(hand, 0, -0.1 * k, -0.006 * k), [0.5, 0, 0]);
    if (o.legs === false) continue;
    limb(s, `thigh.${side}`, J(`thigh.${side}`), J(`shin.${side}`), 0.058 * k * t, skin, 0.02 * k, 6, 1);
    limb(s, `shin.${side}`, J(`shin.${side}`), J(`foot.${side}`), 0.047 * k * t, skin, 0, 6, o.bareShins ? 2 : 1);
    const foot = J(`foot.${side}`);
    s.add(box(0.085 * k * Math.sqrt(t), 0.07 * k, 0.24 * k), `foot.${side}`, o.feet ?? skin, [foot.x, 0.035 * k, foot.z + 0.05 * k]);
  }
}

// --- clothes (sized over the standard body) -----------------------------------------------

/** Torso clothes: ribcage, shoulders, waist, `grow` times bigger than the body; `hem` tears the waist. */
function torsoWear(s: Parts, sk: Skel, fab: Fabric, grow = 1, hem = 0): void {
  const { k, w } = sk;
  const cy = sk.j("chest").y;
  const sy = sk.j("spine").y;
  const ribs: Vec3 = [0.36 * w * grow, 0.25 * k, 0.215 * k * grow];
  const ribCut = segsFor(fab, [3, 3, 1]);
  s.add(box(...ribs, ...ribCut), "chest", fab.box(ribs, ribCut), [0, cy + 0.07 * k, 0]);
  const top: Vec3 = [0.44 * w * grow, 0.1 * k, 0.2 * k * grow];
  const topCut = segsFor(fab, [3, 1, 1]);
  s.add(box(...top, ...topCut), "chest", fab.box(top, topCut), [0, cy + 0.165 * k, 0]);
  const waist: Vec3 = [0.3 * w * grow, 0.22 * k, 0.185 * k * grow];
  const waistCut = segsFor(fab, [3, 2, 1], hem);
  s.add(box(...waist, ...waistCut), "spine", fab.box(waist, waistCut), [0, sy + 0.07 * k, 0], [0, 0, 0], [1, 1, 1], { jag: hem });
}

/** A sleeve: the upper arm, and down the forearm unless torn off (`jag` rags the cut end). */
function sleeve(s: Parts, sk: Skel, side: "L" | "R", fab: Fabric, length: "long" | "elbow" | "short", jag = 0, grow = 1): void {
  const k = sk.k;
  const sh = sk.j(`upper_arm.${side}`);
  const el = sk.j(`forearm.${side}`);
  const wr = sk.j(`hand.${side}`);
  const r = 0.053 * k * grow;
  const cut = tubeCut(fab);
  const upperEnd = length === "short" ? up(sh, 0, -0.14 * k, 0) : up(el, 0, -0.01 * k, 0);
  const upperLen = sh.y + 0.025 * k - upperEnd.y;
  tube(s, `upper_arm.${side}`, up(sh, 0, 0.025 * k, 0), upperEnd, r, r * 0.95, fab.tube(upperLen, cut.radial, cut.hs), { jag: length === "long" ? 0 : jag, ...cut });
  if (length !== "long") return;
  const lowLen = el.y + 0.015 * k - (wr.y + 0.03 * k);
  tube(s, `forearm.${side}`, up(el, 0, 0.015 * k, 0), up(wr, 0, 0.03 * k, 0), 0.047 * k * grow, 0.044 * k * grow, fab.tube(lowLen, cut.radial, cut.hs), { jag, ...cut });
}

/** Trousers: the seat, and each leg to the ankle (or torn off at `to`). */
function trousers(s: Parts, sk: Skel, fab: Fabric, o: { to?: "ankle" | "knee"; jag?: [number, number]; grow?: number } = {}): void {
  const { k, w } = sk;
  const g = o.grow ?? 1;
  const seat: Vec3 = [0.33 * w * g, 0.19 * k, 0.205 * k * g];
  const seatCut = segsFor(fab, [2, 1, 2]);
  s.add(box(...seat, ...seatCut), "hips", fab.box(seat, seatCut), [0, sk.j("hips").y + 0.01 * k, 0]);
  const cut = tubeCut(fab);
  (["L", "R"] as const).forEach((side, i) => {
    const hip = sk.j(`thigh.${side}`);
    const knee = sk.j(`shin.${side}`);
    const ankle = sk.j(`foot.${side}`);
    const jag = o.jag?.[i] ?? 0;
    if (o.to === "knee") {
      tube(s, `thigh.${side}`, up(hip, 0, 0.03 * k, 0), up(knee, 0, 0.02 * k, 0), 0.074 * k * g, 0.068 * k * g, fab.tube(hip.y - knee.y, cut.radial, cut.hs), { jag, ...cut });
      return;
    }
    tube(s, `thigh.${side}`, up(hip, 0, 0.03 * k, 0), up(knee, 0, -0.02 * k, 0), 0.074 * k * g, 0.066 * k * g, fab.tube(hip.y - knee.y, cut.radial, cut.hs), cut);
    tube(s, `shin.${side}`, up(knee, 0, 0.03 * k, 0), up(ankle, 0, 0.05 * k, 0), 0.064 * k * g, 0.06 * k * g, fab.tube(knee.y - ankle.y, cut.radial, cut.hs), { jag, ...cut });
  });
}

/** Footwear over the bare feet: shoes, or boots with a shaft up the shin. */
function shoes(s: Parts, sk: Skel, paint: Paint, kind: "shoe" | "boot" | "heavy", grow = 1): void {
  const k = sk.k;
  for (const side of ["L", "R"] as const) {
    const foot = sk.j(`foot.${side}`);
    const h = kind === "heavy" ? 0.1 : 0.085;
    s.add(box(0.1 * k * grow, h * k, 0.265 * k), `foot.${side}`, paint, [foot.x, (h / 2) * k, foot.z + 0.05 * k]);
    if (kind === "shoe") continue;
    const top = kind === "heavy" ? 0.26 : 0.22;
    tube(s, `shin.${side}`, new Vector3(foot.x, top * k, foot.z), new Vector3(foot.x, 0.06 * k, foot.z), 0.066 * k * grow, 0.064 * k * grow, paint);
  }
}

// The six outfits the dead wear, each a whole set of clothes, dirty and torn.

function farmer(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const shirt = dirty(plaid("#b8685a", "#6d2b25"), seed, 0.35);
  torsoWear(s, sk, shirt);
  sleeve(s, sk, "L", shirt, "long", 0.02);
  sleeve(s, sk, "R", shirt, "elbow", 0.05);
  const denim = dirty(solid({ v: (w) => new Color("#3f5876").multiplyScalar(0.9 + 0.2 * noise3(w.x * 30, w.y * 30, w.z * 30, seed)) }), seed + 1, 0.45);
  const cy = sk.j("chest").y;
  const sy = sk.j("spine").y;
  // The bib, its straps over the shoulders, brass buttons.
  const bib: Vec3 = [0.25 * sk.w, 0.2 * k, 0.02 * k];
  s.add(box(...bib), "chest", denim.box(bib, [1, 1, 1]), [0, cy + 0.03 * k, 0.113 * k]);
  for (const x of [-1, 1]) {
    s.add(box(0.045 * sk.w, 0.018 * k, 0.23 * k), "chest", denim.box([0.045, 0.018, 0.23], [1, 1, 1]), [0.09 * x * sk.w, cy + 0.218 * k, 0]);
    s.add(box(0.022 * k, 0.022 * k, 0.012 * k), "chest", "#b39545", [0.1 * x * sk.w, cy + 0.12 * k, 0.126 * k]);
  }
  const waist: Vec3 = [0.315 * sk.w, 0.21 * k, 0.197 * k];
  s.add(box(...waist), "spine", denim.box(waist, [1, 1, 1]), [0, sy + 0.06 * k, 0]);
  trousers(s, sk, denim, { jag: [0.03, 0.06] });
  shoes(s, sk, dirty(solid("#4a3321"), seed + 2, 0.3).box([1, 1, 1], [1, 1, 1]), "boot");
  return s.build();
}

function trucker(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const C = headCentre(sk);
  // The cap: a crown, white foam front panel, the bill pulled low.
  const crown: Paint = { v: (w) => new Color(w.z > C.z + 0.045 * k && w.y > C.y + 0.02 * k ? "#d9d3c4" : "#9d2d27") };
  s.add(new SphereGeometry(0.106 * k, 10, 4, 0, TAU, 0, Math.PI / 2), "head", crown, up(C, 0, 0.03 * k, -0.004 * k), [-0.12, 0, 0], [0.97, 0.95, 1.05]);
  s.add(box(0.15 * k, 0.012 * k, 0.1 * k), "head", "#8a2621", up(C, 0, 0.045 * k, 0.135 * k), [0.2, 0, 0]);
  const flannel = dirty(plaid("#a3261f", "#1b1515"), seed, 0.3);
  torsoWear(s, sk, flannel);
  sleeve(s, sk, "L", flannel, "long", 0.05);
  sleeve(s, sk, "R", flannel, "long", 0.02);
  s.add(box(0.12 * k, 0.05 * k, 0.03 * k), "chest", "#8f8d86", [0, sk.j("chest").y + 0.2 * k, 0.09 * k]);
  const jeans = dirty(solid({ v: (w) => new Color("#394b66").multiplyScalar(0.88 + 0.24 * noise3(w.x * 25, w.y * 25, w.z * 25, seed)) }), seed + 1, 0.4);
  trousers(s, sk, jeans, { jag: [0.02, 0.04] });
  const hy = sk.j("hips").y;
  s.add(box(0.34 * sk.w, 0.035 * k, 0.215 * k), "hips", "#2e2118", [0, hy + 0.09 * k, 0]);
  s.add(box(0.06 * k, 0.04 * k, 0.012 * k), "hips", "#a89060", [0, hy + 0.09 * k, 0.11 * k]);
  shoes(s, sk, "#3a281b", "boot");
  return s.build();
}

function waitress(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const cy = sk.j("chest").y;
  const hy = sk.j("hips").y;
  const blue = dirty(solid("#93b6cc"), seed, 0.42);
  const white = dirty(solid("#e3dfd3"), seed + 1, 0.4);
  torsoWear(s, sk, blue);
  sleeve(s, sk, "L", blue, "short", 0.02, 1.12);
  sleeve(s, sk, "R", blue, "short", 0.05, 1.12);
  // The skirt, flaring to the knee, its hem torn.
  const skirtTop = hy + 0.06 * k;
  const skirtLow = sk.j("shin.L").y + 0.05 * k;
  s.add(cyl(0.175 * k, 0.28 * k, skirtTop - skirtLow, 12, true, 2), "hips", blue.tube(skirtTop - skirtLow, 12, 2), [0, (skirtTop + skirtLow) / 2, 0.01 * k], [0, 0, 0], [1, 1, 1], { jag: 0.06 * k });
  // Collar, apron and its bib, a name tag.
  s.add(box(0.17 * k, 0.03 * k, 0.13 * k), "chest", white.box([1, 1, 1], [1, 1, 1]), [0, cy + 0.215 * k, 0.03 * k]);
  s.add(box(0.26 * k, 0.36 * k, 0.012 * k), "hips", white.box([1, 1, 1], [1, 1, 1]), [0, hy - 0.16 * k, 0.222 * k], [-0.21, 0, 0]);
  s.add(box(0.2 * k, 0.16 * k, 0.012 * k), "chest", white.box([1, 1, 1], [1, 1, 1]), [0, cy + 0.07 * k, 0.114 * k]);
  s.add(box(0.05 * k, 0.018 * k, 0.006 * k), "chest", "#c9a33c", [0.07 * k, cy + 0.12 * k, 0.122 * k]);
  // Pale stockings, one laddered and torn; scuffed white shoes.
  const stocking = dirty(solid("#b5a595"), seed + 2, 0.3);
  for (const side of ["L", "R"] as const) {
    const knee = sk.j(`shin.${side}`);
    const ankle = sk.j(`foot.${side}`);
    tube(s, `shin.${side}`, up(knee, 0, 0.06 * k, 0), up(ankle, 0, 0.05 * k, 0), 0.052 * k, 0.05 * k, stocking.tube(1, 8, 1), { jag: side === "R" ? 0.1 * k : 0 });
  }
  shoes(s, sk, dirty(solid("#d7d3ca"), seed + 3, 0.4).box([1, 1, 1], [1, 1, 1]), "shoe");
  return s.build();
}

function hunter(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const cy = sk.j("chest").y;
  const sy = sk.j("spine").y;
  const jacket = dirty(camo(seed), seed + 1, 0.3);
  torsoWear(s, sk, jacket);
  sleeve(s, sk, "L", jacket, "long", 0.03);
  sleeve(s, sk, "R", jacket, "elbow", 0.06);
  // The blaze-orange vest over it, open down the front.
  const orange = dirty(solid("#f06a1c"), seed + 2, 0.45);
  for (const x of [-1, 1]) {
    s.add(box(0.19 * sk.w, 0.27 * k, 0.235 * k, 2, 2, 2), "chest", orange.box([1, 1, 1], [1, 1, 1]), [0.097 * x * sk.w, cy + 0.075 * k, 0]);
    s.add(box(0.16 * sk.w, 0.2 * k, 0.205 * k, 2, 1, 2), "spine", orange.box([1, 1, 1], [1, 1, 1]), [0.083 * x * sk.w, sy + 0.07 * k, 0], [0, 0, 0], [1, 1, 1], { jag: 0.02 * k });
  }
  trousers(s, sk, dirty(camo(seed + 5), seed + 6, 0.35), { jag: [0.02, 0.03] });
  shoes(s, sk, "#3b2c1e", "heavy");
  return s.build();
}

function mechanicSmall(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const cy = sk.j("chest").y;
  const coveralls = dirty(solid("#5a6a80"), seed, 0.45, 1, 0.55);
  torsoWear(s, sk, coveralls);
  sleeve(s, sk, "L", coveralls, "long", 0.02);
  sleeve(s, sk, "R", coveralls, "elbow", 0.05);
  trousers(s, sk, coveralls, { jag: [0.02, 0.02] });
  // The zip, and a name patch over the heart.
  s.add(box(0.012 * k, 0.4 * k, 0.012 * k), "chest", "#2c323b", [0, cy + 0.02 * k, 0.11 * k]);
  s.add(box(0.07 * k, 0.035 * k, 0.006 * k), "chest", "#d7d6ce", [0.08 * k, cy + 0.12 * k, 0.11 * k]);
  shoes(s, sk, "#1c1b1a", "boot");
  return s.build();
}

function suit(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const cy = sk.j("chest").y;
  const grey = dirty(solid("#3c3e43"), seed, 0.4);
  torsoWear(s, sk, grey, 1.03);
  sleeve(s, sk, "L", grey, "elbow", 0.05, 1.05);
  sleeve(s, sk, "R", grey, "long", 0.02, 1.05);
  // The open front: white shirt, lapels, a loosened tie hanging askew.
  s.add(box(0.12 * k, 0.26 * k, 0.012 * k), "chest", dirty(solid("#d9d6cd"), seed + 1, 0.35).box([1, 1, 1], [1, 1, 1]), [0, cy + 0.08 * k, 0.113 * k]);
  for (const x of [-1, 1]) s.add(box(0.05 * k, 0.24 * k, 0.014 * k), "chest", "#2b2d31", [0.066 * x * k, cy + 0.09 * k, 0.119 * k], [0, 0, -0.18 * x]);
  s.add(box(0.034 * k, 0.03 * k, 0.014 * k), "chest", "#5e1b22", [0.01 * k, cy + 0.175 * k, 0.124 * k], [0, 0, 0.3]);
  s.add(box(0.036 * k, 0.2 * k, 0.01 * k), "chest", "#6b1f27", [0.025 * k, cy + 0.06 * k, 0.126 * k], [0.05, 0, 0.14]);
  trousers(s, sk, dirty(solid("#36383d"), seed + 2, 0.4), { jag: [0.03, 0.02] });
  shoes(s, sk, "#141313", "shoe");
  return s.build();
}

// Hair, rigid on the head.

/** A cap of hair over the cranium, tipped back so the hairline clears the brow. */
function scalp(s: Parts, sk: Skel, paint: Paint, grow = 1): void {
  const k = sk.k;
  s.add(new SphereGeometry(0.1 * k, 8, 4, 0, TAU, 0, Math.PI / 2), "head", paint, up(headCentre(sk), 0, 0.004 * k, -0.006 * k), [-0.5, 0, 0], [0.97 * grow, 1.13 * grow, 1.08 * grow]);
}

function hair(sk: Skel, kind: 1 | 2 | 3 | 4, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const C = headCentre(sk);
  const r = rng(seed);
  const tone = (base: string, spread = 0.18): Paint => ({ v: (w) => new Color(base).multiplyScalar(1 - spread / 2 + spread * noise3(w.x * 40, w.y * 40, w.z * 40, seed)) });
  switch (kind) {
    case 1:
      scalp(s, sk, tone("#2a211b"));
      break;
    case 2: {
      // What is left: a thin grey fringe round the back and sides, the crown bare.
      s.add(new SphereGeometry(0.104 * k, 10, 3, Math.PI * 0.95, Math.PI * 1.1, Math.PI * 0.32, Math.PI * 0.26), "head", tone("#a39e95"), C, [0, 0, 0], [0.95, 1.1, 1.05]);
      break;
    }
    case 3: {
      // Long and tangled: strands of uneven length hanging down the back and sides.
      scalp(s, sk, tone("#211a16"));
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * (0.55 + (0.9 * i) / 7);
        const len = (0.2 + 0.16 * r()) * k;
        const x = Math.sin(a) * 0.085 * k;
        const z = Math.cos(a) * 0.09 * k;
        s.add(box(0.04 * k, len, 0.016 * k), "head", tone("#241c17", 0.3), up(C, x, 0.02 * k - len / 2, z), [-0.15 + 0.2 * r(), a, (x > 0 ? 1 : -1) * 0.12 + 0.1 * (r() - 0.5)]);
      }
      break;
    }
    case 4: {
      // A matted mess of greasy clumps.
      scalp(s, sk, tone("#3b332a"), 1.03);
      for (let i = 0; i < 8; i++) {
        const a = TAU * r();
        const el = 0.2 + 0.9 * r();
        const d = 0.1 * k;
        s.add(new IcosahedronGeometry((0.032 + 0.022 * r()) * k, 0), "head", tone("#3d342a", 0.35), up(C, Math.sin(a) * Math.cos(el) * d, Math.sin(el) * d * 1.05, Math.cos(a) * Math.cos(el) * d - 0.01 * k), [r() * 3, r() * 3, 0]);
      }
      break;
    }
  }
  return s.build();
}

// --- the four bodies of the dead ------------------------------------------------------------

function crawlerBody(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const skin = deadSkin("#8e9580", seed, { mottle: 0.3, blotches: 0.42 });
  deadBody(s, sk, skin, { limbs: 0.95, legs: false });
  // What is left of the legs: thighs ending in ragged, dark stumps at the knee.
  for (const side of ["L", "R"] as const) {
    const hip = sk.j(`thigh.${side}`);
    const knee = sk.j(`shin.${side}`);
    limb(s, `thigh.${side}`, hip, up(knee, 0, 0.04 * k, 0), 0.055 * k, skin, 0.02 * k, 6, 1);
    s.add(ball(0.05 * k), `thigh.${side}`, "#3a1714", up(knee, 0, 0.05 * k, 0), [0, 0, 0], [1, 0.55, 1]);
  }
  // In rags: a torn filthy shirt, one sleeve gone, trousers torn off at the stumps.
  const shirt = dirty(solid("#6b6353"), seed + 1, 0.5);
  torsoWear(s, sk, shirt, 1, 0.05 * k);
  sleeve(s, sk, "L", shirt, "elbow", 0.07);
  sleeve(s, sk, "R", shirt, "short", 0.06);
  trousers(s, sk, dirty(solid("#3a3631"), seed + 2, 0.5), { to: "knee", jag: [0.07 * k, 0.09 * k] });
  return s.build();
}

function bloaterBody(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const skin = deadSkin("#a3b187", seed, { mottle: 0.2, blotches: 0.3, bruise: "#5b5f4a", rot: "#7d8a55" });
  deadBody(s, sk, skin, { limbs: 1.55, torso: 1.4, bareShins: true });
  const C = headCentre(sk);
  // Swollen jowls under the jaw.
  s.add(ball(0.075 * k, 8, 5), "neck", skin, up(C, 0, -0.1 * k, 0.015 * k), [0, 0, 0], [1.2, 0.7, 1.05]);
  // The remains: a stretched vest riding up over the chest, trousers split open.
  const vest = dirty(solid("#aba48c"), seed + 1, 0.5);
  const cy = sk.j("chest").y;
  const ribs: Vec3 = [0.49 * sk.w, 0.26 * k, 0.29 * k];
  s.add(box(...ribs, 3, 2, 2), "chest", vest.box(ribs, [3, 2, 2]), [0, cy + 0.08 * k, 0], [0, 0, 0], [1, 1, 1], { jag: 0.05 * k });
  trousers(s, sk, dirty(solid("#4a443b"), seed + 2, 0.45), { to: "knee", jag: [0.05 * k, 0.08 * k], grow: 1.45 });
  return s.build();
}

function belly(sk: Skel, seed: number): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  const base = new Color("#b3c093");
  const vein = new Color("#58706a");
  const dark = new Color("#6d6b4d");
  // Taut, glistening, veined: it must read as the thing to shoot.
  const paint: Paint = {
    v: (w) => {
      const n = noise3(w.x * 18, w.y * 18, w.z * 18, seed);
      const c = base.clone().lerp(vein, 0.7 * (smooth(0.46, 0.5, n) - smooth(0.5, 0.54, n)));
      return c.lerp(dark, 0.5 * smooth(0.65, 0.8, noise3(w.x * 6, w.y * 6, w.z * 6, seed + 1)));
    },
  };
  const hy = sk.j("hips").y;
  s.add(ball(0.25 * k, 12, 8), { a: "hips", b: "spine", axis: 1, from: hy + 0.03 * k, to: hy + 0.18 * k }, paint, [0, hy + 0.13 * k, 0.12 * k], [0, 0, 0], [1.02, 0.94, 1.0]);
  return s.build();
}

export function buildWalkerAsset(): LoadedAsset {
  const sk = new Skel(HUMANOID);
  const root = nameNode(new Group(), "walker");
  root.add(sk.armature);
  const bodyMat = new MeshStandardMaterial({ name: "body", vertexColors: true, roughness: 0.74, metalness: 0 });
  const clothMat = new MeshStandardMaterial({ name: "cloth", vertexColors: true, roughness: 0.92, metalness: 0 });
  const hairMat = new MeshStandardMaterial({ name: "hair", vertexColors: true, roughness: 0.8, metalness: 0 });
  const bellyMat = new MeshStandardMaterial({ name: "belly", vertexColors: true, roughness: 0.34, metalness: 0 });

  // One body shows at a time (the game picks); the ordinary walker by default.
  const walker = new Parts(sk);
  deadBody(walker, sk, deadSkin("#9ba48d", 101), { limbs: 0.95, shorts: "#39342e", feet: deadSkin("#7d8374", 102) });
  skinned(sk, "char.walker", walker.build(), bodyMat);
  const runner = new Parts(sk);
  deadBody(runner, sk, deadSkin("#b8a39a", 201, { mottle: 0.14, blotches: 0.2, bruise: "#6b4a50", rot: "#8e8a6a" }), { limbs: 0.9, shorts: "#39342e" });
  skinned(sk, "char.runner", runner.build(), bodyMat, false);
  skinned(sk, "char.crawler", crawlerBody(sk, 301), bodyMat, false);
  skinned(sk, "char.bloater", bloaterBody(sk, 401), bodyMat, false);
  skinned(sk, "belly", belly(sk, 402), bellyMat, false);
  skinned(sk, "eyes", eyes(sk), eyeMaterial());

  const outfits: [string, (sk: Skel, seed: number) => BufferGeometry][] = [
    ["farmer", farmer],
    ["trucker", trucker],
    ["waitress", waitress],
    ["hunter", hunter],
    ["mechanic_small", mechanicSmall],
    ["suit", suit],
  ];
  outfits.forEach(([name, make], i) => skinned(sk, `var.outfit.${name}`, make(sk, 500 + i * 10), clothMat, i === 0));
  for (const n of [1, 2, 3, 4] as const) skinned(sk, `var.hair.${n}`, hair(sk, n, 600 + n), hairMat, n === 1);

  return { scene: root, animations: deadClips(humanoidKit()) };
}

// --- the Mechanic --------------------------------------------------------------------------

/** He is the standard humanoid 1.2 times taller and 1.3 times wider: about 2.1 m. */
const MECHANIC_TALL = 1.2;
const MECHANIC_WIDE = 1.3;

export function buildMechanicAsset(): LoadedAsset {
  const defs = scaledHumanoid(MECHANIC_WIDE, MECHANIC_TALL);
  const sk = new Skel(defs, MECHANIC_TALL, MECHANIC_WIDE);
  const k = sk.k;
  const root = nameNode(new Group(), "mechanic");
  root.add(sk.armature);

  const s = new Parts(sk);
  const skin = deadSkin("#948e7f", 701, { mottle: 0.22, blotches: 0.3, bruise: "#56434a", rot: "#6c7450" });
  deadBody(s, sk, skin, { limbs: 1.4, torso: 1.15 });
  // Grease-stained dark coveralls, sleeves rolled to the elbow over bare thick forearms.
  const coveralls = dirty(solid("#34352f"), 702, 0.35, k, 0.6);
  torsoWear(s, sk, coveralls, 1.16);
  for (const side of ["L", "R"] as const) {
    sleeve(s, sk, side, coveralls, "elbow", 0, 1.35);
    // The rolled cuff.
    const el = sk.j(`forearm.${side}`);
    tube(s, `upper_arm.${side}`, up(el, 0, 0.05 * k, 0), up(el, 0, -0.005 * k, 0), 0.076 * k, 0.076 * k, "#2a2b26");
  }
  trousers(s, sk, coveralls, { grow: 1.38 });
  s.add(box(0.02 * k, 0.42 * k, 0.014 * k), "chest", "#1c1d1a", [0, sk.j("chest").y + 0.02 * k, 0.126 * k]);
  s.add(box(0.1 * k, 0.1 * k, 0.012 * k), "chest", "#2a2b27", [0.1 * k, sk.j("chest").y + 0.1 * k, 0.128 * k]);
  shoes(s, sk, "#161514", "heavy", 1.3);
  skinned(sk, "char.mechanic", s.build(), new MeshStandardMaterial({ name: "body", vertexColors: true, roughness: 0.8, metalness: 0 }));
  skinned(sk, "eyes", eyes(sk), eyeMaterial());

  // The welding mask: a plain mesh on the head bone, so the game can hide it
  // and throw a copy of it (a skinned copy would stay stuck to the head).
  const head = sk.bone("head");
  const mask = nameNode(new Mesh(weldingMask(sk), [
    new MeshStandardMaterial({ name: "steel", vertexColors: true, roughness: 0.5, metalness: 0.6, side: DoubleSide }),
    new MeshStandardMaterial({ name: "glass", color: "#0b1812", roughness: 0.06, metalness: 0.3 }),
  ]), "var.mask");
  mask.castShadow = true;
  head.add(mask);

  // The tyre iron, held in the right fist.
  const socket = nameNode(new Object3D(), "socket.weapon");
  socket.position.set(0, -0.07 * k, 0.015 * k);
  sk.bone("hand.R").add(socket);
  const iron = nameNode(new Mesh(tyreIron(k), new MeshStandardMaterial({ name: "iron", vertexColors: true, roughness: 0.45, metalness: 0.8 })), "prop.tyre_iron");
  // Along the fist's +Z, tipped down: it hangs down and forward from a slack arm,
  // points back past the head at the top of the swing, and straight ahead at impact.
  iron.rotation.x = 0.93;
  iron.castShadow = true;
  socket.add(iron);

  return { scene: root, animations: mechanicClips(humanoidKit(defs)) };
}

/** The mask in the head bone's frame: a curved steel shield, a dark window, a headband and pivots. */
function weldingMask(sk: Skel): BufferGeometry {
  const s = new Parts(null);
  const k = sk.k;
  const C = headCentre(sk).sub(sk.j("head"));
  const steel: Paint = { v: (w) => new Color("#3a3c3e").multiplyScalar(0.8 + 0.4 * noise3(w.x * 25, w.y * 25, w.z * 25, 703)) };
  s.add(new CylinderGeometry(0.135 * k, 0.125 * k, 0.25 * k, 10, 1, true, -1.35, 2.7), "head", steel, up(C, 0, -0.012 * k, -0.005 * k));
  s.add(box(0.2 * k, 0.02 * k, 0.1 * k), "head", steel, up(C, 0, -0.135 * k, 0.07 * k), [0.3, 0, 0]);
  s.add(box(0.125 * k, 0.07 * k, 0.012 * k), "head", "#55585a", up(C, 0, 0.022 * k, 0.133 * k));
  s.add(box(0.1 * k, 0.045 * k, 0.012 * k), "head", "#ffffff", up(C, 0, 0.022 * k, 0.139 * k), [0, 0, 0], [1, 1, 1], { mat: 1 });
  s.add(new CylinderGeometry(0.106 * k, 0.106 * k, 0.025 * k, 12, 1, true), "head", "#1d1d1c", up(C, 0, 0.05 * k, -0.005 * k), [-0.15, 0, 0]);
  for (const x of [-1, 1]) s.add(cyl(0.022 * k, 0.022 * k, 0.03 * k, 8), "head", "#2a2b2c", up(C, 0.125 * x * k, 0.01 * k, 0), [0, 0, Math.PI / 2]);
  return s.build();
}

/** An L-shaped tyre iron along +Z: a flat pry end behind the fist, a lug socket bent down at the far end. */
function tyreIron(k: number): BufferGeometry {
  const s = new Parts(null);
  const steel: Paint = {
    v: (w) => {
      const c = new Color("#4b4b49");
      return c.lerp(new Color("#5a3522"), 0.6 * smooth(0.6, 0.75, noise3(w.x * 60, w.y * 60, w.z * 60, 704)));
    },
  };
  s.add(cyl(0.011 * k, 0.011 * k, 0.6 * k, 6), "", steel, [0, 0, 0.2 * k], [Math.PI / 2, 0, 0]);
  s.add(box(0.032 * k, 0.007 * k, 0.06 * k), "", steel, [0, 0, -0.12 * k]);
  s.add(cyl(0.011 * k, 0.011 * k, 0.11 * k, 6), "", steel, [0, -0.05 * k, 0.5 * k]);
  s.add(cyl(0.02 * k, 0.02 * k, 0.05 * k, 8), "", steel, [0, -0.11 * k, 0.5 * k]);
  return s.build();
}

// --- the survivors ---------------------------------------------------------------------------

interface Living {
  skin: string;
  slim: number;
}

/** A living body: a proper face, healthy colour, clothes on. */
function livingBody(s: Parts, sk: Skel, o: Living): Paint {
  const k = sk.k;
  const C = headCentre(sk);
  const skin = liveSkin(o.skin, C);
  const at = (x: number, y: number, z: number) => up(C, x * k, y * k, z * k);
  s.add(new IcosahedronGeometry(0.1 * k, 1), "head", skin, at(0, 0, 0), [0, 0, 0], [0.92, 1.08, 1.0]);
  s.add(box(0.09 * k, 0.05 * k, 0.08 * k), "head", skin, at(0, -0.07, 0.03));
  s.add(box(0.022 * k, 0.038 * k, 0.026 * k), "head", skin, at(0, -0.008, 0.1));
  s.add(box(0.036 * k, 0.01 * k, 0.012 * k), "head", "#9b5a52", at(0, -0.055, 0.092));
  for (const x of [-1, 1]) {
    s.add(box(0.02 * k, 0.014 * k, 0.012 * k), "head", "#f0ece4", at(0.035 * x, 0.018, 0.09));
    s.add(box(0.011 * k, 0.012 * k, 0.012 * k), "head", "#2a1c15", at(0.035 * x, 0.018, 0.094));
    s.add(box(0.03 * k, 0.007 * k, 0.012 * k), "head", "#4a3426", at(0.035 * x, 0.043, 0.092));
    s.add(box(0.012 * k, 0.04 * k, 0.028 * k), "head", skin, at(0.09 * x, 0.0, 0.0));
  }
  const J = (n: string) => sk.j(n);
  const neckLo = J("neck").y - 0.03 * k;
  const neckHi = C.y - 0.05 * k;
  s.add(cyl(0.043 * k, 0.046 * k, neckHi - neckLo, 6, true), "neck", skin, [0, (neckHi + neckLo) / 2, 0.004 * k]);
  for (const side of ["L", "R"] as const) {
    limb(s, `forearm.${side}`, J(`forearm.${side}`), J(`hand.${side}`), 0.037 * k * o.slim, skin, 0.01 * k);
    const hand = J(`hand.${side}`);
    s.add(box(0.06 * k, 0.1 * k, 0.035 * k), `hand.${side}`, skin, up(hand, 0, -0.05 * k, 0.005 * k));
    limb(s, `upper_arm.${side}`, J(`upper_arm.${side}`), J(`forearm.${side}`), 0.045 * k * o.slim, skin, 0.02 * k);
    limb(s, `thigh.${side}`, J(`thigh.${side}`), J(`shin.${side}`), 0.062 * k * o.slim, skin, 0.02 * k);
    limb(s, `shin.${side}`, J(`shin.${side}`), J(`foot.${side}`), 0.05 * k * o.slim, skin);
  }
  return skin;
}

function daughter(sk: Skel): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  livingBody(s, sk, { skin: "#e2af8c", slim: 0.92 });
  const shirt = plaid("#c0443a", "#27304f");
  torsoWear(s, sk, shirt, 0.96);
  sleeve(s, sk, "L", shirt, "elbow", 0, 0.95);
  sleeve(s, sk, "R", shirt, "elbow", 0, 0.95);
  for (const side of ["L", "R"] as const) {
    const el = sk.j(`forearm.${side}`);
    tube(s, `forearm.${side}`, up(el, 0, 0.02 * k, 0), up(el, 0, -0.04 * k, 0), 0.05 * k, 0.048 * k, "#8e3029");
  }
  trousers(s, sk, solid({ v: (w) => new Color("#3f5a80").multiplyScalar(0.9 + 0.2 * noise3(w.x * 30, w.y * 30, w.z * 30, 801)) }), { grow: 0.95 });
  shoes(s, sk, "#e7e4dc", "shoe");
  for (const side of ["L", "R"] as const) {
    const foot = sk.j(`foot.${side}`);
    s.add(box(0.104 * k, 0.02 * k, 0.27 * k), `foot.${side}`, "#6e6a64", [foot.x, 0.01 * k, foot.z + 0.05 * k]);
  }
  // A ponytail.
  const C = headCentre(sk);
  scalp(s, sk, "#6a4226");
  s.add(cap(0.032 * k, 0.17 * k), "head", "#633d23", up(C, 0, -0.03 * k, -0.13 * k), [0.45, 0, 0]);
  s.add(cyl(0.028 * k, 0.028 * k, 0.02 * k, 8), "head", "#2c6fb0", up(C, 0, 0.035 * k, -0.105 * k), [0.45, 0, 0]);
  return s.build();
}

function owner(sk: Skel): BufferGeometry {
  const s = new Parts(sk);
  const k = sk.k;
  livingBody(s, sk, { skin: "#d7a585", slim: 1 });
  const C = headCentre(sk);
  // Grey hair, a moustache, glasses.
  s.add(new SphereGeometry(0.104 * k, 10, 3, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.2, Math.PI * 0.36), "head", "#c3bfb8", C, [0, 0, 0], [0.96, 1.1, 1.06]);
  s.add(box(0.07 * k, 0.018 * k, 0.02 * k), "head", "#b9b4ab", up(C, 0, -0.035 * k, 0.1 * k));
  for (const x of [-1, 1]) s.add(box(0.034 * k, 0.026 * k, 0.006 * k), "head", "#2a2522", up(C, 0.036 * x * k, 0.018 * k, 0.101 * k));
  s.add(box(0.1 * k, 0.005 * k, 0.005 * k), "head", "#2a2522", up(C, 0, 0.028 * k, 0.103 * k));
  // A knitted cardigan over a pale blue shirt, slacks, brown shoes.
  const cardigan: Fabric = solid({ v: (w) => new Color("#76603f").multiplyScalar(0.88 + 0.24 * noise3(w.x * 45, w.y * 45, w.z * 45, 802)) });
  torsoWear(s, sk, cardigan, 1.06);
  sleeve(s, sk, "L", cardigan, "long", 0, 1.05);
  sleeve(s, sk, "R", cardigan, "long", 0, 1.05);
  const cy = sk.j("chest").y;
  s.add(box(0.1 * k, 0.1 * k, 0.012 * k), "chest", "#a8bfd6", [0, cy + 0.15 * k, 0.108 * k]);
  for (let i = 0; i < 4; i++) s.add(box(0.014 * k, 0.014 * k, 0.008 * k), "chest", "#d8cfb8", [0.012 * k, cy + (0.1 - i * 0.075) * k, 0.12 * k]);
  trousers(s, sk, solid("#6c6860"), { grow: 1.02 });
  shoes(s, sk, "#4a3526", "shoe");
  return s.build();
}

/** A hurricane lantern hanging from the fist: bail handle, cap, glass globe, wire guard, fount. */
function lantern(): Group {
  const g = nameNode(new Group(), "prop.lantern");
  const tin = new Parts(null);
  const paint: Paint = { v: (w) => new Color(w.y < -0.17 ? "#8e2b22" : "#3a3634").multiplyScalar(0.85 + 0.3 * noise3(w.x * 60, w.y * 60, w.z * 60, 901)) };
  const wire = "#2d2b29";
  tin.add(new TorusGeometry(0.045, 0.003, 4, 10, Math.PI), "", wire, [0, -0.045, 0]);
  tin.add(cyl(0.028, 0.048, 0.03, 10), "", paint, [0, -0.06, 0]);
  tin.add(cyl(0.012, 0.012, 0.02, 6), "", paint, [0, -0.04, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    tin.add(box(0.004, 0.11, 0.004), "", wire, [Math.sin(a) * 0.052, -0.125, Math.cos(a) * 0.052]);
  }
  tin.add(new TorusGeometry(0.052, 0.003, 4, 12), "", wire, [0, -0.125, 0], [Math.PI / 2, 0, 0]);
  tin.add(cyl(0.05, 0.056, 0.05, 12), "", paint, [0, -0.205, 0]);
  const body = new Mesh(tin.build(), new MeshStandardMaterial({ name: "tin", vertexColors: true, roughness: 0.55, metalness: 0.5 }));
  // The globe glows a little by itself, so a lit lantern reads even through a fade.
  const globe = nameNode(
    new Mesh(new SphereGeometry(0.043, 12, 8), new MeshStandardMaterial({ name: "globe", color: "#e8d2a0", emissive: "#6a3a0e", roughness: 0.08, transparent: true, opacity: 0.45, depthWrite: false })),
    "lantern.globe",
  );
  globe.position.set(0, -0.125, 0);
  globe.scale.set(1, 1.3, 1);
  // A teardrop flame on its wick, drawn before the glass so it shows through it.
  const flameShape = [
    [0, 0],
    [0.008, 0.006],
    [0.011, 0.016],
    [0.008, 0.028],
    [0.003, 0.038],
    [0, 0.044],
  ].map(([x, y]) => new Vector2(x, y));
  const flame = nameNode(new Mesh(new LatheGeometry(flameShape, 8), new MeshStandardMaterial({ name: "flame", color: "#ffc070", emissive: "#ff8a1e", emissiveIntensity: 2.5, roughness: 1 })), "lantern.flame");
  flame.position.set(0, -0.165, 0);
  flame.renderOrder = -1;
  g.add(body, globe, flame);
  body.castShadow = true;
  return g;
}

export function buildSurvivorAsset(): LoadedAsset {
  const sk = new Skel(HUMANOID);
  const root = nameNode(new Group(), "survivor");
  root.add(sk.armature);
  const mat = new MeshStandardMaterial({ name: "person", vertexColors: true, roughness: 0.78, metalness: 0 });
  skinned(sk, "var.person.daughter", daughter(sk), mat);
  skinned(sk, "var.person.owner", owner(sk), mat, false);
  const socket = nameNode(new Object3D(), "socket.lantern");
  socket.position.set(0, -0.075, 0.01);
  sk.bone("hand.L").add(socket);
  socket.add(lantern());
  return { scene: root, animations: survivorClips(humanoidKit()) };
}

// --- the cat ------------------------------------------------------------------------------------

export function buildCatAsset(): LoadedAsset {
  const sk = new Skel(CAT);
  const root = nameNode(new Group(), "cat");
  root.add(sk.armature);
  const s = new Parts(sk);
  const J = (n: string) => sk.j(n);
  // Very dark grey, not black, with a slight sheen from the material: it must still show in the beam.
  const fur: Paint = { v: (w) => new Color("#1b1b1f").multiplyScalar(0.85 + 0.3 * noise3(w.x * 40, w.y * 40, w.z * 40, 950)) };
  const body = J("body");
  const spine = J("spine");
  s.add(ball(0.068, 10, 7), "body", fur, up(body, 0, 0.0, -0.01), [0, 0, 0], [0.85, 0.95, 1.15]);
  const mid = along(up(body, 0, 0.004, 0.02), up(spine, 0, 0.002, -0.02));
  s.add(cap(0.056, mid.len, 8), { a: "body", b: "spine", axis: 2, from: body.z + 0.04, to: spine.z - 0.04 }, fur, mid.mid, mid.rot);
  s.add(ball(0.062, 10, 7), "spine", fur, up(spine, 0, 0.004, 0.0), [0, 0, 0], [0.85, 1, 1.05]);
  const neck = along(up(J("neck"), 0, -0.01, -0.01), up(J("head"), 0, -0.01, 0));
  s.add(cap(0.034, neck.len, 8), "neck", fur, neck.mid, neck.rot);
  const H = J("head");
  s.add(ball(0.05, 10, 7), "head", fur, up(H, 0, 0.012, 0.012), [0, 0, 0], [1.05, 0.92, 1.0]);
  s.add(ball(0.025, 8, 5), "head", fur, up(H, 0, -0.006, 0.05), [0, 0, 0], [1.15, 0.8, 0.9]);
  s.add(box(0.012, 0.008, 0.008), "head", "#2e2224", up(H, 0, 0.003, 0.073));
  for (const x of [-1, 1]) {
    s.add(cyl(0, 0.022, 0.042, 4), "head", fur, up(H, 0.03 * x, 0.05, 0.008), [-0.15, Math.PI / 4, 0.35 * x]);
    s.add(cyl(0, 0.014, 0.03, 4), "head", "#3b2c2e", up(H, 0.029 * x, 0.048, 0.013), [-0.15, Math.PI / 4, 0.35 * x]);
    for (let i = 0; i < 3; i++) s.add(box(0.075, 0.0016, 0.0016), "head", "#8f8e8a", up(H, 0.045 * x, -0.006 - 0.004 * i, 0.058), [0, 0.25 * x, (0.06 * (i - 1) - 0.05) * x]);
  }
  // The tail, three segments tapering, its tip curling forward.
  const tailTip = up(J("tail.3"), 0, 0.07, 0.015);
  const segs: [string, Vector3, Vector3, number][] = [
    ["tail.1", J("tail.1"), J("tail.2"), 0.02],
    ["tail.2", J("tail.2"), J("tail.3"), 0.017],
    ["tail.3", J("tail.3"), tailTip, 0.014],
  ];
  for (const [bone, a, b, r] of segs) limb(s, bone, a, b, r, fur, 0.012);
  for (const leg of ["FL", "FR", "BL", "BR"]) {
    const top = J(`leg.${leg}`);
    const knee = J(`paw.${leg}`);
    const back = leg.startsWith("B");
    limb(s, `leg.${leg}`, back ? up(top, 0, 0.02, 0) : top, knee, back ? 0.03 : 0.021, fur, 0.01);
    const tip = up(knee, 0, -0.082, 0);
    limb(s, `paw.${leg}`, knee, up(tip, 0, 0.01, 0), back ? 0.017 : 0.016, fur, 0.006);
    s.add(ball(0.019), `paw.${leg}`, fur, up(tip, 0, 0.008, 0.01), [0, 0, 0], [1, 0.55, 1.35]);
  }
  skinned(sk, "char.cat", s.build(), new MeshStandardMaterial({ name: "fur", vertexColors: true, roughness: 0.38, metalness: 0.05 }));
  const e = new Parts(sk);
  for (const x of [-1, 1]) e.add(ball(0.011, 7, 5), "head", "#ffffff", up(H, 0.022 * x, 0.018, 0.054), [0, 0.3 * x, 0], [1.15, 0.85, 0.55]);
  skinned(sk, "eyes", e.build(), eyeMaterial());
  return { scene: root, animations: catClips(catKit()) };
}
