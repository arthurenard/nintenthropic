/**
 * Skinned glTF characters at run time: one template per file, cloned into a
 * fixed pool of rigs at load (nothing is cloned mid-game), each with its own
 * mixer and materials, playing the file's clips with crossfades, dressed from
 * its variation meshes, holding one of its props, and bent by a few
 * procedural layers on top of the clips (a pitch toward what it aims at, a
 * twist when hit, a kick when it fires).
 *
 * The asset contract (docs/WEB_ARCHITECTURE.md, "Characters") is shared by
 * every game: a humanoid armature with the bones `hips`, `spine`, `chest`,
 * `neck`, `head`, `upper_arm.L/R`, `forearm.L/R`, `hand.L/R`, `thigh.L/R`,
 * `shin.L/R`, `foot.L/R`; variation meshes `var.<part>.<name>`; props
 * `gun.<name>` and `prop.<name>`; empties `socket.<name>` where things are
 * held or fired from; clips in place. A non-humanoid (High Noon's chicken)
 * plays its clips all the same; the humanoid layers simply find no bones.
 */
import {
  AnimationMixer,
  Color,
  Group,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  ShaderChunk,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { LoadedAsset } from "../types";
import { contractName } from "./names";

/**
 * The light that rims every figure: the bright sky (or a moon, or a station's
 * lamps) catching the edges of a figure as they turn away from the eye. It
 * keeps a figure in shade from sinking into the shaded wall behind it, and
 * one in the light from dissolving into a lit one: a soft falloff at the
 * silhouette, coloured by the figure's own clothes, stronger where the edge
 * faces up. One uniform shared by every rig that should match; a game sets
 * its colour to its light (black for none).
 */
export interface RimLight {
  value: Color;
}

export function rimLight(color: Color = new Color(0, 0, 0)): RimLight {
  return { value: color };
}

export interface CharacterTemplate {
  /** The game's name for the kind ("bandit", "zombie"). */
  kind: string;
  scene: Object3D;
  clips: Map<string, AnimationClip>;
  /** When the file lacks a clip, what to play instead, in order; "idle" after those. */
  fallbacks: Readonly<Record<string, readonly string[]>>;
  rim: RimLight;
}

export interface TemplateOptions {
  fallbacks?: Readonly<Record<string, readonly string[]>>;
  rim?: RimLight;
}

/** A rim that adds nothing, for templates that ask for none. */
const NO_RIM: RimLight = rimLight();

/**
 * A template from a loaded file. `extraClips` are borrowed from another file
 * on the same armature (High Noon's townsfolk borrow the gang's hit
 * reactions and falls); the file's own clips win over them.
 */
export function templateFrom(kind: string, asset: LoadedAsset, extraClips: readonly AnimationClip[] = [], options: TemplateOptions = {}): CharacterTemplate {
  const clips = new Map<string, AnimationClip>();
  for (const c of extraClips) clips.set(c.name, c);
  for (const c of asset.animations) clips.set(c.name, c);
  return { kind, scene: asset.scene, clips, fallbacks: options.fallbacks ?? {}, rim: options.rim ?? NO_RIM };
}

/** Every rig's materials compile to one shader program. */
const PATCH_KEY = "handy-rig";

/** What each rig's shader reads besides the scene's lights. */
export interface RigLighting {
  /**
   * How much of the directional (key) light reaches it, 0..1. A world whose
   * lighting is baked cannot cast its own shadows onto characters in the
   * usual way: the game decides instead (High Noon casts a ray toward the
   * sun) and eases this toward the answer.
   */
  key: { value: number };
  /** An overall shade, 0..1: a figure seen as a dark shape moving in an unlit room. */
  shade: { value: number };
}

/** The line of three's lights chunk where each directional light's colour is known. */
const DIRECTIONAL_LIGHT_LINE = "getDirectionalLightInfo( directionalLight, directLight );";

/**
 * A rig's fragment shader with the key light's reach, the shade and the
 * template's rim light in it. The key light's line lives in three's
 * `lights_fragment_begin` chunk, which is still an `#include` when
 * onBeforeCompile runs, so the chunk is expanded here to reach the line
 * (looking for it in the unexpanded source finds nothing, and the key light
 * silently never applies).
 */
export function patchRigFragment(source: string): string {
  const lights = ShaderChunk.lights_fragment_begin;
  if (!lights.includes(DIRECTIONAL_LIGHT_LINE)) throw new Error("three's lights chunk no longer has the directional light line the rig patch needs");
  return source
    .replace("#include <common>", "#include <common>\nuniform float uKeyLight;\nuniform float uShade;\nuniform vec3 uRim;")
    .replace("#include <lights_fragment_begin>", lights.replace(DIRECTIONAL_LIGHT_LINE, `${DIRECTIONAL_LIGHT_LINE}\n\t\tdirectLight.color *= uKeyLight;`))
    .replace(
      "#include <opaque_fragment>",
      [
        "{",
        "\tfloat facing = saturate( dot( geometryNormal, geometryViewDir ) );",
        "\tfloat rim = pow( 1.0 - facing, 3.0 ) * ( 0.55 + 0.45 * geometryNormal.y );",
        "\t#ifdef USE_AOMAP",
        "\trim *= ambientOcclusion;",
        "\t#endif",
        "\toutgoingLight += material.diffuseColor * uRim * rim;",
        "}",
        "outgoingLight *= uShade;",
        "#include <opaque_fragment>",
      ].join("\n"),
    );
}

/**
 * Each rig's materials get the key light's reach and the shade, and the
 * template's rim light. Patched once, one shader program for every rig.
 */
function patchMaterial(m: Material, lighting: RigLighting, rim: RimLight): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms["uKeyLight"] = lighting.key;
    shader.uniforms["uShade"] = lighting.shade;
    shader.uniforms["uRim"] = rim;
    shader.fragmentShader = patchRigFragment(shader.fragmentShader);
  };
  m.customProgramCacheKey = () => PATCH_KEY;
}

