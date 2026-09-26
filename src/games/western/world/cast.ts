import { Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3, type Material } from "three";
import type { Bandit } from "../rules/bandit";
import type { HitPart } from "../rules/types";
import type { Townsperson } from "../rules/townsfolk";
import type { Effects } from "./effects";
import type { Rig, RigPool } from "./character";
import type { TownQueries } from "./queries";
import type { Sound } from "./sound";

/** A thing tumbling through the air to rest: a hat shot off, a dropped gun. */
class Tumbler {
  object: Object3D | null = null;
  readonly vel = new Vector3();
  readonly spin = new Vector3();
  floor = 0;
  resting = false;
  active = false;
  /** Where it came from, to put it back. */
  home: Object3D | null = null;
  readonly homePos = new Vector3();
  readonly homeQuat = new Quaternion();
}

export interface BanditView {
  b: Bandit;
  rig: Rig;
  lastState: string;
  /** Falling from a height: time into the fall, its length, start, velocity. */
  falling: boolean;
  fallT: number;
  fallDur: number;
  readonly fallFrom: Vector3;
  readonly fallVel: Vector3;
  landY: number;
  /** When the body meets the ground (for the thud), seconds from death; -1 done. */
  thudIn: number;
  /** Sliding on after death (runners, blasts). */
  readonly slide: Vector3;
  fade: number;
  sunCheck: number;
  sunVis: number;
  tellSilhouette: number;
  introduced: boolean;
  lean: -1 | 0 | 1;
  /** His gun, if it fell from his hand. */
  gun: Tumbler | null;
}

export interface TownsView {
  p: Townsperson;
  rig: Rig;
  sunCheck: number;
  sunVis: number;
  hitAt: number;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const tmpM = new Matrix4();

/** States in which nothing darkens him (not a tell, not stepping out of a doorway). */
function tellFree(state: string): boolean {
  return state !== "tell" && state !== "emerging" && state !== "hiding";
}

const HATS = ["var.hat.stetson", "var.hat.bowler", "var.hat.flat"];
const COATS = ["var.coat.duster", "var.coat.jacket", null];
const BANDANAS = ["var.bandana.red", "var.bandana.black", null];

/**
 * Everyone on stage: puts a pooled rig on each bandit and townsperson the
 * rules create, plays the right clip for what they are doing, and adds what
 * the clips cannot know — where they stand, which way they face, the fall
 * from a window, the hat shot off, the gun dropped in the dust, the muzzle
 * flash and the glint.
 */
export class Cast {
  readonly bandits: BanditView[] = [];
  readonly townsfolk: TownsView[] = [];
  private readonly tumblers: Tumbler[] = [];
  private readonly hatMeshes: Mesh[] = [];
  private time = 0;
  private frame = 0;
  golden = false;

  constructor(
    private readonly pools: { bandit: RigPool; boss: RigPool; townsfolk: RigPool },
    private readonly parent: Object3D,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly queries: TownQueries,
    private readonly eye: Vector3,
    private readonly toSun: Vector3,
    private readonly random: () => number,
    private readonly hooks: { popup(at: Vector3, text: string, tone?: "" | "gold" | "danger"): void; bellSwing(): void },
  ) {
    for (let i = 0; i < 8; i++) this.tumblers.push(new Tumbler());
    for (let i = 0; i < 4; i++) {
      const m = new Mesh();
      m.visible = false;
      m.castShadow = true;
      parent.add(m);
      this.hatMeshes.push(m);
    }
  }

  view(b: Bandit): BanditView | undefined {
    for (const v of this.bandits) if (v.b === b) return v;
    return undefined;
  }

  townsView(p: Townsperson): TownsView | undefined {
    for (const v of this.townsfolk) if (v.p === p) return v;
    return undefined;
  }

  // --- the gang ------------------------------------------------------------------

