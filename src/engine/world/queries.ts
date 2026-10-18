/**
 * Ray queries against a world's scenery - where a bullet lands, how high the
 * ground is under a falling body, whether the sun (or the moon) reaches a
 * character - fast enough to ask dozens of times a frame. The static
 * scenery is filed in a TriangleGrid; the few meshes that move (High Noon's
 * bell, vane and church doors) are tested as they are.
 */
import { BufferAttribute, BufferGeometry, Raycaster, Vector3, type Intersection, type Mesh, type Object3D } from "three";

export interface RayHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
  /** The mesh that was hit (for its `surface`, say, or whether it is a secret). */
  object: Object3D | null;
}

/** The grid's cell, metres on a side (seen from above). */
const CELL = 2;
/** A triangle covering more than this many cells goes in the short list every ray checks instead. */
const BIG = 256;

/**
 * Every static triangle of the scenery in world space, filed in a grid of
 * 2 m columns seen from above. A ray walks the columns it crosses, nearest
 * first, and tests only their triangles: a few dozen instead of High Noon's
 * town's 176,000 (or, before this, a bounding-sphere test against each of
 * 12,000 chunks, which cost half a millisecond a ray). Double-sided: a ray
 * from inside a room (is the sun on this bandit?) must see walls modelled
 * from outside. Suits a world laid out across the ground (a street, a road,
 * a valley); one stacked high in a single column gains less.
 */
export class TriangleGrid {
  /** Three corners per triangle, xyz each. */
  private readonly tri: Float32Array;
  /** The mesh each triangle came from. */
  private readonly owner: Int32Array;
  readonly owners: Object3D[];
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly big: Int32Array;
  /** Which ray last tested each triangle (a triangle in several columns is tested once). */
  private readonly seen: Uint32Array;
  private ray = 0;
  readonly count: number;

