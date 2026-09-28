/**
 * Everyone the rules put in the valley, on stage: soldiers, the valley's
 * people and animals on the engine's rigs (a fixed pool of each, made at
 * load), the trucks and the jeep as clones of the art's, each placed where
 * the rules say, turned the way they face, playing the clip for what they
 * are doing, lit by the sun only where it reaches them. And the test the
 * rounds in flight make against all of them (shots.ts's MovingWorld).
 */
import {
  Box3,
  Color,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Raycaster,
  Sphere,
  SphereGeometry,
  MeshStandardMaterial,
  Vector3,
  type AnimationClip,
  type Material,
} from "three";
import { effectiveRadius, probePoint, probeSegment, type RayProbe } from "../../../engine/rules/raymath";
import { RigPool, rimLight, templateFrom, turnRig, type CharacterTemplate, type Rig } from "../../../engine/world/character";
import { contractName, findNode } from "../../../engine/world/names";
import type { LoadedAsset } from "../../../engine/types";
import type { Actor, Vehicle } from "../rules/actors";
import type { Activity, AnimalKind } from "../rules/types";
import { patchStandard, type AtmosphereUniforms } from "./atmosphere";
import type { Heightfield } from "./heightfield";
import type { MovingHit, MovingWorld } from "./shots";

/** When a file lacks a clip, what to play instead. */
const FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  idle_smoke: ["idle"],
  look_binoculars: ["idle"],
  patrol_walk: ["walk"],
  walk: ["patrol_walk", "idle"],
  run: ["walk"],
  crouch: ["idle"],
  prone: ["prone_aim", "crouch"],
  prone_aim: ["prone", "aim"],
  aim: ["idle"],
  fire: ["aim"],
  hit_body: ["idle"],
  wound_kneel: ["crouch", "death_crumple"],
  wounded: ["wound_kneel", "crouch"],
  // The civilians' one death, and the soldier's special ones (art/ridge/people).
  death_back: ["death_forward", "death_crumple", "death"],
  death_forward: ["death_back", "death_crumple", "death"],
  death_crumple: ["death_forward", "death_back", "death"],
  drive_death: ["death_crumple"],
  prone_death: ["death_forward", "death_crumple"],
  prone_fire: ["prone_aim", "fire"],
  stare: ["land", "stand"],
  dismount: ["run", "walk"],
  drive: ["idle"],
  cycle: ["idle"],
  wave: ["idle"],
  panic: ["run", "walk"],
  duck: ["crouch", "idle"],
  graze: ["idle", "stand"],
  look_up: ["idle", "stand"],
  stand: ["idle", "graze"],
  hop: ["stand"],
  bleat: ["stand"],
  glide: ["flap"],
  flap: ["glide"],
  land: ["glide"],
};

type Kind = "soldier" | "civilian" | AnimalKind;

/** The clip for what someone is doing. */
function clipFor(a: Actor): { clip: string; loop: boolean; speed: number } {
  const act: Activity = a.activity;
  const walkSpeed = Math.hypot(a.vel.x, a.vel.z);
  switch (act) {
    case "smoke":
      return { clip: "idle_smoke", loop: true, speed: 1 };
    case "binoculars":
      return { clip: "look_binoculars", loop: true, speed: 1 };
    case "walk":
      // The art's gaits: walk 1.30 m/s, patrol 1.05, run 3.60 (art/ridge/people), so nothing skates.
      return { clip: "walk", loop: true, speed: Math.max(0.5, walkSpeed / 1.3) };
    case "patrol_walk":
      return { clip: "patrol_walk", loop: true, speed: Math.max(0.5, walkSpeed / 1.05) };
    case "run":
      return { clip: "run", loop: true, speed: Math.max(0.7, walkSpeed / 3.6) };
    case "crouch":
    case "prone":
    case "prone_aim":
    case "aim":
    case "drive":
    case "wave":
    case "panic":
    case "duck":
      return { clip: act, loop: true, speed: 1 };
    case "cycle":
      return { clip: "cycle", loop: true, speed: Math.max(0.5, walkSpeed / 4.58) };
    case "fire":
      return { clip: a.role === "sniper" ? "prone_fire" : "fire", loop: false, speed: 1 };
    case "wound":
      // Down on a knee, then holding there, hurt.
      return a.activityT > 0.9 ? { clip: "wounded", loop: true, speed: 1 } : { clip: "wound_kneel", loop: false, speed: 1 };
    case "dying":
    case "dead":
      return { clip: a.seat === "driver" ? "drive_death" : a.role === "sniper" ? "prone_death" : a.deathClip, loop: false, speed: 1 };
    case "dismount":
      return { clip: "dismount", loop: false, speed: 1 };
    case "graze":
    case "stand":
    case "glide":
    case "flap":
      return { clip: act, loop: true, speed: 1 };
    case "look_up":
    case "hop":
    case "bleat":
    case "land":
      return { clip: act, loop: false, speed: 1 };
    case "perched":
      return { clip: "stare", loop: true, speed: 1 };
    default:
      return { clip: "idle", loop: true, speed: 1 };
  }
}

