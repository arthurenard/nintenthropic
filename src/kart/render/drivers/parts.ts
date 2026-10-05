/**
 * Shared bits for building the drivers: palettes, a few shapes beyond the
 * builder's own (domes for helmets, tubes and horns aimed at a point), and the
 * parts every creature has (eyes, a body in a racing vest, thighs).
 *
 * Drivers are built facing +z; their left is +x. The hips are the origin of
 * the body, the head's centre the origin of the head (see HEAD_AT).
 *
 * Everything is smooth: round ellipsoids for fur, glossy beads for eyes, a
 * clear-coated helmet with a mirrored peak (kartMaterial.ts has the surfaces).
 */
import { BufferGeometry, Matrix4, Quaternion, SphereGeometry, Vector3 } from "three";
import { TAU } from "../math";
import { SURF, type Surf } from "../kartMaterial";
import { MeshBuilder, customShape, mixRgb, rgb, scaleRgb, shapes, xf, type Paint, type Rgb, type Shape, type V3 } from "../kartBuilder";
import type { Bit } from "./types";

export const INK: Rgb = rgb("#1b1a26");
export const WHITE: Rgb = rgb("#f6f7fa");
/** Overbright, so a glint stays white under the lights. */
export const GLINT: Rgb = [1.7, 1.9, 2.4];

/** The kart's colour in the shades a helmet, scarf or strap is painted in. */
export interface Look {
  kart: Rgb;
  top: Rgb;
  low: Rgb;
  deep: Rgb;
  /** The racing vest: near white, a breath of the kart's colour. */
  vest: Paint;
  /** The shorts and thighs. */
  pants: Paint;
}

export function look(colour: string): Look {
  const kart = rgb(colour);
  const vest = mixRgb(WHITE, kart, 0.12);
  return {
    kart,
    top: mixRgb(kart, [1, 1, 1], 0.14),
    low: scaleRgb(kart, 0.64),
    deep: scaleRgb(kart, 0.4),
    vest: { bottom: scaleRgb(vest, 0.7), top: vest },
    pants: { bottom: [0.012, 0.014, 0.03], top: [0.04, 0.045, 0.08] },
  };
}

/** Fur and skin: a soft ramp from a darker belly-side to the colour. */
export function fur(c: Rgb): Paint {
  return { bottom: scaleRgb(c, 0.74), top: mixRgb(c, [1, 1, 1], 0.06) };
}

/** A helmet's shell: darker underneath, bright on top. */
export function shell(l: Look): Paint {
  return { bottom: l.low, top: l.top };
}

/** The head sits here in the driver's space (the head group's origin is its centre). */
export const HEAD_AT: V3 = [0, 0.84, 0.06];
/** Where the driver's shoulders are (y, z) and the arms' length. */
export const SHOULDER_Y = 0.46;
export const SHOULDER_Z = 0.02;
export const ARM_LEN = 0.54;

const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _d = new Vector3();
const _p = new Vector3();
const _s = new Vector3();

/** The matrix for a unit shape stretched from `from` to `to` along its y axis, `r` across. */
function aimed(from: V3, to: V3, r: number, rz = r): Matrix4 {
  _d.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const len = _d.length() || 1e-6;
  _q.setFromUnitVectors(_up, _d.divideScalar(len));
  return new Matrix4().compose(_p.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2), _q, _s.set(r, len, rz));
}

/** A round limb from `from` to `to`, ending `top` times as wide (1: a plain cylinder). The paint ramps from `from`. */
export function tube(b: MeshBuilder, from: V3, to: V3, r: number, paint: Paint, top = 1, segments = 6): void {
  const ratio = Math.round(top * 20) / 20;
  b.add(ratio === 1 ? shapes.cylinder(segments) : shapes.frustum(ratio, segments), aimed(from, to, r), paint);
}

/** A pointed ear or horn, its base at `from`, its tip at `to`. */
export function horn(b: MeshBuilder, from: V3, to: V3, r: number, paint: Paint, segments = 4, flat = r): void {
  b.add(shapes.cone(segments), aimed(from, to, r, flat), paint);
}

/** An ellipsoid with radii `r`, turned by `rot` (yaw, pitch, roll). */
export function orb(b: MeshBuilder, at: V3, r: V3, paint: Paint, detail = 1, rot: V3 = [0, 0, 0]): void {
  b.add(shapes.ball(detail), xf(at[0], at[1], at[2], r[0], r[1], r[2], rot[0], rot[1], rot[2]), paint);
}

