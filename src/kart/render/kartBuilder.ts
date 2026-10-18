/**
 * Smooth, rounded geometry assembled in code for the karts, the drivers and
 * the things they carry: many small shapes (a rounded box, an ellipsoid, a
 * tapered tube, a lathed wheel) welded into one indexed BufferGeometry with
 * smooth normals, vertex colours and a per-vertex surface (kartMaterial.ts).
 *
 * It offers the same calls as world/builder's low-poly `MeshBuilder` (`add`
 * with a unit shape, a matrix and a paint, `box`, `rod`, `blob`), so a recipe
 * reads the same with either; here every shape comes out smooth and round.
 *
 * `withDetail` sets how finely round things are cut while a model is built:
 * 1 for the kart you look at, less for the far version.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, LatheGeometry, Matrix3, Matrix4, SphereGeometry, TorusGeometry, Vector2, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mixRgb, rgb, scaleRgb, xf, type Paint, type Rgb, type V3 } from "./world/builder";
import { SURF, type Surf } from "./kartMaterial";

export { mixRgb, rgb, scaleRgb, xf };
export type { Paint, Rgb, V3 };

/** A unit shape: indexed positions and smooth normals, and its height range for colour ramps. */
export interface Shape {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly index: Uint16Array | Uint32Array;
  readonly minY: number;
  readonly maxY: number;
}

let detailScale = 1;

/** Cuts round shapes this much finer (>1) or coarser (<1) while `fn` runs. */
export function withDetail<T>(scale: number, fn: () => T): T {
  const before = detailScale;
  detailScale = scale;
  try {
    return fn();
  } finally {
    detailScale = before;
  }
}

const cache = new Map<string, Shape>();

function shapeOf(geometry: BufferGeometry): Shape {
  const position = new Float32Array(geometry.getAttribute("position").array);
  const normal = new Float32Array(geometry.getAttribute("normal").array);
  const count = position.length / 3;
  const src = geometry.index ? geometry.index.array : Array.from({ length: count }, (_, i) => i);
  const index = count > 65535 ? new Uint32Array(src) : new Uint16Array(src);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < position.length; i += 3) {
    minY = Math.min(minY, position[i]!);
    maxY = Math.max(maxY, position[i]!);
  }
  geometry.dispose();
  return { position, normal, index, minY, maxY };
}

function cached(key: string, make: () => BufferGeometry): Shape {
  const full = `${key}@${detailScale}`;
  let s = cache.get(full);
  if (!s) {
    s = shapeOf(make());
    cache.set(full, s);
  }
  return s;
}

/** A shape of one's own (a dome, a pod), cached under `key` at the current detail. */
export function customShape(key: string, make: () => BufferGeometry): Shape {
  return cached(key, make);
}

const seg = (n: number, min = 6): number => Math.max(min, Math.round(n * detailScale));

/** Unit shapes, centred on the origin: a rounded 1 m cube, radius-1 height-1 cylinders and cones, a radius-1 ball. */
export const shapes = {
  box: () => cached("box", () => (detailScale < 0.7 ? new BoxGeometry(1, 1, 1) : new RoundedBoxGeometry(1, 1, 1, 1, 0.2))),
  /** A plain unit cube with hard edges and flat faces: tread blocks, grilles, things too small to need a bevel. */
  block: () => cached("block", () => new BoxGeometry(1, 1, 1)),
  /** Height 1 (y -0.5..0.5), radius 1. */
  cylinder: (segments = 8) => cached(`cyl${segments}`, () => new CylinderGeometry(1, 1, 1, seg(Math.max(segments * 1.5, 12), 7), 1)),
  frustum: (top: number, segments = 8) => cached(`fr${top}_${segments}`, () => new CylinderGeometry(top, 1, 1, seg(Math.max(segments * 1.5, 12), 7), 1)),
  cone: (segments = 8) => cached(`cone${segments}`, () => new CylinderGeometry(0, 1, 1, seg(Math.max(segments * 1.5, 12), 7), 1)),
  /** Radius 1: detail 0 is a coarse ball, 2 a fine one. */
  ball: (detail = 0) => {
    const [w, h] = detail <= 0 ? [9, 6] : detail === 1 ? [13, 9] : [20, 14];
    return cached(`ball${detail}`, () => new SphereGeometry(1, seg(w, 6), seg(h, 4)));
  },
};

const _m3 = new Matrix3();
const _p = new Vector3();
const _n = new Vector3();

