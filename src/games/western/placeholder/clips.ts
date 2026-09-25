import {
  AnimationClip,
  Euler,
  InterpolateSmooth,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from "three";

/** Bone rotations in degrees, applied yaw (Y), then pitch (X), then roll (Z). */
export type Pose = Record<string, [number, number, number]>;

export interface Key {
  t: number;
  pose: Pose;
  /** Offset of the hips from their rest position, metres. */
  hips?: [number, number, number];
}

const DEG = Math.PI / 180;
const euler = new Euler();
const quat = new Quaternion();

/**
 * Build an AnimationClip from a few key poses, the way the character agent's
 * Blender actions will arrive: quaternion tracks per bone, named with the
 * glTF loader's sanitised node names, plus the hips' translation. Bones not
 * mentioned in a key are at rest.
 */
export function makeClip(name: string, keys: Key[], hipsRest: [number, number, number], smooth = true): AnimationClip {
  const bones = new Set<string>();
  for (const k of keys) for (const b of Object.keys(k.pose)) bones.add(b);
  const times = keys.map((k) => k.t);
  const tracks: KeyframeTrack[] = [];
  for (const bone of bones) {
    const values: number[] = [];
    let prev: Quaternion | null = null;
    for (const k of keys) {
      const r = k.pose[bone] ?? [0, 0, 0];
      euler.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, "YXZ");
      quat.setFromEuler(euler);
      // Keep successive keys on the same hemisphere so slerp takes the short way.
      if (prev && prev.dot(quat) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
      prev = quat.clone();
      values.push(quat.x, quat.y, quat.z, quat.w);
    }
    tracks.push(new QuaternionKeyframeTrack(`${PropertyBinding.sanitizeNodeName(bone)}.quaternion`, times, values));
  }
  if (keys.some((k) => k.hips)) {
    const values: number[] = [];
    for (const k of keys) {
      const h = k.hips ?? [0, 0, 0];
      values.push(hipsRest[0] + h[0], hipsRest[1] + h[1], hipsRest[2] + h[2]);
    }
    const track = new VectorKeyframeTrack("hips.position", times, values);
    if (smooth && keys.length > 2) track.setInterpolation(InterpolateSmooth);
    tracks.push(track);
  }
  return new AnimationClip(name, keys[keys.length - 1]?.t ?? 0, tracks);
}

/** Merge poses: later ones win, bone by bone. */
export function pose(...parts: Pose[]): Pose {
  return Object.assign({}, ...parts) as Pose;
}

/** Mirror a pose left to right (for leaning the other way). */
export function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [bone, [x, y, z]] of Object.entries(p)) {
    const other = bone.endsWith(".L") ? bone.slice(0, -2) + ".R" : bone.endsWith(".R") ? bone.slice(0, -2) + ".L" : bone;
    out[other] = [x, -y, -z];
  }
  return out;
}

// --- the humanoid's poses ---------------------------------------------------------

const STANCE: Pose = { "thigh.L": [0, 0, 5], "thigh.R": [0, 0, -5] };

export const STAND: Pose = pose(STANCE, {
  "upper_arm.L": [4, 0, 7],
  "forearm.L": [-12, 0, 0],
  "upper_arm.R": [4, 0, -7],
  "forearm.R": [-18, 0, 0],
});

/** Standing in cover, gun held up by the chest. */
export const READY: Pose = pose(STANCE, {
  "upper_arm.R": [-35, -10, -8],
  "forearm.R": [-85, 0, 0],
  "upper_arm.L": [-20, 0, 10],
  "forearm.L": [-50, 0, 0],
  spine: [4, 0, 0],
});

/** Gun levelled at the player, two-handed; the chest turned so the right shoulder leads. */
export const AIM: Pose = pose(STANCE, {
  spine: [0, 6, 0],
  chest: [0, 16, 0],
  neck: [0, -6, 0],
  head: [2, -14, 0],
  "upper_arm.R": [-86, -22, 0],
  "forearm.R": [-4, 0, 0],
  "upper_arm.L": [-74, -48, 0],
  "forearm.L": [-22, 0, 0],
  "thigh.L": [-6, 0, 8],
  "thigh.R": [6, 0, -6],
});

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
  "upper_arm.R": [-40, -10, 0],
  "forearm.R": [-80, 0, 0],
  "upper_arm.L": [-30, 0, 10],
  "forearm.L": [-60, 0, 0],
};
export const CROUCH_HIPS: [number, number, number] = [0, -0.47, -0.05];

