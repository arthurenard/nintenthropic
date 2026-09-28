import {
  AnimationClip,
  Euler,
  InterpolateSmooth,
  Matrix4,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from "three";

/**
 * Dead of Night's placeholder clips: the dead, the Mechanic, the survivors
 * and the cat, built in code to the names and lengths the Blender actions
 * follow (docs/DEAD_OF_NIGHT.md, "Characters"). Like High Noon's, they are
 * key poses turned into quaternion tracks; unlike High Noon's, the feet (and
 * the crawler's hands) are placed with a little inverse kinematics, because
 * the game plays every gait in place at timeScale = speed / authored speed:
 * a foot on the ground has to slide back at exactly the authored speed or the
 * dead skate up the road.
 */

export type Vec3 = [number, number, number];
export type BoneDef = [name: string, parent: string | null, offset: Vec3];

/** Bone rotations in degrees, applied yaw (Y), then pitch (X), then roll (Z). */
export type Pose = Record<string, Vec3>;

/** Where an end of a limb (a foot, a hand, a paw) must be, in the rig's rest frame. */
export interface Reach {
  at: Vec3;
  /** The end bone's world rotation, degrees (a flat foot is [0, yaw, 0]). */
  turn?: Vec3;
  /** Which way the knee or elbow points, in world space. */
  pole?: Vec3;
  /**
   * A stiff limb: the knee may not fold below this fraction of the limb's
   * length, so the foot swings out round it instead (a limp).
   */
  stiff?: number;
}

export interface Key {
  t: number;
  pose: Pose;
  /** Offset of the root bone (the hips) from its rest position, metres. */
  hips?: Vec3;
  /** Limb ends to place, by the end's name (`foot.L`, `hand.R`, `paw.FL`). */
  reach?: Record<string, Reach>;
  /** Bones held at a world rotation whatever their parents do (a lantern hand held plumb). */
  level?: Record<string, Vec3>;
  scale?: Record<string, Vec3>;
}

/** One foot's (or hand's) part in a gait: when it lands and how long it stays down. */
export interface Step {
  /** When it lands, as a fraction of the cycle. */
  land: number;
  /** How much of the cycle it stays on the ground. */
  stance: number;
  /** How high it lifts mid-swing, metres. */
  lift: number;
  /** Where its travel is centred, metres forward of the rest foot. */
  z?: number;
  /** Metres further out than the rest foot. */
  out?: number;
  /** Extra outward swing mid-swing: a stiff leg circling round. */
  circle?: number;
  /** Dragged: the toe stays on the ground through the swing, the foot pointed. */
  drag?: boolean;
  /** The knee kept nearly straight through the swing. */
  stiff?: boolean;
  /** Degrees the toes turn out. */
  toeOut?: number;
  /** Degrees the toe points down as it leaves the ground (or while dragged). */
  toeOff?: number;
  /** Degrees the toe comes up before the heel lands. */
  heel?: number;
  /** Below 1: the foot snaps up early in the swing (a running heel kick). */
  snap?: number;
}

export interface Gait {
  name: string;
  /** The ground speed the stride is built for, m/s. */
  speed: number;
  /** One full cycle (two steps), seconds. */
  period: number;
  keys: number;
  L: Step;
  R: Step;
  /** The highest the hips ride below their rest height, metres; the planted legs' reach lowers them further. */
  crouch: number;
  /** The planted legs' greatest reach, as a fraction of their length (the knee never quite locks). */
  reach?: number;
  /** Everything but the feet, through the cycle (0..1). */
  body: (p: number) => { pose: Pose; hips?: Vec3; reach?: Record<string, Reach>; level?: Record<string, Vec3> };
}

/** How much of the foot is ahead of and behind the ankle, for keeping a pointed toe out of the ground. */
interface Sole {
  toe: number;
  heel: number;
}

/** A two-bone limb: its bones point along their local −Y and bend about their local X. */
interface Limb {
  upper: string;
  lower: string;
  /** The end bone, or null when the limb ends `tip` metres down the lower bone (the cat's paws). */
  end: string | null;
  tip: number;
  /** +1: the joint points toward the pole (a knee); −1: the same, with the frame an elbow's rest frame. */
  bend: 1 | -1;
  /** Default pole, in the upper bone's parent frame. */
  pole: Vec3;
}

export const GAIT_SPEEDS = { "walk.shamble": 1.0, "walk.limp": 0.85, "walk.drag": 0.75, "walk.lurch": 1.1, run: 3.5, crawl: 0.45 } as const;
export const SURVIVOR_SPEEDS = { run: 4.5, run_lantern: 4.2 } as const;
export const CAT_SPEEDS = { walk: 0.6 } as const;

/** The standard humanoid, High Noon's proportions: about 1.76 m tall. */
export const HUMANOID: BoneDef[] = [
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

/** The standard humanoid made bigger: `wide` across, `tall` up and front to back. */
export function scaledHumanoid(wide: number, tall: number): BoneDef[] {
  return HUMANOID.map(([n, p, [x, y, z]]) => [n, p, [x * wide, y * tall, z * tall]]);
}

/** How far below the `paw.*` bones the cat's pads touch the ground. */
export const CAT_PAW_TIP = 0.082;

/** The cat: about 0.45 m nose to rump, the tail rising behind. */
export const CAT: BoneDef[] = [
  ["body", null, [0, 0.2, -0.09]],
  ["spine", "body", [0, 0.012, 0.16]],
  ["neck", "spine", [0, 0.03, 0.055]],
  ["head", "neck", [0, 0.055, 0.03]],
  ["tail.1", "body", [0, 0.025, -0.07]],
  ["tail.2", "tail.1", [0, 0.06, -0.075]],
  ["tail.3", "tail.2", [0, 0.085, -0.03]],
  ["leg.FL", "spine", [0.038, -0.03, 0.01]],
  ["paw.FL", "leg.FL", [0, -0.09, 0]],
  ["leg.FR", "spine", [-0.038, -0.03, 0.01]],
  ["paw.FR", "leg.FR", [0, -0.09, 0]],
  ["leg.BL", "body", [0.042, -0.018, -0.02]],
  ["paw.BL", "leg.BL", [0, -0.09, 0]],
  ["leg.BR", "body", [-0.042, -0.018, -0.02]],
  ["paw.BR", "leg.BR", [0, -0.09, 0]],
];

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const X_AXIS = new Vector3(1, 0, 0);
const euler = new Euler();

function quatOf(r: Vec3, out = new Quaternion()): Quaternion {
  return out.setFromEuler(euler.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, "YXZ"));
}

function degOf(q: Quaternion): Vec3 {
  euler.setFromQuaternion(q, "YXZ");
  return [euler.x / DEG, euler.y / DEG, euler.z / DEG];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const frac = (x: number) => x - Math.floor(x);
/** A wave through the cycle, +1 at phase `at`. */
const cyc = (p: number, at = 0) => Math.cos(TAU * (p - at));
/** The same, twice per cycle (once per step). */
const cyc2 = (p: number, at = 0) => Math.cos(2 * TAU * (p - at));
const sin = (p: number, at = 0) => Math.sin(TAU * (p - at));
/** A smooth bump `width` of the cycle wide, 1 at phase `at`, 0 elsewhere. */
function bump(p: number, at: number, width: number): number {
  const d = frac(p - at + 0.5) - 0.5;
  if (Math.abs(d) >= width / 2) return 0;
  const c = Math.cos((Math.PI * d) / width);
  return c * c;
}

/**
 * Build an AnimationClip from key poses, the way the Blender actions arrive:
 * quaternion tracks per bone named with the glTF loader's sanitised node
 * names, the root's translation, and any scale. Bones a key leaves out are
 * at rest.
 */
export function makeClip(name: string, keys: Key[], root: string, rootRest: Vec3, smooth = true): AnimationClip {
  const bones = new Set<string>();
  const scaled = new Set<string>();
  for (const k of keys) {
    for (const b of Object.keys(k.pose)) bones.add(b);
    for (const b of Object.keys(k.scale ?? {})) scaled.add(b);
  }
  const times = keys.map((k) => k.t);
  const tracks: KeyframeTrack[] = [];
  const quat = new Quaternion();
  for (const bone of bones) {
    const values: number[] = [];
    let prev: Quaternion | null = null;
    for (const k of keys) {
      quatOf(k.pose[bone] ?? [0, 0, 0], quat);
      // Keep successive keys on the same hemisphere so slerp takes the short way.
      if (prev && prev.dot(quat) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
      prev = quat.clone();
      values.push(quat.x, quat.y, quat.z, quat.w);
    }
    tracks.push(new QuaternionKeyframeTrack(`${PropertyBinding.sanitizeNodeName(bone)}.quaternion`, times, values));
  }
  for (const bone of scaled) {
    const values: number[] = [];
    for (const k of keys) values.push(...(k.scale?.[bone] ?? [1, 1, 1]));
    tracks.push(new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(bone)}.scale`, times, values));
  }
  if (keys.some((k) => k.hips)) {
    const values: number[] = [];
    for (const k of keys) {
      const h = k.hips ?? [0, 0, 0];
      values.push(rootRest[0] + h[0], rootRest[1] + h[1], rootRest[2] + h[2]);
    }
    const track = new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(root)}.position`, times, values);
    if (smooth && keys.length > 2) track.setInterpolation(InterpolateSmooth);
    tracks.push(track);
  }
  return new AnimationClip(name, keys[keys.length - 1]?.t ?? 0, tracks);
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

/**
 * Where a foot (or hand) is through a gait cycle `p`: on the ground it slides
 * back from +S/2 to −S/2 at exactly `speed`, S being what the body covers
 * while it is down; in the air it comes forward again, easing in and out.
 */
export function stride(s: Step, p: number, speed: number, period: number): { planted: boolean; z: number; u: number; arc: number } {
  const q = frac(p - s.land);
  const S = speed * s.stance * period;
  if (q < s.stance) return { planted: true, z: S / 2 - (S * q) / s.stance, u: 0, arc: 0 };
  const u = (q - s.stance) / (1 - s.stance);
  return { planted: false, z: -S / 2 + (S * (1 - Math.cos(Math.PI * u))) / 2, u, arc: Math.sin(Math.PI * u) };
}

function lerp3(a: Vec3 | undefined, b: Vec3 | undefined, f: number): Vec3 {
  const x = a ?? [0, 0, 0];
  const y = b ?? [0, 0, 0];
  return [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
}

const _qa = new Quaternion();
const _qb = new Quaternion();

/** Two poses blended bone by bone, the short way round. */
function blendPose(a: Pose, b: Pose, f: number): Pose {
  const out: Pose = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    quatOf(a[name] ?? [0, 0, 0], _qa);
    quatOf(b[name] ?? [0, 0, 0], _qb);
    out[name] = degOf(_qa.slerp(_qb, f));
  }
  return out;
}

function blendReach(a: Reach, b: Reach, f: number): Reach {
  const r: Reach = { at: lerp3(a.at, b.at, f) };
  if (a.turn || b.turn) {
    quatOf(a.turn ?? [0, 0, 0], _qa);
    quatOf(b.turn ?? [0, 0, 0], _qb);
    r.turn = degOf(_qa.slerp(_qb, f));
  }
  if (a.pole && b.pole) r.pole = lerp3(a.pole, b.pole, f);
  else if (a.pole ?? b.pole) r.pole = a.pole ?? b.pole;
  const stiff = a.stiff ?? b.stiff;
  if (stiff) r.stiff = stiff;
  return r;
}

function blendScale(a: Record<string, Vec3> | undefined, b: Record<string, Vec3> | undefined, f: number): Record<string, Vec3> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, Vec3> = {};
  for (const name of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) out[name] = lerp3(a?.[name] ?? [1, 1, 1], b?.[name] ?? [1, 1, 1], f);
  return out;
}

const _pq = new Quaternion();
const _wq = new Quaternion();
const _lq = new Quaternion();
const _root = new Vector3();
const _target = new Vector3();
const _d = new Vector3();
const _pole = new Vector3();
const _pp = new Vector3();
const _u = new Vector3();
const _xt = new Vector3();
const _yt = new Vector3();
const _zt = new Vector3();
const _m = new Matrix4();
const _v = new Vector3();

/**
 * Poses a skeleton built from bone definitions and solves its limbs, so key
 * poses can say where a foot or hand is instead of how every joint bends.
 * The results are plain rotations again: the clips it makes are ordinary
 * key-pose clips.
 */
export class ClipKit {
  readonly root: string;
  readonly rootRest: Vec3;
  /** Height and width relative to the standard humanoid: sizes in the builders are scaled by them. */
  readonly k: number;
  readonly w: number;
  /** The rest feet (humanoids): how far out, and the ankle's height. */
  readonly footX: number = 0;
  readonly ankleY: number = 0;
  private readonly top = new Object3D();
  private readonly bones = new Map<string, Object3D>();
  private readonly rest = new Map<string, Vector3>();

  constructor(
    defs: BoneDef[],
    private readonly limbs: Readonly<Record<string, Limb>>,
    private readonly sole: Sole | null,
    scale: { k: number; w: number },
  ) {
    for (const [name, parent, offset] of defs) {
      const b = new Object3D();
      b.name = name;
      b.position.set(...offset);
      (parent ? this.bone(parent) : this.top).add(b);
      this.bones.set(name, b);
      this.rest.set(name, new Vector3(...offset));
    }
    const first = defs[0];
    if (!first) throw new Error("a skeleton needs bones");
    this.root = first[0];
    this.rootRest = [...first[2]];
    this.k = scale.k;
    this.w = scale.w;
    if (this.bones.has("foot.L")) {
      this.apply({});
      const f = this.world("foot.L");
      this.footX = f.x;
      this.ankleY = f.y;
    }
  }

  /** Standard-body metres, scaled to this one. */
  m(x: number, y: number, z: number): Vec3 {
    return [x * this.w, y * this.k, z * this.k];
  }

  /** A foot on the ground near its rest place: `dz` forward, `dx` out, `dy` up (metres), turned by `turn`. */
  foot(side: "L" | "R", dz = 0, dx = 0, dy = 0, turn?: Vec3): Reach {
    const sign = side === "L" ? 1 : -1;
    const t: Vec3 = turn ?? [0, sign * 6, 0];
    return { at: [sign * (this.footX + dx * this.w), this.clearance(t[0]) + dy * this.k, dz * this.k], turn: t };
  }

  /** A hand at a place: `x` metres out from the middle, `y` up, `z` forward. */
  hand(side: "L" | "R", x: number, y: number, z: number, pole?: Vec3, turn?: Vec3): Reach {
    const sign = side === "L" ? 1 : -1;
    const r: Reach = { at: [sign * x * this.w, y * this.k, z * this.k] };
    if (pole) r.pole = [pole[0] * sign, pole[1], pole[2]];
    if (turn) r.turn = turn;
    return r;
  }

  /** Every bone of the skeleton, the pose's rotation or rest. */
  full(p: Pose): Pose {
    const out: Pose = {};
    for (const name of this.bones.keys()) out[name] = p[name] ?? [0, 0, 0];
    return out;
  }

  /** Where a bone's joint is in a pose, in the rest frame. */
  joint(p: Pose, hips: Vec3 | undefined, name: string): Vector3 {
    this.apply(p, hips);
    return this.world(name).clone();
  }

  /** Where a limb's end touches down in the rest pose. */
  restTip(limb: string): Vector3 {
    this.apply({});
    return this.tipOf(limb).clone();
  }

  /** How high the ankle must be for a foot pitched `pitch` degrees (toe down) to keep its sole out of the ground. */
  clearance(pitch: number): number {
    if (!this.sole) return this.ankleY;
    const a = pitch * DEG;
    const toe = -this.ankleY * Math.cos(a) - this.sole.toe * this.k * Math.sin(a);
    const heel = -this.ankleY * Math.cos(a) + this.sole.heel * this.k * Math.sin(a);
    return -Math.min(toe, heel);
  }

  clip(name: string, keys: Key[], smooth = true): AnimationClip {
    return makeClip(name, this.refine(keys), this.root, this.rootRest, smooth);
  }

  /**
   * The keys resolved, with more put in wherever two neighbours both place a
   * limb and are further apart than `step` seconds. Joint angles blended
   * between two solved keys do not keep a foot on the ground (the leg is
   * longer halfway through a crouch than the blend of its ends), so the
   * in-between keys are solved again, their targets blended instead.
   */
  private refine(keys: Key[], step = 0.05): Key[] {
    const out: Key[] = [];
    let prev: { key: Key; solved: Key } | null = null;
    for (const key of keys) {
      const solved = this.resolve(key);
      if (prev) {
        const shared = Object.keys(key.reach ?? {}).filter((l) => prev?.key.reach?.[l]);
        const n = shared.length ? Math.floor((key.t - prev.key.t) / step - 1e-6) : 0;
        for (let i = 1; i <= n; i++) {
          const f = i / (n + 1);
          const reach: Record<string, Reach> = {};
          for (const l of shared) reach[l] = blendReach(prev.key.reach?.[l] as Reach, key.reach?.[l] as Reach, f);
          const between: Key = { t: prev.key.t + (key.t - prev.key.t) * f, pose: blendPose(prev.solved.pose, solved.pose, f), hips: lerp3(prev.solved.hips, solved.hips, f), reach };
          const scale = blendScale(prev.key.scale, key.scale, f);
          if (scale) between.scale = scale;
          const level = key.level ?? prev.key.level;
          if (level) between.level = level;
          out.push(this.resolve(between));
        }
      }
      out.push(solved);
      prev = { key, solved };
    }
    return out;
  }

  /**
   * A walking or running loop. Each planted foot slides back at `speed`, and
   * the hips ride as high as the gait allows but never higher than the
   * planted legs reach: the natural rise and fall of a stride comes out of
   * that on its own.
   */
  gait(g: Gait): AnimationClip {
    const keys: Key[] = [];
    for (let i = 0; i <= g.keys; i++) keys.push(this.gaitKey(g, i / g.keys));
    // Dense keys: linear hips, so a planted foot stays down between them.
    return this.clip(g.name, keys, false);
  }

  /** One key of a gait, at `p` through the cycle (for clips that begin or end in stride). */
  gaitKey(g: Gait, p: number): Key {
    const body = g.body(p);
    const off = body.hips ?? [0, 0, 0];
    const pz = this.full(body.pose);
    this.apply(pz, [off[0], 0, off[2]]);
    const rootY = this.world(this.root).y;
    let y = off[1] - g.crouch * this.k;
    const reach: Record<string, Reach> = {};
    for (const side of ["L", "R"] as const) {
      const f = this.footStep(g[side], side, p, g);
      reach[`foot.${side}`] = f.reach;
      if (!f.planted) continue;
      const joint = this.world(`thigh.${side}`);
      const len = (this.len(`shin.${side}`) + this.len(`foot.${side}`)) * (g.reach ?? 0.993);
      const dx = joint.x - f.reach.at[0];
      const dz = joint.z - f.reach.at[2];
      const up = Math.sqrt(Math.max(0, len * len - dx * dx - dz * dz));
      y = Math.min(y, f.reach.at[1] + up - (joint.y - rootY) - this.rootRest[1]);
    }
    const key: Key = { t: p * g.period, pose: pz, hips: [off[0], y, off[2]], reach: { ...reach, ...body.reach } };
    if (body.level) key.level = body.level;
    return key;
  }

  private footStep(s: Step, side: "L" | "R", p: number, g: Gait): { reach: Reach; planted: boolean } {
    const sign = side === "L" ? 1 : -1;
    const st = stride(s, p, g.speed, g.period);
    const z = (s.z ?? 0) * this.k + st.z;
    let x = sign * (this.footX + (s.out ?? 0) * this.w);
    const yaw = sign * (s.toeOut ?? 5);
    if (st.planted) return { planted: true, reach: { at: [x, this.ankleY, z], turn: [0, yaw, 0] } };
    x += sign * (s.circle ?? 0) * this.w * st.arc;
    let pitch: number;
    let y: number;
    if (s.drag) {
      // The toe scrapes along the ground: pointed at once, flat again only as it lands.
      pitch = (s.toeOff ?? 50) * Math.pow(st.arc, 0.4);
      y = this.clearance(pitch) + 0.004 * this.k;
    } else {
      const u = st.u;
      pitch = (s.toeOff ?? 25) * st.arc * (1 - u) * (1 - u) * 2.3 - (s.heel ?? 10) * st.arc * u * u * 2.3;
      y = this.clearance(pitch) + s.lift * this.k * Math.pow(st.arc, s.snap ?? 1);
    }
    const reach: Reach = { at: [x, y, z], turn: [pitch, yaw, 0] };
    if (s.stiff) reach.stiff = 0.985;
    return { planted: false, reach };
  }

  private bone(name: string): Object3D {
    const b = this.bones.get(name);
    if (!b) throw new Error(`no bone ${name}`);
    return b;
  }

  private len(name: string): number {
    return (this.rest.get(name) as Vector3).length();
  }

  private world(name: string): Vector3 {
    return this.bone(name).getWorldPosition(_v);
  }

  private tipOf(limbName: string): Vector3 {
    const limb = this.limbs[limbName];
    if (!limb) throw new Error(`no limb ${limbName}`);
    if (limb.end) return this.world(limb.end);
    return this.bone(limb.lower).localToWorld(_v.set(0, -limb.tip, 0));
  }

  /** Every bone at rest, then the pose's rotations, the root's offset and any scale. */
  private apply(p: Pose, hips?: Vec3, scale?: Record<string, Vec3>): void {
    for (const [name, b] of this.bones) {
      b.position.copy(this.rest.get(name) as Vector3);
      const r = p[name];
      if (r) quatOf(r, b.quaternion);
      else b.quaternion.identity();
      const s = scale?.[name];
      if (s) b.scale.set(...s);
      else b.scale.set(1, 1, 1);
    }
    if (hips) this.bone(this.root).position.add(_v.set(...hips));
    this.top.updateMatrixWorld(true);
  }

  /** A key with its reaches and levels turned into rotations. */
  private resolve(key: Key): Key {
    const p = this.full(key.pose);
    const out: Key = { t: key.t, pose: p, hips: key.hips ?? [0, 0, 0] };
    if (key.scale) out.scale = key.scale;
    if (!key.reach && !key.level) return out;
    this.apply(p, key.hips, key.scale);
    for (const [limb, r] of Object.entries(key.reach ?? {})) this.solve(p, limb, r);
    for (const [name, rot] of Object.entries(key.level ?? {})) {
      const b = this.bone(name);
      (b.parent as Object3D).getWorldQuaternion(_pq);
      b.quaternion.copy(_pq.invert().multiply(quatOf(rot, _wq)));
      p[name] = degOf(b.quaternion);
      b.updateMatrixWorld(true);
    }
    return out;
  }

  /**
   * Two-bone IK: the upper bone turned so the limb reaches `r.at` with its
   * joint toward the pole, the lower bent about its own X by what the
   * triangle of the two lengths asks; the end then turned to `r.turn` in the
   * world. Out of reach, the limb points straight at the target.
   */
  private solve(p: Pose, limbName: string, r: Reach): void {
    const limb = this.limbs[limbName];
    if (!limb) throw new Error(`no limb ${limbName}`);
    const upper = this.bone(limb.upper);
    const lower = this.bone(limb.lower);
    (upper.parent as Object3D).getWorldQuaternion(_pq);
    upper.getWorldPosition(_root);
    const l1 = lower.position.length();
    const l2 = limb.end ? this.bone(limb.end).position.length() : limb.tip;
    _target.set(...r.at);
    _d.subVectors(_target, _root);
    if (r.stiff) {
      // Too close for a stiff knee: swing the foot out sideways until it is not.
      const want = r.stiff * (l1 + l2);
      const side = Math.sign(_root.x) || 1;
      const rest = want * want - _d.y * _d.y - _d.z * _d.z;
      if (_d.length() < want && rest > 0) {
        const dx = side * Math.sqrt(rest);
        if (Math.abs(dx) > Math.abs(_d.x)) _d.x = dx;
      }
    }
    const dist = clamp(_d.length(), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9999);
    const dn = _d.normalize();
    if (r.pole) _pole.set(...r.pole);
    else _pole.set(...limb.pole).applyQuaternion(_pq);
    _pp.copy(_pole).addScaledVector(dn, -_pole.dot(dn));
    if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, 1).addScaledVector(dn, -dn.z);
    _pp.normalize();
    const a1 = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
    const kb = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
    _u.copy(dn).multiplyScalar(Math.cos(a1)).addScaledVector(_pp, Math.sin(a1));
    _zt.copy(_pp).multiplyScalar(Math.cos(a1)).addScaledVector(dn, -Math.sin(a1)).multiplyScalar(limb.bend);
    _yt.copy(_u).negate();
    _xt.crossVectors(_yt, _zt);
    _wq.setFromRotationMatrix(_m.makeBasis(_xt, _yt, _zt));
    upper.quaternion.copy(_pq.invert().multiply(_wq));
    lower.quaternion.setFromAxisAngle(X_AXIS, limb.bend * kb);
    upper.updateMatrixWorld(true);
    p[limb.upper] = degOf(upper.quaternion);
    p[limb.lower] = [(limb.bend * kb) / DEG, 0, 0];
    if (limb.end && r.turn) {
      const end = this.bone(limb.end);
      lower.getWorldQuaternion(_lq);
      end.quaternion.copy(_lq.invert().multiply(quatOf(r.turn, _wq)));
      p[limb.end] = degOf(end.quaternion);
      end.updateMatrixWorld(true);
    }
  }
}

export function humanoidKit(defs: BoneDef[] = HUMANOID): ClipKit {
  const hips = defs.find(([n]) => n === "hips")?.[2] ?? [0, 0.95, 0];
  const thigh = defs.find(([n]) => n === "thigh.L")?.[2] ?? [0.1, 0, 0];
  const limbs: Record<string, Limb> = {};
  for (const [side, sign] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    limbs[`foot.${side}`] = { upper: `thigh.${side}`, lower: `shin.${side}`, end: `foot.${side}`, tip: 0, bend: 1, pole: [0.15 * sign, 0, 1] };
    limbs[`hand.${side}`] = { upper: `upper_arm.${side}`, lower: `forearm.${side}`, end: `hand.${side}`, tip: 0, bend: -1, pole: [0.5 * sign, -0.3, -1] };
  }
  return new ClipKit(defs, limbs, { toe: 0.17, heel: 0.07 }, { k: hips[1] / 0.95, w: thigh[0] / 0.1 });
}

export function catKit(): ClipKit {
  const limbs: Record<string, Limb> = {};
  // Front legs fold like a wrist (the joint forward), back legs like a hock (back).
  for (const leg of ["FL", "FR"]) limbs[`paw.${leg}`] = { upper: `leg.${leg}`, lower: `paw.${leg}`, end: null, tip: CAT_PAW_TIP, bend: 1, pole: [0, 0, 1] };
  for (const leg of ["BL", "BR"]) limbs[`paw.${leg}`] = { upper: `leg.${leg}`, lower: `paw.${leg}`, end: null, tip: CAT_PAW_TIP, bend: -1, pole: [0, 0, -1] };
  return new ClipKit(CAT, limbs, null, { k: 1, w: 1 });
}

// --- the dead ---------------------------------------------------------------------

/** How far the torso leans in SLUMP (hips + spine + chest): arm angles below are relative to it. */
const SLUMP: Pose = {
  hips: [5, 0, 0],
  spine: [10, 2, -2],
  chest: [8, 4, 1],
  neck: [12, 0, 0],
  head: [-16, 6, 14],
  "shoulder.L": [0, 0, -3],
  "shoulder.R": [0, 0, 7],
  "upper_arm.L": [-27, 0, 8],
  "forearm.L": [-16, 0, 0],
  "hand.L": [12, 0, 0],
  "upper_arm.R": [-22, 0, -5],
  "forearm.R": [-24, 0, 0],
  "hand.R": [16, 0, 0],
};

/** Face down on the road, the chest propped up, looking ahead: the crawler. */
const PRONE: Pose = {
  hips: [86, 0, 0],
  spine: [-6, 0, 0],
  chest: [-10, 0, 0],
  neck: [-26, 0, 0],
  head: [-32, 0, 0],
  "thigh.L": [-4, 0, 10],
  "thigh.R": [-4, 0, -8],
  "shin.L": [10, 0, 0],
  "shin.R": [14, 0, 0],
};

/**
 * The dead's clips for a humanoid kit (the walker's bodies or the Mechanic's):
 * the contract's clips plus the crawler's low variants (`idle.low`,
 * `claw.low`, `hit_head.low`, `death.low`).
 */
export function deadClips(kit: ClipKit): AnimationClip[] {
  const out: AnimationClip[] = [];
  const m = (x: number, y: number, z: number) => kit.m(x, y, z);
  const feet = (l: Reach, r: Reach): Record<string, Reach> => ({ "foot.L": l, "foot.R": r });
  const planted = feet(kit.foot("L", 0.03, 0.02), kit.foot("R", -0.06, 0.03));
  const HIPS = m(0, -0.03, -0.02);
  /** A key with the feet planted where the dead stand, unless `reach` says otherwise (null: nothing placed). */
  const key = (t: number, p: Pose, hips: Vec3 = HIPS, reach: Record<string, Reach> | null = planted): Key => {
    const k: Key = { t, pose: p, hips };
    if (reach) k.reach = reach;
    return k;
  };

  out.push(
    kit.clip("idle", [
      key(0, SLUMP),
      key(0.8, pose(SLUMP, { spine: [11, -2, 1], chest: [9, -3, 2], head: [-12, -8, -6], "upper_arm.L": [-24, 0, 7], "upper_arm.R": [-26, 0, -7] }), m(0.012, -0.035, -0.02)),
      key(1.6, pose(SLUMP, { spine: [13, 1, -1], chest: [10, 2, 0], neck: [16, 0, 0], head: [-6, 3, 18] }), m(-0.006, -0.04, -0.015)),
      key(2.5, SLUMP),
    ]),
  );

  // --- the four walks: each its own unmistakable rhythm ---

  // Shambling: hunched, head lolling, arms swinging dead from the shoulders, feet scuffing.
  out.push(
    kit.gait({
      name: "walk.shamble",
      speed: GAIT_SPEEDS["walk.shamble"],
      period: 1.3,
      keys: 26,
      crouch: 0.05,
      L: { land: 0, stance: 0.6, lift: 0.035, out: 0.03, toeOut: 10, toeOff: 18 },
      R: { land: 0.5, stance: 0.6, lift: 0.05, out: 0.02, toeOut: 5, toeOff: 18 },
      body: (p) => {
        const sway = cyc(p, 0.3);
        const twist = sin(p);
        const arms = cyc(p, 0.08);
        const nod = cyc2(p, 0.3);
        return {
          hips: m(0.03 * sway, 0.012 * nod, 0),
          pose: {
            hips: [6, -5 * twist, 4 * sway],
            spine: [11, 3 * twist, -2 - 3 * sway],
            chest: [9, 3 * twist, -1.5 * sway],
            neck: [11, 0, 0],
            head: [-16 + 5 * nod, 8 * sin(p, 0.2), 14 + 6 * sin(p, -0.1)],
            "shoulder.L": [0, 0, -3],
            "shoulder.R": [0, 0, 8],
            "upper_arm.L": [-28 + 13 * arms, 0, 8 + 2 * sway],
            "forearm.L": [-16 - 6 * arms, 0, 0],
            "hand.L": [12, 0, 0],
            "upper_arm.R": [-24 - 13 * arms, 0, -6 + 2 * sway],
            "forearm.R": [-24 + 6 * arms, 0, 0],
            "hand.R": [16, 0, 0],
          },
        };
      },
    }),
  );

  // Limping: the right knee will not bend. The leg swings out round it, the
  // hip hitches to clear it, and the whole body lurches over it for the short
  // moment it bears weight: da-DUM, da-DUM.
  out.push(
    kit.gait({
      name: "walk.limp",
      speed: GAIT_SPEEDS["walk.limp"],
      period: 1.3,
      keys: 26,
      crouch: 0.02,
      L: { land: 0, stance: 0.66, lift: 0.06, out: 0.01 },
      R: { land: 0.56, stance: 0.52, lift: 0.015, stiff: true, circle: 0.07, toeOut: 14, toeOff: 8, heel: 2 },
      body: (p) => {
        const hike = bump(p, 0.32, 0.5);
        const onStiff = bump(p, 0.82, 0.5);
        const onGood = bump(p, 0.33, 0.6);
        const arms = cyc(p, 0.05);
        return {
          hips: m(0.045 * (onGood - onStiff), 0, 0),
          pose: {
            hips: [5, 6 * sin(p, 0.2), -7 * hike],
            spine: [10, -4 * sin(p, 0.2), 9 * onStiff - 5 * hike],
            chest: [8, -3 * sin(p, 0.2), 4 * onStiff],
            neck: [10, 0, 0],
            head: [-14 + 7 * onStiff, 6 * sin(p), 10 - 9 * onStiff + 6 * hike],
            "shoulder.R": [0, 0, 4],
            "upper_arm.L": [-26 + 14 * arms, 0, 10 + 12 * onStiff],
            "forearm.L": [-22 - 6 * arms, 0, 0],
            "hand.L": [12, 0, 0],
            "upper_arm.R": [-20, 0, -14 - 6 * hike],
            "forearm.R": [-8, 0, 0],
            "hand.R": [22, 0, 0],
          },
        };
      },
    }),
  );

  // Dragging: the right foot is dead weight, pointed, its toe scraping along
  // behind; the good leg hauls, the body heaving over it, the right arm hanging.
  out.push(
    kit.gait({
      name: "walk.drag",
      speed: GAIT_SPEEDS["walk.drag"],
      period: 1.5,
      keys: 30,
      crouch: 0.06,
      L: { land: 0, stance: 0.64, lift: 0.07, z: 0.08, out: 0.02 },
      R: { land: 0.6, stance: 0.46, lift: 0, drag: true, z: -0.2, out: 0.04, toeOut: 22, toeOff: 55 },
      body: (p) => {
        const heave = bump(p, 0.3, 0.6);
        const settle = bump(p, 0.83, 0.45);
        return {
          hips: m(0.04 * heave - 0.025 * settle, 0.01 * heave, 0),
          pose: {
            hips: [8, 8 * sin(p, 0.3), 3 * heave],
            spine: [12, -4 * sin(p, 0.3), -8 - 4 * heave],
            chest: [10, -3 * sin(p, 0.3), -4],
            neck: [12, 0, 0],
            head: [-10 + 8 * heave, -6, 20 - 4 * heave],
            "shoulder.R": [0, 0, 12],
            "upper_arm.L": [-45 + 10 * cyc(p, 0.05), -6, 14],
            "forearm.L": [-32, 0, 0],
            "hand.L": [22, 0, 0],
            "upper_arm.R": [-26 + 3 * heave, 0, -3],
            "forearm.R": [-6, 0, 0],
            "hand.R": [8, 0, 0],
          },
        };
      },
    }),
  );

  // Lurching: the arms up and reaching, the body thrown from side to side
  // over each foot, the head rolling with it.
  out.push(
    kit.gait({
      name: "walk.lurch",
      speed: GAIT_SPEEDS["walk.lurch"],
      period: 1.2,
      keys: 24,
      crouch: 0.05,
      L: { land: 0, stance: 0.6, lift: 0.06, out: 0.05, toeOut: 8 },
      R: { land: 0.5, stance: 0.6, lift: 0.07, out: 0.05, toeOut: 8 },
      body: (p) => {
        const sway = cyc(p, 0.3);
        const arms = cyc(p, 0.05);
        return {
          hips: m(0.075 * sway, 0.012 * cyc2(p, 0.3), 0),
          pose: {
            hips: [4, -8 * sin(p), 8 * sway],
            spine: [6, 5 * sin(p), -12 * sway],
            chest: [6, 4 * sin(p), -6 * sway],
            neck: [4, 0, 0],
            head: [-12, -6 * sin(p), 4 + 12 * sway],
            "upper_arm.L": [-96 + 8 * arms, -12, 14 + 4 * sway],
            "forearm.L": [-18 - 6 * sway, 0, 0],
            "hand.L": [28, 0, 0],
            "upper_arm.R": [-90 - 8 * arms, 12, -16 + 4 * sway],
            "forearm.R": [-24, 0, 0],
            "hand.R": [22, 0, 0],
          },
        };
      },
    }),
  );

  // The runner's sprint: pitched forward, lurching, arms flailing out of step with each other.
  out.push(
    kit.gait({
      name: "run",
      speed: GAIT_SPEEDS.run,
      period: 0.62,
      keys: 20,
      crouch: 0.1,
      L: { land: 0, stance: 0.34, lift: 0.2, z: -0.05, toeOut: 6, toeOff: 35, heel: 10, snap: 0.7 },
      R: { land: 0.5, stance: 0.34, lift: 0.22, z: -0.05, out: 0.01, toeOut: 10, toeOff: 35, heel: 10, snap: 0.7 },
      body: (p) => ({
        hips: m(0.02 * cyc(p, 0.17), 0.04 * cyc2(p, 0.42), 0),
        pose: {
          hips: [10, -9 * cyc(p), 5 * cyc(p, 0.17)],
          spine: [14, 6 * cyc(p), -4 * cyc(p, 0.17)],
          chest: [6, 6 * cyc(p), 0],
          neck: [4 + 6 * cyc2(p, 0.1), 0, 0],
          head: [-22, 10 * sin(p), 8 * sin(p, -0.3)],
          "upper_arm.L": [-35 + 45 * cyc(p, 0.05), 0, 30 + 18 * Math.sin(2 * TAU * p)],
          "forearm.L": [-55 + 25 * cyc(p, 0.3), 0, 0],
          "hand.L": [20, 0, 0],
          "upper_arm.R": [-50 - 40 * cyc(p, 0.1), 0, -38 - 14 * Math.sin(2 * TAU * (p + 0.15))],
          "forearm.R": [-40 - 30 * cyc(p, 0.6), 0, 0],
          "hand.R": [30, 0, 0],
        },
      }),
    }),
  );

  // The lunge: gather, spring, and land in a long reaching stride, the hips
  // ending about 0.34 m forward (the game moves the root on when it switches).
  const gather = pose(SLUMP, {
    hips: [14, 0, 0],
    spine: [18, 0, 0],
    chest: [8, 0, 0],
    neck: [0, 0, 0],
    head: [-24, 0, 0],
    "upper_arm.L": [0, 0, 20],
    "upper_arm.R": [5, 0, -20],
    "forearm.L": [-40, 0, 0],
    "forearm.R": [-45, 0, 0],
  });
  out.push(
    kit.clip("lunge", [
      key(0, gather, m(0, -0.12, -0.04), feet(kit.foot("L", 0.12), kit.foot("R", -0.22))),
      key(
        0.15,
        pose(gather, { hips: [18, 0, 0], spine: [12, 0, 0], "upper_arm.L": [-70, 0, 25], "upper_arm.R": [-60, 0, -25], "forearm.L": [-30, 0, 0], "forearm.R": [-30, 0, 0] }),
        m(0, 0.0, 0.14),
        feet(kit.foot("L", 0.4, 0, 0.18), kit.foot("R", -0.24, 0, 0, [30, -6, 0])),
      ),
      key(
        0.3,
        pose(gather, { hips: [16, 0, 0], spine: [14, 0, 0], chest: [4, 0, 0], head: [-28, 0, 0], "upper_arm.L": [-120, -10, 35], "upper_arm.R": [-115, 10, -35], "forearm.L": [-15, 0, 0], "forearm.R": [-15, 0, 0], "hand.L": [30, 0, 0], "hand.R": [30, 0, 0] }),
        m(0, 0.04, 0.3),
        feet(kit.foot("L", 0.62, 0, 0.12), kit.foot("R", -0.05, 0, 0.2, [40, -6, 0])),
      ),
      key(
        0.5,
        pose(gather, { hips: [12, 0, 0], spine: [14, 0, 0], chest: [6, 0, 0], head: [-30, 0, 0], "upper_arm.L": [-122, -14, 30], "upper_arm.R": [-118, 14, -30], "forearm.L": [-12, 0, 0], "forearm.R": [-16, 0, 0], "hand.L": [35, 0, 0], "hand.R": [35, 0, 0] }),
        m(0, -0.14, 0.34),
        feet(kit.foot("L", 0.66), kit.foot("R", 0.0, 0, 0, [25, -8, 0])),
      ),
    ]),
  );

  // Clawing over waist-high sandbags: wind up high, rake down and forward
  // (the stroke's peak at 0.7 s, when the game lands the damage), drag back.
  const elbowsOut: Vec3 = [1, -0.6, -0.2];
  const claw = (t: number, lean: Pose, hips: Vec3, l: Vec3, r: Vec3): Key => ({
    t,
    pose: pose(SLUMP, { hips: [8, 0, 0], spine: [16, 0, 0], chest: [10, 0, 0], neck: [2, 0, 0], head: [-26, 0, 4], "hand.L": [30, 0, 0], "hand.R": [34, 0, 0] }, lean),
    hips,
    reach: { ...feet(kit.foot("L", 0.06, 0.02), kit.foot("R", -0.2, 0.03)), "hand.L": kit.hand("L", ...l, elbowsOut), "hand.R": kit.hand("R", ...r, elbowsOut) },
  });
  const clawStart = claw(0, { spine: [14, 0, 0] }, m(0, -0.04, 0.02), [0.22, 1.5, 0.5], [0.2, 1.46, 0.48]);
  out.push(
    kit.clip("claw", [
      clawStart,
      claw(0.35, { spine: [10, 0, 0], chest: [4, 0, 0], head: [-20, 0, 4] }, m(0, -0.02, -0.01), [0.24, 1.64, 0.42], [0.22, 1.6, 0.4]),
      claw(0.7, { hips: [10, 0, 0], spine: [26, 0, 0], chest: [16, 0, 0], neck: [6, 0, 0], head: [-34, 0, 2] }, m(0, -0.08, 0.1), [0.17, 1.02, 0.8], [0.15, 1.08, 0.78]),
      claw(1.0, { spine: [22, 0, 0], chest: [12, 0, 0] }, m(0, -0.06, 0.06), [0.22, 1.1, 0.5], [0.2, 1.12, 0.52]),
      { ...clawStart, t: 1.4 },
    ]),
  );

  // A body shot: rocked back, half a step back with the right foot, and the
  // lean forward again, the foot brought back under it.
  out.push(
    kit.clip("stagger", [
      key(0, SLUMP),
      key(
        0.08,
        pose(SLUMP, { hips: [-4, 0, 0], spine: [-8, 0, 3], chest: [-10, 6, 0], neck: [18, 0, 0], head: [4, -6, -6], "upper_arm.L": [-50, 0, 30], "upper_arm.R": [-45, 0, -34], "forearm.L": [-35, 0, 0], "forearm.R": [-30, 0, 0] }),
        m(0, -0.02, -0.07),
      ),
      key(
        0.2,
        pose(SLUMP, { hips: [0, 0, 0], spine: [-2, 0, 0], chest: [-4, 0, 0], neck: [14, 0, 0], head: [-8, -4, 4], "upper_arm.L": [-30, 0, 20], "upper_arm.R": [-26, 0, -24] }),
        m(0.02, -0.02, -0.13),
        feet(kit.foot("L", 0.03, 0.02), kit.foot("R", -0.2, 0.03, 0.07)),
      ),
      key(0.3, pose(SLUMP, { spine: [4, 0, 0], chest: [2, 0, 0] }), m(0, -0.06, -0.17), feet(kit.foot("L", 0.03, 0.02), kit.foot("R", -0.32, 0.03))),
      key(0.42, pose(SLUMP, { spine: [16, 0, 0], chest: [10, 0, 0], head: [-18, 6, 14] }), m(0, -0.05, -0.1), feet(kit.foot("L", 0.03, 0.02), kit.foot("R", -0.2, 0.03, 0.05))),
      key(0.55, SLUMP),
    ]),
  );

  out.push(
    kit.clip("hit_head", [
      key(0, SLUMP),
      key(0.06, pose(SLUMP, { chest: [0, 6, 0], neck: [-22, 0, 0], head: [-46, -14, -10], "upper_arm.L": [-40, 0, 18], "upper_arm.R": [-34, 0, -18] }), m(0, -0.03, -0.04)),
      key(0.18, pose(SLUMP, { chest: [4, 4, 0], neck: [-8, 0, 0], head: [-30, -8, -4] }), m(0, -0.035, -0.035)),
      key(0.4, SLUMP),
    ]),
  );

  // --- deaths: every one is on the ground by 0.8 s, then settles ---

  const flungBack: Pose = { "upper_arm.L": [-10, 0, 72], "upper_arm.R": [-5, 0, -76], "forearm.L": [-25, 0, 0], "forearm.R": [-15, 0, 0] };
  out.push(
    kit.clip("death_back", [
      key(0, SLUMP),
      key(
        0.12,
        pose(SLUMP, { hips: [-6, 0, 0], spine: [-12, 0, 4], chest: [-14, 10, 4], neck: [-6, 0, 0], head: [-24, 0, 0], "upper_arm.L": [-70, 0, 40], "upper_arm.R": [-60, 0, -45], "forearm.L": [-30, 0, 0], "forearm.R": [-40, 0, 0] }),
        m(0, -0.04, -0.1),
      ),
      key(
        0.4,
        { hips: [-35, 0, 4], spine: [-6, 0, 0], chest: [-8, 8, 0], neck: [-4, 0, 0], head: [-20, 10, 0], "upper_arm.L": [-80, 0, 60], "upper_arm.R": [-70, 0, -65], "forearm.L": [-25, 0, 0], "forearm.R": [-25, 0, 0] },
        m(0, -0.34, -0.3),
        feet(kit.foot("L", 0.05, 0.02), kit.foot("R", -0.02, 0.03)),
      ),
      key(
        0.62,
        pose(flungBack, { hips: [-72, 0, 6], spine: [-4, 0, 0], chest: [-2, 0, 0], head: [-10, 20, 0], "upper_arm.L": [-40, 0, 70], "upper_arm.R": [-30, 0, -70] }),
        m(0, -0.7, -0.5),
        // The heels skid forward along the road as it goes down.
        feet(kit.foot("L", 0.22, 0.02, 0, [-30, 6, 0]), kit.foot("R", 0.15, 0.03, 0, [-30, -6, 0])),
      ),
      key(
        0.8,
        pose(flungBack, { hips: [-90, 0, 4], spine: [2, 0, 0], chest: [2, 0, 0], neck: [4, 0, 0], head: [-6, 25, 0], "thigh.L": [-25, 0, 10], "shin.L": [40, 0, 0], "thigh.R": [-14, 0, -10], "shin.R": [26, 0, 0], "foot.L": [20, 0, 0], "foot.R": [20, 0, 0] }),
        m(0, -0.85, -0.58),
        null,
      ),
      key(
        0.95,
        pose(flungBack, { hips: [-90, 0, 4], spine: [1, 0, 0], head: [0, 32, 0], "thigh.L": [-12, 0, 11], "shin.L": [20, 0, 0], "thigh.R": [-18, 0, -10], "shin.R": [30, 0, 0], "foot.L": [30, 0, 0], "foot.R": [25, 0, 0] }),
        m(0, -0.83, -0.59),
        null,
      ),
      key(
        1.2,
        pose(flungBack, { hips: [-90, 0, 4], head: [2, 38, 0], "thigh.L": [-6, 0, 12], "shin.L": [10, 0, 0], "thigh.R": [-20, 0, -10], "shin.R": [36, 0, 0], "foot.L": [35, 0, 0], "foot.R": [28, 0, 0], "forearm.L": [-18, 0, 0], "forearm.R": [-10, 0, 0] }),
        m(0, -0.86, -0.6),
        null,
      ),
    ]),
  );

  const faceDown: Pose = { "upper_arm.L": [-176, 0, 35], "upper_arm.R": [-172, 0, -40], "forearm.L": [-30, 0, 0], "forearm.R": [-55, 0, 0] };
  out.push(
    kit.clip("death_forward", [
      key(0, SLUMP),
      key(0.12, pose(SLUMP, { hips: [8, 0, 0], spine: [22, 0, -4], chest: [14, -6, 0], neck: [18, 0, 0], head: [8, 0, 10], "upper_arm.L": [-8, 0, 14], "upper_arm.R": [-4, 0, -16] }), m(0, -0.05, 0.03)),
      key(
        0.3,
        { hips: [22, 0, -3], spine: [18, 0, 0], chest: [12, 0, 0], neck: [10, 0, 0], head: [0, 0, 8], "upper_arm.L": [-40, 0, 12], "upper_arm.R": [-36, 0, -12], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] },
        m(0, -0.3, 0.05),
      ),
      // Down on its knees, for a moment upright.
      key(
        0.48,
        { hips: [14, 0, -3], spine: [18, 0, 0], chest: [12, 0, 0], neck: [10, 0, 0], head: [0, 0, 8], "thigh.L": [-14, 0, 6], "shin.L": [100, 0, 0], "foot.L": [30, 0, 0], "thigh.R": [-10, 0, -6], "shin.R": [96, 0, 0], "foot.R": [30, 0, 0], "upper_arm.L": [-44, 0, 12], "upper_arm.R": [-40, 0, -12], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] },
        m(0, -0.42, 0.08),
        null,
      ),
      key(
        0.6,
        // Toppling off its knees: they stay on the road behind it, the hands go out to meet the ground.
        { hips: [58, 0, -4], spine: [8, 0, 0], chest: [4, 0, 0], neck: [-10, 0, 0], head: [-20, 0, 0], "thigh.L": [-16, 0, 6], "shin.L": [50, 0, 0], "foot.L": [30, 0, 0], "thigh.R": [-12, 0, -6], "shin.R": [46, 0, 0], "foot.R": [30, 0, 0], "upper_arm.L": [-130, 0, 30], "upper_arm.R": [-126, 0, -30], "forearm.L": [-20, 0, 0], "forearm.R": [-24, 0, 0] },
        m(0, -0.55, 0.3),
        null,
      ),
      key(
        0.8,
        pose(faceDown, { hips: [88, 0, -3], spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [-8, 0, 0], head: [-6, -40, 0], "thigh.L": [-6, 0, 8], "thigh.R": [-4, 0, -8], "shin.L": [14, 0, 0], "shin.R": [10, 0, 0], "foot.L": [40, 0, 0], "foot.R": [40, 0, 0] }),
        m(0, -0.85, 0.5),
        null,
      ),
      key(
        1.0,
        pose(faceDown, { hips: [88, 0, -3], neck: [-6, 0, 0], head: [-8, -44, 0], "thigh.L": [-6, 0, 9], "thigh.R": [-4, 0, -9], "shin.L": [18, 0, 0], "shin.R": [8, 0, 0], "foot.L": [45, 0, 0], "foot.R": [42, 0, 0] }),
        m(0, -0.84, 0.51),
        null,
      ),
      key(
        1.2,
        pose(faceDown, { hips: [89, 0, -3], neck: [-6, 0, 0], head: [-8, -46, 0], "thigh.L": [-6, 0, 10], "thigh.R": [-4, 0, -9], "shin.L": [20, 0, 0], "shin.R": [8, 0, 0], "foot.L": [48, 0, 0], "foot.R": [44, 0, 0] }),
        m(0, -0.86, 0.52),
        null,
      ),
    ]),
  );

  // Crumpling where it stands: the knees go, it kneels, and folds over onto its side.
  out.push(
    kit.clip("death_crumple", [
      key(0, SLUMP),
      key(0.2, pose(SLUMP, { hips: [10, 0, 3], spine: [14, 0, 0], chest: [12, 0, 0], neck: [16, 0, 0], head: [-4, 8, 16] }), m(0, -0.2, 0.0)),
      key(
        0.45,
        { hips: [8, 0, 4], spine: [22, 0, -4], chest: [16, 0, 0], neck: [20, 0, 0], head: [14, 10, 18], "thigh.L": [-14, 0, 6], "shin.L": [100, 0, 0], "foot.L": [30, 0, 0], "thigh.R": [-8, 0, -6], "shin.R": [96, 0, 0], "foot.R": [30, 0, 0], "upper_arm.L": [-40, 0, 6], "upper_arm.R": [-36, 0, -6], "forearm.L": [-10, 0, 0], "forearm.R": [-10, 0, 0] },
        m(0, -0.43, 0.06),
        null,
      ),
      // Toppling over its right knee, which stays where it is on the road:
      // the hips swing down round it and out to the right (−X).
      key(
        0.62,
        { hips: [12, 0, 40], spine: [20, 0, 10], chest: [12, 0, 6], neck: [10, 0, 0], head: [8, 10, 16], "thigh.L": [-16, 0, 6], "shin.L": [100, 0, 0], "foot.L": [30, 0, 0], "thigh.R": [-12, 0, -6], "shin.R": [96, 0, 0], "foot.R": [30, 0, 0], "upper_arm.L": [-50, 0, 10], "upper_arm.R": [-60, 0, -30], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] },
        m(-0.3, -0.47, 0.05),
        null,
      ),
      key(
        0.72,
        { hips: [8, 0, 64], spine: [16, 0, -4], chest: [10, 0, -3], neck: [8, 0, 4], head: [8, 4, 16], "thigh.L": [-24, 0, 5], "shin.L": [100, 0, 0], "foot.L": [28, 0, 0], "thigh.R": [-18, 0, -4], "shin.R": [96, 0, 0], "foot.R": [28, 0, 0], "upper_arm.L": [-48, 0, -2], "upper_arm.R": [-66, 0, -14], "forearm.L": [-22, 0, 0], "forearm.R": [-20, 0, 0] },
        m(-0.46, -0.6, 0.04),
        null,
      ),
      // On its right side, curled, knees drawn up.
      key(
        0.8,
        { hips: [6, 0, 88], spine: [12, 0, -8], chest: [8, 0, -6], neck: [6, 0, 8], head: [8, 0, 18], "thigh.L": [-35, 0, 4], "shin.L": [100, 0, 0], "foot.L": [25, 0, 0], "thigh.R": [-28, 0, -2], "shin.R": [92, 0, 0], "foot.R": [25, 0, 0], "upper_arm.L": [-45, 0, -12], "forearm.L": [-25, 0, 0], "upper_arm.R": [-70, 0, 20], "forearm.R": [-20, 0, 0] },
        m(-0.56, -0.76, 0.04),
        null,
      ),
      key(
        1.0,
        { hips: [6, 0, 90], spine: [13, 0, -8], chest: [8, 0, -6], neck: [6, 0, 10], head: [10, 0, 22], "thigh.L": [-36, 0, 3], "shin.L": [98, 0, 0], "foot.L": [28, 0, 0], "thigh.R": [-28, 0, -2], "shin.R": [90, 0, 0], "foot.R": [28, 0, 0], "upper_arm.L": [-42, 0, -14], "forearm.L": [-28, 0, 0], "upper_arm.R": [-72, 0, 22], "forearm.R": [-18, 0, 0] },
        m(-0.57, -0.77, 0.04),
        null,
      ),
    ]),
  );

  // Down out of the school bus: from its floor (0.9 m up) to the step (0.45 m)
  // to the road, holding the door's grab rails, ending on the root.
  const floor = 0.9;
  const climb = pose(SLUMP, { hips: [8, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0], neck: [10, 0, 0], head: [-4, 0, 8] });
  const rails: Vec3 = [1, -0.4, -0.3];
  out.push(
    kit.clip("climb_out", [
      {
        t: 0,
        pose: climb,
        hips: m(0, floor - 0.04, -0.55),
        reach: { ...feet(kit.foot("L", -0.52, 0.02, floor), kit.foot("R", -0.58, 0.03, floor)), "hand.L": kit.hand("L", 0.38, floor + 0.95, -0.38, rails), "hand.R": kit.hand("R", 0.38, floor + 0.9, -0.38, rails) },
      },
      {
        t: 0.35,
        pose: pose(climb, { spine: [24, 0, 0], head: [6, 0, 8] }),
        hips: m(0, 0.42, -0.42),
        reach: { ...feet(kit.foot("L", -0.52, 0.02, floor), kit.foot("R", -0.3, 0.03, 0.45)), "hand.L": kit.hand("L", 0.38, 1.72, -0.34, rails), "hand.R": kit.hand("R", 0.38, 1.68, -0.34, rails) },
      },
      {
        t: 0.65,
        pose: pose(climb, { spine: [22, 0, 0], head: [8, 0, 6] }),
        hips: m(0, 0.28, -0.3),
        reach: { ...feet(kit.foot("L", -0.2, 0.02, 0.3), kit.foot("R", -0.3, 0.03, 0.45)), "hand.L": kit.hand("L", 0.4, 1.58, -0.3, rails), "hand.R": kit.hand("R", 0.4, 1.55, -0.3, rails) },
      },
      {
        t: 0.9,
        pose: pose(climb, { spine: [16, 0, 0], "upper_arm.L": [-50, 0, 20], "upper_arm.R": [-40, 0, -24] }),
        hips: m(0, -0.04, -0.12),
        reach: feet(kit.foot("L", 0.02, 0.02), kit.foot("R", -0.3, 0.03, 0.45)),
      },
      key(1.2, pose(SLUMP, { spine: [14, 0, 0] }), m(0, -0.02, -0.06), feet(kit.foot("L", 0.03, 0.02), kit.foot("R", -0.12, 0.03, 0.18))),
      key(1.4, SLUMP, m(0, -0.04, -0.03), feet(kit.foot("L", 0.03, 0.02), kit.foot("R", -0.06, 0.03))),
      key(1.6, SLUMP),
    ]),
  );

  // Over a waist-high rail (1 m, 0.3 m ahead): hands on it, a spring, the legs
  // swung over to one side, landing about 0.7 m on (the game moves the root on).
  const rail = (side: "L" | "R", x: number, z: number) => kit.hand(side, x, 1.02, z, [1, 0.3, -0.4]);
  out.push(
    kit.clip("vault", [
      { t: 0, pose: pose(SLUMP, { spine: [18, 0, 0], chest: [10, 0, 0], head: [-22, 0, 4] }), hips: m(0, -0.03, 0), reach: { ...planted, "hand.L": rail("L", 0.2, 0.32), "hand.R": rail("R", 0.22, 0.3) } },
      { t: 0.2, pose: pose(SLUMP, { spine: [26, 0, 0], chest: [12, 0, 0], head: [-26, 0, 0] }), hips: m(0, -0.14, 0.02), reach: { ...planted, "hand.L": rail("L", 0.2, 0.32), "hand.R": rail("R", 0.22, 0.3) } },
      {
        t: 0.42,
        pose: { hips: [30, -25, 30], spine: [18, 0, -10], chest: [10, 0, -8], neck: [0, 0, 0], head: [-26, 10, 0], "thigh.L": [-95, 0, 20], "shin.L": [110, 0, 0], "thigh.R": [-90, 0, 10], "shin.R": [115, 0, 0], "foot.L": [20, 0, 0], "foot.R": [20, 0, 0] },
        hips: m(0.1, 0.24, 0.3),
        reach: { "hand.L": rail("L", 0.1, 0.34), "hand.R": rail("R", 0.28, 0.3) },
      },
      {
        t: 0.62,
        pose: { hips: [15, -10, 10], spine: [16, 0, 0], chest: [8, 0, 0], head: [-20, 0, 0], "thigh.L": [-50, 0, 8], "shin.L": [60, 0, 0], "thigh.R": [-40, 0, -4], "shin.R": [50, 0, 0], "upper_arm.L": [-60, 0, 30], "upper_arm.R": [-40, 0, -40], "forearm.L": [-30, 0, 0], "forearm.R": [-30, 0, 0] },
        hips: m(0.05, 0.05, 0.6),
        reach: { "hand.R": rail("R", 0.2, 0.32) },
      },
      key(0.8, pose(SLUMP, { spine: [22, 0, 0], chest: [12, 0, 0], "upper_arm.L": [-50, 0, 30], "upper_arm.R": [-45, 0, -30] }), m(0, -0.16, 0.68), feet(kit.foot("L", 0.76, 0.02), kit.foot("R", 0.62, 0.03))),
      key(1.0, SLUMP, m(0, -0.06, 0.7), feet(kit.foot("L", 0.76, 0.02), kit.foot("R", 0.62, 0.03))),
    ]),
  );

  // The bloater: a shudder, the burst (the game hides `belly` about 0.36 s), the fall.
  const shudder = (t: number, s: number): Key =>
    key(
      t,
      pose(SLUMP, { spine: [10 + 3 * s, 0, -2 + 5 * s], chest: [8 - 4 * s, 4, 1 - 6 * s], head: [-16 - 6 * s, 6 + 8 * s, 14], "upper_arm.L": [-27, 0, 16 + 10 * s], "upper_arm.R": [-22, 0, -12 + 10 * s] }),
      m(0.01 * s, -0.03 - 0.01 * Math.abs(s), -0.02),
    );
  out.push(
    kit.clip("bloat_burst", [
      key(0, SLUMP),
      shudder(0.05, 1),
      shudder(0.1, -1),
      shudder(0.15, 1),
      shudder(0.2, -1),
      shudder(0.25, 1),
      shudder(0.3, -0.6),
      key(
        0.36,
        pose(SLUMP, { hips: [-6, 0, 0], spine: [-18, 0, 0], chest: [-20, 0, 0], neck: [-10, 0, 0], head: [-35, 0, 0], "upper_arm.L": [-40, 0, 70], "upper_arm.R": [-40, 0, -70], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] }),
        m(0, -0.02, -0.06),
      ),
      key(
        0.55,
        pose(flungBack, { hips: [-40, 0, 6], spine: [-6, 0, 0], chest: [-6, 0, 0], head: [-20, 10, 0], "upper_arm.L": [-60, 0, 70], "upper_arm.R": [-50, 0, -70] }),
        m(0, -0.45, -0.25),
        feet(kit.foot("L", 0.05, 0.02), kit.foot("R", -0.02, 0.03)),
      ),
      key(
        0.68,
        pose(flungBack, { hips: [-68, 0, 6], spine: [-2, 0, 0], chest: [-2, 0, 0], head: [-14, 20, 0], "upper_arm.L": [-40, 0, 72], "upper_arm.R": [-35, 0, -72] }),
        m(0, -0.68, -0.45),
        feet(kit.foot("L", 0.2, 0.02, 0, [-30, 6, 0]), kit.foot("R", 0.14, 0.03, 0, [-30, -6, 0])),
      ),
      key(
        0.8,
        pose(flungBack, { hips: [-88, 0, 6], spine: [2, 0, 0], chest: [2, 0, 0], head: [-4, 30, 0], "thigh.L": [-20, 0, 10], "shin.L": [30, 0, 0], "thigh.R": [-12, 0, -10], "shin.R": [22, 0, 0], "foot.L": [25, 0, 0], "foot.R": [25, 0, 0] }),
        m(0, -0.84, -0.52),
        null,
      ),
    ]),
  );

  // --- the crawler: legs gone at the knee, it pulls itself along with its hands ---

  const PRONE_HIPS = m(0, -0.84, -0.32);
  const shoulder = kit.joint(PRONE, PRONE_HIPS, "upper_arm.L");
  const reachZ = shoulder.z / kit.k + 0.2;
  const handStep: Step = { land: 0, stance: 0.54, lift: 0.09 };
  const flat = (side: "L" | "R", curl = 0): Vec3 => [-90 + curl, side === "L" ? -12 : 12, 0];
  const onGround = (side: "L" | "R", x: number, z: number, y = 0.035): Reach => kit.hand(side, x, y, z, [0.7, 1, -0.2], flat(side));
  const crawlKeys: Key[] = [];
  for (let i = 0; i <= 24; i++) {
    const p = i / 24;
    const pullL = bump(p, 0.27, 0.54);
    const pullR = bump(p, 0.77, 0.54);
    const surge = cyc2(p, 0.25);
    const reach: Record<string, Reach> = {};
    for (const side of ["L", "R"] as const) {
      const st = stride({ ...handStep, land: side === "L" ? 0 : 0.5 }, p, GAIT_SPEEDS.crawl, 1.6);
      const r = onGround(side, 0.27, reachZ, 0.035 + handStep.lift * st.arc);
      r.at[2] += st.z;
      r.turn = flat(side, 40 * st.arc);
      reach[`hand.${side}`] = r;
    }
    crawlKeys.push({
      t: p * 1.6,
      pose: pose(PRONE, {
        hips: [86 + 2 * surge, 3 * (pullL - pullR), 6 * (pullL - pullR)],
        spine: [-6 - 3 * surge, 4 * (pullR - pullL), 3 * (pullR - pullL)],
        chest: [-10, 6 * (pullR - pullL), 4 * (pullR - pullL)],
        head: [-32 + 5 * cyc2(p, 0.1), 7 * sin(p, 0.1), 5 * (pullL - pullR)],
        "thigh.L": [-4 + 10 * pullR, 0, 10 + 10 * pullL],
        "thigh.R": [-4 + 10 * pullL, 0, -8 - 10 * pullR],
      }),
      hips: [PRONE_HIPS[0], PRONE_HIPS[1] + 0.012 * kit.k * surge, PRONE_HIPS[2] + 0.03 * kit.k * surge],
      reach,
    });
  }
  out.push(kit.clip("crawl", crawlKeys, false));

  const propped = (l: [number, number], r: [number, number]) => ({ "hand.L": onGround("L", l[0], reachZ + l[1]), "hand.R": onGround("R", r[0], reachZ + r[1]) });
  const lying = propped([0.27, 0.02], [0.28, -0.08]);
  out.push(
    kit.clip("idle.low", [
      { t: 0, pose: PRONE, hips: PRONE_HIPS, reach: lying },
      { t: 0.9, pose: pose(PRONE, { chest: [-14, 4, 0], neck: [-30, 0, 0], head: [-40, 18, 0] }), hips: PRONE_HIPS, reach: lying },
      {
        t: 1.6,
        pose: pose(PRONE, { chest: [-8, -6, 0], head: [-28, -10, 6] }),
        hips: PRONE_HIPS,
        reach: { "hand.L": onGround("L", 0.27, reachZ + 0.02), "hand.R": kit.hand("R", 0.25, 0.12, reachZ + 0.2, [0.7, 1, -0.2], flat("R", 30)) },
      },
      { t: 2.5, pose: PRONE, hips: PRONE_HIPS, reach: lying },
    ]),
  );

  // Clawing up at the foot of the barricade: propped on the left arm, the
  // right raking at the sandbags, the stroke's peak at 0.7 s as the standing claw.
  const up = pose(PRONE, { hips: [80, 0, 0], spine: [-18, 6, 0], chest: [-16, 4, 0], neck: [-18, 0, 0], head: [-26, 0, 0] });
  const upHips: Vec3 = [PRONE_HIPS[0], PRONE_HIPS[1] + 0.02 * kit.k, PRONE_HIPS[2]];
  const lowClaw = (t: number, r: Vec3, lean: Pose = {}, dz = 0): Key => ({
    t,
    pose: pose(up, lean),
    hips: [upHips[0], upHips[1], upHips[2] + dz * kit.k],
    reach: { "hand.L": onGround("L", 0.22, reachZ - 0.02), "hand.R": kit.hand("R", r[0], r[1], reachZ + r[2], [1, -0.3, -0.3]) },
  });
  const lowStart = lowClaw(0, [0.22, 0.55, 0.1]);
  out.push(
    kit.clip("claw.low", [
      lowStart,
      lowClaw(0.35, [0.24, 0.7, 0.0], { spine: [-22, 8, 0], head: [-30, 0, 0] }),
      lowClaw(0.7, [0.15, 0.3, 0.36], { spine: [-12, -6, 4], chest: [-12, -6, 0], head: [-22, 0, 0] }, 0.04),
      lowClaw(1.05, [0.2, 0.1, 0.16], { spine: [-16, 0, 0] }, 0.02),
      { ...lowStart, t: 1.4 },
    ]),
  );

  out.push(
    kit.clip("hit_head.low", [
      { t: 0, pose: PRONE, hips: PRONE_HIPS, reach: lying },
      { t: 0.06, pose: pose(PRONE, { chest: [-16, 6, 0], neck: [-44, 0, 0], head: [-58, -14, -8] }), hips: PRONE_HIPS, reach: lying },
      { t: 0.18, pose: pose(PRONE, { chest: [-12, 3, 0], neck: [-34, 0, 0], head: [-44, -8, -4] }), hips: PRONE_HIPS, reach: lying },
      { t: 0.4, pose: PRONE, hips: PRONE_HIPS, reach: lying },
    ]),
  );

  out.push(
    kit.clip("death.low", [
      { t: 0, pose: PRONE, hips: PRONE_HIPS, reach: lying },
      { t: 0.12, pose: pose(PRONE, { chest: [-14, 0, 0], neck: [-40, 0, 0], head: [-55, 0, 0] }), hips: PRONE_HIPS, reach: lying },
      { t: 0.4, pose: pose(PRONE, { spine: [-2, 0, 0], chest: [-4, 0, 0], neck: [-10, 0, 0], head: [-10, 10, 0] }), hips: PRONE_HIPS, reach: propped([0.4, 0.06], [0.44, -0.02]) },
      {
        t: 0.8,
        pose: pose(PRONE, { hips: [89, 0, 0], spine: [2, 0, 0], chest: [4, 0, 0], neck: [4, 0, 0], head: [4, 40, 0] }),
        hips: [PRONE_HIPS[0], PRONE_HIPS[1] - 0.02 * kit.k, PRONE_HIPS[2]],
        reach: propped([0.5, -0.06], [0.46, 0.08]),
      },
      {
        t: 1.0,
        pose: pose(PRONE, { hips: [89, 0, 0], spine: [2, 0, 0], chest: [4, 0, 0], neck: [4, 0, 0], head: [6, 44, 0] }),
        hips: [PRONE_HIPS[0], PRONE_HIPS[1] - 0.025 * kit.k, PRONE_HIPS[2]],
        reach: propped([0.51, -0.07], [0.47, 0.07]),
      },
    ]),
  );

  return out;
}