/** A dome (part of a sphere from the top down): `coverage` 0.5 is a hemisphere. Radius 1. */
export function domeShape(coverage: number): Shape {
  const key = Math.round(coverage * 100);
  return customShape(`dome${key}`, () => new SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI * (key / 100)) as BufferGeometry);
}

/** A helmet shell or cap: glossy paint. */
export function dome(b: MeshBuilder, at: V3, r: V3, paint: Paint, coverage = 0.5, rot: V3 = [0, 0, 0]): void {
  b.as(SURF.paint, () => b.add(domeShape(coverage), xf(at[0], at[1], at[2], r[0], r[1], r[2], rot[0], rot[1], rot[2]), paint));
}

/**
 * A racing helmet: the clear-coated shell, a pale rim round its edge, a
 * stripe over the crown in the kart's colour and a mirrored peak. `at` and
 * `r` are the shell's centre and radii (as for `dome`).
 */
export function helmet(b: MeshBuilder, l: Look, at: V3, r: V3, coverage = 0.42, o: { peak?: boolean; stripe?: boolean } = {}): void {
  dome(b, at, r, shell(l), coverage);
  const phi = Math.PI * coverage;
  const ringY = at[1] + r[1] * Math.cos(phi);
  const ringR = r[0] * Math.sin(phi);
  b.as(SURF.trim, () => b.torus(ringR * 0.99, 0.022, xf(at[0], ringY, at[2], 1, 1, r[2] / r[0]), WHITE, 28, 6));
  if (o.stripe !== false) {
    // A pale stripe laid over the crown, front to back.
    b.as(SURF.trim, () => {
      for (const centre of [Math.PI / 2, (Math.PI * 3) / 2]) {
        const g = new SphereGeometry(1, 6, 10, centre - 0.15, 0.3, 0, Math.PI * coverage * 0.995);
        b.geometry(g, xf(at[0], at[1], at[2], r[0] * 1.012, r[1] * 1.012, r[2] * 1.012), WHITE);
        g.dispose();
      }
    });
  }
  if (o.peak !== false) {
    // A peak: a mirrored visor with a painted edge.
    const y = at[1] + r[1] * Math.cos(phi) + 0.07;
    const z = at[2] + r[2] * 0.9;
    b.as(SURF.glass, () => orb(b, [at[0], y, z], [r[0] * 0.62, 0.028, r[2] * 0.42], [0.05, 0.075, 0.16], 1, [0, -0.16, 0]));
    b.as(SURF.paint, () => orb(b, [at[0], y + 0.012, z - 0.012], [r[0] * 0.66, 0.026, r[2] * 0.45], shell(l), 1, [0, -0.16, 0]));
  }
}

/** A big glossy eye with two glints, on the front of a face (z forward). */
export function eye(b: MeshBuilder, x: number, y: number, z: number, r: number, ink: Rgb = INK): void {
  b.as(SURF.gloss, () => orb(b, [x, y, z], [r, r * 1.2, r * 0.75], ink, 1));
  b.as(SURF.lamp, () => {
    orb(b, [x * 0.92, y + r * 0.5, z + r * 0.5], [r * 0.36, r * 0.36, r * 0.2], GLINT, 0);
    orb(b, [x * 1.05, y - r * 0.5, z + r * 0.5], [r * 0.15, r * 0.15, r * 0.1], [1.2, 1.4, 1.9], 0);
  });
}

/** Two eyes, mirrored. */
export function eyes(b: MeshBuilder, spread: number, y: number, z: number, r: number, ink: Rgb = INK): void {
  for (const sx of [-1, 1]) eye(b, sx * spread, y, z, r, ink);
}

/**
 * The body in its racing vest: shorts, a chest of half-width `w` and depth
 * `d`, an optional belly patch, and the racing bib on the back (the kart's
 * colour, so a driver is known from behind).
 */
