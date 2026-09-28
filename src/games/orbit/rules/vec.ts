/**
 * The few vector sums the rules need, on plain `{ x, y, z }` objects so the
 * rules run and are tested without Three.js. Each returns a new object
 * unless it takes an `out`: the rules step a few dozen fragments a frame,
 * and the hot paths (positions, the strike test) write into their own.
 */
import type { V3 } from "../../../engine/rules/raymath";

export type { V3 };

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const distance = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** `a + b·k`. */
export const addScaled = (a: V3, b: V3, k: number): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

export function normalize(a: V3): V3 {
  const l = length(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

/** Any unit vector at right angles to `a`. */
export function perpendicular(a: V3): V3 {
  const n = normalize(a);
  const other = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(n, other));
}

/** `v` turned `angle` radians about the unit `axis` (Rodrigues). */
export function rotate(v: V3, axis: V3, angle: number, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v) * (1 - c);
  const x = v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d;
  const y = v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d;
  const z = v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