/** The Mechanic: every clip of the dead for his own proportions, and his own three. */
export function mechanicClips(kit: ClipKit): AnimationClip[] {
  const out = deadClips(kit);
  const m = (x: number, y: number, z: number) => kit.m(x, y, z);
  const wide = { "foot.L": kit.foot("L", 0.04, 0.05), "foot.R": kit.foot("R", -0.08, 0.05) };
  const key = (t: number, p: Pose, hips: Vec3 = m(0, -0.03, -0.02)): Key => ({ t, pose: p, hips, reach: wide });

  const roar = pose(SLUMP, {
    hips: [-2, 0, 0],
    spine: [-6, 0, 0],
    chest: [-12, 0, 0],
    neck: [-18, 0, 0],
    head: [-34, 0, 0],
    "shoulder.L": [0, 0, 6],
    "shoulder.R": [0, 0, -6],
    "upper_arm.L": [10, 0, 55],
    "upper_arm.R": [10, 0, -55],
    "forearm.L": [-35, 0, 0],
    "forearm.R": [-35, 0, 0],
    "hand.L": [-10, 0, 0],
    "hand.R": [-10, 0, 0],
  });
  const tremble = (head: Vec3): Pose => pose(roar, { head });
  out.push(
    kit.clip("roar", [
      key(0, SLUMP),
      key(0.35, roar, m(0, -0.06, -0.02)),
      key(0.6, tremble([-36, 3, 2]), m(0, -0.06, -0.02)),
      key(0.9, tremble([-33, -3, -2]), m(0, -0.065, -0.02)),
      key(1.2, tremble([-36, 2, 0]), m(0, -0.06, -0.02)),
      key(1.4, roar, m(0, -0.06, -0.02)),
      key(1.8, SLUMP),
    ]),
  );

  out.push(
    kit.clip("mask_off", [
      key(0, SLUMP),
      key(0.07, pose(SLUMP, { spine: [4, 0, 0], chest: [-10, -8, 0], neck: [-20, 0, 0], head: [-44, 18, 12], "upper_arm.L": [-40, 0, 25], "upper_arm.R": [-30, 0, -20] }), m(0, -0.03, -0.06)),
      key(0.25, pose(SLUMP, { chest: [-4, -4, 0], neck: [-6, 0, 0], head: [-24, 10, 6] }), m(0, -0.03, -0.04)),
      key(0.42, pose(SLUMP, { neck: [10, 0, 0], head: [-4, -16, -4] })),
      key(0.6, SLUMP),
    ]),
  );

  // The tyre iron, from high behind the head down into the barricade: impact at 0.45 s.
  out.push(
    kit.clip("swing", [
      key(0, SLUMP),
      key(
        0.25,
        pose(SLUMP, { hips: [-2, 12, 0], spine: [-4, 10, 0], chest: [-10, 16, 0], neck: [0, 0, 0], head: [-20, -18, 0], "upper_arm.R": [-165, 20, -20], "forearm.R": [-95, 0, 0], "hand.R": [-20, 0, 0], "upper_arm.L": [-60, 0, 30], "forearm.L": [-40, 0, 0] }),
        m(0, -0.02, -0.06),
      ),
      key(
        0.45,
        pose(SLUMP, { hips: [12, -10, 0], spine: [16, -8, 0], chest: [14, -14, 0], neck: [4, 0, 0], head: [-30, 12, 0], "upper_arm.R": [-95, -10, -10], "forearm.R": [-8, 0, 0], "hand.R": [20, 0, 0], "upper_arm.L": [-10, 0, 40], "forearm.L": [-20, 0, 0] }),
        m(0, -0.1, 0.1),
      ),
      key(
        0.62,
        pose(SLUMP, { hips: [14, -12, 0], spine: [22, -8, 0], chest: [16, -14, 0], head: [-30, 12, 0], "upper_arm.R": [-50, -20, -10], "forearm.R": [-20, 0, 0], "hand.R": [10, 0, 0], "upper_arm.L": [-14, 0, 36], "forearm.L": [-20, 0, 0] }),
        m(0, -0.1, 0.1),
      ),
      key(0.9, SLUMP),
    ]),
  );
  return out;
}

