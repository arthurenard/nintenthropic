/**
 * The chase camera: behind and above the kart, eased, alive.
 *
 * It follows the kart's direction of travel, not the spin: when a kart is
 * spun out, the view holds the way it was going instead of whirling with it.
 * Around that it moves the way the kart does: it leans into a bend with the
 * wheel, tilts with a banked road and pitches with the slope (up a climb, down
 * over a crest), aims a little into the turn ahead, swings out to the side in
 * a drift so the slide shows, rises off a jump and lands with a thump, opens
 * its lens on a boost and shakes on a knock. Every part is eased and bounded;
 * `calm` (players who asked for less motion) keeps only what frames the road:
 * no lean, no tilt, no shake, no punch.
 *
 * Through the countdown it begins high over the grid and settles into the
 * chase position by the time the lights go green; once a kart has finished it
 * swings slowly around it.
 */
import { PerspectiveCamera, Vector3 } from "three";
import type { KartView, RaceView } from "../contract";
import { angleDiff, clamp, damp, dampAngle, lerp, smoothstep } from "./math";

/** The countdown's length including the half second of "ready" (docs/GRIP_PRIX.md). */
export const COUNTDOWN_SPAN = 3.5;

/** The most the picture leans, radians (about 9 degrees): the wheel, the drift and a banked road together. */
export const MAX_ROLL = 0.16;

/**
 * The vertical field of view to use for a view of this aspect, degrees. A
 * wide, short viewport (two players, one over the other) would otherwise
 * stretch a sixty-degree lens into a fisheye, so it keeps the horizontal
 * angle sensible and lets the vertical one narrow, within limits.
 */
export function baseFov(aspect: number): number {
  const horizontal = (88 * Math.PI) / 180;
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / Math.max(0.3, aspect));
  return clamp((vertical * 180) / Math.PI, 50, 66);
}

/**
 * How far the camera trails the kart and how high it rides, for a speed ratio
 * 0..1+. In a narrow view (two players side by side, a portrait window) it
 * stands farther back and higher, so the kart does not swallow the picture.
 */
export function chaseOffsets(speedRatio: number, boost: number, aspect = 1.6): { distance: number; height: number } {
  const s = clamp(speedRatio, 0, 1.3);
  const back = Math.sqrt(clamp(1.6 / Math.max(0.3, aspect), 1, 1.7));
  return { distance: (lerp(4.5, 5.7, s) + boost * 0.9) * back, height: lerp(2.1, 2.55, s) * (0.8 + 0.2 * back) * back };
}

/**
 * How much a road leaning `roll` (radians, + low on its right: world/bank.ts) tips the picture of a camera facing
 * `yaw`, the road running along (tx, tz): the whole lean looking along the road, none looking across it, the other
 * way round looking back down it.
 */
export function bankSeen(roll: number, tx: number, tz: number, yaw: number): number {
  // The road's right (-tz, tx) against the camera's right (-cos yaw, sin yaw).
  return Math.atan(Math.tan(roll) * (tz * Math.cos(yaw) + tx * Math.sin(yaw)));
}

/**
 * What the camera reads of the road (the track's geometry and its banking): where a point is along the lap, the
 * centre line's height and direction anywhere on it, and how it leans.
 */
export interface CameraRoad {
  project(x: number, z: number, near?: number): { s: number; offset: number; sample: { x: number; y: number; z: number; tx: number; tz: number; width: number } };
  at(s: number): { y: number; tx: number; tz: number };
  rollAt(s: number): number;
}

/** Keeps the camera clear of the ground, the roofs and what stands beyond the barrier (world/cameraSpace.ts). */
export interface CameraFit {
  fit(pos: Vector3, kart: { x: number; y: number; z: number }): void;
}

const _fwd = new Vector3();
const _aim = new Vector3();
const _want = new Vector3();
const _look = new Vector3();
const _intro = new Vector3();
const _introLook = new Vector3();
const _focus = new Vector3();

/** Smooth wobble in about -1..1 from two sines that never line up: the shake's path, cheaper than noise and as good at this size. */
const wobble = (t: number, a: number, b: number, phase: number): number => Math.sin(t * a + phase) * 0.6 + Math.sin(t * b + phase * 2.3) * 0.4;

