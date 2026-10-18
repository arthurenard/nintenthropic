/**
 * Helpers for building landmarks and hazards: surfaces of revolution (a
 * teapot, a tower), tubes (a rail, a handle), swept profiles (a tunnel, an
 * arch), faceted rocks and prisms, and `stamp` and `orient` for placing a
 * piece built once. All of them write triangles into a MeshBuilder
 * (world/builder.ts), flat shaded, vertex coloured. The rock and ice shapes
 * that three of the worlds share are in rockKit.ts.
 *
 * A `Shade` colours a surface: one colour, or a function of the point (and
 * its place in the grid), which is how a gradient from a dark foot to a
 * bright top, or stripes, are painted. Every material that draws landmarks
 * is double sided, so winding order does not matter here.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshBuilder, mixRgb, shapes, type Rgb, type V3 } from "../builder";

export { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, xf, type Rgb, type V3 } from "../builder";

/** A colour, or a colour for each point of a surface (point, row, column). */
export type Shade = Rgb | ((p: V3, i: number, j: number) => Rgb);

const shadeAt = (s: Shade, p: V3, i: number, j: number): Rgb => (typeof s === "function" ? s(p, i, j) : s);

/** A foot-to-top colour ramp for MeshBuilder's own shapes (box, post, spire, blob), which take a Paint, not a Shade. */
export function ramp(bottom: Rgb, top: Rgb): { bottom: Rgb; top: Rgb } {
  return { bottom, top };
}

/** A gradient with height: `bottom` at y0 to `top` at y1 (a cheap baked ambient occlusion). */
export function byHeight(y0: number, y1: number, bottom: Rgb, top: Rgb): Shade {
  return (p) => mixRgb(bottom, top, Math.max(0, Math.min(1, (p[1] - y0) / (y1 - y0 || 1))));
}

/** Alternating colours: stripes by the row or column index. */
export function stripes(a: Rgb, b: Rgb, by: "row" | "col" = "col", every = 1): Shade {
  return (_p, i, j) => (Math.floor((by === "row" ? i : j) / every) % 2 === 0 ? a : b);
}

/**
 * A grid of points as quads: `pts[i][j]` joins `pts[i+1][j]` and `pts[i][j+1]`.
 * `wrap` closes each row into a ring (the last point joins the first). Every
 * surface below is this.
 */
export function grid(b: MeshBuilder, pts: readonly (readonly V3[])[], shade: Shade, wrap = false): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i]!;
    const B = pts[i + 1]!;
    const n = Math.min(A.length, B.length);
    const cols = wrap ? n : n - 1;
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % n;
      b.quad(
        A[j]!,
        A[j2]!,
        B[j2]!,
        B[j]!,
        shadeAt(shade, A[j]!, i, j),
        shadeAt(shade, A[j2]!, i, j2),
        shadeAt(shade, B[j2]!, i + 1, j2),
        shadeAt(shade, B[j]!, i + 1, j),
      );
    }
  }
}

function applyMatrix(pts: V3[][], m: Matrix4 | undefined): V3[][] {
  if (!m) return pts;
  const e = m.elements;
  return pts.map((row) =>
    row.map(
      ([x, y, z]): V3 => [
        e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
        e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
        e[2]! * x + e[6]! * y + e[10]! * z + e[14]!,
      ],
    ),
  );
}

export interface LatheOptions {
  /** Where the foot of the axis stands. */
  at?: V3;
  /** Sides: 8 reads as a lathe-turned toy, 12 as smooth. */
  segments?: number;
  /** Squash or stretch: x and z scale the radius, y the height. */
  scale?: number | V3;
  /** A transform applied after (tilt a spout, lean a tower). */
  matrix?: Matrix4;
  shade: Shade;
  /** Close the ends with a fan: a lid, a base. */
  caps?: "top" | "bottom" | "both";
  /** Turns the whole thing about its own axis, radians. */
  phase?: number;
}

/**
 * A surface of revolution about the y axis: `profile` is [radius, height]
 * from the bottom up. A teapot's belly, a pepper mill, a tower, a bowl.
 */