  constructor(meshes: readonly Mesh[]) {
    const v = new Vector3();
    let total = 0;
    for (const m of meshes) {
      const g = m.geometry as BufferGeometry;
      const pos = g.getAttribute("position") as BufferAttribute | undefined;
      if (!pos) continue;
      total += Math.floor((g.index ? g.index.count : pos.count) / 3);
    }
    this.count = total;
    this.tri = new Float32Array(total * 9);
    this.owner = new Int32Array(total);
    this.owners = [];
    let t = 0;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const m of meshes) {
      const g = m.geometry as BufferGeometry;
      const pos = g.getAttribute("position") as BufferAttribute | undefined;
      if (!pos) continue;
      m.updateMatrixWorld(true);
      const oi = this.owners.length;
      this.owners.push(m);
      const index = g.index;
      const n = Math.floor((index ? index.count : pos.count) / 3);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          const vi = index ? index.getX(i * 3 + k) : i * 3 + k;
          v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld);
          const o = t * 9 + k * 3;
          this.tri[o] = v.x;
          this.tri[o + 1] = v.y;
          this.tri[o + 2] = v.z;
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.z < minZ) minZ = v.z;
          if (v.z > maxZ) maxZ = v.z;
        }
        this.owner[t] = oi;
        t++;
      }
    }
    if (!Number.isFinite(minX)) minX = minZ = maxX = maxZ = 0;
    this.x0 = minX;
    this.z0 = minZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
    // Two passes: count each column's triangles, then file them (one flat array).
    const cells = this.nx * this.nz;
    const counts = new Int32Array(cells + 1);
    const bigList: number[] = [];
    const span = (i: number): [number, number, number, number] => {
      const o = i * 9;
      const ax = this.tri[o] as number;
      const bx = this.tri[o + 3] as number;
      const cx = this.tri[o + 6] as number;
      const az = this.tri[o + 2] as number;
      const bz = this.tri[o + 5] as number;
      const cz = this.tri[o + 8] as number;
      return [
        this.cellX(Math.min(ax, bx, cx)),
        this.cellX(Math.max(ax, bx, cx)),
        this.cellZ(Math.min(az, bz, cz)),
        this.cellZ(Math.max(az, bz, cz)),
      ];
    };
    for (let i = 0; i < total; i++) {
      const [i0, i1, k0, k1] = span(i);
      if ((i1 - i0 + 1) * (k1 - k0 + 1) > BIG) {
        bigList.push(i);
        continue;
      }
      for (let k = k0; k <= k1; k++) {
        for (let j = i0; j <= i1; j++) {
          const c = k * this.nx + j;
          counts[c] = (counts[c] as number) + 1;
        }
      }
    }
    this.start = new Int32Array(cells + 1);
    for (let c = 0; c < cells; c++) this.start[c + 1] = (this.start[c] as number) + (counts[c] as number);
    this.items = new Int32Array(this.start[cells] as number);
    const fill = this.start.slice(0, cells);
    for (let i = 0; i < total; i++) {
      const [i0, i1, k0, k1] = span(i);
      if ((i1 - i0 + 1) * (k1 - k0 + 1) > BIG) continue;
      for (let k = k0; k <= k1; k++) {
        for (let j = i0; j <= i1; j++) {
          const c = k * this.nx + j;
          this.items[fill[c] as number] = i;
          fill[c] = (fill[c] as number) + 1;
        }
      }
    }
    this.big = Int32Array.from(bigList);
    this.seen = new Uint32Array(total);
  }

  private cellX(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / CELL)));
  }

  private cellZ(z: number): number {
    return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) / CELL)));
  }

  /**
   * The nearest triangle along the ray within `far` whose mesh `accept`s it
   * (a mesh hidden now is passed through), or null. Returns the distance and
   * writes the triangle's index to `out[0]`.
   */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, accept: (owner: Object3D) => boolean, out: Int32Array): number {
    this.ray = (this.ray + 1) >>> 0;
    if (this.ray === 0) {
      this.seen.fill(0);
      this.ray = 1;
    }
    this.best = far;
    this.bestTri = -1;
    this.accept = accept;
    for (let b = 0; b < this.big.length; b++) this.test(this.big[b] as number, ox, oy, oz, dx, dy, dz);

    // Walk the columns the ray crosses (Amanatides & Woo, in x and z),
    // first clipping the ray to the grid's box, seen from above.
    const x1 = this.x0 + this.nx * CELL;
    const z1 = this.z0 + this.nz * CELL;
    let tEnter = 0;
    let tExit = far;
    let inside = true;
    if (Math.abs(dx) < 1e-12) inside = ox >= this.x0 && ox <= x1;
    else {
      const a = (this.x0 - ox) / dx;
      const c = (x1 - ox) / dx;
      tEnter = Math.max(tEnter, Math.min(a, c));
      tExit = Math.min(tExit, Math.max(a, c));
    }
    if (Math.abs(dz) < 1e-12) inside = inside && oz >= this.z0 && oz <= z1;
    else {
      const a = (this.z0 - oz) / dz;
      const c = (z1 - oz) / dz;
      tEnter = Math.max(tEnter, Math.min(a, c));
      tExit = Math.min(tExit, Math.max(a, c));
    }
    if (inside && tEnter <= tExit) {
      const px = ox + dx * tEnter;
      const pz = oz + dz * tEnter;
      let j = this.cellX(px);
      let k = this.cellZ(pz);
      const stepJ = dx > 0 ? 1 : -1;
      const stepK = dz > 0 ? 1 : -1;
      const nextX = this.x0 + (j + (dx > 0 ? 1 : 0)) * CELL;
      const nextZ = this.z0 + (k + (dz > 0 ? 1 : 0)) * CELL;
      let tMaxX = Math.abs(dx) < 1e-12 ? Infinity : (nextX - ox) / dx;
      let tMaxZ = Math.abs(dz) < 1e-12 ? Infinity : (nextZ - oz) / dz;
      const tDeltaX = Math.abs(dx) < 1e-12 ? Infinity : CELL / Math.abs(dx);
      const tDeltaZ = Math.abs(dz) < 1e-12 ? Infinity : CELL / Math.abs(dz);
      for (let guard = 0; guard < 100000; guard++) {
        const c = k * this.nx + j;
        const e = this.start[c + 1] as number;
        for (let s = this.start[c] as number; s < e; s++) this.test(this.items[s] as number, ox, oy, oz, dx, dy, dz);
        const leave = Math.min(tMaxX, tMaxZ, tExit);
        // Nothing in a later column can be nearer than what this one found.
        if (this.best <= leave || leave >= tExit) break;
        if (tMaxX < tMaxZ) {
          j += stepJ;
          tMaxX += tDeltaX;
          if (j < 0 || j >= this.nx) break;
        } else {
          k += stepK;
          tMaxZ += tDeltaZ;
          if (k < 0 || k >= this.nz) break;
        }
      }
    }
    out[0] = this.bestTri;
    return this.bestTri >= 0 ? this.best : -1;
  }

  // The ray being cast (fields, not a closure: a cast allocates nothing).
  private best = 0;
  private bestTri = -1;
  private accept: (owner: Object3D) => boolean = () => true;

  private test(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    if (this.seen[i] === this.ray) return;
    this.seen[i] = this.ray;
    const t = this.hit(i, ox, oy, oz, dx, dy, dz);
    if (t >= 0 && t < this.best && this.accept(this.owners[this.owner[i] as number] as Object3D)) {
      this.best = t;
      this.bestTri = i;
    }
  }

  /** Möller–Trumbore, both faces: the distance to triangle `i`, or −1. */
  private hit(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const p = this.tri;
    const o = i * 9;
    const ax = p[o] as number;
    const ay = p[o + 1] as number;
    const az = p[o + 2] as number;
    const e1x = (p[o + 3] as number) - ax;
    const e1y = (p[o + 4] as number) - ay;
    const e1z = (p[o + 5] as number) - az;
    const e2x = (p[o + 6] as number) - ax;
    const e2y = (p[o + 7] as number) - ay;
    const e2z = (p[o + 8] as number) - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const w = (dx * qx + dy * qy + dz * qz) * inv;
    if (w < 0 || u + w > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t >= 0 ? t : -1;
  }

  /** Triangle `i`'s face normal, into `out`. */
  normal(i: number, out: Vector3): Vector3 {
    const p = this.tri;
    const o = i * 9;
    const e1x = (p[o + 3] as number) - (p[o] as number);
    const e1y = (p[o + 4] as number) - (p[o + 1] as number);
    const e1z = (p[o + 5] as number) - (p[o + 2] as number);
    const e2x = (p[o + 6] as number) - (p[o] as number);
    const e2y = (p[o + 7] as number) - (p[o + 1] as number);
    const e2z = (p[o + 8] as number) - (p[o + 2] as number);
    return out.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
  }

  ownerOf(i: number): Object3D {
    return this.owners[this.owner[i] as number] as Object3D;
  }
}

