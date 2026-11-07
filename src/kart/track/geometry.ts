/**
 * A track as data, and the shape every part reads it through.
 *
 * A track is a closed loop of points in driving order, joined by a smooth
 * curve (centripetal Catmull-Rom, which never loops or overshoots between
 * points). TrackGeometry samples that curve every metre or so; the sim asks
 * it where a kart is along the lap (`project`), the picture builds the road
 * from it (`at`, `point`), and both agree to the centimetre because they
 * read the same samples.
 *
 * `s` is metres along the centre line from the start line, 0..length; a
 * lateral `offset` is metres to the right of the driving direction.
 */

export type TrackTheme =
  | "meadow"
  | "canyon"
  | "harbour"
  /** Toy karts on a giant kitchen counter. */
  | "kitchen"
  /** An alpine pass in snow and ice. */
  | "snow"
  /** Black rock among rivers of lava. */
  | "volcano"
  /** A fairground at dusk, every ride lit. */
  | "funfair"
  /** A glowing ribbon of road in space. */
  | "space"
  /** A sunny beach island shaped like an open hand (the secret track). */
  | "palm";

/** What the ground is, where it is not plain road. */
export type Surface =
  /** The verge: slow (the sim's off-road). */
  | "grass"
  /** Slower still, and kicks up dust. */
  | "sand"
  /** Off-road that sprays snow. */
  | "snow"
  /** Little grip: the kart slides on (a frozen lake, spilt milk). */
  | "ice"
  /** Very slow, and sticky. */
  | "mud"
  /** A boost strip along the road (as a pad, but long). */
  | "boost";

/**
 * A part of the lap, as fractions 0..1 of it. `from` > `to` wraps over the
 * start line (0.9 → 0.1 is the last tenth and the first).
 */
export interface Stretch {
  from: number;
  to: number;
}

/** A jump: a ramp across the whole road at `at`; a kart crossing it fast flies. */
export interface Ramp {
  /** Where its lip is, a fraction of the lap. */
  at: number;
  /** Upward speed it gives at the lip at top speed, m/s (default 7: about a second in the air). */
  lift?: number;
  /** A trick here (a shake, or Space, in the air) boosts on landing. Default true. */
  trick?: boolean;
}

/**
 * A launch or air section (sim/air.ts): a pad across the road that throws a kart into a planned flight over `length`
 * metres of road, landing where the flight ends. The flight is a function of how far along the road the kart has got,
 * so it replays exactly and every screen draws the same. "cannon": a barrel pad that fires the kart up in an arc of
 * `height` metres (tricks boost on landing; a kart too slow is still thrown, at a speed that carries it). "glide": a
 * big lift-off after which the kart deploys a parasol and floats down in a long shallow slope, steering well and
 * choosing where to land; landing close to the middle of the road gives a short boost. "lip": a half-pipe lip, a short
 * arc with a trick boost guaranteed.
 */
export interface AirSection {
  kind: "cannon" | "glide" | "lip";
  /** Where the pad is, a fraction of the lap. */
  at: number;
  /** Metres of road the flight covers. */
  length: number;
  /** The arc's top above the road, metres. */
  height: number;
  /** The pad's middle, metres right of the centre line, and its width (default: the whole road). */
  offset?: number;
  width?: number;
}

/**
 * Something that moves on its own and spins out a kart it touches. Where
 * it is is a pure function of the race's time (`hazardAt` in hazards.ts),
 * so the sim and every screen agree without sending it.
 */
export interface HazardDef {
  /** What it looks like: a name from the theme's list in docs/GRIP_PRIX.md ("boulder", "penguin"...). The sim ignores it. */
  kind: string;
  /** Where along the lap, a fraction. */
  at: number;
  /**
   * How it moves. "cross": back and forth across the road. "roll": along the
   * road against the traffic, from `at` for `span` of the lap, then again.
   * "bob": up out of the ground and down again at `offset` (harmless while
   * down). "orbit": round a circle of radius `span` metres centred at `offset`.
   */
  motion: "cross" | "roll" | "bob" | "orbit";
  /** Seconds for one cycle. */
  period: number;
  /** 0..1 of the cycle at time 0, so several of a kind are not in step. */
  phase?: number;
  /** Its size, metres: a kart within this (plus the kart's own 1.1 m) is hit. */
  radius: number;
  /** Metres right of the centre (bob, orbit's centre; cross's middle). Default 0. */
  offset?: number;
  /** "cross": metres either side of `offset` (default to the road's edges). "roll": the fraction of the lap it rolls. "orbit": the circle's radius, metres. */
  span?: number;
}

