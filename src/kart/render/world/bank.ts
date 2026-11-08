/**
 * Banked bends and twisting road, for the picture only: the road leans the
 * way its points say (`TrackPoint.bank`, eased from point to point, so a
 * hairpin can be banked like a velodrome and an S tilt one way then the
 * other), plus, on a track that asks (`TrackDef.bank`, radians per 1/m of
 * curvature), into every bend by how hard it turns. This works out the lean
 * at every sample and how much higher or lower than the centre line any
 * point across the road sits.
 *
 * The sim knows nothing of it: its karts drive on the flat centre line's
 * height. So every picture that puts something on the road (the road itself,
 * the verge, karts, item boxes, hazards, pads) asks `lift` for the extra
 * height at its lateral offset.
 *
 * Roll is positive in a right-hand bend, and then the right-hand side is the
 * low (inside) one: the height across the road is `-offset * tan(roll)`.
 *
 * A branch road also lies on the road it leaves and rejoins, over a longer
 * stretch than its flare where it parts slowly, and two road surfaces lying
 * over one another at different heights are a step. The branch's cross
 * sections are not the road's (it leaves at an angle), so no height per sample
 * can match the road's across the whole overlap: `lift` takes it in the
 * vertex, so wherever a point of the branch lies on the road it leaves, it is
 * the road's surface there, easing to the branch's own beyond.
 */
import { ROUTE_JOIN_EASE, ROUTE_JOIN_REACH, smooth01, type TrackGeometry, type TrackSample } from "../../track/geometry";

/** The steepest lean, radians (about 20 degrees): beyond it a bend would look like a wall. */
export const MAX_ROLL = 0.35;

/** A branch point this far inside the road it leaves (metres from its edge) is on the road: it is drawn by the road's own surface. */
export const ON_ROAD = 0.3;

const built = new WeakMap<TrackGeometry, Bank>();

export class Bank {
  /** Roll at each of the track's samples. */
  readonly roll: Float32Array;
  private readonly spacing: number;
  private readonly halfWidths: Float32Array;
  readonly any: boolean;
  /** A branch road's samples start here (metres along the lap) and clamp at their ends. */
  private readonly origin: number;
  private readonly open: boolean;
  private readonly track: TrackGeometry;
  /** A branch only: the road it leaves, its banking, and which samples lie near enough to it for the join to matter. */
  private readonly main: TrackGeometry | null;
  private readonly near: Uint8Array | null;
  /** A branch only: where on the road it leaves each of its samples is nearest (lap metres), to look for it there and not along the whole loop. */
  private readonly mainS: Float64Array | null;