  spawn(b: Bandit): void {
    const boss = b.role === "boss";
    let rig = (boss ? this.pools.boss : this.pools.bandit).take();
    if (!rig && !boss) rig = this.recycleBody();
    if (!rig) return;
    const r = this.random;
    if (boss) {
      rig.dress(["var.hat.stetson", "var.coat.duster"]);
      rig.arm("revolver");
    } else {
      const outfit: string[] = [];
      outfit.push(HATS[Math.floor(r() * HATS.length)] as string);
      const coat = COATS[Math.floor(r() * COATS.length)];
      if (coat) outfit.push(coat);
      const bandana = BANDANAS[Math.floor(r() * BANDANAS.length)];
      if (bandana) outfit.push(bandana);
      if (!coat && r() < 0.6) outfit.push("var.vest");
      if (b.armour > 0) outfit.push("var.armour");
      rig.dress(outfit);
      // Dynamiters carry a revolver too, for when they have no clear throw.
      rig.arm(b.role === "rifleman" ? "rifle" : "revolver");
      const k = 0.85 + r() * 0.25;
      rig.tint(k * (0.95 + r() * 0.1), k, k * (0.9 + r() * 0.1));
    }
    // The duelist strolls out (a slowed run); everyone else starts in cover.
    if (b.state === "walking") rig.play("run", 0, true, 0.42);
    else rig.play("hidden", 0);
    rig.root.position.set(b.pos.x, b.pos.y, b.pos.z);
    this.face(rig, b.pos.x, b.pos.z);
    rig.root.visible = b.visible;
    this.bandits.push({
      b,
      rig,
      lastState: b.state,
      falling: false,
      fallT: 0,
      fallDur: 0,
      fallFrom: new Vector3(),
      fallVel: new Vector3(),
      landY: 0,
      thudIn: -1,
      slide: new Vector3(),
      fade: -1,
      sunCheck: Math.floor(r() * 8),
      sunVis: 1,
      tellSilhouette: 0,
      introduced: false,
      gun: null,
      lean: b.cover.emerge === "lean_left" ? 1 : b.cover.emerge === "lean_right" ? -1 : 0,
    });
  }

  /** Out of free rigs: take the oldest body off the street. */
  private recycleBody(): Rig | null {
    for (let i = 0; i < this.bandits.length; i++) {
      const v = this.bandits[i] as BanditView;
      if (v.b.state === "dead" && v.b.role !== "boss") {
        this.bandits.splice(i, 1);
        this.releaseBandit(v);
        return this.pools.bandit.take();
      }
    }
    return null;
  }

  tell(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    const c = b.cover;
    const hid = c.hidden;
    tmp.set(hid.x, hid.y, hid.z);
    switch (c.kind) {
      case "window":
        // A dark shape crossing the unlit room behind the window.
        v.tellSilhouette = 0.001;
        this.sound.at("shutter_bang", tmp, 0.35, 1.2);
        break;
      case "door":
        this.sound.at("door_creak", tmp, 0.8);
        tmp.set(c.exposed.x, c.exposed.y + 2.6, c.exposed.z);
        this.fx.sift(tmp, 1.0);
        break;
      case "roof":
      case "tower":
        this.sound.at("crow_caw", tmp, 0.6, 0.9 + this.random() * 0.2);
        tmp.set(c.exposed.x, c.exposed.y + 1.2, c.exposed.z);
        this.fx.sift(tmp, 1.2);
        break;
      case "corner":
        this.sound.at("spurs", tmp, 0.7);
        tmp.y += 0.05;
        tmp2.set(0, 1, 0);
        this.fx.dust(tmp, tmp2, 0.35);
        break;
      default:
        // Dust kicked up behind a barrel, crate or wagon.
        tmp.y += 0.05;
        tmp2.set(0, 1, 0);
        this.fx.dust(tmp, tmp2, 0.5);
        this.sound.at("spurs", tmp, 0.4, 0.8);
        break;
    }
  }

  emerge(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    v.tellSilhouette = 0;
    v.rig.uniforms.uShade.value = 1;
    v.rig.root.visible = true;
    const clip = { lean_left: "lean_left_out", lean_right: "lean_right_out", rise: "rise", step_out: "step_out" }[b.cover.emerge];
    // The clip takes as long as he does: it ends as he arrives, not before.
    v.rig.play(clip, 0.1, false, v.rig.duration(clip) / Math.max(0.05, b.dur));
    if (b.role === "boss" && !v.introduced) {
      v.introduced = true;
      this.sound.play("boss_intro");
      tmp.set(b.cover.exposed.x, b.cover.exposed.y + 2.2, b.cover.exposed.z);
      this.hooks.popup(tmp, "Black Jack Carver", "gold");
    }
  }

  aim(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    // Leaning out, the lean itself is the aim pose; standing, bring the gun up.
    if (v.lean === 0 || b.role === "duelist") v.rig.play("aim", 0.18, true, 1, false);
  }

