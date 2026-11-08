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
  /**
   * A pad that is only live part of the time (a drawbridge's leaf, raised): the race clock's cycle of `period` seconds
   * (offset by `phase`, a fraction) is within [`from`, `to`) of it, fractions of the cycle. Whatever the pad throws is
   * a function of the race clock, so every device agrees; off, the pad does nothing and the kart drives over it.
   */
  timed?: { period: number; from: number; to: number; phase?: number };
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
   * down). "orbit": round a circle of radius `span` metres centred at `offset` (a sweeper's arm is several, at
   * different radii and the same phase: `sweeper` in track/pieces.ts).
   *
   * The timed set pieces (track/pieces.ts), all pure functions of the race clock like the rest: "swing": a wrecking
   * ball on a chain across the road, `span` metres either side of `offset`, low through the middle of its swing and
   * lifting clear at each end. "crush": a block (or icicle) that hangs, shakes with a lamp lit (`warn`), falls, lies
   * a moment and rises, at `offset`. "slide": crosses the whole road once a cycle from out of sight to out of sight
   * (a negative `span` goes right to left), with a lamp lit before it comes.
   */
  motion: "cross" | "roll" | "bob" | "orbit" | "swing" | "crush" | "slide";
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
  /** "orbit": which way it turns, seen from above: 1 (default) or -1. */
  dir?: 1 | -1;
  /** "crush": how high its underside hangs when it is up, metres (default 3.2 x radius + 2.5): a cave's icicle hangs lower than a quarry's block. */
  top?: number;
  /** "slide": how much of the cycle its warning (lamp, foam, glow) is shown before it comes (default 0.22). */
  lead?: number;
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

/**
 * An alternate route: a branch road that leaves the main road at `from` and rejoins it at `to`. Either a risky
 * shortcut (narrow, over rough ground, a jump, maybe needing a boost) or a split, two ways of much the same length
 * (one high, one low). Race progress maps the branch onto the main road between the two junctions, so places stay
 * right; karts drive on it like any road; bots choose by temperament (aggressive: the shortcut). Built by
 * `RouteRoad` below; everything a branch adds is data here, in fractions of the BRANCH (0 at the junction it leaves,
 * 1 at the one it rejoins), which the engine turns into the lap's own fractions.
 */
export interface RouteDef {
  id: string;
  /** "shortcut": shorter but harder. "split": about as long, a different road. */
  kind: "shortcut" | "split";
  /** Where it leaves and rejoins the main road, fractions of the lap (from < to; a route never crosses the start line). */
  from: number;
  to: number;
  /**
   * The branch's own centre line between the junctions: waypoints (the junctions themselves come from the main road,
   * and the curve leaves and joins it along the main road's heading, so put the first and last point a few tens of
   * metres out along it). A missing `y` is eased between the junctions' heights; a missing `width` is the route's.
   */
  points: TrackPoint[];
  /** The branch's width between its flares, metres. */
  width: number;
  /** Metres over which the branch widens to the main road's width at each end, and the barrier opens (default 30). */
  flare?: number;
  /** How much a bot wants it, 0..1 (default: a shortcut 0.8, a split 0.5): compared with the bot's temperament. */
  appeal?: number;
  /** What the branch adds, in fractions of the branch. */
  ramps?: Ramp[];
  drops?: (Stretch & { side: "left" | "right" | "both"; gap?: boolean })[];
  verges?: (Stretch & { side: "left" | "right"; distance: number; surface?: Surface })[];
  surfaces?: (Stretch & { kind: Surface; offset?: number; width?: number })[];
  boostPads?: { at: number; offset: number }[];
  hazards?: HazardDef[];
  landmarks?: Landmark[];
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
  /** Where the rubber duck hides (every Nintenthropic game has one). */
  duck?: { at: number; offset: number; y?: number };
  /**
   * How far the road leans into its bends everywhere, for the picture: radians per 1/m of curvature (0 = flat). Added to
   * each point's own `bank`.
   */
  bank?: number;
  /** Alternate routes: branch roads that leave the main road and rejoin it (see RouteDef). */
  routes?: RouteDef[];
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
  /** 0: the main road. 1..: a branch (`TrackGeometry.routes[route - 1]`), whose `s` is mapped onto the main road's metres. */
  route: number;
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
  /** The branch roads (main road only): `routes[r - 1]` is route `r`. */
  routes: RouteRoad[] = [];
  /** 0 for the main road, 1.. for a branch. */
  readonly route: number = 0;
  /**
   * An open road (a branch) is sampled from `origin` (metres along the lap) to its end, and clamps there; the loop
   * wraps. `length` is always the lap's, so `wrap` and `delta` mean the same on every road, and a sample's `s` is in
   * the lap's metres on every road.
   */
  readonly open: boolean = false;
  readonly origin: number = 0;
  /** Real metres of road per metre of the lap it covers (1 for the loop; above 1 where the branch winds, below where it cuts). */
  readonly stretch: number = 1;

