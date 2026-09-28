import { Quaternion, Vector3, type Object3D } from "three";

/**
 * Things knocked loose that tumble through the air to rest: a hat shot off,
 * a dropped gun, a helmet, a shard. Gravity, a spin, two small bounces and
 * still; no physics engine. A thing taken from a character (its gun) keeps
 * where it came from, so it can go back for the character's next outing.
 */
export class Tumbler {
  object: Object3D | null = null;
  readonly vel = new Vector3();
  readonly spin = new Vector3();
  /** The height it comes to rest at, metres (the game asks its world). */
  floor = 0;
  resting = false;
  active = false;
  /** Where it came from, to put it back. */
  home: Object3D | null = null;
  readonly homePos = new Vector3();
  readonly homeQuat = new Quaternion();
}

export class Tumblers {
  readonly items: Tumbler[] = [];

  constructor(
    count = 8,
    /** Metres per second squared. */
    private readonly gravity = 9.81,
  ) {
    for (let i = 0; i < count; i++) this.items.push(new Tumbler());
  }

  /** A free tumbler; with all busy, the first is put back and reused (it has long come to rest). */
  take(): Tumbler {
    for (const t of this.items) if (!t.active) return claim(t);
    const t = this.items[0] as Tumbler;
    this.restore(t);
    return claim(t);
  }

  /**
   * Done with it: a thing with a home goes back there as it was; anything
   * else is hidden.
   */
  restore(t: Tumbler): void {
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

  update(dt: number): void {
    for (const t of this.items) {
      if (!t.active || t.resting || !t.object) continue;
      const o = t.object;
      t.vel.y -= this.gravity * dt;
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

  /** Everything back where it belongs (a new round). */
  reset(): void {
    for (const t of this.items) if (t.active) this.restore(t);
  }
}

function claim(t: Tumbler): Tumbler {
  t.active = true;
  t.resting = false;
  return t;
}
