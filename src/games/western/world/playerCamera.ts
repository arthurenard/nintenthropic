import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";

const e = new Euler(0, 0, 0, "YXZ");
const q = new Quaternion();

/**
 * The player's eye: placed by the town's `camera.player`, with the life a
 * held pose has — a slow breath, a kick when the revolver fires that settles
 * in a quarter second, a flinch when hit, a shake when dynamite goes off,
 * and, at the end, the slow tip into the dust.
 */
export class PlayerCamera {
  readonly camera: PerspectiveCamera;
  private readonly basePos = new Vector3();
  private readonly baseQuat = new Quaternion();
  private t = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private flinchRoll = 0;
  private flinchYaw = 0;
  private shake = 0;
  private death = 0;
  private deathSide = 1;
  /** No breathing or kick: during the aim check the bottles must hold still. */
  still = false;
  reducedMotion = false;

  constructor(position: Vector3, quaternion: Quaternion, fov: number) {
    this.camera = new PerspectiveCamera(fov, 16 / 10, 0.1, 400);
    this.basePos.copy(position);
    this.baseQuat.copy(quaternion);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The revolver fires: the view kicks up and a hair sideways. */
  kick(random: () => number): void {
    if (this.still) return;
    const k = this.reducedMotion ? 0.4 : 1;
    this.recoilPitch += 0.02 * k;
    this.recoilYaw += (random() - 0.5) * 0.008 * k;
  }

  /** Hit from `direction` (radians, + right): flinch away from it. */
  flinch(direction: number, amount: number): void {
    const k = this.reducedMotion ? 0.3 : 1;
    this.flinchRoll += -Math.sin(direction) * 0.05 * amount * k;
    this.flinchYaw += -Math.sin(direction) * 0.015 * amount * k;
    this.shake = Math.max(this.shake, 0.35 * amount * k);
  }

  rumble(amount: number): void {
    this.shake = Math.max(this.shake, amount * (this.reducedMotion ? 0.3 : 1));
  }

  /** 0 alive … 1 lying in the dust. */
  setDeath(progress: number, side: number): void {
    this.death = progress;
    this.deathSide = side >= 0 ? 1 : -1;
  }

  update(dt: number): void {
    this.t += dt;
    // Recoil and flinch settle exponentially: ~250 ms to rest.
    const settle = Math.exp(-dt / 0.07);
    this.recoilPitch *= settle;
    this.recoilYaw *= settle;
    const slow = Math.exp(-dt / 0.18);
    this.flinchRoll *= slow;
    this.flinchYaw *= slow;
    this.shake *= Math.exp(-dt / 0.25);
    this.apply();
  }

  private apply(): void {
    const cam = this.camera;
    const breathe = this.still || this.reducedMotion ? 0 : 1;
    const t = this.t;
    let pitch = this.recoilPitch + breathe * (Math.sin(t * 1.45) * 0.0022 + Math.sin(t * 0.61) * 0.0012);
    let yaw = this.recoilYaw + this.flinchYaw + breathe * (Math.sin(t * 0.83 + 1.3) * 0.0016);
    let roll = this.flinchRoll;
    let dy = breathe * Math.sin(t * 1.45) * 0.006;
    if (this.shake > 1e-4) {
      pitch += (Math.sin(t * 71) * 0.6 + Math.sin(t * 43) * 0.4) * this.shake * 0.02;
      yaw += (Math.sin(t * 57 + 1) * 0.6 + Math.sin(t * 31) * 0.4) * this.shake * 0.02;
    }
    if (this.death > 0) {
      // The legs go first: a drop, then the view rolls over into the dust.
      const d = this.death;
      const fall = d * d * (3 - 2 * d);
      dy -= fall * (this.basePos.y - 0.28);
      roll += this.deathSide * fall * 1.25;
      pitch += Math.sin(d * Math.PI) * -0.18 + fall * 0.06;
    }
    e.set(pitch, yaw, roll, "YXZ");
    q.setFromEuler(e);
    cam.quaternion.copy(this.baseQuat).multiply(q);
    cam.position.copy(this.basePos);
    cam.position.y += dy;
    cam.updateMatrixWorld(true);
  }

  get eye(): Vector3 {
    return this.basePos;
  }

  /** The eye's heading about Y (radians), for damage directions. */
  get yaw(): number {
    e.setFromQuaternion(this.baseQuat, "YXZ");
    return e.y;
  }
}