export function lathe(b: MeshBuilder, profile: readonly (readonly [number, number])[], o: LatheOptions): void {
  const seg = o.segments ?? 10;
  const at = o.at ?? [0, 0, 0];
  const s: V3 = typeof o.scale === "number" ? [o.scale, o.scale, o.scale] : (o.scale ?? [1, 1, 1]);
  const phase = o.phase ?? 0;
  const rings: V3[][] = profile.map(([r, y]) => {
    const ring: V3[] = [];
    for (let k = 0; k < seg; k++) {
      const a = phase + (k / seg) * Math.PI * 2;
      ring.push([Math.cos(a) * r * s[0], y * s[1], Math.sin(a) * r * s[2]]);
    }
    return ring;
  });
  const placed = applyMatrix(rings, o.matrix).map((row) => row.map(([x, y, z]): V3 => [x + at[0], y + at[1], z + at[2]]));
  grid(b, placed, o.shade, true);
  const cap = (row: V3[], i: number) => {
    const cx = row.reduce((a, p) => a + p[0], 0) / row.length;
    const cy = row.reduce((a, p) => a + p[1], 0) / row.length;
    const cz = row.reduce((a, p) => a + p[2], 0) / row.length;
    const c: V3 = [cx, cy, cz];
    for (let k = 0; k < row.length; k++) {
      const p = row[k]!;
      const q = row[(k + 1) % row.length]!;
      b.tri(c, p, q, shadeAt(o.shade, c, i, 0), shadeAt(o.shade, p, i, k), shadeAt(o.shade, q, i, (k + 1) % row.length));
    }
  };
  if (o.caps === "top" || o.caps === "both") cap(placed[placed.length - 1]!, placed.length - 1);
  if (o.caps === "bottom" || o.caps === "both") cap(placed[0]!, 0);
}

export interface TubeOptions {
  /** Radius, or a radius for each point's place along the path (0..1). */
  radius: number | ((t: number) => number);
  sides?: number;
  shade: Shade;
  /** Close the end(s) with a fan. */
  caps?: boolean;
  /** Join the last point to the first. */
  closed?: boolean;
}

/** A round tube along a path: rails, handles, spouts, vines, hoses. */
export function tube(b: MeshBuilder, path: readonly V3[], o: TubeOptions): void {
  const n = path.length;
  if (n < 2) return;
  const sides = o.sides ?? 6;
  const rad = typeof o.radius === "number" ? () => o.radius as number : o.radius;
  const tangents: V3[] = path.map((_p, i) => {
    const a = path[o.closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const c = path[o.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    const d: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / len, d[1] / len, d[2] / len];
  });
  // Parallel transport: carry a normal along the path so the tube never twists.
  const t0 = tangents[0]!;
  let nrm: V3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const rings: V3[][] = [];
  for (let i = 0; i < n; i++) {
    const t = tangents[i]!;
    // Remove the tangent's share from the normal, then renormalise.
    const dot = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
    let u: V3 = [nrm[0] - t[0] * dot, nrm[1] - t[1] * dot, nrm[2] - t[2] * dot];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    nrm = u;
    const v: V3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const r = rad(i / (n - 1));
    const p = path[i]!;
    const ring: V3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      ring.push([p[0] + u[0] * ca + v[0] * sa, p[1] + u[1] * ca + v[1] * sa, p[2] + u[2] * ca + v[2] * sa]);
    }
    rings.push(ring);
  }
  if (o.closed) rings.push(rings[0]!);
  grid(b, rings, o.shade, true);
  if (o.caps && !o.closed) {
    for (const [ring, centre, i] of [
      [rings[0]!, path[0]!, 0],
      [rings[n - 1]!, path[n - 1]!, n - 1],
    ] as const) {
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k]!;
        const q = ring[(k + 1) % ring.length]!;
        b.tri(centre, p, q, shadeAt(o.shade, centre, i, 0), shadeAt(o.shade, p, i, k), shadeAt(o.shade, q, i, k + 1));
      }
    }
  }
}

/** A straight rod with a circular section from `a` to `c`. */
export function pipe(b: MeshBuilder, a: V3, c: V3, radius: number, shade: Shade, sides = 6): void {
  tube(b, [a, c], { radius, sides, shade, caps: true });
}

/** Copies every triangle of `src` into `dst` through a matrix: a piece built once, then placed many times, tilted or turned. */
export function stamp(dst: MeshBuilder, src: MeshBuilder, m: Matrix4): void {
  const p = src.position;
  const c = src.color;
  const e = m.elements;
  const at = (i: number): V3 => [
    e[0]! * p[i]! + e[4]! * p[i + 1]! + e[8]! * p[i + 2]! + e[12]!,
    e[1]! * p[i]! + e[5]! * p[i + 1]! + e[9]! * p[i + 2]! + e[13]!,
    e[2]! * p[i]! + e[6]! * p[i + 1]! + e[10]! * p[i + 2]! + e[14]!,
  ];
  for (let i = 0; i < p.length; i += 9) {
    dst.tri(at(i), at(i + 3), at(i + 6), [c[i]!, c[i + 1]!, c[i + 2]!], [c[i + 3]!, c[i + 4]!, c[i + 5]!], [c[i + 6]!, c[i + 7]!, c[i + 8]!]);
  }
}

