/**
 * High Noon's people, as the engine's character runtime
 * (engine/world/character.ts) plays them: the four kinds, what each clip
 * falls back to when a file lacks it, and the street's rim light.
 */
import { Color, type AnimationClip, type Mesh, type Object3D } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { rimLight, templateFrom, type CharacterTemplate } from "../../../engine/world/character";

export type CharacterKind = "bandit" | "boss" | "townsfolk" | "chicken";

/** When a file lacks a clip, what to play instead. */
export const CLIP_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  hidden: ["idle"],
  sink: ["hidden", "idle"],
  rise: ["aim", "idle"],
  step_out: ["aim", "idle"],
  step_in: ["idle"],
  lean_left_out: ["aim"],
  lean_right_out: ["aim"],
  lean_left_in: ["idle"],
  lean_right_in: ["idle"],
  aim: ["idle"],
  fire: ["aim", "idle"],
  run: ["idle"],
  throw: ["fire", "aim"],
  hit_body: ["idle"],
  hit_head: ["hit_body", "idle"],
  death_back: ["death_forward", "idle"],
  death_forward: ["death_back", "idle"],
  death_fall: ["death_forward", "death_back"],
  death_slump: ["death_forward", "death_back"],
  peek: ["idle"],
  hands_up: ["idle"],
  panic: ["hands_up", "idle"],
  head_shake: ["idle"],
  wave: ["idle"],
  walk: ["run", "idle"],
  peck: ["idle", "walk"],
  flutter: ["run", "walk"],
};

/**
 * The light that rims every figure in the street: the bright sky and the
 * sunlit dust all round a man catching the edges of his hat, shoulders and
 * sleeves as they turn away from you. It keeps a figure in the shade from
 * sinking into the shaded facade behind him, and one in the sun from
 * dissolving into the sunlit boards. Warm at golden hour, whiter at noon.
 */
export function streetRim(noon: boolean) {
  return rimLight(noon ? new Color(0.85, 0.85, 0.82) : new Color(0.95, 0.8, 0.64));
}

/** A kind's template, with High Noon's fallbacks and the street's rim. */
export function highNoonTemplate(kind: CharacterKind, asset: LoadedAsset, rim: ReturnType<typeof streetRim>, extraClips: readonly AnimationClip[] = []): CharacterTemplate {
  singlePass(asset.scene);
  return templateFrom(kind, asset, extraClips, { fallbacks: CLIP_FALLBACKS, rim });
}

/**
 * Every rig is drawn see-through, so a body can fade away, and three draws a
 * see-through double-sided material twice - its back faces, then its front -
 * flipping its side and looking its shader up again for each: twice the
 * skinning, and a lookup's worth of garbage, for every figure every frame.
 * Opaque in play, one pass looks the same. The rigs' own materials are
 * cloned from these, flag and all.
 */
export function singlePass(scene: Object3D): void {
  scene.traverse((o) => {
    const m = (o as Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.forceSinglePass = true;
  });
}