export function body(b: MeshBuilder, l: Look, o: { w: number; d: number; back?: Paint; belly?: Rgb; chest?: Paint }): void {
  const { w, d } = o;
  b.as(SURF.cloth, () => orb(b, [0, 0.1, -0.02], [w * 0.98, 0.17, 0.25], l.pants, 1));
  const chest = o.back ?? o.chest ?? l.vest;
  b.as(o.back || o.chest ? SURF.fur : SURF.cloth, () => orb(b, [0, 0.33, 0], [w, 0.31, d], chest, 2));
  if (o.belly) orb(b, [0, 0.3, d * 0.5], [w * 0.74, 0.24, d * 0.62], fur(o.belly), 1);
  // The bib: a flat patch across the back, a stripe of white on it.
  b.as(SURF.cloth, () => {
    b.slab(0, 0.36, -d * 0.93, w * 1.05, 0.3, 0.05, 0.02, { bottom: l.low, top: l.top }, 0, 0.1);
    b.slab(0, 0.36, -d * 0.93 - 0.028, w * 0.5, 0.06, 0.02, 0.008, WHITE, 0, 0.1);
  });
}

/** Thighs forward over the kart's hood, with a foot each. */
export function legs(b: MeshBuilder, l: Look, foot: Rgb, r = 0.09, spread = 0.15): void {
  for (const sx of [-1, 1]) {
    b.as(SURF.cloth, () => tube(b, [sx * spread, 0.04, 0.0], [sx * (spread + 0.04), 0.0, 0.4], r, l.pants, 0.9));
    orb(b, [sx * (spread + 0.04), 0.0, 0.46], [r * 1.15, r * 0.9, r * 1.4], fur(foot), 1);
  }
}

/**
 * An arm built along +z from the shoulder: a furred arm, a sleeve, a hand.
 * An arm is round about its own axis, so one geometry serves both sides.
 */
export function armGeometry(o: { fur: Rgb; sleeve?: Paint; r?: number; hand?: Rgb; handR?: number; len?: number; surf?: Surf }): BufferGeometry {
  const r = o.r ?? 0.075;
  const len = o.len ?? ARM_LEN;
  const b = new MeshBuilder();
  if (o.surf) b.surf = o.surf;
  tube(b, [0, 0, 0], [0, 0, len * 0.8], r, fur(o.fur), 0.85);
  if (o.sleeve) b.as(SURF.cloth, () => tube(b, [0, 0, -0.02], [0, 0, len * 0.38], r * 1.28, o.sleeve!, 0.9));
  const hr = o.handR ?? r * 1.35;
  orb(b, [0, 0, len * 0.86], [hr, hr, hr * 1.08], fur(o.hand ?? o.fur), 1);
  return b.build();
}

/** The z of an ellipsoid's surface (centre `c`, radii `r`) at (x, y): where to put a face feature so it sits on it. */
export function surfaceZ(c: V3, r: V3, x: number, y: number): number {
  const u = (x - c[0]) / r[0];
  const v = (y - c[1]) / r[1];
  return c[2] + r[2] * Math.sqrt(Math.max(0, 1 - u * u - v * v));
}

/** A band round the head at height `y` (head space), a hair outside an ellipsoid head: goggle straps, headbands. */
export function headBand(b: MeshBuilder, head: { c: V3; r: V3 }, y: number, paint: Paint, height = 0.05, grow = 1.04): void {
  const k = Math.sqrt(Math.max(0.0001, 1 - ((y - head.c[1]) / head.r[1]) ** 2));
  b.as(SURF.cloth, () => b.add(shapes.cylinder(14), xf(head.c[0], y, head.c[2], head.r[0] * k * grow, height, head.r[2] * k * grow), paint));
}

/** A scarf's knot round the neck (on the body). */
export function collar(b: MeshBuilder, l: Look, w = 0.2, d = 0.17): void {
  b.as(SURF.cloth, () => orb(b, [0, 0.57, 0.02], [w, 0.08, d], shell(l), 1));
}

/** A scarf's tail, hanging behind the shoulder and fluttering. */
export function scarfTail(l: Look, at: V3 = [0.1, 0.58, -0.14]): Bit {
  const b = new MeshBuilder();
  b.surf = SURF.cloth;
  b.slab(0, -0.15, -0.02, 0.1, 0.34, 0.035, 0.016, { bottom: l.low, top: l.top }, 0, 0.1);
  b.slab(0, -0.3, -0.03, 0.1, 0.04, 0.04, 0.016, WHITE, 0, 0.1);
  return {
    geo: b.build(),
    at,
    on: "torso",
    move(o, s) {
      o.rotation.x = 0.35 + Math.sin(s.time * 9) * 0.12 + s.happy * 0.2;
      o.rotation.z = -s.steer * 0.25 + Math.sin(s.time * 7 + 1) * 0.06;
    },
  };
}