const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();

/** A unit shape stood on `pos` with its +y along `dir`: a crystal growing out of rock, a nozzle on a ring, a tuft of husk on a coconut. */
export function orient(b: MeshBuilder, shape: ReturnType<typeof shapes.cone>, pos: V3, dir: V3, sx: number, sy: number, sz: number, paint: Rgb | { bottom: Rgb; top: Rgb }): void {
  const d = new Vector3(dir[0], dir[1], dir[2]).normalize();
  _q.setFromUnitVectors(_up, d);
  // The shape is centred, so its middle sits half a length out along `dir`.
  const m = new Matrix4().compose(new Vector3(pos[0] + d.x * sy * 0.5, pos[1] + d.y * sy * 0.5, pos[2] + d.z * sy * 0.5), _q, new Vector3(sx, sy, sz));
  b.add(shape, m, paint);
}

export interface TorusOptions {
  at?: V3;
  /** The ring's plane faces this way: "y" lies flat, "z" stands facing front (a hoop), "x" stands facing sideways. */
  facing?: "x" | "y" | "z";
  /** Segments round the ring and round the tube. */
  ringSegments?: number;
  tubeSegments?: number;
  shade: Shade;
  /** Only part of the ring, radians from/to (default all of it). */
  arc?: [number, number];
}

/** A doughnut (or part of one): wheels, rings, hoops, tyres, arches. */
export function torus(b: MeshBuilder, R: number, r: number, o: TorusOptions): void {
  const ringN = o.ringSegments ?? 16;
  const tubeN = o.tubeSegments ?? 6;
  const at = o.at ?? [0, 0, 0];
  const [a0, a1] = o.arc ?? [0, Math.PI * 2];
  const place = (u: number, v: number): V3 => {
    const ring = R + Math.cos(v) * r;
    const a = Math.cos(u) * ring;
    const c = Math.sin(u) * ring;
    const h = Math.sin(v) * r;
    switch (o.facing ?? "y") {
      case "y":
        return [at[0] + a, at[1] + h, at[2] + c];
      case "z":
        return [at[0] + a, at[1] + c, at[2] + h];
      default:
        return [at[0] + h, at[1] + a, at[2] + c];
    }
  };
  const rows: V3[][] = [];
  for (let i = 0; i <= ringN; i++) {
    const u = a0 + ((a1 - a0) * i) / ringN;
    const row: V3[] = [];
    for (let k = 0; k < tubeN; k++) row.push(place(u, (k / tubeN) * Math.PI * 2));
    rows.push(row);
  }
  grid(b, rows, o.shade, true);
}

/**
 * A faceted lump of rock: a geodesic ball with every vertex pushed in or out
 * by a repeatable noise, then stretched. `flatBase` squashes the bottom flat
 * so it sits on the ground.
 */
export function rockBlob(
  b: MeshBuilder,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  shade: Shade,
  seed = 1,
  o: { detail?: 0 | 1 | 2; roughness?: number; flatBase?: boolean; yaw?: number } = {},
): void {
  const shape = shapes.ball(o.detail ?? 1);
  const pos = shape.positions;
  const rough = o.roughness ?? 0.22;
  const cos = Math.cos(o.yaw ?? 0);
  const sin = Math.sin(o.yaw ?? 0);
  const displaced = (x: number, y: number, z: number): V3 => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
    const k = 1 + (h - Math.floor(h) - 0.5) * 2 * rough;
    let py = y * k * ry;
    if (o.flatBase && y < -0.35) py = -0.35 * ry;
    const px = x * k * rx;
    const pz = z * k * rz;
    return [cx + px * cos + pz * sin, cy + py, cz - px * sin + pz * cos];
  };
  for (let i = 0; i < pos.length; i += 9) {
    const a = displaced(pos[i]!, pos[i + 1]!, pos[i + 2]!);
    const c = displaced(pos[i + 3]!, pos[i + 4]!, pos[i + 5]!);
    const d = displaced(pos[i + 6]!, pos[i + 7]!, pos[i + 8]!);
    b.tri(a, c, d, shadeAt(shade, a, 0, 0), shadeAt(shade, c, 0, 1), shadeAt(shade, d, 0, 2));
  }
}