  constructor(track: TrackGeometry) {
    const n = track.samples.length;
    this.track = track;
    this.spacing = track.spacing;
    this.origin = track.origin;
    this.open = track.open;
    this.roll = new Float32Array(n);
    this.halfWidths = Float32Array.from(track.samples, (s) => s.width / 2);
    this.main = track.open ? (track as unknown as { main: TrackGeometry }).main : null;
    this.near = null;
    this.mainS = null;
    const bank = track.def.bank ?? 0;
    let any = bank !== 0 || track.samples.some((s) => s.bank !== 0);
    if (this.main) {
      const near = new Uint8Array(n);
      const mainS = new Float64Array(n);
      const reach = ROUTE_JOIN_EASE + 4;
      track.samples.forEach((a, i) => {
        const p = this.main!.projectLoop(a.x, a.z);
        mainS[i] = p.s;
        // Only the stretch of road it replaces, and a little each side: a branch may pass over another part of the loop.
        if (Math.abs(this.main!.delta(p.s, a.s)) > ROUTE_JOIN_REACH + (track as unknown as { span: number }).span) return;
        if (Math.hypot(a.x - p.sample.x, a.z - p.sample.z) <= a.width / 2 + p.sample.width / 2 + reach) {
          near[i] = 1;
          any = true;
        }
      });
      this.near = near;
      this.mainS = mainS;
    }
    this.any = any;
    if (!bank && !track.samples.some((s) => s.bank !== 0)) return;
    // Curvature from sample differences is a little jittery; a moving average over about 9 m calms it.
    const reach = Math.max(1, Math.round(4 / track.spacing));
    for (let i = 0; i < n; i++) {
      let sum = 0;
      if (bank !== 0) for (let k = -reach; k <= reach; k++) sum += track.samples[track.open ? Math.max(0, Math.min(n - 1, i + k)) : (i + k + n) % n]!.curvature;
      const roll = track.samples[i]!.bank + (sum / (reach * 2 + 1)) * bank;
      this.roll[i] = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, roll));
    }
  }

  /** The same banking for the same track, built once (the ground, the road and the world all ask for it). */
  static of(track: TrackGeometry): Bank {
    let bank = built.get(track);
    if (!bank) {
      bank = new Bank(track);
      built.set(track, bank);
    }
    return bank;
  }

  /** The lean at distance `s` along the lap, radians. */
  rollAt(s: number): number {
    const n = this.roll.length;
    if (this.open) {
      const rel = s - this.origin;
      const f = Math.max(0, Math.min(n - 1, rel / this.spacing));
      const i = Math.floor(f);
      return this.roll[i]! + (this.roll[Math.min(n - 1, i + 1)]! - this.roll[i]!) * (f - i);
    }
    const f = s / this.spacing;
    const i = Math.floor(f);
    const u = f - i;
    const a = this.roll[((i % n) + n) % n]!;
    const b = this.roll[(((i + 1) % n) + n) % n]!;
    return a + (b - a) * u;
  }

  /** `lift` at sample `i` of the track's samples (what the road mesh uses, one sample at a time). */
  liftAt(i: number, offset: number): number {
    if (!this.any) return 0;
    const n = this.roll.length;
    const k = this.open ? Math.max(0, Math.min(n - 1, i)) : ((i % n) + n) % n;
    const hw = this.halfWidths[k]!;
    const o = Math.max(-hw, Math.min(hw, offset));
    const own = -o * Math.tan(this.roll[k]!);
    if (!this.near || !this.near[k]) return own;
    return own + this.join(this.track.samples[k]!, offset, own, this.mainS![k]);
  }

  /**
   * How much higher the road is `offset` metres right of the centre line at
   * `s` than the centre line: negative on the inside of a right bend. Beyond
   * the road's edge it holds the edge's height (the verge lies flat).
   */
  lift(s: number, offset: number): number {
    if (!this.any) return 0;
    const n = this.roll.length;
    const i = this.open ? Math.max(0, Math.min(n - 1, Math.floor((s - this.origin) / this.spacing))) : ((Math.floor(s / this.spacing) % n) + n) % n;
    const hw = this.halfWidths[i]!;
    const o = Math.max(-hw, Math.min(hw, offset));
    const own = -o * Math.tan(this.rollAt(s));
    if (!this.near || !this.near[i]) return own;
    return own + this.join(this.track.at(s), offset, own, this.mainS![i]);
  }

  /**
   * How much a point of a branch road (`offset` metres right of `c`, the branch's own surface `own` above the centre line there)
   * must be raised or lowered to lie on the surface of the road it leaves, where it lies on it, easing to nothing a few metres
   * clear of its edge. Also how far inside that road it is (`apart`, negative inside), for the mesh to leave out what the road
   * already draws.
   */
  private join(c: TrackSample, offset: number, own: number, hint?: number): number {
    const m = this.joinAt(c, offset, hint);
    if (!m || m.w <= 0) return 0;
    return m.w * (m.surface - (c.y + own));
  }

  private joinAt(c: TrackSample, offset: number, hint?: number): { w: number; surface: number; apart: number } | null {
    const main = this.main;
    if (!main) return null;
    const x = c.x - c.tz * offset;
    const z = c.z + c.tx * offset;
    // Around where the branch's sample is nearest the road (40 m either way): the point is at most a verge's width from it.
    const p = main.projectLoop(x, z, hint);
    const apart = Math.hypot(x - p.sample.x, z - p.sample.z) - p.sample.width / 2;
    const w = 1 - smooth01((apart + ON_ROAD) / ROUTE_JOIN_EASE);
    const across = Math.max(-p.sample.width / 2, Math.min(p.sample.width / 2, p.offset));
    return { w, surface: p.sample.y + Bank.of(main).lift(p.s, across), apart };
  }

  /**
   * Is the point `offset` metres right of sample `i`'s centre on the road this branch leaves (inside its edge by `ON_ROAD`, at
   * the road's own surface)? Where all of a piece of the branch's surface is, the road draws it already.
   */
  onMain(i: number, offset: number): boolean {
    if (!this.near) return false;
    const k = this.open ? Math.max(0, Math.min(this.roll.length - 1, i)) : i;
    if (!this.near[k]) return false;
    const m = this.joinAt(this.track.samples[k]!, offset, this.mainS![k]);
    return m !== null && m.apart < -ON_ROAD;
  }
}
