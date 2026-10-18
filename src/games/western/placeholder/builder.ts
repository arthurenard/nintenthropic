import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from "three";
import type { Surface } from "../world/town";
import { nameNode } from "../../../engine/world/names";

/** An axis-aligned box that casts a baked shadow on the ground. */
export interface Occluder {
  min: Vector3;
  max: Vector3;
}

export interface BakeLight {
  /** Direction sunlight travels. */
  sun: Vector3;
  sunColor: Color;
  sky: Color;
  bounce: Color;
}

interface Batch {
  chunk: string;
  material: Material;
  surface: Surface;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
}

export interface PartOptions {
  surface?: Surface;
  /** Metres per texture repeat. */
  uvScale?: number;
  /** Multiply the baked direct light (porch shadows, interiors). */
  sunShade?: number;
  /** Multiply the whole baked result. */
  dim?: number;
  /** Rotate about Y, radians. */
  rotY?: number;
  rotation?: Euler;
  /** Cast a baked shadow on the ground. */
  occlude?: boolean;
}

const v = new Vector3();
const n = new Vector3();
const c = new Color();
const nm = new Matrix3();

/**
 * Collects the placeholder town's static geometry into a few merged meshes,
 * baking light into vertex colours as it goes — a poor man's Cycles bake, so
 * the placeholder is unlit exactly like the real town.glb.
 */
export class TownBuilder {
  readonly root = new Group();
  readonly occluders: Occluder[] = [];
  /** Chunks bullets pass through (railings: thin balusters should not stop a shot). */
  readonly noCollide = new Set<string>();
  private readonly batches = new Map<string, Batch>();

  constructor(readonly light: BakeLight) {
    nameNode(this.root, "town");
  }

  /** Light for a surface with normal `nrm` at `pos`, into `out` (linear). */
  bake(albedo: Color, nrm: Vector3, pos: Vector3, out: Color, sunShade = 1, dim = 1): Color {
    const L = this.light.sun;
    const direct = Math.max(0, -(nrm.x * L.x + nrm.y * L.y + nrm.z * L.z)) * sunShade;
    const hemi = 0.5 + 0.5 * nrm.y;
    // Ambient occlusion where walls meet the ground.
    const ao = 0.72 + 0.28 * Math.min(1, Math.max(0, pos.y / 1.4));
    out.setRGB(
      albedo.r * (this.light.sunColor.r * direct + (this.light.sky.r * hemi + this.light.bounce.r * (1 - hemi)) * ao),
      albedo.g * (this.light.sunColor.g * direct + (this.light.sky.g * hemi + this.light.bounce.g * (1 - hemi)) * ao),
      albedo.b * (this.light.sunColor.b * direct + (this.light.sky.b * hemi + this.light.bounce.b * (1 - hemi)) * ao),
    );
    out.multiplyScalar(dim);
    return out;
  }

