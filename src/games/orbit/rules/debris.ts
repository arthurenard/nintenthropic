/**
 * One piece of wreckage: what it is, how it moves and turns, how many hits
 * it has left, and where (if anywhere) it will reach the glass. The world
 * draws it where `motion` and `tumble` say, so what the player sees is what
 * the rules decide.
 */
import type { Motion, Strike } from "./motion";
import { positionAt } from "./motion";
import { KINDS, SHARD_FACE_ON, TANK_FACING, type Kind } from "./tuning";
import { dot, normalize, rotate, sub, type V3 } from "./vec";

export type FragmentState = "flying" | "vaporised" | "split" | "struck" | "passed";

/** What it was sent at: a pane, the cupola's metal, or past the station. */
export type Heading = "pane" | "frame" | "miss";

/** How it turns: about `axis`, at `rate` radians a second, from `phase` at birth. */
export interface Tumble {
  axis: V3;
  rate: number;
  phase: number;
  /**
   * A direction fixed in the fragment, turned with it: a shard's face, the
   * Derelict's fuel tank. The world orients the mesh so its local +Z is this.
   */
  face: V3;
}

export class Fragment {
  state: FragmentState = "flying";
  /** Hits it takes before it goes: a foil wrap takes one, the Derelict's tank three. */
  hitsLeft: number;
  /** A foil-wrapped piece still in its wrap. */
  wrapped: boolean;
  /** Where it will reach the glass, if it will: worked out again whenever its path changes. */
  strike: Strike | null = null;
  /** Sent at the metal: where and when it rings the hull (unless it finds glass first). */
  frame: { point: V3; time: number } | null = null;
  /** A miss: let go at this time if it has not gone behind the eye before. */
  passBy = Infinity;
  /** When it ended, however it did. */
  endedAt = Infinity;
  /** Its proximity ring has shown. */
  ringed = false;

  constructor(
    readonly id: number,
    readonly kind: Kind,
    /** Which of the art's variants of its kind (the world picks the mesh by it). */
    readonly variant: number,
    readonly born: number,
    public motion: Motion,
    readonly tumble: Tumble,
    readonly heading: Heading,
    /** The fragment it split from, if it is a piece, and what that was. */
    readonly parent: { id: number; kind: Kind } | null = null,
  ) {
    const spec = KINDS[kind];
    this.hitsLeft = spec.hits;
    this.wrapped = kind === "foil";
  }

  get flying(): boolean {
    return this.state === "flying";
  }

  /** Its size for the rules, metres. */
  get radius(): number {
    return KINDS[this.kind].radius;
  }

  position(t: number, out?: V3): V3 {
    return positionAt(this.motion, t, out);
  }

  /** How far it has turned at time t, radians. */
  angle(t: number): number {
    return this.tumble.phase + this.tumble.rate * (t - this.born);
  }

  /** The direction fixed in it (a shard's face, the tank) at time t. */
  face(t: number, out?: V3): V3 {
    return rotate(this.tumble.face, this.tumble.axis, this.angle(t), out);
  }

  /** Seconds until it reaches the glass, or Infinity if it will not. */
  closing(t: number): number {
    return this.strike ? Math.max(0, this.strike.time - t) : Infinity;
  }
}

const toEye = { x: 0, y: 0, z: 0 };
const faceV = { x: 0, y: 0, z: 0 };

/**
 * How squarely a shard faces the eye, 0 (edge-on) to 1 (face-on): the
 * cosine between its face and the line of sight.
 */
export function facing(f: Fragment, t: number, eye: V3): number {
  const p = f.position(t);
  const d = normalize(sub(eye, p));
  toEye.x = d.x;
  toEye.y = d.y;
  toEye.z = d.z;
  return Math.abs(dot(f.face(t, faceV), toEye));
}

/** Can a shot land on it now? A shard only face-on (the Derelict's tank has its own test, tankShows). */
export function shootable(f: Fragment, t: number, eye: V3): boolean {
  if (!f.flying) return false;
  if (f.kind === "shard") return facing(f, t, eye) >= SHARD_FACE_ON;
  return true;
}

/** Is the Derelict's fuel tank turned toward the eye (so a shot can reach it)? */
export function tankShows(f: Fragment, t: number, eye: V3): boolean {
  if (f.kind !== "derelict" || !f.flying) return false;
  const p = f.position(t);
  const d = normalize(sub(eye, p));
  return dot(f.face(t, faceV), d) >= TANK_FACING;
}
