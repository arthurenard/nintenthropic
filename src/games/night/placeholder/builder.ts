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
  type Texture,
} from "three";
import { nameNode } from "../../../engine/world/names";
import type { Surface } from "../world/road";

/** An axis-aligned box that casts a baked shadow. */
export interface Occluder {
  min: Vector3;
  max: Vector3;
}

/** A light the bake adds: a point with a colour × power, falling off with the square of distance. */
export interface BakePoint {
  pos: Vector3;
  color: Color;
  power: number;
  /** Only this far. */
  reach: number;
  /** Throws shadows from the occluders (the streetlight does; a candle need not). */
  shadows: boolean;
}

export interface NightLight {
  /** Direction moonlight travels. */
  moon: Vector3;
  moonColor: Color;
  /** The sky's light from above, and what little comes back up off the ground. */
  sky: Color;
  bounce: Color;
  street: BakePoint;
  points: BakePoint[];
}

interface Batch {
  key: string;
  pivot: [number, number, number];
  surface: Surface;
  detail: Texture | null;
  glow: number;
  noCollide: boolean;
  positions: number[];
  normals: number[];
  uvs: number[];
  lit: number[];
  albedo: number[];
  street: number[];
}

export interface PartOptions {
  surface?: Surface;
  /** A greyscale detail texture over the baked colour (planks, asphalt). */
  detail?: Texture | null;
  /** Metres per texture repeat. */
  uvScale?: number;
  rotY?: number;
  rotation?: Euler;
  /** Cast a baked shadow. */
  occlude?: boolean;
  /** Glows by itself (neon, lamps, candle-lit windows): its own light, times this. */
  emit?: Color;
  /** Multiply the sky and moon on it (under the canopy, inside a room). */
  shade?: number;
  /** Bullets pass through (thin rails, wires). */
  noCollide?: boolean;
  /** Its own mesh, apart from the batches (a secret the game moves or lights): parts with one name make one mesh. */
  name?: string;
  /** Where that mesh's origin is (a pivot the game turns it about); the world origin if unset. */
  pivot?: [number, number, number];
}

const v = new Vector3();
const n = new Vector3();
const tmpC = new Color();
const nm = new Matrix3();

/**
 * Collects the placeholder road's static geometry into a few merged
 * meshes, baking the night's light into each vertex as it goes - a poor
 * man's Cycles bake, to the same contract as the real road.glb: the lit
 * colour (moon, sky, the steady practical lights, no fog) as vertex
 * colours, and beside it each vertex's own colour (`albedo`) and the
 * streetlight's share of its light (`street`), so the game's flashlight
 * and the lamp's flicker work on it exactly as on the real bake.
 */
export class NightBuilder {
  readonly root = new Group();
  readonly occluders: Occluder[] = [];
  private readonly batches = new Map<string, Batch>();
  private readonly named = new Map<string, Batch>();

  constructor(readonly light: NightLight) {
    nameNode(this.root, "road");
  }

  /** The night's light on a surface with normal `nrm` at `pos`: into `lit`; returns the streetlight's irradiance there. */
  bake(albedo: Color, nrm: Vector3, pos: Vector3, lit: Color, o: PartOptions): number {
    const L = this.light;
    const shade = o.shade ?? 1;
    const toMoon = v.copy(L.moon).negate();
    let moon = Math.max(0, nrm.dot(toMoon)) * shade;
    if (moon > 0 && this.shadowed(pos, toMoon, 200)) moon *= 0.08;
    const hemi = 0.5 + 0.5 * nrm.y;
    // Ambient occlusion where things meet the ground.
    const ao = 0.62 + 0.38 * Math.min(1, Math.max(0, pos.y / 1.2));
    lit.setRGB(
      L.moonColor.r * moon + (L.sky.r * hemi + L.bounce.r * (1 - hemi)) * ao * shade,
      L.moonColor.g * moon + (L.sky.g * hemi + L.bounce.g * (1 - hemi)) * ao * shade,
      L.moonColor.b * moon + (L.sky.b * hemi + L.bounce.b * (1 - hemi)) * ao * shade,
    );
    for (const p of L.points) {
      const e = this.pointLight(p, pos, nrm);
      lit.r += p.color.r * e;
      lit.g += p.color.g * e;
      lit.b += p.color.b * e;
    }
    const street = this.pointLight(L.street, pos, nrm);
    lit.r += L.street.color.r * street;
    lit.g += L.street.color.g * street;
    lit.b += L.street.color.b * street;
    lit.multiply(albedo);
    if (o.emit) lit.add(o.emit);
    return street;
  }

