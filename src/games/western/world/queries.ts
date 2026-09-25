import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type Intersection,
  type Object3D,
} from "three";
import type { TownLayout } from "./town";

export interface RayHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
  /** The town mesh that was hit (for its `surface`, and whether it is a secret). */
  object: Object3D | null;
}

const CELL = 8;

/**
 * Ray queries against the town: where a bullet lands, how high the ground
 * is under a falling body, whether the sun reaches a character. The static
 * meshes are split once into invisible collision chunks on an 8 m grid, so a
 * ray only walks the triangles near it instead of the tens of thousands in a
 * whole street's ground.
 */
export class TownQueries {
  readonly raycaster = new Raycaster();
  readonly colliders: Mesh[] = [];
  private readonly hits: Intersection[] = [];
  private readonly material = new MeshBasicMaterial({ side: DoubleSide, visible: false });

  constructor(town: TownLayout) {
    town.root.updateMatrixWorld(true);
    for (const m of town.solids) {
      // Moving secrets keep their live mesh. Everything static is copied into
      // world-space, double-sided chunks: a ray from inside a room (is the sun
      // on this bandit?) must see walls that were only modelled from outside.
      if (isUnderSecret(m)) this.colliders.push(m);
      else this.chunk(m);
    }
  }

  private chunk(mesh: Mesh): void {
    const g = mesh.geometry as BufferGeometry;
    const pos = g.getAttribute("position") as BufferAttribute;
    const index = g.index;
    const count = index ? index.count : pos.count;
    const cells = new Map<string, number[]>();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
      const cx = Math.floor((a.x + b.x + c.x) / 3 / CELL);
      const cz = Math.floor((a.z + b.z + c.z) / 3 / CELL);
      const key = `${cx},${cz}`;
      let list = cells.get(key);
      if (!list) {
        list = [];
        cells.set(key, list);
      }
      list.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    for (const list of cells.values()) {
      const cg = new BufferGeometry();
      cg.setAttribute("position", new BufferAttribute(new Float32Array(list), 3));
      cg.computeVertexNormals();
      cg.computeBoundingSphere();
      cg.computeBoundingBox();
      const cm = new Mesh(cg, this.material);
      cm.userData["source"] = mesh;
      cm.matrixAutoUpdate = false;
      cm.updateMatrixWorld(true);
      this.colliders.push(cm);
    }
  }

  /** The first solid surface along a ray, or null within `far`. */
  cast(origin: Vector3, dir: Vector3, far: number, out: RayHit): RayHit | null {
    this.raycaster.set(origin, dir);
    this.raycaster.near = 0;
    this.raycaster.far = far;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.colliders, false, this.hits);
    for (const h of this.hits) {
      const object = (h.object.userData["source"] as Object3D | undefined) ?? h.object;
      if (!isVisibleDeep(object)) continue;
      out.point.copy(h.point);
      out.distance = h.distance;
      out.object = object;
      if (h.face) {
        out.normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (out.normal.dot(dir) > 0) out.normal.negate();
      } else {
        out.normal.copy(dir).negate();
      }
      return out;
    }
    return null;
  }

  private readonly down = new Vector3(0, -1, 0);
  private readonly probe = new Vector3();
  private readonly scratch: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };

  /** Height of the first surface below (x, fromY, z); 0 if nothing. */
  groundAt(x: number, z: number, fromY: number): number {
    this.probe.set(x, fromY, z);
    const h = this.cast(this.probe, this.down, fromY + 5, this.scratch);
    return h ? h.point.y : 0;
  }

  /** Does sunlight reach `from`? `toSun` points at the sun. */
  sunReaches(from: Vector3, toSun: Vector3): boolean {
    return this.cast(from, toSun, 80, this.scratch) === null;
  }

  dispose(): void {
    for (const c of this.colliders) if (c.userData["source"]) c.geometry.dispose();
    this.material.dispose();
  }
}

function isUnderSecret(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) {
    const name = n.userData["name"];
    if (typeof name === "string" && name.startsWith("secret.")) return true;
  }
  return false;
}

function isVisibleDeep(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}