const LEAN_LEFT: Pose = pose(AIM, {
  spine: [0, 8, -12],
  chest: [0, 14, -14],
  neck: [0, -8, 12],
  head: [0, -12, 12],
  "upper_arm.R": [-86, -18, 14],
  "thigh.L": [0, 0, 14],
  "thigh.R": [0, 0, 2],
});

export function humanoidClips(hipsRest: [number, number, number]): AnimationClip[] {
  const H = hipsRest;
  const clips: AnimationClip[] = [];
  const add = (name: string, keys: Key[]) => clips.push(makeClip(name, keys, H));

  add("idle", [
    { t: 0, pose: STAND },
    { t: 1.2, pose: pose(STAND, { chest: [2.5, 0, 0], head: [-2, 3, 0] }), hips: [0, -0.005, 0] },
    { t: 2.4, pose: STAND },
  ]);
  add("hidden", [
    { t: 0, pose: CROUCH, hips: CROUCH_HIPS },
    { t: 1, pose: pose(CROUCH, { chest: [13, 0, 0], head: [-6, 8, 0] }), hips: [0, -0.46, -0.05] },
    { t: 2, pose: CROUCH, hips: CROUCH_HIPS },
  ]);
  add("lean_left_out", [
    { t: 0, pose: READY },
    { t: 0.3, pose: LEAN_LEFT, hips: [0.1, -0.02, 0] },
  ]);
  add("lean_left_in", [
    { t: 0, pose: LEAN_LEFT, hips: [0.1, -0.02, 0] },
    { t: 0.25, pose: READY, hips: [0, 0, 0] },
  ]);
  const leanRight = mirror(LEAN_LEFT);
  // Mirroring swaps which hand holds the gun; put it back in the right.
  leanRight["upper_arm.R"] = [-86, -30, -10];
  leanRight["forearm.R"] = [-4, 0, 0];
  leanRight["upper_arm.L"] = [-70, -55, 0];
  leanRight["forearm.L"] = [-22, 0, 0];
  add("lean_right_out", [
    { t: 0, pose: READY },
    { t: 0.3, pose: leanRight, hips: [-0.1, -0.02, 0] },
  ]);
  add("lean_right_in", [
    { t: 0, pose: leanRight, hips: [-0.1, -0.02, 0] },
    { t: 0.25, pose: READY, hips: [0, 0, 0] },
  ]);
  add("rise", [
    { t: 0, pose: CROUCH, hips: CROUCH_HIPS },
    { t: 0.22, pose: pose(READY, { spine: [15, 0, 0], "thigh.L": [-30, 0, 5], "shin.L": [45, 0, 0], "thigh.R": [-25, 0, -5], "shin.R": [40, 0, 0] }), hips: [0, -0.15, 0] },
    { t: 0.4, pose: AIM, hips: [0, 0, 0] },
  ]);
  add("sink", [
    { t: 0, pose: AIM, hips: [0, 0, 0] },
    { t: 0.35, pose: CROUCH, hips: CROUCH_HIPS },
  ]);
  add("step_out", [
    { t: 0, pose: READY },
    { t: 0.25, pose: pose(READY, { "thigh.L": [-32, 0, 4], "shin.L": [35, 0, 0], "thigh.R": [14, 0, -4], "shin.R": [10, 0, 0] }), hips: [0, 0.02, 0] },
    { t: 0.5, pose: AIM, hips: [0, 0, 0] },
  ]);
  add("step_in", [
    { t: 0, pose: AIM, hips: [0, 0, 0] },
    { t: 0.22, pose: pose(READY, { "thigh.R": [-30, 0, -4], "shin.R": [35, 0, 0], "thigh.L": [12, 0, 4] }), hips: [0, 0.02, 0] },
    { t: 0.45, pose: READY, hips: [0, 0, 0] },
  ]);
  add("aim", [
    { t: 0, pose: AIM },
    { t: 0.8, pose: pose(AIM, { chest: [1.2, 16, 0], "upper_arm.R": [-87, -22, 0] }) },
    { t: 1.6, pose: AIM },
  ]);
  add("fire", [
    { t: 0, pose: AIM },
    { t: 0.05, pose: pose(AIM, { chest: [-5, 18, 0], head: [-4, -14, 0], "upper_arm.R": [-108, -22, 0], "forearm.R": [-18, 0, 0], "upper_arm.L": [-90, -48, 0] }) },
    { t: 0.25, pose: AIM },
  ]);
  const runA: Pose = {
    spine: [14, 0, 0],
    chest: [4, 0, 0],
    head: [-10, 0, 0],
    "thigh.L": [-48, 0, 4],
    "shin.L": [22, 0, 0],
    "thigh.R": [32, 0, -4],
    "shin.R": [75, 0, 0],
    "upper_arm.L": [38, 0, 8],
    "forearm.L": [-55, 0, 0],
    "upper_arm.R": [-45, 0, -8],
    "forearm.R": [-75, 0, 0],
  };
  const runPass: Pose = pose(runA, {
    "thigh.L": [-8, 0, 4],
    "shin.L": [15, 0, 0],
    "thigh.R": [-22, 0, -4],
    "shin.R": [95, 0, 0],
    "upper_arm.L": [0, 0, 8],
    "upper_arm.R": [-10, 0, -8],
  });
  const runB = pose(runA, {
    "thigh.L": [32, 0, 4],
    "shin.L": [75, 0, 0],
    "thigh.R": [-48, 0, -4],
    "shin.R": [22, 0, 0],
    "upper_arm.L": [-40, 0, 8],
    "upper_arm.R": [30, 0, -8],
  });
  const runPassB = pose(runB, {
    "thigh.L": [-22, 0, 4],
    "shin.L": [95, 0, 0],
    "thigh.R": [-8, 0, -4],
    "shin.R": [15, 0, 0],
    "upper_arm.L": [-10, 0, 8],
    "upper_arm.R": [0, 0, -8],
  });
  add("run", [
    { t: 0, pose: runA, hips: [0, -0.04, 0] },
    { t: 0.15, pose: runPass, hips: [0, 0.03, 0] },
    { t: 0.3, pose: runB, hips: [0, -0.04, 0] },
    { t: 0.45, pose: runPassB, hips: [0, 0.03, 0] },
    { t: 0.6, pose: runA, hips: [0, -0.04, 0] },
  ]);
  add("throw", [
    { t: 0, pose: pose(STAND, { chest: [0, -24, 0], spine: [-4, -6, 0], "upper_arm.R": [42, 0, -12], "forearm.R": [-70, 0, 0], "upper_arm.L": [-50, 20, 20] }) },
    { t: 0.15, pose: pose(STAND, { chest: [0, -12, 0], "upper_arm.R": [-60, 0, -20], "forearm.R": [-95, 0, 0], "upper_arm.L": [-40, 10, 20] }) },
    { t: 0.3, pose: pose(STAND, { chest: [16, 22, 0], spine: [8, 6, 0], "upper_arm.R": [-150, 0, -10], "forearm.R": [-20, 0, 0], "upper_arm.L": [10, 0, 15], "thigh.L": [-25, 0, 5], "shin.L": [20, 0, 0] }) },
    { t: 0.6, pose: pose(STAND, { chest: [10, 12, 0], "upper_arm.R": [-55, 0, -8], "forearm.R": [-15, 0, 0] }) },
  ]);
  add("hit_body", [
    { t: 0, pose: AIM },
    { t: 0.08, pose: pose(AIM, { spine: [-10, 0, 6], chest: [-20, 32, 10], head: [12, -8, 0], "upper_arm.R": [-50, -24, -25], "upper_arm.L": [-30, 0, 35] }) },
    { t: 0.45, pose: AIM },
  ]);
  add("hit_head", [
    { t: 0, pose: AIM },
    { t: 0.06, pose: pose(AIM, { neck: [-18, -6, 0], head: [-38, -20, 8], chest: [-10, 18, 0], "upper_arm.R": [-60, -22, -15] }) },
    { t: 0.45, pose: AIM },
  ]);

  // Deaths. The body ends lying on the ground; the hips carry it down.
  const limpArms: Pose = { "upper_arm.L": [-150, 0, 70], "upper_arm.R": [-150, 0, -70], "forearm.L": [-20, 0, 0], "forearm.R": [-20, 0, 0] };
  add("death_back", [
    { t: 0, pose: AIM },
    { t: 0.25, pose: pose(AIM, { hips: [-18, 0, 0], spine: [-12, 0, 0], chest: [-10, 20, 8], head: [-20, 0, 0], "thigh.L": [-25, 0, 6], "shin.L": [50, 0, 0], "thigh.R": [-15, 0, -6], "shin.R": [40, 0, 0], "upper_arm.R": [-40, -24, -40], "upper_arm.L": [-20, 0, 45] }), hips: [0, -0.12, -0.12] },
    { t: 0.7, pose: pose(limpArms, { hips: [-70, 0, 0], spine: [-5, 0, 0], head: [-10, 15, 0], "thigh.L": [-30, 0, 8], "shin.L": [35, 0, 0], "thigh.R": [-20, 0, -8], "shin.R": [30, 0, 0] }), hips: [0, -0.58, -0.45] },
    { t: 1.0, pose: pose(limpArms, { hips: [-90, 0, 0], head: [0, 35, 0], "thigh.L": [-6, 0, 10], "shin.L": [10, 0, 0], "thigh.R": [-3, 0, -12], "shin.R": [18, 0, 0] }), hips: [0, -0.84, -0.55] },
    { t: 1.2, pose: pose(limpArms, { hips: [-90, 0, 0], head: [2, 38, 0], "thigh.L": [-5, 0, 10], "shin.L": [8, 0, 0], "thigh.R": [-3, 0, -12], "shin.R": [16, 0, 0] }), hips: [0, -0.85, -0.55] },
  ]);
  const faceDown: Pose = { "upper_arm.L": [-165, 0, 40], "upper_arm.R": [-165, 0, -40], "forearm.L": [-30, 0, 0], "forearm.R": [-30, 0, 0] };
  add("death_forward", [
    { t: 0, pose: AIM },
    { t: 0.3, pose: pose(STAND, { spine: [25, 0, 0], chest: [10, 0, 0], head: [20, 0, 0], "thigh.L": [-60, 0, 5], "shin.L": [95, 0, 0], "thigh.R": [-55, 0, -5], "shin.R": [90, 0, 0], "upper_arm.R": [-20, 0, -15] }), hips: [0, -0.33, 0.05] },
    { t: 0.75, pose: pose(faceDown, { hips: [60, 0, 0], spine: [10, 0, 0], "thigh.L": [-30, 0, 5], "shin.L": [40, 0, 0], "thigh.R": [-25, 0, -5], "shin.R": [35, 0, 0] }), hips: [0, -0.6, 0.3] },
    { t: 1.05, pose: pose(faceDown, { hips: [88, 0, 0], head: [0, -35, 0], "thigh.L": [-4, 0, 6], "thigh.R": [-2, 0, -8], "shin.R": [12, 0, 0] }), hips: [0, -0.84, 0.48] },
    { t: 1.2, pose: pose(faceDown, { hips: [89, 0, 0], head: [0, -38, 0], "thigh.L": [-4, 0, 6], "thigh.R": [-2, 0, -8], "shin.R": [10, 0, 0] }), hips: [0, -0.85, 0.5] },
  ]);
  const flail: Pose = { "upper_arm.L": [-140, 0, 60], "upper_arm.R": [-120, 0, -80], "forearm.L": [-40, 0, 0], "forearm.R": [-30, 0, 0] };
  add("death_fall", [
    { t: 0, pose: AIM },
    { t: 0.2, pose: pose(flail, { spine: [18, 0, 0], head: [-20, 0, 0], "thigh.L": [-35, 0, 5], "shin.L": [60, 0, 0], "thigh.R": [20, 0, -5], "shin.R": [30, 0, 0] }) },
    { t: 0.55, pose: pose(flail, { hips: [35, 0, 8], spine: [10, 0, 0], "upper_arm.L": [-80, 0, 90], "upper_arm.R": [-160, 0, -40], "thigh.L": [-10, 0, 5], "thigh.R": [-45, 0, -5], "shin.R": [80, 0, 0] }), hips: [0, -0.1, 0.1] },
    { t: 0.95, pose: pose(faceDown, { hips: [70, 0, 12], "thigh.L": [-20, 0, 5], "shin.L": [30, 0, 0] }), hips: [0, -0.45, 0.3] },
    { t: 1.25, pose: pose(faceDown, { hips: [88, 0, 6], head: [0, 30, 0], "thigh.L": [-5, 0, 10], "thigh.R": [-8, 0, -12], "shin.R": [25, 0, 0] }), hips: [0, -0.84, 0.45] },
    { t: 1.6, pose: pose(faceDown, { hips: [89, 0, 6], head: [0, 32, 0], "thigh.L": [-5, 0, 10], "thigh.R": [-8, 0, -12], "shin.R": [22, 0, 0] }), hips: [0, -0.85, 0.47] },
  ]);
  add("death_slump", [
    { t: 0, pose: AIM },
    { t: 0.3, pose: pose(AIM, { spine: [20, 0, 0], chest: [-6, 10, 0], head: [-15, 0, 0], "upper_arm.R": [-40, 0, -20], "upper_arm.L": [-35, 0, 20] }), hips: [0, -0.08, 0.04] },
    { t: 1.0, pose: { spine: [36, 0, 4], chest: [34, 6, 0], neck: [18, 0, 0], head: [16, 32, 0], "upper_arm.L": [-8, 0, 14], "upper_arm.R": [-8, 0, -14], "forearm.L": [-10, 0, 0], "forearm.R": [-8, 0, 0], "thigh.L": [-30, 0, 6], "shin.L": [52, 0, 0], "thigh.R": [-26, 0, -6], "shin.R": [48, 0, 0] }, hips: [0, -0.18, 0.1] },
  ]);
  return clips;
}