export class ChaseCamera {
  readonly camera = new PerspectiveCamera(60, 1, 0.4, 2600);
  private yaw = 0;
  private readonly pos = new Vector3();
  private readonly target = new Vector3();
  private fov = 60;
  private boost = 0;
  private intro = 1;
  private orbit = 0;
  private orbitBlend = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private travel = 0;
  private roll = 0;
  private fresh = true;
  /** The heading less the direction of travel (a slide), eased: the drift's swing reads it. */
  private slip = 0;
  /** Metres right of straight behind (the drift's swing out). */
  private side = 0;
  /** Radians the aim turns into the bend ahead. */
  private aim = 0;
  /** The road's rise per metre behind the kart and ahead of it, eased (the pitch). */
  private climb = 0;
  private crest = 0;
  /** 0..1, eased: how far into a flight (the camera rises and pulls back to see the landing). */
  private air = 0;
  /** The flight so far: seconds in the air and the highest it went. */
  private flying = 0;
  private peak = 0;
  /** The landing's thump: a spring on the camera's height, metres and metres a second. */
  private thump = 0;
  private thumpV = 0;
  /** 0..1, falling by itself: the shake is its square. */
  private trauma = 0;
  private clock = 0;
  /** The lens's punch on a boost, and where it is heading (it springs out quickly and settles). */
  private punch = 0;
  private punchTo = 0;
  private lastBoost = 0;
  /** Where the kart was along the lap a frame ago (the road's lookups search only near it). */
  private near: number | undefined = undefined;
  /** Players who asked for less motion get no lean, tilt, shake or punch. */
  calm = false;
  /** 0..1: how hard the picture rushes by (a boost, flat out); the post chain blurs the view's edges by it. */
  rush = 0;
  /** Where the picture rushes out from (the way the kart is going), as 0..1 of the view from its bottom left. */
  readonly focus = { x: 0.5, y: 0.5 };

  /** Starts the next update from scratch (a new race, or a different kart). */
  reset(): void {
    this.fresh = true;
    this.intro = 1;
    this.orbit = 0;
    this.orbitBlend = 0;
    this.lastX = NaN;
    this.near = undefined;
    this.trauma = 0;
    this.thump = 0;
    this.thumpV = 0;
    this.flying = 0;
    this.peak = 0;
    this.punch = 0;
    this.punchTo = 0;
    this.lastBoost = 0;
  }

  /** A short shake: a bump, a hit (0..1, 1 the hardest). */
  kick(strength: number): void {
    if (this.calm) return;
    this.trauma = Math.min(1, this.trauma + strength * 0.7);
  }

  /** A landing: the picture drops with the kart and springs back (0..1, 1 a long fall). */
  land(impact: number): void {
    if (this.calm) return;
    const k = clamp(impact);
    this.thumpV -= 2.5 + 6 * k;
    this.trauma = Math.min(1, this.trauma + 0.15 + 0.4 * k);
  }