  /**
   * The telegraph, 0.4 s before he fires: the sun flashes off the top of his
   * barrel (a streak the same size on screen at any range), and his hammer
   * clicks back, heard from his side of the street even when far off.
   */
  glint(b: Bandit): void {
    const v = this.view(b);
    const socket = v?.rig.socket;
    if (!socket) return;
    socket.updateWorldMatrix(true, false);
    socket.getWorldPosition(tmp);
    // Along the barrel (the socket's −Z) to the cylinder's top strap, a rifle
    // further out to its receiver, and a hand toward the eye so the flash
    // is not buried in the fist that holds it.
    tmp2.set(0, 0, -1).transformDirection(socket.matrixWorld);
    tmp.addScaledVector(tmp2, b.role === "rifleman" ? 0.3 : 0.1);
    tmp.y += 0.04;
    tmp2.copy(this.eye).sub(tmp).normalize();
    tmp.addScaledVector(tmp2, 0.25);
    const d = tmp.distanceTo(this.eye);
    this.fx.sunGlint(tmp, d);
    const click = this.sound.place(b.pos, { volume: 0.5, rate: 1.1 + this.random() * 0.1 });
    click.distance = Math.min(click.distance ?? 0, 9);
    this.sound.play("revolver_cock", click);
  }

  fire(b: Bandit, hit: boolean): void {
    const v = this.view(b);
    if (!v) return;
    const rig = v.rig;
    rig.kick();
    if (v.lean === 0 || b.role === "duelist") rig.play("fire", 0.05, false);
    const muzzle = rig.socket;
    if (muzzle) {
      muzzle.getWorldPosition(tmp);
      tmp2.copy(this.eye).sub(tmp).normalize();
      // The flash sits at the barrel's end, a little toward the player.
      tmp.addScaledVector(tmp2, b.role === "rifleman" ? 0.8 : 0.22);
      this.fx.muzzle(tmp, tmp2, false, b.role === "rifleman" ? 1.3 : 1);
    }
    this.sound.at(b.role === "rifleman" ? "rifle_shot" : "bandit_shot", b.pos, 1, 0.95 + this.random() * 0.1);
    if (!hit) {
      // A miss you can hear and see: the whiz past your ear, dust at your feet.
      const side = Math.sign(b.pos.x - this.eye.x) || 1;
      this.sound.play("bullet_whiz", { pan: -side * (0.3 + this.random() * 0.5), volume: 0.9, delay: 0.05 });
      if (this.random() < 0.6) {
        tmp.set(this.eye.x + (this.random() - 0.5) * 3, 0.02, this.eye.z - 2.5 - this.random() * 3.5);
        tmp2.set(0, 1, 0);
        this.fx.dust(tmp, tmp2, 0.6);
        if (this.random() < 0.4) this.sound.at("ricochet", tmp, 0.7, 0.9 + this.random() * 0.3, 0.06);
        else this.sound.at("hit_dirt", tmp, 0.6, 1, 0.05);
      }
    }
  }

  hide(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    if (b.role === "dynamiter") v.rig.arm("revolver");
    const clip = { lean_left: "lean_left_in", lean_right: "lean_right_in", rise: "sink", step_out: "step_in" }[b.cover.emerge];
    // The clip takes as long as he does: it ends as he arrives, not before.
    v.rig.play(clip, 0.1, false, v.rig.duration(clip) / Math.max(0.05, b.dur));
  }

  run(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    v.rig.root.visible = true;
    v.rig.play("run", 0.12, true, 1.05);
    this.sound.at("spurs", b.pos, 0.8, 1.2);
  }

  light(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    v.rig.arm("dynamite");
    v.rig.play("idle", 0.15);
    this.sound.loopAt(`fuse.b${b.id}`, "dynamite_fuse", b.pos, 0.7);
  }

  /** The stick has left his hand: the view of the stick takes over from the prop. */
  released(b: Bandit, stickId: number): void {
    const v = this.view(b);
    if (!v) return;
    v.rig.arm("none");
    this.sound.stopLoop(`fuse.b${b.id}`);
    this.sound.loopAt(`fuse.s${stickId}`, "dynamite_fuse", b.pos, 0.8);
    this.sound.at("dynamite_throw", b.pos);
  }

  pace(b: Bandit, pace: number): void {
    this.sound.at("spurs", b.pos, 0.9, 0.95 + (pace % 2) * 0.1);
  }

