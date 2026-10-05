/**
 * The karts: a procedural low-poly toy built in code, and the actor that
 * poses it from a KartView.
 *
 * The model is behind a small factory (`KartFactory`), so a Blender-made glTF
 * can replace it later without touching anything else: all the renderer needs
 * from a model is a root to place and a `pose()` to animate. The actor owns
 * what is true of every kart whatever it looks like: where it is, the roll,
 * pitch and lean it shows from its motion, the spin-out, the hop, and its
 * blob shadow.
 *
 * Built facing +z; its left is +x (so its right is -x), which is what
 * `rotation.y = heading` expects (contract.ts).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  CylinderGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import type { KartView, RacerSetup } from "../contract";
import type { TrackGeometry } from "../track/geometry";
import { clamp, damp, easeOutCubic, lerp, TAU } from "./math";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb } from "./world/builder";

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

// ─── The procedural toy kart ───────────────────────────────────────────────

const WHEEL_FRONT = { x: 0.84, y: 0.36, z: 0.92, r: 0.36, w: 0.3 };
const WHEEL_REAR = { x: 0.94, y: 0.42, z: -0.86, r: 0.42, w: 0.4 };
/** Where the rear wheels and exhausts are, for effects (right offset, forward offset). */
export const KART_REAR_WHEEL = { right: WHEEL_REAR.x, forward: WHEEL_REAR.z };
export const KART_EXHAUST = { right: 0.34, forward: -1.28, y: 0.7 };

interface TaperSpec {
  z0: number;
  z1: number;
  w0: number;
  w1: number;
  top0: number;
  top1: number;
  bot0: number;
  bot1: number;
  x?: number;
  top: Rgb;
  side: Rgb;
  bottom: Rgb;
}

/** A box that narrows from its back (z0) to its front (z1): hoods, pods, wings. */
function taper(b: MeshBuilder, s: TaperSpec): void {
  const x = s.x ?? 0;
  const { z0, z1, w0, w1, top0, top1, bot0, bot1 } = s;
  // Top and bottom.
  b.quad([x - w0, top0, z0], [x - w1, top1, z1], [x + w1, top1, z1], [x + w0, top0, z0], s.top);
  b.quad([x + w0, bot0, z0], [x + w1, bot1, z1], [x - w1, bot1, z1], [x - w0, bot0, z0], s.bottom);
  // Sides: lighter toward the top.
  b.quad([x + w0, bot0, z0], [x + w0, top0, z0], [x + w1, top1, z1], [x + w1, bot1, z1], scaleRgb(s.side, 0.78), s.side, s.side, scaleRgb(s.side, 0.78));
  b.quad([x - w0, bot0, z0], [x - w1, bot1, z1], [x - w1, top1, z1], [x - w0, top0, z0], scaleRgb(s.side, 0.78), scaleRgb(s.side, 0.78), s.side, s.side);
  // Caps.
  b.quad([x - w1, bot1, z1], [x + w1, bot1, z1], [x + w1, top1, z1], [x - w1, top1, z1], s.side);
  b.quad([x + w0, bot0, z0], [x - w0, bot0, z0], [x - w0, top0, z0], [x + w0, top0, z0], scaleRgb(s.side, 0.7));
}

