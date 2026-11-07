/**
 * The karts' side of the picture: what a model must offer (`KartModel`,
 * made by a `KartFactory`) and the actor that poses it from a KartView.
 *
 * The models are made by kartModel.ts: the Blender-made kart once its art is
 * loaded (kartArt.ts), the code-built one otherwise. All the renderer needs
 * from a model is a root to place and a `pose()` to animate. The actor owns
 * what is true of every kart whatever it looks like: where it is, the roll,
 * pitch and lean it shows from its motion (the body rolls with how hard it
 * turns, dives under the brake, noses up and down a jump's arc), the
 * spin-out, the hop, the springs squashing on a landing and bouncing back,
 * the wobble as a drift starts (the body rocks out on its springs and rings
 * down), the engine's tremble when it is slow, the lean of a banked road, a
 * trick's twirl in the air, the long fall when it leaves the road and the
 * rescue drone that fishes it out, and its blob shadow.
 *
 * Built facing +z; its left is +x (so its right is -x), which is what
 * `rotation.y = heading` expects (contract.ts).
 */
import { AdditiveBlending, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Object3D, type Texture } from "three";
import type { Emote, KartView, RacerSetup } from "../contract";
import type { TrackGeometry } from "../track/geometry";
import { Casters } from "./casters";
import { RescueDrone } from "./drone";
import { clamp, damp, easeOutCubic, lerp, smoothstep, TAU } from "./math";

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
  /** How far the driver has twirled in a trick, radians (0 when none); a model with nothing to twirl may ignore it. */
  twirl?: number;
  /** The clock, seconds: for the driver's own little motions (a tail, a bounce). */
  time?: number;
  /** The driver's gesture: both arms up, or one hand waving. */
  emote?: Emote | null;
  /** The kart has crossed the line: the driver bounces happily. */
  finished?: boolean;
  /** Spinning out: the driver is dizzy. */
  dizzy?: boolean;
  /** The suspension's compression, about -1..1: + squashes the body onto its wheels (a landing, a hit), - lets it spring up. */
  squash?: number;
  /** 0..1: the brake lights, lit while the kart slows hard (worked out from its speed falling, so it needs nothing from the sim). */
  brake?: number;
  /** -1..1: the driver glances back over a shoulder (+ the left, +x) at a kart close behind. */
  lookBack?: number;
  /** 0..1: at rest (stopped on the grid): the driver breathes and looks about. */
  rest?: number;
  /** 0..1: the eyes held shut this much, for a still picture (a blink is the driver's own). */
  shut?: number;
}

export interface KartModel {
  /** Place this in the scene; the actor moves and turns it. */
  readonly root: Object3D;
  pose(p: KartPose): void;
  dispose(): void;
}

/** Makes the model for one racer (createProceduralKart, unless a caller brings its own). */
export type KartFactory = (racer: Pick<RacerSetup, "id" | "colour" | "character" | "golden">) => KartModel;

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
  /** How far above the sim's flat road the surface is under (x, z): banking and ramps (world.surfaceLift). */
  surface?: (x: number, z: number, hint?: number) => { lift: number; ramp: number; s: number; offset: number };
  /** The road's lean at distance s, radians (+ in a right-hand bend). */
  rollAt?: (s: number) => number;
  /** The scene the rescue drone flies in. */
  dynamic?: Group;
  /** The race's laps: a kart past them has finished. */
  laps: number;
}

const SPIN_TURNS = 2;
/** How long a trick's twirl takes, seconds: the kart spins a whole turn flat in the air and the driver twirls once on top. */
const TRICK_TIME = 0.75;
const TRICK_TURNS = 1;
/** The stylised fall: gravity, and the longest drop the picture shows before the drone has the kart. */
const FALL_G = 24;
const FALL_MAX = 9;
/**
 * The drift's wobble: the body's roll on its own spring, kicked as a drift begins. It is underdamped (about 2.7 Hz, a quarter of
 * critical) so it rocks out to about 0.075 rad at the first swing, comes back through about two fifths of that, then a sixth, and is
 * still within about 0.65 s. The kick is the roll speed it starts with, rad/s.
 */
