/**
 * What can be worked out about a track once, before anyone drives it: where
 * the item boxes and boost pads stand, and the bots' racing line and the
 * speed they can carry round it. Built from the geometry and cached by track,
 * so a race starts without a pause.
 */
import { TrackGeometry, type TrackDef } from "../track/geometry";
import { buildTerrain, inSpan, type Terrain } from "./terrain";
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

/**
 * A shortcut over a verge: straight across the inside of a bend, from the road
 * at `from` to the road at `to` (metres along the lap), over ground the sim
 * lets a kart cross because the barrier stands far out there. Only worth it
 * with a boost. The bots drive it as a straight line from (ex, ez) to (xx, xz).
 */
export interface CutSite {
  from: number;
  to: number;
  ex: number;
  ez: number;
  xx: number;
  xz: number;
  /** The unit direction and the length of the line. */
  dx: number;
  dz: number;
  len: number;
}

/**
 * A bend, for the bots' racecraft and their mistakes: from where the road
 * starts to turn to where it straightens, its apex (where it is tightest), the
 * way it turns (+1 right) and how tight it is there (1/m). `open` says an edge
 * with no barrier is beside it or near (no mistakes, no lunges there), `ice`
 * that the line through it crosses ice.
 */
export interface Corner {
  from: number;
  apex: number;
  to: number;
  dir: 1 | -1;
  peak: number;
  open: boolean;
  ice: boolean;
}

export interface TrackPlan {
  geo: TrackGeometry;
  terrain: Terrain;
  /** Verge cuts that really work: the line stays inside the barrier and saves a good share of the road. */
  cuts: CutSite[];
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
  /** The bends, in order along the lap (none on a track that never straightens, like a round arena). */
  corners: Corner[];
  /** Per sample: the bend it lies in, or the next one ahead (an index into `corners`; 0 when there are none). */
  nextCorner: Uint16Array;
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

  const terrain = buildTerrain(def, geo);
  const length = geo.length;

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

  // A ramp is taken straight: the line eases to the middle of the road from 44 m before the lip, holds it from 20 m before to 4 m
  // after, and is back to itself 28 m after.
  for (const ramp of terrain.ramps) {
    for (let i = 0; i < n; i++) {
      let d = ramp.s - i * spacing;
      d -= Math.round(d / length) * length;
      if (d < -34 || d > 52) continue;
      line[i] = line[i]! * Math.min(1, Math.max(0, (Math.abs(d - 8) - 12) / 24));
    }
  }

  // Patches that are not road: a boost strip is driven along, mud and ice are gone round where there is room.
  const adjust = new Float64Array(n);
  for (const patch of terrain.patches) {
    const middle = (patch.lo + patch.hi) / 2;
    for (let i = 0; i < n; i++) {
      if (!inSpan(i * spacing, patch, length)) continue;
      const room = Math.max(0, geo.samples[i]!.width / 2 - bots.edgeMargin);
      const here = line[i]!;
      if (patch.kind === "boost") {
        const target = Number.isFinite(middle) ? Math.max(-room, Math.min(room, middle)) : here;
        adjust[i] = adjust[i]! + (target - here);
      } else if ((patch.kind === "mud" || patch.kind === "ice") && Number.isFinite(patch.lo) && Number.isFinite(patch.hi)) {
        const clear = bots.patchClearance + 1.1;
        if (here < patch.lo - clear || here > patch.hi + clear) continue;
        const left = patch.lo - clear;
        const right = patch.hi + clear;
        const leftOk = left >= -room;
        const rightOk = right <= room;
        let target = here;
        if (leftOk && (!rightOk || here - left <= right - here)) target = left;
        else if (rightOk) target = right;
        adjust[i] = adjust[i]! + (target - here);
      }
    }
  }
  const eased = blur(adjust, spacing, 4);
  for (let i = 0; i < n; i++) {
    const room = Math.max(0, geo.samples[i]!.width / 2 - bots.edgeMargin);
    line[i] = Math.max(-room, Math.min(room, line[i]! + eased[i]!));
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
    lineCurve[i] = Math.abs(turn) / (reach * spacing);
  }
  // Smoothed for steadiness, but not so much that the peak of a tight hairpin is lost: the kart must be slow enough for the tightest part of the line.
  const blurred = blur(lineCurve, spacing, 6);
  const smooth = new Float64Array(n);
  const window = Math.max(1, Math.round(6 / spacing));
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let k = -window; k <= window; k++) peak = Math.max(peak, lineCurve[(i + k + n) % n]!);
    smooth[i] = Math.max(blurred[i]!, bots.peakShare * peak);
  }
  const speed = new Float64Array(n);
  const brake = new Float64Array(n).fill(bots.planBrake);
  for (let i = 0; i < n; i++) {
    const curvature = Math.max(smooth[i]!, 1e-4);
    const s = i * spacing;
    // Bends beside an open edge are taken a little easier; on ice much easier, and with a poor brake.
    const open = terrain.openLeft[i] === 1 || terrain.openRight[i] === 1;
    let v = Math.min(bots.planCap, Math.sqrt((open ? bots.dropLateral : bots.lateral) / curvature));
    let onIce = false;
    for (const patch of terrain.patches) {
      if ((patch.kind !== "ice" && patch.kind !== "mud") || !inSpan(s, patch, length)) continue;
      if (line[i]! < patch.lo - 1.1 || line[i]! > patch.hi + 1.1) continue;
      if (patch.kind === "ice") {
        v = Math.min(v, bots.iceTop, Math.sqrt(bots.iceLateral / curvature));
        onIce = true;
      } else {
        v = Math.min(v, bots.mudTop);
      }
    }
    speed[i] = v;
    if (onIce) brake[i] = bots.iceBrake;
  }
  // Slow down in time: no sample may be faster than the next allows after braking over the gap. Twice round, for the loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n]!;
      const allowed = Math.sqrt(next * next + 2 * Math.min(brake[i]!, brake[(i + 1) % n]!) * spacing);
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

  const corners = findCorners(geo, terrain, curve, line);
  const nextCorner = new Uint16Array(n);
  for (let i = 0; i < n && corners.length > 0; i++) {
    // The first bend whose end is still ahead of this sample.
    let bestAhead = Infinity;
    corners.forEach((c, index) => {
      const ahead = geo.wrap(c.to - i * spacing);
      if (ahead < bestAhead) {
        bestAhead = ahead;
        nextCorner[i] = index;
      }
    });
  }

  return { geo, terrain, cuts: findCuts(def, geo, terrain), boxes, pads, curve, line, speed, bend, corners, nextCorner };
}