  private batch(chunk: string, material: Material, surface: Surface): Batch {
    const key = `${chunk}|${material.uuid}|${surface}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { chunk, material, surface, positions: [], normals: [], uvs: [], colors: [] };
      this.batches.set(key, b);
    }
    return b;
  }

  /**
   * Append a (non-indexed-able) geometry transformed by `matrix`, with world-
   * space planar UVs and baked colours.
   */
  add(chunk: string, material: Material, geometry: BufferGeometry, matrix: Matrix4, albedo: Color, o: PartOptions = {}): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const b = this.batch(chunk, material, o.surface ?? "wood");
    nm.getNormalMatrix(matrix);
    const scale = o.uvScale ?? 2;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      b.positions.push(v.x, v.y, v.z);
      b.normals.push(n.x, n.y, n.z);
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      if (ay >= ax && ay >= az) b.uvs.push(v.x / scale, v.z / scale);
      else if (ax >= az) b.uvs.push(v.z / scale, v.y / scale);
      else b.uvs.push(v.x / scale, v.y / scale);
      this.bake(albedo, n, v, c, o.sunShade ?? 1, o.dim ?? 1);
      b.colors.push(c.r, c.g, c.b);
    }
    if (g !== geometry) g.dispose();
  }

  box(
    chunk: string,
    material: Material,
    center: [number, number, number],
    size: [number, number, number],
    albedo: Color,
    o: PartOptions = {},
  ): void {
    const geo = new BoxGeometry(size[0], size[1], size[2]);
    const m = new Matrix4();
    const q = new Quaternion();
    if (o.rotation) q.setFromEuler(o.rotation);
    else if (o.rotY) q.setFromAxisAngle(new Vector3(0, 1, 0), o.rotY);
    m.compose(new Vector3(...center), q, new Vector3(1, 1, 1));
    this.add(chunk, material, geo, m, albedo, o);
    geo.dispose();
    if (o.occlude) {
      const hx = size[0] / 2;
      const hy = size[1] / 2;
      const hz = size[2] / 2;
      this.occluders.push({
        min: new Vector3(center[0] - hx, center[1] - hy, center[2] - hz),
        max: new Vector3(center[0] + hx, center[1] + hy, center[2] + hz),
      });
    }
  }

  cylinder(
    chunk: string,
    material: Material,
    center: [number, number, number],
    radius: number,
    height: number,
    albedo: Color,
    o: PartOptions & { radiusTop?: number; segments?: number } = {},
  ): void {
    const geo = new CylinderGeometry(o.radiusTop ?? radius, radius, height, o.segments ?? 12, 1);
    const m = new Matrix4();
    const q = new Quaternion();
    if (o.rotation) q.setFromEuler(o.rotation);
    m.compose(new Vector3(...center), q, new Vector3(1, 1, 1));
    this.add(chunk, material, geo, m, albedo, o);
    geo.dispose();
    if (o.occlude) {
      this.occluders.push({
        min: new Vector3(center[0] - radius, center[1] - height / 2, center[2] - radius),
        max: new Vector3(center[0] + radius, center[1] + height / 2, center[2] + radius),
      });
    }
  }

  /** Is the point in the shadow of any occluder, looking toward the sun along `toSun`? */
  shadowed(p: Vector3, toSun: Vector3): boolean {
    for (const o of this.occluders) {
      let tmin = 1e-3;
      let tmax = 1e9;
      let hit = true;
      for (const axis of ["x", "y", "z"] as const) {
        const d = toSun[axis];
        const lo = o.min[axis];
        const hi = o.max[axis];
        if (Math.abs(d) < 1e-9) {
          if (p[axis] < lo || p[axis] > hi) {
            hit = false;
            break;
          }
          continue;
        }
        let t1 = (lo - p[axis]) / d;
        let t2 = (hi - p[axis]) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  /** A named node for the contract (`cover.x`, `calib.3`, `path.chicken.1`...), with extras. */
  node(name: string, position: [number, number, number], extras: Record<string, unknown> = {}, parent?: Object3D): Object3D {
    const o = nameNode(new Object3D(), name);
    o.position.set(...position);
    Object.assign(o.userData, extras);
    (parent ?? this.root).add(o);
    return o;
  }

  /** Turn the batches into meshes, one per chunk × material × surface. */
  finish(): void {
    let i = 0;
    for (const b of this.batches.values()) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(b.positions), 3));
      g.setAttribute("normal", new BufferAttribute(new Float32Array(b.normals), 3));
      g.setAttribute("uv", new BufferAttribute(new Float32Array(b.uvs), 2));
      g.setAttribute("color", new BufferAttribute(new Float32Array(b.colors), 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = nameNode(new Mesh(g, b.material), `static.${i++}.${b.surface}`);
      mesh.userData["surface"] = b.surface;
      if (this.noCollide.has(b.chunk)) mesh.userData["noCollide"] = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
    }
    this.batches.clear();
  }
}

/** An unlit material, as GLTFLoader makes for KHR_materials_unlit, with a detail map over vertex colours. */
export function unlit(map: import("three").Texture | null, name: string, extra: Partial<MeshBasicMaterial> = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map, vertexColors: true, name });
  Object.assign(m, extra);
  return m;
}