  standoff(b: Bandit): void {
    const v = this.view(b);
    if (!v) return;
    v.rig.play("idle", 0.3);
    this.sound.play("duel_whistle");
  }

  duelBell(b: Bandit): void {
    const v = this.view(b);
    this.hooks.bellSwing();
    if (!v) return;
    v.rig.play("aim", 0.12, true);
  }

  wound(b: Bandit, part: HitPart, at: Vector3): void {
    const v = this.view(b);
    if (!v) return;
    v.rig.play(part === "head" ? "hit_head" : "hit_body", 0.05, false);
    const side = Math.sign(at.x - v.rig.root.position.x) || 1;
    v.rig.hitReact(side, 1);
    tmp2.copy(at).sub(this.eye).normalize();
    // Only an iron plate (or Black Jack's hide) stops a body shot.
    if (b.role !== "boss") {
      tmp.copy(tmp2).negate();
      this.fx.impact("metal", at, tmp, v.rig.root.position.y, false);
      this.sound.at("hit_metal", at, 1);
      this.sound.at("ricochet", at, 0.8, 1, 0.05);
    } else {
      this.fx.blood(at, tmp2);
      this.sound.at("hit_flesh", at, 1);
    }
  }

  death(b: Bandit, part: HitPart | "blast", at: Vector3 | null): void {
    const v = this.view(b);
    if (!v) return;
    const rig = v.rig;
    const choice = b.death ?? { clip: "death_back", fall: false };
    rig.aimAt(null, 0);
    rig.uniforms.uShade.value = 1;
    v.tellSilhouette = 0;
    if (at) {
      tmp2.copy(at).sub(this.eye).normalize();
      this.fx.blood(at, tmp2);
      rig.hitReact(Math.sign(at.x - rig.root.position.x) || 1, 1.4);
    }
    this.sound.at(part === "head" ? "hit_headshot" : part === "blast" ? "body_fall" : "hit_flesh", at ?? b.pos, 1);
    this.sound.at("bandit_death", b.pos, 0.9, 0.9 + this.random() * 0.25, 0.05);
    if (choice.fall) {
      // Out of the window (or off the roof), toward the street.
      const p0 = b.pos;
      tmp.set(this.eye.x - p0.x, 0, this.eye.z - p0.z).normalize();
      const push = b.cover.kind === "window" ? 2.6 : 1.8;
      const landX = p0.x + tmp.x * push;
      const landZ = p0.z + tmp.z * push;
      const landY = this.queries.groundAt(landX, landZ, p0.y - 0.35);
      const h = Math.max(0.5, p0.y - landY);
      const vy = 1.2;
      const T = (vy + Math.sqrt(vy * vy + 2 * 9.81 * h)) / 9.81;
      v.falling = true;
      v.fallT = 0;
      v.fallDur = T;
      v.fallFrom.set(p0.x, p0.y, p0.z);
      v.fallVel.set((landX - p0.x) / T, vy, (landZ - p0.z) / T);
      v.landY = landY;
      // Stretch the clip so its body meets the ground as the fall lands (the
      // impact sits about four fifths of the way through a fall clip).
      rig.play("death_fall", 0.08, false, (rig.duration("death_fall") * 0.78) / T);
    } else {
      rig.play(choice.clip, 0.08, false);
      v.thudIn = choice.clip === "death_slump" ? 0.55 : 0.85;
      if (b.state === "dying" && v.lastState === "running") {
        v.slide.set(b.heading.x, 0, b.heading.z).multiplyScalar(1.1);
      } else if (part === "blast") {
        tmp.set(b.pos.x - this.eye.x, 0, b.pos.z - this.eye.z).normalize();
        v.slide.copy(tmp).multiplyScalar(1.2);
      }
    }
    if (part === "head") this.hatOff(rig, at);
    this.dropGun(v);
  }

  /** The body goes (between waves, or to make room). */
  clear(b: Bandit): void {
    const v = this.view(b);
    if (v && v.fade < 0) v.fade = 1;
  }

  // --- hats and guns --------------------------------------------------------------

