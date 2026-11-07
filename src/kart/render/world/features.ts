/**
 * What a track says beyond its centre line, worked out once per sample so the
 * ground, the road mesh, the barriers and the karts all agree: where the
 * edges are open (drops), where the road itself is missing (a jump over a
 * gap), how far out the barrier stands (verges), and the height of every
 * ramp. Pure maths, no three.js.
 *
 * A "gap" is a drop on both sides, short, right after a ramp: the road is not
 * there under the flight (docs/GRIP_PRIX.md: "Jumps can cross a gap: a drop
 * under the flight"). The sim decides what a kart does; this decides what the
 * picture shows.
 */
import { inStretch, type Surface, type TrackGeometry, type TrackTheme } from "../../track/geometry";
import { GATE_DISTANCE, junctionGates } from "../../sim/terrain";

/** A barrier's inner face stands this far beyond the road's edge unless a verge moves it: the sim's wall. */
export const WALL_DISTANCE = 6;

/**
 * Nothing solid stands closer than this beyond the barrier's face: the chase camera swings out past the barrier in a
 * bend, and what stands there is a thing a kart's picture can pass through.
 */
export const SOLID_MARGIN = 1.5;

/** How far below the road the floor is where an edge is open, by world, metres. */
export const DROP_DEPTH: Record<TrackTheme, number> = {
  meadow: 14,
  canyon: 24,
  harbour: 6,
  kitchen: 46,
  snow: 28,
  volcano: 7,
  funfair: 14,
  space: 90,
  palm: 5,
};

/** How far out from the road the open ground drops before it comes back (a trench, a lake of lava); 0 means never. */
export const DROP_REACH: Record<TrackTheme, number> = {
  meadow: 55,
  canyon: 90,
  harbour: 0,
  kitchen: 0,
  snow: 70,
  volcano: 80,
  funfair: 50,
  space: 0,
  palm: 0,
};

/** A ramp as the picture draws it. */
export interface RampShape {
  /** Where the lip is, metres along the lap. */
  lip: number;
  /** The wedge's length and the height at the lip. */
  length: number;
  height: number;
  trick: boolean;
}

export const RAMP_LENGTH = 16;
/** The height of a ramp's lip for the default lift (7 m/s): a kicker you can see from a distance. */
export const RAMP_HEIGHT = 2.4;

export interface SurfacePatch {
  kind: Surface;
  /** Metres along the lap; the patch may wrap over the start line, so `to` can be less than `from`. */
  from: number;
  to: number;
  /** Across the road: centre offset and width, metres. */
  offset: number;
  width: number;
}

export interface Features {
  readonly count: number;
  /** 0..1 openness of each edge at each sample, smooth along the road. */
  readonly dropLeft: Float32Array;
  readonly dropRight: Float32Array;
  /** 1 where the road is missing (a gap to jump). */
  readonly gap: Uint8Array;
  /** Where the barrier's inner face stands beyond the road's edge, each side, metres. */
  readonly wallLeft: Float32Array;
  readonly wallRight: Float32Array;
  /**
   * 1 where the barrier line is not a boundary of the drivable area, so none is drawn: the sim places a kart by the nearest
   * stretch of road, and where a wide verge's barrier line would run through the ground of another stretch (across a
   * hairpin's inside, or doubled back on itself round its apex) a kart passes it.
   */
  readonly hiddenLeft: Uint8Array;
  readonly hiddenRight: Uint8Array;
  /** The ground between the road and a far barrier, where a verge says so (null: the theme's own verge). */
  readonly vergeLeft: (Surface | null)[];
  readonly vergeRight: (Surface | null)[];
  readonly ramps: RampShape[];
  readonly surfaces: SurfacePatch[];
  /** True if any edge anywhere is open. */
  readonly anyDrop: boolean;
}

function fractionOf(track: TrackGeometry, i: number): number {
  return track.samples[i]!.s / track.length;
}

/** Box-blurs a cyclic array over `reach` samples either side. */
function blur(a: Float32Array, reach: number, open = false): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) sum += a[open ? Math.max(0, Math.min(n - 1, i + k)) : (i + k + n) % n]!;
    out[i] = sum / (reach * 2 + 1);
  }
  return out;
}

