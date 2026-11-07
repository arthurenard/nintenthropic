/**
 * The drivers who sit in the karts: nine smooth creatures modelled in
 * drivers.glb (fromArt.ts), each with a stand-in built in code (one file
 * each) for when the art is not loaded, and the rig that poses them: arms on
 * the wheel that follow its turn and lean with the body, a head that looks
 * into the bend, a cheer and a wave from the player's gesture, a happy bounce
 * at the finish, a dizzy wobble in a spin-out.
 *
 * A driver is a few merged meshes (body, head, one arm geometry for both
 * sides or one for each, and bits that move on their own: tails, antennae, a
 * scarf's end), so eight karts cost little.
 */
import {
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from "three";
import { characterById } from "../../characters";
import { clamp, damp } from "../math";
import { MeshBuilder, mergeBaked, type V3 } from "../kartBuilder";
import { SURF, kartMaterial, withStudioFallback } from "../kartMaterial";
import { ARM_LEN, HEAD_AT, SHOULDER_Y, SHOULDER_Z, look, type Look } from "./parts";
import type { Bit, BitState, DriverBuild, DriverMotion, Species } from "./types";

export type { DriverMotion, Species } from "./types";
import { buildBear } from "./bear";
import { buildCat } from "./cat";
import { buildDuck } from "./duck";
import { buildFox } from "./fox";
import { buildFrog } from "./frog";
import { buildOtter } from "./otter";
import { buildPenguin } from "./penguin";
import { buildRabbit } from "./rabbit";
import { buildRobot } from "./robot";
import { driverFromArt } from "./fromArt";
import { Lids } from "./face";

export const BUILDERS: Record<Species, (l: Look) => DriverBuild> = {
  rabbit: buildRabbit,
  penguin: buildPenguin,
  frog: buildFrog,
  fox: buildFox,
  otter: buildOtter,
  cat: buildCat,
  bear: buildBear,
  robot: buildRobot,
  duck: buildDuck,
};

/** The steering wheel in the driver's space (kartModel.ts holds the wheel itself): its centre, tilt and the radius hands hold. */
export const WHEEL = { centre: [0, 0.12, 0.52] as V3, tilt: -0.95, grip: 0.15, turn: 1.5 };

/** Drivers are drawn a little larger than life so they read from the chase camera. */
export const DRIVER_SCALE = 1.14;

// Dizzy stars: shared by every driver.
const starGeometry = (() => {
  const b = new MeshBuilder();
  b.surf = SURF.lamp;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.box(Math.cos(a) * 0.3, 0.02 * (k % 2), Math.sin(a) * 0.3, 0.1, 0.1, 0.1, [2.6, 1.9, 0.3], a, 0.6, 0.6);
  }
  return b.build();
})();
const starMaterial = new MeshBasicMaterial({ vertexColors: true, fog: false });

const _m = new Matrix4();
const _m2 = new Matrix4();
const _hand = new Vector3();
const _dir = new Vector3();
const _alt = new Vector3();
const _z = new Vector3(0, 0, 1);
const _inv = new Quaternion();

interface Arm {
  group: Group;
  side: 1 | -1;
  shoulder: Vector3;
}

