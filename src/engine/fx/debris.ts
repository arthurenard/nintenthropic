import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
} from "three";

export interface DebrisStyle {
  life: [number, number];
  scale: [number, number];
  /** Metres per second squared. */
  gravity: number;
  /** Fraction of vertical speed kept on a bounce. */
  bounce: number;
  /** Radians per second. */
  spin: number;
  drag: number;
}

/** A shard of glass for a pool of them: a thin irregular triangle, a few centimetres across. */
export function shardGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const p = [0, 0.05, 0, -0.03, -0.03, 0.002, 0.035, -0.02, -0.002, 0, 0.05, 0, 0.035, -0.02, -0.002, -0.03, -0.03, 0.002];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p = new Vector3();
const s = new Vector3();

/**
 * Small solid pieces with a little physics, all drawn as one InstancedMesh:
 * glass shards, wood splinters, pebbles, twigs, feathers. They fall, bounce
 * once or twice on their floor, lie still, then shrink away. Fixed capacity,
 * packed like the particle pool, nothing allocated after construction.
 */
export class DebrisPool {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly ang: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly scale: Float32Array;
  private readonly floor: Float32Array;
  private readonly gravity: Float32Array;
  private readonly bounce: Float32Array;
  private readonly drag: Float32Array;
  private readonly colors: Float32Array;
  private readonly vectors: Float32Array[];
  private readonly scalars: Float32Array[];
  private random: () => number = Math.random;

  constructor(geometry: BufferGeometry, material: Material, capacity: number) {
    this.capacity = capacity;
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.colors = new Float32Array(capacity * 3).fill(1);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.ang = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.floor = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.bounce = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.vectors = [this.pos, this.vel, this.rot, this.ang, this.colors];
    this.scalars = [this.life, this.age, this.scale, this.floor, this.gravity, this.bounce, this.drag];
  }

  setRandom(random: () => number): void {
    this.random = random;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, floorY: number, st: DebrisStyle, color: Color): void {
    const i = this.count < this.capacity ? this.count++ : Math.floor(this.random() * this.capacity);
    const r = this.random;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.rot[i3] = r() * 6.28;
    this.rot[i3 + 1] = r() * 6.28;
    this.rot[i3 + 2] = r() * 6.28;
    this.ang[i3] = (r() - 0.5) * 2 * st.spin;
    this.ang[i3 + 1] = (r() - 0.5) * 2 * st.spin;
    this.ang[i3 + 2] = (r() - 0.5) * 2 * st.spin;
    this.colors[i3] = color.r;
    this.colors[i3 + 1] = color.g;
    this.colors[i3 + 2] = color.b;
    this.life[i] = st.life[0] + (st.life[1] - st.life[0]) * r();
    this.age[i] = 0;
    this.scale[i] = st.scale[0] + (st.scale[1] - st.scale[0]) * r();
    this.floor[i] = floorY;
    this.gravity[i] = st.gravity;
    this.bounce[i] = st.bounce;
    this.drag[i] = st.drag;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      const age = (this.age[i] as number) + dt;
      this.age[i] = age;
      const life = this.life[i] as number;
      if (age >= life) {
        this.kill(i);
        continue;
      }
      const i3 = i * 3;
      const damp = Math.max(0, 1 - (this.drag[i] as number) * dt);
      let vx = (this.vel[i3] as number) * damp;
      let vy = (this.vel[i3 + 1] as number) * damp - (this.gravity[i] as number) * dt;
      let vz = (this.vel[i3 + 2] as number) * damp;
      let x = (this.pos[i3] as number) + vx * dt;
      let y = (this.pos[i3 + 1] as number) + vy * dt;
      let z = (this.pos[i3 + 2] as number) + vz * dt;
      const floor = this.floor[i] as number;
      let resting = false;
      if (y < floor) {
        y = floor;
        if (Math.abs(vy) > 0.6) {
          vy = -vy * (this.bounce[i] as number);
          vx *= 0.55;
          vz *= 0.55;
          this.ang[i3] = (this.ang[i3] as number) * 0.5;
          this.ang[i3 + 2] = (this.ang[i3 + 2] as number) * 0.5;
        } else {
          vx = vy = vz = 0;
          resting = true;
        }
      }
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy;
      this.vel[i3 + 2] = vz;
      this.pos[i3] = x;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] = z;
      if (!resting) {
        this.rot[i3] = (this.rot[i3] as number) + (this.ang[i3] as number) * dt;
        this.rot[i3 + 1] = (this.rot[i3 + 1] as number) + (this.ang[i3 + 1] as number) * dt;
        this.rot[i3 + 2] = (this.rot[i3 + 2] as number) + (this.ang[i3 + 2] as number) * dt;
      } else {
        // Lie flat-ish once still.
        this.rot[i3] = (this.rot[i3] as number) * 0.9;
        this.rot[i3 + 2] = (this.rot[i3 + 2] as number) * 0.9;
      }
      // Shrink away over the last fifth of life.
      const tail = Math.min(1, (life - age) / (life * 0.2));
      const sc = (this.scale[i] as number) * tail;
      e.set(this.rot[i3] as number, this.rot[i3 + 1] as number, this.rot[i3 + 2] as number);
      q.setFromEuler(e);
      p.set(x, y, z);
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
      i++;
    }
    this.mesh.count = this.count;
    if (this.count > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      const ic = this.mesh.instanceColor;
      if (ic) {
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, this.count * 3);
        ic.needsUpdate = true;
      }
    }
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of this.vectors) {
      a[i * 3] = a[last * 3] as number;
      a[i * 3 + 1] = a[last * 3 + 1] as number;
      a[i * 3 + 2] = a[last * 3 + 2] as number;
    }
    for (const a of this.scalars) a[i] = a[last] as number;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