/**
 * The bends: runs of the road turning one way (smoothed over 8 m more, so a
 * wiggle is not two bends) at least as tight as `cornerCurvature`, whose
 * tightest point is at least `cornerPeak`.
 */
function findCorners(geo: TrackGeometry, terrain: Terrain, curve: Float64Array, line: Float64Array): Corner[] {
  const bots = TUNING.bots;
  const n = curve.length;
  const spacing = geo.spacing;
  const length = geo.length;
  const smooth = blur(curve, spacing, 8);
  const at = (i: number) => smooth[((i % n) + n) % n]!;
  const bending = (i: number) => Math.abs(at(i)) >= bots.cornerCurvature;
  // Start on a straight, so no bend is cut in two by the start of the scan.
  let start = -1;
  for (let i = 0; i < n && start < 0; i++) if (!bending(i)) start = i;
  if (start < 0) return [];
  const corners: Corner[] = [];
  let i = 0;
  while (i < n) {
    if (!bending(start + i)) {
      i++;
      continue;
    }
    const dir: 1 | -1 = at(start + i) > 0 ? 1 : -1;
    let j = i;
    let peak = 0;
    let apex = 0;
    while (j < n && bending(start + j) && at(start + j) * dir > 0) {
      const here = (start + j) % n;
      if (Math.abs(curve[here]!) > peak) {
        peak = Math.abs(curve[here]!);
        apex = here;
      }
      j++;
    }
    const from = ((start + i) % n) * spacing;
    const run = (j - i) * spacing;
    if (peak >= bots.cornerPeak && run >= 6) {
      let open = false;
      let ice = false;
      for (let d = -30; d <= run + 30; d += 2) {
        const idx = Math.round(geo.wrap(from + d) / spacing) % n;
        if (terrain.openLeft[idx] === 1 || terrain.openRight[idx] === 1) open = true;
        const s = geo.wrap(from + d);
        for (const patch of terrain.patches) {
          if (patch.kind === "ice" && inSpan(s, patch, length) && line[idx]! >= patch.lo - 2 && line[idx]! <= patch.hi + 2) ice = true;
        }
      }
      corners.push({ from, apex: apex * spacing, to: geo.wrap(from + run), dir, peak, open, ice });
    }
    i = j;
  }
  corners.sort((a, b) => a.from - b.from);
  return corners;
}

/**
 * The verges that are worth cutting across: a wide verge on the inside of a
 * bend, whose straight line from the road's inner edge at its start to the
 * road's inner edge at its end stays clear of the barrier and is much shorter
 * than the road between. Anything else is only a wide verge.
 */
function findCuts(def: TrackDef, geo: TrackGeometry, terrain: Terrain): CutSite[] {
  const cuts: CutSite[] = [];
  const length = geo.length;
  for (const verge of def.verges ?? []) {
    if (verge.distance < TUNING.bots.cutMinDistance) continue;
    const side = verge.side === "right" ? 1 : -1;
    // The barrier is out of the way a little before the line leaves the road and after it comes back.
    const from = verge.from * length + TUNING.bots.cutInset;
    const to = verge.to * length - TUNING.bots.cutInset;
    const run = geo.wrap(to - from);
    if (run < 20 || run > length / 2) continue;
    const a = geo.point(from, side * (geo.at(from).width / 2 - 1.5));
    const b = geo.point(to, side * (geo.at(to).width / 2 - 1.5));
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 8 || run / len < TUNING.bots.cutGain) continue;
    // Clear all the way: nowhere nearer the barrier than a kart's width and a bit, and always near the stretch it cuts.
    let clear = true;
    for (let step = 0; step <= 24 && clear; step++) {
      const f = step / 24;
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const near = geo.project(x, z, geo.wrap(from + run * f));
      const half = near.sample.width / 2;
      const room = half + barrierOf(terrain, near.s, near.offset) - 0.8 - 1.6;
      if (Math.abs(geo.delta(near.s, from + run * f)) > run * 0.6 + 12 || (near.offset * side > 0 && Math.abs(near.offset) > room)) clear = false;
    }
    if (clear) cuts.push({ from, to, ex: a.x, ez: a.z, xx: b.x, xz: b.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, len });
  }
  return cuts;
}

function barrierOf(terrain: Terrain, s: number, offset: number): number {
  return offset > 0 ? terrain.barrierRight[Math.round(s / terrain.spacing) % terrain.barrierRight.length]! : terrain.barrierLeft[Math.round(s / terrain.spacing) % terrain.barrierLeft.length]!;
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