  private hatOff(rig: Rig, at: Vector3 | null): void {
    const hat = rig.hat;
    if (!hat || !hat.visible) return;
    const mesh = this.hatMeshes.find((m) => !m.visible) ?? (this.hatMeshes[0] as Mesh);
    const source = hat as Mesh;
    if (!source.isMesh) return;
    mesh.geometry = source.geometry;
    mesh.material = source.material as Material;
    if ((source as SkinnedMesh).isSkinnedMesh) {
      // Bound rigidly to the head: its world placement is head × inverse bind.
      const sk = (source as SkinnedMesh).skeleton;
      const head = rig.bone("head");
      const i = head ? sk.bones.indexOf(head as never) : -1;
      if (head && i >= 0) tmpM.multiplyMatrices(head.matrixWorld, sk.boneInverses[i] as Matrix4);
      else tmpM.copy(source.matrixWorld);
    } else {
      tmpM.copy(source.matrixWorld);
    }
    tmpM.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.visible = true;
    hat.visible = false;
    const t = this.tumbler();
    t.object = mesh;
    t.home = null;
    tmp.copy(at ?? rig.root.position).sub(this.eye).setY(0).normalize();
    t.vel.set(tmp.x * 2.5 + (this.random() - 0.5), 3 + this.random() * 1.5, tmp.z * 2.5);
    t.spin.set((this.random() - 0.5) * 14, (this.random() - 0.5) * 10, (this.random() - 0.5) * 14);
    // The hat's geometry sits around the head in bind pose, so its "floor" is relative.
    t.floor = this.queries.groundAt(mesh.position.x, mesh.position.z, rig.root.position.y + 1) - 1.72;
  }

  private dropGun(v: BanditView): void {
    const rig = v.rig;
    const gun = rig.rifle?.visible ? rig.rifle : rig.revolver?.visible ? rig.revolver : null;
    if (!gun || !gun.parent) return;
    const t = this.tumbler();
    t.home = gun.parent;
    t.homePos.copy(gun.position);
    t.homeQuat.copy(gun.quaternion);
    this.parent.attach(gun);
    t.object = gun;
    t.vel.set((this.random() - 0.5) * 1.5, 1 + this.random(), (this.random() - 0.5) * 1.5);
    t.spin.set((this.random() - 0.5) * 12, (this.random() - 0.5) * 12, (this.random() - 0.5) * 12);
    t.floor = this.queries.groundAt(gun.position.x, gun.position.z, gun.position.y) + 0.03;
    v.gun = t;
  }

  private tumbler(): Tumbler {
    for (const t of this.tumblers) if (!t.active) return this.claim(t);
    // All busy: reclaim the first (it has long come to rest).
    const t = this.tumblers[0] as Tumbler;
    this.restore(t);
    return this.claim(t);
  }

  private claim(t: Tumbler): Tumbler {
    t.active = true;
    t.resting = false;
    return t;
  }

  private restore(t: Tumbler): void {
    if (t.object && t.home) {
      t.home.add(t.object);
      t.object.position.copy(t.homePos);
      t.object.quaternion.copy(t.homeQuat);
    } else if (t.object) {
      t.object.visible = false;
    }
    t.object = null;
    t.home = null;
    t.active = false;
  }

  private updateTumblers(dt: number): void {
    for (const t of this.tumblers) {
      if (!t.active || t.resting || !t.object) continue;
      const o = t.object;
      t.vel.y -= 9.81 * dt;
      o.position.addScaledVector(t.vel, dt);
      o.rotation.x += t.spin.x * dt;
      o.rotation.y += t.spin.y * dt;
      o.rotation.z += t.spin.z * dt;
      if (o.position.y <= t.floor) {
        o.position.y = t.floor;
        if (Math.abs(t.vel.y) > 1.2) {
          t.vel.y *= -0.3;
          t.vel.x *= 0.5;
          t.vel.z *= 0.5;
          t.spin.multiplyScalar(0.4);
        } else {
          t.resting = true;
        }
      }
    }
  }

  // --- townsfolk --------------------------------------------------------------------

  townsAppear(p: Townsperson): void {
    if (this.townsView(p)) return;
    const rig = this.pools.townsfolk.take();
    if (!rig) return;
    const outfit: Record<string, string[]> = {
      barber: ["var.coat.apron"],
      woman: ["var.coat.dress", "var.hat.bonnet"],
      bartender: ["var.vest", "var.coat.apron"],
      undertaker: ["var.coat.black", "var.hat.top"],
      preacher: ["var.coat.black"],
    };
    rig.dress(outfit[p.role] ?? []);
    rig.arm("none");
    rig.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.face(rig, p.pos.x, p.pos.z);
    rig.root.visible = true;
    rig.play(p.role === "preacher" ? "head_shake" : "peek", 0.1);
    this.townsfolk.push({ p, rig, sunCheck: 0, sunVis: 1, hitAt: -1 });
    if (p.role === "preacher") this.sound.at("church_door_creak", p.pos, 0.6, 0.9, 0.2);
  }

