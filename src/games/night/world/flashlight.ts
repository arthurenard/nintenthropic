import { Color, Object3D, Quaternion, Raycaster, SpotLight, Vector2, Vector3, type PerspectiveCamera } from "three";
import type { BeamVolume } from "./beam";
import type { RayHit } from "../../../engine/world/queries";
import type { NightUniforms } from "./shading";

/**
 * The flashlight's numbers: a warm white lamp under the barrel, a 17° cone
 * whose centre is hot and whose edge falls off softly, and a falloff gentler
 * than the square of distance, so one of the dead at the barricade is lit,
 * not burnt white, and one at 30 m still shows.
 */
export const BEAM = {
  /** Half the cone, radians. */
  angle: 0.3,
  /** How much of the cone is its soft edge. */
  penumbra: 0.6,
  /** Distance falloff exponent (2 would be physical: one at the barricade burnt white, one at 30 m lost). */
  decay: 0.7,
  /** Nothing past this, metres. */
  range: 78,
  /** The lamp's strength (three.js's SpotLight intensity: candela at 1 m). */
  intensity: 11,
  /**
   * How brightly the fog scatters the beam back to the eye. Looking along
   * your own lamp is back-scatter, which fog does weakly: a glow in the
   * wisps, never a wall of light hiding what is in it.
   */
  volume: 0.22,
  color: new Color(1.0, 0.93, 0.8),
  /** The golden rifle's golden beam. */
  golden: new Color(1.0, 0.78, 0.38),
};

/** Where the lamp sits relative to the eye, in the eye's own frame: right, down, forward (under the barrel). */
const MOUNT = new Vector3(0.2, -0.27, -0.32);

const ray = new Raycaster();
const ndc = new Vector2();
const tmp = new Vector3();
const tmp2 = new Vector3();
const q = new Quaternion();

export interface Aimable {
  cast(origin: Vector3, dir: Vector3, far: number, out: RayHit): RayHit | null;
}

/**
 * The flashlight under the rifle's barrel. Its beam follows the aim: it
 * points from the lamp at whatever the crosshair is on (so its centre lands
 * where the shot would), easing after the hand with a little weight, kicked
 * up by each shot and settling in a quarter second. One SpotLight lights the
 * characters; the same numbers go to the baked road's material and to the
 * beam's volume in the fog, so all three agree. At the fall it leaves the
 * hand: it drops, bounces and rolls on the asphalt, its beam swinging
 * across the canopy, and comes to rest pointing along the ground.
 */
export class Flashlight {
  readonly spot = new SpotLight(0xffffff, 0, BEAM.range, BEAM.angle, BEAM.penumbra, BEAM.decay);
  readonly position = new Vector3();
  readonly direction = new Vector3(0, 0, -1);
  /** Where the beam is being pointed (the aim's point in the world), before easing. */
  private readonly wanted = new Vector3(0, 0, -1);
  private readonly velocity = new Vector3();
  private kickPitch = 0;
  private golden = false;
  /** 1 on, 0 off (in the aim check it is on; at the very end it goes out with the picture). */
  power = 1;
  private readonly hit: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
  // The fall.
  private falling = false;
  private fallT = 0;
  private readonly fallFrom = new Vector3();
  private readonly fallVel = new Vector3();
  private readonly spinAxis = new Vector3(1, 0, 0);
  private spinRate = 0;
  private rollHeading = 0;
  private rollRate = 0;

  constructor(parent: Object3D) {
    this.spot.castShadow = false;
    parent.add(this.spot, this.spot.target);
  }

  setGolden(on: boolean): void {
    this.golden = on;
  }

  /** A shot: the beam kicks up with the rifle. */
  kick(reducedMotion: boolean): void {
    this.kickPitch += reducedMotion ? 0.015 : 0.04;
  }

  /** The lever worked: the beam jiggles in the hands. */
  nudge(reducedMotion: boolean): void {
    this.kickPitch += reducedMotion ? 0.004 : 0.012;
  }