export class Driver {
  /** Put this in the kart at the driver's hips (the seat). */
  readonly root = new Group();
  private readonly head = new Group();
  private readonly stars: Mesh;
  private readonly arms: Arm[] = [];
  private readonly bits: { o: Object3D; bit: Bit }[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly base = new Vector3();
  private readonly lids: Lids | null = null;
  /** How far the driver is looking back over a shoulder (-1..1, the side), eased; and how much at rest on the grid, eased. */
  private back = 0;
  private rest = 0;
  private readonly phase: number;
  private last = Number.NaN;
  private cheer = 0;
  private wave = 0;
  private fin = 0;
  private dizzy = 0;

  constructor(built: DriverBuild, base: V3 = [0, 0, 0], material: Material = kartMaterial(), species?: Species, seed = 0) {
    this.base.set(base[0], base[1], base[2]);
    this.phase = seed * 1.618;
    this.root.position.copy(this.base);
    this.root.scale.setScalar(DRIVER_SCALE);
    this.geometries.push(built.torso, built.head, built.arm);
    if (built.armR) this.geometries.push(built.armR);
    this.root.add(this.solid(built.torso, material));
    const headAt = built.headAt ?? HEAD_AT;
    this.head.position.set(headAt[0], headAt[1], headAt[2]);
    this.head.rotation.order = "YXZ";
    this.head.add(this.solid(built.head, material));
    this.root.add(this.head);
    if (species) {
      try {
        this.lids = new Lids(species, built.head, material, seed);
        this.head.add(this.lids.mesh);
      } catch {
        this.lids = null;
      }
    }
    for (const side of [1, -1] as const) {
      const group = new Group();
      const at = built.shoulderAt;
      if (at) group.position.set(side * at[0], at[1], at[2]);
      else group.position.set(side * built.shoulder, SHOULDER_Y, SHOULDER_Z);
      group.add(this.solid(side < 0 && built.armR ? built.armR : built.arm, material));
      this.root.add(group);
      this.arms.push({ group, side, shoulder: group.position.clone() });
    }
    for (const bit of built.bits) {
      const o = new Group();
      o.position.set(bit.at[0], bit.at[1], bit.at[2]);
      o.add(this.solid(bit.geo, material));
      (bit.on === "head" ? this.head : this.root).add(o);
      this.bits.push({ o, bit });
      this.geometries.push(bit.geo);
    }
    this.stars = new Mesh(starGeometry, starMaterial);
    this.stars.position.set(0, built.crown + 0.12, 0);
    this.stars.visible = false;
    this.head.add(this.stars);
  }

  /** A mesh that throws and catches shadows. */
  private solid(geometry: BufferGeometry, material: Material): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    withStudioFallback(mesh);
    return mesh;
  }

