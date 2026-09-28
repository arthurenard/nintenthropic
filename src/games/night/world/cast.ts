import { Color, Matrix4, Mesh, PointLight, SkinnedMesh, Vector3, type Material, type MeshStandardMaterial, type Object3D } from "three";
import type { V3 } from "../../../engine/rules/raymath";
import { headingTo, turnRig, type Rig, type RigPool } from "../../../engine/world/character";
import type { Sound } from "../../../engine/world/sound";
import { Tumblers } from "../../../engine/world/tumblers";
import type { Dead } from "../rules/dead";
import type { Match } from "../rules/match";
import type { Survivor } from "../rules/survivors";
import { CLIMB_TIME, LUNGE_TIME, STAGGER_TIME, VAULT_TIME, ATTACKS } from "../rules/tuning";
import type { DeathCause, HitPart } from "../rules/types";
import type { Effects } from "./effects";
import type { Eyeshine } from "./eyes";
import type { Flashlight } from "./flashlight";
import type { RoadQueries } from "./queries";
import { CLIP_SPEED, darkEyes, dressDead, eyeFrame, eyesMaterial, find, shineEyes, type EyeFrame } from "./rigs";
import type { NightUniforms } from "./shading";

/** The ground speeds each file's clips were made for (rigs.ts, clipSpeeds), and when the bloater's burst comes in its clip. */
export interface ClipSpeeds {
  walker: Readonly<Record<string, number>>;
  mechanic: Readonly<Record<string, number>>;
  survivor: Readonly<Record<string, number>>;
  /** Seconds into `bloat_burst` where the belly goes (the file's `extras.clips.bloat_burst.burst_s`). */
  burstAt?: number;
}

export interface DeadView {
  d: Dead;
  rig: Rig;
  pool: RigPool;
  eyes: EyeFrame;
  eyesMat: MeshStandardMaterial | null;
  lastState: string;
  /** How much its eyes shine now, eased. */
  shine: number;
  /** Fading away once the fog takes the body: 1 → 0; −1 not yet. */
  fade: number;
  groanIn: number;
  shuffleIn: number;
  rustleIn: number;
  moonIn: number;
  moonVis: number;
  /** It has come out of the fog (the groan that says so has sounded). */
  seen: boolean;
  thudIn: number;
  swell: number;
  deathPlayed: boolean;
}

export interface SurvivorView {
  s: Survivor;
  rig: Rig;
  flame: MeshStandardMaterial | null;
  stumbled: boolean;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const left = new Vector3();
const right = new Vector3();
const tmpM = new Matrix4();

/** Hooks back into the game for what the cast notices. */
export interface CastHooks {
  /** One of the dead came out of the fog (the first walker's tip, the first crawler's). */
  cameIntoView(d: Dead): void;
  /** Eyes shone in the beam while the body was still in the fog (the eyes tip). */
  eyesInFog(d: Dead): void;
  /** The Mechanic is out of the fog. */
  mechanicSeen(d: Dead): void;
}

/**
 * Everyone on the road: puts a pooled rig on each of the dead and the
 * living the rules create, plays the right clip for what they are doing
 * (a walker's own gait at the pace it walks, a runner's sprint, a crawl,
 * the climb out of the bus, the vault over the fence, the claw at the
 * barricade, the Mechanic's swing), and adds what the clips cannot know:
 * where they are and which way they face, their eyes shining back in the
 * beam, the corn bending ahead of one, the Mechanic's mask flying off, a
 * bloater's belly bursting, the survivor's lantern, and their sounds - a
 * groan as one leaves the fog, feet dragging, the corn's rustle.
 */
export class Cast {
  readonly dead: DeadView[] = [];
  readonly survivors: SurvivorView[] = [];
  private readonly tumblers = new Tumblers(4);
  private readonly maskMeshes: Mesh[] = [];
  /** The survivor's lantern, lighting them and the road round them. */
  readonly lantern = new PointLight(new Color(1, 0.62, 0.3), 0, 9, 2);
  private readonly eyeFrames = new Map<RigPool, EyeFrame>();
  private time = 0;
  /** The fog's reach now (metres), for when one "leaves the fog". */
  sight = 70;
  /** How long a bloater at the barricade swells before it bursts, now (the difficulty's, worn by a long wave). */
  private burstWarning = 0.8;

