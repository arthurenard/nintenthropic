/**
 * Culling the world's scattered instances (trees, rocks, tufts, flowers) for
 * each view.
 *
 * A scenery kind is one InstancedMesh holding every one of its instances on
 * the map, so three can only ask whether the whole lot is in view, and it
 * always is: a camera on a lap sees about a fifth of the trees and draws all
 * of them, four times over in split screen. Here the instances are grouped
 * into cells of about 48 m (each with a bounding sphere of its instances' own
 * spheres), and a view draws just the cells its frustum touches, packed
 * together at the start of that view's own instance buffer. Nothing moves:
 * every instance keeps its matrix and its colour, only the order they sit in
 * changes, and what a view leaves out is what its frustum would have clipped.
 *
 * Each view has a mesh of its own (the first is the world's, the others are
 * made when a second, third or fourth view first asks), so a buffer is
 * rewritten only when its view's cells change, not four times a frame.
 */
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Sphere, Vector3, type Frustum } from "three";

/** Metres on a side of a cell. */
export const CELL = 48;

interface Cell {
  /** Where its instances start in the sorted arrays, and how many. */
  first: number;
  count: number;
  sphere: Sphere;
}

const _m = new Matrix4();
const _c = new Vector3();

export class CulledInstances {
  /** One mesh per view that has asked: [0] is the mesh the world built. */
  private readonly meshes: InstancedMesh[];
  private readonly cells: Cell[] = [];
  private readonly matrices: Float32Array;
  private readonly colours: Float32Array | null;
  private readonly total: number;
  /** What each view's mesh holds now: a hash of the cells it was packed from, and how many instances. */
  private readonly held: ({ hash: number; count: number } | undefined)[] = [];
  /** The mesh is not at the origin: its cells' spheres are in the wrong frame, so it is left whole. */
  private whole = false;
  private checked = false;

  constructor(mesh: InstancedMesh) {
    this.meshes = [mesh];
    this.total = mesh.count;
    const geometry = mesh.geometry;
    geometry.computeBoundingSphere();
    const bounds = geometry.boundingSphere!;
    const source = mesh.instanceMatrix.array as Float32Array;
    const colourSource = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;

    // Each instance's own sphere: where its geometry's sphere lands under its matrix.
    const centres = new Float32Array(this.total * 3);
    const radii = new Float32Array(this.total);
    for (let i = 0; i < this.total; i++) {
      _m.fromArray(source, i * 16);
      _c.copy(bounds.center).applyMatrix4(_m);
      centres[i * 3] = _c.x;
      centres[i * 3 + 1] = _c.y;
      centres[i * 3 + 2] = _c.z;
      const e = _m.elements;
      const scale = Math.max(Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[4]!, e[5]!, e[6]!), Math.hypot(e[8]!, e[9]!, e[10]!));
      radii[i] = bounds.radius * scale;
    }

    // Grouped by cell (a stable sort by cell, so equal cells keep their order).
    const cellOf = (i: number) => Math.floor(centres[i * 3]! / CELL) * 65536 + Math.floor(centres[i * 3 + 2]! / CELL);
    const order = Array.from({ length: this.total }, (_, i) => i).sort((a, b) => cellOf(a) - cellOf(b) || a - b);
    this.matrices = new Float32Array(this.total * 16);
    this.colours = colourSource ? new Float32Array(this.total * 3) : null;
    order.forEach((from, to) => {
      this.matrices.set(source.subarray(from * 16, from * 16 + 16), to * 16);
      if (this.colours && colourSource) this.colours.set(colourSource.subarray(from * 3, from * 3 + 3), to * 3);
    });

    // A sphere round each run of instances: centred on the middle of their centres, reaching the farthest edge.
    let start = 0;
    while (start < this.total) {
      let end = start + 1;
      const key = cellOf(order[start]!);
      while (end < this.total && cellOf(order[end]!) === key) end++;
      const centre = new Vector3();
      for (let k = start; k < end; k++) centre.add(_c.set(centres[order[k]! * 3]!, centres[order[k]! * 3 + 1]!, centres[order[k]! * 3 + 2]!));
      centre.divideScalar(end - start);
      let radius = 0;
      for (let k = start; k < end; k++) {
        const o = order[k]!;
        radius = Math.max(radius, _c.set(centres[o * 3]!, centres[o * 3 + 1]!, centres[o * 3 + 2]!).distanceTo(centre) + radii[o]!);
      }
      this.cells.push({ first: start, count: end - start, sphere: new Sphere(centre, radius) });
      start = end;
    }