// --- the living ---------------------------------------------------------------------

const UPRIGHT: Pose = {
  spine: [3, 0, 0],
  neck: [2, 0, 0],
  head: [-4, 0, 0],
  "upper_arm.L": [-8, 0, 8],
  "forearm.L": [-35, 0, 0],
  "upper_arm.R": [4, 0, -7],
  "forearm.R": [-15, 0, 0],
};

/** The survivors: two living people running for the motel, a lantern in the left hand. */
export function survivorClips(kit: ClipKit): AnimationClip[] {
  const out: AnimationClip[] = [];
  const m = (x: number, y: number, z: number) => kit.m(x, y, z);
  const planted = { "foot.L": kit.foot("L", 0.02, 0.01), "foot.R": kit.foot("R", -0.02, 0.01) };
  /** The lantern hangs plumb from the left hand, whatever the arm does. */
  const plumb = { "hand.L": [0, 0, 0] as Vec3 };
  const key = (t: number, p: Pose, hips: Vec3 = [0, 0, 0], reach: Record<string, Reach> = planted): Key => ({ t, pose: p, hips, reach, level: plumb });

  out.push(
    kit.clip("idle", [
      key(0, UPRIGHT),
      key(0.8, pose(UPRIGHT, { chest: [0, 8, 0], head: [-2, 35, 0] }), m(0.01, -0.005, 0)),
      key(1.5, pose(UPRIGHT, { chest: [-2, 0, 0], head: [-6, 0, 0] }), m(0, 0.004, 0)),
      key(2.2, pose(UPRIGHT, { chest: [0, -8, 0], head: [-2, -35, 0] }), m(-0.01, -0.005, 0)),
      key(3.0, UPRIGHT),
    ]),
  );

  const legs = (stance: number): Pick<Gait, "L" | "R" | "crouch" | "keys"> => ({
    keys: 20,
    crouch: 0.07,
    L: { land: 0, stance, lift: 0.22, z: -0.03, toeOut: 4, toeOff: 40, heel: 12, snap: 0.7 },
    R: { land: 0.5, stance, lift: 0.22, z: -0.03, toeOut: 4, toeOff: 40, heel: 12, snap: 0.7 },
  });
  // A real run: upright, arms pumping from the shoulder, elbows bent, the head still.
  const runGait: Gait = {
    name: "run",
    speed: SURVIVOR_SPEEDS.run,
    period: 0.64,
    ...legs(0.28),
    body: (p) => {
      const a = cyc(p, 0.02);
      return {
        hips: m(0.012 * cyc(p, 0.14), 0.035 * cyc2(p, 0.39), 0),
        level: plumb,
        pose: {
          hips: [8, -8 * cyc(p), 3 * cyc(p, 0.14)],
          spine: [4, 6 * cyc(p), 0],
          chest: [2, 6 * cyc(p), 0],
          head: [-8, 0, 0],
          "upper_arm.L": [-2 + 36 * a, 0, 10],
          "forearm.L": [-70 + 12 * a, 0, 0],
          "upper_arm.R": [-2 - 36 * a, 0, -10],
          "forearm.R": [-70 - 12 * a, 0, 0],
        },
      };
    },
  };
  out.push(kit.gait(runGait));

  // Running with the lantern held out in front, steady in the world while the
  // body bobs under it; only the right arm pumps.
  out.push(
    kit.gait({
      name: "run_lantern",
      speed: SURVIVOR_SPEEDS.run_lantern,
      period: 0.66,
      ...legs(0.29),
      body: (p) => {
        const a = cyc(p, 0.02);
        return {
          hips: m(0.01 * cyc(p, 0.14), 0.03 * cyc2(p, 0.4), 0),
          level: plumb,
          reach: { "hand.L": kit.hand("L", 0.13, 1.16, 0.38, [0.8, -1, -0.4]) },
          pose: {
            hips: [8, -6 * cyc(p), 3 * cyc(p, 0.14)],
            spine: [4, 3 * cyc(p), 0],
            chest: [2, 3 * cyc(p), 0],
            head: [-8, 0, 0],
            "upper_arm.R": [-2 - 38 * a, 0, -10],
            "forearm.R": [-70 - 12 * a, 0, 0],
          },
        };
      },
    }),
  );

  // Ducking a shot: down low, the right arm over the head, the lantern held in close.
  const low = pose(UPRIGHT, { hips: [10, 0, 0], spine: [26, 0, 0], chest: [14, 0, 0], neck: [20, 0, 0], head: [18, 0, 0] });
  const lowHips = m(0, -0.44, -0.08);
  const crouchFeet = { "foot.L": kit.foot("L", 0.04, 0.05), "foot.R": kit.foot("R", -0.06, 0.05) };
  const head = kit.joint(low, lowHips, "head");
  const cover = kit.hand("R", 0, 0, 0, [-1, 0.2, 0.6]);
  cover.at = [head.x - 0.02 * kit.w, head.y + 0.14 * kit.k, head.z + 0.08 * kit.k];
  cover.pole = [-1, 0.3, 0.5];
  out.push(
    kit.clip("duck", [
      key(0, UPRIGHT),
      key(0.18, pose(UPRIGHT, { spine: [18, 0, 0], head: [8, 0, 0], "upper_arm.R": [-120, 0, -20], "forearm.R": [-60, 0, 0] }), m(0, -0.2, -0.04), crouchFeet),
      { t: 0.5, pose: low, hips: lowHips, reach: { ...crouchFeet, "hand.R": cover, "hand.L": kit.hand("L", 0.2, 0.42, 0.22, [0.8, -1, -0.4]) }, level: plumb },
    ]),
  );

  // Waving for help, the right arm high, the body leaning into it.
  const waveA = pose(UPRIGHT, { spine: [-2, 0, -4], chest: [-3, 0, -3], head: [-12, 0, 0], "upper_arm.R": [-10, 0, -150], "forearm.R": [0, 0, 25], "hand.R": [0, 0, 10] });
  const waveB = pose(waveA, { spine: [-2, 0, 2], chest: [-3, 0, 1], "forearm.R": [0, 0, -25], "hand.R": [0, 0, -10] });
  out.push(kit.clip("wave", [key(0, waveA), key(0.5, waveB, m(-0.01, 0, 0)), key(1.0, waveA)]));

  // Shot while running: a flinch, a stagger, and on again, beginning and
  // ending on the run's first frame so it slots in and out of `run`.
  const run0 = kit.gaitKey(runGait, 0);
  out.push(
    kit.clip("stumble", [
      { ...run0, t: 0 },
      {
        t: 0.12,
        pose: { hips: [14, 10, 0], spine: [22, 12, -8], chest: [14, 8, -6], neck: [10, 0, 0], head: [10, 20, 0], "upper_arm.R": [-20, 0, 25], "forearm.R": [-110, 0, 0], "upper_arm.L": [-30, 0, 30], "forearm.L": [-50, 0, 0] },
        hips: m(0, -0.12, 0.04),
        reach: { "foot.L": kit.foot("L", 0.25), "foot.R": kit.foot("R", -0.3, 0, 0.08, [30, -4, 0]) },
        level: plumb,
      },
      {
        t: 0.32,
        pose: { hips: [16, 6, 0], spine: [26, 6, -4], chest: [12, 4, 0], neck: [6, 0, 0], head: [0, 10, 0], "upper_arm.R": [-30, 0, 20], "forearm.R": [-100, 0, 0], "upper_arm.L": [-50, 0, 40], "forearm.L": [-40, 0, 0] },
        hips: m(0.03, -0.2, 0.0),
        reach: { "foot.L": kit.foot("L", -0.15, 0.03), "foot.R": kit.foot("R", 0.1, 0.03) },
        level: plumb,
      },
      {
        t: 0.5,
        pose: { hips: [12, 2, 0], spine: [14, 0, 0], chest: [6, 0, 0], head: [-6, 0, 0], "upper_arm.R": [-40, 0, -10], "forearm.R": [-90, 0, 0], "upper_arm.L": [10, 0, 20], "forearm.L": [-70, 0, 0] },
        hips: m(0, -0.12, 0.02),
        reach: { "foot.L": kit.foot("L", 0.2, 0, 0.1, [-10, 4, 0]), "foot.R": kit.foot("R", -0.15) },
        level: plumb,
      },
      { ...run0, t: 0.7 },
    ]),
  );
  return out;
}

