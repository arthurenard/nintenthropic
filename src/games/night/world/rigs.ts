/**
 * Dead of Night's people, as the engine's character runtime
 * (engine/world/character.ts) plays them: the dead, the Mechanic, the
 * survivors and the cat; what each clip falls back to when a file lacks
 * it; the pace each gait was made for; how a rig is dressed as one kind of
 * the dead or another; where its eyes are; and the night's rim light.
 */
import { Color, Matrix4, Mesh, Vector3, type AnimationClip, type Material, type MeshStandardMaterial, type Object3D } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { rimLight, templateFrom, type CharacterTemplate, type Rig } from "../../../engine/world/character";
import { contractName } from "../../../engine/world/names";
import type { DeadKind } from "../rules/types";

export type CharacterKind = "walker" | "mechanic" | "survivor" | "cat";

/** When a file lacks a clip, what to play instead ("idle" after these). */
export const CLIP_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  "walk.shamble": ["walk", "run"],
  "walk.limp": ["walk.shamble", "walk"],
  "walk.drag": ["walk.shamble", "walk"],
  "walk.lurch": ["walk.shamble", "walk"],
  run: ["walk.lurch", "walk.shamble"],
  lunge: ["claw", "run"],
  crawl: ["walk.drag"],
  claw: ["swing"],
  "claw.low": ["crawl", "claw"],
  stagger: ["hit_body", "hit_head"],
  hit_head: ["stagger", "hit_body"],
  death_back: ["death_forward", "death_crumple"],
  death_forward: ["death_back", "death_crumple"],
  death_crumple: ["death_forward", "death_back"],
  "death.low": ["death_crumple", "death_forward"],
  "idle.low": ["crawl", "idle"],
  "hit_head.low": ["hit_head", "stagger"],
  climb_out: ["walk.shamble"],
  vault: ["walk.shamble"],
  bloat_burst: ["death_crumple", "death_forward"],
  roar: ["claw"],
  mask_off: ["hit_head", "stagger"],
  swing: ["claw"],
  run_lantern: ["run"],
  duck: ["stumble"],
  stumble: ["run_lantern", "run"],
  wave: ["run"],
  sit: ["walk"],
  hiss: ["sit"],
  leap: ["walk"],
  walk: ["run"],
};

/**
 * The ground speed each gait was made for (metres per second): the game
 * plays a clip at the pace the rules walk it at, divided by this, so the
 * feet do not slide. The contract's clips are made for these.
 */
export const CLIP_SPEED: Readonly<Record<string, number>> = {
  "walk.shamble": 1.0,
  "walk.limp": 0.85,
  "walk.drag": 0.75,
  "walk.lurch": 1.1,
  run: 3.5,
  crawl: 0.45,
  run_lantern: 4.2,
  walk: 0.6,
};

/**
 * The night catching the edges of a figure: the fog's pale glow behind one
 * that has not reached the light, so a shape still reads against the dark.
 */
export function nightRim() {
  return rimLight(new Color(0.12, 0.15, 0.21));
}

export function nightTemplate(kind: CharacterKind, asset: LoadedAsset, rim: ReturnType<typeof nightRim>, extraClips: readonly AnimationClip[] = []): CharacterTemplate {
  return templateFrom(kind, asset, extraClips, { fallbacks: CLIP_FALLBACKS, rim });
}

/** Every body a walker file carries (`char.*`), by name. */
export function bodies(rig: Rig): Map<string, Object3D> {
  const out = new Map<string, Object3D>();
  rig.model.traverse((o) => {
    const n = contractName(o);
    if (n.startsWith("char.")) out.set(n, o);
  });
  return out;
}

export const OUTFITS = ["var.outfit.farmer", "var.outfit.trucker", "var.outfit.waitress", "var.outfit.hunter", "var.outfit.mechanic_small", "var.outfit.suit"] as const;

/**
 * Dress a rig as one of the dead. A file may carry a body per kind
 * (`char.crawler`, `char.bloater`: they come in their own rags) or a
 * variant over the walker's body (`var.crawler`, `var.bloater`); either
 * works. Walkers and runners wear one of the six outfits.
 */