/** A thin box from point a to point b, for limbs and rods. */
function limb(b: MeshBuilder, a: [number, number, number], c: [number, number, number], thickness: number, paint: Rgb): void {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const dz = c[2] - a[2];
  const horiz = Math.hypot(dx, dz);
  const len = Math.hypot(horiz, dy);
  b.add(shapes.box(), xf((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, thickness, thickness, len, Math.atan2(dx, dz), -Math.atan2(dy, horiz), 0), paint);
}

function wheelGeometry(spec: { r: number; w: number }, hubColour: Rgb): BufferGeometry {
  const b = new MeshBuilder();
  const rubber = rgb("#24262d");
  const sidewall = rgb("#3a3d47");
  const silver = rgb("#dfe3ea");
  const steel = rgb("#8d94a3");
  const { r, w } = spec;
  // The tyre, axis along x.
  b.add(shapes.cylinder(14), xf(0, 0, 0, r, w, r, 0, 0, Math.PI / 2), { bottom: rubber, top: rubber });
  for (const side of [-1, 1]) {
    b.add(shapes.cylinder(14), xf(side * (w / 2 + 0.005), 0, 0, r * 0.82, 0.02, r * 0.82, 0, 0, Math.PI / 2), sidewall);
    // The hub and its spokes: pentagonal, so a turning wheel reads as turning.
    b.add(shapes.cylinder(5), xf(side * (w / 2 + 0.03), 0, 0, r * 0.56, 0.05, r * 0.56, 0, 0, Math.PI / 2), silver);
    b.add(shapes.cylinder(5), xf(side * (w / 2 + 0.06), 0, 0, r * 0.27, 0.06, r * 0.27, 0.3, 0, Math.PI / 2), hubColour);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      b.add(shapes.box(), xf(side * (w / 2 + 0.05), Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, 0.04, r * 0.05, r * 0.46, 0, a, 0), steel);
    }
  }
  return b.build();
}