/**
 * A vertical prism on a polygon of [x, z] points: the walls from y0 to y1,
 * with a fan on top (and below). Works for any polygon that is convex or
 * star shaped about its centre.
 */
export function prism(b: MeshBuilder, poly: readonly (readonly [number, number])[], y0: number, y1: number, shade: Shade, o: { top?: boolean; bottom?: boolean } = {}): void {
  const n = poly.length;
  const lo = poly.map(([x, z]): V3 => [x, y0, z]);
  const hi = poly.map(([x, z]): V3 => [x, y1, z]);
  grid(b, [lo, hi], shade, true);
  const fan = (ring: V3[], row: number) => {
    const cx = ring.reduce((a, p) => a + p[0], 0) / n;
    const cz = ring.reduce((a, p) => a + p[2], 0) / n;
    const c: V3 = [cx, ring[0]![1], cz];
    for (let k = 0; k < n; k++) {
      const p = ring[k]!;
      const q = ring[(k + 1) % n]!;
      b.tri(c, q, p, shadeAt(shade, c, row, 0), shadeAt(shade, q, row, k + 1), shadeAt(shade, p, row, k));
    }
  };
  if (o.top !== false) fan(hi, 1);
  if (o.bottom) fan(lo, 0);
}

/**
 * A 2D profile (x, y pairs) swept along z from z0 to z1 in `steps` pieces:
 * a tunnel's skin, a wall's section, a ramp's side. `scaleAt(t)` can grow or
 * shrink the section along the way (t 0..1); `closed` joins the profile's
 * ends.
 */
export function extrudeZ(
  b: MeshBuilder,
  section: readonly (readonly [number, number])[],
  z0: number,
  z1: number,
  steps: number,
  shade: Shade,
  o: { closed?: boolean; scaleAt?: (t: number) => number } = {},
): void {
  const rows: V3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k = o.scaleAt ? o.scaleAt(t) : 1;
    rows.push(section.map(([x, y]): V3 => [x * k, y * k, z0 + (z1 - z0) * t]));
  }
  grid(b, rows, shade, o.closed ?? false);
}

/** The points of a half ellipse (or more), a profile for tunnels and arches: from the left foot over the top to the right foot. */
export function dome2D(halfWidth: number, height: number, count = 12, legs = 0): [number, number][] {
  const out: [number, number][] = [];
  if (legs > 0) out.push([-halfWidth, 0]);
  for (let k = 0; k < count; k++) {
    const a = Math.PI - (k / (count - 1)) * Math.PI;
    out.push([Math.cos(a) * halfWidth, legs + Math.sin(a) * (height - legs)]);
  }
  if (legs > 0) out.push([halfWidth, 0]);
  return out;
}

export interface ArchBandOptions {
  /** Clear width and height inside, metres. */
  width: number;
  height: number;
  /** How thick the arch band is, and how deep (along z). */
  thickness: number;
  depth: number;
  /** Straight legs before the curve starts. */
  legs?: number;
  segments?: number;
  shade: Shade;
  at?: V3;
}

/**
 * An arch band standing in the x-y plane, `depth` deep along z: a rock arch,
 * a gateway, a bridge's span, a ring gate's frame. Inner and outer surfaces
 * plus the front and back faces. The band is `thickness` thick all round.
 */
export function archBand(b: MeshBuilder, o: ArchBandOptions): void {
  const at = o.at ?? [0, 0, 0];
  const legs = o.legs ?? 0;
  const seg = o.segments ?? 12;
  const rise = Math.max(0.01, o.height - legs);
  const band = (hw: number, rs: number): [number, number][] => {
    const pts: [number, number][] = [[-hw, 0]];
    if (legs > 0) pts.push([-hw, legs]);
    for (let k = 0; k <= seg; k++) {
      const a = Math.PI - (k / seg) * Math.PI;
      pts.push([Math.cos(a) * hw, legs + Math.sin(a) * rs]);
    }
    if (legs > 0) pts.push([hw, legs]);
    pts.push([hw, 0]);
    return pts;
  };
  const inner = band(o.width / 2, rise);
  const outer = band(o.width / 2 + o.thickness, rise + o.thickness);
  const d = o.depth / 2;
  const row = (pts: [number, number][], z: number): V3[] => pts.map(([x, y]): V3 => [at[0] + x, at[1] + y, at[2] + z]);
  grid(b, [row(inner, -d), row(inner, d)], o.shade);
  grid(b, [row(outer, -d), row(outer, d)], o.shade);
  grid(b, [row(inner, d), row(outer, d)], o.shade);
  grid(b, [row(inner, -d), row(outer, -d)], o.shade);
}
