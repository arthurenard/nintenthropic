/**
 * The karts' side of the picture: what a model must offer (`KartModel`,
 * made by a `KartFactory`) and the actor that poses it from a KartView.
 *
 * The procedural toy is in kartModel.ts. Being behind a small factory, a
 * Blender-made glTF can replace it later without touching anything else: all
 * the renderer needs from a model is a root to place and a `pose()` to
 * animate. The actor owns
 * what is true of every kart whatever it looks like: where it is, the roll,
 * pitch and lean it shows from its motion, the spin-out, the hop, and its
 * blob shadow.
 *
 * Built facing +z; its left is +x (so its right is -x), which is what
 * `rotation.y = heading` expects (contract.ts).
 */
import { AdditiveBlending, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D, type Texture } from "three";
import type { KartView, RacerSetup } from "../contract";
import type { TrackGeometry } from "../track/geometry";
import { clamp, damp, easeOutCubic, lerp, TAU } from "./math";

// ─── The model's contract ──────────────────────────────────────────────────

/** What a model is asked to show on one frame. Angles in radians. */
export interface KartPose {
  /** The steer being answered, -1 (left) .. 1 (right): turns the front wheels and the driver's head. */
  steer: number;
  /** Total wheel turn so far, radians (the actor integrates speed). */
  wheelSpin: number;
  /** The driver's lean; + is toward the kart's right. */
  lean: number;
  /** Body roll; + tips the top toward the right. */
  roll: number;
  /** Body pitch; + lifts the nose. */
  pitch: number;
  /** Metres the body is lifted above the road (a hop). */
  hop: number;
  /** A small vertical shake, metres (speed on a rough surface). */
  shake: number;
  /** 0..1, how hard the exhaust flames are burning. */
  flame: number;
  /** 0..1 random-ish flicker for the flames, changing every frame. */
  flicker: number;
  /** Extra yaw of the body against the travel direction (a drift's slide), radians. */
  slide: number;
}

export interface KartModel {
  /** Place this in the scene; the actor moves and turns it. */
  readonly root: Object3D;
  pose(p: KartPose): void;
  dispose(): void;
}

/** Makes the model for one racer. A glTF loader can stand in for the procedural one. */
export type KartFactory = (racer: Pick<RacerSetup, "id" | "colour">) => KartModel;

// ─── The actor ─────────────────────────────────────────────────────────────

export interface ActorContext {
  track: TrackGeometry;
  /** A soft dark blob. */
  shadowTexture: Texture;
  /** At night the karts throw a little light ahead. */
  night: boolean;
  /** The actor adds the visual spin on top of the heading; set false if the sim already turns the heading. */
  spinInModel: boolean;
  lightTexture: Texture;
}

const SPIN_TURNS = 2;

export class KartActor {
  readonly root = new Group();
  readonly model: KartModel;
  private readonly shadowGroup = new Group();
  private readonly shadow: Mesh;
  private readonly shadowMat: MeshBasicMaterial;
  private readonly lightMat: MeshBasicMaterial | null = null;
  private readonly resources: { dispose(): void }[] = [];

  private wheelSpin = 0;
  private roll = 0;
  private pitch = 0;
  private lean = 0;
  private slide = 0;
  private flame = 0;
  private hop = 0;
  private lastSpeed = 0;
  private spinMax = 0;
  private near = 0;
  private accel = 0;
  /** Where the kart is now, for effects and the cameras. */
  yaw = 0;
  slope = 0;