/** Townsfolk: the same armature, their own clips. */
export function townsfolkClips(hipsRest: [number, number, number]): AnimationClip[] {
  const H = hipsRest;
  const clips: AnimationClip[] = [];
  const add = (name: string, keys: Key[]) => clips.push(makeClip(name, keys, H));
  const arms: Pose = { "upper_arm.L": [2, 0, 6], "upper_arm.R": [2, 0, -6], "forearm.L": [-10, 0, 0], "forearm.R": [-10, 0, 0] };
  const still = pose(STANCE, arms);
  add("idle", [
    { t: 0, pose: still },
    { t: 1.4, pose: pose(still, { chest: [2.5, 0, 0], head: [0, 6, 0] }) },
    { t: 2.8, pose: still },
  ]);
  add("peek", [
    { t: 0, pose: pose(still, { spine: [10, 0, 0], head: [8, 25, 0] }) },
    { t: 0.6, pose: pose(still, { spine: [12, 0, 0], head: [10, -25, 0] }) },
    { t: 1.2, pose: pose(still, { spine: [10, 0, 0], head: [8, 25, 0] }) },
  ]);
  const up: Pose = pose(STANCE, { spine: [-4, 0, 0], head: [-6, 0, 0], "upper_arm.L": [-168, 0, 28], "upper_arm.R": [-168, 0, -28], "forearm.L": [-28, 0, 0], "forearm.R": [-28, 0, 0] });
  add("hands_up", [
    { t: 0, pose: still },
    { t: 0.25, pose: up },
    { t: 0.9, pose: pose(up, { head: [-4, 10, 0] }) },
    { t: 1.6, pose: pose(up, { head: [-6, -8, 0] }) },
  ]);
  const flapA: Pose = pose(STANCE, { spine: [8, 0, 0], "upper_arm.L": [-150, 0, 40], "upper_arm.R": [-60, 0, -60], "forearm.L": [-40, 0, 0], "forearm.R": [-30, 0, 0], head: [0, 20, 0] });
  const flapB: Pose = pose(STANCE, { spine: [8, 0, 0], "upper_arm.L": [-60, 0, 60], "upper_arm.R": [-150, 0, -40], "forearm.L": [-30, 0, 0], "forearm.R": [-40, 0, 0], head: [0, -20, 0] });
  add("panic", [
    { t: 0, pose: flapA },
    { t: 0.25, pose: flapB },
    { t: 0.5, pose: flapA },
  ]);
  add("head_shake", [
    { t: 0, pose: still },
    { t: 0.2, pose: pose(still, { head: [4, 25, 0] }) },
    { t: 0.4, pose: pose(still, { head: [4, -25, 0] }) },
    { t: 0.6, pose: pose(still, { head: [4, 25, 0] }) },
    { t: 0.8, pose: pose(still, { head: [4, -25, 0] }) },
    { t: 1.0, pose: pose(still, { head: [4, 20, 0] }) },
    { t: 1.2, pose: still },
  ]);
  const waveA: Pose = pose(still, { "upper_arm.R": [-10, 0, -150], "forearm.R": [0, 0, 25] });
  const waveB: Pose = pose(still, { "upper_arm.R": [-10, 0, -150], "forearm.R": [0, 0, -25] });
  add("wave", [
    { t: 0, pose: waveA },
    { t: 0.3, pose: waveB },
    { t: 0.6, pose: waveA },
  ]);
  return clips;
}