export function analyseFeatures(track: TrackGeometry): Features {
  const n = track.samples.length;
  const def = track.def;
  const dropLeft = new Float32Array(n);
  const dropRight = new Float32Array(n);
  const gap = new Uint8Array(n);
  const wallLeft = new Float32Array(n).fill(WALL_DISTANCE);
  const wallRight = new Float32Array(n).fill(WALL_DISTANCE);
  const vergeLeft: (Surface | null)[] = new Array(n).fill(null);
  const vergeRight: (Surface | null)[] = new Array(n).fill(null);

  const ramps: RampShape[] = (def.ramps ?? []).map((r) => {
    const lift = r.lift ?? 7;
    return { lip: r.at * track.length, length: RAMP_LENGTH, height: (RAMP_HEIGHT * lift) / 7, trick: r.trick !== false };
  });

  for (const d of def.drops ?? []) {
    const lengthM = (((d.to - d.from) % 1) + 1) % 1 * track.length;
    // A short drop on both sides right behind a ramp's lip is a gap under the jump.
    const isGap =
      d.side === "both" &&
      lengthM < 70 &&
      (def.ramps ?? []).some((r) => {
        const behind = (((d.from - r.at) % 1) + 1) % 1;
        return behind * track.length < 48;
      });
    for (let i = 0; i < n; i++) {
      if (!inStretch(fractionOf(track, i), d)) continue;
      if (d.side !== "right") dropLeft[i] = 1;
      if (d.side !== "left") dropRight[i] = 1;
      if (isGap) gap[i] = 1;
    }
  }
  // The edge opens and closes over about ten metres, not in one step.
  const reach = Math.max(1, Math.round(5 / track.spacing));
  const left = blur(dropLeft, reach, track.open);
  const right = blur(dropRight, reach, track.open);
  let anyDrop = false;
  for (let i = 0; i < n; i++) if (left[i]! > 0.01 || right[i]! > 0.01) anyDrop = true;

  for (const v of def.verges ?? []) {
    for (let i = 0; i < n; i++) {
      if (!inStretch(fractionOf(track, i), v)) continue;
      const wall = v.side === "left" ? wallLeft : wallRight;
      wall[i] = Math.max(wall[i]!, v.distance);
      (v.side === "left" ? vergeLeft : vergeRight)[i] = v.surface ?? "grass";
    }
  }

  const hiddenLeft = new Uint8Array(n);
  const hiddenRight = new Uint8Array(n);
  // Where a branch leaves or joins the road there is no barrier between the two: a kart goes from one to the other.
  const gates = junctionGates(track);
  for (let i = 0; i < n; i++) {
    if (gates.left[i]) {
      wallLeft[i] = Math.max(wallLeft[i]!, GATE_DISTANCE);
      hiddenLeft[i] = 1;
    }
    if (gates.right[i]) {
      wallRight[i] = Math.max(wallRight[i]!, GATE_DISTANCE);
      hiddenRight[i] = 1;
    }
  }
  for (let i = 0; i < n && !track.open; i++) {
    const a = track.samples[i]!;
    for (const side of [-1, 1] as const) {
      if ((side < 0 ? hiddenLeft : hiddenRight)[i]) continue;
      const wall = (side < 0 ? wallLeft : wallRight)[i]!;
      // The barrier's pieces stand from the wall's face out to two or three metres beyond it (a bank of snow is that deep).
      for (const beyond of [0.55, 1.2, 1.9, 2.6]) {
        const o = side * (a.width / 2 + wall + beyond);
        const near = track.projectLoop(a.x - a.tz * o, a.z + a.tx * o);
        // Only a line that runs through another stretch's ground (the nearest road is a different stretch of the lap).
        if (Math.abs(track.delta(a.s, near.s)) <= 25) continue;
        // A wide verge's far barrier: wherever another stretch is the nearer road. An ordinary one: only where it stands inside
        // the other stretch's own drivable ground (the inside of a tight U-turn, such as a fingertip of the palm island, where
        // the two legs are closer than their barriers are wide).
        const k = Math.min(n - 1, Math.round(near.s / track.spacing));
        const nearWall = (near.offset < 0 ? wallLeft : wallRight)[k]!;
        if (wall > WALL_DISTANCE || Math.abs(near.offset) - near.sample.width / 2 < nearWall) {
          (side < 0 ? hiddenLeft : hiddenRight)[i] = 1;
          break;
        }
      }
    }
  }

  const surfaces: SurfacePatch[] = (def.surfaces ?? []).map((s) => ({
    kind: s.kind,
    from: s.from * track.length,
    to: s.to * track.length,
    offset: s.offset ?? 0,
    width: s.width ?? 0,
  }));

  return { count: n, dropLeft: left, dropRight: right, gap, wallLeft, wallRight, hiddenLeft, hiddenRight, vergeLeft, vergeRight, ramps, surfaces, anyDrop };
}

/**
 * How high the road surface is above the flat road at `s` because of a ramp:
 * a wedge rising to the lip, then nothing (the lip is the edge of the world
 * for the wedge). The karts' picture adds it to their height.
 */
export function rampHeight(ramps: readonly RampShape[], s: number, lap: number): number {
  for (const r of ramps) {
    let d = r.lip - s;
    // The nearest copy over the start line.
    if (d > lap / 2) d -= lap;
    if (d < -lap / 2) d += lap;
    if (d < 0 || d > r.length) continue;
    // Foot to lip: a little concave, so the wheels roll onto it.
    return r.height * Math.pow(1 - d / r.length, 1.4);
  }
  return 0;
}

/** Whether `s` lies in a stretch given in metres (one that may wrap over the start line). */
export function inMetres(patch: { from: number; to: number }, s: number, lap: number): boolean {
  const f = ((s % lap) + lap) % lap;
  return patch.from <= patch.to ? f >= patch.from && f <= patch.to : f >= patch.from || f <= patch.to;
}