  constructor(
    private readonly pools: { walker: RigPool; mechanic: RigPool; survivor: RigPool },
    parent: Object3D,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly queries: RoadQueries,
    private readonly eye: Vector3,
    private readonly toMoon: Vector3,
    private readonly flashlight: Flashlight,
    private readonly eyeshine: Eyeshine,
    private readonly u: NightUniforms,
    private readonly random: () => number,
    private readonly hooks: CastHooks,
    private readonly speeds: ClipSpeeds = { walker: CLIP_SPEED, mechanic: CLIP_SPEED, survivor: CLIP_SPEED },
  ) {
    for (const pool of [pools.walker, pools.mechanic]) {
      const first = pool.rigs[0];
      if (first) this.eyeFrames.set(pool, eyeFrame(first.model));
    }
    for (let i = 0; i < 2; i++) {
      const m = new Mesh();
      m.visible = false;
      m.castShadow = true;
      parent.add(m);
      this.maskMeshes.push(m);
    }
    this.lantern.castShadow = false;
    parent.add(this.lantern);
  }

  view(d: Dead): DeadView | undefined {
    for (const v of this.dead) if (v.d === d) return v;
    return undefined;
  }

  // --- the dead ------------------------------------------------------------------------

  spawn(d: Dead): void {
    const pool = d.kind === "mechanic" ? this.pools.mechanic : this.pools.walker;
    let rig = pool.take();
    if (!rig) rig = this.recycleBody(pool);
    if (!rig) return;
    dressDead(rig, d.kind, this.random);
    if (d.kind !== "mechanic") {
      // Each of the dead a little different in the light.
      const k = 0.82 + this.random() * 0.28;
      rig.tint(k * (0.94 + this.random() * 0.12), k, k * (0.92 + this.random() * 0.12));
    }
    rig.root.position.set(d.pos.x, d.pos.y, d.pos.z);
    rig.root.rotation.y = Math.atan2(d.heading.x, d.heading.z);
    rig.root.visible = true;
    const v: DeadView = {
      d,
      rig,
      pool,
      eyes: this.eyeFrames.get(pool) ?? eyeFrame(rig.model),
      eyesMat: darkEyes(eyesMaterial(rig)),
      lastState: "",
      shine: 0,
      fade: -1,
      groanIn: 1 + this.random() * 4,
      shuffleIn: this.random() * 2,
      rustleIn: this.random(),
      moonIn: Math.floor(this.random() * 8),
      moonVis: 1,
      seen: false,
      thudIn: -1,
      swell: 0,
      deathPlayed: false,
    };
    this.dead.push(v);
    this.enterState(v);
  }

  /** Out of free rigs: take the oldest body off the road. */
  private recycleBody(pool: RigPool): Rig | null {
    for (let i = 0; i < this.dead.length; i++) {
      const v = this.dead[i] as DeadView;
      if (v.pool === pool && v.d.state === "dead") {
        this.dead.splice(i, 1);
        pool.give(v.rig);
        return pool.take();
      }
    }
    return null;
  }

  /** The clip for the state it has just entered. */
  private enterState(v: DeadView): void {
    const d = v.d;
    const rig = v.rig;
    v.lastState = d.state;
    switch (d.state) {
      case "emerging": {
        const clip = d.lane.id === "bus" ? "climb_out" : "vault";
        rig.play(clip, 0, false, rig.duration(clip) / (d.lane.id === "bus" ? CLIMB_TIME : VAULT_TIME));
        this.sound.at(d.lane.id === "bus" ? "night_climb" : "night_vault", d.pos, 0.9);
        break;
      }
      case "approaching":
        rig.play(this.gaitOf(v), 0.25, true);
        break;
      case "staggered":
        rig.play("stagger", 0.06, false, rig.duration("stagger") / (d.kind === "mechanic" ? 0.3 : STAGGER_TIME));
        break;
      case "lunging":
        rig.play("lunge", 0.05, false, rig.duration("lunge") / LUNGE_TIME);
        this.sound.at("night_lunge", d.pos, 1);
        break;
      case "waiting":
        rig.play(d.kind === "crawler" ? "idle.low" : "idle", 0.3, true, 1.3);
        break;
      case "attacking": {
        const clip = d.kind === "mechanic" ? "swing" : d.kind === "crawler" ? "claw.low" : "claw";
        const period = ATTACKS[d.kind === "bloater" ? "walker" : d.kind].period;
        rig.play(clip, 0.2, true, rig.duration(clip) / period);
        break;
      }
      case "swelling":
        // Its own clip swells it and doubles it over as it bursts: timed so
        // the burst lands when the rules burst it.
        this.playBurst(v, this.burstWarning);
        break;
      default:
        break;
    }
  }

