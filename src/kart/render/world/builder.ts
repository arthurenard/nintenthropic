/**
 * Low-poly geometry assembled in code: many small shapes (a tree, a tyre, a
 * fence post) welded into one vertex-coloured BufferGeometry, so a whole
 * stretch of the track costs one draw call. Each shape keeps its own normals:
 * smooth on a ball or a post, flat on a box, which is what gives the toy look.
 *
 * Colours are linear RGB triples (what three keeps internally), so they can be
 * written straight into a vertex attribute.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
} from "three";

export type Rgb = readonly [number, number, number];
export type V3 = readonly [number, number, number];

/** Linear RGB from a CSS colour or a hex number. */
export function rgb(colour: string | number): Rgb {
  const c = new Color(colour);
  return [c.r, c.g, c.b];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleRgb(a: Rgb, k: number): Rgb {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** One colour, or a ramp from the shape's base to its top (a cheap baked ambient occlusion). */
export type Paint = Rgb | { bottom: Rgb; top: Rgb };

/** A unit shape as triangles: positions, normals where it has its own, and its height range for ramps. */
export interface Shape {
  readonly positions: Float32Array;
  /** The shape's own normal at each corner: smooth on a ball or a cylinder's side, flat on a box's faces. */
  readonly normals?: Float32Array;
  readonly minY: number;
  readonly maxY: number;
}

function shapeOf(geometry: BufferGeometry): Shape {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = new Float32Array((flat.getAttribute("position") as Float32BufferAttribute).array);
  const normals = new Float32Array((flat.getAttribute("normal") as Float32BufferAttribute).array);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    minY = Math.min(minY, positions[i]!);
    maxY = Math.max(maxY, positions[i]!);
  }
  geometry.dispose();
  if (flat !== geometry) flat.dispose();
  return { positions, normals, minY, maxY };
}

const shapeCache = new Map<string, Shape>();
function cached(key: string, make: () => BufferGeometry): Shape {
  let s = shapeCache.get(key);
  if (!s) {
    s = shapeOf(make());
    shapeCache.set(key, s);
  }
  return s;
}

/** Unit shapes, centred on the origin: a 1 m cube, and radius-1, height-1 cylinders and cones. */
export const shapes = {
  box: () => cached("box", () => new BoxGeometry(1, 1, 1)),
  /** Height 1 (y -0.5..0.5), radius 1. */
  cylinder: (segments = 8) => cached(`cyl${segments}`, () => new CylinderGeometry(1, 1, 1, segments, 1)),
  /** A cylinder narrower at the top: `top` is the top radius (the base is 1). */
  frustum: (top: number, segments = 8) => cached(`fr${top}_${segments}`, () => new CylinderGeometry(top, 1, 1, segments, 1)),
  cone: (segments = 8) => cached(`cone${segments}`, () => new CylinderGeometry(0, 1, 1, segments, 1)),
  /** Radius 1; detail 0 is 20 triangles, 1 is 80. */
  ball: (detail = 0) => cached(`ico${detail}`, () => new IcosahedronGeometry(1, detail)),
};

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** A transform from position, Euler rotation (radians, YXZ) and scale, for `MeshBuilder.add`. */
export function xf(x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0): Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.clone().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

const _nm = new Matrix3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();

export class MeshBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly uv: number[] = [];
  /**
   * The normals are a model's own, smooth, to be kept through placement (bake / bakeBent in
   * landmarks/place.ts) rather than recomputed flat: set by a Blender-made model's loader.
   */
  smooth = false;
  private readonly withUv: boolean;

  constructor(withUv = false) {
    this.withUv = withUv;
  }

  get triangles(): number {
    return this.position.length / 9;
  }

  get empty(): boolean {
    return this.position.length === 0;
  }

  /** One triangle, counter-clockwise seen from the front; colours per corner; `n` overrides the flat normal. */
  tri(a: V3, b: V3, c: V3, ca: Rgb, cb: Rgb = ca, cc: Rgb = ca, n?: V3, uvs?: readonly [number, number, number, number, number, number]): void {
    if (n) {
      _n.set(n[0], n[1], n[2]);
    } else {
      _a.set(a[0], a[1], a[2]);
      _b.set(b[0], b[1], b[2]).sub(_a);
      _c.set(c[0], c[1], c[2]).sub(_a);
      _n.crossVectors(_b, _c);
      const len = _n.length();
      if (len < 1e-12) return; // degenerate
      _n.divideScalar(len);
    }
    this.position.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.normal.push(_n.x, _n.y, _n.z, _n.x, _n.y, _n.z, _n.x, _n.y, _n.z);
    this.color.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    if (this.withUv) {
      if (uvs) this.uv.push(...uvs);
      else this.uv.push(0, 0, 0, 0, 0, 0);
    }
  }

  /** One triangle with a normal of its own at each corner (a smooth surface). */
  triN(a: V3, b: V3, c: V3, ca: Rgb, cb: Rgb, cc: Rgb, na: V3, nb: V3, nc: V3): void {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]).sub(_a);
    _c.set(c[0], c[1], c[2]).sub(_a);
    if (_n.crossVectors(_b, _c).lengthSq() < 1e-24) return; // degenerate
    this.position.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.normal.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    this.color.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    if (this.withUv) this.uv.push(0, 0, 0, 0, 0, 0);
  }

  /**
   * A quad a-b-c-d, counter-clockwise from the front (a, b along one edge, c, d back). `n` is used for
   * all four corners when given (a smooth surface such as a road); `uvs` is [ua, va, ub, vb, uc, vc, ud, vd].
   */
  quad(a: V3, b: V3, c: V3, d: V3, ca: Rgb, cb: Rgb = ca, cc: Rgb = ca, cd: Rgb = ca, n?: V3, uvs?: readonly number[]): void {
    const u = uvs;
    this.tri(a, b, c, ca, cb, cc, n, u ? [u[0]!, u[1]!, u[2]!, u[3]!, u[4]!, u[5]!] : undefined);
    this.tri(a, c, d, ca, cc, cd, n, u ? [u[0]!, u[1]!, u[4]!, u[5]!, u[6]!, u[7]!] : undefined);
  }

  /** Adds a unit shape under a transform and a paint. */
  add(shape: Shape, matrix: Matrix4, paint: Paint): void {
    const pos = shape.positions;
    const range = shape.maxY - shape.minY || 1;
    const bottom = "bottom" in paint ? paint.bottom : paint;
    const top = "top" in paint ? paint.top : paint;
    const ramp = "bottom" in paint;
    const world = new Float32Array(pos.length);
    const heights: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      _a.set(pos[i]!, pos[i + 1]!, pos[i + 2]!).applyMatrix4(matrix);
      world[i] = _a.x;
      world[i + 1] = _a.y;
      world[i + 2] = _a.z;
      heights.push((pos[i + 1]! - shape.minY) / range);
    }
    // The shape's own normals, carried through the transform (its inverse transpose), so a ball stays round.
    let nor: Float32Array | null = null;
    if (shape.normals) {
      const nm = _nm.setFromMatrix4(matrix).invert().transpose();
      nor = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        _a.set(shape.normals[i]!, shape.normals[i + 1]!, shape.normals[i + 2]!).applyMatrix3(nm).normalize();
        nor[i] = _a.x;
        nor[i + 1] = _a.y;
        nor[i + 2] = _a.z;
      }
    }
    for (let i = 0; i < pos.length; i += 9) {
      const h0 = heights[i / 3]!;
      const h1 = heights[i / 3 + 1]!;
      const h2 = heights[i / 3 + 2]!;
      const col = (h: number): Rgb => (ramp ? mixRgb(bottom, top, h) : bottom);
      const pa: V3 = [world[i]!, world[i + 1]!, world[i + 2]!];
      const pb: V3 = [world[i + 3]!, world[i + 4]!, world[i + 5]!];
      const pc: V3 = [world[i + 6]!, world[i + 7]!, world[i + 8]!];
      if (nor) this.triN(pa, pb, pc, col(h0), col(h1), col(h2), [nor[i]!, nor[i + 1]!, nor[i + 2]!], [nor[i + 3]!, nor[i + 4]!, nor[i + 5]!], [nor[i + 6]!, nor[i + 7]!, nor[i + 8]!]);
      else this.tri(pa, pb, pc, col(h0), col(h1), col(h2));
    }
  }

  /** An axis-aligned-then-rotated box: centre, size, yaw. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, paint: Paint, yaw = 0, pitch = 0, roll = 0): void {
    this.add(shapes.box(), xf(cx, cy, cz, sx, sy, sz, yaw, pitch, roll), paint);
  }

  /** A thin square rod from point `a` to point `c`: limbs, strings, struts. */
  rod(a: V3, c: V3, thickness: number, paint: Paint): void {
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const dz = c[2] - a[2];
    const horiz = Math.hypot(dx, dz);
    const len = Math.hypot(horiz, dy);
    if (len < 1e-6) return;
    this.add(shapes.box(), xf((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, thickness, thickness, len, Math.atan2(dx, dz), -Math.atan2(dy, horiz), 0), paint);
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

  /** A faceted ball, radii (rx, ry, rz). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, paint: Paint, detail = 0, yaw = 0): void {
    this.add(shapes.ball(detail), xf(cx, cy, cz, rx, ry, rz, yaw), paint);
  }

  /** Everything added so far as a BufferGeometry (vertex coloured), with bounds computed. */
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.position, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.normal, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.color, 3));
    if (this.withUv) g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