/** What each role wears and holds. */
function dress(rig: Rig, a: Actor): void {
  const role = a.role;
  const props = (names: string[]) => {
    for (const [name, o] of rig.props) o.visible = names.includes(name);
  };
  switch (role) {
    case "officer":
      rig.dress(["var.cap.officer", "var.coat.officer"]);
      props(a.activity === "binoculars" ? ["prop.binoculars"] : []);
      break;
    case "sniper":
      rig.dress(["var.ghillie"]);
      props(rig.props.has("gun.rifle.scoped") ? ["gun.rifle.scoped"] : ["gun.rifle"]);
      break;
    case "gunner":
      rig.dress(["var.helmet"]);
      props(a.activity === "smoke" ? ["prop.cigarette"] : ["gun.mg"]);
      break;
    case "driver":
      rig.dress(["var.helmet"]);
      props([]);
      break;
    case "farmer":
      rig.dress(["var.person.farmer"]);
      props([]);
      break;
    case "cyclist":
      rig.dress(["var.person.cyclist"]);
      props([]);
      break;
    case "shepherd":
      rig.dress(["var.person.shepherd"]);
      props(["prop.crook"]);
      break;
    case "child":
      rig.dress(["var.person.child"]);
      props([]);
      break;
    default: {
      // Sentries, guards, the patrol, troopers, the mortar crew.
      const pack = role === "patrol" || role === "trooper";
      if (a.activity === "smoke") {
        rig.dress(["var.helmet", "var.sling", ...(pack ? ["var.pack"] : [])]);
        props(["prop.cigarette", "gun.rifle.slung"]);
      } else if (a.activity === "binoculars") {
        rig.dress(["var.helmet", "var.sling", ...(pack ? ["var.pack"] : [])]);
        props(["prop.binoculars", "gun.rifle.slung"]);
      } else {
        rig.dress(["var.helmet", ...(pack ? ["var.pack"] : [])]);
        props(role === "mortar" ? [] : ["gun.rifle"]);
      }
    }
  }
}

interface View {
  actor: Actor;
  kind: Kind;
  rig: Rig;
  pool: RigPool;
  clip: string;
  activity: Activity | "";
  bicycle: Object3D | null;
  wheels: Object3D[];
  crank: Object3D | null;
  sunCheck: number;
  lastRole: string;
}

export interface VehicleView {
  v: Vehicle;
  root: Object3D;
  wheels: Object3D[];
  glass: Mesh[];
  engine: Object3D | null;
  seat: Object3D | null;
  meshes: Mesh[];
  engineBox: Box3;
  steamT: number;
  roll: number;
}

const probe: RayProbe = { t: 0, miss: 0 };
const tmp = new Vector3();
const tmp2 = new Vector3();
const dir = new Vector3();
const MID = new Vector3();
const inv = new Matrix4();

/** An animal's own subtree and its clips (`cow.graze` → `graze`), as a file of its own. */
function animalAsset(asset: LoadedAsset, kind: AnimalKind): LoadedAsset | null {
  const node = findNode(asset.scene, kind);
  if (!node) return null;
  node.removeFromParent();
  node.position.set(0, node.position.y, 0);
  node.rotation.set(0, 0, 0);
  const group = new Group();
  group.add(node);
  const clips: AnimationClip[] = [];
  for (const c of asset.animations) {
    const m = /^([a-z]+)[._](.+)$/.exec(c.name);
    if (m && m[1] === kind) {
      const clip = c.clone();
      clip.name = m[2]!;
      clips.push(clip);
    }
  }
  return { scene: group, animations: clips };
}

export interface CastAssets {
  soldier: LoadedAsset;
  civilian: LoadedAsset;
  vehicles: LoadedAsset;
  animals: LoadedAsset;
}