export function createProceduralKart(racer: Pick<RacerSetup, "id" | "colour">): KartModel {
  const body = rgb(racer.colour);
  const bright = mixRgb(body, [1, 1, 1], 0.28);
  const deep = scaleRgb(body, 0.55);
  const white = rgb("#f6f7fa");
  const dark = rgb("#2b2e37");
  const darker = rgb("#1c1e25");
  const silver = rgb("#cfd4de");

  // Chassis: everything that does not move relative to the kart.
  const c = new MeshBuilder();
  // Floor pan.
  taper(c, { z0: -1.3, z1: 1.3, w0: 0.56, w1: 0.44, top0: 0.36, top1: 0.34, bot0: 0.2, bot1: 0.2, top: dark, side: dark, bottom: darker });
  // Main tub, tapering to the cockpit.
  taper(c, { z0: -0.95, z1: 0.62, w0: 0.52, w1: 0.46, top0: 0.84, top1: 0.62, bot0: 0.3, bot1: 0.3, top: bright, side: body, bottom: deep });
  // Nose.
  taper(c, { z0: 0.58, z1: 1.52, w0: 0.46, w1: 0.28, top0: 0.62, top1: 0.46, bot0: 0.3, bot1: 0.3, top: bright, side: body, bottom: deep });
  // Racing stripe down the middle of the tub and nose.
  taper(c, { z0: -0.9, z1: 0.6, w0: 0.1, w1: 0.1, top0: 0.848, top1: 0.628, bot0: 0.83, bot1: 0.61, top: white, side: white, bottom: white });
  taper(c, { z0: 0.6, z1: 1.5, w0: 0.1, w1: 0.07, top0: 0.628, top1: 0.468, bot0: 0.61, bot1: 0.45, top: white, side: white, bottom: white });
  // Side pods over the rear wheels' inner side.
  for (const sx of [-1, 1]) {
    taper(c, { z0: -0.95, z1: 0.3, w0: 0.17, w1: 0.12, top0: 0.8, top1: 0.62, bot0: 0.3, bot1: 0.3, x: sx * 0.64, top: bright, side: body, bottom: deep });
    // Pod intake, dark.
    c.box(sx * 0.77, 0.58, -0.1, 0.05, 0.2, 0.34, darker);
  }
  // Engine block and its fins, behind the seat.
  c.box(0, 0.95, -1.0, 0.76, 0.42, 0.5, { bottom: darker, top: dark });
  for (let k = 0; k < 4; k++) c.box(0, 1.0 + k * 0.05, -1.26, 0.64 - k * 0.04, 0.035, 0.06, silver);
  // Exhausts: two pipes reaching back and up.
  for (const sx of [-1, 1]) {
    const x = sx * KART_EXHAUST.right;
    limb(c, [x, 0.72, -1.05], [x, KART_EXHAUST.y + 0.12, KART_EXHAUST.forward], 0.17, silver);
    c.add(shapes.cylinder(8), xf(x, KART_EXHAUST.y + 0.12, KART_EXHAUST.forward - 0.04, 0.12, 0.1, 0.12, 0, Math.PI / 2, 0), darker);
  }
  // Rear wing on two uprights, with end plates.
  for (const sx of [-1, 1]) {
    c.box(sx * 0.32, 1.12, -1.2, 0.06, 0.52, 0.06, dark);
    c.box(sx * 0.82, 1.28, -1.22, 0.06, 0.42, 0.5, bright);
  }
  taper(c, { z0: -1.5, z1: -0.98, w0: 0.84, w1: 0.84, top0: 1.4, top1: 1.36, bot0: 1.3, bot1: 1.3, top: white, side: white, bottom: scaleRgb(white, 0.7) });
  c.box(0, 1.32, -1.22, 1.5, 0.05, 0.1, body);
  // Front bumper and wing.
  c.box(0, 0.4, 1.46, 1.52, 0.15, 0.2, dark);
  for (const sx of [-1, 1]) c.box(sx * 0.82, 0.46, 1.4, 0.1, 0.3, 0.36, bright);
  taper(c, { z0: 1.3, z1: 1.62, w0: 0.72, w1: 0.78, top0: 0.3, top1: 0.28, bot0: 0.24, bot1: 0.24, top: white, side: white, bottom: dark });
  // Seat.
  c.box(0, 0.98, -0.5, 0.58, 0.62, 0.16, { bottom: darker, top: dark }, 0, 0.28);
  c.box(0, 0.78, -0.2, 0.58, 0.12, 0.54, dark);
  // Steering column.
  limb(c, [0, 0.62, 0.55], [0, 1.0, 0.2], 0.07, silver);
  // Lamps: headlights and tail lights, overbright so they glow.
  for (const sx of [-1, 1]) {
    c.add(shapes.cylinder(8), xf(sx * 0.2, 0.5, 1.48, 0.1, 0.04, 0.1, 0, Math.PI / 2, 0), [5, 4.6, 3.4]);
    c.box(sx * 0.4, 0.86, -1.26, 0.2, 0.08, 0.04, [4, 0.3, 0.25]);
  }
  const chassisGeo = c.build();

  // The driver: torso and arms (leans), helmet (turns), steering wheel (turns by steer).
  const d = new MeshBuilder();
  const suit = mixRgb(white, body, 0.12);
  d.box(0, 0.3, 0.02, 0.52, 0.58, 0.32, { bottom: scaleRgb(suit, 0.7), top: suit }, 0, 0.18);
  d.box(0, 0.12, 0.08, 0.54, 0.1, 0.34, deep);
  d.box(0, 0.5, 0.12, 0.5, 0.14, 0.12, bright);
  for (const sx of [-1, 1]) {
    limb(d, [sx * 0.3, 0.46, 0.04], [sx * 0.2, 0.2, 0.46], 0.14, suit);
    d.blob(sx * 0.2, 0.2, 0.5, 0.09, 0.09, 0.09, rgb("#2b2e37"), 0);
    limb(d, [sx * 0.14, -0.04, -0.08], [sx * 0.3, -0.1, 0.34], 0.17, scaleRgb(suit, 0.85));
  }
  const torsoGeo = d.build();

  const h = new MeshBuilder();
  h.blob(0, 0, 0, 0.31, 0.3, 0.32, { bottom: deep, top: bright }, 1);
  // Visor, and a stripe over the crown.
  h.blob(0, 0.0, 0.15, 0.25, 0.12, 0.2, [0.05, 0.07, 0.14], 1);
  h.blob(0.0, -0.01, 0.2, 0.2, 0.05, 0.1, [0.5, 0.7, 1.0], 0);
  h.blob(0, 0.04, -0.02, 0.035, 0.33, 0.34, white, 0);
  const headGeo = h.build();

  const w = new MeshBuilder();
  const rim = dark;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    w.add(shapes.box(), xf(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0, 0.1, 0.05, 0.06, 0, 0, a + Math.PI / 2), k === 0 ? bright : rim);
  }
  w.box(0, 0, 0, 0.3, 0.04, 0.04, rim);
  w.box(0, 0, 0, 0.04, 0.3, 0.04, rim);
  const wheelRimGeo = w.build();

  const flame = new MeshBuilder();
  flame.add(shapes.cone(7), xf(0, 0, -0.5, 0.15, 1.0, 0.15, 0, -Math.PI / 2, 0), [1.6, 0.55, 0.12]);
  flame.add(shapes.cone(7), xf(0, 0, -0.34, 0.08, 0.66, 0.08, 0, -Math.PI / 2, 0), [0.7, 0.9, 1.8]);
  const flameGeo = flame.build();

  const frontGeo = wheelGeometry(WHEEL_FRONT, bright);
  const rearGeo = wheelGeometry(WHEEL_REAR, bright);

  const lit = new MeshLambertMaterial({ vertexColors: true });
  const flameMat = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9, fog: false });

  const root = new Group();
  const bodyGroup = new Group();
  root.add(bodyGroup);
  const chassis = new Mesh(chassisGeo, lit);
  bodyGroup.add(chassis);

  // The driver pivots at the hip.
  const driver = new Group();
  driver.position.set(0, 0.88, -0.34);
  const torso = new Mesh(torsoGeo, lit);
  driver.add(torso);
  const head = new Group();
  head.position.set(0, 0.86, 0.06);
  head.add(new Mesh(headGeo, lit));
  driver.add(head);
  bodyGroup.add(driver);

  const wheelPivot = new Group();
  wheelPivot.position.set(0, 1.02, 0.22);
  wheelPivot.rotation.x = -0.95;
  const wheelRim = new Mesh(wheelRimGeo, lit);
  wheelPivot.add(wheelRim);
  bodyGroup.add(wheelPivot);

  const flames: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const f = new Mesh(flameGeo, flameMat);
    f.position.set(sx * KART_EXHAUST.right, KART_EXHAUST.y + 0.12, KART_EXHAUST.forward - 0.12);
    f.visible = false;
    bodyGroup.add(f);
    flames.push(f);
  }

  const fronts: { pivot: Group; mesh: Mesh }[] = [];
  const rears: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(sx * WHEEL_FRONT.x, WHEEL_FRONT.y, WHEEL_FRONT.z);
    const mesh = new Mesh(frontGeo, lit);
    pivot.add(mesh);
    root.add(pivot);
    fronts.push({ pivot, mesh });
    const rear = new Mesh(rearGeo, lit);
    rear.position.set(sx * WHEEL_REAR.x, WHEEL_REAR.y, WHEEL_REAR.z);
    root.add(rear);
    rears.push(rear);
  }

  return {
    root,
    pose(p) {
      bodyGroup.position.y = p.hop + p.shake;
      bodyGroup.rotation.set(-p.pitch, p.slide, p.roll, "YXZ");
      // Rolled about the wheel line rather than the body's origin, so the wheels stay down.
      driver.rotation.z = p.lean;
      head.rotation.y = -p.steer * 0.4;
      head.rotation.z = -p.lean * 0.35;
      wheelRim.rotation.z = -p.steer * 1.5;
      for (const f of fronts) {
        f.pivot.rotation.y = -p.steer * 0.5;
        f.mesh.rotation.x = p.wheelSpin;
      }
      for (const r of rears) r.rotation.x = p.wheelSpin;
      const on = p.flame > 0.02;
      for (const f of flames) {
        f.visible = on;
        if (on) {
          const s = p.flame * (0.8 + 0.5 * p.flicker);
          f.scale.set(1, 1, 0.5 + s * 1.7);
        }
      }
    },
    dispose() {
      for (const g of [chassisGeo, torsoGeo, headGeo, wheelRimGeo, flameGeo, frontGeo, rearGeo]) g.dispose();
      lit.dispose();
      flameMat.dispose();
    },
  };
}

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
  private lastSlope = 0;
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
    const proj = ctx.track.project(view.x, view.z, this.near);
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
    this.lastSlope = slope;
  }

  dispose(): void {
    this.model.dispose();
    for (const r of this.resources) r.dispose();
    this.root.removeFromParent();
  }
}

export type { Material };
