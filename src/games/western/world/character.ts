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
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { LoadedAsset } from "../../../engine/types";
import { contractName } from "./names";

export type CharacterKind = "bandit" | "boss" | "townsfolk" | "chicken";

export interface CharacterTemplate {
  kind: CharacterKind;
  scene: Object3D;
  clips: Map<string, AnimationClip>;
}

/** When a file lacks a clip, what to play instead. */
const FALLBACK: Record<string, string[]> = {
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

export function templateFrom(kind: CharacterKind, asset: LoadedAsset, extraClips: AnimationClip[] = []): CharacterTemplate {
  const clips = new Map<string, AnimationClip>();
  // Shared armature: townsfolk borrow the gang's hit reactions and falls.
  for (const c of extraClips) clips.set(c.name, c);
  for (const c of asset.animations) clips.set(c.name, c);
  return { kind, scene: asset.scene, clips };
}

const PATCH_KEY = "highnoon-rig";

/**
 * Each rig's materials get two uniforms: how much sun reaches it (the town
 * is baked, so the town's shadows cannot fall on characters in the usual way —
 * a ray toward the sun decides instead), and an overall shade (a tell seen
 * as a dark shape moving in an unlit room). Patched once, one shader program
 * for every rig.
 */
function patchMaterial(m: Material, uniforms: { uSunVis: { value: number }; uShade: { value: number } }): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms["uSunVis"] = uniforms.uSunVis;
    shader.uniforms["uShade"] = uniforms.uShade;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSunVis;\nuniform float uShade;")
      .replace(
        "getDirectionalLightInfo( directionalLight, directLight );",
        "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uSunVis;",
      )
      .replace("#include <opaque_fragment>", "outgoingLight *= uShade;\n#include <opaque_fragment>");
  };
  m.customProgramCacheKey = () => PATCH_KEY;
}

const tmpColor = new Color();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const UP = new Vector3(0, 1, 0);

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

/**
 * One character on stage: a clone of a template with its own mixer,
 * materials and procedural layers (aim, hit twist, recoil) on top of the
 * clips. Rigs are made at load and pooled; nothing is cloned mid-game.
 */
export class Rig {
  readonly root = new Group();
  readonly model: Object3D;
  readonly mixer: AnimationMixer;
  readonly kind: CharacterKind;
  readonly bones = new Map<string, Object3D>();
  readonly vars = new Map<string, Object3D>();
  readonly socket: Object3D | null;
  readonly revolver: Object3D | null;
  readonly rifle: Object3D | null;
  readonly dynamite: Object3D | null;
  readonly joints = new Joints();
  readonly uniforms = { uSunVis: { value: 1 }, uShade: { value: 1 } };
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseColors: number[] = [];
  private readonly actions = new Map<string, AnimationAction>();
  private readonly clips: Map<string, AnimationClip>;
  current: AnimationAction | null = null;
  currentName = "";
  inUse = false;
  /** Procedural: twist from a hit, kick from firing, pitch toward the target. */
  private twist = 0;
  private twistVel = 0;
  private recoil = 0;
  aimWeight = 0;
  private aimWeightTarget = 0;
  readonly aimTarget = new Vector3();
  opacity = 1;
  private hatOn: Object3D | null = null;
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
    this.model = cloneSkinned(template.scene);
    this.root.add(this.model);
    this.mixer = new AnimationMixer(this.model);
    this.model.traverse((o) => {
      const name = contractName(o);
      if ((o as { isBone?: boolean }).isBone) this.bones.set(name, o);
      if (name.startsWith("var.")) this.vars.set(name, o);
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
          patchMaterial(c, this.uniforms);
          this.materials.push(c);
          this.baseColors.push(c.color ? c.color.getHex() : 0xffffff);
          return c;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : (cloned[0] as Material);
      }
    });
    this.socket = this.findByName("socket.gun");
    this.revolver = this.findByName("gun.revolver");
    this.rifle = this.findByName("gun.rifle");
    this.dynamite = this.findByName("prop.dynamite");
    for (const name of ["spine", "chest", "upper_arm.R"]) {
      const b = this.bones.get(name);
      if (b) {
        this.bent.push(b);
        this.bentBase.push(b.quaternion.clone());
      }
    }
    this.root.visible = false;
  }

  private findByName(name: string): Object3D | null {
    let found: Object3D | null = null;
    this.model.traverse((o) => {
      if (!found && contractName(o) === name) found = o;
    });
    return found;
  }

  bone(name: string): Object3D | undefined {
    return this.bones.get(name);
  }

  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  private resolve(name: string): AnimationClip | null {
    const direct = this.clips.get(name);
    if (direct) return direct;
    for (const alt of FALLBACK[name] ?? []) {
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
    this.hatOn = null;
    for (const [name, o] of this.vars) {
      const on = names.includes(name);
      o.visible = on;
      if (on && name.startsWith("var.hat.")) this.hatOn = o;
    }
  }

  get hat(): Object3D | null {
    return this.hatOn;
  }

  /** Which prop is in the hand. */
  arm(prop: "revolver" | "rifle" | "dynamite" | "none"): void {
    if (this.revolver) this.revolver.visible = prop === "revolver";
    if (this.rifle) this.rifle.visible = prop === "rifle";
    if (this.dynamite) this.dynamite.visible = prop === "dynamite";
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

  hitReact(side: number, strength: number): void {
    this.twistVel += side * 9 * strength;
  }

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
    if (chest && this.aimWeight > 0.01) {
      // Pitch the chest toward the target, measured in the rig's own frame.
      this.root.updateMatrixWorld();
      tmpV.copy(this.aimTarget);
      this.root.worldToLocal(tmpV);
      const chestY = 1.35;
      const horiz = Math.hypot(tmpV.x, tmpV.z);
      const pitch = Math.atan2(tmpV.y - chestY, Math.max(0.5, horiz));
      chest.rotateX(-pitch * this.aimWeight * 0.85);
    }
    if (Math.abs(this.twist) > 1e-4) {
      spine?.rotateY(this.twist * 0.4);
      chest?.rotateY(this.twist * 0.8);
      chest?.rotateX(-Math.abs(this.twist) * 0.35);
    }
    if (this.recoil > 0.01) {
      this.bones.get("upper_arm.R")?.rotateX(-this.recoil * 0.25);
      chest?.rotateX(-this.recoil * 0.05);
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
    this.uniforms.uSunVis.value = 1;
    this.uniforms.uShade.value = 1;
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
  }

  dispose(): void {
    for (const r of this.rigs) r.dispose();
  }
}
