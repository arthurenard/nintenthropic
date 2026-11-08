/**
 * Helpers for the second pass's timed pieces: a shower of falling rocks, a front of lava or water that sweeps across the road. Like
 * the first pass's (pieces.ts) they only spread a piece over the ordinary hazards it needs; the sim, the bots and the picture read
 * the same poses from the race clock and nothing goes over the network.
 */
import type { HazardDef } from "./geometry";

export interface RainSpec {
  /** "ember-rock", "meteor" or "coconut-bunch". */
  kind: string;
  /** Where the first row falls, a fraction of the lap, and how far apart (a fraction) the next rows are. */
  at: number;
  step: number;
  /** One entry per row: the lanes (metres right of the centre) that row drops a rock on. */
  rows: number[][];
  period: number;
  /** The shower goes in a wave down the road: each row this much of a cycle after the one before (default 0.14). */
  stagger?: number;
  phase?: number;
  radius?: number;
  /** How high above the road the rock hangs before it falls (default: crushTop). */
  top?: number;
}

/**
 * A shower: rows of rocks across the road, each row a little behind the last, so the lane that is clear moves down the road and
 * there is always a line through. Each rock shows a shadow that grows and reddens for most of a second before it lands.
 */
export function rockRain(spec: RainSpec): HazardDef[] {
  const out: HazardDef[] = [];
  spec.rows.forEach((lanes, row) => {
    lanes.forEach((lane, i) => {
      const def: HazardDef = {
        kind: spec.kind,
        at: spec.at + row * spec.step,
        motion: "crush",
        period: spec.period,
        phase: (spec.phase ?? 0) + row * (spec.stagger ?? 0.14) + i * 0.013,
        radius: spec.radius ?? 2.2,
        offset: lane,
      };
      if (spec.top !== undefined) def.top = spec.top;
      out.push(def);
    });
  });
  return out;
}

export interface FrontSpec {
  /** "lava-surge" or "tide-wave". */
  kind: string;
  /** The middle of the front along the road, a fraction of the lap. */
  at: number;
  /** How many pieces, side by side along the road, and how far apart (a fraction of the lap). */
  count: number;
  step: number;
  period: number;
  phase?: number;
  /** Metres either side of the road's middle it runs from and to; negative: right to left (a mirrored track's does the same). */
  reach: number;
  radius?: number;
  offset?: number;
  /** How much of the cycle its warning shows before it comes (default 0.22). */
  lead?: number;
}

/** A front of lava or water that sweeps across the whole road once a cycle: `count` pieces side by side, a lamp before it comes. */
export function front(spec: FrontSpec): HazardDef[] {
  const out: HazardDef[] = [];
  for (let i = 0; i < spec.count; i++) {
    const def: HazardDef = {
      kind: spec.kind,
      at: spec.at + (i - (spec.count - 1) / 2) * spec.step,
      motion: "slide",
      period: spec.period,
      radius: spec.radius ?? 2.2,
      offset: spec.offset ?? 0,
      span: spec.reach,
    };
    if (spec.phase !== undefined) def.phase = spec.phase;
    if (spec.lead !== undefined) def.lead = spec.lead;
    out.push(def);
  }
  return out;
}