  protected constructor(
    readonly def: TrackDef,
    samples: TrackSample[],
    length: number,
    road?: { route: number; origin: number; spacing: number; stretch: number },
  ) {
    this.samples = samples;
    this.length = length;
    if (road) {
      this.route = road.route;
      this.open = true;
      this.origin = road.origin;
      this.spacing = road.spacing;
      this.stretch = road.stretch;
    } else {
      this.spacing = length / samples.length;
    }
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
    const geo = new TrackGeometry(def, samples, length);
    geo.routes = (def.routes ?? []).map((route, i) => RouteRoad.make(geo, route, i + 1));
    return geo;
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

  /** The centre line at `s`, between samples (a branch clamps to its ends). */
  at(s: number): TrackSample {
    if (this.open) return this.atOpen(s);
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

  /** Where `s` falls along an open road, as a sample position (clamped to its ends). */
  protected openPosition(s: number): number {
    const rel = this.delta(this.origin, s);
    const span = (this.samples.length - 1) * this.spacing;
    return (rel < 0 ? 0 : rel > span ? span : rel) / this.spacing;
  }

  private atOpen(s: number): TrackSample {
    const u = this.openPosition(s);
    const i = Math.min(Math.floor(u), this.samples.length - 2);
    const a = this.samples[i]!;
    const b = this.samples[i + 1]!;
    const f = u - i;
    const tx = a.tx + (b.tx - a.tx) * f;
    const tz = a.tz + (b.tz - a.tz) * f;
    const t = Math.hypot(tx, tz) || 1;
    return {
      s: a.s + f * this.spacing,
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
  project(x: number, z: number, near?: number, route = 0): Projection {
    const main = this.open ? this.projectOpen(x, z, near) : this.projectLoop(x, z, near);
    if (this.routes.length === 0) return main;
    // The nearest road wins, a kart already on a branch keeping it unless the other is clearly nearer.
    let best = main;
    let bestD = Math.hypot(x - main.sample.x, z - main.sample.z) - (route === 0 ? ROUTE_STICKY : 0);
    for (const r of this.routes) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const p = r.projectOpen(x, z, near);
      const d = Math.hypot(x - p.sample.x, z - p.sample.z) - (route === r.route ? ROUTE_STICKY : 0);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** `project` on the closed loop alone. */
  projectLoop(x: number, z: number, near?: number): Projection {
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
    return { route: 0, s: sample.s, offset, sample };
  }

  /** `project` on an open road (a branch): only its own samples, clamped at its ends. */
  projectOpen(x: number, z: number, near?: number): Projection {
    const n = this.samples.length;
    let lo = 0;
    let hi = n - 2;
    if (near !== undefined) {
      const window = Math.ceil(40 / this.spacing);
      const u = Math.floor(this.openPosition(near));
      lo = Math.max(0, u - window);
      hi = Math.min(n - 2, u + window);
    }
    let best = Infinity;
    let bestS = this.origin;
    for (let i = lo; i <= hi; i++) {
      const a = this.samples[i]!;
      const b = this.samples[i + 1]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
      const d = (x - a.x - ex * f) ** 2 + (z - a.z - ez * f) ** 2;
      if (d < best) {
        best = d;
        bestS = a.s + f * this.spacing;
      }
    }
    const sample = this.at(bestS);
    const offset = (x - sample.x) * -sample.tz + (z - sample.z) * sample.tx;
    return { route: this.route, s: sample.s, offset, sample };
  }

  /** The heading (see contract.ts) of the direction of travel at `s`. */
  heading(s: number): number {
    const c = this.at(s);
    return Math.atan2(c.tx, c.tz);
  }
}

/** A kart on one road keeps it against another this much nearer, metres: no flickering between roads that overlap at a junction. */
const ROUTE_STICKY = 1.5;

/** Metres of road the curve leaves the main road along before it turns off, and rejoins it along. */
const ROUTE_LEAD = 18;
/** Metres the branch follows the main road's own line for before it turns off (and before it rejoins). */
const ROUTE_HUG = 14;
/** ...and the same, shorter, where it rejoins: it comes in at an angle (the merge is a flare), and a longer hug would make it double back. */
const ROUTE_HUG_END = 6;

/** Metres of clear ground between a branch's edge and the main road's, over which it eases up from the main road's height and lean to its own. */
export const ROUTE_JOIN_EASE = 8;
/** A branch's flare is only at the road it leaves where it is within this many lap metres (beyond the stretch it replaces) of it. */
export const ROUTE_JOIN_REACH = 90;

/** The tightest a branch's bend may be against its road: |curvature| x half the width, under 1 (the inside edge's own radius is the half width). */
const ROUTE_TIGHTEST = 0.7;

/**
 * Eases the plan view of a branch road (x, z per sample, about a metre apart) wherever it bends tighter than `ROUTE_TIGHTEST`
 * of its half width, by moving those samples toward the midpoint of their neighbours until none does (the first and last few
 * samples stay on the main road).
 */
function relax(xs: number[], zs: number[], widths: number[]): void {
  const n = xs.length;
  const keep = 1;
  const reach = 2;
  for (let pass = 0; pass < 600; pass++) {
    let moved = false;
    for (let i = keep; i < n - keep; i++) {
      const a = Math.max(0, i - reach);
      const c = Math.min(n - 1, i + reach);
      const ax = xs[i]! - xs[a]!;
      const az = zs[i]! - zs[a]!;
      const bx = xs[c]! - xs[i]!;
      const bz = zs[c]! - zs[i]!;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) continue;
      const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      const curvature = turn / ((la + lb) / 2);
      if (curvature * (widths[i]! / 2) <= ROUTE_TIGHTEST) continue;
      xs[i] = xs[i]! + ((xs[a]! + xs[c]!) / 2 - xs[i]!) * 0.5;
      zs[i] = zs[i]! + ((zs[a]! + zs[c]!) / 2 - zs[i]!) * 0.5;
      moved = true;
    }
    if (!moved) break;
  }
  evenly(xs, zs);
}

/** Puts the samples of a polyline an equal distance apart along it again (the ends stay), as relaxing it left them uneven. */
function evenly(xs: number[], zs: number[]): void {
  const n = xs.length;
  const at = [0];
  for (let i = 1; i < n; i++) at.push(at[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!));
  const total = at[n - 1]!;
  const ox = xs.slice();
  const oz = zs.slice();
  let j = 0;
  for (let i = 1; i < n - 1; i++) {
    const want = (total * i) / (n - 1);
    while (j < n - 2 && at[j + 1]! < want) j++;
    const f = at[j + 1]! > at[j]! ? (want - at[j]!) / (at[j + 1]! - at[j]!) : 0;
    xs[i] = ox[j]! + (ox[j + 1]! - ox[j]!) * f;
    zs[i] = oz[j]! + (oz[j + 1]! - oz[j]!) * f;
  }
}

export const smooth01 = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * A branch road (see `RouteDef`): sampled like the main road but open at both ends, in the lap's own metres. Its
 * samples sit `spacing` lap-metres apart (about a real metre, a little more or less as the branch is shorter or
 * longer than the stretch of main road it replaces), with `s` the main road's metre they stand for, so a kart's
 * progress along the lap carries on across a branch exactly as across the road it replaces.
 */
export class RouteRoad extends TrackGeometry {
  /** The lap's metres where the branch leaves and rejoins the main road. */
  readonly from: number;
  readonly to: number;
  readonly span: number;
  /** The branch in metres of its own road. */
  readonly realLength: number;
  /** Where it is (with a margin), for a quick test of whether a point is anywhere near. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  private constructor(
    readonly main: TrackGeometry,
    readonly routeDef: RouteDef,
    samples: TrackSample[],
    route: number,
    from: number,
    to: number,
    realLength: number,
    pseudo: TrackDef,
  ) {
    const span = to - from;
    super(pseudo, samples, main.length, { route, origin: from, spacing: span / (samples.length - 1), stretch: realLength / span });
    this.from = from;
    this.to = to;
    this.span = span;
    this.realLength = realLength;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const a of samples) {
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x);
      minZ = Math.min(minZ, a.z);
      maxZ = Math.max(maxZ, a.z);
    }
    const margin = 36;
    this.minX = minX - margin;
    this.maxX = maxX + margin;
    this.minZ = minZ - margin;
    this.maxZ = maxZ + margin;
  }

  /** Is the lap's metre `s` between the junctions? */
  covers(s: number): boolean {
    const rel = this.delta(this.from, s);
    return rel >= 0 && rel <= this.span;
  }

  static make(main: TrackGeometry, def: RouteDef, route: number): RouteRoad {
    if (!(def.from >= 0 && def.to > def.from && def.to <= 1)) throw new Error(`${main.def.id}/${def.id}: a route runs forward and not over the start line`);
    const from = def.from * main.length;
    const to = def.to * main.length;
    if (to - from > main.length / 2) throw new Error(`${main.def.id}/${def.id}: a route covers under half the lap`);
    const a = main.at(from);
    const b = main.at(to);
    const flare = def.flare ?? 30;
    // The curve's control points: the main road a little before the junction (so it leaves along the road's heading),
    // the junction, the waypoints, the other junction and the main road a little after it.
    const inner = def.points;
    const waypoints: TrackPoint[] = inner.map((p, i) => ({
      x: p.x,
      z: p.z,
      y: p.y ?? a.y + ((b.y - a.y) * (i + 1)) / (inner.length + 1),
      width: p.width ?? def.width,
      bank: p.bank ?? 0,
    }));
    const point = (c: TrackSample): TrackPoint => ({ x: c.x, z: c.z, y: c.y, width: c.width, bank: c.bank });
    // ...and a point 14 m along the main road at each end, so the branch leaves and joins it along its heading.
    const list: TrackPoint[] = [
      point(main.at(from - ROUTE_LEAD)),
      point(a),
      point(main.at(from + ROUTE_HUG)),
      ...waypoints,
      point(main.at(to - ROUTE_HUG_END)),
      point(b),
      point(main.at(to + ROUTE_LEAD)),
    ];
    if (list.length < 4) throw new Error(`${main.def.id}/${def.id}: a route needs a waypoint`);
    // A fine polyline to measure the arc length of.
    const fine: { x: number; y: number; z: number; width: number; bank: number; s: number }[] = [];
    const steps = 48;
    let arc = 0;
    for (let i = 1; i <= list.length - 3; i++) {
      for (let k = 0; k < steps; k++) {
        const p = catmull(list, def.width, i, k / steps);
        const prev = fine[fine.length - 1];
        if (prev) arc += Math.hypot(p.x - prev.x, p.z - prev.z);
        fine.push({ ...p, s: arc });
      }
    }
    {
      const tail = list[list.length - 2]!;
      const p = { x: tail.x, y: tail.y ?? 0, z: tail.z, width: tail.width ?? def.width, bank: tail.bank ?? 0 };
      const prev = fine[fine.length - 1]!;
      arc += Math.hypot(p.x - prev.x, p.z - prev.z);
      fine.push({ ...p, s: arc });
    }
    const count = Math.max(8, Math.round(arc));
    const step = arc / count;
    const spacing = (to - from) / count;
    // The branch's plan view and widths, sample by sample.
    const xs: number[] = [];
    const zs: number[] = [];
    const widths: number[] = [];
    const ownY: number[] = [];
    const ownBank: number[] = [];
    let j = 0;
    for (let i = 0; i <= count; i++) {
      const at = i * step;
      while (j < fine.length - 2 && fine[j + 1]!.s < at) j++;
      const p = fine[j]!;
      const q = fine[j + 1]!;
      const f = q.s > p.s ? (at - p.s) / (q.s - p.s) : 0;
      // The branch is the main road's own width where it leaves and joins, and its own between the flares.
      const own = p.width + (q.width - p.width) * f;
      const open = smooth01(at / flare);
      const close = smooth01((arc - at) / flare);
      widths.push((a.width + (own - a.width) * open) * (1 - close) + (b.width + (own - b.width) * close) * close);
      xs.push(p.x + (q.x - p.x) * f);
      zs.push(p.z + (q.z - p.z) * f);
      ownY.push(p.y + (q.y - p.y) * f);
      ownBank.push(p.bank + (q.bank - p.bank) * f);
    }
    // A waypoint that is not straight ahead of the road it leaves makes a kink where the curve turns off, and a road is a ribbon
    // as wide as the main road there: bent tighter than half its width its inside edge folds back over the road.
    relax(xs, zs, widths);
    let realLength = 0;
    for (let i = 1; i < xs.length; i++) realLength += Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!);
    const samples: TrackSample[] = [];
    for (let i = 0; i <= count; i++) {
      const at = i * step;
      const open = smooth01(at / flare);
      const close = smooth01((arc - at) / flare);
      const px = xs[i]!;
      const pz = zs[i]!;
      const width = widths[i]!;
      let py = ownY[i]!;
      let pb = ownBank[i]!;
      // Where it lies on the main road (the flares) it is at the main road's height and lean, and its own between them: no step.
      // That holds for as long as the two roads' surfaces overlap, which is longer than the flare where the branch parts from the
      // road slowly: two surfaces lying over one another at different heights are a step, and a kart there is on both.
      const near = main.projectLoop(px, pz);
      const mp = near.sample;
      const apart = Math.hypot(px - mp.x, pz - mp.z) - (mp.width + width) / 2;
      // (Only the stretch of road it replaces, and a little each side, counts: a branch may pass over another part of the loop.)
      const here = main.delta(near.s, from + i * spacing);
      const lateral = Math.abs(here) < ROUTE_JOIN_REACH + (to - from) ? smooth01((apart + 1) / ROUTE_JOIN_EASE) : 1;
      const joined = Math.min(open, close, lateral);
      if (joined < 1) {
        // The main road's surface at this very place, which on a banked road is above or below its centre line by the lean.
        const across = Math.max(-mp.width / 2, Math.min(mp.width / 2, near.offset));
        const surface = mp.y - across * Math.tan(mp.bank);
        py = surface + (py - surface) * joined;
        pb = mp.bank + (pb - mp.bank) * joined;
      }
      samples.push({
        s: from + i * spacing,
        x: px,
        y: py,
        z: pz,
        width,
        bank: pb,
        tx: 0,
        tz: 1,
        curvature: 0,
      });
    }
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const prev = samples[Math.max(0, i - 1)]!;
      const next = samples[Math.min(n - 1, i + 1)]!;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const d = Math.hypot(dx, dz) || 1;
      samples[i]!.tx = dx / d;
      samples[i]!.tz = dz / d;
    }
    for (let i = 0; i < n; i++) {
      const prev = samples[Math.max(0, i - 1)]!;
      const next = samples[Math.min(n - 1, i + 1)]!;
      const cross = prev.tx * next.tz - prev.tz * next.tx;
      const dot = prev.tx * next.tx + prev.tz * next.tz;
      samples[i]!.curvature = Math.atan2(cross, dot) / ((i === 0 || i === n - 1 ? 1 : 2) * step);
    }
    return new RouteRoad(main, def, samples, route, from, to, realLength, pseudoDef(main.def, def));
  }
}

/** The branch's features as a TrackDef of their own, in the lap's fractions: what the terrain, the plan and the picture read. */
function pseudoDef(main: TrackDef, def: RouteDef): TrackDef {
  const a = def.from;
  const b = def.to;
  const at = (t: number): number => a + t * (b - a);
  const stretch = <T extends Stretch>(x: T): T => ({ ...x, from: at(x.from), to: at(x.to) });
  const out: TrackDef = {
    id: `${main.id}/${def.id}`,
    name: `${main.name}: ${def.id}`,
    theme: main.theme,
    laps: main.laps,
    points: def.points,
    width: def.width,
    itemRows: [],
  };
  if (def.ramps) out.ramps = def.ramps.map((r) => ({ ...r, at: at(r.at) }));
  if (def.drops) out.drops = def.drops.map(stretch);
  if (def.verges) out.verges = def.verges.map(stretch);
  if (def.surfaces) out.surfaces = def.surfaces.map(stretch);
  if (def.boostPads) out.boostPads = def.boostPads.map((p) => ({ ...p, at: at(p.at) }));
  if (def.hazards) out.hazards = def.hazards.map((h) => ({ ...h, at: at(h.at), span: h.motion === "roll" && h.span !== undefined ? h.span * (b - a) : h.span }));
  if (def.landmarks) out.landmarks = def.landmarks.map((l) => ({ ...l, at: at(l.at) }));
  if (main.bank !== undefined) out.bank = main.bank;
  return out;
}