const WOBBLE_K = 290;
const WOBBLE_C = 9;
const WOBBLE_KICK = 1.85;
/** The engine's tremble: its size (radians of pitch and of roll), the speeds it is full below and gone above (m/s), and how fast it buzzes (rad/s). */
const IDLE_PITCH = 0.0045;
const IDLE_ROLL = 0.0035;
const IDLE_FULL = 1.5;
const IDLE_GONE = 4.5;
const IDLE_RATE = 72;
/** The most of the buzz one frame may turn through, radians: a slow frame would otherwise skip over it (aliasing) and look like jitter. */
const IDLE_STEP = 1.9;

/** The state of a fall and rescue, from the moment the kart leaves the road. */
interface FallState {
  /** The duration it was first given, seconds. */
  T: number;
  /** Where it fell from, which way it was going, how fast. */
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** Where the drone sets it down. */
  toX: number;
  toZ: number;
  toY: number;
}

const _inv = new Quaternion();
const _off = new Vector3();

/** The karts of each scene (one set per ActorContext), so a driver can see who is behind in its own race and no other. */
const CROWDS = new WeakMap<object, Set<KartActor>>();
/** A glance back lasts this long, seconds, and comes at most this often. */
/** A change of speed faster than this, m/s2, is a cut in the data rather than the kart braking. */
const TELEPORT_ACCEL = 45;
const GLANCE_FOR = 0.75;
const GLANCE_EVERY = 3.2;

export class KartActor {
  readonly root = new Group();
  readonly model: KartModel;
  /** Its shadow casters, which a view that cannot see its shadow leaves out (casters.ts). */
  readonly casters = new Casters();
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
  /** The brake lights' glow (eased), the glance back (eased) and the time it began and when the next may, and how much the kart is at rest. */
  private brakeGlow = 0;
  private back = 0;
  private glanceFrom = -9;
  private glanceNext = 1.5;
  private restEase = 0;
  /** Where the kart is, for the others to see who is behind them (see `lookBackAt`). */
  private spot = { x: 0, z: 0, heading: 0, speed: 0, live: false };
  /** The heading last frame and how fast it is turning (rad/s, eased): how hard the kart corners, which rolls the body. */
  private lastHeading: number | null = null;
  private yawRate = 0;
  /** The kart's height in the world last frame and how fast it is rising (m/s, eased): a jump's arc pitches it, a landing's speed squashes it. */
  private lastHigh: number | null = null;
  private climb = 0;
  private spinMax = 0;
  private near = 0;
  private accel = 0;
  private tiltX = 0;
  private tiltZ = 0;
  /** The suspension: how far it is compressed and how fast it is moving, and how high the kart was last frame. */
  private susp = 0;
  private suspV = 0;
  private lastAir = 0;
  private lastSpin = 0;
  /** The drift's wobble: extra roll on a spring (radians, rad/s), and the drift last frame, to see one begin. */
  private wob = 0;
  private wobV = 0;
  private lastDrift = 0;
  /** The engine's tremble: how much of it shows (0..1, eased), and where its buzz has got to (radians; each kart starts elsewhere and buzzes a little differently). */
  private idle = 0;
  private buzz: number;
  private readonly buzzRate: number;
  /** Where the kart is on screen (it differs from the view while it falls and is carried), and the height of the road under it. */
  x = 0;
  y = 0;
  z = 0;
  roadY = 0;
  /** What the chase camera should look at, which holds the road's height while the kart falls away. */
  anchor = { x: 0, y: 0, z: 0 };
  /** The road's slope under it, eased: it pitches the kart and its shadow. */
  slope = 0;
  /** True while it is still dropping, before the hook has it. */
  falling = false;
  /** Players who asked for less motion: no wobble and no tremble (the cameras and the effects leave their motion out the same way). */
  calm = false;