const tmpColor = new Color();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const UP = new Vector3(0, 1, 0);
const LEFT = new Vector3();
const UPW = new Vector3();
const bendAxis = new Vector3();
const bendQ = new Quaternion();
const boneQ = new Quaternion();

/** Rotate a bone by `angle` about a world-space axis, whatever its own frame. */
function bend(bone: Object3D, worldAxis: Vector3, angle: number): void {
  bone.getWorldQuaternion(boneQ);
  bendAxis.copy(worldAxis).applyQuaternion(boneQ.invert());
  bone.quaternion.multiply(bendQ.setFromAxisAngle(bendAxis, angle));
}

/** The joints a shot is tested against, in world space, refreshed on demand. */
export class Joints {
  readonly head = new Vector3();
  readonly hips = new Vector3();
  readonly neck = new Vector3();
  readonly shoulderL = new Vector3();
  readonly shoulderR = new Vector3();
  readonly elbowL = new Vector3();
  readonly elbowR = new Vector3();
  readonly handL = new Vector3();
  readonly handR = new Vector3();
  readonly thighL = new Vector3();
  readonly thighR = new Vector3();
  readonly kneeL = new Vector3();
  readonly kneeR = new Vector3();
  readonly footL = new Vector3();
  readonly footR = new Vector3();
}

/** Is this node a prop a character holds (the contract's `gun.*` and `prop.*`)? */
const isProp = (name: string) => name.startsWith("gun.") || name.startsWith("prop.");

/**
 * One character on stage: a clone of a template with its own mixer,
 * materials and procedural layers (aim, hit twist, recoil) on top of the
 * clips. Rigs are made at load and pooled; nothing is cloned mid-game.
 */
export class Rig {
  readonly root = new Group();
  readonly model: Object3D;
  readonly mixer: AnimationMixer;
  readonly kind: string;
  readonly bones = new Map<string, Object3D>();
  /** Variation meshes, by full name (`var.hat.stetson`). */
  readonly vars = new Map<string, Object3D>();
  /** Props, by full name (`gun.revolver`, `prop.dynamite`). */
  readonly props = new Map<string, Object3D>();
  /** Sockets, by full name (`socket.gun`). */
  readonly sockets = new Map<string, Object3D>();
  readonly joints = new Joints();
  readonly lighting: RigLighting = { key: { value: 1 }, shade: { value: 1 } };
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseColors: number[] = [];
  private readonly actions = new Map<string, AnimationAction>();
  private readonly clips: Map<string, AnimationClip>;
  private readonly fallbacks: Readonly<Record<string, readonly string[]>>;
  current: AnimationAction | null = null;
  currentName = "";
  inUse = false;
  /** Borrowed by a dev harness's pose gallery. */
  userDataGallery = false;
  /** Procedural: twist from a hit, kick from firing, pitch toward the target. */
  private twist = 0;
  private twistVel = 0;
  private recoil = 0;
  aimWeight = 0;
  private aimWeightTarget = 0;
  readonly aimTarget = new Vector3();
  /** How high the chest is above the feet, metres: where the aim pitches from. */
  chestHeight = 1.35;
  opacity = 1;
  /**
   * The bones the procedural layers bend, and their pose before bending. A
   * clip that has no track for one of them would otherwise leave last
   * frame's bend in place and let it accumulate.
   */
  private readonly bent: Object3D[] = [];
  private readonly bentBase: Quaternion[] = [];