  private pointLight(p: BakePoint, pos: Vector3, nrm: Vector3): number {
    const d = v.copy(p.pos).sub(pos);
    const dist = d.length();
    if (dist > p.reach) return 0;
    d.divideScalar(Math.max(dist, 1e-4));
    const ndl = Math.max(0, nrm.dot(d));
    if (ndl <= 0) return 0;
    if (p.shadows && this.shadowed(pos, d, dist - 0.3)) return 0;
    const fade = 1 - Math.pow(dist / p.reach, 4);
    return (p.power * ndl * fade * fade) / Math.max(1, dist * dist);
  }

  private batch(o: PartOptions): Batch {
    const surface = o.surface ?? "wood";
    const named = o.name !== undefined;
    const key = named ? (o.name as string) : `${surface}|${o.detail?.uuid ?? "-"}|${o.noCollide ? "nc" : "c"}`;
    const map = named ? this.named : this.batches;
    let b = map.get(key);
    if (!b) {
      b = { key, pivot: o.pivot ?? [0, 0, 0], surface, detail: o.detail ?? null, glow: 1, noCollide: o.noCollide ?? false, positions: [], normals: [], uvs: [], lit: [], albedo: [], street: [] };
      map.set(key, b);
    }
    return b;
  }

  /** Append a geometry transformed by `matrix`, with world-space planar UVs and the bake. */
  add(geometry: BufferGeometry, matrix: Matrix4, albedo: Color, o: PartOptions = {}): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const target = this.batch(o);
    nm.getNormalMatrix(matrix);
    const scale = o.uvScale ?? 2;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const px = v.x;
      const py = v.y;
      const pz = v.z;
      target.positions.push(px, py, pz);
      target.normals.push(n.x, n.y, n.z);
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      if (ay >= ax && ay >= az) target.uvs.push(px / scale, pz / scale);
      else if (ax >= az) target.uvs.push(pz / scale, py / scale);
      else target.uvs.push(px / scale, py / scale);
      const at = new Vector3(px, py, pz);
      const street = this.bake(albedo, n, at, tmpC, o);
      target.lit.push(tmpC.r, tmpC.g, tmpC.b);
      target.albedo.push(albedo.r, albedo.g, albedo.b);
      target.street.push(street);
    }
    if (g !== geometry) g.dispose();
  }

  box(center: [number, number, number], size: [number, number, number], albedo: Color, o: PartOptions = {}): void {
    const geo = new BoxGeometry(size[0], size[1], size[2]);
    this.add(geo, compose(center, o), albedo, o);
    geo.dispose();
    if (o.occlude) {
      const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
      this.occluders.push({ min: new Vector3(center[0] - hx, center[1] - hy, center[2] - hz), max: new Vector3(center[0] + hx, center[1] + hy, center[2] + hz) });
    }
  }

  cylinder(center: [number, number, number], radius: number, height: number, albedo: Color, o: PartOptions & { radiusTop?: number; segments?: number } = {}): void {
    const geo = new CylinderGeometry(o.radiusTop ?? radius, radius, height, o.segments ?? 12, 1);
    this.add(geo, compose(center, o), albedo, o);
    geo.dispose();
    if (o.occlude) this.occluders.push({ min: new Vector3(center[0] - radius, center[1] - height / 2, center[2] - radius), max: new Vector3(center[0] + radius, center[1] + height / 2, center[2] + radius) });
  }

  /** A flat patch of ground, subdivided every `cell` metres so the bake's pools of light hold their shape. */
  ground(x0: number, x1: number, z0: number, z1: number, y: number, cell: number, albedo: (x: number, z: number) => Color, o: PartOptions = {}): void {
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
    const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    const pos: number[] = [];
    const cols: Color[] = [];
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const ax = x0 + ((x1 - x0) * i) / nx;
        const bx = x0 + ((x1 - x0) * (i + 1)) / nx;
        const az = z0 + ((z1 - z0) * k) / nz;
        const bz = z0 + ((z1 - z0) * (k + 1)) / nz;
        // Two triangles facing up (counter-clockwise seen from above).
        for (const [px, pz] of [
          [ax, az],
          [ax, bz],
          [bx, bz],
          [ax, az],
          [bx, bz],
          [bx, az],
        ] as const) {
          pos.push(px, y, pz);
          cols.push(albedo(px, pz));
        }
      }
    }
    const b = this.batch({ surface: "dirt", ...o });
    const scale = o.uvScale ?? 2;
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < pos.length; i += 3) {
      const at = new Vector3(pos[i] as number, pos[i + 1] as number, pos[i + 2] as number);
      const alb = cols[i / 3] as Color;
      b.positions.push(at.x, at.y, at.z);
      b.normals.push(0, 1, 0);
      b.uvs.push(at.x / scale, at.z / scale);
      const street = this.bake(alb, up, at, tmpC, o);
      b.lit.push(tmpC.r, tmpC.g, tmpC.b);
      b.albedo.push(alb.r, alb.g, alb.b);
      b.street.push(street);
    }
  }

  /** Is `p` in the shadow of an occluder, looking along `dir` for up to `far` metres? */
  shadowed(p: Vector3, dir: Vector3, far: number): boolean {
    for (const o of this.occluders) {
      let tmin = 0.05;
      let tmax = far;
      let hit = true;
      for (const axis of ["x", "y", "z"] as const) {
        const d = dir[axis];
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

  /** A named node for the contract (`lane.road.1`, `calib.3`...), with extras. */
  node(name: string, position: [number, number, number], extras: Record<string, unknown> = {}, parent?: Object3D): Object3D {
    const o = nameNode(new Object3D(), name);
    o.position.set(...position);
    Object.assign(o.userData, extras);
    (parent ?? this.root).add(o);
    return o;
  }

  private meshOf(b: Batch, name: string): Mesh {
    const g = new BufferGeometry();
    const [px, py, pz] = b.pivot;
    const positions = new Float32Array(b.positions);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] as number) - px;
      positions[i + 1] = (positions[i + 1] as number) - py;
      positions[i + 2] = (positions[i + 2] as number) - pz;
    }
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(b.normals), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(b.uvs), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(b.lit), 3));
    g.setAttribute("albedo", new BufferAttribute(new Float32Array(b.albedo), 3));
    g.setAttribute("street", new BufferAttribute(new Float32Array(b.street), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    // An unlit material, as a glTF bake arrives; the game swaps in its own
    // night material, reading the bake from the vertex attributes.
    const mat = new MeshBasicMaterial({ map: b.detail, vertexColors: true, name: `placeholder.${b.surface}` });
    mat.userData["bake"] = "vertex";
    const mesh = nameNode(new Mesh(g, mat), name);
    mesh.position.set(px, py, pz);
    mesh.userData["surface"] = b.surface;
    if (b.noCollide) mesh.userData["noCollide"] = true;
    return mesh;
  }

  /**
   * Turn the batches into meshes under the root, one per surface and detail
   * texture; the named parts come back by name, each with its origin at its
   * pivot, for the caller to hang where the contract wants them.
   */
  finish(): Map<string, Mesh> {
    let i = 0;
    for (const b of this.batches.values()) {
      const mesh = this.meshOf(b, `static.${i++}.${b.surface}`);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
    }
    this.batches.clear();
    const named = new Map<string, Mesh>();
    for (const b of this.named.values()) named.set(b.key, this.meshOf(b, b.key));
    this.named.clear();
    return named;
  }
}

function compose(center: [number, number, number], o: PartOptions): Matrix4 {
  const q = new Quaternion();
  if (o.rotation) q.setFromEuler(o.rotation);
  else if (o.rotY) q.setFromAxisAngle(new Vector3(0, 1, 0), o.rotY);
  return new Matrix4().compose(new Vector3(...center), q, new Vector3(1, 1, 1));
}

export const col = (hex: string) => new Color(hex);