  /**
   * Eases the camera toward behind `kart`. `space`, where there is a world, keeps it out of the ground, the roofs over
   * the road and what stands beyond the barrier: it moves where the camera is drawn, not where the camera is heading.
   * `road`, where there is one, lets it pitch with the slope, lean with the banking and look into the bend ahead.
   */
  update(kart: KartView, view: RaceView, dt: number, aspect: number, space?: CameraFit, road?: CameraRoad): void {
    const cam = this.camera;
    const calm = this.calm;
    const speedRatio = Math.abs(kart.speed) / 24;
    const sr = clamp(speedRatio);
    this.clock += dt;

    // Which way the kart is really going, from where it has been.
    if (!Number.isNaN(this.lastX) && dt > 1e-4) {
      const vx = (kart.x - this.lastX) / dt;
      const vz = (kart.z - this.lastZ) / dt;
      if (Math.hypot(vx, vz) > 4 && kart.speed > 0 && Math.hypot(vx, vz) < 90) this.travel = Math.atan2(vx, vz);
      else this.travel = kart.heading;
    } else {
      this.travel = kart.heading;
    }
    this.lastX = kart.x;
    this.lastZ = kart.z;

    // The slide: how far the nose points off the way it goes (a drift's, a skid's).
    const spinning = kart.spin > 0;
    const rescued = kart.rescue > 0;
    const slipNow = spinning || rescued || kart.speed <= 4 ? 0 : clamp(angleDiff(this.travel, kart.heading), -0.8, 0.8);
    this.slip = this.fresh ? slipNow : damp(this.slip, slipNow, 6, dt);

    // Follow the heading, a little behind it in a slide so the slide shows; while spun out, hold the line of travel.
    const drifting = kart.drift !== 0;
    const targetYaw = spinning ? this.travel : kart.heading - this.slip * (drifting ? 0.55 : 0.25);
    if (this.fresh) this.yaw = targetYaw;
    else this.yaw = dampAngle(this.yaw, targetYaw, spinning ? 3 : drifting ? 4 : 6, dt);

    // The intro (high over the grid) is a pure function of the countdown.
    if (view.phase === "countdown") this.intro = clamp(view.countdown / COUNTDOWN_SPAN);
    else this.intro = Math.max(0, this.intro - dt * 1.4);
    const introEase = smoothstep(0, 1, this.intro);

    // After finishing, swing slowly around the kart.
    if (kart.finished !== null) {
      this.orbit += dt * 0.55;
      this.orbitBlend = Math.min(1, this.orbitBlend + dt * 0.6);
    } else {
      this.orbitBlend = Math.max(0, this.orbitBlend - dt * 2);
    }
    const orbitEase = smoothstep(0, 1, this.orbitBlend);
    const swing = Math.sin(this.orbit) * 1.15 * orbitEase;
    /** How much of the camera's life applies: none in the intro or the orbit at the finish. */
    const live = (1 - introEase) * (1 - orbitEase);

    // The road: its slope behind and ahead, the bend coming, its lean.
    let climb = 0;
    let crest = 0;
    let turn = 0;
    let bank = 0;
    if (road && !rescued) {
      let p = road.project(kart.x, kart.z, this.near);
      if ((kart.x - p.sample.x) ** 2 + (kart.z - p.sample.z) ** 2 > 25 * 25) p = road.project(kart.x, kart.z);
      this.near = p.s;
      const t = p.sample;
      // Which way along the lap the kart is going (the wrong way reads the road backwards).
      const dir = Math.sin(this.travel) * t.tx + Math.cos(this.travel) * t.tz >= 0 ? 1 : -1;
      const behind = road.at(p.s - dir * 6);
      const ahead = road.at(p.s + dir * (6 + 6 * sr));
      climb = clamp((t.y - behind.y) / 6, -0.45, 0.45);
      crest = clamp((ahead.y - t.y) / (6 + 6 * sr), -0.45, 0.45);
      const far = road.at(p.s + dir * (14 + 10 * sr));
      turn = angleDiff(Math.atan2(t.tx * dir, t.tz * dir), Math.atan2(far.tx * dir, far.tz * dir));
      if (Math.abs(p.offset) < t.width / 2 + 2) bank = bankSeen(road.rollAt(p.s), t.tx, t.tz, this.yaw);
    }
    if (this.fresh) {
      this.climb = climb;
      this.crest = crest;
    } else {
      this.climb = damp(this.climb, climb, 3, dt);
      this.crest = damp(this.crest, crest, 3, dt);
    }

    // In the air: rising with the kart (the anchor carries its height), a little higher and farther back to see the landing;
    // down again with a thump.
    const airNow = rescued ? 0 : Math.max(0, kart.hop);
    if (airNow > 0.5) {
      this.flying += dt;
      this.peak = Math.max(this.peak, airNow);
    } else if (airNow < 0.15 && this.flying > 0) {
      if (this.flying > 0.15 && !this.fresh) this.land(clamp((this.peak - 0.5) / 3) * 0.6 + clamp(this.flying / 1.2) * 0.4);
      this.flying = 0;
      this.peak = 0;
    }
    const airTarget = smoothstep(0.5, 3, airNow);
    this.air = damp(this.air, airTarget, airTarget > this.air ? 3 : 5, dt);
    if (dt > 0) {
      this.thumpV += (-150 * this.thump - 15 * this.thumpV) * Math.min(dt, 1 / 30);
      this.thump = clamp(this.thump + this.thumpV * Math.min(dt, 1 / 30), -0.5, 0.3);
    }

    // The drift's swing out to the side of the slide, and the aim into the bend ahead (and where the wheel is turning).
    const narrow = clamp(aspect / 1.6, 0.6, 1);
    const sideTarget = spinning || rescued ? 0 : clamp(-kart.drift * 0.5 + this.slip * 1.1, -1.3, 1.3) * smoothstep(0.15, 0.55, speedRatio) * narrow * (calm ? 0.5 : 1);
    this.side = this.fresh ? sideTarget : damp(this.side, sideTarget, 2.5, dt);
    const aimTarget = spinning || rescued ? 0 : (clamp(turn * 0.22, -0.13, 0.13) - kart.steer * 0.04 * sr) * (calm ? 0.5 : 1);
    this.aim = this.fresh ? aimTarget : damp(this.aim, aimTarget, 2.5, dt);

    const { distance, height } = chaseOffsets(speedRatio, this.boost, aspect);
    const back = distance + this.air * 1.0 * live;
    const yaw = this.yaw + swing;
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const rightX = -_fwd.z;
    const rightZ = _fwd.x;
    const lift = orbitEase * 0.4;
    const pitch = calm ? 0.7 : 1;
    const side = this.side * live;
    _want.set(
      kart.x - _fwd.x * (back + lift * 2) + rightX * side,
      kart.y + height - lift + (this.air * 0.7 - back * this.climb * 0.8 * pitch) * live,
      kart.z - _fwd.z * (back + lift * 2) + rightZ * side,
    );
    const aimYaw = yaw + this.aim * live;
    _aim.set(Math.sin(aimYaw), 0, Math.cos(aimYaw));
    _look.set(kart.x + _aim.x * 5.4, kart.y + 1.25 + (5.4 * this.crest * 0.75 * pitch - this.air * 0.5) * live, kart.z + _aim.z * 5.4);

    if (introEase > 0.001) {
      // High and back, drifting round from one side as the lights count down.
      const turnIn = introEase * 0.5;
      const ix = Math.sin(this.yaw + turnIn);
      const iz = Math.cos(this.yaw + turnIn);
      _intro.set(kart.x - ix * (distance + 11 * introEase), kart.y + height + 17 * introEase, kart.z - iz * (distance + 11 * introEase));
      _introLook.set(kart.x + _fwd.x * lerp(4.2, 9, introEase), kart.y + lerp(1, 0.2, introEase), kart.z + _fwd.z * lerp(4.2, 9, introEase));
      _want.lerp(_intro, introEase);
      _look.lerp(_introLook, introEase);
    }

    if (this.fresh || introEase > 0.001) {
      this.pos.copy(_want);
      this.target.copy(_look);
    } else {
      // Position lags a little (it is what makes speed feel fast); the aim lags less.
      this.pos.x = damp(this.pos.x, _want.x, 10, dt);
      this.pos.y = damp(this.pos.y, _want.y, 8, dt);
      this.pos.z = damp(this.pos.z, _want.z, 10, dt);
      this.target.x = damp(this.target.x, _look.x, 14, dt);
      this.target.y = damp(this.target.y, _look.y, 10, dt);
      this.target.z = damp(this.target.z, _look.z, 14, dt);
    }

    // The lens: wider with speed, wider on a boost, and a quick punch as a boost begins.
    const boosting = kart.boost > 0;
    if (boosting && (this.lastBoost <= 0 || kart.boost > this.lastBoost + 0.25) && !this.fresh && !calm) {
      this.punchTo = Math.min(1.2, this.punchTo + clamp(kart.boost / 1.4, 0.55, 1));
    }
    this.lastBoost = kart.boost;
    this.punchTo = damp(this.punchTo, 0, 2.4, dt);
    this.punch = damp(this.punch, this.punchTo, 16, dt);
    this.boost = damp(this.boost, boosting ? 1 : 0, boosting ? 6 : 3, dt);
    const fovTarget = baseFov(aspect) + clamp(speedRatio, 0, 1.2) * 6 + this.boost * (calm ? 3 : 7);
    this.fov = this.fresh ? fovTarget : damp(this.fov, fovTarget, 5, dt);

    // The shake: knocks and landings, and a rumble over rough ground.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const rough = kart.offroad && Math.abs(kart.speed) > 5 && airNow < 0.2 && !rescued ? 0.22 * sr : 0;
    const shake = calm ? 0 : (this.trauma * this.trauma + rough * rough) * live;
    const t = this.clock;
    const sx = shake * 0.32 * wobble(t, 37.1, 23.3, 0.3);
    const sy = shake * 0.26 * wobble(t, 41.9, 29.7, 1.1) + (calm ? 0 : this.thump * live);
    cam.position.set(this.pos.x + rightX * sx, this.pos.y + sy, this.pos.z + rightZ * sx);
    space?.fit(cam.position, kart);
    cam.up.set(0, 1, 0);
    if (calm || this.thump === 0) cam.lookAt(this.target);
    else cam.lookAt(this.target.x, this.target.y + this.thump * 1.3 * live, this.target.z);

    // Lean into the bend with the wheel and the drift, and with the road's own banking.
    const lean = -(kart.steer * sr * 0.05 + kart.drift * 0.03) * (spinning || rescued ? 0.3 : 1);
    const rollTarget = calm ? 0 : clamp(lean - bank * 0.55, -MAX_ROLL, MAX_ROLL) * live;
    this.roll = this.fresh ? rollTarget : damp(this.roll, rollTarget, 4.5, dt);
    cam.rotateZ(this.roll + shake * 0.022 * wobble(t, 33.3, 19.1, 2.2));
    cam.fov = this.fov + this.punch * 7 * live;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();

    // How hard the world rushes past, and from where (far ahead along the way the kart goes).
    const rushTarget = calm ? 0 : clamp(this.boost * 0.65 + smoothstep(1.02, 1.25, speedRatio) * 0.3 + this.punch * 0.3) * live;
    this.rush = this.fresh ? rushTarget : damp(this.rush, rushTarget, 6, dt);
    if (this.rush > 0.001) {
      cam.updateMatrixWorld();
      _focus.set(kart.x + Math.sin(this.travel) * 60, kart.y + 1 + 60 * this.crest * 0.6, kart.z + Math.cos(this.travel) * 60).project(cam);
      this.focus.x = clamp(_focus.x * 0.5 + 0.5, 0.25, 0.75);
      this.focus.y = clamp(_focus.y * 0.5 + 0.5, 0.3, 0.75);
    }
    this.fresh = false;
  }
}
