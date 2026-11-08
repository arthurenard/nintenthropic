/**
 * What a track's data says about the ground, worked out once into tables the
 * physics can read in a few operations a tick: where the ramps are, which
 * edges have no barrier and where the road itself is missing (a gap to jump),
 * how far out the barrier stands on each side, what the ground beyond the road
 * is, and the patches of ice, mud and boost strip across it. Fractions of the
 * lap in the data become metres here.
 */
import { edgesOf, railWall, RAIL_GAP } from "../track/edges";
import { inStretch, type HazardDef, type Stretch, type Surface, type TrackDef, type TrackGeometry } from "../track/geometry";
import type { Ground } from "./state";
import { TUNING } from "./tuning";
import { buildArcs, type ArcSite } from "./air";

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
  /** The wedge: its length up to the lip, and its height there (the picture draws the same: render/world/features.ts). */
  length: number;
  height: number;
}

/** Ground that differs from the road across part of its width. */
export interface Patch extends Span {
  kind: Surface;
  /** Metres right of the centre line, from and to. */
  lo: number;
  hi: number;
}

export interface Terrain {
  /** The lap's length (also for a branch road: its tables cover only the stretch from `origin`). */
  length: number;
  spacing: number;
  /** A branch road's tables start here (metres along the lap) and clamp at their ends; the loop's wrap (origin 0, open false). */
  origin: number;
  open: boolean;
  ramps: RampSite[];
  /** Cannons, glides and lips (sim/air.ts). */
  arcs: ArcSite[];
  gaps: Span[];
  patches: Patch[];
  hazards: HazardDef[];
  /** Per geometry sample: 1 where that side has a drop beside it (a rail stands over it: see `railLeft`; or the road is missing, in a gap). */
  openLeft: Uint8Array;
  openRight: Uint8Array;
  /** Per sample: how far the rail over a drop has come in to the road's edge, 0..1 (it eases in over ten metres: `barrierLeft` follows). */
  railLeft: Float32Array;
  railRight: Float32Array;
  /** Per sample: how far beyond the road's edge the barrier stands. */
  barrierLeft: Float32Array;
  barrierRight: Float32Array;
  /** Per sample: the ground beyond the road's edge. */
  groundLeft: Ground[];
  groundRight: Ground[];
  /** Per sample: the road's rise per metre, the way the lap runs (read over TUNING.slope.span either side). */
  grade: Float32Array;
  /** Per sample: how sharply the road bows over a crest, 1/m (+ over a crest, - in a dip). */
  crest: Float32Array;
  /** Per sample: the steepest fall per metre over the last TUNING.slope.carry metres, driving forward (0 if none)... */
  fallBehind: Float32Array;
  /** ...and over the next ones, for a kart going the other way. */
  fallAhead: Float32Array;
}

/** Is `s` (0..length) inside `span`? */
export function inSpan(s: number, span: Span, length: number): boolean {
  const w = ((s % length) + length) % length;
  return span.from <= span.to ? w >= span.from && w <= span.to : w >= span.from || w <= span.to;
}

function spanOf(stretch: Stretch, length: number): Span {
  return { from: stretch.from * length, to: stretch.to * length };
}

/** Two roads whose edges are closer than this have no barrier between them: a kart goes from one to the other. */
export const GATE_GAP = 14;

const gateCache = new WeakMap<TrackGeometry, { left: Float32Array; right: Float32Array }>();

/**
 * Where a road is open to another: for each sample of `geo`, whether the other road's edge is within `GATE_GAP` on each
 * side (by the nearest point of the other road, not the same lap metre: a branch is mapped onto the stretch it replaces, so
 * the same metre can be far across the infield). The main road is open to its branches and a branch to the main road, so a
 * branch leaves it and rejoins it with no barrier across the way (a flare where the two roads run together, a wedge of grass
 * between them as they part). Right at a junction, where the two lie on one another, the side is the way the branch goes.
 */