/**
 * Rays against the scenery: `solids` never move (filed in a TriangleGrid
 * once, at load); `moving` are tested as they are, each time. A hidden mesh
 * (or one under a hidden parent) is passed through.
 */
export class SceneryQueries {
  readonly raycaster = new Raycaster();
  /** The moving meshes, tested as meshes. */
  readonly colliders: Mesh[];
  readonly grid: TriangleGrid;
  private readonly hits: Intersection[] = [];
  private readonly found = new Int32Array(1);
  private readonly visible = (o: Object3D) => isVisibleDeep(o);

  constructor(solids: readonly Mesh[], moving: readonly Mesh[] = []) {
    this.colliders = [...moving];
    this.grid = new TriangleGrid(solids);
  }

  /** The first solid surface along a ray, or null within `far`. */
  cast(origin: Vector3, dir: Vector3, far: number, out: RayHit): RayHit | null {
    const g = this.grid;
    let best = g.cast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, far, this.visible, this.found);
    const tri = this.found[0] as number;
    let object: Object3D | null = best >= 0 ? g.ownerOf(tri) : null;
    let fromMesh: Intersection | null = null;
    if (this.colliders.length) {
      this.raycaster.set(origin, dir);
      this.raycaster.near = 0;
      this.raycaster.far = best >= 0 ? best : far;
      this.hits.length = 0;
      this.raycaster.intersectObjects(this.colliders, false, this.hits);
      for (const h of this.hits) {
        if (!isVisibleDeep(h.object)) continue;
        fromMesh = h;
        break;
      }
    }
    if (fromMesh) {
      best = fromMesh.distance;
      object = fromMesh.object;
      out.point.copy(fromMesh.point);
      if (fromMesh.face) out.normal.copy(fromMesh.face.normal).transformDirection(fromMesh.object.matrixWorld);
      else out.normal.copy(dir).negate();
    } else if (best >= 0) {
      out.point.copy(dir).multiplyScalar(best).add(origin);
      g.normal(tri, out.normal);
    } else {
      return null;
    }
    if (out.normal.dot(dir) > 0) out.normal.negate();
    out.distance = best;
    out.object = object;
    return out;
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

  /** Does a far light reach `from` (nothing in the way within `far` metres)? `toLight` points at it. */
  lightReaches(from: Vector3, toLight: Vector3, far = 80): boolean {
    return this.cast(from, toLight, far, this.scratch) === null;
  }

  dispose(): void {
    // The grid holds plain arrays; nothing on the GPU.
  }
}

function isVisibleDeep(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}