// --- the cat ---------------------------------------------------------------------

const PAWS = ["FL", "FR", "BL", "BR"] as const;

/** The black cat: sitting, hissing, leaping, walking. */
export function catClips(kit: ClipKit): AnimationClip[] {
  const out: AnimationClip[] = [];
  const tips = new Map(PAWS.map((p) => [p, kit.restTip(`paw.${p}`)]));
  /** A paw on the ground near its rest place (or `dy` above it). */
  const paw = (leg: (typeof PAWS)[number], dz = 0, dx = 0, dy = 0): Reach => {
    const t = tips.get(leg) as Vector3;
    return { at: [t.x + Math.sign(t.x) * dx, t.y + dy, t.z + dz] };
  };
  const all = (dz: Partial<Record<(typeof PAWS)[number], [number, number, number]>> = {}): Record<string, Reach> => {
    const r: Record<string, Reach> = {};
    for (const leg of PAWS) r[`paw.${leg}`] = paw(leg, ...(dz[leg] ?? [0, 0, 0]));
    return r;
  };

  // Sitting up: haunches on the ground, the back feet flat under them (the
  // hocks down on the road), front legs straight, the tail round the feet.
  // The front legs are short for the body, so the back slopes up only so far.
  const sitting: Pose = {
    body: [-24, 0, 0],
    spine: [-12, 0, 0],
    neck: [16, 0, 0],
    head: [20, 0, 0],
    // The tail points back, so pitching it negative lowers it: down to the ground, then round.
    "tail.1": [-40, 30, 0],
    "tail.2": [25, 60, 0],
    "tail.3": [10, 55, 0],
  };
  const sitHips: Vec3 = [0, -0.085, 0.01];
  const sitPaws = all({ FL: [0.03, -0.004, 0], FR: [0.03, -0.004, 0], BL: [0.09, 0.01, 0], BR: [0.09, 0.01, 0] });
  for (const leg of ["BL", "BR"]) (sitPaws[`paw.${leg}`] as Reach).pole = [0, 0.3, -1];
  const sitKey = (t: number, p: Pose): Key => ({ t, pose: pose(sitting, p), hips: sitHips, reach: sitPaws });
  out.push(
    kit.clip("sit", [
      sitKey(0, {}),
      sitKey(0.6, { "tail.3": [18, 80, 0] }),
      sitKey(0.9, { "tail.3": [10, 35, 0], head: [30, 25, 0] }),
      sitKey(1.5, { "tail.2": [25, 68, 0], "tail.3": [12, 65, 0], head: [28, 30, 6] }),
      sitKey(2.1, { "tail.3": [8, 30, 0], head: [32, -10, 0] }),
      sitKey(2.5, { "tail.3": [18, 78, 0], head: [30, -4, 0] }),
      sitKey(3.0, {}),
    ]),
  );

  // Hissing: the back humped (the pelvis sinks, the shoulders rise over
  // straight front legs), fur (the spine) and tail puffed up, the tail raised
  // in a hook, the head low and thrust forward.
  const arched: Pose = { body: [-16, 0, 0], spine: [26, 0, 0], neck: [-12, 0, 0], head: [-20, 0, 0], "tail.1": [55, 0, 0], "tail.2": [25, 0, 0], "tail.3": [-35, 0, 0] };
  const puffed: Record<string, Vec3> = { body: [1.08, 1.15, 1], spine: [1.15, 1.25, 1], "tail.1": [1.5, 1, 1.5], "tail.2": [1.6, 1, 1.6], "tail.3": [1.35, 1, 1.35] };
  const stiff = all({ FL: [0.015, 0.01, 0], FR: [0.015, 0.01, 0], BL: [-0.015, 0.012, 0], BR: [-0.015, 0.012, 0] });
  const hiss = (t: number, p: Pose): Key => ({ t, pose: pose(arched, p), hips: [0, -0.045, 0], reach: stiff, scale: puffed });
  out.push(
    kit.clip("hiss", [
      { t: 0, pose: {}, hips: [0, 0, 0], reach: all() },
      hiss(0.2, {}),
      hiss(0.4, { head: [-24, 4, 0] }),
      hiss(0.55, { head: [-16, -4, 0] }),
      hiss(0.7, { head: [-24, 3, 0] }),
      { t: 1.0, pose: { body: [-6, 0, 0], spine: [8, 0, 0], head: [-4, 0, 0], "tail.1": [20, 0, 0] }, hips: [0, -0.02, 0], reach: all(), scale: { spine: [1.04, 1.05, 1] } },
    ]),
  );

  // Leaping (in place): crouch, spring, stretch out in the air, land.
  out.push(
    kit.clip("leap", [
      { t: 0, pose: {}, hips: [0, 0, 0], reach: all() },
      { t: 0.12, pose: { body: [6, 0, 0], neck: [-6, 0, 0], "tail.1": [20, 0, 0] }, hips: [0, -0.05, 0], reach: all() },
      { t: 0.25, pose: { body: [-20, 0, 0], neck: [10, 0, 0], head: [10, 0, 0], "tail.1": [0, 0, 0] }, hips: [0, 0.08, 0.01], reach: all({ FL: [0.2, 0, 0.1], FR: [0.2, 0, 0.1], BL: [-0.18, 0, 0], BR: [-0.18, 0, 0] }) },
      { t: 0.38, pose: { body: [-5, 0, 0], spine: [4, 0, 0], head: [5, 0, 0], "tail.1": [50, 0, 0], "tail.2": [10, 0, 0] }, hips: [0, 0.3, 0.01], reach: all({ FL: [0.2, 0, 0.26], FR: [0.2, 0, 0.26], BL: [-0.2, 0, 0.24], BR: [-0.2, 0, 0.24] }) },
      { t: 0.5, pose: { body: [10, 0, 0], spine: [-4, 0, 0], head: [-8, 0, 0], "tail.1": [20, 0, 0] }, hips: [0, 0.06, 0], reach: all({ BL: [-0.08, 0, 0.06], BR: [-0.08, 0, 0.06] }) },
      { t: 0.6, pose: { body: [4, 0, 0], neck: [-6, 0, 0], "tail.1": [10, 0, 0] }, hips: [0, -0.03, 0], reach: all() },
    ]),
  );

  // Walking: the four paws one after another (back left, front left, back
  // right, front right), each slid back at exactly the walk's speed.
  const period = 0.5;
  const lands: Record<(typeof PAWS)[number], number> = { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 };
  const walkKeys: Key[] = [];
  for (let i = 0; i <= 20; i++) {
    const p = i / 20;
    const reach: Record<string, Reach> = {};
    for (const leg of PAWS) {
      const st = stride({ land: lands[leg], stance: 0.58, lift: 0.035 }, p, CAT_SPEEDS.walk, period);
      const r = paw(leg, st.z, 0, 0.035 * st.arc);
      reach[`paw.${leg}`] = r;
    }
    walkKeys.push({
      t: p * period,
      pose: {
        body: [2 + 1.5 * cyc2(p, 0.1), 4 * sin(p), 3 * cyc(p, 0.1)],
        spine: [-2, -5 * sin(p), -2 * cyc(p, 0.1)],
        neck: [-8, 0, 0],
        head: [6, 4 * sin(p, 0.2), 0],
        "tail.1": [-25 + 5 * cyc2(p, 0.3), 0, 0],
        "tail.2": [10, 15 * sin(p), 0],
        "tail.3": [20, 20 * sin(p, 0.15), 0],
      },
      hips: [0.004 * cyc(p, 0.15), -0.035 + 0.005 * cyc2(p, 0.1), 0],
      reach,
    });
  }
  out.push(kit.clip("walk", walkKeys, false));
  return out;
}
