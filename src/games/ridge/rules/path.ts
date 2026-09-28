/**
 * A route through the valley - the road, a patrol's beat, the dam road, the
 * farmer's round - as a polyline measured along its length, and something
 * that follows it at a speed, there and back, round and round, or once.
 */
import type { V3 } from "../../../engine/rules/raymath";

export class Polyline {
  readonly points: readonly V3[];
  /** Distance along the line at each point. */
  private readonly at: number[];
  readonly length: number;

  constructor(points: readonly V3[]) {
    if (points.length === 0) throw new Error("a path needs at least one point");
    this.points = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    this.at = [0];
    let s = 0;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      s += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      this.at.push(s);
    }
    this.length = s;
  }

  /** The segment holding distance `s`, and how far along it (0..1). */
  private locate(s: number): { i: number; u: number } {
    const n = this.points.length;
    if (n === 1 || s <= 0) return { i: 0, u: 0 };
    if (s >= this.length) return { i: n - 2, u: 1 };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.at[mid] as number) <= s) lo = mid;
      else hi = mid;
    }
    const a = this.at[lo] as number;
    const b = this.at[lo + 1] as number;
    return { i: lo, u: b > a ? (s - a) / (b - a) : 0 };
  }

  /** The point `s` metres along, into `out`. */
  pointAt(s: number, out: V3): V3 {
    const { i, u } = this.locate(s);
    const a = this.points[i]!;
    const b = this.points[Math.min(i + 1, this.points.length - 1)]!;
    out.x = a.x + (b.x - a.x) * u;
    out.y = a.y + (b.y - a.y) * u;
    out.z = a.z + (b.z - a.z) * u;
    return out;
  }

  /** The heading of travel `s` metres along (radians about Y, 0 facing +Z), forwards or back. */
  headingAt(s: number, forward = true): number {
    const { i } = this.locate(s);
    const a = this.points[i]!;
    const b = this.points[Math.min(i + 1, this.points.length - 1)]!;
    const dx = (b.x - a.x) * (forward ? 1 : -1);
    const dz = (b.z - a.z) * (forward ? 1 : -1);
    return Math.atan2(dx, dz);
  }

  /** How far along the line its nearest point to `p` is (seen from above). */
  nearest(p: V3): number {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez;
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / len2)) : 0;
      const dx = a.x + ex * u - p.x;
      const dz = a.z + ez * u - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = (this.at[i] as number) + u * ((this.at[i + 1] as number) - (this.at[i] as number));
      }
    }
    return best;
  }
}

export type PathMode = "once" | "pingpong" | "loop";

/** Something moving along a Polyline: a position along it, a speed and a direction. */
export class PathWalker {
  /** Distance along the line. */
  s: number;
  /** +1 along the line, −1 back along it. */
  direction: 1 | -1 = 1;
  /** Reached the end of a "once" path. */
  done = false;

  constructor(
    readonly line: Polyline,
    readonly mode: PathMode,
    start = 0,
    public speed = 1,
  ) {
    this.s = Math.max(0, Math.min(line.length, start));
  }

  /** Move `dt` seconds on. Returns the metres actually moved. */
  step(dt: number): number {
    if (this.done || this.speed <= 0 || this.line.length <= 0) return 0;
    let move = this.speed * dt;
    const moved = move;
    const L = this.line.length;
    let guard = 0;
    while (move > 1e-9 && guard++ < 8) {
      const next = this.s + this.direction * move;
      if (next >= 0 && next <= L) {
        this.s = next;
        break;
      }
      const edge = this.direction > 0 ? L : 0;
      move -= Math.abs(edge - this.s);
      if (this.mode === "once") {
        this.s = edge;
        this.done = true;
        return moved - move;
      }
      if (this.mode === "loop") this.s = this.direction > 0 ? 0 : L;
      else {
        this.s = edge;
        this.direction = this.direction > 0 ? -1 : 1;
      }
    }
    return moved;
  }

  pointAt(out: V3): V3 {
    return this.line.pointAt(this.s, out);
  }

  heading(): number {
    return this.line.headingAt(this.s, this.direction > 0);
  }
}

/** Horizontal distance between two points. */
export function flat(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function dist(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** The heading from `a` toward `b` (radians about Y, 0 facing +Z). */
export function headingFrom(a: V3, b: V3): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}