  townsShot(p: Townsperson, at: Vector3): void {
    const v = this.townsView(p);
    if (!v) return;
    v.hitAt = this.time;
    v.rig.play("hit_body", 0.05, false);
    v.rig.hitReact(Math.sign(at.x - v.rig.root.position.x) || 1, 1);
    this.sound.at("hit_flesh", at, 0.8);
    tmp2.set(0, 1, 0);
    this.fx.dust(at, tmp2, 0.3);
  }

  townsGone(p: Townsperson): void {
    const i = this.townsfolk.findIndex((v) => v.p === p);
    if (i < 0) return;
    const v = this.townsfolk[i] as TownsView;
    this.townsfolk.splice(i, 1);
    this.releaseRig(v.rig, this.pools.townsfolk);
  }

  // --- every frame --------------------------------------------------------------------

  update(dt: number, time: number): void {
    this.time = time;
    this.frame++;
    for (let i = this.bandits.length - 1; i >= 0; i--) {
      const v = this.bandits[i] as BanditView;
      if (this.updateBandit(v, dt)) {
        this.bandits.splice(i, 1);
        this.releaseBandit(v);
      }
    }
    for (const v of this.townsfolk) this.updateTowns(v, dt);
    this.updateTumblers(dt);
  }

  /** Returns true when the view is finished with (faded out). */
  private updateBandit(v: BanditView, dt: number): boolean {
    const b = v.b;
    const rig = v.rig;
    if (b.state !== v.lastState) {
      if (b.state === "throwing") rig.play("throw", 0.1, false);
      if (b.state === "hidden" && v.lastState === "running") rig.play("hidden", 0.1);
      v.lastState = b.state;
    }
    // Where he is.
    if (v.falling) {
      v.fallT = Math.min(v.fallDur, v.fallT + dt);
      const t = v.fallT;
      rig.root.position.set(
        v.fallFrom.x + v.fallVel.x * t,
        v.fallFrom.y + v.fallVel.y * t - 4.905 * t * t,
        v.fallFrom.z + v.fallVel.z * t,
      );
      if (t >= v.fallDur) {
        v.falling = false;
        rig.root.position.y = v.landY;
        this.sound.at("body_fall", rig.root.position, 1);
        tmp2.set(0, 1, 0);
        this.fx.dust(rig.root.position, tmp2, 1);
      }
    } else if (b.alive || v.slide.lengthSq() === 0) {
      if (b.alive) rig.root.position.set(b.pos.x, b.pos.y, b.pos.z);
    } else {
      // Momentum carries a runner (or a blast carries anyone) a little further.
      const k = Math.min(1, dt * 5);
      rig.root.position.addScaledVector(v.slide, k);
      v.slide.multiplyScalar(1 - k);
      if (v.slide.lengthSq() < 1e-4) v.slide.set(0, 0, 0);
    }
    if (v.thudIn > 0) {
      v.thudIn -= dt;
      if (v.thudIn <= 0) {
        this.sound.at("body_fall", rig.root.position, 0.9);
        tmp.copy(rig.root.position);
        tmp2.set(0, 1, 0);
        this.fx.dust(tmp, tmp2, 0.6);
      }
    }
    // Which way he faces: at you, unless running or walking the duel.
    if (b.alive) {
      if (b.state === "running" || b.state === "walking") this.faceDir(rig, b.heading.x, b.heading.z, dt);
      else this.faceToward(rig, b.pos.x, b.pos.z, dt);
    }
    // Seen or not.
    const tell = b.state === "tell" && v.tellSilhouette > 0;
    rig.root.visible = b.visible || !b.alive || tell;
    if (tell) {
      v.tellSilhouette += dt;
      const c = b.cover;
      const s = Math.sin(Math.min(1, v.tellSilhouette / 0.7) * Math.PI);
      rig.root.position.set(
        c.hidden.x + (c.exposed.x - c.hidden.x) * 0.3 * s,
        c.hidden.y,
        c.hidden.z + (c.exposed.z - c.hidden.z) * 0.9 * s,
      );
      rig.uniforms.uShade.value = 0.12;
    } else if (b.alive && v.tellSilhouette > 0) {
      v.tellSilhouette = 0;
      rig.uniforms.uShade.value = 1;
    } else if (b.alive && (b.cover.kind === "door" || b.cover.kind === "window") && (b.state === "emerging" || b.state === "hiding")) {
      // Out of the room's shade into the street's light, and back.
      const k = Math.min(1, b.exposure / 0.7);
      rig.uniforms.uShade.value = 0.4 + 0.6 * k * k * (3 - 2 * k);
    } else if (b.alive && tellFree(b.state)) {
      rig.uniforms.uShade.value = 1;
    }
    // The gun comes up toward you while aiming.
    const aiming = b.state === "aiming" || b.state === "firing";
    rig.aimAt(this.eye, aiming ? 1 : 0);
    // Fuse sparks while a stick is lit in his hand.
    if (b.lit && rig.dynamite?.visible) {
      rig.dynamite.getWorldPosition(tmp);
      tmp.y -= 0.12;
      this.fx.fuse(tmp);
    }
    // Is the sun on him? A ray every few frames, eased.
    if (rig.root.visible && --v.sunCheck <= 0) {
      v.sunCheck = 8;
      tmp.copy(rig.root.position);
      tmp.y += 1.3;
      v.sunVis = this.queries.sunReaches(tmp, this.toSun) ? 1 : 0.12;
    }
    const sv = rig.uniforms.uSunVis;
    sv.value += (v.sunVis - sv.value) * Math.min(1, dt * 6);
    if (rig.root.visible) rig.update(dt);
    // Fading away.
    if (v.fade >= 0) {
      v.fade -= dt;
      rig.setOpacity(Math.max(0, v.fade));
      if (v.fade <= 0) return true;
    }
    return false;
  }

