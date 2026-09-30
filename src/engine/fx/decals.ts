import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Texture,
} from "three";

const m = new Matrix4();
const q = new Quaternion();
const q2 = new Quaternion();
const z = new Vector3(0, 0, 1);
const p = new Vector3();
const s = new Vector3();

/**
 * Bullet holes that stay where they land, as one InstancedMesh ring buffer:
 * the newest replaces the oldest once the pool is full. Unlit, like the baked
 * town they sit on, and pushed toward the camera in depth so they never
 * fight the wall beneath.
 */
export class DecalPool {
  readonly mesh: InstancedMesh;
  private next = 0;
  private used = 0;
  private readonly colors: Float32Array;

  constructor(texture: Texture, readonly capacity: number) {
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      name: "bullet-holes",
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.colors = new Float32Array(capacity * 3).fill(1);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.colors, 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** A hole at `point` on a surface facing `normal`, `size` metres across. */
  add(point: Vector3, normal: Vector3, size: number, roll: number, tint: Color): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.used = Math.min(this.capacity, this.used + 1);
    q.setFromUnitVectors(z, normal);
    q2.setFromAxisAngle(z, roll);
    q.multiply(q2);
    p.copy(point).addScaledVector(normal, 0.004);
    s.set(size, size, size);
    m.compose(p, q, s);
    this.mesh.setMatrixAt(i, m);
    this.colors[i * 3] = tint.r;
    this.colors[i * 3 + 1] = tint.g;
    this.colors[i * 3 + 2] = tint.b;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.next = 0;
    this.used = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material as MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }
}