export function chickenClips(bodyRest: [number, number, number]): AnimationClip[] {
  const clips: AnimationClip[] = [];
  const tracksFor = (name: string, keys: Key[]) => {
    const c = makeClip(name, keys, bodyRest, false);
    // The chicken's root bone is `body`, not `hips`.
    for (const t of c.tracks) if (t.name === "hips.position") t.name = "body.position";
    clips.push(c);
  };
  tracksFor("peck", [
    { t: 0, pose: { neck: [0, 0, 0], head: [0, 0, 0] } },
    { t: 0.25, pose: { neck: [75, 0, 0], head: [25, 0, 0], body: [18, 0, 0] } },
    { t: 0.35, pose: { neck: [60, 0, 0], head: [15, 0, 0], body: [15, 0, 0] } },
    { t: 0.45, pose: { neck: [78, 0, 0], head: [25, 0, 0], body: [18, 0, 0] } },
    { t: 0.7, pose: { neck: [0, 0, 0], head: [-10, 15, 0] } },
    { t: 1.1, pose: { neck: [0, 0, 0], head: [0, -15, 0] } },
  ]);
  tracksFor("walk", [
    { t: 0, pose: { "leg.L": [-30, 0, 0], "leg.R": [25, 0, 0], neck: [12, 0, 0] }, hips: [0, 0, 0] },
    { t: 0.25, pose: { "leg.L": [25, 0, 0], "leg.R": [-30, 0, 0], neck: [-8, 0, 0] }, hips: [0, 0.02, 0] },
    { t: 0.5, pose: { "leg.L": [-30, 0, 0], "leg.R": [25, 0, 0], neck: [12, 0, 0] }, hips: [0, 0, 0] },
  ]);
  tracksFor("run", [
    { t: 0, pose: { body: [15, 0, 0], neck: [35, 0, 0], "leg.L": [-50, 0, 0], "leg.R": [40, 0, 0], "wing.L": [0, 0, 35], "wing.R": [0, 0, -35] } },
    { t: 0.14, pose: { body: [15, 0, 0], neck: [30, 0, 0], "leg.L": [40, 0, 0], "leg.R": [-50, 0, 0], "wing.L": [0, 0, 55], "wing.R": [0, 0, -55] } },
    { t: 0.28, pose: { body: [15, 0, 0], neck: [35, 0, 0], "leg.L": [-50, 0, 0], "leg.R": [40, 0, 0], "wing.L": [0, 0, 35], "wing.R": [0, 0, -35] } },
  ]);
  tracksFor("flutter", [
    { t: 0, pose: { body: [-20, 0, 0], "wing.L": [0, 0, 10], "wing.R": [0, 0, -10] }, hips: [0, 0, 0] },
    { t: 0.07, pose: { body: [-25, 0, 0], "wing.L": [0, 0, 95], "wing.R": [0, 0, -95] }, hips: [0, 0.15, 0] },
    { t: 0.14, pose: { body: [-20, 0, 0], "wing.L": [0, 0, 5], "wing.R": [0, 0, -5] }, hips: [0, 0.25, 0] },
    { t: 0.21, pose: { body: [-25, 0, 0], "wing.L": [0, 0, 95], "wing.R": [0, 0, -95] }, hips: [0, 0.3, 0] },
    { t: 0.28, pose: { body: [-20, 0, 0], "wing.L": [0, 0, 5], "wing.R": [0, 0, -5] }, hips: [0, 0.22, 0] },
    { t: 0.35, pose: { body: [-15, 0, 0], "wing.L": [0, 0, 80], "wing.R": [0, 0, -80] }, hips: [0, 0.1, 0] },
    { t: 0.45, pose: { body: [0, 0, 0], "wing.L": [0, 0, 0], "wing.R": [0, 0, 0] }, hips: [0, 0, 0] },
  ]);
  return clips;
}