  private updateTowns(v: TownsView, dt: number): void {
    const p = v.p;
    const rig = v.rig;
    rig.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.faceToward(rig, p.pos.x, p.pos.z, dt);
    if (p.role === "preacher") {
      rig.play("head_shake", 0.2, true, 1, false);
    } else if (p.shot) {
      if (this.time - v.hitAt > 0.35) rig.play("panic", 0.2, true, 1, false);
    } else if (p.handsUp(this.time)) {
      rig.play("hands_up", 0.15, false, 1, false);
    } else if (p.state === "peeking") {
      rig.play("peek", 0.2, true, 1, false);
    } else {
      rig.play("idle", 0.3, true, 1, false);
    }
    if (--v.sunCheck <= 0) {
      v.sunCheck = 8;
      tmp.copy(rig.root.position);
      tmp.y += 1.3;
      v.sunVis = this.queries.sunReaches(tmp, this.toSun) ? 1 : 0.12;
    }
    const sv = rig.uniforms.uSunVis;
    sv.value += (v.sunVis - sv.value) * Math.min(1, dt * 6);
    rig.update(dt);
  }

  private face(rig: Rig, x: number, z: number): void {
    rig.root.rotation.y = Math.atan2(this.eye.x - x, this.eye.z - z);
  }

  private faceToward(rig: Rig, x: number, z: number, dt: number): void {
    this.turnTo(rig, Math.atan2(this.eye.x - x, this.eye.z - z), dt);
  }

  private faceDir(rig: Rig, dx: number, dz: number, dt: number): void {
    this.turnTo(rig, Math.atan2(dx, dz), dt);
  }

  private turnTo(rig: Rig, target: number, dt: number): void {
    let d = target - rig.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    rig.root.rotation.y += d * Math.min(1, dt * 12);
  }

  private releaseRig(rig: Rig, pool: RigPool, gun: Tumbler | null = null): void {
    // The dropped gun goes back in the hand for the rig's next outing.
    if (gun && gun.object && gun.home === rig.socket) this.restore(gun);
    pool.give(rig);
  }

  private releaseBandit(v: BanditView): void {
    this.releaseRig(v.rig, v.b.role === "boss" ? this.pools.boss : this.pools.bandit, v.gun);
    v.gun = null;
  }

  /** Everything off stage (a new game). */
  reset(): void {
    for (const v of this.bandits) this.releaseBandit(v);
    for (const v of this.townsfolk) this.releaseRig(v.rig, this.pools.townsfolk);
    this.bandits.length = 0;
    this.townsfolk.length = 0;
    for (const t of this.tumblers) if (t.active) this.restore(t);
    for (const m of this.hatMeshes) m.visible = false;
  }
}