  private gaitOf(v: DeadView): string {
    switch (v.d.kind) {
      case "runner":
        return "run";
      case "crawler":
        return "crawl";
      case "bloater":
        return "walk.drag";
      case "mechanic":
        return "walk.shamble";
      default:
        return v.d.gait;
    }
  }

  /** A strike landed: the claw's rake, the runner's lunge, the tyre iron. */
  strike(d: Dead): void {
    const cue = d.kind === "mechanic" ? "night_swing" : d.kind === "runner" ? "night_lunge" : "night_claw";
    this.sound.at(cue, d.pos, 1, 0.94 + this.random() * 0.12);
  }

  /** A hit that did not drop it. */
  wound(d: Dead, part: HitPart, at: Vector3): void {
    const v = this.view(d);
    if (!v) return;
    tmp2.copy(at).sub(this.eye).normalize();
    v.rig.hitReact(Math.sign(at.x - v.rig.root.position.x) || 1, d.kind === "mechanic" ? 0.5 : 1);
    if (d.kind === "mechanic" && part === "head" && d.mask > 0) {
      // The mask holds: a clang and sparks.
      tmp.copy(tmp2).negate();
      this.fx.sparks(at, tmp);
      this.sound.at("night_mask_clang", at, 1);
      v.rig.play("hit_head", 0.05, false);
      return;
    }
    this.fx.spray(at, tmp2, false);
    this.sound.at("night_hit", at, 1);
  }

  /** The Mechanic's mask knocked off: it flies, tumbling, and his face is bare. */
  maskOff(d: Dead, at: Vector3): void {
    const v = this.view(d);
    if (!v) return;
    this.sound.at("night_mask_clang", at, 1, 0.85);
    tmp.copy(at).sub(this.eye).normalize().negate();
    this.fx.sparks(at, tmp);
    v.rig.play("mask_off", 0.05, false);
    const mask = v.rig.vars.get("var.mask");
    if (!mask || !mask.visible) return;
    const source = find(mask, "var.mask") as Mesh | null;
    const mesh = this.maskMeshes.find((m) => !m.visible) ?? (this.maskMeshes[0] as Mesh);
    const src = (source && source.isMesh ? source : (mask as Mesh)) as Mesh;
    if (src.isMesh) {
      mesh.geometry = src.geometry;
      mesh.material = src.material as Material;
      const skinned = (src as SkinnedMesh).isSkinnedMesh === true;
      if (skinned) {
        const sk = (src as SkinnedMesh).skeleton;
        const head = v.rig.bone("head");
        const i = head ? sk.bones.indexOf(head as never) : -1;
        if (head && i >= 0) tmpM.multiplyMatrices(head.matrixWorld, sk.boneInverses[i] as Matrix4);
        else tmpM.copy(src.matrixWorld);
      } else {
        tmpM.copy(src.matrixWorld);
      }
      tmpM.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.visible = true;
      const t = this.tumblers.take();
      t.object = mesh;
      t.home = null;
      tmp.copy(at).sub(this.eye).setY(0).normalize();
      t.vel.set(tmp.x * 2 + (this.random() - 0.5), 2.6 + this.random(), tmp.z * 2);
      t.spin.set((this.random() - 0.5) * 12, (this.random() - 0.5) * 8, (this.random() - 0.5) * 12);
      // A skinned mask's geometry sits round the head in the bind pose, so its
      // "floor" is relative to that; a rigid one's origin is the mask itself.
      const ground = this.queries.groundAt(mesh.position.x, mesh.position.z, v.rig.root.position.y + 1);
      t.floor = skinned ? ground - 1.9 : ground + 0.08;
    }
    mask.visible = false;
  }