    // The world's own mesh keeps everything, in cell order, until a view asks.
    mesh.instanceMatrix.array.set(this.matrices);
    if (mesh.instanceColor && this.colours) mesh.instanceColor.array.set(this.colours);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
  }

  /** How many cells (for the tests). */
  get cellCount(): number {
    return this.cells.length;
  }

  /** The runs of one view's cells, as pairs of (first, count): kept, so a frame makes no array for each. */
  private readonly runs: number[] = [];

  /** The mesh a view draws (made when first asked for). */
  private meshFor(view: number): InstancedMesh {
    let mesh = this.meshes[view];
    if (mesh) return mesh;
    const first = this.meshes[0]!;
    mesh = new InstancedMesh(first.geometry, first.material, this.total);
    mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(this.total * 16), 16).setUsage(DynamicDrawUsage);
    if (this.colours) mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.total * 3), 3).setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = first.renderOrder;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.matrixAutoUpdate = first.matrixAutoUpdate;
    mesh.position.copy(first.position);
    mesh.quaternion.copy(first.quaternion);
    mesh.scale.copy(first.scale);
    mesh.updateMatrix();
    mesh.visible = false;
    first.parent?.add(mesh);
    // The renderer works the scene's matrices out once a frame, before this view's mesh exists: this one's is brought up now.
    mesh.updateWorldMatrix(true, false);
    this.meshes[view] = mesh;
    return mesh;
  }

  /** Draws only what `frustum` can see, from view `view`'s mesh; every other view's mesh is hidden meanwhile. Returns the instances drawn. */
  select(view: number, frustum: Frustum): number {
    if (!this.checked) {
      this.checked = true;
      const first = this.meshes[0]!;
      first.updateWorldMatrix(true, false);
      this.whole = !first.matrixWorld.equals(_m.identity());
    }
    if (this.whole) return this.total;
    const mesh = this.meshFor(view);
    // The cells in view, as runs of the sorted arrays (neighbouring cells join up).
    let hash = 0;
    let n = 0;
    const runs = this.runs;
    runs.length = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!;
      if (!frustum.intersectsSphere(cell.sphere)) continue;
      hash = (Math.imul(hash, 31) + i + 1) | 0;
      n += cell.count;
      const last = runs.length - 2;
      if (last >= 0 && runs[last]! + runs[last + 1]! === cell.first) runs[last + 1]! += cell.count;
      else runs.push(cell.first, cell.count);
    }
    for (let v = 0; v < this.meshes.length; v++) if (this.meshes[v]) this.meshes[v]!.visible = false;
    const held = this.held[view];
    if (!held || held.hash !== hash || held.count !== n) {
      const matrices = mesh.instanceMatrix.array;
      const colours = mesh.instanceColor ? mesh.instanceColor.array : null;
      let at = 0;
      for (let r = 0; r < runs.length; r += 2) {
        const from = runs[r]!;
        const count = runs[r + 1]!;
        matrices.set(this.matrices.subarray(from * 16, (from + count) * 16), at * 16);
        if (colours && this.colours) colours.set(this.colours.subarray(from * 3, (from + count) * 3), at * 3);
        at += count;
      }
      mesh.count = n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n * 16));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, Math.max(1, n * 3));
        mesh.instanceColor.needsUpdate = true;
      }
      this.held[view] = { hash, count: n };
    }
    mesh.visible = n > 0;
    return n;
  }

  /** Every instance in the world's own mesh again (the camera is not one of the views), the others hidden. */
  all(): void {
    const first = this.meshes[0]!;
    for (const mesh of this.meshes) if (mesh) mesh.visible = false;
    if (!this.whole && this.held[0]) {
      first.instanceMatrix.array.set(this.matrices);
      if (first.instanceColor && this.colours) first.instanceColor.array.set(this.colours);
      first.count = this.total;
      first.instanceMatrix.clearUpdateRanges();
      first.instanceMatrix.needsUpdate = true;
      if (first.instanceColor) {
        first.instanceColor.clearUpdateRanges();
        first.instanceColor.needsUpdate = true;
      }
      this.held[0] = undefined;
    }
    first.visible = true;
  }

  /** Lets the views' own meshes go (the world's mesh, and the geometry and material, are the world's to dispose). */
  dispose(): void {
    for (let v = 1; v < this.meshes.length; v++) {
      const mesh = this.meshes[v];
      if (!mesh) continue;
      mesh.dispose();
      mesh.removeFromParent();
    }
    this.meshes.length = 1;
  }
}
