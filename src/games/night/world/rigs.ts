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
import { GAIT_SPEED } from "../rules/tuning";
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
 * feet do not slide. The art's clips are made for these; a file says so
 * itself in its scene's extras (clipSpeeds), which win.
 */
export const CLIP_SPEED: Readonly<Record<string, number>> = {
  // The walking gaits: the rules' own table (GAIT_SPEED), which a test holds to the art.
  ...GAIT_SPEED,
  run: 3.5,
  crawl: 0.5,
  run_lantern: 4.4,
  walk: 0.6,
};

/** The gaits from the slowest to the fastest, then the run: the order one of the dead moves up through as it goes faster. */
export const GAIT_LADDER: readonly string[] = ["walk.drag", "walk.limp", "walk.shamble", "walk.lurch", "run"];

/**
 * The most a clip is played faster than it was made (a clip's timeScale is
 * the pace the dead walk at over the speed it was made for, so the feet never
 * slide): past this the steps blur, and the dead take a faster gait instead.
 */
export const MAX_PLAYBACK = 1.8;

/**
 * The gait to play for one of the dead walking at `pace`, metres per second,
 * from the one it has now on up the ladder: the same while its clip would be
 * played no faster than MAX_PLAYBACK times what it was made for, a faster one
 * (a drag becomes a limp, a limp a shamble, a shamble a lurch, and a lurch a
 * run) once it would. It never goes back down, so a pace that wavers about a
 * line does not flicker between two gaits; a gait not on the ladder (the
 * crawl) stays as it is. `speeds` are the file's own (clipSpeeds).
 */
export function gaitForPace(current: string, pace: number, speeds: Readonly<Record<string, number>>): string {
  let i = GAIT_LADDER.indexOf(current);
  if (i < 0) return current;
  while (i < GAIT_LADDER.length - 1 && pace / (speeds[GAIT_LADDER[i] as string] ?? 1) > MAX_PLAYBACK) i++;
  return GAIT_LADDER[i] as string;
}

/**
 * The ground speeds a character file's clips were made for: its scene's
 * `extras.clips.<clip>.speed_mps` over CLIP_SPEED, times the file's
 * `extras.scale` (the Mechanic is 1.15 times a walker, on the same clips:
 * a longer stride covers more ground).
 */
export function clipSpeeds(asset: LoadedAsset): Record<string, number> {
  const out: Record<string, number> = { ...CLIP_SPEED };
  const extras = asset.scene.userData as { clips?: Record<string, { speed_mps?: unknown }>; scale?: unknown };
  for (const [clip, meta] of Object.entries(extras.clips ?? {})) {
    if (typeof meta?.speed_mps === "number" && meta.speed_mps > 0) out[clip] = meta.speed_mps;
  }
  const scale = typeof extras.scale === "number" && extras.scale > 0 ? extras.scale : 1;
  for (const clip of Object.keys(out)) out[clip] = (out[clip] as number) * scale;
  return out;
}

/** Seconds into `bloat_burst` where the belly goes: the file says (`extras.clips.bloat_burst.burst_s`), or 1.32. */
export function burstMoment(asset: LoadedAsset): number {
  const clips = asset.scene.userData["clips"] as Record<string, { burst_s?: unknown }> | undefined;
  const at = clips?.["bloat_burst"]?.burst_s;
  return typeof at === "number" && at > 0 ? at : 1.32;
}

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
 * Dress a rig as one of the dead. A file may carry a whole person per kind
 * (`char.runner`, `char.bloater`, `char.crawler`: each in its own clothes
 * and hair, worn as they are) or a variant over the walker's body
 * (`var.crawler`, `var.bloater`); either works. A walker (and one of the
 * others made from the walker's body) wears one of the six outfits and,
 * mostly, one of the hair pieces - under the trucker's and the hunter's
 * caps only short hair, or none. Runners come in packs late in the night:
 * half of them are the runner, half a walker's body dressed as a walker,
 * so a pack is not one man four times.
 */
export function dressDead(rig: Rig, kind: DeadKind, random: () => number): void {
  const all = bodies(rig);
  const own = kind === "walker" || (kind === "runner" && all.has("char.walker") && random() < 0.5) ? undefined : all.get(`char.${kind}`);
  const body = own ?? all.get("char.walker") ?? null;
  for (const [, o] of all) o.visible = o === body;
  const vars: string[] = [];
  if (kind === "mechanic") {
    if (rig.vars.has("var.mask")) vars.push("var.mask");
  } else if (!own) {
    if (rig.vars.has(`var.${kind}`)) vars.push(`var.${kind}`);
    const outfits = kind === "bloater" ? [] : OUTFITS.filter((o) => rig.vars.has(o));
    const outfit = outfits.length ? (outfits[Math.floor(random() * outfits.length)] as string) : null;
    if (outfit) vars.push(outfit);
    const capped = outfit === "var.outfit.trucker" || outfit === "var.outfit.hunter";
    const hair = [...rig.vars.keys()].filter((n) => n.startsWith("var.hair.") && (!capped || n === "var.hair.short"));
    if (hair.length && random() < 0.8) vars.push(hair[Math.floor(random() * hair.length)] as string);
  }
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

/** The shine's colour, for eyes that do not paint their own. */
const SHINE = new Color(0.55, 0.75, 0.38);

/**
 * The eyes themselves, shining back: up close they are more than a point.
 * The art paints the shine in the eyes' emissive map (sickly green-gold
 * over the iris) and leaves its strength to the game: 0 in the dark, about
 * 3 in the beam's centre. Eyes without such a map (the placeholders') glow
 * in the shine's own colour instead.
 */
export function shineEyes(mat: MeshStandardMaterial, shine: number): void {
  if (mat.emissiveMap) {
    mat.emissive.setRGB(1, 1, 1);
    mat.emissiveIntensity = Math.min(3, shine * 2.5);
  } else {
    mat.emissive.copy(SHINE).multiplyScalar(shine * 1.4);
  }
}

/** The eyes at rest: dark. */
export function darkEyes(mat: MeshStandardMaterial | null): MeshStandardMaterial | null {
  if (mat) shineEyes(mat, 0);
  return mat;
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