  /**
   * The driver as it stands now, welded into one geometry in the kart's space
   * (the far kart draws this instead of the live rig). Call after `update`.
   */
  bake(): BufferGeometry {
    this.root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(this.root.parent ? this.root.parent.matrixWorld : new Matrix4()).invert();
    const parts: { geometry: BufferGeometry; matrix: Matrix4 }[] = [];
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh === this.stars || !mesh.visible) return;
      parts.push({ geometry: mesh.geometry, matrix: new Matrix4().multiplyMatrices(inv, mesh.matrixWorld) });
    });
    return mergeBaked(parts);
  }

  /** Where a hand on the wheel is, on the side `side` (+1: the driver's left), in the driver's space at rest. */
  private grip(side: 1 | -1, turn: number, out: Vector3): Vector3 {
    const a = side > 0 ? 0.2 : Math.PI - 0.2;
    _m.makeRotationX(WHEEL.tilt).multiply(_m2.makeRotationZ(turn));
    out.set(Math.cos(a) * WHEEL.grip, Math.sin(a) * WHEEL.grip, 0).applyMatrix4(_m);
    return out.set(out.x + WHEEL.centre[0], out.y + WHEEL.centre[1], out.z + WHEEL.centre[2]);
  }

  update(m: DriverMotion): void {
    const dt = Number.isFinite(this.last) ? clamp(m.time - this.last, 0, 0.1) : 0;
    this.last = m.time;
    const t = m.time;
    const snap = dt === 0 ? 1 : 0;
    const to = (now: number, goal: number, rate: number): number => (snap ? goal : damp(now, goal, rate, dt));
    this.cheer = to(this.cheer, m.emote === "cheer" || m.twirl > 0 ? 1 : 0, 14);
    this.wave = to(this.wave, m.emote === "wave" ? 1 : 0, 14);
    this.fin = to(this.fin, m.finished ? 1 : 0, 8);
    this.dizzy = to(this.dizzy, m.dizzy ? 1 : 0, 10);
    const happy = Math.max(this.cheer, this.fin * 0.85);
    this.back = to(this.back, m.lookBack ?? 0, 7);
    this.rest = to(this.rest, m.rest ?? 0, 4);

    // The body: bounces when happy, leans into the bend, twirls in a trick.
    const bounce = Math.abs(Math.sin(t * 9.5)) * 0.075 * happy + Math.abs(Math.sin(t * 6)) * 0.02 * this.wave;
    // On the grid the driver breathes, and settles in the seat now and then.
    const breath = Math.sin(t * 2.3 + this.phase) * 0.012 * this.rest;
    this.root.position.set(this.base.x, this.base.y + bounce, this.base.z);
    this.root.rotation.set(0, m.twirl + this.back * 0.28, m.lean);
    this.root.scale.set(DRIVER_SCALE * (1 - breath * 0.4), DRIVER_SCALE * (1 + breath), DRIVER_SCALE);

    // The head looks into the bend; dizzy, it rolls about.
    const sway = Math.sin(t * 7) * 0.1 * this.fin + Math.sin(t * 5) * 0.14 * this.wave;
    // Waiting on the grid, the head wanders over the track and its neighbours; looking back, it turns over the shoulder.
    const glance = (Math.sin(t * 0.7 + this.phase) * 0.55 + Math.sin(t * 1.9 + this.phase * 2) * 0.25) * this.rest;
    this.head.rotation.set(
      Math.cos(t * 11) * 0.22 * this.dizzy - 0.08 * happy + Math.sin(t * 0.9 + this.phase) * 0.05 * this.rest - Math.abs(this.back) * 0.06,
      (-m.steer * 0.4 + sway + glance) * (1 - Math.abs(this.back)) + this.back * 1.5,
      -m.lean * 0.35 + Math.sin(t * 13) * 0.34 * this.dizzy,
    );
    this.lids?.update(t, happy, this.dizzy, m.shut ?? 0);
    this.stars.visible = this.dizzy > 0.05;
    if (this.stars.visible) this.stars.rotation.y = t * 6;

    // The arms: on the wheel, or up (cheer), waving (the right arm), or flailing (dizzy).
    _inv.copy(this.root.quaternion).invert();
    for (const arm of this.arms) {
      const { side, shoulder, group } = arm;
      // The wheel's hand, in the leaned body's own space.
      this.grip(side, -m.steer * WHEEL.turn, _hand);
      _hand.y -= bounce;
      _hand.applyQuaternion(_inv).divideScalar(DRIVER_SCALE).sub(shoulder);
      let length = _hand.length();
      _dir.copy(_hand).divideScalar(length || 1);
      const phase = side * 1.3;
      // Cheering: both arms straight up, a little apart, pumping.
      const upX = side * (0.32 + 0.1 * Math.sin(t * 9.5 + phase));
      this.blend(_dir, _alt.set(upX, 1, 0.12), this.cheer);
      // Waving: the right arm (-x) raised, its hand sweeping side to side.
      if (side < 0) this.blend(_dir, _alt.set(-0.5 + 0.45 * Math.sin(t * 10), 1, 0.14), this.wave);
      // Dizzy: flung out and wobbling.
      this.blend(_dir, _alt.set(side * 0.95, 0.25 + 0.55 * Math.sin(t * 12 + phase), 0.3 * Math.cos(t * 9 + phase)), this.dizzy);
      _dir.normalize();
      const free = Math.max(this.cheer, side < 0 ? this.wave : 0, this.dizzy);
      length = length + (ARM_LEN - length) * free;
      group.quaternion.setFromUnitVectors(_z, _dir);
      group.scale.set(1, 1, clamp(length / ARM_LEN, 0.7, 1.35));
    }

    const state: BitState = { time: t, happy, dizzy: this.dizzy, steer: m.steer, lean: m.lean };
    for (const { o, bit } of this.bits) bit.move?.(o, state);
  }

  private blend(dir: Vector3, toward: Vector3, weight: number): void {
    if (weight < 0.001) return;
    dir.lerp(toward.normalize(), clamp(weight));
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
  }
}

/** The species a driver id shows as (an unknown or missing id shows as `fallback`). */
export function speciesOf(character: string | undefined, fallback: Species = "fox"): Species {
  return characterById(character)?.species ?? fallback;
}

/** The driver of this species in the kart's colour: from the modelled art (drivers.glb) when it is loaded, else built in code. */
export function createDriver(species: Species, colour: string, base: V3 = [0, 0, 0], material?: Material): Driver {
  const l = look(colour);
  const code = BUILDERS[species](l);
  let seed = 0;
  for (let i = 0; i < colour.length; i++) seed = (seed * 31 + colour.charCodeAt(i)) % 997;
  return new Driver(driverFromArt(species, l, code) ?? code, base, material, species, seed);
}