/** A set piece the picture builds beside the road (a giant teapot, a ferris wheel); the sim ignores it. */
export interface Landmark {
  /** A name from the theme's list in docs/GRIP_PRIX.md; one the picture does not know is left out. */
  kind: string;
  /** Where along the lap, a fraction, and metres right of the centre (negative: left). */
  at: number;
  offset: number;
  /** Its size relative to the picture's own idea of it (default 1). */
  scale?: number;
  /** Turned about +y from facing the road, radians (default 0). */
  turn?: number;
  /** For a thing over the road (a tunnel, an arch, a bridge): metres along the road it covers, centred on `at`. */
  span?: number;
}

export interface TrackPoint {
  x: number;
  z: number;
  /** The road's height here, metres (0 if unset). */
  y?: number;
  /** The road's width here, metres (the track's `width` if unset). */
  width?: number;
  /**
   * How far the road leans here, radians: + tips its right-hand side down (the way a right-hander is banked), - its
   * left (0 if unset). It eases from point to point, so a run of points leaning one way then the other is a twisting
   * road; a lean against the bend is an off-camber corner. The picture draws it (render/world/bank.ts); mirror mode
   * negates it.
   */
  bank?: number;
}

export interface TrackDef {
  id: string;
  name: string;
  theme: TrackTheme;
  /** Laps a race is, unless the room says otherwise. */
  laps: number;
  /** The centre line, closed, in driving order. The start line is at points[0], facing points[1]. */
  points: TrackPoint[];
  /** The road's width, metres, where a point does not say. */
  width: number;
  /** Where rows of item boxes stand, as fractions of the lap (0..1). */
  itemRows: number[];
  /** Boost pads: `at` a fraction of the lap, `offset` metres right of the centre. */
  boostPads?: { at: number; offset: number }[];
  /** A sentence for the lobby: what the track is. */
  blurb?: string;
  /** Jumps. */
  ramps?: Ramp[];
  /**
   * Edges with nothing to stop a kart: drive off and it falls, and the
   * rescue drone puts it back on the road a little behind (about 2.5 s lost).
   */
  drops?: (Stretch & {
    side: "left" | "right" | "both";
    /**
     * The road itself is missing in this stretch (side "both"): a gap to jump.
     * Only a kart in the air gets across; one that lands short, or drives in,
     * falls. Put a ramp just before it, and a straight run-up before that.
     */
    gap?: boolean;
  })[];
  /**
   * Where the barrier stands farther out than its usual 6 m from the road's
   * edge, on `surface` ground (default grass): a wide verge, or a cut across
   * the inside of a bend worth taking with a Nitro.
   */
  verges?: (Stretch & { side: "left" | "right"; distance: number; surface?: Surface })[];
  /** Patches that drive differently, across the road from `offset - width/2` to `offset + width/2` (the whole road if unset). */
  surfaces?: (Stretch & { kind: Surface; offset?: number; width?: number })[];
  hazards?: HazardDef[];
  /** Cannons, glides and lips: the launch and air sections (see AirSection). */
  air?: AirSection[];
  landmarks?: Landmark[];
  /** Where the rubber duck hides (every Super Claude Bros. game has one). */
  duck?: { at: number; offset: number; y?: number };
  /**
   * How far the road leans into its bends everywhere, for the picture: radians per 1/m of curvature (0 = flat). Added to
   * each point's own `bank`.
   */
  bank?: number;
  /** Hidden until it is unlocked. */
  secret?: boolean;
}