  /** Down: the fall its death calls for, where it stands. */
  death(d: Dead, cause: DeathCause, at: Vector3 | null): void {
    const v = this.view(d);
    if (!v) return;
    const rig = v.rig;
    rig.aimAt(null, 0);
    v.shine = 0;
    if (v.eyesMat) shineEyes(v.eyesMat, 0);
    if (at) {
      tmp2.copy(at).sub(this.eye).normalize();
      this.fx.spray(at, tmp2, cause === "head");
      rig.hitReact(Math.sign(at.x - rig.root.position.x) || 1, 1.3);
      this.sound.at(cause === "head" ? "night_headshot" : "night_hit", at, 1);
    }
    if (d.kind === "bloater") {
      // Shot, caught in another's burst, or bursting on the barricade: it
      // doubles over as its belly goes, under the cloud. (At the barricade
      // its clip has been running since it began to swell.)
      if (!(cause === "burst" && rig.current?.getClip().name === "bloat_burst")) this.playBurst(v, 0.04);
      v.deathPlayed = true;
      v.thudIn = 1.1;
      this.sound.at("night_dead_fall", d.pos, 0.8, 0.9 + this.random() * 0.2, 0.05);
      return;
    }
    let clip: string;
    if (d.kind === "crawler") clip = "death.low";
    else if (cause === "chain") clip = "death_crumple";
    else if (cause === "head") clip = this.random() < 0.75 ? "death_back" : "death_crumple";
    else clip = this.random() < 0.5 ? "death_forward" : "death_crumple";
    rig.play(clip, 0.08, false);
    v.deathPlayed = true;
    v.thudIn = 0.8;
    this.sound.at("night_dead_fall", d.pos, 0.8, 0.9 + this.random() * 0.2, 0.05);
  }

  /**
   * The bloater's `bloat_burst`, started so the moment its belly goes lands
   * `inSeconds` from now: slowed to fit a long swell, or begun part way
   * into a short one (or a shot, which bursts it at once).
   */
  private playBurst(v: DeadView, inSeconds: number): void {
    const rig = v.rig;
    rig.play("bloat_burst", 0.1, false);
    const action = rig.current;
    if (!action || action.getClip().name !== "bloat_burst") return;
    const at = this.speeds.burstAt ?? 1.32;
    if (inSeconds >= at) action.timeScale = at / inSeconds;
    else action.time = at - inSeconds;
  }

  /** A bloater bursts: its belly goes, and the cloud with it. */
  burst(d: Dead): void {
    const v = this.view(d);
    if (!v) return;
    const belly = find(v.rig.model, "belly");
    if (belly) belly.visible = false;
    const hips = v.rig.bone("hips");
    if (hips) hips.getWorldPosition(tmp);
    else tmp.set(d.pos.x, d.pos.y + 1, d.pos.z);
    tmp.y += 0.15;
    this.fx.burst(tmp, d.pos.y);
    this.sound.at("night_bloat_burst", tmp, 1);
  }

  /** The breather's fog takes the fallen. */
  clear(d: Dead): void {
    const v = this.view(d);
    if (v && v.fade < 0) v.fade = 1.4;
  }

  // --- the living ------------------------------------------------------------------------

  survivorAppear(s: Survivor): void {
    const rig = this.pools.survivor.take();
    if (!rig) return;
    rig.dress([`var.person.${s.role}`]);
    rig.hold("prop.lantern");
    rig.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    rig.root.rotation.y = Math.atan2(s.heading.x, s.heading.z);
    rig.root.visible = true;
    rig.play("run_lantern", 0, true, s.speed / (this.speeds.survivor["run_lantern"] ?? 4.4));
    const flameNode = find(rig.model, "lantern.flame") as Mesh | null;
    const flame = flameNode && flameNode.isMesh ? ((Array.isArray(flameNode.material) ? flameNode.material[0] : flameNode.material) as MeshStandardMaterial) : null;
    this.survivors.push({ s, rig, flame, stumbled: false });
    // The call: a whistle and a shout, a young woman's or an old man's.
    this.sound.at(s.role === "daughter" ? "night_survivor_daughter" : "night_survivor_owner", s.pos, 1, 1, 0.2);
  }

  survivorShot(s: Survivor, at: Vector3): void {
    const v = this.survivors.find((x) => x.s === s);
    if (!v) return;
    v.stumbled = true;
    v.rig.play("stumble", 0.05, false);
    v.rig.hitReact(Math.sign(at.x - v.rig.root.position.x) || 1, 1);
    this.sound.at("night_hit", at, 0.8);
  }

  survivorGone(s: Survivor): void {
    const i = this.survivors.findIndex((x) => x.s === s);
    if (i < 0) return;
    const v = this.survivors[i] as SurvivorView;
    this.survivors.splice(i, 1);
    this.pools.survivor.give(v.rig);
  }

  // --- every frame ------------------------------------------------------------------------