export function junctionGates(geo: TrackGeometry): { left: Float32Array; right: Float32Array } {
  const known = gateCache.get(geo);
  if (known) return known;
  const n = geo.samples.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const asRoute = (road: TrackGeometry) => road as unknown as { main: TrackGeometry; from: number; to: number };
  const others: TrackGeometry[] = geo.open ? [asRoute(geo).main] : geo.routes;
  for (const other of others) {
    for (let i = 0; i < n; i++) {
      const a = geo.samples[i]!;
      // A branch is only there between its junctions.
      if (other.open) {
        const r = asRoute(other);
        const into = geo.delta(r.from, a.s);
        if (into < -2 || into > r.to - r.from + 2) continue;
      }
      const near = other.open ? other.projectOpen(a.x, a.z) : other.projectLoop(a.x, a.z);
      const b = near.sample;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const gap = d - a.width / 2 - b.width / 2;
      if (gap >= GATE_GAP) continue;
      // Which side of this road the other lies on, judged by where the other goes on into the stretch the branch replaces (a
      // branch leaves at an angle, so its nearest point can lie straight behind or ahead: the side is the way it goes).
      let toward: { x: number; z: number };
      if (geo.open) {
        const r = asRoute(geo);
        const dir = near.s - r.from < r.to - near.s ? 1 : -1;
        // Lying on the road it leaves (the flare), a branch is open on the side it goes off to; apart from it, on the side the road is.
        toward = d < 2 ? geo.at(a.s + dir * 36) : r.main.at(near.s + dir * 36);
      } else {
        const r = asRoute(other);
        const dir = near.s - r.from < r.to - near.s ? 1 : -1;
        toward = other.at(near.s + dir * 36);
      }
      const lateral = (toward.x - a.x) * -a.tz + (toward.z - a.z) * a.tx;
      // The barrier is out of the way as far as the other road's own, six metres beyond its far edge: where the two lie on one
      // another it is the usual six, and as they part it stands farther out, and the wall each road has is the other's.
      // It eases from the usual six (where the roads are a GATE_GAP apart) to that as they close, so the wall never jumps.
      const needed = d + b.width / 2 + TUNING.barrierGap - a.width / 2;
      const out = TUNING.barrierGap + Math.max(0, Math.min(1, (GATE_GAP - gap) / GATE_GAP)) * Math.max(0, needed - TUNING.barrierGap);
      if (lateral >= 0) right[i] = Math.max(right[i]!, out);
      if (lateral <= 0) left[i] = Math.max(left[i]!, out);
    }
  }
  const gates = { left, right };
  gateCache.set(geo, gates);
  return gates;
}

export function buildTerrain(def: TrackDef, geo: TrackGeometry): Terrain {
  const length = geo.length;
  const n = geo.samples.length;
  const frac = (i: number) => geo.samples[i]!.s / length;
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
  }
  // Drops, and the rail over them, are worked out with the picture's (track/edges.ts): the same stretches, eased the same way.
  const edges = edgesOf(geo);
  openLeft.set(edges.dropLeft);
  openRight.set(edges.dropRight);
  const railLeft = edges.railLeft;
  const railRight = edges.railRight;
  for (const verge of def.verges ?? []) {
    for (let i = 0; i < n; i++) {
      if (!inStretch(frac(i), verge)) continue;
      if (verge.side === "left") {
        barrierLeft[i] = verge.distance;
        if (verge.surface) groundLeft[i] = verge.surface;
      } else {
        barrierRight[i] = verge.distance;
        if (verge.surface) groundRight[i] = verge.surface;
      }
    }
  }
  const gates = junctionGates(geo);
  for (let i = 0; i < n; i++) {
    if (gates.left[i]) barrierLeft[i] = Math.max(barrierLeft[i]!, gates.left[i]!);
    if (gates.right[i]) barrierRight[i] = Math.max(barrierRight[i]!, gates.right[i]!);
  }
  // Over a drop the barrier is a rail at the road's edge, closing in from where it usually stands as the drop begins.
  for (let i = 0; i < n; i++) {
    barrierLeft[i] = railWall(barrierLeft[i]!, railLeft[i]!);
    barrierRight[i] = railWall(barrierRight[i]!, railRight[i]!);
    // A deck is road under the kart's wheels all the way to the rail.
    if (barrierLeft[i]! <= RAIL_GAP + 0.01 && railLeft[i]! >= 0.5) groundLeft[i] = "road";
    if (barrierRight[i]! <= RAIL_GAP + 0.01 && railRight[i]! >= 0.5) groundRight[i] = "road";
  }
  const patches: Patch[] = (def.surfaces ?? []).map((surface) => {
    const middle = surface.offset ?? 0;
    const half = (surface.width ?? Infinity) / 2;
    return { ...spanOf(surface, length), kind: surface.kind, lo: middle - half, hi: middle + half };
  });
  const R = TUNING.ramp;
  const ramps: RampSite[] = (def.ramps ?? []).map((ramp) => {
    const lift = ramp.lift ?? R.lift;
    return { s: geo.wrap(ramp.at * length), lift, trick: ramp.trick !== false, length: R.length, height: (R.height * lift) / R.lift };
  });
  return { length, spacing: geo.spacing, origin: geo.origin, open: geo.open, ramps, arcs: buildArcs(def, geo), gaps, patches, hazards: def.hazards ?? [], openLeft, openRight, railLeft, railRight, barrierLeft, barrierRight, groundLeft, groundRight, ...hills(geo) };
}