/** Is `fraction` (0..1 of the lap) within `stretch`, wrapping over the line? */
export function inStretch(fraction: number, stretch: Stretch): boolean {
  const f = fraction - Math.floor(fraction);
  return stretch.from <= stretch.to ? f >= stretch.from && f <= stretch.to : f >= stretch.from || f <= stretch.to;
}

export interface TrackSample {
  /** Metres along the centre line from the start. */
  s: number;
  x: number;
  y: number;
  z: number;
  /** The unit direction of travel in (x, z). */
  tx: number;
  tz: number;
  width: number;
  /** The points' own lean here, radians (+ the right side low): see TrackPoint.bank. The track's `bank` comes on top. */
  bank: number;
  /** Signed curvature, 1/m: + bends right, - left. */
  curvature: number;
}

export interface Projection {
  s: number;
  /** Metres right of the centre line (negative: left). */
  offset: number;
  sample: TrackSample;
}

/** A closed centripetal Catmull-Rom curve through `points`, evaluated at `t` in [0, 1) of segment `i`. */
function catmull(points: readonly TrackPoint[], fallbackWidth: number, i: number, t: number): { x: number; y: number; z: number; width: number; bank: number } {
  const n = points.length;
  const p = (k: number) => points[((k % n) + n) % n]!;
  const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
  const knot = (a: TrackPoint, b: TrackPoint) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z)));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const value = (a: number, b: number, c: number, d: number) => {
    const a1 = ((t1 - u) / (t1 - t0)) * a + ((u - t0) / (t1 - t0)) * b;
    const a2 = ((t2 - u) / (t2 - t1)) * b + ((u - t1) / (t2 - t1)) * c;
    const a3 = ((t3 - u) / (t3 - t2)) * c + ((u - t2) / (t3 - t2)) * d;
    const b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2;
    const b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3;
    return ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2;
  };
  const w = (q: TrackPoint) => q.width ?? fallbackWidth;
  const ease = t * t * (3 - 2 * t);
  return {
    x: value(p0.x, p1.x, p2.x, p3.x),
    y: value(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0),
    z: value(p0.z, p1.z, p2.z, p3.z),
    // Width and lean ease from point to point along a smoothstep, not the curve, which could overshoot and pinch the road
    // to a sliver (or tip it past the lean either point asks for).
    width: w(p1) + (w(p2) - w(p1)) * ease,
    bank: (p1.bank ?? 0) + ((p2.bank ?? 0) - (p1.bank ?? 0)) * ease,
  };
}

export class TrackGeometry {
  readonly length: number;
  /** One sample every `spacing` metres (about), from s = 0; the loop closes from the last back to the first. */
  readonly samples: readonly TrackSample[];
  readonly spacing: number;

  private constructor(
    readonly def: TrackDef,
    samples: TrackSample[],
    length: number,
  ) {
    this.samples = samples;
    this.length = length;
    this.spacing = length / samples.length;
  }