  update(dt: number, time: number, match: Match): void {
    this.time = time;
    this.burstWarning = match.tuning.burstWarning;
    let pushes = 0;
    const push = this.u.uPush.value;
    for (const p of push) p.z = 0;
    this.eyeshine.begin();
    for (let i = this.dead.length - 1; i >= 0; i--) {
      const v = this.dead[i] as DeadView;
      if (this.updateDead(v, dt, match)) {
        this.dead.splice(i, 1);
        v.pool.give(v.rig);
        continue;
      }
      // The corn bends ahead of one pushing through it.
      const d = v.d;
      if (d.alive && d.lane.cover > 0 && d.along < d.lane.cover + 1.5 && pushes < push.length) {
        const slot = push[pushes++];
        if (slot) slot.set(d.pos.x + d.heading.x * 0.5, d.pos.z + d.heading.z * 0.5, 1, 0);
      }
    }
    this.updateLiving(dt);
    this.eyeshine.end();
    this.tumblers.update(dt);
  }

  /** Returns true when the view is finished with (faded out). */
  private updateDead(v: DeadView, dt: number, match: Match): boolean {
    const d = v.d;
    const rig = v.rig;
    if (d.state !== v.lastState && d.alive) this.enterState(v);
    else if (d.state !== v.lastState) v.lastState = d.state;
    rig.root.position.set(d.pos.x, d.pos.y, d.pos.z);
    if (d.alive) {
      const facing = d.state === "approaching" || d.state === "emerging" || d.state === "lunging";
      if (facing) turnRig(rig, Math.atan2(d.heading.x, d.heading.z), dt);
      else turnRig(rig, headingTo(d.pos.x, d.pos.z, this.eye), dt);
      if (d.state === "approaching") {
        // The gait at the pace it walks now: the wave, the pressure, the Mechanic.
        const clip = this.gaitOf(v);
        const pace = d.speed * match.paceFor(d);
        // (The Mechanic's roar, when he first comes out of the fog, plays at its own pace.)
        const made = (v.pool === this.pools.mechanic ? this.speeds.mechanic : this.speeds.walker)[clip] ?? 1;
        if (rig.current && rig.currentName === clip) rig.current.timeScale = pace / made;
      }
      if (d.state === "swelling") {
        // Swelling to burst: a shudder over the clip.
        v.swell += dt;
        rig.hitReact(Math.sin(v.swell * 30) > 0 ? 1 : -1, 0.03 + v.swell * 0.03);
      }
      this.sounds(v, dt);
    }
    if (v.thudIn > 0) {
      v.thudIn -= dt;
      if (v.thudIn <= 0) {
        this.sound.at("night_body_fall", rig.root.position, 0.9);
        tmp.copy(rig.root.position);
        tmp2.set(0, 1, 0);
        this.fx.puff(tmp, tmp2, 0.5);
      }
    }
    // The moon on it, or the station's shadow: a ray every few frames, eased.
    if (--v.moonIn <= 0) {
      v.moonIn = 8;
      tmp.copy(rig.root.position);
      tmp.y += 1.3;
      v.moonVis = this.queries.moonReaches(tmp, this.toMoon) ? 1 : 0.2;
    }
    const key = rig.lighting.key;
    key.value += (v.moonVis - key.value) * Math.min(1, dt * 6);
    rig.update(dt);
    this.eyes(v, dt);
    if (v.fade >= 0) {
      v.fade -= dt;
      rig.setOpacity(Math.max(0, Math.min(1, v.fade)));
      if (v.fade <= 0) return true;
    }
    return false;
  }

  /** Their eyes in the beam: two points of light, and the eyes themselves up close. */
  private eyes(v: DeadView, dt: number): void {
    const d = v.d;
    const head = v.rig.bone("head");
    let target = 0;
    if (d.alive && head) {
      head.updateWorldMatrix(true, false);
      left.copy(v.eyes.left).applyMatrix4(head.matrixWorld);
      right.copy(v.eyes.right).applyMatrix4(head.matrixWorld);
      tmp.copy(left).add(right).multiplyScalar(0.5);
      // Retroreflection: only when they look toward the lamp.
      tmp2.copy(this.flashlight.position).sub(tmp).normalize();
      const face = facingToward(v.rig.root.rotation.y, tmp2) ** 2;
      target = Math.min(1.6, this.flashlight.lightAt(tmp) * 0.85) * face;
      const distance = tmp.distanceTo(this.eye);
      if (target > 0.3 && distance > this.sight * 0.72) this.hooks.eyesInFog(d);
    }
    v.shine += (target - v.shine) * Math.min(1, dt * 16);
    if (v.shine > 0.01 && d.alive) this.eyeshine.add(left, right, v.shine);
    if (v.eyesMat) shineEyes(v.eyesMat, v.shine);
  }