export class Cast implements MovingWorld {
  readonly views = new Map<number, View>();
  readonly vehicles = new Map<number, VehicleView>();
  private readonly pools = new Map<Kind, RigPool>();
  private readonly templates = new Map<Kind, CharacterTemplate>();
  private readonly vehicleTemplates = new Map<string, Object3D>();
  private readonly raycaster = new Raycaster();
  private readonly duckMesh: Mesh;
  private readonly duckRadius: number;
  /** The duck's actor id, once it is in the river. */
  private duckId = -1;
  /** Radians of aim assist on a hostile's body (a finger is not a mouse); 0 for a pointer. */
  assist = 0;
  /** The sun's elevation now, and its direction on the ground, for who is in the light. */
  sunElevation = 0.1;
  readonly sunFlat = new Vector3(-0.5, 0, 0.85).normalize();
  /** The ground's horizon toward the sun from a point (radians), if the stage knows better than the height grid. */
  horizonAt: ((x: number, y: number, z: number) => number) | null = null;
  private time = 0;

  constructor(
    assets: CastAssets,
    private readonly parent: Group,
    private readonly heightfield: Heightfield,
    private readonly atmosphere: AtmosphereUniforms,
    private readonly eye: Vector3,
    duck: Object3D | null,
  ) {
    const rim = rimLight(new Color(0.7, 0.76, 0.92));
    this.templates.set("soldier", templateFrom("soldier", assets.soldier, [], { fallbacks: FALLBACKS, rim }));
    this.templates.set("civilian", templateFrom("civilian", assets.civilian, assets.soldier.animations, { fallbacks: FALLBACKS, rim }));
    for (const kind of ["cow", "sheep", "goat", "eagle", "dog"] as AnimalKind[]) {
      const a = animalAsset(assets.animals, kind);
      if (a) this.templates.set(kind, templateFrom(kind, a, [], { fallbacks: FALLBACKS, rim }));
    }
    const counts: Partial<Record<Kind, number>> = { soldier: 22, civilian: 6, cow: 8, sheep: 10, goat: 1, eagle: 1, dog: 1 };
    for (const [kind, template] of this.templates) {
      const pool = new RigPool(template, counts[kind] ?? 1, parent);
      for (const rig of pool.rigs) this.patchRig(rig);
      this.pools.set(kind, pool);
    }
    for (const name of ["truck", "jeep"]) {
      const t = findNode(assets.vehicles.scene, name);
      if (t) {
        t.removeFromParent();
        t.position.set(0, 0, 0);
        this.vehicleTemplates.set(name, t);
      }
    }
    // The rubber duck: the art's if it made one, else a little yellow one made here.
    if (duck && (duck as Mesh).isMesh) {
      this.duckMesh = duck as Mesh;
    } else {
      // A giant one, a metre long: through the scope at six hundred metres it is a yellow speck.
      const body = new Mesh(new SphereGeometry(0.4, 14, 10), new MeshStandardMaterial({ color: "#ffd21a", roughness: 0.45, name: "duck" }));
      body.scale.set(1, 0.75, 1.25);
      const head = new Mesh(new SphereGeometry(0.24, 12, 8), body.material);
      head.position.set(0, 0.36, 0.27);
      const beak = new Mesh(new SphereGeometry(0.1, 8, 6), new MeshStandardMaterial({ color: "#f07a1a", roughness: 0.5 }));
      beak.scale.set(1, 0.5, 1.4);
      beak.position.set(0, 0.33, 0.5);
      body.add(head, beak);
      this.duckMesh = body;
    }
    this.duckMesh.visible = false;
    // How close a round must pass to hit it: most of its size, whoever made it.
    this.duckRadius = Math.max(0.12, new Box3().setFromObject(this.duckMesh).getBoundingSphere(new Sphere()).radius * 0.75);
    this.duckMesh.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) patchStandard(mat, atmosphere, true);
    });
    parent.add(this.duckMesh);
  }

  /** Every material of a rig in the valley's air (the sun is the rig's own key light, set from the light map below). */
  private patchRig(rig: Rig): void {
    rig.model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as Material[]) patchStandard(mat, this.atmosphere, false);
    });
  }

  private kindOf(a: Actor): Kind {
    if (a.side === "animal") return a.role as AnimalKind;
    return a.side === "civilian" ? "civilian" : "soldier";
  }

  spawn(a: Actor): void {
    if (a.role === "duck") {
      this.duckId = a.id;
      this.duckMesh.visible = true;
      return;
    }
    if (this.views.has(a.id)) return;
    const kind = this.kindOf(a);
    const pool = this.pools.get(kind);
    const rig = pool?.take() ?? null;
    if (!pool || !rig) return;
    rig.root.visible = !a.hidden;
    rig.root.scale.setScalar(a.scale);
    const bicycle = rig.model.getObjectByName("bicycle") ?? null;
    const view: View = { actor: a, kind, rig, pool, clip: "", activity: "", bicycle, wheels: [], crank: null, sunCheck: 0, lastRole: "" };
    if (bicycle) {
      bicycle.visible = a.role === "cyclist";
      bicycle.traverse((o) => {
        const n = contractName(o);
        if (n.startsWith("bicycle.wheel")) view.wheels.push(o);
        if (n === "bicycle.crank") view.crank = o;
      });
    }
    if (kind === "soldier" || kind === "civilian") dress(rig, a);
    this.views.set(a.id, view);
    this.place(view, 0);
  }

  gone(a: Actor): void {
    if (a.id === this.duckId) return;
    const v = this.views.get(a.id);
    if (!v) return;
    if (v.bicycle) v.bicycle.visible = false;
    v.rig.root.scale.setScalar(1);
    v.pool.give(v.rig);
    this.views.delete(a.id);
  }

  vehicleSpawn(v: Vehicle): void {
    const t = this.vehicleTemplates.get(v.kind);
    if (!t) return;
    const root = t.clone(true);
    const view: VehicleView = { v, root, wheels: [], glass: [], engine: null, seat: null, meshes: [], engineBox: new Box3(), steamT: 0, roll: 0 };
    root.traverse((o) => {
      const n = contractName(o);
      if (/^wheel\.\d+$/.test(n)) view.wheels.push(o);
      if (n === "engine") view.engine = o;
      if (n === "seat.driver") view.seat = o;
      const m = o as Mesh;
      if (m.isMesh) {
        // Each vehicle its own glass (it breaks), the rest shared.
        if (n === "cab.glass" || /glass/i.test((Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? "")) {
          m.material = (m.material as Material).clone();
          view.glass.push(m);
        }
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as Material[]) {
          if (!mat.userData["ridgePatched"]) {
            mat.userData["ridgePatched"] = true;
            patchStandard(mat, this.atmosphere, true);
          }
        }
        m.frustumCulled = true;
        view.meshes.push(m);
      }
    });
    if (view.engine) {
      const e = view.engine as Mesh;
      if (e.isMesh) {
        e.geometry.computeBoundingBox();
        view.engineBox.copy(e.geometry.boundingBox!);
      } else {
        view.engineBox.setFromObject(e);
        view.engine.updateMatrixWorld(true);
        view.engineBox.applyMatrix4(inv.copy(view.engine.matrixWorld).invert());
      }
    }
    this.parent.add(root);
    this.vehicles.set(v.id, view);
    this.placeVehicle(view, 0);
  }

  vehicleGone(v: Vehicle): void {
    const view = this.vehicles.get(v.id);
    if (!view) return;
    view.root.removeFromParent();
    this.vehicles.delete(v.id);
  }

  /** The glass of a vehicle gives way (a shot through it). */
  crackGlass(id: number): void {
    const view = this.vehicles.get(id);
    if (!view) return;
    for (const g of view.glass) {
      const m = g.material as MeshStandardMaterial;
      if (m.color) m.color.multiplyScalar(1.6);
      m.transparent = true;
      m.opacity = 0.5;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const view of this.vehicles.values()) this.placeVehicle(view, dt);
    for (const view of this.views.values()) this.place(view, dt);
    const duck = this.duckId >= 0 ? this.duckMesh : null;
    if (duck) {
      // Bobbing on the current.
      duck.position.y += Math.sin(this.time * 2.3) * 0.02;
    }
  }

  /** Put the duck where the rules have it. */
  placeDuck(a: Actor, bob: number): void {
    const d = this.duckMesh;
    d.position.set(a.pos.x, a.pos.y + 0.12 + Math.sin(this.time * 2.3) * 0.04 + bob, a.pos.z);
    d.rotation.y = a.heading + Math.sin(this.time * 0.7) * 0.4;
    d.rotation.z = Math.sin(this.time * 1.7) * 0.12 + bob * 1.5;
  }

  get duck(): Object3D {
    return this.duckMesh;
  }

  private placeVehicle(view: VehicleView, dt: number): void {
    const v = view.v;
    const ground = this.heightfield.height(v.pos.x, v.pos.z);
    view.root.position.set(v.pos.x, Math.max(ground, v.pos.y), v.pos.z);
    view.root.rotation.y = v.heading;
    view.roll += (v.speed * dt) / 0.5;
    for (const w of view.wheels) w.rotation.x = view.roll;
    view.root.updateMatrixWorld(true);
  }

  /** Where a rider sits: the vehicle's seat, or near enough. */
  private seatOf(a: Actor): Vector3 | null {
    const v = a.vehicle;
    if (!v) return null;
    const view = this.vehicles.get(v.id);
    if (!view) return null;
    if (a.seat === "driver" && view.seat) return view.seat.getWorldPosition(tmp2);
    return null;
  }

  private place(view: View, dt: number): void {
    const a = view.actor;
    const rig = view.rig;
    const hidden = a.hidden || a.activity === "hidden";
    rig.root.visible = !hidden;
    if (view.lastRole !== a.activity && (view.kind === "soldier" || view.kind === "civilian")) {
      dress(rig, a);
      view.lastRole = a.activity;
    }
    // Where: the seat of a vehicle, or his feet on the ground (or the tower's boards, the dam, the bridge).
    const seat = a.seat === "driver" ? this.seatOf(a) : null;
    if (seat) {
      rig.root.position.copy(seat);
      rig.root.rotation.y = a.vehicle?.heading ?? a.heading;
    } else {
      const ground = this.heightfield.height(a.pos.x, a.pos.z);
      const flying = a.role === "eagle";
      rig.root.position.set(a.pos.x, flying ? a.pos.y : Math.max(ground, a.pos.y), a.pos.z);
      if (a.role === "goat" && a.activity === "hop") {
        // The leap: an arc from this ledge up to the next (the rules move it there when it lands).
        const k = Math.min(1, a.activityT / 1.2);
        // The arc scaled to the gap: half its width high (the real crag's ledges are a short hop apart).
        const gap = Math.hypot(a.home.x - a.pos.x, a.home.z - a.pos.z);
        rig.root.position.set(a.pos.x + (a.home.x - a.pos.x) * k, a.pos.y + (a.home.y - a.pos.y) * k + Math.sin(Math.PI * k) * Math.min(3.5, Math.max(0.6, gap * 0.5)), a.pos.z + (a.home.z - a.pos.z) * k);
      }
      if (dt > 0) turnRig(rig, a.heading, dt);
      else rig.root.rotation.y = a.heading;
      // Banking on the wind in flight; level on its rock.
      if (flying) rig.root.rotation.z = a.activity === "glide" || a.activity === "flap" ? Math.sin(this.time * 0.9 + a.id) * 0.25 : 0;
    }
    // What: the clip for his activity.
    const want = clipFor(a);
    if (want.clip !== view.clip || a.activity !== view.activity) {
      const restart = a.activity !== view.activity || want.clip !== view.clip;
      // The eagle's wing sets swap by bone scale: its clips are cut, never cross-faded (art/ridge/fauna).
      rig.play(want.clip, view.clip && a.role !== "eagle" ? 0.25 : 0, want.loop, want.speed, restart);
      view.clip = want.clip;
      view.activity = a.activity;
    } else if (rig.current && want.loop) {
      rig.current.timeScale = want.speed;
    }
    if (view.bicycle && a.role === "cyclist") {
      const sp = Math.hypot(a.vel.x, a.vel.z);
      for (const w of view.wheels) w.rotation.x += (sp * dt) / 0.33;
      if (view.crank) view.crank.rotation.x += (sp * dt) / 0.9;
    }
    // Is the sun on him? Checked now and then, eased.
    view.sunCheck -= dt;
    if (view.sunCheck <= 0) {
      view.sunCheck = 0.5 + (a.id % 7) * 0.05;
      const p = rig.root.position;
      const horizon = this.horizonAt ? this.horizonAt(p.x, p.y + 1.3, p.z) : this.heightfield.horizon(p.x, p.y + 1.3, p.z, this.sunFlat.x, this.sunFlat.z);
      const lit = Math.min(1, Math.max(0, (this.sunElevation - horizon) / 0.02 + 0.5));
      (rig as Rig & { sunTarget?: number }).sunTarget = lit;
    }
    const target = (rig as Rig & { sunTarget?: number }).sunTarget ?? 0;
    rig.lighting.key.value += (target - rig.lighting.key.value) * Math.min(1, dt * 3);
    if (!hidden) rig.update(dt);
  }

  // --- the rounds ------------------------------------------------------------------------

  /** A piece of a round's path against everyone and everything that moves. */
  test(a: Vector3, b: Vector3, near: (id: number, distance: number) => void): MovingHit | null {
    const len = a.distanceTo(b);
    if (len < 1e-6) return null;
    dir.copy(b).sub(a).divideScalar(len);
    let best: MovingHit | null = null;
    let bestT = len;
    const consider = (t: number, hit: Omit<MovingHit, "t" | "point" | "normal">) => {
      if (t < 0 || t > bestT) return;
      bestT = t;
      const point = new Vector3().copy(dir).multiplyScalar(t).add(a);
      best = { ...hit, t: t / len, point, normal: new Vector3().copy(dir).negate() };
    };
    const mid = MID.copy(a).add(b).multiplyScalar(0.5);
    for (const view of this.views.values()) {
      const act = view.actor;
      if (!view.rig.root.visible) continue;
      const root = view.rig.root.position;
      if (root.distanceTo(mid) > len / 2 + 14) continue;
      // Near passes: how close it came to his chest.
      probePoint(a, dir, tmp2.set(root.x, root.y + 1.2 * act.scale, root.z), probe);
      if (probe.t >= -2 && probe.t <= len + 2) near(act.id, probe.miss);
      if (!act.alive && act.activity === "dead" && act.side !== "animal") continue;
      if (view.kind === "soldier" || view.kind === "civilian") this.humanHit(view, a, len, consider);
      else this.animalHit(view, a, len, consider);
    }
    // The duck.
    if (this.duckId >= 0 && this.duckMesh.visible) {
      probePoint(a, dir, this.duckMesh.position, probe);
      if (probe.t >= 0 && probe.t <= len) {
        near(this.duckId, probe.miss);
        if (probe.miss < this.duckRadius) consider(probe.t, { kind: "duck", id: this.duckId, part: "body", surface: "water" });
      }
    }
    // The vehicles: the engine block first (under the bonnet), then the glass, then the body.
    for (const view of this.vehicles.values()) {
      if (view.root.position.distanceTo(mid) > len / 2 + 8) continue;
      if (view.engine) {
        view.engine.updateMatrixWorld(true);
        inv.copy(view.engine.matrixWorld).invert();
        const la = tmp.copy(a).applyMatrix4(inv);
        const lb = tmp2.copy(b).applyMatrix4(inv);
        const t = segmentBox(la, lb, view.engineBox, 0.08);
        if (t >= 0) consider(t * len, { kind: "engine", id: view.v.id, part: "body", surface: "metal" });
      }
      this.raycaster.set(a, dir);
      this.raycaster.near = 0;
      this.raycaster.far = bestT;
      const hits = this.raycaster.intersectObjects(view.meshes, false);
      for (const h of hits) {
        const glass = view.glass.includes(h.object as Mesh);
        consider(h.distance, { kind: glass ? "glass" : "vehicle", id: view.v.id, part: "body", surface: glass ? "glass" : "metal" });
        break;
      }
    }
    return best;
  }

  /** A man: head, body and limbs from his joints, as High Noon's shooter tests them. */
  private humanHit(view: View, a: Vector3, len: number, consider: (t: number, hit: Omit<MovingHit, "t" | "point" | "normal">) => void): void {
    const act = view.actor;
    const j = view.rig.updateJoints();
    const s = act.scale;
    const ghillie = act.role === "sniper";
    const headR = (ghillie ? 0.16 : act.side === "civilian" ? 0.11 : 0.13) * s;
    const bodyR = (ghillie ? 0.26 : 0.19) * s;
    probePoint(a, dir, j.head, probe);
    if (probe.t >= 0 && probe.t <= len && probe.miss <= headR) consider(probe.t, { kind: "actor", id: act.id, part: "head", surface: "cloth" });
    probeSegment(a, dir, j.hips, j.neck, probe);
    // Honest help for a finger on a hostile's body only; never on anyone else.
    const r = act.side === "hostile" ? effectiveRadius(bodyR, probe.t, this.assist) : bodyR;
    if (probe.t >= 0 && probe.t <= len && probe.miss <= r) consider(probe.t, { kind: "actor", id: act.id, part: "body", surface: "cloth" });
    const limb = (p: Vector3, q: Vector3, rr: number) => {
      probeSegment(a, dir, p, q, probe);
      if (probe.t >= 0 && probe.t <= len && probe.miss <= rr * s) consider(probe.t, { kind: "actor", id: act.id, part: "limb", surface: "cloth" });
    };
    limb(j.shoulderL, j.elbowL, 0.065);
    limb(j.elbowL, j.handL, 0.055);
    limb(j.shoulderR, j.elbowR, 0.065);
    limb(j.elbowR, j.handR, 0.055);
    limb(j.thighL, j.kneeL, 0.09);
    limb(j.kneeL, j.footL, 0.07);
    limb(j.thighR, j.kneeR, 0.09);
    limb(j.kneeR, j.footR, 0.07);
  }

  /** An animal: a capsule along its body, or a ball for the eagle. */
  private animalHit(view: View, a: Vector3, len: number, consider: (t: number, hit: Omit<MovingHit, "t" | "point" | "normal">) => void): void {
    const act = view.actor;
    const p = view.rig.root.position;
    const h = act.heading;
    const shape: Record<string, [number, number, number]> = {
      // [half length, radius, height of the body's axis]
      cow: [0.9, 0.5, 1.0],
      sheep: [0.45, 0.33, 0.55],
      goat: [0.4, 0.28, 0.55],
      dog: [0.35, 0.22, 0.4],
      eagle: [0.3, 0.45, 0],
    };
    const [half, r, y] = shape[act.role] ?? [0.4, 0.3, 0.5];
    const fx = Math.sin(h) * half;
    const fz = Math.cos(h) * half;
    probeSegment(a, dir, tmp.set(p.x - fx, p.y + y, p.z - fz), tmp2.set(p.x + fx, p.y + y, p.z + fz), probe);
    if (probe.t >= 0 && probe.t <= len && probe.miss <= r) consider(probe.t, { kind: "actor", id: act.id, part: "body", surface: "cloth" });
  }

  /** A point on someone to look at them by: the chest, or a lens at the eyes for a glint. */
  chestOf(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    if (!v) return null;
    const j = v.rig.updateJoints();
    return out.copy(j.hips).lerp(j.neck, 0.6);
  }

  headOf(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    if (!v) return null;
    return out.copy(v.rig.updateJoints().head);
  }

  /** Where a rifle's muzzle or a lens is on someone, facing the ridge. */
  lensOf(id: number, out: Vector3): Vector3 | null {
    // The scoped rifle's own lens, where the art marks it.
    const v = this.views.get(id);
    const glint = v ? findNode(v.rig.model, "socket.glint") : null;
    if (glint && (v?.rig.props.get("gun.rifle.scoped")?.visible ?? false)) return glint.getWorldPosition(out);
    const head = this.headOf(id, out);
    if (!head) return null;
    const toEye = tmp.copy(this.eye).sub(head).normalize();
    return out.addScaledVector(toEye, 0.35);
  }

  /** The vehicles' engines, for their steam. */
  engineOf(id: number, out: Vector3): Vector3 | null {
    const view = this.vehicles.get(id);
    if (!view?.engine) return null;
    return view.engine.getWorldPosition(out).add(tmp.set(0, 0.4, 0));
  }

  view(id: number): View | undefined {
    return this.views.get(id);
  }

  reset(): void {
    for (const v of [...this.views.values()]) this.gone(v.actor);
    for (const v of [...this.vehicles.values()]) this.vehicleGone(v.v);
    this.duckMesh.visible = false;
    this.duckId = -1;
  }

  dispose(): void {
    for (const p of this.pools.values()) p.dispose();
  }
}

/** Where segment a→b (in the box's space) first enters `box` grown by `pad`, as a fraction, or −1. */
function segmentBox(a: Vector3, b: Vector3, box: Box3, pad: number): number {
  let t0 = 0;
  let t1 = 1;
  for (const k of ["x", "y", "z"] as const) {
    const d = b[k] - a[k];
    const lo = box.min[k] - pad;
    const hi = box.max[k] + pad;
    if (Math.abs(d) < 1e-9) {
      if (a[k] < lo || a[k] > hi) return -1;
      continue;
    }
    let ta = (lo - a[k]) / d;
    let tb = (hi - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
