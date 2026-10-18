/**
 * Clips made in code from a few key poses, the way the characters' Blender
 * actions arrive, for the placeholders that stand in for the art during
 * development: a quaternion track per bone, named with the glTF loader's
 * sanitised node names, the root bone's translation, and any scale.
 */
import { AnimationClip, Euler, InterpolateSmooth, PropertyBinding, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack, type KeyframeTrack } from "three";

/** Bone rotations in degrees, applied yaw (Y), then pitch (X), then roll (Z). */
export type Pose = Record<string, [number, number, number]>;

/** One key of a clip. Bones its pose leaves out are at rest in it. */
export interface ClipKey {
  t: number;
  pose: Pose;
  /** Offset of the root bone (the hips; an animal's body) from where it rests, metres. */
  root?: [number, number, number];
  /** Bones scaled at this key; any other scaled bone is at 1 in it. */
  scale?: Record<string, [number, number, number]>;
}

export interface ClipOptions {
  /** The bone that carries the translation (the hips; an animal's body). */
  root: string;
  /** Where that bone rests. */
  rest: [number, number, number];
  /**
   * Bones given a track in every clip whether a key names them or not, at
   * rest where not, as a Blender action keyed on the whole armature is; a
   * crossfade then always has both ends to blend.
   */
  bones?: readonly string[];
}

const DEG = Math.PI / 180;
const euler = new Euler();

/** A rotation in degrees (yaw, then pitch, then roll) as a quaternion, into `out`. */
export function quatOf(r: [number, number, number], out = new Quaternion()): Quaternion {
  return out.setFromEuler(euler.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, "YXZ"));
}

/** Merge poses: later ones win, bone by bone. */
export function pose(...parts: Pose[]): Pose {
  return Object.assign({}, ...parts) as Pose;
}

/** Mirror a pose left to right (for leaning, or stepping, the other way). */
export function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [bone, [x, y, z]] of Object.entries(p)) {
    const other = bone.endsWith(".L") ? bone.slice(0, -2) + ".R" : bone.endsWith(".R") ? bone.slice(0, -2) + ".L" : bone;
    out[other] = [x, -y, -z];
  }
  return out;
}

/** A clip from its keys. With `smooth`, a clip of more than two keys moves its root through them on a curve. */
export function makeClip(name: string, keys: readonly ClipKey[], o: ClipOptions, smooth = true): AnimationClip {
  const bones = new Set<string>(o.bones ?? []);
  const scaled = new Set<string>();
  for (const k of keys) {
    for (const b of Object.keys(k.pose)) bones.add(b);
    for (const b of Object.keys(k.scale ?? {})) scaled.add(b);
  }
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
  for (const bone of scaled) {
    const values: number[] = [];
    for (const k of keys) values.push(...(k.scale?.[bone] ?? [1, 1, 1]));
    tracks.push(new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(bone)}.scale`, times, values));
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