  constructor(template: CharacterTemplate) {
    this.kind = template.kind;
    this.clips = template.clips;
    this.fallbacks = template.fallbacks;
    this.model = cloneSkinned(template.scene);
    this.root.add(this.model);
    this.mixer = new AnimationMixer(this.model);
    this.model.traverse((o) => {
      const name = contractName(o);
      if ((o as { isBone?: boolean }).isBone) this.bones.set(name, o);
      if (name.startsWith("var.")) this.vars.set(name, o);
      if (isProp(name) && !this.props.has(name)) this.props.set(name, o);
      if (name.startsWith("socket.") && !this.sockets.has(name)) this.sockets.set(name, o);
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = src.map((m) => {
          const c = m.clone() as MeshStandardMaterial;
          c.transparent = true;
          c.depthWrite = true;
          patchMaterial(c, this.lighting, template.rim);
          this.materials.push(c);
          this.baseColors.push(c.color ? c.color.getHex() : 0xffffff);
          return c;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : (cloned[0] as Material);
      }
    });
    for (const name of ["spine", "chest", "upper_arm.R"]) {
      const b = this.bones.get(name);
      if (b) {
        this.bent.push(b);
        this.bentBase.push(b.quaternion.clone());
      }
    }
    this.root.visible = false;
  }

  bone(name: string): Object3D | undefined {
    return this.bones.get(name);
  }

  /** A prop by its full name (`gun.rifle`), or null if the file has none. */
  prop(name: string): Object3D | null {
    return this.props.get(name) ?? null;
  }

  /** A socket by its full name (`socket.gun`), or null. */
  socket(name: string): Object3D | null {
    return this.sockets.get(name) ?? null;
  }

  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  /** Length in seconds of the clip that would play for `name` (after fallbacks). */
  duration(name: string): number {
    return this.resolve(name)?.duration ?? 1;
  }

  private resolve(name: string): AnimationClip | null {
    const direct = this.clips.get(name);
    if (direct) return direct;
    for (const alt of this.fallbacks[name] ?? []) {
      const c = this.clips.get(alt);
      if (c) return c;
    }
    return this.clips.get("idle") ?? null;
  }

  /** Crossfade to a clip. One-shots hold their last frame. */
  play(name: string, fade = 0.15, loop = true, timeScale = 1, restart = true): void {
    if (!restart && this.currentName === name) return;
    const clip = this.resolve(name);
    if (!clip) return;
    let action = this.actions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
    const prev = this.current;
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = timeScale;
    action.setEffectiveWeight(1);
    action.play();
    if (prev && prev !== action && fade > 0) action.crossFadeFrom(prev, fade, false);
    else if (prev && prev !== action) prev.stop();
    this.current = action;
    this.currentName = name;
  }

  /** Show exactly these variation meshes (by full name); hide the rest. */
  dress(names: readonly string[]): void {
    for (const [name, o] of this.vars) o.visible = names.includes(name);
  }

  /** The variation now worn whose name starts with `prefix` (`var.hat.`), if any. */
  worn(prefix: string): Object3D | null {
    for (const [name, o] of this.vars) if (o.visible && name.startsWith(prefix)) return o;
    return null;
  }

  /** Hold this prop (by full name) and none of the others; null for empty hands. */
  hold(name: string | null): void {
    for (const [prop, o] of this.props) o.visible = prop === name;
  }

  /** A per-rig tint over the clothes, for variety in a crowd. */
  tint(r: number, g: number, b: number): void {
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i] as MeshStandardMaterial;
      if (!m.color || m.metalness > 0.5) continue;
      m.color.setHex(this.baseColors[i] as number).multiply(tmpColor.setRGB(r, g, b));
    }
  }

  setOpacity(a: number): void {
    if (Math.abs(a - this.opacity) < 1e-3) return;
    this.opacity = a;
    for (const m of this.materials) m.opacity = a;
  }

  /** Aim the chest at a point (the player's eye) with weight 0..1, eased. */
  aimAt(target: Vector3 | null, weight: number): void {
    if (target) this.aimTarget.copy(target);
    this.aimWeightTarget = weight;
  }

  /** Hit from one side (-1 left, +1 right, as the rig faces): a twist that springs back. */
  hitReact(side: number, strength: number): void {
    this.twistVel += side * 9 * strength;
  }

  /** It fires: the arm and chest kick. */
  kick(): void {
    this.recoil = 1;
  }

  update(dt: number): void {
    for (let i = 0; i < this.bent.length; i++) (this.bent[i] as Object3D).quaternion.copy(this.bentBase[i] as Quaternion);
    this.mixer.update(dt);
    for (let i = 0; i < this.bent.length; i++) (this.bentBase[i] as Quaternion).copy((this.bent[i] as Object3D).quaternion);
    // Spring for the hit twist: fast, a little overshoot, gone in half a second.
    const k = 160;
    const c = 14;
    this.twistVel += (-k * this.twist - c * this.twistVel) * dt;
    this.twist += this.twistVel * dt;
    this.recoil *= Math.exp(-dt / 0.06);
    this.aimWeight += (this.aimWeightTarget - this.aimWeight) * Math.min(1, dt * 8);
    const chest = this.bones.get("chest");
    const spine = this.bones.get("spine");
    const arm = this.bones.get("upper_arm.R");
    const aiming = chest && this.aimWeight > 0.01;
    const twisting = Math.abs(this.twist) > 1e-4;
    const kicking = this.recoil > 0.01;
    if (!aiming && !twisting && !kicking) return;
    // Bends are made about the character's own axes (its left, and up), carried
    // into each bone's frame: a Blender bone points along its local +Y with
    // whatever roll the rigger gave it, so its local X is not "the side".
    this.root.getWorldQuaternion(tmpQ);
    LEFT.set(1, 0, 0).applyQuaternion(tmpQ);
    UPW.set(0, 1, 0).applyQuaternion(tmpQ);
    if (aiming && chest) {
      // Pitch the chest toward the target, measured in the rig's own frame.
      this.root.updateMatrixWorld();
      tmpV.copy(this.aimTarget);
      this.root.worldToLocal(tmpV);
      const horiz = Math.hypot(tmpV.x, tmpV.z);
      const pitch = Math.atan2(tmpV.y - this.chestHeight, Math.max(0.5, horiz));
      bend(chest, LEFT, -pitch * this.aimWeight * 0.85);
    }
    if (twisting) {
      if (spine) bend(spine, UPW, this.twist * 0.4);
      if (chest) {
        bend(chest, UPW, this.twist * 0.8);
        bend(chest, LEFT, -Math.abs(this.twist) * 0.35);
      }
    }
    if (kicking) {
      if (arm) bend(arm, LEFT, -this.recoil * 0.25);
      if (chest) bend(chest, LEFT, -this.recoil * 0.05);
    }
  }

  /** Refresh the world positions of the joints (after the last render's matrices). */
  updateJoints(): Joints {
    const j = this.joints;
    const get = (name: string, out: Vector3) => {
      const b = this.bones.get(name);
      if (b) b.getWorldPosition(out);
      return b;
    };
    const head = get("head", j.head);
    if (head) {
      // The head's centre sits a little above its bone, along the head's up.
      tmpQ.setFromRotationMatrix(tmpM.extractRotation(head.matrixWorld));
      tmpV2.copy(UP).applyQuaternion(tmpQ);
      j.head.addScaledVector(tmpV2, 0.09);
    }
    get("hips", j.hips);
    get("neck", j.neck);
    get("upper_arm.L", j.shoulderL);
    get("upper_arm.R", j.shoulderR);
    get("forearm.L", j.elbowL);
    get("forearm.R", j.elbowR);
    get("hand.L", j.handL);
    get("hand.R", j.handR);
    get("thigh.L", j.thighL);
    get("thigh.R", j.thighR);
    get("shin.L", j.kneeL);
    get("shin.R", j.kneeR);
    get("foot.L", j.footL);
    get("foot.R", j.footR);
    return j;
  }

  /** Put the props back and stand the rig up for its next use. */
  reset(): void {
    this.mixer.stopAllAction();
    this.current = null;
    this.currentName = "";
    this.twist = this.twistVel = this.recoil = 0;
    this.aimWeight = this.aimWeightTarget = 0;
    this.lighting.key.value = 1;
    this.lighting.shade.value = 1;
    this.setOpacity(1);
    this.root.visible = false;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.materials) m.dispose();
    this.model.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) (o as SkinnedMesh).skeleton?.dispose();
    });
  }
}

/** A fixed set of rigs for one kind of character. */
export class RigPool {
  readonly rigs: Rig[] = [];
  constructor(template: CharacterTemplate, count: number, parent: Object3D) {
    for (let i = 0; i < count; i++) {
      const r = new Rig(template);
      parent.add(r.root);
      this.rigs.push(r);
    }
  }

  take(): Rig | null {
    for (const r of this.rigs) {
      if (!r.inUse) {
        r.inUse = true;
        return r;
      }
    }
    return null;
  }

  give(r: Rig): void {
    r.reset();
    r.inUse = false;
    r.userDataGallery = false;
  }

  dispose(): void {
    for (const r of this.rigs) r.dispose();
  }
}

/**
 * Turn a rig about the vertical toward a heading (radians, 0 facing +Z),
 * the short way round, easing over about a twelfth of a second.
 */
export function turnRig(rig: Rig, heading: number, dt: number): void {
  let d = heading - rig.root.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  rig.root.rotation.y += d * Math.min(1, dt * 12);
}

/** The heading (radians about the vertical) from (x, z) toward a point. */
export function headingTo(x: number, z: number, target: { x: number; z: number }): number {
  return Math.atan2(target.x - x, target.z - z);
}