  // The rescue.
  private drone: RescueDrone | null = null;
  private fall: FallState | null = null;
  private lastGood = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  private droneOut = -1;
  private droneLast = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 };
  private settle = { x: 0, y: 0, z: 0 };
  private tumble = { x: 0, y: 0, z: 0 };

  constructor(
    readonly id: number,
    factory: KartFactory,
    racer: Pick<RacerSetup, "id" | "colour" | "character" | "golden">,
    ctx: ActorContext,
  ) {
    this.buzz = id * 2.4;
    let crowd = CROWDS.get(ctx);
    if (!crowd) CROWDS.set(ctx, (crowd = new Set()));
    crowd.add(this);
    this.crowd = crowd;
    this.buzzRate = IDLE_RATE + ((id * 5) % 15);
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

  private glanceSide = 1;
  private readonly crowd: Set<KartActor>;

  /**
   * +1 or -1 (the side to look over: + the driver's left) when another kart is close behind this one and a little to a side, 0 when none is.
   * Close: 2 to 11 m back, within 3.5 m of the line, and it is not slower by much (a kart far behind and falling back is no worry).
   */
  private lookBackAt(): number {
    const fx = Math.sin(this.spot.heading);
    const fz = Math.cos(this.spot.heading);
    let best = 0;
    let bestBack = 12;
    for (const o of this.crowd) {
      if (o === this || !o.spot.live) continue;
      const dx = o.spot.x - this.spot.x;
      const dz = o.spot.z - this.spot.z;
      const back = -(dx * fx + dz * fz);
      const side = dx * fz - dz * fx;
      if (back < 2 || back > 11 || Math.abs(side) > 3.5 || back >= bestBack) continue;
      bestBack = back;
      best = side >= 0 ? 1 : -1;
    }
    return best;
  }

  /** Poses the kart from `view`; `time` is the clock, for the little shakes. */
  update(view: KartView, dt: number, ctx: ActorContext, time: number): void {
    const speed = view.speed;
    const sr = clamp(Math.abs(speed) / 24, 0, 1.4);

    // The road under it: its slope in the kart's direction of travel, its lean, and how high bends and ramps lift it.
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
    const surf = ctx.surface ? ctx.surface(view.x, view.z, proj.s) : { lift: 0, ramp: 0, s: proj.s, offset: proj.offset };
    // The sim counts a ramp's wedge as road and leaves the lip from its top: up the wedge the kart stands on it (with its hop),
    // off the lip it is the sim's height over the road. Whichever is higher, so a frame drawn between the tick before the lip and
    // the one after (the newer tick's height, a position between the two) neither doubles the wedge nor drops through it.
    const above = view.hop >= surf.ramp ? view.hop - surf.ramp : view.hop;
    const roll = ctx.rollAt ? ctx.rollAt(proj.s) : 0;
    // The banked road's plane, seen from the kart: how much it tips the kart's nose and its side.
    const rrx = -t.tz;
    const rrz = t.tx;
    const fx = Math.sin(view.heading);
    const fz = Math.cos(view.heading);
    const rx = -Math.cos(view.heading);
    const rz = Math.sin(view.heading);
    const tanRoll = Math.tan(roll);
    const onBankedRoad = Math.abs(proj.offset) < t.width / 2 + 0.5;
    const bankPitch = onBankedRoad ? Math.atan(-tanRoll * (rrx * fx + rrz * fz)) : 0;
    const bankRoll = onBankedRoad ? Math.atan(tanRoll * (rrx * rx + rrz * rz)) : 0;
    this.tiltX = damp(this.tiltX, -bankPitch, 14, dt);
    this.tiltZ = damp(this.tiltZ, bankRoll, 14, dt);

    // Spin-out: two turns, easing out, over the time the sim says it lasts.
    let spinYaw = 0;
    if (view.spin > 0) {
      if (view.spin > this.spinMax) this.spinMax = view.spin;
      const progress = 1 - view.spin / (this.spinMax || 1);
      spinYaw = ctx.spinInModel ? easeOutCubic(progress) * TAU * SPIN_TURNS : 0;
    } else {
      this.spinMax = 0;
    }

    const baseY = view.y + surf.lift;
    this.roadY = baseY;
    let px = view.x;
    let py = baseY;
    let pz = view.z;
    let rotX = this.tiltX;
    let rotZ = this.tiltZ;
    let rotY = view.heading + spinYaw;

    // A trick in the air: the kart spins a whole turn flat, the driver twirls on top, and it wobbles about its length.
    let twirl = 0;
    if (view.trick > 0 && view.rescue <= 0) {
      const u = clamp(view.trick / TRICK_TIME);
      const turn = u * u * (3 - 2 * u);
      twirl = TAU * TRICK_TURNS * turn;
      rotY += TAU * turn;
      rotZ += Math.sin(view.trick * 11) * 0.22 * (1 - u * 0.6);
    }

    // The long fall and the drone.
    const rescuing = view.rescue > 0;
    if (rescuing && !this.fall) {
      // Where the drone will set it down: the sim's own spot if it has moved the kart back to the road, otherwise a little behind, on the road.
      let toX = view.x;
      let toZ = view.z;
      let toY = baseY;
      if (!onRoad(proj.offset, t.width)) {
        const back = ctx.track.at(proj.s - 12);
        const off = clamp(proj.offset, -(back.width / 2 - 3), back.width / 2 - 3);
        const p = ctx.track.point(proj.s - 12, off);
        toX = p.x;
        toZ = p.z;
        toY = p.y + (ctx.surface ? ctx.surface(p.x, p.z, proj.s - 12).lift : 0);
      }
      const from = this.lastGood.speed !== 0 || this.lastGood.x !== 0 ? this.lastGood : { x: view.x, y: baseY, z: view.z, heading: view.heading, speed };
      this.fall = { T: view.rescue, x: from.x, y: from.y, z: from.z, heading: from.heading, speed: from.speed, toX, toZ, toY };
      this.tumble = { x: 0, y: 0, z: 0 };
      this.droneOut = -1;
    }
    if (rescuing && this.fall) {
      const f = this.fall;
      // The sim may move the kart to the road at some point: follow it there.
      if (onRoad(proj.offset, t.width) && (Math.abs(view.x - f.x) > 8 || Math.abs(view.z - f.z) > 8)) {
        f.toX = view.x;
        f.toZ = view.z;
        f.toY = baseY;
      }
      const tt = f.T - view.rescue;
      const tFall = Math.min(0.9, f.T * 0.38);
      const tRelease = f.T - 0.45;
      const fallY = f.y - Math.min(FALL_MAX, 0.5 * FALL_G * Math.min(tt, tFall) ** 2);
      // Momentum carries it on a little as it drops.
      const carry = Math.min(tt, tFall);
      const ahead = clamp(f.speed, 0, 26) * 0.32 * (1 - carry / (tFall * 2.2)) * carry;
      const fallX = f.x + Math.sin(f.heading) * ahead;
      const fallZ = f.z + Math.cos(f.heading) * ahead;
      let kx = fallX;
      let ky = fallY;
      let kz = fallZ;
      let hang = 0;
      if (tt > tFall) {
        const lift = easeOutCubic(clamp((tt - tFall) / 0.75));
        const move = smoothstep(0.25, 1, clamp((tt - tFall) / Math.max(0.1, tRelease - tFall)));
        kx = lerp(fallX, f.toX, move);
        kz = lerp(fallZ, f.toZ, move);
        const carryY = Math.max(f.toY + 3.2, fallY + 0.5);
        if (tt > tRelease) {
          const r = smoothstep(0, 1, clamp((tt - tRelease) / 0.45));
          ky = lerp(carryY, f.toY, r);
        } else {
          ky = lerp(fallY, lerp(carryY, f.toY + 3.2, move), lift);
        }
        hang = 1;
      }
      px = kx;
      py = ky;
      pz = kz;
      // Tumbling while it falls; hanging by the hook, swaying, once caught.
      if (tt <= tFall) {
        this.tumble.x = tt * 5.8;
        this.tumble.y = tt * 3.4;
        this.tumble.z = tt * 4.2;
        rotX = this.tumble.x;
        rotY = f.heading + this.tumble.y;
        rotZ = this.tumble.z;
      } else {
        const settled = 1 - Math.exp(-(tt - tFall) * 4.5);
        const sway = Math.sin(tt * 4.2) * 0.2 * (1 - clamp((tt - tFall) / 1.6) * 0.5);
        const wrap = (a: number) => a - TAU * Math.round(a / TAU);
        rotX = lerp(wrap(this.tumble.x), 0.28, settled);
        rotZ = lerp(wrap(this.tumble.z), sway, settled);
        rotY = lerp(f.heading + wrap(this.tumble.y), view.heading, settled);
      }
      this.updateDrone(ctx, f, tt, tFall, tRelease, hang, px, py, pz, time);
      this.falling = tt <= tFall;
      this.anchor.x = px;
      this.anchor.z = pz;
      this.anchor.y = lerp(f.y, py, 0.55);
      this.settle = { x: 0, y: 0, z: 0 };
    } else {
      if (this.fall) {
        // The drone has let go: a little blend from where the picture had it to where the sim says it is, and the drone flies off.
        this.settle = { x: this.x - view.x, y: this.y - baseY, z: this.z - view.z };
        const f = this.fall;
        this.fall = null;
        this.droneOut = 0;
        this.droneLast.yaw = f.heading;
      }
      this.anchor.x = view.x;
      this.anchor.z = view.z;
      this.anchor.y = baseY + view.hop * 0.7;
      this.falling = false;
      if (this.droneOut >= 0) this.flyAway(dt, time);
      const k = Math.exp(-dt * 9);
      this.settle.x *= k;
      this.settle.y *= k;
      this.settle.z *= k;
      px += this.settle.x;
      py += this.settle.y;
      pz += this.settle.z;
    }
    if (!rescuing) this.lastGood = { x: view.x, y: baseY, z: view.z, heading: view.heading, speed };

    // A hop is the body lifting off its wheels; a jump (several metres) lifts the whole kart, wheels and all.
    const jump = rescuing ? 0 : Math.max(0, above - 0.4);
    py += jump;
    this.x = px;
    this.y = py;
    this.z = pz;
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rotX, rotY, rotZ, "YXZ");

    // Motion-driven attitude.
    // A jump in speed no kart can make in a frame (a respawn, a snapshot's correction) is a cut, not a brake.
    const rawAccel = dt > 0 ? (speed - this.lastSpeed) / dt : 0;
    this.accel = damp(this.accel, Math.abs(rawAccel) > TELEPORT_ACCEL ? 0 : rawAccel, 8, dt);
    this.lastSpeed = speed;
    const spinning = view.spin > 0;
    // How hard it corners: the heading's turn rate times the speed, the sideways pull the body rolls away from.
    if (dt > 0 && this.lastHeading !== null && !rescuing) {
      const turned = view.heading - this.lastHeading;
      const rate = (turned - TAU * Math.round(turned / TAU)) / dt;
      // A jump in the heading (a restart, a set-down) is no turn.
      this.yawRate = damp(this.yawRate, Math.abs(rate) < 8 ? rate : 0, 10, dt);
    }
    this.lastHeading = view.heading;
    const airNow = rescuing ? 0 : Math.max(0, above);
    const grounded = airNow < 0.3;
    const cornering = grounded && !spinning ? -this.yawRate * speed : 0;
    const rollTarget = -clamp(cornering * 0.0042, -0.17, 0.17) - (spinning ? 0 : view.drift * 0.05);
    this.roll = damp(this.roll, rollTarget, 9, dt);
    // Its rise and fall in the world, for the nose in the air and the squash of a landing.
    const worldHigh = py;
    if (dt > 0 && this.lastHigh !== null && !rescuing) {
      const rising = (worldHigh - this.lastHigh) / dt;
      this.climb = damp(this.climb, Math.abs(rising) < 40 ? rising : 0, 14, dt);
    }
    this.lastHigh = rescuing ? null : worldHigh;
    const groundPitch = this.slope * 0.9 + this.accel * 0.0032 + (view.boost > 0 ? 0.03 : 0);
    // In the air the nose follows the arc: up off the lip, down coming in to land.
    const airPitch = Math.atan2(this.climb, Math.max(6, Math.abs(speed))) * 0.75;
    const pitchTarget = clamp(airNow > 0.6 ? airPitch : groundPitch, -0.32, 0.32);
    this.pitch = damp(this.pitch, pitchTarget, airNow > 0.6 ? 5 : 9, dt);
    const leanTarget = clamp(view.steer * 0.3 + view.drift * 0.22, -0.55, 0.55);
    this.lean = damp(this.lean, leanTarget, 12, dt);
    // The sim swings the kart's tail out in a drift; the body adds only a touch more of its own.
    this.slide = damp(this.slide, -view.drift * 0.05 * (spinning ? 0 : 1), 8, dt);
    this.flame = damp(this.flame, view.boost > 0 && !rescuing ? 1 : 0, view.boost > 0 ? 16 : 10, dt);
    this.hop = damp(this.hop, rescuing ? 0 : Math.min(above, 0.4), 30, dt);
    // The suspension: a landing presses the body down onto its springs as hard as it came down, a hit jolts it, and the springs
    // let it bounce back.
    if (dt > 0) {
      if (this.lastAir > 0.18 && airNow < 0.1) this.suspV += clamp(-this.climb * 1.1 + 2, 3, 16);
      if (view.spin > 0 && this.lastSpin <= 0) this.suspV += 6;
      this.suspV += (-210 * this.susp - 13 * this.suspV) * dt;
      this.susp = clamp(this.susp + this.suspV * dt, -1, 1);
    }
    this.lastAir = airNow;
    this.lastSpin = view.spin;
    this.wheelSpin += (rescuing ? 0 : speed * dt) / 0.4;
    // A drift beginning rocks the body out toward the outside of the bend, on a roll spring of its own that rings back two or three
    // times as it settles. It is stepped in small pieces (never over 1/90 s), so a slow frame rings the same as a quick one.
    if (view.drift !== 0 && view.drift !== this.lastDrift && !spinning && !this.calm) this.wobV -= view.drift * WOBBLE_KICK;
    this.lastDrift = view.drift;
    if (dt > 0) {
      const steps = Math.ceil(dt * 90);
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.wobV += (-WOBBLE_K * this.wob - WOBBLE_C * this.wobV) * h;
        this.wob += this.wobV * h;
      }
      this.wob = clamp(this.wob, -0.15, 0.15);
    }
    // The engine's tremble: a grounded kart that is slow (or waiting on the grid) shivers a hair on its mounts, and it fades out as the
    // speed picks up, where the rough road's shake below takes over.
    const idleTarget = grounded && !spinning && !rescuing && !this.calm ? 1 - smoothstep(IDLE_FULL, IDLE_GONE, Math.abs(speed)) : 0;
    this.idle = damp(this.idle, idleTarget, 10, dt);
    // Its phase is stepped, not read off the clock: it is a fast buzz, and a slow frame would catch it too coarsely.
    if (dt > 0) this.buzz += Math.min(this.buzzRate, IDLE_STEP / dt) * dt;
    // Pitch and roll buzz at a slightly different rate, so the body traces a small loop rather than a line, and the size breathes a little.
    const lope = this.idle * (0.8 + 0.2 * Math.sin(time * 7 + this.id * 1.7));
    const buzzPitch = Math.sin(this.buzz) * IDLE_PITCH * lope;
    const buzzRoll = Math.sin(this.buzz * 1.13 + 1.3) * IDLE_ROLL * lope;

    // Brake lights: lit while the speed is falling hard on the ground, not by a spin-out or a fall.
    const slowing = grounded && !spinning && !rescuing && speed > 1.5 ? smoothstep(3.5, 7, -this.accel) : 0;
    this.brakeGlow = damp(this.brakeGlow, slowing, slowing > this.brakeGlow ? 34 : 9, dt);
    // The glance back: a driver with a kart close behind looks round now and then, over the shoulder on its side.
    this.spot.x = view.x;
    this.spot.z = view.z;
    this.spot.heading = view.heading;
    this.spot.speed = speed;
    this.spot.live = !rescuing;
    const follower = !rescuing && !spinning && grounded && speed > 6 ? this.lookBackAt() : 0;
    if (follower !== 0 && time - this.glanceFrom > GLANCE_EVERY && time >= this.glanceNext && !this.calm) {
      this.glanceFrom = time;
      this.glanceSide = follower;
      this.glanceNext = time + GLANCE_EVERY;
    }
    const glancing = time - this.glanceFrom < GLANCE_FOR && time >= this.glanceFrom;
    this.back = damp(this.back, glancing ? this.glanceSide : 0, glancing ? 9 : 6, dt);
    const stopped = !this.calm && !rescuing && !spinning && grounded ? 1 - smoothstep(0.4, 2.5, Math.abs(speed)) : 0;
    this.restEase = damp(this.restEase, stopped, 3, dt);

    const rough = view.offroad || view.surface === "mud" ? 0.035 : 0.006;
    const shake = Math.sin(time * 61 + this.id * 7) * rough * clamp(sr * 1.5, 0, 1);
    this.model.pose({
      steer: rescuing ? 0 : view.steer,
      wheelSpin: this.wheelSpin,
      lean: rescuing ? 0 : this.lean,
      roll: rescuing ? 0 : this.roll + this.wob + buzzRoll,
      pitch: rescuing ? 0 : this.pitch + buzzPitch,
      hop: this.hop,
      shake: rescuing ? 0 : shake,
      flame: this.flame,
      flicker: 0.5 + 0.5 * Math.sin(time * 71 + this.id * 3.1) * Math.sin(time * 47),
      slide: this.slide,
      twirl,
      time,
      emote: rescuing ? null : view.emote,
      finished: view.lap > ctx.laps && !rescuing,
      dizzy: spinning && !rescuing,
      squash: rescuing ? 0 : this.susp,
      brake: this.brakeGlow,
      lookBack: this.back,
      rest: this.restEase,
    });

    // Shadow lies on the road, shrinking and paling while the kart is in the air or being carried.
    const high = Math.max(0, py - baseY) + this.hop;
    const air = clamp(high / 4.5);
    // The shadow belongs to the road, not to the tumbling kart: undo the kart's own tilt and drop it to the road.
    _inv.copy(this.root.quaternion).invert();
    _off.set(0, baseY - py, 0).applyQuaternion(_inv);
    this.shadowGroup.position.copy(_off);
    this.shadowGroup.quaternion.copy(_inv);
    this.shadowGroup.rotateY(rotY);
    this.shadowGroup.rotateX(-this.slope);
    this.shadowMat.opacity = lerp(0.55, 0.22, air) * (py < baseY - 1 ? 0 : 1);
    this.shadow.scale.set(lerp(2.5, 1.9, air), 1, lerp(3.5, 2.7, air));
  }

  /** The drone dives in, hooks the kart as it stops falling, carries it, and lowers it. */
  private updateDrone(ctx: ActorContext, f: FallState, tt: number, tFall: number, tRelease: number, hang: number, kx: number, ky: number, kz: number, time: number): void {
    if (!this.drone) {
      this.drone = new RescueDrone();
      (ctx.dynamic ?? this.root.parent)?.add(this.drone.root);
    }
    const cableCarry = 3.0;
    const hover = 1.3 + cableCarry + 0.62;
    let dx: number;
    let dy: number;
    let dz: number;
    let cable: number;
    let pitch = 0;
    let roll = 0;
    let yaw = f.heading;
    if (tt <= tFall || !hang) {
      // Diving in from ahead and above, to be over the kart as it is caught.
      const catchX = f.x + Math.sin(f.heading) * clamp(f.speed, 0, 26) * 0.32 * 0.6 * tFall * 0.65;
      const catchZ = f.z + Math.cos(f.heading) * clamp(f.speed, 0, 26) * 0.32 * 0.6 * tFall * 0.65;
      const catchY = f.y - Math.min(FALL_MAX, 0.5 * FALL_G * tFall * tFall) + hover;
      const p = easeOutCubic(clamp(tt / tFall));
      const sx = catchX + Math.sin(f.heading + 0.9) * 46;
      const sz = catchZ + Math.cos(f.heading + 0.9) * 46;
      const sy = catchY + 30;
      dx = lerp(sx, catchX, p);
      dy = lerp(sy, catchY, p);
      dz = lerp(sz, catchZ, p);
      cable = lerp(1.2, cableCarry, p);
      yaw = Math.atan2(catchX - sx, catchZ - sz);
      pitch = 0.3 * (1 - p);
      roll = Math.sin(time * 3) * 0.05;
    } else {
      const sinceCatch = tt - tFall;
      dx = kx;
      dz = kz;
      dy = ky + hover + (tt > tRelease ? lerp(0, 0.6, clamp((tt - tRelease) / 0.45)) : 0);
      cable = cableCarry + (tt > tRelease ? lerp(0, 0.9, clamp((tt - tRelease) / 0.45)) : 0);
      // Leaning into the way it is going.
      const toX = f.toX - kx;
      const toZ = f.toZ - kz;
      const d = Math.hypot(toX, toZ);
      if (d > 0.5) yaw = Math.atan2(toX, toZ);
      pitch = clamp(d * 0.02, 0, 0.2);
      roll = Math.sin(sinceCatch * 3.1) * 0.06;
      dy += Math.sin(sinceCatch * 5) * 0.12;
    }
    this.droneLast = { x: dx, y: dy, z: dz, yaw, vx: Math.sin(yaw) * 6, vz: Math.cos(yaw) * 6 };
    this.drone.pose(dx, dy, dz, yaw, pitch, roll, cable, time);
  }

  /** After the release the drone climbs away and is gone in a moment. */
  private flyAway(dt: number, time: number): void {
    if (!this.drone) {
      this.droneOut = -1;
      return;
    }
    this.droneOut += dt;
    const d = this.droneLast;
    const gain = 1 + this.droneOut * 3.2;
    d.vx *= 1 + dt * 1.8;
    d.vz *= 1 + dt * 1.8;
    d.x += d.vx * dt * gain;
    d.z += d.vz * dt * gain;
    d.y += (4 + this.droneOut * 16) * dt;
    this.drone.pose(d.x, d.y, d.z, d.yaw, -0.25, 0, Math.max(0.4, 3.9 - this.droneOut * 4), time);
    if (this.droneOut > 1.4) {
      this.drone.hide();
      this.droneOut = -1;
    }
  }

  dispose(): void {
    this.crowd.delete(this);
    this.spot.live = false;
    this.model.dispose();
    this.drone?.dispose();
    for (const r of this.resources) r.dispose();
    this.root.removeFromParent();
  }
}

/** Is a point `offset` metres off the centre line on or just beside a road of this width? */
function onRoad(offset: number, width: number): boolean {
  return Math.abs(offset) <= width / 2 + 4;
}
