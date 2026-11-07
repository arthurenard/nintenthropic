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
 */
import type { TrackGeometry } from "../../track/geometry";

/** The steepest lean, radians (about 20 degrees): beyond it a bend would look like a wall. */
export const MAX_ROLL = 0.35;

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

  constructor(track: TrackGeometry) {
    const n = track.samples.length;
    this.spacing = track.spacing;
    this.origin = track.origin;
    this.open = track.open;
    this.roll = new Float32Array(n);
    this.halfWidths = Float32Array.from(track.samples, (s) => s.width / 2);
    const bank = track.def.bank ?? 0;
    this.any = bank !== 0 || track.samples.some((s) => s.bank !== 0);
    if (!this.any) return;
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
    if (!this.any) return 0;
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
    const k = ((i % n) + n) % n;
    const hw = this.halfWidths[k]!;
    const o = Math.max(-hw, Math.min(hw, offset));
    return -o * Math.tan(this.roll[k]!);
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
    return -o * Math.tan(this.rollAt(s));
  }
}