  constructor(
    readonly id: number,
    factory: KartFactory,
    racer: Pick<RacerSetup, "id" | "colour">,
    ctx: ActorContext,
  ) {
    this.model = factory(racer);
    this.root.add(this.model.root);
    this.root.add(this.shadowGroup);
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.resources.push(geo);
    this.shadowMat = new MeshBasicMaterial({ map: ctx.shadowTexture, color: new Color(0x070b18), transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    this.resources.push(this.shadowMat);
    this.shadow = new Mesh(geo, this.shadowMat);
    this.shadow.scale.set(2.5, 1, 3.5);
    this.shadow.position.set(0, 0.05, -0.05);
    this.shadow.renderOrder = 2;
    this.shadowGroup.add(this.shadow);
    if (ctx.night) {
      this.lightMat = new MeshBasicMaterial({ map: ctx.lightTexture, color: new Color(1.0, 0.92, 0.72), transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, fog: false });
      this.resources.push(this.lightMat);
      const pool = new Mesh(geo, this.lightMat);
      pool.scale.set(4.2, 1, 9.5);
      pool.position.set(0, 0.07, 5.8);
      pool.renderOrder = 3;
      this.shadowGroup.add(pool);
    }
  }

  /** Poses the kart from `view`; `time` is the clock, for the little shakes. */
  update(view: KartView, dt: number, ctx: ActorContext, time: number): void {
    const speed = view.speed;
    const sr = clamp(Math.abs(speed) / 24, 0, 1.4);

    // The road under it: its slope in the kart's direction of travel.
    let proj = ctx.track.project(view.x, view.z, this.near);
    // After a jump (a restart, a new race) the hint is stale: look at the whole loop.
    if (Math.hypot(view.x - proj.sample.x, view.z - proj.sample.z) > 20) proj = ctx.track.project(view.x, view.z);
    this.near = proj.s;
    const t = proj.sample;
    const along = Math.cos(view.heading) * t.tz + Math.sin(view.heading) * t.tx;
    const ahead = ctx.track.at(proj.s + 2).y;
    const behind = ctx.track.at(proj.s - 2).y;
    const slope = Math.atan(((ahead - behind) / 4) * along);
    this.slope = damp(this.slope, slope, 12, dt);

    // Spin-out: two turns, easing out, over the time the sim says it lasts.
    let spinYaw = 0;
    if (view.spin > 0) {
      if (view.spin > this.spinMax) this.spinMax = view.spin;
      const progress = 1 - view.spin / (this.spinMax || 1);
      spinYaw = ctx.spinInModel ? easeOutCubic(progress) * TAU * SPIN_TURNS : 0;
    } else {
      this.spinMax = 0;
    }

    this.root.position.set(view.x, view.y, view.z);
    this.root.rotation.y = view.heading + spinYaw;
    this.yaw = view.heading;

    // Motion-driven attitude.
    this.accel = damp(this.accel, dt > 0 ? (speed - this.lastSpeed) / dt : 0, 8, dt);
    this.lastSpeed = speed;
    const spinning = view.spin > 0;
    const rollTarget = -(view.steer * (0.04 + 0.06 * sr) + view.drift * 0.075) * (spinning ? 0.3 : 1);
    this.roll = damp(this.roll, rollTarget, 10, dt);
    const pitchTarget = clamp(this.slope * 0.9 + this.accel * 0.0032 + (view.boost > 0 ? 0.03 : 0), -0.2, 0.2);
    this.pitch = damp(this.pitch, pitchTarget, 9, dt);
    const leanTarget = clamp(view.steer * 0.3 + view.drift * 0.22, -0.55, 0.55);
    this.lean = damp(this.lean, leanTarget, 12, dt);
    this.slide = damp(this.slide, -view.drift * 0.2 * (spinning ? 0 : 1), 8, dt);
    this.flame = damp(this.flame, view.boost > 0 ? 1 : 0, view.boost > 0 ? 16 : 10, dt);
    this.hop = damp(this.hop, view.hop, 30, dt);
    this.wheelSpin += (speed * dt) / 0.4;

    const rough = view.offroad ? 0.035 : 0.006;
    const shake = Math.sin(time * 61 + this.id * 7) * rough * clamp(sr * 1.5, 0, 1);
    this.model.pose({
      steer: view.steer,
      wheelSpin: this.wheelSpin,
      lean: this.lean,
      roll: this.roll,
      pitch: this.pitch,
      hop: this.hop,
      shake,
      flame: this.flame,
      flicker: 0.5 + 0.5 * Math.sin(time * 71 + this.id * 3.1) * Math.sin(time * 47),
      slide: this.slide,
    });

    // Shadow lies on the road, shrinking and paling while the kart is in the air.
    this.shadowGroup.rotation.x = -this.slope;
    const air = clamp(this.hop / 0.6);
    this.shadowMat.opacity = lerp(0.55, 0.3, air);
    this.shadow.scale.set(lerp(2.5, 2.1, air), 1, lerp(3.5, 3.0, air));
  }

  dispose(): void {
    this.model.dispose();
    for (const r of this.resources) r.dispose();
    this.root.removeFromParent();
  }
}
