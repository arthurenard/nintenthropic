/**
 * Ray tests against the simple shapes a character is made of for shooting: a
 * sphere for the head and capsules for the torso and limbs (High Noon's
 * bandits; anyone built on the shared humanoid armature).
 *
 * Each test reports how close the ray came (`miss`, metres from the shape's
 * core) and how far along the ray that was (`t`). A finger is not a mouse, so
 * the caller can then accept near misses within an angular tolerance — aim
 * assist that is honest about distance rather than a magnet.
 */
/** A point or direction in the world, metres: a three.js Vector3 is one. */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface RayProbe {
  /** Distance along the ray (metres) of the closest approach. */
  t: number;
  /** Distance from the ray to the shape's core (centre or axis) at that point. */
  miss: number;
}

/** Closest approach of a ray (unit `dir`) to a point. `t` < 0 means behind the eye. */
export function probePoint(origin: V3, dir: V3, c: V3, out: RayProbe): RayProbe {
  const cx = c.x - origin.x;
  const cy = c.y - origin.y;
  const cz = c.z - origin.z;
  const t = cx * dir.x + cy * dir.y + cz * dir.z;
  const px = cx - dir.x * t;
  const py = cy - dir.y * t;
  const pz = cz - dir.z * t;
  out.t = t;
  out.miss = Math.sqrt(px * px + py * py + pz * pz);
  return out;
}

/** Closest approach of a ray (unit `dir`, t ≥ 0) to the segment a–b. */
export function probeSegment(origin: V3, dir: V3, a: V3, b: V3, out: RayProbe): RayProbe {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const ez = b.z - a.z;
  const wx = origin.x - a.x;
  const wy = origin.y - a.y;
  const wz = origin.z - a.z;
  const B = dir.x * ex + dir.y * ey + dir.z * ez;
  const C = ex * ex + ey * ey + ez * ez;
  const D = dir.x * wx + dir.y * wy + dir.z * wz;
  const E = ex * wx + ey * wy + ez * wz;
  let u: number;
  if (C < 1e-9) {
    u = 0;
  } else {
    const denom = C - B * B; // A = 1 for a unit direction
    u = denom > 1e-9 ? (E - B * D) / denom : 0;
    u = Math.min(1, Math.max(0, u));
  }
  let s = Math.max(0, u * B - D);
  if (C >= 1e-9) u = Math.min(1, Math.max(0, (s * B + E) / C));
  s = Math.max(0, u * B - D);
  const qx = a.x + ex * u - (origin.x + dir.x * s);
  const qy = a.y + ey * u - (origin.y + dir.y * s);
  const qz = a.z + ez * u - (origin.z + dir.z * s);
  out.t = s;
  out.miss = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return out;
}

/**
 * The radius a shape effectively has for a shot at distance `t`: its real
 * radius, or `minAngle` (radians, half-width) at that distance if larger.
 */
export function effectiveRadius(radius: number, t: number, minAngle: number): number {
  return Math.max(radius, t * Math.tan(minAngle));
}
