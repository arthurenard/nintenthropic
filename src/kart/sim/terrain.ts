/**
 * What a track's data says about the ground, worked out once into tables the
 * physics can read in a few operations a tick: where the ramps are, which
 * edges have no barrier and where the road itself is missing (a gap to jump),
 * how far out the barrier stands on each side, what the ground beyond the road
 * is, and the patches of ice, mud and boost strip across it. Fractions of the
 * lap in the data become metres here.
 */
import { inStretch, type HazardDef, type Stretch, type Surface, type TrackDef, type TrackGeometry } from "../track/geometry";
import type { Ground } from "./state";
import { TUNING } from "./tuning";

/** A part of the lap in metres along it; `from` > `to` wraps over the line. */
export interface Span {
  from: number;
  to: number;
}

export interface RampSite {
  /** Where its lip is. */
  s: number;
  lift: number;
  trick: boolean;
}

/** Ground that differs from the road across part of its width. */
export interface Patch extends Span {
  kind: Surface;
  /** Metres right of the centre line, from and to. */
  lo: number;
  hi: number;
}

export interface Terrain {
  length: number;
  spacing: number;
  ramps: RampSite[];
  gaps: Span[];
  patches: Patch[];
  hazards: HazardDef[];
  /** Per geometry sample: 1 where that side has no barrier. */
  openLeft: Uint8Array;
  openRight: Uint8Array;
  /** Per sample: how far beyond the road's edge the barrier stands. */
  barrierLeft: Float32Array;
  barrierRight: Float32Array;
  /** Per sample: the ground beyond the road's edge. */
  groundLeft: Ground[];
  groundRight: Ground[];
}

/** Is `s` (0..length) inside `span`? */
export function inSpan(s: number, span: Span, length: number): boolean {
  const w = ((s % length) + length) % length;
  return span.from <= span.to ? w >= span.from && w <= span.to : w >= span.from || w <= span.to;
}

function spanOf(stretch: Stretch, length: number): Span {
  return { from: stretch.from * length, to: stretch.to * length };
}

export function buildTerrain(def: TrackDef, geo: TrackGeometry): Terrain {
  const length = geo.length;
  const n = geo.samples.length;
  const openLeft = new Uint8Array(n);
  const openRight = new Uint8Array(n);
  const barrierLeft = new Float32Array(n).fill(TUNING.barrierGap);
  const barrierRight = new Float32Array(n).fill(TUNING.barrierGap);
  const ground = (TUNING.groundByTheme[def.theme] ?? "grass") as Ground;
  const groundLeft: Ground[] = new Array<Ground>(n).fill(ground);
  const groundRight: Ground[] = new Array<Ground>(n).fill(ground);

  const gaps: Span[] = [];
  for (const drop of def.drops ?? []) {
    if (drop.gap) gaps.push(spanOf(drop, length));
    for (let i = 0; i < n; i++) {
      if (!inStretch((i * geo.spacing) / length, drop)) continue;
      if (drop.side !== "right") openLeft[i] = 1;
      if (drop.side !== "left") openRight[i] = 1;
    }
  }
  for (const verge of def.verges ?? []) {
    for (let i = 0; i < n; i++) {
      if (!inStretch((i * geo.spacing) / length, verge)) continue;
      if (verge.side === "left") {
        barrierLeft[i] = verge.distance;
        if (verge.surface) groundLeft[i] = verge.surface;
      } else {
        barrierRight[i] = verge.distance;
        if (verge.surface) groundRight[i] = verge.surface;
      }
    }
  }
  const patches: Patch[] = (def.surfaces ?? []).map((surface) => {
    const middle = surface.offset ?? 0;
    const half = (surface.width ?? Infinity) / 2;
    return { ...spanOf(surface, length), kind: surface.kind, lo: middle - half, hi: middle + half };
  });
  const ramps: RampSite[] = (def.ramps ?? []).map((ramp) => ({
    s: geo.wrap(ramp.at * length),
    lift: ramp.lift ?? TUNING.ramp.lift,
    trick: ramp.trick !== false,
  }));
  return { length, spacing: geo.spacing, ramps, gaps, patches, hazards: def.hazards ?? [], openLeft, openRight, barrierLeft, barrierRight, groundLeft, groundRight };
}

/** The table sample nearest `s`. */
export function sampleAt(t: Terrain, s: number): number {
  const n = t.openLeft.length;
  return ((Math.round(s / t.spacing) % n) + n) % n;
}

/** Is the edge on this side (+1 right, -1 left) open here: no barrier, a drop? */
export function isOpen(t: Terrain, s: number, side: 1 | -1): boolean {
  const i = sampleAt(t, s);
  return (side > 0 ? t.openRight[i] : t.openLeft[i]) === 1;
}

/** How far beyond the road's edge the barrier stands on this side here (the usual 6 m, or a verge's). */
export function barrierDistance(t: Terrain, s: number, side: 1 | -1): number {
  const i = sampleAt(t, s);
  return side > 0 ? t.barrierRight[i]! : t.barrierLeft[i]!;
}

/** The gap in the road that covers `s`, or null. */
export function gapAt(t: Terrain, s: number): Span | null {
  for (const gap of t.gaps) if (inSpan(s, gap, t.length)) return gap;
  return null;
}

/**
 * What a kart at `s`, `offset` metres right of the centre line, drives on:
 * beyond the road's edge the ground there; on it the last patch to cover that
 * place, or the plain road.
 */
export function groundAt(t: Terrain, s: number, offset: number, half: number): Ground {
  if (offset > half) return t.groundRight[sampleAt(t, s)]!;
  if (offset < -half) return t.groundLeft[sampleAt(t, s)]!;
  for (let p = t.patches.length - 1; p >= 0; p--) {
    const patch = t.patches[p]!;
    if (offset >= patch.lo && offset <= patch.hi && inSpan(s, patch, t.length)) return patch.kind;
  }
  return "road";
}

/**
 * Where the drone puts a kart that fell at `s` back on the road: a little
 * behind, or well before a gap (with room to get up to speed for the jump).
 */
export function rescueSpot(t: Terrain, fallS: number): number {
  const F = TUNING.fall;
  let s = fallS - F.back;
  for (let pass = 0; pass < 2; pass++) {
    // The gap the kart fell into, or one the way back would put it in or just short of.
    const wide = (gap: Span): Span => ({ from: gap.from - 14, to: gap.to + 2 });
    const hit = t.gaps.find((gap) => inSpan(fallS, gap, t.length) || inSpan(s, wide(gap), t.length));
    if (!hit) break;
    s = hit.from - F.runUp;
  }
  return ((s % t.length) + t.length) % t.length;
}