  /** Samples `def`'s centre line about every `spacing` metres. */
  static build(def: TrackDef, spacing = 1): TrackGeometry {
    const n = def.points.length;
    if (n < 4) throw new Error(`${def.id}: a track needs at least four points`);
    // A fine polyline first, to measure arc length.
    const fine: { x: number; y: number; z: number; width: number; bank: number; s: number }[] = [];
    const steps = 48;
    let s = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < steps; k++) {
        const p = catmull(def.points, def.width, i, k / steps);
        const last = fine[fine.length - 1];
        if (last) s += Math.hypot(p.x - last.x, p.z - last.z);
        fine.push({ ...p, s });
      }
    }
    const first = fine[0]!;
    const end = fine[fine.length - 1]!;
    const length = s + Math.hypot(first.x - end.x, first.z - end.z);
    fine.push({ ...first, s: length });

    // Then even samples along it.
    const count = Math.max(8, Math.round(length / spacing));
    const step = length / count;
    const samples: TrackSample[] = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const at = i * step;
      while (j < fine.length - 2 && fine[j + 1]!.s < at) j++;
      const a = fine[j]!;
      const b = fine[j + 1]!;
      const f = b.s > a.s ? (at - a.s) / (b.s - a.s) : 0;
      samples.push({
        s: at,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        width: a.width + (b.width - a.width) * f,
        bank: a.bank + (b.bank - a.bank) * f,
        tx: 0,
        tz: 1,
        curvature: 0,
      });
    }
    // Tangents by central difference; curvature from the turn of the tangent.
    for (let i = 0; i < count; i++) {
      const prev = samples[(i - 1 + count) % count]!;
      const next = samples[(i + 1) % count]!;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const d = Math.hypot(dx, dz) || 1;
      samples[i]!.tx = dx / d;
      samples[i]!.tz = dz / d;
    }
    for (let i = 0; i < count; i++) {
      const prev = samples[(i - 1 + count) % count]!;
      const next = samples[(i + 1) % count]!;
      // The tangent's turn toward its right, (-tz, tx): + bends right.
      const cross = prev.tx * next.tz - prev.tz * next.tx;
      const dot = prev.tx * next.tx + prev.tz * next.tz;
      samples[i]!.curvature = Math.atan2(cross, dot) / (2 * step);
    }
    return new TrackGeometry(def, samples, length);
  }

  /** `s` brought into 0..length. */
  wrap(s: number): number {
    const r = s % this.length;
    return r < 0 ? r + this.length : r;
  }

  /** The shortest signed distance along the loop from `from` to `to` (+ forward). */
  delta(from: number, to: number): number {
    let d = this.wrap(to) - this.wrap(from);
    if (d > this.length / 2) d -= this.length;
    if (d < -this.length / 2) d += this.length;
    return d;
  }

  /** The centre line at `s`, between samples. */
  at(s: number): TrackSample {
    const w = this.wrap(s);
    const i = Math.floor(w / this.spacing) % this.samples.length;
    const a = this.samples[i]!;
    const b = this.samples[(i + 1) % this.samples.length]!;
    const f = (w - a.s) / this.spacing;
    const tx = a.tx + (b.tx - a.tx) * f;
    const tz = a.tz + (b.tz - a.tz) * f;
    const t = Math.hypot(tx, tz) || 1;
    return {
      s: w,
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      tx: tx / t,
      tz: tz / t,
      width: a.width + (b.width - a.width) * f,
      bank: a.bank + (b.bank - a.bank) * f,
      curvature: a.curvature + (b.curvature - a.curvature) * f,
    };
  }

  /** The world point `offset` metres right of the centre line at `s`. */
  point(s: number, offset = 0): { x: number; y: number; z: number } {
    const c = this.at(s);
    return { x: c.x - c.tz * offset, y: c.y, z: c.z + c.tx * offset };
  }

  /**
   * Where (x, z) is along the track: the nearest point of the centre line.
   * With `near` (the s it was at a moment ago) only the stretch around it is
   * searched, which is both fast and right where the track passes close to
   * itself; without, the whole loop.
   */
  project(x: number, z: number, near?: number): Projection {
    const count = this.samples.length;
    let from = 0;
    let span = count;
    if (near !== undefined) {
      const window = Math.ceil(40 / this.spacing);
      from = Math.floor(this.wrap(near) / this.spacing) - window;
      span = window * 2 + 1;
    }
    let best = Infinity;
    let bestS = 0;
    for (let k = 0; k < span; k++) {
      const i = (((from + k) % count) + count) % count;
      const a = this.samples[i]!;
      const b = this.samples[(i + 1) % count]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
      const px = a.x + ex * f;
      const pz = a.z + ez * f;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) {
        best = d;
        bestS = a.s + f * this.spacing;
      }
    }
    const sample = this.at(bestS);
    // Right of (tx, tz) is (-tz, tx).
    const offset = (x - sample.x) * -sample.tz + (z - sample.z) * sample.tx;
    return { s: sample.s, offset, sample };
  }

  /** The heading (see contract.ts) of the direction of travel at `s`. */
  heading(s: number): number {
    const c = this.at(s);
    return Math.atan2(c.tx, c.tz);
  }
}
