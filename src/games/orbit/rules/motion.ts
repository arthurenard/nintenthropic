/**
 * How a fragment moves: on a gently curving arc, a straight line bent by a
 * small, steady sideways acceleration - the drift of things in neighbouring
 * orbits, seen from one of them. Its position is exact at any moment
 * (p = p0 + v·τ + ½·a·τ²), so the rules can ask where it will be, when it
 * will reach the glass, and the world draws exactly that.
 *
 * A piece split from a fragment starts where its parent was, with its
 * parent's velocity (plus a small kick) and the same bend: it keeps the
 * momentum, and a careless shot turns one problem into three.
 */
import type { PaneSpec } from "./layout";
import { add, cross, dot, scale, sub, type V3 } from "./vec";

export interface Motion {
  /** Where it was at t0. */
  p0: V3;
  /** Its velocity at t0, metres per second. */
  v: V3;
  /** The steady bend, metres per second squared. */
  a: V3;
  /** When, on the match's clock. */
  t0: number;
}

export function positionAt(m: Motion, t: number, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  const s = t - m.t0;
  const h = 0.5 * s * s;
  out.x = m.p0.x + m.v.x * s + m.a.x * h;
  out.y = m.p0.y + m.v.y * s + m.a.y * h;
  out.z = m.p0.z + m.v.z * s + m.a.z * h;
  return out;
}

export function velocityAt(m: Motion, t: number, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  const s = t - m.t0;
  out.x = m.v.x + m.a.x * s;
  out.y = m.v.y + m.a.y * s;
  out.z = m.v.z + m.a.z * s;
  return out;
}

/**
 * The motion that leaves `from` at `t0` and reaches `to` after `duration`
 * seconds, bent by `bend`: the velocity is solved so the arc ends on the mark.
 */
export function arcTo(from: V3, to: V3, t0: number, duration: number, bend: V3): Motion {
  const T = Math.max(0.05, duration);
  // to = from + v·T + ½·a·T²  →  v = (to − from − ½·a·T²) / T
  const v = scale(sub(sub(to, from), scale(bend, 0.5 * T * T)), 1 / T);
  return { p0: { ...from }, v, a: { ...bend }, t0 };
}

/** The same path, re-based at time t (a piece continuing from here, with a kick). */
export function rebase(m: Motion, t: number, offset: V3, kick: V3): Motion {
  const p = add(positionAt(m, t), offset);
  const v = add(velocityAt(m, t), kick);
  return { p0: p, v, a: { ...m.a }, t0: t };
}

export interface Strike {
  pane: number;
  /** When it reaches the glass, on the match's clock. */
  time: number;
  point: V3;
  /** Its speed at the glass, metres per second. */
  speed: number;
}

/** Is `p` (in the pane's plane) inside its outline? */
export function insidePane(pane: PaneSpec, p: V3, margin = 0): boolean {
  const cs = pane.corners;
  if (cs.length < 3) return Math.hypot(p.x - pane.center.x, p.y - pane.center.y, p.z - pane.center.z) <= pane.radius + margin;
  let sign = 0;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i] as V3;
    const b = cs[(i + 1) % cs.length] as V3;
    const edge = sub(b, a);
    const s = dot(cross(edge, sub(p, a)), pane.normal);
    // How far outside this edge, in metres: allowed up to the margin.
    const len = Math.hypot(edge.x, edge.y, edge.z) || 1;
    const d = s / len;
    if (Math.abs(d) <= margin) continue;
    const here = d > 0 ? 1 : -1;
    if (sign === 0) sign = here;
    else if (here !== sign) return false;
  }
  return true;
}

const tmp = { x: 0, y: 0, z: 0 };
const vel = { x: 0, y: 0, z: 0 };

/**
 * The first moment in [from, from + horizon] the motion reaches a pane's
 * glass from outside, within its outline; null if it never does.
 */
export function strikeOf(m: Motion, from: number, horizon: number, panes: readonly PaneSpec[]): Strike | null {
  let best: Strike | null = null;
  const s0 = from - m.t0;
  const s1 = s0 + horizon;
  for (const pane of panes) {
    const n = pane.normal;
    // f(s) = n·(p0 − c) + n·v·s + ½·n·a·s²: above the glass while positive.
    const A = 0.5 * dot(n, m.a);
    const B = dot(n, m.v);
    const C = dot(n, sub(m.p0, pane.center));
    const roots: number[] = [];
    if (Math.abs(A) < 1e-9) {
      if (Math.abs(B) > 1e-9) roots.push(-C / B);
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const q = Math.sqrt(disc);
        roots.push((-B - q) / (2 * A), (-B + q) / (2 * A));
      }
    }
    for (const s of roots) {
      if (s < s0 || s > s1) continue;
      // Coming in, not going out.
      if (B + 2 * A * s >= 0) continue;
      const t = m.t0 + s;
      if (best && t >= best.time) continue;
      const p = positionAt(m, t, tmp);
      if (!insidePane(pane, p)) continue;
      const v = velocityAt(m, t, vel);
      best = { pane: pane.id, time: t, point: { x: p.x, y: p.y, z: p.z }, speed: Math.hypot(v.x, v.y, v.z) };
    }
  }
  return best;
}
