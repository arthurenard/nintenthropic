/**
 * The chase camera: behind and above the kart, eased, with the field of view
 * opening up with speed and boost.
 *
 * It follows the kart's direction of travel, not the spin: when a kart is
 * spun out, the view holds the way it was going instead of whirling with it.
 * Through the countdown it begins high over the grid and settles into the
 * chase position by the time the lights go green; once a kart has finished it
 * swings slowly around it.
 */
import { PerspectiveCamera, Vector3 } from "three";
import type { KartView, RaceView } from "../contract";
import { clamp, damp, dampAngle, lerp, smoothstep } from "./math";

/** The countdown's length including the half second of "ready" (docs/GRIP_PRIX.md). */
export const COUNTDOWN_SPAN = 3.5;

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

const _fwd = new Vector3();
const _want = new Vector3();
const _look = new Vector3();
const _intro = new Vector3();
const _introLook = new Vector3();

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
  private kickX = 0;
  private kickY = 0;
  private fresh = true;
  /** Players who asked for less motion get no shake. */
  calm = false;

  /** Starts the next update from scratch (a new race, or a different kart). */
  reset(): void {
    this.fresh = true;
    this.intro = 1;
    this.orbit = 0;
    this.orbitBlend = 0;
    this.lastX = NaN;
  }

  /** A short shake: a bump, a hit. */
  kick(strength: number): void {
    if (this.calm) return;
    this.kickX += (Math.random() - 0.5) * strength;
    this.kickY += (Math.random() - 0.5) * strength;
  }

  update(kart: KartView, view: RaceView, dt: number, aspect: number): void {
    const cam = this.camera;
    const speedRatio = Math.abs(kart.speed) / 24;

    // Which way the kart is really going, from where it has been.
    if (!Number.isNaN(this.lastX) && dt > 1e-4) {
      const vx = (kart.x - this.lastX) / dt;
      const vz = (kart.z - this.lastZ) / dt;
      if (Math.hypot(vx, vz) > 4 && kart.speed > 0) this.travel = Math.atan2(vx, vz);
      else this.travel = kart.heading;
    } else {
      this.travel = kart.heading;
    }
    this.lastX = kart.x;
    this.lastZ = kart.z;

    // Follow the heading, except while spun out: then hold the line of travel.
    const spinning = kart.spin > 0;
    const targetYaw = spinning ? this.travel : kart.heading;
    if (this.fresh) this.yaw = kart.heading;
    else this.yaw = dampAngle(this.yaw, targetYaw, spinning ? 3 : kart.drift !== 0 ? 4.5 : 7, dt);

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
    const swing = Math.sin(this.orbit) * 1.15 * smoothstep(0, 1, this.orbitBlend);

    const { distance, height } = chaseOffsets(speedRatio, this.boost, aspect);
    const yaw = this.yaw + swing;
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const lift = smoothstep(0, 1, this.orbitBlend) * 0.4;
    _want.set(kart.x - _fwd.x * (distance + lift * 2), kart.y + height - lift, kart.z - _fwd.z * (distance + lift * 2));
    _look.set(kart.x + _fwd.x * 4.6, kart.y + 0.9, kart.z + _fwd.z * 4.6);

    if (introEase > 0.001) {
      // High and back, drifting round from one side as the lights count down.
      const side = introEase * 0.5;
      const ix = Math.sin(this.yaw + side);
      const iz = Math.cos(this.yaw + side);
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

    this.boost = damp(this.boost, kart.boost > 0 ? 1 : 0, kart.boost > 0 ? 6 : 3, dt);
    const fovTarget = baseFov(aspect) + clamp(speedRatio, 0, 1.2) * 6 + this.boost * 7;
    this.fov = this.fresh ? fovTarget : damp(this.fov, fovTarget, 5, dt);

    this.kickX = damp(this.kickX, 0, 9, dt);
    this.kickY = damp(this.kickY, 0, 9, dt);
    cam.position.set(this.pos.x + this.kickX * 0.6, this.pos.y + this.kickY * 0.5, this.pos.z + this.kickX * 0.4);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    // Lean into the bend, a hair.
    const rollTarget = -kart.steer * clamp(speedRatio, 0, 1) * 0.03 - kart.drift * 0.015;
    this.roll = this.fresh ? rollTarget : damp(this.roll, rollTarget, 6, dt);
    cam.rotateZ(this.roll);
    cam.fov = this.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    this.fresh = false;
  }
}