  /** A groan as one leaves the fog, and now and then after; feet dragging near; the corn's rustle. */
  private sounds(v: DeadView, dt: number): void {
    const d = v.d;
    const distance = Math.hypot(d.pos.x - this.eye.x, d.pos.z - this.eye.z);
    const inCorn = d.lane.cover > 0 && d.along < d.lane.cover;
    if (!v.seen && !inCorn && distance < this.sight * 0.92) {
      v.seen = true;
      this.hooks.cameIntoView(d);
      if (d.kind === "mechanic") this.hooks.mechanicSeen(d);
      else this.groan(d);
      v.groanIn = 5 + this.random() * 6;
    }
    v.groanIn -= dt;
    if (v.groanIn <= 0) {
      v.groanIn = 4.5 + this.random() * 7;
      if (distance < this.sight + 15) this.groan(d);
    }
    if (d.kind !== "runner" && d.kind !== "crawler" && distance < 22 && d.state === "approaching") {
      v.shuffleIn -= dt;
      if (v.shuffleIn <= 0) {
        v.shuffleIn = 1.6 + this.random() * 1.4;
        this.sound.at("night_shuffle", d.pos, 0.8, 0.9 + this.random() * 0.2);
      }
    }
    if (inCorn) {
      v.rustleIn -= dt;
      if (v.rustleIn <= 0) {
        v.rustleIn = 0.9 + this.random() * 0.8;
        this.sound.at("night_corn_rustle", d.pos, 0.9, 0.9 + this.random() * 0.2);
      }
    }
  }

  private groan(d: Dead): void {
    if (d.kind === "runner") this.sound.at("night_snarl", d.pos, 1, 0.95 + this.random() * 0.15);
    else this.sound.at("night_groan", d.pos, d.kind === "crawler" ? 0.7 : 1, (d.kind === "bloater" ? 0.8 : 0.9) + this.random() * 0.2);
  }

  private updateLiving(dt: number): void {
    let lit: SurvivorView | null = null;
    for (const v of this.survivors) {
      const s = v.s;
      v.rig.root.position.set(s.pos.x, s.pos.y, s.pos.z);
      turnRig(v.rig, Math.atan2(s.heading.x, s.heading.z), dt);
      if (v.stumbled && s.state === "running") {
        v.stumbled = false;
        v.rig.play("run_lantern", 0.2, true, s.speed / (this.speeds.survivor["run_lantern"] ?? 4.4));
      }
      v.rig.update(dt);
      lit = v;
    }
    // The lantern: its flame flickers, and its light falls on them and the road.
    if (lit) {
      const socket = lit.rig.socket("socket.lantern");
      if (socket) socket.getWorldPosition(this.lantern.position);
      else this.lantern.position.copy(lit.rig.root.position).setY(1.1);
      const flicker = 0.82 + 0.18 * Math.sin(this.time * 23) * Math.sin(this.time * 7.3 + 1);
      this.lantern.intensity = 3.2 * flicker;
      if (lit.flame) lit.flame.emissiveIntensity = 2.2 * flicker;
    } else {
      this.lantern.intensity = 0;
    }
  }

  /** Everything off the road (a new night). */
  reset(): void {
    for (const v of this.dead) v.pool.give(v.rig);
    for (const v of this.survivors) this.pools.survivor.give(v.rig);
    this.dead.length = 0;
    this.survivors.length = 0;
    this.tumblers.reset();
    for (const m of this.maskMeshes) m.visible = false;
    this.lantern.intensity = 0;
  }

  /** A point on one of the dead a player could aim at: the chest (for the harness's scripted shots). */
  chest(v: DeadView, out: Vector3): V3 {
    const j = v.rig.updateJoints();
    return out.copy(j.hips).lerp(j.neck, 0.6);
  }
}

/** How much a figure turned to `heading` (radians about Y, 0 facing +Z) faces the direction `to` (horizontal). */
function facingToward(heading: number, to: Vector3): number {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const h = Math.hypot(to.x, to.z) || 1;
  return Math.max(0, (fx * to.x + fz * to.z) / h);
}
