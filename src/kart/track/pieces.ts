/**
 * Timed moving set pieces: the helpers a track's data uses to say "a sweeper here", "a row of stompers there".
 *
 * A set piece is not a new kind of thing for the sim: it is one or more ordinary hazards (track/hazards.ts, whose
 * "swing", "crush" and "slide" motions and "orbit" arms are pure functions of the race clock), so the sim spins out
 * the karts they touch, the bots look ahead at where they will be and the picture draws them, all from the same
 * poses and nothing on the network. These helpers only spread a piece over the hazards it needs (a sweeper's arm
 * is a line of circles; a row of stompers is a stomper per lane) so a track's data stays short.
 *
 * Fairness, by construction: every piece tells you before it acts (`warn`: a shake and a lamp before a stomp, a
 * lamp before a cart crosses), the bob of a pendulum is only dangerous low down, and a row of stompers always
 * leaves a lane that is not in step with its neighbours.
 */
import type { HazardDef } from "./geometry";

/** The kinds the picture draws as instanced set pieces (render/world/pieces.ts) rather than one model each. */
export const PIECE_KINDS: readonly string[] = [
  "rock-crusher",
  "wrecking-ball",
  "ore-cart",
  "icicle",
  "arm-ball",
  "funhouse-panel",
  "mallet",
  "swing-boat",
];

export function isPieceKind(kind: string): boolean {
  return PIECE_KINDS.includes(kind);
}

export interface SweeperSpec {
  /** Which kind to draw each circle as (default "arm-ball"). */
  kind?: string;
  at: number;
  /** Metres right of the road's centre where the hub stands. */
  offset?: number;
  /** The arm's length, metres: circles from `from` (default 3) out to this, a `radius`-ish apart. */
  length: number;
  from?: number;
  /** Seconds for a turn. */
  period: number;
  phase?: number;
  /** Radius of each circle, metres (default 1.3). */
  radius?: number;
  /** Turns both ways from the hub (a bar through it) rather than one arm. */
  both?: boolean;
  dir?: 1 | -1;
}

/** A sweeper: a bar turning about a hub, as a line of circles. */
export function sweeper(spec: SweeperSpec): HazardDef[] {
  const radius = spec.radius ?? 1.3;
  const from = spec.from ?? 3;
  const out: HazardDef[] = [];
  const step = radius * 1.5;
  const n = Math.max(1, Math.round((spec.length - from) / step));
  const arms = spec.both ? [0, 0.5] : [0];
  for (const turn of arms) {
    for (let i = 0; i <= n; i++) {
      const r = from + ((spec.length - from) * i) / n;
      const def: HazardDef = {
        kind: spec.kind ?? "arm-ball",
        at: spec.at,
        motion: "orbit",
        period: spec.period,
        phase: (spec.phase ?? 0) + turn,
        radius,
        offset: spec.offset ?? 0,
        span: r,
      };
      if (spec.dir === -1) def.dir = -1;
      out.push(def);
    }
  }
  return out;
}

export interface StomperRowSpec {
  kind?: string;
  at: number;
  /** Lane centres, metres right of the road's centre. */
  lanes: number[];
  period: number;
  /** The stompers go in a wave: each lane this much of a cycle after the one before (default 0.18). */
  stagger?: number;
  phase?: number;
  radius?: number;
  /** Lanes (indices) that are left empty: the way through. */
  gaps?: number[];
}

/** A row of stompers across the road, falling in a wave, so there is always a lane to go through. */
export function stomperRow(spec: StomperRowSpec): HazardDef[] {
  const out: HazardDef[] = [];
  spec.lanes.forEach((lane, i) => {
    if (spec.gaps?.includes(i)) return;
    out.push({
      kind: spec.kind ?? "rock-crusher",
      at: spec.at,
      motion: "crush",
      period: spec.period,
      phase: (spec.phase ?? 0) + i * (spec.stagger ?? 0.18),
      radius: spec.radius ?? 2.2,
      offset: lane,
    });
  });
  return out;
}

/** A pendulum: a ball on a chain swinging across the road between `offset` ± `reach`. */
export function pendulum(spec: { kind?: string; at: number; offset?: number; reach: number; period: number; phase?: number; radius?: number }): HazardDef {
  const def: HazardDef = { kind: spec.kind ?? "wrecking-ball", at: spec.at, motion: "swing", period: spec.period, radius: spec.radius ?? 1.7, offset: spec.offset ?? 0, span: spec.reach };
  if (spec.phase !== undefined) def.phase = spec.phase;
  return def;
}

/**
 * Something that crosses the road once a cycle (an ore cart on rails, a funhouse panel). `reach` is how far each side it runs (negative: right to left).
 */
export function crosser(spec: { kind?: string; at: number; offset?: number; reach: number; period: number; phase?: number; radius?: number }): HazardDef {
  const def: HazardDef = { kind: spec.kind ?? "ore-cart", at: spec.at, motion: "slide", period: spec.period, radius: spec.radius ?? 2, offset: spec.offset ?? 0, span: spec.reach };
  if (spec.phase !== undefined) def.phase = spec.phase;
  return def;
}