/** Smooth geometry under construction. */
export class MeshBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly surfs: number[] = [];
  readonly index: number[] = [];
  /** The surface the next shapes are made of. */
  surf: Surf = SURF.fur;

  /** Runs `fn` with another surface. */
  as<T>(surf: Surf, fn: () => T): T {
    const before = this.surf;
    this.surf = surf;
    try {
      return fn();
    } finally {
      this.surf = before;
    }
  }

  /** Adds a raw geometry (positions, normals, indices) under a matrix, in one colour or a ramp along local y. */
  addArrays(position: ArrayLike<number>, normal: ArrayLike<number>, index: ArrayLike<number>, matrix: Matrix4, paint: Paint, minY: number, maxY: number): void {
    const base = this.position.length / 3;
    _m3.getNormalMatrix(matrix);
    const range = maxY - minY || 1;
    const ramp = "bottom" in paint;
    const bottom = "bottom" in paint ? paint.bottom : paint;
    const top = "top" in paint ? paint.top : paint;
    const s = this.surf;
    for (let i = 0; i < position.length; i += 3) {
      const y = position[i + 1]!;
      _p.set(position[i]!, y, position[i + 2]!).applyMatrix4(matrix);
      _n.set(normal[i]!, normal[i + 1]!, normal[i + 2]!).applyMatrix3(_m3).normalize();
      this.position.push(_p.x, _p.y, _p.z);
      this.normal.push(_n.x, _n.y, _n.z);
      if (ramp) {
        const t = (y - minY) / range;
        this.color.push(bottom[0] + (top[0] - bottom[0]) * t, bottom[1] + (top[1] - bottom[1]) * t, bottom[2] + (top[2] - bottom[2]) * t);
      } else {
        this.color.push(bottom[0], bottom[1], bottom[2]);
      }
      this.surfs.push(s[0], s[1], s[2], s[3]);
    }
    for (let i = 0; i < index.length; i++) this.index.push(index[i]! + base);
  }

  /** Adds a unit shape under a transform and a paint. */
  add(shape: Shape, matrix: Matrix4, paint: Paint): void {
    this.addArrays(shape.position, shape.normal, shape.index, matrix, paint, shape.minY, shape.maxY);
  }

  /** Adds any three.js geometry (indexed, with normals) under a matrix. */
  geometry(g: BufferGeometry, matrix: Matrix4, paint: Paint): void {
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const index = g.index ? g.index.array : Array.from({ length: g.getAttribute("position").count }, (_, i) => i);
    this.addArrays(g.getAttribute("position").array, g.getAttribute("normal").array, index, matrix, paint, box.min.y, box.max.y);
  }

  /** A rounded box: centre, size, yaw, pitch, roll. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, paint: Paint, yaw = 0, pitch = 0, roll = 0): void {
    this.add(shapes.box(), xf(cx, cy, cz, sx, sy, sz, yaw, pitch, roll), paint);
  }

  /** A rounded box whose corners are cut `radius` metres deep: for plates and pods where a unit cube's corners would be too soft or too sharp. */
  slab(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, radius: number, paint: Paint, yaw = 0, pitch = 0, roll = 0): void {
    const key = `slab${Math.round(radius * 1000)}_${Math.round(sx * 100)}_${Math.round(sy * 100)}_${Math.round(sz * 100)}`;
    const small = Math.min(sx, sy, sz);
    const shape = cached(key, () => (detailScale < 0.7 || small < 0.045 ? new BoxGeometry(sx, sy, sz) : new RoundedBoxGeometry(sx, sy, sz, small > 0.12 ? 2 : 1, Math.min(radius, small / 2 - 0.001))));
    this.add(shape, xf(cx, cy, cz, 1, 1, 1, yaw, pitch, roll), paint);
  }

  /** A round rod from point `a` to point `c`. */
  rod(a: V3, c: V3, thickness: number, paint: Paint): void {
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const dz = c[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    const horiz = Math.hypot(dx, dz);
    // A unit cylinder runs along y; turn it onto the segment.
    this.add(shapes.cylinder(10), xf((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, thickness / 2, len, thickness / 2, Math.atan2(dx, dz), Math.atan2(horiz, dy), 0), paint);
  }

  /** A vertical cylinder standing on `y` (its base), radius r, height h. */
  post(cx: number, y: number, cz: number, r: number, h: number, paint: Paint, segments = 8, topRadius = 1): void {
    const shape = topRadius === 1 ? shapes.cylinder(segments) : shapes.frustum(topRadius, segments);
    this.add(shape, xf(cx, y + h / 2, cz, r, h, r), paint);
  }

  /** A cone standing on `y`, base radius r, height h. */
  spire(cx: number, y: number, cz: number, r: number, h: number, paint: Paint, segments = 8): void {
    this.add(shapes.cone(segments), xf(cx, y + h / 2, cz, r, h, r), paint);
  }

  /** An ellipsoid, radii (rx, ry, rz). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, paint: Paint, detail = 1, yaw = 0): void {
    this.add(shapes.ball(detail), xf(cx, cy, cz, rx, ry, rz, yaw), paint);
  }

  /** A lathed solid of revolution about the y axis through `profile` (radius, height) pairs, under a matrix. */
  lathe(profile: readonly (readonly [number, number])[], matrix: Matrix4, paint: Paint, segments = 32): void {
    const g = new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r, y)),
      seg(segments, 10),
    );
    this.geometry(g, matrix, paint);
    g.dispose();
  }

  /** A torus about the y axis (ring radius `radius`, tube radius `tube`). */
  torus(radius: number, tube: number, matrix: Matrix4, paint: Paint, radial = 16, tubular = 8): void {
    const g = new TorusGeometry(radius, tube, seg(tubular, 5), seg(radial, 10));
    g.rotateX(Math.PI / 2);
    this.geometry(g, matrix, paint);
    g.dispose();
  }

  /** Everything added so far as a BufferGeometry (smooth, vertex coloured, with its surface attribute), bounds computed. */
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.position, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.normal, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.color, 3));
    g.setAttribute("aSurf", new Float32BufferAttribute(this.surfs, 4));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Merges geometries made by `MeshBuilder.build`, each moved by a matrix (the far kart is its parts frozen in the rest pose). */
export function mergeBaked(parts: readonly { geometry: BufferGeometry; matrix: Matrix4 }[]): BufferGeometry {
  const b = new MeshBuilder();
  for (const { geometry, matrix } of parts) {
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    const col = geometry.getAttribute("color");
    const surf = geometry.getAttribute("aSurf");
    const base = b.position.length / 3;
    _m3.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
      b.position.push(_p.x, _p.y, _p.z);
      b.normal.push(_n.x, _n.y, _n.z);
      b.color.push(col.getX(i), col.getY(i), col.getZ(i));
      b.surfs.push(surf.getX(i), surf.getY(i), surf.getZ(i), surf.getW(i));
    }
    const idx = geometry.index!;
    for (let i = 0; i < idx.count; i++) b.index.push(idx.getX(i) + base);
  }
  return b.build();
}
