/**
 * The valley's ground as a height grid, rasterised once from the terrain
 * mesh (whatever made it: the real valley.glb or the placeholder), for the
 * questions asked many times a frame - where a round meets the ground,
 * where a man's feet are, is the sun on him - and for the GPU's light map.
 *
 * Two grids: a fine one over the play area (where the targets are, and a
 * dust puff has to land on the right tuft), and a coarse one over the
 * whole terrain (the far slopes, the peaks, the mountains behind the ridge
 * that shade the valley at dawn). Bilinear between samples.
 */
import { Box3, type BufferAttribute, type Mesh, Vector3 } from "three";

export class Grid {
  readonly heights: Float32Array;
  readonly nx: number;
  readonly nz: number;

  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly cell: number,
    nx: number,
    nz: number,
  ) {
    this.nx = nx;
    this.nz = nz;
    this.heights = new Float32Array(nx * nz).fill(Number.NEGATIVE_INFINITY);
  }

  get x1(): number {
    return this.x0 + (this.nx - 1) * this.cell;
  }

  get z1(): number {
    return this.z0 + (this.nz - 1) * this.cell;
  }

  contains(x: number, z: number): boolean {
    return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1;
  }

  /** Bilinear height, or −∞ where nothing was rasterised. */
  sample(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    const i = Math.min(this.nx - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(this.nz - 2, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const h = this.heights;
    const a = h[j * this.nx + i]!;
    const b = h[j * this.nx + i + 1]!;
    const c = h[(j + 1) * this.nx + i]!;
    const d = h[(j + 1) * this.nx + i + 1]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Fill in the height of every sample point under triangle (a, b, c), keeping the highest. */
  raster(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const minZ = Math.min(az, bz, cz);
    const maxZ = Math.max(az, bz, cz);
    const i0 = Math.max(0, Math.ceil((minX - this.x0) / this.cell - 1e-6));
    const i1 = Math.min(this.nx - 1, Math.floor((maxX - this.x0) / this.cell + 1e-6));
    const j0 = Math.max(0, Math.ceil((minZ - this.z0) / this.cell - 1e-6));
    const j1 = Math.min(this.nz - 1, Math.floor((maxZ - this.z0) / this.cell + 1e-6));
    if (i1 < i0 || j1 < j0) return;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) return;
    const inv = 1 / det;
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + j * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * this.cell;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) * inv;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) * inv;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-5 || l2 < -1e-5 || l3 < -1e-5) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        const k = j * this.nx + i;
        if (y > (this.heights[k] as number)) this.heights[k] = y;
      }
    }
  }

  /** Fill any sample the mesh left uncovered from its neighbours (edges, holes). */
  fillGaps(): void {
    const h = this.heights;
    let lowest = Number.POSITIVE_INFINITY;
    for (const v of h) if (Number.isFinite(v) && v < lowest) lowest = v;
    if (!Number.isFinite(lowest)) lowest = 0;
    for (let pass = 0; pass < 4; pass++) {
      let left = 0;
      for (let j = 0; j < this.nz; j++) {
        for (let i = 0; i < this.nx; i++) {
          const k = j * this.nx + i;
          if (Number.isFinite(h[k]!)) continue;
          let sum = 0;
          let n = 0;
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
            const v = h[jj * this.nx + ii]!;
            if (Number.isFinite(v)) {
              sum += v;
              n++;
            }
          }
          if (n) h[k] = sum / n;
          else left++;
        }
      }
      if (!left) break;
    }
    for (let k = 0; k < h.length; k++) if (!Number.isFinite(h[k]!)) h[k] = lowest;
  }
}

const TMP = new Vector3();

export class Heightfield {
  constructor(
    /** Fine samples over the play area. */
    readonly fine: Grid,
    /** Coarse samples over the whole terrain. */
    readonly coarse: Grid,
  ) {}

  /**
   * The grids for a terrain mesh: `fineBox` (x0, z0, x1, z1) is where the
   * fine grid goes (clipped to the mesh), at `fineCell` metres.
   */
  static fromMesh(mesh: Mesh, fineBox: readonly [number, number, number, number], fineCell = 2, coarseCell = 12): Heightfield {
    mesh.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mesh);
    const fx0 = Math.max(box.min.x, fineBox[0]);
    const fz0 = Math.max(box.min.z, fineBox[1]);
    const fx1 = Math.min(box.max.x, fineBox[2]);
    const fz1 = Math.min(box.max.z, fineBox[3]);
    const fine = new Grid(fx0, fz0, fineCell, Math.max(2, Math.floor((fx1 - fx0) / fineCell) + 1), Math.max(2, Math.floor((fz1 - fz0) / fineCell) + 1));
    const coarse = new Grid(box.min.x, box.min.z, coarseCell, Math.max(2, Math.floor((box.max.x - box.min.x) / coarseCell) + 1), Math.max(2, Math.floor((box.max.z - box.min.z) / coarseCell) + 1));
    const g = mesh.geometry;
    const pos = g.getAttribute("position") as BufferAttribute;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      TMP.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world[i * 3] = TMP.x;
      world[i * 3 + 1] = TMP.y;
      world[i * 3 + 2] = TMP.z;
    }
    const index = g.index;
    const tris = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = index ? index.getX(t * 3) : t * 3;
      const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const args = [world[a * 3]!, world[a * 3 + 1]!, world[a * 3 + 2]!, world[b * 3]!, world[b * 3 + 1]!, world[b * 3 + 2]!, world[c * 3]!, world[c * 3 + 1]!, world[c * 3 + 2]!] as const;
      coarse.raster(...args);
      fine.raster(...args);
    }
    fine.fillGaps();
    coarse.fillGaps();
    return new Heightfield(fine, coarse);
  }

  /** The ground's height at (x, z). */
  height(x: number, z: number): number {
    if (this.fine.contains(x, z)) return this.fine.sample(x, z);
    return this.coarse.sample(x, z);
  }

  /** The ground's normal at (x, z), into `out`. */
  normal(x: number, z: number, out: Vector3): Vector3 {
    const e = this.fine.contains(x, z) ? this.fine.cell : this.coarse.cell;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  /**
   * Where the straight segment a→b first goes below the ground, as a
   * fraction of its length, or −1. Stepped at `step` metres and refined by
   * bisection to a few centimetres.
   */
  segmentHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, step = 1.5): number {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 1e-6) return -1;
    const n = Math.max(1, Math.ceil(len / step));
    let prevT = 0;
    let prevAbove = ay - this.height(ax, az);
    if (prevAbove < 0) return 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      const above = y - this.height(x, z);
      if (above < 0) {
        // Bisect between the last point above and this one.
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const mx = ax + (bx - ax) * mid;
          const my = ay + (by - ay) * mid;
          const mz = az + (bz - az) * mid;
          if (my - this.height(mx, mz) < 0) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prevT = t;
      prevAbove = above;
    }
    void prevAbove;
    return -1;
  }

  /**
   * The highest the ground rises, seen from (x, y, z), looking toward
   * (dx, dz) (a unit horizontal direction): the angle in radians above
   * level. The sun is on a point when it stands higher than this.
   */
  horizon(x: number, y: number, z: number, dx: number, dz: number, far = 4000): number {
    let best = -Math.PI / 2;
    let d = 4;
    while (d < far) {
      const h = this.height(x + dx * d, z + dz * d);
      const a = Math.atan2(h - y, d);
      if (a > best) best = a;
      d *= 1.09;
      d += 2;
    }
    return best;
  }
}