  /** Point at the aim, as a hand would: toward the point under the crosshair. */
  aim(camera: PerspectiveCamera, x: number, y: number, queries: Aimable): void {
    if (this.falling) return;
    ndc.set(x * 2 - 1, -(y * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const h = queries.cast(ray.ray.origin, ray.ray.direction, 90, this.hit);
    const d = h ? Math.max(3, h.distance) : 45;
    this.wanted.copy(ray.ray.direction).multiplyScalar(d).add(ray.ray.origin);
  }

  update(dt: number, camera: PerspectiveCamera): void {
    if (this.falling) {
      this.stepFall(dt);
    } else {
      // Mounted under the barrel, in the eye's own frame.
      this.position.copy(MOUNT).applyQuaternion(camera.quaternion).add(camera.position);
      tmp.copy(this.wanted).sub(this.position).normalize();
      // The recoil lifts the beam and lets it settle.
      if (this.kickPitch > 1e-4) {
        tmp2.set(1, 0, 0).applyQuaternion(camera.quaternion);
        tmp.applyQuaternion(q.setFromAxisAngle(tmp2, this.kickPitch)).normalize();
      }
      this.kickPitch *= Math.exp(-dt / 0.07);
      // A critically damped spring after the hand: quick, with weight.
      const w = 34;
      const a = tmp.sub(this.direction).multiplyScalar(w * w).addScaledVector(this.velocity, -2 * w);
      this.velocity.addScaledVector(a, dt);
      this.direction.addScaledVector(this.velocity, dt).normalize();
    }
    const colour = this.golden ? BEAM.golden : BEAM.color;
    this.spot.color.copy(colour);
    this.spot.intensity = BEAM.intensity * this.power;
    this.spot.position.copy(this.position);
    this.spot.target.position.copy(this.position).add(this.direction);
    this.spot.target.updateMatrixWorld();
  }

  /** Hand the beam to the road's material and the fog's volume. */
  apply(u: NightUniforms, v: BeamVolume): void {
    const colour = this.golden ? BEAM.golden : BEAM.color;
    const cosOuter = Math.cos(BEAM.angle);
    const cosInner = Math.cos(BEAM.angle * (1 - BEAM.penumbra));
    u.uBeamPos.value.copy(this.position);
    u.uBeamDir.value.copy(this.direction);
    u.uBeamColor.value.copy(colour).multiplyScalar(BEAM.intensity * this.power);
    u.uBeamShape.value.set(cosOuter, cosInner, BEAM.decay, BEAM.range);
    v.uBeamPos.value.copy(this.position);
    v.uBeamDir.value.copy(this.direction);
    v.uBeamShape.value.set(cosOuter, cosInner, BEAM.decay, BEAM.range);
    v.uBeamGlow.value.copy(colour).multiplyScalar(BEAM.volume * BEAM.intensity * this.power);
  }

  /**
   * How strongly the beam falls on a point (0 outside the cone), relative to
   * its strength 10 m out on its axis: what makes the dead's eyes shine
   * back, and the scarecrow feel watched.
   */
  lightAt(p: Vector3): number {
    tmp.copy(p).sub(this.position);
    const d = tmp.length();
    if (d < 1e-3 || this.power <= 0) return 0;
    const c = tmp.dot(this.direction) / d;
    const cosOuter = Math.cos(BEAM.angle);
    const cosInner = Math.cos(BEAM.angle * (1 - BEAM.penumbra));
    const k = Math.min(1, Math.max(0, (c - cosOuter) / (cosInner - cosOuter)));
    const spot = k * k * (3 - 2 * k);
    return (spot * this.power * Math.pow(10 / Math.max(d, 1), BEAM.decay));
  }

  /** The fall: the lamp leaves the hand and drops to the asphalt. */
  drop(side: number, random: () => number): void {
    if (this.falling) return;
    this.falling = true;
    this.fallT = 0;
    this.fallFrom.copy(this.position);
    this.fallVel.set(side * (0.4 + random() * 0.4), 0.9, -0.9 - random() * 0.5);
    // It tumbles end over end: the beam swings up across the canopy.
    this.spinAxis.set(1, 0, side * 0.3).normalize();
    this.spinRate = -7 - random() * 3;
    this.rollHeading = Math.atan2(this.direction.x, -this.direction.z);
    this.rollRate = side * (2.5 + random() * 1.5);
  }

  get dropped(): boolean {
    return this.falling;
  }

  private stepFall(dt: number): void {
    this.fallT += dt;
    const t = this.fallT;
    const ground = 0.06;
    if (t < 0.62) {
      // Falling, tumbling.
      this.position.set(
        this.fallFrom.x + this.fallVel.x * t,
        Math.max(ground, this.fallFrom.y + this.fallVel.y * t - 4.9 * t * t),
        this.fallFrom.z + this.fallVel.z * t,
      );
      this.direction.applyQuaternion(q.setFromAxisAngle(this.spinAxis, this.spinRate * dt)).normalize();
      return;
    }
    // On the asphalt: rolling, slowing, the beam sweeping along the ground.
    const roll = Math.exp(-(t - 0.62) * 1.4);
    this.position.y = ground + Math.abs(Math.sin(t * 9)) * 0.02 * roll;
    this.position.x += Math.cos(this.rollHeading) * this.rollRate * 0.1 * roll * dt;
    this.position.z += Math.sin(this.rollHeading) * this.rollRate * 0.1 * roll * dt;
    this.rollHeading += this.rollRate * roll * dt;
    tmp.set(Math.sin(this.rollHeading), 0.03, -Math.cos(this.rollHeading)).normalize();
    this.direction.lerp(tmp, Math.min(1, dt * 6)).normalize();
  }

  /** Back in the hand (a new round). */
  reset(camera: PerspectiveCamera): void {
    this.falling = false;
    this.fallT = 0;
    this.kickPitch = 0;
    this.velocity.set(0, 0, 0);
    this.power = 1;
    camera.getWorldDirection(this.direction);
    this.wanted.copy(camera.position).addScaledVector(this.direction, 30);
  }
}