export function dressDead(rig: Rig, kind: DeadKind, random: () => number): void {
  const all = bodies(rig);
  const own = all.get(`char.${kind}`);
  const body = own ?? all.get("char.walker") ?? null;
  for (const [, o] of all) o.visible = o === body;
  const vars: string[] = [];
  const hair = [...rig.vars.keys()].filter((n) => n.startsWith("var.hair."));
  if (hair.length && random() < 0.8) vars.push(hair[Math.floor(random() * hair.length)] as string);
  if (!own && rig.vars.has(`var.${kind}`)) vars.push(`var.${kind}`);
  if (kind === "walker" || kind === "runner" || (!own && kind !== "bloater")) {
    const outfits = OUTFITS.filter((o) => rig.vars.has(o));
    if (outfits.length) vars.push(outfits[Math.floor(random() * outfits.length)] as string);
  }
  if (kind === "runner" && rig.vars.has("var.runner")) vars.push("var.runner");
  if (kind === "mechanic" && rig.vars.has("var.mask")) vars.push("var.mask");
  rig.dress(vars);
  // The bloater's belly shows until it bursts.
  const belly = find(rig.model, "belly");
  if (belly) belly.visible = kind === "bloater";
  rig.hold(kind === "mechanic" ? "prop.tyre_iron" : null);
}

export function find(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((o) => {
    if (!found && contractName(o) === name) found = o;
  });
  return found;
}

/** Where a head's two eyes are, in the head bone's own frame. */
export interface EyeFrame {
  left: Vector3;
  right: Vector3;
}

const m = new Matrix4();
const v = new Vector3();

/**
 * The eyes' places on the head, measured once on a template at rest: the
 * `eyes` mesh's two halves (left and right of its middle), in the head
 * bone's frame, so every clip's head carries them. A file without an
 * `eyes` mesh gets a guess a hand's width above the head bone, forward.
 */
export function eyeFrame(scene: Object3D): EyeFrame {
  scene.updateMatrixWorld(true);
  const head = find(scene, "head");
  const eyes = find(scene, "eyes") as Mesh | null;
  const fallback: EyeFrame = { left: new Vector3(0.032, 0.07, 0.1), right: new Vector3(-0.032, 0.07, 0.1) };
  if (!head || !eyes || !eyes.isMesh) return fallback;
  const pos = eyes.geometry.getAttribute("position");
  if (!pos) return fallback;
  const toHead = m.copy(head.matrixWorld).invert();
  const l = new Vector3();
  const r = new Vector3();
  let nl = 0;
  let nr = 0;
  // The eyes' middle, to split them at.
  const mid = new Vector3();
  for (let i = 0; i < pos.count; i++) mid.add(v.fromBufferAttribute(pos, i).applyMatrix4(eyes.matrixWorld));
  mid.divideScalar(Math.max(1, pos.count));
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(eyes.matrixWorld);
    if (v.x >= mid.x) {
      l.add(v);
      nl++;
    } else {
      r.add(v);
      nr++;
    }
  }
  if (!nl || !nr) return fallback;
  return { left: l.divideScalar(nl).applyMatrix4(toHead), right: r.divideScalar(nr).applyMatrix4(toHead) };
}

/** The rig's own `eyes` material (cloned per rig by the engine), to make them shine up close. */
export function eyesMaterial(rig: Rig): MeshStandardMaterial | null {
  const eyes = find(rig.model, "eyes") as Mesh | null;
  if (!eyes || !eyes.isMesh) return null;
  const mat = (Array.isArray(eyes.material) ? eyes.material[0] : eyes.material) as Material | undefined;
  return (mat as MeshStandardMaterial | undefined)?.emissive ? (mat as MeshStandardMaterial) : null;
}

/** Every material a rig draws with, for the night's fog. */
export function rigMaterials(rig: Rig): Material[] {
  const out: Material[] = [];
  rig.model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) out.push(mat);
  });
  return out;
}
