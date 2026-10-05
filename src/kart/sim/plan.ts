/**
 * What can be worked out about a track once, before anyone drives it: where
 * the item boxes and boost pads stand, and the bots' racing line and the
 * speed they can carry round it. Built from the geometry and cached by track,
 * so a race starts without a pause.
 */
import { TrackGeometry, type TrackDef } from "../track/geometry";
import { TUNING } from "./tuning";

export interface BoxSite {
  s: number;
  offset: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface PadSite {
  s: number;
  offset: number;
}

export interface TrackPlan {
  geo: TrackGeometry;
  boxes: BoxSite[];
  pads: PadSite[];
  /** Centre-line curvature smoothed over a few metres, 1/m (+ bends right), at each geometry sample. */
  curve: Float64Array;
  /** The bots' racing line: metres right of the centre line, at each sample. */
  line: Float64Array;
  /** The speed a bot can carry on that line, braking for what lies ahead, m/s, at each sample. */
  speed: Float64Array;
  /** How far a bend that starts here (tighter than the drift threshold, one way) goes on, metres; 0 on a straight. */
  bend: Float64Array;
}

const cache = new WeakMap<TrackDef, TrackPlan>();

export function planFor(def: TrackDef): TrackPlan {
  let plan = cache.get(def);
  if (!plan) {
    plan = buildPlan(def);
    cache.set(def, plan);
  }
  return plan;
}

/** A circular Gaussian blur of `values`, sigma in metres. */
function blur(values: Float64Array, spacing: number, sigma: number): Float64Array {
  const n = values.length;
  const reach = Math.ceil((sigma * 2.5) / spacing);
  const weights: number[] = [];
  let total = 0;
  for (let k = -reach; k <= reach; k++) {
    const w = Math.exp(-0.5 * ((k * spacing) / sigma) ** 2);
    weights.push(w);
    total += w;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) sum += values[(((i + k) % n) + n) % n]! * weights[k + reach]!;
    out[i] = sum / total;
  }
  return out;
}

function buildPlan(def: TrackDef): TrackPlan {
  const geo = TrackGeometry.build(def);
  const n = geo.samples.length;
  const spacing = geo.spacing;
  const bots = TUNING.bots;

  const boxes: BoxSite[] = [];
  const perRow = TUNING.items.boxesPerRow;
  for (const fraction of def.itemRows) {
    const s = geo.wrap(fraction * geo.length);
    const c = geo.at(s);
    const step = (c.width * TUNING.items.rowSpread) / (perRow - 1);
    for (let k = 0; k < perRow; k++) {
      const offset = (k - (perRow - 1) / 2) * step;
      const p = geo.point(s, offset);
      boxes.push({ s, offset, x: p.x, y: p.y, z: p.z, heading: Math.atan2(c.tx, c.tz) });
    }
  }
  const pads: PadSite[] = (def.boostPads ?? []).map((p) => ({ s: geo.wrap(p.at * geo.length), offset: p.offset }));

  // The racing line: toward the inside of each bend, by how tight it is.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = geo.samples[i]!.curvature;
  const curve = blur(raw, spacing, 5);
  const cutting = blur(raw, spacing, 16);
  const line = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const room = Math.max(0, geo.samples[i]!.width / 2 - bots.edgeMargin);
    line[i] = Math.max(-1, Math.min(1, cutting[i]! / bots.cutCurvature)) * bots.cutShare * room;
  }

  // The speed that line allows: from its own curvature, then slowed in advance for what follows.
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = geo.samples[i]!;
    px[i] = c.x - c.tz * line[i]!;
    pz[i] = c.z + c.tx * line[i]!;
  }
  const reach = Math.max(2, Math.round(4 / spacing));
  const lineCurve = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - reach + n) % n;
    const b = (i + reach) % n;
    const ax = px[i]! - px[a]!;
    const az = pz[i]! - pz[a]!;
    const bx = px[b]! - px[i]!;
    const bz = pz[b]! - pz[i]!;
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    lineCurve[i] = Math.abs(turn) / (reach * 2 * spacing);
  }
  const smooth = blur(lineCurve, spacing, 6);
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) speed[i] = Math.min(bots.planCap, Math.sqrt(bots.lateral / Math.max(smooth[i]!, 1e-4)));
  // Slow down in time: no sample may be faster than the next allows after braking over the gap. Twice round, for the loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n]!;
      const allowed = Math.sqrt(next * next + 2 * bots.planBrake * spacing);
      if (speed[i]! > allowed) speed[i] = allowed;
    }
  }

  // How long each bend runs, for deciding to drift it.
  const bend = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const here = curve[i]!;
      const next = curve[(i + 1) % n]!;
      if (Math.abs(here) < bots.driftCurvature) {
        bend[i] = 0;
      } else if (Math.sign(here) === Math.sign(next) && Math.abs(next) >= bots.driftCurvature) {
        bend[i] = bend[(i + 1) % n]! + spacing;
      } else {
        bend[i] = spacing;
      }
    }
  }

  return { geo, boxes, pads, curve, line, speed, bend };
}

/** A per-sample table read at `s`, interpolated. */
export function tableAt(plan: TrackPlan, table: Float64Array, s: number): number {
  const geo = plan.geo;
  const w = geo.wrap(s);
  const f = w / geo.spacing;
  const i = Math.floor(f) % table.length;
  const a = table[i]!;
  const b = table[(i + 1) % table.length]!;
  return a + (b - a) * (f - Math.floor(f));
}