/** The road's grade, its crests and dips, and how steep the descent just behind each place is: the hills the karts feel. */
function hills(geo: TrackGeometry): Pick<Terrain, "grade" | "crest" | "fallBehind" | "fallAhead"> {
  const n = geo.samples.length;
  const spacing = geo.spacing;
  const span = Math.max(spacing, TUNING.slope.span);
  const y = (s: number) => geo.at(s).y;
  // A branch road's tables stop at its ends; the loop's wrap round.
  const idx = geo.open ? (i: number) => Math.max(0, Math.min(n - 1, i)) : (i: number) => ((i % n) + n) % n;
  // Metres of real road per metre of the lap: a grade is a rise per metre driven.
  const stretch = geo.stretch;
  const grade = new Float32Array(n);
  const crest = new Float32Array(n);
  // Near a branch road's ends only the road there is read (the span either side cut short to what there is): read as far as
  // a clamped end, a sloping branch had half its grade at its first metre and a crest beside it that was not in the road.
  for (let i = 0; i < n; i++) {
    const s = geo.samples[i]!.s;
    const ahead = geo.open ? Math.min(span, (n - 1 - i) * spacing) : span;
    const behind = geo.open ? Math.min(span, i * spacing) : span;
    grade[i] = ahead + behind > 0 ? (y(s + ahead) - y(s - behind)) / ((ahead + behind) * stretch) : 0;
  }
  // The bow over a crest is how fast the grade falls away, read over the same span.
  const reach = Math.max(1, Math.round(span / spacing));
  for (let i = 0; i < n; i++) {
    const hi = geo.open ? Math.min(n - 1, i + reach) : i + reach;
    const lo = geo.open ? Math.max(0, i - reach) : i - reach;
    crest[i] = hi > lo ? -(grade[idx(hi)]! - grade[idx(lo)]!) / ((hi - lo) * spacing * stretch) : 0;
  }
  const back = Math.max(1, Math.round(TUNING.slope.carry / spacing));
  const fallBehind = new Float32Array(n);
  const fallAhead = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let behind = 0;
    let ahead = 0;
    for (let k = 0; k <= back; k++) {
      behind = Math.max(behind, -grade[idx(i - k)]!);
      ahead = Math.max(ahead, grade[idx(i + k)]!);
    }
    fallBehind[i] = behind;
    fallAhead[i] = ahead;
  }
  return { grade, crest, fallBehind, fallAhead };
}

/** A table of the terrain's read at `s`, between samples. */
export function tableAt(t: Terrain, table: Float32Array, s: number): number {
  const n = table.length;
  if (t.open) {
    const u = openIndex(t, s);
    const i = Math.floor(u);
    return table[i]! + (table[Math.min(n - 1, i + 1)]! - table[i]!) * (u - i);
  }
  const u = (((s / t.spacing) % n) + n) % n;
  const i = Math.floor(u);
  const f = u - i;
  return table[i]! + (table[(i + 1) % n]! - table[i]!) * f;
}

/**
 * How high a ramp's wedge lifts the road at `s` (the ramp a kart is climbing),
 * or 0: from its foot `length` metres before the lip up to `height` at it, a
 * little concave so the wheels roll on. The picture's wedge (render/world/features.ts
 * `rampHeight`) is the same curve.
 */
export function wedgeAt(t: Terrain, s: number): number {
  for (const ramp of t.ramps) {
    let d = ramp.s - s;
    if (d > t.length / 2) d -= t.length;
    if (d < -t.length / 2) d += t.length;
    if (d < 0 || d > ramp.length) continue;
    return ramp.height * Math.pow(1 - d / ramp.length, 1.4);
  }
  return 0;
}

/** Where `s` falls in a branch road's tables, as a position clamped to them. */
function openIndex(t: Terrain, s: number): number {
  let rel = s - t.origin;
  rel -= Math.round(rel / t.length) * t.length;
  const last = t.openLeft.length - 1;
  const u = rel / t.spacing;
  return u < 0 ? 0 : u > last ? last : u;
}

/** The table sample nearest `s`. */
export function sampleAt(t: Terrain, s: number): number {
  const n = t.openLeft.length;
  if (t.open) return Math.round(openIndex(t, s));
  return ((Math.round(s / t.spacing) % n) + n) % n;
}

/** Is there a drop beside the road on this side (+1 right, -1 left) here? A rail stands over it, except in a gap. */
export function isDrop(t: Terrain, s: number, side: 1 | -1): boolean {
  const i = sampleAt(t, s);
  return (side > 0 ? t.openRight[i] : t.openLeft[i]) === 1;
}

/** Is the edge on this side open here: nothing to stop a kart, which falls (only in a gap, where the road itself is missing)? */
export function isOpen(t: Terrain, s: number, side: 1 | -1): boolean {
  return isDrop(t, s, side) && gapAt(t, s) !== null;
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
